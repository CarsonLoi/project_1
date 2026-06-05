import React from 'react';
import { Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Typography, Box } from '@mui/material';

const PerformanceLegend = ({ title, columns, dataRows, overallAverages }) => {
    if (!dataRows || dataRows.length === 0) {
        return <Typography variant="caption">No data available.</Typography>;
    }

    return (
        <TableContainer component={Box} sx={{
            bgcolor: 'transparent', border: 'none', width: '100%',
            // Fill the parent panel (pinned to the scatter height) and
            // lay out as a column so the title sits on top and the table
            // flexes to occupy the remaining height.
            height: '100%',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
        }}>
            {title && (
                <Typography variant="subtitle2" sx={{
                    color: 'rgba(255,255,255,0.9)',
                    mb: 1.5, px: 1, fontSize: '1.2rem', fontWeight: 600,
                    flexShrink: 0,
                    display: 'flex', alignItems: 'center', gap: 1
                }}>
                    <Box sx={{ width: 4, height: 18, bgcolor: '#7aa2f7', borderRadius: 1 }} />
                    {title}
                </Typography>
            )}
            {/* Takes the remaining height below the title. The table
                keeps its NATURAL row heights (top-aligned) — we do NOT
                stretch rows to fill. Any unused space sits below the
                last row; if the rows exceed the available height the
                wrapper scrolls. The card height itself is pinned to the
                scatter height by the parent. */}
            <Box sx={{ flex: 1, minHeight: 0, width: '100%', overflow: 'auto' }}>
            <Table size="small" stickyHeader sx={{ tableLayout: 'fixed', width: '100%' }}>
                <TableHead>
                    <TableRow>
                        <TableCell sx={{
                            color: 'rgba(255,255,255,0.5)',
                            borderBottom: '1px solid rgba(255,255,255,0.05)',
                            fontSize: '1.05rem', py: 1.4, pl: 2.5,
                            bgcolor: 'rgba(35, 38, 55, 0.95)', zIndex: 2,
                            width: '180px' // Fixed width for the label column
                        }}>
                            Legend
                        </TableCell>
                        {columns.map(col => (
                            <TableCell key={col} align="center" sx={{
                                color: 'rgba(255,255,255,0.5)',
                                borderBottom: '1px solid rgba(255,255,255,0.05)',
                                fontSize: '1.05rem', py: 1.4,
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
                    {dataRows.filter((row) => row.key !== '' && row.key != null).map((row, idx) => (
                        <TableRow key={idx} sx={{
                            '&:last-child td, &:last-child th': { border: 0 },
                            '&:hover': { bgcolor: 'rgba(122, 162, 247, 0.06)' },
                            '&:nth-of-type(even)': { bgcolor: 'rgba(255,255,255,0.015)' }
                        }}>
                            <TableCell component="th" scope="row" sx={{
                                color: '#fff',
                                borderBottom: '1px solid rgba(255,255,255,0.05)',
                                py: 1.8, pl: 2.5, pr: 0.5, fontSize: '1.1rem',
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
                                    py: 1.8, fontSize: '1.1rem'
                                }}>
                                    {row[col] || '-'}
                                </TableCell>
                            ))}
                        </TableRow>
                    ))}

                    {/* Overall Average Row for Continuous KPIs */}
                    {overallAverages && Object.keys(overallAverages).length > 0 && (
                        <TableRow>
                            <TableCell component="th" scope="row" sx={{
                                color: '#7aa2f7',
                                borderBottom: 'none', borderTop: '1px solid rgba(255,255,255,0.1)',
                                py: 1.8, pl: 2.5, pr: 0.5, fontSize: '1.1rem', fontWeight: 600
                            }}>
                                {['Gametype', 'Table minimum', 'Unused Tables'].includes(title.split(' - ')[1]) || title.includes('Gametype') ? 'Total Tables' : 'Overall Avg'}
                            </TableCell>
                            {columns.map(col => {
                                const val = overallAverages[col];
                                const isCount = ['Gametype', 'Table minimum', 'Unused Tables'].includes(title.split(' - ')[1]) || title.includes('Gametype');
                                return (
                                    <TableCell key={col} align="center" sx={{
                                        color: '#7aa2f7',
                                        borderBottom: 'none', borderTop: '1px solid rgba(255,255,255,0.1)',
                                        py: 1.8, fontSize: '1.1rem', fontWeight: 600
                                    }}>
                                        {val !== undefined && val !== null ?
                                            (isCount ? val : (
                                                // Overall Avg renders integers — no decimal point.
                                                val >= 100000 ? `${(val / 1000).toFixed(0)}k` :
                                                    val >= 10000 ? `${(val / 1000).toFixed(0)}k` :
                                                        val.toLocaleString(undefined, { maximumFractionDigits: 0 })
                                            ))
                                            : '-'}
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
