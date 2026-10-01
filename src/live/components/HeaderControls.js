// Live Casino Win — top toolbar chrome + filter drawer.
// ======================================================
// The top band is intentionally lean: only Date + Live pill + Refresh
// interval stay visible. Segment / Card tier / Game / TopN / Sort get
// moved into a slide-in drawer that opens via the Filters button, with
// a badge showing "N active" so the user can see at a glance how
// narrowed they are. This follows ui-ux-pro-max: progressive-disclosure
// + whitespace-balance.

import React, { useState } from 'react';
import {
    Box, Stack, Typography, Select, MenuItem, Checkbox, Chip, Button, Tooltip,
    Drawer, IconButton, Divider,
} from '@mui/material';
import RefreshIcon from '@mui/icons-material/Refresh';
import FiberManualRecordIcon from '@mui/icons-material/FiberManualRecord';
import CloseIcon from '@mui/icons-material/Close';
import TuneIcon from '@mui/icons-material/Tune';
import { LIVE_FONTS } from '../constants/fontSizes';
import { CARD_TIERS } from '../constants/winPalette';
import { fmtClock } from '../utils/winAggregates';
import { glass, sectionLabel, FONT_DISPLAY, FONT_MONO, ACCENT } from '../constants/liveTheme';

const F = LIVE_FONTS.header;
const TOOLBAR_H = 34;

const ctrlSx = {
    height: TOOLBAR_H, fontFamily: FONT_MONO, fontSize: F.section, fontWeight: 600, color: '#fff',
    bgcolor: 'rgba(122,223,255,0.05)', borderRadius: 2,
    '& .MuiSelect-icon': { color: 'rgba(255,255,255,0.45)' },
    '& .MuiOutlinedInput-notchedOutline': { borderColor: 'rgba(122,223,255,0.22)' },
    '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: 'rgba(122,223,255,0.5)' },
};

function Field({ label, children }) {
    return (
        <Stack spacing={0.3}>
            <Typography sx={{ ...sectionLabel, fontSize: 10.5 }}>
                {label}
            </Typography>
            {children}
        </Stack>
    );
}

const REFRESH_OPTIONS = [
    { v: 5_000,   label: '5 sec' },
    { v: 10_000,  label: '10 sec' },
    { v: 30_000,  label: '30 sec' },
    { v: 60_000,  label: '1 min' },
    { v: 300_000, label: '5 min' },
    { v: 0,       label: 'Manual only' },
];

const TOPX_OPTIONS = [10, 20, 50, 100];

// Reusable multi-select — inside the drawer we render one per filter.
function MultiSelect({ arr, onChange, opts, label }) {
    return (
        <Select
            multiple size="small" displayEmpty
            value={arr || []}
            onChange={(e) => onChange(e.target.value.filter((v) => v !== '__all__'))}
            renderValue={(v) => (!v || !v.length ? `All ${opts.length}` : v.length === 1 ? (CARD_TIERS[v[0]]?.label || v[0]) : `${v.length} selected`)}
            MenuProps={{ PaperProps: { sx: { maxHeight: 360, bgcolor: 'rgba(18,22,34,0.98)', color: '#fff', border: '1px solid rgba(122,200,220,0.25)' } } }}
            sx={{ ...ctrlSx, minWidth: '100%' }}
        >
            <MenuItem value="__all__" onClick={(e) => { e.stopPropagation(); onChange([]); }}
                sx={{ fontSize: F.section, py: 0.4, color: '#7adfff', fontWeight: 700, borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                Clear {label}
            </MenuItem>
            {opts.map((v) => (
                <MenuItem key={v} value={v} sx={{ fontSize: F.section, py: 0.3 }}>
                    <Checkbox size="small" checked={(arr || []).includes(v)} sx={{ p: 0.5, color: 'rgba(255,255,255,0.35)', '&.Mui-checked': { color: '#7adfff' } }} />
                    {CARD_TIERS[v]?.label || v}
                </MenuItem>
            ))}
        </Select>
    );
}

export default function HeaderControls({
    date, onDateChange,
    segments, segmentFilter, onSegmentFilter,
    cardTiers, cardFilter, onCardFilter,
    gametypes, gameFilter, onGameFilter,
    refreshMs, onRefreshMs,
    topN, onTopN,
    asOf, onManualRefresh, isLoading,
    selectedPatron, onClearPatron,
}) {
    const [drawerOpen, setDrawerOpen] = useState(false);

    // Aggregate a count of "active" filters so the button badge nudges
    // the user when they've narrowed the view.
    const activeCount =
        (segmentFilter?.length || 0) +
        (cardFilter?.length || 0) +
        (gameFilter?.length || 0);

    return (
        <Box sx={{ p: 1.2, ...glass, overflow: 'visible' }}>
            <Stack direction="row" spacing={1.4} alignItems="flex-end" sx={{ flexWrap: 'wrap', rowGap: 1 }}>
                <Field label="Gaming date">
                    <Box component="input" type="date" value={date || ''}
                        onChange={(e) => onDateChange && onDateChange(e.target.value)}
                        sx={{ height: TOOLBAR_H, px: 1, fontSize: F.section, fontWeight: 700, color: '#fff',
                            bgcolor: 'rgba(255,255,255,0.045)', border: '1px solid rgba(122,200,220,0.22)', borderRadius: 2, outline: 'none',
                            colorScheme: 'dark' }} />
                </Field>

                <Field label="Refresh">
                    <Select size="small" value={refreshMs}
                        onChange={(e) => onRefreshMs(Number(e.target.value))}
                        MenuProps={{ PaperProps: { sx: { bgcolor: 'rgba(18,22,34,0.98)', color: '#fff', border: '1px solid rgba(122,200,220,0.25)' } } }}
                        sx={{ ...ctrlSx, minWidth: 130 }}>
                        {REFRESH_OPTIONS.map((o) => <MenuItem key={o.v} value={o.v} sx={{ fontSize: F.section, py: 0.2 }}>{o.label}</MenuItem>)}
                    </Select>
                </Field>

                <Field label={refreshMs > 0 ? 'Live' : 'Paused'}>
                    <Box sx={{
                        height: TOOLBAR_H, px: 1.2, borderRadius: 2,
                        bgcolor: 'rgba(255,255,255,0.045)',
                        border: '1px solid rgba(122,200,220,0.22)',
                        display: 'flex', alignItems: 'center', gap: 0.9, whiteSpace: 'nowrap',
                    }}>
                        <FiberManualRecordIcon sx={{
                            fontSize: 9, flexShrink: 0,
                            color: refreshMs > 0 ? '#6ad08f' : 'rgba(255,255,255,0.35)',
                            animation: refreshMs > 0 && !isLoading ? 'liveDot 2s infinite' : 'none',
                        }} />
                        <Typography sx={{
                            fontSize: F.meta, color: 'rgba(255,255,255,0.78)',
                            fontVariantNumeric: 'tabular-nums', lineHeight: 1, fontWeight: 600,
                        }}>
                            as of {fmtClock(asOf)}
                        </Typography>
                        <Tooltip title="Refresh now">
                            <Box component="span" sx={{ display: 'flex' }}>
                                <IconButton onClick={onManualRefresh} disabled={isLoading} size="small"
                                    sx={{ p: 0.3, color: '#7adfff', '&:hover': { bgcolor: 'rgba(122,223,255,0.12)' } }}>
                                    <RefreshIcon sx={{ fontSize: 15 }} />
                                </IconButton>
                            </Box>
                        </Tooltip>
                    </Box>
                </Field>

                <Box sx={{ flex: 1 }} />

                {selectedPatron && (
                    <Field label="Pinned patron">
                        <Chip
                            label={selectedPatron.patronId}
                            onDelete={onClearPatron} deleteIcon={<CloseIcon />}
                            sx={{
                                height: TOOLBAR_H, fontSize: F.section, fontWeight: 700,
                                color: '#0a1a2c', bgcolor: '#7adfff', borderRadius: 2,
                                '& .MuiChip-label': { px: 1.2 },
                                '& .MuiChip-deleteIcon': { color: 'rgba(6,24,44,0.7)', '&:hover': { color: '#0a1a2c' } },
                            }}
                        />
                    </Field>
                )}

                <Field label="View">
                    <Button
                        onClick={() => setDrawerOpen(true)}
                        startIcon={<TuneIcon sx={{ fontSize: 16 }} />}
                        size="small"
                        sx={{
                            height: TOOLBAR_H, textTransform: 'none', fontSize: F.section, fontWeight: 700,
                            color: '#dff5ff', bgcolor: 'rgba(122,223,255,0.10)', borderRadius: 2, px: 1.4,
                            border: '1px solid rgba(122,200,220,0.35)',
                            '&:hover': { bgcolor: 'rgba(122,223,255,0.18)', borderColor: 'rgba(122,200,220,0.55)' },
                        }}
                    >
                        Filters
                        {activeCount > 0 && (
                            <Box component="span" sx={{
                                ml: 0.8, minWidth: 20, height: 18, px: 0.6,
                                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                                fontSize: 10, fontWeight: 800, borderRadius: 999,
                                bgcolor: '#7adfff', color: '#06182a',
                            }}>{activeCount}</Box>
                        )}
                    </Button>
                </Field>
            </Stack>

            <style>{`
                @keyframes liveDot { 0%,100% { opacity: 1; transform: scale(1); } 50% { opacity: 0.4; transform: scale(0.85); } }
                @media (prefers-reduced-motion: reduce) {
                    @keyframes liveDot { 0%,100% { opacity: 1; transform: none; } 50% { opacity: 1; transform: none; } }
                }
            `}</style>

            {/* ── Filter drawer ─────────────────────────────────────── */}
            <Drawer
                anchor="right" open={drawerOpen} onClose={() => setDrawerOpen(false)}
                PaperProps={{ sx: {
                    width: 340, bgcolor: 'rgba(10, 22, 35, 0.98)',
                    borderLeft: '1px solid rgba(122,200,220,0.22)', color: '#fff',
                    backgroundImage: 'none',
                } }}
            >
                <Stack sx={{ height: '100%' }}>
                    <Stack direction="row" alignItems="center" sx={{ px: 2, py: 1.4, borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                        <TuneIcon sx={{ fontSize: 18, color: '#7adfff', mr: 1 }} />
                        <Typography sx={{ fontSize: 15, fontWeight: 800, color: '#dff5ff', letterSpacing: 0.3 }}>View filters</Typography>
                        <Box sx={{ flex: 1 }} />
                        {activeCount > 0 && (
                            <Button size="small" onClick={() => { onSegmentFilter([]); onCardFilter([]); onGameFilter([]); }}
                                sx={{ minWidth: 0, px: 1, fontSize: 11, fontWeight: 700, color: '#7adfff', textTransform: 'none', mr: 0.5 }}>
                                Reset all
                            </Button>
                        )}
                        <IconButton size="small" onClick={() => setDrawerOpen(false)} sx={{ color: 'rgba(255,255,255,0.6)' }}>
                            <CloseIcon sx={{ fontSize: 18 }} />
                        </IconButton>
                    </Stack>

                    <Stack spacing={2.2} sx={{ p: 2, overflowY: 'auto' }}>
                        <Field label="Segment">
                            <MultiSelect arr={segmentFilter} onChange={onSegmentFilter} opts={segments || []} label="segment" />
                        </Field>
                        <Field label="Card tier">
                            <MultiSelect arr={cardFilter} onChange={onCardFilter} opts={cardTiers || []} label="card tier" />
                        </Field>
                        <Field label="Game">
                            <MultiSelect arr={gameFilter} onChange={onGameFilter} opts={gametypes || []} label="game" />
                        </Field>

                        <Divider sx={{ borderColor: 'rgba(255,255,255,0.08)' }} />

                        <Field label="Top players in list">
                            <Select size="small" value={topN}
                                onChange={(e) => onTopN(Number(e.target.value))}
                                MenuProps={{ PaperProps: { sx: { bgcolor: 'rgba(18,22,34,0.98)', color: '#fff', border: '1px solid rgba(122,200,220,0.25)' } } }}
                                sx={{ ...ctrlSx, minWidth: '100%' }}>
                                {TOPX_OPTIONS.map((n) => <MenuItem key={n} value={n} sx={{ fontSize: F.section, py: 0.3 }}>{n}</MenuItem>)}
                            </Select>
                        </Field>
                        <Typography sx={{ color: 'rgba(255,255,255,0.35)', fontSize: 11, fontStyle: 'italic', mt: -0.5 }}>
                            Rank criterion (Top winners / losers / card tier / avg bet) is picked via tabs in the right panel.
                        </Typography>
                    </Stack>
                </Stack>
            </Drawer>
        </Box>
    );
}
