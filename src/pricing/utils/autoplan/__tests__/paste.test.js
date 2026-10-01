import { parseTargetsPaste, formatTargetsTsv, parseHourToken } from '../paste';
import { DAY_TYPES } from '../core';

const tiers = [300, 500, 1000, 2000, 3000].map((m) => ({ id: `m${m}`, min: m, label: `$${m.toLocaleString()}` }));
const tierById = new Map(tiers.map((t) => [t.id, t]));
const coreHours = [7, 11, 13, 15, 21, 3, 5];
const ladders = { MSC: ['m500', 'm1000'], VIP: ['m1000', 'm2000'] };
const base = { subs: ['MSC', 'VIP'], tiers, coreHours, dayTypes: DAY_TYPES, dates: ['2026-10-05', '2026-10-06'], scope: 'wd', ladders };
const tsv = (rows) => rows.map((r) => r.join('\t')).join('\n');

test('hour tokens', () => {
    expect(['7', '07', '07:00', '7am', '9pm', '21:00', '12am', '3 AM'].map(parseHourToken)).toEqual([7, 7, 7, 7, 21, 21, 0, 3]);
    expect(parseHourToken('Price')).toBeNull();
});

test('header + rows fill every cell; blank sub carries down', () => {
    const r = parseTargetsPaste(tsv([
        ['Sub-segment', 'Price', '07', '11', '13', '15', '21', '03', '05'],
        ['MSC', '$1,000', 4, 3, 1, 5, 5, 3, 4],
        ['', '500', 18, 19, 21, 17, 17, 19, 18],
    ]), base);
    expect(r.errors).toEqual([]);
    expect(r.cells).toHaveLength(14);
    expect(r.cells[0]).toEqual({ scope: 'wd', sub: 'MSC', tierId: 'm1000', core: 7, n: 4 });
    expect(r.cells.find((c) => c.tierId === 'm500' && c.core === 21).n).toBe(17);
});

test('day type / date column spreads rows over several scopes', () => {
    const r = parseTargetsPaste(tsv([
        ['Day type', 'Sub-segment', 'Price', '9pm'],
        ['Weekday', 'msc', '1000', 2],
        ['Saturday', 'MSC', '1k', 3],
        ['2026-10-06', 'VIP', '2,000', 1],
    ]), base);
    expect(r.errors).toEqual([]);
    expect(r.cells.map((c) => `${c.scope}/${c.sub}/${c.tierId}/${c.core}=${c.n}`))
        .toEqual(['wd/MSC/m1000/21=2', 'sat/MSC/m1000/21=3', 'd:2026-10-06/VIP/m2000/21=1']);
});

test('new prices and errors', () => {
    const r = parseTargetsPaste(tsv([
        ['Sub-segment', 'Price', '21', '18'],
        ['MSC', '$3,000', 1, 1],
        ['MSC', '$1,234', 1, 1],
        ['Nope', '$500', 1, 1],
        ['MSC', '$500', 'x', 1],
    ]), base);
    expect(r.newPrices).toEqual([{ sub: 'MSC', tierId: 'm3000' }]);
    expect(r.errors).toEqual([
        'Column 18 is not a core hour; it was skipped.',
        'Row 3: $1,234 is not a price level.',
        'Row 4: unknown sub-segment "Nope".',
        'Row 5, 21:00: "x" is not a number.',
    ]);
    expect(r.cells).toHaveLength(1);
    expect(parseTargetsPaste('4\t5', base).errors[0]).toMatch(/header row/);
});

test('copy as Excel round-trips', () => {
    const vals = { 'wd|MSC|m1000|7': 4, 'wd|MSC|m500|7': 18, 'sat|VIP|m2000|21': 2 };
    const text = formatTargetsTsv({
        scopes: [{ id: 'wd', label: 'Weekday' }, { id: 'sat', label: 'Saturday' }], subs: ['MSC', 'VIP'], coreHours, ladders, tierById,
        valueOf: (s, sub, id, c) => vals[`${s}|${sub}|${id}|${c}`] || 0,
    });
    expect(text.split('\n')[0]).toBe('Day type\tSub-segment\tPrice\t07\t11\t13\t15\t21\t03\t05');
    const back = parseTargetsPaste(text, base);
    expect(back.errors).toEqual([]);
    const got = Object.fromEntries(back.cells.filter((c) => c.n).map((c) => [`${c.scope}|${c.sub}|${c.tierId}|${c.core}`, c.n]));
    expect(got).toEqual(vals);
});
