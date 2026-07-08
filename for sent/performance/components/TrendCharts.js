import React, { useMemo, useEffect, useRef, useState } from 'react';
import * as echarts from 'echarts';
import { Box, Paper, Typography, Grid, ToggleButton, ToggleButtonGroup, FormControl, Select, MenuItem, Stack, Button } from '@mui/material';
import { GAMETYPE_COLORS, NUMERIC_KPIS_AVG } from '../../shared/constants/heatmapConstants';
import ConfigurableScatter from './ConfigurableScatter';
import HourlyDemand from './HourlyDemand';
import {
  INSIGHTS_TOKENS as T,
  flatCard,
  slimControl,
  pillToggleGroup,
  compactToggleGroup,
  headlineSx,
  sectionTitleSx,
  cardTitleSx,
  cardHeader,
} from './insightsTheme';
import { PERF_FONTS } from '../constants/fontSizes';
const TR = PERF_FONTS.trend;

const CHART_HEIGHT = 480;

const COLOR_PALETTE = [
    '#7aa2f7', '#bb9af7', '#7dcfff', '#e0af68', '#9ece6a',
    '#f7768e', '#00b4d8', '#ff9e64', '#b4f9f8', '#2ac3de',
    '#c0caf5', '#565f89', '#9aa5ce', '#cfc9c2', '#ff9e64'
];

// Compact magnitude formatter — 1 234 567 → "1.2m", 12 340 → "12.3k".
// Applied to y-axis labels and tooltip values on the trend-review charts.
function compactNum(val) {
    if (val == null || isNaN(val)) return val;
    const abs = Math.abs(val);
    const sign = val < 0 ? '-' : '';
    if (abs >= 1e6) return sign + (abs / 1e6).toFixed(abs >= 1e7 ? 0 : 1).replace(/\.0$/, '') + 'm';
    if (abs >= 1e3) return sign + (abs / 1e3).toFixed(abs >= 1e4 ? 0 : 1).replace(/\.0$/, '') + 'k';
    return val.toLocaleString(undefined, { maximumFractionDigits: 1 });
}

function setChartOption(instance, title, data, xKey, yKey, color) {
    const lineColor = color || '#00d4ff';
    const option = {
        backgroundColor: 'transparent',
        // Title is rendered in the React card header above the canvas
        // (right-aligned, with a kebab affordance opposite). No ECharts
        // title needed.
        // Tooltip / axis sizes lifted to match the Hourly Demand
        // scale (legend / axis labels at 18-21px) so the three views
        // share one font hierarchy.
        tooltip: {
            trigger: 'axis',
            backgroundColor: 'rgba(15, 20, 25, 0.98)',
            borderColor: 'rgba(0, 212, 255, 0.40)',
            borderWidth: 1,
            padding: [10, 14],
            textStyle: { color: '#fff', fontSize: TR.tooltip },
            formatter: (params) => {
                if (!params || !params[0]) return '';
                const p = params[0];
                const val = typeof p.value === 'number' ? compactNum(p.value) : p.value;
                const xVal = p.axisValue.replace('\n', ' ');
                return `<div style="padding: 2px 4px;">
                            <div style="color: rgba(255,255,255,0.55); font-size: 14px; font-weight: 500; letter-spacing: 0.8px; margin-bottom: 4px; text-transform: uppercase;">${xVal}</div>
                            <div style="display:flex;align-items:center;gap:8px"><span style="width:10px;height:10px;border-radius:50%;background:${lineColor}"></span><span style="color:#fff;font-size:22px;font-weight:700">${val}</span></div>
                        </div>`;
            }
        },
        grid: {
            left: 10,
            right: 16,
            bottom: 36,
            top: 16,
            containLabel: true
        },
        xAxis: {
            type: 'category',
            data: data.map(d => d[xKey]),
            axisLabel: {
                color: 'rgba(232, 234, 250, 0.55)',
                fontSize: TR.axisLabel,
                fontWeight: 500,
                // Let ECharts thin the labels automatically so a long
                // date range (or hour list) doesn't overlap/crowd.
                interval: 'auto',
                formatter: (value) => {
                    if (xKey === 'date') {
                        const d = new Date(value);
                        const month = d.toLocaleString('default', { month: 'short' });
                        const day = d.getDate().toString().padStart(2, '0');
                        return `${month}\n${day}`;
                    }
                    return value;
                }
            },
            axisLine: { lineStyle: { color: 'rgba(255,255,255,0.08)' } },
            axisTick: { show: false }
        },
        yAxis: {
            type: 'value',
            axisLabel: {
                color: 'rgba(232, 234, 250, 0.55)',
                fontSize: TR.axisLabel,
                formatter: compactNum,
            },
            splitLine: { lineStyle: { color: 'rgba(255,255,255,0.04)', type: 'dashed' } },
            axisLine: { show: false }
        },
        series: [{
            data: data.map(d => d[yKey]),
            type: 'line',
            smooth: true,
            symbol: 'circle',
            symbolSize: 6,
            showSymbol: false,
            lineStyle: { color: lineColor, width: 2.4 },
            itemStyle: { color: lineColor },
            areaStyle: {
                color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
                    { offset: 0, color: hexToRgba(lineColor, 0.32) },
                    { offset: 1, color: hexToRgba(lineColor, 0) }
                ])
            }
        }]
    };
    instance.setOption(option, true);
}

// Convert an rgb()/rgba()/#hex/MUI color string to an rgba() with the
// requested alpha so the area-gradient stops blend nicely whatever the
// caller passed in.
function hexToRgba(input, alpha) {
    if (!input) return `rgba(167,139,250,${alpha})`;
    const s = String(input).trim();
    if (s.startsWith('#')) {
        const h = s.slice(1);
        const r = parseInt(h.slice(0, 2), 16);
        const g = parseInt(h.slice(2, 4), 16);
        const b = parseInt(h.slice(4, 6), 16);
        return `rgba(${r},${g},${b},${alpha})`;
    }
    const m = s.match(/rgba?\(([^)]+)\)/);
    if (m) {
        const [r, g, b] = m[1].split(',').map((v) => parseFloat(v));
        return `rgba(${r},${g},${b},${alpha})`;
    }
    return s;
}

const TrendChart = ({ title, data, xKey, yKey, color }) => {
    const chartRef = useRef(null);
    const instanceRef = useRef(null);

    useEffect(() => {
        if (!chartRef.current) return;

        const raf = requestAnimationFrame(() => {
            if (!chartRef.current) return;

            let instance = echarts.getInstanceByDom(chartRef.current);
            if (!instance) {
                instance = echarts.init(chartRef.current, 'dark');
            }
            instanceRef.current = instance;

            if (data && data.length > 0) {
                setChartOption(instance, title, data, xKey, yKey, color);
            }
        });

        const observer = new ResizeObserver(() => {
            requestAnimationFrame(() => {
                if (instanceRef.current) {
                    instanceRef.current.resize();
                }
            });
        });
        observer.observe(chartRef.current);

        return () => {
            cancelAnimationFrame(raf);
            observer.disconnect();
            if (instanceRef.current) {
                instanceRef.current.dispose();
                instanceRef.current = null;
            }
        };
    }, []);

    useEffect(() => {
        if (instanceRef.current && data && data.length > 0) {
            setChartOption(instanceRef.current, title, data, xKey, yKey, color);
        } else if (instanceRef.current) {
            instanceRef.current.setOption({
                title: { text: title + ' (No Data)', textStyle: { color: '#666' } },
                series: [{ data: [] }]
            }, true);
        }
    }, [title, data, xKey, yKey, color]);

    return (
        <Box
            sx={{
                ...flatCard,
                p: 2,
                transition: 'box-shadow 160ms ease',
                '&:hover': { boxShadow: T.shadowCardHover },
            }}
        >
            <Box sx={cardHeader}>
                <Typography sx={cardTitleSx}>{title}</Typography>
            </Box>
            <div ref={chartRef} style={{ width: '100%', height: `${CHART_HEIGHT}px` }} />
        </Box>
    );
};

const TrendCharts = ({ mode, dailyData, hourlyData, hourlyDataForDemand, scatterData, selectedTables = [], onRankingSelection, rankingBarThreshold = 100 }) => {
    const [view, setView] = useState('trend'); // 'trend' | 'ranking' | 'demand'

    // Ranking + Hourly Demand are Avg-only views (they aggregate over the
    // full date range; the 24-hr Timeline mode already renders the
    // per-hour timeline themselves). When the user switches to a Play
    // mode while sitting on one of those tabs, snap the view back to
    // 'trend' so the body has something coherent to render.
    const rankingDemandAllowed = mode === 'Avg';
    useEffect(() => {
        if (!rankingDemandAllowed && (view === 'ranking' || view === 'demand')) {
            setView('trend');
        }
    }, [rankingDemandAllowed, view]);
    const [rankingKPI, setRankingKPI] = useState('Drop per floor day');
    const [rankingGroup, setRankingGroup] = useState('Table'); // Table, Pit, Zone, Game, Area
    const [rankingFacet, setRankingFacet] = useState('none');
    const [rankingOrder, setRankingOrder] = useState('desc'); // 'desc' or 'asc'

    const containerRef = useRef(null);
    const chartsRef = useRef([]);
    const internalSelectionRef = useRef([]); // To prevent loops

    const clearAllBrushes = () => {
        chartsRef.current.forEach(chart => {
            if (chart) {
                chart.dispatchAction({
                    type: 'brush',
                    command: 'clear',
                    areas: []
                });
            }
        });
        onRankingSelection?.([]);
    };

    // Sourced from the shared NUMERIC_KPIS_AVG so the ranking dropdown
    // stays in lockstep with the scatter heatmap's KPI list (and with
    // ConfigurableScatter's X/Y/Size dropdowns). To add or remove a KPI
    // from the ranking, edit NUMERIC_KPIS_AVG in heatmapConstants.js —
    // every consumer picks it up automatically.
    const KPI_OPTIONS = NUMERIC_KPIS_AVG;

    const DIMENSION_OPTIONS = [
        { key: 'Table', label: 'Table' },
        { key: 'Pit', label: 'Pit' },
        { key: 'Zone', label: 'Zone' },
        { key: 'Gametype', label: 'Game Type' },
        { key: 'Area', label: 'Area' }
    ];

    // Map KPI key → scatter tuple index. Derived from the same shared
    // NUMERIC_KPIS_AVG that powers the KPI dropdown so the two cannot
    // drift apart. Falls back to slot 7 for unknown keys (matches the
    // legacy switch's default branch).
    const kpiIndexMap = useMemo(() => {
        const m = new Map();
        for (const k of NUMERIC_KPIS_AVG) m.set(k.key, k.idx);
        return m;
    }, []);
    const getKpiIndex = (kpi) => kpiIndexMap.get(kpi) ?? 7;

    // Extract dimension value from scatter point based on group
    const getDimValue = (point, dim) => {
        switch(dim) {
            case 'Table': return String(point[16]).trim().toUpperCase(); // table_label
            case 'Pit': return ("PIT " + point[32]).trim().toUpperCase();
            case 'Zone': return ("ZONE " + point[31]).trim().toUpperCase();
            case 'Gametype': return point[3];
            case 'Area': return point[34];
            default: return 'Unknown';
        }
    };

    // Ranking Data Aggregation
    const rankingData = useMemo(() => {
        if (view !== 'ranking' || !scatterData || scatterData.length === 0) return [];

        const kpiIndex = getKpiIndex(rankingKPI);
        const facetField = rankingFacet === 'none' ? null : rankingFacet;
        const groupField = rankingGroup;

        const facets = {};

        scatterData.forEach(d => {
            // Drop placeholder rows whose underlying table id is "0" —
            // these are config-only entries that shouldn't show up as
            // a real ranking row (they cluster into a phantom "0" bar
            // at the bottom of every table-grouped chart). Slot 33 is
            // the raw tableID per the scatter tuple contract.
            const rawTableId = String(d[33] || '').trim();
            if (rawTableId === '0' || rawTableId === '') return;

            const fKey = facetField ? getDimValue(d, facetField) : 'All';
            const gKey = getDimValue(d, groupField);

            if (!facets[fKey]) facets[fKey] = {};
            if (!facets[fKey][gKey]) {
                facets[fKey][gKey] = {
                    sum: 0,
                    count: 0,
                    colorGroup: d[3] // Gametype for color
                };
            }

            const val = d[kpiIndex];
            if (val !== undefined && val !== null && val > -999990) { // filter out placeholders
                facets[fKey][gKey].sum += val;
                facets[fKey][gKey].count += 1;
            }
        });

        const result = Object.entries(facets).map(([facetLabel, groups]) => {
            const chartData = Object.entries(groups).map(([groupLabel, stats]) => {
                let value = stats.count > 0 ? stats.sum / stats.count : 0;
                return { label: groupLabel, value, colorGroup: stats.colorGroup };
            }).sort((a, b) => rankingOrder === 'desc' ? b.value - a.value : a.value - b.value);

            return { facetLabel, chartData };
        });

        return result;

    }, [view, rankingKPI, rankingGroup, rankingFacet, rankingOrder, scatterData]);


    // Render Charts
    useEffect(() => {
        if (!containerRef.current) return;

        chartsRef.current.forEach(c => c && c.dispose());
        chartsRef.current = [];

        if (view === 'ranking') {
            const allColorGroups = [...new Set(rankingData.flatMap(f => f.chartData.map(d => d.colorGroup)))];
            const colorMap = {};
            allColorGroups.forEach((g, i) => {
                if (GAMETYPE_COLORS && GAMETYPE_COLORS[g]) {
                    colorMap[g] = GAMETYPE_COLORS[g];
                } else {
                    colorMap[g] = COLOR_PALETTE[i % COLOR_PALETTE.length];
                }
            });

            rankingData.forEach((facet, idx) => {
                const chartDom = containerRef.current.querySelector(`.chart-ranking-${idx}`);
                if (!chartDom) return;
                const chart = echarts.init(chartDom);
                chartsRef.current[idx] = chart;

                const kpiInfo = KPI_OPTIONS.find(o => o.key === rankingKPI) || KPI_OPTIONS[0];
                const isByUnit = rankingGroup === 'Table' || rankingGroup === 'Pit' || rankingGroup === 'Zone';

                const option = {
                    animation: false,
                    backgroundColor: 'transparent',
                    grid: { top: 10, bottom: 10, left: 10, right: 40, containLabel: true },
                    brush: isByUnit ? {
                        toolbox: ['rect', 'clear'],
                        xAxisIndex: 0,
                        throttleType: 'debounce',
                        throttleDelay: 300,
                    } : undefined,
                    tooltip: {
                        trigger: 'axis',
                        axisPointer: { type: 'shadow' },
                        formatter: (params) => {
                            const p = params[0];
                            let val = p.value;
                            if (kpiInfo.isPercent) val = (val * 100).toFixed(1) + '%';
                            else val = val.toLocaleString(undefined, { maximumFractionDigits: 1 });
                            const color = p.color.colorStops ? p.color.colorStops[0].color : p.color;
                            const originalIndex = facet.chartData.length - 1 - p.dataIndex;
                            return `<div style="font-size: 18px; padding: 4px;">${p.name}<br/><b>${kpiInfo.label}: ${val}</b><br/><span style="color:${color}">●</span> ${facet.chartData[originalIndex].colorGroup}</div>`;
                        }
                    },
                    xAxis: {
                        type: 'value',
                        axisLabel: {
                            color: 'rgba(255,255,255,0.6)', fontSize: TR.rankAxis,
                            formatter: (val) => {
                                const absVal = Math.abs(val);
                                const sign = val < 0 ? '-' : '';
                                if (kpiInfo.isPercent) return (val * 100).toFixed(0) + '%';
                                if (absVal >= 1000000) return sign + (absVal / 1000000).toFixed(1) + 'M';
                                if (absVal >= 1000) return sign + (absVal / 1000).toFixed(1) + 'K';
                                return val;
                            }
                        },
                        splitLine: { lineStyle: { color: 'rgba(255,255,255,0.05)' } }
                    },
                    yAxis: {
                        type: 'category',
                        data: facet.chartData.map(d => d.label).reverse(),
                        axisLabel: {
                            color: 'rgba(255,255,255,0.8)',
                            fontSize: TR.rankAxis
                        }
                    },
                    series: [{
                        type: 'bar',
                        barWidth: 30,
                        data: facet.chartData.map((d, i) => {
                            let color = colorMap[d.colorGroup] || '#7aa2f7';

                            // Highlight selected units, grey out unselected
                            if (selectedTables.length > 0 && isByUnit) {
                                if (!selectedTables.includes(d.label)) {
                                    color = '#404040'; // Grey out unselected
                                }
                            }

                            return {
                                value: d.value,
                                name: d.label,
                                itemStyle: {
                                    color: new echarts.graphic.LinearGradient(1, 0, 0, 0, [
                                        { offset: 0, color: color },
                                        { offset: 1, color: (color && typeof color === 'string' && color.includes('rgba')) ? color.replace('1)', '0.2)') : color }
                                    ])
                                }
                            };
                        }).reverse(),
                        itemStyle: {
                            borderRadius: [0, 4, 4, 0]
                        },
                        label: {
                            show: true,
                            position: 'right',
                            color: '#fff',
                            fontSize: TR.rankLabel,
                            formatter: (params) => {
                                if (kpiInfo.isPercent) return (params.value * 100).toFixed(1) + '%';
                                return params.value >= 1000 ? (params.value / 1000).toFixed(1) + 'K' : params.value.toFixed(0);
                            }
                        }
                    }]
                };

                // Slider always present, but its window depends on size:
                //   - data length < threshold  → span the whole list
                //                                (all bars visible at once)
                //   - data length ≥ threshold  → window the last `threshold`
                //                                items (user can scroll back)
                const total = facet.chartData.length;
                const underThreshold = total < rankingBarThreshold;
                option.dataZoom = [
                    {
                        type: 'slider',
                        yAxisIndex: 0,
                        right: 5,
                        width: 12,
                        startValue: underThreshold ? 0 : total - rankingBarThreshold,
                        endValue: total - 1,
                        borderColor: 'transparent',
                        backgroundColor: 'rgba(255,255,255,0.05)',
                        fillerColor: 'rgba(122, 162, 247, 0.2)',
                        handleStyle: { color: '#7aa2f7' },
                        textStyle: { color: 'transparent' }
                    },
                    {
                        type: 'inside',
                        yAxisIndex: 0,
                        zoomOnMouseWheel: false,
                        moveOnMouseWheel: true
                    }
                ];
                option.grid.right = 50;

                chart.setOption(option);

                if (isByUnit && onRankingSelection) {
                    chart.on('click', (params) => {
                        if (params.componentType === 'series') {
                            const currentSelection = internalSelectionRef.current;
                            const newSelection = currentSelection.includes(params.name)
                                ? currentSelection.filter(loc => loc !== params.name)
                                : [...currentSelection, params.name];
                            
                            onRankingSelection(newSelection);
                        }
                    });

                    chart.on('brushSelected', (params) => {
                        const selectedItems = params.batch[0].selected[0].dataIndex;
                        if (selectedItems && selectedItems.length > 0) {
                            const yAxisData = chart.getOption().yAxis[0].data;
                            const selectedLocs = selectedItems.map(idx => yAxisData[idx]);
                            
                            // Only emit if it's a new selection to avoid infinite loops or resets
                            const isSame = selectedLocs.length === internalSelectionRef.current.length &&
                                           selectedLocs.every((v, i) => v === internalSelectionRef.current[i]);
                            
                            if (!isSame) {
                                onRankingSelection(selectedLocs);
                            }
                        }
                    });
                }
            });
        }

        const resizeObserver = new ResizeObserver(() => {
            requestAnimationFrame(() => {
                chartsRef.current.forEach(c => c && c.resize());
            });
        });
        if (containerRef.current) resizeObserver.observe(containerRef.current);

        const handleResize = () => {
            requestAnimationFrame(() => {
                chartsRef.current.forEach(c => c && c.resize());
            });
        };
        window.addEventListener('resize', handleResize);
        return () => {
            window.removeEventListener('resize', handleResize);
            resizeObserver.disconnect();
        };
    }, [view, rankingData, rankingKPI, rankingGroup, rankingOrder, rankingBarThreshold]);

    // Separate Effect for Selection Highlighting to avoid full chart re-renders
    useEffect(() => {
        if (view !== 'ranking' || chartsRef.current.length === 0) return;

        const isByUnit = rankingGroup === 'Table' || rankingGroup === 'Pit' || rankingGroup === 'Zone';
        if (!isByUnit) return;

        const isSame = selectedTables.length === internalSelectionRef.current.length &&
                       selectedTables.every((v, i) => v === internalSelectionRef.current[i]);
        if (isSame) return;

        internalSelectionRef.current = selectedTables;

        rankingData.forEach((facet, idx) => {
            const chart = chartsRef.current[idx];
            if (!chart) return;

            const allColorGroups = [...new Set(facet.chartData.map(d => d.colorGroup))];
            const colorMap = {};
            allColorGroups.forEach((g, i) => {
                if (GAMETYPE_COLORS && GAMETYPE_COLORS[g]) colorMap[g] = GAMETYPE_COLORS[g];
                else colorMap[g] = COLOR_PALETTE[i % COLOR_PALETTE.length];
            });

            const newSeriesData = facet.chartData.map((d) => {
                let color = colorMap[d.colorGroup] || '#7aa2f7';
                if (selectedTables.length > 0) {
                    if (!selectedTables.includes(d.label)) {
                        color = '#404040';
                    }
                }
                return {
                    value: d.value,
                    name: d.label,
                    itemStyle: {
                        color: new echarts.graphic.LinearGradient(1, 0, 0, 0, [
                            { offset: 0, color: color },
                            { offset: 1, color: (color && typeof color === 'string' && color.includes('rgba')) ? color.replace('1)', '0.2)') : color }
                        ])
                    }
                };
            }).reverse();

            chart.setOption({
                series: [{ 
                    type: 'bar',
                    barWidth: 30,
                    data: newSeriesData 
                }]
            }, false);

            // If selection was cleared externally, clear brush visually
            if (selectedTables.length === 0) {
                chart.dispatchAction({ type: 'brush', command: 'clear', areas: [] });
            }
        });
    }, [selectedTables, rankingData, view, rankingGroup]);


    // Original Trend Logic
    const dailyTrends = useMemo(() => {
        if (mode !== 'Avg' || !dailyData || dailyData.length === 0) return [];

        const groups = dailyData.reduce((acc, d) => {
            const date = d.date;
            if (!acc[date]) acc[date] = { date, drop: 0, win: 0, patronhrs: 0, floorday: 0, turnover: 0, theo: 0, patron_hands: 0, count: 0 };
            acc[date].drop += parseFloat(d.drop) || 0;
            acc[date].win += parseFloat(d.win) || 0;
            acc[date].patronhrs += parseFloat(d.patronhrs) || 0;
            acc[date].floorday += parseFloat(d.floorday) || 0;
            acc[date].turnover += parseFloat(d.turnover) || 0;
            acc[date].theo += parseFloat(d.theo) || 0;
            // patron_hands feeds the avgbet ratio below (turnover / patron_hands).
            acc[date].patron_hands += parseFloat(d.patron_hands) || 0;
            acc[date].count += 1;
            return acc;
        }, {});

        return Object.values(groups).sort((a, b) => a.date.localeCompare(b.date)).map(g => ({
            date: g.date,
            'Drop per floor day': g.floorday > 0 ? g.drop / g.floorday : 0,
            'Win per floor day': g.floorday > 0 ? g.win / g.floorday : 0,
            'Patron hours per floor day': g.floorday > 0 ? g.patronhrs / g.floorday : 0,
            'Avg Daily floor hours': g.count > 0 ? g.floorday / g.count : 0,
            'Avgbet': g.patron_hands > 0 ? g.turnover / g.patron_hands : 0,
            'Theo per floor day': g.floorday > 0 ? g.theo / g.floorday : 0
        }));
    }, [mode, dailyData]);

    const hourlyTrends = useMemo(() => {
        if (mode === 'Avg' || !hourlyData || hourlyData.length === 0) return [];

        const hList = [6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 0, 1, 2, 3, 4, 5];
        
        const uniqueDays = new Set(hourlyData.map(d => d.date)).size;
        const days = uniqueDays || 1;

        const groups = hourlyData.reduce((acc, d) => {
            const h = d.hour;
            if (!acc[h]) acc[h] = { hour: h, drop: 0, win: 0, patronhrs: 0, openhours: 0, turnover: 0, theo: 0, count: 0 };
            acc[h].drop += parseFloat(d.drop) || 0;
            acc[h].win += parseFloat(d.win) || 0;
            acc[h].patronhrs += parseFloat(d.patronhrs) || 0;
            acc[h].openhours += parseFloat(d.openhours) || 0;
            acc[h].turnover += parseFloat(d.turnover) || 0;
            // theo_win was renamed to `theo` in the aligned schema.
            acc[h].theo += parseFloat(d.theo) || 0;
            acc[h].count += 1;
            return acc;
        }, {});

        return hList.map(h => {
            const g = groups[h] || { drop: 0, win: 0, patronhrs: 0, openhours: 0, turnover: 0, theo: 0, count: 0 };
            return {
                hour: `${h}:00`,
                'Drop per Day': g.drop / days,
                'Win per Day': g.win / days,
                'Patron hours per Day': g.patronhrs / days,
                'Open Hours per Day': g.openhours / days,
                'Turnover per Day': g.turnover / days,
                'Theo per Day': g.theo / days
            };
        });
    }, [mode, hourlyData]);

    const activeTrends = mode === 'Avg' ? dailyTrends : hourlyTrends;
    const xKey = mode === 'Avg' ? 'date' : 'hour';
    const activeKPIs = mode === 'Avg'
        ? ['Drop per floor day', 'Win per floor day', 'Patron hours per floor day', 'Avg Daily floor hours', 'Avgbet', 'Theo per floor day']
        : ['Drop per Day', 'Win per Day', 'Patron hours per Day', 'Open Hours per Day', 'Turnover per Day', 'Theo per Day'];

    // Trend-card line colors — the saturated 6-color "One" palette.
    const colors = T.series;

    const fullTitle = mode === 'Avg' ? 'Performance Insights' : 'Hourly Operational Profile';

    return (
        <Paper
            sx={{
                p: 3,
                bgcolor: T.bgPanel,
                border: T.borderHair,
                borderRadius: 1.5,
                height: '100%',
                boxSizing: 'border-box',
                boxShadow: T.shadowCard,
                display: 'flex',
                flexDirection: 'column',
            }}
        >
            {/* Header row — section title on the left, pill-style view
                selector on the right. Ranking controls live in the
                ranking-view body, not here. */}
            <Box
                sx={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 2,
                    mb: 2.5,
                    flexWrap: 'wrap',
                }}
            >
                <Typography component="h2" sx={headlineSx}>
                    {fullTitle}
                </Typography>

                <Box sx={{ flex: 1 }} />

                <ToggleButtonGroup
                    value={view}
                    exclusive
                    onChange={(e, v) => v && setView(v)}
                    size="small"
                    sx={pillToggleGroup}
                >
                    <ToggleButton value="trend">Trend Review</ToggleButton>
                    {/* Ranking + Hourly Demand are Avg-only — hidden in
                        24-hr Timeline mode (see comment on
                        rankingDemandAllowed above). */}
                    {rankingDemandAllowed && (
                        <ToggleButton value="ranking">Ranking View</ToggleButton>
                    )}
                    {rankingDemandAllowed && (
                        <ToggleButton value="demand">Hourly Demand</ToggleButton>
                    )}
                </ToggleButtonGroup>
            </Box>

            {/* Body container. Different views need different overflow
                strategies — ranking-view wants per-column scrolling so
                the left ranking list scrolls independently of the right
                scatter; the others scroll the whole body. */}
            <Box
                ref={containerRef}
                sx={{
                    flex: 1,
                    minHeight: 0,
                    display: 'flex',
                    flexDirection: 'column',
                    // Ranking owns its own scroll regions, so the body
                    // itself doesn't scroll there.
                    overflow: view === 'ranking' ? 'hidden' : 'auto',
                    overflowX: 'hidden',
                    scrollbarWidth: 'none',
                    msOverflowStyle: 'none',
                    '&::-webkit-scrollbar': { display: 'none' },
                }}
            >
                {view === 'demand' ? (
                    <HourlyDemand hourlyData={hourlyDataForDemand || []} />
                ) : view === 'trend' ? (
                    activeTrends.length === 0 ? (
                        <Box sx={{
                            ...flatCard,
                            height: '700px',
                            display: 'flex',
                            flexDirection: 'column',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: 0.5,
                        }}>
                            <Typography sx={{ color: T.textSecondary, fontSize: '1.1rem' }}>No trend data available for selected filters</Typography>
                            <Typography variant="caption" sx={{ color: T.textTertiary }}>Try adjusting date range or area selections</Typography>
                        </Box>
                    ) : (
                        <Grid container spacing={1}>
                            {activeKPIs.map((kpi, idx) => (
                                <Grid size={{ xs: 12, md: 4 }} key={kpi}>
                                    <TrendChart
                                        title={kpi}
                                        data={activeTrends}
                                        xKey={xKey}
                                        yKey={kpi}
                                        color={colors[idx % colors.length]}
                                    />
                                </Grid>
                            ))}
                        </Grid>
                    )
                ) : (
                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, flex: 1, minHeight: 0 }}>
                        {/* Ranking controls row — all controls share the
                            slim glass-pill aesthetic. KPI / By × / Grid by ×
                            use the same Select styling; the order toggle
                            picks up the pink-accent toggle-group. */}
                        <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', gap: 1 }}>
                            <FormControl size="small" sx={{ minWidth: 160 }}>
                                <Select
                                    value={rankingKPI}
                                    onChange={(e) => setRankingKPI(e.target.value)}
                                    sx={slimControl}
                                >
                                    {KPI_OPTIONS.map(o => <MenuItem key={o.key} value={o.key} sx={{ fontSize: '0.98rem' }}>{o.label}</MenuItem>)}
                                </Select>
                            </FormControl>
                            <FormControl size="small" sx={{ minWidth: 110 }}>
                                <Select
                                    value={rankingGroup}
                                    onChange={(e) => setRankingGroup(e.target.value)}
                                    sx={slimControl}
                                >
                                    {DIMENSION_OPTIONS.map(o => <MenuItem key={o.key} value={o.key} sx={{ fontSize: '0.98rem' }}>By {o.label}</MenuItem>)}
                                </Select>
                            </FormControl>
                            <FormControl size="small" sx={{ minWidth: 110 }}>
                                <Select
                                    value={rankingFacet}
                                    onChange={(e) => setRankingFacet(e.target.value)}
                                    sx={slimControl}
                                >
                                    <MenuItem value="none" sx={{ fontSize: '0.98rem' }}>No Grid</MenuItem>
                                    {DIMENSION_OPTIONS.filter(o => o.key !== rankingGroup).map(o => (
                                        <MenuItem key={o.key} value={o.key} sx={{ fontSize: '0.98rem' }}>Grid by {o.label}</MenuItem>
                                    ))}
                                </Select>
                            </FormControl>
                            <ToggleButtonGroup
                                value={rankingOrder}
                                exclusive
                                onChange={(e, v) => v && setRankingOrder(v)}
                                size="small"
                                sx={compactToggleGroup}
                            >
                                <ToggleButton value="desc">DESC</ToggleButton>
                                <ToggleButton value="asc">ASC</ToggleButton>
                            </ToggleButtonGroup>
                            <Button
                                size="small"
                                variant="outlined"
                                onClick={clearAllBrushes}
                                sx={{
                                    fontSize: '0.82rem',
                                    fontWeight: 600,
                                    letterSpacing: 0.6,
                                    textTransform: 'none',
                                    height: 36,
                                    px: 2,
                                    borderRadius: 1,
                                    borderColor: 'rgba(78, 205, 196, 0.35)',
                                    color: T.accentPrimary,
                                    '&:hover': {
                                        borderColor: T.accentPrimary,
                                        bgcolor: T.accentPrimaryDim,
                                        color: '#ffffff',
                                    }
                                }}
                            >
                                Clear Selection
                            </Button>
                        </Stack>

                        {rankingData.length === 0 ? (
                            <Box sx={{
                                ...flatCard,
                                textAlign: 'center',
                                py: 10,
                                color: T.textTertiary,
                            }}>
                                <Typography sx={{ fontSize: '1.05rem' }}>No data available for ranking</Typography>
                            </Box>
                        ) : rankingFacet === 'none' ? (
                            // No Grid → ranking on the left (scrolls
                            // independently), configurable scatter pinned
                            // to a fixed 400px on the right.
                            <Box sx={{
                                display: 'grid',
                                gridTemplateColumns: '1fr 1fr',
                                gap: 2,
                                flex: 1,
                                minHeight: 0,
                            }}>
                                <Box sx={{
                                    overflowY: 'auto',
                                    minHeight: 0,
                                    scrollbarWidth: 'none',
                                    msOverflowStyle: 'none',
                                    '&::-webkit-scrollbar': { display: 'none' },
                                }}>
                                    {rankingData.map((facet, idx) => (
                                        <Box key={facet.facetLabel} sx={{
                                            ...flatCard,
                                            p: 2,
                                            height: `${Math.max(600, facet.chartData.length * 42)}px`,
                                            display: 'flex',
                                            flexDirection: 'column',
                                            mb: 2,
                                        }}>
                                            <Box sx={cardHeader}>
                                                <Typography sx={cardTitleSx}>
                                                    {`${KPI_OPTIONS.find(o => o.key === rankingKPI).label} Ranking`}
                                                </Typography>
                                            </Box>
                                            <Box className={`chart-ranking-${idx}`} sx={{ flex: 1 }} />
                                        </Box>
                                    ))}
                                </Box>
                                <Box sx={{
                                    height: 800,
                                    flexShrink: 0,
                                    overflow: 'hidden',
                                }}>
                                    <ConfigurableScatter
                                        scatterData={scatterData}
                                        selectedTables={selectedTables}
                                        onSelection={onRankingSelection}
                                    />
                                </Box>
                            </Box>
                        ) : (
                            // Grid mode → multiple facets in a 2-up grid,
                            // single scroll region for the whole area.
                            <Box sx={{
                                display: 'grid',
                                gridTemplateColumns: '1fr 1fr',
                                gap: 2,
                                flex: 1,
                                minHeight: 0,
                                overflowY: 'auto',
                                scrollbarWidth: 'none',
                                msOverflowStyle: 'none',
                                '&::-webkit-scrollbar': { display: 'none' },
                            }}>
                                {rankingData.map((facet, idx) => (
                                    <Box key={facet.facetLabel} sx={{
                                        ...flatCard,
                                        p: 2,
                                        height: `${Math.max(600, facet.chartData.length * 42)}px`,
                                        display: 'flex',
                                        flexDirection: 'column',
                                        mb: 2,
                                    }}>
                                        <Box sx={cardHeader}>
                                            <Typography sx={cardTitleSx}>{facet.facetLabel}</Typography>
                                        </Box>
                                        <Box className={`chart-ranking-${idx}`} sx={{ flex: 1 }} />
                                    </Box>
                                ))}
                            </Box>
                        )}
                    </Box>
                )}
            </Box>
        </Paper>
    );
};

export default TrendCharts;
