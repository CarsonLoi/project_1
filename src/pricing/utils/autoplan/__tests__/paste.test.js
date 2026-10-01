import { parseTargetsPaste, formatTargetsTsv, parseHourToken } from '../paste';
import { DAY_TYPES, DEFAULT_DOW_MAP } from '../core';

const tiers = [300, 500, 1000, 2000, 3000].map((m) => ({ id: `m${m}`, min: m, label: `$${m.toLocaleString()}` }));
const tierById = new Map(tiers.map((t) => [t.id, t]));
const coreHours = [7, 11, 13, 15, 21, 3, 5];
const ladders = { MSC: ['m500', 'm1000'], VIP: ['m1000', 'm2000'] };
const groups = [
    { key: 'MSC|BA', sub: 'MSC', game: 'BA', segment: 'MS' },
    { key: 'MSC|BJ', sub: 'MSC', game: 'BJ', segment: 'MS' },
    { key: 'VIP|BA', sub: 'VIP', game: 'BA', segment: 'PM' },
];
const base = { groups, tiers, coreHours, dayTypes: DAY_TYPES, dates: ['2026-10-05', '2026-10-06'], scope: 'wd', ladders, dowMap: DEFAULT_DOW_MAP };
const tsv = (rows) => rows.map((r) => r.join('\t')).join('\n');
const HEAD = ['Day of week', 'Segment', 'Sub segment', 'Game type', 'Price'];

test('hour tokens', () => {
    expect(['7', '07', '07:00', '7am', '9pm', '21:00', '12am', '3 AM'].map(parseHourToken)).toEqual([7, 7, 7, 7, 21, 21, 0, 3]);
    expect(parseHourToken('Price')).toBeNull();
});

test('each game type fills its own targets; blank cells repeat the row above', () => {
    const r = parseTargetsPaste(tsv([
        ['Segment', 'Sub segment', 'Game type', 'Price', '07', '11', '13', '15', '21', '03', '05'],
        ['MS', 'MSC', 'BA', '$1,000', 4, 3, 1, 5, 5, 3, 4],
        ['', '', '', '500', 18, 19, 21, 17, 17, 19, 18],
        ['MS', 'MSC', 'BJ', '$1,000', 1, 1, 1, 1, 2, 1, 1],
    ]), base);
    expect(r.errors).toEqual([]);
    expect(r.cells).toHaveLength(21);
    expect(r.cells[0]).toEqual({ scope: 'wd', group: 'MSC|BA', sub: 'MSC', tierId: 'm1000', core: 7, n: 4 });
    expect(r.cells.find((c) => c.group === 'MSC|BA' && c.tierId === 'm500' && c.core === 21).n).toBe(17);
    expect(r.cells.find((c) => c.group === 'MSC|BJ' && c.core === 21).n).toBe(2);
});

test('day of week: day types, weekdays (through the week map) and dates', () => {
    const r = parseTargetsPaste(tsv([
        [...HEAD, '9pm'],
        ['Weekday', 'MS', 'msc', 'ba', '1000', 2],
        ['Saturday', 'MS', 'MSC', 'BA', '1k', 3],
        ['Friday', 'MS', 'MSC', 'BJ', '1k', 1],
        ['2026-10-06', 'PM', 'VIP', 'BA', '2,000', 1],
    ]), base);
    expect(r.errors).toEqual([]);
    expect(r.cells.map((c) => `${c.scope}/${c.group}/${c.tierId}/${c.core}=${c.n}`))
        .toEqual(['wd/MSC|BA/m1000/21=2', 'sat/MSC|BA/m1000/21=3', 'fri/MSC|BJ/m1000/21=1', 'd:2026-10-06/VIP|BA/m2000/21=1']);

    // Monday and Tuesday are both Weekday: one cell, the later row wins, and the clash is reported.
    const w = parseTargetsPaste(tsv([[...HEAD, '21'], ['Monday', 'MS', 'MSC', 'BA', '$1,000', 2], ['Tuesday', 'MS', 'MSC', 'BA', '$1,000', 3]]), base);
    expect(w.cells).toEqual([{ scope: 'wd', group: 'MSC|BA', sub: 'MSC', tierId: 'm1000', core: 21, n: 3 }]);
    expect(w.errors).toEqual(['Monday and Tuesday are the same day type but have different numbers; Tuesday was used.']);
});

test('new prices and errors', () => {
    const r = parseTargetsPaste(tsv([
        ['Sub segment', 'Game type', 'Price', '21', '18'],
        ['MSC', 'BA', '$3,000', 1, 1],
        ['MSC', 'BA', '$1,234', 1, 1],
        ['Nope', 'BA', '$500', 1, 1],
        ['MSC', 'SB', '$500', 1, 1],
        ['MSC', 'BA', '$500', 'x', 1],
    ]), base);
    expect(r.newPrices).toEqual([{ sub: 'MSC', tierId: 'm3000' }]);
    expect(r.errors).toEqual([
        'Column 18 is not a core hour; it was skipped.',
        'Row 3: $1,234 is not a price level.',
        'Row 4: unknown sub-segment "Nope".',
        'Row 5: MSC has no SB tables.',
        'Row 6, 21:00: "x" is not a number.',
    ]);
    expect(r.cells).toHaveLength(1);
    expect(parseTargetsPaste('4\t5', base).errors[0]).toMatch(/header row/);
    expect(parseTargetsPaste(tsv([['Sub segment', 'Price', '21'], ['MSC', '$500', 1]]), base).errors[0]).toMatch(/Game type column/);
});

test('copy as Excel round-trips', () => {
    const vals = { 'wd|MSC|BA|m1000|7': 4, 'wd|MSC|BJ|m500|7': 18, 'sat|VIP|BA|m2000|21': 2 };
    const text = formatTargetsTsv({
        scopes: [{ id: 'wd', label: 'Weekday' }, { id: 'sat', label: 'Saturday' }], groups, coreHours, ladders, tierById,
        valueOf: (s, g, id, c) => vals[`${s}|${g}|${id}|${c}`] || 0,
    });
    const lines = text.split('\n');
    expect(lines[0]).toBe('Day of week\tSegment\tSub segment\tGame type\tPrice\t07\t11\t13\t15\t21\t03\t05');
    expect(lines[1]).toBe('Weekday\tMS\tMSC\tBA\t$1,000\t4\t0\t0\t0\t0\t0\t0');
    const back = parseTargetsPaste(text, base);
    expect(back.errors).toEqual([]);
    const got = Object.fromEntries(back.cells.filter((c) => c.n).map((c) => [`${c.scope}|${c.group}|${c.tierId}|${c.core}`, c.n]));
    expect(got).toEqual(vals);
    expect(formatTargetsTsv({ scopes: [{ id: 'd:2026-10-05', label: '2026-10-05' }], groups, coreHours, ladders, tierById, valueOf: () => 0 }).split('\t')[0]).toBe('Date');
});
