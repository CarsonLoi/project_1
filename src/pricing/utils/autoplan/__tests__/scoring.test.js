import { mergeAutoplan, DEFAULT_CRITERIA, DEFAULT_WEIGHTS, emptyAutoplan } from '../config';
import { blendValues } from '../inputs';
import { solveBlock, recentChanges } from '../solver';
import { solveDate } from '../period';

const tiers = ['m500', 'm1000'];
const tierIndex = new Map(tiers.map((id, i) => [id, i]));

test('minimum hold: the table that changed recently is not the one to change again', () => {
    const tables = [{ key: 'A', sub: 'S', zone: 'z', value: 1 }, { key: 'B', sub: 'S', zone: 'z', value: 1 }];
    const prev = new Map([['A', 'm500'], ['B', 'm500']]);
    const run = (recentChanged) => solveBlock({
        tables, targets: { S: { m500: 1, m1000: 1 } }, ladders: { S: tiers }, tierIndex, prev,
        weights: { ...DEFAULT_WEIGHTS, rank: 0, hist: 0 }, recentChanged,
    }).assign;
    expect(run(new Set(['A'])).get('A')).toBe('m500');
    expect(run(new Set(['B'])).get('B')).toBe('m500');
});

test('recent changes look back N transitions', () => {
    const a = new Map([['A', 'm500'], ['B', 'm500']]);
    const b = new Map([['A', 'm1000'], ['B', 'm500']]);
    const c = new Map([['A', 'm1000'], ['B', 'm1000']]);
    expect([...recentChanges([a, b, c], 1)]).toEqual(['B']);
    expect([...recentChanges([a, b, c], 2)].sort()).toEqual(['A', 'B']);
    expect(recentChanges([c], 2).size).toBe(0);
});

test('hold carries along the solve order from 21:00', () => {
    const cfg = { ...emptyAutoplan(), weights: { ...DEFAULT_WEIGHTS, rank: 0, hist: 0 } };
    const tables = [{ key: 'A', sub: 'S', zone: 'z' }, { key: 'B', sub: 'S', zone: 'z' }];
    const open = new Map([7, 11, 13, 15, 21, 3, 5].map((h) => [h, new Set(['A', 'B'])]));
    // One $1,000 table all day, except 11:00 has none. Order: 21 → 15 → 13 → 11 → 07.
    const mk = (n) => ({ S: { m500: 2 - n, m1000: n } });
    const byCore = { 7: mk(1), 11: mk(0), 13: mk(1), 15: mk(1), 21: mk(1), 3: mk(1), 5: mk(1) };
    const ctx = {
        cfg: { ...cfg, targets: { wd: byCore } }, tables, tiersAsc: tiers.map((id) => ({ id })), tierIndex, tierLabel: (x) => x,
        ladders: { S: tiers }, sharesByDt: {}, valuesByDt: {}, seededByDt: {}, openByDate: { '2026-10-01': open },
        currentByDate: {}, pinsByDate: {}, keepPins: false, stayClose: false,
    };
    const r = solveDate(ctx, '2026-10-01', { ref: new Map([['A', 'm1000'], ['B', 'm500']]) });
    // 21:00 follows the reference; 11:00 forces A down; at 07:00 one table goes
    // back up: B (unchanged) rather than A (changed at 11:00).
    expect(r.byCore[21].get('A')).toBe('m1000');
    expect(r.byCore[11].get('A')).toBe('m500');
    expect(r.byCore[7].get('B')).toBe('m1000');
    expect(r.byCore[7].get('A')).toBe('m500');
});

test('blended rank: percentile per sub-segment, weighted', () => {
    const daily = [
        { date: '2026-09-03', gametype: 'BA', table: '1', theo: 900, patronhrs: 9, openhours: 10 },   // theo/ph 100, occ 0.9
        { date: '2026-09-03', gametype: 'BA', table: '2', theo: 500, patronhrs: 2, openhours: 10 },   // theo/ph 250, occ 0.2
        { date: '2026-09-03', gametype: 'BA', table: '3', theo: 300, patronhrs: 5, openhours: 10 },   // theo/ph 60,  occ 0.5
    ];
    const subOf = new Map([['BA|1', 'S'], ['BA|2', 'S'], ['BA|3', 'S']]);
    const w = { from: '2026-09-01', to: '2026-09-30', dayType: 'wd', cfg: emptyAutoplan(), subOf };
    const theo = blendValues(daily, { ...w, mix: [{ metric: 'theo', per: 'patronhrs', w: 100 }] });
    expect(theo.get('BA|2')).toBeGreaterThan(theo.get('BA|1'));
    expect(theo.get('BA|1')).toBeGreaterThan(theo.get('BA|3'));
    const occ = blendValues(daily, { ...w, mix: [{ metric: 'patronhrs', per: 'openhours', w: 100 }] });
    expect(occ.get('BA|1')).toBeGreaterThan(occ.get('BA|3'));
    const mix = blendValues(daily, { ...w, mix: [{ metric: 'theo', per: 'patronhrs', w: 50 }, { metric: 'patronhrs', per: 'openhours', w: 50 }] });
    // BA|1: pct 0.5 + 1 → 0.75; BA|2: 1 + 0 → 0.5; BA|3: 0 + 0.5 → 0.25
    expect(mix.get('BA|1')).toBeCloseTo(0.75);
    expect(mix.get('BA|2')).toBeCloseTo(0.5);
    expect(mix.get('BA|3')).toBeCloseTo(0.25);
});

test('rank mix merge: default, migration from the single metric, clamping', () => {
    expect(DEFAULT_CRITERIA.rankMix).toHaveLength(3);
    expect(mergeAutoplan({ criteria: { rankMetric: 'win', rankPer: 'openhours' } }).criteria.rankMix).toEqual([{ metric: 'win', per: 'openhours', w: 100 }]);
    const m = mergeAutoplan({ criteria: { rankMix: [{ metric: 'drop', per: 'total', w: 300 }, { metric: 'bad', per: 'x', w: 5 }, null], holdHours: 99 } });
    expect(m.criteria.rankMix).toEqual([{ metric: 'drop', per: 'total', w: 100 }]);
    expect(m.criteria.holdHours).toBe(6);
    expect(mergeAutoplan({ criteria: { rankMix: [] } }).criteria.rankMix).toEqual(DEFAULT_CRITERIA.rankMix);
    expect(DEFAULT_WEIGHTS.hold).toBeGreaterThan(0);
});
