import { solveDate } from '../period';
import { solveBlock } from '../solver';
import { emptyAutoplan, withTargets, withManual, manualFor, manualExemptFor, mergeAutoplan, DEFAULT_WEIGHTS, isExempt } from '../config';
import { CORE_HOURS } from '../core';

const tiersAsc = ['m500', 'm1000'].map((id, i) => ({ id, min: [500, 1000][i] }));
const tierIndex = new Map(tiersAsc.map((t, i) => [t.id, i]));
const tables = Array.from({ length: 6 }, (_, i) => ({ key: `BA|${i + 1}`, sub: 'Main', zone: `Z${Math.floor(i / 3)}`, gametype: 'BA' }));
const keys = tables.map((t) => t.key);
const openAll = () => new Map(CORE_HOURS.map((c) => [c, new Set(keys)]));
const flat = (cfg) => ({ ...cfg, weights: { ...DEFAULT_WEIGHTS, rank: 0, hist: 0 } });
const mixAll = (cfg, m) => { let c = cfg; for (const h of CORE_HOURS) c = withTargets(c, 'wd', h, 'Main', m); return c; };
const ctx = (cfg, extra = {}) => ({
    cfg, tables, tiersAsc, tierIndex, tierLabel: (id) => id, ladders: { Main: ['m500', 'm1000'] },
    sharesByDt: {}, valuesByDt: {}, seededByDt: {}, openByDate: { '2026-10-05': openAll() },
    currentByDate: {}, pinsByDate: {}, keepPins: true, stayClose: true, ...extra,
});
const baseAllHours = (fn) => Object.fromEntries(CORE_HOURS.map((h) => [h, new Map(keys.map((k, i) => [k, fn(h, i)]))]));

test('adjusting an old version: only the tables the new mix forces differ', () => {
    // Old version: BA1-3 at $500, BA4-6 at $1,000 all day. New mix: 2 × $500, 4 × $1,000.
    const cfg = mixAll(flat(emptyAutoplan()), { m500: 2, m1000: 4 });
    const base = baseAllHours((h, i) => (i < 3 ? 'm500' : 'm1000'));
    const r = solveDate(ctx(cfg, { currentByDate: { '2026-10-05': base }, baseStrength: 'strong' }), '2026-10-05', {});
    const moved = new Set();
    for (const h of CORE_HOURS) {
        expect(r.report[h].baseChanges).toHaveLength(1);
        expect(r.report[h].baseLb).toBe(1);
        moved.add(r.report[h].baseChanges[0].key);
    }
    expect(moved.size).toBe(1);                                  // the same table all day
    expect(CORE_HOURS.reduce((a, h) => a + r.report[h].changes.length, 0)).toBe(0);
});

test('"as close as possible" follows the base plan even when it changes between hours', () => {
    const cfg = mixAll(flat(emptyAutoplan()), { m500: 3, m1000: 3 });
    // Base: $1,000 on BA4-6 at 21:00 but on BA1-3 at 15:00.
    const base = baseAllHours((h, i) => ((h === 15 ? i < 3 : i >= 3) ? 'm1000' : 'm500'));
    const strong = solveDate(ctx(cfg, { currentByDate: { '2026-10-05': base }, baseStrength: 'strong' }), '2026-10-05', {});
    expect(strong.report[15].baseChanges).toHaveLength(0);
    const tie = solveDate(ctx(cfg, { currentByDate: { '2026-10-05': base }, baseStrength: 'tie' }), '2026-10-05', {});
    expect(tie.report[15].baseChanges).toHaveLength(6);          // tie-break only: fewest hour changes win
    expect(tie.report[21].changes).toHaveLength(0);
});

test('manual entries can carry a pod-limit exemption', () => {
    let cfg = withManual(emptyAutoplan(), '2026-10-05', 21, ['BA|1'], 'm1000', ['*']);
    cfg = withManual(cfg, '2026-10-05', 21, ['BA|4'], 'm1000');
    expect([...manualFor(cfg, '2026-10-05', 21)]).toEqual([['BA|1', 'm1000'], ['BA|4', 'm1000']]);
    expect([...manualExemptFor(cfg, '2026-10-05', 21)]).toEqual([['BA|1', ['*']]]);
    expect(mergeAutoplan({ manual: cfg.manual }).manual).toEqual(cfg.manual);
    expect(isExempt(['*'], 7)).toBe(true);
    expect(isExempt([3], 7)).toBe(false);
    expect(isExempt([7], 7)).toBe(true);
    expect(isExempt([], 7)).toBe(false);
});

test('an exempt locked table does not count toward the pod maximum', () => {
    // Pod A: 123, A2, A3 · pod B: 345, B2, B3. Max 1 × $1,000 per pod. Mix: 3 × $1,000.
    const ts = ['123', 'A2', 'A3', '345', 'B2', 'B3'].map((k, i) => ({ key: k, sub: 'S', zone: i < 3 ? 'A' : 'B' }));
    const rules = [{ id: 7, on: true, type: 'zonecap', scope: 'all', tier: 'm1000', n: 1, maxOn: true, min: 0, minOn: false, hours: [21] }];
    const pins = new Map([['123', 'm1000'], ['345', 'm1000']]);
    const run = (exempt) => solveBlock({
        tables: ts, targets: { S: { m500: 3, m1000: 3 } }, ladders: { S: ['m500', 'm1000'] }, tierIndex,
        pins, rules, weights: DEFAULT_WEIGHTS, exempt,
    });
    const ok = run(new Map([['123', ['*']]]));
    expect(ok.ok).toBe(true);
    expect(['A2', 'A3'].filter((k) => ok.assign.get(k) === 'm1000')).toHaveLength(1);   // pod A: 123 is free, one more allowed
    expect(['B2', 'B3'].filter((k) => ok.assign.get(k) === 'm1000')).toHaveLength(0);   // pod B: 345 counts
    expect(run(new Map([['123', [7]]])).ok).toBe(true);                                  // exempt from that rule only
    expect(run(new Map([['123', [99]]])).ok).toBe(false);                                // exempt from another rule
    expect(run(new Map()).ok).toBe(false);                                               // no exemption: only 2 fit
});
