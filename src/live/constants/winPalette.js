// Casino-perspective diverging color scale for cumulative table win.
// =====================================================================
// Positive = casino WON that much from patrons (green = healthy).
// Negative = casino LOST that much (red = patron winning big).
//
// The ECharts piecewise visualMap consumes `BREAKPOINTS` directly — each
// step is applied via >= min, <= max. The neutral zone (|win| < NEUTRAL)
// falls into a slate-gray so a table with near-zero action doesn't scream.

// Colors chosen so the scale reads cleanly under the dark dashboard shell
// and stays distinct from Pricing's cyan/amber tokens.
export const WIN_COLORS = {
    // Casino losing (patron winning) — cooler side of red-orange.
    lossExtreme:  '#c81f45',   // ≤ −$500K
    lossHeavy:    '#e04a5c',
    lossMedium:   '#e88090',
    lossLight:    '#f2b0b6',
    // Neutral.
    neutral:      '#6b7a86',   // |win| < NEUTRAL_LO
    // Casino winning — muted greens climbing to a strong emerald.
    winLight:     '#a9d69a',
    winMedium:    '#7dc267',
    winHeavy:     '#4fa03a',
    winExtreme:   '#2f7a24',   // ≥ +$500K
};

// Breakpoints (in HKD-ish absolute values). Tune per venue.
export const NEUTRAL_LO = 5_000;    // treat |win| < 5K as flat
export const BREAKPOINTS = [
    { min: -Infinity,      max: -500_000,    color: WIN_COLORS.lossExtreme,  label: '≤ −500K'  },
    { min: -500_000,       max: -100_000,    color: WIN_COLORS.lossHeavy,    label: '−500K … −100K' },
    { min: -100_000,       max: -25_000,     color: WIN_COLORS.lossMedium,   label: '−100K … −25K'  },
    { min: -25_000,        max: -NEUTRAL_LO, color: WIN_COLORS.lossLight,    label: '−25K … −5K'    },
    { min: -NEUTRAL_LO,    max:  NEUTRAL_LO, color: WIN_COLORS.neutral,      label: '≈ flat'        },
    { min:  NEUTRAL_LO,    max:  25_000,     color: WIN_COLORS.winLight,     label: '5K … 25K'      },
    { min:  25_000,        max:  100_000,    color: WIN_COLORS.winMedium,    label: '25K … 100K'    },
    { min:  100_000,       max:  500_000,    color: WIN_COLORS.winHeavy,     label: '100K … 500K'   },
    { min:  500_000,       max:  Infinity,   color: WIN_COLORS.winExtreme,   label: '≥ 500K'        },
];

// Pick a color for a raw cumWin value using the breakpoints above.
export function colorForWin(v) {
    if (v == null || Number.isNaN(v)) return '#3a4753';  // no data → dim
    for (const b of BREAKPOINTS) {
        if (v > b.min && v <= b.max) return b.color;
    }
    return WIN_COLORS.neutral;
}

// Card-tier palette — mirrors casino ladder. Two variants:
//   • Filled  — the original loud badges (kept for the toolbar chip and
//               anywhere the tier NEEDS to shout).
//   • Subtle  — muted background + colored dot + slim text. Used in dense
//               tables (Top-X, Watchlist) so rows scan as data, not
//               decoration. Reduces visual noise per
//               ui-ux-pro-max: `weight-hierarchy`, `whitespace-balance`.
export const CARD_TIERS = {
    BLACK:    { label: 'BLACK CARD', color: '#0a0a0a', text: '#ffd479', border: '#ffd479', accent: '#ffd479' },
    DIAMOND:  { label: 'DIAMOND',    color: '#4a3c7d', text: '#e0e0ff', border: '#8a7ae0', accent: '#8a7ae0' },
    PLATINUM: { label: 'PLATINUM',   color: '#3a4a58', text: '#dff5ff', border: '#7adfff', accent: '#7adfff' },
    GOLD:     { label: 'GOLD',       color: '#544220', text: '#ffe0a0', border: '#ffd479', accent: '#ffd479' },
    SILVER:   { label: 'SILVER',     color: '#3a3f47', text: '#d0d5db', border: '#8a95a1', accent: '#a0a5ab' },
    BASE:     { label: 'BASE',       color: '#2a2f37', text: '#a0a5ab', border: '#4a5057', accent: '#6a7078' },
};

// Compact currency formatter for the dashboard chrome. Uses casino
// convention: no cents, negative in parentheses is OPTIONAL — the color
// carries the sign, so we render "-$12,340" plainly.
export function fmtCurrency(v) {
    if (v == null || Number.isNaN(v)) return '—';
    const n = Math.round(v);
    const sign = n < 0 ? '−' : '';
    const abs = Math.abs(n);
    if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(2)}M`;
    if (abs >= 10_000)    return `${sign}$${(abs / 1_000).toFixed(0)}K`;
    if (abs >= 1_000)     return `${sign}$${(abs / 1_000).toFixed(1)}K`;
    return `${sign}$${abs.toLocaleString()}`;
}

// A high-precision currency for the deep-panel hand-by-hand rows where
// every dollar matters.
export function fmtCurrencyExact(v) {
    if (v == null || Number.isNaN(v)) return '—';
    const n = Math.round(v);
    const sign = n < 0 ? '−' : n > 0 ? '+' : '';
    return `${sign}$${Math.abs(n).toLocaleString()}`;
}
