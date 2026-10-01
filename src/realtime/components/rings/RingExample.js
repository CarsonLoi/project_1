// A miniature table wearing an edge ring — used in the (i) popover and
// the settings dialog so the two modes can be compared at a glance.

import React from 'react';
import { PATRON_360 } from '../../constants/rtConfig';

const COLOR = Object.fromEntries(PATRON_360.BET_OPTIONS.map((o) => [o.code, o.color]));
// Three options with clearly different colours, so the arcs read apart.
const SAMPLE = [{ code: 'SL7', edge: -6.2 }, { code: 'PPL', edge: -3.1 }, { code: 'SD', edge: -1.4 }];

export function arcPath(cx, cy, r, a0, a1) {
    const p = (a) => [cx + r * Math.cos(a), cy + r * Math.sin(a)];
    const [x0, y0] = p(a0);
    const [x1, y1] = p(a1);
    return `M${x0.toFixed(1)},${y0.toFixed(1)} A${r},${r} 0 ${a1 - a0 > Math.PI ? 1 : 0} 1 ${x1.toFixed(1)},${y1.toFixed(1)}`;
}

// `hits`: [{ code, color }] worst first.
export function RingShapes({ cx, cy, r, hits, mode, width = 3.5 }) {
    if (!hits.length) return null;
    if (mode === 'worst' || hits.length === 1) {
        return <circle cx={cx} cy={cy} r={r} fill="none" stroke={hits[0].color} strokeWidth={width} />;
    }
    const gap = 0.26;
    const span = (Math.PI * 2) / hits.length;
    return hits.map((h, i) => {
        const a0 = -Math.PI / 2 + i * span + gap / 2;
        return <path key={h.code} d={arcPath(cx, cy, r, a0, a0 + span - gap)} fill="none" stroke={h.color} strokeWidth={width} strokeLinecap="round" />;
    });
}

export default function RingExample({ mode = 'segments', width = 120, height = 60, colors = COLOR }) {
    const hits = SAMPLE.map((h) => ({ ...h, color: colors[h.code] || COLOR[h.code] }));
    const cx = width / 2;
    const cy = height / 2 + 7;
    return (
        <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true" style={{ display: 'block', flexShrink: 0 }}>
            <RingShapes cx={cx} cy={cy} r={19} hits={hits} mode={mode} />
            <rect x={cx - 16} y={cy - 8} width={32} height={16} rx={4} fill="rgba(156,204,101,1)" stroke="#0d0e18" />
            <text x={cx} y={10} textAnchor="middle" fill={hits[0].color} fontSize={10} fontWeight={800}
                fontFamily="ui-monospace, Consolas, monospace" stroke="#0d0e18" strokeWidth={3} paintOrder="stroke">
                SL7 −6.2% +2
            </text>
        </svg>
    );
}
