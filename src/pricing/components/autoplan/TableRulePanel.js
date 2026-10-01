// Table rule panel — pops up over the floor in Auto-plan when tables are
// selected (click to add or remove, or lasso). Pick a condition and press
// Apply: a lock / price range / max step becomes one rule for all selected
// tables (every date, chosen core hours); "This date only" sets a manual
// price for this date + block. The floor is solved again either way.

import React, { useEffect, useState } from 'react';
import { Box, Button, ButtonBase, MenuItem, Select, Stack, TextField, Typography } from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import { AP, ghostSx, primarySx, labelSx, inputSx, selectMenuProps, tierLabel, two } from './apStyles';

const MODES = [['lock', 'Lock price'], ['range', 'Price range'], ['maxstep', 'Max step'], ['manual', 'This date only']];

function PriceButtons({ tiers, value, onChange }) {
    return (
        <Stack direction="row" role="radiogroup" aria-label="Price" sx={{ gap: 0.5, flexWrap: 'wrap' }}>
            {tiers.map((t) => {
                const on = value === t.id;
                return (
                    <ButtonBase key={t.id} role="radio" aria-checked={on} onClick={() => onChange(t.id)}
                        sx={{
                            gap: 0.5, px: 1, py: 0.5, borderRadius: 1.5, fontSize: 12.5, fontWeight: 800,
                            color: on ? AP.accentInk : AP.text, bgcolor: on ? AP.pin : 'rgba(255,255,255,0.04)',
                            border: `1px solid ${on ? AP.pin : AP.line}`, '&:hover': on ? undefined : { borderColor: AP.pin },
                            '&.Mui-focusVisible': { outline: `2px solid ${AP.accent}`, outlineOffset: 2 },
                        }}>
                        <Box component="span" sx={{ width: 9, height: 9, borderRadius: 0.4, bgcolor: t.color, border: '1px solid rgba(0,0,0,0.4)' }} />
                        {tierLabel(t)}
                    </ButtonBase>
                );
            })}
        </Stack>
    );
}

export default function TableRulePanel({
    keys, labelOf, tiers, coreHours, currentCore, blockText, dateText, currentTier, manualCount,
    onApplyRule, onSetManual, onClearManual, onDeselect, busy,
}) {
    const [mode, setMode] = useState('lock');
    const [tier, setTier] = useState(currentTier || null);
    const [lo, setLo] = useState(tiers[0]?.id || '');
    const [hi, setHi] = useState(tiers[tiers.length - 1]?.id || '');
    const [n, setN] = useState(1);
    const [hours, setHours] = useState(coreHours);
    useEffect(() => { setTier(currentTier || null); }, [currentTier]);
    if (!keys.length) return null;

    const tl = (id) => tierLabel(tiers.find((t) => t.id === id));
    const hoursText = hours.length === coreHours.length ? 'every core hour' : hours.map(two).join(', ');
    const names = keys.map(labelOf);
    const who = keys.length === 1 ? names[0] : `${keys.length} tables`;
    const valid = mode === 'lock' ? !!tier && hours.length > 0
        : mode === 'range' ? lo && hi && tiers.findIndex((t) => t.id === lo) <= tiers.findIndex((t) => t.id === hi) && hours.length > 0
            : mode === 'maxstep' ? n >= 1 && hours.length > 0
                : !!tier;
    const summary = mode === 'lock' ? (tier ? `Lock ${who} at ${tl(tier)}, ${hoursText}, every date.` : 'Pick a price.')
        : mode === 'range' ? `Keep ${who} between ${tl(lo)} and ${tl(hi)}, ${hoursText}, every date.`
            : mode === 'maxstep' ? `${who}: a change moves at most ${n} price level${n === 1 ? '' : 's'}, ${hoursText}.`
                : (tier ? `Set ${who} to ${tl(tier)} for block ${blockText} on ${dateText} only.` : 'Pick a price.');
    const apply = () => {
        if (mode === 'manual') onSetManual(tier);
        else onApplyRule(mode === 'lock' ? { type: 'lock', tier, hours } : mode === 'range' ? { type: 'range', lo, hi, hours } : { type: 'maxstep', n, hours }, summary);
    };
    const sel = (value, onChange, label) => (
        <Select size="small" value={value} MenuProps={selectMenuProps} sx={{ ...inputSx, minWidth: 104 }} inputProps={{ 'aria-label': label }} onChange={(e) => onChange(e.target.value)}>
            {tiers.map((t) => <MenuItem key={t.id} value={t.id}>{tierLabel(t)}</MenuItem>)}
        </Select>
    );

    return (
        <Box role="dialog" aria-label="Rule for the selected tables"
            sx={{
                position: 'absolute', top: 56, right: 12, zIndex: 20, width: 'min(560px, calc(100% - 24px))',
                p: 1.4, borderRadius: 2, bgcolor: 'rgba(10,22,35,0.96)', border: `1px solid ${AP.pin}`, backdropFilter: 'blur(8px)',
                boxShadow: '0 12px 34px rgba(0,0,0,0.5)',
            }}>
            <Stack direction="row" sx={{ alignItems: 'baseline', gap: 1, mb: 0.6 }}>
                <Typography sx={{ fontSize: 15, fontWeight: 900, color: '#fff' }}>{keys.length} table{keys.length === 1 ? '' : 's'} selected</Typography>
                <Typography sx={{ fontSize: 12, color: AP.faint }}>click tables to add or remove · lasso for many</Typography>
                <Box sx={{ flex: 1 }} />
                <Button size="small" sx={{ ...ghostSx, minHeight: 26, py: 0, px: 0.8, border: 'none' }} startIcon={<CloseIcon sx={{ fontSize: 15 }} />} onClick={onDeselect}>Deselect</Button>
            </Stack>
            <Typography sx={{ fontSize: 12, color: AP.muted, mb: 1, lineHeight: 1.5, maxHeight: 38, overflow: 'hidden' }} title={names.join(', ')}>
                {names.slice(0, 12).join(' · ')}{names.length > 12 ? ` · +${names.length - 12} more` : ''}
            </Typography>

            <Stack direction="row" role="radiogroup" aria-label="Condition" sx={{ border: `1px solid ${AP.line}`, borderRadius: 1.5, overflow: 'hidden', mb: 1.1 }}>
                {MODES.map(([v, l]) => {
                    const on = v === mode;
                    return (
                        <Box key={v} component="button" type="button" role="radio" aria-checked={on} onClick={() => setMode(v)}
                            sx={{
                                all: 'unset', cursor: 'pointer', flex: 1, textAlign: 'center', py: 0.7, fontSize: 13, fontWeight: 800,
                                color: on ? AP.accentInk : AP.text, bgcolor: on ? AP.accent : 'transparent',
                                '&:hover': on ? undefined : { bgcolor: 'rgba(122,223,255,0.08)' },
                                '&:focus-visible': { outline: `2px solid ${AP.accent}`, outlineOffset: -2 }, '& + &': { borderLeft: `1px solid ${AP.line}` },
                            }}>
                            {l}
                        </Box>
                    );
                })}
            </Stack>

            {mode === 'lock' || mode === 'manual' ? <PriceButtons tiers={tiers} value={tier} onChange={setTier} /> : null}
            {mode === 'range' ? (
                <Stack direction="row" sx={{ alignItems: 'center', gap: 0.8 }}>
                    <Typography sx={{ fontSize: 13.5, color: AP.text }}>Only</Typography>{sel(lo, setLo, 'Lowest price')}
                    <Typography sx={{ fontSize: 13.5, color: AP.text }}>to</Typography>{sel(hi, setHi, 'Highest price')}
                </Stack>
            ) : null}
            {mode === 'maxstep' ? (
                <Stack direction="row" sx={{ alignItems: 'center', gap: 0.8 }}>
                    <Typography sx={{ fontSize: 13.5, color: AP.text }}>A change moves at most</Typography>
                    <TextField size="small" type="number" value={n} onChange={(e) => setN(Math.max(1, parseInt(e.target.value, 10) || 1))}
                        sx={{ ...inputSx, width: 64 }} slotProps={{ htmlInput: { min: 1, 'aria-label': 'Levels per change', style: { textAlign: 'center' } } }} />
                    <Typography sx={{ fontSize: 13.5, color: AP.text }}>price level(s)</Typography>
                </Stack>
            ) : null}

            {mode !== 'manual' ? (
                <Stack direction="row" sx={{ alignItems: 'center', gap: 0.4, mt: 1.1, flexWrap: 'wrap' }} role="group" aria-label="Core hours">
                    <Typography sx={{ ...labelSx, fontSize: 10.5, mr: 0.5 }}>Hours</Typography>
                    {coreHours.map((h) => {
                        const on = hours.includes(h);
                        return (
                            <Box key={h} component="button" type="button" aria-pressed={on}
                                onClick={() => setHours(on ? hours.filter((x) => x !== h) : coreHours.filter((x) => x === h || hours.includes(x)))}
                                sx={{ all: 'unset', cursor: 'pointer', width: 30, textAlign: 'center', py: 0.3, borderRadius: 1, fontSize: 11.5, fontWeight: 800, border: `1px solid ${on ? AP.accent : AP.lineSoft}`, color: on ? AP.accent : AP.faint, '&:focus-visible': { outline: `2px solid ${AP.accent}` } }}>
                                {two(h)}
                            </Box>
                        );
                    })}
                    <Button size="small" sx={{ ...ghostSx, minHeight: 24, py: 0, px: 0.8, fontSize: 11.5, border: 'none' }}
                        onClick={() => setHours(hours.length === coreHours.length ? [currentCore] : coreHours)}>
                        {hours.length === coreHours.length ? `Only ${two(currentCore)}` : 'All hours'}
                    </Button>
                </Stack>
            ) : (
                <Typography sx={{ fontSize: 12, color: AP.faint, mt: 1 }}>Block {blockText} · {dateText}</Typography>
            )}

            <Stack direction="row" sx={{ alignItems: 'center', gap: 1, mt: 1.3, pt: 1.1, borderTop: `1px solid ${AP.lineSoft}` }}>
                <Typography role="status" sx={{ fontSize: 12.5, color: valid ? AP.text : AP.faint, flex: 1 }}>{summary}</Typography>
                {mode === 'manual' && manualCount ? (
                    <Button size="small" sx={ghostSx} disabled={busy} onClick={onClearManual}>Clear manual ({manualCount})</Button>
                ) : null}
                <Button sx={primarySx} disabled={!valid || busy} onClick={apply}>{mode === 'manual' ? 'Set price' : 'Add rule'}</Button>
            </Stack>
        </Box>
    );
}
