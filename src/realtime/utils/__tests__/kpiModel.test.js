import { kpiKeyFor, RT_METRICS, RT_SCOPES, RT_KPI_DIMS, HOUSE_EDGE_OPTIONS } from '../../constants/rtConfig';
import { threshold_dict } from '../../vendor/heatmapConstants';
import { buildAvgScatterData } from '../../vendor/dataProcessing';

test('every metric × scope resolves to a key with a dim and a ramp', () => {
    for (const m of RT_METRICS) {
        for (const s of RT_SCOPES) {
            const key = kpiKeyFor(m.id, s.id);
            expect(threshold_dict[key]).toBeDefined();
            // House edge has no single dim — it is resolved per bet option.
            const resolvable = key === 'Actual House Edge' ? HOUSE_EDGE_OPTIONS.length > 0 : RT_KPI_DIMS[key] != null;
            expect(resolvable).toBe(true);
        }
    }
});

test('win and hand # switch keys by scope', () => {
    expect(kpiKeyFor('win', 'day')).toBe('Win (Total)');
    expect(kpiKeyFor('win', 'shoe')).toBe('Shoe Win');
    expect(kpiKeyFor('hands', 'day')).toBe('Hands Today');
    expect(kpiKeyFor('hands', 'shoe')).toBe('Shoe Hands');
    expect(kpiKeyFor('edge', 'shoe')).toBe('Actual House Edge');
});

test('tuple carries hands today at 65 and the config gametype at 66', () => {
    const config = [{ table: '10065', game: 'BA', x: 1, y: 1, rotation: 0, pit: '883', zone: 'Z1' }];
    const rows = [{ gametype: 'BA', table: '10065', pit: '883', area: 'Main', sub_segment: 'Main', hands: 42, is_open: true, openhours: 3, win: 1, theo: 1, turnover: 10, tablemin: '1000' }];
    const [t] = buildAvgScatterData(rows, config, 'Table', [], ['BA'], '', '');
    expect(t[65]).toBe(42);
    expect(t[66]).toBe('BA');
});
