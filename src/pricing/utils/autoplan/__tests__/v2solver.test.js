import { solveBlock, floorsForSub, capsForSub, changeCost } from '../solver';
import { DEFAULT_WEIGHTS } from '../config';

const L = ['p1', 'p2', 'p3', 'p4'];
const ti = new Map(L.map((x, i) => [x, i]));
const W = { ...DEFAULT_WEIGHTS, rank: 0, hist: 0 };
const zr = (extra) => ({ id: 1, on: true, type: 'zonecap', scope: 'all', tier: 'p1', min: 0, minOn: false, n: 9, maxOn: false, hours: [21], ...extra });

test('forced change goes to the closest price', () => {
    const tables = [{ key: 'A', sub: 'S', zone: 'z' }, { key: 'B', sub: 'S', zone: 'z' }];
    const prev = new Map([['A', 'p4'], ['B', 'p1']]);
    const r = solveBlock({ tables, targets: { S: { p1: 1, p3: 1 } }, ladders: { S: L }, tierIndex: ti, prev, weights: W });
    expect(r.assign.get('A')).toBe('p3');
    expect(r.assign.get('B')).toBe('p1');
});

test('pod minimum is exact, and reported when a pod cannot meet it', () => {
    const tables = [{ key: 'A', sub: 'S', zone: 'z1' }, { key: 'B', sub: 'S', zone: 'z1' }, { key: 'C', sub: 'S', zone: 'z2' }, { key: 'D', sub: 'S', zone: 'z2' }];
    const prev = new Map([['A', 'p2'], ['B', 'p2'], ['C', 'p1'], ['D', 'p2']]);
    const rules = [zr({ min: 1, minOn: true })];
    const r = solveBlock({ tables, targets: { S: { p1: 2, p2: 2 } }, ladders: { S: L }, tierIndex: ti, prev, rules, weights: W });
    expect(['A', 'B'].filter((k) => r.assign.get(k) === 'p1')).toHaveLength(1);
    expect(['C', 'D'].filter((k) => r.assign.get(k) === 'p1')).toHaveLength(1);
    expect(r.podShort).toEqual([]);
    expect(floorsForSub(rules, tables, 'S').get('p1')).toBe(2);

    const short = solveBlock({ tables, targets: { S: { p1: 1, p2: 3 } }, ladders: { S: L }, tierIndex: ti, prev, rules, weights: W });
    expect(short.ok).toBe(true);
    expect(short.podShort).toEqual([{ zone: 'z1', sub: 'S', tier: 'p1', have: 0, min: 1 }]);
});

test('pod maximum only when switched on', () => {
    const tables = [{ key: 'A', sub: 'S', zone: 'z' }, { key: 'B', sub: 'S', zone: 'z' }];
    expect(capsForSub([zr({ n: 1, maxOn: true })], tables, 'S').get('p1')).toBe(1);
    expect(capsForSub([zr({ n: 1, maxOn: false })], tables, 'S').has('p1')).toBe(false);
});

test('change cost: peak multiplier, closest price, raise by time direction', () => {
    const w = { ...W, raise: 700 };
    expect(changeCost(w, { k: 2, pk: 2 })).toBe(0);
    expect(changeCost(w, { k: 1, pk: 2, scale: 3 })).toBe(30000 + 1000);
    // fwd: time runs parent → this hour, so going up is a raise.
    expect(changeCost(w, { k: 3, pk: 1, direction: 'fwd' })).toBe(10000 + 2000 + 700);
    // back: time runs this hour → parent, so parent higher = a raise.
    expect(changeCost(w, { k: 1, pk: 3, direction: 'back' })).toBe(10000 + 2000 + 700);
    expect(changeCost(w, { k: 3, pk: 1, direction: 'back' })).toBe(10000 + 2000);
});

test('pod penalty moves a change to another pod', () => {
    const tables = [{ key: 'A', sub: 'S', zone: 'z1' }, { key: 'B', sub: 'S', zone: 'z2' }];
    const prev = new Map([['A', 'p1'], ['B', 'p1']]);
    const r = solveBlock({ tables, targets: { S: { p1: 1, p2: 1 } }, ladders: { S: L }, tierIndex: ti, prev, weights: W, podPenalty: new Map([['z1', 2000]]) });
    expect(r.assign.get('A')).toBe('p1');
    expect(r.assign.get('B')).toBe('p2');
});
