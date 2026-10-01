// Shoe board — one table's current shoe, hand by hand.
// ===================================================
// Left half of the investigation workspace: "what happened at this
// table?". A per-hand house-result strip (when did it turn), the casino
// roads (how the shoe ran) and every hand's bets (who was on which side
// for how much). Roads reuse Trend Seeker's renderer so the board looks
// exactly like the one floor staff already read.

import React, { useEffect, useMemo, useRef } from 'react';
import * as echarts from 'echarts';
import { Box, ButtonBase, CircularProgress, Collapse, MenuItem, Select, Stack, Typography } from '@mui/material';
import { BANKER, PLAYER, TIE } from '../../trend/components/BaccaratBoard';
import ShoeRoads from './ShoeRoads';
import { shoeTotals } from '../utils/shoeData';
import { SHOE_BOARD, HOUSE_EDGE_OPTIONS } from '../constants/rtConfig';
import { TEXT, STATE, ACCENT, systemLabel } from '../constants/rtTheme';

const GOLD = '#ffd479';
const EMPTY = [];
const RESULT = {
    B: { label: 'Banker', zh: '庄', color: BANKER },
    P: { label: 'Player', zh: '闲', color: PLAYER },
    T: { label: 'Tie', zh: '和', color: TIE },
};
const BET_LABEL = { BANKER: 'Banker', PLAYER: 'Player', TIE: 'Tie', BANKER_PAIR: 'B pair', PLAYER_PAIR: 'P pair' };

const signed = (v) => {
    if (v == null || !Number.isFinite(v)) return '—';
    const a = Math.abs(v), s = v < 0 ? '−' : v > 0 ? '+' : '';
    if (a >= 1e6) return `${s}$${(a / 1e6).toFixed(2)}M`;
    if (a >= 1e3) return `${s}$${(a / 1e3).toFixed(a >= 1e4 ? 0 : 1)}K`;
    return `${s}$${Math.round(a)}`;
};
const signColor = (v) => (v < 0 ? STATE.negative : v > 0 ? STATE.positive : TEXT.muted);

function lowestEdge(row) {
    if (!row) return null;
    let best = null;
    for (const k of Object.keys(row)) {
        if (!k.startsWith('house_edge_')) continue;
        const v = Number(row[k]);
        if (!Number.isFinite(v)) continue;
        if (!best || v < best.v) best = { v, key: k.slice('house_edge_'.length) };
    }
    if (!best) return null;
    const opt = HOUSE_EDGE_OPTIONS.find((o) => o.key === best.key);
    return { ...best, label: opt ? opt.label : best.key };
}

function Fact({ label, value, color = TEXT.primary, sub }) {
    return (
        <Box sx={{ px: 1.25, py: 0.75, borderRadius: 1.5, bgcolor: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', minWidth: 96 }}>
            <Typography sx={{ ...systemLabel, lineHeight: 1.3 }}>{label}</Typography>
            <Typography sx={{ fontSize: 18, fontWeight: 800, color, fontVariantNumeric: 'tabular-nums', lineHeight: 1.25, whiteSpace: 'nowrap' }}>
                {value}
            </Typography>
            {sub ? <Typography sx={{ fontSize: 11, color: TEXT.faint, whiteSpace: 'nowrap' }}>{sub}</Typography> : null}
        </Box>
    );
}

function ResultBadge({ hand }) {
    const r = RESULT[hand.result];
    if (!r) return <Box sx={{ width: 26, height: 26 }} />;
    return (
        <Box sx={{ position: 'relative', width: 26, height: 26, flexShrink: 0 }} title={r.label}>
            <Box sx={{ width: 26, height: 26, borderRadius: '50%', bgcolor: r.color, color: '#fff', display: 'grid', placeItems: 'center', fontSize: 13, fontWeight: 700 }}>
                {r.zh}
            </Box>
            {hand.bankerPair && <Box sx={{ position: 'absolute', top: -1, left: -1, width: 8, height: 8, borderRadius: '50%', bgcolor: BANKER, border: '1px solid #fff' }} />}
            {hand.playerPair && <Box sx={{ position: 'absolute', bottom: -1, right: -1, width: 8, height: 8, borderRadius: '50%', bgcolor: PLAYER, border: '1px solid #fff' }} />}
        </Box>
    );
}

function ShoePulse({ hands, selectedHandNo, patronHands, onSelectHand }) {
    const ref = useRef(null);
    const instRef = useRef(null);
    const cbRef = useRef(onSelectHand);
    cbRef.current = onSelectHand;

    useEffect(() => {
        const el = ref.current;
        const inst = echarts.init(el);
        instRef.current = inst;
        inst.on('click', (p) => {
            if (p.componentType === 'series' && p.seriesIndex === 0 && cbRef.current) cbRef.current(Number(p.name));
        });
        const ro = new ResizeObserver(() => inst.resize());
        ro.observe(el);
        return () => { ro.disconnect(); inst.dispose(); instRef.current = null; };
    }, []);

    useEffect(() => {
        const inst = instRef.current;
        if (!inst) return;
        let cum = 0;
        const running = hands.map((h) => (cum += h.casinoNet));
        inst.setOption({
            backgroundColor: 'transparent',
            animation: false,
            grid: { left: 58, right: 12, top: 10, bottom: 24 },
            tooltip: {
                trigger: 'axis',
                axisPointer: { type: 'shadow' },
                backgroundColor: 'rgba(14,16,28,0.97)',
                borderColor: 'rgba(122,162,247,0.45)',
                textStyle: { color: '#fff', fontSize: 12 },
                formatter: (ps) => {
                    const i = ps[0].dataIndex;
                    const h = hands[i];
                    const r = RESULT[h.result];
                    return `<b>Hand ${h.handNo}</b> · <span style="color:${r ? r.color : '#fff'}">${r ? r.label : '—'}</span>`
                        + `<br/>House ${signed(h.casinoNet)} · ${h.bets.length} bets · ${signed(h.wager).replace('+', '')} wagered`
                        + `<br/>Shoe so far ${signed(running[i])}`;
                },
            },
            xAxis: {
                type: 'category',
                data: hands.map((h) => String(h.handNo)),
                axisLabel: { color: TEXT.muted, fontSize: 10, interval: 'auto' },
                axisTick: { show: false },
                axisLine: { lineStyle: { color: 'rgba(255,255,255,0.15)' } },
            },
            yAxis: {
                type: 'value',
                axisLabel: { color: TEXT.muted, fontSize: 10, formatter: (v) => signed(v) },
                splitLine: { lineStyle: { color: 'rgba(255,255,255,0.06)' } },
            },
            series: [
                {
                    type: 'bar',
                    barMaxWidth: 12,
                    cursor: 'pointer',
                    data: hands.map((h) => {
                        const sel = h.handNo === selectedHandNo;
                        const mine = patronHands.has(h.handNo);
                        return {
                            value: h.casinoNet,
                            itemStyle: {
                                color: h.casinoNet < 0 ? STATE.negative : h.casinoNet > 0 ? STATE.positive : 'rgba(255,255,255,0.25)',
                                borderColor: sel ? '#fff' : mine ? GOLD : 'transparent',
                                borderWidth: sel || mine ? 2 : 0,
                            },
                        };
                    }),
                },
                { type: 'line', data: running, smooth: true, symbol: 'none', lineStyle: { color: '#7dcfff', width: 2 }, silent: true },
            ],
        }, { notMerge: true });
    }, [hands, selectedHandNo, patronHands]);

    return <div ref={ref} style={{ width: '100%', height: 170 }} />;
}

function HandList({ hands, selectedHandNo, onSelectHand, selectedPatronId, onSelectPatron }) {
    const rows = useMemo(() => [...hands].reverse(), [hands]);
    const refs = useRef(new Map());
    useEffect(() => {
        const el = selectedHandNo != null ? refs.current.get(selectedHandNo) : null;
        if (el) el.scrollIntoView({ block: 'nearest' });
    }, [selectedHandNo]);

    return (
        <Box sx={{ overflowY: 'auto', maxHeight: 560, pr: 0.5, scrollbarWidth: 'thin' }}>
            {rows.map((h) => {
                const open = h.handNo === selectedHandNo;
                const big = h.casinoNet <= SHOE_BOARD.BIG_HAND_LOSS;
                const mine = selectedPatronId && h.bets.some((b) => b.playerId === selectedPatronId);
                return (
                    <Box
                        key={h.handNo}
                        ref={(el) => { if (el) refs.current.set(h.handNo, el); else refs.current.delete(h.handNo); }}
                        sx={{
                            mb: 0.5, borderRadius: 1,
                            borderLeft: `3px solid ${big ? STATE.negative : 'transparent'}`,
                            bgcolor: open ? 'rgba(122,162,247,0.12)' : 'rgba(255,255,255,0.025)',
                        }}
                    >
                        <ButtonBase
                            onClick={() => onSelectHand(open ? null : h.handNo)}
                            aria-expanded={open}
                            sx={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'flex-start', gap: 1.25, px: 1, py: 0.75, textAlign: 'left', borderRadius: 1 }}
                        >
                            <Typography sx={{ width: 40, fontSize: 14, fontWeight: 800, color: TEXT.primary, fontVariantNumeric: 'tabular-nums' }}>
                                #{h.handNo}
                            </Typography>
                            <ResultBadge hand={h} />
                            {mine ? <Box aria-label="selected patron bet" sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: GOLD, flexShrink: 0 }} /> : null}
                            <Typography sx={{ flex: 1, fontSize: 13, color: TEXT.muted, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                {h.bets.length ? `${h.bets.length} bet${h.bets.length === 1 ? '' : 's'} · ${signed(h.wager).replace('+', '')}` : 'no bets'}
                            </Typography>
                            <Typography sx={{ fontSize: 14, fontWeight: 800, color: signColor(h.casinoNet), fontVariantNumeric: 'tabular-nums' }}>
                                {h.bets.length ? signed(h.casinoNet) : ''}
                            </Typography>
                        </ButtonBase>
                        <Collapse in={open} unmountOnExit>
                            {h.bets.length ? (
                                <Box component="table" sx={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, mb: 1, '& td, & th': { px: 1, py: 0.5 } }}>
                                    <thead>
                                        <tr>
                                            {['Seat', 'Player', 'Bet', 'Wager', 'Player result'].map((c, i) => (
                                                <Box component="th" key={c} sx={{ ...systemLabel, textAlign: i >= 3 ? 'right' : 'left', fontWeight: 700 }}>{c}</Box>
                                            ))}
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {h.bets.map((b, i) => {
                                            const res = -b.casinoWin;          // player perspective
                                            const isSel = b.playerId === selectedPatronId;
                                            return (
                                                <tr key={i}>
                                                    <Box component="td" sx={{ color: TEXT.muted, fontVariantNumeric: 'tabular-nums' }}>{b.seat ?? '—'}</Box>
                                                    <Box component="td">
                                                        <ButtonBase
                                                            onClick={() => onSelectPatron(b.playerId)}
                                                            sx={{ fontSize: 13, fontWeight: 700, color: isSel ? GOLD : ACCENT, borderRadius: 0.5, px: 0.25, '&:hover': { textDecoration: 'underline' } }}
                                                        >
                                                            {b.playerId}
                                                        </ButtonBase>
                                                    </Box>
                                                    <Box component="td" sx={{ color: TEXT.secondary }}>{BET_LABEL[b.betType] || b.betType}</Box>
                                                    <Box component="td" sx={{ textAlign: 'right', color: TEXT.primary, fontVariantNumeric: 'tabular-nums' }}>{signed(b.wager).replace('+', '')}</Box>
                                                    <Box component="td" sx={{ textAlign: 'right', fontWeight: 800, color: signColor(res), fontVariantNumeric: 'tabular-nums' }}>{signed(res)}</Box>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </Box>
                            ) : (
                                <Typography sx={{ fontSize: 13, color: TEXT.faint, px: 1.25, pb: 1 }}>Nobody bet on this hand.</Typography>
                            )}
                        </Collapse>
                    </Box>
                );
            })}
        </Box>
    );
}

function Message({ title, body }) {
    return (
        <Stack spacing={0.75} sx={{ alignItems: 'center', justifyContent: 'center', py: 6, textAlign: 'center' }}>
            <Typography sx={{ fontSize: 15, fontWeight: 700, color: TEXT.muted }}>{title}</Typography>
            {body ? <Typography sx={{ fontSize: 13, color: TEXT.faint, maxWidth: 440 }}>{body}</Typography> : null}
        </Stack>
    );
}

export default function RtShoeBoard({
    tableKey, tableRow, shoe, loading, error,
    tableOptions = EMPTY, onPickTable,
    selectedHandNo, onSelectHand,
    selectedPatronId, onSelectPatron,
    seatedCount = 0,
}) {
    const hands = (shoe && shoe.hands) || EMPTY;
    const totals = useMemo(() => shoeTotals(shoe), [shoe]);
    const patronHands = useMemo(() => {
        const s = new Set();
        if (selectedPatronId) for (const h of hands) if (h.bets.some((b) => b.playerId === selectedPatronId)) s.add(h.handNo);
        return s;
    }, [hands, selectedPatronId]);

    if (!tableKey) {
        return <Message title="Pick a table on the map" body="Click a table on the floor map, a ranking row or an alert to open its current shoe." />;
    }

    const edge = lowestEdge(tableRow);
    const theo = Number(tableRow && tableRow.shoe_theo);
    const last = hands[hands.length - 1];

    return (
        <Stack spacing={1.5}>
            <Stack direction="row" spacing={1} sx={{ alignItems: 'stretch', flexWrap: 'wrap', rowGap: 1 }}>
                <Box sx={{ pr: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                    <Typography sx={systemLabel}>Shoe board</Typography>
                    <Typography sx={{ fontSize: 24, fontWeight: 800, color: TEXT.primary, lineHeight: 1.15 }}>{tableKey}</Typography>
                    <Typography sx={{ fontSize: 12, color: TEXT.faint }}>{(tableRow && tableRow.area) || '—'} · pit {(tableRow && tableRow.pit) ?? '—'}</Typography>
                </Box>
                <Fact label="Hand" value={last ? `#${last.handNo}` : '—'} sub={(shoe && shoe.shoeId) || (tableRow && tableRow.shoe_id) || ''} />
                {/* Shoe-derived facts read "—" until hands arrive, so a
                    pending fetch never passes for a real $0 / 0 bets. */}
                <Fact label="Dealer" value={(shoe && shoe.dealer) || '—'} sub={last ? `${totals.counts.B}B · ${totals.counts.P}P · ${totals.counts.T}T` : '—'} />
                <Fact label="House edge" value={edge ? `${edge.v.toFixed(2)}%` : '—'} color={edge && edge.v < 0 ? STATE.negative : TEXT.primary} sub={edge ? `lowest · ${edge.label}` : 'no live edge'} />
                <Fact label="Shoe result" value={last ? signed(totals.casinoNet) : '—'} color={last ? signColor(totals.casinoNet) : TEXT.primary} sub={Number.isFinite(theo) ? `theo ${signed(theo)}` : 'house perspective'} />
                <Fact label="Seated" value={String(seatedCount)} sub={last ? `${totals.bets} bets this shoe` : '—'} />
                <Box sx={{ flex: 1 }} />
                <Box sx={{ display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                    <Typography sx={{ ...systemLabel, mb: 0.4 }}>Table</Typography>
                    <Select
                        size="small"
                        value={tableKey}
                        onChange={(e) => onPickTable(e.target.value)}
                        inputProps={{ 'aria-label': 'Pick a table' }}
                        MenuProps={{ PaperProps: { sx: { maxHeight: 420, bgcolor: '#20233a', color: TEXT.primary } } }}
                        sx={{ minWidth: 160, color: TEXT.primary, fontWeight: 700, '& .MuiOutlinedInput-notchedOutline': { borderColor: 'rgba(122,162,247,0.4)' } }}
                    >
                        {tableOptions.map((o) => (
                            <MenuItem key={o.key} value={o.key} sx={{ gap: 1 }}>
                                <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: o.alerting ? STATE.negative : 'transparent', border: o.alerting ? 'none' : '1px solid rgba(255,255,255,0.25)' }} />
                                {o.key}
                            </MenuItem>
                        ))}
                    </Select>
                </Box>
            </Stack>

            {error ? (
                <Typography sx={{ fontSize: 13, color: STATE.warning }}>
                    {hands.length ? `Showing the last loaded shoe — refresh failed: ${error}` : `Couldn't load this shoe — retrying on the next refresh (${error}).`}
                </Typography>
            ) : null}

            {loading && !hands.length ? (
                <Stack sx={{ alignItems: 'center', py: 6 }}><CircularProgress size={26} sx={{ color: ACCENT }} /></Stack>
            ) : !hands.length ? (
                <Message title="New shoe — no hands dealt yet" />
            ) : (
                <>
                    <Box>
                        <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', mb: 0.5, gap: 1 }}>
                            <Typography sx={systemLabel}>House result by hand</Typography>
                            <Typography sx={{ fontSize: 12, color: TEXT.faint }}>
                                bars = each hand (red = house lost) · line = shoe so far · click a bar to open the hand{selectedPatronId ? ' · gold = selected patron bet' : ''}
                            </Typography>
                        </Stack>
                        <ShoePulse hands={hands} selectedHandNo={selectedHandNo} patronHands={patronHands} onSelectHand={onSelectHand} />
                    </Box>
                    <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', xl: '56fr 44fr' }, gap: 2, alignItems: 'start' }}>
                        <ShoeRoads hands={hands} selectedHandNo={selectedHandNo} onSelectHand={onSelectHand}
                            markedHands={patronHands} beadLabel="Bead plate · 珠盤路 — click a hand" />
                        <Box sx={{ minWidth: 0 }}>
                            <Typography sx={{ ...systemLabel, mb: 0.5 }}>Hands · newest first · click to see bets</Typography>
                            <HandList hands={hands} selectedHandNo={selectedHandNo} onSelectHand={onSelectHand}
                                selectedPatronId={selectedPatronId} onSelectPatron={onSelectPatron} />
                        </Box>
                    </Box>
                </>
            )}
        </Stack>
    );
}
