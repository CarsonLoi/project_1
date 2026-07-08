// PricingDashboard — table-minimum / pricing assignment
// =====================================================
//
// The pricing sibling of the Spread Scheduling dashboard. Where spread
// assigns SHIFTS to tables, this assigns a TABLE-MINIMUM tier — painting
// a price heatmap onto the same floor. It reuses the spread module's
// FloorScheduleMap (a tier plays the role of a shift: an id + a color)
// and its live-floor resolver, so the canvas, selection, and painting
// behave identically to scheduling.
//
// What it's built to answer ("good to know / necessary to compare"):
//   • Floor price level     — weighted-average minimum across priced tables
//   • Price mix             — how many tables sit at each minimum (tier
//                             distribution); are we offering enough low
//                             minimums for mass play and high for premium?
//   • Coverage              — how many of the live floor's tables are
//                             actually priced vs left blank
//   • Range                 — lowest / highest minimum currently offered
// Versioning per date is stored (saveVersion) so plan-vs-plan variance
// can reuse the scheduling module's planDiff later.

import React, { useMemo, useState, useCallback, useEffect, useRef } from 'react';
import {
    Box, Stack, Typography, Button, MenuItem, Tooltip,
    Select, Dialog, DialogTitle, DialogContent, DialogActions, Checkbox, CircularProgress, IconButton,
} from '@mui/material';
import SaveIcon from '@mui/icons-material/Save';
import FileUploadIcon from '@mui/icons-material/FileUpload';
import CloudDownloadIcon from '@mui/icons-material/CloudDownload';
import GridViewIcon from '@mui/icons-material/GridView';
import SettingsIcon from '@mui/icons-material/Settings';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import CalendarMonthIcon from '@mui/icons-material/CalendarMonth';
import HistoryIcon from '@mui/icons-material/History';
import SummarizeIcon from '@mui/icons-material/Summarize';
import KeyboardArrowRightIcon from '@mui/icons-material/KeyboardArrowRight';
import KeyboardArrowLeftIcon from '@mui/icons-material/KeyboardArrowLeft';
import KeyboardDoubleArrowRightIcon from '@mui/icons-material/KeyboardDoubleArrowRight';
import KeyboardDoubleArrowLeftIcon from '@mui/icons-material/KeyboardDoubleArrowLeft';

import PricingFloorMap from './components/PricingFloorMap';
import TimelineControl, { GAMING_HOURS as PRICING_HOURS } from './components/TimelineControl';
import { liveFloorTables } from './utils/floorConfig';
import { SEGMENT_ORDER, DEFAULT_SEGMENT, sortSubSegments } from '../shared/constants/pitSegments';
import { fetchScheduleHours } from './utils/scheduleSource';
import { fetchPricingPlan, pricingRowsToByHour } from './utils/pricingSource';
import { FLOOR_ASPECT, FLOOR_WIDTH_FR, SUMMARY_WIDTH_FR } from './constants/floorLayout';
import { fetchDailyData, fetchHourlyData, gametypeTableKey } from '../performance/utils/dataSource';
import { aggregateDemandByTable, buildSuggestions, sameWeekdayTrailing } from './utils/pricingSuggest';
import { aggregateHistoryMin, buildHistorySuggestions } from './utils/pricingHistory';
import { deriveShiftsFromOpen } from './utils/pricingCounts';

import TierPalette from './components/TierPalette';
import TierSelectionBar from './components/TierSelectionBar';
import TierLibrary from './components/TierLibrary';
import PricingSummary from './components/PricingSummary';
import PricingHourlyCharts from './components/PricingHourlyCharts';
import DaypartLibrary from './components/DaypartLibrary';
import PricingComparison from './components/PricingComparison';
import {
    loadPricing, saveVersion, restoreVersion, applyPlanToDates, setTiers, setDayparts,
    getDaypartAssignments, setDaypartAssignments,
} from './utils/pricingStorage';
import { formatMinimum } from './constants/defaultTiers';
import { daypartForHour, daypartHours } from './constants/defaultDayparts';
import { readPrice, orderTriple } from './utils/pricingModel';
import { PRICING_FONTS } from './constants/fontSizes';

const TB = PRICING_FONTS.toolbar;
const PF = PRICING_FONTS;

const todayIso = () => new Date().toISOString().slice(0, 10);

// Trigger a browser download of `obj` as a pretty-printed JSON file.
function downloadJson(filename, obj) {
    try {
        const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 0);
    } catch (e) {
        // eslint-disable-next-line no-console
        console.warn('[Pricing] JSON export failed:', e?.message);
    }
}

// Shift an ISO date by N days (UTC-anchored so it never drifts a day).
function addDaysIso(iso, n) {
    const d = new Date(String(iso || '').slice(0, 10) + 'T00:00:00Z');
    if (Number.isNaN(d.getTime())) return iso;
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
// "2026-06-19" → "Jun 19 (Fri)"
function prettyDate(iso) {
    if (!iso || iso.length < 10) return iso || '—';
    const m = parseInt(iso.slice(5, 7), 10);
    const d = parseInt(iso.slice(8, 10), 10);
    if (!m || !d) return iso;
    const dow = DOW[new Date(iso.slice(0, 10) + 'T00:00:00Z').getUTCDay()];
    return `${MONTHS[m - 1]} ${String(d).padStart(2, '0')} (${dow})`;
}

// ── Toolbar building blocks ──────────────────────────────────────────
// Shared, elegant control primitives so every group reads the same.
const TOOLBAR_H = 38;

// Small uppercase eyebrow label. Rendered as a full-height flex box so the
// all-caps text is GEOMETRICALLY centered against its control (caps-only
// text otherwise sits optically high).
function ToolLabel({ children }) {
    return (
        <Box sx={{ height: TOOLBAR_H, display: 'flex', alignItems: 'center', flexShrink: 0 }}>
            <Typography sx={{
                color: 'rgba(220,245,255,0.6)', fontSize: TB.label, fontWeight: 800,
                letterSpacing: 1, textTransform: 'uppercase', whiteSpace: 'nowrap',
                userSelect: 'none', lineHeight: 1,
            }}>
                {children}
            </Typography>
        </Box>
    );
}

// Labelled control group: eyebrow + control, both centered on the row.
function Field({ label, children, sx }) {
    return (
        <Stack direction="row" alignItems="center" spacing={1} sx={{ height: TOOLBAR_H, ...sx }}>
            {label && <ToolLabel>{label}</ToolLabel>}
            {children}
        </Stack>
    );
}

// Ghost action button (Copy to… / Apply to dates…) — consistent height + feel.
function GhostButton({ onClick, icon, children }) {
    return (
        <Button onClick={onClick} startIcon={icon} size="small" sx={{
            height: TOOLBAR_H, textTransform: 'none', fontSize: TB.button, fontWeight: 700,
            color: 'rgba(255,255,255,0.75)', borderRadius: 2, px: 1.4, whiteSpace: 'nowrap',
            bgcolor: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.12)',
            '&:hover': { bgcolor: 'rgba(122,223,255,0.10)', borderColor: 'rgba(122,200,220,0.45)', color: '#dff5ff' },
        }}>
            {children}
        </Button>
    );
}

// Thin vertical divider between toolbar groups.
function ToolDivider() {
    return <Box sx={{ width: '1px', height: 22, bgcolor: 'rgba(255,255,255,0.10)', flexShrink: 0 }} />;
}

// ── Day transfer list (Apply-to-dates) ───────────────────────────────
// Classic two-pane transfer list: Available days on the left, the chosen
// "Apply to" days on the right, with ›/‹ (move checked) and ≫/≪ (move all)
// between them. `selected` is the Set of right-side days; `onChange` swaps
// it. Tick rows in either pane, then move them across.
function DayTransferList({ candidates, selected, onChange, renderLabel }) {
    const [checked, setChecked] = useState(() => new Set());
    const left = useMemo(() => candidates.filter((d) => !selected.has(d)), [candidates, selected]);
    const right = useMemo(() => candidates.filter((d) => selected.has(d)), [candidates, selected]);
    const leftChecked = left.filter((d) => checked.has(d));
    const rightChecked = right.filter((d) => checked.has(d));

    const uncheck = (arr) => setChecked((prev) => { const n = new Set(prev); arr.forEach((d) => n.delete(d)); return n; });
    const toggle = (d) => setChecked((prev) => { const n = new Set(prev); n.has(d) ? n.delete(d) : n.add(d); return n; });
    const moveRight = () => { const n = new Set(selected); leftChecked.forEach((d) => n.add(d)); onChange(n); uncheck(leftChecked); };
    const moveAllRight = () => { const n = new Set(selected); left.forEach((d) => n.add(d)); onChange(n); uncheck(left); };
    const moveLeft = () => { const n = new Set(selected); rightChecked.forEach((d) => n.delete(d)); onChange(n); uncheck(rightChecked); };
    const moveAllLeft = () => { onChange(new Set()); uncheck(right); };

    const Pane = ({ title, items, accent }) => (
        <Box sx={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', border: '1px solid rgba(122,200,220,0.2)', borderRadius: 1.5, overflow: 'hidden', bgcolor: 'rgba(255,255,255,0.02)' }}>
            <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ px: 1.2, py: 0.8, borderBottom: '1px solid rgba(255,255,255,0.1)', bgcolor: 'rgba(255,255,255,0.03)' }}>
                <Typography sx={{ fontSize: PRICING_FONTS.transfer.paneTitle, fontWeight: 800, color: accent, letterSpacing: 0.4, textTransform: 'uppercase' }}>{title}</Typography>
                <Typography sx={{ fontSize: PRICING_FONTS.transfer.paneCount, fontWeight: 700, color: 'rgba(255,255,255,0.5)', fontVariantNumeric: 'tabular-nums' }}>{items.length}</Typography>
            </Stack>
            <Box sx={{ height: 320, overflowY: 'auto', py: 0.4 }}>
                {items.length === 0 ? (
                    <Typography sx={{ color: 'rgba(255,255,255,0.35)', fontSize: PRICING_FONTS.transfer.none, fontStyle: 'italic', textAlign: 'center', mt: 3 }}>None</Typography>
                ) : items.map((d) => {
                    const on = checked.has(d);
                    return (
                        <Stack key={d} direction="row" alignItems="center" spacing={0.5} onClick={() => toggle(d)}
                            sx={{ cursor: 'pointer', px: 0.8, py: 0.2, mx: 0.5, borderRadius: 1, '&:hover': { bgcolor: 'rgba(122,223,255,0.06)' } }}>
                            <Checkbox checked={on} size="small" sx={{ p: 0.4, color: 'rgba(255,255,255,0.3)', '&.Mui-checked': { color: '#7adfff' } }} />
                            <Typography sx={{ fontSize: PRICING_FONTS.transfer.row, fontWeight: on ? 800 : 500, color: on ? '#dff5ff' : 'rgba(255,255,255,0.85)', fontVariantNumeric: 'tabular-nums' }}>
                                {renderLabel ? renderLabel(d) : d}
                            </Typography>
                        </Stack>
                    );
                })}
            </Box>
        </Box>
    );

    const moveBtnSx = (enabled) => ({
        border: '1px solid rgba(122,200,220,0.3)', borderRadius: 1.2, color: enabled ? '#7adfff' : 'rgba(255,255,255,0.2)',
        bgcolor: 'rgba(255,255,255,0.03)', '&:hover': { bgcolor: 'rgba(122,223,255,0.12)' }, '&.Mui-disabled': { color: 'rgba(255,255,255,0.15)' },
    });

    return (
        <Stack direction="row" spacing={1.2} alignItems="center">
            <Pane title="Available days" items={left} accent="rgba(220,245,255,0.7)" />
            <Stack spacing={0.8}>
                <IconButton size="small" onClick={moveAllRight} disabled={left.length === 0} sx={moveBtnSx(left.length > 0)}><KeyboardDoubleArrowRightIcon fontSize="small" /></IconButton>
                <IconButton size="small" onClick={moveRight} disabled={leftChecked.length === 0} sx={moveBtnSx(leftChecked.length > 0)}><KeyboardArrowRightIcon fontSize="small" /></IconButton>
                <IconButton size="small" onClick={moveLeft} disabled={rightChecked.length === 0} sx={moveBtnSx(rightChecked.length > 0)}><KeyboardArrowLeftIcon fontSize="small" /></IconButton>
                <IconButton size="small" onClick={moveAllLeft} disabled={right.length === 0} sx={moveBtnSx(right.length > 0)}><KeyboardDoubleArrowLeftIcon fontSize="small" /></IconButton>
            </Stack>
            <Pane title="Apply to" items={right} accent="#7adfff" />
        </Stack>
    );
}

export default function PricingDashboard() {
    const [store, setStore] = useState(loadPricing);
    const [date, setDate] = useState(() => {
        const dates = Object.keys(loadPricing().plans || {});
        return dates.length > 0 ? dates.sort().slice(-1)[0] : todayIso();
    });

    const [selectedKeys, setSelectedKeys] = useState(new Set());
    const [activeTierId, setActiveTierId] = useState(null);
    // The daypart (hour block) currently being edited. Defaults to the
    // first one; painting + metrics are scoped to it.
    const [activeDaypartId, setActiveDaypartId] = useState(() => loadPricing().dayparts?.[0]?.id || null);
    // Copy-to-hours dialog — pick target hours to clone this hour's pricing.
    const [copyHoursOpen, setCopyHoursOpen] = useState(false);
    const [copyHourSel, setCopyHourSel] = useState(() => new Set());
    // Hour scrubber — scrubbing jumps the active period to the daypart
    // that owns the hour, so the floor previews the price hour-by-hour.
    const [scrubHour, setScrubHour] = useState(() => loadPricing().dayparts?.[0]?.startHour ?? 7);
    const [playing, setPlaying] = useState(false);
    // Hourly-planning only now (the period / comparison modes were folded
    // into the Summary's display options). Kept as a const so the existing
    // unit/open-set resolution still works.
    const appMode = 'hourly';
    const isPlanning = true;
    const [viewMode, setViewMode] = useState('planning'); // 'planning' | 'comparison'
    const [rightView, setRightView] = useState('summary'); // 'summary' | 'palette' | 'library'
    // The hourly charts group by macro segment (MS / PM).
    const groupBy = 'segment';
    // Which value colors the floor map — the opening Base, or the Min /
    // The floor always colors by the opening Base (the Color-by toggle was
    // removed). The Min–Max boundary preference is read once from storage
    // (its toolbar toggle was removed too).
    const showBound = 'base';
    // Boundary (Min–Max) is hidden everywhere for now → pricing is base-only.
    // This collapses the selection-bar boundary panel + presets, the floor
    // tooltip's boundary row, and the Settings boundary editor.
    const flexEnabled = false;
    // Demand reference — per-table stats from recent performance data,
    // lazily fetched the first time a selection is made. `suggestions` is
    // the derived per-table { base, min, max } band (percentile-ranked).
    const [demand, setDemand] = useState(null);          // Map<tableKey, {value, occupancy}> | null
    const [suggestions, setSuggestions] = useState(null); // Map<tableKey, {base,min,max}> | null
    const [demandLoading, setDemandLoading] = useState(false);
    // History suggestion — base on each table's MODE historical minimum,
    // boundary on its historical min/max, over a selectable reference
    // window (date range + day-of-week filter). Defaults to the 28 days
    // before the planning date, all weekdays.
    const [histRange, setHistRange] = useState(() => ({ from: addDaysIso(date, -28), to: addDaysIso(date, -1) }));
    const [histDows, setHistDows] = useState([]);        // [] = all weekdays
    const [histHours, setHistHours] = useState(null);    // number[] (non-consecutive ok) | null = all hours
    const [histLoading, setHistLoading] = useState(false);
    // Scheduling plan (spread DB) — which tables are scheduled OPEN at each
    // hour for the selected date. Keyed off the same `date` as the floor
    // config; the hourly charts use it to count only tables open that hour.
    const [openByHour, setOpenByHour] = useState(null);   // Map<hour, Set<tableKey>> | null
    const [scheduleLoading, setScheduleLoading] = useState(false);

    const tiers = store.tiers || [];
    const dayparts = store.dayparts || [];
    const boundaryPresets = store.boundaryPresets || [];
    const onTiersChange = useCallback((nextTiers) => setStore((prev) => setTiers(prev, nextTiers)), []);
    const onDaypartsChange = useCallback((nextDp) => setStore((prev) => setDayparts(prev, nextDp)), []);
    const tables = useMemo(() => liveFloorTables(date), [date]);
    // Slicer options = the game types actually present in the filtered
    // liveFloorTables result for the selected date.
    const gametypes = useMemo(
        () => [...new Set(tables.map((t) => t.gametype).filter(Boolean))].sort(),
        [tables]
    );
    // Game-type slicer — [] means "all". Filters the floor map + every
    // analytic (Summary, charts, price-mix, metrics) to the chosen types.
    const [gtFilter, setGtFilter] = useState([]);
    // GLOBAL filters (affect scatter + summary + charts): sub-segment(s) and
    // table-minimum tier id(s). [] = all.
    const [subFilter, setSubFilter] = useState([]);
    const [minFilter, setMinFilter] = useState([]);
    const fTables = useMemo(
        () => (gtFilter.length === 0 ? tables : tables.filter((t) => gtFilter.includes(t.gametype))),
        [tables, gtFilter]
    );
    // Table → SUB-SEGMENT lookup (MSC / Main / VIP / Slots / PM) for the
    // Summary tab columns + the sub-segment breakdown in the hourly charts.
    const segByKey = useMemo(() => new Map(fTables.map((t) => [t.key, t.sub_segment || ''])), [fTables]);
    const segments = useMemo(
        () => sortSubSegments(fTables.map((t) => t.sub_segment)),
        [fTables]
    );
    // Table → MACRO SEGMENT lookup ("MS" / "PM", from the pit config) — the
    // primary split for the hourly pricing charts.
    const macroByKey = useMemo(() => new Map(fTables.map((t) => [t.key, t.segment || DEFAULT_SEGMENT])), [fTables]);
    const macroSegments = useMemo(
        () => SEGMENT_ORDER.filter((s) => fTables.some((t) => (t.segment || DEFAULT_SEGMENT) === s)),
        [fTables]
    );
    // The ACTIVE storage unit — each hour is its own bucket ('h_<hour>').
    const activeUnitId = `h_${scrubHour}`;

    // Assignments for the ACTIVE unit (hour or period).
    const assignments = getDaypartAssignments(store, date, activeUnitId);

    // Only SCHEDULED-OPEN tables may receive a price this hour — closed
    // tables never record any pricing (manual, apply, suggest, or history).
    // When no schedule is loaded (open/closed unknown), pricing is allowed.
    const openWriteSet = openByHour ? (openByHour.get(scrubHour) || new Set()) : null;
    const canPriceKey = (k) => !openWriteSet || openWriteSet.has(k);

    // Keep the active daypart valid as the library changes.
    useEffect(() => {
        if (dayparts.length === 0) return;
        if (!dayparts.some((d) => d.id === activeDaypartId)) setActiveDaypartId(dayparts[0].id);
    }, [dayparts, activeDaypartId]);

    // ---- Assignment commands (auto-persist, scoped to active daypart) -
    // Painting arms ONE tier → a fixed price (base = min = max). The
    // adjustable Min/Max boundary is set via the selection bar.
    const assignOne = useCallback((tableKey, tierId) => {
        setStore((prev) => {
            const cur = getDaypartAssignments(prev, date, activeUnitId);
            const next = { ...cur };
            if (!tierId || tierId === '__none') delete next[tableKey];
            else if (canPriceKey(tableKey)) next[tableKey] = { base: tierId, min: tierId, max: tierId };
            else return prev;                       // closed table → no price
            return setDaypartAssignments(prev, date, activeUnitId, next);
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [date, activeUnitId, openWriteSet]);

    // Fixed price for the whole selection (base = min = max). null = clear.
    const assignToSelection = useCallback((tierId) => {
        if (selectedKeys.size === 0) return;
        setStore((prev) => {
            const cur = getDaypartAssignments(prev, date, activeUnitId);
            const next = { ...cur };
            for (const k of selectedKeys) {
                if (!tierId || tierId === '__none') delete next[k];
                else if (canPriceKey(k)) next[k] = { base: tierId, min: tierId, max: tierId };
            }
            return setDaypartAssignments(prev, date, activeUnitId, next);
        });
        setSelectedKeys(new Set());
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [date, activeUnitId, selectedKeys, openWriteSet]);

    // Apply an opening Base + adjustable [Min, Max] boundary to the whole
    // selection. Ids are re-ordered so min ≤ base ≤ max.
    const applyTripleToSelection = useCallback((minId, baseId, maxId, fixed = false) => {
        if (selectedKeys.size === 0 || !baseId) return;
        setStore((prev) => {
            const tm = new Map((prev.tiers || []).map((t) => [t.id, t]));
            // Fixed price OR flex globally off → collapse to base-only.
            const value = (fixed || !flexEnabled)
                ? { base: baseId, min: baseId, max: baseId, ...(fixed ? { fixed: true } : {}) }
                : orderTriple(tm, minId || baseId, baseId, maxId || baseId);
            const cur = getDaypartAssignments(prev, date, activeUnitId);
            const next = { ...cur };
            for (const k of selectedKeys) if (canPriceKey(k)) next[k] = { ...value };
            return setDaypartAssignments(prev, date, activeUnitId, next);
        });
        setSelectedKeys(new Set());
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [date, activeUnitId, selectedKeys, flexEnabled, openWriteSet]);

    // Lazily load + aggregate the demand reference, then derive per-table
    // suggestions. Window = same-weekday × 4 weeks of the planning date;
    // if the data has no rows for those dates (e.g. the planning date is
    // far ahead of the available history), fall back to the most recent 28
    // dates present in the data so the feature still works. Cached.
    const ensureSuggestions = useCallback(async () => {
        if (suggestions) return suggestions;
        setDemandLoading(true);
        try {
            const rows = (await fetchDailyData({})) || [];
            const win = new Set(sameWeekdayTrailing(date, 4));
            let filtered = rows.filter((r) => win.has(r.date));
            if (filtered.length === 0 && rows.length > 0) {
                const recent = new Set([...new Set(rows.map((r) => r.date))].sort().slice(-28));
                filtered = rows.filter((r) => recent.has(r.date));
            }
            const agg = aggregateDemandByTable(filtered);
            const sugg = buildSuggestions(agg, tiers);
            setDemand(agg);
            setSuggestions(sugg);
            return sugg;
        } catch {
            const empty = new Map();
            setDemand(empty);
            setSuggestions(empty);
            return empty;
        } finally {
            setDemandLoading(false);
        }
    }, [suggestions, date, tiers]);

    // Apply the demand-driven { base, min, max } to every selected table
    // that has a suggestion. Tables with no recent play are left as-is.
    const suggestRangeForSelection = useCallback(async () => {
        if (selectedKeys.size === 0) return;
        const sugg = await ensureSuggestions();
        const keys = [...selectedKeys];
        let appliedCount = 0;
        setStore((prev) => {
            const cur = getDaypartAssignments(prev, date, activeUnitId);
            const next = { ...cur };
            for (const k of keys) {
                const triple = sugg.get(k);
                if (triple && canPriceKey(k)) {       // closed tables get no price
                    // Min–Max off → base-only (collapse the boundary).
                    next[k] = flexEnabled ? triple : { base: triple.base, min: triple.base, max: triple.base };
                    appliedCount += 1;
                }
            }
            if (appliedCount === 0) return prev;
            return setDaypartAssignments(prev, date, activeUnitId, next);
        });
        if (appliedCount === 0) {
            window.alert('No recent demand data for the OPEN selected table(s), so no minimum could be suggested. Tables left unchanged.');
        } else {
            setSelectedKeys(new Set());
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [ensureSuggestions, selectedKeys, date, activeUnitId, flexEnabled, openWriteSet]);

    // HISTORY suggestion — base each selected table on its own MODE
    // historical minimum, with the historical min/max as the boundary,
    // over the chosen reference window (date range + day-of-week filter).
    // Not cached: re-runs whenever the window changes so the user can tune
    // the range / DoW and re-apply.
    const suggestFromHistory = useCallback(async () => {
        if (selectedKeys.size === 0) return;
        setHistLoading(true);
        try {
            // Use the HOURLY feed so the reference-hours window can filter by
            // hour (each row carries its hour + tablemin histogram).
            const rows = (await fetchHourlyData({})) || [];
            let agg = aggregateHistoryMin(rows, { from: histRange.from, to: histRange.to, dows: histDows, hours: histHours });
            // If the chosen window has no data at all (e.g. planning far ahead
            // of the available history), fall back to the most recent 28 dates
            // present — DoW + reference-hours filters still apply.
            if (agg.size === 0 && rows.length > 0) {
                const recent = [...new Set(rows.map((r) => String(r.date).slice(0, 10)))].sort().slice(-28);
                if (recent.length) {
                    agg = aggregateHistoryMin(rows, { from: recent[0], to: recent[recent.length - 1], dows: histDows, hours: histHours });
                }
            }
            const sugg = buildHistorySuggestions(agg, tiers);
            const keys = [...selectedKeys];
            let appliedCount = 0;
            setStore((prev) => {
                const cur = getDaypartAssignments(prev, date, activeUnitId);
                const next = { ...cur };
                for (const k of keys) {
                    const triple = sugg.get(k);
                    if (triple && canPriceKey(k)) {   // closed tables get no price
                        // Min–Max off → base-only (collapse the boundary).
                        next[k] = flexEnabled
                            ? { base: triple.base, min: triple.min, max: triple.max }
                            : { base: triple.base, min: triple.base, max: triple.base };
                        appliedCount += 1;
                    }
                }
                if (appliedCount === 0) return prev;
                return setDaypartAssignments(prev, date, activeUnitId, next);
            });
            if (appliedCount === 0) {
                window.alert('No historical table-minimum readings for the selected table(s) in this reference window. Try widening the date range or clearing the day-of-week filter.');
            } else {
                setSelectedKeys(new Set());
            }
        } catch {
            window.alert('Could not load historical data for the suggestion.');
        } finally {
            setHistLoading(false);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedKeys, histRange, histDows, histHours, tiers, date, activeUnitId, flexEnabled, openWriteSet]);

    // Warm the demand reference the first time a selection is made, so the
    // selection bar can show avg-bet / occupancy context before the user
    // even asks for a suggestion. Cached, so it fetches once per session.
    useEffect(() => {
        if (isPlanning && selectedKeys.size > 0 && !suggestions && !demandLoading) {
            ensureSuggestions();
        }
    }, [isPlanning, selectedKeys, suggestions, demandLoading, ensureSuggestions]);

    // Load the scheduling plan (spread DB) for the chosen date → hour →
    // open-table-set map. Drives the floor's open/closed (black) split and
    // the hourly charts. If the spread DB has nothing for this date, fall
    // back to the performance HOURLY data's `spread` flag so the open/closed
    // split still works with the bundled data.
    const buildOpenByHour = (rows, spreadKey = 'spread') => {
        const map = new Map();
        for (const r of rows || []) {
            if (Number(r[spreadKey]) !== 1 || r.hour == null) continue;
            const key = gametypeTableKey(r.gametype, r.table);
            const h = Number(r.hour);
            if (!map.has(h)) map.set(h, new Set());
            map.get(h).add(key);
        }
        return map;
    };
    useEffect(() => {
        if (!date) { setOpenByHour(null); return; }
        let cancelled = false;

        // STRICTLY the SPREAD DATABASE feed for this date — one row per
        // (date, hour, gametype, table, spread); spread=1 = scheduled OPEN
        // that hour. This is the ONLY source for the floor's open/closed
        // split. No performance/actual fallback: if the DB has no rows for
        // the date, there is simply no open/closed distinction.
        setScheduleLoading(true);
        fetchScheduleHours({ date })
            .then((rows) => {
                if (cancelled) return;
                const map = buildOpenByHour(rows);
                setOpenByHour(map.size > 0 ? map : null);
            })
            .catch(() => { if (!cancelled) setOpenByHour(null); })
            .finally(() => { if (!cancelled) setScheduleLoading(false); });
        return () => { cancelled = true; };
    }, [date]);

    // Esc clears the selection (and disarms any armed tier) — mirrors the
    // scheduling dashboard's universal escape route.
    useEffect(() => {
        const onKey = (e) => {
            if (e.key !== 'Escape') return;
            setSelectedKeys((prev) => (prev.size === 0 ? prev : new Set()));
            setActiveTierId(null);
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, []);

    const onSelectionChange = useCallback((nextSet, info = {}) => {
        if (info.clicked && !info.brushed && !info.cleared) {
            setSelectedKeys((prev) => {
                const ns = new Set(prev);
                if (ns.has(info.clicked)) ns.delete(info.clicked); else ns.add(info.clicked);
                return ns;
            });
            return;
        }
        setSelectedKeys(nextSet);
    }, []);

    // ---- Derived metrics ---------------------------------------------
    const tierMap = useMemo(() => new Map(tiers.map((t) => [t.id, t])), [tiers]);
    const sortedTiersDesc = useMemo(() => [...tiers].sort((a, b) => (b.min || 0) - (a.min || 0)), [tiers]);

    // Tables SCHEDULED OPEN for the active unit (from the spread schedule):
    //   • hourly mode — open AT the current scrub hour
    //   • period mode — open at ANY hour the active period covers
    // EMPTY set when no schedule is loaded for the date → every table is
    // treated as closed (the whole floor goes black).
    const openSet = useMemo(() => {
        if (!openByHour) return new Set();      // no DB schedule → nothing open
        if (appMode === 'hourly') return openByHour.get(scrubHour) || new Set();
        const dp = dayparts.find((d) => d.id === activeDaypartId) || null;
        if (!dp) return openByHour.get(scrubHour) || new Set();
        const set = new Set();
        for (const h of daypartHours(dp)) {
            const s = openByHour.get(h);
            if (s) for (const k of s) set.add(k);
        }
        return set;
    }, [openByHour, appMode, scrubHour, dayparts, activeDaypartId]);

    // Each table's SHIFT (scheduled open window) for the date, derived from
    // the spread schedule. Drives the shift filter + the comparison's by-shift.
    const { shiftByKey, shifts } = useMemo(() => deriveShiftsFromOpen(openByHour), [openByHour]);
    // Shift filter — [] = all shifts. When set, only tables whose shift is
    // selected stay colored; every other table is treated as closed (black).
    const [shiftFilter, setShiftFilter] = useState([]);

    // Tables CLOSED for the active unit — rendered black on the floor (not
    // running this hour, so not available for pricing). When no schedule is
    // loaded, openSet is empty → ALL tables are closed (whole floor black).
    // Tables whose shift is filtered out are also treated as closed.
    const closedKeys = useMemo(() => {
        const shiftOk = (k) => shiftFilter.length === 0 || shiftFilter.includes(shiftByKey.get(k));
        const set = new Set();
        for (const t of fTables) if (!openSet.has(t.key) || !shiftOk(t.key)) set.add(t.key);
        return set;
    }, [openSet, fTables, shiftFilter, shiftByKey]);

    // Native visualMap selection (SCATTER-ONLY table-min filter). Opaque
    // ECharts `selected` object, round-tripped. null = all selected. Resets
    // when the calendar date changes; persists across the other dropdowns.
    const [vmSelected, setVmSelected] = useState(null);
    useEffect(() => { setVmSelected(null); }, [date]);

    // DIMMED tables on the floor (grey — NOT black, which means closed). A
    // table is dimmed when it fails the global Sub-segment / Table-min
    // dropdowns. (The scatter's own visualMap filter is handled by ECharts.)
    const dimmedKeys = useMemo(() => {
        const set = new Set();
        if (subFilter.length === 0 && minFilter.length === 0) return set;
        for (const t of fTables) {
            if (closedKeys.has(t.key)) continue;       // closed = black, never dimmed
            const tier = readPrice(assignments[t.key])?.base;
            const subOk = subFilter.length === 0 || subFilter.includes(t.sub_segment);
            const minOk = minFilter.length === 0 || (tier && minFilter.includes(tier));
            if (!subOk || !minOk) set.add(t.key);
        }
        return set;
    }, [fTables, closedKeys, subFilter, minFilter, assignments]);

    // ── Change-highlight: compare this hour's pricing with another hour ──
    // Toggle + comparison-hour dropdown. For tables OPEN in BOTH the current
    // scrub hour and the chosen hour, flag the ones whose minimum differs —
    // 'up' (selected hour higher) → red, 'down' (lower) → green. Unpriced is
    // treated as $0 so priced↔unpriced also counts as a change.
    const [changeHL, setChangeHL] = useState(false);
    const [compareHour, setCompareHour] = useState(null);
    const tierMinMap = useMemo(() => new Map(tiers.map((t) => [t.id, t.min || 0])), [tiers]);
    const changeHighlights = useMemo(() => {
        const out = new Map();
        if (!changeHL || compareHour == null || !openByHour) return out;
        const openCur = openByHour.get(scrubHour) || new Set();
        const openSel = openByHour.get(compareHour) || new Set();
        const aCur = getDaypartAssignments(store, date, `h_${scrubHour}`);
        const aSel = getDaypartAssignments(store, date, `h_${compareHour}`);
        const minOf = (a, k) => { const p = readPrice(a[k]); return p ? (tierMinMap.get(p.base) || 0) : 0; };
        // Honour the shift focus — only compare tables on the selected shift(s).
        const shiftOk = (k) => shiftFilter.length === 0 || shiftFilter.includes(shiftByKey.get(k));
        for (const k of openCur) {
            if (!openSel.has(k)) continue;          // must be open in BOTH hours
            if (!shiftOk(k)) continue;              // and on the focused shift
            const cur = minOf(aCur, k);
            const sel = minOf(aSel, k);
            if (cur !== sel) out.set(k, sel > cur ? 'up' : 'down');
        }
        return out;
    }, [changeHL, compareHour, openByHour, scrubHour, store, date, tierMinMap, shiftFilter, shiftByKey]);

    // Floor-map coloring map: table → tier id of the chosen value. Closed
    // tables are skipped here (the map paints them black via closedKeys).
    const mapAssignments = useMemo(() => {
        const out = {};
        for (const [k, v] of Object.entries(assignments)) {
            if (closedKeys && closedKeys.has(k)) continue; // closed → black
            const p = readPrice(v);
            if (p) out[k] = p[showBound] || p.base;
        }
        return out;
    }, [assignments, showBound, closedKeys]);

    // Raw { base, min, max, fixed } per table — for the floor tooltip.
    const priceByKey = useMemo(() => new Map(Object.entries(assignments)), [assignments]);

    // Fixed-price tables — locked minimum, drawn with a rectangle overlay.
    const fixedKeys = useMemo(() => {
        const set = new Set();
        for (const [k, v] of Object.entries(assignments)) {
            const p = readPrice(v); if (p && p.fixed) set.add(k);
        }
        return set;
    }, [assignments]);

    // Palette counts — by the opening BASE tier (over the sliced floor).
    const counts = useMemo(() => {
        const c = {};
        for (const t of fTables) {
            const p = readPrice(assignments[t.key]); if (p) c[p.base] = (c[p.base] || 0) + 1;
        }
        return c;
    }, [fTables, assignments]);

    const metrics = useMemo(() => {
        let total = 0, flexible = 0, fixed = 0, sumBase = 0, sumMin = 0, sumMax = 0, sumFlex = 0;
        let loFloor = Infinity, hiCeil = -Infinity;
        for (const t of fTables) {
            const v = assignments[t.key];
            const p = readPrice(v); if (!p) continue;
            const tb = tierMap.get(p.base); const tn = tierMap.get(p.min) || tb; const tx = tierMap.get(p.max) || tb;
            if (!tb) continue;
            total += 1; sumBase += tb.min; sumMin += tn.min; sumMax += tx.min;
            if (p.fixed) fixed += 1;
            if (!p.fixed && p.min !== p.max) { flexible += 1; sumFlex += (tx.min - tn.min); }
            loFloor = Math.min(loFloor, tn.min); hiCeil = Math.max(hiCeil, tx.min);
        }
        return {
            total, flexible, fixed,
            avgBase: total > 0 ? sumBase / total : 0,
            avgMin:  total > 0 ? sumMin / total : 0,
            avgMax:  total > 0 ? sumMax / total : 0,
            avgFlex: flexible > 0 ? sumFlex / flexible : 0,
            loFloor: total > 0 ? loFloor : null,
            hiCeil:  total > 0 ? hiCeil : null,
            floorSize: fTables.length,
        };
    }, [fTables, assignments, tierMap]);

    // The daypart that owns the CURRENT scrub hour — shown read-only in the
    // toolbar so you can see which period this hour falls into.
    const curPeriod = daypartForHour(dayparts, scrubHour) || null;

    // Copy this hour's pricing to a set of target hours. Only clones tables
    // that are scheduled OPEN at the SOURCE hour, and only onto tables OPEN
    // at the target hour — so a table closed at the source hour (e.g. 88810
    // closed at 07:00) never touches the target hour, even if it's open
    // there, and a table open at the source but closed at the target is
    // skipped too. Tables not cloned keep their existing target-hour price.
    const doCopyToHours = useCallback((targetHours) => {
        setStore((prev) => {
            const src = getDaypartAssignments(prev, date, `h_${scrubHour}`);
            const srcOpen = openByHour ? (openByHour.get(scrubHour) || new Set()) : null;
            let s = prev;
            for (const h of targetHours) {
                if (h === scrubHour) continue;
                const tgtOpen = openByHour ? (openByHour.get(h) || new Set()) : null;
                const cur = getDaypartAssignments(s, date, `h_${h}`);
                const next = { ...cur };
                for (const [k, v] of Object.entries(src)) {
                    if (srcOpen && !srcOpen.has(k)) continue; // closed at SOURCE hour → never clone
                    if (tgtOpen && !tgtOpen.has(k)) continue; // closed at target hour → skip
                    next[k] = v;
                }
                s = setDaypartAssignments(s, date, `h_${h}`, next);
            }
            return s;
        });
    }, [date, scrubHour, openByHour]);

    // Scrubbing the timeline jumps the active period to the daypart that
    // owns the hour, so the floor previews the price for that hour.
    const onScrubHour = useCallback((h) => {
        setScrubHour(h);
        const dp = daypartForHour(dayparts, h);
        if (dp && dp.id !== activeDaypartId) { setActiveDaypartId(dp.id); setSelectedKeys(new Set()); }
    }, [dayparts, activeDaypartId]);

    // ---- Versions + transfer-to-dates --------------------------------
    const planVersions = useMemo(
        () => (store.plans?.[date]?.versions || []).slice().sort((a, b) => (b.versionNumber || 0) - (a.versionNumber || 0)),
        [store.plans, date]
    );
    const availableDates = useMemo(() => Object.keys(store.plans || {}).sort(), [store.plans]);
    // Latest saved version's plan for the active period — the "last saved"
    // reference shown in the selection popover.
    const historyAssign = useMemo(
        () => planVersions[0]?.byDaypart?.[activeDaypartId]?.assignments || {},
        [planVersions, activeDaypartId]
    );

    const doSaveVersion = useCallback(() => {
        const name = window.prompt('Name this version (optional):', '') ?? '';
        const trimmed = String(name).trim();
        // Save the version in-app AND export it as a self-contained JSON file
        // (date + name + every period's assignments + the tier/period config).
        const versionNumber = (planVersions[0]?.versionNumber || 0) + 1;
        const savedAtIso = new Date().toISOString();
        const payload = {
            kind: 'pricing_plan',
            schema: 2,
            date,                              // the gaming date this plan is for
            revised_date: savedAtIso.slice(0, 10), // the day the plan was revised/saved
            exported_at: savedAtIso,
            name: trimmed,
            version: versionNumber,
            // Tier id → $ minimum, so the restructure script resolves each
            // table's price from the assignment's `base` tier id.
            tiers: tiers.map((t) => ({ id: t.id, min: t.min, label: t.label || null })),
            // The full floor table master for this date — lets the script emit
            // a row for every table × hour (closed/unpriced → open=0).
            tables: tables.map((t) => ({
                key: t.key, gametype: t.gametype, table: t.table,
                segment: t.segment, sub_segment: t.sub_segment,
            })),
            // The live hourly pricing model — each hour 0..23 is its own bucket
            // ('h_<hour>'). CLOSED tables are stripped per hour so the export
            // never carries a price for a table that wasn't scheduled open.
            byHour: Object.fromEntries(
                Array.from({ length: 24 }, (_, h) => {
                    const a = getDaypartAssignments(store, date, `h_${h}`);
                    const open = openByHour ? (openByHour.get(h) || new Set()) : null;
                    const clean = open ? Object.fromEntries(Object.entries(a).filter(([k]) => open.has(k))) : a;
                    return [String(h), JSON.parse(JSON.stringify(clean))];
                })
            ),
        };
        const slug = trimmed ? '_' + trimmed.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').slice(0, 30) : '';
        downloadJson(`pricing_${date}_v${versionNumber}${slug}.json`, payload);
        setStore((prev) => saveVersion(prev, date, name));
    }, [date, store, planVersions, tiers, tables, openByHour]);
    const doRestoreVersion = useCallback((versionId) => {
        if (!versionId) return;
        setStore((prev) => restoreVersion(prev, date, versionId));
        setSelectedKeys(new Set());
    }, [date]);

    // Import a saved pricing JSON (exported by Save version) — restores its
    // hourly plan for the file's date. Accepts schema-2 `byHour` and the
    // legacy `byDaypart` shape; each bucket value is an assignments map.
    const importInputRef = useRef(null);
    const doImportPlan = useCallback((file) => {
        const reader = new FileReader();
        reader.onload = () => {
            try {
                const data = JSON.parse(String(reader.result || '{}'));
                const d = (data.date && String(data.date).slice(0, 10)) || date;
                const buckets = data.byHour
                    ? Object.entries(data.byHour).map(([h, a]) => [`h_${h}`, (a && a.assignments) || a || {}])
                    : (data.byDaypart ? Object.entries(data.byDaypart).map(([id, v]) => [id, (v && v.assignments) || {}]) : []);
                if (buckets.length === 0) { window.alert('No pricing data found in this file.'); return; }
                const cells = buckets.reduce((s, [, a]) => s + Object.keys(a || {}).length, 0);
                if (!window.confirm(`Import pricing for ${d}\n${buckets.length} hour buckets · ${cells} priced cells.\n\nThis replaces that date's current plan.`)) return;
                setStore((prev) => {
                    let s = prev;
                    for (const [unitId, assignments] of buckets) s = setDaypartAssignments(s, d, unitId, assignments || {});
                    return s;
                });
                if (d !== date) { setDate(d); }
                setSelectedKeys(new Set());
            } catch (err) {
                window.alert(`Import failed: ${err?.message || 'invalid JSON'}`);
            }
        };
        reader.onerror = () => window.alert('Import failed: could not read the file');
        reader.readAsText(file);
    }, [date]);

    // Load the DATABASE pricing plan for this date — the "v0" baseline. Fetches
    // via the pricing API (REACT_APP_PRICING_API_URL), snaps each table_minimum
    // to a tier, and REPLACES the date's whole hourly plan (all 24 hours).
    const [dbLoading, setDbLoading] = useState(false);
    const doLoadDbPlan = useCallback(async () => {
        setDbLoading(true);
        try {
            const rows = await fetchPricingPlan({ date });
            const { byHour } = pricingRowsToByHour(rows, date, tiers);
            const cells = Object.values(byHour).reduce((s, b) => s + Object.keys(b.assignments).length, 0);
            if (cells === 0) { window.alert('No pricing plan found in the database for this date.'); return; }
            if (!window.confirm(`Load v0 from the database for ${date}\n${Object.keys(byHour).length} hour buckets · ${cells} priced cells.\n\nThis replaces that date's current plan.`)) return;
            setStore((prev) => {
                let s = prev;
                for (let h = 0; h < 24; h++) {
                    s = setDaypartAssignments(s, date, `h_${h}`, byHour[`h_${h}`]?.assignments || {});
                }
                return s;
            });
            setSelectedKeys(new Set());
        } catch (err) {
            window.alert(`Load from database failed: ${err?.message || 'unknown error'}`);
        } finally {
            setDbLoading(false);
        }
    }, [date, tiers]);

    const [transferOpen, setTransferOpen] = useState(false);
    const [transferDates, setTransferDates] = useState(() => new Set());
    // Candidate target days: the next 90 days after the config date.
    const transferCandidates = useMemo(() => {
        const out = [];
        const base = new Date(date + 'T00:00:00Z');
        if (isNaN(base.getTime())) return out;
        for (let i = 1; i <= 90; i++) {
            out.push(new Date(base.getTime() + i * 86400000).toISOString().slice(0, 10));
        }
        return out;
    }, [date]);
    const doApplyToDates = useCallback(() => {
        if (transferDates.size === 0) return;
        setStore((prev) => applyPlanToDates(prev, date, [...transferDates]));
        setTransferOpen(false);
        setTransferDates(new Set());
    }, [date, transferDates]);

    return (
        <Box sx={{ height: '100%', overflow: 'auto', bgcolor: 'rgba(30,32,48,1)', p: 1.5, boxSizing: 'border-box' }}>
            {/* Header + primary toolbar — one elegant control surface. */}
            <Box sx={{
                mb: 1.4, px: 1.4, py: 1, borderRadius: 2.5,
                bgcolor: 'rgba(255,255,255,0.025)',
                border: '1px solid rgba(122,200,220,0.14)',
                boxShadow: '0 1px 0 rgba(255,255,255,0.04) inset',
            }}>
                <Stack direction="row" spacing={1.4} sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 1.2 }}>
                    {/* Title with accent bar — bar height = font size and the
                        title uses lineHeight 1 so the bar centers on the text
                        caps (no high/low drift). */}
                    <Stack direction="row" spacing={1.2} sx={{ height: TOOLBAR_H, alignItems: 'center' }}>
                        <Box sx={{ width: 4, height: TB.title, bgcolor: '#7adfff', borderRadius: 1, boxShadow: '0 0 10px rgba(122,223,255,0.6)' }} />
                        <Typography sx={{ color: '#dff5ff', fontSize: TB.title, fontWeight: 600, letterSpacing: 0.4, lineHeight: 1, whiteSpace: 'nowrap' }}>
                            Table Pricing
                        </Typography>
                    </Stack>

                    <ToolDivider />

                    {/* View mode — Planning (price the floor) vs Comparison
                        (two plans side by side). */}
                    <Box sx={{ display: 'flex', alignItems: 'center', height: TOOLBAR_H, p: '3px', gap: '2px', borderRadius: 2, bgcolor: 'rgba(255,255,255,0.045)', border: '1px solid rgba(122,200,220,0.18)' }}>
                        {[{ v: 'planning', label: 'Planning' }, { v: 'comparison', label: 'Comparison' }].map((o) => {
                            const active = viewMode === o.v;
                            return (
                                <Box key={o.v} onClick={() => setViewMode(o.v)} sx={{
                                    px: 1.6, height: '100%', display: 'flex', alignItems: 'center', borderRadius: 1.4, cursor: 'pointer',
                                    fontSize: TB.control, fontWeight: 700, whiteSpace: 'nowrap',
                                    bgcolor: active ? '#7adfff' : 'transparent', color: active ? '#06182a' : 'rgba(255,255,255,0.6)',
                                    '&:hover': active ? undefined : { bgcolor: 'rgba(122,223,255,0.10)', color: '#dff5ff' },
                                }}>
                                    {o.label}
                                </Box>
                            );
                        })}
                    </Box>

                    {/* Planning toolbar — the DATE picker now lives on the
                        scatter map's top-right corner (not here). */}
                    {viewMode === 'planning' && (<>

                    <Tooltip title="Copy this hour's pricing to selected hours (open tables only)">
                        <span><GhostButton onClick={() => setCopyHoursOpen(true)} icon={<ContentCopyIcon sx={{ fontSize: 16 }} />}>Copy to…</GhostButton></span>
                    </Tooltip>
                    <Tooltip title="Apply this date's whole plan to other days">
                        <span><GhostButton onClick={() => setTransferOpen(true)} icon={<CalendarMonthIcon sx={{ fontSize: 16 }} />}>Apply to dates…</GhostButton></span>
                    </Tooltip>

                    <ToolDivider />

                    {/* Game-type slicer — filters the floor + analytics. */}
                            <Field label="Game">
                                <Select
                                    multiple displayEmpty size="small"
                                    value={gtFilter} onChange={(e) => setGtFilter(e.target.value)}
                                    renderValue={(sel) => (sel.length === 0 ? 'All games' : sel.join(', '))}
                                    MenuProps={{ PaperProps: { sx: { bgcolor: 'rgba(18,22,34,0.98)', color: '#fff', border: '1px solid rgba(122,200,220,0.25)' } } }}
                                    sx={{
                                        height: TOOLBAR_H, minWidth: 130, fontSize: TB.slicer, fontWeight: 700, color: '#fff',
                                        borderRadius: 2, bgcolor: 'rgba(255,255,255,0.045)',
                                        '& .MuiOutlinedInput-notchedOutline': { borderColor: 'rgba(122,200,220,0.22)' },
                                        '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: 'rgba(122,200,220,0.45)' },
                                        '& .MuiSelect-icon': { color: 'rgba(255,255,255,0.45)' },
                                    }}
                                >
                                    {gametypes.map((g) => (
                                        <MenuItem key={g} value={g} sx={{ fontSize: TB.menuItem, py: 0.2 }}>
                                            <Checkbox checked={gtFilter.includes(g)} size="small" sx={{ p: 0.5, color: 'rgba(255,255,255,0.35)', '&.Mui-checked': { color: '#7adfff' } }} />
                                            {g}
                                        </MenuItem>
                                    ))}
                                </Select>
                            </Field>

                    {/* Sub-segment filter — dims non-matching tables on the floor
                        and excludes them from the Summary + charts. */}
                    <Field label="Sub-seg">
                        <Select
                            multiple displayEmpty size="small"
                            value={subFilter} onChange={(e) => setSubFilter(e.target.value)}
                            renderValue={(sel) => (sel.length === 0 ? 'All sub-seg' : sel.join(', '))}
                            MenuProps={{ PaperProps: { sx: { bgcolor: 'rgba(18,22,34,0.98)', color: '#fff', border: '1px solid rgba(122,200,220,0.25)' } } }}
                            sx={{
                                height: TOOLBAR_H, minWidth: 140, maxWidth: 240, fontSize: TB.slicer, fontWeight: 700, color: '#fff',
                                borderRadius: 2, bgcolor: 'rgba(255,255,255,0.045)',
                                '& .MuiOutlinedInput-notchedOutline': { borderColor: 'rgba(122,200,220,0.22)' },
                                '& .MuiSelect-icon': { color: 'rgba(255,255,255,0.45)' },
                            }}
                        >
                            {segments.map((s) => (
                                <MenuItem key={s} value={s} sx={{ fontSize: TB.menuItem, py: 0.2 }}>
                                    <Checkbox checked={subFilter.includes(s)} size="small" sx={{ p: 0.5, color: 'rgba(255,255,255,0.35)', '&.Mui-checked': { color: '#7adfff' } }} />{s}
                                </MenuItem>
                            ))}
                        </Select>
                    </Field>

                    {/* Table-minimum filter — by tier. Dims non-matching tables on
                        the floor and hides their rows in the Summary + charts. */}
                    <Field label="Table min">
                        <Select
                            multiple displayEmpty size="small"
                            value={minFilter}
                            onChange={(e) => {
                                const v = e.target.value;
                                if (v.includes('__all__')) setMinFilter(sortedTiersDesc.map((t) => t.id));
                                else if (v.includes('__clear__')) setMinFilter([]);
                                else setMinFilter(v);
                            }}
                            renderValue={(sel) => (sel.length === 0 ? 'All minimums' : sel.map((id) => tierMap.get(id)?.label || formatMinimum(tierMap.get(id)?.min)).join(', '))}
                            MenuProps={{ PaperProps: { sx: { maxHeight: 360, bgcolor: 'rgba(18,22,34,0.98)', color: '#fff', border: '1px solid rgba(122,200,220,0.25)' } } }}
                            sx={{
                                height: TOOLBAR_H, minWidth: 150, maxWidth: 260, fontSize: TB.slicer, fontWeight: 700, color: '#fff',
                                borderRadius: 2, bgcolor: 'rgba(255,255,255,0.045)',
                                '& .MuiOutlinedInput-notchedOutline': { borderColor: 'rgba(122,200,220,0.22)' },
                                '& .MuiSelect-icon': { color: 'rgba(255,255,255,0.45)' },
                            }}
                        >
                            <MenuItem value="__all__" sx={{ fontSize: TB.menuItem, py: 0.3, color: '#7adfff', fontWeight: 700, borderBottom: '1px solid rgba(255,255,255,0.08)' }}>Select all</MenuItem>
                            <MenuItem value="__clear__" sx={{ fontSize: TB.menuItem, py: 0.3, color: '#f7768e', fontWeight: 700, borderBottom: '1px solid rgba(255,255,255,0.12)' }}>Clear all</MenuItem>
                            {sortedTiersDesc.map((t) => (
                                <MenuItem key={t.id} value={t.id} sx={{ fontSize: TB.menuItem, py: 0.2 }}>
                                    <Checkbox checked={minFilter.includes(t.id)} size="small" sx={{ p: 0.5, color: 'rgba(255,255,255,0.35)', '&.Mui-checked': { color: '#7adfff' } }} />
                                    <Box sx={{ width: 11, height: 11, borderRadius: '2px', bgcolor: t.color, mr: 0.8, flexShrink: 0 }} />
                                    {t.label || formatMinimum(t.min)}
                                </MenuItem>
                            ))}
                        </Select>
                    </Field>

                    {/* Shift filter — only color tables on the selected shift(s);
                        every other table is treated as closed (black). */}
                    {shifts.length > 0 && (
                        <Field label="Shift">
                            <Select
                                multiple displayEmpty size="small"
                                value={shiftFilter} onChange={(e) => setShiftFilter(e.target.value)}
                                renderValue={(sel) => (sel.length === 0 ? 'All shifts' : sel.join(', '))}
                                MenuProps={{ PaperProps: { sx: { bgcolor: 'rgba(18,22,34,0.98)', color: '#fff', border: '1px solid rgba(122,200,220,0.25)' } } }}
                                sx={{
                                    height: TOOLBAR_H, minWidth: 140, maxWidth: 260, fontSize: TB.slicer, fontWeight: 700, color: '#fff',
                                    borderRadius: 2, bgcolor: 'rgba(255,255,255,0.045)',
                                    '& .MuiOutlinedInput-notchedOutline': { borderColor: 'rgba(122,200,220,0.22)' },
                                    '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: 'rgba(122,200,220,0.45)' },
                                    '& .MuiSelect-icon': { color: 'rgba(255,255,255,0.45)' },
                                }}
                            >
                                {shifts.map((s) => (
                                    <MenuItem key={s} value={s} sx={{ fontSize: TB.menuItem, py: 0.2 }}>
                                        <Checkbox checked={shiftFilter.includes(s)} size="small" sx={{ p: 0.5, color: 'rgba(255,255,255,0.35)', '&.Mui-checked': { color: '#7adfff' } }} />
                                        {s}
                                    </MenuItem>
                                ))}
                            </Select>
                        </Field>
                    )}

                    {/* Change highlight — flag tables whose price differs vs another
                        hour (open in both). Red = higher at that hour, green = lower. */}
                    <Field label="Highlight Δ">
                        <Stack direction="row" alignItems="center" spacing={0.8} sx={{ height: TOOLBAR_H }}>
                            <Box onClick={() => setChangeHL((v) => !v)}
                                sx={{
                                    height: TOOLBAR_H, display: 'flex', alignItems: 'center', px: 1.4, borderRadius: 2, cursor: 'pointer', userSelect: 'none',
                                    fontSize: TB.control, fontWeight: 800, whiteSpace: 'nowrap',
                                    color: changeHL ? '#06182a' : 'rgba(255,255,255,0.65)',
                                    bgcolor: changeHL ? '#7adfff' : 'rgba(255,255,255,0.045)',
                                    border: `1px solid ${changeHL ? '#7adfff' : 'rgba(122,200,220,0.22)'}`,
                                    '&:hover': { borderColor: 'rgba(122,200,220,0.45)' },
                                }}>
                                {changeHL ? 'On' : 'Off'}
                            </Box>
                            {changeHL && (
                                <Select
                                    displayEmpty size="small"
                                    value={compareHour == null ? '' : compareHour}
                                    onChange={(e) => setCompareHour(e.target.value === '' ? null : Number(e.target.value))}
                                    renderValue={(v) => (v === '' || v == null ? 'vs hour…' : `vs ${String(v).padStart(2, '0')}:00`)}
                                    MenuProps={{ PaperProps: { sx: { maxHeight: 320, bgcolor: 'rgba(18,22,34,0.98)', color: '#fff', border: '1px solid rgba(122,200,220,0.25)' } } }}
                                    sx={{
                                        height: TOOLBAR_H, minWidth: 120, fontSize: TB.slicer, fontWeight: 700, color: '#fff',
                                        borderRadius: 2, bgcolor: 'rgba(255,255,255,0.045)',
                                        '& .MuiOutlinedInput-notchedOutline': { borderColor: 'rgba(122,200,220,0.22)' },
                                        '& .MuiSelect-icon': { color: 'rgba(255,255,255,0.45)' },
                                    }}
                                >
                                    {PRICING_HOURS.filter((h) => h !== scrubHour).map((h) => (
                                        <MenuItem key={h} value={h} sx={{ fontSize: TB.menuItem, py: 0.2 }}>{String(h).padStart(2, '0')}:00</MenuItem>
                                    ))}
                                </Select>
                            )}
                            {changeHL && compareHour != null && (
                                <Typography sx={{ fontSize: TB.sub + 1, fontWeight: 800, color: changeHighlights.size ? '#ff7a7a' : 'rgba(255,255,255,0.45)', whiteSpace: 'nowrap' }}>
                                    {changeHighlights.size} changed
                                </Typography>
                            )}
                        </Stack>
                    </Field>
                    </>)}

                    <Box sx={{ flex: 1 }} />

                    {/* Version controls — load a saved version + save (named). */}
                    {viewMode === 'planning' && (
                        <Stack direction="row" spacing={1} sx={{ height: TOOLBAR_H, alignItems: 'center' }}>
                            {/* Load plan — v0 (live from the pricing DATABASE) +
                                any saved versions (v1+). Acts as a menu: picking
                                an item loads it over the current date's plan. */}
                            <Select
                                value="" displayEmpty size="small"
                                onChange={(e) => { const v = e.target.value; if (v === '__v0_db__') doLoadDbPlan(); else if (v) doRestoreVersion(v); }}
                                renderValue={() => (
                                    <Stack direction="row" alignItems="center" spacing={0.6}>
                                        {dbLoading
                                            ? <CircularProgress size={14} thickness={5} sx={{ color: 'rgba(255,255,255,0.6)' }} />
                                            : <HistoryIcon sx={{ fontSize: 16, color: 'rgba(255,255,255,0.55)' }} />}
                                        <span>Load plan</span>
                                    </Stack>
                                )}
                                MenuProps={{ PaperProps: { sx: { bgcolor: 'rgba(18,22,34,0.98)', color: '#fff', border: '1px solid rgba(122,200,220,0.25)' } } }}
                                sx={{
                                    height: TOOLBAR_H, minWidth: 150, fontSize: TB.version, fontWeight: 700, color: '#fff',
                                    borderRadius: 2, bgcolor: 'rgba(255,255,255,0.045)',
                                    '& .MuiOutlinedInput-notchedOutline': { borderColor: 'rgba(122,200,220,0.22)' },
                                    '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: 'rgba(122,200,220,0.45)' },
                                    '& .MuiSelect-icon': { color: 'rgba(255,255,255,0.45)' },
                                }}
                            >
                                <MenuItem value="__v0_db__" sx={{ fontSize: TB.version, fontWeight: 700 }}>
                                    <CloudDownloadIcon sx={{ fontSize: 16, mr: 0.8, color: '#7adfff' }} />
                                    v0 · Database
                                </MenuItem>
                                {planVersions.map((v) => (
                                    <MenuItem key={v.versionId} value={v.versionId} sx={{ fontSize: TB.version }}>
                                        v{v.versionNumber}{v.name ? ` · ${v.name}` : ''}
                                        <span style={{ opacity: 0.5, marginLeft: 8 }}>{prettyDate((v.savedAt || '').slice(0, 10))}</span>
                                    </MenuItem>
                                ))}
                            </Select>
                            <input ref={importInputRef} type="file" accept=".json,application/json" style={{ display: 'none' }}
                                onChange={(e) => { const f = e.target.files?.[0]; if (f) doImportPlan(f); e.target.value = ''; }} />
                            <Tooltip title="Import a saved pricing JSON (restores its hourly plan)">
                                <Button
                                    onClick={() => importInputRef.current?.click()}
                                    startIcon={<FileUploadIcon sx={{ fontSize: 18 }} />}
                                    size="small"
                                    sx={{
                                        height: TOOLBAR_H, textTransform: 'none', fontSize: TB.save, fontWeight: 700,
                                        color: '#dff5ff', bgcolor: 'rgba(255,255,255,0.05)', borderRadius: 2, px: 1.6,
                                        border: '1px solid rgba(122,200,220,0.3)',
                                        '&:hover': { bgcolor: 'rgba(122,223,255,0.12)', borderColor: 'rgba(122,223,255,0.5)' },
                                    }}
                                >
                                    Import
                                </Button>
                            </Tooltip>
                            <Button
                                onClick={doSaveVersion}
                                startIcon={<SaveIcon sx={{ fontSize: 18 }} />}
                                size="small"
                                sx={{
                                    height: TOOLBAR_H, textTransform: 'none', fontSize: TB.save, fontWeight: 800,
                                    color: '#06182a', bgcolor: '#7adfff', borderRadius: 2, px: 1.8,
                                    boxShadow: '0 2px 10px rgba(122,223,255,0.3)',
                                    '&:hover': { bgcolor: '#a0e8ff' },
                                }}
                            >
                                Save version
                            </Button>
                        </Stack>
                    )}
                </Stack>
            </Box>

            {/* Copy-to-hours dialog — pick target hours; only OPEN tables at
                each target hour receive this hour's pricing. */}
            <Dialog open={copyHoursOpen} onClose={() => setCopyHoursOpen(false)}
                PaperProps={{ sx: { bgcolor: 'rgba(18,22,34,0.98)', color: '#fff', border: '1px solid rgba(122,200,220,0.25)', minWidth: 440 } }}>
                <DialogTitle sx={{ pb: 0.5 }}>
                    <Stack direction="row" alignItems="center" spacing={1}>
                        <ContentCopyIcon sx={{ fontSize: 20, color: '#7adfff' }} />
                        <Typography sx={{ fontSize: 17, fontWeight: 800 }}>Copy {String(scrubHour).padStart(2, '0')}:00 pricing to hours</Typography>
                    </Stack>
                    <Typography sx={{ fontSize: 13, color: 'rgba(255,255,255,0.55)', mt: 0.5 }}>
                        Only tables <b style={{ color: '#dff5ff' }}>scheduled open</b> at each target hour receive this hour's minimum.
                    </Typography>
                </DialogTitle>
                <DialogContent>
                    <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 0.8, mt: 0.5 }}>
                        {PRICING_HOURS.filter((h) => h !== scrubHour).map((h) => {
                            const on = copyHourSel.has(h);
                            const nOpen = openByHour ? (openByHour.get(h)?.size || 0) : null;
                            return (
                                <Box key={h} onClick={() => setCopyHourSel((prev) => { const s = new Set(prev); s.has(h) ? s.delete(h) : s.add(h); return s; })}
                                    sx={{
                                        cursor: 'pointer', px: 1, py: 0.8, borderRadius: 1.4, textAlign: 'center',
                                        border: `1px solid ${on ? '#7adfff' : 'rgba(255,255,255,0.12)'}`,
                                        bgcolor: on ? 'rgba(122,223,255,0.15)' : 'rgba(255,255,255,0.03)',
                                        '&:hover': on ? undefined : { bgcolor: 'rgba(122,223,255,0.07)' },
                                    }}>
                                    <Typography sx={{ fontSize: 14, fontWeight: on ? 800 : 600, color: on ? '#dff5ff' : 'rgba(255,255,255,0.85)', fontVariantNumeric: 'tabular-nums' }}>
                                        {String(h).padStart(2, '0')}:00
                                    </Typography>
                                    {nOpen != null && (
                                        <Typography sx={{ fontSize: 11, color: 'rgba(255,255,255,0.45)' }}>{nOpen} open</Typography>
                                    )}
                                </Box>
                            );
                        })}
                    </Box>
                </DialogContent>
                <DialogActions sx={{ px: 3, pb: 2 }}>
                    <Button onClick={() => setCopyHourSel(new Set(PRICING_HOURS.filter((h) => h !== scrubHour)))} sx={{ textTransform: 'none', color: '#7adfff', fontWeight: 700 }}>Select all</Button>
                    <Button onClick={() => setCopyHourSel(new Set())} sx={{ textTransform: 'none', color: 'rgba(255,255,255,0.6)', fontWeight: 700 }}>Clear</Button>
                    <Box sx={{ flex: 1 }} />
                    <Button onClick={() => setCopyHoursOpen(false)} sx={{ textTransform: 'none', color: 'rgba(255,255,255,0.7)', fontWeight: 700 }}>Cancel</Button>
                    <Button onClick={() => { doCopyToHours([...copyHourSel]); setCopyHoursOpen(false); setCopyHourSel(new Set()); }} disabled={copyHourSel.size === 0}
                        sx={{ textTransform: 'none', fontWeight: 800, color: '#0a1a2c', bgcolor: '#7adfff', px: 2, '&:hover': { bgcolor: '#a0e8ff' }, '&.Mui-disabled': { bgcolor: 'rgba(255,255,255,0.12)', color: 'rgba(255,255,255,0.4)' } }}>
                        Copy to {copyHourSel.size}
                    </Button>
                </DialogActions>
            </Dialog>

            {/* Transfer-to-dates dialog — copy this date's whole plan (all
                periods) onto other days. Dates show the weekday as
                'mmm dd (ddd)' for quick reference. */}
            <Dialog open={transferOpen} onClose={() => setTransferOpen(false)}
                PaperProps={{ sx: { bgcolor: 'rgba(18,22,34,0.98)', color: '#fff', border: '1px solid rgba(122,200,220,0.25)', minWidth: 560 } }}>
                <DialogTitle sx={{ pb: 0.5 }}>
                    <Stack direction="row" alignItems="center" spacing={1}>
                        <CalendarMonthIcon sx={{ fontSize: 20, color: '#7adfff' }} />
                        <Typography sx={{ fontSize: PF.transfer.title, fontWeight: 800 }}>Apply plan to other dates</Typography>
                    </Stack>
                    <Typography sx={{ fontSize: PF.transfer.subtitle, color: 'rgba(255,255,255,0.55)', mt: 0.5 }}>
                        Copies <b style={{ color: '#dff5ff' }}>{prettyDate(date)}</b>'s full plan (every period) onto the days in the <b style={{ color: '#7adfff' }}>Apply&nbsp;to</b> list.
                    </Typography>
                </DialogTitle>
                <DialogContent>
                    <DayTransferList
                        candidates={transferCandidates}
                        selected={transferDates}
                        onChange={setTransferDates}
                        renderLabel={prettyDate}
                    />
                </DialogContent>
                <DialogActions sx={{ px: 3, pb: 2 }}>
                    <Button onClick={() => setTransferDates(new Set())} sx={{ textTransform: 'none', color: 'rgba(255,255,255,0.6)', fontWeight: 700 }}>Clear</Button>
                    <Box sx={{ flex: 1 }} />
                    <Button onClick={() => setTransferOpen(false)} sx={{ textTransform: 'none', color: 'rgba(255,255,255,0.7)', fontWeight: 700 }}>Cancel</Button>
                    <Button onClick={doApplyToDates} disabled={transferDates.size === 0}
                        sx={{ textTransform: 'none', fontWeight: 800, color: '#0a1a2c', bgcolor: '#7adfff', px: 2, '&:hover': { bgcolor: '#a0e8ff' }, '&.Mui-disabled': { bgcolor: 'rgba(255,255,255,0.12)', color: 'rgba(255,255,255,0.4)' } }}>
                        Apply to {transferDates.size}
                    </Button>
                </DialogActions>
            </Dialog>

            {/* Comparison mode — two plans side by side + a comparison table. */}
            {viewMode === 'comparison' && (
                <PricingComparison
                    store={store}
                    setStore={setStore}
                    tiers={tiers}
                    dayparts={dayparts}
                    dates={availableDates}
                    defaultDate={date}
                />
            )}

            {/* Main grid — floor map + right column. Scatter ~82% width; the
                rest goes to the right column. */}
            {viewMode === 'planning' && (
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: `${FLOOR_WIDTH_FR}fr ${SUMMARY_WIDTH_FR}fr` }, gap: 1.5, mb: 1.5 }}>
                {/* Left column: timeline strip (above) + scatter map. The
                    timeline lives in the same column so its width strictly
                    matches the scatter map below it. */}
                <Box>
                    <Box sx={{ mb: 1 }}>
                        <TimelineControl
                            currentHour={scrubHour}
                            onCurrentHour={onScrubHour}
                            playing={playing}
                            onPlaying={setPlaying}
                        />
                    </Box>
                    <Box sx={{
                        bgcolor: 'rgba(22, 24, 38, 0.9)', borderRadius: 2,
                        border: '1px solid rgba(255,255,255,0.06)', overflow: 'hidden',
                        width: '100%', aspectRatio: FLOOR_ASPECT, position: 'relative',
                    }}>
                    <PricingFloorMap
                        tables={fTables}
                        assignments={mapAssignments}
                        tiers={tiers}
                        priceByKey={priceByKey}
                        closedKeys={closedKeys}
                        fixedKeys={fixedKeys}
                        selectedKeys={selectedKeys}
                        activeBrushShiftId={activeTierId}
                        onSelectionChange={onSelectionChange}
                        onAssign={assignOne}
                        flexEnabled={flexEnabled}
                        changeHighlights={changeHighlights}
                        dimmedKeys={dimmedKeys}
                        vmSelected={vmSelected}
                        onVmSelected={setVmSelected}
                        date={date}
                        onDateChange={(d) => { setDate(d); setSelectedKeys(new Set()); }}
                        scheduleLoaded={!!openByHour}
                        scheduleLoading={scheduleLoading}
                        mode="planning"
                    />
                    {/* Floating tier picker — pops up on a floor selection
                        (rectangle / polygon / click). Set a fixed minimum or a
                        Base→Ceiling range; either prices the selection and
                        dismisses (clearing the box). */}
                    <TierSelectionBar
                        selectedKeys={selectedKeys}
                        assignments={assignments}
                        tiers={tiers}
                        onApplyTriple={applyTripleToSelection}
                        onClearTier={() => assignToSelection(null)}
                        onClear={() => setSelectedKeys(new Set())}
                        onSuggestRange={suggestRangeForSelection}
                        suggestLoading={demandLoading}
                        demand={demand}
                        suggestions={suggestions}
                        history={historyAssign}
                        onSuggestHistory={suggestFromHistory}
                        histRange={histRange}
                        onHistRangeChange={setHistRange}
                        histDows={histDows}
                        onHistDowsChange={setHistDows}
                        histHours={histHours}
                        onHistHoursChange={setHistHours}
                        histLoading={histLoading}
                        flexEnabled={flexEnabled}
                        boundaryPresets={boundaryPresets}
                    />
                    </Box>{/* scatter box */}
                </Box>{/* left column */}

                {/* Right column — height matches the scatter; content scrolls
                    internally so no tab (esp. Settings) ever overflows it. */}
                <Box sx={{ position: { xs: 'static', lg: 'relative' }, minHeight: 0 }}>
                  <Box sx={{
                      position: { xs: 'static', lg: 'absolute' }, inset: { lg: 0 },
                      display: 'flex', flexDirection: 'column', gap: 1.2,
                  }}>
                    {/* Right-column tabs — full-width, equal segments. */}
                    <Stack direction="row" sx={{ flexShrink: 0, border: '1px solid rgba(122,200,220,0.25)', borderRadius: 1.2, overflow: 'hidden' }}>
                        {[
                            { v: 'palette', label: 'Minimums', icon: <GridViewIcon sx={{ fontSize: 19 }} /> },
                            { v: 'summary', label: 'Summary', icon: <SummarizeIcon sx={{ fontSize: 19 }} /> },
                            { v: 'library', label: 'Settings', icon: <SettingsIcon sx={{ fontSize: 19 }} /> },
                        ].map((opt) => (
                            <Box key={opt.v} onClick={() => setRightView(opt.v)}
                                sx={{
                                    flex: 1, minWidth: 0, gap: 0.6, py: 1, cursor: 'pointer', fontSize: PF.tabs.label, fontWeight: 700, lineHeight: 1,
                                    display: 'flex', alignItems: 'center', justifyContent: 'center', whiteSpace: 'nowrap',
                                    borderRight: '1px solid rgba(122,200,220,0.18)', '&:last-of-type': { borderRight: 'none' },
                                    bgcolor: rightView === opt.v ? '#7adfff' : 'transparent',
                                    color: rightView === opt.v ? '#0a1a2c' : 'rgba(255,255,255,0.6)',
                                    '&:hover': rightView !== opt.v ? { bgcolor: 'rgba(122,223,255,0.08)' } : undefined,
                                }}>
                                {opt.icon}{opt.label}
                            </Box>
                        ))}
                    </Stack>

                    {/* Scrollable content region — bounded by the scatter height.
                        Scrollbar hidden (still scrolls). */}
                    <Stack spacing={1.2} sx={{
                        flex: { lg: 1 }, minHeight: 0, overflowY: { lg: 'auto' }, pr: { lg: 0.5 },
                        scrollbarWidth: 'none', msOverflowStyle: 'none',
                        '&::-webkit-scrollbar': { display: 'none' },
                    }}>

                    {rightView === 'summary' && (
                        <PricingSummary
                            tiers={tiers}
                            store={store} date={date}
                            openByHour={openByHour} scrubHour={scrubHour}
                            periodHours={curPeriod ? daypartHours(curPeriod) : null}
                            macroByKey={macroByKey} macroSegments={macroSegments}
                            subByKey={segByKey} subSegments={segments}
                            shiftByKey={shiftByKey} shifts={shifts}
                            subFilter={subFilter} minFilter={minFilter}
                        />
                    )}

                    {rightView === 'library' && (
                        <>
                            <DaypartLibrary dayparts={dayparts} onChange={onDaypartsChange} />
                            <TierLibrary tiers={tiers} onChange={onTiersChange} />
                        </>
                    )}

                    {rightView === 'palette' && (<>
                    <TierPalette
                        tiers={tiers}
                        activeTierId={activeTierId}
                        onPick={setActiveTierId}
                        assignmentCounts={counts}
                        selectedTableCount={selectedKeys.size}
                        onAssignToSelected={assignToSelection}
                    />

                    {/* Price-mix distribution */}
                    <Box sx={{
                        p: 1.5, borderRadius: 2, bgcolor: 'rgba(8, 22, 36, 0.55)',
                        border: '1px solid rgba(122, 200, 220, 0.12)',
                    }}>
                        <Typography sx={{ color: '#dff5ff', fontSize: PF.priceMix.title, fontWeight: 800, mb: 1.2 }}>
                            Price Mix
                        </Typography>
                        <Stack spacing={1}>
                            {tiers.map((t) => {
                                const c = counts[t.id] || 0;
                                const pct = metrics.total > 0 ? (c / metrics.total) * 100 : 0;
                                return (
                                    <Stack key={t.id} direction="row" alignItems="center" spacing={1}>
                                        <Typography sx={{ color: '#fff', fontSize: PF.priceMix.rowLabel, fontWeight: 700, width: 72 }}>
                                            {t.label || formatMinimum(t.min)}
                                        </Typography>
                                        <Box sx={{ flex: 1, height: 12, borderRadius: 1, bgcolor: 'rgba(255,255,255,0.06)', overflow: 'hidden' }}>
                                            <Box sx={{ width: `${pct}%`, height: '100%', bgcolor: t.color }} />
                                        </Box>
                                        <Typography sx={{ color: 'rgba(255,255,255,0.75)', fontSize: PF.priceMix.count, width: 34, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                                            {c}
                                        </Typography>
                                    </Stack>
                                );
                            })}
                        </Stack>
                    </Box>
                    </>)}

                    </Stack>{/* scroll region */}
                  </Box>{/* fill */}
                </Box>{/* right cell */}
            </Box>
            )}

            {/* Hourly minimum-mix charts by segment (below the floor map). */}
            {viewMode === 'planning' && (
                <PricingHourlyCharts
                    store={store}
                    date={date}
                    dayparts={dayparts}
                    hourlyMode={appMode === 'hourly'}
                    tiers={tiers}
                    macroByKey={macroByKey}
                    macroSegments={macroSegments}
                    subByKey={segByKey}
                    subSegments={segments}
                    groupBy={groupBy}
                    openByHour={openByHour}
                    scheduleDate={date}
                    subFilter={subFilter} minFilter={minFilter}
                />
            )}
        </Box>
    );
}
