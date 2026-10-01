import { solveBlock, lowerBound, changesBetween, diagnose, inScope, capsForSub } from '../solver';
import { DEFAULT_WEIGHTS } from '../config';

const tiers = ['m100', 'm300', 'm500', 'm1000'];
const tierIndex = new Map(tiers.map((id, i) => [id, i]));
const mk = (n, sub = 'Main', zoneSize = 3) => Array.from({ length: n }, (_, i) => ({ key: `BA|${i + 1}`, sub, zone: `Z${Math.floor(i / zoneSize)}`, gametype: 'BA', value: n - i }));
const W = DEFAULT_WEIGHTS;
const ladders = { Main: tiers };
const count = (assign) => { const c = {}; for (const v of assign.values()) c[v] = (c[v] || 0) + 1; return c; };

test('meets targets exactly; highest value tables take the highest prices', () => {
    const tables = mk(6);
    const r = solveBlock({ tables, targets: { Main: { m100: 1, m300: 2, m500: 2, m1000: 1 } }, ladders, tierIndex, weights: W });
    expect(r.ok).toBe(true);
    expect(count(r.assign)).toEqual({ m100: 1, m300: 2, m500: 2, m1000: 1 });
    expect(r.assign.get('BA|1')).toBe('m1000');
    expect(r.assign.get('BA|6')).toBe('m100');
});

test('change count equals the lower bound when rules are off', () => {
    const tables = mk(12);
    const a = solveBlock({ tables, targets: { Main: { m100: 3, m300: 3, m500: 3, m1000: 3 } }, ladders, tierIndex, weights: W }).assign;
    const next = { Main: { m100: 1, m300: 3, m500: 4, m1000: 4 } };
    const b = solveBlock({ tables, targets: next, ladders, tierIndex, prev: a, weights: W }).assign;
    expect(changesBetween(a, b).length).toBe(lowerBound(a, next, tables));
    expect(lowerBound(a, next, tables)).toBe(2);
});

test('zone cap, range, lock and max step are never broken', () => {
    const tables = mk(9);
    const rules = [
        { type: 'zonecap', scope: 'sub:Main', tier: 'm1000', n: 1, on: true, hours: [7] },
        { type: 'range', scope: 'table:BA|9', lo: 'm100', hi: 'm300', on: true, hours: [7] },
        { type: 'lock', scope: 'table:BA|5', tier: 'm500', on: true, hours: [7] },
    ];
    const r = solveBlock({ tables, targets: { Main: { m100: 2, m300: 2, m500: 2, m1000: 3 } }, ladders, tierIndex, rules, weights: W });
    expect(r.ok).toBe(true);
    const perZone = {};
    for (const [k, v] of r.assign) if (v === 'm1000') { const z = tables.find((t) => t.key === k).zone; perZone[z] = (perZone[z] || 0) + 1; }
    expect(Math.max(...Object.values(perZone))).toBe(1);
    expect(['m100', 'm300']).toContain(r.assign.get('BA|9'));
    expect(r.assign.get('BA|5')).toBe('m500');

    const prev = new Map(tables.map((t) => [t.key, 'm100']));
    const s = solveBlock({ tables, targets: { Main: { m100: 3, m300: 3, m500: 3, m1000: 0 } }, ladders, tierIndex, prev, rules: [{ type: 'maxstep', scope: 'all', n: 1, on: true, hours: [7] }], weights: W });
    expect(s.ok).toBe(false);                 // m500 is two steps from m100 for everyone
});

test('pins are kept and the targets make room for them', () => {
    const tables = mk(4);
    const pins = new Map([['BA|4', 'm1000']]);
    const r = solveBlock({ tables, targets: { Main: { m100: 2, m300: 2, m500: 0, m1000: 0 } }, ladders, tierIndex, pins, weights: W });
    expect(r.ok).toBe(true);
    expect(r.assign.get('BA|4')).toBe('m1000');
    expect(r.notes.length).toBe(1);
    expect(count(r.assign)).toEqual({ m100: 1, m300: 2, m1000: 1 });
});

test('stay close to the current plan when nothing else decides', () => {
    const tables = mk(4);
    const current = new Map([['BA|1', 'm100'], ['BA|2', 'm1000'], ['BA|3', 'm300'], ['BA|4', 'm500']]);
    const r = solveBlock({ tables, targets: { Main: { m100: 1, m300: 1, m500: 1, m1000: 1 } }, ladders, tierIndex, current, weights: W });
    expect([...r.assign.entries()].every(([k, v]) => current.get(k) === v)).toBe(true);
});

test('scopes, caps and diagnosis', () => {
    const t = { key: 'BA|1', sub: 'VIP', zone: 'Z1', gametype: 'BA' };
    expect(['all', 'sub:VIP', 'gt:BA', 'zone:Z1', 'table:BA|1'].every((s) => inScope(t, s))).toBe(true);
    expect(inScope(t, 'sub:Main')).toBe(false);
    const tables = mk(6);
    const rules = [{ type: 'zonecap', scope: 'sub:Main', tier: 'm1000', n: 1, on: true, hours: [7] }];
    expect(capsForSub(rules, tables, 'Main').get('m1000')).toBe(2);
    const msgs = diagnose({ tables, targets: { Main: { m100: 1, m1000: 4 } }, rules });
    expect(msgs.some((m) => m.includes('add up to 5'))).toBe(true);
    expect(msgs.some((m) => m.includes('allows 2'))).toBe(true);
});
