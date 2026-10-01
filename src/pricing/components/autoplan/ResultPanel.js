// Result — what the solver did and what you can override: period totals,
// one bar per date, the selected date's 7 transitions, the tables that change
// at the selected core hour (sortable, each with "Keep previous price"), the
// rules with pass/fail and cost, and the change sheet for operations.

import React, { useMemo, useState } from 'react';
import { Box, Button, ButtonBase, CircularProgress, Stack, Tooltip, Typography } from '@mui/material';
import DownloadIcon from '@mui/icons-material/Download';
import PushPinIcon from '@mui/icons-material/PushPin';
import AutoFixHighIcon from '@mui/icons-material/AutoFixHigh';
import { CORE_HOURS, DAY_TYPES, blockLabel, firstCore, lastCore } from '../../utils/autoplan/core';
import { AP, panelSx, titleSx, ghostSx, primarySx, labelSx, tierLabel, two } from './apStyles';

const DT = Object.fromEntries(DAY_TYPES.map((d) => [d.id, d.label]));
const shortDate = (d) => `${d.slice(5, 7)}/${d.slice(8, 10)}`;
const RULE_LABEL = { zonecap: 'Pod limit', range: 'Price range', lock: 'Lock', maxstep: 'Max step' };

function Kpi({ label, value, sub, color = '#fff' }) {
    return (
        <Box sx={{ px: 1.3, py: 0.6, borderRadius: 1.5, bgcolor: 'rgba(255,255,255,0.04)', border: `1px solid ${AP.lineSoft}`, minWidth: 96 }}>
            <Typography sx={{ ...labelSx, fontSize: 10.5 }}>{label}</Typography>
            <Typography sx={{ fontSize: 20, fontWeight: 800, color, fontVariantNumeric: 'tabular-nums', lineHeight: 1.25 }}>{value}</Typography>
            {sub ? <Typography sx={{ fontSize: 11, color: AP.faint }}>{sub}</Typography> : null}
        </Box>
    );
}

function CheckLine({ ok, text }) {
    return (
        <Stack direction="row" role="listitem" sx={{ gap: 0.7, alignItems: 'flex-start' }}>
            <Typography component="span" aria-hidden="true" sx={{ fontSize: 13, fontWeight: 900, color: ok ? AP.ok : AP.warn, lineHeight: 1.4 }}>{ok ? '✓' : '!'}</Typography>
            <Typography sx={{ fontSize: 12.5, color: ok ? AP.muted : AP.warn, lineHeight: 1.4 }}>{text}</Typography>
        </Stack>
    );
}

export default function ResultPanel({
    hasDraft, onSolve, dates, date, onDate, dateStats, dayTypeOfDate, totals, report, core, onCore,
    tierById, tierIndex, tableByKey, rankPct, pins, onKeepPrevious, ruleChecks, costsBusy, onDownload, baseline, ruleText,
    closed = null, alignDiffs = 0, anchor = 21, refText = '',
}) {
    const [sort, setSort] = useState({ key: 'sub', dir: 1 });
    const rep = report && report[core];
    const rows = useMemo(() => {
        if (!rep) return [];
        const list = rep.changes.map((c) => {
            const t = tableByKey.get(c.key) || {};
            return { ...c, sub: t.sub || '', zone: t.zone || '', step: (tierIndex.get(c.to) ?? 0) - (tierIndex.get(c.from) ?? 0) };
        });
        const get = { table: (r) => r.key, sub: (r) => `${r.sub}|${r.zone}`, from: (r) => tierIndex.get(r.from), to: (r) => tierIndex.get(r.to), step: (r) => r.step }[sort.key];
        return list.sort((a, b) => { const x = get(a), y = get(b); return (typeof x === 'string' ? x.localeCompare(y) : x - y) * sort.dir || a.key.localeCompare(b.key); });
    }, [rep, tableByKey, tierIndex, sort]);

    if (!hasDraft) {
        return (
            <Box sx={{ ...panelSx, textAlign: 'center', py: 4 }}>
                <Typography component="h2" sx={{ ...titleSx, justifyContent: 'center', mb: 1 }}>Result</Typography>
                <Typography sx={{ fontSize: 13.5, color: AP.muted, mb: 2 }}>Solve the period to see every date's plan, the changes between core hours, and what each rule costs.</Typography>
                <Button sx={primarySx} startIcon={<AutoFixHighIcon />} onClick={onSolve}>Solve period</Button>
            </Box>
        );
    }

    const maxC = Math.max(1, ...dates.map((d) => (dateStats[d] || {}).changes || 0));
    const dayChanges = report ? CORE_HOURS.reduce((a, c) => a + (c === firstCore() ? 0 : report[c].changes.length), 0) : 0;
    const dayMin = report ? CORE_HOURS.reduce((a, c) => a + (c === firstCore() ? 0 : report[c].lb), 0) : 0;
    const problems = report ? CORE_HOURS.flatMap((c) => report[c].problems.map((p) => `${two(c)}:00 · ${p}`)) : [];
    const notes = report ? CORE_HOURS.flatMap((c) => report[c].notes.map((n) => `${two(c)}:00 · ${n}`)) : [];
    const podOver = report ? CORE_HOURS.flatMap((c) => (report[c].podOver || []).map((o) => `pod ${o.zone} at ${two(c)}:00 (${o.changes})`)) : [];
    const sortHead = (key, label, align = 'left') => (
        <Box component="th" aria-sort={sort.key === key ? (sort.dir > 0 ? 'ascending' : 'descending') : 'none'} sx={{ textAlign: align, p: 0.5, borderBottom: `1px solid ${AP.lineSoft}` }}>
            <Box component="button" type="button" onClick={() => setSort((s) => ({ key, dir: s.key === key ? -s.dir : 1 }))}
                sx={{ all: 'unset', cursor: 'pointer', fontSize: 11.5, fontWeight: 800, color: sort.key === key ? AP.accent : AP.muted, letterSpacing: '0.04em', '&:focus-visible': { outline: `2px solid ${AP.accent}` } }}>
                {label}{sort.key === key ? (sort.dir > 0 ? ' ▲' : ' ▼') : ''}
            </Box>
        </Box>
    );

    return (
        <Stack spacing={1.2}>
            <Box sx={panelSx}>
                <Stack direction="row" sx={{ alignItems: 'center', mb: 1 }}>
                    <Typography component="h2" sx={titleSx}>Result</Typography>
                    <Box sx={{ flex: 1 }} />
                    <Button sx={ghostSx} startIcon={<DownloadIcon sx={{ fontSize: 17 }} />} onClick={onDownload}>Change sheet</Button>
                </Stack>
                <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 0.8 }}>
                    <Kpi label="Changes within days" value={totals.changes.toLocaleString()} sub={`${dates.length} dates`} />
                    <Kpi label="Minimum possible" value={totals.lb.toLocaleString()} color={totals.changes === totals.lb ? AP.ok : AP.warn} sub={totals.changes === totals.lb ? 'at the minimum' : `+${totals.changes - totals.lb} from rules or scoring`} />
                    <Kpi label={`Overnight ${two(lastCore())} → ${two(firstCore())}`} value={(totals.overnight || 0).toLocaleString()} color={AP.muted} sub="each day starts from its anchor hour" />
                    {baseline != null ? (
                        <Kpi label="If planned hour by hour" value={baseline} color={baseline > dayChanges ? AP.bad : AP.muted}
                            sub={baseline > dayChanges
                                ? `${shortDate(date)} · Auto-plan: ${dayChanges} (${Math.round((1 - dayChanges / baseline) * 100)}% fewer)`
                                : `${shortDate(date)} · no saving on this date`} />
                    ) : null}
                </Stack>
                <Stack spacing={0.4} sx={{ mt: 1.2 }} role="list" aria-label={`Checks for ${date}`}>
                    {closed ? (
                        <CheckLine ok={closed.pricedClosed === 0}
                            text={closed.scheduled
                                ? `${shortDate(date)}: ${closed.pricedClosed === 0 ? 'no price on a closed table-hour' : `${closed.pricedClosed} prices on closed table-hours`}${closed.openUnpriced ? ` · ${closed.openUnpriced} open table-hours without a price` : ''}`
                                : `${shortDate(date)}: no schedule yet, so every table is treated as open`} />
                    ) : null}
                    {refText ? (
                        <CheckLine ok={alignDiffs === 0}
                            text={alignDiffs === 0 ? `${two(anchor)}:00 matches the reference day (${refText})` : `${alignDiffs} table${alignDiffs === 1 ? '' : 's'} differ from the reference day at ${two(anchor)}:00 (${refText}); the mix or rules differ`} />
                    ) : null}
                    {podOver.length ? <CheckLine ok={false} text={`Pods over the change limit: ${podOver.join(' · ')}`} /> : null}
                </Stack>
            </Box>

            <Box sx={panelSx}>
                <Typography sx={{ ...labelSx, mb: 0.8 }}>Changes per date · click a date</Typography>
                <Box sx={{ display: 'flex', gap: '3px', overflowX: 'auto', pb: 0.5, scrollbarWidth: 'thin' }} role="group" aria-label="Dates">
                    {dates.map((d) => {
                        const s = dateStats[d] || {}, on = d === date, bad = (s.problems || 0) > 0;
                        return (
                            <Tooltip key={d} title={`${d} · ${DT[dayTypeOfDate(d)]} · ${s.changes || 0} changes (min ${s.lb || 0})${bad ? ' · has problems' : ''}`}>
                                <ButtonBase onClick={() => onDate(d)} aria-pressed={on} aria-label={`${d}, ${s.changes || 0} changes`}
                                    sx={{ flexShrink: 0, width: 26, height: 64, borderRadius: 1, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', alignItems: 'stretch', p: '3px', border: `1px solid ${on ? AP.accent : 'transparent'}`, bgcolor: on ? 'rgba(122,223,255,0.1)' : 'rgba(255,255,255,0.03)', '&.Mui-focusVisible': { outline: `2px solid ${AP.accent}` } }}>
                                    <Box sx={{ height: `${Math.max(4, ((s.changes || 0) / maxC) * 38)}px`, borderRadius: 0.5, bgcolor: bad ? AP.bad : (s.changes === s.lb ? AP.accent : AP.warn) }} />
                                    <Typography component="span" sx={{ fontSize: 9.5, fontWeight: 800, color: on ? AP.accent : AP.faint, mt: 0.3, textAlign: 'center' }}>{d.slice(8)}</Typography>
                                </ButtonBase>
                            </Tooltip>
                        );
                    })}
                </Box>
            </Box>

            {problems.length ? (
                <Box role="alert" sx={{ ...panelSx, borderColor: 'rgba(255,122,138,0.5)', bgcolor: 'rgba(255,122,138,0.08)' }}>
                    <Typography sx={{ fontWeight: 800, color: AP.bad, mb: 0.5 }}>{shortDate(date)} can't meet every target and rule</Typography>
                    {problems.slice(0, 6).map((p) => <Typography key={p} sx={{ fontSize: 12.5, color: AP.text }}>• {p}</Typography>)}
                    <Typography sx={{ fontSize: 12, color: AP.muted, mt: 0.5 }}>Fix the target (Targets tab) or loosen the rule, then solve again.</Typography>
                </Box>
            ) : null}

            <Box sx={panelSx}>
                <Stack direction="row" sx={{ alignItems: 'baseline', mb: 0.8, gap: 1 }}>
                    <Typography sx={{ fontWeight: 800, color: '#fff', fontSize: 15 }}>{date} · {DT[dayTypeOfDate(date)]}</Typography>
                    <Typography sx={{ fontSize: 12.5, color: AP.faint }}>{dayChanges} changes · minimum {dayMin}</Typography>
                </Stack>
                <Stack spacing={0.4}>
                    {CORE_HOURS.map((c) => {
                        const r = report[c], n = r.changes.length, on = c === core;
                        return (
                            <ButtonBase key={c} onClick={() => onCore(c)} aria-pressed={on}
                                sx={{ display: 'grid', gridTemplateColumns: '110px minmax(0,1fr) 38px 58px', gap: 1, alignItems: 'center', px: 1, py: 0.6, borderRadius: 1.2, textAlign: 'left', border: `1px solid ${on ? AP.accent : 'transparent'}`, bgcolor: on ? 'rgba(122,223,255,0.1)' : 'rgba(255,255,255,0.03)', '&.Mui-focusVisible': { outline: `2px solid ${AP.accent}` } }}>
                                <Typography component="span" sx={{ fontSize: 13, fontWeight: 800, color: AP.text }}>{c === firstCore() ? `prev ${two(lastCore())}→${two(c)}` : `${r.from.slice(0, 2)}→${two(c)}`}</Typography>
                                <Box sx={{ height: 8, borderRadius: 1, bgcolor: 'rgba(255,255,255,0.06)', position: 'relative', overflow: 'hidden' }}>
                                    <Box sx={{ position: 'absolute', inset: 0, width: `${Math.min(100, (n / Math.max(1, ...CORE_HOURS.map((x) => report[x].changes.length))) * 100)}%`, bgcolor: n === r.lb ? AP.accent : AP.warn }} />
                                </Box>
                                <Typography component="span" sx={{ fontSize: 14, fontWeight: 800, textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: '#fff' }}>{n}</Typography>
                                <Typography component="span" sx={{ fontSize: 11.5, color: n === r.lb ? AP.ok : AP.faint, fontVariantNumeric: 'tabular-nums' }}>min {r.lb}{n === r.lb ? ' ✓' : ''}</Typography>
                            </ButtonBase>
                        );
                    })}
                </Stack>
            </Box>

            <Box sx={panelSx}>
                <Typography sx={{ fontWeight: 800, color: '#fff', fontSize: 15, mb: 0.3 }}>
                    {rows.length} table{rows.length === 1 ? '' : 's'} change at {two(core)}:00 <Box component="span" sx={{ color: AP.faint, fontWeight: 400, fontSize: 12.5 }}>block {blockLabel(core)}</Box>
                </Typography>
                <Typography sx={{ fontSize: 12, color: AP.faint, mb: 0.8 }}>“Keep” pins the table at its previous price for this block; the date is solved again around it.</Typography>
                <Box sx={{ maxHeight: 300, overflow: 'auto', scrollbarWidth: 'thin' }}>
                    <Box component="table" sx={{ width: '100%', borderCollapse: 'collapse', '& td': { p: 0.5, borderBottom: `1px solid ${AP.lineSoft}`, fontSize: 13, color: AP.text, whiteSpace: 'nowrap' } }}>
                        <thead><tr>{sortHead('table', 'Table')}{sortHead('sub', 'Sub · zone')}{sortHead('from', 'From')}{sortHead('to', 'To')}{sortHead('step', 'Move', 'right')}<Box component="th" sx={{ borderBottom: `1px solid ${AP.lineSoft}` }} /></tr></thead>
                        <tbody>
                            {rows.map((r) => {
                                const up = r.step > 0, f = tierById.get(r.from), t = tierById.get(r.to);
                                return (
                                    <tr key={r.key}>
                                        <td><b>{r.key.replace('|', '')}</b>{pins && pins.has(r.key) ? <PushPinIcon aria-label="pinned" sx={{ fontSize: 13, color: AP.pin, ml: 0.4, verticalAlign: -2 }} /> : null}</td>
                                        <td style={{ color: AP.faint }}>{r.sub} · {r.zone}</td>
                                        <td><Box component="span" sx={{ display: 'inline-block', width: 10, height: 10, borderRadius: 0.5, bgcolor: f?.color, mr: 0.6, verticalAlign: -1 }} />{tierLabel(f)}</td>
                                        <td><Box component="span" sx={{ display: 'inline-block', width: 10, height: 10, borderRadius: 0.5, bgcolor: t?.color, mr: 0.6, verticalAlign: -1 }} />{tierLabel(t)}</td>
                                        <td style={{ textAlign: 'right', fontWeight: 800, color: up ? AP.up : AP.down }}>{up ? '▲' : '▼'} {Math.abs(r.step)}</td>
                                        <td style={{ textAlign: 'right' }}>
                                            <Tooltip title={`${up ? 'Top' : 'Bottom'} ${rankPct(r.key, up)}% by value in ${r.sub} · keep ${tierLabel(f)} instead`}>
                                                <ButtonBase onClick={() => onKeepPrevious(r.key, r.from)} aria-label={`Keep ${r.key.replace('|', '')} at ${tierLabel(f)}`}
                                                    sx={{ px: 0.9, py: 0.3, borderRadius: 1, fontSize: 12, fontWeight: 800, color: AP.pin, border: '1px solid rgba(255,205,120,0.45)', '&:hover': { bgcolor: 'rgba(255,205,120,0.1)' }, '&.Mui-focusVisible': { outline: `2px solid ${AP.pin}` } }}>
                                                    Keep {tierLabel(f)}
                                                </ButtonBase>
                                            </Tooltip>
                                        </td>
                                    </tr>
                                );
                            })}
                            {!rows.length ? <tr><td colSpan={6} style={{ color: AP.faint }}>No changes at this core hour.</td></tr> : null}
                        </tbody>
                    </Box>
                </Box>
                {notes.length ? <Typography sx={{ fontSize: 12, color: AP.warn, mt: 0.8 }}>{notes.slice(0, 3).join(' · ')}</Typography> : null}
            </Box>

            <Box sx={panelSx}>
                <Stack direction="row" sx={{ alignItems: 'center', mb: 0.6, gap: 1 }}>
                    <Typography sx={{ fontWeight: 800, color: '#fff', fontSize: 15 }}>Rules on {shortDate(date)}</Typography>
                    {costsBusy ? <CircularProgress size={14} sx={{ color: AP.accent }} aria-label="Measuring rule costs" /> : null}
                    <Typography sx={{ fontSize: 12, color: AP.faint }}>cost = extra changes that day</Typography>
                </Stack>
                {ruleChecks.length ? ruleChecks.map(({ rule, ok, cost }) => (
                    <Stack key={rule.id} direction="row" spacing={1} sx={{ alignItems: 'center', py: 0.3 }}>
                        <Typography aria-label={ok ? 'met' : 'broken'} sx={{ fontWeight: 900, color: ok ? AP.ok : AP.bad, width: 16 }}>{ok ? '✓' : '✕'}</Typography>
                        <Typography sx={{ fontSize: 13, color: AP.text, flex: 1 }}>{RULE_LABEL[rule.type]} · {ruleText(rule)}</Typography>
                        <Typography sx={{ fontSize: 12.5, fontWeight: 800, color: cost > 0 ? AP.warn : AP.faint, fontVariantNumeric: 'tabular-nums' }}>{cost == null ? '…' : cost > 0 ? `+${cost}` : '0'}</Typography>
                    </Stack>
                )) : <Typography sx={{ fontSize: 13, color: AP.faint }}>No active rules.</Typography>}
            </Box>
        </Stack>
    );
}
