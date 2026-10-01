// Live Casino Win — Player 360 Detail Workspace (Row 3).
// =======================================================
// Persistent identity/status bar + four analyst tabs:
//
//   1. Financial      — KPI micro-cards w/ sparklines · cumulative
//                        trajectory (turnover bars + actual vs theo
//                        lines) · hold-deviation gauge
//   2. Behavioral     — archetype radar vs avg-VIP baseline · bet-size
//                        vs hand-sequence scatter · dealer correlation
//   3. Preferences    — wager sunburst (game → bet → outcome) · seat
//                        position heatmap
//   4. Shoes          — shoe master log → bead-plate roadmap with
//                        wager-glow overlay · bankroll step line ·
//                        wager vs shoe-depth combo
//
// Perspective note: the dashboard is casino-perspective throughout,
// but the Financial trajectory + Shoe bankroll charts follow the spec's
// PLAYER-perspective convention (green above zero = player up) — each
// is labelled explicitly so nobody misreads a sign.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as echarts from 'echarts';
import { Box, Stack, Typography, Tabs, Tab, Tooltip } from '@mui/material';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import { CARD_TIERS, colorForWin, fmtCurrency, fmtCurrencyExact } from '../constants/winPalette';
import {
    fmtDuration, patronTodayStats, patronBetMechanics, patronFinancialSeries,
    patronDealerStats, patronSeatStats, patronSunburstData,
    patronBehaviorProfile, populationBaselineProfile,
    patronShoeLog, shoeHandDetail,
} from '../utils/winAggregates';
import RowSparkline from './RowSparkline';
import { glass, glassInner, sectionLabel, accentBar, FONT_DISPLAY, FONT_MONO, ACCENT, ACCENT_2 } from '../constants/liveTheme';
import { BIG_ROAD, CHART_H } from '../constants/liveConfig';

// Spec palette (kept separate from the floor's diverging scale).
const C = { blue: '#3B82F6', green: '#10B981', red: '#EF4444', gold: '#F59E0B', cyan: '#7adfff' };

const headSx = { py: 0.55, px: 0.8, fontSize: 11, fontFamily: FONT_DISPLAY, fontWeight: 700, letterSpacing: 1.1, textTransform: 'uppercase', color: 'rgba(202,232,255,0.55)', borderBottom: '1px solid rgba(122,223,255,0.18)', textAlign: 'right', whiteSpace: 'nowrap' };
const cellSx = { py: 0.45, px: 0.8, fontSize: 12, fontFamily: FONT_MONO, fontVariantNumeric: 'tabular-nums', borderBottom: '1px solid rgba(255,255,255,0.05)', textAlign: 'right', whiteSpace: 'nowrap' };
const cardSx = { ...glassInner };
const sectionTitleSx = { px: 1.2, pt: 0.9, pb: 0.5, ...sectionLabel, fontSize: 11 };
const scrollSx = {
    overflowY: 'auto',
    scrollbarColor: 'rgba(122,223,255,0.35) rgba(255,255,255,0.04)', scrollbarWidth: 'thin',
    '&::-webkit-scrollbar': { width: 9 },
    '&::-webkit-scrollbar-thumb': { bgcolor: 'rgba(122,223,255,0.35)', borderRadius: 3, border: '2px solid transparent', backgroundClip: 'padding-box' },
};

// One ECharts mount per chart — init once, redraw when the option deps
// change, resize with the container. Raw <div> ref (MUI Box ref proved
// unreliable with ECharts 6 here).
//
// Disposes and fully re-inits on every deps change (not just setOption
// with notMerge:true) — reusing an instance across patrons left stale
// internal visual-mapping state that crashed getVisualGradient() for
// SOME patrons' data shapes even though the option object looked fully
// replaced. A clean dispose+init per deps change is slightly more work
// but removes that whole class of "works for patron A, crashes for
// patron B" bug.
function useEChart(buildOption, deps) {
    const ref = useRef(null);
    useEffect(() => {
        if (!ref.current) return;
        const inst = echarts.init(ref.current, 'dark');
        inst.setOption({ backgroundColor: 'transparent', animation: false, ...buildOption() });
        const ro = new ResizeObserver(() => requestAnimationFrame(() => inst.resize()));
        ro.observe(ref.current);
        return () => { ro.disconnect(); inst.dispose(); };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, deps);
    return ref;
}

// Split a value series into two null-masked arrays so a line can be
// rendered as a green "above zero" segment + a red "below zero" segment
// WITHOUT ECharts' visualMap gradient machinery (see useEChart comment
// above for why that machinery proved unreliable here). connectNulls
// stays false so each segment only draws where it has real data.
function splitByZero(values) {
    const pos = values.map((v) => (v >= 0 ? v : null));
    const neg = values.map((v) => (v <= 0 ? v : null));
    return { pos, neg };
}

const darkTooltip = { backgroundColor: 'rgba(15,20,25,0.96)', borderColor: 'rgba(122,200,220,0.4)', textStyle: { color: '#fff', fontSize: 11 } };

function TierChip({ cardType }) {
    const t = CARD_TIERS[cardType] || CARD_TIERS.BASE;
    return (
        <Stack direction="row" alignItems="center" spacing={0.5} sx={{ display: 'inline-flex', px: 0.9, py: 0.35, borderRadius: 0.7, bgcolor: `${t.accent}1a`, border: `1px solid ${t.accent}55` }}>
            <Box sx={{ width: 7, height: 7, borderRadius: '50%', bgcolor: t.accent }} />
            <Typography sx={{ fontSize: 10.5, fontWeight: 700, letterSpacing: 0.5, color: 'rgba(255,255,255,0.9)', lineHeight: 1 }}>{t.label}</Typography>
        </Stack>
    );
}

function IdStat({ label, value, valueColor }) {
    return (
        <Stack spacing={0.3} sx={{ minWidth: 0, alignItems: 'flex-start' }}>
            <Typography sx={{ ...sectionLabel, fontSize: 10.5, whiteSpace: 'nowrap' }}>{label}</Typography>
            <Typography sx={{ fontFamily: FONT_MONO, color: valueColor || '#dff5ff', fontSize: 15, fontWeight: 600, fontVariantNumeric: 'tabular-nums', lineHeight: 1, whiteSpace: 'nowrap' }}>{value}</Typography>
        </Stack>
    );
}

// ── Tab 1: Financial & Yield ────────────────────────────────────────

function KpiMicroCard({ label, value, valueColor, spark, sparkSign, sub }) {
    const vColor = valueColor || '#dff5ff';
    return (
        <Box sx={{
            ...cardSx, p: 1.2, display: 'flex', flexDirection: 'column', gap: 0.5, minWidth: 0,
            position: 'relative',
            '&::before': {
                content: '""', position: 'absolute', top: 0, left: 0, right: 0, height: 2,
                background: `linear-gradient(90deg, ${ACCENT}55, ${ACCENT_2}33, transparent)`,
            },
        }}>
            <Typography sx={{ ...sectionLabel, fontSize: 10.5, whiteSpace: 'nowrap' }}>{label}</Typography>
            <Typography sx={{
                fontFamily: FONT_MONO, color: vColor, fontSize: 20, fontWeight: 600,
                fontVariantNumeric: 'tabular-nums', lineHeight: 1, whiteSpace: 'nowrap',
                textShadow: `0 0 14px ${vColor}44`,
            }}>{value}</Typography>
            {spark && spark.length > 1
                ? <RowSparkline points={spark} sign={sparkSign ?? spark[spark.length - 1]} width={110} height={20} ariaLabel={`${label} trend`} />
                : <Box sx={{ height: 20 }} />}
            {sub && <Typography sx={{ fontFamily: FONT_MONO, color: 'rgba(255,255,255,0.38)', fontSize: 9.5, lineHeight: 1.1 }}>{sub}</Typography>}
        </Box>
    );
}

function FinancialTab({ patron, rounds }) {
    const stats = useMemo(() => patronTodayStats(rounds, patron.patronId), [rounds, patron.patronId]);
    const mech = useMemo(() => patronBetMechanics(rounds, patron.patronId), [rounds, patron.patronId]);
    const series = useMemo(() => patronFinancialSeries(rounds, patron.patronId, { bucketMinutes: 30 }), [rounds, patron.patronId]);

    const expectedHold = stats.wager ? (stats.theo / stats.wager) * 100 : 0;
    const actualHold = stats.holdPct ?? 0;

    // Trajectory — PLAYER perspective per spec (green above 0 = player up).
    // Rendered as two masked line segments (see splitByZero) instead of
    // an ECharts visualMap gradient — the gradient approach crashed
    // getVisualGradient() for some patrons' data shapes even with a
    // "does it cross zero" guard, so this sidesteps that machinery
    // entirely rather than chasing more edge cases.
    const trajRef = useEChart(() => {
        const playerCum = series.map((s) => -s.cumActual);
        const { pos, neg } = splitByZero(playerCum);
        return {
            grid: { left: 64, right: 64, top: 34, bottom: 28 },
            legend: { top: 2, textStyle: { color: 'rgba(255,255,255,0.8)', fontSize: 11 }, data: ['Turnover', 'Player up', 'Player down', 'Theo (expected)'] },
            tooltip: { trigger: 'axis', ...darkTooltip },
            xAxis: { type: 'category', data: series.map((s) => s.label), axisLabel: { color: 'rgba(255,255,255,0.65)', fontSize: 10 }, axisLine: { lineStyle: { color: 'rgba(255,255,255,0.15)' } } },
            yAxis: [
                { type: 'value', name: 'Turnover', axisLabel: { color: 'rgba(255,255,255,0.5)', fontSize: 10, formatter: (v) => fmtCurrency(v) }, splitLine: { show: false } },
                { type: 'value', name: 'Player W/L', axisLabel: { color: 'rgba(255,255,255,0.7)', fontSize: 10, formatter: (v) => fmtCurrency(v) }, splitLine: { lineStyle: { color: 'rgba(255,255,255,0.06)' } } },
            ],
            series: [
                { name: 'Turnover', type: 'bar', data: series.map((s) => s.turnover), itemStyle: { color: C.blue, opacity: 0.6, borderRadius: [3, 3, 0, 0] }, barMaxWidth: 26 },
                { name: 'Player up', type: 'line', yAxisIndex: 1, smooth: true, showSymbol: false, connectNulls: false,
                    data: pos, lineStyle: { width: 2.2, color: C.green }, itemStyle: { color: C.green }, areaStyle: { opacity: 0.16, color: C.green } },
                { name: 'Player down', type: 'line', yAxisIndex: 1, smooth: true, showSymbol: false, connectNulls: false,
                    data: neg, lineStyle: { width: 2.2, color: C.red }, itemStyle: { color: C.red }, areaStyle: { opacity: 0.16, color: C.red } },
                { name: 'Theo (expected)', type: 'line', yAxisIndex: 1, showSymbol: false,
                    data: series.map((s) => -s.cumTheo), lineStyle: { width: 1.6, type: 'dashed', color: C.gold }, itemStyle: { color: C.gold } },
            ],
        };
    }, [series]);

    // Hold-deviation gauge.
    const gaugeRef = useEChart(() => ({
        series: [{
            type: 'gauge', startAngle: 200, endAngle: -20, min: -10, max: 20, splitNumber: 6,
            radius: '95%', center: ['50%', '62%'],
            axisLine: { lineStyle: { width: 14, color: [[(0 - -10) / 30, C.red], [(4 - -10) / 30, C.green], [1, C.gold]] } },
            pointer: { itemStyle: { color: '#dff5ff' }, width: 4, length: '58%' },
            axisTick: { distance: -14, length: 4, lineStyle: { color: 'rgba(255,255,255,0.4)' } },
            splitLine: { distance: -18, length: 10, lineStyle: { color: 'rgba(255,255,255,0.4)', width: 1 } },
            axisLabel: { distance: -34, color: 'rgba(255,255,255,0.6)', fontSize: 9 },
            detail: { valueAnimation: false, formatter: (v) => `${v.toFixed(1)}%`, color: actualHold < 0 ? C.red : '#dff5ff', fontSize: 20, offsetCenter: [0, '38%'] },
            title: { show: false },
            data: [{ value: Number(actualHold.toFixed(1)) }],
        }],
    }), [actualHold]);

    // Sparklines for micro-cards.
    const netSpark = series.map((s) => s.cumActual);
    const turnoverSpark = series.map((s) => s.turnover);
    const theoSpark = series.map((s) => s.cumTheo);

    return (
        <Box sx={{ p: 1.4, display: 'flex', flexDirection: 'column', gap: 1.4 }}>
            {/* KPI micro-card ribbon */}
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'repeat(2, 1fr)', md: 'repeat(5, 1fr)' }, gap: 1 }}>
                <KpiMicroCard label="Net actual (casino)" value={fmtCurrency(stats.actual)} valueColor={colorForWin(stats.actual)} spark={netSpark} />
                <KpiMicroCard label="Turnover" value={fmtCurrency(stats.wager)} spark={turnoverSpark} sparkSign={1} sub={`${stats.hands} hands`} />
                <KpiMicroCard label="Theo win" value={fmtCurrency(stats.theo)} spark={theoSpark} sparkSign={1} sub={`luck Δ ${fmtCurrency(stats.luck)}`} />
                <KpiMicroCard label="Avg bet" value={fmtCurrency(mech.avgBet)} sub={`max ${fmtCurrency(mech.maxBet)} · min ${fmtCurrency(mech.minBet)}`} />
                <KpiMicroCard label="Bet spread" value={`${mech.spreadRatio.toFixed(1)} : 1`}
                    valueColor={mech.spreadRatio > 15 ? C.gold : '#dff5ff'}
                    sub={mech.spreadRatio > 15 ? '⚠ exceeds 15:1 surveillance trigger' : 'within normal band'} />
            </Box>
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '2fr 1fr' }, gap: 1.4 }}>
                <Box sx={cardSx}>
                    <Typography sx={sectionTitleSx}>Cumulative performance trajectory · player perspective (green = player up) · gold dash = theo</Typography>
                    <div ref={trajRef} style={{ width: '100%', height: 250 }} />
                </Box>
                <Box sx={cardSx}>
                    <Typography sx={sectionTitleSx}>Hold deviation · actual vs expected {expectedHold.toFixed(1)}%</Typography>
                    <div ref={gaugeRef} style={{ width: '100%', height: 210 }} />
                    <Typography sx={{ px: 1.2, pb: 1, color: 'rgba(255,255,255,0.42)', fontSize: 10.5 }}>
                        Cash in {fmtCurrency(patron.buyIn ?? 0)} · cash out {fmtCurrency(patron.cashOut ?? 0)}
                    </Typography>
                </Box>
            </Box>
        </Box>
    );
}

// ── Tab 2: Behavioral & Surveillance ────────────────────────────────

function BehaviorTab({ patron, rounds, allPatronIds }) {
    const profile = useMemo(() => patronBehaviorProfile(rounds, patron.patronId), [rounds, patron.patronId]);
    const baseline = useMemo(() => populationBaselineProfile(rounds, allPatronIds), [rounds, allPatronIds]);
    const dealers = useMemo(() => patronDealerStats(rounds, patron.patronId), [rounds, patron.patronId]);
    const myRounds = useMemo(() => (rounds || []).filter((r) => r.patronId === patron.patronId), [rounds, patron.patronId]);

    // Radar — normalize each axis so baseline sits mid-chart.
    const radarRef = useEChart(() => {
        const axes = [
            ['Aggressiveness', 'aggressiveness'], ['Volume', 'volume'], ['Side-bets', 'sideBetShare'],
            ['Volatility', 'volatility'], ['Pace', 'pace'], ['Win rate', 'winRate'],
        ];
        const norm = (k) => { const cap = Math.max(profile[k], baseline[k] * 2, 1e-9); return { p: (profile[k] / cap) * 100, b: (baseline[k] / cap) * 100 }; };
        const vals = axes.map(([, k]) => norm(k));
        return {
            tooltip: { ...darkTooltip },
            radar: {
                indicator: axes.map(([label]) => ({ name: label, max: 100 })),
                radius: '68%', splitNumber: 4,
                axisName: { color: 'rgba(255,255,255,0.7)', fontSize: 10.5, fontWeight: 700 },
                splitArea: { areaStyle: { color: ['rgba(255,255,255,0.02)', 'rgba(255,255,255,0.04)'] } },
                splitLine: { lineStyle: { color: 'rgba(255,255,255,0.1)' } },
                axisLine: { lineStyle: { color: 'rgba(255,255,255,0.15)' } },
            },
            series: [{
                type: 'radar',
                data: [
                    { name: 'Avg VIP baseline', value: vals.map((v) => v.b), lineStyle: { color: 'rgba(255,255,255,0.45)', width: 1.4 }, itemStyle: { color: 'rgba(255,255,255,0.45)' }, areaStyle: { opacity: 0 } },
                    { name: patron.patronId, value: vals.map((v) => v.p), lineStyle: { color: C.cyan, width: 2 }, itemStyle: { color: C.cyan }, areaStyle: { color: C.cyan, opacity: 0.22 } },
                ],
            }],
            legend: { bottom: 0, textStyle: { color: 'rgba(255,255,255,0.7)', fontSize: 10.5 } },
        };
    }, [profile, baseline, patron.patronId]);

    // Bet size vs hand sequence scatter — color by outcome, size by
    // placement speed (faster placement = bigger node).
    const scatterRef = useEChart(() => ({
        grid: { left: 60, right: 20, top: 16, bottom: 30 },
        tooltip: { ...darkTooltip, formatter: (p) => { const r = myRounds[p.dataIndex]; return `Hand ${p.dataIndex + 1} · ${r.gametype}${r.table}<br/>Wager ${fmtCurrency(r.wager)} on ${r.betOption}<br/>Casino W/L <b style="color:${colorForWin(r.winLoss)}">${fmtCurrencyExact(r.winLoss)}</b><br/>Placed in ${(r.betPlacementMs / 1000).toFixed(1)}s`; } },
        xAxis: { type: 'value', name: 'Hand #', min: 1, max: Math.max(2, myRounds.length), axisLabel: { color: 'rgba(255,255,255,0.55)', fontSize: 10 }, splitLine: { show: false } },
        yAxis: { type: 'value', name: 'Wager', axisLabel: { color: 'rgba(255,255,255,0.55)', fontSize: 10, formatter: (v) => fmtCurrency(v) }, splitLine: { lineStyle: { color: 'rgba(255,255,255,0.06)' } } },
        series: [{
            type: 'scatter',
            data: myRounds.map((r, i) => ({
                value: [i + 1, r.wager],
                itemStyle: { color: (Number(r.winLoss) || 0) < 0 ? C.green : C.red, opacity: 0.8 },
                symbolSize: Math.max(4, Math.min(14, 14 - (r.betPlacementMs || 4000) / 700)),
            })),
        }],
    }), [myRounds]);

    // Dealer correlation — horizontal stacked bars.
    const dealerRef = useEChart(() => ({
        grid: { left: 8, right: 56, top: 26, bottom: 8, containLabel: true },
        legend: { top: 0, textStyle: { color: 'rgba(255,255,255,0.7)', fontSize: 10.5 }, data: ['Player net win', 'Casino net win'] },
        tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, ...darkTooltip },
        xAxis: { type: 'value', show: false },
        yAxis: { type: 'category', inverse: true, data: dealers.map((d) => d.dealer), axisLine: { show: false }, axisTick: { show: false }, axisLabel: { color: 'rgba(255,255,255,0.75)', fontSize: 11, fontWeight: 700 } },
        series: [
            { name: 'Player net win', type: 'bar', stack: 'x', data: dealers.map((d) => Math.max(0, -d.casinoWin)), itemStyle: { color: C.red, borderRadius: 2 }, barMaxWidth: 14,
                label: { show: true, position: 'insideLeft', fontSize: 9, color: '#fff', formatter: (p) => (p.value > 0 ? fmtCurrency(p.value) : '') } },
            { name: 'Casino net win', type: 'bar', stack: 'x', data: dealers.map((d) => Math.max(0, d.casinoWin)), itemStyle: { color: C.green, borderRadius: 2 }, barMaxWidth: 14,
                label: { show: true, position: 'insideRight', fontSize: 9, color: '#04210f', formatter: (p) => (p.value > 0 ? fmtCurrency(p.value) : '') } },
        ],
    }), [dealers]);

    return (
        <Box sx={{ p: 1.4, display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1.4fr 1fr' }, gap: 1.4 }}>
            <Box sx={cardSx}>
                <Typography sx={sectionTitleSx}>Player archetype vs avg VIP</Typography>
                <div ref={radarRef} style={{ width: '100%', height: 280 }} />
            </Box>
            <Box sx={cardSx}>
                <Typography sx={sectionTitleSx}>Bet size vs hand sequence · green = patron won · node size = placement speed</Typography>
                <div ref={scatterRef} style={{ width: '100%', height: 280 }} />
            </Box>
            <Box sx={cardSx}>
                <Typography sx={sectionTitleSx}>Dealer correlation · net by dealer</Typography>
                <div ref={dealerRef} style={{ width: '100%', height: 280 }} />
            </Box>
        </Box>
    );
}

// ── Tab 3: Game & Positional Preferences ────────────────────────────

function PreferencesTab({ patron, rounds }) {
    const sunburst = useMemo(() => patronSunburstData(rounds, patron.patronId), [rounds, patron.patronId]);
    const seats = useMemo(() => patronSeatStats(rounds, patron.patronId), [rounds, patron.patronId]);
    const maxSeatHands = Math.max(1, ...seats.map((s) => s.hands));

    const sunRef = useEChart(() => ({
        tooltip: { ...darkTooltip, formatter: (p) => `${p.treePathInfo.map((t) => t.name).filter(Boolean).join(' › ')}<br/>Wager ${fmtCurrency(p.value)}` },
        series: [{
            type: 'sunburst', data: sunburst, radius: ['12%', '92%'],
            itemStyle: { borderColor: 'rgba(8,22,36,0.9)', borderWidth: 1.5 },
            label: { color: '#dff5ff', fontSize: 9.5, minAngle: 12 },
            levels: [
                {},
                { r0: '12%', r: '38%', label: { fontSize: 11, fontWeight: 700 } },
                { r0: '38%', r: '68%' },
                { r0: '68%', r: '92%', label: { position: 'outside', silent: false }, itemStyle: { borderWidth: 1 } },
            ],
        }],
    }), [sunburst]);

    // Seat heatmap — a top-down semicircle of the 7 seats; heat = play
    // frequency (cool blue → magenta), tooltip carries win rate.
    const seatRef = useEChart(() => ({
        grid: { left: 0, right: 0, top: 0, bottom: 0 },
        tooltip: { ...darkTooltip, formatter: (p) => { const s = seats[p.dataIndex]; const wr = s.hands ? Math.round((s.patronWins / s.hands) * 100) : 0; return `<b>Seat ${s.seat}</b><br/>${s.hands} hands · patron win rate ${wr}%<br/>Casino W/L <span style="color:${colorForWin(s.casinoWin)}">${fmtCurrency(s.casinoWin)}</span>`; } },
        xAxis: { type: 'value', min: -1.4, max: 1.4, show: false },
        yAxis: { type: 'value', min: -0.25, max: 1.3, show: false },
        // seriesIndex:1 is load-bearing: without it this visualMap also
        // applies to the "table rim arc" custom series below, whose data
        // points are 2-D ([0,0]) and have no dimension-2 value — ECharts
        // tries to color an undefined value and throws inside its internal
        // gradient code (same crash class as the trajectory/bankroll
        // charts, different chart). Scoping to the scatter series only
        // (index 1, after the custom arc at index 0) fixes it.
        visualMap: [{ show: false, seriesIndex: 1, min: 0, max: maxSeatHands, inRange: { color: ['#2c4a66', '#7a4fd0', '#e84fd0'] }, dimension: 2 }],
        series: [
            { // table rim arc
                type: 'custom', silent: true,
                data: [[0, 0]],
                renderItem: (params, api) => {
                    const c = api.coord([0, 0]);
                    const r = api.size([1.15, 0])[0];
                    return { type: 'arc', shape: { cx: c[0], cy: c[1], r, startAngle: Math.PI, endAngle: 0 }, style: { stroke: 'rgba(122,200,220,0.35)', fill: 'transparent', lineWidth: 2 } };
                },
            },
            {
                type: 'scatter', symbolSize: 44,
                label: { show: true, formatter: (p) => `S${seats[p.dataIndex].seat}`, color: '#fff', fontWeight: 800, fontSize: 12 },
                data: seats.map((s, i) => {
                    const angle = Math.PI - (Math.PI * (i + 0.5)) / 7;
                    return [Math.cos(angle), Math.sin(angle), s.hands];
                }),
                itemStyle: { borderColor: 'rgba(255,255,255,0.35)', borderWidth: 1 },
            },
        ],
    }), [seats, maxSeatHands]);

    return (
        <Box sx={{ p: 1.4, display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1.2fr 1fr' }, gap: 1.4 }}>
            <Box sx={cardSx}>
                <Typography sx={sectionTitleSx}>Wager mix · game › bet type › outcome (ring width = wager)</Typography>
                <div ref={sunRef} style={{ width: '100%', height: 320 }} />
            </Box>
            <Box sx={cardSx}>
                <Typography sx={sectionTitleSx}>Seat preference · heat = play frequency</Typography>
                <div ref={seatRef} style={{ width: '100%', height: 320 }} />
            </Box>
        </Box>
    );
}

// ── Tab 4: Shoe drill-down ──────────────────────────────────────────

const BEAD_COLOR = { B: C.red, P: C.blue, T: C.green, W: C.green, L: C.red };

// Build a REAL Big Road layout from the shoe's hand sequence.
// Rules (classic casino scoreboard):
//   • Each streak of the same winner is one COLUMN, stacking DOWNWARD.
//   • Winner change → start the next column at row 0.
//   • A streak longer than ROWS (or blocked by an earlier dragon tail)
//     "turns" RIGHT along its current row — the dragon tail.
//   • Ties don't take a cell: they attach to the previous result as a
//     green slash + count.
// Non-BAC games map onto the same board: patron-win → P (blue),
// patron-loss → B (red).
function buildBigRoad(hands, rows) {
    const occ = new Set();
    const key = (c, r) => `${c}:${r}`;
    const nodes = [];
    let curWinner = null;
    let prevPos = null;
    let colAnchor = -1;         // starting column of the current streak
    let pendingTies = [];       // ties before the first non-tie hand
    for (const h of hands) {
        const w = h.winner === 'B' ? 'B'
            : h.winner === 'P' ? 'P'
            : h.winner === 'W' ? 'P'      // patron won → blue
            : h.winner === 'L' ? 'B'      // patron lost → red
            : null;                        // 'T' or unknown
        if (w == null) {
            if (nodes.length) nodes[nodes.length - 1].ties.push(h);
            else pendingTies.push(h);
            continue;
        }
        if (w !== curWinner) {
            curWinner = w;
            let c = colAnchor + 1;
            while (occ.has(key(c, 0))) c += 1;   // hop over old dragon tails
            colAnchor = c;
            prevPos = { c, r: 0 };
        } else {
            let { c, r } = prevPos;
            if (r + 1 < rows && !occ.has(key(c, r + 1))) r += 1;   // stack down
            else c += 1;                                            // dragon tail →
            prevPos = { c, r };
        }
        occ.add(key(prevPos.c, prevPos.r));
        nodes.push({ ...h, col: prevPos.c, row: prevPos.r, road: w, ties: pendingTies.splice(0) });
    }
    const maxCol = nodes.reduce((m, n) => Math.max(m, n.col), 0);
    return { nodes, cols: maxCol + 1 };
}

function ShoeTab({ patron, rounds }) {
    const shoes = useMemo(() => patronShoeLog(rounds, patron.patronId), [rounds, patron.patronId]);
    const [shoeId, setShoeId] = useState(null);
    useEffect(() => { setShoeId(shoes.length ? shoes[0].shoeId : null); }, [shoes]);
    const detail = useMemo(() => (shoeId ? shoeHandDetail(rounds, patron.patronId, shoeId) : []), [rounds, patron.patronId, shoeId]);
    const shoe = shoes.find((s) => s.shoeId === shoeId);

    // Big Road — real casino scoreboard layout (streak columns, dragon
    // tails, tie slashes). Hollow rings like the physical board; hands
    // the PATRON wagered get a gold glow + a gold wager label beneath,
    // ring thickness ∝ wager vs their shoe average.
    const roadRef = useEChart(() => {
        const road = buildBigRoad(detail, BIG_ROAD.ROWS);
        const cols = Math.max(10, road.cols);
        return {
            grid: { left: 8, right: 8, top: 8, bottom: 14 },
            tooltip: { ...darkTooltip, formatter: (p) => {
                const h = road.nodes[p.dataIndex];
                if (!h) return '';
                const tieStr = h.ties.length ? `<br/><span style="color:${C.green}">${h.ties.length} tie${h.ties.length > 1 ? 's' : ''} follow${h.ties.length > 1 ? '' : 's'}</span>` : '';
                return `<b>Hand ${h.i}</b> · winner <span style="color:${BEAD_COLOR[h.road]}">${h.road === 'B' ? 'Banker / casino' : 'Player / patron'}</span>${tieStr}` +
                    (h.mine
                        ? `<br/><span style="color:${C.gold};font-weight:800">PATRON WAGERED ${fmtCurrency(h.wager)}</span> on ${h.betOption}<br/>Net <span style="color:${colorForWin(h.winLoss)};font-weight:800">${fmtCurrencyExact(h.winLoss)}</span>`
                        : '<br/><span style="color:rgba(255,255,255,0.45)">no wager by patron</span>');
            } },
            xAxis: { type: 'value', min: -0.5, max: cols - 0.5, show: false,
                splitLine: { show: true, lineStyle: { color: 'rgba(255,255,255,0.04)' } } },
            yAxis: { type: 'value', min: -0.5, max: BIG_ROAD.ROWS - 0.5, show: false, inverse: true },
            series: [{
                type: 'scatter', symbolSize: BIG_ROAD.BEAD,
                data: road.nodes.map((h) => ({
                    value: [h.col, h.row],
                    itemStyle: {
                        // Hollow ring — Big Road convention (bead plate is solid).
                        color: h.mine ? `${C.gold}26` : 'rgba(8,18,32,0.35)',
                        borderColor: BEAD_COLOR[h.road],
                        borderWidth: BIG_ROAD.RING_WIDTH,
                        shadowBlur: h.mine ? 12 : 0,
                        shadowColor: h.mine ? 'rgba(245,158,11,0.85)' : 'transparent',
                    },
                    label: {
                        show: h.mine || h.ties.length > 0,
                        position: h.mine ? 'bottom' : 'right',
                        distance: 2,
                        fontSize: BIG_ROAD.WAGER_LABEL_SIZE,
                        fontWeight: 700,
                        color: h.mine ? C.gold : C.green,
                        formatter: h.mine
                            ? fmtCurrency(h.wager) + (h.ties.length ? ` /${h.ties.length}T` : '')
                            : `/${h.ties.length}T`,
                    },
                })),
            }],
        };
    }, [detail]);

    // Bankroll step line — PLAYER perspective, with dataZoom. Two masked
    // segments (see splitByZero) instead of a visualMap gradient — same
    // reasoning as the Financial tab's trajectory chart.
    const bankRef = useEChart(() => {
        const playerCum = detail.map((h) => -h.cum);
        const { pos, neg } = splitByZero(playerCum);
        return {
            grid: { left: 56, right: 16, top: 14, bottom: 44 },
            tooltip: { trigger: 'axis', ...darkTooltip, valueFormatter: (v) => fmtCurrency(v) },
            xAxis: { type: 'category', data: detail.map((h) => h.i), axisLabel: { color: 'rgba(255,255,255,0.5)', fontSize: 9 } },
            yAxis: { type: 'value', axisLabel: { color: 'rgba(255,255,255,0.6)', fontSize: 10, formatter: (v) => fmtCurrency(v) }, splitLine: { lineStyle: { color: 'rgba(255,255,255,0.06)' } } },
            dataZoom: [{ type: 'slider', height: 14, bottom: 8, borderColor: 'rgba(122,200,220,0.25)', backgroundColor: 'rgba(255,255,255,0.03)', fillerColor: 'rgba(122,223,255,0.15)', textStyle: { color: 'rgba(255,255,255,0.5)', fontSize: 9 } }],
            series: [
                { name: 'Player up', type: 'line', step: 'middle', showSymbol: false, connectNulls: false,
                    data: pos, lineStyle: { width: 2, color: C.green }, itemStyle: { color: C.green }, areaStyle: { opacity: 0.14, color: C.green } },
                { name: 'Player down', type: 'line', step: 'middle', showSymbol: false, connectNulls: false,
                    data: neg, lineStyle: { width: 2, color: C.red }, itemStyle: { color: C.red }, areaStyle: { opacity: 0.14, color: C.red } },
            ],
        };
    }, [detail]);

    // Wager vs shoe depth combo.
    const depthRef = useEChart(() => ({
        grid: { left: 56, right: 56, top: 26, bottom: 26 },
        legend: { top: 0, textStyle: { color: 'rgba(255,255,255,0.7)', fontSize: 10.5 }, data: ['Patron wager', 'Shoe penetration %'] },
        tooltip: { trigger: 'axis', ...darkTooltip },
        xAxis: { type: 'category', data: detail.map((h) => h.i), axisLabel: { color: 'rgba(255,255,255,0.5)', fontSize: 9 } },
        yAxis: [
            { type: 'value', name: 'Wager', axisLabel: { color: 'rgba(255,255,255,0.6)', fontSize: 10, formatter: (v) => fmtCurrency(v) }, splitLine: { show: false } },
            { type: 'value', name: 'Depth', min: 0, max: 100, axisLabel: { color: 'rgba(255,255,255,0.5)', fontSize: 10, formatter: '{value}%' }, splitLine: { lineStyle: { color: 'rgba(255,255,255,0.05)' } } },
        ],
        series: [
            { name: 'Patron wager', type: 'bar', data: detail.map((h) => h.wager), itemStyle: { color: C.blue, opacity: 0.75 }, barMaxWidth: 10 },
            { name: 'Shoe penetration %', type: 'line', yAxisIndex: 1, showSymbol: false, data: detail.map((h) => h.penetration), lineStyle: { color: C.gold, width: 1.6 } },
        ],
    }), [detail]);

    return (
        <Box sx={{ p: 1.4, display: 'flex', flexDirection: 'column', gap: 1.4 }}>
            {/* Section A — shoe master log */}
            <Box sx={{ ...cardSx }}>
                <Typography sx={sectionTitleSx}>Shoe-by-shoe master log · click a row to load the hand-level drill-down</Typography>
                <Box sx={{ ...scrollSx, maxHeight: 200 }}>
                    <Box component="table" sx={{ width: '100%', borderCollapse: 'separate', borderSpacing: 0 }}>
                        <Box component="thead" sx={{ position: 'sticky', top: 0, bgcolor: 'rgba(8,22,36,0.98)', zIndex: 1 }}>
                            <Box component="tr">
                                <Box component="th" sx={{ ...headSx, textAlign: 'left', pl: 1.2 }}>Shoe</Box>
                                <Box component="th" sx={{ ...headSx, textAlign: 'left' }}>Table</Box>
                                <Box component="th" sx={{ ...headSx, textAlign: 'left' }}>Dealer</Box>
                                <Box component="th" sx={{ ...headSx }}>Hands</Box>
                                <Box component="th" sx={{ ...headSx }}>Turnover</Box>
                                <Box component="th" sx={{ ...headSx }}>Theo</Box>
                                <Box component="th" sx={{ ...headSx }}>Actual</Box>
                                <Box component="th" sx={{ ...headSx }}>Max bet</Box>
                                <Box component="th" sx={{ ...headSx }}>Spread</Box>
                                <Box component="th" sx={{ ...headSx, pr: 1.2, textAlign: 'center' }}>Risk</Box>
                            </Box>
                        </Box>
                        <Box component="tbody">
                            {shoes.map((s) => (
                                <Box component="tr" key={s.shoeId} onClick={() => setShoeId(s.shoeId)}
                                    sx={{ cursor: 'pointer', bgcolor: s.shoeId === shoeId ? 'rgba(122,223,255,0.12)' : 'transparent', '&:hover': { bgcolor: s.shoeId === shoeId ? 'rgba(122,223,255,0.16)' : 'rgba(255,255,255,0.04)' } }}>
                                    <Box component="td" sx={{ ...cellSx, textAlign: 'left', pl: 1.2, color: '#dff5ff', fontWeight: 700 }}>{s.shoeId}</Box>
                                    <Box component="td" sx={{ ...cellSx, textAlign: 'left' }}>{s.label}</Box>
                                    <Box component="td" sx={{ ...cellSx, textAlign: 'left', color: 'rgba(255,255,255,0.7)' }}>{s.dealer}</Box>
                                    <Box component="td" sx={cellSx}>{s.hands}</Box>
                                    <Box component="td" sx={cellSx}>{fmtCurrency(s.turnover)}</Box>
                                    <Box component="td" sx={cellSx}>{fmtCurrency(s.theo)}</Box>
                                    <Box component="td" sx={{ ...cellSx, fontWeight: 800, color: colorForWin(s.actual) }}>{fmtCurrencyExact(s.actual)}</Box>
                                    <Box component="td" sx={cellSx}>{fmtCurrency(s.maxBet)}</Box>
                                    <Box component="td" sx={{ ...cellSx, color: s.spread > 20 ? C.gold : undefined }}>{s.spread ? `${s.spread.toFixed(1)}×` : '—'}</Box>
                                    <Box component="td" sx={{ ...cellSx, pr: 1.2, textAlign: 'center' }}>
                                        {s.riskFlag ? <WarningAmberIcon sx={{ fontSize: 15, color: C.gold }} /> : <Box component="span" sx={{ color: 'rgba(255,255,255,0.25)' }}>—</Box>}
                                    </Box>
                                </Box>
                            ))}
                            {shoes.length === 0 && (
                                <Box component="tr"><Box component="td" colSpan={10} sx={{ ...cellSx, textAlign: 'center', py: 3 }}>No shoe activity today.</Box></Box>
                            )}
                        </Box>
                    </Box>
                </Box>
            </Box>

            {/* Section B — hand-level drill-down for the selected shoe */}
            {shoe && (
                <>
                    <Stack direction="row" alignItems="center" spacing={1.4} sx={{ px: 0.4 }}>
                        <Box sx={{ width: 4, height: 15, bgcolor: C.gold, borderRadius: 0.5 }} />
                        <Typography sx={{ color: '#dff5ff', fontSize: 13, fontWeight: 800 }}>
                            Shoe {shoe.shoeId} · {shoe.label} · dealer {shoe.dealer} ·
                            net <Box component="span" sx={{ color: colorForWin(shoe.actual) }}> {fmtCurrencyExact(shoe.actual)}</Box>
                        </Typography>
                    </Stack>
                    <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1.1fr 1fr' }, gap: 1.4 }}>
                        <Box sx={cardSx}>
                            <Typography sx={sectionTitleSx}>Big Road · streak columns, ties as /nT · gold glow + wager label = patron bet that hand</Typography>
                            <div ref={roadRef} style={{ width: '100%', height: CHART_H.bigRoad }} />
                        </Box>
                        <Box sx={cardSx}>
                            <Typography sx={sectionTitleSx}>Bankroll trajectory · player perspective · drag slider to zoom</Typography>
                            <div ref={bankRef} style={{ width: '100%', height: CHART_H.bankroll }} />
                        </Box>
                    </Box>
                    <Box sx={cardSx}>
                        <Typography sx={sectionTitleSx}>Wager size vs shoe depth · flat bars then late spikes = advantage-play signature</Typography>
                        <div ref={depthRef} style={{ width: '100%', height: CHART_H.shoeDepth }} />
                    </Box>
                </>
            )}
        </Box>
    );
}

// ── Panel shell ─────────────────────────────────────────────────────

const TABS = ['Financial', 'Behavioral', 'Preferences', 'Shoes'];

export default function Player360Panel({ patron, rounds, allPatronIds }) {
    const [tab, setTab] = useState(0);
    useEffect(() => { setTab(0); }, [patron?.patronId]);

    const mech = useMemo(() => (patron ? patronBetMechanics(rounds, patron.patronId) : null), [rounds, patron]);
    const stats = useMemo(() => (patron ? patronTodayStats(rounds, patron.patronId) : null), [rounds, patron]);
    const lastRound = useMemo(() => {
        if (!patron) return null;
        let last = null;
        for (const r of rounds || []) if (r.patronId === patron.patronId && (!last || r.ts > last.ts)) last = r;
        return last;
    }, [rounds, patron]);

    if (!patron) {
        return (
            <Box sx={{ p: 2.5, borderRadius: 2, bgcolor: 'rgba(8, 22, 36, 0.55)', border: '1px dashed rgba(122, 200, 220, 0.22)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 1.4 }}>
                <Box sx={{ width: 34, height: 34, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px dashed rgba(122,200,220,0.35)', color: 'rgba(122,223,255,0.55)', flexShrink: 0 }}>
                    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                </Box>
                <Box>
                    <Typography sx={{ color: 'rgba(255,255,255,0.7)', fontSize: 13, fontWeight: 700 }}>Pick a player to open the Player 360 workspace</Typography>
                    <Typography sx={{ color: 'rgba(255,255,255,0.4)', fontSize: 11 }}>Financial yield · behavioral risk · game & seat preferences · shoe-by-shoe drill-down</Typography>
                </Box>
            </Box>
        );
    }

    // Risk score 0-100 — spread + side-bet appetite + volatility + hot luck.
    const risk = Math.min(100, Math.round(
        (mech?.spreadRatio || 0) * 2.5 +
        (mech?.sideBetShare || 0) * 30 +
        (mech?.avgBet ? (mech.betStdev / mech.avgBet) * 25 : 0) +
        (stats && stats.luck < 0 ? Math.min(30, -stats.luck / 5000) : 0)
    ));
    const riskColor = risk >= 60 ? C.red : risk >= 30 ? C.gold : C.green;
    const riskBand = risk >= 60 ? 'HIGH' : risk >= 30 ? 'WATCH' : 'LOW';

    return (
        <Box sx={{ ...glass }}>
            {/* Identity & status bar — persists across all four tabs. */}
            <Stack direction="row" alignItems="center" spacing={2.2} sx={{
                px: 1.6, py: 1.2, flexWrap: 'wrap', rowGap: 1,
                borderBottom: '1px solid rgba(122,223,255,0.14)',
                background: `linear-gradient(90deg, ${ACCENT}14 0%, ${ACCENT_2}0d 40%, rgba(8,22,36,0) 70%)`,
            }}>
                <Stack direction="row" alignItems="center" spacing={1.1}>
                    <Box sx={{ ...accentBar, height: 24 }} />
                    <Typography sx={{ fontFamily: FONT_DISPLAY, color: '#dff5ff', fontSize: 21, fontWeight: 700, letterSpacing: 1.8, lineHeight: 1 }}>{patron.patronId}</Typography>
                    <TierChip cardType={patron.cardType} />
                </Stack>
                <Tooltip title="Composite of bet spread, side-bet appetite, wagering volatility, and luck-vs-theo. Tune weights in Player360Panel.">
                    <Stack spacing={0.2} sx={{ alignItems: 'flex-start' }}>
                        <Typography sx={{ ...sectionLabel, fontSize: 10.5 }}>Risk score</Typography>
                        <Stack direction="row" alignItems="center" spacing={0.7}>
                            <Box sx={{ width: 54, height: 6, borderRadius: 3, bgcolor: 'rgba(255,255,255,0.1)', position: 'relative', overflow: 'hidden' }}>
                                <Box sx={{ position: 'absolute', inset: 0, width: `${risk}%`, bgcolor: riskColor, borderRadius: 3 }} />
                            </Box>
                            <Typography sx={{ fontFamily: FONT_MONO, color: riskColor, fontSize: 13, fontWeight: 700, lineHeight: 1, textShadow: `0 0 10px ${riskColor}55` }}>{risk} · {riskBand}</Typography>
                        </Stack>
                    </Stack>
                </Tooltip>
                <IdStat label="Total buy-in" value={fmtCurrency(patron.buyIn ?? 0)} />
                <IdStat label="Net W/L (casino)" value={fmtCurrency(patron.cumWin)} valueColor={colorForWin(patron.cumWin)} />
                <IdStat label="Turnover" value={fmtCurrency(patron.cumWager)} />
                <IdStat label="Active table · seat" value={lastRound ? `${lastRound.gametype}${lastRound.table} · S${lastRound.seat}` : '—'} />
                <Box sx={{ flex: 1 }} />
                <Typography sx={{ color: 'rgba(255,255,255,0.5)', fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap' }}>
                    {patron.segment} · on floor {fmtDuration(patron.signInMinsAgo)}
                </Typography>
            </Stack>

            <Tabs value={tab} onChange={(_, v) => setTab(v)} variant="scrollable" scrollButtons={false}
                sx={{
                    minHeight: 38, borderBottom: '1px solid rgba(122,223,255,0.15)', px: 0.6,
                    '& .MuiTabs-indicator': { background: `linear-gradient(90deg, ${ACCENT}, ${ACCENT_2})`, height: 2, boxShadow: '0 0 8px rgba(122,223,255,0.6)' },
                    '& .MuiTab-root': { minHeight: 38, py: 0, px: 1.8, fontFamily: FONT_DISPLAY, fontSize: 13, fontWeight: 700, letterSpacing: 1.4, textTransform: 'uppercase', color: 'rgba(202,232,255,0.5)' },
                    '& .Mui-selected': { color: '#dff5ff', textShadow: '0 0 12px rgba(122,223,255,0.5)' },
                }}>
                {TABS.map((t) => <Tab key={t} label={t} />)}
            </Tabs>

            {tab === 0 && <FinancialTab patron={patron} rounds={rounds} />}
            {tab === 1 && <BehaviorTab patron={patron} rounds={rounds} allPatronIds={allPatronIds} />}
            {tab === 2 && <PreferencesTab patron={patron} rounds={rounds} />}
            {tab === 3 && <ShoeTab patron={patron} rounds={rounds} />}
        </Box>
    );
}
