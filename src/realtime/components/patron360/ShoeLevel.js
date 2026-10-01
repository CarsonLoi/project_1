// Level 3 — one shoe for the option under review (and Level 3b, several
// shoes compared). Edge by hand and wager by hand share a hand cursor
// with the trend board; clicking a hand opens it.

import React, { useMemo, useState } from 'react';
import { Box, ButtonBase, Stack, Typography } from '@mui/material';
import { TEXT, ACCENT, systemLabel } from '../../constants/rtTheme';
import { inWindow } from '../../utils/patron360';
import ShoeRoads, { MARK_COLOR, EMPHASIS_COLOR } from '../ShoeRoads';
import EdgeCurves from './EdgeCurves';
import WagerBars from './WagerBars';
import { SHOE_COLORS, money, plain, pct, signColor } from './format';
import { Kpi, KpiRow, Panel, MAGENTA_TEXT, edgeTextColor } from './levelParts';

const ringKey = (color) => (
    <Box component="span" sx={{ display: 'inline-block', width: 11, height: 11, borderRadius: '50%', border: `2.5px solid ${color}`, bgcolor: '#e8edf7', verticalAlign: 'middle', mr: 0.5 }} />
);

function shoeFacts(view, code) {
    let wager = 0, casino = 0;
    for (const b of view.bets) { wager += b.wager; casino += b.casinoWin; }
    let negHands = 0, negBet = 0, seatedHands = 0;
    for (const h of view.hands) {
        if (!inWindow(view, h.handNo)) continue;
        seatedHands += 1;
        const e = h.edge[code];
        if (e != null && e < 0) {
            negHands += 1;
            const m = view.betsByHand.get(h.handNo);
            if (m && m.get(code)) negBet += 1;
        }
    }
    const last = view.hands[view.hands.length - 1];
    return { wager, patronWin: -casino, negHands, negBet, seatedHands, endEdge: last ? last.edge[code] : null };
}

export function ShoeLevel({ view, code, onOpenHand }) {
    const [hover, setHover] = useState(null);
    const [allRoads, setAllRoads] = useState(false);
    const f = useMemo(() => shoeFacts(view, code), [view, code]);
    const views = useMemo(() => [view], [view]);
    const marks = useMemo(() => {
        const any = new Set(view.betsByHand.keys());
        const opt = new Set();
        for (const [h, m] of view.betsByHand) if (m.has(code)) opt.add(h);
        return { any, opt };
    }, [view, code]);

    return (
        <Stack spacing={1.5}>
            <Panel raised>
                <KpiRow>
                    <Kpi label="Date · table" value={`${String(view.date).slice(5)} · ${view.tableKey}`} sub={view.shoeId} />
                    <Kpi label="Seated" value={`#${view.firstHand ?? '—'}–#${view.lastHand ?? '—'}`} sub={`${f.seatedHands} of ${view.hands.length} hands`} />
                    <Kpi label="Patron Win · shoe" value={money(f.patronWin)} sub={`on ${plain(f.wager)} wagered · all options`} color={signColor(f.patronWin)} />
                    <Kpi label={`${code} −edge hands`} value={`${f.negBet} of ${f.negHands}`} sub="bet · seated" color={f.negBet ? MAGENTA_TEXT : TEXT.primary} />
                    <Kpi label={`${code} edge at end`} value={pct(f.endEdge, 2)} color={edgeTextColor(f.endEdge)} />
                </KpiRow>
            </Panel>
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: 'minmax(0,1fr) minmax(0,1fr)' }, gap: 1.5 }}>
                <Panel title={`${code} edge by hand`} hint="dots = his bets (filled = Patron Win) · dashed = theo · click to open a hand">
                    <EdgeCurves views={views} code={code} cursorHand={hover} onHoverHand={setHover} onPickHand={(_, h) => onOpenHand(h)} height={320} />
                </Panel>
                <Panel title="His wager by hand" hint={`seated hands only · ${code} in colour, others grey · click a bar`}>
                    <WagerBars view={view} code={code} cursorHand={hover} onHoverHand={setHover} onPickHand={onOpenHand} height={284} />
                </Panel>
            </Box>
            <Panel
                title="Trend board"
                hint={<>{ringKey(EMPHASIS_COLOR)}bet {code} · {ringKey(MARK_COLOR)}other bets · hover a chart to find the hand · click a bead to open it</>}
                right={(
                    <ButtonBase onClick={() => setAllRoads((v) => !v)} aria-expanded={allRoads}
                        sx={{ fontSize: 12, fontWeight: 700, color: ACCENT, px: 1, py: 0.5, borderRadius: 1, border: '1px solid rgba(122,162,247,0.4)' }}>
                        {allRoads ? 'Fewer roads' : 'More roads'}
                    </ButtonBase>
                )}
            >
                {view.hands.length ? (
                    <ShoeRoads hands={view.hands} full={allRoads} selectedHandNo={hover} onSelectHand={onOpenHand}
                        markedHands={marks.any} emphasisHands={marks.opt} />
                ) : <Typography sx={{ fontSize: 13, color: TEXT.faint }}>No hand results for this shoe.</Typography>}
            </Panel>
        </Stack>
    );
}

export function CompareLevel({ views, code, onOpenShoe, onOpenHand }) {
    return (
        <Stack spacing={1.5}>
            <Panel raised title={`${code} edge by hand · ${views.length} shoes`} hint="click a shoe to open it · click a dot to open that hand">
                <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 1 }}>
                    {views.map((v, i) => {
                        let pw = 0, n = 0;
                        for (const b of v.bets) if (b.betType === code) { pw -= b.casinoWin; n += 1; }
                        const c = SHOE_COLORS[i % SHOE_COLORS.length];
                        return (
                            <ButtonBase key={v.shoeKey} onClick={() => onOpenShoe(v.shoeKey)}
                                sx={{ display: 'block', textAlign: 'left', px: 1.5, py: 0.75, borderRadius: 1.5, border: `1px solid ${c}`, bgcolor: 'rgba(255,255,255,0.04)', '&.Mui-focusVisible': { outline: `2px solid ${ACCENT}`, outlineOffset: 2 } }}>
                                <Typography sx={{ ...systemLabel, color: c }}>{`${String(v.date).slice(5)} · ${v.tableKey}`}</Typography>
                                <Typography sx={{ fontSize: 16, fontWeight: 800, color: signColor(pw), fontVariantNumeric: 'tabular-nums' }}>{n ? money(pw) : '—'}</Typography>
                                <Typography sx={{ fontSize: 11, color: TEXT.faint }}>{n} {code} bets · Patron Win · open ›</Typography>
                            </ButtonBase>
                        );
                    })}
                </Stack>
            </Panel>
            <Panel>
                <EdgeCurves views={views} code={code} onPickHand={(v, h) => onOpenHand(v.shoeKey, h)} height={400} />
            </Panel>
        </Stack>
    );
}
