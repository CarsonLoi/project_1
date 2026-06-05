# Walker Hands API

HTTP service the Trend Seeker dashboard calls when the user picks a date.
Single endpoint, no auth, JSON in / JSON out.

```
┌────────────────────┐                                     ┌──────────────────────┐
│ React dashboard    │  GET /cod_walker_hands?date=…  →    │ walker_api.py        │
│ fetchTrendData()   │  ← JSON array of walker hands       │  (Flask + SQLAlchemy)│
└────────────────────┘                                     └──────────┬───────────┘
                                                                      │ SQL
                                                                      ▼
                                                            ┌──────────────────┐
                                                            │ Walker DB        │
                                                            │ (WalkerHands tbl)│
                                                            └──────────────────┘
```

## Endpoint

```
GET /cod_walker_hands?date=YYYY-MM-DD
```

| Code | Body |
| ---- | ---- |
| `200` | JSON array of hand rows (schema below) |
| `400` | `{ "error": "missing required query parameter: date=YYYY-MM-DD" }` |
| `400` | `{ "error": "invalid date 'foo', expected YYYY-MM-DD" }` |
| `500` | `{ "error": "query failed: <ExceptionName>" }` |

### Response row schema

Mirrors the type contract enforced client-side in
[`src/utils/trendDataSource.js`](../src/utils/trendDataSource.js).

```jsonc
[
  {
    "table":           "87807",            // string
    "date":            "2026-05-19",        // YYYY-MM-DD
    "segment":         "MS",                // "MS" | "PM"
    "pit":             "878",               // string
    "num_players":     4,                   // int 0..7
    "turnover":        12000.0,             // float (USD)
    "theo_win":        240.0,               // float
    "table_min":       1000.0,              // float
    "game_start_dtm":  "2026-05-19T19:00:12",
    "game_end_dtm":    "2026-05-19T19:00:48",
    "shoe_id":         7,                   // int, monotone per fresh shoe
    "shoe_hand":       23,                  // int, 1-indexed
    "player_1st_card": "As",                // "<rank><suit>", suit ∈ s/h/c/d
    "player_2nd_card": "7h",
    "player_3rd_card": null,                // null when not dealt
    "banker_1st_card": "4s",
    "banker_2nd_card": "3c",
    "banker_3rd_card": "5d"
  }
]
```

## Running locally

```bash
pip install flask flask-cors sqlalchemy pyodbc python-dateutil
export WALKER_DB_URL='mssql+pyodbc://user:pwd@host/Walker?driver=ODBC+Driver+17+for+SQL+Server'
python api/walker_api.py
# binds 0.0.0.0:9000 by default

# smoke test
curl 'http://localhost:9000/cod_walker_hands?date=2026-05-19' | jq '. | length'
```

## Running in production

```bash
pip install gunicorn
gunicorn -w 4 -b 0.0.0.0:9000 walker_api:app
```

Behind nginx / Traefik / IIS — terminate TLS upstream, leave gunicorn on plain HTTP.

Docker (optional):

```dockerfile
FROM python:3.11-slim
RUN apt-get update && apt-get install -y unixodbc-dev && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY walker_api.py .
RUN pip install --no-cache-dir flask flask-cors sqlalchemy pyodbc gunicorn
ENV WALKER_PORT=9000
EXPOSE 9000
CMD ["gunicorn", "-w", "4", "-b", "0.0.0.0:9000", "walker_api:app"]
```

## Environment variables

| Var | Default | Notes |
| --- | --- | --- |
| `WALKER_DB_URL` | placeholder | SQLAlchemy URL — see comments at top of `walker_api.py` for SQL Server / Postgres / MySQL examples |
| `WALKER_CORS_ORIGINS` | `*` | Restrict to your dashboard's origin in prod (e.g. `https://analytics.example.com`) |
| `WALKER_HOST` | `0.0.0.0` | Bind interface |
| `WALKER_PORT` | `9000` | Bind port |
| `WALKER_MAX_ROWS` | `500000` | Hard cap per request — prevents accidental million-row pulls |

## Adapting to your Walker schema

The SQL in `walker_api.py` (constant `WALKER_QUERY`) is written against
a placeholder `WalkerHands` table with the column names below. **Edit
the SQL — not the row coercion** — to match your real schema; the
SELECT aliases are what shape the JSON response.

| JSON key | Default source column | Notes |
| --- | --- | --- |
| `table` | `table_code` | string |
| `date` | `gaming_date` | DATE |
| `segment` | `segment_code` | `'MS'` or `'PM'` |
| `pit` | `pit_code` | string |
| `num_players` | `num_players` | INT |
| `turnover` | `turnover` | DECIMAL |
| `theo_win` | `theo_win` | DECIMAL |
| `table_min` | `table_minimum` | DECIMAL |
| `game_start_dtm` | `game_start_dtm` | DATETIME |
| `game_end_dtm` | `game_end_dtm` | DATETIME |
| `shoe_id` | `shoe_id` | INT |
| `shoe_hand` | `shoe_hand` | INT |
| `player_*_card`, `banker_*_card` | same | 2-char `"<rank><suit>"` (e.g. `"As"`, `"Th"`) |

If your raw cards are stored differently (e.g., separate `rank` + `suit`
columns, or full names like `'Diamond A'`), do the concat inside the
SQL so the API still emits the compact 2-char form. The client parser
is tolerant of both formats, but the compact form is half the payload
size.

## Probes

| Route | Purpose |
| --- | --- |
| `GET /healthz` | Liveness — returns 200 without touching the DB |
| `GET /readyz` | Readiness — runs `SELECT 1`; returns 503 if DB unreachable |

## Connecting the dashboard

In your CRA env (e.g. `.env.local`):

```
REACT_APP_TREND_API_URL=http://10.100.122.41:9000/cod_walker_hands
```

…then restart `npm start`. The dashboard appends `?date=YYYY-MM-DD`
from the date picker and renders the response.

## Failure modes the dashboard already handles

- API unreachable / CORS blocked → falls back to synthetic
  `generateTimeSeries()` data, logs `[Trend] live fetch failed: …`.
- Empty response → also triggers the synthetic fallback.
- Non-array response → same.

So a misconfigured endpoint won't break the demo — but you'll see the
warning in the browser console.
