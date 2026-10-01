// The selected date's 7 transitions under the floor map: changes (bar) with
// the minimum possible marked, so "at the minimum" reads at a glance.
// Click one to move the timeline to that core hour.

import React from 'react';
import { Box, ButtonBase, Stack, Typography } from '@mui/material';
import { CORE_HOURS, blockLabel, firstCore, lastCore } from '../../utils/autoplan/core';
import { AP, F, two } from './apStyles';

export default function ChangeStrip({ report, core, onCore, date, dayLabel }) {
    if (!report) return null;
    const max = Math.max(1, ...CORE_HOURS.map((c) => (report[c] ? Math.max(report[c].changes.length, report[c].lb) : 0)));
    return (
        <Box sx={{ mb: 1.5 }}>
            <Stack direction="row" sx={{ alignItems: 'baseline', gap: 1.2, mb: 0.8 }}>
                <Box sx={{ width: 4, height: 18, borderRadius: 1, bgcolor: AP.accent, alignSelf: 'center' }} />
                <Typography sx={{ color: '#fff', fontSize: F.summary.title - 3, fontWeight: 800 }}>Changes between core hours</Typography>
                <Typography sx={{ color: AP.faint, fontSize: 13 }}>{date} · {dayLabel} · bar = changes, tick = minimum possible</Typography>
            </Stack>
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'repeat(2, minmax(0,1fr))', md: `repeat(${Math.min(CORE_HOURS.length, 8)}, minmax(0,1fr))` }, gap: 0.8 }} role="group" aria-label="Transitions">
                {CORE_HOURS.map((c) => {
                    const r = report[c];
                    if (!r) return null;
                    const n = r.changes.length, on = c === core, atMin = n === r.lb, first = c === firstCore();
                    return (
                        <ButtonBase key={c} onClick={() => onCore(c)} aria-pressed={on} aria-label={`${first ? `Previous day ${two(lastCore())}:00` : r.from} to ${two(c)}:00, ${n} changes, minimum ${r.lb}`}
                            sx={{ display: 'block', textAlign: 'left', p: 1, borderRadius: 1.5, border: `1px solid ${on ? AP.accent : AP.lineSoft}`, bgcolor: on ? 'rgba(122,223,255,0.08)' : 'rgba(255,255,255,0.03)', '&.Mui-focusVisible': { outline: `2px solid ${AP.accent}` } }}>
                            <Typography component="span" sx={{ display: 'block', fontSize: 13, fontWeight: 800, color: AP.text }}>
                                {first ? `${two(lastCore())}→${two(c)}` : `${r.from.slice(0, 2)}→${two(c)}`} <Box component="span" sx={{ color: AP.faint, fontWeight: 600, fontSize: 11 }}>{first ? 'overnight' : blockLabel(c)}</Box>
                            </Typography>
                            <Typography component="span" sx={{ display: 'block', fontSize: 24, fontWeight: 800, color: first || atMin ? '#fff' : AP.warn, fontVariantNumeric: 'tabular-nums', lineHeight: 1.2 }}>{n}</Typography>
                            <Box sx={{ position: 'relative', height: 6, borderRadius: 1, bgcolor: 'rgba(255,255,255,0.07)', mt: 0.4 }}>
                                <Box sx={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${(n / max) * 100}%`, borderRadius: 1, bgcolor: first ? AP.muted : (atMin ? AP.accent : AP.warn) }} />
                                <Box aria-hidden="true" sx={{ position: 'absolute', top: -3, bottom: -3, width: 2, left: `calc(${(r.lb / max) * 100}% - 1px)`, bgcolor: '#fff' }} />
                            </Box>
                            <Typography component="span" sx={{ display: 'block', fontSize: 11.5, color: first ? AP.faint : (atMin ? AP.ok : AP.faint), mt: 0.4 }}>
                                {first ? 'leans to last night · not minimised' : `min ${r.lb}${atMin ? ' · at the minimum' : ` · +${n - r.lb} over`}`}
                            </Typography>
                        </ButtonBase>
                    );
                })}
            </Box>
        </Box>
    );
}
