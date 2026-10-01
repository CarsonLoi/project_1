// House edge by hand for the focused table's current shoe.
// "All options": ten small multiples, options below their ring threshold
// first. "One option": a large chart with every seat's bets as dots
// (filled = Patron Win, hollow = patron lost, size = bet). Hovering any
// chart moves the hand cursor on the others and on the trend board.

import React, { useMemo } from 'react';
import { Box, ButtonBase, Stack, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material';
import { PATRON_360 } from '../../constants/rtConfig';
import { ACCENT, TEXT } from '../../constants/rtTheme';
import useEChart from '../patron360/useEChart';
import { money, plain } from '../patron360/format';
import { MAGENTA_TEXT, OPT, optColor, seatColor, shortId } from './focusShared';

const W = 300;
const H = 54;
const fmtPct = (v) => (v == null ? '—' : `${v < 0 ? '−' : ''}${Math.abs(v).toFixed(2)}%`);

const segSx = {
    height: 30,
    '& .MuiToggleButton-root': { color: TEXT.muted, borderColor: 'rgba(122,162,247,0.35)', textTransform: 'none', fontSize: 12, fontWeight: 700, px: 1.25 },
    '& .Mui-selected': { color: `${TEXT.primary} !important`, bgcolor: 'rgba(122,162,247,0.24) !important' },
};

// Bets on `code` from the visible seats: [{ seat, idx, wager, patronWin }].
function visibleBets(seats, selectedSeat, code, idxOf) {
    const out = [];
    for (const s of seats) {
        if (s.empty || (selectedSeat != null && s.seat !== selectedSeat)) continue;
        for (const b of s.bets) {
            if (b.code !== code) continue;
            const idx = idxOf.get(b.handNo);
            if (idx != null) out.push({ seat: s.seat, idx, handNo: b.handNo, wager: b.wager, patronWin: b.patronWin });
        }
    }
    return out;
}

function Sparkline({ code, ys, bets, selectedSeat, hoverIdx, onHover }) {
    const n = ys.length;
    const known = ys.filter((v) => v != null);
    const theo = OPT.get(code).theo;
    if (!known.length) {
        return <Box sx={{ height: H, display: 'grid', placeItems: 'center', fontSize: 11, color: TEXT.faint }}>no edge data</Box>;
    }
    const lo = Math.min(-0.5, ...known);
    const hi = Math.max(theo * 1.1, ...known);
    const x = (i) => (n > 1 ? (i / (n - 1)) * W : W / 2);
    const y = (v) => H - 3 - ((v - lo) / (hi - lo)) * (H - 6);
    let d = '';
    ys.forEach((v, i) => { if (v != null) d += `${d && ys[i - 1] != null ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)} `; });
    const zero = y(0);
    const clip = `rt-clip-${code}`;
    const onMove = (e) => {
        const r = e.currentTarget.getBoundingClientRect();
        onHover(Math.max(0, Math.min(n - 1, Math.round(((e.clientX - r.left) / r.width) * (n - 1)))));
    };
    return (
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" width="100%" height={H} style={{ display: 'block' }}
            onMouseMove={onMove} onMouseLeave={() => onHover(null)} aria-hidden="true">
            <defs><clipPath id={clip}><rect x="0" y={zero} width={W} height={Math.max(0, H - zero)} /></clipPath></defs>
            <path d={`${d} L${W},${zero} L0,${zero} Z`} fill="rgba(214,92,255,0.45)" clipPath={`url(#${clip})`} />
            <line x1="0" x2={W} y1={zero} y2={zero} stroke="rgba(255,255,255,0.35)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
            <line x1="0" x2={W} y1={y(theo)} y2={y(theo)} stroke="rgba(255,255,255,0.4)" strokeDasharray="4 3" strokeWidth="1" vectorEffect="non-scaling-stroke" />
            <path d={d} fill="none" stroke="rgba(255,255,255,0.85)" strokeWidth="1.6" vectorEffect="non-scaling-stroke" />
            {bets.map((b, k) => (ys[b.idx] == null ? null : (
                <circle key={k} cx={x(b.idx)} cy={y(ys[b.idx])} r={selectedSeat != null ? 3.4 : 2.6} fill={selectedSeat != null ? seatColor(b.seat) : '#fff'} />
            )))}
            {hoverIdx != null ? <line x1={x(hoverIdx)} x2={x(hoverIdx)} y1="0" y2={H} stroke={ACCENT} strokeWidth="1.5" vectorEffect="non-scaling-stroke" /> : null}
        </svg>
    );
}

function BigChart({ code, ys, handNos, seats, selectedSeat, onSelectSeat, onHover }) {
    const occupied = useMemo(() => seats.filter((s) => !s.empty), [seats]);
    const names = useMemo(() => occupied.map((s) => `S${s.seat} ${shortId(s.playerId)}`), [occupied]);
    const idxOf = useMemo(() => new Map(handNos.map((h, i) => [h, i])), [handNos]);
    const option = useMemo(() => {
        const o = OPT.get(code);
        const known = ys.filter((v) => v != null);
        const series = [{
            name: 'edge', type: 'line', data: ys.map((v, i) => [handNos[i], v]), showSymbol: false, smooth: 0.2,
            connectNulls: false, lineStyle: { color: '#fff', width: 2 }, z: 2,
            markLine: {
                silent: true, symbol: 'none',
                data: [
                    { yAxis: o.theo, lineStyle: { color: '#ddd', type: 'dashed' }, label: { formatter: `theo ${o.theo}%`, color: '#ccc', position: 'insideEndTop' } },
                    { yAxis: 0, lineStyle: { color: 'rgba(255,255,255,0.35)', type: 'solid' }, label: { show: false } },
                ],
            },
            markArea: { silent: true, itemStyle: { color: 'rgba(214,92,255,0.12)' }, data: [[{ yAxis: -100 }, { yAxis: 0 }]] },
        }];
        occupied.forEach((s, k) => {
            const c = seatColor(s.seat);
            const pts = s.bets.filter((b) => b.code === code && idxOf.has(b.handNo))
                .map((b) => [b.handNo, ys[idxOf.get(b.handNo)], b.wager, b.patronWin]);
            series.push({
                name: names[k], type: 'scatter', z: 4, data: pts,
                symbolSize: (v) => 7 + Math.sqrt(v[2]) / 6,
                itemStyle: { color: (p) => (p.value[3] > 0 ? c : '#0d0e18'), borderColor: c, borderWidth: 2 },
            });
        });
        const selected = Object.fromEntries(occupied.map((s, k) => [names[k], selectedSeat == null || s.seat === selectedSeat]));
        return {
            backgroundColor: 'transparent', animation: false,
            grid: { left: 48, right: 16, top: 38, bottom: 28 },
            legend: { data: names, selected, top: 0, right: 0, textStyle: { color: TEXT.secondary, fontSize: 11 }, itemWidth: 10, itemHeight: 10, inactiveColor: 'rgba(255,255,255,0.25)' },
            tooltip: {
                trigger: 'axis', backgroundColor: 'rgba(14,16,28,0.97)', borderColor: 'rgba(122,162,247,0.45)', textStyle: { color: '#fff', fontSize: 12 },
                formatter: (ps) => {
                    const hand = Math.round(ps[0].value[0]);
                    const i = idxOf.get(hand);
                    const lines = ps.filter((p) => p.seriesName !== 'edge')
                        .map((p) => `<br/><span style="color:${p.color && p.color !== '#0d0e18' ? p.color : '#bbb'}">●</span> ${p.seriesName}: ${plain(p.value[2])} bet · Patron Win ${money(p.value[3])}`);
                    return `<b>Hand #${hand}</b><br/>${code} edge ${fmtPct(i != null ? ys[i] : null)}${lines.join('')}`;
                },
            },
            xAxis: { type: 'value', min: handNos[0] || 1, max: handNos[handNos.length - 1] || 1, axisLabel: { color: TEXT.muted }, splitLine: { show: false } },
            yAxis: {
                type: 'value',
                min: Math.floor(Math.min(-1, ...known) - 1),
                max: Math.ceil(Math.max(o.theo * 1.15, ...known)),
                axisLabel: { color: TEXT.muted, formatter: '{value}%' },
                splitLine: { lineStyle: { color: 'rgba(255,255,255,0.06)' } },
            },
            series,
        };
    }, [code, ys, handNos, occupied, names, selectedSeat, idxOf]);

    const ref = useEChart(option, {
        legendselectchanged: (e) => {
            const s = occupied[names.indexOf(e.name)];
            if (s) onSelectSeat(selectedSeat === s.seat ? null : s.seat);
        },
        updateAxisPointer: (e) => {
            const info = e.axesInfo && e.axesInfo[0];
            if (!info) return;
            const i = idxOf.get(Math.round(info.value));
            if (i != null) onHover(i);
        },
        globalout: () => onHover(null),
    });
    return <Box ref={ref} sx={{ width: '100%', height: 320 }} role="img" aria-label={`${code} house edge by hand with each seat's bets`} />;
}

export default function EdgeByHand({ paths, handNos, seats, selectedSeat, onSelectSeat, hits, view, onView, option, onOption, hoverIdx, onHover, head }) {
    const hitMap = useMemo(() => new Map((hits || []).map((h) => [h.code, h])), [hits]);
    const ordered = useMemo(() => [...PATRON_360.BET_OPTIONS].sort((a, b) => {
        const ha = hitMap.get(a.code), hb = hitMap.get(b.code);
        if (!!ha !== !!hb) return ha ? -1 : 1;
        return ha ? ha.gap - hb.gap : 0;
    }), [hitMap]);
    const idxOf = useMemo(() => new Map(handNos.map((h, i) => [h, i])), [handNos]);
    const code = option || (hits && hits[0] ? hits[0].code : 'BANKER');
    const n = handNos.length;

    return (
        <Box>
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 1, mb: 1, minHeight: 30 }}>
                <Typography component="h3" sx={{ fontSize: 14, fontWeight: 800, color: TEXT.primary }}>House edge by hand</Typography>
                {head}
                <Box sx={{ flex: 1 }} />
                <ToggleButtonGroup exclusive size="small" value={view} onChange={(_, v) => v && onView(v)} aria-label="Edge view" sx={segSx}>
                    <ToggleButton value="all">All options</ToggleButton>
                    <ToggleButton value="one">One option</ToggleButton>
                </ToggleButtonGroup>
            </Stack>

            {view === 'all' ? (
                <>
                    <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0,1fr))' }, gap: 1 }}>
                        {ordered.map((o) => {
                            const ys = paths[o.code] || [];
                            const h = hitMap.get(o.code);
                            const bets = visibleBets(seats, selectedSeat, o.code, idxOf);
                            const quiet = selectedSeat != null && !bets.length;
                            const at = hoverIdx != null ? hoverIdx : n - 1;
                            const now = ys[at];
                            const open = () => { onOption(o.code); onView('one'); };
                            return (
                                <ButtonBase
                                    key={o.code}
                                    onClick={open}
                                    aria-label={`${o.code}: open large`}
                                    sx={{
                                        display: 'block', textAlign: 'left', px: 1, pt: 0.75, pb: 0.5, borderRadius: 1.5,
                                        bgcolor: 'rgba(255,255,255,0.03)',
                                        border: `1px solid ${h ? h.color : 'rgba(255,255,255,0.08)'}`,
                                        boxShadow: h ? `inset 0 0 0 1px ${h.color}` : 'none',
                                        opacity: quiet ? 0.42 : 1, transition: 'opacity 150ms',
                                        '&.Mui-focusVisible': { outline: `2px solid ${ACCENT}`, outlineOffset: 2 },
                                    }}
                                >
                                    <Stack direction="row" spacing={1} sx={{ alignItems: 'baseline' }}>
                                        <Typography component="span" sx={{ fontSize: 13, fontWeight: 800, color: o.color }}>{o.code}</Typography>
                                        <Typography component="span" sx={{ fontSize: 11, color: TEXT.faint }}>theo {o.theo}%</Typography>
                                        {selectedSeat != null ? (
                                            <Typography component="span" sx={{ fontSize: 11, fontWeight: 800, color: bets.length ? seatColor(selectedSeat) : TEXT.faint }}>
                                                {bets.length ? `${bets.length} bet${bets.length === 1 ? '' : 's'}` : 'no bets'}
                                            </Typography>
                                        ) : null}
                                        <Box sx={{ flex: 1 }} />
                                        <Typography component="span" sx={{ fontSize: 13, fontWeight: 800, fontVariantNumeric: 'tabular-nums', color: now != null && now < 0 ? MAGENTA_TEXT : TEXT.primary }}>
                                            {hoverIdx != null ? `#${handNos[hoverIdx]} ` : ''}{fmtPct(now)}
                                        </Typography>
                                    </Stack>
                                    <Sparkline code={o.code} ys={ys} bets={bets} selectedSeat={selectedSeat} hoverIdx={hoverIdx} onHover={onHover} />
                                </ButtonBase>
                            );
                        })}
                    </Box>
                    <Typography sx={{ mt: 0.75, fontSize: 12, color: TEXT.faint }}>
                        Magenta = edge below 0% · dashed = theo · dots = {selectedSeat != null ? "this player's" : "seated players'"} bets · click a chart to open it large
                    </Typography>
                </>
            ) : (
                <>
                    <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 0.75, mb: 1 }} role="group" aria-label="Bet option">
                        {ordered.map((o) => {
                            const on = o.code === code;
                            return (
                                <ButtonBase key={o.code} onClick={() => onOption(o.code)} aria-pressed={on}
                                    sx={{
                                        px: 1.25, py: 0.6, borderRadius: 1, fontSize: 12, fontWeight: 800, gap: 0.5,
                                        color: on ? '#0d0e18' : TEXT.secondary,
                                        bgcolor: on ? optColor(o.code) : 'rgba(255,255,255,0.03)',
                                        border: `1px solid ${on ? optColor(o.code) : 'rgba(255,255,255,0.16)'}`,
                                        '&.Mui-focusVisible': { outline: `2px solid ${ACCENT}`, outlineOffset: 2 },
                                    }}>
                                    {hitMap.has(o.code) ? '●' : ''}{o.code}
                                </ButtonBase>
                            );
                        })}
                    </Stack>
                    <BigChart code={code} ys={paths[code] || []} handNos={handNos} seats={seats}
                        selectedSeat={selectedSeat} onSelectSeat={onSelectSeat} onHover={onHover} />
                    <Typography sx={{ fontSize: 12, color: TEXT.faint }}>
                        Click a player in the legend, or a seat on the table, to show only their bets · filled = Patron Win · hollow = patron lost · size = bet
                    </Typography>
                </>
            )}
        </Box>
    );
}
