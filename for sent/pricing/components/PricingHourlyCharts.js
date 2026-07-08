// PricingHourlyCharts — hourly tables-by-minimum, split by segment
// ================================================================
//
// Below the floor map. Resolves the per-period pricing plan into an HOURLY
// view (each gaming-day hour 07:00→06:00 takes the plan of the daypart that
// owns it), then counts tables by minimum tier WITHIN EACH GROUP.
//
// The floor is split by the macro SEGMENT — "MS" (mass) and "PM" (premium),
// derived from the pit via shared/constants/pitSegments — so MS and PM each
// get their own pair of charts (counts + % mix). A "Group by" toggle lets
// the user derive the same split by SUB-SEGMENT (MSC / Main / VIP / …)
// instead, rendering one section per sub-segment.
//
// Stacked bars (comparison-by-part over time); legend + axis labels per the
// chart guidelines; tier colors carry meaning but the legend + value labels
// keep it readable without relying on color alone.

import React, { useEffect, useMemo, useRef } from 'react';
import * as echarts from 'echarts';
import { Box, Stack, Typography } from '@mui/material';
import { readPrice } from '../utils/pricingModel';
import { getDaypartAssignments } from '../utils/pricingStorage';
import { daypartForHour } from '../constants/defaultDayparts';
import { formatMinimum } from '../constants/defaultTiers';
import { PRICING_FONTS } from '../constants/fontSizes';
import { minLabelColor, SERIES_BORDER_COLOR, SERIES_BORDER_WIDTH } from '../constants/chartStyle';

const CH = PRICING_FONTS.charts;
const SEG_COLOR = { MS: '#7adfff', PM: '#ffcd78' };

// Pricing day 07:00 → 06:00 (matches the scheduling spread cycle).
const GAMING_HOURS = [7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 0, 1, 2, 3, 4, 5, 6];
const HOUR_LABELS = GAMING_HOURS.map((h) => String(h).padStart(2, '0'));

function StackedHourChart({ title, tiers, seriesByTier, percent }) {
    const ref = useRef(null);
    useEffect(() => {
        if (!ref.current) return;
        let inst = echarts.getInstanceByDom(ref.current);
        if (!inst) inst = echarts.init(ref.current, 'dark');

        const total = HOUR_LABELS.map((_, hi) => tiers.reduce((s, t) => s + (seriesByTier[t.id]?.[hi] || 0), 0));

        // Per-segment value label formatter. Counts: every non-zero; percent:
        // only ≥6% to avoid clutter on thin slices. Font color is set PER tier
        // (minLabelColor) so each minimum can be tuned independently.
        const labelFmt = (p) => {
            const v = p.value;
            if (percent) return v >= 6 ? `${Math.round(v)}%` : '';
            return v > 0 ? `${v}` : '';
        };

        const series = tiers.map((t) => ({
            name: t.label || formatMinimum(t.min),
            type: 'bar',
            stack: 'tiers',
            barCategoryGap: '6%',
            // Tier fill + a BLACK border around every stacked segment.
            itemStyle: { color: t.color, borderColor: SERIES_BORDER_COLOR, borderWidth: SERIES_BORDER_WIDTH },
            // No hover emphasis (the whole series no longer fades the rest).
            emphasis: { disabled: true },
            label: {
                show: true, position: 'inside', fontSize: CH.segLabel, fontWeight: 700,
                color: minLabelColor(t.min), textBorderColor: 'rgba(0,0,0,0.35)', textBorderWidth: 1,
                formatter: labelFmt,
            },
            data: (seriesByTier[t.id] || []).map((c, hi) => (percent ? (total[hi] > 0 ? (c / total[hi]) * 100 : 0) : c)),
        }));

        // On the COUNTS (left) chart, add a zero-height series on top of the
        // stack whose label shows the TOTAL number of tables for that hour.
        if (!percent) {
            series.push({
                name: 'Total tables', type: 'bar', stack: 'tiers', silent: true,
                data: total.map(() => 0),
                itemStyle: { color: 'transparent' },
                tooltip: { show: false },
                label: {
                    show: true, position: 'top', color: '#dff5ff', fontSize: CH.total, fontWeight: 800,
                    formatter: (p) => (total[p.dataIndex] > 0 ? `${total[p.dataIndex]}` : ''),
                },
            });
        }

        inst.setOption({
            backgroundColor: 'transparent',
            grid: { left: 44, right: 16, top: 48, bottom: 28, containLabel: true },
            legend: {
                type: 'scroll', top: 6, textStyle: { color: 'rgba(255,255,255,0.85)', fontSize: CH.legend },
                itemWidth: 16, itemHeight: 12, icon: 'roundRect',
                data: tiers.map((t) => t.label || formatMinimum(t.min)),
            },
            tooltip: {
                trigger: 'axis', axisPointer: { type: 'shadow' },
                backgroundColor: 'rgba(15,20,25,0.96)', borderColor: 'rgba(122,200,220,0.4)',
                textStyle: { color: '#fff', fontSize: CH.legend },
                valueFormatter: (v) => (percent ? `${Math.round(v)}%` : `${Math.round(v)}`),
            },
            xAxis: {
                type: 'category', data: HOUR_LABELS,
                axisLabel: { color: 'rgba(255,255,255,0.7)', fontSize: CH.axis, interval: 1 },
                axisLine: { lineStyle: { color: 'rgba(255,255,255,0.15)' } },
                axisTick: { show: false },
            },
            yAxis: {
                type: 'value', max: percent ? 100 : null, scale: false,
                axisLabel: { color: 'rgba(255,255,255,0.6)', fontSize: CH.axis, formatter: percent ? '{value}%' : '{value}' },
                splitLine: { lineStyle: { color: 'rgba(255,255,255,0.06)' } },
            },
            series,
        }, true);

        const onResize = () => inst.resize();
        window.addEventListener('resize', onResize);
        return () => window.removeEventListener('resize', onResize);
    }, [tiers, seriesByTier, percent]);

    return (
        <Box sx={{ bgcolor: 'rgba(22, 24, 38, 0.9)', borderRadius: 2, border: '1px solid rgba(255,255,255,0.06)', p: 1.2 }}>
            <Typography sx={{ color: '#dff5ff', fontSize: CH.chartTitle, fontWeight: 800, mb: 0.5, px: 0.5 }}>{title}</Typography>
            <Box ref={ref} sx={{ width: '100%', height: 460 }} />
        </Box>
    );
}

// Weighted-average table minimum by hour — one line for a single segment.
function WeightedMinLineChart({ title, color, data }) {
    const ref = useRef(null);
    useEffect(() => {
        if (!ref.current) return;
        let inst = echarts.getInstanceByDom(ref.current);
        if (!inst) inst = echarts.init(ref.current, 'dark');
        inst.setOption({
            backgroundColor: 'transparent',
            grid: { left: 52, right: 16, top: 22, bottom: 28, containLabel: true },
            tooltip: {
                trigger: 'axis', axisPointer: { type: 'line' },
                backgroundColor: 'rgba(15,20,25,0.96)', borderColor: 'rgba(122,200,220,0.4)',
                textStyle: { color: '#fff', fontSize: CH.legend },
                valueFormatter: (v) => (v == null ? '—' : formatMinimum(Math.round(v))),
            },
            xAxis: {
                type: 'category', data: HOUR_LABELS,
                axisLabel: { color: 'rgba(255,255,255,0.7)', fontSize: CH.axis, interval: 1 },
                axisLine: { lineStyle: { color: 'rgba(255,255,255,0.15)' } }, axisTick: { show: false },
            },
            yAxis: {
                type: 'value', scale: true,
                axisLabel: { color: 'rgba(255,255,255,0.6)', fontSize: CH.axis, formatter: (v) => formatMinimum(v) },
                splitLine: { lineStyle: { color: 'rgba(255,255,255,0.06)' } },
            },
            series: [{
                type: 'line', smooth: true, connectNulls: true,
                data,
                symbol: 'circle', symbolSize: 6,
                itemStyle: { color }, lineStyle: { color, width: 2.5 },
                areaStyle: { color, opacity: 0.08 },
                emphasis: { disabled: true },
                label: {
                    show: true, position: 'top', color, fontSize: CH.segLabel, fontWeight: 700,
                    formatter: (p) => (p.value == null ? '' : formatMinimum(Math.round(p.value))),
                },
            }],
        }, true);
        const onResize = () => inst.resize();
        window.addEventListener('resize', onResize);
        return () => window.removeEventListener('resize', onResize);
    }, [title, color, data]);

    return (
        <Box sx={{ bgcolor: 'rgba(22, 24, 38, 0.9)', borderRadius: 2, border: '1px solid rgba(255,255,255,0.06)', p: 1.2 }}>
            <Typography sx={{ color: '#dff5ff', fontSize: CH.chartTitle, fontWeight: 800, mb: 0.5, px: 0.5 }}>{title}</Typography>
            <Box ref={ref} sx={{ width: '100%', height: 300 }} />
        </Box>
    );
}

export default function PricingHourlyCharts({
    store, date, dayparts, hourlyMode = false, tiers,
    macroByKey, macroSegments = [],   // "MS" / "PM"
    subByKey, subSegments = [],        // MSC / Main / VIP / Slots / PM
    groupBy = 'segment',               // shared with the Summary (Segment vs Sub-segment)
    openByHour = null, scheduleDate = null,
    subFilter = [], minFilter = [],    // global dashboard filters
}) {
    // Global filters: exclude tables by sub-segment; show only selected tiers.
    const subOk = (k) => subFilter.length === 0 || (subByKey && subFilter.includes(subByKey.get(k)));
    const chartTiers = useMemo(
        () => (minFilter.length ? tiers.filter((t) => minFilter.includes(t.id)) : tiers),
        [tiers, minFilter]
    );

    // Build one { group, seriesByTier, any } section per group value. A
    // table only counts at an hour if scheduled OPEN that hour (when a
    // schedule is loaded), so the charts reflect the priced-AND-open floor.
    const sections = useMemo(() => {
        const groupMap = groupBy === 'segment' ? macroByKey : subByKey;
        const groups = groupBy === 'segment' ? macroSegments : subSegments;
        if (!groupMap) return [];
        return groups.map((g) => {
            const res = {};
            for (const t of tiers) res[t.id] = new Array(GAMING_HOURS.length).fill(0);
            GAMING_HOURS.forEach((h, hi) => {
                let a;
                if (hourlyMode) {
                    a = getDaypartAssignments(store, date, `h_${h}`);
                } else {
                    const dp = daypartForHour(dayparts, h);
                    a = dp ? getDaypartAssignments(store, date, dp.id) : {};
                }
                const open = openByHour ? (openByHour.get(h) || null) : null;
                for (const [k, gv] of groupMap) {
                    if (gv !== g) continue;
                    if (!subOk(k)) continue;
                    if (openByHour && (!open || !open.has(k))) continue;
                    const p = readPrice(a[k]);
                    if (p && res[p.base]) res[p.base][hi] += 1;
                }
            });
            const any = chartTiers.some((t) => (res[t.id] || []).some((c) => c > 0));
            return { g, seriesByTier: res, any };
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [groupBy, macroByKey, subByKey, macroSegments, subSegments, store, date, dayparts, hourlyMode, tiers, openByHour, subFilter, chartTiers]);

    // Weighted-average table minimum per hour, per MACRO segment (MS/PM) —
    // Σ(tier $ × count) / open-priced count. Respects the global filters.
    const weighted = useMemo(() => {
        const tierMin = new Map(tiers.map((t) => [t.id, t.min || 0]));
        const minOk = (tid) => minFilter.length === 0 || minFilter.includes(tid);
        const out = {};
        for (const seg of macroSegments) out[seg] = new Array(GAMING_HOURS.length).fill(null);
        if (!macroByKey) return out;
        GAMING_HOURS.forEach((h, hi) => {
            let a;
            if (hourlyMode) a = getDaypartAssignments(store, date, `h_${h}`);
            else { const dp = daypartForHour(dayparts, h); a = dp ? getDaypartAssignments(store, date, dp.id) : {}; }
            const open = openByHour ? (openByHour.get(h) || null) : null;
            const acc = {};
            for (const [k, seg] of macroByKey) {
                if (!macroSegments.includes(seg)) continue;
                if (!subOk(k)) continue;
                if (openByHour && (!open || !open.has(k))) continue;
                const p = readPrice(a[k]);
                if (!p || !minOk(p.base)) continue;
                if (!acc[seg]) acc[seg] = { sum: 0, n: 0 };
                acc[seg].sum += (tierMin.get(p.base) || 0); acc[seg].n += 1;
            }
            for (const seg of macroSegments) if (acc[seg] && acc[seg].n) out[seg][hi] = acc[seg].sum / acc[seg].n;
        });
        return out;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [tiers, minFilter, subFilter, macroByKey, macroSegments, store, date, dayparts, hourlyMode, openByHour]);

    const anyDataAll = sections.some((s) => s.any);

    return (
        <Box sx={{ mb: 2 }}>
            <Stack direction="row" alignItems="center" spacing={1.2} sx={{ mb: 1.2, flexWrap: 'wrap', rowGap: 0.8 }}>
                <Box sx={{ width: 4, height: CH.header, bgcolor: '#7adfff', borderRadius: 1 }} />
                <Typography sx={{ color: '#dff5ff', fontSize: CH.header, fontWeight: 800, lineHeight: 1 }}>Hourly Minimum Mix · 07:00 → 06:00</Typography>
                {openByHour
                    ? <Typography sx={{ color: '#5ae6b0', fontSize: CH.badge, fontWeight: 700, bgcolor: 'rgba(90,230,176,0.12)', px: 0.8, py: 0.2, borderRadius: 1 }}>
                        scheduled-open only{scheduleDate ? ` · ${scheduleDate}` : ''}
                      </Typography>
                    : <Typography sx={{ color: 'rgba(255,255,255,0.4)', fontSize: CH.badge }}>all priced tables (no schedule loaded)</Typography>}
                <Box sx={{ flex: 1 }} />
            </Stack>

            {!anyDataAll ? (
                <Box sx={{ p: 3, textAlign: 'center', bgcolor: 'rgba(22,24,38,0.6)', borderRadius: 2, border: '1px dashed rgba(255,255,255,0.12)' }}>
                    <Typography sx={{ color: 'rgba(255,255,255,0.45)', fontSize: CH.empty, fontStyle: 'italic' }}>
                        No priced tables yet — price some tables to see the hourly minimum mix by {groupBy === 'segment' ? 'MS / PM' : 'sub-segment'}.
                    </Typography>
                </Box>
            ) : (
                <Stack spacing={1.6}>
                    {sections.map(({ g, seriesByTier, any }) => (
                        <Box key={g}>
                            {any ? (
                                <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: '1fr 1fr' }, gap: 1.5 }}>
                                    <StackedHourChart title={`Hourly Table Minimum - ${g}`} tiers={chartTiers} seriesByTier={seriesByTier} />
                                    <StackedHourChart title={`Hourly Minimum Mix - ${g}`} tiers={chartTiers} seriesByTier={seriesByTier} percent />
                                </Box>
                            ) : (
                                <Box sx={{ p: 2, textAlign: 'center', bgcolor: 'rgba(22,24,38,0.4)', borderRadius: 2, border: '1px dashed rgba(255,255,255,0.1)' }}>
                                    <Typography sx={{ color: 'rgba(255,255,255,0.4)', fontSize: CH.empty, fontStyle: 'italic' }}>
                                        No priced{openByHour ? '/open' : ''} tables in {g}.
                                    </Typography>
                                </Box>
                            )}
                        </Box>
                    ))}

                    {/* Weighted-average table minimum by hour — MS + PM lines. */}
                    <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: '1fr 1fr' }, gap: 1.5 }}>
                        {macroSegments.map((seg) => (
                            <WeightedMinLineChart key={seg} title={`Weighted Table Minimum / Hour - ${seg}`}
                                color={SEG_COLOR[seg] || '#7adfff'} data={weighted[seg] || []} />
                        ))}
                    </Box>
                </Stack>
            )}
        </Box>
    );
}
