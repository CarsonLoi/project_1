// PricingComparison — compare two dates' pricing side by side
// ===========================================================
//
// Two scatter maps sit on ONE row (date A | date B), each with its own
// calendar date picker in its top-right corner. A single hour timeline
// drives BOTH maps. Below the maps: a comparison table (tables-by-minimum
// for the two dates at the current hour, with variance), then an hourly
// weighted-minimum trend for both dates. Sub-segment filter only.

import React, { useState, useMemo, useEffect, useRef } from 'react';
import * as echarts from 'echarts';
import { Box, Stack, Typography, Select, MenuItem, Checkbox, CircularProgress } from '@mui/material';
import PricingFloorMap from './PricingFloorMap';
import TimelineControl, { GAMING_HOURS } from './TimelineControl';
import { readPrice } from '../utils/pricingModel';
import { getDaypartAssignments, setDaypartAssignments } from '../utils/pricingStorage';
import { liveFloorTables } from '../utils/floorConfig';
import { formatMinimum } from '../constants/defaultTiers';
import { PRICING_FONTS } from '../constants/fontSizes';
import { CMP_FLOOR_ASPECT } from '../constants/floorLayout';
import { fetchHourlyData, gametypeTableKey } from '../../performance/utils/dataSource';

const SF = PRICING_FONTS.summary;
const CF = PRICING_FONTS.compare;
const TXT = '#dff5ff';
const A_COLOR = '#7adfff';
const B_COLOR = '#f7b955';
const HOUR_LABELS = GAMING_HOURS.map((h) => String(h).padStart(2, '0'));

const ctrlSx = {
    height: 32, fontSize: CF.head, fontWeight: 700, color: '#fff',
    bgcolor: 'rgba(255,255,255,0.05)', borderRadius: 1,
    '& .MuiSelect-icon': { color: 'rgba(255,255,255,0.45)' },
    '& .MuiOutlinedInput-notchedOutline': { borderColor: 'rgba(122,200,220,0.22)' },
};

// Open-table set per hour for one date, from the hourly feed (spread=1).
function openByHourForDate(rows, date) {
    const map = new Map();
    for (const r of rows || []) {
        if (Number(r.spread) !== 1 || r.hour == null) continue;
        if (String(r.date).slice(0, 10) !== date) continue;
        const h = Number(r.hour);
        if (!map.has(h)) map.set(h, new Set());
        map.get(h).add(gametypeTableKey(r.gametype, r.table));
    }
    return map;
}

// One date's floor AT a single hour → { assignments (key→tierId), closed }.
function floorAtHour(store, date, hour, openMap, tableKeys) {
    const assignments = {};
    const closed = new Set();
    const open = openMap ? (openMap.get(hour) || new Set()) : null;
    const a = getDaypartAssignments(store, date, `h_${hour}`);
    for (const key of tableKeys) {
        if (open && !open.has(key)) { closed.add(key); continue; }
        const p = readPrice(a[key]);
        if (p) assignments[key] = p.base;
    }
    return { assignments, closed };
}

// Compact tier picker — apply a minimum to the current selection on a map.
// Pick a readable text color for a tier tile — dark ink on light fills,
// white on dark ones — so the label inside stays legible on any swatch.
function inkOn(bg) {
    if (!bg || typeof bg !== 'string') return '#fff';
    const m = bg.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
    if (!m) return '#fff';
    const h = m[1].length === 3 ? m[1].split('').map((c) => c + c).join('') : m[1];
    const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
    return (0.299 * r + 0.587 * g + 0.114 * b) > 160 ? '#0a1a2c' : '#ffffff';
}

function MiniTierBar({ count, tiers, color, onPick, onClear }) {
    return (
        <Stack direction="row" spacing={0.6} alignItems="center" sx={{ mt: 0.6, p: 0.7, borderRadius: 1.2, bgcolor: 'rgba(8,22,36,0.75)', border: `1px solid ${color}`, flexWrap: 'wrap', rowGap: 0.6 }}>
            <Typography sx={{ fontSize: CF.panelMeta + 1, fontWeight: 800, color, whiteSpace: 'nowrap', mr: 0.3 }}>Set {count}:</Typography>
            {tiers.map((t) => {
                const label = t.label || formatMinimum(t.min);
                return (
                    <Box key={t.id} onClick={() => onPick(t.id)} title={label}
                        sx={{
                            minWidth: 54, height: 26, px: 0.9, borderRadius: 0.8,
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            bgcolor: t.color, cursor: 'pointer', flexShrink: 0,
                            border: '1px solid rgba(255,255,255,0.28)',
                            boxShadow: '0 1px 3px rgba(0,0,0,0.35)',
                            transition: 'transform 120ms',
                            '&:hover': { transform: 'translateY(-1px) scale(1.04)', filter: 'brightness(1.15)' },
                        }}>
                        <Typography sx={{ fontSize: CF.panelMeta + 1, fontWeight: 800, color: inkOn(t.color), fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', lineHeight: 1 }}>
                            {label}
                        </Typography>
                    </Box>
                );
            })}
            <Box onClick={() => onPick('__clear__')} sx={{ px: 1, height: 26, display: 'flex', alignItems: 'center', borderRadius: 0.8, bgcolor: 'rgba(255,255,255,0.08)', cursor: 'pointer', fontSize: CF.panelMeta, fontWeight: 700, color: 'rgba(255,255,255,0.75)', border: '1px solid rgba(255,255,255,0.15)', '&:hover': { bgcolor: 'rgba(255,255,255,0.14)' } }}>Unprice</Box>
            <Box onClick={onClear} sx={{ px: 0.6, height: 26, display: 'flex', alignItems: 'center', cursor: 'pointer', fontSize: CF.panelMeta + 2, color: 'rgba(255,255,255,0.5)', ml: 'auto' }}>✕</Box>
        </Stack>
    );
}

// One floor map column with its own date-picker overlay. Editable: select
// tables, then pick a minimum from the tier bar to set it for that date.
function FloorPanel({ date, onDateChange, color, label, tables, assignments, closed, tiers, tierBar, selectedKeys, onSelectionChange, vmSelected, onVmSelected, scheduleLoaded }) {
    const priceByKey = useMemo(() => {
        const m = new Map();
        for (const k of Object.keys(assignments)) m.set(k, { base: assignments[k], min: assignments[k], max: assignments[k] });
        return m;
    }, [assignments]);
    return (
        <Box sx={{ minWidth: 0 }}>
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 0.6 }}>
                <Box sx={{ width: 10, height: 10, borderRadius: '2px', bgcolor: color }} />
                <Typography sx={{ color: TXT, fontSize: CF.panelLabel, fontWeight: 800, lineHeight: 1 }}>{label}</Typography>
                <Typography sx={{ color: 'rgba(255,255,255,0.45)', fontSize: CF.panelMeta }}>{Object.keys(assignments).length} open · priced</Typography>
            </Stack>
            <Box sx={{ position: 'relative', width: '100%', aspectRatio: CMP_FLOOR_ASPECT, bgcolor: 'rgba(22,24,38,0.9)', borderRadius: 2, border: '1px solid rgba(255,255,255,0.06)', overflow: 'hidden' }}>
                <PricingFloorMap
                    tables={tables} assignments={assignments} tiers={tiers} priceByKey={priceByKey}
                    closedKeys={closed} fixedKeys={null} selectedKeys={selectedKeys} activeBrushShiftId={null}
                    onSelectionChange={onSelectionChange} onAssign={() => {}} flexEnabled={false}
                    date={date} onDateChange={onDateChange} scheduleLoaded={scheduleLoaded}
                    vmSelected={vmSelected} onVmSelected={onVmSelected}
                    mode="comparison"
                />
            </Box>
            {tierBar}
        </Box>
    );
}

// Hourly weighted-minimum trend — one line per date (A vs B).
function TrendChart({ a, b }) {
    const ref = useRef(null);
    useEffect(() => {
        if (!ref.current) return;
        let inst = echarts.getInstanceByDom(ref.current);
        if (!inst) inst = echarts.init(ref.current, 'dark');
        inst.setOption({
            backgroundColor: 'transparent',
            grid: { left: 52, right: 16, top: 30, bottom: 28, containLabel: true },
            legend: { top: 2, textStyle: { color: 'rgba(255,255,255,0.85)', fontSize: CF.trendLegend }, data: ['Date A', 'Date B'] },
            tooltip: {
                trigger: 'axis', backgroundColor: 'rgba(15,20,25,0.96)', borderColor: 'rgba(122,200,220,0.4)',
                textStyle: { color: '#fff', fontSize: CF.trendLegend }, valueFormatter: (v) => (v == null ? '—' : formatMinimum(Math.round(v))),
            },
            xAxis: { type: 'category', data: HOUR_LABELS, axisLabel: { color: 'rgba(255,255,255,0.7)', fontSize: CF.trendAxis, interval: 1 }, axisLine: { lineStyle: { color: 'rgba(255,255,255,0.15)' } }, axisTick: { show: false } },
            yAxis: { type: 'value', scale: true, axisLabel: { color: 'rgba(255,255,255,0.6)', fontSize: CF.trendAxis, formatter: (v) => formatMinimum(v) }, splitLine: { lineStyle: { color: 'rgba(255,255,255,0.06)' } } },
            series: [
                { name: 'Date A', type: 'line', smooth: true, connectNulls: true, data: a, symbol: 'circle', symbolSize: 5, itemStyle: { color: A_COLOR }, lineStyle: { color: A_COLOR, width: 2.5 }, emphasis: { disabled: true } },
                { name: 'Date B', type: 'line', smooth: true, connectNulls: true, data: b, symbol: 'circle', symbolSize: 5, itemStyle: { color: B_COLOR }, lineStyle: { color: B_COLOR, width: 2.5 }, emphasis: { disabled: true } },
            ],
        }, true);
        const onResize = () => inst.resize();
        window.addEventListener('resize', onResize);
        return () => window.removeEventListener('resize', onResize);
    }, [a, b]);
    return (
        <Box sx={{ bgcolor: 'rgba(22,24,38,0.9)', borderRadius: 2, border: '1px solid rgba(255,255,255,0.06)', p: 1.2 }}>
            <Typography sx={{ color: '#dff5ff', fontSize: CF.trendTitle, fontWeight: 800, mb: 0.5, px: 0.5 }}>Weighted Table Minimum / Hour — A vs B</Typography>
            <Box ref={ref} sx={{ width: '100%', height: 300 }} />
        </Box>
    );
}

export default function PricingComparison({ store, setStore, tiers, dates, defaultDate }) {
    const sorted = useMemo(() => [...new Set([...(dates || []), defaultDate].filter(Boolean))].sort(), [dates, defaultDate]);

    const [dateA, setDateA] = useState(defaultDate || sorted[0] || '');
    const [dateB, setDateB] = useState(() => sorted.find((d) => d !== (defaultDate || sorted[0])) || sorted[0] || '');
    const [hour, setHour] = useState(7);
    const [playing, setPlaying] = useState(false);
    const [selA, setSelA] = useState(() => new Set());
    const [selB, setSelB] = useState(() => new Set());
    // Clear selections when the date or hour changes (stale otherwise).
    useEffect(() => { setSelA(new Set()); }, [dateA, hour]);
    useEffect(() => { setSelB(new Set()); }, [dateB, hour]);
    // Native visualMap selection (opaque ECharts `selected` map, round-tripped)
    // — persist per date so re-renders don't reset the legend filter. Reset
    // when the calendar date changes, like the planning floor.
    const [vmA, setVmA] = useState(null);
    const [vmB, setVmB] = useState(null);
    useEffect(() => { setVmA(null); }, [dateA]);
    useEffect(() => { setVmB(null); }, [dateB]);
    const tiersAsc = useMemo(() => [...tiers].sort((a, b) => (a.min || 0) - (b.min || 0)), [tiers]);
    const [cmpSubs, setCmpSubs] = useState([]);        // [] = all sub-segments

    const tablesA = useMemo(() => liveFloorTables(dateA), [dateA]);
    const tablesB = useMemo(() => liveFloorTables(dateB), [dateB]);
    const subByKey = useMemo(() => {
        const m = new Map();
        for (const t of [...tablesA, ...tablesB]) m.set(t.key, t.sub_segment);
        return m;
    }, [tablesA, tablesB]);
    const subSegments = useMemo(() => [...new Set([...subByKey.values()].filter(Boolean))].sort(), [subByKey]);
    const macroByKey = useMemo(() => {
        const m = new Map();
        for (const t of [...tablesA, ...tablesB]) m.set(t.key, t.segment);
        return m;
    }, [tablesA, tablesB]);
    const macroSegments = useMemo(() => ['MS', 'PM'].filter((s) => [...macroByKey.values()].includes(s)), [macroByKey]);
    const sortedTiers = useMemo(() => [...tiers].sort((a, b) => (b.min || 0) - (a.min || 0)), [tiers]);
    // Breakdown = which dimension slices the columns (rows are ALWAYS the
    // table minimum). MS/PM → columns per macro segment; Sub → per sub-seg.
    const [breakdown, setBreakdown] = useState('segment'); // 'segment' | 'sub'
    const [showPct, setShowPct] = useState(true);          // toggle the % columns
    const groupsForBreakdown = breakdown === 'sub' ? subSegments : macroSegments;
    const groupOfKey = breakdown === 'sub' ? subByKey : macroByKey;

    // Open-hours for both dates (one hourly fetch).
    const [hourly, setHourly] = useState(null);
    const [loading, setLoading] = useState(true);
    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        fetchHourlyData({}).then((rows) => { if (!cancelled) setHourly(rows || []); })
            .catch(() => { if (!cancelled) setHourly([]); })
            .finally(() => { if (!cancelled) setLoading(false); });
        return () => { cancelled = true; };
    }, []);
    const openA = useMemo(() => (hourly ? openByHourForDate(hourly, dateA) : null), [hourly, dateA]);
    const openB = useMemo(() => (hourly ? openByHourForDate(hourly, dateB) : null), [hourly, dateB]);

    const repA = useMemo(() => floorAtHour(store, dateA, hour, openA, tablesA.map((t) => t.key)), [store, dateA, hour, openA, tablesA]);
    const repB = useMemo(() => floorAtHour(store, dateB, hour, openB, tablesB.map((t) => t.key)), [store, dateB, hour, openB, tablesB]);

    // Apply a minimum (or clear) to the selected tables of one date at the
    // current hour — only OPEN tables are priced (closed are skipped).
    const applyTier = (date, openMap, keys, tierId, clearSel) => {
        if (!setStore) return;
        setStore((prev) => {
            const open = openMap ? (openMap.get(hour) || new Set()) : null;
            const cur = getDaypartAssignments(prev, date, `h_${hour}`);
            const next = { ...cur };
            for (const k of keys) {
                if (open && !open.has(k)) continue;          // closed → no price
                if (tierId === '__clear__') delete next[k];
                else next[k] = { base: tierId, min: tierId, max: tierId };
            }
            return setDaypartAssignments(prev, date, `h_${hour}`, next);
        });
        if (clearSel) clearSel();
    };
    // Click-toggle selection handler for a map.
    const makeSelHandler = (setSel) => (nextSet, info = {}) => {
        if (info.clicked && !info.brushed && !info.cleared) {
            setSel((prev) => { const ns = new Set(prev); ns.has(info.clicked) ? ns.delete(info.clicked) : ns.add(info.clicked); return ns; });
            return;
        }
        setSel(nextSet);
    };

    // For every tier ROW × every group in the breakdown → count for A, B,
    // plus a Total (All) column per row. Rows are ALWAYS the table minimums.
    // Result: rows[tierId] = { [group]: { a, b }, All: { a, b } }, plus
    // per-group column totals + a grand total + weighted-avg minimum.
    const cmp = useMemo(() => {
        const subOk = cmpSubs.length === 0 ? null : new Set(cmpSubs);
        const tierMin = new Map(sortedTiers.map((t) => [t.id, t.min || 0]));
        const blankCell = () => { const o = { All: { a: 0, b: 0 } }; for (const g of groupsForBreakdown) o[g] = { a: 0, b: 0 }; return o; };
        const rows = new Map(sortedTiers.map((t) => [t.id, blankCell()]));
        const totals = blankCell();
        let wsumA = 0, wnA = 0, wsumB = 0, wnB = 0;

        const add = (assignments, side) => {
            for (const k of Object.keys(assignments)) {
                if (subOk && !subOk.has(subByKey.get(k))) continue;
                const tid = assignments[k];
                if (!rows.has(tid)) continue;
                const g = groupOfKey.get(k);
                const cell = rows.get(tid);
                cell.All[side] += 1; totals.All[side] += 1;
                if (g && cell[g]) { cell[g][side] += 1; totals[g][side] += 1; }
                if (side === 'a') { wsumA += (tierMin.get(tid) || 0); wnA += 1; }
                else               { wsumB += (tierMin.get(tid) || 0); wnB += 1; }
            }
        };
        add(repA.assignments, 'a');
        add(repB.assignments, 'b');
        return { rows, totals, wavgA: wnA ? wsumA / wnA : null, wavgB: wnB ? wsumB / wnB : null };
    }, [repA, repB, cmpSubs, subByKey, groupOfKey, groupsForBreakdown, sortedTiers]);

    // Hourly weighted-minimum trend for both dates.
    const trend = useMemo(() => {
        const tierMin = new Map(sortedTiers.map((t) => [t.id, t.min || 0]));
        const subOk = cmpSubs.length === 0 ? null : new Set(cmpSubs);
        const calc = (date, openMap, keys) => GAMING_HOURS.map((h) => {
            const open = openMap ? (openMap.get(h) || null) : null;
            const a = getDaypartAssignments(store, date, `h_${h}`);
            let sum = 0, n = 0;
            for (const key of keys) {
                if (open && !open.has(key)) continue;
                if (subOk && !subOk.has(subByKey.get(key))) continue;
                const p = readPrice(a[key]);
                if (!p) continue;
                sum += (tierMin.get(p.base) || 0); n += 1;
            }
            return n ? sum / n : null;
        });
        return { a: calc(dateA, openA, tablesA.map((t) => t.key)), b: calc(dateB, openB, tablesB.map((t) => t.key)) };
    }, [store, dateA, dateB, openA, openB, tablesA, tablesB, cmpSubs, subByKey, sortedTiers]);

    const fmtAvg = (v) => (v == null ? '–' : formatMinimum(Math.round(v)));
    const varColor = (n) => (n > 0 ? '#6ad08f' : (n < 0 ? '#f76d6d' : 'rgba(255,255,255,0.5)'));
    const fmtDelta = (n) => (n === 0 ? '0' : (n > 0 ? `+${n}` : `${n}`));
    const headSx = { py: SF.rowGapY, px: 0.7, textAlign: 'right', fontSize: SF.header, fontWeight: 800, letterSpacing: 0.3, textTransform: 'uppercase', color: TXT, borderBottom: '1px solid rgba(255,255,255,0.12)' };
    const cellSx = (strong, color) => ({ py: SF.rowGapY, px: 0.7, textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontSize: SF.cell, fontWeight: strong ? 800 : 600, color: color || TXT, borderBottom: '1px solid rgba(255,255,255,0.05)' });

    return (
        <Box sx={{ mb: 1.5 }}>
            {/* Sub-segment filter (same as the planning control panel). */}
            <Stack direction="row" spacing={1.2} sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 1, mb: 1.2, p: 1.2, borderRadius: 2, bgcolor: 'rgba(255,255,255,0.025)', border: '1px solid rgba(122,200,220,0.14)' }}>
                <Typography sx={{ color: 'rgba(220,245,255,0.65)', fontSize: CF.subSeg, fontWeight: 800, letterSpacing: 0.5 }}>SUB-SEG</Typography>
                <Select size="small" multiple displayEmpty value={cmpSubs} onChange={(e) => setCmpSubs(e.target.value)}
                    renderValue={(s) => (s.length === 0 ? 'All sub-seg' : s.join(', '))} sx={{ ...ctrlSx, minWidth: 160 }}>
                    {subSegments.map((s) => (
                        <MenuItem key={s} value={s} sx={{ fontSize: CF.head, py: 0.2 }}>
                            <Checkbox checked={cmpSubs.includes(s)} size="small" sx={{ p: 0.4, color: 'rgba(255,255,255,0.35)', '&.Mui-checked': { color: A_COLOR } }} />{s}
                        </MenuItem>
                    ))}
                </Select>
                <Box sx={{ width: '1px', height: 24, bgcolor: 'rgba(122,200,220,0.25)' }} />
                <Typography sx={{ color: 'rgba(220,245,255,0.65)', fontSize: CF.subSeg, fontWeight: 800, letterSpacing: 0.5 }}>BREAKDOWN BY</Typography>
                <Select size="small" value={breakdown} onChange={(e) => setBreakdown(e.target.value)} sx={{ ...ctrlSx, minWidth: 150 }}>
                    <MenuItem value="segment" sx={{ fontSize: CF.head }}>MS / PM</MenuItem>
                    <MenuItem value="sub" sx={{ fontSize: CF.head }}>Sub-segment</MenuItem>
                </Select>
                <Box sx={{ width: '1px', height: 24, bgcolor: 'rgba(122,200,220,0.25)' }} />
                {/* Show / hide the % columns (A%, B%, Δ%). */}
                <Box onClick={() => setShowPct((v) => !v)}
                    sx={{
                        height: 32, px: 1.2, borderRadius: 1, display: 'flex', alignItems: 'center', gap: 0.7, cursor: 'pointer', userSelect: 'none',
                        fontSize: CF.head, fontWeight: 800, whiteSpace: 'nowrap',
                        color: showPct ? '#06182a' : 'rgba(255,255,255,0.65)',
                        bgcolor: showPct ? '#7adfff' : 'rgba(255,255,255,0.05)',
                        border: `1px solid ${showPct ? '#7adfff' : 'rgba(122,200,220,0.22)'}`,
                        '&:hover': { borderColor: 'rgba(122,200,220,0.55)' },
                    }}>
                    <Box sx={{
                        width: 26, height: 14, borderRadius: 7, position: 'relative',
                        bgcolor: showPct ? 'rgba(6,24,44,0.35)' : 'rgba(255,255,255,0.15)',
                        transition: 'background-color 160ms',
                    }}>
                        <Box sx={{
                            position: 'absolute', top: 1, left: showPct ? 13 : 1,
                            width: 12, height: 12, borderRadius: '50%',
                            bgcolor: showPct ? '#06182a' : '#dff5ff', transition: 'left 160ms',
                        }} />
                    </Box>
                    Show %
                </Box>
            </Stack>

            {loading ? (
                <Stack alignItems="center" sx={{ py: 6 }}><CircularProgress size={26} sx={{ color: A_COLOR }} /></Stack>
            ) : (
                <Stack spacing={1.5}>
                    {/* Shared hour timeline — controls BOTH dates' maps. */}
                    <TimelineControl currentHour={hour} onCurrentHour={setHour} playing={playing} onPlaying={setPlaying} />

                    {/* Two maps on the SAME row, each with its own date picker.
                        Select tables on a map, then pick a minimum to set it. */}
                    <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 1.5 }}>
                        <FloorPanel label="Date A" color={A_COLOR} date={dateA} onDateChange={setDateA}
                            tables={tablesA} assignments={repA.assignments} closed={repA.closed} tiers={tiers} scheduleLoaded={!!openA}
                            selectedKeys={selA} onSelectionChange={makeSelHandler(setSelA)}
                            vmSelected={vmA} onVmSelected={setVmA}
                            tierBar={selA.size > 0 ? <MiniTierBar count={selA.size} tiers={tiersAsc} color={A_COLOR}
                                onPick={(tid) => applyTier(dateA, openA, [...selA], tid, () => setSelA(new Set()))} onClear={() => setSelA(new Set())} /> : null} />
                        <FloorPanel label="Date B" color={B_COLOR} date={dateB} onDateChange={setDateB}
                            tables={tablesB} assignments={repB.assignments} closed={repB.closed} tiers={tiers} scheduleLoaded={!!openB}
                            selectedKeys={selB} onSelectionChange={makeSelHandler(setSelB)}
                            vmSelected={vmB} onVmSelected={setVmB}
                            tierBar={selB.size > 0 ? <MiniTierBar count={selB.size} tiers={tiersAsc} color={B_COLOR}
                                onPick={(tid) => applyTier(dateB, openB, [...selB], tid, () => setSelB(new Set()))} onClear={() => setSelB(new Set())} /> : null} />
                    </Box>

                    {/* Comparison table — tables by minimum + variance, at this hour. */}
                    <Box sx={{ p: 1.5, bgcolor: 'rgba(8,22,36,0.55)', borderRadius: 2, border: '1px solid rgba(122,200,220,0.12)' }}>
                        <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 0.4 }}>
                            <Box sx={{ width: 4, height: SF.title, bgcolor: A_COLOR, borderRadius: 1 }} />
                            <Typography sx={{ color: TXT, fontSize: SF.title, fontWeight: 800, lineHeight: 1 }}>Comparison</Typography>
                        </Stack>
                        <Typography sx={{ color: 'rgba(255,255,255,0.5)', fontSize: SF.header, mb: 0.8 }}>
                            Tables by minimum · broken down by {breakdown === 'segment' ? 'MS / PM' : 'sub-segment'} · {String(hour).padStart(2, '0')}:00 · <span style={{ color: A_COLOR }}>{dateA}</span> vs <span style={{ color: B_COLOR }}>{dateB}</span>
                        </Typography>
                        {(() => {
                            const groups = groupsForBreakdown;
                            const groupCols = [...groups, 'All'];
                            // Order per group: A, B, Δ, then (optional) A%, B%, Δ%.
                            const N_SUB = showPct ? 6 : 3;
                            const COL_MIN_W = 56;   // wider group cells for readability
                            const smallHeadSx = { ...headSx, textAlign: 'center', px: 0.6, minWidth: COL_MIN_W, fontSize: SF.header - 1 };
                            const smallCell = (strong, color) => ({ ...cellSx(strong, color), textAlign: 'center', px: 0.6, minWidth: COL_MIN_W, fontSize: SF.cell - 1 });
                            // A count of `n` out of grand-total open (that side).
                            const rowPct = (n, tot) => (tot > 0 ? (n / tot) * 100 : 0);
                            const fmtPct = (v) => (v > 0 ? `${Math.round(v)}%` : '-');
                            const fmtPPct = (v) => (v === 0 ? '0%' : (v > 0 ? `+${Math.round(v)}%` : `${Math.round(v)}%`));
                            const totA = cmp.totals.All.a, totB = cmp.totals.All.b;
                            // Panel bg used for the sticky-first-column so cells behind it don't bleed.
                            const PANEL_BG = 'rgb(11, 22, 35)';
                            const stickyFirst = {
                                position: 'sticky', left: 0, zIndex: 3, bgcolor: PANEL_BG,
                                borderRight: '1px solid rgba(122,200,220,0.22)',
                            };
                            return (
                                <Box sx={{
                                    overflowX: 'auto',
                                    // Custom scrollbar — matches the dashboard cyan accent.
                                    scrollbarColor: 'rgba(122,223,255,0.45) rgba(255,255,255,0.05)',
                                    scrollbarWidth: 'thin',
                                    '&::-webkit-scrollbar': { height: 9 },
                                    '&::-webkit-scrollbar-track': { bgcolor: 'rgba(255,255,255,0.04)', borderRadius: 4, mx: 0.5 },
                                    '&::-webkit-scrollbar-thumb': { bgcolor: 'rgba(122,223,255,0.4)', borderRadius: 4, border: '2px solid transparent', backgroundClip: 'padding-box' },
                                    '&::-webkit-scrollbar-thumb:hover': { bgcolor: 'rgba(122,223,255,0.75)' },
                                }}>
                                    <Box component="table" sx={{ width: 'max-content', minWidth: '100%', borderCollapse: 'separate', borderSpacing: 0 }}>
                                        <Box component="thead">
                                            {/* Row 1 — group names spanning the 6 sub-columns. */}
                                            <Box component="tr">
                                                <Box component="th" rowSpan={2} sx={{ ...headSx, ...stickyFirst, textAlign: 'left', pl: 0.5, minWidth: 130, borderBottom: '1px solid rgba(255,255,255,0.22)' }}>Min</Box>
                                                {groupCols.map((g) => (
                                                    <Box key={g} component="th" colSpan={N_SUB}
                                                        sx={{ ...headSx, textAlign: 'center', px: 0.4, borderLeft: '1px solid rgba(255,255,255,0.18)', bgcolor: g === 'All' ? 'rgba(122,223,255,0.06)' : 'transparent' }}>
                                                        {g}
                                                    </Box>
                                                ))}
                                            </Box>
                                            {/* Row 2 — order: A, B, Δ, then (optional) A%, B%, Δ%. */}
                                            <Box component="tr">
                                                {groupCols.map((g) => {
                                                    const bg = g === 'All' ? 'rgba(122,223,255,0.06)' : 'transparent';
                                                    return (
                                                        <React.Fragment key={g}>
                                                            <Box component="th" sx={{ ...smallHeadSx, color: A_COLOR, borderLeft: '1px solid rgba(255,255,255,0.18)', bgcolor: bg }}>A</Box>
                                                            <Box component="th" sx={{ ...smallHeadSx, color: B_COLOR, bgcolor: bg }}>B</Box>
                                                            <Box component="th" sx={{ ...smallHeadSx, bgcolor: bg }}>Δ</Box>
                                                            {showPct && (
                                                                <>
                                                                    <Box component="th" sx={{ ...smallHeadSx, color: A_COLOR, opacity: 0.75, borderLeft: '1px dashed rgba(255,255,255,0.14)', bgcolor: bg }}>A %</Box>
                                                                    <Box component="th" sx={{ ...smallHeadSx, color: B_COLOR, opacity: 0.75, bgcolor: bg }}>B %</Box>
                                                                    <Box component="th" sx={{ ...smallHeadSx, opacity: 0.75, bgcolor: bg }}>Δ %</Box>
                                                                </>
                                                            )}
                                                        </React.Fragment>
                                                    );
                                                })}
                                            </Box>
                                        </Box>
                                        <Box component="tbody">
                                            {sortedTiers.map((t) => {
                                                const row = cmp.rows.get(t.id);
                                                const empty = !row || (row.All.a === 0 && row.All.b === 0);
                                                return (
                                                    <Box component="tr" key={t.id} sx={{ opacity: empty ? 0.4 : 1 }}>
                                                        <Box component="td" sx={{ ...stickyFirst, py: SF.rowGapY, px: 0.5, borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                                                            <Stack direction="row" spacing={0.7} sx={{ alignItems: 'center' }}>
                                                                <Box sx={{ width: 12, height: 12, borderRadius: '3px', bgcolor: t.color, flexShrink: 0 }} />
                                                                <Typography sx={{ color: TXT, fontSize: SF.tierLabel, fontWeight: 700, lineHeight: 1, whiteSpace: 'nowrap' }}>{t.label || formatMinimum(t.min)}</Typography>
                                                            </Stack>
                                                        </Box>
                                                        {groupCols.map((g) => {
                                                            const a = row?.[g]?.a || 0;
                                                            const b = row?.[g]?.b || 0;
                                                            const d = b - a;
                                                            const pA = rowPct(a, totA), pB = rowPct(b, totB), pD = pA - pB;
                                                            const bg = g === 'All' ? 'rgba(122,223,255,0.06)' : 'transparent';
                                                            const empty0 = a === 0 && b === 0;
                                                            return (
                                                                <React.Fragment key={g}>
                                                                    <Box component="td" sx={{ ...smallCell(true, A_COLOR), borderLeft: '1px solid rgba(255,255,255,0.18)', bgcolor: bg }}>{a || '-'}</Box>
                                                                    <Box component="td" sx={{ ...smallCell(true, B_COLOR), bgcolor: bg }}>{b || '-'}</Box>
                                                                    <Box component="td" sx={{ ...smallCell(true, varColor(d)), bgcolor: bg }}>{empty0 ? '-' : fmtDelta(d)}</Box>
                                                                    {showPct && (
                                                                        <>
                                                                            <Box component="td" sx={{ ...smallCell(false, A_COLOR), opacity: 0.85, borderLeft: '1px dashed rgba(255,255,255,0.14)', bgcolor: bg }}>{fmtPct(pA)}</Box>
                                                                            <Box component="td" sx={{ ...smallCell(false, B_COLOR), opacity: 0.85, bgcolor: bg }}>{fmtPct(pB)}</Box>
                                                                            <Box component="td" sx={{ ...smallCell(false, varColor(pD)), bgcolor: bg }}>{empty0 ? '-' : fmtPPct(pD)}</Box>
                                                                        </>
                                                                    )}
                                                                </React.Fragment>
                                                            );
                                                        })}
                                                    </Box>
                                                );
                                            })}
                                            {/* Total open row. */}
                                            <Box component="tr">
                                                <Box component="td" sx={{ ...stickyFirst, py: SF.rowGapY + 0.2, px: 0.5, borderTop: '1px solid rgba(255,255,255,0.15)' }}>
                                                    <Typography sx={{ color: TXT, fontSize: SF.total, fontWeight: 800 }}>Total open</Typography>
                                                </Box>
                                                {groupCols.map((g) => {
                                                    const a = cmp.totals[g]?.a || 0, b = cmp.totals[g]?.b || 0, d = b - a;
                                                    const pA = rowPct(a, totA), pB = rowPct(b, totB), pD = pA - pB;
                                                    const bg = g === 'All' ? 'rgba(122,223,255,0.06)' : 'transparent';
                                                    const topSx = { borderTop: '1px solid rgba(255,255,255,0.15)', fontSize: SF.total - 1 };
                                                    const empty0 = a === 0 && b === 0;
                                                    return (
                                                        <React.Fragment key={g}>
                                                            <Box component="td" sx={{ ...smallCell(true, A_COLOR), ...topSx, borderLeft: '1px solid rgba(255,255,255,0.18)', bgcolor: bg }}>{a}</Box>
                                                            <Box component="td" sx={{ ...smallCell(true, B_COLOR), ...topSx, bgcolor: bg }}>{b}</Box>
                                                            <Box component="td" sx={{ ...smallCell(true, varColor(d)), ...topSx, bgcolor: bg }}>{empty0 ? '-' : fmtDelta(d)}</Box>
                                                            {showPct && (
                                                                <>
                                                                    <Box component="td" sx={{ ...smallCell(false, A_COLOR), ...topSx, opacity: 0.85, borderLeft: '1px dashed rgba(255,255,255,0.14)', bgcolor: bg }}>{fmtPct(pA)}</Box>
                                                                    <Box component="td" sx={{ ...smallCell(false, B_COLOR), ...topSx, opacity: 0.85, bgcolor: bg }}>{fmtPct(pB)}</Box>
                                                                    <Box component="td" sx={{ ...smallCell(false, varColor(pD)), ...topSx, bgcolor: bg }}>{empty0 ? '-' : fmtPPct(pD)}</Box>
                                                                </>
                                                            )}
                                                        </React.Fragment>
                                                    );
                                                })}
                                            </Box>
                                            {/* Wtd avg min row — one summary block, spans the rest. */}
                                            <Box component="tr">
                                                <Box component="td" sx={{ ...stickyFirst, py: SF.rowGapY, px: 0.5 }}>
                                                    <Typography sx={{ color: 'rgba(220,245,255,0.75)', fontSize: SF.header, fontWeight: 700 }}>Wtd avg min</Typography>
                                                </Box>
                                                <Box component="td" colSpan={groupCols.length * N_SUB} sx={{ py: SF.rowGapY, px: 0.5, borderBottom: 'none' }}>
                                                    <Stack direction="row" spacing={2} justifyContent="center">
                                                        <Typography sx={{ fontSize: SF.cell, fontWeight: 800, color: A_COLOR }}>A: {fmtAvg(cmp.wavgA)}</Typography>
                                                        <Typography sx={{ fontSize: SF.cell, fontWeight: 800, color: B_COLOR }}>B: {fmtAvg(cmp.wavgB)}</Typography>
                                                        {(() => {
                                                            const d = (cmp.wavgA != null && cmp.wavgB != null) ? cmp.wavgB - cmp.wavgA : null;
                                                            return (
                                                                <Typography sx={{ fontSize: SF.cell, fontWeight: 800, color: d == null ? TXT : varColor(d) }}>
                                                                    Δ: {d == null ? '–' : `${d >= 0 ? '+' : '−'}${formatMinimum(Math.round(Math.abs(d)))}`}
                                                                </Typography>
                                                            );
                                                        })()}
                                                    </Stack>
                                                </Box>
                                            </Box>
                                        </Box>
                                    </Box>
                                </Box>
                            );
                        })()}
                    </Box>

                    {/* Hourly trend below the comparison table. */}
                    <TrendChart a={trend.a} b={trend.b} />
                </Stack>
            )}
        </Box>
    );
}
