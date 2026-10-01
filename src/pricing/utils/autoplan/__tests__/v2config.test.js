import {
    DEFAULT_WEIGHTS, DEFAULT_CRITERIA, SIGNALS, signalOf, mergeAutoplan, normalizeRule, targetsForDate, withTargets, dateKey,
    withManual, manualFor, emptyAutoplan, WEIGHT_PRESETS, presetOf,
} from '../config';

test('v2 defaults', () => {
    expect(DEFAULT_WEIGHTS).toMatchObject({ change: 10000, step: 1000, align: 10000, raise: 0 });
    expect(presetOf(DEFAULT_WEIGHTS)).toBe('fewest');
    expect(WEIGHT_PRESETS.every((p) => Object.keys(DEFAULT_WEIGHTS).every((k) => k in p.weights))).toBe(true);
    expect(DEFAULT_CRITERIA).toMatchObject({ anchorCore: 21, refDayType: 'sat', rankBasis: 'block' });
    expect(DEFAULT_CRITERIA.rankMix.map((m) => signalOf(m).id)).toEqual(['theo_oh', 'active', 'theo_ph']);
    expect(SIGNALS.find((s) => s.id === 'active')).toMatchObject({ metric: 'active_minutes', per: 'open_minutes' });
    expect(signalOf({ metric: 'drop', per: 'total' })).toBeNull();
});

test('criteria merge clamps and keeps sources', () => {
    const c = mergeAutoplan({
        criteria: {
            anchorCore: 99, refDayType: 'x', rankBasis: 'day',
            histSource: { mode: 'range', from: '2026-01-01', to: '2026-03-31' }, rankSource: { mode: 'nope', from: 'x' },
            histHalfLife: 999, changeMult: { 21: 3, 7: -1, x: 2 }, podChangeCap: { on: true, n: 0 },
        },
    }).criteria;
    expect(c.anchorCore).toBe(21);
    expect(c.refDayType).toBe('sat');
    expect(c.rankBasis).toBe('day');
    expect(c.histSource).toEqual({ mode: 'range', from: '2026-01-01', to: '2026-03-31' });
    expect(c.rankSource).toEqual({ mode: 'last', from: '', to: '' });
    expect(c.histHalfLife).toBe(52);
    expect(c.changeMult).toEqual({ 21: 3 });
    expect(c.podChangeCap).toEqual({ on: true, n: 1 });
});

test('zone rule migration', () => {
    expect(normalizeRule({ id: 1, on: true, type: 'zonecap', scope: 'all', tier: 'a', n: 2, hours: [21] }))
        .toMatchObject({ n: 2, maxOn: true, min: 0, minOn: false });
    expect(mergeAutoplan({ rules: [{ id: 1, on: true, type: 'zonecap', scope: 'all', tier: 'a', n: 2, hours: [21] }] }).rules[0].maxOn).toBe(true);
    expect(normalizeRule({ id: 2, on: true, type: 'lock', scope: 'all', tier: 'a', hours: [21] })).toEqual({ id: 2, on: true, type: 'lock', scope: 'all', tier: 'a', hours: [21] });
});

test('date targets override day type', () => {
    let cfg = withTargets(emptyAutoplan(), 'wd', 21, 'MSC', { a: 3 });
    expect(targetsForDate(cfg, '2026-10-05', 'wd', 21, 'MSC')).toEqual({ a: 3 });
    cfg = withTargets(cfg, dateKey('2026-10-05'), 21, 'MSC', { a: 5 });
    expect(targetsForDate(cfg, '2026-10-05', 'wd', 21, 'MSC')).toEqual({ a: 5 });
    expect(targetsForDate(cfg, '2026-10-06', 'wd', 21, 'MSC')).toEqual({ a: 3 });
});

test('manual rules per date + block', () => {
    let cfg = withManual(emptyAutoplan(), '2026-10-05', 21, ['BA|1', 'BA|2'], 'm1000');
    expect([...manualFor(cfg, '2026-10-05', 21)]).toEqual([['BA|1', 'm1000'], ['BA|2', 'm1000']]);
    cfg = withManual(cfg, '2026-10-05', 21, ['BA|1'], null);
    expect([...manualFor(cfg, '2026-10-05', 21)]).toEqual([['BA|2', 'm1000']]);
    cfg = withManual(cfg, '2026-10-05', 21, ['BA|2'], null);
    expect(cfg.manual).toEqual({});
    expect(mergeAutoplan({ manual: { '2026-10-05': { 21: { 'BA|2': 'm1000' } }, bad: 3 } }).manual).toEqual({ '2026-10-05': { 21: { 'BA|2': 'm1000' } } });
});
