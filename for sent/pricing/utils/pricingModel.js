// Pricing assignment model — base price + adjustable [Min, Max] boundary
// ======================================================================
//
// Each table's assignment in a (date × daypart) plan is THREE tiers:
//   • base — the OPENING minimum the table is set to when it first opens
//   • min  — the lowest minimum operations may drop to during the day
//   • max  — the highest minimum operations may raise to
//
// Invariant: min ≤ base ≤ max. A table with no flex is simply
// min === base === max. The plan hands operations a starting price plus a
// guardrail; ops slides the live minimum within [min, max] as floor
// business dictates.
//
// All three reference the tier library (which carries the $ value + color).
// Backward compatible: a bare tier-id string reads as a fixed price, and
// an older { lo, hi } range reads as base=min=lo, max=hi — so no
// destructive migration of existing plans is needed.

// Normalize any stored value into { base, min, max, fixed } tier-id triple
// (or null). `fixed` marks a table whose minimum operations may NOT change
// during the day (no dynamic pricing) — it always reads min === max === base.
export function readPrice(v) {
    if (v == null) return null;
    if (typeof v === 'string') return { base: v, min: v, max: v, fixed: false };
    if (typeof v === 'object') {
        if (v.fixed && v.base) return { base: v.base, min: v.base, max: v.base, fixed: true };
        if (v.base) return { base: v.base, min: v.min || v.base, max: v.max || v.base, fixed: false };
        if (v.lo)   return { base: v.lo,  min: v.lo,            max: v.hi || v.lo, fixed: false }; // legacy range
    }
    return null;
}

// True when ops has room to move (Min < Max) — never for fixed-price tables.
export function isFlexible(v) {
    const p = readPrice(v);
    return !!p && !p.fixed && p.min !== p.max;
}

// True when the table is marked fixed (locked, no dynamic pricing).
export function isFixed(v) {
    const p = readPrice(v);
    return !!p && !!p.fixed;
}

// Order a (min, base, max) id triple so min ≤ base ≤ max by tier $ value:
// swap min/max if inverted, then clamp base into the boundary.
export function orderTriple(tierMap, minId, baseId, maxId) {
    const val = (id) => tierMap.get(id)?.min ?? 0;
    let mn = minId, bs = baseId, mx = maxId;
    if (val(mn) > val(mx)) { const t = mn; mn = mx; mx = t; }
    if (val(bs) < val(mn)) bs = mn;
    if (val(bs) > val(mx)) bs = mx;
    return { min: mn, base: bs, max: mx };
}
