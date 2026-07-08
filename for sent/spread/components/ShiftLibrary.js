// ShiftLibrary
// =============
//
// CRUD on the shift template list. Sits in a collapsible drawer on the
// right of SpreadDashboard.
//
// Designed for low-frequency use — floor managers tweak the template
// list rarely. UX bias toward clarity over density:
//   • one row per shift with all controls inline
//   • a single "+ Add shift" affordance at the top
//   • destructive "Remove" requires a small confirmation step (inline,
//     not a modal — modals break the dashboard's grid flow)

import React, { useState } from 'react';
import {
    Box, Stack, Typography, TextField, IconButton, Button, MenuItem, Select, Tooltip,
} from '@mui/material';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlined';
import AddIcon from '@mui/icons-material/Add';
import RestartAltIcon from '@mui/icons-material/RestartAlt';
import KeyboardArrowUpIcon from '@mui/icons-material/KeyboardArrowUp';
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import { ColorPicker as AntColorPicker, ConfigProvider, theme as antdTheme } from 'antd';
import { makeShiftTemplate } from '../utils/spreadDataModel';
import { shiftLengthHours, formatShiftClock } from '../utils/shiftCoverage';
import { DEFAULT_SHIFT_COLORS } from '../constants/defaultShifts';
import { SPREAD_FONTS } from '../constants/fontSizes';
const LF = SPREAD_FONTS.library;

// Shifts are LOCKED to these three lengths — the floor only runs 24h /
// 16h / 8h patterns, and the spread-derivation matcher relies on that
// (a stray 9h shift would never match cleanly). The editor picks a
// length + a start hour; the end hour is DERIVED so a non-standard
// length can't be entered.
const LENGTH_OPTIONS = ['24h', '16h', '8h'];
const LENGTH_HOURS = { '24h': 24, '16h': 16, '8h': 8 };

// Full color palette — 9 hues × 4 shades (light → dark) + a neutral row.
// Rendered as a swatch grid so the color box is a real palette, not just
// a handful of presets. Any pick (palette or custom) saves to the shift
// and persists in localStorage via the parent's setShifts → saveStore.
const PALETTE = [
    ['#fecaca', '#f87171', '#ef4444', '#b91c1c'], // red
    ['#fed7aa', '#fb923c', '#f97316', '#c2410c'], // orange
    ['#fde68a', '#fbbf24', '#f59e0b', '#b45309'], // amber
    ['#d9f99d', '#a3e635', '#84cc16', '#4d7c0f'], // lime
    ['#bbf7d0', '#4ade80', '#22c55e', '#15803d'], // green
    ['#99f6e4', '#2dd4bf', '#14b8a6', '#0f766e'], // teal
    ['#a5f3fc', '#22d3ee', '#06b6d4', '#0e7490'], // cyan
    ['#bfdbfe', '#60a5fa', '#3b82f6', '#1d4ed8'], // blue
    ['#c7d2fe', '#818cf8', '#6366f1', '#4338ca'], // indigo
    ['#ddd6fe', '#a78bfa', '#8b5cf6', '#6d28d9'], // violet
    ['#f5d0fe', '#e879f9', '#d946ef', '#a21caf'], // fuchsia
    ['#fbcfe8', '#f472b6', '#ec4899', '#be185d'], // pink
    ['#ffffff', '#cbd5e1', '#94a3b8', '#475569'], // neutral
];
const PRESET_COLORS = PALETTE.flat();

const normHour = (h) => ((Math.round(Number(h)) % 24) + 24) % 24;

// End hour (INCLUSIVE) for a start + length. 24h is encoded as
// start === end (the existing convention); 16h/8h add length-1 hours
// and wrap past midnight.
function endFromStartLength(startHour, lengthKind) {
    const s = normHour(startHour);
    const L = LENGTH_HOURS[lengthKind] || 8;
    if (L >= 24) return s;          // 24h → start === end
    return (s + L - 1) % 24;
}

// Pick the standard length kind for an existing shift from its actual
// hour span (so legacy / imported shifts render with a valid selection;
// anything non-standard falls back to 8h and snaps on first edit).
function lengthKindOf(shift) {
    const len = shiftLengthHours(shift);
    return LENGTH_OPTIONS.includes(`${len}h`) ? `${len}h` : '8h';
}

export default function ShiftLibrary({ shifts, onChange }) {
    const [confirmRemoveId, setConfirmRemoveId] = useState(null);

    const update = (id, patch) => {
        onChange(shifts.map((s) => (s.id === id ? { ...s, ...patch } : s)));
    };
    const remove = (id) => {
        onChange(shifts.filter((s) => s.id !== id));
        setConfirmRemoveId(null);
    };
    // Reorder — the shift array order drives the "Available Shifts"
    // order (within each length group) and the order shown elsewhere.
    const move = (idx, dir) => {
        const j = idx + dir;
        if (j < 0 || j >= shifts.length) return;
        const next = [...shifts];
        [next[idx], next[j]] = [next[j], next[idx]];
        onChange(next);
    };
    const add = () => {
        // Default to a valid 8h shift (07:00 → 14:59). The previous
        // default (09→17) was a 9h span — a non-standard length.
        const start = 7;
        onChange([
            ...shifts,
            makeShiftTemplate({
                name: `Shift ${shifts.length + 1}`,
                startHour: start, endHour: endFromStartLength(start, '8h'), kind: '8h',
                color: PRESET_COLORS[shifts.length % PRESET_COLORS.length],
            }),
        ]);
    };

    // Length change → recompute the (derived) end hour and tag the kind.
    const setLength = (s, lengthKind) =>
        update(s.id, { kind: lengthKind, endHour: endFromStartLength(s.startHour, lengthKind) });
    // Start change → recompute the end hour for the current length.
    const setStart = (s, startHour) =>
        update(s.id, { startHour: normHour(startHour), endHour: endFromStartLength(startHour, lengthKindOf(s)) });

    // Reset every shift's color to the default family scheme (blue B /
    // green C / amber D families, violet A). Only touches `color` so
    // assignments and hours are untouched.
    const resetColors = () => {
        onChange(shifts.map((s) => (
            DEFAULT_SHIFT_COLORS[s.id] ? { ...s, color: DEFAULT_SHIFT_COLORS[s.id] } : s
        )));
    };

    return (
        <Box sx={{
            p: 1.5,
            bgcolor: 'rgba(8, 22, 36, 0.55)',
            borderRadius: 2,
            border: '1px solid rgba(122, 200, 220, 0.12)',
            fontVariantNumeric: 'tabular-nums',
        }}>
            <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1.4 }}>
                <Box sx={{ width: 4, height: 20, bgcolor: '#7adfff', borderRadius: 1 }} />
                <Typography sx={{ color: '#dff5ff', fontSize: LF.title, fontWeight: 700, letterSpacing: 0.4 }}>
                    Shift Library
                </Typography>
                <Box sx={{ flex: 1 }} />
                <Tooltip title="Reset every shift's color to the default family scheme">
                    <Button
                        onClick={resetColors}
                        startIcon={<RestartAltIcon sx={{ fontSize: 18 }} />}
                        size="small"
                        sx={{
                            textTransform: 'none', fontSize: 14, fontWeight: 700,
                            color: 'rgba(255,255,255,0.7)',
                            border: '1px solid rgba(255,255,255,0.15)',
                            '&:hover': { bgcolor: 'rgba(122,223,255,0.08)', borderColor: 'rgba(122,223,255,0.4)' },
                        }}
                    >
                        Reset colors
                    </Button>
                </Tooltip>
                <Button
                    onClick={add}
                    startIcon={<AddIcon sx={{ fontSize: 18 }} />}
                    size="small"
                    sx={{
                        textTransform: 'none', fontSize: 14, fontWeight: 700,
                        color: '#7adfff',
                        border: '1px solid rgba(122,223,255,0.35)',
                        '&:hover': { bgcolor: 'rgba(122,223,255,0.08)' },
                    }}
                >
                    Add shift
                </Button>
            </Stack>

            {/* Dark-themed antd so the ColorPicker trigger/popup match the
                dashboard instead of antd's default white light theme. */}
            <ConfigProvider theme={{ algorithm: antdTheme.darkAlgorithm }}>
            <Stack spacing={0.8}>
                {shifts.map((s, idx) => (
                    <Stack
                        key={s.id}
                        direction="row"
                        alignItems="center"
                        spacing={1.2}
                        sx={{
                            px: 1, py: 0.6,
                            borderRadius: 1.4,
                            bgcolor: 'rgba(255,255,255,0.03)',
                            '&:hover': { bgcolor: 'rgba(122,223,255,0.06)' },
                        }}
                    >
                        {/* Reorder handles — the shift array order drives the
                            "Shifts" order. Up/down swap neighbors. Kept tight
                            and horizontally centered with the rest of the row. */}
                        <Stack sx={{ flexShrink: 0, my: -0.4 }}>
                            <IconButton
                                size="small"
                                disabled={idx === 0}
                                onClick={() => move(idx, -1)}
                                sx={{
                                    p: 0, color: 'rgba(255,255,255,0.5)',
                                    '&:hover': { color: '#7adfff', bgcolor: 'transparent' },
                                    '&.Mui-disabled': { color: 'rgba(255,255,255,0.12)' },
                                }}
                            >
                                <KeyboardArrowUpIcon sx={{ fontSize: 18 }} />
                            </IconButton>
                            <IconButton
                                size="small"
                                disabled={idx === shifts.length - 1}
                                onClick={() => move(idx, 1)}
                                sx={{
                                    p: 0, color: 'rgba(255,255,255,0.5)',
                                    '&:hover': { color: '#7adfff', bgcolor: 'transparent' },
                                    '&.Mui-disabled': { color: 'rgba(255,255,255,0.12)' },
                                }}
                            >
                                <KeyboardArrowDownIcon sx={{ fontSize: 18 }} />
                            </IconButton>
                        </Stack>
                        {/* antd ColorPicker — full spectrum + presets,
                            saved to the shift (persists in localStorage).
                            Fixed compact square so it lines up with the row. */}
                        <Box sx={{ display: 'flex', flexShrink: 0, '& .ant-color-picker-trigger': { minWidth: 30 } }}>
                            <AntColorPicker
                                value={s.color}
                                onChangeComplete={(c) => update(s.id, { color: c.toHexString() })}
                                size="small"
                                presets={[{ label: 'Palette', colors: PRESET_COLORS }]}
                            />
                        </Box>
                        {/* Shift identified by its TIME WINDOW (no alias).
                            Edit it via the length + start controls to the
                            right; this label reflects the derived window. */}
                        <Typography sx={{
                            color: '#fff', fontSize: LF.shiftLabel, fontWeight: 700,
                            minWidth: 128, whiteSpace: 'nowrap', lineHeight: 1,
                        }}>
                            {formatShiftClock(s)}
                        </Typography>
                        {/* Length is locked to 24/16/8h — pick the length
                            and the start hour; the end hour is derived. */}
                        <Select
                            value={lengthKindOf(s)}
                            onChange={(e) => setLength(s, e.target.value)}
                            variant="standard"
                            disableUnderline
                            sx={{
                                width: 66,
                                color: '#fff', fontSize: LF.lengthSel, fontWeight: 700,
                                bgcolor: 'rgba(255,255,255,0.05)', borderRadius: 1, px: 0.8, py: 0.2,
                                '& .MuiSelect-icon': { color: 'rgba(255,255,255,0.45)' },
                                '&:before, &:after': { display: 'none' },
                            }}
                        >
                            {LENGTH_OPTIONS.map((k) => (
                                <MenuItem key={k} value={k} sx={{ fontSize: 15 }}>{k}</MenuItem>
                            ))}
                        </Select>
                        <Typography sx={{ color: 'rgba(255,255,255,0.4)', fontSize: LF.rangeText }}>from</Typography>
                        <HourInput
                            value={s.startHour}
                            onChange={(v) => setStart(s, v)}
                            label="start"
                        />
                        {/* Spacer pushes the delete button to the right.
                            (The window is already shown as the row label;
                            no need to repeat it here.) */}
                        <Box sx={{ flex: 1, minWidth: 0 }} />
                        {confirmRemoveId === s.id ? (
                            <Stack direction="row" spacing={0.4}>
                                <Button
                                    size="small"
                                    onClick={() => remove(s.id)}
                                    sx={{
                                        minWidth: 0, px: 1, py: 0.2, fontSize: 12, fontWeight: 700,
                                        color: '#f7768e', border: '1px solid rgba(247,118,142,0.4)',
                                        textTransform: 'none',
                                    }}
                                >
                                    Confirm
                                </Button>
                                <Button
                                    size="small"
                                    onClick={() => setConfirmRemoveId(null)}
                                    sx={{
                                        minWidth: 0, px: 1, py: 0.2, fontSize: 12,
                                        color: 'rgba(255,255,255,0.6)', textTransform: 'none',
                                    }}
                                >
                                    Cancel
                                </Button>
                            </Stack>
                        ) : (
                            <IconButton
                                size="small"
                                onClick={() => setConfirmRemoveId(s.id)}
                                sx={{ color: 'rgba(255,255,255,0.45)', '&:hover': { color: '#f7768e' } }}
                            >
                                <DeleteOutlineIcon fontSize="small" />
                            </IconButton>
                        )}
                    </Stack>
                ))}
            </Stack>
            </ConfigProvider>
        </Box>
    );
}

function HourInput({ value, onChange, label }) {
    return (
        <TextField
            type="number"
            value={value}
            onChange={(e) => {
                const v = parseInt(e.target.value, 10);
                onChange(Number.isFinite(v) ? v : 0);
            }}
            inputProps={{ min: 0, max: 23, step: 1, 'aria-label': label }}
            variant="standard"
            InputProps={{ disableUnderline: true }}
            sx={{
                width: 48,
                '& input': {
                    color: '#fff', fontSize: LF.startInput, fontWeight: 700, textAlign: 'center',
                    fontFeatureSettings: '"tnum"',
                    bgcolor: 'rgba(255,255,255,0.05)', borderRadius: 4, py: 0.4,
                },
                '& input[type=number]': { MozAppearance: 'textfield' },
                '& input[type=number]::-webkit-outer-spin-button': { WebkitAppearance: 'none', margin: 0 },
                '& input[type=number]::-webkit-inner-spin-button': { WebkitAppearance: 'none', margin: 0 },
            }}
        />
    );
}
