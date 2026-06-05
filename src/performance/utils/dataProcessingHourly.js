// Hourly + Aggregated-hourly processors.
//
// Two public builders, both consuming the aligned per-row schema (see
// scripts/realign-perf-data.js + src/performance/utils/dataSource.js):
//
//   1. buildHourlyScatterData         — 24-hr timeline view
//                                       (one ECharts dim array per KPI, indexed by hour)
//   2. buildAggregatedHourlyScatterData — 24-hr "aggregated hours" view
//                                       (one scalar per KPI, summed across user-picked hours)
//
// Both:
//   • Group source rows by their identifier key (table×hour or table).
//   • Sum the raw counts into bucket fields (never average pre-computed
//     ratios — so any date-range or filter change re-aggregates correctly).
//   • Use parseTablemin + addTablemin + tableMinimumMode to handle the
//     unified "min:weight,min:weight,…" tablemin string.
//
// The output tuples stay 35-position to match what
// ScatterHeatmapPlay / ScatterHeatmapAvg read.

import { gametype_svg_path } from "../../shared/constants/heatmapConstants";
import { parseTablemin, addTablemin, tableMinimumMode, gametypeTableKey } from "./dataSource";

// Lightweight timing helper. Logs once per build call so the console
// shows the cost of the aggregation pass (independent of the fetch +
// normalize cost logged by dataSource).
const _now = (typeof performance !== 'undefined' && performance.now)
  ? () => performance.now()
  : () => Date.now();

// ---------------------------------------------------------------------
// Shared bucket helpers — same shape across all 3 builders.
// ---------------------------------------------------------------------

function emptyBucket(extra) {
  return {
    patronhrs: 0, openhours: 0, activehours: 0,
    // `turnover` (was `wager`) = sum of all bet amounts across hands.
    drop: 0, turnover: 0, win: 0, theo: 0, watm_total: 0,
    patron_hands: 0,
    game_count: 0, free_game_count: 0, active_game_count: 0,
    // Min-by-min granularity for "Active % (Min by Min)" KPI.
    open_minutes: 0, active_minutes: 0,
    tablemin: {},   // accumulated histogram (key=min, value=summed weight)
    open_rows: 0,   // number of source rows that contributed
    ...extra,
  };
}

// `patron_hands` is the dedicated avgbet denominator (paying-patron
// hand count) — see avgbet computation in each builder below.
function accumulate(bucket, row) {
  bucket.patronhrs         += row.patronhrs         || 0;
  bucket.openhours         += row.openhours         || 0;
  bucket.activehours       += row.activehours       || 0;
  bucket.drop              += row.drop              || 0;
  bucket.turnover          += row.turnover          || 0;
  bucket.win               += row.win               || 0;
  bucket.theo              += row.theo              || 0;
  bucket.watm_total        += row.watm_total        || 0;
  bucket.patron_hands      += row.patron_hands      || 0;
  bucket.game_count        += row.game_count        || 0;
  bucket.free_game_count   += row.free_game_count   || 0;
  bucket.active_game_count += row.active_game_count || 0;
  bucket.open_minutes      += row.open_minutes      || 0;
  bucket.active_minutes    += row.active_minutes    || 0;
  addTablemin(bucket.tablemin, parseTablemin(row.tablemin));
  if ((row.openhours || 0) > 0 || (row.patronhrs || 0) > 0) bucket.open_rows += 1;
}

// ---------------------------------------------------------------------
// 1.  24-hr timeline view (buildHourlyScatterData)
//
// Output: 35-position array per table. Slots 7..30 hold *arrays*, one
// entry per `hourList` hour. Slots 0..6 + 31..34 are scalars (geometry,
// label, zone/pit/table/area).
//
// KPIs are declared in HOURLY_KPI_REGISTRY (registry-driven config —
// pattern). Adding a 24-hr KPI is one config entry:
//   { label, dim, thresholdKey, compute(bucket) }
// plus a threshold_dict color ramp keyed by `thresholdKey`. The builder
// fills each KPI's declared dim from its compute(); everything else in
// the 35-tuple is geometry / label / meta / sentinel filler.
//
// Two reserved slots are NOT KPIs but the ScatterHeatmapPlay tooltip
// reads them, so the builder always fills them explicitly:
//   • 16 → table_label (also used by the brush handler)
//   • 30 → open fraction (tooltip "Open: NN%")
//
// `status` KPIs (Open Hours, Unused Tables) are categorical 0/1/2 and
// don't use compute() — the builder sets them from the open/patron
// state. `emptyVal` overrides the closed-hour value for non-status KPIs
// that should show 0 rather than the -1000000 sentinel (Table Minimum).
// ---------------------------------------------------------------------

const HOURLY_SENTINEL = -1000000;

export const HOURLY_KPI_REGISTRY = {
  // --- existing 5 KPIs (dims unchanged so tooltip + legacy stay valid) ---
  open_hours: {
    label: 'Open Hours', dim: 10, thresholdKey: 'Open Hours_hourly',
    status: true, // 0/1/2 — set from open/patron state, no compute()
  },
  patron_hours: {
    label: 'Patron Hours per table', dim: 9, thresholdKey: 'Patron Hours_hourly',
    // Σpatronhrs / Σopenhours — avg concurrent patrons while open.
    compute: (b) => b.patronhrs / b.openhours,
  },
  table_minimum: {
    label: 'Table Minimum', dim: 14, thresholdKey: 'Table Minimum_hourly',
    compute: (b) => tableMinimumMode(b.tablemin) || 0,
    emptyVal: 0, // closed hours show 0, not the sentinel
  },
  unused_tables: {
    label: 'Unused Tables', dim: 29, thresholdKey: 'Unused Tables_hourly',
    status: true,
  },
  theo_per_hour: {
    label: 'Theo per table per hour', dim: 24, thresholdKey: 'Theo per table per hour_hourly',
    compute: (b) => parseInt(b.theo / b.openhours),
  },
  // --- new KPIs ---
  turnover_per_hour: {
    label: 'Turnover per table per hour', dim: 11, thresholdKey: 'Turnover per hour_hourly',
    compute: (b) => b.turnover / b.openhours,
  },
  win_per_hour: {
    label: 'Win per table per hour', dim: 12, thresholdKey: 'Win per hour_hourly',
    compute: (b) => b.win / b.openhours,
  },
  hands_per_hour: {
    label: 'Hands per table per hour', dim: 26, thresholdKey: 'Hands per hour_hourly',
    compute: (b) => parseInt(b.game_count / b.openhours),
  },
  occupancy: {
    label: 'Occupancy %', dim: 7, thresholdKey: 'Occupancy %_hourly',
    // Σactivehours / Σopenhours × 100 — fraction of open time with patrons.
    compute: (b) => (b.activehours / b.openhours) * 100,
  },
  avgbet: {
    label: 'Avg bet', dim: 15, thresholdKey: 'Avgbet_hourly',
    compute: (b) => (b.patron_hands > 0 ? b.turnover / b.patron_hands : HOURLY_SENTINEL),
  },
  active_pct_min: {
    label: 'Active % (Min by Min)', dim: 20, thresholdKey: 'Active % (Min by Min)_hourly',
    // Σactive_minutes / Σopen_minutes × 100 — finer-grain than the
    // hour-flag Occupancy %, since minute totals capture sub-hour
    // idle gaps that the activehours bit may otherwise flatten.
    compute: (b) => (b.open_minutes > 0 ? (b.active_minutes / b.open_minutes) * 100 : HOURLY_SENTINEL),
  },
};

export function buildHourlyScatterData(
  hourlyData, configData,
  /* finalPits */ _finalPits,
  finalGames,
  /* finalDows */ _finalDows,
  hourList,
  /* minDate */ _minDate,
  /* maxDate */ _maxDate,
) {
  const _t0 = _now();
  // Group raw rows by (gametype+table, hour). gametype+table because a
  // bare table number is reused across gametypes.
  const byTableHour = Object.create(null);
  for (const value of hourlyData) {
    const key = gametypeTableKey(value.gametype, value.table) + '|' + value.hour;
    if (!byTableHour[key]) {
      byTableHour[key] = emptyBucket({
        table: String(value.table),
        hour: value.hour,
        gametype: value.gametype,
        pit: String(value.pit),
      });
    }
    accumulate(byTableHour[key], value);
  }

  const registryEntries = Object.values(HOURLY_KPI_REGISTRY);
  const scatter = [];

  for (const cfg of configData) {
    const tableID = String(cfg.table);
    const game    = finalGames.includes(cfg.game) ? cfg.game : '';
    const svgDef  = gametype_svg_path[cfg.game];
    if (!svgDef || cfg.x === undefined || cfg.y === undefined || cfg.rotation === undefined) continue;

    // Bucket key uses the config's own gametype (`cfg.game`) + table.
    const cfgTableKey = gametypeTableKey(cfg.game, cfg.table);
    const table_label = game + tableID;

    // One per-hour array per registered KPI, keyed by its dim index,
    // plus the two reserved slots (label @16, open-fraction @30).
    const dimArrays = {};
    for (const k of registryEntries) dimArrays[k.dim] = [];
    const dim_table_label = [];
    const dim_open_pct    = [];

    for (const hour of hourList) {
      const hData = byTableHour[cfgTableKey + '|' + parseInt(hour)];
      const open  = !!(hData && hData.openhours > 0);
      // Categorical status used by the two `status` KPIs: 2 open+patron,
      // 1 open+idle, 0 closed.
      const openStatus = open ? (hData.patronhrs > 0 ? 2 : 1) : 0;
      // Hour fraction the table was open (capped at 1) — tooltip "Open:".
      const openPct = open ? Math.min(1, hData.openhours) : 0;

      dim_table_label.push(table_label);
      dim_open_pct.push(openPct);

      for (const k of registryEntries) {
        let v;
        if (k.status) {
          v = openStatus;
        } else if (!open) {
          v = k.emptyVal !== undefined ? k.emptyVal : HOURLY_SENTINEL;
        } else {
          v = k.compute(hData);
        }
        dimArrays[k.dim].push(v);
      }
    }

    // Assemble the 35-slot tuple. Geometry + meta are scalars; every
    // value slot (7..30) is a per-hour array. Slots not claimed by a
    // KPI, the label, or the open-fraction become sentinel arrays so
    // the tuple shape stays uniform for downstream consumers.
    const sentinelArr = hourList.map(() => HOURLY_SENTINEL);
    const point = new Array(35);
    point[0] = cfg.x;
    point[1] = cfg.y;
    point[2] = cfg.rotation;
    point[3] = game;
    point[4] = 'path://' + svgDef.path;
    point[5] = svgDef.size_X;
    point[6] = svgDef.size_Y;
    point[16] = dim_table_label;     // reserved (tooltip + brush)
    point[30] = dim_open_pct;        // reserved (tooltip "Open:")
    point[31] = cfg.zone;
    point[32] = String(cfg.pit);
    point[33] = tableID;
    point[34] = cfg.Location || '';
    for (const k of registryEntries) point[k.dim] = dimArrays[k.dim];
    for (let i = 7; i <= 30; i++) {
      if (point[i] === undefined) point[i] = sentinelArr;
    }

    scatter.push(point);
  }

  // eslint-disable-next-line no-console
  console.info(
    `[Perf/timing] buildHourlyScatterData: ${(_now() - _t0).toFixed(0)}ms, ` +
      `rows_in=${hourlyData.length}, tables_out=${scatter.length}, hours=${hourList.length}`
  );
  return scatter;
}

// ---------------------------------------------------------------------
// 2.  24-hr "aggregated hours" view (buildAggregatedHourlyScatterData)
//
// User picks a set of hours; this builder sums their rows into one
// per-table bucket and emits a flat 35-position tuple matching the
// Avg view's scatter shape — so the same ScatterHeatmapAvg renderer
// can consume both.
// ---------------------------------------------------------------------

export function buildAggregatedHourlyScatterData(
  hourlyData, configData, finalGames, selectedHours,
) {
  const _t0 = _now();
  const selectedSet = new Set(selectedHours.map((h) => parseInt(h)));
  const byTable = Object.create(null);

  for (const value of hourlyData) {
    if (!selectedSet.has(parseInt(value.hour))) continue;
    const key = gametypeTableKey(value.gametype, value.table);
    if (!byTable[key]) {
      byTable[key] = emptyBucket({
        table: String(value.table),
        gametype: value.gametype,
        pit: String(value.pit),
        area: value.area,
      });
    }
    accumulate(byTable[key], value);
  }

  const scatter = [];

  for (const cfg of configData) {
    const tableID = String(cfg.table);
    const game    = finalGames.includes(cfg.game) ? cfg.game : '';
    const svgDef  = gametype_svg_path[cfg.game];
    if (!svgDef || cfg.x === undefined || cfg.y === undefined || cfg.rotation === undefined) continue;

    const table_label = game + tableID;
    const b = byTable[gametypeTableKey(cfg.game, cfg.table)];

    // Aggregate-hours scatter tuple follows the HOURLY_KPI_REGISTRY
    // dim layout exactly — same KPI set as the Timeline view, same
    // formulas (sum-then-divide), just summed across the entire
    // user-selected hour window instead of per hour. This way the
    // hourly KPI dropdown drives both Timeline and Aggregate
    // consistently: pick "Patron Hours" → both views show patron
    // hours; pick "Table Minimum" → both show table minimum.
    const open = !!(b && b.openhours > 0);
    const openStatus  = open ? (b.patronhrs > 0 ? 2 : 1) : 0;
    const openPct     = open ? Math.min(1, b.openhours) : 0;
    const SENT        = -1000000;
    // Per-hour rates over the aggregated window. n cancels because both
    // numerator and denominator are summed over the same buckets.
    const patronRatio = open ? b.patronhrs   / b.openhours       : SENT;
    const tmMode      = open ? (tableMinimumMode(b.tablemin) || 0) : 0;
    const theoRate    = open ? parseInt(b.theo / b.openhours)    : SENT;
    const turnoverRate= open ? b.turnover    / b.openhours       : SENT;
    const winRate     = open ? b.win         / b.openhours       : SENT;
    const handsRate   = open ? parseInt(b.game_count / b.openhours) : SENT;
    const occupancy   = open ? (b.activehours / b.openhours) * 100 : SENT;
    const avgbet      = (b && b.patron_hands > 0) ? b.turnover / b.patron_hands : SENT;
    const activePctMin = (b && b.open_minutes > 0) ? (b.active_minutes / b.open_minutes) * 100 : SENT;

    // Build a 35-position tuple. Sentinel-fill all KPI value slots
    // first, then drop in the registry-aligned values + meta.
    const point = new Array(35).fill(SENT);
    point[0]  = cfg.x;
    point[1]  = cfg.y;
    point[2]  = cfg.rotation;
    point[3]  = game;
    point[4]  = 'path://' + svgDef.path;
    point[5]  = svgDef.size_X;
    point[6]  = svgDef.size_Y;
    // HOURLY_KPI_REGISTRY dim assignments:
    point[7]  = occupancy;     // Occupancy %
    point[9]  = patronRatio;   // Patron Hours
    point[10] = openStatus;    // Open Hours (status 0/1/2)
    point[11] = turnoverRate;  // Turnover per hour
    point[12] = winRate;       // Win per hour
    point[14] = tmMode;        // Table Minimum
    point[15] = avgbet;        // Avg bet
    point[20] = activePctMin;  // Active % (Min by Min)
    point[16] = table_label;   // label
    point[24] = theoRate;      // Theo per table per hour
    point[26] = handsRate;     // Hands per hour
    point[29] = openStatus;    // Unused Tables (status 0/1/2)
    point[30] = openPct;       // tooltip "Open: NN%"
    point[31] = cfg.zone || '';
    point[32] = String(cfg.pit || '');
    point[33] = tableID;
    point[34] = (b && b.area) || cfg.Location || '';

    scatter.push(point);
  }

  // eslint-disable-next-line no-console
  console.info(
    `[Perf/timing] buildAggregatedHourlyScatterData: ${(_now() - _t0).toFixed(0)}ms, ` +
      `rows_in=${hourlyData.length}, tables_out=${scatter.length}, hours_selected=${selectedHours.length}`
  );
  return scatter;
}
