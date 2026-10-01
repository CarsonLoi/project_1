# Player 360 Summary-first Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put a 10-second summary (verdict, four visual fact tiles, one "bet rate by edge" chart, option strip) on top of the Player 360 and move all detail into one collapsed Investigate section.

**Architecture:** Three pure helpers join the model (`worstState`, key-option `defaultOption`, `headlineFor`, `edgeProfile`). Five small components (`SummaryPanel`, `FactTiles`, `EdgeProfileChart`, `OptionStrip`, `TestMatrix`) render the summary and audit trail; `RtPatron360` is re-laid-out around them; the heatmap/curves/trend board are reused unchanged inside a `Collapse`.

**Tech Stack:** React 19, MUI v9 (Stack alignment in `sx`, Dialog `slots`/`slotProps`), ECharts 6, CRA Jest.

Spec: `docs/superpowers/specs/2026-09-26-patron-360-summary-first-design.md`

## Global Constraints

- Minimal words: labels ≤ 3 words, headline ≤ 7 words; explanations go in tooltips (`title`).
- State is never colour alone: every state shows a glyph (▲ flag, ◆ watch, ✓ clear) or text.
- Money in the 360 is patron perspective (+ = patron won).
- Text contrast ≥ 4.5:1 (use `TEXT.primary/secondary/muted/faint` only for text).
- No page-level horizontal scroll at 800 / 1280 / 1680 px.
- Do not commit. Tests: `$env:CI='true'; npx react-scripts test --watchAll=false src/realtime`.

## Files

| File | Change |
|---|---|
| `src/realtime/utils/patron360.js` | add `worstState`, `headlineFor`, `edgeProfile`; `defaultOption` → key option |
| `src/realtime/utils/__tests__/patron360.test.js` | new tests |
| `src/realtime/components/patron360/format.js` | add `STATE_GLYPH`, `bandTick`, `panelSx`, `raisedSx` |
| `…/patron360/FactTiles.js` | create |
| `…/patron360/EdgeProfileChart.js` | create |
| `…/patron360/OptionStrip.js` | create |
| `…/patron360/SummaryPanel.js` | create |
| `…/patron360/TestMatrix.js` | create |
| `…/patron360/ShoeHeatmap.js` | legend: numeric ticks, won/lost/not-seated icons |
| `…/patron360/RtPatron360.js` | rewrite layout |
| `…/patron360/AdvantageTable.js`, `OptionChips.js` | delete |

---

### Task 1: Model helpers

**Interfaces — Produces:** `worstState(row) → 'flag'|'watch'|'clear'|'insufficient'`; `defaultOption(rows) → code` (most flags → most watches → side first → most turnover, among rows with bets; `'BANKER'` if empty); `headlineFor(verdict, row) → string`; `edgeProfile(views, code, bands[{gte?,lt?}]) → { bands:[{hands,bets,wager,rate,avgBet}], hands, bets, rate }`.

- [ ] **Step 1: Failing test** — in `patron360.test.js` change the import to

```js
import {
    currentGamingDate, rangeFor, normalizeBets, normalizeShoeEdges, buildShoeViews, inWindow,
    optionShoeStats, optionEvidence, evidenceFor, verdictFrom, defaultOption, heatmapRows, buildPatron360,
    worstState, headlineFor, edgeProfile,
} from '../patron360';
```

and append:

```js
describe('summary helpers', () => {
    const vs = () => views(shoe('S1', 40, 11, 20), counterBets());

    it('reports the worst test state of a row', () => {
        const rows = evidenceFor(vs());
        expect(worstState(rows.find((r) => r.code === 'SL7'))).toBe('flag');
        expect(worstState(rows.find((r) => r.code === 'BANKER'))).toBe('insufficient');
    });

    it('picks the option with the most flags, not the most money', () => {
        const bets = [...counterBets(), ...Array.from({ length: 20 }, (_, i) => betRow('S1', i + 2, 'TIE', 5000))];
        const rows = evidenceFor(views(shoe('S1', 40, 11, 20), bets));
        expect(rows[0].code).toBe('TIE');
        expect(defaultOption(rows)).toBe('SL7');
    });

    it('writes a short headline from the strongest test', () => {
        const row = (states) => ({
            code: 'BD',
            tests: Object.fromEntries(['entry', 'ramp', 'money', 'luck'].map((id) => [id, { state: states[id] || 'clear' }])),
        });
        expect(headlineFor({ level: 'ACTION' }, row({ ramp: 'flag', entry: 'watch' }))).toBe('BD bets grow on the negative edge');
        expect(headlineFor({ level: 'ACTION' }, row({ entry: 'flag', ramp: 'flag' }))).toBe('BD bets follow the negative edge');
        expect(headlineFor({ level: 'ACTION' }, row({ money: 'flag' }))).toBe('BD money piles onto the negative edge');
        expect(headlineFor({ level: 'WATCH' }, row({ luck: 'watch' }))).toBe('BD winning beyond chance');
        expect(headlineFor({ level: 'CLEAR' }, row({}))).toBe('No edge-timed betting');
        expect(headlineFor({ level: 'NO DATA' }, null)).toBe('Too few bets to judge');
    });

    it('profiles the bet rate per edge band over seated hands', () => {
        const p = edgeProfile(vs(), 'SL7', [{ lt: 0 }, { gte: 0 }]);
        expect(p.bands[0]).toMatchObject({ hands: 10, bets: 8, rate: 0.8, avgBet: 500 });
        expect(p.bands[1]).toMatchObject({ hands: 30, bets: 5, avgBet: 100 });
        expect(p.bands[1].rate).toBeCloseTo(5 / 30, 9);
        expect(p.rate).toBeCloseTo(13 / 40, 9);
        expect(edgeProfile([], 'SL7', [{ lt: 0 }]).rate).toBeNull();
    });
});
```

- [ ] **Step 2: Run — expect FAIL** (`worstState is not a function`).

- [ ] **Step 3: Implement** — in `patron360.js` replace the whole `defaultOption` function with:

```js
const STATE_RANK = { insufficient: 0, clear: 1, watch: 2, flag: 3 };

export function worstState(row) {
    let s = 'insufficient';
    for (const t of Object.values(row.tests)) if (STATE_RANK[t.state] > STATE_RANK[s]) s = t.state;
    return s;
}

// The option that drives the verdict: most flags, then most watches, side
// bets before main bets, then most money. Only options with bets count.
export function defaultOption(rows) {
    const pool = rows.filter((r) => r.bets > 0);
    const list = pool.length ? pool : rows;
    if (!list.length) return 'BANKER';
    const score = (r) => {
        let s = r.side ? 1 : 0;
        for (const t of Object.values(r.tests)) s += t.state === 'flag' ? 100 : t.state === 'watch' ? 10 : 0;
        return s;
    };
    return [...list].sort((a, b) => (score(b) - score(a)) || (b.turnover - a.turnover))[0].code;
}

const HEADLINE = {
    entry: (c) => `${c} bets follow the negative edge`,
    ramp: (c) => `${c} bets grow on the negative edge`,
    money: (c) => `${c} money piles onto the negative edge`,
    luck: (c) => `${c} winning beyond chance`,
};

// ≤ 7 words: the strongest finding for the option under review.
export function headlineFor(verdict, row) {
    if (!row || !verdict || verdict.level === 'NO DATA') return 'Too few bets to judge';
    for (const state of ['flag', 'watch']) {
        for (const id of ['entry', 'ramp', 'money', 'luck']) {
            if (row.tests[id] && row.tests[id].state === state) return HEADLINE[id](row.code);
        }
    }
    return 'No edge-timed betting';
}

// Bet rate per edge band for one option over every seated hand with a
// known edge. `bands` are `{ gte?, lt? }` ranges (see format.edgeBands).
export function edgeProfile(views, code, bands) {
    const acc = bands.map(() => ({ hands: 0, bets: 0, wager: 0 }));
    const inBand = (b, e) => (b.gte == null || e >= b.gte) && (b.lt == null || e < b.lt);
    let hands = 0, bets = 0;
    for (const v of views) {
        for (const h of v.hands) {
            if (!inWindow(v, h.handNo)) continue;
            const e = h.edge[code];
            if (e == null) continue;
            const i = bands.findIndex((b) => inBand(b, e));
            if (i === -1) continue;
            acc[i].hands += 1; hands += 1;
            const c = cellFor(v, h.handNo, code);
            if (c) { acc[i].bets += 1; acc[i].wager += c.wager; bets += 1; }
        }
    }
    return {
        bands: acc.map((b) => ({ ...b, rate: b.hands ? b.bets / b.hands : null, avgBet: b.bets ? b.wager / b.bets : null })),
        hands, bets, rate: hands ? bets / hands : null,
    };
}
```

- [ ] **Step 4: Run — expect PASS** (all realtime tests).

---

### Task 2: Formatters and summary components

**Interfaces — Consumes:** Task 1 helpers; `TEST_META`, `OPTION_BY_CODE`; `useEChart`. **Produces:** `STATE_GLYPH`, `bandTick(band)`, `panelSx`, `raisedSx` (format.js); `<FactTiles row />`, `<EdgeProfileChart views code />` + `<ProfileLegend />`, `<OptionStrip rows value onChange />`, `<SummaryPanel model code onOption />`, `<TestMatrix rows selected onSelect />`.

- [ ] **Step 1: format.js** — change the theme import to `import { STATE, TEXT, SURFACE } from '../../constants/rtTheme';` and append:

```js
// State glyphs so a state never depends on colour alone.
export const STATE_GLYPH = { flag: '▲', watch: '◆', clear: '✓', insufficient: '' };

export const panelSx = { borderRadius: 2, border: `1px solid ${SURFACE.panelBorder}`, bgcolor: SURFACE.panel, p: 1.75, minWidth: 0 };
export const raisedSx = { ...panelSx, border: `1px solid ${SURFACE.raisedBorder}`, bgcolor: SURFACE.raised };

// Short axis/legend label for an edge band: "< −4.9%", "0–7.4%", "≥ 14.8%".
export function bandTick(b) {
    const n = (v) => `${v < 0 ? '−' : ''}${Math.abs(v).toFixed(1).replace(/\.0$/, '')}`;
    if (b.gte == null) return `< ${n(b.lt)}%`;
    if (b.lt == null) return `≥ ${n(b.gte)}%`;
    return `${n(b.gte)}–${n(b.lt)}%`;
}
```

- [ ] **Step 2: Create `FactTiles.js`:**

```js
// Four evidence tiles for the option under review. Each test is a pair of
// bars — the suspicious side against the normal side — with the test
// value in a state badge. No sentences.

import React from 'react';
import { Box, Stack, Typography } from '@mui/material';
import { TEXT, systemLabel } from '../../constants/rtTheme';
import { TEST_META } from '../../utils/patron360';
import { EDGE_COLORS, STATE_GLYPH, STATE_STYLE, formatTestValue, money, plain, share, signColor } from './format';

const OTHER = '#5b6690';

function PairBars({ rows }) {
    const max = Math.max(1e-9, ...rows.map((r) => Math.abs(r.value || 0)));
    return (
        <Stack spacing={0.9}>
            {rows.map((r) => (
                <Box key={r.label} sx={{ display: 'grid', gridTemplateColumns: '54px minmax(0, 1fr) auto', alignItems: 'center', columnGap: 1 }}>
                    <Typography sx={{ fontSize: 12, fontWeight: 700, color: TEXT.muted }}>{r.label}</Typography>
                    <Box sx={{ height: 12, borderRadius: 1, bgcolor: 'rgba(255,255,255,0.05)', overflow: 'hidden' }}>
                        <Box sx={{
                            width: `${Math.max(2, (Math.abs(r.value || 0) / max) * 100)}%`, height: '100%', borderRadius: 1, bgcolor: r.color,
                            transition: 'width 300ms ease-out', '@media (prefers-reduced-motion: reduce)': { transition: 'none' },
                        }} />
                    </Box>
                    <Typography sx={{ minWidth: 62, textAlign: 'right', fontSize: 15, fontWeight: 800, color: r.textColor || TEXT.primary, fontVariantNumeric: 'tabular-nums' }}>
                        {r.text}
                    </Typography>
                </Box>
            ))}
        </Stack>
    );
}

function Tile({ label, hint, test, unit, children }) {
    const s = STATE_STYLE[test.state];
    const none = test.state === 'insufficient';
    return (
        <Box title={hint} sx={{
            p: 1.5, minWidth: 0, borderRadius: 1.5, bgcolor: 'rgba(255,255,255,0.035)',
            border: '1px solid rgba(255,255,255,0.08)', borderTop: `3px solid ${s.color}`,
        }}>
            <Stack direction="row" sx={{ alignItems: 'center', gap: 1, mb: 1.25 }}>
                <Typography sx={systemLabel}>{label}</Typography>
                <Box sx={{ flex: 1 }} />
                <Box sx={{
                    px: 0.9, py: 0.2, borderRadius: 1, border: `1px solid ${s.color}`, bgcolor: s.bg,
                    color: none ? TEXT.muted : s.color, fontSize: 12, fontWeight: 900, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap',
                }}>
                    {none ? 'NO DATA' : `${STATE_GLYPH[test.state]} ${formatTestValue(unit, test.value)}`}
                </Box>
            </Stack>
            {children}
        </Box>
    );
}

export default function FactTiles({ row }) {
    const t = row.tests;
    const hands = row.negHands + row.posHands;
    const avgNeg = row.negBets ? row.negMoney / row.negBets : null;
    const avgPos = row.posBets ? row.posMoney / row.posBets : null;
    const moneyShare = row.turnover ? row.negMoney / row.turnover : null;
    const handShare = hands ? row.negHands / hands : null;
    return (
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))' }, gap: 1.25 }}>
            <Tile label="Bet rate" hint={TEST_META.entry.question} test={t.entry} unit={TEST_META.entry.unit}>
                <PairBars rows={[
                    { label: '−edge', value: row.rateNeg, text: share(row.rateNeg), color: EDGE_COLORS.player },
                    { label: 'other', value: row.ratePos, text: share(row.ratePos), color: OTHER },
                ]} />
            </Tile>
            <Tile label="Avg bet" hint={TEST_META.ramp.question} test={t.ramp} unit={TEST_META.ramp.unit}>
                <PairBars rows={[
                    { label: '−edge', value: avgNeg, text: plain(avgNeg), color: EDGE_COLORS.player },
                    { label: 'other', value: avgPos, text: plain(avgPos), color: OTHER },
                ]} />
            </Tile>
            <Tile label="On −edge" hint={TEST_META.money.question} test={t.money} unit={TEST_META.money.unit}>
                <PairBars rows={[
                    { label: 'money', value: moneyShare, text: share(moneyShare), color: EDGE_COLORS.player },
                    { label: 'hands', value: handShare, text: share(handShare), color: OTHER },
                ]} />
            </Tile>
            <Tile label="Result" hint={TEST_META.luck.question} test={t.luck} unit={TEST_META.luck.unit}>
                <PairBars rows={[
                    { label: 'actual', value: row.result, text: money(row.result), color: signColor(row.result), textColor: signColor(row.result) },
                    { label: 'theo', value: row.theo, text: money(row.theo), color: OTHER },
                ]} />
            </Tile>
        </Box>
    );
}
```

- [ ] **Step 3: Create `EdgeProfileChart.js`:**

```js
// Bet rate by edge — every shoe in the range pooled into one picture for
// the option under review. Bars = share of seated hands in each edge band
// where the patron bet it (band colours match the heatmap); dashed line =
// their overall rate, i.e. random betting; gold = average bet per band.
// Flat reads normal; a staircase on the magenta side reads advantage.

import React, { useMemo } from 'react';
import { Box, Stack, Typography } from '@mui/material';
import { TEXT } from '../../constants/rtTheme';
import { OPTION_BY_CODE, edgeProfile } from '../../utils/patron360';
import useEChart from './useEChart';
import { EDGE_COLORS, bandTick, edgeBands, plain } from './format';

const AVG = '#f2c14e';

export function ProfileLegend() {
    const item = (mark, text) => (
        <Stack direction="row" spacing={0.6} sx={{ alignItems: 'center' }}>
            {mark}
            <Typography sx={{ fontSize: 12, color: TEXT.muted }}>{text}</Typography>
        </Stack>
    );
    return (
        <Stack direction="row" spacing={1.75} sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 0.5 }}>
            {item(<Box sx={{ width: 10, height: 12, borderRadius: 0.5, bgcolor: EDGE_COLORS.player }} />, 'bet rate')}
            {item(<Box sx={{ width: 16, borderTop: '2px dashed rgba(255,255,255,0.6)' }} />, 'overall')}
            {item(<Box sx={{ width: 9, height: 9, borderRadius: '50%', bgcolor: AVG }} />, 'avg bet')}
        </Stack>
    );
}

export default function EdgeProfileChart({ views, code }) {
    const theo = (OPTION_BY_CODE.get(code) || { theo: 1 }).theo;
    const { option, empty } = useMemo(() => {
        const bands = edgeBands(theo);
        const p = edgeProfile(views, code, bands);
        const pct = (v) => (v == null ? null : +(v * 100).toFixed(1));
        const overall = pct(p.rate);
        return {
            empty: !p.hands,
            option: {
                backgroundColor: 'transparent',
                animation: false,
                grid: { left: 46, right: 60, top: 30, bottom: 30 },
                tooltip: {
                    trigger: 'axis', axisPointer: { type: 'shadow' },
                    backgroundColor: 'rgba(14,16,28,0.97)', borderColor: 'rgba(122,162,247,0.45)', textStyle: { color: '#fff', fontSize: 12 },
                    formatter: (ps) => {
                        const i = ps[0].dataIndex;
                        const b = p.bands[i];
                        return `<b>${bandTick(bands[i])}</b><br/>bet ${b.bets} of ${b.hands} hands${b.rate == null ? '' : ` · ${pct(b.rate)}%`}<br/>avg bet ${plain(b.avgBet)}`;
                    },
                },
                xAxis: {
                    type: 'category', data: bands.map(bandTick),
                    axisLabel: { color: TEXT.secondary, fontSize: 12, fontWeight: 700 }, axisTick: { show: false },
                    axisLine: { lineStyle: { color: 'rgba(255,255,255,0.18)' } },
                },
                yAxis: [
                    {
                        type: 'value', min: 0, max: (v) => Math.max(10, Math.ceil((v.max * 1.15) / 10) * 10),
                        axisLabel: { color: TEXT.muted, fontSize: 11, formatter: '{value}%' },
                        splitLine: { lineStyle: { color: 'rgba(255,255,255,0.06)' } },
                    },
                    { type: 'value', min: 0, axisLabel: { color: AVG, fontSize: 11, formatter: (v) => plain(v) }, splitLine: { show: false } },
                ],
                series: [
                    {
                        type: 'bar', barWidth: '54%',
                        data: p.bands.map((b, i) => ({
                            value: pct(b.rate),
                            itemStyle: { color: bands[i].color, borderColor: 'rgba(255,255,255,0.22)', borderWidth: 1, borderRadius: [4, 4, 0, 0] },
                        })),
                        label: { show: true, position: 'top', color: TEXT.primary, fontSize: 14, fontWeight: 800, formatter: (x) => (x.value == null ? '' : `${x.value}%`) },
                        ...(overall == null ? {} : {
                            markLine: {
                                silent: true, symbol: 'none', data: [{ yAxis: overall }],
                                lineStyle: { color: 'rgba(255,255,255,0.6)', type: 'dashed', width: 1.5 },
                                label: { formatter: `${overall}%`, color: TEXT.secondary, fontSize: 11, position: 'insideEndTop' },
                            },
                        }),
                    },
                    {
                        type: 'line', yAxisIndex: 1, z: 5, connectNulls: true, symbol: 'circle', symbolSize: 9,
                        data: p.bands.map((b) => (b.avgBet == null ? null : Math.round(b.avgBet))),
                        lineStyle: { color: AVG, width: 2 }, itemStyle: { color: AVG, borderColor: '#0d0e18', borderWidth: 2 },
                    },
                ],
            },
        };
    }, [views, code, theo]);
    const ref = useEChart(option);
    return (
        <Box sx={{ position: 'relative', width: '100%', height: '100%', minHeight: 300 }}>
            <Box ref={ref} role="img" aria-label={`Bet rate by edge band for ${code}`} sx={{ position: 'absolute', inset: 0 }} />
            {empty ? (
                <Typography sx={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', fontSize: 13, color: TEXT.faint }}>No edge data</Typography>
            ) : null}
        </Box>
    );
}
```

- [ ] **Step 4: Create `OptionStrip.js`:**

```js
// Every bet option the patron used as a colour chip with a dot in its
// worst test state. Click to put that option under review.

import React from 'react';
import { Box, ButtonBase } from '@mui/material';
import { TEXT, ACCENT } from '../../constants/rtTheme';
import { worstState } from '../../utils/patron360';
import { STATE_STYLE, optionColor } from './format';

export default function OptionStrip({ rows, value, onChange }) {
    return (
        <Box role="radiogroup" aria-label="Bet option under review" sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
            {rows.map((r) => {
                const on = r.code === value;
                const s = STATE_STYLE[worstState(r)];
                const c = optionColor(r.code);
                return (
                    <ButtonBase
                        key={r.code}
                        role="radio"
                        aria-checked={on}
                        title={`${r.name} · ${s.label}`}
                        onClick={() => onChange(r.code)}
                        sx={{
                            gap: 0.75, pl: 1, pr: 1.25, py: 0.6, borderRadius: 1, fontSize: 13, fontWeight: 800,
                            color: on ? '#0d0e18' : TEXT.primary, bgcolor: on ? c : 'rgba(255,255,255,0.04)',
                            border: `1px solid ${on ? c : 'rgba(255,255,255,0.14)'}`,
                            transition: 'background-color 150ms, border-color 150ms',
                            '&:hover': { borderColor: c },
                            '&.Mui-focusVisible': { outline: `2px solid ${ACCENT}`, outlineOffset: 2 },
                        }}
                    >
                        <Box component="span" sx={{ width: 9, height: 9, borderRadius: '50%', bgcolor: s.color, boxShadow: '0 0 0 2px rgba(13,14,24,0.85)' }} />
                        {r.code}
                    </ButtonBase>
                );
            })}
        </Box>
    );
}
```

- [ ] **Step 5: Create `SummaryPanel.js`:**

```js
// Summary — the 10-second view. Left: the verdict stamp, flag/watch counts,
// a ≤ 7-word headline and four visual fact tiles for the option under
// review. Right: one chart of the pattern across every shoe, and the
// option strip to switch option.

import React from 'react';
import { Box, Stack, Typography } from '@mui/material';
import { TEXT, systemLabel } from '../../constants/rtTheme';
import { OPTION_BY_CODE, headlineFor } from '../../utils/patron360';
import FactTiles from './FactTiles';
import EdgeProfileChart, { ProfileLegend } from './EdgeProfileChart';
import OptionStrip from './OptionStrip';
import { LEVEL_COLOR, STATE_GLYPH, STATE_STYLE, panelSx, raisedSx } from './format';

function CountChip({ state, n }) {
    if (!n) return null;
    const s = STATE_STYLE[state];
    return (
        <Box sx={{
            display: 'inline-flex', alignItems: 'center', gap: 0.75, px: 1.1, py: 0.35, borderRadius: 1,
            bgcolor: s.bg, border: `1px solid ${s.color}`, color: s.color, fontSize: 12, fontWeight: 900, letterSpacing: 0.5,
        }}>
            {STATE_GLYPH[state]} {s.label} ×{n}
        </Box>
    );
}

function Stamp({ verdict }) {
    const c = LEVEL_COLOR[verdict.level];
    return (
        <Box
            role="status"
            title={verdict.reason}
            aria-label={`Assessment ${verdict.level}. ${verdict.reason}`}
            sx={{
                display: 'inline-block', px: 2.25, py: 0.5, color: c, border: `3px solid ${c}`, outline: `1px solid ${c}`,
                outlineOffset: 3, borderRadius: 1, transform: 'rotate(-2deg)', fontSize: 34, fontWeight: 900,
                letterSpacing: 4, lineHeight: 1.1, whiteSpace: 'nowrap',
            }}
        >
            {verdict.level}
        </Box>
    );
}

export default function SummaryPanel({ model, code, onOption }) {
    const row = model.evidence.find((r) => r.code === code) || null;
    const counts = { flag: 0, watch: 0 };
    for (const r of model.evidence) for (const t of Object.values(r.tests)) if (counts[t.state] != null) counts[t.state] += 1;
    const name = (OPTION_BY_CODE.get(code) || { name: code }).name;
    return (
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: '5fr 7fr' }, gap: 1.5, alignItems: 'stretch' }}>
            <Box component="section" aria-label="Assessment" sx={{ ...raisedSx, p: 2.25 }}>
                <Stack direction="row" sx={{ alignItems: 'center', flexWrap: 'wrap', gap: 2.5 }}>
                    <Stamp verdict={model.verdict} />
                    <Stack spacing={0.75} sx={{ alignItems: 'flex-start' }}>
                        <CountChip state="flag" n={counts.flag} />
                        <CountChip state="watch" n={counts.watch} />
                    </Stack>
                </Stack>
                <Typography component="h3" sx={{ mt: 2.25, mb: 2, fontSize: 21, fontWeight: 800, lineHeight: 1.25, color: TEXT.primary }}>
                    {headlineFor(model.verdict, row)}
                </Typography>
                {row ? <FactTiles row={row} /> : null}
            </Box>
            <Box component="section" aria-label={`Bet rate by edge for ${name}`} sx={{ ...panelSx, p: 2.25, display: 'flex', flexDirection: 'column', gap: 1.25 }}>
                <Stack direction="row" sx={{ alignItems: 'center', flexWrap: 'wrap', columnGap: 1.25, rowGap: 0.5 }}>
                    <Typography sx={{ fontSize: 15, fontWeight: 800, color: TEXT.primary }}>Bet rate by edge</Typography>
                    <Typography sx={{ ...systemLabel, color: TEXT.secondary }}>{code}{name !== code ? ` · ${name}` : ''}</Typography>
                    <Box sx={{ flex: 1 }} />
                    <ProfileLegend />
                </Stack>
                <Box sx={{ flex: 1, minHeight: 300 }}>
                    <EdgeProfileChart views={model.views} code={code} />
                </Box>
                <OptionStrip rows={model.evidence} value={code} onChange={onOption} />
            </Box>
        </Box>
    );
}
```

- [ ] **Step 6: Create `TestMatrix.js`:**

```js
// Every option the patron used × every test, as state cells holding the
// value only — the audit trail behind the summary. Header tooltips carry
// each test's question and thresholds; click a row to review that option.

import React from 'react';
import { Box, Typography } from '@mui/material';
import { TEXT, ACCENT, systemLabel } from '../../constants/rtTheme';
import { TEST_META } from '../../utils/patron360';
import { STATE_GLYPH, STATE_STYLE, formatTestValue, thresholdHint, money, plain, int, signColor, optionColor } from './format';

const TESTS = [['entry', 'Bet rate'], ['ramp', 'Avg bet'], ['money', 'On −edge'], ['luck', 'Result']];
const cellSx = { px: 1, py: 0.75, textAlign: 'right', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', fontSize: 13 };

export default function TestMatrix({ rows, selected, onSelect }) {
    return (
        <Box sx={{ overflowX: 'auto' }}>
            <Box component="table" sx={{ width: '100%', minWidth: 760, borderCollapse: 'separate', borderSpacing: '0 4px' }}>
                <thead>
                    <tr>
                        {['Option', 'Bets', 'Turnover', 'Result'].map((h, i) => (
                            <Box component="th" key={h} sx={{ ...systemLabel, ...cellSx, py: 0.25, textAlign: i ? 'right' : 'left' }}>{h}</Box>
                        ))}
                        {TESTS.map(([id, label]) => (
                            <Box component="th" key={id} title={`${TEST_META[id].question} (${thresholdHint(id, TEST_META[id].unit)})`}
                                sx={{ ...systemLabel, ...cellSx, py: 0.25, textAlign: 'center', cursor: 'help' }}>
                                {label}
                            </Box>
                        ))}
                    </tr>
                </thead>
                <tbody>
                    {rows.map((r) => {
                        const on = r.code === selected;
                        const pick = () => onSelect(r.code);
                        return (
                            <Box
                                component="tr"
                                key={r.code}
                                role="button"
                                tabIndex={0}
                                aria-pressed={on}
                                onClick={pick}
                                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); } }}
                                sx={{
                                    cursor: 'pointer',
                                    '& > td': { bgcolor: on ? 'rgba(122,162,247,0.13)' : 'rgba(255,255,255,0.03)', transition: 'background-color 150ms' },
                                    '&:hover > td': { bgcolor: 'rgba(122,162,247,0.09)' },
                                    '& > td:first-of-type': { borderRadius: '6px 0 0 6px', boxShadow: on ? `inset 3px 0 0 ${ACCENT}` : 'none' },
                                    '& > td:last-of-type': { borderRadius: '0 6px 6px 0' },
                                    '&:focus-visible': { outline: `2px solid ${ACCENT}`, outlineOffset: -2 },
                                }}
                            >
                                <Box component="td" sx={{ ...cellSx, textAlign: 'left' }}>
                                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                        <Box sx={{ width: 10, height: 10, borderRadius: 0.5, bgcolor: optionColor(r.code), flexShrink: 0 }} />
                                        <Typography title={r.name} sx={{ fontSize: 13, fontWeight: 800, color: TEXT.primary }}>{r.code}</Typography>
                                    </Box>
                                </Box>
                                <Box component="td" sx={{ ...cellSx, color: TEXT.secondary }}>{int(r.bets)}</Box>
                                <Box component="td" sx={{ ...cellSx, color: TEXT.primary }}>{plain(r.turnover)}</Box>
                                <Box component="td" sx={{ ...cellSx, fontWeight: 800, color: signColor(r.result) }}>{money(r.result)}</Box>
                                {TESTS.map(([id]) => {
                                    const t = r.tests[id];
                                    const s = STATE_STYLE[t.state];
                                    const none = t.state === 'insufficient';
                                    return (
                                        <Box component="td" key={id} sx={{ ...cellSx, textAlign: 'center' }}>
                                            <Box title={s.label} sx={{
                                                display: 'inline-block', minWidth: 76, px: 1, py: 0.3, borderRadius: 1,
                                                bgcolor: s.bg, border: `1px solid ${s.color}`, color: none ? TEXT.muted : s.color, fontWeight: 900,
                                            }}>
                                                {none ? '—' : `${STATE_GLYPH[t.state]} ${formatTestValue(TEST_META[id].unit, t.value)}`}
                                            </Box>
                                        </Box>
                                    );
                                })}
                            </Box>
                        );
                    })}
                </tbody>
            </Box>
        </Box>
    );
}
```

- [ ] **Step 7: Heatmap legend** — in `ShoeHeatmap.js` import `bandTick` and `EDGE_COLORS` from `./format`; in `HeatLegend` use `bandTick(b)` instead of `b.label`, and replace the marker block with:

```jsx
            <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center' }}>
                <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: '#fff' }} />
                <Typography sx={{ fontSize: 12, color: TEXT.muted }}>won</Typography>
                <Box sx={{ width: 10, height: 10, borderRadius: '50%', border: '1.5px solid #fff', ml: 1 }} />
                <Typography sx={{ fontSize: 12, color: TEXT.muted }}>lost</Typography>
                <Box sx={{ width: 14, height: 12, borderRadius: 0.5, bgcolor: EDGE_COLORS.player, opacity: 0.22, ml: 1 }} />
                <Typography sx={{ fontSize: 12, color: TEXT.muted }}>not seated</Typography>
            </Stack>
```

---

### Task 3: Overlay layout

- [ ] **Step 1: Replace `RtPatron360.js`:**

```js
// Player 360 — summary first.
// ===========================
// Specs: docs/superpowers/specs/2026-09-26-patron-360-side-bet-design.md
//        docs/superpowers/specs/2026-09-26-patron-360-summary-first-design.md
//
// Full-screen overlay built for a 10-second escalate-or-not decision: the
// verdict, the key option's evidence as visual tiles and one "bet rate by
// edge" chart. Everything else — all tests, the shoes × hands heatmap,
// edge curves, wagers and the trend board — sits in one Investigate
// section, closed by default. Feeds are fetched per opening and per range.

import React, { forwardRef, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    Box, Button, ButtonBase, Checkbox, Collapse, Dialog, FormControlLabel, ListItemText, MenuItem, Select,
    Skeleton, Slide, Stack, Switch, ToggleButton, ToggleButtonGroup, Typography, useMediaQuery,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ManageSearchIcon from '@mui/icons-material/ManageSearch';
import { CARD_TIERS } from '../../../live/constants/winPalette';
import { PATRON_360 } from '../../constants/rtConfig';
import { fetchPatronBets, fetchPatronShoeEdges } from '../../utils/rtDataSource';
import { RANGES, buildPatron360, heatmapRows, rangeFor } from '../../utils/patron360';
import { SURFACE, TEXT, STATE, ACCENT, systemLabel } from '../../constants/rtTheme';
import ShoeRoads, { MARK_COLOR, EMPHASIS_COLOR } from '../ShoeRoads';
import SummaryPanel from './SummaryPanel';
import TestMatrix from './TestMatrix';
import ShoeHeatmap, { HeatLegend } from './ShoeHeatmap';
import EdgeCurves from './EdgeCurves';
import WagerBars from './WagerBars';
import { SHOE_COLORS, panelSx, raisedSx, shoeLabel } from './format';

const SlideUp = forwardRef(function SlideUp(props, ref) {
    return <Slide direction="up" ref={ref} {...props} />;
});

const skeletonSx = { bgcolor: 'rgba(255,255,255,0.05)', borderRadius: 2 };
const segmentedSx = {
    height: 32,
    '& .MuiToggleButton-root': { color: TEXT.muted, borderColor: 'rgba(122,162,247,0.35)', textTransform: 'none', fontSize: 13, fontWeight: 700, px: 1.4 },
    '& .Mui-selected': { color: `${TEXT.primary} !important`, bgcolor: 'rgba(122,162,247,0.24) !important' },
};
const dateInputSx = {
    height: 32, px: 1, borderRadius: 1, border: '1px solid rgba(122,162,247,0.35)', bgcolor: 'transparent',
    color: TEXT.primary, fontSize: 13, fontFamily: 'inherit', colorScheme: 'dark',
    '&:focus-visible': { outline: `2px solid ${ACCENT}`, outlineOffset: 1 },
};
const countChipSx = {
    px: 1, py: 0.25, borderRadius: 1, fontSize: 12, fontWeight: 800, color: TEXT.secondary,
    bgcolor: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.12)', fontVariantNumeric: 'tabular-nums',
};

const duration = (m) => (m == null || !Number.isFinite(Number(m)) ? '—'
    : Number(m) < 60 ? `${Math.round(m)}m` : `${Math.floor(m / 60)}h ${String(Math.round(m % 60)).padStart(2, '0')}m`);

function Section({ title, right, raised, children }) {
    return (
        <Box component="section" sx={raised ? raisedSx : panelSx}>
            <Stack direction="row" sx={{ alignItems: 'center', columnGap: 1.5, rowGap: 0.75, mb: 1.25, flexWrap: 'wrap' }}>
                <Typography component="h3" sx={{ fontSize: 15, fontWeight: 800, color: TEXT.primary }}>{title}</Typography>
                <Box sx={{ flex: 1 }} />
                {right}
            </Stack>
            {children}
        </Box>
    );
}

function RangeBar({ rangeId, range, onRange, onCustom }) {
    return (
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 0.75 }}>
            <ToggleButtonGroup exclusive size="small" value={rangeId === 'custom' ? null : rangeId}
                onChange={(_, v) => v && onRange(v)} aria-label="Date range" sx={segmentedSx}>
                {RANGES.map((r) => <ToggleButton key={r.id} value={r.id}>{r.label}</ToggleButton>)}
            </ToggleButtonGroup>
            <Box component="input" type="date" aria-label="From date" value={range.from} max={range.to}
                onChange={(e) => e.target.value && onCustom({ from: e.target.value, to: range.to })} sx={dateInputSx} />
            <Typography sx={{ fontSize: 12, color: TEXT.faint }}>–</Typography>
            <Box component="input" type="date" aria-label="To date" value={range.to} min={range.from}
                onChange={(e) => e.target.value && onCustom({ from: range.from, to: e.target.value })} sx={dateInputSx} />
        </Stack>
    );
}

function Header({ patronId, patronRow, source, rangeBar, onClose }) {
    const p = patronRow || {};
    const tier = CARD_TIERS[p.card_type] || CARD_TIERS.BASE;
    return (
        <Box sx={{ position: 'sticky', top: 0, zIndex: 3, bgcolor: 'rgba(13,14,24,0.94)', backdropFilter: 'blur(8px)', borderBottom: `1px solid ${SURFACE.panelBorder}` }}>
            <Stack direction="row" sx={{ alignItems: 'center', columnGap: 2.5, rowGap: 1, flexWrap: 'wrap', px: { xs: 1.5, md: 2.5 }, py: 1.25, maxWidth: 2000, mx: 'auto', boxSizing: 'border-box' }}>
                <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', minWidth: 0 }}>
                    <Box sx={{ width: 46, height: 46, borderRadius: '50%', display: 'grid', placeItems: 'center', flexShrink: 0, bgcolor: `${tier.accent}26`, border: `1.5px solid ${tier.accent}`, color: tier.accent, fontWeight: 800, fontSize: 14 }}>
                        {String(patronId).slice(-2)}
                    </Box>
                    <Box sx={{ minWidth: 0 }}>
                        <Typography id="p360-title" component="h2" sx={{ fontSize: 24, fontWeight: 800, color: TEXT.primary, lineHeight: 1.1 }}>{patronId}</Typography>
                        <Typography sx={{ fontSize: 12, color: TEXT.faint }}>
                            <Box component="span" sx={{ color: tier.accent, fontWeight: 700 }}>{tier.label}</Box>
                            {` · ${p.segment || '—'} · ${p.current_table_key ? `seat ${p.current_seat ?? '—'} · ${p.current_table_key}` : 'not seated'} · ${duration(p.sign_in_mins_ago)}`}
                        </Typography>
                    </Box>
                </Stack>
                {rangeBar}
                {source ? (
                    <Box sx={{ ...countChipSx, borderColor: source.live ? STATE.positiveBorder : 'rgba(255,255,255,0.12)', bgcolor: source.live ? STATE.positiveBg : 'rgba(255,255,255,0.05)' }}>
                        {source.live ? 'LIVE' : 'MOCK'}
                    </Box>
                ) : null}
                <Box sx={{ flex: 1 }} />
                <ButtonBase onClick={onClose} aria-label="Close Player 360"
                    sx={{ width: 40, height: 40, borderRadius: 1.5, color: TEXT.muted, border: `1px solid ${SURFACE.panelBorder}`, '&:hover': { color: TEXT.primary, borderColor: ACCENT }, '&.Mui-focusVisible': { outline: `2px solid ${ACCENT}`, outlineOffset: 2 } }}>
                    <CloseIcon />
                </ButtonBase>
            </Stack>
        </Box>
    );
}

function Loading() {
    return (
        <Stack spacing={1.5} aria-busy="true" aria-label="Loading">
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: '5fr 7fr' }, gap: 1.5 }}>
                <Skeleton variant="rectangular" height={440} sx={skeletonSx} />
                <Skeleton variant="rectangular" height={440} sx={skeletonSx} />
            </Box>
            <Skeleton variant="rectangular" height={56} sx={skeletonSx} />
        </Stack>
    );
}

function Message({ title, body, action }) {
    return (
        <Stack spacing={1.25} sx={{ alignItems: 'center', textAlign: 'center', py: 12 }}>
            <Typography sx={{ fontSize: 17, fontWeight: 800, color: TEXT.primary }}>{title}</Typography>
            {body ? <Typography sx={{ fontSize: 13, color: TEXT.muted, maxWidth: 560 }}>{body}</Typography> : null}
            {action}
        </Stack>
    );
}

function InvestigateBar({ open, onToggle, shoes, bets }) {
    return (
        <ButtonBase
            onClick={onToggle}
            aria-expanded={open}
            sx={{
                ...panelSx, width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'flex-start', gap: 1.5,
                px: 2, py: 1.4, textAlign: 'left', transition: 'border-color 150ms',
                '&:hover': { borderColor: ACCENT }, '&.Mui-focusVisible': { outline: `2px solid ${ACCENT}`, outlineOffset: 2 },
            }}
        >
            <ManageSearchIcon sx={{ color: ACCENT }} />
            <Typography sx={{ fontSize: 15, fontWeight: 800, color: TEXT.primary }}>Investigate</Typography>
            <Box sx={countChipSx}>{shoes.toLocaleString()} shoes</Box>
            <Box sx={countChipSx}>{bets.toLocaleString()} bets</Box>
            <Box sx={{ flex: 1 }} />
            <ExpandMoreIcon sx={{ color: TEXT.muted, transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 180ms' }} />
        </ButtonBase>
    );
}

function ShoePicker({ rows, selected, onChange }) {
    return (
        <Select
            multiple
            size="small"
            value={selected}
            onChange={(e) => onChange(typeof e.target.value === 'string' ? e.target.value.split(',') : e.target.value)}
            displayEmpty
            renderValue={(v) => (v.length ? `${v.length} selected` : 'Pick shoes')}
            inputProps={{ 'aria-label': 'Selected shoes' }}
            MenuProps={{ slotProps: { paper: { sx: { maxHeight: 420, bgcolor: '#1b1e30', color: TEXT.primary } } } }}
            sx={{ minWidth: 180, height: 34, color: TEXT.primary, fontSize: 13, fontWeight: 700, '& .MuiOutlinedInput-notchedOutline': { borderColor: 'rgba(122,162,247,0.4)' }, '& .MuiSvgIcon-root': { color: TEXT.muted } }}
        >
            {rows.map(({ view, stats }) => (
                <MenuItem key={view.shoeKey} value={view.shoeKey} dense>
                    <Checkbox size="small" checked={selected.includes(view.shoeKey)} sx={{ color: TEXT.muted, p: 0.5, mr: 1 }} />
                    <ListItemText
                        primary={shoeLabel(view)}
                        secondary={`${stats.bets} bets · ${stats.negHandsBet} on −edge`}
                        slotProps={{ primary: { sx: { fontSize: 13 } }, secondary: { sx: { fontSize: 11, color: TEXT.faint } } }}
                    />
                </MenuItem>
            ))}
        </Select>
    );
}

const ring = (color) => (
    <Box component="span" sx={{ display: 'inline-block', width: 11, height: 11, borderRadius: '50%', border: `2.5px solid ${color}`, bgcolor: '#e8edf7', verticalAlign: 'middle', mr: 0.5 }} />
);

export default function RtPatron360({ open, patronId, patronRow, onClose }) {
    const reducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
    const [rangeId, setRangeId] = useState(PATRON_360.DEFAULT_RANGE);
    const [custom, setCustom] = useState(null);
    const range = rangeId === 'custom' && custom ? custom : rangeFor(rangeId === 'custom' ? PATRON_360.DEFAULT_RANGE : rangeId);

    const [attempt, setAttempt] = useState(0);
    const [data, setData] = useState({ key: null, bets: null, edges: null, live: false, error: null });
    const reqKey = `${patronId}|${range.from}|${range.to}|${attempt}`;
    useEffect(() => {
        if (!open || !patronId) return undefined;
        let cancelled = false;
        const r = { from: range.from, to: range.to };
        Promise.all([fetchPatronBets(patronId, r), fetchPatronShoeEdges(patronId, r)]).then(([b, e]) => {
            if (!cancelled) setData({ key: reqKey, bets: b.rows, edges: e.rows, live: b.live && e.live, error: b.error || e.error });
        });
        return () => { cancelled = true; };
        // reqKey encodes patron, range and retry attempt.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, reqKey]);
    const ready = data.key === reqKey;
    const model = useMemo(
        () => (ready && !data.error && data.bets && data.bets.length ? buildPatron360(data.bets, data.edges || []) : null),
        [ready, data],
    );

    const [optionPick, setOptionPick] = useState(null);
    const [investigate, setInvestigate] = useState(false);
    const [sort, setSort] = useState('suspicious');
    const [onlyBet, setOnlyBet] = useState(true);
    const [showAll, setShowAll] = useState(false);
    const [selected, setSelected] = useState([]);
    const [focusKey, setFocusKey] = useState(null);
    useEffect(() => {
        setOptionPick(null); setRangeId(PATRON_360.DEFAULT_RANGE); setCustom(null); setSelected([]); setInvestigate(false);
    }, [patronId]);

    const code = model
        ? (optionPick && model.evidence.some((r) => r.code === optionPick) ? optionPick : model.defaultOption)
        : null;
    const rows = useMemo(() => (model && code ? heatmapRows(model.views, code, { onlyBet, sort }) : []), [model, code, onlyBet, sort]);
    const shown = showAll ? rows : rows.slice(0, PATRON_360.HEATMAP_INITIAL_ROWS);

    // Once per data set + option: select the top (most suspicious) shoe.
    const autoRef = useRef(null);
    useEffect(() => {
        const k = `${data.key}|${code}`;
        if (!model || !code || autoRef.current === k) return;
        autoRef.current = k;
        setShowAll(false);
        setSelected(rows.length ? [rows[0].view.shoeKey] : []);
        setFocusKey(rows.length ? rows[0].view.shoeKey : null);
    }, [model, code, rows, data.key]);

    const selectedSet = useMemo(() => new Set(selected), [selected]);
    const viewByKey = useMemo(() => new Map((model ? model.views : []).map((v) => [v.shoeKey, v])), [model]);
    const selectedViews = useMemo(() => selected.map((k) => viewByKey.get(k)).filter(Boolean), [selected, viewByKey]);
    const focused = selectedViews.find((v) => v.shoeKey === focusKey) || selectedViews[0] || null;

    const onSelectShoe = useCallback((key, additive) => {
        setSelected((cur) => {
            if (!additive) return [key];
            if (cur.includes(key)) return cur.filter((k) => k !== key);
            return [...cur, key].slice(-PATRON_360.MAX_SELECTED_SHOES);
        });
        setFocusKey(key);
    }, []);
    const onPick = useCallback((keys) => {
        const next = keys.slice(-PATRON_360.MAX_SELECTED_SHOES);
        setSelected(next);
        if (next.length) setFocusKey(next[next.length - 1]);
    }, []);

    const roadMarks = useMemo(() => {
        if (!focused) return { any: new Set(), opt: new Set() };
        const opt = new Set();
        for (const [h, m] of focused.betsByHand) if (m.has(code)) opt.add(h);
        return { any: new Set(focused.betsByHand.keys()), opt };
    }, [focused, code]);

    let body;
    if (!ready) {
        body = <Loading />;
    } else if (data.error) {
        body = (
            <Message
                title={`Couldn't load ${patronId}`}
                body={data.error}
                action={<Button variant="outlined" onClick={() => setAttempt((n) => n + 1)} sx={{ color: ACCENT, borderColor: ACCENT, textTransform: 'none', fontWeight: 700 }}>Retry</Button>}
            />
        );
    } else if (!model) {
        body = <Message title={`No bets · ${range.from} – ${range.to}`} body="Try a wider range." />;
    } else {
        body = (
            <Stack spacing={1.5}>
                <SummaryPanel model={model} code={code} onOption={setOptionPick} />
                <InvestigateBar open={investigate} onToggle={() => setInvestigate((v) => !v)} shoes={model.views.length} bets={model.bets.length} />
                <Collapse in={investigate} unmountOnExit timeout={reducedMotion ? 0 : 'auto'}>
                    <Stack spacing={1.5}>
                        <Section title="All tests">
                            <TestMatrix rows={model.evidence} selected={code} onSelect={setOptionPick} />
                        </Section>

                        <Section
                            title={`Shoes × hands · ${code}`}
                            right={(
                                <>
                                    <FormControlLabel
                                        control={<Switch size="small" checked={onlyBet} onChange={(e) => setOnlyBet(e.target.checked)} />}
                                        label={`${code} shoes only`}
                                        sx={{ mr: 0, '& .MuiFormControlLabel-label': { fontSize: 12, color: TEXT.muted } }}
                                    />
                                    <ToggleButtonGroup exclusive size="small" value={sort} onChange={(_, v) => v && setSort(v)} aria-label="Sort shoes" sx={segmentedSx}>
                                        <ToggleButton value="suspicious">Most $ on −edge</ToggleButton>
                                        <ToggleButton value="newest">Newest</ToggleButton>
                                    </ToggleButtonGroup>
                                </>
                            )}
                        >
                            <Stack spacing={1.25}>
                                <HeatLegend code={code} />
                                {rows.length ? (
                                    <ShoeHeatmap rows={shown} code={code} selected={selectedSet} onSelect={onSelectShoe} />
                                ) : (
                                    <Typography sx={{ fontSize: 13, color: TEXT.faint, py: 2 }}>No {code} shoes in this range.</Typography>
                                )}
                                {rows.length > shown.length ? (
                                    <Button onClick={() => setShowAll(true)} sx={{ alignSelf: 'flex-start', textTransform: 'none', color: ACCENT, fontWeight: 700 }}>
                                        Show all {rows.length}
                                    </Button>
                                ) : null}
                            </Stack>
                        </Section>

                        <Section title={`Selected shoes · ${selectedViews.length}`} right={<ShoePicker rows={rows} selected={selected} onChange={onPick} />} raised>
                            {focused ? (
                                <Stack spacing={2}>
                                    <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: '1fr 1fr' }, gap: 2, alignItems: 'start' }}>
                                        <Box sx={{ minWidth: 0 }}>
                                            <Typography sx={{ ...systemLabel, mb: 0.5 }}>House edge · {code}</Typography>
                                            <EdgeCurves views={selectedViews} code={code} />
                                            <Typography sx={{ fontSize: 11, color: TEXT.faint }}>● won · ○ lost · size = bet · - - theo</Typography>
                                        </Box>
                                        <Box sx={{ minWidth: 0 }}>
                                            <Stack direction="row" sx={{ alignItems: 'center', flexWrap: 'wrap', gap: 0.75, mb: 0.5 }}>
                                                <Typography sx={systemLabel}>Wager by hand</Typography>
                                                {selectedViews.length > 1 ? selectedViews.map((v, i) => {
                                                    const on = v.shoeKey === focused.shoeKey;
                                                    const c = SHOE_COLORS[i % SHOE_COLORS.length];
                                                    return (
                                                        <ButtonBase key={v.shoeKey} onClick={() => setFocusKey(v.shoeKey)} aria-pressed={on}
                                                            sx={{ px: 1, py: 0.25, borderRadius: 0.75, fontSize: 12, fontWeight: 700, color: on ? '#0d0e18' : TEXT.secondary, bgcolor: on ? c : 'transparent', border: `1px solid ${c}`, '&.Mui-focusVisible': { outline: `2px solid ${ACCENT}`, outlineOffset: 2 } }}>
                                                            {shoeLabel(v)}
                                                        </ButtonBase>
                                                    );
                                                }) : <Typography sx={{ fontSize: 12, color: TEXT.faint }}>{shoeLabel(focused)}</Typography>}
                                            </Stack>
                                            <WagerBars key={focused.shoeKey} view={focused} code={code} />
                                        </Box>
                                    </Box>
                                    {selectedViews.length === 1 ? (
                                        <Box>
                                            <Stack direction="row" sx={{ alignItems: 'center', flexWrap: 'wrap', columnGap: 2, mb: 0.75 }}>
                                                <Typography sx={systemLabel}>Trend board</Typography>
                                                <Typography sx={{ fontSize: 12, color: TEXT.faint }}>{ring(MARK_COLOR)}bet · {ring(EMPHASIS_COLOR)}{code}</Typography>
                                            </Stack>
                                            {focused.hands.length ? (
                                                <ShoeRoads hands={focused.hands} markedHands={roadMarks.any} emphasisHands={roadMarks.opt} />
                                            ) : (
                                                <Typography sx={{ fontSize: 13, color: TEXT.faint }}>No hand results.</Typography>
                                            )}
                                        </Box>
                                    ) : null}
                                </Stack>
                            ) : (
                                <Typography sx={{ fontSize: 13, color: TEXT.faint, py: 2 }}>Click a heatmap row.</Typography>
                            )}
                        </Section>
                    </Stack>
                </Collapse>
            </Stack>
        );
    }

    const source = ready && !data.error && model ? { live: data.live } : null;

    return (
        <Dialog
            fullScreen
            open={open}
            onClose={onClose}
            transitionDuration={reducedMotion ? 0 : 220}
            slots={{ transition: SlideUp }}
            slotProps={{ paper: { sx: { bgcolor: SURFACE.page, backgroundImage: 'none', color: TEXT.primary } } }}
            aria-labelledby="p360-title"
        >
            <Header
                patronId={patronId}
                patronRow={patronRow}
                source={source}
                onClose={onClose}
                rangeBar={(
                    <RangeBar
                        rangeId={rangeId}
                        range={range}
                        onRange={(id) => { setRangeId(id); setCustom(null); }}
                        onCustom={(r) => { setCustom(r); setRangeId('custom'); }}
                    />
                )}
            />
            <Box sx={{ px: { xs: 1.5, md: 2.5 }, py: 2, width: '100%', maxWidth: 2000, mx: 'auto', boxSizing: 'border-box' }}>
                {body}
            </Box>
        </Dialog>
    );
}
```

- [ ] **Step 2: Delete** `AdvantageTable.js` and `OptionChips.js`; grep `src` for both names → 0.
- [ ] **Step 3: Tests + ESLint** on `src/realtime/components/patron360` and `src/realtime/utils` → no errors.

---

### Task 4: Visual QA (frontend-design + ui-ux-pro-max)

- [ ] Headless screenshots (1680 wide) of the summary for a counter (ACTION) and a normal patron; verify the summary fits within 1050 px height at 1680 × 1050.
- [ ] Investigate open: test matrix, heatmap, selected shoes render; option strip and matrix rows switch the option.
- [ ] 800 / 1280: no page-level horizontal scroll.
- [ ] Contrast check on the new text colours; fix anything found; re-run tests.
