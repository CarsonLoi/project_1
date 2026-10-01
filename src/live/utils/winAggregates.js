// Live Casino Win — pure aggregation helpers.
// Nothing here reaches into the DOM / setState; each function takes a
// feed slice and returns a plain map/array. Keeps the rendering layer
// dumb and re-runnable when the polled feed refreshes.

// Casino-perspective cumulative win per tableKey. If the caller supplies
// a `patronFilter` set, only rounds by those patrons contribute — this
// is the projection that powers "click a patron → heatmap shows only
// their action" from the requirements.
export function cumWinByTable(rounds, patronFilter = null) {
    const out = new Map();
    for (const r of rounds || []) {
        if (patronFilter && !patronFilter.has(r.patronId)) continue;
        const prev = out.get(r.tableKey) || 0;
        out.set(r.tableKey, prev + (Number(r.winLoss) || 0));
    }
    return out;
}

// Same shape but pulls per-table headcount / hands so the tooltip can
// show both cumWin AND live activity. Falls back to what the snapshot
// already reported when we're not filtering by patron.
export function tableRuntime(tablesSnapshot, rounds, patronFilter = null) {
    if (!patronFilter) {
        const m = new Map();
        for (const t of tablesSnapshot || []) m.set(t.tableKey, {
            cumWin: t.cumWin, cumWager: t.cumWager,
            hands: t.hands, headcount: t.headcount,
            lastRoundTs: t.lastRoundTs,
        });
        return m;
    }
    const m = new Map();
    for (const r of rounds || []) {
        if (!patronFilter.has(r.patronId)) continue;
        let e = m.get(r.tableKey);
        if (!e) { e = { cumWin: 0, cumWager: 0, hands: 0, headcount: 0, lastRoundTs: null }; m.set(r.tableKey, e); }
        e.cumWin  += Number(r.winLoss) || 0;
        e.cumWager+= Number(r.wager)   || 0;
        e.hands   += 1;
        if (!e.lastRoundTs || r.ts > e.lastRoundTs) e.lastRoundTs = r.ts;
        // Filtered headcount = distinct patrons at this table who match
        // (in the single-patron filter case, always 1 if present).
        e.headcount = patronFilter.size;
    }
    return m;
}

// Top-3 patrons currently at each table by absolute cumWin — powers the
// heatmap tooltip's "who's driving this" list. Casino perspective: a
// patron winning big will appear because |cumWin| is large negative.
export function topPatronsPerTable(rounds, patronMeta, topN = 3) {
    const perTable = new Map();  // tableKey → Map<patronId, cumWin>
    for (const r of rounds || []) {
        let m = perTable.get(r.tableKey);
        if (!m) { m = new Map(); perTable.set(r.tableKey, m); }
        m.set(r.patronId, (m.get(r.patronId) || 0) + (Number(r.winLoss) || 0));
    }
    const out = new Map();
    for (const [tableKey, m] of perTable.entries()) {
        const arr = [...m.entries()].map(([patronId, cumWin]) => ({
            patronId, cumWin,
            cardType: patronMeta.get(patronId)?.cardType || 'BASE',
        }));
        arr.sort((a, b) => Math.abs(b.cumWin) - Math.abs(a.cumWin));
        out.set(tableKey, arr.slice(0, topN));
    }
    return out;
}

// Card-tier ranking — lower number = higher tier (BLACK on top).
// Used by SORTS.topCardTier so a patron's tier is its primary key.
const CARD_TIER_RANK = { BLACK: 0, DIAMOND: 1, PLATINUM: 2, GOLD: 3, SILVER: 4, BASE: 5 };
const tierRank = (code) => (CARD_TIER_RANK[code] ?? 99);

// Sort helpers used by the Top-X panel. Each returns a sort comparator.
// New: topCardTier (VIP-first) + highestAvgBet (dollars per hand).
export const SORTS = {
    biggestWinner:  (a, b) => a.cumWin - b.cumWin,   // most-negative casino W = biggest patron winner
    biggestLoser:   (a, b) => b.cumWin - a.cumWin,   // most-positive casino W = biggest patron loser
    highestWager:   (a, b) => b.cumWager - a.cumWager,
    longestOnFloor: (a, b) => b.signInMinsAgo - a.signInMinsAgo,
    topCardTier:    (a, b) => {
        // Tier first, then absolute action size within the same tier so
        // the strongest player at each tier bubbles up.
        const r = tierRank(a.cardType) - tierRank(b.cardType);
        return r !== 0 ? r : (b.cumWager - a.cumWager);
    },
    highestAvgBet:  (a, b) => {
        const avgA = a.hands ? (a.cumWager / a.hands) : 0;
        const avgB = b.hands ? (b.cumWager / b.hands) : 0;
        return avgB - avgA;
    },
};

// Take a patrons array, optionally filter by segment / card / active-only,
// then sort + limit. Returns a fresh array — safe to pass to render.
export function pickTopX(patrons, { sort = 'biggestWinner', limit = 20, cardFilter = null, segmentFilter = null } = {}) {
    let arr = (patrons || []).filter((p) => {
        if (cardFilter && cardFilter.size && !cardFilter.has(p.cardType)) return false;
        if (segmentFilter && segmentFilter.size && !segmentFilter.has(p.segment)) return false;
        if (!p.hands) return false;   // no plays this session → drop
        return true;
    });
    arr.sort(SORTS[sort] || SORTS.biggestWinner);
    return arr.slice(0, limit);
}

// Format an ISO timestamp as HH:MM:SS — used in the "as of" header pill.
export function fmtClock(iso) {
    if (!iso) return '—';
    try {
        const d = new Date(iso);
        const hh = String(d.getHours()).padStart(2, '0');
        const mm = String(d.getMinutes()).padStart(2, '0');
        const ss = String(d.getSeconds()).padStart(2, '0');
        return `${hh}:${mm}:${ss}`;
    } catch { return '—'; }
}

// mm:ss for the "on floor" duration column.
export function fmtDuration(mins) {
    if (mins == null) return '—';
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`;
    return `${m} min`;
}

// House-edge assumptions per game type — used ONLY for the theoretical
// win ("theo") figure management compares actuals against. Tune these to
// your venue's real par sheets; unknown games fall back to DEFAULT_EDGE.
// NOTE on keys: these must match the gametype codes the FEED actually
// sends — BA, BC, BJ, NC, SB. Baccarat was previously keyed 'BAC', which
// never matched anything, so every baccarat-family table silently fell
// through to DEFAULT_EDGE and its theo (and therefore its luck/variance
// figures) was computed against the wrong edge. The legacy keys are kept
// below for games that may appear in other feeds.
export const HOUSE_EDGE = {
    // Codes present in the live/realtime feeds.
    BA: 0.012,   // baccarat
    BC: 0.012,   // baccarat variant
    NC: 0.012,   // no-commission baccarat
    BJ: 0.006,   // blackjack
    SB: 0.028,   // sic bo
    // Retained for other/legacy feeds.
    BAC: 0.012, ROU: 0.027, DTB: 0.037,
    TSAI: 0.02, FT: 0.02, MJ: 0.015, PW: 0.016, CSP: 0.025,
};
const DEFAULT_EDGE = 0.015;
export function edgeFor(gametype) { return HOUSE_EDGE[gametype] ?? DEFAULT_EDGE; }

// Today's headline stats for ONE patron — everything the Overview tab
// shows beyond raw cum totals. Single pass over the patron's rounds.
//   theoWin   — Σ wager × edge(game): what the house EXPECTS to win
//   luck      — actual − theo (negative = patron running hot)
//   pacePerHr — hands per hour between first and last recorded hand
//   bestHand / worstHand — largest single-hand swing each way (casino persp.)
export function patronTodayStats(rounds, patronId) {
    let wager = 0, actual = 0, theo = 0, hands = 0;
    let firstTs = null, lastTs = null;
    let bestHand = 0, worstHand = 0;
    const tables = new Set();
    for (const r of rounds || []) {
        if (r.patronId !== patronId) continue;
        const w = Number(r.wager) || 0, wl = Number(r.winLoss) || 0;
        wager += w; actual += wl; theo += w * edgeFor(r.gametype); hands += 1;
        tables.add(r.tableKey);
        if (wl > bestHand) bestHand = wl;
        if (wl < worstHand) worstHand = wl;
        if (!firstTs || r.ts < firstTs) firstTs = r.ts;
        if (!lastTs || r.ts > lastTs) lastTs = r.ts;
    }
    const spanHrs = firstTs && lastTs ? Math.max(0.25, (new Date(lastTs) - new Date(firstTs)) / 3_600_000) : null;
    return {
        wager, actual, theo: Math.round(theo), luck: Math.round(actual - theo),
        hands, tables: tables.size,
        avgBet: hands ? wager / hands : 0,
        pacePerHr: spanHrs ? Math.round(hands / spanHrs) : null,
        holdPct: wager ? (actual / wager) * 100 : null,
        bestHand, worstHand, firstTs, lastTs,
    };
}

// Per-TABLE breakdown for ONE patron — where are they winning/losing?
// Sorted by |casino W/L| so the most consequential tables lead.
export function patronTableStats(rounds, patronId) {
    const map = new Map();
    for (const r of rounds || []) {
        if (r.patronId !== patronId) continue;
        let e = map.get(r.tableKey);
        if (!e) { e = { tableKey: r.tableKey, gametype: r.gametype, table: r.table, hands: 0, wager: 0, casinoWin: 0 }; map.set(r.tableKey, e); }
        e.hands += 1;
        e.wager += Number(r.wager) || 0;
        e.casinoWin += Number(r.winLoss) || 0;
    }
    return [...map.values()].sort((a, b) => Math.abs(b.casinoWin) - Math.abs(a.casinoWin));
}

// Build a per-bet-option summary for ONE patron: hands · avg wager · hit
// rate (patron wins / hands) · casino W/L. Used by the "By Bet" tab.
export function betOptionStats(rounds, patronId) {
    const map = new Map();
    for (const r of rounds || []) {
        if (r.patronId !== patronId) continue;
        const key = `${r.gametype}·${r.betOption}`;
        let e = map.get(key);
        if (!e) { e = { gametype: r.gametype, betOption: r.betOption, hands: 0, wager: 0, casinoWin: 0, patronWinHands: 0 }; map.set(key, e); }
        e.hands += 1;
        e.wager += Number(r.wager) || 0;
        const w = Number(r.winLoss) || 0;
        e.casinoWin += w;
        if (w < 0) e.patronWinHands += 1;   // patron won this hand
    }
    return [...map.values()].sort((a, b) => b.hands - a.hands);
}

// Running-total series for the sparkline: [{ ts, cum, wl }, ...] — one
// point per hand, cum = casino-perspective cumulative W/L over the day.
export function patronCumSeries(rounds, patronId) {
    const arr = [];
    let cum = 0;
    for (const r of rounds || []) {
        if (r.patronId !== patronId) continue;
        cum += Number(r.winLoss) || 0;
        arr.push({ ts: r.ts, cum, wl: r.winLoss, table: r.tableKey, bet: r.betOption });
    }
    return arr;
}

// Short trajectory summaries per patron — powers the Top-X row sparklines
// and (in phase B) the watchlist. Bucketed into fixed-width slots so
// every row has the same number of points regardless of how many hands
// the patron played. Empty slots inherit the previous cumulative value
// so the line looks natural instead of jumping to zero.
//
// Returns Map<patronId, number[]> where the array is the casino-cum-W/L
// snapshot at each bucket boundary. `nowIso` should match the feed's
// `asOf` so the last bucket ends at "live now".
export function patronRecentTrajectories(rounds, { nowIso = null, windowMinutes = 60, buckets = 12 } = {}) {
    const nowMs = nowIso ? new Date(nowIso).getTime() : Date.now();
    const startMs = nowMs - windowMinutes * 60 * 1000;
    const step = (nowMs - startMs) / buckets;
    // Per patron, walk their rounds and stamp the cumulative into every
    // bucket whose right edge is ≥ the round's timestamp.
    const perPatron = new Map();  // patronId → { cum, slots: number[] }
    // First, run through ALL rounds up to startMs to establish the
    // patron's starting cumulative at bucket 0 — otherwise the sparkline
    // shows only Δ from window-start, which under-represents position.
    const cumBefore = new Map();
    for (const r of rounds || []) {
        const ts = new Date(r.ts).getTime();
        if (ts >= startMs) continue;
        cumBefore.set(r.patronId, (cumBefore.get(r.patronId) || 0) + (Number(r.winLoss) || 0));
    }
    // Then walk rounds within the window, stamping the running cum into
    // the correct bucket.
    for (const r of rounds || []) {
        const ts = new Date(r.ts).getTime();
        if (ts < startMs || ts > nowMs) continue;
        let e = perPatron.get(r.patronId);
        if (!e) {
            const seed = cumBefore.get(r.patronId) || 0;
            e = { cum: seed, slots: new Array(buckets).fill(seed) };
            perPatron.set(r.patronId, e);
        }
        e.cum += Number(r.winLoss) || 0;
        // Which bucket does this round land in?
        const idx = Math.min(buckets - 1, Math.floor((ts - startMs) / step));
        // Fill this bucket and every subsequent bucket with the new cum
        // — later rounds overwrite as they come in.
        for (let i = idx; i < buckets; i++) e.slots[i] = e.cum;
    }
    // Also seed patrons who have PRIOR history but no in-window rounds,
    // so their sparkline shows a flat line at their prior level (still
    // useful — signals they've stopped playing).
    for (const [pid, seed] of cumBefore) {
        if (!perPatron.has(pid)) perPatron.set(pid, { cum: seed, slots: new Array(buckets).fill(seed) });
    }
    const out = new Map();
    for (const [pid, e] of perPatron) out.set(pid, e.slots);
    return out;
}

// ── Player 360 helpers ──────────────────────────────────────────────
// Everything below feeds the Player360Panel. All casino-perspective.

// Side-bet dictionary — options that count as high-margin side wagers
// for the "side-bet appetite" metric. Tune to the venue's menu.
const SIDE_BETS = new Set(['TIE', 'B_PAIR', 'P_PAIR', 'PERFECT_PAIR', '21+3', 'INSURANCE', 'TRIPLE', 'STRAIGHT', 'SIDE', '6_CARD', 'PAIR_PLUS']);
export const isSideBet = (opt) => SIDE_BETS.has(opt);

// Betting mechanics: avg/max/min bet + spread ratio (max/min). A spread
// beyond ~15:1 is a classic advantage-play surveillance trigger.
export function patronBetMechanics(rounds, patronId) {
    let min = Infinity, max = 0, sum = 0, n = 0, sideWager = 0;
    const bets = [];
    for (const r of rounds || []) {
        if (r.patronId !== patronId) continue;
        const w = Number(r.wager) || 0;
        if (w <= 0) continue;
        bets.push(w);
        sum += w; n += 1;
        if (w < min) min = w;
        if (w > max) max = w;
        if (isSideBet(r.betOption)) sideWager += w;
    }
    const avg = n ? sum / n : 0;
    // Std deviation of bet sizes — wagering-volatility signal.
    let variance = 0;
    for (const b of bets) variance += (b - avg) * (b - avg);
    const stdev = n ? Math.sqrt(variance / n) : 0;
    return {
        avgBet: avg, maxBet: max, minBet: n ? min : 0,
        spreadRatio: n && min > 0 ? max / min : 0,
        betStdev: stdev,
        sideBetShare: sum ? sideWager / sum : 0,
        totalWager: sum, hands: n,
    };
}

// Time-bucketed financial series for the trajectory chart: per-bucket
// turnover (bars) + cumulative actual & theo (lines).
export function patronFinancialSeries(rounds, patronId, { bucketMinutes = 30 } = {}) {
    const mine = (rounds || []).filter((r) => r.patronId === patronId);
    if (!mine.length) return [];
    const t0 = new Date(mine[0].ts).getTime();
    const buckets = new Map();
    let cumA = 0, cumT = 0;
    for (const r of mine) {
        const idx = Math.floor((new Date(r.ts).getTime() - t0) / (bucketMinutes * 60000));
        let b = buckets.get(idx);
        if (!b) {
            const d = new Date(t0 + idx * bucketMinutes * 60000);
            b = { label: `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`, turnover: 0, cumActual: 0, cumTheo: 0 };
            buckets.set(idx, b);
        }
        const w = Number(r.wager) || 0;
        b.turnover += w;
        cumA += Number(r.winLoss) || 0;
        cumT += w * edgeFor(r.gametype);
        b.cumActual = cumA;
        b.cumTheo = Math.round(cumT);
    }
    return [...buckets.entries()].sort((a, b) => a[0] - b[0]).map(([, v]) => v);
}

// Per-dealer breakdown — the collusion-screen view.
export function patronDealerStats(rounds, patronId) {
    const map = new Map();
    for (const r of rounds || []) {
        if (r.patronId !== patronId || !r.dealer) continue;
        let e = map.get(r.dealer);
        if (!e) { e = { dealer: r.dealer, hands: 0, turnover: 0, casinoWin: 0 }; map.set(r.dealer, e); }
        e.hands += 1; e.turnover += Number(r.wager) || 0; e.casinoWin += Number(r.winLoss) || 0;
    }
    return [...map.values()].sort((a, b) => b.turnover - a.turnover).slice(0, 10);
}

// Per-seat stats (1..7) — positional preference heat.
export function patronSeatStats(rounds, patronId) {
    const seats = Array.from({ length: 7 }, (_, i) => ({ seat: i + 1, hands: 0, casinoWin: 0, patronWins: 0 }));
    for (const r of rounds || []) {
        if (r.patronId !== patronId || !r.seat) continue;
        const s = seats[(r.seat - 1) % 7];
        s.hands += 1; s.casinoWin += Number(r.winLoss) || 0;
        if ((Number(r.winLoss) || 0) < 0) s.patronWins += 1;
    }
    return seats;
}

// Sunburst: game → bet option → outcome (win/loss for the PATRON).
export function patronSunburstData(rounds, patronId) {
    const games = new Map();
    for (const r of rounds || []) {
        if (r.patronId !== patronId) continue;
        let g = games.get(r.gametype);
        if (!g) { g = new Map(); games.set(r.gametype, g); }
        let o = g.get(r.betOption);
        if (!o) { o = { win: 0, loss: 0 }; g.set(r.betOption, o); }
        const w = Number(r.wager) || 0;
        if ((Number(r.winLoss) || 0) < 0) o.win += w; else o.loss += w;
    }
    const out = [];
    for (const [game, opts] of games) {
        const children = [];
        for (const [opt, o] of opts) {
            children.push({
                name: opt,
                children: [
                    ...(o.win ? [{ name: 'Patron win', value: o.win, itemStyle: { color: '#e88090' } }] : []),
                    ...(o.loss ? [{ name: 'Patron loss', value: o.loss, itemStyle: { color: '#7dc267' } }] : []),
                ],
            });
        }
        out.push({ name: game, children });
    }
    return out;
}

// Behavior profile — the six radar axes, raw values. Baseline comes from
// running this over every patron and averaging.
export function patronBehaviorProfile(rounds, patronId, todayStats = null) {
    const mech = patronBetMechanics(rounds, patronId);
    const stats = todayStats || patronTodayStats(rounds, patronId);
    return {
        aggressiveness: mech.spreadRatio,
        volume: mech.totalWager,
        sideBetShare: mech.sideBetShare,
        volatility: mech.avgBet ? mech.betStdev / mech.avgBet : 0,   // coefficient of variation
        pace: stats.pacePerHr || 0,
        winRate: stats.hands ? Math.max(0, -stats.actual) / Math.max(1, stats.wager) : 0, // patron return per wagered $
    };
}

export function populationBaselineProfile(rounds, patronIds) {
    const acc = { aggressiveness: 0, volume: 0, sideBetShare: 0, volatility: 0, pace: 0, winRate: 0 };
    let n = 0;
    for (const pid of patronIds || []) {
        const p = patronBehaviorProfile(rounds, pid);
        if (!p.volume) continue;
        for (const k of Object.keys(acc)) acc[k] += p[k];
        n += 1;
    }
    if (n) for (const k of Object.keys(acc)) acc[k] /= n;
    return acc;
}

// Shoe-by-shoe master log for one patron. Risk flag when the in-shoe
// bet spread exceeds 20× (the spec's surveillance trigger).
export function patronShoeLog(rounds, patronId) {
    const map = new Map();
    for (const r of rounds || []) {
        if (r.patronId !== patronId || !r.shoeId) continue;
        let e = map.get(r.shoeId);
        if (!e) {
            e = { shoeId: r.shoeId, tableKey: r.tableKey, label: `${r.gametype}${r.table}`, dealer: r.dealer, firstTs: r.ts, hands: 0, turnover: 0, theo: 0, actual: 0, maxBet: 0, minBet: Infinity };
            map.set(r.shoeId, e);
        }
        const w = Number(r.wager) || 0;
        e.hands += 1; e.turnover += w; e.theo += w * edgeFor(r.gametype); e.actual += Number(r.winLoss) || 0;
        if (w > e.maxBet) e.maxBet = w;
        if (w < e.minBet) e.minBet = w;
        if (r.ts < e.firstTs) e.firstTs = r.ts;
    }
    return [...map.values()].map((e) => ({
        ...e,
        theo: Math.round(e.theo),
        avgBet: e.hands ? e.turnover / e.hands : 0,
        spread: e.minBet > 0 ? e.maxBet / e.minBet : 0,
        riskFlag: e.minBet > 0 && (e.maxBet / e.minBet) > 20,
    })).sort((a, b) => b.firstTs.localeCompare(a.firstTs));
}

// Every hand of ONE shoe (all patrons at that table-chunk = the shoe's
// dealt sequence), flagged where OUR patron wagered. Powers the bead
// plate + bankroll + depth charts.
export function shoeHandDetail(rounds, patronId, shoeId) {
    const hands = (rounds || []).filter((r) => r.shoeId === shoeId).sort((a, b) => a.ts.localeCompare(b.ts));
    let cum = 0;
    return hands.map((r, i) => {
        const mine = r.patronId === patronId;
        if (mine) cum += Number(r.winLoss) || 0;
        return {
            i: i + 1, ts: r.ts, winner: r.winner || (Number(r.winLoss) > 0 ? 'L' : 'W'),
            mine, wager: mine ? Number(r.wager) || 0 : 0,
            winLoss: mine ? Number(r.winLoss) || 0 : 0,
            betOption: mine ? r.betOption : null,
            cum, penetration: Math.round(((i + 1) / hands.length) * 100),
        };
    });
}

// Current seat occupancy per table — powers the floor map's "seats"
// tooltip style. A patron is considered clocked-in at the table where
// their most-recent round (globally) happened; their per-table avg bet
// and ADT (today's theo at that table) ride along. One patron per seat
// (highest avg bet wins a collision).
export function currentSeatOccupancy(rounds, patronMeta) {
    const lastByPatron = new Map();
    for (const r of rounds || []) {
        const p = lastByPatron.get(r.patronId);
        if (!p || r.ts > p.ts) lastByPatron.set(r.patronId, r);
    }
    // Accumulate each patron's stats AT their current table only.
    const acc = new Map();  // pid → { wager, hands, theo }
    for (const r of rounds || []) {
        const last = lastByPatron.get(r.patronId);
        if (!last || last.tableKey !== r.tableKey) continue;
        let e = acc.get(r.patronId);
        if (!e) { e = { wager: 0, hands: 0, theo: 0 }; acc.set(r.patronId, e); }
        const w = Number(r.wager) || 0;
        e.wager += w; e.hands += 1; e.theo += w * edgeFor(r.gametype);
    }
    const out = new Map();  // tableKey → seats[1..7]
    for (const [pid, last] of lastByPatron) {
        const e = acc.get(pid);
        if (!e || !last.seat) continue;
        const meta = patronMeta ? patronMeta.get(pid) : null;
        const entry = {
            patronId: pid, seat: last.seat,
            cardType: meta?.cardType || 'BASE',
            avgBet: e.hands ? e.wager / e.hands : 0,
            adt: Math.round(e.theo),
        };
        let seats = out.get(last.tableKey);
        if (!seats) { seats = new Map(); out.set(last.tableKey, seats); }
        const existing = seats.get(last.seat);
        if (!existing || entry.avgBet > existing.avgBet) seats.set(last.seat, entry);
    }
    // Convert inner maps to plain arrays for easy consumption.
    const plain = new Map();
    for (const [tk, seats] of out) plain.set(tk, [...seats.values()].sort((a, b) => a.seat - b.seat));
    return plain;
}

// Set of tableKeys played by ANY patron in the given list — powers the
// scatter-heatmap highlight overlay. When the right-side panel switches
// from Top Winners to Top Losers, the set of highlighted tables
// automatically follows because it's derived from whatever patrons are
// currently ranked.
export function tableKeysPlayedByPatrons(rounds, patronIds) {
    const wanted = patronIds instanceof Set ? patronIds : new Set(patronIds || []);
    const out = new Set();
    if (!wanted.size) return out;
    for (const r of rounds || []) {
        if (wanted.has(r.patronId)) out.add(r.tableKey);
    }
    return out;
}

// Rolling Δ over the same window — for the Phase B "Watchlist" panel.
// Returns [{ patronId, delta, from, to }] sorted by |delta| desc.
export function patronRecentDeltas(rounds, { nowIso = null, windowMinutes = 15 } = {}) {
    const trajectories = patronRecentTrajectories(rounds, { nowIso, windowMinutes, buckets: 6 });
    const arr = [];
    for (const [patronId, slots] of trajectories) {
        if (!slots.length) continue;
        const from = slots[0], to = slots[slots.length - 1];
        const delta = to - from;
        if (Math.abs(delta) < 1) continue;
        arr.push({ patronId, delta, from, to });
    }
    arr.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
    return arr;
}
