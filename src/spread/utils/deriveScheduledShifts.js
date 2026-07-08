// Derive shift assignments from the hourly binary `spread` column
// =================================================================
//
// The spread "database" is by (table × date × hour) with a binary
// `spread` field — 1 = scheduled to be OPEN that hour, 0 = closed.
// To show a historical schedule on the floor heatmap we turn that
// per-hour signal back into a per-table SHIFT:
//
//   1. Collect every hour a table was scheduled open (spread === 1).
//   2. Consolidate those hours into a window — start / end / total.
//   3. Match that window to a shift template by hour-coverage overlap
//      (IoU). A table is only assigned when the match is CONFIDENT
//      (IoU >= MIN_MATCH_IOU); a table that had scheduled hours but
//      doesn't cleanly map to any shift is left UNASSIGNED and flagged
//      for manual review (per the "it should not happen — flag it"
//      requirement) rather than silently snapped to the closest shift.
//
// The inverse (expandAssignmentsToSpreadRows) turns the edited per-table
// shifts back into per-(table,hour) binary rows for re-upload to the DB.
//
// Pure functions (no React) so they're unit-testable and reusable.

import { gametypeTableKey } from '../../performance/utils/dataSource';
import { shiftCoverageMask } from './shiftCoverage';

// Minimum intersection-over-union for a confident shift match. 0.8 means
// the scheduled hours and the shift's coverage must overlap ≥80% — a
// clean shift scores ~1.0; a one-off / irregular window scores lower and
// is left unassigned + flagged. Tunable here.
export const MIN_MATCH_IOU = 0.8;

const SCHEDULING_ORDER = [7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 0, 1, 2, 3, 4, 5, 6];
const norm = (h) => ((Math.round(Number(h)) % 24) + 24) % 24;
const orderIndex = (h) => SCHEDULING_ORDER.indexOf(norm(h));

// Consolidate scheduled hours into { start, end, total } (start = first
// hour in scheduling-day order, end = last, total = count). Null when
// nothing was scheduled.
export function consolidateScheduledHours(hours) {
    const set = new Set([...(hours || [])].map(norm));
    if (set.size === 0) return null;
    const sorted = [...set].sort((a, b) => orderIndex(a) - orderIndex(b));
    return { start: sorted[0], end: sorted[sorted.length - 1], total: set.size };
}

// Best-fitting shift for a scheduled-hour SET, by coverage IoU. Returns
// { shiftId, iou } for the top match (or { shiftId: null, iou } when no
// shift overlaps). The caller applies the confidence threshold.
export function bestShiftMatch(scheduledHourSet, shifts) {
    let bestId = null;
    let bestIoU = 0;
    for (const s of (shifts || [])) {
        const mask = shiftCoverageMask(s); // boolean[24], index = hour
        let inter = 0;
        let union = 0;
        for (let h = 0; h < 24; h++) {
            const a = scheduledHourSet.has(h);
            const b = mask[h];
            if (a && b) inter += 1;
            if (a || b) union += 1;
        }
        if (union === 0) continue;
        const iou = inter / union;
        if (iou > bestIoU) { bestIoU = iou; bestId = s.id; }
    }
    return { shiftId: bestId, iou: bestIoU };
}

// Build assignments from hourly spread rows ALREADY filtered to one date.
// Returns:
//   {
//     assignments: { tableKey: shiftId },        // confident matches only
//     unmatched:   [ { tableKey, gametype, table, start, end, total, iou } ]
//                                                 // had hours, no clean shift
//   }
export function deriveSpreadAssignments(hourlyRowsForDate, shifts, opts = {}) {
    const minIoU = opts.minIoU ?? MIN_MATCH_IOU;
    const byTable = new Map();        // tableKey -> { set, gametype, table }
    for (const r of (hourlyRowsForDate || [])) {
        if (Number(r.spread) !== 1) continue;
        const key = gametypeTableKey(r.gametype, r.table);
        let e = byTable.get(key);
        if (!e) { e = { set: new Set(), gametype: r.gametype, table: r.table }; byTable.set(key, e); }
        e.set.add(norm(r.hour));
    }
    const assignments = {};
    const unmatched = [];
    for (const [key, e] of byTable) {
        const { shiftId, iou } = bestShiftMatch(e.set, shifts);
        if (shiftId && iou >= minIoU) {
            assignments[key] = shiftId;
        } else {
            const win = consolidateScheduledHours(e.set) || { start: null, end: null, total: e.set.size };
            unmatched.push({
                tableKey: key, gametype: e.gametype, table: e.table,
                start: win.start, end: win.end, total: win.total, iou: Number(iou.toFixed(2)),
            });
        }
    }
    return { assignments, unmatched };
}

// ---------------------------------------------------------------------
// Inverse — expand per-table SHIFT assignments back into per-(table,hour)
// binary spread rows for a date, ready to upload to the spread DB.
//
// For each assigned table we emit 24 rows (hours 0..23) with spread = 1
// when the shift covers that hour, else 0. `date` is attributed to ALL
// 24 hours of the scheduling day (including the post-midnight tail) — the
// spread DB keys a plan by its scheduling DATE, so a shift running to
// 02:00 still belongs to the target date's plan. Adjust here if the DB
// attributes post-midnight hours to the next calendar day.
// ---------------------------------------------------------------------
export function expandAssignmentsToSpreadRows(date, assignments, shifts, tables, revisedDate = null) {
    const shiftMap = new Map((shifts || []).map((s) => [s.id, s]));
    const asg = assignments || {};
    // Emit a row for EVERY floor table × 24 hours so the DB gets a complete
    // open/closed picture (assigned → shift coverage; unassigned → all 0).
    // Falls back to the assigned keys when no table master is supplied.
    const list = (tables && tables.length)
        ? tables
        : Object.keys(asg).map((key) => {
            const sep = key.indexOf('|');
            return { key, gametype: sep >= 0 ? key.slice(0, sep) : '', table: sep >= 0 ? key.slice(sep + 1) : key };
        });
    const rows = [];
    for (const t of list) {
        const shift = shiftMap.get(asg[t.key]);
        const mask = shift ? shiftCoverageMask(shift) : null;
        for (let h = 0; h < 24; h++) {
            rows.push({
                date,
                hour: h,
                gametype: String(t.gametype ?? ''),
                table: String(t.table ?? ''),
                segment: t.segment ?? null,
                sub_segment: t.sub_segment ?? null,
                spread: mask && mask[h] ? 1 : 0,    // 1 = open, 0 = closed
                revised_date: revisedDate,
            });
        }
    }
    return rows;
}
