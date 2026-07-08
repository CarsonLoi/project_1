// Demand-informed pricing suggestion
// ==================================
//
// Turns recent floor performance into a suggested { base, min, max } band
// per table.
//
// Signal choice is driven by what the data actually carries. The bet-level
// fields (patron_hands, occupancy minutes) are NOT populated in this feed,
// so avg-bet / occupancy-% can't be computed. What IS populated per table:
// turnover, win, theo, drop, patronhrs, openhours, floorday. The cleanest
// spend/value proxy among them is:
//
//     value = theo / patronhrs   (theoretical win per patron-hour)
//
// — proportional to avg-bet × house-edge, so a table whose patron-hours are
// more valuable earns a higher minimum. We rank each table's value against
// the whole floor (PERCENTILE) and map that onto the tier ladder, which
// auto-scales to any data magnitude (no fragile absolute $ fractions). A
// mild occupancy nudge (patronhrs / openhours) bumps busy tables up a notch.
// Min/Max are ±N tier steps around the base, giving ops a flex boundary.

import { gametypeTableKey } from '../../performance/utils/dataSource';

export const SUGGEST_DEFAULTS = {
    boundarySteps: 1,   // Min/Max = base ∓ this many tier steps
    hiOcc: 0.9,         // patronhrs/openhours ≥ this → bump base up a tier
    loOcc: 0.35,        // ≤ this (and > 0) → drop base a tier
};

// Aggregate daily rows (already filtered to the reference window) into
// per-table demand signals, keyed by gametype+table (the SAME key the
// pricing floor uses).
export function aggregateDemandByTable(rows) {
    const acc = new Map();
    for (const r of rows || []) {
        const key = gametypeTableKey(r.gametype, r.table);
        if (!acc.has(key)) acc.set(key, { theo: 0, patronhrs: 0, openhours: 0 });
        const a = acc.get(key);
        a.theo      += Number(r.theo)      || 0;
        a.patronhrs += Number(r.patronhrs) || 0;
        a.openhours += Number(r.openhours) || 0;
    }
    const out = new Map();
    for (const [k, a] of acc) {
        out.set(k, {
            value:     a.patronhrs > 0 ? a.theo / a.patronhrs : 0,  // theo per patron-hour
            occupancy: a.openhours > 0 ? a.patronhrs / a.openhours : 0, // avg patrons present
        });
    }
    return out;
}

// Build per-table { base, min, max } tier-id suggestions by ranking each
// table's `value` against the cohort and mapping the percentile onto the
// sorted tier ladder. Returns Map<tableKey, {base,min,max}>.
export function buildSuggestions(demandMap, tiers, opts = {}) {
    const o = { ...SUGGEST_DEFAULTS, ...opts };
    const sortedTiers = [...(tiers || [])].sort((a, b) => (a.min || 0) - (b.min || 0));
    const out = new Map();
    if (!demandMap || sortedTiers.length === 0) return out;

    const values = [...demandMap.values()].map((s) => s.value).filter((v) => v > 0).sort((a, b) => a - b);
    if (values.length === 0) return out;

    // Fraction of the cohort ≤ v (0..1).
    const pctRank = (v) => {
        let lo = 0, hi = values.length;
        while (lo < hi) { const mid = (lo + hi) >> 1; if (values[mid] <= v) lo = mid + 1; else hi = mid; }
        return lo / values.length;
    };

    const N = sortedTiers.length;
    for (const [k, s] of demandMap) {
        if (!(s.value > 0)) continue;
        let idx = Math.round(pctRank(s.value) * (N - 1));
        if (s.occupancy >= o.hiOcc) idx = Math.min(N - 1, idx + 1);
        else if (s.occupancy > 0 && s.occupancy <= o.loOcc) idx = Math.max(0, idx - 1);
        const minIdx = Math.max(0, idx - o.boundarySteps);
        const maxIdx = Math.min(N - 1, idx + o.boundarySteps);
        out.set(k, { base: sortedTiers[idx].id, min: sortedTiers[minIdx].id, max: sortedTiers[maxIdx].id });
    }
    return out;
}

// Reference window: the last `weeks` occurrences of the planning date's
// weekday (D-7, D-14, …). Weekday-aware. Returns YYYY-MM-DD strings.
export function sameWeekdayTrailing(dateIso, weeks = 4) {
    const out = [];
    const base = new Date(dateIso + 'T00:00:00Z');
    if (isNaN(base.getTime())) return out;
    for (let w = 1; w <= weeks; w++) {
        const d = new Date(base.getTime() - w * 7 * 86400000);
        out.push(d.toISOString().slice(0, 10));
    }
    return out;
}
