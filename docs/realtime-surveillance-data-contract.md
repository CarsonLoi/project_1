# Real-time Surveillance Dashboard — Database Contract

Complete list of variables to prepare in PostgreSQL for the merged
Real-time Floor + Live Casino Win surveillance dashboard.

**127 columns across 9 endpoints.** All served over HTTP as JSON arrays,
following the existing `/realtime` pattern (env-var URL, polled on an
interval, mock fallback when unreachable).

---

## 0. Conventions

These apply to every endpoint. Getting them wrong silently inverts
rankings and alerts, so they are worth pinning down first.

| Rule | Value |
|---|---|
| **Sign convention** | **Casino perspective everywhere.** Positive = house won, negative = house lost. The UI flips the sign for patron-facing display. One rule, no per-endpoint exceptions. |
| **Gaming day** | Starts 07:00 local, not midnight. `date` is the gaming day, so a hand dealt at 02:00 on the 15th belongs to gaming day the 14th. Matches `GAMING_DAY_START_HOUR` in `rtConfig.js`. |
| **Table join key** | `gametype` + `table`, combined as `"BA|10065"`. Table numbers are reused across gametypes, so `table` alone is not unique. |
| **Cumulative fields** | Accumulate from gaming-day start to now. Every poll returns the running total, not a delta. |
| **Nulls** | Omit the field or send `null`. Never send `0` to mean "unknown" — zero is a real value and will be charted as one. |
| **Currency** | Single currency, no unit suffix. Send `412000`, not `"412K"` or `"$412,000"`. |
| **Timestamps** | ISO 8601 with timezone. |

---

## 1. `GET /realtime` — table snapshot

One row per table on the floor today, open or dark. **32 columns.**

This replaces the current `/realtime` row schema. Columns marked
*existing* are already in the contract; *new* need to be added.

### Identity — 7 columns

| Column | Type | Status | Notes |
|---|---|---|---|
| `date` | DATE | existing | Gaming day |
| `table` | TEXT | existing | **Join key** to floor layout |
| `gametype` | TEXT | existing | **Join key**. One of `BA`, `BC`, `BJ`, `NC`, `SB` |
| `area` | TEXT | existing | Slicer |
| `pit` | TEXT | existing | Slicer |
| `sub_segment` | TEXT | existing | Drives legend columns. Must be one of `883`, `PM`, `Main`, `MSC`, `Slots`, `VIP` |
| `tablemin` | TEXT or NUMERIC | existing | Table minimum — slicer and context |

### Status — 4 columns

| Column | Type | Status | Notes |
|---|---|---|---|
| `is_open` | BOOLEAN | existing | Open right now |
| `openhours` | NUMERIC | existing | Hours open so far today |
| `avg_headcount_10m` | NUMERIC | **new** | **Average** seated players over the trailing 10 minutes, **bounded by the current shoe** — never averages across a shuffle. Where the shoe is younger than 10 minutes, average over its full life so far. Gives alerts their context ("−$412K with 3.4 seated") |
| `last_hand_dealt_time` | TIMESTAMP | existing | Drives the idle-time metric |

### Day cumulative — 5 columns

| Column | Type | Status | Notes |
|---|---|---|---|
| `win` | NUMERIC | existing | Actual win, casino perspective |
| `theo` | NUMERIC | existing | Theoretical win |
| `turnover` | NUMERIC | existing | Total wagered |
| `hands` | INTEGER | existing | Total hands dealt. Guards alerts against thin-sample noise |
| `patron_hands` | INTEGER | existing | Paying-patron hands — the avg-bet denominator |

Derived in the browser, no column needed: **Variance** = `win − theo`,
**Hold %** = `win / turnover`, **Avg bet** = `turnover / patron_hands`.

### Current shoe — 6 columns

The running shoe on each table. This is the block that makes
shoe-level surveillance possible.

| Column | Type | Status | Notes |
|---|---|---|---|
| `shoe_id` | TEXT | existing | Current shoe identifier |
| `shoe_start_time` | TIMESTAMP | **new** | For shoe duration |
| `shoe_hands_dealt` | INTEGER | **new** | Hands dealt so far this shoe |
| `shoe_win` | NUMERIC | **new** | Casino perspective, this shoe only |
| `shoe_theo` | NUMERIC | **new** | This shoe only |
| `shoe_turnover` | NUMERIC | **new** | This shoe only |

Derived: **Shoe variance** = `shoe_win − shoe_theo`,
**Shoe duration** = `now − shoe_start_time`.

### House edge — 12 columns

Live true edge per bet option, as a percentage. **Negative means the
remaining shoe favours the player** — the primary surveillance signal.

`house_edge_banker`, `house_edge_player`, `house_edge_tie`,
`house_edge_btg`, `house_edge_stg`, `house_edge_sl7`, `house_edge_bd`,
`house_edge_sd`, `house_edge_mnm`, `house_edge_pairplus`,
`house_edge_ppl`, `house_edge_l6`

The floor map's **edge rings** read the ten keys in
`PATRON_360.BET_OPTIONS` (banker, player, tie, btg, stg, bd, sd, sl7,
ppl, l6); a table is ringed when any of them is below the operator's
threshold for that option (added 2026-09-26 with `ppl` and `l6`).

All NUMERIC. Omit any bet option a table does not offer — omitted
options grey out rather than reading as zero edge.

> **Known blocker.** These columns exist in the DB but are currently
> dropped by `to_rows()` in `python-api/realtime_api.py` before reaching
> the browser, because they are absent from its `ADDITIVE` list. The
> synthetic mock fabricates them, which is why the KPI appears to work
> today. Fix required before the negative-edge alert can run against
> real data.

### No longer required

Previously in the contract, now unused: `drop`, `patronhrs`,
`open_minutes`, `active_minutes`, `game_count`, `active_game_count`,
`free_game_count`, `spread`, `watm_total`, `floorday`, `openday`,
`dow`, `weekstart`.

`floorday` and `openday` existed only as divisors for the "(Total)"
KPIs. Showing raw cumulative values makes them redundant; `is_open`
covers what remains.

---

## 2. `GET /realtime/patrons` — patrons on floor

One row per patron currently on the floor. **16 columns, all new.**
~135 rows in the reference dataset.

| Column | Type | Notes |
|---|---|---|
| `patron_id` | TEXT | Join key and display label |
| `card_type` | TEXT | `BASE`, `SILVER`, `GOLD`, `PLATINUM`, `BLACK`, `DIAMOND` |
| `segment` | TEXT | `MS`, `PM` |
| `sign_in_mins_ago` | INTEGER | Time on floor |
| `cum_win` | NUMERIC | Casino perspective — see §0 |
| `cum_wager` | NUMERIC | Total wagered today |
| `hands` | INTEGER | Guards the bet-spread alert against thin samples |
| `tables_played` | INTEGER | Distinct tables. Roaming is itself a signal |
| `avg_bet` | NUMERIC | `avg(wager)` |
| `bet_stdev` | NUMERIC | `stddev_samp(wager)` — counting signal, fallback |
| `min_bet` | NUMERIC | `min(wager)` — **strongly recommended**, see below |
| `max_bet` | NUMERIC | `max(wager)` — **strongly recommended**, see below |
| `buy_in` | NUMERIC | |
| `cash_out` | NUMERIC | |
| `current_table_key` | TEXT | `gametype\|table` — where they are now, so surveillance can physically locate them |
| `current_seat` | INTEGER | 1–7 |

### On bet spread — supply `min_bet` and `max_bet` if you can

The counting tell is a player flat-betting until the count turns, then
jumping their bet. There are two ways to measure it and they are **not**
interchangeable:

**Preferred — true spread = `max_bet / min_bet`.** This is what
surveillance actually works to, and the threshold is the familiar
**15:1**. The existing Player 360 panel already computes and displays
this figure, so supplying these two columns makes the alert and the
investigation panel agree on one number with one meaning.

**Fallback — coefficient of variation = `bet_stdev / avg_bet`.** Used
only when min/max are absent. It lives on a completely different scale,
roughly 10× smaller: a player betting 1 unit on 70% of hands and 12
units on 30% (a 12:1 spread) has mean 4.3, stdev 5.04, and a CV of just
**1.17**. Practical bands:

| CV | Reading |
|---|---|
| 0.1 – 0.3 | flat bettor |
| 0.4 – 0.8 | ordinary varied betting |
| 1.0 – 1.5+ | aggressive spreading — worth a look |

Mixing the two scales is an easy and expensive mistake: a threshold of
15 applied to CV would never fire, and a threshold of 1.5 applied to a
true ratio would fire on nearly everyone. The alert engine picks the
metric from which columns are present and labels the alert accordingly
("spread 41:1" vs "bet CV 1.7").

---

## 3. `GET /realtime/betmix` — betting preference

One row per `(gametype, bet_option)`. **5 columns, all new.** ~9–45 rows.

| Column | Type | Notes |
|---|---|---|
| `gametype` | TEXT | |
| `bet_option` | TEXT | `MAIN`, `BIG`, `SMALL`, `ODD`, `EVEN`, `PERFECT_PAIR`, `TRIPLE`, `21+3`, `INSURANCE` |
| `wager` | NUMERIC | Sum |
| `win_loss` | NUMERIC | Sum, casino perspective |
| `hands` | INTEGER | Count |

Derived: **Hold %** = `win_loss / wager`.

Side bets carry much higher house edge than main bets, so a shift in
the floor's bet mix moves expected win independently of volume.

---

## 4. `GET /realtime/dealers` — dealer watch

One row per dealer on shift. **5 columns, all new.** ~10 rows.

| Column | Type | Notes |
|---|---|---|
| `dealer` | TEXT | Name or employee ID |
| `hands` | INTEGER | |
| `wager` | NUMERIC | |
| `win_loss` | NUMERIC | Casino perspective |
| `tables_worked` | INTEGER | Distinct tables this shift |

Loss concentrated on one dealer across multiple tables and patrons is
a standard collusion and dealer-error signal.

---

## 5. `GET /realtime/trend?bucket=15m` — session trend

One row per time bucket since gaming-day start. **7 columns, all new.**
~32 rows at 15-minute buckets over an 8-hour shift.

| Column | Type | Notes |
|---|---|---|
| `bucket_ts` | TIMESTAMP | Bucket start |
| `win` | NUMERIC | |
| `theo` | NUMERIC | Plotted against `win` — the divergence *is* the chart |
| `turnover` | NUMERIC | |
| `hands` | INTEGER | |
| `patrons` | INTEGER | Distinct on floor |
| `tables_open` | INTEGER | |

**Per-bucket values, not cumulative** — a cumulative line hides a sudden
run inside a large running total, which is precisely what surveillance
needs to see. The browser cumulates for display if needed.

Should honour a `bucket` parameter of at least `5m`, `15m`, `30m`, `1h`.

---

## 6. `GET /realtime/patron/{id}` — investigation detail

One row per round for a single patron. **13 columns, all new.**
Fetched on demand only, never polled.

| Column | Type | Notes |
|---|---|---|
| `ts` | TIMESTAMP | |
| `gametype` | TEXT | |
| `table` | TEXT | |
| `bet_option` | TEXT | Same domain as §3 |
| `wager` | NUMERIC | |
| `win_loss` | NUMERIC | Casino perspective |
| `winner` | TEXT | `W` / `L` |
| `seat` | INTEGER | 1–7 |
| `bet_placement_ms` | INTEGER | Milliseconds from round open to bet placed. Late betting is a signal |
| `shoe_id` | TEXT | |
| `dealer` | TEXT | |
| `hand_in_shoe` | INTEGER | Position within shoe |
| `shoe_hands` | INTEGER | Total hands in that shoe |

Powers the wager sunburst (game → bet → outcome), seat-preference heat,
bet-size scatter, dealer breakdown, and shoe-by-shoe drill-down.

Should accept an optional `date` parameter so past days can be
investigated, not just today.

---

## 7. `GET /realtime/shoe` — one table's shoe, hand by hand

`GET /realtime/shoe?gametype=BA&table_id=10065[&shoe_id=...]`

One row per bet in the table's current shoe (or the given `shoe_id`).
A hand nobody bet on still gets **one row** with `player_id` null and
`wager` 0, so the road has no gaps. **15 columns + 10 edge columns.**
Fetched for the table open in the Table focus panel, refreshed on every
poll tick.

| Column | Type | Notes |
|---|---|---|
| `table_id` | TEXT | |
| `gametype` | TEXT | `BA` / `NC` |
| `shoe_id` | TEXT | |
| `game_id` | TEXT | the hand |
| `hand_no` | INTEGER | 1-based position in the shoe; the latest is the "hand 50" number |
| `game_time` | TIMESTAMP | when the hand was dealt |
| `result` | TEXT | `B` / `P` / `T` |
| `banker_pair` | SMALLINT | optional 0/1, drawn on the road |
| `player_pair` | SMALLINT | optional 0/1, drawn on the road |
| `dealer` | TEXT | optional |
| `player_id` | TEXT | null on empty-hand rows |
| `seat` | INTEGER | 1–7 |
| `bet_type` | TEXT | `BANKER`, `PLAYER`, `TIE`, `BTG`, `STG`, `BD`, `SD`, `SL7`, `PPL`, `L6` |
| `wager` | NUMERIC | |
| `casino_win` | NUMERIC | casino perspective (the UI shows `−casino_win` as Patron Win) |
| `house_edge_<key>` | NUMERIC | live edge **when this hand was dealt**, one column per key in `BET_OPTIONS` (banker, player, tie, btg, stg, bd, sd, sl7, ppl, l6); same value on every row of a hand. Drives "House edge by hand" and the per-seat −edge counts |

The latest hand's `house_edge_<key>` must equal the table row's
`house_edge_<key>` (§1) — the map ring and the focus charts show the
same number.

Env var: `REACT_APP_RT_SHOE_URL` (default: sibling path `/shoe`). Unlike
the polled feeds, a failing shoe endpoint does **not** fall back to mock
data — the board shows the last good shoe and a warning instead.

---

## 8. `GET /realtime/patron/{id}/bets?from&to` — Player 360 bets

One row per bet the patron placed between `from` and `to` (inclusive
gaming dates; the 360 defaults to 1 January → today). **15 columns.**
Fetched when the Player 360 opens and whenever its date range changes —
never polled.

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
| `bet_type` | TEXT | `BANKER`, `PLAYER`, `TIE`, `BTG`, `STG`, `BD`, `SD`, `SL7`, `PPL`, `L6` |
| `wager` | NUMERIC | |
| `casino_win` | NUMERIC | casino perspective |
| `theo_win` | NUMERIC | casino perspective, nominal edge × wager |
| `edge_at_bet` | NUMERIC | optional — the §9 edge for this bet type at this hand |

Backend: `select * from <table> where player_id = $1 and gaming_date between $2 and $3`.
Env var: `REACT_APP_RT_PATRON_BETS_URL` (default: sibling path
`/patron/{id}/bets`). A failure shows an error with Retry — no mock
fallback when the endpoint is configured.

---

## 9. `GET /realtime/patron/{id}/shoe-edges?from&to` — Player 360 edge per hand

One row per **hand** of every shoe in which the patron placed at least
one bet between `from` and `to` — **including hands they did not bet**,
so the 360 can show what the edge was while they sat out. **19 columns.**
Fetched alongside §8.

| Column | Type | Notes |
|---|---|---|
| `gaming_date` | DATE | |
| `table_id` | TEXT | |
| `gametype` | TEXT | `BA` / `NC` |
| `shoe_id` | TEXT | |
| `hand_no` | INTEGER | 1-based |
| `game_time` | TIMESTAMP | |
| `result` | TEXT | `B` / `P` / `T` |
| `banker_pair` | SMALLINT | optional 0/1, drawn on the road |
| `player_pair` | SMALLINT | optional 0/1, drawn on the road |
| `house_edge_banker` | NUMERIC | house edge % given the cards left **before** this hand |
| `house_edge_player` | NUMERIC | 〃 |
| `house_edge_tie` | NUMERIC | 〃 |
| `house_edge_btg` | NUMERIC | 〃 |
| `house_edge_stg` | NUMERIC | 〃 |
| `house_edge_bd` | NUMERIC | 〃 |
| `house_edge_sd` | NUMERIC | 〃 |
| `house_edge_sl7` | NUMERIC | 〃 |
| `house_edge_ppl` | NUMERIC | 〃 |
| `house_edge_l6` | NUMERIC | 〃 (null = option not offered on that table) |

Casino perspective: positive = house favoured, negative = the remaining
cards favour the player. This is what makes the advantage tests possible
— did the patron start betting an option once its edge turned negative?
Compute it in the pipeline (remaining-card composition → exact edge per
bet option), not in the browser. Env var:
`REACT_APP_RT_PATRON_SHOE_EDGES_URL` (default: sibling path
`/patron/{id}/shoe-edges`). Same failure rule as §8.

---

## 10. Resolved decisions

All three open items are settled. Recorded here because each one
removed a metric, and the reasoning matters if anyone revisits it.

### `theo_sd` — not supplied

**Variance in σ is dropped.** Raw dollar variance (`win − theo`) is the
surveillance metric instead.

Consequence: the variance *heatmap colour ramp* needs absolute dollar
thresholds calibrated once against historical data, because a fixed
dollar band means different things on a $100 table and a VIP table.
That calibration is a follow-up, not a blocker.

It is not a blocker because **the ranking tabs carry the surveillance
load, not the map colour.** A list sorted worst-variance-first is
inherently self-calibrating and needs no thresholds at all. The map
colour is the secondary read; until the ramp is calibrated it can fall
back to floor-relative percentile shading.

If `theo_sd` becomes available later, σ can be added without touching
anything else — it is a pure addition.

### `shoe_hands_total` — not supplied

**Penetration % is dropped.** Shoe progress is expressed as
`shoe_hands_dealt` (raw count) and shoe duration from
`shoe_start_time` instead.

Both still answer "how deep is this shoe", just without a percentage.

### `avg_headcount_10m` — supplied, with a specific definition

Rolling 10-minute average of seated players, **scoped to the current
shoe**. Two deliberate properties:

- **Averaged, not instantaneous** — a player standing up for one hand
  should not flicker the value.
- **Bounded by the shoe** — never averages across a shuffle, where a
  table may have emptied and refilled. Where the current shoe is
  younger than 10 minutes, average over its full life so far.

*Optional companion:* `headcount_window_mins` (NUMERIC) — how many
minutes the average actually covers. Lets the UI render "4.2 (3 min)"
early in a shoe rather than implying a settled 10-minute read. One
extra column; skip it if inconvenient.

---

## Summary

| Endpoint | Rows per poll | Columns | Cadence |
|---|---|---|---|
| `/realtime` | ~87 | 32 | Polled |
| `/realtime/patrons` | ~135 | 16 | Polled |
| `/realtime/betmix` | ~9–45 | 5 | Polled |
| `/realtime/dealers` | ~10 | 5 | Polled |
| `/realtime/trend` | ~32 | 7 | Polled |
| `/realtime/patron/{id}` | variable | 13 | On demand |
| `/realtime/shoe` | ~150–400 | 15 | Selected table, every poll |
| `/realtime/patron/{id}/bets` | ~5–100k | 15 | On demand (Player 360, per range) |
| `/realtime/patron/{id}/shoe-edges` | ~75 × shoes | 19 | On demand (Player 360, per range) |
| **Steady-state total** | **~270 rows** | **76** | |

Roughly 270 rows per poll regardless of how busy the floor is, because
every panel reads a pre-aggregated endpoint. The alternative — shipping
raw rounds and aggregating in the browser — would be tens of thousands
of rows per poll for the same result.

Each endpoint degrades independently: if `/betmix` fails, that panel
shows its empty state and the rest of the dashboard is unaffected.
