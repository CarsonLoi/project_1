// Floor betting mix — wager and hold by bet option.
// =================================================
// Aggregate rather than per-patron. Side bets carry several times the
// house edge of a main bet, so the floor's bet MIX moves expected win
// independently of volume — a shift toward or away from side bets
// changes what the house should be winning without any change in how
// much is being wagered. That makes the mix itself a signal, not just
// a curiosity.
//
// Two bars per option: share of total wager, and realised hold. A bet
// option taking heavy volume at a hold well below its nominal edge is
// the pattern worth a second look.

import React, { useMemo } from 'react';
import { Box, Stack, Typography, Tooltip, ToggleButtonGroup, ToggleButton } from '@mui/material';
import { TEXT, STATE, ACCENT, ACCENT_BG, ACCENT_BORDER, TYPE } from '../constants/rtTheme';

const money = (v) => {
    if (v == null || !Number.isFinite(v)) return '—';
    const a = Math.abs(v), s = v < 0 ? '-' : '';
    if (a >= 1e6) return `${s}$${(a / 1e6).toFixed(2)}M`;
    if (a >= 1e3) return `${s}$${(a / 1e3).toFixed(0)}K`;
    return `${s}$${a.toFixed(0)}`;
};

export default function RtBetMixPanel({ betmix = [], mode = 'wager', onModeChange }) {
    // Roll (gametype, bet_option) rows up to bet option — the panel is
    // about the floor's mix, and splitting MAIN across five gametypes
    // would bury the comparison that matters.
    const rows = useMemo(() => {
        const by = new Map();
        for (const r of betmix) {
            const k = r.bet_option || '—';
            let e = by.get(k);
            if (!e) { e = { bet_option: k, wager: 0, win_loss: 0, hands: 0, games: new Set() }; by.set(k, e); }
            e.wager += Number(r.wager) || 0;
            e.win_loss += Number(r.win_loss) || 0;
            e.hands += Number(r.hands) || 0;
            if (r.gametype) e.games.add(r.gametype);
        }
        const list = [...by.values()].map((e) => ({
            ...e,
            hold: e.wager > 0 ? (e.win_loss / e.wager) * 100 : null,
        }));
        return list.sort((a, b) => b.wager - a.wager);
    }, [betmix]);

    const maxWager = useMemo(() => Math.max(1, ...rows.map((r) => r.wager)), [rows]);
    const maxHold = useMemo(() => Math.max(1, ...rows.map((r) => Math.abs(r.hold ?? 0))), [rows]);

    if (!rows.length) {
        return (
            <Stack sx={{ alignItems: 'center', justifyContent: 'center', py: 4, color: TEXT.faint }}>
                <Typography sx={{ fontSize: TYPE.label }}>No bet-mix data available.</Typography>
                <Typography sx={{ fontSize: TYPE.micro, mt: 0.5 }}>Check the /realtime/betmix endpoint.</Typography>
            </Stack>
        );
    }

    return (
        <Box>
            <Stack direction="row" sx={{ justifyContent: 'flex-end', mb: 0.8 }}>
                <ToggleButtonGroup
                    exclusive size="small" value={mode}
                    onChange={(_, v) => v && onModeChange && onModeChange(v)}
                    sx={{
                        height: 24,
                        '& .MuiToggleButton-root': {
                            color: TEXT.muted, borderColor: ACCENT_BORDER,
                            textTransform: 'none', fontSize: TYPE.caption, fontWeight: 700, px: 1.2, py: 0.2,
                        },
                        '& .Mui-selected': { color: `${TEXT.primary} !important`, bgcolor: `${ACCENT_BG} !important` },
                    }}
                >
                    <ToggleButton value="wager">Wager</ToggleButton>
                    <ToggleButton value="hold">Hold %</ToggleButton>
                </ToggleButtonGroup>
            </Stack>

            <Stack spacing={0.5}>
                {rows.map((r) => {
                    const isHold = mode === 'hold';
                    const raw = isHold ? (r.hold ?? 0) : r.wager;
                    const pctWidth = isHold
                        ? Math.min(100, (Math.abs(raw) / maxHold) * 100)
                        : (r.wager / maxWager) * 100;
                    const neg = isHold && raw < 0;
                    const color = isHold ? (neg ? STATE.negative : STATE.positive) : ACCENT;
                    const share = maxWager > 0 ? (r.wager / rows.reduce((a, x) => a + x.wager, 0)) * 100 : 0;

                    return (
                        <Tooltip
                            key={r.bet_option}
                            disableInteractive
                            placement="left"
                            title={`${r.bet_option} — wager ${money(r.wager)} (${share.toFixed(1)}% of floor), hold ${r.hold != null ? r.hold.toFixed(2) + '%' : '—'}, ${r.hands.toLocaleString()} hands`}
                        >
                            <Stack direction="row" spacing={0.9} sx={{ alignItems: 'center' }}>
                                <Typography sx={{
                                    width: 92, flexShrink: 0, fontSize: TYPE.caption, fontWeight: 700,
                                    color: TEXT.primary, textAlign: 'right',
                                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                                }}>
                                    {r.bet_option}
                                </Typography>
                                <Box sx={{ flex: 1, minWidth: 30 }}>
                                    <Box sx={{
                                        width: `${pctWidth}%`, height: 9, bgcolor: color,
                                        borderRadius: 3, transition: 'width 200ms',
                                    }} />
                                </Box>
                                <Typography sx={{
                                    width: 66, flexShrink: 0, textAlign: 'right',
                                    fontSize: TYPE.caption, fontWeight: 800, color,
                                    fontVariantNumeric: 'tabular-nums',
                                }}>
                                    {isHold ? (r.hold != null ? `${r.hold.toFixed(1)}%` : '—') : money(r.wager)}
                                </Typography>
                            </Stack>
                        </Tooltip>
                    );
                })}
            </Stack>
        </Box>
    );
}
