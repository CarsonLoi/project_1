// TimelineControl — gaming-day hour timeline + play/pause/scrub
// ==============================================================
//
// 24 ticks starting at 06:00 (gaming-day convention — same order the
// Performance Heatmap's hourly timeline uses). Hovering / clicking a
// tick sets the hour; the Play button auto-advances at 1000ms per
// hour (configurable via `tickMs` prop).
//
// Props:
//   currentHour      — number 0..23
//   onCurrentHour    — (hour: number) => void
//   playing          — boolean
//   onPlaying        — (next: boolean) => void
//   tickMs           — interval between auto-advances (default 1000)
//   colorAtHour(h)   — optional, (h) => 'green' | 'gray' — for the
//                      tick-fill preview; falls through to a neutral
//                      cyan tint when not provided.

import React, { useEffect, useRef } from 'react';
import { Box, Stack, IconButton, Typography } from '@mui/material';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import PauseIcon from '@mui/icons-material/Pause';
import ReplayIcon from '@mui/icons-material/Replay';

// Scheduling day starts at 07:00 and wraps past midnight to 06:00.
// (Deliberately different from the Performance dashboards, which use a
// 06:00-start gaming day — spread PLANNING runs on a 07→06 cycle.)
const GAMING_HOURS = [7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 0, 1, 2, 3, 4, 5, 6];

export default function TimelineControl({
    currentHour,
    onCurrentHour,
    playing,
    onPlaying,
    tickMs = 1000,
    colorAtHour,
}) {
    // Auto-advance interval. Owned by an effect so it cleans up
    // automatically on unmount / when `playing` flips off.
    const timerRef = useRef(null);
    useEffect(() => {
        if (!playing) {
            if (timerRef.current) clearInterval(timerRef.current);
            timerRef.current = null;
            return undefined;
        }
        timerRef.current = setInterval(() => {
            // Advance through the gaming-hour order, not raw 0..23, so
            // the playback feels chronological (06→07→…→05→stop).
            const idx = GAMING_HOURS.indexOf(currentHour);
            if (idx < 0 || idx === GAMING_HOURS.length - 1) {
                onPlaying(false); // reached 05:00 — stop at the end
                return;
            }
            onCurrentHour(GAMING_HOURS[idx + 1]);
        }, tickMs);
        return () => {
            if (timerRef.current) clearInterval(timerRef.current);
            timerRef.current = null;
        };
    }, [playing, currentHour, onCurrentHour, onPlaying, tickMs]);

    const reset = () => {
        onPlaying(false);
        onCurrentHour(7);
    };

    return (
        <Stack
            direction="row"
            alignItems="center"
            spacing={1}
            sx={{
                px: 1.2,
                py: 0.8,
                bgcolor: 'rgba(10, 22, 35, 0.85)',
                border: '1px solid rgba(122, 200, 220, 0.18)',
                borderRadius: 1.2,
                backdropFilter: 'blur(8px)',
            }}
        >
            <IconButton
                size="small"
                onClick={() => onPlaying(!playing)}
                sx={{
                    color: '#0a1a2c',
                    bgcolor: '#7adfff',
                    width: 32, height: 32,
                    '&:hover': { bgcolor: '#a0e8ff' },
                }}
            >
                {playing ? <PauseIcon sx={{ fontSize: 18 }} /> : <PlayArrowIcon sx={{ fontSize: 18 }} />}
            </IconButton>
            <IconButton
                size="small"
                onClick={reset}
                sx={{
                    color: 'rgba(255,255,255,0.7)',
                    border: '1px solid rgba(255,255,255,0.15)',
                    width: 32, height: 32,
                    '&:hover': { color: '#fff', borderColor: 'rgba(122,223,255,0.5)' },
                }}
                title="Reset to 06:00"
            >
                <ReplayIcon sx={{ fontSize: 16 }} />
            </IconButton>

            <Typography sx={{
                color: '#7adfff', fontSize: 16, fontWeight: 800,
                minWidth: 56, textAlign: 'center',
                fontVariantNumeric: 'tabular-nums',
            }}>
                {String(currentHour).padStart(2, '0')}:00
            </Typography>

            {/* Tick row — one cell per gaming hour, color hints the
                aggregate state (e.g. green if at least one table is
                open at that hour). Click any cell to scrub. */}
            <Stack direction="row" spacing={0.3} sx={{ flex: 1, minWidth: 0 }}>
                {GAMING_HOURS.map((h) => {
                    const active = h === currentHour;
                    const tint = colorAtHour ? colorAtHour(h) : 'rgba(122,223,255,0.18)';
                    return (
                        <Box
                            key={h}
                            onClick={() => { onPlaying(false); onCurrentHour(h); }}
                            sx={{
                                flex: 1,
                                minWidth: 6,
                                height: 22,
                                cursor: 'pointer',
                                bgcolor: tint,
                                border: active ? '2px solid #7adfff' : '1px solid rgba(255,255,255,0.05)',
                                borderRadius: 0.4,
                                transition: 'transform 120ms, border-color 120ms',
                                '&:hover': { transform: 'translateY(-1px)' },
                            }}
                            title={`${String(h).padStart(2, '0')}:00`}
                        />
                    );
                })}
            </Stack>
        </Stack>
    );
}

export { GAMING_HOURS };
