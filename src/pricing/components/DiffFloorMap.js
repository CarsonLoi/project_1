// DiffFloorMap (pricing) — read-only floor for the Compare view
// =============================================================
//
// Cloned/trimmed from the scheduling FloorScheduleMap so the pricing
// Compare view does not depend on the spread module. Read-only: it colors
// every table by the COLOR of the synthetic status "shift" it's assigned
// (added / removed / reassigned / unchanged from planDiff) — no selection,
// brushing, or editing. Tooltip shows the table + its diff status.

import React, { useEffect, useMemo, useRef } from 'react';
import * as echarts from 'echarts';
import { Box, Typography } from '@mui/material';
import {
    gametype_svg_path,
    SCATTER_X_MIN, SCATTER_X_MAX, SCATTER_Y_MIN, SCATTER_Y_MAX,
    SCATTER_SYMBOL_SIZE_MULTIPLIER as SZ,
    SCATTER_GRID,
} from '../../shared/constants/heatmapConstants';
import { PRICING_FONTS } from '../constants/fontSizes';

const FM = PRICING_FONTS.floorMap;

const UNASSIGNED_COLOR = 'rgba(120, 130, 145, 0.40)';

export default function DiffFloorMap({ tables, assignments, shifts }) {
    const ref = useRef(null);
    const instRef = useRef(null);

    const shiftMap = useMemo(() => new Map((shifts || []).map((s) => [s.id, s])), [shifts]);

    const seriesData = useMemo(() => {
        return (tables || []).map((t) => {
            const statusId = (assignments || {})[t.key];
            const shift = statusId ? shiftMap.get(statusId) : null;
            const svgDef = gametype_svg_path[t.gametype];
            const fill = shift?.color || UNASSIGNED_COLOR;
            return {
                name: t.label || t.key,
                value: [t.x, t.y],
                symbol: svgDef ? 'path://' + svgDef.path : 'circle',
                symbolSize: svgDef ? [svgDef.size_X * SZ, svgDef.size_Y * SZ] : 18,
                symbolRotate: t.rotation || 0,
                itemStyle: {
                    color: fill,
                    borderColor: 'rgba(255,255,255,0.18)',
                    borderWidth: 0.5,
                    opacity: shift ? 0.95 : 0.45,
                },
                meta: {
                    label: t.label,
                    pit: t.pit,
                    segment: t.sub_segment || t.area || '—',
                    statusName: shift?.name || 'No change / closed',
                    statusColor: shift?.color || UNASSIGNED_COLOR,
                },
            };
        });
    }, [tables, assignments, shiftMap]);

    useEffect(() => {
        if (!ref.current) return;
        let inst = echarts.getInstanceByDom(ref.current);
        if (!inst) inst = echarts.init(ref.current, 'dark');
        instRef.current = inst;
        const ro = new ResizeObserver(() => requestAnimationFrame(() => inst.resize()));
        ro.observe(ref.current);
        return () => { ro.disconnect(); inst.dispose(); instRef.current = null; };
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
                    return `
                      <div style="min-width:190px">
                        <div style="font-weight:700;color:#7adfff;font-size:${FM.tooltipTitle}px;margin-bottom:6px;border-bottom:1px solid rgba(255,255,255,0.15);padding-bottom:6px">
                          ${escapeHtml(m.label)} · Pit ${escapeHtml(m.pit)}
                        </div>
                        <div style="display:grid;grid-template-columns:auto 1fr;gap:4px 12px;font-size:${FM.tooltipRow}px">
                          <span style="color:rgba(255,255,255,0.55)">Segment</span><span>${escapeHtml(m.segment)}</span>
                          <span style="color:rgba(255,255,255,0.55)">Status</span>
                          <span><span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:${m.statusColor};margin-right:6px;vertical-align:middle"></span>${escapeHtml(m.statusName)}</span>
                        </div>
                      </div>
                    `;
                },
            },
            xAxis: { type: 'value', show: false, min: SCATTER_X_MIN, max: SCATTER_X_MAX },
            yAxis: { type: 'value', show: false, min: SCATTER_Y_MIN, max: SCATTER_Y_MAX, inverse: false },
            series: [{ type: 'scatter', data: seriesData, silent: false }],
        });
    }, [seriesData]);

    return (
        <Box sx={{ width: '100%', height: '100%', position: 'relative' }}>
            <div ref={ref} style={{ width: '100%', height: '100%' }} />
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
