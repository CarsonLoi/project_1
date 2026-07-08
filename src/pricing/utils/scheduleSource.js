// Schedule source (pricing) — which tables are scheduled OPEN per hour
// =====================================================================
//
// Cloned from the scheduling spreadDataSource so the pricing dashboard does
// not depend on the spread module. Reads the same SPREAD database (one row
// per table × date × hour, spread=1 = scheduled open) and drives the
// pricing floor's hour-aware open-table highlight + the hourly charts'
// scheduled-open filter.
//
// Wire shape — one row per (table × date × hour):
//   { date: "YYYY-MM-DD", hour: 0..23, gametype: "BJ"|…, table: "10000", spread: 0|1 }
//
// Endpoint (configure at build time):
//   REACT_APP_SPREAD_API_URL=http://<host>:<port>/cod_spread
//   GET <url>?date=YYYY-MM-DD        — preferred (one date)
//   GET <url>                        — also accepted (all rows)
//
// Offline / no-endpoint behaviour: falls back to the bundled fixture
// src/pricing/data/schedule_cod.json (ships empty — drop a real spread
// export there for local dev, or configure the endpoint). Never throws.

import axios from 'axios';

const DEFAULT_SPREAD_API_URL = process.env.REACT_APP_SPREAD_API_URL || '';

// Earliest date to preload spread rows from, on dashboard access.
export const SCHEDULE_LOAD_FROM = process.env.REACT_APP_SPREAD_LOAD_FROM || '2026-05-01';

function normalizeRow(r) {
    const date = r.date ? String(r.date).slice(0, 10) : '';
    const hour = parseInt(r.hour, 10);
    const gametype = r.gametype ?? r.game ?? '';
    return {
        date,
        hour: Number.isFinite(hour) ? hour : null,
        gametype: String(gametype),
        table: r.table != null ? String(r.table) : '',
        spread: Number(r.spread) === 1 ? 1 : 0,
    };
}

function normalizeRows(rows) {
    if (!Array.isArray(rows)) return [];
    return rows.map(normalizeRow);
}

/**
 * Fetch scheduling (spread) rows.
 *
 * @param {object}  opts
 * @param {string}  opts.date        optional — pull just this date
 * @param {string}  opts.from        optional — preload window start
 * @param {string}  opts.url         override the endpoint
 * @param {number}  opts.timeoutMs   request timeout
 * @param {boolean} opts.fallback    fall back to the bundled fixture (default true)
 * @returns {Promise<Array>} normalised rows ([] when nothing available)
 */
export async function fetchScheduleHours({
    date = null,
    from = null,
    url = DEFAULT_SPREAD_API_URL,
    timeoutMs = 60000,
    fallback = true,
} = {}) {
    const loadFixture = () => {
        if (!fallback) return [];
        try {
            const data = require('../data/schedule_cod.json');
            let rows = normalizeRows(data);
            if (date) rows = rows.filter((r) => r.date === date);
            else if (from) rows = rows.filter((r) => r.date >= from);
            return rows;
        } catch {
            return [];
        }
    };

    if (!url) return loadFixture();

    const params = [];
    if (date) params.push(`date=${encodeURIComponent(date)}`);
    else if (from) params.push(`from=${encodeURIComponent(from)}`);
    const fullUrl = params.length
        ? `${url}${url.includes('?') ? '&' : '?'}${params.join('&')}`
        : url;
    try {
        const res = await axios({ url: fullUrl, method: 'get', timeout: timeoutMs, headers: { 'Content-Type': 'application/json' } });
        if (res.status !== 200 || !Array.isArray(res.data)) {
            throw new Error(`bad response (HTTP ${res.status})`);
        }
        let rows = normalizeRows(res.data);
        // DEFENSIVE: never trust the endpoint to honour the `date` param —
        // always filter to the requested date so a response that includes
        // other dates (or ignores the filter) can't poison the open/closed
        // map with the wrong day's schedule.
        if (date) rows = rows.filter((r) => r.date === date);
        // eslint-disable-next-line no-console
        console.info(`[Pricing/schedule] loaded ${rows.length} rows from API` + (date ? ` for ${date}` : from ? ` from ${from}` : ''));
        return rows;
    } catch (err) {
        // eslint-disable-next-line no-console
        console.warn(`[Pricing/schedule] API fetch failed (${err.message}) — using bundled fixture`);
        return loadFixture();
    }
}
