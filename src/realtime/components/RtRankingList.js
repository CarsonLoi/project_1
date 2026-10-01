// Diverging-bar ranking list.
// ===========================
// The shared workhorse behind four of the five tabs (Table W/L, Edge,
// Patrons, Dealers). One component rather than four near-identical ones,
// because they differ only in what they rank and how the value formats.
//
// Why ranking rather than colour-banding: a sorted list is self-
// calibrating. It needs no thresholds tuned against a property's real
// distribution to be useful on day one, which the heatmap ramps do.
// That makes these tabs the reliable surveillance read while the map
// colours are still being calibrated.
//
// Bars are centred at zero when `diverging` — losses extend left,
// wins right — so the sign is legible from the shape alone, not only
// from the colour or the minus sign.

import React, { useMemo } from 'react';
import { Box, Typography, Stack, Tooltip } from '@mui/material';
import { STATE, ACCENT, TEXT } from '../constants/rtTheme';

const NEG = STATE.negative;
const POS = STATE.positive;
const NEUTRAL = ACCENT;

export default function RtRankingList({
    rows = [],
    diverging = true,
    format = (v) => String(v),
    onSelect,
    selectedId = null,
    emptyText = 'No data.',
    valueWidth = 92,
    labelWidth = 128,
}) {
    // Scale bars against the largest absolute value present, so the
    // worst offender always fills the row and the rest read relative to
    // it. Recomputed per render because the feed changes every poll.
    const max = useMemo(() => {
        let m = 0;
        for (const r of rows) {
            const v = Math.abs(Number(r.value) || 0);
            if (v > m) m = v;
        }
        return m || 1;
    }, [rows]);

    if (!rows.length) {
        return (
            <Typography sx={{ fontSize: 14, color: TEXT.faint, px: 1, py: 2 }}>
                {emptyText}
            </Typography>
        );
    }

    return (
        <Stack spacing={0.4} sx={{ px: 0.25 }}>
            {rows.map((r) => {
                const v = Number(r.value) || 0;
                const neg = v < 0;
                const pct = Math.min(100, (Math.abs(v) / max) * 100);
                const color = diverging ? (neg ? NEG : POS) : NEUTRAL;
                const active = selectedId != null && selectedId === r.id;

                return (
                    <Tooltip
                        key={r.id}
                        title={r.tooltip || `${r.label}${r.sublabel ? ` · ${r.sublabel}` : ''} — ${format(v)}`}
                        disableInteractive
                        placement="left"
                    >
                        <Stack
                            direction="row" spacing={1}
                            onClick={() => onSelect && onSelect(r)}
                            role={onSelect ? 'button' : undefined}
                            tabIndex={onSelect ? 0 : undefined}
                            onKeyDown={(e) => {
                                if (onSelect && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onSelect(r); }
                            }}
                            sx={{
                                alignItems: 'center', py: 0.8, px: 0.75, borderRadius: 1,
                                cursor: onSelect ? 'pointer' : 'default',
                                bgcolor: active ? 'rgba(122,162,247,0.18)' : 'transparent',
                                transition: 'background-color 140ms',
                                '&:hover': onSelect ? { bgcolor: active ? 'rgba(122,162,247,0.24)' : 'rgba(255,255,255,0.05)' } : undefined,
                                '&:focus-visible': { outline: '2px solid #7aa2f7', outlineOffset: -2 },
                            }}
                        >
                            {/* Label */}
                            <Box sx={{ width: labelWidth, flexShrink: 0, minWidth: 0 }}>
                                <Typography sx={{
                                    fontSize: 14, fontWeight: 700, color: TEXT.primary,
                                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', lineHeight: 1.3,
                                }}>
                                    {r.label}
                                </Typography>
                                {r.sublabel && (
                                    <Typography sx={{
                                        fontSize: 12, color: TEXT.faint, lineHeight: 1.3,
                                        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                                    }}>
                                        {r.sublabel}
                                    </Typography>
                                )}
                            </Box>

                            {/* Bar — split gutter when diverging so zero is a
                                fixed axis down the middle of the column. */}
                            {diverging ? (
                                <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', minWidth: 40 }}>
                                    <Box sx={{ flex: 1, display: 'flex', justifyContent: 'flex-end' }}>
                                        {neg && <Box sx={{ width: `${pct}%`, height: 10, bgcolor: color, borderRadius: '3px 0 0 3px' }} />}
                                    </Box>
                                    <Box sx={{ width: '1px', height: 14, bgcolor: 'rgba(255,255,255,0.18)', flexShrink: 0 }} />
                                    <Box sx={{ flex: 1 }}>
                                        {!neg && <Box sx={{ width: `${pct}%`, height: 10, bgcolor: color, borderRadius: '0 3px 3px 0' }} />}
                                    </Box>
                                </Box>
                            ) : (
                                <Box sx={{ flex: 1, minWidth: 40 }}>
                                    <Box sx={{ width: `${pct}%`, height: 10, bgcolor: color, borderRadius: 3 }} />
                                </Box>
                            )}

                            {/* Value */}
                            <Typography sx={{
                                width: valueWidth, flexShrink: 0, textAlign: 'right',
                                fontSize: 16, fontWeight: 800,
                                color: diverging ? color : TEXT.primary,
                                fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap',
                            }}>
                                {format(v)}
                            </Typography>
                        </Stack>
                    </Tooltip>
                );
            })}
        </Stack>
    );
}
