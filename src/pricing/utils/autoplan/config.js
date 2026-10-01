// Auto-plan settings kept in the pricing store (store.autoplan): targets per
// day type (or date) × core hour × sub-segment, rules, manual prices per
// date + block, day-type overrides, scoring weights, selection criteria and
// the core hours.

import { DEFAULT_DOW_MAP, DEFAULT_CORE_HOURS, normalizeCoreHours } from './core';
import { foldToLadder } from './inputs';

// change: a table's price differs from its parent hour (operational change).
// align:  a date's anchor hour differs from the reference day's anchor plan.
// step:   per price level jumped — keeps forced changes to the closest price.
// raise:  extra when a change raises the price in time order.
// night:  at the first core hour, differs from the previous date's last core hour.
export const DEFAULT_WEIGHTS = { change: 10000, stay: 300, step: 1000, rank: 10, hist: 10, hold: 500, align: 10000, raise: 0, night: 2000 };

// Scoring presets. "Fewest changes" keeps a change far costlier than any
// rank / history gain; the others let rank or history win over a change.
export const WEIGHT_PRESETS = [
    { id: 'fewest', label: 'Fewest changes', help: 'A change is only made when the targets force it', weights: DEFAULT_WEIGHTS },
    { id: 'rank', label: 'Follow performance', help: 'Best tables take the higher prices, even if more tables change', weights: { change: 60, stay: 30, step: 5, rank: 100, hist: 10, hold: 40, align: 60, raise: 0, night: 20 } },
    { id: 'hist', label: 'Follow history', help: 'Tables keep the prices they usually run, even if more tables change', weights: { change: 60, stay: 30, step: 5, rank: 10, hist: 100, hold: 40, align: 60, raise: 0, night: 20 } },
];
const WEIGHT_KEYS = Object.keys(DEFAULT_WEIGHTS);
export function presetOf(w) {
    const p = WEIGHT_PRESETS.find((x) => WEIGHT_KEYS.every((k) => Number(x.weights[k]) === Number(w[k])));
    return p ? p.id : 'custom';
}
// True while a change costs more than the most rank + history + saved-plan
// points one table can gain from it, so changes are minimised first.
export const changeDominates = (w, levels) => w.change > w.rank * Math.max(0, levels - 1) + w.hist + w.stay;

export const RANK_METRICS = [
    ['theo', 'Theo'], ['win', 'Win'], ['drop', 'Drop'], ['turnover', 'Turnover'],
    ['patronhrs', 'Patron hours'], ['activehours', 'Active hours'], ['patron_hands', 'Patron hands'],
    ['active_minutes', 'Active minutes'], ['game_count', 'Hands'],
];
export const RANK_PER = [['patronhrs', 'per patron hour'], ['openhours', 'per open hour'], ['open_minutes', 'per open minute'], ['total', 'total']];

// Named rank signals (numerator ÷ denominator). Names follow the Performance
// dashboard where it has the same measure.
export const SIGNALS = [
    { id: 'theo_oh', label: 'Theo per hour', metric: 'theo', per: 'openhours', source: 'Performance: Theo per table per hour', help: 'Expected casino revenue per open table hour' },
    { id: 'active', label: 'Active rate', metric: 'active_minutes', per: 'open_minutes', source: 'Performance: Active % (Min by Min)', help: 'Share of open minutes with players at the table (active hours ÷ open hours where minutes are not recorded)' },
    { id: 'theo_ph', label: 'Theo per patron hour', metric: 'theo', per: 'patronhrs', source: '', help: 'Expected revenue per player hour: how valuable the players are' },
    { id: 'win_oh', label: 'Win per hour', metric: 'win', per: 'openhours', source: 'Performance: Win per Hour', help: 'Actual result per open table hour (noisier than theo)' },
    { id: 'occupancy', label: 'Occupancy', metric: 'patronhrs', per: 'openhours', source: '', help: 'Average players seated per open hour' },
    { id: 'hands_oh', label: 'Hands per hour', metric: 'game_count', per: 'openhours', source: 'Performance: Hands per Hour', help: 'Game pace: hands dealt per open hour' },
];
export const signalOf = (m) => SIGNALS.find((s) => s.metric === m.metric && s.per === m.per) || null;

export const REF_DAY_TYPES = ['sat', 'wd', 'fri', 'sun', 'auto'];
const SOURCE_DEFAULT = { mode: 'last', from: '', to: '' };
export const DEFAULT_CRITERIA = {
    rankMix: [{ metric: 'theo', per: 'openhours', w: 50 }, { metric: 'active_minutes', per: 'open_minutes', w: 25 }, { metric: 'theo', per: 'patronhrs', w: 25 }],
    rankDays: 28, rankSameDayType: true, rankBasis: 'block', rankSource: { ...SOURCE_DEFAULT },
    holdHours: 2,
    histWeeks: 12, histSameDayType: true, minShare: 1, histSource: { ...SOURCE_DEFAULT }, histHalfLife: 0,
    openRule: 'any', overflow: 'down',
    anchorCore: 21, refDayType: 'sat',
    changeMult: {}, podChangeCap: { on: false, n: 3 },
};
const clampInt = (v, lo, hi, d) => (Number.isFinite(Number(v)) ? Math.min(hi, Math.max(lo, Math.round(Number(v)))) : d);
const oneOf = (v, list, d) => (list.includes(v) ? v : d);
// Rank signals blended by weight (max 4). Older settings had one metric.
const MIX_MAX = 4;
function mergeRankMix(o) {
    const metrics = RANK_METRICS.map((x) => x[0]), pers = RANK_PER.map((x) => x[0]);
    const src = Array.isArray(o.rankMix) ? o.rankMix : (o.rankMetric ? [{ metric: o.rankMetric, per: o.rankPer || 'patronhrs', w: 100 }] : []);
    const out = src.filter((r) => r && metrics.includes(r.metric) && pers.includes(r.per))
        .slice(0, MIX_MAX).map((r) => ({ metric: r.metric, per: r.per, w: clampInt(r.w, 0, 100, 100) }));
    return out.length ? out : DEFAULT_CRITERIA.rankMix.map((r) => ({ ...r }));
}
export const RANK_MIX_MAX = MIX_MAX;

const ISO = /^\d{4}-\d{2}-\d{2}$/;
function mergeSource(v) {
    const o = v && typeof v === 'object' ? v : {};
    return { mode: oneOf(o.mode, ['last', 'range'], 'last'), from: ISO.test(o.from || '') ? o.from : '', to: ISO.test(o.to || '') ? o.to : '' };
}
function mergeMult(v) {
    const out = {};
    if (v && typeof v === 'object') {
        for (const [k, m] of Object.entries(v)) {
            const h = Number(k), x = Number(m);
            if (Number.isInteger(h) && h >= 0 && h <= 23 && Number.isFinite(x) && x > 0 && x <= 20) out[h] = x;
        }
    }
    return out;
}

function mergeCriteria(c) {
    const d = DEFAULT_CRITERIA;
    const o = c && typeof c === 'object' ? c : {};
    const cap = o.podChangeCap && typeof o.podChangeCap === 'object' ? o.podChangeCap : {};
    return {
        rankMix: mergeRankMix(o),
        rankBasis: oneOf(o.rankBasis, ['block', 'day'], d.rankBasis),
        rankSource: mergeSource(o.rankSource),
        histSource: mergeSource(o.histSource),
        histHalfLife: clampInt(o.histHalfLife ?? d.histHalfLife, 0, 52, d.histHalfLife),
        anchorCore: Number.isInteger(Number(o.anchorCore)) && Number(o.anchorCore) >= 0 && Number(o.anchorCore) <= 23 ? Number(o.anchorCore) : d.anchorCore,
        refDayType: oneOf(o.refDayType, REF_DAY_TYPES, d.refDayType),
        changeMult: mergeMult(o.changeMult),
        podChangeCap: { on: typeof cap.on === 'boolean' ? cap.on : d.podChangeCap.on, n: clampInt(cap.n ?? d.podChangeCap.n, 1, 50, d.podChangeCap.n) },
        holdHours: clampInt(o.holdHours ?? d.holdHours, 1, 6, d.holdHours),
        rankDays: clampInt(o.rankDays ?? d.rankDays, 7, 365, d.rankDays),
        rankSameDayType: typeof o.rankSameDayType === 'boolean' ? o.rankSameDayType : d.rankSameDayType,
        histWeeks: clampInt(o.histWeeks ?? d.histWeeks, 1, 52, d.histWeeks),
        histSameDayType: typeof o.histSameDayType === 'boolean' ? o.histSameDayType : d.histSameDayType,
        minShare: clampInt(o.minShare ?? d.minShare, 0, 50, d.minShare),
        openRule: oneOf(o.openRule, ['any', 'core'], d.openRule),
        overflow: oneOf(o.overflow, ['down', 'up'], d.overflow),
    };
}
function mergeWeights(w) {
    const out = { ...DEFAULT_WEIGHTS };
    if (w && typeof w === 'object') for (const k of WEIGHT_KEYS) if (Number.isFinite(Number(w[k])) && Number(w[k]) >= 0) out[k] = Number(w[k]);
    return out;
}

// Edited price lists: sub-segment → tier ids. Empty or malformed lists drop out.
function mergePrices(p) {
    const out = {};
    if (p && typeof p === 'object' && !Array.isArray(p)) {
        for (const [sub, ids] of Object.entries(p)) {
            const ok = Array.isArray(ids) ? ids.filter((x) => typeof x === 'string') : [];
            if (ok.length) out[sub] = ok;
        }
    }
    return out;
}

// Manual prices: date → core hour → table → tier. Malformed parts drop out.
function mergeManual(m) {
    const out = {};
    if (!m || typeof m !== 'object' || Array.isArray(m)) return out;
    for (const [date, byCore] of Object.entries(m)) {
        if (!ISO.test(date) || !byCore || typeof byCore !== 'object') continue;
        for (const [core, byKey] of Object.entries(byCore)) {
            if (!byKey || typeof byKey !== 'object') continue;
            const ok = Object.entries(byKey).filter(([, id]) => typeof id === 'string');
            if (!ok.length) continue;
            out[date] = out[date] || {};
            out[date][core] = Object.fromEntries(ok);
        }
    }
    return out;
}

// Zone (pod) rules carry an optional minimum and maximum, each switchable.
export function normalizeRule(r) {
    if (r.type !== 'zonecap') return r;
    return {
        ...r,
        n: Number.isFinite(Number(r.n)) ? Math.max(0, Math.round(Number(r.n))) : 1,
        maxOn: typeof r.maxOn === 'boolean' ? r.maxOn : true,
        min: Number.isFinite(Number(r.min)) ? Math.max(0, Math.round(Number(r.min))) : 0,
        minOn: typeof r.minOn === 'boolean' ? r.minOn : false,
    };
}

export function emptyAutoplan() {
    return {
        targets: {}, rules: [], overrides: {}, dowMap: { ...DEFAULT_DOW_MAP }, weights: { ...DEFAULT_WEIGHTS }, nextRuleId: 1,
        criteria: { ...DEFAULT_CRITERIA }, coreHours: [...DEFAULT_CORE_HOURS], prices: {}, manual: {},
    };
}

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);

export function mergeAutoplan(stored) {
    const base = emptyAutoplan();
    if (!isObj(stored)) return base;
    const rules = Array.isArray(stored.rules) ? stored.rules.filter((r) => r && r.type && r.id != null).map(normalizeRule) : [];
    return {
        targets: isObj(stored.targets) ? stored.targets : {},
        rules,
        overrides: isObj(stored.overrides) ? stored.overrides : {},
        dowMap: { ...base.dowMap, ...(isObj(stored.dowMap) ? stored.dowMap : {}) },
        weights: mergeWeights(stored.weights),
        criteria: mergeCriteria(stored.criteria),
        coreHours: Array.isArray(stored.coreHours) ? normalizeCoreHours(stored.coreHours) : [...DEFAULT_CORE_HOURS],
        prices: mergePrices(stored.prices),
        manual: mergeManual(stored.manual),
        nextRuleId: Number.isFinite(stored.nextRuleId) ? stored.nextRuleId : Math.max(0, ...rules.map((r) => Number(r.id) || 0)) + 1,
    };
}

export const targetsFor = (cfg, dt, core, sub) => (((cfg.targets || {})[dt] || {})[core] || {})[sub] || null;

export function withTargets(cfg, dt, core, sub, map) {
    const t = cfg.targets || {};
    return {
        ...cfg,
        targets: { ...t, [dt]: { ...(t[dt] || {}), [core]: { ...((t[dt] || {})[core] || {}), [sub]: { ...map } } } },
    };
}

export const withRules = (cfg, rules) => ({ ...cfg, rules });

// A rule scope covering a list of tables (picked on the floor).
export const tablesScope = (keys) => `tables:${[...new Set(keys)].join(',')}`;
export const scopeKeys = (scope) => (String(scope).startsWith('tables:') ? scope.slice(7).split(',').filter(Boolean) : String(scope).startsWith('table:') ? [scope.slice(6)] : []);

// ── Targets per date (override the day type) ─────────────────────────
export const dateKey = (date) => `d:${date}`;
export const targetsForDate = (cfg, date, dt, core, sub) => targetsFor(cfg, dateKey(date), core, sub) || targetsFor(cfg, dt, core, sub);
export const hasDateTargets = (cfg, date) => !!(cfg.targets || {})[dateKey(date)];
export function clearDateTargets(cfg, date) {
    const targets = { ...(cfg.targets || {}) };
    delete targets[dateKey(date)];
    return { ...cfg, targets };
}

// ── Manual prices (a rule for one date + core-hour block) ────────────
export const manualFor = (cfg, date, core) => new Map(Object.entries(((cfg.manual || {})[date] || {})[core] || {}));
export function withManual(cfg, date, core, keys, tierId) {
    const manual = { ...(cfg.manual || {}) };
    const byCore = { ...(manual[date] || {}) };
    const byKey = { ...(byCore[core] || {}) };
    for (const k of keys) { if (tierId) byKey[k] = tierId; else delete byKey[k]; }
    if (Object.keys(byKey).length) byCore[core] = byKey; else delete byCore[core];
    if (Object.keys(byCore).length) manual[date] = byCore; else delete manual[date];
    return { ...cfg, manual };
}
export function clearManualDate(cfg, date) {
    const manual = { ...(cfg.manual || {}) };
    delete manual[date];
    return { ...cfg, manual };
}
export const manualCount = (cfg) => Object.values(cfg.manual || {}).reduce((a, byCore) => a + Object.values(byCore).reduce((b, m) => b + Object.keys(m).length, 0), 0);

// ── Price lists per sub-segment ───────────────────────────────────────
export function withPrices(cfg, sub, ids, tiersAsc) {
    const order = new Map(tiersAsc.map((t, i) => [t.id, i]));
    const list = [...new Set(ids.filter((id) => order.has(id)))].sort((a, b) => order.get(a) - order.get(b));
    return { ...cfg, prices: { ...(cfg.prices || {}), [sub]: list } };
}

// Rewrites every saved target of one sub-segment onto a new price list.
function foldSubTargets(cfg, sub, ladder, tierIndex) {
    const targets = {};
    let moved = 0;
    for (const [dt, byCore] of Object.entries(cfg.targets || {})) {
        targets[dt] = {};
        for (const [core, bySub] of Object.entries(byCore)) {
            targets[dt][core] = { ...bySub };
            if (!bySub[sub]) continue;
            for (const [id, n] of Object.entries(bySub[sub])) if (!ladder.includes(id)) moved += Number(n) || 0;
            targets[dt][core][sub] = foldToLadder(bySub[sub], ladder, tierIndex);
        }
    }
    return { targets, moved };
}

// Drop one price; its saved tables move to the next lower price (else higher).
export function removePrice(cfg, sub, id, ladder, tierIndex) {
    const next = ladder.filter((x) => x !== id);
    const { targets, moved } = foldSubTargets(cfg, sub, next, tierIndex);
    const k = tierIndex.get(id);
    const lower = next.filter((x) => tierIndex.get(x) < k);
    const to = lower.length ? lower[lower.length - 1] : next.find((x) => tierIndex.get(x) > k) ?? null;
    return { cfg: { ...cfg, targets, prices: { ...(cfg.prices || {}), [sub]: next } }, moved, to };
}

// Back to the prices history offers; saved targets fold onto that list.
export function clearPrices(cfg, sub, histLadder, tierIndex) {
    const { targets } = foldSubTargets(cfg, sub, histLadder, tierIndex);
    const prices = { ...(cfg.prices || {}) };
    delete prices[sub];
    return { ...cfg, targets, prices };
}
