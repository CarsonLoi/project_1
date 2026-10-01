// Edge ring settings — per bet option on/off, threshold and colour, plus
// the global rules. Changes apply live; Done closes, Reset restores defaults.

import React from 'react';
import {
    Box, Button, ButtonBase, Checkbox, Dialog, FormControlLabel, IconButton, Radio, RadioGroup,
    Stack, Switch, TextField, Typography,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import { PATRON_360 } from '../../constants/rtConfig';
import { ACCENT, TEXT, systemLabel } from '../../constants/rtTheme';
import { mergeRingSettings } from '../../utils/edgeRings';
import RingExample from './RingExample';

export const RING_MAGENTA = 'rgb(214,92,255)';

const inputSx = {
    '& .MuiOutlinedInput-root': { color: TEXT.primary, bgcolor: 'rgba(255,255,255,0.04)', fontVariantNumeric: 'tabular-nums' },
    '& .MuiOutlinedInput-notchedOutline': { borderColor: 'rgba(255,255,255,0.18)' },
    '& .MuiInputBase-input': { py: 0.6, px: 1, textAlign: 'right' },
};

function ModeCard({ value, current, title, text, colors }) {
    const on = value === current;
    return (
        <Box component="label" sx={{
            display: 'grid', gridTemplateColumns: 'auto 1fr', alignItems: 'center', gap: 1.25, p: 1.25,
            borderRadius: 2, cursor: 'pointer',
            border: `1px solid ${on ? RING_MAGENTA : 'rgba(255,255,255,0.14)'}`,
            bgcolor: on ? 'rgba(214,92,255,0.08)' : 'rgba(255,255,255,0.03)',
            '&:has(input:focus-visible)': { outline: `2px solid ${ACCENT}`, outlineOffset: 2 },
        }}>
            <Radio value={value} sx={{ position: 'absolute', opacity: 0, width: 1, height: 1 }} slotProps={{ input: { 'aria-label': title } }} />
            <RingExample mode={value} width={110} height={56} colors={colors} />
            <Box>
                <Typography sx={{ fontSize: 14, fontWeight: 800, color: TEXT.primary }}>
                    {title}
                    {value === 'segments' ? <Box component="span" sx={{ display: 'block', fontSize: 11, fontWeight: 800, letterSpacing: 0.6, color: 'rgb(235,150,255)' }}>RECOMMENDED</Box> : null}
                </Typography>
                <Typography sx={{ fontSize: 12, color: TEXT.faint }}>{text}</Typography>
            </Box>
        </Box>
    );
}

export default function RtRingSettings({ open, settings, onChange, onClose }) {
    const set = (patch) => onChange({ ...settings, ...patch });
    const setOpt = (code, patch) => onChange({ ...settings, opts: { ...settings.opts, [code]: { ...settings.opts[code], ...patch } } });
    const colors = Object.fromEntries(Object.entries(settings.opts).map(([k, v]) => [k, v.color]));

    return (
        <Dialog
            open={open}
            onClose={onClose}
            maxWidth="sm"
            fullWidth
            aria-labelledby="ring-settings-title"
            slotProps={{ paper: { sx: { bgcolor: '#151827', color: TEXT.primary, border: '1px solid rgba(122,162,247,0.28)', borderRadius: 3, backgroundImage: 'none' } } }}
        >
            <Stack direction="row" sx={{ alignItems: 'center', gap: 1.25, px: 2, py: 1.5, borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                <Box component="svg" width={18} height={18} viewBox="0 0 24 24" aria-hidden="true">
                    <circle cx="12" cy="12" r="8" fill="none" stroke={RING_MAGENTA} strokeWidth="2.4" />
                </Box>
                <Typography id="ring-settings-title" component="h2" sx={{ fontSize: 16, fontWeight: 800 }}>Edge ring settings</Typography>
                <Box sx={{ flex: 1 }} />
                <IconButton aria-label="Close settings" onClick={onClose} sx={{ color: TEXT.secondary }}><CloseIcon fontSize="small" /></IconButton>
            </Stack>

            <Stack spacing={2} sx={{ px: 2, py: 1.75, maxHeight: '70vh', overflowY: 'auto' }}>
                <Box>
                    <Typography sx={{ ...systemLabel, mb: 0.75 }}>When several options cross on one table</Typography>
                    <RadioGroup value={settings.multi} onChange={(e) => set({ multi: e.target.value })}
                        sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 1.25 }}>
                        <ModeCard value="segments" current={settings.multi} colors={colors} title="Segmented ring"
                            text="One arc per option below its threshold, in that option's colour. Label shows the worst." />
                        <ModeCard value="worst" current={settings.multi} colors={colors} title="Worst option only"
                            text="One ring in the worst option's colour, with +N for the others." />
                    </RadioGroup>
                </Box>

                <Box sx={{ overflowX: 'auto' }}>
                    <Box component="table" sx={{ width: '100%', borderCollapse: 'collapse', '& td, & th': { px: 0.75, py: 0.5 }, '& td': { borderTop: '1px solid rgba(255,255,255,0.08)' } }}>
                        <thead>
                            <tr>
                                {['Ring', 'Bet option', 'Ring when edge below', 'Colour', 'Theo'].map((h) => (
                                    <Box component="th" key={h} sx={{ ...systemLabel, textAlign: 'left', whiteSpace: 'nowrap' }}>{h}</Box>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {PATRON_360.BET_OPTIONS.map((o) => {
                                const s = settings.opts[o.code];
                                return (
                                    <tr key={o.code}>
                                        <td>
                                            <Checkbox size="small" checked={s.on} onChange={(e) => setOpt(o.code, { on: e.target.checked })}
                                                slotProps={{ input: { 'aria-label': `Ring for ${o.name}` } }} sx={{ color: TEXT.muted, p: 0.5, '&.Mui-checked': { color: RING_MAGENTA } }} />
                                        </td>
                                        <td>
                                            <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                                                <Box sx={{ width: 10, height: 10, borderRadius: 0.5, bgcolor: o.color }} />
                                                <Typography sx={{ fontSize: 13, fontWeight: 800, whiteSpace: 'nowrap' }}>{o.code}</Typography>
                                            </Stack>
                                        </td>
                                        <td>
                                            <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center' }}>
                                                <TextField
                                                    type="number" size="small" value={s.below}
                                                    onChange={(e) => { const v = parseFloat(e.target.value); if (Number.isFinite(v)) setOpt(o.code, { below: v }); }}
                                                    slotProps={{ htmlInput: { step: 0.1, 'aria-label': `${o.code} ring threshold in percent` } }}
                                                    sx={{ ...inputSx, width: 96 }}
                                                />
                                                <Typography sx={{ fontSize: 13, color: TEXT.muted }}>%</Typography>
                                            </Stack>
                                        </td>
                                        <td>
                                            <Box component="input" type="color" value={s.color} aria-label={`${o.code} ring colour`}
                                                onChange={(e) => setOpt(o.code, { color: e.target.value })}
                                                sx={{ width: 36, height: 28, p: 0, border: '1px solid rgba(255,255,255,0.2)', borderRadius: 1, bgcolor: 'transparent', cursor: 'pointer' }} />
                                        </td>
                                        <td><Typography sx={{ fontSize: 12, color: TEXT.faint, fontVariantNumeric: 'tabular-nums' }}>{o.theo.toFixed(2)}%</Typography></td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </Box>
                </Box>

                <Stack direction="row" sx={{ alignItems: 'center', flexWrap: 'wrap', gap: 2 }}>
                    <Stack spacing={0.5}>
                        <Typography component="label" htmlFor="ring-min-hands" sx={systemLabel}>Min hands dealt in shoe</Typography>
                        <TextField
                            id="ring-min-hands" type="number" size="small" value={settings.minHands}
                            onChange={(e) => { const v = parseInt(e.target.value, 10); if (Number.isFinite(v) && v >= 0) set({ minHands: v }); }}
                            slotProps={{ htmlInput: { min: 0, max: 80, step: 1 } }}
                            sx={{ ...inputSx, width: 110 }}
                        />
                    </Stack>
                    <FormControlLabel control={<Switch checked={settings.pulse} onChange={(e) => set({ pulse: e.target.checked })} />}
                        label="Pulse rings" sx={{ color: TEXT.secondary, '& .MuiFormControlLabel-label': { fontSize: 13, fontWeight: 700 } }} />
                    <FormControlLabel control={<Switch checked={settings.labels} onChange={(e) => set({ labels: e.target.checked })} />}
                        label="Label on map" sx={{ color: TEXT.secondary, '& .MuiFormControlLabel-label': { fontSize: 13, fontWeight: 700 } }} />
                </Stack>
            </Stack>

            <Stack direction="row" spacing={1} sx={{ justifyContent: 'flex-end', px: 2, py: 1.5, borderTop: '1px solid rgba(255,255,255,0.08)' }}>
                <Button variant="outlined" onClick={() => onChange(mergeRingSettings(null))} sx={{ textTransform: 'none', fontWeight: 700 }}>Reset to defaults</Button>
                <Button variant="contained" onClick={onClose} sx={{ textTransform: 'none', fontWeight: 800, bgcolor: ACCENT, color: '#0d0e18' }}>Done</Button>
            </Stack>
        </Dialog>
    );
}

// Toolbar cluster: count · Edge rings switch · gear · (i).
export function RingToolbar({ on, onToggle, count, children }) {
    return (
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
            {on ? (
                <Typography sx={{ fontSize: 12, fontWeight: 700, color: TEXT.secondary, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
                    {count} table{count === 1 ? '' : 's'} ringed
                </Typography>
            ) : null}
            <ButtonBase
                onClick={onToggle}
                aria-pressed={on}
                title="Ring tables whose live edge crosses your threshold"
                sx={{
                    gap: 1, px: 1.25, py: 0.75, borderRadius: 1.5, fontSize: 13, fontWeight: 800, whiteSpace: 'nowrap',
                    color: on ? TEXT.primary : TEXT.muted,
                    border: `1px solid ${on ? 'rgba(214,92,255,0.5)' : 'rgba(255,255,255,0.18)'}`,
                    bgcolor: on ? 'rgba(214,92,255,0.1)' : 'transparent',
                    '&.Mui-focusVisible': { outline: `2px solid ${ACCENT}`, outlineOffset: 2 },
                }}
            >
                <Box component="span" aria-hidden="true" sx={{
                    position: 'relative', width: 30, height: 17, borderRadius: 9, transition: 'background-color 150ms',
                    bgcolor: on ? RING_MAGENTA : 'rgba(255,255,255,0.2)',
                    '&::after': {
                        content: '""', position: 'absolute', top: 2, left: 2, width: 13, height: 13, borderRadius: '50%', bgcolor: '#fff',
                        transform: on ? 'translateX(13px)' : 'none', transition: 'transform 150ms',
                    },
                    '@media (prefers-reduced-motion: reduce)': { transition: 'none', '&::after': { transition: 'none' } },
                }} />
                Edge rings
            </ButtonBase>
            {children}
        </Stack>
    );
}
