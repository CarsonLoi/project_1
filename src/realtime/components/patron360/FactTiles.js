// Four evidence tiles for the option under review. Each test is a pair of
// bars — the suspicious side against the normal side — with the test
// value in a state badge. No sentences.

import React from 'react';
import { Box, Stack, Typography } from '@mui/material';
import { TEXT, systemLabel } from '../../constants/rtTheme';
import { TEST_META } from '../../utils/patron360';
import { EDGE_COLORS, STATE_GLYPH, STATE_STYLE, formatTestValue, money, plain, share, signColor } from './format';

const OTHER = '#5b6690';

function PairBars({ rows }) {
    const max = Math.max(1e-9, ...rows.map((r) => Math.abs(r.value || 0)));
    return (
        <Stack spacing={0.9}>
            {rows.map((r) => (
                <Box key={r.label} sx={{ display: 'grid', gridTemplateColumns: '54px minmax(0, 1fr) auto', alignItems: 'center', columnGap: 1 }}>
                    <Typography sx={{ fontSize: 12, fontWeight: 700, color: TEXT.muted }}>{r.label}</Typography>
                    <Box sx={{ height: 12, borderRadius: 1, bgcolor: 'rgba(255,255,255,0.05)', overflow: 'hidden' }}>
                        <Box sx={{
                            width: `${Math.max(2, (Math.abs(r.value || 0) / max) * 100)}%`, height: '100%', borderRadius: 1, bgcolor: r.color,
                            transition: 'width 300ms ease-out', '@media (prefers-reduced-motion: reduce)': { transition: 'none' },
                        }} />
                    </Box>
                    <Typography sx={{ minWidth: 62, textAlign: 'right', fontSize: 15, fontWeight: 800, color: r.textColor || TEXT.primary, fontVariantNumeric: 'tabular-nums' }}>
                        {r.text}
                    </Typography>
                </Box>
            ))}
        </Stack>
    );
}

function Tile({ label, hint, test, unit, children }) {
    const s = STATE_STYLE[test.state];
    const none = test.state === 'insufficient';
    return (
        <Box title={hint} sx={{
            p: 1.5, minWidth: 0, borderRadius: 1.5, bgcolor: 'rgba(255,255,255,0.035)',
            border: '1px solid rgba(255,255,255,0.08)', borderTop: `3px solid ${s.color}`,
        }}>
            <Stack direction="row" sx={{ alignItems: 'center', gap: 1, mb: 1.25 }}>
                <Typography sx={systemLabel}>{label}</Typography>
                <Box sx={{ flex: 1 }} />
                <Box sx={{
                    px: 0.9, py: 0.2, borderRadius: 1, border: `1px solid ${s.color}`, bgcolor: s.bg,
                    color: none ? TEXT.muted : s.color, fontSize: 12, fontWeight: 900, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap',
                }}>
                    {none ? 'NO DATA' : `${STATE_GLYPH[test.state]} ${formatTestValue(unit, test.value)}`}
                </Box>
            </Stack>
            {children}
        </Box>
    );
}

export default function FactTiles({ row }) {
    const t = row.tests;
    const hands = row.negHands + row.posHands;
    const avgNeg = row.negBets ? row.negMoney / row.negBets : null;
    const avgPos = row.posBets ? row.posMoney / row.posBets : null;
    const moneyShare = row.turnover ? row.negMoney / row.turnover : null;
    const handShare = hands ? row.negHands / hands : null;
    return (
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))' }, gap: 1.25 }}>
            <Tile label="Bet rate" hint={TEST_META.entry.question} test={t.entry} unit={TEST_META.entry.unit}>
                <PairBars rows={[
                    { label: '−edge', value: row.rateNeg, text: share(row.rateNeg), color: EDGE_COLORS.player },
                    { label: 'other', value: row.ratePos, text: share(row.ratePos), color: OTHER },
                ]} />
            </Tile>
            <Tile label="Avg bet" hint={TEST_META.ramp.question} test={t.ramp} unit={TEST_META.ramp.unit}>
                <PairBars rows={[
                    { label: '−edge', value: avgNeg, text: plain(avgNeg), color: EDGE_COLORS.player },
                    { label: 'other', value: avgPos, text: plain(avgPos), color: OTHER },
                ]} />
            </Tile>
            <Tile label="On −edge" hint={TEST_META.money.question} test={t.money} unit={TEST_META.money.unit}>
                <PairBars rows={[
                    { label: 'money', value: moneyShare, text: share(moneyShare), color: EDGE_COLORS.player },
                    { label: 'hands', value: handShare, text: share(handShare), color: OTHER },
                ]} />
            </Tile>
            <Tile label="Patron Win" hint={TEST_META.luck.question} test={t.luck} unit={TEST_META.luck.unit}>
                <PairBars rows={[
                    { label: 'actual', value: row.result, text: money(row.result), color: signColor(row.result), textColor: signColor(row.result) },
                    { label: 'expected', value: row.theo, text: money(row.theo), color: OTHER },
                ]} />
            </Tile>
        </Box>
    );
}
