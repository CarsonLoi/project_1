// Ranking preview — one sub-segment's tables in rank order for a day type and
// core hour: each signal's value and percentile, the blended score, and the
// price slot the rank alone would give (fewest changes and rules come first
// in the real solve).

import React, { useMemo, useState } from 'react';
import { Box, MenuItem, Select, Stack, Typography } from '@mui/material';
import { DAY_TYPES } from '../../utils/autoplan/core';
import { signalOf } from '../../utils/autoplan/config';
import { AP, inputSx, labelSx, selectMenuProps, tierLabel, two } from './apStyles';

const fmt = (m, v) => {
    if (m.metric === 'active_minutes' && m.per === 'open_minutes') return `${Math.round(v * 100)}%`;
    if (!Number.isFinite(v)) return '–';
    if (Math.abs(v) < 10) return v.toFixed(2);
    return Math.round(v).toLocaleString();
};
const nameOf = (m) => (signalOf(m) || { label: `${m.metric} ÷ ${m.per}` }).label;

export default function RankPreview({ breakdown, subs, coreHours, basis, mixFor, ladders, tierById, mix, defaultCore }) {
    const [sub, setSub] = useState(subs[0] || '');
    const [dt, setDt] = useState('sat');
    const [core, setCore] = useState(defaultCore ?? coreHours[0]);
    const s = subs.includes(sub) ? sub : subs[0] || '';
    const rows = useMemo(() => (s ? breakdown(dt, core, s) : []), [breakdown, dt, core, s]);
    // Rank slots: the target mix handed out from the top price down.
    const slots = useMemo(() => {
        const m = (mixFor(dt, core, s) || {}).map || {};
        const out = [];
        for (const id of [...(ladders[s] || [])].reverse()) for (let i = 0; i < (m[id] || 0); i++) out.push(id);
        return out;
    }, [mixFor, dt, core, s, ladders]);
    const sel = (value, onChange, label, options, width) => (
        <Select size="small" value={value} onChange={(e) => onChange(e.target.value)} MenuProps={selectMenuProps} sx={{ ...inputSx, minWidth: width }} inputProps={{ 'aria-label': label }}>
            {options.map(([v, l]) => <MenuItem key={v} value={v}>{l}</MenuItem>)}
        </Select>
    );
    const cell = { py: 0.45, px: 0.6, fontSize: 12.5, color: AP.text, borderBottom: `1px solid ${AP.lineSoft}`, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' };
    return (
        <Box sx={{ mt: 1, p: 1, borderRadius: 1.5, border: `1px solid ${AP.line}`, bgcolor: 'rgba(255,255,255,0.025)' }}>
            <Stack direction="row" sx={{ gap: 0.6, flexWrap: 'wrap', alignItems: 'center', mb: 1 }}>
                {sel(s, setSub, 'Preview sub-segment', subs.map((x) => [x, x]), 96)}
                {sel(dt, setDt, 'Preview day type', DAY_TYPES.map((d) => [d.id, d.label]), 110)}
                {basis === 'block'
                    ? sel(core, setCore, 'Preview core hour', coreHours.map((c) => [c, `${two(c)}:00`]), 90)
                    : <Typography sx={{ fontSize: 12, color: AP.faint }}>Whole day</Typography>}
            </Stack>
            {rows.length ? (
                <Box sx={{ maxHeight: 300, overflow: 'auto' }}>
                    <Box component="table" sx={{ width: '100%', borderCollapse: 'collapse' }}>
                        <thead>
                            <tr>
                                {['#', 'Table', ...mix.map(nameOf), 'Score', 'Rank slot'].map((h, i) => (
                                    <Box component="th" key={h + i} sx={{ ...labelSx, fontSize: 10, textAlign: i < 2 ? 'left' : 'right', p: 0.5, position: 'sticky', top: 0, bgcolor: AP.pop, borderBottom: `1px solid ${AP.line}` }}>{h}</Box>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {rows.map((r, i) => {
                                const slot = slots[i];
                                const t = slot ? tierById.get(slot) : null;
                                return (
                                    <tr key={r.key}>
                                        <Box component="td" sx={{ ...cell, color: AP.faint }}>{i + 1}</Box>
                                        <Box component="td" sx={{ ...cell, fontWeight: 800 }}>{r.key.replace('|', '')}</Box>
                                        {r.parts.map((p, j) => (
                                            <Box component="td" key={j} sx={{ ...cell, textAlign: 'right' }} title={`Percentile ${Math.round(p.pct * 100)} in ${s}`}>
                                                <Box component="span" sx={{ mr: 0.6 }}>{fmt(p, p.value)}</Box>
                                                <Box component="span" aria-hidden="true" sx={{ display: 'inline-block', verticalAlign: 'middle', width: 32, height: 5, borderRadius: 1, bgcolor: 'rgba(255,255,255,0.08)', position: 'relative', overflow: 'hidden' }}>
                                                    <Box component="span" sx={{ position: 'absolute', inset: 0, width: `${Math.round(p.pct * 100)}%`, bgcolor: AP.accent }} />
                                                </Box>
                                            </Box>
                                        ))}
                                        <Box component="td" sx={{ ...cell, textAlign: 'right', fontWeight: 800 }}>{Math.round(r.score * 100)}</Box>
                                        <Box component="td" sx={{ ...cell, textAlign: 'right' }}>
                                            {t ? (
                                                <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, fontWeight: 800 }}>
                                                    <Box component="span" sx={{ width: 9, height: 9, borderRadius: 0.4, bgcolor: t.color }} />{tierLabel(t)}
                                                </Box>
                                            ) : <Box component="span" sx={{ color: AP.faint }}>–</Box>}
                                        </Box>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </Box>
                </Box>
            ) : (
                <Typography sx={{ fontSize: 12.5, color: AP.faint, fontStyle: 'italic' }}>No performance data for this selection in the chosen history range.</Typography>
            )}
            <Typography sx={{ fontSize: 11.5, color: AP.faint, mt: 0.8 }}>
                Score = blended percentile (0–100). Rank slot = the price rank alone would give; rules, manual prices and fewest changes decide first.
            </Typography>
        </Box>
    );
}
