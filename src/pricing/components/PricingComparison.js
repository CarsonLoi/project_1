// PricingComparison — compare two dates' pricing side by side
// ===========================================================
//
// Two scatter maps sit on ONE row (date A | date B), each with its own
// calendar date picker in its top-right corner. A single hour timeline
// drives BOTH maps. Below the maps: a comparison table (tables-by-minimum
// for the two dates at the current hour, with variance), then an hourly
// weighted-minimum trend for both dates. Sub-segment filter only.

import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import * as echarts from 'echarts';
import { Box, Stack, Typography, Select, MenuItem, Checkbox, CircularProgress, Button, Tooltip } from '@mui/material';
import FileUploadIcon from '@mui/icons-material/FileUpload';
import PricingFloorMap from './PricingFloorMap';
import TimelineControl, { GAMING_HOURS } from './TimelineControl';
import { readPrice } from '../utils/pricingModel';
import { getDaypartAssignments, setDaypartAssignments } from '../utils/pricingStorage';
import { liveFloorTables } from '../utils/floorConfig';
import { sortSubSegments } from '../../shared/constants/pitSegments';
import { formatMinimum } from '../constants/defaultTiers';
import { PRICING_FONTS } from '../constants/fontSizes';
import { CMP_FLOOR_ASPECT } from '../constants/floorLayout';
import { fetchScheduleHours } from '../utils/scheduleSource';
import { fetchHourlyData, gametypeTableKey } from '../../performance/utils/dataSource';
import { aggregateHistoryMin, buildHistorySuggestions, DOW_LABELS } from '../utils/pricingHistory';
import HistoryIcon from '@mui/icons-material/History';

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
function FloorPanel({
    date, onDateChange, color, label, tables, assignments, closed, tiers, tierBar,
    selectedKeys, onSelectionChange, vmSelected, onVmSelected, scheduleLoaded,
    hourValue, onHourChange, showHourPicker,   // same-date mode: per-map hour dropdown
    changeHighlights, changeColors,            // Plan B highlight overlay
    headerRight,                               // e.g. "Δ N changed" badge
    // "From history" floating panel controls — mirrors planning-mode.
    histOpen, onToggleHist, histPanel,
}) {
    // "From history" toggle — same green pill treatment as planning-mode.
    const histBtn = onToggleHist ? (
        <Button
            onClick={onToggleHist}
            size="small"
            startIcon={<HistoryIcon sx={{ fontSize: 14 }} />}
            sx={{
                textTransform: 'none', fontSize: CF.panelMeta, fontWeight: 700,
                color: histOpen ? '#0a1a2c' : '#9ece6a',
                bgcolor: histOpen ? '#9ece6a' : 'transparent',
                border: '1px solid rgba(158,206,106,0.45)', px: 1, py: 0.1, minWidth: 0, lineHeight: 1.4,
                '&:hover': { bgcolor: histOpen ? '#b5e08a' : 'rgba(158,206,106,0.10)', borderColor: '#9ece6a' },
            }}
        >
            From history
        </Button>
    ) : null;
    const priceByKey = useMemo(() => {
        const m = new Map();
        for (const k of Object.keys(assignments)) m.set(k, { base: assignments[k], min: assignments[k], max: assignments[k] });
        return m;
    }, [assignments]);
    // Compact hour picker rendered under the date overlay in same-date mode.
    const hourOverlay = showHourPicker ? (
        <Box component="select" value={hourValue ?? 7} onChange={(e) => onHourChange && onHourChange(Number(e.target.value))}
            sx={{
                display: 'block', height: 30, px: 0.8, fontSize: 13, fontWeight: 800, fontFamily: 'inherit',
                color: '#fff', bgcolor: 'rgba(10,22,35,0.9)', border: '1px solid rgba(122,200,220,0.4)',
                borderRadius: 1.2, outline: 'none', cursor: 'pointer',
            }}>
            {Array.from({ length: 24 }, (_, h) => (
                <Box key={h} component="option" value={h} sx={{ color: '#000' }}>{String(h).padStart(2, '0')}:00</Box>
            ))}
        </Box>
    ) : null;
    return (
        <Box sx={{ minWidth: 0 }}>
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 0.6 }}>
                <Box sx={{ width: 10, height: 10, borderRadius: '2px', bgcolor: color }} />
                <Typography sx={{ color: TXT, fontSize: CF.panelLabel, fontWeight: 800, lineHeight: 1 }}>{label}</Typography>
                <Typography sx={{ color: 'rgba(255,255,255,0.45)', fontSize: CF.panelMeta }}>
                    {Object.keys(assignments).length} open · priced
                </Typography>
                <Box sx={{ flex: 1 }} />
                {histBtn}
                {headerRight}
            </Stack>
            {histOpen && histPanel}
            <Box sx={{ position: 'relative', width: '100%', aspectRatio: CMP_FLOOR_ASPECT, bgcolor: 'rgba(22,24,38,0.9)', borderRadius: 2, border: '1px solid rgba(255,255,255,0.06)', overflow: 'hidden' }}>
                <PricingFloorMap
                    tables={tables} assignments={assignments} tiers={tiers} priceByKey={priceByKey}
                    closedKeys={closed} fixedKeys={null} selectedKeys={selectedKeys} activeBrushShiftId={null}
                    onSelectionChange={onSelectionChange} onAssign={() => {}} flexEnabled={false}
                    date={date} onDateChange={onDateChange} scheduleLoaded={scheduleLoaded}
                    vmSelected={vmSelected} onVmSelected={onVmSelected}
                    mode="comparison"
                    dateOverlayExtra={hourOverlay}
                    changeHighlights={changeHighlights}
                    changeColors={changeColors}
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
    // Same-date mode: each map has its own hour, so you can compare hour X
    // vs hour Y on the same date. When the dates differ, both maps share the
    // timeline's `hour` above.
    const sameDate = !!dateA && dateA === dateB;
    const [hourA, setHourA] = useState(hour);
    const [hourB, setHourB] = useState(hour);
    // Whenever you switch INTO same-date mode, seed both dropdowns from the
    // shared timeline so nothing jumps. (Once in same-date, the user drives
    // them independently.)
    useEffect(() => { if (sameDate) { setHourA(hour); setHourB(hour); } }, [sameDate]); // eslint-disable-line react-hooks/exhaustive-deps
    // The hour each floor actually renders at.
    const effHourA = sameDate ? hourA : hour;
    const effHourB = sameDate ? hourB : hour;

    // ── Comparison highlight (Plan B side only) ─────────────────────
    // Enable a small on/off toggle. When ON, tables whose base minimum
    // differs between A and B get a rectangle outline on Plan B's floor:
    // GREEN = B is HIGHER than A; RED = B is LOWER than A. Only tables
    // present in BOTH plans' assignments AND (when a schedule is loaded)
    // open at their respective hours are considered.
    const [highlightOn, setHighlightOn] = useState(true);
    // Per-map "From history" panels — INDEPENDENT between A and B. Mirrors
    // the planning floating window: reference date range + weekday chips +
    // reference-hours multi-select → aggregate `tablemin` over the window,
    // build mode-based tier triples, write to the plan store for that side's
    // date at the CURRENT hour (targeting selected tables, or all open at
    // that hour when nothing is selected).
    const today = defaultDate || new Date().toISOString().slice(0, 10);
    const twelveWeeksAgo = (() => {
        const d = new Date(today); d.setDate(d.getDate() - 84); return d.toISOString().slice(0, 10);
    })();
    const [histOpenA, setHistOpenA] = useState(false);
    const [histOpenB, setHistOpenB] = useState(false);
    const [histRangeA, setHistRangeA] = useState({ from: twelveWeeksAgo, to: today });
    const [histRangeB, setHistRangeB] = useState({ from: twelveWeeksAgo, to: today });
    const [histDowsA, setHistDowsA] = useState([]);   // [] = all weekdays
    const [histDowsB, setHistDowsB] = useState([]);
    const [histHoursA, setHistHoursA] = useState(null); // null = all hours
    const [histHoursB, setHistHoursB] = useState(null);
    const [histBusyA, setHistBusyA] = useState(false);
    const [histBusyB, setHistBusyB] = useState(false);
    // Perf hourly rows — loaded lazily on first "From history" open. Cached
    // for the session so subsequent opens (either side) apply instantly.
    const [hourlyRows, setHourlyRows] = useState(null);
    const ensureHourlyRows = useCallback(async () => {
        if (hourlyRows) return hourlyRows;
        const rows = (await fetchHourlyData({})) || [];
        setHourlyRows(rows);
        return rows;
    }, [hourlyRows]);
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
    // Sub-segment order follows the SUB_SEGMENT_ORDER dictionary in
    // shared/constants/pitSegments.js (edit that list to reorder). Unknowns
    // are appended alphabetically. Blanks/dupes are dropped.
    const subSegments = useMemo(() => sortSubSegments([...subByKey.values()]), [subByKey]);
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

    // Open-hours for both dates — same source planning uses (spread DB via
    // fetchScheduleHours), so a table priced in planning shows up here.
    const [openA, setOpenA] = useState(null);
    const [openB, setOpenB] = useState(null);
    // No initial load spinner needed now that we fetch spread schedules per
    // date on demand — the maps render immediately from the shared `store`.
    const loading = false;
    // Spread DB schedule per date (mirrors planning's `openByHour` flow).
    useEffect(() => {
        if (!dateA) { setOpenA(null); return; }
        let cancelled = false;
        fetchScheduleHours({ date: dateA }).then((rows) => {
            if (cancelled) return;
            const m = new Map();
            for (const r of rows || []) {
                if (Number(r.spread) !== 1 || r.hour == null) continue;
                const h = Number(r.hour);
                if (!m.has(h)) m.set(h, new Set());
                m.get(h).add(gametypeTableKey(r.gametype, r.table));
            }
            setOpenA(m.size > 0 ? m : null);
        }).catch(() => { if (!cancelled) setOpenA(null); });
        return () => { cancelled = true; };
    }, [dateA]);
    useEffect(() => {
        if (!dateB) { setOpenB(null); return; }
        let cancelled = false;
        fetchScheduleHours({ date: dateB }).then((rows) => {
            if (cancelled) return;
            const m = new Map();
            for (const r of rows || []) {
                if (Number(r.spread) !== 1 || r.hour == null) continue;
                const h = Number(r.hour);
                if (!m.has(h)) m.set(h, new Set());
                m.get(h).add(gametypeTableKey(r.gametype, r.table));
            }
            setOpenB(m.size > 0 ? m : null);
        }).catch(() => { if (!cancelled) setOpenB(null); });
        return () => { cancelled = true; };
    }, [dateB]);

    const repA = useMemo(() => floorAtHour(store, dateA, effHourA, openA, tablesA.map((t) => t.key)), [store, dateA, effHourA, openA, tablesA]);
    const repB = useMemo(() => floorAtHour(store, dateB, effHourB, openB, tablesB.map((t) => t.key)), [store, dateB, effHourB, openB, tablesB]);

    // Highlight map for Plan B (green = higher, red = lower vs Plan A).
    const tierMinMap = useMemo(() => new Map(tiers.map((t) => [t.id, t.min || 0])), [tiers]);
    const changeHighlightsB = useMemo(() => {
        const out = new Map();
        if (!highlightOn) return out;
        for (const k of Object.keys(repB.assignments)) {
            const bId = repB.assignments[k];
            const aId = repA.assignments[k];
            if (!aId) continue;                 // only compare tables priced in both
            if (aId === bId) continue;          // no change
            const bMin = tierMinMap.get(bId) || 0;
            const aMin = tierMinMap.get(aId) || 0;
            if (bMin === aMin) continue;
            out.set(k, bMin > aMin ? 'up' : 'down');
        }
        return out;
    }, [highlightOn, repA.assignments, repB.assignments, tierMinMap]);
    const changedCount = changeHighlightsB.size;

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

    // Apply "From history" for one side: aggregate the ref window rows,
    // build tier triples, and write to that side's plan store at the
    // current effective hour. Targets the map's selection, or (when empty)
    // ALL open tables at that hour.
    const applyHistoryFor = useCallback(async (side) => {
        const cfg = side === 'A'
            ? { date: dateA, effHour: effHourA, openMap: openA, tables: tablesA, sel: selA, clearSel: () => setSelA(new Set()),
                range: histRangeA, dows: histDowsA, hours: histHoursA, setBusy: setHistBusyA }
            : { date: dateB, effHour: effHourB, openMap: openB, tables: tablesB, sel: selB, clearSel: () => setSelB(new Set()),
                range: histRangeB, dows: histDowsB, hours: histHoursB, setBusy: setHistBusyB };
        if (!cfg.date || !setStore) return;
        cfg.setBusy(true);
        try {
            const rows = await ensureHourlyRows();
            let agg = aggregateHistoryMin(rows, { from: cfg.range.from, to: cfg.range.to, dows: cfg.dows, hours: cfg.hours });
            // Fallback: if the chosen window has zero data, retry over the
            // most recent 28 dates present so the panel is never dead-air.
            if (agg.size === 0 && rows.length > 0) {
                const recent = [...new Set(rows.map((r) => String(r.date).slice(0, 10)))].sort().slice(-28);
                if (recent.length) {
                    agg = aggregateHistoryMin(rows, { from: recent[0], to: recent[recent.length - 1], dows: cfg.dows, hours: cfg.hours });
                }
            }
            const sugg = buildHistorySuggestions(agg, tiers);
            // Target keys: current selection, or ALL open tables at that hour.
            const openSet = cfg.openMap ? (cfg.openMap.get(cfg.effHour) || new Set()) : null;
            const allKeys = cfg.tables.map((t) => t.key).filter((k) => !openSet || openSet.has(k));
            const targetKeys = cfg.sel && cfg.sel.size > 0 ? [...cfg.sel] : allKeys;
            let applied = 0;
            setStore((prev) => {
                const cur = getDaypartAssignments(prev, cfg.date, `h_${cfg.effHour}`);
                const next = { ...cur };
                for (const k of targetKeys) {
                    if (openSet && !openSet.has(k)) continue;
                    const triple = sugg.get(k);
                    if (!triple) continue;
                    next[k] = { base: triple.base, min: triple.min, max: triple.max };
                    applied += 1;
                }
                if (applied === 0) return prev;
                return setDaypartAssignments(prev, cfg.date, `h_${cfg.effHour}`, next);
            });
            if (applied === 0) {
                window.alert('No historical readings for the target tables in this reference window. Try widening the date range or clearing the day-of-week filter.');
            } else {
                cfg.clearSel();
            }
        } catch (e) {
            window.alert(`Load from history failed: ${e?.message || e}`);
        } finally {
            cfg.setBusy(false);
        }
    }, [dateA, dateB, effHourA, effHourB, openA, openB, tablesA, tablesB, selA, selB,
        histRangeA, histRangeB, histDowsA, histDowsB, histHoursA, histHoursB,
        setStore, tiers, ensureHourlyRows]);

    // Reusable "From history" floating panel — one per side. Independent
    // reference window, day-of-week toggles, and reference hours.
    const HistoryPanel = ({ range, onRange, dows, onDows, hours, onHours, busy, onApply, targetCount, color }) => {
        const toggleDow = (d) => {
            const set = new Set(dows || []);
            if (set.has(d)) set.delete(d); else set.add(d);
            onDows([...set].sort((a, b) => a - b));
        };
        return (
            <Box sx={{ my: 0.8, p: 1, borderRadius: 1.6, bgcolor: 'rgba(158,206,106,0.06)', border: '1px solid rgba(158,206,106,0.30)' }}>
                <Typography sx={{ color: '#9ece6a', fontSize: CF.panelMeta, fontWeight: 800, letterSpacing: 0.6, textTransform: 'uppercase', mb: 0.6 }}>
                    Load from history · mode minimum + historical min/max
                </Typography>
                <Stack direction="row" spacing={0.8} alignItems="center" sx={{ flexWrap: 'wrap', rowGap: 0.8 }}>
                    <Typography sx={{ color: 'rgba(255,255,255,0.6)', fontSize: CF.panelMeta, fontWeight: 700 }}>Ref</Typography>
                    <Box component="input" type="date" value={range?.from || ''}
                        onChange={(e) => onRange({ ...range, from: e.target.value })}
                        sx={{ height: 26, px: 0.6, fontSize: 12, fontWeight: 700, color: '#fff', bgcolor: 'rgba(10,22,35,0.9)', border: '1px solid rgba(122,200,220,0.35)', borderRadius: 1, outline: 'none' }} />
                    <Typography sx={{ color: 'rgba(255,255,255,0.4)', fontSize: 12 }}>→</Typography>
                    <Box component="input" type="date" value={range?.to || ''}
                        onChange={(e) => onRange({ ...range, to: e.target.value })}
                        sx={{ height: 26, px: 0.6, fontSize: 12, fontWeight: 700, color: '#fff', bgcolor: 'rgba(10,22,35,0.9)', border: '1px solid rgba(122,200,220,0.35)', borderRadius: 1, outline: 'none' }} />
                    <Box sx={{ width: 1, height: 20, bgcolor: 'rgba(255,255,255,0.12)', mx: 0.3 }} />
                    <Typography sx={{ color: 'rgba(255,255,255,0.6)', fontSize: CF.panelMeta, fontWeight: 700 }}>Days</Typography>
                    <Stack direction="row" spacing={0.3}>
                        {DOW_LABELS.map((lblTxt, d) => {
                            const on = (dows || []).includes(d);
                            return (
                                <Box key={d} onClick={() => toggleDow(d)} title={lblTxt}
                                    sx={{ width: 22, height: 22, borderRadius: 0.8, cursor: 'pointer',
                                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                                        fontSize: 11, fontWeight: 800,
                                        color: on ? '#0a1a2c' : 'rgba(255,255,255,0.6)',
                                        bgcolor: on ? '#9ece6a' : 'rgba(255,255,255,0.05)',
                                        border: `1px solid ${on ? '#9ece6a' : 'rgba(255,255,255,0.12)'}`,
                                        '&:hover': on ? undefined : { bgcolor: 'rgba(158,206,106,0.12)' } }}>
                                    {lblTxt[0]}
                                </Box>
                            );
                        })}
                    </Stack>
                    {(dows || []).length > 0 && (
                        <Button size="small" onClick={() => onDows([])}
                            sx={{ minWidth: 0, px: 0.6, fontSize: 11, color: 'rgba(255,255,255,0.55)', textTransform: 'none' }}>
                            all
                        </Button>
                    )}
                    <Box sx={{ width: 1, height: 20, bgcolor: 'rgba(255,255,255,0.12)', mx: 0.3 }} />
                    <Typography sx={{ color: 'rgba(255,255,255,0.6)', fontSize: CF.panelMeta, fontWeight: 700 }}>Hrs</Typography>
                    <Select size="small" multiple displayEmpty
                        value={Array.isArray(hours) ? hours : []}
                        onChange={(e) => { const v = e.target.value; onHours(v && v.length ? [...v].sort((a, b) => a - b) : null); }}
                        renderValue={(sel) => (!sel || sel.length === 0 ? 'all' : sel.map((h) => String(h).padStart(2, '0')).join(', '))}
                        MenuProps={{ PaperProps: { sx: { maxHeight: 320, bgcolor: 'rgba(18,22,34,0.98)', color: '#fff', border: '1px solid rgba(122,200,220,0.25)' } } }}
                        sx={{ height: 26, minWidth: 80, maxWidth: 220, fontSize: 12, fontWeight: 700, color: '#fff', bgcolor: 'rgba(10,22,35,0.9)', borderRadius: 1, '& .MuiOutlinedInput-notchedOutline': { borderColor: 'rgba(122,200,220,0.35)' }, '& .MuiSelect-icon': { color: 'rgba(255,255,255,0.5)' } }}>
                        {Array.from({ length: 24 }, (_, h) => (
                            <MenuItem key={h} value={h} sx={{ fontSize: 12, py: 0.15 }}>
                                <Checkbox size="small" checked={(Array.isArray(hours) ? hours : []).includes(h)}
                                    sx={{ p: 0.3, color: 'rgba(255,255,255,0.35)', '&.Mui-checked': { color: '#9ece6a' } }} />
                                {String(h).padStart(2, '0')}:00
                            </MenuItem>
                        ))}
                    </Select>
                    {Array.isArray(hours) && hours.length > 0 && (
                        <Button size="small" onClick={() => onHours(null)}
                            sx={{ minWidth: 0, px: 0.6, fontSize: 11, color: 'rgba(255,255,255,0.55)', textTransform: 'none' }}>
                            all
                        </Button>
                    )}
                    <Box sx={{ flex: 1 }} />
                    <Button
                        onClick={onApply}
                        disabled={busy}
                        size="small"
                        startIcon={busy
                            ? <CircularProgress size={12} thickness={5} sx={{ color: 'inherit' }} />
                            : <HistoryIcon sx={{ fontSize: 14 }} />}
                        sx={{
                            textTransform: 'none', fontSize: 12, fontWeight: 800,
                            color: '#0a1a2c', bgcolor: '#9ece6a', px: 1.2, py: 0.4,
                            '&:hover': { bgcolor: '#b5e08a' },
                        }}
                    >
                        Load {targetCount} at {String((color === A_COLOR ? effHourA : effHourB)).padStart(2, '0')}:00
                    </Button>
                </Stack>
            </Box>
        );
    };

    // Click-toggle selection handler for a map.
    // Import a saved pricing JSON (Save version export) — restores its hourly
    // plan. Same parse logic as the planning view; the file's own `date`
    // wins, and we swap that side's date picker to it after import so the
    // map shows the imported plan immediately. `side` = 'A' | 'B'.
    const importInputA = useRef(null);
    const importInputB = useRef(null);
    const doImportPlan = (file, side) => {
        if (!setStore) return;
        const reader = new FileReader();
        reader.onload = () => {
            try {
                const data = JSON.parse(String(reader.result || '{}'));
                const d = (data.date && String(data.date).slice(0, 10)) || (side === 'A' ? dateA : dateB);
                const buckets = data.byHour
                    ? Object.entries(data.byHour).map(([h, a]) => [`h_${h}`, (a && a.assignments) || a || {}])
                    : (data.byDaypart ? Object.entries(data.byDaypart).map(([id, v]) => [id, (v && v.assignments) || {}]) : []);
                if (buckets.length === 0) { window.alert('No pricing data found in this file.'); return; }
                const cells = buckets.reduce((s, [, a]) => s + Object.keys(a || {}).length, 0);
                if (!window.confirm(`Import into Date ${side} for ${d}\n${buckets.length} hour buckets · ${cells} priced cells.\n\nThis replaces that date's current plan.`)) return;
                setStore((prev) => {
                    let s = prev;
                    for (const [unitId, assignments] of buckets) s = setDaypartAssignments(s, d, unitId, assignments || {});
                    return s;
                });
                if (side === 'A' && d !== dateA) setDateA(d);
                if (side === 'B' && d !== dateB) setDateB(d);
            } catch (err) {
                window.alert(`Import failed: ${err?.message || 'invalid JSON'}`);
            }
        };
        reader.onerror = () => window.alert('Import failed: could not read the file');
        reader.readAsText(file);
    };

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

                {/* Import saved pricing JSON — one button per date. */}
                <Box sx={{ flex: 1 }} />
                <input ref={importInputA} type="file" accept=".json,application/json" style={{ display: 'none' }}
                    onChange={(e) => { const f = e.target.files?.[0]; if (f) doImportPlan(f, 'A'); e.target.value = ''; }} />
                <input ref={importInputB} type="file" accept=".json,application/json" style={{ display: 'none' }}
                    onChange={(e) => { const f = e.target.files?.[0]; if (f) doImportPlan(f, 'B'); e.target.value = ''; }} />
                <Tooltip title="Import a saved pricing JSON into Date A">
                    <Button onClick={() => importInputA.current?.click()}
                        startIcon={<FileUploadIcon sx={{ fontSize: 18 }} />}
                        size="small"
                        sx={{
                            height: 32, textTransform: 'none', fontSize: CF.head, fontWeight: 800,
                            color: A_COLOR, bgcolor: 'rgba(255,255,255,0.05)', px: 1.2, borderRadius: 1,
                            border: `1px solid ${A_COLOR}`, '&:hover': { bgcolor: 'rgba(122,223,255,0.15)' },
                        }}>
                        Import A
                    </Button>
                </Tooltip>
                <Tooltip title="Import a saved pricing JSON into Date B">
                    <Button onClick={() => importInputB.current?.click()}
                        startIcon={<FileUploadIcon sx={{ fontSize: 18 }} />}
                        size="small"
                        sx={{
                            height: 32, textTransform: 'none', fontSize: CF.head, fontWeight: 800,
                            color: B_COLOR, bgcolor: 'rgba(255,255,255,0.05)', px: 1.2, borderRadius: 1,
                            border: `1px solid ${B_COLOR}`, '&:hover': { bgcolor: 'rgba(247,185,85,0.15)' },
                        }}>
                        Import B
                    </Button>
                </Tooltip>

                {/* Highlight toggle — outlines tables on Plan B whose price
                    differs from Plan A: green = B higher, red = B lower. */}
                <Box sx={{ width: '1px', height: 24, bgcolor: 'rgba(122,200,220,0.25)' }} />
                <Box onClick={() => setHighlightOn((v) => !v)}
                    sx={{
                        height: 32, px: 1.2, borderRadius: 1, display: 'flex', alignItems: 'center', gap: 0.7, cursor: 'pointer', userSelect: 'none',
                        fontSize: CF.head, fontWeight: 800, whiteSpace: 'nowrap',
                        color: highlightOn ? '#06182a' : 'rgba(255,255,255,0.65)',
                        bgcolor: highlightOn ? '#7adfff' : 'rgba(255,255,255,0.05)',
                        border: `1px solid ${highlightOn ? '#7adfff' : 'rgba(122,200,220,0.22)'}`,
                        '&:hover': { borderColor: 'rgba(122,200,220,0.55)' },
                    }}>
                    <Box sx={{ width: 26, height: 14, borderRadius: 7, position: 'relative', bgcolor: highlightOn ? 'rgba(6,24,44,0.35)' : 'rgba(255,255,255,0.15)', transition: 'background-color 160ms' }}>
                        <Box sx={{ position: 'absolute', top: 1, left: highlightOn ? 13 : 1, width: 12, height: 12, borderRadius: '50%', bgcolor: highlightOn ? '#06182a' : '#dff5ff', transition: 'left 160ms' }} />
                    </Box>
                    Highlight Δ
                </Box>
            </Stack>

            {loading ? (
                <Stack alignItems="center" sx={{ py: 6 }}><CircularProgress size={26} sx={{ color: A_COLOR }} /></Stack>
            ) : (
                <Stack spacing={1.5}>
                    {/* Shared hour timeline — ONLY when the two dates differ.
                        In same-date mode each map has its own hour dropdown
                        (rendered below the date picker overlay). */}
                    {!sameDate && (
                        <TimelineControl currentHour={hour} onCurrentHour={setHour} playing={playing} onPlaying={setPlaying} />
                    )}

                    {/* Two maps on the SAME row, each with its own date picker.
                        Select tables on a map, then pick a minimum to set it. */}
                    <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 1.5 }}>
                        <FloorPanel label="Date A" color={A_COLOR} date={dateA} onDateChange={setDateA}
                            tables={tablesA} assignments={repA.assignments} closed={repA.closed} tiers={tiers} scheduleLoaded={!!openA}
                            selectedKeys={selA} onSelectionChange={makeSelHandler(setSelA)}
                            vmSelected={vmA} onVmSelected={setVmA}
                            showHourPicker={sameDate} hourValue={hourA} onHourChange={setHourA}
                            histOpen={histOpenA} onToggleHist={() => setHistOpenA((v) => !v)}
                            histPanel={
                                <HistoryPanel color={A_COLOR}
                                    range={histRangeA} onRange={setHistRangeA}
                                    dows={histDowsA} onDows={setHistDowsA}
                                    hours={histHoursA} onHours={setHistHoursA}
                                    busy={histBusyA} onApply={() => applyHistoryFor('A')}
                                    targetCount={selA.size > 0 ? selA.size : (openA ? (openA.get(effHourA) || new Set()).size : tablesA.length)} />
                            }
                            tierBar={selA.size > 0 ? <MiniTierBar count={selA.size} tiers={tiersAsc} color={A_COLOR}
                                onPick={(tid) => applyTier(dateA, openA, [...selA], tid, () => setSelA(new Set()))} onClear={() => setSelA(new Set())} /> : null} />
                        <FloorPanel label="Date B" color={B_COLOR} date={dateB} onDateChange={setDateB}
                            tables={tablesB} assignments={repB.assignments} closed={repB.closed} tiers={tiers} scheduleLoaded={!!openB}
                            selectedKeys={selB} onSelectionChange={makeSelHandler(setSelB)}
                            vmSelected={vmB} onVmSelected={setVmB}
                            showHourPicker={sameDate} hourValue={hourB} onHourChange={setHourB}
                            histOpen={histOpenB} onToggleHist={() => setHistOpenB((v) => !v)}
                            histPanel={
                                <HistoryPanel color={B_COLOR}
                                    range={histRangeB} onRange={setHistRangeB}
                                    dows={histDowsB} onDows={setHistDowsB}
                                    hours={histHoursB} onHours={setHistHoursB}
                                    busy={histBusyB} onApply={() => applyHistoryFor('B')}
                                    targetCount={selB.size > 0 ? selB.size : (openB ? (openB.get(effHourB) || new Set()).size : tablesB.length)} />
                            }
                            changeHighlights={changeHighlightsB}
                            changeColors={{ up: '#46e08a', down: '#ff4d4d' }}
                            headerRight={highlightOn && changedCount > 0 ? (
                                <Typography sx={{ fontSize: CF.panelMeta + 1, fontWeight: 800, color: '#dff5ff', bgcolor: 'rgba(122,223,255,0.14)', px: 0.8, py: 0.2, borderRadius: 0.8, border: '1px solid rgba(122,223,255,0.3)' }}>
                                    Δ {changedCount} changed
                                </Typography>
                            ) : null}
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
                            const COL_MIN_W = 84;   // wider group cells for readability
                            const smallHeadSx = { ...headSx, textAlign: 'center', px: 0.9, minWidth: COL_MIN_W, fontSize: SF.header - 1 };
                            const smallCell = (strong, color) => ({ ...cellSx(strong, color), textAlign: 'center', px: 0.9, minWidth: COL_MIN_W, fontSize: SF.cell - 1 });
                            // A count of `n` out of grand-total open (that side).
                            // Percentages are OF EACH GROUP COLUMN — so the %A
                            // (and %B) values in one column sum to 100% across
                            // the minimum rows. Δ% = %A − %B (in points).
                            const rowPct = (n, tot) => (tot > 0 ? (n / tot) * 100 : 0);
                            const fmtPct = (v) => (v > 0 ? `${Math.round(v)}%` : '-');
                            const fmtPPct = (v) => (v === 0 ? '0%' : (v > 0 ? `+${Math.round(v)}%` : `${Math.round(v)}%`));
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
                                                            const gTotA = cmp.totals[g]?.a || 0;
                                                            const gTotB = cmp.totals[g]?.b || 0;
                                                            const pA = rowPct(a, gTotA), pB = rowPct(b, gTotB), pD = pA - pB;
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
                                                    // Column totals ⇒ percentages sum to 100% within each group column
                                                    // above, so the total row is exactly 100% (or '-' when the column
                                                    // has no data at all).
                                                    const pA = a > 0 ? 100 : 0;
                                                    const pB = b > 0 ? 100 : 0;
                                                    const pD = pA - pB;
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
