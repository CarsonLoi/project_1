// Plan-vs-Plan diff — variance between two spread plans
// =====================================================
//
// Powers the scheduling dashboard's "Compare" mode. Plan A is the BASE;
// Plan B is compared against it. Every status below is read as "what did
// B do relative to A":
//
//   • unchanged — same shift assigned in both A and B
//   • reassigned — assigned in both, but a DIFFERENT shift
//   • added     — assigned in B, NOT in A  (B opened a table A left closed)
//   • removed   — assigned in A, NOT in B  (B closed a table A had open)
//
// The clever bit: FloorScheduleMap colors each table by the COLOR of the
// shift it's assigned (colorMode 'shift'). So instead of teaching the map
// a new "diff" mode, we hand it a set of SYNTHETIC shifts — one per
// status — and a synthetic assignments map keyed table→status. The map
// then paints the variance for free. See diffMapInputs() below.

// Status ids double as synthetic-shift ids consumed by FloorScheduleMap.
export const DIFF_STATUS = {
    unchanged:  { id: 'unchanged',  name: 'Unchanged',  color: 'rgba(120, 130, 145, 0.5)' },
    reassigned: { id: 'reassigned', name: 'Reassigned', color: '#e0af68' },
    added:      { id: 'added',      name: 'Added by B',  color: '#9ece6a' },
    removed:    { id: 'removed',    name: 'Removed by B', color: '#f7768e' },
};

// The four synthetic "shifts" the floor map needs to color a diff. Order
// is the legend order (most-actionable last so red sits at the bottom of
// the count column the same way the eraser does in the palette).
export const DIFF_SYNTHETIC_SHIFTS = [
    DIFF_STATUS.unchanged,
    DIFF_STATUS.reassigned,
    DIFF_STATUS.added,
    DIFF_STATUS.removed,
];

// Per-table status map (base = A, compared = B).
//   returns { statusByKey: { [tableKey]: statusId }, counts: {...} }
// Only tables assigned in AT LEAST ONE plan get a status; tables closed
// in both are omitted (they render as the map's normal UNASSIGNED color).
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
        if (inA && inB)      status = (a[k] === b[k]) ? 'unchanged' : 'reassigned';
        else if (inB)        status = 'added';
        else                 status = 'removed';
        statusByKey[k] = status;
        counts[status] += 1;
    }

    return { statusByKey, counts };
}

// Convenience: everything FloorScheduleMap needs to render the diff.
//   shifts      → the four synthetic status shifts
//   assignments → table → statusId
export function diffMapInputs(aAssign, bAssign) {
    const { statusByKey, counts } = planDiff(aAssign, bAssign);
    return {
        shifts: DIFF_SYNTHETIC_SHIFTS,
        assignments: statusByKey,
        counts,
        // Total tables touched (open in either plan) — the denominator for
        // "X of Y tables differ".
        touched: Object.keys(statusByKey).length,
        // Tables that actually DIFFER (everything but unchanged).
        differing: counts.reassigned + counts.added + counts.removed,
    };
}
