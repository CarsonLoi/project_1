import { solveDate, planTargets, readPins } from '../period';
import { applyDraft } from '../apply';
import { emptyAutoplan, withTargets } from '../config';
import { CORE_HOURS, blockHours } from '../core';

const tiersAsc = ['m100', 'm300', 'm500', 'm1000'].map((id, i) => ({ id, min: [100, 300, 500, 1000][i] }));
const tierIndex = new Map(tiersAsc.map((t, i) => [t.id, i]));
const tables = Array.from({ length: 6 }, (_, i) => ({ key: `BA|${i + 1}`, sub: 'Main', zone: `Z${Math.floor(i / 3)}`, gametype: 'BA' }));
const allOpen = new Map(CORE_HOURS.map((c) => [c, new Set(tables.map((t) => t.key))]));

function ctx(cfg, extra = {}) {
    return {
        cfg, tables, tiersAsc, tierIndex, tierLabel: (id) => id,
        ladders: { Main: tiersAsc.map((t) => t.id) },
        sharesByDt: {}, valuesByDt: { wd: new Map(tables.map((t, i) => [t.key, 10 - i])) }, seededByDt: {},
        openByDate: { '2026-10-01': allOpen, '2026-10-02': allOpen },
        currentByDate: {}, pinsByDate: {}, keepPins: true, stayClose: false, ...extra,
    };
}

test('planTargets fits stored targets to the open count and caps', () => {
    expect(planTargets({ stored: { m100: 1, m1000: 1 }, openCount: 4, ladder: ['m100', 'm1000'] })).toEqual({ m100: 2, m1000: 2 });
    expect(planTargets({ stored: null, seeded: { m300: 2 }, openCount: 2, ladder: ['m300'] })).toEqual({ m300: 2 });
    expect(planTargets({ stored: { m100: 0, m1000: 4 }, openCount: 4, ladder: ['m100', 'm1000'], caps: new Map([['m1000', 1]]) })).toEqual({ m100: 3, m1000: 1 });
});

test('a date is solved block by block with fewest changes', () => {
    let cfg = emptyAutoplan();
    for (const c of CORE_HOURS) cfg = withTargets(cfg, 'wd', c, 'Main', c === 21 ? { m300: 2, m500: 2, m1000: 2 } : { m100: 2, m300: 2, m500: 2 });
    const r = solveDate(ctx(cfg), '2026-10-01', null);
    expect(r.dayType).toBe('wd');
    expect(r.report[11].changes.length).toBe(0);
    expect(r.report[21].changes.length).toBe(r.report[21].lb);
    expect(r.report[21].lb).toBe(2);
    expect(r.report[3].changes.length).toBe(2);
});

test('apply writes every hour of the block, keeps pins, saves a version', () => {
    let saved = null;
    const store = { plans: { '2026-10-01': { byDaypart: { h_7: { assignments: { 'BA|1': { base: 'm100', min: 'm100', max: 'm100', pin: true } } } }, versions: [] } } };
    expect(readPins(store, '2026-10-01', 7).get('BA|1')).toBe('m100');
    const draft = { '2026-10-01': { 7: new Map([['BA|1', 'm100'], ['BA|2', 'm500']]) } };
    const hoursOpen = new Map(blockHours(7).map((h) => [h, new Set(h === 10 ? ['BA|1'] : ['BA|1', 'BA|2'])]));
    const spy = jest.spyOn(Storage.prototype, 'setItem').mockImplementation((k, v) => { saved = v; });
    const next = applyDraft(store, draft, { openHoursByDate: { '2026-10-01': hoursOpen }, pinsByDate: { '2026-10-01': { 7: new Map([['BA|1', 'm100']]) } } });
    spy.mockRestore();
    const p = next.plans['2026-10-01'];
    expect(p.versions).toHaveLength(1);
    expect(p.versions[0].byDaypart.h_7.assignments['BA|1'].pin).toBe(true);
    for (const h of [7, 8, 9]) expect(Object.keys(p.byDaypart[`h_${h}`].assignments).sort()).toEqual(['BA|1', 'BA|2']);
    expect(Object.keys(p.byDaypart.h_10.assignments)).toEqual(['BA|1']);
    expect(p.byDaypart.h_8.assignments['BA|2']).toEqual({ base: 'm500', min: 'm500', max: 'm500', src: 'auto' });
    expect(p.byDaypart.h_8.assignments['BA|1'].pin).toBe(true);
    expect(saved).not.toBeNull();
});
