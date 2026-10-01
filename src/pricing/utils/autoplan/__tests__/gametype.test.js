// Targets per sub-segment × game type: tables never fill another game type's
// targets, while pod limits are shared by every game type in the pod.
import { solveBlock, floorsForSub, capsForSub, lowerBound, diagnose, splitPods } from '../solver';
import { fitSharedPods } from '../period';
import { DEFAULT_WEIGHTS, groupKey, groupSub, groupGame, groupLabel } from '../config';

const L = ['p1', 'p2', 'p3'];
const ti = new Map(L.map((x, i) => [x, i]));
const W = { ...DEFAULT_WEIGHTS, rank: 0, hist: 0 };
const T = (key, game, zone) => ({ key, sub: 'S', gametype: game, grp: groupKey('S', game), zone });
const ladders = { 'S|BA': L, 'S|BJ': L };
const cap1 = { id: 1, on: true, type: 'zonecap', scope: 'sub:S', tier: 'p3', n: 1, maxOn: true, min: 0, minOn: false, hours: [21] };

test('group keys', () => {
    expect(groupKey('MSC', 'BA')).toBe('MSC|BA');
    expect([groupSub('MSC|BA'), groupGame('MSC|BA'), groupLabel('MSC|BA')]).toEqual(['MSC', 'BA', 'MSC · BA']);
});

test('a game type only fills its own targets, even when another game type would change less', () => {
    // BA has one p3 slot; the BJ table was p3 before but BJ has no p3 target.
    const tables = [T('BA1', 'BA', 'z1'), T('BA2', 'BA', 'z1'), T('BJ1', 'BJ', 'z1')];
    const prev = new Map([['BA1', 'p1'], ['BA2', 'p1'], ['BJ1', 'p3']]);
    const r = solveBlock({ tables, targets: { 'S|BA': { p3: 1, p1: 1 }, 'S|BJ': { p1: 1 } }, ladders, tierIndex: ti, prev, weights: W });
    expect(r.ok).toBe(true);
    expect(r.assign.get('BJ1')).toBe('p1');
    expect(['BA1', 'BA2'].map((k) => r.assign.get(k)).sort()).toEqual(['p1', 'p3']);
    // Fewest changes the targets allow, per game type: BJ1 must move, one BA table must move.
    expect(lowerBound(prev, r.targets, tables)).toBe(2);
});

test('a pod limit is shared by the game types in the pod', () => {
    // Pods z1 and z2 each hold BA and BJ; "each pod at most 1 × p3".
    // BA needs one p3 and BJ needs one p3: they must sit in different pods.
    const tables = [T('BA1', 'BA', 'z1'), T('BA2', 'BA', 'z2'), T('BJ1', 'BJ', 'z1'), T('BJ2', 'BJ', 'z2')];
    // Before: both p3 tables in z1 (BA1, BJ1) — over the shared limit.
    const prev = new Map([['BA1', 'p3'], ['BA2', 'p1'], ['BJ1', 'p3'], ['BJ2', 'p1']]);
    const targets = { 'S|BA': { p3: 1, p1: 1 }, 'S|BJ': { p3: 1, p1: 1 } };
    const r = solveBlock({ tables, targets, ladders, tierIndex: ti, prev, rules: [cap1], weights: W });
    expect(r.ok).toBe(true);
    const p3 = tables.filter((t) => r.assign.get(t.key) === 'p3');
    expect(p3.map((t) => t.gametype).sort()).toEqual(['BA', 'BJ']);
    expect(new Set(p3.map((t) => t.zone)).size).toBe(2);
    // Only one table had to move (one of the z1 pair gives up p3).
    expect([...r.assign].filter(([k, v]) => prev.get(k) !== v)).toHaveLength(2);
});

test('pinned tables keep their pod slot when the limit is split', () => {
    const tables = [T('BA1', 'BA', 'z1'), T('BA2', 'BA', 'z2'), T('BJ1', 'BJ', 'z1'), T('BJ2', 'BJ', 'z2')];
    const prev = new Map([['BA1', 'p3'], ['BA2', 'p1'], ['BJ1', 'p3'], ['BJ2', 'p1']]);
    const targets = { 'S|BA': { p3: 1, p1: 1 }, 'S|BJ': { p3: 1, p1: 1 } };
    const r = solveBlock({ tables, targets, ladders, tierIndex: ti, prev, rules: [cap1], weights: W, pins: new Map([['BJ1', 'p3']]) });
    expect(r.assign.get('BJ1')).toBe('p3');
    expect(r.assign.get('BA1')).toBe('p1');
    expect(r.assign.get('BA2')).toBe('p3');
});

test('pod minimum shared across game types, and floors split between them', () => {
    const tables = [T('BA1', 'BA', 'z1'), T('BJ1', 'BJ', 'z1'), T('BJ2', 'BJ', 'z1'), T('BA2', 'BA', 'z2'), T('BJ3', 'BJ', 'z2')];
    const rule = { ...cap1, n: 9, maxOn: false, min: 1, minOn: true };
    // z1: BJ is larger → BJ carries z1's minimum; z2: a tie → BA (name order).
    expect(floorsForSub([rule], tables, 'S|BJ').get('p3')).toBe(1);
    expect(floorsForSub([rule], tables, 'S|BA').get('p3')).toBe(1);
    const prev = new Map(tables.map((t) => [t.key, 'p1']));
    const r = solveBlock({ tables, targets: { 'S|BA': { p3: 1, p1: 1 }, 'S|BJ': { p3: 1, p1: 2 } }, ladders, tierIndex: ti, prev, rules: [rule], weights: W });
    expect(r.ok).toBe(true);
    expect(r.podShort).toEqual([]);
    for (const z of ['z1', 'z2']) expect(tables.filter((t) => t.zone === z && r.assign.get(t.key) === 'p3')).toHaveLength(1);
});

test('caps per group are an upper bound; diagnose sums the game types against the pods', () => {
    const tables = [T('BA1', 'BA', 'z1'), T('BJ1', 'BJ', 'z1')];
    expect(capsForSub([cap1], tables, 'S|BA').get('p3')).toBe(1);
    const msgs = diagnose({ tables, targets: { 'S|BA': { p3: 1 }, 'S|BJ': { p3: 1 } }, rules: [cap1], tierLabel: (id) => id });
    expect(msgs).toContain('S: targets need 2 × p3 but "max 1 per pod" allows 1');
});

test('game types sharing a pod limit are trimmed together before solving', () => {
    // Two pods → "max 1 × p3 per pod" allows 2; BA wants 2 and BJ wants 1.
    const tables = [T('BA1', 'BA', 'z1'), T('BA2', 'BA', 'z2'), T('BA3', 'BA', 'z1'), T('BJ1', 'BJ', 'z1'), T('BJ2', 'BJ', 'z2')];
    const targets = { 'S|BA': { p3: 2, p2: 0, p1: 1 }, 'S|BJ': { p3: 1, p1: 1 } };
    const r = fitSharedPods({ targets, tables, rules: [cap1], ladders });
    expect(r.targets['S|BA']).toEqual({ p3: 1, p2: 1, p1: 1 });
    expect(r.targets['S|BJ']).toEqual({ p3: 1, p1: 1 });
    expect(r.notes).toEqual(['S: 1 BA target table moved off p3 to fit "max 1 per pod" (shared by game types)']);
    // A table locked at p3 and exempt from the rule sits on top of the limit.
    const pins = new Map([['BA3', 'p3']]);
    const ex = fitSharedPods({ targets, tables, rules: [cap1], ladders, pins, exempt: new Map([['BA3', ['*']]]) });
    expect(ex.targets['S|BA'].p3).toBe(2);
    // Solved end to end: every table priced, one p3 per pod among the counted tables.
    const s = solveBlock({ tables, targets: r.targets, ladders, tierIndex: ti, prev: null, rules: [cap1], weights: W });
    expect(s.ok).toBe(true);
    for (const z of ['z1', 'z2']) expect(tables.filter((t) => t.zone === z && s.assign.get(t.key) === 'p3')).toHaveLength(1);
});

test('splitPods keeps the first placement where the limit allows', () => {
    const pod = (zone, byGroup) => ({ key: `${zone}|p3|S`, zone, sub: 'S', tier: 'p3', n: 1, min: 0, size: Object.values(byGroup).flat().length, byGroup: new Map(Object.entries(byGroup)) });
    const shared = [pod('z1', { 'S|BA': ['BA1'], 'S|BJ': ['BJ1'] }), pod('z2', { 'S|BA': ['BA2'], 'S|BJ': ['BJ2'] })];
    const share = splitPods(shared, new Map([['BA1', 'p3'], ['BJ2', 'p3']]));
    expect(share.get('z1|p3|S').get('S|BA')).toBe(1);
    expect(share.get('z2|p3|S').get('S|BJ')).toBe(1);
});
