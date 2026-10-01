# Patron 360 Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the reused Live-dashboard Player 360 with a surveillance "case file" overlay that shows a patron's today and year-to-date betting evidence and a CLEAR / WATCH / ACTION level.

**Architecture:** A new on-demand feed (`/realtime/patron/{id}/bets`, one row per bet YTD with `edge_at_bet`) is normalised and aggregated by a pure module `utils/patron360.js` (summaries, per-shoe grid, daily series, six evidence tests, verdict). A full-screen MUI Dialog (`components/patron360/RtPatron360.js`) renders the model in sections; ECharts draws the hand strip, bet-vs-edge scatter and YTD trend. A deterministic mock generator makes the whole thing work offline.

**Tech Stack:** React 19, MUI v9 (Dialog uses `slots`/`slotProps`, not `PaperProps`/`TransitionComponent`; Stack alignment goes in `sx`), ECharts 6, CRA Jest.

Spec: `docs/superpowers/specs/2026-09-25-patron-360-redesign-design.md`

## Global Constraints

- Feed money is casino perspective; everything the 360 displays is **patron perspective** (+ = patron won), labelled. Hold % stays **house** hold.
- Gaming day starts 07:00 (`GAMING_DAY_START_HOUR`).
- A configured endpoint that fails returns `{ rows: [], live: false, error }` — never mock data for a real patron.
- All thresholds live in `PATRON_360` in `src/realtime/constants/rtConfig.js`.
- Colours come from `rtTheme` tokens; the negative-edge magenta pair is `rgb(214,92,255)` (0 to −1%) and `rgb(255,0,200)` (below −1%), matching the floor map.
- MUI v9: no `alignItems`/`justifyContent` props on Stack; no `PaperProps` on Dialog.
- Do not commit (the user commits); `src/realtime` is untracked.
- Test command: `CI=true npx react-scripts test --watchAll=false src/realtime` (PowerShell: `$env:CI='true'; npx react-scripts test --watchAll=false src/realtime`).

## File structure

| File | Responsibility |
|---|---|
| `src/realtime/constants/rtConfig.js` (modify) | `RT_ENDPOINTS.patronBets`, `PATRON_360` thresholds and constants |
| `src/realtime/utils/patron360.js` (create) | Pure model: normalise, summarise, group, tests, verdict |
| `src/realtime/utils/patronBetsMock.js` (create) | Deterministic YTD bet history per patron, 1-in-8 counters |
| `src/realtime/utils/shoeData.js` (modify) | Export `mulberry32` |
| `src/realtime/utils/rtDataSource.js` (modify) | `fetchPatronBets(patronId)` |
| `docs/realtime-surveillance-data-contract.md` (modify) | New §8 endpoint |
| `src/realtime/components/patron360/format.js` (create) | Formatters, labels, colour maps |
| `src/realtime/components/patron360/useEChart.js` (create) | ECharts lifecycle hook |
| `src/realtime/components/patron360/EvidencePanel.js` (create) | Six tests list |
| `src/realtime/components/patron360/NormalCompare.js` (create) | Today vs typical day vs YTD table |
| `src/realtime/components/patron360/HandStrip.js` (create) | Signature: bets per hand coloured by edge |
| `src/realtime/components/patron360/ShoeGrid.js` (create) | Today by shoe × bet option, expandable |
| `src/realtime/components/patron360/BetEdgeScatter.js` (create) | Wager vs edge scatter |
| `src/realtime/components/patron360/YtdTrend.js` (create) | Daily result/theo bars + cumulative luck |
| `src/realtime/components/patron360/BetTypeTable.js` (create) | YTD by bet option |
| `src/realtime/components/patron360/RtPatron360.js` (create) | Overlay: fetch, states, header, verdict stamp, layout |
| `src/realtime/components/RtPatronPanel.js` (modify) | "Open Player 360" button |
| `src/realtime/RealtimeDashboard.js` (modify) | Mount overlay; remove old Collapse |
| `src/realtime/components/RtPatronInvestigation.js` (delete) | Replaced |

---

### Task 1: Config + pure model (`patron360.js`)

**Files:**
- Modify: `src/realtime/constants/rtConfig.js` (RT_ENDPOINTS block ~line 206; append at end)
- Create: `src/realtime/utils/patron360.js`
- Test: `src/realtime/utils/__tests__/patron360.test.js`

**Interfaces:**
- Produces: `PATRON_360`; `RT_ENDPOINTS.patronBets`; from `patron360.js`: `currentGamingDate(now) → 'YYYY-MM-DD'`, `normalizeBets(rows) → Bet[]`, `summarize(Bet[]) → Summary`, `byBetType`, `byShoe`, `dailySeries`, `typicalDay(bets, today)`, `median`, `spearman`, `sampleEvery`, `TEST_META`, `evaluateTests(bets, {now}) → Test[]`, `verdictFrom(Test[]) → {level, reason}`, `buildPatron360(rows, {now}) → Model`.
- `Bet = { date, time, tableKey, shoeId, shoeKey, gameId, handNo, seat, dealer, result, betType, wager, casinoWin, theoWin, edge }`
- `Test = { id, label, question, unit, dir, state, today: {value,n}|null, ytd: {value,n}|null, worstBetType }`
- `Model = { today, bets, todayBets, ytdSummary, todaySummary, typical, shoesToday, byType, daily, firstDate, tests, verdict }`

- [ ] **Step 1: Add config**

In `rtConfig.js`, inside `RT_ENDPOINTS` after `shoe:` add:

```js
    // Year-to-date bets for ONE patron (§8 of the contract), fetched when
    // the Player 360 opens. `{id}` is substituted at call time.
    patronBets: process.env.REACT_APP_RT_PATRON_BETS_URL || sibling('/patron/{id}/bets'),
```

Append at end of file:

```js
// ── Player 360 ────────────────────────────────────────────────────────
// Evidence-test thresholds and the per-bet constants they need. `dir`
// high = bigger is worse; low = more negative is worse (correlation).
export const PATRON_360 = {
    BET_TYPES: ['BANKER', 'PLAYER', 'TIE', 'BANKER_PAIR', 'PLAYER_PAIR'],
    MAIN_BETS: ['BANKER', 'PLAYER'],
    // Nominal 8-deck house edge %, used for theo in the mock and to
    // colour "below normal" edge.
    NOMINAL_EDGE: { BANKER: 1.06, PLAYER: 1.24, TIE: 14.36, BANKER_PAIR: 10.36, PLAYER_PAIR: 10.36 },
    // Variance of the result per unit stake, for the luck z-score.
    VAR: { BANKER: 0.860, PLAYER: 0.905, TIE: 6.977, BANKER_PAIR: 9.953, PLAYER_PAIR: 9.953 },
    TESTS: {
        edge_timing: { watch: 1.5, flag: 2.5, minEach: 20 },
        bet_ramp: { watch: 1.5, flag: 2.5, minEach: 20 },
        edge_corr: { watch: -0.20, flag: -0.35, minBets: 100 },
        luck: { watch: 2, flag: 3, minBets: 50 },
        vs_normal: { watch: 2, flag: 3, minPriorDays: 5, minBetsToday: 20 },
        spread: { watch: 8, flag: 15, minMainBets: 30 },
    },
    // A flag on any of these alone means ACTION — they are the
    // card-counting tests.
    COUNTING_TESTS: ['edge_timing', 'bet_ramp', 'edge_corr'],
    SCATTER_MAX_POINTS: 5000,
};
```

- [ ] **Step 2: Write the failing test** — `src/realtime/utils/__tests__/patron360.test.js`

```js
import {
    currentGamingDate, normalizeBets, summarize, byShoe, byBetType, dailySeries, typicalDay,
    median, spearman, sampleEvery, evaluateTests, verdictFrom, buildPatron360,
} from '../patron360';

const NOW = new Date(2026, 8, 25, 15, 0).getTime();       // 25 Sep 2026 15:00 local
const TODAY = '2026-09-25';
let seq = 0;
const row = (o = {}) => {
    seq += 1;
    return {
        gaming_date: TODAY, game_time: new Date(Date.UTC(2026, 8, 25, 2, 0, 0) + seq * 1000).toISOString(),
        table_id: '10001', gametype: 'BA', shoe_id: 'S1', game_id: `G${seq}`, hand_no: 1, seat: 3, dealer: 'D1',
        result: 'B', bet_type: 'BANKER', wager: 100, casino_win: -95, theo_win: 1.06, edge_at_bet: 1.06, ...o,
    };
};
const bets = (rows) => normalizeBets(rows);
const byId = (tests, id) => tests.find((t) => t.id === id);

describe('currentGamingDate', () => {
    it('rolls over at 07:00, not midnight', () => {
        expect(currentGamingDate(new Date(2026, 8, 25, 6, 59).getTime())).toBe('2026-09-24');
        expect(currentGamingDate(new Date(2026, 8, 25, 7, 0).getTime())).toBe('2026-09-25');
    });
});

describe('normalizeBets', () => {
    it('drops empty bets and builds keys', () => {
        const out = bets([row(), row({ wager: 0 }), row({ bet_type: null }), row({ edge_at_bet: null })]);
        expect(out).toHaveLength(2);
        expect(out[0].tableKey).toBe('BA|10001');
        expect(out[0].shoeKey).toBe('BA|10001|S1');
        expect(out[1].edge).toBeNull();
    });
});

describe('summarize', () => {
    it('reports patron-perspective money and house hold', () => {
        const s = summarize(bets([
            row({ wager: 100, casino_win: -95, theo_win: 1.06, edge_at_bet: 1.06 }),
            row({ bet_type: 'PLAYER', wager: 300, casino_win: 300, theo_win: 3.72, edge_at_bet: 1.24 }),
        ]));
        expect(s.turnover).toBe(400);
        expect(s.result).toBe(-205);
        expect(s.theo).toBeCloseTo(-4.78, 6);
        expect(s.luck).toBeCloseTo(-200.22, 6);
        expect(s.holdPct).toBeCloseTo(51.25, 6);
        expect(s.avgBet).toBe(200);
        expect(s.minBet).toBe(100);
        expect(s.maxBet).toBe(300);
        expect(s.weightedEdge).toBeCloseTo(1.195, 6);
        expect(s.sideShare).toBe(0);
    });
    it('counts side-bet share of turnover', () => {
        const s = summarize(bets([row({ wager: 400 }), row({ bet_type: 'TIE', wager: 100, casino_win: 100 })]));
        expect(s.sideShare).toBeCloseTo(0.2, 6);
    });
    it('is safe on no bets', () => {
        const s = summarize([]);
        expect(s.bets).toBe(0);
        expect(s.avgBet).toBeNull();
    });
});

describe('byShoe and byBetType', () => {
    it('groups by shoe with bet-type cells, newest first', () => {
        const list = bets([
            row({ shoe_id: 'S1', hand_no: 3, game_time: '2026-09-25T09:00:00Z' }),
            row({ shoe_id: 'S1', hand_no: 5, bet_type: 'TIE', wager: 50, casino_win: 50, game_time: '2026-09-25T09:02:00Z' }),
            row({ shoe_id: 'S2', hand_no: 1, game_time: '2026-09-25T11:00:00Z' }),
        ]);
        const shoes = byShoe(list);
        expect(shoes.map((s) => s.shoeId)).toEqual(['S2', 'S1']);
        const s1 = shoes[1];
        expect(s1.firstHand).toBe(3);
        expect(s1.lastHand).toBe(5);
        expect(s1.hands).toBe(2);
        expect(s1.cells.BANKER).toEqual({ wager: 100, result: 95, bets: 1 });
        expect(s1.cells.TIE).toEqual({ wager: 50, result: -50, bets: 1 });
    });
    it('reports share of bets and money on negative edge per type', () => {
        const rows = byBetType(bets([
            row({ edge_at_bet: -0.5, wager: 300 }),
            row({ edge_at_bet: 1.2, wager: 100 }),
            row({ bet_type: 'PLAYER' }),
        ]));
        expect(rows.map((r) => r.betType)).toEqual(['BANKER', 'PLAYER']);
        expect(rows[0].negBetShare).toBe(0.5);
        expect(rows[0].negMoneyShare).toBe(0.75);
    });
});

describe('dailySeries and typicalDay', () => {
    it('builds ascending days and medians of earlier days', () => {
        const list = bets([
            row({ gaming_date: '2026-09-02', wager: 300 }),
            row({ gaming_date: '2026-09-01', wager: 100 }),
            row({ gaming_date: '2026-09-03', wager: 200 }),
            row({ gaming_date: TODAY, wager: 900 }),
        ]);
        expect(dailySeries(list).map((d) => d.date)).toEqual(['2026-09-01', '2026-09-02', '2026-09-03', TODAY]);
        const t = typicalDay(list, TODAY);
        expect(t.days).toBe(3);
        expect(t.avgBet).toBe(200);
    });
    it('median handles even counts and ignores nulls', () => {
        expect(median([4, 1, 3, 2])).toBe(2.5);
        expect(median([null, 5])).toBe(5);
        expect(median([])).toBeNull();
    });
});

describe('spearman and sampleEvery', () => {
    it('gives ±1 for monotonic data and handles ties', () => {
        expect(spearman([1, 2, 3, 4], [10, 20, 30, 40])).toBeCloseTo(1, 9);
        expect(spearman([1, 2, 3, 4], [40, 30, 20, 10])).toBeCloseTo(-1, 9);
        expect(spearman([1, 1, 2, 2], [5, 5, 9, 9])).toBeCloseTo(1, 9);
        expect(spearman([1, 1, 1], [1, 2, 3])).toBeNull();
    });
    it('samples to the cap', () => {
        expect(sampleEvery([1, 2, 3], 5)).toEqual([1, 2, 3]);
        expect(sampleEvery(Array.from({ length: 100 }, (_, i) => i), 10)).toHaveLength(10);
    });
});

describe('evidence tests', () => {
    const edgeRows = (negCount, posCount, negWager, posWager) => [
        ...Array.from({ length: negCount }, () => row({ edge_at_bet: -0.5, wager: negWager })),
        ...Array.from({ length: posCount }, () => row({ edge_at_bet: 1.2, wager: posWager })),
    ];

    it('flags betting into the edge and the bet ramp', () => {
        const t = evaluateTests(bets(edgeRows(20, 60, 1000, 100)), { now: NOW });
        expect(byId(t, 'edge_timing').state).toBe('flag');
        expect(byId(t, 'edge_timing').today.value).toBeCloseTo((20000 / 26000) / 0.25, 6);
        expect(byId(t, 'edge_timing').worstBetType).toBe('BANKER');
        expect(byId(t, 'bet_ramp').state).toBe('flag');
        expect(byId(t, 'bet_ramp').today.value).toBeCloseTo(10, 6);
    });
    it('needs 20 bets on each side of zero edge', () => {
        const t = evaluateTests(bets(edgeRows(19, 60, 1000, 100)), { now: NOW });
        expect(byId(t, 'edge_timing').state).toBe('insufficient');
    });
    it('flags wagers rising as edge falls', () => {
        const rows = Array.from({ length: 120 }, (_, i) => row({ edge_at_bet: i / 50, wager: 2000 - i * 10 }));
        const t = evaluateTests(bets(rows), { now: NOW });
        expect(byId(t, 'edge_corr').today.value).toBeCloseTo(-1, 9);
        expect(byId(t, 'edge_corr').state).toBe('flag');
    });
    it('flags results far above theo', () => {
        const rows = Array.from({ length: 60 }, () => row());
        const t = evaluateTests(bets(rows), { now: NOW });
        const z = (60 * (1.06 + 95)) / Math.sqrt(60 * 100 * 100 * 0.86);
        expect(byId(t, 'luck').today.value).toBeCloseTo(z, 6);
        expect(byId(t, 'luck').state).toBe('flag');
    });
    it('compares today with his normal', () => {
        const prior = ['01', '02', '03', '04', '05'].flatMap((d) =>
            Array.from({ length: 20 }, () => row({ gaming_date: `2026-09-${d}`, wager: 100 })));
        const todayRows = Array.from({ length: 20 }, () => row({ wager: 350 }));
        const t = evaluateTests(bets([...prior, ...todayRows]), { now: NOW });
        expect(byId(t, 'vs_normal').today.value).toBeCloseTo(3.5, 6);
        expect(byId(t, 'vs_normal').state).toBe('flag');
        expect(byId(t, 'vs_normal').ytd).toBeNull();
        const t4 = evaluateTests(bets([...prior.slice(20), ...todayRows]), { now: NOW });
        expect(byId(t4, 'vs_normal').state).toBe('insufficient');
    });
    it('measures main-bet spread today', () => {
        const rows = [...Array.from({ length: 29 }, () => row({ wager: 100 })), row({ wager: 2000 })];
        expect(byId(evaluateTests(bets(rows), { now: NOW }), 'spread').today.value).toBe(20);
        expect(byId(evaluateTests(bets(rows.slice(1)), { now: NOW }), 'spread').state).toBe('insufficient');
    });
});

describe('verdictFrom', () => {
    const t = (id, state) => ({ id, label: id, state });
    const base = ['edge_timing', 'bet_ramp', 'edge_corr', 'luck', 'vs_normal', 'spread'];
    const tests = (states) => base.map((id) => t(id, states[id] || 'clear'));

    it('ACTION on any counting flag', () => {
        expect(verdictFrom(tests({ edge_corr: 'flag' })).level).toBe('ACTION');
    });
    it('ACTION on two other flags', () => {
        expect(verdictFrom(tests({ luck: 'flag', spread: 'flag' })).level).toBe('ACTION');
    });
    it('WATCH on one non-counting flag or two watches', () => {
        expect(verdictFrom(tests({ luck: 'flag' })).level).toBe('WATCH');
        expect(verdictFrom(tests({ luck: 'watch', spread: 'watch' })).level).toBe('WATCH');
    });
    it('CLEAR with a single watch, and says so', () => {
        const v = verdictFrom(tests({ spread: 'watch' }));
        expect(v.level).toBe('CLEAR');
        expect(v.reason).toBe('1 watch: spread');
    });
    it('NO DATA when nothing could be tested', () => {
        expect(verdictFrom(base.map((id) => t(id, 'insufficient'))).level).toBe('NO DATA');
    });
});

describe('buildPatron360', () => {
    it('assembles the model', () => {
        const m = buildPatron360([row({ gaming_date: '2026-09-01' }), row()], { now: NOW });
        expect(m.today).toBe(TODAY);
        expect(m.todayBets).toHaveLength(1);
        expect(m.shoesToday).toHaveLength(1);
        expect(m.daily).toHaveLength(2);
        expect(m.firstDate).toBe('2026-09-01');
        expect(m.tests).toHaveLength(6);
        expect(m.verdict.level).toBe('NO DATA');
    });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `$env:CI='true'; npx react-scripts test --watchAll=false src/realtime/utils/__tests__/patron360`
Expected: FAIL — `Cannot find module '../patron360'`.

- [ ] **Step 4: Implement** — `src/realtime/utils/patron360.js`

```js
// Player 360 — pure calculations.
// ===============================
// Everything the Player 360 case file shows is derived here from the
// year-to-date bet rows (contract §8). No React, no fetching; unit tested.
//
// Money leaves this module in PATRON perspective (+ = the patron won):
// the feed is casino perspective, so result = −Σcasino_win and
// theo = −Σtheo_win. Hold % stays house hold, as the floor reports it.

import { PATRON_360, GAMING_DAY_START_HOUR } from '../constants/rtConfig';

const { TESTS, VAR, MAIN_BETS, BET_TYPES, COUNTING_TESTS } = PATRON_360;

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const pad2 = (n) => String(n).padStart(2, '0');
const sumWager = (list) => list.reduce((a, b) => a + b.wager, 0);
const typeRank = (t) => { const i = BET_TYPES.indexOf(t); return i === -1 ? 99 : i; };

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
    const d = new Date(now - GAMING_DAY_START_HOUR * 3600000);
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

export function normalizeBets(rows) {
    const out = [];
    for (const r of rows || []) {
        const wager = num(r.wager);
        if (!(wager > 0) || !r.bet_type) continue;
        const tableKey = `${r.gametype}|${r.table_id}`;
        const edge = r.edge_at_bet == null || r.edge_at_bet === '' ? null : Number(r.edge_at_bet);
        out.push({
            date: String(r.gaming_date).slice(0, 10),
            time: r.game_time,
            tableKey,
            shoeId: r.shoe_id,
            shoeKey: `${tableKey}|${r.shoe_id}`,
            gameId: r.game_id,
            handNo: num(r.hand_no),
            seat: r.seat == null ? null : num(r.seat),
            dealer: r.dealer ?? null,
            result: r.result,
            betType: String(r.bet_type).toUpperCase(),
            wager,
            casinoWin: num(r.casino_win),
            theoWin: num(r.theo_win),
            edge: Number.isFinite(edge) ? edge : null,
        });
    }
    out.sort((a, b) => String(a.time).localeCompare(String(b.time)) || a.handNo - b.handNo);
    return out;
}

export function median(xs) {
    const v = xs.filter((x) => x != null && Number.isFinite(x)).sort((a, b) => a - b);
    if (!v.length) return null;
    const m = Math.floor(v.length / 2);
    return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

export function summarize(bets) {
    let turnover = 0, casino = 0, theoC = 0, cardC = 0, side = 0;
    let edgeSum = 0, edgeN = 0, edgeW = 0, edgeWSum = 0;
    let min = Infinity, max = -Infinity;
    const hands = new Set(), shoes = new Set(), tables = new Set(), days = new Set();
    for (const b of bets) {
        turnover += b.wager; casino += b.casinoWin; theoC += b.theoWin;
        if (b.wager < min) min = b.wager;
        if (b.wager > max) max = b.wager;
        if (!MAIN_BETS.includes(b.betType)) side += b.wager;
        if (b.edge != null) {
            edgeSum += b.edge; edgeN += 1;
            edgeWSum += b.wager * b.edge; edgeW += b.wager;
            cardC += (b.wager * b.edge) / 100;
        }
        hands.add(b.gameId ?? `${b.shoeKey}#${b.handNo}`);
        shoes.add(b.shoeKey); tables.add(b.tableKey); days.add(b.date);
    }
    const n = bets.length;
    return {
        bets: n, hands: hands.size, shoes: shoes.size, tables: tables.size, days: days.size,
        turnover,
        avgBet: n ? turnover / n : null,
        minBet: n ? min : null,
        maxBet: n ? max : null,
        result: -casino,
        theo: -theoC,
        luck: theoC - casino,
        cardTheo: edgeN ? -cardC : null,
        holdPct: turnover ? (casino / turnover) * 100 : null,
        theoHoldPct: turnover ? (theoC / turnover) * 100 : null,
        avgEdge: edgeN ? edgeSum / edgeN : null,
        weightedEdge: edgeW ? edgeWSum / edgeW : null,
        sideShare: turnover ? side / turnover : null,
    };
}

export function byBetType(bets) {
    return [...groupBy(bets, (b) => b.betType).entries()]
        .map(([betType, list]) => {
            const withEdge = list.filter((b) => b.edge != null);
            const neg = withEdge.filter((b) => b.edge < 0);
            const money = sumWager(withEdge);
            return {
                betType,
                ...summarize(list),
                negBetShare: withEdge.length ? neg.length / withEdge.length : null,
                negMoneyShare: money ? sumWager(neg) / money : null,
            };
        })
        .sort((a, b) => typeRank(a.betType) - typeRank(b.betType));
}

export function byShoe(bets) {
    return [...groupBy(bets, (b) => b.shoeKey).values()]
        .map((list) => {
            const cells = {};
            for (const b of list) {
                const c = cells[b.betType] || (cells[b.betType] = { wager: 0, result: 0, bets: 0 });
                c.wager += b.wager; c.result -= b.casinoWin; c.bets += 1;
            }
            const handNos = list.map((b) => b.handNo);
            const times = list.map((b) => String(b.time)).sort();
            return {
                shoeKey: list[0].shoeKey, tableKey: list[0].tableKey, shoeId: list[0].shoeId,
                start: times[0], end: times[times.length - 1],
                firstHand: Math.min(...handNos), lastHand: Math.max(...handNos),
                hands: new Set(handNos).size,
                cells, total: summarize(list), bets: list,
            };
        })
        .sort((a, b) => String(b.start).localeCompare(String(a.start)));
}

export function dailySeries(bets) {
    return [...groupBy(bets, (b) => b.date).entries()]
        .map(([date, list]) => {
            const s = summarize(list);
            return { date, turnover: s.turnover, result: s.result, theo: s.theo, bets: s.bets, avgBet: s.avgBet, sideShare: s.sideShare };
        })
        .sort((a, b) => a.date.localeCompare(b.date));
}

const TYPICAL_KEYS = ['hands', 'bets', 'turnover', 'avgBet', 'minBet', 'maxBet', 'result', 'theo', 'luck',
    'cardTheo', 'holdPct', 'theoHoldPct', 'avgEdge', 'weightedEdge', 'sideShare'];

// A "typical day" = the median of each measure across earlier days this
// year. Median, not mean: one monster session shouldn't define normal.
export function typicalDay(bets, today) {
    const prior = [...groupBy(bets.filter((b) => b.date < today), (b) => b.date).values()].map(summarize);
    if (!prior.length) return null;
    const out = { days: prior.length };
    for (const k of TYPICAL_KEYS) out[k] = median(prior.map((s) => s[k]));
    return out;
}

function ranks(xs) {
    const idx = xs.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]);
    const r = new Array(xs.length);
    for (let i = 0; i < idx.length;) {
        let j = i;
        while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j += 1;
        const avg = (i + j) / 2 + 1;
        for (let k = i; k <= j; k += 1) r[idx[k][1]] = avg;
        i = j + 1;
    }
    return r;
}

// Spearman rank correlation; null when either side is constant.
export function spearman(xs, ys) {
    const n = xs.length;
    if (n < 3 || ys.length !== n) return null;
    const rx = ranks(xs), ry = ranks(ys);
    const mean = (n + 1) / 2;
    let sxy = 0, sxx = 0, syy = 0;
    for (let i = 0; i < n; i += 1) {
        const dx = rx[i] - mean, dy = ry[i] - mean;
        sxy += dx * dy; sxx += dx * dx; syy += dy * dy;
    }
    return sxx && syy ? sxy / Math.sqrt(sxx * syy) : null;
}

export function sampleEvery(arr, max) {
    if (arr.length <= max) return arr;
    const step = arr.length / max;
    const out = [];
    for (let i = 0; i < max; i += 1) out.push(arr[Math.floor(i * step)]);
    return out;
}

// ── Evidence tests ───────────────────────────────────────────────────
export const TEST_META = {
    edge_timing: { label: 'Bets into the edge', question: 'Does more of his money go in when the cards favour the player?', unit: 'x', dir: 'high' },
    bet_ramp: { label: 'Bet ramp', question: 'Is his average bet bigger on player-favourable hands?', unit: 'x', dir: 'high' },
    edge_corr: { label: 'Bet vs edge correlation', question: 'Do his bets rise as the house edge falls?', unit: 'corr', dir: 'low' },
    luck: { label: 'Result vs theo', question: 'Is he winning more than chance explains?', unit: 'sd', dir: 'high' },
    vs_normal: { label: 'Today vs his normal', question: 'Are his bet size or side bets unlike his usual day?', unit: 'x', dir: 'high' },
    spread: { label: 'Bet spread', question: 'How far apart are his smallest and largest main bets today?', unit: 'spread', dir: 'high' },
};

const SEVERITY = { insufficient: -1, clear: 0, watch: 1, flag: 2 };

function stateOf(id, v) {
    const t = TESTS[id];
    if (v == null || !Number.isFinite(v)) return 'insufficient';
    if (TEST_META[id].dir === 'low') return v <= t.flag ? 'flag' : v <= t.watch ? 'watch' : 'clear';
    return v >= t.flag ? 'flag' : v >= t.watch ? 'watch' : 'clear';
}

// Run a per-bet-type measure and keep the most extreme type.
function extremeByType(bets, fn, dir) {
    let best = null;
    for (const [betType, list] of groupBy(bets, (b) => b.betType)) {
        const r = fn(list);
        if (!r) continue;
        if (!best || (dir === 'low' ? r.value < best.value : r.value > best.value)) best = { ...r, betType };
    }
    return best;
}

function edgeSplit(list, minEach) {
    const e = list.filter((b) => b.edge != null);
    const neg = e.filter((b) => b.edge < 0);
    const pos = e.filter((b) => b.edge >= 0);
    return neg.length >= minEach && pos.length >= minEach ? { e, neg, pos } : null;
}

function edgeTiming(list) {
    const s = edgeSplit(list, TESTS.edge_timing.minEach);
    if (!s) return null;
    const all = sumWager(s.e);
    if (!all) return null;
    return { value: (sumWager(s.neg) / all) / (s.neg.length / s.e.length), n: s.e.length };
}

function betRamp(list) {
    const s = edgeSplit(list, TESTS.bet_ramp.minEach);
    if (!s) return null;
    const posAvg = sumWager(s.pos) / s.pos.length;
    return posAvg ? { value: (sumWager(s.neg) / s.neg.length) / posAvg, n: s.e.length } : null;
}

function edgeCorr(list) {
    const e = list.filter((b) => b.edge != null);
    if (e.length < TESTS.edge_corr.minBets) return null;
    const r = spearman(e.map((b) => b.wager), e.map((b) => b.edge));
    return r == null ? null : { value: r, n: e.length };
}

// (result − theo) in standard deviations of what chance alone produces.
function luckZ(bets) {
    if (bets.length < TESTS.luck.minBets) return null;
    let variance = 0, luck = 0;
    for (const b of bets) {
        variance += b.wager * b.wager * (VAR[b.betType] ?? 1);
        luck += b.theoWin - b.casinoWin;
    }
    return variance > 0 ? { value: luck / Math.sqrt(variance), n: bets.length } : null;
}

function vsNormal(bets, todayBets, today) {
    const t = TESTS.vs_normal;
    if (todayBets.length < t.minBetsToday) return null;
    const prior = dailySeries(bets.filter((b) => b.date < today));
    if (prior.length < t.minPriorDays) return null;
    const s = summarize(todayBets);
    const medAvg = median(prior.map((d) => d.avgBet));
    const medSide = median(prior.map((d) => d.sideShare));
    const ratios = [];
    if (medAvg > 0) ratios.push(s.avgBet / medAvg);
    if (medSide > 0 && s.sideShare != null) ratios.push(s.sideShare / medSide);
    return ratios.length ? { value: Math.max(...ratios), n: todayBets.length } : null;
}

function spreadToday(todayBets) {
    const main = todayBets.filter((b) => MAIN_BETS.includes(b.betType));
    if (main.length < TESTS.spread.minMainBets) return null;
    let lo = Infinity, hi = 0;
    for (const b of main) { if (b.wager < lo) lo = b.wager; if (b.wager > hi) hi = b.wager; }
    return lo > 0 ? { value: hi / lo, n: main.length } : null;
}

// State = the more severe of the two scopes that had enough data.
function makeTest(id, today, ytd) {
    let state = 'insufficient', from = null;
    for (const v of [today, ytd]) {
        if (!v) continue;
        const s = stateOf(id, v.value);
        if (SEVERITY[s] > SEVERITY[state]) { state = s; from = v; }
    }
    return {
        id, ...TEST_META[id], state,
        today: today ? { value: today.value, n: today.n } : null,
        ytd: ytd ? { value: ytd.value, n: ytd.n } : null,
        worstBetType: from && from.betType ? from.betType : null,
    };
}

export function evaluateTests(bets, { now = Date.now() } = {}) {
    const today = currentGamingDate(now);
    const todayBets = bets.filter((b) => b.date === today);
    return [
        makeTest('edge_timing', extremeByType(todayBets, edgeTiming, 'high'), extremeByType(bets, edgeTiming, 'high')),
        makeTest('bet_ramp', extremeByType(todayBets, betRamp, 'high'), extremeByType(bets, betRamp, 'high')),
        makeTest('edge_corr', extremeByType(todayBets, edgeCorr, 'low'), extremeByType(bets, edgeCorr, 'low')),
        makeTest('luck', luckZ(todayBets), luckZ(bets)),
        makeTest('vs_normal', vsNormal(bets, todayBets, today), null),
        makeTest('spread', spreadToday(todayBets), null),
    ];
}

export function verdictFrom(tests) {
    if (tests.every((t) => t.state === 'insufficient')) return { level: 'NO DATA', reason: 'Not enough bets to judge' };
    const flags = tests.filter((t) => t.state === 'flag');
    const watches = tests.filter((t) => t.state === 'watch');
    const names = (list) => list.map((t) => t.label.toLowerCase()).join(', ');
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

export function buildPatron360(rows, { now = Date.now() } = {}) {
    const bets = normalizeBets(rows);
    const today = currentGamingDate(now);
    const todayBets = bets.filter((b) => b.date === today);
    const tests = evaluateTests(bets, { now });
    let firstDate = null;
    for (const b of bets) if (!firstDate || b.date < firstDate) firstDate = b.date;
    return {
        today, bets, todayBets,
        ytdSummary: summarize(bets),
        todaySummary: summarize(todayBets),
        typical: typicalDay(bets, today),
        shoesToday: byShoe(todayBets),
        byType: byBetType(bets),
        daily: dailySeries(bets),
        firstDate,
        tests,
        verdict: verdictFrom(tests),
    };
}
```

- [ ] **Step 5: Run tests — expect PASS**

Run: `$env:CI='true'; npx react-scripts test --watchAll=false src/realtime/utils/__tests__/patron360`
Expected: all pass. Note: in the `verdictFrom` "CLEAR with a single watch" test the label is the id (`spread`), so the reason is `1 watch: spread`.

---

### Task 2: Mock generator, data source, contract

**Files:**
- Modify: `src/realtime/utils/shoeData.js:101` (`function mulberry32` → `export function mulberry32`)
- Create: `src/realtime/utils/patronBetsMock.js`
- Modify: `src/realtime/utils/rtDataSource.js` (imports; new export after `fetchPatronDetail`)
- Modify: `docs/realtime-surveillance-data-contract.md`
- Test: `src/realtime/utils/__tests__/patronBetsMock.test.js`

**Interfaces:**
- Consumes: `settleBet`, `hashKey`, `mulberry32` (shoeData); `currentGamingDate`, `buildPatron360` (Task 1); `PATRON_360.NOMINAL_EDGE`.
- Produces: `generateMockPatronBets(patronId, { now }) → row[]` (15 contract columns), `isMockCounter(patronId) → boolean`, `fetchPatronBets(patronId) → Promise<{ rows, live, error }>`.

- [ ] **Step 1: Write the failing test** — `src/realtime/utils/__tests__/patronBetsMock.test.js`

```js
import { generateMockPatronBets, isMockCounter } from '../patronBetsMock';
import { buildPatron360 } from '../patron360';
import { fetchPatronBets } from '../rtDataSource';

const NOW = new Date(2026, 8, 25, 15, 0).getTime();
const COLUMNS = ['gaming_date', 'game_time', 'table_id', 'gametype', 'shoe_id', 'game_id', 'hand_no', 'seat',
    'dealer', 'result', 'bet_type', 'wager', 'casino_win', 'theo_win', 'edge_at_bet'];

const ids = Array.from({ length: 60 }, (_, i) => `PID-${10001 + i}`);
const counterId = ids.find(isMockCounter);
const normalId = ids.find((id) => !isMockCounter(id));

describe('generateMockPatronBets', () => {
    it('is deterministic and matches the contract columns', () => {
        const a = generateMockPatronBets('PID-10001', { now: NOW });
        const b = generateMockPatronBets('PID-10001', { now: NOW });
        expect(a).toEqual(b);
        expect(a.length).toBeGreaterThan(500);
        expect(Object.keys(a[0]).sort()).toEqual([...COLUMNS].sort());
        expect(a.some((r) => r.gaming_date === '2026-09-25')).toBe(true);
        expect(a.every((r) => r.gaming_date >= '2026-01-01' && r.gaming_date <= '2026-09-25')).toBe(true);
        const todays = a.filter((r) => r.gaming_date === '2026-09-25');
        expect(todays.every((r) => new Date(r.game_time).getTime() <= NOW)).toBe(true);
    });
    it('makes counters look like counters and others not', () => {
        expect(counterId).toBeDefined();
        expect(buildPatron360(generateMockPatronBets(counterId, { now: NOW }), { now: NOW }).verdict.level).toBe('ACTION');
        expect(buildPatron360(generateMockPatronBets(normalId, { now: NOW }), { now: NOW }).verdict.level).not.toBe('ACTION');
    });
});

describe('fetchPatronBets', () => {
    it('uses the mock when no endpoint is configured', async () => {
        const res = await fetchPatronBets('PID-10001');
        expect(res.live).toBe(false);
        expect(res.error).toBeNull();
        expect(res.rows.length).toBeGreaterThan(0);
    });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `$env:CI='true'; npx react-scripts test --watchAll=false src/realtime/utils/__tests__/patronBetsMock`
Expected: FAIL — `Cannot find module '../patronBetsMock'`.

- [ ] **Step 3: Export `mulberry32`** — in `src/realtime/utils/shoeData.js` change `function mulberry32(seed) {` to `export function mulberry32(seed) {`.

- [ ] **Step 4: Implement** — `src/realtime/utils/patronBetsMock.js`

```js
// Mock year-to-date bet history for one patron (contract §8).
// ============================================================
// Deterministic per patron so the Player 360 is stable across reopenings.
// One patron in eight is a synthetic card counter: he backs whichever
// main side the cards favour, bets up as its edge falls, and jumps on a
// side bet when its edge turns negative — so CLEAR, WATCH and ACTION can
// all be demonstrated offline.

import { settleBet, hashKey, mulberry32 } from './shoeData';
import { PATRON_360, GAMING_DAY_START_HOUR } from '../constants/rtConfig';
import { currentGamingDate } from './patron360';

const { NOMINAL_EDGE } = PATRON_360;
const P_BANKER = 0.4586;
const P_PLAYER = 0.4462;
const P_PAIR = 0.0747;
const HAND_MS = 55000;
const SIDES = ['TIE', 'BANKER_PAIR', 'PLAYER_PAIR'];
// Edge noise grows as the shoe is dealt — composition matters more late.
const SIGMA = {
    BANKER: (h) => 0.25 + 0.012 * h,
    PLAYER: (h) => 0.25 + 0.012 * h,
    TIE: (h) => 2 + 0.2 * h,
    BANKER_PAIR: (h) => 1.5 + 0.15 * h,
    PLAYER_PAIR: (h) => 1.5 + 0.15 * h,
};

export const isMockCounter = (patronId) => hashKey(`bets|${patronId}`) % 8 === 0;

function gauss(rand) {
    let u = 0;
    while (u === 0) u = rand();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
}
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const round100 = (v) => Math.max(100, Math.round(v / 100) * 100);

export function generateMockPatronBets(patronId, { now = Date.now() } = {}) {
    const id = String(patronId);
    const rand = mulberry32(hashKey(`bets|${id}`));
    const counter = isMockCounter(id);
    const baseBet = 300 + Math.floor(rand() * 18) * 100;
    const today = currentGamingDate(now);
    const [y, m, d] = today.split('-').map(Number);
    const last = new Date(y, m - 1, d);
    const rows = [];

    for (let day = new Date(y, 0, 1); day <= last; day.setDate(day.getDate() + 1)) {
        const date = ymd(day);
        const isToday = date === today;
        if (!isToday && rand() > 0.35) continue;
        const dayRows = [];
        let clock = new Date(day.getFullYear(), day.getMonth(), day.getDate(), GAMING_DAY_START_HOUR + 3).getTime();
        const shoes = 1 + Math.floor(rand() * 4);

        for (let s = 0; s < shoes; s += 1) {
            const gametype = rand() < 0.6 ? 'BA' : 'NC';
            const table = String(10001 + Math.floor(rand() * 90));
            const shoeId = `${gametype}${table}-${date.replace(/-/g, '')}-S${s + 1}`;
            const seat = 1 + Math.floor(rand() * 7);
            const dealer = `D${1 + (hashKey(shoeId) % 40)}`;
            const first = 1 + Math.floor(rand() * 30);
            const count = 12 + Math.floor(rand() * 39);

            for (let h = first; h < first + count; h += 1) {
                const edge = {};
                for (const t of Object.keys(NOMINAL_EDGE)) edge[t] = NOMINAL_EDGE[t] + SIGMA[t](h) * gauss(rand);
                // A side whose edge has fallen is running hot for the player.
                const pB = P_BANKER + (NOMINAL_EDGE.BANKER - edge.BANKER) / 200;
                const pP = P_PLAYER + (NOMINAL_EDGE.PLAYER - edge.PLAYER) / 200;
                const u = rand();
                const result = u < pB ? 'B' : u < pB + pP ? 'P' : 'T';
                const hand = { result, bankerPair: rand() < P_PAIR, playerPair: rand() < P_PAIR };
                const time = new Date(clock).toISOString();
                clock += HAND_MS;
                if (rand() < 0.15) continue;                      // sits this hand out

                const bets = [];
                const main = counter
                    ? (edge.BANKER <= edge.PLAYER ? 'BANKER' : 'PLAYER')
                    : (rand() < 0.55 ? 'BANKER' : 'PLAYER');
                let wager = baseBet * (0.6 + 0.8 * rand());
                if (counter) wager *= 1 + 2.5 * Math.max(0, NOMINAL_EDGE[main] - edge[main]);
                bets.push([main, round100(wager)]);
                const side = SIDES[Math.floor(rand() * SIDES.length)];
                if (counter && edge[side] < 0 && rand() < 0.7) bets.push([side, round100(baseBet * 0.5)]);
                else if (rand() < 0.12) bets.push([side, round100(wager * 0.1)]);

                for (const [betType, w] of bets) {
                    dayRows.push({
                        gaming_date: date, game_time: time, table_id: table, gametype, shoe_id: shoeId,
                        game_id: `${shoeId}-H${h}`, hand_no: h, seat, dealer, result,
                        bet_type: betType, wager: w,
                        casino_win: settleBet(betType, w, hand),
                        theo_win: +((w * NOMINAL_EDGE[betType]) / 100).toFixed(2),
                        edge_at_bet: +edge[betType].toFixed(3),
                    });
                }
            }
            clock += 15 * 60000;
        }

        if (isToday && dayRows.length) {
            // Land today's play so its last hand was a minute ago.
            const shift = (now - 60000) - new Date(dayRows[dayRows.length - 1].game_time).getTime();
            for (const r of dayRows) r.game_time = new Date(new Date(r.game_time).getTime() + shift).toISOString();
        }
        rows.push(...dayRows);
    }
    return rows;
}
```

- [ ] **Step 5: Add `fetchPatronBets`** — `src/realtime/utils/rtDataSource.js`

Add import after the shoeData import:

```js
import { generateMockPatronBets } from './patronBetsMock';
```

Add to the header comment endpoint list:

```js
//   GET /realtime/patron/{id}/bets → that patron's bets YTD (on demand, Player 360)
```

Add after `fetchPatronDetail`:

```js
// Year-to-date bets for the Player 360 (§8). On demand only. Like the
// shoe feed, a configured endpoint that fails returns no rows plus the
// error — never mock bets for a real patron under investigation.
export async function fetchPatronBets(patronId) {
    const tpl = RT_ENDPOINTS.patronBets;
    if (!tpl) return { rows: generateMockPatronBets(patronId), live: false, error: null };
    const id = encodeURIComponent(patronId);
    const url = tpl.includes('{id}') ? tpl.replace('{id}', id) : `${tpl}/${id}/bets`;
    try {
        return { rows: await fetchJson(url, { timeoutMs: 60000 }), live: true, error: null };
    } catch (err) {
        // eslint-disable-next-line no-console
        console.warn('[RT] patron bets feed failed:', err.message);
        return { rows: [], live: false, error: err.message };
    }
}
```

- [ ] **Step 6: Run tests — expect PASS**

Run: `$env:CI='true'; npx react-scripts test --watchAll=false src/realtime`
Expected: all suites pass (previous 15 + new).

- [ ] **Step 7: Contract doc** — in `docs/realtime-surveillance-data-contract.md`:
  - Line 6: `**93 columns across 7 endpoints.**` → `**108 columns across 8 endpoints.**`
  - Rename `## 8. Resolved decisions` → `## 9. Resolved decisions`.
  - Insert before it:

```markdown
## 8. `GET /realtime/patron/{id}/bets` — Player 360, year to date

One row per bet the patron placed from 1 January this year through now,
**including today**. **15 columns.** Fetched once when the Player 360
opens (and on Retry) — never polled.

| Column | Type | Notes |
|---|---|---|
| `gaming_date` | DATE | gaming day (starts 07:00) |
| `game_time` | TIMESTAMP | when the hand was dealt |
| `table_id` | TEXT | |
| `gametype` | TEXT | `BA` / `NC` |
| `shoe_id` | TEXT | |
| `game_id` | TEXT | the hand |
| `hand_no` | INTEGER | 1-based position in the shoe |
| `seat` | INTEGER | 1–7 |
| `dealer` | TEXT | optional |
| `result` | TEXT | `B` / `P` / `T` |
| `bet_type` | TEXT | `BANKER`, `PLAYER`, `TIE`, `BANKER_PAIR`, `PLAYER_PAIR` |
| `wager` | NUMERIC | |
| `casino_win` | NUMERIC | casino perspective |
| `theo_win` | NUMERIC | casino perspective, nominal edge × wager |
| `edge_at_bet` | NUMERIC | house edge **%** for this `bet_type` given the cards left in the shoe just before this hand. Positive = house favoured (Banker ≈ 1.06); negative = player advantage |

`edge_at_bet` is what makes the card-counting tests possible: did the
patron bet more when the remaining cards favoured his side? Compute it
in the pipeline (remaining-card composition → exact edge per bet type),
not in the browser.

Backend: `select * from <table> where player_id = $1 and gaming_date >= date_trunc('year', current_date)`.
Env var: `REACT_APP_RT_PATRON_BETS_URL` (default: sibling path
`/patron/{id}/bets`). A failure shows an error with Retry — no mock
fallback when the endpoint is configured.

---
```

  - Summary table: add row `| /realtime/patron/{id}/bets | ~5–100k | 15 | On demand (Player 360) |` after the `/realtime/shoe` row.

---

### Task 3: Shared UI helpers (`format.js`, `useEChart.js`)

**Files:**
- Create: `src/realtime/components/patron360/format.js`
- Create: `src/realtime/components/patron360/useEChart.js`

**Interfaces:**
- Produces: `money(v)`, `plain(v)`, `signColor(v)`, `pct(v, d=2)`, `share(v)`, `int(v)`, `clock(iso)`, `BET_LABEL`, `LEVEL_COLOR`, `STATE_STYLE`, `EDGE_COLORS`, `edgeColor(edge, nominal)`, `formatTestValue(unit, v)`, `thresholdHint(id, unit, dir)`; `useEChart(option, onEvents?) → ref`.

- [ ] **Step 1: Create `format.js`**

```js
// Player 360 — formatters and colour maps shared by its sections.

import { PATRON_360 } from '../../constants/rtConfig';
import { STATE, TEXT } from '../../constants/rtTheme';

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
export const pct = (v, d = 2) => (ok(v) ? `${v < 0 ? '−' : ''}${Math.abs(v).toFixed(d)}%` : '—');
export const share = (v) => (ok(v) ? `${(v * 100).toFixed(1)}%` : '—');
export const int = (v) => (ok(v) ? Math.round(v).toLocaleString() : '—');
export const clock = (iso) => {
    const d = new Date(iso);
    return Number.isFinite(d.getTime()) ? `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` : '—';
};

export const BET_LABEL = { BANKER: 'Banker', PLAYER: 'Player', TIE: 'Tie', BANKER_PAIR: 'B Pair', PLAYER_PAIR: 'P Pair' };

export const LEVEL_COLOR = { ACTION: STATE.negative, WATCH: STATE.warning, CLEAR: STATE.positive, 'NO DATA': TEXT.muted };

export const STATE_STYLE = {
    flag: { label: 'FLAG', color: STATE.negative, bg: STATE.negativeBg },
    watch: { label: 'WATCH', color: STATE.warning, bg: STATE.warningBg },
    clear: { label: 'CLEAR', color: STATE.positive, bg: STATE.positiveBg },
    insufficient: { label: 'NO DATA', color: TEXT.muted, bg: 'rgba(255,255,255,0.04)' },
};

// The negative-edge pair matches the floor map's house-edge ramp, so
// magenta means "the cards favour the player" everywhere on the page.
export const EDGE_COLORS = {
    house: '#7d8fb8',
    thin: '#e0af68',
    player: 'rgb(214,92,255)',
    deep: 'rgb(255,0,200)',
    none: 'rgba(255,255,255,0.3)',
};
export function edgeColor(edge, nominal) {
    if (!ok(edge)) return EDGE_COLORS.none;
    if (edge < -1) return EDGE_COLORS.deep;
    if (edge < 0) return EDGE_COLORS.player;
    if (ok(nominal) && edge < nominal) return EDGE_COLORS.thin;
    return EDGE_COLORS.house;
}

export function formatTestValue(unit, v) {
    if (!ok(v)) return '—';
    const sign = v < 0 ? '−' : '+';
    if (unit === 'x') return `${v.toFixed(2)}×`;
    if (unit === 'corr') return `${sign}${Math.abs(v).toFixed(2)}`;
    if (unit === 'sd') return `${sign}${Math.abs(v).toFixed(1)} SD`;
    if (unit === 'spread') return `${Math.round(v)}:1`;
    return String(v);
}

export function thresholdHint(id, unit, dir) {
    const t = PATRON_360.TESTS[id];
    const op = dir === 'low' ? '≤' : '≥';
    return `watch ${op} ${formatTestValue(unit, t.watch)} · flag ${op} ${formatTestValue(unit, t.flag)}`;
}
```

- [ ] **Step 2: Create `useEChart.js`**

```js
// One ECharts instance per mounted element: init once, replace the
// option on change, follow the element's size, dispose on unmount.

import { useEffect, useRef } from 'react';
import * as echarts from 'echarts';

export default function useEChart(option, onEvents) {
    const ref = useRef(null);
    const inst = useRef(null);
    const events = useRef(onEvents);
    events.current = onEvents;

    useEffect(() => {
        const el = ref.current;
        if (!el) return undefined;
        const chart = echarts.init(el);
        inst.current = chart;
        chart.on('click', (p) => events.current && events.current.click && events.current.click(p));
        const ro = new ResizeObserver(() => chart.resize());
        ro.observe(el);
        return () => { ro.disconnect(); chart.dispose(); inst.current = null; };
    }, []);

    useEffect(() => {
        if (inst.current && option) inst.current.setOption(option, { notMerge: true });
    }, [option]);

    return ref;
}
```

- [ ] **Step 3: Verify compile** — the dev server (already running on :3000) recompiles; no build errors expected (files unused until Task 7).

---

### Task 4: Evidence panel and Today-vs-normal table

**Files:**
- Create: `src/realtime/components/patron360/EvidencePanel.js`
- Create: `src/realtime/components/patron360/NormalCompare.js`

**Interfaces:**
- Consumes: `Test[]` (Task 1), format helpers (Task 3), `PATRON_360.TESTS.vs_normal`.
- Produces: `<EvidencePanel tests />`, `<NormalCompare today typical ytd />` (Summary objects; `typical` may be null).

- [ ] **Step 1: Create `EvidencePanel.js`**

```js
// The six evidence tests, one row each: state (as text, never colour
// alone), what it asks, and the number behind it for today and YTD.

import React from 'react';
import { Box, Stack, Typography } from '@mui/material';
import { TEXT, systemLabel } from '../../constants/rtTheme';
import { BET_LABEL, STATE_STYLE, formatTestValue, thresholdHint } from './format';

const TODAY_ONLY = new Set(['vs_normal', 'spread']);
const VALUE_W = 96;

function StateChip({ state }) {
    const s = STATE_STYLE[state];
    return (
        <Box sx={{
            width: 76, flexShrink: 0, py: 0.4, borderRadius: 1, textAlign: 'center',
            fontSize: 11, fontWeight: 900, letterSpacing: 1, color: s.color, border: `1px solid ${s.color}`, bgcolor: s.bg,
        }}>
            {s.label}
        </Box>
    );
}

function Value({ v, unit, empty }) {
    return (
        <Box sx={{ width: VALUE_W, flexShrink: 0, textAlign: 'right' }}>
            <Typography sx={{ fontSize: 16, fontWeight: 800, color: v ? TEXT.primary : TEXT.faint, fontVariantNumeric: 'tabular-nums', lineHeight: 1.3 }}>
                {v ? formatTestValue(unit, v.value) : '—'}
            </Typography>
            <Typography sx={{ fontSize: 11, color: TEXT.faint }}>{v ? `${v.n.toLocaleString()} bets` : empty}</Typography>
        </Box>
    );
}

export default function EvidencePanel({ tests }) {
    return (
        <Box>
            <Stack direction="row" spacing={1.5} sx={{ px: 1.25, mb: 0.5 }}>
                <Box sx={{ flex: 1 }} />
                <Typography sx={{ ...systemLabel, width: VALUE_W, textAlign: 'right' }}>Today</Typography>
                <Typography sx={{ ...systemLabel, width: VALUE_W, textAlign: 'right' }}>YTD</Typography>
            </Stack>
            <Stack spacing={0.75}>
                {tests.map((t) => (
                    <Stack
                        key={t.id}
                        direction="row"
                        spacing={1.5}
                        sx={{
                            alignItems: 'center', px: 1.25, py: 1, borderRadius: 1.5,
                            bgcolor: 'rgba(255,255,255,0.03)', borderLeft: `3px solid ${STATE_STYLE[t.state].color}`,
                        }}
                    >
                        <StateChip state={t.state} />
                        <Box sx={{ flex: 1, minWidth: 0 }}>
                            <Typography sx={{ fontSize: 14, fontWeight: 800, color: TEXT.primary, lineHeight: 1.3 }}>
                                {t.label}
                                {t.worstBetType ? (
                                    <Box component="span" sx={{ ml: 0.75, fontSize: 12, fontWeight: 700, color: TEXT.muted }}>
                                        · {BET_LABEL[t.worstBetType] || t.worstBetType}
                                    </Box>
                                ) : null}
                            </Typography>
                            <Typography sx={{ fontSize: 12, color: TEXT.muted }}>{t.question}</Typography>
                            <Typography sx={{ fontSize: 11, color: TEXT.faint }}>{thresholdHint(t.id, t.unit, t.dir)}</Typography>
                        </Box>
                        <Value v={t.today} unit={t.unit} empty="too few bets" />
                        <Value v={t.ytd} unit={t.unit} empty={TODAY_ONLY.has(t.id) ? 'today only' : 'too few bets'} />
                    </Stack>
                ))}
            </Stack>
        </Box>
    );
}
```

- [ ] **Step 2: Create `NormalCompare.js`**

```js
// Today against his own normal: a typical day (median of earlier days)
// and the year so far. The last column is where "unusual" shows up.

import React from 'react';
import { Box, Typography } from '@mui/material';
import { PATRON_360 } from '../../constants/rtConfig';
import { TEXT, STATE, systemLabel } from '../../constants/rtTheme';
import { money, plain, pct, share, int, signColor } from './format';

const ROWS = [
    { k: 'hands', label: 'Hands', f: int, cmp: 'ratio' },
    { k: 'bets', label: 'Bets', f: int, cmp: 'ratio' },
    { k: 'turnover', label: 'Turnover', f: plain, cmp: 'ratio' },
    { k: 'avgBet', label: 'Average bet', f: plain, cmp: 'ratio' },
    { k: 'minBet', label: 'Smallest bet', f: plain, cmp: 'ratio' },
    { k: 'maxBet', label: 'Largest bet', f: plain, cmp: 'ratio' },
    { k: 'result', label: 'Result', f: money, cmp: 'delta', signed: true },
    { k: 'theo', label: 'Theo', f: money, cmp: 'delta', signed: true },
    { k: 'luck', label: 'Result − theo', f: money, cmp: 'delta', signed: true },
    { k: 'cardTheo', label: 'Card-adjusted theo', f: money, cmp: 'delta', signed: true },
    { k: 'holdPct', label: 'House hold', f: pct, cmp: 'pp' },
    { k: 'theoHoldPct', label: 'Theo hold', f: pct, cmp: 'pp' },
    { k: 'weightedEdge', label: 'Money-weighted edge', f: pct, cmp: 'pp' },
    { k: 'avgEdge', label: 'Average edge', f: pct, cmp: 'pp' },
    { k: 'sideShare', label: 'Side-bet share', f: share, cmp: 'ratio' },
];

const ok = (v) => v != null && Number.isFinite(v);

function compare(row, a, b) {
    if (!ok(a) || !ok(b)) return { text: '—', color: TEXT.faint };
    if (row.cmp === 'ratio') {
        if (!b) return { text: '—', color: TEXT.faint };
        const r = a / b;
        const t = PATRON_360.TESTS.vs_normal;
        return { text: `${r.toFixed(2)}×`, color: r >= t.flag ? STATE.negative : r >= t.watch ? STATE.warning : TEXT.secondary, bold: r >= t.watch };
    }
    const d = a - b;
    if (row.cmp === 'pp') return { text: `${d < 0 ? '−' : '+'}${Math.abs(d).toFixed(2)} pp`, color: TEXT.secondary };
    return { text: money(d), color: signColor(d) };
}

const cellSx = { px: 1, py: 0.6, textAlign: 'right', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', fontSize: 13 };

export default function NormalCompare({ today, typical, ytd }) {
    return (
        <Box sx={{ overflowX: 'auto' }}>
            <Box component="table" sx={{ width: '100%', borderCollapse: 'collapse', '& tbody tr:nth-of-type(odd)': { bgcolor: 'rgba(255,255,255,0.025)' } }}>
                <thead>
                    <tr>
                        {['Measure', 'Today', 'Typical day', 'YTD total', 'Today vs typical'].map((h, i) => (
                            <Box component="th" key={h} sx={{ ...systemLabel, ...cellSx, fontSize: 11, textAlign: i ? 'right' : 'left' }}>{h}</Box>
                        ))}
                    </tr>
                </thead>
                <tbody>
                    {ROWS.map((row) => {
                        const a = today ? today[row.k] : null;
                        const b = typical ? typical[row.k] : null;
                        const c = compare(row, a, b);
                        const col = (v) => (row.signed ? signColor(v) : TEXT.primary);
                        return (
                            <tr key={row.k}>
                                <Box component="td" sx={{ ...cellSx, textAlign: 'left', color: TEXT.secondary }}>{row.label}</Box>
                                <Box component="td" sx={{ ...cellSx, fontWeight: 800, color: col(a) }}>{row.f(a)}</Box>
                                <Box component="td" sx={{ ...cellSx, color: typical ? col(b) : TEXT.faint }}>{row.f(b)}</Box>
                                <Box component="td" sx={{ ...cellSx, color: col(ytd ? ytd[row.k] : null) }}>{row.f(ytd ? ytd[row.k] : null)}</Box>
                                <Box component="td" sx={{ ...cellSx, color: c.color, fontWeight: c.bold ? 800 : 600 }}>{c.text}</Box>
                            </tr>
                        );
                    })}
                </tbody>
            </Box>
            <Typography sx={{ mt: 0.75, fontSize: 11, color: TEXT.faint }}>
                Money is from the patron's side (+ = patron won). Hold is the house's.
            </Typography>
        </Box>
    );
}
```

- [ ] **Step 3: Verify compile** (dev server; no errors).

---

### Task 5: Today by shoe + hand strip

**Files:**
- Create: `src/realtime/components/patron360/HandStrip.js`
- Create: `src/realtime/components/patron360/ShoeGrid.js`

**Interfaces:**
- Consumes: `byShoe` rows (Task 1: `{ shoeKey, tableKey, shoeId, start, end, firstHand, lastHand, hands, cells, total, bets }`), format helpers, `useEChart`.
- Produces: `<ShoeGrid shoes />`, `<HandStrip bets />`, `<EdgeKey />`.

- [ ] **Step 1: Create `HandStrip.js`**

```js
// Signature view: one bar per bet, hand by hand through a shoe, height
// = wager, colour = the house edge when he placed it. A counter shows up
// as tall magenta bars — money arriving when the cards favour him.

import React, { useMemo } from 'react';
import { Box, Stack, Typography } from '@mui/material';
import { PATRON_360 } from '../../constants/rtConfig';
import { TEXT } from '../../constants/rtTheme';
import useEChart from './useEChart';
import { BET_LABEL, EDGE_COLORS, edgeColor, money, pct, plain, signColor } from './format';

const typeRank = (t) => { const i = PATRON_360.BET_TYPES.indexOf(t); return i === -1 ? 99 : i; };

export function EdgeKey() {
    const items = [
        [EDGE_COLORS.house, 'House edge at or above normal'],
        [EDGE_COLORS.thin, 'House edge below normal'],
        [EDGE_COLORS.player, 'Player edge (0 to −1%)'],
        [EDGE_COLORS.deep, 'Player edge below −1%'],
    ];
    return (
        <Stack direction="row" sx={{ flexWrap: 'wrap', columnGap: 2, rowGap: 0.5 }}>
            {items.map(([c, l]) => (
                <Stack key={l} direction="row" spacing={0.75} sx={{ alignItems: 'center' }}>
                    <Box sx={{ width: 10, height: 10, borderRadius: 0.5, bgcolor: c }} />
                    <Typography sx={{ fontSize: 12, color: TEXT.muted }}>{l}</Typography>
                </Stack>
            ))}
        </Stack>
    );
}

export default function HandStrip({ bets }) {
    const option = useMemo(() => {
        const handNos = bets.map((b) => b.handNo);
        const lo = Math.min(...handNos), hi = Math.max(...handNos);
        const xs = [];
        for (let h = lo; h <= hi; h += 1) xs.push(h);
        const types = [...new Set(bets.map((b) => b.betType))].sort((a, b) => typeRank(a) - typeRank(b));
        const series = types.map((t) => {
            const byHand = new Map();
            for (const b of bets) {
                if (b.betType !== t) continue;
                const e = byHand.get(b.handNo) || { wager: 0, casino: 0, edge: b.edge };
                e.wager += b.wager; e.casino += b.casinoWin;
                byHand.set(b.handNo, e);
            }
            return {
                name: BET_LABEL[t] || t, type: 'bar', stack: 'w', barMaxWidth: 18,
                data: xs.map((h) => {
                    const e = byHand.get(h);
                    return e ? {
                        value: e.wager, edge: e.edge, result: -e.casino, betType: t,
                        itemStyle: { color: edgeColor(e.edge, PATRON_360.NOMINAL_EDGE[t]), borderColor: 'rgba(13,14,24,0.9)', borderWidth: 1 },
                    } : '-';
                }),
            };
        });
        return {
            backgroundColor: 'transparent', animation: false,
            grid: { left: 60, right: 12, top: 12, bottom: 28 },
            tooltip: {
                trigger: 'axis', axisPointer: { type: 'shadow' },
                backgroundColor: 'rgba(14,16,28,0.97)', borderColor: 'rgba(122,162,247,0.45)', textStyle: { color: '#fff', fontSize: 12 },
                formatter: (ps) => {
                    const rows = ps.filter((p) => p.data && typeof p.data === 'object').map((p) => {
                        const d = p.data;
                        return `<div style="display:flex;gap:14px;justify-content:space-between">
                            <span>${BET_LABEL[d.betType] || d.betType} ${plain(d.value)}</span>
                            <span style="color:${edgeColor(d.edge, PATRON_360.NOMINAL_EDGE[d.betType])}">edge ${pct(d.edge)}</span>
                            <span style="color:${signColor(d.result)}">${money(d.result)}</span></div>`;
                    }).join('');
                    return `<div style="font-weight:800;margin-bottom:4px">Hand #${ps[0].axisValue}</div>${rows || '<span style="opacity:.7">sat out</span>'}`;
                },
            },
            xAxis: {
                type: 'category', data: xs,
                axisLabel: { color: TEXT.muted, fontSize: 11 },
                axisLine: { lineStyle: { color: 'rgba(255,255,255,0.15)' } }, axisTick: { show: false },
            },
            yAxis: {
                type: 'value',
                axisLabel: { color: TEXT.muted, fontSize: 11, formatter: (v) => plain(v) },
                splitLine: { lineStyle: { color: 'rgba(255,255,255,0.06)' } },
            },
            series,
        };
    }, [bets]);
    const ref = useEChart(option);

    return (
        <Box>
            <Box ref={ref} role="img" aria-label="His bets hand by hand, coloured by the house edge when each bet was placed" sx={{ width: '100%', height: 200 }} />
            <EdgeKey />
        </Box>
    );
}
```

- [ ] **Step 2: Create `ShoeGrid.js`**

```js
// Today, shoe by shoe: what he bet on each option and how it went.
// Newest shoe first and open, so the hand strip is visible on arrival.

import React, { useState } from 'react';
import { Box, Stack, Typography } from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import { PATRON_360 } from '../../constants/rtConfig';
import { TEXT, ACCENT, systemLabel } from '../../constants/rtTheme';
import HandStrip from './HandStrip';
import { BET_LABEL, EDGE_COLORS, clock, money, pct, plain, signColor } from './format';

const TYPES = PATRON_360.BET_TYPES;
const COLS = 8 + TYPES.length;

function Cell({ c }) {
    if (!c) return <Typography sx={{ fontSize: 13, color: TEXT.disabled }}>·</Typography>;
    return (
        <>
            <Typography sx={{ fontSize: 13, fontWeight: 700, color: TEXT.primary, lineHeight: 1.3 }}>{plain(c.wager)}</Typography>
            <Typography sx={{ fontSize: 12, fontWeight: 700, color: signColor(c.result), lineHeight: 1.3 }}>{money(c.result)}</Typography>
        </>
    );
}

export default function ShoeGrid({ shoes }) {
    const [open, setOpen] = useState(() => (shoes[0] ? shoes[0].shoeKey : null));

    if (!shoes.length) {
        return <Typography sx={{ fontSize: 13, color: TEXT.faint, py: 2 }}>Not played today.</Typography>;
    }

    const toggle = (key) => setOpen((cur) => (cur === key ? null : key));

    return (
        <Box sx={{ overflowX: 'auto' }}>
            <Box component="table" sx={{
                width: '100%', minWidth: 1000, borderCollapse: 'separate', borderSpacing: '0 4px',
                '& th': { ...systemLabel, px: 1, py: 0.5, textAlign: 'right', whiteSpace: 'nowrap' },
                '& td': { px: 1, py: 0.9, textAlign: 'right', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', verticalAlign: 'middle' },
            }}>
                <thead>
                    <tr>
                        <th style={{ textAlign: 'left' }}>Shoe</th>
                        <th style={{ textAlign: 'left' }}>Time</th>
                        <th>Joined</th>
                        <th>Hands</th>
                        {TYPES.map((t) => <th key={t}>{BET_LABEL[t]}</th>)}
                        <th>Result</th>
                        <th>Theo</th>
                        <th>Avg bet</th>
                        <th>Wtd edge</th>
                    </tr>
                </thead>
                <tbody>
                    {shoes.map((s) => {
                        const isOpen = open === s.shoeKey;
                        const edge = s.total.weightedEdge;
                        return (
                            <React.Fragment key={s.shoeKey}>
                                <Box
                                    component="tr"
                                    role="button"
                                    tabIndex={0}
                                    aria-expanded={isOpen}
                                    onClick={() => toggle(s.shoeKey)}
                                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(s.shoeKey); } }}
                                    sx={{
                                        cursor: 'pointer',
                                        bgcolor: isOpen ? 'rgba(122,162,247,0.12)' : 'rgba(255,255,255,0.03)',
                                        transition: 'background-color 150ms',
                                        '&:hover': { bgcolor: 'rgba(122,162,247,0.09)' },
                                        '&:focus-visible': { outline: `2px solid ${ACCENT}`, outlineOffset: -2 },
                                        '& td:first-of-type': { borderRadius: '6px 0 0 6px' },
                                        '& td:last-of-type': { borderRadius: '0 6px 6px 0' },
                                    }}
                                >
                                    <td style={{ textAlign: 'left' }}>
                                        <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center' }}>
                                            <ExpandMoreIcon sx={{ fontSize: 18, color: TEXT.muted, transform: isOpen ? 'rotate(180deg)' : 'none', transition: 'transform 180ms' }} />
                                            <Box>
                                                <Typography sx={{ fontSize: 14, fontWeight: 800, color: TEXT.primary, lineHeight: 1.2 }}>{s.tableKey}</Typography>
                                                <Typography sx={{ fontSize: 11, color: TEXT.faint }}>{s.shoeId}</Typography>
                                            </Box>
                                        </Stack>
                                    </td>
                                    <Box component="td" sx={{ textAlign: 'left !important', color: TEXT.secondary, fontSize: 13 }}>{clock(s.start)}–{clock(s.end)}</Box>
                                    <Box component="td" sx={{ color: TEXT.secondary, fontSize: 13 }}>#{s.firstHand}</Box>
                                    <Box component="td" sx={{ color: TEXT.secondary, fontSize: 13 }}>{s.hands}</Box>
                                    {TYPES.map((t) => <td key={t}><Cell c={s.cells[t]} /></td>)}
                                    <Box component="td" sx={{ fontSize: 14, fontWeight: 800, color: signColor(s.total.result) }}>{money(s.total.result)}</Box>
                                    <Box component="td" sx={{ fontSize: 13, color: TEXT.secondary }}>{money(s.total.theo)}</Box>
                                    <Box component="td" sx={{ fontSize: 13, color: TEXT.primary }}>{plain(s.total.avgBet)}</Box>
                                    <Box component="td" sx={{ fontSize: 13, fontWeight: 800, color: edge != null && edge < 0 ? EDGE_COLORS.player : TEXT.primary }}>{pct(edge)}</Box>
                                </Box>
                                {isOpen ? (
                                    <tr>
                                        <td colSpan={COLS} style={{ padding: 0, textAlign: 'left' }}>
                                            <Box sx={{ px: 1.5, pt: 0.5, pb: 1.5 }}>
                                                <HandStrip bets={s.bets} />
                                            </Box>
                                        </td>
                                    </tr>
                                ) : null}
                            </React.Fragment>
                        );
                    })}
                </tbody>
            </Box>
        </Box>
    );
}
```

- [ ] **Step 3: Verify compile** (dev server; no errors).

---

### Task 6: Scatter, YTD trend, bet-type table

**Files:**
- Create: `src/realtime/components/patron360/BetEdgeScatter.js`
- Create: `src/realtime/components/patron360/YtdTrend.js`
- Create: `src/realtime/components/patron360/BetTypeTable.js`

**Interfaces:**
- Consumes: `Bet[]`, `today` string, `dailySeries` rows, `byBetType` rows (Task 1); `sampleEvery`; format helpers; `useEChart`.
- Produces: `<BetEdgeScatter bets today />`, `<YtdTrend daily today />`, `<BetTypeTable rows />`.

- [ ] **Step 1: Create `BetEdgeScatter.js`**

```js
// Every bet as a dot: how big (y) against the house edge when he placed
// it (x). A counter's dots climb as they move left into the magenta zone.

import React, { useMemo, useState } from 'react';
import { Box, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material';
import { PATRON_360 } from '../../constants/rtConfig';
import { TEXT, ACCENT } from '../../constants/rtTheme';
import { sampleEvery } from '../../utils/patron360';
import useEChart from './useEChart';
import { EDGE_COLORS, pct, plain } from './format';

const GROUPS = [
    { id: 'BANKER', label: 'Banker', types: ['BANKER'] },
    { id: 'PLAYER', label: 'Player', types: ['PLAYER'] },
    { id: 'TIE', label: 'Tie', types: ['TIE'] },
    { id: 'PAIRS', label: 'Pairs', types: ['BANKER_PAIR', 'PLAYER_PAIR'] },
];
const TODAY_COLOR = '#f2c14e';

const segmentedSx = {
    height: 30,
    '& .MuiToggleButton-root': { color: TEXT.muted, borderColor: 'rgba(122,162,247,0.35)', textTransform: 'none', fontSize: 12, fontWeight: 700, px: 1.25 },
    '& .Mui-selected': { color: `${TEXT.primary} !important`, bgcolor: 'rgba(122,162,247,0.24) !important' },
};

export default function BetEdgeScatter({ bets, today }) {
    const [group, setGroup] = useState('BANKER');

    const { option, counts } = useMemo(() => {
        const counts = {};
        for (const g of GROUPS) counts[g.id] = bets.filter((b) => g.types.includes(b.betType) && b.edge != null).length;
        const types = GROUPS.find((g) => g.id === group).types;
        const pts = bets.filter((b) => types.includes(b.betType) && b.edge != null);
        const todayPts = pts.filter((b) => b.date === today).map((b) => [b.edge, b.wager]);
        const prior = sampleEvery(pts.filter((b) => b.date !== today), PATRON_360.SCATTER_MAX_POINTS).map((b) => [b.edge, b.wager]);
        let xMin = 0;
        for (const b of pts) if (b.edge < xMin) xMin = b.edge;
        const zone = xMin < 0 ? {
            markArea: { silent: true, itemStyle: { color: 'rgba(214,92,255,0.09)' }, data: [[{ xAxis: xMin }, { xAxis: 0 }]] },
        } : {};
        return {
            counts,
            option: {
                backgroundColor: 'transparent', animation: false,
                grid: { left: 64, right: 16, top: 34, bottom: 44 },
                legend: { data: ['Earlier this year', 'Today'], top: 0, right: 4, itemWidth: 10, itemHeight: 10, textStyle: { color: TEXT.muted, fontSize: 12 } },
                tooltip: {
                    trigger: 'item', backgroundColor: 'rgba(14,16,28,0.97)', borderColor: 'rgba(122,162,247,0.45)', textStyle: { color: '#fff', fontSize: 12 },
                    formatter: (p) => (Array.isArray(p.value) ? `${p.seriesName}<br/>edge ${pct(p.value[0])} · bet ${plain(p.value[1])}` : ''),
                },
                xAxis: {
                    type: 'value', scale: true, name: 'House edge when the bet was placed', nameLocation: 'middle', nameGap: 28,
                    nameTextStyle: { color: TEXT.muted, fontSize: 12 },
                    axisLabel: { color: TEXT.muted, fontSize: 11, formatter: (v) => `${v}%` },
                    splitLine: { lineStyle: { color: 'rgba(255,255,255,0.06)' } },
                },
                yAxis: {
                    type: 'value', scale: true,
                    axisLabel: { color: TEXT.muted, fontSize: 11, formatter: (v) => plain(v) },
                    splitLine: { lineStyle: { color: 'rgba(255,255,255,0.06)' } },
                },
                series: [
                    {
                        name: 'Earlier this year', type: 'scatter', data: prior, symbolSize: 5,
                        itemStyle: { color: ACCENT, opacity: 0.28 },
                        ...zone,
                        markLine: {
                            silent: true, symbol: 'none', data: [{ xAxis: 0 }],
                            lineStyle: { color: EDGE_COLORS.player, type: 'dashed', width: 1.5 },
                            label: { formatter: '← player edge', color: EDGE_COLORS.player, position: 'insideStartTop', fontSize: 11 },
                        },
                    },
                    {
                        name: 'Today', type: 'scatter', data: todayPts, symbolSize: 8, z: 3,
                        itemStyle: { color: TODAY_COLOR, borderColor: '#0d0e18', borderWidth: 1 },
                    },
                ],
            },
        };
    }, [bets, today, group]);

    const ref = useEChart(option);

    return (
        <Box>
            <ToggleButtonGroup exclusive size="small" value={group} onChange={(_, v) => v && setGroup(v)} aria-label="Bet option" sx={{ ...segmentedSx, mb: 1 }}>
                {GROUPS.map((g) => (
                    <ToggleButton key={g.id} value={g.id} disabled={!counts[g.id]}>{g.label} · {counts[g.id].toLocaleString()}</ToggleButton>
                ))}
            </ToggleButtonGroup>
            <Box ref={ref} role="img" aria-label="Bet size against the house edge at the time of each bet" sx={{ width: '100%', height: 320 }} />
            <Typography sx={{ fontSize: 12, color: TEXT.faint }}>
                Shaded zone: the remaining cards favoured the player. Earlier days are sampled to {PATRON_360.SCATTER_MAX_POINTS.toLocaleString()} dots; today shows every bet.
            </Typography>
        </Box>
    );
}
```

- [ ] **Step 2: Create `YtdTrend.js`**

```js
// Year to date, day by day: his result against theo, plus the running
// gap between them. A gap that keeps widening is skill or information,
// not luck.

import React, { useMemo } from 'react';
import { Box } from '@mui/material';
import { TEXT, STATE } from '../../constants/rtTheme';
import useEChart from './useEChart';
import { money, plain } from './format';

const GAP_COLOR = '#f2c14e';

export default function YtdTrend({ daily, today }) {
    const option = useMemo(() => {
        let run = 0;
        const gap = daily.map((d) => (run += d.result - d.theo));
        return {
            backgroundColor: 'transparent', animation: false,
            grid: { left: 64, right: 64, top: 34, bottom: 30 },
            legend: { data: ['Result', 'Theo', 'Result − theo, running'], top: 0, right: 4, itemWidth: 14, itemHeight: 8, textStyle: { color: TEXT.muted, fontSize: 12 } },
            tooltip: {
                trigger: 'axis', backgroundColor: 'rgba(14,16,28,0.97)', borderColor: 'rgba(122,162,247,0.45)', textStyle: { color: '#fff', fontSize: 12 },
                formatter: (ps) => {
                    const i = ps[0].dataIndex;
                    const d = daily[i];
                    return `<div style="font-weight:800;margin-bottom:4px">${d.date}${d.date === today ? ' · today' : ''}</div>
                        Result ${money(d.result)}<br/>Theo ${money(d.theo)}<br/>Running result − theo ${money(gap[i])}<br/>
                        <span style="opacity:.75">${d.bets} bets · turnover ${plain(d.turnover)}</span>`;
                },
            },
            dataZoom: [{ type: 'inside' }],
            xAxis: {
                type: 'category', data: daily.map((d) => d.date.slice(5)),
                axisLabel: { color: TEXT.muted, fontSize: 11 }, axisTick: { show: false },
                axisLine: { lineStyle: { color: 'rgba(255,255,255,0.15)' } },
            },
            yAxis: [
                { type: 'value', axisLabel: { color: TEXT.muted, fontSize: 11, formatter: (v) => money(v) }, splitLine: { lineStyle: { color: 'rgba(255,255,255,0.06)' } } },
                { type: 'value', axisLabel: { color: GAP_COLOR, fontSize: 11, formatter: (v) => money(v) }, splitLine: { show: false } },
            ],
            series: [
                {
                    name: 'Result', type: 'bar', barMaxWidth: 12,
                    data: daily.map((d) => ({
                        value: d.result,
                        itemStyle: {
                            color: d.result >= 0 ? STATE.positive : STATE.negative, opacity: 0.85,
                            borderColor: d.date === today ? '#ffffff' : 'transparent', borderWidth: d.date === today ? 2 : 0,
                        },
                    })),
                },
                { name: 'Theo', type: 'line', data: daily.map((d) => d.theo), symbol: 'none', lineStyle: { color: '#7dcfff', type: 'dashed', width: 1.5 } },
                { name: 'Result − theo, running', type: 'line', yAxisIndex: 1, data: gap, symbol: 'none', lineStyle: { color: GAP_COLOR, width: 2.4 } },
            ],
        };
    }, [daily, today]);
    const ref = useEChart(option);
    return <Box ref={ref} role="img" aria-label="Daily result against theo this year" sx={{ width: '100%', height: 362 }} />;
}
```

- [ ] **Step 3: Create `BetTypeTable.js`**

```js
// Year to date by bet option. The last two columns are the counting
// question in table form: is his share of MONEY on negative-edge hands
// bigger than his share of BETS on them?

import React from 'react';
import { Box, Typography } from '@mui/material';
import { PATRON_360 } from '../../constants/rtConfig';
import { TEXT, STATE, systemLabel } from '../../constants/rtTheme';
import { BET_LABEL, int, money, pct, plain, share, signColor } from './format';

const cellSx = { px: 1, py: 0.7, textAlign: 'right', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', fontSize: 13 };
const HEAD = ['Bet', 'Bets', 'Turnover', 'Share', 'Result', 'Theo', 'House hold', 'Theo hold', 'Wtd edge', 'Avg edge', 'Money on −edge', 'Bets on −edge'];

export default function BetTypeTable({ rows }) {
    const total = rows.reduce((a, r) => a + r.turnover, 0);
    const t = PATRON_360.TESTS.edge_timing;
    return (
        <Box sx={{ overflowX: 'auto' }}>
            <Box component="table" sx={{ width: '100%', minWidth: 980, borderCollapse: 'collapse', '& tbody tr:nth-of-type(odd)': { bgcolor: 'rgba(255,255,255,0.025)' } }}>
                <thead>
                    <tr>{HEAD.map((h, i) => <Box component="th" key={h} sx={{ ...systemLabel, ...cellSx, fontSize: 11, textAlign: i ? 'right' : 'left' }}>{h}</Box>)}</tr>
                </thead>
                <tbody>
                    {rows.map((r) => {
                        const ratio = r.negBetShare ? r.negMoneyShare / r.negBetShare : null;
                        const hot = ratio != null && ratio >= t.flag ? STATE.negative : ratio != null && ratio >= t.watch ? STATE.warning : TEXT.primary;
                        return (
                            <tr key={r.betType}>
                                <Box component="td" sx={{ ...cellSx, textAlign: 'left', fontWeight: 800, color: TEXT.primary }}>{BET_LABEL[r.betType] || r.betType}</Box>
                                <Box component="td" sx={{ ...cellSx, color: TEXT.secondary }}>{int(r.bets)}</Box>
                                <Box component="td" sx={{ ...cellSx, color: TEXT.primary }}>{plain(r.turnover)}</Box>
                                <Box component="td" sx={{ ...cellSx, color: TEXT.secondary }}>{share(total ? r.turnover / total : null)}</Box>
                                <Box component="td" sx={{ ...cellSx, fontWeight: 800, color: signColor(r.result) }}>{money(r.result)}</Box>
                                <Box component="td" sx={{ ...cellSx, color: signColor(r.theo) }}>{money(r.theo)}</Box>
                                <Box component="td" sx={{ ...cellSx, color: TEXT.primary }}>{pct(r.holdPct)}</Box>
                                <Box component="td" sx={{ ...cellSx, color: TEXT.secondary }}>{pct(r.theoHoldPct)}</Box>
                                <Box component="td" sx={{ ...cellSx, color: TEXT.primary }}>{pct(r.weightedEdge)}</Box>
                                <Box component="td" sx={{ ...cellSx, color: TEXT.secondary }}>{pct(r.avgEdge)}</Box>
                                <Box component="td" sx={{ ...cellSx, fontWeight: 800, color: hot }}>{share(r.negMoneyShare)}</Box>
                                <Box component="td" sx={{ ...cellSx, color: TEXT.secondary }}>{share(r.negBetShare)}</Box>
                            </tr>
                        );
                    })}
                </tbody>
            </Box>
            <Typography sx={{ mt: 0.75, fontSize: 11, color: TEXT.faint }}>
                Money on −edge highlights when it is {t.watch}× (watch) or {t.flag}× (flag) his share of bets on −edge.
            </Typography>
        </Box>
    );
}
```

- [ ] **Step 4: Verify compile** (dev server; no errors).

---

### Task 7: Overlay container `RtPatron360`

**Files:**
- Create: `src/realtime/components/patron360/RtPatron360.js`

**Interfaces:**
- Consumes: `fetchPatronBets` (Task 2), `buildPatron360` (Task 1), all section components (Tasks 4–6), `CARD_TIERS` (`src/live/constants/winPalette`), format helpers.
- Produces: `<RtPatron360 open patronId patronRow onClose />` (default export).

- [ ] **Step 1: Create the file**

```js
// Player 360 — surveillance case file.
// ====================================
// Spec: docs/superpowers/specs/2026-09-25-patron-360-redesign-design.md
//
// Full-screen overlay over the floor. Verdict first, then the evidence
// behind it: the six tests, today against his normal, today shoe by
// shoe (with the hand strip), bet size vs edge, and the year so far.
// Bets are fetched once per opening — never polled.

import React, { forwardRef, useEffect, useMemo, useState } from 'react';
import { Box, Button, ButtonBase, Dialog, Skeleton, Slide, Stack, Typography, useMediaQuery } from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import { CARD_TIERS } from '../../../live/constants/winPalette';
import { fetchPatronBets } from '../../utils/rtDataSource';
import { buildPatron360 } from '../../utils/patron360';
import { SURFACE, TEXT, STATE, ACCENT, systemLabel } from '../../constants/rtTheme';
import EvidencePanel from './EvidencePanel';
import NormalCompare from './NormalCompare';
import ShoeGrid from './ShoeGrid';
import BetEdgeScatter from './BetEdgeScatter';
import YtdTrend from './YtdTrend';
import BetTypeTable from './BetTypeTable';
import { LEVEL_COLOR } from './format';

const SlideUp = forwardRef(function SlideUp(props, ref) {
    return <Slide direction="up" ref={ref} {...props} />;
});

const panelSx = { borderRadius: 2, border: `1px solid ${SURFACE.panelBorder}`, bgcolor: SURFACE.panel, p: 1.75, minWidth: 0 };
const raisedSx = { ...panelSx, border: `1px solid ${SURFACE.raisedBorder}`, bgcolor: SURFACE.raised };
const skeletonSx = { bgcolor: 'rgba(255,255,255,0.05)', borderRadius: 2 };

const duration = (m) => (m == null || !Number.isFinite(Number(m)) ? '—'
    : Number(m) < 60 ? `${Math.round(m)}m` : `${Math.floor(m / 60)}h ${String(Math.round(m % 60)).padStart(2, '0')}m`);

function Section({ title, sub, raised, children }) {
    return (
        <Box component="section" sx={raised ? raisedSx : panelSx}>
            <Stack direction="row" sx={{ alignItems: 'baseline', columnGap: 1.5, rowGap: 0.25, mb: 1.25, flexWrap: 'wrap' }}>
                <Typography component="h3" sx={{ fontSize: 15, fontWeight: 800, color: TEXT.primary }}>{title}</Typography>
                {sub ? <Typography sx={{ fontSize: 12, color: TEXT.faint }}>{sub}</Typography> : null}
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
                borderRadius: 1, transform: 'rotate(-2deg)', fontSize: 26, fontWeight: 900, letterSpacing: 3, lineHeight: 1.15,
                whiteSpace: 'nowrap',
            }}>
                {verdict ? verdict.level : '· · ·'}
            </Box>
            <Box sx={{ maxWidth: 340 }}>
                <Typography sx={systemLabel}>Assessment</Typography>
                <Typography sx={{ fontSize: 13, fontWeight: 600, color: TEXT.secondary, lineHeight: 1.35 }}>
                    {verdict ? verdict.reason : 'Loading bets…'}
                </Typography>
            </Box>
        </Stack>
    );
}

function Header({ patronId, patronRow, verdict, source, onClose }) {
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
                        <Typography sx={systemLabel}>Player 360</Typography>
                        <Typography id="p360-title" component="h2" sx={{ fontSize: 26, fontWeight: 800, color: TEXT.primary, lineHeight: 1.1 }}>{patronId}</Typography>
                        <Typography sx={{ fontSize: 12, color: TEXT.faint }}>
                            <Box component="span" sx={{ color: tier.accent, fontWeight: 700 }}>{tier.label}</Box>
                            {` · ${p.segment || '—'} · ${p.current_table_key ? `seat ${p.current_seat ?? '—'} at ${p.current_table_key}` : 'not seated'} · on floor ${duration(p.sign_in_mins_ago)}`}
                        </Typography>
                    </Box>
                </Stack>
                {source ? (
                    <Box sx={{ px: 1.1, py: 0.5, borderRadius: 1, border: `1px solid ${source.live ? STATE.positiveBorder : 'rgba(255,255,255,0.14)'}`, bgcolor: source.live ? STATE.positiveBg : 'rgba(255,255,255,0.04)' }}>
                        <Typography sx={{ fontSize: 12, fontWeight: 700, color: TEXT.secondary, fontVariantNumeric: 'tabular-nums' }}>
                            {source.live ? 'LIVE' : 'MOCK'} · {source.rows.toLocaleString()} bets{source.firstDate ? ` since ${source.firstDate}` : ''}
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
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: '5fr 7fr' }, gap: 1.5 }}>
                <Skeleton variant="rectangular" height={460} sx={skeletonSx} />
                <Skeleton variant="rectangular" height={460} sx={skeletonSx} />
            </Box>
            <Skeleton variant="rectangular" height={260} sx={skeletonSx} />
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: '1fr 1fr' }, gap: 1.5 }}>
                <Skeleton variant="rectangular" height={400} sx={skeletonSx} />
                <Skeleton variant="rectangular" height={400} sx={skeletonSx} />
            </Box>
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

function Body({ model }) {
    const { today, todayBets, todaySummary, typical, ytdSummary, shoesToday, byType, daily, bets, tests } = model;
    return (
        <Stack spacing={1.5}>
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: '5fr 7fr' }, gap: 1.5, alignItems: 'start' }}>
                <Section title="Evidence" sub="Each test checks one pattern; the assessment counts the flags" raised>
                    <EvidencePanel tests={tests} />
                </Section>
                <Section title="Today vs his normal" sub={typical ? `Typical day = median of ${typical.days} earlier days this year` : 'No earlier days this year to compare with'}>
                    <NormalCompare today={todaySummary} typical={typical} ytd={ytdSummary} />
                </Section>
            </Box>
            <Section
                title="Today by shoe"
                sub={shoesToday.length ? `${shoesToday.length} shoe${shoesToday.length === 1 ? '' : 's'} · ${todayBets.length} bets · click a shoe for its hand strip` : null}
                raised
            >
                <ShoeGrid shoes={shoesToday} />
            </Section>
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: '1fr 1fr' }, gap: 1.5, alignItems: 'start' }}>
                <Section title="Bet size vs edge" sub="Each dot is one bet">
                    <BetEdgeScatter bets={bets} today={today} />
                </Section>
                <Section title="Year to date by day" sub={`${daily.length} days played · + = patron won`}>
                    <YtdTrend daily={daily} today={today} />
                </Section>
            </Box>
            <Section title="Year to date by bet option">
                <BetTypeTable rows={byType} />
            </Section>
        </Stack>
    );
}

export default function RtPatron360({ open, patronId, patronRow, onClose }) {
    const [data, setData] = useState({ id: null, rows: null, live: false, error: null, loading: false });
    const [attempt, setAttempt] = useState(0);
    const reducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)');

    useEffect(() => {
        if (!open || !patronId) return undefined;
        let cancelled = false;
        setData({ id: patronId, rows: null, live: false, error: null, loading: true });
        fetchPatronBets(patronId).then((res) => {
            if (!cancelled) setData({ id: patronId, rows: res.rows, live: res.live, error: res.error, loading: false });
        });
        return () => { cancelled = true; };
    }, [open, patronId, attempt]);

    const model = useMemo(() => (data.rows && data.rows.length ? buildPatron360(data.rows) : null), [data.rows]);
    const ready = data.id === patronId && !data.loading && data.rows != null;

    let body;
    if (!ready) body = <Loading />;
    else if (data.error) {
        body = (
            <Message
                title={`Couldn't load ${patronId}'s bets`}
                body={`The bets endpoint didn't answer (${data.error}). Check the backend or REACT_APP_RT_PATRON_BETS_URL, then retry.`}
                action={<Button variant="outlined" onClick={() => setAttempt((n) => n + 1)} sx={{ color: ACCENT, borderColor: ACCENT, textTransform: 'none', fontWeight: 700 }}>Retry</Button>}
            />
        );
    } else if (!model) body = <Message title={`No bets recorded for ${patronId} this year`} />;
    else body = <Body model={model} />;

    const source = ready && !data.error ? { live: data.live, rows: data.rows.length, firstDate: model ? model.firstDate : null } : null;

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
            <Header patronId={patronId} patronRow={patronRow} verdict={ready && model ? model.verdict : null} source={source} onClose={onClose} />
            <Box sx={{ px: { xs: 1.5, md: 2.5 }, py: 2, width: '100%', maxWidth: 2000, mx: 'auto', boxSizing: 'border-box' }}>
                {body}
            </Box>
        </Dialog>
    );
}
```

- [ ] **Step 2: Verify compile** (dev server; no errors).

---

### Task 8: Wire into the dashboard

**Files:**
- Modify: `src/realtime/RealtimeDashboard.js` (lines 10, 26, 86, 373–392)
- Modify: `src/realtime/components/RtPatronPanel.js` (imports; signature line 90; button lines 188–195)
- Delete: `src/realtime/components/RtPatronInvestigation.js`

**Interfaces:**
- Consumes: `RtPatron360` (Task 7).
- Produces: `RtPatronPanel` prop `onOpen360` replaces `onToggleFull` / `fullOpen`.

- [ ] **Step 1: RtPatronPanel**

Replace `import ExpandMoreIcon from '@mui/icons-material/ExpandMore';` with `import OpenInFullIcon from '@mui/icons-material/OpenInFull';`.

Signature: replace `onToggleFull, fullOpen, onClear` with `onOpen360, onClear`.

Replace the button block (the final `<ButtonBase onClick={onToggleFull} …>…</ButtonBase>`) with:

```jsx
            <ButtonBase
                onClick={onOpen360}
                aria-haspopup="dialog"
                sx={{ alignSelf: 'flex-start', gap: 0.9, px: 1.75, py: 1, borderRadius: 1.5, border: '1px solid rgba(122,162,247,0.5)', bgcolor: 'rgba(122,162,247,0.1)', color: ACCENT, fontSize: 14, fontWeight: 800, '&:hover': { bgcolor: 'rgba(122,162,247,0.18)' }, '&.Mui-focusVisible': { outline: `2px solid ${ACCENT}`, outlineOffset: 2 } }}
            >
                <OpenInFullIcon sx={{ fontSize: 17 }} />
                Open Player 360
            </ButtonBase>
```

Also update the header comment line 4–5: "The full Player 360 case file opens one click away as an overlay."

- [ ] **Step 2: RealtimeDashboard**

- Line 10 comment: `//   full Player 360 (on demand) · floor context (collapsed)` → `//   Player 360 overlay (on demand) · floor context (collapsed)`.
- Line 26: `import RtPatronInvestigation from './components/RtPatronInvestigation';` → `import RtPatron360 from './components/patron360/RtPatron360';`
- Line 86: `const [showFull360, setShowFull360] = useState(false);` → `const [show360, setShow360] = useState(false);` and immediately after the trail effect (after line 216) add:

```js
    // A different patron closes the case file rather than swapping it underneath.
    useEffect(() => { setShow360(false); }, [selectedPatronId]);
```

- `RtPatronPanel` props: replace `onToggleFull={() => setShowFull360((v) => !v)}` and `fullOpen={showFull360}` with `onOpen360={() => setShow360(true)}`; in `onClear` replace `setShowFull360(false)` with `setShow360(false)`.
- Replace the whole `<Collapse in={showFull360 && !!selectedPatronId} …>…</Collapse>` block with:

```jsx
                <RtPatron360
                    open={show360 && !!selectedPatronId}
                    patronId={selectedPatronId}
                    patronRow={patronRow}
                    onClose={() => setShow360(false)}
                />
```

- [ ] **Step 3: Delete** `src/realtime/components/RtPatronInvestigation.js`, then grep `src` for `RtPatronInvestigation` — expect 0 matches.

- [ ] **Step 4: Run the full realtime suite**

Run: `$env:CI='true'; npx react-scripts test --watchAll=false src/realtime`
Expected: all suites pass.

---

### Task 9: Visual QA (frontend-design + ui-ux-pro-max pass)

- [ ] **Step 1:** Open `http://localhost:3000/#/realtime` at 1680×1050. Select a patron (Patrons tab row), click **Open Player 360**. Check: overlay slides up, header + stamp render, all six sections render with data, no console errors.
- [ ] **Step 2:** Find a mock counter (any `PID-1xxxx` where the stamp reads ACTION — iterate Patrons tab rows) and confirm the hand strip shows tall magenta bars and the scatter's dots climb into the shaded zone.
- [ ] **Step 3:** Interactions: click another shoe row → its strip opens; keyboard Enter on a row; scatter group toggle; Esc closes and focus returns to the button.
- [ ] **Step 4:** 1280×800 and 800×900: sections collapse to one column below `lg`; shoe grid scrolls inside its panel; `document.documentElement.scrollWidth === innerWidth`.
- [ ] **Step 5:** Error state: temporarily call with a bad URL via `REACT_APP_RT_PATRON_BETS_URL` is not practical in dev — instead verify by code review that `data.error` renders the Retry message; Retry increments `attempt`.
- [ ] **Step 6:** Fix anything found, re-run the suite, reset viewport to desktop.
