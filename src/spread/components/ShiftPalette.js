// ShiftPalette → "Available Shifts"
// =================================
//
// The picker the operator arms before painting the floor. Click a
// shift to arm it as the active brush; every subsequent floor-map
// click assigns that shift. Click the armed shift again to release.
//
// Design notes:
//   • Shifts are grouped by LENGTH (24h / 16h / 8h / other) under thin
//     section labels, so the "shorts" and "fulls" read as families
//     instead of one undifferentiated wall of swatches.
//   • Every swatch is a fixed width with a colored top bar, the shift
//     name, the clock window (xx:00 – xx:59, inclusive end), and a
//     count chip that only lights up when tables are on that shift.
//   • The eraser ("Unassign / Close") is split out into its own row at
//     the bottom so it never competes visually with the real shifts.

import React, { useMemo } from 'react';
import { Box, Typography, Stack, Tooltip } from '@mui/material';
import BackspaceOutlinedIcon from '@mui/icons-material/BackspaceOutlined';
import { formatShiftClock, shiftLengthHours } from '../utils/shiftCoverage';
import { UNASSIGNED_COLOR } from '../constants/defaultShifts';
import { SPREAD_FONTS } from '../constants/fontSizes';
const PF = SPREAD_FONTS.palette;

// Section ordering: longest patterns first (24 → 16 → 8), anything
// non-standard sorted after by descending length.
function groupShiftsByLength(shifts) {
    const byLen = new Map();
    for (const s of (shifts || [])) {
        const len = shiftLengthHours(s);
        if (!byLen.has(len)) byLen.set(len, []);
        byLen.get(len).push(s);
    }
    const lengths = [...byLen.keys()].sort((a, b) => b - a);
    return lengths.map((len) => ({
        len,
        label: `${len}-Hour`,
        shifts: byLen.get(len),
    }));
}

export default function ShiftPalette({
    shifts,
    activeShiftId,
    onPick,                       // (shiftId | null) => void
    assignmentCounts = {},        // { [shiftId]: number }
    selectedTableCount = 0,       // for the "assign to N selected" affordance
    onAssignToSelected,           // (shiftId | null) => void — bulk assign
}) {
    const groups = useMemo(() => groupShiftsByLength(shifts), [shifts]);
    const eraserArmed = activeShiftId === '__none';
    const hasSelection = selectedTableCount > 0 && !!onAssignToSelected;

    return (
        <Box sx={{
            p: 1.5,
            bgcolor: 'rgba(8, 22, 36, 0.55)',
            borderRadius: 2,
            border: '1px solid rgba(122, 200, 220, 0.12)',
            fontVariantNumeric: 'tabular-nums',
        }}>
            {/* Header */}
            <Stack direction="row" alignItems="center" spacing={1.2} sx={{ mb: 1.4 }}>
                <Box sx={{ width: 4, height: 18, bgcolor: '#7adfff', borderRadius: 1 }} />
                <Typography sx={{
                    color: '#dff5ff', fontSize: PF.title, fontWeight: 700, letterSpacing: 0.4,
                }}>
                    Available Shifts
                </Typography>
                <Box sx={{ flex: 1 }} />
                {activeShiftId ? (
                    <Typography sx={{
                        color: '#7adfff', fontSize: PF.hint, fontWeight: 600,
                        bgcolor: 'rgba(122,223,255,0.12)', px: 1, py: 0.3, borderRadius: 1,
                    }}>
                        {hasSelection
                            ? `Click a swatch ↑ to paint ${selectedTableCount} selected`
                            : 'Armed — click tables to assign'}
                    </Typography>
                ) : (
                    <Typography sx={{ color: 'rgba(255,255,255,0.4)', fontSize: PF.hint }}>
                        Click a shift to start painting
                    </Typography>
                )}
            </Stack>

            {/* Grouped swatches */}
            <Stack spacing={1.4}>
                {groups.map((g) => (
                    <Box key={g.len}>
                        <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 0.8 }}>
                            <Typography sx={{
                                color: 'rgba(255,255,255,0.55)', fontSize: PF.groupLabel, fontWeight: 800,
                                letterSpacing: 1, textTransform: 'uppercase',
                            }}>
                                {g.label}
                            </Typography>
                            <Box sx={{ flex: 1, height: '1px', bgcolor: 'rgba(255,255,255,0.08)' }} />
                            <Typography sx={{ color: 'rgba(255,255,255,0.4)', fontSize: PF.groupCount }}>
                                {g.shifts.length}
                            </Typography>
                        </Stack>
                        <Box sx={{
                            display: 'grid',
                            // Wide enough that the full "07:00 - 06:59" clock
                            // window fits on one line with the count chip —
                            // prefer showing the whole label over truncation.
                            gridTemplateColumns: 'repeat(auto-fill, minmax(152px, 1fr))',
                            gap: 1,
                        }}>
                            {g.shifts.map((s) => (
                                <Swatch
                                    key={s.id}
                                    shift={s}
                                    active={activeShiftId === s.id}
                                    count={assignmentCounts[s.id] || 0}
                                    onClick={() => onPick(activeShiftId === s.id ? null : s.id)}
                                    onBulkAssign={hasSelection ? () => onAssignToSelected(s.id) : null}
                                    selectedTableCount={selectedTableCount}
                                />
                            ))}
                        </Box>
                    </Box>
                ))}
            </Stack>

            {/* Eraser — its own row, visually de-emphasized. Arming it
                makes floor clicks UNASSIGN (close) a table. */}
            <Box
                onClick={() => onPick(eraserArmed ? null : '__none')}
                sx={{
                    mt: 1.6, pt: 1.2,
                    borderTop: '1px solid rgba(255,255,255,0.07)',
                    display: 'flex', alignItems: 'center', gap: 1,
                    cursor: 'pointer',
                }}
            >
                <Stack
                    direction="row" alignItems="center" spacing={1}
                    sx={{
                        flex: 1,
                        px: 1.2, py: 0.8, borderRadius: 1.2,
                        border: `1.5px solid ${eraserArmed ? '#f7768e' : 'rgba(255,255,255,0.1)'}`,
                        bgcolor: eraserArmed ? 'rgba(247,118,142,0.12)' : 'rgba(255,255,255,0.02)',
                        boxShadow: eraserArmed ? '0 0 0 2px rgba(247,118,142,0.28)' : 'none',
                        transition: 'background-color 140ms, border-color 140ms',
                        '&:hover': {
                            borderColor: eraserArmed ? '#f7768e' : 'rgba(247,118,142,0.4)',
                            bgcolor: eraserArmed ? 'rgba(247,118,142,0.18)' : 'rgba(247,118,142,0.06)',
                        },
                    }}
                >
                    <Box sx={{
                        width: 14, height: 14, borderRadius: '3px',
                        bgcolor: UNASSIGNED_COLOR, flexShrink: 0,
                    }} />
                    <BackspaceOutlinedIcon sx={{
                        fontSize: 16, color: eraserArmed ? '#f7768e' : 'rgba(255,255,255,0.55)',
                    }} />
                    <Typography sx={{
                        color: eraserArmed ? '#f7768e' : 'rgba(255,255,255,0.7)',
                        fontSize: PF.eraser, fontWeight: 700,
                    }}>
                        Unassign / Close
                    </Typography>
                    <Box sx={{ flex: 1 }} />
                    {hasSelection && (
                        <Box
                            onClick={(e) => { e.stopPropagation(); onAssignToSelected(null); }}
                            sx={{
                                px: 1, py: 0.3, borderRadius: 1,
                                bgcolor: '#f7768e', color: '#0a1a2c',
                                fontSize: 11, fontWeight: 800,
                                cursor: 'pointer',
                                '&:hover': { bgcolor: '#ff97ab' },
                            }}
                            title={`Clear ${selectedTableCount} selected`}
                        >
                            Clear {selectedTableCount}
                        </Box>
                    )}
                </Stack>
            </Box>
        </Box>
    );
}

function Swatch({ shift, active, count = 0, onClick, onBulkAssign, selectedTableCount }) {
    return (
        <Box
            onClick={onClick}
            sx={{
                position: 'relative',
                cursor: 'pointer',
                borderRadius: 1.4,
                overflow: 'hidden',
                border: `1.5px solid ${active ? shift.color : 'rgba(255,255,255,0.10)'}`,
                bgcolor: active ? `${shift.color}1f` : 'rgba(255,255,255,0.02)',
                boxShadow: active ? `0 0 0 2px ${shift.color}44` : 'none',
                transition: 'background-color 140ms, border-color 140ms, box-shadow 140ms',
                '&:hover': {
                    borderColor: active ? shift.color : 'rgba(122, 223, 255, 0.45)',
                    bgcolor: active ? `${shift.color}2e` : 'rgba(122, 223, 255, 0.06)',
                },
            }}
        >
            {/* Color bar across the top — the shift's identity color,
                full bleed so swatches are scannable by color alone. */}
            <Box sx={{ height: 4, bgcolor: shift.color }} />
            <Box sx={{ px: 1.1, py: 1 }}>
                <Stack direction="row" alignItems="center" spacing={0.6}>
                    {/* Shift identified by its TIME WINDOW (no alias).
                        Tabular figures + tight tracking so the full
                        "07:00 - 06:59" window fits without clipping. */}
                    <Typography sx={{
                        color: '#fff', fontSize: PF.shiftLabel, fontWeight: 800, lineHeight: 1.1,
                        minWidth: 0, flex: 1, letterSpacing: '-0.3px',
                        fontVariantNumeric: 'tabular-nums',
                        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                    }}>
                        {formatShiftClock(shift)}
                    </Typography>
                    {/* Count chip — lit only when tables are assigned. */}
                    <Tooltip title={`${count} ${count === 1 ? 'table' : 'tables'} assigned`}>
                        <Box sx={{
                            minWidth: 20, textAlign: 'center', flexShrink: 0,
                            px: 0.5, py: 0.1, borderRadius: 1,
                            fontSize: PF.count, fontWeight: 700,
                            bgcolor: count > 0 ? `${shift.color}33` : 'transparent',
                            color: count > 0 ? '#fff' : 'rgba(255,255,255,0.3)',
                        }}>
                            {count}
                        </Box>
                    </Tooltip>
                </Stack>
            </Box>

            {/* Quick "apply to N selected" badge — only shows when the
                user has a live floor selection. */}
            {onBulkAssign && (
                <Box
                    onClick={(e) => { e.stopPropagation(); onBulkAssign(); }}
                    sx={{
                        position: 'absolute', top: -8, right: -8,
                        px: 0.8, py: 0.2, borderRadius: 1,
                        bgcolor: '#7adfff', color: '#0a1a2c',
                        fontSize: 11, fontWeight: 800, letterSpacing: 0.4,
                        boxShadow: '0 2px 6px rgba(0,0,0,0.4)',
                        cursor: 'pointer',
                        '&:hover': { bgcolor: '#a0e8ff' },
                    }}
                    title={`Apply to ${selectedTableCount} selected ${selectedTableCount === 1 ? 'table' : 'tables'}`}
                >
                    →{selectedTableCount}
                </Box>
            )}
        </Box>
    );
}
