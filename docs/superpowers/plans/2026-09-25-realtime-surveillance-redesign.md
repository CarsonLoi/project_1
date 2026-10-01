# Real-time Surveillance Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild `/realtime` into a surveillance console: floor map + rankings on top, a linked shoe board (roads + hand-by-hand bets) and patron panel below.

**Architecture:** A new hand-level feed (`/realtime/shoe`) is normalised by pure helpers in `utils/shoeData.js`. New focused components (`RtFloorMap`, `RtShoeBoard`, `RtPatronPanel`) replace the page's map and bottom rows; existing rankings/alerts/tiles are resized and rewired. Trend Seeker's road renderer is reused via named exports.

**Tech Stack:** React 19, MUI v9, ECharts 6, Jest via `react-scripts test`.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-09-25-realtime-surveillance-redesign-design.md`.
- Scatter tuple slots 0–64 are never renumbered; new slots are appended (65 hands today, 66 config gametype).
- Casino perspective everywhere in data; the UI flips sign only where it labels a value as the patron's.
- Game filter fixed to `['BA', 'NC']`; Area/Pit/Game/Table Min dropdowns hidden behind `SHOW_SLICERS = false`, not deleted.
- New text colours come from `constants/rtTheme.js` (≥ 4.5:1 verified); no new raw rgba text literals below 0.58 opacity.
- MUI v9 `Stack` does not accept `alignItems`/`justifyContent` props (they leak to the DOM). Put them in `sx`.
- No git commits: the user has not asked for commits in this session. Each task ends with a test run instead.
- Test command: `CI=true npx react-scripts test --watchAll=false src/realtime`

---

### Task 1: Export Trend Seeker's road primitives

**Files:**
- Modify: `src/trend/components/BaccaratBoard.jsx` (add `export` to existing declarations)
- Test: `src/realtime/utils/__tests__/roads.test.js`

**Interfaces:**
- Produces: named exports `buildBigRoad(hands, rows)`, `buildDerivedRoad(hands, k, rows)`, `computeStats(hands)`, `BigRoadCell`, `DerivedDotCell`, `CockroachCell`, `BeadPlateCell`, `RoadGrid`, `chunkBeadPlate(hands, rows)`, `BANKER`, `PLAYER`, `TIE`. `hands` items: `{ result: 'B'|'P'|'T', bankerPair?: bool, playerPair?: bool }`.

- [ ] **Step 1: Write the failing test**

```js
// src/realtime/utils/__tests__/roads.test.js
import { buildBigRoad, computeStats, chunkBeadPlate } from '../../../trend/components/BaccaratBoard';

test('big road stacks a streak and starts a new column on a change', () => {
    const hands = ['B', 'B', 'P', 'T', 'P', 'B'].map((result) => ({ result }));
    const road = buildBigRoad(hands, 6);
    expect(road[0][0].result).toBe('B');
    expect(road[0][1].result).toBe('B');
    expect(road[1][0].result).toBe('P');
    expect(road[1][0].ties).toBe(1);
    expect(road[1][1].result).toBe('P');
    expect(road[2][0].result).toBe('B');
});

test('stats and bead plate chunking', () => {
    const hands = ['B', 'P', 'T', 'B', 'B', 'P', 'P'].map((result) => ({ result }));
    expect(computeStats(hands)).toMatchObject({ game: 7, B: 3, P: 3, T: 1 });
    const bead = chunkBeadPlate(hands, 6);
    expect(bead).toHaveLength(2);
    expect(bead[1][0].result).toBe('P');
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `CI=true npx react-scripts test --watchAll=false src/realtime/utils/__tests__/roads.test.js`
Expected: FAIL — `buildBigRoad is not a function` (not exported).

- [ ] **Step 3: Add the exports**

In `BaccaratBoard.jsx`, prefix each of these existing declarations with `export ` (no other change):
`function buildBigRoad`, `function buildDerivedRoad`, `function computeStats`, `const BANKER`, `const PLAYER`, `const TIE`, `function BigRoadCell`, `function DerivedDotCell`, `function CockroachCell`, `function BeadPlateCell`, `function RoadGrid`, `function chunkBeadPlate`.

- [ ] **Step 4: Run to verify it passes**

Run the Step 2 command. Expected: 2 passed.

---

### Task 2: Shoe data helpers

**Files:**
- Create: `src/realtime/utils/shoeData.js`
- Test: `src/realtime/utils/__tests__/shoeData.test.js`

**Interfaces:**
- Produces:
  - `settleBet(betType, wager, hand) → number` (casino perspective)
  - `groupShoeRows(rows) → { tableId, gametype, shoeId, dealer, hands: Hand[] }`, `Hand = { handNo, gameId, time, result, bankerPair, playerPair, dealer, bets: Bet[], wager, casinoNet }`, `Bet = { playerId, seat, betType, wager, casinoWin }`
  - `patronBetsInShoe(shoe, playerId) → Array<{ handNo, result } & Bet>`
  - `shoeTotals(shoe) → { hands, wager, casinoNet, bets, counts: { B, P, T } }`
  - `generateMockShoe({ tableId, gametype, shoeId, handCount, seated, dealer, startMs, handMs }) → wire rows`
  - `hashKey(string) → uint32`

- [ ] **Step 1: Write the failing tests**

```js
// src/realtime/utils/__tests__/shoeData.test.js
import { groupShoeRows, generateMockShoe, settleBet, patronBetsInShoe, shoeTotals } from '../shoeData';

describe('settleBet', () => {
    test('banker win costs the house 0.95', () => expect(settleBet('BANKER', 1000, { result: 'B' })).toBeCloseTo(-950));
    test('player bet loses on banker', () => expect(settleBet('PLAYER', 1000, { result: 'B' })).toBe(1000));
    test('main bets push on a tie', () => {
        expect(settleBet('BANKER', 1000, { result: 'T' })).toBe(0);
        expect(settleBet('PLAYER', 1000, { result: 'T' })).toBe(0);
    });
    test('tie bet pays 8:1', () => expect(settleBet('TIE', 100, { result: 'T' })).toBe(-800));
});

describe('groupShoeRows', () => {
    const rows = [
        { shoe_id: 'S1', table_id: '10065', gametype: 'BA', game_id: 'g2', hand_no: 2, result: 'P', player_id: 'A', seat: 3, bet_type: 'PLAYER', wager: 500, casino_win: -500, dealer: 'Lee' },
        { shoe_id: 'S1', table_id: '10065', gametype: 'BA', game_id: 'g1', hand_no: 1, result: 'B', player_id: null, wager: 0, casino_win: 0, dealer: 'Lee' },
        { shoe_id: 'S1', table_id: '10065', gametype: 'BA', game_id: 'g2', hand_no: 2, result: 'P', player_id: 'B', seat: 5, bet_type: 'BANKER', wager: 300, casino_win: 300, dealer: 'Lee' },
    ];
    test('groups by hand, sorted, keeping empty hands', () => {
        const shoe = groupShoeRows(rows);
        expect(shoe.shoeId).toBe('S1');
        expect(shoe.dealer).toBe('Lee');
        expect(shoe.hands.map((h) => h.handNo)).toEqual([1, 2]);
        expect(shoe.hands[0].bets).toEqual([]);
        expect(shoe.hands[1].bets).toHaveLength(2);
        expect(shoe.hands[1].wager).toBe(800);
        expect(shoe.hands[1].casinoNet).toBe(-200);
    });
    test('patron bets and totals', () => {
        const shoe = groupShoeRows(rows);
        expect(patronBetsInShoe(shoe, 'A')).toEqual([
            { handNo: 2, result: 'P', playerId: 'A', seat: 3, betType: 'PLAYER', wager: 500, casinoWin: -500 },
        ]);
        expect(shoeTotals(shoe)).toMatchObject({ hands: 2, wager: 800, casinoNet: -200, bets: 2, counts: { B: 1, P: 1, T: 0 } });
    });
});

describe('generateMockShoe', () => {
    const args = {
        tableId: '10065', gametype: 'BA', shoeId: 'BA10065-S4', handCount: 40,
        seated: [{ playerId: 'PID-1', seat: 2, avgBet: 1000 }, { playerId: 'PID-2', seat: 6, avgBet: 5000 }],
        dealer: 'Lee', startMs: 0,
    };
    test('deterministic for the same seed', () => expect(generateMockShoe(args)).toEqual(generateMockShoe(args)));
    test('every hand 1..N is present', () => {
        const shoe = groupShoeRows(generateMockShoe(args));
        expect(shoe.hands.map((h) => h.handNo)).toEqual(Array.from({ length: 40 }, (_, i) => i + 1));
    });
    test('every bet is settled against its hand', () => {
        for (const r of generateMockShoe(args)) {
            if (!r.player_id) continue;
            const hand = { result: r.result, bankerPair: !!r.banker_pair, playerPair: !!r.player_pair };
            expect(r.casino_win).toBeCloseTo(settleBet(r.bet_type, r.wager, hand));
        }
    });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `CI=true npx react-scripts test --watchAll=false src/realtime/utils/__tests__/shoeData.test.js`
Expected: FAIL — cannot find module `../shoeData`.

- [ ] **Step 3: Implement `shoeData.js`**

```js
// Hand-level shoe data — pure helpers.
// ====================================
// No React, no fetching: the shoe board, the patron panel and the mock
// all go through these, and they are unit tested.
//
// Wire shape (docs/realtime-surveillance-data-contract.md §7): one row
// per bet in a shoe, plus one row with player_id null for any hand
// nobody bet on. groupShoeRows() turns that into one object per hand.

// Casino-perspective result of one bet (positive = the house won it).
// Main bets push on a tie; banker pays 0.95:1 (5% commission).
export function settleBet(betType, wager, hand) {
    const w = Number(wager) || 0;
    const r = hand && hand.result;
    switch (betType) {
        case 'BANKER': return r === 'T' ? 0 : r === 'B' ? -w * 0.95 : w;
        case 'PLAYER': return r === 'T' ? 0 : r === 'P' ? -w : w;
        case 'TIE': return r === 'T' ? -w * 8 : w;
        case 'BANKER_PAIR': return hand && hand.bankerPair ? -w * 11 : w;
        case 'PLAYER_PAIR': return hand && hand.playerPair ? -w * 11 : w;
        default: return 0;
    }
}

const flag = (v) => v === true || Number(v) === 1;

export function groupShoeRows(rows) {
    const byHand = new Map();
    let tableId = null, gametype = null, shoeId = null;
    for (const r of rows || []) {
        const handNo = Number(r.hand_no);
        if (!Number.isFinite(handNo)) continue;
        if (tableId == null && r.table_id != null) tableId = String(r.table_id);
        if (gametype == null && r.gametype) gametype = r.gametype;
        if (shoeId == null && r.shoe_id != null) shoeId = String(r.shoe_id);
        let h = byHand.get(handNo);
        if (!h) {
            h = {
                handNo,
                gameId: r.game_id ?? null,
                time: r.game_time ?? null,
                result: r.result || null,
                bankerPair: flag(r.banker_pair),
                playerPair: flag(r.player_pair),
                dealer: r.dealer ?? null,
                bets: [],
                wager: 0,
                casinoNet: 0,
            };
            byHand.set(handNo, h);
        }
        const wager = Number(r.wager) || 0;
        // Empty-hand rows (player_id null, wager 0) keep the hand but add no bet.
        if (r.player_id != null && r.player_id !== '' && wager > 0) {
            const casinoWin = Number(r.casino_win) || 0;
            h.bets.push({
                playerId: String(r.player_id),
                seat: r.seat == null ? null : Number(r.seat),
                betType: r.bet_type || '',
                wager,
                casinoWin,
            });
            h.wager += wager;
            h.casinoNet += casinoWin;
        }
    }
    const hands = [...byHand.values()].sort((a, b) => a.handNo - b.handNo);
    const last = hands[hands.length - 1];
    return { tableId, gametype, shoeId, dealer: last ? last.dealer : null, hands };
}

export function patronBetsInShoe(shoe, playerId) {
    if (!shoe || !playerId) return [];
    const out = [];
    for (const h of shoe.hands) {
        for (const b of h.bets) if (b.playerId === playerId) out.push({ handNo: h.handNo, result: h.result, ...b });
    }
    return out;
}

export function shoeTotals(shoe) {
    let wager = 0, casinoNet = 0, bets = 0;
    const counts = { B: 0, P: 0, T: 0 };
    const hands = (shoe && shoe.hands) || [];
    for (const h of hands) {
        wager += h.wager;
        casinoNet += h.casinoNet;
        bets += h.bets.length;
        if (counts[h.result] != null) counts[h.result] += 1;
    }
    return { hands: hands.length, wager, casinoNet, bets, counts };
}

// ── Mock generation ────────────────────────────────────────────────
// Deterministic per (table, shoe) so polling doesn't reshuffle history.
export function hashKey(s) {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
}
function mulberry32(seed) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6D2B79F5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

// 8-deck baccarat outcome odds and the rough pair frequency.
const P_BANKER = 0.4586;
const P_PLAYER = 0.4462;
const P_PAIR = 0.0747;

export function generateMockShoe({ tableId, gametype, shoeId, handCount, seated = [], dealer = null, startMs = 0, handMs = 55000 }) {
    const rand = mulberry32(hashKey(`${gametype}|${tableId}|${shoeId}`));
    const rows = [];
    for (let n = 1; n <= handCount; n++) {
        const u = rand();
        const result = u < P_BANKER ? 'B' : u < P_BANKER + P_PLAYER ? 'P' : 'T';
        const bankerPair = rand() < P_PAIR;
        const playerPair = rand() < P_PAIR;
        const hand = { result, bankerPair, playerPair };
        const base = {
            table_id: String(tableId), gametype, shoe_id: shoeId, game_id: `${shoeId}-H${n}`,
            hand_no: n, game_time: new Date(startMs + (n - 1) * handMs).toISOString(),
            result, banker_pair: bankerPair ? 1 : 0, player_pair: playerPair ? 1 : 0, dealer,
        };
        const bets = [];
        for (const s of seated) {
            if (rand() < 0.2) continue;                         // sits out ~1 hand in 5
            const main = rand() < 0.55 ? 'BANKER' : 'PLAYER';
            const wager = Math.max(100, Math.round((s.avgBet * (0.5 + rand())) / 100) * 100);
            bets.push({ player_id: s.playerId, seat: s.seat, bet_type: main, wager });
            if (rand() < 0.12) {
                const side = rand() < 0.5 ? 'TIE' : rand() < 0.5 ? 'BANKER_PAIR' : 'PLAYER_PAIR';
                bets.push({ player_id: s.playerId, seat: s.seat, bet_type: side, wager: Math.max(100, Math.round((wager * 0.1) / 100) * 100) });
            }
        }
        if (!bets.length) rows.push({ ...base, player_id: null, seat: null, bet_type: null, wager: 0, casino_win: 0 });
        for (const b of bets) rows.push({ ...base, ...b, casino_win: settleBet(b.bet_type, b.wager, hand) });
    }
    return rows;
}
```

- [ ] **Step 4: Run to verify they pass**

Run the Step 2 command. Expected: all pass.

---

### Task 3: Shoe feed in the data layer + contract §7

**Files:**
- Modify: `src/realtime/constants/rtConfig.js` (RT_ENDPOINTS, SHOE_BOARD, FIXED_GAMES)
- Modify: `src/realtime/utils/rtDataSource.js` (mock shoes, `fetchShoe`)
- Modify: `docs/realtime-surveillance-data-contract.md` (new §7, summary row)
- Test: `src/realtime/utils/__tests__/rtDataSource.test.js`

**Interfaces:**
- Consumes: `generateMockShoe`, `hashKey`, `groupShoeRows` (Task 2).
- Produces: `fetchShoe({ gametype, table, shoeId? }) → Promise<{ rows, live, error }>`. On a configured endpoint failure it returns `rows: []` with `error` (never mock rows — fake hands for a real table would mislead). `FIXED_GAMES`, `SHOE_BOARD.BIG_HAND_LOSS` in rtConfig.

- [ ] **Step 1: Write the failing test**

```js
// src/realtime/utils/__tests__/rtDataSource.test.js
import { fetchTables, fetchShoe } from '../rtDataSource';
import { groupShoeRows } from '../shoeData';

test('mock shoe matches its table row (hand # and shoe win)', async () => {
    const { rows: tables } = await fetchTables();
    const t = tables.find((r) => r.is_open && (r.gametype === 'BA' || r.gametype === 'NC'));
    expect(t).toBeDefined();
    const { rows } = await fetchShoe({ gametype: t.gametype, table: t.table });
    const shoe = groupShoeRows(rows);
    expect(shoe.hands.length).toBe(t.shoe_hands_dealt);
    expect(Math.round(shoe.hands.reduce((a, h) => a + h.casinoNet, 0))).toBe(Math.round(t.shoe_win));
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `CI=true npx react-scripts test --watchAll=false src/realtime/utils/__tests__/rtDataSource.test.js`
Expected: FAIL — `fetchShoe is not a function`.

- [ ] **Step 3: rtConfig additions**

In `RT_ENDPOINTS` add after `patronDetail`:

```js
    // Hand-level feed for ONE table's current shoe (§7 of the contract).
    shoe: process.env.REACT_APP_RT_SHOE_URL || sibling('/shoe'),
```

After `RANKING_ROWS` add:

```js
// ── Surveillance redesign ─────────────────────────────────────────────
// Area / Pit / Game / Table Min dropdowns are hidden, not deleted: flip
// SHOW_SLICERS to bring them back. Game is still applied while hidden,
// fixed to the two baccarat codes surveillance watches.
export const SHOW_SLICERS = false;
export const FIXED_GAMES = ['BA', 'NC'];

// Shoe board thresholds.
export const SHOE_BOARD = {
    // A hand whose house result is at or below this gets a red edge in
    // the hand list.
    BIG_HAND_LOSS: -20000,
};
```

- [ ] **Step 4: rtDataSource changes**

Add to the imports:

```js
import { RT_ENDPOINTS, RT_FETCH_TIMEOUT_MS, GAMING_DAY_START_HOUR, FIXED_GAMES } from '../constants/rtConfig';
import { generateMockShoe, hashKey } from './shoeData';
```

(replace the existing `rtConfig` import line with the first line above).

In `buildMock()`, immediately before the `// ── Bet mix ──` block, insert:

```js
    // ── Current shoe per baccarat table (hand-level feed, §7) ─────────
    // Generated rather than derived: the live fixture has about one
    // round per shoe per patron, far too sparse for a road. Seeded by
    // table + shoe so it is stable across polls. The generated shoe is
    // written back onto the table row so the map's hand # and shoe win
    // match the board exactly.
    const dealerNames = [...new Set(rounds.map((r) => r.dealer))].sort();
    const seatedByTable = new Map();
    for (const p of patrons) {
        if (!p.current_table_key || !p.current_seat) continue;
        let list = seatedByTable.get(p.current_table_key);
        if (!list) { list = []; seatedByTable.set(p.current_table_key, list); }
        if (list.some((s) => s.seat === p.current_seat)) continue;       // one patron per seat
        list.push({ playerId: p.patron_id, seat: p.current_seat, avgBet: p.avg_bet || 1000 });
    }
    const shoes = new Map();
    for (const row of tables) {
        if (!row.is_open || !FIXED_GAMES.includes(row.gametype)) continue;
        const key = gametypeTableKey(row.gametype, row.table);
        const seed = hashKey(key);
        const handCount = 18 + (seed % 52);                              // 18..69 hands in
        const handMs = 55000;
        const shoeId = row.shoe_id || `${row.gametype}${row.table}-S1`;
        const shoeRows = generateMockShoe({
            tableId: row.table, gametype: row.gametype, shoeId, handCount,
            seated: seatedByTable.get(key) || [],
            dealer: dealerNames.length ? dealerNames[seed % dealerNames.length] : null,
            startMs: now - handCount * handMs, handMs,
        });
        shoes.set(key, shoeRows);
        let win = 0, turnover = 0;
        for (const r of shoeRows) { win += r.casino_win; turnover += r.wager; }
        Object.assign(row, {
            shoe_id: shoeId,
            shoe_hands_dealt: handCount,
            shoe_win: win,
            shoe_turnover: turnover,
            shoe_theo: turnover * edgeFor(row.gametype),
            shoe_start_time: shoeRows[0].game_time,
            last_hand_dealt_time: shoeRows[shoeRows.length - 1].game_time,
        });
    }
```

Change `_mock = { rounds, tables, patrons, betmix, dealers };` to:

```js
    _mock = { rounds, tables, patrons, betmix, dealers, shoes };
```

After `fetchPatronDetail`, add:

```js
// Hand-level rows for ONE table's current shoe (or `shoeId`). Fetched
// for the table shown in the shoe board only, on every poll tick.
//
// Unlike the polled feeds this never falls back to the mock when a real
// endpoint is configured and fails: fake hands for a real table would
// mislead an investigation. It returns no rows plus the error, and the
// board keeps showing the last good shoe.
export async function fetchShoe({ gametype, table, shoeId = null }) {
    const base = RT_ENDPOINTS.shoe;
    if (!base) {
        return { rows: buildMock().shoes.get(gametypeTableKey(gametype, table)) || [], live: false, error: null };
    }
    const qs = [`gametype=${encodeURIComponent(gametype)}`, `table_id=${encodeURIComponent(table)}`];
    if (shoeId) qs.push(`shoe_id=${encodeURIComponent(shoeId)}`);
    const url = `${base}${base.includes('?') ? '&' : '?'}${qs.join('&')}`;
    try {
        return { rows: await fetchJson(url), live: true, error: null };
    } catch (err) {
        // eslint-disable-next-line no-console
        console.warn('[RT] shoe feed failed:', err.message);
        return { rows: [], live: false, error: err.message };
    }
}
```

- [ ] **Step 5: Contract doc §7**

In `docs/realtime-surveillance-data-contract.md`, rename the existing `## 7. Resolved decisions` heading to `## 8. Resolved decisions`, then insert before it:

```markdown
## 7. `GET /realtime/shoe` — one table's shoe, hand by hand

`GET /realtime/shoe?gametype=BA&table_id=10065[&shoe_id=...]`

One row per bet in the table's current shoe (or the given `shoe_id`).
A hand nobody bet on still gets **one row** with `player_id` null and
`wager` 0, so the road has no gaps. **15 columns.** Fetched for the one
table shown in the shoe board, refreshed on every poll tick.

| Column | Type | Notes |
|---|---|---|
| `table_id` | TEXT | |
| `gametype` | TEXT | `BA` / `NC` |
| `shoe_id` | TEXT | |
| `game_id` | TEXT | the hand |
| `hand_no` | INTEGER | 1-based position in the shoe; the latest is the "hand 50" number |
| `game_time` | TIMESTAMP | when the hand was dealt |
| `result` | TEXT | `B` / `P` / `T` |
| `banker_pair` | SMALLINT | optional 0/1, drawn on the road |
| `player_pair` | SMALLINT | optional 0/1, drawn on the road |
| `dealer` | TEXT | optional |
| `player_id` | TEXT | null on empty-hand rows |
| `seat` | INTEGER | 1–7 |
| `bet_type` | TEXT | `BANKER` / `PLAYER` / `TIE` / side-bet codes |
| `wager` | NUMERIC | |
| `casino_win` | NUMERIC | casino perspective |

Env var: `REACT_APP_RT_SHOE_URL` (default: sibling path `/shoe`). Unlike
the polled feeds, a failing shoe endpoint does **not** fall back to mock
data — the board shows the last good shoe and a warning instead.

---
```

In the Summary table add a row after `/realtime/patron/{id}`:

```markdown
| `/realtime/shoe` | ~150–400 | 15 | Selected table, every poll |
```

and change the header count line `**78 columns across 6 endpoints.**` to `**93 columns across 7 endpoints.**`.

- [ ] **Step 6: Run to verify it passes**

Run the Step 2 command. Expected: PASS.

---

### Task 4: KPI model — metric × scope, slots 65/66, ramp

**Files:**
- Modify: `src/realtime/constants/rtConfig.js`
- Modify: `src/realtime/vendor/dataProcessing.js`
- Modify: `src/realtime/vendor/heatmapConstants.js`
- Modify: `src/realtime/utils/realtimeData.js`
- Test: `src/realtime/utils/__tests__/kpiModel.test.js`

**Interfaces:**
- Produces: `RT_METRICS`, `RT_SCOPES`, `kpiKeyFor(metric, scope) → KPI key`; tuple slot 65 = hands today, 66 = config gametype; `threshold_dict['Hands Today']`.

- [ ] **Step 1: Write the failing test**

```js
// src/realtime/utils/__tests__/kpiModel.test.js
import { kpiKeyFor, RT_METRICS, RT_SCOPES, RT_KPI_DIMS, HOUSE_EDGE_OPTIONS } from '../../constants/rtConfig';
import { threshold_dict } from '../../vendor/heatmapConstants';
import { buildAvgScatterData } from '../../vendor/dataProcessing';

test('every metric × scope resolves to a key with a dim and a ramp', () => {
    for (const m of RT_METRICS) {
        for (const s of RT_SCOPES) {
            const key = kpiKeyFor(m.id, s.id);
            expect(threshold_dict[key]).toBeDefined();
            if (key === 'Actual House Edge') expect(HOUSE_EDGE_OPTIONS.length).toBeGreaterThan(0);
            else expect(RT_KPI_DIMS[key]).toBeDefined();
        }
    }
});

test('win and hand # switch keys by scope', () => {
    expect(kpiKeyFor('win', 'day')).toBe('Win (Total)');
    expect(kpiKeyFor('win', 'shoe')).toBe('Shoe Win');
    expect(kpiKeyFor('hands', 'day')).toBe('Hands Today');
    expect(kpiKeyFor('hands', 'shoe')).toBe('Shoe Hands');
    expect(kpiKeyFor('edge', 'shoe')).toBe('Actual House Edge');
});

test('tuple carries hands today at 65 and the config gametype at 66', () => {
    const config = [{ table: '10065', game: 'BA', x: 1, y: 1, rotation: 0, pit: '883', zone: 'Z1' }];
    const rows = [{ gametype: 'BA', table: '10065', pit: '883', area: 'Main', sub_segment: 'Main', hands: 42, is_open: true, openhours: 3, win: 1, theo: 1, turnover: 10, tablemin: '1000' }];
    const [t] = buildAvgScatterData(rows, config, 'Table', [], ['BA'], '', '');
    expect(t[65]).toBe(42);
    expect(t[66]).toBe('BA');
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `CI=true npx react-scripts test --watchAll=false src/realtime/utils/__tests__/kpiModel.test.js`
Expected: FAIL — `kpiKeyFor is not a function`.

- [ ] **Step 3: rtConfig**

In `RT_KPI_OPTIONS` add `'Hands Today'` after `'Shoe Hands'`. In `RT_KPI_DIMS` add after `'Avg Headcount (10m)': 64,`:

```js
    'Hands Today': 65,
```

Change `MAP_FRACTION = 7` → `MAP_FRACTION = 62` and `LEGEND_FRACTION = 3` → `LEGEND_FRACTION = 38` (update their comment to "62 / 38").

After `DEFAULT_KPI` add:

```js
// Map toolbar: three metrics × two scopes replace the old KPI dropdown.
export const RT_METRICS = [
    { id: 'win', label: 'Win' },
    { id: 'hands', label: 'Hand #' },
    { id: 'edge', label: 'House edge' },
];
export const RT_SCOPES = [
    { id: 'day', label: 'Today' },
    { id: 'shoe', label: 'Current shoe' },
];
// House edge only exists per shoe, so both scopes resolve to the same
// live value; the toolbar says so.
const KPI_BY_METRIC_SCOPE = {
    win: { day: 'Win (Total)', shoe: 'Shoe Win' },
    hands: { day: 'Hands Today', shoe: 'Shoe Hands' },
    edge: { day: 'Actual House Edge', shoe: 'Actual House Edge' },
};
export function kpiKeyFor(metric, scope) {
    const m = KPI_BY_METRIC_SCOPE[metric] || KPI_BY_METRIC_SCOPE.win;
    return scope === 'shoe' ? m.shoe : m.day;
}
```

- [ ] **Step 4: dataProcessing slots 65/66**

In `computeKpis` return object, after `avg_headcount_10m: ...,` add:

```js
    // Hands dealt today (slot 65) — the "Today" side of the Hand # KPI.
    hands_today:            d.floorday > 0 ? d.game_count : -1000000,
```

In `EMPTY_KPIS` after `avg_headcount_10m: -1000000,` add `hands_today: -1000000,`.

In the tuple, replace `kpis.avg_headcount_10m,                                                  // 64` with:

```js
      kpis.avg_headcount_10m,                                                  // 64
      kpis.hands_today,                                                        // 65
      // 66 — config gametype, ALWAYS set (d[3] is blanked for tables with
      // no data). Gives every drawn table a key for click and tooltip.
      row.game,                                                                // 66
```

- [ ] **Step 5: 'Hands Today' ramp**

In `heatmapConstants.js`, inside the surveillance block, after the `'Avg Headcount (10m)'` ramp add:

```js
    'Hands Today': [
        { gte: 600, lt: 100000, color: 'rgba(27 , 94 , 32)',    label: '600 up' },
        { gte: 400, lt:    600, color: 'rgba(67 , 160 , 71)',   label: '400 - 600' },
        { gte: 250, lt:    400, color: 'rgba(156 , 204 , 101)', label: '250 - 400' },
        { gte: 100, lt:    250, color: 'rgba(244 , 238 , 12)',  label: '100 - 250' },
        { gte:   1, lt:    100, color: 'rgba(97 , 135 , 255)',  label: '1 - 100' },
        { gte:   0, lt:      1, color: 'rgba(120 , 134 , 150)', label: 'none yet' },
    ],
```

- [ ] **Step 6: Legend support in realtimeData.js**

In `KPI_RATIO` add `'Hands Today': { num: 'hands', den: 'floorday' },`. In `formatKpiValueFor` change `if (selectedKPI === 'Shoe Hands')` to `if (selectedKPI === 'Shoe Hands' || selectedKPI === 'Hands Today')`.

- [ ] **Step 7: Run to verify it passes**

Run the Step 2 command. Expected: 3 passed.

---

### Task 5: `RtFloorMap` — map, tooltips, ring, overlay buttons

**Files:**
- Create: `src/realtime/components/RtFloorMap.js`

**Interfaces:**
- Consumes: tuple slots (0 x, 1 y, 2 rotation, 4 symbol path, 5/6 size, 16 label, 18 win, 32 pit, 33 table, 34 area, 50/51 lowest edge + bet, 52 shoe id, 57 shoe win, 61 shoe hands, 63 idle, 64 seated, 65 hands today, 66 gametype); `kpiKeyFor` output keys; `FIXED_GAMES`.
- Produces: `<RtFloorMap data kpiKey betOption axisBounds seatsByTable inspectedTableKey onTableClick />`; `seatsByTable: Map<'BA|10065', Array<{ seat, playerId, cardType, cumWin }>>`; export `tableKeyOf(tuple)`.

- [ ] **Step 1: Create the component**

```js
// Surveillance floor map.
// =======================
// Focused replacement for RtScatterHeatmap on this page: the floor, a
// colour ramp for ONE of three metrics, two tooltip styles, and a
// pulsing ring on the table being inspected below. No brush, no contour,
// no dimming: the whole floor stays readable while one table is open.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as echarts from 'echarts';
import { Box, ButtonBase, Stack, Tooltip, Typography } from '@mui/material';
import TuneIcon from '@mui/icons-material/Tune';
import EventSeatIcon from '@mui/icons-material/EventSeat';
import CloseIcon from '@mui/icons-material/Close';
import { threshold_dict } from '../vendor/heatmapConstants';
import { RT_KPI_DIMS, HOUSE_EDGE_OPTIONS, DEFAULT_HOUSE_EDGE_BET, SCATTER_GRID, FIXED_GAMES } from '../constants/rtConfig';
import { CARD_TIERS } from '../../live/constants/winPalette';
import { SEAT_TOOLTIP } from '../../live/constants/liveConfig';
import { ACCENT, STATE, TEXT } from '../constants/rtTheme';

const OUT_OF_RANGE = { color: '#3a3a3a', opacity: 0.35 };
const SIZE_MIN = 1;
const SIZE_MAX = 3;
const SIZE_DEFAULT = 2;
// Annulus: outer circle clockwise, inner counter-clockwise → a hole.
const RING_PATH = 'path://M50 0 A50 50 0 1 1 49.99 0 Z M50 14 A36 36 0 1 0 50.01 14 Z';

const isSentinel = (v) => v == null || v === -1000000 || v === -999999 || (typeof v === 'number' && !Number.isFinite(v));
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (v) => {
    if (isSentinel(v)) return '—';
    const a = Math.abs(v), s = v < 0 ? '-' : '';
    if (a >= 1e6) return `${s}$${(a / 1e6).toFixed(2)}M`;
    if (a >= 1e3) return `${s}$${(a / 1e3).toFixed(0)}K`;
    return `${s}$${Math.round(a)}`;
};
const int = (v) => (isSentinel(v) ? '—' : Math.round(v).toLocaleString());
const mins = (v) => (isSentinel(v) ? '—' : v < 90 ? `${Math.round(v)}m` : `${Math.floor(v / 60)}h ${String(Math.round(v % 60)).padStart(2, '0')}m`);
const signColor = (v) => (isSentinel(v) ? TEXT.faint : v < 0 ? STATE.negative : v > 0 ? STATE.positive : TEXT.primary);

export const tableKeyOf = (d) => `${d[66]}|${d[33]}`;
const isInteractive = (d) => Array.isArray(d) && FIXED_GAMES.includes(d[66]) && d[16] !== '';

function readStored(key, fallback, parse) {
    try { const v = localStorage.getItem(key); return v == null ? fallback : parse(v); } catch { return fallback; }
}
function writeStored(key, v) {
    try { localStorage.setItem(key, String(v)); } catch { /* storage unavailable (private mode) */ }
}

function edgeOption(betOption) {
    return HOUSE_EDGE_OPTIONS.find((o) => o.label === betOption)
        || HOUSE_EDGE_OPTIONS.find((o) => o.label === DEFAULT_HOUSE_EDGE_BET);
}
function dimFor(kpiKey, betOption) {
    return kpiKey === 'Actual House Edge' ? edgeOption(betOption).dim : RT_KPI_DIMS[kpiKey];
}

function statsTooltip(d, kpiKey, betOption) {
    const lowestBet = (HOUSE_EDGE_OPTIONS.find((o) => o.key === d[51]) || {}).label || d[51] || '';
    const sel = kpiKey === 'Actual House Edge' && betOption !== 'Lowest' ? edgeOption(betOption) : null;
    const edgeCol = (v) => (isSentinel(v) ? TEXT.faint : v < 0 ? STATE.negative : TEXT.primary);
    const row = (label, day, shoe) => `
      <tr>
        <td style="color:${TEXT.muted};padding:4px 16px 4px 0">${label}</td>
        <td style="text-align:right;padding:4px 14px;font-weight:700">${day}</td>
        <td style="text-align:right;padding:4px 0;font-weight:700">${shoe}</td>
      </tr>`;
    return `
    <div style="min-width:300px">
      <div style="display:flex;justify-content:space-between;align-items:baseline;gap:16px;border-bottom:1px solid rgba(255,255,255,0.12);padding-bottom:6px;margin-bottom:4px">
        <span style="font-size:17px;font-weight:800;color:${ACCENT}">${esc(tableKeyOf(d))}</span>
        <span style="font-size:12px;color:${TEXT.muted}">${esc(d[34] || '—')} · pit ${esc(d[32] || '—')}</span>
      </div>
      <table style="border-collapse:collapse;font-size:13px;width:100%;font-variant-numeric:tabular-nums">
        <tr>
          <td></td>
          <td style="text-align:right;padding:2px 14px;font-size:11px;letter-spacing:.06em;color:${TEXT.faint}">TODAY</td>
          <td style="text-align:right;padding:2px 0;font-size:11px;letter-spacing:.06em;color:${TEXT.faint}">SHOE</td>
        </tr>
        ${row('Win', `<span style="color:${signColor(d[18])}">${money(d[18])}</span>`, `<span style="color:${signColor(d[57])}">${money(d[57])}</span>`)}
        ${row('Hands', int(d[65]), isSentinel(d[61]) ? '—' : `#${int(d[61])}`)}
      </table>
      <div style="margin-top:6px;padding-top:6px;border-top:1px solid rgba(255,255,255,0.1);font-size:13px;display:flex;justify-content:space-between;gap:16px">
        <span style="color:${TEXT.muted}">House edge <span style="color:${TEXT.faint}">(current shoe)</span></span>
        <span style="font-weight:800;color:${edgeCol(d[50])}">${isSentinel(d[50]) ? '—' : `${d[50].toFixed(2)}% · ${esc(lowestBet)}`}</span>
      </div>
      ${sel ? `<div style="font-size:12px;display:flex;justify-content:space-between"><span style="color:${TEXT.muted}">${esc(sel.label)}</span><span style="font-weight:700;color:${edgeCol(d[sel.dim])}">${isSentinel(d[sel.dim]) ? '—' : `${d[sel.dim].toFixed(2)}%`}</span></div>` : ''}
      <div style="margin-top:6px;font-size:12px;color:${TEXT.faint}">Shoe ${esc(d[52] || '—')} · last hand ${mins(d[63])} ago · ${isSentinel(d[64]) ? '—' : d[64].toFixed(1)} seated</div>
      <div style="margin-top:4px;font-size:11px;color:${ACCENT}">Click to open this shoe below</div>
    </div>`;
}

function seatsTooltip(d, seats) {
    const { WIDTH: W, HEIGHT: H, SEAT_R: R, ARC_R, SEATS } = SEAT_TOOLTIP;
    const FONT = 9;
    const cx = W / 2, cy = H - 18;
    const bySeat = new Map((seats || []).map((s) => [s.seat, s]));
    let circles = '';
    for (let i = 0; i < SEATS; i++) {
        const angle = Math.PI - (Math.PI * (i + 0.5)) / SEATS;
        const x = cx + ARC_R * Math.cos(angle);
        const y = cy - ARC_R * Math.sin(angle);
        const occ = bySeat.get(i + 1);
        if (occ) {
            const tier = CARD_TIERS[occ.cardType] || CARD_TIERS.BASE;
            const res = -occ.cumWin;                                   // patron perspective
            circles += `
              <circle cx="${x}" cy="${y}" r="${R}" fill="${tier.accent}2e" stroke="${tier.accent}" stroke-width="1.6"/>
              <text x="${x}" y="${y - 3}" text-anchor="middle" fill="#eaf6ff" font-size="${FONT}" font-weight="700">S${i + 1}·${esc(String(occ.playerId).slice(-4))}</text>
              <text x="${x}" y="${y + 9}" text-anchor="middle" fill="${signColor(res)}" font-size="${FONT}" font-weight="700">${money(res)}</text>`;
        } else {
            circles += `
              <circle cx="${x}" cy="${y}" r="${R}" fill="rgba(255,255,255,0.02)" stroke="rgba(255,255,255,0.22)" stroke-dasharray="3 3" stroke-width="1"/>
              <text x="${x}" y="${y + 3}" text-anchor="middle" fill="${TEXT.disabled}" font-size="${FONT}">S${i + 1}</text>`;
        }
    }
    const occupied = (seats || []).length;
    return `
      <div style="display:flex;justify-content:space-between;align-items:baseline;gap:16px;margin-bottom:2px">
        <span style="font-size:15px;font-weight:800;color:${ACCENT}">${esc(tableKeyOf(d))}</span>
        <span style="font-size:13px;font-weight:800;color:${signColor(d[57])}">shoe ${money(d[57])}</span>
      </div>
      <div style="color:${TEXT.faint};font-size:11px;margin-bottom:4px">hand #${int(d[61])} · ${occupied} seated · seat colour = card tier · value = patron's day</div>
      <svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
        <path d="M ${cx - ARC_R - R - 4},${cy} A ${ARC_R + R + 4},${ARC_R + R + 4} 0 0 1 ${cx + ARC_R + R + 4},${cy}"
              fill="rgba(122,162,247,0.04)" stroke="rgba(122,162,247,0.35)" stroke-width="1.5"/>
        <line x1="${cx - ARC_R - R - 4}" y1="${cy}" x2="${cx + ARC_R + R + 4}" y2="${cy}" stroke="rgba(122,162,247,0.35)" stroke-width="1.5"/>
        <text x="${cx}" y="${cy - 8}" text-anchor="middle" fill="${TEXT.faint}" font-size="9" letter-spacing="2">DEALER</text>
        ${circles}
      </svg>`;
}

function OverlayButton({ title, active, onClick, children }) {
    return (
        <Tooltip title={title} placement="left">
            <ButtonBase
                onClick={onClick}
                aria-label={title}
                aria-pressed={active}
                sx={{
                    width: 34, height: 34, borderRadius: 1.2,
                    bgcolor: active ? ACCENT : 'rgba(10,14,26,0.88)',
                    color: active ? '#0b1020' : TEXT.primary,
                    border: `1px solid ${active ? ACCENT : 'rgba(122,162,247,0.4)'}`,
                    backdropFilter: 'blur(6px)',
                    transition: 'background-color 150ms, border-color 150ms',
                    '&:hover': { borderColor: ACCENT },
                    '&.Mui-focusVisible': { outline: `2px solid ${ACCENT}`, outlineOffset: 2 },
                }}
            >
                {children}
            </ButtonBase>
        </Tooltip>
    );
}

export default function RtFloorMap({ data, kpiKey, betOption, axisBounds, seatsByTable, inspectedTableKey, onTableClick }) {
    const ref = useRef(null);
    const instRef = useRef(null);
    const clickRef = useRef(onTableClick);
    clickRef.current = onTableClick;

    const [scale, setScale] = useState(() => readStored('rt.symbolScale', SIZE_DEFAULT,
        (v) => Math.min(SIZE_MAX, Math.max(SIZE_MIN, Number(v) || SIZE_DEFAULT))));
    const [tooltipStyle, setTooltipStyle] = useState(() => readStored('rt.tooltipStyle', 'stats',
        (v) => (v === 'seats' ? 'seats' : 'stats')));
    const [sizeOpen, setSizeOpen] = useState(false);
    useEffect(() => writeStored('rt.symbolScale', scale), [scale]);
    useEffect(() => writeStored('rt.tooltipStyle', tooltipStyle), [tooltipStyle]);

    const reducedMotion = useMemo(() => {
        try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
    }, []);

    useEffect(() => {
        const el = ref.current;
        const inst = echarts.init(el);
        instRef.current = inst;
        inst.on('click', (p) => {
            if (p.seriesIndex !== 0 || !isInteractive(p.value)) return;
            if (clickRef.current) clickRef.current(tableKeyOf(p.value));
        });
        const ro = new ResizeObserver(() => inst.resize());
        ro.observe(el);
        return () => { ro.disconnect(); inst.dispose(); instRef.current = null; };
    }, []);

    useEffect(() => {
        const inst = instRef.current;
        if (!inst) return;
        const dim = dimFor(kpiKey, betOption);
        const ramp = threshold_dict[kpiKey];
        const ring = inspectedTableKey ? data.filter((d) => tableKeyOf(d) === inspectedTableKey) : [];
        inst.setOption({
            backgroundColor: 'transparent',
            animation: false,
            grid: SCATTER_GRID,
            xAxis: { type: 'value', show: false, min: axisBounds?.xMin, max: axisBounds?.xMax },
            yAxis: { type: 'value', show: false, min: axisBounds?.yMin, max: axisBounds?.yMax },
            tooltip: {
                trigger: 'item',
                confine: true,
                backgroundColor: 'rgba(14,16,28,0.97)',
                borderColor: 'rgba(122,162,247,0.45)',
                borderWidth: 1,
                padding: [10, 14],
                textStyle: { color: '#fff', fontSize: 13 },
                formatter: (p) => {
                    const d = p && p.value;
                    if (p.seriesIndex !== 0 || !isInteractive(d)) return '';
                    return tooltipStyle === 'seats'
                        ? seatsTooltip(d, seatsByTable && seatsByTable.get(tableKeyOf(d)))
                        : statsTooltip(d, kpiKey, betOption);
                },
            },
            visualMap: ramp ? {
                type: 'piecewise',
                seriesIndex: 0,
                dimension: dim,
                pieces: ramp.map((t) => ({ gte: t.gte, lt: t.lt, color: t.color, label: t.label })),
                left: 16, bottom: 16, orient: 'vertical',
                itemWidth: 14, itemHeight: 14, itemGap: 8,
                textStyle: { color: TEXT.secondary, fontSize: 12 },
                hoverLink: false,
                outOfRange: OUT_OF_RANGE,
            } : undefined,
            series: [
                {
                    name: 'Tables',
                    type: 'scatter',
                    data,
                    symbol: (v) => (typeof v[4] === 'string' && v[4].startsWith('path://') ? v[4] : 'circle'),
                    symbolSize: (v) => [v[5] * scale, v[6] * scale],
                    symbolRotate: (v) => v[2],
                    itemStyle: { opacity: 0.92 },
                    emphasis: { itemStyle: { borderColor: '#fff', borderWidth: 1.5 } },
                    cursor: 'pointer',
                },
                {
                    name: 'Inspected',
                    type: reducedMotion ? 'scatter' : 'effectScatter',
                    data: ring,
                    symbol: RING_PATH,
                    symbolSize: (v) => Math.max(v[5], v[6]) * scale * 1.5,
                    rippleEffect: { brushType: 'stroke', scale: 2, period: 2.6 },
                    itemStyle: { color: ACCENT },
                    silent: true,
                    z: 5,
                    tooltip: { show: false },
                },
            ],
        }, { notMerge: true });
    }, [data, kpiKey, betOption, axisBounds, tooltipStyle, seatsByTable, inspectedTableKey, scale, reducedMotion]);

    return (
        <Box sx={{ position: 'relative', width: '100%', height: '100%' }}>
            <div ref={ref} style={{ width: '100%', height: '100%' }} />
            <Stack spacing={0.75} sx={{ position: 'absolute', top: 10, right: 10, zIndex: 6 }}>
                <OverlayButton title="Symbol size" active={sizeOpen} onClick={() => setSizeOpen((v) => !v)}>
                    <TuneIcon sx={{ fontSize: 18 }} />
                </OverlayButton>
                <OverlayButton
                    title={tooltipStyle === 'seats' ? 'Tooltip: seat map (click for stats)' : 'Tooltip: stats (click for seat map)'}
                    active={tooltipStyle === 'seats'}
                    onClick={() => setTooltipStyle((v) => (v === 'seats' ? 'stats' : 'seats'))}
                >
                    <EventSeatIcon sx={{ fontSize: 18 }} />
                </OverlayButton>
            </Stack>
            {sizeOpen && (
                <Box sx={{
                    position: 'absolute', top: 10, right: 54, zIndex: 7, width: 230, p: 1.25, borderRadius: 1.5,
                    bgcolor: 'rgba(14,16,28,0.97)', border: '1px solid rgba(122,162,247,0.4)',
                    boxShadow: '0 8px 24px rgba(0,0,0,0.45)',
                }}>
                    <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', mb: 0.75 }}>
                        <Typography sx={{ fontSize: 12, fontWeight: 800, letterSpacing: 0.5, textTransform: 'uppercase', color: TEXT.secondary }}>
                            Symbol size
                        </Typography>
                        <ButtonBase aria-label="Close symbol size" onClick={() => setSizeOpen(false)} sx={{ color: TEXT.muted, borderRadius: 1, p: 0.25 }}>
                            <CloseIcon sx={{ fontSize: 16 }} />
                        </ButtonBase>
                    </Stack>
                    <Box
                        component="input" type="range" min={SIZE_MIN} max={SIZE_MAX} step={0.1} value={scale}
                        aria-label="Symbol size"
                        onChange={(e) => setScale(parseFloat(e.target.value))}
                        sx={{ width: '100%', accentColor: ACCENT, cursor: 'pointer' }}
                    />
                    <Typography sx={{ fontSize: 16, fontWeight: 800, color: ACCENT, fontVariantNumeric: 'tabular-nums' }}>
                        {scale.toFixed(1)}×
                    </Typography>
                </Box>
            )}
        </Box>
    );
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx eslint --no-eslintrc --parser-options=ecmaVersion:2022,sourceType:module,ecmaFeatures:{jsx:true} src/realtime/components/RtFloorMap.js`
Expected: no output (syntax OK). Runtime is verified in Task 9.

---

### Task 6: Rankings — fill the map's height, larger type, scope-aware

**Files:**
- Modify: `src/realtime/components/RtRankingList.js`
- Modify: `src/realtime/components/RtTabbedPanel.js`

**Interfaces:**
- Produces: `RtTabbedPanel` new prop `scope: 'day'|'shoe'`; the panel fills its parent's height (`height: 100%`) and scrolls its content internally.

- [ ] **Step 1: RtRankingList sizes and sx-only Stack props**

Change defaults `valueWidth = 74` → `valueWidth = 92` and `labelWidth = 96` → `labelWidth = 128`. Replace the row `<Stack direction="row" alignItems="center" spacing={0.8} ...` opening with `<Stack direction="row" spacing={1} ...` and add `alignItems: 'center',` as the first entry of its `sx`, and change `py: 0.5, px: 0.6` to `py: 0.8, px: 0.75`. In the label block change `fontSize: TYPE.label` → `fontSize: 14` and the sublabel `fontSize: TYPE.micro` → `fontSize: 12`. Change every bar `height: 8` → `height: 10` and the zero-axis `height: 12` → `height: 14`. Change the value `fontSize: 11.5` → `fontSize: 16` and `color: diverging ? color : '#dfe6ff'` → `color: diverging ? color : TEXT.primary`. Change the outer `<Stack spacing={0.35} sx={{ px: 0.4 }}>` → `<Stack spacing={0.4} sx={{ px: 0.25 }}>`. Change the empty-state `fontSize: TYPE.label` → `fontSize: 14`.

- [ ] **Step 2: RtTabbedPanel**

Add `scope = 'day',` to the props list after `alertCounts = {},`.

Replace the `tableRows` memo with:

```js
    // Tables ranked by win/loss, worst first — day or current shoe,
    // following the map's scope toggle.
    const tableRows = useMemo(() => {
        const field = scope === 'shoe' ? 'shoe_win' : 'win';
        const rows = tables
            .filter((t) => !isSentinel(Number(t[field])))
            .map((t) => {
                const key = `${t.gametype}|${t.table}`;
                return {
                    id: key,
                    label: key,
                    sublabel: scope === 'shoe'
                        ? `hand #${t.shoe_hands_dealt ?? '—'} · ${t.shoe_id || 'no shoe'}`
                        : `${t.area || '—'} · pit ${t.pit ?? '—'}`,
                    value: Number(t[field]) || 0,
                    tooltip: scope === 'shoe'
                        ? `${key} — shoe ${money(Number(t.shoe_win))}, theo ${money(Number(t.shoe_theo))}`
                        : `${key} — win ${money(Number(t.win))}, theo ${money(Number(t.theo))}, variance ${money((Number(t.win) || 0) - (Number(t.theo) || 0))}`,
                };
            })
            .sort((a, b) => a.value - b.value);
        return topBottom(rows, half);
    }, [tables, half, scope]);
```

Replace the outer `<Box sx={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>` with `<Box sx={{ display: 'flex', flexDirection: 'column', minWidth: 0, height: '100%' }}>`.

In the `Tabs` `sx`, change `minHeight: 34` (both occurrences) → `minHeight: 40`, `fontSize: 12` → `fontSize: 14`, `py: 0.5, px: 1.2` → `py: 0.75, px: 1.4`, `color: 'rgba(255,255,255,0.5)'` → `color: TEXT.muted`, `'#dfe6ff !important'` → `` `${TEXT.primary} !important` ``. In the tab label replace `<Stack direction="row" alignItems="center" spacing={0.5}>` with `<Stack direction="row" spacing={0.6} sx={{ alignItems: 'center' }}>` and the badge chip `height: 15, minWidth: 15, fontSize: 9.5` → `height: 18, minWidth: 18, fontSize: 11`.

Replace `<Box sx={{ pt: 1, minHeight: 220 }}>` with `<Box sx={{ pt: 1, flex: 1, minHeight: 0, overflowY: 'auto', scrollbarWidth: 'thin' }}>`.

In `Divider`, replace `<Stack direction="row" alignItems="center" spacing={1} sx={{ px: 1, py: 0.6 }}>` with `<Stack direction="row" spacing={1} sx={{ alignItems: 'center', px: 1, py: 0.75 }}>` and its label `fontSize: TYPE.micro` → `fontSize: 12`.

Change the Table W/L divider label to `dividerLabel={scope === 'shoe' ? 'biggest house wins this shoe below' : 'biggest house wins below'}`.

Replace the house-perspective footnote text with:

```jsx
                    House perspective — negative means the house is down · {activeTab === 'tables' ? (scope === 'shoe' ? 'current shoe' : 'today') : 'today'}
```

and change both footnotes' `fontSize: TYPE.micro` → `fontSize: 12`.

- [ ] **Step 3: Verify syntax**

Run: `npx eslint --no-eslintrc --parser-options=ecmaVersion:2022,sourceType:module,ecmaFeatures:{jsx:true} src/realtime/components/RtRankingList.js src/realtime/components/RtTabbedPanel.js`
Expected: no output.

---

### Task 7: `RtShoeBoard`

**Files:**
- Create: `src/realtime/components/RtShoeBoard.js`

**Interfaces:**
- Consumes: Task 1 exports; `shoeTotals` (Task 2); `SHOE_BOARD`, `HOUSE_EDGE_OPTIONS` (rtConfig).
- Produces: `<RtShoeBoard tableKey tableRow shoe loading error tableOptions onPickTable selectedHandNo onSelectHand selectedPatronId onSelectPatron seatedCount />`; `tableOptions: Array<{ key, alerting }>`; `onSelectHand(handNo | null)`.

- [ ] **Step 1: Create the component**

```js
// Shoe board — one table's current shoe, hand by hand.
// ===================================================
// Left half of the investigation workspace: "what happened at this
// table?". A per-hand house-result strip (when did it turn), the casino
// roads (how the shoe ran) and every hand's bets (who was on which side
// for how much). Roads reuse Trend Seeker's renderer so the board looks
// exactly like the one floor staff already read.

import React, { useEffect, useMemo, useRef } from 'react';
import * as echarts from 'echarts';
import { Box, ButtonBase, CircularProgress, Collapse, MenuItem, Select, Stack, Typography } from '@mui/material';
import {
    buildBigRoad, buildDerivedRoad, BigRoadCell, DerivedDotCell, CockroachCell,
    BeadPlateCell, RoadGrid, chunkBeadPlate, BANKER, PLAYER, TIE,
} from '../../trend/components/BaccaratBoard';
import { shoeTotals } from '../utils/shoeData';
import { SHOE_BOARD, HOUSE_EDGE_OPTIONS } from '../constants/rtConfig';
import { TEXT, STATE, ACCENT, systemLabel } from '../constants/rtTheme';

const GOLD = '#ffd479';
const EMPTY = [];
const RESULT = {
    B: { label: 'Banker', zh: '庄', color: BANKER },
    P: { label: 'Player', zh: '闲', color: PLAYER },
    T: { label: 'Tie', zh: '和', color: TIE },
};
const BET_LABEL = { BANKER: 'Banker', PLAYER: 'Player', TIE: 'Tie', BANKER_PAIR: 'B pair', PLAYER_PAIR: 'P pair' };

const signed = (v) => {
    if (v == null || !Number.isFinite(v)) return '—';
    const a = Math.abs(v), s = v < 0 ? '−' : v > 0 ? '+' : '';
    if (a >= 1e6) return `${s}$${(a / 1e6).toFixed(2)}M`;
    if (a >= 1e3) return `${s}$${(a / 1e3).toFixed(a >= 1e4 ? 0 : 1)}K`;
    return `${s}$${Math.round(a)}`;
};
const signColor = (v) => (v < 0 ? STATE.negative : v > 0 ? STATE.positive : TEXT.muted);

function lowestEdge(row) {
    if (!row) return null;
    let best = null;
    for (const k of Object.keys(row)) {
        if (!k.startsWith('house_edge_')) continue;
        const v = Number(row[k]);
        if (!Number.isFinite(v)) continue;
        if (!best || v < best.v) best = { v, key: k.slice('house_edge_'.length) };
    }
    if (!best) return null;
    const opt = HOUSE_EDGE_OPTIONS.find((o) => o.key === best.key);
    return { ...best, label: opt ? opt.label : best.key };
}

function Fact({ label, value, color = TEXT.primary, sub }) {
    return (
        <Box sx={{ px: 1.25, py: 0.75, borderRadius: 1.5, bgcolor: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', minWidth: 96 }}>
            <Typography sx={{ ...systemLabel, lineHeight: 1.3 }}>{label}</Typography>
            <Typography sx={{ fontSize: 18, fontWeight: 800, color, fontVariantNumeric: 'tabular-nums', lineHeight: 1.25, whiteSpace: 'nowrap' }}>
                {value}
            </Typography>
            {sub ? <Typography sx={{ fontSize: 11, color: TEXT.faint, whiteSpace: 'nowrap' }}>{sub}</Typography> : null}
        </Box>
    );
}

function ResultBadge({ hand }) {
    const r = RESULT[hand.result];
    if (!r) return <Box sx={{ width: 26, height: 26 }} />;
    return (
        <Box sx={{ position: 'relative', width: 26, height: 26, flexShrink: 0 }} title={r.label}>
            <Box sx={{ width: 26, height: 26, borderRadius: '50%', bgcolor: r.color, color: '#fff', display: 'grid', placeItems: 'center', fontSize: 13, fontWeight: 700 }}>
                {r.zh}
            </Box>
            {hand.bankerPair && <Box sx={{ position: 'absolute', top: -1, left: -1, width: 8, height: 8, borderRadius: '50%', bgcolor: BANKER, border: '1px solid #fff' }} />}
            {hand.playerPair && <Box sx={{ position: 'absolute', bottom: -1, right: -1, width: 8, height: 8, borderRadius: '50%', bgcolor: PLAYER, border: '1px solid #fff' }} />}
        </Box>
    );
}

function ShoePulse({ hands, selectedHandNo, patronHands, onSelectHand }) {
    const ref = useRef(null);
    const instRef = useRef(null);
    const cbRef = useRef(onSelectHand);
    cbRef.current = onSelectHand;

    useEffect(() => {
        const el = ref.current;
        const inst = echarts.init(el);
        instRef.current = inst;
        inst.on('click', (p) => {
            if (p.componentType === 'series' && p.seriesIndex === 0 && cbRef.current) cbRef.current(Number(p.name));
        });
        const ro = new ResizeObserver(() => inst.resize());
        ro.observe(el);
        return () => { ro.disconnect(); inst.dispose(); instRef.current = null; };
    }, []);

    useEffect(() => {
        const inst = instRef.current;
        if (!inst) return;
        let cum = 0;
        const running = hands.map((h) => (cum += h.casinoNet));
        inst.setOption({
            backgroundColor: 'transparent',
            animation: false,
            grid: { left: 58, right: 12, top: 10, bottom: 24 },
            tooltip: {
                trigger: 'axis',
                axisPointer: { type: 'shadow' },
                backgroundColor: 'rgba(14,16,28,0.97)',
                borderColor: 'rgba(122,162,247,0.45)',
                textStyle: { color: '#fff', fontSize: 12 },
                formatter: (ps) => {
                    const i = ps[0].dataIndex;
                    const h = hands[i];
                    const r = RESULT[h.result];
                    return `<b>Hand ${h.handNo}</b> · <span style="color:${r ? r.color : '#fff'}">${r ? r.label : '—'}</span>`
                        + `<br/>House ${signed(h.casinoNet)} · ${h.bets.length} bets · ${signed(h.wager).replace('+', '')} wagered`
                        + `<br/>Shoe so far ${signed(running[i])}`;
                },
            },
            xAxis: {
                type: 'category',
                data: hands.map((h) => String(h.handNo)),
                axisLabel: { color: TEXT.muted, fontSize: 10, interval: 'auto' },
                axisTick: { show: false },
                axisLine: { lineStyle: { color: 'rgba(255,255,255,0.15)' } },
            },
            yAxis: {
                type: 'value',
                axisLabel: { color: TEXT.muted, fontSize: 10, formatter: (v) => signed(v) },
                splitLine: { lineStyle: { color: 'rgba(255,255,255,0.06)' } },
            },
            series: [
                {
                    type: 'bar',
                    barMaxWidth: 12,
                    cursor: 'pointer',
                    data: hands.map((h) => {
                        const sel = h.handNo === selectedHandNo;
                        const mine = patronHands.has(h.handNo);
                        return {
                            value: h.casinoNet,
                            itemStyle: {
                                color: h.casinoNet < 0 ? STATE.negative : h.casinoNet > 0 ? STATE.positive : 'rgba(255,255,255,0.25)',
                                borderColor: sel ? '#fff' : mine ? GOLD : 'transparent',
                                borderWidth: sel || mine ? 2 : 0,
                            },
                        };
                    }),
                },
                { type: 'line', data: running, smooth: true, symbol: 'none', lineStyle: { color: '#7dcfff', width: 2 }, silent: true },
            ],
        }, { notMerge: true });
    }, [hands, selectedHandNo, patronHands]);

    return <div ref={ref} style={{ width: '100%', height: 170 }} />;
}

function RoadBlock({ label, children }) {
    return (
        <Box>
            <Typography sx={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.4, color: TEXT.muted, mb: 0.4 }}>{label}</Typography>
            <Box sx={{ borderRadius: 1, overflow: 'hidden', border: '1px solid rgba(255,255,255,0.12)' }}>{children}</Box>
        </Box>
    );
}

function Roads({ hands, selectedHandNo, onSelectHand, patronHands }) {
    const bigRoad = useMemo(() => buildBigRoad(hands, 6), [hands]);
    const bigEye = useMemo(() => buildDerivedRoad(hands, 1, 6), [hands]);
    const small = useMemo(() => buildDerivedRoad(hands, 2, 6), [hands]);
    const cockroach = useMemo(() => buildDerivedRoad(hands, 3, 6), [hands]);
    const bead = useMemo(() => chunkBeadPlate(hands, 6), [hands]);
    return (
        <Stack spacing={1.1}>
            <RoadBlock label="Big Road · 大路">
                <RoadGrid cols={bigRoad} rows={6} cellSize={24} minCols={Math.max(24, bigRoad.length + 2)}
                    render={(c, s) => <BigRoadCell cell={c} size={s} />} />
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
            <RoadBlock label="Bead plate · 珠盤路 — click a hand">
                <RoadGrid cols={bead} rows={6} cellSize={28} minCols={Math.max(12, bead.length)} fillWidth={false}
                    render={(h, s) => (h ? (
                        <ButtonBase
                            onClick={() => onSelectHand(h.handNo)}
                            aria-label={`Hand ${h.handNo}, ${RESULT[h.result] ? RESULT[h.result].label : 'unknown'}`}
                            sx={{
                                width: s, height: s, borderRadius: '50%', display: 'block',
                                outline: h.handNo === selectedHandNo ? `3px solid ${ACCENT}` : patronHands.has(h.handNo) ? `2px solid ${GOLD}` : 'none',
                                outlineOffset: -1,
                            }}
                        >
                            <BeadPlateCell hand={h} size={s} />
                        </ButtonBase>
                    ) : <BeadPlateCell hand={null} size={s} />)} />
            </RoadBlock>
        </Stack>
    );
}

function HandList({ hands, selectedHandNo, onSelectHand, selectedPatronId, onSelectPatron }) {
    const rows = useMemo(() => [...hands].reverse(), [hands]);
    const refs = useRef(new Map());
    useEffect(() => {
        const el = selectedHandNo != null ? refs.current.get(selectedHandNo) : null;
        if (el) el.scrollIntoView({ block: 'nearest' });
    }, [selectedHandNo]);

    return (
        <Box sx={{ overflowY: 'auto', maxHeight: 560, pr: 0.5, scrollbarWidth: 'thin' }}>
            {rows.map((h) => {
                const open = h.handNo === selectedHandNo;
                const big = h.casinoNet <= SHOE_BOARD.BIG_HAND_LOSS;
                const mine = selectedPatronId && h.bets.some((b) => b.playerId === selectedPatronId);
                return (
                    <Box
                        key={h.handNo}
                        ref={(el) => { if (el) refs.current.set(h.handNo, el); else refs.current.delete(h.handNo); }}
                        sx={{
                            mb: 0.5, borderRadius: 1,
                            borderLeft: `3px solid ${big ? STATE.negative : 'transparent'}`,
                            bgcolor: open ? 'rgba(122,162,247,0.12)' : 'rgba(255,255,255,0.025)',
                        }}
                    >
                        <ButtonBase
                            onClick={() => onSelectHand(open ? null : h.handNo)}
                            aria-expanded={open}
                            sx={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'flex-start', gap: 1.25, px: 1, py: 0.75, textAlign: 'left', borderRadius: 1 }}
                        >
                            <Typography sx={{ width: 40, fontSize: 14, fontWeight: 800, color: TEXT.primary, fontVariantNumeric: 'tabular-nums' }}>
                                #{h.handNo}
                            </Typography>
                            <ResultBadge hand={h} />
                            {mine ? <Box aria-label="selected patron bet" sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: GOLD, flexShrink: 0 }} /> : null}
                            <Typography sx={{ flex: 1, fontSize: 13, color: TEXT.muted, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                {h.bets.length ? `${h.bets.length} bet${h.bets.length === 1 ? '' : 's'} · ${signed(h.wager).replace('+', '')}` : 'no bets'}
                            </Typography>
                            <Typography sx={{ fontSize: 14, fontWeight: 800, color: signColor(h.casinoNet), fontVariantNumeric: 'tabular-nums' }}>
                                {h.bets.length ? signed(h.casinoNet) : ''}
                            </Typography>
                        </ButtonBase>
                        <Collapse in={open} unmountOnExit>
                            {h.bets.length ? (
                                <Box component="table" sx={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, mb: 1, '& td, & th': { px: 1, py: 0.5 } }}>
                                    <thead>
                                        <tr>
                                            {['Seat', 'Player', 'Bet', 'Wager', 'Player result'].map((c, i) => (
                                                <Box component="th" key={c} sx={{ ...systemLabel, textAlign: i >= 3 ? 'right' : 'left', fontWeight: 700 }}>{c}</Box>
                                            ))}
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {h.bets.map((b, i) => {
                                            const res = -b.casinoWin;          // player perspective
                                            const isSel = b.playerId === selectedPatronId;
                                            return (
                                                <tr key={i}>
                                                    <Box component="td" sx={{ color: TEXT.muted, fontVariantNumeric: 'tabular-nums' }}>{b.seat ?? '—'}</Box>
                                                    <Box component="td">
                                                        <ButtonBase
                                                            onClick={() => onSelectPatron(b.playerId)}
                                                            sx={{ fontSize: 13, fontWeight: 700, color: isSel ? GOLD : ACCENT, borderRadius: 0.5, px: 0.25, '&:hover': { textDecoration: 'underline' } }}
                                                        >
                                                            {b.playerId}
                                                        </ButtonBase>
                                                    </Box>
                                                    <Box component="td" sx={{ color: TEXT.secondary }}>{BET_LABEL[b.betType] || b.betType}</Box>
                                                    <Box component="td" sx={{ textAlign: 'right', color: TEXT.primary, fontVariantNumeric: 'tabular-nums' }}>{signed(b.wager).replace('+', '')}</Box>
                                                    <Box component="td" sx={{ textAlign: 'right', fontWeight: 800, color: signColor(res), fontVariantNumeric: 'tabular-nums' }}>{signed(res)}</Box>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </Box>
                            ) : (
                                <Typography sx={{ fontSize: 13, color: TEXT.faint, px: 1.25, pb: 1 }}>Nobody bet on this hand.</Typography>
                            )}
                        </Collapse>
                    </Box>
                );
            })}
        </Box>
    );
}

function Message({ title, body }) {
    return (
        <Stack spacing={0.75} sx={{ alignItems: 'center', justifyContent: 'center', py: 6, textAlign: 'center' }}>
            <Typography sx={{ fontSize: 15, fontWeight: 700, color: TEXT.muted }}>{title}</Typography>
            {body ? <Typography sx={{ fontSize: 13, color: TEXT.faint, maxWidth: 440 }}>{body}</Typography> : null}
        </Stack>
    );
}

export default function RtShoeBoard({
    tableKey, tableRow, shoe, loading, error,
    tableOptions = EMPTY, onPickTable,
    selectedHandNo, onSelectHand,
    selectedPatronId, onSelectPatron,
    seatedCount = 0,
}) {
    const hands = (shoe && shoe.hands) || EMPTY;
    const totals = useMemo(() => shoeTotals(shoe), [shoe]);
    const patronHands = useMemo(() => {
        const s = new Set();
        if (selectedPatronId) for (const h of hands) if (h.bets.some((b) => b.playerId === selectedPatronId)) s.add(h.handNo);
        return s;
    }, [hands, selectedPatronId]);

    if (!tableKey) {
        return <Message title="Pick a table on the map" body="Click a table on the floor map, a ranking row or an alert to open its current shoe." />;
    }

    const edge = lowestEdge(tableRow);
    const theo = Number(tableRow && tableRow.shoe_theo);
    const last = hands[hands.length - 1];

    return (
        <Stack spacing={1.5}>
            <Stack direction="row" spacing={1} sx={{ alignItems: 'stretch', flexWrap: 'wrap', rowGap: 1 }}>
                <Box sx={{ pr: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                    <Typography sx={systemLabel}>Shoe board</Typography>
                    <Typography sx={{ fontSize: 24, fontWeight: 800, color: TEXT.primary, lineHeight: 1.15 }}>{tableKey}</Typography>
                    <Typography sx={{ fontSize: 12, color: TEXT.faint }}>{(tableRow && tableRow.area) || '—'} · pit {(tableRow && tableRow.pit) ?? '—'}</Typography>
                </Box>
                <Fact label="Hand" value={last ? `#${last.handNo}` : '—'} sub={(shoe && shoe.shoeId) || (tableRow && tableRow.shoe_id) || ''} />
                <Fact label="Dealer" value={(shoe && shoe.dealer) || '—'} sub={`${totals.counts.B}B · ${totals.counts.P}P · ${totals.counts.T}T`} />
                <Fact label="House edge" value={edge ? `${edge.v.toFixed(2)}%` : '—'} color={edge && edge.v < 0 ? STATE.negative : TEXT.primary} sub={edge ? `lowest · ${edge.label}` : 'no live edge'} />
                <Fact label="Shoe result" value={signed(totals.casinoNet)} color={signColor(totals.casinoNet)} sub={Number.isFinite(theo) ? `theo ${signed(theo)}` : 'house perspective'} />
                <Fact label="Seated" value={String(seatedCount)} sub={`${totals.bets} bets this shoe`} />
                <Box sx={{ flex: 1 }} />
                <Box sx={{ display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                    <Typography sx={{ ...systemLabel, mb: 0.4 }}>Table</Typography>
                    <Select
                        size="small"
                        value={tableKey}
                        onChange={(e) => onPickTable(e.target.value)}
                        inputProps={{ 'aria-label': 'Pick a table' }}
                        MenuProps={{ PaperProps: { sx: { maxHeight: 420, bgcolor: '#20233a', color: TEXT.primary } } }}
                        sx={{ minWidth: 160, color: TEXT.primary, fontWeight: 700, '& .MuiOutlinedInput-notchedOutline': { borderColor: 'rgba(122,162,247,0.4)' } }}
                    >
                        {tableOptions.map((o) => (
                            <MenuItem key={o.key} value={o.key} sx={{ gap: 1 }}>
                                <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: o.alerting ? STATE.negative : 'transparent', border: o.alerting ? 'none' : '1px solid rgba(255,255,255,0.25)' }} />
                                {o.key}
                            </MenuItem>
                        ))}
                    </Select>
                </Box>
            </Stack>

            {error ? (
                <Typography sx={{ fontSize: 13, color: STATE.warning }}>
                    {hands.length ? `Showing the last loaded shoe — refresh failed: ${error}` : `Couldn't load this shoe — retrying on the next refresh (${error}).`}
                </Typography>
            ) : null}

            {loading && !hands.length ? (
                <Stack sx={{ alignItems: 'center', py: 6 }}><CircularProgress size={26} sx={{ color: ACCENT }} /></Stack>
            ) : !hands.length ? (
                <Message title="New shoe — no hands dealt yet" />
            ) : (
                <>
                    <Box>
                        <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', mb: 0.5, gap: 1 }}>
                            <Typography sx={systemLabel}>House result by hand</Typography>
                            <Typography sx={{ fontSize: 12, color: TEXT.faint }}>
                                bars = each hand (red = house lost) · line = shoe so far · click a bar to open the hand{selectedPatronId ? ' · gold = selected patron bet' : ''}
                            </Typography>
                        </Stack>
                        <ShoePulse hands={hands} selectedHandNo={selectedHandNo} patronHands={patronHands} onSelectHand={onSelectHand} />
                    </Box>
                    <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', xl: '56fr 44fr' }, gap: 2, alignItems: 'start' }}>
                        <Roads hands={hands} selectedHandNo={selectedHandNo} onSelectHand={onSelectHand} patronHands={patronHands} />
                        <Box sx={{ minWidth: 0 }}>
                            <Typography sx={{ ...systemLabel, mb: 0.5 }}>Hands · newest first · click to see bets</Typography>
                            <HandList hands={hands} selectedHandNo={selectedHandNo} onSelectHand={onSelectHand}
                                selectedPatronId={selectedPatronId} onSelectPatron={onSelectPatron} />
                        </Box>
                    </Box>
                </>
            )}
        </Stack>
    );
}
```

- [ ] **Step 2: Verify syntax**

Run: `npx eslint --no-eslintrc --parser-options=ecmaVersion:2022,sourceType:module,ecmaFeatures:{jsx:true} src/realtime/components/RtShoeBoard.js`
Expected: no output.

---

### Task 8: `RtPatronPanel`

**Files:**
- Create: `src/realtime/components/RtPatronPanel.js`

**Interfaces:**
- Consumes: `patronBetsInShoe` (Task 2); `CARD_TIERS`; road colours (Task 1).
- Produces: `<RtPatronPanel patronId patronRow shoe tableKey trailRows trailLoading onPickTable onToggleFull fullOpen onClear />`; `trailRows` are `/realtime/patron/{id}` rows (contract §6).

- [ ] **Step 1: Create the component**

```js
// Patron panel — right half of the investigation workspace.
// ========================================================
// "Who is this player?" in one column: their day, their bets in the shoe
// on the left, and the tables and shoes they visited. The full Player
// 360 workspace stays one click away rather than always open.

import React, { useMemo } from 'react';
import { Box, ButtonBase, CircularProgress, Stack, Typography } from '@mui/material';
import PersonSearchIcon from '@mui/icons-material/PersonSearch';
import CloseIcon from '@mui/icons-material/Close';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import { CARD_TIERS } from '../../live/constants/winPalette';
import { BANKER, PLAYER, TIE } from '../../trend/components/BaccaratBoard';
import { patronBetsInShoe } from '../utils/shoeData';
import { TEXT, STATE, ACCENT, systemLabel } from '../constants/rtTheme';

const SIDE = { BANKER: { t: 'B', c: BANKER }, PLAYER: { t: 'P', c: PLAYER }, TIE: { t: 'T', c: TIE }, BANKER_PAIR: { t: 'BP', c: BANKER }, PLAYER_PAIR: { t: 'PP', c: PLAYER } };

const signed = (v) => {
    if (v == null || !Number.isFinite(v)) return '—';
    const a = Math.abs(v), s = v < 0 ? '−' : v > 0 ? '+' : '';
    if (a >= 1e6) return `${s}$${(a / 1e6).toFixed(2)}M`;
    if (a >= 1e3) return `${s}$${(a / 1e3).toFixed(a >= 1e4 ? 0 : 1)}K`;
    return `${s}$${Math.round(a)}`;
};
const plain = (v) => signed(v).replace('+', '');
const signColor = (v) => (v < 0 ? STATE.negative : v > 0 ? STATE.positive : TEXT.muted);
const duration = (m) => (m == null || !Number.isFinite(Number(m)) ? '—' : Number(m) < 60 ? `${Math.round(m)}m` : `${Math.floor(m / 60)}h ${String(Math.round(m % 60)).padStart(2, '0')}m`);

function Tile({ label, value, color = TEXT.primary, sub }) {
    return (
        <Box sx={{ px: 1.25, py: 1, borderRadius: 1.5, bgcolor: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', minWidth: 0 }}>
            <Typography sx={{ ...systemLabel, lineHeight: 1.3 }}>{label}</Typography>
            <Typography sx={{ fontSize: 20, fontWeight: 800, color, fontVariantNumeric: 'tabular-nums', lineHeight: 1.25, whiteSpace: 'nowrap' }}>{value}</Typography>
            {sub ? <Typography sx={{ fontSize: 11, color: TEXT.faint }}>{sub}</Typography> : null}
        </Box>
    );
}

function Section({ title, right, children }) {
    return (
        <Box>
            <Stack direction="row" sx={{ alignItems: 'baseline', justifyContent: 'space-between', mb: 0.6, gap: 1 }}>
                <Typography sx={systemLabel}>{title}</Typography>
                {right ? <Typography sx={{ fontSize: 12, color: TEXT.faint }}>{right}</Typography> : null}
            </Stack>
            {children}
        </Box>
    );
}

function trailFrom(rows) {
    const m = new Map();
    for (const r of rows || []) {
        const key = `${r.gametype}|${r.table}|${r.shoe_id}`;
        let e = m.get(key);
        if (!e) {
            e = { key, tableKey: `${r.gametype}|${r.table}`, shoeId: r.shoe_id, hands: new Set(), wager: 0, result: 0, lastTs: r.ts };
            m.set(key, e);
        }
        e.hands.add(r.hand_in_shoe ?? r.ts);
        e.wager += Number(r.wager) || 0;
        e.result -= Number(r.win_loss) || 0;                 // feed is casino perspective
        if (String(r.ts) > String(e.lastTs)) e.lastTs = r.ts;
    }
    return [...m.values()]
        .map((e) => ({ ...e, hands: e.hands.size }))
        .sort((a, b) => String(b.lastTs).localeCompare(String(a.lastTs)));
}

function spreadOf(p) {
    const min = Number(p.min_bet), max = Number(p.max_bet);
    if (Number.isFinite(min) && Number.isFinite(max) && min > 0) return { value: `${Math.round(max / min)} : 1`, sub: 'max ÷ min bet', alert: max / min > 15 };
    const sd = Number(p.bet_stdev), avg = Number(p.avg_bet);
    if (Number.isFinite(sd) && Number.isFinite(avg) && avg > 0) return { value: (sd / avg).toFixed(2), sub: 'bet CV (stdev ÷ avg)', alert: sd / avg > 1.5 };
    return { value: '—', sub: 'no bet data', alert: false };
}

export default function RtPatronPanel({ patronId, patronRow, shoe, tableKey, trailRows, trailLoading, onPickTable, onToggleFull, fullOpen, onClear }) {
    const inShoe = useMemo(() => patronBetsInShoe(shoe, patronId), [shoe, patronId]);
    const trail = useMemo(() => trailFrom(trailRows), [trailRows]);

    if (!patronId) {
        return (
            <Stack spacing={1} sx={{ alignItems: 'center', justifyContent: 'center', textAlign: 'center', py: 8, color: TEXT.disabled }}>
                <PersonSearchIcon sx={{ fontSize: 34 }} />
                <Typography sx={{ fontSize: 15, fontWeight: 700, color: TEXT.muted }}>No patron selected</Typography>
                <Typography sx={{ fontSize: 13, color: TEXT.faint, maxWidth: 360 }}>
                    Click a player in a hand on the left, a row in the Patrons tab, or a patron alert.
                </Typography>
            </Stack>
        );
    }

    const p = patronRow || {};
    const tier = CARD_TIERS[p.card_type] || CARD_TIERS.BASE;
    const today = -(Number(p.cum_win) || 0);
    const spread = spreadOf(p);
    const shoeResult = inShoe.reduce((a, b) => a - b.casinoWin, 0);
    const shoeWager = inShoe.reduce((a, b) => a + b.wager, 0);

    return (
        <Stack spacing={2}>
            <Stack direction="row" spacing={1.25} sx={{ alignItems: 'center' }}>
                <Box sx={{ width: 46, height: 46, borderRadius: '50%', display: 'grid', placeItems: 'center', flexShrink: 0, bgcolor: `${tier.accent}26`, border: `1.5px solid ${tier.accent}`, color: tier.accent, fontWeight: 800, fontSize: 13 }}>
                    {String(patronId).slice(-2)}
                </Box>
                <Box sx={{ minWidth: 0, flex: 1 }}>
                    <Typography sx={systemLabel}>Patron</Typography>
                    <Typography sx={{ fontSize: 22, fontWeight: 800, color: TEXT.primary, lineHeight: 1.15 }}>{patronId}</Typography>
                    <Typography sx={{ fontSize: 12, color: TEXT.faint }}>
                        <Box component="span" sx={{ color: tier.accent, fontWeight: 700 }}>{tier.label}</Box>
                        {` · ${p.segment || '—'} · ${p.current_table_key ? `seat ${p.current_seat ?? '—'} at ${p.current_table_key}` : 'not seated'} · on floor ${duration(p.sign_in_mins_ago)}`}
                    </Typography>
                </Box>
                <ButtonBase aria-label="Clear patron" onClick={onClear} sx={{ color: TEXT.muted, borderRadius: 1, p: 0.5, '&:hover': { color: TEXT.primary } }}>
                    <CloseIcon sx={{ fontSize: 18 }} />
                </ButtonBase>
            </Stack>

            {!patronRow ? (
                <Typography sx={{ fontSize: 13, color: STATE.warning }}>Not in the current patron feed — they may have left the floor.</Typography>
            ) : (
                <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1 }}>
                    <Tile label="Today" value={signed(today)} color={signColor(today)} sub="patron's result" />
                    <Tile label="Turnover" value={plain(Number(p.cum_wager))} sub={`${p.hands ?? 0} hands · ${p.tables_played ?? 0} tables`} />
                    <Tile label="Avg bet" value={plain(Number(p.avg_bet))} />
                    <Tile label="Bet spread" value={spread.value} color={spread.alert ? STATE.warning : TEXT.primary} sub={spread.sub} />
                </Box>
            )}

            <Section title={`In this shoe${tableKey ? ` · ${tableKey}` : ''}`} right={inShoe.length ? `${inShoe.length} bets · ${plain(shoeWager)} · ${signed(shoeResult)}` : null}>
                {inShoe.length ? (
                    <Box sx={{ maxHeight: 220, overflowY: 'auto', scrollbarWidth: 'thin' }}>
                        {inShoe.slice().reverse().map((b, i) => {
                            const side = SIDE[b.betType] || { t: b.betType, c: TEXT.muted };
                            const res = -b.casinoWin;
                            return (
                                <Stack key={i} direction="row" spacing={1.25} sx={{ alignItems: 'center', px: 1, py: 0.6, borderRadius: 1, bgcolor: i % 2 ? 'transparent' : 'rgba(255,255,255,0.025)' }}>
                                    <Typography sx={{ width: 40, fontSize: 13, fontWeight: 800, color: TEXT.primary, fontVariantNumeric: 'tabular-nums' }}>#{b.handNo}</Typography>
                                    <Box sx={{ minWidth: 30, px: 0.75, py: 0.2, borderRadius: 1, bgcolor: side.c, color: '#fff', fontSize: 12, fontWeight: 800, textAlign: 'center' }}>{side.t}</Box>
                                    <Typography sx={{ flex: 1, fontSize: 13, color: TEXT.secondary, fontVariantNumeric: 'tabular-nums' }}>{plain(b.wager)}</Typography>
                                    <Typography sx={{ fontSize: 14, fontWeight: 800, color: signColor(res), fontVariantNumeric: 'tabular-nums' }}>{signed(res)}</Typography>
                                </Stack>
                            );
                        })}
                    </Box>
                ) : (
                    <Typography sx={{ fontSize: 13, color: TEXT.faint }}>Not playing the shoe shown on the left.</Typography>
                )}
            </Section>

            <Section title="Today's trail" right={trail.length ? `${trail.length} shoes` : null}>
                {trailLoading ? (
                    <Stack sx={{ alignItems: 'center', py: 2 }}><CircularProgress size={20} sx={{ color: ACCENT }} /></Stack>
                ) : trail.length ? (
                    <Box sx={{ maxHeight: 240, overflowY: 'auto', scrollbarWidth: 'thin' }}>
                        {trail.map((t) => (
                            <ButtonBase
                                key={t.key}
                                onClick={() => onPickTable(t.tableKey)}
                                sx={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'flex-start', gap: 1.25, px: 1, py: 0.6, borderRadius: 1, textAlign: 'left', '&:hover': { bgcolor: 'rgba(255,255,255,0.05)' } }}
                            >
                                <Typography sx={{ width: 92, fontSize: 13, fontWeight: 700, color: t.tableKey === tableKey ? ACCENT : TEXT.primary }}>{t.tableKey}</Typography>
                                <Typography sx={{ flex: 1, fontSize: 12, color: TEXT.faint, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                    {t.shoeId} · {t.hands} hand{t.hands === 1 ? '' : 's'} · {plain(t.wager)}
                                </Typography>
                                <Typography sx={{ fontSize: 13, fontWeight: 800, color: signColor(t.result), fontVariantNumeric: 'tabular-nums' }}>{signed(t.result)}</Typography>
                            </ButtonBase>
                        ))}
                    </Box>
                ) : (
                    <Typography sx={{ fontSize: 13, color: TEXT.faint }}>No betting records returned for today.</Typography>
                )}
            </Section>

            <ButtonBase
                onClick={onToggleFull}
                aria-expanded={fullOpen}
                sx={{ alignSelf: 'flex-start', gap: 0.75, px: 1.5, py: 0.9, borderRadius: 1.5, border: '1px solid rgba(122,162,247,0.4)', color: ACCENT, fontSize: 13, fontWeight: 700, '&:hover': { bgcolor: 'rgba(122,162,247,0.1)' } }}
            >
                {fullOpen ? 'Hide full Player 360' : 'Open full Player 360'}
                <ExpandMoreIcon sx={{ fontSize: 18, transform: fullOpen ? 'rotate(180deg)' : 'none', transition: 'transform 180ms' }} />
            </ButtonBase>
        </Stack>
    );
}
```

- [ ] **Step 2: Verify syntax**

Run: `npx eslint --no-eslintrc --parser-options=ecmaVersion:2022,sourceType:module,ecmaFeatures:{jsx:true} src/realtime/components/RtPatronPanel.js`
Expected: no output.

---

### Task 9: Dashboard rewrite and wiring

**Files:**
- Modify (full rewrite): `src/realtime/RealtimeDashboard.js`

**Interfaces:**
- Consumes: everything above; `pollAll`, `fetchShoe`, `fetchPatronDetail`; `groupShoeRows`; `evaluateAlerts`, `alertCounts`.

- [ ] **Step 1: Replace `RealtimeDashboard.js`**

```js
// Real-time Floor — Surveillance console.
// =======================================
// Redesign 2026-09-25 — see
// docs/superpowers/specs/2026-09-25-realtime-surveillance-redesign-design.md
//
//   header · floor tiles
//   alert strip                         (click → loads table and/or patron)
//   floor map (metric × scope) │ rankings (height = map)
//   shoe board (table, hand by hand) │ patron panel     ← linked
//   full Player 360 (on demand) · floor context (collapsed)

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Box, ButtonBase, Collapse, Stack, ToggleButton, ToggleButtonGroup, Tooltip, Typography } from '@mui/material';
import FiberManualRecordIcon from '@mui/icons-material/FiberManualRecord';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';

import RtDropdownSelector from './components/RtDropdownSelector';
import RtFloorMap from './components/RtFloorMap';
import RtTabbedPanel from './components/RtTabbedPanel';
import RtAlertBar from './components/RtAlertBar';
import RtSummaryTiles from './components/RtSummaryTiles';
import RtShoeBoard from './components/RtShoeBoard';
import RtPatronPanel from './components/RtPatronPanel';
import RtTrendChart from './components/RtTrendChart';
import RtBetMixPanel from './components/RtBetMixPanel';
import RtPatronInvestigation from './components/RtPatronInvestigation';

import { buildAvgScatterData } from './vendor/dataProcessing';
import config_data from './data/config_cod.json';
import {
    SCATTER_ASPECT, MAP_FRACTION, LEGEND_FRACTION, GRID_GAP,
    REFRESH_OPTIONS, DEFAULT_REFRESH_MS, HOUSE_EDGE_OPTIONS, DEFAULT_HOUSE_EDGE_BET, DEFAULT_TAB,
    TREND_BUCKET_OPTIONS, DEFAULT_TREND_BUCKET, RT_COUNT_KPIS,
    SHOW_SLICERS, FIXED_GAMES, RT_METRICS, RT_SCOPES, kpiKeyFor,
} from './constants/rtConfig';
import { isMockRealtimeFeed, realtimeOptions, filterRealtimeRows, buildAvgLegend, formatKpiValueFor } from './utils/realtimeData';
import { pollAll, fetchShoe, fetchPatronDetail } from './utils/rtDataSource';
import { groupShoeRows } from './utils/shoeData';
import { evaluateAlerts, alertCounts } from './utils/alertEngine';
import { SURFACE, TEXT, STATE, ACCENT, systemLabel } from './constants/rtTheme';

const REFRESH_LABELS = REFRESH_OPTIONS.map((o) => o.label);
const HOUSE_EDGE_BET_LABELS = HOUSE_EDGE_OPTIONS.map((o) => o.label);
const TREND_LABELS = TREND_BUCKET_OPTIONS.map((o) => o.label);
const msForLabel = (l) => (REFRESH_OPTIONS.find((o) => o.label === l) || {}).v ?? DEFAULT_REFRESH_MS;
const labelForMs = (ms) => (REFRESH_OPTIONS.find((o) => o.v === ms) || {}).label ?? REFRESH_OPTIONS[0].label;
const bucketForLabel = (l) => (TREND_BUCKET_OPTIONS.find((o) => o.label === l) || {}).v ?? DEFAULT_TREND_BUCKET;
const labelForBucket = (v) => (TREND_BUCKET_OPTIONS.find((o) => o.v === v) || {}).label ?? TREND_BUCKET_OPTIONS[0].label;
const EMPTY = [];

function fmtClock(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    return [d.getHours(), d.getMinutes(), d.getSeconds()].map((n) => String(n).padStart(2, '0')).join(':');
}

const panelSx = { borderRadius: 2, border: `1px solid ${SURFACE.panelBorder}`, bgcolor: SURFACE.panel, minWidth: 0 };
const raisedPanelSx = { borderRadius: 2, border: `1px solid ${SURFACE.raisedBorder}`, bgcolor: SURFACE.raised, minWidth: 0 };

const segmentedSx = {
    height: 36,
    '& .MuiToggleButton-root': {
        color: TEXT.muted, borderColor: 'rgba(122,162,247,0.35)', textTransform: 'none',
        fontSize: 13, fontWeight: 700, px: 1.6, whiteSpace: 'nowrap',
    },
    '& .Mui-selected': { color: `${TEXT.primary} !important`, bgcolor: 'rgba(122,162,247,0.24) !important' },
};

export default function RealtimeDashboard() {
    const options = useMemo(() => realtimeOptions(), []);

    // Hidden slicers (SHOW_SLICERS) — state kept so they work if re-enabled.
    const [selectedArea, setSelectedArea] = useState([]);
    const [selectedPit, setSelectedPit] = useState([]);
    const [selectedTableMin, setSelectedTableMin] = useState([]);

    const [metric, setMetric] = useState('win');
    const [scope, setScope] = useState('day');
    const [betOption, setBetOption] = useState(DEFAULT_HOUSE_EDGE_BET);
    const [refreshMs, setRefreshMs] = useState(DEFAULT_REFRESH_MS);
    const [activeTab, setActiveTab] = useState(DEFAULT_TAB);
    const [boardTableKey, setBoardTableKey] = useState(null);
    const [selectedHandNo, setSelectedHandNo] = useState(null);
    const [selectedPatronId, setSelectedPatronId] = useState(null);
    const [selectedAlertId, setSelectedAlertId] = useState(null);
    const [showFull360, setShowFull360] = useState(false);
    const [showFloorContext, setShowFloorContext] = useState(false);
    const [trendBucket, setTrendBucket] = useState(DEFAULT_TREND_BUCKET);
    const [betMixMode, setBetMixMode] = useState('wager');

    // ── Polled feeds ──────────────────────────────────────────────────
    const [feed, setFeed] = useState(null);
    const [pulsing, setPulsing] = useState(false);
    const inflight = useRef(false);
    const bucketRef = useRef(trendBucket);
    bucketRef.current = trendBucket;

    const poll = useCallback(async () => {
        if (inflight.current) return;
        inflight.current = true;
        setPulsing(true);
        try {
            setFeed(await pollAll(bucketRef.current));
        } finally {
            inflight.current = false;
            setTimeout(() => setPulsing(false), 400);
        }
    }, []);
    useEffect(() => { poll(); }, [poll, trendBucket]);
    useEffect(() => {
        const id = setInterval(poll, refreshMs);
        return () => clearInterval(id);
    }, [refreshMs, poll]);

    const today = useMemo(() => new Date().toISOString().slice(0, 10), []);
    const filteredConfig = useMemo(
        () => config_data.filter((c) => c.Group === 'TG' && c.is_Active === 1 && c.startdate <= today && c.enddate >= today),
        [today],
    );
    const axisBounds = useMemo(() => {
        if (!filteredConfig.length) return null;
        const xs = filteredConfig.map((c) => c.x), ys = filteredConfig.map((c) => c.y);
        const pad = 70;
        return { xMin: Math.min(...xs) - pad, xMax: Math.max(...xs) + pad, yMin: Math.min(...ys) - pad, yMax: Math.max(...ys) + pad };
    }, [filteredConfig]);

    const tables = feed ? feed.tables : null;
    const patrons = (feed && feed.patrons) || EMPTY;
    const betmix = (feed && feed.betmix) || EMPTY;
    const dealers = (feed && feed.dealers) || EMPTY;
    const trend = (feed && feed.trend) || EMPTY;

    const filteredTables = useMemo(() => (tables ? filterRealtimeRows(tables, {
        areas: selectedArea, pits: selectedPit, games: FIXED_GAMES, tableMins: selectedTableMin,
    }) : EMPTY), [tables, selectedArea, selectedPit, selectedTableMin]);

    const kpiKey = kpiKeyFor(metric, scope);
    const { scatter, legend } = useMemo(() => {
        if (!tables) return { scatter: EMPTY, legend: { columns: [], dataRows: [], overallAverages: {} } };
        const sc = buildAvgScatterData(filteredTables, filteredConfig, 'Table', [], FIXED_GAMES, today, today);
        return { scatter: sc, legend: buildAvgLegend(sc, filteredTables, kpiKey, selectedArea, betOption) };
    }, [tables, filteredTables, filteredConfig, kpiKey, selectedArea, betOption, today]);

    const alerts = useMemo(() => evaluateAlerts(filteredTables, patrons), [filteredTables, patrons]);
    const counts = useMemo(() => alertCounts(alerts), [alerts]);

    const tableByKey = useMemo(() => new Map(filteredTables.map((t) => [`${t.gametype}|${t.table}`, t])), [filteredTables]);
    const seatsByTable = useMemo(() => {
        const m = new Map();
        for (const p of patrons) {
            if (!p.current_table_key || !p.current_seat) continue;
            const list = m.get(p.current_table_key) || [];
            if (list.some((s) => s.seat === p.current_seat)) continue;
            list.push({ seat: p.current_seat, playerId: p.patron_id, cardType: p.card_type, cumWin: Number(p.cum_win) || 0 });
            m.set(p.current_table_key, list);
        }
        return m;
    }, [patrons]);

    // ── Shoe board table: first alerting table, else the biggest loser.
    // Sticky once chosen, so a wall screen doesn't jump every poll.
    const defaultBoardKey = useMemo(() => {
        const a = alerts.find((x) => x.tableKey && tableByKey.has(x.tableKey));
        if (a) return a.tableKey;
        let worst = null;
        for (const [k, t] of tableByKey) {
            if (!t.is_open) continue;
            const v = Number(t.win) || 0;
            if (!worst || v < worst.v) worst = { k, v };
        }
        return worst ? worst.k : null;
    }, [alerts, tableByKey]);
    useEffect(() => {
        if ((!boardTableKey || !tableByKey.has(boardTableKey)) && defaultBoardKey) setBoardTableKey(defaultBoardKey);
    }, [boardTableKey, defaultBoardKey, tableByKey]);
    const boardKey = boardTableKey && tableByKey.has(boardTableKey) ? boardTableKey : null;

    const alertTableSet = useMemo(() => new Set(alerts.map((a) => a.tableKey).filter(Boolean)), [alerts]);
    const tableOptions = useMemo(() => [...tableByKey.keys()]
        .sort((a, b) => (alertTableSet.has(b) - alertTableSet.has(a)) || a.localeCompare(b))
        .map((key) => ({ key, alerting: alertTableSet.has(key) })), [tableByKey, alertTableSet]);

    // ── Shoe feed for the board table, refreshed each poll tick ─────
    const [shoeState, setShoeState] = useState({ key: null, shoe: null, loading: false, error: null });
    const asOf = feed ? feed.asOf : null;
    useEffect(() => {
        if (!boardKey) return undefined;
        let cancelled = false;
        const [gametype, table] = boardKey.split('|');
        setShoeState((s) => (s.key === boardKey ? s : { key: boardKey, shoe: null, loading: true, error: null }));
        fetchShoe({ gametype, table }).then((res) => {
            if (cancelled) return;
            setShoeState((s) => ({
                key: boardKey,
                // Keep the last good shoe if a refresh fails.
                shoe: res.error && s.key === boardKey && s.shoe ? s.shoe : groupShoeRows(res.rows),
                loading: false,
                error: res.error,
            }));
        });
        return () => { cancelled = true; };
    }, [boardKey, asOf]);
    useEffect(() => { setSelectedHandNo(null); }, [boardKey]);
    const shoe = shoeState.key === boardKey ? shoeState.shoe : null;

    // ── Patron trail (on selection) ─────────────────────────────────
    const [trailState, setTrailState] = useState({ id: null, rows: EMPTY, loading: false });
    useEffect(() => {
        if (!selectedPatronId) { setTrailState({ id: null, rows: EMPTY, loading: false }); return undefined; }
        let cancelled = false;
        setTrailState({ id: selectedPatronId, rows: EMPTY, loading: true });
        fetchPatronDetail(selectedPatronId).then((res) => {
            if (!cancelled) setTrailState({ id: selectedPatronId, rows: res.rows, loading: false });
        });
        return () => { cancelled = true; };
    }, [selectedPatronId]);

    const patronRow = useMemo(() => patrons.find((p) => p.patron_id === selectedPatronId) || null, [patrons, selectedPatronId]);

    const legendFormatter = useMemo(() => formatKpiValueFor(kpiKey), [kpiKey]);
    const metricLabel = (RT_METRICS.find((m) => m.id === metric) || RT_METRICS[0]).label;
    const scopeLabel = metric === 'edge' ? 'current shoe' : (RT_SCOPES.find((s) => s.id === scope) || RT_SCOPES[0]).label.toLowerCase();

    const onAlertSelect = useCallback((a) => {
        setSelectedAlertId(a.id);
        if (a.tableKey && tableByKey.has(a.tableKey)) setBoardTableKey(a.tableKey);
        if (a.patronId) { setSelectedPatronId(a.patronId); setActiveTab('patrons'); }
        else setActiveTab(a.rule === 'NEG_EDGE' ? 'edge' : 'tables');
    }, [tableByKey]);

    if (!feed) {
        return (
            <Stack direction="row" spacing={2} sx={{ alignItems: 'center', justifyContent: 'center', height: '100%', color: ACCENT }}>
                <span style={{ width: 26, height: 26, border: '3px solid rgba(122,162,247,0.3)', borderTopColor: ACCENT, borderRadius: '50%', animation: 'rtSpin 0.8s linear infinite' }} />
                <Typography>Connecting to live floor feed…</Typography>
                <style>{'@keyframes rtSpin { to { transform: rotate(360deg); } }'}</style>
            </Stack>
        );
    }

    const degraded = (feed.errors || []).length > 0;
    const seatedAtBoard = boardKey ? (seatsByTable.get(boardKey) || EMPTY).length : 0;

    return (
        <Box sx={{
            width: '100%', height: '100%', overflowY: 'auto', boxSizing: 'border-box',
            bgcolor: SURFACE.page,
            scrollbarColor: 'rgba(122,162,247,0.4) rgba(255,255,255,0.04)', scrollbarWidth: 'thin',
        }}>
            <Box sx={{ px: { xs: 1.5, md: 2 }, py: 2, maxWidth: 2400, mx: 'auto' }}>

                {/* ── Header ─────────────────────────────────────── */}
                <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 1, mb: 1.5 }}>
                    <Typography component="h1" sx={{ color: TEXT.primary, fontSize: 22, fontWeight: 800, letterSpacing: 0.3, lineHeight: 1.2 }}>
                        Real-time Floor · Surveillance
                    </Typography>
                    <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center', px: 1.1, py: 0.5, borderRadius: 1, bgcolor: STATE.positiveBg, border: `1px solid ${STATE.positiveBorder}` }}>
                        <FiberManualRecordIcon sx={{ fontSize: 10, color: STATE.positive, animation: pulsing ? 'none' : 'rtPulse 2s infinite' }} />
                        <Typography component="span" sx={{ color: TEXT.secondary, fontSize: 13, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                            {isMockRealtimeFeed() ? 'MOCK' : 'LIVE'} · as of {fmtClock(feed.asOf)}
                        </Typography>
                    </Stack>
                    <Typography sx={{ fontSize: 13, color: TEXT.faint }}>Baccarat tables (BA · NC)</Typography>
                    {degraded ? (
                        <Tooltip title={feed.errors.map((e) => `${e.feed}: ${e.error}`).join(' · ')}>
                            <Typography sx={{ fontSize: 13, color: STATE.warning, fontWeight: 700, cursor: 'help' }}>
                                {feed.errors.length} feed{feed.errors.length === 1 ? '' : 's'} degraded
                            </Typography>
                        </Tooltip>
                    ) : null}
                    <Box sx={{ flex: 1 }} />
                    <RtDropdownSelector label="Auto-refresh" availableOptions={REFRESH_LABELS} selectedOptions={labelForMs(refreshMs)}
                        setSelectedOptions={(v) => setRefreshMs(msForLabel(Array.isArray(v) ? v[0] : v))} multiple={false} width={130} />
                    <style>{`@keyframes rtPulse { 0%,100% { opacity: 1; } 50% { opacity: 0.3; } }
                             @media (prefers-reduced-motion: reduce) { @keyframes rtPulse { 0%,100% { opacity: 1; } } }`}</style>
                </Stack>

                <RtSummaryTiles tables={filteredTables} patrons={patrons} alertCount={alerts.length} />

                {SHOW_SLICERS ? (
                    <Stack direction="row" spacing={1} sx={{ alignItems: 'flex-end', flexWrap: 'wrap', rowGap: 1, mt: 1 }}>
                        <RtDropdownSelector label="Area" availableOptions={options.areas} selectedOptions={selectedArea} setSelectedOptions={setSelectedArea} />
                        <RtDropdownSelector label="Pit" availableOptions={options.pits} selectedOptions={selectedPit} setSelectedOptions={setSelectedPit} />
                        <RtDropdownSelector label="Table Min" availableOptions={options.tableMins} selectedOptions={selectedTableMin} setSelectedOptions={setSelectedTableMin} />
                    </Stack>
                ) : null}

                <RtAlertBar alerts={alerts} onSelect={onAlertSelect} selectedId={selectedAlertId} />

                {/* ── Row 1 · map │ rankings ──────────────────────── */}
                <Box sx={{ mt: 1.5, display: 'grid', gridTemplateColumns: { xs: '1fr', lg: `${MAP_FRACTION}fr ${LEGEND_FRACTION}fr` }, gap: GRID_GAP, alignItems: 'stretch' }}>
                    <Box sx={{ ...raisedPanelSx, p: 1.25, display: 'flex', flexDirection: 'column', gap: 1 }}>
                        <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 1 }}>
                            <Typography sx={systemLabel}>Colour by</Typography>
                            <ToggleButtonGroup exclusive size="small" value={metric} onChange={(_, v) => v && setMetric(v)} aria-label="Map metric" sx={segmentedSx}>
                                {RT_METRICS.map((m) => <ToggleButton key={m.id} value={m.id}>{m.label}</ToggleButton>)}
                            </ToggleButtonGroup>
                            <ToggleButtonGroup exclusive size="small" value={scope} onChange={(_, v) => v && setScope(v)} aria-label="Time scope" sx={segmentedSx}>
                                {RT_SCOPES.map((s) => <ToggleButton key={s.id} value={s.id} disabled={metric === 'edge'}>{s.label}</ToggleButton>)}
                            </ToggleButtonGroup>
                            {metric === 'edge' ? (
                                <RtDropdownSelector label="Bet option" availableOptions={HOUSE_EDGE_BET_LABELS} selectedOptions={betOption}
                                    setSelectedOptions={(v) => setBetOption(Array.isArray(v) ? v[0] : v)} multiple={false} width={140} />
                            ) : null}
                            <Box sx={{ flex: 1 }} />
                            <Typography sx={{ fontSize: 13, color: TEXT.faint }}>
                                {metric === 'edge' ? 'House edge exists per shoe — live value' : scope === 'shoe' ? 'Current shoe on each table' : 'Gaming day so far'}
                            </Typography>
                        </Stack>
                        <Box sx={{ position: 'relative', width: '100%', aspectRatio: SCATTER_ASPECT, borderRadius: 1.5, overflow: 'hidden', bgcolor: 'rgba(0,0,0,0.18)' }}>
                            {scatter.length ? (
                                <RtFloorMap
                                    data={scatter}
                                    kpiKey={kpiKey}
                                    betOption={betOption}
                                    axisBounds={axisBounds}
                                    seatsByTable={seatsByTable}
                                    inspectedTableKey={boardKey}
                                    onTableClick={setBoardTableKey}
                                />
                            ) : (
                                <Stack sx={{ position: 'absolute', inset: 0, alignItems: 'center', justifyContent: 'center' }}>
                                    <Typography sx={{ fontSize: 15, fontWeight: 700, color: TEXT.faint }}>No baccarat tables in the feed</Typography>
                                </Stack>
                            )}
                        </Box>
                    </Box>
                    {/* Absolute inner box: the panel adds no intrinsic height,
                        so the row is exactly as tall as the map and the
                        rankings scroll inside it. */}
                    <Box sx={{ ...panelSx, position: 'relative', minHeight: { xs: 520, lg: 0 } }}>
                        <Box sx={{ position: 'absolute', inset: 0, p: 1.25, display: 'flex', flexDirection: 'column' }}>
                            <RtTabbedPanel
                                activeTab={activeTab}
                                onTabChange={setActiveTab}
                                legend={legend}
                                legendTitle={`${metricLabel} · ${scopeLabel}`}
                                legendFormatter={legendFormatter}
                                overallAvgLabel={RT_COUNT_KPIS.has(kpiKey) ? 'Total Tables' : 'Overall Avg'}
                                tables={filteredTables}
                                patrons={patrons}
                                dealers={dealers}
                                selectedTableKey={boardKey}
                                onSelectTable={setBoardTableKey}
                                selectedPatronId={selectedPatronId}
                                onSelectPatron={setSelectedPatronId}
                                alertCounts={counts}
                                scope={scope}
                            />
                        </Box>
                    </Box>
                </Box>

                {/* ── Row 2 · investigation workspace ─────────────── */}
                <Box sx={{ mt: 1.5, display: 'grid', gridTemplateColumns: { xs: '1fr', lg: `${MAP_FRACTION}fr ${LEGEND_FRACTION}fr` }, gap: GRID_GAP, alignItems: 'start' }}>
                    <Box sx={{ ...raisedPanelSx, p: 1.75 }}>
                        <RtShoeBoard
                            tableKey={boardKey}
                            tableRow={boardKey ? tableByKey.get(boardKey) : null}
                            shoe={shoe}
                            loading={shoeState.loading}
                            error={shoeState.key === boardKey ? shoeState.error : null}
                            tableOptions={tableOptions}
                            onPickTable={setBoardTableKey}
                            selectedHandNo={selectedHandNo}
                            onSelectHand={setSelectedHandNo}
                            selectedPatronId={selectedPatronId}
                            onSelectPatron={setSelectedPatronId}
                            seatedCount={seatedAtBoard}
                        />
                    </Box>
                    <Box sx={{ ...panelSx, p: 1.75 }}>
                        <RtPatronPanel
                            patronId={selectedPatronId}
                            patronRow={patronRow}
                            shoe={shoe}
                            tableKey={boardKey}
                            trailRows={trailState.id === selectedPatronId ? trailState.rows : EMPTY}
                            trailLoading={trailState.loading}
                            onPickTable={setBoardTableKey}
                            onToggleFull={() => setShowFull360((v) => !v)}
                            fullOpen={showFull360}
                            onClear={() => { setSelectedPatronId(null); setSelectedAlertId(null); setShowFull360(false); }}
                        />
                    </Box>
                </Box>

                <Collapse in={showFull360 && !!selectedPatronId} unmountOnExit>
                    <Box sx={{ ...panelSx, mt: 1.5, p: 1.25 }}>
                        <RtPatronInvestigation patronId={selectedPatronId} patronRow={patronRow} onClear={() => setShowFull360(false)} />
                    </Box>
                </Collapse>

                {/* ── Floor context (collapsed by default) ─────────── */}
                <Box sx={{ ...panelSx, mt: 1.5 }}>
                    <ButtonBase
                        onClick={() => setShowFloorContext((v) => !v)}
                        aria-expanded={showFloorContext}
                        sx={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'flex-start', gap: 1.5, px: 1.75, py: 1.25, borderRadius: 2, textAlign: 'left' }}
                    >
                        <Typography sx={{ fontSize: 14, fontWeight: 800, color: TEXT.primary }}>Floor context</Typography>
                        <Typography sx={{ fontSize: 13, color: TEXT.faint }}>session trend · betting mix</Typography>
                        <Box sx={{ flex: 1 }} />
                        <ExpandMoreIcon sx={{ color: TEXT.muted, transform: showFloorContext ? 'rotate(180deg)' : 'none', transition: 'transform 180ms' }} />
                    </ButtonBase>
                    <Collapse in={showFloorContext} unmountOnExit>
                        <Box sx={{ px: 1.75, pb: 1.75, display: 'grid', gridTemplateColumns: { xs: '1fr', lg: '6fr 4fr' }, gap: GRID_GAP, alignItems: 'start' }}>
                            <Box>
                                <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between' }}>
                                    <Typography sx={systemLabel}>Session trend · actual vs theo</Typography>
                                    <RtDropdownSelector label="Bucket" availableOptions={TREND_LABELS} selectedOptions={labelForBucket(trendBucket)}
                                        setSelectedOptions={(v) => setTrendBucket(bucketForLabel(Array.isArray(v) ? v[0] : v))} multiple={false} width={110} />
                                </Stack>
                                <RtTrendChart trend={trend} height={218} />
                            </Box>
                            <Box>
                                <Typography sx={{ ...systemLabel, mb: 1 }}>Floor betting mix</Typography>
                                <RtBetMixPanel betmix={betmix} mode={betMixMode} onModeChange={setBetMixMode} />
                            </Box>
                        </Box>
                    </Collapse>
                </Box>
            </Box>
        </Box>
    );
}
```

- [ ] **Step 2: Build check and browser run**

Start the dev server (`preview_start combine-dev`), open `http://localhost:3000/#/realtime`, check `preview_logs` for "Compiled" / no "Failed to compile", and `read_console_messages` for errors raised by the new files.
Expected: page renders header, tiles, alert strip, map with toolbar, rankings, shoe board with roads and hands, patron empty state, collapsed floor context.

- [ ] **Step 3: Interaction check**

Click a map table → board header changes to that table and the ring moves. Click a bead-plate cell → the hand row expands. Click a player ID in a hand → patron panel fills; their hands turn gold in the pulse chart and bead plate. Toggle 🪑 → seat tooltip on hover. Toggle Today/Current shoe → Table W/L switches between `win` and `shoe_win`.

---

### Task 10: Visual QA and fine-tune (frontend-design + ui-ux-pro-max)

**Files:**
- Modify as findings require; at minimum convert `Stack` `alignItems`/`justifyContent` props to `sx` in `RtAlertBar.js`, `RtSummaryTiles.js`, `RtBetMixPanel.js`, `RtTrendChart.js`, `RtPatronInvestigation.js`.

- [ ] **Step 1: Sweep Stack props**

Run: `grep -n "<Stack[^>]*\(alignItems\|justifyContent\)=" src/realtime -r`
For each hit, move the prop into the element's `sx`. Expected after: the grep returns nothing.

- [ ] **Step 2: Screenshot review at 1680×1050 and 1280×800**

Check against the checklists: rankings panel height equals the map's; overlay buttons don't overlap the visualMap; no horizontal page scroll (`document.body.scrollWidth <= clientWidth`); road cells crisp; text contrast ≥ 4.5:1 for any new colour; focus rings visible on overlay buttons, hand rows, bead cells.

- [ ] **Step 3: Fix what the review finds, re-screenshot**

- [ ] **Step 4: Run the whole test suite**

Run: `CI=true npx react-scripts test --watchAll=false src/realtime`
Expected: all suites pass.
