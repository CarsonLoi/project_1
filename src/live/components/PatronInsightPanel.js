// Live Casino Win — Patron Insight Panel.
// ========================================
// Full-width band under the heatmap/Top-X row. One patron, six lenses:
//
//   Overview — KPI tiles management actually asks for (actual vs THEO,
//              luck delta, hold %, avg bet, pace) + day trajectory +
//              top tables strip
//   Hands    — hand-by-hand ledger with running total (latest first)
//   By Bet   — bet-option mix: hands, wager, hit rate, casino W/L
//   By Table — where the money moved: per-table hands/wager/W/L
//   YTD      — monthly wager + net W/L combo chart with summary strip
//   Lifetime — tenure, visits, lifetime wager/net, best & worst day
//
// Sign convention everywhere: CASINO perspective (positive = casino won).
// "Theo" uses the HOUSE_EDGE dictionary in winAggregates — tune per venue.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as echarts from 'echarts';
import { Box, Stack, Typography, Tabs, Tab, Tooltip } from '@mui/material';
import { LIVE_FONTS } from '../constants/fontSizes';
import { CARD_TIERS, colorForWin, fmtCurrency, fmtCurrencyExact } from '../constants/winPalette';
import {
    fmtDuration, patronCumSeries, betOptionStats,
    patronTodayStats, patronTableStats,
} from '../utils/winAggregates';

const F = LIVE_FONTS.deep;

const headSx = { py: 0.6, px: 0.9, fontSize: F.head, fontWeight: 800, letterSpacing: 0.4, textTransform: 'uppercase', color: 'rgba(255,255,255,0.55)', borderBottom: '1px solid rgba(255,255,255,0.15)', textAlign: 'right', whiteSpace: 'nowrap' };
const cellSx = { py: 0.5, px: 0.9, fontSize: F.cell, fontVariantNumeric: 'tabular-nums', borderBottom: '1px solid rgba(255,255,255,0.05)', textAlign: 'right', whiteSpace: 'nowrap' };
const scrollSx = {
    overflowY: 'auto',
    scrollbarColor: 'rgba(122,223,255,0.35) rgba(255,255,255,0.04)', scrollbarWidth: 'thin',
    '&::-webkit-scrollbar': { width: 9 },
    '&::-webkit-scrollbar-thumb': { bgcolor: 'rgba(122,223,255,0.35)', borderRadius: 3, border: '2px solid transparent', backgroundClip: 'padding-box' },
};

function fmtTs(iso) {
    if (!iso) return '—';
    try { const d = new Date(iso); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`; } catch { return '—'; }
}

// ── Shared building blocks ──────────────────────────────────────────

// KPI tile — caption, big tabular number, optional sub-caption. All
// tiles share one geometry so the Overview grid reads as a unit.
function KpiTile({ label, value, valueColor, sub, subColor, hint }) {
    const tile = (
        <Box sx={{
            p: 1.2, borderRadius: 1.6, minWidth: 0,
            bgcolor: 'rgba(255,255,255,0.03)',
            border: '1px solid rgba(122,200,220,0.14)',
        }}>
            <Typography sx={{ color: 'rgba(255,255,255,0.5)', fontSize: 10, fontWeight: 800, letterSpacing: 0.6, textTransform: 'uppercase', whiteSpace: 'nowrap', mb: 0.4 }}>
                {label}
            </Typography>
            <Typography sx={{ color: valueColor || '#dff5ff', fontSize: 21, fontWeight: 800, fontVariantNumeric: 'tabular-nums', lineHeight: 1.05, whiteSpace: 'nowrap' }}>
                {value}
            </Typography>
            {sub && (
                <Typography sx={{ color: subColor || 'rgba(255,255,255,0.42)', fontSize: 10.5, fontWeight: 600, lineHeight: 1.2, mt: 0.3 }}>
                    {sub}
                </Typography>
            )}
        </Box>
    );
    return hint ? <Tooltip title={hint} placement="top">{tile}</Tooltip> : tile;
}

function TierChip({ cardType }) {
    const t = CARD_TIERS[cardType] || CARD_TIERS.BASE;
    return (
        <Stack direction="row" alignItems="center" spacing={0.5} sx={{
            display: 'inline-flex', px: 0.9, py: 0.35, borderRadius: 0.7,
            bgcolor: `${t.accent}1a`, border: `1px solid ${t.accent}55`,
        }}>
            <Box sx={{ width: 7, height: 7, borderRadius: '50%', bgcolor: t.accent }} />
            <Typography sx={{ fontSize: 10.5, fontWeight: 700, letterSpacing: 0.5, color: 'rgba(255,255,255,0.9)', lineHeight: 1 }}>
                {t.label}
            </Typography>
        </Stack>
    );
}

// Diverging horizontal bar chart — one bar per category, colored by sign
// (casino win = green, casino loss = red). Used to make "where is the
// money moving" visually scannable instead of a wall of table numbers.
// `items` = [{ label, value }], already sorted by caller (desc by |value|).
function DivergingBarChart({ items, height }) {
    const ref = useRef(null);
    const h = height || Math.max(120, items.length * 30 + 30);
    useEffect(() => {
        if (!ref.current) return;
        let inst = echarts.getInstanceByDom(ref.current);
        if (!inst) inst = echarts.init(ref.current, 'dark');
        const cats = items.map((it) => it.label);
        const vals = items.map((it) => it.value);
        inst.setOption({
            backgroundColor: 'transparent', animation: false,
            grid: { left: 8, right: 60, top: 8, bottom: 8, containLabel: true },
            xAxis: { type: 'value', show: false },
            yAxis: {
                type: 'category', data: cats, inverse: true,
                axisLine: { show: false }, axisTick: { show: false },
                axisLabel: { color: 'rgba(255,255,255,0.75)', fontSize: 11, fontWeight: 700 },
            },
            tooltip: {
                trigger: 'item', backgroundColor: 'rgba(15,20,25,0.96)', borderColor: 'rgba(122,200,220,0.4)',
                textStyle: { color: '#fff', fontSize: 11 },
                formatter: (p) => `<b>${p.name}</b><br/>${fmtCurrency(p.value)}`,
            },
            series: [{
                type: 'bar', data: vals, barMaxWidth: 16,
                itemStyle: { color: (p) => colorForWin(p.value), borderRadius: 3 },
                label: {
                    show: true, position: 'right', color: 'rgba(255,255,255,0.85)',
                    fontSize: 11, fontWeight: 800, fontFamily: 'inherit',
                    formatter: (p) => fmtCurrency(p.value),
                },
            }],
        }, { notMerge: true });
        const ro = new ResizeObserver(() => requestAnimationFrame(() => inst.resize()));
        ro.observe(ref.current);
        return () => ro.disconnect();
    }, [items]);
    return <div ref={ref} style={{ width: '100%', height: h }} />;
}

// Three-horizon comparison — Today / YTD / Lifetime, grouped bars. Wager
// (always positive) on the left axis; Net W/L (diverging) as separately
// colored bars on the right — answers "is this player's value climbing
// or fading" at a glance.
function HorizonCompareChart({ today, ytd, lifetime }) {
    const ref = useRef(null);
    useEffect(() => {
        if (!ref.current) return;
        let inst = echarts.getInstanceByDom(ref.current);
        if (!inst) inst = echarts.init(ref.current, 'dark');
        const cats = ['Today', 'YTD', 'Lifetime'];
        const wagers = [today.wager, ytd.wager, lifetime.wager];
        const nets = [today.net, ytd.net, lifetime.net];
        inst.setOption({
            backgroundColor: 'transparent', animation: false,
            grid: { left: 64, right: 64, top: 32, bottom: 30 },
            legend: { top: 2, textStyle: { color: 'rgba(255,255,255,0.8)', fontSize: 11 }, data: ['Wager', 'Net W/L'] },
            tooltip: { trigger: 'axis', backgroundColor: 'rgba(15,20,25,0.96)', borderColor: 'rgba(122,200,220,0.4)', textStyle: { color: '#fff', fontSize: 11 } },
            xAxis: { type: 'category', data: cats, axisLabel: { color: 'rgba(255,255,255,0.8)', fontSize: 12, fontWeight: 700 }, axisLine: { lineStyle: { color: 'rgba(255,255,255,0.15)' } } },
            yAxis: [
                { type: 'value', name: 'Wager', axisLabel: { color: 'rgba(255,255,255,0.55)', fontSize: 10, formatter: (v) => fmtCurrency(v) }, splitLine: { show: false } },
                { type: 'value', name: 'Net W/L', axisLabel: { color: 'rgba(255,255,255,0.7)', fontSize: 10, formatter: (v) => fmtCurrency(v) }, splitLine: { lineStyle: { color: 'rgba(255,255,255,0.06)' } } },
            ],
            series: [
                { name: 'Wager', type: 'bar', data: wagers, barMaxWidth: 40, itemStyle: { color: 'rgba(122,223,255,0.55)', borderRadius: [4, 4, 0, 0] } },
                { name: 'Net W/L', type: 'bar', yAxisIndex: 1, data: nets, barMaxWidth: 40, itemStyle: { color: (p) => colorForWin(p.value), borderRadius: [4, 4, 0, 0] } },
            ],
        }, { notMerge: true });
        const ro = new ResizeObserver(() => requestAnimationFrame(() => inst.resize()));
        ro.observe(ref.current);
        return () => ro.disconnect();
    }, [today, ytd, lifetime]);
    return <div ref={ref} style={{ width: '100%', height: 220 }} />;
}

// Day-trajectory area line (cumulative casino W/L, one point per hand).
function DaySparkline({ points, height = 130 }) {
    const ref = useRef(null);
    useEffect(() => {
        if (!ref.current) return;
        let inst = echarts.getInstanceByDom(ref.current);
        if (!inst) inst = echarts.init(ref.current, 'dark');
        const cums = points.map((p) => p.cum);
        const min = Math.min(0, ...cums);
        const max = Math.max(0, ...cums);
        inst.setOption({
            backgroundColor: 'transparent', animation: false,
            grid: { left: 8, right: 8, top: 8, bottom: 8, containLabel: false },
            xAxis: { type: 'category', show: false, data: points.map((_, i) => i) },
            yAxis: { type: 'value', show: false, min, max },
            tooltip: {
                trigger: 'axis',
                backgroundColor: 'rgba(15,20,25,0.96)', borderColor: 'rgba(122,200,220,0.4)',
                textStyle: { color: '#fff', fontSize: 11 },
                formatter: (params) => {
                    const i = params[0].dataIndex; const p = points[i];
                    if (!p) return '';
                    return `<div style="font-weight:800">Hand ${i + 1} · ${new Date(p.ts).toLocaleTimeString()}</div>
                            <div style="margin-top:3px;color:${colorForWin(p.cum)};font-weight:800">Cum: ${fmtCurrency(p.cum)}</div>`;
                },
            },
            series: [
                { type: 'line', data: points.map(() => 0), showSymbol: false, silent: true,
                    lineStyle: { color: 'rgba(255,255,255,0.14)', width: 1, type: 'dashed' } },
                { type: 'line', data: cums, showSymbol: false,
                    lineStyle: { color: '#7adfff', width: 1.8 },
                    areaStyle: { color: 'rgba(122,223,255,0.13)' } },
            ],
        }, { notMerge: true });
        const ro = new ResizeObserver(() => requestAnimationFrame(() => inst.resize()));
        ro.observe(ref.current);
        return () => ro.disconnect();
    }, [points]);
    return <div ref={ref} style={{ width: '100%', height }} />;
}

// ── Tabs ────────────────────────────────────────────────────────────

function OverviewTab({ patron, rounds }) {
    const stats = useMemo(() => patronTodayStats(rounds, patron.patronId), [rounds, patron.patronId]);
    const cumSeries = useMemo(() => patronCumSeries(rounds, patron.patronId), [rounds, patron.patronId]);
    const tableStats = useMemo(() => patronTableStats(rounds, patron.patronId).slice(0, 5), [rounds, patron.patronId]);
    const luckColor = stats.luck < 0 ? '#e88090' : stats.luck > 0 ? '#7dc267' : 'rgba(255,255,255,0.6)';
    return (
        <Box sx={{ p: 1.4, display: 'grid', gridTemplateColumns: { xs: '1fr', md: '2fr 1fr' }, gap: 1.4 }}>
            <Stack spacing={1.4} sx={{ minWidth: 0 }}>
                {/* KPI grid — 4 × 2. Theo/luck/hold are the management story:
                    "is this player beating expectation, and by how much?" */}
                <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 1 }}>
                    <KpiTile label="Casino W/L" value={fmtCurrency(stats.actual)} valueColor={colorForWin(stats.actual)} sub="today · casino perspective" />
                    <KpiTile label="Total wager" value={fmtCurrency(stats.wager)} sub={`${stats.hands} hands · ${stats.tables} tables`} />
                    <KpiTile label="Theo win" value={fmtCurrency(stats.theo)} sub="expected @ house edge" hint="Σ wager × house edge per game — what the house expects to win from this play" />
                    <KpiTile label="Luck vs theo" value={fmtCurrency(stats.luck)} valueColor={luckColor}
                        sub={stats.luck < 0 ? 'patron running HOT' : 'within / above expectation'} subColor={luckColor}
                        hint="Actual − theo. Negative = patron is beating the math — worth watching." />
                    <KpiTile label="Avg bet" value={fmtCurrency(stats.avgBet)} sub={stats.pacePerHr ? `${stats.pacePerHr} hands / hr` : null} />
                    <KpiTile label="Hold %" value={stats.holdPct == null ? '—' : `${stats.holdPct.toFixed(1)}%`}
                        valueColor={colorForWin(stats.actual)} sub="actual ÷ wager" />
                    <KpiTile label="Best hand" value={fmtCurrencyExact(stats.bestHand)} valueColor={colorForWin(stats.bestHand)} sub="largest single casino win" />
                    <KpiTile label="Worst hand" value={fmtCurrencyExact(stats.worstHand)} valueColor={colorForWin(stats.worstHand)} sub="largest single casino loss" />
                </Box>
                {/* Day trajectory */}
                <Box sx={{ borderRadius: 1.6, bgcolor: 'rgba(255,255,255,0.02)', border: '1px solid rgba(122,200,220,0.12)' }}>
                    <Typography sx={{ px: 1.2, pt: 0.9, color: 'rgba(255,255,255,0.5)', fontSize: 10, fontWeight: 800, letterSpacing: 0.6, textTransform: 'uppercase' }}>
                        Cumulative W/L · today ({fmtTs(stats.firstTs)} → {fmtTs(stats.lastTs)})
                    </Typography>
                    <DaySparkline points={cumSeries} />
                </Box>
            </Stack>

            {/* Top tables — where today's money actually moved. */}
            <Box sx={{ borderRadius: 1.6, bgcolor: 'rgba(255,255,255,0.02)', border: '1px solid rgba(122,200,220,0.12)', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                <Typography sx={{ px: 1.2, py: 0.9, color: 'rgba(255,255,255,0.5)', fontSize: 10, fontWeight: 800, letterSpacing: 0.6, textTransform: 'uppercase', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                    Top tables today
                </Typography>
                <Box component="table" sx={{ width: '100%', borderCollapse: 'separate', borderSpacing: 0 }}>
                    <Box component="tbody">
                        {tableStats.map((t) => (
                            <Box component="tr" key={t.tableKey}>
                                <Box component="td" sx={{ ...cellSx, textAlign: 'left', pl: 1.2, color: '#dff5ff', fontWeight: 700 }}>{t.gametype}{t.table}</Box>
                                <Box component="td" sx={{ ...cellSx, color: 'rgba(255,255,255,0.6)' }}>{t.hands} h</Box>
                                <Box component="td" sx={{ ...cellSx, color: 'rgba(255,255,255,0.7)' }}>{fmtCurrency(t.wager)}</Box>
                                <Box component="td" sx={{ ...cellSx, pr: 1.2, fontWeight: 800, color: colorForWin(t.casinoWin) }}>{fmtCurrency(t.casinoWin)}</Box>
                            </Box>
                        ))}
                        {tableStats.length === 0 && (
                            <Box component="tr"><Box component="td" sx={{ ...cellSx, textAlign: 'center', py: 3, color: 'rgba(255,255,255,0.4)' }}>No table activity yet.</Box></Box>
                        )}
                    </Box>
                </Box>
                <Box sx={{ flex: 1 }} />
                <Typography sx={{ px: 1.2, py: 0.8, color: 'rgba(255,255,255,0.35)', fontSize: 10, borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                    Full breakdown in the “By Table” tab.
                </Typography>
            </Box>
        </Box>
    );
}

function HandsTab({ patron, rounds }) {
    const rows = useMemo(() => {
        const arr = [];
        let cum = 0;
        for (const r of rounds) {
            if (r.patronId !== patron.patronId) continue;
            cum += (Number(r.winLoss) || 0);
            arr.push({ ...r, cum });
        }
        return arr.reverse();   // latest first
    }, [patron.patronId, rounds]);
    return (
        <Box sx={{ ...scrollSx, maxHeight: 320 }}>
            <Box component="table" sx={{ width: '100%', borderCollapse: 'separate', borderSpacing: 0 }}>
                <Box component="thead" sx={{ position: 'sticky', top: 0, bgcolor: 'rgba(8,22,36,0.98)', zIndex: 1 }}>
                    <Box component="tr">
                        <Box component="th" sx={{ ...headSx, textAlign: 'left', pl: 1.4 }}>Time</Box>
                        <Box component="th" sx={{ ...headSx, textAlign: 'left' }}>Table</Box>
                        <Box component="th" sx={{ ...headSx, textAlign: 'left' }}>Bet</Box>
                        <Box component="th" sx={{ ...headSx }}>Wager</Box>
                        <Box component="th" sx={{ ...headSx }}>Casino W/L</Box>
                        <Box component="th" sx={{ ...headSx, pr: 1.4 }}>Running total</Box>
                    </Box>
                </Box>
                <Box component="tbody">
                    {rows.map((r, i) => (
                        <Box component="tr" key={i}>
                            <Box component="td" sx={{ ...cellSx, textAlign: 'left', pl: 1.4, color: 'rgba(255,255,255,0.6)' }}>{fmtTs(r.ts)}</Box>
                            <Box component="td" sx={{ ...cellSx, textAlign: 'left', color: '#dff5ff', fontWeight: 700 }}>{r.gametype}{r.table}</Box>
                            <Box component="td" sx={{ ...cellSx, textAlign: 'left', color: 'rgba(255,255,255,0.7)' }}>{r.betOption}</Box>
                            <Box component="td" sx={{ ...cellSx }}>{fmtCurrencyExact(r.wager)}</Box>
                            <Box component="td" sx={{ ...cellSx, color: colorForWin(r.winLoss), fontWeight: 800 }}>{fmtCurrencyExact(r.winLoss)}</Box>
                            <Box component="td" sx={{ ...cellSx, pr: 1.4, color: colorForWin(r.cum), fontWeight: 800, fontSize: F.cellStrong }}>{fmtCurrencyExact(r.cum)}</Box>
                        </Box>
                    ))}
                    {rows.length === 0 && (
                        <Box component="tr"><Box component="td" colSpan={6} sx={{ py: 4, textAlign: 'center', color: 'rgba(255,255,255,0.4)', fontSize: 13 }}>No hands recorded yet today.</Box></Box>
                    )}
                </Box>
            </Box>
        </Box>
    );
}

function ByBetTab({ patron, rounds }) {
    const stats = useMemo(() => betOptionStats(rounds, patron.patronId), [patron.patronId, rounds]);
    const totalHands = stats.reduce((s, r) => s + r.hands, 0);
    const totalWager = stats.reduce((s, r) => s + r.wager, 0);
    const totalWin = stats.reduce((s, r) => s + r.casinoWin, 0);
    const chartItems = useMemo(() => stats
        .map((r) => ({ label: `${r.gametype} · ${r.betOption}`, value: r.casinoWin }))
        .filter((it) => it.value !== 0)
        .sort((a, b) => Math.abs(b.value) - Math.abs(a.value))
        .slice(0, 8), [stats]);
    return (
        <Box sx={{ p: 1.4, display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 1.4 }}>
            <Box sx={{ borderRadius: 1.6, bgcolor: 'rgba(255,255,255,0.02)', border: '1px solid rgba(122,200,220,0.12)', overflow: 'hidden' }}>
                <Typography sx={{ px: 1.2, pt: 0.9, pb: 0.5, color: 'rgba(255,255,255,0.5)', fontSize: 10, fontWeight: 800, letterSpacing: 0.6, textTransform: 'uppercase' }}>
                    Casino W/L by bet option
                </Typography>
                {chartItems.length ? <DivergingBarChart items={chartItems} /> : (
                    <Typography sx={{ px: 1.2, pb: 1.4, color: 'rgba(255,255,255,0.4)', fontSize: 12 }}>No settled bet activity yet.</Typography>
                )}
            </Box>
            <Box sx={{ minWidth: 0 }}>
            <Box sx={{ ...scrollSx, maxHeight: 320 }}>
            <Box component="table" sx={{ width: '100%', borderCollapse: 'separate', borderSpacing: 0 }}>
                <Box component="thead" sx={{ position: 'sticky', top: 0, bgcolor: 'rgba(8,22,36,0.98)', zIndex: 1 }}>
                    <Box component="tr">
                        <Box component="th" sx={{ ...headSx, textAlign: 'left', pl: 1.4 }}>Game</Box>
                        <Box component="th" sx={{ ...headSx, textAlign: 'left' }}>Bet option</Box>
                        <Box component="th" sx={{ ...headSx }}>Hands</Box>
                        <Box component="th" sx={{ ...headSx }}>Wager</Box>
                        <Box component="th" sx={{ ...headSx }}>Avg wager</Box>
                        <Box component="th" sx={{ ...headSx }}>Patron hit %</Box>
                        <Box component="th" sx={{ ...headSx, pr: 1.4 }}>Casino W/L</Box>
                    </Box>
                </Box>
                <Box component="tbody">
                    {stats.map((r) => (
                        <Box component="tr" key={`${r.gametype}·${r.betOption}`}>
                            <Box component="td" sx={{ ...cellSx, textAlign: 'left', pl: 1.4, color: '#dff5ff', fontWeight: 700 }}>{r.gametype}</Box>
                            <Box component="td" sx={{ ...cellSx, textAlign: 'left', color: 'rgba(255,255,255,0.75)' }}>{r.betOption}</Box>
                            <Box component="td" sx={{ ...cellSx }}>{r.hands}</Box>
                            <Box component="td" sx={{ ...cellSx }}>{fmtCurrency(r.wager)}</Box>
                            <Box component="td" sx={{ ...cellSx, color: 'rgba(255,255,255,0.65)' }}>{fmtCurrency(r.wager / r.hands)}</Box>
                            <Box component="td" sx={{ ...cellSx, color: 'rgba(255,255,255,0.65)' }}>{r.hands ? `${Math.round((r.patronWinHands / r.hands) * 100)}%` : '—'}</Box>
                            <Box component="td" sx={{ ...cellSx, pr: 1.4, color: colorForWin(r.casinoWin), fontWeight: 800, fontSize: F.cellStrong }}>{fmtCurrencyExact(r.casinoWin)}</Box>
                        </Box>
                    ))}
                    {stats.length > 0 && (
                        <Box component="tr">
                            <Box component="td" colSpan={2} sx={{ ...cellSx, textAlign: 'left', pl: 1.4, color: '#dff5ff', fontWeight: 800, fontSize: F.total, borderTop: '1px solid rgba(255,255,255,0.15)' }}>Totals</Box>
                            <Box component="td" sx={{ ...cellSx, fontWeight: 800, fontSize: F.total, borderTop: '1px solid rgba(255,255,255,0.15)' }}>{totalHands}</Box>
                            <Box component="td" sx={{ ...cellSx, fontWeight: 800, fontSize: F.total, borderTop: '1px solid rgba(255,255,255,0.15)' }}>{fmtCurrency(totalWager)}</Box>
                            <Box component="td" sx={{ ...cellSx, borderTop: '1px solid rgba(255,255,255,0.15)' }}>—</Box>
                            <Box component="td" sx={{ ...cellSx, borderTop: '1px solid rgba(255,255,255,0.15)' }}>—</Box>
                            <Box component="td" sx={{ ...cellSx, pr: 1.4, color: colorForWin(totalWin), fontWeight: 800, fontSize: F.total, borderTop: '1px solid rgba(255,255,255,0.15)' }}>{fmtCurrencyExact(totalWin)}</Box>
                        </Box>
                    )}
                </Box>
            </Box>
            </Box>
            </Box>
        </Box>
    );
}

function ByTableTab({ patron, rounds }) {
    const stats = useMemo(() => patronTableStats(rounds, patron.patronId), [rounds, patron.patronId]);
    const chartItems = useMemo(() => stats
        .filter((t) => t.casinoWin !== 0)
        .slice(0, 8)
        .map((t) => ({ label: `${t.gametype}${t.table}`, value: t.casinoWin })), [stats]);
    return (
        <Box sx={{ p: 1.4, display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 1.4 }}>
            <Box sx={{ borderRadius: 1.6, bgcolor: 'rgba(255,255,255,0.02)', border: '1px solid rgba(122,200,220,0.12)', overflow: 'hidden' }}>
                <Typography sx={{ px: 1.2, pt: 0.9, pb: 0.5, color: 'rgba(255,255,255,0.5)', fontSize: 10, fontWeight: 800, letterSpacing: 0.6, textTransform: 'uppercase' }}>
                    Casino W/L by table
                </Typography>
                {chartItems.length ? <DivergingBarChart items={chartItems} /> : (
                    <Typography sx={{ px: 1.2, pb: 1.4, color: 'rgba(255,255,255,0.4)', fontSize: 12 }}>No table activity yet.</Typography>
                )}
            </Box>
            <Box sx={{ ...scrollSx, maxHeight: 320, minWidth: 0 }}>
                <Box component="table" sx={{ width: '100%', borderCollapse: 'separate', borderSpacing: 0 }}>
                    <Box component="thead" sx={{ position: 'sticky', top: 0, bgcolor: 'rgba(8,22,36,0.98)', zIndex: 1 }}>
                        <Box component="tr">
                            <Box component="th" sx={{ ...headSx, textAlign: 'left', pl: 1.4 }}>Table</Box>
                            <Box component="th" sx={{ ...headSx }}>Hands</Box>
                            <Box component="th" sx={{ ...headSx }}>Wager</Box>
                            <Box component="th" sx={{ ...headSx }}>Avg bet</Box>
                            <Box component="th" sx={{ ...headSx, pr: 1.4 }}>Casino W/L</Box>
                        </Box>
                    </Box>
                    <Box component="tbody">
                        {stats.map((t) => (
                            <Box component="tr" key={t.tableKey}>
                                <Box component="td" sx={{ ...cellSx, textAlign: 'left', pl: 1.4, color: '#dff5ff', fontWeight: 700 }}>{t.gametype}{t.table}</Box>
                                <Box component="td" sx={{ ...cellSx }}>{t.hands}</Box>
                                <Box component="td" sx={{ ...cellSx }}>{fmtCurrency(t.wager)}</Box>
                                <Box component="td" sx={{ ...cellSx, color: 'rgba(255,255,255,0.65)' }}>{fmtCurrency(t.wager / t.hands)}</Box>
                                <Box component="td" sx={{ ...cellSx, pr: 1.4, color: colorForWin(t.casinoWin), fontWeight: 800, fontSize: F.cellStrong }}>{fmtCurrencyExact(t.casinoWin)}</Box>
                            </Box>
                        ))}
                        {stats.length === 0 && (
                            <Box component="tr"><Box component="td" colSpan={5} sx={{ py: 4, textAlign: 'center', color: 'rgba(255,255,255,0.4)', fontSize: 13 }}>No table activity yet.</Box></Box>
                        )}
                    </Box>
                </Box>
            </Box>
        </Box>
    );
}

function YtdChart({ months }) {
    const ref = useRef(null);
    useEffect(() => {
        if (!ref.current) return;
        let inst = echarts.getInstanceByDom(ref.current);
        if (!inst) inst = echarts.init(ref.current, 'dark');
        inst.setOption({
            backgroundColor: 'transparent', animation: false,
            grid: { left: 64, right: 64, top: 28, bottom: 30 },
            legend: { top: 2, textStyle: { color: 'rgba(255,255,255,0.8)', fontSize: 11 }, data: ['Casino net W/L', 'Wager'] },
            tooltip: { trigger: 'axis', backgroundColor: 'rgba(15,20,25,0.96)', borderColor: 'rgba(122,200,220,0.4)', textStyle: { color: '#fff', fontSize: 11 } },
            xAxis: { type: 'category', data: months.map((m) => m.month), axisLabel: { color: 'rgba(255,255,255,0.7)', fontSize: 10 }, axisLine: { lineStyle: { color: 'rgba(255,255,255,0.15)' } } },
            yAxis: [
                { type: 'value', name: 'W/L', axisLabel: { color: 'rgba(255,255,255,0.7)', fontSize: 10, formatter: (v) => fmtCurrency(v) }, splitLine: { lineStyle: { color: 'rgba(255,255,255,0.06)' } } },
                { type: 'value', name: 'Wager', axisLabel: { color: 'rgba(255,255,255,0.5)', fontSize: 10, formatter: (v) => fmtCurrency(v) }, splitLine: { show: false } },
            ],
            series: [
                { name: 'Casino net W/L', type: 'bar', data: months.map((m) => m.netWinLossCasinoPerspective), itemStyle: { color: (p) => colorForWin(p.value) } },
                { name: 'Wager', type: 'line', yAxisIndex: 1, data: months.map((m) => m.cumWagerCasinoPerspective), smooth: true, lineStyle: { color: '#7adfff', width: 2 }, symbolSize: 5, itemStyle: { color: '#7adfff' } },
            ],
        }, { notMerge: true });
        const ro = new ResizeObserver(() => requestAnimationFrame(() => inst.resize()));
        ro.observe(ref.current);
        return () => ro.disconnect();
    }, [months]);
    return <div ref={ref} style={{ width: '100%', height: 250 }} />;
}

function YtdTab({ patron, ytdByPatron }) {
    const rec = ytdByPatron?.[patron.patronId];
    if (!rec || !rec.months?.length) {
        return <Box sx={{ py: 4, textAlign: 'center', color: 'rgba(255,255,255,0.4)', fontSize: 13 }}>No YTD records for this patron.</Box>;
    }
    const visits = rec.months.reduce((s, m) => s + m.visits, 0);
    const hours  = rec.months.reduce((s, m) => s + m.hoursOnFloor, 0);
    const wager  = rec.months.reduce((s, m) => s + m.cumWagerCasinoPerspective, 0);
    const net    = rec.months.reduce((s, m) => s + m.netWinLossCasinoPerspective, 0);
    const hold   = wager ? (net / wager) * 100 : null;
    return (
        <Box sx={{ p: 1.4 }}>
            <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 1, mb: 1.4 }}>
                <KpiTile label="YTD visits" value={visits} sub={`${hours}h on floor`} />
                <KpiTile label="YTD wager" value={fmtCurrency(wager)} />
                <KpiTile label="YTD net W/L" value={fmtCurrency(net)} valueColor={colorForWin(net)} sub="casino perspective" />
                <KpiTile label="YTD hold %" value={hold == null ? '—' : `${hold.toFixed(1)}%`} valueColor={colorForWin(net)} sub="net ÷ wager" />
                <KpiTile label="Avg wager / visit" value={visits ? fmtCurrency(wager / visits) : '—'} />
            </Box>
            <YtdChart months={rec.months} />
        </Box>
    );
}

function LifetimeTab({ patron, rounds, ytdByPatron, ltdByPatron }) {
    const rec = ltdByPatron?.[patron.patronId];
    const todayStats = useMemo(() => patronTodayStats(rounds, patron.patronId), [rounds, patron.patronId]);
    const ytdRec = ytdByPatron?.[patron.patronId];
    if (!rec) {
        return <Box sx={{ py: 4, textAlign: 'center', color: 'rgba(255,255,255,0.4)', fontSize: 13 }}>No lifetime records for this patron.</Box>;
    }
    const tenureYears = Math.max(0, (Date.now() - new Date(rec.memberSince).getTime()) / (365.25 * 24 * 3600 * 1000));
    const hold = rec.cumWagerCasinoPerspective ? (rec.netWinLossCasinoPerspective / rec.cumWagerCasinoPerspective) * 100 : null;
    const ytdWager = ytdRec?.months?.reduce((s, m) => s + m.cumWagerCasinoPerspective, 0) || 0;
    const ytdNet = ytdRec?.months?.reduce((s, m) => s + m.netWinLossCasinoPerspective, 0) || 0;
    return (
        <Box sx={{ p: 1.4 }}>
            <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 1, mb: 1.4 }}>
                <KpiTile label="Member since" value={rec.memberSince} sub={`${tenureYears.toFixed(1)} years`} />
                <KpiTile label="Lifetime visits" value={rec.visits.toLocaleString()} sub={`${rec.hoursOnFloor.toLocaleString()}h on floor`} />
                <KpiTile label="Lifetime wager" value={fmtCurrency(rec.cumWagerCasinoPerspective)} sub={rec.visits ? `${fmtCurrency(rec.cumWagerCasinoPerspective / rec.visits)} / visit` : null} />
                <KpiTile label="Lifetime net W/L" value={fmtCurrency(rec.netWinLossCasinoPerspective)}
                    valueColor={colorForWin(rec.netWinLossCasinoPerspective)}
                    sub={hold == null ? 'casino perspective' : `hold ${hold.toFixed(1)}% · casino perspective`} />
                <KpiTile label="Best day (casino)" value={fmtCurrency(rec.bestDayCasinoPerspective)} valueColor={colorForWin(rec.bestDayCasinoPerspective)} />
                <KpiTile label="Worst day (casino)" value={fmtCurrency(rec.worstDayCasinoPerspective)} valueColor={colorForWin(rec.worstDayCasinoPerspective)} />
                <KpiTile label="Avg hours / visit" value={rec.visits ? (rec.hoursOnFloor / rec.visits).toFixed(1) : '—'} sub="session length habit" />
                <KpiTile label="Worth segment" value={rec.cumWagerCasinoPerspective >= 50_000_000 ? 'Premium' : rec.cumWagerCasinoPerspective >= 10_000_000 ? 'High' : 'Core'} sub="by lifetime wager band" />
            </Box>
            {/* Today vs YTD vs Lifetime — the trend story management wants:
                is this player's activity/value accelerating or fading? */}
            <Box sx={{ borderRadius: 1.6, bgcolor: 'rgba(255,255,255,0.02)', border: '1px solid rgba(122,200,220,0.12)', overflow: 'hidden' }}>
                <Typography sx={{ px: 1.2, pt: 0.9, color: 'rgba(255,255,255,0.5)', fontSize: 10, fontWeight: 800, letterSpacing: 0.6, textTransform: 'uppercase' }}>
                    Value across horizons — wager &amp; net W/L
                </Typography>
                <HorizonCompareChart
                    today={{ wager: todayStats.wager, net: todayStats.actual }}
                    ytd={{ wager: ytdWager, net: ytdNet }}
                    lifetime={{ wager: rec.cumWagerCasinoPerspective, net: rec.netWinLossCasinoPerspective }}
                />
            </Box>
        </Box>
    );
}

// ── Panel shell ─────────────────────────────────────────────────────

const TAB_DEFS = ['Overview', 'Hands', 'By Bet', 'By Table', 'YTD', 'Lifetime'];

export default function PatronInsightPanel({ patron, rounds, ytdByPatron, ltdByPatron }) {
    const [tab, setTab] = useState(0);
    // New patron pin resets to Overview so the story always starts at the top.
    useEffect(() => { setTab(0); }, [patron?.patronId]);

    if (!patron) {
        return (
            <Box sx={{
                p: 2.5, borderRadius: 2, bgcolor: 'rgba(8, 22, 36, 0.55)',
                border: '1px dashed rgba(122, 200, 220, 0.22)',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 1.4,
            }}>
                <Box sx={{ width: 34, height: 34, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px dashed rgba(122,200,220,0.35)', color: 'rgba(122,223,255,0.55)', flexShrink: 0 }}>
                    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                </Box>
                <Box>
                    <Typography sx={{ color: 'rgba(255,255,255,0.7)', fontSize: 13, fontWeight: 700 }}>Pick a player to open the insight panel</Typography>
                    <Typography sx={{ color: 'rgba(255,255,255,0.4)', fontSize: 11 }}>Profile · today's KPIs vs theo · hand-by-hand · bet & table mix · YTD · lifetime</Typography>
                </Box>
            </Box>
        );
    }

    const cumColor = colorForWin(patron.cumWin);
    return (
        <Box sx={{ borderRadius: 2, bgcolor: 'rgba(8, 22, 36, 0.55)', border: '1px solid rgba(122, 200, 220, 0.18)', overflow: 'hidden' }}>
            {/* Identity strip — who, tier, segment, floor time + headline number. */}
            <Stack direction="row" alignItems="center" spacing={1.2} sx={{ px: 1.4, py: 1, borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                <Box sx={{ width: 4, height: 20, bgcolor: '#7adfff', borderRadius: 0.5 }} />
                <Typography sx={{ color: '#dff5ff', fontSize: 17, fontWeight: 800, letterSpacing: 0.4, lineHeight: 1 }}>{patron.patronId}</Typography>
                <TierChip cardType={patron.cardType} />
                <Typography sx={{ color: 'rgba(255,255,255,0.5)', fontSize: 11.5, fontWeight: 700, whiteSpace: 'nowrap' }}>
                    {patron.segment} · on floor {fmtDuration(patron.signInMinsAgo)}
                </Typography>
                <Box sx={{ flex: 1 }} />
                <Stack sx={{ alignItems: 'flex-end' }} spacing={0}>
                    <Typography sx={{ color: 'rgba(255,255,255,0.45)', fontSize: 9.5, fontWeight: 800, letterSpacing: 0.6, textTransform: 'uppercase' }}>Casino W/L today</Typography>
                    <Typography sx={{ color: cumColor, fontSize: 20, fontWeight: 800, fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>{fmtCurrency(patron.cumWin)}</Typography>
                </Stack>
            </Stack>

            <Tabs value={tab} onChange={(_, v) => setTab(v)}
                variant="scrollable" scrollButtons={false}
                sx={{
                    minHeight: 36, borderBottom: '1px solid rgba(122,200,220,0.15)', px: 0.6,
                    '& .MuiTabs-indicator': { backgroundColor: '#7adfff', height: 2 },
                    '& .MuiTab-root': { minHeight: 36, py: 0, px: 1.6, fontSize: 11.5, fontWeight: 800, letterSpacing: 0.5, textTransform: 'uppercase', color: 'rgba(255,255,255,0.55)' },
                    '& .Mui-selected': { color: '#dff5ff' },
                }}>
                {TAB_DEFS.map((t) => <Tab key={t} label={t} />)}
            </Tabs>

            {tab === 0 && <OverviewTab patron={patron} rounds={rounds} />}
            {tab === 1 && <HandsTab patron={patron} rounds={rounds} />}
            {tab === 2 && <ByBetTab patron={patron} rounds={rounds} />}
            {tab === 3 && <ByTableTab patron={patron} rounds={rounds} />}
            {tab === 4 && <YtdTab patron={patron} ytdByPatron={ytdByPatron} />}
            {tab === 5 && <LifetimeTab patron={patron} rounds={rounds} ytdByPatron={ytdByPatron} ltdByPatron={ltdByPatron} />}
        </Box>
    );
}
