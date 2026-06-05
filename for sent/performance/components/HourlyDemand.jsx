// Hourly Demand panel — third view in Performance Insights.
//
// Layout follows the reference at /reference/demand.js:
//   • Single multi-series ECharts line chart (all selected metrics
//     overlaid, not small multiples).
//   • Gaming-day hour order on the x-axis: 6, 7, …, 23, 0, 1, …, 5.
//   • When grouping by date or dow, the chart concatenates one
//     24-hour block per group. A second x-axis line labels each block
//     and a tall tick separates them.
//
// Three grouping modes (top-right toggle in the header row already
// rendered by TrendCharts.js — we expose them inside this panel too):
//   • By Hour                 (`agg`)  — average across all dates
//   • By Day of Week × Hour   (`dow`)  — one block per WD / Fri / Sat / Sun
//   • By Day × Hour           (`date`) — one block per date
//
// Metrics (multi-select chips):
//   patron_hours, optimal_open_hours, actual_open_tables,
//   scheduling_open_tables, table_capacity, proposed_open_tables.
//
//   optimal_open_hours = patron_hours / preferUtilization
//   actual_open_tables = unique tables with adj_openhours > 0
//   scheduling_open_tables = count(spread === 1)
//   table_capacity = Σ floorday  (per-hour floor capacity)
//   proposed_open_tables = Σ shift.tables where the shift covers this hour
//
// The Shift Assignment table below the chart drives "proposed".

import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as echarts from 'echarts';
import {
  Box,
  Typography,
  ToggleButton,
  ToggleButtonGroup,
  TextField,
  Button,
  IconButton,
  Chip,
  Switch,
  FormControlLabel,
} from '@mui/material';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlined';
import AddIcon from '@mui/icons-material/Add';
import RestartAltIcon from '@mui/icons-material/RestartAlt';
import { DOW_BUCKETS, dowFromDate, gametypeTableKey } from '../utils/dataSource';
import {
  INSIGHTS_TOKENS as T,
  flatCard,
  pillToggleGroup,
  cardHeader,
  cardTitleSx,
  cardTitleAccentSx,
  kebabDotsSx, // eslint-disable-line no-unused-vars
  labelSx,
} from './insightsTheme';

// Gaming-day hour order — copied from the reference. Matches how the
// floor talks about a "day" (starts at 6 AM, wraps past midnight).
const HOUR_ORDER = [6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 0, 1, 2, 3, 4, 5];

// Brand-aligned metric palette. Patron hours gets the cyan area-fill
// treatment (the headline demand series), the others use the saturated
// supporting colors.
const METRICS = [
  // Patron and optimal both render as continuous histograms; the dot
  // color in their chip matches the actual bar color (grey for
  // patron, amber for optimal).
  { key: 'patron_hours',           label: 'Patron hours',           color: '#9ca3af', area: true  },
  { key: 'optimal_open_hours',     label: 'Optimal open hours',     color: '#f59e0b', area: false },
  // Labels read "… open hours" because each per-hour value times 1
  // hour = that many table-hours of supply; "open hours" makes the
  // unit explicit and aligns with the Patron / Optimal labels above.
  { key: 'actual_open_tables',     label: 'Actual open hours',      color: '#3b82f6', area: false },
  { key: 'scheduling_open_tables', label: 'Scheduling open hours',  color: '#10b981', area: false },
  { key: 'table_capacity',         label: 'Table capacity',         color: '#ec4899', area: false },
  { key: 'proposed_open_tables',   label: 'Proposed open hours',    color: '#8b5cf6', area: false },
];

// Four day-type buckets — shared with the rest of the dashboard. The
// data-source boundary (src/performance/utils/dataSource.js) re-derives
// each row's `dow` field to one of these four values from the row's
// date, so any row reaching this component already carries the correct
// bucket. We still expose the local helper as a thin wrapper around
// the shared `dowFromDate` so the (rare) date-only call sites stay
// concise and there's no risk of the rule drifting.
const DAY_TYPES = DOW_BUCKETS;
const dayTypeForDate = (dateStr) => dowFromDate(dateStr) || 'WD';

// Each shift tracks a per-day-type table count so the proposed roster
// can differ across the four day types. `tablesXX` keys.
const SHIFT_KEY_BY_DAY = { WD: 'tablesWD', Fri: 'tablesFri', Sat: 'tablesSat', Sun: 'tablesSun' };

// Default shift roster. End hour is INCLUSIVE — see shiftCoversHour /
// shiftLengthHours above (11→2 counts 11..23,0,1,2 = 16 hours).
//   A              — 24h (start === end → wraps every hour)
//   B / C / D      — 16h
//   B1/B2/C1/C2/D1/D2 — 8h splits that pair up to cover their parent
//                       16h shift (e.g. B1 11→18 + B2 19→2 = B 11→2).
const DEFAULT_SHIFTS = [
  { id: 'A',  name: 'A',  startHour: 7,  endHour: 7,  tablesWD: 0, tablesFri: 0, tablesSat: 0, tablesSun: 0 }, // 24h
  { id: 'B',  name: 'B',  startHour: 11, endHour: 2,  tablesWD: 0, tablesFri: 0, tablesSat: 0, tablesSun: 0 }, // 16h
  { id: 'C',  name: 'C',  startHour: 13, endHour: 4,  tablesWD: 0, tablesFri: 0, tablesSat: 0, tablesSun: 0 }, // 16h
  { id: 'D',  name: 'D',  startHour: 15, endHour: 6,  tablesWD: 0, tablesFri: 0, tablesSat: 0, tablesSun: 0 }, // 16h
  { id: 'B1', name: 'B1', startHour: 11, endHour: 18, tablesWD: 0, tablesFri: 0, tablesSat: 0, tablesSun: 0 }, // 8h
  { id: 'B2', name: 'B2', startHour: 19, endHour: 2,  tablesWD: 0, tablesFri: 0, tablesSat: 0, tablesSun: 0 }, // 8h
  { id: 'C1', name: 'C1', startHour: 13, endHour: 20, tablesWD: 0, tablesFri: 0, tablesSat: 0, tablesSun: 0 }, // 8h
  { id: 'C2', name: 'C2', startHour: 21, endHour: 4,  tablesWD: 0, tablesFri: 0, tablesSat: 0, tablesSun: 0 }, // 8h
  { id: 'D1', name: 'D1', startHour: 15, endHour: 22, tablesWD: 0, tablesFri: 0, tablesSat: 0, tablesSun: 0 }, // 8h
  { id: 'D2', name: 'D2', startHour: 23, endHour: 6,  tablesWD: 0, tablesFri: 0, tablesSat: 0, tablesSun: 0 }, // 8h
];

// Persist the shift roster (names, hours, per-day table counts) across
// page refreshes via localStorage. Bump the key suffix if the shape of
// a shift object ever changes incompatibly.
const SHIFTS_STORAGE_KEY = 'perf.hourlyDemand.shifts.v1';

function loadStoredShifts() {
  try {
    const raw = window.localStorage.getItem(SHIFTS_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0) return parsed;
  } catch (e) {
    // Storage unavailable (private mode / quota) or corrupt JSON —
    // fall back to defaults silently.
  }
  return null;
}

// Length-based color coding for shifts. Three distinct hues across
// the temperature scale so each category pops at a glance:
//   24h → pink-red (warmest, longest commitment)
//   16h → amber   (medium)
//    8h → cyan    (coolest, shortest)
// Kept in sync with SHIFT_LEN_BANDS below so the legend and the
// actual row tints match.
function shiftBand(shift) {
  const len = shiftLengthHours(shift);
  if (len >= 24) return { label: '24h', color: '#fc6e78' };
  if (len >= 16) return { label: '16h', color: '#f59e0b' };
  if (len === 8) return { label: '8h',  color: '#00d4ff' };
  return { label: `${len}h`, color: 'rgba(255,255,255,0.30)' };
}

// End hour is INCLUSIVE — a shift from 11 to 2 covers hours
// 11,12,…,23,0,1,2 = 16 hours (not 15). Matches casino-floor
// convention where "shift ends at 2" means the table is staffed
// through the hour starting at 02:00.
function shiftCoversHour(shift, hour) {
  const s = ((Number(shift.startHour) % 24) + 24) % 24;
  const e = ((Number(shift.endHour)   % 24) + 24) % 24;
  // start === end is the 24-hr "A" pattern (e.g. 7am → 7am next day).
  if (s === e) return true;
  if (s < e) return hour >= s && hour <= e;
  return hour >= s || hour <= e;
}

function shiftLengthHours(shift) {
  const s = ((Number(shift.startHour) % 24) + 24) % 24;
  const e = ((Number(shift.endHour)   % 24) + 24) % 24;
  if (s === e) return 24;
  return s < e ? e - s + 1 : 24 - s + e + 1;
}

// Sum tables across shifts that cover `hour`, looking up the column
// matching the day-type (WD/Fri/Sat/Sun). Legacy shifts (older single-
// `tables` field, or only WD/WE) fall back gracefully.
function sumProposedAtHour(shifts, hour, dayType) {
  const key = SHIFT_KEY_BY_DAY[dayType] || 'tablesWD';
  return shifts.reduce((sum, s) => {
    if (!shiftCoversHour(s, hour)) return sum;
    const n = Number(s[key]);
    if (Number.isFinite(n)) return sum + n;
    // Back-compat: older shifts only had tablesWD/tablesWE or `tables`.
    // Map Fri/Sat/Sun → tablesWE, WD → tablesWD; final fallback to `tables`.
    if (dayType !== 'WD') {
      const we = Number(s.tablesWE);
      if (Number.isFinite(we)) return sum + we;
    } else {
      const wd = Number(s.tablesWD);
      if (Number.isFinite(wd)) return sum + wd;
    }
    return sum + (Number(s.tables) || 0);
  }, 0);
}

function compactNum(v) {
  if (v == null || !Number.isFinite(v)) return v;
  const abs = Math.abs(v);
  const sign = v < 0 ? '-' : '';
  if (abs >= 1e6) return sign + (abs / 1e6).toFixed(abs >= 1e7 ? 0 : 1).replace(/\.0$/, '') + 'm';
  if (abs >= 1e3) return sign + (abs / 1e3).toFixed(abs >= 1e4 ? 0 : 1).replace(/\.0$/, '') + 'k';
  return Math.abs(v) < 10 ? v.toFixed(1) : Math.round(v).toString();
}

// Build per-(group, hour) data. Returns:
//   { groupKeys: string[], byKey: { [`${g}|${h}`]: { metric → value } } }
//
// `proposed_open_tables` is now resolved per (date, dow) rather than a
// flat per-hour value, so weekday and weekend shifts can differ.
function aggregateHourly(rows, mode, preferUtil, shifts) {
  // First pass — bucket by (date, hour). Each bucket records its
  // day-type (WD/Fri/Sat/Sun) derived from the date string so
  // proposed_open_tables can be looked up per-bucket.
  const dateHour = new Map();
  for (const r of rows) {
    const hour = Number(r.hour);
    if (!Number.isFinite(hour)) continue;
    const k = r.date + '|' + hour;
    let b = dateHour.get(k);
    if (!b) {
      b = {
        date: r.date,
        dayType: dayTypeForDate(r.date),
        hour,
        patron_hours: 0,
        openhours_sum: 0,
        theo_win: 0,
        activeTables: new Set(),
        scheduling: 0,
        capacity: 0,
      };
      dateHour.set(k, b);
    }
    // Aligned-schema field names (see src/performance/utils/dataSource.js):
    //   openhours = renamed from adj_openhours
    //   theo      = renamed from theo_win (hourly source)
    //   table     = renamed from newtable
    b.patron_hours   += Number(r.patronhrs) || 0;
    b.openhours_sum  += Number(r.openhours) || 0;
    b.theo_win       += Number(r.theo) || 0;
    // Count distinct OPEN tables by gametype+table — a bare table
    // number is reused across gametypes, so keying on it alone would
    // merge two physical tables into one and undercount.
    if ((Number(r.openhours) || 0) > 0) b.activeTables.add(gametypeTableKey(r.gametype, r.table));
    if (Number(r.spread)     === 1) b.scheduling += 1;
    // table_capacity = Σ floorday (per-hour floor capacity).
    b.capacity += Number(r.floorday) || 0;
  }

  // Determine the group key for the selected aggregation mode.
  //   'date'   → grouped by exact date
  //   'dow'    → grouped by day-type (WD/Fri/Sat/Sun)
  //   'agg'    → single '__all' group, averaged across the date range
  const groupOf = (b) =>
    mode === 'date' ? b.date :
    mode === 'dow'  ? b.dayType :
                      '__all';

  // Second pass — accumulate (group, hour) sums + counts. For dow/agg
  // modes we also accumulate the per-day proposed count so the result
  // reflects the actual mix of day-types in the date range.
  const acc = new Map();
  for (const b of dateHour.values()) {
    const g = groupOf(b);
    const k = g + '|' + b.hour;
    let m = acc.get(k);
    if (!m) {
      m = {
        group: g, hour: b.hour, dayType: b.dayType,
        patron_hours: 0, openhours_sum: 0, theo_win: 0,
        activeTables: 0, scheduling: 0, capacity: 0,
        proposed_sum: 0, n: 0,
      };
      acc.set(k, m);
    }
    m.patron_hours  += b.patron_hours;
    m.openhours_sum += b.openhours_sum;
    m.theo_win      += b.theo_win;
    m.activeTables  += b.activeTables.size;
    m.scheduling    += b.scheduling;
    m.capacity      += b.capacity;
    m.proposed_sum  += sumProposedAtHour(shifts, b.hour, b.dayType);
    m.n += 1;
  }

  // Overall reference lines across the whole filtered range — used by
  // the secondary charts (headcount / theo per open hour). Independent
  // of grouping mode so each mini chart compares against the same bar.
  let overallPatron = 0;
  let overallOpen = 0;
  let overallTheo = 0;
  for (const b of dateHour.values()) {
    overallPatron += b.patron_hours;
    overallOpen   += b.openhours_sum;
    overallTheo   += b.theo_win;
  }
  const overallAvgHeadcount   = overallOpen > 0 ? overallPatron / overallOpen : 0;
  const overallAvgTheoPerHour = overallOpen > 0 ? overallTheo   / overallOpen : 0;

  // Proposed-basis reference lines — total demand / total proposed
  // tables across the range. `proposed_sum` only exists on the acc
  // buckets (it's shift-derived), so sum it from there. The patron /
  // theo totals match overallPatron / overallTheo (same data, regrouped).
  let overallProposed = 0;
  for (const m of acc.values()) overallProposed += m.proposed_sum;
  const overallAvgHeadcountProposed = overallProposed > 0 ? overallPatron / overallProposed : 0;
  const overallAvgTheoProposed      = overallProposed > 0 ? overallTheo   / overallProposed : 0;

  const byKey = {};
  const groupSet = new Set();
  for (const m of acc.values()) {
    const n = Math.max(1, m.n);
    // For date mode there's exactly one row per (date, hour) — sums and
    // means coincide. For dow/agg modes we report means.
    const useMean = mode !== 'date';
    const div = useMean ? n : 1;
    const ph = m.patron_hours / div;
    byKey[m.group + '|' + m.hour] = {
      patron_hours:           ph,
      optimal_open_hours:     preferUtil > 0 ? ph / preferUtil : 0,
      actual_open_tables:     m.activeTables / div,
      scheduling_open_tables: m.scheduling / div,
      table_capacity:         m.capacity / div,
      // 'date' mode: m.proposed_sum/1 == per-day count (correct).
      // 'dow'  mode: averaged over dates of that dow — but since the
      //              shift count is constant per dow, this divides
      //              identical values and yields the same dow count.
      // 'agg'  mode: weighted average across all (date, hour) buckets,
      //              correctly reflecting the day-type mix of the range.
      proposed_open_tables:   m.proposed_sum / div,
      // Ratio for the secondary headcount-per-open-hour chart. The
      // division cancels n, so this is mode-independent.
      // Denominator = openhours_sum (open-table-hours) ⇒ "per ACTUAL
      // open table".
      headcount_per_open_hour: m.openhours_sum > 0
        ? m.patron_hours / m.openhours_sum
        : 0,
      // Same pattern for theo per open hour — drives the third
      // secondary chart underneath the headcount chart.
      theo_per_open_hour: m.openhours_sum > 0
        ? m.theo_win / m.openhours_sum
        : 0,
      // Proposed-basis variants — same numerators, but divided by the
      // manually-assigned shift table count (proposed_sum) instead of
      // actual open-table-hours. Answers "if I deploy my proposed
      // roster, what's the headcount / theo per table?". n cancels.
      headcount_per_proposed_table: m.proposed_sum > 0
        ? m.patron_hours / m.proposed_sum
        : 0,
      theo_per_proposed_table: m.proposed_sum > 0
        ? m.theo_win / m.proposed_sum
        : 0,
    };
    groupSet.add(m.group);
  }

  // Stable group ordering.
  let groupKeys = [...groupSet];
  if (mode === 'date') groupKeys.sort();
  else if (mode === 'dow') groupKeys = DAY_TYPES.filter((d) => groupSet.has(d));
  else groupKeys = ['__all'];

  return {
    groupKeys, byKey, mode,
    overallAvgHeadcount, overallAvgTheoPerHour,
    overallAvgHeadcountProposed, overallAvgTheoProposed,
  };
}

// Return a new `aggregated` shape containing only the rows for one
// group key. Used by the DoW-split renderer to feed each mini chart
// just its own day-type's data — the existing DemandChart /
// HeadcountPerHourChart components then render a clean single 24-hour
// block per instance instead of the concatenated multi-block view.
function sliceAggregatedToGroup(aggregated, groupKey) {
  const out = {
    groupKeys: aggregated.groupKeys.includes(groupKey) ? [groupKey] : [],
    byKey: {},
    mode: aggregated.mode,
    overallAvgHeadcount: aggregated.overallAvgHeadcount,
    overallAvgTheoPerHour: aggregated.overallAvgTheoPerHour,
    overallAvgHeadcountProposed: aggregated.overallAvgHeadcountProposed,
    overallAvgTheoProposed: aggregated.overallAvgTheoProposed,
  };
  const prefix = groupKey + '|';
  for (const k of Object.keys(aggregated.byKey)) {
    if (k.startsWith(prefix)) out.byKey[k] = aggregated.byKey[k];
  }
  return out;
}

export default function HourlyDemand({ hourlyData }) {
  const [grouping, setGrouping] = useState('agg');
  const [preferUtil, setPreferUtil] = useState(1.2);
  // When ON, patron_hours + optimal_open_hours render against a right-
  // side y-axis. Useful when the table-count metrics (actual_open_tables
  // etc.) have a very different magnitude than patron-hours and would
  // otherwise either dwarf or be dwarfed by the bar series.
  const [splitYAxis, setSplitYAxis] = useState(false);
  // Denominator basis for the Headcount-/Theo-per-table secondary
  // charts. 'actual' = per actually-open table; 'proposed' = per
  // manually-assigned shift table; 'both' = render both side-by-side
  // for direct comparison (only available in 'agg' / By Hour grouping
  // — the dow + date layouts already split the row into 4 mini-cards
  // and can't fit a 2-up actual/proposed pair on top).
  const [headcountBasis, setHeadcountBasis] = useState('actual');
  // Snap back to a single-basis view when the user picks a grouping
  // that can't accommodate the side-by-side "both" layout.
  useEffect(() => {
    if (grouping !== 'agg' && headcountBasis === 'both') {
      setHeadcountBasis('actual');
    }
  }, [grouping, headcountBasis]);
  const [selectedMetrics, setSelectedMetrics] = useState([
    'patron_hours',
    'actual_open_tables',
    'table_capacity',
  ]);
  // Initialise from localStorage if a saved roster exists; otherwise
  // start from the default roster.
  const [shifts, setShifts] = useState(
    () => loadStoredShifts() || DEFAULT_SHIFTS.map((s) => ({ ...s }))
  );

  // Persist the roster on every change so added / edited / removed
  // shifts survive a page refresh.
  useEffect(() => {
    try {
      window.localStorage.setItem(SHIFTS_STORAGE_KEY, JSON.stringify(shifts));
    } catch (e) {
      // Non-fatal: storage full / unavailable. The UI keeps working,
      // it just won't persist this session.
    }
  }, [shifts]);

  const aggregated = useMemo(
    () => aggregateHourly(hourlyData || [], grouping, preferUtil, shifts),
    [hourlyData, grouping, preferUtil, shifts]
  );

  // Scheduling-open-hours per day-type (mean per day) — drives the
  // Shift Assignment comparison row. Computed independently of the
  // active `grouping` so the per-dow comparison is always available.
  // Method: Σ (spread === 1) rows by dow ÷ count of distinct dates of
  // that dow → "average scheduling-table-hours per day of that type".
  const schedulingByDay = useMemo(() => {
    const acc = { WD: { sum: 0, dates: new Set() }, Fri: { sum: 0, dates: new Set() },
                  Sat: { sum: 0, dates: new Set() }, Sun: { sum: 0, dates: new Set() } };
    for (const r of (hourlyData || [])) {
      const dt = dayTypeForDate(r.date);
      if (!acc[dt]) continue;
      if (Number(r.spread) === 1) acc[dt].sum += 1;
      acc[dt].dates.add(r.date);
    }
    const out = {};
    for (const d of DAY_TYPES) {
      const n = acc[d].dates.size;
      out[d] = n > 0 ? acc[d].sum / n : 0;
    }
    return out;
  }, [hourlyData]);

  const toggleMetric = (key) =>
    setSelectedMetrics((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]
    );

  const updateShift = (id, patch) =>
    setShifts((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));

  const removeShift = (id) => setShifts((prev) => prev.filter((s) => s.id !== id));

  const addShift = () => {
    const id = 'X' + Date.now().toString(36).slice(-4);
    setShifts((prev) => [
      ...prev,
      {
        id,
        name: 'New 8h',
        startHour: 7,
        endHour: 15,
        tablesWD: 0, tablesFri: 0, tablesSat: 0, tablesSun: 0,
      },
    ]);
  };

  const resetShifts = () => setShifts(DEFAULT_SHIFTS.map((s) => ({ ...s })));

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, mb: 2 }}>
      {/* Controls toolbar. Three labeled segments laid out as siblings
          on a single horizontal row. Each segment uses the SAME label
          style above + the SAME 40px-tall control row below, so all
          controls share one baseline. Wraps to the next line on narrow
          viewports without breaking alignment. */}
      <Box
        sx={{
          ...flatCard,
          p: 2,
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'flex-end',
          columnGap: 3,
          rowGap: 2,
        }}
      >
        {/* Segment 1 — Grouping */}
        <ControlSegment label="Group By">
          <ToggleButtonGroup
            value={grouping}
            exclusive
            size="small"
            onChange={(_, v) => v && setGrouping(v)}
            sx={pillToggleGroup}
          >
            <ToggleButton value="date">By Day × Hour</ToggleButton>
            <ToggleButton value="dow">By DoW × Hour</ToggleButton>
            <ToggleButton value="agg">By Hour</ToggleButton>
          </ToggleButtonGroup>
        </ControlSegment>

        {/* Segment 2 — Utilization input. Matches the GROUP BY pill
            chrome (transparent bg, hairline border) so the toolbar
            reads as one consistent control vocabulary. */}
        <ControlSegment label="Utilization">
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              height: 44,
              gap: 1.4,
              px: 2,
              bgcolor: 'rgba(255, 255, 255, 0.02)',
              border: '1px solid rgba(255, 255, 255, 0.06)',
              borderRadius: 1.2,
              transition: 'border-color 180ms ease',
              '&:hover': { borderColor: 'rgba(255, 255, 255, 0.16)' },
              '&:focus-within': { borderColor: T.accentPrimary },
            }}
          >
            <Typography
              sx={{
                color: T.textTertiary,
                fontSize: 18,
                fontWeight: 600,
                letterSpacing: 0.4,
                whiteSpace: 'nowrap',
              }}
            >
              Prefer Util
            </Typography>
            <TextField
              type="number"
              value={preferUtil}
              onChange={(e) => {
                const v = parseFloat(e.target.value);
                setPreferUtil(Number.isFinite(v) ? v : 0);
              }}
              inputProps={{ min: 0.1, max: 10, step: 0.1 }}
              sx={{
                width: 76,
                '& .MuiOutlinedInput-input': {
                  paddingY: '4px',
                  fontSize: 22,
                  color: T.textPrimary,
                  textAlign: 'center',
                  fontWeight: 700,
                },
                '& .MuiOutlinedInput-notchedOutline': { border: 'none' },
                // Drop browser-native number spinners.
                '& input[type=number]': { MozAppearance: 'textfield' },
                '& input[type=number]::-webkit-outer-spin-button': {
                  WebkitAppearance: 'none', margin: 0,
                },
                '& input[type=number]::-webkit-inner-spin-button': {
                  WebkitAppearance: 'none', margin: 0,
                },
              }}
            />
          </Box>
        </ControlSegment>

        {/* Segment 3 — Metrics multi-select. Switched from Chip cloud
            to a ToggleButtonGroup so the chrome matches GROUP BY
            exactly: same container, same active-tab underline, same
            inactive treatment. Tiny color dot stays as a per-metric
            identifier inside each button. */}
        <ControlSegment
          label="Metrics"
          sublabel="click to toggle"
          sx={{ flex: 1, minWidth: 0 }}
        >
          <ToggleButtonGroup
            value={selectedMetrics}
            // No `exclusive` → multi-select. ECharts series rebuild on
            // every selectedMetrics change so the chart updates live.
            onChange={(_, next) => setSelectedMetrics(next || [])}
            size="small"
            sx={{ ...pillToggleGroup, flexWrap: 'wrap' }}
          >
            {METRICS.map((m) => (
              <ToggleButton
                key={m.key}
                value={m.key}
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 0.8,
                }}
              >
                <Box
                  component="span"
                  sx={{
                    width: 10,
                    height: 10,
                    borderRadius: '50%',
                    bgcolor: m.color,
                    flexShrink: 0,
                  }}
                />
                {m.label}
              </ToggleButton>
            ))}
          </ToggleButtonGroup>
        </ControlSegment>

        {/* Y-Axis toggle was here — relocated to the DemandChart's
            own card header (top-right) since it's chart-local and
            doesn't affect anything outside that one chart. */}

        {/* Segment 4 — Per-table basis for the Headcount + Theo
            secondary charts. 'Actual' divides by actually-open tables;
            'Proposed' divides by the manually-assigned shift roster
            (proposed_open_tables) so you can see headcount/theo per
            table under your planned staffing. */}
        <ControlSegment label="Per-table basis" sublabel="headcount + theo">
          <ToggleButtonGroup
            value={headcountBasis}
            exclusive
            size="small"
            onChange={(_, v) => v && setHeadcountBasis(v)}
            sx={pillToggleGroup}
          >
            <ToggleButton value="actual">Actual open</ToggleButton>
            <ToggleButton value="proposed">Proposed</ToggleButton>
            {/* "Both" renders the Actual + Proposed charts side-by-side
                for direct comparison — only valid in the By Hour
                grouping (the dow/date layouts already split the row
                into 4 day-type cards and can't fit a 2-up pair). */}
            <ToggleButton value="both" disabled={grouping !== 'agg'}>Both</ToggleButton>
          </ToggleButtonGroup>
        </ControlSegment>
      </Box>

      {/* Demand chart (left) + Shift configurator (right) — locked
          at 75 / 25 in the By Hour (`agg`) grouping. Use the exact
          3fr / 1fr ratio so the split stays predictable across
          viewport widths.
          The Shift Assignment panel is only meaningful in the By Hour
          grouping — the date / dow groupings already split the row
          into multiple day-type blocks and the per-day shift roster
          doesn't apply 1:1. For those groupings the chart goes
          full-width and the shift panel is omitted entirely. */}
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: {
            xs: '1fr',
            md: grouping === 'agg' ? '3fr 1fr' : '1fr',
          },
          gap: 1.5,
          alignItems: 'stretch',
        }}
      >
        {/* When grouping by DoW, render the new 4-up split version
            (one mini demand + one mini headcount chart per day-type:
            WD / Fri / Sat / Sun). Otherwise use the original combined
            chart. The original line is preserved below in a comment
            so this can be rolled back without re-reading history. */}
        {grouping === 'dow' ? (
          <DemandChartDowSplit
            aggregated={aggregated}
            selectedMetrics={selectedMetrics}
            splitYAxis={splitYAxis}
            setSplitYAxis={setSplitYAxis}
            headcountBasis={headcountBasis}
          />
        ) : (
          <DemandChart
            aggregated={aggregated}
            selectedMetrics={selectedMetrics}
            splitYAxis={splitYAxis}
            setSplitYAxis={setSplitYAxis}
            headcountBasis={headcountBasis}
          />
        )}
        {/* ROLLBACK — original always-combined version:
        <DemandChart aggregated={aggregated} selectedMetrics={selectedMetrics} /> */}
        {/* New spreadsheet-style shift table. To roll back to the
            per-row card layout, comment out this block and uncomment
            the <ShiftTable> block immediately below.
            Hidden in 'date' / 'dow' groupings — the per-day-type shift
            roster only makes sense paired with the single-block "By
            Hour" demand view. */}
        {grouping === 'agg' && (
          <ShiftTableSpreadsheet
            shifts={shifts}
            grouping={grouping}
            schedulingByDay={schedulingByDay}
            onUpdate={updateShift}
            onRemove={removeShift}
            onAdd={addShift}
            onReset={resetShifts}
          />
        )}
        {/* ROLLBACK — previous per-shift card layout:
        <ShiftTable
          shifts={shifts}
          grouping={grouping}
          onUpdate={updateShift}
          onRemove={removeShift}
          onAdd={addShift}
          onReset={resetShifts}
        /> */}
      </Box>
    </Box>
  );
}

// Labeled control segment. Used three times in the controls toolbar
// (Group By / Utilization / Metrics). Renders a small tracked
// uppercase label above its children, with a tiny cyan accent bar in
// front. Every segment shares the same label style and a 40px-tall
// control row, so they align cleanly on a single baseline.
function ControlSegment({ label, sublabel, children, sx }) {
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.2, ...sx }}>
      <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 0.8 }}>
        <Typography
          sx={{
            color: T.textTertiary,
            fontSize: 16,
            fontWeight: 600,
            letterSpacing: 1.6,
            textTransform: 'uppercase',
            lineHeight: 1,
          }}
        >
          {label}
        </Typography>
        {sublabel && (
          <Typography
            sx={{
              color: T.textMuted,
              fontSize: 14,
              fontWeight: 400,
              letterSpacing: 0.4,
              lineHeight: 1,
              ml: 0.4,
            }}
          >
            {sublabel}
          </Typography>
        )}
      </Box>
      {children}
    </Box>
  );
}

// Resolve the metric / avg-key / labels for the Headcount + Theo
// per-table secondary charts from the chosen denominator basis.
//   'actual'   → divide by actually-open table-hours (existing behavior)
//   'proposed' → divide by the manually-assigned shift roster
function perTableChartConfig(basis) {
  const proposed = basis === 'proposed';
  return {
    headcount: {
      metricKey:  proposed ? 'headcount_per_proposed_table' : 'headcount_per_open_hour',
      avgKey:     proposed ? 'overallAvgHeadcountProposed'   : 'overallAvgHeadcount',
      title:      proposed ? 'Headcount per Proposed Table'  : 'Headcount per Open Hour',
      seriesName: proposed ? 'Headcount/proposed'            : 'Headcount/open hr',
      yAxisName:  proposed ? 'Headcount/proposed'            : 'Headcount/open hr',
      valueFormat: (v) => v.toFixed(2),
    },
    theo: {
      metricKey:  proposed ? 'theo_per_proposed_table' : 'theo_per_open_hour',
      avgKey:     proposed ? 'overallAvgTheoProposed'   : 'overallAvgTheoPerHour',
      title:      proposed ? 'Theo per Proposed Table'  : 'Theo per Open Hour',
      seriesName: proposed ? 'Theo/proposed'            : 'Theo/open hr',
      yAxisName:  proposed ? 'Theo/proposed'            : 'Theo/open hr',
      valueFormat: compactNum,
    },
  };
}

// Small chart-header toggle for the demand y-axis: Shared (single
// scale for everything) ↔ Split (patron/optimal hours on a right-side
// axis, table counts on the left). Lives in the card header instead
// of the global toolbar because it only affects this one chart.
function YAxisToggle({ splitYAxis, setSplitYAxis }) {
  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 0.8,
        px: 1.2,
        py: 0.2,
        bgcolor: 'rgba(255, 255, 255, 0.02)',
        border: '1px solid rgba(255, 255, 255, 0.06)',
        borderRadius: 1.2,
        transition: 'border-color 180ms ease',
        '&:hover': { borderColor: 'rgba(255, 255, 255, 0.16)' },
      }}
    >
      <Typography
        sx={{
          color: T.textTertiary,
          fontSize: 11,
          letterSpacing: 0.8,
          textTransform: 'uppercase',
          fontWeight: 700,
          lineHeight: 1,
        }}
      >
        Y-Axis
      </Typography>
      <FormControlLabel
        control={
          <Switch
            size="small"
            checked={splitYAxis}
            onChange={(e) => setSplitYAxis(e.target.checked)}
          />
        }
        label={splitYAxis ? 'Split' : 'Shared'}
        sx={{
          m: 0,
          '& .MuiFormControlLabel-label': {
            color: T.textPrimary,
            fontSize: 14,
            fontWeight: 600,
            ml: 0.3,
          },
        }}
      />
    </Box>
  );
}

// Single ECharts chart. X-axis concatenates one 24-hour block per
// group; a second x-axis line labels each block (date or dow) and
// places a tall tick at the block boundary (h === 6).
// `splitYAxis` — when true, patron_hours + optimal_open_hours bind to a
// right-side y-axis and the rest stay on the left. Independent yMax
// computation per side prevents one scale from clipping the other.
function DemandChart({ aggregated, selectedMetrics, splitYAxis = false, setSplitYAxis = () => {}, headcountBasis = 'actual' }) {
  // For single-basis modes, perTableCfg picks the right metric/avg/labels.
  // For 'both', resolve the actual + proposed configs separately so each
  // half of the side-by-side pair reads the correct dimension.
  const perTableCfg = perTableChartConfig(
    headcountBasis === 'both' ? 'actual' : headcountBasis
  );
  const perTableCfgActual   = perTableChartConfig('actual');
  const perTableCfgProposed = perTableChartConfig('proposed');
  const showBoth = headcountBasis === 'both';
  const ref = useRef(null);
  const instRef = useRef(null);

  useEffect(() => {
    if (!ref.current) return;
    let inst = echarts.getInstanceByDom(ref.current);
    if (!inst) inst = echarts.init(ref.current, 'dark');
    instRef.current = inst;
    const ro = new ResizeObserver(() => requestAnimationFrame(() => inst && inst.resize()));
    ro.observe(ref.current);
    return () => {
      ro.disconnect();
      inst.dispose();
      instRef.current = null;
    };
  }, []);

  useEffect(() => {
    const inst = instRef.current;
    if (!inst || selectedMetrics.length === 0 || !aggregated.groupKeys.length) {
      if (inst) inst.clear();
      return;
    }

    const { groupKeys, byKey, mode } = aggregated;

    // Flat x positions: one entry per (group, hour-in-HOUR_ORDER).
    const xAxisData = [];        // hour numbers as strings
    const xAxisGroupData = [];   // group label, only at middle slot
    const groupSeparates = [];   // boolean, true at the start of each group

    groupKeys.forEach((g) => {
      HOUR_ORDER.forEach((h, i) => {
        xAxisData.push(String(h));
        // Place the group label near the middle of the block.
        const labelText =
          i === 9 // index 9 in HOUR_ORDER === hour 15 (mid of 6→5 cycle)
            ? (mode === 'date' ? formatDateLabel(g) : g === '__all' ? '' : g)
            : '';
        xAxisGroupData.push(labelText);
        groupSeparates.push(i === 0); // tall tick at the start of each group
      });
    });

    // Build one ECharts series per selected metric. Each series has
    // groupKeys.length × 24 points laid out the same way as xAxisData.
    //
    // Series-type policy:
    //   • patron_hours          → BAR (demand baseline)
    //   • optimal_open_hours    → BAR (paired with patron_hours)
    //   • everything else       → LINE (supply / capacity curves)
    //
    // ECharts groups bar series of the same x-axis side-by-side by
    // default, so when both bar metrics are selected they render as
    // a clustered bar pair per hour.
    // Keys whose series bind to the right-side y-axis when split is on.
    // Anything else stays on the left axis.
    const RIGHT_AXIS_KEYS = new Set(['patron_hours', 'optimal_open_hours']);

    const series = selectedMetrics.map((mk) => {
      const meta = METRICS.find((m) => m.key === mk);
      const data = [];
      groupKeys.forEach((g) => {
        HOUR_ORDER.forEach((h) => {
          const cell = byKey[g + '|' + h];
          data.push(cell ? Number(cell[mk]) : null);
        });
      });
      // yAxisIndex is only meaningful when yAxis is an array. We always
      // emit it so toggling between single- and dual-axis modes doesn't
      // require remembering to add/remove the field per series — when
      // there's only one axis, ECharts maps every index to the lone one.
      const yAxisIndex = splitYAxis && RIGHT_AXIS_KEYS.has(mk) ? 1 : 0;

      // Patron hours = continuous light-grey histogram with a black
      // border. barCategoryGap 0% makes adjacent hour bars touch (no
      // gaps), and it sits at z:1 so other series draw on top.
      if (mk === 'patron_hours') {
        return {
          name: meta.label,
          type: 'bar',
          barCategoryGap: '0%',
          yAxisIndex,
          itemStyle: {
            color: '#6b7280',
            borderColor: '#000000',
            borderWidth: 1,
          },
          emphasis: { itemStyle: { color: '#9ca3af' } },
          z: 1,
          data,
        };
      }
      // Optimal open hours = same continuous-histogram format as
      // patron, just a different color. barCategoryGap 0% + barGap
      // -100% makes optimal overlay patron at full category width.
      // Since optimal = patron / preferUtil < patron, the grey
      // patron bars stick out above optimal, exposing the gap
      // between actual demand and the optimal target.
      if (mk === 'optimal_open_hours') {
        return {
          name: meta.label,
          type: 'bar',
          barCategoryGap: '0%',
          barGap: '-100%',
          yAxisIndex,
          itemStyle: {
            color: meta.color,
            borderColor: '#000000',
            borderWidth: 1,
          },
          emphasis: { itemStyle: { color: meta.color } },
          z: 2,
          data,
        };
      }
      return {
        name: meta.label,
        type: 'line',
        smooth: false,
        symbol: 'circle',
        symbolSize: 4,
        showSymbol: false,
        yAxisIndex,
        lineStyle: { width: 2.4, color: meta.color },
        itemStyle: { color: meta.color },
        data,
        // Connect across the tiny gap between groups — set to false if
        // you'd rather see hard discontinuities at block boundaries.
        connectNulls: false,
        z: 2, // lines render above bars
      };
    });

    // Dynamic y-axis scaled per side. When the split is OFF, both sides
    // collapse into one combined scale (same behavior as before). When
    // ON, each side uses only the series bound to it.
    const computeYMax = (filterFn) => {
      const vals = series.filter(filterFn).flatMap((s) => s.data).filter((v) => Number.isFinite(v));
      const max = vals.length ? Math.max(...vals) : 100;
      return Math.max(10, Math.ceil((max * 1.1) / 10) * 10);
    };
    const yMaxLeft  = splitYAxis
      ? computeYMax((s) => s.yAxisIndex === 0)
      : computeYMax(() => true);
    const yMaxRight = splitYAxis
      ? computeYMax((s) => s.yAxisIndex === 1)
      : yMaxLeft;

    inst.setOption(
      {
        backgroundColor: 'transparent',
        animation: false,
        tooltip: {
          trigger: 'axis',
          backgroundColor: 'rgba(30, 37, 51, 0.98)',
          borderColor: 'rgba(0, 212, 255, 0.40)',
          borderWidth: 1,
          padding: [10, 14],
          textStyle: { color: '#fff', fontSize: 21 },
          valueFormatter: (v) => (v == null ? '–' : compactNum(v)),
        },
        legend: {
          show: true,
          textStyle: { color: 'rgba(255,255,255,0.78)', fontSize: 21 },
          top: 6,
          icon: 'roundRect',
          itemWidth: 16,
          itemHeight: 10,
        },
        grid: { left: 60, right: 30, top: 40, bottom: 70, containLabel: false },
        xAxis: [
          {
            // Inner axis: hour-of-day labels under each tick.
            type: 'category',
            data: xAxisData,
            position: 'bottom',
            axisTick: { length: 0 },
            axisLabel: { margin: 10, color: 'rgba(232,234,250,0.55)', fontSize: 18 },
            axisLine: { lineStyle: { color: 'rgba(255,255,255,0.08)' } },
          },
          {
            // Outer axis: group label centered under each block, with a
            // tall separator tick at each block start.
            type: 'category',
            data: xAxisGroupData,
            position: 'bottom',
            axisLine: { onZero: false, show: false },
            axisTick: {
              show: true,
              length: 40,
              interval: (idx) => groupSeparates[idx],
              lineStyle: { color: 'rgba(255,255,255,0.12)', width: 1 },
            },
            axisLabel: {
              margin: 36,
              align: 'center',
              verticalAlign: 'top',
              interval: 0,
              formatter: (value) => (value && value.trim ? value.trim() : ''),
              color: 'rgba(232,234,250,0.90)',
              fontSize: 23,
              fontWeight: 'bold',
            },
          },
        ],
        // yAxis: always an array so each series's yAxisIndex resolves
        // without conditional plumbing. When splitYAxis is OFF we still
        // emit two axes but the right one is hidden + identical-scale,
        // so the rendering looks single-axis but the structure is uniform.
        yAxis: splitYAxis
          ? [
              {
                type: 'value',
                name: 'Tables / counts',
                nameTextStyle: { color: 'rgba(232,234,250,0.75)', fontSize: 16 },
                position: 'left',
                max: yMaxLeft,
                axisLabel: { color: 'rgba(232,234,250,0.55)', fontSize: 18, formatter: compactNum },
                splitLine: { lineStyle: { color: 'rgba(255,255,255,0.04)', type: 'dashed' } },
                axisLine: { show: false },
              },
              {
                type: 'value',
                name: 'Patron / open hours',
                nameTextStyle: { color: 'rgba(232,234,250,0.75)', fontSize: 16 },
                position: 'right',
                max: yMaxRight,
                axisLabel: { color: 'rgba(232,234,250,0.55)', fontSize: 18, formatter: compactNum },
                // Right-side gridlines off — left axis already owns the
                // gridlines so doubling them up reads as noise.
                splitLine: { show: false },
                axisLine: { show: false },
              },
            ]
          : [
              {
                type: 'value',
                max: yMaxLeft,
                axisLabel: { color: 'rgba(232,234,250,0.55)', fontSize: 18, formatter: compactNum },
                splitLine: { lineStyle: { color: 'rgba(255,255,255,0.04)', type: 'dashed' } },
                axisLine: { show: false },
              },
              // Hidden mirror axis — keeps `yAxisIndex: 1` references
              // valid so we don't have to strip them when the toggle is
              // off. zlevel ensures it never overdraws the visible axis.
              {
                type: 'value',
                show: false,
                max: yMaxLeft,
              },
            ],
        // Slider stays hidden by default but inside-zoom lets users scrub
        // across long date-mode blocks with the trackpad.
        dataZoom: [
          { type: 'slider', start: 0, end: 100, bottom: 10, height: 12, show: groupKeys.length > 3 },
          { type: 'inside' },
        ],
        series,
      },
      true
    );
  }, [aggregated, selectedMetrics, splitYAxis]);

  if (selectedMetrics.length === 0) {
    return (
      <Box
        sx={{
          ...flatCard,
          p: 4,
          textAlign: 'center',
          color: T.textTertiary,
          fontSize: 23,
          letterSpacing: 0.4,
        }}
      >
        Select one or more metrics above to render the demand chart.
      </Box>
    );
  }

  return (
    <Box sx={{ ...flatCard, p: 2 }}>
      <Box sx={{ ...cardHeader, display: 'flex', alignItems: 'center' }}>
        <Box sx={cardTitleAccentSx} />
        <Typography sx={cardTitleSx}>Hourly Demand</Typography>
        <Box sx={{ flex: 1 }} />
        {/* Y-axis split toggle — chart-local (only affects this Hourly
            Demand chart), so it lives in the card header instead of
            the global toolbar. */}
        <YAxisToggle splitYAxis={splitYAxis} setSplitYAxis={setSplitYAxis} />
      </Box>
      <div ref={ref} style={{ width: '100%', height: 600 }} />
      {/* The headcount-per-table chart lives inside the same card,
          separated only by a thin top border. It mirrors the grouping
          structure of the demand chart above (same group blocks, same
          x-axis layout). Denominator (actual vs proposed open tables)
          follows the headcountBasis toggle. When basis === 'both' the
          Actual and Proposed variants render side-by-side in a 2-up
          grid for direct comparison. */}
      {showBoth ? (
        <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
          <HeadcountPerHourChart aggregated={aggregated} {...perTableCfgActual.headcount} />
          <HeadcountPerHourChart aggregated={aggregated} {...perTableCfgProposed.headcount} />
        </Box>
      ) : (
        <HeadcountPerHourChart aggregated={aggregated} {...perTableCfg.headcount} />
      )}
      {/* Theo per table — third secondary chart in the same card. */}
      {showBoth ? (
        <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
          <HeadcountPerHourChart aggregated={aggregated} {...perTableCfgActual.theo} />
          <HeadcountPerHourChart aggregated={aggregated} {...perTableCfgProposed.theo} />
        </Box>
      ) : (
        <HeadcountPerHourChart aggregated={aggregated} {...perTableCfg.theo} />
      )}
    </Box>
  );
}

// "Headcount per Open Hour" — secondary chart that sits inside the
// Hourly Demand card (no separate wrapper). Combines THREE things:
//   • Per-hour value:   patron_hours / adj_openhours, in HOUR_ORDER
//   • Overall 24-hr avg: the same ratio across the entire date range
//   • Difference bars:   green if hour > avg, red if hour < avg
//
// Two ECharts grids share one canvas: the top grid renders the line +
// avg markline; the bottom grid renders the diverging diff bars. The
// shared x-axis (category) keeps both views vertically aligned.
// Parameterized so both the Headcount and Theo per-open-hour charts
// can reuse the same body. `metricKey`/`avgKey` select which fields
// to read from the aggregated payload; the others control labels and
// formatting. Defaults render the original Headcount behavior.
function HeadcountPerHourChart({
  aggregated,
  metricKey = 'headcount_per_open_hour',
  avgKey = 'overallAvgHeadcount',
  seriesName = 'Headcount/open hr',
  yAxisName = 'Headcount/open hr',
  valueFormat = (v) => v.toFixed(2),
  title = 'Headcount per Open Hour',
}) {
  const ref = useRef(null);
  const instRef = useRef(null);

  useEffect(() => {
    if (!ref.current) return;
    let inst = echarts.getInstanceByDom(ref.current);
    if (!inst) inst = echarts.init(ref.current, 'dark');
    instRef.current = inst;
    const ro = new ResizeObserver(() =>
      requestAnimationFrame(() => inst && inst.resize())
    );
    ro.observe(ref.current);
    return () => {
      ro.disconnect();
      inst.dispose();
      instRef.current = null;
    };
  }, []);

  useEffect(() => {
    const inst = instRef.current;
    if (!inst) return;

    const { groupKeys, byKey, mode } = aggregated;
    const rawAvg = Number(aggregated[avgKey]) || 0;
    const avg = +rawAvg.toFixed(3);
    const avgLabel = valueFormat(avg);

    // Build the same concatenated x-axis structure as the demand chart:
    // one 24-hour block per group, with a group label centered under
    // each block and a tall tick at the block boundary (h === 6).
    const xAxisData = [];
    const xAxisGroupData = [];
    const groupSeparates = [];
    const values = [];
    const diffs = [];

    groupKeys.forEach((g) => {
      HOUR_ORDER.forEach((h, i) => {
        xAxisData.push(String(h).padStart(2, '0'));
        const label =
          i === 9
            ? (mode === 'date' ? formatDateLabel(g) : g === '__all' ? '' : g)
            : '';
        xAxisGroupData.push(label);
        groupSeparates.push(i === 0);

        const cell = byKey[g + '|' + h];
        const v = cell && Number.isFinite(cell[metricKey])
          ? cell[metricKey]
          : null;
        values.push(v == null ? null : +v.toFixed(3));
        // Variance is now expressed as a fraction of the overall avg
        // (e.g. +0.10 = "10% above the 24-hr avg"). Formatted as a
        // percentage on the y-axis + tooltip below.
        diffs.push(
          v == null || rawAvg <= 0
            ? null
            : +((v - rawAvg) / rawAvg).toFixed(4)
        );
      });
    });

    inst.setOption(
      {
        backgroundColor: 'transparent',
        animation: false,
        tooltip: {
          trigger: 'axis',
          axisPointer: { type: 'shadow' },
          backgroundColor: 'rgba(15, 20, 25, 0.98)',
          borderColor: 'rgba(0, 212, 255, 0.40)',
          borderWidth: 1,
          padding: [10, 14],
          textStyle: { color: '#fff', fontSize: 21 },
          formatter: (params) => {
            if (!params || !params.length) return '';
            const idx = params[0].dataIndex;
            const hour = params[0].axisValue;
            const groupIdx = Math.floor(idx / HOUR_ORDER.length);
            const groupKey = groupKeys[groupIdx];
            const groupLabel = groupKey === '__all'
              ? 'All hours'
              : mode === 'date'
                ? formatDateLabel(groupKey)
                : groupKey;
            const valueRow = params.find((p) => p.seriesName === seriesName);
            const diffRow  = params.find((p) => p.seriesName === 'Δ vs 24-hr avg');
            const v = valueRow ? valueRow.value : null;
            const d = diffRow ? diffRow.value : null;
            const dColor = d != null && d >= 0 ? T.chartGreen : T.chartRed;
            return `
              <div style="padding:2px 4px">
                <div style="color:rgba(255,255,255,0.55);font-size:20px;letter-spacing:0.6px;text-transform:uppercase;margin-bottom:6px">
                  ${groupLabel} · Hour ${hour}
                </div>
                <div style="display:flex;justify-content:space-between;gap:14px;margin-bottom:3px;font-size:23px">
                  <span style="color:rgba(255,255,255,0.70)">${seriesName}</span>
                  <span style="color:#fff;font-weight:700">${v == null ? '–' : valueFormat(v)}</span>
                </div>
                <div style="display:flex;justify-content:space-between;gap:14px;margin-bottom:3px;font-size:23px">
                  <span style="color:rgba(255,255,255,0.70)">24-hr avg</span>
                  <span style="color:#fff;font-weight:700">${avgLabel}</span>
                </div>
                <div style="display:flex;justify-content:space-between;gap:14px;font-size:23px">
                  <span style="color:rgba(255,255,255,0.70)">Δ vs avg</span>
                  <span style="color:${dColor};font-weight:700">${d == null ? '–' : (d >= 0 ? '+' : '') + (d * 100).toFixed(1) + '%'}</span>
                </div>
              </div>
            `;
          },
        },
        legend: {
          show: true,
          textStyle: { color: 'rgba(255,255,255,0.78)', fontSize: 21 },
          top: 6,
          icon: 'roundRect',
          itemWidth: 16,
          itemHeight: 10,
        },
        // Two stacked panels. The top shows the line + avg mark line;
        // the bottom shows the per-bucket diff bars. They share the
        // concatenated x-axis structure.
        // Two grids of roughly-equal vertical room. Previously the diff
        // bars only got 20% which crushed the labels into illegibility.
        // 45 / 40 split with comfortable gutters gives both panels room
        // to breathe and lets ECharts space the y-ticks properly.
        grid: [
          // Diff bars now get more vertical room (38/48 split + small
          // gap) so individual ±0.1 bars are readable instead of
          // crushed into a thin strip.
          { left: 90, right: 36, top: 56,    height: '38%' },
          { left: 90, right: 36, top: '54%', height: '46%', bottom: 60 },
        ],
        xAxis: [
          // Top grid (line) — inner axis labels hidden (the bottom grid
          // owns the labels), but tall separator ticks still show so
          // the block boundaries are visible.
          {
            type: 'category',
            gridIndex: 0,
            data: xAxisData,
            axisTick: {
              show: groupKeys.length > 1,
              length: 8,
              interval: (idx) => groupSeparates[idx],
              lineStyle: { color: 'rgba(255,255,255,0.10)', width: 1 },
            },
            axisLabel: { show: false },
            axisLine: { lineStyle: { color: 'rgba(255,255,255,0.08)' } },
          },
          {
            type: 'category',
            gridIndex: 0,
            data: xAxisData,
            position: 'top',
            show: false,
          },
          // Bottom grid (bars) — inner hour labels.
          {
            type: 'category',
            gridIndex: 1,
            data: xAxisData,
            axisTick: { length: 0 },
            axisLabel: {
              margin: 10,
              color: 'rgba(255,255,255,0.55)',
              fontSize: 18,
              // Auto-skip ticks when blocks pile up (date mode with N>3).
              interval: groupKeys.length <= 1 ? 0 : 'auto',
            },
            axisLine: { lineStyle: { color: 'rgba(255,255,255,0.08)' } },
          },
          // Second outer axis on the bottom grid — group labels centered
          // under each 24-hour block, tall separator ticks at boundary.
          {
            type: 'category',
            gridIndex: 1,
            data: xAxisGroupData,
            position: 'bottom',
            axisLine: { onZero: false, show: false },
            axisTick: {
              show: groupKeys.length > 1,
              length: 38,
              interval: (idx) => groupSeparates[idx],
              lineStyle: { color: 'rgba(255,255,255,0.12)', width: 1 },
            },
            axisLabel: {
              margin: 32,
              align: 'center',
              verticalAlign: 'top',
              interval: 0,
              formatter: (value) => (value && value.trim ? value.trim() : ''),
              color: 'rgba(255,255,255,0.90)',
              fontSize: 23,
              fontWeight: 'bold',
            },
          },
        ],
        yAxis: [
          {
            type: 'value',
            gridIndex: 0,
            name: yAxisName,
            nameTextStyle: { color: 'rgba(255,255,255,0.60)', fontSize: 20, padding: [0, 0, 8, 0] },
            nameLocation: 'middle',
            nameGap: 56,
            // Constrain to ~4 ticks so labels don't pile up.
            splitNumber: 4,
            axisLabel: {
              color: 'rgba(255,255,255,0.55)',
              fontSize: 20,
              margin: 14,
              formatter: valueFormat,
            },
            splitLine: { lineStyle: { color: 'rgba(255,255,255,0.04)', type: 'dashed' } },
            axisLine: { show: false },
          },
          {
            type: 'value',
            gridIndex: 1,
            name: 'Δ vs avg (%)',
            nameTextStyle: { color: 'rgba(255,255,255,0.60)', fontSize: 20, padding: [0, 0, 8, 0] },
            nameLocation: 'middle',
            nameGap: 56,
            splitNumber: 4,
            axisLabel: {
              color: 'rgba(255,255,255,0.55)',
              fontSize: 20,
              margin: 14,
              // Variance is a fraction (0.10 = 10% above avg). Render as
              // signed percentage.
              formatter: (v) => (v >= 0 ? '+' : '') + (v * 100).toFixed(0) + '%',
            },
            splitLine: { lineStyle: { color: 'rgba(255,255,255,0.04)', type: 'dashed' } },
            axisLine: { show: false },
          },
        ],
        series: [
          {
            name: seriesName,
            type: 'line',
            xAxisIndex: 0,
            yAxisIndex: 0,
            smooth: false,
            symbol: 'circle',
            symbolSize: 8,
            showSymbol: false,
            lineStyle: { width: 3, color: T.accentPrimary },
            itemStyle: { color: T.accentPrimary },
            areaStyle: {
              opacity: 0.35,
              color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
                { offset: 0, color: 'rgba(0,212,255,0.45)' },
                { offset: 1, color: 'rgba(0,212,255,0)' },
              ]),
            },
            // Mark line at the overall avg — acts as the "second line"
            // and the reference baseline for the diff bars below.
            markLine: {
              symbol: 'none',
              data: [{ yAxis: avg, name: '24-hr avg' }],
              lineStyle: {
                type: 'dashed',
                color: 'rgba(255,255,255,0.55)',
                width: 1.8,
              },
              label: {
                position: 'insideEndTop',
                formatter: '24-hr avg ' + avgLabel,
                color: 'rgba(255,255,255,0.80)',
                fontSize: 21,
                fontWeight: 600,
              },
            },
            connectNulls: false,
            data: values,
          },
          {
            name: 'Δ vs 24-hr avg',
            type: 'bar',
            xAxisIndex: 2, // bottom grid's inner hour axis
            yAxisIndex: 1,
            barWidth: '60%',
            data: diffs.map((v) => ({
              value: v,
              itemStyle: {
                color: v == null ? 'rgba(255,255,255,0.10)'
                                 : v >= 0 ? T.chartGreen
                                          : T.chartRed,
              },
            })),
          },
        ],
      },
      true
    );
  }, [aggregated, metricKey, avgKey, seriesName, yAxisName, valueFormat]);

  // No outer card — the parent DemandChart card wraps every secondary
  // chart so they read as one continuous panel. Sub-headers mirror
  // the main "HOURLY DEMAND" card title: cyan accent bar + tracked
  // uppercase, left-aligned, same scale. Generous top spacing
  // (mt: 4) gives each panel breathing room, like the "Real-time
  // Metrics" reference.
  return (
    <Box sx={{ mt: 4, pt: 3, borderTop: '1px solid rgba(255,255,255,0.08)' }}>
      <Box sx={{ ...cardHeader, mb: 2 }}>
        <Box sx={cardTitleAccentSx} />
        <Typography sx={cardTitleSx}>{title}</Typography>
      </Box>
      <div ref={ref} style={{ width: '100%', height: 680 }} />
    </Box>
  );
}

// ─────────────────────────────────────────────────────────────────
// DoW split layout — 4-up grid version of DemandChart.
// Only rendered when `grouping === 'dow'`. Each day-type (WD / Fri /
// Sat / Sun) gets its own mini demand chart on the top row and its
// own mini headcount chart on the bottom row. All 8 mini charts live
// inside ONE outer flat card (same chrome as the combined version).
//
// The original `DemandChart` + `HeadcountPerHourChart` are kept
// untouched above — switching back to the combined view is just a
// matter of un-conditioning the call site (see the ROLLBACK comment
// in the HourlyDemand parent component).
// ─────────────────────────────────────────────────────────────────

function DemandChartDowSplit({ aggregated, selectedMetrics, splitYAxis = false, setSplitYAxis = () => {}, headcountBasis = 'actual' }) {
  const perTableCfg = perTableChartConfig(headcountBasis);
  // Slice the aggregated data into 4 single-group payloads, one per
  // day-type. Each slice is a self-contained `aggregated`-shape that
  // the mini panels render exactly the way the big chart would render
  // a single 24-hour block.
  const slices = useMemo(
    () => DAY_TYPES.map((dt) => ({ key: dt, agg: sliceAggregatedToGroup(aggregated, dt) })),
    [aggregated]
  );

  if (selectedMetrics.length === 0) {
    return (
      <Box
        sx={{
          ...flatCard,
          p: 4,
          textAlign: 'center',
          color: T.textTertiary,
          fontSize: 23,
          letterSpacing: 0.4,
        }}
      >
        Select one or more metrics above to render the demand chart.
      </Box>
    );
  }

  return (
    <Box sx={{ ...flatCard, p: 2 }}>
      <Box sx={{ ...cardHeader, display: 'flex', alignItems: 'center' }}>
        <Box sx={cardTitleAccentSx} />
        <Typography sx={cardTitleSx}>Hourly Demand · By Day of Week</Typography>
        <Box sx={{ flex: 1 }} />
        {/* Y-axis split toggle — chart-local; applies to all 4 mini
            demand charts in the row below. */}
        <YAxisToggle splitYAxis={splitYAxis} setSplitYAxis={setSplitYAxis} />
      </Box>

      {/* Row 1 — 4-up mini demand charts. */}
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: 'repeat(4, 1fr)',
          gap: 1.5,
        }}
      >
        {slices.map(({ key, agg }) => (
          <MiniDemandPanel
            key={key}
            title={key}
            aggregated={agg}
            selectedMetrics={selectedMetrics}
            splitYAxis={splitYAxis}
          />
        ))}
      </Box>

      {/* Divider + sub-title — same look as the combined version. */}
      <Box sx={{ mt: 4, pt: 3, borderTop: '1px solid rgba(255,255,255,0.08)' }}>
        <Box sx={{ ...cardHeader, mb: 2 }}>
          <Box sx={cardTitleAccentSx} />
          <Typography sx={cardTitleSx}>{perTableCfg.headcount.title}</Typography>
        </Box>

        {/* Row 2 — 4-up mini headcount charts. */}
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: 'repeat(4, 1fr)',
            gap: 1.5,
          }}
        >
          {slices.map(({ key, agg }) => (
            <MiniHeadcountPanel
              key={key}
              title={key}
              aggregated={agg}
              avg={aggregated[perTableCfg.headcount.avgKey]}
              metricKey={perTableCfg.headcount.metricKey}
              seriesName={perTableCfg.headcount.seriesName}
              valueFormat={perTableCfg.headcount.valueFormat}
            />
          ))}
        </Box>
      </Box>

      {/* Theo per table — third row, same 4-up layout. */}
      <Box sx={{ mt: 4, pt: 3, borderTop: '1px solid rgba(255,255,255,0.08)' }}>
        <Box sx={{ ...cardHeader, mb: 2 }}>
          <Box sx={cardTitleAccentSx} />
          <Typography sx={cardTitleSx}>{perTableCfg.theo.title}</Typography>
        </Box>
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: 'repeat(4, 1fr)',
            gap: 1.5,
          }}
        >
          {slices.map(({ key, agg }) => (
            <MiniHeadcountPanel
              key={key}
              title={key}
              aggregated={agg}
              avg={aggregated[perTableCfg.theo.avgKey]}
              metricKey={perTableCfg.theo.metricKey}
              seriesName={perTableCfg.theo.seriesName}
              valueFormat={perTableCfg.theo.valueFormat}
            />
          ))}
        </Box>
      </Box>
    </Box>
  );
}

// One day-type's slice of the demand chart. Same series and area-fill
// styling as the big DemandChart, but with smaller fonts and a single
// 24-hour block on the x-axis. The day-type title sits above the
// canvas (no inner ECharts title to keep the chart area clean).
function MiniDemandPanel({ title, aggregated, selectedMetrics, splitYAxis = false }) {
  const ref = useRef(null);
  const instRef = useRef(null);

  useEffect(() => {
    if (!ref.current) return;
    let inst = echarts.getInstanceByDom(ref.current);
    if (!inst) inst = echarts.init(ref.current, 'dark');
    instRef.current = inst;
    const ro = new ResizeObserver(() =>
      requestAnimationFrame(() => inst && inst.resize())
    );
    ro.observe(ref.current);
    return () => {
      ro.disconnect();
      inst.dispose();
      instRef.current = null;
    };
  }, []);

  useEffect(() => {
    const inst = instRef.current;
    if (!inst || !aggregated.groupKeys.length || !selectedMetrics.length) {
      if (inst) inst.clear();
      return;
    }
    const g = aggregated.groupKeys[0];
    const xAxisData = HOUR_ORDER.map((h) => String(h).padStart(2, '0'));

    // Mini-chart series — same bar-vs-line policy as the big chart:
    // patron_hours + optimal_open_hours render as bars, everything
    // else as lines. Bar widths are scaled smaller for the cramped
    // mini layout. yAxisIndex follows the same right-axis split rule
    // as the big chart (see DemandChart RIGHT_AXIS_KEYS comment).
    const RIGHT_AXIS_KEYS = new Set(['patron_hours', 'optimal_open_hours']);
    const series = selectedMetrics.map((mk) => {
      const meta = METRICS.find((m) => m.key === mk);
      const data = HOUR_ORDER.map((h) => {
        const cell = aggregated.byKey[g + '|' + h];
        return cell ? Number(cell[mk]) : null;
      });
      const yAxisIndex = splitYAxis && RIGHT_AXIS_KEYS.has(mk) ? 1 : 0;
      // Mini chart — same bar policy as the big chart. Patron is the
      // grey backdrop, optimal overlays on top.
      if (mk === 'patron_hours') {
        return {
          name: meta.label,
          type: 'bar',
          barCategoryGap: '0%',
          yAxisIndex,
          itemStyle: {
            color: '#6b7280',
            borderColor: '#000000',
            borderWidth: 0.8,
          },
          emphasis: { itemStyle: { color: '#9ca3af' } },
          z: 1,
          data,
        };
      }
      // Mini variant — same overlay treatment as the big chart.
      if (mk === 'optimal_open_hours') {
        return {
          name: meta.label,
          type: 'bar',
          barCategoryGap: '0%',
          barGap: '-100%',
          yAxisIndex,
          itemStyle: {
            color: meta.color,
            borderColor: '#000000',
            borderWidth: 0.8,
          },
          emphasis: { itemStyle: { color: meta.color } },
          z: 2,
          data,
        };
      }
      return {
        name: meta.label,
        type: 'line',
        smooth: false,
        symbol: 'circle',
        symbolSize: 4,
        showSymbol: false,
        yAxisIndex,
        lineStyle: { width: 2, color: meta.color },
        itemStyle: { color: meta.color },
        connectNulls: false,
        data,
        z: 2,
      };
    });

    // Per-axis yMax (independent under split, identical when shared).
    const computeYMax = (filterFn) => {
      const vals = series.filter(filterFn).flatMap((s) => s.data).filter((v) => Number.isFinite(v));
      const max = vals.length ? Math.max(...vals) : 100;
      return Math.max(10, Math.ceil((max * 1.1) / 10) * 10);
    };
    const yMaxLeft  = splitYAxis ? computeYMax((s) => s.yAxisIndex === 0) : computeYMax(() => true);
    const yMaxRight = splitYAxis ? computeYMax((s) => s.yAxisIndex === 1) : yMaxLeft;

    inst.setOption(
      {
        backgroundColor: 'transparent',
        animation: false,
        tooltip: {
          trigger: 'axis',
          backgroundColor: 'rgba(30, 37, 51, 0.98)',
          borderColor: 'rgba(0, 212, 255, 0.40)',
          borderWidth: 1,
          padding: [8, 12],
          textStyle: { color: '#fff', fontSize: 13 },
          valueFormatter: (v) => (v == null ? '–' : compactNum(v)),
        },
        legend: { show: false },
        grid: { left: 8, right: 12, top: 12, bottom: 28, containLabel: true },
        xAxis: {
          type: 'category',
          data: xAxisData,
          axisTick: { length: 0 },
          axisLabel: {
            margin: 8,
            color: 'rgba(232,234,250,0.55)',
            fontSize: 13,
            // Hour-axis is dense at 24 ticks in a narrow column; show
            // every 3rd label so they don't collide.
            interval: 2,
          },
          axisLine: { lineStyle: { color: 'rgba(255,255,255,0.08)' } },
        },
        // Mirror axis pattern — always an array so yAxisIndex resolves
        // cleanly whether split is on or off. See DemandChart for the
        // wider rationale.
        yAxis: splitYAxis
          ? [
              {
                type: 'value',
                position: 'left',
                max: yMaxLeft,
                axisLabel: { color: 'rgba(232,234,250,0.55)', fontSize: 13, formatter: compactNum },
                splitLine: { lineStyle: { color: 'rgba(255,255,255,0.04)', type: 'dashed' } },
                axisLine: { show: false },
              },
              {
                type: 'value',
                position: 'right',
                max: yMaxRight,
                axisLabel: { color: 'rgba(232,234,250,0.55)', fontSize: 13, formatter: compactNum },
                splitLine: { show: false },
                axisLine: { show: false },
              },
            ]
          : [
              {
                type: 'value',
                max: yMaxLeft,
                axisLabel: { color: 'rgba(232,234,250,0.55)', fontSize: 13, formatter: compactNum },
                splitLine: { lineStyle: { color: 'rgba(255,255,255,0.04)', type: 'dashed' } },
                axisLine: { show: false },
              },
              { type: 'value', show: false, max: yMaxLeft },
            ],
        series,
      },
      true
    );
  }, [aggregated, selectedMetrics, splitYAxis]);

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column' }}>
      <Typography sx={miniPanelTitleSx}>{title}</Typography>
      <div ref={ref} style={{ width: '100%', height: 320 }} />
    </Box>
  );
}

// One day-type's slice of the headcount chart. Same two-grid layout as
// the big version (line + diff bars) but with smaller fonts and a
// single 24-hour block on the x-axis. Uses the SHARED overall avg
// (passed in via `avg`) so each mini's mark line stays comparable to
// its siblings instead of recomputing per-day.
// Parameterized mini variant — same shape as the big chart so the
// Headcount and Theo mini panels can share one implementation.
function MiniHeadcountPanel({
  title,
  aggregated,
  avg = 0,
  metricKey = 'headcount_per_open_hour',
  seriesName = 'Headcount/open hr',
  valueFormat = (v) => v.toFixed(2),
}) {
  const ref = useRef(null);
  const instRef = useRef(null);

  useEffect(() => {
    if (!ref.current) return;
    let inst = echarts.getInstanceByDom(ref.current);
    if (!inst) inst = echarts.init(ref.current, 'dark');
    instRef.current = inst;
    const ro = new ResizeObserver(() =>
      requestAnimationFrame(() => inst && inst.resize())
    );
    ro.observe(ref.current);
    return () => {
      ro.disconnect();
      inst.dispose();
      instRef.current = null;
    };
  }, []);

  useEffect(() => {
    const inst = instRef.current;
    if (!inst || !aggregated.groupKeys.length) {
      if (inst) inst.clear();
      return;
    }
    const g = aggregated.groupKeys[0];
    const avgFixed = +avg.toFixed(3);
    const avgLabel = valueFormat(avgFixed);
    const xAxisData = HOUR_ORDER.map((h) => String(h).padStart(2, '0'));
    const values = HOUR_ORDER.map((h) => {
      const cell = aggregated.byKey[g + '|' + h];
      const v = cell && Number.isFinite(cell[metricKey])
        ? cell[metricKey]
        : null;
      return v == null ? null : +v.toFixed(3);
    });
    // Variance as a fraction of the overall avg (matches the big
    // chart). y-axis + tooltip below format as signed percentage.
    const diffs = values.map((v) =>
      v == null || avg <= 0 ? null : +((v - avg) / avg).toFixed(4)
    );

    inst.setOption(
      {
        backgroundColor: 'transparent',
        animation: false,
        tooltip: {
          trigger: 'axis',
          axisPointer: { type: 'shadow' },
          backgroundColor: 'rgba(15, 20, 25, 0.98)',
          borderColor: 'rgba(0, 212, 255, 0.40)',
          borderWidth: 1,
          padding: [8, 12],
          textStyle: { color: '#fff', fontSize: 13 },
          formatter: (params) => {
            if (!params || !params.length) return '';
            const hour = params[0].axisValue;
            const valueRow = params.find((p) => p.seriesName === seriesName);
            const diffRow  = params.find((p) => p.seriesName === 'Δ vs 24-hr avg');
            const v = valueRow ? valueRow.value : null;
            const d = diffRow ? diffRow.value : null;
            const dColor = d != null && d >= 0 ? T.chartGreen : T.chartRed;
            return `
              <div style="padding:2px 4px">
                <div style="color:rgba(255,255,255,0.55);font-size:12px;letter-spacing:0.6px;text-transform:uppercase;margin-bottom:4px">${title} · Hour ${hour}</div>
                <div style="display:flex;justify-content:space-between;gap:12px;font-size:14px"><span style="color:rgba(255,255,255,0.70)">${seriesName}</span><span style="color:#fff;font-weight:700">${v == null ? '–' : valueFormat(v)}</span></div>
                <div style="display:flex;justify-content:space-between;gap:12px;font-size:14px"><span style="color:rgba(255,255,255,0.70)">24-hr avg</span><span style="color:#fff;font-weight:700">${avgLabel}</span></div>
                <div style="display:flex;justify-content:space-between;gap:12px;font-size:14px"><span style="color:rgba(255,255,255,0.70)">Δ vs avg</span><span style="color:${dColor};font-weight:700">${d == null ? '–' : (d >= 0 ? '+' : '') + (d * 100).toFixed(1) + '%'}</span></div>
              </div>
            `;
          },
        },
        legend: { show: false },
        grid: [
          // Mini variant: same 38/48 ratio as the big chart so the two
          // headcount layouts feel consistent.
          { left: 50, right: 12, top: 14,    height: '38%' },
          { left: 50, right: 12, top: '54%', height: '40%' },
        ],
        xAxis: [
          {
            type: 'category',
            gridIndex: 0,
            data: xAxisData,
            axisTick: { show: false },
            axisLabel: { show: false },
            axisLine: { lineStyle: { color: 'rgba(255,255,255,0.08)' } },
          },
          {
            type: 'category',
            gridIndex: 1,
            data: xAxisData,
            axisTick: { length: 0 },
            axisLabel: {
              margin: 8,
              color: 'rgba(255,255,255,0.55)',
              fontSize: 13,
              interval: 2,
            },
            axisLine: { lineStyle: { color: 'rgba(255,255,255,0.08)' } },
          },
        ],
        yAxis: [
          {
            type: 'value',
            gridIndex: 0,
            splitNumber: 3,
            axisLabel: { color: 'rgba(255,255,255,0.55)', fontSize: 12, margin: 8, formatter: valueFormat },
            splitLine: { lineStyle: { color: 'rgba(255,255,255,0.04)', type: 'dashed' } },
            axisLine: { show: false },
          },
          {
            type: 'value',
            gridIndex: 1,
            splitNumber: 3,
            axisLabel: {
              color: 'rgba(255,255,255,0.55)',
              fontSize: 12,
              margin: 8,
              formatter: (v) => (v >= 0 ? '+' : '') + (v * 100).toFixed(0) + '%',
            },
            splitLine: { lineStyle: { color: 'rgba(255,255,255,0.04)', type: 'dashed' } },
            axisLine: { show: false },
          },
        ],
        series: [
          {
            name: seriesName,
            type: 'line',
            xAxisIndex: 0,
            yAxisIndex: 0,
            smooth: false,
            showSymbol: false,
            lineStyle: { width: 2, color: T.accentPrimary },
            itemStyle: { color: T.accentPrimary },
            areaStyle: {
              opacity: 0.35,
              color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
                { offset: 0, color: 'rgba(0,212,255,0.45)' },
                { offset: 1, color: 'rgba(0,212,255,0)' },
              ]),
            },
            markLine: {
              symbol: 'none',
              data: [{ yAxis: avgFixed, name: '24-hr avg' }],
              lineStyle: { type: 'dashed', color: 'rgba(255,255,255,0.55)', width: 1.4 },
              label: {
                position: 'insideEndTop',
                formatter: avgLabel,
                color: 'rgba(255,255,255,0.78)',
                fontSize: 11,
                fontWeight: 600,
              },
            },
            connectNulls: false,
            data: values,
          },
          {
            name: 'Δ vs 24-hr avg',
            type: 'bar',
            xAxisIndex: 1,
            yAxisIndex: 1,
            barWidth: '60%',
            data: diffs.map((v) => ({
              value: v,
              itemStyle: {
                color: v == null
                  ? 'rgba(255,255,255,0.10)'
                  : v >= 0 ? T.chartGreen : T.chartRed,
              },
            })),
          },
        ],
      },
      true
    );
  }, [aggregated, avg, title, metricKey, seriesName, valueFormat]);

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column' }}>
      <Typography sx={miniPanelTitleSx}>{title}</Typography>
      <div ref={ref} style={{ width: '100%', height: 420 }} />
    </Box>
  );
}

// Day-type title strip above each mini panel. Centered, tracked
// uppercase — same scale as the section labels in the controls row.
const miniPanelTitleSx = {
  color: T.textPrimary,
  fontSize: 15,
  fontWeight: 700,
  letterSpacing: 1.4,
  textTransform: 'uppercase',
  textAlign: 'center',
  py: 0.6,
  mb: 0.6,
  borderBottom: '1px solid rgba(0,212,255,0.20)',
};

// Compact shift table. Behavior follows the chart's grouping mode:
//   • grouping === 'dow'   → 4 inline inputs per shift (WD/Fri/Sat/Sun)
//   • grouping === 'date'  → 1 input per shift; edits apply to ALL day types
//   • grouping === 'agg'   → 1 input per shift; edits apply to ALL day types
//
// The shift name input is constrained to a small max-width to avoid the
// large empty space it had before. The 3px length-colored left band +
// pill makes shift categories scannable at a glance.
function ShiftTable({ shifts, grouping, onUpdate, onRemove, onAdd, onReset }) {
  const showPerDow = grouping === 'dow';

  // When the user is in single-input mode (date or agg), edits write
  // the same value to all 4 day-type columns so the proposed roster
  // stays uniform across days.
  const updateSingleCount = (id, value) => {
    const n = clampNonNeg(value);
    onUpdate(id, { tablesWD: n, tablesFri: n, tablesSat: n, tablesSun: n });
  };

  return (
    <Box sx={{ ...flatCard, p: 2, display: 'flex', flexDirection: 'column' }}>
      <Box sx={cardHeader}>
        <Box sx={cardTitleAccentSx} />
        <Typography sx={cardTitleSx}>Shift Assignment</Typography>
      </Box>

      {/* Shift-length color legend + mode hint */}
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1.2,
          mb: 1.2,
          pl: 0.3,
          flexWrap: 'wrap',
        }}
      >
        {[
          { label: '24h', color: '#8b5cf6' },
          { label: '16h', color: '#00d4ff' },
          { label: '8h',  color: '#10b981' },
        ].map((item) => (
          <Box key={item.label} sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <Box sx={{ width: 10, height: 10, bgcolor: item.color, borderRadius: 0.4 }} />
            <Typography sx={{ color: T.textTertiary, fontSize: 20, letterSpacing: 0.4 }}>
              {item.label}
            </Typography>
          </Box>
        ))}
        <Box sx={{ flex: 1 }} />
        <Typography
          sx={{
            color: T.textMuted,
            fontSize: 17,
            letterSpacing: 0.6,
            textTransform: 'uppercase',
            fontWeight: 600,
          }}
        >
          {showPerDow ? 'Tables / day type' : 'Tables (all days)'}
        </Typography>
      </Box>

      {/* Action row */}
      <Box sx={{ display: 'flex', gap: 0.5, mb: 1.2 }}>
        <Button
          size="small"
          startIcon={<AddIcon sx={{ fontSize: 27 }} />}
          onClick={onAdd}
          sx={{
            fontSize: 20,
            textTransform: 'none',
            fontWeight: 600,
            color: T.accentPrimary,
            minWidth: 0,
            px: 1.2,
            '&:hover': { bgcolor: T.accentPrimaryDim, color: '#fff' },
          }}
        >
          Add
        </Button>
        <Button
          size="small"
          startIcon={<RestartAltIcon sx={{ fontSize: 27 }} />}
          onClick={onReset}
          sx={{
            fontSize: 20,
            textTransform: 'none',
            fontWeight: 600,
            color: T.textSecondary,
            minWidth: 0,
            px: 1.2,
            '&:hover': { bgcolor: 'rgba(255,255,255,0.04)', color: T.textPrimary },
          }}
        >
          Reset
        </Button>
      </Box>

      {/* Scrollable shift list */}
      <Box
        sx={{
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
          pr: 0.5,
          scrollbarWidth: 'thin',
          scrollbarColor: 'rgba(255,255,255,0.12) transparent',
          '&::-webkit-scrollbar': { width: 6 },
          '&::-webkit-scrollbar-thumb': {
            bgcolor: 'rgba(255,255,255,0.10)',
            borderRadius: 3,
          },
        }}
      >
        {shifts.map((s) => {
          const band = shiftBand(s);
          // For the single-input mode, surface tablesWD as the canonical
          // value (it'll be in sync with the others once the user edits).
          const singleValue = s.tablesWD ?? s.tables ?? 0;
          return (
            <Box
              key={s.id}
              sx={{
                position: 'relative',
                pl: 1.4,
                pr: 1.2,
                py: 1,
                mb: 1,
                borderRadius: 1,
                bgcolor: 'rgba(255,255,255,0.02)',
                border: '1px solid rgba(255,255,255,0.05)',
                transition: 'border-color 160ms ease, background-color 160ms ease',
                overflow: 'hidden',
                '&:hover': {
                  borderColor: 'rgba(0,212,255,0.20)',
                  bgcolor: 'rgba(255,255,255,0.04)',
                },
                '&::before': {
                  content: '""',
                  position: 'absolute',
                  left: 0, top: 0, bottom: 0,
                  width: 3,
                  bgcolor: band.color,
                },
              }}
            >
              {/* Row 1: short name input + length pill + delete. Name
                  is capped at ~110px so it doesn't sprawl across the row. */}
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.8, mb: 0.8 }}>
                <TextField
                  size="small"
                  value={s.name}
                  onChange={(e) => onUpdate(s.id, { name: e.target.value })}
                  sx={{ ...inputSx, width: 160 }}
                />
                <Box
                  sx={{
                    px: 0.9,
                    py: 0.2,
                    borderRadius: 0.6,
                    bgcolor: `${band.color}22`,
                    color: band.color,
                    fontSize: 18,
                    fontWeight: 700,
                    letterSpacing: 0.4,
                  }}
                >
                  {band.label}
                </Box>
                {/* Hours pair sits next to the name on the same row to
                    reclaim the wasted right-hand space. */}
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.4, ml: 0.6 }}>
                  <TextField
                    size="small"
                    type="number"
                    value={s.startHour}
                    onChange={(e) => onUpdate(s.id, { startHour: clampHour(e.target.value) })}
                    inputProps={{ min: 0, max: 23 }}
                    sx={{ ...inputSx, width: 76 }}
                  />
                  <Typography sx={{ color: T.textTertiary, fontSize: 21 }}>→</Typography>
                  <TextField
                    size="small"
                    type="number"
                    value={s.endHour}
                    onChange={(e) => onUpdate(s.id, { endHour: clampHour(e.target.value) })}
                    inputProps={{ min: 0, max: 23 }}
                    sx={{ ...inputSx, width: 76 }}
                  />
                </Box>
                <Box sx={{ flex: 1 }} />
                <IconButton
                  size="small"
                  onClick={() => onRemove(s.id)}
                  sx={{
                    color: T.textTertiary,
                    width: 26,
                    height: 26,
                    '&:hover': { color: T.chartRed, bgcolor: 'rgba(239,68,68,0.08)' },
                  }}
                >
                  <DeleteOutlineIcon sx={{ fontSize: 27 }} />
                </IconButton>
              </Box>

              {/* Row 2: table counts. 4 columns in dow mode, single
                  input in date/agg mode. */}
              {showPerDow ? (
                <Box
                  sx={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(4, 1fr)',
                    gap: 0.7,
                  }}
                >
                  {DAY_TYPES.map((d) => {
                    const k = SHIFT_KEY_BY_DAY[d];
                    return (
                      <Box key={d}>
                        <Typography sx={{ ...miniLabelSx, color: band.color }}>{d}</Typography>
                        <TextField
                          size="small"
                          type="number"
                          value={s[k] ?? 0}
                          onChange={(e) =>
                            onUpdate(s.id, { [k]: clampNonNeg(e.target.value) })
                          }
                          inputProps={{ min: 0, step: 1 }}
                          sx={{ ...inputSx, width: '100%' }}
                        />
                      </Box>
                    );
                  })}
                </Box>
              ) : (
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Typography sx={{ ...miniLabelSx, color: band.color, mb: 0 }}>
                    Tables
                  </Typography>
                  <TextField
                    size="small"
                    type="number"
                    value={singleValue}
                    onChange={(e) => updateSingleCount(s.id, e.target.value)}
                    inputProps={{ min: 0, step: 1 }}
                    sx={{ ...inputSx, width: 90 }}
                  />
                  <Typography sx={{ color: T.textMuted, fontSize: 17, letterSpacing: 0.4 }}>
                    applies to all days
                  </Typography>
                </Box>
              )}
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}

// ─────────────────────────────────────────────────────────────────
// Spreadsheet-style shift table. Same data model + callbacks as the
// older `ShiftTable` (kept untouched above for rollback), but renders
// as a compact 8-column grid:
//
//   Shift │ From │ To │ Hour │ WD │ Fri │ Sat │ Sun
//
// Rows are tinted by shift length (24h pink / 16h green / 8h cyan)
// so the user can scan shift categories at a glance, and a footer
// row shows Total Shifts and Total Open Hours per day-type.
// ─────────────────────────────────────────────────────────────────
function ShiftTableSpreadsheet({ shifts, grouping, schedulingByDay = {}, onUpdate, onRemove, onAdd, onReset }) {
  // 'dow' mode → 4 day-type columns. Anything else → one combined
  // "Tables" column whose value writes to all 4 day-types at once.
  const showPerDow = grouping === 'dow';

  // Compute the per-day totals shown in the footer.
  const totals = useMemo(() => {
    const out = { WD: { count: 0, hours: 0 }, Fri: { count: 0, hours: 0 }, Sat: { count: 0, hours: 0 }, Sun: { count: 0, hours: 0 } };
    for (const s of shifts) {
      const len = shiftLengthHours(s);
      for (const d of DAY_TYPES) {
        const n = Number(s[SHIFT_KEY_BY_DAY[d]]) || 0;
        out[d].count += n;
        out[d].hours += n * len;
      }
    }
    return out;
  }, [shifts]);

  // In single-input mode, an edit propagates to every day-type column
  // so the per-day rosters stay in sync.
  const writeAllDays = (id, value) => {
    const n = clampNonNeg(value);
    onUpdate(id, { tablesWD: n, tablesFri: n, tablesSat: n, tablesSun: n });
  };

  // The columns shown to the right of Hour: either DAY_TYPES or a
  // single 'Tables' synthetic column. Picked here so the header,
  // body, and footer rows stay aligned via the same source list.
  const dayCols = showPerDow ? DAY_TYPES : ['Tables'];

  // Grid template adapts to the column count so each cell gets a
  // comfortable width in both modes.
  const gridCols = showPerDow ? SHIFT_GRID_COLS_DOW : SHIFT_GRID_COLS_SINGLE;

  return (
    <Box sx={{ ...flatCard, p: 1.5, display: 'flex', flexDirection: 'column' }}>
      <Box sx={cardHeader}>
        <Box sx={cardTitleAccentSx} />
        <Typography sx={cardTitleSx}>Shift Assignment</Typography>
        <Box sx={{ flex: 1 }} />
        <Button
          size="small"
          startIcon={<AddIcon sx={{ fontSize: 22 }} />}
          onClick={onAdd}
          sx={{
            fontSize: 18,
            textTransform: 'none',
            fontWeight: 600,
            color: T.accentPrimary,
            minWidth: 0,
            px: 1.2,
            '&:hover': { bgcolor: T.accentPrimaryDim, color: '#fff' },
          }}
        >
          Add
        </Button>
        <Button
          size="small"
          startIcon={<RestartAltIcon sx={{ fontSize: 22 }} />}
          onClick={onReset}
          sx={{
            fontSize: 18,
            textTransform: 'none',
            fontWeight: 600,
            color: T.textSecondary,
            minWidth: 0,
            px: 1.2,
            '&:hover': { bgcolor: 'rgba(255,255,255,0.04)', color: T.textPrimary },
          }}
        >
          Reset
        </Button>
      </Box>

      {/* Length-color legend so the row tints are interpretable. */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.4, mb: 1, px: 0.4, flexWrap: 'wrap' }}>
        {SHIFT_LEN_BANDS.map((b) => (
          <Box key={b.label} sx={{ display: 'flex', alignItems: 'center', gap: 0.6 }}>
            <Box sx={{ width: 15, height: 15, bgcolor: b.color, borderRadius: 0.5 }} />
            <Typography sx={{ color: T.textSecondary, fontSize: 17, letterSpacing: 0.4, fontWeight: 600 }}>
              {b.label}
            </Typography>
          </Box>
        ))}
      </Box>

      {/* Spreadsheet grid. Column widths add to ~100% so it fits the
          narrow shift column. Sub-grids per row keep rows aligned. */}
      <Box
        sx={{
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
          pr: 0.3,
          scrollbarWidth: 'thin',
          scrollbarColor: 'rgba(255,255,255,0.12) transparent',
          '&::-webkit-scrollbar': { width: 6 },
          '&::-webkit-scrollbar-thumb': {
            bgcolor: 'rgba(255,255,255,0.10)',
            borderRadius: 3,
          },
        }}
      >
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: gridCols,
            // Cells butt flush — no gaps, no borders. Visual separation
            // comes from the cell tints (band color for shift columns,
            // neutral fill for data-entry columns).
            rowGap: 0,
            columnGap: 0,
            alignItems: 'stretch',
          }}
        >
          {/* Header row. The first 4 columns are fixed (Shift / From /
              To / Hour). The day-type columns come from `dayCols` so
              the dow vs single-tables layouts stay in sync. */}
          {['Shift', 'From', 'To', 'Hour', ...dayCols, ''].map((h, i) => (
            <Box key={(h || 'del') + i} sx={ssHeadSx}>{h}</Box>
          ))}

          {/* Data rows */}
          {shifts.map((s) => {
            const band = shiftBand(s);
            const len = shiftLengthHours(s);
            return (
              <React.Fragment key={s.id}>
                <SsCell band={band}>
                  <SsInput
                    value={s.name}
                    onChange={(e) => onUpdate(s.id, { name: e.target.value })}
                    align="left"
                  />
                </SsCell>
                <SsCell band={band}>
                  <SsInput
                    type="number"
                    value={s.startHour}
                    onChange={(e) => onUpdate(s.id, { startHour: clampHour(e.target.value) })}
                    min={0} max={23}
                  />
                </SsCell>
                <SsCell band={band}>
                  <SsInput
                    type="number"
                    value={s.endHour}
                    onChange={(e) => onUpdate(s.id, { endHour: clampHour(e.target.value) })}
                    min={0} max={23}
                  />
                </SsCell>
                <SsCell band={band}>
                  <Typography
                    sx={{
                      color: T.textPrimary,
                      fontWeight: 700,
                      fontSize: 18,
                      fontFamily: 'monospace',
                      textAlign: 'center',
                      lineHeight: '34px',
                    }}
                  >
                    {len}
                  </Typography>
                </SsCell>
                {showPerDow ? (
                  DAY_TYPES.map((d) => (
                    <SsCell key={d} variant="input">
                      <SsInput
                        type="number"
                        value={s[SHIFT_KEY_BY_DAY[d]] ?? 0}
                        onChange={(e) =>
                          onUpdate(s.id, { [SHIFT_KEY_BY_DAY[d]]: clampNonNeg(e.target.value) })
                        }
                        min={0} step={1}
                      />
                    </SsCell>
                  ))
                ) : (
                  <SsCell variant="input">
                    <SsInput
                      type="number"
                      value={s.tablesWD ?? s.tables ?? 0}
                      onChange={(e) => writeAllDays(s.id, e.target.value)}
                      min={0} step={1}
                    />
                  </SsCell>
                )}
                <Box sx={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}>
                  <IconButton
                    size="small"
                    onClick={() => onRemove(s.id)}
                    sx={{
                      color: T.textTertiary,
                      width: 26,
                      height: 26,
                      '&:hover': { color: T.chartRed, bgcolor: 'rgba(239,68,68,0.10)' },
                    }}
                  >
                    <DeleteOutlineIcon sx={{ fontSize: 18 }} />
                  </IconButton>
                </Box>
              </React.Fragment>
            );
          })}

          {/* Spacer row dropped — the new per-cell borders deliver
              enough visual separation between data rows and the totals
              footer without the 2px gap. */}

          {/* Totals row — span the first 4 columns (Shift / From / To /
              Hour) for the label, then one value per day-column. */}
          <Box sx={{ ...ssFootLabelSx, gridColumn: '1 / 5' }}>Total Shifts</Box>
          {showPerDow ? (
            DAY_TYPES.map((d) => (
              <Box key={'tc-' + d} sx={ssFootValueSx}>{totals[d].count}</Box>
            ))
          ) : (
            <Box sx={ssFootValueSx}>{totals.WD.count}</Box>
          )}
          <Box />

          <Box sx={{ ...ssFootLabelSx, gridColumn: '1 / 5' }}>Total Open Hours</Box>
          {showPerDow ? (
            DAY_TYPES.map((d) => (
              <Box key={'th-' + d} sx={ssFootValueSx}>{totals[d].hours}</Box>
            ))
          ) : (
            <Box sx={ssFootValueSx}>{totals.WD.hours}</Box>
          )}
          <Box />

          {/* Comparison vs scheduling open hours. Two extra rows:
              the actual scheduling figure pulled from the filtered
              data, and the variance (proposed − scheduling).
              Suppressed entirely when no shift has any proposed
              tables in the visible columns — there's nothing to
              compare against if the roster is empty. */}
          {(showPerDow
              ? DAY_TYPES.some((d) => totals[d].hours > 0)
              : totals.WD.hours > 0
          ) && (
            <>
              <Box sx={{ ...ssFootLabelSx, gridColumn: '1 / 5' }}>Scheduling Open Hours</Box>
              {showPerDow ? (
                DAY_TYPES.map((d) => (
                  <Box key={'sch-' + d} sx={ssFootValueSx}>
                    {(schedulingByDay[d] || 0).toFixed(0)}
                  </Box>
                ))
              ) : (
                <Box sx={ssFootValueSx}>
                  {(schedulingByDay.WD || 0).toFixed(0)}
                </Box>
              )}
              <Box />

              <Box sx={{ ...ssFootLabelSx, gridColumn: '1 / 5' }}>Variance</Box>
              {showPerDow ? (
                DAY_TYPES.map((d) => {
                  const v = totals[d].hours - (schedulingByDay[d] || 0);
                  // Tint: green when over-staffed (proposed > scheduling),
                  // red when under-staffed, neutral when matched.
                  const color = v > 0.5 ? '#9ece6a' : v < -0.5 ? '#f7768e' : 'rgba(255,255,255,0.6)';
                  return (
                    <Box key={'var-' + d} sx={{ ...ssFootValueSx, color }}>
                      {v > 0 ? '+' : ''}{v.toFixed(0)}
                    </Box>
                  );
                })
              ) : (
                (() => {
                  const v = totals.WD.hours - (schedulingByDay.WD || 0);
                  const color = v > 0.5 ? '#9ece6a' : v < -0.5 ? '#f7768e' : 'rgba(255,255,255,0.6)';
                  return (
                    <Box sx={{ ...ssFootValueSx, color }}>
                      {v > 0 ? '+' : ''}{v.toFixed(0)}
                    </Box>
                  );
                })()
              )}
              <Box />
            </>
          )}
        </Box>
      </Box>
    </Box>
  );
}

// Per-shift-length tint band shown in the legend strip + applied as
// the row background tint.
// Legend swatches — exact colors used by shiftBand(). Keep in sync.
const SHIFT_LEN_BANDS = [
  { label: '24h', color: '#fc6e78' },
  { label: '16h', color: '#f59e0b' },
  { label: '8h',  color: '#00d4ff' },
];

// Column-width recipes. Shift name is now a fixed narrow column
// (A/B/C… don't need much room) — the saved space gets redistributed
// to From / To / Hour / Tables which carry the actual data.
const SHIFT_GRID_COLS_DOW    = '52px 1fr 1fr 1fr 1.2fr 1.2fr 1.2fr 1.2fr 28px';
const SHIFT_GRID_COLS_SINGLE = '60px 1fr 1fr 1fr 2.4fr 28px';

// Header cell style (top row of the spreadsheet).
const ssHeadSx = {
  fontSize: 16,
  fontWeight: 700,
  letterSpacing: 1.2,
  textTransform: 'uppercase',
  color: 'rgba(255,255,255,0.65)',
  textAlign: 'center',
  lineHeight: '28px',
  py: 0.6,
};

// Footer label / value cells (totals row).
const ssFootLabelSx = {
  fontSize: 17,
  fontWeight: 700,
  letterSpacing: 0.4,
  color: T.textPrimary,
  display: 'flex',
  alignItems: 'center',
  px: 0.8,
  py: 0.8,
};
const ssFootValueSx = {
  fontSize: 19,
  fontWeight: 800,
  color: T.textPrimary,
  textAlign: 'center',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  py: 0.8,
};

// One spreadsheet cell. Tints its background based on the shift's
// length band (24h / 16h / 8h) OR — when `variant === 'input'` — uses
// a neutral darker fill so the WD/Fri/Sat/Sun data-entry cells read
// as a distinct column group from the shift metadata cells.
function SsCell({ band, variant, children }) {
  let bg = 'transparent';
  if (variant === 'input') {
    // Neutral dark fill for the day-input columns. Same across all
    // three shift categories so the data-entry strip looks uniform.
    bg = 'rgba(255, 255, 255, 0.03)';
  } else if (band) {
    // Light tint of the band color for shift metadata cells.
    bg = band.color + '22';
  }
  return (
    <Box
      sx={{
        bgcolor: bg,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        px: 0.5,
        py: 0.7,
        // No rounded corners, no border — cells share edges flush.
      }}
    >
      {children}
    </Box>
  );
}

// Small input used inside spreadsheet cells. Borderless MUI TextField
// so the cell tint shows through. Font sized to match the rest of
// the spreadsheet — comfortable to read without being oversized.
function SsInput({ value, onChange, type = 'text', align = 'center', min, max, step }) {
  return (
    <TextField
      value={value}
      onChange={onChange}
      type={type}
      size="small"
      inputProps={{ min, max, step }}
      sx={{
        width: '100%',
        '& .MuiOutlinedInput-root': {
          bgcolor: 'transparent',
          borderRadius: 0.6,
        },
        '& .MuiOutlinedInput-input': {
          paddingY: '6px',
          paddingX: '4px',
          fontSize: 18,
          fontWeight: 600,
          color: T.textPrimary,
          textAlign: align,
          fontFamily: type === 'number' ? 'monospace' : undefined,
        },
        '& .MuiOutlinedInput-notchedOutline': {
          borderColor: 'rgba(255,255,255,0.05)',
        },
        '& .Mui-focused .MuiOutlinedInput-notchedOutline': {
          borderColor: T.accentPrimary,
          borderWidth: 1,
        },
        // Hide browser-native number spinners (the up/down arrows) so
        // the user types values directly without the tiny ▲▼ chrome.
        '& input[type=number]': {
          MozAppearance: 'textfield',
        },
        '& input[type=number]::-webkit-outer-spin-button': {
          WebkitAppearance: 'none',
          margin: 0,
        },
        '& input[type=number]::-webkit-inner-spin-button': {
          WebkitAppearance: 'none',
          margin: 0,
        },
      }}
    />
  );
}

const miniLabelSx = {
  color: T.textMuted,
  fontSize: 15,
  letterSpacing: 0.8,
  textTransform: 'uppercase',
  fontWeight: 600,
  mb: 0.3,
  lineHeight: 1,
};

const inputSx = {
  '& .MuiOutlinedInput-root': {
    bgcolor: 'rgba(255,255,255,0.03)',
    borderRadius: 1,
    transition: 'border-color 160ms ease',
    '&:hover .MuiOutlinedInput-notchedOutline': {
      borderColor: 'rgba(255, 255, 255, 0.18)',
    },
    '&.Mui-focused .MuiOutlinedInput-notchedOutline': {
      borderColor: T.accentPrimary,
      borderWidth: 1,
    },
  },
  '& .MuiOutlinedInput-input': {
    paddingY: '5px',
    fontSize: 21,
    color: T.textPrimary,
  },
  '& .MuiOutlinedInput-notchedOutline': {
    borderColor: 'rgba(255,255,255,0.08)',
  },
};

function clampHour(v) {
  const n = parseInt(v, 10);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(23, n));
}

function clampNonNeg(v) {
  const n = parseInt(v, 10);
  if (!Number.isFinite(n) || n < 0) return 0;
  return n;
}

function hexToRgba(hex, a) {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${a})`;
}

// "2026-02-08" → "Feb 08". Defensive: bad input passes through.
function formatDateLabel(s) {
  if (!s || typeof s !== 'string') return s;
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return s;
  const month = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][parseInt(m[2], 10) - 1];
  return `${month} ${m[3]}`;
}
