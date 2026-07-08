// Daily processor — builds the scatter payload the "Avg" view consumes.
//
// One row per active config table is emitted. The output shape (35
// positions, indexed by every consumer of `value[…]`) stays stable
// across this rewrite — only the *internal* field names changed to
// match the aligned schema (see scripts/realign-perf-data.js).
//
// Adding a new KPI:
//   1. Add the field to `computeKpis()` below.
//   2. Add a slot to `EMPTY_KPIS` so empty buckets render with a
//      sentinel instead of `undefined`.
//   3. Append the value to the output tuple in the assembly loop.
//   4. Wire the new KPI into `available_KPI_Map` + `kpiConfigMap`
//      (in ScatterHeatmapAvg.js) with the matching dimension index.
//
// Sentinels are inherited from the legacy code so the visualMap
// pieces in ScatterHeatmapAvg keep matching:
//   -1000000  "no data for this table/pit/zone at all"
//    -999999  "data exists but the relevant denominator is zero"

import { gametype_svg_path } from "../../shared/constants/heatmapConstants";
import { parseTablemin, addTablemin, tableMinimumMode, gametypeTableKey } from "./dataSource";

// Same lightweight timing helper as the hourly processor uses — keeps
// the console-log shape consistent so users can compare Avg vs Hourly
// aggregation cost at a glance.
const _now = (typeof performance !== 'undefined' && performance.now)
  ? () => performance.now()
  : () => Date.now();

// ---------------------------------------------------------------------
// Aggregation helpers
// ---------------------------------------------------------------------

function emptyBucket(extra) {
  return {
    drop: 0, win: 0, theo: 0, turnover: 0,
    // `spread` = SCHEDULED open hours; `openhours` = ACTUAL open hours.
    // Both summed independently so the new spread KPIs can compare.
    patronhrs: 0, openhours: 0, spread: 0, openday: 0, floorday: 0,
    watm_total: 0,
    patron_hands: 0,
    // Hand-count trio (aligned with hourly + wd):
    //   game_count        = total hands (= active + free)
    //   active_game_count = wagered hands
    //   free_game_count   = free / promo hands
    game_count: 0, active_game_count: 0, free_game_count: 0,
    // Blended numerator for "Theo / Win per floorday": per row we add
    // THEO for BA/NC gametypes, WIN otherwise (see accumulate()). Summed
    // here so Pit/Zone buckets blend correctly across mixed gametypes.
    theo_or_win: 0,
    // Min-by-min granularity for "Active % (Min by Min)" KPI.
    open_minutes: 0, active_minutes: 0,
    tablemin: {}, // parsed-and-summed histogram, see dataSource.parseTablemin
    ...extra,
  };
}

// Fold one source row into a bucket (in place). `drop` is summed
// alongside `turnover` because they're distinct in daily (drop = chips
// brought to the table; turnover = sum of all bet amounts across hands)
// — they're equal in the hourly grain but still listed for parity.
// `patron_hands` is the dedicated avgbet denominator (paying-patron
// hand count) — see computeKpis() for the formula.
function accumulate(bucket, row) {
  bucket.drop              += row.drop              || 0;
  bucket.win               += row.win               || 0;
  bucket.theo              += row.theo              || 0;
  bucket.turnover          += row.turnover          || 0;
  bucket.patronhrs         += row.patronhrs         || 0;
  bucket.openhours         += row.openhours         || 0;
  // Scheduled open hours — new field in the daily source.
  bucket.spread            += row.spread            || 0;
  bucket.openday           += row.openday           || 0;
  bucket.floorday          += row.floorday          || 0;
  bucket.watm_total        += row.watm_total        || 0;
  bucket.patron_hands      += row.patron_hands      || 0;
  bucket.game_count        += row.game_count        || 0;
  bucket.active_game_count += row.active_game_count || 0;
  bucket.free_game_count   += row.free_game_count   || 0;
  bucket.open_minutes      += row.open_minutes      || 0;
  bucket.active_minutes    += row.active_minutes    || 0;
  // Theo for BA/NC tables, Win for everything else — blended per row so
  // a Pit/Zone bucket spanning both kinds sums each table's correct
  // numerator. (In Table mode all rows share one gametype, so this is
  // simply Σtheo or Σwin for that table.)
  bucket.theo_or_win       += (row.gametype === 'BA' || row.gametype === 'NC')
                                ? (row.theo || 0)
                                : (row.win  || 0);
  addTablemin(bucket.tablemin, parseTablemin(row.tablemin));
}

// ---------------------------------------------------------------------
// KPI computation — single source of truth, used for table/pit/zone.
// ---------------------------------------------------------------------

function computeKpis(d, label, selectedPricingOptions) {
  // game_count is the total (= active + free) under the aligned
  // semantics, so the per-hour "all hands dealt" KPI reads it
  // directly. wagered_hands_per_hour uses active_game_count;
  // free_hands_per_hour uses free_game_count.
  const tmMode = d.openhours > 0 ? tableMinimumMode(d.tablemin) : 0;
  const isMeetPriceFilter = d.openhours > 0
    ? (selectedPricingOptions.length === 0
        ? 1
        : (selectedPricingOptions.includes(tmMode) ? 1 : 0))
    : 0;

  return {
    is_meet_price_filter:   isMeetPriceFilter,
    drop_per_openday:       d.openday   > 0 ? parseInt(d.drop / d.openday)            : -999999,
    win_per_openday:        d.openday   > 0 ? parseInt(d.win / d.openday)             : -999999,
    patronhrs_per_openday:  d.openday   > 0 ? parseInt(d.patronhrs / d.openday)       : -999999,
    openhours_per_openday:  d.openday   > 0 ? parseInt(d.openhours / d.openday)       : -999999,
    drop_per_openhour:      d.openhours > 0 ? parseInt(d.drop / d.openhours)          : -999999,
    win_per_openhour:       d.openhours > 0 ? parseInt(d.win / d.openhours)           : -999999,
    patronhrs_per_openhour: d.openhours > 0 ? (d.patronhrs / d.openhours)             : -999999,
    table_minimum:          tmMode,
    act_tablemin:           d.openhours > 0 ? parseInt(d.watm_total / d.openhours)    : 0,
    avgbet:                 d.patron_hands > 0 ? parseInt(d.turnover / d.patron_hands): 0,
    table_label:            label,
    drop_per_floorday:      (d.floorday > 0 && d.openhours > 0) ? parseInt(d.drop / d.floorday)      : -999999,
    win_per_floorday:       (d.floorday > 0 && d.openhours > 0) ? parseInt(d.win / d.floorday)       : -999999,
    patronhrs_per_floorday: (d.floorday > 0 && d.openhours > 0) ? parseInt(d.patronhrs / d.floorday) : -999999,
    openhours_per_floorday: (d.floorday > 0 && d.openhours > 0) ? parseInt(d.openhours / d.floorday) : -999999,
    theo_per_openday:       d.openday   > 0                       ? parseInt(d.theo / d.openday)         : -999999,
    theo_per_openhour:      d.openhours > 0                       ? parseInt(d.theo / d.openhours)       : -999999,
    theo_per_floorday:      (d.floorday > 0 && d.openhours > 0) ? parseInt(d.theo / d.floorday)        : -999999,
    // Theo / Win per floorday — uses Σtheo for BA/NC tables and Σwin
    // otherwise (the blend is pre-summed in d.theo_or_win), divided by
    // the floorday capacity. Gated like the other per-floorday KPIs.
    theo_win_per_floorday:  (d.floorday > 0 && d.openhours > 0) ? parseInt(d.theo_or_win / d.floorday) : -999999,
    hands_per_hour:         d.openhours > 0 ? parseInt(d.game_count / d.openhours)        : -999999,
    wagered_hands_per_hour: d.openhours > 0 ? parseInt(d.active_game_count / d.openhours) : -999999,
    free_hands_per_hour:    d.openhours > 0 ? parseInt(d.free_game_count / d.openhours)   : -999999,
    // Active % (Min by Min) = Σactive_minutes / Σopen_minutes × 100.
    // More precise than the hour-grain Occupancy %, since minute totals
    // capture sub-hour idle gaps the activehours flag may flatten.
    active_pct_min:         d.open_minutes > 0 ? (d.active_minutes / d.open_minutes) * 100 : -999999,
    open_status:            d.floorday  > 0 ? (d.openday > 0 ? ((d.win > 0 || d.patronhrs > 0) ? 2 : 1) : 0) : -999999,
    // Open Percentage emitted on the unified percentage scale
    // (0..100), matching Active % (Min by Min) at slot 20 and
    // Occupancy % at hourly slot 7. Threshold ramps in
    // heatmapConstants.js were updated to match. See the comment
    // block above PERCENT_KPIS in PerformanceDashboard.js for the
    // full alignment story.
    open_percentage:        d.floorday  > 0 ? (d.openday > 0 ? (d.openday / d.floorday) * 100 : 0)         : -999999,
    // --- Spread KPIs (scheduled vs actual) -------------------------
    // `spread` is the scheduled open hours (planned schedule);
    // `openhours` is what actually happened. The three KPIs below
    // turn that pair into actionable metrics:
    //
    //   • spread_per_floorday  — capacity utilisation of the plan
    //   • spread_per_openday   — avg planned hours per open day
    //   • actual_vs_spread     — (actual − plan), positive means
    //                            we ran longer than scheduled,
    //                            negative means we under-ran.
    //                            Expressed per floorday so the metric
    //                            is comparable across tables with
    //                            different floor capacity.
    spread_per_floorday:    (d.floorday > 0)                       ? parseInt(d.spread / d.floorday)                        : -999999,
    spread_per_openday:     (d.openday  > 0)                       ? parseInt(d.spread / d.openday)                         : -999999,
    actual_vs_spread:       (d.floorday > 0)                       ? parseInt((d.openhours - d.spread) / d.floorday)        : -999999,
  };
}

// Default tuple used when a config table has no data (or, in Table
// mode, fails the price filter). Sentinels match the legacy code.
const EMPTY_KPIS = {
  is_meet_price_filter:   0,
  drop_per_openday:       -1000000,
  win_per_openday:        -1000000,
  patronhrs_per_openday:  -1000000,
  openhours_per_openday:  -1000000,
  drop_per_openhour:      -1000000,
  win_per_openhour:       -1000000,
  patronhrs_per_openhour: -1000000,
  table_minimum:          -999999, // distinct sentinel — see header note
  act_tablemin:           -1000000,
  avgbet:                 -1000000,
  table_label:            '',
  drop_per_floorday:      -1000000,
  win_per_floorday:       -1000000,
  patronhrs_per_floorday: -1000000,
  openhours_per_floorday: -1000000,
  theo_per_openday:       -1000000,
  theo_per_openhour:      -1000000,
  theo_per_floorday:      -1000000,
  theo_win_per_floorday:  -1000000,
  active_pct_min:         -1000000,
  hands_per_hour:         -1000000,
  wagered_hands_per_hour: -1000000,
  free_hands_per_hour:    -1000000,
  open_status:            -1000000,
  open_percentage:        -1000000,
  spread_per_floorday:    -1000000,
  spread_per_openday:     -1000000,
  actual_vs_spread:       -1000000,
};

// ---------------------------------------------------------------------
// Public entry point.
// ---------------------------------------------------------------------

export function buildAvgScatterData(
  filteredData,
  configData,
  showType,
  selectedPricingOptions,
  finalGameOptions,
  /* minDate */ _minDate,
  /* maxDate */ _maxDate,
) {
  const _t0 = _now();

  // Zone lookup — config.json is the single source of truth. The 3 data
  // sources (daily / hourly / wd) no longer carry zone per row; we map
  // each row to its zone here. Keyed by gametype+table (NOT table alone)
  // since table numbers are reused across gametypes.
  const zoneByTable = new Map();
  for (const cfg of configData) {
    zoneByTable.set(gametypeTableKey(cfg.game, cfg.table), cfg.zone);
  }

  // 1. Aggregate by table / pit / zone in a single pass. The per-table
  //    bucket is keyed on gametype+table so two same-numbered tables of
  //    different games don't merge.
  const byTable = Object.create(null);
  const byPit   = Object.create(null);
  const byZone  = Object.create(null);

  for (const row of filteredData) {
    const tableKey = gametypeTableKey(row.gametype, row.table);
    const pitKey   = String(row.pit);
    const zoneKey  = zoneByTable.get(tableKey);

    if (!byTable[tableKey]) {
      byTable[tableKey] = emptyBucket({
        table: String(row.table), gametype: row.gametype,
        pit: pitKey, zone: zoneKey, area: row.area,
        // sub_segment is a per-row legend-column label from the API.
        // Carried on the bucket as metadata only (not aggregated) —
        // first row wins, which is fine because a table's sub_segment
        // doesn't change between rows of the same date range. See
        // legendGroupForSubSegment() in heatmapConstants.
        sub_segment: row.sub_segment,
      });
    }
    accumulate(byTable[tableKey], row);

    if (!byPit[pitKey]) byPit[pitKey] = emptyBucket({ pit: pitKey });
    accumulate(byPit[pitKey], row);

    if (zoneKey) {
      if (!byZone[zoneKey]) byZone[zoneKey] = emptyBucket({ zone: zoneKey });
      accumulate(byZone[zoneKey], row);
    }
  }

  // 2. Walk active config rows and emit one scatter row per table.
  const scatterData = [];

  for (const row of configData) {
    const tableID     = String(row.table);
    // Look up the bucket by gametype+table (config carries gametype as
    // `game`) so the same table number under a different game resolves
    // to its own data, not a collided merge.
    const tableBucket = byTable[gametypeTableKey(row.game, row.table)];

    const pit  = tableBucket ? String(row.pit) : '';
    const zone = tableBucket ? row.zone        : 'other';

    const x = row.x;
    const y = row.y;
    const r = row.rotation;
    const svgDef = gametype_svg_path[row.game];
    if (!svgDef || x === undefined || y === undefined || r === undefined) continue;

    // d[3] (game) drives the Gametype KPI's categorical visualMap. Blank
    // it when the table has NO data in the current filter set so the
    // Gametype view greys out filtered-out tables — mirroring how the
    // numeric KPIs grey via their sentinel values. (The symbol SHAPE
    // uses the path at d[4], set below from config regardless, so the
    // table still renders as a grey shape rather than disappearing.)
    const game       = (tableBucket && finalGameOptions.includes(row.game)) ? row.game : '';
    const symbolPath = 'path://' + svgDef.path;
    const sizeX      = svgDef.size_X;
    const sizeY      = svgDef.size_Y;

    let kpis = EMPTY_KPIS;
    if (showType === 'Table' && tableBucket) {
      const computed = computeKpis(
        tableBucket,
        tableBucket.gametype + tableID,
        selectedPricingOptions
      );
      // Legacy quirk preserved: in Table mode, when the price filter
      // doesn't match, we emit the *empty* sentinel row (not the
      // computed one) so the visualMap colors the point grey/closed.
      if (computed.is_meet_price_filter) kpis = computed;
    } else if (showType === 'Pit' && byPit[pit]) {
      // Pit / Zone modes: is_meet_price_filter is just a tag column —
      // KPIs are emitted regardless of filter match.
      kpis = computeKpis(byPit[pit], 'Pit ' + pit, selectedPricingOptions);
    } else if (showType === 'Zone' && byZone[zone] && zone !== 'other') {
      kpis = computeKpis(byZone[zone], 'Zone ' + zone, selectedPricingOptions);
    }

    scatterData.push([
      x, y, r, game, symbolPath, sizeX, sizeY,                                // 0..6
      kpis.drop_per_openday, kpis.win_per_openday,                             // 7..8
      kpis.patronhrs_per_openday, kpis.openhours_per_openday,                  // 9..10
      kpis.drop_per_openhour, kpis.win_per_openhour,                           // 11..12
      kpis.patronhrs_per_openhour, kpis.table_minimum,                         // 13..14
      kpis.avgbet, kpis.table_label,                                           // 15..16
      kpis.drop_per_floorday, kpis.win_per_floorday,                           // 17..18
      // Slot 20 was openhours_per_floorday (never exposed as a KPI);
      // repurposed for "Active % (Min by Min)" so the same dim works
      // across Avg and 24-hr scatter tuples.
      kpis.patronhrs_per_floorday, kpis.active_pct_min,                        // 19..20
      kpis.act_tablemin,                                                       // 21
      kpis.theo_per_floorday, kpis.theo_per_openday, kpis.theo_per_openhour,   // 22..24
      kpis.is_meet_price_filter,                                               // 25
      kpis.hands_per_hour, kpis.wagered_hands_per_hour, kpis.free_hands_per_hour, // 26..28
      kpis.open_status, kpis.open_percentage,                                  // 29..30
      zone, pit, tableID,                                                      // 31..33
      (tableBucket && tableBucket.area) || row.Location || '',                 // 34 — area (metadata)
      // 35 — sub_segment (metadata). Drives the legend column resolver
      // (see legendGroupForSubSegment); kept as a plain string so the
      // dashboard's scatterArea / recordArea helpers can read it
      // directly without another lookup. '' when the API didn't carry
      // a sub_segment for this row — handler treats that as "exclude
      // from legend" per the new semantic.
      (tableBucket && tableBucket.sub_segment) || '',                          // 35
      // Spread KPIs (new). See computeKpis above for the formulas.
      kpis.spread_per_floorday, kpis.spread_per_openday, kpis.actual_vs_spread, // 36..38
      kpis.theo_win_per_floorday,                                              // 39 — Theo/Win per floorday
    ]);
  }

  // eslint-disable-next-line no-console
  console.info(
    `[Perf/timing] buildAvgScatterData(${showType}): ${(_now() - _t0).toFixed(0)}ms, ` +
      `rows_in=${filteredData.length}, tables_out=${scatterData.length}`
  );
  return scatterData;
}
