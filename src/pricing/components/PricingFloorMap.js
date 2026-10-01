// PricingFloorMap — interactive table floor for minimum-pricing
// =============================================================
//
// Cloned from the scheduling FloorScheduleMap and specialised for pricing:
//   • fill  = the table's minimum-tier color (grey when unpriced)
//   • tooltip shows PRICING info (opening base + Min/Max boundary, segment,
//     and the table's scheduled open/closed status this period)
//   • tables SCHEDULED OPEN in the active period get a distinct border so
//     you can tell at a glance which tables actually run this block.
//
// Selection / brush behaviour is identical to the scheduling map (Pointer
// / Rectangle / Polygon pills, single-click toggle, armed-tier paint).
//
// Props:
//   tables             — Array<{ key, label, gametype, x, y, rotation, pit, area, sub_segment }>
//   assignments        — { [tableKey]: tierId }  (the COLORED bound — base/min/max)
//   tiers              — Array<{ id, label, min, color }>
//   priceByKey         — Map<tableKey, { base, min, max }>  (tier ids; for the tooltip)
//   closedKeys         — Set<tableKey> scheduled CLOSED this hour/period (painted black)
//   selectedKeys       — Set<string>
//   activeBrushShiftId — tierId to paint on click (null = select mode)
//   onSelectionChange  — (Set<string>, info) => void
//   onAssign           — (tableKey, tierId | null) => void

import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as echarts from 'echarts';
import { Box, Typography, Stack, Tooltip } from '@mui/material';
import HighlightAltIcon from '@mui/icons-material/HighlightAlt';
import PolylineIcon from '@mui/icons-material/Polyline';
import NearMeIcon from '@mui/icons-material/NearMe';
import TuneIcon from '@mui/icons-material/Tune';
import CloseIcon from '@mui/icons-material/Close';
import {
    gametype_svg_path,
    SCATTER_GRID,
} from '../../shared/constants/heatmapConstants';
// Pricing floor uses its OWN axis bounds (tunable in floorLayout.js).
// Two independent sets — one for planning, one for comparison — chosen
// per-instance via the `mode` prop ('planning' | 'comparison').
import {
    PLAN_FLOOR_X_MIN, PLAN_FLOOR_X_MAX, PLAN_FLOOR_Y_MIN, PLAN_FLOOR_Y_MAX,
    CMP_FLOOR_X_MIN, CMP_FLOOR_X_MAX, CMP_FLOOR_Y_MIN, CMP_FLOOR_Y_MAX,
    PLAN_XAXIS_MIN, PLAN_XAXIS_MAX, CMP_XAXIS_MIN, CMP_XAXIS_MAX,
    PLAN_SYMBOL_SIZE, CMP_SYMBOL_SIZE,
    SYMBOL_SIZE_MIN, SYMBOL_SIZE_MAX, SYMBOL_SIZE_STEP,
} from '../constants/floorLayout';
import { UNPRICED_COLOR, formatMinimum } from '../constants/defaultTiers';
import { readPrice } from '../utils/pricingModel';
import { PRICING_FONTS } from '../constants/fontSizes';

const FM = PRICING_FONTS.floorMap;


export default function PricingFloorMap({
    tables,
    assignments,
    tiers,
    priceByKey,
    closedKeys,
    fixedKeys,
    showFixedOutline = true, // false → keep fixed-price data/tooltips as-is,
                              // just hide the rectangle overlay + legend swatch
    selectedKeys,
    activeBrushShiftId,
    onSelectionChange,
    onAssign,
    readOnly = false,
    flexEnabled = true,
    changeHighlights,   // Map<tableKey, 'up'|'down'> — price-change outlines
    pinnedKeys,         // Set<tableKey> — pinned (kept by Auto-plan): dashed gold outline
    manualKeys,         // Set<tableKey> — manual price (an Auto-plan rule) this block: solid gold outline
    // Colors for the change-highlight rectangle. Defaults match the planning
    // dashboard convention (red = up, green = down). Comparison mode passes
    // an inverted palette so green = higher, red = lower.
    changeColors = { up: '#ff4d4d', down: '#46e08a' },
    // Extra content rendered directly below the top-right date picker
    // overlay (comparison mode uses this to slot a per-map hour dropdown
    // when both dates match).
    dateOverlayExtra = null,
    dimmedKeys,         // Set<tableKey> — greyed (filtered out, NOT closed)
    vmSelected,         // opaque ECharts visualMap `selected` (null = all)
    onVmSelected,       // (selected) => void
    date,               // overlay date picker (top-right of the scatter)
    onDateChange,       // (iso) => void
    dateLocked = false, // true → show a read-only date pill instead of the
                         // editable input (same-date comparison mode: Date B
                         // always mirrors Date A, so it isn't independently pickable)
    scheduleLoaded = false,
    scheduleLoading = false,
    mode = 'planning',  // 'planning' | 'comparison' — picks the axis-bounds set
}) {
    // Pick the axis bounds set for this instance so planning and comparison
    // can use independent scatter geometry from floorLayout.js.
    const SCATTER_X_MIN = mode === 'comparison' ? CMP_FLOOR_X_MIN : PLAN_FLOOR_X_MIN;
    const SCATTER_X_MAX = mode === 'comparison' ? CMP_FLOOR_X_MAX : PLAN_FLOOR_X_MAX;
    const SCATTER_Y_MIN = mode === 'comparison' ? CMP_FLOOR_Y_MIN : PLAN_FLOOR_Y_MIN;
    const SCATTER_Y_MAX = mode === 'comparison' ? CMP_FLOOR_Y_MAX : PLAN_FLOOR_Y_MAX;
    // Dedicated xAxis bounds — used ONLY at the ECharts xAxis definition.
    // Kept independent from SCATTER_X_MIN/MAX so tuning the horizontal
    // viewport doesn't shift overlay center points or anything else.
    const XAXIS_MIN = mode === 'comparison' ? CMP_XAXIS_MIN : PLAN_XAXIS_MIN;
    const XAXIS_MAX = mode === 'comparison' ? CMP_XAXIS_MAX : PLAN_XAXIS_MAX;

    // Symbol-size multiplier — per-mode default, user-adjustable via the
    // ⚙ Symbol size popover, persisted per mode in localStorage.
    const defaultSize = mode === 'comparison' ? CMP_SYMBOL_SIZE : PLAN_SYMBOL_SIZE;
    const SIZE_KEY = `pricing.symbolSize.${mode}`;
    const [SZ, setSZ] = useState(() => {
        try { const v = parseFloat(window.localStorage.getItem(SIZE_KEY)); return Number.isFinite(v) && v > 0 ? v : defaultSize; }
        catch { return defaultSize; }
    });
    useEffect(() => {
        try { window.localStorage.setItem(SIZE_KEY, String(SZ)); } catch { /* ignore */ }
    }, [SIZE_KEY, SZ]);
    const [sizePopoverOpen, setSizePopoverOpen] = useState(false);
    const resetSize = () => setSZ(defaultSize);

    const ref = useRef(null);
    const instRef = useRef(null);
    const [selectMode, setSelectMode] = useState(null);
    const handlersRef = useRef({});
    handlersRef.current = { onSelectionChange, onAssign, activeBrushShiftId, selectMode, readOnly, flexEnabled, onVmSelected };

    const tierMap = useMemo(() => new Map((tiers || []).map((t) => [t.id, t])), [tiers]);
    const tierLbl = (id) => tierMap.get(id)?.label || formatMinimum(tierMap.get(id)?.min);
    const sortedTiers = useMemo(() => [...(tiers || [])].sort((a, b) => (b.min || 0) - (a.min || 0)), [tiers]);

    const seriesData = useMemo(() => {
        const sel = selectedKeys || new Set();
        const closed = closedKeys || null;
        const fixedSet = fixedKeys || null;
        return (tables || []).map((t) => {
            const tierId = (assignments || {})[t.key];
            const tier = tierId ? tierMap.get(tierId) : null;
            const isSelected = sel.has(t.key);
            // null when no schedule loaded; true = closed (not scheduled to
            // run this hour/period) → painted black; false = open.
            const isClosed = closed ? closed.has(t.key) : null;
            const isDimmed = !isClosed && dimmedKeys ? dimmedKeys.has(t.key) : false;
            const isFixedT = fixedSet ? fixedSet.has(t.key) : false;
            const svgDef = gametype_svg_path[t.gametype];
            // PRICED + open + not dropdown-dimmed → color comes from the
            // visualMap (by minimum); these get NO explicit color so the
            // visualMap can paint + filter them. Everything else is explicit:
            // closed = black, dimmed = grey, unpriced = the unpriced color.
            const vmColored = !!tier && !isClosed && !isDimmed;
            const explicitColor = isClosed ? '#000000' : (isDimmed ? '#39434f' : (vmColored ? null : UNPRICED_COLOR));
            const priceMin = vmColored ? (tier.min || 0) : -1;   // visualMap dimension

            // Border priority: selected (white) > subtle.
            let borderColor = isClosed ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.18)';
            let borderWidth = 0.5;
            if (isSelected) { borderColor = '#ffffff'; borderWidth = 2; }

            const pr = priceByKey ? priceByKey.get(t.key) : null;
            const p = pr ? readPrice(pr) : null;

            return {
                name: t.label || t.key,
                value: [t.x, t.y, priceMin],
                symbol: svgDef ? 'path://' + svgDef.path : 'circle',
                symbolSize: svgDef ? [svgDef.size_X * SZ, svgDef.size_Y * SZ] : 18,
                symbolRotate: t.rotation || 0,
                itemStyle: {
                    ...(explicitColor ? { color: explicitColor } : {}),
                    borderColor, borderWidth,
                    opacity: isClosed ? 0.92 : (isDimmed ? 0.32 : (tier ? 0.95 : 0.5)),
                    shadowBlur: isSelected ? 12 : 0,
                    shadowColor: isSelected ? 'rgba(255,255,255,0.65)' : 'transparent',
                },
                meta: {
                    tableKey:    t.key,
                    label:       t.label,
                    pit:         t.pit,
                    segment:     t.sub_segment || t.area || '—',
                    priced:      !!p,
                    baseLabel:   p ? tierLbl(p.base) : null,
                    baseColor:   p ? (tierMap.get(p.base)?.color || UNPRICED_COLOR) : UNPRICED_COLOR,
                    minLabel:    p ? tierLbl(p.min) : null,
                    maxLabel:    p ? tierLbl(p.max) : null,
                    flexible:    p ? (p.min !== p.max && !p.fixed) : false,
                    fixed:       isFixedT || (p ? !!p.fixed : false),
                    isClosed,
                },
            };
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [tables, assignments, tierMap, priceByKey, closedKeys, fixedKeys, selectedKeys, dimmedKeys, SZ]);

    // Overlay marking FIXED-price tables (locked minimum). Tables sit on a
    // regular grid, so we treat each fixed table as one grid CELL and MERGE
    // overlapping/adjacent cells: fill every cell (cells tile, so no alpha
    // build-up) and stroke only the BOUNDARY edges (an edge shared by two
    // fixed cells is internal → skipped). A bunch of adjacent fixed tables
    // therefore reads as ONE clean outlined region instead of a mess of
    // overlapping rectangle borders. Drawn data-space via a custom series.
    const fixedGeom = useMemo(() => {
        const fixedSet = fixedKeys || null;
        if (!showFixedOutline || !fixedSet || fixedSet.size === 0) return { cells: [], halfPx: 0 };
        const fix = (tables || []).filter((t) => fixedSet.has(t.key));
        if (!fix.length) return { cells: [], halfPx: 0 };

        // Coverage size = the table's PIXEL footprint (same 1.35× the symbol
        // the old per-table rect used), so each cell actually covers its
        // table. Uniform across the cluster = the largest fixed table.
        let halfPx = 0;
        for (const t of fix) {
            const svgDef = gametype_svg_path[t.gametype];
            const w = svgDef ? svgDef.size_X * SZ : 18;
            const hh = svgDef ? svgDef.size_Y * SZ : 18;
            halfPx = Math.max(halfPx, Math.max(w, hh));
        }
        halfPx = (halfPx * 1.35) / 2;

        // Grid step = smallest nearest-neighbour spacing across the whole
        // floor (≈ table pitch) — used only for adjacency, not for size.
        let step = Infinity;
        const all = tables || [];
        for (let i = 0; i < all.length; i++) {
            for (let j = i + 1; j < all.length; j++) {
                const d = Math.hypot(all[i].x - all[j].x, all[i].y - all[j].y);
                if (d > 0.5 && d < step) step = d;
            }
        }
        const GRID = Number.isFinite(step) ? step : 20;
        const x0 = Math.min(...fix.map((t) => t.x));
        const y0 = Math.min(...fix.map((t) => t.y));
        const ck = (c, r) => `${c},${r}`;
        const occ = new Map();
        for (const t of fix) {
            const c = Math.round((t.x - x0) / GRID), r = Math.round((t.y - y0) / GRID);
            occ.set(ck(c, r), { c, r, x: t.x, y: t.y });
        }
        // Each cell carries which of its 4 sides is a BOUNDARY (the adjacent
        // grid cell is NOT fixed). A side shared with another fixed table is
        // internal → no border there, so the cluster merges.
        const cells = [];
        for (const o of occ.values()) {
            cells.push({
                cx: o.x, cy: o.y,
                left:  !occ.has(ck(o.c - 1, o.r)),
                right: !occ.has(ck(o.c + 1, o.r)),
                up:    !occ.has(ck(o.c, o.r + 1)),
                down:  !occ.has(ck(o.c, o.r - 1)),
            });
        }
        return { cells, halfPx };
    }, [tables, fixedKeys, showFixedOutline, SZ]);

    // Change-highlight outlines — a per-table red (price higher at the compared
    // hour) / green (lower) rounded rectangle around each changed table.
    const changeGeom = useMemo(() => {
        const map = changeHighlights || null;
        if (!map || map.size === 0) return [];
        const out = [];
        for (const t of (tables || [])) {
            const dir = map.get(t.key);
            if (!dir) continue;
            const svgDef = gametype_svg_path[t.gametype];
            const w = ((svgDef ? svgDef.size_X * SZ : 18) * 1.5) / 2;
            const hh = ((svgDef ? svgDef.size_Y * SZ : 18) * 1.5) / 2;
            out.push({ cx: t.x, cy: t.y, dir, w, hh });
        }
        return out;
    }, [changeHighlights, tables, SZ]);

    // Pinned tables — a dashed gold ring a little outside the change outline,
    // so a pinned table that also changed shows both.
    // Manual prices get a solid ring instead.
    const pinGeom = useMemo(() => {
        const hasPin = pinnedKeys && pinnedKeys.size, hasMan = manualKeys && manualKeys.size;
        if (!hasPin && !hasMan) return [];
        const out = [];
        for (const t of (tables || [])) {
            const manual = !!(hasMan && manualKeys.has(t.key));
            if (!manual && !(hasPin && pinnedKeys.has(t.key))) continue;
            const svgDef = gametype_svg_path[t.gametype];
            out.push({ cx: t.x, cy: t.y, manual, w: ((svgDef ? svgDef.size_X * SZ : 18) * 1.75) / 2, hh: ((svgDef ? svgDef.size_Y * SZ : 18) * 1.75) / 2 });
        }
        return out;
    }, [pinnedKeys, manualKeys, tables, SZ]);

    // Init once; listeners read handlersRef so they never go stale.
    useEffect(() => {
        if (!ref.current) return;
        let inst = echarts.getInstanceByDom(ref.current);
        if (!inst) inst = echarts.init(ref.current, 'dark');
        instRef.current = inst;

        const onClick = (params) => {
            const meta = params?.data?.meta;
            if (!meta) return;
            const { onAssign: oA, onSelectionChange: oS, activeBrushShiftId: armed, readOnly: ro } = handlersRef.current;
            if (ro) return;
            if (armed) { if (oA) oA(meta.tableKey, armed); return; }
            if (oS) oS(new Set([meta.tableKey]), { clicked: meta.tableKey });
        };

        const onBrushSelected = (params) => {
            const batch = params?.batch?.[0];
            if (!batch) return;
            const sel = batch.selected?.[0];
            const indexes = sel?.dataIndex || [];
            const inst2 = instRef.current;
            if (!inst2) return;
            const opt = inst2.getOption();
            const data = opt?.series?.[0]?.data || [];
            const keys = new Set();
            for (const i of indexes) {
                const m = data[i]?.meta;
                if (m?.tableKey) keys.add(m.tableKey);
            }
            const { onSelectionChange: oS } = handlersRef.current;
            if (oS && (keys.size > 0 || (params.batch[0].areas || []).length === 0)) {
                oS(keys, { brushed: true });
            }
        };

        // visualMap piece toggle → bubble the opaque `selected` map up.
        const onVmRange = (params) => {
            const h = handlersRef.current;
            if (h.onVmSelected) h.onVmSelected(params.selected);
        };

        inst.on('click', { seriesIndex: 0 }, onClick);
        inst.on('brushselected', onBrushSelected);
        inst.on('datarangeselected', onVmRange);

        const ro = new ResizeObserver(() => requestAnimationFrame(() => inst.resize()));
        ro.observe(ref.current);

        return () => {
            ro.disconnect();
            inst.off('click', onClick);
            inst.off('brushselected', onBrushSelected);
            inst.off('datarangeselected', onVmRange);
            inst.dispose();
            instRef.current = null;
        };
    }, []);

    useEffect(() => {
        const inst = instRef.current;
        if (!inst) return;
        inst.setOption({
            backgroundColor: 'transparent',
            animation: false,
            grid: SCATTER_GRID,
            tooltip: {
                trigger: 'item',
                backgroundColor: 'rgba(10, 22, 35, 0.96)',
                borderColor: 'rgba(122, 200, 220, 0.4)',
                borderWidth: 1,
                padding: [10, 14],
                textStyle: { color: '#dff5ff', fontSize: FM.tooltipRow },
                formatter: (params) => {
                    const m = params?.data?.meta;
                    if (!m) return '';
                    const { readOnly: ro, flexEnabled: flex } = handlersRef.current;
                    const hint = ro
                        ? 'Reference plan — read only'
                        : handlersRef.current.activeBrushShiftId
                            ? 'Click to set the armed minimum'
                            : handlersRef.current.selectMode
                                ? 'Drag to lasso · click table to toggle'
                                : 'Click to select · arm Rect/Polygon for lasso';
                    // Pricing rows. When the Min–Max range is OFF, pricing is
                    // base-only — show just the minimum, no boundary row.
                    const baseCell = `<span><span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:${m.baseColor};margin-right:6px;vertical-align:middle"></span><b>${escapeHtml(m.baseLabel)}</b>${m.fixed ? ' <span style="color:#ffd479;font-weight:700">· FIXED</span>' : ''}</span>`;
                    let priceRows;
                    if (!m.priced) {
                        priceRows = `<span style="color:rgba(255,255,255,0.55)">Minimum</span><span style="color:rgba(255,255,255,0.5)">Unpriced</span>`;
                    } else if (!flex) {
                        priceRows = `<span style="color:rgba(255,255,255,0.55)">Minimum</span>${baseCell}`;
                    } else {
                        const boundaryVal = m.fixed
                            ? `<span style="color:#ffd479;font-weight:700">FIXED · locked</span>`
                            : (m.flexible ? `${escapeHtml(m.minLabel)} – ${escapeHtml(m.maxLabel)}` : `<span style="color:rgba(255,255,255,0.5)">no flex</span>`);
                        priceRows = `<span style="color:rgba(255,255,255,0.55)">Opening base</span>${baseCell}
                           <span style="color:rgba(255,255,255,0.55)">Boundary</span>
                           <span>${boundaryVal}</span>`;
                    }
                    const openRow = (m.isClosed === null) ? '' :
                        `<span style="color:rgba(255,255,255,0.55)">Scheduled</span>
                         <span style="color:${m.isClosed ? 'rgba(255,255,255,0.5)' : '#5ae6b0'};font-weight:700">${m.isClosed ? 'CLOSED — not running' : 'OPEN'}</span>`;
                    return `
                      <div style="min-width:210px">
                        <div style="font-weight:700;color:#7adfff;font-size:${FM.tooltipTitle}px;margin-bottom:6px;border-bottom:1px solid rgba(255,255,255,0.15);padding-bottom:6px">
                          ${escapeHtml(m.label)} · Pit ${escapeHtml(m.pit)}
                        </div>
                        <div style="display:grid;grid-template-columns:auto 1fr;gap:4px 12px;font-size:${FM.tooltipRow}px">
                          <span style="color:rgba(255,255,255,0.55)">Segment</span><span>${escapeHtml(m.segment)}</span>
                          ${priceRows}
                          ${openRow}
                        </div>
                        <div style="margin-top:6px;font-size:${FM.hint}px;color:rgba(255,255,255,0.45)">${hint}</div>
                      </div>
                    `;
                },
            },
            xAxis: { type: 'value', show: false, min: XAXIS_MIN, max: XAXIS_MAX },
            yAxis: { type: 'value', show: false, min: SCATTER_Y_MIN, max: SCATTER_Y_MAX, inverse: false },
            // Table-minimum visualMap LEGEND (scatter only) — colors priced
            // tables by minimum and filters by click (deselected → greyed).
            visualMap: sortedTiers.length ? {
                type: 'piecewise', show: true, dimension: 2, seriesIndex: 0,
                pieces: sortedTiers.map((t) => ({ value: t.min, label: t.label || formatMinimum(t.min), color: t.color })),
                ...(vmSelected ? { selected: vmSelected } : {}),
                selectedMode: 'multiple', hoverLink: false,
                outOfRange: { color: '#39434f', opacity: 0.3 },
                left: 8, top: 8, orient: 'vertical',
                itemWidth: 14, itemHeight: 14, itemGap: 4,
                textStyle: { color: '#dff5ff', fontSize: FM.visualMap, fontWeight: 700 },
                backgroundColor: 'rgba(10,22,35,0.82)', borderColor: 'rgba(122,200,220,0.22)', borderWidth: 1, padding: 6,
            } : undefined,
            toolbox: { show: false, feature: { brush: { type: ['rect', 'polygon', 'clear'] } } },
            brush: {
                xAxisIndex: 0,
                brushStyle: { borderWidth: 1.5, color: 'rgba(122, 223, 255, 0.08)', borderColor: 'rgba(122, 223, 255, 0.7)' },
                outOfBrush: { colorAlpha: 0.35 },
                throttleType: 'debounce', throttleDelay: 120,
            },
            series: [
                { type: 'scatter', data: seriesData, cursor: 'pointer', emphasis: { focus: 'none', scale: 1.08 } },
                // Fixed-price MERGED overlay — fills tile + only boundary edges
                // are stroked, so adjacent fixed tables form one clean region.
                // Silent so it never steals clicks/tooltips from the floor.
                ...(fixedGeom.cells.length ? [{
                    type: 'custom', silent: true, z: 3, animation: false, tooltip: { show: false },
                    data: [[(SCATTER_X_MIN + SCATTER_X_MAX) / 2, (SCATTER_Y_MIN + SCATTER_Y_MAX) / 2]],
                    renderItem: (params, api) => {
                        const H = fixedGeom.halfPx;
                        const children = [];
                        // Fills first (cells overlap → reads as one tinted blob).
                        for (const c of fixedGeom.cells) {
                            const p = api.coord([c.cx, c.cy]);
                            children.push({
                                type: 'rect', silent: true,
                                shape: { x: p[0] - H, y: p[1] - H, width: 2 * H, height: 2 * H },
                                style: { fill: 'rgba(255,212,121,0.10)' },
                            });
                        }
                        // Then only the BOUNDARY edges (internal sides skipped).
                        for (const c of fixedGeom.cells) {
                            const p = api.coord([c.cx, c.cy]);
                            const L = p[0] - H, R = p[0] + H, T = p[1] - H, B = p[1] + H;
                            const seg = (x1, y1, x2, y2) => children.push({
                                type: 'line', silent: true,
                                shape: { x1, y1, x2, y2 },
                                style: { stroke: '#ffd479', lineWidth: 2 },
                            });
                            if (c.left) seg(L, T, L, B);
                            if (c.right) seg(R, T, R, B);
                            if (c.up) seg(L, T, R, T);
                            if (c.down) seg(L, B, R, B);
                        }
                        return { type: 'group', children };
                    },
                }] : []),
                // Change-highlight outlines (z above everything) — red = price
                // higher at the compared hour, green = lower.
                ...(changeGeom.length ? [{
                    type: 'custom', silent: true, z: 6, animation: false, tooltip: { show: false },
                    data: [[(SCATTER_X_MIN + SCATTER_X_MAX) / 2, (SCATTER_Y_MIN + SCATTER_Y_MAX) / 2]],
                    renderItem: (params, api) => {
                        const children = [];
                        for (const c of changeGeom) {
                            const p = api.coord([c.cx, c.cy]);
                            const color = c.dir === 'up' ? changeColors.up : changeColors.down;
                            children.push({
                                type: 'rect', silent: true,
                                shape: { x: p[0] - c.w, y: p[1] - c.hh, width: 2 * c.w, height: 2 * c.hh, r: 3 },
                                style: { fill: 'transparent', stroke: color, lineWidth: 2.5, shadowBlur: 7, shadowColor: color },
                            });
                        }
                        return { type: 'group', children };
                    },
                }] : []),
                ...(pinGeom.length ? [{
                    type: 'custom', silent: true, z: 7, animation: false, tooltip: { show: false },
                    data: [[(SCATTER_X_MIN + SCATTER_X_MAX) / 2, (SCATTER_Y_MIN + SCATTER_Y_MAX) / 2]],
                    renderItem: (params, api) => ({
                        type: 'group',
                        children: pinGeom.map((c) => {
                            const p = api.coord([c.cx, c.cy]);
                            return {
                                type: 'rect', silent: true,
                                shape: { x: p[0] - c.w, y: p[1] - c.hh, width: 2 * c.w, height: 2 * c.hh, r: 4 },
                                style: c.manual
                                    ? { fill: 'transparent', stroke: '#ffcd78', lineWidth: 2.5 }
                                    : { fill: 'transparent', stroke: '#ffcd78', lineWidth: 2, lineDash: [4, 3] },
                            };
                        }),
                    }),
                }] : []),
            ],
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [seriesData, fixedGeom, changeGeom, pinGeom, sortedTiers, vmSelected, mode]);

    useEffect(() => {
        const inst = instRef.current;
        if (!inst) return;
        if (selectMode) {
            inst.dispatchAction({ type: 'takeGlobalCursor', key: 'brush', brushOption: { brushType: selectMode, brushMode: 'single' } });
        } else {
            inst.dispatchAction({ type: 'takeGlobalCursor', key: 'brush', brushOption: { brushType: false } });
        }
    }, [selectMode]);

    const selEmpty = !selectedKeys || selectedKeys.size === 0;
    useEffect(() => {
        const inst = instRef.current;
        if (!inst || !selEmpty) return;
        inst.dispatchAction({ type: 'brush', areas: [] });
    }, [selEmpty]);

    return (
        <Box sx={{ width: '100%', height: '100%', position: 'relative', bgcolor: 'rgba(8, 22, 36, 0.4)', borderRadius: 2, border: '1px solid rgba(122, 200, 220, 0.12)', overflow: 'hidden' }}>
            <div ref={ref} style={{ width: '100%', height: '100%' }} />

            {/* Date picker — overlaid on the top-right corner of the scatter,
                with a schedule-loaded dot. */}
            {onDateChange && (
                <Box sx={{ position: 'absolute', top: 10, right: 10, zIndex: 6, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 0.5 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.7 }}>
                        {dateLocked ? (
                            <Tooltip title="Locked to Date A in same-date comparison mode">
                                <Box sx={{
                                    display: 'flex', alignItems: 'center', height: 34, px: 1, fontSize: FM.dateOverlay, fontWeight: 800, fontFamily: 'inherit',
                                    color: 'rgba(255,255,255,0.65)', bgcolor: 'rgba(10,22,35,0.55)', border: '1px dashed rgba(122,200,220,0.4)',
                                    borderRadius: 1.2, backdropFilter: 'blur(6px)', whiteSpace: 'nowrap',
                                }}>
                                    {date || '—'} <Box component="span" sx={{ ml: 0.6, opacity: 0.65, fontSize: FM.dateOverlay - 2 }}>(= A)</Box>
                                </Box>
                            </Tooltip>
                        ) : (
                            <Box component="input" type="date" value={date || ''} onChange={(e) => onDateChange(e.target.value)}
                                sx={{
                                    display: 'block', boxSizing: 'border-box', height: 34, px: 1, fontSize: FM.dateOverlay, fontWeight: 800, fontFamily: 'inherit',
                                    color: '#fff', bgcolor: 'rgba(10,22,35,0.9)', border: '1px solid rgba(122,200,220,0.4)',
                                    borderRadius: 1.2, colorScheme: 'dark', outline: 'none', backdropFilter: 'blur(6px)',
                                    '&::-webkit-calendar-picker-indicator': { filter: 'invert(1)', opacity: 0.7, cursor: 'pointer' },
                                }} />
                        )}
                        {scheduleLoading
                            ? <Box sx={{ width: 11, height: 11, borderRadius: '50%', bgcolor: 'rgba(255,255,255,0.4)', flexShrink: 0 }} />
                            : <Tooltip title={scheduleLoaded ? 'Spread schedule loaded for this date' : 'No spread schedule for this date'}>
                                <Box sx={{ width: 11, height: 11, borderRadius: '50%', flexShrink: 0, bgcolor: scheduleLoaded ? '#5ae6b0' : 'rgba(255,255,255,0.25)', boxShadow: scheduleLoaded ? '0 0 8px rgba(90,230,176,0.8)' : 'none' }} />
                            </Tooltip>}
                    </Box>
                    {dateOverlayExtra}
                </Box>
            )}

            {!readOnly && (
                <Stack direction="row" spacing={0}
                    sx={{ position: 'absolute', bottom: 12, left: 12, zIndex: 5, border: '1px solid rgba(122, 200, 220, 0.3)', borderRadius: 1.2, overflow: 'hidden', bgcolor: 'rgba(10, 22, 35, 0.85)', backdropFilter: 'blur(8px)' }}>
                    {[
                        { v: null, label: 'Pointer', icon: <NearMeIcon sx={{ fontSize: 17 }} /> },
                        { v: 'rect', label: 'Rectangle', icon: <HighlightAltIcon sx={{ fontSize: 17 }} /> },
                        { v: 'polygon', label: 'Polygon', icon: <PolylineIcon sx={{ fontSize: 17 }} /> },
                    ].map((opt) => {
                        const active = selectMode === opt.v;
                        return (
                            <Box key={String(opt.v)} onClick={() => setSelectMode(opt.v)}
                                sx={{
                                    display: 'flex', alignItems: 'center', gap: 0.6, px: 1.4, py: 1.1, cursor: 'pointer',
                                    fontSize: FM.modePill, fontWeight: 700, letterSpacing: 0.4,
                                    color: active ? '#0a1a2c' : 'rgba(255,255,255,0.7)',
                                    bgcolor: active ? '#7adfff' : 'transparent',
                                    transition: 'background-color 150ms, color 150ms',
                                    '&:hover': active ? undefined : { bgcolor: 'rgba(122,223,255,0.10)' },
                                }}>
                                {opt.icon}{opt.label}
                            </Box>
                        );
                    })}
                </Stack>
            )}

            {/* ⚙ Symbol-size adjuster — top-right of the scatter (just below
                the date overlay). Opens a slider popover that scales every
                table icon on this floor map. Per-mode value persists.
                When the date overlay carries an extra control (same-date
                comparison mode slots an hour dropdown below the date picker
                there), push this button further down so it doesn't overlap. */}
            <Tooltip title="Symbol size">
                <Box onClick={() => setSizePopoverOpen((v) => !v)}
                    sx={{
                        position: 'absolute', top: dateOverlayExtra ? 88 : 52, right: 10, zIndex: 6,
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
            {sizePopoverOpen && (
                <Box sx={{
                    position: 'absolute', top: dateOverlayExtra ? 126 : 90, right: 10, zIndex: 7, width: 240,
                    p: 1.2, borderRadius: 1.4,
                    bgcolor: 'rgba(10,22,35,0.96)', border: '1px solid rgba(122,200,220,0.4)',
                    boxShadow: '0 8px 24px rgba(0,0,0,0.4)', backdropFilter: 'blur(8px)',
                }}>
                    <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 0.8 }}>
                        <Typography sx={{ fontSize: 12.5, fontWeight: 800, color: '#dff5ff', letterSpacing: 0.4, textTransform: 'uppercase' }}>Symbol size</Typography>
                        <Box onClick={() => setSizePopoverOpen(false)} sx={{ cursor: 'pointer', color: 'rgba(255,255,255,0.55)', display: 'flex', '&:hover': { color: '#fff' } }}>
                            <CloseIcon sx={{ fontSize: 16 }} />
                        </Box>
                    </Stack>
                    <Stack direction="row" alignItems="center" spacing={0.8} sx={{ mb: 0.6 }}>
                        <Typography sx={{ fontSize: 11, color: 'rgba(255,255,255,0.55)', minWidth: 32 }}>{SYMBOL_SIZE_MIN}×</Typography>
                        <Box component="input" type="range" min={SYMBOL_SIZE_MIN} max={SYMBOL_SIZE_MAX} step={SYMBOL_SIZE_STEP} value={SZ}
                            onChange={(e) => setSZ(parseFloat(e.target.value))}
                            sx={{
                                flex: 1, accentColor: '#7adfff', height: 6, cursor: 'pointer',
                                '&::-webkit-slider-thumb': { cursor: 'pointer' },
                            }} />
                        <Typography sx={{ fontSize: 11, color: 'rgba(255,255,255,0.55)', minWidth: 32, textAlign: 'right' }}>{SYMBOL_SIZE_MAX}×</Typography>
                    </Stack>
                    <Stack direction="row" alignItems="center" justifyContent="space-between">
                        <Typography sx={{ fontSize: 20, fontWeight: 800, color: '#7adfff', fontVariantNumeric: 'tabular-nums' }}>{SZ.toFixed(2)}×</Typography>
                        <Stack direction="row" spacing={0.5}>
                            <Box onClick={() => setSZ((v) => Math.max(SYMBOL_SIZE_MIN, +(v - SYMBOL_SIZE_STEP).toFixed(2)))} sx={{ cursor: 'pointer', width: 26, height: 26, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 0.8, bgcolor: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.15)', color: '#dff5ff', fontWeight: 800, '&:hover': { bgcolor: 'rgba(255,255,255,0.12)' } }}>−</Box>
                            <Box onClick={() => setSZ((v) => Math.min(SYMBOL_SIZE_MAX, +(v + SYMBOL_SIZE_STEP).toFixed(2)))} sx={{ cursor: 'pointer', width: 26, height: 26, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 0.8, bgcolor: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.15)', color: '#dff5ff', fontWeight: 800, '&:hover': { bgcolor: 'rgba(255,255,255,0.12)' } }}>+</Box>
                            <Box onClick={resetSize} title={`Reset to default (${defaultSize}×)`} sx={{ ml: 0.5, cursor: 'pointer', px: 0.8, height: 26, display: 'flex', alignItems: 'center', borderRadius: 0.8, bgcolor: 'rgba(122,223,255,0.12)', border: '1px solid rgba(122,223,255,0.4)', color: '#7adfff', fontSize: 11, fontWeight: 800, '&:hover': { bgcolor: 'rgba(122,223,255,0.2)' } }}>Reset</Box>
                        </Stack>
                    </Stack>
                    <Typography sx={{ fontSize: 10.5, color: 'rgba(255,255,255,0.45)', mt: 0.6 }}>
                        Default for {mode === 'comparison' ? 'comparison' : 'planning'}: {defaultSize}×
                    </Typography>
                </Box>
            )}

            {/* Legends — closed (black) tables + fixed-price overlay. Stacked
                at the bottom-left, directly ABOVE the Pointer toggle group. */}
            {((closedKeys && closedKeys.size > 0) || (showFixedOutline && fixedKeys && fixedKeys.size > 0) || (pinnedKeys && pinnedKeys.size > 0) || (manualKeys && manualKeys.size > 0)) && (
                <Stack spacing={0.5} sx={{ position: 'absolute', bottom: 56, left: 12, zIndex: 5, alignItems: 'flex-start' }}>
                    {manualKeys && manualKeys.size > 0 && (
                        <Stack direction="row" spacing={0.6} sx={{ alignItems: 'center', px: 1, py: 0.5, borderRadius: 1, bgcolor: 'rgba(10,22,35,0.8)', border: '1px solid rgba(255,255,255,0.08)' }}>
                            <Box sx={{ width: 12, height: 12, borderRadius: '3px', border: '2.5px solid #ffcd78' }} />
                            <Typography sx={{ color: 'rgba(255,255,255,0.7)', fontSize: FM.legend, fontWeight: 700 }}>manual price · rule ({manualKeys.size})</Typography>
                        </Stack>
                    )}
                    {pinnedKeys && pinnedKeys.size > 0 && (
                        <Stack direction="row" spacing={0.6} sx={{ alignItems: 'center', px: 1, py: 0.5, borderRadius: 1, bgcolor: 'rgba(10,22,35,0.8)', border: '1px solid rgba(255,255,255,0.08)' }}>
                            <Box sx={{ width: 12, height: 12, borderRadius: '3px', border: '2px dashed #ffcd78' }} />
                            <Typography sx={{ color: 'rgba(255,255,255,0.7)', fontSize: FM.legend, fontWeight: 700 }}>pinned · kept by Auto-plan ({pinnedKeys.size})</Typography>
                        </Stack>
                    )}
                    {showFixedOutline && fixedKeys && fixedKeys.size > 0 && (
                        <Stack direction="row" alignItems="center" spacing={0.6} sx={{ px: 1, py: 0.5, borderRadius: 1, bgcolor: 'rgba(10,22,35,0.8)', border: '1px solid rgba(255,255,255,0.08)' }}>
                            <Box sx={{ width: 12, height: 12, borderRadius: '2px', border: '2px solid #ffd479', bgcolor: 'rgba(255,212,121,0.10)' }} />
                            <Typography sx={{ color: 'rgba(255,255,255,0.7)', fontSize: FM.legend, fontWeight: 700 }}>fixed price (locked)</Typography>
                        </Stack>
                    )}
                    {closedKeys && closedKeys.size > 0 && (
                        <Stack direction="row" alignItems="center" spacing={0.6} sx={{ px: 1, py: 0.5, borderRadius: 1, bgcolor: 'rgba(10,22,35,0.8)', border: '1px solid rgba(255,255,255,0.08)' }}>
                            <Box sx={{ width: 12, height: 12, borderRadius: '3px', bgcolor: '#000', border: '1px solid rgba(255,255,255,0.25)' }} />
                            <Typography sx={{ color: 'rgba(255,255,255,0.7)', fontSize: FM.legend, fontWeight: 700 }}>closed (not scheduled)</Typography>
                        </Stack>
                    )}
                </Stack>
            )}

            {(!tables || tables.length === 0) && (
                <Box sx={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'rgba(255,255,255,0.4)' }}>
                    <Typography sx={{ fontSize: FM.empty, fontStyle: 'italic' }}>No tables in the floor config for this date.</Typography>
                </Box>
            )}
        </Box>
    );
}

function escapeHtml(s) {
    return String(s || '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
