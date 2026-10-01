// Targets — tables per price for each core hour, per sub-segment, entered by
// day type or for a specific date (a date's own mix overrides its day type).
// Cells show the saved target, or the inherited one (italic: the day type's
// for a date, else history) until edited. One Excel paste can fill every
// sub-segment, price and hour — and several day types or dates — at once;
// "Copy as Excel" gives the same layout to edit and paste back.
// Each sub-segment's price list starts from history and can be edited.

import React, { useCallback, useState } from 'react';
import { Box, Button, ButtonBase, IconButton, Menu, MenuItem, Stack, Tooltip, Typography } from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import AddIcon from '@mui/icons-material/Add';
import UndoIcon from '@mui/icons-material/Undo';
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';
import HistoryIcon from '@mui/icons-material/History';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import ContentPasteIcon from '@mui/icons-material/ContentPaste';
import TableViewIcon from '@mui/icons-material/TableView';
import { CORE_HOURS, DAY_TYPES, DOW_LABELS, blockLabel, dowOf } from '../../utils/autoplan/core';
import { targetsFor, withTargets, withPrices, removePrice, clearPrices, clearDateTargets } from '../../utils/autoplan/config';
import { parseTargetsPaste, formatTargetsTsv, parseMatrix } from '../../utils/autoplan/paste';
import PasteTargetsDialog from './PasteTargetsDialog';
import { SEGMENT_PRICES } from '../../constants/segmentPrices';
import { AP, F, panelSx, titleSx, ghostSx, labelSx, tierLabel, two } from './apStyles';

const sum = (m) => Object.values(m || {}).reduce((a, b) => a + (Number(b) || 0), 0);
const DT_LABEL = Object.fromEntries(DAY_TYPES.map((d) => [d.id, d.label]));
const chipSx = (on) => ({
    px: 1.4, py: 0.6, borderRadius: 1.5, fontWeight: 800, fontSize: 13.5, border: `1px solid ${on ? AP.accent : AP.line}`,
    bgcolor: on ? AP.accent : 'transparent', color: on ? AP.accentInk : AP.text, '&.Mui-focusVisible': { outline: `2px solid ${AP.accent}`, outlineOffset: 2 },
});

export default function TargetsPanel({
    cfg, onCfg, scope, onScope, dates, dtOf, sub, onSub, subs, ladders, historyLadders, tiersAsc, tierIndex, tierById,
    mixFor, openCountFor, fitMix, onSeed, priceSourceOf,
}) {
    const [col, setCol] = useState(null);
    const [copyAnchor, setCopyAnchor] = useState(null);
    const [xlAnchor, setXlAnchor] = useState(null);
    const [addAnchor, setAddAnchor] = useState(null);
    const [pasteOpen, setPasteOpen] = useState(false);
    const [pasteText, setPasteText] = useState('');
    const [undo, setUndo] = useState(null);           // { cfg, text } after a bulk change
    const [note, setNote] = useState('');
    const isDate = String(scope).startsWith('d:');
    const date = isDate ? scope.slice(2) : null;
    const dt = isDate ? dtOf(date) : scope;
    const scopeName = isDate ? `${DOW_LABELS[dowOf(date)]} ${date}` : DT_LABEL[scope];
    const scopeLabel = (s) => (String(s).startsWith('d:') ? s.slice(2) : DT_LABEL[s] || s);
    const ownDate = isDate && !!(cfg.targets || {})[scope];

    const ladder = ladders[sub] || [];
    const edited = !!(cfg.prices || {})[sub];
    const source = priceSourceOf ? priceSourceOf(sub) : (edited ? 'edited' : 'history');
    const hasConfig = !!(SEGMENT_PRICES[sub] || []).length;
    const missing = tiersAsc.filter((t) => !ladder.includes(t.id));
    const withUndo = (next, text) => { setUndo({ cfg, text }); setNote(''); onCfg(next); };
    const addPrice = (id) => withUndo(withPrices(cfg, sub, [...ladder, id], tiersAsc), `${tierLabel(tierById.get(id))} added to ${sub}. Type its tables into the new row.`);
    const dropPrice = (id) => {
        const r = removePrice(cfg, sub, id, ladder, tierIndex);
        const name = tierLabel(tierById.get(id));
        const rules = cfg.rules.filter((x) => [x.tier, x.lo, x.hi].includes(id)).length;
        withUndo(r.cfg, `${name} removed from ${sub}.`
            + (r.moved ? ` ${r.moved} saved tables moved to ${tierLabel(tierById.get(r.to))}.` : '')
            + (rules ? ` ${rules} ${rules === 1 ? 'rule uses' : 'rules use'} ${name}; check the Rules tab.` : ''));
    };
    const shownFor = (sc, core, s) => mixFor(sc, core, s).map || {};
    const shown = (core) => shownFor(scope, core, sub);
    const inherited = (core) => mixFor(scope, core, sub).from;
    const openAt = (core) => openCountFor(scope, core, sub);
    const put = (next) => onCfg(next);

    const setCell = (core, id, v) => put(withTargets(cfg, scope, core, sub, { ...shown(core), [id]: Math.max(0, parseInt(v, 10) || 0) }));
    const shift = (core, dir) => {
        const m = shown(core), out = {};
        ladder.forEach((id, i) => { const to = ladder[Math.min(ladder.length - 1, Math.max(0, i + dir))]; out[to] = (out[to] || 0) + (m[id] || 0); });
        put(withTargets(cfg, scope, core, sub, out));
    };
    const fit = (core, next = cfg) => withTargets(next, scope, core, sub, fitMix(scope, core, sub, shown(core)));
    const copyToAll = (core) => {
        let next = cfg;
        const src = shown(core);
        for (const c of CORE_HOURS) if (c !== core) next = withTargets(next, scope, c, sub, fitMix(scope, c, sub, src));
        put(next);
    };
    const copyFrom = (from) => {
        let next = cfg;
        for (const s of subs) for (const c of CORE_HOURS) next = withTargets(next, scope, c, s, fitMix(scope, c, s, shownFor(from, c, s)));
        withUndo(next, `${scopeName} now uses ${scopeLabel(from)}'s mix, fitted to its open tables.`);
    };
    // Paste a prices × core-hours block from Excel in one go. A block that is
    // exactly prices × hours fills the whole grid; $ labels and hour headers
    // map by name (new prices join the list); other blocks fill from the cell.
    // A whole sheet (with a Sub-segment column) opens the full paste dialog.
    const onPaste = (e, core, id) => {
        const text = e.clipboardData.getData('text');
        if (!/[\t\n]/.test(text)) return;
        e.preventDefault();
        if (/sub|segment/i.test(text)) { setPasteText(text); setPasteOpen(true); return; }
        const r = parseMatrix(text, { ladderDesc: [...ladder].reverse(), coreHours: CORE_HOURS, tiers: tiersAsc, anchor: { tierId: id, core } });
        if (!r.cells.length) { setUndo(null); setNote(r.errors[0] ? `Nothing pasted: ${r.errors[0]}` : 'Nothing pasted.'); return; }
        let next = r.newPrices.length ? withPrices(cfg, sub, [...ladder, ...r.newPrices], tiersAsc) : cfg;
        const byCore = new Map();
        for (const c of r.cells) { if (!byCore.has(c.core)) byCore.set(c.core, {}); byCore.get(c.core)[c.tierId] = c.n; }
        for (const [c, vals] of byCore) next = withTargets(next, scope, c, sub, { ...(targetsFor(next, scope, c, sub) || shown(c)), ...vals });
        const where = r.mode === 'full' ? 'the whole grid' : r.mode === 'labeled' ? 'rows matched by price' : `from ${tierLabel(tierById.get(id))} at ${two(core)}:00`;
        withUndo(next, `Pasted ${r.rows} × ${r.cols} into ${where} (${r.cells.length} cells)`
            + (r.newPrices.length ? `; added ${r.newPrices.map((x) => tierLabel(tierById.get(x))).join(', ')} to ${sub}` : '')
            + (r.errors.length ? `; skipped ${r.errors.length}: ${r.errors[0]}` : '') + '.');
    };

    // ── Whole-sheet paste / copy ────────────────────────────────────────
    const parse = useCallback((text) => {
        const r = parseTargetsPaste(text, { subs, tiers: tiersAsc, coreHours: CORE_HOURS, dayTypes: DAY_TYPES, dates, scope, ladders });
        return { ...r, newPrices: r.newPrices.map((p) => ({ ...p, label: tierLabel(tierById.get(p.tierId)) })) };
    }, [subs, tiersAsc, dates, scope, ladders, tierById]);
    const applyPaste = (r) => {
        let next = cfg;
        for (const p of r.newPrices) next = withPrices(next, p.sub, [...((next.prices || {})[p.sub] || ladders[p.sub] || []), p.tierId], tiersAsc);
        const groups = new Map();
        for (const c of r.cells) {
            const k = `${c.scope}|${c.sub}|${c.core}`;
            if (!groups.has(k)) groups.set(k, { ...c, cells: {} });
            groups.get(k).cells[c.tierId] = c.n;
        }
        for (const g of groups.values()) {
            const base = targetsFor(next, g.scope, g.core, g.sub) || shownFor(g.scope, g.core, g.sub);
            next = withTargets(next, g.scope, g.core, g.sub, { ...base, ...g.cells });
        }
        withUndo(next, `Filled ${r.cells.length} cells from Excel${r.newPrices.length ? ` and added ${r.newPrices.length} price${r.newPrices.length === 1 ? '' : 's'}` : ''}. Check the Total / open row.`);
    };
    const tsv = (scopes, onlySub = null) => formatTargetsTsv({
        scopes, subs: onlySub ? [onlySub] : subs, coreHours: CORE_HOURS, ladders, tierById,
        valueOf: (s, sb, id, c) => shownFor(s, c, sb)[id] || 0,
    });
    const copy = async (scopes) => {
        const text = tsv(scopes);
        try { await navigator.clipboard.writeText(text); setNote(`Copied ${text.split('\n').length - 1} rows. Paste them into Excel, edit, then use Paste from Excel.`); } catch (e) { setNote('Copy was blocked by the browser. Allow clipboard access and try again.'); }
        setUndo(null);
    };
    const example = tsv([{ id: scope, label: scopeLabel(scope) }], sub || subs[0]).split('\n').slice(0, 3).join('\n');

    const ok = (s) => CORE_HOURS.every((c) => sum(shownFor(scope, c, s)) === openCountFor(scope, c, s));

    return (
        <Stack spacing={1.2}>
            <Box sx={panelSx}>
                <Typography component="h2" sx={{ ...titleSx, mb: 1 }}>Targets</Typography>
                <Typography sx={{ fontSize: 12.5, color: AP.faint, mb: 1.2 }}>
                    Tables per price at each core hour. Set them for a day type, or for one date to override it. Each date is fitted to its own open tables when solving.
                </Typography>
                <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 0.6, mb: 1 }} role="group" aria-label="Enter targets by">
                    <ButtonBase onClick={() => isDate && onScope(dt)} aria-pressed={!isDate} sx={chipSx(!isDate)}>By day type</ButtonBase>
                    <ButtonBase onClick={() => !isDate && onScope(`d:${dates.find((d) => dtOf(d) === scope) || dates[0]}`)} aria-pressed={isDate} disabled={!dates.length} sx={chipSx(isDate)}>By date</ButtonBase>
                </Stack>
                {!isDate ? (
                    <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 0.6, mb: 1 }} role="group" aria-label="Day type">
                        {DAY_TYPES.map((d) => (
                            <ButtonBase key={d.id} onClick={() => onScope(d.id)} aria-pressed={scope === d.id} sx={{ ...chipSx(scope === d.id), fontSize: 13 }}>{d.label}</ButtonBase>
                        ))}
                    </Stack>
                ) : (
                    <Box role="group" aria-label="Date" sx={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0,1fr))', gap: 0.4, mb: 1 }}>
                        {dates.map((d) => {
                            const on = d === date, own = !!(cfg.targets || {})[`d:${d}`];
                            return (
                                <ButtonBase key={d} onClick={() => onScope(`d:${d}`)} aria-pressed={on} aria-label={`${d}${own ? ', own mix' : ''}`}
                                    sx={{
                                        display: 'grid', py: 0.35, borderRadius: 1, border: `1px solid ${on ? AP.accent : AP.lineSoft}`, bgcolor: on ? AP.accent : 'transparent',
                                        color: on ? AP.accentInk : AP.text, position: 'relative', '&.Mui-focusVisible': { outline: `2px solid ${AP.accent}` },
                                    }}>
                                    <Typography component="span" sx={{ fontSize: 9.5, fontWeight: 800, opacity: 0.75 }}>{DOW_LABELS[dowOf(d)]}</Typography>
                                    <Typography component="span" sx={{ fontSize: 13, fontWeight: 900, fontVariantNumeric: 'tabular-nums' }}>{d.slice(8)}</Typography>
                                    {own ? <Box component="span" aria-hidden="true" sx={{ position: 'absolute', top: 3, right: 4, width: 6, height: 6, borderRadius: '50%', bgcolor: on ? AP.accentInk : AP.warn }} /> : null}
                                </ButtonBase>
                            );
                        })}
                    </Box>
                )}
                <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 0.6 }} role="group" aria-label="Sub-segment">
                    {subs.map((s) => (
                        <ButtonBase key={s} onClick={() => { onSub(s); setCol(null); setUndo(null); }} aria-pressed={sub === s}
                            sx={{ px: 1.2, py: 0.45, borderRadius: 4, fontWeight: 800, fontSize: 12.5, gap: 0.6, border: `1px solid ${sub === s ? AP.accent : AP.lineSoft}`, color: sub === s ? AP.accent : AP.text, '&.Mui-focusVisible': { outline: `2px solid ${AP.accent}`, outlineOffset: 2 } }}>
                            <Box component="span" aria-hidden="true" sx={{ width: 7, height: 7, borderRadius: '50%', bgcolor: ok(s) ? AP.ok : AP.bad }} />
                            {s}
                            <Box component="span" sx={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>{ok(s) ? ' totals match' : ' totals need fitting'}</Box>
                        </ButtonBase>
                    ))}
                </Stack>
            </Box>

            {!sub ? (
                <Box sx={panelSx} role="status">
                    <Typography sx={{ fontSize: 13, color: AP.faint, fontStyle: 'italic' }}>Loading price history. The targets appear once it's in.</Typography>
                </Box>
            ) : (
            <Box sx={panelSx}>
                <Stack direction="row" sx={{ alignItems: 'baseline', gap: 1, mb: 1 }}>
                    <Typography sx={{ fontSize: 15, fontWeight: 800, color: '#fff' }}>{scopeName}</Typography>
                    <Typography sx={{ fontSize: 12.5, color: isDate ? (ownDate ? AP.warn : AP.faint) : AP.faint }}>
                        {isDate ? (ownDate ? 'own mix for this date' : `uses the ${DT_LABEL[dt]} mix until you edit it`) : 'day type mix'}
                    </Typography>
                </Stack>
                <Stack direction="row" sx={{ alignItems: 'center', flexWrap: 'wrap', gap: 0.75, mb: 1 }}>
                    <Button sx={ghostSx} startIcon={<ContentPasteIcon sx={{ fontSize: 16 }} />} onClick={() => setPasteOpen(true)}>Paste from Excel</Button>
                    <Button sx={ghostSx} startIcon={<TableViewIcon sx={{ fontSize: 16 }} />} onClick={(e) => setXlAnchor(e.currentTarget)} aria-haspopup="menu">Copy as Excel</Button>
                    <Menu anchorEl={xlAnchor} open={!!xlAnchor} onClose={() => setXlAnchor(null)} slotProps={{ paper: { sx: { bgcolor: AP.pop, color: AP.text, border: `1px solid ${AP.line}` } } }}>
                        <MenuItem onClick={() => { copy([{ id: scope, label: scopeLabel(scope) }]); setXlAnchor(null); }}>{scopeName}, every sub-segment</MenuItem>
                        <MenuItem onClick={() => { copy(DAY_TYPES.map((d) => ({ id: d.id, label: d.label }))); setXlAnchor(null); }}>All four day types</MenuItem>
                    </Menu>
                    {isDate ? (
                        ownDate ? <Button sx={ghostSx} startIcon={<HistoryIcon sx={{ fontSize: 17 }} />} onClick={() => withUndo(clearDateTargets(cfg, date), `${date} uses the ${DT_LABEL[dt]} mix again.`)}>Use {DT_LABEL[dt]} mix</Button> : null
                    ) : (
                        <Button sx={ghostSx} startIcon={<HistoryIcon sx={{ fontSize: 17 }} />} onClick={() => onSeed(dt)}>Reset {DT_LABEL[dt]} to history</Button>
                    )}
                    <Button sx={ghostSx} startIcon={<ContentCopyIcon sx={{ fontSize: 16 }} />} onClick={(e) => setCopyAnchor(e.currentTarget)}>Copy from…</Button>
                    <Menu anchorEl={copyAnchor} open={!!copyAnchor} onClose={() => setCopyAnchor(null)} slotProps={{ paper: { sx: { bgcolor: AP.pop, color: AP.text, border: `1px solid ${AP.line}` } } }}>
                        {DAY_TYPES.filter((d) => d.id !== scope).map((d) => (
                            <MenuItem key={d.id} onClick={() => { copyFrom(d.id); setCopyAnchor(null); }}>{d.label} (every sub-segment, fitted)</MenuItem>
                        ))}
                    </Menu>
                </Stack>
                <Stack direction="row" sx={{ alignItems: 'center', flexWrap: 'wrap', gap: 0.8, mb: 1 }}>
                    <Typography sx={{ ...labelSx, fontSize: 11 }}>{sub} prices</Typography>
                    <Typography sx={{ fontSize: 12.5, color: edited ? AP.warn : AP.faint }}>
                        {edited ? 'edited here' : source === 'config' ? 'from the price config' : 'from history'} · {ladder.length} price{ladder.length === 1 ? '' : 's'}
                    </Typography>
                    {edited ? (
                        <Button size="small" sx={{ ...ghostSx, minHeight: 28, py: 0.2, fontSize: 12.5 }} startIcon={<HistoryIcon sx={{ fontSize: 15 }} />}
                            onClick={() => withUndo(clearPrices(cfg, sub, historyLadders[sub] || ladder, tierIndex), `${sub} is back on its ${hasConfig ? 'configured' : 'history'} prices.`)}>
                            Reset to {hasConfig ? 'config' : 'history'} prices
                        </Button>
                    ) : null}
                </Stack>
                {undo || note ? (
                    <Stack direction="row" role="status" sx={{ alignItems: 'center', gap: 1, mb: 1, p: 0.8, borderRadius: 1.5, border: `1px solid ${AP.line}`, bgcolor: 'rgba(122,223,255,0.06)' }}>
                        <Typography sx={{ fontSize: 12.5, color: AP.text, flex: 1 }}>{undo ? undo.text : note}</Typography>
                        {undo ? (
                            <Button size="small" sx={{ ...ghostSx, minHeight: 28, py: 0.2, fontSize: 12.5 }} startIcon={<UndoIcon sx={{ fontSize: 15 }} />}
                                onClick={() => { onCfg(undo.cfg); setUndo(null); }}>Undo</Button>
                        ) : null}
                    </Stack>
                ) : null}
                {col != null ? (
                    <Stack direction="row" sx={{ alignItems: 'center', flexWrap: 'wrap', gap: 0.6, mb: 1, p: 0.8, borderRadius: 1.5, border: `1px solid ${AP.accent}`, bgcolor: 'rgba(122,223,255,0.06)' }}>
                        <Typography sx={{ fontSize: 13, fontWeight: 800, color: AP.accent, mr: 0.5 }}>{two(col)}:00 column</Typography>
                        <Button size="small" sx={ghostSx} startIcon={<ArrowUpwardIcon sx={{ fontSize: 16 }} />} onClick={() => shift(col, 1)}>Mix up a price</Button>
                        <Button size="small" sx={ghostSx} startIcon={<ArrowDownwardIcon sx={{ fontSize: 16 }} />} onClick={() => shift(col, -1)}>Mix down</Button>
                        <Button size="small" sx={ghostSx} onClick={() => put(fit(col))}>Fit to open</Button>
                        <Button size="small" sx={ghostSx} onClick={() => copyToAll(col)}>Use for all hours</Button>
                        <Box sx={{ flex: 1 }} />
                        <Button size="small" sx={{ ...ghostSx, border: 'none' }} onClick={() => setCol(null)}>Done</Button>
                    </Stack>
                ) : (
                    <Box sx={{ mb: 1, p: 0.8, borderRadius: 1.5, border: `1px dashed ${AP.line}`, bgcolor: 'rgba(122,223,255,0.04)' }}>
                        <Typography sx={{ fontSize: 12.5, color: AP.text, display: 'flex', alignItems: 'center', gap: 0.8 }}>
                            <ContentPasteIcon sx={{ fontSize: 16, color: AP.accent }} />
                            Copy the prices × hours block in Excel, click any cell below and press Ctrl+V: the whole block fills at once.
                        </Typography>
                        <Typography sx={{ fontSize: 11.5, color: AP.faint, mt: 0.3, pl: 3 }}>
                            Include the $ price column and the hour row to match by name (new prices are added). Click an hour's heading for column actions.
                        </Typography>
                    </Box>
                )}
                <Box sx={{ overflowX: 'auto' }}>
                    <Box component="table" sx={{ borderCollapse: 'separate', borderSpacing: '3px', minWidth: 420 }}>
                        <thead>
                            <tr>
                                <th />
                                {CORE_HOURS.map((c) => (
                                    <Box component="th" key={c} sx={{ p: 0 }}>
                                        <ButtonBase onClick={() => setCol(col === c ? null : c)} aria-pressed={col === c} title={`Block ${blockLabel(c)} — column actions`}
                                            sx={{ display: 'grid', width: '100%', py: 0.4, borderRadius: 1, border: `1px solid ${col === c ? AP.accent : 'transparent'}`, '&.Mui-focusVisible': { outline: `2px solid ${AP.accent}` } }}>
                                            <Typography component="span" sx={{ fontSize: 13, fontWeight: 900, color: AP.accent }}>{two(c)}</Typography>
                                            <Typography component="span" sx={{ fontSize: 10, color: AP.faint }}>{blockLabel(c)}</Typography>
                                        </ButtonBase>
                                    </Box>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {[...ladder].reverse().map((id) => {
                                const t = tierById.get(id);
                                return (
                                    <tr key={id}>
                                        <Box component="td" sx={{ pr: 1, whiteSpace: 'nowrap' }}>
                                            <Stack direction="row" spacing={0.8} sx={{ alignItems: 'center' }}>
                                                <Box sx={{ width: 12, height: 12, borderRadius: 0.5, bgcolor: t?.color, border: '1px solid rgba(0,0,0,0.4)' }} />
                                                <Typography sx={{ fontSize: F.priceMix.count, fontWeight: 800, color: '#fff' }}>{tierLabel(t)}</Typography>
                                                <Tooltip title={ladder.length > 1 ? `Remove ${tierLabel(t)}: its tables move to the next lower price` : 'A sub-segment needs at least one price'}>
                                                    <span>
                                                        <IconButton size="small" aria-label={`Remove ${tierLabel(t)} from ${sub}`} disabled={ladder.length <= 1} onClick={() => dropPrice(id)}
                                                            sx={{ p: 0.3, color: AP.faint, '&:hover': { color: AP.bad }, '&.Mui-focusVisible': { outline: `2px solid ${AP.accent}` } }}>
                                                            <CloseIcon sx={{ fontSize: 15 }} />
                                                        </IconButton>
                                                    </span>
                                                </Tooltip>
                                            </Stack>
                                        </Box>
                                        {CORE_HOURS.map((c) => {
                                            const v = shown(c)[id] || 0;
                                            const from = inherited(c);
                                            return (
                                                <td key={c}>
                                                    <Box component="input" type="number" min={0} value={v}
                                                        aria-label={`${sub} ${two(c)}:00 ${tierLabel(t)} tables`}
                                                        title={from === 'own' ? undefined : `From ${from === 'history' ? 'history' : DT_LABEL[from]}`}
                                                        onChange={(e) => setCell(c, id, e.target.value)}
                                                        onPaste={(e) => onPaste(e, c, id)}
                                                        sx={{
                                                            width: 42, height: 30, textAlign: 'center', borderRadius: 1, fontWeight: 700, fontSize: 13.5, fontVariantNumeric: 'tabular-nums',
                                                            color: v ? AP.text : AP.faint, fontStyle: from === 'own' ? 'normal' : 'italic',
                                                            bgcolor: col === c ? 'rgba(122,223,255,0.08)' : 'rgba(255,255,255,0.04)',
                                                            border: `1px solid ${col === c ? 'rgba(122,223,255,0.5)' : 'rgba(255,255,255,0.12)'}`,
                                                            '&:focus-visible': { outline: `2px solid ${AP.accent}`, outlineOffset: 1 },
                                                        }} />
                                                </td>
                                            );
                                        })}
                                    </tr>
                                );
                            })}
                            <tr>
                                <Box component="td" colSpan={CORE_HOURS.length + 1} sx={{ pt: 0.3, pb: 0.5 }}>
                                    <Button size="small" sx={{ ...ghostSx, minHeight: 28, py: 0.2, fontSize: 12.5, borderStyle: 'dashed' }} startIcon={<AddIcon sx={{ fontSize: 15 }} />}
                                        disabled={!missing.length} onClick={(e) => setAddAnchor(e.currentTarget)} aria-haspopup="menu">
                                        Add price
                                    </Button>
                                    <Menu anchorEl={addAnchor} open={!!addAnchor} onClose={() => setAddAnchor(null)} slotProps={{ paper: { sx: { bgcolor: AP.pop, color: AP.text, border: `1px solid ${AP.line}`, maxHeight: 360 } } }}>
                                        {missing.map((t) => (
                                            <MenuItem key={t.id} onClick={() => { addPrice(t.id); setAddAnchor(null); }} sx={{ gap: 1, fontWeight: 700 }}>
                                                <Box sx={{ width: 12, height: 12, borderRadius: 0.5, bgcolor: t.color, border: '1px solid rgba(0,0,0,0.4)' }} />
                                                {tierLabel(t)}
                                            </MenuItem>
                                        ))}
                                    </Menu>
                                </Box>
                            </tr>
                            <tr>
                                <Box component="td" sx={{ ...labelSx, fontSize: 10.5 }}>Total / open</Box>
                                {CORE_HOURS.map((c) => {
                                    const tot = sum(shown(c)), open = openAt(c), good = tot === open;
                                    return (
                                        <Box component="td" key={c} sx={{ textAlign: 'center' }}>
                                            <Tooltip title={good ? 'Matches the open tables' : `Targets ${tot} vs ${open} open — Fit to open`}>
                                                <ButtonBase onClick={() => !good && put(fit(c))} disabled={good}
                                                    sx={{ width: '100%', py: 0.3, borderRadius: 1, fontSize: 11.5, fontWeight: 800, fontVariantNumeric: 'tabular-nums', bgcolor: good ? 'rgba(158,206,106,0.14)' : 'rgba(255,122,138,0.16)', color: good ? AP.ok : AP.bad }}>
                                                    {good ? '✓ ' : ''}{tot}/{open}
                                                </ButtonBase>
                                            </Tooltip>
                                        </Box>
                                    );
                                })}
                            </tr>
                        </tbody>
                    </Box>
                </Box>
                <Typography sx={{ fontSize: 11.5, color: AP.faint, mt: 0.8 }}>
                    <i>Italic</i> = not edited here (from {isDate ? `the ${DT_LABEL[dt]} mix or history` : 'history'}) · open = {isDate ? 'tables open in the block that date' : 'typical tables open in the block on this day type'}
                </Typography>
            </Box>
            )}
            <PasteTargetsDialog open={pasteOpen} onClose={() => { setPasteOpen(false); setPasteText(''); }} parse={parse} onApply={applyPaste}
                scopeLabel={scopeLabel} scopeName={scopeName} example={example} initialText={pasteText} />
        </Stack>
    );
}
