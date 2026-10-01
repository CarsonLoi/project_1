# Pricing Auto-plan v2 — design

Date: 2026-10-01 · Area: `src/pricing` (Auto-plan mode of Table Pricing) · Status: approved by user in chat.

## Goal

Make Auto-plan assign prices the way the floor team plans by hand, at 300-table scale:
anchor each day on 21:00, propagate outward with the fewest and smallest changes,
keep each table's pattern the same across the whole period, never price a closed
table-hour, treat every manual price as a hard rule, and let the user tune every
criterion (with the effect on ranking order stated plainly).

## Requirements (user rules → design)

| # | Rule | Design |
|---|------|--------|
| R1 | No price on a table-hour the spread schedule has closed | A table counts toward a block's mix if open at any hour of it; prices are written to its open hours only. Result shows "prices on closed table-hours: 0" (by construction) and unpriced open table-hours. |
| R2 | Criteria panel: Theo per hour, Active rate, current signals; say how each affects order | Named rank signals (below) with one-line "higher → ranked higher → higher price slots" text, weights shown as % of the rank, a "What decides a table's price" priority list, and a live **Ranking preview**. |
| R3 | Order: 21 → 15 → 13 → 11 → 07 and 21 → 03 → 05; fewest changes per table; forced change goes to the closest price | Anchor-first tree solve per date (anchor = setting, default 21:00). Each step is an exact min-cost flow vs its parent hour. Per-level jump cost default 1,000 (above rank + history, below a change 10,000). |
| R4 | Same pattern across day types / the period | Reference day (setting: Saturday default, Weekday, Friday, Sunday, Busiest-auto). Its anchor-hour plan is solved first; every date's anchor hour is solved against it with the **align** cost (default 10,000). |
| R5 | A manual price is a business rule; re-solve the floor around it against the target mix | Manual price = rule for **that date + block** (a non-core hour maps to its block). Hard lock in the solver; the target mix makes room. The date re-solves immediately (whole period when it's the reference date's anchor block). "Keep" in Result writes the same rule. Listed in Rules; removable. |
| R6 | Per-pod at least / at most N tables at a price; each switchable | Zone rule gets `min` + `max`, each with its own switch, plus rule on/off and core hours. Exact in the flow: min via negative-cost units, max via capacity. Targets are raised to meet the minimums. |
| A3 | Enter the mix per day type **or** per date; paste a whole Excel sheet once | Targets tab: Day type / Date toggle; a date's mix overrides its day type. "Paste from Excel" dialog with preview; "Copy as Excel". Unknown prices in a paste are added to that sub-segment's price list. |
| A4 | Rank basis is a setting | "Per core-hour block" (hourly feed, block hours) or "Whole day" (daily feed). |
| + | History source selectable | Price history and performance rank each use "last N weeks/days" or a custom date range. |

Game dimension: targets stay per sub-segment; games are controlled by rules (e.g. a
Price range rule scoped to a game). Revisit if the user asks for per-game mixes.

## Solve (per period)

1. **Reference plan.** Reference date = first date in the period of the reference day
   type (Busiest-auto: day type whose dates have the most open tables at the anchor;
   no such date → the busiest date). Solve its anchor block from rank, history,
   saved plan (stay close) and its manual rules. Result: `ref: Map(table → tier)`.
2. **Each date, anchor block.** Parent = `ref`; the "change" cost is the **align**
   weight (a difference from the reference, not an operational change).
3. **Each date, the rest.** Backward: anchor-1 ← anchor … first core. Forward:
   anchor+1 ← anchor … last core. Parent = the neighbouring solved core hour.
4. **Reports** stay chronological (07→11 … 03→05, and previous date 05→07), each with
   its lower bound, so the Result tab reads the same as today.

Per table × price cost (lower wins):

```
change   (10,000 × peak multiplier of the hour the change happens) if price ≠ parent
+ step   (1,000 per price level jumped)                            if price ≠ parent
+ raise  (0 default)                   if the change raises the price in time order
+ hold   (500) if the table changed within the last N core hours of its tree path
+ rank   (10 per level away from its rank slot)
+ hist   (10 × (1 − share the table ran this price))
+ stay   (300) if different from the saved plan (Stay close ticked)
+ pod-cap penalty (heuristic, only when "max changes per pod" is on and exceeded)
```

Hard limits: manual rules, Planning pins, lock / range / max-step rules, pod min/max.

Pod change cap (optional): re-solve up to 4 times, adding a penalty to the tables of
pods over the cap; report pods still over.

## Rank signals

Each signal is a percentile within the sub-segment (0 lowest … 1 highest), blended
by weight. Named signals (numerator ÷ denominator):

| Signal | Formula | Source name |
|---|---|---|
| Theo per hour | theo ÷ open hours | Performance: "Theo per table per hour" |
| Active rate | active minutes ÷ open minutes | Performance: "Active % (Min by Min)" |
| Theo per patron hour | theo ÷ patron hours | current default |
| Win per hour | win ÷ open hours | |
| Occupancy | patron hours ÷ open hours | |
| Hands per hour | game count ÷ open hours | |

Default mix: Theo per hour 50 · Active rate 25 · Theo per patron hour 25.
Older `{metric, per}` entries keep working; unnamed pairs show as "Custom".

## Settings added

`criteria`: `anchorCore` (21), `refDayType` ('sat' | 'wd' | 'fri' | 'sun' | 'auto'),
`rankBasis` ('block' | 'day'), `histSource` / `rankSource` ({ mode: 'last' | 'range',
from, to }), `histHalfLife` (weeks, 0 = off), `changeMult` ({ core: ×}),
`podChangeCap` ({ on, n }).
`weights`: `step` 1,000 (was 20), `align` 10,000, `raise` 0.
`manual`: `{ date: { core: { tableKey: tierId } } }`.
`targets`: day-type keys as today plus `d:YYYY-MM-DD` date keys.
Zone rule: `{ min, minOn, max(n), maxOn }` (old `n` → max, maxOn).

## UI

- **Toolbar**: unchanged; "Solve period" runs the new order.
- **Floor (Auto-plan)**: selectable; a slim bar "Set price for N tables · 21–02 block ·
  2026-10-04" with price buttons and "Clear manual". Manual tables get a solid gold
  outline (pins stay dashed).
- **Targets**: Day type | Date toggle, date strip for the period, Paste from Excel
  dialog (parse preview, errors, what gets filled), Copy as Excel.
- **Rules**: Pod rule with at least / at most switches; templates; "Manual prices"
  list per date with remove.
- **Criteria**: "What decides a table's price" priority list; Solve order (anchor hour,
  reference day); Scoring (+ align, raise, peak multipliers, pod change cap);
  Performance rank (named signals, basis, source, preview); Price history (source,
  recency half-life, threshold); open tables; core hours.
- **Result**: closed-hour check line; pod-cap warnings.

## Testing

Unit (Jest, pure modules): tree order and parents; anchor alignment to the reference;
closest price on a forced change; pod min/max (exact and infeasible); manual rule
locks and target accommodation; no price on closed hours; paste parser and formatter;
signal blend per block; history range and half-life; peak / raise costs.
Live: browser walkthrough of every new control.
