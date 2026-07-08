// Pricing floor layout — tunable geometry for the scatter heatmap + the
// floor/summary width split. EDIT these to reshape the pricing dashboard.
// ======================================================================
//
// Two independent sets:
//   • PLANNING mode  — the big single floor + summary column layout.
//   • COMPARISON mode — two side-by-side floors with their own date pickers.
// Each mode has its own scatter axis bounds and its own box aspect ratio.

// ── PLANNING mode ────────────────────────────────────────────────────
// Scatter coordinate bounds (the ECharts xAxis / yAxis min–max the floor
// map maps table positions into) for PLANNING.
export const PLAN_FLOOR_X_MIN = 0;
export const PLAN_FLOOR_X_MAX = 1100;
export const PLAN_FLOOR_Y_MIN = 0;
export const PLAN_FLOOR_Y_MAX = 1100;

// Box aspect ratio (width / height) of the scatter container in PLANNING.
// This is the main horizontal-stretch knob — larger = wider/flatter floor.
//   • current look ≈ 1500 / 723 (≈ 2.075)
export const PLAN_FLOOR_ASPECT_W = 1500;
export const PLAN_FLOOR_ASPECT_H = 723;
export const PLAN_FLOOR_ASPECT = `${PLAN_FLOOR_ASPECT_W} / ${PLAN_FLOOR_ASPECT_H}`;

// ── COMPARISON mode ──────────────────────────────────────────────────
// Bounds for the two smaller side-by-side maps. Tune independently — a
// tighter Y range crops the floor vertically, matching the narrower box.
export const CMP_FLOOR_X_MIN = 0;
export const CMP_FLOOR_X_MAX = 1100;
export const CMP_FLOOR_Y_MIN = 0;
export const CMP_FLOOR_Y_MAX = 1100;

// Aspect ratio for each of the two comparison maps.
export const CMP_FLOOR_ASPECT_W = 1500;
export const CMP_FLOOR_ASPECT_H = 723;
export const CMP_FLOOR_ASPECT = `${CMP_FLOOR_ASPECT_W} / ${CMP_FLOOR_ASPECT_H}`;

// ── Backwards-compat aliases (default to PLANNING values) ────────────
// Any code that still imports the un-prefixed names picks up the planning
// set — keeps DiffFloorMap and any legacy consumers working.
export const FLOOR_X_MIN = PLAN_FLOOR_X_MIN;
export const FLOOR_X_MAX = PLAN_FLOOR_X_MAX;
export const FLOOR_Y_MIN = PLAN_FLOOR_Y_MIN;
export const FLOOR_Y_MAX = PLAN_FLOOR_Y_MAX;
export const FLOOR_ASPECT_W = PLAN_FLOOR_ASPECT_W;
export const FLOOR_ASPECT_H = PLAN_FLOOR_ASPECT_H;
export const FLOOR_ASPECT = PLAN_FLOOR_ASPECT;

// Width split between the floor (left) and the Summary table (right) in the
// main grid — CSS grid fractions out of FLOOR_TOTAL_FR. The summary width is
// DERIVED from the floor width, so you only tune one knob: raise
// FLOOR_WIDTH_FR and the summary shrinks to match (and vice-versa).
export const FLOOR_TOTAL_FR = 10;
export const FLOOR_WIDTH_FR = 7.04;
export const SUMMARY_WIDTH_FR = FLOOR_TOTAL_FR - FLOOR_WIDTH_FR;

// In Comparison mode the floor column is narrower so a SECOND scatter map
// fits beside the first on the same row.
export const COMPARE_FLOOR_WIDTH_FR = 5;
