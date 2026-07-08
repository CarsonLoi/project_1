// Plan-vs-Plan diff (pricing) — variance between two pricing plans
// ================================================================
//
// Cloned from the scheduling planDiff so the pricing Compare view does not
// depend on the spread module. Plan A is the BASE; Plan B is compared
// against it. Status is "what did B do relative to A":
//   • unchanged  — same value assigned in both A and B
//   • reassigned — assigned in both, but a DIFFERENT value
//   • added      — assigned in B, NOT in A
//   • removed    — assigned in A, NOT in B
//
// DiffFloorMap colors each table by the COLOR of the synthetic status
// "shift" it's assigned, so the variance paints for free. See diffMapInputs.

export const DIFF_STATUS = {
    unchanged:  { id: 'unchanged',  name: 'Unchanged',  color: 'rgba(120, 130, 145, 0.5)' },
    reassigned: { id: 'reassigned', name: 'Reassigned', color: '#e0af68' },
    added:      { id: 'added',      name: 'Added by B',  color: '#9ece6a' },
    removed:    { id: 'removed',    name: 'Removed by B', color: '#f7768e' },
};

export const DIFF_SYNTHETIC_SHIFTS = [
    DIFF_STATUS.unchanged,
    DIFF_STATUS.reassigned,
    DIFF_STATUS.added,
    DIFF_STATUS.removed,
];

// Per-table status map (base = A, compared = B). Values are compared by
// their stable signature so a {base,min,max} change counts as reassigned.
function sig(v) {
    if (v == null) return null;
    if (typeof v === 'string') return v;
    if (typeof v === 'object') return `${v.base || v.lo || ''}|${v.min || ''}|${v.max || v.hi || ''}|${v.fixed ? 'F' : ''}`;
    return String(v);
}

export function planDiff(aAssign, bAssign) {
    const a = aAssign || {};
    const b = bAssign || {};
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    const statusByKey = {};
    const counts = { unchanged: 0, reassigned: 0, added: 0, removed: 0 };

    for (const k of keys) {
        const inA = Object.prototype.hasOwnProperty.call(a, k);
        const inB = Object.prototype.hasOwnProperty.call(b, k);
        let status;
        if (inA && inB)      status = (sig(a[k]) === sig(b[k])) ? 'unchanged' : 'reassigned';
        else if (inB)        status = 'added';
        else                 status = 'removed';
        statusByKey[k] = status;
        counts[status] += 1;
    }

    return { statusByKey, counts };
}

// Everything DiffFloorMap needs to render the diff.
export function diffMapInputs(aAssign, bAssign) {
    const { statusByKey, counts } = planDiff(aAssign, bAssign);
    return {
        shifts: DIFF_SYNTHETIC_SHIFTS,
        assignments: statusByKey,
        counts,
        touched: Object.keys(statusByKey).length,
        differing: counts.reassigned + counts.added + counts.removed,
    };
}
