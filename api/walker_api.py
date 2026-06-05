"""
walker_api.py
=============

Backend HTTP service for the Trend Seeker dashboard. Serves walker
hand-by-hand data for a given gaming date, in the exact JSON shape
`fetchTrendData()` in src/utils/trendDataSource.js expects.

Endpoint
--------
    GET /cod_walker_hands?date=YYYY-MM-DD

Response
--------
    HTTP 200: JSON array of hand rows (see ROW_FIELDS below)
    HTTP 400: { "error": "<reason>" }   on bad input
    HTTP 500: { "error": "<reason>" }   on DB / server error

Each row in the response array carries:
    table              str        table code (joins to config_cod.table)
    date               'YYYY-MM-DD'
    segment            'MS' | 'PM'
    pit                str
    num_players        int 0..7
    turnover           float      USD wagered on the hand
    theo_win           float      theoretical win for the hand
    table_min          float      table minimum bet active on this hand
    game_start_dtm     ISO ts     when the hand started
    game_end_dtm       ISO ts     when the hand ended
    shoe_id            int        monotonically-increasing per fresh shoe
    shoe_hand          int        1-indexed position within the shoe
    player_1st_card    'As'..'Kd' rank + suit (suit ∈ s/h/c/d)
    player_2nd_card    ...
    player_3rd_card    str | None
    banker_1st_card
    banker_2nd_card
    banker_3rd_card    str | None

Run locally
-----------
    pip install flask flask-cors sqlalchemy pyodbc python-dateutil
    set WALKER_DB_URL=mssql+pyodbc://user:pass@host/Walker?driver=ODBC+Driver+17+for+SQL+Server
    python api/walker_api.py
    # binds to 0.0.0.0:9000 by default

Run in production
-----------------
    pip install gunicorn
    gunicorn -w 4 -b 0.0.0.0:9000 walker_api:app

Wire to the React dashboard
---------------------------
In .env.local (or your deploy env):
    REACT_APP_TREND_API_URL=http://10.100.122.41:9000/cod_walker_hands
"""

import logging
import os
from datetime import date, datetime
from typing import Any, Dict, List

from flask import Flask, jsonify, request
from flask_cors import CORS
from sqlalchemy import create_engine, text
from sqlalchemy.engine import Engine

# ----------------------------------------------------------------------------
# Configuration
# ----------------------------------------------------------------------------

# SQLAlchemy connection URL. Swap the driver portion for your DB:
#   SQL Server:   mssql+pyodbc://user:pwd@host/Walker?driver=ODBC+Driver+17+for+SQL+Server
#   PostgreSQL:   postgresql+psycopg2://user:pwd@host:5432/walker
#   MySQL:        mysql+pymysql://user:pwd@host:3306/walker
DB_URL = os.environ.get(
    "WALKER_DB_URL",
    "mssql+pyodbc://user:pwd@host/Walker?driver=ODBC+Driver+17+for+SQL+Server",
)

# Origins allowed to call this API. Set to "*" only for dev; restrict for prod.
CORS_ORIGINS = os.environ.get("WALKER_CORS_ORIGINS", "*")

# Bind host/port (override via env or `gunicorn -b`).
HOST = os.environ.get("WALKER_HOST", "0.0.0.0")
PORT = int(os.environ.get("WALKER_PORT", "9000"))

# Hard cap so a stray request can't pull millions of rows.
MAX_ROWS = int(os.environ.get("WALKER_MAX_ROWS", "500000"))

# Column names that the JSON response uses, in display order.
ROW_FIELDS = (
    "table", "date", "segment", "pit",
    "num_players", "turnover", "theo_win", "table_min",
    "game_start_dtm", "game_end_dtm",
    "shoe_id", "shoe_hand",
    "player_1st_card", "player_2nd_card", "player_3rd_card",
    "banker_1st_card", "banker_2nd_card", "banker_3rd_card",
)

# ----------------------------------------------------------------------------
# SQL query
# ----------------------------------------------------------------------------
#
# Adjust column names + the source table/view to match your Walker schema.
# The expectation is one row per *hand*. If your schema names differ, alias
# them in the SELECT so the keys returned match ROW_FIELDS exactly.
#
# The bound parameter is :gaming_date (a Python date object) — never
# string-interpolate the date into the query (SQL injection).
#
WALKER_QUERY = text("""
    SELECT
        [table_code]        AS [table],
        CAST([gaming_date] AS DATE)                       AS [date],
        [segment_code]                                    AS [segment],
        [pit_code]                                        AS [pit],
        [num_players]                                     AS [num_players],
        [turnover]                                        AS [turnover],
        [theo_win]                                        AS [theo_win],
        [table_minimum]                                   AS [table_min],
        [game_start_dtm]                                  AS [game_start_dtm],
        [game_end_dtm]                                    AS [game_end_dtm],
        [shoe_id]                                         AS [shoe_id],
        [shoe_hand]                                       AS [shoe_hand],
        [player_1st_card]                                 AS [player_1st_card],
        [player_2nd_card]                                 AS [player_2nd_card],
        [player_3rd_card]                                 AS [player_3rd_card],
        [banker_1st_card]                                 AS [banker_1st_card],
        [banker_2nd_card]                                 AS [banker_2nd_card],
        [banker_3rd_card]                                 AS [banker_3rd_card]
    FROM [WalkerHands]                                       -- ⇐ your table/view
    WHERE [gaming_date] = :gaming_date
    ORDER BY [table_code], [game_start_dtm]                  -- optional; client re-sorts
""")

# ----------------------------------------------------------------------------
# App setup
# ----------------------------------------------------------------------------

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
log = logging.getLogger("walker_api")

app = Flask(__name__)
CORS(app, resources={r"/*": {"origins": CORS_ORIGINS}})

# Lazy-init the engine so module import never blocks even if the DB is down.
_engine: Engine | None = None


def get_engine() -> Engine:
    global _engine
    if _engine is None:
        log.info("opening DB connection pool: %s", _redact(DB_URL))
        _engine = create_engine(DB_URL, pool_pre_ping=True, pool_recycle=1800)
    return _engine


def _redact(url: str) -> str:
    # Hide password before logging the connection URL.
    if "://" not in url:
        return url
    scheme, rest = url.split("://", 1)
    if "@" in rest and ":" in rest.split("@", 1)[0]:
        user, host = rest.split("@", 1)
        user = user.split(":", 1)[0] + ":***"
        return f"{scheme}://{user}@{host}"
    return url


# ----------------------------------------------------------------------------
# Row coercion — keep types stable so the React client doesn't need to guess
# ----------------------------------------------------------------------------

def _iso(dt) -> str | None:
    if dt is None:
        return None
    if isinstance(dt, datetime):
        return dt.isoformat()
    if isinstance(dt, date):
        return dt.isoformat()
    return str(dt)


def _str_or_none(v) -> str | None:
    if v is None:
        return None
    s = str(v).strip()
    return s if s else None


def _coerce_row(row: Dict[str, Any]) -> Dict[str, Any]:
    """Normalize a DB row into the JSON shape the dashboard expects.

    Type contract (mirrors src/utils/trendDataSource.js):
        table, pit        -> string
        num_players, shoe_id, shoe_hand -> int (0 if NULL)
        turnover, theo_win, table_min   -> float (0.0 if NULL)
        date              -> 'YYYY-MM-DD'
        *_dtm             -> ISO-8601 string
        cards             -> 2-char string or None
    """
    return {
        "table":           str(row["table"]) if row["table"] is not None else "",
        "date":            row["date"].isoformat() if isinstance(row["date"], date) else str(row["date"]),
        "segment":         _str_or_none(row["segment"]),
        "pit":             str(row["pit"]) if row["pit"] is not None else "",
        "num_players":     int(row["num_players"] or 0),
        "turnover":        float(row["turnover"] or 0.0),
        "theo_win":        float(row["theo_win"] or 0.0),
        "table_min":       float(row["table_min"] or 0.0),
        "game_start_dtm":  _iso(row["game_start_dtm"]),
        "game_end_dtm":    _iso(row["game_end_dtm"]),
        "shoe_id":         int(row["shoe_id"] or 0),
        "shoe_hand":       int(row["shoe_hand"] or 0),
        "player_1st_card": _str_or_none(row["player_1st_card"]),
        "player_2nd_card": _str_or_none(row["player_2nd_card"]),
        "player_3rd_card": _str_or_none(row["player_3rd_card"]),
        "banker_1st_card": _str_or_none(row["banker_1st_card"]),
        "banker_2nd_card": _str_or_none(row["banker_2nd_card"]),
        "banker_3rd_card": _str_or_none(row["banker_3rd_card"]),
    }


# ----------------------------------------------------------------------------
# Endpoints
# ----------------------------------------------------------------------------

@app.get("/cod_walker_hands")
def cod_walker_hands():
    raw = request.args.get("date", "").strip()
    if not raw:
        return jsonify({"error": "missing required query parameter: date=YYYY-MM-DD"}), 400

    try:
        gaming_date = datetime.strptime(raw, "%Y-%m-%d").date()
    except ValueError:
        return jsonify({"error": f"invalid date '{raw}', expected YYYY-MM-DD"}), 400

    try:
        rows = _fetch_walker_hands(gaming_date)
    except Exception as exc:  # noqa: BLE001 — surface DB/driver errors to the caller
        log.exception("walker query failed for date=%s", gaming_date)
        return jsonify({"error": f"query failed: {exc.__class__.__name__}"}), 500

    log.info("served %d walker rows for date=%s", len(rows), gaming_date)
    return jsonify(rows)


@app.get("/healthz")
def healthz():
    # Lightweight liveness probe — does not hit the DB.
    return jsonify({"status": "ok"})


@app.get("/readyz")
def readyz():
    # Readiness probe — confirms the DB is reachable.
    try:
        with get_engine().connect() as conn:
            conn.execute(text("SELECT 1"))
        return jsonify({"status": "ready"})
    except Exception as exc:  # noqa: BLE001
        return jsonify({"status": "not_ready", "error": str(exc)}), 503


# ----------------------------------------------------------------------------
# Data layer
# ----------------------------------------------------------------------------

def _fetch_walker_hands(gaming_date: date) -> List[Dict[str, Any]]:
    engine = get_engine()
    with engine.connect() as conn:
        result = conn.execute(WALKER_QUERY, {"gaming_date": gaming_date})
        rows = result.mappings().fetchmany(MAX_ROWS + 1)

    if len(rows) > MAX_ROWS:
        log.warning(
            "MAX_ROWS=%d cap hit for date=%s — truncating; widen WALKER_MAX_ROWS if intentional",
            MAX_ROWS, gaming_date,
        )
        rows = rows[:MAX_ROWS]

    return [_coerce_row(dict(r)) for r in rows]


# ----------------------------------------------------------------------------
# Entry point
# ----------------------------------------------------------------------------

if __name__ == "__main__":
    log.info("starting walker_api on %s:%d", HOST, PORT)
    app.run(host=HOST, port=PORT, debug=False)
