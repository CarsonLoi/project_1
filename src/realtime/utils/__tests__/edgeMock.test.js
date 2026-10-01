import { mockEdgePath, mockEdgePaths, hotOption } from '../edgeMock';

describe('edgeMock', () => {
    test('deterministic and n long', () => {
        const a = mockEdgePath('BA|1|S1', 'SL7', 50);
        expect(a).toHaveLength(50);
        expect(mockEdgePath('BA|1|S1', 'SL7', 50)).toEqual(a);
    });

    test('starts at theo', () => {
        expect(mockEdgePath('BA|1|S1', 'BANKER', 40)[0]).toBeCloseTo(1.06, 5);
    });

    test('hot option ends negative', () => {
        let key = null;
        for (let i = 0; i < 200 && !key; i++) if (hotOption(`BA|${i}|S1`)) key = `BA|${i}|S1`;
        expect(key).not.toBeNull();
        const path = mockEdgePath(key, hotOption(key), 60);
        expect(path[59]).toBeLessThan(0);
    });

    test('paths for all ten options', () => {
        expect(Object.keys(mockEdgePaths('NC|2|S3', 12))).toHaveLength(10);
        expect(mockEdgePath('x', 'NOPE', 5)).toEqual([]);
    });
});
