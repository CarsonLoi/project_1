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
    // No Content-Type on a GET: there is no body, and the header turns the
    // request into a CORS preflight the server may not answer.
    let res;
    try {
        res = await axios({ url: fullUrl, method: 'get', timeout: timeoutMs });
    } catch (err) {
        // A configured endpoint that fails must SAY so. Falling back to the
        // (empty) fixture here used to turn every network / CORS / SQL error
        // into "No pricing plan found", hiding the real cause.
        const status = err.response ? `HTTP ${err.response.status}` : (err.code || 'network error');
        const body = err.response && typeof err.response.data === 'string' ? ` — ${err.response.data.slice(0, 200)}` : '';
        throw new Error(`Pricing API ${fullUrl} failed: ${status}${body} (${err.message})`);
    }
    if (!Array.isArray(res.data)) throw new Error(`Pricing API ${fullUrl} returned ${typeof res.data}, expected a JSON array`);
    const all = normalizeRows(res.data);
    // DEFENSIVE: never trust the endpoint to honour `date` — filter again.
    const rows = date ? all.filter((r) => r.date === date) : all;
    // eslint-disable-next-line no-console
    console.info(`[Pricing/db] API returned ${all.length} rows; ${rows.length}` + (date ? ` for ${date}` : from ? ` from ${from}` : ''));
    if (date && !rows.length && all.length) {
        const dates = [...new Set(all.map((r) => r.date))].sort();
        // eslint-disable-next-line no-console
        console.info(`[Pricing/db] dates present in the API response: ${dates.slice(-10).join(', ')}${dates.length > 10 ? ` (+${dates.length - 10} earlier)` : ''}`);
        rows.availableDates = dates;
    }
    return rows;
}

const DEFAULT_PRICING_UPLOAD_URL = process.env.REACT_APP_PRICING_UPLOAD_API_URL || '';
const DEFAULT_PRICING_UPLOAD_KEY = process.env.REACT_APP_PRICING_UPLOAD_KEY || '';

/**
 * POST a pricing_plan (or pricing_plan_batch) document — exactly what the
 * dashboard's JSON export already builds — to the plan-upload service
 * (see server/plan-upload/), which restructures it and writes it
 * straight into Postgres. Throws on any non-2xx response or network error;
 * the caller decides what "failed" means for the UI (see doConfirmExport
 * in PricingDashboard.js).
 *
 * @returns {Promise<{ok: boolean, dates: string[], rowsWritten: number}>}
 */
export async function uploadPricingPlan(payload, {
    url = DEFAULT_PRICING_UPLOAD_URL,
    uploadKey = DEFAULT_PRICING_UPLOAD_KEY,
    timeoutMs = 60000,
} = {}) {
    if (!url) throw new Error('REACT_APP_PRICING_UPLOAD_API_URL is not configured');
    const res = await axios({
        url, method: 'post', timeout: timeoutMs, data: payload,
        headers: { 'Content-Type': 'application/json', ...(uploadKey ? { 'x-upload-key': uploadKey } : {}) },
    });
    return res.data;
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
