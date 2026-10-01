// Gear + (i) buttons for the edge rings. The (i) popover explains how to
// read a ring, with a live example in the current mode and colours.

import React, { useRef, useState } from 'react';
import { Box, ButtonBase, Popover, Stack, Tooltip } from '@mui/material';
import SettingsOutlinedIcon from '@mui/icons-material/SettingsOutlined';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import { ACCENT, TEXT } from '../../constants/rtTheme';
import RingExample from './RingExample';

const iconBtnSx = {
    width: 34, height: 34, borderRadius: 1.5, color: TEXT.primary,
    border: '1px solid rgba(122,162,247,0.4)', bgcolor: 'rgba(10,14,26,0.88)',
    '&:hover': { borderColor: ACCENT },
    '&.Mui-focusVisible': { outline: `2px solid ${ACCENT}`, outlineOffset: 2 },
};

export function IconButtonBox({ label, onClick, children, ...rest }) {
    return (
        <Tooltip title={label}>
            <ButtonBase aria-label={label} onClick={onClick} sx={iconBtnSx} {...rest}>{children}</ButtonBase>
        </Tooltip>
    );
}

export default function RtRingInfo({ settings, onOpenSettings }) {
    const anchor = useRef(null);
    const [open, setOpen] = useState(false);
    const colors = Object.fromEntries(Object.entries(settings.opts).map(([k, v]) => [k, v.color]));
    const segmented = settings.multi === 'segments';
    return (
        <>
            <IconButtonBox label="Ring settings" onClick={onOpenSettings}>
                <SettingsOutlinedIcon sx={{ fontSize: 19 }} />
            </IconButtonBox>
            <IconButtonBox label="How to read the rings" onClick={() => setOpen((v) => !v)} ref={anchor}
                aria-expanded={open} aria-haspopup="dialog">
                <InfoOutlinedIcon sx={{ fontSize: 19 }} />
            </IconButtonBox>
            <Popover
                open={open}
                anchorEl={anchor.current}
                onClose={() => setOpen(false)}
                anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
                transformOrigin={{ vertical: 'top', horizontal: 'right' }}
                slotProps={{ paper: { sx: {
                    mt: 1, p: 1.5, width: 340, bgcolor: '#171a2b', color: TEXT.primary, backgroundImage: 'none',
                    border: '1px solid rgba(214,92,255,0.45)', borderRadius: 2.5, boxShadow: '0 12px 32px rgba(0,0,0,0.55)',
                } } }}
            >
                <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }} role="note" aria-label="How to read the rings">
                    <RingExample mode={settings.multi} colors={colors} />
                    <Box component="ul" sx={{ m: 0, p: 0, listStyle: 'none', display: 'grid', gap: 0.4, fontSize: 12, color: TEXT.secondary }}>
                        <li><b style={{ color: TEXT.primary }}>{segmented ? 'Each arc' : 'Ring colour'}</b> = {segmented ? 'one bet option below its threshold' : 'the worst option'}</li>
                        <li><b style={{ color: TEXT.primary }}>Label</b> = worst option and its live edge</li>
                        <li><b style={{ color: TEXT.primary }}>+2</b> = two more options below threshold</li>
                        <li style={{ color: TEXT.faint }}>Thresholds per option under the gear</li>
                    </Box>
                </Stack>
            </Popover>
        </>
    );
}
