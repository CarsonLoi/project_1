# Patron 360 redesign — design

**Date:** 2026-09-25
**Scope:** `src/realtime` (Real-time Floor · Surveillance). Replaces the full Player 360 section
(`RtPatronInvestigation` → Live dashboard's `Player360Panel`) with a purpose-built surveillance
case file. The quick patron panel (`RtPatronPanel`) stays as the at-a-glance view.

## Purpose

Answer one question for a selected patron: **is this player suspicious enough to action?**
The 360 shows the evidence (today's play by shoe and bet option, theo vs actual, average bet,
how bet size relates to the live card-composition edge, and the same measures year to date) and
turns it into a transparent **CLEAR / WATCH / ACTION** level built from named tests.

## Decisions (from brainstorming)

| Question | Decision |
|---|---|
| YTD grain | One row **per hand per bet**, year to date, including today |
| Edge per hand | Database supplies `edge_at_bet` per row (computed in the pipeline) |
| Placement | Full-screen overlay opened from the patron panel; Esc / close returns to the floor |
| Verdict | Evidence checklist of named tests → level; no opaque score |
| Layout | "Case file": verdict first, then evidence sections, one scroll |

## 1. Data — new endpoint `GET /realtime/patron/{id}/bets`

One row per bet placed by the patron, from 1 January of the current year through now. Fetched
**once when the 360 opens** (and on Retry), never polled.

| Column | Type | Notes |
|---|---|---|
| `gaming_date` | DATE | Gaming day (starts 07:00) |
| `game_time` | TIMESTAMP | When the hand was dealt |
| `table_id` | TEXT | |
| `gametype` | TEXT | `BA` / `NC` |
| `shoe_id` | TEXT | |
| `game_id` | TEXT | The hand |
| `hand_no` | INTEGER | 1-based position in the shoe |
| `seat` | INTEGER | 1–7 |
| `dealer` | TEXT | optional |
| `result` | TEXT | `B` / `P` / `T` |
| `bet_type` | TEXT | `BANKER`, `PLAYER`, `TIE`, `BANKER_PAIR`, `PLAYER_PAIR` (others pass through) |
| `wager` | NUMERIC | |
| `casino_win` | NUMERIC | Casino perspective (negative = patron won) |
| `theo_win` | NUMERIC | Casino perspective, as the warehouse computes it (nominal edge × wager) |
| `edge_at_bet` | NUMERIC | House edge **%** for this `bet_type` given the cards remaining in the shoe just before this hand. Positive = house favoured (Banker ≈ +1.06). Negative = player advantage |

- Config: `RT_ENDPOINTS.patronBets = REACT_APP_RT_PATRON_BETS_URL || sibling('/patron/{id}/bets')`.
- Backend: `select * from <table> where player_id = $1 and gaming_date >= date_trunc('year', current_date)`.
- The contract doc gains a new §8 for this endpoint ("Resolved decisions" becomes §9); the existing
  §6 (`/realtime/patron/{id}`) is unchanged and still feeds the quick panel's "Today's trail".
- Volume: a heavy regular ≈ 50–100k rows/year. Acceptable for one on-demand fetch; the 360
  aggregates in one pass and samples charts.

### Mock (no URL configured)

`generateMockPatronBets(patronId, { now })` in `src/realtime/utils/patronBetsMock.js`,
deterministic per patron:
- Plays on ~35% of past days this year, plus today; 1–4 shoes per day; joins each shoe at a random
  hand and plays 12–50 hands.
- `edge_at_bet` = nominal edge + noise whose spread grows through the shoe (main bets
  σ = 0.25 + 0.012·hand_no; Tie σ = 2 + 0.2·hand_no; pairs σ = 1.5 + 0.15·hand_no).
- **1 patron in 8** (by `hashKey(patronId) % 8 === 0`) is a *counter*: bet size scales up when
  `edge_at_bet` is below nominal, and outcome odds shift slightly toward him on those hands — so every
  level is demonstrable offline.
- `theo_win = wager × nominal_edge / 100`; `casino_win` via the existing `settleBet`.
- If a configured endpoint fails: `{ rows: [], live: false, error }` — never mock data for a real patron.

## 2. Calculations — `src/realtime/utils/patron360.js` (pure, unit tested)

All money in the UI is **patron perspective** (+ = patron won), labelled on every figure.

- `currentGamingDate(now)` — local date of `now − 7h`, `YYYY-MM-DD`.
- `normalizeBets(rows)` → `{ date, time, tableKey, shoeId, shoeKey, gameId, handNo, seat, dealer, result, betType, wager, casinoWin, theoWin, edge }` (drops rows with no wager).
- `summarize(bets)` → `{ bets, hands, shoes, tables, days, turnover, avgBet, minBet, maxBet,
  result, theo, luck, cardTheo, holdPct, theoHoldPct, avgEdge, weightedEdge, sideShare }` where
  `result = −Σcasino`, `theo = −Σtheo`, `luck = result − theo`, `cardTheo = −Σ(wager·edge/100)`,
  `weightedEdge = Σ(wager·edge)/Σwager`, `sideShare` = share of turnover on non-main bets.
- `byBetType(bets)` → rows per bet type: `summarize` plus `negBetShare` (share of bets with edge < 0)
  and `negMoneyShare` (share of turnover with edge < 0).
- `byShoe(bets)` → per shoe: `{ shoeKey, tableKey, shoeId, start, end, firstHand, lastHand, hands,
  cells: { [betType]: { wager, result, bets } }, total: summarize(...) , bets }`, newest first.
- `dailySeries(bets)` → per gaming day `{ date, turnover, result, theo, bets, avgBet, sideShare }`, ascending.
- `spearman(xs, ys)` — rank correlation with average ranks for ties.
- `sampleEvery(arr, max)` — deterministic stride sampling.

### Evidence tests — `evaluateTests(bets, { now })`

Each test returns `{ id, label, question, state, today: { value, n } | null, ytd: { value, n } | null,
worstBetType, detail }`, `state ∈ clear | watch | flag | insufficient`. For tests with both scopes,
`state` = the more severe of the two scopes that have enough data. Thresholds live in
`PATRON_360` in `rtConfig.js`.

| id | Label | Value | Min sample | Watch / Flag |
|---|---|---|---|---|
| `edge_timing` | Bets into the edge | per bet type: `negMoneyShare ÷ negBetShare`; the max across types | ≥20 bets with edge<0 and ≥20 with edge≥0 in that type | ≥1.5 / ≥2.5 |
| `bet_ramp` | Bet ramp | per bet type: avg bet when edge<0 ÷ avg bet when edge≥0; the max | same | ≥1.5 / ≥2.5 |
| `edge_corr` | Bet vs edge correlation | per bet type Spearman(wager, edge); the min (most negative) | ≥100 bets in that type | ≤−0.20 / ≤−0.35 |
| `luck` | Result vs theo | `z = luck ÷ √Σ(wager²·VAR[type])` | ≥50 bets | ≥2 / ≥3 |
| `vs_normal` | Today vs his normal | max of (today avg bet ÷ median prior daily avg bet) and (today side share ÷ median prior side share, only if prior median > 0) — today scope only | ≥5 prior days and ≥20 bets today | ≥2 / ≥3 |
| `spread` | Bet spread | max ÷ min wager on main bets (BANKER/PLAYER) today — today scope only | ≥30 main bets today | ≥8 / ≥15 (flag = existing BET_SPREAD alert) |

`VAR` per unit stake: BANKER 0.860, PLAYER 0.905, TIE 6.977, BANKER_PAIR / PLAYER_PAIR 9.953, other 1.

### Verdict — `verdictFrom(tests)`

- **ACTION** if any of `edge_timing`, `bet_ramp`, `edge_corr` is `flag`, or ≥2 tests are `flag`.
- **WATCH** if exactly one test is `flag`, or ≥2 tests are `watch`.
- **CLEAR** otherwise.
- **NO DATA** if every test is `insufficient`.
- `reason`: "N flags: <labels>" / "N watch: <labels>" / "No test above threshold" / "Not enough bets to judge".

## 3. UI — overlay `RtPatron360`

MUI `Dialog fullScreen`, page background `SURFACE.page`, scroll inside. Opened by
**"Open Player 360"** in `RtPatronPanel` (replaces the expand toggle). Close button + Esc.
Transition: slide up 220ms; 0ms under `prefers-reduced-motion`. Focus returns to the trigger.

Visual direction — a **surveillance case file**: the same terminal tokens as the dashboard
(`rtTheme`), no new fonts. The single signature element is the **hand strip** (§3.4): bets
drawn as bars, coloured by the live edge, using the same magenta family the floor map uses for
negative edge, so "magenta = the cards favour the player" means one thing across the page.

Sections, top to bottom (all in `src/realtime/components/patron360/`):

1. **Header** (sticky): tier avatar, patron ID, tier · segment · current seat/table · time on floor,
   data source chip (LIVE / MOCK, rows loaded, date range), close button. Right side: the **verdict
   stamp** — large level word in its colour (ACTION = `STATE.negative`, WATCH = `STATE.warning`,
   CLEAR = `STATE.positive`, NO DATA = `TEXT.muted`) with the reason line.
2. **Evidence** (`EvidencePanel`, left, 5/12) — six rows: state chip (text + colour, never colour
   alone), label, the question it answers, today value, YTD value, worst bet type, threshold hint.
   **Today vs normal** (`NormalCompare`, right, 7/12) — rows: Hands, Bets, Turnover, Avg bet, Min / max
   bet, Result, Theo, Result − theo, Card-adjusted theo, Hold % vs theo hold %, Money-weighted edge vs
   avg edge, Side-bet share. Columns: Today · Typical day (median of prior days) · YTD total · Today vs
   typical (×ratio or ±delta, highlighted when beyond the `vs_normal` watch ratio).
3. **Today by shoe** (`ShoeGrid`): one row per shoe today — table, shoe, time range, joined at hand #,
   hands; one column per bet type (Banker, Player, Tie, B Pair, P Pair: wager with result beneath,
   coloured by sign; blank when not bet); row totals Result, Theo, Avg bet, Wtd edge. Click a row to
   expand its **hand strip**.
4. **Hand strip** (`HandStrip`, signature): ECharts bars, x = hand no, y = wager, one bar per bet
   (stacked per hand by bet type), colour by `edge_at_bet` on a fixed ramp: ≥ nominal → slate blue,
   0 to nominal → amber, < 0 → magenta (`rgba(214,92,255)`), < −1 → hot magenta (`rgba(255,0,200)`).
   Tooltip: hand, bet type, wager, edge, result.
5. **Bet size vs edge** (`BetEdgeScatter`, left half): x = `edge_at_bet` (%), y = wager; one series
   per main/side group; today's bets full opacity, YTD at 0.25 opacity, YTD sampled to ≤5,000 points;
   vertical marker at 0%. Bet-type toggle (Banker / Player / Tie / Pairs, default Banker).
   **Year to date** (`YtdTrend`, right half): daily bars of result (patron perspective) and theo line,
   plus cumulative result − theo line on a second axis; today's bar outlined.
6. **YTD by bet option** (`BetTypeTable`): bet type, bets, turnover, share, result, theo, hold vs theo
   hold, weighted edge vs avg edge, % money on negative edge vs % bets on negative edge.

States: loading → skeleton blocks in section shapes; error → message with the cause + **Retry**;
empty → "No bets recorded for <id> this year." Today-empty → sections 2–4 say "Not played today".

Responsive: two-column rows collapse to one below `lg`; the shoe grid scrolls horizontally inside
its panel below `md` (the page never scrolls sideways).

## 4. Dashboard wiring

- `RealtimeDashboard`: remove `RtPatronInvestigation` and its `Collapse`; render
  `<RtPatron360 open={show360} patronId patronRow onClose />`. `show360` resets when the patron changes.
- `RtPatronPanel`: button "Open Player 360" (icon `OpenInFull`) calls `onOpen360`.
- `rtDataSource.fetchPatronBets(patronId)` as in §1.
- Delete `src/realtime/components/RtPatronInvestigation.js` (the Live dashboard's `Player360Panel`
  is untouched).

## 5. Testing

- `utils/__tests__/patron360.test.js`: `summarize` signs and hold; `byShoe` grouping and cells;
  `spearman` (perfect ±1, ties); each test's value, sample guard, and thresholds; `verdictFrom` rules;
  `currentGamingDate` across 07:00.
- `utils/__tests__/patronBetsMock.test.js`: deterministic; 15 contract columns; today present; a counter
  patron evaluates to ACTION and a non-counter is not ACTION.
- Visual QA in the browser at 1680, 1280 and 800 px: every section renders, Esc closes, Retry works
  (forced error), no horizontal page scroll.
