import { solveOrder, pickAnchor, pickReferenceDate, solveDate, solveReference, planTargets } from '../period';
import { emptyAutoplan, withTargets, withManual, DEFAULT_WEIGHTS } from '../config';
import { CORE_HOURS, DEFAULT_CORE_HOURS, setCoreHours } from '../core';

afterEach(() => setCoreHours(DEFAULT_CORE_HOURS));

const tiersAsc = ['m300', 'm500', 'm1000', 'm2000', 'm3000'].map((id, i) => ({ id, min: [300, 500, 1000, 2000, 3000][i] }));
const tierIndex = new Map(tiersAsc.map((t, i) => [t.id, i]));
const ladder = tiersAsc.map((t) => t.id);
const tables = Array.from({ length: 6 }, (_, i) => ({ key: `BA|${i + 1}`, sub: 'Main', zone: `Z${Math.floor(i / 3)}`, gametype: 'BA' }));
const keys = tables.map((t) => t.key);
const openAll = () => new Map(CORE_HOURS.map((c) => [c, new Set(keys)]));

function ctx(cfg, extra = {}) {
    return {
        cfg, tables, tiersAsc, tierIndex, tierLabel: (id) => id, ladders: { Main: ladder },
        sharesByDt: {}, valuesByDt: {}, seededByDt: {},
        openByDate: { '2026-10-03': openAll(), '2026-10-05': openAll() },
        currentByDate: {}, pinsByDate: {}, keepPins: true, stayClose: false, ...extra,
    };
}
const flat = (cfg) => ({ ...cfg, weights: { ...DEFAULT_WEIGHTS, rank: 0, hist: 0 } });
const mixAll = (cfg, dt, m) => { let c = cfg; for (const h of CORE_HOURS) c = withTargets(c, dt, h, 'Main', m); return c; };

test('solve order: anchor first, then backward, then forward', () => {
    expect(solveOrder(DEFAULT_CORE_HOURS, 21).map((s) => (s.parent == null ? `${s.core}` : `${s.core}<${s.parent}`)))
        .toEqual(['21', '15<21', '13<15', '11<13', '7<11', '3<21', '5<3']);
    expect(solveOrder(DEFAULT_CORE_HOURS, 21).map((s) => s.dir)).toEqual([null, 'back', 'back', 'back', 'back', 'fwd', 'fwd']);
    expect(solveOrder([7, 11, 17, 21], 17).map((s) => `${s.core}<${s.parent}`)).toEqual(['17<null', '11<17', '7<11', '21<17']);
});

test('anchor falls back to the busiest core hour', () => {
    const open = new Map([[7, new Set(['a'])], [11, new Set(['a', 'b', 'c'])], [21, new Set(['a', 'b'])]]);
    expect(pickAnchor([7, 11, 21], 21, open)).toBe(21);
    expect(pickAnchor([7, 11, 21], 18, open)).toBe(11);
});

test('reference date: first date of the chosen day type, or the busiest', () => {
    const cfg = emptyAutoplan();
    const dates = ['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04'];      // Thu Fri Sat Sun
    const open = Object.fromEntries(dates.map((d, i) => [d, new Map([[21, new Set(keys.slice(0, i === 1 ? 6 : 3))]])]));
    expect(pickReferenceDate(dates, cfg, open, 21)).toBe('2026-10-03');
    expect(pickReferenceDate(dates, { ...cfg, criteria: { ...cfg.criteria, refDayType: 'auto' } }, open, 21)).toBe('2026-10-02');
    expect(pickReferenceDate(['2026-10-01'], cfg, open, 21)).toBe('2026-10-01');
});

test('every date aligns its anchor hour to the reference', () => {
    let cfg = flat(emptyAutoplan());
    cfg = mixAll(cfg, 'sat', { m500: 3, m3000: 3 });
    cfg = mixAll(cfg, 'wd', { m500: 3, m3000: 3 });
    const c = ctx(cfg, { valuesByDt: { sat: new Map(keys.map((k, i) => [k, i])) } });
    const ref = solveReference(c, '2026-10-03');
    expect([...ref.values()].filter((x) => x === 'm3000')).toHaveLength(3);
    const wd = solveDate(c, '2026-10-05', { ref });
    expect(wd.alignDiffs).toBe(0);
    for (const k of keys) expect(wd.byCore[21].get(k)).toBe(ref.get(k));
    // Same mix all day → no price change at all.
    expect(CORE_HOURS.reduce((a, h) => a + wd.report[h].changes.length, 0)).toBe(0);
});

test('forced change goes to the closest price, chronological report kept', () => {
    let cfg = flat(emptyAutoplan());
    cfg = mixAll(cfg, 'wd', { m500: 3, m3000: 3 });
    cfg = withTargets(cfg, 'wd', 15, 'Main', { m500: 3, m2000: 3 });
    const ref = new Map(keys.map((k, i) => [k, i < 3 ? 'm500' : 'm3000']));
    const r = solveDate(ctx(cfg), '2026-10-05', { ref, prevDateLast: ref });
    for (const k of keys.slice(3)) expect(r.byCore[15].get(k)).toBe('m2000');
    expect(r.report[21].changes).toHaveLength(3);        // 15 → 21 back up
    expect(r.report[15].changes).toHaveLength(3);        // 13 → 15 down one level
    expect(r.report[7].changes).toHaveLength(0);         // previous date 05 → 07
    expect(r.report[7].from).toBe('previous date 05:00');
});

test('a manual price is a hard rule and the mix makes room', () => {
    let cfg = flat(emptyAutoplan());
    cfg = mixAll(cfg, 'wd', { m1000: 4, m3000: 2 });
    cfg = withManual(cfg, '2026-10-05', 21, ['BA|6'], 'm1000');
    const ref = new Map(keys.map((k, i) => [k, i < 4 ? 'm1000' : 'm3000']));
    const r = solveDate(ctx(cfg), '2026-10-05', { ref });
    expect(r.byCore[21].get('BA|6')).toBe('m1000');
    expect([...r.byCore[21].values()].filter((x) => x === 'm3000')).toHaveLength(2);
    expect(r.byCore[15].get('BA|6')).toBe('m1000');       // propagates from 21 as fewest changes
});

test('closed tables get no price', () => {
    const cfg = mixAll(flat(emptyAutoplan()), 'wd', { m500: 3, m1000: 3 });
    const open = openAll();
    open.set(13, new Set(keys.slice(0, 4)));
    const r = solveDate(ctx(cfg, { openByDate: { '2026-10-05': open } }), '2026-10-05', {});
    expect(r.byCore[13].has('BA|5')).toBe(false);
    expect(r.byCore[13].size).toBe(4);
});

test('targets meet pod minimums', () => {
    expect(planTargets({ stored: { m500: 6, m1000: 0 }, openCount: 6, ladder: ['m500', 'm1000'], floors: new Map([['m1000', 2]]) })).toEqual({ m500: 4, m1000: 2 });
});

test('minimum is measured in solve direction when open tables differ', () => {
    let cfg = flat(emptyAutoplan());
    cfg = mixAll(cfg, 'wd', { m500: 3, m1000: 3 });
    cfg = withTargets(cfg, 'wd', 15, 'Main', { m1000: 3 });
    const open = openAll();
    open.set(15, new Set(['BA|1', 'BA|2', 'BA|4']));
    const ref = new Map(keys.map((k, i) => [k, i < 3 ? 'm500' : 'm1000']));
    const r = solveDate(ctx(cfg, { openByDate: { '2026-10-05': open } }), '2026-10-05', { ref });
    expect(r.report[21].changes).toHaveLength(2);      // 15 → 21: BA1, BA2 back to $500
    expect(r.report[21].lb).toBe(2);
    expect(r.report[15].lb).toBe(r.report[15].changes.length);
});

test('07:00 breaks ties toward the previous night, without adding changes', () => {
    let cfg = flat(emptyAutoplan());
    cfg = mixAll(cfg, 'wd', { m500: 3, m1000: 3 });
    cfg = withTargets(cfg, 'wd', 7, 'Main', { m500: 4, m1000: 2 });
    const ref = new Map(keys.map((k, i) => [k, i < 3 ? 'm500' : 'm1000']));
    // Whichever table ended last night at $500 is the one to drop at 07:00.
    for (const drop of [3, 4, 5]) {
        const night = new Map(keys.map((k, i) => [k, i < 3 || i === drop ? 'm500' : 'm1000']));
        const r = solveDate(ctx(cfg), '2026-10-05', { ref, prevDateLast: night });
        expect(r.byCore[7].get(keys[drop])).toBe('m500');
        expect(r.report[7].changes).toHaveLength(0);
        expect(r.report[11].changes).toHaveLength(r.report[11].lb);
    }
});

test('a lock rule gets its price even when the mix has no slot for it', () => {
    let cfg = flat(emptyAutoplan());
    cfg = mixAll(cfg, 'wd', { m500: 6 });
    cfg = { ...cfg, rules: [{ id: 1, on: true, type: 'lock', scope: 'tables:BA|2,BA|5', tier: 'm3000', hours: [21, 3] }] };
    const r = solveDate(ctx(cfg), '2026-10-05', {});
    expect(r.byCore[21].get('BA|2')).toBe('m3000');
    expect(r.byCore[21].get('BA|5')).toBe('m3000');
    expect(r.report[21].problems).toEqual([]);
    expect(r.byCore[15].get('BA|2')).toBe('m500');          // not locked at 15:00
});
