// PricingCompareView — variance between two pricing plans
// =======================================================
//
// Pricing's analogue of the scheduling Compare mode. Plan A is the BASE;
// Plan B is compared. Reuses the scheduling module's planDiff (assignments
// are table→id maps in both modules, so the diff + synthetic-status-shift
// map render identically) and adds pricing-specific rollups: priced-table
// counts, weighted-average minimum, and a per-tier count delta.

import React, { useMemo } from 'react';
import { Box, Stack, Typography, Select, MenuItem, Tooltip } from '@mui/material';
import EastIcon from '@mui/icons-material/East';
import DiffFloorMap from './DiffFloorMap';
import { liveFloorTables } from '../utils/floorConfig';
import { diffMapInputs, DIFF_SYNTHETIC_SHIFTS } from '../utils/planDiff';
import { formatMinimum } from '../constants/defaultTiers';
import { formatDaypartClock } from '../constants/defaultDayparts';
import { PRICING_FONTS } from '../constants/fontSizes';
import { readPrice } from '../utils/pricingModel';

const CV = PRICING_FONTS.compare;

// Resolve a { date, versionId } + daypart into that version's assignment
// map FOR THAT PERIOD (versions snapshot every daypart under byDaypart).
function resolvePlan(store, sel, daypartId) {
    if (!sel || !sel.date) return { version: null, assignments: {} };
    const plan = store.plans?.[sel.date] || null;
    const version = (plan?.versions || []).find((v) => v.versionId === sel.versionId) || null;
    return { version, assignments: version?.byDaypart?.[daypartId]?.assignments || {} };
}

// Collapse a (possibly ranged) assignment map to a table→baseTierId map —
// the variance diff + per-tier stats compare on the BASE (floor) minimum.
function baseMapOf(assignments) {
    const out = {};
    for (const [k, v] of Object.entries(assignments || {})) {
        const p = readPrice(v); if (p) out[k] = p.base;
    }
    return out;
}

// Weighted-average BASE minimum + priced count over a base-tier map.
function priceStats(baseMap, tierMap) {
    let total = 0, sumMin = 0;
    const counts = {};
    for (const tid of Object.values(baseMap || {})) {
        counts[tid] = (counts[tid] || 0) + 1;
        const t = tierMap.get(tid);
        if (t) { total += 1; sumMin += t.min; }
    }
    return { total, avgMin: total > 0 ? sumMin / total : 0, counts };
}

function PlanSelector({ label, accent, store, value, onChange, dates }) {
    const plan = value?.date ? store.plans?.[value.date] : null;
    const versions = useMemo(
        () => (plan?.versions || []).slice().sort((a, b) => (b.versionNumber || 0) - (a.versionNumber || 0)),
        [plan]
    );
    const selSx = {
        color: '#fff', fontSize: CV.head, fontWeight: 600,
        bgcolor: 'rgba(255,255,255,0.05)', borderRadius: 1, px: 1, py: 0.2,
        '& .MuiSelect-icon': { color: 'rgba(255,255,255,0.45)' },
        '&:before, &:after': { display: 'none' },
    };
    return (
        <Stack spacing={0.6} sx={{ minWidth: 220 }}>
            <Stack direction="row" alignItems="center" spacing={0.8}>
                <Box sx={{ width: 10, height: 10, borderRadius: '2px', bgcolor: accent }} />
                <Typography sx={{ color: 'rgba(255,255,255,0.7)', fontSize: CV.label, fontWeight: 800, letterSpacing: 0.6 }}>{label}</Typography>
            </Stack>
            <Stack direction="row" spacing={0.8}>
                <Select
                    value={value?.date || ''} displayEmpty variant="standard" disableUnderline
                    onChange={(e) => {
                        const date = e.target.value;
                        const vs = (store.plans?.[date]?.versions || []).slice().sort((a, b) => (b.versionNumber || 0) - (a.versionNumber || 0));
                        onChange({ date, versionId: vs[0]?.versionId || null });
                    }}
                    sx={{ ...selSx, flex: 1 }}
                >
                    <MenuItem value="" disabled sx={{ fontSize: CV.body }}>Pick date…</MenuItem>
                    {dates.map((d) => <MenuItem key={d} value={d} sx={{ fontSize: CV.body }}>{d}</MenuItem>)}
                </Select>
                <Select
                    value={value?.versionId || ''} displayEmpty variant="standard" disableUnderline
                    disabled={versions.length === 0}
                    onChange={(e) => onChange({ date: value.date, versionId: e.target.value })}
                    sx={{ ...selSx, width: 90 }}
                >
                    <MenuItem value="" disabled sx={{ fontSize: CV.body }}>ver…</MenuItem>
                    {versions.map((v) => <MenuItem key={v.versionId} value={v.versionId} sx={{ fontSize: CV.body }}>v{v.versionNumber}</MenuItem>)}
                </Select>
            </Stack>
        </Stack>
    );
}

function MetricTile({ label, aVal, bVal, fmt = (v) => v }) {
    const delta = (typeof aVal === 'number' && typeof bVal === 'number') ? bVal - aVal : null;
    return (
        <Box sx={{ flex: 1, minWidth: 0, p: 1.2, borderRadius: 1.4, bgcolor: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
            <Typography sx={{ color: 'rgba(255,255,255,0.55)', fontSize: CV.small, fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase' }}>{label}</Typography>
            <Stack direction="row" alignItems="baseline" spacing={1} sx={{ mt: 0.4 }}>
                <Typography sx={{ color: '#fff', fontSize: CV.metric, fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>{fmt(bVal)}</Typography>
                {delta != null && delta !== 0 && (
                    <Typography sx={{ color: delta > 0 ? '#9ece6a' : '#f7768e', fontSize: CV.body, fontWeight: 700 }}>
                        {delta > 0 ? '+' : ''}{fmt(delta)}
                    </Typography>
                )}
            </Stack>
            <Typography sx={{ color: 'rgba(255,255,255,0.4)', fontSize: CV.small, mt: 0.2 }}>base A: {fmt(aVal)}</Typography>
        </Box>
    );
}

export default function PricingCompareView({ store, tiers, dayparts = [], planA, planB, setPlanA, setPlanB }) {
    const dates = useMemo(() => Object.keys(store.plans || {}).sort(), [store.plans]);
    const tierMap = useMemo(() => new Map((tiers || []).map((t) => [t.id, t])), [tiers]);

    // Which pricing period the variance is computed for.
    const [daypartId, setDaypartId] = React.useState(dayparts[0]?.id || null);
    React.useEffect(() => {
        if (dayparts.length && !dayparts.some((d) => d.id === daypartId)) setDaypartId(dayparts[0].id);
    }, [dayparts, daypartId]);

    const A = useMemo(() => resolvePlan(store, planA, daypartId), [store, planA, daypartId]);
    const B = useMemo(() => resolvePlan(store, planB, daypartId), [store, planB, daypartId]);
    const ready = !!A.version && !!B.version;

    const tables = useMemo(() => (planA?.date ? liveFloorTables(planA.date) : []), [planA?.date]);
    // Compare on the BASE (floor) minimum of each plan.
    const baseA = useMemo(() => baseMapOf(A.assignments), [A.assignments]);
    const baseB = useMemo(() => baseMapOf(B.assignments), [B.assignments]);
    const diff = useMemo(() => diffMapInputs(baseA, baseB), [baseA, baseB]);

    const statsA = useMemo(() => priceStats(baseA, tierMap), [baseA, tierMap]);
    const statsB = useMemo(() => priceStats(baseB, tierMap), [baseB, tierMap]);

    return (
        <Box>
            <Stack direction="row" alignItems="flex-end" spacing={2}
                sx={{ p: 1.4, mb: 1.2, borderRadius: 1.6, bgcolor: 'rgba(8, 22, 36, 0.55)', border: '1px solid rgba(122, 200, 220, 0.18)' }}>
                <PlanSelector label="PLAN A — BASE" accent="#7adfff" store={store} dates={dates} value={planA} onChange={setPlanA} />
                <EastIcon sx={{ color: 'rgba(255,255,255,0.4)', mb: 0.6 }} />
                <PlanSelector label="PLAN B — COMPARE" accent="#e0af68" store={store} dates={dates} value={planB} onChange={setPlanB} />
                {dayparts.length > 0 && (
                    <Stack spacing={0.6}>
                        <Typography sx={{ color: 'rgba(255,255,255,0.7)', fontSize: CV.label, fontWeight: 800, letterSpacing: 0.6 }}>PERIOD</Typography>
                        <Stack direction="row" sx={{ border: '1px solid rgba(122,200,220,0.25)', borderRadius: 1.2, overflow: 'hidden' }}>
                            {dayparts.map((dp) => {
                                const active = dp.id === daypartId;
                                return (
                                    <Box key={dp.id} onClick={() => setDaypartId(dp.id)}
                                        sx={{
                                            px: 1.2, py: 0.5, cursor: 'pointer', fontSize: CV.body, fontWeight: 700,
                                            borderRight: '1px solid rgba(122,200,220,0.18)', '&:last-of-type': { borderRight: 'none' },
                                            bgcolor: active ? '#7adfff' : 'transparent', color: active ? '#0a1a2c' : 'rgba(255,255,255,0.65)',
                                            '&:hover': active ? undefined : { bgcolor: 'rgba(122,223,255,0.08)' },
                                        }}>
                                        <Tooltip title={formatDaypartClock(dp)}><span>{dp.label}</span></Tooltip>
                                    </Box>
                                );
                            })}
                        </Stack>
                    </Stack>
                )}
                <Box sx={{ flex: 1 }} />
                {ready && (
                    <Typography sx={{ color: 'rgba(255,255,255,0.6)', fontSize: CV.body, mb: 0.6 }}>
                        <b style={{ color: '#fff' }}>{diff.differing}</b> of {diff.touched} tables differ
                    </Typography>
                )}
            </Stack>

            {!ready ? (
                <Box sx={{ minHeight: 360, borderRadius: 2, border: '1px dashed rgba(255,255,255,0.14)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <Typography sx={{ color: 'rgba(255,255,255,0.45)', fontSize: CV.empty, fontStyle: 'italic' }}>
                        Pick a date and version for both Plan A and Plan B to see the variance.
                    </Typography>
                </Box>
            ) : (
                <>
                    <Box sx={{ position: 'relative', borderRadius: 2, overflow: 'hidden', bgcolor: 'rgba(22, 24, 38, 0.9)', border: '1px solid rgba(255,255,255,0.06)', height: 520 }}>
                        <DiffFloorMap
                            tables={tables} assignments={diff.assignments} shifts={diff.shifts}
                        />
                        <Stack direction="row" spacing={1.2}
                            sx={{ position: 'absolute', left: 12, bottom: 12, px: 1.2, py: 0.8, borderRadius: 1.2, bgcolor: 'rgba(10,22,35,0.85)', backdropFilter: 'blur(4px)', border: '1px solid rgba(122,200,220,0.2)' }}>
                            {DIFF_SYNTHETIC_SHIFTS.map((s) => (
                                <Stack key={s.id} direction="row" alignItems="center" spacing={0.5}>
                                    <Box sx={{ width: 11, height: 11, borderRadius: '2px', bgcolor: s.color }} />
                                    <Typography sx={{ color: 'rgba(255,255,255,0.8)', fontSize: CV.label, fontWeight: 700 }}>{s.name}</Typography>
                                    <Typography sx={{ color: '#fff', fontSize: CV.label, fontWeight: 800 }}>{diff.counts[s.id] || 0}</Typography>
                                </Stack>
                            ))}
                        </Stack>
                    </Box>

                    <Stack direction="row" spacing={1.2} sx={{ mt: 1.2 }}>
                        <MetricTile label="Priced tables" aVal={statsA.total} bVal={statsB.total} />
                        <MetricTile label="Weighted-avg minimum" aVal={Math.round(statsA.avgMin)} bVal={Math.round(statsB.avgMin)} fmt={formatMinimum} />
                        <MetricTile label="Tables changed" aVal={0} bVal={diff.differing} />
                    </Stack>

                    {/* Per-tier count delta */}
                    <Box sx={{ mt: 1.2, p: 1.4, borderRadius: 1.6, bgcolor: 'rgba(8, 22, 36, 0.55)', border: '1px solid rgba(122, 200, 220, 0.18)' }}>
                        <Typography sx={{ color: '#dff5ff', fontSize: CV.head, fontWeight: 800, mb: 1 }}>Per-tier change (B − A)</Typography>
                        <Box component="table" sx={{ width: '100%', borderCollapse: 'collapse', fontVariantNumeric: 'tabular-nums' }}>
                            <Box component="thead">
                                <Box component="tr">
                                    {['Minimum', 'A', 'B', 'Δ'].map((h, i) => (
                                        <Box component="th" key={h} sx={{ color: 'rgba(255,255,255,0.5)', fontSize: CV.label, fontWeight: 700, textAlign: i === 0 ? 'left' : 'right', py: 0.6, px: 1, borderBottom: '1px solid rgba(255,255,255,0.08)' }}>{h}</Box>
                                    ))}
                                </Box>
                            </Box>
                            <Box component="tbody">
                                {tiers.map((t) => {
                                    const a = statsA.counts[t.id] || 0;
                                    const b = statsB.counts[t.id] || 0;
                                    const d = b - a;
                                    if (a === 0 && b === 0) return null;
                                    return (
                                        <Box component="tr" key={t.id}>
                                            <Box component="td" sx={{ py: 0.6, px: 1, borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                                                <Stack direction="row" alignItems="center" spacing={0.8}>
                                                    <Box sx={{ width: 10, height: 10, borderRadius: '2px', bgcolor: t.color }} />
                                                    <Typography sx={{ color: '#fff', fontSize: CV.body, fontWeight: 600 }}>{t.label || formatMinimum(t.min)}</Typography>
                                                </Stack>
                                            </Box>
                                            <Box component="td" sx={{ py: 0.6, px: 1, textAlign: 'right', color: 'rgba(255,255,255,0.7)', fontSize: CV.body, borderBottom: '1px solid rgba(255,255,255,0.04)' }}>{a}</Box>
                                            <Box component="td" sx={{ py: 0.6, px: 1, textAlign: 'right', color: '#fff', fontSize: CV.body, borderBottom: '1px solid rgba(255,255,255,0.04)' }}>{b}</Box>
                                            <Box component="td" sx={{ py: 0.6, px: 1, textAlign: 'right', fontSize: CV.body, fontWeight: 800, color: d > 0 ? '#9ece6a' : d < 0 ? '#f7768e' : 'rgba(255,255,255,0.4)', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>{d > 0 ? '+' : ''}{d}</Box>
                                        </Box>
                                    );
                                })}
                            </Box>
                        </Box>
                    </Box>
                </>
            )}
        </Box>
    );
}
