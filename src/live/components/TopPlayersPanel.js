// Live Casino Win — Top-X players panel.
// Ranked list on the right column. Row click sets the selected patron
// upstream (which filters the heatmap + opens the deep panel).

import React from 'react';
import { Box, Stack, Typography, Tooltip, IconButton, Tabs, Tab } from '@mui/material';
import BorderStyleIcon from '@mui/icons-material/BorderStyle';
import { LIVE_FONTS } from '../constants/fontSizes';
import { CARD_TIERS, colorForWin, fmtCurrency } from '../constants/winPalette';
import { fmtDuration } from '../utils/winAggregates';
import RowSparkline from './RowSparkline';
import { glass, sectionLabel, accentBar, FONT_DISPLAY, FONT_MONO, RANK_MEDALS, ACCENT } from '../constants/liveTheme';

// Tabs shown at the top of the panel. Each drives the sort AND the set
// of players displayed — so the highlight overlay (which follows the
// visible list) automatically shifts too.
export const RANK_TABS = [
    { v: 'biggestWinner', label: 'Top winners' },
    { v: 'biggestLoser',  label: 'Top losers' },
    { v: 'topCardTier',   label: 'Top card tier' },
    { v: 'highestAvgBet', label: 'Highest avg bet' },
];

const F = LIVE_FONTS.topX;

const cellBase = { py: 0.55, px: 0.6, fontSize: F.cell, fontFamily: FONT_MONO, fontVariantNumeric: 'tabular-nums', borderBottom: '1px solid rgba(255,255,255,0.05)', whiteSpace: 'nowrap' };
const headBase = { py: 0.55, px: 0.6, fontSize: F.header, fontFamily: FONT_DISPLAY, fontWeight: 700, letterSpacing: 1.1, textTransform: 'uppercase', color: 'rgba(202,232,255,0.55)', borderBottom: '1px solid rgba(122,223,255,0.18)', textAlign: 'right', whiteSpace: 'nowrap' };

// Subtle card badge — muted bg + colored dot + slim text. Scans as data
// instead of decoration. See ui-ux-pro-max: weight-hierarchy.
function CardBadge({ cardType }) {
    const t = CARD_TIERS[cardType] || CARD_TIERS.BASE;
    return (
        <Stack direction="row" alignItems="center" spacing={0.5} sx={{
            display: 'inline-flex', px: 0.7, py: 0.25, borderRadius: 0.7,
            bgcolor: `${t.accent}1a`, border: `1px solid ${t.accent}40`, whiteSpace: 'nowrap',
        }}>
            <Box sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: t.accent, flexShrink: 0 }} />
            <Typography sx={{ fontSize: F.card, fontWeight: 700, letterSpacing: 0.4, color: 'rgba(255,255,255,0.85)', lineHeight: 1 }}>
                {t.label}
            </Typography>
        </Stack>
    );
}

export default function TopPlayersPanel({
    patrons, topN, sortBy, onSortBy,
    selectedPatronId, onSelectPatron, trajectories,
    highlightOn, onHighlightToggle,
}) {
    // Show the "avg bet" column when that tab is active — otherwise
    // wager per hand is off-story. Card column always visible.
    const showAvgBet = sortBy === 'highestAvgBet';
    // A single scrollable panel. Keeps sticky header + right column count fixed
    // regardless of how many rows the parent decides to show.
    return (
        <Box sx={{
            display: 'flex', flexDirection: 'column',
            // flex:1 + width:100% — this panel renders inside flex wrappers;
            // without an explicit claim it sizes to its intrinsic table width
            // and leaves a dead gutter on wide monitors (the reported bug).
            flex: 1, width: '100%', minWidth: 0,
            ...glass,
            minHeight: 0,   // required so flex child can shrink and its inner scroll works
        }}>
            {/* Panel header — count + highlight toggle. */}
            <Stack direction="row" spacing={1} alignItems="center" sx={{ px: 1.2, py: 0.7, borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                <Box sx={{ ...accentBar, height: 17 }} />
                <Typography sx={{ fontFamily: FONT_DISPLAY, color: '#dff5ff', fontSize: 15.5, fontWeight: 700, letterSpacing: 1.4, textTransform: 'uppercase' }}>
                    Top {Math.min(topN, patrons.length)} players
                </Typography>
                <Box sx={{ flex: 1 }} />
                {onHighlightToggle && (
                    <Tooltip title={highlightOn ? 'Turn highlight off (yellow rectangle on tables played by ranked players)' : 'Turn highlight on'}>
                        <IconButton size="small" onClick={onHighlightToggle}
                            sx={{
                                borderRadius: 1,
                                bgcolor: highlightOn ? 'rgba(255,212,121,0.18)' : 'transparent',
                                color: highlightOn ? '#ffd479' : 'rgba(255,255,255,0.55)',
                                border: `1px solid ${highlightOn ? 'rgba(255,212,121,0.6)' : 'rgba(255,255,255,0.15)'}`,
                                px: 0.7, py: 0.35,
                                display: 'flex', alignItems: 'center', gap: 0.4,
                                '&:hover': { bgcolor: highlightOn ? 'rgba(255,212,121,0.25)' : 'rgba(255,255,255,0.05)' },
                            }}>
                            <BorderStyleIcon sx={{ fontSize: 15 }} />
                            <Typography sx={{ fontSize: 10.5, fontWeight: 800, letterSpacing: 0.5, textTransform: 'uppercase', lineHeight: 1 }}>
                                Highlight
                            </Typography>
                        </IconButton>
                    </Tooltip>
                )}
            </Stack>

            {/* Sort/rank tabs. Same idea as MUI Tabs elsewhere in the
                product — thin underline indicator, no chunky background. */}
            <Tabs
                value={sortBy}
                onChange={(_, v) => onSortBy && onSortBy(v)}
                variant="scrollable" scrollButtons={false}
                sx={{
                    minHeight: 34, borderBottom: '1px solid rgba(122,223,255,0.15)',
                    '& .MuiTabs-indicator': { background: 'linear-gradient(90deg, #7adfff, #b18aff)', height: 2, boxShadow: '0 0 8px rgba(122,223,255,0.6)' },
                    '& .MuiTab-root': {
                        minHeight: 34, py: 0, px: 1.5,
                        fontFamily: FONT_DISPLAY,
                        fontSize: 12.5, fontWeight: 700, letterSpacing: 1.2, textTransform: 'uppercase',
                        color: 'rgba(202,232,255,0.5)',
                        transition: 'color 140ms',
                    },
                    '& .Mui-selected': { color: '#dff5ff', textShadow: '0 0 12px rgba(122,223,255,0.5)' },
                }}
            >
                {RANK_TABS.map((t) => <Tab key={t.v} value={t.v} label={t.label} />)}
            </Tabs>

            <Box sx={{
                flex: 1, minHeight: 0, overflowY: 'auto',
                scrollbarColor: 'rgba(122,223,255,0.35) rgba(255,255,255,0.04)', scrollbarWidth: 'thin',
                '&::-webkit-scrollbar': { width: 9 },
                '&::-webkit-scrollbar-track': { bgcolor: 'rgba(255,255,255,0.03)' },
                '&::-webkit-scrollbar-thumb': { bgcolor: 'rgba(122,223,255,0.35)', borderRadius: 3, border: '2px solid transparent', backgroundClip: 'padding-box' },
            }}>
                <Box component="table" sx={{ width: '100%', borderCollapse: 'separate', borderSpacing: 0 }}>
                    <Box component="thead" sx={{ position: 'sticky', top: 0, bgcolor: 'rgba(8,22,36,0.98)', zIndex: 2 }}>
                        <Box component="tr">
                            <Box component="th" sx={{ ...headBase, textAlign: 'left', pl: 1, width: 28 }}>#</Box>
                            <Box component="th" sx={{ ...headBase, textAlign: 'left' }}>Player</Box>
                            <Box component="th" sx={{ ...headBase, textAlign: 'left' }}>Card</Box>
                            <Box component="th" sx={{ ...headBase }}>Hands</Box>
                            <Box component="th" sx={{ ...headBase }}>{showAvgBet ? 'Avg bet' : 'Casino W/L'}</Box>
                            <Box component="th" sx={{ ...headBase, textAlign: 'center' }}>Last 1h</Box>
                            <Box component="th" sx={{ ...headBase, pr: 1.2 }}>Floor</Box>
                        </Box>
                    </Box>
                    <Box component="tbody">
                        {patrons.slice(0, topN).map((p, i) => {
                            const isSel = selectedPatronId === p.patronId;
                            const cumColor = colorForWin(p.cumWin);
                            return (
                                <Box component="tr" key={p.patronId}
                                    onClick={() => onSelectPatron && onSelectPatron(isSel ? null : p.patronId)}
                                    sx={{
                                        cursor: 'pointer',
                                        bgcolor: isSel ? 'rgba(122,223,255,0.14)' : 'transparent',
                                        borderLeft: `3px solid ${isSel ? ACCENT : 'transparent'}`,
                                        transition: 'background-color 120ms, box-shadow 120ms',
                                        '&:hover': { bgcolor: isSel ? 'rgba(122,223,255,0.2)' : 'rgba(122,223,255,0.06)' },
                                    }}>
                                    <Box component="td" sx={{ ...cellBase, pl: 0.8 }}>
                                        {RANK_MEDALS[i + 1] ? (
                                            <Box sx={{
                                                width: 20, height: 20, borderRadius: '50%',
                                                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                                                fontFamily: FONT_DISPLAY, fontSize: 11.5, fontWeight: 700,
                                                color: '#0a1220', bgcolor: RANK_MEDALS[i + 1],
                                                boxShadow: `0 0 8px ${RANK_MEDALS[i + 1]}55`,
                                            }}>{i + 1}</Box>
                                        ) : (
                                            <Box component="span" sx={{ color: 'rgba(255,255,255,0.45)', fontWeight: 600, pl: 0.6 }}>{i + 1}</Box>
                                        )}
                                    </Box>
                                    <Box component="td" sx={{ ...cellBase, color: '#dff5ff', fontWeight: 700, fontSize: F.id }}>{p.patronId}</Box>
                                    <Box component="td" sx={{ ...cellBase }}><CardBadge cardType={p.cardType} /></Box>
                                    <Box component="td" sx={{ ...cellBase, textAlign: 'right' }}>{p.hands}</Box>
                                    {showAvgBet ? (
                                        <Box component="td" sx={{ ...cellBase, textAlign: 'right', fontWeight: 800, color: '#dff5ff', fontSize: F.cellStrong }}>
                                            {p.hands > 0 ? fmtCurrency(p.cumWager / p.hands) : '—'}
                                        </Box>
                                    ) : (
                                        <Box component="td" sx={{ ...cellBase, textAlign: 'right', fontWeight: 800, color: cumColor, fontSize: F.cellStrong }}>{fmtCurrency(p.cumWin)}</Box>
                                    )}
                                    <Box component="td" sx={{ ...cellBase, textAlign: 'center', px: 0.5 }}>
                                        {(() => {
                                            const traj = trajectories && trajectories.get(p.patronId);
                                            if (!traj || traj.length < 2) return <Box sx={{ color: 'rgba(255,255,255,0.25)', fontSize: 11 }}>—</Box>;
                                            const last = traj[traj.length - 1];
                                            return <RowSparkline points={traj} sign={last} ariaLabel={`${p.patronId} recent trajectory`} />;
                                        })()}
                                    </Box>
                                    <Box component="td" sx={{ ...cellBase, textAlign: 'right', pr: 1.2, color: 'rgba(255,255,255,0.6)' }}>{fmtDuration(p.signInMinsAgo)}</Box>
                                </Box>
                            );
                        })}
                        {patrons.length === 0 && (
                            <Box component="tr">
                                <Box component="td" colSpan={7} sx={{ py: 5, textAlign: 'center' }}>
                                    <Stack alignItems="center" spacing={0.6}>
                                        <Box sx={{ width: 34, height: 34, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px dashed rgba(122,200,220,0.35)', color: 'rgba(122,223,255,0.55)' }}>
                                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
                                        </Box>
                                        <Typography sx={{ color: 'rgba(255,255,255,0.7)', fontSize: 13, fontWeight: 700 }}>No patrons match your filters</Typography>
                                        <Typography sx={{ color: 'rgba(255,255,255,0.4)', fontSize: 11 }}>Clear or widen the segment / card / game slicers to see live activity.</Typography>
                                    </Stack>
                                </Box>
                            </Box>
                        )}
                    </Box>
                </Box>
            </Box>

            {/* Pinned totals footer — anchored to the panel's bottom edge so
                the stretched column ends in information, not dead space.
                Totals cover exactly the players listed above. */}
            {(() => {
                const listed = patrons.slice(0, topN);
                if (!listed.length) return null;
                const totWager = listed.reduce((s, p) => s + (p.cumWager || 0), 0);
                const totWin = listed.reduce((s, p) => s + (p.cumWin || 0), 0);
                const totHands = listed.reduce((s, p) => s + (p.hands || 0), 0);
                return (
                    <Stack direction="row" alignItems="center" spacing={2}
                        sx={{
                            mt: 'auto', px: 1.4, py: 1,
                            borderTop: '1px solid rgba(122,200,220,0.18)',
                            bgcolor: 'rgba(122,223,255,0.04)',
                        }}>
                        <Stack spacing={0.1}>
                            <Typography sx={{ fontFamily: FONT_DISPLAY, color: 'rgba(202,232,255,0.5)', fontSize: 11, fontWeight: 700, letterSpacing: 1.4, textTransform: 'uppercase' }}>Players</Typography>
                            <Typography sx={{ fontFamily: FONT_MONO, color: '#dff5ff', fontSize: 14, fontWeight: 600, fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>{listed.length}</Typography>
                        </Stack>
                        <Stack spacing={0.1}>
                            <Typography sx={{ fontFamily: FONT_DISPLAY, color: 'rgba(202,232,255,0.5)', fontSize: 11, fontWeight: 700, letterSpacing: 1.4, textTransform: 'uppercase' }}>Hands</Typography>
                            <Typography sx={{ fontFamily: FONT_MONO, color: '#dff5ff', fontSize: 14, fontWeight: 600, fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>{totHands}</Typography>
                        </Stack>
                        <Stack spacing={0.1}>
                            <Typography sx={{ fontFamily: FONT_DISPLAY, color: 'rgba(202,232,255,0.5)', fontSize: 11, fontWeight: 700, letterSpacing: 1.4, textTransform: 'uppercase' }}>Σ Wager</Typography>
                            <Typography sx={{ fontFamily: FONT_MONO, color: '#dff5ff', fontSize: 14, fontWeight: 600, fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>{fmtCurrency(totWager)}</Typography>
                        </Stack>
                        <Box sx={{ flex: 1 }} />
                        <Stack spacing={0.1} sx={{ alignItems: 'flex-end' }}>
                            <Typography sx={{ fontFamily: FONT_DISPLAY, color: 'rgba(202,232,255,0.5)', fontSize: 11, fontWeight: 700, letterSpacing: 1.4, textTransform: 'uppercase' }}>Σ Casino W/L</Typography>
                            <Typography sx={{ color: colorForWin(totWin), fontSize: 15, fontWeight: 800, fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>{fmtCurrency(totWin)}</Typography>
                        </Stack>
                    </Stack>
                );
            })()}
        </Box>
    );
}
