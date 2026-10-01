// Small pieces shared by the Player 360 levels.

import React from 'react';
import { Box, Stack, Typography } from '@mui/material';
import { TEXT, systemLabel } from '../../constants/rtTheme';
import { STATE_STYLE, panelSx, raisedSx, pct } from './format';

export const MAGENTA = 'rgb(214,92,255)';
export const MAGENTA_TEXT = 'rgb(235,150,255)';
export const WARN = '#e0af68';

export function Panel({ title, hint, right, raised, children, sx }) {
    return (
        <Box component="section" aria-label={typeof title === 'string' ? title : undefined} sx={{ ...(raised ? raisedSx : panelSx), ...sx }}>
            {title || hint || right ? (
                <Stack direction="row" sx={{ alignItems: 'center', columnGap: 1.25, rowGap: 0.75, mb: 1.25, flexWrap: 'wrap' }}>
                    {title ? <Typography component="h3" sx={{ fontSize: 15, fontWeight: 800, color: TEXT.primary }}>{title}</Typography> : null}
                    {hint ? <Typography sx={{ fontSize: 12, color: TEXT.faint }}>{hint}</Typography> : null}
                    <Box sx={{ flex: 1 }} />
                    {right}
                </Stack>
            ) : null}
            {children}
        </Box>
    );
}

export function Kpi({ label, value, sub, color = TEXT.primary, title }) {
    return (
        <Box title={title} sx={{ px: 1.5, py: 0.75, borderRadius: 1.5, bgcolor: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', minWidth: 112 }}>
            <Typography sx={{ ...systemLabel, lineHeight: 1.3, whiteSpace: 'nowrap' }}>{label}</Typography>
            <Typography sx={{ fontSize: 17, fontWeight: 800, color, lineHeight: 1.25, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{value}</Typography>
            {sub ? <Typography sx={{ fontSize: 11, color: TEXT.faint, whiteSpace: 'nowrap' }}>{sub}</Typography> : null}
        </Box>
    );
}

export const KpiRow = ({ children }) => <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 1 }}>{children}</Stack>;

// Worst test state of an option as a dot (with the state as its title).
export function StateDot({ state }) {
    const s = STATE_STYLE[state] || STATE_STYLE.insufficient;
    return <Box component="span" title={s.label} sx={{ width: 9, height: 9, borderRadius: '50%', bgcolor: s.color, display: 'inline-block', flexShrink: 0, boxShadow: '0 0 0 2px rgba(13,14,24,0.85)' }} />;
}

export const OptionChip = ({ color }) => <Box component="span" sx={{ width: 10, height: 10, borderRadius: 0.5, bgcolor: color, display: 'inline-block', flexShrink: 0 }} />;

// Colour for an edge-played figure against its theo.
export const edgeColor = (edge, theo) => (edge == null ? TEXT.faint : edge < 0 ? MAGENTA : edge < theo * 0.6 ? WARN : '#58628c');
export const edgeTextColor = (edge) => (edge != null && edge < 0 ? MAGENTA_TEXT : TEXT.primary);

// Edge played as a value plus a gauge: zero tick, theo tick, bar from 0.
export function EdgeGauge({ edge, theo }) {
    if (edge == null) return <Typography component="span" sx={{ color: TEXT.faint }}>—</Typography>;
    const lo = Math.min(-2, edge);
    const hi = Math.max(theo * 1.15, edge);
    const x = (v) => ((v - lo) / (hi - lo)) * 100;
    const left = Math.min(x(0), x(edge));
    return (
        <Box component="span" sx={{ display: 'inline-grid', gridTemplateColumns: '64px 72px', gap: 1, alignItems: 'center' }}>
            <Box component="b" sx={{ color: edgeTextColor(edge), textAlign: 'right' }}>{pct(edge, 2)}</Box>
            <Box component="span" title={`Edge played ${pct(edge, 2)} · theo ${pct(theo, 2)}`} sx={{ position: 'relative', height: 10, borderRadius: 5, bgcolor: 'rgba(255,255,255,0.06)' }}>
                <Box component="span" sx={{ position: 'absolute', top: 0, bottom: 0, left: `${left}%`, width: `${Math.max(2, Math.abs(x(edge) - x(0)))}%`, borderRadius: 5, bgcolor: edgeColor(edge, theo) }} />
                <Box component="span" sx={{ position: 'absolute', top: -2, bottom: -2, left: `${x(0)}%`, width: '1px', bgcolor: 'rgba(255,255,255,0.35)' }} />
                <Box component="span" sx={{ position: 'absolute', top: -3, bottom: -3, left: `${x(theo)}%`, width: 2, bgcolor: 'rgba(255,255,255,0.7)' }} />
            </Box>
        </Box>
    );
}
