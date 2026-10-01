// Mock patron history for the Player 360 (contract §8 bets + §9 shoe edges).
// =======================================================================
// Deterministic per patron (memoised) so the 360 is stable across
// reopenings. It covers the last 12 months. Each shoe is 70–80 hands; every bet option's live edge
// follows a random walk around its theo that widens through the shoe, so
// negative edges show up mostly late, as on a real floor. The patron sits
// for a stretch of each shoe. One patron in eight is a synthetic side-bet
// counter: they bet a favourite side bet mostly when its edge is negative,
// and bigger the more negative it is — so CLEAR / WATCH / ACTION can all be
// demonstrated offline. Side-bet payouts below are mock-only.

import { hashKey, mulberry32 } from './shoeData';
import { PATRON_360, GAMING_DAY_START_HOUR } from '../constants/rtConfig';
import { currentGamingDate, ymd, OPTION_BY_CODE } from './patron360';

const { BET_OPTIONS } = PATRON_360;
const SIDE = BET_OPTIONS.filter((o) => o.side);
const HAND_MS = 55000;
const P_BANKER = 0.4586;
const P_PLAYER = 0.4462;
const P_PAIR = 0.0747;
// Per-hand step of each option's edge walk, in edge %.
const WANDER = { BANKER: 0.14, PLAYER: 0.14, TIE: 1.5, BTG: 0.6, STG: 1.0, BD: 0.4, SD: 0.4, SL7: 2.0, PPL: 1.2, L6: 1.4 };
// Side-bet payout (to one), for settling mock bets.
const PAYOUT = { TIE: 8, BTG: 20, STG: 40, BD: 10, SD: 10, SL7: 30, PPL: 11, L6: 12 };

const cache = new Map();

export const isMockCounter = (patronId) => hashKey(`bets|${patronId}`) % 8 === 0;

function gauss(rand) {
    let u = 0;
    while (u === 0) u = rand();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
}
const round100 = (v) => Math.max(100, Math.round(v / 100) * 100);

// Casino-perspective result of one mock bet. Main bets settle on the hand
// result; side bets hit with the probability their edge implies.
function settle(code, wager, result, edge, rand) {
    if (code === 'BANKER') return result === 'T' ? 0 : result === 'B' ? -wager * 0.95 : wager;
    if (code === 'PLAYER') return result === 'T' ? 0 : result === 'P' ? -wager : wager;
    if (code === 'TIE') return result === 'T' ? -wager * 8 : wager;
    const m = PAYOUT[code] || 10;
    const p = Math.min(0.95, Math.max(0, (1 - edge / 100) / (m + 1)));
    return rand() < p ? -wager * m : wager;
}

export function generateMockPatronHistory(patronId, { now = Date.now() } = {}) {
    const id = String(patronId);
    const today = currentGamingDate(now);
    const cacheKey = `${id}|${today}`;
    if (cache.has(cacheKey)) return cache.get(cacheKey);

    const rand = mulberry32(hashKey(`bets|${id}`));
    const counter = isMockCounter(id);
    const fav = SIDE[hashKey(`fav|${id}`) % SIDE.length].code;
    const baseBet = 300 + Math.floor(rand() * 18) * 100;
    const [y, m, d] = today.split('-').map(Number);
    const last = new Date(y, m - 1, d);
    // A counter only starts counting ~100 days ago, so the periods differ.
    const countingFrom = ymd(new Date(y, m - 1, d - 100));
    const bets = [];
    const shoeEdges = [];

    for (let day = new Date(y - 1, m - 1, d + 1); day <= last; day.setDate(day.getDate() + 1)) {
        const date = ymd(day);
        const isToday = date === today;
        const counting = counter && date >= countingFrom;
        if (!isToday && rand() > 0.35) continue;
        const dayBets = [];
        const dayEdges = [];
        let clock = new Date(day.getFullYear(), day.getMonth(), day.getDate(), GAMING_DAY_START_HOUR + 3).getTime();
        const shoes = 1 + Math.floor(rand() * 3);

        for (let s = 0; s < shoes; s += 1) {
            const gametype = rand() < 0.6 ? 'BA' : 'NC';
            const table = String(10001 + Math.floor(rand() * 90));
            const shoeId = `${gametype}${table}-${date.replace(/-/g, '')}-S${s + 1}`;
            const seat = 1 + Math.floor(rand() * 7);
            const dealer = `D${1 + (hashKey(shoeId) % 40)}`;
            const length = 70 + Math.floor(rand() * 11);
            const first = 1 + Math.floor(rand() * 30);
            const leave = Math.min(length, first + 14 + Math.floor(rand() * 31));
            const walk = Object.fromEntries(BET_OPTIONS.map((o) => [o.code, 0]));

            for (let h = 1; h <= length; h += 1) {
                const edge = {};
                for (const o of BET_OPTIONS) {
                    walk[o.code] += gauss(rand);
                    edge[o.code] = o.theo + (WANDER[o.code] ?? 1) * walk[o.code];
                }
                const u = rand();
                const result = u < P_BANKER ? 'B' : u < P_BANKER + P_PLAYER ? 'P' : 'T';
                const bankerPair = rand() < P_PAIR;
                const playerPair = rand() < P_PAIR;
                const time = new Date(clock).toISOString();
                clock += HAND_MS;

                const edgeRow = {
                    gaming_date: date, table_id: table, gametype, shoe_id: shoeId, hand_no: h, game_time: time,
                    result, banker_pair: bankerPair ? 1 : 0, player_pair: playerPair ? 1 : 0,
                };
                for (const o of BET_OPTIONS) edgeRow[`house_edge_${o.edgeKey}`] = +edge[o.code].toFixed(3);
                dayEdges.push(edgeRow);
                if (h < first || h > leave) continue;                    // not seated

                const placed = [];
                if (rand() < 0.85) placed.push([rand() < 0.55 ? 'BANKER' : 'PLAYER', round100(baseBet * (0.6 + 0.8 * rand()))]);
                if (counting && edge[fav] < 0) {
                    if (rand() < 0.85) placed.push([fav, round100(baseBet * (0.3 + 0.4 * rand()) * (1 + Math.min(3, -edge[fav] / 5)))]);
                } else if (rand() < (counting ? 0.03 : 0.1)) {
                    const code = counting ? fav : SIDE[Math.floor(rand() * SIDE.length)].code;
                    placed.push([code, round100(baseBet * (0.1 + 0.2 * rand()))]);
                }
                for (const [code, w] of placed) {
                    dayBets.push({
                        gaming_date: date, game_time: time, table_id: table, gametype, shoe_id: shoeId,
                        game_id: `${shoeId}-H${h}`, hand_no: h, seat, dealer, result,
                        bet_type: code, wager: w,
                        casino_win: settle(code, w, result, edge[code], rand),
                        theo_win: +((w * OPTION_BY_CODE.get(code).theo) / 100).toFixed(2),
                        edge_at_bet: +edge[code].toFixed(3),
                    });
                }
            }
            clock += 15 * 60000;
        }

        if (isToday && dayEdges.length) {
            // Land today's play so its last hand was a minute ago.
            const shift = (now - 60000) - new Date(dayEdges[dayEdges.length - 1].game_time).getTime();
            const move = (r) => { r.game_time = new Date(new Date(r.game_time).getTime() + shift).toISOString(); };
            dayEdges.forEach(move);
            dayBets.forEach(move);
        }
        bets.push(...dayBets);
        shoeEdges.push(...dayEdges);
    }

    const out = { bets, shoeEdges };
    cache.set(cacheKey, out);
    return out;
}
