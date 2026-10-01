// Player 360 — side-bet advantage model.
// =====================================
// Spec: docs/superpowers/specs/2026-09-26-patron-360-side-bet-design.md
//
// Pure calculations behind the Player 360 (no React, no fetching; unit
// tested). Two inputs, both for one patron over a date range:
//   bets       — one row per bet the patron placed            (contract §8)
//   shoe edges — one row per hand of every shoe they played,
//                with the live edge of every bet option         (contract §9)
// Joined per shoe they answer the advantage question directly: when an
// option's edge turned negative, did this patron start betting it?
//
// Money leaving this module is PATRON perspective (+ = patron won).

import { PATRON_360, GAMING_DAY_START_HOUR } from '../constants/rtConfig';

const { BET_OPTIONS, TESTS, COUNTING_TESTS } = PATRON_360;

export const OPTION_BY_CODE = new Map(BET_OPTIONS.map((o) => [o.code, o]));
const optionRank = (code) => {
    const i = BET_OPTIONS.findIndex((o) => o.code === code);
    return i === -1 ? 99 : i;
};

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const pad2 = (n) => String(n).padStart(2, '0');
const flag = (v) => v === true || Number(v) === 1;

export const ymd = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

function groupBy(arr, keyFn) {
    const m = new Map();
    for (const x of arr) {
        const k = keyFn(x);
        let list = m.get(k);
        if (!list) { list = []; m.set(k, list); }
        list.push(x);
    }
    return m;
}

// Gaming day of `now`: the local date 7 hours earlier.
export function currentGamingDate(now = Date.now()) {
    return ymd(new Date(now - GAMING_DAY_START_HOUR * 3600000));
}

export const RANGES = [
    { id: 'today', label: 'Today' },
    { id: '7d', label: '7 days' },
    { id: '30d', label: '30 days' },
    { id: 'ytd', label: 'YTD' },
];

export function rangeFor(id, now = Date.now()) {
    const to = currentGamingDate(now);
    if (id === 'today') return { from: to, to };
    if (id === '7d' || id === '30d') {
        const [y, m, d] = to.split('-').map(Number);
        return { from: ymd(new Date(y, m - 1, d - (id === '7d' ? 6 : 29))), to };
    }
    return { from: `${to.slice(0, 4)}-01-01`, to };
}

export function normalizeBets(rows) {
    const out = [];
    for (const r of rows || []) {
        const wager = num(r.wager);
        if (!(wager > 0) || !r.bet_type) continue;
        const tableKey = `${r.gametype}|${r.table_id}`;
        out.push({
            date: String(r.gaming_date).slice(0, 10),
            time: r.game_time,
            tableKey,
            shoeId: r.shoe_id,
            shoeKey: `${tableKey}|${r.shoe_id}`,
            handNo: num(r.hand_no),
            betType: String(r.bet_type).toUpperCase(),
            wager,
            casinoWin: num(r.casino_win),
            theoWin: num(r.theo_win),
        });
    }
    out.sort((a, b) => String(a.time).localeCompare(String(b.time)) || a.handNo - b.handNo);
    return out;
}

export function normalizeShoeEdges(rows) {
    const shoes = new Map();
    for (const r of rows || []) {
        const tableKey = `${r.gametype}|${r.table_id}`;
        const shoeKey = `${tableKey}|${r.shoe_id}`;
        let s = shoes.get(shoeKey);
        if (!s) {
            s = { shoeKey, tableKey, shoeId: r.shoe_id, date: String(r.gaming_date).slice(0, 10), start: r.game_time, hands: [] };
            shoes.set(shoeKey, s);
        }
        const edge = {};
        for (const o of BET_OPTIONS) {
            const v = r[`house_edge_${o.edgeKey}`];
            edge[o.code] = v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v);
        }
        s.hands.push({
            handNo: num(r.hand_no), time: r.game_time, result: r.result,
            bankerPair: flag(r.banker_pair), playerPair: flag(r.player_pair), edge,
        });
        if (String(r.game_time) < String(s.start)) s.start = r.game_time;
    }
    for (const s of shoes.values()) s.hands.sort((a, b) => a.handNo - b.handNo);
    return shoes;
}

// Join shoes and bets. `firstHand`..`lastHand` is the patron's seat window
// in that shoe — only hands inside it count as a chance to bet.
export function buildShoeViews(shoes, bets) {
    const byShoe = groupBy(bets, (b) => b.shoeKey);
    const views = [];
    const add = (s, list) => {
        const betsByHand = new Map();
        let first = null, last = null;
        for (const b of list) {
            let hand = betsByHand.get(b.handNo);
            if (!hand) { hand = new Map(); betsByHand.set(b.handNo, hand); }
            const c = hand.get(b.betType) || { wager: 0, casinoWin: 0, theoWin: 0 };
            c.wager += b.wager; c.casinoWin += b.casinoWin; c.theoWin += b.theoWin;
            hand.set(b.betType, c);
            if (first == null || b.handNo < first) first = b.handNo;
            if (last == null || b.handNo > last) last = b.handNo;
        }
        let maxHand = last ?? 0;
        for (const h of s.hands) if (h.handNo > maxHand) maxHand = h.handNo;
        views.push({ ...s, bets: list, betsByHand, firstHand: first, lastHand: last, maxHand });
    };
    for (const s of shoes.values()) add(s, byShoe.get(s.shoeKey) || []);
    // Bets whose shoe is missing from the edge feed still show, edge-less.
    for (const [key, list] of byShoe) {
        if (shoes.has(key)) continue;
        const b = list[0];
        add({ shoeKey: key, tableKey: b.tableKey, shoeId: b.shoeId, date: b.date, start: b.time, hands: [], missingEdges: true }, list);
    }
    return views.sort((a, b) => String(b.start).localeCompare(String(a.start)));
}

export const inWindow = (view, handNo) =>
    view.firstHand != null && handNo >= view.firstHand && handNo <= view.lastHand;

const cellFor = (view, handNo, code) => {
    const m = view.betsByHand.get(handNo);
    return m ? m.get(code) || null : null;
};

export function optionShoeStats(view, code) {
    let bets = 0, turnover = 0, casino = 0, negMoney = 0, negHands = 0, negHandsBet = 0, windowHands = 0;
    for (const h of view.hands) {
        if (!inWindow(view, h.handNo)) continue;
        windowHands += 1;
        const e = h.edge[code];
        const neg = e != null && e < 0;
        if (neg) negHands += 1;
        const c = cellFor(view, h.handNo, code);
        if (!c) continue;
        bets += 1; turnover += c.wager; casino += c.casinoWin;
        if (neg) { negMoney += c.wager; negHandsBet += 1; }
    }
    return {
        bets, turnover, result: -casino, negMoney,
        negMoneyShare: turnover ? negMoney / turnover : null,
        negHands, negHandsBet, windowHands,
    };
}

// ── Evidence tests ───────────────────────────────────────────────────
export const TEST_META = {
    entry: { label: 'Selective entry', unit: 'x', question: 'Do they bet this option far more often once its edge turns negative?' },
    ramp: { label: 'Bet ramp', unit: 'x', question: 'Do they bet bigger on negative-edge hands?' },
    money: { label: 'Money on −edge', unit: 'x', question: 'Is their money concentrated on negative-edge hands, compared with how often those hands occur?' },
    luck: { label: 'Patron Win vs theo', unit: 'sd', question: 'Is their Patron Win bigger than chance explains?' },
};

function testOf(id, value) {
    const t = TESTS[id];
    let state = 'insufficient';
    if (value != null && !Number.isNaN(value)) state = value >= t.flag ? 'flag' : value >= t.watch ? 'watch' : 'clear';
    return { value, state };
}

export function optionEvidence(views, code) {
    const opt = OPTION_BY_CODE.get(code);
    const unitVar = opt ? opt.var : 1;
    let negHands = 0, posHands = 0, negBets = 0, posBets = 0, negMoney = 0, posMoney = 0;
    let casino = 0, theoC = 0, variance = 0;
    for (const v of views) {
        for (const h of v.hands) {
            if (!inWindow(v, h.handNo)) continue;
            const e = h.edge[code];
            if (e == null) continue;
            const neg = e < 0;
            if (neg) negHands += 1; else posHands += 1;
            const c = cellFor(v, h.handNo, code);
            if (!c) continue;
            if (neg) { negBets += 1; negMoney += c.wager; } else { posBets += 1; posMoney += c.wager; }
            casino += c.casinoWin; theoC += c.theoWin;
            variance += c.wager * c.wager * unitVar;
        }
    }
    const bets = negBets + posBets;
    const turnover = negMoney + posMoney;
    const rateNeg = negHands ? negBets / negHands : null;
    const ratePos = posHands ? posBets / posHands : null;

    let entry = null;
    if (negHands >= TESTS.entry.minNegHands && posHands >= TESTS.entry.minPosHands && bets >= TESTS.entry.minBets) {
        entry = ratePos > 0 ? rateNeg / ratePos : Infinity;
    }
    const ramp = negBets >= TESTS.ramp.minEach && posBets >= TESTS.ramp.minEach
        ? (negMoney / negBets) / (posMoney / posBets) : null;
    const handShare = negHands + posHands ? negHands / (negHands + posHands) : 0;
    const money = bets >= TESTS.money.minBets && negHands >= TESTS.money.minNegHands && turnover > 0 && handShare > 0
        ? (negMoney / turnover) / handShare : null;
    const luck = bets >= TESTS.luck.minBets && variance > 0 ? (theoC - casino) / Math.sqrt(variance) : null;

    return {
        code, name: opt ? opt.name : code, side: opt ? opt.side : true,
        bets, turnover, result: -casino, theo: -theoC,
        negHands, posHands, negBets, posBets, negMoney, posMoney, rateNeg, ratePos,
        tests: { entry: testOf('entry', entry), ramp: testOf('ramp', ramp), money: testOf('money', money), luck: testOf('luck', luck) },
    };
}

// One row per option the patron bet: side bets first (by turnover), then
// the main bets in configured order.
export function evidenceFor(views) {
    const codes = new Set();
    for (const v of views) for (const b of v.bets) codes.add(b.betType);
    return [...codes].map((c) => optionEvidence(views, c)).sort((a, b) => {
        if (a.side !== b.side) return a.side ? -1 : 1;
        return a.side ? b.turnover - a.turnover : optionRank(a.code) - optionRank(b.code);
    });
}

export function verdictFrom(rows) {
    const all = [];
    for (const r of rows) for (const [id, t] of Object.entries(r.tests)) all.push({ id, code: r.code, state: t.state });
    if (!all.length || all.every((t) => t.state === 'insufficient')) return { level: 'NO DATA', reason: 'Not enough bets to judge' };
    const flags = all.filter((t) => t.state === 'flag');
    const watches = all.filter((t) => t.state === 'watch');
    const names = (list) => list.map((t) => `${t.code} ${TEST_META[t.id].label.toLowerCase()}`).join(', ');
    if (flags.some((t) => COUNTING_TESTS.includes(t.id)) || flags.length >= 2) {
        return { level: 'ACTION', reason: `${flags.length} flag${flags.length === 1 ? '' : 's'}: ${names(flags)}` };
    }
    if (flags.length === 1 || watches.length >= 2) {
        const parts = [];
        if (flags.length) parts.push(`1 flag: ${names(flags)}`);
        if (watches.length) parts.push(`${watches.length} watch: ${names(watches)}`);
        return { level: 'WATCH', reason: parts.join(' · ') };
    }
    return { level: 'CLEAR', reason: watches.length ? `1 watch: ${names(watches)}` : 'No test above threshold' };
}

const STATE_RANK = { insufficient: 0, clear: 1, watch: 2, flag: 3 };

export function worstState(row) {
    let s = 'insufficient';
    for (const t of Object.values(row.tests)) if (STATE_RANK[t.state] > STATE_RANK[s]) s = t.state;
    return s;
}

// The option that drives the verdict: most flags, then most watches, side
// bets before main bets, then most money. Only options with bets count.
export function defaultOption(rows) {
    const pool = rows.filter((r) => r.bets > 0);
    const list = pool.length ? pool : rows;
    if (!list.length) return 'BANKER';
    const score = (r) => {
        let s = r.side ? 1 : 0;
        for (const t of Object.values(r.tests)) s += t.state === 'flag' ? 100 : t.state === 'watch' ? 10 : 0;
        return s;
    };
    return [...list].sort((a, b) => (score(b) - score(a)) || (b.turnover - a.turnover))[0].code;
}

const HEADLINE = {
    entry: (c) => `${c} bets follow the negative edge`,
    ramp: (c) => `${c} bets grow on the negative edge`,
    money: (c) => `${c} money piles onto the negative edge`,
    luck: (c) => `${c} winning beyond chance`,
};

// ≤ 7 words: the strongest finding for the option under review.
export function headlineFor(verdict, row) {
    if (!row || !verdict || verdict.level === 'NO DATA') return 'Too few bets to judge';
    for (const state of ['flag', 'watch']) {
        for (const id of ['entry', 'ramp', 'money', 'luck']) {
            if (row.tests[id] && row.tests[id].state === state) return HEADLINE[id](row.code);
        }
    }
    return 'No edge-timed betting';
}

// Bet rate per edge band for one option over every seated hand with a
// known edge. `bands` are `{ gte?, lt? }` ranges (see format.edgeBands).
export function edgeProfile(views, code, bands) {
    const acc = bands.map(() => ({ hands: 0, bets: 0, wager: 0 }));
    const inBand = (b, e) => (b.gte == null || e >= b.gte) && (b.lt == null || e < b.lt);
    let hands = 0, bets = 0;
    for (const v of views) {
        for (const h of v.hands) {
            if (!inWindow(v, h.handNo)) continue;
            const e = h.edge[code];
            if (e == null) continue;
            const i = bands.findIndex((b) => inBand(b, e));
            if (i === -1) continue;
            acc[i].hands += 1; hands += 1;
            const c = cellFor(v, h.handNo, code);
            if (c) { acc[i].bets += 1; acc[i].wager += c.wager; bets += 1; }
        }
    }
    return {
        bands: acc.map((b) => ({ ...b, rate: b.hands ? b.bets / b.hands : null, avgBet: b.bets ? b.wager / b.bets : null })),
        hands, bets, rate: hands ? bets / hands : null,
    };
}

export function heatmapRows(views, code, { onlyBet = true, sort = 'suspicious' } = {}) {
    const rows = views.map((view) => ({ view, stats: optionShoeStats(view, code) }))
        .filter((r) => !onlyBet || r.stats.bets > 0);
    const newest = (a, b) => String(b.view.start).localeCompare(String(a.view.start));
    if (sort === 'suspicious') {
        rows.sort((a, b) => (b.stats.negMoney - a.stats.negMoney)
            || ((b.stats.negMoneyShare ?? 0) - (a.stats.negMoneyShare ?? 0))
            || newest(a, b));
    } else {
        rows.sort(newest);
    }
    return rows;
}

export function buildPatron360(betRows, edgeRows) {
    const bets = normalizeBets(betRows);
    const views = buildShoeViews(normalizeShoeEdges(edgeRows), bets);
    const evidence = evidenceFor(views);
    return { bets, views, evidence, verdict: verdictFrom(evidence), defaultOption: defaultOption(evidence) };
}
