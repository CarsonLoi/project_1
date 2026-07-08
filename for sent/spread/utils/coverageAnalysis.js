// Coverage analysis
// =================
//
// Given a version's assignments + the shift library, compute per-hour
// totals (how many tables are open at hour H) and flag gaps. Drives
// the CoverageReport bar chart and the "low-coverage hour" warning.

import { shiftCoversHour } from './shiftCoverage';

// Returns:
//   {
//     totals:  number[24]    — count of tables covered at each hour
//     gaps:    number[]      — hours where total === 0 (or < threshold)
//     peakHour, peakValue
//   }
export function computeCoverage(assignments, shifts, tables, opts = {}) {
    const lowThreshold = opts.lowThreshold ?? 1;
    const totals = new Array(24).fill(0);
    const shiftMap = new Map(shifts.map((s) => [s.id, s]));
    const tableKeys = new Set(tables.map((t) => t.key));

    for (const [tableKey, shiftId] of Object.entries(assignments || {})) {
        if (!tableKeys.has(tableKey)) continue;   // stale table — skip
        const shift = shiftMap.get(shiftId);
        if (!shift) continue;                     // stale shift — skip
        for (let h = 0; h < 24; h++) {
            if (shiftCoversHour(shift, h)) totals[h] += 1;
        }
    }

    let peakHour = 0;
    let peakValue = 0;
    const gaps = [];
    for (let h = 0; h < 24; h++) {
        if (totals[h] > peakValue) { peakValue = totals[h]; peakHour = h; }
        if (totals[h] < lowThreshold) gaps.push(h);
    }

    return { totals, gaps, peakHour, peakValue };
}

// Per-shift assignment counts — used by ShiftLibrary's usage badges
// ("8 tables on shift B") and by the AssignmentPanel sidebar.
export function assignmentCountsByShift(assignments) {
    const out = {};
    for (const shiftId of Object.values(assignments || {})) {
        out[shiftId] = (out[shiftId] || 0) + 1;
    }
    return out;
}
