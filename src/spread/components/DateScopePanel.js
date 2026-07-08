// DateScopePanel → "Copy to Other Dates"
// =======================================
//
// Focused tool for fanning the current date's schedule out to other
// dates. Selection is done on an interactive month calendar (click a
// day to toggle it into the destination set) instead of typing ISO
// dates. The calendar marks:
//   • the SOURCE date (the date being copied FROM) — ringed, not
//     selectable
//   • dates that ALREADY have a saved schedule — small dot, so the
//     user knows a copy will add a new version there
//   • the dates currently picked as destinations — accent fill

import React, { useState, useMemo } from 'react';
import { Box, Stack, Typography, Button, Chip, IconButton, Tooltip } from '@mui/material';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import EventIcon from '@mui/icons-material/Event';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import dayjs from 'dayjs';

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

function prettyDate(iso) {
    if (!iso || iso.length < 10) return iso || '';
    const m = parseInt(iso.slice(5, 7), 10);
    const d = parseInt(iso.slice(8, 10), 10);
    const y = iso.slice(0, 4);
    if (!m || !d) return iso;
    return `${MONTHS[m - 1]} ${d}, ${y}`;
}

export default function DateScopePanel({
    targetDate,
    onApplyToDates,        // (dates: string[]) => void
    assignmentCount,
    availableDates = [],   // string[] — ISO dates that already have schedules
    // Per-date summary from the loaded spread rows —
    //   Map<isoDate, { openHours: number, openTables: number }>
    // Rendered inside each calendar cell (no coverage bar per user preference).
    dateSummary = null,
    // setTargetDate intentionally no longer used here (the header owns
    // date selection); kept in the signature so the parent's prop list
    // doesn't need to change.
}) {
    const [extraDates, setExtraDates] = useState([]);
    // Calendar starts on the source date's month (falls back to today).
    const [viewMonth, setViewMonth] = useState(() =>
        dayjs(targetDate || undefined).startOf('month')
    );

    const scheduledSet = useMemo(() => new Set(availableDates), [availableDates]);
    const selectedSet  = useMemo(() => new Set(extraDates), [extraDates]);

    const toggleDate = (iso) => {
        if (iso === targetDate) return; // can't copy onto itself
        setExtraDates((prev) =>
            prev.includes(iso) ? prev.filter((d) => d !== iso) : [...prev, iso].sort()
        );
    };
    const removeExtra = (d) => setExtraDates(extraDates.filter((x) => x !== d));
    const applyNow = () => {
        if (extraDates.length === 0) return;
        onApplyToDates(extraDates);
        setExtraDates([]);
    };

    const nothingToCopy = !assignmentCount || assignmentCount === 0;

    // Build the 6×7 day grid for the viewed month.
    const grid = useMemo(() => {
        const firstOfMonth = viewMonth.startOf('month');
        const gridStart = firstOfMonth.subtract(firstOfMonth.day(), 'day'); // back to Sunday
        return Array.from({ length: 42 }, (_, i) => {
            const d = gridStart.add(i, 'day');
            return {
                iso: d.format('YYYY-MM-DD'),
                dayNum: d.date(),
                inMonth: d.month() === viewMonth.month(),
            };
        });
    }, [viewMonth]);

    return (
        <Box sx={{
            p: 1.5,
            bgcolor: 'rgba(8, 22, 36, 0.55)',
            borderRadius: 2,
            border: '1px solid rgba(122, 200, 220, 0.12)',
            fontVariantNumeric: 'tabular-nums',
        }}>
            {/* Header */}
            <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 0.6 }}>
                <Box sx={{ width: 4, height: 18, bgcolor: '#7adfff', borderRadius: 1 }} />
                <Typography sx={{ color: '#dff5ff', fontSize: 16, fontWeight: 700, letterSpacing: 0.4 }}>
                    Copy to Other Dates
                </Typography>
            </Stack>

            {/* Source summary */}
            <Stack direction="row" alignItems="center" spacing={0.8} sx={{ mb: 1.2 }}>
                <EventIcon sx={{ color: 'rgba(255,255,255,0.4)', fontSize: 16 }} />
                <Typography sx={{ color: 'rgba(255,255,255,0.6)', fontSize: 13 }}>
                    From <b style={{ color: '#dff5ff' }}>{prettyDate(targetDate)}</b>
                    {nothingToCopy
                        ? ' — nothing assigned yet'
                        : ` · ${assignmentCount} table${assignmentCount === 1 ? '' : 's'}`}
                </Typography>
            </Stack>

            {/* Calendar always renders (functions as a monthly schedule
                overview). The Copy button is disabled until this date has
                assignments, so the "no assignments" note lives on the
                button, not gating the calendar. */}
            {nothingToCopy && (
                <Box sx={{
                    p: 1, mb: 1, borderRadius: 1.2,
                    bgcolor: 'rgba(255,255,255,0.02)',
                    border: '1px dashed rgba(255,255,255,0.1)',
                    color: 'rgba(255,255,255,0.45)', fontSize: 12,
                }}>
                    No assignments on this date yet — the calendar is browsable, but the Copy button is disabled until you assign at least one table.
                </Box>
            )}

                    {/* Month navigator */}
                    <Stack direction="row" alignItems="center" sx={{ mb: 0.8 }}>
                        <IconButton
                            size="small"
                            onClick={() => setViewMonth((m) => m.subtract(1, 'month'))}
                            sx={{ color: 'rgba(255,255,255,0.6)', '&:hover': { color: '#7adfff' } }}
                        >
                            <ChevronLeftIcon fontSize="small" />
                        </IconButton>
                        <Typography sx={{
                            flex: 1, textAlign: 'center',
                            color: '#dff5ff', fontSize: 17, fontWeight: 700,
                        }}>
                            {MONTHS[viewMonth.month()]} {viewMonth.year()}
                        </Typography>
                        <IconButton
                            size="small"
                            onClick={() => setViewMonth((m) => m.add(1, 'month'))}
                            sx={{ color: 'rgba(255,255,255,0.6)', '&:hover': { color: '#7adfff' } }}
                        >
                            <ChevronRightIcon fontSize="small" />
                        </IconButton>
                    </Stack>

                    {/* Weekday header */}
                    <Box sx={{
                        display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)',
                        gap: 0.4, mb: 0.4,
                    }}>
                        {WEEKDAYS.map((w, i) => (
                            <Typography key={i} sx={{
                                textAlign: 'center', color: 'rgba(255,255,255,0.45)',
                                fontSize: 15, fontWeight: 700,
                            }}>
                                {w}
                            </Typography>
                        ))}
                    </Box>

                    {/* Day grid — full panel width; cells are slightly
                        shorter than square (see DayCell aspectRatio). */}
                    <Box sx={{
                        display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)',
                        gap: 0.4, mb: 1.2,
                    }}>
                        {grid.map((cell) => {
                            const isSource    = cell.iso === targetDate;
                            const isSelected  = selectedSet.has(cell.iso);
                            const isScheduled = scheduledSet.has(cell.iso) && !isSource;
                            const summary     = dateSummary ? dateSummary.get(cell.iso) : null;
                            return (
                                <DayCell
                                    key={cell.iso}
                                    cell={cell}
                                    summary={summary}
                                    isSource={isSource}
                                    isSelected={isSelected}
                                    isScheduled={isScheduled}
                                    onClick={() => toggleDate(cell.iso)}
                                />
                            );
                        })}
                    </Box>

                    {/* Legend */}
                    <Stack direction="row" spacing={1.4} sx={{ mb: 1.2, px: 0.4, flexWrap: 'wrap', rowGap: 0.4 }}>
                        <LegendDot color="#7adfff" label="Selected" filled />
                        <LegendDot color="#7adfff" label="Source" ring />
                        <LegendDot color="rgba(247,181,0,0.95)" label="Has spread" pill />
                    </Stack>

                    {/* Selected destination chips */}
                    {extraDates.length > 0 && (
                        <Stack direction="row" spacing={0.5} sx={{ flexWrap: 'wrap', rowGap: 0.5, mb: 1.2 }}>
                            {extraDates.map((d) => (
                                <Chip
                                    key={d}
                                    label={prettyDate(d).replace(/, \d{4}$/, '')}
                                    size="small"
                                    onDelete={() => removeExtra(d)}
                                    sx={{
                                        fontSize: 12,
                                        bgcolor: 'rgba(122,223,255,0.1)',
                                        color: '#dff5ff',
                                        border: '1px solid rgba(122,223,255,0.3)',
                                        '& .MuiChip-deleteIcon': { color: 'rgba(255,255,255,0.5)', '&:hover': { color: '#f7768e' } },
                                    }}
                                />
                            ))}
                        </Stack>
                    )}

                    {/* Apply */}
                    <Button
                        onClick={applyNow}
                        disabled={extraDates.length === 0}
                        fullWidth
                        startIcon={<ContentCopyIcon sx={{ fontSize: 16 }} />}
                        sx={{
                            textTransform: 'none', fontSize: 14, fontWeight: 700,
                            bgcolor: extraDates.length > 0 ? '#7adfff' : 'rgba(255,255,255,0.05)',
                            color: extraDates.length > 0 ? '#0a1a2c' : 'rgba(255,255,255,0.3)',
                            '&:hover': { bgcolor: extraDates.length > 0 ? '#a0e8ff' : 'rgba(255,255,255,0.05)' },
                            '&.Mui-disabled': { bgcolor: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.3)' },
                        }}
                    >
                        {extraDates.length === 0
                            ? 'Pick dates on the calendar'
                            : `Copy to ${extraDates.length} date${extraDates.length === 1 ? '' : 's'}`}
                    </Button>
        </Box>
    );
}

function DayCell({ cell, summary, isSource, isSelected, isScheduled, onClick }) {
    const base = {
        position: 'relative',
        // Slightly taller cells now (aspect ~1:0.9) so the per-date
        // hours + table-count summary can render below the day number
        // without cramping. When there's a summary we go a bit taller.
        aspectRatio: summary ? '1 / 0.95' : '1 / 0.76',
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        borderRadius: 1,
        cursor: isSource ? 'default' : 'pointer',
        userSelect: 'none',
        transition: 'background-color 120ms, border-color 120ms',
    };

    let style;
    if (isSource) {
        style = {
            color: '#7adfff',
            bgcolor: 'transparent',
            border: '1.5px solid #7adfff',
            opacity: cell.inMonth ? 1 : 0.4,
        };
    } else if (isSelected) {
        style = {
            color: '#0a1a2c',
            bgcolor: '#7adfff',
            border: '1.5px solid #7adfff',
            '&:hover': { bgcolor: '#a0e8ff' },
        };
    } else {
        style = {
            color: cell.inMonth ? 'rgba(255,255,255,0.85)' : 'rgba(255,255,255,0.25)',
            bgcolor: 'rgba(255,255,255,0.02)',
            border: '1.5px solid transparent',
            '&:hover': { bgcolor: 'rgba(122,223,255,0.12)', borderColor: 'rgba(122,223,255,0.4)' },
        };
    }

    // "spread" marker shown UNDER the day number for dates that already
    // carry a schedule — a small amber pill so the operator can read at
    // a glance which days will receive an additional version on copy.
    const markerColor = isSelected ? 'rgba(10,26,44,0.65)' : 'rgba(247,181,0,0.95)';

    // Two compact stats per cell (open-hours and open-tables) — derived
    // upstream from the pre-loaded spreadRows so no extra fetch is needed.
    const statColor = isSelected ? 'rgba(10,26,44,0.75)' : 'rgba(255,255,255,0.6)';
    const statStrong = isSelected ? '#0a1a2c' : '#dff5ff';

    const cellEl = (
        <Box onClick={onClick} sx={{ ...base, ...style }}>
            <Box sx={{ fontSize: 16, fontWeight: 700, lineHeight: 1 }}>
                {cell.dayNum}
            </Box>
            {summary ? (
                <Stack spacing={0.1} sx={{ mt: 0.3, alignItems: 'center' }}>
                    <Box sx={{ fontSize: 10.5, fontWeight: 800, lineHeight: 1.05, color: statStrong, fontVariantNumeric: 'tabular-nums' }}>
                        {summary.openHours}h
                    </Box>
                    <Box sx={{ fontSize: 9.5, fontWeight: 700, lineHeight: 1.05, color: statColor, fontVariantNumeric: 'tabular-nums' }}>
                        {summary.openTables}t
                    </Box>
                </Stack>
            ) : isScheduled ? (
                <Box sx={{
                    mt: 0.4,
                    px: 0.5, height: 12, minWidth: 18,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    borderRadius: 2,
                    bgcolor: markerColor,
                    fontSize: 8, fontWeight: 800, letterSpacing: 0.3,
                    color: isSelected ? '#7adfff' : '#1a1304',
                    textTransform: 'uppercase',
                }}>
                    spread
                </Box>
            ) : (
                // Reserve the marker row so numbers stay vertically
                // centered whether or not a marker is present.
                <Box sx={{ mt: 0.4, height: 12 }} />
            )}
        </Box>
    );

    // Tooltip text combines source/schedule state with the per-date summary
    // so the operator sees the raw numbers on hover.
    const summaryText = summary ? ` · ${summary.openHours} open-hours · ${summary.openTables} tables` : '';
    if (isSource) {
        return <Tooltip title={`${cell.iso} · Source date (can't copy onto itself)${summaryText}`}>{cellEl}</Tooltip>;
    }
    if (isScheduled) {
        return <Tooltip title={`${cell.iso} · Already has a schedule — copy adds a new version${summaryText}`}>{cellEl}</Tooltip>;
    }
    if (summary) {
        return <Tooltip title={`${cell.iso}${summaryText}`}>{cellEl}</Tooltip>;
    }
    return cellEl;
}

function LegendDot({ color, label, filled, ring, pill }) {
    return (
        <Stack direction="row" alignItems="center" spacing={0.7}>
            {pill ? (
                <Box sx={{
                    px: 0.6, height: 14, minWidth: 22,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    borderRadius: 2, bgcolor: color,
                    fontSize: 9, fontWeight: 800, color: '#1a1304', textTransform: 'uppercase',
                }}>
                    spread
                </Box>
            ) : (
                <Box sx={{
                    width: 16, height: 16, borderRadius: 0.6,
                    bgcolor: filled ? color : 'transparent',
                    border: ring ? `2px solid ${color}` : '1px solid rgba(255,255,255,0.12)',
                }} />
            )}
            <Typography sx={{ color: 'rgba(255,255,255,0.75)', fontSize: 18, fontWeight: 600 }}>{label}</Typography>
        </Stack>
    );
}
