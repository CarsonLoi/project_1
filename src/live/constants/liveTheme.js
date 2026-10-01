// Live Casino Win — visual theme tokens (v2 "glass & neon" skin).
// ================================================================
// One place for the dashboard's look & feel so every panel stays on
// the same system. The background stays the app's dark navy; what
// changes vs v1:
//
//   • Type system    — Rajdhani (condensed technical display face) for
//                      titles/labels + IBM Plex Mono for every numeral,
//                      replacing the default Roboto everywhere in /live.
//   • Surfaces       — glassmorphism: gradient fills, 1px luminous
//                      borders, soft top-edge highlight, backdrop blur.
//   • Accents        — cyan (#7adfff) primary as before, now paired
//                      with violet (#b18aff) for gradients and amber
//                      (#F59E0B) for warnings/gold highlights.
//
// Fonts load lazily via injectLiveFonts() — called once from the
// dashboard root so the other dashboards keep their existing type.
//
// NOTE: font families, colors, and the font URL come from
// liveConfig.js (the single master tuning file) — this file only
// derives the sx fragments from them.

import { FONT_DISPLAY, FONT_MONO, FONT_URL, ACCENT, ACCENT_2, AMBER } from './liveConfig';

export { FONT_DISPLAY, FONT_MONO, ACCENT, ACCENT_2, AMBER };

let fontsInjected = false;
export function injectLiveFonts() {
    if (fontsInjected || typeof document === 'undefined') return;
    fontsInjected = true;
    const pre1 = document.createElement('link');
    pre1.rel = 'preconnect'; pre1.href = 'https://fonts.googleapis.com';
    const pre2 = document.createElement('link');
    pre2.rel = 'preconnect'; pre2.href = 'https://fonts.gstatic.com'; pre2.crossOrigin = 'anonymous';
    const css = document.createElement('link');
    css.rel = 'stylesheet';
    css.href = FONT_URL;
    document.head.append(pre1, pre2, css);
}

// Primary panel surface — glass card with a luminous top edge.
export const glass = {
    borderRadius: 3,
    background: 'linear-gradient(165deg, rgba(20,38,62,0.72) 0%, rgba(9,19,34,0.9) 55%, rgba(7,15,28,0.94) 100%)',
    border: '1px solid rgba(122,223,255,0.16)',
    boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.06), 0 8px 28px rgba(0,0,0,0.35)',
    backdropFilter: 'blur(10px)',
    overflow: 'hidden',
};

// Inner sub-card (inside a glass panel).
export const glassInner = {
    borderRadius: 2,
    background: 'linear-gradient(165deg, rgba(122,223,255,0.05) 0%, rgba(9,19,34,0.25) 60%)',
    border: '1px solid rgba(122,223,255,0.12)',
    overflow: 'hidden',
};

// Section label — Rajdhani small caps with a wide track.
export const sectionLabel = {
    fontFamily: FONT_DISPLAY,
    color: 'rgba(202,232,255,0.62)',
    fontSize: 11.5, fontWeight: 700,
    letterSpacing: 1.6, textTransform: 'uppercase',
};

// Numeric value styling — mono + tabular.
export const numeral = {
    fontFamily: FONT_MONO,
    fontVariantNumeric: 'tabular-nums',
    fontWeight: 600,
};

// Gradient display text (page title, hero numbers).
export const gradientText = {
    fontFamily: FONT_DISPLAY,
    background: `linear-gradient(90deg, ${ACCENT} 0%, ${ACCENT_2} 100%)`,
    WebkitBackgroundClip: 'text',
    WebkitTextFillColor: 'transparent',
    backgroundClip: 'text',
};

// Accent bar used at the left of panel headers — with a soft glow.
export const accentBar = {
    width: 4, borderRadius: 1,
    background: `linear-gradient(180deg, ${ACCENT}, ${ACCENT_2})`,
    boxShadow: `0 0 8px ${ACCENT}66`,
};

// Panel header strip — gradient hairline underneath.
export const panelHeader = {
    borderBottom: '1px solid transparent',
    borderImage: 'linear-gradient(90deg, rgba(122,223,255,0.35), rgba(177,138,255,0.2), transparent 80%) 1',
};

// Rank medal colors for the Top-N list.
export const RANK_MEDALS = { 1: '#F5C542', 2: '#C7D0DB', 3: '#C98A4B' };
