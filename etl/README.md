# Data Pipeline

How to turn your raw hand-by-hand baccarat data into the chunked
minute-level frames the trend-seeker dashboard consumes.

```
┌──────────────────┐    ┌─────────────────┐    ┌──────────────────┐    ┌───────────┐
│ Raw hands        │ →  │ hands_to_       │ →  │ Hourly JSON      │ →  │ Dashboard │
│ (CSV / Parquet)  │    │   frames.py     │    │ chunks +         │    │ (React +  │
│                  │    │ (forward fill + │    │ index.json       │    │ FrameLoader)│
│                  │    │  trend compute) │    │                  │    │           │
└──────────────────┘    └─────────────────┘    └──────────────────┘    └───────────┘
```

## Why minute-level frames?

Tables don't deal hands in lock-step — Pit A may deal a hand every 50s while
a VIP table deals every 110s. The dashboard plays back time as a continuous
animation, so for every minute it needs **a snapshot of every table's current
state**, even tables that didn't deal a hand in that minute (forward-fill
their previous state).

## Why chunked output?

A single day at 75 tables ≈ 27 MB raw JSON / ~5 MB gzipped. A month is
800 MB. The browser shouldn't load all of that at startup. The pipeline
splits frames into one file per hour (60 frames each, ~1 MB), and the
JS loader fetches them on demand with a ±1 hour rolling buffer.

---

## Input schema

### `hands` table (CSV / Parquet)

| column      | type          | description                                       |
| ----------- | ------------- | ------------------------------------------------- |
| `table_id`  | int           | FK to tables                                      |
| `shoe_id`   | int           | increments per fresh shoe — resets shoe history   |
| `shoe_hand` | int           | 1..~70 — position within the shoe                 |
| `hand_time` | ISO timestamp | when the hand was dealt                           |
| `result`    | 'B' / 'P'     | filter out 'T' (ties) before sending              |
| `headcount` | int 0..7      | seated players AT this hand                       |
| `avg_bet`   | float         | mean bet placed on this hand (USD)                |

If `headcount` or `avg_bet` is null for a hand, the pipeline forward-fills
from the previous hand on that table.

### `tables.csv` (static floor layout)

| column      | description                                               |
| ----------- | --------------------------------------------------------- |
| `id`        | unique table id                                           |
| `label`     | display name e.g. `T01`                                   |
| `pit`       | A / B / C / D                                             |
| `pit_label` | full pit name e.g. `Pit A · Mass`                         |
| `x`         | x coordinate on the floor (0..1400)                       |
| `y`         | y coordinate on the floor (0..900)                        |
| `min`       | table minimum bet in USD                                  |

## Output schema

### `index.json` (master manifest, loaded once at startup)

```json
{
  "version": 1,
  "tables": [{ "id": 1, "label": "T01", "pit": "A", "x": 80, "y": 90, "min": 50 }, ...],
  "chunks": [
    { "hour": "2026-05-13T19",
      "file": "frames-2026-05-13T19.json",
      "frame_count": 60,
      "first_minute": 0,
      "last_minute": 59,
      "first_timestamp": "2026-05-13T19:00:00+00:00" },
    ...
  ],
  "total_minutes": 1440,
  "minute_resolution_sec": 60
}
```

### `frames-YYYY-MM-DDTHH.json` (one hour of frames)

```json
{
  "hour": "2026-05-13T19",
  "frames": [
    {
      "minute": 0,
      "timestamp": "2026-05-13T19:00:00+00:00",
      "hour": 19,
      "per_table": [
        { "table_id": 1, "shoe_id": 1, "shoe_hand": 12,
          "history": "BBPBBPP", "shoe_history": "BBPBBPP",
          "headcount": 4, "avg_bet": 88,
          "surprise": 2, "period": 3, "length": 5, "motif": "BBP",
          "broken": false, "broken_length": 0 },
        ...
      ]
    },
    ...
  ]
}
```

Compact serialization (`separators=(",", ":")`) — gzip in transport via your
web server. Each per-table object is ~250 bytes; 75 tables × 60 minutes
≈ 1.1 MB per chunk file.

---

## Running it

```powershell
# from the trend_seeker directory
pip install pandas pyarrow
python etl/hands_to_frames.py `
    --hands  data/hands.parquet `
    --tables data/tables.csv `
    --out    public/frames/
```

The chunks land in `public/frames/`, served at `http://localhost:3456/frames/*`.

## Wiring it into the dashboard

Replace `generateTimeSeries` in `src/App.js` with the FrameLoader:

```jsx
import { FrameLoader } from './utils/frameLoader';

export default function App() {
  const [sim, setSim] = useState(null);
  const loaderRef = useRef(null);

  useEffect(() => {
    const loader = new FrameLoader('/frames/');
    loaderRef.current = loader;
    loader.init().then(() => {
      setSim({
        tables: loader.tables,
        frameCount: loader.totalMinutes,
        getFrame: (m) => loader.getFrame(m),
      });
    });
    return () => { loaderRef.current = null; };
  }, []);

  // Whenever minute changes, ensure that hour's chunk is loaded
  useEffect(() => {
    loaderRef.current?.ensureAround(minute);
  }, [minute]);

  if (!sim) return <Loading />;
  const frame = sim.getFrame(minute);
  // ...rest of the dashboard
}
```

If `sim.getFrame(minute)` returns `null`, the chunk hasn't loaded yet —
show a spinner over the floor for ~200ms while it streams in. The loader
prefetches ±1 hour so this only happens at the very start.

---

## Performance & engineering notes

### Memory bound

| Window | Cached hours | Memory |
| ------ | ------------ | ------ |
| ±1 hour radius (default) | 3 | ~3 MB |
| ±3 hours | 7 | ~7 MB |
| Whole day | 24 | ~25 MB |

Adjust `BUFFER_RADIUS` in `frameLoader.js`. For a casino-operations live
display you only need ±1 hour; for an analyst exploring a whole day,
bump to ±6 or just preload everything.

### Live streaming variant

If your data source is real-time:
- Replace hourly chunk files with an SSE / WebSocket endpoint that
  pushes one frame per minute as it becomes finalized
- Keep the same `per_table` shape — the loader just buffers them
- Drop chunks beyond your retention window (e.g. last 4 hours rolling)

### Sharding strategies

- **By hour** (recommended) — simple, gzip-friendly, ~1 MB per file
- **By half-hour** — for tables-heavy floors (>200 tables) to keep
  individual files under 1 MB
- **By table batches** — only useful if you display a subset at a time;
  not applicable for the full-floor view

### Skip the trend pre-computation if you prefer

The Python script runs the anchored DTP server-side and bakes
`surprise`, `period`, `motif`, `broken` into each frame. If you'd rather
keep the JSON smaller and compute them client-side, drop those fields
from the writer and call `analyzeHand(perTable.shoe_history)` in the
React component instead. Saves ~30% on payload but uses some CPU per
frame on render.

### Filtering ties

Strip rows where `result == 'T'` *before* aggregation. The trend
algorithm is defined over `{B, P}` only — a tie is a pause, not a
data point that affects the shape.

### Out-of-order hands

The aggregator sorts by `(table_id, hand_time)`, so out-of-order
arrivals are fine as long as you re-run the ETL whenever new data lands.
For a live pipeline, batch by 5-minute windows and rebuild only those
chunks.
