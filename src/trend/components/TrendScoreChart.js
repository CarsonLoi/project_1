import React, { useEffect, useMemo, useRef } from 'react';
import * as echarts from 'echarts';
import { Box, Typography, Stack } from '@mui/material';

const BUCKETS = [
  { label: '0', match: (s) => s === 0 },
  { label: '1-2', match: (s) => s >= 1 && s <= 2 },
  { label: '3-4', match: (s) => s >= 3 && s <= 4 },
  { label: '5-6', match: (s) => s >= 5 && s <= 6 },
  { label: '7+', match: (s) => s >= 7 },
];

const BUCKET_COLORS = ['#2f7a82', '#5ac8a8', '#f7b500', '#ff6b1a', '#ff2d2d'];

// Reusable mini bar chart for one metric (headcount OR avg bet). Self-
// contained ECharts instance with its own resize observer so two of these
// can stack inside the card without interfering. The container fills the
// flex parent (height: 100%) so two charts auto-share whatever room the
// card has left after the header.
function BucketBarChart({ buckets, metric }) {
  const ref = useRef(null);

  const option = useMemo(() => {
    const values =
      metric === 'headcount'
        ? buckets.map((b) => +b.meanHeadcount.toFixed(2))
        : buckets.map((b) => Math.round(b.meanAvgBet));
    const baseline = values[0] || 1;

    return {
      backgroundColor: 'transparent',
      animationDuration: 350,
      grid: { left: 60, right: 12, top: 24, bottom: 40 },
      tooltip: {
        trigger: 'axis',
        backgroundColor: 'rgba(10, 22, 35, 0.95)',
        borderColor: 'rgba(122, 200, 220, 0.4)',
        textStyle: { color: '#dff5ff', fontSize: 18 },
        formatter: (params) => {
          const p = params[0];
          const b = buckets[p.dataIndex];
          const lift =
            baseline > 0
              ? `${(((p.value - baseline) / baseline) * 100).toFixed(0)}%`
              : '–';
          const valLabel =
            metric === 'headcount'
              ? `${p.value.toFixed(2)} players`
              : `$${p.value.toLocaleString()}`;
          return `
            <b>Trend Strength ${b.label}</b><br/>
            ${metric === 'headcount' ? 'Mean headcount' : 'Mean avg bet'}: <b>${valLabel}</b><br/>
            Lift vs strength=0: <b>${lift}</b><br/>
            <span style="opacity:0.6">${b.n.toLocaleString()} samples</span>
          `;
        },
      },
      xAxis: {
        type: 'category',
        data: buckets.map((b) => b.label),
        name: 'Trend Strength (bits)',
        nameLocation: 'middle',
        nameGap: 30,
        nameTextStyle: { color: 'rgba(255,255,255,0.55)', fontSize: 17 },
        axisLine: { lineStyle: { color: 'rgba(122,200,220,0.25)' } },
        axisLabel: { fontSize: 18, color: 'rgba(255,255,255,0.7)' },
      },
      yAxis: {
        type: 'value',
        axisLine: { show: false },
        axisLabel: {
          fontSize: 16,
          color: 'rgba(255,255,255,0.55)',
          formatter:
            metric === 'avgBet'
              ? (v) => (v >= 1000 ? `$${(v / 1000).toFixed(0)}k` : `$${v}`)
              : null,
        },
        splitLine: { lineStyle: { color: 'rgba(255,255,255,0.06)' } },
      },
      series: [
        {
          type: 'bar',
          data: values.map((v, i) => ({
            value: v,
            itemStyle: {
              color: BUCKET_COLORS[i],
              shadowBlur: i >= 3 ? 12 : 4,
              shadowColor: BUCKET_COLORS[i],
              borderRadius: [4, 4, 0, 0],
            },
          })),
          barWidth: '62%',
          label: {
            show: true,
            position: 'top',
            color: '#fff',
            fontSize: 16,
            fontWeight: 700,
            formatter: (p) =>
              metric === 'avgBet'
                ? `$${p.value.toLocaleString()}`
                : p.value.toFixed(1),
          },
        },
      ],
    };
  }, [buckets, metric]);

  useEffect(() => {
    if (!ref.current) return;
    const inst = echarts.init(ref.current, 'dark');
    inst.setOption(option, true);
    const ro = new ResizeObserver(() => requestAnimationFrame(() => inst.resize()));
    ro.observe(ref.current);
    return () => {
      ro.disconnect();
      inst.dispose();
    };
  }, [option]);

  return <div ref={ref} style={{ width: '100%', height: '100%', minHeight: 0 }} />;
}

export default function TrendScoreChart({ sim }) {
  // Aggregate over all frames: mean(headcount), mean(avgBet) per surprise bucket
  const buckets = useMemo(() => {
    const agg = BUCKETS.map(() => ({ hc: 0, bet: 0, n: 0 }));
    sim.frames.forEach((f) => {
      f.perTable.forEach((p) => {
        if (p.broken || p.closed) return;
        const idx = BUCKETS.findIndex((b) => b.match(p.surprise));
        if (idx < 0) return;
        agg[idx].hc += p.headcount;
        agg[idx].bet += p.avgBet || 0;
        agg[idx].n += 1;
      });
    });
    return BUCKETS.map((b, i) => ({
      label: b.label,
      meanHeadcount: agg[i].n ? agg[i].hc / agg[i].n : 0,
      meanAvgBet: agg[i].n ? agg[i].bet / agg[i].n : 0,
      n: agg[i].n,
    }));
  }, [sim]);

  return (
    <Box
      sx={{
        bgcolor: 'rgba(8, 30, 48, 0.7)',
        border: '1px solid rgba(122, 200, 220, 0.18)',
        borderRadius: 2,
        p: 1.5,
        backdropFilter: 'blur(8px)',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      <Typography
        variant="overline"
        sx={{
          color: '#7adfff',
          fontWeight: 700,
          letterSpacing: 1.5,
          fontSize: 21,
          lineHeight: 1.2,
          mb: 0.5,
        }}
      >
        Headcount &amp; Avg Bet by Trend Strength
      </Typography>
      <Typography
        variant="caption"
        sx={{
          color: 'rgba(255,255,255,0.45)',
          fontSize: 17,
          display: 'block',
          mb: 1,
        }}
      >
        Mean per-table values grouped by trend score (whole simulation)
      </Typography>

      {/* Two charts share the remaining vertical space via flex: 1.
          BucketBarChart fills its parent (height: 100%), so the two
          bars grow into whatever room HotTablesPanel leaves above. */}
      <Stack spacing={1.2} sx={{ flex: 1, minHeight: 0 }}>
        <Box sx={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
          <Typography
            sx={{
              color: 'rgba(255,255,255,0.65)',
              fontSize: 18,
              fontWeight: 700,
              letterSpacing: 0.5,
              mb: 0.3,
              flexShrink: 0,
            }}
          >
            Headcount
          </Typography>
          <Box sx={{ flex: 1, minHeight: 0 }}>
            <BucketBarChart buckets={buckets} metric="headcount" />
          </Box>
        </Box>
        <Box sx={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
          <Typography
            sx={{
              color: 'rgba(255,255,255,0.65)',
              fontSize: 18,
              fontWeight: 700,
              letterSpacing: 0.5,
              mb: 0.3,
              flexShrink: 0,
            }}
          >
            Avg Bet
          </Typography>
          <Box sx={{ flex: 1, minHeight: 0 }}>
            <BucketBarChart buckets={buckets} metric="avgBet" />
          </Box>
        </Box>
      </Stack>
    </Box>
  );
}
