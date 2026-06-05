// Hot-trend crowd-flow analytics — overlays the bottom-right of the
// Casino Floor. Two charts and three KPI tiles, all derived from `sim`:
//
//   Metric A — Hot-Trigger Attraction Curve (line chart)
//     For every moment a table's `surprise` crosses 5 (cold → hot),
//     averages headcount on (i) the trigger-table itself and
//     (ii) the floor as a whole over t ∈ [−15, +15] minutes.
//     Hypothesis 1: red line climbs above grey after t=0.
//
//   Metric B — Idle Rate vs. Distance from Hot Table (bar chart)
//     For every minute, finds tables with surprise ≥ 5, then buckets
//     all OTHER open tables by minimum distance to any hot table.
//     Reports the % idle (headcount == 0) per ring.
//     Hypothesis 2: closer rings show higher idle rate.
//
//   KPI tiles
//     hot avg headcount  ·  cold avg headcount  ·  attraction ratio
//
// Toggled on/off by the parent — set `show` to control visibility.

import React, { useEffect, useMemo, useRef } from 'react';
import * as echarts from 'echarts';
import { Box, Typography, Stack } from '@mui/material';

const HOT_THRESHOLD = 5;
const WINDOW_MIN = 15;
const RINGS = [
  { label: '<150', max: 150 },
  { label: '150–300', max: 300 },
  { label: '300–500', max: 500 },
  { label: '>500', max: Infinity },
];

function computeAnalytics(sim) {
  const empty = {
    triggers: 0,
    attraction: null,
    rings: null,
    hotAvg: 0,
    coldAvg: 0,
    ratio: 0,
  };
  if (!sim || !sim.frames || sim.frames.length === 0) return empty;

  const frames = sim.frames;
  const tableById = new Map(sim.tables.map((t) => [t.id, t]));

  // ---- Trigger detection: surprise <HOT_THRESHOLD → ≥HOT_THRESHOLD ----
  // Walk each table once; record (tableId, minute) every time it goes hot.
  const triggers = [];
  const prevHotByTable = new Map();
  for (let m = 0; m < frames.length; m++) {
    const frame = frames[m];
    for (const p of frame.perTable) {
      if (p.closed) continue;
      const wasHot = prevHotByTable.get(p.tableId) || false;
      const nowHot = p.surprise >= HOT_THRESHOLD;
      if (nowHot && !wasHot) triggers.push({ tableId: p.tableId, minute: m });
      prevHotByTable.set(p.tableId, nowHot);
    }
  }

  // ---- KPI tiles: avg headcount partitioned by hot vs cold ----
  let hotSum = 0, hotN = 0, coldSum = 0, coldN = 0;
  for (const f of frames) {
    for (const p of f.perTable) {
      if (p.closed) continue;
      if (p.surprise >= HOT_THRESHOLD) { hotSum += p.headcount; hotN += 1; }
      else { coldSum += p.headcount; coldN += 1; }
    }
  }
  const hotAvg = hotN > 0 ? hotSum / hotN : 0;
  const coldAvg = coldN > 0 ? coldSum / coldN : 0;
  const ratio = coldAvg > 0 ? hotAvg / coldAvg : 0;

  // ---- Metric A — attraction curve around each trigger ----
  // For each trigger, accumulate headcount on the trigger-table and the
  // floor-wide average over t ∈ [-WINDOW_MIN, +WINDOW_MIN]. Normalize.
  const len = 2 * WINDOW_MIN + 1;
  const xValues = Array.from({ length: len }, (_, i) => i - WINDOW_MIN);
  const hotSeries = new Array(len).fill(0);
  const floorSeries = new Array(len).fill(0);
  const counts = new Array(len).fill(0);

  for (const tr of triggers) {
    for (let dm = -WINDOW_MIN; dm <= WINDOW_MIN; dm++) {
      const m = tr.minute + dm;
      if (m < 0 || m >= frames.length) continue;
      const frame = frames[m];
      const target = frame.perTable.find((p) => p.tableId === tr.tableId);
      if (!target) continue;
      const openTables = frame.perTable.filter((p) => !p.closed);
      const floorAvg =
        openTables.length === 0
          ? 0
          : openTables.reduce((a, p) => a + p.headcount, 0) / openTables.length;
      hotSeries[dm + WINDOW_MIN] += target.headcount;
      floorSeries[dm + WINDOW_MIN] += floorAvg;
      counts[dm + WINDOW_MIN] += 1;
    }
  }
  const hotLine = hotSeries.map((s, i) => (counts[i] > 0 ? s / counts[i] : null));
  const floorLine = floorSeries.map((s, i) => (counts[i] > 0 ? s / counts[i] : null));

  // ---- Metric B — idle rate by distance ring ----
  const ringTotals = RINGS.map(() => ({ idle: 0, total: 0 }));
  for (const frame of frames) {
    const hots = frame.perTable.filter((p) => !p.closed && p.surprise >= HOT_THRESHOLD);
    if (hots.length === 0) continue;
    for (const p of frame.perTable) {
      if (p.closed) continue;
      if (p.surprise >= HOT_THRESHOLD) continue; // skip hot tables themselves
      const tp = tableById.get(p.tableId);
      if (!tp) continue;
      let minDist = Infinity;
      for (const h of hots) {
        const th = tableById.get(h.tableId);
        if (!th) continue;
        const d = Math.hypot(tp.x - th.x, tp.y - th.y);
        if (d < minDist) minDist = d;
      }
      for (let i = 0; i < RINGS.length; i++) {
        if (minDist <= RINGS[i].max) {
          ringTotals[i].total += 1;
          if (p.headcount === 0) ringTotals[i].idle += 1;
          break;
        }
      }
    }
  }
  const rings = RINGS.map((r, i) => ({
    label: r.label,
    idleRate: ringTotals[i].total > 0 ? ringTotals[i].idle / ringTotals[i].total : 0,
    sample: ringTotals[i].total,
  }));

  return {
    triggers: triggers.length,
    attraction: { x: xValues, hot: hotLine, floor: floorLine },
    rings,
    hotAvg,
    coldAvg,
    ratio,
  };
}

function KpiTile({ label, value, color = '#7adfff', sub }) {
  return (
    <Box
      sx={{
        flex: 1,
        bgcolor: 'rgba(8, 30, 48, 0.5)',
        border: '1px solid rgba(122, 200, 220, 0.18)',
        borderRadius: 1.2,
        px: 1.4,
        py: 1,
      }}
    >
      <Typography
        sx={{
          color: 'rgba(255,255,255,0.55)',
          fontSize: 18,
          letterSpacing: 1.2,
          fontWeight: 700,
          lineHeight: 1,
        }}
      >
        {label}
      </Typography>
      <Typography
        sx={{
          color,
          fontWeight: 800,
          fontSize: 30,
          fontFamily: 'monospace',
          letterSpacing: 0.5,
          lineHeight: 1.2,
          mt: 0.4,
        }}
      >
        {value}
      </Typography>
      {sub && (
        <Typography sx={{ color: 'rgba(255,255,255,0.4)', fontSize: 15, lineHeight: 1.2, mt: 0.2 }}>
          {sub}
        </Typography>
      )}
    </Box>
  );
}

// Fills its parent box (height: 100%, width: 100%). Parents must provide
// a definite height — typically via `flex: 1` + `minHeight: 0`.
function MiniChart({ option }) {
  const ref = useRef(null);
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

export default function TrendAnalyticsOverlay({ sim, show = true }) {
  const m = useMemo(() => computeAnalytics(sim), [sim]);

  const attractionOption = useMemo(() => {
    if (!m.attraction) return null;
    return {
      backgroundColor: 'transparent',
      animation: false,
      grid: { left: 48, right: 12, top: 12, bottom: 32 },
      tooltip: { trigger: 'axis', textStyle: { fontSize: 17 } },
      xAxis: {
        type: 'category',
        data: m.attraction.x.map((v) => (v === 0 ? '0' : v > 0 ? `+${v}` : `${v}`)),
        axisLabel: { color: 'rgba(255,255,255,0.55)', fontSize: 16 },
        axisLine: { lineStyle: { color: 'rgba(255,255,255,0.2)' } },
        splitLine: { show: false },
      },
      yAxis: {
        type: 'value',
        axisLabel: { color: 'rgba(255,255,255,0.55)', fontSize: 16 },
        splitLine: { lineStyle: { color: 'rgba(255,255,255,0.08)' } },
      },
      series: [
        {
          name: 'Hot table',
          type: 'line',
          data: m.attraction.hot,
          smooth: true,
          showSymbol: false,
          lineStyle: { color: '#ff6b1a', width: 2 },
          areaStyle: { color: 'rgba(255,107,26,0.18)' },
        },
        {
          name: 'Floor avg',
          type: 'line',
          data: m.attraction.floor,
          smooth: true,
          showSymbol: false,
          lineStyle: { color: 'rgba(255,255,255,0.55)', width: 1.5, type: 'dashed' },
        },
        // Vertical marker at t=0
        {
          name: 'trigger',
          type: 'line',
          data: [],
          markLine: {
            silent: true,
            symbol: 'none',
            lineStyle: { color: '#ffd27a', width: 1, type: 'dotted' },
            label: { show: false },
            data: [{ xAxis: WINDOW_MIN }],
          },
        },
      ],
    };
  }, [m.attraction]);

  const ringsOption = useMemo(() => {
    if (!m.rings) return null;
    const colors = ['#ff2d2d', '#ff7a00', '#f7c800', '#5acca8'];
    return {
      backgroundColor: 'transparent',
      animation: false,
      grid: { left: 56, right: 12, top: 12, bottom: 32 },
      tooltip: {
        trigger: 'axis',
        textStyle: { fontSize: 17 },
        formatter: (params) => {
          const p = params[0];
          const r = m.rings[p.dataIndex];
          return `${r.label} px<br/>idle ${(r.idleRate * 100).toFixed(1)}%<br/>sample n=${r.sample.toLocaleString()}`;
        },
      },
      xAxis: {
        type: 'category',
        data: m.rings.map((r) => r.label),
        axisLabel: { color: 'rgba(255,255,255,0.55)', fontSize: 16 },
        axisLine: { lineStyle: { color: 'rgba(255,255,255,0.2)' } },
      },
      yAxis: {
        type: 'value',
        min: 0,
        max: Math.max(0.05, ...m.rings.map((r) => r.idleRate)) * 1.15,
        axisLabel: {
          color: 'rgba(255,255,255,0.55)',
          fontSize: 16,
          formatter: (v) => `${(v * 100).toFixed(0)}%`,
        },
        splitLine: { lineStyle: { color: 'rgba(255,255,255,0.08)' } },
      },
      series: [
        {
          type: 'bar',
          data: m.rings.map((r, i) => ({ value: r.idleRate, itemStyle: { color: colors[i] } })),
          barWidth: '60%',
        },
      ],
    };
  }, [m.rings]);

  if (!show) return null;

  return (
    <Box
      sx={{
        // Inline panel that fills its grid slot — same card styling as
        // HotTablesPanel / TrendScoreChart so the right rail reads as a
        // single visual stack.
        bgcolor: 'rgba(8, 30, 48, 0.7)',
        border: '1px solid rgba(122, 200, 220, 0.18)',
        borderRadius: 2,
        backdropFilter: 'blur(8px)',
        p: 1.5,
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
        overflow: 'hidden',
      }}
    >
      <Typography
        variant="overline"
        sx={{
          color: '#7adfff',
          letterSpacing: 1.5,
          fontWeight: 700,
          fontSize: 21,
          display: 'block',
          mb: 1,
          lineHeight: 1.2,
          flexShrink: 0,
        }}
      >
        Attraction Analytics
      </Typography>

      <Stack direction="row" spacing={1} sx={{ mb: 1.2, flexShrink: 0 }}>
        <KpiTile
          label="HOT AVG"
          value={m.hotAvg.toFixed(2)}
          color="#ff6b1a"
          sub="players (Trend Strength ≥ 5)"
        />
        <KpiTile
          label="COLD AVG"
          value={m.coldAvg.toFixed(2)}
          color="#7adfff"
          sub="players (Trend Strength &lt; 5)"
        />
        <KpiTile
          label="LIFT"
          value={m.ratio > 0 ? `${m.ratio.toFixed(2)}×` : '–'}
          color={m.ratio >= 1.3 ? '#5ac8a8' : m.ratio >= 1 ? '#f7b500' : '#ff6b1a'}
          sub={`${m.triggers} triggers`}
        />
      </Stack>

      {/* Two charts stacked vertically to fit the narrow right-rail
          column. Each flex:1 so they share remaining vertical room. */}
      <Stack spacing={1.2} sx={{ flex: 1, minHeight: 0 }}>
        <Box sx={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
          <Typography
            sx={{
              color: 'rgba(255,255,255,0.7)',
              fontSize: 18,
              mb: 0.3,
              fontWeight: 700,
              letterSpacing: 0.5,
              flexShrink: 0,
            }}
          >
            A · Headcount around hot trigger
          </Typography>
          <Box sx={{ flex: 1, minHeight: 0 }}>
            {attractionOption ? (
              <MiniChart option={attractionOption} />
            ) : (
              <Box sx={{ color: 'rgba(255,255,255,0.4)', fontSize: 16, height: '100%', display: 'grid', placeItems: 'center' }}>
                no triggers in the loaded data
              </Box>
            )}
          </Box>
        </Box>
        <Box sx={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
          <Typography
            sx={{
              color: 'rgba(255,255,255,0.7)',
              fontSize: 18,
              mb: 0.3,
              fontWeight: 700,
              letterSpacing: 0.5,
              flexShrink: 0,
            }}
          >
            B · Idle rate vs. distance (px)
          </Typography>
          <Box sx={{ flex: 1, minHeight: 0 }}>
            {ringsOption ? (
              <MiniChart option={ringsOption} />
            ) : (
              <Box sx={{ color: 'rgba(255,255,255,0.4)', fontSize: 16, height: '100%', display: 'grid', placeItems: 'center' }}>
                no hot tables in the loaded data
              </Box>
            )}
          </Box>
        </Box>
      </Stack>
    </Box>
  );
}
