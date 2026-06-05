import React, { useEffect, useRef, useState, useMemo } from 'react';
import * as echarts from 'echarts';
import * as d3 from 'd3';
import {
    threshold_dict,
    GAMETYPE_COLORS,
    SCATTER_X_MIN, SCATTER_X_MAX, SCATTER_Y_MIN, SCATTER_Y_MAX,
    SCATTER_SYMBOL_SIZE_MULTIPLIER as SZ,
    SCATTER_GRID,
} from '../../shared/constants/heatmapConstants';

const ScatterHeatmapAvg = React.memo(({ data, selectedKPI, selectedContour, title, visualMapSelected, onVisualMapSelect, onBrushSelected, selectedTables = [], kpiConfigMap: kpiConfigMapOverride }) => {
    const chartRef = useRef(null);
    const [chartInstance, setChartInstance] = useState(null);
    const internalSelectionRef = useRef([]); // To prevent loops

    // KPI → {dim, thresholds} mapping for the Avg view (matches
    // buildAvgScatterData's tuple layout). When the parent passes
    // `kpiConfigMap` it overrides this default — used by the hourly
    // Aggregate view to drive the same renderer with the HOURLY KPI
    // dim layout instead.
    const defaultKpiConfigMap = useMemo(() => ({
        'Drop per open day': { dim: 7, thresholds: threshold_dict['Drop per open day'] },
        'Win per open day': { dim: 8, thresholds: threshold_dict['Win per open day'] },
        'Patron hours per open day': { dim: 9, thresholds: threshold_dict['Patron hours per open day'] },
        'Daily open hours': { dim: 10, thresholds: threshold_dict['Daily open hours'] },
        'Drop per open hour': { dim: 11, thresholds: threshold_dict['Drop per open hour'] },
        'Win per open hour': { dim: 12, thresholds: threshold_dict['Win per open hour'] },
        'Patron hours per open hour': { dim: 13, thresholds: threshold_dict['Patron hours per open hour'] },
        'Table minimum': { dim: 14, thresholds: threshold_dict['Table minimum'] },
        'Avgbet': { dim: 15, thresholds: threshold_dict['Avgbet'] },
        'Drop per floor day': { dim: 17, thresholds: threshold_dict['Drop per floor day'] },
        'Win per floor day': { dim: 18, thresholds: threshold_dict['Win per floor day'] },
        'Patron hours per floor day': { dim: 19, thresholds: threshold_dict['Patron hours per floor day'] },
        'Theo per floor day': { dim: 22, thresholds: threshold_dict['Theo per floor day'] },
        'Theo per open day': { dim: 23, thresholds: threshold_dict['Theo per open day'] },
        'Theo per open hour': { dim: 24, thresholds: threshold_dict['Theo per open hour'] },
        'Hands per hour': { dim: 26, thresholds: threshold_dict['Hands per hour'] },
        'Wagered hands per hour': { dim: 27, thresholds: threshold_dict['Wagered hands per hour'] },
        'Free hands per hour': { dim: 28, thresholds: threshold_dict['Free hands per hour'] },
        'Unused Tables': { dim: 29, thresholds: threshold_dict['Unused Tables'] },
        'Open Percentage': { dim: 30, thresholds: threshold_dict['Open Percentage'] },
        'Active % (Min by Min)': { dim: 20, thresholds: threshold_dict['Active % (Min by Min)'] },
        'Gametype': { dim: 3, isCategorical: true }
    }), []);

    const propsRef = useRef({ data, onBrushSelected, onVisualMapSelect });
    useEffect(() => {
        propsRef.current = { data, onBrushSelected, onVisualMapSelect };
    }, [data, onBrushSelected, onVisualMapSelect]);

    useEffect(() => {
        if (!chartRef.current) return;

        let instance = echarts.getInstanceByDom(chartRef.current);
        if (!instance) {
            instance = echarts.init(chartRef.current, 'dark');
            setChartInstance(instance);
        }

        // Always clear and re-attach listeners to support React HMR
        instance.off('datarangeselected');
        instance.on('datarangeselected', (params) => {
            if (propsRef.current.onVisualMapSelect) {
                propsRef.current.onVisualMapSelect(params.selected);
            }
        });

        // Handle Brush events
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
                        brushed.push(currentData[idx][16]);
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

        // Resolve effective config map: parent override wins, else default.
        // Fallback default KPI also follows the override so an unknown
        // hourly KPI selection picks a sensible hourly default instead
        // of an Avg slot.
        const kpiConfigMap = kpiConfigMapOverride || defaultKpiConfigMap;
        const fallbackKey  = kpiConfigMapOverride
            ? Object.keys(kpiConfigMapOverride)[0]   // first hourly KPI
            : 'Drop per floor day';
        const kpiSettings = kpiConfigMap[selectedKPI] || kpiConfigMap[fallbackKey];

        let visualMap = null;

        if (kpiSettings.isCategorical) {
            // Gametype logic
            const categories = Object.keys(GAMETYPE_COLORS);
            visualMap = {
                type: 'piecewise',
                dimension: kpiSettings.dim,
                categories: categories,
                inRange: {
                    color: categories.map(c => GAMETYPE_COLORS[c] || '#fff')
                },
                left: 20,
                bottom: 20,
                orient: 'vertical',
                itemHeight: 18,
                itemGap: 12,
                textStyle: { color: '#fff', fontSize: 15 },
                selected: visualMapSelected,
                // Disable highlight-on-hover so hovering a legend piece
                // doesn't dispatch a tooltip event with a non-data param.
                // Click-to-toggle filtering still works (selectedMode
                // defaults to 'multiple' for piecewise — kept explicit).
                hoverLink: false,
                selectedMode: 'multiple',
                outOfRange: {
                    color: '#555',
                    opacity: 0.4
                }
            };
        } else if (kpiSettings.thresholds) {
            visualMap = {
                type: 'piecewise',
                dimension: kpiSettings.dim,
                pieces: kpiSettings.thresholds.map(t => ({
                    gte: t.gte,
                    lt: t.lt,
                    color: t.color,
                    label: t.label
                })),
                left: 20,
                bottom: 20,
                orient: 'vertical',
                itemHeight: 18,
                itemGap: 12,
                textStyle: { color: '#fff', fontSize: 15 },
                selected: visualMapSelected,
                // Disable highlight-on-hover so hovering a legend piece
                // doesn't dispatch a tooltip event with a non-data param.
                // Click-to-toggle filtering still works (selectedMode
                // defaults to 'multiple' for piecewise — kept explicit).
                hoverLink: false,
                selectedMode: 'multiple',
                outOfRange: {
                    color: '#555',
                    opacity: 0.4
                }
            };
        }

        const seriesData = [{
            name: 'Tables',
            type: 'scatter',
            data: data,
            symbol: function (value) { 
                return (typeof value[4] === 'string' && value[4].startsWith('path://')) ? value[4] : 'circle'; 
            },
            symbolSize: function (value) { return [value[5] * SZ, value[6] * SZ]; },
            symbolRotate: function (value) { return value[2]; },
            itemStyle: { 
                opacity: function (params) {
                    if (selectedTables.length === 0) return 0.8;
                    const id = String(params.value[16]).trim().toUpperCase();
                    const pitId = ("PIT " + params.value[32]).trim().toUpperCase();
                    const zoneId = ("ZONE " + params.value[31]).trim().toUpperCase();
                    
                    if (selectedTables.includes(id) || selectedTables.includes(pitId) || selectedTables.includes(zoneId)) {
                        return 0.9;
                    }
                    return 0.1;
                },
                borderColor: function (params) {
                    if (selectedTables.length === 0) return 'transparent';
                    const id = String(params.value[16]).trim().toUpperCase();
                    const pitId = ("PIT " + params.value[32]).trim().toUpperCase();
                    const zoneId = ("ZONE " + params.value[31]).trim().toUpperCase();
                    
                    if (selectedTables.includes(id) || selectedTables.includes(pitId) || selectedTables.includes(zoneId)) {
                        return '#fff';
                    }
                    return 'transparent';
                },
                borderWidth: function(params) {
                    if (selectedTables.length === 0) return 0;
                    const id = String(params.value[16]).trim().toUpperCase();
                    const pitId = ("PIT " + params.value[32]).trim().toUpperCase();
                    const zoneId = ("ZONE " + params.value[31]).trim().toUpperCase();
                    
                    if (selectedTables.includes(id) || selectedTables.includes(pitId) || selectedTables.includes(zoneId)) {
                        return 1;
                    }
                    return 0;
                }
            }
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
                            value: ['Patron hours per open hour', 'Patron hours per open day', 'Patron hours per floor day'].includes(selectedContour) ? d[contourDim] * 1000 : d[contourDim]
                        })).filter(d => d.value !== -1000000 && d.value !== -999999); // filter out placeholders

                        if (points.length === 0) return null;

                        const contours = d3.contourDensity()
                            .x(p => p.coord[0])
                            .y(p => p.coord[1])
                            .weight(p => p.value)
                            .size([params.coordSys.width, params.coordSys.height])
                            .bandwidth(15)
                            .thresholds(20)(points);

                        const paths = contours.map(d3.geoPath());
                        const colorScale = d3.scaleSequential(d3.interpolateTurbo)
                            .domain([0, paths.length - 1]);

                        return {
                            type: 'group',
                            children: paths.map((path, i) => ({
                                type: 'path',
                                shape: { pathData: path },
                                style: {
                                    fill: colorScale(i),
                                    stroke: '#0000007a',
                                    lineWidth: 0.5,
                                    opacity: 0.8,
                                }
                            }))
                        };
                    },
                    data: [0] // ECharts requires at least one data point to trigger renderItem
                });
            }
        }

        const option = {
            backgroundColor: 'transparent',
            animation: false,
            title: {
                text: title,
                textStyle: { color: '#ccc', fontSize: 20, fontWeight: 600 },
                left: 20,
                top: 20
            },
            grid: SCATTER_GRID,
            toolbox: {
                feature: {
                    brush: {
                        type: ['rect', 'polygon', 'clear']
                    }
                },
                top: 20,
                right: 20,
                iconStyle: { borderColor: '#7aa2f7' }
            },
            brush: {
                xAxisIndex: 'all',
                brushLink: 'all',
                outOfRange: {
                    colorAlpha: 0.1
                },
                seriesIndex: [0] // Only target the Tables series
            },
            tooltip: {
                trigger: 'item',
                backgroundColor: 'rgba(23, 25, 40, 0.95)',
                borderColor: 'rgba(122, 162, 247, 0.4)',
                borderWidth: 1,
                padding: [10, 15],
                textStyle: { color: '#fff', fontSize: 16 },
                formatter: function (params) {
                    if (params.seriesType === 'custom') return '';
                    // Guard: visualMap hoverLink can fire the formatter
                    // with a param whose `value` isn't a data row. Bail
                    // cleanly instead of throwing on d[16].
                    const d = params && params.value;
                    if (!Array.isArray(d)) return '';
                    const label = d[16];
                    const game = d[3];
                    const area = d[34] || '-';
                    const pit = d[32] || '-';
                    const zone = d[31] || '-';

                    const formatVal = (val) => (val === -1000000 || val === -999999) ? 'Closed' :
                        typeof val === 'number' ? val.toLocaleString(undefined, { maximumFractionDigits: 1 }) : val;
                    const formatPct = (val) => (val === -1000000 || val === -999999) ? 'Closed' :
                        typeof val === 'number' ? val.toFixed(1) + '%' : val;

                    // When an external kpiConfigMap is passed (Aggregate-
                    // hourly mode), the scatter tuple is populated at
                    // HOURLY_KPI_REGISTRY dims, NOT the Avg dims. Show
                    // hourly-appropriate rows so the tooltip reads sensible
                    // values instead of "Closed" everywhere.
                    const isHourlyAggregate = !!kpiConfigMapOverride;

                    const metricRows = isHourlyAggregate
                        ? `
                            <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
                                <span>Patron Hours:</span>
                                <span style="color: #f7768e; font-weight: bold;">${formatVal(d[9])}</span>
                            </div>
                            <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
                                <span>Turnover per Hour:</span>
                                <span style="color: #bb9af7; font-weight: bold;">${formatVal(d[11])}</span>
                            </div>
                            <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
                                <span>Win per Hour:</span>
                                <span style="color: #9ece6a; font-weight: bold;">${formatVal(d[12])}</span>
                            </div>
                            <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
                                <span>Theo per Hour:</span>
                                <span style="color: #7dcfff; font-weight: bold;">${formatVal(d[24])}</span>
                            </div>
                            <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
                                <span>Hands per Hour:</span>
                                <span style="color: #c084fc; font-weight: bold;">${formatVal(d[26])}</span>
                            </div>
                            <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
                                <span>Avg Bet:</span>
                                <span style="color: #f59e0b; font-weight: bold;">${formatVal(d[15])}</span>
                            </div>
                            <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
                                <span>Occupancy:</span>
                                <span style="color: #10b981; font-weight: bold;">${formatPct(d[7])}</span>
                            </div>
                            <div style="display: flex; justify-content: space-between;">
                                <span>Table Minimum:</span>
                                <span style="color: #e0af68; font-weight: bold;">${formatVal(d[14])}</span>
                            </div>
                        `
                        : `
                            <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
                                <span>Drop per Floorday:</span>
                                <span style="color: #bb9af7; font-weight: bold;">${formatVal(d[17])}</span>
                            </div>
                            <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
                                <span>Win per Floorday:</span>
                                <span style="color: #9ece6a; font-weight: bold;">${formatVal(d[18])}</span>
                            </div>
                            <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
                                <span>Patron Hours per Open Hour:</span>
                                <span style="color: #f7768e; font-weight: bold;">${formatVal(d[13])}</span>
                            </div>
                            <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
                                <span>Theo per Floorday:</span>
                                <span style="color: #7dcfff; font-weight: bold;">${formatVal(d[22])}</span>
                            </div>
                            <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
                                <span>Theo per Open Hour:</span>
                                <span style="color: #7dcfff; font-weight: bold;">${formatVal(d[24])}</span>
                            </div>
                            <div style="display: flex; justify-content: space-between;">
                                <span>Table Minimum:</span>
                                <span style="color: #e0af68; font-weight: bold;">${formatVal(d[14])}</span>
                            </div>
                        `;

                    return `
                        <div style="min-width: 360px;">
                            <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 5px; margin-bottom: 8px;">
                                <span style="font-weight: bold; font-size: 18px; color: #7aa2f7;">${label}</span>
                                <span style="font-size: 13px; background: rgba(255,255,255,0.1); padding: 2px 6px; borderRadius: 4px;">${game}</span>
                            </div>
                            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; font-size: 14px; color: rgba(255,255,255,0.6);">
                                <div>Area: <span style="color: #fff;">${area}</span></div>
                                <div>Pit: <span style="color: #fff;">${pit}</span></div>
                                <div>Zone: <span style="color: #fff;">${zone}</span></div>
                                <div>Open: <span style="color: #fff;">${(d[30] * 100).toFixed(0)}%</span></div>
                            </div>
                            <div style="margin-top: 10px; padding-top: 8px; border-top: 1px solid rgba(255,255,255,0.1);">
                                ${metricRows}
                            </div>
                            <div style="margin-top: 8px; font-size: 13px; color: #7aa2f7; text-align: center; border-top: 1px dashed rgba(122, 162, 247, 0.2); padding-top: 4px;">
                                Current View: ${selectedKPI}
                            </div>
                        </div>
                    `;
                }
            },
            xAxis: {
                type: 'value',
                show: false,
                min: SCATTER_X_MIN,
                max: SCATTER_X_MAX
            },
            yAxis: {
                type: 'value',
                show: false,
                min: SCATTER_Y_MIN,
                max: SCATTER_Y_MAX,
                inverse: false
            },
            visualMap: visualMap,
            series: seriesData
        };

        // Important: use notMerge: true to completely replace the previous configuration
        // This prevents errors when switching between different chart structures (e.g. Play vs Avg)
        chartInstance.setOption(option, true);

        // Add resize listener
        const resizeObserver = new ResizeObserver(() => {
            requestAnimationFrame(() => {
                if (chartInstance) chartInstance.resize();
            });
        });
        resizeObserver.observe(chartRef.current);

        return () => {
            resizeObserver.disconnect();
        };

    }, [chartInstance, data, selectedKPI, selectedContour, title, defaultKpiConfigMap, kpiConfigMapOverride, visualMapSelected]);

    // Separate Effect for Selection Highlighting to avoid full chart re-renders
    useEffect(() => {
        if (!chartInstance || !data || data.length === 0) return;

        // Skip update if this selection was initiated by our own brush
        const isSame = selectedTables.length === internalSelectionRef.current.length &&
                       selectedTables.every((v, i) => v === internalSelectionRef.current[i]);
        if (isSame) return;

        internalSelectionRef.current = selectedTables;

        chartInstance.setOption({
            series: [{
                name: 'Tables',
                data: data.map(d => {
                    const id = String(d[16]).trim().toUpperCase();
                    const pitId = ("PIT " + d[32]).trim().toUpperCase();
                    const zoneId = ("ZONE " + d[31]).trim().toUpperCase();
                    
                    const isDefault = selectedTables.length === 0;
                    const isSelected = !isDefault && (selectedTables.includes(id) || selectedTables.includes(pitId) || selectedTables.includes(zoneId));

                    return {
                        value: d,
                        itemStyle: {
                            opacity: isDefault ? 0.8 : (isSelected ? 0.9 : 0.1),
                            borderColor: isDefault ? 'transparent' : (isSelected ? '#fff' : 'transparent'),
                            borderWidth: isDefault ? 0 : (isSelected ? 1 : 0)
                        }
                    };
                })
            }]
        }, false);

        if (selectedTables.length === 0) {
            chartInstance.dispatchAction({ type: 'brush', command: 'clear', areas: [] });
        }
    }, [chartInstance, selectedTables, data]);

    return (
        <div style={{ position: 'relative', width: '100%', height: '100%' }}>
            <div ref={chartRef} style={{ width: '100%', height: '100%' }} />
            {selectedTables.length > 0 && (
                <div
                    style={{
                        position: 'absolute',
                        left: 20,
                        top: 56,
                        fontSize: 14,
                        background: '#7aa2f7',
                        color: '#000',
                        padding: '4px 10px',
                        borderRadius: 4,
                        fontWeight: 'bold',
                        pointerEvents: 'none',
                        boxShadow: '0 2px 8px rgba(0,0,0,0.4)',
                    }}
                >
                    {selectedTables.length} Tables Selected
                </div>
            )}
        </div>
    );
});

export default ScatterHeatmapAvg;
