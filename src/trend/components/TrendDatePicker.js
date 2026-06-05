import React from 'react';
import dayjs from 'dayjs';
import {
  Box,
  Typography,
  CircularProgress,
  IconButton,
  Tooltip,
  Switch,
  ToggleButton,
  ToggleButtonGroup,
  TextField,
} from '@mui/material';
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider';
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs';
import { DatePicker } from '@mui/x-date-pickers/DatePicker';
import RefreshIcon from '@mui/icons-material/Refresh';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';

// Small header bar above the casino floor. Hosts the gaming-date picker,
// the density-mode toggle (off / contour / ripple), ripple parameters,
// the analytics toggle, and an info icon that opens the trend-detection
// explanation dialog.
export default function TrendDatePicker({
  selectedDate,
  onChange,
  loading = false,
  onRefresh,
  rowCount = null,
  densityMode = 'contour',
  onDensityModeChange,
  rippleThreshold = 7,
  onRippleThresholdChange,
  rippleSize = 50,
  onRippleSizeChange,
  showAnalytics = false,
  onAnalyticsToggle,
  onOpenInfo,
}) {
  const value = selectedDate ? dayjs(selectedDate) : null;

  const handleChange = (d) => {
    if (!d || !d.isValid()) return;
    onChange(d.format('YYYY-MM-DD'));
  };

  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  return (
    <LocalizationProvider dateAdapter={AdapterDayjs}>
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1.5,
          px: 2,
          py: 1,
          mx: 2,
          mt: 1.5,
          mb: 0,
          borderRadius: 1.5,
          bgcolor: 'rgba(8, 30, 48, 0.7)',
          border: '1px solid rgba(122, 200, 220, 0.18)',
          backdropFilter: 'blur(8px)',
          flexWrap: 'wrap',
        }}
      >
        <Typography
          variant="overline"
          sx={{
            color: '#7adfff',
            letterSpacing: 1.5,
            fontWeight: 700,
            fontSize: 26,
            mr: 0.5,
          }}
        >
          Gaming Date
        </Typography>

        <DatePicker
          value={value}
          format="MMM DD, YYYY"
          onChange={handleChange}
          disableFuture
          maxDate={dayjs()}
          slotProps={{ textField: { size: 'small' } }}
          sx={{
            width: 230,
            '& .MuiOutlinedInput-input': {
              paddingY: '12px',
              color: 'rgba(240,240,240,0.9)',
              fontSize: 28,
            },
            '& .MuiSvgIcon-root': { fontSize: 32, color: 'rgba(255,255,255,0.7)' },
            '& .MuiOutlinedInput-notchedOutline': {
              borderColor: 'rgba(122,200,220,0.3)',
            },
            '&:hover .MuiOutlinedInput-notchedOutline': {
              borderColor: 'rgba(122,200,220,0.6)',
            },
          }}
        />

        <Tooltip title="Reload data for this date">
          <span>
            <IconButton
              size="small"
              disabled={loading}
              onClick={onRefresh}
              sx={{
                color: '#7adfff',
                border: '1px solid rgba(122,223,255,0.25)',
                borderRadius: 1.2,
                width: 42,
                height: 42,
                '&.Mui-disabled': {
                  color: 'rgba(255,255,255,0.25)',
                  borderColor: 'rgba(255,255,255,0.1)',
                },
              }}
            >
              <RefreshIcon sx={{ fontSize: 30 }} />
            </IconButton>
          </span>
        </Tooltip>

        {loading && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.8, ml: 0.5 }}>
            <CircularProgress size={14} sx={{ color: '#7adfff' }} />
            <Typography sx={{ fontSize: 26, color: 'rgba(255,255,255,0.65)' }}>
              loading…
            </Typography>
          </Box>
        )}

        <Box sx={{ flex: 1 }} />

        {/* DENSITY: 3-way toggle (off / contour / ripple) */}
        <Tooltip title="How trend hotspots are highlighted on the floor">
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.7 }}>
            <Typography
              variant="overline"
              sx={{
                color: '#7adfff',
                letterSpacing: 1.2,
                fontWeight: 700,
                fontSize: 24,
                lineHeight: 1,
              }}
            >
              Density
            </Typography>
            <ToggleButtonGroup
              size="small"
              exclusive
              value={densityMode}
              onChange={(_, v) => v && onDensityModeChange && onDensityModeChange(v)}
              sx={{
                '& .MuiToggleButton-root': {
                  color: 'rgba(255,255,255,0.55)',
                  borderColor: 'rgba(122, 200, 220, 0.2)',
                  px: 1.4,
                  py: 0.6,
                  fontSize: 18,
                  fontWeight: 700,
                  lineHeight: 1,
                },
                '& .Mui-selected': {
                  color: '#7adfff !important',
                  borderColor: '#7adfff !important',
                  bgcolor: 'rgba(122, 223, 255, 0.08) !important',
                },
              }}
            >
              <ToggleButton value="off">Off</ToggleButton>
              <ToggleButton value="contour">Contour</ToggleButton>
              <ToggleButton value="ripple">Ripple</ToggleButton>
            </ToggleButtonGroup>
          </Box>
        </Tooltip>

        {/* Ripple parameter inputs — only meaningful when mode === 'ripple' */}
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 0.8,
            opacity: densityMode === 'ripple' ? 1 : 0.45,
            pointerEvents: densityMode === 'ripple' ? 'auto' : 'none',
          }}
        >
          <Typography
            sx={{
              color: 'rgba(255,255,255,0.65)',
              fontSize: 20,
              fontWeight: 700,
              letterSpacing: 0.4,
            }}
          >
            ≥
          </Typography>
          <TextField
            type="number"
            size="small"
            value={rippleThreshold}
            onChange={(e) => {
              const v = clamp(parseInt(e.target.value, 10) || 0, 0, 9);
              onRippleThresholdChange && onRippleThresholdChange(v);
            }}
            inputProps={{ min: 0, max: 9 }}
            sx={{
              width: 76,
              '& .MuiOutlinedInput-input': {
                paddingY: '6px',
                fontSize: 22,
                color: '#dff5ff',
                textAlign: 'center',
              },
              '& .MuiOutlinedInput-notchedOutline': {
                borderColor: 'rgba(122,200,220,0.3)',
              },
            }}
          />
          <Typography
            sx={{
              color: 'rgba(255,255,255,0.55)',
              fontSize: 18,
              fontWeight: 600,
              letterSpacing: 0.5,
              ml: 0.4,
            }}
          >
            size
          </Typography>
          <TextField
            type="number"
            size="small"
            value={rippleSize}
            onChange={(e) => {
              const v = clamp(parseInt(e.target.value, 10) || 0, 10, 200);
              onRippleSizeChange && onRippleSizeChange(v);
            }}
            inputProps={{ min: 10, max: 200, step: 5 }}
            sx={{
              width: 90,
              '& .MuiOutlinedInput-input': {
                paddingY: '6px',
                fontSize: 22,
                color: '#dff5ff',
                textAlign: 'center',
              },
              '& .MuiOutlinedInput-notchedOutline': {
                borderColor: 'rgba(122,200,220,0.3)',
              },
            }}
          />
        </Box>

        <Tooltip title={showAnalytics ? 'Hide attraction analytics' : 'Show attraction analytics'}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, ml: 1 }}>
            <Typography
              variant="overline"
              sx={{
                color: '#ffd27a',
                letterSpacing: 1.2,
                fontWeight: 700,
                fontSize: 24,
                lineHeight: 1,
              }}
            >
              Analytics
            </Typography>
            <Switch
              size="small"
              checked={!!showAnalytics}
              onChange={(e) =>
                onAnalyticsToggle && onAnalyticsToggle(e.target.checked)
              }
              sx={{
                '& .MuiSwitch-switchBase.Mui-checked': { color: '#ffd27a' },
                '& .MuiSwitch-switchBase.Mui-checked + .MuiSwitch-track': {
                  backgroundColor: '#ffd27a',
                },
              }}
            />
          </Box>
        </Tooltip>

        <Tooltip title="How are hot trends detected?">
          <IconButton
            size="small"
            onClick={onOpenInfo}
            sx={{
              ml: 0.5,
              color: '#7adfff',
              border: '1px solid rgba(122,223,255,0.25)',
              borderRadius: 1.2,
              width: 42,
              height: 42,
            }}
          >
            <InfoOutlinedIcon sx={{ fontSize: 30 }} />
          </IconButton>
        </Tooltip>
      </Box>
    </LocalizationProvider>
  );
}
