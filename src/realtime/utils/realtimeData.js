// Real-time Floor dashboard — live feed + legend builder.
// ========================================================
// Shows the SAME daily-avg KPIs as the Performance "Avg" view, but for
// TODAY, accumulating live. The dashboard polls fetchRealtimeData() on an
// adjustable interval; each poll returns "as-of-now" table rows whose
// additive metrics have grown with the fraction of the gaming day elapsed
// (+ small jitter), so the map/legend visibly evolve over the shift.

import { gametypeTableKey, tableMinimumMode } from '../vendor/dataSource';
import {
    legendGroupForSubSegment,
    thresholdsFor, threshold_dict, GAMETYPE_COLORS,
} from '../vendor/heatmapConstants';
import {
    GAMING_DAY_START_HOUR, HOUSE_EDGE_OPTIONS, DEFAULT_HOUSE_EDGE_BET,
    RT_LEGEND_SEGMENTS, RT_KPI_DIMS, RT_PERCENT_KPIS, RT_COUNT_KPIS,
} from '../constants/rtConfig';

const REALTIME_API_URL = process.env.REACT_APP_REALTIME_API_URL || null;

// Additive "production" metrics that scale with elapsed time.
const ADDITIVE = ['drop', 'turnover', 'win', 'theo', 'watm_total', 'patronhrs',
    'openhours', 'open_minutes', 'active_minutes', 'patron_hands',
    'game_count', 'active_game_count', 'free_game_count', 'spread'];

// Nominal "true" house edge per bet option (baccarat main + side bets),
// used only to seed the SYNTHETIC feed below so "Actual House Edge" has
// something to render in mock mode. The real feed (REACT_APP_REALTIME_
// API_URL) is expected to supply these as `house_edge_<key>` columns
// directly from the DB — no mapping needed, they pass straight through
// vendor/dataProcessing.js's accumulate().
const HOUSE_EDGE_BASE = {
    banker: 1.06, player: 1.24, tie: 14.36, btg: 4.0, stg: 4.0,
    sl7: 6.6, bd: 3.0, sd: 3.0, mnm: 2.5, pairplus: 7.0, ppl: 10.36, l6: 13.0,
};

// Per-table typical full-day profile, averaged over the historical daily
// feed. Computed once (module cache).
let _profileCache = null;
function tableProfiles() {
    if (_profileCache) return _profileCache;
    const daily = require('../data/data_cod.json');
    const byTable = new Map();
    for (const r of daily) {
        const k = gametypeTableKey(r.gametype, r.table);
        let e = byTable.get(k);
        if (!e) {
            e = { meta: { area: r.area, pit: r.pit, table: r.table, gametype: r.gametype, sub_segment: r.sub_segment, dow: r.dow, tablemin: r.tablemin }, sums: {}, n: 0 };
            byTable.set(k, e);
        }
        for (const f of ADDITIVE) e.sums[f] = (e.sums[f] || 0) + (Number(r[f]) || 0);
        e.n += 1;
    }
    const profiles = [];
    for (const e of byTable.values()) {
        const avg = {};
        for (const f of ADDITIVE) avg[f] = e.n ? e.sums[f] / e.n : 0;
        profiles.push({ ...e.meta, avg });
    }
    _profileCache = profiles;
    return profiles;
}

// Fraction of the gaming day elapsed [0.02 .. 1].
function elapsedFraction(now = new Date()) {
    const mins = ((now.getHours() - GAMING_DAY_START_HOUR + 24) % 24) * 60 + now.getMinutes() + now.getSeconds() / 60;
    return Math.max(0.02, Math.min(1, mins / (24 * 60)));
}

// Fetch "as of now" rows. Real endpoint (REACT_APP_REALTIME_API_URL) is
// tried first; otherwise a synthetic accumulating snapshot is generated.
export async function fetchRealtimeData({ timeoutMs = 20000 } = {}) {
    if (REALTIME_API_URL) {
        try {
            const ctrl = new AbortController();
            const to = setTimeout(() => ctrl.abort(), timeoutMs);
            const r = await fetch(REALTIME_API_URL, { signal: ctrl.signal });
            clearTimeout(to);
            if (r.ok) {
                const rows = await r.json();
                return { rows, asOf: new Date().toISOString() };
            }
        } catch { /* fall through to synthetic */ }
    }
    const now = new Date();
    const frac = elapsedFraction(now);
    const today = now.toISOString().slice(0, 10);
    const rows = tableProfiles().map((p) => {
        // Jitter is re-rolled every poll → the snapshot visibly changes.
        const jitter = 0.88 + Math.random() * 0.24;
        const row = {
            date: today, area: p.area, pit: p.pit, table: p.table, gametype: p.gametype,
            sub_segment: p.sub_segment, dow: p.dow, weekstart: today,
            tablemin: p.tablemin,
            // A live table is either open (counts toward today) or dark.
            openday: 1, floorday: 1,
        };
        // Some tables are still closed early in the day → 0 production.
        const openProb = Math.min(1, 0.35 + frac);
        const isOpen = Math.random() < openProb;
        for (const f of ADDITIVE) {
            row[f] = isOpen ? (p.avg[f] || 0) * frac * jitter : 0;
        }
        if (!isOpen) { row.openday = 0; row.openhours = 0; }

        // Synthetic house edge (baccarat/NC only — that's where these
        // bet options apply) + shoe metadata, so "Actual House Edge"
        // has data to show in mock mode. Small per-poll drift simulates
        // the true edge moving as the shoe's card composition depletes.
        const isBaccarat = p.gametype === 'BA' || p.gametype === 'NC';
        if (isBaccarat && isOpen) {
            row.shoe_id = `${today}-${p.table}-${1 + Math.floor(frac * 8)}`;
            row.last_hand_dealt_time = new Date(now.getTime() - Math.floor(Math.random() * 300000)).toISOString();
            for (const [key, base] of Object.entries(HOUSE_EDGE_BASE)) {
                row['house_edge_' + key] = +(base * (0.85 + Math.random() * 0.3)).toFixed(2);
            }
        }
        return row;
    });
    return { rows, asOf: now.toISOString() };
}

export function isMockRealtimeFeed() { return !REALTIME_API_URL; }

// Slicer options from the profile set (static — the floor roster).
export function realtimeOptions() {
    const S = { areas: new Set(), pits: new Set(), games: new Set(), dows: new Set(), tableMins: new Set() };
    for (const p of tableProfiles()) {
        S.areas.add(p.area); S.pits.add(String(p.pit)); S.games.add(p.gametype); S.dows.add(p.dow);
        const m = tableMinimumMode(p.tablemin);
        if (m > 0) S.tableMins.add(String(m));
    }
    return {
        areas: [...S.areas].sort(),
        pits: [...S.pits].sort((a, b) => Number(a) - Number(b)),
        games: [...S.games].sort(),
        dows: [...S.dows].sort(),
        tableMins: [...S.tableMins].sort((a, b) => Number(a) - Number(b)),
    };
}

export function filterRealtimeRows(rows, f) {
    const has = (arr, v) => !arr || arr.length === 0 || arr.includes(v);
    const tableMinOk = (r) => {
        if (!f.tableMins || f.tableMins.length === 0) return true;
        const m = tableMinimumMode(r.tablemin);
        return m > 0 && f.tableMins.includes(String(m));
    };
    return rows.filter((r) =>
        has(f.areas, r.area) && has(f.pits, String(r.pit)) && has(f.games, r.gametype) &&
        has(f.dows, r.dow) && tableMinOk(r));
}

// ── Avg-view legend builder ─────────────────────────────────────────
// Faithful port of the Performance dashboard's Avg legend path: columns
// (sub-segments), per-threshold bucket counts, and the overall-average
// row (ratio sum-then-divide, with the dim-average fallback). Only the
// Avg branch is needed here — realtime has no 24-hr / brush selection.

// Single source of truth now lives in rtConfig — keeping a second copy
// here was how the Performance dashboard ended up with three hand-synced
// dim maps that drift apart whenever a KPI is added.
const KPI_DIM = RT_KPI_DIMS;

// How the legend's trailing "Overall Avg" row is computed per KPI.
// Ratios are summed-then-divided (not averaged per table), so a segment
// with one huge table and nine small ones reads correctly.
//
// `numFn` handles KPIs that are a difference rather than a raw column —
// variance has no single field to sum.
const KPI_RATIO = {
    'Win (Total)': { num: 'win', den: 'floorday' },
    'Theo (Total)': { num: 'theo', den: 'floorday' },
    'Turnover (Total)': { num: 'turnover', den: 'floorday' },
    'Variance': { numFn: (d) => (Number(d.win) || 0) - (Number(d.theo) || 0), den: 'floorday' },
    'Hold %': { num: 'win', den: 'turnover', scale: 100 },
    'Avgbet': { num: 'turnover', den: 'patron_hands' },
    'Shoe Win': { num: 'shoe_win', den: 'floorday' },
    'Shoe Theo': { num: 'shoe_theo', den: 'floorday' },
    'Shoe Variance': { numFn: (d) => (Number(d.shoe_win) || 0) - (Number(d.shoe_theo) || 0), den: 'floorday' },
    'Shoe Turnover': { num: 'shoe_turnover', den: 'floorday' },
    'Shoe Hands': { num: 'shoe_hands_dealt', den: 'floorday' },
    'Avg Headcount (10m)': { num: 'avg_headcount_10m', den: 'floorday' },
    'Hands Today': { num: 'hands', den: 'floorday' },
};

// Resolves the scatter dim for "Actual House Edge", which — unlike
// every other KPI — depends on the Bet Option sub-dropdown (Banker /
// Player / ... / Lowest). See rtConfig.js HOUSE_EDGE_OPTIONS and the
// matching tuple slots in vendor/dataProcessing.js.
function houseEdgeDim(selectedBetOption) {
    const opt = HOUSE_EDGE_OPTIONS.find((o) => o.label === selectedBetOption);
    return (opt || HOUSE_EDGE_OPTIONS.find((o) => o.label === DEFAULT_HOUSE_EDGE_BET)).dim;
}

export function buildAvgLegend(scatterData, activeData, selectedKPI, selectedArea, selectedBetOption) {
    if (!scatterData || scatterData.length === 0) return { columns: [], dataRows: [], overallAverages: {} };

    // Legend columns come STRICTLY from RT_LEGEND_SEGMENTS (rtConfig.js) —
    // its order is the column order, and a segment only appears if it's
    // listed there, even if other sub_segments exist in the live data.
    const columns = RT_LEGEND_SEGMENTS;
    const out = { columns, dataRows: [], overallAverages: {} };

    const scatterArea = (s) => legendGroupForSubSegment(s[35]);
    const recordArea = (d) => legendGroupForSubSegment(d.sub_segment);
    const isHouseEdge = selectedKPI === 'Actual House Edge';

    if (selectedKPI === 'Gametype') {
        const games = [...new Set(scatterData.map((s) => s[3]))].filter(Boolean).sort();
        out.dataRows = games.map((gt) => {
            const row = { key: gt, color: GAMETYPE_COLORS[gt] || 'rgba(150,150,150,0.8)' };
            const tables = new Set();
            columns.forEach((ca) => {
                const m = scatterData.filter((s) => s[3] === gt && scatterArea(s) === ca);
                row[ca] = m.length;
                for (const x of m) tables.add(String(x[16] || '').trim().toUpperCase());
            });
            row._tables = tables;
            return row;
        });
    } else {
        const thresholds = isHouseEdge
            ? threshold_dict['Actual House Edge']
            : (thresholdsFor(selectedKPI, selectedArea) || threshold_dict[selectedKPI] || null);
        const dim = isHouseEdge ? houseEdgeDim(selectedBetOption) : KPI_DIM[selectedKPI];
        if (thresholds && dim !== undefined) {
            out.dataRows = thresholds.map((t) => {
                const row = { key: t.label, color: t.color };
                const tables = new Set();
                columns.forEach((ca) => {
                    const m = scatterData.filter((s) => {
                        if (scatterArea(s) !== ca) return false;
                        const val = s[dim];
                        if (val === -1000000 || val === -999999) return false;
                        return (t.gte === undefined || val >= t.gte) && (t.lt === undefined || val < t.lt);
                    });
                    row[ca] = m.length;
                    for (const x of m) tables.add(String(x[16] || '').trim().toUpperCase());
                });
                row._tables = tables;
                return row;
            });
        }
    }

    // Overall-average row.
    const ratio = KPI_RATIO[selectedKPI];
    columns.forEach((ca) => {
        const rowsIn = activeData.filter((d) => recordArea(d) === ca);
        if (rowsIn.length === 0) { out.overallAverages[ca] = 0; return; }
        if (isHouseEdge) {
            const dim = houseEdgeDim(selectedBetOption);
            const vals = scatterData.filter((s) => scatterArea(s) === ca).map((s) => s[dim]).filter((v) => typeof v === 'number' && v > -1000000);
            out.overallAverages[ca] = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
        } else if (ratio) {
            const num = rowsIn.reduce(
                (a, d) => a + (ratio.numFn ? ratio.numFn(d) : (Number(d[ratio.num]) || 0)), 0);
            // The contract replaced floorday with is_open; treat a missing
            // floorday as 1 so these ratios keep resolving to per-table
            // averages rather than dividing by zero.
            const den = rowsIn.reduce(
                (a, d) => a + (ratio.den === 'floorday'
                    ? (d.floorday != null ? Number(d.floorday) || 0 : 1)
                    : (Number(d[ratio.den]) || 0)), 0);
            out.overallAverages[ca] = (den > 0 ? num / den : 0) * (ratio.scale ?? 1);
        } else if (selectedKPI === 'Gametype' || selectedKPI === 'Table minimum') {
            out.overallAverages[ca] = scatterData.filter((s) => {
                if (scatterArea(s) !== ca) return false;
                const val = s[selectedKPI === 'Gametype' ? 3 : 14];
                return selectedKPI === 'Gametype' ? (val !== undefined && val !== '' && val !== null) : (val !== undefined && val > -1000000);
            }).length;
        } else if (dimForKpi(selectedKPI) != null) {
            const d = dimForKpi(selectedKPI);
            const vals = scatterData.filter((s) => scatterArea(s) === ca).map((s) => s[d]).filter((v) => typeof v === 'number' && v > -1000000);
            out.overallAverages[ca] = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
        } else {
            out.overallAverages[ca] = 0;
        }
    });
    return out;
}

function dimForKpi(kpi) { return KPI_DIM[kpi]; }

// Value formatter for the legend Overall-Avg row (mirrors the perf one).
const MINUTES = new Set(['Idle Minutes', 'Shoe Duration']);
export function formatKpiValueFor(selectedKPI) {
    return (val) => {
        if (val == null || !Number.isFinite(val)) return '-';
        if (selectedKPI === 'Actual House Edge') return `${val.toFixed(2)}%`;
        if (RT_PERCENT_KPIS.has(selectedKPI)) return `${val.toFixed(1)}%`;
        if (RT_COUNT_KPIS.has(selectedKPI)) return val.toLocaleString(undefined, { maximumFractionDigits: 0 });
        if (MINUTES.has(selectedKPI)) return `${val.toFixed(0)}m`;
        if (selectedKPI === 'Avg Headcount (10m)') return val.toFixed(1);
        if (selectedKPI === 'Shoe Hands' || selectedKPI === 'Hands Today') return val.toLocaleString(undefined, { maximumFractionDigits: 0 });
        // Money. Keep the sign — on the surveillance KPIs a negative is
        // the entire point, and stripping it would invert the meaning.
        const a = Math.abs(val);
        if (a >= 10000) return `${(val / 1000).toFixed(0)}k`;
        if (a >= 1000) return `${(val / 1000).toFixed(1)}k`;
        return val.toLocaleString(undefined, { maximumFractionDigits: 0 });
    };
}
