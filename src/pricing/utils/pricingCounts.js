// Pricing Summary counts — plan vs historical-actual table-minimum mix
// ====================================================================
//
// The Summary table can count tables-by-minimum on three bases:
//   • hour   — the selected hour only
//   • period — averaged over the hours of the selected hour's period
//   • day    — averaged over the whole gaming day (07:00 → 06:00)
//
// and in three display modes: by macro segment (MS/PM), by sub-segment, or
// a COMPARISON of the current plan against the historical ACTUAL minimum
// (prior 4 weeks, same weekday/weekend bucket). Counts are AVERAGED per
// hour so the three bases are directly comparable, and only tables
// scheduled OPEN at each hour are counted.

import { readPrice } from './pricingModel';
import { getDaypartAssignments } from './pricingStorage';
import { gametypeTableKey, parseTablemin } from '../../performance/utils/dataSource';

export const GAMING_HOURS_P = [7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 0, 1, 2, 3, 4, 5, 6];

// Which hours a basis covers.
//   hour   → the selected hour    period → the selected hour's period
//   multi  → the user-picked hours  day   → the whole gaming day
export function hoursForBasis(basis, scrubHour, periodHours, multiHours) {
    if (basis === 'hour') return [scrubHour];
    if (basis === 'period') return periodHours && periodHours.length ? periodHours : [scrubHour];
    if (basis === 'multi') return (multiHours && multiHours.length) ? [...multiHours] : [scrubHour];
    return [...GAMING_HOURS_P];
}

// All dates in [fromIso, toIso] (inclusive) whose weekday is in `dows`
// (0=Sun … 6=Sat). Empty/falsy `dows` → every date in the range. UTC-safe.
export function datesInRangeByDow(fromIso, toIso, dows) {
    const out = [];
    let cur = new Date(String(fromIso).slice(0, 10) + 'T00:00:00Z');
    const end = new Date(String(toIso).slice(0, 10) + 'T00:00:00Z');
    if ([cur, end].some((d) => Number.isNaN(d.getTime())) || cur > end) return out;
    const set = (dows && dows.length) ? new Set(dows.map(Number)) : null;
    for (; cur.getTime() <= end.getTime(); cur = new Date(cur.getTime() + 86400000)) {
        if (!set || set.has(cur.getUTCDay())) out.push(cur.toISOString().slice(0, 10));
    }
    return out;
}

export const DOW_LABELS_P = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
// Default weekday/weekend bucket for a date (UTC): weekend = [Sun, Sat].
export function defaultDowsForDate(dateIso) {
    const d = new Date(String(dateIso).slice(0, 10) + 'T00:00:00Z');
    if (Number.isNaN(d.getTime())) return [1, 2, 3, 4, 5];
    return [0, 6].includes(d.getUTCDay()) ? [0, 6] : [1, 2, 3, 4, 5];
}

// Snap a $ minimum to the nearest tier id.
export function snapMinToTier(min, sortedTiers) {
    if (!sortedTiers.length) return null;
    let best = sortedTiers[0].id, bestD = Infinity;
    for (const t of sortedTiers) { const d = Math.abs((t.min || 0) - Number(min)); if (d < bestD) { bestD = d; best = t.id; } }
    return best;
}

// Mode (most-frequent) minimum from a tablemin histogram string.
function modeMin(tablemin) {
    const h = parseTablemin(tablemin);
    let best = 0, bestW = -Infinity;
    for (const k of Object.keys(h)) {
        const v = Number(k), w = h[k];
        if (v > 0 && (w > bestW || (w === bestW && v > best))) { bestW = w; best = v; }
    }
    return best;
}

// CURRENT PLAN counts → Map<tierId, { All, [group]: n }> + totals +
// UNASSIGNED (open but unpriced), AVERAGED per hour. Iterates EVERY table in
// `groupMap` and counts the ones scheduled OPEN that hour: priced → its tier,
// unpriced → unassigned. `keyOk` / `shiftOk` are optional row filters.
export function planCountsGrid({ store, date, hours, openByHour, groupMap, groups, keyOk, shiftOk, sortedTiers }) {
    const blank = () => { const o = { All: 0 }; for (const g of groups) o[g] = 0; return o; };
    const byTier = new Map(sortedTiers.map((t) => [t.id, blank()]));
    const totals = blank();
    const unassigned = blank();
    const gset = new Set(groups);
    for (const h of hours) {
        const a = getDaypartAssignments(store, date, `h_${h}`);
        // No schedule → nothing open (matches the all-black floor).
        const open = openByHour ? (openByHour.get(h) || new Set()) : new Set();
        for (const [k, g] of groupMap) {
            if (keyOk && !keyOk(k)) continue;
            if (shiftOk && !shiftOk(k)) continue;
            if (!open.has(k)) continue;            // closed this hour → skip
            const inG = gset.has(g);
            const p = readPrice(a[k]);
            const bucket = p ? byTier.get(p.base) : null;
            if (bucket) {
                bucket.All += 1; if (inG) bucket[g] += 1;
                totals.All += 1; if (inG) totals[g] += 1;
            } else {
                unassigned.All += 1; if (inG) unassigned[g] += 1;
            }
        }
    }
    const n = hours.length || 1;
    for (const o of byTier.values()) for (const c of [...groups, 'All']) o[c] /= n;
    for (const c of [...groups, 'All']) { totals[c] /= n; unassigned[c] /= n; }
    return { byTier, totals, unassigned };
}

// Derive each table's SHIFT (its scheduled open window) from openByHour for a
// date → { shiftByKey: Map<key,label>, shifts: [label] }. A shift label is the
// table's first→last open hour in gaming-day order, e.g. "07:00–15:00".
export function deriveShiftsFromOpen(openByHour) {
    const shiftByKey = new Map();
    if (!openByHour) return { shiftByKey, shifts: [] };
    const hoursByKey = new Map();
    for (const [h, set] of openByHour) {
        for (const k of set) {
            let s = hoursByKey.get(k);
            if (!s) { s = new Set(); hoursByKey.set(k, s); }
            s.add(Number(h));
        }
    }
    const pad = (h) => String(h).padStart(2, '0');
    const labels = new Set();
    for (const [k, hrs] of hoursByKey) {
        const idxs = GAMING_HOURS_P.map((h, i) => (hrs.has(h) ? i : -1)).filter((i) => i >= 0);
        if (!idxs.length) continue;
        const start = GAMING_HOURS_P[idxs[0]];
        const endHour = GAMING_HOURS_P[(idxs[idxs.length - 1] + 1) % 24];
        const label = `${pad(start)}:00–${pad(endHour)}:00`;
        shiftByKey.set(k, label);
        labels.add(label);
    }
    const startIdx = (lbl) => GAMING_HOURS_P.indexOf(parseInt(lbl.slice(0, 2), 10));
    return { shiftByKey, shifts: [...labels].sort((a, b) => startIdx(a) - startIdx(b)) };
}

// HISTORICAL ACTUAL counts → Map<tierId, avgCount> + total, AVERAGED per
// (date × hour) sample. `rows` = hourly performance rows (date, hour,
// gametype, table, spread, tablemin). Only spread=1 (scheduled open) rows
// count; each table's actual minimum = the MODE of its tablemin histogram.
export function actualCountsByTier({ rows, dates, hours, keyOk, sortedTiers }) {
    const dateSet = new Set(dates);
    const hourSet = new Set(hours);
    const byTier = new Map(sortedTiers.map((t) => [t.id, 0]));
    let total = 0;
    for (const r of rows || []) {
        if (Number(r.spread) !== 1) continue;
        const d = String(r.date).slice(0, 10);
        if (!dateSet.has(d)) continue;
        if (!hourSet.has(Number(r.hour))) continue;
        const key = gametypeTableKey(r.gametype, r.table);
        if (keyOk && !keyOk(key)) continue;
        const m = modeMin(r.tablemin);
        if (!(m > 0)) continue;
        const tid = snapMinToTier(m, sortedTiers);
        if (byTier.has(tid)) { byTier.set(tid, byTier.get(tid) + 1); total += 1; }
    }
    // Average per hour-sample so it's comparable to the plan's per-hour avg.
    const samples = Math.max(1, dates.length) * Math.max(1, hours.length);
    for (const [k, v] of byTier) byTier.set(k, v / samples);
    return { byTier, total: total / samples };
}

// Reference dates within [fromIso, toIso] (inclusive) that fall in the SAME
// weekday/weekend bucket as `refDateIso`. Used by the comparison's
// from/to range picker. Parsed as UTC so the weekday never rolls.
export function sameKindDatesInRange(refDateIso, fromIso, toIso) {
    const out = [];
    const ref = new Date(String(refDateIso).slice(0, 10) + 'T00:00:00Z');
    let cur = new Date(String(fromIso).slice(0, 10) + 'T00:00:00Z');
    const end = new Date(String(toIso).slice(0, 10) + 'T00:00:00Z');
    if ([ref, cur, end].some((d) => Number.isNaN(d.getTime())) || cur > end) return out;
    const refWeekend = [0, 6].includes(ref.getUTCDay());
    for (; cur.getTime() <= end.getTime(); cur = new Date(cur.getTime() + 86400000)) {
        if ([0, 6].includes(cur.getUTCDay()) === refWeekend) out.push(cur.toISOString().slice(0, 10));
    }
    return out;
}

// Prior-N-week reference dates in the SAME weekday/weekend bucket as `date`.
export function sameKindTrailingDates(dateIso, weeks = 4) {
    const out = [];
    const base = new Date(String(dateIso).slice(0, 10) + 'T00:00:00Z');
    if (Number.isNaN(base.getTime())) return out;
    const baseWeekend = [0, 6].includes(base.getUTCDay());
    for (let i = 1; i <= weeks * 7; i++) {
        const d = new Date(base.getTime() - i * 86400000);
        const weekend = [0, 6].includes(d.getUTCDay());
        if (weekend === baseWeekend) out.push(d.toISOString().slice(0, 10));
    }
    return out;
}
