// Hotel Segment Heatmap — data source + aggregation.
// =====================================================
// FULLY SELF-CONTAINED: every import below resolves inside src/hotel
// (vendored components + data + hotelConfig.js). Nothing here depends on
// the Performance / Pricing / Live / Realtime dashboards.
//
// Grain of the feed: date × table × player_id, EXCEPT a table that had no
// visitors on a given date (or never opened) still emits exactly one row
// for that (date,table) so the table-day facts aren't lost — see the
// header comment in hotelConfig.js for the full row shape and the
// floorday/openday/openhours dedup rules. `hasPlay` (set in
// enrichHotelRows below) is the field that separates "table-day fact"
// aggregation (every row) from "patron fact" aggregation (hasPlay rows
// only) throughout this file.

import { gametype_svg_path } from '../vendor/heatmapConstants';
import config_data from '../data/config_cod.json';
import {
    AGE_BIN_EDGES, AGE_BAND_LABELS,
    KPI_DIM_MAP, NO_DATA_SENTINELS, PANELS,
} from '../constants/hotelConfig';

const HOTEL_API_URL = process.env.REACT_APP_HOTEL_API_URL || null;
export function isMockHotelFeed() { return !HOTEL_API_URL; }

// Numeric fields coerced after fetch — a real endpoint might send
// strings/nulls (including legitimate nulls on no-play rows, which Number()
// coerces to 0 — the correct value for those rows' patron facts), and the
// mock is already numeric but this keeps both paths defensively consistent.
const NUMERIC_FIELDS = [
    'age', 'floorday', 'openday', 'openhours', 'table_min',
    'turnover', 'theo_win', 'casino_win', 'patron_hands', 'secondsplayed',
    ...PANELS.filter((p) => p.flag).map((p) => p.flag),
];

export async function fetchHotelData({ timeoutMs = 60000 } = {}) {
    let rows = null;
    if (HOTEL_API_URL) {
        try {
            const ctrl = new AbortController();
            const to = setTimeout(() => ctrl.abort(), timeoutMs);
            const r = await fetch(HOTEL_API_URL, { signal: ctrl.signal });
            clearTimeout(to);
            if (r.ok) rows = await r.json();
        } catch { /* fall through to mock */ }
    }
    if (!rows) rows = generateMockHotelRows();
    for (const row of rows) {
        for (const f of NUMERIC_FIELDS) {
            const v = row[f];
            if (typeof v !== 'number') row[f] = Number(v) || 0;
        }
    }
    // Join area/zone in from the floor layout config + derive ageBand/
    // hasPlay — see enrichHotelRows() below. Folded in here so every
    // caller gets ready-to-filter rows without an extra explicit step.
    return enrichHotelRows(rows, config_data);
}

// ── Age binning ───────────────────────────────────────────────────────
// Buckets a raw numeric age into one of AGE_BAND_LABELS using
// AGE_BIN_EDGES (both in hotelConfig.js — edit the parameters there,
// not this function, to change bin width/count). `age` is null on
// no-play placeholder rows, so null/empty must short-circuit BEFORE the
// Number() coercion — Number(null) is 0, which is a valid finite number
// and would otherwise wrongly bucket a no-play row into the youngest band.
export function bucketAge(age) {
    if (age == null || age === '') return '';
    const n = Number(age);
    if (!Number.isFinite(n)) return '';
    for (let i = AGE_BIN_EDGES.length - 1; i >= 0; i--) {
        if (n >= AGE_BIN_EDGES[i]) return AGE_BAND_LABELS[i];
    }
    return AGE_BAND_LABELS[0];
}

// ── Enrichment ───────────────────────────────────────────────────────
// The raw feed already carries `pit`/`game`/`dow` directly (dow is
// pre-bucketed to WD/Fri/Sat/Sun upstream) — only `area`/`zone` need a
// table-id join against config_cod.json, the floor layout config every
// other dashboard already uses. Also derives `ageBand` from the raw
// `age` and `hasPlay` from `id`. Mutates rows in place (called once per
// fetch, on a fresh array — no aliasing risk) so every downstream
// filter/aggregate reads plain enriched fields.
export function enrichHotelRows(rows, configData) {
    const cfgByTable = new Map();
    for (const cfg of configData) cfgByTable.set(String(cfg.table), cfg);
    for (const r of rows) {
        const cfg = cfgByTable.get(String(r.table));
        r.area = cfg ? cfg.Location : '';
        r.zone = cfg ? cfg.zone : '';
        r.pit = r.pit != null ? String(r.pit) : '';
        r.ageBand = bucketAge(r.age);
        r.hasPlay = r.id != null && r.id !== '';
    }
    return rows;
}

// Apply every control-panel + drawer slicer in one pass (NOT the
// per-panel hotel-segment flag — HotelDashboard applies that separately
// per panel via PANELS[i].flag, since a row can only belong to one
// panel's flag at a time but every panel shares this filtered base).
// Every patron-attribute filter below (regions/cardTiers/ageBands/sexes/
// segments/subSegments) is null on no-play rows, so has(arr, null) — which
// is only false once the user actively picks specific values — correctly
// drops no-play rows out of the result whenever a patron filter is active,
// same behavior already established for regions/cardTiers/ageBands.
export function filterHotelRows(rows, f) {
    const {
        startDate, endDate, excludedDates,
        areas, pits, games, dows,
        regions, cardTiers, ageBands, sexes, segments, subSegments,
    } = f;
    const excl = excludedDates instanceof Set ? excludedDates : new Set(excludedDates || []);
    const has = (arr, v) => !arr || arr.length === 0 || arr.includes(v);
    return rows.filter((r) =>
        r.date >= startDate && r.date <= endDate && !excl.has(r.date) &&
        has(areas, r.area) && has(pits, r.pit) && has(games, r.game) && has(dows, r.dow) &&
        has(regions, r.region) && has(cardTiers, r.card) && has(ageBands, r.ageBand) &&
        has(sexes, r.sex) && has(segments, r.segment) && has(subSegments, r.sub_segment)
    );
}

// Canonical display order for the pre-bucketed dow values.
const DOW_ORDER = ['WD', 'Fri', 'Sat', 'Sun'];

// Distinct option lists. Area/Pit/Game come from the floor layout config
// (stable regardless of which dates/players are in the filtered rows);
// DOW/Region/Card Tier/Sex/Segment/Sub-segment are derived from whatever
// values are actually present in the feed — Card in particular is an
// opaque tier code (or 'Other') with no fixed vocabulary to hardcode.
// Patron-attribute options only look at hasPlay rows — no-play rows carry
// no patron attributes (all null) and would otherwise pollute the list.
export function deriveOptions(rows, configData) {
    const S = {
        areas: new Set(), pits: new Set(), games: new Set(), dows: new Set(),
        regions: new Set(), cardTiers: new Set(), sexes: new Set(),
        segments: new Set(), subSegments: new Set(),
    };
    for (const cfg of (configData || [])) {
        if (cfg.Location) S.areas.add(cfg.Location);
        if (cfg.pit != null && cfg.pit !== '') S.pits.add(String(cfg.pit));
        if (cfg.game) S.games.add(cfg.game);
    }
    for (const r of rows) {
        if (r.dow) S.dows.add(r.dow);
        if (!r.hasPlay) continue;
        if (r.region) S.regions.add(r.region);
        if (r.card) S.cardTiers.add(r.card);
        if (r.sex) S.sexes.add(r.sex);
        if (r.segment) S.segments.add(r.segment);
        if (r.sub_segment) S.subSegments.add(r.sub_segment);
    }
    return {
        areas: [...S.areas].sort(),
        pits: [...S.pits].sort((a, b) => Number(a) - Number(b)),
        games: [...S.games].sort(),
        dows: [...S.dows].sort((a, b) => DOW_ORDER.indexOf(a) - DOW_ORDER.indexOf(b)),
        regions: [...S.regions].sort(),
        cardTiers: [...S.cardTiers].sort(),
        sexes: [...S.sexes].sort(),
        segments: [...S.segments].sort(),
        subSegments: [...S.subSegments].sort(),
    };
}

// ── Scatter aggregation ─────────────────────────────────────────────
// Folds patron-grain rows up to one bucket per table (or per pit/zone
// for the other Group By modes). Two families of fact, deduped
// differently (see hotelConfig.js header comment for the full rationale):
//   floorday/openday = COUNT(DISTINCT table||'-'||date), counted off
//                       EVERY row (table-day facts, present even on
//                       no-play placeholder rows)
//   openHours         = per (table,date) AVERAGE first (collapses the
//                        per-row duplication), then SUMMED across
//                        distinct (table,date) keys
//   playday/turnover/theo_win/casino_win/patron_hands/secondsplayed =
//                        patron facts, counted off hasPlay rows only
function foldBucket(map, key, extraFields) {
    let b = map.get(key);
    if (!b) {
        b = {
            floorDaySet: new Set(), openDaySet: new Set(), playDaySet: new Set(),
            openHoursByKey: new Map(),
            turnover: 0, theo_win: 0, casino_win: 0, patron_hands: 0, secondsplayed: 0,
            ...extraFields,
        };
        map.set(key, b);
    }
    return b;
}

function accumulateRow(b, row, tableDateKey, playerDateKey) {
    if (row.floorday) b.floorDaySet.add(tableDateKey);
    if (row.openday) b.openDaySet.add(tableDateKey);
    if (row.openhours != null) {
        let e = b.openHoursByKey.get(tableDateKey);
        if (!e) { e = { sum: 0, count: 0 }; b.openHoursByKey.set(tableDateKey, e); }
        e.sum += Number(row.openhours) || 0;
        e.count += 1;
    }
    if (row.hasPlay) {
        b.playDaySet.add(playerDateKey);
        b.turnover += row.turnover || 0;
        b.theo_win += row.theo_win || 0;
        b.casino_win += row.casino_win || 0;
        b.patron_hands += row.patron_hands || 0;
        b.secondsplayed += row.secondsplayed || 0;
    }
}

function computeKpis(b) {
    const floorday = b.floorDaySet.size;
    const playday = b.playDaySet.size;
    let openHoursTotal = 0;
    for (const e of b.openHoursByKey.values()) openHoursTotal += (e.count > 0 ? e.sum / e.count : 0);

    const perFloorday = (num) => (floorday > 0 ? num / floorday : -999999);
    const perOpenHour = (num) => (openHoursTotal > 0 ? num / openHoursTotal : -999999);
    const perPatronDay = (num) => (playday > 0 ? num / playday : -999999);
    const minutesPlayed = b.secondsplayed / 60;

    return {
        theo_win_per_floorday: perFloorday(b.theo_win),
        casino_win_per_floorday: perFloorday(b.casino_win),
        turnover_per_floorday: perFloorday(b.turnover),
        patron_hands_per_floorday: perFloorday(b.patron_hands),
        minutes_per_floorday: perFloorday(minutesPlayed),
        theo_win_per_open_hour: perOpenHour(b.theo_win),
        casino_win_per_open_hour: perOpenHour(b.casino_win),
        turnover_per_open_hour: perOpenHour(b.turnover),
        theo_win_per_patron_day: perPatronDay(b.theo_win),
        casino_win_per_patron_day: perPatronDay(b.casino_win),
        turnover_per_patron_day: perPatronDay(b.turnover),
        minutes_per_patron_day: perPatronDay(minutesPlayed),
        avg_bet: b.patron_hands > 0 ? b.turnover / b.patron_hands : -999999,
        theo_hold_pct: b.turnover > 0 ? (b.theo_win / b.turnover) * 100 : -999999,
        actual_hold_pct: b.turnover > 0 ? (b.casino_win / b.turnover) * 100 : -999999,
        floorday, playday, openHoursTotal,
    };
}

const EMPTY_KPIS = {
    theo_win_per_floorday: -1000000, casino_win_per_floorday: -1000000, turnover_per_floorday: -1000000,
    patron_hands_per_floorday: -1000000, minutes_per_floorday: -1000000,
    theo_win_per_open_hour: -1000000, casino_win_per_open_hour: -1000000, turnover_per_open_hour: -1000000,
    theo_win_per_patron_day: -1000000, casino_win_per_patron_day: -1000000,
    turnover_per_patron_day: -1000000, minutes_per_patron_day: -1000000,
    avg_bet: -1000000, theo_hold_pct: -1000000, actual_hold_pct: -1000000,
};

// Public entry point — one scatter tuple per ACTIVE config table (same
// "always emit every table, grey out the ones with no data" contract as
// the Performance pipeline). `showType` picks whether the color-driving
// KPI is computed at Table/Pit/Zone grain; the DOT positions are always
// per-table (Pit/Zone just paint every table in that pit/zone the same
// color, exactly like the original Avg view). Pit grouping uses the raw
// feed's `row.pit` directly; Zone still requires the config join (zone
// isn't in the raw schema).
//
// Tuple layout (dims consumed by HtScatterHeatmapAvg + this dashboard's
// own kpiConfigMap — see hotelConfig.js KPI_DIM_MAP):
//   0 x, 1 y, 2 rotation, 3 game, 4 symbolPath, 5 sizeX, 6 sizeY,
//   7-21 the 15 KPIs (order matches HOTEL_KPI_OPTIONS / KPI_DIM_MAP),
//   22 tableID, 23 pit, 24 zone, 25 area (metadata only)
export function buildHotelScatterData(filteredRows, configData, showType) {
    const byTable = new Map();
    const byPit = new Map();
    const byZone = new Map();

    for (const row of filteredRows) {
        const tableKey = String(row.table);
        const tdKey = `${tableKey}-${row.date}`;
        const pdKey = `${row.id}-${row.date}`;

        accumulateRow(foldBucket(byTable, tableKey, { table: tableKey }), row, tdKey, pdKey);
        if (row.pit) accumulateRow(foldBucket(byPit, row.pit, { pit: row.pit }), row, tdKey, pdKey);
        if (row.zone) accumulateRow(foldBucket(byZone, row.zone, { zone: row.zone }), row, tdKey, pdKey);
    }

    const scatterData = [];
    for (const cfg of configData) {
        const tableID = String(cfg.table);
        const svgDef = gametype_svg_path[cfg.game];
        if (!svgDef || cfg.x === undefined || cfg.y === undefined || cfg.rotation === undefined) continue;

        let kpis = EMPTY_KPIS;
        if (showType === 'Table' && byTable.has(tableID)) {
            kpis = computeKpis(byTable.get(tableID));
        } else if (showType === 'Pit' && cfg.pit && byPit.has(String(cfg.pit))) {
            kpis = computeKpis(byPit.get(String(cfg.pit)));
        } else if (showType === 'Zone' && cfg.zone && byZone.has(cfg.zone)) {
            kpis = computeKpis(byZone.get(cfg.zone));
        }

        scatterData.push([
            cfg.x, cfg.y, cfg.rotation, cfg.game, 'path://' + svgDef.path, svgDef.size_X, svgDef.size_Y, // 0..6
            kpis.theo_win_per_floorday, kpis.casino_win_per_floorday, kpis.turnover_per_floorday,         // 7..9
            kpis.patron_hands_per_floorday, kpis.minutes_per_floorday,                                    // 10..11
            kpis.theo_win_per_open_hour, kpis.casino_win_per_open_hour, kpis.turnover_per_open_hour,      // 12..14
            kpis.theo_win_per_patron_day, kpis.casino_win_per_patron_day,                                 // 15..16
            kpis.turnover_per_patron_day, kpis.minutes_per_patron_day,                                    // 17..18
            kpis.avg_bet, kpis.theo_hold_pct, kpis.actual_hold_pct,                                       // 19..21
            tableID, cfg.pit || '', cfg.zone || '', cfg.Location || '',                                   // 22..25
        ]);
    }
    return scatterData;
}

// Per-panel headline: average of the active KPI across the panel's
// tables (skipping no-data sentinels), plus the count of tables with
// data. Feeds the chip in each panel header.
export function panelKpiSummary(scatterData, selectedKPI) {
    const dim = KPI_DIM_MAP[selectedKPI];
    if (dim == null || !scatterData || scatterData.length === 0) return { avg: null, tables: 0 };
    let sum = 0, n = 0;
    for (const tuple of scatterData) {
        const v = tuple[dim];
        if (typeof v !== 'number' || NO_DATA_SENTINELS.has(v)) continue;
        sum += v; n += 1;
    }
    return { avg: n ? sum / n : null, tables: n };
}

// ── Synthetic feed (mock mode) ──────────────────────────────────────
// Generates rows at the SAME grain the real API returns, including the
// floorday/openday/openhours duplication across players at a table-date
// AND the no-play placeholder row (id null, patron fields null, every
// is_* flag 0) for tables that never opened or had zero visitors a given
// day — so the dedup-aware / hasPlay-gated aggregation above is exercised
// honestly in local/dev use, not just against a "clean" fixture.
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function sampleWithoutReplacement(arr, n) {
    const pool = [...arr];
    const out = [];
    const count = Math.min(n, pool.length);
    for (let i = 0; i < count; i++) {
        const idx = Math.floor(Math.random() * pool.length);
        out.push(pool.splice(idx, 1)[0]);
    }
    return out;
}

const MOCK_DATE_COUNT = 14;
const MOCK_PLAYER_COUNT = 260;
const MOCK_TABLE_MINS = [500, 800, 1000, 1500, 2000, 3000, 5000, 10000];
const MOCK_REGIONS = ['HK', 'Macau', 'China', 'SE Asia', 'Other'];
const MOCK_CARD_TIERS = ['0EMP', '1DRA', '2JAD', '3PLT', 'Other'];
const MOCK_SEXES = ['M', 'F'];
const MOCK_SEGMENTS = [
    { segment: 'MS', subs: ['MS', 'SIG.', 'EPIC'] },
    { segment: 'PM', subs: ['PM'] },
];
function pickSegmentPair() {
    const s = pick(MOCK_SEGMENTS);
    return { segment: s.segment, sub_segment: pick(s.subs) };
}

// Most patrons in a mock floor sample are non-lodgers — weights sum to 1.
const MOCK_HOTEL_WEIGHTS = [
    { flag: 'is_whotel', w: 0.11 }, { flag: 'is_epic', w: 0.09 },
    { flag: 'is_star', w: 0.07 }, { flag: 'is_celebrity', w: 0.05 },
    { flag: 'is_no_room', w: 0.68 },
];
function pickHotelFlag() {
    let r = Math.random();
    for (const s of MOCK_HOTEL_WEIGHTS) { if (r < s.w) return s.flag; r -= s.w; }
    return 'is_no_room';
}

function bucketDow(dateStr) {
    const wd = new Date(dateStr).getUTCDay(); // 0 Sun .. 6 Sat
    if (wd === 0) return 'Sun';
    if (wd === 6) return 'Sat';
    if (wd === 5) return 'Fri';
    return 'WD';
}

function generateMockHotelRows() {
    const configData = require('../data/config_cod.json');
    const activeTables = configData.filter((c) => c.Group === 'TG' && c.is_Active === 1);

    const today = new Date();
    const dates = Array.from({ length: MOCK_DATE_COUNT }, (_, i) => {
        const d = new Date(today);
        d.setDate(d.getDate() - (MOCK_DATE_COUNT - 1 - i));
        return d.toISOString().slice(0, 10);
    });

    const players = Array.from({ length: MOCK_PLAYER_COUNT }, (_, i) => {
        const { segment, sub_segment } = pickSegmentPair();
        return {
            id: `P${1000 + i}`,
            card: pick(MOCK_CARD_TIERS),
            region: pick(MOCK_REGIONS),
            age: 21 + Math.floor(Math.random() * 55),
            sex: pick(MOCK_SEXES),
            segment, sub_segment,
            hotelFlag: pickHotelFlag(),
        };
    });

    const noPlayFlags = { is_celebrity: 0, is_epic: 0, is_star: 0, is_whotel: 0, is_no_room: 0 };
    const noPlayPatronFields = {
        id: null, card: null, region: null, age: null, sex: null,
        segment: null, sub_segment: null,
        turnover: null, casino_win: null, theo_win: null, patron_hands: null, secondsplayed: null,
    };

    const rows = [];
    for (const date of dates) {
        const dow = bucketDow(date);
        for (const cfg of activeTables) {
            const openhours = +(14 + Math.random() * 10).toFixed(1);
            const isOpen = Math.random() < 0.9;
            const base = {
                date, table: cfg.table, pit: String(cfg.pit), game: cfg.game, dow,
                table_min: pick(MOCK_TABLE_MINS), floorday: 1, openday: isOpen ? 1 : 0, openhours,
            };

            if (!isOpen) {
                rows.push({ ...base, ...noPlayPatronFields, ...noPlayFlags });
                continue;
            }

            const visitors = sampleWithoutReplacement(players, Math.floor(Math.random() * 15));
            if (visitors.length === 0) {
                rows.push({ ...base, ...noPlayPatronFields, ...noPlayFlags });
                continue;
            }

            for (const p of visitors) {
                const hands = 20 + Math.floor(Math.random() * 120);
                const avgBet = 200 + Math.random() * 3000;
                const turnover = Math.round(hands * avgBet * (0.9 + Math.random() * 0.3));
                const theoEdge = 0.01 + Math.random() * 0.05; // 1%-6%
                const theo_win = Math.round(turnover * theoEdge);
                // Actual (casino-perspective) win swings around theo, and
                // occasionally flips negative on a net-patron-win session.
                const casino_win = Math.round(
                    theo_win * (0.2 + Math.random() * 1.8) * (Math.random() < 0.12 ? -1 : 1)
                );
                const secondsplayed = Math.round(hands * (25 + Math.random() * 15));

                rows.push({
                    ...base,
                    id: p.id, card: p.card, region: p.region, age: p.age, sex: p.sex,
                    segment: p.segment, sub_segment: p.sub_segment,
                    turnover, casino_win, theo_win, patron_hands: hands, secondsplayed,
                    ...noPlayFlags, [p.hotelFlag]: 1,
                });
            }
        }
    }
    return rows;
}
