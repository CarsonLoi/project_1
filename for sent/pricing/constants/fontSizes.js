// Pricing dashboard — central font-size config
// ============================================
//
// ONE place to tune every TEXT font size in the pricing dashboard (the
// same pattern as src/spread/constants/fontSizes.js and the performance
// PERF_FONTS). Each surface reads its sizes from the group below instead
// of hard-coding a number, so a size change is a single edit here.
//
// Values are px numbers (MUI `sx.fontSize`, or ECharts `fontSize`).
// `rowGapY` is a MUI spacing unit (× 8px). Icon sizes are NOT font sizes
// and are intentionally left out of this file.

export const PRICING_FONTS = {
    // Top toolbar (title, labels, toggles, buttons, selects, slicer)
    toolbar: {
        title:    23,    // "Table Pricing"
        label:    14,    // eyebrow labels (DATE / PERIOD / GAME)
        control:  15,    // segmented-toggle option text
        sub:      12,    // period clock sub-line inside the period toggle
        button:   15,    // ghost buttons (Copy to… / Apply to dates…)
        date:     15.5,  // date input text
        version:  14.5,  // version dropdown (trigger + menu items)
        save:     15,    // Save version button
        slicer:   15,    // Game slicer trigger
        menuItem: 14.5,  // dropdown menu items (slicer / copy-to menu)
    },

    // Right-column tabs (Minimums / Summary / Settings)
    tabs: { label: 16.5 },

    // Price Mix panel (Minimums tab)
    priceMix: { title: 18, rowLabel: 16.5, count: 15.5 },

    // Apply-to-dates transfer dialog
    transfer: { title: 17, subtitle: 13, paneTitle: 13, paneCount: 12.5, row: 14, none: 13 },

    // Summary tab (PricingSummary)
    summary: {
        title:       22,   // "Summary" panel title
        groupToggle: 15,   // dropdown selectors (display / basis / sub-seg)
        header:      15,   // column headers (MINIMUM / segment / All)
        tierLabel:   19,   // tier name + $ minimum in each row
        cell:        19,   // per-segment count cells
        total:       20,   // total / weighted-avg row figures
        rowGapY:     0.95, // vertical padding per row (line spacing) — tight enough to avoid a scrollbar
    },

    // Settings-tab editor panels (TierLibrary / BoundaryLibrary / DaypartLibrary)
    library: {
        heading:  19,   // panel title
        addBtn:   15,   // "Add …" button
        rowLabel: 16,   // editable label / value inputs
        rowMeta:  15,   // inline helper words ("min $", "from", "to", "max $")
        hint:     14,   // helper / empty-state text
        small:    12,   // confirm/cancel buttons + coverage hint
    },

    // Floor map (PricingFloorMap) — ECharts HTML tooltip + overlay chrome
    floorMap: {
        tooltipTitle: 20,   // table id · pit
        tooltipRow:   16,   // tooltip key/value rows
        hint:         13,   // tooltip footer hint
        legend:       11.5, // open/fixed legends
        modePill:     13,   // Pointer / Rectangle / Polygon pills
        empty:        18,   // "No tables…" placeholder
        visualMap:    14,   // table-minimum visualMap legend labels
        dateOverlay:  15,   // the date picker overlaid on the scatter
    },

    // Hourly charts (PricingHourlyCharts)
    charts: {
        header:     18,   // "Hourly Minimum Mix · …"
        badge:      13,   // schedule badge / "all priced tables"
        chartTitle: 18,   // per-chart title
        axis:       14,   // x/y axis labels
        legend:     15,   // tier legend
        segLabel:   15,   // value label inside each bar segment
        total:      16,   // total-tables label above the counts bars
        empty:      15,   // empty-state note
    },

    // Floating selection bar (TierSelectionBar)
    selectionBar: {
        count:        17,   // "N tables selected"
        chip:         12,   // current-breakdown chips
        demandLabel:  11,   // "DEMAND · 4wk" eyebrow
        demand:       13,   // demand stats text
        history:      12,   // "Last saved …" line
        panelBadge:   11,   // the ①/② step badges
        panelTitle:   12,   // panel titles (OPENING BASE / ADJUSTABLE BOUNDARY)
        baseValue:    16,   // the chosen base value
        fixed:        12,   // fixed-price toggle text
        tierChip:     13.5, // base tier chips
        noteCenter:   13,   // "fixed / range off" note
        boundaryVal:  14,   // boundary value readout
        rangeLabel:   12,   // Min / Max labels
        select:       13,   // Min/Max select + its menu items
        preset:       12,   // boundary preset chips
        histTitle:    11,   // history panel title
        histLabel:    12,   // history field labels
        histDow:      11,   // day-of-week chips
        histClear:    11,   // history "all" clear button
        histApply:    13,   // history Apply button
        apply:        14,   // Apply button
        action:       13,   // Suggest / From history / Clear buttons
        dateField:    12.5, // history date inputs
    },

    // Tier palette (TierPalette)
    palette: { title: 16, hint: 12, tierLabel: 16, count: 13, eraser: 14, badge: 11 },

    // Compare view (PricingComparison)
    compare: {
        metric: 18,  // big metric-tile value
        head:   14,   // table title / select trigger
        body:   13,   // menu items, deltas, period toggle, hints, table cells
        label:  12,   // panel labels, legend, table headers
        small:  11,   // tile captions / "base A"
        empty:  15,   // empty-state note
        subSeg:     13,   // SUB-SEG control label
        panelLabel: 14,   // floor panel "Date A/B" label
        panelMeta:  12,   // floor panel "N open · priced"
        trendTitle: 15,   // hourly-trend chart title
        trendLegend: 12,  // trend legend + tooltip
        trendAxis:  11,   // trend x/y axis labels
    },

    // Timeline scrubber (TimelineControl)
    timeline: { hour: 18, tick: 13 },
};

// Convenience named export for the Settings editor panels.
export const LIB_FONTS = PRICING_FONTS.library;

// Shared input style for the Settings / Boundary editors — a clean filled
// box with NO underline (kills the standard-variant before/after rules),
// using the shared library font scale. Pass width + text alignment.
export const libInputSx = ({ width, align = 'left' } = {}) => ({
    width,
    // Belt-and-suspenders: remove the standard-variant underline entirely.
    '& .MuiInput-root:before': { borderBottom: 'none' },
    '& .MuiInput-root:after': { borderBottom: 'none' },
    '& .MuiInput-root:hover:not(.Mui-disabled):before': { borderBottom: 'none' },
    '& input': {
        color: '#fff', fontSize: LIB_FONTS.rowLabel, fontWeight: 700, textAlign: align,
        bgcolor: 'rgba(255,255,255,0.06)', borderRadius: 1, px: 1, py: 0.5,
    },
    '& input[type=number]': { MozAppearance: 'textfield' },
    '& input[type=number]::-webkit-outer-spin-button': { WebkitAppearance: 'none', margin: 0 },
    '& input[type=number]::-webkit-inner-spin-button': { WebkitAppearance: 'none', margin: 0 },
});
