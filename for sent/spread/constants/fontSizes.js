// Scheduling dashboard — central font-size config
// ================================================
//
// One place to tune every MAJOR font size in the scheduling dashboard.
// Each surface reads from here instead of hard-coding a number, so a
// size change is a single edit. Values are either px numbers (for sx
// fontSize) or rem strings — both are valid MUI fontSize inputs.
//
// Grouped by surface so it's obvious what each knob affects.

export const SPREAD_FONTS = {
    // Shift Summary table (SpreadComparePanel)
    summary: {
        header:     '1.05rem', // column headers
        body:       '1.15rem', // data cells
        total:      '1.15rem', // total row
        shiftLabel: '1.15rem', // the shift time-window label cell
        cardTitle:  '1.2rem',  // "Shift Summary" panel title
    },

    // Available Shifts palette (ShiftPalette)
    palette: {
        title:      16, // "Available Shifts"
        hint:       12, // the armed/click hint
        groupLabel: 13, // "24-HOUR" / "16-HOUR" / "8-HOUR"
        groupCount: 12,
        shiftLabel: 16, // each swatch's time window
        count:      14, // assignment count chip
        eraser:     14, // "Unassign / Close"
    },

    // On-map plan info card (SpreadDashboard)
    card: {
        label:       12, // "PLANNING DATE"
        date:        26, // the date line
        metric:      28, // 624h / 33
        metricLabel: 13, // "Total hours" / "Open tables"
        note:        11, // fallback / flag notices
    },

    // Floor map overlays (FloorScheduleMap + SpreadDashboard)
    map: {
        pill:        13, // Pointer / Rectangle / Polygon
        colorToggle: 14, // "Table colored by" + options
        tooltip:     16, // hover tooltip body
    },

    // Right-column tabs (Available Shifts / Summary / Shift Library)
    tabs: 16,

    // Shift Library editor rows
    library: {
        title:     18, // "Shift Library"
        shiftLabel:17, // the time-window label
        lengthSel: 16, // 24h / 16h / 8h selector
        startInput:17, // start-hour input
        rangeText: 14,
    },

    // Coverage bar chart (CoverageReport)
    coverage: {
        title:      16,
        summary:    13,
        hourTick:   11,
    },
};
