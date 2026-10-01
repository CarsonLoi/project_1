// Live Casino Win — data source.
// ==============================
// Fetches the live feed (per-table + per-patron + hand-by-hand rounds).
// Two config knobs:
//   • REACT_APP_LIVE_API_URL     — remote endpoint (else falls back to
//                                   the bundled mock file).
//   • REACT_APP_LIVE_REFRESH_MS  — default poll interval (ms).
// The refresh interval is overridable at runtime via the header dropdown;
// the env var only sets the STARTING value.
//
// The mock file lives at src/live/data/live_cod.mock.json — same feed
// shape the real endpoint should return.

const LIVE_API_URL = process.env.REACT_APP_LIVE_API_URL || null;
const DEFAULT_REFRESH_MS = Number(process.env.REACT_APP_LIVE_REFRESH_MS) || 30_000;

export function getDefaultRefreshMs() { return DEFAULT_REFRESH_MS; }

// Feed shape returned by both the real endpoint and the mock file:
//   {
//     asOf:          ISO timestamp,
//     gamingDate:    'YYYY-MM-DD',
//     sessionStart:  ISO,
//     tables:        [{ gametype, table, tableKey, cumWin, cumWager, hands,
//                        headcount, lastRoundTs }],
//     patrons:       [{ patronId, cardType, segment, signInMinsAgo, cumWin,
//                        cumWager, hands, tablesPlayed }],
//     rounds:        [{ ts, patronId, gametype, table, tableKey, betOption,
//                        wager, winLoss }],
//     ytdByPatron:   { [patronId]: { months: [{ month, visits, hoursOnFloor,
//                        cumWagerCasinoPerspective, netWinLossCasinoPerspective }] } },
//   }
//
// Sign convention: EVERY winLoss / cumWin figure is CASINO PERSPECTIVE.
// Positive = casino won that much. Negative = patron won that much.
export async function fetchLive({ date, timeoutMs = 30_000 } = {}) {
    if (LIVE_API_URL) {
        try {
            const ctrl = new AbortController();
            const to = setTimeout(() => ctrl.abort(), timeoutMs);
            const url = new URL(LIVE_API_URL);
            if (date) url.searchParams.set('date', date);
            const r = await fetch(url.toString(), { signal: ctrl.signal });
            clearTimeout(to);
            if (r.ok) return await r.json();
            // fall through to mock on non-OK
        } catch { /* fall through to mock */ }
    }
    // Bundled mock — the build inlines it.
    return require('../data/live_cod.mock.json');
}

// Convenience: is the current build using the mock feed?
export function isMockFeed() { return !LIVE_API_URL; }
export function getApiUrl() { return LIVE_API_URL; }
