// Shared casino floor layout — reads from the same config_cod.json that the
// performance heatmap uses, so both pages render the same physical floor.

import config_data from '../../shared/data/config_cod.json';

// Match the performance heatmap chart's coord space (0..1100 × 0..1100,
// with Y inverted so the origin is top-left).
export const FLOOR_WIDTH = 1100;
export const FLOOR_HEIGHT = 1100;

// Default table-minimum per area (used as a fallback since the static
// config doesn't carry a min field). Tweak as needed.
const AREA_MIN = {
  MS: 100,
  PM: 200,
};

// Friendly label for each area.
const AREA_LABEL = {
  MS: 'MS · Mass',
  PM: 'PM · Premium',
  Other: 'Other',
};

// Cache per filter key. `null` (no date) → `is_Active === 1` fallback used by
// synthetic data; any YYYY-MM-DD → date-validity filter (rows whose
// [startdate, enddate] window covers that date).
const _floorCache = new Map();

/**
 * Build the table list for a given gaming date.
 *
 * @param {string|null} forDate  YYYY-MM-DD. When provided, only config
 *                               rows whose [startdate, enddate] covers
 *                               this date are included — same rule the
 *                               Performance Heatmap uses for its config
 *                               filter, so both pages stay in sync.
 *                               When omitted, falls back to is_Active=1
 *                               (used by the synthetic simulator).
 */
export function buildFloor(forDate = null) {
  const key = forDate || '__active__';
  if (_floorCache.has(key)) return _floorCache.get(key);

  // Always require active TG tables. When a date is provided, additionally
  // restrict to rows whose validity window covers that date.
  const matches = forDate
    ? (c) =>
        c.Group === 'TG' &&
        c.is_Active === 1 &&
        c.startdate <= forDate &&
        c.enddate >= forDate
    : (c) => c.Group === 'TG' && c.is_Active === 1;

  let nextId = 1;
  const tables = config_data.filter(matches).map((c) => {
    const area = c.Location || 'Other';
    return {
      // Numeric id for components that expect numbers; original table code preserved as `code`.
      id: nextId++,
      code: c.table,
      label: c.game + c.table,
      pit: String(c.pit),
      pitLabel: 'Pit ' + c.pit,
      area,
      areaLabel: AREA_LABEL[area] || area,
      game: c.game,
      zone: c.zone,
      rotation: c.rotation,
      x: c.x,
      y: c.y,
      min: AREA_MIN[area] || 100,
    };
  });

  _floorCache.set(key, tables);
  return tables;
}

// Pit-cluster outlines derived from table positions — used to draw the
// dashed pit boundaries on the floor background SVG. Optional date param
// matches buildFloor() so the outlines only reflect tables on-floor at
// that date.
export function buildPitOutlines(forDate = null) {
  const tables = buildFloor(forDate);
  const byArea = {};
  for (const t of tables) {
    const key = t.area;
    if (!byArea[key])
      byArea[key] = {
        id: key,
        label: t.areaLabel,
        tables: [],
      };
    byArea[key].tables.push(t);
  }
  return Object.values(byArea)
    .filter((a) => a.tables.length > 0)
    .map((a) => {
      const xs = a.tables.map((t) => t.x);
      const ys = a.tables.map((t) => t.y);
      const pad = 30;
      const x = Math.max(0, Math.min(...xs) - pad);
      const y = Math.max(0, Math.min(...ys) - pad);
      const w = Math.min(FLOOR_WIDTH, Math.max(...xs) + pad) - x;
      const h = Math.min(FLOOR_HEIGHT, Math.max(...ys) + pad) - y;
      return { id: a.id, label: a.label, x, y, w, h };
    });
}
