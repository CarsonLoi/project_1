// Patron panel — right half of the investigation workspace.
// ========================================================
// "Who is this player?" in one column: their day, their bets in the shoe
// on the left, and the tables and shoes they visited. The full Player
// 360 case file opens one click away as an overlay.

import React, { useMemo } from 'react';
import { Box, ButtonBase, CircularProgress, Stack, Typography } from '@mui/material';
import PersonSearchIcon from '@mui/icons-material/PersonSearch';
import CloseIcon from '@mui/icons-material/Close';
import OpenInFullIcon from '@mui/icons-material/OpenInFull';
import { CARD_TIERS } from '../../live/constants/winPalette';
import { BANKER, PLAYER, TIE } from '../../trend/components/BaccaratBoard';
import { patronBetsInShoe } from '../utils/shoeData';
import { TEXT, STATE, ACCENT, systemLabel } from '../constants/rtTheme';

const SIDE = {
    BANKER: { t: 'B', c: BANKER },
    PLAYER: { t: 'P', c: PLAYER },
    TIE: { t: 'T', c: TIE },
    BANKER_PAIR: { t: 'BP', c: BANKER },
    PLAYER_PAIR: { t: 'PP', c: PLAYER },
};

const signed = (v) => {
    if (v == null || !Number.isFinite(v)) return '—';
    const a = Math.abs(v), s = v < 0 ? '−' : v > 0 ? '+' : '';
    if (a >= 1e6) return `${s}$${(a / 1e6).toFixed(2)}M`;
    if (a >= 1e3) return `${s}$${(a / 1e3).toFixed(a >= 1e4 ? 0 : 1)}K`;
    return `${s}$${Math.round(a)}`;
};
const plain = (v) => signed(v).replace('+', '');
const signColor = (v) => (v < 0 ? STATE.negative : v > 0 ? STATE.positive : TEXT.muted);
const duration = (m) => (m == null || !Number.isFinite(Number(m)) ? '—'
    : Number(m) < 60 ? `${Math.round(m)}m` : `${Math.floor(m / 60)}h ${String(Math.round(m % 60)).padStart(2, '0')}m`);

function Tile({ label, value, color = TEXT.primary, sub }) {
    return (
        <Box sx={{ px: 1.25, py: 1, borderRadius: 1.5, bgcolor: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', minWidth: 0 }}>
            <Typography sx={{ ...systemLabel, lineHeight: 1.3 }}>{label}</Typography>
            <Typography sx={{ fontSize: 20, fontWeight: 800, color, fontVariantNumeric: 'tabular-nums', lineHeight: 1.25, whiteSpace: 'nowrap' }}>{value}</Typography>
            {sub ? <Typography sx={{ fontSize: 11, color: TEXT.faint }}>{sub}</Typography> : null}
        </Box>
    );
}

function Section({ title, right, children }) {
    return (
        <Box>
            <Stack direction="row" sx={{ alignItems: 'baseline', justifyContent: 'space-between', mb: 0.6, gap: 1 }}>
                <Typography sx={systemLabel}>{title}</Typography>
                {right ? <Typography sx={{ fontSize: 12, color: TEXT.faint }}>{right}</Typography> : null}
            </Stack>
            {children}
        </Box>
    );
}

function trailFrom(rows) {
    const m = new Map();
    for (const r of rows || []) {
        const key = `${r.gametype}|${r.table}|${r.shoe_id}`;
        let e = m.get(key);
        if (!e) {
            e = { key, tableKey: `${r.gametype}|${r.table}`, shoeId: r.shoe_id, hands: new Set(), wager: 0, result: 0, lastTs: r.ts };
            m.set(key, e);
        }
        e.hands.add(r.hand_in_shoe ?? r.ts);
        e.wager += Number(r.wager) || 0;
        e.result -= Number(r.win_loss) || 0;                 // feed is casino perspective
        if (String(r.ts) > String(e.lastTs)) e.lastTs = r.ts;
    }
    return [...m.values()]
        .map((e) => ({ ...e, hands: e.hands.size }))
        .sort((a, b) => String(b.lastTs).localeCompare(String(a.lastTs)));
}

function spreadOf(p) {
    const min = Number(p.min_bet), max = Number(p.max_bet);
    if (Number.isFinite(min) && Number.isFinite(max) && min > 0) {
        return { value: `${Math.round(max / min)} : 1`, sub: 'max ÷ min bet', alert: max / min > 15 };
    }
    const sd = Number(p.bet_stdev), avg = Number(p.avg_bet);
    if (Number.isFinite(sd) && Number.isFinite(avg) && avg > 0) {
        return { value: (sd / avg).toFixed(2), sub: 'bet CV (stdev ÷ avg)', alert: sd / avg > 1.5 };
    }
    return { value: '—', sub: 'no bet data', alert: false };
}

export default function RtPatronPanel({ patronId, patronRow, shoe, tableKey, trailRows, trailLoading, onPickTable, onOpen360, onClear }) {
    const inShoe = useMemo(() => patronBetsInShoe(shoe, patronId), [shoe, patronId]);
    const trail = useMemo(() => trailFrom(trailRows), [trailRows]);

    if (!patronId) {
        return (
            <Stack spacing={1} sx={{ alignItems: 'center', justifyContent: 'center', textAlign: 'center', py: 8, color: TEXT.disabled }}>
                <PersonSearchIcon sx={{ fontSize: 34 }} />
                <Typography sx={{ fontSize: 15, fontWeight: 700, color: TEXT.muted }}>No patron selected</Typography>
                <Typography sx={{ fontSize: 13, color: TEXT.faint, maxWidth: 360 }}>
                    Click a player in a hand on the left, a row in the Patrons tab, or a patron alert.
                </Typography>
            </Stack>
        );
    }

    const p = patronRow || {};
    const tier = CARD_TIERS[p.card_type] || CARD_TIERS.BASE;
    const today = -(Number(p.cum_win) || 0);
    const spread = spreadOf(p);
    const shoeResult = inShoe.reduce((a, b) => a - b.casinoWin, 0);
    const shoeWager = inShoe.reduce((a, b) => a + b.wager, 0);

    return (
        <Stack spacing={2}>
            <Stack direction="row" spacing={1.25} sx={{ alignItems: 'center' }}>
                <Box sx={{ width: 46, height: 46, borderRadius: '50%', display: 'grid', placeItems: 'center', flexShrink: 0, bgcolor: `${tier.accent}26`, border: `1.5px solid ${tier.accent}`, color: tier.accent, fontWeight: 800, fontSize: 13 }}>
                    {String(patronId).slice(-2)}
                </Box>
                <Box sx={{ minWidth: 0, flex: 1 }}>
                    <Typography sx={systemLabel}>Patron</Typography>
                    <Typography sx={{ fontSize: 22, fontWeight: 800, color: TEXT.primary, lineHeight: 1.15 }}>{patronId}</Typography>
                    <Typography sx={{ fontSize: 12, color: TEXT.faint }}>
                        <Box component="span" sx={{ color: tier.accent, fontWeight: 700 }}>{tier.label}</Box>
                        {` · ${p.segment || '—'} · ${p.current_table_key ? `seat ${p.current_seat ?? '—'} at ${p.current_table_key}` : 'not seated'} · on floor ${duration(p.sign_in_mins_ago)}`}
                    </Typography>
                </Box>
                <ButtonBase aria-label="Clear patron" onClick={onClear} sx={{ color: TEXT.muted, borderRadius: 1, p: 0.5, '&:hover': { color: TEXT.primary } }}>
                    <CloseIcon sx={{ fontSize: 18 }} />
                </ButtonBase>
            </Stack>

            {!patronRow ? (
                <Typography sx={{ fontSize: 13, color: STATE.warning }}>Not in the current patron feed — they may have left the floor.</Typography>
            ) : (
                <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1 }}>
                    <Tile label="Today" value={signed(today)} color={signColor(today)} sub="patron's result" />
                    <Tile label="Turnover" value={plain(Number(p.cum_wager))} sub={`${p.hands ?? 0} hands · ${p.tables_played ?? 0} tables`} />
                    <Tile label="Avg bet" value={plain(Number(p.avg_bet))} />
                    <Tile label="Bet spread" value={spread.value} color={spread.alert ? STATE.warning : TEXT.primary} sub={spread.sub} />
                </Box>
            )}

            <Section title={`In this shoe${tableKey ? ` · ${tableKey}` : ''}`} right={inShoe.length ? `${inShoe.length} bets · ${plain(shoeWager)} · ${signed(shoeResult)}` : null}>
                {inShoe.length ? (
                    <Box sx={{ maxHeight: 220, overflowY: 'auto', scrollbarWidth: 'thin' }}>
                        {inShoe.slice().reverse().map((b, i) => {
                            const side = SIDE[b.betType] || { t: b.betType, c: TEXT.muted };
                            const res = -b.casinoWin;
                            return (
                                <Stack key={i} direction="row" spacing={1.25} sx={{ alignItems: 'center', px: 1, py: 0.6, borderRadius: 1, bgcolor: i % 2 ? 'transparent' : 'rgba(255,255,255,0.025)' }}>
                                    <Typography sx={{ width: 40, fontSize: 13, fontWeight: 800, color: TEXT.primary, fontVariantNumeric: 'tabular-nums' }}>#{b.handNo}</Typography>
                                    <Box sx={{ minWidth: 30, px: 0.75, py: 0.2, borderRadius: 1, bgcolor: side.c, color: '#fff', fontSize: 12, fontWeight: 800, textAlign: 'center' }}>{side.t}</Box>
                                    <Typography sx={{ flex: 1, fontSize: 13, color: TEXT.secondary, fontVariantNumeric: 'tabular-nums' }}>{plain(b.wager)}</Typography>
                                    <Typography sx={{ fontSize: 14, fontWeight: 800, color: signColor(res), fontVariantNumeric: 'tabular-nums' }}>{signed(res)}</Typography>
                                </Stack>
                            );
                        })}
                    </Box>
                ) : (
                    <Typography sx={{ fontSize: 13, color: TEXT.faint }}>Not playing the shoe shown on the left.</Typography>
                )}
            </Section>

            <Section title="Today's trail" right={trail.length ? `${trail.length} shoes` : null}>
                {trailLoading ? (
                    <Stack sx={{ alignItems: 'center', py: 2 }}><CircularProgress size={20} sx={{ color: ACCENT }} /></Stack>
                ) : trail.length ? (
                    <Box sx={{ maxHeight: 240, overflowY: 'auto', scrollbarWidth: 'thin' }}>
                        {trail.map((t) => (
                            <ButtonBase
                                key={t.key}
                                onClick={() => onPickTable(t.tableKey)}
                                sx={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'flex-start', gap: 1.25, px: 1, py: 0.6, borderRadius: 1, textAlign: 'left', '&:hover': { bgcolor: 'rgba(255,255,255,0.05)' } }}
                            >
                                <Typography sx={{ width: 92, fontSize: 13, fontWeight: 700, color: t.tableKey === tableKey ? ACCENT : TEXT.primary }}>{t.tableKey}</Typography>
                                <Typography sx={{ flex: 1, fontSize: 12, color: TEXT.faint, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                    {t.shoeId} · {t.hands} hand{t.hands === 1 ? '' : 's'} · {plain(t.wager)}
                                </Typography>
                                <Typography sx={{ fontSize: 13, fontWeight: 800, color: signColor(t.result), fontVariantNumeric: 'tabular-nums' }}>{signed(t.result)}</Typography>
                            </ButtonBase>
                        ))}
                    </Box>
                ) : (
                    <Typography sx={{ fontSize: 13, color: TEXT.faint }}>No betting records returned for today.</Typography>
                )}
            </Section>

            <ButtonBase
                onClick={onOpen360}
                aria-haspopup="dialog"
                sx={{ alignSelf: 'flex-start', gap: 0.9, px: 1.75, py: 1, borderRadius: 1.5, border: '1px solid rgba(122,162,247,0.5)', bgcolor: 'rgba(122,162,247,0.1)', color: ACCENT, fontSize: 14, fontWeight: 800, '&:hover': { bgcolor: 'rgba(122,162,247,0.18)' }, '&.Mui-focusVisible': { outline: `2px solid ${ACCENT}`, outlineOffset: 2 } }}
            >
                <OpenInFullIcon sx={{ fontSize: 17 }} />
                Open Player 360
            </ButtonBase>
        </Stack>
    );
}
