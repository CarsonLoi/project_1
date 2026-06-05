import React, { useEffect, useRef, useState } from 'react';
import * as echarts from 'echarts';
import * as d3 from 'd3';
import { FLOOR_WIDTH, FLOOR_HEIGHT } from '../utils/floorLayout';
import { gametype_svg_path } from '../../shared/constants/heatmapConstants';
import { buildRoadGrid } from '../utils/roadmaps';

const X_RANGE = [0, FLOOR_WIDTH];
const Y_RANGE = [0, FLOOR_HEIGHT];

// COLOR = headcount (crowd density at the table).
// Single palette used by both the scatter dots (discrete 0..7)
// and the contour overlay (continuous interpolation across 0..1).
const HEADCOUNT_PALETTE = [
  '#3a4a5c', // 0 empty   - dim slate
  '#4d7c8c', // 1         - dim teal
  '#3da5b8', // 2         - teal
  '#5ac8a8', // 3         - mint
  '#a4d65e', // 4         - lime
  '#f7b500', // 5         - yellow
  '#ff6b1a', // 6         - orange
  '#ff2d2d', // 7 packed  - red
];

function headcountColor(h) {
  const i = Math.max(0, Math.min(7, Math.round(h)));
  return HEADCOUNT_PALETTE[i];
}

// Cold → hot palette used by the contour overlay (which now visualises
// *trend strength*, not crowd density) and by the trend-heat visualMap
// legend. Six stops, deep blue at the cold end → red at the hot end.
const TREND_PALETTE = [
  '#2667d1', '#3fa7e0', '#5acca8', '#f7c800', '#ff7a00', '#ff2d2d',
];

// Map a t ∈ [0,1] (= ring index / max ring) to a TREND_PALETTE color.
const trendColorScale = d3
  .scaleLinear()
  .domain(TREND_PALETTE.map((_, i) => i / (TREND_PALETTE.length - 1)))
  .range(TREND_PALETTE)
  .interpolate(d3.interpolateRgb)
  .clamp(true);

// SVG-path scale factor — matches the Performance Heatmap (which uses
// `[sizeX * 2, sizeY * 2]`). Keeps the two pages visually consistent.
const SYMBOL_SCALE = 2;

// Surprise-driven size boost is currently DISABLED — trend strength is
// communicated through the contour overlay's cold→hot color instead.
// To re-enable, uncomment the original body below.
function surpriseSizeMultiplier(/* surprise */) {
  /*
  const MAX_BOOST = 1.4;   // peak extra scale on top of 1.0
  const EXP = 1.4;         // power-curve steepness
  const s = Math.max(0, Math.min(9, surprise));
  return 1 + Math.pow(s / 9, EXP) * MAX_BOOST;
  */
  return 1;
}

// Mini Big Road rendered as an inline SVG string for the hover tooltip.
// Uses the same `buildRoadGrid` helper as the full BaccaratBoard so the
// shape stays consistent — capped at the last 12 columns × 6 rows.
function bigRoadSvg(history, cellSize = 14, maxCols = 12, rows = 6) {
  const clean = (history || '').replace(/[^BP]/g, '');
  if (clean.length === 0) {
    return `<div style="opacity:0.5;font-style:italic;margin-top:6px;font-size:14px">no shoe data</div>`;
  }
  const items = clean.split('').map((symbol) => ({ symbol }));
  const { positions, maxCol } = buildRoadGrid(items, rows);
  const offset = Math.max(0, maxCol - (maxCols - 1));

  const w = maxCols * cellSize;
  const h = rows * cellSize;
  let svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" ` +
    `style="display:block;margin-top:6px;background:#0f1923;` +
    `border:1px solid rgba(255,255,255,0.18);border-radius:4px">`;
  // Faint grid for readability
  for (let r = 1; r < rows; r++) {
    svg += `<line x1="0" y1="${r * cellSize}" x2="${w}" y2="${r * cellSize}" stroke="rgba(255,255,255,0.05)" stroke-width="1"/>`;
  }
  for (let c = 1; c < maxCols; c++) {
    svg += `<line x1="${c * cellSize}" y1="0" x2="${c * cellSize}" y2="${h}" stroke="rgba(255,255,255,0.05)" stroke-width="1"/>`;
  }
  for (const p of positions) {
    const col = p.col - offset;
    if (col < 0 || col >= maxCols) continue;
    const cx = col * cellSize + cellSize / 2;
    const cy = p.row * cellSize + cellSize / 2;
    const stroke = p.symbol === 'B' ? '#ff2d2d' : '#3b6c9e';
    svg += `<circle cx="${cx}" cy="${cy}" r="${cellSize * 0.35}" fill="none" stroke="${stroke}" stroke-width="1.8"/>`;
  }
  svg += '</svg>';
  return svg;
}

export default function CasinoFloor({
  frame,
  tables,
  onTableClick,
  selectedTableId,
  densityMode = 'contour',     // 'contour' | 'ripple' | 'off'
  rippleThreshold = 7,
  rippleSize = 50,
  onChartSize,                 // ({width, height}) — pixel size of chart
}) {
  const ref = useRef(null);
  const [chartInstance, setChartInstance] = useState(null);
  const onTableClickRef = useRef(onTableClick);
  const onChartSizeRef = useRef(onChartSize);
  useEffect(() => { onChartSizeRef.current = onChartSize; }, [onChartSize]);

  // Always keep ref pointing at latest callback (avoid stale closures)
  useEffect(() => {
    onTableClickRef.current = onTableClick;
  }, [onTableClick]);

  // Initialize chart once. Mirrors ScatterHeatmapAvg's pattern: stash the
  // instance in state so the update effect re-runs once it's ready (the
  // update effect depends on `chartInstance`, not just `frame`).
  useEffect(() => {
    if (!ref.current) return;

    // Reuse any existing instance on this DOM node (Strict Mode double-
    // mount can leave one behind even after dispose() if the second mount
    // races the first cleanup).
    let instance = echarts.getInstanceByDom(ref.current);
    if (!instance) {
      instance = echarts.init(ref.current, 'dark');
      setChartInstance(instance);
    } else {
      setChartInstance(instance);
    }

    // Scatter click — fire onTableClick with tableId
    instance.off('click');
    instance.on('click', (params) => {
      if (params.seriesType !== 'scatter') return;
      const id = params.data?.meta?.tableId;
      if (id != null && onTableClickRef.current) {
        onTableClickRef.current(id);
      }
    });

    // Report the chart's pixel size to the parent so siblings (e.g. the
    // stats table) can do pixel-accurate geometry. Grid is full-bleed,
    // so the chart pixel size equals the data area's pixel size.
    const reportSize = () => {
      if (!instance || instance.isDisposed() || !ref.current) return;
      const cb = onChartSizeRef.current;
      if (!cb) return;
      const w = ref.current.clientWidth;
      const h = ref.current.clientHeight;
      if (w > 0 && h > 0) cb({ width: w, height: h });
    };
    reportSize();

    const onResize = () => {
      instance.resize();
      reportSize();
    };
    window.addEventListener('resize', onResize);

    // ResizeObserver — catches container-size changes after init.
    const resizeObserver = new ResizeObserver(() => {
      requestAnimationFrame(() => {
        if (instance && !instance.isDisposed()) instance.resize();
        reportSize();
      });
    });
    resizeObserver.observe(ref.current);

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener('resize', onResize);
      instance.dispose();
    };
  }, []);

  // Update chart whenever frame / data deps change.
  useEffect(() => {
    if (!chartInstance || !frame) return;

    const tableMap = new Map(tables.map((t) => [t.id, t]));

    // Scatter encoding:
    //   SHAPE      = game type (BA / NC / SB / BJ / ...) — same SVG paths
    //                the Performance Heatmap uses, from gametype_svg_path.
    //   ROTATION   = each table's `rotation` from config_cod.json.
    //   SIZE       = base footprint × (1 + small surprise boost), so hot
    //                tables read slightly larger without breaking the
    //                physical-floor proportions.
    //   COLOR      = headcount (red = packed table).
    //   Broken streaks get a blue ring; hot trends get a white ring and
    //   a stronger shadow so they pop even at their real footprint.
    const scatterData = frame.perTable.map((p) => {
      const t = tableMap.get(p.tableId);
      const isSelected = p.tableId === selectedTableId;
      // baseColor mirrors the visualMap mapping — used only for the
      // shadow glow, since the symbol fill itself is driven by visualMap.
      const baseColor = p.closed ? '#1f2733' : headcountColor(p.headcount);

      const svgDef = t && t.game ? gametype_svg_path[t.game] : null;
      const symbol = svgDef ? 'path://' + svgDef.path : 'circle';
      // surpriseSizeMultiplier() is now disabled (returns 1). Closed
      // tables still shrink slightly so they read as "not operating",
      // and the selected table gets the usual nudge.
      const sizeMul = p.closed
        ? 0.7
        : surpriseSizeMultiplier(p.surprise) * (isSelected ? 1.15 : 1);
      const symbolSize = svgDef
        ? [svgDef.size_X * SYMBOL_SCALE * sizeMul, svgDef.size_Y * SYMBOL_SCALE * sizeMul]
        : 14 * sizeMul;
      const symbolRotate = t && Number.isFinite(t.rotation) ? t.rotation : 0;

      let borderColor = 'rgba(255,255,255,0.25)';
      let borderWidth = 0.5;
      if (p.broken && !p.closed) {
        borderColor = '#7aaedf';
        borderWidth = 1.8;
      }
      if (p.surprise >= 5 && !p.closed) {
        borderColor = '#ffffff';
        borderWidth = 1.5;
      }
      if (isSelected) {
        borderColor = '#7adfff';
        borderWidth = 3;
      }
      if (p.closed && !isSelected) {
        borderColor = 'rgba(255,255,255,0.18)';
        borderWidth = 0.6;
      }
      return {
        // value[4] carries the headcount for the visualMap legend; closed
        // tables get a sentinel of -1 so the `lt: 0` piece labels them
        // "Closed". The actual paint color is set on itemStyle.color
        // below (per-item) — visualMap doesn't reliably inject color
        // into rich object-form data items, so we drive fill directly
        // from the headcount palette and let the visualMap act purely
        // as a legend swatch.
        value: [
          p.x, p.y, p.surprise, p.broken ? 1 : 0,
          p.closed ? -1 : Math.max(0, Math.min(7, Math.round(p.headcount || 0))),
          p.tableId,
        ],
        meta: { ...p, label: t?.label, pit: t?.pit, min: t?.min, game: t?.game },
        symbol,
        symbolSize,
        symbolRotate,
        itemStyle: {
          color: baseColor,
          borderColor,
          borderWidth,
          shadowBlur: p.closed ? 0 : isSelected ? 22 : p.surprise >= 5 ? 16 : 4,
          shadowColor: isSelected ? '#7adfff' : baseColor,
          opacity: p.closed ? 0.35 : 1,
        },
      };
    });

    const option = {
      backgroundColor: 'transparent',
      animation: false,
      grid: { left: 0, right: 0, top: 0, bottom: 0, containLabel: false },
      // Background image slot — same mechanism the Performance Heatmap
      // uses. To enable, replace the array below with:
      //   graphic: [{
      //     type: 'image',
      //     left: 0, top: 0,
      //     bounding: 'all',         // stretch to chart bounds
      //     z: 0,                    // behind every series
      //     style: {
      //       image: floorPng,       // import or URL
      //       width: '100%',
      //       height: '100%',
      //       opacity: 0.85,
      //     },
      //   }],
      // The image renders inside the chart canvas — no extra DOM, no
      // separate SVG overlay, and the d3 contour / table scatter draw
      // on top of it automatically.
      graphic: [],
      tooltip: {
        trigger: 'item',
        backgroundColor: 'rgba(10, 22, 35, 0.95)',
        borderColor: 'rgba(122, 200, 220, 0.5)',
        borderWidth: 1,
        padding: [12, 16],
        textStyle: { color: '#dff5ff', fontSize: 21 },
        formatter: (params) => {
          if (params.seriesType !== 'scatter') return '';
          const m = params.data.meta;
          if (!m) return '';
          const heatBadge = m.closed
            ? '<span style="background:#444a55;color:#cfd6e0;padding:1px 6px;border-radius:8px;font-size:15px;margin-left:6px">CLOSED</span>'
            : m.surprise >= 5
            ? '<span style="background:#ff2d2d;color:#fff;padding:1px 6px;border-radius:8px;font-size:15px;margin-left:6px">HOT</span>'
            : m.broken
            ? '<span style="background:#3b6c9e;color:#fff;padding:1px 6px;border-radius:8px;font-size:15px;margin-left:6px">COOL</span>'
            : '';
          // Closed tables: every live metric (headcount, surprise, motif,
          // history) is meaningless, so render them as "n.a." rather than
          // showing stale forward-filled values.
          const closed = !!m.closed;
          const na = '<span style="color:rgba(255,255,255,0.45);font-style:italic">n.a.</span>';
          // PRIMARY trend display = prior-12 ("visible trend"), since the
          // tooltip's job is to answer "what did the patron see BEFORE
          // sitting?". Pairs directly with Headcount on the next row so
          // the visible-trend → headcount link is readable at a glance.
          // Status tints the number: hot (≥5) green-ish, warm (≥3) amber,
          // cool grey — matches the bucketing emitted by trendDataSource.
          const priorStatus = m.priorTrendStatus || 'cool';
          const priorColor =
            priorStatus === 'hot'  ? '#5ae6b0' :
            priorStatus === 'warm' ? '#ffd27a' :
                                     'rgba(255,255,255,0.75)';
          const visibleTrend = closed
            ? '<span style="color:#cfd6e0;font-weight:700">Closed</span>'
            : `<b style="color:${priorColor}">${m.priorSurprise ?? 0}</b>` +
              ` · ${m.priorMotif || '–'}` +
              ` <span style="opacity:0.55;font-size:15px;text-transform:uppercase;letter-spacing:1px">${priorStatus}</span>`;
          // Secondary: full-shoe latest-state trend (post-current-hand).
          // Still useful — tells operators what the bead plate looks like
          // RIGHT NOW vs. what walk-ups saw a hand ago — but de-emphasized.
          const latestTrend = closed
            ? na
            : `<b>${m.surprise}</b> · period ${m.period}, length ${m.length}`;
          const headcountCell = closed ? na : m.headcount;
          const historyCell   = closed
            ? na
            : `<span style="font-family:monospace;letter-spacing:1px">${m.history || '–'}</span>`;

          // Mini Big Road for the hovered table — last 12 columns × 6 rows
          // of the shoe AS A WALK-UP PATRON WOULD HAVE SEEN IT, i.e. the
          // prior-12 string captured by transformWalkerHands BEFORE the
          // current hand's result was appended. Reading the field
          // directly (vs. slicing m.shoeHistory here) dodges the
          // tie-on-last-hand edge case where slice(0,-1) would chop one
          // B/P too many. The full-shoe view (current hand included)
          // lives on the TrendBoard simulator (BaccaratBoard.jsx) which
          // reads `data.shoeHistory` directly.
          const bigRoad = closed
            ? ''
            : `<div style="margin-top:10px;padding-top:8px;border-top:1px solid rgba(255,255,255,0.15)">
                 <div style="font-size:15px;color:rgba(255,255,255,0.55);letter-spacing:1px;margin-bottom:2px">BIG ROAD · 大路 <span style="opacity:0.55;font-size:13px">(visible to walk-ups · prior 12)</span></div>
                 ${bigRoadSvg(m.priorHistory12 || '', 14, 12, 6)}
               </div>`;

          // Row order is deliberate: Min → Visible Trend → Headcount sit
          // next to each other so the "patron saw X → headcount became Y"
          // link is the dominant reading. Latest Trend + History are
          // secondary, below the fold visually.
          return `
            <div style="min-width:220px">
              <div style="display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid rgba(255,255,255,0.15);padding-bottom:8px;margin-bottom:10px">
                <span style="font-weight:700;color:#7adfff;font-size:26px">${m.label} · Pit ${m.pit}</span>
                ${heatBadge}
              </div>
              <div style="display:grid;grid-template-columns:auto 1fr;gap:6px 14px;font-size:21px">
                <span style="color:rgba(255,255,255,0.55)">Min</span><span>${m.min == null ? '<span style=\"color:rgba(255,255,255,0.45);font-style:italic\">—</span>' : '$' + m.min.toLocaleString()}</span>
                <span style="color:rgba(255,255,255,0.55)">Visible Trend (12)</span><span>${visibleTrend}</span>
                <span style="color:rgba(255,255,255,0.55)">Headcount</span><span>${headcountCell}</span>
                <span style="color:rgba(255,255,255,0.55)">Latest Trend</span><span>${latestTrend}</span>
                <span style="color:rgba(255,255,255,0.55)">History</span><span>${historyCell}</span>
              </div>
              ${bigRoad}
            </div>
          `;
        },
      },
      xAxis: { type: 'value', show: false, min: X_RANGE[0], max: X_RANGE[1] },
      yAxis: {
        type: 'value',
        show: false,
        min: Y_RANGE[0],
        max: Y_RANGE[1],
        inverse: true,
      },
      // Only ONE visualMap now — the continuous Trend Heat swatch for
      // the contour series. The headcount legend is rendered as a
      // static JSX overlay (HeadcountLegend) instead of via visualMap,
      // because ECharts 6 visualMap overrides per-item itemStyle.color
      // and silently falls back to its default series color (red) when
      // it can't resolve the bound dimension on rich object-form data.
      // Driving fill directly from itemStyle.color is rock-solid; the
      // separate JSX legend keeps the visual key.
      visualMap: [
        {
          type: 'continuous',
          seriesIndex: 1,
          min: 0,
          max: 9,
          inRange: { color: TREND_PALETTE },
          calculable: false,
          orient: 'horizontal',
          left: 16,
          bottom: 16,
          // ECharts visualMap reverses itemWidth/itemHeight when
          // orient='horizontal' — `itemHeight` becomes the visible WIDTH
          // (long axis) and `itemWidth` becomes the visible THICKNESS.
          // Counterintuitive API, but documented in the source.
          //
          // Desired shape: ~300 px wide, ~12 px tall → swap accordingly.
          itemWidth: 12,    // visible thickness (vertical)
          itemHeight: 300,  // visible length    (horizontal)
          textGap: 12,
          textStyle: { color: '#dff5ff', fontSize: 21 },
          text: ['Hot', 'Cold'],
        },
      ],
      series: [
        {
          name: 'Tables',
          type: 'scatter',
          data: scatterData,
          // Explicit dimension declaration — without this, ECharts only
          // exposes [x, y] (the first two value array slots) to the
          // visualMap, and `dimension: 4` (headcount) can't be resolved.
          // The fallback when visualMap can't read its target dimension
          // is to paint every point in the series' default color, which
          // happens to be red — exactly the "all dots red" symptom.
          dimensions: ['x', 'y', 'surprise', 'broken', 'headcount', 'tableId'],
          encode: { x: 0, y: 1, tooltip: [5, 4, 2] },
          // `symbol`, `symbolSize`, and `symbolRotate` are supplied per
          // data item from gametype_svg_path + each table's rotation, so
          // the trend floor renders the same shapes as the Performance
          // Heatmap. No series-level defaults needed.
          z: 10,
          emphasis: {
            scale: 1.2,
            itemStyle: { borderColor: '#fff', borderWidth: 2 },
          },
        },
        // Floor heat overlay — exactly one of three modes:
        //   'contour' : d3 density blob weighted by trend strength
        //   'ripple'  : static circles around tables ≥ rippleThreshold
        //   'off'     : inert placeholder (kept so the series index stays
        //               stable across setOption merges)
        densityMode === 'contour'
          ? {
              type: 'custom',
              z: 5,
              silent: true,
              renderItem: (params, api) => {
                const points = frame.perTable
                  .filter((p) => !p.closed && p.surprise > 0)
                  .map((p) => ({
                    coord: api.coord([p.x, p.y]),
                    weight: p.surprise,
                  }));
                if (points.length === 0) return null;

                const contours = d3
                  .contourDensity()
                  .x((d) => d.coord[0])
                  .y((d) => d.coord[1])
                  .weight((d) => d.weight)
                  .size([params.coordSys.width, params.coordSys.height])
                  .bandwidth(60)
                  .thresholds(10)(points);

                const paths = contours.map(d3.geoPath());
                const ringMax = Math.max(1, paths.length - 1);

                return {
                  type: 'group',
                  children: paths.map((path, i) => ({
                    type: 'path',
                    shape: { pathData: path },
                    style: {
                      fill: trendColorScale(i / ringMax),
                      stroke: 'rgba(0,0,0,0.18)',
                      lineWidth: 0.4,
                      opacity: 0.18 + 0.04 * i,
                    },
                  })),
                };
              },
              data: [0],
            }
          : densityMode === 'ripple'
          ? {
              // Static "ripple" rings — one filled+stroked circle per
              // table whose surprise ≥ rippleThreshold. We use a custom
              // series with a literal `type: 'circle'` shape per hit, so
              // there is NO animation (unlike echarts' effectScatter
              // rippleEffect, which always pulses).
              type: 'custom',
              z: 5,
              silent: true,
              renderItem: (params, api) => {
                const hits = frame.perTable.filter(
                  (p) => !p.closed && p.surprise >= rippleThreshold
                );
                if (hits.length === 0) return null;
                return {
                  type: 'group',
                  children: hits.map((p) => {
                    const [cx, cy] = api.coord([p.x, p.y]);
                    const t = Math.min(1, Math.max(0, p.surprise / 9));
                    const color = trendColorScale(t);
                    return {
                      type: 'circle',
                      shape: { cx, cy, r: rippleSize },
                      style: {
                        fill: color,
                        fillOpacity: 0.18,
                        stroke: color,
                        lineWidth: 2,
                        opacity: 0.85,
                      },
                    };
                  }),
                };
              },
              data: [0],
            }
          : { type: 'custom', z: 5, silent: true, renderItem: () => null, data: [] },
      ],
    };

    // Always notMerge:true — we rebuild the full option each tick, and the
    // contour series toggles between two distinct shapes (active /
    // placeholder) which would confuse a merge.
    chartInstance.setOption(option, true);
  }, [chartInstance, frame, tables, selectedTableId, densityMode, rippleThreshold, rippleSize]);

  // Same approach the Performance Heatmap's ScatterHeatmapAvg uses — the
  // ECharts canvas owns the entire area, background image goes inside the
  // chart via `option.graphic` (see above). Chart div is absolute-inset
  // so it doesn't depend on the percentage-height chain resolving at
  // mount time (the grandparent uses flex:1, not an explicit pixel
  // height). The ResizeObserver above keeps the chart in sync with any
  // parent-size changes that happen after init.
  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <div ref={ref} style={{ position: 'absolute', inset: 0 }} />
      <HeadcountLegend />
    </div>
  );
}

// Static legend overlay for the Headcount palette. Sits at the bottom-
// left, above the Trend Heat swatch. Pure JSX so it doesn't go through
// ECharts visualMap (which in v6 stomps per-item itemStyle.color).
function HeadcountLegend() {
  const pieces = [
    { color: '#1f2733', label: 'Closed' },
    { color: '#3a4a5c', label: '0' },
    { color: '#4d7c8c', label: '1' },
    { color: '#3da5b8', label: '2' },
    { color: '#5ac8a8', label: '3' },
    { color: '#a4d65e', label: '4' },
    { color: '#f7b500', label: '5' },
    { color: '#ff6b1a', label: '6' },
    { color: '#ff2d2d', label: '7+' },
  ];
  return (
    <div
      style={{
        position: 'absolute',
        left: 16,
        bottom: 80,
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        pointerEvents: 'none',
        color: '#dff5ff',
        fontSize: 21,
        textShadow: '0 1px 2px rgba(0,0,0,0.7)',
      }}
    >
      <span style={{ fontWeight: 600, marginRight: 4 }}>Headcount</span>
      {pieces.map((p) => (
        <div
          key={p.label}
          style={{ display: 'flex', alignItems: 'center', gap: 6 }}
        >
          <div
            style={{
              width: 24,
              height: 24,
              background: p.color,
              borderRadius: 4,
              border: '1px solid rgba(255,255,255,0.2)',
            }}
          />
          <span>{p.label}</span>
        </div>
      ))}
    </div>
  );
}
