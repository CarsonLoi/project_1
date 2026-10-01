// Hand-level shoe data — pure helpers.
// ====================================
// No React, no fetching: the shoe board, the patron panel and the mock
// all go through these, and they are unit tested.
//
// Wire shape (docs/realtime-surveillance-data-contract.md §7): one row
// per bet in a shoe, plus one row with player_id null for any hand
// nobody bet on. groupShoeRows() turns that into one object per hand.

import { PATRON_360 } from '../constants/rtConfig';

// Casino-perspective result of one bet (positive = the house won it).
// Main bets push on a tie; banker pays 0.95:1 (5% commission).
export function settleBet(betType, wager, hand) {
    const w = Number(wager) || 0;
    const r = hand && hand.result;
    switch (betType) {
        case 'BANKER': return r === 'T' ? 0 : r === 'B' ? -w * 0.95 : w;
        case 'PLAYER': return r === 'T' ? 0 : r === 'P' ? -w : w;
        case 'TIE': return r === 'T' ? -w * 8 : w;
        case 'BANKER_PAIR': return hand && hand.bankerPair ? -w * 11 : w;
        case 'PLAYER_PAIR': return hand && hand.playerPair ? -w * 11 : w;
        default: return 0;
    }
}

const flag = (v) => v === true || Number(v) === 1;

// Live edge per option code on a shoe-feed row (house_edge_<edgeKey>).
function rowEdges(r) {
    const out = {};
    let any = false;
    for (const o of PATRON_360.BET_OPTIONS) {
        const v = r[`house_edge_${o.edgeKey}`];
        const n = v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v);
        if (n != null) any = true;
        out[o.code] = n;
    }
    return any ? out : null;
}

export function groupShoeRows(rows) {
    const byHand = new Map();
    let tableId = null, gametype = null, shoeId = null;
    for (const r of rows || []) {
        const handNo = Number(r.hand_no);
        if (!Number.isFinite(handNo)) continue;
        if (tableId == null && r.table_id != null) tableId = String(r.table_id);
        if (gametype == null && r.gametype) gametype = r.gametype;
        if (shoeId == null && r.shoe_id != null) shoeId = String(r.shoe_id);
        let h = byHand.get(handNo);
        if (!h) {
            h = {
                handNo,
                gameId: r.game_id ?? null,
                time: r.game_time ?? null,
                result: r.result || null,
                bankerPair: flag(r.banker_pair),
                playerPair: flag(r.player_pair),
                dealer: r.dealer ?? null,
                edges: rowEdges(r),
                bets: [],
                wager: 0,
                casinoNet: 0,
            };
            byHand.set(handNo, h);
        }
        const wager = Number(r.wager) || 0;
        // Empty-hand rows (player_id null, wager 0) keep the hand but add no bet.
        if (r.player_id != null && r.player_id !== '' && wager > 0) {
            const casinoWin = Number(r.casino_win) || 0;
            h.bets.push({
                playerId: String(r.player_id),
                seat: r.seat == null ? null : Number(r.seat),
                betType: r.bet_type || '',
                wager,
                casinoWin,
            });
            h.wager += wager;
            h.casinoNet += casinoWin;
        }
    }
    const hands = [...byHand.values()].sort((a, b) => a.handNo - b.handNo);
    const last = hands[hands.length - 1];
    return { tableId, gametype, shoeId, dealer: last ? last.dealer : null, hands };
}

export function patronBetsInShoe(shoe, playerId) {
    if (!shoe || !playerId) return [];
    const out = [];
    for (const h of shoe.hands) {
        for (const b of h.bets) if (b.playerId === playerId) out.push({ handNo: h.handNo, result: h.result, ...b });
    }
    return out;
}

export function shoeTotals(shoe) {
    let wager = 0, casinoNet = 0, bets = 0;
    const counts = { B: 0, P: 0, T: 0 };
    const hands = (shoe && shoe.hands) || [];
    for (const h of hands) {
        wager += h.wager;
        casinoNet += h.casinoNet;
        bets += h.bets.length;
        if (counts[h.result] != null) counts[h.result] += 1;
    }
    return { hands: hands.length, wager, casinoNet, bets, counts };
}

// ── Mock generation ────────────────────────────────────────────────
// Deterministic per (table, shoe) so polling doesn't reshuffle history.
export function hashKey(s) {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
}
export function mulberry32(seed) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6D2B79F5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

// 8-deck baccarat outcome odds and the rough pair frequency.
const P_BANKER = 0.4586;
const P_PLAYER = 0.4462;
const P_PAIR = 0.0747;

const SIDE_CODES = PATRON_360.BET_OPTIONS.filter((o) => o.side && o.code !== 'TIE').map((o) => o.code);
const THEO = Object.fromEntries(PATRON_360.BET_OPTIONS.map((o) => [o.code, o.theo]));
const SIDE_PAYS = 10;

// Mock side bets (other than Tie) pay 10:1, won with the probability that
// gives the hand's live edge — so a negative edge really does pay the patron.
function settleSide(code, wager, edge, rand) {
    const e = edge == null ? THEO[code] : edge;
    return rand() < (1 - e / 100) / (SIDE_PAYS + 1) ? -wager * SIDE_PAYS : wager;
}

// `edgePaths` ({CODE: number[]}, index = hand - 1) adds the live edge to
// every row; `counter` ({ seat, code }) makes that seat bet `code` on most
// hands where its edge is negative — the pattern surveillance looks for.
export function generateMockShoe({ tableId, gametype, shoeId, handCount, seated = [], dealer = null, startMs = 0, handMs = 55000, edgePaths = null, counter = null }) {
    const rand = mulberry32(hashKey(`${gametype}|${tableId}|${shoeId}`));
    const rows = [];
    for (let n = 1; n <= handCount; n++) {
        const u = rand();
        const result = u < P_BANKER ? 'B' : u < P_BANKER + P_PLAYER ? 'P' : 'T';
        const bankerPair = rand() < P_PAIR;
        const playerPair = rand() < P_PAIR;
        const hand = { result, bankerPair, playerPair };
        const base = {
            table_id: String(tableId), gametype, shoe_id: shoeId, game_id: `${shoeId}-H${n}`,
            hand_no: n, game_time: new Date(startMs + (n - 1) * handMs).toISOString(),
            result, banker_pair: bankerPair ? 1 : 0, player_pair: playerPair ? 1 : 0, dealer,
        };
        const edgeAt = {};
        if (edgePaths) {
            for (const o of PATRON_360.BET_OPTIONS) {
                const v = edgePaths[o.code] ? edgePaths[o.code][n - 1] : null;
                edgeAt[o.code] = v ?? null;
                base[`house_edge_${o.edgeKey}`] = v ?? null;
            }
        }
        const bets = [];
        for (const s of seated) {
            if (rand() < 0.2) continue;                         // sits out ~1 hand in 5
            const main = rand() < 0.55 ? 'BANKER' : 'PLAYER';
            const wager = Math.max(100, Math.round((s.avgBet * (0.5 + rand())) / 100) * 100);
            bets.push({ player_id: s.playerId, seat: s.seat, bet_type: main, wager });
            if (rand() < 0.12) {
                const side = rand() < 0.4 ? 'TIE' : SIDE_CODES[Math.floor(rand() * SIDE_CODES.length)];
                bets.push({ player_id: s.playerId, seat: s.seat, bet_type: side, wager: Math.max(100, Math.round((wager * 0.1) / 100) * 100) });
            }
            if (counter && counter.seat === s.seat && edgeAt[counter.code] != null && edgeAt[counter.code] < 0 && rand() < 0.8) {
                bets.push({ player_id: s.playerId, seat: s.seat, bet_type: counter.code, wager: Math.max(100, Math.round((wager * (0.8 + rand())) / 100) * 100) });
            }
        }
        if (!bets.length) rows.push({ ...base, player_id: null, seat: null, bet_type: null, wager: 0, casino_win: 0 });
        for (const b of bets) {
            const known = b.bet_type === 'BANKER' || b.bet_type === 'PLAYER' || b.bet_type === 'TIE';
            rows.push({ ...base, ...b, casino_win: known ? settleBet(b.bet_type, b.wager, hand) : settleSide(b.bet_type, b.wager, edgeAt[b.bet_type], rand) });
        }
    }
    return rows;
}
