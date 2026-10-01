// Live Casino Win — Patron Deep Panel.
// Bottom section of the dashboard. When a patron is selected, three
// tabs answer the questions ops actually asks about a live player:
//   • Hands  — cumulative hand-by-hand play records for today
//   • By Bet — bet-option breakdown (hands, wager, hit rate, casino W/L)
//   • YTD    — year-to-date monthly rollup (visits, wager, net W/L)
// When no patron is selected the panel shows a placeholder inviting a
// click on the Top-X list, so the vertical slot is never dead space.

import React, { useMemo, useState } from 'react';
import * as echarts from 'echarts';
import { useEffect, useRef } from 'react';
import { Box, Stack, Typography, Tabs, Tab } from '@mui/material';
import { LIVE_FONTS } from '../constants/fontSizes';
import { colorForWin, fmtCurrency, fmtCurrencyExact } from '../constants/winPalette';
import { betOptionStats } from '../utils/winAggregates';

const F = LIVE_FONTS.deep;

const headSx = { py: 0.6, px: 0.9, fontSize: F.head, fontWeight: 800, letterSpacing: 0.4, textTransform: 'uppercase', color: 'rgba(255,255,255,0.55)', borderBottom: '1px solid rgba(255,255,255,0.15)', textAlign: 'right', whiteSpace: 'nowrap' };
const cellSx = { py: 0.5, px: 0.9, fontSize: F.cell, fontVariantNumeric: 'tabular-nums', borderBottom: '1px solid rgba(255,255,255,0.05)', textAlign: 'right', whiteSpace: 'nowrap' };

function fmtTs(iso) {
    if (!iso) return '—';
    try {
        const d = new Date(iso);
        return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
    } catch { return '—'; }
}

function HandsTab({ patron, rounds }) {
    // Cumulative running total across the patron's rounds for today.
    const rows = useMemo(() => {
        const arr = [];
        let cum = 0;
        for (const r of rounds) {
            if (r.patronId !== patron.patronId) continue;
            cum += (Number(r.winLoss) || 0);
            arr.push({ ...r, cum });
        }
        // Latest first — most actionable while watching a live session.
        return arr.reverse();
    }, [patron.patronId, rounds]);
    return (
        <Box sx={{ maxHeight: 300, overflowY: 'auto',
            scrollbarColor: 'rgba(122,223,255,0.35) rgba(255,255,255,0.04)', scrollbarWidth: 'thin',
            '&::-webkit-scrollbar': { width: 9 },
            '&::-webkit-scrollbar-thumb': { bgcolor: 'rgba(122,223,255,0.35)', borderRadius: 3, border: '2px solid transparent', backgroundClip: 'padding-box' },
        }}>
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
                        <Box component="tr"><Box component="td" colSpan={6} sx={{ py: 4, textAlign: 'center', color: 'rgba(255,255,255,0.4)', fontSize: 13 }}>No hands recorded for this patron yet today.</Box></Box>
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
    const totalCasinoWin = stats.reduce((s, r) => s + r.casinoWin, 0);
    return (
        <Box sx={{ maxHeight: 300, overflowY: 'auto',
            scrollbarColor: 'rgba(122,223,255,0.35) rgba(255,255,255,0.04)', scrollbarWidth: 'thin',
            '&::-webkit-scrollbar': { width: 9 },
            '&::-webkit-scrollbar-thumb': { bgcolor: 'rgba(122,223,255,0.35)', borderRadius: 3, border: '2px solid transparent', backgroundClip: 'padding-box' },
        }}>
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
                            <Box component="td" sx={{ ...cellSx, pr: 1.4, color: colorForWin(totalCasinoWin), fontWeight: 800, fontSize: F.total, borderTop: '1px solid rgba(255,255,255,0.15)' }}>{fmtCurrencyExact(totalCasinoWin)}</Box>
                        </Box>
                    )}
                    {stats.length === 0 && (
                        <Box component="tr"><Box component="td" colSpan={7} sx={{ py: 4, textAlign: 'center', color: 'rgba(255,255,255,0.4)', fontSize: 13 }}>No bet activity yet.</Box></Box>
                    )}
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
        const cats = months.map((m) => m.month);
        const nets = months.map((m) => m.netWinLossCasinoPerspective);
        const wagers = months.map((m) => m.cumWagerCasinoPerspective);
        inst.setOption({
            backgroundColor: 'transparent',
            grid: { left: 60, right: 60, top: 24, bottom: 30 },
            legend: { top: 2, textStyle: { color: 'rgba(255,255,255,0.8)', fontSize: 11 }, data: ['Casino net W/L', 'Wager'] },
            tooltip: { trigger: 'axis', backgroundColor: 'rgba(15,20,25,0.96)', borderColor: 'rgba(122,200,220,0.4)', textStyle: { color: '#fff', fontSize: 11 } },
            xAxis: { type: 'category', data: cats, axisLabel: { color: 'rgba(255,255,255,0.7)', fontSize: 10 }, axisLine: { lineStyle: { color: 'rgba(255,255,255,0.15)' } } },
            yAxis: [
                { type: 'value', name: 'W/L', axisLabel: { color: 'rgba(255,255,255,0.7)', fontSize: 10, formatter: (v) => fmtCurrency(v) }, splitLine: { lineStyle: { color: 'rgba(255,255,255,0.06)' } } },
                { type: 'value', name: 'Wager', axisLabel: { color: 'rgba(255,255,255,0.5)', fontSize: 10, formatter: (v) => fmtCurrency(v) }, splitLine: { show: false } },
            ],
            series: [
                { name: 'Casino net W/L', type: 'bar', data: nets,
                    itemStyle: { color: (p) => colorForWin(p.value) } },
                { name: 'Wager', type: 'line', yAxisIndex: 1, data: wagers, smooth: true,
                    lineStyle: { color: '#7adfff', width: 2 }, symbolSize: 6,
                    itemStyle: { color: '#7adfff' } },
            ],
        }, { notMerge: true });
        const ro = new ResizeObserver(() => requestAnimationFrame(() => inst.resize()));
        ro.observe(ref.current);
        return () => ro.disconnect();
    }, [months]);
    return <Box ref={ref} sx={{ width: '100%', height: 260 }} />;
}

function YtdTab({ patron, ytdByPatron }) {
    const rec = ytdByPatron?.[patron.patronId];
    if (!rec || !rec.months?.length) {
        return <Box sx={{ py: 4, textAlign: 'center', color: 'rgba(255,255,255,0.4)', fontSize: 13 }}>No historical records for this patron.</Box>;
    }
    const totalVisits = rec.months.reduce((s, m) => s + m.visits, 0);
    const totalHours  = rec.months.reduce((s, m) => s + m.hoursOnFloor, 0);
    const totalWager  = rec.months.reduce((s, m) => s + m.cumWagerCasinoPerspective, 0);
    const totalNet    = rec.months.reduce((s, m) => s + m.netWinLossCasinoPerspective, 0);
    return (
        <Stack spacing={1}>
            <Stack direction="row" spacing={2} sx={{ px: 1.4, py: 1.2, borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                <Stack spacing={0}>
                    <Typography sx={{ color: 'rgba(255,255,255,0.5)', fontSize: 10, fontWeight: 800, letterSpacing: 0.5, textTransform: 'uppercase' }}>YTD visits</Typography>
                    <Typography sx={{ color: '#dff5ff', fontSize: 18, fontWeight: 800, fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>{totalVisits}</Typography>
                </Stack>
                <Stack spacing={0}>
                    <Typography sx={{ color: 'rgba(255,255,255,0.5)', fontSize: 10, fontWeight: 800, letterSpacing: 0.5, textTransform: 'uppercase' }}>Floor hours</Typography>
                    <Typography sx={{ color: '#dff5ff', fontSize: 18, fontWeight: 800, fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>{totalHours}h</Typography>
                </Stack>
                <Stack spacing={0}>
                    <Typography sx={{ color: 'rgba(255,255,255,0.5)', fontSize: 10, fontWeight: 800, letterSpacing: 0.5, textTransform: 'uppercase' }}>YTD wager</Typography>
                    <Typography sx={{ color: '#dff5ff', fontSize: 18, fontWeight: 800, fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>{fmtCurrency(totalWager)}</Typography>
                </Stack>
                <Stack spacing={0}>
                    <Typography sx={{ color: 'rgba(255,255,255,0.5)', fontSize: 10, fontWeight: 800, letterSpacing: 0.5, textTransform: 'uppercase' }}>YTD net W/L</Typography>
                    <Typography sx={{ color: colorForWin(totalNet), fontSize: 18, fontWeight: 800, fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>{fmtCurrency(totalNet)}</Typography>
                </Stack>
            </Stack>
            <YtdChart months={rec.months} />
        </Stack>
    );
}

export default function PatronDeepPanel({ patron, rounds, ytdByPatron }) {
    const [tab, setTab] = useState(0);
    if (!patron) {
        return (
            <Box sx={{ p: 3, borderRadius: 2, bgcolor: 'rgba(8, 22, 36, 0.55)', border: '1px dashed rgba(122, 200, 220, 0.22)', textAlign: 'center' }}>
                <Typography sx={{ color: 'rgba(255,255,255,0.55)', fontSize: 14, fontWeight: 700 }}>
                    Select a player to see hand-by-hand play, bet-option breakdown, and YTD history.
                </Typography>
            </Box>
        );
    }
    return (
        <Box sx={{ borderRadius: 2, bgcolor: 'rgba(8, 22, 36, 0.55)', border: '1px solid rgba(122, 200, 220, 0.12)', overflow: 'hidden' }}>
            <Stack direction="row" alignItems="center" sx={{ px: 1.2, py: 0.6, borderBottom: '1px solid rgba(122,200,220,0.15)' }}>
                <Box sx={{ width: 4, height: 16, bgcolor: '#7adfff', borderRadius: 0.5, mr: 1 }} />
                <Typography sx={{ color: '#dff5ff', fontSize: 13, fontWeight: 800, letterSpacing: 0.4 }}>Play detail · {patron.patronId}</Typography>
                <Box sx={{ flex: 1 }} />
                <Tabs value={tab} onChange={(_, v) => setTab(v)}
                    sx={{ minHeight: 32,
                        '& .MuiTabs-indicator': { backgroundColor: '#7adfff', height: 2 },
                        '& .MuiTab-root': { minHeight: 32, py: 0, px: 1.4, textTransform: 'none', fontSize: F.tab, fontWeight: 700, color: 'rgba(255,255,255,0.6)' },
                        '& .Mui-selected': { color: '#dff5ff' },
                    }}>
                    <Tab label="Hands" />
                    <Tab label="By Bet" />
                    <Tab label="YTD" />
                </Tabs>
            </Stack>
            {tab === 0 && <HandsTab patron={patron} rounds={rounds} />}
            {tab === 1 && <ByBetTab patron={patron} rounds={rounds} />}
            {tab === 2 && <YtdTab patron={patron} ytdByPatron={ytdByPatron} />}
        </Box>
    );
}
