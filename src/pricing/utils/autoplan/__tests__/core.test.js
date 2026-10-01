import { coreFor, blockHours, blockLabel, prevCore, dayTypeOf, datesBetween, nextMonthRange, addDays } from '../core';
import { mergeAutoplan, emptyAutoplan, withTargets, targetsFor } from '../config';

test('every hour maps to the core hour before it', () => {
    expect([7, 8, 10, 11, 12, 13, 14, 15, 20, 21, 23, 0, 2, 3, 4, 5, 6].map(coreFor))
        .toEqual([7, 7, 7, 11, 11, 13, 13, 15, 15, 21, 21, 21, 21, 3, 3, 5, 5]);
    expect(blockHours(21)).toEqual([21, 22, 23, 0, 1, 2]);
    expect(blockLabel(7)).toBe('07–10');
    expect(blockLabel(3)).toBe('03–04');
    expect(prevCore(7)).toBeNull();
    expect(prevCore(3)).toBe(21);
});

test('day types from weekday and overrides', () => {
    const cfg = emptyAutoplan();
    expect(dayTypeOf('2026-10-01', cfg)).toBe('wd');     // Thu
    expect(dayTypeOf('2026-10-02', cfg)).toBe('fri');
    expect(dayTypeOf('2026-10-03', cfg)).toBe('sat');
    expect(dayTypeOf('2026-10-04', cfg)).toBe('sun');
    expect(dayTypeOf('2026-10-01', { ...cfg, overrides: { '2026-10-01': 'sat' } })).toBe('sat');
});

test('date helpers', () => {
    expect(datesBetween('2026-09-29', '2026-10-02')).toEqual(['2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02']);
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(nextMonthRange('2026-09-27')).toEqual({ from: '2026-10-01', to: '2026-10-31' });
});

test('config merge and targets', () => {
    const m = mergeAutoplan({ rules: [{ id: 4, type: 'maxstep' }, null], weights: { step: 5 } });
    expect(m.rules).toHaveLength(1);
    expect(m.nextRuleId).toBe(5);
    expect(m.weights).toMatchObject({ change: 10000, step: 5 });
    const c = withTargets(m, 'wd', 7, 'Main', { m500: 3 });
    expect(targetsFor(c, 'wd', 7, 'Main')).toEqual({ m500: 3 });
    expect(targetsFor(c, 'fri', 7, 'Main')).toBeNull();
    expect(mergeAutoplan('x')).toEqual(emptyAutoplan());
});
