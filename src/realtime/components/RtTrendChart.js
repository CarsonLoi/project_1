// Floor session trend — actual win vs theoretical, per time bucket.
// =================================================================
// The only view on this dashboard with a time axis. Everything else is
// a snapshot of now, which can tell you a table is down $412K but not
// whether that happened over eight hours (normal variance) or in the
// last twenty minutes (something changed). That distinction is the
// whole question for surveillance, so this chart answers it.
//
// The gap between the two lines IS the variance. Where they separate is
// when it started — which is why they are plotted together rather than
// charting the variance alone.
//
// Values are per-bucket, not cumulative: a cumulative line buries a
// sudden run inside a large running total. See §5 of the data contract.

import React, { useEffect, useMemo, useRef } from 'react';
import * as echarts from 'echarts';
import { Box, Stack, Typography } from '@mui/material';
import { TEXT, TYPE, STATE, systemLabel } from '../constants/rtTheme';

const fmtMoney = (v) => {
    if (v == null || !Number.isFinite(v)) return '—';
    const a = Math.abs(v), s = v < 0 ? '-' : '';
    if (a >= 1e6) return `${s}$${(a / 1e6).toFixed(2)}M`;
    if (a >= 1e3) return `${s}$${(a / 1e3).toFixed(0)}K`;
    return `${s}$${a.toFixed(0)}`;
};

const clock = (iso) => {
    const d = new Date(iso);
    return Number.isFinite(d.getTime())
        ? `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
        : '';
};

export default function RtTrendChart({ trend = [], height = 210, scopeLabel = null }) {
    const ref = useRef(null);
    const chartRef = useRef(null);

    const { times, win, theo, variance } = useMemo(() => {
        const sorted = [...trend].sort((a, b) => String(a.bucket_ts).localeCompare(String(b.bucket_ts)));
        return {
            times: sorted.map((b) => clock(b.bucket_ts)),
            win: sorted.map((b) => Number(b.win) || 0),
            theo: sorted.map((b) => Number(b.theo) || 0),
            variance: sorted.map((b) => (Number(b.win) || 0) - (Number(b.theo) || 0)),
        };
    }, [trend]);

    useEffect(() => {
        if (!ref.current) return;
        if (!chartRef.current) chartRef.current = echarts.init(ref.current);
        const chart = chartRef.current;

        chart.setOption({
            backgroundColor: 'transparent',
            animation: false,
            grid: { left: 58, right: 16, top: 28, bottom: 26 },
            legend: {
                data: ['Casino Win', 'Casino Theo', 'Casino Win − Theo'],
                top: 0, right: 8,
                itemWidth: 16, itemHeight: 8,
                textStyle: { color: TEXT.muted, fontSize: TYPE.caption },
                inactiveColor: 'rgba(255,255,255,0.22)',
            },
            tooltip: {
                trigger: 'axis',
                backgroundColor: 'rgba(23,25,40,0.95)',
                borderColor: 'rgba(122,162,247,0.4)',
                textStyle: { color: '#fff', fontSize: 12 },
                formatter: (ps) => {
                    if (!ps || !ps.length) return '';
                    const rows = ps.map((p) =>
                        `<div style="display:flex;justify-content:space-between;gap:16px">
                           <span style="color:rgba(255,255,255,0.65)">${p.marker} ${p.seriesName}</span>
                           <span style="font-weight:700">${fmtMoney(p.value)}</span>
                         </div>`).join('');
                    return `<div style="min-width:190px"><div style="font-weight:700;margin-bottom:5px">${ps[0].axisValue}</div>${rows}</div>`;
                },
            },
            xAxis: {
                type: 'category',
                data: times,
                axisLine: { lineStyle: { color: 'rgba(255,255,255,0.15)' } },
                // Design-review fix: 0.45 measured ~2.5:1 on this panel —
                // axis labels ARE the data (bucket times), not decoration,
                // so they get TEXT.muted (4.5:1+), not a faint-opacity grey.
                axisLabel: { color: TEXT.muted, fontSize: TYPE.micro, interval: 'auto' },
                axisTick: { show: false },
            },
            yAxis: {
                type: 'value',
                axisLabel: { color: TEXT.muted, fontSize: TYPE.micro, formatter: fmtMoney },
                splitLine: { lineStyle: { color: 'rgba(255,255,255,0.06)' } },
            },
            series: [
                {
                    name: 'Casino Win − Theo', type: 'bar', data: variance,
                    // Variance sits behind the lines as context, and is
                    // the one series that colours by sign — a red bar is
                    // a bucket where the house ran below expectation.
                    itemStyle: {
                        color: (p) => (p.value < 0 ? `${STATE.negative}73` : `${STATE.positive}59`),
                    },
                    barMaxWidth: 14, z: 1,
                },
                {
                    name: 'Casino Theo', type: 'line', data: theo, smooth: true, symbol: 'none',
                    lineStyle: { color: '#7dcfff', width: 1.6, type: 'dashed' }, z: 2,
                },
                {
                    name: 'Casino Win', type: 'line', data: win, smooth: true, symbol: 'none',
                    lineStyle: { color: STATE.positive, width: 2.4 }, z: 3,
                },
            ],
        }, { notMerge: true });

        return undefined;
    }, [times, win, theo, variance]);

    // Dispose only on unmount — re-initialising per data change would
    // throw away the user's legend toggles every poll.
    useEffect(() => () => {
        if (chartRef.current) { chartRef.current.dispose(); chartRef.current = null; }
    }, []);

    useEffect(() => {
        const onResize = () => chartRef.current && chartRef.current.resize();
        window.addEventListener('resize', onResize);
        return () => window.removeEventListener('resize', onResize);
    }, []);

    if (!trend.length) {
        return (
            <Stack sx={{ alignItems: 'center', justifyContent: 'center', height, color: TEXT.faint }}>
                <Typography sx={{ fontSize: TYPE.label }}>No trend data available.</Typography>
                <Typography sx={{ fontSize: TYPE.micro, mt: 0.5 }}>Check the /realtime/trend endpoint.</Typography>
            </Stack>
        );
    }

    return (
        <>
            {scopeLabel && (
                <Typography sx={{ ...systemLabel, letterSpacing: 0.5, mb: 0.4 }}>
                    {scopeLabel}
                </Typography>
            )}
            <Box ref={ref} sx={{ width: '100%', height }} />
        </>
    );
}
