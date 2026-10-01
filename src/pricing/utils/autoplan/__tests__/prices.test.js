import { emptyAutoplan, mergeAutoplan, withTargets, targetsFor, withPrices, removePrice, clearPrices } from '../config';
import { effectiveLadders, foldToLadder } from '../inputs';
import { planTargets } from '../period';

const tiersAsc = [100, 300, 500, 1000, 3000].map((m) => ({ id: `m${m}`, min: m }));
const tierIndex = new Map(tiersAsc.map((t, i) => [t.id, i]));

test('edited price lists override history, sorted and limited to real prices', () => {
    const hist = { MSC: ['m500', 'm1000'], VIP: ['m1000'] };
    const l = effectiveLadders(hist, { MSC: ['m3000', 'm300', 'nope', 'm300'], VIP: [] }, tiersAsc);
    expect(l.MSC).toEqual(['m300', 'm3000']);
    expect(l.VIP).toEqual(['m1000']);
    expect(effectiveLadders(hist, undefined, tiersAsc)).toEqual(hist);
});

test('fold moves a missing price to the next lower one, else the next higher', () => {
    expect(foldToLadder({ m500: 3, m1000: 2, m3000: 1 }, ['m300', 'm1000'], tierIndex)).toEqual({ m300: 3, m1000: 3 });
    expect(foldToLadder({ m100: 4, m500: 1 }, ['m500', 'm1000'], tierIndex)).toEqual({ m500: 5 });
});

test('merge keeps valid price lists only', () => {
    const m = mergeAutoplan({ prices: { MSC: ['m500', 3, 'm1000'], Main: [], VIP: 'x' } });
    expect(m.prices).toEqual({ MSC: ['m500', 'm1000'] });
    expect(emptyAutoplan().prices).toEqual({});
});

test('add, remove (tables move to the next lower price) and reset a price list', () => {
    let cfg = emptyAutoplan();
    cfg = withTargets(cfg, 'wd', 7, 'MSC', { m500: 18, m1000: 4 });
    cfg = withTargets(cfg, 'sat', 21, 'MSC', { m500: 10, m1000: 12 });
    cfg = withTargets(cfg, 'wd', 7, 'VIP', { m1000: 5 });
    cfg = withPrices(cfg, 'MSC', ['m500', 'm1000', 'm300'], tiersAsc);
    expect(cfg.prices.MSC).toEqual(['m300', 'm500', 'm1000']);

    const r = removePrice(cfg, 'MSC', 'm500', ['m300', 'm500', 'm1000'], tierIndex);
    expect(r.cfg.prices.MSC).toEqual(['m300', 'm1000']);
    expect(targetsFor(r.cfg, 'wd', 7, 'MSC')).toEqual({ m300: 18, m1000: 4 });
    expect(targetsFor(r.cfg, 'sat', 21, 'MSC')).toEqual({ m300: 10, m1000: 12 });
    expect(targetsFor(r.cfg, 'wd', 7, 'VIP')).toEqual({ m1000: 5 });
    expect(r.moved).toBe(28);
    expect(r.to).toBe('m300');

    const c = clearPrices(r.cfg, 'MSC', ['m500', 'm1000'], tierIndex);
    expect(c.prices.MSC).toBeUndefined();
    expect(targetsFor(c, 'wd', 7, 'MSC')).toEqual({ m500: 18, m1000: 4 });
});

test('solve-time targets fold prices that left the list', () => {
    const t = planTargets({ stored: { m500: 3, m1000: 1 }, openCount: 4, ladder: ['m300', 'm1000'], tierIndex });
    expect(t).toEqual({ m300: 3, m1000: 1 });
});

test('config price lists sit between page edits and history', () => {
    const hist = { MSC: ['m500'], VIP: ['m1000'], Other: ['m300'] };
    const config = { MSC: [300, 500, 1000, 3000, 1234], VIP: [] };
    const l = effectiveLadders(hist, {}, tiersAsc, config);
    expect(l.MSC).toEqual(['m300', 'm500', 'm1000', 'm3000']);    // $1,234 isn't a level → ignored
    expect(l.VIP).toEqual(['m1000']);                              // empty config → history
    expect(l.Other).toEqual(['m300']);                             // not configured → history
    expect(effectiveLadders(hist, { MSC: ['m500'] }, tiersAsc, config).MSC).toEqual(['m500']);   // page edit wins
});
