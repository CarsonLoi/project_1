# Player 360 — period summary and step drill-down

Date: 2026-09-26 · Status: approved (demo artifact v4, "go ahead for the development")
Scope: `src/realtime/components/patron360`, `src/realtime/utils`
Reference demo: https://claude.ai/artifact/2po2o3wgLS4wd1UzHFSzaM (`scratchpad/p360-preview/p360-drilldown.html`)

## Problem

The current Player 360 is one long page: a summary, then an "Investigate"
section (all tests, a 64-row heatmap, selected shoes, five roads) about
3,000 px tall. The bet option is picked in three places, a heatmap click
changes a panel far below, and nothing says where you are in the drill-down.

## Goal

Open on a **bet option × period summary** with the KPIs surveillance needs,
then go deeper in a fixed order — Summary → Option → Shoe → Hand — one level
on screen at a time, with a breadcrumb and one-click back.

## Periods

Today · **Last 3 months (default)** · Last 12 months, in the header, applied
to every level. The overlay loads the last 12 months once (bets §8 +
shoe edges §9) and filters in the browser, so switching period is instant.
Last 3 months = from the same calendar day 3 months back; Last 12 months =
from the day after the same date a year back. Switching period keeps the
level when it still exists in the new period, else drops to the nearest
level that does (hand/shoe → option → summary). The header also shows the
period's verdict stamp (ACTION / WATCH / CLEAR / NO DATA).

## Navigation

- Breadcrumb: `Summary › SL7 · Last 3 months › [Compare n shoes ›] Shoe 08-23 · BA|10087 · S2 › Hand #35`.
  Every crumb but the last is a link.
- **Back** button and **Alt+←** go up one level (Hand → Shoe → Compare, when
  it was the way in → Option → Summary). Esc still closes the overlay.
- Prev / Next at the right: sibling option (in the summary's current sort),
  sibling shoe (in the shoe table's current sort), sibling hand.
- Each level change scrolls the overlay to the top.

## Level 1 · Summary

Verdict line: stamp + the worst option ("PPL edge played −0.37% vs theo
10.36%", "55 of 110 PPL bets on −edge hands · 8 of 8 −edge shoes bet") +
"Open PPL →". The worst option is the one furthest below theo relative to
theo, regardless of the table sort.

Table, one row per option he bet in the period, every value in its own
column, grouped headers:

| Group | Columns |
|---|---|
| — | Option (status dot = worst test state, colour chip, code) |
| House edge | Theo edge · Edge played (value + gauge against theo) |
| Involvement | Bets · Involvement · Turnover · Avg bet |
| Shoes | Played · −edge · Bet on −edge |
| Money | Casino Theo · theo edge · Casino Theo · actual edge · Patron Win |
| Trend | 3 periods (edge played Today / 3M / 12M as dots) |

Definitions (per option, over hands inside his seated window):
- **Edge played** = Σ(wager × live edge at that hand) ÷ Σ wager.
- **Involvement** = bets ÷ seated hands.
- **Played** = shoes he sat in; **−edge** = of those, shoes where this
  option's edge went below 0 while seated; **Bet on −edge** = −edge shoes
  where he bet it on a −edge hand.
- **Casino Theo · theo edge** = Σ wager × theo ÷ 100.
- **Casino Theo · actual edge** = Σ wager × live edge at bet ÷ 100.
- **Patron Win** = −Σ casino_win.

Default order: most below theo first ((edge played − theo) ÷ theo). Every
column but 3 periods sorts on header click; click again reverses; a "Most
below theo first" link restores the default. Clicking a row opens Level 2.

## Level 2 · Option

- KPI strip: Theo edge · Edge played · Bets · Turnover · Shoes played ·
  −edge shoes · Casino Theo (theo edge) · Casino Theo (actual edge) · Patron Win.
- Evidence: the four existing test tiles (FactTiles; "Result" reads Patron Win).
- Bet rate by edge: the existing EdgeProfileChart.
- Shoe table (sortable): tick · Shoe (date, table, shoe, seated window,
  dealer) · edge-by-hand strip · −edge hands · Bet on −edge · $ on −edge ·
  Patron Win. Default: only shoes where the option went −edge, most $ on
  −edge first; a checkbox shows all shoes he bet it in. First 20 rows,
  "Show all n".
- Strip: one cell per hand coloured by edge band (existing `edgeBands`),
  outside the seated window dimmed, his bets marked. Hover outlines the
  hand and shows a tooltip (hand, seated, edge, theo, result, his bet,
  Patron Win). Clicking a cell opens that hand; clicking the shoe name opens
  the shoe.
- Tick 2–6 shoes → **Compare** opens the compare view.

## Level 3 · Shoe

- Facts: date · table · shoe · dealer · seated window · Patron Win this shoe
  (all options) · this option's −edge hands bet of seated · option edge at end.
- Side by side: option edge by hand (EdgeCurves, one shoe, bets as dots) and
  his wager by hand (WagerBars, seated hands only, option under review
  highlighted). Hovering either chart puts a cursor on the same hand in the
  other and on the roads; clicking a hand opens it.
- Trend board: Big Road and bead plate by default; "More roads" reveals
  Big Eye, Small Road and Cockroach. Hands he bet this option are ringed.

## Level 3b · Compare

EdgeCurves over the ticked shoes plus a chip per shoe (Patron Win on the
option, bets) that opens that shoe.

## Level 4 · Hand

- Result (and pairs) and his Patron Win on the hand.
- His bets on the hand (sortable): Option · Wager · Edge at bet · Theo ·
  Patron Win.
- Live edge of all ten options at the hand; gold border where he bet.
- The option's edge for ±5 hands, his bets marked, click to move.
- Card faces are not in the feeds, so they are not shown.

## Removed

The Investigate collapse, SummaryPanel, OptionStrip, TestMatrix, the
shoes × hands heatmap and ShoePicker, and the YTD / 7 / 30 day / custom
range bar.

## Data

No contract change: §8 bets and §9 shoe edges, fetched for the last 12
months. The mock history now spans 12 months, and a mock counter only
starts counting about 100 days ago so the three periods differ.

## Testing

Unit (`utils/__tests__/p360Periods.test.js`): period bounds, filtering,
option KPIs (edge played, both theos, involvement, shoe counts), summary
sort and worst option, shoe rows, and period verdicts. Mock test updated
for 12 months. Visual: headless walk through all levels at 1680 px.
