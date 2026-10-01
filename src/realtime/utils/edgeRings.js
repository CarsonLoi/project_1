// Edge rings — which tables get a ring on the floor map, and in what colours.
// ==========================================================================
// A table is ringed when its current shoe has dealt enough hands and one or
// more bet options' live house edge is below the threshold the operator set
// for that option. Pure functions; the settings dialog and the map share them.

import { PATRON_360 } from '../constants/rtConfig';

const { BET_OPTIONS } = PATRON_360;
const STORE_KEY = 'rt.ringSettings.v1';

// Tie and Super Lucky 7 swing hard hand to hand, so they only ring once the
// edge is clearly negative.
const LOOSER = { TIE: -2, SL7: -2 };

export const RING_DEFAULTS = Object.freeze({
    opts: Object.freeze(Object.fromEntries(BET_OPTIONS.map((o) => [
        o.code, Object.freeze({ on: true, below: LOOSER[o.code] ?? 0, color: o.color }),
    ]))),
    minHands: 10,
    pulse: true,
    labels: true,
    multi: 'segments',          // 'segments' | 'worst'
});

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const isColor = (v) => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v);

// Stored settings over defaults, field by field, so a bad or older value
// never breaks the map.
export function mergeRingSettings(stored) {
    const s = stored && typeof stored === 'object' ? stored : {};
    const opts = {};
    for (const o of BET_OPTIONS) {
        const d = RING_DEFAULTS.opts[o.code];
        const v = (s.opts && s.opts[o.code]) || {};
        opts[o.code] = {
            on: typeof v.on === 'boolean' ? v.on : d.on,
            below: isNum(v.below) ? v.below : d.below,
            color: isColor(v.color) ? v.color : d.color,
        };
    }
    return {
        opts,
        minHands: isNum(s.minHands) && s.minHands >= 0 ? Math.round(s.minHands) : RING_DEFAULTS.minHands,
        pulse: typeof s.pulse === 'boolean' ? s.pulse : RING_DEFAULTS.pulse,
        labels: typeof s.labels === 'boolean' ? s.labels : RING_DEFAULTS.labels,
        multi: s.multi === 'worst' || s.multi === 'segments' ? s.multi : RING_DEFAULTS.multi,
    };
}

export function loadRingSettings() {
    try { return mergeRingSettings(JSON.parse(localStorage.getItem(STORE_KEY) || 'null')); } catch { return mergeRingSettings(null); }
}
export function saveRingSettings(s) {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(s)); } catch { /* storage unavailable */ }
}

// Live edge per option code from a table row's house_edge_<edgeKey> columns.
export function edgesFromRow(row) {
    const out = {};
    for (const o of BET_OPTIONS) {
        const v = row ? row[`house_edge_${o.edgeKey}`] : null;
        out[o.code] = v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v);
    }
    return out;
}

// Options below their threshold, worst (furthest below) first.
export function ringsFor(edges, handsDealt, settings) {
    if (isNum(handsDealt) && handsDealt < settings.minHands) return [];
    const hits = [];
    for (const o of BET_OPTIONS) {
        const s = settings.opts[o.code];
        const e = edges[o.code];
        if (!s || !s.on || !isNum(e) || !(e < s.below)) continue;
        hits.push({ code: o.code, edge: e, gap: e - s.below, color: s.color });
    }
    return hits.sort((a, b) => a.gap - b.gap);
}

export function ringsByTable(rows, settings) {
    const m = new Map();
    for (const r of rows || []) {
        const hands = r.shoe_hands_dealt == null ? null : Number(r.shoe_hands_dealt);
        const hits = ringsFor(edgesFromRow(r), hands, settings);
        if (hits.length) m.set(`${r.gametype}|${r.table}`, hits);
    }
    return m;
}
