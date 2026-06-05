import React, { useMemo } from 'react';
import { Box, Typography, Grid, LinearProgress } from '@mui/material';
import GroupsIcon from '@mui/icons-material/Groups';
import WhatshotIcon from '@mui/icons-material/Whatshot';
import EventSeatIcon from '@mui/icons-material/EventSeat';
import TimelineIcon from '@mui/icons-material/Timeline';

function StatCard({ label, value, sub, color, icon, progress }) {
  return (
    <Box
      sx={{
        position: 'relative',
        bgcolor: 'rgba(8, 30, 48, 0.7)',
        border: '1px solid rgba(122, 200, 220, 0.18)',
        borderRadius: 2,
        px: 1.5,
        py: 1.2,
        backdropFilter: 'blur(8px)',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        // Uniform card sizing — `height: 100%` makes each card fill its
        // grid cell (equal height within a row), and `minHeight` guarantees
        // the same height across rows regardless of content variation.
        height: '100%',
        minHeight: 200,
        boxSizing: 'border-box',
        transition:
          'transform .18s ease, border-color .18s ease, box-shadow .18s ease',
        '&:hover': {
          transform: 'translateY(-1px)',
          borderColor: `${color}66`,
          boxShadow: `0 6px 18px ${color}22`,
        },
        // accent strip on left edge
        '&::before': {
          content: '""',
          position: 'absolute',
          left: 0,
          top: 8,
          bottom: 8,
          width: 3,
          borderRadius: 2,
          background: `linear-gradient(180deg, ${color}, ${color}33)`,
          boxShadow: `0 0 8px ${color}66`,
        },
        // soft radial glow behind the icon
        '&::after': {
          content: '""',
          position: 'absolute',
          right: -10,
          top: -10,
          width: 80,
          height: 80,
          borderRadius: '50%',
          background: `radial-gradient(circle, ${color}22 0%, transparent 70%)`,
          pointerEvents: 'none',
        },
      }}
    >
      {/* Header row: label + icon chip */}
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          mb: 0.4,
          position: 'relative',
          zIndex: 1,
        }}
      >
        <Typography
          sx={{
            color: 'rgba(255,255,255,0.55)',
            letterSpacing: 1.2,
            fontSize: 20,
            fontWeight: 700,
          }}
        >
          {label}
        </Typography>
        <Box
          sx={{
            width: 36,
            height: 36,
            borderRadius: 1,
            display: 'grid',
            placeItems: 'center',
            bgcolor: `${color}1f`,
            border: `1px solid ${color}44`,
            color,
          }}
        >
          {icon}
        </Box>
      </Box>

      {/* Value */}
      <Typography
        sx={{
          fontFamily: 'monospace',
          fontSize: 48,
          fontWeight: 800,
          color,
          lineHeight: 1.1,
          letterSpacing: -0.5,
          textShadow: `0 0 12px ${color}55`,
          position: 'relative',
          zIndex: 1,
        }}
      >
        {value}
      </Typography>

      {/* Sub-caption */}
      <Typography
        sx={{
          color: 'rgba(255,255,255,0.45)',
          fontSize: 18,
          mt: 0.2,
          position: 'relative',
          zIndex: 1,
        }}
      >
        {sub}
      </Typography>

      {/* Optional mini progress bar — pinned to the card bottom (mt: 'auto')
          so it sits at the same vertical position on every card regardless
          of how much copy is above. */}
      {progress != null && (
        <LinearProgress
          variant="determinate"
          value={Math.min(100, Math.max(0, progress))}
          sx={{
            mt: 'auto',
            pt: 0,
            height: 3,
            borderRadius: 1.5,
            bgcolor: 'rgba(255,255,255,0.06)',
            '& .MuiLinearProgress-bar': {
              bgcolor: color,
              borderRadius: 1.5,
            },
          }}
        />
      )}
    </Box>
  );
}

export default function FloorStats({ frame, tables }) {
  const stats = useMemo(() => {
    if (!frame) {
      return {
        crowd: 0,
        hot: 0,
        seats: 0,
        totalSeats: tables.length * 7,
        avgSurprise: 0,
      };
    }
    const totalSeats = tables.length * 7;
    const crowd = frame.perTable.reduce((a, p) => a + p.headcount, 0);
    const hot = frame.perTable.filter((p) => p.surprise >= 5).length;
    const seatsLeft = totalSeats - crowd;
    const avgSurprise =
      frame.perTable.reduce((a, p) => a + p.surprise, 0) /
      Math.max(1, frame.perTable.length);
    return {
      crowd,
      hot,
      seats: seatsLeft,
      totalSeats,
      avgSurprise,
    };
  }, [frame, tables]);

  const totalSeats = stats.totalSeats || tables.length * 7;
  const occupancyPct = (stats.crowd / Math.max(1, totalSeats)) * 100;
  const hotPct = (stats.hot / Math.max(1, tables.length)) * 100;
  const openPct = (stats.seats / Math.max(1, totalSeats)) * 100;
  const surprisePct = (stats.avgSurprise / 9) * 100;

  return (
    <Grid container spacing={1.2}>
      <Grid size={{ xs: 6 }}>
        <StatCard
          label="LIVE CROWD"
          value={stats.crowd.toLocaleString()}
          sub={`${occupancyPct.toFixed(0)}% of seats filled`}
          color="#7adfff"
          icon={<GroupsIcon sx={{ fontSize: 22 }} />}
          progress={occupancyPct}
        />
      </Grid>
      <Grid size={{ xs: 6 }}>
        <StatCard
          label="HOT TABLES"
          value={stats.hot}
          sub={`${hotPct.toFixed(0)}% of floor · surprise ≥ 5`}
          color="#ff6b1a"
          icon={<WhatshotIcon sx={{ fontSize: 22 }} />}
          progress={hotPct}
        />
      </Grid>
      <Grid size={{ xs: 6 }}>
        <StatCard
          label="OPEN SEATS"
          value={stats.seats.toLocaleString()}
          sub={`of ${totalSeats.toLocaleString()} total`}
          color="#5ac8a8"
          icon={<EventSeatIcon sx={{ fontSize: 22 }} />}
          progress={openPct}
        />
      </Grid>
      <Grid size={{ xs: 6 }}>
        <StatCard
          label="AVG SURPRISE"
          value={stats.avgSurprise.toFixed(1)}
          sub="bits · across floor"
          color="#f7b500"
          icon={<TimelineIcon sx={{ fontSize: 22 }} />}
          progress={surprisePct}
        />
      </Grid>
    </Grid>
  );
}
