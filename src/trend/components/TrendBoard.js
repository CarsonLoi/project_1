import React, { useMemo } from 'react';
import { Box, Typography, Stack, IconButton, Chip } from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import LocalFireDepartmentIcon from '@mui/icons-material/LocalFireDepartment';
import AcUnitIcon from '@mui/icons-material/AcUnit';
import { buildStreaks, buildRoadGrid, deriveRoadMarks } from '../utils/roadmaps';
import { shapeName } from '../utils/trendAnalyzer';

const COLOR_BANKER = '#ff2d2d';
const COLOR_PLAYER = '#3a8fd1';

function RoadGrid({
  title,
  cn,
  items,
  cellSize = 12,
  rows = 6,
  maxCols = 24,
  markStyle = 'circle',
  mapColor,
}) {
  const grid = useMemo(() => buildRoadGrid(items, rows), [items, rows]);
  const totalCols = Math.max(grid.maxCol + 1, maxCols);
  const startCol = Math.max(0, totalCols - maxCols);
  const visible = grid.positions
    .filter((p) => p.col >= startCol)
    .map((p) => ({ ...p, col: p.col - startCol }));

  const width = maxCols * cellSize;
  const height = rows * cellSize;
  const r = cellSize * 0.36;

  return (
    <Box>
      <Stack direction="row" alignItems="baseline" spacing={1} sx={{ mb: 0.3 }}>
        <Typography
          variant="caption"
          sx={{
            color: '#7adfff',
            fontWeight: 700,
            letterSpacing: 1,
            fontSize: 15,
          }}
        >
          {title}
        </Typography>
        <Typography
          variant="caption"
          sx={{ color: 'rgba(255,255,255,0.4)', fontSize: 15 }}
        >
          {cn}
        </Typography>
        <Box sx={{ flex: 1 }} />
        <Typography
          variant="caption"
          sx={{ color: 'rgba(255,255,255,0.4)', fontSize: 14 }}
        >
          {items.length} marks
        </Typography>
      </Stack>
      <svg
        width={width}
        height={height}
        style={{
          background: 'rgba(0, 0, 0, 0.35)',
          border: '1px solid rgba(122, 200, 220, 0.18)',
          borderRadius: 4,
          display: 'block',
        }}
      >
        {/* Grid lines */}
        {Array.from({ length: maxCols + 1 }).map((_, i) => (
          <line
            key={'v' + i}
            x1={i * cellSize}
            y1={0}
            x2={i * cellSize}
            y2={height}
            stroke="rgba(255,255,255,0.05)"
            strokeWidth="0.5"
          />
        ))}
        {Array.from({ length: rows + 1 }).map((_, i) => (
          <line
            key={'h' + i}
            x1={0}
            y1={i * cellSize}
            x2={width}
            y2={i * cellSize}
            stroke="rgba(255,255,255,0.05)"
            strokeWidth="0.5"
          />
        ))}
        {/* Cells */}
        {visible.map((p, i) => {
          const cx = p.col * cellSize + cellSize / 2;
          const cy = p.row * cellSize + cellSize / 2;
          const color = mapColor(p.symbol);
          if (markStyle === 'circle') {
            return (
              <circle
                key={i}
                cx={cx}
                cy={cy}
                r={r}
                fill={color}
                stroke="rgba(0,0,0,0.4)"
                strokeWidth="0.5"
              />
            );
          }
          if (markStyle === 'ring') {
            return (
              <circle
                key={i}
                cx={cx}
                cy={cy}
                r={r}
                fill="none"
                stroke={color}
                strokeWidth="1.5"
              />
            );
          }
          if (markStyle === 'slash') {
            return (
              <line
                key={i}
                x1={cx - r}
                y1={cy + r}
                x2={cx + r}
                y2={cy - r}
                stroke={color}
                strokeWidth="1.8"
                strokeLinecap="round"
              />
            );
          }
          return null;
        })}
      </svg>
    </Box>
  );
}

export default function TrendBoard({ table, data, onClose }) {
  const hands = (data?.shoeHistory || '').slice(-72);
  const streaks = useMemo(() => buildStreaks(hands), [hands]);
  const bigEye = useMemo(() => deriveRoadMarks(streaks, 1), [streaks]);
  const smallRoad = useMemo(() => deriveRoadMarks(streaks, 2), [streaks]);
  const cockroach = useMemo(() => deriveRoadMarks(streaks, 3), [streaks]);

  if (!table || !data) return null;

  const bigRoadItems = [...hands].map((h) => ({ symbol: h }));
  const hot = data.surprise >= 5;
  const cool = data.broken;
  const bp = bigRoadItems.reduce(
    (acc, x) => {
      if (x.symbol === 'B') acc.b += 1;
      else if (x.symbol === 'P') acc.p += 1;
      return acc;
    },
    { b: 0, p: 0 }
  );

  return (
    <Box
      sx={{
        bgcolor: 'rgba(8, 30, 48, 0.85)',
        border: '1px solid rgba(122, 200, 220, 0.3)',
        borderRadius: 2,
        p: 1.5,
        backdropFilter: 'blur(10px)',
        boxShadow: '0 8px 32px rgba(0, 0, 0, 0.5)',
        height: '100%',
        overflow: 'auto',
        scrollbarWidth: 'none',
        msOverflowStyle: 'none',
        '&::-webkit-scrollbar': { display: 'none' },
      }}
    >
      <Stack
        direction="row"
        justifyContent="space-between"
        alignItems="flex-start"
        sx={{ mb: 1 }}
      >
        <Stack spacing={0.2}>
          <Stack direction="row" spacing={0.8} alignItems="center">
            <Typography
              variant="overline"
              sx={{
                color: '#7adfff',
                fontWeight: 700,
                letterSpacing: 1.5,
                lineHeight: 1,
                fontSize: 21,
              }}
            >
              TREND BOARD · {table.label}
            </Typography>
            {hot && (
              <Chip
                size="small"
                icon={<LocalFireDepartmentIcon sx={{ fontSize: 18 }} />}
                label="HOT"
                sx={{
                  height: 18,
                  fontSize: 14,
                  fontWeight: 700,
                  bgcolor: '#ff2d2d',
                  color: '#fff',
                  '& .MuiChip-icon': { color: '#fff', ml: 0.4 },
                }}
              />
            )}
            {cool && (
              <Chip
                size="small"
                icon={<AcUnitIcon sx={{ fontSize: 18 }} />}
                label="COOL"
                sx={{
                  height: 18,
                  fontSize: 14,
                  fontWeight: 700,
                  bgcolor: '#3b6c9e',
                  color: '#fff',
                  '& .MuiChip-icon': { color: '#fff', ml: 0.4 },
                }}
              />
            )}
          </Stack>
          <Typography
            variant="caption"
            sx={{ color: 'rgba(255,255,255,0.55)', fontSize: 20 }}
          >
            Pit {table.pit} · {data?.min != null ? `$${data.min.toLocaleString()}` : '—'} min · Shoe #{data.shoeId} · Hand{' '}
            {data.shoeHand}
          </Typography>
        </Stack>
        <IconButton
          size="small"
          onClick={onClose}
          sx={{
            color: 'rgba(255,255,255,0.6)',
            '&:hover': { color: '#fff', bgcolor: 'rgba(255,255,255,0.08)' },
          }}
        >
          <CloseIcon fontSize="small" />
        </IconButton>
      </Stack>

      {/* Quick stats */}
      <Stack direction="row" spacing={1} sx={{ mb: 1.2 }}>
        <Stat label="B" value={bp.b} color={COLOR_BANKER} />
        <Stat label="P" value={bp.p} color={COLOR_PLAYER} />
        <Stat label="Headcount" value={`${data.headcount}/7`} color="#7adfff" />
        <Stat
          label="Trend Strength"
          value={`${data.surprise} bits`}
          color={
            data.surprise >= 7
              ? '#ff2d2d'
              : data.surprise >= 5
              ? '#ff6b1a'
              : data.surprise >= 3
              ? '#f7b500'
              : '#5ac8a8'
          }
        />
      </Stack>

      {/* Dominant trend chip */}
      {data.surprise >= 3 && !cool && (
        <Box sx={{ mb: 1.2 }}>
          <Typography
            variant="caption"
            sx={{ color: 'rgba(255,255,255,0.5)', fontSize: 15 }}
          >
            Detected trend:
          </Typography>
          <Box
            sx={{
              mt: 0.3,
              p: 1,
              borderRadius: 1,
              bgcolor: 'rgba(255, 107, 26, 0.08)',
              border: '1px solid rgba(255, 107, 26, 0.3)',
            }}
          >
            <Typography sx={{ color: '#ff6b1a', fontSize: 20, fontWeight: 700 }}>
              {shapeName(data.motif)} ·{' '}
              <span style={{ fontFamily: 'monospace', letterSpacing: 1 }}>
                {data.motif}
              </span>{' '}
              · {data.length} hands ({data.surprise} bits)
            </Typography>
          </Box>
        </Box>
      )}
      {cool && (
        <Box sx={{ mb: 1.2 }}>
          <Box
            sx={{
              p: 1,
              borderRadius: 1,
              bgcolor: 'rgba(59, 108, 158, 0.12)',
              border: '1px solid rgba(59, 108, 158, 0.4)',
            }}
          >
            <Typography sx={{ color: '#7aaedf', fontSize: 20, fontWeight: 700 }}>
              Streak just broke ({data.brokenLength} hands) — cooldown
            </Typography>
          </Box>
        </Box>
      )}

      <Stack spacing={0.8}>
        <RoadGrid
          title="BIG ROAD"
          cn="大路"
          items={bigRoadItems}
          cellSize={13}
          rows={6}
          maxCols={20}
          markStyle="circle"
          mapColor={(s) => (s === 'B' ? COLOR_BANKER : COLOR_PLAYER)}
        />
        <RoadGrid
          title="BIG EYE BOY"
          cn="大眼仔"
          items={bigEye}
          cellSize={9}
          rows={6}
          maxCols={28}
          markStyle="circle"
          mapColor={(s) => (s === 'R' ? COLOR_BANKER : COLOR_PLAYER)}
        />
        <RoadGrid
          title="SMALL ROAD"
          cn="小路"
          items={smallRoad}
          cellSize={9}
          rows={6}
          maxCols={28}
          markStyle="ring"
          mapColor={(s) => (s === 'R' ? COLOR_BANKER : COLOR_PLAYER)}
        />
        <RoadGrid
          title="COCKROACH ROAD"
          cn="曱甴路"
          items={cockroach}
          cellSize={9}
          rows={6}
          maxCols={28}
          markStyle="slash"
          mapColor={(s) => (s === 'R' ? COLOR_BANKER : COLOR_PLAYER)}
        />
      </Stack>
    </Box>
  );
}

function Stat({ label, value, color }) {
  return (
    <Box
      sx={{
        flex: 1,
        bgcolor: 'rgba(0, 0, 0, 0.25)',
        border: '1px solid rgba(122, 200, 220, 0.15)',
        borderRadius: 1,
        py: 0.5,
        px: 0.8,
      }}
    >
      <Typography
        sx={{
          color: 'rgba(255,255,255,0.5)',
          fontSize: 18,
          letterSpacing: 0.5,
          lineHeight: 1,
        }}
      >
        {label}
      </Typography>
      <Typography
        sx={{
          color,
          fontSize: 24,
          fontWeight: 700,
          fontFamily: 'monospace',
          lineHeight: 1.2,
        }}
      >
        {value}
      </Typography>
    </Box>
  );
}
