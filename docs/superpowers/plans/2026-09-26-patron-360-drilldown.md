# Player 360 Drill-down Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Player 360's long summary + Investigate page with a period summary (Today / Last 3 months / Last 12 months) and Summary → Option → Shoe → Hand step pages with a breadcrumb, per `docs/superpowers/specs/2026-09-26-patron-360-drilldown-design.md`.

**Architecture:** A new pure module `utils/p360Periods.js` computes period bounds, per-option KPIs, summary rows, shoe rows, sorting and period verdicts on top of the existing `utils/patron360.js` views and tests. `RtPatron360.js` becomes a small state machine (period, level, option, shoe, compare set, hand, sorts) that renders one level component at a time. Existing charts (EdgeProfileChart, EdgeCurves, WagerBars, FactTiles, ShoeRoads) are reused, with hover/click props added.

**Tech Stack:** React 19, MUI 9 (`slots`/`slotProps`), ECharts 6 via `patron360/useEChart`, CRA Jest.

## Global Constraints

- Money labels say **Patron Win** (patron perspective) or **Casino Theo** (casino perspective); never bare "Win"/"Result".
- Default period **Last 3 months**; periods Today · Last 3 months · Last 12 months.
- Every table sorts on header click; click again reverses; `aria-sort` on the header.
- Tokens from `constants/rtTheme.js`; option colours from `PATRON_360.BET_OPTIONS`; negative edge magenta `rgb(214,92,255)` / text `rgb(235,150,255)`.
- No commits (user rule). Tests: `$env:CI='true'; npx react-scripts test --watchAll=false src/realtime`. Lint: `$env:ESLINT_USE_FLAT_CONFIG='false'; npx eslint --ext .js src/realtime`.

---

### Task 1: Period model — `utils/p360Periods.js`

**Files:**
- Create: `src/realtime/utils/p360Periods.js`
- Test: `src/realtime/utils/__tests__/p360Periods.test.js`

**Interfaces:**
- Consumes: `optionEvidence(views, code)`, `verdictFrom(rows)`, `worstState(row)`, `inWindow(view, handNo)`, `OPTION_BY_CODE`, `ymd` from `utils/patron360.js`. A view is `{ shoeKey, tableKey, shoeId, date, hands:[{handNo, result, bankerPair, playerPair, edge:{CODE:number|null}}], bets:[{betType, wager, casinoWin, theoWin, handNo}], betsByHand: Map<handNo, Map<code,{wager,casinoWin,theoWin}>>, firstHand, lastHand, maxHand }`.
- Produces:
  - `PERIODS: [{id:'today'|'3m'|'12m', label}]`, `DEFAULT_PERIOD = '3m'`
  - `periodFrom(id, today) → 'YYYY-MM-DD'`, `fetchRange(today) → {from, to}`
  - `viewsInPeriod(views, id, today) → view[]`
  - `optionKpis(views, code) → Kpi` where `Kpi = { code, ev, theoEdge, bets, turnover, avgBet, patronWin, edgePlayed, theoGeneric, theoActual, involvement, seatedHands, shoes, negShoes, negShoesBet, negBets, worst }` (`ev` = `optionEvidence` row, for FactTiles and verdicts)
  - `summaryRows(views) → Kpi[]` (options with bets), `gapOf(kpi) → number|null`
  - `worstOption(rows) → Kpi|null`, `periodVerdict(rows) → {level, reason}`
  - `shoeRowsFor(views, code, { onlyNeg }) → [{ view, negHands, negBets, negMoney, bets, wager, patronWin }]`
  - `sortBy(list, get, dir) → list` (nulls last), `sortSummary(rows, {key, dir})` (`key: 'gap'` = default order)

- [ ] **Step 1: Write the failing test**

```js
import {
    periodFrom, fetchRange, viewsInPeriod, optionKpis, summaryRows, worstOption, periodVerdict,
    shoeRowsFor, sortBy, sortSummary, gapOf,
} from '../p360Periods';

// One shoe: 10 hands, seated 3–8; SL7 edge negative on 6–10.
function view({ date = '2026-09-20', key = 'BA|1|S1', bets = [] } = {}) {
    const hands = Array.from({ length: 10 }, (_, i) => ({
        handNo: i + 1, result: 'B', bankerPair: false, playerPair: false,
        edge: { SL7: i + 1 >= 6 ? -2 : 10, BANKER: 1.06 },
    }));
    const betsByHand = new Map();
    for (const b of bets) {
        const m = betsByHand.get(b.handNo) || new Map();
        m.set(b.betType, { wager: b.wager, casinoWin: b.casinoWin, theoWin: 0 });
        betsByHand.set(b.handNo, m);
    }
    const nos = bets.map((b) => b.handNo);
    return {
        shoeKey: key, tableKey: 'BA|1', shoeId: 'S1', date, hands, bets, betsByHand,
        firstHand: nos.length ? Math.min(...nos) : null, lastHand: nos.length ? Math.max(...nos) : null, maxHand: 10,
    };
}
const bet = (handNo, betType, wager, casinoWin) => ({ handNo, betType, wager, casinoWin, theoWin: 0 });

describe('p360Periods', () => {
    test('period bounds', () => {
        expect(periodFrom('today', '2026-09-26')).toBe('2026-09-26');
        expect(periodFrom('3m', '2026-09-26')).toBe('2026-06-26');
        expect(periodFrom('12m', '2026-09-26')).toBe('2025-09-27');
        expect(fetchRange('2026-09-26')).toEqual({ from: '2025-09-27', to: '2026-09-26' });
    });

    test('views filter by date', () => {
        const vs = [view({ date: '2026-09-26' }), view({ date: '2026-08-01' }), view({ date: '2026-01-01' })];
        expect(viewsInPeriod(vs, 'today', '2026-09-26')).toHaveLength(1);
        expect(viewsInPeriod(vs, '3m', '2026-09-26')).toHaveLength(2);
        expect(viewsInPeriod(vs, '12m', '2026-09-26')).toHaveLength(3);
    });

    test('option KPIs: edge played, both theos, involvement, shoes', () => {
        const v = view({ bets: [bet(3, 'SL7', 100, 100), bet(6, 'SL7', 300, -3000), bet(8, 'BANKER', 1000, -950)] });
        const k = optionKpis([v], 'SL7');
        expect(k.bets).toBe(2);
        expect(k.turnover).toBe(400);
        expect(k.avgBet).toBe(200);
        expect(k.patronWin).toBe(2900);
        expect(k.edgePlayed).toBeCloseTo((100 * 10 + 300 * -2) / 400);
        expect(k.theoGeneric).toBeCloseTo((400 * 14.8) / 100);
        expect(k.theoActual).toBeCloseTo((100 * 10 + 300 * -2) / 100);
        expect(k.seatedHands).toBe(6);                 // hands 3..8
        expect(k.involvement).toBeCloseTo(2 / 6);
        expect(k).toMatchObject({ shoes: 1, negShoes: 1, negShoesBet: 1, negBets: 1, theoEdge: 14.8 });
        expect(k.ev.code).toBe('SL7');
    });

    test('summary rows, default gap order and worst option', () => {
        const v = view({ bets: [bet(3, 'SL7', 100, 100), bet(6, 'SL7', 300, -3000), bet(8, 'BANKER', 1000, -950)] });
        const rows = summaryRows([v]);
        expect(rows.map((r) => r.code).sort()).toEqual(['BANKER', 'SL7']);
        expect(worstOption(rows).code).toBe('SL7');
        expect(sortSummary(rows, { key: 'gap', dir: 1 })[0].code).toBe('SL7');
        expect(sortSummary(rows, { key: 'turnover', dir: -1 })[0].code).toBe('BANKER');
        expect(gapOf({ edgePlayed: null, theoEdge: 1 })).toBeNull();
        expect(['ACTION', 'WATCH', 'CLEAR', 'NO DATA']).toContain(periodVerdict(rows).level);
        expect(worstOption([])).toBeNull();
    });

    test('shoe rows: −edge hands, bets on them, money, Patron Win', () => {
        const a = view({ key: 'A', bets: [bet(4, 'SL7', 100, 100), bet(6, 'SL7', 300, -3000), bet(7, 'SL7', 200, 200)] });
        const b = view({ key: 'B', bets: [bet(2, 'BANKER', 100, 100), bet(4, 'BANKER', 100, 100)] });
        const rows = shoeRowsFor([a, b], 'SL7', { onlyNeg: true });
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ negHands: 2, negBets: 2, negMoney: 500, bets: 3, wager: 600, patronWin: 2700 });
        expect(shoeRowsFor([a, b], 'SL7', { onlyNeg: false }).map((r) => r.view.shoeKey)).toEqual(['A']);
    });

    test('sortBy keeps nulls last both ways', () => {
        const xs = [{ v: 2 }, { v: null }, { v: 5 }];
        expect(sortBy(xs, (x) => x.v, 1).map((x) => x.v)).toEqual([2, 5, null]);
        expect(sortBy(xs, (x) => x.v, -1).map((x) => x.v)).toEqual([5, 2, null]);
        expect(sortBy([{ v: 'b' }, { v: 'a' }], (x) => x.v, 1).map((x) => x.v)).toEqual(['a', 'b']);
    });
});
```

- [ ] **Step 2: Run it — expect FAIL** (`Cannot find module '../p360Periods'`)

Run: `$env:CI='true'; npx react-scripts test --watchAll=false src/realtime/utils/__tests__/p360Periods`

- [ ] **Step 3: Implement**

```js
// Player 360 — periods, per-option KPIs and ordering for the drill-down.
// Spec: docs/superpowers/specs/2026-09-26-patron-360-drilldown-design.md
// Pure; money is PATRON perspective except the two Casino Theo figures.

import { OPTION_BY_CODE, ymd, inWindow, optionEvidence, verdictFrom, worstState } from './patron360';

export const PERIODS = [
    { id: 'today', label: 'Today' },
    { id: '3m', label: 'Last 3 months' },
    { id: '12m', label: 'Last 12 months' },
];
export const DEFAULT_PERIOD = '3m';
export const periodLabel = (id) => (PERIODS.find((p) => p.id === id) || PERIODS[1]).label;

export function periodFrom(id, today) {
    if (id === 'today') return today;
    const [y, m, d] = today.split('-').map(Number);
    if (id === '3m') return ymd(new Date(y, m - 4, d));
    return ymd(new Date(y - 1, m - 1, d + 1));
}
export const fetchRange = (today) => ({ from: periodFrom('12m', today), to: today });

export function viewsInPeriod(views, id, today) {
    const from = periodFrom(id, today);
    return views.filter((v) => String(v.date) >= from && String(v.date) <= today);
}

export function sortBy(list, get, dir) {
    return [...list].sort((a, b) => {
        const x = get(a), y = get(b);
        const nx = x == null || (typeof x === 'number' && Number.isNaN(x));
        const ny = y == null || (typeof y === 'number' && Number.isNaN(y));
        if (nx && ny) return 0;
        if (nx) return 1;
        if (ny) return -1;
        return (typeof x === 'string' ? x.localeCompare(y) : x - y) * dir;
    });
}

export function optionKpis(views, code) {
    const opt = OPTION_BY_CODE.get(code);
    const theoEdge = opt ? opt.theo : null;
    let bets = 0, turnover = 0, casino = 0;
    let wEdge = 0, wKnown = 0, seatedHands = 0, shoes = 0, negShoes = 0, negShoesBet = 0, negBets = 0;
    for (const v of views) {
        for (const b of v.bets) if (b.betType === code) { bets += 1; turnover += b.wager; casino += b.casinoWin; }
        if (v.firstHand == null) continue;
        shoes += 1;
        let sNeg = false, sNegBet = false;
        for (const h of v.hands) {
            if (!inWindow(v, h.handNo)) continue;
            seatedHands += 1;
            const e = h.edge[code];
            const neg = e != null && e < 0;
            if (neg) sNeg = true;
            const m = v.betsByHand.get(h.handNo);
            const c = m && m.get(code);
            if (!c) continue;
            if (e != null) { wEdge += c.wager * e; wKnown += c.wager; }
            if (neg) { sNegBet = true; negBets += 1; }
        }
        if (sNeg) negShoes += 1;
        if (sNegBet) negShoesBet += 1;
    }
    const ev = optionEvidence(views, code);
    return {
        code, ev, theoEdge, bets, turnover,
        avgBet: bets ? turnover / bets : null,
        patronWin: -casino,
        edgePlayed: wKnown ? wEdge / wKnown : null,
        theoGeneric: theoEdge == null ? null : (turnover * theoEdge) / 100,
        theoActual: wKnown ? wEdge / 100 : null,
        involvement: seatedHands ? bets / seatedHands : null,
        seatedHands, shoes, negShoes, negShoesBet, negBets,
        worst: worstState(ev),
    };
}

export const gapOf = (k) => (k.edgePlayed == null || !k.theoEdge ? null : (k.edgePlayed - k.theoEdge) / k.theoEdge);

export function summaryRows(views) {
    const codes = new Set();
    for (const v of views) for (const b of v.bets) codes.add(b.betType);
    return [...codes].map((c) => optionKpis(views, c)).filter((k) => k.bets > 0);
}

export function sortSummary(rows, sort) {
    return sort.key === 'gap' ? sortBy(rows, gapOf, 1) : sortBy(rows, (r) => r[sort.key], sort.dir);
}

export const worstOption = (rows) => sortBy(rows, gapOf, 1)[0] || null;
export const periodVerdict = (rows) => verdictFrom(rows.map((r) => r.ev));

export function shoeRowsFor(views, code, { onlyNeg = true } = {}) {
    const out = [];
    for (const v of views) {
        let negHands = 0, negBets = 0, negMoney = 0, bets = 0, wager = 0, casino = 0;
        for (const h of v.hands) {
            const e = h.edge[code];
            const neg = e != null && e < 0;
            const seated = inWindow(v, h.handNo);
            if (neg && seated) negHands += 1;
            const m = v.betsByHand.get(h.handNo);
            const c = m && m.get(code);
            if (!c) continue;
            bets += 1; wager += c.wager; casino += c.casinoWin;
            if (neg) { negBets += 1; negMoney += c.wager; }
        }
        if (onlyNeg ? negHands === 0 : bets === 0 && negHands === 0) continue;
        out.push({ view: v, negHands, negBets, negMoney, bets, wager, patronWin: -casino });
    }
    return out;
}
```

- [ ] **Step 4: Run it — expect PASS** (6 tests)

---

### Task 2: 12-month mock with a late counter

**Files:**
- Modify: `src/realtime/utils/patronBetsMock.js` (loop start; counter gating)
- Modify: `src/realtime/utils/__tests__/patronBetsMock.test.js` (date window assertion)

**Interfaces:** Consumes `fetchRange` idea only by date: history covers `(today − 1 year, today]`. Counters count only in the last 100 days.

- [ ] **Step 1: Update the test's window assertion**

```js
    it('matches both contracts and stays inside the last 12 months', () => {
        expect(Object.keys(bets[0]).sort()).toEqual([...BET_COLS].sort());
        expect(Object.keys(shoeEdges[0]).sort()).toEqual([...EDGE_COLS].sort());
        expect(bets.every((r) => r.gaming_date >= '2025-09-26' && r.gaming_date <= '2026-09-25')).toBe(true);
        expect(bets.some((r) => r.gaming_date < '2026-01-01')).toBe(true);
```

- [ ] **Step 2: Run — expect FAIL** (no bets before 2026-01-01)
- [ ] **Step 3: Implement** — loop from `new Date(y - 1, m - 1, d + 1)`; compute `const countingFrom = ymd(new Date(y, m - 1, d - 100));` and use `const counting = counter && date >= countingFrom;` in place of `counter` inside the bet placement (`if (counting && edge[fav] < 0) … else if (rand() < (counting ? 0.03 : 0.1)) { const code = counting ? fav : …`).
- [ ] **Step 4: Run all `src/realtime` tests — expect PASS**

---

### Task 3: Shared pieces — SortableTable, chart hooks, roads

**Files:**
- Create: `src/realtime/components/patron360/SortableTable.js`
- Modify: `components/patron360/EdgeCurves.js`, `components/patron360/WagerBars.js`, `components/ShoeRoads.js`

**Interfaces — Produces:**
- `SortableTable({ columns, groups?, rows, rowKey, sort:{key,dir}, onSort(key), onRowClick?(row), rowLabel?(row), minWidth? })`. `columns: [{ key, label, title?, align:'left'|'right'|'center', sortable?:true, firstDir?:1|-1, gap?:bool, width?, render(row) }]`, `groups: [{ label, span, gap? }]`. Header cells are buttons with ▲/▼, `aria-sort` on the `th`. Rows with `onRowClick` are focusable and open on Enter/Space; clicks on `input`/`button`/`[data-stop]` inside a row don't trigger the row.
- `nextSort(sort, key, firstDir) → {key, dir}` (same key → flip; new key → firstDir ?? -1).
- `EdgeCurves({ views, code, cursorHand?, onHoverHand?(handNo|null), onPickHand?(view, handNo) })` — adds a `__cursor` markLine at `cursorHand` and forwards `updateAxisPointer` / click.
- `WagerBars({ view, code, cursorHand?, onHoverHand?, onPickHand? })` — x axis = seated hands `firstHand..lastHand` only; bars for options other than `code` drawn grey `rgba(255,255,255,0.22)`; click → `onPickHand(handNo)`.
- `ShoeRoads({ …, full = true })` — `full=false` renders Big Road + bead plate only; `selectedHandNo` also rings the Big Road cell containing it.

- [ ] Steps: write SortableTable (render test via existing Jest + `@testing-library/react` if present; otherwise covered by the visual pass), add props to the three components, run lint.

---

### Task 4: Level components

**Files (create in `components/patron360/`):**
- `P360Nav.js` — `P360Nav({ crumbs:[{label, onClick?}], onBack?, prev?:{label,onClick}, next?:{label,onClick}, position? })`; Alt+← handled by the overlay.
- `SummaryLevel.js` — `SummaryLevel({ rows, allPeriods:{today,'3m','12m'}: Map<code,Kpi>, verdict, worst, period, sort, onSort, onOpen(code) })`. Grouped SortableTable per spec; edge gauge; 3-period dots from `allPeriods`.
- `ShoeStrip.js` — `ShoeStrip({ view, code, onPickHand(handNo) })`: SVG cells (edgeBands colours, dim outside seated window, white mark = bet), hover outline + MUI `Tooltip followCursor` with hand details.
- `OptionLevel.js` — `OptionLevel({ kpi, views, period, shoeRows, sort, onSort, onlyNeg, onOnlyNeg, picks, onPick, onCompare, onOpenShoe(shoeKey), onOpenHand(shoeKey, handNo) })`: KPI strip, FactTiles(`kpi.ev`), EdgeProfileChart, shoe SortableTable (20 rows + Show all).
- `ShoeLevel.js` — `ShoeLevel({ view, code, onOpenHand(handNo) })` and `CompareLevel({ views, code, onOpenShoe })`.
- `HandLevel.js` — `HandLevel({ view, code, handNo, sort, onSort, onOpenHand(handNo) })`.

- [ ] Steps: build each, render in the overlay, check in the browser.

---

### Task 5: Overlay state machine — `RtPatron360.js`

**Files:** Modify `components/patron360/RtPatron360.js`; delete `SummaryPanel.js`, `OptionStrip.js`, `TestMatrix.js`, `ShoeHeatmap.js` once unused.

State: `period` (default `DEFAULT_PERIOD`), `nav = { level:'summary'|'option'|'shoe'|'compare'|'hand', code, shoeKey, cmp:[], handNo }`, `sorts = { sum:{key:'gap',dir:1}, shoes:{key:'negMoney',dir:-1}, bets:{key:'wager',dir:-1} }`, `onlyNeg`, `picks`, `showAll`. Fetch `fetchRange(currentGamingDate())` once per patron + retry; build views with `buildPatron360`; per period: `viewsInPeriod`, `summaryRows`, `sortSummary`, `periodVerdict`, `worstOption`. Period change keeps level when valid (spec). Alt+← = back; level change scrolls the dialog paper to top. Header: identity, period toggle, verdict stamp, LIVE/MOCK, close.

- [ ] Steps: rewrite, run tests + lint, headless walk (summary → option → shoe → hand, sort click, strip hover) at 1680 px.

---

### Task 6: Verification

- [ ] `src/realtime` Jest suite green; ESLint no new warnings.
- [ ] Headless screenshots: summary, option, shoe, compare, hand; check Patron Win / Casino Theo labels; no page-level horizontal scroll at 1280.
