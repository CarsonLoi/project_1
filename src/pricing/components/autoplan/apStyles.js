// Auto-plan — shared look, matched to the Table Pricing page
// (accent #7adfff, text #dff5ff, glassy dark panels, cyan hairlines).

import { PRICING_FONTS } from '../../constants/fontSizes';

export const AP = {
    accent: '#7adfff',
    accentInk: '#0a1a2c',
    text: '#dff5ff',
    muted: 'rgba(223,245,255,0.66)',
    faint: 'rgba(223,245,255,0.58)',
    line: 'rgba(122,200,220,0.25)',
    lineSoft: 'rgba(255,255,255,0.08)',
    panel: 'rgba(255,255,255,0.045)',
    well: 'rgba(8,22,36,0.55)',
    pop: 'rgba(18,22,34,0.98)',
    ok: '#9ece6a',
    bad: '#ff7a8a',
    warn: '#ffcd78',
    pin: '#ffcd78',
    up: '#ff4d4d',
    down: '#46e08a',
};

export const F = PRICING_FONTS;

export const panelSx = {
    p: 1.5, borderRadius: 2, bgcolor: AP.well, border: '1px solid rgba(122,200,220,0.12)',
};

export const titleSx = {
    color: AP.text, fontSize: F.priceMix.title, fontWeight: 800, display: 'flex', alignItems: 'center', gap: 1,
    '&::before': { content: '""', width: 4, height: F.priceMix.title, borderRadius: 1, bgcolor: AP.accent },
};

export const labelSx = { fontSize: 12, fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase', color: AP.muted };

export const ghostSx = {
    textTransform: 'none', fontWeight: 700, fontSize: 13.5, color: AP.text, px: 1.4, py: 0.5, minHeight: 34,
    border: '1px solid rgba(122,200,220,0.3)', borderRadius: 1.5, bgcolor: 'rgba(255,255,255,0.03)',
    '&:hover': { borderColor: AP.accent, bgcolor: 'rgba(122,223,255,0.08)' },
    '&.Mui-disabled': { color: 'rgba(255,255,255,0.35)', borderColor: 'rgba(255,255,255,0.12)' },
    '&.Mui-focusVisible': { outline: `2px solid ${AP.accent}`, outlineOffset: 2 },
};

export const primarySx = {
    textTransform: 'none', fontWeight: 800, fontSize: 14.5, color: AP.accentInk, bgcolor: AP.accent, px: 2, minHeight: 36,
    '&:hover': { bgcolor: '#a0e8ff' },
    '&.Mui-disabled': { bgcolor: 'rgba(255,255,255,0.12)', color: 'rgba(255,255,255,0.4)' },
    '&.Mui-focusVisible': { outline: `2px solid ${AP.text}`, outlineOffset: 2 },
};

export const inputSx = {
    '& .MuiOutlinedInput-root': { color: AP.text, bgcolor: 'rgba(255,255,255,0.045)', fontVariantNumeric: 'tabular-nums', fontWeight: 700, fontSize: 13.5 },
    '& .MuiOutlinedInput-notchedOutline': { borderColor: 'rgba(122,200,220,0.25)' },
    '& .MuiSvgIcon-root': { color: AP.muted },
};

export const selectMenuProps = { slotProps: { paper: { sx: { bgcolor: AP.pop, color: AP.text, border: `1px solid ${AP.line}`, maxHeight: 420 } } } };

export const tierLabel = (tier) => (tier ? tier.label || `$${Number(tier.min).toLocaleString()}` : '—');
export const two = (h) => String(h).padStart(2, '0');
