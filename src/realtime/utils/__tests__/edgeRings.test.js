import { RING_DEFAULTS, mergeRingSettings, edgesFromRow, ringsFor, ringsByTable } from '../edgeRings';

const settings = () => mergeRingSettings(null);

describe('edgeRings', () => {
    test('defaults: every option on, below 0, TIE and SL7 below -2', () => {
        const s = settings();
        expect(Object.keys(s.opts)).toHaveLength(10);
        expect(s.opts.BANKER).toMatchObject({ on: true, below: 0 });
        expect(s.opts.TIE.below).toBe(-2);
        expect(s.opts.SL7.below).toBe(-2);
        expect(s.multi).toBe('segments');
        expect(s.minHands).toBe(10);
    });

    test('merge keeps stored values and fills new options', () => {
        const s = mergeRingSettings({ minHands: 20, opts: { BANKER: { on: false, below: -1, color: '#000000' } } });
        expect(s.minHands).toBe(20);
        expect(s.opts.BANKER).toEqual({ on: false, below: -1, color: '#000000' });
        expect(s.opts.L6).toEqual(RING_DEFAULTS.opts.L6);
    });

    test('merge ignores garbage', () => {
        expect(mergeRingSettings('nope')).toEqual(settings());
        expect(mergeRingSettings({ multi: 'weird', minHands: 'x' }).multi).toBe('segments');
    });

    test('edgesFromRow maps edge keys to codes; missing → null', () => {
        const e = edgesFromRow({ house_edge_banker: '1.2', house_edge_sl7: -3, house_edge_tie: '' });
        expect(e.BANKER).toBe(1.2);
        expect(e.SL7).toBe(-3);
        expect(e.TIE).toBeNull();
        expect(e.L6).toBeNull();
    });

    test('ringsFor: hits below threshold, worst gap first', () => {
        const s = settings();
        const hits = ringsFor({ BANKER: -0.2, SL7: -6, TIE: -1, BTG: -1.5 }, 30, s);
        expect(hits.map((h) => h.code)).toEqual(['SL7', 'BTG', 'BANKER']);
        expect(hits[0]).toMatchObject({ edge: -6, gap: -4, color: s.opts.SL7.color });
    });

    test('ringsFor: guarded by min hands and disabled options', () => {
        const s = settings();
        expect(ringsFor({ BANKER: -1 }, 9, s)).toEqual([]);
        s.opts.BANKER.on = false;
        expect(ringsFor({ BANKER: -1 }, 30, s)).toEqual([]);
    });

    test('ringsFor: unknown hands count still evaluates', () => {
        expect(ringsFor({ PLAYER: -0.5 }, null, settings())).toHaveLength(1);
    });

    test('ringsByTable keys by gametype|table', () => {
        const m = ringsByTable([
            { gametype: 'BA', table: 1, shoe_hands_dealt: 40, house_edge_sd: -1 },
            { gametype: 'NC', table: 2, shoe_hands_dealt: 40, house_edge_sd: 3 },
        ], settings());
        expect([...m.keys()]).toEqual(['BA|1']);
        expect(m.get('BA|1')[0].code).toBe('SD');
    });
});
