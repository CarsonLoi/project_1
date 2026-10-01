// Surveillance floor map.
// =======================
// The floor, coloured by one metric (Casino Win, hand # or live house
// edge), with optional edge rings: a table whose current shoe has pushed a
// bet option's edge below the operator's threshold gets a ring — one arc
// per option in segmented mode. The colour key lives in an HTML legend
// under the map (RtMapLegend) that doubles as a filter, so the plot has no
// key gutter and the floor gets the whole panel.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as echarts from 'echarts';
import { Box, ButtonBase, Stack, Tooltip, Typography } from '@mui/material';
import TuneIcon from '@mui/icons-material/Tune';
import EventSeatIcon from '@mui/icons-material/EventSeat';
import CloseIcon from '@mui/icons-material/Close';
import { threshold_dict } from '../vendor/heatmapConstants';
import { HOUSE_EDGE_OPTIONS, PATRON_360 } from '../constants/rtConfig';
import { CARD_TIERS } from '../../live/constants/winPalette';
import { SEAT_TOOLTIP } from '../../live/constants/liveConfig';
import { ACCENT, STATE, TEXT } from '../constants/rtTheme';
import { tableKeyOf, isInteractive, mapDim, bandIndex } from '../utils/floorBands';

export { tableKeyOf };

const OUT_OF_RANGE = { color: '#3a3a3a', opacity: 0.35 };
const FADED = 0.12;
// Right gutter keeps the overlay buttons off the tables.
const MAP_GRID = { left: 14, right: 56, top: 26, bottom: 14, containLabel: false };

// Plot size at which the floor config's pixel sizes look right (the
// 1680px-wide layout). Symbols scale by the tighter of the two ratios.
const FIT_REF = { w: 780, h: 380 };
const FIT_MIN = 0.55;
const FIT_MAX = 1.5;
const SIZE_MIN = 1;
const SIZE_MAX = 3;
const SIZE_DEFAULT = 2;
// Annulus: outer circle clockwise, inner counter-clockwise → a hole.
const RING_PATH = 'path://M50 0 A50 50 0 1 1 49.99 0 Z M50 14 A36 36 0 1 0 50.01 14 Z';
const RING_GAP = 0.26;          // radians between segments
const EDGE_DIM = new Map(HOUSE_EDGE_OPTIONS.map((o) => [o.key, o.dim]));

const isSentinel = (v) => v == null || v === -1000000 || v === -999999 || (typeof v === 'number' && !Number.isFinite(v));
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (v) => {
    if (isSentinel(v)) return '—';
    const a = Math.abs(v), s = v < 0 ? '−' : v > 0 ? '+' : '';
    if (a >= 1e6) return `${s}$${(a / 1e6).toFixed(2)}M`;
    if (a >= 1e3) return `${s}$${(a / 1e3).toFixed(a >= 1e4 ? 0 : 1)}K`;
    return `${s}$${Math.round(a)}`;
};
const pct = (v) => (isSentinel(v) ? '—' : `${v < 0 ? '−' : ''}${Math.abs(v).toFixed(2)}%`);
const int = (v) => (isSentinel(v) ? '—' : Math.round(v).toLocaleString());
const mins = (v) => (isSentinel(v) ? '—' : v < 90 ? `${Math.round(v)}m` : `${Math.floor(v / 60)}h ${String(Math.round(v % 60)).padStart(2, '0')}m`);
const signColor = (v) => (isSentinel(v) ? TEXT.faint : v < 0 ? STATE.negative : v > 0 ? STATE.positive : TEXT.primary);

function readStored(key, fallback, parse) {
    try { const v = localStorage.getItem(key); return v == null ? fallback : parse(v); } catch { return fallback; }
}
function writeStored(key, v) {
    try { localStorage.setItem(key, String(v)); } catch { /* storage unavailable (private mode) */ }
}

// Casino Win for the table (casino perspective), live edge for every option.
function statsTooltip(d, hits) {
    const hit = new Map((hits || []).map((h) => [h.code, h]));
    const row = (label, day, shoe) => `
      <tr>
        <td style="color:${TEXT.muted};padding:4px 16px 4px 0">${label}</td>
        <td style="text-align:right;padding:4px 14px;font-weight:700">${day}</td>
        <td style="text-align:right;padding:4px 0;font-weight:700">${shoe}</td>
      </tr>`;
    const edges = PATRON_360.BET_OPTIONS.map((o) => {
        const v = d[EDGE_DIM.get(o.edgeKey)];
        const h = hit.get(o.code);
        const c = h ? h.color : isSentinel(v) ? TEXT.faint : v < 0 ? 'rgb(235,150,255)' : TEXT.primary;
        return `<span style="color:${h ? h.color : TEXT.muted};font-weight:${h ? 800 : 600}">${h ? '● ' : ''}${esc(o.code)}</span>`
            + `<span style="text-align:right;font-weight:${h ? 800 : 600};color:${c}">${pct(v)}</span>`;
    }).join('');
    return `
    <div style="min-width:300px">
      <div style="display:flex;justify-content:space-between;align-items:baseline;gap:16px;border-bottom:1px solid rgba(255,255,255,0.12);padding-bottom:6px;margin-bottom:4px">
        <span style="font-size:17px;font-weight:800;color:${ACCENT}">${esc(tableKeyOf(d))}</span>
        <span style="font-size:12px;color:${TEXT.muted}">${esc(d[34] || '—')} · pit ${esc(d[32] || '—')}</span>
      </div>
      <table style="border-collapse:collapse;font-size:13px;width:100%;font-variant-numeric:tabular-nums">
        <tr>
          <td></td>
          <td style="text-align:right;padding:2px 14px;font-size:11px;letter-spacing:.06em;color:${TEXT.faint}">TODAY</td>
          <td style="text-align:right;padding:2px 0;font-size:11px;letter-spacing:.06em;color:${TEXT.faint}">SHOE</td>
        </tr>
        ${row('Casino Win', `<span style="color:${signColor(d[18])}">${money(d[18])}</span>`, `<span style="color:${signColor(d[57])}">${money(d[57])}</span>`)}
        ${row('Hands', int(d[65]), isSentinel(d[61]) ? '—' : `#${int(d[61])}`)}
      </table>
      <div style="margin-top:6px;padding-top:6px;border-top:1px solid rgba(255,255,255,0.1);font-size:11px;letter-spacing:.06em;color:${TEXT.faint}">LIVE HOUSE EDGE · CURRENT SHOE</div>
      <div style="display:grid;grid-template-columns:auto 1fr auto 1fr;gap:2px 10px;font-size:12px;margin-top:3px;font-variant-numeric:tabular-nums">${edges}</div>
      <div style="margin-top:6px;font-size:12px;color:${TEXT.faint}">Shoe ${esc(d[52] || '—')} · last hand ${mins(d[63])} ago · ${isSentinel(d[64]) ? '—' : d[64].toFixed(1)} seated</div>
      <div style="margin-top:4px;font-size:11px;color:${ACCENT}">Click to open this table below</div>
    </div>`;
}

function seatsTooltip(d, seats) {
    const { WIDTH: W, HEIGHT: H, SEAT_R: R, ARC_R, SEATS } = SEAT_TOOLTIP;
    const FONT = 9;
    const cx = W / 2, cy = H - 18;
    const bySeat = new Map((seats || []).map((s) => [s.seat, s]));
    let circles = '';
    for (let i = 0; i < SEATS; i++) {
        const angle = Math.PI - (Math.PI * (i + 0.5)) / SEATS;
        const x = cx + ARC_R * Math.cos(angle);
        const y = cy - ARC_R * Math.sin(angle);
        const occ = bySeat.get(i + 1);
        if (occ) {
            const tier = CARD_TIERS[occ.cardType] || CARD_TIERS.BASE;
            const res = -occ.cumWin;                                   // patron perspective
            circles += `
              <circle cx="${x}" cy="${y}" r="${R}" fill="${tier.accent}2e" stroke="${tier.accent}" stroke-width="1.6"/>
              <text x="${x}" y="${y - 3}" text-anchor="middle" fill="#eaf6ff" font-size="${FONT}" font-weight="700">S${i + 1}·${esc(String(occ.playerId).slice(-4))}</text>
              <text x="${x}" y="${y + 9}" text-anchor="middle" fill="${signColor(res)}" font-size="${FONT}" font-weight="700">${money(res)}</text>`;
        } else {
            circles += `
              <circle cx="${x}" cy="${y}" r="${R}" fill="rgba(255,255,255,0.02)" stroke="rgba(255,255,255,0.22)" stroke-dasharray="3 3" stroke-width="1"/>
              <text x="${x}" y="${y + 3}" text-anchor="middle" fill="${TEXT.disabled}" font-size="${FONT}">S${i + 1}</text>`;
        }
    }
    const occupied = (seats || []).length;
    return `
      <div style="display:flex;justify-content:space-between;align-items:baseline;gap:16px;margin-bottom:2px">
        <span style="font-size:15px;font-weight:800;color:${ACCENT}">${esc(tableKeyOf(d))}</span>
        <span style="font-size:13px;font-weight:800;color:${signColor(d[57])}">Casino Win shoe ${money(d[57])}</span>
      </div>
      <div style="color:${TEXT.faint};font-size:11px;margin-bottom:4px">hand #${int(d[61])} · ${occupied} seated · seat colour = card tier · value = Patron Win today</div>
      <svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
        <path d="M ${cx - ARC_R - R - 4},${cy} A ${ARC_R + R + 4},${ARC_R + R + 4} 0 0 1 ${cx + ARC_R + R + 4},${cy}"
              fill="rgba(122,162,247,0.04)" stroke="rgba(122,162,247,0.35)" stroke-width="1.5"/>
        <line x1="${cx - ARC_R - R - 4}" y1="${cy}" x2="${cx + ARC_R + R + 4}" y2="${cy}" stroke="rgba(122,162,247,0.35)" stroke-width="1.5"/>
        <text x="${cx}" y="${cy - 8}" text-anchor="middle" fill="${TEXT.faint}" font-size="9" letter-spacing="2">DEALER</text>
        ${circles}
      </svg>`;
}

function OverlayButton({ title, active, onClick, children }) {
    return (
        <Tooltip title={title} placement="left">
            <ButtonBase
                onClick={onClick}
                aria-label={title}
                aria-pressed={active}
                sx={{
                    width: 34, height: 34, borderRadius: 1.2,
                    bgcolor: active ? ACCENT : 'rgba(10,14,26,0.88)',
                    color: active ? '#0b1020' : TEXT.primary,
                    border: `1px solid ${active ? ACCENT : 'rgba(122,162,247,0.4)'}`,
                    backdropFilter: 'blur(6px)',
                    transition: 'background-color 150ms, border-color 150ms',
                    '&:hover': { borderColor: ACCENT },
                    '&.Mui-focusVisible': { outline: `2px solid ${ACCENT}`, outlineOffset: 2 },
                }}
            >
                {children}
            </ButtonBase>
        </Tooltip>
    );
}

// One ring per table: a full circle (one hit, or worst-only mode) or one
// arc per hit. Drawn by a custom series so it tracks the table exactly.
function ringChildren(cx, cy, r, item, settings, reducedMotion, placed) {
    const { hits, faded } = item;
    const opacity = faded ? FADED : 1;
    const pulse = settings.pulse && !reducedMotion && !faded
        ? { keyframeAnimation: { duration: 1600, loop: true, keyframes: [{ percent: 0.6, style: { opacity: 0.35 } }, { percent: 1, style: { opacity: 1 } }] } }
        : {};
    const arc = (a0, a1, color) => ({
        type: 'arc',
        shape: { cx, cy, r, startAngle: a0, endAngle: a1, clockwise: true },
        style: { stroke: color, fill: null, lineWidth: 3.5, lineCap: 'round', opacity },
        ...pulse,
    });
    const out = [];
    if (settings.multi === 'worst' || hits.length === 1) {
        out.push(arc(0, Math.PI * 2, hits[0].color));
    } else {
        const span = (Math.PI * 2) / hits.length;
        hits.forEach((h, i) => {
            const a0 = -Math.PI / 2 + i * span + RING_GAP / 2;
            out.push(arc(a0, a0 + span - RING_GAP, h.color));
        });
    }
    const w = hits[0];
    const text = `${w.code} ${pct(w.edge)}${hits.length > 1 ? ` +${hits.length - 1}` : ''}`;
    // Neighbouring tables' labels would print over each other; the worst
    // table keeps its label and the rest rely on the tooltip.
    const box = { x0: cx - text.length * 3.6, x1: cx + text.length * 3.6, y0: cy - r - 18, y1: cy - r - 4 };
    const clash = placed.some((b) => b.x0 < box.x1 && box.x0 < b.x1 && b.y0 < box.y1 && box.y0 < b.y1);
    if (settings.labels && !clash) {
        placed.push(box);
        out.push({
            type: 'text',
            x: cx, y: cy - r - 4,
            style: {
                text,
                fill: w.color, font: '800 11px ui-monospace, Consolas, monospace',
                align: 'center', verticalAlign: 'bottom',
                stroke: '#0d0e18', lineWidth: 3, opacity,
            },
        });
    }
    return out;
}

export default function RtFloorMap({
    data, kpiKey, betOption, axisBounds, seatsByTable, inspectedTableKey, onTableClick,
    hiddenBands, rings, ringSettings,
}) {
    const ref = useRef(null);
    const instRef = useRef(null);
    const clickRef = useRef(onTableClick);
    clickRef.current = onTableClick;

    const [scale, setScale] = useState(() => readStored('rt.symbolScale', SIZE_DEFAULT,
        (v) => Math.min(SIZE_MAX, Math.max(SIZE_MIN, Number(v) || SIZE_DEFAULT))));
    const [tooltipStyle, setTooltipStyle] = useState(() => readStored('rt.tooltipStyle', 'stats',
        (v) => (v === 'seats' ? 'seats' : 'stats')));
    const [sizeOpen, setSizeOpen] = useState(false);
    const [box, setBox] = useState({ w: 0, h: 0 });
    useEffect(() => writeStored('rt.symbolScale', scale), [scale]);
    useEffect(() => writeStored('rt.tooltipStyle', tooltipStyle), [tooltipStyle]);

    // Table sizes in the floor config are pixels, but the floor stretches
    // with the panel — without this, a narrower panel packs the same-size
    // tables closer until neighbours overlap.
    const fit = useMemo(() => {
        if (!box.w || !box.h) return 1;
        const plotW = box.w - MAP_GRID.left - MAP_GRID.right;
        const plotH = box.h - MAP_GRID.top - MAP_GRID.bottom;
        const f = Math.min(plotW / FIT_REF.w, plotH / FIT_REF.h);
        return Math.min(FIT_MAX, Math.max(FIT_MIN, f));
    }, [box]);
    const sizeK = scale * fit;

    const reducedMotion = useMemo(() => {
        try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
    }, []);

    useEffect(() => {
        const el = ref.current;
        const inst = echarts.init(el);
        instRef.current = inst;
        inst.on('click', (p) => {
            if (p.seriesIndex !== 0 || !isInteractive(p.value)) return;
            if (clickRef.current) clickRef.current(tableKeyOf(p.value));
        });
        const ro = new ResizeObserver(() => {
            inst.resize();
            setBox({ w: el.clientWidth, h: el.clientHeight });
        });
        ro.observe(el);
        return () => { ro.disconnect(); inst.dispose(); instRef.current = null; };
    }, []);

    useEffect(() => {
        const inst = instRef.current;
        if (!inst) return;
        const dim = mapDim(kpiKey, betOption);
        const ramp = threshold_dict[kpiKey];
        const hidden = hiddenBands || new Set();
        const isFaded = (d) => hidden.size > 0 && hidden.has(bandIndex(ramp, d[dim]));
        const points = data.map((d) => {
            const i = bandIndex(ramp, d[dim]);
            const base = i >= 0 ? { color: ramp[i].color, opacity: 0.92 } : OUT_OF_RANGE;
            return { value: d, itemStyle: isFaded(d) ? { ...base, opacity: FADED } : base };
        });
        const ringItems = [];
        if (rings && rings.size) {
            for (const d of data) {
                if (!isInteractive(d)) continue;
                const hits = rings.get(tableKeyOf(d));
                if (hits) ringItems.push({ d, hits, faded: isFaded(d) });
            }
            ringItems.sort((a, b) => a.hits[0].gap - b.hits[0].gap);
        }
        let placed = [];
        const focus = inspectedTableKey ? data.filter((d) => tableKeyOf(d) === inspectedTableKey) : [];
        const settings = ringSettings || { multi: 'segments', pulse: false, labels: true };
        inst.setOption({
            backgroundColor: 'transparent',
            animation: false,
            grid: MAP_GRID,
            xAxis: { type: 'value', show: false, min: axisBounds?.xMin, max: axisBounds?.xMax },
            yAxis: { type: 'value', show: false, min: axisBounds?.yMin, max: axisBounds?.yMax },
            tooltip: {
                trigger: 'item',
                confine: true,
                backgroundColor: 'rgba(14,16,28,0.97)',
                borderColor: 'rgba(122,162,247,0.45)',
                borderWidth: 1,
                padding: [10, 14],
                textStyle: { color: '#fff', fontSize: 13 },
                formatter: (p) => {
                    const d = p && p.value;
                    if (p.seriesIndex !== 0 || !isInteractive(d)) return '';
                    return tooltipStyle === 'seats'
                        ? seatsTooltip(d, seatsByTable && seatsByTable.get(tableKeyOf(d)))
                        : statsTooltip(d, rings && rings.get(tableKeyOf(d)));
                },
            },
            series: [
                {
                    name: 'Tables',
                    type: 'scatter',
                    data: points,
                    symbol: (v) => (typeof v[4] === 'string' && v[4].startsWith('path://') ? v[4] : 'circle'),
                    symbolSize: (v) => [v[5] * sizeK, v[6] * sizeK],
                    symbolRotate: (v) => v[2],
                    emphasis: { itemStyle: { borderColor: '#fff', borderWidth: 1.5 } },
                    cursor: 'pointer',
                },
                {
                    name: 'Inspected',
                    type: reducedMotion ? 'scatter' : 'effectScatter',
                    data: focus,
                    symbol: RING_PATH,
                    symbolSize: (v) => Math.max(v[5], v[6]) * sizeK * 1.5,
                    rippleEffect: { brushType: 'stroke', scale: 2, period: 2.6 },
                    itemStyle: { color: ACCENT },
                    silent: true,
                    z: 5,
                    tooltip: { show: false },
                },
                {
                    name: 'Edge rings',
                    type: 'custom',
                    coordinateSystem: 'cartesian2d',
                    data: ringItems.map((r) => [r.d[0], r.d[1]]),
                    silent: true,
                    clip: false,
                    z: 4,
                    animation: true,
                    animationDuration: 0,
                    animationDurationUpdate: 0,
                    tooltip: { show: false },
                    renderItem: (params, api) => {
                        const item = ringItems[params.dataIndex];
                        if (!item) return null;
                        if (params.dataIndex === 0) placed = [];
                        const [cx, cy] = api.coord([item.d[0], item.d[1]]);
                        const r = (Math.max(item.d[5], item.d[6]) * sizeK) / 2 + 7;
                        return { type: 'group', children: ringChildren(cx, cy, r, item, settings, reducedMotion, placed) };
                    },
                },
            ],
        }, { notMerge: true });
    }, [data, kpiKey, betOption, axisBounds, tooltipStyle, seatsByTable, inspectedTableKey, sizeK, reducedMotion, hiddenBands, rings, ringSettings]);

    return (
        <Box sx={{ position: 'relative', width: '100%', height: '100%' }}>
            <div ref={ref} style={{ width: '100%', height: '100%' }} />
            <Stack spacing={0.75} sx={{ position: 'absolute', top: 10, right: 10, zIndex: 6 }}>
                <OverlayButton title="Symbol size" active={sizeOpen} onClick={() => setSizeOpen((v) => !v)}>
                    <TuneIcon sx={{ fontSize: 18 }} />
                </OverlayButton>
                <OverlayButton
                    title={tooltipStyle === 'seats' ? 'Tooltip: seat map (click for stats)' : 'Tooltip: stats (click for seat map)'}
                    active={tooltipStyle === 'seats'}
                    onClick={() => setTooltipStyle((v) => (v === 'seats' ? 'stats' : 'seats'))}
                >
                    <EventSeatIcon sx={{ fontSize: 18 }} />
                </OverlayButton>
            </Stack>
            {sizeOpen && (
                <Box sx={{
                    position: 'absolute', top: 10, right: 54, zIndex: 7, width: 230, p: 1.25, borderRadius: 1.5,
                    bgcolor: 'rgba(14,16,28,0.97)', border: '1px solid rgba(122,162,247,0.4)',
                    boxShadow: '0 8px 24px rgba(0,0,0,0.45)',
                }}>
                    <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', mb: 0.75 }}>
                        <Typography sx={{ fontSize: 12, fontWeight: 800, letterSpacing: 0.5, textTransform: 'uppercase', color: TEXT.secondary }}>
                            Symbol size
                        </Typography>
                        <ButtonBase aria-label="Close symbol size" onClick={() => setSizeOpen(false)} sx={{ color: TEXT.muted, borderRadius: 1, p: 0.25 }}>
                            <CloseIcon sx={{ fontSize: 16 }} />
                        </ButtonBase>
                    </Stack>
                    <Box
                        component="input" type="range" min={SIZE_MIN} max={SIZE_MAX} step={0.1} value={scale}
                        aria-label="Symbol size"
                        onChange={(e) => setScale(parseFloat(e.target.value))}
                        sx={{ width: '100%', accentColor: ACCENT, cursor: 'pointer' }}
                    />
                    <Typography sx={{ fontSize: 16, fontWeight: 800, color: ACCENT, fontVariantNumeric: 'tabular-nums' }}>
                        {scale.toFixed(1)}×
                    </Typography>
                </Box>
            )}
        </Box>
    );
}
