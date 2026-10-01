# Real-time Floor — map-first surveillance console

Date: 2026-09-26 · Status: approved (demo artifact v4, "very good") · Scope: `src/realtime`

Reference design: artifact https://claude.ai/artifact/Jy6k6N56WfxYmgfVrDRwtL
(source `scratchpad/floor-preview/floor-preview.html`).

## Goal

Surveillance watches the live floor map first, spots the table in trouble, and
drills into it without leaving the page. Every money figure says whose money it
is: **Patron Win** or **Casino Win**.

## Layout

```
title · live clock · feed health · auto-refresh
[KPI tiles ............][ ALERT STRIP (chips scroll) ................]   one row
┌ floor map (7fr) ───────────────────────────┐┌ side panel (3fr) ───────┐
│ Colour by [Casino Win|Hand #|House edge]    ││ Table W/L · Edge rings  │
│ [Today|Current shoe]   N ringed [Rings][⚙][i]│ · Patrons · Dealers     │
│ map (no in-chart legend gutter)             ││ list, hidden scrollbar, │
│ legend: one line, each band = filter button ││ height = map panel      │
└─────────────────────────────────────────────┘└─────────────────────────┘
┌ Table focus ─────────────────────────────────────────────────────────┐
│ key · pit · Shoe · Hand · Dealer · Casino Win today · Casino Win shoe │
│ ring pills                                                            │
│ ┌ Table (5fr) ─────────────┐ ┌ House edge by hand (7fr) ─────────────┐ │
│ │ dealer/tray/shoe on top  │ │ [All options | One option]  seat chip │ │
│ │ felt, spots with chips   │ │ small multiples (10) or one ECharts   │ │
│ │ S1–S7 round the curve    │ │ chart with per-seat bet dots          │ │
│ │ seat card (+ Player 360) │ └───────────────────────────────────────┘ │
│ └──────────────────────────┘                                          │
│ Trend board: bead plate │ Big Road (same height, hover-hand cursor)   │
└───────────────────────────────────────────────────────────────────────┘
Player 360 overlay (on demand) · Floor context (collapsed)
```

The shoe board + patron panel row is replaced by the Table focus panel. The
`RtShoeBoard` / `RtPatronPanel` files stay in the tree unused.

## Perspective labels (new requirement)

| Where | Label | Sign |
|---|---|---|
| KPI tiles | Casino Win · Casino Theo · Casino Win − Theo · Turnover | casino |
| Map colour-by | Casino Win | casino |
| Map tooltip | Casino Win (today / shoe) | casino |
| Seat tooltip, seats on table, seat card | Patron Win | patron |
| Table W/L list, Dealers list | header "Casino Win" | casino |
| Patrons list | header "Patron Win" | patron |
| Focus header facts | Casino Win today · Casino Win this shoe | casino |
| Big edge chart tooltip | Patron Win per bet | patron |
| Alerts | TABLE LOSS detail "Casino Win −$X today"; PATRON WIN detail "Patron Win +$X" | as named |
| Player 360 | Result tile / matrix column → "Patron Win" (actual vs expected) | patron |
| Floor context trend | Casino Win · Casino Theo · Casino Win − Theo | casino |

Money is signed and coloured by the figure's own sign (green up, red down) —
the label, not the colour, tells whose money it is.

## Edge rings

- Toggle **Edge rings** (off by default; state remembered in localStorage).
- Hit rule per table: shoe hands dealt ≥ `minHands`, and for each enabled
  option `house_edge_<edgeKey> < below`. Hits sorted by `edge − below`
  ascending (worst first).
- Settings dialog (gear): per option on/off, "ring when edge below" (%),
  ring colour; global min hands (default 10), pulse, label on map, and multi-hit
  mode — **Segmented** (default; one arc per hit in its colour) or **Worst
  only**. Defaults: every option on, below 0 %, colour = option colour; TIE and
  SL7 below −2 %. Reset to defaults. Stored in localStorage `rt.ringSettings.v1`.
- Map label: worst option + edge, `+N` for the other hits.
- (i) popover to the right of the gear explains the ring with a mini example.
- Side panel "Edge rings" tab lists ringed tables worst-first with a badge
  count; list respects the current settings even when the toggle is off.

## Legend filter

One line under the map: one button per colour band of the current metric, a
"Show all" reset when anything is hidden, and "N of M tables". A hidden band
fades its tables to 12 % opacity (they stay clickable). Changing metric or scope
clears the filter.

## Table focus

- Opens on map / list / alert click; defaults to the first alerting table, else
  the worst Casino Win table (sticky).
- Seat selection defaults to the seat whose shoe verdict is ACTION, else none.
- Seat verdict: `patron360.evidenceFor([view]) → verdictFrom` on this shoe
  only; badge ▲ ACTION / ◆ WATCH (CLEAR / NO DATA show nothing).
- Seat click filters: edge charts' dots, the one-option chart's legend, the
  trend board rings (hands the patron bet). Legend click in the big chart
  selects that seat; clicking again / ✕ chip / "Show all players" clears.
- Seat card: Seated (from hand #), Patron Win this shoe (on wager), Patron Win
  today, Bets on −edge (n of m), per-option bars with the −edge share in
  magenta, **Open Player 360**.
- Edge by hand, **All options**: 10 small multiples, options below threshold
  first with a ring-colour border; magenta fill under 0 %, dashed theo; dots =
  bets (seat colour when a seat is selected). Click → One option.
- Edge by hand, **One option**: option chips; ECharts line + markArea < 0 +
  theo markLine; one scatter series per seat (filled = patron won, hollow =
  lost, size ∝ √wager).
- Trend board: bead plate and Big Road, both 6 rows × 22 px, equal heights;
  hover on any edge chart moves a hand cursor on both roads.

## Data contract changes

- Table row (§1): `house_edge_<key>` for all ten `PATRON_360.BET_OPTIONS`
  edge keys (adds `ppl`, `l6`). Existing `mnm`, `pairplus` stay.
- Shoe feed (§7): each row carries the hand's live `house_edge_<key>` for the
  ten keys (same value on every row of a hand). Bet types use the
  `BET_OPTIONS` codes.
- Mock: one deterministic per-shoe edge path per option (`utils/edgeMock.js`);
  the table row's edges are the path's last value, so map and focus agree. One
  seat on a few tables bets side options on negative-edge hands.

## Out of scope

Real ring alerts (the NEG_EDGE rule is unchanged), server work, commits.

## Testing

Unit: `edgeRings` (hits, sorting, min hands, disabled options, settings
merge), `edgeMock` (deterministic, last value = row), `groupShoeRows` edges,
`seatSummary` (per-seat bets, −edge counts, verdict). Visual: headless
screenshots at 1680 and 1280 wide; `src/realtime` Jest suite and ESLint clean.
