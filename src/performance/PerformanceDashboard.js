import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  Box,
  Paper,
  ListItem,
  Divider,
  Stack,
  Button,
  Typography,
} from '@mui/material';
import EventBusyIcon from '@mui/icons-material/EventBusy';
import RefreshIcon from '@mui/icons-material/Refresh';
import CircularProgress from '@mui/material/CircularProgress';

import ScatterHeatmapAvg from './components/ScatterHeatmapAvg';
import ScatterHeatmapPlay from './components/ScatterHeatmapPlay';
import DropdownSelector from './components/DropdownSelector';
import SelectorDate from './components/SelectorDate';
import PerformanceLegend from './components/PerformanceLegend';
import PerformancePercentile from './components/PerformancePercentile';
import TrendCharts from './components/TrendCharts';
import DateExcludeDialog from './components/DateExcludeDialog';

import { buildAvgScatterData } from './utils/dataProcessing';
import {
  buildHourlyScatterData,
  buildAggregatedHourlyScatterData,
  HOURLY_KPI_REGISTRY,
} from './utils/dataProcessingHourly';
import {
  available_KPI_Map,
  available_KPI_Map_Hour,
  threshold_dict,
  thresholdsFor,
  GAMETYPE_COLORS,
  legendGroupForSubSegment,
  sortSubSegmentsByPreference,
  kpiDisplayLabel,
} from '../shared/constants/heatmapConstants';

import config_data from '../shared/data/config_cod.json';
import { fetchDailyData, fetchHourlyData, gametypeTableKey, parseTablemin, tableMinimumMode } from './utils/dataSource';
import { PERF_FONTS } from './constants/fontSizes';
const BA = PERF_FONTS.byArea;

// Module-level lookup: (gametype+table) → zone, derived from
// config_cod.json. The 3 data sources no longer carry a per-row `zone`
// field — config is the single source of truth. Keyed on gametype+table
// (NOT table alone) because table numbers are reused across gametypes.
const TABLE_ZONE_MAP = new Map(
  config_data.map((cfg) => [gametypeTableKey(cfg.game, cfg.table), cfg.zone])
);

// KPI → {dim, thresholds} map derived from HOURLY_KPI_REGISTRY. Passed
// to ScatterHeatmapAvg as `kpiConfigMap` when rendering the hourly
// Aggregate view so the visualMap reads the correct hourly dim
// (instead of falling through to the Avg-mode default).
const HOURLY_KPI_CONFIG_MAP = (() => {
  const m = {};
  for (const k of Object.values(HOURLY_KPI_REGISTRY)) {
    m[k.label] = { dim: k.dim, thresholds: threshold_dict[k.thresholdKey] };
  }
  return m;
})();

// Avg-view KPI → scatter-tuple dim. Mirrors the inner map of the
// legend computation but lifted here so the Percentile component (and
// other render-time consumers) can resolve "which slot of the scatter
// tuple carries the current KPI's value?" without re-deriving inside
// every memo. Add a new KPI here when extending the Avg KPI list.
const KPI_DIM_MAP_AVG = {
  'Drop per open day': 7, 'Win per open day': 8, 'Patron hours per open day': 9,
  'Daily open hours': 10, 'Drop per open hour': 11, 'Win per open hour': 12,
  'Patron hours per open hour': 13, 'Table minimum': 14, 'Avgbet': 15,
  'Drop per floor day': 17, 'Win per floor day': 18, 'Patron hours per floor day': 19,
  'Theo per floor day': 22, 'Theo / Win per floor day': 39, 'Theo per open day': 23, 'Theo per open hour': 24,
  'Hands per hour': 26, 'Wagered hands per hour': 27, 'Free hands per hour': 28,
  'Unused Tables': 29, 'Open Percentage': 30,
  'Active % (Min by Min)': 20,
  // Spread KPIs — tuple slots 36..38 (see dataProcessing.js).
  'Spread hours per floor day': 36,
  'Spread hours per open day':  37,
  'Actual hours vs spread':     38,
};

// ---------------------------------------------------------------------
// KPI value formatting
// ---------------------------------------------------------------------
//
// SINGLE shared formatter used by BOTH the Legend's Overall Avg row AND
// every Percentile cell. Possible because every percent-KPI is now
// emitted on the same 0..100 scale at every layer:
//
//                          Dim slot emission              Legend ratio code
//   Active % (Min by Min)  (act_min/open_min) × 100       (act_min/open_min) × 100  (scale: 100)
//   Occupancy %            (act_hrs/open_hrs) × 100       falls through to dim avg (0..100)
//   Open Percentage        (openday/floorday) × 100       (openday/floorday) × 100  (scale: 100)
//
// The legend's sum-then-divide path (kpiRatioMap below in the
// legendData useMemo) applies the per-entry `scale: 100` so its
// output matches the dim emission. The percentile cells average the
// dim values directly — also 0..100.
//
// One PERCENT_KPIS set, one formatting rule, no per-surface special
// casing. Adding a new percent KPI = one line in PERCENT_KPIS.
//
// COUNT_KPIS render as integers + the trailing row's label is
// "Total Tables" instead of "Overall Avg".
//
// Everything else (money/rate KPIs: Drop / Win / Theo / Turnover per *,
// Avgbet, Hands per hour, etc.) falls into the default K-suffix rules:
//   |val| ≥ 10000  →  "{round(val/1000)}k"      e.g. 50k, 188k
//   |val| ≥  1000  →  "{(val/1000).toFixed(1)}k"  e.g. 1.5k, 8.5k
//   else          →  locale-formatted integer
const PERCENT_KPIS = new Set([
  'Active % (Min by Min)',
  'Occupancy %',
  'Open Percentage',
]);
const COUNT_KPIS   = new Set([
  'Gametype',
  'Table minimum',
  'Table Minimum',
  'Unused Tables',
]);

// (selectedKPI) → (val) => string. Bound at render time so the
// consumer gets a stable formatter that already knows the active KPI.
function formatKpiValueFor(selectedKPI) {
  return (val) => {
    if (val == null) return '-';
    if (!Number.isFinite(val)) return '-';
    if (PERCENT_KPIS.has(selectedKPI)) return `${val.toFixed(1)}%`;
    if (COUNT_KPIS.has(selectedKPI)) {
      return val.toLocaleString(undefined, { maximumFractionDigits: 0 });
    }
    const abs = Math.abs(val);
    if (abs >= 10000) return `${(val / 1000).toFixed(0)}k`;
    if (abs >=  1000) return `${(val / 1000).toFixed(1)}k`;
    return val.toLocaleString(undefined, { maximumFractionDigits: 0 });
  };
}

// KPIs whose legend "Overall Avg" cell is a signed average DAILY
// hours figure — (Σ actual − Σ spread) / N days. Rendered with a
// sign + "h" suffix so it reads as "+1.5h / day above plan" without
// the row label having to spell that out.
const SIGNED_HOURS_PER_DAY_KPIS = new Set([
    'Actual hours vs spread', // Avg view
    'Actual vs Spread',       // 24-hr view
]);

// KPIs whose legend "Overall Avg" cell is a signed average VARIANCE %
// — (Σ actual − Σ spread) / Σ spread × 100. Rendered with a sign
// and "%" suffix so it reads as "+5.0% over plan" directly.
const SIGNED_PCT_KPIS = new Set([
    'Actual vs Spread (Detail)', // 24-hr view
]);

// Pluralize "hr"/"hrs" against a magnitude. We treat exactly ±1 as
// singular and everything else (incl. 0 and fractional values) as
// plural so the legend Overall Avg reads naturally — "+1.0 hr" but
// "+0.5 hrs", "1.5 hrs", "0 hrs".
function hrUnit(magnitude) {
    return Math.abs(magnitude) === 1 ? 'hr' : 'hrs';
}

function formatSignedHoursPerDay(val) {
    if (val == null || !Number.isFinite(val)) return '-';
    // Whole-hour display per the user's preference. "hrs" unit is
    // dropped here so the legend Overall Avg cell stays on one line
    // — the surrounding context (KPI name "Actual hours vs spread")
    // already makes the unit obvious.
    const rounded = Math.round(val);
    if (rounded === 0) return '0';
    return `${rounded > 0 ? '+' : ''}${rounded.toLocaleString()}`;
}

function formatSignedPct(val) {
    if (val == null || !Number.isFinite(val)) return '-';
    const snapped = Math.abs(val) < 0.05 ? 0 : val;
    if (snapped === 0) return '0%';
    return `${snapped > 0 ? '+' : ''}${snapped.toFixed(1)}%`;
}

// Per-surface formatters. The Overall Avg row + Percentile cells now
// diverge for the Actual-vs-Spread KPI: the row is hours/day (signed),
// the percentile cells are still per-table dim averages (encoded
// values in the 24-hr view, hours/floorday in the Avg view) — formatted
// the default way so existing reads stay intact.
function formatLegendOverallAvgFor(selectedKPI) {
    if (SIGNED_HOURS_PER_DAY_KPIS.has(selectedKPI)) return formatSignedHoursPerDay;
    if (SIGNED_PCT_KPIS.has(selectedKPI)) return formatSignedPct;
    return formatKpiValueFor(selectedKPI);
}
const formatPercentileCellFor = formatKpiValueFor;

function labelForLegendOverallAvg(selectedKPI) {
  return COUNT_KPIS.has(selectedKPI) ? 'Total Tables' : 'Overall Avg';
}

export default function PerformanceDashboard() {
  // The three datasets all flow through the same fetcher (axios →
  // fallback to bundled JSON on error). Daily + hourly are fetched on
  // mount because the Avg view + Hourly Demand panel depend on them
  // from first render. (The WD endpoint was retired — WD data is now
  // merged into the hourly stream upstream.)
  const [daily_data,  setDailyData]  = useState([]);
  const [hourly_data, setHourlyData] = useState([]);

  // Per-dataset loading flags. The active view's flag drives the
  // "switching view mode → hide the scatter + legend + insights area
  // until data lands" loading overlay below, and the manual Refresh
  // button flips both flags while it re-fetches.
  const [dailyLoading,  setDailyLoading]  = useState(true);
  const [hourlyLoading, setHourlyLoading] = useState(true);

  // `loading` mirrors the old single-flag semantics for any legacy
  // consumers — it's true until daily has arrived (so the date picker
  // and filter dropdowns can populate from real data).
  // eslint-disable-next-line no-unused-vars
  const [loading, setLoading] = useState(true);

  // Filter states
  // Default to the per-floor-day variant — that's the metric the team
  // consults most often (it accounts for closed days too, giving a
  // truer revenue intensity than per-open-day).
  const [selectedKPI, setSelectedKPI] = useState('Drop per floor day');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  const [selectedArea, setSelectedArea] = useState([]);
  const [selectedPit, setSelectedPit] = useState([]);
  const [selectedGame, setSelectedGame] = useState([]);
  const [selectedDow, setSelectedDow] = useState([]);
  // Table-minimum filter — multi-select of distinct mins observed in the
  // data (e.g. ["500", "1000", "2000"]). Empty = no filter. A row is
  // included when its dominant minimum (mode of the parsed histogram)
  // matches one of the selected values. Per-row mode (not per-table mode
  // across the range) is what lets swap-tables show only their relevant
  // hours when the user picks a single tier.
  const [selectedTableMin, setSelectedTableMin] = useState([]);

  // Advanced Switcher states
  const [selectedSwitcher, setSelectedSwitcher] = useState('Avg');
  const availableSwitchers = ['Avg', '24-hr'];

  const [showType, setShowType] = useState('Table');
  const availableShowTypes = ['Table', 'Pit', 'Zone'];

  const [showReference, setShowReference] = useState('None');

  const [selectedContour, setSelectedContour] = useState('None');
  // Contour overlay supports every numeric KPI in kpiConfigMap (everything
  // in available_KPI_Map except the categorical 'Gametype'). Built from
  // the master list so adding a new KPI flows through automatically.
  const availableContours = useMemo(
    () => ['None', ...available_KPI_Map.filter((k) => k !== 'Gametype')],
    []
  );

  const [visualMapSelected, setVisualMapSelected] = useState(null);
  const [currentHourIdx, setCurrentHourIdx] = useState(0);
  const [selectedTables, setSelectedTables] = useState([]);
  // Right-side panel switches between two views of the same scatter
  // distribution: the KPI-bucket Legend table and the rank-Percentile
  // table. Both share the row-click → selectedTables wiring below.
  const [rightPanelView, setRightPanelView] = useState('legend'); // 'legend' | 'percentile'

  // Per-date exclusion list (YYYY-MM-DD strings) applied on top of the
  // start/end date picker — used to drop holiday blocks (CNY etc.) from
  // every filter memo below. Edited via the DateExcludeDialog.
  const [excludedDates, setExcludedDates] = useState([]);
  const [excludeDialogOpen, setExcludeDialogOpen] = useState(false);
  // Set form for O(1) `has` checks inside the per-row filter memos.
  const excludedDateSet = useMemo(() => new Set(excludedDates), [excludedDates]);

  // Keep the legend panel exactly as tall as the scatter card. The
  // scatter height is driven by its aspect-ratio (so it changes as the
  // viewport width changes); the legend's natural height is content-
  // driven, so without this the two cards' bottoms drift apart. A
  // ResizeObserver on the scatter card pushes its measured height onto
  // the legend, which then fills/scrolls to fit.
  // Scatter card height — measured at mount and on every resize.
  // We use a callback ref instead of useRef + useEffect because the
  // scatter card is conditionally rendered behind activeViewLoading;
  // a mount-time useEffect would attach the ResizeObserver while the
  // ref is still null (loading spinner is showing) and never re-run
  // once the real scatter card finally renders. The callback ref
  // fires every time React attaches the DOM node, so the observer
  // always sees the real element — whether it mounts on first paint,
  // after data loads, or after a view-mode switch.
  const [scatterCardHeight, setScatterCardHeight] = useState(null);
  const scatterRoRef = useRef(null);
  const scatterCardRef = useCallback((node) => {
    // Tear down any previous observer when the node detaches.
    if (scatterRoRef.current) {
      scatterRoRef.current.disconnect();
      scatterRoRef.current = null;
    }
    if (!node) return;
    // Seed immediately so the right column locks to the right height
    // on the first paint after the card appears (ResizeObserver fires
    // on attach too, but this also covers the rare case where the
    // node is laid out synchronously before the observer schedules).
    const initial = node.getBoundingClientRect().height;
    if (initial > 0) setScatterCardHeight(initial);
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) {
        const h = e.contentRect.height;
        if (h > 0) setScatterCardHeight(h);
      }
    });
    ro.observe(node);
    scatterRoRef.current = ro;
  }, []);

  const [hourlyMode, setHourlyMode] = useState('Timeline');
  const [selectedHours, setSelectedHours] = useState([
    6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23,
    0, 1, 2, 3, 4, 5,
  ]);
  const availableHours = [
    6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23,
    0, 1, 2, 3, 4, 5,
  ];

  const handleBrushSelected = useCallback((labels) => {
    const normalized = [...new Set(labels)]
      .map((l) => String(l).trim().toUpperCase())
      .sort();
    setSelectedTables((prev) => {
      const sortedPrev = [...prev].sort();
      if (
        sortedPrev.length === normalized.length &&
        sortedPrev.every((v, i) => v === normalized[i])
      ) {
        return prev;
      }
      return normalized;
    });
  }, []);

  const [availableAreas, setAvailableAreas] = useState([]);
  const [availablePits, setAvailablePits] = useState([]);
  const [availableGames, setAvailableGames] = useState([]);
  // Distinct table-minimums observed across daily_data, rendered as
  // strings (e.g. "500") for the dropdown. Sorted ascending. Bootstrapped
  // once daily lands (same trigger as the other filter option lists).
  const [availableTableMins, setAvailableTableMins] = useState([]);
  // DoW filter options — matches the DOW_BUCKETS exported from
  // dataSource.js (Mon-Thu collapse into 'WD'; Fri / Sat / Sun stand
  // alone). Boundary normalisation re-derives every row's `dow` from
  // its date so filtering against this list is consistent across data
  // sources, regardless of what the API originally sent.
  const [availableDows] = useState(['WD', 'Fri', 'Sat', 'Sun']);

  // ---- Mount-time fetches: daily + hourly ------------------------------
  //
  // Daily is fetched first because the date picker + filter dropdowns
  // bootstrap from it. Hourly is fetched in parallel since the Hourly
  // Demand panel renders in every view mode (Avg / 24-hr / WD).
  //
  // Reusable per-dataset loaders. Each:
  //   • flips its loading flag,
  //   • awaits the fetcher (API → fallback fixture),
  //   • writes the new rows + clears the flag.
  // Used by both the mount-time effects and the manual Refresh button
  // so the two paths share one code path. A monotonically increasing
  // request token guards against late stale responses: if Refresh is
  // clicked twice quickly, only the latest request's result lands.
  const dailyReqRef  = useRef(0);
  const hourlyReqRef = useRef(0);

  const loadDaily = useCallback(() => {
    const token = ++dailyReqRef.current;
    setDailyLoading(true);
    fetchDailyData()
      .then((rows) => {
        if (token === dailyReqRef.current) setDailyData(rows);
      })
      .finally(() => {
        if (token === dailyReqRef.current) setDailyLoading(false);
      });
  }, []);

  const loadHourly = useCallback(() => {
    const token = ++hourlyReqRef.current;
    setHourlyLoading(true);
    fetchHourlyData()
      .then((rows) => {
        if (token === hourlyReqRef.current) setHourlyData(rows);
      })
      .finally(() => {
        if (token === hourlyReqRef.current) setHourlyLoading(false);
      });
  }, []);

  // Manual refresh — re-fetches BOTH datasets in parallel so a single
  // click brings everything (scatter / legend / insights / hourly
  // demand) up to date without an F5.
  const refreshAll = useCallback(() => {
    loadDaily();
    loadHourly();
  }, [loadDaily, loadHourly]);

  useEffect(() => { loadDaily();  }, [loadDaily]);
  useEffect(() => { loadHourly(); }, [loadHourly]);

  // Filter / date-picker bootstrap — runs once daily rows have landed.
  useEffect(() => {
    if (!daily_data || daily_data.length === 0) return;
    const uniqueDates = [...new Set(daily_data.map((item) => item.date))].sort();
    setStartDate(uniqueDates[0] || '');
    setEndDate(uniqueDates[uniqueDates.length - 1] || '');
    setAvailableAreas([...new Set(daily_data.map((item) => item.area))].sort());
    setAvailablePits(
      [...new Set(daily_data.map((item) => String(item.pit)))].sort(
        (a, b) => parseInt(a) - parseInt(b)
      )
    );
    setAvailableGames([...new Set(daily_data.map((item) => item.gametype))].sort());
    // Build the table-min option list. Each row's `tablemin` is a
    // "min:weight,…" histogram string — parse out the keys and union
    // them across all rows. Sorted numerically so "500" precedes "1000".
    const mins = new Set();
    for (const d of daily_data) {
      const hist = parseTablemin(d.tablemin);
      for (const k of Object.keys(hist)) mins.add(String(k));
    }
    setAvailableTableMins(
      [...mins].sort((a, b) => parseInt(a, 10) - parseInt(b, 10))
    );
    setLoading(false);
  }, [daily_data]);

  // Header label for the 24-hr scatter overlay — "Mon DD, YYYY (DoW)"
  // for a single date, or a start–end range when multiple dates are in
  // scope. Parsed as UTC midnight so the weekday never rolls.
  const hourlyDateLabel = useMemo(() => {
    const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const DOW = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    const fmt = (iso) => {
      if (!iso) return '';
      const dt = new Date(String(iso).slice(0, 10) + 'T00:00:00Z');
      if (Number.isNaN(dt.getTime())) return iso;
      return `${MON[dt.getUTCMonth()]} ${dt.getUTCDate()}, ${dt.getUTCFullYear()} (${DOW[dt.getUTCDay()]})`;
    };
    if (!startDate) return '';
    if (!endDate || startDate === endDate) return fmt(startDate);
    return `${fmt(startDate)} – ${fmt(endDate)}`;
  }, [startDate, endDate]);

  // Daily rows with a guaranteed `spread` field.
  //
  // BUG FIX: the daily dataset (data_cod.json / cod_daily) ships WITHOUT
  // a `spread` column, even though the daily spread KPIs ("Spread hours
  // per floorday/openday", "Actual hours vs spread") and the Per-Pit
  // Spread Summary all read `d.spread`. The result was spread = 0
  // everywhere (every pit reading "Over Spread" by its full open hours).
  //
  // The hourly dataset DOES carry `spread` (per-hour 0/1 = scheduled or
  // not). A table-day's scheduled open hours is just the Σ of its hourly
  // spread flags — exactly what the daily `spread` should be. So when a
  // daily row lacks spread, we backfill it from the hourly stream keyed
  // on (date, gametype, table). Rows that already carry spread (real API)
  // are left untouched.
  const dailyDataWithSpread = useMemo(() => {
    if (!daily_data || daily_data.length === 0) return daily_data;
    // Nothing to backfill if every row already has spread.
    const needsBackfill = daily_data.some((d) => d.spread == null);
    if (!needsBackfill || !hourly_data || hourly_data.length === 0) return daily_data;

    const spreadByDateTable = new Map();
    for (const h of hourly_data) {
      const key = h.date + '|' + gametypeTableKey(h.gametype, h.table);
      spreadByDateTable.set(key, (spreadByDateTable.get(key) || 0) + (Number(h.spread) || 0));
    }
    return daily_data.map((d) => {
      if (d.spread != null) return d;
      const key = d.date + '|' + gametypeTableKey(d.gametype, d.table);
      return { ...d, spread: spreadByDateTable.get(key) || 0 };
    });
  }, [daily_data, hourly_data]);

  const currentKPIOptions = useMemo(() => {
    if (selectedSwitcher === '24-hr') return available_KPI_Map_Hour;
    return available_KPI_Map;
  }, [selectedSwitcher]);

  // Reference dropdown is the same option list as the KPI dropdown — minus
  // the currently selected KPI (no point comparing a chart with itself),
  // plus a 'None' sentinel that disables the reference panel.
  const availableReferences = useMemo(
    () => ['None', ...currentKPIOptions.filter((k) => k !== selectedKPI)],
    [currentKPIOptions, selectedKPI]
  );

  useEffect(() => {
    if (!currentKPIOptions.includes(selectedKPI)) {
      setSelectedKPI(currentKPIOptions[0]);
    }
    setVisualMapSelected(null);
    setCurrentHourIdx(0);
    if (selectedSwitcher === 'Avg') setHourlyMode('Timeline');
  }, [selectedSwitcher, selectedKPI, currentKPIOptions]);

  // Reset Reference when its current value is no longer valid for the
  // active KPI list (e.g. after switching view mode or KPI).
  useEffect(() => {
    if (showReference !== 'None' && !availableReferences.includes(showReference)) {
      setShowReference('None');
    }
  }, [availableReferences, showReference]);

  const { baseScatterData, hourList, baseActiveData, isSingleDay } = useMemo(() => {
    if (!startDate || !endDate)
      return { baseScatterData: [], hourList: [], baseActiveData: [], isSingleDay: false };

    // Active TG tables whose validity window covers the picker's end-date.
    const filteredConfig = config_data.filter(
      (c) =>
        c.Group === 'TG' &&
        c.is_Active === 1 &&
        c.startdate <= endDate &&
        c.enddate >= endDate
    );
    const finalGames = selectedGame.length > 0 ? selectedGame : availableGames;
    // Table-minimum filter: per-row mode (the dominant min during that
    // row's time window) compared against the selected tier(s). Picking
    // the mode — rather than "any tier this row touched" — means a swap
    // table with 6h at $500 and 18h at $1000 is correctly classified as
    // a $1000 table for that day. Empty selection means no filter.
    const tableMinMatch = (d) => {
      if (selectedTableMin.length === 0) return true;
      const mode = tableMinimumMode(d.tablemin);
      return mode > 0 && selectedTableMin.includes(String(mode));
    };
    let scatter = [];
    let hList = [];
    let activeDataForRatios = [];
    // Only meaningful in the 24-hr branch; surfaced via the useMemo
    // return so ScatterHeatmapPlay can swap the "Actual vs Spread"
    // threshold ramp to the single-day 4-bucket variant.
    let isSingleDay = false;

    if (selectedSwitcher === 'Avg') {
      // Use the spread-enriched daily rows so the Avg spread KPIs +
      // Per-Pit Spread Summary see real scheduled hours (see
      // dailyDataWithSpread above).
      const filteredDaily = dailyDataWithSpread.filter((d) => {
        const dateMatch = d.date >= startDate && d.date <= endDate && !excludedDateSet.has(d.date);
        const areaMatch = selectedArea.length === 0 || selectedArea.includes(d.area);
        const pitMatch = selectedPit.length === 0 || selectedPit.includes(String(d.pit));
        const gameMatch = selectedGame.length === 0 || selectedGame.includes(d.gametype);
        const dowMatch = selectedDow.length === 0 || selectedDow.includes(d.dow);
        return dateMatch && areaMatch && pitMatch && gameMatch && dowMatch && tableMinMatch(d);
      });
      scatter = buildAvgScatterData(
        filteredDaily,
        filteredConfig,
        showType,
        [],
        finalGames,
        startDate,
        endDate
      );
      activeDataForRatios = filteredDaily;
    } else if (selectedSwitcher === '24-hr') {
      hList = [
        6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23,
        0, 1, 2, 3, 4, 5,
      ];
      const filteredHourly = hourly_data.filter((d) => {
        const dateMatch = d.date >= startDate && d.date <= endDate && !excludedDateSet.has(d.date);
        const areaMatch = selectedArea.length === 0 || selectedArea.includes(d.area);
        const pitMatch = selectedPit.length === 0 || selectedPit.includes(String(d.pit));
        const gameMatch = selectedGame.length === 0 || selectedGame.includes(d.gametype);
        const dowMatch = selectedDow.length === 0 || selectedDow.includes(d.dow);
        return dateMatch && areaMatch && pitMatch && gameMatch && dowMatch && tableMinMatch(d);
      });
      activeDataForRatios = filteredHourly;
      // "Actual vs Spread" 4-state binary encoding (Open as Spread /
      // Over / Under / Close as Spread) only applies in TIMELINE mode
      // with exactly one date in scope — that's when each cell really
      // is a binary 2×2 cross of (actual ∈ {0,1}, spread ∈ {0,1}).
      // The Aggregate path sums actual/spread across the user-picked
      // hour window, so its values aren't binary even when one date
      // is selected; it stays on the 3-state Σ-delta encoding.
      // Distinct count of `date` values in the filtered rows is the
      // cheapest, most correct signal — already respects excludedDateSet
      // + every active filter.
      const distinctDates = new Set();
      for (const r of filteredHourly) {
        if (r && r.date) distinctDates.add(r.date);
      }
      const oneDay = distinctDates.size <= 1;
      if (hourlyMode === 'Aggregate') {
        // Aggregate view always uses the 3-state encoding.
        isSingleDay = false;
        scatter = buildAggregatedHourlyScatterData(
          filteredHourly,
          filteredConfig,
          finalGames,
          selectedHours,
          false
        );
      } else {
        isSingleDay = oneDay;
        scatter = buildHourlyScatterData(
          filteredHourly,
          filteredConfig,
          selectedPit,
          finalGames,
          selectedDow,
          hList,
          startDate,
          endDate,
          oneDay
        );
      }
    }

    return { baseScatterData: scatter, hourList: hList, baseActiveData: activeDataForRatios, isSingleDay };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    startDate,
    endDate,
    excludedDateSet,
    selectedArea,
    selectedPit,
    selectedGame,
    selectedDow,
    selectedTableMin,
    selectedSwitcher,
    showType,
    availableGames,
    selectedKPI,
    hourlyMode,
    selectedHours,
    dailyDataWithSpread,
    hourly_data,
  ]);

  // Hourly KPI config for the rendered view. Same as the module-level
  // constant unless we're in single-day mode AND the user is looking
  // at "Actual vs Spread" — then the threshold ramp swaps to the
  // 4-state binary truth-table variant (Open / Over / Under / Close
  // as Spread) per the user's spec. Cheap memo so the Aggregate
  // ScatterHeatmapAvg + Timeline ScatterHeatmapPlay both pick up the
  // same swapped ramp without each rederiving it.
  const hourlyKpiConfigMapForView = useMemo(() => {
    if (!isSingleDay) return HOURLY_KPI_CONFIG_MAP;
    return {
      ...HOURLY_KPI_CONFIG_MAP,
      'Actual vs Spread': {
        ...HOURLY_KPI_CONFIG_MAP['Actual vs Spread'],
        thresholds: threshold_dict['Actual vs Spread (Single Day)_hourly'],
      },
    };
  }, [isSingleDay]);

  // Hourly rows filtered by the active date/area/pit/game/dow selection
  // AND the scatter-heatmap table brush (selectedTables). Same label
  // convention as the Avg/Hour scatter (table_label || gametype + newtable,
  // upper-cased) so the Hourly Demand panel reacts to the same brush
  // the Trend Review / Ranking View already follow.
  const hourlyDataForDemand = useMemo(() => {
    if (!startDate || !endDate) return [];
    const tableSet =
      selectedTables.length > 0
        ? new Set(selectedTables.map((t) => String(t).trim().toUpperCase()))
        : null;
    return hourly_data.filter((d) => {
      const dateMatch = d.date >= startDate && d.date <= endDate && !excludedDateSet.has(d.date);
      const areaMatch = selectedArea.length === 0 || selectedArea.includes(d.area);
      const pitMatch = selectedPit.length === 0 || selectedPit.includes(String(d.pit));
      const gameMatch = selectedGame.length === 0 || selectedGame.includes(d.gametype);
      const dowMatch = selectedDow.length === 0 || selectedDow.includes(d.dow);
      // Same per-row tablemin-mode check as the scatter pipeline above
      // so the Hourly Demand panel stays in lockstep with the heatmap
      // when the user picks a tier (e.g. $1000 tables only).
      const tmMatch =
        selectedTableMin.length === 0 ||
        (() => {
          const mode = tableMinimumMode(d.tablemin);
          return mode > 0 && selectedTableMin.includes(String(mode));
        })();
      if (!(dateMatch && areaMatch && pitMatch && gameMatch && dowMatch && tmMatch)) return false;
      if (!tableSet) return true;
      // Brush selection can use a table label, "PIT n", or "ZONE n"
      // pattern — match any of them against this hourly row.
      const tableId = String(d.gametype + d.table).trim().toUpperCase();
      const pitId = ('PIT ' + d.pit).trim().toUpperCase();
      // hourly_data doesn't carry zone today; only table/pit checks.
      return tableSet.has(tableId) || tableSet.has(pitId);
    });
  }, [hourly_data, startDate, endDate, excludedDateSet, selectedArea, selectedPit, selectedGame, selectedDow, selectedTableMin, selectedTables]);

  const { scatterData, activeDataForRatios } = useMemo(() => {
    let finalActiveData = baseActiveData;
    if (selectedTables.length > 0) {
      const tableSet = new Set(selectedTables.map((t) => String(t).trim().toUpperCase()));
      finalActiveData = baseActiveData.filter((d) => {
        const tableId = String(d.gametype + d.table).trim().toUpperCase();
        const pitId = ('Pit ' + d.pit).trim().toUpperCase();
        // Zone is resolved via TABLE_ZONE_MAP (keyed gametype+table)
        // — data rows no longer carry a `zone` field; config.json is
        // the single source.
        const zoneFromCfg = TABLE_ZONE_MAP.get(gametypeTableKey(d.gametype, d.table)) || '';
        const zoneId = ('Zone ' + zoneFromCfg).trim().toUpperCase();
        return tableSet.has(tableId) || tableSet.has(pitId) || tableSet.has(zoneId);
      });
    }
    return { scatterData: baseScatterData, activeDataForRatios: finalActiveData };
  }, [baseActiveData, baseScatterData, selectedTables]);

  const legendData = useMemo(() => {
    if (scatterData.length === 0)
      return { columns: [], dataRows: [], overallAverages: {} };

    // Legend columns are derived from the distinct sub_segment values
    // present in the visible scatter set, then ordered via the curated
    // SUB_SEGMENT_ORDER list in heatmapConstants. Membership is fully
    // data-driven (the API decides which sub_segments exist); order is
    // configurable (edit SUB_SEGMENT_ORDER to re-arrange columns
    // without touching this file). Rows with empty/null sub_segment
    // are excluded — see legendGroupForSubSegment.
    const subSegmentSet = new Set();
    for (const s of scatterData) {
      const seg = legendGroupForSubSegment(s[35]);
      if (seg) subSegmentSet.add(seg);
    }
    const customAreas = sortSubSegmentsByPreference(subSegmentSet);
    const legend = { columns: customAreas, dataRows: [], overallAverages: {} };

    // Selection filter — works across all 3 views.
    //
    // Slot 16 (table_label) is a SCALAR in Avg mode but a PER-HOUR
    // ARRAY in 24-hr and WD modes. We must unwrap it before string
    // comparison; otherwise `String([...])` becomes "BJ100,BJ100,..."
    // and never matches the uppercase scalar "BJ100" that the brush
    // handler emits — causing the legend to show empty rows whenever
    // the user brushes in 24-hr / WD.
    //
    // Pit + zone matching is included so a ranking-chart selection
    // (which emits "PIT n" / "ZONE n") also filters the legend.
    const filteredScatterData =
      selectedTables.length > 0
        ? scatterData.filter((s) => {
            const cell = s[16];
            const tableLabel = Array.isArray(cell) ? cell[currentHourIdx] : cell;
            const id     = String(tableLabel || '').trim().toUpperCase();
            const pitId  = ('PIT '  + s[32]).trim().toUpperCase();
            const zoneId = ('ZONE ' + s[31]).trim().toUpperCase();
            return (
              selectedTables.includes(id) ||
              selectedTables.includes(pitId) ||
              selectedTables.includes(zoneId)
            );
          })
        : scatterData;

    // Legend grouping is now sub_segment-based — the API tells us which
    // column a row belongs to via the per-row `sub_segment` field, so
    // the dashboard no longer needs an inline pit→group mapping table.
    // Scatter tuples carry sub_segment at slot 35; raw data records
    // carry it as `d.sub_segment`. Rows with empty/null sub_segment
    // are excluded from the legend (resolver returns null).
    const scatterArea = (s) => legendGroupForSubSegment(s[35]);
    const recordArea  = (d) => legendGroupForSubSegment(d.sub_segment);

    if (filteredScatterData.length > 0) {
      let thresholds = null;
      let kpiIdx = null;

      const kpiIdxMapAvg = {
        'Drop per open day': 7, 'Win per open day': 8, 'Patron hours per open day': 9,
        'Daily open hours': 10, 'Drop per open hour': 11, 'Win per open hour': 12,
        'Patron hours per open hour': 13, 'Table minimum': 14, 'Avgbet': 15,
        'Drop per floor day': 17, 'Win per floor day': 18, 'Patron hours per floor day': 19,
        'Theo per floor day': 22, 'Theo / Win per floor day': 39, 'Theo per open day': 23, 'Theo per open hour': 24,
        'Hands per hour': 26, 'Wagered hands per hour': 27, 'Free hands per hour': 28,
        'Unused Tables': 29, 'Open Percentage': 30,
        'Active % (Min by Min)': 20,
        // Spread KPIs (Avg view) — see KPI_DIM_MAP_AVG module-level
        // map for the canonical list; kept in sync here so the legend
        // bucket counter resolves the same dim.
        'Spread hours per floor day': 36,
        'Spread hours per open day':  37,
        'Actual hours vs spread':     38,
      };
      // Hourly legend maps are derived from the same HOURLY_KPI_REGISTRY
      // the builder + scatter component use, so a KPI added there
      // automatically colors correctly in the legend too.
      const kpiIdxMapHourly = {};
      const hourlyThresholdKeys = {};
      for (const k of Object.values(HOURLY_KPI_REGISTRY)) {
        kpiIdxMapHourly[k.label] = k.dim;
        hourlyThresholdKeys[k.label] = k.thresholdKey;
      }

      if (selectedSwitcher === 'Avg') {
        // Use the area-scoped resolver so the legend's bucket
        // boundaries always agree with the scatter visualMap's
        // pieces — both read from heatmapConstants.thresholdsFor().
        thresholds = thresholdsFor(selectedKPI, selectedArea);
        kpiIdx = kpiIdxMapAvg[selectedKPI];
      } else if (selectedSwitcher === '24-hr') {
        let tKey = hourlyThresholdKeys[selectedKPI];
        // Single-day Timeline override: the "Actual vs Spread" KPI
        // emits the 4-state binary truth-table in this mode, so the
        // legend has to read its 4-bucket ramp too — otherwise the
        // table keeps showing the 3-bucket Σ-delta groups and the
        // counts collapse into the wrong buckets. `isSingleDay` is
        // already gated to (Timeline mode AND one date in scope)
        // upstream, so no extra hourlyMode check is needed here.
        if (isSingleDay && selectedKPI === 'Actual vs Spread') {
          tKey = 'Actual vs Spread (Single Day)_hourly';
        }
        // 24-hr KPIs don't have per-area overrides yet — fall through
        // to the canonical ramp. (Add an entry to
        // threshold_dict_byArea keyed by the same `tKey` if needed.)
        thresholds = tKey ? threshold_dict[tKey] || null : null;
        kpiIdx = kpiIdxMapHourly[selectedKPI];
      }

      if (selectedKPI === 'Gametype') {
        // Filter out the blank gametype that no-data tables now carry
        // (see dataProcessing.js — d[3] is blanked when a table has no
        // data in the filter set) so it doesn't become a phantom row.
        const gameTypes = [...new Set(scatterData.map((s) => s[3]))].filter(Boolean).sort();
        legend.dataRows = gameTypes.map((gt) => {
          const row = { key: gt, color: GAMETYPE_COLORS[gt] || 'rgba(150,150,150,0.8)' };
          const tables = new Set();
          customAreas.forEach((ca) => {
            const matches = filteredScatterData.filter(
              (s) => s[3] === gt && scatterArea(s) === ca
            );
            row[ca] = matches.length;
            for (const m of matches) tables.add(String(m[16] || '').trim().toUpperCase());
          });
          // Row's table set (across all areas) — used by the legend
          // row-click handler to push these table IDs into the global
          // selectedTables state (same model the brush uses).
          row._tables = tables;
          return row;
        });
      } else if (thresholds && kpiIdx !== undefined) {
        legend.dataRows = thresholds.map((t) => {
          const row = { key: t.label, color: t.color };
          const tables = new Set();
          customAreas.forEach((ca) => {
            const matches = filteredScatterData.filter((s) => {
              if (scatterArea(s) !== ca) return false;
              let val = s[kpiIdx];
              if (val === -1000000 || val === -999999) return false;
              if (Array.isArray(val)) {
                val = val[currentHourIdx];
                if (val === undefined || val <= -1000000) return false;
              }
              return (t.gte === undefined || val >= t.gte) && (t.lt === undefined || val < t.lt);
            });
            row[ca] = matches.length;
            for (const m of matches) tables.add(String(m[16] || '').trim().toUpperCase());
          });
          row._tables = tables;
          return row;
        });
      }

      const kpiRatioMap = {
        'Drop per open day': { num: 'drop', den: 'openday' },
        'Win per open day': { num: 'win', den: 'openday' },
        'Patron hours per open day': { num: 'patronhrs', den: 'openday' },
        'Drop per floor day': { num: 'drop', den: 'floorday' },
        'Win per floor day': { num: 'win', den: 'floorday' },
        'Patron hours per floor day': { num: 'patronhrs', den: 'floorday' },
        'Drop per open hour': { num: 'drop', den: 'openhours' },
        'Win per open hour': { num: 'win', den: 'openhours' },
        'Patron hours per open hour': { num: 'patronhrs', den: 'openhours' },
        // avgbet = Σturnover / Σpatron_hands (paying-patron hand count).
        // `wager` was renamed to `turnover` for terminology alignment.
        'Avgbet': { num: 'turnover', den: 'patron_hands' },
        'Theo per floor day': { num: 'theo', den: 'floorday' },
        'Theo per open day': { num: 'theo', den: 'openday' },
        'Theo per open hour': { num: 'theo', den: 'openhours' },
        // Percent KPIs carry `scale: 100` so the legend's overall-avg
        // output ends up on the same 0..100 scale as the dim emission
        // (see dataProcessing.js — open_percentage + active_pct_min
        // are both × 100 there). One unified PERCENT_KPIS set in the
        // formatter then handles them all without per-KPI scaling.
        'Open Percentage':       { num: 'openday',         den: 'floorday',     scale: 100 },
        'Active % (Min by Min)': { num: 'active_minutes',  den: 'open_minutes', scale: 100 },
        // Spread KPIs — sum-then-divide across the bucket. The
        // "Actual hours vs spread" custom path can't express
        // (openhours − spread) / floorday with a num/den pair, so
        // it falls through to the dim-average fallback below (the
        // dim already carries the per-table difference per floorday).
        'Spread hours per floor day': { num: 'spread',    den: 'floorday' },
        'Spread hours per open day':  { num: 'spread',    den: 'openday'  },
      };
      const ratio = kpiRatioMap[selectedKPI];
      customAreas.forEach((ca) => {
        const customData = activeDataForRatios.filter(
          (d) => recordArea(d) === ca
        );
        const targetHour = hourList[currentHourIdx];
        const customDataForHour =
          selectedSwitcher === 'Avg'
            ? customData
            : customData.filter((d) => parseInt(d.hour) === parseInt(targetHour));

        if (customDataForHour.length === 0) {
          legend.overallAverages[ca] = 0;
        } else if (
          selectedKPI === 'Actual hours vs spread' ||
          selectedKPI === 'Actual vs Spread' ||
          selectedKPI === 'Actual vs Spread (Detail)'
        ) {
          // Σ-based spread metrics. Both pull from the same two
          // accumulators; only the rollup differs:
          //   "Actual hours vs spread" / "Actual vs Spread"
          //     → (Σ actual − Σ spread) / N days       (hours/day)
          //   "Actual vs Spread (Detail)"
          //     → (Σ actual − Σ spread) / Σ spread × 100  (signed %)
          // N is the distinct `date` count in the filtered rows for
          // this area — already respects the date picker,
          // excludedDateSet, and every active filter.
          const totalActual = customDataForHour.reduce(
            (acc, d) => acc + (parseFloat(d.openhours) || 0),
            0
          );
          const totalSpread = customDataForHour.reduce(
            (acc, d) => acc + (parseFloat(d.spread) || 0),
            0
          );
          if (selectedKPI === 'Actual vs Spread (Detail)') {
            legend.overallAverages[ca] = totalSpread > 0
              ? ((totalActual - totalSpread) / totalSpread) * 100
              : 0;
          } else {
            const days = new Set(customDataForHour.map((d) => d.date)).size;
            legend.overallAverages[ca] = days > 0
              ? (totalActual - totalSpread) / days
              : 0;
          }
        } else if (selectedKPI === 'Theo / Win per floor day') {
          // Blended numerator: Σtheo for BA/NC rows, Σwin for the rest,
          // over Σfloorday. Can't be expressed as a single num/den pair
          // (the numerator field depends on gametype), so it gets its
          // own sum-then-divide branch — matching the per-row blend in
          // dataProcessing.js so the legend agrees with the scatter.
          const totalNum = customDataForHour.reduce(
            (acc, d) => acc + (
              (d.gametype === 'BA' || d.gametype === 'NC')
                ? (parseFloat(d.theo) || 0)
                : (parseFloat(d.win)  || 0)
            ),
            0
          );
          const totalDen = customDataForHour.reduce(
            (acc, d) => acc + (parseFloat(d.floorday) || 0),
            0
          );
          legend.overallAverages[ca] = totalDen > 0 ? totalNum / totalDen : 0;
        } else if (ratio) {
          const totalNum = customDataForHour.reduce(
            (acc, d) => acc + (parseFloat(d[ratio.num]) || 0),
            0
          );
          const totalDen = customDataForHour.reduce(
            (acc, d) => acc + (parseFloat(d[ratio.den]) || 0),
            0
          );
          // `scale` lets percent KPIs land on the same 0..100 scale
          // as their dim emission. Money / rate KPIs (the majority)
          // have no scale field — `scale ?? 1` is a no-op for them.
          const baseRatio = totalDen > 0 ? totalNum / totalDen : 0;
          legend.overallAverages[ca] = baseRatio * (ratio.scale ?? 1);
        } else if (selectedKPI === 'Gametype' || selectedKPI === 'Table minimum') {
          legend.overallAverages[ca] = scatterData.filter((s) => {
            const val = s[selectedKPI === 'Gametype' ? 3 : 14];
            const currentVal = Array.isArray(val) ? val[currentHourIdx] : val;
            if (scatterArea(s) !== ca) return false;
            if (selectedKPI === 'Gametype') {
              return currentVal !== undefined && currentVal !== '' && currentVal !== null;
            }
            return currentVal !== undefined && currentVal > -1000000;
          }).length;
        } else {
          const scatterInCustomArea = scatterData.filter(
            (s) => scatterArea(s) === ca
          );
          // Fallback dim lookup for the overall-average row. Avg-mode
          // dims are hardcoded; hourly KPI dims are merged in from
          // the registry-derived map above so newly-added registry
          // KPIs get an overall-average value instead of showing 0.
          const kpiIdxMapForAvg = {
            'Daily open hours': 10, 'Table minimum': 14, 'Avgbet': 15,
            'Hands per hour': 26, 'Wagered hands per hour': 27, 'Free hands per hour': 28,
            'Unused Tables': 29, 'Open Hours': 10, 'Patron Hours': 9, 'Theo per table per hour': 24,
            ...kpiIdxMapHourly,
          };
          const kpiIdx2 = kpiIdxMapForAvg[selectedKPI];
          if (kpiIdx2 !== undefined && scatterInCustomArea.length > 0) {
            const values = scatterInCustomArea
              .map((s) => {
                const val = s[kpiIdx2];
                return Array.isArray(val) ? val[currentHourIdx] : val;
              })
              .filter((v) => v !== undefined && v > -1000000);
            if (values.length > 0) {
              const sum = values.reduce((acc, v) => acc + v, 0);
              legend.overallAverages[ca] = sum / values.length;
            } else legend.overallAverages[ca] = 0;
          } else legend.overallAverages[ca] = 0;
        }
      });
    }
    return legend;
  }, [
    scatterData,
    currentHourIdx,
    selectedKPI,
    selectedSwitcher,
    selectedArea,        // thresholdsFor() switches on area selection
    activeDataForRatios,
    hourList,
    selectedTables,
  ]);

  // ---- Legend / Percentile row-click → table selection ---------------
  //
  // Clicking a bucket row should toggle the union of that bucket's
  // tables in the same `selectedTables` state the brush already drives.
  // One selection model means the scatter (opacity), the Ranking Chart,
  // and the Hourly Demand panel all react to legend clicks the same
  // way they react to a brush — no parallel selection plumbing.
  const handleLegendRowToggle = useCallback((tableSet) => {
    if (!tableSet || tableSet.size === 0) return;
    setSelectedTables((prev) => {
      const prevSet = new Set(prev);
      const bucket = [...tableSet];
      // Toggle: if every table in the bucket is already selected,
      // remove them; otherwise add the missing ones. This matches the
      // mental model of "click row → highlight; click again → unhighlight".
      const allSelected = bucket.every((t) => prevSet.has(t));
      if (allSelected) {
        for (const t of bucket) prevSet.delete(t);
      } else {
        for (const t of bucket) prevSet.add(t);
      }
      return [...prevSet].sort();
    });
  }, []);

  const handleClearSelection = useCallback(() => setSelectedTables([]), []);

  // By-AREA spread summary for the 24-hr "Actual vs Spread" KPI, for the
  // CURRENT hour only (not a 24-hour total). Areas collapse to two
  // groups — PM (area === 'PM') and MS (everything else: MSC / Main /
  // VIP / Slots) — plus a Total. Per the hour the timeline is showing:
  //   • Spread  = # tables scheduled open that hour (Σ spread===1)
  //   • Actual  = # tables actually open that hour   (Σ openhours>0)
  //   • Variance = Actual − Spread
  const byAreaHourRows = useMemo(() => {
    if (selectedSwitcher !== '24-hr' || selectedKPI !== 'Actual vs Spread') return null;
    if (!Array.isArray(activeDataForRatios) || activeDataForRatios.length === 0) return [];
    const targetHour = hourList[currentHourIdx];
    if (targetHour == null) return [];
    const g = { MS: { spread: 0, actual: 0 }, PM: { spread: 0, actual: 0 } };
    for (const d of activeDataForRatios) {
      if (parseInt(d.hour, 10) !== parseInt(targetHour, 10)) continue;
      const key = String(d.area) === 'PM' ? 'PM' : 'MS';
      if (Number(d.spread) === 1) g[key].spread += 1;
      if (parseFloat(d.openhours) > 0) g[key].actual += 1;
    }
    const mk = (area, v) => ({ area, spread: v.spread, actual: v.actual, variance: v.actual - v.spread });
    return [
      mk('MS', g.MS),
      mk('PM', g.PM),
      mk('Total', { spread: g.MS.spread + g.PM.spread, actual: g.MS.actual + g.PM.actual }),
    ];
  }, [selectedSwitcher, selectedKPI, activeDataForRatios, hourList, currentHourIdx]);

  // Currently-selected legend rows — derived from `selectedTables` so
  // the UI never gets out of sync with the underlying table-selection
  // state. A row is "selected" when EVERY table in its bucket is in
  // the selected set (i.e. the user clicked the row, which added the
  // whole bucket).
  const selectedLegendRowKeys = useMemo(() => {
    if (selectedTables.length === 0) return new Set();
    const sel = new Set(selectedTables);
    const out = new Set();
    for (const row of legendData.dataRows || []) {
      if (!row._tables || row._tables.size === 0) continue;
      let all = true;
      for (const t of row._tables) {
        if (!sel.has(t)) { all = false; break; }
      }
      if (all) out.add(row.key);
    }
    return out;
  }, [legendData, selectedTables]);

  if (loading) return <Box sx={{ p: 4, color: '#7aa2f7' }}>Loading data…</Box>;

  // Whether the dataset the ACTIVE view depends on is still loading.
  // Avg needs daily; 24-hr needs hourly. While true we hide the data
  // panels (scatter + legend + insights + Hourly Demand) and show a
  // single centered spinner so the UI doesn't flash empty heatmaps
  // and zeroed-out legend rows while a view-mode switch or manual
  // refresh is in flight.
  const activeViewLoading =
    selectedSwitcher === 'Avg'
      ? (dailyLoading || daily_data.length === 0)
      : (hourlyLoading || hourly_data.length === 0);

  return (
    <Box
      p={0}
      sx={{
        backgroundColor: 'rgba(30,32,48,1)',
        // Fill the route container (which sits inside App.js's
        // `overflow: hidden` chrome) and own the vertical scrollbar here
        // so the user can scroll past the 650px scatter + the 820px
        // trend-chart / reference panel below it.
        height: '100%',
        overflowY: 'auto',
        overflowX: 'hidden',
      }}
    >
      {/* Full-bleed wrapper. Replaces the old MUI <Container>/<Grid>
          combo whose gutter + Grid-spacing math left an asymmetric
          empty strip on the right. A plain border-box Box with an
          explicit 8px horizontal gutter spans the full viewport width
          (minus the gutter) deterministically. */}
      <Box sx={{ width: '100%', px: 1, boxSizing: 'border-box' }}>
        <Paper
          elevation={3}
          sx={{
            pl: 0,
            width: '100%',
            boxSizing: 'border-box',
            height: '100%',
            boxShadow: 3,
            backgroundColor: 'rgba(50,52,72,0.8)',
          }}
        >
              <Box sx={{ margin: 0, px: '10px', borderWidth: 0, pb: '10px' }}>
                <ListItem
                  sx={{
                    position: 'relative',
                    marginLeft: '0px',
                    pt: '5px',
                    flexWrap: 'wrap',
                    '&::before': {
                      content: '""',
                      width: '5px',
                      height: '50%',
                      position: 'absolute',
                      left: '-10px',
                      top: '50%',
                      transform: 'translateY(-50%)',
                      background: '#5597e6',
                    },
                  }}
                >
                  {/* Header text "CoD TG Performance Heatmap" removed —
                      the page chrome already identifies the dashboard
                      and the title was just stealing toolbar width. */}

                  <DropdownSelector
                    label="View Mode"
                    availableOptions={availableSwitchers}
                    selectedOptions={selectedSwitcher}
                    setSelectedOptions={(val) => setSelectedSwitcher(val[0] || val)}
                    multiple={false}
                    width={140}
                  />

                  <SelectorDate
                    selected_Start={startDate}
                    selected_End={endDate}
                    set_Selected_Start={setStartDate}
                    set_Selected_End={setEndDate}
                  />

                  {selectedSwitcher === 'Avg' && (
                    <DropdownSelector
                      label="Group By"
                      availableOptions={availableShowTypes}
                      selectedOptions={showType}
                      setSelectedOptions={(val) => setShowType(val[0] || val)}
                      multiple={false}
                      width={120}
                    />
                  )}

                  <DropdownSelector
                    label="Area"
                    availableOptions={availableAreas}
                    selectedOptions={selectedArea}
                    setSelectedOptions={setSelectedArea}
                  />
                  <DropdownSelector
                    label="Pit"
                    availableOptions={availablePits}
                    selectedOptions={selectedPit}
                    setSelectedOptions={setSelectedPit}
                  />
                  <DropdownSelector
                    label="Game"
                    availableOptions={availableGames}
                    selectedOptions={selectedGame}
                    setSelectedOptions={setSelectedGame}
                  />
                  {/* DOW slicer — available in BOTH Avg and 24-hr views (the
                      24-hr hourly pipeline filters on `dow` too). */}
                  <DropdownSelector
                    label="DOW"
                    availableOptions={availableDows}
                    selectedOptions={selectedDow}
                    setSelectedOptions={setSelectedDow}
                  />
                  {/* Table Minimum filter — multi-select of $-tiers. The
                      options come from the daily data (distinct mins
                      observed). When non-empty, filters every per-row
                      pipeline (scatter, legend, Hourly Demand) by
                      comparing the row's MODE minimum against the
                      selection — see tableMinMatch helper above. */}
                  <DropdownSelector
                    label="Table Min"
                    availableOptions={availableTableMins}
                    selectedOptions={selectedTableMin}
                    setSelectedOptions={setSelectedTableMin}
                  />
                  <DropdownSelector
                    label="KPI"
                    availableOptions={currentKPIOptions}
                    selectedOptions={selectedKPI}
                    setSelectedOptions={(val) => setSelectedKPI(val[0] || val)}
                    multiple={false}
                  />
                  {selectedSwitcher === 'Avg' ? (
                    <>
                      <DropdownSelector
                        label="Reference Map"
                        availableOptions={availableReferences}
                        selectedOptions={showReference}
                        setSelectedOptions={(val) => setShowReference(val[0] || val)}
                        multiple={false}
                      />
                      <DropdownSelector
                        label="Contour"
                        availableOptions={availableContours}
                        selectedOptions={selectedContour}
                        setSelectedOptions={(val) => setSelectedContour(val[0] || val)}
                        multiple={false}
                      />
                    </>
                  ) : (
                    <>
                      <DropdownSelector
                        label="Hourly Display Mode"
                        availableOptions={['Timeline', 'Aggregate']}
                        selectedOptions={hourlyMode}
                        setSelectedOptions={(val) => setHourlyMode(val[0] || val)}
                        multiple={false}
                      />
                      {hourlyMode === 'Aggregate' && (
                        <DropdownSelector
                          label="Select Hours"
                          availableOptions={availableHours.map((h) => `${h}:00`)}
                          selectedOptions={selectedHours.map((h) => `${h}:00`)}
                          setSelectedOptions={(vals) =>
                            setSelectedHours(vals.map((v) => parseInt(v.split(':')[0])))
                          }
                          multiple={true}
                        />
                      )}
                    </>
                  )}

                  {/* Right-aligned action cluster — Exclude + Refresh
                      live at the very end of the toolbar so the main
                      filter controls (View Mode → KPI → display mode)
                      read left-to-right without interruption, and the
                      actions (which don't drive filtering) sit apart
                      on the right. `ml: 'auto'` consumes the leftover
                      horizontal space, pushing the cluster to the
                      trailing edge of the row even when wrap occurs. */}
                  <Box sx={{ ml: 'auto', display: 'flex', alignItems: 'center', gap: 1 }}>
                    {/* Exclude-dates button — opens the transfer-list
                        dialog so the user can drop holiday blocks (CNY
                        etc.) from inside the active date range without
                        shrinking the range itself. Badge shows the
                        current excluded count when non-empty. */}
                    <Button
                      onClick={() => setExcludeDialogOpen(true)}
                      startIcon={<EventBusyIcon sx={{ fontSize: 22 }} />}
                      size="small"
                      sx={{
                        textTransform: 'none',
                        fontSize: PERF_FONTS.toolbar,
                        fontWeight: 600,
                        color: excludedDates.length > 0 ? '#f7768e' : 'rgba(255,255,255,0.7)',
                        borderColor: 'rgba(255,255,255,0.12)',
                        border: '1px solid',
                        bgcolor: 'rgba(255,255,255,0.02)',
                        px: 1.4,
                        '&:hover': { borderColor: 'rgba(255,255,255,0.3)', bgcolor: 'rgba(255,255,255,0.04)' },
                      }}
                    >
                      Exclude{excludedDates.length > 0 ? ` (${excludedDates.length})` : ''}
                    </Button>

                    {/* Manual refresh — re-fetches both daily + hourly
                        so the user can pull the latest data without an
                        F5 / browser reload. While a fetch is in flight
                        the icon spins and the button is disabled to
                        prevent double-submits. The data-loading gate
                        below the toolbar takes over from there. */}
                    <Button
                      onClick={refreshAll}
                      disabled={dailyLoading || hourlyLoading}
                      startIcon={
                        (dailyLoading || hourlyLoading) ? (
                          <CircularProgress size={16} thickness={5} sx={{ color: 'inherit' }} />
                        ) : (
                          <RefreshIcon sx={{ fontSize: 22 }} />
                        )
                      }
                      size="small"
                      sx={{
                        textTransform: 'none',
                        fontSize: PERF_FONTS.toolbar,
                        fontWeight: 600,
                        color: 'rgba(255,255,255,0.7)',
                        borderColor: 'rgba(255,255,255,0.12)',
                        border: '1px solid',
                        bgcolor: 'rgba(255,255,255,0.02)',
                        px: 1.4,
                        '&:hover': { borderColor: 'rgba(122,162,247,0.55)', bgcolor: 'rgba(122,162,247,0.06)' },
                        '&.Mui-disabled': { color: 'rgba(255,255,255,0.35)' },
                      }}
                    >
                      {(dailyLoading || hourlyLoading) ? 'Refreshing…' : 'Refresh'}
                    </Button>
                  </Box>
                </ListItem>
                <Divider sx={{ mb: 1, borderColor: 'rgba(100,100,100,0.8)' }} />

                {activeViewLoading ? (
                  // View-mode switch (Avg ↔ 24-hr) or manual refresh
                  // in flight, and the dataset the active view needs
                  // hasn't landed yet. Show a single centered spinner
                  // instead of an empty scatter + zeroed legend +
                  // empty Hourly Demand so the UI never flashes
                  // misleading "no data" states between fetches.
                  <Box
                    sx={{
                      width: '100%',
                      minHeight: 600,
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 2,
                      color: '#7aa2f7',
                      py: 8,
                    }}
                  >
                    <CircularProgress size={48} thickness={4} sx={{ color: '#7aa2f7' }} />
                    <Box sx={{ fontSize: 20, letterSpacing: 0.4, color: 'rgba(255,255,255,0.75)' }}>
                      Loading {selectedSwitcher === 'Avg' ? 'daily' : 'hourly'} data…
                    </Box>
                  </Box>
                ) : (
                <>
                <Stack direction="row" spacing={2} alignItems="flex-start">
                  <Box
                    ref={scatterCardRef}
                    sx={{
                      flex: 1,
                      bgcolor: 'rgba(22, 24, 38, 0.9)',
                      borderRadius: 2,
                      border: '1px solid rgba(255,255,255,0.06)',
                      boxShadow: '0 4px 24px rgba(0,0,0,0.3)',
                      overflow: 'hidden',
                    }}
                  >
                    {/* Locked at 1500x723 aspect — width grows to fill the
                        flex column, height follows from the ratio. */}
                    <Box sx={{ width: '100%', aspectRatio: '1500 / 723' }}>
                      {selectedSwitcher === 'Avg' ? (
                        <ScatterHeatmapAvg
                          data={scatterData}
                          selectedKPI={selectedKPI}
                          selectedContour={selectedContour}
                          // Title now matches the legend's title field
                          // (just the KPI name) so the scatter + legend
                          // read as one identified panel rather than
                          // two surfaces with different names.
                          title={kpiDisplayLabel(selectedKPI)}
                          selectedArea={selectedArea}
                          visualMapSelected={visualMapSelected}
                          onVisualMapSelect={setVisualMapSelected}
                          onBrushSelected={handleBrushSelected}
                          selectedTables={selectedTables}
                        />
                      ) : hourlyMode === 'Aggregate' ? (
                        <ScatterHeatmapAvg
                          data={scatterData}
                          selectedKPI={selectedKPI}
                          selectedContour="None"
                          title={kpiDisplayLabel(selectedKPI)}
                          selectedArea={selectedArea}
                          visualMapSelected={visualMapSelected}
                          onVisualMapSelect={setVisualMapSelected}
                          onBrushSelected={handleBrushSelected}
                          // Use HOURLY KPI layout (Patron Hours / Open
                          // Hours status / Table Min / etc.) so the
                          // hourly KPI dropdown drives both Timeline
                          // and Aggregate consistently.
                          kpiConfigMap={hourlyKpiConfigMapForView}
                        />
                      ) : (
                        <ScatterHeatmapPlay
                          dataForScatter={scatterData}
                          hourList={hourList}
                          selectedKPI={selectedKPI}
                          visualMapSelected={visualMapSelected}
                          onVisualMapSelect={setVisualMapSelected}
                          onTimelineChange={setCurrentHourIdx}
                          onBrushSelected={handleBrushSelected}
                          selectedTables={selectedTables}
                          isSingleDay={isSingleDay}
                          dateLabel={hourlyDateLabel}
                        />
                      )}
                    </Box>
                  </Box>

                  <Box
                    sx={{
                      width: '600px',
                      minWidth: '600px',
                      flexShrink: 0,
                      bgcolor: 'rgba(22, 24, 38, 0.9)',
                      borderRadius: 2,
                      border: '1px solid rgba(255,255,255,0.06)',
                      boxShadow: '0 4px 24px rgba(0,0,0,0.3)',
                      p: 1.5,
                      // Height locked to the scatter map's height —
                      // not min, not max, exactly that. Short content
                      // leaves empty space at the bottom; tall content
                      // (legend + Per-Pit table) scrolls inside via
                      // the body wrapper below. The scatter card's
                      // own height is content-driven by its aspect
                      // ratio, so locking the right column here cannot
                      // feed back and change it.
                      height: scatterCardHeight ? `${scatterCardHeight}px` : '600px',
                      maxHeight: scatterCardHeight ? `${scatterCardHeight}px` : '600px',
                      display: 'flex',
                      flexDirection: 'column',
                      boxSizing: 'border-box',
                      overflow: 'hidden',
                    }}
                  >
                    {/* Header row: title + Clear + switcher all on one
                        line. Title was previously rendered inside the
                        legend/percentile components — lifted up here
                        so the switcher and KPI name share a single
                        horizontal axis, eliminating the stacked-title
                        look (title row, then a separate switcher row
                        below). Components now receive `title={null}`
                        and skip their internal heading block. */}
                    <Stack
                      direction="row"
                      alignItems="center"
                      spacing={1}
                      sx={{ mb: 1.2, flexShrink: 0, px: 1 }}
                    >
                      {/* Title with the same accent-bar treatment the
                          legend component used internally. Suppressed for
                          24-hr "Actual vs Spread", which shows only the
                          by-area table (no bucket legend, no KPI title). */}
                      {!(selectedSwitcher === '24-hr' && selectedKPI === 'Actual vs Spread') && (
                        <>
                          <Box sx={{ width: 4, height: 18, bgcolor: '#7aa2f7', borderRadius: 1, flexShrink: 0 }} />
                          <Typography
                            sx={{
                              color: 'rgba(255,255,255,0.9)',
                              fontSize: PERF_FONTS.panelTitle,
                              fontWeight: 600,
                              whiteSpace: 'nowrap',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              minWidth: 0,
                              flex: 1,
                            }}
                          >
                            {rightPanelView === 'percentile' ? `Percentile of ${kpiDisplayLabel(selectedKPI)}` : kpiDisplayLabel(selectedKPI)}
                          </Typography>
                        </>
                      )}
                      {selectedTables.length > 0 && (
                        <Button
                          onClick={handleClearSelection}
                          size="small"
                          sx={{
                            textTransform: 'none',
                            fontSize: 13,
                            fontWeight: 600,
                            color: 'rgba(247, 118, 142, 0.85)',
                            border: '1px solid rgba(247, 118, 142, 0.3)',
                            px: 1.2,
                            py: 0.2,
                            minWidth: 0,
                            flexShrink: 0,
                            '&:hover': {
                              borderColor: 'rgba(247, 118, 142, 0.6)',
                              bgcolor: 'rgba(247, 118, 142, 0.06)',
                            },
                          }}
                        >
                          Clear Selection ({selectedTables.length})
                        </Button>
                      )}
                      {/* Two-pill toggle — Legend ↔ Percentile. Both
                          read the same scatterData; only the binning
                          differs (KPI thresholds vs. rank deciles).
                          HIDDEN in the 24-hr view, which is always the
                          Legend table. */}
                      {selectedSwitcher !== '24-hr' && (
                      <Stack direction="row" sx={{
                        border: '1px solid rgba(122,200,220,0.25)',
                        borderRadius: 1,
                        overflow: 'hidden',
                        flexShrink: 0,
                      }}>
                        {[
                          { v: 'legend',     label: 'Legend' },
                          { v: 'percentile', label: 'Percentile' },
                        ].map((opt) => (
                          <Box
                            key={opt.v}
                            onClick={() => setRightPanelView(opt.v)}
                            sx={{
                              px: 1.4,
                              py: 0.4,
                              cursor: 'pointer',
                              fontSize: 13,
                              fontWeight: 700,
                              letterSpacing: 0.5,
                              bgcolor: rightPanelView === opt.v ? '#7adfff' : 'transparent',
                              color: rightPanelView === opt.v ? '#0a1a2c' : 'rgba(255,255,255,0.6)',
                              transition: 'background-color 140ms',
                              '&:hover': rightPanelView !== opt.v
                                ? { bgcolor: 'rgba(122,223,255,0.08)' }
                                : undefined,
                            }}
                          >
                            {opt.label}
                          </Box>
                        ))}
                      </Stack>
                      )}
                    </Stack>

                    {/* Scrollable body — header (KPI title + view
                        switcher) above stays pinned; everything
                        from here down scrolls inside the fixed
                        panel height so the Per-Pit table can never
                        push the row taller than the scatter card.
                        Scrollbar hidden across browsers so the
                        scroll affordance is subtle. */}
                    <Box sx={{
                        flex: 1,
                        minHeight: 0,
                        overflowY: 'auto',
                        scrollbarWidth: 'none',
                        msOverflowStyle: 'none',
                        '&::-webkit-scrollbar': { display: 'none' },
                    }}>
                    {(selectedSwitcher === '24-hr' || rightPanelView === 'legend') ? (
                      <>
                      {/* 24-hr "Actual vs Spread" hides the bucket legend
                          entirely and shows ONLY the by-area spread table.
                          Every other case shows the legend table. */}
                      {!(selectedSwitcher === '24-hr' && selectedKPI === 'Actual vs Spread') && (
                      <PerformanceLegend
                        // Title lives in the parent header now (see
                        // Stack above) so the switcher and KPI name
                        // share one row — pass null to suppress the
                        // component's internal heading block.
                        title={null}
                        columns={legendData.columns}
                        dataRows={legendData.dataRows}
                        overallAverages={legendData.overallAverages}
                        overallAvgLabel={labelForLegendOverallAvg(selectedKPI)}
                        formatOverallAvg={formatLegendOverallAvgFor(selectedKPI)}
                        onRowToggle={handleLegendRowToggle}
                        selectedRowKeys={selectedLegendRowKeys}
                      />
                      )}
                      {byAreaHourRows && byAreaHourRows.length > 0 && (
                        <ByAreaHourSpreadTable
                          rows={byAreaHourRows}
                          hourLabel={hourList[currentHourIdx]}
                        />
                      )}
                      </>
                    ) : (
                      <PerformancePercentile
                        title={null}
                        scatterData={scatterData}
                        // Resolve the active KPI's slot in the scatter
                        // tuple. 24-hr view uses the hourly registry;
                        // Avg view uses KPI_DIM_MAP_AVG. Falls back to
                        // a sensible default so unknown KPIs render an
                        // empty percentile table rather than crash.
                        kpiDim={
                          selectedSwitcher === 'Avg'
                            ? KPI_DIM_MAP_AVG[selectedKPI]
                            : HOURLY_KPI_CONFIG_MAP[selectedKPI]?.dim
                        }
                        currentHourIdx={currentHourIdx}
                        selectedArea={selectedArea}
                        onRowToggle={handleLegendRowToggle}
                        // Component derives `selectedRowKeys` internally
                        // from selectedTables (same model the legend
                        // uses, but binned by decile instead of by KPI
                        // threshold). One global selection state, two
                        // views — no parallel highlight plumbing.
                        selectedTables={selectedTables}
                        // Percentile-specific formatter — DIFFERENT
                        // membership set from the legend's because
                        // the dim values feeding these cells follow
                        // a different scale convention than the
                        // legend's sum-then-divide path. See the
                        // comment block on formatPercentileCellFor
                        // above for the full scale matrix per KPI.
                        formatValue={formatPercentileCellFor(selectedKPI)}
                      />
                    )}
                    </Box>
                  </Box>
                </Stack>

                <Box sx={{ display: 'flex', width: '100%', gap: 2, mt: 2 }}>
                  <Box
                    sx={{
                      flex: 1,
                      bgcolor: 'rgba(22, 24, 38, 0.9)',
                      borderRadius: 2,
                      border: '1px solid rgba(255,255,255,0.06)',
                      boxShadow: '0 4px 24px rgba(0,0,0,0.3)',
                      overflow: 'hidden',
                    }}
                  >
                    {showReference !== 'None' && selectedSwitcher === 'Avg' ? (
                      <Box sx={{ height: '820px' }}>
                        <ScatterHeatmapAvg
                          data={scatterData}
                          selectedKPI={showReference}
                          selectedContour={selectedContour}
                          title={`Reference Heatmap - ${kpiDisplayLabel(showReference)}`}
                          visualMapSelected={visualMapSelected}
                          onVisualMapSelect={setVisualMapSelected}
                        />
                      </Box>
                    ) : (
                      // Performance Insights panel — much taller than the
                      // reference scatter so the trend cards and ranking
                      // bars have real breathing room. The reference
                      // scatter branch above keeps the original 820px
                      // because it's just a chart, not a stacked panel.
                      <Box sx={{ height: '1400px' }}>
                        <TrendCharts
                          mode={selectedSwitcher === 'Avg' ? 'Avg' : 'Play'}
                          dailyData={selectedSwitcher === 'Avg' ? activeDataForRatios : null}
                          hourlyData={selectedSwitcher !== 'Avg' ? activeDataForRatios : null}
                          hourlyDataForDemand={hourlyDataForDemand}
                          scatterData={scatterData}
                          selectedTables={selectedTables}
                          onRankingSelection={handleBrushSelected}
                        />
                      </Box>
                    )}
                  </Box>
                  {showReference !== 'None' && selectedSwitcher === 'Avg' && (
                    <Box sx={{ width: '600px', flexShrink: 0 }} />
                  )}
                </Box>
                </>
                )}
              </Box>
        </Paper>
      </Box>

      {/* Date-exclusion dialog. Mounted outside the main scroll area so
          its backdrop covers the whole viewport regardless of scroll
          position. Controlled — only commits to excludedDates on Apply. */}
      <DateExcludeDialog
        open={excludeDialogOpen}
        onClose={() => setExcludeDialogOpen(false)}
        startDate={startDate}
        endDate={endDate}
        excludedDates={excludedDates}
        onApply={setExcludedDates}
      />
    </Box>
  );
}

// ---------------------------------------------------------------------
// ByAreaHourSpreadTable — by-area (MS / PM / Total) spread vs actual for
// the CURRENT hour the timeline is showing (24-hr Actual vs Spread KPI).
//   Spread = # tables scheduled open this hour
//   Actual = # tables actually open this hour
//   Var    = Actual − Spread (green over / red under)
// ---------------------------------------------------------------------
function ByAreaHourSpreadTable({ rows, hourLabel }) {
    const HEADER_BG = 'rgba(35, 38, 55, 0.95)';
    const hr = (hourLabel != null) ? String(hourLabel).padStart(2, '0') + ':00' : '';
    return (
        <Box sx={{ width: '100%', mt: 2 }}>
            <Typography variant="subtitle2" sx={{
                color: 'rgba(255,255,255,0.9)',
                mb: 1, px: 1, fontSize: BA.title, fontWeight: 600,
                display: 'flex', alignItems: 'center', gap: 1,
            }}>
                <Box sx={{ width: 4, height: 16, bgcolor: '#7aa2f7', borderRadius: 1 }} />
                Scheduled by Area
                <Box component="span" sx={{ color: 'rgba(255,255,255,0.45)', fontSize: BA.sub, fontWeight: 500 }}>
                    @ {hr}
                </Box>
            </Typography>
            <Box component="table" sx={{ width: '100%', borderCollapse: 'collapse', fontVariantNumeric: 'tabular-nums' }}>
                <Box component="thead">
                    <Box component="tr">
                        {['Area', 'Scheduled', 'Actual', 'Variance'].map((h, i) => (
                            <Box component="th" key={h} sx={{
                                color: 'rgba(255,255,255,0.5)',
                                borderBottom: '1px solid rgba(255,255,255,0.08)',
                                bgcolor: HEADER_BG,
                                fontSize: BA.header, fontWeight: 600, py: 1.2, px: 1.6,
                                textAlign: i === 0 ? 'left' : 'right',
                            }}>{h}</Box>
                        ))}
                    </Box>
                </Box>
                <Box component="tbody">
                    {rows.map((r, idx) => {
                        const isTotal = r.area === 'Total';
                        const vColor = r.variance > 0 ? '#3dd585' : r.variance < 0 ? '#f7768e' : 'rgba(255,255,255,0.6)';
                        const base = {
                            py: 1.4, px: 1.6, fontSize: BA.body,
                            borderBottom: isTotal ? 'none' : '1px solid rgba(255,255,255,0.05)',
                            borderTop: isTotal ? '1px solid rgba(255,255,255,0.12)' : 'none',
                        };
                        const cellColor = isTotal ? '#7aa2f7' : '#fff';
                        const weight = isTotal ? 800 : 600;
                        return (
                            <Box component="tr" key={r.area} sx={{
                                bgcolor: !isTotal && idx % 2 === 1 ? 'rgba(255,255,255,0.015)' : 'transparent',
                            }}>
                                <Box component="td" sx={{ ...base, color: cellColor, fontWeight: weight, textAlign: 'left' }}>{r.area}</Box>
                                <Box component="td" sx={{ ...base, color: isTotal ? '#7aa2f7' : 'rgba(255,255,255,0.85)', fontWeight: weight, textAlign: 'right' }}>{r.spread}</Box>
                                <Box component="td" sx={{ ...base, color: cellColor, fontWeight: weight, textAlign: 'right' }}>{r.actual}</Box>
                                <Box component="td" sx={{ ...base, color: isTotal ? vColor : vColor, fontWeight: 800, textAlign: 'right' }}>
                                    {r.variance > 0 ? '+' : ''}{r.variance}
                                </Box>
                            </Box>
                        );
                    })}
                </Box>
            </Box>
        </Box>
    );
}

// ---------------------------------------------------------------------
// PerPitSpreadTable — per-pit Σactual / Σspread / variance / status,
// shown below the legend whenever the Actual-vs-Spread KPI is active.
// Styled to match PerformanceLegend so the two read as one panel.
// ---------------------------------------------------------------------
function PerPitSpreadTable({ rows }) {
    const HEADER_BG = 'rgba(35, 38, 55, 0.95)';
    const fmtH = (v) => {
        if (!Number.isFinite(v)) return '-';
        const n = Math.round(v);
        return `${n.toLocaleString()} ${hrUnit(n)}`;
    };
    const fmtSignedH = (v) => {
        if (!Number.isFinite(v)) return '-';
        const n = Math.round(v);
        return `${n > 0 ? '+' : ''}${n.toLocaleString()} ${hrUnit(n)}`;
    };
    const fmtPct = (v) => {
        if (!Number.isFinite(v)) return '—';
        const snap = Math.abs(v) < 0.05 ? 0 : v;
        return snap === 0 ? '0%' : `${snap > 0 ? '+' : ''}${snap.toFixed(1)}%`;
    };

    return (
        <Box sx={{ width: '100%', mt: 2, px: 0 }}>
            <Typography variant="subtitle2" sx={{
                color: 'rgba(255,255,255,0.9)',
                mb: 1, px: 1, fontSize: BA.title, fontWeight: 600,
                display: 'flex', alignItems: 'center', gap: 1,
            }}>
                <Box sx={{ width: 4, height: 16, bgcolor: '#7aa2f7', borderRadius: 1 }} />
                Actual vs. Scheduled by Pit
                <Box component="span" sx={{
                    color: 'rgba(255,255,255,0.45)',
                    fontSize: '0.85rem', fontWeight: 500, ml: 0.6,
                }}>
                    (Daily Avg)
                </Box>
            </Typography>
            <Box sx={{
                width: '100%',
                overflowX: 'auto',
                // The right-panel parent now owns vertical scrolling
                // (it's locked to the scatter card height) so this
                // table doesn't need its own height cap or scroll
                // affordance — that produced a nested-scroller jitter
                // when both ran out of room at the same time. The
                // sticky header on the column row still anchors the
                // titles when the user scrolls the outer body.
            }}>
                <Box component="table" sx={{
                    width: '100%', borderCollapse: 'collapse',
                    fontVariantNumeric: 'tabular-nums',
                }}>
                    <Box component="thead">
                        <Box component="tr">
                            {['Pit', 'Actual', 'Scheduled', 'Variance', 'Status'].map((h, i) => (
                                <Box component="th" key={h} sx={{
                                    color: 'rgba(255,255,255,0.5)',
                                    borderBottom: '1px solid rgba(255,255,255,0.08)',
                                    bgcolor: HEADER_BG,
                                    fontSize: BA.header, fontWeight: 600,
                                    py: 1.1, px: 1.4,
                                    textAlign: i === 0 ? 'left' : 'right',
                                    // Sticky header so column titles
                                    // stay visible while the body
                                    // scrolls vertically.
                                    position: 'sticky',
                                    top: 0,
                                    zIndex: 2,
                                }}>{h}</Box>
                            ))}
                        </Box>
                    </Box>
                    <Box component="tbody">
                        {rows.map((r, idx) => {
                            const overSpread  = r.status === 'Over Spread';
                            const underSpread = r.status === 'Under Spread';
                            const statusColor = overSpread  ? '#3dd585'
                                              : underSpread ? '#f7768e'
                                              :               'rgba(255,255,255,0.6)';
                            return (
                                <Box component="tr" key={r.pit} sx={{
                                    bgcolor: idx % 2 === 1 ? 'rgba(255,255,255,0.015)' : 'transparent',
                                }}>
                                    <Box component="td" sx={cellSx('left', '#fff', 700)}>{r.pit}</Box>
                                    <Box component="td" sx={cellSx('right', '#fff')}>{fmtH(r.actual)}</Box>
                                    <Box component="td" sx={cellSx('right', 'rgba(255,255,255,0.7)')}>{fmtH(r.spread)}</Box>
                                    <Box component="td" sx={cellSx('right', statusColor, 700)}>
                                        {Number.isFinite(r.variance) ? (
                                            <>
                                                {fmtSignedH(r.variance)}
                                                {r.pct != null && (
                                                    <Box component="span" sx={{
                                                        color: 'rgba(255,255,255,0.45)',
                                                        fontSize: '0.85rem', ml: 0.6, fontWeight: 500,
                                                    }}>
                                                        ({fmtPct(r.pct)})
                                                    </Box>
                                                )}
                                            </>
                                        ) : '-'}
                                    </Box>
                                    <Box component="td" sx={cellSx('right', statusColor, 700)}>
                                        <StatusTag status={r.status} />
                                    </Box>
                                </Box>
                            );
                        })}
                        {/* Total row — bold + accent like the legend. */}
                        {(() => {
                            const tot = rows.reduce(
                                (a, r) => ({
                                    actual:   a.actual   + (Number.isFinite(r.actual)   ? r.actual   : 0),
                                    spread:   a.spread   + (Number.isFinite(r.spread)   ? r.spread   : 0),
                                }),
                                { actual: 0, spread: 0 }
                            );
                            const variance = tot.actual - tot.spread;
                            const pct = tot.spread > 0 ? (variance / tot.spread) * 100 : null;
                            const status =
                                variance >  0.05 ? 'Over Spread'
                              : variance < -0.05 ? 'Under Spread'
                              :                    'On Plan';
                            const color = status === 'Over Spread'  ? '#3dd585'
                                        : status === 'Under Spread' ? '#f7768e'
                                        :                              '#7aa2f7';
                            return (
                                <Box component="tr">
                                    <Box component="td" sx={totalCellSx('left')}>Total</Box>
                                    <Box component="td" sx={totalCellSx('right')}>{fmtH(tot.actual)}</Box>
                                    <Box component="td" sx={totalCellSx('right')}>{fmtH(tot.spread)}</Box>
                                    <Box component="td" sx={{ ...totalCellSx('right'), color }}>
                                        {fmtSignedH(variance)}
                                        {pct != null && (
                                            <Box component="span" sx={{
                                                color: 'rgba(255,255,255,0.45)',
                                                fontSize: '0.85rem', ml: 0.6, fontWeight: 500,
                                            }}>
                                                ({fmtPct(pct)})
                                            </Box>
                                        )}
                                    </Box>
                                    <Box component="td" sx={{ ...totalCellSx('right'), color }}>
                                        <StatusTag status={status} strong />
                                    </Box>
                                </Box>
                            );
                        })()}
                    </Box>
                </Box>
            </Box>
        </Box>
    );
}

// Colored pill for the Status column. Same palette as the inline
// status text it replaces (green = Over, red = Under, neutral = On
// Plan) but with a tinted background + border so the row reads as
// "this is the verdict" at a glance instead of just another text
// cell. `strong` is set for the Total row so the pill stands out
// next to the bold totals.
function StatusTag({ status, strong }) {
    const PALETTE = {
        'Over Spread':  { fg: '#3dd585', bg: 'rgba(61, 213, 133, 0.14)', bd: 'rgba(61, 213, 133, 0.45)' },
        'Under Spread': { fg: '#f7768e', bg: 'rgba(247, 118, 142, 0.14)', bd: 'rgba(247, 118, 142, 0.45)' },
        'On Plan':      { fg: '#7aa2f7', bg: 'rgba(122, 162, 247, 0.14)', bd: 'rgba(122, 162, 247, 0.45)' },
    };
    const p = PALETTE[status] || PALETTE['On Plan'];
    // Display rebrand: "spread" → "scheduled" (the status key stays the
    // same internally; only the pill text changes).
    const DISPLAY = { 'Over Spread': 'Over Scheduled', 'Under Spread': 'Under Scheduled', 'On Plan': 'On Plan' };
    return (
        <Box component="span" sx={{
            display: 'inline-block',
            px: 1.1,
            py: 0.25,
            borderRadius: 999,
            bgcolor: p.bg,
            color: p.fg,
            border: `1px solid ${p.bd}`,
            fontSize: BA.chip,
            fontWeight: strong ? 800 : 700,
            letterSpacing: 0.3,
            lineHeight: 1.4,
            whiteSpace: 'nowrap',
        }}>
            {DISPLAY[status] || status}
        </Box>
    );
}

function cellSx(align, color = '#fff', weight = 400) {
    return {
        color, fontWeight: weight,
        borderBottom: '1px solid rgba(255,255,255,0.05)',
        py: 1.2, px: 1.4, fontSize: BA.body, textAlign: align,
        whiteSpace: 'nowrap',
    };
}
function totalCellSx(align) {
    return {
        color: '#7aa2f7', fontWeight: 700,
        borderBottom: 'none', borderTop: '1px solid rgba(255,255,255,0.12)',
        py: 1.4, px: 1.4, fontSize: BA.body, textAlign: align,
        whiteSpace: 'nowrap',
    };
}
