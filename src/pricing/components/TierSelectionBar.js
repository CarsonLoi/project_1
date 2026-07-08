// TierSelectionBar — floating price editor for a floor selection
// ==============================================================
//
// Pops up at the bottom-center of the floor map whenever tables are
// selected (rectangle / polygon / click). It's a DRAFT editor: you set
// the opening Base price plus the adjustable Min–Max boundary, and
// NOTHING is committed until you click "Apply". That's the key UX fix —
// choosing a base no longer dismisses the bar, so base + boundary are
// always set together.
//
// Commit actions (each clears the selection → the lasso box disappears):
//   • Apply              — write { base, min, max } to every selected table
//   • Suggest from demand — auto-fill each table with a demand-driven band
//   • Clear minimum      — un-price the selection
// The X / Esc cancel without committing.

import React, { useState, useEffect } from 'react';
import { Box, Stack, Typography, IconButton, Button, Tooltip, Select, MenuItem, Checkbox, CircularProgress, TextField } from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import BackspaceOutlinedIcon from '@mui/icons-material/BackspaceOutlined';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import HistoryIcon from '@mui/icons-material/History';
import LockIcon from '@mui/icons-material/Lock';
import LockOpenIcon from '@mui/icons-material/LockOpen';
import { formatMinimum, UNPRICED_COLOR } from '../constants/defaultTiers';
import { readPrice } from '../utils/pricingModel';
import { DOW_LABELS } from '../utils/pricingHistory';
import { PRICING_FONTS } from '../constants/fontSizes';

const SB = PRICING_FONTS.selectionBar;

export default function TierSelectionBar({
    selectedKeys,        // Set<string>
    assignments,         // { [tableKey]: {base,min,max}|tierId } — current period's map
    tiers,               // tier list
    onApplyTriple,       // (minId, baseId, maxId) => void — commit base + boundary
    onClearTier,         // () => void — unprice the selection
    onClear,             // () => void — empty the selection (cancel)
    onSuggestRange,      // () => void — demand-driven per-table suggestion
    suggestLoading,      // boolean — demand reference fetch in flight
    demand,              // Map<tableKey, {value, occupancy}> | null
    suggestions,         // Map<tableKey, {base,min,max}> | null
    history,             // { [tableKey]: value } — last saved version's plan
    // History-mode suggestion (mode minimum + historical min/max).
    onSuggestHistory,    // () => void — apply history-based suggestion
    histRange,           // { from, to } reference window
    onHistRangeChange,   // (next) => void
    histDows,            // number[] selected weekdays (0=Sun … 6=Sat); [] = all
    onHistDowsChange,    // (next) => void
    histHours,           // number[] reference hours (non-consecutive ok) | null = all
    onHistHoursChange,   // (next) => void
    histLoading,         // boolean
    flexEnabled = true,  // global Min–Max range switch — hides boundary panel when off
    boundaryPresets = [], // [{ id, label, min, max }] quick Min–Max combos
}) {
    const [histOpen, setHistOpen] = useState(false);
    const [fixed, setFixed] = useState(false); // mark selection as fixed-price (locked)
    const toggleDow = (d) => {
        const set = new Set(histDows || []);
        if (set.has(d)) set.delete(d); else set.add(d);
        onHistDowsChange([...set].sort((a, b) => a - b));
    };
    const count = selectedKeys ? selectedKeys.size : 0;
    const tierMap = new Map((tiers || []).map((t) => [t.id, t]));
    const sortedTiers = [...(tiers || [])].sort((a, b) => (a.min || 0) - (b.min || 0));
    const lbl = (id) => tierMap.get(id)?.label || formatMinimum(tierMap.get(id)?.min);
    const tierVal = (id) => tierMap.get(id)?.min ?? 0;

    // Draft { base, min, max }. Seeded from the selection's common value
    // (if uniform) or a fixed default; re-seeded whenever the selection
    // changes. `boundaryTouched` tracks whether the user has explicitly
    // widened Min/Max — until they do, picking a base keeps it fixed.
    const [minId, setMinId] = useState(tiers?.[0]?.id || '');
    const [baseId, setBaseId] = useState(tiers?.[0]?.id || '');
    const [maxId, setMaxId] = useState(tiers?.[0]?.id || '');
    const [boundaryTouched, setBoundaryTouched] = useState(false);

    const selSig = [...(selectedKeys || [])].sort().join(',');
    useEffect(() => {
        const keys = [...(selectedKeys || [])];
        let common = null, uniform = true, allFixed = keys.length > 0;
        for (const k of keys) {
            const p = readPrice((assignments || {})[k]);
            const sig = p ? `${p.min}|${p.base}|${p.max}` : '__none';
            if (common === null) common = sig; else if (common !== sig) { uniform = false; }
            if (!p || !p.fixed) allFixed = false;
        }
        if (uniform && common && common !== '__none') {
            const [mn, bs, mx] = common.split('|');
            setMinId(mn); setBaseId(bs); setMaxId(mx);
            setBoundaryTouched(mn !== mx);
        } else {
            const mid = (tiers && tiers[Math.min(1, (tiers.length || 1) - 1)]?.id) || tiers?.[0]?.id || '';
            setMinId(mid); setBaseId(mid); setMaxId(mid);
            setBoundaryTouched(false);
        }
        setFixed(allFixed);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selSig]);

    // Snap a boundary preset's $ Min/Max onto the nearest tiers and apply.
    const applyPreset = (p) => {
        const snap = (val) => {
            let best = sortedTiers[0]?.id, bestD = Infinity;
            for (const t of sortedTiers) { const d = Math.abs((t.min || 0) - val); if (d < bestD) { bestD = d; best = t.id; } }
            return best;
        };
        const mn = snap(p.min), mx = snap(p.max);
        setMinId(mn); setMaxId(mx); setBoundaryTouched(true);
        if (tierVal(baseId) < tierVal(mn)) setBaseId(mn);
        if (tierVal(baseId) > tierVal(mx)) setBaseId(mx);
    };

    // Pick an opening base. If the boundary is still "fixed" (user hasn't
    // widened it), Min/Max follow the base. Once they've set a boundary,
    // a new base just clamps inside it.
    const pickBase = (id) => {
        setBaseId(id);
        if (!boundaryTouched) { setMinId(id); setMaxId(id); return; }
        if (tierVal(id) < tierVal(minId)) setMinId(id);
        if (tierVal(id) > tierVal(maxId)) setMaxId(id);
    };
    const pickMin = (id) => { setMinId(id); setBoundaryTouched(true); if (tierVal(baseId) < tierVal(id)) setBaseId(id); };
    const pickMax = (id) => { setMaxId(id); setBoundaryTouched(true); if (tierVal(baseId) > tierVal(id)) setBaseId(id); };

    if (count === 0) return null;

    // Selection-level demand context (once the reference is loaded): mean
    // theo-per-patron-hour + avg patrons across selected tables with data.
    let dN = 0, dVal = 0, dOcc = 0;
    for (const k of selectedKeys) {
        const s = demand && demand.get(k);
        if (s && s.value > 0) { dN += 1; dVal += s.value; dOcc += s.occupancy; }
    }
    const hasDemand = dN > 0;
    const meanVal = hasDemand ? dVal / dN : 0;
    const meanOcc = hasDemand ? dOcc / dN : 0;
    // Representative suggested band across the selection.
    let sugCount = 0, sugUniform = true, sugFirst = null;
    if (suggestions) {
        for (const k of selectedKeys) {
            const t = suggestions.get(k);
            if (!t) continue;
            sugCount += 1;
            const sig = `${t.min}|${t.base}|${t.max}`;
            if (sugFirst === null) sugFirst = { sig, t }; else if (sugFirst.sig !== sig) sugUniform = false;
        }
    }
    const previewLabel = sugCount > 0
        ? (sugUniform
            ? (flexEnabled ? `opens ${lbl(sugFirst.t.base)} · flex ${lbl(sugFirst.t.min)}–${lbl(sugFirst.t.max)}` : `opens ${lbl(sugFirst.t.base)}`)
            : `varies by table (${sugCount} priced)`)
        : null;

    // Breakdown of what the selection currently holds (by opening BASE).
    const tally = new Map();
    for (const key of selectedKeys) {
        const p = readPrice((assignments || {})[key]);
        tally.set(p ? p.base : '__none', (tally.get(p ? p.base : '__none') || 0) + 1);
    }
    const summary = [...tally.entries()]
        .map(([tid, n]) => {
            const t = tid === '__none' ? null : tierMap.get(tid);
            return { label: t ? (t.label || formatMinimum(t.min)) : 'Unpriced', color: t ? t.color : UNPRICED_COLOR, n };
        })
        .sort((a, b) => b.n - a.n);

    // Last-saved reference for the selection (from the latest version).
    let hN = 0, hUniform = true, hFirst = null;
    for (const k of selectedKeys) {
        const p = readPrice((history || {})[k]);
        if (!p) continue;
        hN += 1;
        const sig = `${p.min}|${p.base}|${p.max}`;
        if (hFirst === null) hFirst = { sig, p }; else if (hFirst.sig !== sig) hUniform = false;
    }
    const historyLabel = hN > 0
        ? (hUniform
            ? (flexEnabled ? `opens ${lbl(hFirst.p.base)} · ${lbl(hFirst.p.min)}–${lbl(hFirst.p.max)}` : `opens ${lbl(hFirst.p.base)}`)
            : `varies (${hN} tables)`)
        : null;

    const tierSelectSx = {
        height: 30, minWidth: 84, fontSize: SB.select, fontWeight: 700, color: '#fff',
        bgcolor: 'rgba(255,255,255,0.05)', borderRadius: 1,
        '& .MuiSelect-icon': { color: 'rgba(255,255,255,0.45)' },
        '& .MuiOutlinedInput-notchedOutline': { border: 'none' },
    };
    const dateFieldSx = {
        '& .MuiInputBase-root': { height: 30, fontSize: SB.dateField, fontWeight: 700, color: '#fff', bgcolor: 'rgba(255,255,255,0.05)', borderRadius: 1 },
        '& .MuiOutlinedInput-notchedOutline': { border: '1px solid rgba(255,255,255,0.12)' },
        '& input': { py: 0.4, px: 1, colorScheme: 'dark' },
    };

    return (
        <Box sx={{
            position: 'absolute', bottom: 16, left: '50%', transform: 'translateX(-50%)',
            zIndex: 6, minWidth: 460, maxWidth: 'calc(100% - 32px)',
            bgcolor: 'rgba(10, 22, 35, 0.94)', border: '1px solid rgba(122, 200, 220, 0.35)',
            borderRadius: 2, boxShadow: '0 12px 40px rgba(0,0,0,0.6)',
            backdropFilter: 'blur(12px) saturate(140%)', WebkitBackdropFilter: 'blur(12px) saturate(140%)',
            px: 2, py: 1.4, fontVariantNumeric: 'tabular-nums',
            animation: 'priceBarIn 200ms ease-out',
            '@keyframes priceBarIn': {
                from: { opacity: 0, transform: 'translate(-50%, 12px)' },
                to:   { opacity: 1, transform: 'translate(-50%, 0)' },
            },
        }}>
            {/* Header — count + breakdown + cancel */}
            <Stack direction="row" alignItems="center" spacing={1.2} sx={{ mb: 1.2 }}>
                <Typography sx={{ color: '#7adfff', fontSize: SB.count, fontWeight: 800, lineHeight: 1 }}>
                    {count} table{count === 1 ? '' : 's'} selected
                </Typography>
                <Stack direction="row" spacing={0.8} sx={{ flexWrap: 'wrap', rowGap: 0.4, flex: 1, minWidth: 0 }}>
                    {summary.map((s) => (
                        <Stack key={s.label} direction="row" alignItems="center" spacing={0.5} sx={{
                            px: 0.8, py: 0.2, borderRadius: 1, bgcolor: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)',
                        }}>
                            <Box sx={{ width: 9, height: 9, borderRadius: '2px', bgcolor: s.color }} />
                            <Typography sx={{ color: 'rgba(255,255,255,0.8)', fontSize: SB.chip, fontWeight: 600 }}>{s.n} {s.label}</Typography>
                        </Stack>
                    ))}
                </Stack>
                <Tooltip title="Cancel — clear selection (Esc)">
                    <IconButton size="small" onClick={onClear} sx={{ color: 'rgba(255,255,255,0.55)', '&:hover': { color: '#fff' } }}>
                        <CloseIcon fontSize="small" />
                    </IconButton>
                </Tooltip>
            </Stack>

            {/* Demand context — once the reference is loaded. */}
            {hasDemand && (
                <Stack direction="row" alignItems="center" spacing={1.2} sx={{
                    mb: 1.2, px: 1, py: 0.6, borderRadius: 1,
                    bgcolor: 'rgba(187,154,247,0.08)', border: '1px solid rgba(187,154,247,0.25)',
                }}>
                    <Typography sx={{ color: '#bb9af7', fontSize: SB.demandLabel, fontWeight: 800, letterSpacing: 0.6, textTransform: 'uppercase' }}>
                        Demand · 4wk
                    </Typography>
                    <Typography sx={{ color: 'rgba(255,255,255,0.85)', fontSize: SB.demand, fontWeight: 600 }}>
                        theo/patron-hr <b style={{ color: '#fff' }}>{formatMinimum(Math.round(meanVal))}</b>
                        <span style={{ color: 'rgba(255,255,255,0.4)', margin: '0 6px' }}>·</span>
                        avg patrons <b style={{ color: '#fff' }}>{meanOcc.toFixed(1)}</b>
                        {dN < count && <span style={{ color: 'rgba(255,255,255,0.4)' }}> ({dN}/{count} with data)</span>}
                    </Typography>
                    {previewLabel && (
                        <Typography sx={{ color: '#9ece6a', fontSize: SB.demand, fontWeight: 800 }}>→ suggests {previewLabel}</Typography>
                    )}
                </Stack>
            )}

            {/* Last-saved reference (history). */}
            {historyLabel && (
                <Typography sx={{ mb: 1, fontSize: SB.history, color: 'rgba(255,255,255,0.5)', fontWeight: 600 }}>
                    Last saved · <span style={{ color: 'rgba(255,255,255,0.85)', fontWeight: 700 }}>{historyLabel}</span>
                </Typography>
            )}

            {/* Two clearly-separated panels: ① opening base, ② boundary. */}
            <Stack direction="row" spacing={1.2} alignItems="stretch" sx={{ mb: 1.2, flexWrap: 'wrap', rowGap: 1.2 }}>
                {/* ① Opening base — cyan-tinted panel. */}
                <Box sx={{ flex: '1 1 300px', p: 1.2, borderRadius: 1.6, bgcolor: 'rgba(122,223,255,0.06)', border: '1px solid rgba(122,223,255,0.28)' }}>
                    <Stack direction="row" alignItems="center" spacing={0.8} sx={{ mb: 0.8 }}>
                        <Box sx={{ width: 18, height: 18, borderRadius: '50%', bgcolor: '#7adfff', color: '#0a1a2c', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: SB.panelBadge, fontWeight: 900, flexShrink: 0 }}>1</Box>
                        <Typography sx={{ color: '#dff5ff', fontSize: SB.panelTitle, fontWeight: 800, letterSpacing: 0.5, textTransform: 'uppercase' }}>{fixed ? 'Fixed price' : 'Opening base'}</Typography>
                        <Box sx={{ flex: 1 }} />
                        <Typography sx={{ color: '#7adfff', fontSize: SB.baseValue, fontWeight: 800 }}>{lbl(baseId)}</Typography>
                    </Stack>
                    {/* Fixed-price lock — when on, the table's minimum cannot be
                        changed during the day (no dynamic pricing). */}
                    <Stack direction="row" alignItems="center" spacing={0.6} onClick={() => setFixed((v) => !v)}
                        sx={{ mb: 0.8, px: 0.8, py: 0.5, borderRadius: 1, cursor: 'pointer', width: 'fit-content',
                            bgcolor: fixed ? 'rgba(255,212,121,0.15)' : 'rgba(255,255,255,0.04)',
                            border: `1px solid ${fixed ? '#ffd479' : 'rgba(255,255,255,0.12)'}` }}>
                        {fixed ? <LockIcon sx={{ fontSize: 15, color: '#ffd479' }} /> : <LockOpenIcon sx={{ fontSize: 15, color: 'rgba(255,255,255,0.5)' }} />}
                        <Typography sx={{ fontSize: SB.fixed, fontWeight: 800, color: fixed ? '#ffd479' : 'rgba(255,255,255,0.65)' }}>
                            Fixed price {fixed ? '· locked' : '(lock minimum)'}
                        </Typography>
                    </Stack>
                    <Stack direction="row" spacing={0.6} sx={{ flexWrap: 'wrap', rowGap: 0.6 }}>
                        {sortedTiers.map((t) => {
                            const active = t.id === baseId;
                            return (
                                <Box key={t.id} onClick={() => pickBase(t.id)} title={t.label || formatMinimum(t.min)} sx={{
                                    display: 'flex', alignItems: 'center', gap: 0.5, px: 1, py: 0.7, borderRadius: 1.1, cursor: 'pointer',
                                    border: `1.5px solid ${active ? t.color : 'rgba(255,255,255,0.12)'}`,
                                    bgcolor: active ? `${t.color}30` : 'rgba(255,255,255,0.03)',
                                    boxShadow: active ? `0 0 0 2px ${t.color}55` : 'none',
                                    transition: 'border-color 140ms, background-color 140ms',
                                    '&:hover': { borderColor: t.color, bgcolor: `${t.color}22` },
                                }}>
                                    <Box sx={{ width: 11, height: 11, borderRadius: '3px', bgcolor: t.color }} />
                                    <Typography sx={{ color: '#fff', fontSize: SB.tierChip, fontWeight: 700, lineHeight: 1 }}>{t.label || formatMinimum(t.min)}</Typography>
                                </Box>
                            );
                        })}
                    </Stack>
                </Box>

                {/* ② Adjustable boundary — neutral panel with a range track.
                    The whole panel is HIDDEN when the global Min–Max range
                    switch is off (base-only pricing → the opening-base panel
                    fills the width). When the range is on but the table is
                    marked fixed, a small note replaces the controls. */}
                {flexEnabled && (fixed ? (
                    <Box sx={{ flex: '1 1 300px', p: 1.2, borderRadius: 1.6, bgcolor: 'rgba(255,255,255,0.02)', border: '1px dashed rgba(255,255,255,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <Typography sx={{ color: 'rgba(255,255,255,0.45)', fontSize: SB.noteCenter, fontWeight: 600, textAlign: 'center' }}>
                            Fixed price — minimum locked at the opening base, no dynamic range.
                        </Typography>
                    </Box>
                ) : (
                <Box sx={{ flex: '1 1 300px', p: 1.2, borderRadius: 1.6, bgcolor: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.12)' }}>
                    <Stack direction="row" alignItems="center" spacing={0.8} sx={{ mb: 0.8 }}>
                        <Box sx={{ width: 18, height: 18, borderRadius: '50%', bgcolor: 'rgba(255,255,255,0.2)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: SB.panelBadge, fontWeight: 900, flexShrink: 0 }}>2</Box>
                        <Typography sx={{ color: 'rgba(255,255,255,0.85)', fontSize: SB.panelTitle, fontWeight: 800, letterSpacing: 0.5, textTransform: 'uppercase' }}>Adjustable boundary</Typography>
                        <Box sx={{ flex: 1 }} />
                        <Typography sx={{ color: '#fff', fontSize: SB.boundaryVal, fontWeight: 800 }}>{lbl(minId)} – {lbl(maxId)}</Typography>
                    </Stack>
                    {/* Quick boundary presets (defaults from Settings). */}
                    {(boundaryPresets || []).length > 0 && (
                        <Stack direction="row" spacing={0.6} sx={{ mb: 0.9, flexWrap: 'wrap', rowGap: 0.5 }}>
                            {boundaryPresets.map((p) => (
                                <Box key={p.id} onClick={() => applyPreset(p)} title={`${formatMinimum(p.min)} – ${formatMinimum(p.max)}`} sx={{
                                    px: 1, py: 0.4, borderRadius: 1, cursor: 'pointer', fontSize: SB.preset, fontWeight: 700,
                                    color: 'rgba(255,255,255,0.75)', bgcolor: 'rgba(158,206,106,0.08)', border: '1px solid rgba(158,206,106,0.3)',
                                    '&:hover': { bgcolor: 'rgba(158,206,106,0.18)', borderColor: '#9ece6a' },
                                }}>
                                    {p.label} <span style={{ color: 'rgba(255,255,255,0.45)', fontWeight: 600 }}>{formatMinimum(p.min)}–{formatMinimum(p.max)}</span>
                                </Box>
                            ))}
                        </Stack>
                    )}
                    {/* Range track — the tier ladder with the Min–Max band filled
                        and the base position marked. */}
                    <Stack direction="row" spacing={0.3} sx={{ mb: 0.9 }}>
                        {sortedTiers.map((t) => {
                            const v = tierVal(t.id);
                            const inRange = v >= tierVal(minId) && v <= tierVal(maxId);
                            const isBase = t.id === baseId;
                            return (
                                <Tooltip key={t.id} title={`${t.label || formatMinimum(t.min)}${isBase ? ' · base' : ''}`}>
                                    <Box sx={{
                                        flex: 1, height: 18, borderRadius: 0.7,
                                        bgcolor: isBase ? t.color : (inRange ? `${t.color}55` : 'rgba(255,255,255,0.05)'),
                                        border: inRange ? `1px solid ${t.color}99` : '1px solid rgba(255,255,255,0.08)',
                                        boxShadow: isBase ? `0 0 0 1.5px ${t.color}` : 'none',
                                    }} />
                                </Tooltip>
                            );
                        })}
                    </Stack>
                    <Stack direction="row" spacing={1} alignItems="center">
                        <Typography sx={{ color: 'rgba(255,255,255,0.55)', fontSize: SB.rangeLabel, fontWeight: 700 }}>Min</Typography>
                        <Select value={minId} onChange={(e) => pickMin(e.target.value)} variant="outlined" sx={tierSelectSx}>
                            {sortedTiers.map((t) => <MenuItem key={t.id} value={t.id} sx={{ fontSize: SB.select }}>{t.label || formatMinimum(t.min)}</MenuItem>)}
                        </Select>
                        <Box sx={{ flex: 1, height: 1, bgcolor: 'rgba(255,255,255,0.12)' }} />
                        <Typography sx={{ color: 'rgba(255,255,255,0.55)', fontSize: SB.rangeLabel, fontWeight: 700 }}>Max</Typography>
                        <Select value={maxId} onChange={(e) => pickMax(e.target.value)} variant="outlined" sx={tierSelectSx}>
                            {sortedTiers.map((t) => <MenuItem key={t.id} value={t.id} sx={{ fontSize: SB.select }}>{t.label || formatMinimum(t.min)}</MenuItem>)}
                        </Select>
                    </Stack>
                </Box>
                ))}
            </Stack>

            {/* History-suggestion panel — reveals on demand. Sets each table
                to its MODE historical minimum (base) with the historical
                min/max as the boundary, over a chosen reference window. */}
            {onSuggestHistory && histOpen && (
                <Box sx={{ mt: 1.2, p: 1.2, borderRadius: 1.6, bgcolor: 'rgba(158,206,106,0.06)', border: '1px solid rgba(158,206,106,0.30)' }}>
                    <Typography sx={{ color: '#9ece6a', fontSize: SB.histTitle, fontWeight: 800, letterSpacing: 0.6, textTransform: 'uppercase', mb: 0.9 }}>
                        Suggest from history · mode minimum + historical min/max
                    </Typography>
                    <Stack direction="row" spacing={1} alignItems="center" sx={{ flexWrap: 'wrap', rowGap: 1 }}>
                        <Typography sx={{ color: 'rgba(255,255,255,0.6)', fontSize: SB.histLabel, fontWeight: 700 }}>Reference</Typography>
                        <TextField
                            type="date" size="small" value={histRange?.from || ''}
                            onChange={(e) => onHistRangeChange({ ...histRange, from: e.target.value })}
                            sx={dateFieldSx}
                        />
                        <Typography sx={{ color: 'rgba(255,255,255,0.4)', fontSize: SB.histLabel }}>→</Typography>
                        <TextField
                            type="date" size="small" value={histRange?.to || ''}
                            onChange={(e) => onHistRangeChange({ ...histRange, to: e.target.value })}
                            sx={dateFieldSx}
                        />
                        <Box sx={{ width: 1, height: 22, bgcolor: 'rgba(255,255,255,0.12)', mx: 0.4 }} />
                        <Typography sx={{ color: 'rgba(255,255,255,0.6)', fontSize: SB.histLabel, fontWeight: 700 }}>Days</Typography>
                        <Stack direction="row" spacing={0.4}>
                            {DOW_LABELS.map((lblTxt, d) => {
                                const on = (histDows || []).includes(d);
                                return (
                                    <Box key={d} onClick={() => toggleDow(d)} title={lblTxt} sx={{
                                        width: 26, height: 26, borderRadius: 1, cursor: 'pointer',
                                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                                        fontSize: SB.histDow, fontWeight: 800,
                                        color: on ? '#0a1a2c' : 'rgba(255,255,255,0.6)',
                                        bgcolor: on ? '#9ece6a' : 'rgba(255,255,255,0.05)',
                                        border: `1px solid ${on ? '#9ece6a' : 'rgba(255,255,255,0.12)'}`,
                                        '&:hover': on ? undefined : { bgcolor: 'rgba(158,206,106,0.12)' },
                                    }}>{lblTxt[0]}</Box>
                                );
                            })}
                        </Stack>
                        {(histDows || []).length > 0 && (
                            <Button size="small" onClick={() => onHistDowsChange([])}
                                sx={{ minWidth: 0, px: 0.8, fontSize: SB.histClear, color: 'rgba(255,255,255,0.5)', textTransform: 'none' }}>
                                all
                            </Button>
                        )}
                        <Box sx={{ width: 1, height: 22, bgcolor: 'rgba(255,255,255,0.12)', mx: 0.4 }} />
                        {/* Reference HOURS — only count tablemin readings from
                            these hours. Multi-select so non-consecutive hours
                            (e.g. 03:00 + 05:00 + 22:00) can be picked. */}
                        <Typography sx={{ color: 'rgba(255,255,255,0.6)', fontSize: SB.histLabel, fontWeight: 700 }}>Hours</Typography>
                        <Select size="small" multiple displayEmpty
                            value={Array.isArray(histHours) ? histHours : []}
                            onChange={(e) => { const v = e.target.value; onHistHoursChange(v && v.length ? [...v].sort((a, b) => a - b) : null); }}
                            renderValue={(sel) => (!sel || sel.length === 0 ? 'all' : sel.map((h) => String(h).padStart(2, '0')).join(', '))}
                            MenuProps={{ PaperProps: { sx: { maxHeight: 320, bgcolor: 'rgba(18,22,34,0.98)', color: '#fff', border: '1px solid rgba(122,200,220,0.25)' } } }}
                            sx={{ ...tierSelectSx, minWidth: 96, maxWidth: 240 }}>
                            {Array.from({ length: 24 }, (_, h) => (
                                <MenuItem key={h} value={h} sx={{ fontSize: SB.select, py: 0.2 }}>
                                    <Checkbox size="small" checked={(Array.isArray(histHours) ? histHours : []).includes(h)}
                                        sx={{ p: 0.4, color: 'rgba(255,255,255,0.35)', '&.Mui-checked': { color: '#9ece6a' } }} />
                                    {String(h).padStart(2, '0')}:00
                                </MenuItem>
                            ))}
                        </Select>
                        {Array.isArray(histHours) && histHours.length > 0 && (
                            <Button size="small" onClick={() => onHistHoursChange(null)}
                                sx={{ minWidth: 0, px: 0.8, fontSize: SB.histClear, color: 'rgba(255,255,255,0.5)', textTransform: 'none' }}>
                                all
                            </Button>
                        )}
                        <Box sx={{ flex: 1 }} />
                        <Button
                            onClick={onSuggestHistory}
                            disabled={histLoading}
                            size="small"
                            startIcon={histLoading
                                ? <CircularProgress size={14} thickness={5} sx={{ color: 'inherit' }} />
                                : <HistoryIcon sx={{ fontSize: 16 }} />}
                            sx={{
                                textTransform: 'none', fontSize: SB.histApply, fontWeight: 800,
                                color: '#0a1a2c', bgcolor: '#9ece6a', px: 1.6, py: 0.6,
                                '&:hover': { bgcolor: '#b5e08a' },
                            }}
                        >
                            Apply to {count}
                        </Button>
                    </Stack>
                </Box>
            )}

            {/* Commit / demand / clear. Apply is the only manual commit. */}
            <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 1.2 }}>
                <Button
                    onClick={() => onApplyTriple(minId, baseId, maxId, fixed)}
                    size="small"
                    startIcon={fixed ? <LockIcon sx={{ fontSize: 16 }} /> : null}
                    sx={{
                        textTransform: 'none', fontSize: SB.apply, fontWeight: 800,
                        color: '#0a1a2c', bgcolor: fixed ? '#ffd479' : '#7adfff', px: 2, py: 0.7,
                        '&:hover': { bgcolor: fixed ? '#ffe0a0' : '#a0e8ff' },
                    }}
                >
                    Apply{fixed ? ' fixed' : ''} to {count}
                </Button>
                {onSuggestRange && (
                    <Tooltip title="Auto-fill each table with a demand-driven base + boundary (avg bet + occupancy, same weekday × 4 weeks)">
                        <Button
                            onClick={onSuggestRange}
                            disabled={suggestLoading}
                            size="small"
                            startIcon={suggestLoading
                                ? <CircularProgress size={14} thickness={5} sx={{ color: 'inherit' }} />
                                : <AutoAwesomeIcon sx={{ fontSize: 16 }} />}
                            sx={{
                                textTransform: 'none', fontSize: SB.action, fontWeight: 700,
                                color: '#bb9af7', border: '1px solid rgba(187,154,247,0.45)', px: 1.4, py: 0.6,
                                '&:hover': { bgcolor: 'rgba(187,154,247,0.10)', borderColor: '#bb9af7' },
                            }}
                        >
                            Suggest from demand
                        </Button>
                    </Tooltip>
                )}
                {onSuggestHistory && (
                    <Tooltip title="Suggest from each table's OWN historical minimums — mode = base, historical min/max = boundary. Pick a reference date range + day-of-week.">
                        <Button
                            onClick={() => setHistOpen((v) => !v)}
                            size="small"
                            startIcon={<HistoryIcon sx={{ fontSize: 16 }} />}
                            sx={{
                                textTransform: 'none', fontSize: SB.action, fontWeight: 700,
                                color: histOpen ? '#0a1a2c' : '#9ece6a',
                                bgcolor: histOpen ? '#9ece6a' : 'transparent',
                                border: '1px solid rgba(158,206,106,0.45)', px: 1.4, py: 0.6,
                                '&:hover': { bgcolor: histOpen ? '#b5e08a' : 'rgba(158,206,106,0.10)', borderColor: '#9ece6a' },
                            }}
                        >
                            From history
                        </Button>
                    </Tooltip>
                )}
                <Box sx={{ flex: 1 }} />
                <Button
                    onClick={onClearTier}
                    startIcon={<BackspaceOutlinedIcon sx={{ fontSize: 17 }} />}
                    size="small"
                    sx={{
                        textTransform: 'none', fontSize: SB.action, fontWeight: 700, color: '#f7768e',
                        border: '1px solid rgba(247, 118, 142, 0.4)', px: 1.4, py: 0.6,
                        '&:hover': { bgcolor: 'rgba(247, 118, 142, 0.10)', borderColor: '#f7768e' },
                    }}
                >
                    Clear minimum
                </Button>
            </Stack>
        </Box>
    );
}
