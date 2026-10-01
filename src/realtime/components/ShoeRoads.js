// Casino roads for one shoe — Big Road, the three derived roads and the
// bead plate — drawn with Trend Seeker's renderer so they look exactly
// like the boards floor staff already read. Shared by the shoe board and
// the Player 360. Optional highlight sets ring the hands a patron bet:
// `markedHands` in amber, `emphasisHands` in `emphasisColor` (wins when a
// hand is in both); the selected hand gets the accent ring. The roads sit
// on a LIGHT board, so the rings are dark enough to read on it.

import React, { useMemo } from 'react';
import { Box, ButtonBase, Stack, Typography } from '@mui/material';
import {
    buildBigRoad, buildDerivedRoad, BigRoadCell, DerivedDotCell, CockroachCell,
    BeadPlateCell, RoadGrid, chunkBeadPlate,
} from '../../trend/components/BaccaratBoard';
import { TEXT, ACCENT } from '../constants/rtTheme';

export const MARK_COLOR = '#e69500';
export const EMPHASIS_COLOR = '#111111';
const NONE = new Set();
const RESULT_LABEL = { B: 'Banker', P: 'Player', T: 'Tie' };

function RoadBlock({ label, children }) {
    return (
        <Box sx={{ minWidth: 0 }}>
            <Typography sx={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.4, color: TEXT.muted, mb: 0.4 }}>{label}</Typography>
            <Box sx={{ borderRadius: 1, overflow: 'hidden', border: '1px solid rgba(255,255,255,0.12)' }}>{children}</Box>
        </Box>
    );
}

export default function ShoeRoads({
    hands, selectedHandNo = null, onSelectHand = null,
    markedHands = NONE, emphasisHands = NONE, emphasisColor = EMPHASIS_COLOR,
    beadLabel = 'Bead plate · 珠盤路', full = true,
}) {
    const bigRoad = useMemo(() => buildBigRoad(hands, 6), [hands]);
    const bigEye = useMemo(() => buildDerivedRoad(hands, 1, 6), [hands]);
    const small = useMemo(() => buildDerivedRoad(hands, 2, 6), [hands]);
    const cockroach = useMemo(() => buildDerivedRoad(hands, 3, 6), [hands]);
    const bead = useMemo(() => chunkBeadPlate(hands, 6), [hands]);

    const ringFor = (nos) => {
        if (nos.some((n) => emphasisHands.has(n))) return emphasisColor;
        if (nos.some((n) => markedHands.has(n))) return MARK_COLOR;
        return null;
    };

    return (
        <Stack spacing={1.1}>
            <RoadBlock label="Big Road · 大路">
                <RoadGrid cols={bigRoad} rows={6} cellSize={24} minCols={Math.max(24, bigRoad.length + 2)}
                    render={(c, s) => {
                        const sel = c && c.handNos && selectedHandNo != null && c.handNos.includes(selectedHandNo);
                        const ring = sel ? ACCENT : c && c.handNos ? ringFor(c.handNos) : null;
                        return ring ? (
                            <Box sx={{ width: s, height: s, borderRadius: '50%', outline: `2.5px solid ${ring}`, outlineOffset: -1 }}>
                                <BigRoadCell cell={c} size={s} />
                            </Box>
                        ) : <BigRoadCell cell={c} size={s} />;
                    }} />
            </RoadBlock>
            {full ? (<>
            <RoadBlock label="Big Eye · 大眼仔">
                <RoadGrid cols={bigEye} rows={6} cellSize={12} minCols={48}
                    render={(m, s) => <DerivedDotCell mark={m} size={s} filled={false} />} />
            </RoadBlock>
            {/* minmax(0, 1fr): let the two roads shrink and scroll inside
                their own blocks instead of widening the page. */}
            <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 1 }}>
                <RoadBlock label="Small Road · 小路">
                    <RoadGrid cols={small} rows={6} cellSize={12} minCols={24}
                        render={(m, s) => <DerivedDotCell mark={m} size={s} filled />} />
                </RoadBlock>
                <RoadBlock label="Cockroach · 曱甴路">
                    <RoadGrid cols={cockroach} rows={6} cellSize={12} minCols={24}
                        render={(m, s) => <CockroachCell mark={m} size={s} />} />
                </RoadBlock>
            </Box>
            </>) : null}
            <RoadBlock label={beadLabel}>
                <RoadGrid cols={bead} rows={6} cellSize={28} minCols={Math.max(12, bead.length)} fillWidth={false}
                    render={(h, s) => {
                        if (!h) return <BeadPlateCell hand={null} size={s} />;
                        const selected = h.handNo === selectedHandNo;
                        const ring = selected ? ACCENT : ringFor([h.handNo]);
                        const label = `Hand ${h.handNo}, ${RESULT_LABEL[h.result] || 'unknown'}`;
                        const sx = {
                            width: s, height: s, borderRadius: '50%', display: 'block',
                            outline: ring ? `${selected ? 3 : 2}px solid ${ring}` : 'none', outlineOffset: -1,
                        };
                        return onSelectHand ? (
                            <ButtonBase onClick={() => onSelectHand(h.handNo)} aria-label={label} sx={sx}>
                                <BeadPlateCell hand={h} size={s} />
                            </ButtonBase>
                        ) : (
                            <Box title={label} sx={sx}><BeadPlateCell hand={h} size={s} /></Box>
                        );
                    }} />
            </RoadBlock>
        </Stack>
    );
}
