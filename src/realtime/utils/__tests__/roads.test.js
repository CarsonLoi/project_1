import { buildBigRoad, computeStats, chunkBeadPlate } from '../../../trend/components/BaccaratBoard';

test('big road stacks a streak and starts a new column on a change', () => {
    const hands = ['B', 'B', 'P', 'T', 'P', 'B'].map((result) => ({ result }));
    const road = buildBigRoad(hands, 6);
    expect(road[0][0].result).toBe('B');
    expect(road[0][1].result).toBe('B');
    expect(road[1][0].result).toBe('P');
    expect(road[1][0].ties).toBe(1);
    expect(road[1][1].result).toBe('P');
    expect(road[2][0].result).toBe('B');
});

test('stats and bead plate chunking', () => {
    const hands = ['B', 'P', 'T', 'B', 'B', 'P', 'P'].map((result) => ({ result }));
    expect(computeStats(hands)).toMatchObject({ game: 7, B: 3, P: 3, T: 1 });
    const bead = chunkBeadPlate(hands, 6);
    expect(bead).toHaveLength(2);
    expect(bead[1][0].result).toBe('P');
});

test('big road cells remember which hands they hold, ties included', () => {
    const hands = [{ result: 'B', handNo: 1 }, { result: 'T', handNo: 2 }, { result: 'B', handNo: 3 }];
    const road = buildBigRoad(hands, 6);
    expect(road[0][0].handNos).toEqual([1, 2]);
    expect(road[0][1].handNos).toEqual([3]);
});
