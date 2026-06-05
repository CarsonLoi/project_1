import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  Box,
  Paper,
  ListItem,
  ListItemText,
  Divider,
  Stack,
  Button,
} from '@mui/material';
import EventBusyIcon from '@mui/icons-material/EventBusy';
import RefreshIcon from '@mui/icons-material/Refresh';
import CircularProgress from '@mui/material/CircularProgress';

import ScatterHeatmapAvg from './components/ScatterHeatmapAvg';
import ScatterHeatmapPlay from './components/ScatterHeatmapPlay';
import DropdownSelector from './components/DropdownSelector';
import SelectorDate from './components/SelectorDate';
import PerformanceLegend from './components/PerformanceLegend';
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
  GAMETYPE_COLORS,
  LEGEND_GROUPS,
  legendGroupForPit,
} from '../shared/constants/heatmapConstants';

import config_data from '../shared/data/config_cod.json';
import { fetchDailyData, fetchHourlyData, gametypeTableKey } from './utils/dataSource';

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
  const scatterCardRef = useRef(null);
  const [scatterCardHeight, setScatterCardHeight] = useState(null);
  useEffect(() => {
    const el = scatterCardRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) {
        const h = e.contentRect.height;
        if (h > 0) setScatterCardHeight(h);
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
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
    setLoading(false);
  }, [daily_data]);

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

  const { baseScatterData, hourList, baseActiveData } = useMemo(() => {
    if (!startDate || !endDate)
      return { baseScatterData: [], hourList: [], baseActiveData: [] };

    // Active TG tables whose validity window covers the picker's end-date.
    const filteredConfig = config_data.filter(
      (c) =>
        c.Group === 'TG' &&
        c.is_Active === 1 &&
        c.startdate <= endDate &&
        c.enddate >= endDate
    );
    const finalGames = selectedGame.length > 0 ? selectedGame : availableGames;
    let scatter = [];
    let hList = [];
    let activeDataForRatios = [];

    if (selectedSwitcher === 'Avg') {
      const filteredDaily = daily_data.filter((d) => {
        const dateMatch = d.date >= startDate && d.date <= endDate && !excludedDateSet.has(d.date);
        const areaMatch = selectedArea.length === 0 || selectedArea.includes(d.area);
        const pitMatch = selectedPit.length === 0 || selectedPit.includes(String(d.pit));
        const gameMatch = selectedGame.length === 0 || selectedGame.includes(d.gametype);
        const dowMatch = selectedDow.length === 0 || selectedDow.includes(d.dow);
        return dateMatch && areaMatch && pitMatch && gameMatch && dowMatch;
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
        return dateMatch && areaMatch && pitMatch && gameMatch && dowMatch;
      });
      activeDataForRatios = filteredHourly;
      if (hourlyMode === 'Aggregate') {
        scatter = buildAggregatedHourlyScatterData(
          filteredHourly,
          filteredConfig,
          finalGames,
          selectedHours
        );
      } else {
        scatter = buildHourlyScatterData(
          filteredHourly,
          filteredConfig,
          selectedPit,
          finalGames,
          selectedDow,
          hList,
          startDate,
          endDate
        );
      }
    }

    return { baseScatterData: scatter, hourList: hList, baseActiveData: activeDataForRatios };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    startDate,
    endDate,
    excludedDateSet,
    selectedArea,
    selectedPit,
    selectedGame,
    selectedDow,
    selectedSwitcher,
    showType,
    availableGames,
    selectedKPI,
    hourlyMode,
    selectedHours,
  ]);

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
      if (!(dateMatch && areaMatch && pitMatch && gameMatch && dowMatch)) return false;
      if (!tableSet) return true;
      // Brush selection can use a table label, "PIT n", or "ZONE n"
      // pattern — match any of them against this hourly row.
      const tableId = String(d.gametype + d.table).trim().toUpperCase();
      const pitId = ('PIT ' + d.pit).trim().toUpperCase();
      // hourly_data doesn't carry zone today; only table/pit checks.
      return tableSet.has(tableId) || tableSet.has(pitId);
    });
  }, [hourly_data, startDate, endDate, excludedDateSet, selectedArea, selectedPit, selectedGame, selectedDow, selectedTables]);

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

    const customAreas = LEGEND_GROUPS;
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

    // Legend grouping is pit-based: most rows fall into "MS", but specific
    // pits (805, 871/872, 882/888, 881/889, 883, 885) get their own
    // column. Scatter rows carry pit at index 32 and area at index 34;
    // raw data records carry them as `pit` and `area`.
    const scatterArea = (s) => legendGroupForPit(s[32], s[34]);
    const recordArea = (d) => legendGroupForPit(d.pit, d.area);

    if (filteredScatterData.length > 0) {
      let thresholds = null;
      let kpiIdx = null;

      const kpiIdxMapAvg = {
        'Drop per open day': 7, 'Win per open day': 8, 'Patron hours per open day': 9,
        'Daily open hours': 10, 'Drop per open hour': 11, 'Win per open hour': 12,
        'Patron hours per open hour': 13, 'Table minimum': 14, 'Avgbet': 15,
        'Drop per floor day': 17, 'Win per floor day': 18, 'Patron hours per floor day': 19,
        'Theo per floor day': 22, 'Theo per open day': 23, 'Theo per open hour': 24,
        'Hands per hour': 26, 'Wagered hands per hour': 27, 'Free hands per hour': 28,
        'Unused Tables': 29, 'Open Percentage': 30,
        'Active % (Min by Min)': 20,
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
        thresholds = threshold_dict[selectedKPI] || null;
        kpiIdx = kpiIdxMapAvg[selectedKPI];
      } else if (selectedSwitcher === '24-hr') {
        const tKey = hourlyThresholdKeys[selectedKPI];
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
          customAreas.forEach((ca) => {
            const count = filteredScatterData.filter((s) => {
              return s[3] === gt && scatterArea(s) === ca;
            }).length;
            row[ca] = count;
          });
          return row;
        });
      } else if (thresholds && kpiIdx !== undefined) {
        legend.dataRows = thresholds.map((t) => {
          const row = { key: t.label, color: t.color };
          customAreas.forEach((ca) => {
            const count = filteredScatterData.filter((s) => {
              if (scatterArea(s) !== ca) return false;
              let val = s[kpiIdx];
              if (val === -1000000 || val === -999999) return false;
              if (Array.isArray(val)) {
                val = val[currentHourIdx];
                if (val === undefined || val <= -1000000) return false;
              }
              return (t.gte === undefined || val >= t.gte) && (t.lt === undefined || val < t.lt);
            }).length;
            row[ca] = count;
          });
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
        'Open Percentage': { num: 'openday', den: 'floorday' },
        // Active %-by-min uses the minute fields directly; the legend's
        // overall-avg row applies the ×100 scaling via the same
        // sum-then-divide pattern (the result is a 0..1 ratio that the
        // formatter renders as a percentage cell).
        'Active % (Min by Min)': { num: 'active_minutes', den: 'open_minutes' },
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
        } else if (ratio) {
          const totalNum = customDataForHour.reduce(
            (acc, d) => acc + (parseFloat(d[ratio.num]) || 0),
            0
          );
          const totalDen = customDataForHour.reduce(
            (acc, d) => acc + (parseFloat(d[ratio.den]) || 0),
            0
          );
          legend.overallAverages[ca] = totalDen > 0 ? totalNum / totalDen : 0;
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
    activeDataForRatios,
    hourList,
    selectedTables,
  ]);

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
                  <ListItemText
                    sx={{ my: 0, flex: 'none' }}
                    primary={'CoD TG Performance Heatmap'}
                    primaryTypographyProps={{
                      fontSize: 23,
                      fontWeight: 400,
                      letterSpacing: 0,
                      pt: '2px',
                      color: 'rgba(180,180,180,0.8)',
                    }}
                  />

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
                  {selectedSwitcher === 'Avg' && (
                    <DropdownSelector
                      label="DoW"
                      availableOptions={availableDows}
                      selectedOptions={selectedDow}
                      setSelectedOptions={setSelectedDow}
                    />
                  )}
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
                        label="Reference"
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
                        fontSize: 18,
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
                        fontSize: 18,
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
                          title={`${selectedKPI} (Avg)`}
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
                          title={`${selectedKPI} (Aggregated Hours)`}
                          visualMapSelected={visualMapSelected}
                          onVisualMapSelect={setVisualMapSelected}
                          onBrushSelected={handleBrushSelected}
                          // Use HOURLY KPI layout (Patron Hours / Open
                          // Hours status / Table Min / etc.) so the
                          // hourly KPI dropdown drives both Timeline
                          // and Aggregate consistently.
                          kpiConfigMap={HOURLY_KPI_CONFIG_MAP}
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
                      // Match the scatter card height (measured via
                      // ResizeObserver) so the two cards' bottoms align.
                      // Fall back to 'auto' before the first measurement.
                      height: scatterCardHeight ? `${scatterCardHeight}px` : 'auto',
                      // Column layout; the PerformanceLegend inside fills
                      // 100% height and owns its own internal scroll, so
                      // the panel itself clips rather than double-scrolls.
                      display: 'flex',
                      flexDirection: 'column',
                      overflow: 'hidden',
                      boxSizing: 'border-box',
                    }}
                  >
                    <PerformanceLegend
                      title="Performance Summary"
                      columns={legendData.columns}
                      dataRows={legendData.dataRows}
                      overallAverages={legendData.overallAverages}
                    />
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
                          title={`Reference Heatmap - ${showReference}`}
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
