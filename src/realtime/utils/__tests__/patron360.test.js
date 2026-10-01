import {
    currentGamingDate, rangeFor, normalizeBets, normalizeShoeEdges, buildShoeViews, inWindow,
    optionShoeStats, optionEvidence, evidenceFor, verdictFrom, defaultOption, heatmapRows, buildPatron360,
    worstState, headlineFor, edgeProfile,
} from '../patron360';
import { PATRON_360 } from '../../constants/rtConfig';

const NOW = new Date(2026, 8, 25, 15, 0).getTime();
const DATE = '2026-09-25';
const THEO = Object.fromEntries(PATRON_360.BET_OPTIONS.map((o) => [`house_edge_${o.edgeKey}`, o.theo]));
const at = (hand) => new Date(Date.UTC(2026, 8, 25, 2, 0) + hand * 60000).toISOString();

const edgeRow = (shoe, hand, o = {}) => ({
    gaming_date: DATE, table_id: '10001', gametype: 'BA', shoe_id: shoe, hand_no: hand, game_time: at(hand),
    result: 'B', banker_pair: 0, player_pair: 0, ...THEO, ...o,
});
const betRow = (shoe, hand, type, wager, o = {}) => ({
    gaming_date: DATE, game_time: at(hand), table_id: '10001', gametype: 'BA', shoe_id: shoe,
    game_id: `${shoe}-H${hand}`, hand_no: hand, seat: 3, dealer: 'D1', result: 'B',
    bet_type: type, wager, casino_win: wager, theo_win: wager * 0.1, edge_at_bet: 1, ...o,
});
// `n` hands; SL7 edge is −5 on hands negFrom..negTo, theo elsewhere.
const shoe = (id, n, negFrom = 0, negTo = -1) => Array.from({ length: n }, (_, i) => i + 1)
    .map((h) => edgeRow(id, h, h >= negFrom && h <= negTo ? { house_edge_sl7: -5 } : {}));
const views = (edges, bets) => buildShoeViews(normalizeShoeEdges(edges), normalizeBets(bets));

// 40 hands, SL7 negative on 11–20; seated 1–40 (Banker bets on 1 and 40);
// SL7 $500 on 8 of the 10 negative hands and $100 on 5 of the 30 others.
const counterBets = () => [
    betRow('S1', 1, 'BANKER', 1000), betRow('S1', 40, 'BANKER', 1000),
    ...[11, 12, 13, 14, 15, 16, 17, 18].map((h) => betRow('S1', h, 'SL7', 500)),
    ...[22, 25, 28, 31, 34].map((h) => betRow('S1', h, 'SL7', 100)),
];

describe('dates and ranges', () => {
    it('rolls the gaming day over at 07:00', () => {
        expect(currentGamingDate(new Date(2026, 8, 25, 6, 59).getTime())).toBe('2026-09-24');
        expect(currentGamingDate(new Date(2026, 8, 25, 7, 0).getTime())).toBe('2026-09-25');
    });
    it('builds the quick ranges', () => {
        expect(rangeFor('today', NOW)).toEqual({ from: DATE, to: DATE });
        expect(rangeFor('7d', NOW)).toEqual({ from: '2026-09-19', to: DATE });
        expect(rangeFor('30d', NOW)).toEqual({ from: '2026-08-27', to: DATE });
        expect(rangeFor('ytd', NOW)).toEqual({ from: '2026-01-01', to: DATE });
    });
});

describe('normalisation and views', () => {
    it('groups edge rows into shoes with per-option edges', () => {
        const shoes = normalizeShoeEdges([edgeRow('S1', 2), edgeRow('S1', 1, { house_edge_btg: null })]);
        const s = shoes.get('BA|10001|S1');
        expect(s.hands.map((h) => h.handNo)).toEqual([1, 2]);
        expect(s.hands[0].edge.BTG).toBeNull();
        expect(s.hands[0].edge.SL7).toBe(14.8);
        expect(s.start).toBe(at(1));
    });
    it('joins bets per hand and sets the seat window', () => {
        const [v] = views(shoe('S1', 40), [betRow('S1', 5, 'SL7', 100), betRow('S1', 5, 'SL7', 200), betRow('S1', 30, 'BANKER', 500)]);
        expect(v.firstHand).toBe(5);
        expect(v.lastHand).toBe(30);
        expect(v.maxHand).toBe(40);
        expect(v.betsByHand.get(5).get('SL7')).toEqual({ wager: 300, casinoWin: 300, theoWin: 30 });
        expect(inWindow(v, 4)).toBe(false);
        expect(inWindow(v, 30)).toBe(true);
    });
    it('keeps shoes that have bets but no edge rows', () => {
        const vs = views([], [betRow('S9', 3, 'TIE', 100)]);
        expect(vs).toHaveLength(1);
        expect(vs[0].missingEdges).toBe(true);
        expect(vs[0].hands).toEqual([]);
    });
});

describe('per-shoe stats', () => {
    it('counts only hands inside the seat window', () => {
        const [v] = views(shoe('S1', 40, 11, 20), counterBets());
        const s = optionShoeStats(v, 'SL7');
        expect(s).toMatchObject({ bets: 13, turnover: 4500, negMoney: 4000, negHands: 10, negHandsBet: 8, windowHands: 40 });
        const [v2] = views(shoe('S1', 40, 11, 20), [betRow('S1', 21, 'SL7', 100), betRow('S1', 40, 'BANKER', 100)]);
        expect(optionShoeStats(v2, 'SL7').negHands).toBe(0);
    });
});

describe('option evidence', () => {
    it('flags a side-bet counter on entry, ramp and money', () => {
        const e = optionEvidence(views(shoe('S1', 40, 11, 20), counterBets()), 'SL7');
        expect(e.rateNeg).toBeCloseTo(0.8, 9);
        expect(e.ratePos).toBeCloseTo(5 / 30, 9);
        expect(e.tests.entry.value).toBeCloseTo(4.8, 9);
        expect(e.tests.entry.state).toBe('flag');
        expect(e.tests.ramp.value).toBeCloseTo(5, 9);
        expect(e.tests.ramp.state).toBe('flag');
        expect(e.tests.money.value).toBeCloseTo((4000 / 4500) / 0.25, 9);
        expect(e.tests.money.state).toBe('flag');
        expect(e.tests.luck.state).toBe('insufficient');
    });
    it('needs 10 negative-edge hands before judging entry', () => {
        const e = optionEvidence(views(shoe('S1', 40, 11, 15), counterBets()), 'SL7');
        expect(e.tests.entry.state).toBe('insufficient');
    });
    it('reads only-negative-edge betting as infinite entry', () => {
        const bets = [betRow('S1', 1, 'BANKER', 100), betRow('S1', 40, 'BANKER', 100),
            ...[11, 12, 13, 14, 15, 16].map((h) => betRow('S1', h, 'SL7', 300))];
        const e = optionEvidence(views(shoe('S1', 40, 11, 20), bets), 'SL7');
        expect(e.tests.entry.value).toBe(Infinity);
        expect(e.tests.entry.state).toBe('flag');
    });
    it('measures result against theo in standard deviations', () => {
        const bets = Array.from({ length: 30 }, (_, i) => betRow('S1', i + 1, 'BANKER', 1000, { casino_win: -950, theo_win: 10.6 }));
        const e = optionEvidence(views(shoe('S1', 30), bets), 'BANKER');
        expect(e.tests.luck.value).toBeCloseTo((30 * 960.6) / Math.sqrt(30 * 1e6 * 0.86), 6);
        expect(e.tests.luck.state).toBe('flag');
    });
    it('orders side bets first by turnover, then main bets', () => {
        const rows = evidenceFor(views(shoe('S1', 40, 11, 20), [...counterBets(), betRow('S1', 5, 'TIE', 100)]));
        expect(rows.map((r) => r.code)).toEqual(['SL7', 'TIE', 'BANKER']);
        expect(defaultOption(rows)).toBe('SL7');
        expect(defaultOption([])).toBe('BANKER');
    });
});

describe('verdictFrom', () => {
    const row = (code, states) => ({
        code,
        tests: Object.fromEntries(['entry', 'ramp', 'money', 'luck'].map((id) => [id, { value: 1, state: states[id] || 'clear' }])),
    });
    it('ACTION on any counting flag', () => {
        const v = verdictFrom([row('SL7', { entry: 'flag' })]);
        expect(v.level).toBe('ACTION');
        expect(v.reason).toBe('1 flag: SL7 selective entry');
    });
    it('ACTION on two luck flags', () => {
        expect(verdictFrom([row('SL7', { luck: 'flag' }), row('TIE', { luck: 'flag' })]).level).toBe('ACTION');
    });
    it('WATCH on one luck flag or two watches', () => {
        expect(verdictFrom([row('SL7', { luck: 'flag' })]).level).toBe('WATCH');
        expect(verdictFrom([row('SL7', { entry: 'watch', ramp: 'watch' })]).level).toBe('WATCH');
    });
    it('CLEAR with at most one watch', () => {
        expect(verdictFrom([row('SL7', { ramp: 'watch' })])).toEqual({ level: 'CLEAR', reason: '1 watch: SL7 bet ramp' });
    });
    it('NO DATA when nothing could be tested', () => {
        const none = { code: 'SL7', tests: { entry: { state: 'insufficient' }, luck: { state: 'insufficient' } } };
        expect(verdictFrom([none]).level).toBe('NO DATA');
        expect(verdictFrom([]).level).toBe('NO DATA');
    });
});

describe('heatmap rows and build', () => {
    const edges = [...shoe('S1', 40, 11, 20), ...shoe('S2', 40)];
    const bets = [...counterBets(), betRow('S2', 3, 'BANKER', 100), betRow('S2', 9, 'SL7', 900)];
    it('keeps shoes with bets on the option and puts the most money on −edge first', () => {
        const vs = views(edges, bets);
        expect(heatmapRows(vs, 'SL7').map((r) => r.view.shoeId)).toEqual(['S1', 'S2']);
        expect(heatmapRows(vs, 'TIE')).toHaveLength(0);
        expect(heatmapRows(vs, 'TIE', { onlyBet: false })).toHaveLength(2);
    });
    it('assembles the model', () => {
        const m = buildPatron360(bets, edges);
        expect(m.views).toHaveLength(2);
        expect(m.defaultOption).toBe('SL7');
        expect(m.verdict.level).toBe('ACTION');
    });
});

describe('summary helpers', () => {
    const vs = () => views(shoe('S1', 40, 11, 20), counterBets());

    it('reports the worst test state of a row', () => {
        const rows = evidenceFor(vs());
        expect(worstState(rows.find((r) => r.code === 'SL7'))).toBe('flag');
        expect(worstState(rows.find((r) => r.code === 'BANKER'))).toBe('insufficient');
    });

    it('picks the option with the most flags, not the most money', () => {
        const bets = [...counterBets(), ...Array.from({ length: 20 }, (_, i) => betRow('S1', i + 2, 'TIE', 5000))];
        const rows = evidenceFor(views(shoe('S1', 40, 11, 20), bets));
        expect(rows[0].code).toBe('TIE');
        expect(defaultOption(rows)).toBe('SL7');
    });

    it('writes a short headline from the strongest test', () => {
        const row = (states) => ({
            code: 'BD',
            tests: Object.fromEntries(['entry', 'ramp', 'money', 'luck'].map((id) => [id, { state: states[id] || 'clear' }])),
        });
        expect(headlineFor({ level: 'ACTION' }, row({ ramp: 'flag', entry: 'watch' }))).toBe('BD bets grow on the negative edge');
        expect(headlineFor({ level: 'ACTION' }, row({ entry: 'flag', ramp: 'flag' }))).toBe('BD bets follow the negative edge');
        expect(headlineFor({ level: 'ACTION' }, row({ money: 'flag' }))).toBe('BD money piles onto the negative edge');
        expect(headlineFor({ level: 'WATCH' }, row({ luck: 'watch' }))).toBe('BD winning beyond chance');
        expect(headlineFor({ level: 'CLEAR' }, row({}))).toBe('No edge-timed betting');
        expect(headlineFor({ level: 'NO DATA' }, null)).toBe('Too few bets to judge');
    });

    it('profiles the bet rate per edge band over seated hands', () => {
        const p = edgeProfile(vs(), 'SL7', [{ lt: 0 }, { gte: 0 }]);
        expect(p.bands[0]).toMatchObject({ hands: 10, bets: 8, rate: 0.8, avgBet: 500 });
        expect(p.bands[1]).toMatchObject({ hands: 30, bets: 5, avgBet: 100 });
        expect(p.bands[1].rate).toBeCloseTo(5 / 30, 9);
        expect(p.rate).toBeCloseTo(13 / 40, 9);
        expect(edgeProfile([], 'SL7', [{ lt: 0 }]).rate).toBeNull();
    });
});
