// PricingSummary — tables-by-minimum, with display + basis + comparison
// ======================================================================
//
// Dropdown A (display): MS / PM · Sub-segment · Comparison
// Dropdown B (basis):   This hour · Period avg · Day avg
//   (counts are averaged per hour and only count OPEN tables, so the three
//    bases are directly comparable.)
// When "Comparison" is chosen, the table compares the CURRENT plan against
// the historical ACTUAL minimum (prior 4 weeks, matching weekday/weekend)
// for the chosen sub-segments — showing both counts and percentages.

import React, { useState, useMemo, useEffect } from 'react';
import { Box, Stack, Typography, Select, MenuItem, Checkbox, CircularProgress } from '@mui/material';
import { formatMinimum, UNPRICED_COLOR } from '../constants/defaultTiers';
import { PRICING_FONTS } from '../constants/fontSizes';
import { fetchHourlyData } from '../../performance/utils/dataSource';
import {
    hoursForBasis, planCountsGrid, actualCountsByTier,
    datesInRangeByDow, DOW_LABELS_P, defaultDowsForDate,
} from '../utils/pricingCounts';

const GAMING_HOURS_LIST = [7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 0, 1, 2, 3, 4, 5, 6];

const SF = PRICING_FONTS.summary;
const TXT = '#dff5ff';

// date ± N days as YYYY-MM-DD (UTC-safe).
const shiftDays = (iso, n) => {
    const d = new Date(String(iso).slice(0, 10) + 'T00:00:00Z');
    if (Number.isNaN(d.getTime())) return iso;
    return new Date(d.getTime() + n * 86400000).toISOString().slice(0, 10);
};

const ctrlSx = {
    height: 30, fontSize: SF.groupToggle, fontWeight: 700, color: '#fff',
    bgcolor: 'rgba(255,255,255,0.05)', borderRadius: 1,
    '& .MuiSelect-icon': { color: 'rgba(255,255,255,0.45)' },
    '& .MuiOutlinedInput-notchedOutline': { borderColor: 'rgba(122,200,220,0.22)' },
};

const dateInputSx = {
    height: 30, fontSize: SF.groupToggle, fontWeight: 700, color: '#fff',
    bgcolor: 'rgba(255,255,255,0.05)', border: '1px solid rgba(122,200,220,0.22)',
    borderRadius: 1, px: 0.8, fontFamily: 'inherit', colorScheme: 'dark', outline: 'none',
    '&:hover': { borderColor: 'rgba(122,200,220,0.45)' },
    '&::-webkit-calendar-picker-indicator': { filter: 'invert(1)', opacity: 0.6, cursor: 'pointer' },
};

// The Summary's control choices persist in localStorage so they survive
// unmount (switching to another right-side tab and back) and reloads.
const UI_KEY = 'pricing.summaryUI';
function loadUI() {
    try { return JSON.parse(window.localStorage.getItem(UI_KEY) || '{}') || {}; } catch { return {}; }
}

export default function PricingSummary({
    tiers, store, date, openByHour, scrubHour, periodHours,
    macroByKey, macroSegments = [], subByKey, subSegments = [],
    shiftByKey, shifts = [],
    subFilter = [], minFilter = [],   // global dashboard filters
}) {
    const ui0 = useMemo(() => loadUI(), []);
    const [display, setDisplay] = useState(ui0.display || 'segment'); // 'segment' | 'sub' | 'compare'
    const [basis, setBasis] = useState(ui0.basis || 'hour');          // 'hour' | 'period' | 'multi' | 'day'
    const [multiHours, setMultiHours] = useState(ui0.multiHours || []); // hours used when basis === 'multi'
    // Historical reference window for the comparison (default: prior 4 weeks,
    // same weekday/weekend bucket as the selected date).
    const [cmpFrom, setCmpFrom] = useState(() => ui0.cmpFrom || shiftDays(date, -28));
    const [cmpTo, setCmpTo] = useState(() => ui0.cmpTo || shiftDays(date, -1));
    const [cmpDows, setCmpDows] = useState(() => ui0.cmpDows || defaultDowsForDate(date)); // 0..6
    const [cmpShifts, setCmpShifts] = useState(ui0.cmpShifts || []);  // [] = all shifts
    const [cmpSubs, setCmpSubs] = useState(ui0.cmpSubs || []);        // [] = all sub-segments

    // Persist the control choices whenever they change.
    useEffect(() => {
        try {
            window.localStorage.setItem(UI_KEY, JSON.stringify({ display, basis, multiHours, cmpFrom, cmpTo, cmpDows, cmpShifts, cmpSubs }));
        } catch { /* ignore */ }
    }, [display, basis, multiHours, cmpFrom, cmpTo, cmpDows, cmpShifts, cmpSubs]);

    const sortedTiers = useMemo(() => [...tiers].sort((a, b) => (b.min || 0) - (a.min || 0)), [tiers]);
    // Global Table-minimum filter → which tier ROWS are shown (hide the rest).
    const tiersToShow = useMemo(
        () => (minFilter.length ? sortedTiers.filter((t) => minFilter.includes(t.id)) : sortedTiers),
        [sortedTiers, minFilter]
    );
    // Global Sub-segment filter → exclude non-matching tables from the counts.
    const globalSubOk = useMemo(
        () => (subFilter.length ? (k) => subFilter.includes(subByKey.get(k)) : null),
        [subFilter, subByKey]
    );
    const hours = useMemo(() => hoursForBasis(basis, scrubHour, periodHours, multiHours), [basis, scrubHour, periodHours, multiHours]);

    // ----- Segment / Sub-segment grid (current plan) -----------------------
    const grid = useMemo(() => {
        const groupMap = display === 'segment' ? macroByKey : subByKey;
        const groups = display === 'segment' ? macroSegments : subSegments;
        if (display === 'compare' || !groupMap) return null;
        return { groups, ...planCountsGrid({ store, date, hours, openByHour, groupMap, groups, keyOk: globalSubOk, sortedTiers }) };
    }, [display, macroByKey, subByKey, macroSegments, subSegments, store, date, hours, openByHour, sortedTiers, globalSubOk]);

    // ----- Comparison (plan vs historical actual) --------------------------
    const [hourly, setHourly] = useState(null);
    const [loadingHist, setLoadingHist] = useState(false);
    useEffect(() => {
        if (display !== 'compare' || hourly) return;
        let cancelled = false;
        setLoadingHist(true);
        fetchHourlyData({}).then((rows) => { if (!cancelled) setHourly(rows || []); })
            .catch(() => { if (!cancelled) setHourly([]); })
            .finally(() => { if (!cancelled) setLoadingHist(false); });
        return () => { cancelled = true; };
    }, [display, hourly]);

    const compare = useMemo(() => {
        if (display !== 'compare') return null;
        // Combined row filter: sub-segment(s) AND shift(s).
        const subOk = cmpSubs.length === 0 ? null : (k) => cmpSubs.includes(subByKey.get(k));
        const shiftOk = (cmpShifts.length === 0 || !shiftByKey) ? null : (k) => cmpShifts.includes(shiftByKey.get(k));
        const keyOk = (!subOk && !shiftOk && !globalSubOk) ? null
            : (k) => (!subOk || subOk(k)) && (!shiftOk || shiftOk(k)) && (!globalSubOk || globalSubOk(k));
        const plan = planCountsGrid({ store, date, hours, openByHour, groupMap: subByKey, groups: [], keyOk, sortedTiers });
        // Reference dates = days within [from, to] whose weekday is selected.
        const refDates = datesInRangeByDow(cmpFrom, cmpTo, cmpDows);
        const actual = hourly
            ? actualCountsByTier({ rows: hourly, dates: refDates, hours, keyOk, sortedTiers })
            : { byTier: new Map(), total: 0 };
        return { plan, actual, refDates };
    }, [display, cmpSubs, cmpShifts, subByKey, shiftByKey, globalSubOk, store, date, hours, openByHour, sortedTiers, hourly, cmpFrom, cmpTo, cmpDows]);

    const basisLabel = { hour: 'This hour', period: 'Period avg', multi: 'Multi hours', day: 'Day avg' };
    const fmtN = (v) => (basis === 'hour' ? (v ? Math.round(v) : '-') : (v >= 0.05 ? v.toFixed(1) : '-'));
    const pct = (v, tot) => (tot > 0 ? `${Math.round((v / tot) * 100)}%` : '–');
    // Weighted-average table minimum = Σ(tier $ × table count) / total tables.
    const tierMin = useMemo(() => new Map(sortedTiers.map((t) => [t.id, t.min || 0])), [sortedTiers]);
    const wAvgFrom = (getCount, total) => {
        if (!(total > 0)) return null;
        let s = 0;
        for (const t of sortedTiers) s += (tierMin.get(t.id) || 0) * (getCount(t.id) || 0);
        return s / total;
    };
    const fmtAvg = (v) => (v == null ? '–' : formatMinimum(Math.round(v)));

    const cellSx = (strong) => ({ py: SF.rowGapY, px: 1, textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontSize: SF.cell, fontWeight: strong ? 800 : 600, color: TXT, borderBottom: '1px solid rgba(255,255,255,0.05)' });
    const headSx = { py: SF.rowGapY, px: 1, textAlign: 'right', fontSize: SF.header, fontWeight: 800, letterSpacing: 0.4, textTransform: 'uppercase', color: TXT, borderBottom: '1px solid rgba(255,255,255,0.12)' };

    return (
        <Box sx={{ p: 1.5, bgcolor: 'rgba(8, 22, 36, 0.55)', borderRadius: 2, border: '1px solid rgba(122, 200, 220, 0.12)' }}>
            {/* Header + controls */}
            <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1.2 }}>
                <Box sx={{ width: 4, height: SF.title, bgcolor: '#7adfff', borderRadius: 1 }} />
                <Typography sx={{ color: '#dff5ff', fontSize: SF.title, fontWeight: 800, letterSpacing: 0.3, lineHeight: 1 }}>Summary</Typography>
            </Stack>
            <Stack direction="row" spacing={0.8} sx={{ mb: 1.4, flexWrap: 'wrap', rowGap: 0.8 }}>
                <Select size="small" value={display} onChange={(e) => setDisplay(e.target.value)} sx={{ ...ctrlSx, minWidth: 130 }}>
                    <MenuItem value="segment" sx={{ fontSize: SF.groupToggle }}>MS / PM</MenuItem>
                    <MenuItem value="sub" sx={{ fontSize: SF.groupToggle }}>Sub-segment</MenuItem>
                    <MenuItem value="compare" sx={{ fontSize: SF.groupToggle }}>Comparison</MenuItem>
                </Select>
                <Select size="small" value={basis} onChange={(e) => setBasis(e.target.value)} sx={{ ...ctrlSx, minWidth: 120 }}>
                    <MenuItem value="hour" sx={{ fontSize: SF.groupToggle }}>This hour</MenuItem>
                    <MenuItem value="period" sx={{ fontSize: SF.groupToggle }}>Period avg</MenuItem>
                    <MenuItem value="multi" sx={{ fontSize: SF.groupToggle }}>Multi hours</MenuItem>
                    <MenuItem value="day" sx={{ fontSize: SF.groupToggle }}>Day avg</MenuItem>
                </Select>
                {/* Hour multi-select — shown when the basis is "Multi hours". */}
                {basis === 'multi' && (
                    <Select size="small" multiple displayEmpty value={multiHours} onChange={(e) => setMultiHours(e.target.value)}
                        renderValue={(s) => (s.length === 0 ? 'Pick hours' : [...s].sort((a, b) => a - b).map((h) => String(h).padStart(2, '0')).join(', '))}
                        MenuProps={{ PaperProps: { sx: { maxHeight: 320, bgcolor: 'rgba(18,22,34,0.98)', color: '#fff' } } }}
                        sx={{ ...ctrlSx, minWidth: 130, maxWidth: 230 }}>
                        {GAMING_HOURS_LIST.map((h) => (
                            <MenuItem key={h} value={h} sx={{ fontSize: SF.groupToggle, py: 0.2 }}>
                                <Checkbox checked={multiHours.includes(h)} size="small" sx={{ p: 0.4, color: 'rgba(255,255,255,0.35)', '&.Mui-checked': { color: '#7adfff' } }} />{String(h).padStart(2, '0')}:00
                            </MenuItem>
                        ))}
                    </Select>
                )}
                {display === 'compare' && (
                    <>
                        <Select size="small" multiple displayEmpty value={cmpSubs} onChange={(e) => setCmpSubs(e.target.value)}
                            renderValue={(s) => (s.length === 0 ? 'All sub-seg' : s.join(', '))}
                            sx={{ ...ctrlSx, minWidth: 130 }}>
                            {subSegments.map((s) => (
                                <MenuItem key={s} value={s} sx={{ fontSize: SF.groupToggle, py: 0.2 }}>
                                    <Checkbox checked={cmpSubs.includes(s)} size="small" sx={{ p: 0.4, color: 'rgba(255,255,255,0.35)', '&.Mui-checked': { color: '#7adfff' } }} />{s}
                                </MenuItem>
                            ))}
                        </Select>
                        {/* Shift(s) to include — the table's scheduled open window. */}
                        {shifts.length > 0 && (
                            <Select size="small" multiple displayEmpty value={cmpShifts} onChange={(e) => setCmpShifts(e.target.value)}
                                renderValue={(s) => (s.length === 0 ? 'All shifts' : s.join(', '))}
                                MenuProps={{ PaperProps: { sx: { bgcolor: 'rgba(18,22,34,0.98)', color: '#fff' } } }}
                                sx={{ ...ctrlSx, minWidth: 130, maxWidth: 240 }}>
                                {shifts.map((s) => (
                                    <MenuItem key={s} value={s} sx={{ fontSize: SF.groupToggle, py: 0.2 }}>
                                        <Checkbox checked={cmpShifts.includes(s)} size="small" sx={{ p: 0.4, color: 'rgba(255,255,255,0.35)', '&.Mui-checked': { color: '#7adfff' } }} />{s}
                                    </MenuItem>
                                ))}
                            </Select>
                        )}
                        {/* Days of week to include in the historical reference. */}
                        <Select size="small" multiple displayEmpty value={cmpDows} onChange={(e) => setCmpDows(e.target.value)}
                            renderValue={(s) => (s.length === 0 ? 'All days' : [...s].sort((a, b) => a - b).map((d) => DOW_LABELS_P[d]).join(', '))}
                            MenuProps={{ PaperProps: { sx: { bgcolor: 'rgba(18,22,34,0.98)', color: '#fff' } } }}
                            sx={{ ...ctrlSx, minWidth: 120, maxWidth: 220 }}>
                            {DOW_LABELS_P.map((lbl, d) => (
                                <MenuItem key={d} value={d} sx={{ fontSize: SF.groupToggle, py: 0.2 }}>
                                    <Checkbox checked={cmpDows.includes(d)} size="small" sx={{ p: 0.4, color: 'rgba(255,255,255,0.35)', '&.Mui-checked': { color: '#7adfff' } }} />{lbl}
                                </MenuItem>
                            ))}
                        </Select>
                        {/* Historical reference window (actuals). */}
                        <Stack direction="row" alignItems="center" spacing={0.5}>
                            <Typography sx={{ fontSize: SF.groupToggle, color: 'rgba(255,255,255,0.5)', fontWeight: 700 }}>from</Typography>
                            <Box component="input" type="date" value={cmpFrom} max={cmpTo}
                                onChange={(e) => setCmpFrom(e.target.value)} sx={dateInputSx} />
                            <Typography sx={{ fontSize: SF.groupToggle, color: 'rgba(255,255,255,0.5)', fontWeight: 700 }}>to</Typography>
                            <Box component="input" type="date" value={cmpTo} min={cmpFrom} max={date}
                                onChange={(e) => setCmpTo(e.target.value)} sx={dateInputSx} />
                        </Stack>
                    </>
                )}
            </Stack>

            {/* ---- Segment / Sub-segment grid ---- */}
            {grid && (
                <Box component="table" sx={{ width: '100%', borderCollapse: 'collapse' }}>
                    <Box component="thead">
                        <Box component="tr">
                            <Box component="th" sx={{ ...headSx, textAlign: 'left', pl: 0.5 }}>Minimum</Box>
                            {[...grid.groups, 'All'].map((s) => <Box component="th" key={s} sx={headSx}>{s}</Box>)}
                        </Box>
                    </Box>
                    <Box component="tbody">
                        {tiersToShow.map((t) => {
                            const c = grid.byTier.get(t.id) || { All: 0 };
                            const empty = !(c.All > 0.0001);
                            return (
                                <Box component="tr" key={t.id} sx={{ opacity: empty ? 0.45 : 1 }}>
                                    <Box component="td" sx={{ py: SF.rowGapY, px: 0.5, borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                                        <Stack direction="row" alignItems="center" spacing={0.8}>
                                            <Box sx={{ width: 13, height: 13, borderRadius: '3px', bgcolor: t.color, flexShrink: 0 }} />
                                            <Typography sx={{ color: TXT, fontSize: SF.tierLabel, fontWeight: 700, lineHeight: 1 }}>{t.label || formatMinimum(t.min)}</Typography>
                                        </Stack>
                                    </Box>
                                    {[...grid.groups, 'All'].map((s) => <Box component="td" key={s} sx={cellSx(s === 'All')}>{fmtN(c[s])}</Box>)}
                                </Box>
                            );
                        })}
                        {/* Open tables with NO price assigned yet. */}
                        <Box component="tr">
                            <Box component="td" sx={{ py: SF.rowGapY, px: 0.5, borderTop: '1px solid rgba(255,255,255,0.08)' }}>
                                <Stack direction="row" alignItems="center" spacing={0.8}>
                                    <Box sx={{ width: 13, height: 13, borderRadius: '3px', border: '1.5px dashed rgba(255,200,120,0.8)', flexShrink: 0 }} />
                                    <Typography sx={{ color: '#ffcd78', fontSize: SF.tierLabel, fontWeight: 700, lineHeight: 1 }}>Unassigned</Typography>
                                </Stack>
                            </Box>
                            {[...grid.groups, 'All'].map((s) => (
                                <Box component="td" key={s} sx={{ ...cellSx(s === 'All'), color: '#ffcd78', borderTop: '1px solid rgba(255,255,255,0.08)' }}>
                                    {fmtN(grid.unassigned[s])}
                                </Box>
                            ))}
                        </Box>
                        <Box component="tr">
                            <Box component="td" sx={{ py: SF.rowGapY + 0.2, px: 0.5, borderTop: '1px solid rgba(255,255,255,0.15)' }}>
                                <Typography sx={{ color: TXT, fontSize: SF.total, fontWeight: 800 }}>Total open</Typography>
                            </Box>
                            {[...grid.groups, 'All'].map((s) => (
                                <Box component="td" key={s} sx={{ py: SF.rowGapY + 0.2, px: 1, textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontSize: SF.total, fontWeight: 800, color: TXT, borderTop: '1px solid rgba(255,255,255,0.15)' }}>
                                    {fmtN((grid.totals[s] || 0) + (grid.unassigned[s] || 0))}
                                </Box>
                            ))}
                        </Box>
                        <Box component="tr">
                            <Box component="td" sx={{ py: SF.rowGapY, px: 0.5 }}>
                                <Typography sx={{ color: 'rgba(220,245,255,0.75)', fontSize: SF.header, fontWeight: 700 }}>Wtd avg min</Typography>
                            </Box>
                            {[...grid.groups, 'All'].map((s) => (
                                <Box component="td" key={s} sx={{ py: SF.rowGapY, px: 1, textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontSize: SF.cell, fontWeight: 800, color: '#7adfff' }}>
                                    {fmtAvg(wAvgFrom((id) => grid.byTier.get(id)?.[s], grid.totals[s]))}
                                </Box>
                            ))}
                        </Box>
                    </Box>
                </Box>
            )}

            {/* ---- Comparison: current plan vs historical actual ---- */}
            {display === 'compare' && compare && (
                loadingHist && !hourly ? (
                    <Stack alignItems="center" sx={{ py: 4 }}><CircularProgress size={22} sx={{ color: '#7adfff' }} /></Stack>
                ) : (
                    <>
                        <Typography sx={{ color: 'rgba(255,255,255,0.5)', fontSize: SF.header, mb: 0.8 }}>
                            Plan vs actual · {basisLabel[basis]} · {cmpFrom} → {cmpTo} ({compare.refDates.length} matching days)
                        </Typography>
                        <Box component="table" sx={{ width: '100%', borderCollapse: 'collapse' }}>
                            <Box component="thead">
                                <Box component="tr">
                                    <Box component="th" sx={{ ...headSx, textAlign: 'left', pl: 0.5 }}>Minimum</Box>
                                    <Box component="th" sx={{ ...headSx, color: '#7adfff' }}>Plan</Box>
                                    <Box component="th" sx={headSx}>%</Box>
                                    <Box component="th" sx={{ ...headSx, color: '#9ece6a' }}>Actual</Box>
                                    <Box component="th" sx={headSx}>%</Box>
                                </Box>
                            </Box>
                            <Box component="tbody">
                                {tiersToShow.map((t) => {
                                    const pl = compare.plan.byTier.get(t.id)?.All || 0;
                                    const ac = compare.actual.byTier.get(t.id) || 0;
                                    const empty = !(pl > 0.0001 || ac > 0.0001);
                                    return (
                                        <Box component="tr" key={t.id} sx={{ opacity: empty ? 0.4 : 1 }}>
                                            <Box component="td" sx={{ py: SF.rowGapY, px: 0.5, borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                                                <Stack direction="row" alignItems="center" spacing={0.8}>
                                                    <Box sx={{ width: 13, height: 13, borderRadius: '3px', bgcolor: t.color, flexShrink: 0 }} />
                                                    <Typography sx={{ color: TXT, fontSize: SF.tierLabel, fontWeight: 700, lineHeight: 1 }}>{t.label || formatMinimum(t.min)}</Typography>
                                                </Stack>
                                            </Box>
                                            <Box component="td" sx={{ ...cellSx(true), color: '#7adfff' }}>{fmtN(pl)}</Box>
                                            <Box component="td" sx={cellSx(false)}>{pct(pl, compare.plan.totals.All)}</Box>
                                            <Box component="td" sx={{ ...cellSx(true), color: '#9ece6a' }}>{fmtN(ac)}</Box>
                                            <Box component="td" sx={cellSx(false)}>{pct(ac, compare.actual.total)}</Box>
                                        </Box>
                                    );
                                })}
                                <Box component="tr">
                                    <Box component="td" sx={{ py: SF.rowGapY + 0.2, px: 0.5, borderTop: '1px solid rgba(255,255,255,0.15)' }}>
                                        <Typography sx={{ color: TXT, fontSize: SF.total, fontWeight: 800 }}>Total open</Typography>
                                    </Box>
                                    <Box component="td" sx={{ ...cellSx(true), color: '#7adfff', borderTop: '1px solid rgba(255,255,255,0.15)', fontSize: SF.total }}>{fmtN(compare.plan.totals.All)}</Box>
                                    <Box component="td" sx={{ ...cellSx(false), borderTop: '1px solid rgba(255,255,255,0.15)' }}>100%</Box>
                                    <Box component="td" sx={{ ...cellSx(true), color: '#9ece6a', borderTop: '1px solid rgba(255,255,255,0.15)', fontSize: SF.total }}>{fmtN(compare.actual.total)}</Box>
                                    <Box component="td" sx={{ ...cellSx(false), borderTop: '1px solid rgba(255,255,255,0.15)' }}>100%</Box>
                                </Box>
                                <Box component="tr">
                                    <Box component="td" sx={{ py: SF.rowGapY, px: 0.5 }}>
                                        <Typography sx={{ color: 'rgba(220,245,255,0.75)', fontSize: SF.header, fontWeight: 700 }}>Wtd avg min</Typography>
                                    </Box>
                                    <Box component="td" colSpan={2} sx={{ ...cellSx(true), color: '#7adfff', borderBottom: 'none' }}>{fmtAvg(wAvgFrom((id) => compare.plan.byTier.get(id)?.All, compare.plan.totals.All))}</Box>
                                    <Box component="td" colSpan={2} sx={{ ...cellSx(true), color: '#9ece6a', borderBottom: 'none' }}>{fmtAvg(wAvgFrom((id) => compare.actual.byTier.get(id), compare.actual.total))}</Box>
                                </Box>
                            </Box>
                        </Box>
                        <Stack direction="row" spacing={1.5} sx={{ mt: 1, px: 0.5 }}>
                            <Stack direction="row" alignItems="center" spacing={0.5}><Box sx={{ width: 11, height: 11, borderRadius: '2px', bgcolor: '#7adfff' }} /><Typography sx={{ fontSize: 12, color: 'rgba(255,255,255,0.6)' }}>Current plan</Typography></Stack>
                            <Stack direction="row" alignItems="center" spacing={0.5}><Box sx={{ width: 11, height: 11, borderRadius: '2px', bgcolor: '#9ece6a' }} /><Typography sx={{ fontSize: 12, color: 'rgba(255,255,255,0.6)' }}>Historical actual</Typography></Stack>
                        </Stack>
                    </>
                )
            )}

            {/* Unpriced label removed — counts are over OPEN tables only. */}
            <Typography sx={{ color: 'rgba(255,255,255,0.4)', fontSize: 12, mt: 1, px: 0.5 }}>
                {UNPRICED_COLOR ? '' : ''}Counts = scheduled-open tables{basis !== 'hour' ? ', averaged per hour' : ''}.
            </Typography>
        </Box>
    );
}
