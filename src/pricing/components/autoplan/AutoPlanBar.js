// Auto-plan toolbar row: planning period, day types (with per-date
// overrides for holidays), the two keep-options, Solve, and once a draft
// exists, Apply / Discard.

import React, { useRef, useState } from 'react';
import {
    Box, Button, Checkbox, FormControlLabel, IconButton, LinearProgress, MenuItem, Popover, Select, Stack, TextField, Tooltip, Typography,
} from '@mui/material';
import CalendarMonthIcon from '@mui/icons-material/CalendarMonth';
import AutoFixHighIcon from '@mui/icons-material/AutoFixHigh';
import DeleteOutlineIcon from '@mui/icons-material/Delete';
import CheckIcon from '@mui/icons-material/Check';
import { DAY_TYPES, DOW_LABELS } from '../../utils/autoplan/core';
import { AP, ghostSx, primarySx, labelSx, inputSx, selectMenuProps } from './apStyles';

const DT_LABEL = Object.fromEntries(DAY_TYPES.map((d) => [d.id, d.label]));

function DayTypeEditor({ cfg, onCfg, period }) {
    const [date, setDate] = useState(period.from);
    const [dt, setDt] = useState('sat');
    const overrides = Object.entries(cfg.overrides || {}).sort(([a], [b]) => a.localeCompare(b));
    return (
        <Box sx={{ p: 2, width: 360, bgcolor: AP.pop, color: AP.text }}>
            <Typography sx={{ ...labelSx, mb: 1 }}>Weekday → day type</Typography>
            <Box sx={{ display: 'grid', gridTemplateColumns: '48px 1fr', gap: 0.75, alignItems: 'center', mb: 2 }}>
                {[1, 2, 3, 4, 5, 6, 0].map((dow) => (
                    <React.Fragment key={dow}>
                        <Typography sx={{ fontWeight: 800, fontSize: 13.5 }}>{DOW_LABELS[dow]}</Typography>
                        <Select size="small" value={cfg.dowMap[dow]} MenuProps={selectMenuProps} sx={inputSx}
                            inputProps={{ 'aria-label': `${DOW_LABELS[dow]} day type` }}
                            onChange={(e) => onCfg({ ...cfg, dowMap: { ...cfg.dowMap, [dow]: e.target.value } })}>
                            {DAY_TYPES.map((d) => <MenuItem key={d.id} value={d.id}>{d.label}</MenuItem>)}
                        </Select>
                    </React.Fragment>
                ))}
            </Box>
            <Typography sx={{ ...labelSx, mb: 0.5 }}>Date overrides (holidays)</Typography>
            <Stack spacing={0.5} sx={{ mb: 1 }}>
                {overrides.length ? overrides.map(([d, t]) => (
                    <Stack key={d} direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                        <Typography sx={{ fontSize: 13.5, fontWeight: 700, flex: 1, fontVariantNumeric: 'tabular-nums' }}>{d}</Typography>
                        <Typography sx={{ fontSize: 13.5, color: AP.accent, fontWeight: 800 }}>{DT_LABEL[t]}</Typography>
                        <IconButton size="small" aria-label={`Remove override for ${d}`} sx={{ color: AP.muted }}
                            onClick={() => { const o = { ...cfg.overrides }; delete o[d]; onCfg({ ...cfg, overrides: o }); }}>
                            <DeleteOutlineIcon sx={{ fontSize: 18 }} />
                        </IconButton>
                    </Stack>
                )) : <Typography sx={{ fontSize: 13, color: AP.faint }}>None. Add a holiday to plan it like a weekend.</Typography>}
            </Stack>
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                <TextField type="date" size="small" value={date} onChange={(e) => setDate(e.target.value)} sx={{ ...inputSx, flex: 1, colorScheme: 'dark' }}
                    slotProps={{ htmlInput: { 'aria-label': 'Override date' } }} />
                <Select size="small" value={dt} onChange={(e) => setDt(e.target.value)} MenuProps={selectMenuProps} sx={inputSx} inputProps={{ 'aria-label': 'Override day type' }}>
                    {DAY_TYPES.map((d) => <MenuItem key={d.id} value={d.id}>{d.label}</MenuItem>)}
                </Select>
                <Button sx={ghostSx} disabled={!date} onClick={() => onCfg({ ...cfg, overrides: { ...cfg.overrides, [date]: dt } })}>Add</Button>
            </Stack>
        </Box>
    );
}

export default function AutoPlanBar({
    period, onPeriod, cfg, onCfg, dateCounts, keepPins, onKeepPins, base, onBase, baseVersions = [],
    onSolve, solving, progress, draftDates, onApply, onDiscard, note, ready, stale,
}) {
    const anchor = useRef(null);
    const [open, setOpen] = useState(false);
    const summary = DAY_TYPES.map((d) => `${d.label} ${dateCounts[d.id] || 0}`).join(' · ');
    const nOverrides = Object.keys(cfg.overrides || {}).length;
    const chk = (v, on, label, hint) => (
        <Tooltip title={hint}>
            <FormControlLabel
                control={<Checkbox size="small" checked={v} onChange={(e) => on(e.target.checked)} sx={{ color: AP.muted, '&.Mui-checked': { color: AP.accent } }} />}
                label={label}
                sx={{ mr: 0, '& .MuiFormControlLabel-label': { fontSize: 13.5, fontWeight: 700, color: AP.text } }}
            />
        </Tooltip>
    );

    return (
        <Stack spacing={0.75} sx={{ width: '100%' }}>
            <Stack direction="row" sx={{ alignItems: 'center', flexWrap: 'wrap', gap: 1.25 }}>
                <Typography sx={labelSx}>Period</Typography>
                <TextField type="date" size="small" value={period.from} sx={{ ...inputSx, width: 158, colorScheme: 'dark' }}
                    slotProps={{ htmlInput: { 'aria-label': 'Period from', max: period.to } }}
                    onChange={(e) => e.target.value && onPeriod({ ...period, from: e.target.value })} />
                <Typography sx={{ color: AP.muted }}>–</Typography>
                <TextField type="date" size="small" value={period.to} sx={{ ...inputSx, width: 158, colorScheme: 'dark' }}
                    slotProps={{ htmlInput: { 'aria-label': 'Period to', min: period.from } }}
                    onChange={(e) => e.target.value && onPeriod({ ...period, to: e.target.value })} />
                <Button ref={anchor} sx={ghostSx} startIcon={<CalendarMonthIcon sx={{ fontSize: 18 }} />} onClick={() => setOpen(true)} aria-haspopup="dialog">
                    {summary}{nOverrides ? ` · ${nOverrides} override${nOverrides === 1 ? '' : 's'}` : ''}
                </Button>
                <Popover open={open} anchorEl={anchor.current} onClose={() => setOpen(false)}
                    anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
                    slotProps={{ paper: { sx: { bgcolor: AP.pop, border: `1px solid ${AP.line}`, backgroundImage: 'none' } } }}>
                    <DayTypeEditor cfg={cfg} onCfg={onCfg} period={period} />
                </Popover>
                {chk(keepPins, onKeepPins, 'Keep pinned tables', 'Tables pinned in Planning (or with “Keep previous”) keep their price')}
                <Stack direction="row" sx={{ alignItems: 'center', gap: 0.75 }} role="group" aria-label="Base plan">
                    <Tooltip title="The plan to adjust: Auto-plan meets the new target mix and changes as few tables from it as it can">
                        <Typography sx={labelSx}>Base plan</Typography>
                    </Tooltip>
                    <Select size="small" value={base.source} MenuProps={selectMenuProps} sx={{ ...inputSx, minWidth: 190 }} inputProps={{ 'aria-label': 'Base plan source' }}
                        onChange={(e) => onBase({ ...base, source: e.target.value })}>
                        <MenuItem value="calendar">Plan on the calendar</MenuItem>
                        {baseVersions.map((v) => (
                            <MenuItem key={v.n} value={`v:${v.n}`}>{`Version ${v.n}${v.name ? ` · ${v.name}` : ''}`}{v.dates > 1 ? ` (${v.dates} dates)` : ''}</MenuItem>
                        ))}
                        <MenuItem value="none">No base plan</MenuItem>
                    </Select>
                    {base.source !== 'none' ? (
                        <Select size="small" value={base.strength} MenuProps={selectMenuProps} sx={{ ...inputSx, minWidth: 170 }} inputProps={{ 'aria-label': 'How close to the base plan' }}
                            onChange={(e) => onBase({ ...base, strength: e.target.value })}>
                            <MenuItem value="strong">Keep as close as possible</MenuItem>
                            <MenuItem value="tie">Only as a tie-break</MenuItem>
                        </Select>
                    ) : null}
                </Stack>
                <Box sx={{ flex: 1 }} />
                {draftDates ? (
                    <>
                        <Button sx={ghostSx} onClick={onDiscard}>Discard draft</Button>
                        <Button sx={stale ? ghostSx : primarySx} startIcon={<CheckIcon />} onClick={onApply}>Apply {draftDates} date{draftDates === 1 ? '' : 's'}…</Button>
                    </>
                ) : null}
                <Button sx={draftDates && !stale ? ghostSx : primarySx} startIcon={<AutoFixHighIcon />} disabled={solving || !ready} onClick={onSolve}
                    aria-describedby={stale && !solving ? 'ap-stale' : undefined}>
                    {solving ? `Solving ${progress.done}/${progress.total}…` : draftDates ? 'Solve again' : 'Solve period'}
                </Button>
            </Stack>
            {solving ? <LinearProgress variant="determinate" value={progress.total ? (progress.done / progress.total) * 100 : 0} aria-label="Solving progress"
                sx={{ height: 4, borderRadius: 2, bgcolor: 'rgba(255,255,255,0.08)', '& .MuiLinearProgress-bar': { bgcolor: AP.accent } }} /> : null}
            {stale && draftDates && !solving ? (
                <Typography id="ap-stale" role="status" sx={{ fontSize: 12.5, color: AP.warn }}>
                    Targets, rules or criteria changed since this draft was solved. Solve again to update it.
                </Typography>
            ) : null}
            {note ? <Typography role="status" sx={{ fontSize: 12.5, color: AP.warn }}>{note}</Typography> : null}
        </Stack>
    );
}
