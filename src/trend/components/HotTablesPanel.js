import React, { useMemo } from 'react';
import {
  Box,
  Typography,
  Stack,
  ButtonBase,
} from '@mui/material';
import LocalFireDepartmentIcon from '@mui/icons-material/LocalFireDepartment';
import BoltIcon from '@mui/icons-material/Bolt';
import TrendingUpIcon from '@mui/icons-material/TrendingUp';
import AcUnitIcon from '@mui/icons-material/AcUnit';
import PersonIcon from '@mui/icons-material/Person';
import { shapeName } from '../utils/trendAnalyzer';

// Compact label for the motif — strips the long-form "pattern" suffix
// so 12 rows fit without wrapping. Used as the secondary descriptor
// under each row's strength bar.
function compactShape(motif) {
  const name = shapeName(motif);
  if (name.endsWith(' streak')) return name.startsWith('B') ? 'Streak B' : 'Streak P';
  if (name === 'Single chop') return 'Chop';
  return name.replace(' pattern', ''); // e.g. "2-2 pattern" → "2-2"
}

// Status accent color. Driven by both the surprise tier and the broken
// flag so the row reads correctly in both states. Paired with an icon
// (see statusIconFor below) so meaning never depends on color alone —
// satisfies the §1 color-not-only accessibility rule.
function colorFor(surprise, broken) {
  if (broken) return '#3b6c9e';
  if (surprise >= 7) return '#ff2d2d';
  if (surprise >= 5) return '#ff6b1a';
  if (surprise >= 3) return '#f7b500';
  return '#5ac8a8';
}

// Status icon per row — pairs with `colorFor` so the same signal is
// carried by both shape and color. Sized at 26px so it reads from
// across the room without crowding the row's data zone.
function StatusIcon({ surprise, broken, color }) {
  const sx = { color, fontSize: 26, filter: `drop-shadow(0 0 6px ${color}55)`, flexShrink: 0 };
  if (broken)        return <AcUnitIcon sx={sx} />;
  if (surprise >= 7) return <LocalFireDepartmentIcon sx={sx} />;
  if (surprise >= 5) return <BoltIcon sx={sx} />;
  return <TrendingUpIcon sx={sx} />;
}

// Composite ranking score:
//   active trends → surprise weighted by crowd presence
//   broken streaks → negative-weighted by streak that just snapped
function hotScore(p) {
  if (p.broken) {
    // Broken streaks are interesting (cooldown signal) but rank below active
    return -1 + p.brokenLength * 0.05;
  }
  return p.surprise + (p.headcount / 7) * 1.5;
}

// Headcount chip — small pill that pairs the number with a person icon
// and tints by crowd density. Lets the eye distinguish "table noticed"
// (HC ≥ 4) from "table empty despite hot trend" (HC 0–1) at a glance,
// which is precisely the operational signal this panel exists to surface.
function HcChip({ headcount }) {
  const filled = Math.max(0, Math.min(7, headcount));
  const ratio = filled / 7;
  // Density → tint. Cool teal at low fill, hot red at near-capacity.
  // Mirrors the heatmap's existing crowd palette so the panel reads
  // consistently with the floor below it.
  const tint =
    ratio >= 0.7 ? 'rgba(255, 45, 45, 0.18)' :
    ratio >= 0.4 ? 'rgba(247, 181, 0, 0.18)' :
    ratio >= 0.15 ? 'rgba(122, 200, 220, 0.14)' :
                   'rgba(255, 255, 255, 0.06)';
  const border =
    ratio >= 0.7 ? 'rgba(255, 45, 45, 0.5)' :
    ratio >= 0.4 ? 'rgba(247, 181, 0, 0.5)' :
    ratio >= 0.15 ? 'rgba(122, 200, 220, 0.35)' :
                   'rgba(255, 255, 255, 0.12)';
  return (
    <Box
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 0.4,
        px: 1,
        py: 0.2,
        borderRadius: 1,
        bgcolor: tint,
        border: `1px solid ${border}`,
        // Tabular figures so the chip width stays stable when HC
        // ticks 0→7 during live updates.
        fontVariantNumeric: 'tabular-nums',
        minWidth: 56,
        justifyContent: 'center',
      }}
    >
      <PersonIcon sx={{ fontSize: 17, color: 'rgba(255,255,255,0.7)' }} />
      <Typography
        sx={{
          fontSize: 19,
          fontWeight: 700,
          color: '#fff',
          lineHeight: 1,
        }}
      >
        {filled}
      </Typography>
    </Box>
  );
}

export default function HotTablesPanel({
  frame,
  tables,
  onTableSelect,
  selectedTableId,
}) {
  const rows = useMemo(() => {
    if (!frame) return [];
    const tableMap = new Map(tables.map((t) => [t.id, t]));
    return frame.perTable
      .map((p) => ({ ...p, ...tableMap.get(p.tableId), score: hotScore(p) }))
      .filter((p) => p.surprise >= 3 || p.broken)
      .sort((a, b) => b.score - a.score)
      .slice(0, 12);
  }, [frame, tables]);

  return (
    <Box
      sx={{
        // Glass card aligned with the TrendStatsTable overlay aesthetic
        // — slightly stronger blur + softer hairline border so the
        // panel reads as a calm surface over the busy heatmap behind.
        bgcolor: 'rgba(8, 22, 36, 0.82)',
        border: '1px solid rgba(122, 200, 220, 0.18)',
        borderRadius: 2,
        p: 1.5,
        backdropFilter: 'blur(14px) saturate(140%)',
        WebkitBackdropFilter: 'blur(14px) saturate(140%)',
        height: '100%',
        overflow: 'auto',
        scrollbarWidth: 'none',
        msOverflowStyle: 'none',
        '&::-webkit-scrollbar': { display: 'none' },
        // Tabular figures propagate to every numeric cell — critical
        // for a 1×/sec live feed, otherwise proportional digits jitter
        // column widths on every update.
        fontVariantNumeric: 'tabular-nums',
      }}
    >
      <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1.4 }}>
        <LocalFireDepartmentIcon sx={{ color: '#ff6b1a', fontSize: 27 }} />
        <Typography
          variant="overline"
          sx={{
            color: '#7adfff',
            letterSpacing: 1.5,
            fontWeight: 700,
            lineHeight: 1,
            fontSize: 21,
          }}
        >
          Live Hot Tables
        </Typography>
        <Box sx={{ flex: 1 }} />
        {/* Row count is more useful here than the prior "click to
            inspect" affordance — the click affordance is already
            obvious from hover state, but knowing "5 of 12 slots
            filled" tells the operator at-a-glance how active the
            floor is. Tabular figures so this doesn't jitter. */}
        <Typography
          variant="caption"
          sx={{
            color: 'rgba(255,255,255,0.45)',
            fontSize: 15,
            letterSpacing: 0.4,
          }}
        >
          {rows.length === 0
            ? 'no active trends'
            : `${rows.length} table${rows.length === 1 ? '' : 's'}`}
        </Typography>
      </Stack>

      {rows.length === 0 && (
        <Box
          sx={{
            py: 3,
            textAlign: 'center',
            color: 'rgba(255,255,255,0.4)',
            fontSize: 17,
            fontStyle: 'italic',
          }}
        >
          The floor is quiet — no surprise ≥ 3 or broken streaks.
        </Box>
      )}

      <Stack spacing={0.5}>
        {rows.map((r) => {
          const c = colorFor(r.surprise, r.broken);
          const isSelected = r.tableId === selectedTableId;
          // Strength fill drives the bar width AND its semantic value.
          // Broken rows use brokenLength (the just-snapped streak) as
          // the primary number — that's the dramatic value, not the
          // current low surprise.
          const primary = r.broken ? r.brokenLength : r.surprise;
          const barPct = r.broken
            ? Math.min(100, (r.brokenLength / 12) * 100)
            : Math.min(100, (r.surprise / 9) * 100);
          return (
            <ButtonBase
              key={r.tableId}
              onClick={() => onTableSelect?.(r.tableId)}
              sx={{
                display: 'block',
                width: '100%',
                textAlign: 'left',
                borderRadius: 1.2,
                // Bumped padding to satisfy the §2 touch-target rule
                // (≥44px hit area). The visible row stays compact
                // but the tappable surface grows.
                px: 1,
                py: 0.9,
                bgcolor: isSelected
                  ? 'rgba(122, 223, 255, 0.10)'
                  : 'transparent',
                border: `1px solid ${
                  isSelected ? 'rgba(122, 223, 255, 0.45)' : 'transparent'
                }`,
                // Selected rows get a thin accent stripe on the left
                // edge so selection is detectable from peripheral
                // vision without scanning the whole row.
                borderLeft: isSelected
                  ? `3px solid ${c}`
                  : '3px solid transparent',
                transition: 'background-color 160ms, border-color 160ms',
                '&:hover': {
                  bgcolor: isSelected
                    ? 'rgba(122, 223, 255, 0.16)'
                    : 'rgba(255, 255, 255, 0.04)',
                  borderColor: 'rgba(122, 223, 255, 0.25)',
                },
              }}
            >
              {/* Top line: identity left, primary metrics right.
                  Three-zone layout = icon+label · spacer · HC chip ·
                  primary number. The number sits on the trailing edge
                  so the eye lands on the magnitude after parsing the
                  identity — typical Western scoreboard reading order. */}
              <Stack direction="row" alignItems="center" spacing={1.2}>
                <StatusIcon surprise={r.surprise} broken={r.broken} color={c} />
                <Typography
                  sx={{
                    color: '#fff',
                    fontWeight: 700,
                    fontSize: 21,
                    letterSpacing: 0.3,
                    minWidth: 70,
                  }}
                >
                  {r.label}
                </Typography>
                <Box sx={{ flex: 1 }} />
                <HcChip headcount={r.headcount} />
                {/* Primary metric — large, tabular, color-coded.
                    Broken: brokenLength (the length of the snapped
                    streak); active: surprise. Either way it's "how
                    interesting is this row?" condensed to one number. */}
                <Typography
                  sx={{
                    color: c,
                    fontWeight: 800,
                    fontSize: 30,
                    lineHeight: 1,
                    minWidth: 42,
                    textAlign: 'right',
                  }}
                >
                  {primary}
                </Typography>
              </Stack>

              {/* Bottom line: thin bar + secondary descriptor. Bar
                  width tracks the primary number's intensity so the
                  panel reads as a sortable "scoreboard" at a glance.
                  Descriptor sits to the right of the bar so it never
                  competes with the primary number above. */}
              <Stack
                direction="row"
                alignItems="center"
                spacing={1}
                sx={{ mt: 0.6 }}
              >
                <Box
                  sx={{
                    flex: 1,
                    height: 4,
                    borderRadius: 2,
                    bgcolor: 'rgba(255,255,255,0.05)',
                    overflow: 'hidden',
                  }}
                >
                  <Box
                    sx={{
                      width: `${barPct}%`,
                      height: '100%',
                      bgcolor: c,
                      // Soft inner glow on the bar gives a "live"
                      // feel without distracting from the data.
                      boxShadow: `0 0 8px ${c}80`,
                      transition: 'width 280ms ease-out',
                    }}
                  />
                </Box>
                <Typography
                  sx={{
                    color: 'rgba(255,255,255,0.65)',
                    fontSize: 15,
                    fontWeight: 500,
                    letterSpacing: 0.3,
                    whiteSpace: 'nowrap',
                  }}
                >
                  {r.broken
                    ? `cooldown · was ${compactShape(r.motif)}`
                    : compactShape(r.motif)}
                </Typography>
              </Stack>
            </ButtonBase>
          );
        })}
      </Stack>
    </Box>
  );
}
