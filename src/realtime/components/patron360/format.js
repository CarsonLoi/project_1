// Player 360 — formatters, labels and colour maps shared by its sections.

import { PATRON_360 } from '../../constants/rtConfig';
import { STATE, TEXT, SURFACE } from '../../constants/rtTheme';
import { OPTION_BY_CODE } from '../../utils/patron360';

const ok = (v) => v != null && Number.isFinite(v);

// Signed money: +$1.2K / −$950. Patron perspective at every call site.
export const money = (v) => {
    if (!ok(v)) return '—';
    const a = Math.abs(v), s = v < 0 ? '−' : v > 0 ? '+' : '';
    if (a >= 1e6) return `${s}$${(a / 1e6).toFixed(2)}M`;
    if (a >= 1e3) return `${s}$${(a / 1e3).toFixed(a >= 1e4 ? 0 : 1)}K`;
    return `${s}$${Math.round(a)}`;
};
export const plain = (v) => money(v).replace('+', '');
export const signColor = (v) => (!ok(v) || v === 0 ? TEXT.muted : v < 0 ? STATE.negative : STATE.positive);
export const pct = (v, d = 1) => (ok(v) ? `${v < 0 ? '−' : ''}${Math.abs(v).toFixed(d)}%` : '—');
export const share = (v) => (ok(v) ? `${(v * 100).toFixed(v > 0 && v < 0.1 ? 1 : 0)}%` : '—');
export const int = (v) => (ok(v) ? Math.round(v).toLocaleString() : '—');

export const optionColor = (code) => (OPTION_BY_CODE.get(code) || {}).color || '#8a93b2';

export const LEVEL_COLOR = { ACTION: STATE.negative, WATCH: STATE.warning, CLEAR: STATE.positive, 'NO DATA': TEXT.muted };

export const STATE_STYLE = {
    flag: { label: 'FLAG', color: STATE.negative, bg: STATE.negativeBg },
    watch: { label: 'WATCH', color: STATE.warning, bg: STATE.warningBg },
    clear: { label: 'CLEAR', color: STATE.positive, bg: STATE.positiveBg },
    insufficient: { label: 'NO DATA', color: TEXT.muted, bg: 'rgba(255,255,255,0.04)' },
};

// Magenta = the cards favour the player — the same meaning as on the
// floor map's house-edge colours.
export const EDGE_COLORS = {
    deep: 'rgb(255,0,200)',
    player: 'rgb(214,92,255)',
    thin: '#e0af68',
    mid: '#58628c',
    house: '#333d68',          // light enough to read as a bar on the dark panel
};

// Heatmap bands relative to the option's theo, so a Banker cell and an
// SL7 cell read the same way.
export function edgeBands(theo) {
    const deep = -Math.max(1, theo / 3);
    const half = theo / 2;
    return [
        { lt: deep, color: EDGE_COLORS.deep, label: `below ${pct(deep)}` },
        { gte: deep, lt: 0, color: EDGE_COLORS.player, label: `${pct(deep)} to 0%` },
        { gte: 0, lt: half, color: EDGE_COLORS.thin, label: `0 to ${pct(half)}` },
        { gte: half, lt: theo, color: EDGE_COLORS.mid, label: `${pct(half)} to ${pct(theo)}` },
        { gte: theo, color: EDGE_COLORS.house, label: `${pct(theo)}+ (theo)` },
    ];
}

export const SHOE_COLORS = ['#7aa2f7', '#f2c14e', '#6ad08f', '#ff7eb6', '#7dcfff', '#ff9e64', '#c0a6ff', '#e6e6e6'];

const shortShoe = (id) => {
    const s = String(id ?? '');
    return s.length > 12 ? `…${s.slice(-8)}` : s;
};
export const shoeLabel = (v) => `${String(v.date || '').slice(5)} · ${v.tableKey} · ${shortShoe(v.shoeId)}`;

export function formatTestValue(unit, v) {
    if (v === Infinity) return '∞';
    if (!ok(v)) return '—';
    if (unit === 'x') return `${v.toFixed(1)}×`;
    if (unit === 'sd') return `${v < 0 ? '−' : '+'}${Math.abs(v).toFixed(1)} SD`;
    return String(v);
}

export function thresholdHint(id, unit) {
    const t = PATRON_360.TESTS[id];
    return `watch ≥ ${formatTestValue(unit, t.watch)} · flag ≥ ${formatTestValue(unit, t.flag)}`;
}

// State glyphs so a state never depends on colour alone.
export const STATE_GLYPH = { flag: '▲', watch: '◆', clear: '✓', insufficient: '' };

export const panelSx = { borderRadius: 2, border: `1px solid ${SURFACE.panelBorder}`, bgcolor: SURFACE.panel, p: 1.75, minWidth: 0 };
export const raisedSx = { ...panelSx, border: `1px solid ${SURFACE.raisedBorder}`, bgcolor: SURFACE.raised };

// Short axis/legend label for an edge band: "< −4.9%", "0–7.4%", "≥ 14.8%".
export function bandTick(b) {
    const n = (v) => `${v < 0 ? '−' : ''}${Math.abs(v).toFixed(1).replace(/\.0$/, '')}`;
    if (b.gte == null) return `< ${n(b.lt)}%`;
    if (b.lt == null) return `≥ ${n(b.gte)}%`;
    return `${n(b.gte)}–${n(b.lt)}%`;
}
