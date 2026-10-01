import { buildSeats, defaultSeat, edgePaths, hasEdges } from '../seatSummary';
import { generateMockShoe, groupShoeRows } from '../shoeData';

const N = 60;
const paths = { SL7: Array.from({ length: N }, (_, i) => (i < 20 ? 8 : -4)), BANKER: Array(N).fill(1.06), PLAYER: Array(N).fill(1.24) };
const shoe = groupShoeRows(generateMockShoe({
    tableId: '1', gametype: 'BA', shoeId: 'S1', handCount: N,
    seated: [{ playerId: 'A', seat: 2, avgBet: 1000 }, { playerId: 'B', seat: 5, avgBet: 1000 }],
    edgePaths: paths, counter: { seat: 5, code: 'SL7' },
}));

describe('seatSummary', () => {
    const seats = buildSeats(shoe, [{ seat: 2, playerId: 'A', cardType: 'GOLD', cumWin: -5000 }], 'BA|1');

    test('seven seats, empty ones flagged', () => {
        expect(seats).toHaveLength(7);
        expect(seats[0]).toEqual({ seat: 1, empty: true });
        expect(seats[1]).toMatchObject({ playerId: 'A', cardType: 'GOLD', dayWin: 5000 });
    });

    test('seat known only from the shoe still shows', () => {
        expect(seats[4].playerId).toBe('B');
        expect(seats[4].cardType).toBeNull();
    });

    test('bets are patron perspective with negative-edge marks', () => {
        const b = seats[4];
        expect(b.shoeWin).toBeCloseTo(b.bets.reduce((a, x) => a + x.patronWin, 0));
        expect(b.negBets).toBe(b.bets.filter((x) => x.code === 'SL7' && x.handNo > 20).length);
        expect(b.negBets).toBeGreaterThan(20);
    });

    test('counter seat gets ACTION and is the default', () => {
        expect(seats[4].verdict).toBe('ACTION');
        expect(defaultSeat(seats)).toBe(5);
    });

    test('edge paths per option', () => {
        expect(hasEdges(shoe)).toBe(true);
        const p = edgePaths(shoe);
        expect(p.SL7[0]).toBe(8);
        expect(p.SL7[N - 1]).toBe(-4);
        expect(p.L6[0]).toBeNull();
    });

    test('no shoe → all empty', () => {
        expect(buildSeats(null, []).every((s) => s.empty)).toBe(true);
        expect(defaultSeat(buildSeats(null, []))).toBeNull();
    });
});
