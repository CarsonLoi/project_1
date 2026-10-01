import { aggregateRows, blendFromAgg, signalBreakdown, sourceWindow, fitToFloors, historyShares } from '../inputs';
import { emptyAutoplan } from '../config';

const cfg = emptyAutoplan();
const rows = [
    { date: '2026-09-05', hour: 21, gametype: 'BA', table: '1', theo: 900, openhours: 1, active_minutes: 30, open_minutes: 60, patronhrs: 3 },
    { date: '2026-09-05', hour: 21, gametype: 'BA', table: '2', theo: 300, openhours: 1, active_minutes: 60, open_minutes: 60, patronhrs: 1 },
    { date: '2026-09-05', hour: 8, gametype: 'BA', table: '1', theo: 10, openhours: 1, active_minutes: 5, open_minutes: 60, patronhrs: 1 },
    { date: '2026-09-05', hour: 8, gametype: 'BA', table: '2', theo: 200, openhours: 1, active_minutes: 50, open_minutes: 60, patronhrs: 1 },
];
const subOf = new Map([['BA|1', 'S'], ['BA|2', 'S']]);
const THEO = { metric: 'theo', per: 'openhours', w: 1 };
const ACTIVE = { metric: 'active_minutes', per: 'open_minutes', w: 1 };

test('per block ranks differ by hour', () => {
    const agg = aggregateRows(rows, { from: '2026-09-01', to: '2026-09-30', cfg, byCore: true });
    expect(blendFromAgg(agg, { dt: 'sat', core: 21, mix: [THEO], subOf }).get('BA|1')).toBe(1);
    expect(blendFromAgg(agg, { dt: 'sat', core: 7, mix: [THEO], subOf }).get('BA|2')).toBe(1);
    const b = signalBreakdown(agg, { dt: 'sat', core: 21, mix: [THEO, ACTIVE], subOf, sub: 'S' });
    expect(b.map((r) => r.key)).toEqual(['BA|1', 'BA|2']);   // 0.5 each → by key
    expect(b[0].parts[1]).toMatchObject({ value: 0.5, pct: 0 });
    expect(b[0].score).toBeCloseTo(0.5);
});

test('whole day basis, other day types, and windows', () => {
    const agg = aggregateRows(rows, { from: '2026-09-01', to: '2026-09-30', cfg, byCore: false });
    expect(blendFromAgg(agg, { dt: 'sat', core: 'day', mix: [THEO], subOf }).get('BA|1')).toBe(1);
    // No weekday rows: same day type only → tie; every day → Saturday data counts.
    expect(blendFromAgg(agg, { dt: 'wd', core: 'day', mix: [THEO], subOf }).get('BA|1')).toBe(0.5);
    expect(blendFromAgg(agg, { dt: 'wd', core: 'day', mix: [THEO], subOf, sameDayType: false }).get('BA|1')).toBe(1);
    expect(sourceWindow({ mode: 'last' }, { defaultDays: 7, before: '2026-10-01' })).toEqual({ from: '2026-09-24', to: '2026-09-30' });
    expect(sourceWindow({ mode: 'range', from: '2026-01-01', to: '2026-01-31' }, { defaultDays: 7, before: '2026-10-01' })).toEqual({ from: '2026-01-01', to: '2026-01-31' });
    expect(sourceWindow({ mode: 'range', from: '', to: '' }, { defaultDays: 7, before: '2026-10-01' })).toEqual({ from: '2026-09-24', to: '2026-09-30' });
});

test('floors raise a tier, taking from the tier with most room', () => {
    expect(fitToFloors({ a: 5, b: 1, c: 0 }, new Map([['c', 2]]), ['a', 'b', 'c'])).toEqual({ map: { a: 3, b: 1, c: 2 }, moved: 2 });
    expect(fitToFloors({ a: 1, c: 0 }, new Map([['c', 2], ['a', 1]]), ['a', 'c']).map).toEqual({ a: 1, c: 0 });
});

test('half-life weights recent rows more', () => {
    const tiers = [{ id: 'm5', min: 500 }, { id: 'm1', min: 1000 }];
    const h = [
        { date: '2026-09-26', hour: 21, gametype: 'BA', table: '1', tablemin: '1000:1' },
        { date: '2026-06-06', hour: 21, gametype: 'BA', table: '1', tablemin: '500:1' },
    ];
    const flat = historyShares(h, { from: '2026-01-01', to: '2026-09-30', dayType: 'sat', cfg, tiersAsc: tiers });
    expect(flat.get('BA|1|21').m1).toBeCloseTo(0.5);
    const s = historyShares(h, { from: '2026-01-01', to: '2026-09-30', dayType: 'sat', cfg, tiersAsc: tiers, halfLife: 2 });
    expect(s.get('BA|1|21').m1).toBeGreaterThan(0.9);
});

test('active rate falls back to active hours ÷ open hours without minute data', () => {
    const r = [
        { date: '2026-09-05', hour: 21, gametype: 'BA', table: '1', theo: 1, openhours: 4, activehours: 1, open_minutes: 0, active_minutes: 0 },
        { date: '2026-09-05', hour: 21, gametype: 'BA', table: '2', theo: 1, openhours: 4, activehours: 3, open_minutes: 0, active_minutes: 0 },
    ];
    const agg = aggregateRows(r, { from: '2026-09-01', to: '2026-09-30', cfg, byCore: true });
    const b = signalBreakdown(agg, { dt: 'sat', core: 21, mix: [ACTIVE], subOf, sub: 'S' });
    expect(b.map((x) => x.key)).toEqual(['BA|2', 'BA|1']);
    expect(b[0].parts[0].value).toBeCloseTo(0.75);
});
