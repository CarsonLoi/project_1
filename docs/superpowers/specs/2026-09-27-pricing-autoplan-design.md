# Table Pricing · Auto-plan (with manual control)

Date: 2026-09-27 · Status: approved direction (demo artifact v2 "combine 2 as 1"; user: "come up the best design and develop")
Scope: `src/pricing` · Demo: https://claude.ai/artifact/EKmjPbddifT1hwogWaJDWo

## Problem

Pricing ~300 tables for 24 hours × 4 day types by hand is slow and error prone,
and every price change is operational work on the floor. The page already
paints prices per table per hour; it has no way to plan the whole month from a
few targets, and no notion of "change as few tables as possible".

## Principles

1. **Automate the repeated work, keep every decision overridable.** The solver
   drafts; people pin, reject, repaint and re-solve. Nothing the user set by
   hand is silently undone.
2. **Fewest changes first.** Between consecutive core hours — and across
   midnight into the next date — the plan changes the minimum number of tables
   the targets and rules allow.
3. **One plan, two ways to edit it.** Planning (paint) and Auto-plan (targets,
   rules, solve) read and write the same per-hour store.
4. **Draft → review → apply.** Solving never overwrites saved plans; Apply
   saves a version of every date first.

## Core hours and blocks

Core hours 07 · 11 · 13 · 15 · 21 · 03 · 05. Every other hour copies the core
hour before it: 07–10, 11–12, 13–14, 15–20, 21–02, 03–04, 05–06. The store
keeps its per-hour buckets (`h_<hour>`); Auto-plan writes a block's price into
every hour of the block.

## What the user sets (and how little they have to)

| Input | Default (automated) | Manual control |
|---|---|---|
| Planning period | the next calendar month | any from–to range |
| Day type of each date | Mon–Thu Weekday · Fri · Sat · Sun | override any date (holidays) |
| Targets: tables per price × core hour × sub-segment × day type | seeded from the last 12 weeks' actual hourly minimums, sized to the schedule's open tables | edit cells, paste from Excel, copy a column or a day type, shift a column's mix up/down one price, fit to open, fit to rules |
| Price ladder per sub-segment | prices seen in that sub-segment's history | price-range rules |
| Rules | none | zone cap, price range, lock, max step (scope: floor · sub-segment · game · zone · table; core hours) |
| Pins | none | pin tables in Planning (painting pins automatically), or "Keep previous price" on any proposed change |

Targets are per **day type**; each date is solved with **its own schedule**. A
date whose open count differs from the day type's reference gets the same mix
scaled to its open tables (largest remainder), then trimmed to the zone caps.

## The solver

Per date and core hour, a min-cost flow assigns every open table one price:
source → table → (zone-cap node) → (sub-segment × price) with capacity =
target → sink. Cost of table *t* at price *k*:

| Term | Weight |
|---|---|
| differs from *t*'s price at the previous core hour (previous date's 05:00 for 07:00) | 10000 |
| differs from the saved plan at this date/hour ("stay close to current plan", on by default when a saved plan exists) | 300 |
| step size of a change, per price level | 20 |
| distance from the price its performance rank implies, per level | 10 |
| 10 × (1 − share of history at *k* for this table, day type, core hour) | 10 |

Pinned tables and lock rules have one allowed price; price ranges and max step
remove arcs. Pins are honoured first: a pinned table's price takes its slot,
moving one target table at that price from the most common other price, and
the Result says so. Dates are solved in order, each chained to the previous
date. With rules off the plan provably meets the lower bound
`Σ sub-segments (open in both − Σ price min(prev count, target))` per
transition; the Result shows changes against that bound.

If a date/hour can't be solved, nothing is applied and the Result names the
clash (targets vs open tables, a zone cap below its target, a pin breaking a
rule) with a one-click fix where one exists.

## Page layout (Auto-plan mode)

- **Toolbar**: mode [Planning | Auto-plan | Comparison]; row 2 in Auto-plan:
  Period (from–to), Day types (summary chip → editor popover), Keep pins ✓,
  Stay close to current plan ✓, **Solve period** (progress), then **Apply N
  dates** / Discard draft once solved.
- **Timeline**: core hours marked; the other hours show which core hour they
  copy. A date stepper (◀ date ▶) walks the period's dates.
- **Floor map**: the draft for the selected date and hour; changed tables vs
  the previous core hour outlined (red up / green down, as today), pinned
  tables outlined gold.
- **Right tabs**: Targets · Rules · Result.
  - Result: period KPIs (changes, minimum, hour-by-hour baseline), per-date
    change bars (click = go to date), the date's 7 transitions, the changed
    tables for the selected transition with **Keep previous price**, the
    rules with pass/fail and cost (changes/day each rule adds), Download
    change sheet (CSV: date, block, table, sub-segment, zone, from, to).
- **Bottom**: the existing Hourly Minimum Mix of the draft.

## Planning mode additions

- Timeline marks core hours; toolbar toggle **Edit: Block | This hour**
  (Block default) — a paint at 09:00 prices 07–10.
- Painting pins the table (gold outline); selection bar gets **Pin / Unpin**.
- Tooltip shows "pinned" and whether a price came from Auto-plan.

## Data

No new endpoints. Floor: `liveFloorTables` (+ `zone`). Schedule: the spread
feed per date (all tables open when a date has no schedule, flagged). Value:
daily feed theo ÷ patron-hours, same day type, 4 weeks. History: hourly feed
`tablemin`, same day type, core-hour block, 12 weeks. Auto-plan config (targets,
rules, day-type map, weights) lives in the pricing store (`store.autoplan`);
assignments gain optional `pin: true` and `src: 'auto'` (readPrice ignores
both, so old plans read unchanged).

## Out of scope

Server-side storage of targets/rules, undo beyond versions, weights UI beyond
read-only display.

## Testing

Unit: solver (optimality vs lower bound with rules off, rules honoured, pins,
infeasibility diagnosis), inputs (core-hour mapping, day types, seeding,
fitting), apply (block expansion, versions saved, pins/src preserved), config
merge. Visual: headless walk of Auto-plan (solve, result, keep previous,
apply) and Planning (block paint, pin) at 1680 px.
