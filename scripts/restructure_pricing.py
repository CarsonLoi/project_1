#!/usr/bin/env python3
"""
restructure_pricing.py
======================

Restructure a PRICING export from the Pricing dashboard into a tidy long
dataframe ready to load into the pricing database.

Input
-----
One or more `pricing_<date>_v<N>.json` files (or a directory of them). Each
file is the dashboard's hourly pricing snapshot:

    {
      "kind": "pricing_plan", "schema": 2,
      "date": "2026-07-03",
      "revised_date": "2026-06-26",
      "tiers":  [ {"id":"t_500","min":500,"label":"$500"}, ... ],
      "tables": [ {"key":"BJ|10000","gametype":"BJ","table":"10000",
                   "segment":"MS","sub_segment":"Main"}, ... ],
      "byHour": {
        "0": { "BJ|10000": {"base":"t_500","min":"t_500","max":"t_1000","fixed":false}, ... },
        ...
        "23": { ... }
      }
    }

A table present in an hour's bucket is PRICED (open) that hour; its dollar
minimum is the `tiers` $ value of the assignment's `base` tier id.

Output
------
A long dataframe — ONE ROW PER (date, hour, table) for every floor table x 24
hours — with `open` = 1/0 (1 = priced/open, 0 = closed) and the resolved
`table_minimum` ($, blank when closed):

    date | hour | gametype | table | segment | sub_segment | open | table_minimum | revised_date

Written to CSV (default) next to the input, or to --out. Use --wide to also
emit a table x hour matrix of the minimum (one row per table, 24 hour columns).

Usage
-----
    python scripts/restructure_pricing.py pricing_2026-07-03_v1.json
    python scripts/restructure_pricing.py ./exports -o pricing_long.csv --wide
"""
import argparse
import glob
import json
import os
import sys

import pandas as pd

LONG_COLS = ["date", "hour", "gametype", "table", "segment", "sub_segment",
             "open", "table_minimum", "revised_date"]
HOURS = list(range(24))


def _iter_input_files(paths):
    for p in paths:
        if os.path.isdir(p):
            yield from sorted(glob.glob(os.path.join(p, "*.json")))
        else:
            yield p


def _split_key(key):
    sep = key.find("|")
    return (key[:sep], key[sep + 1:]) if sep >= 0 else ("", key)


def _base_tier_id(assignment):
    """An assignment is {base,min,max,fixed} (base = tier id) or a bare id."""
    if isinstance(assignment, dict):
        return assignment.get("base")
    return assignment  # legacy: a bare tier id string


def restructure_one(doc, revised_date_override=None):
    date = str(doc.get("date", ""))[:10]
    revised_date = revised_date_override or doc.get("revised_date") or doc.get("exported_at", "")[:10] or None

    # tier id -> $ minimum
    tier_min = {t.get("id"): t.get("min") for t in doc.get("tiers", [])}

    # Table master (so closed tables still get rows). Fall back to the union of
    # keys seen across the hourly buckets when no master is present.
    tables = doc.get("tables")
    by_hour = doc.get("byHour", {}) or {}
    if not tables:
        seen = {}
        for bucket in by_hour.values():
            for key in (bucket or {}).keys():
                if key not in seen:
                    g, t = _split_key(key)
                    seen[key] = {"key": key, "gametype": g, "table": t,
                                 "segment": None, "sub_segment": None}
        tables = list(seen.values())

    rows = []
    for tbl in tables:
        key = tbl.get("key")
        if key is None:
            key = f"{tbl.get('gametype', '')}|{tbl.get('table', '')}"
        for h in HOURS:
            asg = (by_hour.get(str(h)) or {}).get(key)
            if asg is not None:
                tid = _base_tier_id(asg)
                minimum = tier_min.get(tid)
                open_flag = 1
            else:
                minimum = None
                open_flag = 0
            rows.append({
                "date": date,
                "hour": h,
                "gametype": tbl.get("gametype", ""),
                "table": str(tbl.get("table", "")),
                "segment": tbl.get("segment"),
                "sub_segment": tbl.get("sub_segment"),
                "open": open_flag,
                "table_minimum": minimum,
                "revised_date": revised_date,
            })
    return rows


def restructure(paths, revised_date=None):
    all_rows = []
    for path in _iter_input_files(paths):
        with open(path, "r", encoding="utf-8") as fh:
            doc = json.load(fh)
        if isinstance(doc, list):
            raise ValueError(f"{path}: looks like a scheduling export — use restructure_scheduling.py")
        rows = restructure_one(doc, revised_date_override=revised_date)
        all_rows.extend(rows)
        print(f"  · {os.path.basename(path)}: {len(rows)} rows", file=sys.stderr)

    if not all_rows:
        raise SystemExit("No rows produced from any input file.")

    out = pd.DataFrame(all_rows, columns=LONG_COLS)
    out["hour"] = out["hour"].astype(int)
    out["open"] = out["open"].astype(int).clip(0, 1)
    out["table_minimum"] = pd.to_numeric(out["table_minimum"], errors="coerce")
    out = (out
           .drop_duplicates(subset=["date", "hour", "table"], keep="last")
           .sort_values(["date", "table", "hour"])
           .reset_index(drop=True))
    return out


def to_wide(long_df):
    """One row per (date, table); 24 hour columns m00..m23 of the minimum."""
    wide = (long_df
            .pivot_table(index=["date", "gametype", "table", "segment", "sub_segment", "revised_date"],
                         columns="hour", values="table_minimum", aggfunc="last")
            .reset_index())
    wide.columns = [c if isinstance(c, str) else f"m{int(c):02d}" for c in wide.columns]
    return wide


def main():
    ap = argparse.ArgumentParser(description="Restructure pricing JSON → long dataframe.")
    ap.add_argument("inputs", nargs="+", help="JSON file(s) or a directory of them.")
    ap.add_argument("-o", "--out", help="Output CSV path (default: pricing_long.csv next to first input).")
    ap.add_argument("--revised-date", help="Override revised_date for every row (YYYY-MM-DD).")
    ap.add_argument("--wide", action="store_true", help="Also write a table x hour minimum matrix CSV.")
    args = ap.parse_args()

    long_df = restructure(args.inputs, revised_date=args.revised_date)

    out = args.out
    if not out:
        base = args.inputs[0]
        root = base if os.path.isdir(base) else os.path.dirname(base) or "."
        out = os.path.join(root, "pricing_long.csv")
    long_df.to_csv(out, index=False)
    print(f"Wrote {len(long_df):,} rows → {out}")

    if args.wide:
        wide_path = os.path.splitext(out)[0].replace("_long", "") + "_wide.csv"
        to_wide(long_df).to_csv(wide_path, index=False)
        print(f"Wrote wide matrix → {wide_path}")


if __name__ == "__main__":
    main()
