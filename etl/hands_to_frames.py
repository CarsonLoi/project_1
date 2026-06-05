"""
hands_to_frames.py
==================

Convert hand-by-hand baccarat data into the minute-level frame format
the trend-seeker dashboard expects, then split into hourly chunks for
lazy loading in the browser.

INPUT
-----
A pandas DataFrame (or CSV/Parquet) with these columns:
    table_id      int            FK to tables.csv
    shoe_id       int            increments per fresh shoe at the table
    shoe_hand     int            1..~70, position of this hand within the shoe
    hand_time     ISO timestamp  when the hand was dealt
    result        'B' | 'P'      filter out 'T' before sending
    headcount     int 0..7
    avg_bet       float          USD

Plus a tables file (CSV) with floor layout:
    id, label, pit, pit_label, x, y, min

OUTPUT
------
A directory containing:
    index.json                       master manifest of chunks
    frames-YYYY-MM-DDTHH.json        one file per hour (60 frames each)

The dashboard pulls index.json once, then fetches hourly files on demand
as the user scrubs the time slider.

USAGE
-----
    python hands_to_frames.py \\
        --hands data/hands.parquet \\
        --tables data/tables.csv \\
        --out  ../public/frames/

"""

import argparse
import json
import os
from collections import defaultdict
from pathlib import Path

import pandas as pd


# ----------------------------------------------------------------------------
# Anchored DTP (same algorithm as src/utils/trendAnalyzer.js — keep in sync)
# ----------------------------------------------------------------------------

def is_canonical_motif(motif: str) -> bool:
    if len(motif) <= 1:
        return True
    transitions = 0
    for i in range(1, len(motif)):
        if motif[i] != motif[i - 1]:
            transitions += 1
            if transitions > 1:
                return False
    return True


def detect_dominant_pattern(suffix: str):
    k = len(suffix)
    if k == 0:
        return {"p": 0, "L": 0, "surprise": 0, "motif": "", "reps": 0}

    best = {
        "p": 1,
        "L": 1,
        "surprise": 0,
        "motif": suffix[-1],
        "reps": 1,
    }

    for p in range(1, 6):
        if p > k:
            break
        L = p
        while L < k:
            new_idx = k - 1 - L
            cmp_idx = new_idx + p
            if cmp_idx >= k:
                break
            if suffix[new_idx] == suffix[cmp_idx]:
                L += 1
            else:
                break

        # Walk back to first canonical motif (handles phase alignment)
        for try_L in range(L, p - 1, -1):
            motif = suffix[k - try_L : k - try_L + p]
            if not is_canonical_motif(motif):
                continue
            surprise = try_L - p
            reps = try_L / p
            better = surprise > best["surprise"] or (
                surprise == best["surprise"] and reps > best["reps"]
            )
            if better:
                best = {
                    "p": p,
                    "L": try_L,
                    "surprise": surprise,
                    "motif": motif,
                    "reps": reps,
                }
            break

    return best


# ----------------------------------------------------------------------------
# Forward-fill per-minute aggregation
# ----------------------------------------------------------------------------

def aggregate_to_frames(hands_df: pd.DataFrame, tables_df: pd.DataFrame):
    """
    For each minute in [first_hand, last_hand], emit a frame with the
    most recent state of every table (forward-filled from prior hands).
    """
    hands_df = hands_df.copy()
    hands_df["hand_time"] = pd.to_datetime(hands_df["hand_time"], utc=True)
    hands_df = hands_df[hands_df["result"].isin(["B", "P"])]
    hands_df = hands_df.sort_values(["table_id", "hand_time"]).reset_index(drop=True)

    if len(hands_df) == 0:
        return []

    t0 = hands_df["hand_time"].min().floor("min")
    t1 = hands_df["hand_time"].max().ceil("min")
    minutes = pd.date_range(t0, t1, freq="1min")

    table_ids = tables_df["id"].tolist()
    hands_by_table = {
        tid: g.reset_index(drop=True) for tid, g in hands_df.groupby("table_id")
    }

    # Running state per table
    state = {
        tid: {
            "shoe_history": "",
            "shoe_id": None,
            "shoe_hand": 0,
            "headcount": 0,
            "avg_bet": float(tables_df.set_index("id").loc[tid, "min"])
            if tid in tables_df["id"].values
            else 50.0,
            "cursor": 0,
            "prev_surprise": 0,
            "prev_length": 0,
        }
        for tid in table_ids
    }

    frames = []
    for m, minute_ts in enumerate(minutes):
        cutoff = minute_ts + pd.Timedelta(minutes=1)
        per_table = []

        for tid in table_ids:
            st = state[tid]

            # Advance through any hands that happened up to `cutoff`
            arr = hands_by_table.get(tid)
            if arr is not None:
                while st["cursor"] < len(arr) and arr.at[st["cursor"], "hand_time"] < cutoff:
                    row = arr.iloc[st["cursor"]]
                    if st["shoe_id"] != row["shoe_id"]:
                        st["shoe_id"] = int(row["shoe_id"])
                        st["shoe_history"] = ""
                    st["shoe_history"] += row["result"]
                    st["shoe_hand"] = int(row["shoe_hand"])
                    if pd.notna(row.get("headcount")):
                        st["headcount"] = int(row["headcount"])
                    if pd.notna(row.get("avg_bet")):
                        st["avg_bet"] = float(row["avg_bet"])
                    st["cursor"] += 1

            trend = detect_dominant_pattern(st["shoe_history"] or "B")
            broken = st["prev_surprise"] >= 3 and trend["surprise"] < 3

            per_table.append({
                "table_id": tid,
                "shoe_id": st["shoe_id"],
                "shoe_hand": st["shoe_hand"],
                "history": st["shoe_history"][-15:],
                "shoe_history": st["shoe_history"],
                "headcount": st["headcount"],
                "avg_bet": round(st["avg_bet"]),
                "surprise": trend["surprise"],
                "period": trend["p"],
                "length": trend["L"],
                "motif": trend["motif"],
                "broken": broken,
                "broken_length": st["prev_length"] if broken else 0,
            })

            st["prev_surprise"] = trend["surprise"]
            st["prev_length"] = trend["L"]

        frames.append({
            "minute": m,
            "timestamp": minute_ts.isoformat(),
            "hour": int(minute_ts.hour),
            "per_table": per_table,
        })

    return frames


# ----------------------------------------------------------------------------
# Chunked writer — one file per hour + master index
# ----------------------------------------------------------------------------

def write_hourly_chunks(frames, tables_df, output_dir: Path):
    output_dir.mkdir(parents=True, exist_ok=True)

    by_hour = defaultdict(list)
    for f in frames:
        hour_key = f["timestamp"][:13]  # 'YYYY-MM-DDTHH'
        by_hour[hour_key].append(f)

    chunks = []
    for hour_key, hour_frames in sorted(by_hour.items()):
        filename = f"frames-{hour_key.replace(':', '')}.json"
        path = output_dir / filename
        with open(path, "w") as fh:
            json.dump(
                {"hour": hour_key, "frames": hour_frames},
                fh,
                separators=(",", ":"),  # compact JSON
            )
        chunks.append({
            "hour": hour_key,
            "file": filename,
            "frame_count": len(hour_frames),
            "first_minute": hour_frames[0]["minute"],
            "last_minute": hour_frames[-1]["minute"],
            "first_timestamp": hour_frames[0]["timestamp"],
        })

    tables = (
        tables_df.rename(columns={"min": "min", "pit_label": "pit_label"})
        .to_dict(orient="records")
    )
    index = {
        "version": 1,
        "tables": tables,
        "chunks": chunks,
        "total_minutes": sum(c["frame_count"] for c in chunks),
        "minute_resolution_sec": 60,
    }
    with open(output_dir / "index.json", "w") as fh:
        json.dump(index, fh, indent=2)

    print(f"Wrote {len(chunks)} hourly chunks to {output_dir}")
    print(f"Total minutes: {index['total_minutes']}")


# ----------------------------------------------------------------------------
# CLI
# ----------------------------------------------------------------------------

def load_dataframe(path: str) -> pd.DataFrame:
    p = Path(path)
    if p.suffix in (".parquet", ".pq"):
        return pd.read_parquet(p)
    if p.suffix == ".csv":
        return pd.read_csv(p)
    if p.suffix in (".jsonl", ".ndjson"):
        return pd.read_json(p, lines=True)
    raise ValueError(f"Unsupported file type: {p.suffix}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--hands", required=True, help="CSV/Parquet of hands")
    ap.add_argument("--tables", required=True, help="CSV of tables")
    ap.add_argument("--out", required=True, help="Output directory for chunks")
    args = ap.parse_args()

    hands = load_dataframe(args.hands)
    tables = load_dataframe(args.tables)

    print(f"Loaded {len(hands):,} hands from {args.hands}")
    print(f"Loaded {len(tables):,} tables from {args.tables}")
    print("Aggregating to minute frames...")

    frames = aggregate_to_frames(hands, tables)
    print(f"Generated {len(frames):,} frames")

    write_hourly_chunks(frames, tables, Path(args.out))


if __name__ == "__main__":
    main()
