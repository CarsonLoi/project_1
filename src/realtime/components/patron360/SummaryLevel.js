// Level 1 — every bet option he played in the period, one row each, every
// KPI in its own sortable column. Default order: most below theo first.

import React from 'react';
import { Box, Button, ButtonBase, Stack, Typography } from '@mui/material';
import { TEXT, ACCENT } from '../../constants/rtTheme';
import { LEVEL_COLOR, money, plain, pct, share, signColor, optionColor } from './format';
import SortableTable from './SortableTable';
import { EdgeGauge, OptionChip, Panel, StateDot, MAGENTA_TEXT, edgeColor, edgeTextColor } from './levelParts';

const PERIOD_IDS = [['today', 'Today'], ['3m', 'Last 3 months'], ['12m', 'Last 12 months']];

export function Stamp({ level, size = 'sm' }) {
    const c = LEVEL_COLOR[level] || TEXT.muted;
    const big = size === 'lg';
    return (
        <Box component="span" sx={{
            display: 'inline-block', px: big ? 2 : 1.25, py: big ? 0.75 : 0.35, borderRadius: 1.5, border: `2px solid ${c}`, color: c,
            fontSize: big ? 22 : 13, fontWeight: 900, letterSpacing: '0.1em', whiteSpace: 'nowrap', lineHeight: 1.2,
        }}>{level}</Box>
    );
}

function PeriodDots({ code, byPeriod }) {
    return (
        <Stack direction="row" spacing={0.6} sx={{ justifyContent: 'center' }}>
            {PERIOD_IDS.map(([id, label]) => {
                const k = byPeriod[id] && byPeriod[id].get(code);
                const has = k && k.bets > 0;
                return (
                    <Box key={id} component="span" title={has ? `${label}: edge played ${pct(k.edgePlayed, 2)}` : `${label}: no bets`}
                        sx={{
                            width: 12, height: 12, borderRadius: '50%', display: 'inline-block',
                            border: has ? 'none' : '1.5px solid rgba(255,255,255,0.3)',
                            bgcolor: has ? edgeColor(k.edgePlayed, k.theoEdge) : 'transparent',
                        }} />
                );
            })}
        </Stack>
    );
}

export default function SummaryLevel({ rows, byPeriod, verdict, worst, periodLabel, sort, onSort, onOpen }) {
    if (!rows.length) {
        return <Panel title={`No bets · ${periodLabel}`}><Typography sx={{ fontSize: 13, color: TEXT.faint }}>Pick a longer period.</Typography></Panel>;
    }
    const columns = [
        { key: 'code', label: 'Option', align: 'left', firstDir: 1, render: (r) => (
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                <StateDot state={r.worst} /><OptionChip color={optionColor(r.code)} />
                <Typography component="span" sx={{ fontSize: 14, fontWeight: 800 }}>{r.code}</Typography>
            </Stack>
        ) },
        { key: 'theoEdge', label: 'Theo edge', title: 'Nominal house edge of the bet option', firstDir: 1, render: (r) => <Box component="span" sx={{ color: TEXT.muted }}>{pct(r.theoEdge, 2)}</Box> },
        { key: 'edgePlayed', label: 'Edge played', title: 'Wager-weighted live edge at each bet he placed', firstDir: 1, render: (r) => <EdgeGauge edge={r.edgePlayed} theo={r.theoEdge} /> },
        { key: 'bets', label: 'Bets', gap: true, render: (r) => r.bets.toLocaleString() },
        { key: 'involvement', label: 'Involvement', title: 'Bets ÷ hands he was seated for', render: (r) => share(r.involvement) },
        { key: 'turnover', label: 'Turnover', render: (r) => plain(r.turnover) },
        { key: 'avgBet', label: 'Avg bet', render: (r) => plain(r.avgBet) },
        { key: 'shoes', label: 'Played', gap: true, render: (r) => r.shoes },
        { key: 'negShoes', label: '−edge', title: "Shoes where this option's edge went below 0 while he was seated", render: (r) => r.negShoes },
        { key: 'negShoesBet', label: 'Bet on −edge', title: '−edge shoes where he bet this option on a −edge hand', render: (r) => (
            <Box component="b" sx={{ color: r.negShoesBet ? MAGENTA_TEXT : TEXT.faint, fontWeight: r.negShoesBet ? 800 : 400 }}>{r.negShoesBet}</Box>
        ) },
        { key: 'theoGeneric', label: 'Casino Theo · theo edge', gap: true, title: 'Σ wager × theo edge: what the casino should win at the nominal edge', render: (r) => money(r.theoGeneric) },
        { key: 'theoActual', label: 'Casino Theo · actual edge', firstDir: 1, title: 'Σ wager × live edge at each bet: what the casino should win given the cards left when he bet', render: (r) => (
            <Box component="b" sx={{ color: r.theoActual == null ? TEXT.faint : r.theoActual < 0 ? MAGENTA_TEXT : r.theoGeneric && r.theoActual < r.theoGeneric * 0.6 ? '#e0af68' : TEXT.primary }}>{money(r.theoActual)}</Box>
        ) },
        { key: 'patronWin', label: 'Patron Win', render: (r) => <Box component="b" sx={{ color: signColor(r.patronWin) }}>{money(r.patronWin)}</Box> },
        { key: 'trend', label: '3 periods', gap: true, sortable: false, align: 'center', title: 'Edge played · Today, Last 3 months, Last 12 months', render: (r) => <PeriodDots code={r.code} byPeriod={byPeriod} /> },
        { key: 'go', label: '', sortable: false, align: 'right', width: 16, render: () => <Box component="span" sx={{ color: ACCENT, fontWeight: 800 }}>›</Box> },
    ];
    const groups = [
        { span: 1 }, { label: 'House edge', span: 2 }, { label: 'Involvement', span: 4, gap: true },
        { label: 'Shoes', span: 3, gap: true }, { label: 'Money', span: 3, gap: true }, { label: 'Trend', span: 1, gap: true }, { span: 1 },
    ];

    return (
        <Stack spacing={1.5}>
            <Panel raised>
                <Stack direction="row" sx={{ alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
                    <Stamp level={verdict.level} size="lg" />
                    {worst ? (
                        <Box sx={{ minWidth: 0 }}>
                            <Typography sx={{ fontSize: 20, fontWeight: 800, color: TEXT.primary }}>
                                <Box component="span" sx={{ color: optionColor(worst.code) }}>{worst.code}</Box>
                                {' edge played '}
                                <Box component="span" sx={{ color: edgeTextColor(worst.edgePlayed) }}>{pct(worst.edgePlayed, 2)}</Box>
                                {` vs theo ${pct(worst.theoEdge, 2)}`}
                            </Typography>
                            <Typography sx={{ fontSize: 12, color: TEXT.faint }}>
                                {`${worst.negBets} of ${worst.bets} ${worst.code} bets on −edge hands · ${worst.negShoesBet} of ${worst.negShoes} −edge shoes bet · ${periodLabel}`}
                            </Typography>
                        </Box>
                    ) : null}
                    <Box sx={{ flex: 1 }} />
                    {worst ? (
                        <Button variant="contained" onClick={() => onOpen(worst.code)}
                            sx={{ textTransform: 'none', fontWeight: 800, bgcolor: ACCENT, color: '#0d0e18', '&:hover': { bgcolor: '#9bb8ff' } }}>
                            Open {worst.code} →
                        </Button>
                    ) : null}
                </Stack>
            </Panel>
            <Panel
                title="By bet option"
                hint={`${periodLabel} · ${sort.key === 'gap' ? 'most below theo first' : 'sorted by column'} · click a header to sort · click a row to go deeper`}
                right={(
                    <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
                        {sort.key !== 'gap' ? (
                            <ButtonBase onClick={() => onSort({ key: 'gap', dir: 1 })} sx={{ fontSize: 12, fontWeight: 700, color: ACCENT }}>Most below theo first</ButtonBase>
                        ) : null}
                        {[['flag', 'flag'], ['watch', 'watch'], ['clear', 'clear']].map(([s, l]) => (
                            <Stack key={s} direction="row" spacing={0.5} sx={{ alignItems: 'center' }}><StateDot state={s} /><Typography sx={{ fontSize: 12, color: TEXT.muted }}>{l}</Typography></Stack>
                        ))}
                    </Stack>
                )}
            >
                <SortableTable
                    ariaLabel="Bet options"
                    columns={columns}
                    groups={groups}
                    rows={rows}
                    rowKey={(r) => r.code}
                    sort={sort}
                    onSort={onSort}
                    onRowClick={(r) => onOpen(r.code)}
                    rowLabel={(r) => `Open ${r.code}`}
                    minWidth={1240}
                />
            </Panel>
        </Stack>
    );
}
