# Pricing Auto-plan v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Anchor-first, period-aligned, rule-respecting price assignment with every criterion editable (spec: `docs/superpowers/specs/2026-10-01-pricing-autoplan-v2-design.md`).

**Architecture:** Pure model modules in `src/pricing/utils/autoplan/` (config, inputs, solver, period, new `paste.js`) carry all logic and tests; `components/autoplan/useAutoPlan.js` wires them to state; panels render. The solver stays one min-cost flow per core-hour block; v2 changes the ORDER blocks are solved in (tree from the anchor hour), the PARENT each block is compared with, and adds lower-bound pod rules via negative-cost units.

**Tech Stack:** React 19, MUI 9 (`sx`, `slots`/`slotProps`; no system props), CRA Jest.

## Global Constraints

- Commands: `$env:CI='true'; npx react-scripts test --watchAll=false src/pricing src/realtime` · `$env:ESLINT_USE_FLAT_CONFIG='false'; npx eslint --ext .js src/pricing`
- MUI 9: layout props go in `sx`; `TextField` uses `slotProps.htmlInput`; Autocomplete `renderInput` must merge `params.slotProps`.
- Icons: verify `node_modules/@mui/icons-material/<Name>.js` exists before importing.
- Look: `apStyles.js` tokens (`AP`, `panelSx`, `ghostSx`, `primarySx`, `inputSx`, `labelSx`).
- Weights: change 10,000 · step 1,000 · align 10,000 · raise 0 · hold 500 · stay 300 · rank 10 · hist 10.
- Default rank mix: Theo per hour 50 · Active rate 25 · Theo per patron hour 25.
- Default anchor 21, reference day Saturday, rank basis per block.
- No commits unless the user asks.

## File map

| File | Responsibility |
|---|---|
| `utils/autoplan/config.js` | settings shape, defaults, merge/migration, signals, manual + date-target helpers |
| `utils/autoplan/inputs.js` | feed aggregation, rank blend (per block/day), history shares (range, half-life), target fitting (caps, floors) |
| `utils/autoplan/solver.js` | one block: min-cost flow with pod min/max, costs (change×mult, step, raise, hold, align) |
| `utils/autoplan/period.js` | solve order tree, reference plan, per-date solve, chronological reports, pod change cap |
| `utils/autoplan/paste.js` (new) | Excel TSV ↔ target cells |
| `components/autoplan/useAutoPlan.js` | state, feeds, reference, solve dates, manual rules, rank breakdown |
| `components/autoplan/CriteriaPanel.js` | decision order, solve order, scoring, signals + preview, sources |
| `components/autoplan/RankPreview.js` (new) | ranking table for one sub-segment / day type / core |
| `components/autoplan/RulesPanel.js` | pod min/max, templates, manual list |
| `components/autoplan/TargetsPanel.js` | day type / date entry, paste dialog, copy |
| `components/autoplan/PasteTargetsDialog.js` (new) | parse preview + apply |
| `components/autoplan/ManualBar.js` (new) | set / clear manual price for floor selection |
| `PricingDashboard.js`, `ResultPanel.js` | wiring; closed-hour line; pod-cap warnings |

---

### Task 1: Settings v2 (config.js)

**Files:** Modify `utils/autoplan/config.js` · Test `utils/autoplan/__tests__/v2config.test.js`

**Interfaces — Produces:**
- `DEFAULT_WEIGHTS = { change: 10000, stay: 300, step: 1000, rank: 10, hist: 10, hold: 500, align: 10000, raise: 0 }` (presets carry every key)
- `SIGNALS: [{ id, label, metric, per, source, help }]` ids `theo_oh, active, theo_ph, win_oh, occupancy, hands_oh`
- `signalOf({metric, per}) → signal | null`
- `DEFAULT_CRITERIA` adds `anchorCore: 21, refDayType: 'sat', rankBasis: 'block', histSource: { mode: 'last', from: '', to: '' }, rankSource: { mode: 'last', from: '', to: '' }, histHalfLife: 0, changeMult: {}, podChangeCap: { on: false, n: 3 }`; `rankMix` default = the three signals
- `normalizeRule(r)`: zonecap `{…, min, minOn, n, maxOn}` (old `n` → `maxOn: true`, `minOn: false`, `min: 0`)
- `dateKey(date) = 'd:' + date`; `targetsForDate(cfg, date, dt, core, sub)` → date entry else day type entry else null
- `withManual(cfg, date, core, keys, tierId|null)`; `manualFor(cfg, date, core) → Map`

- [ ] Step 1: tests

```js
import { DEFAULT_WEIGHTS, DEFAULT_CRITERIA, SIGNALS, signalOf, mergeAutoplan, normalizeRule, targetsForDate, withTargets, dateKey, withManual, manualFor, emptyAutoplan, WEIGHT_PRESETS, presetOf } from '../config';

test('v2 defaults', () => {
    expect(DEFAULT_WEIGHTS).toMatchObject({ change: 10000, step: 1000, align: 10000, raise: 0 });
    expect(presetOf(DEFAULT_WEIGHTS)).toBe('fewest');
    expect(WEIGHT_PRESETS.every((p) => Object.keys(DEFAULT_WEIGHTS).every((k) => k in p.weights))).toBe(true);
    expect(DEFAULT_CRITERIA).toMatchObject({ anchorCore: 21, refDayType: 'sat', rankBasis: 'block' });
    expect(DEFAULT_CRITERIA.rankMix.map((m) => signalOf(m).id)).toEqual(['theo_oh', 'active', 'theo_ph']);
    expect(SIGNALS.find((s) => s.id === 'active')).toMatchObject({ metric: 'active_minutes', per: 'open_minutes' });
});
test('criteria merge clamps and keeps sources', () => {
    const c = mergeAutoplan({ criteria: { anchorCore: 99, refDayType: 'x', rankBasis: 'day', histSource: { mode: 'range', from: '2026-01-01', to: '2026-03-31' }, histHalfLife: 999, changeMult: { 21: 3, 7: -1, x: 2 }, podChangeCap: { on: true, n: 0 } } }).criteria;
    expect(c.anchorCore).toBe(21); expect(c.refDayType).toBe('sat'); expect(c.rankBasis).toBe('day');
    expect(c.histSource).toEqual({ mode: 'range', from: '2026-01-01', to: '2026-03-31' });
    expect(c.histHalfLife).toBe(52); expect(c.changeMult).toEqual({ 21: 3 }); expect(c.podChangeCap).toEqual({ on: true, n: 1 });
});
test('zone rule migration', () => {
    expect(normalizeRule({ id: 1, on: true, type: 'zonecap', scope: 'all', tier: 'a', n: 2, hours: [21] })).toMatchObject({ n: 2, maxOn: true, min: 0, minOn: false });
    expect(mergeAutoplan({ rules: [{ id: 1, on: true, type: 'zonecap', scope: 'all', tier: 'a', n: 2, hours: [21] }] }).rules[0].maxOn).toBe(true);
});
test('date targets override day type', () => {
    let cfg = withTargets(emptyAutoplan(), 'wd', 21, 'MSC', { a: 3 });
    expect(targetsForDate(cfg, '2026-10-05', 'wd', 21, 'MSC')).toEqual({ a: 3 });
    cfg = withTargets(cfg, dateKey('2026-10-05'), 21, 'MSC', { a: 5 });
    expect(targetsForDate(cfg, '2026-10-05', 'wd', 21, 'MSC')).toEqual({ a: 5 });
    expect(targetsForDate(cfg, '2026-10-06', 'wd', 21, 'MSC')).toEqual({ a: 3 });
});
test('manual rules per date + block', () => {
    let cfg = withManual(emptyAutoplan(), '2026-10-05', 21, ['BA|1', 'BA|2'], 'm1000');
    expect([...manualFor(cfg, '2026-10-05', 21)]).toEqual([['BA|1', 'm1000'], ['BA|2', 'm1000']]);
    cfg = withManual(cfg, '2026-10-05', 21, ['BA|1'], null);
    expect([...manualFor(cfg, '2026-10-05', 21)]).toEqual([['BA|2', 'm1000']]);
    expect(mergeAutoplan({ manual: { '2026-10-05': { 21: { 'BA|2': 'm1000' } }, bad: 3 } }).manual).toEqual({ '2026-10-05': { 21: { 'BA|2': 'm1000' } } });
});
```

- [ ] Step 2: run → FAIL (missing exports). Step 3: implement. Step 4: run → PASS (update older tests that pinned `step: 20`).

### Task 2: Inputs v2 (inputs.js)

**Interfaces — Produces:**
- `aggregateRows(rows, { from, to, cfg, byCore, dayTypes }) → Map('dt|core|key' → sums)`; `core` is `'day'` when `byCore` is false; sums over `theo win drop turnover patronhrs openhours activehours patron_hands game_count open_minutes active_minutes`
- `blendFromAgg(agg, { dt, core, mix, subOf, sameDayType }) → Map(key → score 0..1)`; `sameDayType: false` sums all day types
- `signalBreakdown(agg, { dt, core, mix, subOf, sameDayType, sub }) → [{ key, parts: [{ id, value, pct }], score }]` sorted by score desc
- `sourceWindow(source, { defaultDays, before }) → { from, to }` (`mode:'last'` → `before−defaultDays+1 … before`; `'range'` → given)
- `historyShares(…, { halfLife })` weights a row by `0.5 ** (ageDays / (7 × halfLife))` from `to`
- `fitToFloors(map, floors, ladder) → { map, moved }` raises tiers to their floor, taking from the tier with the most room above its own floor

- [ ] Tests (`v2inputs.test.js`):

```js
import { aggregateRows, blendFromAgg, signalBreakdown, sourceWindow, fitToFloors, historyShares } from '../inputs';
import { emptyAutoplan } from '../config';
const cfg = emptyAutoplan();
const rows = [
  { date: '2026-09-05', hour: 21, gametype: 'BA', table: '1', theo: 900, openhours: 1, active_minutes: 30, open_minutes: 60, patronhrs: 3 },
  { date: '2026-09-05', hour: 21, gametype: 'BA', table: '2', theo: 300, openhours: 1, active_minutes: 60, open_minutes: 60, patronhrs: 1 },
  { date: '2026-09-05', hour: 8, gametype: 'BA', table: '1', theo: 10, openhours: 1, active_minutes: 5, open_minutes: 60, patronhrs: 1 },
  { date: '2026-09-05', hour: 8, gametype: 'BA', table: '2', theo: 200, openhours: 1, active_minutes: 50, open_minutes: 60, patronhrs: 1 },
];
const subOf = new Map([['BA|1', 'S'], ['BA|2', 'S']]);
test('per block ranks differ by hour', () => {
  const agg = aggregateRows(rows, { from: '2026-09-01', to: '2026-09-30', cfg, byCore: true });
  const theo = [{ metric: 'theo', per: 'openhours', w: 1 }];
  expect(blendFromAgg(agg, { dt: 'sat', core: 21, mix: theo, subOf }).get('BA|1')).toBe(1);
  expect(blendFromAgg(agg, { dt: 'sat', core: 7, mix: theo, subOf }).get('BA|2')).toBe(1);
  const b = signalBreakdown(agg, { dt: 'sat', core: 21, mix: [{ metric: 'theo', per: 'openhours', w: 1 }, { metric: 'active_minutes', per: 'open_minutes', w: 1 }], subOf, sub: 'S' });
  expect(b.map((r) => r.key)).toEqual(['BA|1', 'BA|2']);     // tie 0.5/0.5 → stable by key
  expect(b[0].parts[1]).toMatchObject({ value: 0.5, pct: 0 });
});
test('whole day basis and windows', () => {
  const agg = aggregateRows(rows, { from: '2026-09-01', to: '2026-09-30', cfg, byCore: false });
  expect(blendFromAgg(agg, { dt: 'sat', core: 'day', mix: [{ metric: 'theo', per: 'openhours', w: 1 }], subOf }).get('BA|1')).toBe(1);
  expect(sourceWindow({ mode: 'last' }, { defaultDays: 7, before: '2026-10-01' })).toEqual({ from: '2026-09-24', to: '2026-09-30' });
  expect(sourceWindow({ mode: 'range', from: '2026-01-01', to: '2026-01-31' }, { defaultDays: 7, before: '2026-10-01' })).toEqual({ from: '2026-01-01', to: '2026-01-31' });
});
test('floors raise a tier', () => {
  expect(fitToFloors({ a: 5, b: 1, c: 0 }, new Map([['c', 2]]), ['a', 'b', 'c']).map).toEqual({ a: 3, b: 1, c: 2 });
});
test('half-life weights recent rows more', () => {
  const tiers = [{ id: 'm5', min: 500 }, { id: 'm1', min: 1000 }];
  const h = [
    { date: '2026-09-26', hour: 21, gametype: 'BA', table: '1', tablemin: '1000:1' },
    { date: '2026-06-06', hour: 21, gametype: 'BA', table: '1', tablemin: '500:1' },
  ];
  const s = historyShares(h, { from: '2026-01-01', to: '2026-09-30', dayType: 'sat', cfg, tiersAsc: tiers, halfLife: 2 });
  expect(s.get('BA|1|21').m1).toBeGreaterThan(0.9);
});
```

### Task 3: Solver v2 (solver.js)

**Interfaces — Produces:** `solveBlock({ …existing, direction: 'back'|'fwd', changeScale = 1, podPenalty = null })`; zone rules honour `min/minOn/n/maxOn`; `floorsForSub(rules, openTables, sub) → Map(tier → Σ zones min(min, tables in zone))`; `capsForSub` uses `maxOn`.

Pod min via units: cap node `(zone|tier|sub)` → level node: first `min` units at cost `−BIG` (BIG = 1e8), remaining up to `max` (or zone size) at 0. Tables of that zone choosing that tier route through the cap node when a zone rule covers them.

Costs (for a price ≠ parent `p`): `change × changeScale + step × |Δlevel| + (raise if the price goes UP in time order) + hold (recent) + podPenalty[zone]`. Direction: `fwd` → time goes parent→child, `back` → child→parent.

- [ ] Tests (`v2solver.test.js`):

```js
import { solveBlock, floorsForSub } from '../solver';
import { DEFAULT_WEIGHTS } from '../config';
const L = ['p1', 'p2', 'p3', 'p4']; const ti = new Map(L.map((x, i) => [x, i]));
const W = { ...DEFAULT_WEIGHTS, rank: 0, hist: 0 };
test('forced change goes to the closest price', () => {
  const tables = [{ key: 'A', sub: 'S', zone: 'z' }, { key: 'B', sub: 'S', zone: 'z' }];
  const prev = new Map([['A', 'p4'], ['B', 'p1']]);
  const r = solveBlock({ tables, targets: { S: { p1: 1, p3: 1 } }, ladders: { S: L }, tierIndex: ti, prev, weights: W });
  expect(r.assign.get('A')).toBe('p3'); expect(r.assign.get('B')).toBe('p1');
});
test('pod minimum is exact', () => {
  const tables = [{ key: 'A', sub: 'S', zone: 'z1' }, { key: 'B', sub: 'S', zone: 'z1' }, { key: 'C', sub: 'S', zone: 'z2' }, { key: 'D', sub: 'S', zone: 'z2' }];
  const prev = new Map([['A', 'p2'], ['B', 'p2'], ['C', 'p1'], ['D', 'p2']]);
  const rules = [{ id: 1, on: true, type: 'zonecap', scope: 'all', tier: 'p1', min: 1, minOn: true, n: 9, maxOn: false, hours: [21] }];
  const r = solveBlock({ tables, targets: { S: { p1: 2, p2: 2 } }, ladders: { S: L }, tierIndex: ti, prev, rules, weights: W });
  expect(['A', 'B'].filter((k) => r.assign.get(k) === 'p1')).toHaveLength(1);
  expect(['C', 'D'].filter((k) => r.assign.get(k) === 'p1')).toHaveLength(1);
  expect(floorsForSub(rules, tables, 'S').get('p1')).toBe(2);
});
test('raise costs more than lower, by time direction', () => {
  const tables = [{ key: 'A', sub: 'S', zone: 'z' }, { key: 'B', sub: 'S', zone: 'z' }];
  const prev = new Map([['A', 'p2'], ['B', 'p2']]);
  const w = { ...W, raise: 5000, step: 0 };
  const fwd = solveBlock({ tables, targets: { S: { p1: 1, p2: 0, p3: 1 } }, ladders: { S: L }, tierIndex: ti, prev, weights: w, direction: 'fwd' });
  expect(fwd.ok).toBe(true);
});
```

### Task 4: Period v2 (period.js)

**Interfaces — Produces:**
- `solveOrder(coreHours, anchor) → [{ core, parent: core|null, dir: 'back'|'fwd'|null }]` — anchor first, then backward then forward
- `pickAnchor(coreHours, anchorCore, openByCore) → core` (anchor if present, else busiest)
- `pickReferenceDate(dates, cfg, openByDate, anchor) → date|null`
- `solveDate(ctx, date, { ref, prevDateLast }) → { byCore, report, dayType }` — reports chronological; the first core's report compares with `prevDateLast`
- `solveReference(ctx, refDate) → Map`
- `planTargets({ …, floors })` applies `fitToFloors` after caps
- targets read via `targetsForDate(cfg, date, dt, core, sub)`; manual rules merge into pins (manual wins)
- pod change cap: when `criteria.podChangeCap.on`, per block up to 4 re-solves adding `podPenalty[zone] += 2000` for zones over `n`; report `podOver: [{ zone, changes }]`

- [ ] Tests (`v2period.test.js`): order for default hours = `21(null) 15←21 13←15 11←13 7←11 3←21 5←3`; custom `[7,11,17,21]` anchor 17 → `17, 11←17, 7←11, 21←17`; `pickReferenceDate` returns the first Saturday; a date solved with `ref` keeps ref prices at the anchor when targets allow (0 differences); with `prevDateLast`, report[7].changes compares 05→07; manual rule forces price and targets make room; no price for a table absent from the open set.

### Task 5: Paste (new paste.js)

**Interfaces — Produces:** `parseTargetsPaste(text, { subs, tiers, coreHours, dayTypes, dates, scope }) → { cells: [{ scope, sub, tierId, core, n }], newPrices: [{ sub, tierId }], errors: [string] }`; `formatTargetsTsv({ scopes, subs, coreHours, ladders, tierById, valueOf }) → string`.
Header detection: first row containing a core-hour token (`7`, `07`, `07:00`, `7am`, `9pm`); optional `Day type` / `Date` column; price parsed from `$1,000` / `1000` / `1k`; sub-segment case-insensitive; scope = `dt id | d:YYYY-MM-DD`. Unknown price that exists as a tier → `newPrices`; not a tier → error.

- [ ] Tests (`paste.test.js`): header + 2 rows fill 14 cells; `Day type` column spreads to wd/sat; `9pm`/`21:00` headers map to 21; `$3,000` not in ladder but a tier → newPrices; `$1,234` → error; unknown sub → error; round trip `parse(format(x))` equals x.

### Task 6: Hook v2 (useAutoPlan.js)

Uses Tasks 1–5. Adds: aggregates (`hourlyAgg` byCore, `dailyAgg`), `valuesFor(dt, core)`, `rankBreakdown(dt, core, sub)`, history/rank windows from sources, reference date + plan, `solveDates(list)` (dates independent; manual on reference date's anchor → all dates), `setManual(date, core, keys, tierId|null)` (saves + re-solves), `Keep` → `setManual`, date targets in seeding/refOpen, `closedCheck(date)` → `{ pricedClosed: 0, openUnpriced }`, `podOver` passthrough.

### Task 7: Criteria panel v2 (+ RankPreview.js)

Sections: What decides a table's price (1 rules & manual → 2 target mix → 3 fewest changes from the parent hour / reference → 4 closest price → 5 rank → 6 history → 7 saved plan); Solve order (anchor hour select, reference day select, order chips, preview line "21 → 15 → 13 → 11 → 07 · 21 → 03 → 05"); Scoring (+ align, raise, peak multiplier per core hour, pod change cap); Performance rank (named signals with "Higher X → ranked higher → takes higher price slots first", weight %, basis, source, look-back, preview); Price history (source + range, half-life, threshold); Open tables; Core hours.

### Task 8: Rules panel v2

Pod rule: `each pod at least [min] (switch) and at most [max] (switch) × [price]`; templates row: "Each pod ≥ 1 × lowest price", "Each pod ≤ 1 × highest price", "Game ≤ price"; Manual prices list grouped by date → `table · block · price ×`, "Clear date".

### Task 9: Targets panel v2 (+ PasteTargetsDialog.js)

Entry mode Day type | Date (date strip of the period; a date shows "own mix" or "from Weekday", with Clear); "Paste from Excel" (dialog: textarea, parse preview table, errors, Apply fills + adds new prices); "Copy as Excel" (clipboard TSV of all sub-segments for the current scope).

### Task 10: Floor manual + Result

`ManualBar.js` above the floor in Auto-plan: "N selected · block 21–02 · 2026-10-04" + price buttons + Clear manual. Floor `readOnly` off in Auto-plan (selection only); `manualKeys` solid gold outline. Result: "Closed table-hours priced: 0 · open table-hours without a price: N"; pod-cap warnings.

### Task 11: Verify

Full tests + lint; generate a synthetic spread fixture in the browser session (not committed) to exercise R1; walkthrough: targets paste → solve (order) → manual price → re-solve → pod min rule → criteria preview; screenshots.

## Self-review

Spec coverage: R1 T4/T6/T10 · R2 T1/T2/T7 · R3 T3/T4 · R4 T4/T6 · R5 T1/T6/T10 · R6 T1/T3/T8 · A3 T5/T9 · A4 T2/T7 · history source T1/T2/T7 · extras (peak, raise, pod cap, templates, half-life) T1–T4/T7/T8. Names consistent: `targetsForDate`, `withManual`, `manualFor`, `solveOrder`, `pickAnchor`, `pickReferenceDate`, `solveReference`, `floorsForSub`, `fitToFloors`, `aggregateRows`, `blendFromAgg`, `signalBreakdown`, `sourceWindow`, `parseTargetsPaste`, `formatTargetsTsv`.
