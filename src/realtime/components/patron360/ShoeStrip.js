// One shoe as a strip of hands, coloured by the option's live edge band.
// Hands outside his seated window are dimmed; a white mark = he bet the
// option. Hover outlines a hand and shows its detail; click opens it.

import React, { useMemo, useState } from 'react';
import { Box, Stack, Tooltip, Typography } from '@mui/material';
import { TEXT, ACCENT } from '../../constants/rtTheme';
import { inWindow, OPTION_BY_CODE } from '../../utils/patron360';
import { edgeBands, money, plain, pct, signColor } from './format';

const W = 6;
const RESULT = { B: { t: 'Banker', c: '#e5484d' }, P: { t: 'Player', c: '#3e63dd' }, T: { t: 'Tie', c: '#30a46c' } };
const inBand = (b, e) => (b.gte == null || e >= b.gte) && (b.lt == null || e < b.lt);

function Row({ label, children }) {
    return (
        <Stack direction="row" sx={{ justifyContent: 'space-between', gap: 2 }}>
            <Typography component="span" sx={{ fontSize: 12, color: TEXT.muted }}>{label}</Typography>
            <Typography component="span" sx={{ fontSize: 12, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{children}</Typography>
        </Stack>
    );
}

export default function ShoeStrip({ view, code, onPickHand }) {
    const theo = (OPTION_BY_CODE.get(code) || { theo: 1 }).theo;
    const bands = useMemo(() => edgeBands(theo), [theo]);
    const [hover, setHover] = useState(null);
    const hands = view.hands;
    const n = hands.length;

    const cells = useMemo(() => hands.map((h, i) => {
        const e = h.edge[code];
        const b = e == null ? null : bands.find((x) => inBand(x, e));
        const m = view.betsByHand.get(h.handNo);
        return {
            i, h, e, seated: inWindow(view, h.handNo),
            color: b ? b.color : 'rgba(255,255,255,0.08)',
            bet: m ? m.get(code) || null : null,
        };
    }), [hands, view, code, bands]);

    const at = (clientX, el) => {
        const r = el.getBoundingClientRect();
        return Math.max(0, Math.min(n - 1, Math.floor(((clientX - r.left) / r.width) * n)));
    };
    const cur = hover == null ? null : cells[hover];

    const tip = cur ? (
        <Box sx={{ minWidth: 190 }}>
            <Stack direction="row" sx={{ justifyContent: 'space-between', mb: 0.5 }}>
                <Typography component="span" sx={{ fontSize: 13, fontWeight: 800 }}>Hand #{cur.h.handNo}</Typography>
                <Typography component="span" sx={{ fontSize: 12, color: cur.seated ? '#6ad08f' : TEXT.faint }}>{cur.seated ? 'seated' : 'not seated'}</Typography>
            </Stack>
            <Row label={`${code} edge`}><Box component="span" sx={{ color: cur.e != null && cur.e < 0 ? 'rgb(235,150,255)' : 'inherit' }}>{pct(cur.e, 2)}</Box></Row>
            <Row label="Theo">{pct(theo, 2)}</Row>
            <Row label="Result"><Box component="span" sx={{ color: (RESULT[cur.h.result] || {}).c }}>{(RESULT[cur.h.result] || { t: '—' }).t}</Box></Row>
            <Row label={`His ${code} bet`}>{cur.bet ? plain(cur.bet.wager) : cur.seated ? 'no bet' : '—'}</Row>
            {cur.bet ? <Row label="Patron Win"><Box component="span" sx={{ color: signColor(-cur.bet.casinoWin) }}>{money(-cur.bet.casinoWin)}</Box></Row> : null}
            <Typography sx={{ mt: 0.5, fontSize: 11, color: ACCENT }}>Click to open this hand</Typography>
        </Box>
    ) : '';

    return (
        <Tooltip
            title={tip}
            open={!!cur}
            followCursor
            placement="bottom-start"
            disableInteractive
            slotProps={{ tooltip: { sx: { bgcolor: 'rgba(14,16,28,0.97)', border: '1px solid rgba(122,162,247,0.45)', color: TEXT.primary, p: 1.25, maxWidth: 'none' } } }}
        >
            <Box
                component="svg"
                viewBox={`0 0 ${n * W} 16`}
                preserveAspectRatio="none"
                data-stop
                role="img"
                aria-label={`${code} edge by hand for this shoe; hover for details, click a hand to open it`}
                onMouseMove={(e) => setHover(at(e.clientX, e.currentTarget))}
                onMouseLeave={() => setHover(null)}
                onClick={(e) => { e.stopPropagation(); onPickHand(cells[at(e.clientX, e.currentTarget)].h.handNo); }}
                sx={{ width: '100%', height: 16, display: 'block', borderRadius: 0.5, cursor: 'crosshair' }}
            >
                {cells.map((c) => (
                    <g key={c.i}>
                        <rect x={c.i * W} y={0} width={W} height={16} fill={c.color} opacity={c.seated ? 1 : 0.22} />
                        {c.bet ? <rect x={c.i * W + 1} y={11} width={W - 2} height={5} fill="#fff" /> : null}
                    </g>
                ))}
                {cur ? <rect x={cur.i * W} y={0.5} width={W} height={15} fill="none" stroke="#fff" strokeWidth={2} vectorEffect="non-scaling-stroke" /> : null}
            </Box>
        </Tooltip>
    );
}
