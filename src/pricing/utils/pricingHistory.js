// pricingHistory — suggest minimums from each table's HISTORICAL minimums
// =======================================================================
//
// A second flavour of "Suggest" that, instead of ranking demand, mines the
// table's OWN historical table-minimum readings over a chosen reference
// window (date range + optional day-of-week filter):
//
//   • base = the MODE (most-frequent) minimum the table actually ran
//   • min  = the LOWEST minimum observed in the window
//   • max  = the HIGHEST minimum observed in the window
//
// Source = the daily dataset's `tablemin` wire string ("500:2,1000:4" =
// "ran $500 for 2 weight, $1000 for 4"). Each $ value is then snapped to
// the nearest configured pricing tier.

import { gametypeTableKey, parseTablemin } from '../../performance/utils/dataSource';

// Day-of-week (0=Sun … 6=Sat) for an ISO date, parsed as UTC so the value
// never drifts with the local timezone.
export function dowOf(dateIso) {
    const [y, m, d] = String(dateIso || '').slice(0, 10).split('-').map(Number);
    if (!y || !m || !d) return null;
    return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export const DOW_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/**
 * Aggregate historical table-minimum readings per table over `rows`,
 * filtered to [from, to] and (optionally) a set of allowed weekdays.
 *
 * @returns Map<tableKey, { mode, min, max, days, readings }>
 */
export function aggregateHistoryMin(rows, { from = null, to = null, dows = null, hours = null } = {}) {
    const dowSet = dows && dows.length ? new Set(dows) : null;
    // `hours` is an explicit list of hours (0..23) to include — supports
    // NON-consecutive selections (e.g. [3, 5, 22]). null/empty = all hours.
    // (A legacy { from, to } range object is still accepted for safety.)
    const hourSet = Array.isArray(hours) && hours.length ? new Set(hours.map(Number)) : null;
    const hourOk = (h) => {
        const v = Number(h);
        if (!Number.isFinite(v)) return false;
        if (hourSet) return hourSet.has(v);
        if (hours && !Array.isArray(hours) && hours.from != null && hours.to != null) {
            return hours.from <= hours.to
                ? (v >= hours.from && v <= hours.to)
                : (v >= hours.from || v <= hours.to);
        }
        return true;
    };
    const acc = new Map(); // key -> { hist:{minVal:weight}, dates:Set }

    for (const r of rows || []) {
        const date = String(r.date || '').slice(0, 10);
        if (!date) continue;
        if (from && date < from) continue;
        if (to && date > to) continue;
        if (dowSet) {
            const dw = dowOf(date);
            if (dw == null || !dowSet.has(dw)) continue;
        }
        if (hours && !hourOk(r.hour)) continue;
        const hist = parseTablemin(r.tablemin);
        const keys = Object.keys(hist);
        if (!keys.length) continue;

        const key = gametypeTableKey(r.gametype, r.table);
        let e = acc.get(key);
        if (!e) { e = { hist: {}, dates: new Set() }; acc.set(key, e); }
        for (const k of keys) e.hist[k] = (e.hist[k] || 0) + hist[k];
        e.dates.add(date);
    }

    const out = new Map();
    for (const [key, e] of acc) {
        const vals = Object.keys(e.hist).map(Number).filter((v) => v > 0);
        if (!vals.length) continue;
        // mode = highest accumulated weight; ties resolved to the larger
        // minimum (same convention as tableMinimumMode in dataSource).
        let mode = 0, best = -Infinity, readings = 0;
        for (const k of Object.keys(e.hist)) {
            const v = Number(k), w = e.hist[k];
            if (v <= 0) continue;
            readings += w;
            if (w > best || (w === best && v > mode)) { best = w; mode = v; }
        }
        out.set(key, {
            mode,
            min: Math.min(...vals),
            max: Math.max(...vals),
            days: e.dates.size,
            readings,
        });
    }
    return out;
}

// Snap a dollar amount to the nearest tier id (min |tier.min − value|).
export function snapToTier(value, tiers) {
    if (!tiers || !tiers.length) return null;
    let best = tiers[0], bestD = Infinity;
    for (const t of tiers) {
        const d = Math.abs(Number(t.min) - Number(value));
        if (d < bestD) { bestD = d; best = t; }
    }
    return best.id;
}

/**
 * Turn history aggregates into per-table { base, min, max } tier triples.
 * base = mode tier; min/max = the observed-low/high tiers, clamped so the
 * boundary always encloses the base (min ≤ base ≤ max by tier rank).
 *
 * @returns Map<tableKey, { base, min, max, days, modeRaw, minRaw, maxRaw }>
 */
export function buildHistorySuggestions(historyMap, tiers) {
    const rank = new Map((tiers || []).map((t, i) => [t.id, i]));
    const out = new Map();
    for (const [key, h] of historyMap) {
        const base = snapToTier(h.mode, tiers);
        const loId = snapToTier(h.min, tiers);
        const hiId = snapToTier(h.max, tiers);
        const baseR = rank.get(base) ?? 0;
        const loR = Math.min(rank.get(loId) ?? baseR, baseR);
        const hiR = Math.max(rank.get(hiId) ?? baseR, baseR);
        out.set(key, {
            base,
            min: tiers[loR].id,
            max: tiers[hiR].id,
            days: h.days,
            modeRaw: h.mode,
            minRaw: h.min,
            maxRaw: h.max,
        });
    }
    return out;
}
