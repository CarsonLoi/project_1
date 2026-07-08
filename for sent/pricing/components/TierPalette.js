// TierPalette — the pricing module's "Available Minimums" picker
// ==============================================================
//
// Mirrors the scheduling ShiftPalette: click a tier to ARM it, then
// every floor click paints that table-minimum onto the table. Click the
// armed tier again to release. An eraser row at the bottom clears a
// table's minimum (un-prices it).

import React from 'react';
import { Box, Typography, Stack, Tooltip } from '@mui/material';
import BackspaceOutlinedIcon from '@mui/icons-material/BackspaceOutlined';
import { formatMinimum, UNPRICED_COLOR } from '../constants/defaultTiers';
import { PRICING_FONTS } from '../constants/fontSizes';

const PL = PRICING_FONTS.palette;

export default function TierPalette({
    tiers,
    activeTierId,
    onPick,                  // (tierId | null) => void
    assignmentCounts = {},   // { [tierId]: number }
    selectedTableCount = 0,
    onAssignToSelected,      // (tierId | null) => void
}) {
    const eraserArmed = activeTierId === '__none';
    const hasSelection = selectedTableCount > 0 && !!onAssignToSelected;

    return (
        <Box sx={{
            p: 1.5,
            bgcolor: 'rgba(8, 22, 36, 0.55)',
            borderRadius: 2,
            border: '1px solid rgba(122, 200, 220, 0.12)',
            fontVariantNumeric: 'tabular-nums',
        }}>
            <Stack direction="row" alignItems="center" spacing={1.2} sx={{ mb: 1.4 }}>
                <Box sx={{ width: 4, height: PL.title, bgcolor: '#7adfff', borderRadius: 1 }} />
                <Typography sx={{ color: '#dff5ff', fontSize: PL.title, fontWeight: 700, letterSpacing: 0.4, lineHeight: 1 }}>
                    Table Minimums
                </Typography>
                <Box sx={{ flex: 1 }} />
                <Typography sx={{
                    color: activeTierId ? '#7adfff' : 'rgba(255,255,255,0.4)', fontSize: PL.hint,
                    fontWeight: 600,
                }}>
                    {activeTierId
                        ? (hasSelection ? `Click a tier to price ${selectedTableCount} selected` : 'Armed — click tables')
                        : 'Click a minimum to start'}
                </Typography>
            </Stack>

            <Box sx={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))',
                gap: 1,
            }}>
                {tiers.map((t) => {
                    const active = activeTierId === t.id;
                    const count = assignmentCounts[t.id] || 0;
                    return (
                        <Box
                            key={t.id}
                            // With a live floor selection, a tier click PRICES
                            // the selected tables (matches the hint above);
                            // with no selection it arms the tier for painting.
                            onClick={() => (hasSelection ? onAssignToSelected(t.id) : onPick(active ? null : t.id))}
                            sx={{
                                cursor: 'pointer', borderRadius: 1.4, overflow: 'hidden',
                                border: `1.5px solid ${active ? t.color : 'rgba(255,255,255,0.10)'}`,
                                bgcolor: active ? `${t.color}1f` : 'rgba(255,255,255,0.02)',
                                boxShadow: active ? `0 0 0 2px ${t.color}44` : 'none',
                                transition: 'background-color 140ms, border-color 140ms',
                                '&:hover': { borderColor: active ? t.color : 'rgba(122, 223, 255, 0.45)' },
                            }}
                        >
                            <Box sx={{ height: 4, bgcolor: t.color }} />
                            <Box sx={{ px: 1.2, py: 0.9 }}>
                                <Stack direction="row" alignItems="center" spacing={0.8}>
                                    <Typography sx={{ color: '#fff', fontSize: PL.tierLabel, fontWeight: 800, flex: 1 }}>
                                        {t.label || formatMinimum(t.min)}
                                    </Typography>
                                    <Tooltip title={`${count} ${count === 1 ? 'table' : 'tables'}`}>
                                        <Box sx={{
                                            minWidth: 22, textAlign: 'center', px: 0.6, py: 0.1, borderRadius: 1,
                                            fontSize: PL.count, fontWeight: 700,
                                            bgcolor: count > 0 ? `${t.color}33` : 'transparent',
                                            color: count > 0 ? '#fff' : 'rgba(255,255,255,0.3)',
                                        }}>
                                            {count}
                                        </Box>
                                    </Tooltip>
                                </Stack>
                            </Box>
                        </Box>
                    );
                })}
            </Box>

            {/* Eraser — clears a table's minimum. */}
            <Box
                onClick={() => onPick(eraserArmed ? null : '__none')}
                sx={{
                    mt: 1.6, pt: 1.2, borderTop: '1px solid rgba(255,255,255,0.07)',
                    display: 'flex', alignItems: 'center', gap: 1, cursor: 'pointer',
                }}
            >
                <Stack
                    direction="row" alignItems="center" spacing={1}
                    sx={{
                        flex: 1, px: 1.2, py: 0.8, borderRadius: 1.2,
                        border: `1.5px solid ${eraserArmed ? '#f7768e' : 'rgba(255,255,255,0.1)'}`,
                        bgcolor: eraserArmed ? 'rgba(247,118,142,0.12)' : 'rgba(255,255,255,0.02)',
                    }}
                >
                    <Box sx={{ width: 14, height: 14, borderRadius: '3px', bgcolor: UNPRICED_COLOR }} />
                    <BackspaceOutlinedIcon sx={{ fontSize: 16, color: eraserArmed ? '#f7768e' : 'rgba(255,255,255,0.55)' }} />
                    <Typography sx={{ color: eraserArmed ? '#f7768e' : 'rgba(255,255,255,0.7)', fontSize: PL.eraser, fontWeight: 700 }}>
                        Clear minimum
                    </Typography>
                    <Box sx={{ flex: 1 }} />
                    {hasSelection && (
                        <Box
                            onClick={(e) => { e.stopPropagation(); onAssignToSelected(null); }}
                            sx={{
                                px: 1, py: 0.3, borderRadius: 1, bgcolor: '#f7768e', color: '#0a1a2c',
                                fontSize: PL.badge, fontWeight: 800, cursor: 'pointer',
                            }}
                        >
                            Clear {selectedTableCount}
                        </Box>
                    )}
                </Stack>
            </Box>
        </Box>
    );
}
