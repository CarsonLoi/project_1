// SelectionActionBar — floating bulk-action menu
// ===============================================
//
// Appears (slide-up, 200ms) at the bottom-center of the floor map
// whenever one or more tables are selected. The production flow:
//
//   lasso tables (rect/polygon) → this bar appears → pick an action
//
// Actions:
//   • Assign / adjust — click any shift swatch to (re)assign every
//     selected table to that shift. Assign and adjust are the same
//     operation (assignment map overwrite), so one swatch row serves
//     both — the summary chips show what the selection currently
//     holds, making "adjust B → C" a one-click read-then-click.
//   • Remove shift   — unassigns every selected table.
//   • Clear          — empties the selection (Esc does the same).
//
// UX rules applied: one primary action zone (the swatch row), ≥44px
// touch targets, color+name on every swatch (not color alone),
// tabular numerals on counts, escape routes (Clear button, X, Esc).

import React from 'react';
import { Box, Stack, Typography, IconButton, Button, Tooltip } from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import LayersClearIcon from '@mui/icons-material/LayersClear';
import { formatShiftRange } from '../utils/shiftCoverage';
import { UNASSIGNED_COLOR, UNASSIGNED_LABEL } from '../constants/defaultShifts';

export default function SelectionActionBar({
    selectedKeys,           // Set<string>
    assignments,            // { [tableKey]: shiftId }
    shifts,                 // ShiftTemplate[]
    onAssignShift,          // (shiftId) => void — assign to whole selection
    onRemoveShift,          // () => void — unassign whole selection
    onClear,                // () => void — empty the selection
}) {
    const count = selectedKeys ? selectedKeys.size : 0;
    if (count === 0) return null;

    // Current-assignment breakdown of the selection — tells the user
    // what they're about to overwrite ("3 on B · 2 unassigned") so
    // adjust operations are informed, not blind.
    const shiftMap = new Map((shifts || []).map((s) => [s.id, s]));
    const tally = new Map();
    for (const key of selectedKeys) {
        const sid = (assignments || {})[key] || '__none';
        tally.set(sid, (tally.get(sid) || 0) + 1);
    }
    const summary = [...tally.entries()]
        .map(([sid, n]) => {
            const s = sid === '__none' ? null : shiftMap.get(sid);
            return {
                label: s ? s.name : UNASSIGNED_LABEL,
                color: s ? s.color : UNASSIGNED_COLOR,
                n,
            };
        })
        .sort((a, b) => b.n - a.n);

    return (
        <Box
            sx={{
                position: 'absolute',
                bottom: 16,
                left: '50%',
                transform: 'translateX(-50%)',
                zIndex: 6,
                minWidth: 420,
                maxWidth: 'calc(100% - 32px)',
                bgcolor: 'rgba(10, 22, 35, 0.94)',
                border: '1px solid rgba(122, 200, 220, 0.35)',
                borderRadius: 2,
                boxShadow: '0 12px 40px rgba(0,0,0,0.6)',
                backdropFilter: 'blur(12px) saturate(140%)',
                WebkitBackdropFilter: 'blur(12px) saturate(140%)',
                px: 2,
                py: 1.4,
                fontVariantNumeric: 'tabular-nums',
                // Slide-up entrance. Keyframed once; re-mounts (count
                // 0 → N) replay it, count changes while open don't.
                animation: 'spreadBarIn 200ms ease-out',
                '@keyframes spreadBarIn': {
                    from: { opacity: 0, transform: 'translate(-50%, 12px)' },
                    to:   { opacity: 1, transform: 'translate(-50%, 0)' },
                },
            }}
        >
            {/* Header row — count + breakdown + dismiss */}
            <Stack direction="row" alignItems="center" spacing={1.2} sx={{ mb: 1.2 }}>
                <Typography sx={{ color: '#7adfff', fontSize: 17, fontWeight: 800, lineHeight: 1 }}>
                    {count} table{count === 1 ? '' : 's'} selected
                </Typography>
                <Stack direction="row" spacing={0.8} sx={{ flexWrap: 'wrap', rowGap: 0.4, flex: 1, minWidth: 0 }}>
                    {summary.map((s) => (
                        <Stack key={s.label} direction="row" alignItems="center" spacing={0.5} sx={{
                            px: 0.8, py: 0.2, borderRadius: 1,
                            bgcolor: 'rgba(255,255,255,0.05)',
                            border: '1px solid rgba(255,255,255,0.08)',
                        }}>
                            <Box sx={{ width: 9, height: 9, borderRadius: '2px', bgcolor: s.color }} />
                            <Typography sx={{ color: 'rgba(255,255,255,0.8)', fontSize: 12, fontWeight: 600 }}>
                                {s.n} {s.label}
                            </Typography>
                        </Stack>
                    ))}
                </Stack>
                <Tooltip title="Clear selection (Esc)">
                    <IconButton size="small" onClick={onClear} sx={{ color: 'rgba(255,255,255,0.55)', '&:hover': { color: '#fff' } }}>
                        <CloseIcon fontSize="small" />
                    </IconButton>
                </Tooltip>
            </Stack>

            {/* Primary zone — assign/adjust swatches */}
            <Typography sx={{
                color: 'rgba(255,255,255,0.45)', fontSize: 11, fontWeight: 700,
                letterSpacing: 1.2, textTransform: 'uppercase', mb: 0.6,
            }}>
                Assign shift to selection
            </Typography>
            <Stack direction="row" spacing={0.8} sx={{ flexWrap: 'wrap', rowGap: 0.8, alignItems: 'center' }}>
                {(shifts || []).map((s) => (
                    <Tooltip key={s.id} title={`${formatShiftRange(s)} — assign to ${count} table${count === 1 ? '' : 's'}`}>
                        <Box
                            onClick={() => onAssignShift(s.id)}
                            sx={{
                                display: 'flex', alignItems: 'center', gap: 0.7,
                                px: 1.2, py: 0.9,
                                borderRadius: 1.2,
                                cursor: 'pointer',
                                border: '1.5px solid rgba(255,255,255,0.12)',
                                bgcolor: 'rgba(255,255,255,0.03)',
                                transition: 'border-color 150ms, background-color 150ms, transform 120ms',
                                '&:hover': {
                                    borderColor: s.color,
                                    bgcolor: `${s.color}22`,
                                    transform: 'translateY(-1px)',
                                },
                                '&:active': { transform: 'scale(0.97)' },
                            }}
                        >
                            <Box sx={{ width: 12, height: 12, borderRadius: '3px', bgcolor: s.color, boxShadow: `0 0 6px ${s.color}88` }} />
                            <Typography sx={{ color: '#fff', fontSize: 15, fontWeight: 700, lineHeight: 1 }}>
                                {s.name}
                            </Typography>
                        </Box>
                    </Tooltip>
                ))}

                <Box sx={{ width: '1px', alignSelf: 'stretch', bgcolor: 'rgba(255,255,255,0.12)', mx: 0.6 }} />

                {/* Destructive — visually separated from the assign zone
                    per the destructive-emphasis rule. */}
                <Button
                    onClick={onRemoveShift}
                    startIcon={<LayersClearIcon sx={{ fontSize: 17 }} />}
                    size="small"
                    sx={{
                        textTransform: 'none', fontSize: 13, fontWeight: 700,
                        color: '#f7768e',
                        border: '1px solid rgba(247, 118, 142, 0.4)',
                        px: 1.4, py: 0.7,
                        '&:hover': { bgcolor: 'rgba(247, 118, 142, 0.10)', borderColor: '#f7768e' },
                    }}
                >
                    Remove shift
                </Button>
            </Stack>
        </Box>
    );
}
