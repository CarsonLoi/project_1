# Player 360 — summary-first redesign

**Date:** 2026-09-26
**Builds on:** `2026-09-26-patron-360-side-bet-design.md` (data, model, heatmap, curves, trend board unchanged).

## Problem

The 360 shows everything at once with equal weight — evidence table with sentences, option chips,
heatmap, curves, wager bars, trend board. A surveillance officer needs an escalate / don't decision in
about 10 seconds.

## Decisions

| Question | Decision |
|---|---|
| First screen's job | Decide fast: escalate or not |
| Key picture | **Bet rate by edge** for the key option, all shoes pooled |
| Arrangement | Summary on top (fits one screen); everything else in one collapsed **Investigate** section |
| Copy | Minimal words — facts become visual cards and charts; explanations move to tooltips |

## Layout

1. **Header (slim):** avatar · patron · tier/seat line · range chips (default YTD) + From/To · small
   source chip · close. No verdict here.
2. **Summary row** — `lg`: two columns 5 / 7.
   - **Verdict card (left):** the stamp (bigger), count chips (`● 3 flags`, `● 1 watch`, only non-zero),
     a ≤ 7-word headline, then **four fact tiles** (2 × 2) for the key option. Each tile = a label of
     1–3 words, a state badge carrying the test value (e.g. `28.2×`, coloured by state), and **two
     horizontal bars** comparing the suspicious side with the normal side:
     | Tile | Bar 1 (magenta) | Bar 2 (slate) | Badge |
     |---|---|---|---|
     | Bet rate | −edge: share of negative-edge hands bet | other: share of other hands bet | entry |
     | Avg bet | −edge: avg bet | other: avg bet | ramp |
     | On −edge | money: share of money on −edge hands | hands: share of hands that were −edge | money |
     | Result | actual (sign-coloured) | theo | luck |
   - **Key picture (right):** "Bet rate by edge · \<code\>" — five bars, one per edge band (same bands
     and colours as the heatmap), height = % of seated hands in that band where the patron bet the
     option, value label on each bar; dashed line = overall bet rate (labelled `avg n%`); gold line +
     dots on a right axis = average bet per band. Below it the **option strip**: one chip per option
     used (option colour + code + a dot in its worst test state); click = switch the key option for
     the whole page.
3. **Investigate** — a full-width bar "Investigate" with count chips (shoes, bets) and a chevron;
   closed by default; contents unmount when closed:
   - **All tests** (`TestMatrix`): options × (bets, turnover, result, entry, ramp, money, luck); each test
     cell is a state-coloured tile with the value only; header tooltips carry the question and thresholds.
     Row click = switch option.
   - **Shoes × hands** heatmap (unchanged behaviour; the separate option chips are removed; legend uses
     short numeric band ticks and won/lost marker icons).
   - **Selected shoes**: edge curves, hand-by-hand wager, single-shoe trend board (unchanged).

## Model additions (`utils/patron360.js`, unit tested)

- `worstState(row)` → `flag | watch | clear | insufficient`.
- `defaultOption(rows)` now picks the **key option**: most flags, then most watches, side bets before
  main, then most money (options with bets only); `BANKER` when empty.
- `headlineFor(verdict, row)`: first flagged test, else first watched, in order entry, ramp, money,
  luck → `"<CODE> bets follow the negative edge"`, `"<CODE> bets grow on the negative edge"`,
  `"<CODE> money piles onto the negative edge"`, `"<CODE> winning beyond chance"`; otherwise
  `"No edge-timed betting"`; NO DATA or no row → `"Too few bets to judge"`.
- `edgeProfile(views, code, bands)` over seated hands with a known edge → `{ bands: [{hands, bets,
  wager, rate, avgBet}], hands, bets, rate }`; `bands` are `{gte?, lt?}` ranges.

## Components (`components/patron360/`)

New: `SummaryPanel`, `FactTiles`, `EdgeProfileChart`, `OptionStrip`, `TestMatrix`.
Removed: `AdvantageTable`, `OptionChips`. `format.js` gains `bandTick(band)`, `panelSx`, `raisedSx`.

## Quality

Contrast ≥ 4.5:1 for all text; state never by colour alone (badge text / tooltip); keyboard: option
strip, test rows and Investigate bar are focusable buttons; `prefers-reduced-motion` respected; no
page-level horizontal scroll at 800 / 1280 / 1680.
