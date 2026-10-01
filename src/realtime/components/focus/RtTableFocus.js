// Table focus — everything about the selected table's current shoe.
// ==================================================================
// Header facts (Casino Win), the table seen from above with its seats,
// the seat card, the house edge by hand and the trend board. Selecting a
// seat filters all of them to that player; hovering an edge chart moves
// a hand cursor across the charts and the roads.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Box, Button, ButtonBase, CircularProgress, MenuItem, Select, Stack, Typography } from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import { TEXT, STATE, ACCENT, systemLabel } from '../../constants/rtTheme';
import { money, signColor } from '../patron360/format';
import { buildSeats, defaultSeat, edgePaths } from '../../utils/seatSummary';
import { edgesFromRow, ringsFor } from '../../utils/edgeRings';
import TableTop from './TableTop';
import SeatCard from './SeatCard';
import EdgeByHand from './EdgeByHand';
import TrendBoard from './TrendBoard';
import { seatColor } from './focusShared';

const EMPTY = [];
const fmtPct = (v) => `${v < 0 ? '−' : ''}${Math.abs(v).toFixed(2)}%`;

function Fact({ label, value, color = TEXT.primary }) {
    return (
        <Box sx={{ px: 1.25, py: 0.5, borderRadius: 1.5, bgcolor: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
            <Typography sx={{ ...systemLabel, lineHeight: 1.3, whiteSpace: 'nowrap' }}>{label}</Typography>
            <Typography sx={{ fontSize: 15, fontWeight: 800, color, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', lineHeight: 1.3 }}>{value}</Typography>
        </Box>
    );
}

function SeatChip({ seat, onClear }) {
    if (!seat) return <Typography sx={{ fontSize: 12, color: TEXT.faint }}>all players</Typography>;
    const c = seatColor(seat.seat);
    return (
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center', pl: 1.25, pr: 0.5, py: 0.4, borderRadius: 4, border: `1px solid ${c}`, bgcolor: 'rgba(255,255,255,0.04)' }}>
            <Typography sx={{ fontSize: 12, fontWeight: 800, color: c, whiteSpace: 'nowrap' }}>S{seat.seat} · {seat.playerId}</Typography>
            <ButtonBase aria-label="Show all players" onClick={onClear} sx={{ width: 20, height: 20, borderRadius: '50%', bgcolor: 'rgba(255,255,255,0.12)', color: TEXT.primary }}>
                <CloseIcon sx={{ fontSize: 13 }} />
            </ButtonBase>
        </Stack>
    );
}

function Subhead({ title, children }) {
    return (
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 1, mb: 1, minHeight: 30 }}>
            <Typography component="h3" sx={{ fontSize: 14, fontWeight: 800, color: TEXT.primary }}>{title}</Typography>
            {children}
        </Stack>
    );
}

export default function RtTableFocus({
    tableKey, tableRow, shoe, loading, error, seated = EMPTY, ringSettings,
    tableOptions = EMPTY, onPickTable, preferPlayerId, onOpen360,
}) {
    const hands = (shoe && shoe.hands) || EMPTY;
    const seats = useMemo(() => buildSeats(shoe, seated, tableKey || ''), [shoe, seated, tableKey]);
    const paths = useMemo(() => edgePaths(shoe), [shoe]);
    const handNos = useMemo(() => hands.map((h) => h.handNo), [hands]);
    const hits = useMemo(() => (tableRow && ringSettings
        ? ringsFor(edgesFromRow(tableRow), tableRow.shoe_hands_dealt == null ? null : Number(tableRow.shoe_hands_dealt), ringSettings)
        : EMPTY), [tableRow, ringSettings]);

    const [selectedSeat, setSelectedSeat] = useState(null);
    const [view, setView] = useState('all');
    const [option, setOption] = useState(null);
    const [hoverIdx, setHoverIdx] = useState(null);
    const [pickedIdx, setPickedIdx] = useState(null);

    // New table or new shoe: open on the seat most worth watching.
    const openedFor = useRef(null);
    useEffect(() => {
        if (!shoe) return;
        const id = `${tableKey}|${shoe.shoeId}`;
        if (openedFor.current === id) return;
        openedFor.current = id;
        const preferred = preferPlayerId ? seats.find((s) => !s.empty && s.playerId === preferPlayerId) : null;
        setSelectedSeat(preferred ? preferred.seat : defaultSeat(seats));
        setOption(null);
        setPickedIdx(null);
        setHoverIdx(null);
    }, [tableKey, shoe, seats, preferPlayerId]);

    // A patron picked elsewhere (patron list, alert) who sits here.
    useEffect(() => {
        if (!preferPlayerId) return;
        const s = seats.find((x) => !x.empty && x.playerId === preferPlayerId);
        if (s) setSelectedSeat(s.seat);
    }, [preferPlayerId]); // eslint-disable-line react-hooks/exhaustive-deps

    const seat = selectedSeat != null ? seats.find((s) => s.seat === selectedSeat && !s.empty) || null : null;
    // The patron picked elsewhere should be here but isn't in this shoe
    // (just sat down, or the feeds disagree): say so, and offer their own
    // Player 360 instead of quietly showing someone else's seat.
    const preferMissing = !!(preferPlayerId && shoe && !seats.some((s) => !s.empty && s.playerId === preferPlayerId));
    const toggleSeat = useCallback((n) => setSelectedSeat((cur) => (cur === n ? null : n)), []);
    const marked = useMemo(() => (seat ? new Set(seat.bets.map((b) => b.handNo)) : null), [seat]);

    const shownIdx = pickedIdx != null && pickedIdx < hands.length ? pickedIdx : hands.length - 1;
    const shown = hands[shownIdx];
    const seatedMinutes = useCallback((firstHand) => {
        const a = hands.find((h) => h.handNo === firstHand);
        const b = hands[hands.length - 1];
        if (!a || !b || !a.time || !b.time) return null;
        return Math.max(1, Math.round((new Date(b.time) - new Date(a.time)) / 60000));
    }, [hands]);

    if (!tableKey) {
        return (
            <Stack spacing={0.75} sx={{ alignItems: 'center', py: 6, textAlign: 'center' }}>
                <Typography sx={{ fontSize: 15, fontWeight: 700, color: TEXT.muted }}>Pick a table on the map</Typography>
                <Typography sx={{ fontSize: 13, color: TEXT.faint }}>Click a table, a list row or an alert to open its current shoe here.</Typography>
            </Stack>
        );
    }

    const row = tableRow || {};
    const dayWin = Number(row.win);
    const shoeWin = Number.isFinite(Number(row.shoe_win)) ? Number(row.shoe_win) : null;
    const chip = <SeatChip seat={seat} onClear={() => setSelectedSeat(null)} />;

    return (
        <Stack spacing={1.75}>
            {/* ── Header ── */}
            <Stack direction="row" spacing={1.25} sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 1 }}>
                <Box sx={{ pr: 0.5 }}>
                    <Typography component="h2" sx={{ fontSize: 22, fontWeight: 800, color: TEXT.primary, lineHeight: 1.15 }}>{tableKey}</Typography>
                    <Typography sx={{ fontSize: 12, color: TEXT.faint }}>{row.area || '—'} · pit {row.pit ?? '—'}</Typography>
                </Box>
                <Fact label="Shoe" value={(shoe && shoe.shoeId) || row.shoe_id || '—'} />
                <Fact label="Hand" value={hands.length ? `#${hands[hands.length - 1].handNo}` : '—'} />
                <Fact label="Dealer" value={(shoe && shoe.dealer) || '—'} />
                <Fact label="Casino Win · today" value={money(dayWin)} color={signColor(dayWin)} />
                <Fact label="Casino Win · this shoe" value={shoeWin == null ? '—' : money(shoeWin)} color={signColor(shoeWin)} />
                <Box sx={{ flex: 1 }} />
                <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 0.75, alignItems: 'center' }}>
                    {hits.length ? hits.map((h) => (
                        <Box key={h.code} component="span" sx={{
                            px: 1, py: 0.35, borderRadius: 1, border: `1px solid ${h.color}`, color: h.color,
                            fontSize: 12, fontWeight: 800, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums',
                        }}>
                            ● {h.code} {fmtPct(h.edge)}
                        </Box>
                    )) : <Typography sx={{ fontSize: 12, color: TEXT.faint }}>No option below its ring threshold</Typography>}
                </Stack>
                <Select
                    size="small" value={tableKey} onChange={(e) => onPickTable(e.target.value)}
                    inputProps={{ 'aria-label': 'Pick a table' }}
                    MenuProps={{ slotProps: { paper: { sx: { maxHeight: 420, bgcolor: '#20233a', color: TEXT.primary } } } }}
                    sx={{ minWidth: 150, color: TEXT.primary, fontWeight: 700, '& .MuiOutlinedInput-notchedOutline': { borderColor: 'rgba(122,162,247,0.4)' } }}
                >
                    {tableOptions.map((o) => (
                        <MenuItem key={o.key} value={o.key} sx={{ gap: 1 }}>
                            <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: o.alerting ? STATE.negative : 'transparent', border: o.alerting ? 'none' : '1px solid rgba(255,255,255,0.25)' }} />
                            {o.key}
                        </MenuItem>
                    ))}
                </Select>
            </Stack>

            {preferMissing ? (
                <Stack role="status" direction="row" spacing={1.5} sx={{
                    alignItems: 'center', flexWrap: 'wrap', px: 1.5, py: 1, borderRadius: 1.5,
                    border: `1px solid ${STATE.warning}`, bgcolor: 'rgba(224,175,104,0.08)',
                }}>
                    <Typography sx={{ fontSize: 13, color: TEXT.primary }}>
                        <b>{preferPlayerId}</b> is listed at {tableKey} but has no seat in this shoe yet.
                    </Typography>
                    <Box sx={{ flex: 1 }} />
                    <Button size="small" variant="outlined" onClick={() => onOpen360(preferPlayerId)}
                        sx={{ textTransform: 'none', fontWeight: 800, color: ACCENT, borderColor: ACCENT }}>
                        Open {preferPlayerId} Player 360
                    </Button>
                </Stack>
            ) : null}

            {error ? (
                <Typography sx={{ fontSize: 13, color: STATE.warning }}>
                    {hands.length ? `Showing the last loaded shoe — refresh failed: ${error}` : `Couldn't load this shoe — retrying on the next refresh (${error}).`}
                </Typography>
            ) : null}

            {loading && !hands.length ? (
                <Stack sx={{ alignItems: 'center', py: 6 }}><CircularProgress size={26} sx={{ color: ACCENT }} /></Stack>
            ) : !hands.length ? (
                <Typography sx={{ py: 6, textAlign: 'center', fontSize: 15, fontWeight: 700, color: TEXT.muted }}>New shoe — no hands dealt yet</Typography>
            ) : (
                <>
                    <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: 'minmax(0,5fr) minmax(0,7fr)' }, gap: 1.75, alignItems: 'start' }}>
                        <Box sx={{ minWidth: 0 }}>
                            <Subhead title="Table">
                                {chip}
                                <Box sx={{ flex: 1 }} />
                                {seat ? (
                                    <ButtonBase onClick={() => setSelectedSeat(null)} sx={{
                                        px: 1.25, py: 0.5, borderRadius: 4, fontSize: 12, fontWeight: 700, color: TEXT.secondary,
                                        border: '1px solid rgba(122,162,247,0.4)', '&:hover': { borderColor: ACCENT },
                                        '&.Mui-focusVisible': { outline: `2px solid ${ACCENT}`, outlineOffset: 2 },
                                    }}>Show all players</ButtonBase>
                                ) : <Typography sx={{ fontSize: 12, color: TEXT.faint }}>click a seat to follow one player</Typography>}
                            </Subhead>
                            <TableTop
                                tableKey={tableKey}
                                dealer={shoe && shoe.dealer}
                                shownHandNo={shown ? shown.handNo : null}
                                handCount={hands[hands.length - 1].handNo}
                                seats={seats}
                                selectedSeat={seat ? seat.seat : null}
                                onSeat={toggleSeat}
                                edgesAt={shown ? shown.edges : null}
                            />
                            <SeatCard seats={seats} selectedSeat={seat ? seat.seat : null} seatedMinutes={seatedMinutes} onOpen360={onOpen360} />
                        </Box>
                        <Box sx={{ minWidth: 0 }}>
                            <EdgeByHand
                                head={chip}
                                paths={paths}
                                handNos={handNos}
                                seats={seats}
                                selectedSeat={seat ? seat.seat : null}
                                onSelectSeat={setSelectedSeat}
                                hits={hits}
                                view={view}
                                onView={setView}
                                option={option}
                                onOption={setOption}
                                hoverIdx={hoverIdx}
                                onHover={setHoverIdx}
                            />
                        </Box>
                    </Box>
                    <Box>
                        <Subhead title="Trend board">
                            {chip}
                            <Typography sx={{ fontSize: 12, color: TEXT.faint }}>
                                hover an edge chart to find that hand · click a hand to see its chips on the table{seat ? ' · ringed = hands this player bet' : ''}
                            </Typography>
                        </Subhead>
                        <TrendBoard hands={hands} marked={marked} hoverIdx={hoverIdx} onPickHand={setPickedIdx} />
                    </Box>
                </>
            )}
        </Stack>
    );
}
