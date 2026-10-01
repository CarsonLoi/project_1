# Real-time Floor · Surveillance — redesign

**Date:** 2026-09-25
**Scope:** `src/realtime/` (plus named exports added to `src/trend/components/BaccaratBoard.jsx`)
**Status:** approved in conversation (layout A, side-by-side workspace, hand-level feed with empty-hand rows)

## Goal

Give a surveillance officer a full picture of the floor, a table's current
shoe hand by hand, and any patron, without the productivity clutter the page
inherited. The page answers three questions in order:

1. **Where do I look?** Floor map + rankings + alerts.
2. **What happened at that table?** The current shoe, road and hand by hand, with every bet.
3. **Who is this player?** The patron's day, their bets in this shoe, and the tables they visited.

## Layout (approach A)

```
header · LIVE · refresh · floor tiles (BA+NC only, today)
alert strip (unchanged; click → loads table and/or patron)
┌ floor map (62%) ───────────────────────┐┌ rankings (38%) ───────┐
│ [Win|Hand #|House edge] [Today|Shoe]   ││ tabs as today, larger │
│ ⚙ size  🪑 tooltip (stats ⇄ seats)      ││ type; height = map    │
│ pulsing ring on the inspected table    ││ height, inner scroll  │
└────────────────────────────────────────┘└───────────────────────┘
┌ shoe board (62%) ──────────────────────┐┌ patron panel (38%) ───┐
│ header: table · shoe · dealer · hand # ││ identity · seat · time│
│ shoe pulse: casino net per hand        ││ 4 stat tiles          │
│ roads (Big Road, Big Eye, Small,       ││ bets in this shoe     │
│ Cockroach, bead plate)  │ hand list    ││ today's trail         │
│                         │ + bets       ││ [Full Player 360 ▾]   │
└────────────────────────────────────────┘└───────────────────────┘
▸ Floor context (collapsed): session trend + bet mix
```

The two workspace panels are linked. Picking a **table** (map click, ranking
row, alert, or the board's table picker) fills the left panel. Picking a
**patron** (a bet in a hand, Patrons tab, patron alert) fills the right panel.
When the selected patron has bets in the shown shoe, their hands are
highlighted in the pulse chart and the hand list.

## 1. Header, filters, controls

- Area, Pit, Game and Table Min dropdowns are hidden behind
  `SHOW_SLICERS = false` in `rtConfig.js`. The code stays.
- Game is applied invisibly as `['BA', 'NC']` (`FIXED_GAMES`). Every table
  feed consumer (map, tiles, rankings, alerts) sees BA and NC tables only.
- Auto-refresh moves into the header as a compact control.
- The Detail/Simple tooltip toggle is removed from the control row. Tooltip
  style is chosen on the map instead (see §2).
- Floor tiles are unchanged in content, always "today", computed over BA+NC.

## 2. Floor map

Rendered by a new focused `RtFloorMap.js` (scatter + visualMap + tooltip +
ring + click). `RtScatterHeatmap.js` stays in the tree, unused on this page:
its brush, contour and dimming logic doesn't serve this view, and bolting
click, ring and seat tooltips onto it would make it harder to follow.
Non-BA/NC tables still draw as grey floor context but are not interactive.
Tuple slot **66 = config gametype** (always set) so every drawn table has a
key, including tables with no data.

**KPI selector** replaces the 16-item dropdown with two segmented controls:

| Metric | Today | Current shoe | Scatter dim |
|---|---|---|---|
| Win | day win | shoe win | 18 / 57 |
| Hand # | hands dealt today | latest hand # in shoe | 65 (new) / 61 |
| House edge | live edge | live edge | 40–50 via bet option |

House edge exists only per shoe, so both scopes show the same live value,
labelled "(current shoe)". A bet-option picker (default Lowest) appears only
for House edge. Internally each (metric, scope) pair maps to an existing KPI
key, so the legend, thresholds and tooltip keep working unchanged.

New tuple slot **65 = hands dealt today** (`game_count`), plus a
`'Hands Today'` threshold ramp. Slots 0–64 are not renumbered.

**Overlay buttons** in the map's top-right corner, styled like
`LiveFloorHeatmap.js`, stacked below the ECharts brush toolbox so they don't
collide:

- ⚙ symbol size: popover slider, 1.0×–3.0×, default 2.0× (the current
  multiplier). Passed to the scatter as a prop.
- 🪑 tooltip style: toggles `stats` ⇄ `seats`. Persisted in `localStorage`.

**Tooltips:**

- `stats`: the detail tooltip trimmed to the three metrics, day and shoe side
  by side, plus table, pit and dealer/shoe line.
- `seats`: an SVG table with 7 seats. Occupied seats show patron ID, card-tier
  colour and today's result (patron perspective). Empty seats are outlines.
  Header: table, hand #, shoe win. Occupancy comes from
  `/realtime/patrons` (`current_table_key`, `current_seat`), so no new data
  is needed. Ported from `seatTooltipSvg` in `LiveFloorHeatmap.js`.

**Inspected table:** instead of dimming the floor, the table shown in the
shoe board gets a pulsing ring (an extra `effectScatter` series). The rest of
the floor stays readable. Map click emits `onTableClick(tableKey)`.

## 3. Rankings panel

- Height is locked to the map's height: the panel's content is absolutely
  positioned inside a stretched grid cell, so it adds no intrinsic height
  and scrolls internally. Below `lg` it gets a fixed 520px.
- Type: row names 14px/700, sub-labels 12px, values 16px/800, bars 10px,
  roomier rows. Tabs and alert badges are unchanged.
- Table W/L follows the Today/Shoe toggle (day `win` or `shoe_win`).
- Ranking rows for tables (Table W/L, Edge) set the shoe board's table.

## 4. Shoe board (left workspace)

**Header:** table key and pit, shoe ID, dealer, "Hand N" (latest `hand_no`),
live lowest edge with its bet, shoe casino net vs theo, seated count, and a
table picker (BA+NC tables, alerting tables first).

**Shoe pulse:** a compact ECharts bar chart. X = hand #, y = casino net for
the hand (red below zero), with a cumulative line. When a patron is selected,
their hands get a gold outline. Clicking a bar selects that hand. This
replaces the floor-wide session trend as the main "when did it turn" view,
scoped to the shoe.

**Roads (left, ~58%):** Big Road, Big Eye, Small, Cockroach and bead plate,
rendered with the exported `BaccaratBoard` pieces so they look exactly like
Trend Seeker's board. B/P/T counts sit under the bead plate. Clicking a bead
plate cell selects that hand, and the selected hand is outlined.

**Hand list (right, ~42%):** newest first. Each row shows hand #, result badge
(庄/闲/和 colours), pair dots, bet count, total wager and casino net. The
selected hand expands to its bets: seat, player ID (click opens patron
panel), side, wager, result from the player's perspective. Hands with no bets
show "no bets". Hands whose casino net is below −$20K get a red edge.

## 5. Patron panel (right workspace)

Simplified replacement for the always-open Player 360:

- **Header:** patron ID, card-tier chip, segment, current table and seat,
  time on floor.
- **Tiles:** Today result (patron perspective), turnover, avg bet, bet spread
  (true max÷min when `min_bet`/`max_bet` exist, else CV, labelled which).
- **In this shoe:** the patron's bets in the shown shoe, one row per hand
  (hand #, side, wager, result), taken from the shoe feed. Shows "not playing
  this shoe" otherwise.
- **Today's trail:** tables and shoes played today with hands and net per
  shoe, from `/realtime/patron/{id}`. Clicking a row loads that table into the
  shoe board.
- **Full Player 360** button expands the existing `RtPatronInvestigation`
  below the workspace. It is kept, not deleted.

## 6. Floor context

Session trend and bet mix move into one collapsed strip at the bottom
("Floor context"), closed by default. Components are unchanged.

## 7. Data

New endpoint, added to `docs/realtime-surveillance-data-contract.md` as §7:

`GET /realtime/shoe?gametype=BA&table_id=10065[&shoe_id=…]` — one row per bet
in the table's current shoe (or the given shoe). Hands with no bets appear as
one row with `player_id` null and `wager` 0.

| Column | Type | Notes |
|---|---|---|
| `table_id` | TEXT | |
| `gametype` | TEXT | BA / NC |
| `shoe_id` | TEXT | |
| `game_id` | TEXT | the hand |
| `hand_no` | INTEGER | 1-based position in the shoe |
| `game_time` | TIMESTAMP | when the hand was dealt |
| `result` | TEXT | `B` / `P` / `T` |
| `banker_pair`, `player_pair` | SMALLINT | optional 0/1 |
| `dealer` | TEXT | optional |
| `player_id` | TEXT | null on empty-hand rows |
| `seat` | INTEGER | 1–7 |
| `bet_type` | TEXT | BANKER / PLAYER / TIE / side-bet codes |
| `wager` | NUMERIC | |
| `casino_win` | NUMERIC | casino perspective |

Env: `REACT_APP_RT_SHOE_URL`, default sibling path `/shoe`.

**Fetching:** only the table shown in the shoe board, refreshed on every poll
tick (a few hundred rows). Patron trail uses the existing patron-detail call
when the patron changes.

**Normalisation:** a pure `groupShoeRows(rows)` returns
`{ shoeId, dealer, hands: [{ handNo, gameId, time, result, bankerPair, playerPair, bets: [...] , casinoNet, wager }] }`
sorted by `handNo`, dropping empty-hand bet rows but keeping the hand.

**Mock:** `buildMock` generates each BA/NC table's current shoe from a seed of
`tableKey + shoeId`: results at real odds (B 45.86%, P 44.62%, T 9.52%),
pairs ≈7.5% each, bets from the patrons seated there (from the patron feed's
current table/seat), payouts banker 0.95:1, player 1:1, tie 8:1 with main
bets pushing on a tie. The generated shoe's hands, win, theo and turnover are
written back onto that table's row, so the map's "hand 50" and shoe win match
the board exactly.

## 8. Error and empty states

- No table selected and no alerts: board shows "Pick a table on the map".
- Shoe fetch fails: board keeps the last good shoe with a warning line, or
  shows "Couldn't load this shoe — retrying on the next refresh".
- Shoe has no hands yet: "New shoe — no hands dealt yet".
- Patron not in feed: "Left the floor", with the trail still shown if loaded.

## 9. Testing

Jest unit tests (`react-scripts test`) for the pure pieces:

- `groupShoeRows`: grouping, ordering, empty-hand rows, casino net sums.
- mock shoe generator: deterministic for the same seed, `hand_no` contiguous,
  payouts correct for B, P and T.
- KPI mapping: every (metric, scope) pair resolves to a key with a dim and a
  threshold ramp.

Visual verification in the browser at 1680×1050 and 1280×800: no overlap of
map overlay buttons with the toolbox, rankings panel exactly map height, road
cells crisp, no horizontal page scroll, contrast of new text ≥ 4.5:1.

## Out of scope

- Browsing a table's earlier shoes (the `shoe_id` parameter leaves room).
- Changes to alert rules.
- Deleting Player 360, session trend or bet mix.
