// Design tokens for the Performance Insights panel.
// Source aesthetic: the polished admin-dashboard reference — very dark
// near-black ground, deeper card surfaces with NO border (depth comes
// from contrast, not strokes), card titles right-aligned at the top,
// kebab affordance area on the top-left, restrained cyan accent, and
// a clean multi-color chart palette.

export const INSIGHTS_TOKENS = {
  // Three calm layers from page → panel → card. The card is darker
  // than the panel so it reads as "inset" rather than "raised".
  bgDeepest:    '#0d1117',        // page ground
  bgPanel:      '#161b22',        // outermost Paper
  bgCard:       '#0f1419',        // card surface (deeper than panel)
  bgCardHover:  '#14191f',
  bgTableHead:  '#1a2129',

  // Cyan primary. Holds the line between "branded" and "neutral" — it
  // shows up on active pills, KPI badges, and primary chart series.
  accentPrimary:      '#00d4ff',
  accentPrimaryDim:   'rgba(0, 212, 255, 0.16)',
  accentPrimaryHover: '#22dcff',

  // Multi-series palette inspired by the reference dashboard. Each
  // color is saturated but not garish.
  chartCyan:    '#00d4ff',
  chartGreen:   '#10b981',
  chartYellow:  '#f59e0b',
  chartRed:     '#ef4444',
  chartPurple:  '#8b5cf6',
  chartPink:    '#ec4899',
  chartBlue:    '#3b82f6',
  chartOrange:  '#f97316',

  // Convenience array — used by chart series when iterating.
  series: ['#00d4ff', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#3b82f6'],

  // Text scale.
  textPrimary:   'rgba(255, 255, 255, 0.95)',
  textSecondary: 'rgba(255, 255, 255, 0.62)',
  textTertiary:  'rgba(255, 255, 255, 0.42)',
  textMuted:     'rgba(255, 255, 255, 0.24)',

  // No card borders in this aesthetic — depth comes from layered fills.
  borderHair:    'none',
  // Used for table row separators and dividers only.
  divider:       '1px solid rgba(255, 255, 255, 0.05)',

  // Subtle elevation shadow.
  shadowCard:      '0 4px 12px rgba(0, 0, 0, 0.25)',
  shadowCardHover: '0 6px 20px rgba(0, 0, 0, 0.35)',
};

// Standard card surface. No border — depth via color contrast alone.
export const flatCard = {
  bgcolor: INSIGHTS_TOKENS.bgCard,
  borderRadius: 1.5,
  boxShadow: INSIGHTS_TOKENS.shadowCard,
};

// Card-header row: title on the LEFT (no kebab). Title sits on a
// small cyan accent bar for visual anchoring — matches the controls-
// bar section labels for a unified hierarchy across the panel.
export const cardHeader = {
  display: 'flex',
  alignItems: 'center',
  gap: 1,
  mb: 1.5,
};

// Compact slim select / dropdown.
export const slimControl = {
  height: 36,
  bgcolor: INSIGHTS_TOKENS.bgCardHover,
  border: '1px solid rgba(255, 255, 255, 0.06)',
  borderRadius: 1,
  fontSize: '0.95rem',
  color: INSIGHTS_TOKENS.textPrimary,
  transition: 'border-color 160ms ease',
  '&:hover': { borderColor: 'rgba(255, 255, 255, 0.18)' },
  '& .MuiOutlinedInput-notchedOutline': { border: 'none' },
};

// Pill toggle group — refined, less harsh than the previous solid-cyan
// active state. Inspired by the segmented-tab reference (image 3):
// active state is a subtle dark surface with white text + a thin cyan
// underline accent; inactive is transparent with muted text. Reads as
// clean tab control rather than a candy pill.
export const pillToggleGroup = {
  bgcolor: 'rgba(255, 255, 255, 0.02)',
  borderRadius: 1.2,
  border: '1px solid rgba(255, 255, 255, 0.06)',
  p: 0.4,
  gap: 0.3,
  '& .MuiToggleButton-root': {
    color: INSIGHTS_TOKENS.textTertiary,
    bgcolor: 'transparent',
    border: 'none',
    borderRadius: 0.9,
    fontSize: '1.22rem',
    fontWeight: 500,
    letterSpacing: 0.2,
    textTransform: 'none',
    minHeight: 44,
    px: 2.2,
    py: 0.6,
    position: 'relative',
    transition: 'all 180ms ease',
    '&:hover': {
      color: INSIGHTS_TOKENS.textPrimary,
      bgcolor: 'rgba(255, 255, 255, 0.04)',
    },
    '&.Mui-selected': {
      color: '#ffffff',
      // Subtle slightly-darker surface (rather than loud cyan fill).
      bgcolor: 'rgba(0, 0, 0, 0.45)',
      fontWeight: 600,
      boxShadow: 'inset 0 0 0 1px rgba(255, 255, 255, 0.06)',
      // Tiny cyan underline accent — a quieter way to mark the
      // active tab than flooding the whole button with color.
      '&::after': {
        content: '""',
        position: 'absolute',
        left: '24%',
        right: '24%',
        bottom: 4,
        height: 2,
        borderRadius: 1,
        bgcolor: INSIGHTS_TOKENS.accentPrimary,
      },
      '&:hover': {
        bgcolor: 'rgba(0, 0, 0, 0.55)',
      },
    },
  },
};

// Smaller inset toggle — used inline next to dropdowns (DESC/ASC).
export const compactToggleGroup = {
  bgcolor: INSIGHTS_TOKENS.bgCardHover,
  borderRadius: 1,
  border: '1px solid rgba(255, 255, 255, 0.06)',
  p: 0.3,
  gap: 0.3,
  '& .MuiToggleButton-root': {
    color: INSIGHTS_TOKENS.textTertiary,
    border: 'none',
    borderRadius: 0.8,
    fontSize: '0.78rem',
    fontWeight: 600,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    px: 1.4,
    py: 0.3,
    minHeight: 28,
    '&:hover': {
      color: INSIGHTS_TOKENS.textPrimary,
      bgcolor: 'rgba(255, 255, 255, 0.04)',
    },
    '&.Mui-selected': {
      color: '#0d1117',
      bgcolor: INSIGHTS_TOKENS.accentPrimary,
      '&:hover': { bgcolor: INSIGHTS_TOKENS.accentPrimaryHover },
    },
  },
};

// Section title — placed at the top-LEFT of card headers. Same
// tracked-uppercase style as the controls-bar section labels, so the
// hierarchy across the whole panel reads consistently.
export const cardTitleSx = {
  color: INSIGHTS_TOKENS.textPrimary,
  fontWeight: 700,
  fontSize: '0.95rem',
  letterSpacing: 1.6,
  textTransform: 'uppercase',
  lineHeight: 1,
};

// Small cyan accent bar shown before card titles (mirrors the
// controls-bar `ControlSegment` label pattern). Use inside
// `cardHeader` to anchor the title visually.
export const cardTitleAccentSx = {
  width: 3,
  height: 13,
  bgcolor: INSIGHTS_TOKENS.accentPrimary,
  borderRadius: 1,
  flexShrink: 0,
};

// Section title that lives inline (left-aligned).
export const sectionTitleSx = {
  color: INSIGHTS_TOKENS.textPrimary,
  fontWeight: 500,
  fontSize: '1rem',
  letterSpacing: 0.1,
  lineHeight: 1.2,
};

// Headline at the top of the whole panel.
export const headlineSx = {
  color: INSIGHTS_TOKENS.textPrimary,
  fontWeight: 600,
  letterSpacing: -0.2,
  fontSize: '1.5rem',
  lineHeight: 1.1,
};

// Tiny label — used on KPI tiles, table headers, and metric chips.
export const labelSx = {
  color: INSIGHTS_TOKENS.textTertiary,
  fontSize: 11,
  fontWeight: 500,
  letterSpacing: 1,
  textTransform: 'uppercase',
  lineHeight: 1.2,
};

// Hero number — bold/heavy, large. Pair with subtitle below.
export const heroNumberSx = {
  color: INSIGHTS_TOKENS.textPrimary,
  fontWeight: 700,
  fontSize: '2rem',
  lineHeight: 1,
  letterSpacing: -0.5,
  fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif',
};

// Kebab-style decorative dots in the card-header left slot. Purely
// visual at the moment — slot is here for future "more options" menus.
export const kebabDotsSx = {
  display: 'flex',
  flexDirection: 'column',
  gap: 0.4,
  cursor: 'default',
  color: INSIGHTS_TOKENS.textMuted,
  '& > span': {
    width: 3,
    height: 3,
    borderRadius: '50%',
    bgcolor: 'currentColor',
  },
};
