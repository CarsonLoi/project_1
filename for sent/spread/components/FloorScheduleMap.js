// FloorScheduleMap — interactive table floor for shift assignment
// ================================================================
//
// Renders every table with its REAL SVG shape (gametype_svg_path) at
// its real position + rotation — identical visual language to the
// Performance Heatmap scatter, so users moving between the two
// dashboards see the same floor. Fill color = assigned shift's color
// (grey when unassigned).
//
// Selection model (production flow):
//   1. Pick a selection mode from the top-left pill — Rect or Polygon.
//      The cursor arms immediately; drag (rect) or click-click-dblclick
//      (polygon) to lasso tables.
//   2. The floating SelectionActionBar (rendered by the parent) appears
//      with bulk actions: assign / adjust / remove shift, clear.
//   3. Esc or "Clear" empties the selection and wipes the brush trace.
//
//   • Single click on a table (no mode armed) toggles it in/out of the
//     selection — quick way to fine-tune a lasso result or build a
//     small selection without arming a mode.
//   • If a shift is "armed" in the ShiftPalette (activeBrushShiftId),
//     clicking a table assigns that shift directly — the fast path for
//     one-off touch-ups.
//
// Props:
//   tables             — Array<{ key, label, gametype, x, y, rotation,
//                                pit, area, sub_segment }>
//   assignments        — { [tableKey]: shiftId }
//   shifts             — Array<ShiftTemplate>
//   selectedKeys       — Set<string>
//   activeBrushShiftId — string | null (shift to assign on click)
//   onSelectionChange  — (Set<string>, info) => void
//   onAssign           — (tableKey, shiftId | null) => void

import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as echarts from 'echarts';
import { Box, Typography, Stack } from '@mui/material';
import HighlightAltIcon from '@mui/icons-material/HighlightAlt';
import PolylineIcon from '@mui/icons-material/Polyline';
import NearMeIcon from '@mui/icons-material/NearMe';
import {
    gametype_svg_path,
    SCATTER_X_MIN, SCATTER_X_MAX, SCATTER_Y_MIN, SCATTER_Y_MAX,
    SCATTER_SYMBOL_SIZE_MULTIPLIER as SZ,
    SCATTER_GRID,
} from '../../shared/constants/heatmapConstants';
import { UNASSIGNED_COLOR, UNASSIGNED_LABEL, shiftLengthColor } from '../constants/defaultShifts';
import { shiftCoversHour, formatShiftRange, shiftLengthHours } from '../utils/shiftCoverage';

// Two-color palette for hourly mode — green = open at this hour,
// grey = closed/unassigned. Kept module-scoped so the same shade pair
// is used by ReferenceFloorMap and any future hourly consumers.
const HOURLY_OPEN_COLOR   = '#3dd585';
const HOURLY_CLOSED_COLOR = 'rgba(120, 130, 145, 0.40)';

export default function FloorScheduleMap({
    tables,
    assignments,
    shifts,
    selectedKeys,
    activeBrushShiftId,
    onSelectionChange,
    onAssign,
    // `mode`:
    //   'overall' (default) — fill = assigned shift's color
    //   'hourly'           — fill = green if shift covers `currentHour`,
    //                        grey otherwise. Selection still works but
    //                        the action bar consumers should usually
    //                        suppress edits while the timeline plays.
    mode = 'overall',
    currentHour = 6,
    // `colorMode` (overall view only):
    //   'shift'  (default) — each table = its assigned shift's own color
    //   'length'           — each table = its shift-LENGTH band color
    //                        (24h / 16h / 8h / 0h)
    colorMode = 'shift',
    // `readOnly` — disables hover/cursor + click handlers. Used by
    // ReferenceFloorMap so the reference plan can't be edited from
    // the bottom-row read-only surface.
    readOnly = false,
}) {
    const ref = useRef(null);
    const instRef = useRef(null);
    // Selection mode: 'rect' | 'polygon' | null (pointer). Owned here
    // because arming/disarming is a chart-level concern (dispatches
    // takeGlobalCursor); the parent only cares about the resulting
    // selection set.
    const [selectMode, setSelectMode] = useState(null);
    // Stable refs so chart listeners (attached once) read fresh values.
    const handlersRef = useRef({});
    handlersRef.current = { onSelectionChange, onAssign, activeBrushShiftId, selectMode, mode, currentHour, readOnly };

    const shiftMap = useMemo(
        () => new Map((shifts || []).map((s) => [s.id, s])),
        [shifts]
    );

    // One ECharts point per table — real SVG shape, size, rotation.
    // Fill resolution depends on `mode`:
    //   • overall — shift's assigned color (or grey for unassigned)
    //   • hourly  — green if the assigned shift covers currentHour,
    //               grey otherwise. Reads identical to the way the
    //               Performance Heatmap's hourly play view shades cells.
    const seriesData = useMemo(() => {
        const sel = selectedKeys || new Set();
        return (tables || []).map((t) => {
            const shiftId = (assignments || {})[t.key];
            const shift = shiftId ? shiftMap.get(shiftId) : null;
            const isSelected = sel.has(t.key);
            const svgDef = gametype_svg_path[t.gametype];

            let fill;
            if (mode === 'hourly') {
                fill = shift && shiftCoversHour(shift, currentHour)
                    ? HOURLY_OPEN_COLOR
                    : HOURLY_CLOSED_COLOR;
            } else if (colorMode === 'length') {
                // Color by shift LENGTH band (24h / 16h / 8h / 0h).
                fill = shift ? shiftLengthColor(shiftLengthHours(shift)) : shiftLengthColor(0);
            } else {
                fill = shift?.color || UNASSIGNED_COLOR;
            }

            return {
                name: t.label || t.key,
                value: [t.x, t.y],
                symbol: svgDef ? 'path://' + svgDef.path : 'circle',
                symbolSize: svgDef ? [svgDef.size_X * SZ, svgDef.size_Y * SZ] : 18,
                symbolRotate: t.rotation || 0,
                itemStyle: {
                    color: fill,
                    borderColor: isSelected ? '#ffffff' : 'rgba(255,255,255,0.18)',
                    borderWidth: isSelected ? 2 : 0.5,
                    opacity: mode === 'hourly'
                        ? (shift && shiftCoversHour(shift, currentHour) ? 0.95 : 0.40)
                        : (shift ? 0.95 : 0.5),
                    shadowBlur: isSelected ? 12 : 0,
                    shadowColor: isSelected ? 'rgba(255,255,255,0.65)' : 'transparent',
                },
                meta: {
                    tableKey:    t.key,
                    label:       t.label,
                    pit:         t.pit,
                    area:        t.area,
                    sub_segment: t.sub_segment,
                    shiftId,
                    shiftName:   shift?.name || UNASSIGNED_LABEL,
                    shiftColor:  shift?.color || UNASSIGNED_COLOR,
                    shiftRange:  shift ? formatShiftRange(shift) : '—',
                    // Hourly-mode meta — used by the tooltip to make
                    // "open at 14:00 because of shift B (11→02)" clear.
                    openNow: mode === 'hourly' && shift && shiftCoversHour(shift, currentHour),
                },
            };
        });
    }, [tables, assignments, shiftMap, selectedKeys, mode, currentHour, colorMode]);

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
            if (ro) return; // ReferenceFloorMap path — never edit
            if (armed) {
                if (oA) oA(meta.tableKey, armed);
                return;
            }
            if (oS) oS(new Set([meta.tableKey]), { clicked: meta.tableKey });
        };

        const onBrushSelected = (params) => {
            const batch = params?.batch?.[0];
            if (!batch) return;
            // An empty batch (user cleared the brush via toolbox) emits
            // with no selected indexes — treat as "selection cleared by
            // brush", not a no-op, so the action bar dismisses.
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
            // Only emit when the brush actually produced something or
            // explicitly cleared — brushselected fires on every mouse
            // move during a drag, and emitting empty mid-gesture would
            // flicker the action bar.
            if (oS && (keys.size > 0 || (params.batch[0].areas || []).length === 0)) {
                oS(keys, { brushed: true });
            }
        };

        inst.on('click', { seriesIndex: 0 }, onClick);
        inst.on('brushselected', onBrushSelected);

        const ro = new ResizeObserver(() => requestAnimationFrame(() => inst.resize()));
        ro.observe(ref.current);

        return () => {
            ro.disconnect();
            inst.off('click', onClick);
            inst.off('brushselected', onBrushSelected);
            inst.dispose();
            instRef.current = null;
        };
    }, []);

    // Push option on data/selection change. notMerge=false here — the
    // brush component keeps its in-flight areas across re-renders, so
    // mid-lasso updates (e.g. the parent re-rendering on selection
    // change) don't wipe the user's polygon-in-progress.
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
                textStyle: { color: '#dff5ff', fontSize: 16 },
                formatter: (params) => {
                    const m = params?.data?.meta;
                    if (!m) return '';
                    const { mode: mm, currentHour: ch, readOnly: ro } = handlersRef.current;
                    const segment = m.sub_segment || m.area || '—';
                    const hint = ro
                        ? 'Reference plan — read only'
                        : handlersRef.current.activeBrushShiftId
                            ? 'Click to assign the armed shift'
                            : handlersRef.current.selectMode
                                ? 'Drag to lasso · click table to toggle'
                                : 'Click to select · arm Rect/Polygon for lasso';
                    const hourlyRow = mm === 'hourly'
                        ? `<span style="color:rgba(255,255,255,0.55)">At ${String(ch).padStart(2, '0')}:00</span>
                           <span style="color:${m.openNow ? '#3dd585' : 'rgba(255,255,255,0.55)'};font-weight:700">${m.openNow ? 'OPEN' : 'CLOSED'}</span>`
                        : '';
                    return `
                      <div style="min-width:200px">
                        <div style="font-weight:700;color:#7adfff;font-size:20px;margin-bottom:6px;border-bottom:1px solid rgba(255,255,255,0.15);padding-bottom:6px">
                          ${escapeHtml(m.label)} · Pit ${escapeHtml(m.pit)}
                        </div>
                        <div style="display:grid;grid-template-columns:auto 1fr;gap:4px 12px;font-size:16px">
                          <span style="color:rgba(255,255,255,0.55)">Segment</span><span>${escapeHtml(segment)}</span>
                          <span style="color:rgba(255,255,255,0.55)">Shift</span>
                          <span><span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:${m.shiftColor};margin-right:6px;vertical-align:middle"></span>${escapeHtml(m.shiftName)}</span>
                          <span style="color:rgba(255,255,255,0.55)">Hours</span><span>${escapeHtml(m.shiftRange)}</span>
                          ${hourlyRow}
                        </div>
                        <div style="margin-top:6px;font-size:13px;color:rgba(255,255,255,0.45)">${hint}</div>
                      </div>
                    `;
                },
            },
            // Same coordinate space as the Performance Heatmap scatter
            // so the floor renders identically across dashboards.
            xAxis: { type: 'value', show: false, min: SCATTER_X_MIN, max: SCATTER_X_MAX },
            yAxis: { type: 'value', show: false, min: SCATTER_Y_MIN, max: SCATTER_Y_MAX, inverse: false },
            // Brush is configured but the toolbox icons are hidden —
            // the mode pills below own arming/disarming via
            // takeGlobalCursor, which gives 44px touch targets instead
            // of ECharts' tiny icons.
            toolbox: { show: false, feature: { brush: { type: ['rect', 'polygon', 'clear'] } } },
            brush: {
                xAxisIndex: 0,
                brushStyle: {
                    borderWidth: 1.5,
                    color: 'rgba(122, 223, 255, 0.08)',
                    borderColor: 'rgba(122, 223, 255, 0.7)',
                },
                outOfBrush: { colorAlpha: 0.35 },
                throttleType: 'debounce',
                throttleDelay: 120,
            },
            series: [{
                type: 'scatter',
                data: seriesData,
                cursor: 'pointer',
                emphasis: { focus: 'none', scale: 1.08 },
            }],
        });
    }, [seriesData]);

    // Arm / disarm the brush cursor when the mode pills change.
    useEffect(() => {
        const inst = instRef.current;
        if (!inst) return;
        if (selectMode) {
            inst.dispatchAction({
                type: 'takeGlobalCursor',
                key: 'brush',
                brushOption: { brushType: selectMode, brushMode: 'single' },
            });
        } else {
            inst.dispatchAction({ type: 'takeGlobalCursor', key: 'brush', brushOption: { brushType: false } });
        }
    }, [selectMode]);

    // When the parent empties the selection (Clear button / Esc), wipe
    // the brush trace too — otherwise the lasso outline lingers on the
    // floor with nothing selected, which reads as a broken state.
    const selEmpty = !selectedKeys || selectedKeys.size === 0;
    useEffect(() => {
        const inst = instRef.current;
        if (!inst || !selEmpty) return;
        inst.dispatchAction({ type: 'brush', areas: [] });
    }, [selEmpty]);

    return (
        <Box sx={{
            width: '100%',
            height: '100%',
            position: 'relative',
            bgcolor: 'rgba(8, 22, 36, 0.4)',
            borderRadius: 2,
            border: '1px solid rgba(122, 200, 220, 0.12)',
            overflow: 'hidden',
        }}>
            <div ref={ref} style={{ width: '100%', height: '100%' }} />

            {/* Selection-mode pills — BOTTOM-left (the parent's action
                bar is bottom-CENTER, so no collision). Pointer is the
                default; Rect / Polygon arm the lasso. Active pill is
                filled cyan; all targets ≥44px tall for touch.
                Hidden in readOnly mode (reference floor view). */}
            {!readOnly && <Stack
                direction="row"
                spacing={0}
                sx={{
                    position: 'absolute',
                    bottom: 12,
                    left: 12,
                    zIndex: 5,
                    border: '1px solid rgba(122, 200, 220, 0.3)',
                    borderRadius: 1.2,
                    overflow: 'hidden',
                    bgcolor: 'rgba(10, 22, 35, 0.85)',
                    backdropFilter: 'blur(8px)',
                }}
            >
                {[
                    { v: null,      label: 'Pointer', icon: <NearMeIcon sx={{ fontSize: 17 }} /> },
                    { v: 'rect',    label: 'Rectangle', icon: <HighlightAltIcon sx={{ fontSize: 17 }} /> },
                    { v: 'polygon', label: 'Polygon', icon: <PolylineIcon sx={{ fontSize: 17 }} /> },
                ].map((opt) => {
                    const active = selectMode === opt.v;
                    return (
                        <Box
                            key={String(opt.v)}
                            onClick={() => setSelectMode(opt.v)}
                            sx={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 0.6,
                                px: 1.4,
                                py: 1.1,
                                cursor: 'pointer',
                                fontSize: 13,
                                fontWeight: 700,
                                letterSpacing: 0.4,
                                color: active ? '#0a1a2c' : 'rgba(255,255,255,0.7)',
                                bgcolor: active ? '#7adfff' : 'transparent',
                                transition: 'background-color 150ms, color 150ms',
                                '&:hover': active ? undefined : { bgcolor: 'rgba(122,223,255,0.10)' },
                            }}
                        >
                            {opt.icon}{opt.label}
                        </Box>
                    );
                })}
            </Stack>}

            {(!tables || tables.length === 0) && (
                <Box sx={{
                    position: 'absolute',
                    inset: 0,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: 'rgba(255,255,255,0.4)',
                }}>
                    <Typography sx={{ fontSize: 18, fontStyle: 'italic' }}>
                        No tables in the floor config for this date.
                    </Typography>
                </Box>
            )}
        </Box>
    );
}

const pad = (n) => `${String(((Math.round(Number(n)) % 24) + 24) % 24).padStart(2, '0')}:00`;
function escapeHtml(s) {
    return String(s || '').replace(/[&<>"]/g, (c) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;',
    }[c]));
}
