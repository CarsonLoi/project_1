// Hotel Segment Heatmap — tuning + panel definitions.
// ====================================================
// One place to adjust the small-multiples layout, the segment
// definitions, the slicer option lists, the KPI list, and every
// threshold ramp. Nothing in HotelDashboard.js / hotelData.js should
// hardcode a magic number that belongs here.
//
// ── Raw feed grain ──────────────────────────────────────────────────
// The API (REACT_APP_HOTEL_API_URL, endpoint name ends `_hotel_data`)
// returns ONE ROW PER (date, table, player_id) — but a table that had NO
// PLAY on a given date still emits exactly one row for that (date,table)
// so the table-day facts (floorday/openday/openhours/table_min) aren't
// lost: on that row every PLAYER field is null (id, card, region, age,
// sex, turnover, theo_win, casino_win, patron_hands, secondsplayed) and
// every is_* hotel flag is 0. See hotelData.js's `hasPlay` gate — this is
// the field that separates "table-day fact" aggregation (floorday/
// openday/openhours, counted off EVERY row) from "patron fact"
// aggregation (turnover/theo_win/casino_win/patron_hands/secondsplayed/
// playday, counted off rows where hasPlay is true only).
//
// Full row shape:
//   date, id, segment ('MS'|'PM'), sub_segment, pit, table, game,
//   dow ('WD'|'Fri'|'Sat'|'Sun'), table_min,
//   floorday, openday, openhours,
//   region, age (number), sex ('M'|'F'), card (opaque tier code, or 'Other'),
//   turnover, casino_win, theo_win, patron_hands, secondsplayed,
//   is_celebrity, is_epic, is_star, is_whotel, is_no_room  (0/1 flags)
//
// IMPORTANT — floorday, openday and openhours are TABLE-DATE-level facts
// duplicated onto every row for that (table, date) (grain is per-player,
// not per-table). Summing them directly overcounts by however many
// players visited that table that day (or undercounts nothing but still
// inflates). The aggregator in hotelData.js dedupes:
//   floorday / openday → COUNT(DISTINCT date‖table), via a Set of keys
//   openhours          → per (date,table) AVERAGE first (values should be
//                         identical across duplicate rows; averaging is
//                         the robust way to collapse them to one), then
//                         SUMMED across distinct (date,table) keys
//   playday            → COUNT(DISTINCT date‖id), rows with id == null
//                         (no-play placeholder rows) excluded
// See buildHotelScatterData() / computeKpis() in hotelData.js.

// The six stayer-segment panels (2 rows × 3). `flag` is the raw 0/1
// column on each row that assigns it to this panel; `overall` panels
// ignore every flag and include every row (patron rows AND no-play
// placeholder rows — the only panel where no-play rows actually surface,
// since every is_* flag is 0 on those rows and so never matches a
// specific panel's flag=1 filter). Edit/reorder to change the grid or
// point at renamed hotel-flag columns.
export const PANELS = [
    { key: 'W',         title: 'W Hotel',           accent: '#7aa2f7', flag: 'is_whotel' },
    { key: 'EPIC',      title: 'Epic Hotel',        accent: '#7dcfff', flag: 'is_epic' },
    { key: 'STAR',      title: 'Star Hotel',        accent: '#9ece6a', flag: 'is_star' },
    { key: 'CELEBRITY', title: 'Celebrity Hotel',   accent: '#e0af68', flag: 'is_celebrity' },
    { key: 'NONHOTEL',  title: 'Non-hotel stayer',  accent: '#bb9af7', flag: 'is_no_room' },
    { key: 'OVERALL',   title: 'Overall (all)',     accent: '#f7768e', overall: true },
];

// Default grid order (left-to-right, top-to-bottom) — the array order
// above. The "More filters" drawer lets the user reorder the 6 panels
// live (persisted to localStorage under PANEL_ORDER_STORAGE_KEY); "Reset"
// restores this exact order.
export const DEFAULT_PANEL_ORDER = PANELS.map((p) => p.key);
export const PANEL_ORDER_STORAGE_KEY = 'hotel.panelOrder.v1';

// Region / Card Tier / Sex / Segment / Sub-segment are no longer hardcoded
// lists here — `card` in particular is an opaque tier CODE (e.g. '0EMP',
// '1DRA', or 'Other' for an undefined tier) with no fixed vocabulary this
// file can assume. All five are derived dynamically from the distinct
// values actually present in the loaded (patron-only, no-play rows
// excluded) data — see deriveOptions() in hotelData.js — the same way
// Area/Pit/Game/DOW options are already derived.

// ── Age binning ─────────────────────────────────────────────────────
// Raw `age` is a NUMBER, not a pre-bucketed band, so it needs binning
// before it can be filtered/displayed as a band. `AGE_BIN_EDGES[i]` is
// the inclusive lower bound of `AGE_BAND_LABELS[i]`; the last label is
// open-ended (everything >= its edge). Edit both arrays together (same
// length) to change the bin count/width — bucketAge() in hotelData.js
// reads these directly, no other code needs to change.
export const AGE_BIN_EDGES = [21, 31, 41, 51, 61];
export const AGE_BAND_LABELS = ['21-30', '31-40', '41-50', '51-60', '60+'];

// "Group By" — Table/Pit/Zone are resolvable via a table-id join against
// config_cod.json (which carries pit/zone/game/Location per table), even
// though the raw patron feed itself only carries `table`.
export const SHOW_TYPES = ['Table', 'Pit', 'Zone'];

// ── Scatter component internals ────────────────────────────────────────
// HtScatterHeatmapAvg (vendored copy of the shared ScatterHeatmapAvg) reads
// its title/tooltip/visualMap font sizes and default grid padding from
// here instead of the Performance dashboard's own constants — Hotel hides
// its tooltip and per-panel visualMap, so only `title` is actually visible
// today, but the others are kept wired for when/if that changes.
export const HOTEL_SCATTER_FONT = {
    title: 18,
    titleAvg: 20,
    tooltip: 14,
    visualMap: 13,
};
export const HOTEL_SCATTER_GRID_DEFAULT = { left: '2%', right: '2%', top: '3%', bottom: '3%', containLabel: false };

// ── Floor geometry — adjustable in the "More filters" drawer ──────────
// Mirrors the pricing dashboard's CMP_FLOOR_* convention for its own
// small-multiples comparison maps (see src/pricing/constants/floorLayout.js
// and PricingFloorMap.js's ⚙ symbol-size control) — Hotel's 6 panels are
// the same "many small scatter maps" shape, so the same knobs apply:
// scatter coordinate bounds, box aspect ratio, and symbol scale. These are
// the DEFAULTS; the drawer lets the user override them live (persisted to
// localStorage), and "Reset" restores these values.
export const HOTEL_FLOOR_X_MIN = 0;
export const HOTEL_FLOOR_X_MAX = 1100;
export const HOTEL_FLOOR_Y_MIN = 0;
export const HOTEL_FLOOR_Y_MAX = 1100;

// Box aspect ratio (width / height) of each of the 6 scatter panels.
export const HOTEL_FLOOR_ASPECT_W = 1500;
export const HOTEL_FLOOR_ASPECT_H = 620;
export const HOTEL_FLOOR_ASPECT = `${HOTEL_FLOOR_ASPECT_W} / ${HOTEL_FLOOR_ASPECT_H}`;

// Table-symbol scale multiplier + slider bounds (same range as pricing's
// comparison-mode control, since both are small side-by-side maps).
export const HOTEL_SYMBOL_SIZE = 1.4;
export const SYMBOL_SIZE_MIN = 0.5;
export const SYMBOL_SIZE_MAX = 4;
export const SYMBOL_SIZE_STEP = 0.1;

// ── Drawer chrome ───────────────────────────────────────────────────
export const DRAWER_WIDTH = 320;
export const NUM_FIELD_WIDTH = 88;
export const GEOM_STORAGE_KEY = 'hotel.floorGeometry.v1';

// ── Shared legend — adjustable typography ──────────────────────────────
// Sizes for the click-to-filter threshold legend rendered above the 6
// panels. Bump these to make the legend more readable; the swatch box
// scales alongside the label so the two stay proportional.
export const LEGEND_FONT = {
    sectionHeader: 12,   // "THEO PER FLOORDAY" label
    swatchLabel: 13,     // per-bucket label (e.g. "50k - 75k")
};
export const LEGEND_SWATCH_W = 16;
export const LEGEND_SWATCH_H = 14;

// Sentinels emitted by buildHotelScatterData for "no data" tables — the
// panel KPI-average chip skips these.
//   -1000000  table isn't in the filtered set at all
//    -999999  table IS in the set but the relevant denominator is zero
//             (no floorday, no playday, no openHoursTotal, or no
//             patron_hands/turnover for the ratio KPIs)
export const NO_DATA_SENTINELS = new Set([-1000000, -999999]);

// ── KPI list — patron-focused ────────────────────────────────────────
// Every KPI here is computed PER TABLE (scoped to the players who
// visited that specific table within the active panel + filters), so
// the scatter dot still colors one table at a time.
//
//   *_PER_FLOORDAY   ÷ floorday   = COUNT(DISTINCT date‖table)
//   *_PER_OPEN_HOUR  ÷ openHours  = Σ over distinct (date,table) of the
//                                   AVERAGE openhours value seen for that
//                                   key (dedupes the per-row duplication;
//                                   see hotelData.js computeKpis())
//   *_PER_PATRON_PER_DAY ÷ playday = COUNT(DISTINCT date‖id), rows with
//                                   id == null (no-play rows) excluded
//   Average Bet         = Σturnover / Σpatron_hands
//   Theoretical Hold %  = Σtheo_win / Σturnover × 100    (shown as %)
//   Actual Hold %       = Σcasino_win / Σturnover × 100  (shown as %;
//                          CASINO PERSPECTIVE — can be negative on a
//                          net-patron-win day, same sign convention as
//                          the Live Casino Win dashboard)
//
// "Bets per floorday" (the old side-bet-instance-count KPI) was DROPPED —
// the raw feed no longer carries a `bets` field and there's no substitute.
export const HOTEL_KPI_OPTIONS = [
    'Theo Win per floorday', 'Casino Win per floorday', 'Turnover per floorday',
    'Patron Hands per floorday', 'Minutes played per floorday',
    'Theo Win per open hour', 'Casino Win per open hour', 'Turnover per open hour',
    'Theo Win per patron per day', 'Casino Win per patron per day',
    'Turnover per patron per day', 'Minutes played per patron per day',
    'Average Bet', 'Theoretical Hold %', 'Actual Hold %',
];
export const DEFAULT_HOTEL_KPI = 'Theo Win per floorday';

// KPI → scatter-tuple dim. See hotelData.js buildHotelScatterData() for
// the tuple assembly — dims 0-6 are fixed geometry (x/y/rotation/symbol),
// 7-21 are the 15 KPIs below in the same order as HOTEL_KPI_OPTIONS.
export const KPI_DIM_MAP = {
    'Theo Win per floorday': 7,
    'Casino Win per floorday': 8,
    'Turnover per floorday': 9,
    'Patron Hands per floorday': 10,
    'Minutes played per floorday': 11,
    'Theo Win per open hour': 12,
    'Casino Win per open hour': 13,
    'Turnover per open hour': 14,
    'Theo Win per patron per day': 15,
    'Casino Win per patron per day': 16,
    'Turnover per patron per day': 17,
    'Minutes played per patron per day': 18,
    'Average Bet': 19,
    'Theoretical Hold %': 20,
    'Actual Hold %': 21,
};

// Percent-formatted KPIs (rendered as "x.x%" instead of k/M-suffixed $).
export const PERCENT_KPIS = new Set(['Theoretical Hold %', 'Actual Hold %']);

// ── Threshold ramps ──────────────────────────────────────────────────
// STARTER buckets — no production data to calibrate against yet, so
// these are placeholder scales sized for plausible casino-floor
// magnitudes. Tighten once real distributions are available; the
// bucket count/labels/colors are all this dashboard reads, so retuning
// is a pure data edit here, nothing else changes.
export const HOTEL_THRESHOLDS = {
    'Theo Win per floorday': [
        { gte: 100000, lt: 9999999, color: 'rgba(255, 0, 0)',       label: '100k+' },
        { gte: 75000,  lt: 100000,  color: 'rgba(251, 155, 210)',   label: '75k - 100k' },
        { gte: 50000,  lt: 75000,   color: 'rgba(242, 141, 30)',    label: '50k - 75k' },
        { gte: 35000,  lt: 50000,   color: 'rgba(244, 238, 12)',    label: '35k - 50k' },
        { gte: 20000,  lt: 35000,   color: 'rgba(196, 215, 155)',   label: '20k - 35k' },
        { gte: 10000,  lt: 20000,   color: 'rgba(6, 142, 34)',      label: '10k - 20k' },
        { gte: 5000,   lt: 10000,   color: 'rgba(97, 135, 255)',    label: '5k - 10k' },
        { gte: 0,      lt: 5000,    color: 'rgba(0, 60, 180)',      label: '5k below' },
    ],
    // Casino Win is ACTUAL (not theoretical) win, CASINO PERSPECTIVE — a
    // net-patron-win day/table can go NEGATIVE, unlike Theo Win which is
    // always >= 0. Symmetric ramp around zero: red/pink = big casino win,
    // green = near breakeven, blue = casino net-lost that scope.
    'Casino Win per floorday': [
        { gte: 150000,   lt: 9999999,  color: 'rgba(255, 0, 0)',     label: '150k+' },
        { gte: 75000,    lt: 150000,   color: 'rgba(251, 155, 210)', label: '75k - 150k' },
        { gte: 35000,    lt: 75000,    color: 'rgba(242, 141, 30)',  label: '35k - 75k' },
        { gte: 10000,    lt: 35000,    color: 'rgba(244, 238, 12)',  label: '10k - 35k' },
        { gte: -10000,   lt: 10000,    color: 'rgba(6, 142, 34)',    label: '-10k to 10k' },
        { gte: -35000,   lt: -10000,   color: 'rgba(196, 215, 155)', label: '-35k to -10k' },
        { gte: -75000,   lt: -35000,   color: 'rgba(97, 135, 255)',  label: '-75k to -35k' },
        { gte: -500000,  lt: -75000,   color: 'rgba(0, 60, 180)',    label: '-75k below' },
    ],
    'Turnover per floorday': [
        { gte: 1000000, lt: 99999999, color: 'rgba(255, 0, 0)',     label: '1M+' },
        { gte: 750000,  lt: 1000000,  color: 'rgba(251, 155, 210)', label: '750k - 1M' },
        { gte: 500000,  lt: 750000,   color: 'rgba(242, 141, 30)',  label: '500k - 750k' },
        { gte: 350000,  lt: 500000,   color: 'rgba(244, 238, 12)',  label: '350k - 500k' },
        { gte: 200000,  lt: 350000,   color: 'rgba(196, 215, 155)', label: '200k - 350k' },
        { gte: 100000,  lt: 200000,   color: 'rgba(6, 142, 34)',    label: '100k - 200k' },
        { gte: 50000,   lt: 100000,   color: 'rgba(97, 135, 255)',  label: '50k - 100k' },
        { gte: 0,       lt: 50000,    color: 'rgba(0, 60, 180)',    label: '50k below' },
    ],
    'Patron Hands per floorday': [
        { gte: 800, lt: 99999, color: 'rgba(255, 0, 0)',     label: '800+' },
        { gte: 600, lt: 800,   color: 'rgba(251, 155, 210)', label: '600 - 800' },
        { gte: 400, lt: 600,   color: 'rgba(242, 141, 30)',  label: '400 - 600' },
        { gte: 250, lt: 400,   color: 'rgba(244, 238, 12)',  label: '250 - 400' },
        { gte: 150, lt: 250,   color: 'rgba(196, 215, 155)', label: '150 - 250' },
        { gte: 75,  lt: 150,   color: 'rgba(6, 142, 34)',    label: '75 - 150' },
        { gte: 25,  lt: 75,    color: 'rgba(97, 135, 255)',  label: '25 - 75' },
        { gte: 0,   lt: 25,    color: 'rgba(0, 60, 180)',    label: '25 below' },
    ],
    'Minutes played per floorday': [
        { gte: 4000, lt: 999999, color: 'rgba(255, 0, 0)',     label: '4000+' },
        { gte: 2500, lt: 4000,   color: 'rgba(251, 155, 210)', label: '2500 - 4000' },
        { gte: 1500, lt: 2500,   color: 'rgba(242, 141, 30)',  label: '1500 - 2500' },
        { gte: 900,  lt: 1500,   color: 'rgba(244, 238, 12)',  label: '900 - 1500' },
        { gte: 500,  lt: 900,    color: 'rgba(196, 215, 155)', label: '500 - 900' },
        { gte: 200,  lt: 500,    color: 'rgba(6, 142, 34)',    label: '200 - 500' },
        { gte: 60,   lt: 200,    color: 'rgba(97, 135, 255)',  label: '60 - 200' },
        { gte: 0,    lt: 60,     color: 'rgba(0, 60, 180)',    label: '60 below' },
    ],
    // Per-open-hour family — same shape as the *_per_floorday ramps above,
    // scaled down ~15x (a plausible average open-hours-per-day) to
    // clean, round numbers. Retune once real per-hour distributions land.
    'Theo Win per open hour': [
        { gte: 7500, lt: 999999, color: 'rgba(255, 0, 0)',     label: '7500+' },
        { gte: 5000, lt: 7500,   color: 'rgba(251, 155, 210)', label: '5000 - 7500' },
        { gte: 3000, lt: 5000,   color: 'rgba(242, 141, 30)',  label: '3000 - 5000' },
        { gte: 2000, lt: 3000,   color: 'rgba(244, 238, 12)',  label: '2000 - 3000' },
        { gte: 1200, lt: 2000,   color: 'rgba(196, 215, 155)', label: '1200 - 2000' },
        { gte: 600,  lt: 1200,   color: 'rgba(6, 142, 34)',    label: '600 - 1200' },
        { gte: 300,  lt: 600,    color: 'rgba(97, 135, 255)',  label: '300 - 600' },
        { gte: 0,    lt: 300,    color: 'rgba(0, 60, 180)',    label: '300 below' },
    ],
    'Casino Win per open hour': [
        { gte: 10000,    lt: 9999999,  color: 'rgba(255, 0, 0)',     label: '10k+' },
        { gte: 5000,     lt: 10000,    color: 'rgba(251, 155, 210)', label: '5k - 10k' },
        { gte: 2000,     lt: 5000,     color: 'rgba(242, 141, 30)',  label: '2k - 5k' },
        { gte: 500,      lt: 2000,     color: 'rgba(244, 238, 12)',  label: '500 - 2k' },
        { gte: -500,     lt: 500,      color: 'rgba(6, 142, 34)',    label: '-500 to 500' },
        { gte: -2000,    lt: -500,     color: 'rgba(196, 215, 155)', label: '-2k to -500' },
        { gte: -5000,    lt: -2000,    color: 'rgba(97, 135, 255)',  label: '-5k to -2k' },
        { gte: -50000,   lt: -5000,    color: 'rgba(0, 60, 180)',    label: '-5k below' },
    ],
    'Turnover per open hour': [
        { gte: 67000, lt: 9999999, color: 'rgba(255, 0, 0)',     label: '67k+' },
        { gte: 50000, lt: 67000,   color: 'rgba(251, 155, 210)', label: '50k - 67k' },
        { gte: 33000, lt: 50000,   color: 'rgba(242, 141, 30)',  label: '33k - 50k' },
        { gte: 23000, lt: 33000,   color: 'rgba(244, 238, 12)',  label: '23k - 33k' },
        { gte: 13000, lt: 23000,   color: 'rgba(196, 215, 155)', label: '13k - 23k' },
        { gte: 7000,  lt: 13000,   color: 'rgba(6, 142, 34)',    label: '7k - 13k' },
        { gte: 3000,  lt: 7000,    color: 'rgba(97, 135, 255)',  label: '3k - 7k' },
        { gte: 0,     lt: 3000,    color: 'rgba(0, 60, 180)',    label: '3k below' },
    ],
    'Theo Win per patron per day': [
        { gte: 1000, lt: 999999, color: 'rgba(255, 0, 0)',     label: '1000+' },
        { gte: 500,  lt: 1000,   color: 'rgba(251, 155, 210)', label: '500 - 1000' },
        { gte: 250,  lt: 500,    color: 'rgba(242, 141, 30)',  label: '250 - 500' },
        { gte: 120,  lt: 250,    color: 'rgba(244, 238, 12)',  label: '120 - 250' },
        { gte: 60,   lt: 120,    color: 'rgba(196, 215, 155)', label: '60 - 120' },
        { gte: 25,   lt: 60,     color: 'rgba(6, 142, 34)',    label: '25 - 60' },
        { gte: 10,   lt: 25,     color: 'rgba(97, 135, 255)',  label: '10 - 25' },
        { gte: 0,       lt: 10,  color: 'rgba(0, 60, 180)',    label: '10 below' },
    ],
    'Casino Win per patron per day': [
        { gte: 1000,     lt: 9999999, color: 'rgba(255, 0, 0)',     label: '1000+' },
        { gte: 500,      lt: 1000,    color: 'rgba(251, 155, 210)', label: '500 - 1000' },
        { gte: 200,      lt: 500,     color: 'rgba(242, 141, 30)',  label: '200 - 500' },
        { gte: 50,       lt: 200,     color: 'rgba(244, 238, 12)',  label: '50 - 200' },
        { gte: -50,      lt: 50,      color: 'rgba(6, 142, 34)',    label: '-50 to 50' },
        { gte: -200,     lt: -50,     color: 'rgba(196, 215, 155)', label: '-200 to -50' },
        { gte: -500,     lt: -200,    color: 'rgba(97, 135, 255)',  label: '-500 to -200' },
        { gte: -50000,   lt: -500,    color: 'rgba(0, 60, 180)',    label: '-500 below' },
    ],
    'Turnover per patron per day': [
        { gte: 10000, lt: 999999, color: 'rgba(255, 0, 0)',     label: '10k+' },
        { gte: 5000,  lt: 10000,  color: 'rgba(251, 155, 210)', label: '5k - 10k' },
        { gte: 2500,  lt: 5000,   color: 'rgba(242, 141, 30)',  label: '2.5k - 5k' },
        { gte: 1000,  lt: 2500,   color: 'rgba(244, 238, 12)',  label: '1k - 2.5k' },
        { gte: 500,   lt: 1000,   color: 'rgba(196, 215, 155)', label: '500 - 1k' },
        { gte: 200,   lt: 500,    color: 'rgba(6, 142, 34)',    label: '200 - 500' },
        { gte: 50,    lt: 200,    color: 'rgba(97, 135, 255)',  label: '50 - 200' },
        { gte: 0,     lt: 50,     color: 'rgba(0, 60, 180)',    label: '50 below' },
    ],
    'Minutes played per patron per day': [
        { gte: 240, lt: 9999, color: 'rgba(255, 0, 0)',     label: '240+' },
        { gte: 120, lt: 240,  color: 'rgba(251, 155, 210)', label: '120 - 240' },
        { gte: 60,  lt: 120,  color: 'rgba(242, 141, 30)',  label: '60 - 120' },
        { gte: 30,  lt: 60,   color: 'rgba(244, 238, 12)',  label: '30 - 60' },
        { gte: 15,  lt: 30,   color: 'rgba(196, 215, 155)', label: '15 - 30' },
        { gte: 5,   lt: 15,   color: 'rgba(6, 142, 34)',    label: '5 - 15' },
        { gte: 0,   lt: 5,    color: 'rgba(0, 60, 180)',    label: '5 below' },
    ],
    'Average Bet': [
        { gte: 8000, lt: 999999, color: 'rgba(153, 0, 51)',    label: '8k+' },
        { gte: 4000, lt: 8000,   color: 'rgba(158, 0, 158)',   label: '4k - 8k' },
        { gte: 2000, lt: 4000,   color: 'rgba(255, 0, 0)',     label: '2k - 4k' },
        { gte: 1000, lt: 2000,   color: 'rgba(244, 238, 12)',  label: '1k - 2k' },
        { gte: 500,  lt: 1000,   color: 'rgba(6, 142, 34)',    label: '500 - 1k' },
        { gte: 200,  lt: 500,    color: 'rgba(97, 135, 255)',  label: '200 - 500' },
        { gte: 0,    lt: 200,    color: 'rgba(0, 60, 180)',    label: '200 below' },
    ],
    // Theoretical Hold % — theo_win/turnover as a %. Casino floor edges
    // typically span ~0.5% (Baccarat Banker) to ~15%+ (Tie / side bets).
    // Always >= 0 (theoretical, not actual).
    'Theoretical Hold %': [
        { gte: 8, lt: 999,  color: 'rgba(255, 0, 0)',     label: '8%+' },
        { gte: 5, lt: 8,    color: 'rgba(251, 155, 210)', label: '5% - 8%' },
        { gte: 3, lt: 5,    color: 'rgba(242, 141, 30)',  label: '3% - 5%' },
        { gte: 2, lt: 3,    color: 'rgba(244, 238, 12)',  label: '2% - 3%' },
        { gte: 1, lt: 2,    color: 'rgba(196, 215, 155)', label: '1% - 2%' },
        { gte: 0, lt: 1,    color: 'rgba(0, 60, 180)',    label: '0% - 1%' },
    ],
    // Actual Hold % — casino_win/turnover as a %, CASINO PERSPECTIVE.
    // Unlike Theoretical Hold, this can go NEGATIVE (a net-patron-win
    // scope). Symmetric ramp around zero.
    'Actual Hold %': [
        { gte: 8,     lt: 999,  color: 'rgba(255, 0, 0)',     label: '8%+' },
        { gte: 5,     lt: 8,    color: 'rgba(251, 155, 210)', label: '5% - 8%' },
        { gte: 2,     lt: 5,    color: 'rgba(242, 141, 30)',  label: '2% - 5%' },
        { gte: 0,     lt: 2,    color: 'rgba(244, 238, 12)',  label: '0% - 2%' },
        { gte: -2,    lt: 0,    color: 'rgba(196, 215, 155)', label: '-2% - 0%' },
        { gte: -5,    lt: -2,   color: 'rgba(97, 135, 255)',  label: '-5% - -2%' },
        { gte: -999,  lt: -5,   color: 'rgba(0, 60, 180)',    label: '-5% below' },
    ],
};
