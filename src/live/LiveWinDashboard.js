// Live Casino Win — top-level dashboard.
// ==========================================
// Three-band layout:
//   1. Header controls        — date, slicers, TopN, sort, refresh cadence
//   2. Main split             — floor heatmap (left) · Top-X + patron card (right)
//   3. Patron deep panel      — hands / by-bet / YTD tabs when a patron is picked
//
// Polling model:
//   • initial fetch on mount + on date change
//   • recurring refresh every `refreshMs` (user-selectable, 0 = manual only)
//   • header Refresh button forces a fetch immediately
//   • click-to-pin flow: table click on the map filters the Top-X list
//     to patrons at that table; patron row click filters the map (via
//     tableRuntime rewrap) and opens the deep panel

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Box, Stack, Typography } from '@mui/material';

import { LIVE_FLOOR_ASPECT } from './constants/floorLayout';
import { CARD_TIERS } from './constants/winPalette';
import { injectLiveFonts, FONT_DISPLAY, FONT_MONO, gradientText, ACCENT } from './constants/liveTheme';

import HeaderControls from './components/HeaderControls';
import LiveFloorHeatmap from './components/LiveFloorHeatmap';
import TopPlayersPanel from './components/TopPlayersPanel';
import Player360Panel from './components/Player360Panel';

import { fetchLive, getDefaultRefreshMs, isMockFeed } from './utils/liveDataSource';
import { tableRuntime, topPatronsPerTable, pickTopX, patronRecentTrajectories, tableKeysPlayedByPatrons, currentSeatOccupancy } from './utils/winAggregates';
import { liveFloorTables } from '../pricing/utils/floorConfig';
import { configGametypes } from '../pricing/utils/floorConfig';

export default function LiveWinDashboard() {
    // Load the dashboard's display + mono fonts once (scoped to /live —
    // the other dashboards keep their default type).
    useEffect(() => { injectLiveFonts(); }, []);

    // ── Filters / view state ─────────────────────────────────────────
    const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
    const [segmentFilter, setSegmentFilter] = useState([]);   // [] = all
    const [cardFilter, setCardFilter] = useState([]);
    const [gameFilter, setGameFilter] = useState([]);
    const [topN, setTopN] = useState(20);
    const [sortBy, setSortBy] = useState('biggestWinner');
    const [selectedPatronId, setSelectedPatronId] = useState(null);
    // Highlight overlay — when on, the scatter draws a yellow rectangle
    // around every table played by any patron currently in the ranked
    // right-side list. Switching tabs (winners → losers → tier → avg
    // bet) automatically shifts the highlighted set.
    const [highlightOn, setHighlightOn] = useState(false);
    const [refreshMs, setRefreshMs] = useState(getDefaultRefreshMs());

    // ── Feed state ───────────────────────────────────────────────────
    const [feed, setFeed] = useState(null);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState(null);

    const refreshTimer = useRef(null);
    const inflight = useRef(false);

    const doFetch = useCallback(async () => {
        if (inflight.current) return;
        inflight.current = true;
        setIsLoading(true);
        try {
            const data = await fetchLive({ date });
            setFeed(data);
            setError(null);
        } catch (e) {
            setError(e?.message || String(e));
        } finally {
            setIsLoading(false);
            inflight.current = false;
        }
    }, [date]);

    // Initial + on-date-change fetch.
    useEffect(() => { doFetch(); }, [doFetch]);

    // Polling interval.
    useEffect(() => {
        if (refreshTimer.current) clearInterval(refreshTimer.current);
        if (refreshMs > 0) refreshTimer.current = setInterval(doFetch, refreshMs);
        return () => { if (refreshTimer.current) clearInterval(refreshTimer.current); };
    }, [refreshMs, doFetch]);

    // Reset the patron pin when date changes — a patron from yesterday
    // wouldn't make sense against today's live rounds.
    useEffect(() => { setSelectedPatronId(null); }, [date]);

    // ── Derived selectors ────────────────────────────────────────────
    const tables = useMemo(() => liveFloorTables(date), [date]);
    const gametypes = useMemo(() => configGametypes(), []);

    // Filter the tables by segment/game selection — that pre-narrowed set
    // drives BOTH the heatmap and the patron rollup, so the counts stay
    // consistent with what the operator sees on the map.
    const visibleTableKeys = useMemo(() => {
        const segSet = segmentFilter.length ? new Set(segmentFilter) : null;
        const gameSet = gameFilter.length ? new Set(gameFilter) : null;
        const set = new Set();
        for (const t of tables) {
            if (segSet && !segSet.has(t.segment)) continue;
            if (gameSet && !gameSet.has(t.gametype)) continue;
            set.add(t.key);
        }
        return set;
    }, [tables, segmentFilter, gameFilter]);

    // Rounds restricted to visible tables (segment/game slicer applies to
    // downstream aggregates too).
    const visibleRounds = useMemo(() => {
        if (!feed) return [];
        if (visibleTableKeys.size === tables.length) return feed.rounds;
        return feed.rounds.filter((r) => visibleTableKeys.has(r.tableKey));
    }, [feed, visibleTableKeys, tables.length]);

    const patronMeta = useMemo(() => {
        const m = new Map();
        for (const p of feed?.patrons || []) m.set(p.patronId, p);
        return m;
    }, [feed]);

    // Patrons — with slicers + a "hands > 0 within visible tables" derived
    // rollup, so filtering by game/segment actually reshapes the list.
    const patronsForList = useMemo(() => {
        if (!feed) return [];
        // Re-tally against visibleRounds so game/segment slicers reshape stats.
        const per = new Map();
        for (const p of feed.patrons) per.set(p.patronId, { ...p, cumWin: 0, cumWager: 0, hands: 0, tables: new Set() });
        for (const r of visibleRounds) {
            const e = per.get(r.patronId);
            if (!e) continue;
            e.cumWin  += Number(r.winLoss) || 0;
            e.cumWager+= Number(r.wager)   || 0;
            e.hands   += 1;
            e.tables.add(r.tableKey);
        }
        const arr = [...per.values()].map((p) => ({ ...p, tablesPlayed: p.tables.size }));
        return pickTopX(arr, {
            sort: sortBy, limit: topN,
            cardFilter: cardFilter.length ? new Set(cardFilter) : null,
            segmentFilter: segmentFilter.length ? new Set(segmentFilter) : null,
        });
    }, [feed, visibleRounds, sortBy, topN, cardFilter, segmentFilter]);

    // Table-runtime map used by the heatmap. If a patron is pinned, we
    // re-project cumWin per table to that patron ONLY.
    const patronFilter = useMemo(() => selectedPatronId ? new Set([selectedPatronId]) : null, [selectedPatronId]);
    const tableRuntimeMap = useMemo(() => {
        if (!feed) return new Map();
        return tableRuntime(feed.tables, visibleRounds, patronFilter);
    }, [feed, visibleRounds, patronFilter]);

    const topPatrons = useMemo(() => {
        if (!feed) return new Map();
        return topPatronsPerTable(visibleRounds, patronMeta, 3);
    }, [feed, visibleRounds, patronMeta]);

    // Rolling 1-hour cumWL trajectories — used for the sparkline column in
    // the Top-X list. Refreshes on every feed tick so the shapes track live.
    const rowTrajectories = useMemo(() => {
        if (!feed) return new Map();
        return patronRecentTrajectories(visibleRounds, { nowIso: feed.asOf, windowMinutes: 60, buckets: 12 });
    }, [feed, visibleRounds]);

    // Highlight overlay set — the union of tables played by any patron
    // currently in the ranked list. Empty when the toggle is off, so
    // the scatter draws no overlay at all in that case.
    const highlightedTableKeys = useMemo(() => {
        if (!highlightOn) return null;
        const ids = patronsForList.slice(0, topN).map((p) => p.patronId);
        return tableKeysPlayedByPatrons(visibleRounds, ids);
    }, [highlightOn, patronsForList, topN, visibleRounds]);

    const selectedPatron = selectedPatronId ? patronMeta.get(selectedPatronId) : null;

    // All active patron ids — the population baseline for the Player 360
    // behavioral radar ("this player vs the average VIP").
    const allPatronIds = useMemo(() => (feed?.patrons || []).map((p) => p.patronId), [feed]);

    // Who is sitting where RIGHT NOW — drives the floor map's "seats"
    // tooltip style (table shape + occupied seat circles).
    const seatOccupancy = useMemo(() => {
        if (!feed) return new Map();
        return currentSeatOccupancy(visibleRounds, patronMeta);
    }, [feed, visibleRounds, patronMeta]);

    // ── Handlers ─────────────────────────────────────────────────────
    const handleTableClick = useCallback((tableKey) => {
        // Table click sets a lightweight filter — biggest patron winners
        // AT that table only. Kept simple for MVP: reset the topN sort
        // and set gameFilter to just that game as a proxy narrowing. A
        // later phase can add a dedicated tableFilter.
        // For now, we short-circuit by finding the top patron on that
        // table and pinning them — the most intuitive "who's driving this
        // number" answer for ops.
        const list = topPatrons.get(tableKey) || [];
        if (list.length) setSelectedPatronId(list[0].patronId);
    }, [topPatrons]);

    const handleSelectPatron = useCallback((patronId) => {
        setSelectedPatronId(patronId);
    }, []);

    // ── Layout ───────────────────────────────────────────────────────
    return (
        <Box sx={{
            p: 1.4,
            display: 'flex', flexDirection: 'column', gap: 1.2,
            width: '100%',
            // App.js clips each route (overflow:hidden), so every dashboard
            // must own its scrolling. `overflowY: scroll` (not auto) +
            // scrollbarGutter keep the gutter PERMANENTLY reserved — with
            // `auto`, pinning a patron made the scrollbar appear, stole
            // ~10px of width, and visibly resized the aspect-locked map
            // and the table. Reserving the gutter up front means layout
            // never shifts no matter what content mounts below.
            height: '100%', overflowY: 'scroll', scrollbarGutter: 'stable',
            scrollbarColor: 'rgba(122,223,255,0.35) rgba(255,255,255,0.04)', scrollbarWidth: 'thin',
            '&::-webkit-scrollbar': { width: 10 },
            '&::-webkit-scrollbar-track': { bgcolor: 'rgba(255,255,255,0.03)' },
            '&::-webkit-scrollbar-thumb': { bgcolor: 'rgba(122,223,255,0.35)', borderRadius: 4, border: '2px solid transparent', backgroundClip: 'padding-box' },
            bgcolor: 'rgba(6, 12, 22, 0.6)',
            fontFamily: FONT_DISPLAY,
        }}>
            <Stack direction="row" alignItems="baseline" spacing={1.4} sx={{ px: 0.2, flexShrink: 0 }}>
                <Typography sx={{ ...gradientText, fontSize: 26, fontWeight: 700, letterSpacing: 2.5, textTransform: 'uppercase', lineHeight: 1 }}>
                    Live Casino Win
                </Typography>
                <Stack direction="row" alignItems="center" spacing={0.6} sx={{ transform: 'translateY(-2px)' }}>
                    <Box sx={{ width: 7, height: 7, borderRadius: '50%', bgcolor: ACCENT, boxShadow: `0 0 8px ${ACCENT}`, animation: 'livePulse 2s infinite' }} />
                    <Typography sx={{ fontFamily: FONT_MONO, color: 'rgba(202,232,255,0.5)', fontSize: 11, fontWeight: 600, letterSpacing: 1.2, textTransform: 'uppercase' }}>
                        {isMockFeed() ? 'mock feed' : 'live feed'}
                    </Typography>
                </Stack>
                {error && <Typography sx={{ color: '#ff7a7a', fontSize: 12, ml: 2, fontFamily: FONT_MONO }}>· {error}</Typography>}
                <style>{`@keyframes livePulse { 0%,100% { opacity: 1; } 50% { opacity: 0.3; } }
                         @media (prefers-reduced-motion: reduce) { @keyframes livePulse { 0%,100% { opacity: 1; } 50% { opacity: 1; } } }`}</style>
            </Stack>

            {/* flexShrink:0 on every direct child below is load-bearing, not
                decorative: per the flexbox spec, a flex item whose OWN
                overflow is non-'visible' (several children here, and
                PatronInsightPanel especially, use overflow:hidden to clip
                rounded corners) gets an automatic min-height of 0. Without
                flexShrink:0 the column silently compresses those children
                to fit the viewport instead of overflowing — which is
                exactly what was clipping the insight panel and making the
                page look unscrollable. */}
            <Box sx={{ flexShrink: 0 }}>
                <HeaderControls
                    date={date} onDateChange={setDate}
                    segments={['MS', 'PM']} segmentFilter={segmentFilter} onSegmentFilter={setSegmentFilter}
                    cardTiers={Object.keys(CARD_TIERS)} cardFilter={cardFilter} onCardFilter={setCardFilter}
                    gametypes={gametypes} gameFilter={gameFilter} onGameFilter={setGameFilter}
                    refreshMs={refreshMs} onRefreshMs={setRefreshMs}
                    topN={topN} onTopN={setTopN}
                    asOf={feed?.asOf} onManualRefresh={doFetch} isLoading={isLoading}
                    selectedPatron={selectedPatron}
                    onClearPatron={() => setSelectedPatronId(null)}
                />
            </Box>

            {/* Row 1 — scatter map (2/3) + ranked players (1/3) on ONE row.
                The heatmap's aspect ratio sets the row height; the right
                cell is absolutely-positioned inside a same-height wrapper
                so it can NEVER stretch the row — its rows scroll inside. */}
            <Box sx={{
                display: 'grid',
                gridTemplateColumns: { xs: '1fr', lg: '2fr 1fr' },
                gap: 1.2,
                alignItems: 'stretch',
                flexShrink: 0,
            }}>
                <Box sx={{ position: 'relative', width: '100%', aspectRatio: LIVE_FLOOR_ASPECT, minWidth: 0 }}>
                    <LiveFloorHeatmap
                        tables={tables.filter((t) => visibleTableKeys.has(t.key))}
                        tableRuntime={tableRuntimeMap}
                        topPatrons={topPatrons}
                        seatOccupancy={seatOccupancy}
                        highlightedTableKeys={highlightedTableKeys}
                        onTableClick={handleTableClick}
                        selectedPatron={selectedPatron?.patronId || null}
                    />
                </Box>
                <Box sx={{ position: 'relative', minWidth: 0, minHeight: { xs: 420, lg: 0 } }}>
                    <Box sx={{ position: { xs: 'static', lg: 'absolute' }, inset: { lg: 0 }, display: 'flex', height: { xs: '100%', lg: 'auto' } }}>
                        <TopPlayersPanel
                            patrons={patronsForList}
                            topN={topN}
                            sortBy={sortBy} onSortBy={setSortBy}
                            selectedPatronId={selectedPatronId}
                            onSelectPatron={handleSelectPatron}
                            trajectories={rowTrajectories}
                            highlightOn={highlightOn}
                            onHighlightToggle={() => setHighlightOn((v) => !v)}
                        />
                    </Box>
                </Box>
            </Box>

            {/* Row 2 — Player 360 detail workspace (identity bar + Financial /
                Behavioral / Preferences / Shoes tabs). flexShrink:0 here is
                the fix for the "can't scroll" bug — see the comment above
                HeaderControls. */}
            <Box sx={{ flexShrink: 0 }}>
                <Player360Panel
                    patron={selectedPatron}
                    rounds={visibleRounds}
                    allPatronIds={allPatronIds}
                />
            </Box>
        </Box>
    );
}
