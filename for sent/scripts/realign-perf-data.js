// Reshape the three bundled Performance-Heatmap JSON fixtures into
// the aligned schema. Each input file is preserved as `*.legacy.json`
// the first time the script runs, so this is safe to re-run.
//
// Run from project root:  `node scripts/realign-perf-data.js`
//
// Aligned schemas (see plan):
//   Daily   = date, area, pit, table, gametype, dow, weekstart,
//             patronhrs, openhours, openday, floorday,
//             drop, turnover, win, theo, watm_total,
//             patron_hands, game_count, active_game_count, free_game_count,
//             tablemin
//   Hourly       = date, hour, area, pit, table, gametype, dow, weekstart,
//             patronhrs, openhours, activehours,
//             drop, turnover, win, theo, watm_total,
//             patron_hands, game_count, active_game_count, free_game_count,
//             spread, floorday,
//             tablemin
//
// Hand-count trio is now aligned across all 3 sources:
//   game_count        = total hands dealt (= active + free)
//   active_game_count = hands with wager (paying-patron hands)
//   free_game_count   = free / promo hands without wager
//
// Note: `zone` was removed from all 3 data sources. Zone is resolved
// per-table from config.json (see TABLE_ZONE_MAP in
// PerformanceDashboard.js + zoneByTable in dataProcessing.js). This
// keeps zone re-orgs a single-file edit (config) instead of a data-
// pipeline change.
//
// Note: `wager` was renamed to `turnover` (the sum of all bet amounts).
// Legacy snapshots still carry the field as `wager`; this script reads
// from `d.wager` and emits the aligned `turnover` field.
//
// Note: `patron_hands` is the avgbet denominator (turnover / patron_hands).
// Definition: Σ over hands of (distinct patrons that bet on that hand).
// If 3 patrons bet on one hand, that hand contributes 3.
//
// NOT the same as `game_count` (legacy: `wager_game`), which is the
// count of hands where any wager occurred. They differ whenever a
// table hosts multi-seat play — patron_hands ≥ game_count. Using
// game_count as a fallback understates the denominator and overstates
// avgbet, so we deliberately do NOT substitute it. Legacy fixtures
// that lack patron_hands will emit 0, causing avgbet to render as a
// sentinel ("no data") in fixture mode until the API populates the
// real value.
//
// `tablemin` is a string like "500:1,1000:1" — the parser at the data
// boundary turns it back into a histogram.

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.resolve(__dirname, '..', 'src', 'performance', 'data');

// ---------- helpers ----------------------------------------------------

// Build a "min:weight,min:weight" string from either an object
// ({ "500": 1, "1000": 2 }) or a row that carries `tablemin_<min>`
// columns. Weights of zero are skipped to keep the string compact.
function buildTableminString(weights) {
  return Object.entries(weights)
    .filter(([, v]) => Number(v) > 0)
    .map(([k, v]) => `${k}:${Number(v)}`)
    .join(',');
}

// Pick every `tablemin_<N>` numeric column off a row and return the
// {min: weight} histogram. The first capture group is the min value.
function extractTableminColumns(row) {
  const out = {};
  for (const k of Object.keys(row)) {
    const m = k.match(/^tablemin_(\d+)$/);
    if (m) {
      const v = Number(row[k]);
      if (Number.isFinite(v) && v !== 0) out[m[1]] = v;
    }
  }
  return out;
}

function safeJsonRead(p) {
  if (!fs.existsSync(p)) {
    throw new Error('input file missing: ' + p);
  }
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function backupIfFirstRun(p) {
  const legacy = p.replace(/\.json$/, '.legacy.json');
  if (!fs.existsSync(legacy)) {
    fs.copyFileSync(p, legacy);
    console.log('backup', path.relative(process.cwd(), legacy));
  }
}

// ---------- daily ------------------------------------------------------

function transformDaily(rows) {
  return rows.map((d) => {
    // tablemin2 may already be an object like {"500":1,"1000":1};
    // some rows could be empty/missing — coerce defensively.
    const histObj =
      d.tablemin2 && typeof d.tablemin2 === 'object' ? d.tablemin2 : {};
    const wagerGame = Number(d.wager_game) || 0;
    return {
      date:            d.date,
      area:            d.area,
      pit:             String(d.pit),
      table:           String(d.newtable),
      gametype:        d.gametype,
      // zone removed — resolved per-table from config.json.
      dow:             d.dow,
      weekstart:       (d.weekstart || '').slice(0, 10), // strip "T00:00:00"
      patronhrs:       Number(d.patronhrs)     || 0,
      openhours:       Number(d.adj_openhours) || 0,
      openday:         Number(d.openday)       || 0,
      floorday:        Number(d.floorday)      || 0,
      // `drop` (chips dropped at the table) and `turnover` (sum of all
      // bet amounts across hands; legacy field name was `wager`) are
      // distinct fields in the daily source — the early alignment
      // dropped `drop` by mistake, breaking every Drop-per-* KPI in
      // the Avg view. Restored here.
      drop:            Number(d.drop)          || 0,
      turnover:        Number(d.wager)         || 0,
      win:             Number(d.win)           || 0,
      theo:            Number(d.theo)          || 0,
      watm_total:      Number(d.WATM_Total)    || 0,
      // avgbet denominator. Distinct from active_game_count — see the
      // semantic note at the top of this file. NO fallback: emit 0
      // when legacy lacks it so fixture-mode avgbet correctly shows
      // as "no data" rather than a misleading hand-count-based value.
      patron_hands:    Number(d.patron_hands) || 0,
      // Aligned hand-count trio. Legacy daily source has `wager_game`
      // (hands with wager) and `free_game` (free hands) — map them to
      // active_game_count and free_game_count, and derive game_count
      // as the sum so the relationship holds at the row level.
      active_game_count: wagerGame,
      free_game_count:   Number(d.free_game) || 0,
      game_count:        wagerGame + (Number(d.free_game) || 0),
      // Minute-level granularity for "Active % (Min by Min)" KPI.
      // Emit 0 when the legacy snapshot doesn't carry them — the
      // live API will populate the real values.
      open_minutes:      Number(d.open_minutes)   || 0,
      active_minutes:    Number(d.active_minutes) || 0,
      tablemin:        buildTableminString(histObj),
    };
  });
}

// ---------- hourly + WD (same shape) ----------------------------------

function transformHourly(rows) {
  return rows.map((d) => {
    const histObj = extractTableminColumns(d);
    return {
      date:               d.date,
      hour:               Number(d.hour),
      area:               d.area,
      pit:                String(d.pit),
      table:              String(d.newtable),
      gametype:           d.gametype,
      // zone removed — resolved per-table from config.json.
      dow:                d.dow,
      weekstart:          (d.weekstart || '').slice(0, 10),
      patronhrs:          Number(d.patronhrs)     || 0,
      openhours:          Number(d.adj_openhours) || 0,
      activehours:        Number(d.activehours)   || 0,
      // For hourly, the source carries `wager` (== `total_turnover`)
      // but no separate `drop` field — bets and drop are conceptually
      // the same at hour grain. Mirror that into the aligned `drop`
      // and `turnover` columns so the hourly aggregator can compute
      // "Drop per *" KPIs from a single field without special-casing.
      drop:               Number(d.drop) || Number(d.wager) || Number(d.total_turnover) || 0,
      turnover:           Number(d.wager) || Number(d.total_turnover) || 0,
      win:                Number(d.win)           || 0,
      // Hourly source calls it `theo_win`; the aligned name is `theo`.
      theo:               Number(d.theo_win)      || 0,
      watm_total:         Number(d.WATM_Total)    || 0,
      // avgbet denominator. Distinct from active_game_count — see
      // the semantic note at the top of this file. NO fallback: emit
      // 0 when legacy lacks it so fixture-mode avgbet correctly shows
      // as "no data" rather than a misleading active_game_count-based
      // value.
      patron_hands:       Number(d.patron_hands) || 0,
      // Aligned hand-count trio. Legacy hourly fixtures don't carry
      // these — emit zeros for column-shape stability; the API will
      // populate them.
      //   game_count        = total hands dealt (active + free)
      //   active_game_count = hands with wager
      //   free_game_count   = free / promo hands
      game_count:         Number(d.game_count)         || 0,
      active_game_count:  Number(d.active_game_count)  || 0,
      free_game_count:    Number(d.free_game_count)    || 0,
      spread:             Number(d.spread)             || 0,
      // floorday = per-hour floor-capacity (table_capacity = Σ floorday).
      // The legacy source called the same field `floortable`; read
      // whichever it provides and emit a single unified `floorday`.
      floorday:           Number(d.floorday) || Number(d.floortable) || 0,
      // Minute-level granularity for "Active % (Min by Min)" KPI.
      // Emit 0 when the legacy snapshot doesn't carry them — the
      // live API will populate the real values.
      open_minutes:       Number(d.open_minutes)   || 0,
      active_minutes:     Number(d.active_minutes) || 0,
      tablemin:           buildTableminString(histObj),
    };
  });
}

// ---------- run --------------------------------------------------------

const inputs = [
  { kind: 'daily',  file: 'data_cod.json',        transform: transformDaily },
  { kind: 'hourly', file: 'data_hourly_cod.json', transform: transformHourly },
  // WD source retired — WD data is now merged into the hourly stream
  // upstream (historical from hourly table, today from a live WD feed),
  // so the client only consumes a single hourly endpoint.
];

for (const { kind, file, transform } of inputs) {
  const p = path.join(DATA_DIR, file);
  if (!fs.existsSync(p)) {
    console.warn('skip (missing)', file);
    continue;
  }
  backupIfFirstRun(p);
  const legacyPath = p.replace(/\.json$/, '.legacy.json');
  // Always transform FROM the legacy snapshot so the script is
  // idempotent (re-running won't double-transform a previous output).
  const raw = safeJsonRead(legacyPath);
  const out = transform(raw);
  fs.writeFileSync(p, JSON.stringify(out));
  const firstKeys = out[0] ? Object.keys(out[0]).join(', ') : '(empty)';
  console.log(
    'aligned',
    kind.padEnd(7),
    String(out.length).padStart(7),
    'rows  |  fields:',
    firstKeys
  );
}

console.log('done');
