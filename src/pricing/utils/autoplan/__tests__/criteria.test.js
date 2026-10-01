import { CORE_HOURS, DEFAULT_CORE_HOURS, setCoreHours, normalizeCoreHours, coreFor, blockLabel, firstCore, lastCore, prevCore } from '../core';
import { mergeAutoplan, emptyAutoplan, DEFAULT_CRITERIA, DEFAULT_WEIGHTS, WEIGHT_PRESETS, presetOf, changeDominates } from '../config';
import { openByBlock, historyShares, tableValues, laddersFrom, fitToCaps } from '../inputs';

afterEach(() => setCoreHours(DEFAULT_CORE_HOURS));

const tiers = [100, 300, 500, 1000].map((m) => ({ id: `m${m}`, min: m }));
const tables = [{ key: 'BA|1', sub: 'Main' }, { key: 'BA|2', sub: 'Main' }];
const cfg = emptyAutoplan();

test('core hours are editable; 07 always starts the day', () => {
    expect(normalizeCoreHours([21, 3, 11])).toEqual([7, 11, 21, 3]);
    expect(normalizeCoreHours(['x', 25, 11, 11])).toEqual([7, 11]);
    setCoreHours([7, 11, 17, 21]);
    expect(CORE_HOURS).toEqual([7, 11, 17, 21]);
    expect(coreFor(16)).toBe(11);
    expect(coreFor(18)).toBe(17);
    expect(coreFor(6)).toBe(21);
    expect(blockLabel(21)).toBe('21–06');
    expect(firstCore()).toBe(7);
    expect(lastCore()).toBe(21);
    expect(prevCore(17)).toBe(11);
});

test('criteria merge: defaults, clamping and bad input', () => {
    const m = mergeAutoplan({ criteria: { histWeeks: 99, minShare: -3, rankMetric: 'nope', openRule: 'core' }, coreHours: [11, 21] });
    expect(m.criteria.histWeeks).toBe(52);
    expect(m.criteria.minShare).toBe(0);
    expect(m.criteria.rankMix).toEqual(DEFAULT_CRITERIA.rankMix);
    expect(m.criteria.openRule).toBe('core');
    expect(m.coreHours).toEqual([7, 11, 21]);
    expect(emptyAutoplan().criteria).toEqual(DEFAULT_CRITERIA);
    expect(emptyAutoplan().coreHours).toEqual(DEFAULT_CORE_HOURS);
});

test('weight presets and the change-dominates check', () => {
    expect(presetOf(DEFAULT_WEIGHTS)).toBe('fewest');
    expect(presetOf({ ...DEFAULT_WEIGHTS, rank: 11 })).toBe('custom');
    expect(presetOf(WEIGHT_PRESETS.find((p) => p.id === 'rank').weights)).toBe('rank');
    expect(changeDominates(DEFAULT_WEIGHTS, 12)).toBe(true);
    expect(changeDominates({ ...DEFAULT_WEIGHTS, change: 50 }, 12)).toBe(false);
});

test('open tables: any hour of the block, or only the core hour', () => {
    const oh = new Map([[7, new Set(['BA|1'])], [9, new Set(['BA|2'])]]);
    expect([...openByBlock(oh, tables).byCore.get(7)].sort()).toEqual(['BA|1', 'BA|2']);
    expect([...openByBlock(oh, tables, 'core').byCore.get(7)]).toEqual(['BA|1']);
});

test('history and rank can use every day or only the same day type', () => {
    const hourly = [
        { date: '2026-09-03', hour: 8, gametype: 'BA', table: '1', tablemin: '500:1' },     // Thu (wd)
        { date: '2026-09-04', hour: 8, gametype: 'BA', table: '1', tablemin: '1000:1' },    // Fri
    ];
    const same = historyShares(hourly, { from: '2026-09-01', to: '2026-09-30', dayType: 'wd', cfg, tiersAsc: tiers });
    const all = historyShares(hourly, { from: '2026-09-01', to: '2026-09-30', dayType: 'wd', cfg, tiersAsc: tiers, sameDayType: false });
    expect(same.get('BA|1|7')).toEqual({ m500: 1 });
    expect(all.get('BA|1|7')).toEqual({ m500: 0.5, m1000: 0.5 });

    const daily = [
        { date: '2026-09-03', gametype: 'BA', table: '1', theo: 100, win: 40, drop: 900, turnover: 2000, patronhrs: 4, openhours: 10 },
        { date: '2026-09-04', gametype: 'BA', table: '1', theo: 300, win: 60, drop: 100, turnover: 1000, patronhrs: 1, openhours: 10 },
    ];
    const w = { from: '2026-09-01', to: '2026-09-30', dayType: 'wd', cfg };
    expect(tableValues(daily, w).get('BA|1')).toBe(25);                                          // theo / patron hr, Thu only
    expect(tableValues(daily, { ...w, metric: 'win', per: 'openhours' }).get('BA|1')).toBe(4);
    expect(tableValues(daily, { ...w, metric: 'drop', per: 'total' }).get('BA|1')).toBe(900);
    expect(tableValues(daily, { ...w, sameDayType: false }).get('BA|1')).toBe(80);               // 400 / 5
});

test('allowed prices threshold and overflow direction', () => {
    const shares = new Map([['BA|1|7', { m500: 0.97, m1000: 0.03 }], ['BA|2|7', { m500: 1 }]]);
    expect(laddersFrom(shares, tables, tiers).Main).toEqual(['m500', 'm1000']);
    expect(laddersFrom(shares, tables, tiers, 0.05).Main).toEqual(['m500']);
    expect(laddersFrom(shares, tables, tiers, 0).Main).toEqual(['m100', 'm300', 'm500', 'm1000']);
    const lad = ['m300', 'm500', 'm1000'];
    expect(fitToCaps({ m300: 3, m500: 1, m1000: 0 }, new Map([['m300', 1]]), lad, 'up').map).toEqual({ m300: 1, m500: 3, m1000: 0 });
    expect(fitToCaps({ m300: 1, m500: 3, m1000: 0 }, new Map([['m500', 1]]), lad, 'up').map).toEqual({ m300: 1, m500: 1, m1000: 2 });
    expect(fitToCaps({ m300: 1, m500: 3, m1000: 0 }, new Map([['m500', 1]]), lad).map).toEqual({ m300: 3, m500: 1, m1000: 0 });
});
