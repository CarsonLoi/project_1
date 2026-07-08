// PlanCompareView — variance between two spread plans
// ===================================================
//
// The scheduling dashboard's "Compare" mode. The user picks Plan A
// (date + version) as the BASE and Plan B (date + version) to compare.
// The floor map paints every table by how B differs from A:
//
//   grey  = unchanged    amber = reassigned
//   green = added by B    red  = removed by B
//
// Implementation note: we don't add a "diff mode" to FloorScheduleMap.
// Instead planDiff() emits SYNTHETIC shifts (one per status) + a
// table→status assignments map, and the normal colorMode='shift' path
// colors the variance for free. See utils/planDiff.js.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as echarts from 'echarts';
import { Box, Stack, Typography, Select, MenuItem, Tooltip } from '@mui/material';
import EastIcon from '@mui/icons-material/East';
import FloorScheduleMap from './FloorScheduleMap';
import TimelineControl, { GAMING_HOURS } from './TimelineControl';
import { liveFloorTables } from '../utils/configSnapshot';
import { findVersion } from '../utils/spreadDataModel';
import { diffMapInputs, DIFF_SYNTHETIC_SHIFTS } from '../utils/planDiff';
import { buildComparePayload } from '../utils/spreadCompare';
import { shiftCoversHour } from '../utils/shiftCoverage';
import { SPREAD_FONTS } from '../constants/fontSizes';

// Resolve a { date, versionId } selection into its stored version +
// assignments. Returns nulls when the selection is incomplete/missing.
function resolvePlan(store, sel) {
    if (!sel || !sel.date) return { version: null, assignments: {}, doc: null };
    const doc = store.schedules?.[sel.date] || null;
    const version = doc ? findVersion(doc, sel.versionId) : null;
    return { version, assignments: version?.assignments || {}, doc };
}

// A compact (date → version) picker. Versions list is derived from the
// chosen date's document; picking a new date auto-selects its newest
// version so the second dropdown is never left dangling.
function PlanSelector({ label, accent, store, value, onChange, dates }) {
    const doc = value?.date ? store.schedules?.[value.date] : null;
    const versions = useMemo(
        () => (doc?.versions || []).slice().sort((a, b) => (b.versionNumber || 0) - (a.versionNumber || 0)),
        [doc]
    );
    const selSx = {
        color: '#fff', fontSize: 14, fontWeight: 600,
        bgcolor: 'rgba(255,255,255,0.05)', borderRadius: 1, px: 1, py: 0.2,
        '& .MuiSelect-icon': { color: 'rgba(255,255,255,0.45)' },
        '&:before, &:after': { display: 'none' },
    };
    return (
        <Stack spacing={0.6} sx={{ minWidth: 220 }}>
            <Stack direction="row" alignItems="center" spacing={0.8}>
                <Box sx={{ width: 10, height: 10, borderRadius: '2px', bgcolor: accent }} />
                <Typography sx={{ color: 'rgba(255,255,255,0.7)', fontSize: 12, fontWeight: 800, letterSpacing: 0.6 }}>
                    {label}
                </Typography>
            </Stack>
            <Stack direction="row" spacing={0.8}>
                <Select
                    value={value?.date || ''}
                    displayEmpty
                    variant="standard"
                    disableUnderline
                    onChange={(e) => {
                        const date = e.target.value;
                        const d = store.schedules?.[date];
                        const vs = (d?.versions || []).slice().sort((a, b) => (b.versionNumber || 0) - (a.versionNumber || 0));
                        onChange({ date, versionId: vs[0]?.versionId || null });
                    }}
                    sx={{ ...selSx, flex: 1 }}
                >
                    <MenuItem value="" disabled sx={{ fontSize: 13 }}>Pick date…</MenuItem>
                    {dates.map((d) => (
                        <MenuItem key={d} value={d} sx={{ fontSize: 13 }}>{d}</MenuItem>
                    ))}
                </Select>
                <Select
                    value={value?.versionId || ''}
                    displayEmpty
                    variant="standard"
                    disableUnderline
                    disabled={versions.length === 0}
                    onChange={(e) => onChange({ date: value.date, versionId: e.target.value })}
                    sx={{ ...selSx, width: 90 }}
                >
                    <MenuItem value="" disabled sx={{ fontSize: 13 }}>ver…</MenuItem>
                    {versions.map((v) => (
                        <MenuItem key={v.versionId} value={v.versionId} sx={{ fontSize: 13 }}>
                            v{v.versionNumber}
                        </MenuItem>
                    ))}
                </Select>
            </Stack>
        </Stack>
    );
}

// One headline metric tile (A value, B value, signed delta).
function MetricTile({ label, aVal, bVal, fmt = (v) => v, goodIsUp = null }) {
    const delta = (typeof aVal === 'number' && typeof bVal === 'number') ? bVal - aVal : null;
    const deltaColor = delta == null || delta === 0
        ? 'rgba(255,255,255,0.5)'
        : (goodIsUp == null
            ? '#7adfff'
            : ((delta > 0) === goodIsUp ? '#9ece6a' : '#f7768e'));
    return (
        <Box sx={{
            flex: 1, minWidth: 0, p: 1.2, borderRadius: 1.4,
            bgcolor: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)',
        }}>
            <Typography sx={{ color: 'rgba(255,255,255,0.55)', fontSize: 11, fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase' }}>
                {label}
            </Typography>
            <Stack direction="row" alignItems="baseline" spacing={1} sx={{ mt: 0.4 }}>
                <Typography sx={{ color: '#fff', fontSize: 18, fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>
                    {fmt(bVal)}
                </Typography>
                {delta != null && (
                    <Typography sx={{ color: deltaColor, fontSize: 13, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                        {delta > 0 ? '+' : ''}{fmt(delta)}
                    </Typography>
                )}
            </Stack>
            <Typography sx={{ color: 'rgba(255,255,255,0.4)', fontSize: 11, mt: 0.2 }}>
                base A: {fmt(aVal)}
            </Typography>
        </Box>
    );
}

// Count open tables per gaming-day hour for one plan's assignments.
// A table is "open at hour h" if its assigned shift covers h.
function openByHour(assignments, shifts) {
    const shiftMap = new Map((shifts || []).map((s) => [s.id, s]));
    const out = GAMING_HOURS.map(() => 0);
    for (const key of Object.keys(assignments || {})) {
        const s = shiftMap.get(assignments[key]);
        if (!s) continue;
        GAMING_HOURS.forEach((h, i) => { if (shiftCoversHour(s, h)) out[i] += 1; });
    }
    return out;
}

// Hourly open-tables trend — one line per plan (A vs B).
function OpenTablesTrend({ a, b }) {
    const ref = useRef(null);
    useEffect(() => {
        if (!ref.current) return;
        let inst = echarts.getInstanceByDom(ref.current);
        if (!inst) inst = echarts.init(ref.current, 'dark');
        const hourLabels = GAMING_HOURS.map((h) => String(h).padStart(2, '0'));
        inst.setOption({
            backgroundColor: 'transparent',
            grid: { left: 44, right: 16, top: 32, bottom: 28, containLabel: true },
            legend: { top: 4, textStyle: { color: 'rgba(255,255,255,0.85)', fontSize: 12 }, data: ['Plan A', 'Plan B'] },
            tooltip: { trigger: 'axis', backgroundColor: 'rgba(15,20,25,0.96)', borderColor: 'rgba(122,200,220,0.4)', textStyle: { color: '#fff', fontSize: 12 } },
            xAxis: { type: 'category', data: hourLabels, axisLabel: { color: 'rgba(255,255,255,0.7)', fontSize: 11, interval: 1 }, axisLine: { lineStyle: { color: 'rgba(255,255,255,0.15)' } }, axisTick: { show: false } },
            yAxis: { type: 'value', scale: true, axisLabel: { color: 'rgba(255,255,255,0.6)', fontSize: 11 }, splitLine: { lineStyle: { color: 'rgba(255,255,255,0.06)' } } },
            series: [
                { name: 'Plan A', type: 'line', smooth: true, connectNulls: true, data: a, symbol: 'circle', symbolSize: 5, itemStyle: { color: '#7adfff' }, lineStyle: { color: '#7adfff', width: 2.5 }, emphasis: { disabled: true } },
                { name: 'Plan B', type: 'line', smooth: true, connectNulls: true, data: b, symbol: 'circle', symbolSize: 5, itemStyle: { color: '#e0af68' }, lineStyle: { color: '#e0af68', width: 2.5 }, emphasis: { disabled: true } },
            ],
        }, true);
        const onResize = () => inst.resize();
        window.addEventListener('resize', onResize);
        return () => window.removeEventListener('resize', onResize);
    }, [a, b]);
    return (
        <Box sx={{ mt: 1.2, p: 1.2, bgcolor: 'rgba(22,24,38,0.9)', borderRadius: 2, border: '1px solid rgba(255,255,255,0.06)' }}>
            <Typography sx={{ color: '#dff5ff', fontSize: 14, fontWeight: 800, mb: 0.4, px: 0.5 }}>Open tables / hour — Plan A vs Plan B</Typography>
            <Box ref={ref} sx={{ width: '100%', height: 260 }} />
        </Box>
    );
}

export default function PlanCompareView({ store, shifts, planA, planB, setPlanA, setPlanB }) {
    const dates = useMemo(
        () => Object.keys(store.schedules || {}).sort(),
        [store.schedules]
    );

    const A = useMemo(() => resolvePlan(store, planA), [store, planA]);
    const B = useMemo(() => resolvePlan(store, planB), [store, planB]);

    // Base floor = Plan A's date floor (per the "A is the base" semantic).
    const tables = useMemo(
        () => (planA?.date ? liveFloorTables(planA.date) : []),
        [planA?.date]
    );

    const ready = !!A.version && !!B.version;

    // Synthetic shifts + table→status assignments that drive the map.
    const diff = useMemo(
        () => diffMapInputs(A.assignments, B.assignments),
        [A.assignments, B.assignments]
    );

    // Numeric rollup — target = B, ref = A, so every delta reads B − A.
    const payload = useMemo(
        () => buildComparePayload({ assignments: B.assignments }, { assignments: A.assignments }, shifts, tables),
        [A.assignments, B.assignments, shifts, tables]
    );

    // Shared hour scrubber for the side-by-side floors (both maps run in
    // 'hourly' view so the operator can compare who's open when).
    const [hourCursor, setHourCursor] = useState(7);
    const [playing, setPlaying] = useState(false);

    // Hourly open-tables series for the trend chart.
    const trendA = useMemo(() => openByHour(A.assignments, shifts), [A.assignments, shifts]);
    const trendB = useMemo(() => openByHour(B.assignments, shifts), [B.assignments, shifts]);

    return (
        <Box>
            {/* Plan pickers */}
            <Stack
                direction="row" alignItems="flex-end" spacing={2}
                sx={{
                    p: 1.4, mb: 1.2, borderRadius: 1.6,
                    bgcolor: 'rgba(8, 22, 36, 0.55)',
                    border: '1px solid rgba(122, 200, 220, 0.18)',
                }}
            >
                <PlanSelector
                    label="PLAN A — BASE" accent="#7adfff"
                    store={store} dates={dates} value={planA} onChange={setPlanA}
                />
                <EastIcon sx={{ color: 'rgba(255,255,255,0.4)', mb: 0.6 }} />
                <PlanSelector
                    label="PLAN B — COMPARE" accent="#e0af68"
                    store={store} dates={dates} value={planB} onChange={setPlanB}
                />
                <Box sx={{ flex: 1 }} />
                {ready && (
                    <Typography sx={{ color: 'rgba(255,255,255,0.6)', fontSize: 13, mb: 0.6 }}>
                        <b style={{ color: '#fff' }}>{diff.differing}</b> of {diff.touched} tables differ
                    </Typography>
                )}
            </Stack>

            {!ready ? (
                <Box sx={{
                    minHeight: 360, borderRadius: 2,
                    border: '1px dashed rgba(255,255,255,0.14)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                    <Typography sx={{ color: 'rgba(255,255,255,0.45)', fontSize: 15, fontStyle: 'italic' }}>
                        Pick a date and version for both Plan A and Plan B to see the variance.
                    </Typography>
                </Box>
            ) : (
                <>
                    {/* Variance floor map */}
                    <Box sx={{
                        position: 'relative', borderRadius: 2, overflow: 'hidden',
                        bgcolor: 'rgba(22, 24, 38, 0.9)',
                        border: '1px solid rgba(255,255,255,0.06)',
                        height: 520,
                    }}>
                        <FloorScheduleMap
                            tables={tables}
                            assignments={diff.assignments}
                            shifts={diff.shifts}
                            selectedKeys={new Set()}
                            activeBrushShiftId={null}
                            onSelectionChange={() => {}}
                            onAssign={() => {}}
                            mode="overall"
                            colorMode="shift"
                            readOnly={true}
                            layoutMode="comparison"
                        />
                        {/* Status legend overlay */}
                        <Stack
                            direction="row" spacing={1.2}
                            sx={{
                                position: 'absolute', left: 12, bottom: 12,
                                px: 1.2, py: 0.8, borderRadius: 1.2,
                                bgcolor: 'rgba(10,22,35,0.85)', backdropFilter: 'blur(4px)',
                                border: '1px solid rgba(122,200,220,0.2)',
                            }}
                        >
                            {DIFF_SYNTHETIC_SHIFTS.map((s) => (
                                <Stack key={s.id} direction="row" alignItems="center" spacing={0.5}>
                                    <Box sx={{ width: 11, height: 11, borderRadius: '2px', bgcolor: s.color }} />
                                    <Typography sx={{ color: 'rgba(255,255,255,0.8)', fontSize: 12, fontWeight: 700 }}>
                                        {s.name}
                                    </Typography>
                                    <Typography sx={{ color: '#fff', fontSize: 12, fontWeight: 800 }}>
                                        {diff.counts[s.id] || 0}
                                    </Typography>
                                </Stack>
                            ))}
                        </Stack>
                    </Box>

                    {/* Headline metrics */}
                    <Stack direction="row" spacing={1.2} sx={{ mt: 1.2 }}>
                        <MetricTile
                            label="Open tables"
                            aVal={payload.meta.refTableCount}
                            bVal={payload.meta.targetTableCount}
                        />
                        <MetricTile
                            label="Scheduled table-hours"
                            aVal={payload.totalTableHours.ref}
                            bVal={payload.totalTableHours.target}
                        />
                        <MetricTile
                            label="Tables changed"
                            aVal={0}
                            bVal={diff.differing}
                        />
                    </Stack>

                    {/* Per-shift delta table */}
                    <Box sx={{
                        mt: 1.2, p: 1.4, borderRadius: 1.6,
                        bgcolor: 'rgba(8, 22, 36, 0.55)',
                        border: '1px solid rgba(122, 200, 220, 0.18)',
                    }}>
                        <Typography sx={{ color: '#dff5ff', fontSize: 14, fontWeight: 800, mb: 1 }}>
                            Per-shift change (B − A)
                        </Typography>
                        <Box component="table" sx={{ width: '100%', borderCollapse: 'collapse', fontVariantNumeric: 'tabular-nums' }}>
                            <Box component="thead">
                                <Box component="tr">
                                    {['Shift', 'A', 'B', 'Δ'].map((h, i) => (
                                        <Box component="th" key={h} sx={{
                                            color: 'rgba(255,255,255,0.5)', fontSize: 12, fontWeight: 700,
                                            textAlign: i === 0 ? 'left' : 'right', py: 0.6, px: 1,
                                            borderBottom: '1px solid rgba(255,255,255,0.08)',
                                        }}>{h}</Box>
                                    ))}
                                </Box>
                            </Box>
                            <Box component="tbody">
                                {payload.shiftCounts.map((r) => (
                                    <Box component="tr" key={r.shiftId}>
                                        <Box component="td" sx={{ py: 0.6, px: 1, borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                                            <Stack direction="row" alignItems="center" spacing={0.8}>
                                                <Box sx={{ width: 10, height: 10, borderRadius: '2px', bgcolor: r.color }} />
                                                <Typography sx={{ color: '#fff', fontSize: 13, fontWeight: 600 }}>{r.shiftName}</Typography>
                                            </Stack>
                                        </Box>
                                        <Box component="td" sx={{ py: 0.6, px: 1, textAlign: 'right', color: 'rgba(255,255,255,0.7)', fontSize: 13, borderBottom: '1px solid rgba(255,255,255,0.04)' }}>{r.refCount}</Box>
                                        <Box component="td" sx={{ py: 0.6, px: 1, textAlign: 'right', color: '#fff', fontSize: 13, borderBottom: '1px solid rgba(255,255,255,0.04)' }}>{r.targetCount}</Box>
                                        <Box component="td" sx={{
                                            py: 0.6, px: 1, textAlign: 'right', fontSize: 13, fontWeight: 800,
                                            color: r.delta > 0 ? '#9ece6a' : r.delta < 0 ? '#f7768e' : 'rgba(255,255,255,0.4)',
                                            borderBottom: '1px solid rgba(255,255,255,0.04)',
                                        }}>{r.delta > 0 ? '+' : ''}{r.delta}</Box>
                                    </Box>
                                ))}
                            </Box>
                        </Box>
                    </Box>

                    {/* Side-by-side floors — Plan A left, Plan B right — with
                        a shared hour timeline. Both are read-only (compare
                        mode); switch to Planning to edit either. */}
                    <Box sx={{ mt: 1.6 }}>
                        <TimelineControl currentHour={hourCursor} onCurrentHour={setHourCursor} playing={playing} onPlaying={setPlaying} />
                    </Box>
                    <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 1.5, mt: 1 }}>
                        <Box>
                            <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 0.6 }}>
                                <Box sx={{ width: 10, height: 10, borderRadius: '2px', bgcolor: '#7adfff' }} />
                                <Typography sx={{ color: '#dff5ff', fontSize: 14, fontWeight: 800, lineHeight: 1 }}>Plan A · {planA?.date || '—'} v{A.version?.versionNumber ?? '—'}</Typography>
                                <Typography sx={{ color: 'rgba(255,255,255,0.5)', fontSize: 12 }}>{Object.keys(A.assignments).length} assigned</Typography>
                            </Stack>
                            <Box sx={{ position: 'relative', width: '100%', aspectRatio: '1500 / 723', bgcolor: 'rgba(22,24,38,0.9)', borderRadius: 2, border: '1px solid rgba(255,255,255,0.06)', overflow: 'hidden' }}>
                                <FloorScheduleMap
                                    tables={tables} assignments={A.assignments} shifts={shifts}
                                    selectedKeys={new Set()} activeBrushShiftId={null}
                                    onSelectionChange={() => {}} onAssign={() => {}}
                                    mode="hourly" currentHour={hourCursor} colorMode="shift"
                                    readOnly layoutMode="comparison"
                                />
                            </Box>
                        </Box>
                        <Box>
                            <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 0.6 }}>
                                <Box sx={{ width: 10, height: 10, borderRadius: '2px', bgcolor: '#e0af68' }} />
                                <Typography sx={{ color: '#dff5ff', fontSize: 14, fontWeight: 800, lineHeight: 1 }}>Plan B · {planB?.date || '—'} v{B.version?.versionNumber ?? '—'}</Typography>
                                <Typography sx={{ color: 'rgba(255,255,255,0.5)', fontSize: 12 }}>{Object.keys(B.assignments).length} assigned</Typography>
                            </Stack>
                            <Box sx={{ position: 'relative', width: '100%', aspectRatio: '1500 / 723', bgcolor: 'rgba(22,24,38,0.9)', borderRadius: 2, border: '1px solid rgba(255,255,255,0.06)', overflow: 'hidden' }}>
                                <FloorScheduleMap
                                    tables={tables} assignments={B.assignments} shifts={shifts}
                                    selectedKeys={new Set()} activeBrushShiftId={null}
                                    onSelectionChange={() => {}} onAssign={() => {}}
                                    mode="hourly" currentHour={hourCursor} colorMode="shift"
                                    readOnly layoutMode="comparison"
                                />
                            </Box>
                        </Box>
                    </Box>

                    {/* Hourly open-tables trend — A vs B lines across the
                        gaming day (07:00 → 06:00). Uses the same shift-covers-
                        hour logic as the floor's hourly mode. */}
                    <OpenTablesTrend a={trendA} b={trendB} />
                </>
            )}
        </Box>
    );
}
