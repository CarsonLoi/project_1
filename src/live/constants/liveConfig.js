// Live Casino Win — MASTER TUNING FILE.
// ======================================
// Every adjustable knob for the /live dashboard lives HERE, in one
// place: font families, the full font-size scale, colors, floor
// geometry, chart heights, roadmap + seat-map dimensions, refresh
// cadences. The other constants files (fontSizes.js, floorLayout.js,
// liveTheme.js) re-export from this one, so existing imports keep
// working — but to tune anything, edit THIS file only.

// ── Type system ─────────────────────────────────────────────────────
export const FONT_DISPLAY = '"Rajdhani", "Segoe UI Semibold", sans-serif';
export const FONT_MONO = '"IBM Plex Mono", "Cascadia Mono", Consolas, monospace';

// Google-Fonts stylesheet loaded for the two families above.
export const FONT_URL = 'https://fonts.googleapis.com/css2?family=Rajdhani:wght@500;600;700&family=IBM+Plex+Mono:wght@400;500;600;700&display=swap';

// Font-size scale (px) — grouped by dashboard area.
export const TYPE_SCALE = {
    header: { title: 15, section: 13, badge: 11, meta: 11 },
    floorMap: { vmLabel: 11, legend: 11, overlayDate: 12 },
    topX: { header: 12, rank: 13, id: 13, card: 10, cell: 12, cellStrong: 13 },
    patronCard: { heading: 15, label: 11, value: 13, valueLarge: 22, sessionCell: 12 },
    deep: { tab: 12, head: 11, cell: 12, cellStrong: 13, total: 13 },
    pageTitle: 26,
    sectionLabel: 11.5,
    kpiValue: 20,
    idStatValue: 15,
    tabLabel: 13,
};

// ── Colors ──────────────────────────────────────────────────────────
export const ACCENT = '#7adfff';     // primary cyan
export const ACCENT_2 = '#b18aff';   // violet (gradients)
export const AMBER = '#F59E0B';      // warnings / gold highlights
export const SPEC = {                // chart spec palette
    blue: '#3B82F6', green: '#10B981', red: '#EF4444', gold: '#F59E0B', cyan: '#7adfff',
};

// ── Floor scatter geometry ──────────────────────────────────────────
export const LIVE_FLOOR_ASPECT_W = 1500;
export const LIVE_FLOOR_ASPECT_H = 723;
export const LIVE_FLOOR_X_MIN = 40;
export const LIVE_FLOOR_X_MAX = 1000;
export const LIVE_FLOOR_Y_MIN = 40;
export const LIVE_FLOOR_Y_MAX = 280;
export const LIVE_SYMBOL_SIZE_DEFAULT = 2;
export const LIVE_SYMBOL_SIZE_MIN = 0.5;
export const LIVE_SYMBOL_SIZE_MAX = 4;
export const LIVE_SYMBOL_SIZE_STEP = 0.1;

// ── Chart heights (px) — Player 360 tabs ───────────────────────────
export const CHART_H = {
    trajectory: 250,
    gauge: 210,
    radar: 280,
    betScatter: 280,
    dealerBars: 280,
    sunburst: 320,
    seatPref: 320,
    bigRoad: 200,
    bankroll: 200,
    shoeDepth: 180,
};

// ── Big Road roadmap ────────────────────────────────────────────────
export const BIG_ROAD = {
    ROWS: 6,            // classic scoreboard = 6 rows
    BEAD: 20,           // ring diameter (px)
    RING_WIDTH: 3,      // hollow-ring stroke
    WAGER_LABEL_SIZE: 8.5, // gold wager text under patron-bet hands
};

// ── Seat-map tooltip (floor hover) ──────────────────────────────────
export const SEAT_TOOLTIP = {
    SEATS: 7,           // positions per table
    WIDTH: 260,         // tooltip svg width (px)
    HEIGHT: 165,
    SEAT_R: 20,         // seat circle radius
    ARC_R: 96,          // seat ring radius from table center
    FONT: 8,            // text size inside seats
};

// ── Live data cadence ───────────────────────────────────────────────
export const REFRESH_OPTIONS = [
    { v: 5_000, label: '5 sec' },
    { v: 10_000, label: '10 sec' },
    { v: 30_000, label: '30 sec' },
    { v: 60_000, label: '1 min' },
    { v: 300_000, label: '5 min' },
    { v: 0, label: 'Manual only' },
];
export const TOPX_OPTIONS = [10, 20, 50, 100];
