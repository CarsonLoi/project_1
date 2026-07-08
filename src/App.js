import React, { useState, useEffect } from 'react';
import {
  HashRouter,
  Routes,
  Route,
  NavLink,
  Navigate,
  useLocation,
} from 'react-router-dom';
import {
  CssBaseline,
  ThemeProvider,
  createTheme,
  Box,
  Typography,
  Chip,
  IconButton,
  Tooltip,
} from '@mui/material';
import CasinoIcon from '@mui/icons-material/Casino';
import InsightsIcon from '@mui/icons-material/Insights';
import TrendingUpIcon from '@mui/icons-material/TrendingUp';
import GridViewIcon from '@mui/icons-material/GridView';
import AttachMoneyIcon from '@mui/icons-material/AttachMoney';
import RefreshIcon from '@mui/icons-material/Refresh';

import TrendSeekerDashboard from './trend/TrendSeekerDashboard';
import PerformanceDashboard from './performance/PerformanceDashboard';
import SpreadDashboard from './spread/SpreadDashboard';
import PricingDashboard from './pricing/PricingDashboard';

export const NAV_HEIGHT = 52;

const baseTheme = createTheme({
  palette: { mode: 'dark' },
});

// Reseed event channel — TrendSeekerDashboard listens for it so the
// header refresh button can re-roll the simulation without prop drilling.
export function dispatchReseed() {
  window.dispatchEvent(new CustomEvent('trend-seeker:reseed'));
}

const TABS = [
  {
    to: '/trend',
    label: 'Trend Seeker',
    icon: TrendingUpIcon,
    accent: '#7adfff',
    subtitle: 'Real-time hot-trend detection',
  },
  {
    to: '/performance',
    label: 'Performance Heatmap',
    icon: InsightsIcon,
    accent: '#5597e6',
    subtitle: 'Floor KPI analytics · daily / hourly / WD',
  },
  {
    to: '/spread',
    label: 'Spread Scheduling',
    icon: GridViewIcon,
    accent: '#5ae6b0',
    subtitle: 'Assign shifts to tables · versioned by date',
  },
  {
    to: '/pricing',
    label: 'Table Pricing',
    icon: AttachMoneyIcon,
    accent: '#e0af68',
    subtitle: 'Assign table minimums · versioned by date',
  },
];

function NavBar() {
  const location = useLocation();
  const activeTab = TABS.find((t) => location.pathname.startsWith(t.to));
  const accent = activeTab?.accent || '#7adfff';
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30 * 1000);
    return () => clearInterval(id);
  }, []);

  const onTrend = location.pathname.startsWith('/trend');

  return (
    <Box
      sx={{
        height: NAV_HEIGHT,
        display: 'flex',
        alignItems: 'center',
        px: 2,
        bgcolor: 'linear-gradient(180deg, #0d1424 0%, #0a1120 100%)',
        background:
          'linear-gradient(180deg, rgba(13,20,36,0.96) 0%, rgba(8,15,28,0.96) 100%)',
        borderBottom: `1px solid ${accent}33`,
        boxShadow: '0 1px 0 rgba(0,0,0,0.4), 0 4px 16px rgba(0,0,0,0.25)',
        position: 'relative',
        zIndex: 10,
        gap: 1,
      }}
    >
      {/* Brand */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mr: 1.5 }}>
        <Box
          sx={{
            width: 30,
            height: 30,
            borderRadius: 1.2,
            display: 'grid',
            placeItems: 'center',
            background: `linear-gradient(135deg, ${accent}55, ${accent}11)`,
            border: `1px solid ${accent}55`,
            boxShadow: `0 0 8px ${accent}33`,
            flexShrink: 0,
          }}
        >
          <CasinoIcon sx={{ fontSize: 18, color: accent }} />
        </Box>
        <Typography
          sx={{
            fontWeight: 800,
            letterSpacing: 2,
            fontSize: 14,
            color: '#fff',
            lineHeight: 1,
            whiteSpace: 'nowrap',
          }}
        >
          TG ANALYSIS HEATMAP
        </Typography>
      </Box>

      <Box
        sx={{
          width: 1,
          height: 28,
          bgcolor: 'rgba(255,255,255,0.08)',
          mr: 1.5,
        }}
      />

      {/* Tabs */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.4 }}>
        {TABS.map((t) => {
          const Icon = t.icon;
          return (
            <NavLink
              key={t.to}
              to={t.to}
              style={{ textDecoration: 'none' }}
            >
              {({ isActive }) => (
                <Box
                  sx={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 0.7,
                    px: 1.8,
                    py: 0.7,
                    borderRadius: 1.2,
                    color: isActive ? '#fff' : 'rgba(255,255,255,0.55)',
                    fontWeight: isActive ? 700 : 500,
                    fontSize: 13,
                    letterSpacing: 0.4,
                    whiteSpace: 'nowrap',
                    bgcolor: isActive ? `${t.accent}1f` : 'transparent',
                    border: `1px solid ${
                      isActive ? `${t.accent}66` : 'transparent'
                    }`,
                    transition:
                      'background-color .15s, color .15s, border-color .15s',
                    '&:hover': {
                      bgcolor: isActive ? `${t.accent}29` : 'rgba(255,255,255,0.05)',
                      color: '#fff',
                    },
                  }}
                >
                  <Icon
                    sx={{
                      fontSize: 16,
                      color: isActive ? t.accent : 'inherit',
                    }}
                  />
                  {t.label}
                </Box>
              )}
            </NavLink>
          );
        })}
      </Box>

      <Box sx={{ flex: 1 }} />

      {/* Page actions — LIVE pulse + refresh only on /trend */}
      {onTrend && (
        <>
          <Chip
            size="small"
            icon={
              <Box
                sx={{
                  width: 7,
                  height: 7,
                  borderRadius: '50%',
                  bgcolor: '#ff2d2d',
                  ml: 1,
                  boxShadow: '0 0 8px #ff2d2d',
                  animation: 'navpulse 1.6s infinite',
                  '@keyframes navpulse': {
                    '0%, 100%': { opacity: 1, transform: 'scale(1)' },
                    '50%': { opacity: 0.5, transform: 'scale(0.8)' },
                  },
                }}
              />
            }
            label="LIVE"
            sx={{
              bgcolor: 'rgba(255,45,45,0.12)',
              border: '1px solid rgba(255,45,45,0.4)',
              color: '#ff8080',
              fontWeight: 700,
              fontSize: 10,
              letterSpacing: 1,
              height: 24,
              '& .MuiChip-icon': { ml: 0.4, mr: -0.2 },
            }}
          />
          <Tooltip title="Reload trend data for the selected date">
            <span>
              <IconButton
                size="small"
                onClick={dispatchReseed}
                sx={{
                  color: accent,
                  ml: 0.5,
                  border: `1px solid ${accent}33`,
                  borderRadius: 1.2,
                  width: 28,
                  height: 28,
                  '&.Mui-disabled': {
                    color: 'rgba(255,255,255,0.25)',
                    borderColor: 'rgba(255,255,255,0.1)',
                  },
                }}
              >
                <RefreshIcon sx={{ fontSize: 16 }} />
              </IconButton>
            </span>
          </Tooltip>
        </>
      )}

      {/* Clock */}
      <Box
        sx={{
          ml: 1.5,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'flex-end',
          lineHeight: 1,
        }}
      >
        <Typography
          sx={{
            fontFamily: 'monospace',
            fontSize: 13,
            fontWeight: 700,
            color: '#cfe',
            letterSpacing: 1,
            lineHeight: 1,
          }}
        >
          {now.toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit',
            hour12: false,
          })}
        </Typography>
        <Typography
          sx={{
            fontSize: 9,
            color: 'rgba(255,255,255,0.35)',
            letterSpacing: 1.5,
            lineHeight: 1,
            mt: 0.3,
          }}
        >
          {now.toLocaleDateString([], {
            month: 'short',
            day: '2-digit',
          })}
        </Typography>
      </Box>
    </Box>
  );
}

export default function App() {
  return (
    <ThemeProvider theme={baseTheme}>
      <CssBaseline />
      <HashRouter>
        <Box
          sx={{
            height: '100vh',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            bgcolor: '#0d1424',
          }}
        >
          <NavBar />
          <Box sx={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
            <Routes>
              <Route path="/trend" element={<TrendSeekerDashboard />} />
              <Route path="/performance" element={<PerformanceDashboard />} />
              <Route path="/spread" element={<SpreadDashboard />} />
              <Route path="/pricing" element={<PricingDashboard />} />
              <Route path="*" element={<Navigate to="/trend" replace />} />
            </Routes>
          </Box>
        </Box>
      </HashRouter>
    </ThemeProvider>
  );
}
