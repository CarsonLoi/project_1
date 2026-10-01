// Criteria — every term Auto-plan uses to pick a table's price, editable:
// what decides a price (in order), the solve order and reference day, the
// scoring points, how tables are ranked (named signals + a live preview),
// how price history is read, which tables need a price, and the core hours.
// Saved with the other Auto-plan settings; used on the next solve.

import React, { useEffect, useState } from 'react';
import { Box, Button, IconButton, MenuItem, Select, Stack, Switch, TextField, Tooltip, Typography } from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import AddIcon from '@mui/icons-material/Add';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import RestartAltIcon from '@mui/icons-material/RestartAlt';
import LockIcon from '@mui/icons-material/Lock';
import AutoFixHighIcon from '@mui/icons-material/AutoFixHigh';
import { DEFAULT_CORE_HOURS, GAMING_HOURS, blockLabel, normalizeCoreHours } from '../../utils/autoplan/core';
import {
    DEFAULT_CRITERIA, DEFAULT_WEIGHTS, RANK_MIX_MAX, SIGNALS, WEIGHT_PRESETS, changeDominates, presetOf, signalOf,
} from '../../utils/autoplan/config';
import { solveOrder } from '../../utils/autoplan/period';
import RankPreview from './RankPreview';
import { SEGMENT_PRICES } from '../../constants/segmentPrices';
import { AP, panelSx, titleSx, ghostSx, primarySx, labelSx, inputSx, selectMenuProps, tierLabel, two } from './apStyles';

const WEIGHT_ROWS = [
    ['change', 'Price change from the neighbouring hour', 'Charged once for each table whose price differs from the hour it is solved from'],
    ['align', 'Differs from the reference day', "Each date's anchor hour against the reference plan, so a table keeps its price across the period"],
    ['step', 'Each price level jumped', 'Keeps a forced change to the closest price: $3,000 → $2,000 beats $3,000 → $1,000'],
    ['raise', 'Raising a price', 'Extra when a change raises the minimum on seated players; 0 = same as lowering'],
    ['night', 'Differs from the previous night', "At 07:00, a price different from the one the table ended on the night before (05:00). Keeps the handover smooth without adding changes in the day"],
    ['hold', 'Changes again soon after its last change', "Added to a change when the table already changed recently, so the same tables don't flip back and forth"],
    ['rank', 'Each level away from its rank slot', 'Stronger tables go higher, weaker tables go lower'],
    ['hist', 'Price the table rarely runs', 'Full points for a price it never ran, none for its usual price'],
    ['stay', 'Differs from the base plan (tie-break)', 'Used when Base plan is set to “Only as a tie-break”'],
    ['base', 'Differs from the base plan (keep close)', 'Used when Base plan is set to “Keep as close as possible”: outranks a change between hours'],
];
const text = { fontSize: 13.5, color: AP.text };
const help = { fontSize: 12, color: AP.faint, lineHeight: 1.4 };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// Number box that commits on blur / Enter, clamped; typing stays free.
function NumField({ value, onCommit, min, max, label, width = 88 }) {
    const [txt, setTxt] = useState(String(value));
    useEffect(() => setTxt(String(value)), [value]);
    const commit = () => {
        const v = Number(txt);
        if (txt.trim() === '' || !Number.isFinite(v)) { setTxt(String(value)); return; }
        const c = Math.min(max, Math.max(min, v));
        setTxt(String(c));
        if (c !== value) onCommit(c);
    };
    return (
        <TextField size="small" value={txt} onChange={(e) => setTxt(e.target.value)} onBlur={commit}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commit(); } }}
            sx={{ ...inputSx, width }} slotProps={{ htmlInput: { inputMode: 'numeric', 'aria-label': label, style: { textAlign: 'right' } } }} />
    );
}

function Segmented({ value, options, onChange, label }) {
    return (
        <Stack direction="row" role="radiogroup" aria-label={label} sx={{ border: `1px solid ${AP.line}`, borderRadius: 1.5, overflow: 'hidden', flexWrap: 'wrap' }}>
            {options.map(([v, l]) => {
                const on = v === value;
                return (
                    <Box key={v} component="button" type="button" role="radio" aria-checked={on} onClick={() => onChange(v)}
                        sx={{
                            all: 'unset', cursor: 'pointer', flex: '1 1 auto', textAlign: 'center', px: 1.2, py: 0.75, fontSize: 13, fontWeight: 700,
                            color: on ? AP.accentInk : AP.text, bgcolor: on ? AP.accent : 'transparent',
                            '&:hover': on ? undefined : { bgcolor: 'rgba(122,223,255,0.08)' },
                            '&:focus-visible': { outline: `2px solid ${AP.accent}`, outlineOffset: -2 },
                            '& + &': { borderLeft: `1px solid ${AP.line}` },
                        }}>
                        {l}
                    </Box>
                );
            })}
        </Stack>
    );
}

function Section({ title, sub, changed, onReset, children }) {
    return (
        <Box component="section" sx={panelSx}>
            <Stack direction="row" sx={{ alignItems: 'center', gap: 1, mb: sub ? 0.25 : 1 }}>
                <Typography component="h3" sx={{ fontSize: 15.5, fontWeight: 800, color: '#fff' }}>{title}</Typography>
                <Box sx={{ flex: 1 }} />
                {changed ? (
                    <Button size="small" onClick={onReset} startIcon={<RestartAltIcon sx={{ fontSize: 16 }} />}
                        sx={{ ...ghostSx, minHeight: 28, py: 0.2, px: 1, fontSize: 12.5 }}>Default</Button>
                ) : null}
            </Stack>
            {sub ? <Typography sx={{ ...help, mb: 1.2 }}>{sub}</Typography> : null}
            <Stack spacing={1.2}>{children}</Stack>
        </Box>
    );
}

function SwitchRow({ checked, onChange, label, sub }) {
    return (
        <Stack direction="row" sx={{ alignItems: 'center', gap: 1 }}>
            <Switch size="small" checked={checked} onChange={(e) => onChange(e.target.checked)} slotProps={{ input: { 'aria-label': label } }}
                sx={{ '& .Mui-checked': { color: `${AP.accent} !important` }, '& .Mui-checked + .MuiSwitch-track': { bgcolor: `${AP.accent} !important` } }} />
            <Box>
                <Typography sx={text}>{label}</Typography>
                {sub ? <Typography sx={help}>{sub}</Typography> : null}
            </Box>
        </Stack>
    );
}

function Check({ ok, children }) {
    return (
        <Stack direction="row" role="status" sx={{ gap: 1, alignItems: 'flex-start', p: 1, borderRadius: 1.5, bgcolor: ok ? 'rgba(158,206,106,0.08)' : 'rgba(255,205,120,0.08)', border: `1px solid ${ok ? 'rgba(158,206,106,0.4)' : AP.warn}` }}>
            {ok ? <CheckCircleIcon sx={{ color: AP.ok, fontSize: 19, mt: 0.1 }} /> : <WarningAmberIcon sx={{ color: AP.warn, fontSize: 19, mt: 0.1 }} />}
            <Typography sx={{ ...text, fontSize: 13 }}>{children}</Typography>
        </Stack>
    );
}

// History source: the last N days / weeks, or a date range the user picks.
function SourceRow({ source, onSource, lastLabel, lastField, window }) {
    return (
        <Box>
            <Typography sx={{ ...labelSx, mb: 0.6 }}>{lastLabel} period</Typography>
            <Segmented label={`${lastLabel} source`} value={source.mode} onChange={(mode) => onSource({ ...source, mode })}
                options={[['last', 'Most recent'], ['range', 'Date range']]} />
            <Stack direction="row" sx={{ alignItems: 'center', gap: 0.8, flexWrap: 'wrap', mt: 0.8 }}>
                {source.mode === 'last' ? lastField : (
                    <>
                        <TextField type="date" size="small" value={source.from} onChange={(e) => onSource({ ...source, from: e.target.value })}
                            sx={{ ...inputSx, width: 150 }} slotProps={{ htmlInput: { 'aria-label': `${lastLabel} from` } }} />
                        <Typography sx={text}>to</Typography>
                        <TextField type="date" size="small" value={source.to} onChange={(e) => onSource({ ...source, to: e.target.value })}
                            sx={{ ...inputSx, width: 150 }} slotProps={{ htmlInput: { 'aria-label': `${lastLabel} to` } }} />
                    </>
                )}
            </Stack>
            {window ? <Typography sx={{ ...help, mt: 0.5, fontVariantNumeric: 'tabular-nums' }}>Reading {window.from} → {window.to}</Typography> : null}
        </Box>
    );
}

// The signature: core hours in time order, the anchor lit, arrows showing
// which neighbour each hour is solved from, and the step number of each.
function SolveOrderStrip({ coreHours, anchor }) {
    const order = solveOrder(coreHours, anchor);
    const stepOf = new Map(order.map((s, i) => [s.core, i + 1]));
    const ai = coreHours.indexOf(anchor);
    return (
        <Box>
            <Box role="list" aria-label="Solve order" sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', rowGap: 0.8 }}>
                {coreHours.map((c, i) => {
                    const isA = c === anchor;
                    return (
                        <React.Fragment key={c}>
                            {i > 0 ? (
                                <Box aria-hidden="true" sx={{ px: 0.35, color: AP.accent, fontWeight: 900, fontSize: 14 }}>{i <= ai ? '←' : '→'}</Box>
                            ) : null}
                            <Box role="listitem" aria-label={`${two(c)}:00, step ${stepOf.get(c)}${isA ? ', anchor' : ''}`}
                                sx={{
                                    display: 'grid', justifyItems: 'center', minWidth: 38, px: 0.6, py: 0.4, borderRadius: 1.2,
                                    border: `1px solid ${isA ? AP.accent : AP.line}`, bgcolor: isA ? AP.accent : 'rgba(255,255,255,0.03)',
                                    boxShadow: isA ? '0 0 14px rgba(122,223,255,0.35)' : 'none',
                                }}>
                                <Typography component="span" sx={{ fontSize: 14, fontWeight: 900, lineHeight: 1.1, color: isA ? AP.accentInk : AP.text, fontVariantNumeric: 'tabular-nums' }}>{two(c)}</Typography>
                                <Typography component="span" sx={{ fontSize: 9.5, fontWeight: 800, letterSpacing: '0.06em', color: isA ? AP.accentInk : AP.faint }}>{isA ? 'START' : `STEP ${stepOf.get(c)}`}</Typography>
                            </Box>
                        </React.Fragment>
                    );
                })}
            </Box>
            <Typography sx={{ ...help, mt: 0.6, fontVariantNumeric: 'tabular-nums' }}>
                {[order.filter((s) => s.dir !== 'fwd').map((s) => two(s.core)).join(' → '), order.filter((s) => s.dir === 'fwd').length ? `${two(anchor)} → ${order.filter((s) => s.dir === 'fwd').map((s) => two(s.core)).join(' → ')}` : null].filter(Boolean).join('  ·  ')}
            </Typography>
        </Box>
    );
}

export default function CriteriaPanel({
    cfg, onCfg, onCoreHours, ladders, tierById, histWindow, rankWindow, levels, stale, hasDraft, onSolve, solving,
    refDate, refLabel, breakdown, mixFor, subs, baseStrength = 'tie',
}) {
    const w = cfg.weights, c = cfg.criteria, core = cfg.coreHours;
    const [preview, setPreview] = useState(false);
    const setW = (k, v) => onCfg({ ...cfg, weights: { ...w, [k]: v } });
    const setC = (patch) => onCfg({ ...cfg, criteria: { ...c, ...patch } });
    const preset = presetOf(w);
    const gain = w.rank * Math.max(0, levels - 1) + w.hist + w.stay;
    const changesFirst = changeDominates(w, levels);
    const closestFirst = w.step > gain;
    const pick = (o, ks) => Object.fromEntries(ks.map((k) => [k, o[k]]));
    const orderKeys = ['anchorCore', 'refDayType'];
    const rankKeys = ['rankMix', 'rankDays', 'rankSameDayType', 'rankBasis', 'rankSource'];
    const histKeys = ['histWeeks', 'histSameDayType', 'minShare', 'histSource', 'histHalfLife'];
    const scoreKeys = ['holdHours', 'changeMult', 'podChangeCap'];
    const allDefault = same(w, DEFAULT_WEIGHTS) && same(c, DEFAULT_CRITERIA) && same(core, DEFAULT_CORE_HOURS);
    const anchor = core.includes(c.anchorCore) ? c.anchorCore : null;
    const mix = c.rankMix;
    const mixW = mix.reduce((a, m) => a + m.w, 0);
    const setMix = (i, patch) => setC({ rankMix: mix.map((m, j) => (j === i ? { ...m, ...patch } : m)) });
    const pct = (m) => (mixW ? Math.round((m.w / mixW) * 100) : 0);

    const strongBase = baseStrength === 'strong';
    const DECIDES = [
        ['Rules and manual prices', 'Never broken: pod limits, locks, price ranges, and every price you set by hand.'],
        ['Target mix', 'Exactly how many tables at each price, per sub-segment and core hour.'],
        ...(strongBase ? [['Base plan', 'Only the tables the new mix forces differ from the base plan (toolbar → Base plan).']] : []),
        ['Fewest changes', `Each hour keeps its neighbour's prices where it can; ${two(anchor ?? 21)}:00 keeps the reference day's, and ${two(core[0])}:00 leans to last night's.`],
        ['Closest price', 'A table that must change moves to the nearest price level.'],
        ['Performance rank', 'Among the rest, better-ranked tables take the higher prices.'],
        ['Price history', 'Ties go to the price a table usually runs.'],
        ...(strongBase ? [] : [['Base plan', 'Ties keep what the base plan has (toolbar → Base plan, “Only as a tie-break”).']]),
    ];

    return (
        <Stack spacing={1.2}>
            <Box sx={panelSx}>
                <Stack direction="row" sx={{ alignItems: 'center', mb: 0.5 }}>
                    <Typography component="h2" sx={titleSx}>Criteria</Typography>
                    <Box sx={{ flex: 1 }} />
                    <Button sx={ghostSx} disabled={allDefault} startIcon={<RestartAltIcon sx={{ fontSize: 17 }} />}
                        onClick={() => onCoreHours(DEFAULT_CORE_HOURS, { weights: { ...DEFAULT_WEIGHTS }, criteria: { ...DEFAULT_CRITERIA } })}>
                        Reset all
                    </Button>
                </Stack>
                <Typography sx={help}>How Auto-plan picks each table's price. Saved in this browser and used on the next solve.</Typography>
                {hasDraft && stale ? (
                    <Stack direction="row" role="status" sx={{ alignItems: 'center', gap: 1, mt: 1.2, p: 1, borderRadius: 1.5, border: `1px solid ${AP.warn}`, bgcolor: 'rgba(255,205,120,0.08)' }}>
                        <WarningAmberIcon sx={{ color: AP.warn, fontSize: 20 }} />
                        <Typography sx={{ ...text, flex: 1 }}>Settings changed since the last solve.</Typography>
                        <Button sx={primarySx} startIcon={<AutoFixHighIcon />} disabled={solving} onClick={onSolve}>Solve again</Button>
                    </Stack>
                ) : null}
            </Box>

            <Section title="What decides a table's price" sub="In this order. A lower item only chooses between options the items above leave equal.">
                <Box component="ol" sx={{ m: 0, pl: 0, listStyle: 'none', display: 'grid', gap: 0.7 }}>
                    {DECIDES.map(([t, d], i) => (
                        <Box component="li" key={t} sx={{ display: 'grid', gridTemplateColumns: '22px 1fr', gap: 1, alignItems: 'baseline' }}>
                            <Typography component="span" sx={{ fontSize: 13, fontWeight: 900, color: AP.accent, fontVariantNumeric: 'tabular-nums' }}>{i + 1}</Typography>
                            <Box>
                                <Typography component="span" sx={{ ...text, fontWeight: 800 }}>{t}</Typography>
                                <Typography component="span" sx={{ ...help, ml: 0.8 }}>{d}</Typography>
                            </Box>
                        </Box>
                    ))}
                </Box>
                {!changesFirst || !closestFirst ? (
                    <Check ok={false}>Your scoring points change this order: {!changesFirst ? 'rank, history or the saved plan can outweigh a change' : 'rank or history can outweigh moving to the closest price'}. See Scoring.</Check>
                ) : null}
            </Section>

            <Section title="Solve order" sub="Each day starts at the anchor hour and works outward, each hour against the one next to it."
                changed={!same(pick(c, orderKeys), pick(DEFAULT_CRITERIA, orderKeys))} onReset={() => setC(pick(DEFAULT_CRITERIA, orderKeys))}>
                <Stack direction="row" sx={{ alignItems: 'center', gap: 0.8, flexWrap: 'wrap' }}>
                    <Typography sx={text}>Start at</Typography>
                    <Select size="small" value={anchor ?? ''} displayEmpty MenuProps={selectMenuProps} sx={{ ...inputSx, minWidth: 96 }} inputProps={{ 'aria-label': 'Anchor hour' }}
                        onChange={(e) => setC({ anchorCore: Number(e.target.value) })}>
                        {anchor == null ? <MenuItem value="" disabled>Busiest hour</MenuItem> : null}
                        {core.map((h) => <MenuItem key={h} value={h}>{two(h)}:00</MenuItem>)}
                    </Select>
                    <Typography sx={help}>{anchor == null ? `${two(c.anchorCore)}:00 isn't a core hour, so each day starts at its busiest core hour.` : 'Pick the hour with the most open tables.'}</Typography>
                </Stack>
                <SolveOrderStrip coreHours={core} anchor={anchor ?? core[0]} />
                <Box>
                    <Stack direction="row" sx={{ alignItems: 'center', gap: 0.8, flexWrap: 'wrap' }}>
                        <Typography sx={text}>Keep every date like</Typography>
                        <Select size="small" value={c.refDayType} MenuProps={selectMenuProps} sx={{ ...inputSx, minWidth: 140 }} inputProps={{ 'aria-label': 'Reference day' }}
                            onChange={(e) => setC({ refDayType: e.target.value })}>
                            {[['sat', 'Saturday'], ['wd', 'Weekday'], ['fri', 'Friday'], ['sun', 'Sunday'], ['auto', 'Busiest day']].map(([v, l]) => <MenuItem key={v} value={v}>{l}</MenuItem>)}
                        </Select>
                    </Stack>
                    <Typography sx={{ ...help, mt: 0.5 }}>
                        The reference day's {two(anchor ?? 21)}:00 plan is solved first; every date's {two(anchor ?? 21)}:00 then keeps the same table at the same price wherever its mix allows.
                        {refDate ? <> This period: <Box component="span" sx={{ color: AP.text, fontWeight: 700 }}>{refLabel}</Box>.</> : null}
                    </Typography>
                </Box>
            </Section>

            <Section title="Scoring" sub="Points for each price a table could take; the plan with the fewest total points wins."
                changed={!same(w, DEFAULT_WEIGHTS) || !same(pick(c, scoreKeys), pick(DEFAULT_CRITERIA, scoreKeys))}
                onReset={() => onCfg({ ...cfg, weights: { ...DEFAULT_WEIGHTS }, criteria: { ...c, ...pick(DEFAULT_CRITERIA, scoreKeys) } })}>
                <Box>
                    <Typography sx={{ ...labelSx, mb: 0.6 }}>Preset</Typography>
                    <Segmented label="Scoring preset" value={preset}
                        options={[...WEIGHT_PRESETS.map((p) => [p.id, p.label]), ...(preset === 'custom' ? [['custom', 'Custom']] : [])]}
                        onChange={(id) => { const p = WEIGHT_PRESETS.find((x) => x.id === id); if (p) onCfg({ ...cfg, weights: { ...p.weights } }); }} />
                    <Typography sx={{ ...help, mt: 0.5 }}>{(WEIGHT_PRESETS.find((p) => p.id === preset) || { help: 'Your own points below.' }).help}</Typography>
                </Box>
                <Box component="dl" sx={{ m: 0, display: 'grid', gridTemplateColumns: '1fr auto', columnGap: 1.5, rowGap: 1, alignItems: 'center' }}>
                    {WEIGHT_ROWS.map(([k, label, sub]) => (
                        <React.Fragment key={k}>
                            <Box component="dt" sx={{ m: 0 }}>
                                <Typography sx={{ ...text, fontWeight: 700 }}>{label}</Typography>
                                <Typography sx={help}>{sub}</Typography>
                                {k === 'hold' ? (
                                    <Stack direction="row" sx={{ alignItems: 'center', gap: 0.6, mt: 0.6 }}>
                                        <Typography sx={{ ...help, color: AP.muted }}>Recently = within the last</Typography>
                                        <NumField value={c.holdHours} min={1} max={6} label="Minimum hold, core hours" onCommit={(v) => setC({ holdHours: v })} width={52} />
                                        <Typography sx={{ ...help, color: AP.muted }}>core hour{c.holdHours === 1 ? '' : 's'}</Typography>
                                    </Stack>
                                ) : null}
                            </Box>
                            <Box component="dd" sx={{ m: 0, display: 'flex', alignItems: 'center', gap: 0.6 }}>
                                <NumField value={w[k]} min={0} max={1000000} label={`${label}, points`} onCommit={(v) => setW(k, v)} width={96} />
                                <Typography sx={{ ...help, width: 22 }}>pts</Typography>
                            </Box>
                        </React.Fragment>
                    ))}
                </Box>
                <Box>
                    <Typography sx={{ ...text, fontWeight: 700 }}>Peak protection</Typography>
                    <Typography sx={help}>Multiply the change points for changes made at busy hours, so unavoidable changes move to quieter ones. 1 = normal.</Typography>
                    <Box sx={{ display: 'grid', gridTemplateColumns: `repeat(${Math.min(core.length, 8)}, minmax(0,1fr))`, gap: 0.5, mt: 0.8 }}>
                        {core.map((h) => (
                            <Box key={h} sx={{ display: 'grid', justifyItems: 'center', gap: 0.3 }}>
                                <Typography sx={{ fontSize: 11.5, fontWeight: 800, color: (c.changeMult[h] || 1) > 1 ? AP.warn : AP.faint }}>{two(h)}</Typography>
                                <NumField value={c.changeMult[h] || 1} min={1} max={20} label={`Change multiplier at ${two(h)}:00`} width={48}
                                    onCommit={(v) => { const m = { ...c.changeMult }; if (v === 1) delete m[h]; else m[h] = v; setC({ changeMult: m }); }} />
                            </Box>
                        ))}
                    </Box>
                </Box>
                <SwitchRow checked={c.podChangeCap.on} onChange={(on) => setC({ podChangeCap: { ...c.podChangeCap, on } })}
                    label="Limit changes per pod" sub="Spreads a core hour's changes across pods so no supervisor gets them all." />
                {c.podChangeCap.on ? (
                    <Stack direction="row" sx={{ alignItems: 'center', gap: 0.6, pl: 5.5 }}>
                        <Typography sx={help}>At most</Typography>
                        <NumField value={c.podChangeCap.n} min={1} max={50} label="Changes per pod per core hour" onCommit={(n) => setC({ podChangeCap: { ...c.podChangeCap, n } })} width={52} />
                        <Typography sx={help}>changes per pod at each core hour (best effort; pods still over are listed in Result)</Typography>
                    </Stack>
                ) : null}
                <Check ok={changesFirst}>
                    {changesFirst
                        ? <>Changes come first: one change ({w.change.toLocaleString()} pts) outweighs the most a table can gain from rank, history and the saved plan ({gain.toLocaleString()} pts).</>
                        : <>Rank, history or the saved plan can now outweigh a change ({w.change.toLocaleString()} vs up to {gain.toLocaleString()} pts), so expect more changes than the minimum.</>}
                </Check>
                <Check ok={closestFirst}>
                    {closestFirst
                        ? <>Closest price comes next: each extra level jumped ({w.step.toLocaleString()} pts) outweighs rank and history ({gain.toLocaleString()} pts).</>
                        : <>A forced change may skip a level to follow rank or history ({w.step.toLocaleString()} vs up to {gain.toLocaleString()} pts).</>}
                </Check>
            </Section>

            <Section title="Performance rank" sub="Tables are ranked within their sub-segment. Each signal becomes a percentile (0 = lowest, 100 = highest), then the signals are weighted."
                changed={!same(pick(c, rankKeys), pick(DEFAULT_CRITERIA, rankKeys))} onReset={() => setC(pick(DEFAULT_CRITERIA, rankKeys))}>
                <Box>
                    <Typography sx={{ ...labelSx, mb: 0.6 }}>Rank by</Typography>
                    <Stack spacing={1}>
                        {mix.map((m, i) => {
                            const sig = signalOf(m);
                            return (
                                <Box key={i} sx={{ p: 0.9, borderRadius: 1.5, border: `1px solid ${AP.lineSoft}`, bgcolor: 'rgba(255,255,255,0.02)' }}>
                                    <Stack direction="row" sx={{ alignItems: 'center', gap: 0.6, flexWrap: 'wrap' }}>
                                        <Select size="small" value={sig ? sig.id : 'custom'} MenuProps={selectMenuProps} sx={{ ...inputSx, minWidth: 176 }} inputProps={{ 'aria-label': `Signal ${i + 1}` }}
                                            onChange={(e) => { const s = SIGNALS.find((x) => x.id === e.target.value); if (s) setMix(i, { metric: s.metric, per: s.per }); }}>
                                            {SIGNALS.map((s) => <MenuItem key={s.id} value={s.id}>{s.label}</MenuItem>)}
                                            {!sig ? <MenuItem value="custom" disabled>{`Custom: ${m.metric} ÷ ${m.per}`}</MenuItem> : null}
                                        </Select>
                                        <Box sx={{ flex: 1 }} />
                                        <Typography sx={help}>weight</Typography>
                                        <NumField value={m.w} min={0} max={100} label={`Signal ${i + 1} weight`} onCommit={(v) => setMix(i, { w: v })} width={56} />
                                        <Typography sx={{ fontSize: 13, fontWeight: 900, color: AP.accent, width: 40, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{pct(m)}%</Typography>
                                        <IconButton size="small" aria-label={`Remove signal ${i + 1}`} disabled={mix.length <= 1} onClick={() => setC({ rankMix: mix.filter((_, j) => j !== i) })}
                                            sx={{ p: 0.4, color: AP.faint, '&:hover': { color: AP.bad }, '&.Mui-focusVisible': { outline: `2px solid ${AP.accent}` } }}>
                                            <CloseIcon sx={{ fontSize: 16 }} />
                                        </IconButton>
                                    </Stack>
                                    <Typography sx={{ ...text, fontSize: 12.5, mt: 0.6 }}>
                                        Higher {sig ? sig.label.toLowerCase() : 'value'} → ranked higher → takes the higher-price slots first.
                                    </Typography>
                                    {sig ? <Typography sx={help}>{sig.help}{sig.source ? ` · ${sig.source}` : ''}</Typography> : null}
                                </Box>
                            );
                        })}
                    </Stack>
                    <Button size="small" sx={{ ...ghostSx, mt: 0.8, minHeight: 28, py: 0.2, fontSize: 12.5, borderStyle: 'dashed' }} startIcon={<AddIcon sx={{ fontSize: 15 }} />}
                        disabled={mix.length >= RANK_MIX_MAX}
                        onClick={() => { const s = SIGNALS.find((x) => !mix.some((m) => signalOf(m) === x)) || SIGNALS[0]; setC({ rankMix: [...mix, { metric: s.metric, per: s.per, w: 25 }] }); }}>
                        Add signal
                    </Button>
                    <Typography sx={{ ...text, fontSize: 12.5, mt: 0.8 }}>
                        Rank = {mix.map((m) => `${pct(m)}% ${(signalOf(m) || { label: 'custom' }).label}`).join(' + ')}.
                    </Typography>
                </Box>
                <Box>
                    <Typography sx={{ ...text, mb: 0.6 }}>Rank each core hour on</Typography>
                    <Segmented label="Rank basis" value={c.rankBasis} onChange={(v) => setC({ rankBasis: v })}
                        options={[['block', 'That block’s own hours'], ['day', 'The whole day']]} />
                    <Typography sx={{ ...help, mt: 0.5 }}>
                        {c.rankBasis === 'block' ? 'At 21:00 tables are ranked on 21:00–02:00 performance, at 07:00 on 07:00–10:00.' : 'One rank per table, the same at every hour.'}
                    </Typography>
                </Box>
                <SourceRow source={c.rankSource} onSource={(rankSource) => setC({ rankSource })} lastLabel="Performance data" window={rankWindow}
                    lastField={(<><Typography sx={text}>Last</Typography>
                        <NumField value={c.rankDays} min={7} max={365} label="Rank look-back in days" onCommit={(v) => setC({ rankDays: v })} width={68} />
                        <Typography sx={text}>days</Typography></>)} />
                <SwitchRow checked={c.rankSameDayType} onChange={(v) => setC({ rankSameDayType: v })}
                    label="Same day type only" sub="A Saturday plan ranks by Saturdays. Off = every day." />
                <Box>
                    <Button size="small" sx={ghostSx} aria-expanded={preview} onClick={() => setPreview((p) => !p)}>{preview ? 'Hide ranking preview' : 'Show ranking preview'}</Button>
                    {preview ? <RankPreview breakdown={breakdown} subs={subs} coreHours={core} basis={c.rankBasis} mixFor={mixFor} ladders={ladders} tierById={tierById} mix={mix} defaultCore={anchor ?? core[0]} /> : null}
                </Box>
                <Typography sx={help}>
                    With a base plan in the toolbar, keeping its prices ({w.stay.toLocaleString()} pts as a tie-break) outweighs the rank ({w.rank.toLocaleString()} pts a level). Set Base plan to “No base plan” to re-rank from scratch.
                </Typography>
            </Section>

            <Section title="Price history" sub="What each table usually runs: it seeds the target mix and scores the “rarely runs” points."
                changed={!same(pick(c, histKeys), pick(DEFAULT_CRITERIA, histKeys))} onReset={() => setC(pick(DEFAULT_CRITERIA, histKeys))}>
                <SourceRow source={c.histSource} onSource={(histSource) => setC({ histSource })} lastLabel="Price history" window={histWindow}
                    lastField={(<><Typography sx={text}>Last</Typography>
                        <NumField value={c.histWeeks} min={1} max={52} label="History look-back in weeks" onCommit={(v) => setC({ histWeeks: v })} width={60} />
                        <Typography sx={text}>weeks</Typography></>)} />
                <Stack direction="row" sx={{ alignItems: 'center', gap: 0.8, flexWrap: 'wrap' }}>
                    <Typography sx={text}>Recent weeks count more: half-life</Typography>
                    <NumField value={c.histHalfLife} min={0} max={52} label="History half-life in weeks" onCommit={(v) => setC({ histHalfLife: v })} width={56} />
                    <Typography sx={text}>weeks</Typography>
                    <Typography sx={help}>{c.histHalfLife ? `A week ${c.histHalfLife} week${c.histHalfLife === 1 ? '' : 's'} old counts half.` : '0 = every week counts the same.'}</Typography>
                </Stack>
                <SwitchRow checked={c.histSameDayType} onChange={(v) => setC({ histSameDayType: v })}
                    label="Same day type only" sub="Weekday targets come from weekdays. Off = every day." />
                <Box>
                    <Stack direction="row" sx={{ alignItems: 'center', gap: 0.8, flexWrap: 'wrap' }}>
                        <Typography sx={text}>Offer a price when it ran at least</Typography>
                        <NumField value={c.minShare} min={0} max={50} label="Minimum history share, percent" onCommit={(v) => setC({ minShare: v })} width={60} />
                        <Typography sx={text}>% of the sub-segment's hours</Typography>
                    </Stack>
                    <Typography sx={{ ...help, mt: 0.4 }}>
                        Only for sub-segments without a price list in constants/segmentPrices.js (0 = every price). Prices offered now:
                    </Typography>
                    {!Object.keys(ladders).length ? <Typography sx={{ ...help, mt: 0.6, fontStyle: 'italic' }}>Shown once the price history has loaded.</Typography> : null}
                    <Box sx={{ display: 'grid', gridTemplateColumns: 'auto 1fr', columnGap: 1.2, rowGap: 0.4, mt: 0.6 }}>
                        {Object.keys(ladders).sort().map((sub) => (
                            <React.Fragment key={sub}>
                                <Typography sx={{ fontSize: 12.5, fontWeight: 800, color: AP.muted }}>
                                    {sub}
                                    <Box component="span" sx={{ color: (cfg.prices || {})[sub] ? AP.warn : AP.faint, fontWeight: 700 }}>
                                        {(cfg.prices || {})[sub] ? ' · edited' : (SEGMENT_PRICES[sub] || []).length ? ' · config' : ' · history'}
                                    </Box>
                                </Typography>
                                <Typography sx={{ fontSize: 12.5, color: AP.text, fontVariantNumeric: 'tabular-nums' }}>{ladders[sub].map((id) => tierLabel(tierById.get(id))).join(' · ')}</Typography>
                            </React.Fragment>
                        ))}
                    </Box>
                </Box>
            </Section>

            <Section title="Open tables and zone caps"
                changed={c.openRule !== DEFAULT_CRITERIA.openRule || c.overflow !== DEFAULT_CRITERIA.overflow}
                onReset={() => setC({ openRule: DEFAULT_CRITERIA.openRule, overflow: DEFAULT_CRITERIA.overflow })}>
                <Box>
                    <Typography sx={{ ...text, mb: 0.6 }}>A table needs a price in a block when it's open at</Typography>
                    <Segmented label="Open tables" value={c.openRule} onChange={(v) => setC({ openRule: v })}
                        options={[['any', 'Any hour of the block'], ['core', 'The core hour']]} />
                    <Typography sx={{ ...help, mt: 0.5 }}>Either way, a price is only written to the hours the schedule has the table open.</Typography>
                </Box>
                <Box>
                    <Typography sx={{ ...text, mb: 0.6 }}>When a pod maximum trims a target, the extra tables move</Typography>
                    <Segmented label="Pod maximum overflow" value={c.overflow} onChange={(v) => setC({ overflow: v })}
                        options={[['down', 'One price lower'], ['up', 'One price higher']]} />
                </Box>
            </Section>

            <Section title="Core hours" sub="Prices are planned at these hours; every other hour copies the core hour before it. Changing them clears the current draft."
                changed={!same(core, DEFAULT_CORE_HOURS)} onReset={() => onCoreHours(DEFAULT_CORE_HOURS)}>
                <Box role="group" aria-label="Core hours" sx={{ display: 'grid', gridTemplateColumns: 'repeat(8, minmax(0,1fr))', gap: 0.5 }}>
                    {GAMING_HOURS.map((h) => {
                        const on = core.includes(h), locked = h === GAMING_HOURS[0];
                        const btn = (
                            <Box component="button" type="button" aria-pressed={on} aria-disabled={locked || undefined}
                                onClick={() => { if (!locked) onCoreHours(normalizeCoreHours(on ? core.filter((x) => x !== h) : [...core, h])); }}
                                sx={{
                                    all: 'unset', cursor: locked ? 'default' : 'pointer', textAlign: 'center', py: 0.6, borderRadius: 1, fontSize: 13, fontWeight: 800,
                                    fontVariantNumeric: 'tabular-nums', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 0.3,
                                    border: `1px solid ${on ? AP.accent : AP.lineSoft}`, color: on ? AP.accentInk : AP.faint, bgcolor: on ? AP.accent : 'transparent',
                                    '&:hover': on || locked ? undefined : { borderColor: AP.accent, color: AP.text },
                                    '&:focus-visible': { outline: `2px solid ${AP.text}`, outlineOffset: 1 },
                                }}>
                                {locked ? <LockIcon sx={{ fontSize: 12 }} /> : null}{two(h)}
                            </Box>
                        );
                        return locked ? <Tooltip key={h} title="07:00 starts the gaming day">{btn}</Tooltip> : <React.Fragment key={h}>{btn}</React.Fragment>;
                    })}
                </Box>
                <Box>
                    <Typography sx={{ ...labelSx, fontSize: 11, mb: 0.4 }}>Blocks · {core.length}</Typography>
                    <Typography sx={{ fontSize: 13, color: AP.text, fontVariantNumeric: 'tabular-nums', lineHeight: 1.6 }}>
                        {core.map((h) => blockLabel(h)).join('  ·  ')}
                    </Typography>
                </Box>
            </Section>
        </Stack>
    );
}
