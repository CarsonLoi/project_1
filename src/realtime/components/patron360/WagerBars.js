// Hand by hand wager for one shoe, stacked by bet option in the option
// colours. Chips hide and show options; the option under review has a
// white outline.

import React, { useEffect, useMemo, useState } from 'react';
import { Box, ButtonBase } from '@mui/material';
import { PATRON_360 } from '../../constants/rtConfig';
import { TEXT, ACCENT } from '../../constants/rtTheme';
import useEChart, { cursorSeries, setCursor } from './useEChart';
import { money, optionColor, plain } from './format';

const rank = (c) => {
    const i = PATRON_360.BET_OPTIONS.findIndex((o) => o.code === c);
    return i === -1 ? 99 : i;
};

// Seated hands only. The option under review keeps its colour; the others
// are grey so its bets stand out.
export default function WagerBars({ view, code, cursorHand = null, onHoverHand, onPickHand, height = 300 }) {
    const codes = useMemo(() => [...new Set(view.bets.map((b) => b.betType))].sort((a, b) => rank(a) - rank(b)), [view]);
    const [hidden, setHidden] = useState(() => new Set());

    const option = useMemo(() => {
        const first = view.firstHand ?? 1;
        const last = view.lastHand ?? view.maxHand;
        const xs = Array.from({ length: Math.max(1, last - first + 1) }, (_, i) => first + i);
        return {
            backgroundColor: 'transparent',
            animation: false,
            grid: { left: 60, right: 12, top: 12, bottom: 28 },
            tooltip: {
                trigger: 'axis', axisPointer: { type: 'shadow' },
                backgroundColor: 'rgba(14,16,28,0.97)', borderColor: 'rgba(122,162,247,0.45)', textStyle: { color: '#fff', fontSize: 12 },
                formatter: (ps) => {
                    const hand = Number(ps[0].axisValue);
                    const m = view.betsByHand.get(hand);
                    if (!m) return `Hand #${hand} · no bets`;
                    const lines = [...m].sort(([a], [b]) => rank(a) - rank(b))
                        .map(([c, x]) => `<div><span style="color:${optionColor(c)}">■</span> ${c} ${plain(x.wager)} · Patron Win ${money(-x.casinoWin)}</div>`);
                    return `<div style="font-weight:800;margin-bottom:3px">Hand #${hand}</div>${lines.join('')}`;
                },
            },
            xAxis: {
                type: 'category', data: xs,
                axisLabel: { color: TEXT.muted, fontSize: 11 }, axisTick: { show: false },
                axisLine: { lineStyle: { color: 'rgba(255,255,255,0.15)' } },
            },
            yAxis: {
                type: 'value',
                axisLabel: { color: TEXT.muted, fontSize: 11, formatter: (v) => plain(v) },
                splitLine: { lineStyle: { color: 'rgba(255,255,255,0.06)', type: 'dashed' } },
            },
            series: codes.filter((c) => !hidden.has(c)).map((c) => ({
                name: c, type: 'bar', stack: 'w', barMaxWidth: 16,
                itemStyle: { color: !code || c === code ? optionColor(c) : 'rgba(255,255,255,0.22)' },
                cursor: 'pointer',
                data: xs.map((h) => {
                    const m = view.betsByHand.get(h);
                    const x = m && m.get(c);
                    return x ? x.wager : '-';
                }),
            })).concat([cursorSeries()]),
        };
    }, [view, codes, hidden, code]);
    const first = view.firstHand ?? 1;
    const ref = useEChart(option, {
        updateAxisPointer: (e) => {
            const i = e.axesInfo && e.axesInfo[0];
            if (i && onHoverHand) onHoverHand(first + Number(i.value));
        },
        globalout: () => onHoverHand && onHoverHand(null),
        click: (p) => { if (onPickHand && p.componentType === 'series') onPickHand(Number(p.name)); },
    });
    useEffect(() => {
        const last = view.lastHand ?? view.maxHand;
        setCursor(ref, cursorHand == null || cursorHand < first || cursorHand > last ? null : cursorHand - first);
    }, [ref, cursorHand, first, view, option]);

    const toggle = (c) => setHidden((s) => {
        const n = new Set(s);
        if (n.has(c)) n.delete(c); else n.add(c);
        return n;
    });

    return (
        <Box>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.6, mb: 1 }}>
                {codes.map((c) => {
                    const off = hidden.has(c);
                    return (
                        <ButtonBase
                            key={c}
                            onClick={() => toggle(c)}
                            aria-pressed={!off}
                            aria-label={`${off ? 'Show' : 'Hide'} ${c}`}
                            sx={{
                                px: 1, py: 0.35, borderRadius: 0.75, fontSize: 12, fontWeight: 800, gap: 0.5,
                                bgcolor: off ? 'transparent' : optionColor(c), color: off ? TEXT.muted : '#0d0e18',
                                border: `1px solid ${c === code ? '#ffffff' : optionColor(c)}`,
                                '&.Mui-focusVisible': { outline: `2px solid ${ACCENT}`, outlineOffset: 2 },
                            }}
                        >
                            {c}{off ? ' +' : ' ×'}
                        </ButtonBase>
                    );
                })}
            </Box>
            <Box ref={ref} role="img" aria-label="Wager per hand stacked by bet option" sx={{ width: '100%', height }} />
        </Box>
    );
}
