// House edge of one bet option across the selected shoes, hand by hand —
// the reference chart, extended to several shoes at once. Markers sit on
// the hands where the patron bet the option: filled = patron won,
// hollow = casino won, size = wager. Dashed = theo; the tinted band under
// 0% is where the cards favoured the player.

import React, { useEffect, useMemo } from 'react';
import { Box } from '@mui/material';
import { TEXT } from '../../constants/rtTheme';
import { OPTION_BY_CODE } from '../../utils/patron360';
import useEChart, { cursorSeries, setCursor } from './useEChart';
import { SHOE_COLORS, money, pct, plain, shoeLabel } from './format';

// `cursorHand` draws a hand cursor; hover reports the hand under the
// pointer, clicking a bet dot (or anywhere, with one shoe) picks a hand.
export default function EdgeCurves({ views, code, cursorHand = null, onHoverHand, onPickHand, height = 340 }) {
    const option = useMemo(() => {
        const opt = OPTION_BY_CODE.get(code) || { theo: 0, name: code };
        const maxHand = Math.max(1, ...views.map((v) => v.maxHand));
        let yMin = 0;
        let yMax = opt.theo;
        let maxW = 1;
        const lines = views.map((v) => {
            const pts = v.hands.filter((h) => h.edge[code] != null).map((h) => [h.handNo, h.edge[code]]);
            const edgeAt = new Map(pts);
            const bets = [];
            for (const [handNo, m] of v.betsByHand) {
                const c = m.get(code);
                if (!c || !edgeAt.has(handNo)) continue;
                bets.push([handNo, edgeAt.get(handNo), c.wager, -c.casinoWin]);
                if (c.wager > maxW) maxW = c.wager;
            }
            for (const [, e] of pts) { if (e < yMin) yMin = e; if (e > yMax) yMax = e; }
            return { v, pts, bets, edgeAt };
        });
        const pad = Math.max(2, (yMax - yMin) * 0.08);
        const series = [];
        lines.forEach(({ v, pts, bets }, i) => {
            const color = SHOE_COLORS[i % SHOE_COLORS.length];
            const name = shoeLabel(v);
            series.push({ name, type: 'line', data: pts, smooth: 0.25, showSymbol: false, lineStyle: { color, width: 2 }, itemStyle: { color }, z: 2 });
            series.push({
                name, type: 'scatter', data: bets, z: 4,
                symbolSize: (d) => 6 + 10 * Math.sqrt(d[2] / maxW),
                itemStyle: { color: (p) => (p.value[3] > 0 ? color : '#0d0e18'), borderColor: color, borderWidth: 2 },
            });
        });
        series.push({
            name: '__guides', type: 'line', data: [], silent: true,
            markLine: {
                silent: true, symbol: 'none',
                data: [
                    { yAxis: opt.theo, lineStyle: { color: '#e6e6e6', type: 'dashed', width: 1.5 }, label: { formatter: `Theo ${pct(opt.theo)}`, color: TEXT.secondary, position: 'insideEndTop', fontSize: 11 } },
                    { yAxis: 0, lineStyle: { color: 'rgba(255,255,255,0.28)', type: 'solid', width: 1 }, label: { show: false } },
                ],
            },
            ...(yMin < 0 ? { markArea: { silent: true, itemStyle: { color: 'rgba(214,92,255,0.08)' }, data: [[{ yAxis: yMin - pad }, { yAxis: 0 }]] } } : {}),
        });
        series.push(cursorSeries());
        return {
            backgroundColor: 'transparent',
            animation: false,
            grid: { left: 52, right: 16, top: 36, bottom: 30 },
            legend: {
                data: lines.map(({ v }) => shoeLabel(v)), type: 'scroll', top: 0, left: 0,
                itemWidth: 14, itemHeight: 8, textStyle: { color: TEXT.muted, fontSize: 12 }, pageTextStyle: { color: TEXT.muted },
            },
            tooltip: {
                trigger: 'axis', axisPointer: { type: 'line', snap: true },
                backgroundColor: 'rgba(14,16,28,0.97)', borderColor: 'rgba(122,162,247,0.45)', textStyle: { color: '#fff', fontSize: 12 },
                formatter: (ps) => {
                    if (!ps || !ps.length) return '';
                    const hand = Math.round(Number(ps[0].axisValue));
                    const rowsHtml = lines.map(({ v, edgeAt }, i) => {
                        if (!edgeAt.has(hand)) return '';
                        const m = v.betsByHand.get(hand);
                        const c = m && m.get(code);
                        const bet = c ? ` · bet ${plain(c.wager)} ${money(-c.casinoWin)}` : '';
                        return `<div><span style="color:${SHOE_COLORS[i % SHOE_COLORS.length]}">●</span> ${shoeLabel(v)}: ${pct(edgeAt.get(hand), 2)}${bet}</div>`;
                    }).join('');
                    return `<div style="font-weight:800;margin-bottom:3px">Hand #${hand}</div>${rowsHtml}`;
                },
            },
            xAxis: {
                type: 'value', min: 1, max: maxHand, minInterval: 1,
                axisLabel: { color: TEXT.muted, fontSize: 11 }, splitLine: { show: false },
                axisLine: { lineStyle: { color: 'rgba(255,255,255,0.15)' } },
            },
            yAxis: {
                type: 'value', min: Math.floor(yMin - pad), max: Math.ceil(yMax + pad),
                axisLabel: { color: TEXT.muted, fontSize: 11, formatter: (val) => `${val}%` },
                splitLine: { lineStyle: { color: 'rgba(255,255,255,0.06)' } },
            },
            series,
        };
    }, [views, code]);
    const ref = useEChart(option, {
        updateAxisPointer: (e) => {
            const i = e.axesInfo && e.axesInfo[0];
            if (i && onHoverHand) onHoverHand(Math.round(Number(i.value)));
        },
        globalout: () => onHoverHand && onHoverHand(null),
        click: (p) => {
            if (!onPickHand || p.componentType !== 'series' || p.seriesType !== 'scatter') return;
            const v = views[Math.floor(p.seriesIndex / 2)];
            if (v) onPickHand(v, Math.round(p.value[0]));
        },
    });
    // With one shoe, a click anywhere on the plot opens the hand under it.
    const pickRef = React.useRef(onPickHand);
    pickRef.current = onPickHand;
    const canPick = !!onPickHand;
    useEffect(() => {
        const c = ref.inst && ref.inst.current;
        if (!c || views.length !== 1 || !canPick) return undefined;
        const zr = c.getZr();
        const onClick = (e) => {
            if (e.target) return;                       // dots handle themselves
            const pt = c.convertFromPixel({ gridIndex: 0 }, [e.offsetX, e.offsetY]);
            if (pt && pickRef.current) pickRef.current(views[0], Math.round(pt[0]));
        };
        zr.on('click', onClick);
        return () => zr.off('click', onClick);
    }, [ref, views, canPick, option]);
    useEffect(() => { setCursor(ref, cursorHand); }, [ref, cursorHand, option]);
    return <Box ref={ref} role="img" aria-label={`House edge of ${code} by hand for the selected shoes`} sx={{ width: '100%', height, cursor: onPickHand ? 'pointer' : 'default' }} />;
}
