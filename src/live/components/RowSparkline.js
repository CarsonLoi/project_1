// Compact SVG sparkline — no axes, no chrome, just the shape.
// Sized to fit inside a table cell (default 72×22). Diverging color:
// the line takes the sign of the last value (casino perspective).
//   • ends at 0  → slate       (patron stopped)
//   • ends >0   → cyan/green  (casino winning)
//   • ends <0   → soft red    (patron winning)
// Includes a subtle zero-baseline so runs above/below zero read at a
// glance. Rendered as inline SVG so it's crisp on any DPR.

import React, { useMemo } from 'react';

const DEFAULT_W = 72;
const DEFAULT_H = 22;

export default function RowSparkline({ points, width = DEFAULT_W, height = DEFAULT_H, sign = null, ariaLabel }) {
    const path = useMemo(() => {
        if (!points || points.length < 2) return null;
        const min = Math.min(0, ...points);
        const max = Math.max(0, ...points);
        const range = max - min || 1;
        // Map [min..max] into pixel Y with a 2px inset top/bottom.
        const y = (v) => height - 2 - ((v - min) / range) * (height - 4);
        const x = (i) => (i / (points.length - 1)) * (width - 2) + 1;
        const zeroY = y(0);
        const line = points.map((v, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(' ');
        // Area path — fills from the line down to the zero baseline so
        // above-zero runs read as green fills, below-zero as red fills.
        const area = `M ${x(0).toFixed(1)} ${zeroY.toFixed(1)} ` +
            points.map((v, i) => `L ${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(' ') +
            ` L ${x(points.length - 1).toFixed(1)} ${zeroY.toFixed(1)} Z`;
        return { line, area, zeroY };
    }, [points, width, height]);
    const stroke = sign > 0 ? '#7dc267' : sign < 0 ? '#e88090' : 'rgba(255,255,255,0.55)';
    const fill = sign > 0 ? 'rgba(125,194,103,0.18)' : sign < 0 ? 'rgba(232,128,144,0.18)' : 'rgba(255,255,255,0.06)';
    if (!path) {
        return <svg width={width} height={height} aria-hidden="true" />;
    }
    return (
        <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}
             role="img" aria-label={ariaLabel || 'trend sparkline'}
             style={{ display: 'block' }}>
            {/* Zero baseline — dashed, low-contrast so it doesn't compete. */}
            <line x1="1" x2={width - 1} y1={path.zeroY} y2={path.zeroY}
                  stroke="rgba(255,255,255,0.14)" strokeWidth="1" strokeDasharray="2 2" />
            <path d={path.area} fill={fill} />
            <path d={path.line} fill="none" stroke={stroke} strokeWidth="1.4" strokeLinejoin="round" strokeLinecap="round" />
        </svg>
    );
}
