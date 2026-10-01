// Seats at one table for the Table focus panel.
// =============================================
// Seven seats, each with its current patron's bets in this shoe (patron
// perspective), how many landed on a negative-edge hand, and a this-shoe
// verdict from the same evidence tests as the Player 360.

import { PATRON_360 } from '../constants/rtConfig';
import { buildShoeViews, evidenceFor, verdictFrom } from './patron360';

const { BET_OPTIONS } = PATRON_360;
const THEO = new Map(BET_OPTIONS.map((o) => [o.code, o.theo]));
export const SEAT_COUNT = 7;

// Per-option edge by hand (index = position in shoe.hands).
export function edgePaths(shoe) {
    const hands = (shoe && shoe.hands) || [];
    const out = {};
    for (const o of BET_OPTIONS) out[o.code] = hands.map((h) => (h.edges ? h.edges[o.code] ?? null : null));
    return out;
}

export function hasEdges(shoe) {
    return !!(shoe && shoe.hands && shoe.hands.some((h) => h.edges));
}

function verdictFor(shoe, tableKey, playerId, bets) {
    if (!bets.length || !hasEdges(shoe)) return 'NO DATA';
    const shoeKey = `${tableKey}|${shoe.shoeId}`;
    const shoes = new Map([[shoeKey, {
        shoeKey, tableKey, shoeId: shoe.shoeId,
        hands: shoe.hands.map((h) => ({ handNo: h.handNo, edge: h.edges || {} })),
    }]]);
    const norm = bets.map((b) => ({
        shoeKey, handNo: b.handNo, betType: b.code, wager: b.wager,
        casinoWin: -b.patronWin, theoWin: (b.wager * (THEO.get(b.code) ?? 0)) / 100,
    }));
    return verdictFrom(evidenceFor(buildShoeViews(shoes, norm))).level;
}

// `seated`: [{ seat, playerId, cardType, cumWin }] from the patrons feed.
export function buildSeats(shoe, seated = [], tableKey = '') {
    const hands = (shoe && shoe.hands) || [];
    const bySeat = new Map(seated.map((s) => [Number(s.seat), s]));
    // Seats the patrons feed doesn't know about yet: the last bettor there.
    const lastBettor = new Map();
    for (const h of hands) for (const b of h.bets) if (b.seat != null) lastBettor.set(b.seat, b.playerId);

    const seats = [];
    for (let seat = 1; seat <= SEAT_COUNT; seat++) {
        const info = bySeat.get(seat);
        const playerId = info ? String(info.playerId) : lastBettor.get(seat) || null;
        if (!playerId) { seats.push({ seat, empty: true }); continue; }
        const bets = [];
        for (const h of hands) {
            for (const b of h.bets) {
                if (b.seat !== seat || b.playerId !== playerId) continue;
                const e = h.edges ? h.edges[b.betType] : null;
                bets.push({ handNo: h.handNo, code: b.betType, wager: b.wager, patronWin: -b.casinoWin, neg: e != null && e < 0 });
            }
        }
        seats.push({
            seat, empty: false, playerId,
            cardType: info ? info.cardType : null,
            dayWin: info && Number.isFinite(info.cumWin) ? -info.cumWin : null,     // patron perspective
            bets,
            firstHand: bets.length ? bets[0].handNo : null,
            shoeWin: bets.reduce((a, b) => a + b.patronWin, 0),
            wager: bets.reduce((a, b) => a + b.wager, 0),
            negBets: bets.filter((b) => b.neg).length,
            verdict: verdictFor(shoe, tableKey, playerId, bets),
        });
    }
    return seats;
}

// The seat to open with: an ACTION seat, else a WATCH seat, else none.
export function defaultSeat(seats) {
    const pick = (lvl) => seats.find((s) => !s.empty && s.verdict === lvl);
    const s = pick('ACTION') || pick('WATCH');
    return s ? s.seat : null;
}
