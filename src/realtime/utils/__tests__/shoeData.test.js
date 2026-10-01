import { groupShoeRows, generateMockShoe, settleBet, patronBetsInShoe, shoeTotals } from '../shoeData';

describe('settleBet', () => {
    test('banker win costs the house 0.95', () => expect(settleBet('BANKER', 1000, { result: 'B' })).toBeCloseTo(-950));
    test('player bet loses on banker', () => expect(settleBet('PLAYER', 1000, { result: 'B' })).toBe(1000));
    test('main bets push on a tie', () => {
        expect(settleBet('BANKER', 1000, { result: 'T' })).toBe(0);
        expect(settleBet('PLAYER', 1000, { result: 'T' })).toBe(0);
    });
    test('tie bet pays 8:1', () => expect(settleBet('TIE', 100, { result: 'T' })).toBe(-800));
});

describe('groupShoeRows', () => {
    const rows = [
        { shoe_id: 'S1', table_id: '10065', gametype: 'BA', game_id: 'g2', hand_no: 2, result: 'P', player_id: 'A', seat: 3, bet_type: 'PLAYER', wager: 500, casino_win: -500, dealer: 'Lee' },
        { shoe_id: 'S1', table_id: '10065', gametype: 'BA', game_id: 'g1', hand_no: 1, result: 'B', player_id: null, wager: 0, casino_win: 0, dealer: 'Lee' },
        { shoe_id: 'S1', table_id: '10065', gametype: 'BA', game_id: 'g2', hand_no: 2, result: 'P', player_id: 'B', seat: 5, bet_type: 'BANKER', wager: 300, casino_win: 300, dealer: 'Lee' },
    ];
    test('groups by hand, sorted, keeping empty hands', () => {
        const shoe = groupShoeRows(rows);
        expect(shoe.shoeId).toBe('S1');
        expect(shoe.dealer).toBe('Lee');
        expect(shoe.hands.map((h) => h.handNo)).toEqual([1, 2]);
        expect(shoe.hands[0].bets).toEqual([]);
        expect(shoe.hands[1].bets).toHaveLength(2);
        expect(shoe.hands[1].wager).toBe(800);
        expect(shoe.hands[1].casinoNet).toBe(-200);
    });
    test('patron bets and totals', () => {
        const shoe = groupShoeRows(rows);
        expect(patronBetsInShoe(shoe, 'A')).toEqual([
            { handNo: 2, result: 'P', playerId: 'A', seat: 3, betType: 'PLAYER', wager: 500, casinoWin: -500 },
        ]);
        expect(shoeTotals(shoe)).toMatchObject({ hands: 2, wager: 800, casinoNet: -200, bets: 2, counts: { B: 1, P: 1, T: 0 } });
    });
});

describe('generateMockShoe', () => {
    const args = {
        tableId: '10065', gametype: 'BA', shoeId: 'BA10065-S4', handCount: 40,
        seated: [{ playerId: 'PID-1', seat: 2, avgBet: 1000 }, { playerId: 'PID-2', seat: 6, avgBet: 5000 }],
        dealer: 'Lee', startMs: 0,
    };
    test('deterministic for the same seed', () => expect(generateMockShoe(args)).toEqual(generateMockShoe(args)));
    test('every hand 1..N is present', () => {
        const shoe = groupShoeRows(generateMockShoe(args));
        expect(shoe.hands.map((h) => h.handNo)).toEqual(Array.from({ length: 40 }, (_, i) => i + 1));
    });
    test('every bet is settled against its hand', () => {
        for (const r of generateMockShoe(args)) {
            if (!r.player_id || !['BANKER', 'PLAYER', 'TIE'].includes(r.bet_type)) continue;
            const hand = { result: r.result, bankerPair: !!r.banker_pair, playerPair: !!r.player_pair };
            expect(r.casino_win).toBeCloseTo(settleBet(r.bet_type, r.wager, hand));
        }
    });
    test('edge paths reach every row and the counter seat bets the hot option', () => {
        const paths = { SL7: Array.from({ length: 40 }, (_, i) => (i < 10 ? 5 : -3)) };
        const rows = generateMockShoe({ ...args, edgePaths: paths, counter: { seat: 2, code: 'SL7' } });
        const shoe = groupShoeRows(rows);
        expect(shoe.hands[0].edges.SL7).toBe(5);
        expect(shoe.hands[39].edges.SL7).toBe(-3);
        expect(shoe.hands[39].edges.BANKER).toBeNull();
        const late = rows.filter((r) => r.bet_type === 'SL7' && r.seat === 2 && r.hand_no > 10);
        expect(late.length).toBeGreaterThan(10);
    });
});
