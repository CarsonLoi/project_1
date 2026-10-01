# Player 360 — side-bet advantage redesign

**Date:** 2026-09-26
**Supersedes:** the section layout of `2026-09-25-patron-360-redesign-design.md` (overlay shell,
verdict stamp and failure behaviour are kept).
**Scope:** `src/realtime/components/patron360/`, `src/realtime/utils/patron360.js`,
`src/realtime/utils/patronBetsMock.js`, `src/realtime/utils/rtDataSource.js`, `rtConfig.js`,
shared roads for the shoe board, contract doc.

## Purpose

Decide whether a patron takes advantage, above all on **side bets**: when a bet option's live house
edge turns negative (the cards favour the player), does this patron start betting it, and bigger?
The previous 360 showed too much general information; this one shows every shoe the patron played,
hand by hand, against the edge of one chosen bet option.

## Decisions (from brainstorming)

| Question | Decision |
|---|---|
| Edge data | Database supplies the live edge for **every hand of every shoe the patron played**, one row per shoe per hand, one column per bet option |
| Shoe range | Date range, **default YTD**; quick ranges Today · 7 days · 30 days · YTD, plus custom From–To |
| Layout | Heatmap-first (approach A) |
| Old sections | Removed: today-vs-normal, YTD trend, bet-edge scatter, bet-type table, today shoe grid, hand strip |
| Single shoe selected | Also show the trend board (roads + bead plate), patron-bet hands highlighted |

## 1. Bet options

Ten options, configured in `PATRON_360.BET_OPTIONS` (`rtConfig.js`), in chip order:
`BANKER, PLAYER, TIE, BTG, STG, BD, SD, SL7, PPL, L6`. Each has `code`, `name`, `edgeKey`
(→ feed column `house_edge_<edgeKey>`), `side` (false for Banker/Player), `color` (chip/bar colour,
matching the reference screenshot), `theo` (nominal house edge %, the dashed theo line) and `var`
(result variance per unit stake, for the luck z-score). Banker/Player/Tie use 8-deck figures;
**side-bet `theo`/`var` are placeholders** to be set from the casino's pay tables (SL7 theo = 14.8
per the reference chart).

## 2. Data — two on-demand feeds, per patron, per date range

Both are fetched in parallel when the 360 opens or the range changes; never polled.

**§8 `GET /realtime/patron/{id}/bets?from=YYYY-MM-DD&to=YYYY-MM-DD`** — unchanged 15 columns, now
range-filtered, `bet_type` in the ten codes above.

**§9 (new) `GET /realtime/patron/{id}/shoe-edges?from&to`** — one row per hand of every shoe in which
the patron placed at least one bet in the range, **including hands they did not bet**:

| Column | Type | Notes |
|---|---|---|
| `gaming_date` | DATE | |
| `table_id` | TEXT | |
| `gametype` | TEXT | `BA` / `NC` |
| `shoe_id` | TEXT | |
| `hand_no` | INTEGER | 1-based |
| `game_time` | TIMESTAMP | |
| `result` | TEXT | `B` / `P` / `T` |
| `banker_pair`, `player_pair` | SMALLINT | optional 0/1, for the road |
| `house_edge_banker … house_edge_l6` | NUMERIC | 10 columns; house edge % of that option given the cards left **before** this hand; casino perspective; null = not offered |

Config: `RT_ENDPOINTS.patronShoeEdges = REACT_APP_RT_PATRON_SHOE_EDGES_URL || sibling('/patron/{id}/shoe-edges')`.
A configured endpoint that fails returns `{ rows: [], error }` → error + Retry, never mock data.

**Mock:** `generateMockPatronHistory(patronId, { now })` → `{ bets, shoeEdges }` for the year, memoised,
filtered by range in the data source. Shoes are 70–80 hands; each option's edge follows a random walk
around its theo whose spread grows through the shoe (so negative edges appear mostly late, as in the
reference chart). The patron sits for a stretch of each shoe. **1 patron in 8** is a counter with a
favourite side bet that they bet (bigger) mainly when its edge is negative.

## 3. Model — `utils/patron360.js` (pure, unit tested)

- `currentGamingDate(now)`, `rangeFor(id, now)` (`today | 7d | 30d | ytd`), `RANGES`.
- `normalizeBets(rows)`, `normalizeShoeEdges(rows) → Map<shoeKey, {shoeKey, tableKey, shoeId, date, start, hands:[{handNo, time, result, bankerPair, playerPair, edge:{CODE: number|null}}]}>`.
- `buildShoeViews(shoes, bets)` → views (newest first) adding `bets`, `betsByHand: Map<handNo, Map<code,{wager,casinoWin,theoWin}>>`,
  `firstHand`/`lastHand` (the patron's **seat window** = first to last hand they bet anything), `maxHand`.
  Shoes with bets but no edge rows are kept with `hands: []`, `missingEdges: true`.
- `inWindow(view, handNo)`.
- `optionShoeStats(view, code)` → `{ bets, turnover, result, negMoney, negMoneyShare, negHands, negHandsBet, windowHands }` (window hands only).
- `optionEvidence(views, code)` over all window hands with a known edge for `code`:
  - **Selective entry** = (bets on −edge hands ÷ −edge hands) ÷ (bets on other hands ÷ other hands); ∞ when they only bet −edge hands. Needs ≥10 −edge hands, ≥10 other hands, ≥5 bets.
  - **Bet ramp** = avg wager on −edge hands ÷ avg wager on other hands. Needs ≥5 bets each side.
  - **Money on −edge** = (money on −edge hands ÷ all money on the option) ÷ (−edge hands ÷ window hands). Needs ≥10 bets and ≥10 −edge hands.
  - **Result vs theo** = (theo − casino_win summed) ÷ √Σ(wager²·var). Needs ≥30 bets.
  - Thresholds (watch / flag): entry 2 / 4, ramp 1.5 / 2.5, money 1.5 / 2.5, luck 2 / 3. `insufficient` below the sample minimum.
- `evidenceFor(views)` → one row per option the patron bet: side bets first by turnover, then Banker/Player.
- `verdictFrom(rows)` → **ACTION** if any entry/ramp/money test flags, or ≥2 flags in total; **WATCH** on one flag or ≥2 watches; **CLEAR** otherwise; **NO DATA** if everything is insufficient. Reason names option + test, e.g. "2 flags: SL7 selective entry, SL7 money on −edge".
- `defaultOption(rows)` = highest-turnover side bet, else the first row, else `BANKER`.
- `heatmapRows(views, code, { onlyBet, sort })` → `[{ view, stats }]`; `onlyBet` (default true) drops shoes with no bet on the option; `sort` `suspicious` (money on −edge desc, then share, then newest) or `newest`.
- `buildPatron360(betRows, edgeRows)` → `{ bets, views, evidence, verdict, defaultOption }`.

## 4. UI — full-screen overlay (`RtPatron360`)

Header (sticky): avatar · patron · tier/segment/seat · **range bar** (Today · 7 days · 30 days · YTD ·
From/To date inputs) · source chip (LIVE/MOCK · bets · shoes) · verdict stamp · close.

1. **Advantage evidence** (`AdvantageTable`): one row per option used — code + name, bets, turnover,
   result (patron perspective), then the four tests, each a state chip + value + a plain-language line
   ("bets 62% of −edge hands vs 4% of others"). Clicking a row selects that option.
2. **Shoes × hands · \<option\>** (`OptionChips` + `ShoeHeatmap`): option chips (10, colour-coded,
   showing turnover; disabled when unused). Heatmap rows = shoes (label `MM-DD · table · shoe`),
   columns = hand 1…max. Cell colour = the option's edge in five bands relative to its theo
   (below −max(1, theo/3) hot magenta · to 0 magenta · 0–½theo amber · ½theo–theo slate · ≥theo dark).
   Outside the seat window cells are dimmed. A dot = the patron bet the option there: size ∝ √wager,
   filled white = patron won, hollow = casino won. Controls: sort (Most suspicious / Newest), "Only
   shoes with bets on this option" switch. First 40 rows, then "Show all N shoes". Click a row (cell or
   label) = select just that shoe; Ctrl/Shift-click = add/remove (max 8). Selected row labels are
   accent-bold with a ▸ marker.
3. **Selected shoes · N**: a multi-select dropdown mirrors the selection (keyboard path).
   - Left **House edge: \<option name\>** (`EdgeCurves`): one line per selected shoe (distinct colours),
     dashed theo line with label, 0% line, magenta-tinted area below 0; markers on hands the patron
     bet the option — filled = patron won, hollow = casino won, size ∝ wager. Axis tooltip lists each shoe.
   - Right **Hand by hand wager** (`WagerBars`): the focused shoe (colour tabs when several are
     selected) — bars stacked by bet option in option colours; option filter chips (click to hide/show).
   - **Exactly one shoe selected:** **Trend board** (`ShoeRoads`, shared with the shoe board): Big Road,
     derived roads and bead plate; gold ring = hand the patron bet; option-colour ring = hand they bet
     the selected option.

Default on open: range YTD, option = `defaultOption`, selection = top heatmap row (once per data/option).
States: skeleton while loading; error + Retry; "No bets for \<id\> in this range".

## 5. Shared roads

`components/ShoeRoads.js` takes the roads block out of `RtShoeBoard` (same look), adding
`markedHands`/`emphasisHands` highlight sets. `buildBigRoad` cells gain `handNos` (the hands merged
into the cell, ties included) so Big Road cells can be highlighted; nothing else reads cell keys.

## 6. Removed

`EvidencePanel`, `NormalCompare`, `ShoeGrid`, `HandStrip`, `BetEdgeScatter`, `YtdTrend`, `BetTypeTable`.

## 7. Testing

- `patron360.test.js`: dates/ranges, normalisation, views and seat window, shoe stats, each test's
  value/threshold/sample guard, verdict rules, default option, heatmap filter/sort, build.
- `patronBetsMock.test.js`: deterministic; contract columns for both feeds; every hand of each shoe
  present; counter → ACTION, non-counter → not ACTION; data source filters by range.
- Browser QA at 1680 / 1280 / 800: heatmap click + Ctrl-click, option switch, multi-shoe curves, tabs,
  single-shoe trend board, range change, Esc.
