// Real-time Floor — Surveillance console.
// =======================================
// Map-first redesign 2026-09-26 — see
// docs/superpowers/specs/2026-09-26-floor-map-first-design.md
//
//   header
//   Casino Win tiles │ alert strip                       one row
//   floor map + edge rings + legend filter (7) │ lists (3, height = map)
//   table focus: table + seats │ edge by hand · trend board
//   Player 360 overlay (on demand) · floor context (collapsed)
//
// Every money figure is labelled Patron Win or Casino Win.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Box, ButtonBase, Collapse, Stack, ToggleButton, ToggleButtonGroup, Tooltip, Typography } from '@mui/material';
import FiberManualRecordIcon from '@mui/icons-material/FiberManualRecord';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';

import RtDropdownSelector from './components/RtDropdownSelector';
import RtFloorMap from './components/RtFloorMap';
import RtTabbedPanel from './components/RtTabbedPanel';
import RtAlertBar from './components/RtAlertBar';
import RtSummaryTiles from './components/RtSummaryTiles';
import RtTableFocus from './components/focus/RtTableFocus';
import RtMapLegend from './components/rings/RtMapLegend';
import RtRingSettings, { RingToolbar } from './components/rings/RtRingSettings';
import RtRingInfo from './components/rings/RtRingInfo';
import RtTrendChart from './components/RtTrendChart';
import RtBetMixPanel from './components/RtBetMixPanel';
import RtPatron360 from './components/patron360/RtPatron360';

import { buildAvgScatterData } from './vendor/dataProcessing';
import { threshold_dict } from './vendor/heatmapConstants';
import config_data from './data/config_cod.json';
import {
    SCATTER_ASPECT, MAP_FRACTION, LEGEND_FRACTION, GRID_GAP,
    REFRESH_OPTIONS, DEFAULT_REFRESH_MS, HOUSE_EDGE_OPTIONS, DEFAULT_HOUSE_EDGE_BET, DEFAULT_TAB,
    TREND_BUCKET_OPTIONS, DEFAULT_TREND_BUCKET,
    SHOW_SLICERS, FIXED_GAMES, RT_METRICS, RT_SCOPES, kpiKeyFor,
} from './constants/rtConfig';
import { isMockRealtimeFeed, realtimeOptions, filterRealtimeRows } from './utils/realtimeData';
import { pollAll, fetchShoe } from './utils/rtDataSource';
import { loadRingSettings, saveRingSettings, ringsByTable } from './utils/edgeRings';
import { bandCounts, mapDim } from './utils/floorBands';
import { groupShoeRows } from './utils/shoeData';
import { evaluateAlerts, alertCounts } from './utils/alertEngine';
import { SURFACE, TEXT, STATE, ACCENT, systemLabel } from './constants/rtTheme';

const REFRESH_LABELS = REFRESH_OPTIONS.map((o) => o.label);
const HOUSE_EDGE_BET_LABELS = HOUSE_EDGE_OPTIONS.map((o) => o.label);
const TREND_LABELS = TREND_BUCKET_OPTIONS.map((o) => o.label);
const msForLabel = (l) => (REFRESH_OPTIONS.find((o) => o.label === l) || {}).v ?? DEFAULT_REFRESH_MS;
const labelForMs = (ms) => (REFRESH_OPTIONS.find((o) => o.v === ms) || {}).label ?? REFRESH_OPTIONS[0].label;
const bucketForLabel = (l) => (TREND_BUCKET_OPTIONS.find((o) => o.label === l) || {}).v ?? DEFAULT_TREND_BUCKET;
const labelForBucket = (v) => (TREND_BUCKET_OPTIONS.find((o) => o.v === v) || {}).label ?? TREND_BUCKET_OPTIONS[0].label;
const EMPTY = [];

function fmtClock(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    return [d.getHours(), d.getMinutes(), d.getSeconds()].map((n) => String(n).padStart(2, '0')).join(':');
}

const panelSx = { borderRadius: 2, border: `1px solid ${SURFACE.panelBorder}`, bgcolor: SURFACE.panel, minWidth: 0 };
const raisedPanelSx = { borderRadius: 2, border: `1px solid ${SURFACE.raisedBorder}`, bgcolor: SURFACE.raised, minWidth: 0 };

function readFlag(key, fallback) {
    try { const v = localStorage.getItem(key); return v == null ? fallback : v === '1'; } catch { return fallback; }
}
function writeFlag(key, v) {
    try { localStorage.setItem(key, v ? '1' : '0'); } catch { /* storage unavailable */ }
}

const segmentedSx = {
    height: 36,
    '& .MuiToggleButton-root': {
        color: TEXT.muted, borderColor: 'rgba(122,162,247,0.35)', textTransform: 'none',
        fontSize: 13, fontWeight: 700, px: 1.6, whiteSpace: 'nowrap',
    },
    '& .Mui-selected': { color: `${TEXT.primary} !important`, bgcolor: 'rgba(122,162,247,0.24) !important' },
};

export default function RealtimeDashboard() {
    const options = useMemo(() => realtimeOptions(), []);

    // Hidden slicers (SHOW_SLICERS) — state kept so they work if re-enabled.
    const [selectedArea, setSelectedArea] = useState([]);
    const [selectedPit, setSelectedPit] = useState([]);
    const [selectedTableMin, setSelectedTableMin] = useState([]);

    const [metric, setMetric] = useState('win');
    const [scope, setScope] = useState('day');
    const [betOption, setBetOption] = useState(DEFAULT_HOUSE_EDGE_BET);
    const [refreshMs, setRefreshMs] = useState(DEFAULT_REFRESH_MS);
    const [activeTab, setActiveTab] = useState(DEFAULT_TAB);
    const [boardTableKey, setBoardTableKey] = useState(null);
    const [selectedPatronId, setSelectedPatronId] = useState(null);
    const [selectedAlertId, setSelectedAlertId] = useState(null);
    const [show360, setShow360] = useState(false);
    const [showFloorContext, setShowFloorContext] = useState(false);
    const [trendBucket, setTrendBucket] = useState(DEFAULT_TREND_BUCKET);
    const [betMixMode, setBetMixMode] = useState('wager');
    const [ringsOn, setRingsOn] = useState(() => readFlag('rt.ringsOn', false));
    const [ringSettings, setRingSettings] = useState(loadRingSettings);
    const [ringDialog, setRingDialog] = useState(false);
    const [hiddenBands, setHiddenBands] = useState(() => new Set());
    useEffect(() => writeFlag('rt.ringsOn', ringsOn), [ringsOn]);
    useEffect(() => saveRingSettings(ringSettings), [ringSettings]);
    // A band index means something else under another metric or scope.
    useEffect(() => { setHiddenBands(new Set()); }, [metric, scope, betOption]);

    // ── Polled feeds ──────────────────────────────────────────────────
    const [feed, setFeed] = useState(null);
    const [pulsing, setPulsing] = useState(false);
    const inflight = useRef(false);
    const bucketRef = useRef(trendBucket);
    bucketRef.current = trendBucket;

    const poll = useCallback(async () => {
        if (inflight.current) return;
        inflight.current = true;
        setPulsing(true);
        try {
            setFeed(await pollAll(bucketRef.current));
        } finally {
            inflight.current = false;
            setTimeout(() => setPulsing(false), 400);
        }
    }, []);
    useEffect(() => { poll(); }, [poll, trendBucket]);
    useEffect(() => {
        const id = setInterval(poll, refreshMs);
        return () => clearInterval(id);
    }, [refreshMs, poll]);

    const today = useMemo(() => new Date().toISOString().slice(0, 10), []);
    const filteredConfig = useMemo(
        () => config_data.filter((c) => c.Group === 'TG' && c.is_Active === 1 && c.startdate <= today && c.enddate >= today),
        [today],
    );
    const axisBounds = useMemo(() => {
        if (!filteredConfig.length) return null;
        const xs = filteredConfig.map((c) => c.x), ys = filteredConfig.map((c) => c.y);
        const pad = 70;
        return { xMin: Math.min(...xs) - pad, xMax: Math.max(...xs) + pad, yMin: Math.min(...ys) - pad, yMax: Math.max(...ys) + pad };
    }, [filteredConfig]);

    const tables = feed ? feed.tables : null;
    const patrons = (feed && feed.patrons) || EMPTY;
    const betmix = (feed && feed.betmix) || EMPTY;
    const dealers = (feed && feed.dealers) || EMPTY;
    const trend = (feed && feed.trend) || EMPTY;

    const filteredTables = useMemo(() => (tables ? filterRealtimeRows(tables, {
        areas: selectedArea, pits: selectedPit, games: FIXED_GAMES, tableMins: selectedTableMin,
    }) : EMPTY), [tables, selectedArea, selectedPit, selectedTableMin]);

    const kpiKey = kpiKeyFor(metric, scope);
    const scatter = useMemo(() => (tables
        ? buildAvgScatterData(filteredTables, filteredConfig, 'Table', [], FIXED_GAMES, today, today)
        : EMPTY), [tables, filteredTables, filteredConfig, today]);
    const ramp = threshold_dict[kpiKey] || EMPTY;
    const bands = useMemo(() => bandCounts(scatter, ramp, mapDim(kpiKey, betOption)), [scatter, ramp, kpiKey, betOption]);
    const rings = useMemo(() => ringsByTable(filteredTables, ringSettings), [filteredTables, ringSettings]);
    const toggleBand = useCallback((i) => setHiddenBands((cur) => {
        const next = new Set(cur);
        if (next.has(i)) next.delete(i); else next.add(i);
        return next;
    }), []);

    const alerts = useMemo(() => evaluateAlerts(filteredTables, patrons), [filteredTables, patrons]);
    const counts = useMemo(() => alertCounts(alerts), [alerts]);

    const tableByKey = useMemo(() => new Map(filteredTables.map((t) => [`${t.gametype}|${t.table}`, t])), [filteredTables]);
    const seatsByTable = useMemo(() => {
        const m = new Map();
        for (const p of patrons) {
            if (!p.current_table_key || !p.current_seat) continue;
            const list = m.get(p.current_table_key) || [];
            if (list.some((s) => s.seat === p.current_seat)) continue;
            list.push({ seat: p.current_seat, playerId: p.patron_id, cardType: p.card_type, cumWin: Number(p.cum_win) || 0 });
            m.set(p.current_table_key, list);
        }
        return m;
    }, [patrons]);

    // ── Shoe board table: first alerting table, else the biggest loser.
    // Sticky once chosen, so a wall screen doesn't jump every poll.
    const defaultBoardKey = useMemo(() => {
        const a = alerts.find((x) => x.tableKey && tableByKey.has(x.tableKey));
        if (a) return a.tableKey;
        let worst = null;
        for (const [k, t] of tableByKey) {
            if (!t.is_open) continue;
            const v = Number(t.win) || 0;
            if (!worst || v < worst.v) worst = { k, v };
        }
        return worst ? worst.k : null;
    }, [alerts, tableByKey]);
    useEffect(() => {
        if ((!boardTableKey || !tableByKey.has(boardTableKey)) && defaultBoardKey) setBoardTableKey(defaultBoardKey);
    }, [boardTableKey, defaultBoardKey, tableByKey]);
    const boardKey = boardTableKey && tableByKey.has(boardTableKey) ? boardTableKey : null;

    const alertTableSet = useMemo(() => new Set(alerts.map((a) => a.tableKey).filter(Boolean)), [alerts]);
    const tableOptions = useMemo(() => [...tableByKey.keys()]
        .sort((a, b) => (alertTableSet.has(b) - alertTableSet.has(a)) || a.localeCompare(b))
        .map((key) => ({ key, alerting: alertTableSet.has(key) })), [tableByKey, alertTableSet]);

    // ── Shoe feed for the board table, refreshed each poll tick ─────
    const [shoeState, setShoeState] = useState({ key: null, shoe: null, loading: false, error: null });
    const asOf = feed ? feed.asOf : null;
    useEffect(() => {
        if (!boardKey) return undefined;
        let cancelled = false;
        const [gametype, table] = boardKey.split('|');
        setShoeState((s) => (s.key === boardKey ? s : { key: boardKey, shoe: null, loading: true, error: null }));
        fetchShoe({ gametype, table }).then((res) => {
            if (cancelled) return;
            setShoeState((s) => ({
                key: boardKey,
                // Keep the last good shoe if a refresh fails.
                shoe: res.error && s.key === boardKey && s.shoe ? s.shoe : groupShoeRows(res.rows),
                loading: false,
                error: res.error,
            }));
        });
        return () => { cancelled = true; };
    }, [boardKey, asOf]);
    const shoe = shoeState.key === boardKey ? shoeState.shoe : null;

    const patronRow = useMemo(() => patrons.find((p) => p.patron_id === selectedPatronId) || null, [patrons, selectedPatronId]);

    const metricLabel = (RT_METRICS.find((m) => m.id === metric) || RT_METRICS[0]).label;
    const scopeLabel = metric === 'edge' ? 'current shoe' : (RT_SCOPES.find((s) => s.id === scope) || RT_SCOPES[0]).label.toLowerCase();

    const open360 = useCallback((pid) => { setSelectedPatronId(pid); setShow360(true); }, []);

    // A patron seated at a floor-map table opens that table on their seat;
    // anyone else (not seated, or at a game the map doesn't show) goes
    // straight to their Player 360 — never to someone else's seat card.
    const selectPatron = useCallback((pid) => {
        setSelectedPatronId(pid);
        const p = patrons.find((x) => x.patron_id === pid);
        if (p && p.current_table_key && tableByKey.has(p.current_table_key)) setBoardTableKey(p.current_table_key);
        else setShow360(true);
    }, [patrons, tableByKey]);

    const onAlertSelect = useCallback((a) => {
        setSelectedAlertId(a.id);
        // Patron alerts take the same path as clicking the patron in the list.
        if (a.patronId) { selectPatron(a.patronId); setActiveTab('patrons'); return; }
        if (a.tableKey && tableByKey.has(a.tableKey)) setBoardTableKey(a.tableKey);
        setActiveTab(a.rule === 'NEG_EDGE' ? 'rings' : 'tables');
    }, [tableByKey, selectPatron]);

    if (!feed) {
        return (
            <Stack direction="row" spacing={2} sx={{ alignItems: 'center', justifyContent: 'center', height: '100%', color: ACCENT }}>
                <span style={{ width: 26, height: 26, border: '3px solid rgba(122,162,247,0.3)', borderTopColor: ACCENT, borderRadius: '50%', animation: 'rtSpin 0.8s linear infinite' }} />
                <Typography>Connecting to live floor feed…</Typography>
                <style>{'@keyframes rtSpin { to { transform: rotate(360deg); } }'}</style>
            </Stack>
        );
    }

    const degraded = (feed.errors || []).length > 0;
    const legendTitle = `${metricLabel} · ${scopeLabel}`;

    return (
        <Box sx={{
            width: '100%', height: '100%', overflowY: 'auto', boxSizing: 'border-box',
            bgcolor: SURFACE.page,
            scrollbarColor: 'rgba(122,162,247,0.4) rgba(255,255,255,0.04)', scrollbarWidth: 'thin',
        }}>
            <Box sx={{ px: { xs: 1.5, md: 2 }, py: 2, maxWidth: 2400, mx: 'auto' }}>

                {/* ── Header ─────────────────────────────────────── */}
                <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 1, mb: 1.5 }}>
                    <Typography component="h1" sx={{ color: TEXT.primary, fontSize: 22, fontWeight: 800, letterSpacing: 0.3, lineHeight: 1.2 }}>
                        Real-time Floor · Surveillance
                    </Typography>
                    <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center', px: 1.1, py: 0.5, borderRadius: 1, bgcolor: STATE.positiveBg, border: `1px solid ${STATE.positiveBorder}` }}>
                        <FiberManualRecordIcon sx={{ fontSize: 10, color: STATE.positive, animation: pulsing ? 'none' : 'rtPulse 2s infinite' }} />
                        <Typography component="span" sx={{ color: TEXT.secondary, fontSize: 13, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                            {isMockRealtimeFeed() ? 'MOCK' : 'LIVE'} · as of {fmtClock(feed.asOf)}
                        </Typography>
                    </Stack>
                    <Typography sx={{ fontSize: 13, color: TEXT.faint }}>Baccarat tables (BA · NC)</Typography>
                    {degraded ? (
                        <Tooltip title={feed.errors.map((e) => `${e.feed}: ${e.error}`).join(' · ')}>
                            <Typography sx={{ fontSize: 13, color: STATE.warning, fontWeight: 700, cursor: 'help' }}>
                                {feed.errors.length} feed{feed.errors.length === 1 ? '' : 's'} degraded
                            </Typography>
                        </Tooltip>
                    ) : null}
                    <Box sx={{ flex: 1 }} />
                    <RtDropdownSelector label="Auto-refresh" availableOptions={REFRESH_LABELS} selectedOptions={labelForMs(refreshMs)}
                        setSelectedOptions={(v) => setRefreshMs(msForLabel(Array.isArray(v) ? v[0] : v))} multiple={false} width={130} />
                    <style>{`@keyframes rtPulse { 0%,100% { opacity: 1; } 50% { opacity: 0.3; } }
                             @media (prefers-reduced-motion: reduce) { @keyframes rtPulse { 0%,100% { opacity: 1; } } }`}</style>
                </Stack>

                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, alignItems: 'stretch' }}>
                    <RtSummaryTiles tables={filteredTables} patrons={patrons} />
                    <RtAlertBar alerts={alerts} onSelect={onAlertSelect} selectedId={selectedAlertId} />
                </Box>

                {SHOW_SLICERS ? (
                    <Stack direction="row" spacing={1} sx={{ alignItems: 'flex-end', flexWrap: 'wrap', rowGap: 1, mt: 1 }}>
                        <RtDropdownSelector label="Area" availableOptions={options.areas} selectedOptions={selectedArea} setSelectedOptions={setSelectedArea} />
                        <RtDropdownSelector label="Pit" availableOptions={options.pits} selectedOptions={selectedPit} setSelectedOptions={setSelectedPit} />
                        <RtDropdownSelector label="Table Min" availableOptions={options.tableMins} selectedOptions={selectedTableMin} setSelectedOptions={setSelectedTableMin} />
                    </Stack>
                ) : null}

                {/* ── Row 1 · map │ rankings ──────────────────────── */}
                <Box sx={{ mt: 1.5, display: 'grid', gridTemplateColumns: { xs: '1fr', lg: `${MAP_FRACTION}fr ${LEGEND_FRACTION}fr` }, gap: GRID_GAP, alignItems: 'stretch' }}>
                    <Box sx={{ ...raisedPanelSx, p: 1.25, display: 'flex', flexDirection: 'column', gap: 1 }}>
                        <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 1 }}>
                            <Typography sx={systemLabel}>Colour by</Typography>
                            <ToggleButtonGroup exclusive size="small" value={metric} onChange={(_, v) => v && setMetric(v)} aria-label="Map metric" sx={segmentedSx}>
                                {RT_METRICS.map((m) => <ToggleButton key={m.id} value={m.id}>{m.label}</ToggleButton>)}
                            </ToggleButtonGroup>
                            <ToggleButtonGroup exclusive size="small" value={scope} onChange={(_, v) => v && setScope(v)} aria-label="Time scope" sx={segmentedSx}>
                                {RT_SCOPES.map((s) => <ToggleButton key={s.id} value={s.id} disabled={metric === 'edge'}>{s.label}</ToggleButton>)}
                            </ToggleButtonGroup>
                            {metric === 'edge' ? (
                                <RtDropdownSelector label="Bet option" availableOptions={HOUSE_EDGE_BET_LABELS} selectedOptions={betOption}
                                    setSelectedOptions={(v) => setBetOption(Array.isArray(v) ? v[0] : v)} multiple={false} width={140} />
                            ) : null}
                            <Box sx={{ flex: 1 }} />
                            <RingToolbar on={ringsOn} onToggle={() => setRingsOn((v) => !v)} count={rings.size}>
                                <RtRingInfo settings={ringSettings} onOpenSettings={() => setRingDialog(true)} />
                            </RingToolbar>
                        </Stack>
                        <Box sx={{ position: 'relative', width: '100%', aspectRatio: SCATTER_ASPECT, borderRadius: 1.5, overflow: 'hidden', bgcolor: 'rgba(0,0,0,0.18)' }}>
                            {scatter.length ? (
                                <RtFloorMap
                                    data={scatter}
                                    kpiKey={kpiKey}
                                    betOption={betOption}
                                    axisBounds={axisBounds}
                                    seatsByTable={seatsByTable}
                                    inspectedTableKey={boardKey}
                                    onTableClick={setBoardTableKey}
                                    hiddenBands={hiddenBands}
                                    rings={ringsOn ? rings : null}
                                    ringSettings={ringSettings}
                                />
                            ) : (
                                <Stack sx={{ position: 'absolute', inset: 0, alignItems: 'center', justifyContent: 'center' }}>
                                    <Typography sx={{ fontSize: 15, fontWeight: 700, color: TEXT.faint }}>No baccarat tables in the feed</Typography>
                                </Stack>
                            )}
                        </Box>
                        <RtMapLegend
                            title={legendTitle}
                            ramp={ramp}
                            counts={bands.counts}
                            total={bands.total}
                            hidden={hiddenBands}
                            onToggle={toggleBand}
                            onReset={() => setHiddenBands(new Set())}
                        />
                    </Box>
                    {/* Absolute inner box: the panel adds no intrinsic height,
                        so the row is exactly as tall as the map and the
                        rankings scroll inside it. */}
                    <Box sx={{ ...panelSx, position: 'relative', minHeight: { xs: 520, lg: 0 } }}>
                        <Box sx={{ position: 'absolute', inset: 0, p: 1.25, display: 'flex', flexDirection: 'column' }}>
                            <RtTabbedPanel
                                activeTab={activeTab}
                                onTabChange={setActiveTab}
                                tables={filteredTables}
                                rings={rings}
                                ringsOn={ringsOn}
                                patrons={patrons}
                                dealers={dealers}
                                selectedTableKey={boardKey}
                                onSelectTable={setBoardTableKey}
                                selectedPatronId={selectedPatronId}
                                onSelectPatron={selectPatron}
                                alertCounts={counts}
                                scope={scope}
                            />
                        </Box>
                    </Box>
                </Box>

                {/* ── Table focus ─────────────────────────────────── */}
                <Box component="section" aria-label="Selected table" sx={{ ...raisedPanelSx, mt: 1.5, p: 1.75 }}>
                    <RtTableFocus
                        tableKey={boardKey}
                        tableRow={boardKey ? tableByKey.get(boardKey) : null}
                        shoe={shoe}
                        loading={shoeState.loading}
                        error={shoeState.key === boardKey ? shoeState.error : null}
                        seated={boardKey ? seatsByTable.get(boardKey) || EMPTY : EMPTY}
                        ringSettings={ringSettings}
                        tableOptions={tableOptions}
                        onPickTable={setBoardTableKey}
                        preferPlayerId={patronRow && patronRow.current_table_key === boardKey ? selectedPatronId : null}
                        onOpen360={open360}
                    />
                </Box>

                <RtRingSettings open={ringDialog} settings={ringSettings} onChange={setRingSettings} onClose={() => setRingDialog(false)} />

                <RtPatron360
                    open={show360 && !!selectedPatronId}
                    patronId={selectedPatronId}
                    patronRow={patronRow}
                    onClose={() => setShow360(false)}
                />

                {/* ── Floor context (collapsed by default) ─────────── */}
                <Box sx={{ ...panelSx, mt: 1.5 }}>
                    <ButtonBase
                        onClick={() => setShowFloorContext((v) => !v)}
                        aria-expanded={showFloorContext}
                        sx={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'flex-start', gap: 1.5, px: 1.75, py: 1.25, borderRadius: 2, textAlign: 'left' }}
                    >
                        <Typography sx={{ fontSize: 14, fontWeight: 800, color: TEXT.primary }}>Floor context</Typography>
                        <Typography sx={{ fontSize: 13, color: TEXT.faint }}>session trend · betting mix</Typography>
                        <Box sx={{ flex: 1 }} />
                        <ExpandMoreIcon sx={{ color: TEXT.muted, transform: showFloorContext ? 'rotate(180deg)' : 'none', transition: 'transform 180ms' }} />
                    </ButtonBase>
                    <Collapse in={showFloorContext} unmountOnExit>
                        <Box sx={{ px: 1.75, pb: 1.75, display: 'grid', gridTemplateColumns: { xs: '1fr', lg: '6fr 4fr' }, gap: GRID_GAP, alignItems: 'start' }}>
                            <Box>
                                <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between' }}>
                                    <Typography sx={systemLabel}>Session trend · Casino Win vs Casino Theo</Typography>
                                    <RtDropdownSelector label="Bucket" availableOptions={TREND_LABELS} selectedOptions={labelForBucket(trendBucket)}
                                        setSelectedOptions={(v) => setTrendBucket(bucketForLabel(Array.isArray(v) ? v[0] : v))} multiple={false} width={110} />
                                </Stack>
                                <RtTrendChart trend={trend} height={218} />
                            </Box>
                            <Box>
                                <Typography sx={{ ...systemLabel, mb: 1 }}>Floor betting mix</Typography>
                                <RtBetMixPanel betmix={betmix} mode={betMixMode} onModeChange={setBetMixMode} />
                            </Box>
                        </Box>
                    </Collapse>
                </Box>
            </Box>
        </Box>
    );
}
