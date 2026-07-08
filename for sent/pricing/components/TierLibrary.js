// TierLibrary — edit the "Available Minimum" list
// ================================================
//
// The pricing module's analogue of the scheduling ShiftLibrary. Each row
// is a $ minimum (its label IS the value; the numeric value is parsed from
// the label, so there's no redundant "min $" field) with an identity
// color. Up/down reorder drives the palette + price-mix distribution.
// (Boundary combinations live in their own tab — see BoundaryLibrary.)

import React, { useState } from 'react';
import { Box, Stack, Typography, TextField, IconButton, Button } from '@mui/material';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlined';
import AddIcon from '@mui/icons-material/Add';
import KeyboardArrowUpIcon from '@mui/icons-material/KeyboardArrowUp';
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import { ColorPicker as AntColorPicker, ConfigProvider, theme as antdTheme } from 'antd';
import { DEFAULT_TIERS, tableMinimumColor } from '../constants/defaultTiers';
import { LIB_FONTS, libInputSx } from '../constants/fontSizes';

const PRESET_COLORS = DEFAULT_TIERS.map((t) => t.color);

// Pull the numeric minimum out of a label like "$1,000" → 1000.
const parseMin = (s) => {
    const n = parseInt(String(s).replace(/[^0-9]/g, ''), 10);
    return Number.isFinite(n) ? n : 0;
};

export default function TierLibrary({ tiers, onChange }) {
    const [confirmRemoveId, setConfirmRemoveId] = useState(null);

    const update = (id, patch) =>
        onChange(tiers.map((t) => (t.id === id ? { ...t, ...patch } : t)));
    const remove = (id) => {
        onChange(tiers.filter((t) => t.id !== id));
        setConfirmRemoveId(null);
    };
    const move = (idx, dir) => {
        const j = idx + dir;
        if (j < 0 || j >= tiers.length) return;
        const next = [...tiers];
        [next[idx], next[j]] = [next[j], next[idx]];
        onChange(next);
    };
    const add = () => {
        const id = `m_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
        // Seed the new minimum above the current max so it sorts sensibly.
        const maxMin = tiers.reduce((m, t) => Math.max(m, t.min || 0), 0);
        const min = maxMin > 0 ? maxMin * 2 : 50;
        // Color new minimums with the performance "Table minimum" scheme.
        onChange([...tiers, { id, label: `$${min.toLocaleString()}`, min, color: tableMinimumColor(min) }]);
    };

    return (
        <Box sx={{
            p: 1.5, bgcolor: 'rgba(8, 22, 36, 0.55)', borderRadius: 2,
            border: '1px solid rgba(122, 200, 220, 0.12)', fontVariantNumeric: 'tabular-nums',
        }}>
            <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1.4 }}>
                <Box sx={{ width: 4, height: LIB_FONTS.heading, bgcolor: '#7adfff', borderRadius: 1 }} />
                <Typography sx={{ color: '#dff5ff', fontSize: LIB_FONTS.heading, fontWeight: 700, letterSpacing: 0.4, lineHeight: 1 }}>
                    Available Minimum
                </Typography>
                <Box sx={{ flex: 1 }} />
                <Button
                    onClick={add}
                    startIcon={<AddIcon sx={{ fontSize: 18 }} />}
                    size="small"
                    sx={{
                        textTransform: 'none', fontSize: LIB_FONTS.addBtn, fontWeight: 700, color: '#7adfff',
                        border: '1px solid rgba(122,223,255,0.35)',
                        '&:hover': { bgcolor: 'rgba(122,223,255,0.08)' },
                    }}
                >
                    Add minimum
                </Button>
            </Stack>

            <ConfigProvider theme={{ algorithm: antdTheme.darkAlgorithm }}>
            <Stack spacing={0.8}>
                {tiers.map((t, idx) => (
                    <Stack
                        key={t.id}
                        direction="row" alignItems="center" spacing={1.2}
                        sx={{
                            px: 1, py: 0.6, borderRadius: 1.4,
                            bgcolor: 'rgba(255,255,255,0.03)',
                            '&:hover': { bgcolor: 'rgba(122,223,255,0.06)' },
                        }}
                    >
                        <Stack sx={{ flexShrink: 0, my: -0.4 }}>
                            <IconButton size="small" disabled={idx === 0} onClick={() => move(idx, -1)}
                                sx={{ p: 0, color: 'rgba(255,255,255,0.5)', '&:hover': { color: '#7adfff', bgcolor: 'transparent' }, '&.Mui-disabled': { color: 'rgba(255,255,255,0.12)' } }}>
                                <KeyboardArrowUpIcon sx={{ fontSize: 18 }} />
                            </IconButton>
                            <IconButton size="small" disabled={idx === tiers.length - 1} onClick={() => move(idx, 1)}
                                sx={{ p: 0, color: 'rgba(255,255,255,0.5)', '&:hover': { color: '#7adfff', bgcolor: 'transparent' }, '&.Mui-disabled': { color: 'rgba(255,255,255,0.12)' } }}>
                                <KeyboardArrowDownIcon sx={{ fontSize: 18 }} />
                            </IconButton>
                        </Stack>

                        <Box sx={{ display: 'flex', flexShrink: 0, '& .ant-color-picker-trigger': { minWidth: 30 } }}>
                            <AntColorPicker
                                value={t.color}
                                onChangeComplete={(c) => update(t.id, { color: c.toHexString() })}
                                size="small"
                                presets={[{ label: 'Palette', colors: PRESET_COLORS }]}
                            />
                        </Box>

                        {/* The label IS the minimum — value parsed from it. */}
                        <TextField
                            value={t.label}
                            onChange={(e) => update(t.id, { label: e.target.value, min: parseMin(e.target.value) })}
                            variant="standard"
                            InputProps={{ disableUnderline: true }}
                            sx={libInputSx({ width: 140 })}
                        />
                        <Box sx={{ flex: 1, minWidth: 0 }} />
                        {confirmRemoveId === t.id ? (
                            <Stack direction="row" spacing={0.4}>
                                <Button size="small" onClick={() => remove(t.id)}
                                    sx={{ minWidth: 0, px: 1, py: 0.2, fontSize: LIB_FONTS.small, fontWeight: 700, color: '#f7768e', border: '1px solid rgba(247,118,142,0.4)', textTransform: 'none' }}>
                                    Confirm
                                </Button>
                                <Button size="small" onClick={() => setConfirmRemoveId(null)}
                                    sx={{ minWidth: 0, px: 1, py: 0.2, fontSize: LIB_FONTS.small, color: 'rgba(255,255,255,0.6)', textTransform: 'none' }}>
                                    Cancel
                                </Button>
                            </Stack>
                        ) : (
                            <IconButton size="small" onClick={() => setConfirmRemoveId(t.id)}
                                sx={{ color: 'rgba(255,255,255,0.45)', '&:hover': { color: '#f7768e' } }}>
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
