#!/usr/bin/env python3
"""
restructure_scheduling.py
=========================

Restructure a SCHEDULING (spread) export from the Spread dashboard into a
tidy long dataframe ready to load into the spread database.

Input
-----
One or more `spread-upload-<date>.json` files (or a directory of them).
Each file is a flat JSON array of rows:

    [
      {"date":"2026-07-03","hour":0,"gametype":"BJ","table":"10000",
       "segment":"MS","sub_segment":"Main","spread":1,"revised_date":"2026-06-26"},
      ...
    ]

Older exports may omit `segment` / `sub_segment` / `revised_date` — those are
filled (segment/sub_segment left blank; revised_date from --revised-date or the
file's own value, else null).

Output
------
A long dataframe — ONE ROW PER (date, hour, table) — with `open` = 1/0
(1 = scheduled open that hour, 0 = closed):

    date | hour | gametype | table | segment | sub_segment | open | revised_date

Written to CSV (default) next to the input, or to --out. Use --wide to also
emit a table x hour matrix (one row per table, 24 hour columns of 1/0).

Usage
-----
    python scripts/restructure_scheduling.py spread-upload-2026-07-03.json
    python scripts/restructure_scheduling.py ./exports -o schedule_long.csv
    python scripts/restructure_scheduling.py ./exports --revised-date 2026-06-26 --wide
"""
import argparse
import glob
import json
import os
import sys

import pandas as pd

LONG_COLS = ["date", "hour", "gametype", "table", "segment", "sub_segment", "open", "revised_date"]


def _iter_input_files(paths):
    for p in paths:
        if os.path.isdir(p):
            yield from sorted(glob.glob(os.path.join(p, "*.json")))
        else:
            yield p


def _load_rows(path):
    """Load a spread export → list of row dicts. Accepts a bare array or a
    wrapper object with a `rows` key."""
    with open(path, "r", encoding="utf-8") as fh:
        data = json.load(fh)
    if isinstance(data, dict):
        data = data.get("rows", [])
    if not isinstance(data, list):
        raise ValueError(f"{path}: expected a JSON array of rows")
    return data


def restructure(paths, revised_date=None):
    frames = []
    for path in _iter_input_files(paths):
        rows = _load_rows(path)
        if not rows:
            print(f"  · {os.path.basename(path)}: 0 rows (skipped)", file=sys.stderr)
            continue
        df = pd.DataFrame(rows)
        # `spread` (1/0) is the open/closed flag → rename to `open`.
        if "open" not in df.columns and "spread" in df.columns:
            df = df.rename(columns={"spread": "open"})
        # Ensure every expected column exists.
        for col in ("gametype", "table", "segment", "sub_segment", "revised_date"):
            if col not in df.columns:
                df[col] = pd.NA
        if "open" not in df.columns:
            raise ValueError(f"{path}: no `spread`/`open` column found")
        # CLI revised_date overrides whatever is in the file.
        if revised_date:
            df["revised_date"] = revised_date
        frames.append(df)
        print(f"  · {os.path.basename(path)}: {len(df)} rows", file=sys.stderr)

    if not frames:
        raise SystemExit("No rows found in any input file.")

    out = pd.concat(frames, ignore_index=True)
    # Types: keep date/revised_date as ISO strings; hour + open as ints.
    out["date"] = out["date"].astype(str).str.slice(0, 10)
    out["hour"] = pd.to_numeric(out["hour"], errors="coerce").astype("Int64")
    out["open"] = pd.to_numeric(out["open"], errors="coerce").fillna(0).astype(int).clip(0, 1)
    out["table"] = out["table"].astype(str)
    # De-dup (a table x hour should be unique within a date) keeping the last.
    out = (out[LONG_COLS]
           .drop_duplicates(subset=["date", "hour", "table"], keep="last")
           .sort_values(["date", "table", "hour"])
           .reset_index(drop=True))
    return out


def to_wide(long_df):
    """One row per (date, table); 24 hour columns h00..h23 of 1/0."""
    wide = (long_df
            .pivot_table(index=["date", "gametype", "table", "segment", "sub_segment", "revised_date"],
                         columns="hour", values="open", aggfunc="last", fill_value=0)
            .reset_index())
    wide.columns = [c if isinstance(c, str) else f"h{int(c):02d}" for c in wide.columns]
    return wide


def main():
    ap = argparse.ArgumentParser(description="Restructure scheduling (spread) JSON → long dataframe.")
    ap.add_argument("inputs", nargs="+", help="JSON file(s) or a directory of them.")
    ap.add_argument("-o", "--out", help="Output CSV path (default: schedule_long.csv next to first input).")
    ap.add_argument("--revised-date", help="Override revised_date for every row (YYYY-MM-DD).")
    ap.add_argument("--wide", action="store_true", help="Also write a table x hour (h00..h23) matrix CSV.")
    args = ap.parse_args()

    long_df = restructure(args.inputs, revised_date=args.revised_date)

    out = args.out
    if not out:
        base = args.inputs[0]
        root = base if os.path.isdir(base) else os.path.dirname(base) or "."
        out = os.path.join(root, "schedule_long.csv")
    long_df.to_csv(out, index=False)
    print(f"Wrote {len(long_df):,} rows → {out}")

    if args.wide:
        wide_path = os.path.splitext(out)[0].replace("_long", "") + "_wide.csv"
        to_wide(long_df).to_csv(wide_path, index=False)
        print(f"Wrote wide matrix → {wide_path}")


if __name__ == "__main__":
    main()
