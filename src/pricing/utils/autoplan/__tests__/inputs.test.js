import { snapTier, openByBlock, historyShares, tableValues, laddersFrom, allocate, fitToCaps, seedTargets } from '../inputs';
import { emptyAutoplan } from '../config';

const tiers = [100, 300, 500, 1000].map((m) => ({ id: `m${m}`, min: m }));
const tables = [
    { key: 'BA|1', sub: 'Main' }, { key: 'BA|2', sub: 'Main' }, { key: 'BA|3', sub: 'Main' }, { key: 'BA|4', sub: 'VIP' },
];

test('snap and allocate', () => {
    expect(snapTier(480, tiers)).toBe('m500');
    expect(allocate({ m300: 1, m500: 1 }, 3, ['m300', 'm500'])).toEqual({ m300: 2, m500: 1 });
    expect(allocate({}, 4, ['m100', 'm300'])).toEqual({ m100: 2, m300: 2 });
});

test('open by block: union of block hours, or everything without a schedule', () => {
    const oh = new Map([[7, new Set(['BA|1'])], [9, new Set(['BA|2'])], [11, new Set(['BA|3', 'X|9'])]]);
    const r = openByBlock(oh, tables);
    expect([...r.byCore.get(7)].sort()).toEqual(['BA|1', 'BA|2']);
    expect([...r.byCore.get(11)]).toEqual(['BA|3']);
    expect(openByBlock(null, tables).assumedAllOpen).toBe(true);
    expect(openByBlock(null, tables).byCore.get(21).size).toBe(4);
});

const cfg = emptyAutoplan();
const hourly = [
    { date: '2026-09-03', hour: 8, gametype: 'BA', table: '1', tablemin: '500:3,1000:1' },   // Thu → wd, core 7
    { date: '2026-09-03', hour: 12, gametype: 'BA', table: '1', tablemin: '300:1' },         // core 11
    { date: '2026-09-04', hour: 8, gametype: 'BA', table: '1', tablemin: '100:9' },          // Fri → not wd
    { date: '2026-09-03', hour: 8, gametype: 'BA', table: '4', tablemin: '1000:1' },
];

test('history shares per table and core hour, one day type', () => {
    const s = historyShares(hourly, { from: '2026-09-01', to: '2026-09-30', dayType: 'wd', cfg, tiersAsc: tiers });
    expect(s.get('BA|1|7')).toEqual({ m500: 0.75, m1000: 0.25 });
    expect(s.get('BA|1|11')).toEqual({ m300: 1 });
    expect(s.has('BA|2|7')).toBe(false);
});

test('values and ladders', () => {
    const v = tableValues([{ date: '2026-09-03', gametype: 'BA', table: '1', theo: 100, patronhrs: 4 }], { from: '2026-09-01', to: '2026-09-30', dayType: 'wd', cfg });
    expect(v.get('BA|1')).toBe(25);
    const s = historyShares(hourly, { from: '2026-09-01', to: '2026-09-30', dayType: 'wd', cfg, tiersAsc: tiers });
    const l = laddersFrom(s, tables, tiers);
    expect(l.Main).toEqual(['m300', 'm500', 'm1000']);
    expect(l.VIP).toEqual(['m1000']);
});

test('fit to caps moves overflow down', () => {
    const r = fitToCaps({ m300: 1, m500: 2, m1000: 4 }, new Map([['m1000', 1]]), ['m300', 'm500', 'm1000']);
    expect(r.map).toEqual({ m300: 1, m500: 5, m1000: 1 });
    expect(r.moved).toBe(3);
});

test('seed targets sized to open tables', () => {
    const s = historyShares(hourly, { from: '2026-09-01', to: '2026-09-30', dayType: 'wd', cfg, tiersAsc: tiers });
    const open = new Map([[7, new Set(['BA|1', 'BA|2', 'BA|3'])], [11, new Set(['BA|1'])], [13, new Set()], [15, new Set()], [21, new Set()], [3, new Set()], [5, new Set()]]);
    const t = seedTargets({ tables, openByCore: open, shares: s, ladders: { Main: ['m300', 'm500', 'm1000'], VIP: ['m1000'] } });
    expect(Object.values(t[7].Main).reduce((a, b) => a + b, 0)).toBe(3);
    expect(t[7].Main.m500).toBeGreaterThan(t[7].Main.m1000);
    expect(t[11].Main).toEqual({ m300: 1, m500: 0, m1000: 0 });
    expect(Object.values(t[7].VIP).reduce((a, b) => a + b, 0)).toBe(0);
});
