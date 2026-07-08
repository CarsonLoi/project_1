// HistoryComparePanel — plan coverage vs prior-N-weeks historical actual
// =====================================================================
//
// Right-panel tab that lets the operator sanity-check the CURRENT plan
// against how the floor has ACTUALLY been scheduled over a chosen
// reference window (from/to date range + optional day-of-week filter).
// Both sides show the same coverage metrics (open-hours, open-tables,
// open-hours per table) so variance is directly comparable.
//
// Data source: the same `spreadRows` the dashboard already fetched on
// mount (no extra network). Historical stats are AVERAGED across matching
// dates so the numbers stay comparable to the single-date plan.

import React, { useMemo, useState } from 'react';
import { Box, Stack, Typography, Select, MenuItem, Checkbox } from '@mui/material';

const A_COLOR = '#7adfff'; // current plan
const B_COLOR = '#f7b955'; // historical actual
const TXT = '#dff5ff';

const DOW_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// date ± N days as YYYY-MM-DD (UTC-safe).
function shiftDays(iso, n) {
    const d = new Date(String(iso).slice(0, 10) + 'T00:00:00Z');
    if (Number.isNaN(d.getTime())) return iso;
    return new Date(d.getTime() + n * 86400000).toISOString().slice(0, 10);
}
// Weekday (0..6) of an ISO date, UTC.
function dowOfIso(iso) {
    const d = new Date(String(iso).slice(0, 10) + 'T00:00:00Z');
    return Number.isNaN(d.getTime()) ? null : d.getUTCDay();
}
// Weekday/weekend bucket the given date belongs to (default DoW filter).
function defaultDowsForDate(iso) {
    const d = dowOfIso(iso);
    if (d == null) return [1, 2, 3, 4, 5];
    return [0, 6].includes(d) ? [0, 6] : [1, 2, 3, 4, 5];
}

const ctrlSx = {
    height: 32, fontSize: 13, fontWeight: 700, color: '#fff',
    bgcolor: 'rgba(255,255,255,0.05)', borderRadius: 1,
    '& .MuiSelect-icon': { color: 'rgba(255,255,255,0.45)' },
    '& .MuiOutlinedInput-notchedOutline': { borderColor: 'rgba(122,200,220,0.22)' },
};
const dateInputSx = {
    height: 32, fontSize: 13, fontWeight: 700, color: '#fff',
    bgcolor: 'rgba(255,255,255,0.05)', border: '1px solid rgba(122,200,220,0.22)',
    borderRadius: 1, px: 0.8, fontFamily: 'inherit', colorScheme: 'dark', outline: 'none',
    '&:hover': { borderColor: 'rgba(122,200,220,0.45)' },
    '&::-webkit-calendar-picker-indicator': { filter: 'invert(1)', opacity: 0.6, cursor: 'pointer' },
};

// Aggregate coverage stats from spread rows in one pass, optionally
// filtered by a sub-segment set. Returns { dates, openHours, openTables }
// per-date, plus averaged totals.
//   openHours   = spread=1 rows count for the date
//   openTables  = distinct tables open at least once that date
function statsFor(rows, { dateSet, subOk, subByKey } = {}) {
    const perDate = new Map();
    for (const r of rows || []) {
        if (Number(r.spread) !== 1) continue;
        const d = String(r.date).slice(0, 10);
        if (dateSet && !dateSet.has(d)) continue;
        const key = String(r.gametype ?? '') + '|' + String(r.table ?? '');
        if (subOk && subByKey) {
            const seg = subByKey.get(key);
            if (!subOk(seg)) continue;
        }
        let e = perDate.get(d);
        if (!e) { e = { openHours: 0, tables: new Set() }; perDate.set(d, e); }
        e.openHours += 1;
        e.tables.add(key);
    }
    const days = perDate.size || 1;
    let sumHours = 0, sumTables = 0;
    for (const e of perDate.values()) { sumHours += e.openHours; sumTables += e.tables.size; }
    return {
        dates: [...perDate.keys()].sort(),
        totalOpenHours: sumHours,
        totalOpenTables: sumTables,
        avgOpenHoursPerDay: sumHours / days,
        avgOpenTablesPerDay: sumTables / days,
    };
}

export default function HistoryComparePanel({
    spreadRows = [],
    targetDate,
    // Reference floor (assumed to have `.sub_segment` per table). Used to
    // filter historical rows by sub-seg when the user picks one.
    tables = [],
    // Optional pre-filter from the global slicers (already applied to the
    // Coverage report). Passed through so this panel stays in sync.
    subSegments = [],
}) {
    const [from, setFrom] = useState(() => shiftDays(targetDate, -28));
    const [to,   setTo]   = useState(() => shiftDays(targetDate, -1));
    const [dows, setDows] = useState(() => defaultDowsForDate(targetDate));
    const [subs, setSubs] = useState([]);

    const subByKey = useMemo(() => {
        const m = new Map();
        for (const t of tables) m.set(t.key, t.sub_segment);
        return m;
    }, [tables]);
    const subOk = useMemo(
        () => (subs.length === 0 ? null : (seg) => subs.includes(seg)),
        [subs]
    );

    // Reference dates within [from, to] whose DoW is in `dows`.
    const refDates = useMemo(() => {
        if (!from || !to) return [];
        const out = [];
        let cur = new Date(String(from).slice(0, 10) + 'T00:00:00Z');
        const end = new Date(String(to).slice(0, 10) + 'T00:00:00Z');
        if ([cur, end].some((d) => Number.isNaN(d.getTime())) || cur > end) return [];
        const set = dows.length ? new Set(dows) : null;
        for (; cur.getTime() <= end.getTime(); cur = new Date(cur.getTime() + 86400000)) {
            if (!set || set.has(cur.getUTCDay())) out.push(cur.toISOString().slice(0, 10));
        }
        return out;
    }, [from, to, dows]);

    // Plan = spreadRows for the current targetDate (raw actual, since v0 IS
    // the DB baseline; if the operator has an in-progress edit that's not
    // saved back to the DB, this reads the last snapshot — the intent of
    // this panel is a HISTORICAL check, not a diff of unsaved edits).
    const plan = useMemo(
        () => statsFor(spreadRows, { dateSet: new Set([targetDate]), subOk, subByKey }),
        [spreadRows, targetDate, subOk, subByKey]
    );
    const hist = useMemo(
        () => statsFor(spreadRows, { dateSet: new Set(refDates), subOk, subByKey }),
        [spreadRows, refDates, subOk, subByKey]
    );

    const fmt = (v) => (v == null || !Number.isFinite(v) ? '–' : v >= 1000 ? Math.round(v).toLocaleString() : v.toFixed(v >= 10 ? 0 : 1));
    const varColor = (n) => (n > 0 ? '#6ad08f' : (n < 0 ? '#f76d6d' : 'rgba(255,255,255,0.5)'));
    const delta = (a, b) => {
        if (!Number.isFinite(a) || !Number.isFinite(b)) return { d: null, pct: null };
        const d = a - b;
        const pct = b > 0 ? (d / b) * 100 : (a > 0 ? Infinity : 0);
        return { d, pct };
    };
    const fmtDelta = (n) => (n == null ? '–' : (n === 0 ? '0' : (n > 0 ? `+${fmt(n)}` : `−${fmt(Math.abs(n))}`)));
    const fmtPct = (v) => (v == null ? '–' : v === Infinity ? 'new' : (v > 0 ? `+${Math.round(v)}%` : `${Math.round(v)}%`));

    const rows = [
        { label: 'Open-hours / day',   a: plan.avgOpenHoursPerDay,   b: hist.avgOpenHoursPerDay },
        { label: 'Open-tables / day',  a: plan.avgOpenTablesPerDay,  b: hist.avgOpenTablesPerDay },
        { label: 'Hours per table',    a: plan.avgOpenTablesPerDay > 0 ? plan.avgOpenHoursPerDay / plan.avgOpenTablesPerDay : 0,
                                        b: hist.avgOpenTablesPerDay > 0 ? hist.avgOpenHoursPerDay / hist.avgOpenTablesPerDay : 0 },
    ];

    return (
        <Box sx={{ p: 1.5, bgcolor: 'rgba(8,22,36,0.55)', borderRadius: 2, border: '1px solid rgba(122,200,220,0.12)' }}>
            <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 0.6 }}>
                <Box sx={{ width: 4, height: 20, bgcolor: A_COLOR, borderRadius: 1 }} />
                <Typography sx={{ color: TXT, fontSize: 18, fontWeight: 800, lineHeight: 1 }}>History compare</Typography>
            </Stack>
            <Typography sx={{ color: 'rgba(255,255,255,0.5)', fontSize: 12, mb: 1.2 }}>
                <b style={{ color: A_COLOR }}>Plan</b> = {targetDate || '—'} · <b style={{ color: B_COLOR }}>Actual</b> = last {refDates.length || 0} day{refDates.length === 1 ? '' : 's'} matching the filters below (spread DB, one pass).
            </Typography>

            {/* Filter controls */}
            <Stack direction="row" spacing={1} sx={{ mb: 1.4, flexWrap: 'wrap', rowGap: 0.8, alignItems: 'center' }}>
                <Typography sx={{ fontSize: 11, fontWeight: 800, letterSpacing: 0.4, color: 'rgba(255,255,255,0.55)' }}>FROM</Typography>
                <Box component="input" type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} sx={dateInputSx} />
                <Typography sx={{ fontSize: 11, fontWeight: 800, letterSpacing: 0.4, color: 'rgba(255,255,255,0.55)' }}>TO</Typography>
                <Box component="input" type="date" value={to} min={from} max={targetDate} onChange={(e) => setTo(e.target.value)} sx={dateInputSx} />
                <Select size="small" multiple displayEmpty value={dows} onChange={(e) => setDows(e.target.value)}
                    renderValue={(s) => (s.length === 0 ? 'All days' : [...s].sort((a, b) => a - b).map((d) => DOW_LABELS[d]).join(', '))}
                    MenuProps={{ PaperProps: { sx: { bgcolor: 'rgba(18,22,34,0.98)', color: '#fff' } } }}
                    sx={{ ...ctrlSx, minWidth: 140 }}>
                    {DOW_LABELS.map((lbl, d) => (
                        <MenuItem key={d} value={d} sx={{ fontSize: 13, py: 0.2 }}>
                            <Checkbox checked={dows.includes(d)} size="small" sx={{ p: 0.4, color: 'rgba(255,255,255,0.35)', '&.Mui-checked': { color: A_COLOR } }} />{lbl}
                        </MenuItem>
                    ))}
                </Select>
                {subSegments.length > 0 && (
                    <Select size="small" multiple displayEmpty value={subs} onChange={(e) => setSubs(e.target.value)}
                        renderValue={(s) => (s.length === 0 ? 'All sub-seg' : s.join(', '))}
                        MenuProps={{ PaperProps: { sx: { bgcolor: 'rgba(18,22,34,0.98)', color: '#fff' } } }}
                        sx={{ ...ctrlSx, minWidth: 150 }}>
                        {subSegments.map((s) => (
                            <MenuItem key={s} value={s} sx={{ fontSize: 13, py: 0.2 }}>
                                <Checkbox checked={subs.includes(s)} size="small" sx={{ p: 0.4, color: 'rgba(255,255,255,0.35)', '&.Mui-checked': { color: A_COLOR } }} />{s}
                            </MenuItem>
                        ))}
                    </Select>
                )}
            </Stack>

            {/* Comparison table */}
            <Box component="table" sx={{ width: '100%', borderCollapse: 'collapse' }}>
                <Box component="thead">
                    <Box component="tr">
                        <Box component="th" sx={{ textAlign: 'left', pl: 0.5, py: 0.6, fontSize: 12, fontWeight: 800, color: TXT, textTransform: 'uppercase', letterSpacing: 0.4, borderBottom: '1px solid rgba(255,255,255,0.12)' }}>Metric</Box>
                        <Box component="th" sx={{ textAlign: 'right', px: 1, py: 0.6, fontSize: 12, fontWeight: 800, color: A_COLOR, textTransform: 'uppercase', letterSpacing: 0.4, borderBottom: '1px solid rgba(255,255,255,0.12)' }}>Plan</Box>
                        <Box component="th" sx={{ textAlign: 'right', px: 1, py: 0.6, fontSize: 12, fontWeight: 800, color: B_COLOR, textTransform: 'uppercase', letterSpacing: 0.4, borderBottom: '1px solid rgba(255,255,255,0.12)' }}>Actual (avg)</Box>
                        <Box component="th" sx={{ textAlign: 'right', px: 1, py: 0.6, fontSize: 12, fontWeight: 800, color: TXT, textTransform: 'uppercase', letterSpacing: 0.4, borderBottom: '1px solid rgba(255,255,255,0.12)', borderLeft: '1px solid rgba(255,255,255,0.12)' }}>Δ</Box>
                        <Box component="th" sx={{ textAlign: 'right', px: 1, py: 0.6, fontSize: 12, fontWeight: 800, color: TXT, textTransform: 'uppercase', letterSpacing: 0.4, borderBottom: '1px solid rgba(255,255,255,0.12)' }}>Δ %</Box>
                    </Box>
                </Box>
                <Box component="tbody">
                    {rows.map((r) => {
                        const { d, pct } = delta(r.a, r.b);
                        return (
                            <Box component="tr" key={r.label}>
                                <Box component="td" sx={{ py: 0.7, pl: 0.5, fontSize: 14, fontWeight: 700, color: TXT, borderBottom: '1px solid rgba(255,255,255,0.05)' }}>{r.label}</Box>
                                <Box component="td" sx={{ py: 0.7, px: 1, textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontSize: 14, fontWeight: 800, color: A_COLOR, borderBottom: '1px solid rgba(255,255,255,0.05)' }}>{fmt(r.a)}</Box>
                                <Box component="td" sx={{ py: 0.7, px: 1, textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontSize: 14, fontWeight: 800, color: B_COLOR, borderBottom: '1px solid rgba(255,255,255,0.05)' }}>{fmt(r.b)}</Box>
                                <Box component="td" sx={{ py: 0.7, px: 1, textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontSize: 14, fontWeight: 800, color: varColor(d), borderBottom: '1px solid rgba(255,255,255,0.05)', borderLeft: '1px solid rgba(255,255,255,0.08)' }}>{fmtDelta(d)}</Box>
                                <Box component="td" sx={{ py: 0.7, px: 1, textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontSize: 13, fontWeight: 700, color: varColor(pct), borderBottom: '1px solid rgba(255,255,255,0.05)' }}>{fmtPct(pct)}</Box>
                            </Box>
                        );
                    })}
                </Box>
            </Box>

            <Typography sx={{ color: 'rgba(255,255,255,0.4)', fontSize: 11, mt: 1 }}>
                Historical figures are averaged across matching days (weekday/weekend + sub-segment filters applied) so they read on the same scale as the single-day plan.
            </Typography>
        </Box>
    );
}
