// Surveillance console — design tokens.
// ======================================
// This file exists because a review found 66 distinct raw hex/rgba
// literals scattered across the realtime components, with no shared
// vocabulary — four different "this is bad" reds, none named as such.
//
// The organizing idea: this is a SURVEILLANCE TERMINAL, not a consumer
// dashboard. Two type voices, used consistently everywhere:
//   SYSTEM voice  — labels, captions, chrome: small, uppercase, muted.
//   READOUT voice — any number that could be evidence: bold, tabular,
//                   full contrast. A number is never quietly grey.
//
// Import from here instead of writing a new rgba(...) literal. If a
// value you need isn't here, that's a sign the token set is incomplete
// — add it here, not inline at the call site.

// ── Surfaces (elevation) ────────────────────────────────────────────
// One step per level, consistently applied — was previously
// rgba(30,32,48,0.5) reused as both "the map" and "every panel", with
// no visual distinction between elevation levels at all.
export const SURFACE = {
    page: '#0d0e18',
    panel: 'rgba(255,255,255,0.035)',      // resting panel (tiles, quiet chrome)
    panelBorder: 'rgba(255,255,255,0.08)',
    raised: 'rgba(122,162,247,0.09)',       // the panel the eye should land on next (map, primary chart)
    raisedBorder: 'rgba(122,162,247,0.22)',
    sunken: 'rgba(0,0,0,0.18)',             // input wells, scrollbar track
};

// ── Text (the SYSTEM voice) ─────────────────────────────────────────
// Every value here is verified (not eyeballed) at ≥4.5:1 against a
// #323248-ish panel — computed with the actual WCAG relative-luminance
// formula, composited at each opacity. The review's worst finding was
// a 0.3-opacity caption measuring 2.53:1. First pass at this file used
// 0.50 for `faint`, which measures 4.34:1 — UNDER the line by enough to
// matter; recomputing pushed it to 0.58 (5.27:1). Recorded so nobody
// re-eyeballs a value here without re-running the check:
//   0.30 → 2.53   0.45 → 3.82   0.50 → 4.34   0.58 → 5.27   0.62 → 5.77
export const TEXT = {
    primary: 'rgba(255,255,255,0.92)',
    secondary: 'rgba(255,255,255,0.72)',
    muted: 'rgba(255,255,255,0.62)',        // 5.77:1 — informational text (axis labels, alert detail)
    faint: 'rgba(255,255,255,0.58)',        // 5.27:1 — secondary metadata, smallest allowed for real text
    disabled: 'rgba(255,255,255,0.35)',     // 2.92:1 — decorative/disabled ONLY, never informational text
};

// ── Semantic state (the meaning, not the metaphor) ──────────────────
// "Good for the house" / "bad for the house" — NOT simply green/red as
// decoration. Every alert and diverging value routes through these two
// names so a future colourblind-safe pass only has to edit this block.
export const STATE = {
    positive: '#6ad08f',       // house ahead / all clear
    positiveBg: 'rgba(106,208,143,0.10)',
    positiveBorder: 'rgba(106,208,143,0.30)',
    negative: '#f7768e',       // house behind / breach
    negativeBg: 'rgba(247,118,142,0.10)',
    negativeBorder: 'rgba(247,118,142,0.32)',
    warning: '#e0af68',        // degraded, not yet a breach
    warningBg: 'rgba(224,175,104,0.10)',
    neutral: 'rgba(255,255,255,0.55)',
};

// ── Accent (navigation / focus / "this is interactive") ─────────────
export const ACCENT = '#7aa2f7';
export const ACCENT_BG = 'rgba(122,162,247,0.14)';
export const ACCENT_BORDER = 'rgba(122,162,247,0.35)';

// ── Alert-rule colour → the state each rule actually means ──────────
// NEG_EDGE and TABLE_LOSS are both "the house is losing" — they were
// previously two different reds (#ff7a7a, #f7768e) for no reason.
// PATRON_WIN is the same fact from the patron's side. BET_SPREAD is a
// behavioural flag, not a loss yet, so it gets warning, not negative.
export const RULE_COLOR = {
    NEG_EDGE: STATE.negative,
    TABLE_LOSS: STATE.negative,
    PATRON_WIN: STATE.negative,
    BET_SPREAD: STATE.warning,
};

// ── Type scale ────────────────────────────────────────────────────────
// Every font-size in the surveillance components should be one of
// these. Previously: 10, 10.5, 11, 11.5, 12, 12.5, 13, 13.5, 14, 16, 20,
// 21 all appeared as uncoordinated one-offs.
export const TYPE = {
    micro: 10,      // metadata, chart axis labels
    caption: 11,    // helper text, secondary labels
    label: 12,      // SYSTEM-voice labels, table cell text
    body: 13,       // panel titles, primary UI text
    readout: 15,    // READOUT-voice inline values (alert detail, ranking values)
    tileValue: 22,  // READOUT-voice tile numbers
    pageTitle: 20,
};

// SYSTEM-voice label style: small, uppercase, tracked, muted. Spread
// this into a Typography sx to mark something as chrome, not evidence.
export const systemLabel = {
    fontSize: TYPE.caption,
    fontWeight: 700,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: TEXT.muted,
};

// READOUT-voice value style: bold, tabular, full contrast. Spread this
// onto any number that could be evidence — a win figure, a percentage,
// a count — so it never quietly reads as decoration.
export const readoutValue = (color = TEXT.primary) => ({
    fontWeight: 800,
    color,
    fontVariantNumeric: 'tabular-nums',
});

// ── Spacing scale (MUI spacing units, 1 unit = 8px) ─────────────────
// Previously: 0.35, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1, 1.2, 1.4 all in
// use with no rhythm. Collapsed to a 4-step scale (4/8/12/16px).
export const SPACE = { xs: 0.5, sm: 1, md: 1.5, lg: 2 };

// ── Radius ───────────────────────────────────────────────────────────
export const RADIUS = { sm: 1, md: 1.5, lg: 2 };
