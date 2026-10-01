// Real-time Surveillance — six-endpoint data layer.
// ==================================================
// Every panel on the dashboard reads a PRE-AGGREGATED endpoint. The
// browser never receives raw rounds except for the one patron under
// investigation, which is fetched on demand rather than polled.
//
// The alternative — streaming rounds and aggregating client-side —
// would ship tens of thousands of records every 10 seconds to produce
// the same ~270 rows. PostgreSQL does GROUP BY better than we can.
//
// Endpoints and their exact column contracts:
//   docs/realtime-surveillance-data-contract.md
//
//   GET /realtime               → one row per table       (~87)
//   GET /realtime/patrons       → one row per patron      (~135)
//   GET /realtime/betmix        → one row per bet option  (~9-45)
//   GET /realtime/dealers       → one row per dealer      (~10)
//   GET /realtime/trend?bucket= → one row per time bucket (~32)
//   GET /realtime/patron/{id}   → that patron's rounds    (on demand)
//   GET /realtime/patron/{id}/bets?from&to       → that patron's bets (on demand, Player 360)
//   GET /realtime/patron/{id}/shoe-edges?from&to → edge per hand of their shoes (on demand, Player 360)
//
// Each endpoint degrades independently: a failure disables its own
// panel and leaves the rest of the dashboard alone. Where an endpoint
// is unconfigured entirely, a mock is synthesised so the dashboard
// runs end-to-end offline.

import { RT_ENDPOINTS, RT_FETCH_TIMEOUT_MS, GAMING_DAY_START_HOUR, FIXED_GAMES, PATRON_360 } from '../constants/rtConfig';
import { gametypeTableKey } from '../vendor/dataSource';
import { generateMockShoe, hashKey } from './shoeData';
import { mockEdgePaths, hotOption } from './edgeMock';
import { generateMockPatronHistory } from './patronBetsMock';

// ─────────────────────────────────────────────────────────────────────
// Transport
// ─────────────────────────────────────────────────────────────────────

async function fetchJson(url, { timeoutMs = RT_FETCH_TIMEOUT_MS } = {}) {
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
        const r = await fetch(url, { signal: ctrl.signal });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const body = await r.json();
        if (!Array.isArray(body)) throw new Error('expected a JSON array');
        return body;
    } finally {
        clearTimeout(to);
    }
}

// Wraps one endpoint: try the network, fall back to the mock builder.
// Returns { rows, live, error } rather than throwing, so one dead
// endpoint cannot take down the poll for the other five.
async function loadFeed(name, url, mockFn) {
    if (!url) return { rows: mockFn(), live: false, error: null };
    try {
        return { rows: await fetchJson(url), live: true, error: null };
    } catch (err) {
        // eslint-disable-next-line no-console
        console.warn(`[RT] ${name} feed failed, using mock:`, err.message);
        return { rows: mockFn(), live: false, error: err.message };
    }
}

export function isMockRealtimeFeed() { return !RT_ENDPOINTS.tables; }

// ─────────────────────────────────────────────────────────────────────
// Mock derivation
// ─────────────────────────────────────────────────────────────────────
// All six mocks are derived from ONE source — src/live/data/live_cod.mock.json
// — so the numbers reconcile across panels. A table alert can be clicked
// through to the patrons seated at it, and their wins sum to the table's
// loss. Deriving each mock independently would have been less code but
// would produce a demo where nothing adds up, which is worse than
// useless for a dashboard whose entire job is spotting discrepancies.
//
// Table metadata (area / pit / sub_segment / tablemin) is not in the
// live mock, so it is joined in from the realtime daily fixture. The two
// cover the same 87 tables on the same `gametype|table` key.

// Nominal house edge per gametype, used to derive theo for the mock.
// NOTE: keyed on the codes the feed actually uses — BA/BC/BJ/NC/SB.
// (src/live/utils/winAggregates.js keys baccarat as 'BAC', which never
// matches the feed; that bug is fixed separately.)
const MOCK_EDGE = { BA: 0.0125, BC: 0.0125, NC: 0.0125, BJ: 0.015, SB: 0.028 };
const edgeFor = (gt) => MOCK_EDGE[gt] ?? 0.015;

// Nominal true edge per bet option, for the synthetic house-edge block.
const HOUSE_EDGE_BASE = {
    banker: 1.06, player: 1.24, tie: 14.36, btg: 4.0, stg: 4.0,
    sl7: 6.6, bd: 3.0, sd: 3.0, mnm: 2.5, pairplus: 7.0, ppl: 10.36, l6: 13.0,
};

let _mock = null;

function buildMock() {
    if (_mock) return _mock;

    const live = require('../../live/data/live_cod.mock.json');
    const daily = require('../data/data_cod.json');

    // Table metadata, keyed gametype|table.
    const meta = new Map();
    for (const r of daily) {
        const k = gametypeTableKey(r.gametype, r.table);
        if (!meta.has(k)) {
            meta.set(k, {
                area: r.area, pit: r.pit, sub_segment: r.sub_segment,
                tablemin: r.tablemin, gametype: r.gametype, table: r.table,
            });
        }
    }

    // The fixture is a fixed past day. Shift every timestamp so it lands
    // on today's gaming day — otherwise idle-time reads as "dealt eight
    // months ago" on every table and the trend chart plots off-screen.
    const anchor = new Date(live.asOf).getTime();
    const now = Date.now();
    const shift = now - anchor;
    const shiftIso = (iso) => new Date(new Date(iso).getTime() + shift).toISOString();

    const rounds = live.rounds.map((r) => ({ ...r, ts: shiftIso(r.ts) }));

    // ── Per-table day + current-shoe aggregates ──────────────────────
    const byTable = new Map();
    for (const r of rounds) {
        let e = byTable.get(r.tableKey);
        if (!e) {
            e = { win: 0, turnover: 0, hands: 0, lastTs: null, shoes: new Map(), seatsByMin: new Map() };
            byTable.set(r.tableKey, e);
        }
        e.win += r.winLoss;
        e.turnover += r.wager;
        e.hands += 1;
        if (!e.lastTs || r.ts > e.lastTs) e.lastTs = r.ts;

        let s = e.shoes.get(r.shoeId);
        if (!s) { s = { win: 0, turnover: 0, hands: 0, firstTs: r.ts, lastTs: r.ts }; e.shoes.set(r.shoeId, s); }
        s.win += r.winLoss;
        s.turnover += r.wager;
        s.hands += 1;
        if (r.ts < s.firstTs) s.firstTs = r.ts;
        if (r.ts > s.lastTs) s.lastTs = r.ts;

        // Seat occupancy per minute, for the rolling headcount average.
        const minKey = `${r.shoeId}|${r.ts.slice(0, 16)}`;
        let seats = e.seatsByMin.get(minKey);
        if (!seats) { seats = new Set(); e.seatsByMin.set(minKey, seats); }
        seats.add(r.seat);
    }

    const tables = [];
    const today = new Date(now).toISOString().slice(0, 10);
    for (const [key, m] of meta) {
        const agg = byTable.get(key);
        const isOpen = !!agg;
        const row = {
            date: today, table: m.table, gametype: m.gametype,
            area: m.area, pit: m.pit, sub_segment: m.sub_segment, tablemin: m.tablemin,
            is_open: isOpen,
            openhours: isOpen ? elapsedGamingHours(now) : 0,
        };
        if (!agg) { tables.push(row); continue; }

        // Current shoe = the one containing the most recent hand.
        let curId = null, cur = null;
        for (const [id, s] of agg.shoes) {
            if (!cur || s.lastTs > cur.lastTs) { curId = id; cur = s; }
        }

        // Rolling 10-minute average headcount, bounded by the current
        // shoe — per the contract, never averaged across a shuffle.
        const cutoff = new Date(now - 10 * 60000).toISOString().slice(0, 16);
        let seatSum = 0, seatN = 0;
        for (const [mk, seats] of agg.seatsByMin) {
            const [shoeId, minute] = mk.split('|');
            if (shoeId !== curId || minute < cutoff) continue;
            seatSum += seats.size; seatN += 1;
        }

        Object.assign(row, {
            win: agg.win,
            theo: agg.turnover * edgeFor(m.gametype),
            turnover: agg.turnover,
            hands: agg.hands,
            patron_hands: agg.hands,
            last_hand_dealt_time: agg.lastTs,
            shoe_id: curId,
            shoe_start_time: cur.firstTs,
            shoe_hands_dealt: cur.hands,
            shoe_win: cur.win,
            shoe_theo: cur.turnover * edgeFor(m.gametype),
            shoe_turnover: cur.turnover,
            avg_headcount_10m: seatN ? +(seatSum / seatN).toFixed(1) : 0,
            headcount_window_mins: seatN,
        });

        // Synthetic live edge. Baccarat-family only — the bet options
        // below do not exist on the other games. Deliberately allowed to
        // drift negative on a few tables so the NEG_EDGE alert has
        // something to fire on in mock mode.
        if (m.gametype === 'BA' || m.gametype === 'NC' || m.gametype === 'BC') {
            const drift = 0.6 + Math.random() * 0.9;
            for (const [k, base] of Object.entries(HOUSE_EDGE_BASE)) {
                row['house_edge_' + k] = +(base * drift - (Math.random() < 0.06 ? 1.6 : 0)).toFixed(2);
            }
        }
        tables.push(row);
    }

    // ── Patrons ──────────────────────────────────────────────────────
    const byPatron = new Map();
    for (const r of rounds) {
        let e = byPatron.get(r.patronId);
        if (!e) { e = { win: 0, wager: 0, hands: 0, wagers: [], tables: new Set(), lastTs: null, lastTable: null, lastSeat: null }; byPatron.set(r.patronId, e); }
        e.win += r.winLoss; e.wager += r.wager; e.hands += 1;
        e.wagers.push(r.wager); e.tables.add(r.tableKey);
        if (!e.lastTs || r.ts > e.lastTs) { e.lastTs = r.ts; e.lastTable = r.tableKey; e.lastSeat = r.seat; }
    }
    const patrons = live.patrons.map((p) => {
        const a = byPatron.get(p.patronId);
        const avg = a && a.hands ? a.wager / a.hands : 0;
        return {
            patron_id: p.patronId,
            card_type: p.cardType,
            segment: p.segment,
            sign_in_mins_ago: p.signInMinsAgo,
            cum_win: a ? a.win : 0,
            cum_wager: a ? a.wager : 0,
            hands: a ? a.hands : 0,
            tables_played: a ? a.tables.size : 0,
            avg_bet: Math.round(avg),
            bet_stdev: a ? Math.round(stdev(a.wagers)) : 0,
            // min_bet / max_bet are DELIBERATELY omitted from the mock.
            //
            // The alert engine prefers true spread (max ÷ min) at a 15:1
            // threshold when these are present. That is correct for real
            // data — but this fixture randomises each wager independently
            // across roughly $100-$4,200 for every patron, so every mock
            // player computes to ~40:1 and 111 of 135 patrons alert. The
            // fixture does not model betting CONSISTENCY, so its true
            // spread is meaningless.
            //
            // Omitting them makes the mock fall back to the coefficient
            // of variation, which the fixture does support sensibly.
            // Supply min_bet/max_bet from the real feed and the engine
            // switches to the 15:1 path automatically — no code change.
            buy_in: p.buyIn,
            cash_out: p.cashOut,
            current_table_key: a ? a.lastTable : null,
            current_seat: a ? a.lastSeat : null,
        };
    });

    // One patron per seat. The fixture's rounds can leave two patrons whose
    // last hand was in the same seat; the most recent keeps it, the other
    // moves to a free seat at that table (or is unseated if it is full).
    const lastTs = (p) => { const x = byPatron.get(p.patron_id); return x ? String(x.lastTs) : ''; };
    const taken = new Map();
    for (const p of [...patrons].sort((x, y) => lastTs(y).localeCompare(lastTs(x)))) {
        if (!p.current_table_key || !p.current_seat) continue;
        let seats = taken.get(p.current_table_key);
        if (!seats) { seats = new Set(); taken.set(p.current_table_key, seats); }
        if (seats.has(p.current_seat)) {
            const free = [1, 2, 3, 4, 5, 6, 7].find((n) => !seats.has(n));
            if (free == null) { p.current_table_key = null; p.current_seat = null; continue; }
            p.current_seat = free;
        }
        seats.add(p.current_seat);
    }

    // ── Current shoe per baccarat table (hand-level feed, §7) ─────────
    // Generated rather than derived: the live fixture has about one
    // round per shoe per patron, far too sparse for a road. Seeded by
    // table + shoe so it is stable across polls. The generated shoe is
    // written back onto the table row so the map's hand # and shoe win
    // match the board exactly.
    const dealerNames = [...new Set(rounds.map((r) => r.dealer))].sort();
    const seatedByTable = new Map();
    for (const p of patrons) {
        if (!p.current_table_key || !p.current_seat) continue;
        let list = seatedByTable.get(p.current_table_key);
        if (!list) { list = []; seatedByTable.set(p.current_table_key, list); }
        if (list.some((s) => s.seat === p.current_seat)) continue;       // one patron per seat
        list.push({ playerId: p.patron_id, seat: p.current_seat, avgBet: p.avg_bet || 1000 });
    }
    const shoes = new Map();
    for (const row of tables) {
        if (!row.is_open || !FIXED_GAMES.includes(row.gametype)) continue;
        const key = gametypeTableKey(row.gametype, row.table);
        const seed = hashKey(key);
        const handCount = 18 + (seed % 52);                              // 18..69 hands in
        const handMs = 55000;
        const shoeId = row.shoe_id || `${row.gametype}${row.table}-S1`;
        const seated = seatedByTable.get(key) || [];
        const shoeKey = `${key}|${shoeId}`;
        const edgePaths = mockEdgePaths(shoeKey, handCount);
        const hot = hotOption(shoeKey);
        // The furthest-right seated patron plays the hot option like a counter.
        const counterSeat = hot && seated.length ? [...seated].sort((x, y) => y.seat - x.seat)[0].seat : null;
        const shoeRows = generateMockShoe({
            tableId: row.table, gametype: row.gametype, shoeId, handCount,
            seated, edgePaths, counter: counterSeat ? { seat: counterSeat, code: hot } : null,
            dealer: dealerNames.length ? dealerNames[seed % dealerNames.length] : null,
            startMs: now - handCount * handMs, handMs,
        });
        shoes.set(key, shoeRows);
        let win = 0, turnover = 0;
        for (const r of shoeRows) { win += r.casino_win; turnover += r.wager; }
        Object.assign(row, {
            shoe_id: shoeId,
            shoe_hands_dealt: handCount,
            shoe_win: win,
            shoe_turnover: turnover,
            shoe_theo: turnover * edgeFor(row.gametype),
            shoe_start_time: shoeRows[0].game_time,
            last_hand_dealt_time: shoeRows[shoeRows.length - 1].game_time,
        });
        // Live edge = where this shoe's path is now, so the map and the
        // hand-by-hand charts agree.
        for (const o of PATRON_360.BET_OPTIONS) row[`house_edge_${o.edgeKey}`] = edgePaths[o.code][handCount - 1];
    }

    // ── Bet mix ──────────────────────────────────────────────────────
    const betKey = (r) => `${r.gametype}|${r.betOption}`;
    const byBet = new Map();
    for (const r of rounds) {
        let e = byBet.get(betKey(r));
        if (!e) { e = { gametype: r.gametype, bet_option: r.betOption, wager: 0, win_loss: 0, hands: 0 }; byBet.set(betKey(r), e); }
        e.wager += r.wager; e.win_loss += r.winLoss; e.hands += 1;
    }
    const betmix = [...byBet.values()];

    // ── Dealers ──────────────────────────────────────────────────────
    const byDealer = new Map();
    for (const r of rounds) {
        let e = byDealer.get(r.dealer);
        if (!e) { e = { dealer: r.dealer, hands: 0, wager: 0, win_loss: 0, _tables: new Set() }; byDealer.set(r.dealer, e); }
        e.hands += 1; e.wager += r.wager; e.win_loss += r.winLoss; e._tables.add(r.tableKey);
    }
    const dealers = [...byDealer.values()].map(({ _tables, ...d }) => ({ ...d, tables_worked: _tables.size }));

    _mock = { rounds, tables, patrons, betmix, dealers, shoes };
    return _mock;
}

function stdev(xs) {
    if (!xs || xs.length < 2) return 0;
    const m = xs.reduce((a, b) => a + b, 0) / xs.length;
    return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1));
}

// Hours elapsed in the current gaming day (which starts at 07:00, not
// midnight — see the contract's conventions section).
function elapsedGamingHours(nowMs = Date.now()) {
    const d = new Date(nowMs);
    const mins = ((d.getHours() - GAMING_DAY_START_HOUR + 24) % 24) * 60 + d.getMinutes();
    return +(mins / 60).toFixed(2);
}

// Bucket the mock's rounds into a trend series. Per-bucket values, not
// cumulative: a cumulative line hides a sudden run inside a large
// running total, which is exactly what surveillance needs to see.
function buildTrendMock(bucket = '15m') {
    const { rounds } = buildMock();
    const mins = { '5m': 5, '15m': 15, '30m': 30, '1h': 60 }[bucket] ?? 15;
    const size = mins * 60000;
    const by = new Map();
    for (const r of rounds) {
        const t = new Date(r.ts).getTime();
        const k = Math.floor(t / size) * size;
        let e = by.get(k);
        if (!e) { e = { bucket_ts: new Date(k).toISOString(), win: 0, theo: 0, turnover: 0, hands: 0, _p: new Set(), _t: new Set() }; by.set(k, e); }
        e.win += r.winLoss;
        e.theo += r.wager * edgeFor(r.gametype);
        e.turnover += r.wager;
        e.hands += 1;
        e._p.add(r.patronId); e._t.add(r.tableKey);
    }
    return [...by.values()]
        .sort((a, b) => a.bucket_ts.localeCompare(b.bucket_ts))
        .map(({ _p, _t, ...b }) => ({ ...b, patrons: _p.size, tables_open: _t.size }));
}

// ─────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────

export async function fetchTables() {
    return loadFeed('tables', RT_ENDPOINTS.tables, () => buildMock().tables);
}
export async function fetchPatrons() {
    return loadFeed('patrons', RT_ENDPOINTS.patrons, () => buildMock().patrons);
}
export async function fetchBetMix() {
    return loadFeed('betmix', RT_ENDPOINTS.betmix, () => buildMock().betmix);
}
export async function fetchDealers() {
    return loadFeed('dealers', RT_ENDPOINTS.dealers, () => buildMock().dealers);
}
export async function fetchTrend(bucket = '15m') {
    const url = RT_ENDPOINTS.trend ? `${RT_ENDPOINTS.trend}?bucket=${encodeURIComponent(bucket)}` : null;
    return loadFeed('trend', url, () => buildTrendMock(bucket));
}

// On-demand only — never part of the poll loop. `table` optionally
// narrows to one table's history, which is what a click from the map or
// a ranking row wants.
export async function fetchPatronDetail(patronId, { table = null } = {}) {
    const tpl = RT_ENDPOINTS.patronDetail;
    let url = null;
    if (tpl) {
        url = tpl.includes('{id}') ? tpl.replace('{id}', encodeURIComponent(patronId))
                                   : `${tpl}/${encodeURIComponent(patronId)}`;
        if (table) url += `${url.includes('?') ? '&' : '?'}table=${encodeURIComponent(table)}`;
    }
    return loadFeed('patronDetail', url, () => {
        const { rounds } = buildMock();
        return rounds
            .filter((r) => r.patronId === patronId && (!table || r.tableKey === table))
            .map((r) => ({
                ts: r.ts, gametype: r.gametype, table: r.table, bet_option: r.betOption,
                wager: r.wager, win_loss: r.winLoss, winner: r.winner, seat: r.seat,
                bet_placement_ms: r.betPlacementMs, shoe_id: r.shoeId, dealer: r.dealer,
                hand_in_shoe: r.handInShoe, shoe_hands: r.shoeHands,
            }));
    });
}

// ── Player 360 feeds (§8 bets, §9 shoe edges) ────────────────────────
// On demand only, per patron and date range. A configured endpoint that
// fails returns no rows plus the error — never mock data for a real
// patron under investigation.
function patronUrl(tpl, patronId, suffix, { from, to }) {
    const id = encodeURIComponent(patronId);
    const base = tpl.includes('{id}') ? tpl.replace('{id}', id) : `${tpl}/${id}/${suffix}`;
    const qs = [];
    if (from) qs.push(`from=${encodeURIComponent(from)}`);
    if (to) qs.push(`to=${encodeURIComponent(to)}`);
    return qs.length ? `${base}${base.includes('?') ? '&' : '?'}${qs.join('&')}` : base;
}

async function fetchPatronFeed(name, tpl, suffix, patronId, range, mockRows) {
    const { from = null, to = null } = range || {};
    if (!tpl) {
        const rows = mockRows().filter((r) => (!from || r.gaming_date >= from) && (!to || r.gaming_date <= to));
        return { rows, live: false, error: null };
    }
    try {
        return { rows: await fetchJson(patronUrl(tpl, patronId, suffix, { from, to }), { timeoutMs: 60000 }), live: true, error: null };
    } catch (err) {
        // eslint-disable-next-line no-console
        console.warn(`[RT] ${name} feed failed:`, err.message);
        return { rows: [], live: false, error: err.message };
    }
}

export function fetchPatronBets(patronId, range) {
    return fetchPatronFeed('patron bets', RT_ENDPOINTS.patronBets, 'bets', patronId, range,
        () => generateMockPatronHistory(patronId).bets);
}

export function fetchPatronShoeEdges(patronId, range) {
    return fetchPatronFeed('patron shoe edges', RT_ENDPOINTS.patronShoeEdges, 'shoe-edges', patronId, range,
        () => generateMockPatronHistory(patronId).shoeEdges);
}

// Hand-level rows for ONE table's current shoe (or `shoeId`). Fetched
// for the table shown in the shoe board only, on every poll tick.
//
// Unlike the polled feeds this never falls back to the mock when a real
// endpoint is configured and fails: fake hands for a real table would
// mislead an investigation. It returns no rows plus the error, and the
// board keeps showing the last good shoe.
export async function fetchShoe({ gametype, table, shoeId = null }) {
    const base = RT_ENDPOINTS.shoe;
    if (!base) {
        return { rows: buildMock().shoes.get(gametypeTableKey(gametype, table)) || [], live: false, error: null };
    }
    const qs = [`gametype=${encodeURIComponent(gametype)}`, `table_id=${encodeURIComponent(table)}`];
    if (shoeId) qs.push(`shoe_id=${encodeURIComponent(shoeId)}`);
    const url = `${base}${base.includes('?') ? '&' : '?'}${qs.join('&')}`;
    try {
        return { rows: await fetchJson(url), live: true, error: null };
    } catch (err) {
        // eslint-disable-next-line no-console
        console.warn('[RT] shoe feed failed:', err.message);
        return { rows: [], live: false, error: err.message };
    }
}

// One poll = the five polled feeds in parallel. Settled rather than
// all-or-nothing, so a slow or broken endpoint costs only its own panel.
export async function pollAll(bucket = '15m') {
    const [tables, patrons, betmix, dealers, trend] = await Promise.all([
        fetchTables(), fetchPatrons(), fetchBetMix(), fetchDealers(), fetchTrend(bucket),
    ]);
    return {
        tables: tables.rows, patrons: patrons.rows, betmix: betmix.rows,
        dealers: dealers.rows, trend: trend.rows,
        asOf: new Date().toISOString(),
        health: {
            tables: tables.live, patrons: patrons.live, betmix: betmix.live,
            dealers: dealers.live, trend: trend.live,
        },
        errors: [tables, patrons, betmix, dealers, trend]
            .map((f, i) => (f.error ? { feed: ['tables', 'patrons', 'betmix', 'dealers', 'trend'][i], error: f.error } : null))
            .filter(Boolean),
    };
}
