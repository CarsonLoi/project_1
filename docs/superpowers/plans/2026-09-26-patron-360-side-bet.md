# Player 360 Side-bet Advantage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the Player 360 around side-bet advantage play: evidence per bet option, a shoes × hands edge heatmap with the patron's bets, multi-shoe house-edge curves, hand-by-hand wagers and a single-shoe trend board.

**Architecture:** Two on-demand patron feeds (bets §8, shoe edges §9, both date-ranged) are joined per shoe by a pure model (`utils/patron360.js`) that computes per-option tests and the verdict. The overlay (`components/patron360/RtPatron360.js`) renders five focused components; roads are shared with the shoe board through a new `components/ShoeRoads.js`.

**Tech Stack:** React 19, MUI v9 (`slots`/`slotProps`; Stack alignment in `sx`), ECharts 6 (heatmap, scatter, line), CRA Jest.

Spec: `docs/superpowers/specs/2026-09-26-patron-360-side-bet-design.md`

## Global Constraints

- Feed money is casino perspective; the 360 shows patron perspective (+ = patron won), labelled.
- Gaming day starts 07:00; default range **YTD**.
- Bet options (chip order): `BANKER, PLAYER, TIE, BTG, STG, BD, SD, SL7, PPL, L6`, all from `PATRON_360.BET_OPTIONS`.
- A configured endpoint that fails → error + Retry, never mock data.
- Thresholds (watch/flag): entry 2/4, ramp 1.5/2.5, money 1.5/2.5, luck 2/3.
- No gendered pronouns in UI copy ("they/their").
- Do not commit; `src/realtime` is untracked.
- Tests: `$env:CI='true'; npx react-scripts test --watchAll=false src/realtime`.

## File structure

| File | Responsibility |
|---|---|
| `src/realtime/constants/rtConfig.js` (modify) | `RT_ENDPOINTS.patronShoeEdges`; new `PATRON_360` |
| `src/realtime/utils/patron360.js` (rewrite) | Model: ranges, normalise, views, per-option tests, verdict, heatmap rows |
| `src/realtime/utils/patronBetsMock.js` (rewrite) | `generateMockPatronHistory` → `{ bets, shoeEdges }` |
| `src/realtime/utils/rtDataSource.js` (modify) | `fetchPatronBets(id, range)`, `fetchPatronShoeEdges(id, range)` |
| `docs/realtime-surveillance-data-contract.md` (modify) | §8 range + options, new §9, resolved → §10 |
| `src/trend/components/BaccaratBoard.jsx` (modify) | Big Road cells carry `handNos` |
| `src/realtime/components/ShoeRoads.js` (create) | Shared roads with highlight sets |
| `src/realtime/components/RtShoeBoard.js` (modify) | Use `ShoeRoads` |
| `src/realtime/components/patron360/format.js` (rewrite) | Formatters, option colours, edge bands, shoe labels |
| `src/realtime/components/patron360/OptionChips.js` (create) | Bet-option picker |
| `src/realtime/components/patron360/AdvantageTable.js` (create) | Evidence per option |
| `src/realtime/components/patron360/ShoeHeatmap.js` (create) | Shoes × hands heatmap + legend |
| `src/realtime/components/patron360/EdgeCurves.js` (create) | Multi-shoe edge lines + bet markers |
| `src/realtime/components/patron360/WagerBars.js` (create) | Stacked wager per hand, option filter |
| `src/realtime/components/patron360/RtPatron360.js` (rewrite) | Overlay, range, fetch, layout |
| `patron360/{EvidencePanel,NormalCompare,ShoeGrid,HandStrip,BetEdgeScatter,YtdTrend,BetTypeTable}.js` (delete) | Replaced |

---

### Task 1: Config + model

**Files:** Modify `src/realtime/constants/rtConfig.js`; rewrite `src/realtime/utils/patron360.js`; rewrite `src/realtime/utils/__tests__/patron360.test.js`.

**Interfaces — Produces:** `PATRON_360 { BET_OPTIONS[{code,name,edgeKey,side,color,theo,var}], TESTS, COUNTING_TESTS, DEFAULT_RANGE, HEATMAP_INITIAL_ROWS, MAX_SELECTED_SHOES }`; from `patron360.js`: `OPTION_BY_CODE`, `ymd(date)`, `currentGamingDate(now)`, `RANGES`, `rangeFor(id, now) → {from,to}`, `normalizeBets(rows)`, `normalizeShoeEdges(rows) → Map`, `buildShoeViews(shoes, bets) → View[]`, `inWindow(view, handNo)`, `optionShoeStats(view, code)`, `TEST_META`, `optionEvidence(views, code)`, `evidenceFor(views)`, `verdictFrom(rows)`, `defaultOption(rows)`, `heatmapRows(views, code, {onlyBet, sort}) → [{view, stats}]`, `buildPatron360(betRows, edgeRows) → {bets, views, evidence, verdict, defaultOption}`.
`View = { shoeKey, tableKey, shoeId, date, start, hands:[{handNo,time,result,bankerPair,playerPair,edge:{CODE:number|null}}], bets, betsByHand: Map<handNo, Map<code,{wager,casinoWin,theoWin}>>, firstHand, lastHand, maxHand, missingEdges? }`.

- [ ] **Step 1: Config.** In `RT_ENDPOINTS` after `patronBets` add:

```js
    // Live edge for every hand of every shoe ONE patron played (§9).
    patronShoeEdges: process.env.REACT_APP_RT_PATRON_SHOE_EDGES_URL || sibling('/patron/{id}/shoe-edges'),
```

Replace the whole `PATRON_360` block with:

```js
// ── Player 360 ────────────────────────────────────────────────────────
// Side-bet advantage review. BET_OPTIONS drives every chip, colour and
// edge column: `edgeKey` → shoe-edges column house_edge_<edgeKey>;
// `theo` → nominal house edge % (the dashed theo line); `var` → result
// variance per unit stake (luck z-score). Banker/Player/Tie are 8-deck
// figures; SIDE-BET theo/var ARE PLACEHOLDERS — set them from the
// casino's pay tables.
export const PATRON_360 = {
    BET_OPTIONS: [
        { code: 'BANKER', name: 'Banker', edgeKey: 'banker', side: false, color: '#ff4d4d', theo: 1.06, var: 0.86 },
        { code: 'PLAYER', name: 'Player', edgeKey: 'player', side: false, color: '#4d7cff', theo: 1.24, var: 0.905 },
        { code: 'TIE', name: 'Tie', edgeKey: 'tie', side: true, color: '#22a95a', theo: 14.36, var: 6.98 },
        { code: 'BTG', name: 'BTG', edgeKey: 'btg', side: true, color: '#f59e0b', theo: 4.0, var: 12 },
        { code: 'STG', name: 'STG', edgeKey: 'stg', side: true, color: '#a855f7', theo: 4.0, var: 20 },
        { code: 'BD', name: 'BD', edgeKey: 'bd', side: true, color: '#d9776f', theo: 2.65, var: 5 },
        { code: 'SD', name: 'SD', edgeKey: 'sd', side: true, color: '#3cc7c0', theo: 3.0, var: 5 },
        { code: 'SL7', name: 'Super Lucky 7', edgeKey: 'sl7', side: true, color: '#d4ac3a', theo: 14.8, var: 30 },
        { code: 'PPL', name: 'PPL', edgeKey: 'ppl', side: true, color: '#ff4fb0', theo: 10.36, var: 10 },
        { code: 'L6', name: 'L6', edgeKey: 'l6', side: true, color: '#b07a4a', theo: 13.0, var: 12 },
    ],
    // Minimum samples guard every test — a handful of lucky hands must
    // never read as advantage play.
    TESTS: {
        entry: { watch: 2, flag: 4, minNegHands: 10, minPosHands: 10, minBets: 5 },
        ramp: { watch: 1.5, flag: 2.5, minEach: 5 },
        money: { watch: 1.5, flag: 2.5, minBets: 10, minNegHands: 10 },
        luck: { watch: 2, flag: 3, minBets: 30 },
    },
    // A flag on any of these alone means ACTION.
    COUNTING_TESTS: ['entry', 'ramp', 'money'],
    DEFAULT_RANGE: 'ytd',
    HEATMAP_INITIAL_ROWS: 40,
    MAX_SELECTED_SHOES: 8,
};
```

- [ ] **Step 2: Failing test** — replace `src/realtime/utils/__tests__/patron360.test.js`:

```js
import {
    currentGamingDate, rangeFor, normalizeBets, normalizeShoeEdges, buildShoeViews, inWindow,
    optionShoeStats, optionEvidence, evidenceFor, verdictFrom, defaultOption, heatmapRows, buildPatron360,
} from '../patron360';
import { PATRON_360 } from '../../constants/rtConfig';

const NOW = new Date(2026, 8, 25, 15, 0).getTime();
const DATE = '2026-09-25';
const THEO = Object.fromEntries(PATRON_360.BET_OPTIONS.map((o) => [`house_edge_${o.edgeKey}`, o.theo]));
const at = (hand) => new Date(Date.UTC(2026, 8, 25, 2, 0) + hand * 60000).toISOString();

const edgeRow = (shoe, hand, o = {}) => ({
    gaming_date: DATE, table_id: '10001', gametype: 'BA', shoe_id: shoe, hand_no: hand, game_time: at(hand),
    result: 'B', banker_pair: 0, player_pair: 0, ...THEO, ...o,
});
const betRow = (shoe, hand, type, wager, o = {}) => ({
    gaming_date: DATE, game_time: at(hand), table_id: '10001', gametype: 'BA', shoe_id: shoe,
    game_id: `${shoe}-H${hand}`, hand_no: hand, seat: 3, dealer: 'D1', result: 'B',
    bet_type: type, wager, casino_win: wager, theo_win: wager * 0.1, edge_at_bet: 1, ...o,
});
// `n` hands; SL7 edge is −5 on hands negFrom..negTo, theo elsewhere.
const shoe = (id, n, negFrom = 0, negTo = -1) => Array.from({ length: n }, (_, i) => i + 1)
    .map((h) => edgeRow(id, h, h >= negFrom && h <= negTo ? { house_edge_sl7: -5 } : {}));
const views = (edges, bets) => buildShoeViews(normalizeShoeEdges(edges), normalizeBets(bets));

// 40 hands, SL7 negative on 11–20; seated 1–40 (Banker bets on 1 and 40);
// SL7 $500 on 8 of the 10 negative hands and $100 on 5 of the 30 others.
const counterBets = () => [
    betRow('S1', 1, 'BANKER', 1000), betRow('S1', 40, 'BANKER', 1000),
    ...[11, 12, 13, 14, 15, 16, 17, 18].map((h) => betRow('S1', h, 'SL7', 500)),
    ...[22, 25, 28, 31, 34].map((h) => betRow('S1', h, 'SL7', 100)),
];

describe('dates and ranges', () => {
    it('rolls the gaming day over at 07:00', () => {
        expect(currentGamingDate(new Date(2026, 8, 25, 6, 59).getTime())).toBe('2026-09-24');
        expect(currentGamingDate(new Date(2026, 8, 25, 7, 0).getTime())).toBe('2026-09-25');
    });
    it('builds the quick ranges', () => {
        expect(rangeFor('today', NOW)).toEqual({ from: DATE, to: DATE });
        expect(rangeFor('7d', NOW)).toEqual({ from: '2026-09-19', to: DATE });
        expect(rangeFor('30d', NOW)).toEqual({ from: '2026-08-27', to: DATE });
        expect(rangeFor('ytd', NOW)).toEqual({ from: '2026-01-01', to: DATE });
    });
});

describe('normalisation and views', () => {
    it('groups edge rows into shoes with per-option edges', () => {
        const shoes = normalizeShoeEdges([edgeRow('S1', 2), edgeRow('S1', 1, { house_edge_btg: null })]);
        const s = shoes.get('BA|10001|S1');
        expect(s.hands.map((h) => h.handNo)).toEqual([1, 2]);
        expect(s.hands[0].edge.BTG).toBeNull();
        expect(s.hands[0].edge.SL7).toBe(14.8);
        expect(s.start).toBe(at(1));
    });
    it('joins bets per hand and sets the seat window', () => {
        const [v] = views(shoe('S1', 40), [betRow('S1', 5, 'SL7', 100), betRow('S1', 5, 'SL7', 200), betRow('S1', 30, 'BANKER', 500)]);
        expect(v.firstHand).toBe(5);
        expect(v.lastHand).toBe(30);
        expect(v.maxHand).toBe(40);
        expect(v.betsByHand.get(5).get('SL7')).toEqual({ wager: 300, casinoWin: 300, theoWin: 30 });
        expect(inWindow(v, 4)).toBe(false);
        expect(inWindow(v, 30)).toBe(true);
    });
    it('keeps shoes that have bets but no edge rows', () => {
        const vs = views([], [betRow('S9', 3, 'TIE', 100)]);
        expect(vs).toHaveLength(1);
        expect(vs[0].missingEdges).toBe(true);
        expect(vs[0].hands).toEqual([]);
    });
});

describe('per-shoe stats', () => {
    it('counts only hands inside the seat window', () => {
        const [v] = views(shoe('S1', 40, 11, 20), counterBets());
        const s = optionShoeStats(v, 'SL7');
        expect(s).toMatchObject({ bets: 13, turnover: 4500, negMoney: 4000, negHands: 10, negHandsBet: 8, windowHands: 40 });
        const [v2] = views(shoe('S1', 40, 11, 20), [betRow('S1', 21, 'SL7', 100), betRow('S1', 40, 'BANKER', 100)]);
        expect(optionShoeStats(v2, 'SL7').negHands).toBe(0);
    });
});

describe('option evidence', () => {
    it('flags a side-bet counter on entry, ramp and money', () => {
        const e = optionEvidence(views(shoe('S1', 40, 11, 20), counterBets()), 'SL7');
        expect(e.rateNeg).toBeCloseTo(0.8, 9);
        expect(e.ratePos).toBeCloseTo(5 / 30, 9);
        expect(e.tests.entry.value).toBeCloseTo(4.8, 9);
        expect(e.tests.entry.state).toBe('flag');
        expect(e.tests.ramp.value).toBeCloseTo(5, 9);
        expect(e.tests.ramp.state).toBe('flag');
        expect(e.tests.money.value).toBeCloseTo((4000 / 4500) / 0.25, 9);
        expect(e.tests.money.state).toBe('flag');
        expect(e.tests.luck.state).toBe('insufficient');
    });
    it('needs 10 negative-edge hands before judging entry', () => {
        const e = optionEvidence(views(shoe('S1', 40, 11, 15), counterBets()), 'SL7');
        expect(e.tests.entry.state).toBe('insufficient');
    });
    it('reads only-negative-edge betting as infinite entry', () => {
        const bets = [betRow('S1', 1, 'BANKER', 100), betRow('S1', 40, 'BANKER', 100),
            ...[11, 12, 13, 14, 15, 16].map((h) => betRow('S1', h, 'SL7', 300))];
        const e = optionEvidence(views(shoe('S1', 40, 11, 20), bets), 'SL7');
        expect(e.tests.entry.value).toBe(Infinity);
        expect(e.tests.entry.state).toBe('flag');
    });
    it('measures result against theo in standard deviations', () => {
        const bets = Array.from({ length: 30 }, (_, i) => betRow('S1', i + 1, 'BANKER', 1000, { casino_win: -950, theo_win: 10.6 }));
        const e = optionEvidence(views(shoe('S1', 30), bets), 'BANKER');
        expect(e.tests.luck.value).toBeCloseTo((30 * 960.6) / Math.sqrt(30 * 1e6 * 0.86), 6);
        expect(e.tests.luck.state).toBe('flag');
    });
    it('orders side bets first by turnover, then main bets', () => {
        const rows = evidenceFor(views(shoe('S1', 40, 11, 20), [...counterBets(), betRow('S1', 5, 'TIE', 100)]));
        expect(rows.map((r) => r.code)).toEqual(['SL7', 'TIE', 'BANKER']);
        expect(defaultOption(rows)).toBe('SL7');
        expect(defaultOption([])).toBe('BANKER');
    });
});

describe('verdictFrom', () => {
    const row = (code, states) => ({
        code,
        tests: Object.fromEntries(['entry', 'ramp', 'money', 'luck'].map((id) => [id, { value: 1, state: states[id] || 'clear' }])),
    });
    it('ACTION on any counting flag', () => {
        const v = verdictFrom([row('SL7', { entry: 'flag' })]);
        expect(v.level).toBe('ACTION');
        expect(v.reason).toBe('1 flag: SL7 selective entry');
    });
    it('ACTION on two luck flags', () => {
        expect(verdictFrom([row('SL7', { luck: 'flag' }), row('TIE', { luck: 'flag' })]).level).toBe('ACTION');
    });
    it('WATCH on one luck flag or two watches', () => {
        expect(verdictFrom([row('SL7', { luck: 'flag' })]).level).toBe('WATCH');
        expect(verdictFrom([row('SL7', { entry: 'watch', ramp: 'watch' })]).level).toBe('WATCH');
    });
    it('CLEAR with at most one watch', () => {
        expect(verdictFrom([row('SL7', { ramp: 'watch' })])).toEqual({ level: 'CLEAR', reason: '1 watch: SL7 bet ramp' });
    });
    it('NO DATA when nothing could be tested', () => {
        const none = { code: 'SL7', tests: { entry: { state: 'insufficient' }, luck: { state: 'insufficient' } } };
        expect(verdictFrom([none]).level).toBe('NO DATA');
        expect(verdictFrom([]).level).toBe('NO DATA');
    });
});

describe('heatmap rows and build', () => {
    const edges = [...shoe('S1', 40, 11, 20), ...shoe('S2', 40)];
    const bets = [...counterBets(), betRow('S2', 3, 'BANKER', 100), betRow('S2', 9, 'SL7', 900)];
    it('keeps shoes with bets on the option and puts the most money on −edge first', () => {
        const vs = views(edges, bets);
        expect(heatmapRows(vs, 'SL7').map((r) => r.view.shoeId)).toEqual(['S1', 'S2']);
        expect(heatmapRows(vs, 'TIE')).toHaveLength(0);
        expect(heatmapRows(vs, 'TIE', { onlyBet: false })).toHaveLength(2);
    });
    it('assembles the model', () => {
        const m = buildPatron360(bets, edges);
        expect(m.views).toHaveLength(2);
        expect(m.defaultOption).toBe('SL7');
        expect(m.verdict.level).toBe('ACTION');
    });
});
```

- [ ] **Step 3: Run — expect FAIL** (missing exports).

Run: `$env:CI='true'; npx react-scripts test --watchAll=false src/realtime/utils/__tests__/patron360`

- [ ] **Step 4: Implement** — replace `src/realtime/utils/patron360.js`:

```js
// Player 360 — side-bet advantage model.
// =====================================
// Spec: docs/superpowers/specs/2026-09-26-patron-360-side-bet-design.md
//
// Pure calculations behind the Player 360 (no React, no fetching; unit
// tested). Two inputs, both for one patron over a date range:
//   bets       — one row per bet the patron placed            (contract §8)
//   shoe edges — one row per hand of every shoe they played,
//                with the live edge of every bet option         (contract §9)
// Joined per shoe they answer the advantage question directly: when an
// option's edge turned negative, did this patron start betting it?
//
// Money leaving this module is PATRON perspective (+ = patron won).

import { PATRON_360, GAMING_DAY_START_HOUR } from '../constants/rtConfig';

const { BET_OPTIONS, TESTS, COUNTING_TESTS } = PATRON_360;

export const OPTION_BY_CODE = new Map(BET_OPTIONS.map((o) => [o.code, o]));
const optionRank = (code) => {
    const i = BET_OPTIONS.findIndex((o) => o.code === code);
    return i === -1 ? 99 : i;
};

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const pad2 = (n) => String(n).padStart(2, '0');
const flag = (v) => v === true || Number(v) === 1;

export const ymd = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

function groupBy(arr, keyFn) {
    const m = new Map();
    for (const x of arr) {
        const k = keyFn(x);
        let list = m.get(k);
        if (!list) { list = []; m.set(k, list); }
        list.push(x);
    }
    return m;
}

// Gaming day of `now`: the local date 7 hours earlier.
export function currentGamingDate(now = Date.now()) {
    return ymd(new Date(now - GAMING_DAY_START_HOUR * 3600000));
}

export const RANGES = [
    { id: 'today', label: 'Today' },
    { id: '7d', label: '7 days' },
    { id: '30d', label: '30 days' },
    { id: 'ytd', label: 'YTD' },
];

export function rangeFor(id, now = Date.now()) {
    const to = currentGamingDate(now);
    if (id === 'today') return { from: to, to };
    if (id === '7d' || id === '30d') {
        const [y, m, d] = to.split('-').map(Number);
        return { from: ymd(new Date(y, m - 1, d - (id === '7d' ? 6 : 29))), to };
    }
    return { from: `${to.slice(0, 4)}-01-01`, to };
}

export function normalizeBets(rows) {
    const out = [];
    for (const r of rows || []) {
        const wager = num(r.wager);
        if (!(wager > 0) || !r.bet_type) continue;
        const tableKey = `${r.gametype}|${r.table_id}`;
        out.push({
            date: String(r.gaming_date).slice(0, 10),
            time: r.game_time,
            tableKey,
            shoeId: r.shoe_id,
            shoeKey: `${tableKey}|${r.shoe_id}`,
            handNo: num(r.hand_no),
            betType: String(r.bet_type).toUpperCase(),
            wager,
            casinoWin: num(r.casino_win),
            theoWin: num(r.theo_win),
        });
    }
    out.sort((a, b) => String(a.time).localeCompare(String(b.time)) || a.handNo - b.handNo);
    return out;
}

export function normalizeShoeEdges(rows) {
    const shoes = new Map();
    for (const r of rows || []) {
        const tableKey = `${r.gametype}|${r.table_id}`;
        const shoeKey = `${tableKey}|${r.shoe_id}`;
        let s = shoes.get(shoeKey);
        if (!s) {
            s = { shoeKey, tableKey, shoeId: r.shoe_id, date: String(r.gaming_date).slice(0, 10), start: r.game_time, hands: [] };
            shoes.set(shoeKey, s);
        }
        const edge = {};
        for (const o of BET_OPTIONS) {
            const v = r[`house_edge_${o.edgeKey}`];
            edge[o.code] = v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v);
        }
        s.hands.push({
            handNo: num(r.hand_no), time: r.game_time, result: r.result,
            bankerPair: flag(r.banker_pair), playerPair: flag(r.player_pair), edge,
        });
        if (String(r.game_time) < String(s.start)) s.start = r.game_time;
    }
    for (const s of shoes.values()) s.hands.sort((a, b) => a.handNo - b.handNo);
    return shoes;
}

// Join shoes and bets. `firstHand`..`lastHand` is the patron's seat window
// in that shoe — only hands inside it count as a chance to bet.
export function buildShoeViews(shoes, bets) {
    const byShoe = groupBy(bets, (b) => b.shoeKey);
    const views = [];
    const add = (s, list) => {
        const betsByHand = new Map();
        let first = null, last = null;
        for (const b of list) {
            let hand = betsByHand.get(b.handNo);
            if (!hand) { hand = new Map(); betsByHand.set(b.handNo, hand); }
            const c = hand.get(b.betType) || { wager: 0, casinoWin: 0, theoWin: 0 };
            c.wager += b.wager; c.casinoWin += b.casinoWin; c.theoWin += b.theoWin;
            hand.set(b.betType, c);
            if (first == null || b.handNo < first) first = b.handNo;
            if (last == null || b.handNo > last) last = b.handNo;
        }
        let maxHand = last ?? 0;
        for (const h of s.hands) if (h.handNo > maxHand) maxHand = h.handNo;
        views.push({ ...s, bets: list, betsByHand, firstHand: first, lastHand: last, maxHand });
    };
    for (const s of shoes.values()) add(s, byShoe.get(s.shoeKey) || []);
    // Bets whose shoe is missing from the edge feed still show, edge-less.
    for (const [key, list] of byShoe) {
        if (shoes.has(key)) continue;
        const b = list[0];
        add({ shoeKey: key, tableKey: b.tableKey, shoeId: b.shoeId, date: b.date, start: b.time, hands: [], missingEdges: true }, list);
    }
    return views.sort((a, b) => String(b.start).localeCompare(String(a.start)));
}

export const inWindow = (view, handNo) =>
    view.firstHand != null && handNo >= view.firstHand && handNo <= view.lastHand;

const cellFor = (view, handNo, code) => {
    const m = view.betsByHand.get(handNo);
    return m ? m.get(code) || null : null;
};

export function optionShoeStats(view, code) {
    let bets = 0, turnover = 0, casino = 0, negMoney = 0, negHands = 0, negHandsBet = 0, windowHands = 0;
    for (const h of view.hands) {
        if (!inWindow(view, h.handNo)) continue;
        windowHands += 1;
        const e = h.edge[code];
        const neg = e != null && e < 0;
        if (neg) negHands += 1;
        const c = cellFor(view, h.handNo, code);
        if (!c) continue;
        bets += 1; turnover += c.wager; casino += c.casinoWin;
        if (neg) { negMoney += c.wager; negHandsBet += 1; }
    }
    return {
        bets, turnover, result: -casino, negMoney,
        negMoneyShare: turnover ? negMoney / turnover : null,
        negHands, negHandsBet, windowHands,
    };
}

// ── Evidence tests ───────────────────────────────────────────────────
export const TEST_META = {
    entry: { label: 'Selective entry', unit: 'x', question: 'Do they bet this option far more often once its edge turns negative?' },
    ramp: { label: 'Bet ramp', unit: 'x', question: 'Do they bet bigger on negative-edge hands?' },
    money: { label: 'Money on −edge', unit: 'x', question: 'Is their money concentrated on negative-edge hands, compared with how often those hands occur?' },
    luck: { label: 'Result vs theo', unit: 'sd', question: 'Are they winning more than chance explains?' },
};

function testOf(id, value) {
    const t = TESTS[id];
    let state = 'insufficient';
    if (value != null && !Number.isNaN(value)) state = value >= t.flag ? 'flag' : value >= t.watch ? 'watch' : 'clear';
    return { value, state };
}

export function optionEvidence(views, code) {
    const opt = OPTION_BY_CODE.get(code);
    const unitVar = opt ? opt.var : 1;
    let negHands = 0, posHands = 0, negBets = 0, posBets = 0, negMoney = 0, posMoney = 0;
    let casino = 0, theoC = 0, variance = 0;
    for (const v of views) {
        for (const h of v.hands) {
            if (!inWindow(v, h.handNo)) continue;
            const e = h.edge[code];
            if (e == null) continue;
            const neg = e < 0;
            if (neg) negHands += 1; else posHands += 1;
            const c = cellFor(v, h.handNo, code);
            if (!c) continue;
            if (neg) { negBets += 1; negMoney += c.wager; } else { posBets += 1; posMoney += c.wager; }
            casino += c.casinoWin; theoC += c.theoWin;
            variance += c.wager * c.wager * unitVar;
        }
    }
    const bets = negBets + posBets;
    const turnover = negMoney + posMoney;
    const rateNeg = negHands ? negBets / negHands : null;
    const ratePos = posHands ? posBets / posHands : null;

    let entry = null;
    if (negHands >= TESTS.entry.minNegHands && posHands >= TESTS.entry.minPosHands && bets >= TESTS.entry.minBets) {
        entry = ratePos > 0 ? rateNeg / ratePos : Infinity;
    }
    const ramp = negBets >= TESTS.ramp.minEach && posBets >= TESTS.ramp.minEach
        ? (negMoney / negBets) / (posMoney / posBets) : null;
    const handShare = negHands + posHands ? negHands / (negHands + posHands) : 0;
    const money = bets >= TESTS.money.minBets && negHands >= TESTS.money.minNegHands && turnover > 0 && handShare > 0
        ? (negMoney / turnover) / handShare : null;
    const luck = bets >= TESTS.luck.minBets && variance > 0 ? (theoC - casino) / Math.sqrt(variance) : null;

    return {
        code, name: opt ? opt.name : code, side: opt ? opt.side : true,
        bets, turnover, result: -casino, theo: -theoC,
        negHands, posHands, negBets, posBets, negMoney, posMoney, rateNeg, ratePos,
        tests: { entry: testOf('entry', entry), ramp: testOf('ramp', ramp), money: testOf('money', money), luck: testOf('luck', luck) },
    };
}

// One row per option the patron bet: side bets first (by turnover), then
// the main bets in configured order.
export function evidenceFor(views) {
    const codes = new Set();
    for (const v of views) for (const b of v.bets) codes.add(b.betType);
    return [...codes].map((c) => optionEvidence(views, c)).sort((a, b) => {
        if (a.side !== b.side) return a.side ? -1 : 1;
        return a.side ? b.turnover - a.turnover : optionRank(a.code) - optionRank(b.code);
    });
}

export function verdictFrom(rows) {
    const all = [];
    for (const r of rows) for (const [id, t] of Object.entries(r.tests)) all.push({ id, code: r.code, state: t.state });
    if (!all.length || all.every((t) => t.state === 'insufficient')) return { level: 'NO DATA', reason: 'Not enough bets to judge' };
    const flags = all.filter((t) => t.state === 'flag');
    const watches = all.filter((t) => t.state === 'watch');
    const names = (list) => list.map((t) => `${t.code} ${TEST_META[t.id].label.toLowerCase()}`).join(', ');
    if (flags.some((t) => COUNTING_TESTS.includes(t.id)) || flags.length >= 2) {
        return { level: 'ACTION', reason: `${flags.length} flag${flags.length === 1 ? '' : 's'}: ${names(flags)}` };
    }
    if (flags.length === 1 || watches.length >= 2) {
        const parts = [];
        if (flags.length) parts.push(`1 flag: ${names(flags)}`);
        if (watches.length) parts.push(`${watches.length} watch: ${names(watches)}`);
        return { level: 'WATCH', reason: parts.join(' · ') };
    }
    return { level: 'CLEAR', reason: watches.length ? `1 watch: ${names(watches)}` : 'No test above threshold' };
}

export function defaultOption(rows) {
    const side = rows.find((r) => r.side && r.bets > 0);
    return (side || rows.find((r) => r.bets > 0) || rows[0] || { code: 'BANKER' }).code;
}

export function heatmapRows(views, code, { onlyBet = true, sort = 'suspicious' } = {}) {
    const rows = views.map((view) => ({ view, stats: optionShoeStats(view, code) }))
        .filter((r) => !onlyBet || r.stats.bets > 0);
    const newest = (a, b) => String(b.view.start).localeCompare(String(a.view.start));
    if (sort === 'suspicious') {
        rows.sort((a, b) => (b.stats.negMoney - a.stats.negMoney)
            || ((b.stats.negMoneyShare ?? 0) - (a.stats.negMoneyShare ?? 0))
            || newest(a, b));
    } else {
        rows.sort(newest);
    }
    return rows;
}

export function buildPatron360(betRows, edgeRows) {
    const bets = normalizeBets(betRows);
    const views = buildShoeViews(normalizeShoeEdges(edgeRows), bets);
    const evidence = evidenceFor(views);
    return { bets, views, evidence, verdict: verdictFrom(evidence), defaultOption: defaultOption(evidence) };
}
```

- [ ] **Step 5: Run — expect PASS.** (`patronBetsMock.test.js` will fail until Task 2 — expected.)

---

### Task 2: Mock, data source, contract

**Files:** rewrite `src/realtime/utils/patronBetsMock.js` and its test; modify `src/realtime/utils/rtDataSource.js`; modify `docs/realtime-surveillance-data-contract.md`.

**Interfaces — Consumes:** `hashKey`, `mulberry32` (shoeData), `currentGamingDate`, `ymd`, `OPTION_BY_CODE`, `buildPatron360` (Task 1). **Produces:** `generateMockPatronHistory(id, {now}) → {bets, shoeEdges}`, `isMockCounter(id)`, `fetchPatronBets(id, {from,to})`, `fetchPatronShoeEdges(id, {from,to})` → `Promise<{rows, live, error}>`.

- [ ] **Step 1: Failing test** — replace `src/realtime/utils/__tests__/patronBetsMock.test.js`:

```js
import { generateMockPatronHistory, isMockCounter } from '../patronBetsMock';
import { buildPatron360 } from '../patron360';
import { fetchPatronBets, fetchPatronShoeEdges } from '../rtDataSource';
import { PATRON_360 } from '../../constants/rtConfig';

const NOW = new Date(2026, 8, 25, 15, 0).getTime();
const BET_COLS = ['gaming_date', 'game_time', 'table_id', 'gametype', 'shoe_id', 'game_id', 'hand_no', 'seat',
    'dealer', 'result', 'bet_type', 'wager', 'casino_win', 'theo_win', 'edge_at_bet'];
const EDGE_COLS = ['gaming_date', 'table_id', 'gametype', 'shoe_id', 'hand_no', 'game_time', 'result', 'banker_pair',
    'player_pair', ...PATRON_360.BET_OPTIONS.map((o) => `house_edge_${o.edgeKey}`)];

const ids = Array.from({ length: 60 }, (_, i) => `PID-${10001 + i}`);
const counterId = ids.find(isMockCounter);
const normalId = ids.find((id) => !isMockCounter(id));

describe('generateMockPatronHistory', () => {
    const { bets, shoeEdges } = generateMockPatronHistory('PID-10001', { now: NOW });

    it('matches both contracts and stays inside the year', () => {
        expect(Object.keys(bets[0]).sort()).toEqual([...BET_COLS].sort());
        expect(Object.keys(shoeEdges[0]).sort()).toEqual([...EDGE_COLS].sort());
        expect(bets.every((r) => r.gaming_date >= '2026-01-01' && r.gaming_date <= '2026-09-25')).toBe(true);
        const today = shoeEdges.filter((r) => r.gaming_date === '2026-09-25');
        expect(today.length).toBeGreaterThan(0);
        expect(today.every((r) => new Date(r.game_time).getTime() <= NOW)).toBe(true);
    });

    it('gives every shoe all its hands and puts every bet inside one', () => {
        const hands = new Map();
        for (const r of shoeEdges) {
            const k = `${r.table_id}|${r.shoe_id}`;
            hands.set(k, (hands.get(k) || new Set()).add(r.hand_no));
        }
        for (const set of hands.values()) {
            expect(set.size).toBeGreaterThanOrEqual(70);
            expect(Math.max(...set)).toBe(set.size);
        }
        for (const b of bets) expect(hands.get(`${b.table_id}|${b.shoe_id}`).has(b.hand_no)).toBe(true);
    });

    it('makes counters look like counters and others not', () => {
        expect(counterId).toBeDefined();
        const c = generateMockPatronHistory(counterId, { now: NOW });
        expect(buildPatron360(c.bets, c.shoeEdges).verdict.level).toBe('ACTION');
        const n = generateMockPatronHistory(normalId, { now: NOW });
        expect(buildPatron360(n.bets, n.shoeEdges).verdict.level).not.toBe('ACTION');
    });
});

describe('patron feeds in mock mode', () => {
    it('filter both feeds by date range', async () => {
        const range = { from: '2026-09-01', to: '2026-09-20' };
        const [b, e] = await Promise.all([fetchPatronBets('PID-10001', range), fetchPatronShoeEdges('PID-10001', range)]);
        expect(b.live).toBe(false);
        expect(b.error).toBeNull();
        expect(b.rows.every((r) => r.gaming_date >= range.from && r.gaming_date <= range.to)).toBe(true);
        expect(e.rows.every((r) => r.gaming_date >= range.from && r.gaming_date <= range.to)).toBe(true);
    });
});
```

- [ ] **Step 2: Run — expect FAIL** (`generateMockPatronHistory` not exported).

- [ ] **Step 3: Implement** — replace `src/realtime/utils/patronBetsMock.js`:

```js
// Mock patron history for the Player 360 (contract §8 bets + §9 shoe edges).
// =======================================================================
// Deterministic per patron (memoised) so the 360 is stable across
// reopenings. Each shoe is 70–80 hands; every bet option's live edge
// follows a random walk around its theo that widens through the shoe, so
// negative edges show up mostly late, as on a real floor. The patron sits
// for a stretch of each shoe. One patron in eight is a synthetic side-bet
// counter: they bet a favourite side bet mostly when its edge is negative,
// and bigger the more negative it is — so CLEAR / WATCH / ACTION can all be
// demonstrated offline. Side-bet payouts below are mock-only.

import { hashKey, mulberry32 } from './shoeData';
import { PATRON_360, GAMING_DAY_START_HOUR } from '../constants/rtConfig';
import { currentGamingDate, ymd, OPTION_BY_CODE } from './patron360';

const { BET_OPTIONS } = PATRON_360;
const SIDE = BET_OPTIONS.filter((o) => o.side);
const HAND_MS = 55000;
const P_BANKER = 0.4586;
const P_PLAYER = 0.4462;
const P_PAIR = 0.0747;
// Per-hand step of each option's edge walk, in edge %.
const WANDER = { BANKER: 0.14, PLAYER: 0.14, TIE: 1.5, BTG: 0.6, STG: 1.0, BD: 0.4, SD: 0.4, SL7: 2.0, PPL: 1.2, L6: 1.4 };
// Side-bet payout (to one), for settling mock bets.
const PAYOUT = { TIE: 8, BTG: 20, STG: 40, BD: 10, SD: 10, SL7: 30, PPL: 11, L6: 12 };

const cache = new Map();

export const isMockCounter = (patronId) => hashKey(`bets|${patronId}`) % 8 === 0;

function gauss(rand) {
    let u = 0;
    while (u === 0) u = rand();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
}
const round100 = (v) => Math.max(100, Math.round(v / 100) * 100);

// Casino-perspective result of one mock bet. Main bets settle on the hand
// result; side bets hit with the probability their edge implies.
function settle(code, wager, result, edge, rand) {
    if (code === 'BANKER') return result === 'T' ? 0 : result === 'B' ? -wager * 0.95 : wager;
    if (code === 'PLAYER') return result === 'T' ? 0 : result === 'P' ? -wager : wager;
    if (code === 'TIE') return result === 'T' ? -wager * 8 : wager;
    const m = PAYOUT[code] || 10;
    const p = Math.min(0.95, Math.max(0, (1 - edge / 100) / (m + 1)));
    return rand() < p ? -wager * m : wager;
}

export function generateMockPatronHistory(patronId, { now = Date.now() } = {}) {
    const id = String(patronId);
    const today = currentGamingDate(now);
    const cacheKey = `${id}|${today}`;
    if (cache.has(cacheKey)) return cache.get(cacheKey);

    const rand = mulberry32(hashKey(`bets|${id}`));
    const counter = isMockCounter(id);
    const fav = SIDE[hashKey(`fav|${id}`) % SIDE.length].code;
    const baseBet = 300 + Math.floor(rand() * 18) * 100;
    const [y, m, d] = today.split('-').map(Number);
    const last = new Date(y, m - 1, d);
    const bets = [];
    const shoeEdges = [];

    for (let day = new Date(y, 0, 1); day <= last; day.setDate(day.getDate() + 1)) {
        const date = ymd(day);
        const isToday = date === today;
        if (!isToday && rand() > 0.35) continue;
        const dayBets = [];
        const dayEdges = [];
        let clock = new Date(day.getFullYear(), day.getMonth(), day.getDate(), GAMING_DAY_START_HOUR + 3).getTime();
        const shoes = 1 + Math.floor(rand() * 3);

        for (let s = 0; s < shoes; s += 1) {
            const gametype = rand() < 0.6 ? 'BA' : 'NC';
            const table = String(10001 + Math.floor(rand() * 90));
            const shoeId = `${gametype}${table}-${date.replace(/-/g, '')}-S${s + 1}`;
            const seat = 1 + Math.floor(rand() * 7);
            const dealer = `D${1 + (hashKey(shoeId) % 40)}`;
            const length = 70 + Math.floor(rand() * 11);
            const first = 1 + Math.floor(rand() * 30);
            const leave = Math.min(length, first + 14 + Math.floor(rand() * 31));
            const walk = Object.fromEntries(BET_OPTIONS.map((o) => [o.code, 0]));

            for (let h = 1; h <= length; h += 1) {
                const edge = {};
                for (const o of BET_OPTIONS) {
                    walk[o.code] += gauss(rand);
                    edge[o.code] = o.theo + (WANDER[o.code] ?? 1) * walk[o.code];
                }
                const u = rand();
                const result = u < P_BANKER ? 'B' : u < P_BANKER + P_PLAYER ? 'P' : 'T';
                const bankerPair = rand() < P_PAIR;
                const playerPair = rand() < P_PAIR;
                const time = new Date(clock).toISOString();
                clock += HAND_MS;

                const edgeRow = {
                    gaming_date: date, table_id: table, gametype, shoe_id: shoeId, hand_no: h, game_time: time,
                    result, banker_pair: bankerPair ? 1 : 0, player_pair: playerPair ? 1 : 0,
                };
                for (const o of BET_OPTIONS) edgeRow[`house_edge_${o.edgeKey}`] = +edge[o.code].toFixed(3);
                dayEdges.push(edgeRow);
                if (h < first || h > leave) continue;                    // not seated

                const placed = [];
                if (rand() < 0.85) placed.push([rand() < 0.55 ? 'BANKER' : 'PLAYER', round100(baseBet * (0.6 + 0.8 * rand()))]);
                if (counter && edge[fav] < 0) {
                    if (rand() < 0.85) placed.push([fav, round100(baseBet * (0.3 + 0.4 * rand()) * (1 + Math.min(3, -edge[fav] / 5)))]);
                } else if (rand() < (counter ? 0.03 : 0.1)) {
                    const code = counter ? fav : SIDE[Math.floor(rand() * SIDE.length)].code;
                    placed.push([code, round100(baseBet * (0.1 + 0.2 * rand()))]);
                }
                for (const [code, w] of placed) {
                    dayBets.push({
                        gaming_date: date, game_time: time, table_id: table, gametype, shoe_id: shoeId,
                        game_id: `${shoeId}-H${h}`, hand_no: h, seat, dealer, result,
                        bet_type: code, wager: w,
                        casino_win: settle(code, w, result, edge[code], rand),
                        theo_win: +((w * OPTION_BY_CODE.get(code).theo) / 100).toFixed(2),
                        edge_at_bet: +edge[code].toFixed(3),
                    });
                }
            }
            clock += 15 * 60000;
        }

        if (isToday && dayEdges.length) {
            // Land today's play so its last hand was a minute ago.
            const shift = (now - 60000) - new Date(dayEdges[dayEdges.length - 1].game_time).getTime();
            const move = (r) => { r.game_time = new Date(new Date(r.game_time).getTime() + shift).toISOString(); };
            dayEdges.forEach(move);
            dayBets.forEach(move);
        }
        bets.push(...dayBets);
        shoeEdges.push(...dayEdges);
    }

    const out = { bets, shoeEdges };
    cache.set(cacheKey, out);
    return out;
}
```

- [ ] **Step 4: Data source** — in `src/realtime/utils/rtDataSource.js`:
  - Replace `import { generateMockPatronBets } from './patronBetsMock';` with `import { generateMockPatronHistory } from './patronBetsMock';`
  - Header list: replace the `/bets` line with
    `//   GET /realtime/patron/{id}/bets?from&to       → that patron's bets (on demand, Player 360)` and add
    `//   GET /realtime/patron/{id}/shoe-edges?from&to → edge per hand of their shoes (on demand, Player 360)`
  - Replace the whole `fetchPatronBets` function with:

```js
// ── Player 360 feeds (§8 bets, §9 shoe edges) ────────────────────────
// On demand only, per patron and date range. A configured endpoint that
// fails returns no rows plus the error — never mock data for a real
// patron under investigation.
function patronUrl(tpl, patronId, suffix, { from, to }) {
    const id = encodeURIComponent(patronId);
    const base = tpl.includes('{id}') ? tpl.replace('{id}', id) : `${tpl}/${id}/${suffix}`;
    const qs = [];
    if (from) qs.push(`from=${encodeURIComponent(from)}`);
    if (to) qs.push(`to=${encodeURIComponent(to)}`);
    return qs.length ? `${base}${base.includes('?') ? '&' : '?'}${qs.join('&')}` : base;
}

async function fetchPatronFeed(name, tpl, suffix, patronId, range, mockRows) {
    const { from = null, to = null } = range || {};
    if (!tpl) {
        const rows = mockRows().filter((r) => (!from || r.gaming_date >= from) && (!to || r.gaming_date <= to));
        return { rows, live: false, error: null };
    }
    try {
        return { rows: await fetchJson(patronUrl(tpl, patronId, suffix, { from, to }), { timeoutMs: 60000 }), live: true, error: null };
    } catch (err) {
        // eslint-disable-next-line no-console
        console.warn(`[RT] ${name} feed failed:`, err.message);
        return { rows: [], live: false, error: err.message };
    }
}

export function fetchPatronBets(patronId, range) {
    return fetchPatronFeed('patron bets', RT_ENDPOINTS.patronBets, 'bets', patronId, range,
        () => generateMockPatronHistory(patronId).bets);
}

export function fetchPatronShoeEdges(patronId, range) {
    return fetchPatronFeed('patron shoe edges', RT_ENDPOINTS.patronShoeEdges, 'shoe-edges', patronId, range,
        () => generateMockPatronHistory(patronId).shoeEdges);
}
```

- [ ] **Step 5: Run all realtime tests — expect PASS.**

- [ ] **Step 6: Contract** — `docs/realtime-surveillance-data-contract.md`:
  - Line 6 → `**127 columns across 9 endpoints.**`
  - §8 heading → ``## 8. `GET /realtime/patron/{id}/bets?from&to` — Player 360 bets``; first paragraph → "One row per bet the patron placed between `from` and `to` (inclusive gaming dates; the 360 defaults to 1 January → today). **15 columns.** Fetched when the Player 360 opens and whenever its date range changes — never polled."; `bet_type` notes → "`BANKER`, `PLAYER`, `TIE`, `BTG`, `STG`, `BD`, `SD`, `SL7`, `PPL`, `L6`"; backend line → `select * from <table> where player_id = $1 and gaming_date between $2 and $3`.
  - Rename `## 9. Resolved decisions` → `## 10. Resolved decisions` and insert before it:

```markdown
## 9. `GET /realtime/patron/{id}/shoe-edges?from&to` — Player 360 edge per hand

One row per **hand** of every shoe in which the patron placed at least
one bet between `from` and `to` — **including hands they did not bet**,
so the 360 can show what the edge was while they sat out. **19 columns.**
Fetched alongside §8.

| Column | Type | Notes |
|---|---|---|
| `gaming_date` | DATE | |
| `table_id` | TEXT | |
| `gametype` | TEXT | `BA` / `NC` |
| `shoe_id` | TEXT | |
| `hand_no` | INTEGER | 1-based |
| `game_time` | TIMESTAMP | |
| `result` | TEXT | `B` / `P` / `T` |
| `banker_pair` | SMALLINT | optional 0/1, drawn on the road |
| `player_pair` | SMALLINT | optional 0/1, drawn on the road |
| `house_edge_banker` | NUMERIC | house edge % given the cards left **before** this hand |
| `house_edge_player` | NUMERIC | 〃 |
| `house_edge_tie` | NUMERIC | 〃 |
| `house_edge_btg` | NUMERIC | 〃 |
| `house_edge_stg` | NUMERIC | 〃 |
| `house_edge_bd` | NUMERIC | 〃 |
| `house_edge_sd` | NUMERIC | 〃 |
| `house_edge_sl7` | NUMERIC | 〃 |
| `house_edge_ppl` | NUMERIC | 〃 |
| `house_edge_l6` | NUMERIC | 〃 (null = option not offered on that table) |

Casino perspective: positive = house favoured, negative = the remaining
cards favour the player. Env var: `REACT_APP_RT_PATRON_SHOE_EDGES_URL`
(default: sibling path `/patron/{id}/shoe-edges`). Same failure rule as §8.

---
```

  - Summary table: `/realtime/patron/{id}/bets` row cadence → "On demand (Player 360, per range)"; add `| /realtime/patron/{id}/shoe-edges | ~75 × shoes | 19 | On demand (Player 360, per range) |`.

---

### Task 3: Shared roads with highlights

**Files:** modify `src/trend/components/BaccaratBoard.jsx` (`extras`, `mergeExtras`); create `src/realtime/components/ShoeRoads.js`; modify `src/realtime/components/RtShoeBoard.js`; add a test to `src/realtime/utils/__tests__/roads.test.js`.

**Interfaces — Produces:** default `ShoeRoads({ hands, selectedHandNo, onSelectHand, markedHands, emphasisHands, emphasisColor, beadLabel })`, named `GOLD`. Big Road cells gain `handNos: number[]`.

- [ ] **Step 1: Failing test** — append to `roads.test.js`:

```js
test('big road cells remember which hands they hold, ties included', () => {
    const hands = [{ result: 'B', handNo: 1 }, { result: 'T', handNo: 2 }, { result: 'B', handNo: 3 }];
    const road = buildBigRoad(hands, 6);
    expect(road[0][0].handNos).toEqual([1, 2]);
    expect(road[0][1].handNos).toEqual([3]);
});
```

- [ ] **Step 2: Implement** — in `BaccaratBoard.jsx`, `extras(h)` gains `handNos: h.handNo != null ? [h.handNo] : [],` and `mergeExtras(cell, h)` gains `if (h.handNo != null) (cell.handNos ||= []).push(h.handNo);`.

- [ ] **Step 3: Create `src/realtime/components/ShoeRoads.js`:**

```js
// Casino roads for one shoe — Big Road, the three derived roads and the
// bead plate — drawn with Trend Seeker's renderer so they look exactly
// like the boards floor staff already read. Shared by the shoe board and
// the Player 360. Optional highlight sets ring the hands a patron bet:
// `markedHands` in gold, `emphasisHands` in `emphasisColor` (wins when a
// hand is in both); the selected hand gets the accent ring.

import React, { useMemo } from 'react';
import { Box, ButtonBase, Stack, Typography } from '@mui/material';
import {
    buildBigRoad, buildDerivedRoad, BigRoadCell, DerivedDotCell, CockroachCell,
    BeadPlateCell, RoadGrid, chunkBeadPlate,
} from '../../trend/components/BaccaratBoard';
import { TEXT, ACCENT } from '../constants/rtTheme';

export const GOLD = '#ffd479';
const NONE = new Set();
const RESULT_LABEL = { B: 'Banker', P: 'Player', T: 'Tie' };

function RoadBlock({ label, children }) {
    return (
        <Box>
            <Typography sx={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.4, color: TEXT.muted, mb: 0.4 }}>{label}</Typography>
            <Box sx={{ borderRadius: 1, overflow: 'hidden', border: '1px solid rgba(255,255,255,0.12)' }}>{children}</Box>
        </Box>
    );
}

export default function ShoeRoads({
    hands, selectedHandNo = null, onSelectHand = null,
    markedHands = NONE, emphasisHands = NONE, emphasisColor = '#ffffff',
    beadLabel = 'Bead plate · 珠盤路',
}) {
    const bigRoad = useMemo(() => buildBigRoad(hands, 6), [hands]);
    const bigEye = useMemo(() => buildDerivedRoad(hands, 1, 6), [hands]);
    const small = useMemo(() => buildDerivedRoad(hands, 2, 6), [hands]);
    const cockroach = useMemo(() => buildDerivedRoad(hands, 3, 6), [hands]);
    const bead = useMemo(() => chunkBeadPlate(hands, 6), [hands]);

    const ringFor = (nos) => {
        if (nos.some((n) => emphasisHands.has(n))) return emphasisColor;
        if (nos.some((n) => markedHands.has(n))) return GOLD;
        return null;
    };

    return (
        <Stack spacing={1.1}>
            <RoadBlock label="Big Road · 大路">
                <RoadGrid cols={bigRoad} rows={6} cellSize={24} minCols={Math.max(24, bigRoad.length + 2)}
                    render={(c, s) => {
                        const ring = c && c.handNos ? ringFor(c.handNos) : null;
                        return ring ? (
                            <Box sx={{ width: s, height: s, borderRadius: '50%', outline: `2px solid ${ring}`, outlineOffset: -2 }}>
                                <BigRoadCell cell={c} size={s} />
                            </Box>
                        ) : <BigRoadCell cell={c} size={s} />;
                    }} />
            </RoadBlock>
            <RoadBlock label="Big Eye · 大眼仔">
                <RoadGrid cols={bigEye} rows={6} cellSize={12} minCols={48}
                    render={(m, s) => <DerivedDotCell mark={m} size={s} filled={false} />} />
            </RoadBlock>
            <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1 }}>
                <RoadBlock label="Small Road · 小路">
                    <RoadGrid cols={small} rows={6} cellSize={12} minCols={24}
                        render={(m, s) => <DerivedDotCell mark={m} size={s} filled />} />
                </RoadBlock>
                <RoadBlock label="Cockroach · 曱甴路">
                    <RoadGrid cols={cockroach} rows={6} cellSize={12} minCols={24}
                        render={(m, s) => <CockroachCell mark={m} size={s} />} />
                </RoadBlock>
            </Box>
            <RoadBlock label={beadLabel}>
                <RoadGrid cols={bead} rows={6} cellSize={28} minCols={Math.max(12, bead.length)} fillWidth={false}
                    render={(h, s) => {
                        if (!h) return <BeadPlateCell hand={null} size={s} />;
                        const selected = h.handNo === selectedHandNo;
                        const ring = selected ? ACCENT : ringFor([h.handNo]);
                        const label = `Hand ${h.handNo}, ${RESULT_LABEL[h.result] || 'unknown'}`;
                        const sx = {
                            width: s, height: s, borderRadius: '50%', display: 'block',
                            outline: ring ? `${selected ? 3 : 2}px solid ${ring}` : 'none', outlineOffset: -1,
                        };
                        return onSelectHand ? (
                            <ButtonBase onClick={() => onSelectHand(h.handNo)} aria-label={label} sx={sx}>
                                <BeadPlateCell hand={h} size={s} />
                            </ButtonBase>
                        ) : (
                            <Box title={label} sx={sx}><BeadPlateCell hand={h} size={s} /></Box>
                        );
                    }} />
            </RoadBlock>
        </Stack>
    );
}
```

- [ ] **Step 4: RtShoeBoard** — replace its BaccaratBoard import with `import { BANKER, PLAYER, TIE } from '../../trend/components/BaccaratBoard';` and add `import ShoeRoads from './ShoeRoads';`; delete its local `RoadBlock` and `Roads` functions; replace the `<Roads … />` element with:

```jsx
<ShoeRoads hands={hands} selectedHandNo={selectedHandNo} onSelectHand={onSelectHand}
    markedHands={patronHands} beadLabel="Bead plate · 珠盤路 — click a hand" />
```

- [ ] **Step 5: Run all realtime tests — expect PASS.** Reload the dashboard; the shoe board roads look as before (Big Road cells of the selected patron's hands now also ringed gold).

---

### Task 4: Formatters, option chips, advantage table

**Files:** rewrite `src/realtime/components/patron360/format.js`; create `OptionChips.js`, `AdvantageTable.js`.

**Interfaces — Consumes:** `PATRON_360`, `OPTION_BY_CODE`, `TEST_META`, evidence rows (Task 1). **Produces:** `money, plain, signColor, pct(v,d=1), share, int, optionColor(code), LEVEL_COLOR, STATE_STYLE, EDGE_COLORS, edgeBands(theo) → [{gte?,lt?,color,label}], SHOE_COLORS, shoeLabel(view), formatTestValue(unit,v), thresholdHint(id,unit)`; `<OptionChips value onChange turnoverByCode />`; `<AdvantageTable rows selected onSelect />`.

- [ ] **Step 1: Replace `format.js`:**

```js
// Player 360 — formatters, labels and colour maps shared by its sections.

import { PATRON_360 } from '../../constants/rtConfig';
import { STATE, TEXT } from '../../constants/rtTheme';
import { OPTION_BY_CODE } from '../../utils/patron360';

const ok = (v) => v != null && Number.isFinite(v);

// Signed money: +$1.2K / −$950. Patron perspective at every call site.
export const money = (v) => {
    if (!ok(v)) return '—';
    const a = Math.abs(v), s = v < 0 ? '−' : v > 0 ? '+' : '';
    if (a >= 1e6) return `${s}$${(a / 1e6).toFixed(2)}M`;
    if (a >= 1e3) return `${s}$${(a / 1e3).toFixed(a >= 1e4 ? 0 : 1)}K`;
    return `${s}$${Math.round(a)}`;
};
export const plain = (v) => money(v).replace('+', '');
export const signColor = (v) => (!ok(v) || v === 0 ? TEXT.muted : v < 0 ? STATE.negative : STATE.positive);
export const pct = (v, d = 1) => (ok(v) ? `${v < 0 ? '−' : ''}${Math.abs(v).toFixed(d)}%` : '—');
export const share = (v) => (ok(v) ? `${(v * 100).toFixed(v > 0 && v < 0.1 ? 1 : 0)}%` : '—');
export const int = (v) => (ok(v) ? Math.round(v).toLocaleString() : '—');

export const optionColor = (code) => (OPTION_BY_CODE.get(code) || {}).color || '#8a93b2';

export const LEVEL_COLOR = { ACTION: STATE.negative, WATCH: STATE.warning, CLEAR: STATE.positive, 'NO DATA': TEXT.muted };

export const STATE_STYLE = {
    flag: { label: 'FLAG', color: STATE.negative, bg: STATE.negativeBg },
    watch: { label: 'WATCH', color: STATE.warning, bg: STATE.warningBg },
    clear: { label: 'CLEAR', color: STATE.positive, bg: STATE.positiveBg },
    insufficient: { label: 'NO DATA', color: TEXT.muted, bg: 'rgba(255,255,255,0.04)' },
};

// Magenta = the cards favour the player — the same meaning as on the
// floor map's house-edge colours.
export const EDGE_COLORS = {
    deep: 'rgb(255,0,200)',
    player: 'rgb(214,92,255)',
    thin: '#e0af68',
    mid: '#58628c',
    house: '#262c48',
};

// Heatmap bands relative to the option's theo, so a Banker cell and an
// SL7 cell read the same way.
export function edgeBands(theo) {
    const deep = -Math.max(1, theo / 3);
    const half = theo / 2;
    return [
        { lt: deep, color: EDGE_COLORS.deep, label: `below ${pct(deep)}` },
        { gte: deep, lt: 0, color: EDGE_COLORS.player, label: `${pct(deep)} to 0%` },
        { gte: 0, lt: half, color: EDGE_COLORS.thin, label: `0 to ${pct(half)}` },
        { gte: half, lt: theo, color: EDGE_COLORS.mid, label: `${pct(half)} to ${pct(theo)}` },
        { gte: theo, color: EDGE_COLORS.house, label: `${pct(theo)}+ (theo)` },
    ];
}

export const SHOE_COLORS = ['#7aa2f7', '#f2c14e', '#6ad08f', '#ff7eb6', '#7dcfff', '#ff9e64', '#c0a6ff', '#e6e6e6'];

const shortShoe = (id) => {
    const s = String(id ?? '');
    return s.length > 12 ? `…${s.slice(-8)}` : s;
};
export const shoeLabel = (v) => `${String(v.date || '').slice(5)} · ${v.tableKey} · ${shortShoe(v.shoeId)}`;

export function formatTestValue(unit, v) {
    if (v === Infinity) return '∞';
    if (!ok(v)) return '—';
    if (unit === 'x') return `${v.toFixed(1)}×`;
    if (unit === 'sd') return `${v < 0 ? '−' : '+'}${Math.abs(v).toFixed(1)} SD`;
    return String(v);
}

export function thresholdHint(id, unit) {
    const t = PATRON_360.TESTS[id];
    return `watch ≥ ${formatTestValue(unit, t.watch)} · flag ≥ ${formatTestValue(unit, t.flag)}`;
}
```

- [ ] **Step 2: Create `OptionChips.js`:**

```js
// Bet-option picker: one chip per configured option in its colour, with
// the patron's turnover on it. Unused options stay visible but disabled,
// so the menu keeps the same shape for every patron.

import React from 'react';
import { Box, ButtonBase } from '@mui/material';
import { PATRON_360 } from '../../constants/rtConfig';
import { TEXT, ACCENT } from '../../constants/rtTheme';
import { plain } from './format';

export default function OptionChips({ value, onChange, turnoverByCode }) {
    return (
        <Box role="radiogroup" aria-label="Bet option" sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
            {PATRON_360.BET_OPTIONS.map((o) => {
                const t = turnoverByCode.get(o.code) || 0;
                const on = value === o.code;
                return (
                    <ButtonBase
                        key={o.code}
                        role="radio"
                        aria-checked={on}
                        disabled={!t}
                        title={o.name}
                        onClick={() => onChange(o.code)}
                        sx={{
                            gap: 0.75, px: 1.25, py: 0.6, borderRadius: 1, fontSize: 13, fontWeight: 800,
                            border: `1px solid ${on ? o.color : 'rgba(255,255,255,0.14)'}`,
                            bgcolor: on ? o.color : 'rgba(255,255,255,0.03)',
                            color: on ? '#0d0e18' : TEXT.primary,
                            opacity: t ? 1 : 0.4,
                            transition: 'background-color 150ms, border-color 150ms',
                            '&:hover': { borderColor: o.color },
                            '&.Mui-focusVisible': { outline: `2px solid ${ACCENT}`, outlineOffset: 2 },
                        }}
                    >
                        {on ? null : <Box component="span" sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: o.color }} />}
                        {o.code}
                        <Box component="span" sx={{ fontWeight: 600, opacity: 0.8, fontVariantNumeric: 'tabular-nums' }}>{t ? plain(t) : '—'}</Box>
                    </ButtonBase>
                );
            })}
        </Box>
    );
}
```

- [ ] **Step 3: Create `AdvantageTable.js`:**

```js
// Advantage evidence — one row per bet option the patron used. Every test
// asks one thing: did money arrive when that option's edge turned
// negative? Clicking a row puts that option under the heatmap and charts.

import React from 'react';
import { Box, Typography } from '@mui/material';
import { TEXT, ACCENT, systemLabel } from '../../constants/rtTheme';
import { TEST_META } from '../../utils/patron360';
import { STATE_STYLE, formatTestValue, thresholdHint, money, plain, int, share, signColor, optionColor } from './format';

const TEST_IDS = ['entry', 'ramp', 'money', 'luck'];
const cellSx = { px: 1.25, py: 1, textAlign: 'right', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', verticalAlign: 'middle' };

function detail(id, r) {
    if (id === 'entry') {
        return r.rateNeg != null ? `bets ${share(r.rateNeg)} of −edge hands vs ${share(r.ratePos)} of others` : 'no −edge hands while seated';
    }
    if (id === 'ramp') {
        return r.negBets && r.posBets ? `avg ${plain(r.negMoney / r.negBets)} vs ${plain(r.posMoney / r.posBets)}` : `${r.negBets} bets on −edge hands`;
    }
    if (id === 'money') {
        const hands = r.negHands + r.posHands;
        return r.turnover && hands ? `${share(r.negMoney / r.turnover)} of money on ${share(r.negHands / hands)} of hands` : '—';
    }
    return `${money(r.result)} vs theo ${money(r.theo)}`;
}

function TestCell({ id, r }) {
    const t = r.tests[id];
    const s = STATE_STYLE[t.state];
    return (
        <Box component="td" sx={{ ...cellSx, textAlign: 'left' }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25 }}>
                <Box sx={{
                    width: 64, flexShrink: 0, py: 0.3, borderRadius: 1, textAlign: 'center',
                    fontSize: 11, fontWeight: 900, letterSpacing: 0.8, color: s.color, border: `1px solid ${s.color}`, bgcolor: s.bg,
                }}>
                    {s.label}
                </Box>
                <Box sx={{ minWidth: 0 }}>
                    <Typography sx={{ fontSize: 15, fontWeight: 800, lineHeight: 1.2, color: t.state === 'insufficient' ? TEXT.faint : TEXT.primary }}>
                        {formatTestValue(TEST_META[id].unit, t.value)}
                    </Typography>
                    <Typography sx={{ fontSize: 11, color: TEXT.faint, lineHeight: 1.3 }}>{detail(id, r)}</Typography>
                </Box>
            </Box>
        </Box>
    );
}

export default function AdvantageTable({ rows, selected, onSelect }) {
    if (!rows.length) return <Typography sx={{ fontSize: 13, color: TEXT.faint, py: 2 }}>No bets in this range.</Typography>;
    return (
        <Box sx={{ overflowX: 'auto' }}>
            <Box component="table" sx={{ width: '100%', minWidth: 1180, borderCollapse: 'separate', borderSpacing: '0 4px' }}>
                <thead>
                    <tr>
                        {['Bet option', 'Bets', 'Turnover', 'Result'].map((h, i) => (
                            <Box component="th" key={h} sx={{ ...systemLabel, ...cellSx, py: 0.5, textAlign: i ? 'right' : 'left' }}>{h}</Box>
                        ))}
                        {TEST_IDS.map((id) => (
                            <Box component="th" key={id} title={TEST_META[id].question} sx={{ ...cellSx, py: 0.5, textAlign: 'left' }}>
                                <Typography sx={systemLabel}>{TEST_META[id].label}</Typography>
                                <Typography sx={{ fontSize: 11, color: TEXT.faint, fontWeight: 500 }}>{thresholdHint(id, TEST_META[id].unit)}</Typography>
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
                                        <Box sx={{ width: 12, height: 12, borderRadius: 0.5, bgcolor: optionColor(r.code), flexShrink: 0 }} />
                                        <Box>
                                            <Typography sx={{ fontSize: 14, fontWeight: 800, color: TEXT.primary, lineHeight: 1.2 }}>{r.code}</Typography>
                                            <Typography sx={{ fontSize: 11, color: TEXT.faint }}>{r.name !== r.code ? r.name : r.side ? 'side bet' : 'main bet'}</Typography>
                                        </Box>
                                    </Box>
                                </Box>
                                <Box component="td" sx={{ ...cellSx, color: TEXT.secondary }}>{int(r.bets)}</Box>
                                <Box component="td" sx={{ ...cellSx, color: TEXT.primary }}>{plain(r.turnover)}</Box>
                                <Box component="td" sx={{ ...cellSx, fontWeight: 800, color: signColor(r.result) }}>{money(r.result)}</Box>
                                {TEST_IDS.map((id) => <TestCell key={id} id={id} r={r} />)}
                            </Box>
                        );
                    })}
                </tbody>
            </Box>
        </Box>
    );
}
```

---

### Task 5: Shoes × hands heatmap

**Files:** create `src/realtime/components/patron360/ShoeHeatmap.js`.

**Interfaces — Consumes:** `heatmapRows` output `[{view, stats}]`, `OPTION_BY_CODE`, `inWindow`, `useEChart(option, {click})`, `edgeBands`, `shoeLabel`. **Produces:** default `<ShoeHeatmap rows code selected:Set onSelect(key, additive) />`, named `<HeatLegend code />`.

- [ ] **Step 1: Create the file:**

```js
// Shoes × hands for one bet option — the centrepiece of the Player 360.
// Cell colour = that option's live house edge at the hand (magenta = the
// cards favour the player; dimmed = the patron was not seated). A dot =
// the patron bet the option there, sized by wager: filled = patron won,
// hollow = casino won. An advantage player reads as dots clustered on
// magenta. Click a row to select that shoe; Ctrl/Shift-click to add more.

import React, { useMemo } from 'react';
import { Box, Stack, Typography } from '@mui/material';
import { TEXT, ACCENT } from '../../constants/rtTheme';
import { OPTION_BY_CODE, inWindow } from '../../utils/patron360';
import useEChart from './useEChart';
import { edgeBands, money, pct, plain, shoeLabel } from './format';

const ROW_H = 22;
const AXIS_H = 30;

export function HeatLegend({ code }) {
    const opt = OPTION_BY_CODE.get(code) || { theo: 1 };
    return (
        <Stack direction="row" sx={{ flexWrap: 'wrap', alignItems: 'center', columnGap: 2, rowGap: 0.5 }}>
            {edgeBands(opt.theo).map((b) => (
                <Stack key={b.label} direction="row" spacing={0.75} sx={{ alignItems: 'center' }}>
                    <Box sx={{ width: 14, height: 12, borderRadius: 0.5, bgcolor: b.color, border: '1px solid rgba(255,255,255,0.14)' }} />
                    <Typography sx={{ fontSize: 12, color: TEXT.muted }}>{b.label}</Typography>
                </Stack>
            ))}
            <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center' }}>
                <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: '#fff' }} />
                <Typography sx={{ fontSize: 12, color: TEXT.muted }}>patron won</Typography>
                <Box sx={{ width: 10, height: 10, borderRadius: '50%', border: '1.5px solid #fff', ml: 1 }} />
                <Typography sx={{ fontSize: 12, color: TEXT.muted }}>casino won · dot size = wager · dimmed = not seated</Typography>
            </Stack>
        </Stack>
    );
}

export default function ShoeHeatmap({ rows, code, selected, onSelect }) {
    const theo = (OPTION_BY_CODE.get(code) || { theo: 1 }).theo;

    const option = useMemo(() => {
        const maxHand = Math.max(1, ...rows.map((r) => r.view.maxHand));
        const inside = [];
        const outside = [];
        const dots = [];
        let maxW = 1;
        rows.forEach(({ view }, y) => {
            const edgeAt = new Map();
            for (const h of view.hands) {
                const e = h.edge[code];
                if (e == null) continue;
                edgeAt.set(h.handNo, e);
                (inWindow(view, h.handNo) ? inside : outside).push([h.handNo - 1, y, e]);
            }
            for (const [handNo, m] of view.betsByHand) {
                const c = m.get(code);
                if (!c) continue;
                dots.push([handNo - 1, y, c.wager, -c.casinoWin, edgeAt.has(handNo) ? edgeAt.get(handNo) : null]);
                if (c.wager > maxW) maxW = c.wager;
            }
        });
        const keys = rows.map((r) => r.view.shoeKey);
        const byKey = new Map(rows.map((r) => [r.view.shoeKey, r]));
        return {
            backgroundColor: 'transparent',
            animation: false,
            grid: { left: 200, right: 12, top: 4, bottom: AXIS_H - 4 },
            tooltip: {
                trigger: 'item',
                backgroundColor: 'rgba(14,16,28,0.97)', borderColor: 'rgba(122,162,247,0.45)', textStyle: { color: '#fff', fontSize: 12 },
                formatter: (p) => {
                    const r = rows[p.value[1]];
                    if (!r) return '';
                    const head = `<b>${shoeLabel(r.view)}</b><br/>Hand #${p.value[0] + 1}`;
                    if (p.seriesType === 'scatter') {
                        const res = p.value[3];
                        return `${head} · ${code} bet ${plain(p.value[2])}<br/>${res > 0 ? 'patron won' : res < 0 ? 'casino won' : 'push'} ${money(res)} · edge ${pct(p.value[4], 2)}`;
                    }
                    return `${head} · ${code} edge ${pct(p.value[2], 2)}${p.seriesIndex === 1 ? '<br/><span style="opacity:.7">patron not seated</span>' : ''}`;
                },
            },
            xAxis: {
                type: 'category', data: Array.from({ length: maxHand }, (_, i) => i + 1),
                axisLabel: { color: TEXT.muted, fontSize: 11, interval: 4 },
                axisTick: { show: false }, axisLine: { show: false }, splitArea: { show: false },
            },
            yAxis: {
                type: 'category', data: keys, inverse: true, triggerEvent: true,
                axisTick: { show: false }, axisLine: { show: false },
                axisLabel: {
                    fontSize: 11,
                    formatter: (k) => {
                        const r = byKey.get(k);
                        const t = r ? shoeLabel(r.view) : k;
                        return selected.has(k) ? `{sel|▸ ${t}}` : `{n|${t}}`;
                    },
                    rich: { n: { color: TEXT.secondary, fontSize: 11 }, sel: { color: ACCENT, fontSize: 11, fontWeight: 800 } },
                },
            },
            visualMap: {
                type: 'piecewise', show: false, dimension: 2, seriesIndex: [0, 1],
                pieces: edgeBands(theo).map(({ gte, lt, color }) => ({
                    ...(gte != null ? { gte } : {}), ...(lt != null ? { lt } : {}), color,
                })),
            },
            series: [
                {
                    type: 'heatmap', data: inside,
                    itemStyle: { borderColor: 'rgba(13,14,24,0.9)', borderWidth: 1 },
                    emphasis: { itemStyle: { borderColor: '#fff', borderWidth: 1 } },
                },
                { type: 'heatmap', data: outside, itemStyle: { opacity: 0.2, borderColor: 'rgba(13,14,24,0.9)', borderWidth: 1 } },
                {
                    type: 'scatter', data: dots, z: 5, cursor: 'pointer',
                    symbolSize: (v) => 4 + 9 * Math.sqrt(v[2] / maxW),
                    itemStyle: { color: (p) => (p.value[3] > 0 ? '#ffffff' : 'rgba(0,0,0,0)'), borderColor: '#ffffff', borderWidth: 1.4 },
                },
            ],
        };
    }, [rows, code, theo, selected]);

    const ref = useEChart(option, {
        click: (p) => {
            const key = p.componentType === 'yAxis' ? p.value : (rows[p.value && p.value[1]] || {}).view?.shoeKey;
            if (!key) return;
            const ev = p.event && p.event.event;
            onSelect(key, !!(ev && (ev.ctrlKey || ev.metaKey || ev.shiftKey)));
        },
    });

    return (
        <Box sx={{ maxHeight: 560, overflowY: 'auto', scrollbarWidth: 'thin', pr: 0.5 }}>
            <Box
                ref={ref}
                role="img"
                aria-label={`Shoes by hand for ${code}: house edge per hand with the patron's bets`}
                sx={{ width: '100%', height: rows.length * ROW_H + AXIS_H }}
            />
        </Box>
    );
}
```

---

### Task 6: Edge curves and wager bars

**Files:** create `EdgeCurves.js`, `WagerBars.js` in `src/realtime/components/patron360/`.

**Interfaces — Consumes:** views, `OPTION_BY_CODE`, `useEChart`, format helpers. **Produces:** `<EdgeCurves views code />`, `<WagerBars view code />` (parent keys it by `shoeKey`).

- [ ] **Step 1: Create `EdgeCurves.js`:**

```js
// House edge of one bet option across the selected shoes, hand by hand —
// the reference chart, extended to several shoes at once. Markers sit on
// the hands where the patron bet the option: filled = patron won,
// hollow = casino won, size = wager. Dashed = theo; the tinted band under
// 0% is where the cards favoured the player.

import React, { useMemo } from 'react';
import { Box } from '@mui/material';
import { TEXT } from '../../constants/rtTheme';
import { OPTION_BY_CODE } from '../../utils/patron360';
import useEChart from './useEChart';
import { SHOE_COLORS, money, pct, plain, shoeLabel } from './format';

export default function EdgeCurves({ views, code }) {
    const option = useMemo(() => {
        const opt = OPTION_BY_CODE.get(code) || { theo: 0, name: code };
        const maxHand = Math.max(1, ...views.map((v) => v.maxHand));
        let yMin = 0;
        let yMax = opt.theo;
        let maxW = 1;
        const lines = views.map((v) => {
            const pts = v.hands.filter((h) => h.edge[code] != null).map((h) => [h.handNo, h.edge[code]]);
            const edgeAt = new Map(pts);
            const bets = [];
            for (const [handNo, m] of v.betsByHand) {
                const c = m.get(code);
                if (!c || !edgeAt.has(handNo)) continue;
                bets.push([handNo, edgeAt.get(handNo), c.wager, -c.casinoWin]);
                if (c.wager > maxW) maxW = c.wager;
            }
            for (const [, e] of pts) { if (e < yMin) yMin = e; if (e > yMax) yMax = e; }
            return { v, pts, bets, edgeAt };
        });
        const pad = Math.max(2, (yMax - yMin) * 0.08);
        const series = [];
        lines.forEach(({ v, pts, bets }, i) => {
            const color = SHOE_COLORS[i % SHOE_COLORS.length];
            const name = shoeLabel(v);
            series.push({ name, type: 'line', data: pts, smooth: 0.25, showSymbol: false, lineStyle: { color, width: 2 }, itemStyle: { color }, z: 2 });
            series.push({
                name, type: 'scatter', data: bets, z: 4,
                symbolSize: (d) => 6 + 10 * Math.sqrt(d[2] / maxW),
                itemStyle: { color: (p) => (p.value[3] > 0 ? color : '#0d0e18'), borderColor: color, borderWidth: 2 },
            });
        });
        series.push({
            name: '__guides', type: 'line', data: [], silent: true,
            markLine: {
                silent: true, symbol: 'none',
                data: [
                    { yAxis: opt.theo, lineStyle: { color: '#e6e6e6', type: 'dashed', width: 1.5 }, label: { formatter: `Theo ${pct(opt.theo)}`, color: TEXT.secondary, position: 'insideEndTop', fontSize: 11 } },
                    { yAxis: 0, lineStyle: { color: 'rgba(255,255,255,0.28)', type: 'solid', width: 1 }, label: { show: false } },
                ],
            },
            ...(yMin < 0 ? { markArea: { silent: true, itemStyle: { color: 'rgba(214,92,255,0.08)' }, data: [[{ yAxis: yMin - pad }, { yAxis: 0 }]] } } : {}),
        });
        return {
            backgroundColor: 'transparent',
            animation: false,
            grid: { left: 52, right: 16, top: 36, bottom: 30 },
            legend: {
                data: lines.map(({ v }) => shoeLabel(v)), type: 'scroll', top: 0, left: 0,
                itemWidth: 14, itemHeight: 8, textStyle: { color: TEXT.muted, fontSize: 12 }, pageTextStyle: { color: TEXT.muted },
            },
            tooltip: {
                trigger: 'axis', axisPointer: { type: 'line', snap: true },
                backgroundColor: 'rgba(14,16,28,0.97)', borderColor: 'rgba(122,162,247,0.45)', textStyle: { color: '#fff', fontSize: 12 },
                formatter: (ps) => {
                    if (!ps || !ps.length) return '';
                    const hand = Math.round(Number(ps[0].axisValue));
                    const rowsHtml = lines.map(({ v, edgeAt }, i) => {
                        if (!edgeAt.has(hand)) return '';
                        const m = v.betsByHand.get(hand);
                        const c = m && m.get(code);
                        const bet = c ? ` · bet ${plain(c.wager)} ${money(-c.casinoWin)}` : '';
                        return `<div><span style="color:${SHOE_COLORS[i % SHOE_COLORS.length]}">●</span> ${shoeLabel(v)}: ${pct(edgeAt.get(hand), 2)}${bet}</div>`;
                    }).join('');
                    return `<div style="font-weight:800;margin-bottom:3px">Hand #${hand}</div>${rowsHtml}`;
                },
            },
            xAxis: {
                type: 'value', min: 1, max: maxHand, minInterval: 1,
                axisLabel: { color: TEXT.muted, fontSize: 11 }, splitLine: { show: false },
                axisLine: { lineStyle: { color: 'rgba(255,255,255,0.15)' } },
            },
            yAxis: {
                type: 'value', min: Math.floor(yMin - pad), max: Math.ceil(yMax + pad),
                axisLabel: { color: TEXT.muted, fontSize: 11, formatter: (val) => `${val}%` },
                splitLine: { lineStyle: { color: 'rgba(255,255,255,0.06)' } },
            },
            series,
        };
    }, [views, code]);
    const ref = useEChart(option);
    return <Box ref={ref} role="img" aria-label={`House edge of ${code} by hand for the selected shoes`} sx={{ width: '100%', height: 340 }} />;
}
```

- [ ] **Step 2: Create `WagerBars.js`:**

```js
// Hand by hand wager for one shoe, stacked by bet option in the option
// colours. Chips hide and show options; the option under review has a
// white outline.

import React, { useMemo, useState } from 'react';
import { Box, ButtonBase } from '@mui/material';
import { PATRON_360 } from '../../constants/rtConfig';
import { TEXT, ACCENT } from '../../constants/rtTheme';
import useEChart from './useEChart';
import { money, optionColor, plain } from './format';

const rank = (c) => {
    const i = PATRON_360.BET_OPTIONS.findIndex((o) => o.code === c);
    return i === -1 ? 99 : i;
};

export default function WagerBars({ view, code }) {
    const codes = useMemo(() => [...new Set(view.bets.map((b) => b.betType))].sort((a, b) => rank(a) - rank(b)), [view]);
    const [hidden, setHidden] = useState(() => new Set());

    const option = useMemo(() => {
        const xs = Array.from({ length: Math.max(1, view.maxHand) }, (_, i) => i + 1);
        return {
            backgroundColor: 'transparent',
            animation: false,
            grid: { left: 60, right: 12, top: 12, bottom: 28 },
            tooltip: {
                trigger: 'axis', axisPointer: { type: 'shadow' },
                backgroundColor: 'rgba(14,16,28,0.97)', borderColor: 'rgba(122,162,247,0.45)', textStyle: { color: '#fff', fontSize: 12 },
                formatter: (ps) => {
                    const hand = Number(ps[0].axisValue);
                    const m = view.betsByHand.get(hand);
                    if (!m) return `Hand #${hand} · no bets`;
                    const lines = [...m].sort(([a], [b]) => rank(a) - rank(b))
                        .map(([c, x]) => `<div><span style="color:${optionColor(c)}">■</span> ${c} ${plain(x.wager)} · ${money(-x.casinoWin)}</div>`);
                    return `<div style="font-weight:800;margin-bottom:3px">Hand #${hand}</div>${lines.join('')}`;
                },
            },
            xAxis: {
                type: 'category', data: xs,
                axisLabel: { color: TEXT.muted, fontSize: 11 }, axisTick: { show: false },
                axisLine: { lineStyle: { color: 'rgba(255,255,255,0.15)' } },
            },
            yAxis: {
                type: 'value',
                axisLabel: { color: TEXT.muted, fontSize: 11, formatter: (v) => plain(v) },
                splitLine: { lineStyle: { color: 'rgba(255,255,255,0.06)', type: 'dashed' } },
            },
            series: codes.filter((c) => !hidden.has(c)).map((c) => ({
                name: c, type: 'bar', stack: 'w', barMaxWidth: 16,
                itemStyle: { color: optionColor(c) },
                data: xs.map((h) => {
                    const m = view.betsByHand.get(h);
                    const x = m && m.get(c);
                    return x ? x.wager : '-';
                }),
            })),
        };
    }, [view, codes, hidden]);
    const ref = useEChart(option);

    const toggle = (c) => setHidden((s) => {
        const n = new Set(s);
        if (n.has(c)) n.delete(c); else n.add(c);
        return n;
    });

    return (
        <Box>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.6, mb: 1 }}>
                {codes.map((c) => {
                    const off = hidden.has(c);
                    return (
                        <ButtonBase
                            key={c}
                            onClick={() => toggle(c)}
                            aria-pressed={!off}
                            aria-label={`${off ? 'Show' : 'Hide'} ${c}`}
                            sx={{
                                px: 1, py: 0.35, borderRadius: 0.75, fontSize: 12, fontWeight: 800, gap: 0.5,
                                bgcolor: off ? 'transparent' : optionColor(c), color: off ? TEXT.muted : '#0d0e18',
                                border: `1px solid ${c === code ? '#ffffff' : optionColor(c)}`,
                                '&.Mui-focusVisible': { outline: `2px solid ${ACCENT}`, outlineOffset: 2 },
                            }}
                        >
                            {c}{off ? ' +' : ' ×'}
                        </ButtonBase>
                    );
                })}
            </Box>
            <Box ref={ref} role="img" aria-label="Wager per hand stacked by bet option" sx={{ width: '100%', height: 300 }} />
        </Box>
    );
}
```

---

### Task 7: Overlay rewrite and clean-up

**Files:** rewrite `src/realtime/components/patron360/RtPatron360.js`; delete `EvidencePanel.js`, `NormalCompare.js`, `ShoeGrid.js`, `HandStrip.js`, `BetEdgeScatter.js`, `YtdTrend.js`, `BetTypeTable.js`.

**Interfaces — Consumes:** everything above; `CARD_TIERS` (`src/live/constants/winPalette`). **Produces:** default `<RtPatron360 open patronId patronRow onClose />` (unchanged props).

- [ ] **Step 1: Replace `RtPatron360.js`:**

```js
// Player 360 — side-bet advantage review.
// =======================================
// Spec: docs/superpowers/specs/2026-09-26-patron-360-side-bet-design.md
//
// Full-screen overlay. The verdict and one row of evidence per bet option
// first; then every shoe the patron played in the range as a shoes × hands
// heatmap for the option under review; then the selected shoes' house-edge
// curves, hand-by-hand wagers and (for one shoe) the trend board. Both
// feeds are fetched per opening and per range change — never polled.

import React, { forwardRef, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    Box, Button, ButtonBase, Checkbox, Dialog, FormControlLabel, ListItemText, MenuItem, Select,
    Skeleton, Slide, Stack, Switch, ToggleButton, ToggleButtonGroup, Typography, useMediaQuery,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import { CARD_TIERS } from '../../../live/constants/winPalette';
import { PATRON_360 } from '../../constants/rtConfig';
import { fetchPatronBets, fetchPatronShoeEdges } from '../../utils/rtDataSource';
import { RANGES, OPTION_BY_CODE, buildPatron360, heatmapRows, rangeFor } from '../../utils/patron360';
import { SURFACE, TEXT, STATE, ACCENT, systemLabel } from '../../constants/rtTheme';
import ShoeRoads, { GOLD } from '../ShoeRoads';
import AdvantageTable from './AdvantageTable';
import OptionChips from './OptionChips';
import ShoeHeatmap, { HeatLegend } from './ShoeHeatmap';
import EdgeCurves from './EdgeCurves';
import WagerBars from './WagerBars';
import { LEVEL_COLOR, SHOE_COLORS, shoeLabel } from './format';

const SlideUp = forwardRef(function SlideUp(props, ref) {
    return <Slide direction="up" ref={ref} {...props} />;
});

const panelSx = { borderRadius: 2, border: `1px solid ${SURFACE.panelBorder}`, bgcolor: SURFACE.panel, p: 1.75, minWidth: 0 };
const raisedSx = { ...panelSx, border: `1px solid ${SURFACE.raisedBorder}`, bgcolor: SURFACE.raised };
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

const duration = (m) => (m == null || !Number.isFinite(Number(m)) ? '—'
    : Number(m) < 60 ? `${Math.round(m)}m` : `${Math.floor(m / 60)}h ${String(Math.round(m % 60)).padStart(2, '0')}m`);

function Section({ title, sub, right, raised, children }) {
    return (
        <Box component="section" sx={raised ? raisedSx : panelSx}>
            <Stack direction="row" sx={{ alignItems: 'center', columnGap: 1.5, rowGap: 0.75, mb: 1.25, flexWrap: 'wrap' }}>
                <Typography component="h3" sx={{ fontSize: 15, fontWeight: 800, color: TEXT.primary }}>{title}</Typography>
                {sub ? <Typography sx={{ fontSize: 12, color: TEXT.faint }}>{sub}</Typography> : null}
                <Box sx={{ flex: 1 }} />
                {right}
            </Stack>
            {children}
        </Box>
    );
}

// The one bold element: the assessment set like a case-file stamp.
function VerdictStamp({ verdict }) {
    const c = verdict ? LEVEL_COLOR[verdict.level] : TEXT.muted;
    return (
        <Stack direction="row" spacing={2} role="status" sx={{ alignItems: 'center' }}
            aria-label={verdict ? `Assessment ${verdict.level}. ${verdict.reason}` : 'Assessment loading'}>
            <Box sx={{
                px: 1.75, py: 0.4, color: c, border: `2px solid ${c}`, outline: `1px solid ${c}`, outlineOffset: 3,
                borderRadius: 1, transform: 'rotate(-2deg)', fontSize: 26, fontWeight: 900, letterSpacing: 3, lineHeight: 1.15, whiteSpace: 'nowrap',
            }}>
                {verdict ? verdict.level : '· · ·'}
            </Box>
            <Box sx={{ maxWidth: 360 }}>
                <Typography sx={systemLabel}>Assessment</Typography>
                <Typography sx={{ fontSize: 13, fontWeight: 600, color: TEXT.secondary, lineHeight: 1.35 }}>
                    {verdict ? verdict.reason : 'Loading…'}
                </Typography>
            </Box>
        </Stack>
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
            <Typography sx={{ fontSize: 12, color: TEXT.faint }}>to</Typography>
            <Box component="input" type="date" aria-label="To date" value={range.to} min={range.from}
                onChange={(e) => e.target.value && onCustom({ from: range.from, to: e.target.value })} sx={dateInputSx} />
        </Stack>
    );
}

function Header({ patronId, patronRow, verdict, source, rangeBar, onClose }) {
    const p = patronRow || {};
    const tier = CARD_TIERS[p.card_type] || CARD_TIERS.BASE;
    return (
        <Box sx={{ position: 'sticky', top: 0, zIndex: 3, bgcolor: 'rgba(13,14,24,0.94)', backdropFilter: 'blur(8px)', borderBottom: `1px solid ${SURFACE.panelBorder}` }}>
            <Stack direction="row" sx={{ alignItems: 'center', columnGap: 2.5, rowGap: 1.25, flexWrap: 'wrap', px: { xs: 1.5, md: 2.5 }, py: 1.5, maxWidth: 2000, mx: 'auto', boxSizing: 'border-box' }}>
                <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', minWidth: 0 }}>
                    <Box sx={{ width: 52, height: 52, borderRadius: '50%', display: 'grid', placeItems: 'center', flexShrink: 0, bgcolor: `${tier.accent}26`, border: `1.5px solid ${tier.accent}`, color: tier.accent, fontWeight: 800, fontSize: 15 }}>
                        {String(patronId).slice(-2)}
                    </Box>
                    <Box sx={{ minWidth: 0 }}>
                        <Typography sx={systemLabel}>Player 360 · side-bet review</Typography>
                        <Typography id="p360-title" component="h2" sx={{ fontSize: 26, fontWeight: 800, color: TEXT.primary, lineHeight: 1.1 }}>{patronId}</Typography>
                        <Typography sx={{ fontSize: 12, color: TEXT.faint }}>
                            <Box component="span" sx={{ color: tier.accent, fontWeight: 700 }}>{tier.label}</Box>
                            {` · ${p.segment || '—'} · ${p.current_table_key ? `seat ${p.current_seat ?? '—'} at ${p.current_table_key}` : 'not seated'} · on floor ${duration(p.sign_in_mins_ago)}`}
                        </Typography>
                    </Box>
                </Stack>
                {rangeBar}
                {source ? (
                    <Box sx={{ px: 1.1, py: 0.5, borderRadius: 1, border: `1px solid ${source.live ? STATE.positiveBorder : 'rgba(255,255,255,0.14)'}`, bgcolor: source.live ? STATE.positiveBg : 'rgba(255,255,255,0.04)' }}>
                        <Typography sx={{ fontSize: 12, fontWeight: 700, color: TEXT.secondary, fontVariantNumeric: 'tabular-nums' }}>
                            {source.live ? 'LIVE' : 'MOCK'} · {source.bets.toLocaleString()} bets · {source.shoes.toLocaleString()} shoes
                        </Typography>
                    </Box>
                ) : null}
                <Box sx={{ flex: 1 }} />
                <VerdictStamp verdict={verdict} />
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
        <Stack spacing={1.5} aria-busy="true" aria-label="Loading bets">
            <Skeleton variant="rectangular" height={230} sx={skeletonSx} />
            <Skeleton variant="rectangular" height={420} sx={skeletonSx} />
            <Skeleton variant="rectangular" height={380} sx={skeletonSx} />
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

function ShoePicker({ rows, selected, onChange }) {
    return (
        <Select
            multiple
            size="small"
            value={selected}
            onChange={(e) => onChange(typeof e.target.value === 'string' ? e.target.value.split(',') : e.target.value)}
            displayEmpty
            renderValue={(v) => (v.length ? `${v.length} shoe${v.length === 1 ? '' : 's'} selected` : 'Pick shoes…')}
            inputProps={{ 'aria-label': 'Selected shoes' }}
            MenuProps={{ slotProps: { paper: { sx: { maxHeight: 420, bgcolor: '#1b1e30', color: TEXT.primary } } } }}
            sx={{ minWidth: 220, height: 34, color: TEXT.primary, fontSize: 13, fontWeight: 700, '& .MuiOutlinedInput-notchedOutline': { borderColor: 'rgba(122,162,247,0.4)' }, '& .MuiSvgIcon-root': { color: TEXT.muted } }}
        >
            {rows.map(({ view, stats }) => (
                <MenuItem key={view.shoeKey} value={view.shoeKey} dense>
                    <Checkbox size="small" checked={selected.includes(view.shoeKey)} sx={{ color: TEXT.muted, p: 0.5, mr: 1 }} />
                    <ListItemText
                        primary={shoeLabel(view)}
                        secondary={`${stats.bets} bets · ${stats.negHandsBet} on −edge hands`}
                        slotProps={{ primary: { sx: { fontSize: 13 } }, secondary: { sx: { fontSize: 11, color: TEXT.faint } } }}
                    />
                </MenuItem>
            ))}
        </Select>
    );
}

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
    const [sort, setSort] = useState('suspicious');
    const [onlyBet, setOnlyBet] = useState(true);
    const [showAll, setShowAll] = useState(false);
    const [selected, setSelected] = useState([]);
    const [focusKey, setFocusKey] = useState(null);
    useEffect(() => {
        setOptionPick(null); setRangeId(PATRON_360.DEFAULT_RANGE); setCustom(null); setSelected([]);
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

    const turnoverByCode = useMemo(() => new Map((model ? model.evidence : []).map((r) => [r.code, r.turnover])), [model]);
    const roadMarks = useMemo(() => {
        if (!focused) return { any: new Set(), opt: new Set() };
        const opt = new Set();
        for (const [h, m] of focused.betsByHand) if (m.has(code)) opt.add(h);
        return { any: new Set(focused.betsByHand.keys()), opt };
    }, [focused, code]);

    const optName = code ? (OPTION_BY_CODE.get(code) || { name: code }).name : '';

    let body;
    if (!ready) {
        body = <Loading />;
    } else if (data.error) {
        body = (
            <Message
                title={`Couldn't load ${patronId}'s history`}
                body={`A Player 360 feed didn't answer (${data.error}). Check the backend or the REACT_APP_RT_PATRON_* URLs, then retry.`}
                action={<Button variant="outlined" onClick={() => setAttempt((n) => n + 1)} sx={{ color: ACCENT, borderColor: ACCENT, textTransform: 'none', fontWeight: 700 }}>Retry</Button>}
            />
        );
    } else if (!model) {
        body = <Message title={`No bets for ${patronId} between ${range.from} and ${range.to}`} body="Try a wider date range." />;
    } else {
        body = (
            <Stack spacing={1.5}>
                <Section title="Advantage evidence" sub="One row per bet option they used · click a row to review it below" raised>
                    <AdvantageTable rows={model.evidence} selected={code} onSelect={setOptionPick} />
                </Section>

                <Section
                    title={`Shoes × hands · ${optName}`}
                    sub={`${rows.length} shoe${rows.length === 1 ? '' : 's'} · click a row to select it · Ctrl/Shift-click to add more`}
                    right={(
                        <>
                            <FormControlLabel
                                control={<Switch size="small" checked={onlyBet} onChange={(e) => setOnlyBet(e.target.checked)} />}
                                label={`Only shoes with ${code} bets`}
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
                        <OptionChips value={code} onChange={setOptionPick} turnoverByCode={turnoverByCode} />
                        <HeatLegend code={code} />
                        {rows.length ? (
                            <ShoeHeatmap rows={shown} code={code} selected={selectedSet} onSelect={onSelectShoe} />
                        ) : (
                            <Typography sx={{ fontSize: 13, color: TEXT.faint, py: 2 }}>No shoes with {code} bets in this range.</Typography>
                        )}
                        {rows.length > shown.length ? (
                            <Button onClick={() => setShowAll(true)} sx={{ alignSelf: 'flex-start', textTransform: 'none', color: ACCENT, fontWeight: 700 }}>
                                Show all {rows.length} shoes
                            </Button>
                        ) : null}
                    </Stack>
                </Section>

                <Section
                    title={`Selected shoes · ${selectedViews.length}`}
                    sub="Compare the edge curves; one shoe also shows its trend board"
                    right={<ShoePicker rows={rows} selected={selected} onChange={onPick} />}
                    raised
                >
                    {focused ? (
                        <Stack spacing={2}>
                            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: '1fr 1fr' }, gap: 2, alignItems: 'start' }}>
                                <Box sx={{ minWidth: 0 }}>
                                    <Typography sx={{ ...systemLabel, mb: 0.5 }}>House edge: {optName}</Typography>
                                    <EdgeCurves views={selectedViews} code={code} />
                                    <Typography sx={{ fontSize: 11, color: TEXT.faint }}>
                                        Filled marker = patron won · hollow = casino won · size = wager · dashed = theo
                                    </Typography>
                                </Box>
                                <Box sx={{ minWidth: 0 }}>
                                    <Stack direction="row" sx={{ alignItems: 'center', flexWrap: 'wrap', gap: 0.75, mb: 0.5 }}>
                                        <Typography sx={systemLabel}>Hand by hand wager</Typography>
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
                                    <Stack direction="row" sx={{ alignItems: 'baseline', flexWrap: 'wrap', columnGap: 2, mb: 0.75 }}>
                                        <Typography sx={systemLabel}>Trend board · {shoeLabel(focused)}</Typography>
                                        <Typography sx={{ fontSize: 12, color: TEXT.faint }}>
                                            <Box component="span" sx={{ color: GOLD, fontWeight: 800 }}>◯</Box> patron bet this hand ·{' '}
                                            <Box component="span" sx={{ color: '#ffffff', fontWeight: 800 }}>◯</Box> patron bet {code}
                                        </Typography>
                                    </Stack>
                                    {focused.hands.length ? (
                                        <ShoeRoads hands={focused.hands} markedHands={roadMarks.any} emphasisHands={roadMarks.opt} emphasisColor="#ffffff" />
                                    ) : (
                                        <Typography sx={{ fontSize: 13, color: TEXT.faint }}>No hand results for this shoe.</Typography>
                                    )}
                                </Box>
                            ) : null}
                        </Stack>
                    ) : (
                        <Typography sx={{ fontSize: 13, color: TEXT.faint, py: 2 }}>Select a shoe in the heatmap above.</Typography>
                    )}
                </Section>
            </Stack>
        );
    }

    const source = ready && !data.error && model ? { live: data.live, bets: model.bets.length, shoes: model.views.length } : null;

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
                verdict={model ? model.verdict : null}
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

- [ ] **Step 2: Delete** `EvidencePanel.js`, `NormalCompare.js`, `ShoeGrid.js`, `HandStrip.js`, `BetEdgeScatter.js`, `YtdTrend.js`, `BetTypeTable.js` in `src/realtime/components/patron360/`; grep `src` for each name → 0 matches.

- [ ] **Step 3: Run tests + ESLint** (`$env:ESLINT_USE_FLAT_CONFIG='false'; npx eslint --ext .js src/realtime`) — expect no errors.

---

### Task 8: Visual QA (frontend-design + ui-ux-pro-max)

- [ ] Open a mock counter patron (compute with `hashKey('bets|'+id) % 8 === 0`) → ACTION, top heatmap rows show white dots on magenta, SL7-style curves dive below 0 with markers there.
- [ ] Open a normal patron → CLEAR/WATCH.
- [ ] Heatmap: click row → one shoe; Ctrl-click → multi (curves overlay, wager tabs); single shoe → trend board with gold/white rings.
- [ ] Option switch via chips and via evidence rows; sort toggle; only-bet switch; Show all.
- [ ] Range: Today / 7 days / YTD / custom dates refetch.
- [ ] 1680 / 1280 / 800 widths: no page-level horizontal scroll; Esc closes.
- [ ] Fix, re-run tests, reset viewport.
