import { inScope, solveBlock } from '../solver';
import { tablesScope, scopeKeys } from '../config';
import { parseMatrix } from '../paste';
import { DEFAULT_WEIGHTS } from '../config';

const L = ['m500', 'm1000', 'm3000'];
const ti = new Map(L.map((x, i) => [x, i]));

test('a rule can cover a list of tables', () => {
    const sc = tablesScope(['BA|1', 'BJ|7']);
    expect(sc).toBe('tables:BA|1,BJ|7');
    expect(scopeKeys(sc)).toEqual(['BA|1', 'BJ|7']);
    expect(inScope({ key: 'BJ|7' }, sc)).toBe(true);
    expect(inScope({ key: 'BJ|8' }, sc)).toBe(false);
    const tables = [{ key: 'BA|1', sub: 'S', zone: 'z' }, { key: 'BJ|7', sub: 'S', zone: 'z' }, { key: 'BC|2', sub: 'S', zone: 'z' }];
    const rules = [{ id: 1, on: true, type: 'lock', scope: sc, tier: 'm3000', hours: [21] }];
    const r = solveBlock({ tables, targets: { S: { m500: 1, m3000: 2 } }, ladders: { S: L }, tierIndex: ti, rules, weights: DEFAULT_WEIGHTS });
    expect(r.assign.get('BA|1')).toBe('m3000');
    expect(r.assign.get('BJ|7')).toBe('m3000');
    expect(r.assign.get('BC|2')).toBe('m500');
});

const tiers = [500, 1000, 2000, 3000].map((m) => ({ id: `m${m}`, min: m }));
const hours = [7, 11, 13, 15, 21, 3, 5];
const base = { ladderDesc: ['m3000', 'm1000', 'm500'], coreHours: hours, tiers };
const tsv = (rows) => rows.map((r) => r.join('\t')).join('\n');

test('a bare prices × hours block fills the whole grid, wherever it is pasted', () => {
    const r = parseMatrix(tsv([[1, 1, 1, 2, 2, 1, 1], [3, 3, 3, 3, 3, 3, 3], [18, 18, 18, 17, 17, 18, 18]]), { ...base, anchor: { tierId: 'm500', core: 15 } });
    expect(r.mode).toBe('full');
    expect(r.cells).toHaveLength(21);
    expect(r.cells.find((c) => c.tierId === 'm3000' && c.core === 15).n).toBe(2);
    expect(r.cells.find((c) => c.tierId === 'm500' && c.core === 5).n).toBe(18);
});

test('a smaller bare block fills from the cell it is pasted into', () => {
    const r = parseMatrix(tsv([[4, 5, 6], [7, 8, 9]]), { ...base, anchor: { tierId: 'm1000', core: 11 } });
    expect(r.mode).toBe('anchor');
    expect(r.cells.map((c) => `${c.tierId}@${c.core}=${c.n}`)).toEqual(['m1000@11=4', 'm1000@13=5', 'm1000@15=6', 'm500@11=7', 'm500@13=8', 'm500@15=9']);
});

test('price labels and hour headers map by name, in any order, adding new prices', () => {
    const r = parseMatrix(tsv([['Price', '21', '07', '9pm'], ['$500', 17, 18, ''], ['$2,000', 1, 0, ''], ['$1,000', 3, 3, '']]), { ...base, anchor: { tierId: 'm3000', core: 7 } });
    expect(r.mode).toBe('labeled');
    expect(r.newPrices).toEqual(['m2000']);
    expect(r.cells.find((c) => c.tierId === 'm500' && c.core === 21).n).toBe(17);
    expect(r.cells.find((c) => c.tierId === 'm2000' && c.core === 7).n).toBe(0);
    expect(r.cells).toHaveLength(6);
});

test('labels without a header row: values run across all core hours', () => {
    const r = parseMatrix(tsv([['$3,000', 1, 1, 1, 2, 2, 1, 1], ['$500', 18, 18, 18, 17, 17, 18, 18]]), { ...base, anchor: { tierId: 'm3000', core: 7 } });
    expect(r.mode).toBe('labeled');
    expect(r.cells).toHaveLength(14);
    expect(r.cells.find((c) => c.tierId === 'm3000' && c.core === 21).n).toBe(2);
});

test('bad cells are reported, not filled', () => {
    const r = parseMatrix(tsv([['$1,234', 1], ['$500', 'x']]), { ...base, anchor: { tierId: 'm3000', core: 7 } });
    expect(r.errors).toEqual(['$1,234 is not a price level.', '"x" is not a number.']);
    expect(r.cells).toHaveLength(0);
});
