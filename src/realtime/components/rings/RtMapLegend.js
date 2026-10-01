// One-line colour key under the floor map. Each band is a button that
// shows or hides (fades) the tables in it.

import React from 'react';
import { Box, ButtonBase, Typography } from '@mui/material';
import { ACCENT, TEXT } from '../../constants/rtTheme';
import { bandLabel } from '../../utils/floorBands';

export default function RtMapLegend({ title, ramp = [], counts = [], total = 0, hidden, onToggle, onReset }) {
    const shown = total - ramp.reduce((a, _, i) => a + (hidden.has(i) ? counts[i] || 0 : 0), 0);
    return (
        <Box
            role="group"
            aria-label="Filter tables by colour band"
            sx={{
                display: 'flex', alignItems: 'center', gap: 0.5, flexWrap: 'nowrap', overflowX: 'auto',
                scrollbarWidth: 'none', '&::-webkit-scrollbar': { display: 'none' },
            }}
        >
            {title ? (
                <Typography sx={{ flexShrink: 0, fontSize: 12, fontWeight: 800, color: TEXT.secondary, pr: 0.75, whiteSpace: 'nowrap' }}>
                    {title}
                </Typography>
            ) : null}
            {ramp.map((b, i) => {
                const on = !hidden.has(i);
                return (
                    <ButtonBase
                        key={b.label}
                        onClick={() => onToggle(i)}
                        aria-pressed={on}
                        title={`${on ? 'Hide' : 'Show'} tables in ${bandLabel(b.label)} (${counts[i] || 0})`}
                        sx={{
                            flexShrink: 0, gap: 0.75, px: 1, py: 0.5, borderRadius: 1,
                            border: '1px solid transparent', fontSize: 12, whiteSpace: 'nowrap',
                            color: on ? TEXT.secondary : TEXT.faint,
                            textDecoration: on ? 'none' : 'line-through',
                            '&:hover': { borderColor: 'rgba(255,255,255,0.2)' },
                            '&.Mui-focusVisible': { outline: `2px solid ${ACCENT}`, outlineOffset: 1 },
                        }}
                    >
                        <Box component="span" sx={{ width: 13, height: 11, borderRadius: 0.5, bgcolor: b.color, opacity: on ? 1 : 0.25 }} />
                        {bandLabel(b.label)}
                    </ButtonBase>
                );
            })}
            {hidden.size ? (
                <ButtonBase
                    onClick={onReset}
                    sx={{
                        flexShrink: 0, ml: 0.5, px: 1.1, py: 0.4, borderRadius: 1, fontSize: 12, fontWeight: 700,
                        color: ACCENT, border: '1px solid rgba(122,162,247,0.45)', whiteSpace: 'nowrap',
                        '&.Mui-focusVisible': { outline: `2px solid ${ACCENT}`, outlineOffset: 1 },
                    }}
                >
                    Show all
                </ButtonBase>
            ) : null}
            <Typography sx={{ flexShrink: 0, ml: 'auto', pl: 1, fontSize: 12, color: TEXT.faint, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
                {shown} of {total} tables
            </Typography>
        </Box>
    );
}
