// Top-down baccarat table, reversed for the camera view surveillance
// knows: dealer, chip tray and shoe on the straight edge at the top, felt
// in the middle, seven seats round the curve at the bottom. Each betting
// spot shows the chips of the hand being viewed; a chip with a white
// dashed edge was placed while that option's edge was negative.

import React from 'react';
import { money } from '../patron360/format';
import { seatColor, tierColor, optColor, VERDICT, shortId } from './focusShared';

const W = 560;
const H = 372;
const CX = W / 2;
const TOP = 60;
const RX = 230;
const RY = 205;
const TRAY = ['#e5484d', '#3e63dd', '#30a46c', '#e3b341', '#111', '#b18cff', '#e5484d', '#3e63dd'];

function ellipse(rx, ry) {
    const pts = [];
    for (let a = 180; a >= 0; a -= 2) {
        pts.push(`${(CX + rx * Math.cos((a * Math.PI) / 180)).toFixed(1)},${(TOP + ry * Math.sin((a * Math.PI) / 180)).toFixed(1)}`);
    }
    return pts.join(' ');
}
const angle = (i) => ((160 - i * (140 / 6)) * Math.PI) / 180;
const pos = (i, rx, ry) => [CX + rx * Math.cos(angle(i)), TOP + ry * Math.sin(angle(i))];

function Spot({ seat, x, y, chips, edgesAt, dim }) {
    const color = seatColor(seat.seat);
    return (
        <g opacity={dim ? 0.38 : 1}>
            <rect x={x - 26} y={y - 15} width={52} height={30} rx={9} fill="rgba(0,0,0,0.18)"
                stroke={seat.empty ? 'rgba(255,255,255,0.18)' : color} strokeOpacity={seat.empty ? 1 : 0.7}
                strokeDasharray={seat.empty ? '4 3' : undefined} />
            {!chips.length ? (
                <text x={x} y={y + 4} textAnchor="middle" fill="rgba(255,255,255,0.28)" fontSize={10} fontWeight={700}>{seat.seat}</text>
            ) : chips.map((b, k) => {
                const step = Math.min(18, 40 / Math.max(1, chips.length - 1));
                const cx = x + (k - (chips.length - 1) / 2) * (chips.length > 1 ? step : 0);
                const e = edgesAt ? edgesAt[b.code] : null;
                const neg = e != null && e < 0;
                return (
                    <g key={`${b.code}-${k}`}>
                        <circle cx={cx} cy={y} r={8.5} fill={optColor(b.code)} stroke={neg ? '#fff' : 'rgba(0,0,0,0.55)'}
                            strokeWidth={neg ? 2.2 : 1} strokeDasharray="3 2" />
                        <text x={cx} y={y + 3} textAnchor="middle" fill="#0d0e18" fontSize={7} fontWeight={900}>{b.code.slice(0, 3)}</text>
                    </g>
                );
            })}
        </g>
    );
}

function Seat({ seat, x, y, bx, by, selected, dim, onSeat }) {
    if (seat.empty) {
        return (
            <g>
                <circle cx={x} cy={y} r={22} fill="#141724" stroke="rgba(255,255,255,0.25)" strokeDasharray="4 4" />
                <text x={x} y={y + 4} textAnchor="middle" fill="rgba(255,255,255,0.45)" fontSize={11} fontWeight={700}>S{seat.seat}</text>
            </g>
        );
    }
    const color = seatColor(seat.seat);
    const v = VERDICT[seat.verdict];
    const flag = seat.verdict === 'ACTION' || seat.verdict === 'WATCH';
    const act = () => onSeat(seat.seat);
    return (
        <g
            role="button" tabIndex={0} aria-pressed={selected}
            aria-label={`Seat ${seat.seat}, ${seat.playerId}${flag ? `, ${seat.verdict} this shoe` : ''}. Patron Win this shoe ${money(seat.shoeWin)}. Show only this player's bets`}
            onClick={act}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); act(); } }}
            style={{ cursor: 'pointer', outline: 'none' }}
            opacity={dim ? 0.38 : 1}
            className="rt-seat"
        >
            {selected ? <line x1={x} y1={y} x2={bx} y2={by} stroke={color} strokeWidth={2} strokeDasharray="3 3" /> : null}
            <g filter={selected ? 'url(#rt-seat-glow)' : undefined}>
                <circle className="rt-seat-ring" cx={x} cy={y} r={27} fill="#161a2b" stroke={color} strokeWidth={selected ? 4 : 3} />
                <circle cx={x} cy={y} r={21} fill="none" stroke={tierColor(seat.cardType)} strokeWidth={1.5} strokeDasharray="2 2" opacity={0.8} />
                <text x={x} y={y - 7} textAnchor="middle" fill={color} fontSize={9} fontWeight={900}>S{seat.seat}</text>
                <text x={x} y={y + 6} textAnchor="middle" fill="#fff" fontSize={12} fontWeight={800}>{shortId(seat.playerId)}</text>
                <text x={x} y={y + 17} textAnchor="middle" fill={seat.shoeWin < 0 ? '#f7768e' : seat.shoeWin > 0 ? '#6ad08f' : 'rgba(255,255,255,0.6)'} fontSize={9} fontWeight={800}>
                    {money(seat.shoeWin)}
                </text>
            </g>
            {flag ? (
                <g>
                    <rect x={x - 31} y={y + 30} width={62} height={16} rx={8} fill="#0d0e18" stroke={v.color} />
                    <text x={x} y={y + 41} textAnchor="middle" fill={v.color} fontSize={9} fontWeight={900} letterSpacing={0.5}>{v.text}</text>
                </g>
            ) : null}
        </g>
    );
}

export default function TableTop({ tableKey, dealer, shownHandNo, handCount, seats, selectedSeat, onSeat, edgesAt }) {
    return (
        <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="group" style={{ display: 'block', height: 'auto' }}
            aria-label={`Table ${tableKey}, dealer at the top, seats along the bottom`}>
            <defs>
                <radialGradient id="rt-felt" cx="50%" cy="10%" r="90%">
                    <stop offset="0" stopColor="#17614f" />
                    <stop offset="1" stopColor="#0b3a31" />
                </radialGradient>
                <filter id="rt-seat-glow" x="-50%" y="-50%" width="200%" height="200%">
                    <feGaussianBlur stdDeviation="4" result="b" />
                    <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
                </filter>
            </defs>
            <style>{`
                .rt-seat .rt-seat-ring { transition: stroke-width 150ms ease-out; }
                .rt-seat:hover .rt-seat-ring { stroke-width: 4.5; }
                .rt-seat:focus-visible .rt-seat-ring { stroke: #fff; }
                @media (prefers-reduced-motion: reduce) { .rt-seat .rt-seat-ring { transition: none; } }
            `}</style>
            <polygon points={ellipse(RX + 14, RY + 14)} fill="#26222c" stroke="#3a3442" strokeWidth={2} />
            <polygon points={ellipse(RX, RY)} fill="url(#rt-felt)" stroke="rgba(255,255,255,0.18)" strokeWidth={1.5} />
            <text x={CX} y={TOP + 66} textAnchor="middle" fill="rgba(255,255,255,0.13)" fontSize={18} fontWeight={800} letterSpacing={7}>BACCARAT</text>
            <text x={CX} y={TOP + 82} textAnchor="middle" fill="rgba(255,255,255,0.13)" fontSize={8} letterSpacing={2}>BANKER PAYS 0.95 · TIE PAYS 8 TO 1</text>

            {/* Dealer, chip tray and shoe on the straight edge. */}
            <rect x={CX - 78} y={TOP + 6} width={156} height={22} rx={4} fill="#12151f" stroke="rgba(255,255,255,0.25)" />
            {TRAY.map((c, k) => <rect key={k} x={CX - 72 + k * 18.5} y={TOP + 10} width={14} height={14} rx={3} fill={c} stroke="rgba(255,255,255,0.35)" />)}
            <rect x={CX + 118} y={TOP + 6} width={50} height={30} rx={5} fill="#12151f" stroke="rgba(255,255,255,0.3)" />
            <text x={CX + 143} y={TOP + 19} textAnchor="middle" fill="rgba(255,255,255,0.55)" fontSize={8} fontWeight={800} letterSpacing={1}>HAND</text>
            <text x={CX + 143} y={TOP + 31} textAnchor="middle" fill="#fff" fontSize={10} fontWeight={800}>
                {shownHandNo != null ? `#${shownHandNo}` : '—'}{handCount && shownHandNo !== handCount ? `/${handCount}` : ''}
            </text>
            <rect x={CX - 74} y={TOP - 42} width={148} height={26} rx={13} fill="#1b2034" stroke="rgba(255,255,255,0.28)" />
            <text x={CX} y={TOP - 25} textAnchor="middle" fill="rgba(255,255,255,0.85)" fontSize={11} fontWeight={800} letterSpacing={2}>
                DEALER · {String(dealer || '—').toUpperCase()}
            </text>
            <line x1={CX - RX - 14} y1={TOP} x2={CX + RX + 14} y2={TOP} stroke="#3a3442" strokeWidth={3} />

            {seats.map((s, i) => {
                const [bx, by] = pos(i, RX * 0.78, RY * 0.78);
                const chips = s.empty ? [] : s.bets.filter((b) => b.handNo === shownHandNo);
                const dim = selectedSeat != null && selectedSeat !== s.seat;
                return <Spot key={`spot-${s.seat}`} seat={s} x={bx} y={by} chips={chips} edgesAt={edgesAt} dim={dim} />;
            })}
            {seats.map((s, i) => {
                const [bx, by] = pos(i, RX * 0.78, RY * 0.78);
                const [ax, ay] = pos(i, RX + 38, RY + 38);
                const dim = selectedSeat != null && selectedSeat !== s.seat;
                return <Seat key={`seat-${s.seat}`} seat={s} x={ax} y={ay} bx={bx} by={by} selected={selectedSeat === s.seat} dim={dim} onSeat={onSeat} />;
            })}
        </svg>
    );
}
