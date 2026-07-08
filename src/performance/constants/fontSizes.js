// Performance dashboard — central font-size config
// =================================================
//
// One place to tune every MAJOR font size in the performance dashboard,
// mirroring src/spread/constants/fontSizes.js for the scheduling side.
// Each surface reads from here instead of hard-coding a number, so a
// size change is a single edit. Values are either px numbers (ECharts
// textStyle / MUI sx fontSize) or rem strings (MUI sx fontSize) — both
// are valid in their respective contexts.
//
// Grouped by surface so it's obvious what each knob affects.

export const PERF_FONTS = {
    // Scatter heatmap (ScatterHeatmapPlay / ScatterHeatmapAvg)
    scatter: {
        title:     18, // the "Date · DoW · Hour · KPI" header (Avg uses its own)
        titleAvg:  20, // the averaged-view title
        axisLabel: 13, // x/y axis tick labels
        tooltip:   16, // hover tooltip body
        visualMap: 15, // color legend labels
        timeline:  13, // play-timeline label
    },

    // Trend / Ranking charts (TrendCharts)
    trend: {
        tooltip:   18, // hover tooltip body
        axisLabel: 16, // trend line chart x/y tick labels
        rankAxis:  18, // ranking bar chart axis labels
        rankLabel: 18, // ranking bar value labels
    },

    // Legend & Percentile side tables (PerformanceLegend, PerformancePercentile)
    legend: {
        title:  '1.2rem',  // panel title
        header: '1.05rem', // column headers
        body:   '1.1rem',  // data cells
    },

    // 24-hr "Spread by Area" + "Actual vs Spread" tables (PerformanceDashboard)
    byArea: {
        title:  '1.1rem',  // panel title
        header: '1rem',    // column headers
        body:   '1.1rem',  // data cells
        chip:   '0.85rem', // delta chips
        sub:    '0.9rem',  // "@ hr" / unit subtext
    },

    // Top toolbar buttons (Exclude dates / Refresh)
    toolbar: 18,

    // Shared panel / card titles
    panelTitle: '1.2rem',
};
