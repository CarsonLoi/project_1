// Floor map colour bands — shared by the map and its filter legend.

import { RT_KPI_DIMS, HOUSE_EDGE_OPTIONS, DEFAULT_HOUSE_EDGE_BET, FIXED_GAMES } from '../constants/rtConfig';

export const tableKeyOf = (d) => `${d[66]}|${d[33]}`;
export const isInteractive = (d) => Array.isArray(d) && FIXED_GAMES.includes(d[66]) && d[16] !== '';

export function edgeOption(betOption) {
    return HOUSE_EDGE_OPTIONS.find((o) => o.label === betOption)
        || HOUSE_EDGE_OPTIONS.find((o) => o.label === DEFAULT_HOUSE_EDGE_BET);
}

export function mapDim(kpiKey, betOption) {
    return kpiKey === 'Actual House Edge' ? edgeOption(betOption).dim : RT_KPI_DIMS[kpiKey];
}

// Index of the ramp band holding `v`, or -1 (no data / off the scale).
export function bandIndex(ramp, v) {
    if (!ramp || typeof v !== 'number' || !Number.isFinite(v) || v === -1000000 || v === -999999) return -1;
    return ramp.findIndex((t) => (t.gte == null || v >= t.gte) && (t.lt == null || v < t.lt));
}

export function bandCounts(data, ramp, dim) {
    const counts = ramp ? ramp.map(() => 0) : [];
    let total = 0;
    for (const d of data || []) {
        if (!isInteractive(d)) continue;
        total += 1;
        const i = bandIndex(ramp, d[dim]);
        if (i >= 0) counts[i] += 1;
    }
    return { counts, total };
}

// "-100k - -25k" → "−100k – −25k"
export function bandLabel(label) {
    return String(label || '')
        .replace(/ - /g, ' – ')
        .replace(/(^|[\s(])-(?=\d)/g, '$1−');
}
