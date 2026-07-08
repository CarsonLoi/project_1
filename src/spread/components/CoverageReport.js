// CoverageReport
// ===============
//
// 24 bars — one per gaming hour. Each bar's height is the count of
// tables open at that hour under the active version. Gap hours
// (totals[h] === 0) get a dimmed track + a red caution marker so the
// floor manager spots holes immediately.
//
// Optional second row: total open-hours = Σ totals across 24, plus a
// peak hour callout.

import React, { useMemo } from 'react';
import { Box, Stack, Typography } from '@mui/material';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import { computeCoverage } from '../utils/coverageAnalysis';

// Scheduling-day hour order — starts at 07:00, wraps past midnight to
// 06:00 (the spread planning cycle; distinct from the Performance
// dashboards' 06:00-start gaming day).
const HOUR_ORDER = [7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 0, 1, 2, 3, 4, 5, 6];

export default function CoverageReport({ assignments, shifts, tables, lowThreshold = 1 }) {
    const { totals, gaps, peakHour, peakValue } = useMemo(
        () => computeCoverage(assignments, shifts, tables, { lowThreshold }),
        [assignments, shifts, tables, lowThreshold]
    );

    const total = totals.reduce((a, b) => a + b, 0);

    return (
        <Box sx={{
            p: 1.5,
            bgcolor: 'rgba(8, 22, 36, 0.55)',
            borderRadius: 2,
            border: '1px solid rgba(122, 200, 220, 0.12)',
            fontVariantNumeric: 'tabular-nums',
        }}>
            <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1.2 }}>
                <Typography sx={{
                    color: '#7adfff', fontSize: 16, fontWeight: 700,
                    letterSpacing: 1.2, textTransform: 'uppercase',
                }}>
                    Coverage
                </Typography>
                <Box sx={{ flex: 1 }} />
                <Typography sx={{ color: 'rgba(255,255,255,0.55)', fontSize: 13 }}>
                    Σ {total.toLocaleString()} table-hrs · peak {pad(peakHour)} = {peakValue}
                </Typography>
                {gaps.length > 0 && (
                    <Stack direction="row" alignItems="center" spacing={0.4}>
                        <WarningAmberIcon sx={{ color: '#f7768e', fontSize: 16 }} />
                        <Typography sx={{ color: '#f7768e', fontSize: 13, fontWeight: 700 }}>
                            {gaps.length} gap{gaps.length === 1 ? '' : 's'}
                        </Typography>
                    </Stack>
                )}
            </Stack>

            <Stack direction="row" sx={{ alignItems: 'flex-end', gap: 0.4, height: 320 }}>
                {HOUR_ORDER.map((h) => {
                    const v = totals[h];
                    const peak = h === peakHour && peakValue > 0;
                    const gap = v < lowThreshold;
                    const heightPct = peakValue > 0 ? (v / peakValue) * 100 : 0;
                    return (
                        <Stack
                            key={h}
                            direction="column"
                            alignItems="center"
                            sx={{ flex: 1, height: '100%' }}
                            title={`${pad(h)}: ${v} table${v === 1 ? '' : 's'}`}
                        >
                            <Box sx={{
                                flex: 1,
                                width: '100%',
                                display: 'flex',
                                alignItems: 'flex-end',
                            }}>
                                <Box sx={{
                                    width: '100%',
                                    height: `${heightPct}%`,
                                    bgcolor: gap ? 'rgba(247,118,142,0.18)' :
                                             peak ? '#7adfff' : 'rgba(122,223,255,0.5)',
                                    borderTop: gap ? '2px solid rgba(247,118,142,0.7)' : 'none',
                                    borderRadius: 0.4,
                                    minHeight: gap ? 2 : 0,
                                    transition: 'height 200ms ease-out',
                                }} />
                            </Box>
                            <Typography sx={{
                                color: gap ? '#f7768e' : 'rgba(255,255,255,0.55)',
                                fontSize: 11, mt: 0.2,
                                fontWeight: peak ? 700 : 400,
                            }}>
                                {pad(h)}
                            </Typography>
                        </Stack>
                    );
                })}
            </Stack>
        </Box>
    );
}

const pad = (h) => String(((Math.round(Number(h)) % 24) + 24) % 24).padStart(2, '0');
