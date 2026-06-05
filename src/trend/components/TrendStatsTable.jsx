// Compact stats table — overlays the bottom-right corner of the casino
// floor. Two views, toggled in the header:
//
//   • "By Strength"  — buckets every open table by trend-strength score
//                      (0, 1-2, 3-4, 5-6, 7+).
//   • "By Hot Zone"  — classifies tables relative to the user's ripple
//                      settings:
//        Hot     : surprise >= rippleThreshold
//        Nearby  : within `rippleSize` distance of any Hot table
//                  (same radius the ripple overlay draws)
//        Other   : everything else that's open
//
// Both views report the same three columns: Tables, Avg HC, Avg Bet.
// Updates live as the user scrubs / plays the simulation.

import React, { useMemo, useState } from 'react';
import { Box, Typography, ToggleButtonGroup, ToggleButton } from '@mui/material';
import { FLOOR_WIDTH, FLOOR_HEIGHT } from '../utils/floorLayout';

const BUCKETS = [
  { label: '0',   match: (s) => s === 0,             color: '#2f7a82' },
  { label: '1-2', match: (s) => s >= 1 && s <= 2,    color: '#5ac8a8' },
  { label: '3-4', match: (s) => s >= 3 && s <= 4,    color: '#f7b500' },
  { label: '5-6', match: (s) => s >= 5 && s <= 6,    color: '#ff6b1a' },
  { label: '7+',  match: (s) => s >= 7,              color: '#ff2d2d' },
];

const SEATS_PER_TABLE = 7;

function summarize(arr, label, color) {
  const n = arr.length;
  // Single pass over the bucket — accumulate headcount, bet, and the
  // idle count (headcount === 0) in one sweep so the row's stats stay
  // consistent and we don't iterate the same array three times.
  let hc = 0;
  let bet = 0;
  let idle = 0;
  for (const p of arr) {
    hc += p.headcount || 0;
    bet += p.avgBet || 0;
    if ((p.headcount || 0) === 0) idle += 1;
  }
  return {
    label,
    color,
    tables: n,
    occupancy: n > 0 ? hc / n / SEATS_PER_TABLE : 0,
    avgHc: n > 0 ? hc / n : 0,
    avgBet: n > 0 ? bet / n : 0,
    // Idle = no patrons seated. Share within the bucket — `idlePct`
    // gives "what fraction of this row's tables are sitting empty",
    // which is the natural denominator when the user is comparing
    // hot vs. nearby vs. cold rows. Guard against /0.
    idle,
    idlePct: n > 0 ? idle / n : 0,
  };
}

// Trend strength used for both "By Strength" bucketing and the
// "Hot ≥ threshold" / Nearby classification below is sourced from
// `priorSurprise` — the trend a WALK-UP patron would have seen on the
// bead plate BEFORE the current hand was dealt (captured by
// transformWalkerHands in trendDataSource.js, mirrored in the synthetic
// generateTimeSeries fallback). This keeps the table answering
// "did a strong visible trend attract patrons?" instead of
// "what's the post-hoc latest-state trend?", which would be a
// look-ahead view that no patron actually saw. Falls back to the
// latest-state `surprise` if a frame predates the prior-12 fields
// (e.g. older cached frames still in memory after a hot-reload).
const visibleStrength = (p) =>
  p.priorSurprise != null ? p.priorSurprise : p.surprise;

function computeStrengthStats(frame) {
  if (!frame || !frame.perTable) return [];
  const groups = BUCKETS.map(() => []);
  for (const p of frame.perTable) {
    if (p.closed) continue;
    const i = BUCKETS.findIndex((b) => b.match(visibleStrength(p)));
    if (i < 0) continue;
    groups[i].push(p);
  }
  return BUCKETS.map((b, i) => summarize(groups[i], b.label, b.color));
}

// Hot/Nearby/Other classification.
//
// "Nearby" must visually match the ripple circle the user sees on the
// floor. The ripple is drawn at `rippleSize` *pixels*, but the chart's
// pixel-to-data ratio differs by axis (data range is square at
// FLOOR_WIDTH × FLOOR_HEIGHT, the canvas is not). So we convert each
// table's data position to pixel space using the chart's current size,
// then measure straight-line pixel distance.
//
// If chartPx hasn't been reported yet, we fall back to assuming the
// chart is square and equal to the floor data range — same result as
// using rippleSize directly in data units.
function computeHotZoneStats(frame, rippleThreshold, rippleSize, chartPx) {
  if (!frame || !frame.perTable) return [];
  const open = frame.perTable.filter((p) => !p.closed);
  const hotSet = new Set();
  const hot = [];
  for (const p of open) {
    // Uses prior-12 strength (see visibleStrength above) so "hot"
    // reflects what attracted patrons, not the post-current-hand state.
    if (visibleStrength(p) >= rippleThreshold) {
      hot.push(p);
      hotSet.add(p.tableId);
    }
  }

  const sx = chartPx && chartPx.width  > 0 ? chartPx.width  / FLOOR_WIDTH  : 1;
  const sy = chartPx && chartPx.height > 0 ? chartPx.height / FLOOR_HEIGHT : 1;
  const r2 = rippleSize * rippleSize;

  const nearby = [];
  const other = [];
  for (const p of open) {
    // Hot tables are reported in their own bucket — never count them
    // as Nearby (defensive: tableId check on top of strength check).
    if (visibleStrength(p) >= rippleThreshold) continue;
    if (hotSet.has(p.tableId)) continue;

    let isNearby = false;
    for (const h of hot) {
      if (h.tableId === p.tableId) continue;
      const dx = ((p.x ?? 0) - (h.x ?? 0)) * sx;
      const dy = ((p.y ?? 0) - (h.y ?? 0)) * sy;
      // Strict `<` so a table sitting exactly on the ripple edge is
      // not pulled in — matches "visually inside the circle".
      if (dx * dx + dy * dy < r2) {
        isNearby = true;
        break;
      }
    }
    if (isNearby) nearby.push(p);
    else other.push(p);
  }

  return [
    summarize(hot,    'Hot',    '#ff2d2d'),
    summarize(nearby, 'Nearby', '#ff6b1a'),
    summarize(other,  'Other',  '#5ac8a8'),
  ];
}

const fmtMoney = (v) => `$${Math.round(v).toLocaleString()}`;

export default function TrendStatsTable({
  frame,
  rippleThreshold = 7,
  rippleSize = 50,
  chartPx = null,
}) {
  const [view, setView] = useState('strength'); // 'strength' | 'zone'

  const rows = useMemo(() => {
    if (view === 'zone') {
      return computeHotZoneStats(frame, rippleThreshold, rippleSize, chartPx);
    }
    return computeStrengthStats(frame);
  }, [view, frame, rippleThreshold, rippleSize, chartPx]);

  if (rows.length === 0) return null;

  // In strength view we render hottest → coldest so the eye lands on
  // the strongest trends first. Zone view is already ordered Hot →
  // Nearby → Other from the producer.
  const displayed = view === 'strength' ? rows.slice().reverse() : rows;

  const firstColLabel = view === 'strength' ? 'Trend' : 'Zone';
  const firstColWidth = view === 'strength' ? '90px' : '120px';

  return (
    <Box
      sx={{
        position: 'absolute',
        right: 16,
        bottom: 16,
        zIndex: 18,
        bgcolor: 'rgba(8, 22, 36, 0.88)',
        border: '1px solid rgba(122, 200, 220, 0.3)',
        borderRadius: 1.5,
        backdropFilter: 'blur(8px)',
        boxShadow: '0 8px 28px rgba(0,0,0,0.45)',
        px: 2.5,
        py: 2,
        // Bumped from 620 → 780 to accommodate the two Idle columns
        // (Idle count + Idle %) without crushing column widths.
        minWidth: 780,
      }}
    >
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          mb: 1.5,
          gap: 2,
        }}
      >
        <Typography
          variant="overline"
          sx={{
            color: '#7adfff',
            fontWeight: 700,
            letterSpacing: 1.5,
            fontSize: 27,
            lineHeight: 1.2,
          }}
        >
          {view === 'strength' ? 'Tables by Trend Strength' : 'Tables by Hot Zone'}
        </Typography>
        <ToggleButtonGroup
          value={view}
          exclusive
          size="small"
          onChange={(_, v) => v && setView(v)}
          sx={{
            '& .MuiToggleButton-root': {
              color: 'rgba(255,255,255,0.55)',
              borderColor: 'rgba(122,200,220,0.3)',
              fontSize: 15,
              fontWeight: 700,
              letterSpacing: 0.8,
              px: 1.4,
              py: 0.3,
              '&.Mui-selected': {
                color: '#0a1a2c',
                bgcolor: '#7adfff',
                '&:hover': { bgcolor: '#a0e8ff' },
              },
            },
          }}
        >
          <ToggleButton value="strength">By Strength</ToggleButton>
          <ToggleButton value="zone">By Hot Zone</ToggleButton>
        </ToggleButtonGroup>
      </Box>

      {view === 'zone' && (
        <Typography
          sx={{
            color: 'rgba(255,255,255,0.5)',
            fontSize: 16,
            mb: 1,
            lineHeight: 1.35,
          }}
        >
          Hot = strength ≥ {rippleThreshold} · Nearby = within {rippleSize}px of a hot table
        </Typography>
      )}

      <Box
        sx={{
          display: 'grid',
          // Six columns: label + Tables + Idle + Idle % + Avg HC +
          // Avg Bet. Idle pair sits right after Tables so the eye reads
          // "out of N tables, K were empty (P%)" in left-to-right order
          // before moving on to the per-table averages.
          gridTemplateColumns: `${firstColWidth} 1fr 1fr 1fr 1fr 1fr`,
          rowGap: 1.2,
          columnGap: 2,
          alignItems: 'center',
        }}
      >
        {/* Header row */}
        <Cell head>{firstColLabel}</Cell>
        <Cell head>Tables</Cell>
        <Cell head>Idle</Cell>
        <Cell head>Idle %</Cell>
        <Cell head>Avg HC</Cell>
        <Cell head>Avg Bet</Cell>

        {displayed.map((r) => (
          <React.Fragment key={r.label}>
            <Cell
              sx={{
                color: r.color,
                fontWeight: 800,
                fontSize: 27,
                fontFamily: view === 'strength' ? 'monospace' : 'inherit',
              }}
            >
              {r.label}
            </Cell>
            <Cell>{r.tables}</Cell>
            <Cell>{r.idle}</Cell>
            {/* Empty buckets get an em-dash instead of "0%" so the row
                doesn't lie about a denominator that doesn't exist. */}
            <Cell>{r.tables > 0 ? `${Math.round(r.idlePct * 100)}%` : '—'}</Cell>
            <Cell>{r.avgHc.toFixed(2)}</Cell>
            <Cell>{fmtMoney(r.avgBet)}</Cell>
          </React.Fragment>
        ))}
      </Box>
    </Box>
  );
}

function Cell({ head, sx, children }) {
  return (
    <Typography
      sx={{
        color: head ? 'rgba(255,255,255,0.55)' : '#dff5ff',
        fontSize: head ? 21 : 26,
        fontWeight: head ? 700 : 500,
        letterSpacing: head ? 1 : 0.3,
        lineHeight: 1.2,
        ...sx,
      }}
    >
      {children}
    </Typography>
  );
}
