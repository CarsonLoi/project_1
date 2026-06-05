// Trend Seeker data source.
//
// Production: fetches walker hand-by-hand rows for a given date via axios,
//             then transforms them into the per-minute frame shape that
//             the Trend Seeker dashboard consumes (same shape as
//             generateTimeSeries / loadRealData).
//
// Demo / offline: falls back to the synthetic generateTimeSeries simulator
//                 whenever the API is unreachable, returns an empty list,
//                 or fails to parse.
//
// Configure the endpoint at build time via CRA env vars:
//   REACT_APP_TREND_API_URL=http://10.100.122.41:9000/cod_walker_hands
//
// Configure the fetch behavior at runtime by passing options:
//   fetchTrendData({ date, url, timeoutMs, fallback })
//
// ----------------------------------------------------------------------------
// Walker row schema (one row per hand)
// ----------------------------------------------------------------------------
//   table             — table code (string)
//   date              — YYYY-MM-DD
//   segment           — "MS" | "PM"
//   pit               — pit number
//   num_players       — 0..7
//   turnover          — total bet placed on the hand
//   theo_win          — theoretical win for the hand
//   table_min         — table minimum bet active on this hand (USD)
//   game_start_dtm    — ISO timestamp the hand started
//   game_end_dtm      — ISO timestamp the hand ended
//   shoe_id           — increments per fresh shoe at the table
//   shoe_hand         — 1-indexed position of this hand within the shoe
//   player_1st_card   — 2-char compact: "<rank><suit>", e.g. "As" (Ace of
//                       Spades), "Th" (Ten of Hearts), "Kc", "2d".
//                         rank ∈ {A, 2, 3, 4, 5, 6, 7, 8, 9, T, J, Q, K}
//                         suit ∈ {s = Spade, h = Heart, c = Club, d = Diamond}
//   player_2nd_card
//   player_3rd_card   — nullable (only dealt when baccarat 3rd-card rules apply)
//   banker_1st_card
//   banker_2nd_card
//   banker_3rd_card   — nullable
// ----------------------------------------------------------------------------

import axios from 'axios';
import dayjs from 'dayjs';
import { buildFloor } from './floorLayout';
import { analyzeHand } from './trendAnalyzer';
import { generateTimeSeries } from './timeSeriesData';
import { fetchTableStatus, isTableOpenAt } from './tableStatusSource';

const DEFAULT_API_URL =
  process.env.REACT_APP_TREND_API_URL ||
  'http://10.100.122.41:9000/cod_walker_hands';

const MINUTE_MS = 60 * 1000;

// Walker timestamps arrive as UTC (`...Z`). The floor / pit operate in
// Macau time (UTC+8), so every wall-clock value the dashboard surfaces
// — frame.hour, the FLOOR CLOCK, tooltip times — is converted via this
// offset. Pure ms-since-epoch maths (sorting, range, minute bucketing)
// stays timezone-agnostic.
const HKT_OFFSET_MS = 8 * 60 * 60 * 1000;
const hourInHKT = (epochMs) =>
  new Date(epochMs + HKT_OFFSET_MS).getUTCHours();

// ----------------------------------------------------------------------------
// Baccarat hand resolution from the six card slots
// ----------------------------------------------------------------------------

// Card → numeric baccarat value 0..9.
//   A = 1
//   2..9 = face value
//   T (10), J, Q, K = 0
//
// Accepts the compact 2-char format "<rank><suit>" (e.g. "As", "Th",
// "Kc", "2d") and falls back to the verbose "Suit Rank" form
// (e.g. "Diamond A", "Heart 10") so legacy fixtures still parse.
function cardValue(card) {
  if (!card) return 0;
  const s = String(card).trim();
  if (!s) return 0;

  // Pick the rank token:
  //   - "As" / "Th" / "10"            -> first segment (no whitespace)
  //   - "Diamond A" / "Heart 10"      -> last segment after whitespace
  const rank = /\s/.test(s)
    ? s.split(/\s+/).pop().toUpperCase()
    : s.charAt(0).toUpperCase();

  if (rank === 'A') return 1;
  if (rank === 'T' || rank === '10' || rank === 'J' || rank === 'Q' || rank === 'K') return 0;
  const n = parseInt(rank, 10);
  return Number.isFinite(n) && n >= 2 && n <= 9 ? n : 0;
}

// Resolve a hand to 'B' (Banker), 'P' (Player), or 'T' (Tie).
// Suit is ignored — only ranks matter for the result.
function resolveResult(row) {
  const p =
    (cardValue(row.player_1st_card) +
      cardValue(row.player_2nd_card) +
      cardValue(row.player_3rd_card)) %
    10;
  const b =
    (cardValue(row.banker_1st_card) +
      cardValue(row.banker_2nd_card) +
      cardValue(row.banker_3rd_card)) %
    10;
  if (p > b) return 'P';
  if (b > p) return 'B';
  return 'T';
}

function handTimeMs(row) {
  const t = row.game_start_dtm || row.hand_time || row.game_end_dtm;
  if (!t) return null;
  const d = dayjs(t);
  return d.isValid() ? d.valueOf() : null;
}

// ----------------------------------------------------------------------------
// Walker rows → minute-level frames (matches generateTimeSeries shape)
// ----------------------------------------------------------------------------

export function transformWalkerHands(rawHands, floorTables, statusMap = null) {
  if (!Array.isArray(rawHands) || rawHands.length === 0) return null;
  if (!Array.isArray(floorTables) || floorTables.length === 0) return null;

  // Index floor by table code (the walker `table` field).
  const byCode = new Map();
  for (const t of floorTables) byCode.set(String(t.code), t);

  // Parse + filter to tables we know about. Compute result + avgBet up front.
  const cleaned = [];
  for (const r of rawHands) {
    const code = String(r.table);
    const floor = byCode.get(code);
    if (!floor) continue;

    const time = handTimeMs(r);
    if (time == null) continue;

    const num = Number(r.num_players) || 0;
    const turnover = Number(r.turnover) || 0;

    const rawMin = Number(r.table_min);
    cleaned.push({
      tableCode: code,
      tableId: floor.id,
      time,
      shoeId: Number(r.shoe_id) || 0,
      shoeHand: Number(r.shoe_hand) || 0,
      result: resolveResult(r),
      // Round defensively: the visualMap piecewise buckets expect
      // integers 0..7. Floats (e.g. from JSON parse drift) fall
      // through every piece and ECharts paints them with the default
      // series color — which is red. Clamp + round eliminates that.
      headcount: Math.max(0, Math.min(7, Math.round(num))),
      avgBet: num > 0 ? turnover / num : turnover,
      tableMin: Number.isFinite(rawMin) && rawMin > 0 ? rawMin : null,
    });
  }

  if (cleaned.length === 0) return null;

  // Sort by (tableId, time) for forward-fill.
  cleaned.sort((a, b) =>
    a.tableId === b.tableId ? a.time - b.time : a.tableId - b.tableId
  );

  const byTable = new Map();
  for (const h of cleaned) {
    if (!byTable.has(h.tableId)) byTable.set(h.tableId, []);
    byTable.get(h.tableId).push(h);
  }

  // Global time window, snapped to whole minutes.
  let tMin = Infinity;
  let tMax = -Infinity;
  for (const h of cleaned) {
    if (h.time < tMin) tMin = h.time;
    if (h.time > tMax) tMax = h.time;
  }
  const t0 = Math.floor(tMin / MINUTE_MS) * MINUTE_MS;
  const t1 = Math.ceil((tMax + 1) / MINUTE_MS) * MINUTE_MS;
  const minutes = Math.max(1, Math.round((t1 - t0) / MINUTE_MS));

  // Per-table running state.
  const state = new Map();
  for (const t of floorTables) {
    state.set(t.id, {
      table: t,
      shoeHistory: '',
      shoeId: null,
      shoeHand: 0,
      headcount: 0,
      avgBet: t.min,
      // tableMin is sourced strictly from the walker API's `table_min`
      // field. null until the first hand for this table arrives.
      tableMin: null,
      cursor: 0,
      prevSurprise: 0,
      prevLength: 0,
      // Prior-12 trend snapshot — the trend a WALK-UP PATRON would have
      // seen on the bead plate before the current hand was dealt, used
      // to test "does a strong visible trend attract patrons?" and to
      // back the tooltip's prior-hand mini Big Road. Window is the last
      // 12 B/P symbols of shoeHistory captured BEFORE appending the
      // current hand's result (see the loop below). Forward-fills with
      // the same semantics as the other state fields, so each emitted
      // frame carries the prior-trend that was visible at the time of
      // the most recent hand on the table.
      priorHistory12: '',
      priorSurprise: 0,
      priorPeriod: 0,
      priorLength: 0,
      priorMotif: '',
    });
  }

  // Trend-status classifier shared with the tooltip / analytics layer.
  // Thresholds mirror the existing HOT (≥5) / COOL-on-break logic so a
  // single vocabulary covers both "is the latest state hot" and "was
  // the prior-12 visible trend strong enough that patrons would have
  // noticed?". Kept inline (not a separate util) because it's a thin
  // bucketing rule on top of `surprise` — exposing it as a function
  // here means new callers can import it without touching another file.
  const trendStatusFor = (surprise) =>
    surprise >= 5 ? 'hot' : surprise >= 3 ? 'warm' : 'cool';

  const frames = [];
  for (let m = 0; m < minutes; m++) {
    const cutoff = t0 + (m + 1) * MINUTE_MS;
    const perTable = [];

    for (const t of floorTables) {
      const st = state.get(t.id);
      const arr = byTable.get(t.id) || [];

      // Advance through any hands that happened up to `cutoff`.
      while (st.cursor < arr.length && arr[st.cursor].time < cutoff) {
        const h = arr[st.cursor];
        if (st.shoeId !== h.shoeId) {
          st.shoeId = h.shoeId;
          st.shoeHistory = '';
        }
        // Capture the trend a walk-up patron would have seen BEFORE
        // this hand was dealt — window = last 12 B/P symbols of
        // shoeHistory at this point (which excludes the current hand
        // because we haven't appended it yet). Pairs with `headcount`
        // (recorded a few lines down from this same hand) so a single
        // row answers "patron saw trend X → headcount became Y". Ties
        // are already stripped from shoeHistory upstream, so this is
        // 12 non-tie hands, matching what's actually on the bead plate.
        const priorHistory12 = st.shoeHistory.slice(-12);
        const priorTrend = analyzeHand(priorHistory12 || 'B');
        st.priorHistory12 = priorHistory12;
        st.priorSurprise = priorTrend.surprise;
        st.priorPeriod = priorTrend.p;
        st.priorLength = priorTrend.L;
        st.priorMotif = priorTrend.motif;
        // Only B/P contribute to the trend history; ties pause it.
        if (h.result === 'B' || h.result === 'P') {
          st.shoeHistory += h.result;
        }
        st.shoeHand = h.shoeHand;
        st.headcount = h.headcount;
        st.avgBet = h.avgBet;
        // Forward-fill: only replace tableMin when the hand carries a real value.
        if (h.tableMin != null) st.tableMin = h.tableMin;
        st.cursor += 1;
      }

      const trend = analyzeHand(st.shoeHistory || 'B');
      const broken = st.prevSurprise >= 3 && trend.surprise < 3;

      // Closed flag — sourced from the status feed when available.
      // Tables without a status record (or with no status feed at all)
      // default to open, so missing data degrades gracefully.
      const isOpen = statusMap
        ? isTableOpenAt(statusMap, t.code, t0 + m * MINUTE_MS)
        : true;
      const closed = !isOpen;

      perTable.push({
        tableId: t.id,
        x: t.x,
        y: t.y,
        // `min` is null until the API has supplied a `table_min` for
        // this table at-or-before the current minute. UI sites must
        // tolerate null and render a placeholder ("—").
        min: st.tableMin == null ? null : Math.round(st.tableMin),
        pit: t.pit,
        label: t.label,
        headcount: closed ? 0 : st.headcount,
        history: st.shoeHistory.slice(-15),
        shoeHistory: st.shoeHistory,
        shoeId: st.shoeId,
        shoeHand: st.shoeHand,
        surprise: trend.surprise,
        period: trend.p,
        length: trend.L,
        motif: trend.motif,
        broken,
        brokenLength: broken ? st.prevLength : 0,
        newPlayers: 0,
        avgBet: Math.round(st.avgBet),
        closed,
        // Prior-12 trend snapshot — captured BEFORE the current hand's
        // result was appended to shoeHistory (see the cursor loop
        // above). Pairs with `headcount` on the same row to answer
        // "did a strong visible trend attract patrons?" without any
        // look-ahead bias. `priorTrendStatus` is the bucketed label
        // (hot ≥5 / warm ≥3 / cool) so consumers can filter / group
        // without re-deriving the threshold rule.
        priorHistory12: st.priorHistory12,
        priorSurprise: st.priorSurprise,
        priorPeriod: st.priorPeriod,
        priorLength: st.priorLength,
        priorMotif: st.priorMotif,
        priorTrendStatus: trendStatusFor(st.priorSurprise),
      });

      st.prevSurprise = trend.surprise;
      st.prevLength = trend.L;
    }

    const hour = hourInHKT(t0 + m * MINUTE_MS);
    frames.push({ minute: m, hour, perTable });
  }

  // Expose t0 + tz offset so the dashboard's FLOOR CLOCK can render the
  // actual wall-clock time of each minute in HKT.
  return {
    tables: floorTables,
    frames,
    startMs: t0,
    tzOffsetMs: HKT_OFFSET_MS,
  };
}

// ----------------------------------------------------------------------------
// Public fetch entry point
// ----------------------------------------------------------------------------

/**
 * Fetch the walker hand-by-hand dataset for the given date and transform it
 * into the dashboard's frame format.
 *
 * @param {object}   opts
 * @param {string|Date|dayjs.Dayjs} opts.date — required; coerced to YYYY-MM-DD
 * @param {string}   [opts.url]               — override the endpoint
 * @param {number}   [opts.timeoutMs]         — axios timeout (default 80000)
 * @param {boolean}  [opts.fallback]          — if true (default), fall back
 *                                              to generateTimeSeries on error
 *                                              so the dashboard never goes blank
 * @returns {Promise<{tables, frames}>}
 */
export async function fetchTrendData({
  date,
  url = DEFAULT_API_URL,
  timeoutMs = 80000,
  fallback = true,
} = {}) {
  const isoDate = date ? dayjs(date).format('YYYY-MM-DD') : null;
  const queryUrl = isoDate ? `${url}?date=${isoDate}` : url;

  try {
    // Walker hands + minute-level open/close status, fetched in parallel.
    // Status fetch has its own fallback (empty Map → "assume open"), so a
    // status outage never blocks the trend visualization.
    const [walkerRes, statusMap] = await Promise.all([
      axios({
        url: queryUrl,
        method: 'get',
        timeout: timeoutMs,
        headers: { 'Content-Type': 'application/json' },
      }),
      fetchTableStatus({ date: isoDate, timeoutMs }).catch(() => new Map()),
    ]);

    if (walkerRes.status !== 200) {
      throw new Error(`Trend API returned HTTP ${walkerRes.status}`);
    }

    const payload = walkerRes.data;
    if (!Array.isArray(payload)) {
      throw new Error('Trend API payload is not an array');
    }
    if (payload.length === 0) {
      throw new Error('Trend API returned empty payload');
    }

    // Pass the gaming date so the floor only includes tables whose config
    // row's [startdate, enddate] window covers that date — matches the
    // Performance Heatmap's config filter.
    const sim = transformWalkerHands(payload, buildFloor(isoDate), statusMap);
    if (!sim) throw new Error('Transform produced no frames');

    // eslint-disable-next-line no-console
    console.info(
      `[Trend] loaded ${payload.length} hands for ${isoDate} → ${sim.frames.length} frames` +
        ` (status records: ${statusMap.size} tables)`
    );
    return sim;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[Trend] live fetch failed:', err.message);
    if (fallback) {
      // eslint-disable-next-line no-console
      console.warn('[Trend] falling back to synthetic generateTimeSeries');
      return generateTimeSeries({ minutes: 240, seed: 1, startHour: 19 });
    }
    throw err;
  }
}

export const TREND_DEFAULT_API_URL = DEFAULT_API_URL;
