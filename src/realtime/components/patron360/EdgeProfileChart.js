// Bet rate by edge — every shoe in the range pooled into one picture for
// the option under review. Bars = share of seated hands in each edge band
// where the patron bet it (band colours match the heatmap); dashed line =
// their overall rate, i.e. random betting; gold = average bet per band.
// Flat reads normal; a staircase on the magenta side reads advantage.

import React, { useMemo } from 'react';
import { Box, Stack, Typography } from '@mui/material';
import { TEXT } from '../../constants/rtTheme';
import { OPTION_BY_CODE, edgeProfile } from '../../utils/patron360';
import useEChart from './useEChart';
import { EDGE_COLORS, bandTick, edgeBands, plain } from './format';

const AVG = '#f2c14e';

export function ProfileLegend() {
    const item = (mark, text) => (
        <Stack direction="row" spacing={0.6} sx={{ alignItems: 'center' }}>
            {mark}
            <Typography sx={{ fontSize: 12, color: TEXT.muted }}>{text}</Typography>
        </Stack>
    );
    return (
        <Stack direction="row" spacing={1.75} sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 0.5 }}>
            {item(<Box sx={{ width: 10, height: 12, borderRadius: 0.5, bgcolor: EDGE_COLORS.player }} />, 'bet rate')}
            {item(<Box sx={{ width: 16, borderTop: '2px dashed rgba(255,255,255,0.6)' }} />, 'overall')}
            {item(<Box sx={{ width: 9, height: 9, borderRadius: '50%', bgcolor: AVG }} />, 'avg bet')}
        </Stack>
    );
}

export default function EdgeProfileChart({ views, code }) {
    const theo = (OPTION_BY_CODE.get(code) || { theo: 1 }).theo;
    const { option, empty, summary } = useMemo(() => {
        const bands = edgeBands(theo);
        const p = edgeProfile(views, code, bands);
        const pct = (v) => (v == null ? null : +(v * 100).toFixed(1));
        const overall = pct(p.rate);
        // Screen-reader summary: negative-edge bet rate against the rest.
        const neg = p.bands.filter((_, i) => bands[i].lt != null && bands[i].lt <= 0);
        const negHands = neg.reduce((a, b) => a + b.hands, 0);
        const negBets = neg.reduce((a, b) => a + b.bets, 0);
        const restHands = p.hands - negHands;
        const restBets = p.bets - negBets;
        const summaryText = p.hands
            ? `${code}: bet on ${negHands ? pct(negBets / negHands) : 0}% of negative-edge hands and ${restHands ? pct(restBets / restHands) : 0}% of other hands.`
            : `${code}: no edge data.`;
        return {
            empty: !p.hands,
            summary: summaryText,
            option: {
                backgroundColor: 'transparent',
                animation: false,
                grid: { left: 46, right: 60, top: 30, bottom: 30 },
                tooltip: {
                    trigger: 'axis', axisPointer: { type: 'shadow' },
                    backgroundColor: 'rgba(14,16,28,0.97)', borderColor: 'rgba(122,162,247,0.45)', textStyle: { color: '#fff', fontSize: 12 },
                    formatter: (ps) => {
                        const i = ps[0].dataIndex;
                        const b = p.bands[i];
                        return `<b>${bandTick(bands[i])}</b><br/>bet ${b.bets} of ${b.hands} hands${b.rate == null ? '' : ` · ${pct(b.rate)}%`}<br/>avg bet ${plain(b.avgBet)}`;
                    },
                },
                xAxis: {
                    type: 'category', data: bands.map(bandTick),
                    axisLabel: { color: TEXT.secondary, fontSize: 12, fontWeight: 700 }, axisTick: { show: false },
                    axisLine: { lineStyle: { color: 'rgba(255,255,255,0.18)' } },
                },
                yAxis: [
                    {
                        // Headroom for the value labels, but a rate never passes 100%.
                        type: 'value', min: 0, max: (v) => Math.min(100, Math.max(10, Math.ceil((v.max * 1.15) / 10) * 10)),
                        axisLabel: { color: TEXT.muted, fontSize: 11, formatter: '{value}%' },
                        splitLine: { lineStyle: { color: 'rgba(255,255,255,0.06)' } },
                    },
                    { type: 'value', min: 0, axisLabel: { color: AVG, fontSize: 11, formatter: (v) => plain(v) }, splitLine: { show: false } },
                ],
                series: [
                    {
                        type: 'bar', barWidth: '54%',
                        data: p.bands.map((b, i) => ({
                            value: pct(b.rate),
                            itemStyle: { color: bands[i].color, borderColor: 'rgba(255,255,255,0.22)', borderWidth: 1, borderRadius: [4, 4, 0, 0] },
                        })),
                        label: { show: true, position: 'top', color: TEXT.primary, fontSize: 14, fontWeight: 800, formatter: (x) => (x.value == null ? '' : `${x.value}%`) },
                        ...(overall == null ? {} : {
                            markLine: {
                                silent: true, symbol: 'none', data: [{ yAxis: overall }],
                                lineStyle: { color: 'rgba(255,255,255,0.6)', type: 'dashed', width: 1.5 },
                                label: { formatter: `${overall}%`, color: TEXT.secondary, fontSize: 11, position: 'insideEndTop' },
                            },
                        }),
                    },
                    {
                        type: 'line', yAxisIndex: 1, z: 5, connectNulls: true, symbol: 'circle', symbolSize: 9,
                        data: p.bands.map((b) => (b.avgBet == null ? null : Math.round(b.avgBet))),
                        lineStyle: { color: AVG, width: 2 }, itemStyle: { color: AVG, borderColor: '#0d0e18', borderWidth: 2 },
                    },
                ],
            },
        };
    }, [views, code, theo]);
    const ref = useEChart(option);
    return (
        <Box sx={{ position: 'relative', width: '100%', height: '100%', minHeight: 300 }}>
            <Box ref={ref} role="img" aria-label={summary} sx={{ position: 'absolute', inset: 0 }} />
            {empty ? (
                <Typography sx={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', fontSize: 13, color: TEXT.faint }}>No edge data</Typography>
            ) : null}
        </Box>
    );
}
