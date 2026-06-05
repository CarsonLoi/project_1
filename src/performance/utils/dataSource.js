// Performance Heatmap — unified data source.
//
// Two fetchers (daily / hourly). Each:
//   1. Tries the configured API endpoint.
//   2. On error / non-200 / empty payload, falls back to the bundled
//      aligned JSON fixture so dev mode is never blank.
//   3. Normalises at the boundary — numeric coercion, id → string,
//      date trim — so processors can read fields without per-call
//      cleanup.
//
// (The WD endpoint was retired — WD data is now merged into the hourly
// stream upstream: historical hours come from the daily-rolled hourly
// table, today's partial hours come from a live WD source. The client
// only needs one hourly fetcher.)
//
// Configure endpoints at build time via CRA env vars:
//   REACT_APP_DAILY_API_URL=http://10.100.122.41:9000/cod_daily
//   REACT_APP_HOURLY_API_URL=http://10.100.122.41:9000/cod_hourly
//
// Configure per-call behaviour with the options object:
//   fetchDailyData({ url, timeoutMs, fallback })

import axios from 'axios';
import dayjs from 'dayjs';

// ---------------------------------------------------------------------
// Default endpoints (overridable via env vars or per-call `url`).
// ---------------------------------------------------------------------

const DEFAULT_DAILY_API_URL =
  process.env.REACT_APP_DAILY_API_URL ||
  'http://10.100.122.41:9000/cod_daily';

const DEFAULT_HOURLY_API_URL =
  process.env.REACT_APP_HOURLY_API_URL ||
  'http://10.100.122.41:9000/cod_hourly';

export const PERF_DEFAULT_URLS = {
  daily:  DEFAULT_DAILY_API_URL,
  hourly: DEFAULT_HOURLY_API_URL,
};

// ---------------------------------------------------------------------
// Timezone contract
// ---------------------------------------------------------------------
//
// The wire format declares that `date` is YYYY-MM-DD in **local Macau
// time (HKT, UTC+8)** and `hour` is an integer 0..23 in the same local
// zone. The server is the single source of truth.
//
// If the API misbehaves and serializes timestamps with a UTC offset
// (or `Z`), the `hour` column comes back shifted (e.g. `8 HKT` →
// `0 UTC`) and downstream metrics line up against the wrong hours. As
// a safety net, every fetcher accepts a `tzShiftHours` option (and
// the same env-var default) that shifts every row's (date, hour) pair
// by N hours, wrapping across midnight when needed. Set it to `+8`
// to undo a UTC serialization.
//
//   REACT_APP_TZ_SHIFT_HOURS=8        // build-time default
//   fetchHourlyData({ tzShiftHours: 8 })  // per-call override
//
// Default is `0` (no shift) so installations whose API already
// returns HKT see no behavior change.
const DEFAULT_TZ_SHIFT_HOURS = Number(process.env.REACT_APP_TZ_SHIFT_HOURS) || 0;

// ---------------------------------------------------------------------
// Aligned-schema numeric field lists. Used by the boundary normaliser
// so downstream code can rely on `row.field` being a number (or 0 if
// the source sent null / a non-numeric string).
// ---------------------------------------------------------------------

const DAILY_NUMERIC_FIELDS = [
  'patronhrs', 'openhours', 'openday', 'floorday',
  // `turnover` (was `wager`) — the sum of all bet amounts. Renamed for
  // alignment with business terminology; avgbet = turnover / patron_hands.
  'drop', 'turnover', 'win', 'theo', 'watm_total',
  // patron_hands = Σ over hands of (distinct patrons that bet on that
  // hand). Avgbet denominator. Distinct from active_game_count which
  // counts hands (not patron-bets).
  'patron_hands',
  // Hand-count trio — semantically aligned across daily / hourly / wd:
  //   game_count        = total hands dealt (= active + free)
  //   active_game_count = hands with wager (paying-patron hands)
  //   free_game_count   = free / promo hands without wager
  'game_count', 'active_game_count', 'free_game_count',
  // Minute-by-minute granularity for the "Active % (Min by Min)" KPI:
  //   active_minutes / open_minutes * 100 = fraction of open time the
  //   table actually had patrons. More precise than activehours /
  //   openhours when wanting per-minute resolution.
  'open_minutes', 'active_minutes',
];

// Hourly and WD share the same shape (per the aligned schema).
const HOURLY_NUMERIC_FIELDS = [
  'hour',
  'patronhrs', 'openhours', 'activehours',
  'drop', 'turnover', 'win', 'theo', 'watm_total',
  'patron_hands',
  // Same hand-count trio as daily (game_count = active + free).
  'game_count', 'active_game_count', 'free_game_count',
  // floorday = per-hour floor-capacity (table_capacity = Σ floorday).
  // (The legacy source called this `floortable`; it's the same thing —
  // unified to `floorday` here.)
  'spread', 'floorday',
  // Minute-by-minute granularity for the "Active % (Min by Min)" KPI
  // (active_minutes / open_minutes * 100). Same fields as daily.
  'open_minutes', 'active_minutes',
];

// Exported so processors and tests can inspect / extend (e.g. when a
// new KPI requires a new numeric field, append it here so it gets the
// same boundary coercion).
export const PERF_NUMERIC_FIELDS = {
  daily:  DAILY_NUMERIC_FIELDS,
  hourly: HOURLY_NUMERIC_FIELDS,
};

// ---------------------------------------------------------------------
// tablemin helpers — shared by all three processors.
//
// Wire format: "<min>:<weight>,<min>:<weight>,…"
//   • Daily   — weight = days-worth that the table sat at that min.
//   • Hourly  — weight = hours-worth (fractional ok) at that min.
//   • WD      — weight = same hour units as hourly (sum-then-mode at
//                aggregation time).
//
// The semantic differences don't matter to the helpers; they only
// care that the histogram values are additive.
// ---------------------------------------------------------------------

// ---------------------------------------------------------------------
// Day-of-week (dow) bucketing — single source of truth.
//
// The API may return a legacy two-bucket value ('WD' / 'WE'). For the
// dashboard we want the finer 4-bucket grouping {WD, Fri, Sat, Sun}
// (Mon-Thu collapse into WD). Deriving from `date` here means every
// downstream consumer sees the same value — the dashboard's DoW filter,
// the WD scatter view's grouping, and the Hourly Demand chart all agree.
//
// Convention:
//   Mon-Thu → 'WD'
//   Fri     → 'Fri'
//   Sat     → 'Sat'
//   Sun     → 'Sun'
// ---------------------------------------------------------------------
export const DOW_BUCKETS = ['WD', 'Fri', 'Sat', 'Sun'];

export function dowFromDate(dateStr) {
  if (!dateStr) return '';
  // Parse as UTC midnight so timezone shifts never roll the weekday.
  const d = new Date(String(dateStr).slice(0, 10) + 'T00:00:00Z');
  const wd = d.getUTCDay(); // 0=Sun, 1=Mon, …, 6=Sat
  if (Number.isNaN(wd)) return '';
  if (wd === 0) return 'Sun';
  if (wd === 5) return 'Fri';
  if (wd === 6) return 'Sat';
  return 'WD';
}

// ---------------------------------------------------------------------
// Config ↔ data join key.
//
// A bare table number is NOT unique — the same number is reused across
// gametypes (e.g. "100" exists as both a BA and a BJ table). Joining on
// table alone collides those rows. Always key on gametype + table.
//
// Config rows carry the gametype as `game`; data rows carry it as
// `gametype` — pass whichever applies. The '|' separator keeps the key
// unambiguous regardless of id length.
// ---------------------------------------------------------------------
export function gametypeTableKey(gametype, table) {
  return String(gametype) + '|' + String(table);
}

/** Parse the wire-format string into a histogram object keyed by min. */
export function parseTablemin(s) {
  if (!s) return {};
  const out = {};
  for (const seg of String(s).split(',')) {
    const [k, v] = seg.split(':');
    const key = parseInt(k, 10);
    const val = parseFloat(v);
    if (Number.isFinite(key) && Number.isFinite(val) && val > 0) {
      out[key] = (out[key] || 0) + val;
    }
  }
  return out;
}

/** Merge `from` into `into` (in place). Returns `into` for chaining. */
export function addTablemin(into, from) {
  if (!from) return into;
  for (const k of Object.keys(from)) {
    into[k] = (into[k] || 0) + from[k];
  }
  return into;
}

/**
 * Mode of a histogram (or a wire-format string). Returns the
 * numeric key with the highest accumulated weight; ties resolved by
 * the larger key (so when two table-mins are equally common, the
 * higher min wins — same convention the legacy code used).
 *
 * Examples:
 *   tableMinimumMode("500:2,1000:4") === 1000
 *   tableMinimumMode({500: 2, 1000: 4}) === 1000
 *   tableMinimumMode("")              === 0
 */
export function tableMinimumMode(histOrString) {
  const h = typeof histOrString === 'string'
    ? parseTablemin(histOrString)
    : (histOrString || {});
  let best = 0;
  let bestWeight = -Infinity;
  for (const k of Object.keys(h)) {
    const key = parseInt(k, 10);
    const w = h[k];
    if (w > bestWeight || (w === bestWeight && key > best)) {
      bestWeight = w;
      best = key;
    }
  }
  return best;
}

// ---------------------------------------------------------------------
// Boundary normaliser — one pass per row at fetch time.
// ---------------------------------------------------------------------

// Shift a (date, hour) pair by N hours. Wraps across midnight (so
// `hour=22, shift=+8` correctly advances `date` by one day and yields
// `hour=6`). For rows without an `hour` field, the date is shifted
// using midnight as the anchor — this keeps daily rows aligned when
// the API has done a UTC conversion on a per-day-midnight timestamp.
function shiftDateHour(dateStr, hour, shiftHours) {
  if (!shiftHours) return { date: dateStr, hour };
  if (!dateStr)    return { date: dateStr, hour };
  const baseHour = (hour == null || Number.isNaN(hour)) ? 0 : Number(hour);
  const d = dayjs(dateStr).add(baseHour + shiftHours, 'hour');
  return {
    date: d.format('YYYY-MM-DD'),
    hour: hour == null ? hour : d.hour(),
  };
}

function normalizeRows(rows, numericFields, opts = {}) {
  if (!Array.isArray(rows)) return [];
  const tzShift = Number(opts.tzShiftHours);
  const shouldShift = Number.isFinite(tzShift) && tzShift !== 0;

  return rows.map((row) => {
    const out = { ...row };

    for (const f of numericFields) {
      if (out[f] !== undefined && out[f] !== null) {
        const n = Number(out[f]);
        out[f] = Number.isNaN(n) ? 0 : n;
      }
    }

    // Date → YYYY-MM-DD (strip any time component the API might send).
    if (out.date)      out.date      = dayjs(out.date).format('YYYY-MM-DD');
    if (out.weekstart) out.weekstart = dayjs(out.weekstart).format('YYYY-MM-DD');

    // Optional timezone shift — only runs when the caller explicitly
    // asks for it. See the "Timezone contract" comment at the top of
    // this file for when to enable.
    if (shouldShift && out.date) {
      const shifted = shiftDateHour(out.date, out.hour, tzShift);
      out.date = shifted.date;
      if (out.hour !== undefined) out.hour = shifted.hour;
    }

    // Id-like fields stay strings (keeps Map keys / Set comparisons
    // stable across data sources that vary between int and string).
    if (out.table !== undefined) out.table = String(out.table);
    if (out.pit   !== undefined) out.pit   = String(out.pit);

    // Re-derive dow from the (possibly tz-shifted) date so every row is
    // in the unified {WD, Fri, Sat, Sun} bucketing — see DOW_BUCKETS /
    // dowFromDate above. Overrides whatever the API sent (typically the
    // legacy 'WD' / 'WE' two-bucket value).
    if (out.date) out.dow = dowFromDate(out.date);

    // tablemin stays as the wire-format string here. Processors call
    // parseTablemin() inside the aggregation loop so the histogram
    // is built once per bucket, not per row.

    return out;
  });
}

// ---------------------------------------------------------------------
// Generic fetch + fallback wrapper. Same shape as wdDataSource so
// behavior matches what consumers already expect (warns on API
// failure, returns the fixture, never throws when fallback is on).
// ---------------------------------------------------------------------

// Timing helper — wall-clock ms via performance.now() when available,
// falls back to Date.now(). Logged as a single line so console filters
// like `[Perf/timing]` capture the full picture in one grep.
const _now = (typeof performance !== 'undefined' && performance.now)
  ? () => performance.now()
  : () => Date.now();

async function genericFetch({
  kind,
  url,
  timeoutMs,
  fallback,
  fallbackData,
  numericFields,
  tzShiftHours,
}) {
  const opts = { tzShiftHours };
  const t0 = _now();
  try {
    const res = await axios({
      url,
      method: 'get',
      timeout: timeoutMs,
      headers: { 'Content-Type': 'application/json' },
    });
    const tNet = _now();
    if (res.status !== 200) {
      throw new Error(`HTTP ${res.status}`);
    }
    if (!Array.isArray(res.data)) {
      throw new Error('payload is not an array');
    }
    // Rough payload size (only meaningful when axios returns the raw
    // string; with JSON auto-parse we estimate via JSON.stringify cost).
    // Skip the stringify on huge arrays — it doubles the cost of just
    // measuring. Cap at 50k rows for the size estimate.
    let approxBytes = -1;
    if (res.data.length <= 50000) {
      try {
        approxBytes = JSON.stringify(res.data).length;
      } catch { /* ignore */ }
    }
    const rows = normalizeRows(res.data, numericFields, opts);
    const tDone = _now();
    // eslint-disable-next-line no-console
    console.info(
      `[Perf/${kind}] loaded ${rows.length} rows from API` +
        (opts.tzShiftHours ? ` (tz-shift ${opts.tzShiftHours >= 0 ? '+' : ''}${opts.tzShiftHours}h)` : '')
    );
    // eslint-disable-next-line no-console
    console.info(
      `[Perf/timing] ${kind} fetch: ` +
        `network=${(tNet - t0).toFixed(0)}ms, ` +
        `normalize=${(tDone - tNet).toFixed(0)}ms, ` +
        `total=${(tDone - t0).toFixed(0)}ms, ` +
        `rows=${rows.length}` +
        (approxBytes > 0 ? `, ~${(approxBytes / 1024 / 1024).toFixed(2)}MB` : '')
    );
    return rows;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(`[Perf/${kind}] API fetch failed: ${err.message}`);
    if (fallback) {
      // eslint-disable-next-line no-console
      console.warn(
        `[Perf/${kind}] falling back to bundled JSON (${fallbackData.length} rows)`
      );
      const tFb0 = _now();
      // Fixtures are already in HKT — don't double-shift on fallback.
      const rows = normalizeRows(fallbackData, numericFields, { tzShiftHours: 0 });
      const tFb1 = _now();
      // eslint-disable-next-line no-console
      console.info(
        `[Perf/timing] ${kind} fallback normalize=${(tFb1 - tFb0).toFixed(0)}ms, rows=${rows.length}`
      );
      return rows;
    }
    throw err;
  }
}

// ---------------------------------------------------------------------
// Public fetchers.
// ---------------------------------------------------------------------

/**
 * Daily — one row per (date × table). See aligned schema in
 * scripts/realign-perf-data.js.
 */
export async function fetchDailyData({
  url = DEFAULT_DAILY_API_URL,
  timeoutMs = 80000,
  fallback = true,
  tzShiftHours = DEFAULT_TZ_SHIFT_HOURS,
} = {}) {
  // Local require so the fixture is only resolved (and bundled) when
  // fallback is actually wired in by the caller. CRA / Webpack treats
  // require() of a JSON path as a static import, so it still gets
  // tree-bundled — no runtime IO.
  const fallbackData = require('../data/data_cod.json');
  return genericFetch({
    kind: 'daily',
    url,
    timeoutMs,
    fallback,
    fallbackData,
    numericFields: DAILY_NUMERIC_FIELDS,
    tzShiftHours,
  });
}

/**
 * Hourly — one row per (date × hour × table).
 */
export async function fetchHourlyData({
  url = DEFAULT_HOURLY_API_URL,
  timeoutMs = 80000,
  fallback = true,
  tzShiftHours = DEFAULT_TZ_SHIFT_HOURS,
} = {}) {
  const fallbackData = require('../data/data_hourly_cod.json');
  return genericFetch({
    kind: 'hourly',
    url,
    timeoutMs,
    fallback,
    fallbackData,
    numericFields: HOURLY_NUMERIC_FIELDS,
    tzShiftHours,
  });
}
