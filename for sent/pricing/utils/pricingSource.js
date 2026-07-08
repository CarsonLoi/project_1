// Pricing plan source (pricing) — read the saved plan from the DATABASE
// =====================================================================
//
// Mirrors scheduleSource.js, but for the PRICING plan that the Python
// restructure script uploads to Postgres. This is the "v0" baseline for a
// date — the pricing plan currently stored in the database, fetched fresh
// on demand (never persisted in the browser).
//
// Wire shape — one row per (table × date × hour):
//   { date: "YYYY-MM-DD", hour: 0..23, gametype: "BJ"|…, table: "10000",
//     table_minimum: 500, revised_date?: "YYYY-MM-DD" }
//   (table_minimum = the $ minimum; 0 / null / missing = unpriced that hour.)
//
// Endpoint (configure at build time):
//   REACT_APP_PRICING_API_URL=http://<host>:<port>/cod_pricing
//   GET <url>?date=YYYY-MM-DD        — preferred (one date)
//   GET <url>                        — also accepted (all rows)
//
// Offline / no-endpoint behaviour: falls back to the bundled fixture
// src/pricing/data/pricing_db_cod.json (ships empty). Never throws.

import axios from 'axios';
import { gametypeTableKey } from '../../performance/utils/dataSource';
import { snapToTier } from './pricingHistory';

const DEFAULT_PRICING_API_URL = process.env.REACT_APP_PRICING_API_URL || '';
export const PRICING_LOAD_FROM = process.env.REACT_APP_PRICING_LOAD_FROM || '2026-05-01';

function normalizeRow(r) {
    const date = r.date ? String(r.date).slice(0, 10) : '';
    const hour = parseInt(r.hour, 10);
    const gametype = r.gametype ?? r.game ?? '';
    // Accept a few common column spellings for the minimum.
    const minRaw = r.table_minimum ?? r.tablemin ?? r.table_min ?? r.min ?? null;
    const min = minRaw == null ? null : Number(minRaw);
    return {
        date,
        hour: Number.isFinite(hour) ? hour : null,
        gametype: String(gametype),
        table: r.table != null ? String(r.table) : '',
        table_minimum: Number.isFinite(min) ? min : null,
        revised_date: r.revised_date ? String(r.revised_date).slice(0, 10) : null,
    };
}

function normalizeRows(rows) {
    return Array.isArray(rows) ? rows.map(normalizeRow) : [];
}

/**
 * Fetch the database pricing plan rows.
 * @returns {Promise<Array>} normalised rows ([] when nothing available)
 */
export async function fetchPricingPlan({
    date = null,
    from = null,
    url = DEFAULT_PRICING_API_URL,
    timeoutMs = 60000,
    fallback = true,
} = {}) {
    const loadFixture = () => {
        if (!fallback) return [];
        try {
            let rows = normalizeRows(require('../data/pricing_db_cod.json'));
            if (date) rows = rows.filter((r) => r.date === date);
            else if (from) rows = rows.filter((r) => r.date >= from);
            return rows;
        } catch { return []; }
    };

    if (!url) return loadFixture();

    const params = [];
    if (date) params.push(`date=${encodeURIComponent(date)}`);
    else if (from) params.push(`from=${encodeURIComponent(from)}`);
    const fullUrl = params.length ? `${url}${url.includes('?') ? '&' : '?'}${params.join('&')}` : url;
    try {
        const res = await axios({ url: fullUrl, method: 'get', timeout: timeoutMs, headers: { 'Content-Type': 'application/json' } });
        if (res.status !== 200 || !Array.isArray(res.data)) throw new Error(`bad response (HTTP ${res.status})`);
        let rows = normalizeRows(res.data);
        // DEFENSIVE: never trust the endpoint to honour `date` — filter again.
        if (date) rows = rows.filter((r) => r.date === date);
        // eslint-disable-next-line no-console
        console.info(`[Pricing/db] loaded ${rows.length} plan rows from API` + (date ? ` for ${date}` : from ? ` from ${from}` : ''));
        return rows;
    } catch (err) {
        // eslint-disable-next-line no-console
        console.warn(`[Pricing/db] API fetch failed (${err.message}) — using bundled fixture`);
        return loadFixture();
    }
}

/**
 * Convert DB pricing rows → the dashboard's hourly buckets for one date:
 *   { 'h_<hour>': { assignments: { '<gametype>|<table>': '<tierId>' } } }
 * Each table_minimum is snapped to the nearest configured tier. Unpriced
 * cells (min ≤ 0 / null) are skipped. Also returns the plan's revised_date.
 */
export function pricingRowsToByHour(rows, date, tiers) {
    const byHour = {};
    let revisedDate = null;
    for (const r of rows || []) {
        if (date && r.date !== date) continue;
        if (r.revised_date && !revisedDate) revisedDate = r.revised_date;
        const min = Number(r.table_minimum);
        if (!(min > 0)) continue;
        const h = Number(r.hour);
        if (!Number.isFinite(h)) continue;
        const tid = snapToTier(min, tiers);
        if (!tid) continue;
        const unit = `h_${h}`;
        if (!byHour[unit]) byHour[unit] = { assignments: {} };
        byHour[unit].assignments[gametypeTableKey(r.gametype, r.table)] = tid;
    }
    return { byHour, revisedDate };
}
