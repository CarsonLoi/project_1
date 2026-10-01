// TimelineControl (pricing) — gaming-day hour timeline + play/scrub
// =================================================================
//
// Cloned from the scheduling TimelineControl. The pricing module runs on a
// 07:00 → 06:00 day — the SAME cycle as the scheduling (spread) plan — so
// the scheduled-open hours line up. Ticks start at 07:00 and Reset returns
// to 07:00.
//
// Props:
//   currentHour      — number 0..23
//   onCurrentHour    — (hour: number) => void
//   playing          — boolean
//   onPlaying        — (next: boolean) => void
//   tickMs           — interval between auto-advances (default 1000)
//   colorAtHour(h)   — optional, (h) => color string for the tick-fill hint

import React, { useEffect, useRef } from 'react';
import { Box, Stack, IconButton, Typography } from '@mui/material';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import PauseIcon from '@mui/icons-material/Pause';
import ReplayIcon from '@mui/icons-material/Replay';
import { PRICING_FONTS } from '../constants/fontSizes';

// Pricing day: 07:00 → 06:00 (matches the scheduling spread cycle).
const GAMING_HOURS = [7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 0, 1, 2, 3, 4, 5, 6];

export default function TimelineControl({
    currentHour,
    onCurrentHour,
    playing,
    onPlaying,
    tickMs = 1000,
    colorAtHour,
    coreHours = null,   // Auto-plan core hours: marked; other hours copy the core hour before them
    coreOf = null,
}) {
    const timerRef = useRef(null);
    useEffect(() => {
        if (!playing) {
            if (timerRef.current) clearInterval(timerRef.current);
            timerRef.current = null;
            return undefined;
        }
        timerRef.current = setInterval(() => {
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
            spacing={1}
            sx={{
                alignItems: 'center',
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
                sx={{ color: '#0a1a2c', bgcolor: '#7adfff', width: 32, height: 32, '&:hover': { bgcolor: '#a0e8ff' } }}
            >
                {playing ? <PauseIcon sx={{ fontSize: 18 }} /> : <PlayArrowIcon sx={{ fontSize: 18 }} />}
            </IconButton>
            <IconButton
                size="small"
                onClick={reset}
                sx={{ color: 'rgba(255,255,255,0.7)', border: '1px solid rgba(255,255,255,0.15)', width: 32, height: 32, '&:hover': { color: '#fff', borderColor: 'rgba(122,223,255,0.5)' } }}
                title="Reset to 07:00"
            >
                <ReplayIcon sx={{ fontSize: 16 }} />
            </IconButton>

            <Typography sx={{ color: '#7adfff', fontSize: PRICING_FONTS.timeline.hour, fontWeight: 800, lineHeight: 1, minWidth: 56, textAlign: 'center', fontVariantNumeric: 'tabular-nums' }}>
                {String(currentHour).padStart(2, '0')}:00
            </Typography>

            {/* Tick row — one cell per gaming hour, the hour labelled inside
                each box; click to scrub. */}
            <Stack direction="row" spacing={0.3} sx={{ flex: 1, minWidth: 0 }}>
                {GAMING_HOURS.map((h) => {
                    const active = h === currentHour;
                    const isCore = coreHours ? coreHours.includes(h) : false;
                    const copies = coreHours && coreOf && !isCore ? coreOf(h) : null;
                    // No period fill — only the SELECTED hour is highlighted.
                    const tint = active ? '#7adfff' : (colorAtHour ? colorAtHour(h) : 'rgba(255,255,255,0.05)');
                    return (
                        <Box
                            key={h}
                            onClick={() => { onPlaying(false); onCurrentHour(h); }}
                            sx={{
                                flex: 1, minWidth: 18, height: 26, cursor: 'pointer', position: 'relative',
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                bgcolor: tint,
                                border: active ? '2px solid #7adfff' : '1px solid rgba(255,255,255,0.08)',
                                borderRadius: 0.4,
                                transition: 'transform 120ms, border-color 120ms',
                                '&:hover': active ? undefined : { transform: 'translateY(-1px)', bgcolor: 'rgba(122,223,255,0.12)' },
                            }}
                            title={isCore ? `${String(h).padStart(2, '0')}:00 · core hour` : copies != null ? `${String(h).padStart(2, '0')}:00 · copies ${String(copies).padStart(2, '0')}:00` : `${String(h).padStart(2, '0')}:00`}
                            aria-label={isCore ? `${String(h).padStart(2, '0')}:00, core hour` : `${String(h).padStart(2, '0')}:00`}
                        >
                            {isCore ? <Box aria-hidden="true" sx={{ position: 'absolute', left: 3, right: 3, bottom: 2, height: 2, borderRadius: 1, bgcolor: active ? '#06182a' : '#7adfff' }} /> : null}
                            <Typography sx={{
                                fontSize: PRICING_FONTS.timeline.tick, fontWeight: active || isCore ? 800 : 600, lineHeight: 1,
                                color: active ? '#06182a' : 'rgba(255,255,255,0.85)',
                                textShadow: active ? 'none' : '0 1px 2px rgba(0,0,0,0.6)',
                                fontVariantNumeric: 'tabular-nums', userSelect: 'none',
                            }}>
                                {String(h).padStart(2, '0')}
                            </Typography>
                        </Box>
                    );
                })}
            </Stack>
        </Stack>
    );
}

export { GAMING_HOURS };
