import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import dayjs from 'dayjs';
import {
  CssBaseline,
  ThemeProvider,
  createTheme,
  Box,
  Stack,
  Typography,
} from '@mui/material';
import CasinoFloor from './components/CasinoFloor';
import TimeControls from './components/TimeControls';
import HotTablesPanel from './components/HotTablesPanel';
import FloorStats from './components/FloorStats';
import TrendBoard from './components/TrendBoard';
import TrendScoreChart from './components/TrendScoreChart';
import Table3D from './components/Table3D';
import BaccaratBoard from './components/BaccaratBoard';
import TrendDatePicker from './components/TrendDatePicker';
import TrendAnalyticsOverlay from './components/TrendAnalyticsOverlay';
import TrendStatsTable from './components/TrendStatsTable';
import TrendInfoDialog from './components/TrendInfoDialog';
import CasinoIcon from '@mui/icons-material/Casino';
import { generateTimeSeries } from './utils/timeSeriesData';
import { fetchTrendData } from './utils/trendDataSource';

const theme = createTheme({
  palette: {
    mode: 'dark',
    primary: { main: '#7adfff' },
    secondary: { main: '#ff6b1a' },
    background: { default: '#04101c', paper: '#082338' },
  },
  typography: {
    fontFamily:
      '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
  },
});

const MINUTES = 240;

// Default to yesterday — today's data is typically still in flight mid-shift.
const defaultDate = () => dayjs().subtract(1, 'day').format('YYYY-MM-DD');

// Compute the minute index in `sim.frames` that corresponds to 06:00 HKT on
// `selectedDate`. The gaming day starts at 06:00 so every clamping bound
// (slider min, step floor, play wrap-around) anchors here.
function computeStartMinute(sim, selectedDate) {
  if (!sim || sim.startMs == null || sim.tzOffsetMs == null) return 0;
  const [yyyy, mm, dd] = selectedDate.split('-').map(Number);
  if (!yyyy || !mm || !dd) return 0;
  const sixAmEpoch =
    Date.UTC(yyyy, mm - 1, dd) - sim.tzOffsetMs + 6 * 60 * 60 * 1000;
  const targetMinute = Math.round((sixAmEpoch - sim.startMs) / 60_000);
  return Math.max(0, Math.min(sim.frames.length - 1, targetMinute));
}

export default function TrendSeekerDashboard() {
  const [selectedDate, setSelectedDate] = useState(defaultDate);
  const [minute, setMinute] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState(2);
  const [selectedTableId, setSelectedTableId] = useState(null);
  const [zoomedIn, setZoomedIn] = useState(false);
  const [simulationOpen, setSimulationOpen] = useState(false);
  // Floor overlay mode for highlighting trend heat.
  //   'contour' — d3 density blob across hot tables (default)
  //   'ripple'  — static circles around tables ≥ rippleThreshold
  //   'off'     — neither
  const [densityMode, setDensityMode] = useState('contour');
  const [rippleThreshold, setRippleThreshold] = useState(7);
  const [rippleSize, setRippleSize] = useState(50);
  const [showAnalytics, setShowAnalytics] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  // Live pixel size of the CasinoFloor chart canvas — used by the stats
  // table to convert the pixel-based ripple radius into accurate
  // "nearby" hit-tests in data coordinates.
  const [floorPx, setFloorPx] = useState(null);

  // Initialize with synthetic data so the first paint isn't empty.
  // The first fetch swaps it for real data; if the API fails the fetcher
  // itself returns generateTimeSeries() as a fallback.
  const [sim, setSim] = useState(() =>
    generateTimeSeries({ minutes: MINUTES, seed: 1, startHour: 19 })
  );
  const [loading, setLoading] = useState(false);
  const [refreshTick, setRefreshTick] = useState(0);

  const handleTableClick = (id) => {
    setSelectedTableId(id);
    setPlaying(false);
    // setZoomedIn(true); // temporarily disabled
  };

  const handleCloseTrendBoard = () => {
    setSelectedTableId(null);
    setZoomedIn(false);
    setSimulationOpen(false);
  };

  const handleCloseSimulation = () => {
    setSimulationOpen(false);
  };

  // Fetch walker hands for the selected date whenever it changes (or the
  // refresh button is pressed). Falls back to synthetic data on error.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchTrendData({ date: selectedDate })
      .then((next) => {
        if (cancelled || !next) return;
        setSim(next);

        // Seek playback to 06:00 HKT on the picked gaming date.
        const seek = computeStartMinute(next, selectedDate);
        // eslint-disable-next-line no-console
        console.info(
          `[Trend] seek to 06:00 HKT → minute ${seek}` +
            ` (frame.hour=${next.frames[seek]?.hour})`
        );
        setMinute(seek);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [selectedDate, refreshTick]);

  const handleRefresh = useCallback(() => setRefreshTick((t) => t + 1), []);

  // 06:00 HKT minute — used as the lower bound everywhere the playhead
  // can move (slider min, step floor, play-tick wrap-around).
  const startMinute = useMemo(
    () => computeStartMinute(sim, selectedDate),
    [sim, selectedDate]
  );

  const frame = sim.frames[Math.min(minute, sim.frames.length - 1)];

  const selectedTable =
    selectedTableId == null
      ? null
      : sim.tables.find((t) => t.id === selectedTableId);
  const selectedTableData =
    selectedTableId == null || !frame
      ? null
      : frame.perTable.find((p) => p.tableId === selectedTableId);

  // The App-level NavBar refresh button now re-fetches the current date.
  useEffect(() => {
    const handler = () => handleRefresh();
    window.addEventListener('trend-seeker:reseed', handler);
    return () => window.removeEventListener('trend-seeker:reseed', handler);
  }, [handleRefresh]);

  const rafRef = useRef(null);
  const lastTickRef = useRef(0);
  useEffect(() => {
    if (!playing) return;
    const tick = (ts) => {
      const elapsed = ts - lastTickRef.current;
      const stepInterval = 700 / speed;
      if (elapsed >= stepInterval) {
        lastTickRef.current = ts;
        setMinute((m) =>
          m + 1 >= sim.frames.length ? startMinute : m + 1
        );
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [playing, speed, sim.frames.length, startMinute]);

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <Box
        sx={{
          height: '100%',
          position: 'relative',
          background:
            'radial-gradient(circle at 20% 0%, #0a2940 0%, #04101c 50%, #02080f 100%)',
          color: '#e6f7ff',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {simulationOpen && selectedTable && (
          <Box
            sx={{
              position: 'absolute',
              inset: 0,
              zIndex: 50,
              bgcolor: '#0e3a6b',
            }}
          >
            <BaccaratBoard
              table={selectedTable}
              data={selectedTableData}
              onBack={handleCloseSimulation}
            />
          </Box>
        )}
        <TrendDatePicker
          selectedDate={selectedDate}
          onChange={setSelectedDate}
          loading={loading}
          onRefresh={handleRefresh}
          rowCount={sim?.frames?.length ?? null}
          densityMode={densityMode}
          onDensityModeChange={setDensityMode}
          rippleThreshold={rippleThreshold}
          onRippleThresholdChange={setRippleThreshold}
          rippleSize={rippleSize}
          onRippleSizeChange={setRippleSize}
          showAnalytics={showAnalytics}
          onAnalyticsToggle={setShowAnalytics}
          onOpenInfo={() => setInfoOpen(true)}
        />
        <Box
          sx={{
            display: 'grid',
            // 4-column split: floor takes 3, right rail takes 1.
            // Aspect-tuned for the 1200×723 floor on a wide monitor.
            gridTemplateColumns: '3fr 1fr',
            gap: 2,
            p: 2,
            flex: 1,
            minHeight: 0,
            boxSizing: 'border-box',
          }}
        >
          {/* Left rail removed — FloorStats, LegendPanel, PitSummary,
              TrendScoreChart all moved out. Components are still imported
              so they can be re-enabled here later if needed.

          <Stack
            spacing={2}
            sx={{
              minHeight: 0,
              overflow: 'auto',
              scrollbarWidth: 'none',
              msOverflowStyle: 'none',
              '&::-webkit-scrollbar': { display: 'none' },
            }}
          >
            <FloorStats frame={frame} tables={sim.tables} />
            <LegendPanel />
            <PitSummary frame={frame} tables={sim.tables} />
            <TrendScoreChart sim={sim} />
          </Stack>
          */}

          <Stack spacing={2} sx={{ minHeight: 0 }}>
            <Box
              sx={{
                flex: 1,
                position: 'relative',
                borderRadius: 2,
                overflow: 'hidden',
                border: '1px solid rgba(122, 200, 220, 0.2)',
                boxShadow: '0 0 32px rgba(122, 223, 255, 0.06) inset',
              }}
            >
              {zoomedIn && selectedTable ? (
                <Table3D
                  table={selectedTable}
                  data={selectedTableData}
                  onClose={handleCloseTrendBoard}
                />
              ) : (
                <CasinoFloor
                  frame={frame}
                  tables={sim.tables}
                  onTableClick={handleTableClick}
                  selectedTableId={selectedTableId}
                  densityMode={densityMode}
                  rippleThreshold={rippleThreshold}
                  rippleSize={rippleSize}
                  onChartSize={setFloorPx}
                />
              )}
              {/* The Analytics panel now lives in the right rail bottom
                  slot — toggled by the Analytics switch — instead of
                  floating over the chart. */}
              {/* Live stats table at the floor's bottom-right.
                  Updates every minute via the current `frame`. */}
              <TrendStatsTable
                frame={frame}
                rippleThreshold={rippleThreshold}
                rippleSize={rippleSize}
                chartPx={floorPx}
              />

              {selectedTableId && !simulationOpen && (
                <Box
                  onClick={() => setSimulationOpen(true)}
                  sx={{
                    position: 'absolute',
                    left: 16,
                    bottom: 16,
                    zIndex: 20,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 1,
                    px: 2,
                    py: 1.1,
                    borderRadius: 1.5,
                    cursor: 'pointer',
                    color: '#0a1a2c',
                    fontWeight: 800,
                    fontSize: 20,
                    letterSpacing: 0.8,
                    background:
                      'linear-gradient(135deg, #ffd27a 0%, #d4a043 100%)',
                    border: '1px solid rgba(255, 210, 122, 0.7)',
                    boxShadow:
                      '0 4px 14px rgba(212, 160, 67, 0.45), 0 0 18px rgba(255, 210, 122, 0.35)',
                    transition: 'transform .12s, box-shadow .12s',
                    '&:hover': {
                      transform: 'translateY(-1px)',
                      boxShadow:
                        '0 6px 18px rgba(212, 160, 67, 0.55), 0 0 22px rgba(255, 210, 122, 0.5)',
                    },
                    '&:active': { transform: 'translateY(0)' },
                  }}
                >
                  <CasinoIcon sx={{ fontSize: 27 }} />
                  Trend Board Simulation
                  {selectedTable?.label && (
                    <Box
                      component="span"
                      sx={{
                        ml: 0.5,
                        px: 0.9,
                        py: 0.1,
                        borderRadius: 0.8,
                        bgcolor: 'rgba(10, 26, 44, 0.18)',
                        fontSize: 17,
                        fontWeight: 700,
                        letterSpacing: 0.5,
                      }}
                    >
                      {selectedTable.label}
                    </Box>
                  )}
                </Box>
              )}
            </Box>
            <TimeControls
              minute={minute}
              minMinute={startMinute}
              maxMinute={sim.frames.length}
              playing={playing}
              onPlayPause={() => setPlaying((p) => !p)}
              onStep={(d) =>
                setMinute((m) =>
                  Math.max(startMinute, Math.min(sim.frames.length - 1, m + d))
                )
              }
              onSeek={(v) => setMinute(v)}
              speed={speed}
              onSpeedChange={setSpeed}
              startMs={sim.startMs ?? null}
              tzOffsetMs={sim.tzOffsetMs ?? 0}
            />
          </Stack>

          {/* Right rail (1/4 of the 4-column grid).
              Top: HotTablesPanel — enlarged thanks to the wider column.
              Bottom: TrendScoreChart — relocated from the left rail.
              The small TrendBoard that used to live here is hidden
              (disabled, not removed). */}
          <Box
            sx={{
              display: 'grid',
              gap: 2,
              minHeight: 0,
              gridTemplateRows: '1fr 1fr',
            }}
          >
            <Box sx={{ minHeight: 0, overflow: 'hidden' }}>
              <HotTablesPanel
                frame={frame}
                tables={sim.tables}
                onTableSelect={handleTableClick}
                selectedTableId={selectedTableId}
              />
            </Box>
            <Box sx={{ minHeight: 0, overflow: 'hidden' }}>
              {/* Toggleable bottom-right content: the Analytics switch in
                  the gaming-date bar flips this slot between the
                  trend-score behavior chart and the attraction analytics
                  panel. */}
              {showAnalytics ? (
                <TrendAnalyticsOverlay sim={sim} show={true} />
              ) : (
                <TrendScoreChart sim={sim} />
              )}
            </Box>
            {/* Small TrendBoard hidden — disabled, not deleted. To restore,
                uncomment the block below and change gridTemplateRows above
                to `selectedTableId ? '1fr 1fr 1fr' : '1fr 1fr'`.

            {selectedTableId && (
              <Box sx={{ minHeight: 0, overflow: 'hidden' }}>
                <TrendBoard
                  table={selectedTable}
                  data={selectedTableData}
                  onClose={handleCloseTrendBoard}
                />
              </Box>
            )}
            */}
          </Box>
        </Box>
        <TrendInfoDialog open={infoOpen} onClose={() => setInfoOpen(false)} />
      </Box>
    </ThemeProvider>
  );
}

function LegendPanel() {
  const colorItems = [
    { c: '#3a4a5c' }, { c: '#4d7c8c' }, { c: '#3da5b8' }, { c: '#5ac8a8' },
    { c: '#a4d65e' }, { c: '#f7b500' }, { c: '#ff6b1a' }, { c: '#ff2d2d' },
  ];
  // Rectangles scale linearly with surprise so 0 → small, 9 → full-size.
  // Each item lives in a fixed-width column so the rect is centered above
  // its number — perfect vertical alignment regardless of rect size.
  const sizeItems = [
    { w: 10, h: 6, label: '0' },
    { w: 18, h: 12, label: '3' },
    { w: 28, h: 20, label: '6' },
    { w: 40, h: 30, label: '9' },
  ];
  return (
    <Box
      sx={{
        bgcolor: 'rgba(8, 30, 48, 0.7)',
        border: '1px solid rgba(122, 200, 220, 0.18)',
        borderRadius: 2,
        p: 1.5,
        backdropFilter: 'blur(8px)',
      }}
    >
      <Typography
        variant="overline"
        sx={{
          color: '#7adfff',
          letterSpacing: 1.5,
          fontWeight: 700,
          display: 'block',
          mb: 0.5,
          fontSize: 20,
        }}
      >
        Size · Trend Strength
      </Typography>
      <Stack
        direction="row"
        spacing={0}
        justifyContent="space-around"
        sx={{ mb: 1.2, pl: 0.5, pr: 0.5 }}
      >
        {sizeItems.map((it) => (
          <Stack
            key={it.label}
            alignItems="center"
            justifyContent="flex-end"
            sx={{ width: 56 }}
          >
            <Box
              sx={{
                width: it.w,
                height: it.h,
                borderRadius: 0.6,
                bgcolor: 'rgba(122,200,220,0.55)',
                boxShadow: '0 0 6px rgba(122,200,220,0.55)',
                mb: 0.6,
              }}
            />
            <Typography
              variant="caption"
              sx={{
                color: 'rgba(255,255,255,0.55)',
                fontSize: 18,
                lineHeight: 1,
              }}
            >
              {it.label}
            </Typography>
          </Stack>
        ))}
      </Stack>

      <Typography
        variant="overline"
        sx={{
          color: '#7adfff',
          letterSpacing: 1.5,
          fontWeight: 700,
          display: 'block',
          mb: 0.6,
          fontSize: 20,
        }}
      >
        Color · Headcount
      </Typography>
      <Stack direction="row" spacing={0.3} sx={{ mb: 0.4 }}>
        {colorItems.map((it, i) => (
          <Box
            key={i}
            sx={{
              flex: 1,
              height: 10,
              bgcolor: it.c,
              borderRadius: 0.4,
              boxShadow: `0 0 4px ${it.c}`,
            }}
          />
        ))}
      </Stack>
      <Stack direction="row" justifyContent="space-between">
        <Typography
          variant="caption"
          sx={{ color: 'rgba(255,255,255,0.55)', fontSize: 18 }}
        >
          0 empty
        </Typography>
        <Typography
          variant="caption"
          sx={{ color: 'rgba(255,255,255,0.55)', fontSize: 18 }}
        >
          7 packed
        </Typography>
      </Stack>

      <Typography
        variant="caption"
        sx={{
          color: 'rgba(255,255,255,0.4)',
          mt: 1.2,
          display: 'block',
          lineHeight: 1.35,
          fontSize: 18,
        }}
      >
        <b>Blue ring</b> = streak just broke. <b>White ring</b> = hot ≥ 5 bits.{' '}
        <b>Cyan ring</b> = selected.
      </Typography>
    </Box>
  );
}

function PitSummary({ frame, tables }) {
  const pits = useMemo(() => {
    if (!frame) return [];
    const tableMap = new Map(tables.map((t) => [t.id, t]));
    const grouped = {};
    frame.perTable.forEach((p) => {
      const t = tableMap.get(p.tableId);
      if (!t) return;
      if (!grouped[t.pit])
        grouped[t.pit] = { pit: t.pit, hot: 0, crowd: 0, n: 0 };
      grouped[t.pit].n += 1;
      grouped[t.pit].crowd += p.headcount;
      if (p.surprise >= 5) grouped[t.pit].hot += 1;
    });
    return Object.values(grouped).sort((a, b) => a.pit.localeCompare(b.pit));
  }, [frame, tables]);

  return (
    <Box
      sx={{
        bgcolor: 'rgba(8, 30, 48, 0.7)',
        border: '1px solid rgba(122, 200, 220, 0.18)',
        borderRadius: 2,
        p: 1.5,
        backdropFilter: 'blur(8px)',
        flex: 1,
        overflow: 'auto',
        scrollbarWidth: 'none',
        msOverflowStyle: 'none',
        '&::-webkit-scrollbar': { display: 'none' },
      }}
    >
      <Typography
        variant="overline"
        sx={{
          color: '#7adfff',
          letterSpacing: 1.5,
          fontWeight: 700,
          display: 'block',
          mb: 1,
          fontSize: 20,
        }}
      >
        Pit Status
      </Typography>
      <Stack spacing={0.9}>
        {pits.map((p) => (
          <Box key={p.pit}>
            <Stack
              direction="row"
              justifyContent="space-between"
              alignItems="baseline"
              sx={{ width: '100%' }}
            >
              <Typography variant="body2" sx={{ color: '#fff', fontWeight: 600, fontSize: 22 }}>
                Pit {p.pit}
              </Typography>
              <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.6)', fontSize: 18 }}>
                {p.crowd} players · {p.n} tables
              </Typography>
            </Stack>
            <Stack direction="row" spacing={0.5} sx={{ mt: 0.4 }}>
              {Array.from({ length: p.n }).map((_, i) => (
                <Box
                  key={i}
                  sx={{
                    flex: 1,
                    height: 4,
                    borderRadius: 1,
                    bgcolor:
                      i < p.hot
                        ? '#ff6b1a'
                        : i < p.hot + Math.round(p.crowd / 7)
                        ? '#5ac8a8'
                        : 'rgba(255,255,255,0.1)',
                    boxShadow:
                      i < p.hot ? '0 0 6px rgba(255,107,26,0.6)' : 'none',
                  }}
                />
              ))}
            </Stack>
          </Box>
        ))}
      </Stack>
    </Box>
  );
}
