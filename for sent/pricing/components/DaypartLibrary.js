// DaypartLibrary — edit the pricing time blocks
// =============================================
//
// Dayparts are the "couple of hours" groups that make by-hour pricing
// practical: each is a contiguous, inclusive-end hour window with a
// label. Editing here changes how many blocks the day splits into and
// which hours each owns. Ideally they tile the 24h gaming day with no
// gaps/overlaps — the summary line flags coverage so the user can spot a
// hole. (A gap just means those hours resolve to "unpriced".)

import React, { useState } from 'react';
import { Box, Stack, Typography, TextField, IconButton, Button } from '@mui/material';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlined';
import AddIcon from '@mui/icons-material/Add';
import KeyboardArrowUpIcon from '@mui/icons-material/KeyboardArrowUp';
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import { daypartHours, formatDaypartClock } from '../constants/defaultDayparts';
import { LIB_FONTS, libInputSx } from '../constants/fontSizes';

export default function DaypartLibrary({ dayparts, onChange }) {
    const [confirmRemoveId, setConfirmRemoveId] = useState(null);

    const update = (id, patch) => onChange(dayparts.map((d) => (d.id === id ? { ...d, ...patch } : d)));
    const remove = (id) => { onChange(dayparts.filter((d) => d.id !== id)); setConfirmRemoveId(null); };
    // Reorder — the period order drives the period selector + Summary.
    const move = (idx, dir) => {
        const j = idx + dir;
        if (j < 0 || j >= dayparts.length) return;
        const next = [...dayparts];
        [next[idx], next[j]] = [next[j], next[idx]];
        onChange(next);
    };
    const add = () => {
        const id = `dp_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
        onChange([...dayparts, { id, label: 'New', startHour: 0, endHour: 5 }]);
    };

    // Coverage check — every clock hour should be owned by exactly one
    // daypart. Report holes + double-cover so the user can fix tiling.
    const owners = new Array(24).fill(0);
    for (const dp of dayparts) for (const h of daypartHours(dp)) owners[h] += 1;
    const gaps = owners.filter((c) => c === 0).length;
    const overlaps = owners.filter((c) => c > 1).length;

    return (
        <Box sx={{
            p: 1.5, mb: 1.2, bgcolor: 'rgba(8, 22, 36, 0.55)', borderRadius: 2,
            border: '1px solid rgba(122, 200, 220, 0.12)', fontVariantNumeric: 'tabular-nums',
        }}>
            <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1.2 }}>
                <Box sx={{ width: 4, height: LIB_FONTS.heading, bgcolor: '#7adfff', borderRadius: 1 }} />
                <Typography sx={{ color: '#dff5ff', fontSize: LIB_FONTS.heading, fontWeight: 700, letterSpacing: 0.4, lineHeight: 1 }}>
                    Pricing Periods
                </Typography>
                <Box sx={{ flex: 1 }} />
                <Button onClick={add} startIcon={<AddIcon sx={{ fontSize: 18 }} />} size="small"
                    sx={{ textTransform: 'none', fontSize: LIB_FONTS.addBtn, fontWeight: 700, color: '#7adfff', border: '1px solid rgba(122,223,255,0.35)', '&:hover': { bgcolor: 'rgba(122,223,255,0.08)' } }}>
                    Add period
                </Button>
            </Stack>

            <Stack spacing={0.8}>
                {dayparts.map((dp, idx) => (
                    <Stack key={dp.id} direction="row" alignItems="center" spacing={1.2}
                        sx={{ px: 1, py: 0.6, borderRadius: 1.4, bgcolor: 'rgba(255,255,255,0.03)', '&:hover': { bgcolor: 'rgba(122,223,255,0.06)' } }}>
                        {/* Reorder handles — order drives the period selector. */}
                        <Stack sx={{ flexShrink: 0, my: -0.4 }}>
                            <IconButton size="small" disabled={idx === 0} onClick={() => move(idx, -1)}
                                sx={{ p: 0, color: 'rgba(255,255,255,0.5)', '&:hover': { color: '#7adfff', bgcolor: 'transparent' }, '&.Mui-disabled': { color: 'rgba(255,255,255,0.12)' } }}>
                                <KeyboardArrowUpIcon sx={{ fontSize: 18 }} />
                            </IconButton>
                            <IconButton size="small" disabled={idx === dayparts.length - 1} onClick={() => move(idx, 1)}
                                sx={{ p: 0, color: 'rgba(255,255,255,0.5)', '&:hover': { color: '#7adfff', bgcolor: 'transparent' }, '&.Mui-disabled': { color: 'rgba(255,255,255,0.12)' } }}>
                                <KeyboardArrowDownIcon sx={{ fontSize: 18 }} />
                            </IconButton>
                        </Stack>
                        <TextField
                            value={dp.label}
                            onChange={(e) => update(dp.id, { label: e.target.value })}
                            variant="standard" InputProps={{ disableUnderline: true }}
                            sx={libInputSx({ width: 120 })}
                        />
                        <Typography sx={{ color: 'rgba(255,255,255,0.4)', fontSize: LIB_FONTS.rowMeta }}>from</Typography>
                        <HourInput value={dp.startHour} onChange={(v) => update(dp.id, { startHour: v })} />
                        <Typography sx={{ color: 'rgba(255,255,255,0.4)', fontSize: LIB_FONTS.rowMeta }}>to</Typography>
                        <HourInput value={dp.endHour} onChange={(v) => update(dp.id, { endHour: v })} />
                        <Typography sx={{ color: 'rgba(255,255,255,0.55)', fontSize: LIB_FONTS.hint, minWidth: 120 }}>
                            {formatDaypartClock(dp)}
                        </Typography>
                        <Box sx={{ flex: 1, minWidth: 0 }} />
                        {confirmRemoveId === dp.id ? (
                            <Stack direction="row" spacing={0.4}>
                                <Button size="small" onClick={() => remove(dp.id)}
                                    sx={{ minWidth: 0, px: 1, py: 0.2, fontSize: LIB_FONTS.small, fontWeight: 700, color: '#f7768e', border: '1px solid rgba(247,118,142,0.4)', textTransform: 'none' }}>
                                    Confirm
                                </Button>
                                <Button size="small" onClick={() => setConfirmRemoveId(null)}
                                    sx={{ minWidth: 0, px: 1, py: 0.2, fontSize: LIB_FONTS.small, color: 'rgba(255,255,255,0.6)', textTransform: 'none' }}>
                                    Cancel
                                </Button>
                            </Stack>
                        ) : (
                            <IconButton size="small" onClick={() => setConfirmRemoveId(dp.id)}
                                sx={{ color: 'rgba(255,255,255,0.45)', '&:hover': { color: '#f7768e' } }}>
                                <DeleteOutlineIcon fontSize="small" />
                            </IconButton>
                        )}
                    </Stack>
                ))}
            </Stack>

            {/* Coverage hint */}
            <Typography sx={{
                mt: 1, fontSize: LIB_FONTS.small,
                color: (gaps || overlaps) ? '#e0af68' : 'rgba(255,255,255,0.45)',
            }}>
                {gaps === 0 && overlaps === 0
                    ? 'All 24 hours covered, no overlaps ✓'
                    : `${gaps ? `${gaps}h uncovered` : ''}${gaps && overlaps ? ' · ' : ''}${overlaps ? `${overlaps}h double-covered` : ''}`}
            </Typography>
        </Box>
    );
}

function HourInput({ value, onChange }) {
    return (
        <TextField
            type="number" value={value}
            onChange={(e) => { const v = parseInt(e.target.value, 10); onChange(Number.isFinite(v) ? ((v % 24) + 24) % 24 : 0); }}
            inputProps={{ min: 0, max: 23, step: 1 }}
            variant="standard" InputProps={{ disableUnderline: true }}
            sx={libInputSx({ width: 52, align: 'center' })}
        />
    );
}
