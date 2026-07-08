// Spread floor layout — tunable geometry for the scheduling scatter.
// =====================================================================
//
// Two independent sets so planning (the big single floor) and comparison
// (side-by-side variance floor) can be tuned separately. Mirror of the
// pattern in pricing/constants/floorLayout.js.
//
// Consumers pick a set via the `layoutMode` prop on FloorScheduleMap
// ('planning' | 'comparison'). ReferenceFloorMap inherits the planning
// set (it sits under the planning floor as a comparison overlay).

// ── PLANNING mode ────────────────────────────────────────────────────
// Big single floor + right column. Same coord range as the shared
// SCATTER_* constants historically used, so nothing changes by default.
export const PLAN_FLOOR_X_MIN = 0;
export const PLAN_FLOOR_X_MAX = 1100;
export const PLAN_FLOOR_Y_MIN = 0;
export const PLAN_FLOOR_Y_MAX = 1100;

// Container box aspect (width / height). Applied to the scatter box in
// SpreadDashboard.js — the current look ≈ 1500 / 723.
export const PLAN_FLOOR_ASPECT_W = 1500;
export const PLAN_FLOOR_ASPECT_H = 723;
export const PLAN_FLOOR_ASPECT = `${PLAN_FLOOR_ASPECT_W} / ${PLAN_FLOOR_ASPECT_H}`;

// Symbol-size multiplier for the planning floor.
export const PLAN_SYMBOL_SIZE = 2;

// ── COMPARISON mode ──────────────────────────────────────────────────
// Variance floor (PlanCompareView) — smaller box, tune independently.
export const CMP_FLOOR_X_MIN = 0;
export const CMP_FLOOR_X_MAX = 1100;
export const CMP_FLOOR_Y_MIN = 0;
export const CMP_FLOOR_Y_MAX = 1100;

export const CMP_FLOOR_ASPECT_W = 1500;
export const CMP_FLOOR_ASPECT_H = 723;
export const CMP_FLOOR_ASPECT = `${CMP_FLOOR_ASPECT_W} / ${CMP_FLOOR_ASPECT_H}`;

// Smaller default for the side-by-side compare (matches the pricing side).
export const CMP_SYMBOL_SIZE = 1.4;

// Slider range for the ⚙ Symbol size popover.
export const SYMBOL_SIZE_MIN = 0.5;
export const SYMBOL_SIZE_MAX = 4;
export const SYMBOL_SIZE_STEP = 0.1;
