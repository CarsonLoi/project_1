// Table open/close status feed.
//
// Companion to trendDataSource.js. The walker payload tells us what *did*
// happen at each table, but not whether the table was open (idle but
// available) or shut. This feed answers that explicitly, minute by minute:
//
//   GET {REACT_APP_TABLE_STATUS_API_URL}?date=YYYY-MM-DD
//   →  [ { datetime: "2026-05-01 19:20:00", table: "80501", is_open: 1 }, … ]
//
// The endpoint may emit either a row per minute (dense) or only the
// transition points (sparse). Either way, this module forward-fills via a
// binary search at query time, so the same lookup works for both.
//
// Usage:
//   const statusMap = await fetchTableStatus({ date });
//   const isOpen = isTableOpenAt(statusMap, '80501', epochMs);

import axios from 'axios';
import dayjs from 'dayjs';

const DEFAULT_URL =
  process.env.REACT_APP_TABLE_STATUS_API_URL ||
  'http://10.100.122.41:9000/cod_table_status';

/**
 * Fetch the open/close feed for `date`. Returns a Map<tableCode, sorted
 * array of {time, isOpen}>. Empty Map on failure so callers can treat
 * "no data" as "assume open".
 */
export async function fetchTableStatus({
  date,
  url = DEFAULT_URL,
  timeoutMs = 80000,
  fallback = true,
} = {}) {
  const isoDate = date ? dayjs(date).format('YYYY-MM-DD') : null;
  const queryUrl = isoDate ? `${url}?date=${isoDate}` : url;

  try {
    const res = await axios({
      url: queryUrl,
      method: 'get',
      timeout: timeoutMs,
      headers: { 'Content-Type': 'application/json' },
    });
    if (res.status !== 200) throw new Error(`HTTP ${res.status}`);
    const payload = res.data;
    if (!Array.isArray(payload)) throw new Error('payload is not an array');

    const map = normalize(payload);
    // eslint-disable-next-line no-console
    console.info(
      `[TableStatus] loaded ${payload.length} rows for ${isoDate}` +
        ` → ${map.size} tables tracked`
    );
    return map;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[TableStatus] live fetch failed:', err.message);
    if (fallback) {
      // eslint-disable-next-line no-console
      console.warn('[TableStatus] tables without status will be treated as open');
      return new Map();
    }
    throw err;
  }
}

// Group rows by table, parse the datetime, sort each table's series by time.
function normalize(rows) {
  const byTable = new Map();
  for (const r of rows) {
    const table = r.table == null ? '' : String(r.table);
    if (!table) continue;
    const time = dayjs(r.datetime).valueOf();
    if (!Number.isFinite(time)) continue;
    const isOpen = Number(r.is_open) === 1 || r.is_open === true;
    if (!byTable.has(table)) byTable.set(table, []);
    byTable.get(table).push({ time, isOpen });
  }
  for (const arr of byTable.values()) arr.sort((a, b) => a.time - b.time);
  return byTable;
}

/**
 * Forward-fill lookup: returns whether `tableCode` was open at `epochMs`.
 *
 * - Binary searches for the last status record with time <= epochMs.
 * - If no record exists for that table → assume open.
 * - If queried before the first record → assume open (we have no data
 *   yet, so don't pretend the table was closed).
 */
export function isTableOpenAt(statusMap, tableCode, epochMs) {
  const arr = statusMap.get(String(tableCode));
  if (!arr || arr.length === 0) return true;

  let lo = 0;
  let hi = arr.length - 1;
  let pick = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    if (arr[mid].time <= epochMs) {
      pick = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  if (pick < 0) return true;
  return arr[pick].isOpen;
}

export const TABLE_STATUS_DEFAULT_URL = DEFAULT_URL;
