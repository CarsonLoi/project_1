// BoundaryLibrary — edit the default Min–Max boundary combinations
// ================================================================
//
// Boundary combinations are named Min–Max pairs the operator can one-click
// in the price popup instead of dialing the range by hand. Stored as raw $
// amounts (snapped to the nearest tier at apply time). Its own Settings
// tab so the editor has room and stays readable. Font scale = LIB_FONTS,
// the same as the Available Minimum panel.

import React from 'react';
import { Box, Stack, Typography, TextField, IconButton, Button } from '@mui/material';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlined';
import AddIcon from '@mui/icons-material/Add';
import { formatMinimum } from '../constants/defaultTiers';
import { LIB_FONTS, libInputSx } from '../constants/fontSizes';

const parseMin = (s) => {
    const n = parseInt(String(s).replace(/[^0-9]/g, ''), 10);
    return Number.isFinite(n) ? n : 0;
};

export default function BoundaryLibrary({ boundaryPresets = [], onChange }) {
    const update = (id, patch) =>
        onChange((boundaryPresets || []).map((p) => (p.id === id ? { ...p, ...patch } : p)));
    const remove = (id) =>
        onChange((boundaryPresets || []).filter((p) => p.id !== id));
    const add = () => {
        const id = `bp_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
        onChange([...(boundaryPresets || []), { id, label: 'New', min: 300, max: 1000 }]);
    };

    return (
        <Box sx={{
            p: 1.5, bgcolor: 'rgba(8, 22, 36, 0.55)', borderRadius: 2,
            border: '1px solid rgba(122, 200, 220, 0.12)', fontVariantNumeric: 'tabular-nums',
        }}>
            <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1.4 }}>
                <Box sx={{ width: 4, height: LIB_FONTS.heading, bgcolor: '#9ece6a', borderRadius: 1 }} />
                <Typography sx={{ color: '#dff5ff', fontSize: LIB_FONTS.heading, fontWeight: 700, letterSpacing: 0.4, lineHeight: 1 }}>
                    Boundary Combinations
                </Typography>
                <Box sx={{ flex: 1 }} />
                <Button onClick={add} startIcon={<AddIcon sx={{ fontSize: 18 }} />} size="small"
                    sx={{ textTransform: 'none', fontSize: LIB_FONTS.addBtn, fontWeight: 700, color: '#9ece6a', border: '1px solid rgba(158,206,106,0.35)', '&:hover': { bgcolor: 'rgba(158,206,106,0.08)' } }}>
                    Add combination
                </Button>
            </Stack>

            <Typography sx={{ color: 'rgba(255,255,255,0.5)', fontSize: LIB_FONTS.hint, mb: 1.2 }}>
                Quick Min–Max presets shown in the price popup. Values snap to the nearest available minimum.
            </Typography>

            <Stack spacing={0.8}>
                {(boundaryPresets || []).map((p) => (
                    <Stack key={p.id} direction="row" alignItems="center" spacing={1.2} sx={{ px: 1, py: 0.7, borderRadius: 1.4, bgcolor: 'rgba(255,255,255,0.03)', '&:hover': { bgcolor: 'rgba(158,206,106,0.06)' } }}>
                        <TextField
                            value={p.label}
                            onChange={(e) => update(p.id, { label: e.target.value })}
                            variant="standard" InputProps={{ disableUnderline: true }}
                            sx={libInputSx({ width: 120 })}
                        />
                        <Typography sx={{ color: 'rgba(255,255,255,0.45)', fontSize: LIB_FONTS.rowMeta }}>min&nbsp;$</Typography>
                        <TextField type="number" value={p.min} onChange={(e) => update(p.id, { min: parseMin(e.target.value) })}
                            inputProps={{ min: 0, step: 50 }} variant="standard" InputProps={{ disableUnderline: true }} sx={libInputSx({ width: 110, align: 'right' })} />
                        <Typography sx={{ color: 'rgba(255,255,255,0.45)', fontSize: LIB_FONTS.rowMeta }}>max&nbsp;$</Typography>
                        <TextField type="number" value={p.max} onChange={(e) => update(p.id, { max: parseMin(e.target.value) })}
                            inputProps={{ min: 0, step: 50 }} variant="standard" InputProps={{ disableUnderline: true }} sx={libInputSx({ width: 110, align: 'right' })} />
                        <Box sx={{ flex: 1, minWidth: 0 }} />
                        <Typography sx={{ color: '#9ece6a', fontSize: LIB_FONTS.rowMeta, fontWeight: 700, whiteSpace: 'nowrap' }}>
                            {formatMinimum(p.min)}–{formatMinimum(p.max)}
                        </Typography>
                        <IconButton size="small" onClick={() => remove(p.id)}
                            sx={{ color: 'rgba(255,255,255,0.45)', '&:hover': { color: '#f7768e' } }}>
                            <DeleteOutlineIcon fontSize="small" />
                        </IconButton>
                    </Stack>
                ))}
                {(boundaryPresets || []).length === 0 && (
                    <Typography sx={{ color: 'rgba(255,255,255,0.4)', fontSize: LIB_FONTS.hint, fontStyle: 'italic', px: 1, py: 0.5 }}>
                        No combinations yet — add one to get quick Min–Max presets in the price popup.
                    </Typography>
                )}
            </Stack>
        </Box>
    );
}
