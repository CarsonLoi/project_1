import React, { useEffect, useRef, useState, useMemo } from 'react';
import * as echarts from 'echarts';
import * as d3 from 'd3';
import { threshold_dict, thresholdsFor, GAMETYPE_COLORS } from '../vendor/heatmapConstants';
// Geometry + fonts are tunable in one place — rtConfig.js.
import {
    PERF_FONTS, TOOLTIP,
    SCATTER_X_MIN, SCATTER_X_MAX, SCATTER_Y_MIN, SCATTER_Y_MAX,
    SCATTER_SYMBOL_SIZE_MULTIPLIER as SZ, SCATTER_GRID,
    HOUSE_EDGE_OPTIONS, DEFAULT_HOUSE_EDGE_BET, RT_KPI_DIMS,
} from '../constants/rtConfig';
const SF = PERF_FONTS.scatter;

// Definitive out-of-range fill — sentinel values (-999999, -1000000)
// that fall below every threshold piece render with this color so
// "no data" tables read as clearly distinct from the lowest valid
// bucket (which is often a dark blue and was being confused with
// "empty"). Centralised so the choice stays consistent across views.
const OUT_OF_RANGE_FILL = { color: '#3a3a3a', opacity: 0.35 };

const RtScatterHeatmap = React.memo(({ data, selectedKPI, selectedContour, title, visualMapSelected, onVisualMapSelect, onBrushSelected, selectedTables = [], selectedArea = [], kpiConfigMap: kpiConfigMapOverride, hideVisualMap = false, gridOverride = null, axisBounds = null, tooltipMode = 'detail', selectedBetOption = DEFAULT_HOUSE_EDGE_BET }) => {
    const chartRef = useRef(null);
    const [chartInstance, setChartInstance] = useState(null);
    const internalSelectionRef = useRef([]); // To prevent loops

    // KPI → {dim, thresholds} mapping for the Avg view (matches
    // buildAvgScatterData's tuple layout). When the parent passes
    // `kpiConfigMap` it overrides this default — used by the hourly
    // Aggregate view to drive the same renderer with the HOURLY KPI
    // dim layout instead.
    const defaultKpiConfigMap = useMemo(() => ({
        // Built from RT_KPI_DIMS so the KPI list, the scatter dims and
        // the legend all read from ONE table. The Performance dashboard
        // keeps three hand-synced copies of this mapping and they drift
        // every time a KPI is added — not repeating that here.
        ...Object.fromEntries(
            Object.entries(RT_KPI_DIMS)
                .filter(([kpi]) => kpi !== 'Gametype')
                .map(([kpi, dim]) => [kpi, { dim, thresholds: threshold_dict[kpi] }])
        ),
        'Gametype': { dim: 3, isCategorical: true },
        // Actual House Edge — one entry per bet-option selection, keyed
        // as "Actual House Edge::<bet label>" so the effective KPI key
        // (selectedKPI + the Bet Option sub-dropdown) resolves straight
        // to the right scatter dim without any extra branching below.
        ...Object.fromEntries(HOUSE_EDGE_OPTIONS.map((o) => [
            `Actual House Edge::${o.label}`,
            { dim: o.dim, thresholds: threshold_dict['Actual House Edge'] },
        ])),
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
            : 'Win (Total)';
        // "Actual House Edge" resolves through the Bet Option sub-dropdown
        // — its scatter dim varies by which bet is selected (see the
        // composite `Actual House Edge::<bet>` entries above).
        const effectiveKpiKey = selectedKPI === 'Actual House Edge'
            ? `Actual House Edge::${selectedBetOption || DEFAULT_HOUSE_EDGE_BET}`
            : selectedKPI;
        const kpiSettings = kpiConfigMap[effectiveKpiKey] || kpiConfigMap[fallbackKey];
        // Per-area threshold override. When the user filters to a single
        // area (e.g. MS or PM only) and that area has a registered
        // ramp for this KPI, swap it in here. Falls back to the
        // KPI's default ramp otherwise (multi-area, no-area, or no
        // registered override). The thresholdsFor() resolver lives in
        // heatmapConstants so every consumer reads from one source.
        const areaScopedThresholds = thresholdsFor(selectedKPI, selectedArea);
        const effectiveThresholds = areaScopedThresholds || kpiSettings.thresholds;

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
                textStyle: { color: '#fff', fontSize: SF.visualMap },
                selected: visualMapSelected,
                // Disable highlight-on-hover so hovering a legend piece
                // doesn't dispatch a tooltip event with a non-data param.
                // Click-to-toggle filtering still works (selectedMode
                // defaults to 'multiple' for piecewise — kept explicit).
                hoverLink: false,
                selectedMode: 'multiple',
                outOfRange: OUT_OF_RANGE_FILL,
            };
        } else if (effectiveThresholds) {
            visualMap = {
                type: 'piecewise',
                dimension: kpiSettings.dim,
                pieces: effectiveThresholds.map(t => ({
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
                // Disable highlight-on-hover so hovering a legend piece
                // doesn't dispatch a tooltip event with a non-data param.
                // Click-to-toggle filtering still works (selectedMode
                // defaults to 'multiple' for piecewise — kept explicit).
                hoverLink: false,
                selectedMode: 'multiple',
                // Sentinel placeholders (-999999 / -1000000) fall below
                // the lowest piece's `gte: 0` and land here — explicit
                // dim-grey so "no data" reads as muted rather than as
                // the lowest valid bucket.
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
                textStyle: { color: '#ccc', fontSize: SF.titleAvg, fontWeight: 600 },
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
                textStyle: { color: '#fff', fontSize: SF.tooltip },
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

                    // Compact value formatter — K notation at 1k+ so the
                    // 12-KPI grid stays readable; 1 decimal between
                    // 1k–10k, 0 decimal at 10k+, plain integer below 1k.
                    // Mirrors the legend/percentile formatter so units
                    // look consistent across the dashboard surfaces.
                    const formatVal = (val) => {
                        if (val === -1000000 || val === -999999) return 'Closed';
                        if (typeof val !== 'number' || !Number.isFinite(val)) return val ?? '–';
                        const abs = Math.abs(val);
                        if (abs >= 10000) return `${(val / 1000).toFixed(0)}k`;
                        if (abs >=  1000) return `${(val / 1000).toFixed(1)}k`;
                        return val.toLocaleString(undefined, { maximumFractionDigits: 1 });
                    };
                    const formatPct = (val) => (val === -1000000 || val === -999999) ? 'Closed' :
                        typeof val === 'number' ? val.toFixed(1) + '%' : val;
                    // Minutes, rendered as m or h:mm once it stops being a
                    // glanceable number. An idle time of "184m" makes you
                    // do arithmetic; "3h 04m" does not.
                    const formatMins = (val) => {
                        if (val === -1000000 || val === -999999) return '—';
                        if (typeof val !== 'number' || !Number.isFinite(val)) return '—';
                        if (val < 90) return `${val.toFixed(0)}m`;
                        const h = Math.floor(val / 60);
                        return `${h}h ${String(Math.round(val - h * 60)).padStart(2, '0')}m`;
                    };
                    // Sign-driven colour for the diverging surveillance
                    // metrics. Red is a house loss here, NOT a high value —
                    // the opposite of this file's other colour ramps, and
                    // deliberate: on a protection screen red must mean bad.
                    const signColor = (val) => {
                        if (val === -1000000 || val === -999999) return 'rgba(255,255,255,0.35)';
                        if (typeof val !== 'number' || !Number.isFinite(val)) return 'rgba(255,255,255,0.35)';
                        if (val < 0) return '#f7768e';
                        if (val > 0) return '#9ece6a';
                        return 'rgba(255,255,255,0.7)';
                    };

                    // House-edge label helper — turns the internal bet key
                    // stored at dim 51 (e.g. "banker") into its display
                    // label (e.g. "Banker") for the "Lowest" case.
                    const betKeyToLabel = (key) => (HOUSE_EDGE_OPTIONS.find((o) => o.key === key) || {}).label || key;

                    // ── SIMPLE tooltip ──────────────────────────────────
                    // Constant identity fields (table / game / area / pit)
                    // + only the currently-selected KPI's value. Toggled
                    // from the control panel via `tooltipMode`.
                    if (tooltipMode === 'simple') {
                        const dim = kpiSettings?.dim;
                        const isPct = /%|Percentage/.test(selectedKPI) || selectedKPI === 'Actual House Edge';
                        let vStr = '—';
                        if (selectedKPI === 'Gametype') vStr = game || '—';
                        else if (dim != null) vStr = isPct ? formatPct(d[dim]) : formatVal(d[dim]);
                        const betLabel = selectedBetOption || DEFAULT_HOUSE_EDGE_BET;
                        const kpiRowLabel = selectedKPI === 'Actual House Edge'
                            ? `Actual House Edge (${betLabel === 'Lowest' && d[51] ? `Lowest · ${betKeyToLabel(d[51])}` : betLabel})`
                            : selectedKPI;
                        return `
                            <div style="min-width:${TOOLTIP.simpleMinWidth}px">
                              <div style="display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid rgba(255,255,255,0.12);padding-bottom:5px;margin-bottom:7px">
                                <span style="font-weight:bold;font-size:${TOOLTIP.headerFontSize}px;color:#7aa2f7">${label}</span>
                                <span style="font-size:12px;background:rgba(255,255,255,0.1);padding:2px 6px;border-radius:4px">${game}</span>
                              </div>
                              <div style="display:flex;justify-content:space-between;font-size:${TOOLTIP.bodyFontSize}px;color:rgba(255,255,255,0.6);margin-bottom:3px">
                                <span>Area · Pit</span><span style="color:#fff">${area} · ${pit}</span>
                              </div>
                              <div style="display:flex;justify-content:space-between;align-items:baseline;margin-top:6px;padding-top:6px;border-top:1px solid rgba(255,255,255,0.1)">
                                <span style="font-size:${TOOLTIP.bodyFontSize}px;color:rgba(255,255,255,0.65)">${kpiRowLabel}</span>
                                <span style="font-size:18px;font-weight:bold;color:#9ece6a">${vStr}</span>
                              </div>
                            </div>`;
                    }

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
                            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 4px 18px;">
                                <!-- Column 1: the DAY. Column 2: the CURRENT SHOE.
                                     Reading across a row compares the same metric at
                                     two timescales, which is the comparison
                                     surveillance actually makes: is this shoe
                                     behaving differently from the day so far? -->
                                <div style="display: flex; justify-content: space-between;">
                                    <span style="color: rgba(255,255,255,0.65)">Win (Day):</span>
                                    <span style="color: ${signColor(d[18])}; font-weight: bold;">${formatVal(d[18])}</span>
                                </div>
                                <div style="display: flex; justify-content: space-between;">
                                    <span style="color: rgba(255,255,255,0.65)">Win (Shoe):</span>
                                    <span style="color: ${signColor(d[57])}; font-weight: bold;">${formatVal(d[57])}</span>
                                </div>

                                <div style="display: flex; justify-content: space-between;">
                                    <span style="color: rgba(255,255,255,0.65)">Theo (Day):</span>
                                    <span style="color: #7dcfff; font-weight: bold;">${formatVal(d[22])}</span>
                                </div>
                                <div style="display: flex; justify-content: space-between;">
                                    <span style="color: rgba(255,255,255,0.65)">Theo (Shoe):</span>
                                    <span style="color: #7dcfff; font-weight: bold;">${formatVal(d[58])}</span>
                                </div>

                                <div style="display: flex; justify-content: space-between;">
                                    <span style="color: rgba(255,255,255,0.65)">Variance (Day):</span>
                                    <span style="color: ${signColor(d[55])}; font-weight: bold;">${formatVal(d[55])}</span>
                                </div>
                                <div style="display: flex; justify-content: space-between;">
                                    <span style="color: rgba(255,255,255,0.65)">Variance (Shoe):</span>
                                    <span style="color: ${signColor(d[59])}; font-weight: bold;">${formatVal(d[59])}</span>
                                </div>

                                <div style="display: flex; justify-content: space-between;">
                                    <span style="color: rgba(255,255,255,0.65)">Turnover (Day):</span>
                                    <span style="color: #bb9af7; font-weight: bold;">${formatVal(d[54])}</span>
                                </div>
                                <div style="display: flex; justify-content: space-between;">
                                    <span style="color: rgba(255,255,255,0.65)">Turnover (Shoe):</span>
                                    <span style="color: #bb9af7; font-weight: bold;">${formatVal(d[60])}</span>
                                </div>

                                <div style="display: flex; justify-content: space-between;">
                                    <span style="color: rgba(255,255,255,0.65)">Hold %:</span>
                                    <span style="color: ${signColor(d[56])}; font-weight: bold;">${formatPct(d[56])}</span>
                                </div>
                                <div style="display: flex; justify-content: space-between;">
                                    <span style="color: rgba(255,255,255,0.65)">Shoe Hands:</span>
                                    <span style="color: #c084fc; font-weight: bold;">${formatVal(d[61])}</span>
                                </div>

                                <div style="display: flex; justify-content: space-between;">
                                    <span style="color: rgba(255,255,255,0.65)">Avg Bet:</span>
                                    <span style="color: #f59e0b; font-weight: bold;">${formatVal(d[15])}</span>
                                </div>
                                <div style="display: flex; justify-content: space-between;">
                                    <span style="color: rgba(255,255,255,0.65)">Idle:</span>
                                    <span style="color: #10b981; font-weight: bold;">${formatMins(d[63])}</span>
                                </div>

                                <div style="display: flex; justify-content: space-between;">
                                    <span style="color: rgba(255,255,255,0.65)">Table Minimum:</span>
                                    <span style="color: #e0af68; font-weight: bold;">${formatVal(d[14])}</span>
                                </div>
                                <div style="display: flex; justify-content: space-between;">
                                    <span style="color: rgba(255,255,255,0.65)">Avg Seated (10m):</span>
                                    <span style="color: #f7768e; font-weight: bold;">${formatVal(d[64])}</span>
                                </div>
                            </div>
                            ${d[52] ? `
                            <div style="margin-top: 6px; font-size: 12px; color: rgba(255,255,255,0.45); display:flex; justify-content:space-between;">
                                <span>Shoe ${d[52]}</span>
                                <span>${formatMins(d[62])} running</span>
                            </div>` : ''}
                            ${selectedKPI === 'Actual House Edge' ? `
                            <div style="margin-top: 8px; padding-top: 8px; border-top: 1px solid rgba(255,255,255,0.1); display: flex; justify-content: space-between; align-items: baseline;">
                                <span style="color: rgba(255,255,255,0.65);">Actual House Edge (${(selectedBetOption || DEFAULT_HOUSE_EDGE_BET) === 'Lowest' && d[51] ? `Lowest · ${betKeyToLabel(d[51])}` : (selectedBetOption || DEFAULT_HOUSE_EDGE_BET)}):</span>
                                <span style="font-size: 16px; color: #9ece6a; font-weight: bold;">${kpiSettings ? formatPct(d[kpiSettings.dim]) : '—'}</span>
                            </div>` : ''}
                        `;

                    // Wider Avg tooltip to accommodate the 2-column KPI
                    // grid; hourly aggregate keeps its single-column
                    // layout at the original width.
                    const minWidth = isHourlyAggregate ? 360 : 460;
                    return `
                        <div style="min-width: ${minWidth}px;">
                            <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 5px; margin-bottom: 8px;">
                                <span style="font-weight: bold; font-size: 18px; color: #7aa2f7;">${label}</span>
                                <span style="font-size: 13px; background: rgba(255,255,255,0.1); padding: 2px 6px; borderRadius: 4px;">${game}</span>
                            </div>
                            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 6px 14px; font-size: 14px; color: rgba(255,255,255,0.6);">
                                <div>Area: <span style="color: #fff;">${area}</span></div>
                                <div>Pit: <span style="color: #fff;">${pit}</span></div>
                                <div>Zone: <span style="color: #fff;">${zone}</span></div>
                                <div>Last hand: <span style="color: #fff;">${formatMins(d[63])} ago</span></div>
                            </div>
                            <div style="margin-top: 10px; padding-top: 8px; border-top: 1px solid rgba(255,255,255,0.1);">
                                ${metricRows}
                            </div>
                            <div style="margin-top: 8px; font-size: 13px; color: #7aa2f7; text-align: center; border-top: 1px dashed rgba(122, 162, 247, 0.2); padding-top: 4px;">
                                Current View: ${selectedKPI === 'Actual House Edge' ? `Actual House Edge (${selectedBetOption || DEFAULT_HOUSE_EDGE_BET})` : selectedKPI}
                            </div>
                        </div>
                    `;
                }
            },
            // Fixed-review fix: bounds default to the full nominal grid
            // (SCATTER_*), but a caller can pass the actual data's bounding
            // box (+ padding) via `axisBounds` so the floor doesn't sit in
            // a thin band inside a mostly-empty box. RealtimeDashboard
            // computes this once from config_cod.json's active tables —
            // see the note there.
            xAxis: {
                type: 'value',
                show: false,
                min: axisBounds?.xMin ?? SCATTER_X_MIN,
                max: axisBounds?.xMax ?? SCATTER_X_MAX
            },
            yAxis: {
                type: 'value',
                show: false,
                min: axisBounds?.yMin ?? SCATTER_Y_MIN,
                max: axisBounds?.yMax ?? SCATTER_Y_MAX,
                inverse: false
            },
            // `hideVisualMap` — small-multiples callers (Hotel dashboard)
            // render ONE shared legend instead of six per-chart legends,
            // so the per-chart visualMap is created (colors still apply)
            // but its legend UI is hidden. Perf dashboard passes nothing →
            // default false → unchanged.
            visualMap: visualMap ? { ...visualMap, show: hideVisualMap ? false : (visualMap.show !== false) } : visualMap,
            series: seriesData
        };
        // Let small-multiples callers tighten the plot margins (no legend
        // gutter needed). gridOverride merges over SCATTER_GRID.
        if (gridOverride) option.grid = { ...option.grid, ...gridOverride };

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

    }, [chartInstance, data, selectedKPI, selectedContour, title, defaultKpiConfigMap, kpiConfigMapOverride, visualMapSelected, hideVisualMap, gridOverride, axisBounds, tooltipMode, selectedBetOption]);

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

export default RtScatterHeatmap;
