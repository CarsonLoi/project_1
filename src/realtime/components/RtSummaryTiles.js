// Floor summary tiles.
// ====================
// The top-line read: what is the whole floor doing right now. Sized for
// legibility at distance, since this dashboard is expected to live on a
// wall as well as a desk.
//
// Every money tile names its perspective — this row is all Casino Win
// (casino perspective; negative = the casino is losing).
//
// Win − Theo is the tile that matters most and is the only one that
// changes colour — it is the metric that says whether the floor is
// behaving, and a green/red flip is readable from across a room in a
// way that a number is not. The rest stay neutral so they don't compete.

import React, { useMemo } from 'react';
import { Box, Typography, Stack } from '@mui/material';
import { TEXT, STATE, TYPE, systemLabel } from '../constants/rtTheme';

const money = (v) => {
    if (v == null || !Number.isFinite(v)) return '—';
    const a = Math.abs(v);
    const s = v < 0 ? '-' : '';
    if (a >= 1e6) return `${s}$${(a / 1e6).toFixed(2)}M`;
    if (a >= 1e3) return `${s}$${(a / 1e3).toFixed(0)}K`;
    return `${s}$${a.toFixed(0)}`;
};

// `emphasis` marks the ONE tile this row wants the eye to land on
// first (Variance). It gets the raised-surface treatment; everything
// else stays flat so it doesn't compete — was previously every tile
// at identical weight, with only text colour telling them apart.
function Tile({ label, value, sub, color = TEXT.primary, emphasis = false }) {
    return (
        <Box sx={{
            px: 1.25, py: 0.6, flexShrink: 0,
            borderRadius: 1.5,
            bgcolor: emphasis ? 'rgba(122,162,247,0.08)' : 'rgba(255,255,255,0.035)',
            border: `1px solid ${emphasis ? 'rgba(122,162,247,0.28)' : 'rgba(255,255,255,0.06)'}`,
            minWidth: 0,
        }}>
            <Typography sx={{ ...systemLabel, whiteSpace: 'nowrap', lineHeight: 1.3 }}>
                {label}
            </Typography>
            <Typography sx={{
                fontSize: 18, fontWeight: 800, color, lineHeight: 1.25,
                fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap',
            }}>
                {value}
            </Typography>
            {sub != null && (
                <Typography sx={{
                    fontSize: TYPE.caption, color: TEXT.faint, lineHeight: 1.2,
                    fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap',
                }}>
                    {sub}
                </Typography>
            )}
        </Box>
    );
}

export default function RtSummaryTiles({ tables = [], patrons = [] }) {
    const s = useMemo(() => {
        let win = 0, theo = 0, turnover = 0, open = 0, seated = 0;
        for (const t of tables) {
            win += Number(t.win) || 0;
            theo += Number(t.theo) || 0;
            turnover += Number(t.turnover) || 0;
            const isOpen = t.is_open != null ? !!t.is_open : (Number(t.openday) || 0) > 0;
            if (isOpen) open += 1;
            seated += Number(t.avg_headcount_10m) || 0;
        }
        return {
            win, theo, turnover, open, seated,
            variance: win - theo,
            hold: turnover > 0 ? (win / turnover) * 100 : null,
            total: tables.length,
            patrons: patrons.length,
        };
    }, [tables, patrons]);

    // Neutral band around zero — a floor is never exactly flat, and
    // colouring a trivial variance red would cry wolf.
    const vColor = s.variance < -50000 ? STATE.negative
        : s.variance > 50000 ? STATE.positive
        : TEXT.primary;

    return (
        <Stack direction="row" spacing={0.75} sx={{ flexWrap: 'wrap', rowGap: 0.75 }}>
            <Tile label="Casino Win" value={money(s.win)} color={s.win < 0 ? STATE.negative : TEXT.primary} />
            <Tile label="Casino Theo" value={money(s.theo)} />
            <Tile
                label="Casino Win − Theo"
                value={money(s.variance)}
                color={vColor}
                sub={s.hold != null ? `hold ${s.hold.toFixed(1)}%` : null}
                emphasis
            />
            <Tile label="Turnover" value={money(s.turnover)} />
            <Tile label="Tables" value={`${s.open} / ${s.total}`} sub="open" />
            <Tile label="Patrons" value={s.patrons.toLocaleString()} sub={`${s.seated.toFixed(0)} seated`} />
        </Stack>
    );
}
