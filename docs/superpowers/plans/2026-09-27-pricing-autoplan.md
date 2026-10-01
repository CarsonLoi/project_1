# Pricing Auto-plan Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an Auto-plan mode to Table Pricing that solves a whole period (targets × rules × schedule) with the fewest price changes, while every result stays manually adjustable (pins, keep-previous, block painting), per `docs/superpowers/specs/2026-09-27-pricing-autoplan-design.md`.

**Architecture:** Pure modules under `src/pricing/utils/autoplan/` (core hours & day types, config, inputs from history, min-cost-flow solver, period orchestration, apply) with Jest tests. `PricingDashboard.js` gains a third mode that renders the existing floor map / hourly charts from a draft store, plus new panels under `src/pricing/components/autoplan/`.

**Tech Stack:** React 19, MUI 9, ECharts (existing charts), CRA Jest.

## Global Constraints

- Core hours `[7, 11, 13, 15, 21, 3, 5]`; blocks 07–10, 11–12, 13–14, 15–20, 21–02, 03–04, 05–06.
- Day types `wd` (Mon–Thu), `fri`, `sat`, `sun`; per-date overrides.
- Weights `{ change: 10000, stay: 300, step: 20, rank: 10, hist: 10 }`.
- Assignment values stay `{ base, min, max, fixed? }`, optionally `pin: true`, `src: 'auto'`; `readPrice` unchanged.
- Existing pricing look: accent `#7adfff`, text `#dff5ff`, panels `rgba(255,255,255,0.045)` / borders `rgba(122,200,220,0.25)`, sizes from `PRICING_FONTS`.
- No commits (user rule). Tests: `$env:CI='true'; npx react-scripts test --watchAll=false src/pricing`.

---

### Task 1: Core hours, day types, config

**Files:** Create `src/pricing/utils/autoplan/core.js`, `src/pricing/utils/autoplan/config.js`; Test `src/pricing/utils/autoplan/__tests__/core.test.js`.

**Produces:** `CORE_HOURS, GAMING_HOURS, coreFor(h), blockHours(core), blockLabel(core), prevCore(core), DAY_TYPES, DEFAULT_DOW_MAP, dowOf(iso), dayTypeOf(iso, cfg), addDays(iso, n), datesBetween(from, to), nextMonthRange(todayIso)`; `DEFAULT_WEIGHTS, emptyAutoplan(), mergeAutoplan(stored), targetsFor(cfg, dt, core, sub), withTargets(cfg, dt, core, sub, map), withRules(cfg, rules)`.

```js
// FILE: src/pricing/utils/autoplan/core.js
// Auto-plan — core hours, blocks and day types.
// Prices are planned at 7 core hours; every other hour copies the core hour
// before it (gaming day 07:00 → 06:00).

export const CORE_HOURS = [7, 11, 13, 15, 21, 3, 5];
export const GAMING_HOURS = [7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 0, 1, 2, 3, 4, 5, 6];
const POS = new Map(GAMING_HOURS.map((h, i) => [h, i]));
const norm = (h) => ((Number(h) % 24) + 24) % 24;

export function coreFor(hour) {
    const p = POS.get(norm(hour));
    let c = CORE_HOURS[0];
    for (const k of CORE_HOURS) if (POS.get(k) <= p) c = k;
    return c;
}
export const blockHours = (core) => GAMING_HOURS.filter((h) => coreFor(h) === core);
const two = (h) => String(h).padStart(2, '0');
export function blockLabel(core) {
    const hs = blockHours(core);
    return hs.length > 1 ? `${two(hs[0])}–${two(hs[hs.length - 1])}` : two(hs[0]);
}
export const prevCore = (core) => { const i = CORE_HOURS.indexOf(core); return i > 0 ? CORE_HOURS[i - 1] : null; };

export const DAY_TYPES = [
    { id: 'wd', label: 'Weekday' },
    { id: 'fri', label: 'Friday' },
    { id: 'sat', label: 'Saturday' },
    { id: 'sun', label: 'Sunday' },
];
export const DEFAULT_DOW_MAP = { 0: 'sun', 1: 'wd', 2: 'wd', 3: 'wd', 4: 'wd', 5: 'fri', 6: 'sat' };
export const DOW_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const parse = (iso) => { const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)); };
const fmt = (dt) => dt.toISOString().slice(0, 10);
export const dowOf = (iso) => parse(iso).getUTCDay();
export function dayTypeOf(iso, cfg) {
    const o = cfg && cfg.overrides && cfg.overrides[iso];
    if (o) return o;
    return ((cfg && cfg.dowMap) || DEFAULT_DOW_MAP)[dowOf(iso)];
}
export const addDays = (iso, n) => fmt(new Date(parse(iso).getTime() + n * 86400000));
export function datesBetween(from, to) {
    const out = [];
    if (!from || !to || from > to) return out;
    for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
    return out;
}
export function nextMonthRange(todayIso) {
    const t = parse(todayIso);
    const first = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 1));
    const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 2, 0));
    return { from: fmt(first), to: fmt(last) };
}
```

```js
// FILE: src/pricing/utils/autoplan/config.js
// Auto-plan settings kept in the pricing store (store.autoplan): targets per
// day type × core hour × sub-segment, rules, day-type overrides, weights.

import { DEFAULT_DOW_MAP } from './core';

export const DEFAULT_WEIGHTS = { change: 10000, stay: 300, step: 20, rank: 10, hist: 10 };

export function emptyAutoplan() {
    return { targets: {}, rules: [], overrides: {}, dowMap: { ...DEFAULT_DOW_MAP }, weights: { ...DEFAULT_WEIGHTS }, nextRuleId: 1 };
}

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);

export function mergeAutoplan(stored) {
    const base = emptyAutoplan();
    if (!isObj(stored)) return base;
    return {
        targets: isObj(stored.targets) ? stored.targets : {},
        rules: Array.isArray(stored.rules) ? stored.rules.filter((r) => r && r.type && r.id != null) : [],
        overrides: isObj(stored.overrides) ? stored.overrides : {},
        dowMap: { ...base.dowMap, ...(isObj(stored.dowMap) ? stored.dowMap : {}) },
        weights: { ...base.weights, ...(isObj(stored.weights) ? stored.weights : {}) },
        nextRuleId: Number.isFinite(stored.nextRuleId) ? stored.nextRuleId : Math.max(0, ...((stored.rules || []).map((r) => Number(r.id) || 0))) + 1,
    };
}

export const targetsFor = (cfg, dt, core, sub) => (((cfg.targets || {})[dt] || {})[core] || {})[sub] || null;

export function withTargets(cfg, dt, core, sub, map) {
    const t = cfg.targets || {};
    return {
        ...cfg,
        targets: { ...t, [dt]: { ...(t[dt] || {}), [core]: { ...((t[dt] || {})[core] || {}), [sub]: { ...map } } } },
    };
}

export const withRules = (cfg, rules) => ({ ...cfg, rules });
```

- [ ] **Step 1: Write the failing test**

```js
// FILE: src/pricing/utils/autoplan/__tests__/core.test.js
import { coreFor, blockHours, blockLabel, prevCore, dayTypeOf, datesBetween, nextMonthRange, addDays } from '../core';
import { mergeAutoplan, emptyAutoplan, withTargets, targetsFor } from '../config';

test('every hour maps to the core hour before it', () => {
    expect([7, 8, 10, 11, 12, 13, 14, 15, 20, 21, 23, 0, 2, 3, 4, 5, 6].map(coreFor))
        .toEqual([7, 7, 7, 11, 11, 13, 13, 15, 15, 21, 21, 21, 21, 3, 3, 5, 5]);
    expect(blockHours(21)).toEqual([21, 22, 23, 0, 1, 2]);
    expect(blockLabel(7)).toBe('07–10');
    expect(blockLabel(3)).toBe('03–04');
    expect(prevCore(7)).toBeNull();
    expect(prevCore(3)).toBe(21);
});

test('day types from weekday and overrides', () => {
    const cfg = emptyAutoplan();
    expect(dayTypeOf('2026-10-01', cfg)).toBe('wd');     // Thu
    expect(dayTypeOf('2026-10-02', cfg)).toBe('fri');
    expect(dayTypeOf('2026-10-03', cfg)).toBe('sat');
    expect(dayTypeOf('2026-10-04', cfg)).toBe('sun');
    expect(dayTypeOf('2026-10-01', { ...cfg, overrides: { '2026-10-01': 'sat' } })).toBe('sat');
});

test('date helpers', () => {
    expect(datesBetween('2026-09-29', '2026-10-02')).toEqual(['2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02']);
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(nextMonthRange('2026-09-27')).toEqual({ from: '2026-10-01', to: '2026-10-31' });
});

test('config merge and targets', () => {
    const m = mergeAutoplan({ rules: [{ id: 4, type: 'maxstep' }, null], weights: { step: 5 } });
    expect(m.rules).toHaveLength(1);
    expect(m.nextRuleId).toBe(5);
    expect(m.weights).toMatchObject({ change: 10000, step: 5 });
    const c = withTargets(m, 'wd', 7, 'Main', { m500: 3 });
    expect(targetsFor(c, 'wd', 7, 'Main')).toEqual({ m500: 3 });
    expect(targetsFor(c, 'fri', 7, 'Main')).toBeNull();
    expect(mergeAutoplan('x')).toEqual(emptyAutoplan());
});
```

- [ ] **Step 2: Run — expect FAIL** (module missing) · **Step 3:** create the two files above · **Step 4: Run — expect PASS**

---

### Task 2: Inputs — history shares, values, ladders, targets

**Files:** Create `src/pricing/utils/autoplan/inputs.js`; Test `src/pricing/utils/autoplan/__tests__/inputs.test.js`.

**Produces:** `snapTier(value, tiersAsc) → tierId`, `openByBlock(openByHour, tables) → { byCore: Map<core, Set<key>>, assumedAllOpen }`, `historyShares(hourlyRows, { from, to, dayType, cfg, tiersAsc }) → Map<'key|core', {tierId: share}>`, `tableValues(dailyRows, { from, to, dayType, cfg }) → Map<key, number>`, `laddersFrom(shares, tables, tiersAsc) → {sub: tierId[] asc}`, `allocate(weights, n, ladder) → {tierId: n}`, `seedTargets({ tables, openByCore, shares, ladders }) → {core: {sub: {tierId: n}}}`, `fitToCount(map, n, ladder)`, `fitToCaps(map, caps, ladder) → { map, moved }`.

```js
// FILE: src/pricing/utils/autoplan/inputs.js
// Auto-plan — inputs derived from the feeds the page already loads:
// which tables are open in each block, each table's price history and
// performance value, the prices each sub-segment uses, and history-seeded
// targets. Pure; tested.

import { parseTablemin, gametypeTableKey } from '../../../performance/utils/dataSource';
import { CORE_HOURS, blockHours, coreFor, dayTypeOf } from './core';

export function snapTier(value, tiersAsc) {
    let best = null, bestD = Infinity;
    for (const t of tiersAsc) { const d = Math.abs((t.min || 0) - Number(value)); if (d < bestD) { bestD = d; best = t.id; } }
    return best;
}

// Tables needing a price in each block = open at ANY hour of the block.
// No schedule → every live table (flagged, so the UI can say so).
export function openByBlock(openByHour, tables) {
    const live = new Set(tables.map((t) => t.key));
    const byCore = new Map();
    for (const core of CORE_HOURS) {
        const set = new Set();
        if (!openByHour) for (const k of live) set.add(k);
        else for (const h of blockHours(core)) for (const k of (openByHour.get(h) || [])) if (live.has(k)) set.add(k);
        byCore.set(core, set);
    }
    return { byCore, assumedAllOpen: !openByHour };
}

function dayTypeCache(cfg) {
    const m = new Map();
    return (d) => { if (!m.has(d)) m.set(d, dayTypeOf(d, cfg)); return m.get(d); };
}

// Share of each price a table actually ran, per core-hour block, for one day type.
export function historyShares(hourlyRows, { from, to, dayType, cfg, tiersAsc }) {
    const dtOf = dayTypeCache(cfg);
    const snap = new Map();
    const acc = new Map();
    for (const r of hourlyRows || []) {
        const d = String(r.date || '').slice(0, 10);
        if (!d || d < from || d > to || dtOf(d) !== dayType) continue;
        const h = Number(r.hour);
        if (!Number.isFinite(h)) continue;
        const hist = parseTablemin(r.tablemin);
        const mins = Object.keys(hist);
        if (!mins.length) continue;
        const k = `${gametypeTableKey(r.gametype, r.table)}|${coreFor(h)}`;
        let e = acc.get(k);
        if (!e) { e = {}; acc.set(k, e); }
        for (const m of mins) {
            if (!snap.has(m)) snap.set(m, snapTier(Number(m), tiersAsc));
            const id = snap.get(m);
            e[id] = (e[id] || 0) + hist[m];
        }
    }
    for (const e of acc.values()) {
        const tot = Object.values(e).reduce((a, b) => a + b, 0) || 1;
        for (const id of Object.keys(e)) e[id] /= tot;
    }
    return acc;
}

// Theo per patron-hour over the day type's dates in the window.
export function tableValues(dailyRows, { from, to, dayType, cfg }) {
    const dtOf = dayTypeCache(cfg);
    const acc = new Map();
    for (const r of dailyRows || []) {
        const d = String(r.date || '').slice(0, 10);
        if (!d || d < from || d > to || dtOf(d) !== dayType) continue;
        const k = gametypeTableKey(r.gametype, r.table);
        const a = acc.get(k) || { theo: 0, ph: 0 };
        a.theo += Number(r.theo) || 0;
        a.ph += Number(r.patronhrs) || 0;
        acc.set(k, a);
    }
    const out = new Map();
    for (const [k, a] of acc) out.set(k, a.ph > 0 ? a.theo / a.ph : 0);
    return out;
}

// Prices a sub-segment uses: ≥ 1% of its history weight. None → every price.
export function laddersFrom(shares, tables, tiersAsc) {
    const subOf = new Map(tables.map((t) => [t.key, t.sub]));
    const w = {};
    for (const [k, e] of shares) {
        const sub = subOf.get(k.slice(0, k.lastIndexOf('|')));
        if (!sub) continue;
        w[sub] = w[sub] || {};
        for (const [id, s] of Object.entries(e)) w[sub][id] = (w[sub][id] || 0) + s;
    }
    const out = {};
    for (const sub of new Set(tables.map((t) => t.sub))) {
        const e = w[sub] || {};
        const tot = Object.values(e).reduce((a, b) => a + b, 0);
        const ids = tiersAsc.map((t) => t.id).filter((id) => tot > 0 && (e[id] || 0) / tot >= 0.01);
        out[sub] = ids.length ? ids : tiersAsc.map((t) => t.id);
    }
    return out;
}

// Largest-remainder split of n over weights, restricted to the ladder.
export function allocate(weights, n, ladder) {
    const ws = ladder.map((id) => Math.max(0, Number(weights[id]) || 0));
    let tot = ws.reduce((a, b) => a + b, 0);
    const use = tot > 0 ? ws : ladder.map(() => 1);
    tot = use.reduce((a, b) => a + b, 0);
    const raw = use.map((x) => (x / tot) * n);
    const out = raw.map(Math.floor);
    const rem = n - out.reduce((a, b) => a + b, 0);
    raw.map((x, i) => [x - Math.floor(x), i]).sort((a, b) => b[0] - a[0] || a[1] - b[1]).slice(0, rem).forEach(([, i]) => { out[i] += 1; });
    return Object.fromEntries(ladder.map((id, i) => [id, out[i]]));
}

export const fitToCount = (map, n, ladder) => allocate(map || {}, n, ladder);

// Trim tiers over their cap; the overflow moves down one price (up if none below).
export function fitToCaps(map, caps, ladder) {
    const out = { ...map };
    let moved = 0;
    for (let i = ladder.length - 1; i >= 0; i--) {
        const id = ladder[i];
        const cap = caps.get(id);
        if (cap == null || (out[id] || 0) <= cap) continue;
        const over = out[id] - cap;
        out[id] = cap;
        moved += over;
        const to = ladder[i - 1] ?? ladder[i + 1];
        if (to != null) out[to] = (out[to] || 0) + over;
    }
    return { map: out, moved };
}

// Targets from what the open tables actually ran (day type, core hour).
export function seedTargets({ tables, openByCore, shares, ladders }) {
    const out = {};
    for (const core of CORE_HOURS) {
        out[core] = {};
        const open = openByCore.get(core) || new Set();
        for (const sub of Object.keys(ladders)) {
            const ts = tables.filter((t) => t.sub === sub && open.has(t.key));
            const w = {};
            let known = 0;
            for (const t of ts) {
                const e = shares.get(`${t.key}|${core}`);
                if (!e) continue;
                known += 1;
                for (const [id, s] of Object.entries(e)) w[id] = (w[id] || 0) + s;
            }
            // Tables without history take the sub-segment's average mix.
            if (known && known < ts.length) for (const id of Object.keys(w)) w[id] *= ts.length / known;
            out[core][sub] = allocate(w, ts.length, ladders[sub]);
        }
    }
    return out;
}
```

- [ ] **Step 1: Write the failing test**

```js
// FILE: src/pricing/utils/autoplan/__tests__/inputs.test.js
import { snapTier, openByBlock, historyShares, tableValues, laddersFrom, allocate, fitToCaps, seedTargets } from '../inputs';
import { emptyAutoplan } from '../config';

const tiers = [100, 300, 500, 1000].map((m) => ({ id: `m${m}`, min: m }));
const tables = [
    { key: 'BA|1', sub: 'Main' }, { key: 'BA|2', sub: 'Main' }, { key: 'BA|3', sub: 'Main' }, { key: 'BA|4', sub: 'VIP' },
];

test('snap and allocate', () => {
    expect(snapTier(480, tiers)).toBe('m500');
    expect(allocate({ m300: 1, m500: 1 }, 3, ['m300', 'm500'])).toEqual({ m300: 2, m500: 1 });
    expect(allocate({}, 4, ['m100', 'm300'])).toEqual({ m100: 2, m300: 2 });
});

test('open by block: union of block hours, or everything without a schedule', () => {
    const oh = new Map([[7, new Set(['BA|1'])], [9, new Set(['BA|2'])], [11, new Set(['BA|3', 'X|9'])]]);
    const r = openByBlock(oh, tables);
    expect([...r.byCore.get(7)].sort()).toEqual(['BA|1', 'BA|2']);
    expect([...r.byCore.get(11)]).toEqual(['BA|3']);
    expect(openByBlock(null, tables).assumedAllOpen).toBe(true);
    expect(openByBlock(null, tables).byCore.get(21).size).toBe(4);
});

const cfg = emptyAutoplan();
const hourly = [
    { date: '2026-09-03', hour: 8, gametype: 'BA', table: '1', tablemin: '500:3,1000:1' },   // Thu → wd, core 7
    { date: '2026-09-03', hour: 12, gametype: 'BA', table: '1', tablemin: '300:1' },         // core 11
    { date: '2026-09-04', hour: 8, gametype: 'BA', table: '1', tablemin: '100:9' },          // Fri → not wd
    { date: '2026-09-03', hour: 8, gametype: 'BA', table: '4', tablemin: '1000:1' },
];

test('history shares per table and core hour, one day type', () => {
    const s = historyShares(hourly, { from: '2026-09-01', to: '2026-09-30', dayType: 'wd', cfg, tiersAsc: tiers });
    expect(s.get('BA|1|7')).toEqual({ m500: 0.75, m1000: 0.25 });
    expect(s.get('BA|1|11')).toEqual({ m300: 1 });
    expect(s.has('BA|2|7')).toBe(false);
});

test('values and ladders', () => {
    const v = tableValues([{ date: '2026-09-03', gametype: 'BA', table: '1', theo: 100, patronhrs: 4 }], { from: '2026-09-01', to: '2026-09-30', dayType: 'wd', cfg });
    expect(v.get('BA|1')).toBe(25);
    const s = historyShares(hourly, { from: '2026-09-01', to: '2026-09-30', dayType: 'wd', cfg, tiersAsc: tiers });
    const l = laddersFrom(s, tables, tiers);
    expect(l.Main).toEqual(['m300', 'm500', 'm1000']);
    expect(l.VIP).toEqual(['m1000']);
});

test('fit to caps moves overflow down', () => {
    const r = fitToCaps({ m300: 1, m500: 2, m1000: 4 }, new Map([['m1000', 1]]), ['m300', 'm500', 'm1000']);
    expect(r.map).toEqual({ m300: 1, m500: 5, m1000: 1 });
    expect(r.moved).toBe(3);
});

test('seed targets sized to open tables', () => {
    const s = historyShares(hourly, { from: '2026-09-01', to: '2026-09-30', dayType: 'wd', cfg, tiersAsc: tiers });
    const open = new Map([[7, new Set(['BA|1', 'BA|2', 'BA|3'])], [11, new Set(['BA|1'])], [13, new Set()], [15, new Set()], [21, new Set()], [3, new Set()], [5, new Set()]]);
    const t = seedTargets({ tables, openByCore: open, shares: s, ladders: { Main: ['m300', 'm500', 'm1000'], VIP: ['m1000'] } });
    expect(Object.values(t[7].Main).reduce((a, b) => a + b, 0)).toBe(3);
    expect(t[7].Main.m500).toBeGreaterThan(t[7].Main.m1000);
    expect(t[11].Main).toEqual({ m300: 1, m500: 0, m1000: 0 });
    expect(Object.values(t[7].VIP).reduce((a, b) => a + b, 0)).toBe(0);
});
```

- [ ] **Step 2: FAIL · Step 3: implement · Step 4: PASS**

---

### Task 3: Solver

**Files:** Create `src/pricing/utils/autoplan/solver.js`; Test `src/pricing/utils/autoplan/__tests__/solver.test.js`.

**Produces:** `inScope(t, scope)`, `rulesFor(rules, core)`, `capsForSub(rules, openTables, sub) → Map<tierId, limit>`, `solveBlock(args) → { assign: Map<key, tierId>, ok, unplaced: string[], notes: string[], targets }`, `changesBetween(a, b) → [{key, from, to}]`, `lowerBound(prev, targets, openTables) → number`, `diagnose(args) → string[]`.

Scopes: `'all' | 'sub:<sub>' | 'gt:<game>' | 'zone:<zone>' | 'table:<key>'`. Rule shapes: `{ id, on, type: 'zonecap', scope, tier, n, hours }`, `{ type: 'range', scope, lo, hi, hours }` (tier ids), `{ type: 'lock', scope, tier, hours }`, `{ type: 'maxstep', scope, n, hours }`.

```js
// FILE: src/pricing/utils/autoplan/solver.js
// Auto-plan solver — one core-hour block at a time, as a min-cost flow:
//   source → table → (zone-cap node) → (sub-segment × price, cap = target) → sink
// The change weight dominates every other term, so each block keeps the
// most tables at their previous price that the targets and rules allow;
// the smaller terms decide WHICH tables move.

export function MCMF(n) {
    const g = Array.from({ length: n }, () => []);
    return {
        add(u, v, cap, cost) {
            g[u].push({ v, cap, cost, rev: g[v].length });
            g[v].push({ v: u, cap: 0, cost: -cost, rev: g[u].length - 1 });
            return g[u][g[u].length - 1];
        },
        run(s, t, need) {
            let flow = 0;
            const dist = new Float64Array(n), inq = new Uint8Array(n), pv = new Int32Array(n), pe = new Int32Array(n);
            while (flow < need) {
                dist.fill(Infinity); dist[s] = 0; inq.fill(0);
                const q = [s]; inq[s] = 1;
                for (let qi = 0; qi < q.length; qi++) {
                    const u = q[qi]; inq[u] = 0;
                    for (let i = 0; i < g[u].length; i++) {
                        const e = g[u][i];
                        if (e.cap > 0 && dist[u] + e.cost < dist[e.v] - 1e-9) {
                            dist[e.v] = dist[u] + e.cost; pv[e.v] = u; pe[e.v] = i;
                            if (!inq[e.v]) { inq[e.v] = 1; q.push(e.v); }
                        }
                    }
                }
                if (dist[t] === Infinity) break;
                let f = need - flow;
                for (let v = t; v !== s; v = pv[v]) f = Math.min(f, g[pv[v]][pe[v]].cap);
                for (let v = t; v !== s; v = pv[v]) { const e = g[pv[v]][pe[v]]; e.cap -= f; g[v][e.rev].cap += f; }
                flow += f;
            }
            return flow;
        },
    };
}

export function inScope(t, scope) {
    if (!scope || scope === 'all') return true;
    const [kind, val] = [scope.slice(0, scope.indexOf(':')), scope.slice(scope.indexOf(':') + 1)];
    if (kind === 'sub') return t.sub === val;
    if (kind === 'gt') return t.gametype === val;
    if (kind === 'zone') return t.zone === val;
    if (kind === 'table') return t.key === val;
    return false;
}
export const rulesFor = (rules, core) => (rules || []).filter((r) => r.on && (r.hours || []).includes(core));

// Tier limits a sub-segment's zone caps allow in total (zones × n).
export function capsForSub(rules, openTables, sub) {
    const caps = new Map();
    const ts = openTables.filter((t) => t.sub === sub);
    for (const r of rules) {
        if (r.type !== 'zonecap') continue;
        const zones = new Set(ts.filter((t) => inScope(t, r.scope)).map((t) => t.zone));
        if (!zones.size) continue;
        const inScopeAll = ts.every((t) => inScope(t, r.scope));
        if (!inScopeAll) continue;              // partial scopes can't be summarised safely
        const lim = zones.size * r.n;
        caps.set(r.tier, Math.min(caps.get(r.tier) ?? Infinity, lim));
    }
    return caps;
}

export function changesBetween(a, b) {
    const out = [];
    for (const [k, to] of b) if (a && a.has(k) && a.get(k) !== to) out.push({ key: k, from: a.get(k), to });
    return out;
}

// Fewest changes the targets allow (rules ignored): per sub-segment, tables
// open in both blocks minus those that can keep their price.
export function lowerBound(prev, targets, openTables) {
    if (!prev) return 0;
    let lb = 0;
    const bySub = new Map();
    for (const t of openTables) {
        if (!prev.has(t.key)) continue;
        if (!bySub.has(t.sub)) bySub.set(t.sub, {});
        const c = bySub.get(t.sub);
        c[prev.get(t.key)] = (c[prev.get(t.key)] || 0) + 1;
    }
    for (const [sub, c] of bySub) {
        const tg = targets[sub] || {};
        let both = 0, keep = 0;
        for (const [id, n] of Object.entries(c)) { both += n; keep += Math.min(n, tg[id] || 0); }
        lb += both - keep;
    }
    return lb;
}

// Pinned tables take their slot: raise the pinned price's target and take
// the table from the price with the most unpinned room.
function accommodatePins(targets, pins, openTables) {
    const out = {};
    const notes = [];
    for (const sub of Object.keys(targets)) out[sub] = { ...targets[sub] };
    const pinCount = {};
    for (const t of openTables) {
        if (!pins.has(t.key)) continue;
        const id = pins.get(t.key);
        pinCount[t.sub] = pinCount[t.sub] || {};
        pinCount[t.sub][id] = (pinCount[t.sub][id] || 0) + 1;
    }
    for (const [sub, pc] of Object.entries(pinCount)) {
        const tg = out[sub] || (out[sub] = {});
        for (const [id, n] of Object.entries(pc)) {
            let need = n - (tg[id] || 0);
            if (need <= 0) continue;
            tg[id] = n;
            const moved = need;
            while (need > 0) {
                let best = null, room = 0;
                for (const [oid, c] of Object.entries(tg)) {
                    if (oid === id) continue;
                    const r = c - ((pc[oid]) || 0);
                    if (r > room) { room = r; best = oid; }
                }
                if (!best) break;
                tg[best] -= 1; need -= 1;
            }
            notes.push(`${sub}: ${moved} target table${moved === 1 ? '' : 's'} moved to ${id} for pinned tables`);
        }
    }
    return { targets: out, notes };
}

export function solveBlock({
    tables, targets, ladders, tierIndex, prev = null, current = null, shares = null,
    pins = new Map(), rules = [], weights, sticky = true,
}) {
    const W = weights;
    const { targets: tg, notes } = accommodatePins(targets, pins, tables);
    // Price each table's performance rank implies, given the targets.
    const rankLvl = new Map();
    for (const sub of Object.keys(ladders)) {
        const ts = tables.filter((t) => t.sub === sub).sort((a, b) => (b.value || 0) - (a.value || 0));
        const slots = [];
        for (const id of [...ladders[sub]].reverse()) for (let i = 0; i < ((tg[sub] || {})[id] || 0); i++) slots.push(id);
        ts.forEach((t, i) => rankLvl.set(t.key, tierIndex.get(slots[Math.min(i, slots.length - 1)] ?? ladders[sub][0])));
    }
    let N = 2;
    const tNode = new Map(tables.map((t) => [t.key, N++]));
    const lNode = new Map();
    for (const sub of Object.keys(ladders)) for (const id of ladders[sub]) lNode.set(`${sub}|${id}`, N++);
    const caps = new Map();
    for (const r of rules.filter((x) => x.type === 'zonecap')) {
        for (const t of tables) {
            if (!inScope(t, r.scope)) continue;
            const k = `${t.zone}|${r.tier}|${t.sub}`;
            const c = caps.get(k);
            if (!c) caps.set(k, { node: N++, n: r.n, sub: t.sub, tier: r.tier }); else c.n = Math.min(c.n, r.n);
        }
    }
    const f = MCMF(N);
    const arcsBy = new Map();
    const unplaced = [];
    for (const t of tables) {
        const u = tNode.get(t.key);
        f.add(0, u, 1, 0);
        const p = prev ? prev.get(t.key) : undefined;
        const pinned = pins.has(t.key);
        let allowed = [...(ladders[t.sub] || [])];
        for (const r of rules) {
            if (!inScope(t, r.scope)) continue;
            if (r.type === 'range') allowed = allowed.filter((id) => tierIndex.get(id) >= tierIndex.get(r.lo) && tierIndex.get(id) <= tierIndex.get(r.hi));
            if (r.type === 'lock') allowed = [r.tier];
            if (r.type === 'maxstep' && sticky && p != null && !pinned) allowed = allowed.filter((id) => Math.abs(tierIndex.get(id) - tierIndex.get(p)) <= r.n);
        }
        if (pinned) allowed = [pins.get(t.key)];
        allowed = allowed.filter((id) => lNode.has(`${t.sub}|${id}`));
        if (!allowed.length) { unplaced.push(t.key); continue; }
        const sh = shares ? shares.get(t.key) || {} : {};
        const arcs = [];
        for (const id of allowed) {
            const k = tierIndex.get(id);
            let c = W.rank * Math.abs(k - (rankLvl.get(t.key) ?? k)) + Math.round(W.hist * (1 - (sh[id] || 0)));
            if (sticky && p != null && id !== p) c += W.change + W.step * Math.abs(k - tierIndex.get(p));
            if (current && current.has(t.key) && current.get(t.key) !== id) c += W.stay;
            const cap = caps.get(`${t.zone}|${id}|${t.sub}`);
            arcs.push([id, f.add(u, cap ? cap.node : lNode.get(`${t.sub}|${id}`), 1, c)]);
        }
        arcsBy.set(t.key, arcs);
    }
    for (const c of caps.values()) f.add(c.node, lNode.get(`${c.sub}|${c.tier}`), c.n, 0);
    for (const sub of Object.keys(ladders)) for (const id of ladders[sub]) f.add(lNode.get(`${sub}|${id}`), 1, (tg[sub] || {})[id] || 0, 0);
    const flow = f.run(0, 1, tables.length);
    const assign = new Map();
    for (const [key, arcs] of arcsBy) for (const [id, e] of arcs) if (e.cap === 0) assign.set(key, id);
    for (const t of tables) if (!assign.has(t.key) && !unplaced.includes(t.key)) unplaced.push(t.key);
    return { assign, ok: flow === tables.length && !unplaced.length, unplaced, notes, targets: tg };
}

// Why a block can't be solved — the clashes a person can fix.
export function diagnose({ tables, targets, rules, pins = new Map(), tierLabel = (id) => id }) {
    const out = [];
    const subs = new Set(tables.map((t) => t.sub));
    for (const sub of subs) {
        const ts = tables.filter((t) => t.sub === sub);
        const tot = Object.values(targets[sub] || {}).reduce((a, b) => a + b, 0);
        if (tot !== ts.length) out.push(`${sub}: targets add up to ${tot} but ${ts.length} tables are open`);
        for (const r of rules.filter((x) => x.type === 'zonecap')) {
            const zs = new Set(ts.filter((t) => inScope(t, r.scope)).map((t) => t.zone));
            const want = (targets[sub] || {})[r.tier] || 0;
            if (zs.size && ts.every((t) => inScope(t, r.scope)) && want > zs.size * r.n) out.push(`${sub}: target ${want} × ${tierLabel(r.tier)} but "max ${r.n} per zone" allows ${zs.size * r.n}`);
            const perZone = {};
            for (const t of ts) if (inScope(t, r.scope) && pins.get(t.key) === r.tier) perZone[t.zone] = (perZone[t.zone] || 0) + 1;
            for (const [z, c] of Object.entries(perZone)) if (c > r.n) out.push(`${sub} zone ${z}: ${c} pinned at ${tierLabel(r.tier)} but the cap is ${r.n}`);
        }
    }
    for (const t of tables) {
        if (!pins.has(t.key)) continue;
        for (const r of rules) {
            if (!inScope(t, r.scope)) continue;
            if (r.type === 'lock' && r.tier !== pins.get(t.key)) out.push(`${t.key}: pinned at ${tierLabel(pins.get(t.key))} but locked at ${tierLabel(r.tier)}`);
        }
    }
    return out;
}
```

- [ ] **Step 1: Write the failing test**

```js
// FILE: src/pricing/utils/autoplan/__tests__/solver.test.js
import { solveBlock, lowerBound, changesBetween, diagnose, inScope, capsForSub } from '../solver';
import { DEFAULT_WEIGHTS } from '../config';

const tiers = ['m100', 'm300', 'm500', 'm1000'];
const tierIndex = new Map(tiers.map((id, i) => [id, i]));
const mk = (n, sub = 'Main', zoneSize = 3) => Array.from({ length: n }, (_, i) => ({ key: `BA|${i + 1}`, sub, zone: `Z${Math.floor(i / zoneSize)}`, gametype: 'BA', value: n - i }));
const W = DEFAULT_WEIGHTS;
const ladders = { Main: tiers };
const count = (assign) => { const c = {}; for (const v of assign.values()) c[v] = (c[v] || 0) + 1; return c; };

test('meets targets exactly; highest value tables take the highest prices', () => {
    const tables = mk(6);
    const r = solveBlock({ tables, targets: { Main: { m100: 1, m300: 2, m500: 2, m1000: 1 } }, ladders, tierIndex, weights: W });
    expect(r.ok).toBe(true);
    expect(count(r.assign)).toEqual({ m100: 1, m300: 2, m500: 2, m1000: 1 });
    expect(r.assign.get('BA|1')).toBe('m1000');
    expect(r.assign.get('BA|6')).toBe('m100');
});

test('change count equals the lower bound when rules are off', () => {
    const tables = mk(12);
    const a = solveBlock({ tables, targets: { Main: { m100: 3, m300: 3, m500: 3, m1000: 3 } }, ladders, tierIndex, weights: W }).assign;
    const next = { Main: { m100: 1, m300: 3, m500: 4, m1000: 4 } };
    const b = solveBlock({ tables, targets: next, ladders, tierIndex, prev: a, weights: W }).assign;
    expect(changesBetween(a, b).length).toBe(lowerBound(a, next, tables));
    expect(lowerBound(a, next, tables)).toBe(2);
});

test('zone cap, range, lock and max step are never broken', () => {
    const tables = mk(9);
    const rules = [
        { type: 'zonecap', scope: 'sub:Main', tier: 'm1000', n: 1, on: true, hours: [7] },
        { type: 'range', scope: 'table:BA|9', lo: 'm100', hi: 'm300', on: true, hours: [7] },
        { type: 'lock', scope: 'table:BA|5', tier: 'm500', on: true, hours: [7] },
    ];
    const r = solveBlock({ tables, targets: { Main: { m100: 2, m300: 2, m500: 2, m1000: 3 } }, ladders, tierIndex, rules, weights: W });
    expect(r.ok).toBe(true);
    const perZone = {};
    for (const [k, v] of r.assign) if (v === 'm1000') { const z = tables.find((t) => t.key === k).zone; perZone[z] = (perZone[z] || 0) + 1; }
    expect(Math.max(...Object.values(perZone))).toBe(1);
    expect(['m100', 'm300']).toContain(r.assign.get('BA|9'));
    expect(r.assign.get('BA|5')).toBe('m500');

    const prev = new Map(tables.map((t) => [t.key, 'm100']));
    const s = solveBlock({ tables, targets: { Main: { m100: 3, m300: 3, m500: 3, m1000: 0 } }, ladders, tierIndex, prev, rules: [{ type: 'maxstep', scope: 'all', n: 1, on: true, hours: [7] }], weights: W });
    expect(s.ok).toBe(false);                 // m500 is two steps from m100 for everyone
});

test('pins are kept and the targets make room for them', () => {
    const tables = mk(4);
    const pins = new Map([['BA|4', 'm1000']]);
    const r = solveBlock({ tables, targets: { Main: { m100: 2, m300: 2, m500: 0, m1000: 0 } }, ladders, tierIndex, pins, weights: W });
    expect(r.ok).toBe(true);
    expect(r.assign.get('BA|4')).toBe('m1000');
    expect(r.notes.length).toBe(1);
    expect(count(r.assign)).toEqual({ m100: 1, m300: 2, m1000: 1 });
});

test('stay close to the current plan when nothing else decides', () => {
    const tables = mk(4);
    const current = new Map([['BA|1', 'm100'], ['BA|2', 'm1000'], ['BA|3', 'm300'], ['BA|4', 'm500']]);
    const r = solveBlock({ tables, targets: { Main: { m100: 1, m300: 1, m500: 1, m1000: 1 } }, ladders, tierIndex, current, weights: W });
    expect([...r.assign.entries()].every(([k, v]) => current.get(k) === v)).toBe(true);
});

test('scopes, caps and diagnosis', () => {
    const t = { key: 'BA|1', sub: 'VIP', zone: 'Z1', gametype: 'BA' };
    expect(['all', 'sub:VIP', 'gt:BA', 'zone:Z1', 'table:BA|1'].every((s) => inScope(t, s))).toBe(true);
    expect(inScope(t, 'sub:Main')).toBe(false);
    const tables = mk(6);
    const rules = [{ type: 'zonecap', scope: 'sub:Main', tier: 'm1000', n: 1, on: true, hours: [7] }];
    expect(capsForSub(rules, tables, 'Main').get('m1000')).toBe(2);
    const msgs = diagnose({ tables, targets: { Main: { m100: 1, m1000: 4 } }, rules });
    expect(msgs.some((m) => m.includes('add up to 5'))).toBe(true);
    expect(msgs.some((m) => m.includes('allows 2'))).toBe(true);
});
```

- [ ] **Step 2: FAIL · Step 3: implement · Step 4: PASS**

---

### Task 4: Period orchestration and apply

**Files:** Create `src/pricing/utils/autoplan/period.js`, `src/pricing/utils/autoplan/apply.js`; Modify `src/pricing/utils/pricingModel.js` (add `isPinned`, `isAuto`), `src/pricing/utils/floorConfig.js` (add `zone`); Test `src/pricing/utils/autoplan/__tests__/period.test.js`.

**Produces:**
- `planTargets({ cfg, dt, core, sub, openCount, ladder, seeded, caps }) → {tierId: n}` — stored target (or seeded) fitted to the date's open count, then to caps.
- `solveDate(ctx, date, prevAssign) → { byCore: {core: Map}, report: {core: {ok, notes, problems, lb, changes}} }` where `ctx = { cfg, tables, tiersAsc, tierIndex, ladders, sharesByDt, valuesByDt, seededByDt, openByDate: {date: Map<core, Set>}, currentByDate: {date: {core: Map}}, pinsByDate: {date: {core: Map}}, keepPins, stayClose }`.
- `readBlockMap(store, date, core) → Map<key, tierId>`, `readPins(store, date, core) → Map<key, tierId>`.
- `applyDraft(store, draft, { openHoursByDate, pinsByDate, versionName }) → store` (saves once).

```js
// FILE: src/pricing/utils/autoplan/period.js
// Auto-plan — solve a whole period, date by date, each date chained to the
// previous one (its 07:00 block starts from the previous date's 05:00).

import { CORE_HOURS, dayTypeOf, prevCore } from './core';
import { targetsFor } from './config';
import { fitToCount, fitToCaps } from './inputs';
import { solveBlock, rulesFor, capsForSub, diagnose, lowerBound, changesBetween } from './solver';
import { getDaypartAssignments } from '../pricingStorage';
import { readPrice } from '../pricingModel';

export function planTargets({ stored, seeded, openCount, ladder, caps }) {
    const base = stored && Object.values(stored).some((n) => n > 0) ? stored : (seeded || {});
    const fitted = fitToCount(base, openCount, ladder);
    return caps && caps.size ? fitToCaps(fitted, caps, ladder).map : fitted;
}

export function readBlockMap(store, date, core) {
    const out = new Map();
    for (const [k, v] of Object.entries(getDaypartAssignments(store, date, `h_${core}`))) {
        const p = readPrice(v);
        if (p) out.set(k, p.base);
    }
    return out;
}
export function readPins(store, date, core) {
    const out = new Map();
    for (const [k, v] of Object.entries(getDaypartAssignments(store, date, `h_${core}`))) if (v && v.pin && v.base) out.set(k, v.base);
    return out;
}

export function solveDate(ctx, date, prevAssign) {
    const dt = dayTypeOf(date, ctx.cfg);
    const openByCore = ctx.openByDate[date];
    const byCore = {}, report = {};
    let prev = prevAssign || null;
    for (const core of CORE_HOURS) {
        const open = openByCore.get(core) || new Set();
        const tables = ctx.tables.filter((t) => open.has(t.key)).map((t) => ({ ...t, value: (ctx.valuesByDt[dt] || new Map()).get(t.key) || 0 }));
        const rules = rulesFor(ctx.cfg.rules, core);
        const targets = {};
        for (const sub of Object.keys(ctx.ladders)) {
            const n = tables.filter((t) => t.sub === sub).length;
            targets[sub] = planTargets({
                stored: targetsFor(ctx.cfg, dt, core, sub),
                seeded: ((ctx.seededByDt[dt] || {})[core] || {})[sub],
                openCount: n, ladder: ctx.ladders[sub], caps: capsForSub(rules, tables, sub),
            });
        }
        const pins = ctx.keepPins ? (((ctx.pinsByDate[date] || {})[core]) || new Map()) : new Map();
        const current = ctx.stayClose ? (((ctx.currentByDate[date] || {})[core]) || null) : null;
        const shareMap = new Map();
        const sh = ctx.sharesByDt[dt] || new Map();
        for (const t of tables) { const e = sh.get(`${t.key}|${core}`); if (e) shareMap.set(t.key, e); }
        const r = solveBlock({ tables, targets, ladders: ctx.ladders, tierIndex: ctx.tierIndex, prev, current, shares: shareMap, pins, rules, weights: ctx.cfg.weights });
        const problems = r.ok ? [] : diagnose({ tables, targets: r.targets, rules, pins, tierLabel: ctx.tierLabel });
        if (!r.ok && !problems.length) problems.push(`${r.unplaced.length} table(s) could not be priced: ${r.unplaced.slice(0, 5).join(', ')}`);
        byCore[core] = r.assign;
        report[core] = {
            ok: r.ok, notes: r.notes, problems, targets: r.targets,
            changes: prev ? changesBetween(prev, r.assign) : [], lb: lowerBound(prev, r.targets, tables),
            from: prevCore(core) == null ? 'previous date 05:00' : `${String(prevCore(core)).padStart(2, '0')}:00`,
        };
        prev = r.assign;
    }
    return { byCore, report, dayType: dt };
}
```

```js
// FILE: src/pricing/utils/autoplan/apply.js
// Write a solved draft into the store: a version of each date first, then
// the block's price into every hour of the block (open hours only when a
// schedule is known). Saves once.

import { CORE_HOURS, blockHours } from './core';
import { savePricing } from '../pricingStorage';

export function applyDraft(store, draft, { openHoursByDate = {}, pinsByDate = {}, versionName = 'Before Auto-plan', now = new Date() } = {}) {
    const plans = { ...(store.plans || {}) };
    for (const date of Object.keys(draft)) {
        const plan = plans[date] || { byDaypart: {}, versions: [], activeVersionId: null };
        const versions = plan.versions || [];
        const versionNumber = versions.reduce((m, v) => Math.max(m, v.versionNumber || 0), 0) + 1;
        const snapshot = {
            versionId: `v_${now.getTime()}_${date.replace(/-/g, '')}`,
            versionNumber, name: versionName, savedAt: now.toISOString(),
            byDaypart: JSON.parse(JSON.stringify(plan.byDaypart || {})),
        };
        const byDaypart = { ...(plan.byDaypart || {}) };
        const openHours = openHoursByDate[date] || null;
        for (const core of CORE_HOURS) {
            const assign = draft[date][core];
            if (!assign) continue;
            const pins = ((pinsByDate[date] || {})[core]) || new Map();
            for (const h of blockHours(core)) {
                const openH = openHours ? openHours.get(h) : null;
                const assignments = {};
                for (const [k, tier] of assign) {
                    if (openH && !openH.has(k)) continue;
                    assignments[k] = { base: tier, min: tier, max: tier, src: 'auto', ...(pins.has(k) ? { pin: true } : {}) };
                }
                byDaypart[`h_${h}`] = { assignments };
            }
        }
        plans[date] = { ...plan, byDaypart, versions: [...versions, snapshot], activeVersionId: snapshot.versionId };
    }
    return savePricing({ ...store, plans });
}
```

Add to `pricingModel.js`:

```js
// Auto-plan markers — both optional, both ignored by readPrice.
export const isPinned = (v) => !!(v && typeof v === 'object' && v.pin);
export const isAuto = (v) => !!(v && typeof v === 'object' && v.src === 'auto');
```

`floorConfig.js`: add `zone: String(cfg.zone ?? cfg.pit ?? ''),` to each table.

- [ ] **Step 1: Write the failing test**

```js
// FILE: src/pricing/utils/autoplan/__tests__/period.test.js
import { solveDate, planTargets, readPins } from '../period';
import { applyDraft } from '../apply';
import { emptyAutoplan, withTargets } from '../config';
import { CORE_HOURS, blockHours } from '../core';

const tiersAsc = ['m100', 'm300', 'm500', 'm1000'].map((id, i) => ({ id, min: [100, 300, 500, 1000][i] }));
const tierIndex = new Map(tiersAsc.map((t, i) => [t.id, i]));
const tables = Array.from({ length: 6 }, (_, i) => ({ key: `BA|${i + 1}`, sub: 'Main', zone: `Z${Math.floor(i / 3)}`, gametype: 'BA' }));
const allOpen = new Map(CORE_HOURS.map((c) => [c, new Set(tables.map((t) => t.key))]));

function ctx(cfg, extra = {}) {
    return {
        cfg, tables, tiersAsc, tierIndex, tierLabel: (id) => id,
        ladders: { Main: tiersAsc.map((t) => t.id) },
        sharesByDt: {}, valuesByDt: { wd: new Map(tables.map((t, i) => [t.key, 10 - i])) }, seededByDt: {},
        openByDate: { '2026-10-01': allOpen, '2026-10-02': allOpen },
        currentByDate: {}, pinsByDate: {}, keepPins: true, stayClose: false, ...extra,
    };
}

test('planTargets fits stored targets to the open count and caps', () => {
    expect(planTargets({ stored: { m100: 1, m1000: 1 }, openCount: 4, ladder: ['m100', 'm1000'] })).toEqual({ m100: 2, m1000: 2 });
    expect(planTargets({ stored: null, seeded: { m300: 2 }, openCount: 2, ladder: ['m300'] })).toEqual({ m300: 2 });
    expect(planTargets({ stored: { m100: 0, m1000: 4 }, openCount: 4, ladder: ['m100', 'm1000'], caps: new Map([['m1000', 1]]) })).toEqual({ m100: 3, m1000: 1 });
});

test('a date is solved block by block with fewest changes', () => {
    let cfg = emptyAutoplan();
    for (const c of CORE_HOURS) cfg = withTargets(cfg, 'wd', c, 'Main', c === 21 ? { m300: 2, m500: 2, m1000: 2 } : { m100: 2, m300: 2, m500: 2 });
    const r = solveDate(ctx(cfg), '2026-10-01', null);
    expect(r.dayType).toBe('wd');
    expect(r.report[11].changes.length).toBe(0);
    expect(r.report[21].changes.length).toBe(r.report[21].lb);
    expect(r.report[21].lb).toBe(2);
    expect(r.report[3].changes.length).toBe(2);
});

test('apply writes every hour of the block, keeps pins, saves a version', () => {
    let saved = null;
    const store = { plans: { '2026-10-01': { byDaypart: { h_7: { assignments: { 'BA|1': { base: 'm100', min: 'm100', max: 'm100', pin: true } } } }, versions: [] } } };
    expect(readPins(store, '2026-10-01', 7).get('BA|1')).toBe('m100');
    const draft = { '2026-10-01': { 7: new Map([['BA|1', 'm100'], ['BA|2', 'm500']]) } };
    const hoursOpen = new Map(blockHours(7).map((h) => [h, new Set(h === 10 ? ['BA|1'] : ['BA|1', 'BA|2'])]));
    const orig = window.localStorage.setItem;
    window.localStorage.setItem = (k, v) => { saved = v; };
    const next = applyDraft(store, draft, { openHoursByDate: { '2026-10-01': hoursOpen }, pinsByDate: { '2026-10-01': { 7: new Map([['BA|1', 'm100']]) } } });
    window.localStorage.setItem = orig;
    const p = next.plans['2026-10-01'];
    expect(p.versions).toHaveLength(1);
    expect(p.versions[0].byDaypart.h_7.assignments['BA|1'].pin).toBe(true);
    for (const h of [7, 8, 9]) expect(Object.keys(p.byDaypart[`h_${h}`].assignments).sort()).toEqual(['BA|1', 'BA|2']);
    expect(Object.keys(p.byDaypart.h_10.assignments)).toEqual(['BA|1']);
    expect(p.byDaypart.h_8.assignments['BA|2']).toEqual({ base: 'm500', min: 'm500', max: 'm500', src: 'auto' });
    expect(p.byDaypart.h_8.assignments['BA|1'].pin).toBe(true);
    expect(saved).not.toBeNull();
});
```

- [ ] **Step 2: FAIL · Step 3: implement · Step 4: PASS**

---

### Task 5: Auto-plan UI panels

**Files (create in `src/pricing/components/autoplan/`):**
- `AutoPlanBar.js` — toolbar row 2 in Auto-plan mode: `AutoPlanBar({ period, onPeriod, cfg, onCfg, dates, keepPins, onKeepPins, stayClose, onStayClose, onSolve, solving, progress, draftDates, onApply, onDiscard, dataNote })`. Period from/to inputs; day-type chip → popover editing `dowMap` and `overrides`.
- `TargetsPanel.js` — `TargetsPanel({ cfg, onCfg, dayType, onDayType, sub, onSub, subs, ladders, tiers, refOpen: {core: {sub: {min, max}}}, seeded, caps, onSeed })`. Grid price × core hour; total / open row with Fit; column menu (↑ mix, ↓ mix, Fit, Copy to all); Copy from day type; Seed from history; paste of tab-separated blocks.
- `RulesPanel.js` — `RulesPanel({ rules, onRules, tiers, subs, zones, tables, gametypes, costs })` add / edit / toggle / delete, core-hour toggles, cost badge.
- `ResultPanel.js` — `ResultPanel({ draft, reports, dates, date, onDate, core, onCore, tierById, tableByKey, periodKpis, costs, onKeepPrevious, onDownload, problems, onFix })`.
- `ChangeStrip.js` — `ChangeStrip({ report, core, onCore, kpis })` the 7 transitions of the selected date.

### Task 6: Dashboard integration

**Files:** Modify `src/pricing/PricingDashboard.js`, `src/pricing/components/TimelineControl.js` (props `coreHours`, `coreOf`), `src/pricing/components/PricingFloorMap.js` (prop `pinnedKeys`, gold outline), `src/pricing/components/TierSelectionBar.js` (props `onPin`, `onUnpin`, `pinnedCount`), `src/pricing/utils/pricingStorage.js` (`getAutoplan`, `setAutoplan`, keep `autoplan` on load).

- Mode toggle gains **Auto-plan**; Auto-plan renders the same grid (timeline, floor map, right column, hourly charts) from `draftStore = overlay(store, draft)`.
- Planning: **Edit: Block | This hour** toggle (Block default) — paints write every hour of the block; painting on a date that has Auto-plan prices sets `pin: true`; Pin / Unpin in the selection bar; `pinnedKeys` outline.
- Auto-plan: loads daily + hourly feeds once, schedule rows for the period (`fetchScheduleHours({ from })`, filtered by date), builds `ctx`, solves dates in order in chunks (`setTimeout` between dates) with progress; Keep previous price → pin in the draft pins and re-solve from that date on; Apply → `applyDraft`, then switch to Planning on the first date.

### Task 7: Verification

- [ ] `src/pricing` tests green; ESLint clean for touched files.
- [ ] Headless walk at 1680: Auto-plan solve → Result → Keep previous → Apply → Planning shows the plan; Planning block paint + pin outline.
