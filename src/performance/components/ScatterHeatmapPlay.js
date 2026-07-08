import React, { useEffect, useRef, useState, useMemo } from 'react';
import * as echarts from 'echarts';
import {
    threshold_dict,
    SCATTER_X_MIN, SCATTER_X_MAX, SCATTER_Y_MIN, SCATTER_Y_MAX,
    SCATTER_SYMBOL_SIZE_MULTIPLIER as SZ,
    SCATTER_GRID,
    kpiDisplayLabel,
} from '../../shared/constants/heatmapConstants';
import { HOURLY_KPI_REGISTRY } from '../utils/dataProcessingHourly';
import { PERF_FONTS } from '../constants/fontSizes';
const SF = PERF_FONTS.scatter;

const ScatterHeatmapPlay = React.memo(({ dataForScatter, hourList, selectedKPI, visualMapSelected, onVisualMapSelect, onTimelineChange, onBrushSelected, selectedTables = [], isSingleDay = false, dateLabel = '' }) => {
    const chartRef = useRef(null);
    const [chartInstance, setChartInstance] = useState(null);
    const internalSelectionRef = useRef([]); // To prevent loops

    // KPI → {dim, thresholds} derived from the single source of truth
    // HOURLY_KPI_REGISTRY, so the dropdown, the builder, and this map
    // can never drift. Adding a 24-hr KPI in the registry surfaces it
    // here automatically.
    //
    // Single-day override: the "Actual vs Spread" KPI swaps in the
    // 4-state binary-truth-table ramp (Open / Over / Under / Close
    // as Spread) when only one day is in scope. The dim slot is
    // unchanged — only the threshold ramp differs — so the rest of
    // the rendering path stays oblivious.
    const kpiConfigMap = useMemo(() => {
        const m = {};
        for (const k of Object.values(HOURLY_KPI_REGISTRY)) {
            m[k.label] = { dim: k.dim, thresholds: threshold_dict[k.thresholdKey] };
        }
        if (isSingleDay && m['Actual vs Spread']) {
            m['Actual vs Spread'] = {
                ...m['Actual vs Spread'],
                thresholds: threshold_dict['Actual vs Spread (Single Day)_hourly'],
            };
        }
        m.default = m['Patron Hours per table'];
        return m;
    }, [isSingleDay]);

    const propsRef = useRef({ dataForScatter, hourList, onBrushSelected, onVisualMapSelect, onTimelineChange, visualMapSelected });
    useEffect(() => {
        propsRef.current = { dataForScatter, hourList, onBrushSelected, onVisualMapSelect, onTimelineChange, visualMapSelected };
    }, [dataForScatter, hourList, onBrushSelected, onVisualMapSelect, onTimelineChange, visualMapSelected]);

    useEffect(() => {
        if (!chartRef.current) return;
        
        let instance = echarts.getInstanceByDom(chartRef.current);
        if (!instance) {
            instance = echarts.init(chartRef.current, 'dark');
            setChartInstance(instance);
        }

        // Always clear and re-attach listeners to support React HMR.
        // Each handler is wrapped in try/catch + null-guards so a stray
        // internal ECharts dispatch (e.g. auto-clear during timeline tick)
        // can't bring down the entire page.
        instance.off('timelinechanged');
        instance.on('timelinechanged', (params) => {
            try {
                const p = propsRef.current;
                if (p && typeof p.onTimelineChange === 'function' && params) {
                    p.onTimelineChange(params.currentIndex);
                }
                // Timeline ticks are an ECharts-internal event — they
                // don't trigger a React re-render, so the post-setOption
                // dispatch below doesn't fire. Re-apply the visualMap
                // selection on every tick so legend-filter selections
                // persist across frame changes (without this, advancing
                // by one hour resets the selection and all greyed-out
                // tables snap back to colored).
                if (p && p.visualMapSelected && typeof p.visualMapSelected === 'object') {
                    instance.dispatchAction({
                        type: 'selectDataRange',
                        selected: p.visualMapSelected,
                    });
                }
            } catch (e) {
                console.warn('[ScatterHeatmapPlay] timelinechanged handler error:', e);
            }
        });

        // Sync visualMap selection back to parent
        instance.off('datarangeselected');
        instance.on('datarangeselected', (params) => {
            try {
                const p = propsRef.current;
                if (p && typeof p.onVisualMapSelect === 'function' && params) {
                    p.onVisualMapSelect(params.selected);
                }
            } catch (e) {
                console.warn('[ScatterHeatmapPlay] datarangeselected handler error:', e);
            }
        });

        // Handle Brush events
        instance.off('brushselected');
        instance.on('brushselected', (params) => {
            try {
                if (!params || !Array.isArray(params.batch) || !params.batch[0]) return;
                const brushBatch = params.batch[0];
                const selected = Array.isArray(brushBatch.selected) ? brushBatch.selected : [];
                const scatterSelection =
                    selected.find((s) => s && s.seriesIndex === 0) || selected[0];

                const brushed = [];
                if (scatterSelection && Array.isArray(scatterSelection.dataIndex)) {
                    const p = propsRef.current || {};
                    const currentData = Array.isArray(p.dataForScatter) ? p.dataForScatter : [];
                    const opt = instance.getOption();
                    const tlIdx =
                        opt && Array.isArray(opt.timeline) && opt.timeline[0]
                            ? opt.timeline[0].currentIndex || 0
                            : 0;

                    // dataForScatter rows are nested arrays — table_label
                    // lives at index 16 (either a scalar or per-hour array).
                    scatterSelection.dataIndex.forEach((idx) => {
                        const row = currentData[idx];
                        if (!row) return;
                        const cell = row[16];
                        const label = Array.isArray(cell) ? cell[tlIdx] : cell;
                        if (label !== undefined && label !== null) brushed.push(label);
                    });
                }

                const prev = internalSelectionRef.current || [];
                const isSame =
                    brushed.length === prev.length &&
                    brushed.every((v, i) => v === prev[i]);

                if (!isSame) {
                    const p = propsRef.current;
                    if (p && typeof p.onBrushSelected === 'function') {
                        p.onBrushSelected(brushed);
                    }
                }
            } catch (e) {
                console.warn('[ScatterHeatmapPlay] brushselected handler error:', e);
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
        if (!chartInstance || !dataForScatter || dataForScatter.length === 0) return;

        const kpiSettings = kpiConfigMap[selectedKPI] || kpiConfigMap['default'];
        const targetDim = kpiSettings.dim;

        // Preserve the timeline's current playback position across KPI
        // switches — without this, the notMerge setOption() below rebuilds
        // the timeline and resets to index 0 (the first hour). getOption()
        // reports the live currentIndex even mid-playback, so reading it
        // before setOption and injecting it back into baseOption.timeline
        // lets the user resume at the hour they were watching.
        let preservedTimelineIdx = 0;
        try {
            const prevOpt = chartInstance.getOption();
            if (prevOpt && Array.isArray(prevOpt.timeline) && prevOpt.timeline[0]
                && typeof prevOpt.timeline[0].currentIndex === 'number') {
                const idx = prevOpt.timeline[0].currentIndex;
                if (idx >= 0 && idx < hourList.length) preservedTimelineIdx = idx;
            }
        } catch (e) {
            // First render or option not yet set — fall back to 0.
        }

        // Build base option
        const baseOption = {
            backgroundColor: 'transparent',
            animation: false,
            timeline: {
                // VERTICAL scrubber pinned to the RIGHT of the scatter.
                // `inverse` makes it read top→bottom (first hour at the
                // top). All 24 hour labels are shown (interval: 0). Only
                // the CURRENT hour carries a marker bubble — normal ticks
                // and already-played ticks render with no symbol, so the
                // single checkpoint dot clearly tracks playback.
                orient: 'vertical',
                inverse: true,
                axisType: 'category',
                autoPlay: true,
                currentIndex: preservedTimelineIdx,
                playInterval: 1000,
                data: hourList.map(h => `${String(h).padStart(2, '0')}:00`),
                right: 14,
                top: 26,
                bottom: 26,
                // Wider box (right edge fixed) so the axis line sits
                // further right and the labels render further LEFT.
                width: 80,
                label: {
                    show: true,
                    interval: 0,                 // show every hour label
                    position: 'left',
                    formatter: (s) => s,
                    fontSize: SF.timeline,
                    fontWeight: 600,
                    color: 'rgba(255,255,255,0.7)',
                },
                // No bubble on the regular ticks…
                symbol: 'none',
                lineStyle: { color: 'rgba(255,255,255,0.18)', width: 2 },
                // …the only bubble is the current-hour checkpoint.
                checkpointStyle: {
                    symbol: 'circle',
                    symbolSize: 18,
                    color: '#7aa2f7',
                    borderColor: '#fff',
                    borderWidth: 2,
                    shadowBlur: 8,
                    shadowColor: 'rgba(122, 162, 247, 0.6)',
                },
                controlStyle: {
                    // Bigger play / pause / step buttons.
                    itemSize: 34,
                    itemGap: 10,
                    color: '#7aa2f7',
                    borderColor: '#7aa2f7',
                },
                progress: {
                    lineStyle: { color: 'rgba(122, 162, 247, 0.55)', width: 3 },
                    // Played ticks also get no bubble — keep them clean.
                    itemStyle: { color: 'transparent', borderColor: 'transparent' },
                    label: {
                        show: true, interval: 0,
                        fontSize: SF.timeline, fontWeight: 600, color: 'rgba(255,255,255,0.7)',
                    },
                },
                emphasis: {
                    label: { color: '#fff', fontSize: SF.timeline, fontWeight: 700 },
                    itemStyle: { color: '#9ec3ff' },
                },
                tooltip: { show: false }
            },
            // Timeline OVERLAYS the scatter — keep the full plot area
            // (no extra right padding); the vertical scrubber floats over
            // the right edge of the map.
            grid: SCATTER_GRID,
            toolbox: {
                feature: {
                    brush: {
                        type: ['rect', 'polygon', 'clear']
                    }
                },
                top: 12,
                right: 110,    // clear of the vertical timeline
                iconStyle: { borderColor: '#7aa2f7' }
            },
            brush: {
                xAxisIndex: 'all',
                brushLink: 'all',
                outOfRange: {
                    colorAlpha: 0.1
                },
                seriesIndex: [0]
            },
            tooltip: {
                trigger: 'item',
                backgroundColor: 'rgba(23, 25, 40, 0.95)',
                borderColor: 'rgba(122, 162, 247, 0.4)',
                borderWidth: 1,
                padding: [10, 15],
                textStyle: { color: '#fff', fontSize: SF.tooltip },
                formatter: function (params) {
                    // Guard: visualMap hoverLink (and stray internal
                    // dispatches) can invoke the formatter with a param
                    // whose `value` isn't a data row. Bail cleanly
                    // instead of throwing on d[16].
                    const d = params && params.value;
                    if (!Array.isArray(d)) return '';
                    const label = d[16]; // table_label
                    const game = d[3];
                    const openPct = d[30] || 0;
                    
                    const formatVal = (val) => (val === -1000000 || val === -999999) ? 'Closed' :
                        typeof val === 'number' ? val.toLocaleString(undefined, { maximumFractionDigits: 1 }) : val;
                    const formatPct = (val) => (val === -1000000 || val === -999999) ? 'Closed' :
                        typeof val === 'number' ? val.toFixed(1) + '%' : val;

                    // Dim → label mapping mirrors HOURLY_KPI_REGISTRY.
                    // Status KPIs (Open Hours d[10], Unused Tables d[29])
                    // share the same 0/1/2 categorical value; rendered
                    // once as "Status" in the header instead of twice.
                    const area = d[34] || '-';
                    const pit  = d[32] || '-';
                    const zone = d[31] || '-';

                    return `
                        <div style="min-width: 360px;">
                            <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 5px; margin-bottom: 8px;">
                                <span style="font-weight: bold; font-size: 18px; color: #7aa2f7;">${label}</span>
                                <span style="font-size: 13px; background: rgba(255,255,255,0.1); padding: 2px 6px; borderRadius: 4px;">${game}</span>
                            </div>
                            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; font-size: 14px; color: rgba(255,255,255,0.6); margin-bottom: 8px;">
                                <div>Area: <span style="color: #fff;">${area}</span></div>
                                <div>Pit: <span style="color: #fff;">${pit}</span></div>
                                <div>Zone: <span style="color: #fff;">${zone}</span></div>
                                <div>Open: <span style="color: #fff;">${(openPct || 0).toFixed(0)}%</span></div>
                                <div style="grid-column: 1 / -1;">Status: <span style="color: ${d[29] === 2 ? '#9ece6a' : d[29] === 1 ? '#e0af68' : '#f7768e'};">${d[29] === 2 ? 'Active' : d[29] === 1 ? 'Idle' : 'Closed'}</span></div>
                            </div>
                            <div style="padding-top: 8px; border-top: 1px solid rgba(255,255,255,0.1);">
                                <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
                                    <span>Patron Hours:</span>
                                    <span style="color: #bb9af7; font-weight: bold;">${formatVal(d[9])}</span>
                                </div>
                                <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
                                    <span>Turnover per Hour:</span>
                                    <span style="color: #f59e0b; font-weight: bold;">${formatVal(d[11])}</span>
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
                                    <span style="color: #ec4899; font-weight: bold;">${formatVal(d[15])}</span>
                                </div>
                                <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
                                    <span>Occupancy:</span>
                                    <span style="color: #10b981; font-weight: bold;">${formatPct(d[7])}</span>
                                </div>
                                <div style="display: flex; justify-content: space-between;">
                                    <span>Table Minimum:</span>
                                    <span style="color: #e0af68; font-weight: bold;">${formatVal(d[14])}</span>
                                </div>
                            </div>
                            <div style="margin-top: 8px; font-size: 13px; color: #7aa2f7; text-align: center; border-top: 1px dashed rgba(122, 162, 247, 0.2); padding-top: 4px;">
                                Current KPI: ${kpiDisplayLabel(selectedKPI)}
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
            visualMap: {
                type: 'piecewise',
                dimension: targetDim,
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
                textStyle: { color: '#fff', fontSize: SF.visualMap },
                selected: visualMapSelected,
                // No highlight-on-hover — prevents stray tooltip dispatches
                // from firing the formatter with a non-data param. Click
                // selection still works (selectedMode 'multiple').
                hoverLink: false,
                selectedMode: 'multiple',
                // Sentinel placeholders (-999999 / -1000000) fall below
                // every threshold piece — render as definitive dim grey
                // so "no data" tables read as muted rather than as the
                // lowest valid bucket (which is often a dark blue and
                // was being confused with empty).
                outOfRange: { color: '#3a3a3a', opacity: 0.35 }
            },
            series: [{
                name: 'Tables',
                type: 'scatter',
                symbol: function(value) {
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
            }]
        };

        // Build options array (one for each hour in hourList)
        const optionsArray = hourList.map((hour, idx) => {
            // Reconstruct a flat array for the current hour frame
            const frameData = dataForScatter.map(point => {
                const newPoint = [...point];
                // For all array dimensions (index 7 and up), pick the scalar value for this hour
                for (let i = 7; i < point.length; i++) {
                    if (Array.isArray(point[i])) {
                        newPoint[i] = point[i][idx] !== undefined ? point[i][idx] : -1000000;
                    }
                }
                return newPoint;
            });

            return {
                // Header overlay — Date (with DoW) · Hour · selected KPI.
                title: {
                    text: [dateLabel, `${String(hour).padStart(2, '0')}:00`, kpiDisplayLabel(selectedKPI)]
                        .filter(Boolean).join('   ·   '),
                    textStyle: { color: '#e6edf3', fontSize: SF.title, fontWeight: 600 },
                    top: 16, left: 20,
                },
                // Re-assert visualMap (with the current `selected` map)
                // in every frame option so its piece-selection survives
                // timeline ticks. Without this, advancing a frame
                // resets the legend filter to "all selected" because
                // ECharts only carries baseOption.visualMap at initial
                // setOption and rebuilds the visualMap state on tick.
                visualMap: baseOption.visualMap,
                series: [{ data: frameData }]
            };
        });

        // Use true for notMerge to ensure a clean state when switching between modes
        chartInstance.setOption({
            baseOption: baseOption,
            options: optionsArray
        }, true);

        // Re-apply the user's visualMap selection after the notMerge
        // rebuild. With the timeline {baseOption, options} format
        // ECharts doesn't always carry `baseOption.visualMap.selected`
        // through to the rendered state — dispatching `selectDataRange`
        // explicitly forces it. Without this, clicking a legend piece
        // in 24-hr / WD Timeline modes appeared to do nothing.
        if (visualMapSelected && typeof visualMapSelected === 'object') {
            try {
                chartInstance.dispatchAction({
                    type: 'selectDataRange',
                    selected: visualMapSelected,
                });
            } catch (e) { /* non-fatal */ }
        }

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

    }, [chartInstance, dataForScatter, hourList, selectedKPI, kpiConfigMap, visualMapSelected]);

    // Separate Effect for Selection Highlighting to avoid full chart re-renders
    useEffect(() => {
        if (!chartInstance || !dataForScatter) return;

        // Skip update if this selection was initiated by our own brush
        const isSame = selectedTables.length === internalSelectionRef.current.length &&
                       selectedTables.every((v, i) => v === internalSelectionRef.current[i]);
        if (isSame) return;

        internalSelectionRef.current = selectedTables;

        chartInstance.setOption({
            series: [{
                name: 'Tables',
                data: dataForScatter.map(d => {
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

        // If selection was cleared externally, clear brush visually
        if (selectedTables.length === 0) {
            chartInstance.dispatchAction({ type: 'brush', command: 'clear', areas: [] });
        }
    }, [chartInstance, selectedTables, dataForScatter]);

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

export default ScatterHeatmapPlay;
