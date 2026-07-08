// Spread Comparison utilities
// ===========================
//
// Pure functions that diff two ScheduleVersions for the SpreadComparePanel.
// All inputs are plain data (assignments map, tables list, shifts list);
// no React, no MUI — easy to unit-test, easy to compose.
//
// "target" = the version currently being edited
// "ref"    = the reference version the user picked
//
// Most functions return a serialisable object the UI can render verbatim.

import { shiftCoversHour, shiftLengthHours } from './shiftCoverage';

// ---------------------------------------------------------------------
// 1. Per-shift table counts (target vs reference)
// ---------------------------------------------------------------------
//
// Returns:
//   [
//     { shiftId: 'B', shiftName, color, targetCount, refCount, delta },
//     ...
//     { shiftId: '__none', shiftName: 'Unassigned', ...},
//   ]
// Sorted by absolute delta descending so the biggest changes float up.
export function shiftCounts(targetAssignments, refAssignments, shifts) {
    const targetTally = new Map();
    const refTally    = new Map();
    for (const sid of Object.values(targetAssignments || {})) {
        targetTally.set(sid, (targetTally.get(sid) || 0) + 1);
    }
    for (const sid of Object.values(refAssignments || {})) {
        refTally.set(sid, (refTally.get(sid) || 0) + 1);
    }
    // Include unassigned-by-omission so a table that lost its shift
    // shows up under the special '__none' row. Tables COUNTED here are
    // those that appear in EITHER plan's tableSnapshot (we don't have
    // it here directly, so use the assignments key set as a proxy).
    const targetKeys = new Set(Object.keys(targetAssignments || {}));
    const refKeys    = new Set(Object.keys(refAssignments || {}));
    const targetUnassigned = [...refKeys].filter((k) => !targetKeys.has(k)).length;
    const refUnassigned    = [...targetKeys].filter((k) => !refKeys.has(k)).length;
    if (targetUnassigned || refUnassigned) {
        targetTally.set('__none', (targetTally.get('__none') || 0) + targetUnassigned);
        refTally.set('__none',    (refTally.get('__none')    || 0) + refUnassigned);
    }

    const shiftMap = new Map((shifts || []).map((s) => [s.id, s]));
    const allShiftIds = new Set([...targetTally.keys(), ...refTally.keys()]);
    const rows = [...allShiftIds].map((sid) => {
        const t = targetTally.get(sid) || 0;
        const r = refTally.get(sid)    || 0;
        const meta = sid === '__none'
            ? { name: 'Unassigned', color: 'rgba(120, 130, 145, 0.45)' }
            : shiftMap.get(sid) || { name: sid, color: '#7aa2f7' };
        return {
            shiftId:     sid,
            shiftName:   meta.name,
            color:       meta.color,
            targetCount: t,
            refCount:    r,
            delta:       t - r,
        };
    });
    rows.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
    return rows;
}

// ---------------------------------------------------------------------
// 2. Change matrix — per-table reassignment counts (from-shift × to-shift)
// ---------------------------------------------------------------------
//
// Returns:
//   {
//     rows: shiftIds ordered by total movement away from them
//     cols: shiftIds ordered by total movement INTO them
//     cell(from, to) -> count
//     totalChanged: number of tables whose shift changed at all
//   }
//
// Only tables present in BOTH plans are counted (added / removed tables
// belong to the addedRemoved bucket, not the matrix). The diagonal (from
// === to) means "stayed on same shift" — still useful context.
export function changeMatrix(targetAssignments, refAssignments) {
    const sharedKeys = Object.keys(refAssignments || {}).filter(
        (k) => Object.prototype.hasOwnProperty.call(targetAssignments || {}, k)
    );
    const cells = new Map(); // 'from|to' -> count
    let totalChanged = 0;
    for (const k of sharedKeys) {
        const from = refAssignments[k]    || '__none';
        const to   = targetAssignments[k] || '__none';
        const key  = from + '|' + to;
        cells.set(key, (cells.get(key) || 0) + 1);
        if (from !== to) totalChanged += 1;
    }
    const allFroms = new Set();
    const allTos   = new Set();
    for (const key of cells.keys()) {
        const [f, t] = key.split('|');
        allFroms.add(f);
        allTos.add(t);
    }
    return {
        rows: [...allFroms],
        cols: [...allTos],
        cell: (from, to) => cells.get(from + '|' + to) || 0,
        totalChanged,
    };
}

// ---------------------------------------------------------------------
// 3. Hourly coverage delta — open table count per hour, both plans
// ---------------------------------------------------------------------
//
// Returns 24 entries:
//   [{ hour: 0, target: N, ref: M, delta: N-M }, ...]
// Order is 0..23. Display side decides whether to render in
// gaming-day order (6, 7, ..., 5).
export function hourlyCoverage(targetAssignments, refAssignments, shifts) {
    const shiftMap = new Map((shifts || []).map((s) => [s.id, s]));
    const out = [];
    for (let h = 0; h < 24; h++) {
        let t = 0;
        let r = 0;
        for (const sid of Object.values(targetAssignments || {})) {
            const s = shiftMap.get(sid);
            if (s && shiftCoversHour(s, h)) t += 1;
        }
        for (const sid of Object.values(refAssignments || {})) {
            const s = shiftMap.get(sid);
            if (s && shiftCoversHour(s, h)) r += 1;
        }
        out.push({ hour: h, target: t, ref: r, delta: t - r });
    }
    return out;
}

// ---------------------------------------------------------------------
// 4. Peak / Trough coverage points per plan
// ---------------------------------------------------------------------
export function peakTrough(hourlyCov) {
    const peakTarget   = hourlyCov.reduce((b, c) => (c.target > b.target ? c : b), hourlyCov[0]);
    const troughTarget = hourlyCov.reduce((b, c) => (c.target < b.target ? c : b), hourlyCov[0]);
    const peakRef      = hourlyCov.reduce((b, c) => (c.ref    > b.ref    ? c : b), hourlyCov[0]);
    const troughRef    = hourlyCov.reduce((b, c) => (c.ref    < b.ref    ? c : b), hourlyCov[0]);
    return {
        target: { peakHour: peakTarget.hour,   peakValue: peakTarget.target,
                  troughHour: troughTarget.hour, troughValue: troughTarget.target },
        ref:    { peakHour: peakRef.hour,      peakValue: peakRef.ref,
                  troughHour: troughRef.hour,   troughValue: troughRef.ref },
    };
}

// ---------------------------------------------------------------------
// 5. Added / Removed / Reassigned table lists
// ---------------------------------------------------------------------
//
// "Added"      = table key present in target but not in ref (new
//                assignment that didn't exist before)
// "Removed"    = table key present in ref but not in target
// "Reassigned" = both present, but shiftId differs
export function tableLevelDelta(targetAssignments, refAssignments) {
    const tKeys = new Set(Object.keys(targetAssignments || {}));
    const rKeys = new Set(Object.keys(refAssignments    || {}));
    const added      = [];
    const removed    = [];
    const reassigned = [];
    for (const k of tKeys) {
        if (!rKeys.has(k)) {
            added.push({ tableKey: k, toShiftId: targetAssignments[k] });
        } else if (targetAssignments[k] !== refAssignments[k]) {
            reassigned.push({
                tableKey:    k,
                fromShiftId: refAssignments[k],
                toShiftId:   targetAssignments[k],
            });
        }
    }
    for (const k of rKeys) {
        if (!tKeys.has(k)) removed.push({ tableKey: k, fromShiftId: refAssignments[k] });
    }
    return { added, removed, reassigned };
}

// ---------------------------------------------------------------------
// 6. Total scheduled table-hours — Σ over assignments of shiftLengthHours
// ---------------------------------------------------------------------
//
// The labour-cost proxy. If the target uses shorter shifts than the
// reference, total table-hours go down (and so does cost).
export function totalTableHours(assignments, shifts) {
    const shiftMap = new Map((shifts || []).map((s) => [s.id, s]));
    let sum = 0;
    for (const sid of Object.values(assignments || {})) {
        const s = shiftMap.get(sid);
        if (s) sum += shiftLengthHours(s);
    }
    return sum;
}

// ---------------------------------------------------------------------
// 7. Per-sub_segment shift breakdown delta
// ---------------------------------------------------------------------
//
// Splits the floor by sub_segment (legend column), then runs shiftCounts
// inside each. The UI renders one column per (sub_segment, shift) pair.
//
// Returns:
//   {
//     subSegments: ['MS', '871', '888', ...],
//     rows: [ { shiftId, shiftName, color,
//              perSeg: { [subSeg]: { target, ref, delta } } } ]
//   }
export function subSegmentBreakdown(targetAssignments, refAssignments, shifts, tables) {
    const segByTable = new Map();
    for (const t of tables || []) {
        if (t && t.key) segByTable.set(t.key, t.sub_segment || t.area || '—');
    }
    const subSegSet = new Set();
    const tally = new Map(); // key 'shiftId|seg' -> { t, r }
    const bump = (sid, seg, side) => {
        const key = sid + '|' + seg;
        if (!tally.has(key)) tally.set(key, { t: 0, r: 0 });
        tally.get(key)[side] += 1;
    };
    for (const [tableKey, sid] of Object.entries(targetAssignments || {})) {
        const seg = segByTable.get(tableKey) || '—';
        subSegSet.add(seg);
        bump(sid, seg, 't');
    }
    for (const [tableKey, sid] of Object.entries(refAssignments || {})) {
        const seg = segByTable.get(tableKey) || '—';
        subSegSet.add(seg);
        bump(sid, seg, 'r');
    }
    const shiftMap = new Map((shifts || []).map((s) => [s.id, s]));
    const shiftIds = new Set([
        ...Object.values(targetAssignments || {}),
        ...Object.values(refAssignments    || {}),
    ]);
    const subSegments = [...subSegSet].sort();
    const rows = [...shiftIds].map((sid) => {
        const meta = shiftMap.get(sid) || { name: sid, color: '#7aa2f7' };
        const perSeg = {};
        let totalDelta = 0;
        for (const seg of subSegments) {
            const e = tally.get(sid + '|' + seg) || { t: 0, r: 0 };
            perSeg[seg] = { target: e.t, ref: e.r, delta: e.t - e.r };
            totalDelta += Math.abs(e.t - e.r);
        }
        return {
            shiftId:   sid,
            shiftName: meta.name,
            color:     meta.color,
            perSeg,
            totalDelta,
        };
    });
    rows.sort((a, b) => b.totalDelta - a.totalDelta);
    return { subSegments, rows };
}

// ---------------------------------------------------------------------
// 8. Shift-length distribution — % of tables on 24h / 16h / 8h shifts
// ---------------------------------------------------------------------
export function shiftLengthDistribution(assignments, shifts) {
    const shiftMap = new Map((shifts || []).map((s) => [s.id, s]));
    const buckets = { '24h': 0, '16h': 0, '8h': 0, 'custom': 0 };
    let total = 0;
    for (const sid of Object.values(assignments || {})) {
        const s = shiftMap.get(sid);
        if (!s) continue;
        total += 1;
        const len = shiftLengthHours(s);
        if (len >= 24)      buckets['24h']    += 1;
        else if (len >= 16) buckets['16h']    += 1;
        else if (len === 8) buckets['8h']     += 1;
        else                buckets['custom'] += 1;
    }
    const pct = {};
    for (const k of Object.keys(buckets)) {
        pct[k] = total > 0 ? (buckets[k] / total) * 100 : 0;
    }
    return { buckets, pct, total };
}

// ---------------------------------------------------------------------
// Top-level compose — one call gets the panel everything it needs
// ---------------------------------------------------------------------
export function buildComparePayload(target, ref, shifts, tables) {
    const tA = (target && target.assignments) || {};
    const rA = (ref    && ref.assignments)    || {};
    const hourly = hourlyCoverage(tA, rA, shifts);
    return {
        shiftCounts:        shiftCounts(tA, rA, shifts),
        changeMatrix:       changeMatrix(tA, rA),
        hourlyCoverage:     hourly,
        peakTrough:         peakTrough(hourly),
        tableLevelDelta:    tableLevelDelta(tA, rA),
        totalTableHours: {
            target: totalTableHours(tA, shifts),
            ref:    totalTableHours(rA, shifts),
        },
        subSegmentBreakdown: subSegmentBreakdown(tA, rA, shifts, tables),
        shiftLengthDistribution: {
            target: shiftLengthDistribution(tA, shifts),
            ref:    shiftLengthDistribution(rA, shifts),
        },
        meta: {
            targetTableCount: Object.keys(tA).length,
            refTableCount:    Object.keys(rA).length,
        },
    };
}
