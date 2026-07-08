// Pricing module — default table-minimum tiers
// ============================================
//
// The pricing dashboard's analogue of the scheduling module's "shifts":
// instead of arming a SHIFT and painting it onto tables, the operator
// arms a TABLE-MINIMUM tier and paints it. Each tier is a $ minimum bet.
//
// Tier colors come from the SAME source as the Performance Heatmap's
// "Table minimum" KPI (tableMinimumColor → threshold_dict['Table minimum']),
// so a $500 table reads the same color across both dashboards.
//
// Tiers are user-editable (Tier Library) and persist in localStorage via
// pricingStorage; this list is just the seed for a fresh install.

import { tableMinimumColor, tableMinimumLadder } from '../../shared/constants/heatmapConstants';

export const UNPRICED_COLOR = 'rgba(120, 130, 145, 0.45)';

// Re-export so other pricing modules can color any $ minimum the same way.
export { tableMinimumColor };

// The available minimums = the Performance "Table minimum" KPI ladder, with
// each band's label as the $ minimum and its color. So the dashboards share
// the exact same minimum buckets + colors.
export const DEFAULT_TIERS = tableMinimumLadder().map((b) => ({
    id: 'm' + b.min,
    label: '$' + Number(b.min).toLocaleString(),
    min: b.min,
    color: b.color,
}));

// Default Min–Max boundary combinations — quick presets the operator can
// one-click in the price popup instead of dialing Min/Max by hand. Stored
// as raw $ amounts (snapped to the nearest tier at apply time), so they
// stay valid even when the tier list is edited. User-editable in Settings.
export const DEFAULT_BOUNDARY_PRESETS = [
    { id: 'bp_tight',  label: 'Tight',  min: 300,  max: 500  },
    { id: 'bp_std',    label: 'Standard', min: 500, max: 1000 },
    { id: 'bp_wide',   label: 'Wide',   min: 300,  max: 2000 },
    { id: 'bp_premium', label: 'Premium', min: 1000, max: 5000 },
];

// Format a $ minimum for display ("$1,000").
export function formatMinimum(min) {
    if (min == null || !Number.isFinite(min)) return '—';
    return '$' + Number(min).toLocaleString();
}
