import React, { useMemo } from 'react';
import {
    Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
    Typography, Box,
} from '@mui/material';
import { PERF_FONTS } from '../constants/fontSizes';
const LG = PERF_FONTS.legend;

// PerformancePercentile
// ---------------------
//
// Sibling of PerformanceLegend. Instead of binning by KPI threshold, the
// rows bin by RANK PERCENTILE — ten fixed buckets (0-10%, 11-20%, …,
// 91-100%) — and the cell shows the AVERAGE VALUE of the KPI for the
// tables that fall in that bucket.
//
// Columns: All · MS · PM
//   - All     — rank EVERY visible table on this KPI, bin, average
//   - MS      — rank ONLY MS tables independently, bin, average
//   - PM      — rank ONLY PM tables independently, bin, average
//
// Independent ranking matters: a table in the bottom decile of the
// floor as a whole may sit in the top decile of MS alone (premium
// tables run far higher; if you only look at MS-only, the same table's
// position shifts). Splitting the All ranks by area gave the user the
// wrong picture — fixed here.
//
// Sentinel placeholders (-999999 / -1000000) are excluded so they
// don't drag down the 1st-decile bucket of any column.
//
// Row selection mirrors the legend: clicking a row pushes the union of
// table IDs across all three columns into the shared `selectedTables`
// model the brush uses.

// Keys read as the REAL half-open rank-percentile range each bucket
// owns (see the bucketing loop below: `pct >= loPct`, highest-first).
// Every integer boundary rounds UP into the higher bucket, so e.g. a
// pct of exactly 10 lands in "10-19.9%", not "0-9.9%". Only the top
// bucket is closed on the right ("90-100%", which includes pct = 100).
const PERCENTILE_BUCKETS = [
    { key: '90-100%',  loPct: 90, hiPct: 100, color: 'rgba(255 , 0 , 0)' },
    { key: '80-89.9%', loPct: 80, hiPct: 90,  color: 'rgba(251 , 155 , 210)' },
    { key: '70-79.9%', loPct: 70, hiPct: 80,  color: 'rgba(242 , 141 , 30)' },
    { key: '60-69.9%', loPct: 60, hiPct: 70,  color: 'rgba(244 , 238 , 12)' },
    { key: '50-59.9%', loPct: 50, hiPct: 60,  color: 'rgba(196 , 215 , 155)' },
    { key: '40-49.9%', loPct: 40, hiPct: 50,  color: 'rgba(118 , 195 , 145)' },
    { key: '30-39.9%', loPct: 30, hiPct: 40,  color: 'rgba(6 , 142 , 34)' },
    { key: '20-29.9%', loPct: 20, hiPct: 30,  color: 'rgba(97 , 135 , 255)' },
    { key: '10-19.9%', loPct: 10, hiPct: 20,  color: 'rgba(60 , 100 , 200)' },
    { key: '0-9.9%',   loPct:  0, hiPct: 10,  color: 'rgba(0 , 60 , 180)' },
];

const AREA_COLUMNS = ['All', 'MS', 'PM'];

// Per-(area, scatter-row) → percentile bucket. Pulls valid values for
// the predicate-matching rows, sorts ascending, assigns each row a
// fractional rank → bucket. Returns:
//   - bucketByRowIdx:  Map<scatterRowIndex, bucketKey>
//   - avgByBucket:     { [bucketKey]: { sum, count, avg, tables: Set } }
function computeColumnDistribution(scatterData, kpiDim, currentHourIdx, predicate) {
    const valid = [];
    for (let i = 0; i < scatterData.length; i++) {
        const s = scatterData[i];
        if (predicate && !predicate(s)) continue;
        let v = s[kpiDim];
        if (Array.isArray(v)) v = v[currentHourIdx];
        if (v == null || v === -1000000 || v === -999999) continue;
        if (!Number.isFinite(v)) continue;
        valid.push({ idx: i, value: v });
    }

    const avgByBucket = Object.fromEntries(
        PERCENTILE_BUCKETS.map((b) => [b.key, { sum: 0, count: 0, avg: null, tables: new Set() }])
    );
    const bucketByRowIdx = new Map();

    if (valid.length === 0) {
        return { avgByBucket, bucketByRowIdx };
    }

    // Sort ascending so rank 0 = lowest. Fractional rank → percentile
    // position; walk the bucket list (which is ordered highest first)
    // and pick the FIRST bucket whose `loPct` floor is satisfied. This
    // makes the top value land exactly in 91-100%.
    valid.sort((a, b) => a.value - b.value);
    const n = valid.length;
    for (let rank = 0; rank < n; rank++) {
        const pct = n === 1 ? 100 : (rank / (n - 1)) * 100;
        let bucketKey = null;
        for (const b of PERCENTILE_BUCKETS) {
            if (pct >= b.loPct) { bucketKey = b.key; break; }
        }
        if (!bucketKey) continue;

        const entry = avgByBucket[bucketKey];
        entry.sum += valid[rank].value;
        entry.count += 1;

        const tid = String(scatterData[valid[rank].idx][16] || '').trim().toUpperCase();
        if (tid) entry.tables.add(tid);

        bucketByRowIdx.set(valid[rank].idx, bucketKey);
    }

    // Materialise the averages now so the render path is just dict reads.
    for (const k of Object.keys(avgByBucket)) {
        const e = avgByBucket[k];
        e.avg = e.count > 0 ? e.sum / e.count : null;
    }
    return { avgByBucket, bucketByRowIdx };
}

const PerformancePercentile = ({
    title,
    scatterData,
    kpiDim,
    currentHourIdx = 0,
    selectedArea = [],
    onRowToggle,
    // Active table-selection set (same array the brush + legend feed).
    // Component derives its own selectedRowKeys from this so the parent
    // doesn't have to mirror the decile binning twice.
    selectedTables = [],
    // KPI-aware formatter from the parent — same instance the legend
    // uses for its Overall Avg row, so percentile cells render with
    // identical formatting (k-suffix for money, % for percentages, etc.).
    formatValue,
}) => {
    // Compute the three column distributions independently. Each one
    // sees only the subset of scatterData its predicate accepts and
    // ranks those rows on their own — that's the whole point of the
    // refactor: MS isn't a "slice of All-ranked rows" anymore.
    const distributions = useMemo(() => {
        if (!Array.isArray(scatterData) || scatterData.length === 0 || kpiDim == null) {
            return {
                All: { avgByBucket: emptyAvgMap(), bucketByRowIdx: new Map() },
                MS:  { avgByBucket: emptyAvgMap(), bucketByRowIdx: new Map() },
                PM:  { avgByBucket: emptyAvgMap(), bucketByRowIdx: new Map() },
            };
        }
        return {
            All: computeColumnDistribution(scatterData, kpiDim, currentHourIdx, null),
            MS:  computeColumnDistribution(scatterData, kpiDim, currentHourIdx, (s) => s[34] === 'MS'),
            PM:  computeColumnDistribution(scatterData, kpiDim, currentHourIdx, (s) => s[34] === 'PM'),
        };
    }, [scatterData, kpiDim, currentHourIdx]);

    // Build the rendered rows. Each row's `_tables` is the UNION of
    // tables that fell into this bucket across All / MS / PM — clicking
    // the row selects everything that ranks in this decile in ANY
    // partition. Most useful for the "show me the top 10% on this KPI"
    // selection workflow.
    const rows = useMemo(() => {
        // Row-click highlight is ALWAYS driven by the "All" column's
        // decile membership — never the MS or PM partitions, and never a
        // blended MS∪PM union. A table's decile within MS/PM differs from
        // its decile within All, so the only set that matches the "All"
        // column the user reads is All.tables itself.
        return PERCENTILE_BUCKETS.map((b) => {
            const all = distributions.All.avgByBucket[b.key];
            const ms  = distributions.MS.avgByBucket[b.key];
            const pm  = distributions.PM.avgByBucket[b.key];
            return {
                ...b,
                All: all.avg,
                MS:  ms.avg,
                PM:  pm.avg,
                // Per-column counts kept around for the cell tooltip /
                // a future toggle that swaps "show count" vs "show avg".
                AllCount: all.count, MSCount: ms.count, PMCount: pm.count,
                // Selection set = the "All" bucket's tables, always.
                _tables: new Set(all.tables),
            };
        });
    }, [distributions]);

    // Selection-row derivation — a row is "selected" when EVERY table
    // in its union set is in the current selectedTables. Matches the
    // legend's row-selection semantics so cross-component highlighting
    // stays in lockstep.
    const selectedRowKeys = useMemo(() => {
        if (!selectedTables || selectedTables.length === 0) return new Set();
        const sel = new Set(selectedTables);
        const out = new Set();
        for (const r of rows) {
            if (!r._tables || r._tables.size === 0) continue;
            let all = true;
            for (const t of r._tables) {
                if (!sel.has(t)) { all = false; break; }
            }
            if (all) out.add(r.key);
        }
        return out;
    }, [rows, selectedTables]);

    // When the global Area filter zooms to one area, the OTHER area
    // column will have no values. Fade the column header so the user
    // knows the column is intentionally empty rather than a data gap.
    const columnFaded = (col) =>
        selectedArea.length === 1 && col !== 'All' && col !== selectedArea[0];

    const fmt = formatValue || defaultFormat;

    return (
        <TableContainer component={Box} sx={{
            bgcolor: 'transparent', border: 'none', width: '100%',
            // Content-driven height — no inner scroll. Parent container
            // grows to accommodate all 10 rows + header so the table
            // never needs to be scrolled internally.
            display: 'flex',
            flexDirection: 'column',
        }}>
            {title && (
                <Typography variant="subtitle2" sx={{
                    color: 'rgba(255,255,255,0.9)',
                    mb: 1.5, px: 1, fontSize: LG.title, fontWeight: 600,
                    flexShrink: 0,
                    display: 'flex', alignItems: 'center', gap: 1,
                }}>
                    <Box sx={{ width: 4, height: 18, bgcolor: '#7aa2f7', borderRadius: 1 }} />
                    {title}
                </Typography>
            )}
            <Box sx={{ width: '100%' }}>
                <Table size="small" sx={{ tableLayout: 'fixed', width: '100%' }}>
                    <TableHead>
                        <TableRow>
                            <TableCell sx={{
                                color: 'rgba(255,255,255,0.5)',
                                borderBottom: '1px solid rgba(255,255,255,0.05)',
                                fontSize: LG.header, py: 1.4, pl: 2.5,
                                bgcolor: 'rgba(35, 38, 55, 0.95)',
                                width: '160px',
                            }}>
                                Percentile
                            </TableCell>
                            {AREA_COLUMNS.map((col) => (
                                <TableCell key={col} align="center" sx={{
                                    color: columnFaded(col) ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.5)',
                                    borderBottom: '1px solid rgba(255,255,255,0.05)',
                                    fontSize: LG.header, py: 1.4,
                                    bgcolor: 'rgba(35, 38, 55, 0.95)',
                                }}>
                                    {col}
                                </TableCell>
                            ))}
                        </TableRow>
                    </TableHead>
                    <TableBody>
                        {rows.map((r) => {
                            const isSelected = selectedRowKeys.has(r.key);
                            const clickable  = !!onRowToggle && r._tables.size > 0;
                            return (
                                <TableRow
                                    key={r.key}
                                    onClick={clickable ? () => onRowToggle(r._tables) : undefined}
                                    sx={{
                                        cursor: clickable ? 'pointer' : 'default',
                                        bgcolor: isSelected ? 'rgba(122, 162, 247, 0.18)' : undefined,
                                        '&:last-child td, &:last-child th': { border: 0 },
                                        '&:hover': clickable
                                            ? { bgcolor: isSelected ? 'rgba(122, 162, 247, 0.24)' : 'rgba(122, 162, 247, 0.06)' }
                                            : undefined,
                                        '&:nth-of-type(even)': !isSelected ? { bgcolor: 'rgba(255,255,255,0.015)' } : undefined,
                                        transition: 'background-color 140ms',
                                    }}
                                >
                                    <TableCell component="th" scope="row" sx={{
                                        // Percentile rows don't carry the color-swatch the legend uses
                                        // — the decile labels (91-100%, …) are already self-evidently
                                        // ordered, so the swatch was visual clutter without information.
                                        color: '#fff',
                                        borderBottom: '1px solid rgba(255,255,255,0.05)',
                                        py: 1.6, pl: 2.5, pr: 0.5, fontSize: LG.body,
                                        width: '160px',
                                        whiteSpace: 'nowrap',
                                    }}>
                                        {r.key}
                                    </TableCell>
                                    {AREA_COLUMNS.map((col) => {
                                        const val = r[col];
                                        const empty = val == null;
                                        const countKey = `${col}Count`;
                                        const count = r[countKey];
                                        return (
                                            <TableCell
                                                key={col}
                                                align="center"
                                                title={count > 0 ? `${count} table${count === 1 ? '' : 's'}` : 'no tables in this bucket'}
                                                sx={{
                                                    color: empty
                                                        ? 'rgba(255,255,255,0.2)'
                                                        : columnFaded(col) ? 'rgba(255,255,255,0.3)' : '#fff',
                                                    borderBottom: '1px solid rgba(255,255,255,0.05)',
                                                    py: 1.6, fontSize: LG.body,
                                                    fontVariantNumeric: 'tabular-nums',
                                                }}
                                            >
                                                {empty ? '–' : `${fmt(val, col)} (${count})`}
                                            </TableCell>
                                        );
                                    })}
                                </TableRow>
                            );
                        })}
                    </TableBody>
                </Table>
            </Box>
        </TableContainer>
    );
};

// Build the empty-state avgByBucket shape — shared so the empty branch
// and the populated branch return structurally identical objects.
function emptyAvgMap() {
    return Object.fromEntries(
        PERCENTILE_BUCKETS.map((b) => [b.key, { sum: 0, count: 0, avg: null, tables: new Set() }])
    );
}

// Last-resort formatter — used only when the parent forgot to pass
// `formatValue`. The dashboard always passes the KPI-aware version so
// this branch shouldn't fire in production.
function defaultFormat(val) {
    if (val == null || !Number.isFinite(val)) return '–';
    if (Math.abs(val) >= 10000) return `${(val / 1000).toFixed(0)}k`;
    return val.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

export default PerformancePercentile;
