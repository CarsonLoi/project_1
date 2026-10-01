// Real-time Floor dashboard — MASTER TUNING FILE.
// ================================================
// Every adjustable knob for /realtime lives here: font sizes, the scatter
// geometry (aspect ratio, axis bounds, symbol size), the map/legend width
// split, tooltip dimensions, refresh cadences, and the KPI list. This
// module is fully self-contained — /realtime does NOT import from any
// other dashboard, so you can add or drop KPIs / retune sizes here without
// affecting the Performance, Hotel, Live, or other dashboards.

// ── Font sizes ──────────────────────────────────────────────────────
// Kept under the `PERF_FONTS` name so the vendored scatter + legend
// components consume it unchanged. Edit the numbers freely.
export const PERF_FONTS = {
    scatter: {
        title: 18,
        titleAvg: 20,
        axisLabel: 13,
        tooltip: 14,        // hover tooltip body
        visualMap: 13,      // in-map color legend labels
        timeline: 13,
    },
    legend: {
        title: '1.1rem',    // panel title
        header: '0.95rem',  // column headers
        body: '1.0rem',     // data cells
    },
    // Dashboard chrome (title / status / control labels).
    pageTitle: 20,
    statusText: 12,
    sectionLabel: 11,
};

// ── Scatter geometry ────────────────────────────────────────────────
// Keep the map at a fixed width : height ratio. Change these two to
// reshape the box (default 1500 × 723 — matches the other dashboards).
export const SCATTER_ASPECT_W = 1500;
export const SCATTER_ASPECT_H = 723;
export const SCATTER_ASPECT = `${SCATTER_ASPECT_W} / ${SCATTER_ASPECT_H}`;

// ECharts axis bounds the table x/y positions map into.
export const SCATTER_X_MIN = 0;
export const SCATTER_X_MAX = 1100;
export const SCATTER_Y_MIN = 0;
export const SCATTER_Y_MAX = 1100;

// Table-symbol scale multiplier.
export const SCATTER_SYMBOL_SIZE_MULTIPLIER = 2;

// Plot padding inside the scatter box.
export const SCATTER_GRID = { left: '2%', right: '2%', top: '3%', bottom: '3%', containLabel: false };

// ── Map / legend split ──────────────────────────────────────────────
// Row is `MAP_FRACTION : LEGEND_FRACTION`. Default 62 / 38 — bump
// LEGEND_FRACTION if the legend needs more room for its columns.
export const MAP_FRACTION = 70;     // 70%
export const LEGEND_FRACTION = 30;  // 30%
export const GRID_GAP = 1.4;        // MUI spacing units between map + legend

// ── Tooltip ─────────────────────────────────────────────────────────
export const TOOLTIP = {
    detailMinWidth: 460,   // 2-column detail grid
    simpleMinWidth: 200,   // compact single-KPI card
    headerFontSize: 16,
    bodyFontSize: 13,
};

// ── Live cadence ────────────────────────────────────────────────────
export const REFRESH_OPTIONS = [
    { v: 5000, label: '5 sec' },
    { v: 10000, label: '10 sec' },
    { v: 30000, label: '30 sec' },
    { v: 60000, label: '1 min' },
    { v: 300000, label: '5 min' },
];
export const DEFAULT_REFRESH_MS = 10000;

// The gaming-day boundary used by the synthetic accumulation model.
export const GAMING_DAY_START_HOUR = 7;

// ── KPI list ────────────────────────────────────────────────────────
// SURVEILLANCE KPI set. This dashboard's job is game protection, not
// floor productivity — it asks "is this table behaving?", not "is this
// table busy?". The old Performance-inherited productivity KPIs
// (occupancy, hands/hour, open %, patron hours) were dropped; what
// remains is on-day result, current-shoe result, and live house edge.
//
// Each entry needs a threshold ramp in vendor/heatmapConstants.js and
// a dim slot in RT_KPI_DIMS below.
export const RT_KPI_OPTIONS = [
    // Day cumulative
    'Win (Total)', 'Theo (Total)', 'Variance', 'Turnover (Total)', 'Hold %', 'Avgbet',
    // Current shoe
    'Shoe Win', 'Shoe Theo', 'Shoe Variance', 'Shoe Turnover', 'Shoe Hands', 'Hands Today', 'Idle Minutes',
    // Live edge
    'Actual House Edge',
    // Context
    'Gametype', 'Table minimum', 'Avg Headcount (10m)',
];
export const DEFAULT_KPI = 'Variance';

// Map toolbar: three metrics × two scopes replace the old KPI dropdown.
export const RT_METRICS = [
    { id: 'win', label: 'Casino Win' },
    { id: 'hands', label: 'Hand #' },
    { id: 'edge', label: 'House edge' },
];
export const RT_SCOPES = [
    { id: 'day', label: 'Today' },
    { id: 'shoe', label: 'Current shoe' },
];
// House edge only exists per shoe, so both scopes resolve to the same
// live value; the toolbar says so.
const KPI_BY_METRIC_SCOPE = {
    win: { day: 'Win (Total)', shoe: 'Shoe Win' },
    hands: { day: 'Hands Today', shoe: 'Shoe Hands' },
    edge: { day: 'Actual House Edge', shoe: 'Actual House Edge' },
};
export function kpiKeyFor(metric, scope) {
    const m = KPI_BY_METRIC_SCOPE[metric] || KPI_BY_METRIC_SCOPE.win;
    return scope === 'shoe' ? m.shoe : m.day;
}

// KPI → scatter-tuple dim. Slots 0..53 are the original layout (kept
// intact so the vendored renderer and its brush/visualMap logic are
// unchanged); 54+ are the surveillance additions appended by
// vendor/dataProcessing.js. See the tuple assembly there.
export const RT_KPI_DIMS = {
    'Win (Total)': 18,
    'Theo (Total)': 22,
    'Avgbet': 15,
    'Table minimum': 14,
    'Gametype': 3,
    // ── appended surveillance slots ──
    'Turnover (Total)': 54,
    'Variance': 55,
    'Hold %': 56,
    'Shoe Win': 57,
    'Shoe Theo': 58,
    'Shoe Variance': 59,
    'Shoe Turnover': 60,
    'Shoe Hands': 61,
    'Shoe Duration': 62,
    'Idle Minutes': 63,
    'Avg Headcount (10m)': 64,
    'Hands Today': 65,
};

// KPIs rendered as a percentage rather than a currency/count value.
export const RT_PERCENT_KPIS = new Set(['Hold %', 'Actual House Edge']);
// KPIs that are counts of tables rather than an averaged value — the
// legend's trailing row switches from "Overall Avg" to "Total Tables".
export const RT_COUNT_KPIS = new Set(['Gametype', 'Table minimum']);
// KPIs that are diverging (meaningfully negative) — the ranking panels
// sort these ascending so the worst offender is at the top.
export const RT_DIVERGING_KPIS = new Set([
    'Variance', 'Shoe Variance', 'Win (Total)', 'Shoe Win', 'Actual House Edge',
]);

// Default tooltip style: 'detail' (full KPI grid) or 'simple'.
export const DEFAULT_TOOLTIP_MODE = 'detail';

// ── Actual House Edge — bet-option sub-dropdown ───────────────────────
// Shown only when KPI = "Actual House Edge". `key` matches the live
// feed's `house_edge_<key>` column suffix (see realtimeData.js /
// vendor/dataProcessing.js); `dim` is the scatter-tuple slot that
// carries that bet option's value (see dataProcessing.js's tuple
// assembly, slots 40-51). "Lowest" surfaces whichever bet currently
// shows the smallest true edge for each table.
export const HOUSE_EDGE_OPTIONS = [
    { key: 'banker',   label: 'Banker',   dim: 40 },
    { key: 'player',   label: 'Player',   dim: 41 },
    { key: 'tie',      label: 'Tie',      dim: 42 },
    { key: 'btg',      label: 'BTG',      dim: 43 },
    { key: 'stg',      label: 'STG',      dim: 44 },
    { key: 'sl7',      label: 'SL7',      dim: 45 },
    { key: 'bd',       label: 'BD',       dim: 46 },
    { key: 'sd',       label: 'SD',       dim: 47 },
    { key: 'mnm',      label: 'MNM',      dim: 48 },
    { key: 'pairplus', label: 'PairPlus', dim: 49 },
    { key: 'ppl',      label: 'PPL',      dim: 67 },
    { key: 'l6',       label: 'L6',       dim: 68 },
    { key: 'lowest',   label: 'Lowest',   dim: 50, betLabelDim: 51 },
];
export const DEFAULT_HOUSE_EDGE_BET = 'Lowest';

// ── Legend table — segment columns ────────────────────────────────────
// The legend's columns are the floor's sub_segments (e.g. "Main", "VIP").
// This list is the SINGLE source of truth for which segments appear and
// in what order — a segment only shows up here if it's listed, in this
// exact left-to-right order, regardless of what other sub_segments exist
// in the underlying data. Add/remove/reorder entries to change the
// legend without touching any component code.
export const RT_LEGEND_SEGMENTS = ['883', 'PM', 'Main', 'MSC', 'Slots', 'VIP'];

// ── API endpoints ─────────────────────────────────────────────────────
// Six endpoints, all shaped exactly as documented in
// docs/realtime-surveillance-data-contract.md. Each resolves from its
// own env var so they can live on different hosts; where an env var is
// unset the data layer synthesises that feed from the bundled mock and
// the dashboard still runs end-to-end offline.
//
// REACT_APP_REALTIME_API_URL is the one pre-existing var — the other
// five default to sibling paths on the same origin when it is set, so
// a standard deployment only needs to configure the one.
const RT_BASE = process.env.REACT_APP_REALTIME_API_URL || null;
const sibling = (path) => (RT_BASE ? RT_BASE.replace(/\/[^/]*$/, '') + path : null);

export const RT_ENDPOINTS = {
    tables: RT_BASE,
    patrons: process.env.REACT_APP_RT_PATRONS_URL || sibling('/patrons'),
    betmix: process.env.REACT_APP_RT_BETMIX_URL || sibling('/betmix'),
    dealers: process.env.REACT_APP_RT_DEALERS_URL || sibling('/dealers'),
    trend: process.env.REACT_APP_RT_TREND_URL || sibling('/trend'),
    // `{id}` is substituted at call time.
    patronDetail: process.env.REACT_APP_RT_PATRON_DETAIL_URL || sibling('/patron/{id}'),
    // Hand-level feed for ONE table's current shoe (§7 of the contract).
    shoe: process.env.REACT_APP_RT_SHOE_URL || sibling('/shoe'),
    // Year-to-date bets for ONE patron (§8 of the contract), fetched when
    // the Player 360 opens. `{id}` is substituted at call time.
    patronBets: process.env.REACT_APP_RT_PATRON_BETS_URL || sibling('/patron/{id}/bets'),
    // Live edge for every hand of every shoe ONE patron played (§9).
    patronShoeEdges: process.env.REACT_APP_RT_PATRON_SHOE_EDGES_URL || sibling('/patron/{id}/shoe-edges'),
};

// Per-request timeout. The poll loop skips a tick rather than queueing
// when a request is still inflight, so this only bounds a single fetch.
export const RT_FETCH_TIMEOUT_MS = 20000;

// ── Trend chart ───────────────────────────────────────────────────────
export const TREND_BUCKET_OPTIONS = [
    { v: '5m', label: '5 min' },
    { v: '15m', label: '15 min' },
    { v: '30m', label: '30 min' },
    { v: '1h', label: '1 hour' },
];
export const DEFAULT_TREND_BUCKET = '15m';

// ── Surveillance alert rules ──────────────────────────────────────────
// Thresholds live here so they can be tuned without touching the rule
// logic in utils/alertEngine.js.
//
// The `minHands` guards are load-bearing, not defensive padding: early
// in a gaming day a table may have dealt a handful of hands, and one
// lucky shoe will blow past any dollar threshold. Without the guard the
// strip fills with noise every morning and operators learn to ignore
// it, which is the failure mode that kills alerting systems.
export const ALERT_RULES = {
    // Live true edge has gone negative on any bet option — the shoe now
    // favours the player. The primary advantage-play signal.
    NEG_EDGE: {
        label: 'NEG EDGE',
        edgeBelow: 0,
        minShoeHands: 10,
    },
    // Table is down beyond tolerance on the day.
    TABLE_LOSS: {
        label: 'TABLE LOSS',
        winBelow: -250000,
        minHands: 20,
    },
    // Individual patron is up beyond tolerance.
    PATRON_WIN: {
        label: 'PATRON WIN',
        // Contract is casino-perspective, so a patron winning is a
        // NEGATIVE cum_win. See §0 of the data contract.
        cumWinBelow: -200000,
        minHands: 20,
    },
    // Bet-spread — flat betting until the count turns, then a large
    // jump. The classic card-counting tell.
    //
    // NOTE ON THE NUMBER: surveillance usually talks about "spread" as
    // max bet ÷ min bet, where 8-12x describes an aggressive counter.
    // That is NOT what this tests. The contract supplies bet_stdev and
    // avg_bet, so the computed value is the COEFFICIENT OF VARIATION
    // (stdev ÷ mean), which lives on a completely different scale:
    //
    //   bets 1 unit 70% of hands, 12 units 30%   (a 12x spread)
    //   → mean 4.3, stdev 5.04, CV = 1.17
    //
    // So a CV above ~1.5 is already extreme, and a threshold of 8 would
    // never fire on any real player. Values here are CV, not bet ratio.
    //   ~0.1-0.3  flat bettor
    //   ~0.4-0.8  ordinary varied betting
    //   ~1.0-1.5+ aggressive spreading — worth a look
    // PREFERRED: if the patron feed supplies min_bet and max_bet, the
    // engine uses the true max÷min spread instead, which is the metric
    // surveillance actually works to. Player360Panel already computes and
    // displays this with a 15:1 trigger, so the threshold below matches
    // it — one number, one meaning, across both surfaces.
    BET_SPREAD: {
        label: 'BET SPREAD',
        trueRatioAbove: 15,   // used when min_bet/max_bet are supplied
        ratioAbove: 1.5,      // CV fallback when they are not
        minHands: 30,
    },
};

// Severity ordering for the alert strip — lower sorts first.
export const ALERT_SEVERITY = {
    NEG_EDGE: 0,
    BET_SPREAD: 1,
    TABLE_LOSS: 2,
    PATRON_WIN: 3,
};

// Max alerts rendered in the strip before it collapses to a count.
export const ALERT_STRIP_MAX = 12;

// ── Ranking panel tabs ────────────────────────────────────────────────
// The right-hand container. `id` is internal, `label` is the tab text.
// Order here is tab order. Removing an entry removes the tab.
export const RT_TABS = [
    { id: 'tables', label: 'Table W/L' },
    { id: 'rings', label: 'Edge rings' },
    { id: 'patrons', label: 'Patrons' },
    { id: 'dealers', label: 'Dealers' },
];
export const DEFAULT_TAB = 'tables';

// Rows shown in each ranking list before scrolling.
export const RANKING_ROWS = 12;

// ── Surveillance redesign ─────────────────────────────────────────────
// Area / Pit / Game / Table Min dropdowns are hidden, not deleted: flip
// SHOW_SLICERS to bring them back. Game is still applied while hidden,
// fixed to the two baccarat codes surveillance watches.
export const SHOW_SLICERS = false;
export const FIXED_GAMES = ['BA', 'NC'];

// Shoe board thresholds.
export const SHOE_BOARD = {
    // A hand whose house result is at or below this gets a red edge in
    // the hand list.
    BIG_HAND_LOSS: -20000,
};

// ── Player 360 ────────────────────────────────────────────────────────
// Side-bet advantage review. BET_OPTIONS drives every chip, colour and
// edge column: `edgeKey` → shoe-edges column house_edge_<edgeKey>;
// `theo` → nominal house edge % (the dashed theo line); `var` → result
// variance per unit stake (luck z-score). Banker/Player/Tie are 8-deck
// figures; SIDE-BET theo/var ARE PLACEHOLDERS — set them from the
// casino's pay tables.
export const PATRON_360 = {
    BET_OPTIONS: [
        { code: 'BANKER', name: 'Banker', edgeKey: 'banker', side: false, color: '#ff4d4d', theo: 1.06, var: 0.86 },
        { code: 'PLAYER', name: 'Player', edgeKey: 'player', side: false, color: '#4d7cff', theo: 1.24, var: 0.905 },
        { code: 'TIE', name: 'Tie', edgeKey: 'tie', side: true, color: '#22a95a', theo: 14.36, var: 6.98 },
        { code: 'BTG', name: 'BTG', edgeKey: 'btg', side: true, color: '#f59e0b', theo: 4.0, var: 12 },
        { code: 'STG', name: 'STG', edgeKey: 'stg', side: true, color: '#a855f7', theo: 4.0, var: 20 },
        { code: 'BD', name: 'BD', edgeKey: 'bd', side: true, color: '#d9776f', theo: 2.65, var: 5 },
        { code: 'SD', name: 'SD', edgeKey: 'sd', side: true, color: '#3cc7c0', theo: 3.0, var: 5 },
        { code: 'SL7', name: 'Super Lucky 7', edgeKey: 'sl7', side: true, color: '#d4ac3a', theo: 14.8, var: 30 },
        { code: 'PPL', name: 'PPL', edgeKey: 'ppl', side: true, color: '#ff4fb0', theo: 10.36, var: 10 },
        { code: 'L6', name: 'L6', edgeKey: 'l6', side: true, color: '#b07a4a', theo: 13.0, var: 12 },
    ],
    // Minimum samples guard every test — a handful of lucky hands must
    // never read as advantage play.
    TESTS: {
        entry: { watch: 2, flag: 4, minNegHands: 10, minPosHands: 10, minBets: 5 },
        ramp: { watch: 1.5, flag: 2.5, minEach: 5 },
        money: { watch: 1.5, flag: 2.5, minBets: 10, minNegHands: 10 },
        luck: { watch: 2, flag: 3, minBets: 30 },
    },
    // A flag on any of these alone means ACTION.
    COUNTING_TESTS: ['entry', 'ramp', 'money'],
    DEFAULT_RANGE: 'ytd',
    HEATMAP_INITIAL_ROWS: 40,
    MAX_SELECTED_SHOES: 8,
};
