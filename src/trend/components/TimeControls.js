import React from 'react';
import {
  Box,
  IconButton,
  Slider,
  Typography,
  Stack,
  ToggleButton,
  ToggleButtonGroup,
} from '@mui/material';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import PauseIcon from '@mui/icons-material/Pause';
import FastRewindIcon from '@mui/icons-material/FastRewind';
import FastForwardIcon from '@mui/icons-material/FastForward';

const MINUTE_MS = 60 * 1000;

// Renders the FLOOR CLOCK as either:
//   (a) an absolute wall-clock time — when `startMs` is provided, formats
//       (startMs + minute*60s) using the given `tzOffsetMs` (e.g. UTC+8
//       for Macau). All real-data sims supply both, so the clock shows
//       the actual time of each playback minute regardless of the
//       browser's local timezone.
//   (b) a relative `startHour:00 + minute` count — fallback for synthetic
//       simulations that don't carry a real start timestamp.
const fmtClock = (minute, { startHour = 19, startMs = null, tzOffsetMs = 0 } = {}) => {
  if (startMs != null) {
    const d = new Date(startMs + minute * MINUTE_MS + tzOffsetMs);
    const h = String(d.getUTCHours()).padStart(2, '0');
    const m = String(d.getUTCMinutes()).padStart(2, '0');
    return `${h}:${m}`;
  }
  const total = startHour * 60 + minute;
  const h = String(Math.floor(total / 60) % 24).padStart(2, '0');
  const m = String(total % 60).padStart(2, '0');
  return `${h}:${m}`;
};

export default function TimeControls({
  minute,
  minMinute = 0,
  maxMinute,
  playing,
  onPlayPause,
  onStep,
  onSeek,
  speed,
  onSpeedChange,
  startMs = null,
  tzOffsetMs = 0,
  startHour = 19,
}) {
  return (
    <Box
      sx={{
        bgcolor: 'rgba(8, 30, 48, 0.7)',
        border: '1px solid rgba(122, 200, 220, 0.18)',
        borderRadius: 2,
        // Taller bar so the bigger transport icons + clock have room.
        px: 2.5,
        py: 2,
        backdropFilter: 'blur(8px)',
      }}
    >
      <Stack direction="row" spacing={2.5} alignItems="center">
        <Stack direction="row" spacing={0.8} alignItems="center">
          <IconButton onClick={() => onStep(-1)} sx={iconBtn}>
            <FastRewindIcon sx={{ fontSize: 36 }} />
          </IconButton>
          <IconButton onClick={onPlayPause} sx={{ ...iconBtn, color: '#7adfff' }}>
            {playing
              ? <PauseIcon sx={{ fontSize: 44 }} />
              : <PlayArrowIcon sx={{ fontSize: 44 }} />}
          </IconButton>
          <IconButton onClick={() => onStep(1)} sx={iconBtn}>
            <FastForwardIcon sx={{ fontSize: 36 }} />
          </IconButton>
        </Stack>

        <Box sx={{ minWidth: 120, textAlign: 'center' }}>
          <Typography
            variant="caption"
            sx={{
              color: 'rgba(255,255,255,0.55)',
              display: 'block',
              lineHeight: 1,
              fontSize: 18,
              letterSpacing: 1.2,
              fontWeight: 700,
            }}
          >
            TIME
          </Typography>
          <Typography
            sx={{
              fontFamily: 'monospace',
              fontSize: 44,
              fontWeight: 700,
              color: '#7adfff',
              letterSpacing: 1,
              lineHeight: 1.15,
            }}
          >
            {fmtClock(minute, { startHour, startMs, tzOffsetMs })}
          </Typography>
        </Box>

        <Box sx={{ flex: 1, px: 1 }}>
          <Slider
            value={minute}
            min={minMinute}
            max={maxMinute - 1}
            onChange={(_, v) => onSeek(v)}
            size="small"
            sx={{
              color: '#7adfff',
              '& .MuiSlider-thumb': {
                width: 18,
                height: 18,
                boxShadow: '0 0 10px rgba(122, 223, 255, 0.7)',
              },
              '& .MuiSlider-rail': { opacity: 0.25, color: '#7adfff' },
              '& .MuiSlider-track': { border: 'none', height: 5 },
              '& .MuiSlider-rail': { height: 5, opacity: 0.25, color: '#7adfff' },
            }}
          />
          <Box sx={{ display: 'flex', justifyContent: 'space-between', mt: -0.5 }}>
            <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.45)', fontSize: 16 }}>
              t = {minute - minMinute} / {maxMinute - 1 - minMinute} min
            </Typography>
          </Box>
        </Box>

        <ToggleButtonGroup
          value={speed}
          exclusive
          onChange={(_, v) => v && onSpeedChange(v)}
          size="small"
          sx={{
            '& .MuiToggleButton-root': {
              color: 'rgba(255,255,255,0.55)',
              borderColor: 'rgba(122, 200, 220, 0.2)',
              px: 1.6,
              py: 0.5,
              fontSize: 21,
              fontWeight: 700,
            },
            '& .Mui-selected': {
              color: '#7adfff !important',
              borderColor: '#7adfff !important',
              bgcolor: 'rgba(122, 223, 255, 0.08) !important',
            },
          }}
        >
          <ToggleButton value={0.5}>0.5×</ToggleButton>
          <ToggleButton value={1}>1×</ToggleButton>
          <ToggleButton value={2}>2×</ToggleButton>
          <ToggleButton value={4}>4×</ToggleButton>
          <ToggleButton value={8}>8×</ToggleButton>
        </ToggleButtonGroup>
      </Stack>
    </Box>
  );
}

const iconBtn = {
  color: 'rgba(255,255,255,0.7)',
  p: 1,
  '&:hover': { color: '#7adfff', bgcolor: 'rgba(122, 223, 255, 0.1)' },
};
