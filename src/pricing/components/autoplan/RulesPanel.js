// Rules — hard limits the solver never breaks. Each rule has a scope, the
// core hours it applies to, an on/off switch, and (after a solve) what it
// costs in extra changes per day. Pod limits carry a minimum and a maximum,
// each switchable. Manual prices (set on the floor or with "Keep") are listed
// here too: each is a rule for one date + core-hour block.

import React from 'react';
import { Autocomplete, Box, Button, IconButton, MenuItem, Select, Stack, Switch, TextField, Tooltip, Typography } from '@mui/material';
import DeleteOutlineIcon from '@mui/icons-material/Delete';
import AddIcon from '@mui/icons-material/Add';
import CloseIcon from '@mui/icons-material/Close';
import { CORE_HOURS, blockLabel } from '../../utils/autoplan/core';
import { scopeKeys, tablesScope } from '../../utils/autoplan/config';
import { AP, panelSx, titleSx, ghostSx, labelSx, inputSx, selectMenuProps, tierLabel, two } from './apStyles';

const TYPES = [
    { id: 'zonecap', label: 'Pod limit', help: 'At least and/or at most N tables at a price in each pod' },
    { id: 'range', label: 'Price range', help: 'Only prices between two levels' },
    { id: 'lock', label: 'Lock', help: 'Fixed price for the chosen core hours' },
    { id: 'maxstep', label: 'Max step', help: 'A change moves at most N price levels' },
];
const KINDS = [['all', 'Whole floor'], ['sub', 'Sub-segment'], ['gt', 'Game'], ['zone', 'Pod'], ['table', 'Table'], ['tables', 'Tables (floor)']];
const kindOf = (scope) => (scope === 'all' ? 'all' : scope.slice(0, scope.indexOf(':')));
const valOf = (scope) => (scope === 'all' ? '' : scope.slice(scope.indexOf(':') + 1));

function Scope({ rule, onChange, options }) {
    const kind = kindOf(rule.scope), val = valOf(rule.scope);
    const list = options[kind] || [];
    const picked = kind === 'tables' ? scopeKeys(rule.scope) : [];
    return (
        <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center', flexWrap: kind === 'tables' ? 'wrap' : 'nowrap', rowGap: 0.5 }}>
            <Select size="small" value={kind} MenuProps={selectMenuProps} sx={{ ...inputSx, minWidth: 124 }} inputProps={{ 'aria-label': 'Scope' }}
                onChange={(e) => { const k = e.target.value; onChange(k === 'all' ? 'all' : k === 'tables' ? 'tables:' : `${k}:${(options[k] || [])[0] || ''}`); }}>
                {KINDS.map(([k, l]) => <MenuItem key={k} value={k}>{l}</MenuItem>)}
            </Select>
            {kind === 'tables' ? (
                picked.length ? picked.map((k) => (
                    <Box key={k} component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.3, pl: 0.9, pr: 0.3, py: 0.2, borderRadius: 4, border: `1px solid ${AP.line}`, fontSize: 12, fontWeight: 800, color: AP.text }}>
                        {k.replace('|', '')}
                        <IconButton size="small" aria-label={`Remove ${k.replace('|', '')} from this rule`} disabled={picked.length <= 1}
                            onClick={() => onChange(tablesScope(picked.filter((x) => x !== k)))}
                            sx={{ p: 0.2, color: AP.faint, '&:hover': { color: AP.bad }, '&.Mui-focusVisible': { outline: `2px solid ${AP.accent}` } }}>
                            <CloseIcon sx={{ fontSize: 13 }} />
                        </IconButton>
                    </Box>
                )) : <Typography sx={{ fontSize: 12.5, color: AP.faint }}>Select tables on the floor, then choose a condition.</Typography>
            ) : kind === 'table' ? (
                <Autocomplete size="small" options={list} value={val || null} onChange={(_, v) => v && onChange(`table:${v}`)}
                    sx={{ minWidth: 170 }} slotProps={{ paper: { sx: { bgcolor: AP.pop, color: AP.text } } }}
                    renderInput={(p) => <TextField {...p} sx={inputSx} placeholder="Table" slotProps={{ ...p.slotProps, htmlInput: { ...(p.slotProps || {}).htmlInput, 'aria-label': 'Table' } }} />} />
            ) : kind !== 'all' ? (
                <Select size="small" value={list.includes(val) ? val : ''} MenuProps={selectMenuProps} sx={{ ...inputSx, minWidth: 110 }} inputProps={{ 'aria-label': 'Scope value' }}
                    onChange={(e) => onChange(`${kind}:${e.target.value}`)}>
                    {list.map((v) => <MenuItem key={v} value={v}>{v}</MenuItem>)}
                </Select>
            ) : null}
        </Stack>
    );
}

// One-line description of a rule, for the Result panel.
export function ruleSummary(r, tierById) {
    const many = String(r.scope).startsWith('tables:') ? scopeKeys(r.scope) : null;
    const sc = many ? (many.length === 1 ? many[0].replace('|', '') : `${many.length} tables`)
        : r.scope === 'all' ? 'Whole floor' : r.scope.replace(/^sub:/, '').replace(/^gt:/, 'Game ').replace(/^zone:/, 'Pod ').replace(/^table:/, '').replace('|', '');
    const t = (id) => tierLabel(tierById.get(id));
    if (r.type === 'zonecap') {
        const parts = [r.minOn ? `≥ ${r.min}` : null, r.maxOn !== false ? `≤ ${r.n}` : null].filter(Boolean).join(' and ');
        return `${sc}: each pod ${parts || '(no limit on)'} × ${t(r.tier)}`;
    }
    if (r.type === 'range') return `${sc}: ${t(r.lo)}–${t(r.hi)}`;
    if (r.type === 'lock') return `${sc} = ${t(r.tier)} at ${r.hours.map(two).join(', ')}`;
    return `${sc}: ≤ ${r.n} level${r.n === 1 ? '' : 's'} per change`;
}

export default function RulesPanel({ cfg, onCfg, tiersAsc, options, costs, usedTiers = [], dayLabel = (d) => d, onRemoveManual, onClearManualDate }) {
    const rules = cfg.rules;
    const setRule = (id, patch) => onCfg({ ...cfg, rules: rules.map((r) => (r.id === id ? { ...r, ...patch } : r)) });
    const add = (type) => {
        const mid = tiersAsc[Math.floor(tiersAsc.length / 2)]?.id;
        const base = { id: cfg.nextRuleId, on: true, type, hours: [...CORE_HOURS] };
        const rule = type === 'zonecap' ? { ...base, scope: options.sub[0] ? `sub:${options.sub[0]}` : 'all', tier: mid, n: 1, maxOn: true, min: 0, minOn: false }
            : type === 'range' ? { ...base, scope: 'all', lo: tiersAsc[0]?.id, hi: tiersAsc[tiersAsc.length - 1]?.id }
            : type === 'lock' ? { ...base, scope: options.table[0] ? `table:${options.table[0]}` : 'all', tier: mid }
            : { ...base, scope: 'all', n: 2 };
        onCfg({ ...cfg, rules: [...rules, rule], nextRuleId: cfg.nextRuleId + 1 });
    };
    const tierSel = (value, onChange, label) => (
        <Select size="small" value={value || ''} MenuProps={selectMenuProps} sx={{ ...inputSx, minWidth: 96 }} inputProps={{ 'aria-label': label }} onChange={(e) => onChange(e.target.value)}>
            {tiersAsc.map((t) => <MenuItem key={t.id} value={t.id}>{tierLabel(t)}</MenuItem>)}
        </Select>
    );
    const num = (value, onChange, label, min) => (
        <TextField type="number" size="small" value={value} onChange={(e) => { const v = parseInt(e.target.value, 10); if (Number.isFinite(v) && v >= min) onChange(v); }}
            sx={{ ...inputSx, width: 64 }} slotProps={{ htmlInput: { min, 'aria-label': label, style: { textAlign: 'center' } } }} />
    );
    const text = { fontSize: 13.5, color: AP.text };
    const tierById = (id) => tiersAsc.find((t) => t.id === id);
    const switchSx = { '& .Mui-checked': { color: `${AP.accent} !important` }, '& .Mui-checked + .MuiSwitch-track': { bgcolor: `${AP.accent} !important` } };
    // One-click templates for common floor rules.
    const lowest = usedTiers[0] || tiersAsc[0]?.id, highest = usedTiers[usedTiers.length - 1] || tiersAsc[tiersAsc.length - 1]?.id;
    const addRule = (rule) => onCfg({ ...cfg, rules: [...rules, { id: cfg.nextRuleId, on: true, hours: [...CORE_HOURS], ...rule }], nextRuleId: cfg.nextRuleId + 1 });
    const TEMPLATES = [
        { label: `Each pod ≥ 1 × ${tierLabel(tierById(lowest))}`, help: 'Keeps an entry-level table in every pod', rule: { type: 'zonecap', scope: 'all', tier: lowest, n: 1, maxOn: false, min: 1, minOn: true } },
        { label: `Each pod ≤ 1 × ${tierLabel(tierById(highest))}`, help: 'Spreads the top price across pods', rule: { type: 'zonecap', scope: 'all', tier: highest, n: 1, maxOn: true, min: 0, minOn: false } },
        ...(options.gt[0] ? [{ label: `${options.gt[0]} ≤ ${tierLabel(tierById(usedTiers[Math.floor(usedTiers.length / 2)] || lowest))}`, help: 'A price ceiling for one game', rule: { type: 'range', scope: `gt:${options.gt[0]}`, lo: tiersAsc[0]?.id, hi: usedTiers[Math.floor(usedTiers.length / 2)] || lowest } }] : []),
    ];
    const manual = Object.entries(cfg.manual || {}).sort(([a], [b]) => a.localeCompare(b));
    const nManual = manual.reduce((a, [, byCore]) => a + Object.values(byCore).reduce((b, m) => b + Object.keys(m).length, 0), 0);

    return (
        <Stack spacing={1.2}>
            <Box sx={panelSx}>
                <Typography component="h2" sx={{ ...titleSx, mb: 0.5 }}>Rules</Typography>
                <Typography sx={{ fontSize: 12.5, color: AP.faint, mb: 1 }}>Hard limits — the solver never breaks an active rule. For specific tables, select them on the floor and pick a condition in the panel that opens.</Typography>
                <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 0.6 }}>
                    {TYPES.map((t) => (
                        <Tooltip key={t.id} title={t.help}><Button sx={ghostSx} startIcon={<AddIcon sx={{ fontSize: 17 }} />} onClick={() => add(t.id)}>{t.label}</Button></Tooltip>
                    ))}
                </Stack>
                <Typography sx={{ ...labelSx, fontSize: 10.5, mt: 1.2, mb: 0.5 }}>Quick add</Typography>
                <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 0.6 }}>
                    {TEMPLATES.map((t) => (
                        <Tooltip key={t.label} title={t.help}>
                            <Button size="small" sx={{ ...ghostSx, minHeight: 30, fontSize: 12.5, borderStyle: 'dashed' }} onClick={() => addRule(t.rule)}>{t.label}</Button>
                        </Tooltip>
                    ))}
                </Stack>
            </Box>
            <Box sx={panelSx}>
                <Stack direction="row" sx={{ alignItems: 'baseline', gap: 1, mb: 0.5 }}>
                    <Typography component="h3" sx={{ fontSize: 15.5, fontWeight: 800, color: '#fff' }}>Manual prices</Typography>
                    <Typography sx={{ fontSize: 12.5, color: AP.faint }}>{nManual ? `${nManual} on ${manual.length} date${manual.length === 1 ? '' : 's'}` : 'none'}</Typography>
                </Stack>
                <Typography sx={{ fontSize: 12.5, color: AP.faint, mb: nManual ? 1 : 0 }}>
                    Select tables on the floor and pick a price (or use “Keep” in Result). Each is a rule for that date and core-hour block; the date is solved again around it.
                </Typography>
                {manual.map(([date, byCore]) => (
                    <Box key={date} sx={{ mb: 1 }}>
                        <Stack direction="row" sx={{ alignItems: 'center', gap: 1, mb: 0.4 }}>
                            <Typography sx={{ fontSize: 13, fontWeight: 800, color: AP.text, fontVariantNumeric: 'tabular-nums' }}>{date}</Typography>
                            <Typography sx={{ fontSize: 12, color: AP.faint }}>{dayLabel(date)}</Typography>
                            <Box sx={{ flex: 1 }} />
                            <Button size="small" sx={{ ...ghostSx, minHeight: 26, py: 0, fontSize: 12 }} onClick={() => onClearManualDate(date)}>Clear date</Button>
                        </Stack>
                        <Box sx={{ display: 'grid', gridTemplateColumns: 'auto auto 1fr auto', columnGap: 1.2, rowGap: 0.2, alignItems: 'center' }}>
                            {Object.entries(byCore).sort(([a], [b]) => CORE_HOURS.indexOf(Number(a)) - CORE_HOURS.indexOf(Number(b))).flatMap(([core, byKey]) => Object.entries(byKey).map(([key, id]) => (
                                <React.Fragment key={`${core}|${key}`}>
                                    <Typography sx={{ fontSize: 12.5, fontWeight: 800, color: AP.text }}>{key.replace('|', '')}</Typography>
                                    <Typography sx={{ fontSize: 12, color: AP.faint, fontVariantNumeric: 'tabular-nums' }}>{CORE_HOURS.includes(Number(core)) ? blockLabel(Number(core)) : `${two(core)}:00`}</Typography>
                                    <Typography sx={{ fontSize: 12.5, color: AP.pin, fontWeight: 800 }}>{tierLabel(tierById(id))}</Typography>
                                    <IconButton size="small" aria-label={`Remove manual price for ${key.replace('|', '')} at ${two(core)}:00 on ${date}`} onClick={() => onRemoveManual(date, Number(core), key)}
                                        sx={{ p: 0.3, color: AP.faint, '&:hover': { color: AP.bad }, '&.Mui-focusVisible': { outline: `2px solid ${AP.accent}` } }}>
                                        <CloseIcon sx={{ fontSize: 15 }} />
                                    </IconButton>
                                </React.Fragment>
                            )))}
                        </Box>
                    </Box>
                ))}
            </Box>
            {rules.length ? rules.map((r) => {
                const cost = costs ? costs.get(r.id) : null;
                return (
                    <Box key={r.id} sx={{ ...panelSx, opacity: r.on ? 1 : 0.55, display: 'grid', gap: 1 }}>
                        <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                            <Switch size="small" checked={r.on} onChange={(e) => setRule(r.id, { on: e.target.checked })} slotProps={{ input: { 'aria-label': `${TYPES.find((t) => t.id === r.type).label} rule on` } }}
                                sx={{ '& .Mui-checked': { color: `${AP.accent} !important` }, '& .Mui-checked + .MuiSwitch-track': { bgcolor: `${AP.accent} !important` } }} />
                            <Typography sx={{ fontWeight: 800, fontSize: 15, color: '#fff' }}>{TYPES.find((t) => t.id === r.type).label}</Typography>
                            <Box sx={{ flex: 1 }} />
                            {cost != null ? (
                                <Tooltip title="Extra changes per day this rule causes (the day solved again without it)">
                                    <Typography sx={{ fontSize: 12.5, fontWeight: 800, color: cost > 0 ? AP.warn : AP.faint, fontVariantNumeric: 'tabular-nums' }}>{cost > 0 ? `+${cost} changes` : 'no extra changes'}</Typography>
                                </Tooltip>
                            ) : null}
                            <IconButton size="small" aria-label="Delete rule" onClick={() => onCfg({ ...cfg, rules: rules.filter((x) => x.id !== r.id) })} sx={{ color: AP.muted, '&:hover': { color: AP.bad } }}>
                                <DeleteOutlineIcon sx={{ fontSize: 19 }} />
                            </IconButton>
                        </Stack>
                        <Stack direction="row" sx={{ alignItems: 'center', flexWrap: 'wrap', gap: 0.8 }}>
                            <Scope rule={r} options={options} onChange={(scope) => setRule(r.id, { scope })} />
                            {r.type === 'zonecap' && (
                                <>
                                    <Typography sx={text}>each pod</Typography>
                                    {tierSel(r.tier, (tier) => setRule(r.id, { tier }), 'Price')}
                                    <Box sx={{ flexBasis: '100%', height: 0 }} />
                                    <Stack direction="row" sx={{ alignItems: 'center', gap: 0.6 }}>
                                        <Switch size="small" checked={!!r.minOn} onChange={(e) => setRule(r.id, { minOn: e.target.checked, min: r.min || 1 })} slotProps={{ input: { 'aria-label': 'At least on' } }} sx={switchSx} />
                                        <Typography sx={{ ...text, opacity: r.minOn ? 1 : 0.55 }}>at least</Typography>
                                        {num(r.min || 0, (min) => setRule(r.id, { min }), 'At least tables per pod', 0)}
                                    </Stack>
                                    <Stack direction="row" sx={{ alignItems: 'center', gap: 0.6 }}>
                                        <Switch size="small" checked={r.maxOn !== false} onChange={(e) => setRule(r.id, { maxOn: e.target.checked })} slotProps={{ input: { 'aria-label': 'At most on' } }} sx={switchSx} />
                                        <Typography sx={{ ...text, opacity: r.maxOn !== false ? 1 : 0.55 }}>at most</Typography>
                                        {num(r.n, (n) => setRule(r.id, { n }), 'At most tables per pod', 0)}
                                    </Stack>
                                </>
                            )}
                            {r.type === 'range' && (<><Typography sx={text}>only</Typography>{tierSel(r.lo, (lo) => setRule(r.id, { lo }), 'Lowest price')}<Typography sx={text}>to</Typography>{tierSel(r.hi, (hi) => setRule(r.id, { hi }), 'Highest price')}</>)}
                            {r.type === 'lock' && (<><Typography sx={text}>fixed at</Typography>{tierSel(r.tier, (tier) => setRule(r.id, { tier }), 'Price')}</>)}
                            {r.type === 'maxstep' && (<><Typography sx={text}>changes move at most</Typography>{num(r.n, (n) => setRule(r.id, { n }), 'Levels per change', 1)}<Typography sx={text}>price level(s)</Typography></>)}
                        </Stack>
                        <Stack direction="row" spacing={0.4} sx={{ alignItems: 'center' }} role="group" aria-label="Core hours">
                            <Typography sx={{ ...labelSx, fontSize: 10.5, mr: 0.5 }}>Hours</Typography>
                            {CORE_HOURS.map((h) => {
                                const on = r.hours.includes(h);
                                return (
                                    <Box key={h} component="button" type="button" aria-pressed={on}
                                        onClick={() => setRule(r.id, { hours: on ? r.hours.filter((x) => x !== h) : [...r.hours, h] })}
                                        sx={{ all: 'unset', cursor: 'pointer', width: 30, textAlign: 'center', py: 0.3, borderRadius: 1, fontSize: 11.5, fontWeight: 800, border: `1px solid ${on ? AP.accent : AP.lineSoft}`, color: on ? AP.accent : AP.faint, '&:focus-visible': { outline: `2px solid ${AP.accent}` } }}>
                                        {two(h)}
                                    </Box>
                                );
                            })}
                        </Stack>
                    </Box>
                );
            }) : (
                <Typography sx={{ fontSize: 13, color: AP.faint, px: 1 }}>No rules yet. Use Quick add above, or select tables on the floor to lock their price.</Typography>
            )}
        </Stack>
    );
}
