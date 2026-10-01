// Seat card under the table: every seat's Patron Win at a glance, or —
// with a seat selected — that player's shoe: time seated, Patron Win for
// the shoe and the day, bets on negative-edge hands, and bets per option
// with the negative-edge share in magenta.

import React, { useMemo } from 'react';
import { Box, Button, Stack, Typography } from '@mui/material';
import OpenInFullIcon from '@mui/icons-material/OpenInFull';
import { TEXT, systemLabel } from '../../constants/rtTheme';
import { money, plain, signColor } from '../patron360/format';
import { MAGENTA, MAGENTA_TEXT, VERDICT, optColor, seatColor, shortId, tierColor } from './focusShared';

const cardSx = { mt: 1.25, p: 1.5, borderRadius: 2.5, bgcolor: 'rgba(255,255,255,0.035)', border: '1px solid rgba(255,255,255,0.08)', display: 'grid', gap: 1.25 };
const cellSx = { px: 1, py: 0.75, borderRadius: 1.5, bgcolor: 'rgba(255,255,255,0.03)', minWidth: 0 };

function Cell({ label, value, color = TEXT.primary, sub, labelColor }) {
    return (
        <Box sx={cellSx}>
            <Typography sx={{ ...systemLabel, color: labelColor || systemLabel.color, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</Typography>
            <Typography sx={{ fontSize: 15, fontWeight: 800, color, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{value}</Typography>
            {sub ? <Typography sx={{ fontSize: 11, color: TEXT.faint, whiteSpace: 'nowrap' }}>{sub}</Typography> : null}
        </Box>
    );
}

const grid4 = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(132px, 1fr))', gap: 1 };

export default function SeatCard({ seats, selectedSeat, seatedMinutes, onOpen360 }) {
    const occupied = seats.filter((s) => !s.empty);
    const seat = selectedSeat != null ? occupied.find((s) => s.seat === selectedSeat) : null;

    const byCode = useMemo(() => {
        if (!seat) return [];
        const m = new Map();
        for (const b of seat.bets) {
            const e = m.get(b.code) || { code: b.code, n: 0, neg: 0 };
            e.n += 1;
            if (b.neg) e.neg += 1;
            m.set(b.code, e);
        }
        return [...m.values()].sort((a, b) => b.n - a.n);
    }, [seat]);

    if (!seat) {
        return (
            <Box sx={cardSx}>
                <Stack direction="row" spacing={1} sx={{ alignItems: 'baseline', flexWrap: 'wrap' }}>
                    <Typography sx={{ fontSize: 14, fontWeight: 800, color: TEXT.primary }}>All players</Typography>
                    <Typography sx={{ fontSize: 12, color: TEXT.faint }}>
                        {occupied.length} seated · Patron Win this shoe · click a seat to follow one player
                    </Typography>
                </Stack>
                {occupied.length ? (
                    <Box sx={grid4}>
                        {occupied.map((s) => (
                            <Cell key={s.seat} label={`S${s.seat} · ${shortId(s.playerId)}`} labelColor={seatColor(s.seat)}
                                value={money(s.shoeWin)} color={signColor(s.shoeWin)} />
                        ))}
                    </Box>
                ) : <Typography sx={{ fontSize: 13, color: TEXT.faint }}>Nobody seated in this shoe.</Typography>}
            </Box>
        );
    }

    const color = seatColor(seat.seat);
    const v = VERDICT[seat.verdict];
    const max = Math.max(1, ...byCode.map((e) => e.n));
    const minutes = seat.firstHand != null && seatedMinutes ? seatedMinutes(seat.firstHand) : null;

    return (
        <Box sx={{ ...cardSx, borderColor: color }}>
            <Stack direction="row" spacing={1.25} sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 1 }}>
                <Box sx={{ width: 12, height: 12, borderRadius: '50%', bgcolor: color }} />
                <Typography sx={{ fontSize: 16, fontWeight: 800, color: TEXT.primary }}>S{seat.seat} · {seat.playerId}</Typography>
                {seat.cardType ? <Typography sx={{ fontSize: 13, fontWeight: 800, color: tierColor(seat.cardType) }}>{seat.cardType}</Typography> : null}
                <Box component="span" title="This shoe only — open Player 360 for the full record" sx={{
                    px: 1, py: 0.2, borderRadius: 1, border: `2px solid ${v.color}`, color: v.color,
                    fontSize: 12, fontWeight: 900, letterSpacing: 1, whiteSpace: 'nowrap',
                }}>
                    {v.text} <Box component="span" sx={{ fontWeight: 700, letterSpacing: 0, color: TEXT.faint }}>· this shoe</Box>
                </Box>
                <Box sx={{ flex: 1 }} />
                <Button variant="contained" size="small" startIcon={<OpenInFullIcon />} onClick={() => onOpen360(seat.playerId)}
                    sx={{ textTransform: 'none', fontWeight: 800, bgcolor: '#7aa2f7', color: '#0d0e18', '&:hover': { bgcolor: '#9bb8ff' } }}>
                    Open Player 360
                </Button>
            </Stack>

            <Box sx={grid4}>
                <Cell label="Seated" value={minutes != null ? `${minutes}m` : '—'} sub={seat.firstHand != null ? `from hand #${seat.firstHand}` : 'no bets yet'} />
                <Cell label="Patron Win · shoe" value={money(seat.shoeWin)} color={signColor(seat.shoeWin)} sub={`on ${plain(seat.wager)} wagered`} />
                <Cell label="Patron Win · today" value={money(seat.dayWin)} color={signColor(seat.dayWin)} />
                <Cell label="Bets on −edge" value={`${seat.negBets} of ${seat.bets.length}`} color={seat.negBets ? MAGENTA_TEXT : TEXT.primary} />
            </Box>

            {byCode.length ? (
                <Box aria-label="Bets by option; magenta part = bets on negative-edge hands" sx={{ display: 'grid', gap: 0.5 }}>
                    {byCode.map((e) => (
                        <Box key={e.code} sx={{ display: 'grid', gridTemplateColumns: '62px minmax(0,1fr) 132px', gap: 1, alignItems: 'center' }}>
                            <Typography sx={{ fontSize: 12, fontWeight: 800, color: optColor(e.code) }}>{e.code}</Typography>
                            <Box sx={{ height: 10, borderRadius: 5, bgcolor: 'rgba(255,255,255,0.05)', overflow: 'hidden', display: 'flex' }}>
                                <Box sx={{ width: `${((e.n - e.neg) / max) * 100}%`, bgcolor: optColor(e.code), opacity: 0.55 }} />
                                <Box sx={{ width: `${(e.neg / max) * 100}%`, bgcolor: MAGENTA }} />
                            </Box>
                            <Typography sx={{ fontSize: 12, color: TEXT.faint, textAlign: 'right', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
                                {e.n} bets{e.neg ? <Box component="b" sx={{ color: MAGENTA_TEXT }}> · {e.neg} −edge</Box> : null}
                            </Typography>
                        </Box>
                    ))}
                </Box>
            ) : null}
        </Box>
    );
}
