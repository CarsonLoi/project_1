// Player 360 — periods, per-option KPIs and ordering for the drill-down.
// Spec: docs/superpowers/specs/2026-09-26-patron-360-drilldown-design.md
// Pure; money is PATRON perspective except the two Casino Theo figures.

import { OPTION_BY_CODE, ymd, inWindow, optionEvidence, verdictFrom, worstState } from './patron360';

export const PERIODS = [
    { id: 'today', label: 'Today' },
    { id: '3m', label: 'Last 3 months' },
    { id: '12m', label: 'Last 12 months' },
];
export const DEFAULT_PERIOD = '3m';
export const periodLabel = (id) => (PERIODS.find((p) => p.id === id) || PERIODS[1]).label;

export function periodFrom(id, today) {
    if (id === 'today') return today;
    const [y, m, d] = today.split('-').map(Number);
    if (id === '3m') return ymd(new Date(y, m - 4, d));
    return ymd(new Date(y - 1, m - 1, d + 1));
}
export const fetchRange = (today) => ({ from: periodFrom('12m', today), to: today });

export function viewsInPeriod(views, id, today) {
    const from = periodFrom(id, today);
    return views.filter((v) => String(v.date) >= from && String(v.date) <= today);
}

export function sortBy(list, get, dir) {
    return [...list].sort((a, b) => {
        const x = get(a), y = get(b);
        const nx = x == null || (typeof x === 'number' && Number.isNaN(x));
        const ny = y == null || (typeof y === 'number' && Number.isNaN(y));
        if (nx && ny) return 0;
        if (nx) return 1;
        if (ny) return -1;
        return (typeof x === 'string' ? x.localeCompare(y) : x - y) * dir;
    });
}

export function optionKpis(views, code) {
    const opt = OPTION_BY_CODE.get(code);
    const theoEdge = opt ? opt.theo : null;
    let bets = 0, turnover = 0, casino = 0;
    let wEdge = 0, wKnown = 0, seatedHands = 0, shoes = 0, negShoes = 0, negShoesBet = 0, negBets = 0;
    for (const v of views) {
        for (const b of v.bets) if (b.betType === code) { bets += 1; turnover += b.wager; casino += b.casinoWin; }
        if (v.firstHand == null) continue;
        shoes += 1;
        let sNeg = false, sNegBet = false;
        for (const h of v.hands) {
            if (!inWindow(v, h.handNo)) continue;
            seatedHands += 1;
            const e = h.edge[code];
            const neg = e != null && e < 0;
            if (neg) sNeg = true;
            const m = v.betsByHand.get(h.handNo);
            const c = m && m.get(code);
            if (!c) continue;
            if (e != null) { wEdge += c.wager * e; wKnown += c.wager; }
            if (neg) { sNegBet = true; negBets += 1; }
        }
        if (sNeg) negShoes += 1;
        if (sNegBet) negShoesBet += 1;
    }
    const ev = optionEvidence(views, code);
    return {
        code, ev, theoEdge, bets, turnover,
        avgBet: bets ? turnover / bets : null,
        patronWin: -casino,
        edgePlayed: wKnown ? wEdge / wKnown : null,
        theoGeneric: theoEdge == null ? null : (turnover * theoEdge) / 100,
        theoActual: wKnown ? wEdge / 100 : null,
        involvement: seatedHands ? bets / seatedHands : null,
        seatedHands, shoes, negShoes, negShoesBet, negBets,
        worst: worstState(ev),
    };
}

export const gapOf = (k) => (k.edgePlayed == null || !k.theoEdge ? null : (k.edgePlayed - k.theoEdge) / k.theoEdge);

export function summaryRows(views) {
    const codes = new Set();
    for (const v of views) for (const b of v.bets) codes.add(b.betType);
    return [...codes].map((c) => optionKpis(views, c)).filter((k) => k.bets > 0);
}

export function sortSummary(rows, sort) {
    return sort.key === 'gap' ? sortBy(rows, gapOf, 1) : sortBy(rows, (r) => r[sort.key], sort.dir);
}

export const worstOption = (rows) => sortBy(rows, gapOf, 1)[0] || null;
export const periodVerdict = (rows) => verdictFrom(rows.map((r) => r.ev));

export function shoeRowsFor(views, code, { onlyNeg = true } = {}) {
    const out = [];
    for (const v of views) {
        let negHands = 0, negBets = 0, negMoney = 0, bets = 0, wager = 0, casino = 0;
        for (const h of v.hands) {
            const e = h.edge[code];
            const neg = e != null && e < 0;
            const seated = inWindow(v, h.handNo);
            if (neg && seated) negHands += 1;
            const m = v.betsByHand.get(h.handNo);
            const c = m && m.get(code);
            if (!c) continue;
            bets += 1; wager += c.wager; casino += c.casinoWin;
            if (neg) { negBets += 1; negMoney += c.wager; }
        }
        if (onlyNeg ? negHands === 0 : bets === 0 && negHands === 0) continue;
        out.push({ view: v, negHands, negBets, negMoney, bets, wager, patronWin: -casino });
    }
    return out;
}
