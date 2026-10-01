import React, { useEffect, useRef, useState } from 'react';
import * as echarts from 'echarts';
import * as d3 from 'd3';
import { thresholdsFor, GAMETYPE_COLORS } from '../vendor/heatmapConstants';
import {
    HOTEL_FLOOR_X_MIN, HOTEL_FLOOR_X_MAX, HOTEL_FLOOR_Y_MIN, HOTEL_FLOOR_Y_MAX,
    HOTEL_SYMBOL_SIZE as SZ, HOTEL_SCATTER_GRID_DEFAULT, HOTEL_SCATTER_FONT as SF,
    HOTEL_KPI_OPTIONS, KPI_DIM_MAP, PERCENT_KPIS,
} from '../constants/hotelConfig';

// Definitive out-of-range fill — sentinel values (-999999, -1000000)
// that fall below every threshold piece render with this color so
// "no data" tables read as clearly distinct from the lowest valid
// bucket (which is often a dark blue and was being confused with
// "empty"). Centralised so the choice stays consistent across views.
const OUT_OF_RANGE_FILL = { color: '#3a3a3a', opacity: 0.35 };

// Hotel's own tuple layout (see hotelData.js buildHotelScatterData):
//   0 x, 1 y, 2 rotation, 3 game, 4 symbolPath, 5 sizeX, 6 sizeY,
//   7-21 the 15 KPIs, 22 tableID, 23 pit, 24 zone, 25 area.
const DIM_TABLE_ID = 22, DIM_PIT = 23, DIM_ZONE = 24, DIM_AREA = 25;

// A vendored, hotel-only copy of the small-multiples scatter renderer —
// NOT shared with the Performance/Pricing/Live dashboards, so its KPI
// list, dim layout, and tooltip content can change freely without
// touching (or being touched by) any other dashboard. `kpiConfigMap` is
// REQUIRED (no Performance-specific fallback map) — HotelDashboard always
// builds one from KPI_DIM_MAP + HOTEL_THRESHOLDS.
const HtScatterHeatmapAvg = React.memo(({
    data, selectedKPI, selectedContour, title, visualMapSelected,
    selectedTables = [], selectedArea = [], kpiConfigMap, hideVisualMap = false, gridOverride = null,
    hideTooltip = false, hideBrush = false,
    xMin, xMax, yMin, yMax, symbolSizeMultiplier,
    onBrushSelected,
}) => {
    const chartRef = useRef(null);
    const [chartInstance, setChartInstance] = useState(null);
    const internalSelectionRef = useRef([]); // To prevent loops

    const propsRef = useRef({ data, onBrushSelected });
    useEffect(() => {
        propsRef.current = { data, onBrushSelected };
    }, [data, onBrushSelected]);

    useEffect(() => {
        if (!chartRef.current) return;

        let instance = echarts.getInstanceByDom(chartRef.current);
        if (!instance) {
            instance = echarts.init(chartRef.current, 'dark');
            setChartInstance(instance);
        }

        // Handle Brush events — re-attached on every mount to support HMR.
        instance.off('brushselected');
        instance.on('brushselected', (params) => {
            const brushed = [];
            if (!params.batch || !params.batch[0]) return;

            const brushBatch = params.batch[0];
            const scatterSelection = brushBatch.selected.find(s => s.seriesIndex === 0) || brushBatch.selected[0];

            if (scatterSelection && scatterSelection.dataIndex) {
                const currentData = propsRef.current.data || [];
                scatterSelection.dataIndex.forEach(idx => {
                    if (currentData[idx]) {
                        brushed.push(currentData[idx][DIM_TABLE_ID]);
                    }
                });
            }

            const isSame = brushed.length === internalSelectionRef.current.length &&
                           brushed.every((v, i) => v === internalSelectionRef.current[i]);

            if (!isSame && propsRef.current.onBrushSelected) {
                propsRef.current.onBrushSelected(brushed);
            }
        });

        const handleResize = () => instance.resize();
        window.addEventListener('resize', handleResize);

        return () => {
            window.removeEventListener('resize', handleResize);
            instance.dispose();
        };
    }, []);

    useEffect(() => {
        if (!chartInstance || !data || data.length === 0) return;

        // Effective axis bounds + symbol scale — caller overrides win,
        // else the hotelConfig defaults.
        const effXMin = xMin ?? HOTEL_FLOOR_X_MIN;
        const effXMax = xMax ?? HOTEL_FLOOR_X_MAX;
        const effYMin = yMin ?? HOTEL_FLOOR_Y_MIN;
        const effYMax = yMax ?? HOTEL_FLOOR_Y_MAX;
        const effSZ = symbolSizeMultiplier ?? SZ;

        const kpiSettings = kpiConfigMap[selectedKPI] || kpiConfigMap[Object.keys(kpiConfigMap)[0]];
        // Per-area threshold override — Hotel doesn't register any (its
        // areas are config_cod.json Location codes, not MS/PM), so this
        // always falls through to kpiSettings.thresholds. Kept only so a
        // future per-area ramp could be added the same way other
        // dashboards do, without touching this component.
        const areaScopedThresholds = thresholdsFor(selectedKPI, selectedArea);
        const effectiveThresholds = areaScopedThresholds || kpiSettings.thresholds;

        let visualMap = null;
        if (kpiSettings.isCategorical) {
            const categories = Object.keys(GAMETYPE_COLORS);
            visualMap = {
                type: 'piecewise',
                dimension: kpiSettings.dim,
                categories: categories,
                inRange: { color: categories.map(c => GAMETYPE_COLORS[c] || '#fff') },
                left: 20, bottom: 20, orient: 'vertical', itemHeight: 18, itemGap: 12,
                textStyle: { color: '#fff', fontSize: SF.visualMap },
                selected: visualMapSelected,
                hoverLink: false, selectedMode: 'multiple',
                outOfRange: OUT_OF_RANGE_FILL,
            };
        } else if (effectiveThresholds) {
            visualMap = {
                type: 'piecewise',
                dimension: kpiSettings.dim,
                pieces: effectiveThresholds.map(t => ({ gte: t.gte, lt: t.lt, color: t.color, label: t.label })),
                left: 20, bottom: 20, orient: 'vertical', itemHeight: 18, itemGap: 12,
                textStyle: { color: '#fff', fontSize: SF.visualMap },
                selected: visualMapSelected,
                hoverLink: false, selectedMode: 'multiple',
                // Sentinel placeholders (-999999 / -1000000) fall below the
                // lowest piece's `gte: 0` and land here — explicit dim-grey
                // so "no data" reads as muted rather than the lowest bucket.
                outOfRange: OUT_OF_RANGE_FILL,
            };
        }

        const seriesData = [{
            name: 'Tables',
            type: 'scatter',
            data: data,
            symbol: function (value) {
                return (typeof value[4] === 'string' && value[4].startsWith('path://')) ? value[4] : 'circle';
            },
            symbolSize: function (value) { return [value[5] * effSZ, value[6] * effSZ]; },
            symbolRotate: function (value) { return value[2]; },
            itemStyle: {
                opacity: function (params) {
                    if (selectedTables.length === 0) return 0.8;
                    const id = String(params.value[DIM_TABLE_ID]).trim().toUpperCase();
                    const pitId = ('PIT ' + params.value[DIM_PIT]).trim().toUpperCase();
                    const zoneId = ('ZONE ' + params.value[DIM_ZONE]).trim().toUpperCase();
                    if (selectedTables.includes(id) || selectedTables.includes(pitId) || selectedTables.includes(zoneId)) return 0.9;
                    return 0.1;
                },
                borderColor: function (params) {
                    if (selectedTables.length === 0) return 'transparent';
                    const id = String(params.value[DIM_TABLE_ID]).trim().toUpperCase();
                    const pitId = ('PIT ' + params.value[DIM_PIT]).trim().toUpperCase();
                    const zoneId = ('ZONE ' + params.value[DIM_ZONE]).trim().toUpperCase();
                    if (selectedTables.includes(id) || selectedTables.includes(pitId) || selectedTables.includes(zoneId)) return '#fff';
                    return 'transparent';
                },
                borderWidth: function (params) {
                    if (selectedTables.length === 0) return 0;
                    const id = String(params.value[DIM_TABLE_ID]).trim().toUpperCase();
                    const pitId = ('PIT ' + params.value[DIM_PIT]).trim().toUpperCase();
                    const zoneId = ('ZONE ' + params.value[DIM_ZONE]).trim().toUpperCase();
                    if (selectedTables.includes(id) || selectedTables.includes(pitId) || selectedTables.includes(zoneId)) return 1;
                    return 0;
                },
            },
        }];

        if (selectedContour && selectedContour !== 'None') {
            const contourConfig = kpiConfigMap[selectedContour];
            if (contourConfig) {
                const contourDim = contourConfig.dim;
                seriesData.push({
                    type: 'custom',
                    renderItem: (params, api) => {
                        const points = data.map(d => ({
                            coord: api.coord([d[0], d[1]]),
                            value: d[contourDim],
                        })).filter(d => d.value !== -1000000 && d.value !== -999999);

                        if (points.length === 0) return null;

                        const contours = d3.contourDensity()
                            .x(p => p.coord[0])
                            .y(p => p.coord[1])
                            .weight(p => p.value)
                            .size([params.coordSys.width, params.coordSys.height])
                            .bandwidth(15)
                            .thresholds(20)(points);

                        const paths = contours.map(d3.geoPath());
                        const colorScale = d3.scaleSequential(d3.interpolateTurbo).domain([0, paths.length - 1]);

                        return {
                            type: 'group',
                            children: paths.map((path, i) => ({
                                type: 'path',
                                shape: { pathData: path },
                                style: { fill: colorScale(i), stroke: '#0000007a', lineWidth: 0.5, opacity: 0.8 },
                            })),
                        };
                    },
                    data: [0], // ECharts requires at least one data point to trigger renderItem
                });
            }
        }

        const option = {
            backgroundColor: 'transparent',
            animation: false,
            title: {
                text: title,
                textStyle: { color: '#ccc', fontSize: SF.titleAvg, fontWeight: 600 },
                left: 20, top: 20,
            },
            grid: HOTEL_SCATTER_GRID_DEFAULT,
            toolbox: {
                feature: { brush: { type: ['rect', 'polygon', 'clear'] } },
                top: 20, right: 20, iconStyle: { borderColor: '#7aa2f7' },
            },
            brush: {
                xAxisIndex: 'all', brushLink: 'all',
                outOfRange: { colorAlpha: 0.1 },
                seriesIndex: [0],
            },
            tooltip: {
                trigger: 'item',
                backgroundColor: 'rgba(23, 25, 40, 0.95)',
                borderColor: 'rgba(122, 162, 247, 0.4)',
                borderWidth: 1,
                padding: [10, 15],
                textStyle: { color: '#fff', fontSize: SF.tooltip },
                formatter: function (params) {
                    if (params.seriesType === 'custom') return '';
                    const d = params && params.value;
                    if (!Array.isArray(d)) return '';
                    const label = d[DIM_TABLE_ID];
                    const pit = d[DIM_PIT] || '-';
                    const zone = d[DIM_ZONE] || '-';
                    const area = d[DIM_AREA] || '-';

                    const formatVal = (val) => {
                        if (val === -1000000 || val === -999999) return 'No data';
                        if (typeof val !== 'number' || !Number.isFinite(val)) return val ?? '–';
                        const abs = Math.abs(val);
                        if (abs >= 10000) return `${(val / 1000).toFixed(0)}k`;
                        if (abs >= 1000) return `${(val / 1000).toFixed(1)}k`;
                        return val.toLocaleString(undefined, { maximumFractionDigits: 1 });
                    };
                    const formatPct = (val) => (val === -1000000 || val === -999999) ? 'No data' :
                        typeof val === 'number' ? val.toFixed(1) + '%' : val;

                    // Every Hotel KPI, generically — single source of truth
                    // stays HOTEL_KPI_OPTIONS/KPI_DIM_MAP (hotelConfig.js),
                    // nothing hardcoded here.
                    const metricRows = HOTEL_KPI_OPTIONS.map((kpi) => {
                        const val = d[KPI_DIM_MAP[kpi]];
                        const formatted = PERCENT_KPIS.has(kpi) ? formatPct(val) : formatVal(val);
                        const isSelected = kpi === selectedKPI;
                        return `<div style="display:flex;justify-content:space-between;margin-bottom:4px;">
                            <span style="color:${isSelected ? '#7aa2f7' : 'rgba(255,255,255,0.65)'};font-weight:${isSelected ? 'bold' : 'normal'};">${kpi}:</span>
                            <span style="font-weight:bold;color:${isSelected ? '#9ece6a' : '#fff'};">${formatted}</span>
                        </div>`;
                    }).join('');

                    return `
                        <div style="min-width: 260px;">
                            <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 5px; margin-bottom: 8px;">
                                <span style="font-weight: bold; font-size: 18px; color: #7aa2f7;">${label}</span>
                                <span style="font-size: 12px; color: rgba(255,255,255,0.5);">${area} · Pit ${pit} · ${zone}</span>
                            </div>
                            ${metricRows}
                        </div>
                    `;
                },
            },
            xAxis: { type: 'value', show: false, min: effXMin, max: effXMax },
            yAxis: { type: 'value', show: false, min: effYMin, max: effYMax, inverse: false },
            // `hideVisualMap` — Hotel renders ONE shared legend instead of
            // six per-chart legends, so the per-chart visualMap is created
            // (colors still apply) but its legend UI is hidden.
            visualMap: visualMap ? { ...visualMap, show: hideVisualMap ? false : (visualMap.show !== false) } : visualMap,
            series: seriesData,
        };
        // gridOverride merges over HOTEL_SCATTER_GRID_DEFAULT.
        if (gridOverride) option.grid = { ...option.grid, ...gridOverride };

        // `hideTooltip` / `hideBrush` — omit both entirely rather than
        // just hiding, so no dead UI/interaction remains.
        if (hideTooltip) option.tooltip = { show: false };
        if (hideBrush) { delete option.toolbox; delete option.brush; }

        // notMerge: true fully replaces the previous configuration so
        // switching KPI/showType doesn't leave stale series/visualMap state.
        chartInstance.setOption(option, true);

        const resizeObserver = new ResizeObserver(() => {
            requestAnimationFrame(() => { if (chartInstance) chartInstance.resize(); });
        });
        resizeObserver.observe(chartRef.current);

        return () => { resizeObserver.disconnect(); };

    }, [chartInstance, data, selectedKPI, selectedContour, title, kpiConfigMap, visualMapSelected,
        hideVisualMap, gridOverride, hideTooltip, hideBrush, xMin, xMax, yMin, yMax, symbolSizeMultiplier, selectedTables, selectedArea]);

    // Separate effect for selection highlighting to avoid full chart re-renders.
    useEffect(() => {
        if (!chartInstance || !data || data.length === 0) return;

        const isSame = selectedTables.length === internalSelectionRef.current.length &&
                       selectedTables.every((v, i) => v === internalSelectionRef.current[i]);
        if (isSame) return;

        internalSelectionRef.current = selectedTables;

        chartInstance.setOption({
            series: [{
                name: 'Tables',
                data: data.map(d => {
                    const id = String(d[DIM_TABLE_ID]).trim().toUpperCase();
                    const pitId = ('PIT ' + d[DIM_PIT]).trim().toUpperCase();
                    const zoneId = ('ZONE ' + d[DIM_ZONE]).trim().toUpperCase();

                    const isDefault = selectedTables.length === 0;
                    const isSelected = !isDefault && (selectedTables.includes(id) || selectedTables.includes(pitId) || selectedTables.includes(zoneId));

                    return {
                        value: d,
                        itemStyle: {
                            opacity: isDefault ? 0.8 : (isSelected ? 0.9 : 0.1),
                            borderColor: isDefault ? 'transparent' : (isSelected ? '#fff' : 'transparent'),
                            borderWidth: isDefault ? 0 : (isSelected ? 1 : 0),
                        },
                    };
                }),
            }],
        }, false);

        if (selectedTables.length === 0) {
            chartInstance.dispatchAction({ type: 'brush', command: 'clear', areas: [] });
        }
    }, [chartInstance, selectedTables, data]);

    return (
        <div style={{ position: 'relative', width: '100%', height: '100%' }}>
            <div ref={chartRef} style={{ width: '100%', height: '100%' }} />
            {selectedTables.length > 0 && (
                <div style={{
                    position: 'absolute', left: 20, top: 56, fontSize: 14,
                    background: '#7aa2f7', color: '#000', padding: '4px 10px', borderRadius: 4,
                    fontWeight: 'bold', pointerEvents: 'none', boxShadow: '0 2px 8px rgba(0,0,0,0.4)',
                }}>
                    {selectedTables.length} Tables Selected
                </div>
            )}
        </div>
    );
});

export default HtScatterHeatmapAvg;
