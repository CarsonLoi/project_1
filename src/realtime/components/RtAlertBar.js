// Surveillance alert strip.
// =========================
// One always-visible line directly under the control panel. This is the
// "tell me where to look" surface — the reason the dashboard exists —
// so it sits above the fold and never collapses to zero height.
//
// Rule labels are rendered as TEXT, not colour alone (WCAG: never
// convey meaning by colour only). The colour is reinforcement for a
// glance from across the room; the label is what makes it readable.

import React from 'react';
import { Box, Stack, Typography, Chip, Tooltip } from '@mui/material';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import { ALERT_STRIP_MAX } from '../constants/rtConfig';
import { STATE, TEXT, RULE_COLOR, TYPE, systemLabel } from '../constants/rtTheme';
// Design-review fix: this pairing was WarningAmber (filled) + an
// Outlined checkmark — a filled/outline mismatch on the two states of
// the same indicator. Both filled now. RULE_COLOR/STATE also replace
// the four ad-hoc reds this file used to define locally.

export default function RtAlertBar({ alerts = [], onSelect, selectedId = null }) {
    const shown = alerts.slice(0, ALERT_STRIP_MAX);
    const overflow = alerts.length - shown.length;
    const clear = alerts.length === 0;

    return (
        <Box
            role="region"
            aria-label="Surveillance alerts"
            sx={{
                flex: '1 1 420px', minWidth: 0, px: 1.2, py: 0.75,
                borderRadius: 2,
                border: `1px solid ${clear ? STATE.positiveBorder : STATE.negativeBorder}`,
                bgcolor: clear ? STATE.positiveBg : STATE.negativeBg,
                display: 'flex', alignItems: 'center', gap: 1.2,
                minHeight: 40,
            }}
        >
            <Stack direction="row" spacing={0.7} sx={{ alignItems: 'center', flexShrink: 0 }}>
                {clear
                    ? <CheckCircleIcon sx={{ fontSize: 17, color: STATE.positive }} />
                    : <WarningAmberIcon sx={{ fontSize: 17, color: STATE.negative }} />}
                <Typography sx={{
                    fontSize: TYPE.body, fontWeight: 800, letterSpacing: 0.6,
                    color: clear ? STATE.positive : STATE.negative, whiteSpace: 'nowrap',
                    fontVariantNumeric: 'tabular-nums',
                }}>
                    {clear ? 'ALL CLEAR' : `${alerts.length} ALERT${alerts.length === 1 ? '' : 'S'}`}
                </Typography>
            </Stack>

            {clear ? (
                // TEXT.muted (0.62, verified 5.77:1) — was previously
                // 0.45 here, which the same measurement method puts at
                // ~3.8:1, under the 4.5:1 line.
                <Typography sx={{ fontSize: TYPE.label, color: TEXT.muted }}>
                    No tables or patrons breaching thresholds.
                </Typography>
            ) : (
                <Box sx={{
                    display: 'flex', alignItems: 'center', gap: 0.8, overflowX: 'auto', flex: 1, minWidth: 0,
                    scrollbarWidth: 'thin', scrollbarColor: `${STATE.negativeBorder} transparent`,
                    '&::-webkit-scrollbar': { height: 5 },
                    '&::-webkit-scrollbar-thumb': { bgcolor: STATE.negativeBorder, borderRadius: 3 },
                }}>
                    {shown.map((a) => {
                        const c = RULE_COLOR[a.rule] || '#ff7a7a';
                        const active = selectedId === a.id;
                        return (
                            <Tooltip key={a.id} title={`${a.label} · ${a.headline} — ${a.detail}`} disableInteractive>
                                <Stack
                                    direction="row" spacing={0.7}
                                    onClick={() => onSelect && onSelect(a)}
                                    role="button"
                                    tabIndex={0}
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect && onSelect(a); }
                                    }}
                                    sx={{
                                        alignItems: 'center', flexShrink: 0, px: 1, py: 0.5, borderRadius: 1,
                                        cursor: onSelect ? 'pointer' : 'default',
                                        border: `1px solid ${active ? c : 'transparent'}`,
                                        bgcolor: active ? `${c}22` : 'rgba(255,255,255,0.04)',
                                        transition: 'background-color 140ms, border-color 140ms',
                                        '&:hover': { bgcolor: `${c}1f` },
                                        '&:focus-visible': { outline: `2px solid ${c}`, outlineOffset: 2 },
                                    }}
                                >
                                    <Typography sx={{ ...systemLabel, fontSize: TYPE.caption, letterSpacing: 0.5, color: c, whiteSpace: 'nowrap' }}>
                                        {a.label}
                                    </Typography>
                                    <Typography sx={{
                                        fontSize: TYPE.label, color: TEXT.primary,
                                        fontWeight: 700, whiteSpace: 'nowrap',
                                    }}>
                                        {a.headline}
                                    </Typography>
                                    <Typography sx={{ fontSize: TYPE.label, color: TEXT.muted, whiteSpace: 'nowrap' }}>
                                        {a.detail}
                                    </Typography>
                                </Stack>
                            </Tooltip>
                        );
                    })}
                    {overflow > 0 && (
                        <Chip
                            size="small"
                            label={`+${overflow} more`}
                            sx={{
                                flexShrink: 0, height: 22, fontSize: TYPE.caption, fontWeight: 700,
                                bgcolor: 'rgba(255,255,255,0.07)', color: TEXT.muted,
                            }}
                        />
                    )}
                </Box>
            )}
        </Box>
    );
}
