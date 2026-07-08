// Spread database — dedicated data source for the Scheduling dashboard
// =====================================================================
//
// This is the SPREAD database and is INDEPENDENT of the Performance
// Heatmap's hourly dataset. It is read ONLY by the scheduling dashboard.
// Do not couple this to data_hourly_cod.json or the performance fetchers.
//
// Wire shape — one row per (table × date × hour):
//   {
//     date:     "YYYY-MM-DD",
//     hour:     0..23,
//     gametype: "BJ" | "BA" | …,   (a.k.a. `game`)
//     table:    "10000",
//     spread:   0 | 1               1 = scheduled to be OPEN that hour
//   }
//
// Endpoint (configure at build time):
//   REACT_APP_SPREAD_API_URL=http://<host>:<port>/cod_spread
//   GET <url>?date=YYYY-MM-DD        — preferred (one date)
//   GET <url>                        — also accepted (all rows)
//
// Offline / no-endpoint behaviour: falls back to the bundled fixture
// src/spread/data/spread_cod.json (ships empty by default — drop a real
// spread export there for local dev, or configure the endpoint). The
// fetcher never throws: on any failure it returns the fixture so the
// dashboard is never broken.

import axios from 'axios';

const DEFAULT_SPREAD_API_URL =
    process.env.REACT_APP_SPREAD_API_URL || '';

// Earliest date to preload spread rows from, on dashboard access. The
// spread DB is by (table × date × hour) across all history, so we bound
// the preload to a recent window instead of pulling everything.
// Configurable at build time; defaults to the start of May 2026.
export const SPREAD_LOAD_FROM =
    process.env.REACT_APP_SPREAD_LOAD_FROM || '2026-05-01';

// Normalise one wire row → the canonical shape the derivation reads.
// Coerces types and trims the date so consumers never re-clean.
function normalizeSpreadRow(r) {
    const date = r.date ? String(r.date).slice(0, 10) : '';
    const hour = parseInt(r.hour, 10);
    const gametype = r.gametype ?? r.game ?? '';
    return {
        date,
        hour: Number.isFinite(hour) ? hour : null,
        gametype: String(gametype),
        table: r.table != null ? String(r.table) : '',
        // Binary: anything truthy / "1" → 1, else 0.
        spread: Number(r.spread) === 1 ? 1 : 0,
    };
}

function normalizeRows(rows) {
    if (!Array.isArray(rows)) return [];
    return rows.map(normalizeSpreadRow);
}

/**
 * Fetch spread rows from the spread database.
 *
 * @param {object}  opts
 * @param {string}  opts.date        optional — pull just this date
 * @param {string}  opts.url         override the endpoint
 * @param {number}  opts.timeoutMs   request timeout
 * @param {boolean} opts.fallback    fall back to the bundled fixture (default true)
 * @returns {Promise<Array>} normalised spread rows ([] when nothing available)
 */
export async function fetchSpreadHours({
    date = null,
    from = null,
    url = DEFAULT_SPREAD_API_URL,
    timeoutMs = 60000,
    fallback = true,
} = {}) {
    const loadFixture = () => {
        if (!fallback) return [];
        try {
            // Independent bundled fixture — NOT the performance hourly data.
            const data = require('../data/spread_cod.json');
            let rows = normalizeRows(data);
            // Apply the same date / from filters to the fixture so offline
            // dev mirrors the API's bounded responses.
            if (date) rows = rows.filter((r) => r.date === date);
            else if (from) rows = rows.filter((r) => r.date >= from);
            return rows;
        } catch {
            return [];
        }
    };

    if (!url) return loadFixture();

    // Query params: `date` (one day) takes precedence; otherwise `from`
    // bounds a preload window (GET <url>?from=YYYY-MM-DD).
    const params = [];
    if (date) params.push(`date=${encodeURIComponent(date)}`);
    else if (from) params.push(`from=${encodeURIComponent(from)}`);
    const fullUrl = params.length
        ? `${url}${url.includes('?') ? '&' : '?'}${params.join('&')}`
        : url;
    try {
        const res = await axios({
            url: fullUrl,
            method: 'get',
            timeout: timeoutMs,
            headers: { 'Content-Type': 'application/json' },
        });
        if (res.status !== 200 || !Array.isArray(res.data)) {
            throw new Error(`bad response (HTTP ${res.status})`);
        }
        let rows = normalizeRows(res.data);
        // DEFENSIVE: never trust the endpoint to honour the `date` / `from`
        // params — re-apply the same window the fixture path uses so a
        // response that includes other dates can't poison the derived plan.
        if (date) rows = rows.filter((r) => r.date === date);
        else if (from) rows = rows.filter((r) => r.date >= from);
        // eslint-disable-next-line no-console
        console.info(`[Spread/db] loaded ${rows.length} spread rows from API` +
            (date ? ` for ${date}` : from ? ` from ${from}` : ''));
        return rows;
    } catch (err) {
        // eslint-disable-next-line no-console
        console.warn(`[Spread/db] API fetch failed (${err.message}) — using bundled fixture`);
        return loadFixture();
    }
}
