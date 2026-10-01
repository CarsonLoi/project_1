// Right-hand tabbed container beside the floor map.
// ================================================
// Exactly as tall as the map panel (the parent sizes it absolutely) and
// scrolls inside with no visible scrollbar, so switching tabs never
// changes the page height. Every money list says whose money it is:
// Table W/L and Dealers are Casino Win, Patrons is Patron Win.

import React, { useMemo } from 'react';
import { Box, Tabs, Tab, Stack, Typography, Chip, ButtonBase } from '@mui/material';
import RtRankingList from './RtRankingList';
import { RT_TABS, RANKING_ROWS } from '../constants/rtConfig';
import { TEXT, ACCENT, systemLabel } from '../constants/rtTheme';

const money = (v) => {
    if (v == null || !Number.isFinite(v)) return '—';
    const a = Math.abs(v), s = v < 0 ? '−' : v > 0 ? '+' : '';
    if (a >= 1e6) return `${s}$${(a / 1e6).toFixed(2)}M`;
    if (a >= 1e3) return `${s}$${(a / 1e3).toFixed(a >= 1e4 ? 0 : 1)}K`;
    return `${s}$${a.toFixed(0)}`;
};
const pct = (v) => `${v < 0 ? '−' : ''}${Math.abs(v).toFixed(2)}%`;
const isSentinel = (v) => v === -1000000 || v === -999999 || v == null || !Number.isFinite(v);

const hiddenScroll = { scrollbarWidth: 'none', '&::-webkit-scrollbar': { display: 'none' } };

function topBottom(rows, n) {
    if (rows.length <= n * 2) return rows;
    return [...rows.slice(0, n), { _divider: true, id: '__div__' }, ...rows.slice(-n)];
}

function Divider({ label }) {
    return (
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center', px: 1, py: 0.75 }}>
            <Box sx={{ flex: 1, height: '1px', bgcolor: 'rgba(255,255,255,0.1)' }} />
            <Typography sx={{ fontSize: 12, color: TEXT.faint, letterSpacing: 0.6, whiteSpace: 'nowrap' }}>{label}</Typography>
            <Box sx={{ flex: 1, height: '1px', bgcolor: 'rgba(255,255,255,0.1)' }} />
        </Stack>
    );
}

function SplitRanking({ rows, dividerLabel, ...rest }) {
    const idx = rows.findIndex((r) => r._divider);
    if (idx === -1) return <RtRankingList rows={rows} {...rest} />;
    return (
        <>
            <RtRankingList rows={rows.slice(0, idx)} {...rest} />
            <Divider label={dividerLabel} />
            <RtRankingList rows={rows.slice(idx + 1)} {...rest} />
        </>
    );
}

// What the numbers in this tab are — the perspective, stated once.
function ListHead({ metric, note }) {
    return (
        <Stack direction="row" sx={{ alignItems: 'baseline', justifyContent: 'space-between', px: 1, pb: 0.5, gap: 1 }}>
            <Typography sx={{ ...systemLabel, color: TEXT.secondary }}>{metric}</Typography>
            <Typography sx={{ fontSize: 12, color: TEXT.faint, whiteSpace: 'nowrap' }}>{note}</Typography>
        </Stack>
    );
}

function RingList({ rows, selectedId, onSelect }) {
    if (!rows.length) {
        return <Typography sx={{ fontSize: 14, color: TEXT.faint, px: 1, py: 2 }}>No table is below your thresholds.</Typography>;
    }
    return (
        <Stack spacing={0.4} sx={{ px: 0.25 }}>
            {rows.map((r) => {
                const active = r.key === selectedId;
                return (
                    <ButtonBase
                        key={r.key}
                        onClick={() => onSelect(r.key)}
                        sx={{
                            display: 'grid', gridTemplateColumns: '108px minmax(0,1fr) 72px', alignItems: 'center', gap: 1,
                            textAlign: 'left', py: 0.8, px: 0.75, borderRadius: 1,
                            bgcolor: active ? 'rgba(122,162,247,0.18)' : 'transparent',
                            '&:hover': { bgcolor: active ? 'rgba(122,162,247,0.24)' : 'rgba(255,255,255,0.05)' },
                            '&.Mui-focusVisible': { outline: `2px solid ${ACCENT}`, outlineOffset: -2 },
                        }}
                    >
                        <Box sx={{ minWidth: 0 }}>
                            <Typography sx={{ fontSize: 14, fontWeight: 700, color: TEXT.primary, lineHeight: 1.3 }}>{r.key}</Typography>
                            <Typography sx={{ fontSize: 12, color: TEXT.faint, lineHeight: 1.3 }}>hand #{r.hands ?? '—'}</Typography>
                        </Box>
                        <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 0.5 }}>
                            {r.hits.map((h) => (
                                <Box key={h.code} component="span" sx={{
                                    px: 0.6, borderRadius: 0.75, fontSize: 11, fontWeight: 800, color: h.color,
                                    border: `1px solid ${h.color}`, lineHeight: '17px', whiteSpace: 'nowrap',
                                }}>
                                    {h.code}
                                </Box>
                            ))}
                        </Stack>
                        <Typography sx={{ textAlign: 'right', fontSize: 15, fontWeight: 800, color: r.hits[0].color, fontVariantNumeric: 'tabular-nums' }}>
                            {pct(r.hits[0].edge)}
                        </Typography>
                    </ButtonBase>
                );
            })}
        </Stack>
    );
}

export default function RtTabbedPanel({
    activeTab, onTabChange,
    tables = [], patrons = [], dealers = [],
    rings, ringsOn = false,
    selectedTableKey, onSelectTable,
    selectedPatronId, onSelectPatron,
    alertCounts = {},
    scope = 'day',
}) {
    const half = Math.max(3, Math.floor(RANKING_ROWS / 2));
    const scopeText = scope === 'shoe' ? 'current shoe' : 'today';

    // Casino Win per table, worst first — day or current shoe.
    const tableRows = useMemo(() => {
        const field = scope === 'shoe' ? 'shoe_win' : 'win';
        const rows = tables
            .filter((t) => !isSentinel(Number(t[field])))
            .map((t) => {
                const key = `${t.gametype}|${t.table}`;
                return {
                    id: key,
                    label: key,
                    sublabel: scope === 'shoe'
                        ? `hand #${t.shoe_hands_dealt ?? '—'} · ${t.shoe_id || 'no shoe'}`
                        : `${t.area || '—'} · pit ${t.pit ?? '—'}`,
                    value: Number(t[field]) || 0,
                    tooltip: scope === 'shoe'
                        ? `${key} — Casino Win this shoe ${money(Number(t.shoe_win))} · Casino Theo ${money(Number(t.shoe_theo))}`
                        : `${key} — Casino Win ${money(Number(t.win))} · Casino Theo ${money(Number(t.theo))} · Win − Theo ${money((Number(t.win) || 0) - (Number(t.theo) || 0))}`,
                };
            })
            .sort((a, b) => a.value - b.value);
        return topBottom(rows, half);
    }, [tables, half, scope]);

    const ringRows = useMemo(() => {
        const byKey = new Map(tables.map((t) => [`${t.gametype}|${t.table}`, t]));
        return [...(rings || new Map()).entries()]
            .map(([key, hits]) => ({ key, hits, hands: byKey.get(key) ? byKey.get(key).shoe_hands_dealt : null }))
            .sort((a, b) => a.hits[0].gap - b.hits[0].gap);
    }, [rings, tables]);

    // Patron Win: the feed is casino perspective, flipped here.
    const patronRows = useMemo(() => {
        const rows = patrons
            .filter((p) => Number.isFinite(Number(p.cum_win)))
            .map((p) => ({
                id: p.patron_id,
                label: p.patron_id,
                sublabel: `${p.card_type || '—'} · ${p.current_table_key ? `at ${p.current_table_key}` : `${p.tables_played ?? 0} tables`}`,
                value: -(Number(p.cum_win) || 0),
                tooltip: `${p.patron_id} — Patron Win ${money(-(Number(p.cum_win) || 0))} · ${p.hands ?? 0} hands · avg bet ${money(Number(p.avg_bet)).replace('+', '')}`,
            }))
            .sort((a, b) => b.value - a.value);
        return topBottom(rows, half);
    }, [patrons, half]);

    const dealerRows = useMemo(() => dealers
        .filter((d) => Number.isFinite(Number(d.win_loss)))
        .map((d) => ({
            id: d.dealer,
            label: d.dealer,
            sublabel: `${d.hands ?? 0} hands · ${d.tables_worked ?? 0} tables`,
            value: Number(d.win_loss) || 0,
            tooltip: `${d.dealer} — Casino Win ${money(Number(d.win_loss))} across ${d.tables_worked ?? 0} tables`,
        }))
        .sort((a, b) => a.value - b.value), [dealers]);

    const badgeFor = (id) => {
        if (id === 'rings') return ringRows.length;
        if (id === 'tables') return alertCounts.TABLE_LOSS;
        if (id === 'patrons') return (alertCounts.PATRON_WIN || 0) + (alertCounts.BET_SPREAD || 0);
        return 0;
    };

    const idx = Math.max(0, RT_TABS.findIndex((t) => t.id === activeTab));

    return (
        <Box sx={{ display: 'flex', flexDirection: 'column', minWidth: 0, height: '100%' }}>
            <Tabs
                value={idx}
                onChange={(_, i) => onTabChange && onTabChange(RT_TABS[i].id)}
                variant="scrollable"
                scrollButtons={false}
                sx={{
                    minHeight: 40, flexShrink: 0,
                    borderBottom: '1px solid rgba(255,255,255,0.08)',
                    '& .MuiTab-root': {
                        minHeight: 40, py: 0.75, px: { xs: 1, xl: 1.3 }, textTransform: 'none',
                        fontSize: { xs: 13, xl: 14 }, fontWeight: 700, color: TEXT.muted, minWidth: 0,
                    },
                    '& .Mui-selected': { color: `${TEXT.primary} !important` },
                    '& .MuiTabs-indicator': { backgroundColor: ACCENT, height: 2 },
                }}
            >
                {RT_TABS.map((t) => {
                    const n = badgeFor(t.id);
                    const ring = t.id === 'rings';
                    return (
                        <Tab
                            key={t.id}
                            label={
                                <Stack direction="row" spacing={0.6} sx={{ alignItems: 'center' }}>
                                    <span>{t.label}</span>
                                    {n > 0 && (
                                        <Chip size="small" label={n} sx={{
                                            height: 18, minWidth: 18, fontSize: 11, fontWeight: 800,
                                            bgcolor: ring ? 'rgba(214,92,255,0.2)' : 'rgba(255,122,122,0.22)',
                                            color: ring ? 'rgb(235,150,255)' : '#ff7a7a',
                                            '& .MuiChip-label': { px: 0.5 },
                                        }} />
                                    )}
                                </Stack>
                            }
                        />
                    );
                })}
            </Tabs>

            <Box sx={{ pt: 1, flex: 1, minHeight: 0, overflowY: 'auto', ...hiddenScroll }}>
                {activeTab === 'tables' && (
                    <>
                        <ListHead metric={`Casino Win · ${scopeText}`} note="casino losing first" />
                        <SplitRanking
                            rows={tableRows}
                            dividerLabel="biggest Casino Wins below"
                            format={money}
                            onSelect={(r) => onSelectTable && onSelectTable(r.id)}
                            selectedId={selectedTableKey}
                            emptyText="No table results yet."
                        />
                    </>
                )}

                {activeTab === 'rings' && (
                    <>
                        <ListHead metric="Live edge below threshold" note={ringsOn ? 'worst first' : 'rings hidden on map'} />
                        <RingList rows={ringRows} selectedId={selectedTableKey} onSelect={(k) => onSelectTable && onSelectTable(k)} />
                    </>
                )}

                {activeTab === 'patrons' && (
                    <>
                        <ListHead metric="Patron Win · today" note="patron winning first" />
                        <SplitRanking
                            rows={patronRows}
                            dividerLabel="patrons losing most below"
                            format={money}
                            onSelect={(r) => onSelectPatron && onSelectPatron(r.id)}
                            selectedId={selectedPatronId}
                            emptyText="No patrons on floor."
                        />
                    </>
                )}

                {activeTab === 'dealers' && (
                    <>
                        <ListHead metric="Casino Win · today" note="casino losing first" />
                        <RtRankingList rows={dealerRows} format={money} emptyText="No dealer data." />
                    </>
                )}
            </Box>
        </Box>
    );
}
