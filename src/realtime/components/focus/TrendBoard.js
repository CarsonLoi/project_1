// Trend board for the focused shoe: bead plate and Big Road, same cell
// size and height. Hands the selected player bet are ringed; the hovered
// hand (from any edge chart) gets a cursor box on both roads. Clicking a
// hand shows its chips on the table.

import React, { useMemo } from 'react';
import { Box, Typography } from '@mui/material';
import { systemLabel } from '../../constants/rtTheme';
import { RESULT_COLOR, RESULT_ZH } from './focusShared';

const C = 22;
const ROWS = 6;
const roadSx = {
    height: ROWS * C + 4 + 16, overflowX: 'auto', overflowY: 'hidden', borderRadius: 1.5, bgcolor: '#eef2fb', p: 0.5,
    scrollbarWidth: 'thin',
};

function bigRoadCells(hands) {
    const grid = new Set();
    const cells = [];
    let col = -1, row = 0, last = null, lastCell = null, maxCol0 = -1;
    hands.forEach((h, i) => {
        const r = h.result;
        if (r === 'T') { if (lastCell) lastCell.idx.push(i); return; }
        if (r !== 'B' && r !== 'P') return;
        if (r !== last) { col = maxCol0 + 1; row = 0; maxCol0 = col; }
        else if (row < ROWS - 1 && !grid.has(`${col},${row + 1}`)) row += 1;
        else col += 1;
        const cell = { col, row, r, idx: [i] };
        grid.add(`${col},${row}`);
        cells.push(cell);
        last = r;
        lastCell = cell;
    });
    return cells;
}

export default function TrendBoard({ hands, marked, hoverIdx, onPickHand }) {
    const beadCols = Math.max(1, Math.ceil(hands.length / ROWS));
    const cells = useMemo(() => bigRoadCells(hands), [hands]);
    const roadCols = Math.max(24, (cells.length ? Math.max(...cells.map((c) => c.col)) : 0) + 2);
    const dimOthers = marked && marked.size > 0;
    const hoverCell = hoverIdx == null ? null : cells.find((c) => c.idx.includes(hoverIdx));
    // Near-black reads on the light road; seat colours would not.
    const ring = '#111';
    const pick = (i) => onPickHand && onPickHand(i);

    return (
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: 'minmax(0,1fr) minmax(0,1.4fr)' }, gap: 1.5 }}>
            <Box sx={{ minWidth: 0 }}>
                <Typography sx={{ ...systemLabel, mb: 0.5 }}>Bead plate · 珠盤路</Typography>
                <Box sx={roadSx}>
                    <svg width={beadCols * C + 4} height={ROWS * C + 4} role="img" aria-label="Bead plate" style={{ display: 'block' }}>
                        {hands.map((h, i) => {
                            const x = 2 + Math.floor(i / ROWS) * C + C / 2;
                            const y = 2 + (i % ROWS) * C + C / 2;
                            const mine = marked && marked.has(h.handNo);
                            return (
                                <g key={h.handNo} opacity={dimOthers && !mine ? 0.35 : 1} onClick={() => pick(i)} style={{ cursor: onPickHand ? 'pointer' : 'default' }}>
                                    <title>{`Hand #${h.handNo}`}</title>
                                    <circle cx={x} cy={y} r={8.8} fill={RESULT_COLOR[h.result] || '#999'} />
                                    {mine ? <circle cx={x} cy={y} r={10.4} fill="none" stroke={ring} strokeWidth={2.4} /> : null}
                                    <text x={x} y={y + 4} textAnchor="middle" fill="#fff" fontSize={10} fontWeight={700}>{RESULT_ZH[h.result] || ''}</text>
                                </g>
                            );
                        })}
                        {hoverIdx != null ? (
                            <rect x={2 + Math.floor(hoverIdx / ROWS) * C} y={2 + (hoverIdx % ROWS) * C} width={C} height={C} rx={5}
                                fill="none" stroke={ring} strokeWidth={3} pointerEvents="none" />
                        ) : null}
                    </svg>
                </Box>
            </Box>
            <Box sx={{ minWidth: 0 }}>
                <Typography sx={{ ...systemLabel, mb: 0.5 }}>Big Road · 大路</Typography>
                <Box sx={roadSx}>
                    <svg width={roadCols * C + 4} height={ROWS * C + 4} role="img" aria-label="Big Road" style={{ display: 'block' }}>
                        {Array.from({ length: roadCols + 1 }, (_, i) => (
                            <line key={`v${i}`} x1={2 + i * C} x2={2 + i * C} y1={2} y2={2 + ROWS * C} stroke="rgba(0,0,0,0.08)" />
                        ))}
                        {Array.from({ length: ROWS + 1 }, (_, j) => (
                            <line key={`h${j}`} x1={2} x2={2 + roadCols * C} y1={2 + j * C} y2={2 + j * C} stroke="rgba(0,0,0,0.08)" />
                        ))}
                        {cells.map((c) => {
                            const cx = 2 + c.col * C + C / 2;
                            const cy = 2 + c.row * C + C / 2;
                            const mine = marked && c.idx.some((i) => marked.has(hands[i].handNo));
                            const ties = c.idx.length - 1;
                            return (
                                <g key={`${c.col},${c.row}`} opacity={dimOthers && !mine ? 0.35 : 1} onClick={() => pick(c.idx[0])} style={{ cursor: onPickHand ? 'pointer' : 'default' }}>
                                    <title>{`Hand${c.idx.length > 1 ? 's' : ''} #${c.idx.map((i) => hands[i].handNo).join(', #')}`}</title>
                                    <circle cx={cx} cy={cy} r={7.5} fill="none" stroke={RESULT_COLOR[c.r]} strokeWidth={2.6} />
                                    {mine ? <circle cx={cx} cy={cy} r={10} fill="none" stroke={ring} strokeWidth={2} /> : null}
                                    {ties ? <line x1={cx - 6} y1={cy + 6} x2={cx + 6} y2={cy - 6} stroke={RESULT_COLOR.T} strokeWidth={2} /> : null}
                                </g>
                            );
                        })}
                        {hoverCell ? (
                            <rect x={2 + hoverCell.col * C} y={2 + hoverCell.row * C} width={C} height={C} rx={5}
                                fill="none" stroke={ring} strokeWidth={3} pointerEvents="none" />
                        ) : null}
                    </svg>
                </Box>
            </Box>
        </Box>
    );
}
