# Floor map-first console — Implementation Plan

> Executed inline (executing-plans). Steps use checkbox syntax.

**Goal:** Port the approved floor demo (spec `docs/superpowers/specs/2026-09-26-floor-map-first-design.md`) into `src/realtime`, labelling every money figure Patron Win or Casino Win.

**Architecture:** Pure models in `utils/` (edge rings, edge mock, seat summary) with Jest tests; React components consume them. The map stays ECharts (a custom series draws ring arcs); table SVG, roads and small multiples are React SVG; the one-option chart is ECharts.

**Tech Stack:** React 19, MUI 9, ECharts 6, CRA Jest.

## Global Constraints

- Money labels: "Patron Win" (patron perspective) or "Casino Win" (casino perspective) — never bare "Win"/"Result".
- Tokens from `constants/rtTheme.js`; option colours from `PATRON_360.BET_OPTIONS`.
- Seat colours `['#7aa2f7','#f2c14e','#6ad08f','#ff7eb6','#7dcfff','#ff9e64','#c0a6ff']`.
- Negative-edge magenta `rgb(214,92,255)`; text on dark ≥ 4.5:1.
- No commits. Tests: `$env:CI='true'; npx react-scripts test --watchAll=false src/realtime`.

---

### Task 1: Edge-ring model — `utils/edgeRings.js` + test
Produces: `RING_DEFAULTS`, `mergeRingSettings(stored)`, `loadRingSettings()`, `saveRingSettings(s)`, `edgesFromRow(row) → {CODE: number|null}`, `ringsFor(edges, handsDealt, settings) → [{code, edge, gap, color}]` (worst first), `ringsByTable(rows, settings) → Map<tableKey, hits>`.

### Task 2: Edge mock + shoe edges — `utils/edgeMock.js`, `shoeData.js`, `rtDataSource.js`, `realtimeData.js`
Produces: `mockEdgePath(seedKey, code, n) → number[]`; `groupShoeRows` adds `hand.edges {CODE: v}`; mock shoe rows carry `house_edge_<key>` and side-bet codes; table rows take the last path value; `HOUSE_EDGE_BASE`/`HOUSE_EDGE_FIELDS`/`HOUSE_EDGE_OPTIONS` gain `ppl`, `l6`.

### Task 3: Seat model — `utils/seatSummary.js` + test
Consumes: shoe (`groupShoeRows`), seatsByTable entries, `patron360.evidenceFor/verdictFrom`.
Produces: `buildSeats(shoe, seated) → [{seat, empty, playerId, cardType, cumWin, bets:[{handNo, code, wager, patronWin, neg}], shoeWin, wager, negBets, firstHand, verdict}]` (7 entries), `edgePaths(shoe) → {CODE: number[]}`.

### Task 4: Top row — `RtSummaryTiles`, `RtAlertBar`, dashboard
Tiles compact (Casino Win, Casino Theo, Casino Win − Theo, Turnover, Tables, Patrons); alert strip flexes beside them. Alert details use Patron Win / Casino Win.

### Task 5: Map — `RtFloorMap` rings + legend filter, `RtMapLegend`, `RtRingSettings`, `RtRingInfo`
Remove visualMap; per-point colour from ramp; hidden bands fade; custom ring series (arcs, label, pulse keyframes unless reduced motion); toolbar ring toggle, gear, (i).

### Task 6: Side panel — `RtTabbedPanel`
Tabs Table W/L · Edge rings · Patrons · Dealers; perspective header rows; hidden scrollbar; fixed to map height.

### Task 7: Table focus — `components/focus/*`
`RtTableFocus` (header + layout + state), `TableTop` (SVG), `SeatCard`, `EdgeByHand` (minis + big chart), `TrendBoard` (bead + big road with cursor).

### Task 8: Perspective labels elsewhere
Player 360 (FactTiles Result → Patron Win, TestMatrix column), trend chart series names, map tooltips.

### Task 9: Contract doc + verification
Update `docs/realtime-surveillance-data-contract.md` §1/§7; run Jest + ESLint; headless screenshots 1680/1280.
