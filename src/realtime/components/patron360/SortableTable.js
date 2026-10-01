// Sortable table for the Player 360 levels. Every header is a button:
// click sorts by that column, click again reverses. Optional grouped
// header row above. Rows can open on click / Enter; controls inside a
// row (checkboxes, buttons, [data-stop]) don't trigger the row.

import React from 'react';
import { Box } from '@mui/material';
import { TEXT, ACCENT, systemLabel } from '../../constants/rtTheme';

export function nextSort(sort, key, firstDir) {
    return sort.key === key ? { key, dir: -sort.dir } : { key, dir: firstDir ?? -1 };
}

const cellPad = (c) => ({ px: 1, ...(c.gap ? { pl: 2 } : null) });
const isControl = (el) => !!el.closest('input, button, a, [data-stop]');

export default function SortableTable({
    columns, groups, rows, rowKey, sort, onSort, onRowClick, rowLabel, minWidth = 0, ariaLabel,
}) {
    const header = (c) => {
        const active = sort && sort.key === c.key;
        const arrow = active ? (sort.dir > 0 ? '▲' : '▼') : '▲▼';
        const align = c.align || 'right';
        return (
            <Box
                component="th"
                key={c.key}
                title={c.title}
                aria-sort={c.sortable === false ? undefined : active ? (sort.dir > 0 ? 'ascending' : 'descending') : 'none'}
                sx={{ ...systemLabel, ...cellPad(c), py: 0.5, textAlign: align, verticalAlign: 'bottom', lineHeight: 1.25, maxWidth: c.maxWidth || 150, width: c.width }}
            >
                {c.sortable === false ? c.label : (
                    <Box
                        component="button"
                        type="button"
                        onClick={() => onSort(nextSort(sort, c.key, c.firstDir))}
                        sx={{
                            all: 'unset', cursor: 'pointer', display: 'inline-flex', alignItems: 'flex-end', gap: 0.5,
                            justifyContent: align === 'left' ? 'flex-start' : 'flex-end',
                            color: active ? ACCENT : 'inherit', textAlign: align,
                            '&:hover': { color: active ? ACCENT : TEXT.primary },
                            '&:focus-visible': { outline: `2px solid ${ACCENT}`, outlineOffset: 2, borderRadius: 0.5 },
                        }}
                    >
                        <span>{c.label}</span>
                        <Box component="span" aria-hidden="true" sx={{ fontSize: 9, opacity: active ? 1 : 0.35, flexShrink: 0 }}>{arrow}</Box>
                    </Box>
                )}
            </Box>
        );
    };

    return (
        <Box sx={{ overflowX: 'auto' }}>
            <Box component="table" aria-label={ariaLabel} sx={{ width: '100%', minWidth, borderCollapse: 'separate', borderSpacing: '0 4px' }}>
                <thead>
                    {groups ? (
                        <tr>
                            {groups.map((g, i) => (
                                <Box component="th" key={i} colSpan={g.span} sx={{ ...systemLabel, px: 1, pl: g.gap ? 2 : 1, pb: 0.25, textAlign: 'center' }}>
                                    {g.label ? (
                                        <Box component="span" sx={{ display: 'block', color: TEXT.secondary, borderBottom: '1px solid rgba(122,162,247,0.35)', pb: 0.4 }}>{g.label}</Box>
                                    ) : null}
                                </Box>
                            ))}
                        </tr>
                    ) : null}
                    <tr>{columns.map(header)}</tr>
                </thead>
                <tbody>
                    {rows.map((r) => {
                        const open = onRowClick ? () => onRowClick(r) : null;
                        return (
                            <Box
                                component="tr"
                                key={rowKey(r)}
                                tabIndex={open ? 0 : undefined}
                                aria-label={open && rowLabel ? rowLabel(r) : undefined}
                                onClick={open ? (e) => { if (!isControl(e.target)) open(); } : undefined}
                                onKeyDown={open ? (e) => { if ((e.key === 'Enter' || e.key === ' ') && !isControl(e.target)) { e.preventDefault(); open(); } } : undefined}
                                sx={{
                                    cursor: open ? 'pointer' : 'default',
                                    '& > td': { bgcolor: 'rgba(255,255,255,0.025)', transition: 'background-color 120ms' },
                                    '& > td:first-of-type': { borderRadius: '8px 0 0 8px' },
                                    '& > td:last-of-type': { borderRadius: '0 8px 8px 0' },
                                    ...(open ? {
                                        '&:hover > td': { bgcolor: 'rgba(122,162,247,0.10)' },
                                        '&:focus-visible': { outline: 'none' },
                                        '&:focus-visible > td': { bgcolor: 'rgba(122,162,247,0.16)' },
                                    } : null),
                                }}
                            >
                                {columns.map((c) => (
                                    <Box component="td" key={c.key} sx={{
                                        ...cellPad(c), py: 1, textAlign: c.align || 'right', whiteSpace: 'nowrap',
                                        fontSize: 13, color: TEXT.primary, fontVariantNumeric: 'tabular-nums', width: c.width,
                                    }}>
                                        {c.render(r)}
                                    </Box>
                                ))}
                            </Box>
                        );
                    })}
                </tbody>
            </Box>
        </Box>
    );
}
