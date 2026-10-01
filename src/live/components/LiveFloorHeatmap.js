// Live Casino Win — floor scatter heatmap.
// Reuses the SVG table-shape dictionary + scatter geometry from
// Pricing/Spread so it lands at the same positions and reads as one
// product. What's different: the visualMap is a piecewise diverging
// scale on `cumWin` (casino perspective) — green when the casino is
// winning at a table, red when it's losing.
//
// Extra behavior for the "click a patron" flow: when `patronFilter` is
// non-null the tooltip switches to that patron's per-table stats (their
// cumulative W/L at that table, their hand count).

import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as echarts from 'echarts';
import { Box, Stack, Typography, Tooltip } from '@mui/material';
import TuneIcon from '@mui/icons-material/Tune';
import CloseIcon from '@mui/icons-material/Close';
import { gametype_svg_path } from '../../shared/constants/heatmapConstants';
import {
    LIVE_FLOOR_X_MIN, LIVE_FLOOR_X_MAX, LIVE_FLOOR_Y_MIN, LIVE_FLOOR_Y_MAX,
    LIVE_SYMBOL_SIZE_DEFAULT, LIVE_SYMBOL_SIZE_MIN, LIVE_SYMBOL_SIZE_MAX, LIVE_SYMBOL_SIZE_STEP,
} from '../constants/floorLayout';
import { BREAKPOINTS, colorForWin, fmtCurrency, CARD_TIERS } from '../constants/winPalette';
import { LIVE_FONTS } from '../constants/fontSizes';
import { SEAT_TOOLTIP } from '../constants/liveConfig';
import EventSeatIcon from '@mui/icons-material/EventSeat';

const FM = LIVE_FONTS.floorMap;

function escapeHtml(s) {
    return String(s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Build the "seats" tooltip body — an inline SVG of the table with the
// seat ring; occupied seats get the patron's card-tier color + their
// avg bet / ADT inside the circle.
function seatTooltipSvg(m, seats) {
    const { WIDTH: W, HEIGHT: H, SEAT_R: R, ARC_R, SEATS, FONT } = SEAT_TOOLTIP;
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
            circles += `
              <circle cx="${x}" cy="${y}" r="${R}" fill="${tier.accent}2e" stroke="${tier.accent}" stroke-width="1.6"/>
              <text x="${x}" y="${y - 5}" text-anchor="middle" fill="#eaf6ff" font-size="${FONT}" font-weight="700">S${i + 1}·${occ.patronId.slice(-4)}</text>
              <text x="${x}" y="${y + 3.5}" text-anchor="middle" fill="${tier.accent}" font-size="${FONT}" font-weight="700">${fmtCurrency(occ.avgBet)}</text>
              <text x="${x}" y="${y + 12}" text-anchor="middle" fill="rgba(255,255,255,0.6)" font-size="${FONT - 0.5}">ADT ${fmtCurrency(occ.adt)}</text>`;
        } else {
            circles += `
              <circle cx="${x}" cy="${y}" r="${R}" fill="rgba(255,255,255,0.02)" stroke="rgba(255,255,255,0.18)" stroke-dasharray="3 3" stroke-width="1"/>
              <text x="${x}" y="${y + 3}" text-anchor="middle" fill="rgba(255,255,255,0.25)" font-size="${FONT}">S${i + 1}</text>`;
        }
    }
    const cumColor = m.cumWin == null ? '#6b7a86' : colorForWin(m.cumWin);
    return `
      <div style="font-weight:800;font-size:13px;letter-spacing:0.5px;margin-bottom:2px">${escapeHtml(m.label)}
        <span style="float:right;color:${cumColor};font-weight:800">${m.cumWin == null ? '—' : fmtCurrency(m.cumWin)}</span>
      </div>
      <div style="color:rgba(255,255,255,0.5);font-size:10px;margin-bottom:4px">${escapeHtml(m.gametype)} · pit ${escapeHtml(m.pit)} · ${m.hands} hands · seat colors = card tier</div>
      <svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
        <path d="M ${cx - ARC_R - R - 4},${cy} A ${ARC_R + R + 4},${ARC_R + R + 4} 0 0 1 ${cx + ARC_R + R + 4},${cy}"
              fill="rgba(122,223,255,0.03)" stroke="rgba(122,223,255,0.3)" stroke-width="1.5"/>
        <line x1="${cx - ARC_R - R - 4}" y1="${cy}" x2="${cx + ARC_R + R + 4}" y2="${cy}" stroke="rgba(122,223,255,0.3)" stroke-width="1.5"/>
        <text x="${cx}" y="${cy - 8}" text-anchor="middle" fill="rgba(202,232,255,0.45)" font-size="9" letter-spacing="2">DEALER</text>
        ${circles}
      </svg>`;
}

export default function LiveFloorHeatmap({
    tables,             // liveFloorTables(date)
    tableRuntime,       // Map<tableKey, { cumWin, cumWager, hands, headcount, lastRoundTs }>
    topPatrons,         // Map<tableKey, [{ patronId, cumWin, cardType }]>
    seatOccupancy,      // Map<tableKey, [{ patronId, seat, cardType, avgBet, adt }]>
    highlightedTableKeys, // Set<tableKey> — yellow rectangle overlay,
                          // driven by the ranked list on the right
    onTableClick,       // (tableKey) => void
    selectedPatron,     // for tooltip framing ('… for PATRON-X only')
}) {
    const ref = useRef(null);
    const instRef = useRef(null);

    // Symbol-size persistence
    const [SZ, setSZ] = useState(() => {
        try { const v = localStorage.getItem('live.symbolSize'); if (v) return Math.min(LIVE_SYMBOL_SIZE_MAX, Math.max(LIVE_SYMBOL_SIZE_MIN, Number(v))); } catch { /* */ }
        return LIVE_SYMBOL_SIZE_DEFAULT;
    });
    useEffect(() => { try { localStorage.setItem('live.symbolSize', String(SZ)); } catch { /* */ } }, [SZ]);
    const [sizePopoverOpen, setSizePopoverOpen] = useState(false);

    // Tooltip style — 'classic' (text stats + top patrons) or 'seats'
    // (table shape with occupied seat circles). Persisted per browser.
    const [tooltipStyle, setTooltipStyle] = useState(() => {
        try { return localStorage.getItem('live.tooltipStyle') === 'seats' ? 'seats' : 'classic'; } catch { return 'classic'; }
    });
    useEffect(() => { try { localStorage.setItem('live.tooltipStyle', tooltipStyle); } catch { /* */ } }, [tooltipStyle]);

    // Freeze latest values so the ECharts listener always sees current callbacks.
    const handlersRef = useRef({ onTableClick });
    handlersRef.current = { onTableClick };

    const seriesData = useMemo(() => {
        return (tables || []).map((t) => {
            const svgDef = gametype_svg_path[t.gametype];
            const rt = tableRuntime ? tableRuntime.get(t.key) : null;
            const hands = rt?.hands || 0;
            const cumWin = rt?.cumWin ?? null;
            // Idle table = the shape is still visible so the floor
            // layout stays recognisable, but the fill drops to a
            // muted slate that clearly reads "no action" (or, in the
            // patron-filter case, "this patron never played here").
            const explicitColor = hands === 0 ? '#3d4652' : colorForWin(cumWin);
            return {
                name: t.label || t.key,
                // Value dim[2] = cumWin (used by tooltip & visualMap).
                value: [t.x, t.y, cumWin == null ? 0 : cumWin],
                symbol: svgDef ? 'path://' + svgDef.path : 'circle',
                symbolSize: svgDef ? [svgDef.size_X * SZ, svgDef.size_Y * SZ] : 18,
                symbolRotate: t.rotation || 0,
                itemStyle: {
                    color: explicitColor,
                    borderColor: hands === 0 ? 'rgba(255,255,255,0.22)' : 'rgba(255,255,255,0.32)',
                    borderWidth: hands === 0 ? 0.8 : 1,
                    opacity: hands === 0 ? 0.65 : 0.98,
                },
                meta: {
                    tableKey: t.key,
                    label:    t.label,
                    gametype: t.gametype,
                    pit:      t.pit,
                    segment:  t.sub_segment || t.segment || '—',
                    cumWin, cumWager: rt?.cumWager || 0, hands, headcount: rt?.headcount || 0,
                    lastRoundTs: rt?.lastRoundTs || null,
                },
            };
        });
    }, [tables, tableRuntime, SZ]);

    // Highlight geometry — the amber outline the operator sees around
    // every table played by any patron currently ranked in the right
    // panel. When the ranked list changes (tab switch), this set
    // updates and the overlay follows.
    const highlightGeom = useMemo(() => {
        const set = highlightedTableKeys;
        if (!set || set.size === 0) return [];
        const out = [];
        for (const t of (tables || [])) {
            if (!set.has(t.key)) continue;
            const svgDef = gametype_svg_path[t.gametype];
            // Same 1.35× "hit box" pattern as the pricing fixed-outline
            // rectangle — keeps the outline outside the shape.
            const w  = ((svgDef ? svgDef.size_X * SZ : 18) * 1.35) / 2;
            const hh = ((svgDef ? svgDef.size_Y * SZ : 18) * 1.35) / 2;
            out.push({ cx: t.x, cy: t.y, w, hh });
        }
        return out;
    }, [highlightedTableKeys, tables, SZ]);

    // Single self-inits effect. React 18 StrictMode mounts effects
    // twice in dev — the two-effect pattern (init once + redraw on
    // data) can leave the redraw effect running before the init
    // effect on the second mount. Rolling both into one draw pass
    // means each time the component "wakes up" it just re-inits and
    // draws in the same tick — deterministic on every mount.
    // Init exactly once — matches the two-effect pattern used by
    // PricingFloorMap, which is proven to render cleanly under React
    // 18 StrictMode + ECharts 6.
    useEffect(() => {
        if (!ref.current) return;
        const inst = echarts.init(ref.current, 'dark');
        instRef.current = inst;

        const onClick = (params) => {
            const meta = params?.data?.meta;
            if (!meta) return;
            handlersRef.current.onTableClick && handlersRef.current.onTableClick(meta.tableKey);
        };
        inst.on('click', onClick);

        const ro = new ResizeObserver(() => requestAnimationFrame(() => inst.resize()));
        ro.observe(ref.current);
        return () => {
            ro.disconnect();
            inst.off('click', onClick);
            inst.dispose();
            instRef.current = null;
        };
    }, []);

    // Redraw whenever data / topPatrons / selection framing changes.
    useEffect(() => {
        const inst = instRef.current;
        if (!inst) return;
        inst.setOption({
            backgroundColor: 'transparent',
            animation: false,
            grid: { left: 0, right: 0, top: 0, bottom: 0, containLabel: false },
            xAxis: { type: 'value', show: false, min: LIVE_FLOOR_X_MIN, max: LIVE_FLOOR_X_MAX },
            yAxis: { type: 'value', show: false, min: LIVE_FLOOR_Y_MIN, max: LIVE_FLOOR_Y_MAX, inverse: false },
            // No visualMap — every data point sets its own itemStyle.color
            // from colorForWin() so we don't need visualMap's piecewise
            // dimension mapping.
            tooltip: {
                trigger: 'item',
                backgroundColor: 'rgba(15,20,25,0.96)',
                borderColor: 'rgba(122,200,220,0.4)',
                textStyle: { color: '#fff', fontSize: FM.legend + 1 },
                extraCssText: 'max-width: 320px; box-shadow: 0 8px 24px rgba(0,0,0,0.5);',
                formatter: (params) => {
                    const m = params?.data?.meta;
                    if (!m) return '';
                    if (tooltipStyle === 'seats') {
                        return seatTooltipSvg(m, seatOccupancy ? seatOccupancy.get(m.tableKey) : []);
                    }
                    const cumColor = m.cumWin == null ? '#6b7a86' : colorForWin(m.cumWin);
                    const cumStr = m.cumWin == null ? '—' : fmtCurrency(m.cumWin);
                    const cumLabel = selectedPatron
                        ? `<span style="color:rgba(255,255,255,0.55);font-size:11px">for ${escapeHtml(selectedPatron)} only</span><br/>`
                        : '';
                    const topRows = (topPatrons?.get(m.tableKey) || []).slice(0, 3).map((p) => {
                        const tier = CARD_TIERS[p.cardType] || CARD_TIERS.BASE;
                        const c = colorForWin(p.cumWin);
                        return `
                          <div style="display:flex;align-items:center;gap:6px;margin-top:2px">
                            <span style="display:inline-block;padding:1px 5px;border-radius:3px;background:${tier.color};color:${tier.text};font-size:9px;font-weight:800;letter-spacing:0.3px">${escapeHtml(tier.label)}</span>
                            <span style="font-weight:700">${escapeHtml(p.patronId)}</span>
                            <span style="margin-left:auto;color:${c};font-weight:800">${fmtCurrency(p.cumWin)}</span>
                          </div>`;
                    }).join('');
                    return `
                      <div style="font-weight:800;font-size:14px;letter-spacing:0.3px">${escapeHtml(m.label)}</div>
                      <div style="color:rgba(255,255,255,0.5);font-size:11px;margin-bottom:6px">${escapeHtml(m.gametype)} · pit ${escapeHtml(m.pit)} · ${escapeHtml(m.segment)}</div>
                      ${cumLabel}
                      <div style="display:flex;justify-content:space-between;gap:12px">
                        <span style="color:rgba(255,255,255,0.55)">CASINO WIN</span>
                        <span style="color:${cumColor};font-weight:800">${cumStr}</span>
                      </div>
                      <div style="display:flex;justify-content:space-between;gap:12px">
                        <span style="color:rgba(255,255,255,0.55)">HANDS · HC</span>
                        <span>${m.hands} · ${m.headcount}</span>
                      </div>
                      <div style="display:flex;justify-content:space-between;gap:12px">
                        <span style="color:rgba(255,255,255,0.55)">WAGER</span>
                        <span>${fmtCurrency(m.cumWager)}</span>
                      </div>
                      ${topRows ? `<div style="margin-top:8px;padding-top:6px;border-top:1px solid rgba(255,255,255,0.12);color:rgba(255,255,255,0.6);font-size:10px;letter-spacing:0.6px;text-transform:uppercase">top patrons here</div>${topRows}` : ''}
                    `;
                },
            },
            series: [
                {
                    type: 'scatter',
                    data: seriesData,
                    cursor: 'pointer',
                    emphasis: { focus: 'none', scale: 1.08 },
                },
                // Highlight overlay — yellow rounded rectangles around
                // every table played by a currently-ranked patron.
                // Drawn silent so clicks fall through to the scatter.
                ...(highlightGeom.length ? [{
                    type: 'custom', silent: true, z: 5, animation: false, tooltip: { show: false },
                    data: [[(LIVE_FLOOR_X_MIN + LIVE_FLOOR_X_MAX) / 2, (LIVE_FLOOR_Y_MIN + LIVE_FLOOR_Y_MAX) / 2]],
                    renderItem: (params, api) => {
                        const children = [];
                        for (const c of highlightGeom) {
                            const p = api.coord([c.cx, c.cy]);
                            children.push({
                                type: 'rect', silent: true,
                                shape: { x: p[0] - c.w, y: p[1] - c.hh, width: 2 * c.w, height: 2 * c.hh, r: 3 },
                                style: {
                                    fill: 'transparent',
                                    stroke: '#ffd479',
                                    lineWidth: 2,
                                    shadowBlur: 8,
                                    shadowColor: 'rgba(255,212,121,0.55)',
                                },
                            });
                        }
                        return { type: 'group', children };
                    },
                }] : []),
            ],
        }, { notMerge: true });
    }, [seriesData, topPatrons, selectedPatron, highlightGeom, tooltipStyle, seatOccupancy]);

    return (
        <Box sx={{
            width: '100%', height: '100%', position: 'relative',
            borderRadius: 3,
            background: 'linear-gradient(165deg, rgba(16,32,54,0.6) 0%, rgba(8,17,30,0.85) 60%)',
            border: '1px solid rgba(122,223,255,0.16)',
            boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.05), 0 8px 28px rgba(0,0,0,0.35)',
            overflow: 'hidden',
        }}>
            {/* Raw <div> ref — MUI Box's ref forwarding didn't reliably
                give ECharts a live DOM node in this app's React 18 +
                ECharts 6 combo, leaving the canvas blank. Matches
                PricingFloorMap.js's proven pattern. */}
            <div ref={ref} style={{ width: '100%', height: '100%' }} />

            {/* ⚙ Symbol-size button — bottom-right so it stays away from the
                legend row + tooltip trigger area. */}
            <Tooltip title="Symbol size">
                <Box onClick={() => setSizePopoverOpen((v) => !v)}
                    sx={{
                        position: 'absolute', top: 10, right: 10, zIndex: 6,
                        width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center',
                        cursor: 'pointer', borderRadius: 1.2,
                        bgcolor: sizePopoverOpen ? '#7adfff' : 'rgba(10,22,35,0.9)',
                        color: sizePopoverOpen ? '#06182a' : '#dff5ff',
                        border: '1px solid rgba(122,200,220,0.4)', backdropFilter: 'blur(6px)',
                        '&:hover': sizePopoverOpen ? undefined : { borderColor: 'rgba(122,223,255,0.7)' },
                    }}>
                    <TuneIcon sx={{ fontSize: 18 }} />
                </Box>
            </Tooltip>

            {/* Tooltip-style toggle — classic text stats vs seat map. */}
            <Tooltip title={tooltipStyle === 'seats' ? 'Tooltip: seat map (click for classic stats)' : 'Tooltip: classic stats (click for seat map)'}>
                <Box onClick={() => setTooltipStyle((v) => (v === 'seats' ? 'classic' : 'seats'))}
                    sx={{
                        position: 'absolute', top: 48, right: 10, zIndex: 6,
                        width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center',
                        cursor: 'pointer', borderRadius: 1.2,
                        bgcolor: tooltipStyle === 'seats' ? '#7adfff' : 'rgba(10,22,35,0.9)',
                        color: tooltipStyle === 'seats' ? '#06182a' : '#dff5ff',
                        border: '1px solid rgba(122,200,220,0.4)', backdropFilter: 'blur(6px)',
                        '&:hover': { borderColor: 'rgba(122,223,255,0.7)' },
                    }}>
                    <EventSeatIcon sx={{ fontSize: 18 }} />
                </Box>
            </Tooltip>

            {sizePopoverOpen && (
                <Box sx={{
                    position: 'absolute', top: 86, right: 10, zIndex: 7, width: 240,
                    p: 1.2, borderRadius: 1.4,
                    bgcolor: 'rgba(10,22,35,0.96)', border: '1px solid rgba(122,200,220,0.4)',
                    boxShadow: '0 8px 24px rgba(0,0,0,0.4)', backdropFilter: 'blur(8px)',
                }}>
                    <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 0.8 }}>
                        <Typography sx={{ fontSize: 12.5, fontWeight: 800, color: '#dff5ff', letterSpacing: 0.4, textTransform: 'uppercase' }}>Symbol size</Typography>
                        <Box onClick={() => setSizePopoverOpen(false)} sx={{ cursor: 'pointer', color: 'rgba(255,255,255,0.55)', display: 'flex' }}>
                            <CloseIcon sx={{ fontSize: 16 }} />
                        </Box>
                    </Stack>
                    <Stack direction="row" alignItems="center" spacing={0.8}>
                        <Typography sx={{ fontSize: 11, color: 'rgba(255,255,255,0.55)', minWidth: 32 }}>{LIVE_SYMBOL_SIZE_MIN}×</Typography>
                        <Box component="input" type="range" min={LIVE_SYMBOL_SIZE_MIN} max={LIVE_SYMBOL_SIZE_MAX} step={LIVE_SYMBOL_SIZE_STEP} value={SZ}
                            onChange={(e) => setSZ(parseFloat(e.target.value))}
                            sx={{ flex: 1, accentColor: '#7adfff', height: 6, cursor: 'pointer' }} />
                        <Typography sx={{ fontSize: 11, color: 'rgba(255,255,255,0.55)', minWidth: 32, textAlign: 'right' }}>{LIVE_SYMBOL_SIZE_MAX}×</Typography>
                    </Stack>
                    <Typography sx={{ fontSize: 18, fontWeight: 800, color: '#7adfff', fontVariantNumeric: 'tabular-nums', mt: 0.4 }}>{SZ.toFixed(2)}×</Typography>
                </Box>
            )}

            {/* Piecewise legend — bottom-left. */}
            <Box sx={{ position: 'absolute', bottom: 10, left: 12, zIndex: 5, p: 0.9, borderRadius: 1.2, bgcolor: 'rgba(10,22,35,0.85)', border: '1px solid rgba(255,255,255,0.08)', backdropFilter: 'blur(4px)' }}>
                <Typography sx={{ color: 'rgba(255,255,255,0.6)', fontSize: FM.legend - 1, fontWeight: 800, letterSpacing: 0.5, textTransform: 'uppercase', mb: 0.4 }}>
                    Casino win (cumulative today)
                </Typography>
                <Stack direction="row" spacing={0.6} alignItems="center" sx={{ flexWrap: 'wrap' }}>
                    {BREAKPOINTS.map((b) => (
                        <Stack key={b.label} direction="row" alignItems="center" spacing={0.4}>
                            <Box sx={{ width: 14, height: 10, borderRadius: 0.4, bgcolor: b.color, border: '1px solid rgba(255,255,255,0.12)' }} />
                            <Typography sx={{ color: 'rgba(255,255,255,0.65)', fontSize: FM.legend - 1, fontWeight: 700, whiteSpace: 'nowrap' }}>{b.label}</Typography>
                        </Stack>
                    ))}
                </Stack>
            </Box>
        </Box>
    );
}
