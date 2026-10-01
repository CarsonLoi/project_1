import {
    periodFrom, fetchRange, viewsInPeriod, optionKpis, summaryRows, worstOption, periodVerdict,
    shoeRowsFor, sortBy, sortSummary, gapOf,
} from '../p360Periods';

// One shoe: 10 hands, seated 3–8; SL7 edge negative on 6–10.
function view({ date = '2026-09-20', key = 'BA|1|S1', bets = [] } = {}) {
    const hands = Array.from({ length: 10 }, (_, i) => ({
        handNo: i + 1, result: 'B', bankerPair: false, playerPair: false,
        edge: { SL7: i + 1 >= 6 ? -2 : 10, BANKER: 1.06 },
    }));
    const betsByHand = new Map();
    for (const b of bets) {
        const m = betsByHand.get(b.handNo) || new Map();
        m.set(b.betType, { wager: b.wager, casinoWin: b.casinoWin, theoWin: 0 });
        betsByHand.set(b.handNo, m);
    }
    const nos = bets.map((b) => b.handNo);
    return {
        shoeKey: key, tableKey: 'BA|1', shoeId: 'S1', date, hands, bets, betsByHand,
        firstHand: nos.length ? Math.min(...nos) : null, lastHand: nos.length ? Math.max(...nos) : null, maxHand: 10,
    };
}
const bet = (handNo, betType, wager, casinoWin) => ({ handNo, betType, wager, casinoWin, theoWin: 0 });

describe('p360Periods', () => {
    test('period bounds', () => {
        expect(periodFrom('today', '2026-09-26')).toBe('2026-09-26');
        expect(periodFrom('3m', '2026-09-26')).toBe('2026-06-26');
        expect(periodFrom('12m', '2026-09-26')).toBe('2025-09-27');
        expect(fetchRange('2026-09-26')).toEqual({ from: '2025-09-27', to: '2026-09-26' });
    });

    test('views filter by date', () => {
        const vs = [view({ date: '2026-09-26' }), view({ date: '2026-08-01' }), view({ date: '2026-01-01' })];
        expect(viewsInPeriod(vs, 'today', '2026-09-26')).toHaveLength(1);
        expect(viewsInPeriod(vs, '3m', '2026-09-26')).toHaveLength(2);
        expect(viewsInPeriod(vs, '12m', '2026-09-26')).toHaveLength(3);
    });

    test('option KPIs: edge played, both theos, involvement, shoes', () => {
        const v = view({ bets: [bet(3, 'SL7', 100, 100), bet(6, 'SL7', 300, -3000), bet(8, 'BANKER', 1000, -950)] });
        const k = optionKpis([v], 'SL7');
        expect(k.bets).toBe(2);
        expect(k.turnover).toBe(400);
        expect(k.avgBet).toBe(200);
        expect(k.patronWin).toBe(2900);
        expect(k.edgePlayed).toBeCloseTo((100 * 10 + 300 * -2) / 400);
        expect(k.theoGeneric).toBeCloseTo((400 * 14.8) / 100);
        expect(k.theoActual).toBeCloseTo((100 * 10 + 300 * -2) / 100);
        expect(k.seatedHands).toBe(6);                 // hands 3..8
        expect(k.involvement).toBeCloseTo(2 / 6);
        expect(k).toMatchObject({ shoes: 1, negShoes: 1, negShoesBet: 1, negBets: 1, theoEdge: 14.8 });
        expect(k.ev.code).toBe('SL7');
    });

    test('summary rows, default gap order and worst option', () => {
        const v = view({ bets: [bet(3, 'SL7', 100, 100), bet(6, 'SL7', 300, -3000), bet(8, 'BANKER', 1000, -950)] });
        const rows = summaryRows([v]);
        expect(rows.map((r) => r.code).sort()).toEqual(['BANKER', 'SL7']);
        expect(worstOption(rows).code).toBe('SL7');
        expect(sortSummary(rows, { key: 'gap', dir: 1 })[0].code).toBe('SL7');
        expect(sortSummary(rows, { key: 'turnover', dir: -1 })[0].code).toBe('BANKER');
        expect(gapOf({ edgePlayed: null, theoEdge: 1 })).toBeNull();
        expect(['ACTION', 'WATCH', 'CLEAR', 'NO DATA']).toContain(periodVerdict(rows).level);
        expect(worstOption([])).toBeNull();
    });

    test('shoe rows: −edge hands, bets on them, money, Patron Win', () => {
        const a = view({ key: 'A', bets: [bet(4, 'SL7', 100, 100), bet(6, 'SL7', 300, -3000), bet(7, 'SL7', 200, 200)] });
        const b = view({ key: 'B', bets: [bet(2, 'BANKER', 100, 100), bet(4, 'BANKER', 100, 100)] });
        const rows = shoeRowsFor([a, b], 'SL7', { onlyNeg: true });
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ negHands: 2, negBets: 2, negMoney: 500, bets: 3, wager: 600, patronWin: 2700 });
        expect(shoeRowsFor([a, b], 'SL7', { onlyNeg: false }).map((r) => r.view.shoeKey)).toEqual(['A']);
    });

    test('sortBy keeps nulls last both ways', () => {
        const xs = [{ v: 2 }, { v: null }, { v: 5 }];
        expect(sortBy(xs, (x) => x.v, 1).map((x) => x.v)).toEqual([2, 5, null]);
        expect(sortBy(xs, (x) => x.v, -1).map((x) => x.v)).toEqual([5, 2, null]);
        expect(sortBy([{ v: 'b' }, { v: 'a' }], (x) => x.v, 1).map((x) => x.v)).toEqual(['a', 'b']);
    });
});
