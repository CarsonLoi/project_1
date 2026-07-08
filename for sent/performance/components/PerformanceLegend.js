import React from 'react';
import { Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Typography, Box } from '@mui/material';
import { PERF_FONTS } from '../constants/fontSizes';
const LG = PERF_FONTS.legend;

// Default formatter for the Overall Avg row. Falls back to the legacy
// k-suffix-on-large-values + zero-decimal-integer behavior when the
// parent doesn't provide a custom one. Kept inline (not exported)
// because it's the safety net, not a recipe consumers should reach for.
const defaultOverallAvgFormatter = (val) => {
    if (val == null) return '-';
    if (val >= 10000) return `${(val / 1000).toFixed(0)}k`;
    return val.toLocaleString(undefined, { maximumFractionDigits: 0 });
};

/**
 * Compact summary table that sits in the legend panel.
 *
 * Props:
 *   title              — heading text (e.g. the active KPI name)
 *   columns            — column labels (legend groups: MS / 805 / 871 …)
 *   dataRows           — array of { key, color, [col]: value, _tables? }
 *                        `_tables` (Set<tableId>) — when present and
 *                        non-empty, the row is clickable and clicking
 *                        calls onRowToggle with that Set.
 *   overallAverages    — { [col]: number } for the trailing avg/total row
 *   overallAvgLabel    — label for the trailing row's first cell.
 *                        Defaults to "Overall Avg". Pass "Total Tables"
 *                        for count-based KPIs.
 *   formatOverallAvg   — (value, col) => string. Owns the rendering
 *                        of every overall-avg cell so the parent (which
 *                        knows the KPI semantics — money / percentage /
 *                        count) controls formatting from one place. The
 *                        legend no longer has to guess from the title.
 *   onRowToggle        — (Set<tableId>) => void. Called when the user
 *                        clicks a row whose _tables is populated. The
 *                        parent decides how to merge the bucket's table
 *                        IDs into the global selection state (the
 *                        dashboard toggles them in selectedTables).
 *   selectedRowKeys    — Set<string> of currently-selected row keys
 *                        (derived by the parent from selectedTables).
 *                        Selected rows get a tinted background.
 */
const PerformanceLegend = ({
    title,
    columns,
    dataRows,
    overallAverages,
    overallAvgLabel = 'Overall Avg',
    formatOverallAvg = defaultOverallAvgFormatter,
    onRowToggle,
    selectedRowKeys,
}) => {
    if (!dataRows || dataRows.length === 0) {
        return <Typography variant="caption">No data available.</Typography>;
    }

    return (
        <TableContainer component={Box} sx={{
            bgcolor: 'transparent', border: 'none', width: '100%',
            // Content-driven — the parent container (PerformanceDashboard's
            // right-side card) now uses minHeight rather than a fixed
            // height, so the legend can render every row at its natural
            // size and the card grows to fit. No more inner scrollbar
            // for the 8-11 row tables we typically render.
            display: 'flex',
            flexDirection: 'column',
        }}>
            {title && (
                <Typography variant="subtitle2" sx={{
                    color: 'rgba(255,255,255,0.9)',
                    mb: 1.5, px: 1, fontSize: LG.title, fontWeight: 600,
                    flexShrink: 0,
                    display: 'flex', alignItems: 'center', gap: 1
                }}>
                    <Box sx={{ width: 4, height: 18, bgcolor: '#7aa2f7', borderRadius: 1 }} />
                    {title}
                </Typography>
            )}
            {/* Table renders at its natural row heights. The parent
                container (PerformanceDashboard's right-side card) now
                grows to fit content, so we no longer need an inner
                scrollbar / flex-fill setup. */}
            <Box sx={{ width: '100%' }}>
            <Table size="small" stickyHeader sx={{ tableLayout: 'fixed', width: '100%' }}>
                <TableHead>
                    <TableRow>
                        <TableCell sx={{
                            color: 'rgba(255,255,255,0.5)',
                            borderBottom: '1px solid rgba(255,255,255,0.05)',
                            fontSize: LG.header, py: 1.4, pl: 2.5,
                            bgcolor: 'rgba(35, 38, 55, 0.95)', zIndex: 2,
                            width: '180px' // Fixed width for the label column
                        }}>
                            # Tables
                        </TableCell>
                        {columns.map(col => (
                            <TableCell key={col} align="center" sx={{
                                color: 'rgba(255,255,255,0.5)',
                                borderBottom: '1px solid rgba(255,255,255,0.05)',
                                fontSize: LG.header, py: 1.4,
                                bgcolor: 'rgba(35, 38, 55, 0.95)', zIndex: 2
                            }}>
                                {col}
                            </TableCell>
                        ))}
                    </TableRow>
                </TableHead>
                <TableBody>
                    {/* Skip rows with a blank key (e.g. the empty gametype
                        that filtered-out tables now carry) — they'd render
                        as an unlabeled swatch row. */}
                    {dataRows.filter((row) => row.key !== '' && row.key != null).map((row, idx) => {
                        // A row is clickable only when the parent gave us
                        // a non-empty `_tables` set (the universe of table
                        // IDs that fall in this bucket). Empty buckets
                        // stay non-interactive — clicking them would be
                        // a no-op on selectedTables.
                        const clickable  = !!onRowToggle && row._tables && row._tables.size > 0;
                        const isSelected = selectedRowKeys ? selectedRowKeys.has(row.key) : false;
                        return (
                        <TableRow
                            key={idx}
                            onClick={clickable ? () => onRowToggle(row._tables) : undefined}
                            sx={{
                                cursor: clickable ? 'pointer' : 'default',
                                bgcolor: isSelected ? 'rgba(122, 162, 247, 0.18)' : undefined,
                                '&:last-child td, &:last-child th': { border: 0 },
                                '&:hover': clickable
                                    ? { bgcolor: isSelected ? 'rgba(122, 162, 247, 0.24)' : 'rgba(122, 162, 247, 0.06)' }
                                    : undefined,
                                '&:nth-of-type(even)': !isSelected ? { bgcolor: 'rgba(255,255,255,0.015)' } : undefined,
                                transition: 'background-color 140ms',
                            }}>
                            <TableCell component="th" scope="row" sx={{
                                color: '#fff',
                                borderBottom: '1px solid rgba(255,255,255,0.05)',
                                py: 1.8, pl: 2.5, pr: 0.5, fontSize: LG.body,
                                // Left-justified with a small left pad so the
                                // swatch + key (e.g. "BA", "BJ") don't hug the
                                // table edge. justifyContent: 'flex-start' is
                                // the flex default but explicit for clarity.
                                display: 'flex', alignItems: 'center', justifyContent: 'flex-start', gap: 1,
                                width: '180px',
                                whiteSpace: 'nowrap',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis'
                            }}>
                                <Box sx={{ width: 14, height: 14, bgcolor: row.color, borderRadius: '2px', flexShrink: 0 }} />
                                {row.key}
                            </TableCell>
                            {columns.map(col => (
                                <TableCell key={col} align="center" sx={{
                                    color: row[col] === 0 ? 'rgba(255,255,255,0.2)' : '#fff',
                                    borderBottom: '1px solid rgba(255,255,255,0.05)',
                                    py: 1.8, fontSize: LG.body
                                }}>
                                    {row[col] || '-'}
                                </TableCell>
                            ))}
                        </TableRow>
                        );
                    })}

                    {/* Trailing row: Overall Avg (or Total Tables for
                        count-based KPIs). Both the label and per-cell
                        formatting are owned by the parent via props,
                        so the legend no longer parses the title string
                        to guess the KPI's semantic type. */}
                    {overallAverages && Object.keys(overallAverages).length > 0 && (
                        <TableRow>
                            <TableCell component="th" scope="row" sx={{
                                color: '#7aa2f7',
                                borderBottom: 'none', borderTop: '1px solid rgba(255,255,255,0.1)',
                                py: 1.8, pl: 2.5, pr: 0.5, fontSize: LG.body, fontWeight: 600
                            }}>
                                {overallAvgLabel}
                            </TableCell>
                            {columns.map(col => {
                                const val = overallAverages[col];
                                return (
                                    <TableCell key={col} align="center" sx={{
                                        color: '#7aa2f7',
                                        borderBottom: 'none', borderTop: '1px solid rgba(255,255,255,0.1)',
                                        py: 1.8, fontSize: LG.body, fontWeight: 600
                                    }}>
                                        {formatOverallAvg(val, col)}
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
};

export default PerformanceLegend;
