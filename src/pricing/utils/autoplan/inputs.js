// Auto-plan — inputs derived from the feeds the page already loads:
// which tables are open in each block, each table's price history and
// performance value, the prices each sub-segment uses, and history-seeded
// targets. Pure; tested.

import { parseTablemin, gametypeTableKey } from '../../../performance/utils/dataSource';
import { CORE_HOURS, DAY_TYPES, addDays, blockHours, coreFor, dayTypeOf } from './core';

export function snapTier(value, tiersAsc) {
    let best = null, bestD = Infinity;
    for (const t of tiersAsc) { const d = Math.abs((t.min || 0) - Number(value)); if (d < bestD) { bestD = d; best = t.id; } }
    return best;
}

// Tables needing a price in each block: open at ANY hour of the block
// (mode 'any'), or open at the core hour itself (mode 'core').
// No schedule → every live table (flagged, so the UI can say so).
export function openByBlock(openByHour, tables, mode = 'any') {
    const live = new Set(tables.map((t) => t.key));
    const byCore = new Map();
    for (const core of CORE_HOURS) {
        const set = new Set();
        if (!openByHour) for (const k of live) set.add(k);
        else for (const h of (mode === 'core' ? [core] : blockHours(core))) for (const k of (openByHour.get(h) || [])) if (live.has(k)) set.add(k);
        byCore.set(core, set);
    }
    return { byCore, assumedAllOpen: !openByHour };
}

function dayTypeCache(cfg) {
    const m = new Map();
    return (d) => { if (!m.has(d)) m.set(d, dayTypeOf(d, cfg)); return m.get(d); };
}

const dayNum = (iso) => { const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number); return Date.UTC(y, m - 1, d) / 86400000; };

// The dates a history setting reads: the last N days before `before`, or the
// user's own range (falls back to the last N days until both ends are set).
export function sourceWindow(source, { defaultDays, before }) {
    if (source && source.mode === 'range' && source.from && source.to && source.from <= source.to) return { from: source.from, to: source.to };
    const to = addDays(before, -1);
    return { from: addDays(to, -defaultDays + 1), to };
}

// Share of each price a table actually ran, per core-hour block — for one
// day type, or every day when sameDayType is false. halfLife (weeks) makes
// recent rows count more; 0 = every row counts the same.
export function historyShares(hourlyRows, { from, to, dayType, cfg, tiersAsc, sameDayType = true, halfLife = 0 }) {
    const dtOf = dayTypeCache(cfg);
    const end = dayNum(to);
    const snap = new Map();
    const acc = new Map();
    for (const r of hourlyRows || []) {
        const d = String(r.date || '').slice(0, 10);
        if (!d || d < from || d > to || (sameDayType && dtOf(d) !== dayType)) continue;
        const h = Number(r.hour);
        if (!Number.isFinite(h)) continue;
        const hist = parseTablemin(r.tablemin);
        const mins = Object.keys(hist);
        if (!mins.length) continue;
        const k = `${gametypeTableKey(r.gametype, r.table)}|${coreFor(h)}`;
        let e = acc.get(k);
        if (!e) { e = {}; acc.set(k, e); }
        const wt = halfLife > 0 ? 0.5 ** ((end - dayNum(d)) / (7 * halfLife)) : 1;
        for (const m of mins) {
            if (!snap.has(m)) snap.set(m, snapTier(Number(m), tiersAsc));
            const id = snap.get(m);
            e[id] = (e[id] || 0) + hist[m] * wt;
        }
    }
    for (const e of acc.values()) {
        const tot = Object.values(e).reduce((a, b) => a + b, 0) || 1;
        for (const id of Object.keys(e)) e[id] /= tot;
    }
    return acc;
}

// Performance value used for the rank: metric (theo / win / drop / turnover)
// per patron hour, per open hour, or in total, over the window's dates of
// the day type (or every day when sameDayType is false).
export function tableValues(dailyRows, { from, to, dayType, cfg, metric = 'theo', per = 'patronhrs', sameDayType = true }) {
    const dtOf = dayTypeCache(cfg);
    const acc = new Map();
    for (const r of dailyRows || []) {
        const d = String(r.date || '').slice(0, 10);
        if (!d || d < from || d > to || (sameDayType && dtOf(d) !== dayType)) continue;
        const k = gametypeTableKey(r.gametype, r.table);
        const a = acc.get(k) || { v: 0, n: 0 };
        a.v += Number(r[metric]) || 0;
        if (per !== 'total') a.n += Number(r[per]) || 0;
        acc.set(k, a);
    }
    const out = new Map();
    for (const [k, a] of acc) out.set(k, per === 'total' ? a.v : (a.n > 0 ? a.v / a.n : 0));
    return out;
}

// ── Rank from the performance feeds ──────────────────────────────────
const AGG_FIELDS = ['theo', 'win', 'drop', 'turnover', 'patronhrs', 'openhours', 'activehours', 'patron_hands', 'game_count', 'open_minutes', 'active_minutes'];

// Sums per day type × core-hour block (or 'day') × table, over the window.
export function aggregateRows(rows, { from, to, cfg, byCore = false }) {
    const dtOf = dayTypeCache(cfg);
    const out = new Map();
    for (const r of rows || []) {
        const d = String(r.date || '').slice(0, 10);
        if (!d || d < from || d > to) continue;
        let core = 'day';
        if (byCore) {
            const h = Number(r.hour);
            if (r.hour == null || !Number.isFinite(h)) continue;
            core = coreFor(h);
        }
        const k = `${dtOf(d)}|${core}|${gametypeTableKey(r.gametype, r.table)}`;
        let a = out.get(k);
        if (!a) { a = Object.fromEntries(AGG_FIELDS.map((f) => [f, 0])); out.set(k, a); }
        for (const f of AGG_FIELDS) a[f] += Number(r[f]) || 0;
    }
    return out;
}

// One signal's value per table: metric ÷ basis (or the metric's total).
function signalValue(agg, dts, core, key, m) {
    let num = 0, den = 0;
    for (const dt of dts) {
        const a = agg.get(`${dt}|${core}|${key}`);
        if (!a) continue;
        num += a[m.metric] || 0;
        if (m.per !== 'total') den += a[m.per] || 0;
    }
    if (m.per === 'total') return num;
    if (den > 0) return num / den;
    // Active rate without minute data: the hour-grain share (active ÷ open hours).
    if (m.metric === 'active_minutes' && m.per === 'open_minutes') return signalValue(agg, dts, core, key, { metric: 'activehours', per: 'openhours' });
    return 0;
}

// Percentile within each group (0 lowest … 1 highest; ties share the mean).
function percentiles(values, groups) {
    const out = new Map();
    for (const keys of groups.values()) {
        const sorted = [...keys].sort((a, b) => values.get(a) - values.get(b));
        const n = sorted.length;
        for (let i = 0; i < n;) {
            let j = i;
            while (j + 1 < n && values.get(sorted[j + 1]) === values.get(sorted[i])) j++;
            const pct = n > 1 ? ((i + j) / 2) / (n - 1) : 1;
            for (let x = i; x <= j; x++) out.set(sorted[x], pct);
            i = j + 1;
        }
    }
    return out;
}

function breakdownAll(agg, { dt, core, mix, subOf, sameDayType = true }) {
    const dts = sameDayType ? [dt] : DAY_TYPES.map((d) => d.id);
    const groups = new Map();
    for (const [k, sub] of subOf) { if (!groups.has(sub)) groups.set(sub, []); groups.get(sub).push(k); }
    const totW = mix.reduce((a, m) => a + (m.w || 0), 0);
    const rows = new Map([...subOf.keys()].map((k) => [k, { key: k, parts: [], score: 0 }]));
    for (const m of mix) {
        const vals = new Map([...subOf.keys()].map((k) => [k, signalValue(agg, dts, core, k, m)]));
        const pct = percentiles(vals, groups);
        for (const [k, row] of rows) {
            row.parts.push({ metric: m.metric, per: m.per, w: m.w, value: vals.get(k), pct: pct.get(k) });
            if (totW) row.score += (pct.get(k) * (m.w || 0)) / totW;
        }
    }
    return rows;
}

// Rank score per table (0..1) for a day type and core hour ('day' = whole day).
export function blendFromAgg(agg, opts) {
    return new Map([...breakdownAll(agg, opts)].map(([k, r]) => [k, r.score]));
}

// One sub-segment's tables in rank order, with each signal's value and percentile.
export function signalBreakdown(agg, { sub, ...opts }) {
    return [...breakdownAll(agg, opts).values()]
        .filter((r) => opts.subOf.get(r.key) === sub)
        .sort((a, b) => b.score - a.score || (a.key < b.key ? -1 : 1));
}

// Blended performance score: each signal (metric per basis) becomes a
// percentile within the table's sub-segment (0 = lowest, 1 = highest, ties
// share), then the percentiles are averaged by weight.
export function blendValues(dailyRows, { from, to, dayType, cfg, mix, sameDayType = true, subOf }) {
    const bySub = new Map();
    for (const [k, sub] of subOf) { if (!bySub.has(sub)) bySub.set(sub, []); bySub.get(sub).push(k); }
    const out = new Map([...subOf.keys()].map((k) => [k, 0]));
    const totW = mix.reduce((a, m) => a + (m.w || 0), 0);
    if (!totW) return out;
    for (const m of mix) {
        if (!m.w) continue;
        const v = tableValues(dailyRows, { from, to, dayType, cfg, metric: m.metric, per: m.per, sameDayType });
        for (const keys of bySub.values()) {
            const sorted = [...keys].sort((a, b) => (v.get(a) || 0) - (v.get(b) || 0));
            const n = sorted.length;
            for (let i = 0; i < n;) {
                let j = i;
                while (j + 1 < n && (v.get(sorted[j + 1]) || 0) === (v.get(sorted[i]) || 0)) j++;
                const pct = n > 1 ? ((i + j) / 2) / (n - 1) : 1;
                for (let x = i; x <= j; x++) out.set(sorted[x], out.get(sorted[x]) + (pct * m.w) / totW);
                i = j + 1;
            }
        }
    }
    return out;
}

// Prices a sub-segment may use: at least minShare of its history weight
// (0 = every price). Nothing qualifies → every price.
export function laddersFrom(shares, tables, tiersAsc, minShare = 0.01) {
    const subOf = new Map(tables.map((t) => [t.key, t.sub]));
    const w = {};
    for (const [k, e] of shares) {
        const sub = subOf.get(k.slice(0, k.lastIndexOf('|')));
        if (!sub) continue;
        w[sub] = w[sub] || {};
        for (const [id, s] of Object.entries(e)) w[sub][id] = (w[sub][id] || 0) + s;
    }
    const out = {};
    for (const sub of new Set(tables.map((t) => t.sub))) {
        const e = w[sub] || {};
        const tot = Object.values(e).reduce((a, b) => a + b, 0);
        const ids = minShare <= 0 ? [] : tiersAsc.map((t) => t.id).filter((id) => tot > 0 && (e[id] || 0) / tot >= minShare);
        out[sub] = ids.length ? ids : tiersAsc.map((t) => t.id);
    }
    return out;
}

// A sub-segment's base price list: the config file's $ amounts (as tier
// ids, low → high; unknown amounts dropped), else what its history ran.
export function baseLadders(histLadders, tiersAsc, config) {
    const byMin = new Map(tiersAsc.map((t) => [Number(t.min), t.id]));
    const order = new Map(tiersAsc.map((t, i) => [t.id, i]));
    const out = {};
    for (const [sub, lad] of Object.entries(histLadders || {})) {
        const ids = [...new Set(((config || {})[sub] || []).map((m) => byMin.get(Number(m))).filter(Boolean))].sort((x, y) => order.get(x) - order.get(y));
        out[sub] = ids.length ? ids : lad;
    }
    return out;
}

// The price list each sub-segment plans with: the user's edited list when
// there is one (real prices only, low → high), else the config file's list,
// else the history list.
export function effectiveLadders(histLadders, prices, tiersAsc, config = null) {
    const order = new Map(tiersAsc.map((t, i) => [t.id, i]));
    const base = baseLadders(histLadders, tiersAsc, config);
    const out = {};
    for (const [sub, lad] of Object.entries(base)) {
        const own = [...new Set(((prices || {})[sub] || []).filter((id) => order.has(id)))].sort((x, y) => order.get(x) - order.get(y));
        out[sub] = own.length ? own : lad;
    }
    return out;
}

// Counts at prices outside the ladder move to the next lower price in it
// (the next higher when there is none lower).
export function foldToLadder(map, ladder, tierIndex) {
    const out = {};
    const inL = new Set(ladder);
    for (const [id, n] of Object.entries(map || {})) {
        let to = id;
        if (!inL.has(id)) {
            const k = tierIndex.get(id);
            const lower = ladder.filter((x) => tierIndex.get(x) < k);
            to = lower.length ? lower[lower.length - 1] : ladder.find((x) => tierIndex.get(x) > k);
        }
        if (to != null) out[to] = (out[to] || 0) + (Number(n) || 0);
    }
    return out;
}

// Largest-remainder split of n over weights, restricted to the ladder.
export function allocate(weights, n, ladder) {
    const ws = ladder.map((id) => Math.max(0, Number(weights[id]) || 0));
    let tot = ws.reduce((a, b) => a + b, 0);
    const use = tot > 0 ? ws : ladder.map(() => 1);
    tot = use.reduce((a, b) => a + b, 0);
    const raw = use.map((x) => (x / tot) * n);
    const out = raw.map(Math.floor);
    const rem = n - out.reduce((a, b) => a + b, 0);
    raw.map((x, i) => [x - Math.floor(x), i]).sort((a, b) => b[0] - a[0] || a[1] - b[1]).slice(0, rem).forEach(([, i]) => { out[i] += 1; });
    return Object.fromEntries(ladder.map((id, i) => [id, out[i]]));
}

export const fitToCount = (map, n, ladder) => allocate(map || {}, n, ladder);

// Raise tiers to their floor (pod minimums), taking one table at a time from
// the tier with the most room above its own floor.
export function fitToFloors(map, floors, ladder) {
    const out = { ...map };
    let moved = 0;
    for (const [id, fl] of floors) {
        if (!ladder.includes(id)) continue;
        let need = fl - (out[id] || 0);
        while (need > 0) {
            let donor = null, room = 0;
            for (const x of ladder) {
                if (x === id) continue;
                const r = (out[x] || 0) - (floors.get(x) || 0);
                if (r > room) { room = r; donor = x; }
            }
            if (!donor) break;
            out[donor] -= 1; out[id] = (out[id] || 0) + 1; need -= 1; moved += 1;
        }
    }
    return { map: out, moved };
}

// Trim tiers over their cap; the overflow moves one price down (or up with
// overflow 'up'), to the other side when there is no price that way.
export function fitToCaps(map, caps, ladder, overflow = 'down') {
    const out = { ...map };
    let moved = 0;
    const up = overflow === 'up';
    const order = ladder.map((_, i) => i);
    if (!up) order.reverse();
    for (const i of order) {
        const id = ladder[i];
        const cap = caps.get(id);
        if (cap == null || (out[id] || 0) <= cap) continue;
        const over = out[id] - cap;
        out[id] = cap;
        moved += over;
        const to = up ? (ladder[i + 1] ?? ladder[i - 1]) : (ladder[i - 1] ?? ladder[i + 1]);
        if (to != null) out[to] = (out[to] || 0) + over;
    }
    return { map: out, moved };
}

// Targets from what the open tables actually ran (day type, core hour).
export function seedTargets({ tables, openByCore, shares, ladders }) {
    const out = {};
    for (const core of CORE_HOURS) {
        out[core] = {};
        const open = openByCore.get(core) || new Set();
        for (const sub of Object.keys(ladders)) {
            const ts = tables.filter((t) => t.sub === sub && open.has(t.key));
            const w = {};
            let known = 0;
            for (const t of ts) {
                const e = shares.get(`${t.key}|${core}`);
                if (!e) continue;
                known += 1;
                for (const [id, s] of Object.entries(e)) w[id] = (w[id] || 0) + s;
            }
            // Tables without history take the sub-segment's average mix.
            if (known && known < ts.length) for (const id of Object.keys(w)) w[id] *= ts.length / known;
            out[core][sub] = allocate(w, ts.length, ladders[sub]);
        }
    }
    return out;
}
