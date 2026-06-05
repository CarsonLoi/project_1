// Modal that explains how the dashboard detects "hot" baccarat trends.
// Opened by the info icon in the gaming-date bar.

import React from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Box,
  Typography,
  Stack,
} from '@mui/material';
import { buildRoadGrid } from '../utils/roadmaps';

// Render a mini Big Road preview for an example shoe history.
function MiniRoad({ history, cellSize = 18 }) {
  const items = history.split('').map((s) => ({ symbol: s }));
  const { positions, maxCol } = buildRoadGrid(items, 6);
  const cols = Math.max(maxCol + 1, 6);
  const w = cols * cellSize;
  const h = 6 * cellSize;
  return (
    <svg
      width={w}
      height={h}
      style={{
        background: '#0f1923',
        border: '1px solid rgba(255,255,255,0.2)',
        borderRadius: 4,
        display: 'block',
      }}
    >
      {[...Array(6).keys()].slice(1).map((r) => (
        <line
          key={`r${r}`}
          x1="0"
          y1={r * cellSize}
          x2={w}
          y2={r * cellSize}
          stroke="rgba(255,255,255,0.06)"
        />
      ))}
      {[...Array(cols).keys()].slice(1).map((c) => (
        <line
          key={`c${c}`}
          x1={c * cellSize}
          y1="0"
          x2={c * cellSize}
          y2={h}
          stroke="rgba(255,255,255,0.06)"
        />
      ))}
      {positions.map((p, i) => {
        const cx = p.col * cellSize + cellSize / 2;
        const cy = p.row * cellSize + cellSize / 2;
        const stroke = p.symbol === 'B' ? '#ff2d2d' : '#3b6c9e';
        return (
          <circle
            key={i}
            cx={cx}
            cy={cy}
            r={cellSize * 0.36}
            fill="none"
            stroke={stroke}
            strokeWidth="2"
          />
        );
      })}
    </svg>
  );
}

const SHAPES = [
  {
    name: 'Banker streak',
    motif: 'B',
    history: 'BBBBBBB',
    p: 1,
    L: 7,
    note: 'Same result repeats — the simplest trend.',
  },
  {
    name: 'Player streak',
    motif: 'P',
    history: 'PPPPPP',
    p: 1,
    L: 6,
    note: 'Mirror of the Banker streak.',
  },
  {
    name: 'Single chop',
    motif: 'BP',
    history: 'BPBPBPBP',
    p: 2,
    L: 8,
    note: 'Alternates every hand. Period = 2, length = motif × repeats.',
  },
  {
    name: '2-2 pattern',
    motif: 'BBPP',
    history: 'BBPPBBPP',
    p: 4,
    L: 8,
    note: 'Two of one side, two of the other, repeating.',
  },
  {
    name: '3-1 pattern',
    motif: 'BBBP',
    history: 'BBBPBBBP',
    p: 4,
    L: 8,
    note: 'Longer run of one side then a single switch.',
  },
];

const HEADER_SX = {
  color: '#7adfff',
  fontWeight: 700,
  letterSpacing: 1.4,
  fontSize: 22,
  mb: 1.2,
  mt: 2,
};

export default function TrendInfoDialog({ open, onClose }) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="md"
      fullWidth
      PaperProps={{
        sx: {
          bgcolor: 'rgba(10, 22, 35, 0.98)',
          border: '1px solid rgba(122, 200, 220, 0.25)',
          backdropFilter: 'blur(8px)',
          color: '#dff5ff',
        },
      }}
    >
      <DialogTitle
        sx={{
          color: '#7adfff',
          fontWeight: 700,
          fontSize: 30,
          letterSpacing: 1.2,
          borderBottom: '1px solid rgba(122,200,220,0.2)',
        }}
      >
        How Hot Trends Are Detected
      </DialogTitle>

      <DialogContent sx={{ pt: 2 }}>
        <Typography sx={{ fontSize: 19, mt: 2, lineHeight: 1.5 }}>
          A baccarat trend is a <b>repeating shape</b> in the most recent
          stretch of <b>B</b>anker / <b>P</b>layer results. The dashboard
          scores each table's current shoe by how much of its trailing
          suffix follows a single repeating motif. The longer that
          repetition runs, the higher the <b>Trend Strength</b> score —
          and the more visibly the table is highlighted on the floor.
        </Typography>

        <Typography sx={HEADER_SX}>Trend shapes</Typography>
        <Typography sx={{ fontSize: 17, mb: 1.5, color: 'rgba(255,255,255,0.7)' }}>
          The same algorithm recognises any number of shapes — these are
          the most common ones, with mini Big-Road previews:
        </Typography>
        <Stack spacing={1.5}>
          {SHAPES.map((s) => (
            <Box
              key={s.name}
              sx={{
                display: 'grid',
                gridTemplateColumns: '180px 1fr 110px',
                gap: 2,
                alignItems: 'center',
                py: 1,
                borderTop: '1px solid rgba(255,255,255,0.06)',
              }}
            >
              <Box>
                <Typography sx={{ fontSize: 20, fontWeight: 700, color: '#dff5ff' }}>
                  {s.name}
                </Typography>
                <Typography
                  sx={{
                    fontSize: 16,
                    color: 'rgba(255,255,255,0.55)',
                    mt: 0.3,
                  }}
                >
                  motif{' '}
                  <span style={{ fontFamily: 'monospace', color: '#ffd27a' }}>
                    {s.motif}
                  </span>
                </Typography>
                <Typography sx={{ fontSize: 15, color: 'rgba(255,255,255,0.5)', mt: 0.5 }}>
                  {s.note}
                </Typography>
              </Box>
              <MiniRoad history={s.history} />
              <Box>
                <Typography sx={{ fontSize: 15, color: 'rgba(255,255,255,0.55)' }}>
                  period <span style={{ color: '#dff5ff', fontWeight: 700 }}>{s.p}</span>
                </Typography>
                <Typography sx={{ fontSize: 15, color: 'rgba(255,255,255,0.55)' }}>
                  length <span style={{ color: '#dff5ff', fontWeight: 700 }}>{s.L}</span>
                </Typography>
                <Typography sx={{ fontSize: 18, color: '#ff6b1a', fontWeight: 800, mt: 0.4 }}>
                  score = {s.L - s.p}
                </Typography>
              </Box>
            </Box>
          ))}
        </Stack>

        <Typography sx={HEADER_SX}>How the score is calculated</Typography>
        <Typography sx={{ fontSize: 18, lineHeight: 1.55 }}>
          The detector — an <b>anchored Dominant Trailing Pattern</b> scan
          — walks back from the most recent hand looking for the longest
          suffix that matches itself when shifted by some period{' '}
          <code style={{ color: '#ffd27a' }}>p</code> (1 ≤ p ≤ 5). Once it
          finds the longest matching suffix of length{' '}
          <code style={{ color: '#ffd27a' }}>L</code>, it computes:
        </Typography>
        <Box
          sx={{
            mt: 1.2,
            mb: 1.2,
            p: 2,
            bgcolor: 'rgba(122,200,220,0.06)',
            border: '1px solid rgba(122,200,220,0.2)',
            borderRadius: 1,
            fontFamily: 'monospace',
            fontSize: 22,
            color: '#7adfff',
            textAlign: 'center',
            letterSpacing: 1.2,
          }}
        >
          score = L − p
        </Box>
        <Typography sx={{ fontSize: 17, lineHeight: 1.6, color: 'rgba(255,255,255,0.75)' }}>
          That subtraction gives credit only for <i>repetitions beyond the
          first motif</i>. A single appearance of any motif (L = p) scores
          0; each additional repeat adds <code>p</code> to the score. So a
          shoe with seven Banker hands in a row (motif <code>B</code>,
          p = 1, L = 7) scores <b>6</b>; a 2-2 pattern that has just
          completed three full repeats (motif <code>BBPP</code>, p = 4,
          L = 12) scores <b>8</b>.
        </Typography>

        <Typography sx={HEADER_SX}>Hot threshold</Typography>
        <Typography sx={{ fontSize: 17, lineHeight: 1.6, color: 'rgba(255,255,255,0.75)' }}>
          The dashboard labels a table <span style={{ color: '#ff6b1a', fontWeight: 700 }}>HOT</span> when
          its score is ≥ 5, and shows a <span style={{ color: '#7aaedf', fontWeight: 700 }}>COOL</span> badge
          when a streak just broke. The threshold for the ripple overlay
          is independently adjustable in the gaming-date bar — default 7,
          which captures only the strongest trends on the floor.
        </Typography>
      </DialogContent>

      <DialogActions sx={{ borderTop: '1px solid rgba(122,200,220,0.2)', px: 3, py: 1.5 }}>
        <Button
          onClick={onClose}
          variant="contained"
          sx={{
            bgcolor: '#7adfff',
            color: '#0a1a2c',
            fontWeight: 700,
            fontSize: 18,
            px: 3,
            '&:hover': { bgcolor: '#a0e8ff' },
          }}
        >
          Got it
        </Button>
      </DialogActions>
    </Dialog>
  );
}
