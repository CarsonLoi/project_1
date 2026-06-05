// Custom scatter plot for the Ranking View's right column. Lets the user
// pick X / Y / Size from any numeric KPI and Color from any categorical
// field on the scatter point. Brushing here flows back through the same
// `onSelection` callback the ranking and main heatmap use, so all three
// stay in sync.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as echarts from 'echarts';
import {
  Box,
  Typography,
  FormControl,
  Select,
  MenuItem,
} from '@mui/material';
import { GAMETYPE_COLORS, NUMERIC_KPIS_AVG } from '../../shared/constants/heatmapConstants';
import {
  INSIGHTS_TOKENS as T,
  flatCard,
  slimControl,
  cardHeader,
  cardTitleSx,
  labelSx,
} from './insightsTheme';

// Numeric KPIs available for X / Y / Size — sourced from the shared
// NUMERIC_KPIS_AVG constant so this list stays in lockstep with the
// scatter heatmap KPI dropdown and the ranking chart's KPI dropdown.
// Add or remove numeric KPIs in heatmapConstants.js, not here.
const NUMERIC_KPIS = NUMERIC_KPIS_AVG;

// Categorical fields available for Color.
const CATEGORICAL_FIELDS = [
  { key: 'Gametype',      idx: 3,  label: 'Gametype' },
  { key: 'Area',          idx: 34, label: 'Segment (Area)' },
  { key: 'Zone',          idx: 31, label: 'Sub-segment (Zone)' },
  { key: 'Pit',           idx: 32, label: 'Pit' },
  { key: 'Table minimum', idx: 14, label: 'Table Minimum' },
];

// Brand-aligned palette — the dashboard's 6 saturated hues extended
// with tints so charts with many categorical buckets still render
// clean separation.
const FALLBACK_PALETTE = [
  '#00d4ff', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#3b82f6',
  '#f97316', '#22d3ee', '#a3e635', '#fbbf24', '#c084fc', '#f472b6',
];

// Compact single-line picker: small uppercase label sits to the LEFT
// of the dropdown (instead of stacked above) so a row of 4 selectors
// (X / Y / Size / Color) fits on one horizontal line.
function PickerSelect({ label, value, onChange, options, minWidth = 150 }) {
  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 1,
        minWidth,
        // One-pill container: the label and the dropdown share a single
        // bordered pill so the unit reads as a single control instead
        // of two stacked elements.
        bgcolor: 'rgba(255, 255, 255, 0.02)',
        border: '1px solid rgba(255, 255, 255, 0.06)',
        borderRadius: 1.2,
        pl: 1.2,
        pr: 0.4,
        py: 0.2,
        transition: 'border-color 180ms ease',
        '&:hover': { borderColor: 'rgba(255, 255, 255, 0.16)' },
        '&:focus-within': { borderColor: T.accentPrimary },
      }}
    >
      <Typography
        sx={{
          color: T.textTertiary,
          fontSize: 11,
          letterSpacing: 0.8,
          textTransform: 'uppercase',
          fontWeight: 700,
          lineHeight: 1,
          flexShrink: 0,
        }}
      >
        {label}
      </Typography>
      <FormControl size="small" sx={{ flex: 1, minWidth: 0 }}>
        <Select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          sx={{
            ...slimControl,
            // Strip the inherited bordered chrome — the parent pill
            // owns the border now.
            '& .MuiOutlinedInput-notchedOutline': { border: 'none' },
            '& .MuiSelect-select': { py: '6px', pl: 0.5 },
          }}
        >
          {options.map((o) => (
            <MenuItem key={o} value={o} sx={{ fontSize: '0.95rem' }}>
              {o}
            </MenuItem>
          ))}
        </Select>
      </FormControl>
    </Box>
  );
}

export default function ConfigurableScatter({
  scatterData,
  selectedTables,
  onSelection,
}) {
  const chartRef = useRef(null);
  const instanceRef = useRef(null);
  const propsRef = useRef({ onSelection });
  useEffect(() => {
    propsRef.current = { onSelection };
  }, [onSelection]);

  // Tracks the last selection emitted out of this scatter, so we can
  // suppress no-op re-emits (which would loop with the ranking chart
  // and the main heatmap).
  const lastEmittedRef = useRef([]);

  // Default to per-floor-day variants — the team's preferred denominator.
  const [xKey, setXKey] = useState('Drop per floor day');
  const [yKey, setYKey] = useState('Win per floor day');
  const [sizeKey, setSizeKey] = useState('Patron hours per floor day');
  const [colorKey, setColorKey] = useState('Gametype');

  const xIdx = useMemo(
    () => NUMERIC_KPIS.find((k) => k.key === xKey)?.idx ?? 7,
    [xKey]
  );
  const yIdx = useMemo(
    () => NUMERIC_KPIS.find((k) => k.key === yKey)?.idx ?? 8,
    [yKey]
  );
  const sizeIdx = useMemo(
    () => NUMERIC_KPIS.find((k) => k.key === sizeKey)?.idx ?? 9,
    [sizeKey]
  );
  const colorIdx = useMemo(
    () => CATEGORICAL_FIELDS.find((c) => c.key === colorKey)?.idx ?? 3,
    [colorKey]
  );

  // Build a color map for the currently-selected categorical field.
  const colorMap = useMemo(() => {
    const map = {};
    if (!scatterData || scatterData.length === 0) return map;
    const seen = new Set();
    for (const d of scatterData) {
      const v = String(d[colorIdx] ?? '–');
      if (!seen.has(v)) seen.add(v);
    }
    let i = 0;
    for (const v of seen) {
      // Use the canonical gametype palette when applicable; otherwise
      // fall through to the generic palette.
      if (colorKey === 'Gametype' && GAMETYPE_COLORS[v]) {
        map[v] = GAMETYPE_COLORS[v];
      } else {
        map[v] = FALLBACK_PALETTE[i % FALLBACK_PALETTE.length];
      }
      i += 1;
    }
    return map;
  }, [scatterData, colorIdx, colorKey]);

  // ECharts instance lifecycle.
  useEffect(() => {
    if (!chartRef.current) return;
    let instance = echarts.getInstanceByDom(chartRef.current);
    if (!instance) instance = echarts.init(chartRef.current, 'dark');
    instanceRef.current = instance;

    instance.off('brushselected');
    instance.on('brushselected', (params) => {
      if (!params.batch || !params.batch[0]) return;
      // Brush may select across multiple per-category series; collect
      // labels from every selected series.
      const labels = [];
      for (const sel of params.batch[0].selected || []) {
        // Each series carries its own slice of the data — pull labels
        // from the series' own data array (value[4] = table label).
        const seriesIdx = sel.seriesIndex;
        const optSeries = instance.getOption().series[seriesIdx];
        if (!optSeries || !optSeries.data) continue;
        for (const di of sel.dataIndex || []) {
          const p = optSeries.data[di];
          const label = p && p.value && p.value[4];
          if (label) labels.push(String(label).trim().toUpperCase());
        }
      }
      const dedup = [...new Set(labels)].sort();
      const prev = lastEmittedRef.current;
      const same =
        dedup.length === prev.length && dedup.every((v, i) => v === prev[i]);
      if (same) return;
      lastEmittedRef.current = dedup;
      if (propsRef.current.onSelection) propsRef.current.onSelection(dedup);
    });

    const ro = new ResizeObserver(() => {
      requestAnimationFrame(() => instance && instance.resize());
    });
    ro.observe(chartRef.current);

    return () => {
      ro.disconnect();
      instance.dispose();
      instanceRef.current = null;
    };
  }, [scatterData]);

  // Render / re-render whenever the picker selections or data change.
  useEffect(() => {
    const instance = instanceRef.current;
    if (!instance || !scatterData || scatterData.length === 0) return;

    // Bucket by categorical for one series per category — lets the
    // legend filter natively and tooltip pick up category color.
    const buckets = {};
    for (const d of scatterData) {
      const cat = String(d[colorIdx] ?? '–');
      if (!buckets[cat]) buckets[cat] = [];
      const xv = Number(d[xIdx]);
      const yv = Number(d[yIdx]);
      const sv = Number(d[sizeIdx]);
      if (!Number.isFinite(xv) || !Number.isFinite(yv)) continue;
      // Filter placeholder sentinels (-1000000, -999999).
      if (xv < -990000 || yv < -990000) continue;
      buckets[cat].push({
        value: [xv, yv, sv, cat, d[16]],
        meta: d,
      });
    }

    // Size scaling — symbolSize 8..40 based on percentile of sizeKey.
    const sizeVals = scatterData
      .map((d) => Number(d[sizeIdx]))
      .filter((v) => Number.isFinite(v) && v > -990000);
    const sizeMin = sizeVals.length ? Math.min(...sizeVals) : 0;
    const sizeMax = sizeVals.length ? Math.max(...sizeVals) : 1;
    const sizeSpan = Math.max(1e-9, sizeMax - sizeMin);
    const scaleSize = (v) =>
      Number.isFinite(v) && v > -990000
        ? 8 + (38 * (v - sizeMin)) / sizeSpan
        : 8;

    const series = Object.entries(buckets).map(([cat, points]) => ({
      type: 'scatter',
      name: cat,
      data: points,
      symbolSize: (val) => scaleSize(val[2]),
      itemStyle: {
        color: colorMap[cat] || '#7aa2f7',
        opacity: 0.85,
        borderColor: 'rgba(255,255,255,0.25)',
        borderWidth: 0.5,
      },
      emphasis: {
        itemStyle: { borderColor: '#fff', borderWidth: 1.5 },
      },
    }));

    const sel = new Set(
      (selectedTables || []).map((l) => String(l).trim().toUpperCase())
    );
    if (sel.size > 0) {
      for (const s of series) {
        s.data = s.data.map((p) => {
          const id = String(p.value[4] ?? '').trim().toUpperCase();
          const isOn = sel.has(id);
          return {
            ...p,
            itemStyle: {
              color: colorMap[p.value[3]] || '#7aa2f7',
              opacity: isOn ? 0.95 : 0.12,
              borderColor: isOn ? '#fff' : 'rgba(255,255,255,0.2)',
              borderWidth: isOn ? 1.5 : 0.5,
            },
          };
        });
      }
    }

    instance.setOption(
      {
        backgroundColor: 'transparent',
        animation: false,
        legend: {
          show: Object.keys(buckets).length <= 14,
          textStyle: { color: '#dff5ff', fontSize: 18 },
          right: 10,
          top: 6,
          itemWidth: 14,
          itemHeight: 14,
        },
        toolbox: {
          feature: { brush: { type: ['rect', 'polygon', 'clear'] } },
          top: 4,
          left: 4,
          iconStyle: { borderColor: '#7aa2f7' },
        },
        brush: {
          xAxisIndex: 'all',
          brushLink: 'all',
          outOfRange: { colorAlpha: 0.1 },
          seriesIndex: series.map((_, i) => i),
        },
        grid: { left: 60, right: 20, top: 64, bottom: 60, containLabel: true },
        tooltip: {
          trigger: 'item',
          backgroundColor: 'rgba(23, 25, 40, 0.95)',
          borderColor: 'rgba(122, 162, 247, 0.4)',
          textStyle: { color: '#fff', fontSize: 18 },
          formatter: (p) => {
            const v = p.value;
            const label = v[4];
            return `
              <div style="min-width:200px">
                <div style="font-size:18px;color:#7aa2f7;font-weight:700;border-bottom:1px solid rgba(255,255,255,0.1);padding-bottom:4px;margin-bottom:6px">${label}</div>
                <div>${colorKey}: <b style="color:${colorMap[v[3]] || '#fff'}">${v[3]}</b></div>
                <div>${xKey}: <b>${formatNum(v[0])}</b></div>
                <div>${yKey}: <b>${formatNum(v[1])}</b></div>
                <div>${sizeKey}: <b>${formatNum(v[2])}</b></div>
              </div>
            `;
          },
        },
        xAxis: {
          type: 'value',
          name: xKey,
          nameLocation: 'middle',
          nameGap: 28,
          nameTextStyle: { color: '#dff5ff', fontSize: 18 },
          axisLabel: { color: '#bbb', fontSize: 16, formatter: compactNum },
          splitLine: { lineStyle: { color: 'rgba(255,255,255,0.05)' } },
          scale: true,
        },
        yAxis: {
          type: 'value',
          name: yKey,
          nameLocation: 'middle',
          nameGap: 50,
          nameTextStyle: { color: '#dff5ff', fontSize: 18 },
          axisLabel: { color: '#bbb', fontSize: 16, formatter: compactNum },
          splitLine: { lineStyle: { color: 'rgba(255,255,255,0.05)' } },
          scale: true,
        },
        series,
      },
      true
    );
  }, [scatterData, xKey, yKey, sizeKey, colorKey, xIdx, yIdx, sizeIdx, colorIdx, colorMap, selectedTables]);

  return (
    <Box
      sx={{
        ...flatCard,
        p: 2,
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        minHeight: 0,
      }}
    >
      <Box sx={cardHeader}>
        <Typography sx={cardTitleSx}>Configurable Scatter</Typography>
      </Box>

      {/* Picker row — flexes one selector per slot. Wraps to a second
          line only if the panel gets very narrow; the inline-label
          design (label sits next to each select) lets X / Y / Size /
          Color fit on one line at typical widths. */}
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.8, mb: 1 }}>
        <PickerSelect
          label="X"
          value={xKey}
          onChange={setXKey}
          options={NUMERIC_KPIS.map((k) => k.key)}
        />
        <PickerSelect
          label="Y"
          value={yKey}
          onChange={setYKey}
          options={NUMERIC_KPIS.map((k) => k.key)}
        />
        <PickerSelect
          label="Size"
          value={sizeKey}
          onChange={setSizeKey}
          options={NUMERIC_KPIS.map((k) => k.key)}
        />
        <PickerSelect
          label="Color"
          value={colorKey}
          onChange={setColorKey}
          options={CATEGORICAL_FIELDS.map((c) => c.key)}
        />
      </Box>

      <Box ref={chartRef} sx={{ flex: 1, minHeight: 0 }} />
    </Box>
  );
}

function compactNum(v) {
  if (v == null || !Number.isFinite(v)) return v;
  const abs = Math.abs(v);
  const sign = v < 0 ? '-' : '';
  if (abs >= 1e6) return sign + (abs / 1e6).toFixed(abs >= 1e7 ? 0 : 1).replace(/\.0$/, '') + 'm';
  if (abs >= 1e3) return sign + (abs / 1e3).toFixed(abs >= 1e4 ? 0 : 1).replace(/\.0$/, '') + 'k';
  return v.toLocaleString(undefined, { maximumFractionDigits: 1 });
}

function formatNum(v) {
  if (typeof v !== 'number') return v;
  if (v <= -990000) return 'n/a';
  return v.toLocaleString(undefined, { maximumFractionDigits: 1 });
}
