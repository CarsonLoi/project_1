// Level 4 — one hand: the result, each bet he placed with the edge at that
// moment, the live edge of every option, and the option around this hand.

import React, { useMemo } from 'react';
import { Box, Stack, Typography } from '@mui/material';
import { PATRON_360 } from '../../constants/rtConfig';
import { TEXT, ACCENT, systemLabel } from '../../constants/rtTheme';
import { inWindow, OPTION_BY_CODE } from '../../utils/patron360';
import { sortBy } from '../../utils/p360Periods';
import { money, plain, pct, signColor, optionColor } from './format';
import SortableTable from './SortableTable';
import { Kpi, OptionChip, Panel, MAGENTA, MAGENTA_TEXT, edgeTextColor } from './levelParts';

const RESULT = { B: { t: 'Banker', zh: '庄', c: '#e5484d' }, P: { t: 'Player', zh: '闲', c: '#3e63dd' }, T: { t: 'Tie', zh: '和', c: '#30a46c' } };
const GOLD = '#f2c14e';
const AROUND = 5;

function Around({ view, code, handNo, onOpenHand }) {
    const idx = view.hands.findIndex((h) => h.handNo === handNo);
    const from = Math.max(0, idx - AROUND);
    const to = Math.min(view.hands.length - 1, idx + AROUND);
    const hs = view.hands.slice(from, to + 1);
    const theo = (OPTION_BY_CODE.get(code) || { theo: 1 }).theo;
    const vals = hs.map((h) => h.edge[code]).filter((v) => v != null);
    const lo = Math.min(-1, ...vals);
    const hi = Math.max(theo, ...vals);
    const W = 600, H = 120, bw = W / hs.length;
    const y = (v) => 12 + (1 - (v - lo) / (hi - lo)) * (H - 36);
    return (
        <Box sx={{ overflowX: 'auto' }}>
            <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ maxWidth: W * 1.6, display: 'block' }} role="group" aria-label={`${code} edge for hands #${hs[0].handNo} to #${hs[hs.length - 1].handNo}`}>
                <line x1={0} x2={W} y1={y(0)} y2={y(0)} stroke="rgba(255,255,255,0.35)" />
                <line x1={0} x2={W} y1={y(theo)} y2={y(theo)} stroke="rgba(255,255,255,0.4)" strokeDasharray="4 3" />
                {hs.map((h, i) => {
                    const v = h.edge[code];
                    const x = i * bw;
                    const cur = h.handNo === handNo;
                    const m = view.betsByHand.get(h.handNo);
                    const bet = m && m.get(code);
                    const go = () => onOpenHand(h.handNo);
                    return (
                        <g key={h.handNo} role="button" tabIndex={0} aria-label={`Hand ${h.handNo}, ${code} edge ${pct(v, 2)}${bet ? ', he bet it' : ''}`}
                            onClick={go} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } }} style={{ cursor: 'pointer', outline: 'none' }}>
                            {v != null ? <rect x={x + 3} y={Math.min(y(v), y(0))} width={bw - 6} height={Math.max(1, Math.abs(y(v) - y(0)))} rx={3} fill={v < 0 ? MAGENTA : '#58628c'} opacity={cur ? 1 : 0.7} /> : null}
                            {bet && v != null ? <circle cx={x + bw / 2} cy={y(v)} r={5} fill={GOLD} stroke="#0d0e18" strokeWidth={2} /> : null}
                            <text x={x + bw / 2} y={H - 5} textAnchor="middle" fontSize={11} fontWeight={cur ? 800 : 500} fill={cur ? '#fff' : 'rgba(255,255,255,0.58)'}>#{h.handNo}</text>
                            {cur ? <rect x={x + 1} y={2} width={bw - 2} height={H - 22} rx={4} fill="none" stroke={ACCENT} strokeWidth={2} /> : null}
                        </g>
                    );
                })}
            </svg>
        </Box>
    );
}

export default function HandLevel({ view, code, handNo, sort, onSort, onOpenHand }) {
    const hand = view.hands.find((h) => h.handNo === handNo);
    const seated = inWindow(view, handNo);
    const bets = useMemo(() => {
        const m = view.betsByHand.get(handNo);
        if (!m) return [];
        return [...m].map(([c, x]) => ({
            code: c, wager: x.wager, patronWin: -x.casinoWin,
            edge: hand ? hand.edge[c] ?? null : null, theo: (OPTION_BY_CODE.get(c) || {}).theo ?? null,
        }));
    }, [view, handNo, hand]);
    const sorted = useMemo(() => sortBy(bets, (b) => b[sort.key], sort.dir), [bets, sort]);
    const pw = bets.reduce((a, b) => a + b.patronWin, 0);
    const wager = bets.reduce((a, b) => a + b.wager, 0);
    const r = hand ? RESULT[hand.result] : null;
    const betCodes = new Set(bets.map((b) => b.code));

    const columns = [
        { key: 'code', label: 'Option', align: 'left', firstDir: 1, render: (b) => (
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}><OptionChip color={optionColor(b.code)} /><Box component="b">{b.code}</Box></Stack>
        ) },
        { key: 'wager', label: 'Wager', render: (b) => plain(b.wager) },
        { key: 'edge', label: 'Edge at bet', firstDir: 1, render: (b) => <Box component="b" sx={{ color: edgeTextColor(b.edge) }}>{pct(b.edge, 2)}</Box> },
        { key: 'theo', label: 'Theo', firstDir: 1, render: (b) => <Box component="span" sx={{ color: TEXT.faint }}>{pct(b.theo, 2)}</Box> },
        { key: 'patronWin', label: 'Patron Win', render: (b) => <Box component="b" sx={{ color: signColor(b.patronWin) }}>{money(b.patronWin)}</Box> },
    ];

    return (
        <Stack spacing={1.5}>
            <Panel raised>
                <Stack direction="row" sx={{ alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
                    <Box sx={{ width: 46, height: 46, borderRadius: '50%', display: 'grid', placeItems: 'center', bgcolor: r ? r.c : 'rgba(255,255,255,0.1)', color: '#fff', fontSize: 20, fontWeight: 800 }}>{r ? r.zh : '?'}</Box>
                    <Box>
                        <Typography sx={{ fontSize: 20, fontWeight: 800 }}>
                            {r ? `${r.t} wins` : 'Result unknown'}
                            {hand && hand.bankerPair ? ' · Banker pair' : ''}{hand && hand.playerPair ? ' · Player pair' : ''}
                        </Typography>
                        <Typography sx={{ fontSize: 12, color: TEXT.faint }}>
                            {`Hand #${handNo} of ${view.hands.length} · ${String(view.date).slice(5)} · ${view.tableKey} · ${view.shoeId} · ${seated ? 'he was seated' : 'he was not seated'}`}
                        </Typography>
                    </Box>
                    <Box sx={{ flex: 1 }} />
                    <Kpi label="Patron Win · this hand" value={bets.length ? money(pw) : '—'} sub={bets.length ? `on ${plain(wager)}` : 'no bet'} color={bets.length ? signColor(pw) : TEXT.primary} />
                </Stack>
            </Panel>
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: 'minmax(0,5fr) minmax(0,6fr)' }, gap: 1.5 }}>
                <Panel title="His bets this hand">
                    {bets.length ? (
                        <SortableTable ariaLabel="His bets this hand" columns={columns} rows={sorted} rowKey={(b) => b.code} sort={sort} onSort={onSort} />
                    ) : <Typography sx={{ fontSize: 13, color: TEXT.faint }}>{seated ? 'He sat this hand out.' : 'He was not at the table for this hand.'}</Typography>}
                </Panel>
                <Panel title="Live edge at this hand" hint="gold border = he bet it · magenta = below 0%">
                    <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(118px, 1fr))', gap: 1 }}>
                        {PATRON_360.BET_OPTIONS.map((o) => {
                            const e = hand ? hand.edge[o.code] : null;
                            const bet = betCodes.has(o.code);
                            return (
                                <Box key={o.code} sx={{
                                    px: 1.25, py: 0.75, borderRadius: 1.5, bgcolor: 'rgba(255,255,255,0.03)',
                                    border: `1px solid ${bet ? GOLD : 'rgba(255,255,255,0.08)'}`, boxShadow: bet ? `inset 0 0 0 1px ${GOLD}` : 'none',
                                }}>
                                    <Typography sx={{ ...systemLabel, color: o.color }}>{o.code}</Typography>
                                    <Typography sx={{ fontSize: 17, fontWeight: 800, color: e != null && e < 0 ? MAGENTA_TEXT : TEXT.primary, fontVariantNumeric: 'tabular-nums' }}>{pct(e, 2)}</Typography>
                                    <Typography sx={{ fontSize: 11, color: TEXT.faint }}>theo {pct(o.theo, 2)}</Typography>
                                </Box>
                            );
                        })}
                    </Box>
                </Panel>
            </Box>
            <Panel title={`${code} around this hand`} hint={`bars = live edge · gold dot = his ${code} bet · dashed = theo · click a hand`}>
                {hand ? <Around view={view} code={code} handNo={handNo} onOpenHand={onOpenHand} /> : null}
            </Panel>
        </Stack>
    );
}
