// Live Casino Win — patron summary card.
// =======================================
// Sits directly beneath the heatmap in the left column so it fills
// whatever vertical space the heatmap doesn't consume. Structure:
//
//   Header row  — PID, tier chip, session status (single line, aligned)
//   Stat grid   — 4 equal columns: Casino W/L | Wager | Peak | Trough
//   Sparkline   — full-width cumulative W/L over the day
//   Footer row  — Hands · Tables (secondary stats)
//
// All numbers use tabular-nums so column edges align, headers use the
// same weight/letter-spacing pattern as the rest of the dashboard.

import React, { useEffect, useMemo, useRef } from 'react';
import * as echarts from 'echarts';
import { Box, Stack, Typography, Divider } from '@mui/material';
import { LIVE_FONTS } from '../constants/fontSizes';
import { CARD_TIERS, colorForWin, fmtCurrency } from '../constants/winPalette';
import { fmtDuration, patronCumSeries } from '../utils/winAggregates';

const F = LIVE_FONTS.patronCard;

// One aligned stat block. Same shape in header/grid/footer so cards
// snap to the same visual grid.
function StatBlock({ label, value, valueColor, sub, size = 'md' }) {
    const valueSize = size === 'lg' ? F.valueLarge : size === 'sm' ? 15 : F.value + 4;
    return (
        <Stack spacing={0.3} sx={{ minWidth: 0 }}>
            <Typography sx={{
                color: 'rgba(255,255,255,0.5)', fontSize: F.label, fontWeight: 800,
                letterSpacing: 0.6, textTransform: 'uppercase', lineHeight: 1, whiteSpace: 'nowrap',
            }}>
                {label}
            </Typography>
            <Typography sx={{
                color: valueColor || '#dff5ff', fontSize: valueSize, fontWeight: 800,
                fontVariantNumeric: 'tabular-nums', lineHeight: 1.05, whiteSpace: 'nowrap',
            }}>
                {value}
            </Typography>
            {sub && (
                <Typography sx={{ color: 'rgba(255,255,255,0.38)', fontSize: 10, lineHeight: 1.1 }}>
                    {sub}
                </Typography>
            )}
        </Stack>
    );
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

function Sparkline({ points }) {
    const ref = useRef(null);
    useEffect(() => {
        if (!ref.current) return;
        let inst = echarts.getInstanceByDom(ref.current);
        if (!inst) inst = echarts.init(ref.current, 'dark');
        const cums = points.map((p) => p.cum);
        const min = Math.min(0, ...cums);
        const max = Math.max(0, ...cums);
        inst.setOption({
            backgroundColor: 'transparent',
            grid: { left: 0, right: 0, top: 4, bottom: 4, containLabel: false },
            xAxis: { type: 'category', show: false, data: points.map((_, i) => i) },
            yAxis: { type: 'value', show: false, min, max },
            tooltip: {
                trigger: 'axis',
                backgroundColor: 'rgba(15,20,25,0.96)', borderColor: 'rgba(122,200,220,0.4)',
                textStyle: { color: '#fff', fontSize: 11 },
                formatter: (params) => {
                    const i = params[0].dataIndex;
                    const p = points[i];
                    if (!p) return '';
                    const c = colorForWin(p.cum);
                    return `<div style="font-weight:800">Hand ${i + 1}</div>
                            <div style="color:rgba(255,255,255,0.55);font-size:10px">${new Date(p.ts).toLocaleTimeString()}</div>
                            <div style="margin-top:4px;color:${c};font-weight:800">Cum: ${fmtCurrency(p.cum)}</div>`;
                },
            },
            series: [
                {   // Zero baseline — subtle dashed reference.
                    type: 'line', data: points.map(() => 0), showSymbol: false,
                    lineStyle: { color: 'rgba(255,255,255,0.14)', width: 1, type: 'dashed' },
                    silent: true,
                },
                {
                    type: 'line', data: cums, showSymbol: false, smooth: false,
                    lineStyle: { color: '#7adfff', width: 1.8 },
                    areaStyle: { color: 'rgba(122,223,255,0.14)' },
                },
            ],
        }, { notMerge: true });
        const ro = new ResizeObserver(() => requestAnimationFrame(() => inst.resize()));
        ro.observe(ref.current);
        return () => ro.disconnect();
    }, [points]);
    return <Box ref={ref} sx={{ width: '100%', height: 90 }} />;
}

export default function PatronDetailCard({ patron, rounds }) {
    const cumSeries = useMemo(() => patronCumSeries(rounds, patron?.patronId), [rounds, patron?.patronId]);

    if (!patron) {
        return (
            <Box sx={{
                flex: 1, width: '100%', p: 2, borderRadius: 2,
                bgcolor: 'rgba(8, 22, 36, 0.55)',
                border: '1px dashed rgba(122, 200, 220, 0.22)',
                display: 'flex', flexDirection: 'column',
                alignItems: 'center', justifyContent: 'center', gap: 1,
            }}>
                <Box sx={{ width: 36, height: 36, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px dashed rgba(122,200,220,0.35)', color: 'rgba(122,223,255,0.55)' }}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                </Box>
                <Typography sx={{ color: 'rgba(255,255,255,0.7)', fontSize: 13, fontWeight: 700 }}>
                    Pick a player to open the detail card
                </Typography>
                <Typography sx={{ color: 'rgba(255,255,255,0.4)', fontSize: 11, textAlign: 'center', maxWidth: 320 }}>
                    Click a row in the Top-N list on the right — you'll see today's cumulative W/L, peak/trough, and a live trajectory here.
                </Typography>
            </Box>
        );
    }

    const cumColor = colorForWin(patron.cumWin);
    // Peak / Trough on cumulative series (casino perspective).
    let peakWinCasino = 0, peakLossCasino = 0;
    for (const p of cumSeries) {
        if (p.cum < peakWinCasino) peakWinCasino = p.cum;
        if (p.cum > peakLossCasino) peakLossCasino = p.cum;
    }
    return (
        <Box sx={{
            flex: 1, width: '100%', p: 1.6, borderRadius: 2,
            bgcolor: 'rgba(8, 22, 36, 0.55)',
            border: '1px solid rgba(122, 200, 220, 0.22)',
            display: 'flex', flexDirection: 'column', minWidth: 0,
        }}>
            {/* Header row — all baseline-aligned, single line. */}
            <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1.4 }}>
                <Box sx={{ width: 4, height: 18, bgcolor: '#7adfff', borderRadius: 0.5 }} />
                <Typography sx={{ color: '#dff5ff', fontSize: F.heading, fontWeight: 800, letterSpacing: 0.4, lineHeight: 1 }}>
                    {patron.patronId}
                </Typography>
                <TierChip cardType={patron.cardType} />
                <Box sx={{ flex: 1 }} />
                <Typography sx={{ color: 'rgba(255,255,255,0.55)', fontSize: 11, fontWeight: 700, letterSpacing: 0.3, lineHeight: 1, whiteSpace: 'nowrap' }}>
                    {patron.segment} · on floor {fmtDuration(patron.signInMinsAgo)}
                </Typography>
            </Stack>

            {/* Stat grid — 4 columns, equal width, top-aligned. All numbers
                use identical size + weight so the row reads as one block. */}
            <Box sx={{
                display: 'grid',
                gridTemplateColumns: 'repeat(4, 1fr)',
                gap: 2, mb: 1.4,
            }}>
                <StatBlock size="lg" label="Casino W/L today" value={fmtCurrency(patron.cumWin)} valueColor={cumColor} />
                <StatBlock size="lg" label="Total wager"      value={fmtCurrency(patron.cumWager)} />
                <StatBlock size="lg" label="Peak (patron)"    value={fmtCurrency(peakWinCasino)}   valueColor={colorForWin(peakWinCasino)}  sub="casino perspective" />
                <StatBlock size="lg" label="Trough (patron)"  value={fmtCurrency(peakLossCasino)}  valueColor={colorForWin(peakLossCasino)} sub="casino perspective" />
            </Box>

            {/* Sparkline — cumulative W/L trajectory over the day. Grows to
                fill the remaining vertical space so the card breathes when
                there's a tall heatmap above and lots of room below. */}
            <Box sx={{ flex: 1, minHeight: 90, display: 'flex' }}>
                <Sparkline points={cumSeries} />
            </Box>

            <Divider sx={{ my: 1.2, borderColor: 'rgba(255,255,255,0.08)' }} />

            {/* Secondary stats — Hands + Tables, same alignment as the grid. */}
            <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 2 }}>
                <StatBlock size="sm" label="Hands"  value={patron.hands} />
                <StatBlock size="sm" label="Tables" value={patron.tablesPlayed} />
                <StatBlock size="sm" label="Avg wager" value={patron.hands > 0 ? fmtCurrency(patron.cumWager / patron.hands) : '—'} />
                <StatBlock size="sm" label="Sessions" value={patron.tablesPlayed} sub="tables played" />
            </Box>
        </Box>
    );
}
