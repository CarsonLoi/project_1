import { generateMockPatronHistory, isMockCounter } from '../patronBetsMock';
import { buildPatron360 } from '../patron360';
import { fetchPatronBets, fetchPatronShoeEdges } from '../rtDataSource';
import { PATRON_360 } from '../../constants/rtConfig';

const NOW = new Date(2026, 8, 25, 15, 0).getTime();
const BET_COLS = ['gaming_date', 'game_time', 'table_id', 'gametype', 'shoe_id', 'game_id', 'hand_no', 'seat',
    'dealer', 'result', 'bet_type', 'wager', 'casino_win', 'theo_win', 'edge_at_bet'];
const EDGE_COLS = ['gaming_date', 'table_id', 'gametype', 'shoe_id', 'hand_no', 'game_time', 'result', 'banker_pair',
    'player_pair', ...PATRON_360.BET_OPTIONS.map((o) => `house_edge_${o.edgeKey}`)];

const ids = Array.from({ length: 60 }, (_, i) => `PID-${10001 + i}`);
const counterId = ids.find(isMockCounter);
const normalId = ids.find((id) => !isMockCounter(id));

describe('generateMockPatronHistory', () => {
    const { bets, shoeEdges } = generateMockPatronHistory('PID-10001', { now: NOW });

    it('matches both contracts and stays inside the last 12 months', () => {
        expect(Object.keys(bets[0]).sort()).toEqual([...BET_COLS].sort());
        expect(Object.keys(shoeEdges[0]).sort()).toEqual([...EDGE_COLS].sort());
        expect(bets.every((r) => r.gaming_date >= '2025-09-26' && r.gaming_date <= '2026-09-25')).toBe(true);
        expect(bets.some((r) => r.gaming_date < '2026-01-01')).toBe(true);
        const today = shoeEdges.filter((r) => r.gaming_date === '2026-09-25');
        expect(today.length).toBeGreaterThan(0);
        expect(today.every((r) => new Date(r.game_time).getTime() <= NOW)).toBe(true);
    });

    it('gives every shoe all its hands and puts every bet inside one', () => {
        const hands = new Map();
        for (const r of shoeEdges) {
            const k = `${r.table_id}|${r.shoe_id}`;
            hands.set(k, (hands.get(k) || new Set()).add(r.hand_no));
        }
        for (const set of hands.values()) {
            expect(set.size).toBeGreaterThanOrEqual(70);
            expect(Math.max(...set)).toBe(set.size);
        }
        for (const b of bets) expect(hands.get(`${b.table_id}|${b.shoe_id}`).has(b.hand_no)).toBe(true);
    });

    it('makes counters look like counters and others not', () => {
        expect(counterId).toBeDefined();
        const c = generateMockPatronHistory(counterId, { now: NOW });
        expect(buildPatron360(c.bets, c.shoeEdges).verdict.level).toBe('ACTION');
        const n = generateMockPatronHistory(normalId, { now: NOW });
        expect(buildPatron360(n.bets, n.shoeEdges).verdict.level).not.toBe('ACTION');
    });
});

describe('patron feeds in mock mode', () => {
    it('filter both feeds by date range', async () => {
        const range = { from: '2026-09-01', to: '2026-09-20' };
        const [b, e] = await Promise.all([fetchPatronBets('PID-10001', range), fetchPatronShoeEdges('PID-10001', range)]);
        expect(b.live).toBe(false);
        expect(b.error).toBeNull();
        expect(b.rows.every((r) => r.gaming_date >= range.from && r.gaming_date <= range.to)).toBe(true);
        expect(e.rows.every((r) => r.gaming_date >= range.from && r.gaming_date <= range.to)).toBe(true);
    });
});
