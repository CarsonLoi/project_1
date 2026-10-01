// Where you are in the Player 360: Back, the breadcrumb, and Prev / Next
// for siblings at the current level.

import React from 'react';
import { Box, ButtonBase, Stack, Typography } from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import { TEXT, ACCENT } from '../../constants/rtTheme';

const btnSx = {
    px: 1.5, py: 0.75, borderRadius: 1.5, fontSize: 13, fontWeight: 700, color: TEXT.primary, gap: 0.75,
    border: '1px solid rgba(255,255,255,0.16)', bgcolor: 'rgba(255,255,255,0.03)', whiteSpace: 'nowrap',
    '&:hover': { borderColor: ACCENT },
    '&.Mui-disabled': { opacity: 0.35 },
    '&.Mui-focusVisible': { outline: `2px solid ${ACCENT}`, outlineOffset: 2 },
};

export default function P360Nav({ crumbs, onBack, prev, next, position }) {
    return (
        <Stack component="nav" aria-label="Where you are" direction="row" sx={{ alignItems: 'center', gap: 1.25, flexWrap: 'wrap', minHeight: 38 }}>
            <ButtonBase onClick={onBack} disabled={!onBack} title="Back (Alt+←)" sx={{ ...btnSx, borderColor: 'rgba(122,162,247,0.45)' }}>
                <ArrowBackIcon sx={{ fontSize: 16 }} /> Back
            </ButtonBase>
            <Stack component="ol" direction="row" sx={{ listStyle: 'none', m: 0, p: 0, alignItems: 'center', flexWrap: 'wrap', gap: 0.5 }}>
                {crumbs.map((c, i) => {
                    const last = i === crumbs.length - 1;
                    return (
                        <Stack component="li" key={i} direction="row" sx={{ alignItems: 'center', gap: 0.5 }}>
                            {last ? (
                                <Typography aria-current="page" sx={{ fontSize: 14, fontWeight: 800, color: TEXT.primary, px: 0.75 }}>{c.label}</Typography>
                            ) : (
                                <ButtonBase onClick={c.onClick} sx={{
                                    fontSize: 14, fontWeight: 700, color: ACCENT, px: 0.75, py: 0.4, borderRadius: 1,
                                    '&:hover': { bgcolor: 'rgba(122,162,247,0.12)' },
                                    '&.Mui-focusVisible': { outline: `2px solid ${ACCENT}`, outlineOffset: 1 },
                                }}>{c.label}</ButtonBase>
                            )}
                            {last ? null : <Box component="span" aria-hidden="true" sx={{ color: TEXT.faint }}>›</Box>}
                        </Stack>
                    );
                })}
            </Stack>
            <Box sx={{ flex: 1 }} />
            {position ? <Typography sx={{ fontSize: 12, color: TEXT.faint, fontVariantNumeric: 'tabular-nums' }}>{position}</Typography> : null}
            {prev ? <ButtonBase onClick={prev.onClick} disabled={!prev.onClick} sx={btnSx}>‹ {prev.label}</ButtonBase> : null}
            {next ? <ButtonBase onClick={next.onClick} disabled={!next.onClick} sx={btnSx}>{next.label} ›</ButtonBase> : null}
            {onBack ? <Typography sx={{ fontSize: 11, color: TEXT.faint }}>Alt+← back</Typography> : null}
        </Stack>
    );
}
