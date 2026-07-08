// SpreadComparePanel — Summary view (modeled on PerformanceLegend)
// ================================================================
//
// Lives in the right column when the user picks the "Summary" tab.
// Adopts the look-and-feel of the Performance Heatmap's legend table
// (MUI Table, sticky header, alt-row tint, trailing total row in
// accent color), tuned for spread scheduling.
//
// Columns chosen for "useful at a glance":
//
//   No reference plan picked:
//     Shift · Time range · Hours/tbl · Tables · Total hrs · Share %
//
//   With a reference plan:
//     Shift · Time · Hrs/tbl
//          · Target tbl · Target hrs · Target %
//          · Ref tbl · Ref hrs · Ref %
//          · Δ hrs (signed)
//
// The trailing row mirrors the legend's "Overall Avg" pattern but is
// labeled "Total" — the column totals are the rollup of every shift.

import React, { useMemo } from 'react';
import {
    Box, Stack, Typography,
    Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
} from '@mui/material';
import { shiftCounts } from '../utils/spreadCompare';
import { shiftLengthHours, formatShiftClock } from '../utils/shiftCoverage';
import { SPREAD_FONTS } from '../constants/fontSizes';

const ACCENT = '#7adfff';

// Time-window formatter for the Summary table — shares the inclusive
// end-hour clock helper with the Shift Palette so both read "11:00 –
// 02:59" identically. Falls back to a dash for the Unassigned row.
function formatShiftWindow(shift) {
    if (!shift) return '—';
    return formatShiftClock(shift);
}

// Sort key for the shift summary rows. Order requested by the user:
// 24h first, then 16h, then 8h, then any non-standard lengths by
// descending length, then "Unassigned" pinned at the bottom.
const LENGTH_ORDER = [24, 16, 8];
function shiftSortRank(row) {
    if (row.shiftId === '__none') return [3, 0, ''];
    const idx = LENGTH_ORDER.indexOf(row.hoursPerTbl);
    if (idx >= 0)                 return [0, idx, row.shiftName || ''];
    return [1, -row.hoursPerTbl,  row.shiftName || ''];
}

export default function SpreadComparePanel({
    targetVersion,            // ScheduleVersion or { assignments } shape
    referenceVersion,
    shifts,
    // tables prop kept for API stability; not used directly here
    // eslint-disable-next-line no-unused-vars
    tables,
}) {
    const hasRef = !!referenceVersion;
    const targetAssignments = targetVersion?.assignments || {};
    const refAssignments    = referenceVersion?.assignments || {};

    // Per-shift counts (target + ref, ordered by absolute delta desc).
    // shiftCounts returns ALL shifts that appear in either plan, plus
    // an Unassigned bucket when one side has fewer assignments than the
    // other. We filter out fully-empty rows below.
    const rawRows = useMemo(
        () => shiftCounts(targetAssignments, refAssignments, shifts),
        [targetAssignments, refAssignments, shifts]
    );

    // Per-shift metadata lookup — used to render time range + length.
    const shiftMetaById = useMemo(() => {
        const m = new Map();
        for (const s of (shifts || [])) m.set(s.id, s);
        return m;
    }, [shifts]);

    // Hydrate every row with derived numbers we render. We also merge
    // in ANY shift from the library that didn't appear in either plan
    // — the user asked to see every available shift, including ones
    // with zero assignments. Then sort by length per the requested
    // order (24h → 16h → 8h → others → Unassigned).
    const rows = useMemo(() => {
        const seen = new Set();
        const hydrated = rawRows.map((r) => {
            seen.add(r.shiftId);
            const shift  = shiftMetaById.get(r.shiftId);
            const length = shift ? shiftLengthHours(shift) : 0;
            return {
                ...r,
                timeRange:   formatShiftWindow(shift),
                hoursPerTbl: length,
                targetHours: r.targetCount * length,
                refHours:    r.refCount    * length,
            };
        });
        for (const s of (shifts || [])) {
            if (seen.has(s.id)) continue;
            hydrated.push({
                shiftId:     s.id,
                shiftName:   s.name,
                color:       s.color,
                targetCount: 0,
                refCount:    0,
                delta:       0,
                timeRange:   formatShiftWindow(s),
                hoursPerTbl: shiftLengthHours(s),
                targetHours: 0,
                refHours:    0,
            });
        }
        hydrated.sort((a, b) => {
            const ka = shiftSortRank(a);
            const kb = shiftSortRank(b);
            if (ka[0] !== kb[0]) return ka[0] - kb[0];
            if (ka[1] !== kb[1]) return ka[1] - kb[1];
            return String(ka[2]).localeCompare(String(kb[2]));
        });
        return hydrated;
    }, [rawRows, shiftMetaById, shifts]);

    // Roll-up totals — derived from the SAME rows the user sees, so
    // the "Total" line can never disagree with the visible cells.
    const totals = useMemo(() => {
        return rows.reduce((acc, r) => {
            acc.targetTables += r.targetCount;
            acc.refTables    += r.refCount;
            acc.targetHours  += r.targetHours;
            acc.refHours     += r.refHours;
            return acc;
        }, { targetTables: 0, refTables: 0, targetHours: 0, refHours: 0 });
    }, [rows]);

    // Headline totals derived from the same rows the user sees, so
    // the table's Total row never disagrees with the share% denominator.
    const totalTargetHours = totals.targetHours;
    const totalRefHours    = totals.refHours;

    if (!targetVersion) {
        return (
            <Box sx={{
                p: 2,
                bgcolor: 'rgba(10, 22, 35, 0.55)',
                border: '1px solid rgba(122, 200, 220, 0.15)',
                borderRadius: 2,
                color: 'rgba(255,255,255,0.55)',
                fontSize: 13,
            }}>
                No active target plan to summarise.
            </Box>
        );
    }

    return (
        <Stack spacing={1.2} sx={{ fontVariantNumeric: 'tabular-nums' }}>
            {/* Summary table — styled after PerformanceLegend. The
                headline "Total scheduled table-hours" card was removed
                per request; the table's trailing Total row already
                surfaces the same numbers. */}
            <Card disablePadding>
                <SummaryLegend
                    rows={rows}
                    totals={totals}
                    hasRef={hasRef}
                    headlineTargetHours={totalTargetHours}
                    headlineRefHours={totalRefHours}
                />
            </Card>
        </Stack>
    );
}

// ---------------------------------------------------------------------
// SummaryLegend — the MUI Table that mirrors PerformanceLegend
// ---------------------------------------------------------------------
function SummaryLegend({ rows, totals, hasRef }) {
    // The columns rendered after the Shift label cell. Every column is
    // rendered with the SAME font size + color (uniform body styling) —
    // the only intentional color is the Δ hrs sign (green over / red
    // under). The shift name + its clock window live in the label cell.
    const columns = hasRef ? [
        { key: 'len',  label: 'Hrs/tbl', width: 78, align: 'right' },
        { key: 'tTbl', label: 'Tables',  width: 78, align: 'right' },
        { key: 'tHrs', label: 'Hrs',     width: 78, align: 'right' },
        { key: 'rTbl', label: 'Ref tbl', width: 78, align: 'right' },
        { key: 'rHrs', label: 'Ref hrs', width: 78, align: 'right' },
        { key: 'dHrs', label: 'Δ hrs',   width: 84, align: 'right' },
    ] : [
        { key: 'len',  label: 'Hrs/tbl',   width: 110, align: 'right' },
        { key: 'tTbl', label: 'Tables',    width: 120, align: 'right' },
        { key: 'tHrs', label: 'Total hrs', width: 130, align: 'right' },
    ];

    return (
        <TableContainer component={Box} sx={{
            bgcolor: 'transparent', border: 'none', width: '100%',
            display: 'flex', flexDirection: 'column',
        }}>
            <Typography variant="subtitle2" sx={{
                color: 'rgba(255,255,255,0.9)',
                mb: 1.5, px: 1, fontSize: SPREAD_FONTS.summary.cardTitle, fontWeight: 600,
                display: 'flex', alignItems: 'center', gap: 1,
            }}>
                <Box sx={{ width: 4, height: 18, bgcolor: ACCENT, borderRadius: 1 }} />
                Shift Summary{hasRef ? ' — Target vs Reference' : ''}
            </Typography>
            <Box sx={{ width: '100%' }}>
                <Table size="small" stickyHeader sx={{ tableLayout: 'auto', width: '100%' }}>
                    <TableHead>
                        <TableRow>
                            <TableCell sx={headCellSx({ minWidth: 150, textAlign: 'left' })}>
                                Shift Time
                            </TableCell>
                            {columns.map((c) => (
                                <TableCell key={c.key} align={c.align} sx={headCellSx({ minWidth: c.width })}>
                                    {c.label}
                                </TableCell>
                            ))}
                        </TableRow>
                    </TableHead>
                    <TableBody>
                        {rows.length === 0 && (
                            <TableRow>
                                <TableCell colSpan={1 + columns.length} sx={{
                                    color: 'rgba(255,255,255,0.45)',
                                    fontStyle: 'italic', py: 2.2, pl: 2.5,
                                    fontSize: '0.95rem',
                                    borderBottom: 'none',
                                }}>
                                    No tables assigned yet.
                                </TableCell>
                            </TableRow>
                        )}
                        {rows.map((r) => {
                            const dHrs = r.targetHours - r.refHours;
                            return (
                                <TableRow key={r.shiftId} sx={{
                                    '&:last-child td, &:last-child th': { border: 0 },
                                    '&:nth-of-type(even)': { bgcolor: 'rgba(255,255,255,0.015)' },
                                    transition: 'background-color 140ms',
                                }}>
                                    {/* Shift label cell — swatch + the TIME
                                        WINDOW as the identifier (no alias). */}
                                    <TableCell component="th" scope="row" sx={labelCellSx}>
                                        <Box sx={{
                                            width: 14, height: 14, bgcolor: r.color, borderRadius: '2px',
                                            flexShrink: 0,
                                            boxShadow: r.shiftId === '__none' ? 'none' : `0 0 6px ${r.color}66`,
                                        }} />
                                        <Box sx={{ fontWeight: 700, whiteSpace: 'nowrap' }}>
                                            {r.shiftId === '__none' ? 'Unassigned' : r.timeRange}
                                        </Box>
                                    </TableCell>

                                    {/* Body columns — UNIFORM style across
                                        every column (one font size + color);
                                        Δ carries the only intentional sign
                                        color. No "h" suffix (Hrs in header). */}
                                    {columns.map((c) => {
                                        let content = null;
                                        if (c.key === 'len')   content = r.hoursPerTbl ? `${r.hoursPerTbl}` : '—';
                                        if (c.key === 'tTbl')  content = numberOrDim(r.targetCount);
                                        if (c.key === 'tHrs')  content = r.targetHours ? `${r.targetHours}` : <Dim>—</Dim>;
                                        if (c.key === 'rTbl')  content = numberOrDim(r.refCount);
                                        if (c.key === 'rHrs')  content = r.refHours ? `${r.refHours}` : <Dim>—</Dim>;
                                        if (c.key === 'dHrs')  content = <DeltaInline value={dHrs} unit="" />;
                                        return (
                                            <TableCell key={c.key} align={c.align} sx={bodyCellSx()}>
                                                {content}
                                            </TableCell>
                                        );
                                    })}
                                </TableRow>
                            );
                        })}

                        {/* Total row — mirrors PerformanceLegend's
                            "Overall Avg" pattern: accent color + a top
                            divider. We render TOTAL counts/hours and
                            leave Time / Hrs-per-tbl blank (they're not
                            additive). */}
                        {rows.length > 0 && (
                            <TableRow>
                                <TableCell component="th" scope="row" sx={totalLabelSx}>
                                    Total
                                </TableCell>
                                {columns.map((c) => {
                                    let content = null;
                                    if (c.key === 'len')  content = '';
                                    if (c.key === 'tTbl') content = totals.targetTables;
                                    if (c.key === 'tHrs') content = `${totals.targetHours}`;
                                    if (c.key === 'rTbl') content = totals.refTables;
                                    if (c.key === 'rHrs') content = `${totals.refHours}`;
                                    if (c.key === 'dHrs') content = (
                                        <DeltaInline
                                            value={totals.targetHours - totals.refHours}
                                            unit=""
                                            strong
                                        />
                                    );
                                    return (
                                        <TableCell key={c.key} align={c.align} sx={totalCellSx}>
                                            {content}
                                        </TableCell>
                                    );
                                })}
                            </TableRow>
                        )}
                    </TableBody>
                </Table>
            </Box>
        </TableContainer>
    );
}

// ---- shared cell styles (mirror PerformanceLegend) ----

const HEADER_BG = 'rgba(35, 38, 55, 0.95)';

// One uniform scale for the whole table: header 1.05rem (muted), body
// + total 1.15rem. Body color is a single value across every column;
// the total row is the same size, just bold + accent.
// Font sizes pulled from the central scheduling config (SPREAD_FONTS).
function headCellSx({ minWidth, textAlign }) {
    return {
        color: 'rgba(255,255,255,0.55)',
        borderBottom: '1px solid rgba(255,255,255,0.08)',
        fontSize: SPREAD_FONTS.summary.header, fontWeight: 600, py: 1.4, px: 1.2,
        bgcolor: HEADER_BG, zIndex: 2,
        minWidth,
        ...(textAlign ? { textAlign } : null),
    };
}
const labelCellSx = {
    color: '#fff',
    borderBottom: '1px solid rgba(255,255,255,0.05)',
    py: 1.9, pl: 2, pr: 0.5, fontSize: SPREAD_FONTS.summary.shiftLabel,
    display: 'flex', alignItems: 'center', justifyContent: 'flex-start', gap: 1,
    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
};
function bodyCellSx() {
    return {
        color: '#fff',
        borderBottom: '1px solid rgba(255,255,255,0.05)',
        py: 1.9, px: 1.2,
        fontSize: SPREAD_FONTS.summary.body, fontWeight: 600,
    };
}
const totalLabelSx = {
    color: ACCENT,
    borderBottom: 'none',
    borderTop: '1px solid rgba(255,255,255,0.12)',
    py: 2.1, pl: 2, pr: 0.5, fontSize: SPREAD_FONTS.summary.total, fontWeight: 800,
};
const totalCellSx = {
    color: ACCENT,
    borderBottom: 'none',
    borderTop: '1px solid rgba(255,255,255,0.12)',
    py: 2.1, px: 1.2, fontSize: SPREAD_FONTS.summary.total, fontWeight: 800,
};

// ---- small subcomponents ----

function Card({ children, disablePadding }) {
    return (
        <Box sx={{
            p: disablePadding ? 1 : 1.4,
            bgcolor: 'rgba(8, 22, 36, 0.55)',
            border: '1px solid rgba(122, 200, 220, 0.12)',
            borderRadius: 1.5,
        }}>
            {children}
        </Box>
    );
}

function Caption({ children, sx }) {
    return (
        <Typography sx={{
            color: 'rgba(255,255,255,0.45)', fontSize: 10, fontWeight: 700,
            letterSpacing: 1, textTransform: 'uppercase',
            ...sx,
        }}>{children}</Typography>
    );
}

function DeltaInline({ value, unit = '', strong }) {
    if (value === 0) return <span style={{ color: 'rgba(255,255,255,0.4)' }}>0{unit}</span>;
    const color = value > 0 ? '#3dd585' : '#f7768e';
    return (
        <span style={{ color, fontWeight: strong ? 800 : 700 }}>
            {value > 0 ? '+' : ''}{value}{unit}
        </span>
    );
}

function numberOrDim(n) {
    if (!n) return <Dim>0</Dim>;
    return n;
}

function Dim({ children }) {
    return <span style={{ color: 'rgba(255,255,255,0.35)' }}>{children}</span>;
}
