// Hotel Segment Heatmap dashboard.
// ================================
// Small-multiples: ONE control panel drives SIX scatter heatmaps at once,
// each showing the same patron-focused KPI for a different hotel-stayer
// segment (W/Epic/Star/Celebrity Hotel · Non-hotel · Overall). Extra
// slicers (region / card tier / age) live in a right-side drawer so the
// primary toolbar stays scannable.
//
// FULLY SELF-CONTAINED: every import below resolves inside src/hotel
// (vendored components under ./components + ./vendor, own data under
// ./data, and a single hotelConfig.js tuning file). Nothing here depends
// on the Performance / Pricing / Live / Realtime dashboards, so this
// dashboard's KPIs, panels, and layout can change freely without side
// effects elsewhere — and vice versa.
//
// Aggregation: the raw feed is patron-grain (date × table × player_id),
// so buildHotelScatterData (hotelData.js) does its own dedup-aware fold
// up to table/pit/zone — see that file's header comment for why
// floorday/openhours can't just be summed directly.

import React, { useEffect, useMemo, useState, useCallback } from 'react';
import {
    Box, Paper, Stack, Typography, Button, Drawer, IconButton, Divider,
    CircularProgress, Chip, Tooltip, TextField,
} from '@mui/material';
import TuneIcon from '@mui/icons-material/Tune';
import CloseIcon from '@mui/icons-material/Close';
import RefreshIcon from '@mui/icons-material/Refresh';

import HtDropdownSelector from './components/HtDropdownSelector';
import HtSelectorDate from './components/HtSelectorDate';
import HtScatterHeatmapAvg from './components/HtScatterHeatmapAvg';

import config_data from './data/config_cod.json';

import {
    PANELS, DEFAULT_PANEL_ORDER, PANEL_ORDER_STORAGE_KEY, AGE_BAND_LABELS, SHOW_TYPES,
    HOTEL_KPI_OPTIONS, DEFAULT_HOTEL_KPI, KPI_DIM_MAP, HOTEL_THRESHOLDS, PERCENT_KPIS,
    HOTEL_FLOOR_X_MIN, HOTEL_FLOOR_X_MAX, HOTEL_FLOOR_Y_MIN, HOTEL_FLOOR_Y_MAX,
    HOTEL_FLOOR_ASPECT_W, HOTEL_FLOOR_ASPECT_H,
    HOTEL_SYMBOL_SIZE, SYMBOL_SIZE_MIN, SYMBOL_SIZE_MAX, SYMBOL_SIZE_STEP,
    LEGEND_FONT, LEGEND_SWATCH_W, LEGEND_SWATCH_H, DRAWER_WIDTH, NUM_FIELD_WIDTH, GEOM_STORAGE_KEY,
} from './constants/hotelConfig';
import { fetchHotelData, isMockHotelFeed, filterHotelRows, deriveOptions, buildHotelScatterData, panelKpiSummary } from './utils/hotelData';

// Compact KPI value formatter for the per-panel chip. Theoretical/Actual
// Hold % get a '%'; everything else is a k/M-suffixed $/count.
function fmtKpi(v, kpi) {
    if (v == null || Number.isNaN(v)) return '—';
    if (PERCENT_KPIS.has(kpi)) return `${v.toFixed(1)}%`;
    const a = Math.abs(v);
    if (a >= 1_000_000) return `${(v / 1_000_000).toFixed(2)}M`;
    if (a >= 10_000) return `${(v / 1000).toFixed(0)}k`;
    if (a >= 1000) return `${(v / 1000).toFixed(1)}k`;
    if (a >= 100) return v.toFixed(0);
    return v.toFixed(1);
}

// Compact dark-themed number field for the "Floor Geometry" drawer
// section (aspect ratio / axis bounds). Small footprint so two sit
// side-by-side (e.g. "W" / "H", "min" / "max").
const numFieldSx = { width: NUM_FIELD_WIDTH,
    '& .MuiOutlinedInput-root': { color: '#dfe6ff', fontSize: 13, height: 34,
        '& fieldset': { borderColor: 'rgba(122,162,247,0.3)' },
        '&:hover fieldset': { borderColor: 'rgba(122,162,247,0.55)' },
        '&.Mui-focused fieldset': { borderColor: '#7aa2f7' } },
    '& input': { textAlign: 'center' },
};

export default function HotelDashboard() {
    const [rows, setRows] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    // Primary slicers.
    const [startDate, setStartDate] = useState('');
    const [endDate, setEndDate] = useState('');
    const [showType, setShowType] = useState('Table');
    const [selectedArea, setSelectedArea] = useState([]);
    const [selectedPit, setSelectedPit] = useState([]);
    const [selectedGame, setSelectedGame] = useState([]);
    const [selectedDow, setSelectedDow] = useState([]);
    const [selectedKPI, setSelectedKPI] = useState(DEFAULT_HOTEL_KPI);

    // Drawer slicers.
    const [selectedRegion, setSelectedRegion] = useState([]);
    const [selectedTier, setSelectedTier] = useState([]);
    const [selectedAge, setSelectedAge] = useState([]);
    const [selectedSex, setSelectedSex] = useState([]);
    const [selectedSegment, setSelectedSegment] = useState([]);
    const [selectedSubSegment, setSelectedSubSegment] = useState([]);
    const [drawerOpen, setDrawerOpen] = useState(false);

    // Drawer — floor geometry (aspect ratio, axis bounds, symbol size).
    // Live-adjustable overrides for the 6 scatter panels, persisted to
    // localStorage. Mirrors the pricing dashboard's CMP_FLOOR_* knobs
    // (see hotelConfig.js) — "Reset" restores these exact defaults.
    const defaultGeometry = useMemo(() => ({
        aspectW: HOTEL_FLOOR_ASPECT_W, aspectH: HOTEL_FLOOR_ASPECT_H,
        xMin: HOTEL_FLOOR_X_MIN, xMax: HOTEL_FLOOR_X_MAX,
        yMin: HOTEL_FLOOR_Y_MIN, yMax: HOTEL_FLOOR_Y_MAX,
        symbolSize: HOTEL_SYMBOL_SIZE,
    }), []);
    const [geometry, setGeometry] = useState(() => {
        try {
            const saved = JSON.parse(window.localStorage.getItem(GEOM_STORAGE_KEY));
            return saved && typeof saved === 'object' ? { ...defaultGeometry, ...saved } : defaultGeometry;
        } catch { return defaultGeometry; }
    });
    useEffect(() => {
        try { window.localStorage.setItem(GEOM_STORAGE_KEY, JSON.stringify(geometry)); } catch { /* ignore */ }
    }, [geometry]);
    const setGeom = (patch) => setGeometry((g) => ({ ...g, ...patch }));
    const resetGeometry = () => setGeometry(defaultGeometry);
    const geometryChanged = Object.keys(defaultGeometry).some((k) => geometry[k] !== defaultGeometry[k]);

    // Drawer — panel order. Which of the 6 stayer-segment panels renders
    // in which grid position (left-to-right, top-to-bottom), live-
    // adjustable and persisted to localStorage. Default order is
    // DEFAULT_PANEL_ORDER (the PANELS array order in hotelConfig.js);
    // "Reset" restores it.
    const [panelOrder, setPanelOrder] = useState(() => {
        try {
            const saved = JSON.parse(window.localStorage.getItem(PANEL_ORDER_STORAGE_KEY));
            // Guard against a stale saved order (e.g. panel keys renamed
            // since it was saved) — fall back to default unless every
            // key still matches exactly.
            if (Array.isArray(saved) && saved.length === DEFAULT_PANEL_ORDER.length &&
                saved.every((k) => DEFAULT_PANEL_ORDER.includes(k))) {
                return saved;
            }
        } catch { /* ignore */ }
        return DEFAULT_PANEL_ORDER;
    });
    useEffect(() => {
        try { window.localStorage.setItem(PANEL_ORDER_STORAGE_KEY, JSON.stringify(panelOrder)); } catch { /* ignore */ }
    }, [panelOrder]);
    const movePanel = (index, dir) => setPanelOrder((order) => {
        const to = index + dir;
        if (to < 0 || to >= order.length) return order;
        const next = [...order];
        [next[index], next[to]] = [next[to], next[index]];
        return next;
    });
    const resetPanelOrder = () => setPanelOrder(DEFAULT_PANEL_ORDER);
    const panelOrderChanged = panelOrder.some((k, i) => k !== DEFAULT_PANEL_ORDER[i]);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const data = await fetchHotelData();
            setRows(data);
            setError(null);
        } catch (e) {
            setError(e?.message || String(e));
        } finally {
            setLoading(false);
        }
    }, []);
    useEffect(() => { load(); }, [load]);

    // Seed date range + slicer options once the feed lands. Area/Pit/Game
    // come from the floor layout config (config_data), not the raw patron
    // rows — see deriveOptions() in hotelData.js.
    const options = useMemo(() => (rows ? deriveOptions(rows, config_data) : {
        areas: [], pits: [], games: [], dows: [],
        regions: [], cardTiers: [], sexes: [], segments: [], subSegments: [],
    }), [rows]);
    useEffect(() => {
        if (!rows || !rows.length) return;
        let min = rows[0].date, max = rows[0].date;
        for (const r of rows) { if (r.date < min) min = r.date; if (r.date > max) max = r.date; }
        setStartDate((s) => s || min);
        setEndDate((e) => e || max);
    }, [rows]);

    // Active config tables for the end-date window (same rule as perf).
    const filteredConfig = useMemo(() => {
        if (!endDate) return [];
        return config_data.filter((c) => c.Group === 'TG' && c.is_Active === 1 && c.startdate <= endDate && c.enddate >= endDate);
    }, [endDate]);

    // Apply every slicer once, then split into the six panels (by hotel
    // flag) and fold each panel's patron-grain rows up to a per-table
    // scatter payload. Overall uses the full filtered set, no flag check.
    const panelData = useMemo(() => {
        if (!rows || !startDate || !endDate) return [];
        const filtered = filterHotelRows(rows, {
            startDate, endDate, excludedDates: new Set(),
            areas: selectedArea, pits: selectedPit, games: selectedGame, dows: selectedDow,
            regions: selectedRegion, cardTiers: selectedTier, ageBands: selectedAge,
            sexes: selectedSex, segments: selectedSegment, subSegments: selectedSubSegment,
        });
        return PANELS.map((p) => {
            const subset = p.overall ? filtered : filtered.filter((r) => r[p.flag] === 1);
            const scatter = buildHotelScatterData(subset, filteredConfig, showType);
            const summary = panelKpiSummary(scatter, selectedKPI);
            return { ...p, scatter, summary };
        });
    }, [rows, startDate, endDate, selectedArea, selectedPit, selectedGame, selectedDow,
        selectedRegion, selectedTier, selectedAge, selectedSex, selectedSegment, selectedSubSegment,
        filteredConfig, showType, selectedKPI]);

    // Grid render order — panelData in panelOrder's sequence.
    const orderedPanelData = useMemo(
        () => panelOrder.map((key) => panelData.find((p) => p.key === key)).filter(Boolean),
        [panelData, panelOrder],
    );

    // Shared threshold legend for the active KPI (one for all six maps).
    const legendPieces = useMemo(() => HOTEL_THRESHOLDS[selectedKPI] || [], [selectedKPI]);

    // KPI → {dim, thresholds} for every Hotel KPI — passed to
    // HtScatterHeatmapAvg as its `kpiConfigMap` so it colors dots using
    // Hotel's own tuple layout (see hotelData.js buildHotelScatterData).
    const hotelKpiConfigMap = useMemo(() => Object.fromEntries(
        HOTEL_KPI_OPTIONS.map((kpi) => [kpi, { dim: KPI_DIM_MAP[kpi], thresholds: HOTEL_THRESHOLDS[kpi] }]),
    ), []);

    // Legend click-to-filter — clicking a swatch toggles that threshold
    // bucket off across ALL 6 maps simultaneously (matching tables grey
    // out via the same outOfRange fill ECharts' visualMap already uses).
    // `legendPieces` order matches the `pieces` array ScatterHeatmapAvg
    // builds internally from `hotelKpiConfigMap[selectedKPI].thresholds`
    // (the SAME HOTEL_THRESHOLDS[selectedKPI] array), so piece index i
    // here IS visualMap piece index i there.
    const [deselectedPieces, setDeselectedPieces] = useState(() => new Set());
    useEffect(() => { setDeselectedPieces(new Set()); }, [legendPieces]);
    const visualMapSelected = useMemo(
        () => Object.fromEntries(legendPieces.map((_, i) => [i, !deselectedPieces.has(i)])),
        [legendPieces, deselectedPieces],
    );
    const togglePiece = (i) => setDeselectedPieces((prev) => {
        const next = new Set(prev);
        if (next.has(i)) next.delete(i); else next.add(i);
        return next;
    });

    const drawerActive = selectedRegion.length + selectedTier.length + selectedAge.length +
        selectedSex.length + selectedSegment.length + selectedSubSegment.length;

    if (loading) {
        return (
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 2, color: '#7aa2f7' }}>
                <CircularProgress size={26} sx={{ color: '#7aa2f7' }} />
                <Typography>Loading hotel-segment data…</Typography>
            </Box>
        );
    }

    return (
        <Box sx={{ width: '100%', height: '100%', overflowY: 'auto', boxSizing: 'border-box',
            scrollbarColor: 'rgba(122,162,247,0.4) rgba(255,255,255,0.04)', scrollbarWidth: 'thin',
            '&::-webkit-scrollbar': { width: 10 },
            '&::-webkit-scrollbar-thumb': { bgcolor: 'rgba(122,162,247,0.4)', borderRadius: 4, border: '2px solid transparent', backgroundClip: 'padding-box' },
        }}>
            <Box sx={{ px: 1, py: 1 }}>
                <Paper elevation={3} sx={{ p: 1.2, backgroundColor: 'rgba(50,52,72,0.85)', backgroundImage: 'none' }}>
                    {/* Title */}
                    <Stack direction="row" spacing={1.5} sx={{ alignItems: 'baseline', px: 0.5, mb: 1 }}>
                        <Typography sx={{ color: '#dfe6ff', fontSize: 20, fontWeight: 700, letterSpacing: 0.4 }}>Hotel Segment Heatmap</Typography>
                        <Typography sx={{ color: 'rgba(255,255,255,0.4)', fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.6 }}>
                            {isMockHotelFeed() ? 'mock feed' : 'live feed'} · same KPI across 6 stayer segments
                        </Typography>
                        {error && <Typography sx={{ color: '#f7768e', fontSize: 12 }}>· {error}</Typography>}
                    </Stack>

                    {/* Control panel — primary slicers + drawer trigger. */}
                    <Stack direction="row" spacing={1} sx={{ alignItems: 'flex-end', flexWrap: 'wrap', rowGap: 1, px: 0.5 }}>
                        <HtSelectorDate
                            selected_Start={startDate} selected_End={endDate}
                            set_Selected_Start={setStartDate} set_Selected_End={setEndDate}
                        />
                        <HtDropdownSelector label="Group By" availableOptions={SHOW_TYPES} selectedOptions={showType}
                            setSelectedOptions={(v) => setShowType(v[0] || v)} multiple={false} width={110} />
                        <HtDropdownSelector label="Area" availableOptions={options.areas} selectedOptions={selectedArea} setSelectedOptions={setSelectedArea} />
                        <HtDropdownSelector label="Pit" availableOptions={options.pits} selectedOptions={selectedPit} setSelectedOptions={setSelectedPit} />
                        <HtDropdownSelector label="Game" availableOptions={options.games} selectedOptions={selectedGame} setSelectedOptions={setSelectedGame} />
                        <HtDropdownSelector label="DOW" availableOptions={options.dows} selectedOptions={selectedDow} setSelectedOptions={setSelectedDow} />
                        <HtDropdownSelector label="KPI" availableOptions={HOTEL_KPI_OPTIONS} selectedOptions={selectedKPI}
                            setSelectedOptions={(v) => setSelectedKPI(v[0] || v)} multiple={false} width={180} menuWidth={260} />

                        <Box sx={{ ml: 'auto', display: 'flex', alignItems: 'center', gap: 1 }}>
                            <Button onClick={() => setDrawerOpen(true)} startIcon={<TuneIcon sx={{ fontSize: 17 }} />}
                                sx={{ textTransform: 'none', fontWeight: 700, fontSize: 13, color: '#dfe6ff',
                                    bgcolor: 'rgba(122,162,247,0.14)', border: '1px solid rgba(122,162,247,0.4)', borderRadius: 1.5, px: 1.4, height: 38,
                                    '&:hover': { bgcolor: 'rgba(122,162,247,0.24)' } }}>
                                More filters
                                {drawerActive > 0 && (
                                    <Box component="span" sx={{ ml: 0.8, minWidth: 20, height: 18, px: 0.6, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 800, borderRadius: 999, bgcolor: '#7aa2f7', color: '#0d1424' }}>{drawerActive}</Box>
                                )}
                            </Button>
                            <Tooltip title="Reload data">
                                <IconButton onClick={load} size="small" sx={{ color: '#7aa2f7', border: '1px solid rgba(122,162,247,0.3)', borderRadius: 1.5 }}>
                                    <RefreshIcon sx={{ fontSize: 18 }} />
                                </IconButton>
                            </Tooltip>
                        </Box>
                    </Stack>

                    {/* Shared threshold legend — one for all six maps.
                        Click a swatch to toggle that bucket off across
                        every panel at once (matching tables grey out via
                        the same visualMap outOfRange fill ECharts uses
                        for "no data" — no separate visual language). */}
                    <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mt: 1.2, px: 0.5, flexWrap: 'wrap', rowGap: 0.8 }}>
                        <Typography sx={{ color: 'rgba(255,255,255,0.55)', fontSize: LEGEND_FONT.sectionHeader, fontWeight: 800, letterSpacing: 0.6, textTransform: 'uppercase', mr: 0.5, lineHeight: 1 }}>
                            {selectedKPI}
                        </Typography>
                        {legendPieces.map((p, i) => {
                            const isOff = deselectedPieces.has(i);
                            return (
                                <Stack key={p.label} direction="row" spacing={0.6}
                                    onClick={() => togglePiece(i)}
                                    sx={{
                                        alignItems: 'center', cursor: 'pointer', userSelect: 'none', opacity: isOff ? 0.35 : 1,
                                        borderRadius: 0.8, px: 0.5, py: 0.2, transition: 'opacity 150ms ease, background-color 150ms ease',
                                        '&:hover': { bgcolor: 'rgba(255,255,255,0.06)' },
                                    }}>
                                    <Box sx={{ width: LEGEND_SWATCH_W, height: LEGEND_SWATCH_H, borderRadius: 0.4, bgcolor: p.color, border: '1px solid rgba(255,255,255,0.15)', flexShrink: 0 }} />
                                    <Typography sx={{ color: 'rgba(255,255,255,0.85)', fontSize: LEGEND_FONT.swatchLabel, fontWeight: 600, whiteSpace: 'nowrap', lineHeight: 1, textDecoration: isOff ? 'line-through' : 'none' }}>{p.label}</Typography>
                                </Stack>
                            );
                        })}
                        <Stack direction="row" spacing={0.6} sx={{ alignItems: 'center' }}>
                            <Box sx={{ width: LEGEND_SWATCH_W, height: LEGEND_SWATCH_H, borderRadius: 0.4, bgcolor: '#3a3a3a', opacity: 0.5, border: '1px solid rgba(255,255,255,0.12)', flexShrink: 0 }} />
                            <Typography sx={{ color: 'rgba(255,255,255,0.45)', fontSize: LEGEND_FONT.swatchLabel, lineHeight: 1 }}>no data</Typography>
                        </Stack>
                        {deselectedPieces.size > 0 && (
                            <Button size="small" onClick={() => setDeselectedPieces(new Set())}
                                sx={{ minWidth: 0, px: 1, fontSize: 11, fontWeight: 700, color: '#7aa2f7', textTransform: 'none' }}>
                                Show all
                            </Button>
                        )}
                    </Stack>

                    {/* 6-panel small-multiples grid (2 rows × 3). */}
                    {/* 2 rows × 3 is the intended desktop layout — 3-across
                        from lg up; 2-across on tablets; single column on
                        phones. */}
                    <Box sx={{ mt: 1.4, display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr', lg: '1fr 1fr 1fr' }, gap: 1.4 }}>
                        {orderedPanelData.map((p) => (
                            <Box key={p.key} sx={{
                                borderRadius: 2, overflow: 'hidden',
                                border: `1px solid ${p.accent}44`,
                                bgcolor: 'rgba(30,32,48,0.6)',
                                boxShadow: `inset 0 1px 0 rgba(255,255,255,0.04)`,
                            }}>
                                {/* Panel header — accent bar + segment + KPI chip.
                                    Every element pins to an explicit 16px line box (lineHeight
                                    matching the accent bar's height) so the bar, title, and chip
                                    all sit on one strict baseline instead of drifting per MUI's
                                    default (1.5×) line-height. */}
                                <Stack direction="row" spacing={1} sx={{ alignItems: 'center', px: 1.1, py: 0.7, borderBottom: `1px solid ${p.accent}33`, background: `linear-gradient(90deg, ${p.accent}1f, transparent 60%)` }}>
                                    <Box sx={{ width: 4, height: 16, bgcolor: p.accent, borderRadius: 0.5, flexShrink: 0 }} />
                                    <Typography sx={{ color: '#eaf0ff', fontSize: 14, fontWeight: 800, letterSpacing: 0.3, lineHeight: '16px' }}>{p.title}</Typography>
                                    <Box sx={{ flex: 1 }} />
                                    <Chip size="small" label={fmtKpi(p.summary.avg, selectedKPI)}
                                        sx={{ height: 22, fontWeight: 800, fontSize: 12.5, fontVariantNumeric: 'tabular-nums', color: '#0d1424', bgcolor: p.accent,
                                            '& .MuiChip-label': { px: 1, lineHeight: '22px' } }} />
                                </Stack>
                                {/* Scatter — aspect-locked (adjustable in More filters);
                                    shared legend hidden per-map, tooltip + brush removed. */}
                                <Box sx={{ position: 'relative', width: '100%', aspectRatio: `${geometry.aspectW} / ${geometry.aspectH}` }}>
                                    {p.summary.tables === 0 ? (
                                        <Stack sx={{ alignItems: 'center', justifyContent: 'center', position: 'absolute', inset: 0, color: 'rgba(255,255,255,0.4)', gap: 0.5 }}>
                                            <Typography sx={{ fontSize: 13, fontWeight: 700 }}>No data for this segment</Typography>
                                            <Typography sx={{ fontSize: 11 }}>Widen the date range or clear a slicer.</Typography>
                                        </Stack>
                                    ) : (
                                        <HtScatterHeatmapAvg
                                            data={p.scatter}
                                            selectedKPI={selectedKPI}
                                            selectedContour="OFF"
                                            title=""
                                            kpiConfigMap={hotelKpiConfigMap}
                                            hideVisualMap
                                            hideTooltip
                                            hideBrush
                                            visualMapSelected={visualMapSelected}
                                            gridOverride={{ left: '2%', right: '2%', top: '4%', bottom: '4%' }}
                                            xMin={geometry.xMin} xMax={geometry.xMax}
                                            yMin={geometry.yMin} yMax={geometry.yMax}
                                            symbolSizeMultiplier={geometry.symbolSize}
                                        />
                                    )}
                                </Box>
                            </Box>
                        ))}
                    </Box>
                </Paper>
            </Box>

            {/* More-filters drawer (Region · Card Tier · Age). */}
            <Drawer anchor="right" open={drawerOpen} onClose={() => setDrawerOpen(false)}
                PaperProps={{ sx: { width: DRAWER_WIDTH, bgcolor: 'rgba(24,26,40,0.98)', backgroundImage: 'none', borderLeft: '1px solid rgba(122,162,247,0.25)', color: '#fff' } }}>
                <Stack sx={{ height: '100%' }}>
                    <Stack direction="row" sx={{ alignItems: 'center', px: 2, py: 1.5, borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                        <TuneIcon sx={{ fontSize: 18, color: '#7aa2f7', mr: 1 }} />
                        <Typography sx={{ fontSize: 15, fontWeight: 800, color: '#dfe6ff' }}>Patron filters</Typography>
                        <Box sx={{ flex: 1 }} />
                        {drawerActive > 0 && (
                            <Button size="small" onClick={() => {
                                setSelectedRegion([]); setSelectedTier([]); setSelectedAge([]);
                                setSelectedSex([]); setSelectedSegment([]); setSelectedSubSegment([]);
                            }}
                                sx={{ minWidth: 0, px: 1, fontSize: 11, fontWeight: 700, color: '#7aa2f7', textTransform: 'none', mr: 0.5 }}>Reset</Button>
                        )}
                        <IconButton size="small" onClick={() => setDrawerOpen(false)} sx={{ color: 'rgba(255,255,255,0.6)' }}><CloseIcon sx={{ fontSize: 18 }} /></IconButton>
                    </Stack>
                    <Stack spacing={2.2} sx={{ p: 2 }}>
                        <Typography sx={{ color: 'rgba(255,255,255,0.4)', fontSize: 11, lineHeight: 1.5 }}>
                            These narrow every panel by the patron attributes carried on each date × table × player row.
                        </Typography>
                        <HtDropdownSelector label="Region" availableOptions={options.regions} selectedOptions={selectedRegion} setSelectedOptions={setSelectedRegion} width={280} menuWidth={280} />
                        <HtDropdownSelector label="Card Tier" availableOptions={options.cardTiers} selectedOptions={selectedTier} setSelectedOptions={setSelectedTier} width={280} menuWidth={280} />
                        <HtDropdownSelector label="Age Band" availableOptions={AGE_BAND_LABELS} selectedOptions={selectedAge} setSelectedOptions={setSelectedAge} width={280} menuWidth={280} />
                        <HtDropdownSelector label="Sex" availableOptions={options.sexes} selectedOptions={selectedSex} setSelectedOptions={setSelectedSex} width={280} menuWidth={280} />
                        <HtDropdownSelector label="Segment" availableOptions={options.segments} selectedOptions={selectedSegment} setSelectedOptions={setSelectedSegment} width={280} menuWidth={280} />
                        <HtDropdownSelector label="Sub-segment" availableOptions={options.subSegments} selectedOptions={selectedSubSegment} setSelectedOptions={setSelectedSubSegment} width={280} menuWidth={280} />

                        <Divider sx={{ borderColor: 'rgba(255,255,255,0.08)' }} />

                        {/* Panel order — which segment renders in which
                            grid position (left-to-right, top-to-bottom).
                            Up/down swaps two adjacent panels at a time;
                            simpler and more predictable than drag-reorder
                            for a fixed set of 6 items. */}
                        <Stack direction="row" sx={{ alignItems: 'center' }}>
                            <Typography sx={{ fontSize: 13, fontWeight: 800, color: '#dfe6ff', letterSpacing: 0.3 }}>Panel order</Typography>
                            <Box sx={{ flex: 1 }} />
                            {panelOrderChanged && (
                                <Button size="small" onClick={resetPanelOrder}
                                    sx={{ minWidth: 0, px: 1, fontSize: 11, fontWeight: 700, color: '#7aa2f7', textTransform: 'none' }}>Reset</Button>
                            )}
                        </Stack>
                        <Typography sx={{ color: 'rgba(255,255,255,0.4)', fontSize: 11, lineHeight: 1.5, mt: -1.4 }}>
                            Move a segment up/down to change its position in the grid.
                        </Typography>
                        <Stack spacing={0.6}>
                            {panelOrder.map((key, i) => {
                                const p = PANELS.find((x) => x.key === key);
                                if (!p) return null;
                                return (
                                    <Stack key={key} direction="row" spacing={1}
                                        sx={{ alignItems: 'center', px: 1, py: 0.6, borderRadius: 1, bgcolor: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
                                        <Box sx={{ width: 4, height: 14, bgcolor: p.accent, borderRadius: 0.5, flexShrink: 0 }} />
                                        <Typography sx={{ fontSize: 12.5, color: '#dfe6ff', fontWeight: 600, flex: 1 }}>{p.title}</Typography>
                                        <Box onClick={() => movePanel(i, -1)}
                                            sx={{ cursor: i === 0 ? 'default' : 'pointer', opacity: i === 0 ? 0.3 : 1, width: 22, height: 22, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 0.6, bgcolor: 'rgba(255,255,255,0.06)', color: '#dfe6ff', fontSize: 11, '&:hover': i === 0 ? {} : { bgcolor: 'rgba(255,255,255,0.14)' } }}>▲</Box>
                                        <Box onClick={() => movePanel(i, 1)}
                                            sx={{ cursor: i === panelOrder.length - 1 ? 'default' : 'pointer', opacity: i === panelOrder.length - 1 ? 0.3 : 1, width: 22, height: 22, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 0.6, bgcolor: 'rgba(255,255,255,0.06)', color: '#dfe6ff', fontSize: 11, '&:hover': i === panelOrder.length - 1 ? {} : { bgcolor: 'rgba(255,255,255,0.14)' } }}>▼</Box>
                                    </Stack>
                                );
                            })}
                        </Stack>

                        <Divider sx={{ borderColor: 'rgba(255,255,255,0.08)' }} />

                        {/* Floor geometry — aspect ratio, axis bounds, symbol
                            size for all 6 panels at once. Mirrors the pricing
                            dashboard's CMP_FLOOR_* knobs (floorLayout.js /
                            PricingFloorMap.js's ⚙ symbol-size control). */}
                        <Stack direction="row" sx={{ alignItems: 'center' }}>
                            <Typography sx={{ fontSize: 13, fontWeight: 800, color: '#dfe6ff', letterSpacing: 0.3 }}>Floor geometry</Typography>
                            <Box sx={{ flex: 1 }} />
                            {geometryChanged && (
                                <Button size="small" onClick={resetGeometry}
                                    sx={{ minWidth: 0, px: 1, fontSize: 11, fontWeight: 700, color: '#7aa2f7', textTransform: 'none' }}>Reset</Button>
                            )}
                        </Stack>
                        <Typography sx={{ color: 'rgba(255,255,255,0.4)', fontSize: 11, lineHeight: 1.5, mt: -1.4 }}>
                            Tunes the scatter box shape and coordinate space for all 6 panels at once.
                        </Typography>

                        <Stack spacing={1}>
                            <Typography sx={{ fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.5)', textTransform: 'uppercase', letterSpacing: 0.5 }}>Aspect ratio (W / H)</Typography>
                            <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                                <TextField type="number" size="small" value={geometry.aspectW}
                                    onChange={(e) => setGeom({ aspectW: Number(e.target.value) || 1 })} sx={numFieldSx} />
                                <Typography sx={{ color: 'rgba(255,255,255,0.4)' }}>/</Typography>
                                <TextField type="number" size="small" value={geometry.aspectH}
                                    onChange={(e) => setGeom({ aspectH: Number(e.target.value) || 1 })} sx={numFieldSx} />
                            </Stack>
                        </Stack>

                        <Stack spacing={1}>
                            <Typography sx={{ fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.5)', textTransform: 'uppercase', letterSpacing: 0.5 }}>X-axis min / max</Typography>
                            <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                                <TextField type="number" size="small" value={geometry.xMin}
                                    onChange={(e) => setGeom({ xMin: Number(e.target.value) })} sx={numFieldSx} />
                                <Typography sx={{ color: 'rgba(255,255,255,0.4)' }}>–</Typography>
                                <TextField type="number" size="small" value={geometry.xMax}
                                    onChange={(e) => setGeom({ xMax: Number(e.target.value) })} sx={numFieldSx} />
                            </Stack>
                        </Stack>

                        <Stack spacing={1}>
                            <Typography sx={{ fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.5)', textTransform: 'uppercase', letterSpacing: 0.5 }}>Y-axis min / max</Typography>
                            <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                                <TextField type="number" size="small" value={geometry.yMin}
                                    onChange={(e) => setGeom({ yMin: Number(e.target.value) })} sx={numFieldSx} />
                                <Typography sx={{ color: 'rgba(255,255,255,0.4)' }}>–</Typography>
                                <TextField type="number" size="small" value={geometry.yMax}
                                    onChange={(e) => setGeom({ yMax: Number(e.target.value) })} sx={numFieldSx} />
                            </Stack>
                        </Stack>

                        <Stack spacing={0.8}>
                            <Typography sx={{ fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.5)', textTransform: 'uppercase', letterSpacing: 0.5 }}>Symbol size</Typography>
                            <Stack direction="row" spacing={0.8} sx={{ alignItems: 'center' }}>
                                <Typography sx={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', minWidth: 28 }}>{SYMBOL_SIZE_MIN}×</Typography>
                                <Box component="input" type="range" min={SYMBOL_SIZE_MIN} max={SYMBOL_SIZE_MAX} step={SYMBOL_SIZE_STEP} value={geometry.symbolSize}
                                    onChange={(e) => setGeom({ symbolSize: parseFloat(e.target.value) })}
                                    sx={{ flex: 1, accentColor: '#7aa2f7', height: 6, cursor: 'pointer', '&::-webkit-slider-thumb': { cursor: 'pointer' } }} />
                                <Typography sx={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', minWidth: 28, textAlign: 'right' }}>{SYMBOL_SIZE_MAX}×</Typography>
                            </Stack>
                            <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between' }}>
                                <Typography sx={{ fontSize: 16, fontWeight: 800, color: '#7aa2f7', fontVariantNumeric: 'tabular-nums' }}>{geometry.symbolSize.toFixed(2)}×</Typography>
                                <Stack direction="row" spacing={0.5}>
                                    <Box onClick={() => setGeometry((g) => ({ ...g, symbolSize: Math.max(SYMBOL_SIZE_MIN, +(g.symbolSize - SYMBOL_SIZE_STEP).toFixed(2)) }))}
                                        sx={{ cursor: 'pointer', width: 26, height: 26, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 0.8, bgcolor: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.15)', color: '#dfe6ff', fontWeight: 800, '&:hover': { bgcolor: 'rgba(255,255,255,0.12)' } }}>−</Box>
                                    <Box onClick={() => setGeometry((g) => ({ ...g, symbolSize: Math.min(SYMBOL_SIZE_MAX, +(g.symbolSize + SYMBOL_SIZE_STEP).toFixed(2)) }))}
                                        sx={{ cursor: 'pointer', width: 26, height: 26, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 0.8, bgcolor: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.15)', color: '#dfe6ff', fontWeight: 800, '&:hover': { bgcolor: 'rgba(255,255,255,0.12)' } }}>+</Box>
                                </Stack>
                            </Stack>
                        </Stack>
                    </Stack>
                </Stack>
            </Drawer>
        </Box>
    );
}
