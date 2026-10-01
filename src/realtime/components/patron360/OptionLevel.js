// Level 2 — one bet option over the period: its KPIs, the evidence tiles,
// bet rate by edge, and every shoe as a sortable row with an edge strip.

import React from 'react';
import { Box, Button, Checkbox, FormControlLabel, Stack, Typography } from '@mui/material';
import { TEXT, ACCENT } from '../../constants/rtTheme';
import { edgeBands, bandTick, money, plain, pct, share, signColor, optionColor, STATE_STYLE } from './format';
import FactTiles from './FactTiles';
import EdgeProfileChart, { ProfileLegend } from './EdgeProfileChart';
import SortableTable from './SortableTable';
import ShoeStrip from './ShoeStrip';
import { Kpi, KpiRow, Panel, MAGENTA_TEXT, edgeTextColor } from './levelParts';

const INITIAL_ROWS = 20;
const MAX_COMPARE = 6;
// Shoe rows arrive already sorted (the overlay owns the order so Prev /
// Next shoe follows it); this is the getter it uses per column.
export const shoeSortGet = (key) => (key === 'date' ? (r) => String(r.view.start || r.view.date) : (r) => r[key]);

export function OptionKpis({ kpi }) {
    return (
        <KpiRow>
            <Kpi label="Theo edge" value={pct(kpi.theoEdge, 2)} />
            <Kpi label="Edge played" value={pct(kpi.edgePlayed, 2)} sub="wager-weighted" color={edgeTextColor(kpi.edgePlayed)} />
            <Kpi label="Bets" value={kpi.bets.toLocaleString()} sub={`${share(kpi.involvement)} of seated hands`} />
            <Kpi label="Turnover" value={plain(kpi.turnover)} sub={`avg bet ${plain(kpi.avgBet)}`} />
            <Kpi label="Shoes played" value={kpi.shoes} />
            <Kpi label="−edge shoes" value={kpi.negShoes} sub={`bet on −edge in ${kpi.negShoesBet}`} color={kpi.negShoesBet ? MAGENTA_TEXT : TEXT.primary} />
            <Kpi label="Casino Theo · theo edge" value={money(kpi.theoGeneric)} sub={`Σ wager × ${pct(kpi.theoEdge, 2)}`} />
            <Kpi label="Casino Theo · actual edge" value={money(kpi.theoActual)} sub="Σ wager × edge at bet"
                color={kpi.theoActual == null ? TEXT.faint : kpi.theoActual < 0 ? MAGENTA_TEXT : kpi.theoGeneric && kpi.theoActual < kpi.theoGeneric * 0.6 ? '#e0af68' : TEXT.primary} />
            <Kpi label="Patron Win" value={money(kpi.patronWin)} color={signColor(kpi.patronWin)} />
        </KpiRow>
    );
}

export default function OptionLevel({
    kpi, views, periodLabel, shoeRows, sort, onSort, onlyNeg, onOnlyNeg, showAll, onShowAll,
    picks, onTogglePick, onClearPicks, onCompare, onOpenShoe, onOpenHand,
}) {
    const code = kpi.code;
    const theo = kpi.theoEdge || 1;
    const state = STATE_STYLE[kpi.worst] || STATE_STYLE.insufficient;
    const sorted = shoeRows;
    const shown = showAll ? sorted : sorted.slice(0, INITIAL_ROWS);

    const columns = [
        { key: 'pick', label: '', sortable: false, align: 'left', width: 30, render: (r) => (
            <Checkbox size="small" checked={picks.has(r.view.shoeKey)} disabled={!picks.has(r.view.shoeKey) && picks.size >= MAX_COMPARE}
                onChange={() => onTogglePick(r.view.shoeKey)} slotProps={{ input: { 'aria-label': `Tick ${r.view.shoeId} to compare` } }}
                sx={{ p: 0.25, color: TEXT.muted }} />
        ) },
        { key: 'date', label: 'Shoe', align: 'left', render: (r) => (
            <Box component="button" type="button" onClick={() => onOpenShoe(r.view.shoeKey)} sx={{ all: 'unset', cursor: 'pointer', display: 'grid', '&:focus-visible': { outline: `2px solid ${ACCENT}`, outlineOffset: 2 } }}>
                <Typography component="span" sx={{ fontSize: 13, fontWeight: 800, color: TEXT.primary }}>{`${String(r.view.date).slice(5)} · ${r.view.tableKey}`}</Typography>
                <Typography component="span" sx={{ fontSize: 11, color: TEXT.faint }}>{`${r.view.shoeId} · seated #${r.view.firstHand ?? '—'}–#${r.view.lastHand ?? '—'}`}</Typography>
            </Box>
        ) },
        { key: 'strip', label: `${code} edge by hand`, sortable: false, align: 'left', width: '44%', render: (r) => (
            <Box sx={{ minWidth: 240 }}><ShoeStrip view={r.view} code={code} onPickHand={(h) => onOpenHand(r.view.shoeKey, h)} /></Box>
        ) },
        { key: 'negHands', label: '−edge hands', title: 'Seated hands where the option went below 0%', render: (r) => r.negHands },
        { key: 'negBets', label: 'Bet on −edge', render: (r) => <Box component="b" sx={{ color: r.negBets ? MAGENTA_TEXT : TEXT.faint }}>{r.negBets}</Box> },
        { key: 'negMoney', label: '$ on −edge', render: (r) => <Box component="span" sx={{ color: r.negMoney ? MAGENTA_TEXT : TEXT.faint }}>{r.negMoney ? plain(r.negMoney) : '—'}</Box> },
        { key: 'patronWin', label: 'Patron Win', title: `Patron Win on ${code} in this shoe`, render: (r) => <Box component="b" sx={{ color: signColor(r.patronWin) }}>{r.bets ? money(r.patronWin) : '—'}</Box> },
        { key: 'go', label: '', sortable: false, width: 16, render: () => <Box component="span" sx={{ color: ACCENT, fontWeight: 800 }}>›</Box> },
    ];

    return (
        <Stack spacing={1.5}>
            <Panel raised title={<><Box component="span" sx={{ color: optionColor(code) }}>{code}</Box>{` · ${periodLabel}`}</>}
                right={<Box component="span" sx={{ px: 1, py: 0.2, borderRadius: 1, border: `1px solid ${state.color}`, color: state.color, fontSize: 12, fontWeight: 900 }}>{state.label}</Box>}>
                <OptionKpis kpi={kpi} />
            </Panel>
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: 'minmax(0,5fr) minmax(0,7fr)' }, gap: 1.5 }}>
                <Panel title="Evidence" hint="−edge hands against all other hands he sat through">
                    <FactTiles row={kpi.ev} />
                </Panel>
                <Panel title="Bet rate by edge" right={<ProfileLegend />} sx={{ display: 'flex', flexDirection: 'column' }}>
                    <Box sx={{ flex: 1, minHeight: 300 }}><EdgeProfileChart views={views} code={code} /></Box>
                </Panel>
            </Box>
            <Panel
                title={`Shoes · ${sorted.length}`}
                hint="hover a strip for each hand · click a hand to open it, or the shoe to open the shoe · tick 2–6 to compare"
                right={(
                    <FormControlLabel
                        control={<Checkbox size="small" checked={onlyNeg} onChange={(e) => onOnlyNeg(e.target.checked)} sx={{ color: TEXT.muted }} />}
                        label={`only shoes where ${code} went −edge`}
                        sx={{ mr: 0, '& .MuiFormControlLabel-label': { fontSize: 12, color: TEXT.muted } }}
                    />
                )}
            >
                <Stack direction="row" sx={{ alignItems: 'center', gap: 1.5, flexWrap: 'wrap', mb: 1 }}>
                    <Button variant="contained" disabled={picks.size < 2} onClick={onCompare}
                        sx={{ textTransform: 'none', fontWeight: 800, bgcolor: ACCENT, color: '#0d0e18', '&:hover': { bgcolor: '#9bb8ff' } }}>
                        Compare{picks.size ? ` ${picks.size}` : ''} shoes
                    </Button>
                    {picks.size ? <Button onClick={onClearPicks} sx={{ textTransform: 'none', fontWeight: 700, color: ACCENT }}>Clear ticks</Button> : null}
                    <Stack direction="row" sx={{ gap: 1.5, flexWrap: 'wrap', alignItems: 'center' }}>
                        {edgeBands(theo).map((b) => (
                            <Stack key={b.color} direction="row" spacing={0.6} sx={{ alignItems: 'center' }}>
                                <Box sx={{ width: 12, height: 10, borderRadius: 0.5, bgcolor: b.color }} />
                                <Typography sx={{ fontSize: 12, color: TEXT.muted }}>{bandTick(b)}</Typography>
                            </Stack>
                        ))}
                        <Stack direction="row" spacing={0.6} sx={{ alignItems: 'center' }}>
                            <Box sx={{ width: 12, height: 4, bgcolor: '#fff' }} />
                            <Typography sx={{ fontSize: 12, color: TEXT.muted }}>his {code} bet</Typography>
                        </Stack>
                    </Stack>
                </Stack>
                {sorted.length ? (
                    <SortableTable
                        ariaLabel={`${code} shoes`}
                        columns={columns}
                        rows={shown}
                        rowKey={(r) => r.view.shoeKey}
                        sort={sort}
                        onSort={onSort}
                        onRowClick={(r) => onOpenShoe(r.view.shoeKey)}
                        rowLabel={(r) => `Open shoe ${r.view.shoeId}`}
                        minWidth={900}
                    />
                ) : <Typography sx={{ fontSize: 13, color: TEXT.faint, py: 2 }}>No {code} shoes in this period{onlyNeg ? ' where it went −edge' : ''}.</Typography>}
                {sorted.length > shown.length ? (
                    <Button onClick={onShowAll} sx={{ mt: 1, textTransform: 'none', fontWeight: 700, color: ACCENT }}>Show all {sorted.length}</Button>
                ) : null}
            </Panel>
        </Stack>
    );
}
