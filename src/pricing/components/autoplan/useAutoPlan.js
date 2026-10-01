// Auto-plan state and actions for the Table Pricing page.
// Loads the feeds once, builds the solver context for the period, solves the
// reference plan and then each date (yielding to the UI between dates), and
// turns the draft into something the existing floor map / charts can render
// (an overlay store). Manual prices are saved as rules and re-solve at once.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fetchDailyData, fetchHourlyData, gametypeTableKey } from '../../../performance/utils/dataSource';
import { fetchScheduleHours } from '../../utils/scheduleSource';
import { CORE_HOURS, DAY_TYPES, addDays, blockHours, blockLabel, datesBetween, dayTypeOf, lastCore, nextMonthRange, normalizeCoreHours, setCoreHours } from '../../utils/autoplan/core';
import { mergeAutoplan, withTargets, withManual, withPrices, manualFor, targetsFor, dateKey, clearManualDate, tablesScope } from '../../utils/autoplan/config';
import {
    aggregateRows, allocate, baseLadders, blendFromAgg, effectiveLadders, fitToCaps, fitToFloors, foldToLadder, historyShares, laddersFrom,
    openByBlock, seedTargets, signalBreakdown, sourceWindow,
} from '../../utils/autoplan/inputs';
import { capsForSub, floorsForSub, inScope, rulesFor } from '../../utils/autoplan/solver';
import { pickAnchor, pickReferenceDate, readBlockMap, readPins, solveDate, solveReference } from '../../utils/autoplan/period';
import { applyDraft } from '../../utils/autoplan/apply';
import { SEGMENT_PRICES } from '../../constants/segmentPrices';
import { savePricing } from '../../utils/pricingStorage';
import { tierLabel } from './apStyles';

const todayIso = () => new Date().toISOString().slice(0, 10);
const tick = () => new Promise((r) => setTimeout(r, 0));

function maxDate(rows) {
    let m = '';
    for (const r of rows) { const d = String(r.date || '').slice(0, 10); if (d > m) m = d; }
    return m;
}

// Assignments for every hour of a date from a solved date (block → hours).
// A table closed at an hour (per the schedule) gets no price at that hour.
export function expandDate(byCore, openHours, pins) {
    const byDaypart = {};
    for (const core of CORE_HOURS) {
        const assign = byCore[core];
        if (!assign) continue;
        const p = (pins || {})[core] || new Map();
        for (const h of blockHours(core)) {
            const openH = openHours ? openHours.get(h) : null;
            const assignments = {};
            for (const [k, tier] of assign) {
                if (openH && !openH.has(k)) continue;
                assignments[k] = { base: tier, min: tier, max: tier, src: 'auto', ...(p.has(k) ? { pin: true } : {}) };
            }
            byDaypart[`h_${h}`] = { assignments };
        }
    }
    return byDaypart;
}

// Closed-hour check for one solved date: priced closed table-hours (always 0
// by construction) and open table-hours left without a price.
export function closedHourCheck(byCore, openHours) {
    if (!openHours) return { scheduled: false, pricedClosed: 0, openUnpriced: 0 };
    let pricedClosed = 0, openUnpriced = 0;
    const days = expandDate(byCore, openHours, {});
    for (const core of CORE_HOURS) {
        for (const h of blockHours(core)) {
            const priced = (days[`h_${h}`] || { assignments: {} }).assignments;
            const open = openHours.get(h) || new Set();
            for (const k of Object.keys(priced)) if (!open.has(k)) pricedClosed += 1;
            for (const k of open) if (!priced[k]) openUnpriced += 1;
        }
    }
    return { scheduled: true, pricedClosed, openUnpriced };
}

// hour → Set(open tables) from spread rows (spread = 1 means scheduled open).
function openMapFromRows(rows) {
    const map = new Map();
    for (const r of rows || []) {
        if (Number(r.spread) !== 1 || r.hour == null) continue;
        const h = Number(r.hour);
        if (!map.has(h)) map.set(h, new Set());
        map.get(h).add(gametypeTableKey(r.gametype, r.table));
    }
    return map;
}

export default function useAutoPlan({ store, setStore, tiers, tables: floorTables, active }) {
    const cfg = useMemo(() => mergeAutoplan(store.autoplan), [store.autoplan]);
    const setCfg = useCallback((next) => setStore((prev) => savePricing({ ...prev, autoplan: next })), [setStore]);
    // The core hours are a setting; apply them before anything reads them.
    setCoreHours(cfg.coreHours);
    const coreKey = CORE_HOURS.join(',');
    const crit = cfg.criteria;
    // Value keys, so saving targets (a new cfg object) doesn't recompute history.
    const critKey = JSON.stringify(crit);
    const dayTypeKey = JSON.stringify([cfg.dowMap, cfg.overrides]);

    const [period, setPeriod] = useState(() => nextMonthRange(todayIso()));
    const [keepPins, setKeepPins] = useState(true);
    const [stayClose, setStayClose] = useState(true);
    const [rows, setRows] = useState(null);           // { daily, hourly }
    const [schedule, setSchedule] = useState({ key: null, byDate: {} });
    const [rawDraft, setDraft] = useState(null);      // { byDate, reports, pins, at, key, coreKey, ref, refDate, anchors, alignDiffs }
    // A draft solved with other core hours no longer lines up with the blocks.
    const draft = rawDraft && rawDraft.coreKey === coreKey ? rawDraft : null;
    const [solving, setSolving] = useState(false);
    const [progress, setProgress] = useState({ done: 0, total: 0 });
    const runRef = useRef(0);

    // ── Feeds (once) and the period's schedule ─────────────────────────
    useEffect(() => {
        if (!active || rows) return;
        let off = false;
        Promise.all([fetchDailyData({}), fetchHourlyData({})]).then(([daily, hourly]) => {
            if (!off) setRows({ daily: daily || [], hourly: hourly || [] });
        }).catch(() => { if (!off) setRows({ daily: [], hourly: [] }); });
        return () => { off = true; };
    }, [active, rows]);
    const schedKey = `${period.from}|${period.to}`;
    useEffect(() => {
        if (!active || schedule.key === schedKey) return;
        let off = false;
        fetchScheduleHours({ from: period.from }).then((all) => {
            if (off) return;
            const byDate = {};
            for (const r of all || []) {
                if (r.date < period.from || r.date > period.to) continue;
                (byDate[r.date] = byDate[r.date] || []).push(r);
            }
            const out = {};
            for (const [d, rs] of Object.entries(byDate)) { const m = openMapFromRows(rs); if (m.size) out[d] = m; }
            setSchedule({ key: schedKey, byDate: out });
        }).catch(() => { if (!off) setSchedule({ key: schedKey, byDate: {} }); });
        return () => { off = true; };
    }, [active, schedKey, schedule.key, period.from, period.to]);

    // ── Solver context ─────────────────────────────────────────────────
    const tiersAsc = useMemo(() => [...tiers].sort((a, b) => (a.min || 0) - (b.min || 0)), [tiers]);
    const tierIndex = useMemo(() => new Map(tiersAsc.map((t, i) => [t.id, i])), [tiersAsc]);
    const tierById = useMemo(() => new Map(tiersAsc.map((t) => [t.id, t])), [tiersAsc]);
    const tables = useMemo(() => floorTables.map((t) => ({ key: t.key, sub: t.sub_segment || 'Other', zone: t.zone || t.pit || '', gametype: t.gametype })), [floorTables]);
    const tableByKey = useMemo(() => new Map(tables.map((t) => [t.key, t])), [tables]);
    const dates = useMemo(() => datesBetween(period.from, period.to), [period.from, period.to]);
    const dtOf = useCallback((d) => dayTypeOf(d, cfg), [cfg]);

    const history = useMemo(() => {
        if (!rows) return null;
        // History ends the day before the period (or where the feed ends).
        const before = (feed) => addDays([addDays(period.from, -1), maxDate(feed)].filter(Boolean).sort()[0] || addDays(period.from, -1), 1);
        const histWin = sourceWindow(crit.histSource, { defaultDays: crit.histWeeks * 7, before: before(rows.hourly) });
        const byBlock = crit.rankBasis === 'block';
        const rankFeed = byBlock ? rows.hourly : rows.daily;
        const rankWin = sourceWindow(crit.rankSource, { defaultDays: crit.rankDays, before: before(rankFeed) });
        const subOf = new Map(tables.map((t) => [t.key, t.sub]));
        const sharesByDt = {};
        for (const d of DAY_TYPES) {
            sharesByDt[d.id] = historyShares(rows.hourly, {
                ...histWin, dayType: d.id, cfg, tiersAsc, sameDayType: crit.histSameDayType, halfLife: crit.histHalfLife,
            });
        }
        const rankAgg = aggregateRows(rankFeed, { ...rankWin, cfg, byCore: byBlock });
        const cache = new Map();
        const coreArg = (core) => (byBlock ? core : 'day');
        const valuesFor = (dt, core) => {
            const k = `${dt}|${coreArg(core)}`;
            if (!cache.has(k)) cache.set(k, blendFromAgg(rankAgg, { dt, core: coreArg(core), mix: crit.rankMix, subOf, sameDayType: crit.rankSameDayType }));
            return cache.get(k);
        };
        const breakdown = (dt, core, sub) => signalBreakdown(rankAgg, { dt, core: coreArg(core), mix: crit.rankMix, subOf, sameDayType: crit.rankSameDayType, sub });
        const all = new Map();
        for (const m of Object.values(sharesByDt)) for (const [k, e] of m) {
            const cur = all.get(k) || {};
            for (const [id, s] of Object.entries(e)) cur[id] = (cur[id] || 0) + s;
            all.set(k, cur);
        }
        return {
            sharesByDt, valuesFor, breakdown, ladders: laddersFrom(all, tables, tiersAsc, crit.minShare / 100),
            window: histWin, rankWindow: rankWin,
        };
    // cfg.dowMap/overrides decide day types, criteria the windows and signals,
    // coreKey the blocks; targets/rules don't change history.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [rows, period.from, tables, tiersAsc, dayTypeKey, critKey, coreKey]);

    // Price lists: the user's edits per sub-segment, else what history ran.
    const pricesKey = JSON.stringify(cfg.prices);
    // Base = constants/segmentPrices.js, else history; the page's edits win.
    const base = useMemo(() => (history ? baseLadders(history.ladders, tiersAsc, SEGMENT_PRICES) : {}), [history, tiersAsc]);
    const priceSourceOf = useCallback((sub) => ((cfg.prices || {})[sub] ? 'edited'
        : (SEGMENT_PRICES[sub] || []).length && history && base[sub] !== history.ladders[sub] ? 'config' : 'history'), [cfg.prices, base, history]);
    const ladders = useMemo(() => (history ? effectiveLadders(history.ladders, cfg.prices, tiersAsc, SEGMENT_PRICES) : {}),
        [history, pricesKey, tiersAsc]); // eslint-disable-line react-hooks/exhaustive-deps

    const openByDate = useMemo(() => {
        const out = {};
        for (const d of dates) out[d] = openByBlock(schedule.byDate[d] || null, tables, crit.openRule).byCore;
        return out;
    }, [dates, schedule.byDate, tables, crit.openRule, coreKey]); // eslint-disable-line react-hooks/exhaustive-deps
    const missingSchedule = dates.filter((d) => !schedule.byDate[d]).length;

    // Open tables per core × sub-segment: one date, or the day type's average.
    const subs = useMemo(() => [...new Set(tables.map((t) => t.sub))], [tables]);
    const countsFor = useCallback((date) => {
        const out = {};
        for (const core of CORE_HOURS) {
            out[core] = {};
            const open = openByDate[date] ? openByDate[date].get(core) : null;
            for (const sub of subs) out[core][sub] = tables.filter((t) => t.sub === sub && (!open || open.has(t.key))).length;
        }
        return out;
    }, [openByDate, subs, tables, coreKey]); // eslint-disable-line react-hooks/exhaustive-deps
    const refOpen = useMemo(() => {
        const out = {};
        for (const dt of DAY_TYPES.map((x) => x.id)) {
            const ds = dates.filter((d) => dtOf(d) === dt);
            out[dt] = {};
            const per = ds.map(countsFor);
            for (const core of CORE_HOURS) {
                out[dt][core] = {};
                for (const sub of subs) {
                    out[dt][core][sub] = per.length ? Math.round(per.reduce((a, c) => a + c[core][sub], 0) / per.length) : tables.filter((t) => t.sub === sub).length;
                }
            }
        }
        return out;
    }, [dates, dtOf, countsFor, subs, tables, coreKey]); // eslint-disable-line react-hooks/exhaustive-deps
    // Scope = a day type id or 'd:YYYY-MM-DD'.
    const openCountFor = useCallback((scope, core, sub) => {
        if (String(scope).startsWith('d:')) return (countsFor(scope.slice(2))[core] || {})[sub] || 0;
        return ((refOpen[scope] || {})[core] || {})[sub] || 0;
    }, [countsFor, refOpen]);

    const scopeTables = useCallback((scope, core) => {
        const d = String(scope).startsWith('d:') ? scope.slice(2) : dates.find((x) => dtOf(x) === scope);
        const open = d && openByDate[d] ? openByDate[d].get(core) : null;
        return open ? tables.filter((t) => open.has(t.key)) : tables;
    }, [dates, dtOf, openByDate, tables]);
    const capsFor = useCallback((scope, core, sub) => capsForSub(rulesFor(cfg.rules, core), scopeTables(scope, core), sub), [cfg.rules, scopeTables]);
    const floorsFor = useCallback((scope, core, sub) => floorsForSub(rulesFor(cfg.rules, core), scopeTables(scope, core), sub), [cfg.rules, scopeTables]);
    // Fit a mix to a scope's open tables, pod maximums and pod minimums.
    const fitMix = useCallback((scope, core, sub, map) => {
        const lad = ladders[sub] || [];
        const a = allocate(foldToLadder(map || {}, lad, tierIndex), openCountFor(scope, core, sub), lad);
        const b = fitToCaps(a, capsFor(scope, core, sub), lad, crit.overflow).map;
        return fitToFloors(b, floorsFor(scope, core, sub), lad).map;
    }, [ladders, tierIndex, openCountFor, capsFor, floorsFor, crit.overflow]);

    const seeded = useMemo(() => {
        if (!history) return {};
        const out = {};
        for (const dt of DAY_TYPES.map((x) => x.id)) {
            const d = dates.find((x) => dtOf(x) === dt);
            const openByCore = d ? openByDate[d] : new Map(CORE_HOURS.map((c) => [c, new Set(tables.map((t) => t.key))]));
            const raw = seedTargets({ tables, openByCore, shares: history.sharesByDt[dt], ladders: history.ladders });
            out[dt] = {};
            for (const core of CORE_HOURS) {
                out[dt][core] = {};
                for (const sub of Object.keys(ladders)) out[dt][core][sub] = fitMix(dt, core, sub, raw[core][sub] || {});
            }
        }
        return out;
    }, [history, ladders, dates, dtOf, openByDate, tables, fitMix, coreKey]); // eslint-disable-line react-hooks/exhaustive-deps

    // The mix a scope shows: its own, else (for a date) its day type's, else history.
    const mixFor = useCallback((scope, core, sub) => {
        const own = targetsFor(cfg, scope, core, sub);
        if (own) return { map: own, from: 'own' };
        if (String(scope).startsWith('d:')) {
            const dt = dtOf(scope.slice(2));
            const dtMix = targetsFor(cfg, dt, core, sub);
            if (dtMix) return { map: dtMix, from: dt };
            return { map: ((seeded[dt] || {})[core] || {})[sub] || {}, from: 'history' };
        }
        return { map: ((seeded[scope] || {})[core] || {})[sub] || {}, from: 'history' };
    }, [cfg, dtOf, seeded]);

    const seedDayType = useCallback((dt) => {
        let next = cfg;
        for (const core of CORE_HOURS) for (const sub of Object.keys(seeded[dt] || {})) next = withTargets(next, dt, core, sub, seeded[dt][core][sub]);
        setCfg(next);
    }, [cfg, seeded, setCfg]);

    // Hard locks per date: Planning pins + manual prices (manual wins).
    const pinsFor = useCallback((d, cfgArg = cfg) => {
        const out = {};
        for (const core of CORE_HOURS) {
            const m = new Map(readPins(store, d, core));
            for (const [k, t] of manualFor(cfgArg, d, core)) m.set(k, t);
            out[core] = m;
        }
        return out;
    }, [store, cfg, coreKey]); // eslint-disable-line react-hooks/exhaustive-deps

    const buildCtx = useCallback((cfgArg = cfg) => {
        const currentByDate = {}, pinsByDate = {};
        for (const d of dates) {
            currentByDate[d] = {};
            for (const core of CORE_HOURS) { const m = readBlockMap(store, d, core); if (m.size) currentByDate[d][core] = m; }
            pinsByDate[d] = Object.fromEntries(CORE_HOURS.map((c) => [c, readPins(store, d, c)]));
        }
        return {
            cfg: cfgArg, tables, tiersAsc, tierIndex, tierLabel: (id) => tierLabel(tierById.get(id)),
            ladders, sharesByDt: history.sharesByDt, valuesFor: history.valuesFor, valuesByDt: {}, seededByDt: seeded,
            openByDate, currentByDate, pinsByDate, keepPins, stayClose,
        };
    }, [cfg, dates, store, tables, tiersAsc, tierIndex, tierById, history, ladders, seeded, openByDate, keepPins, stayClose, coreKey]); // eslint-disable-line react-hooks/exhaustive-deps

    // What a solve depends on besides the data: when it differs from the
    // draft's, the draft is out of date ("Solve again").
    const solveKey = useMemo(() => JSON.stringify({
        t: cfg.targets, r: cfg.rules, w: cfg.weights, c: cfg.criteria, h: cfg.coreHours, p: cfg.prices, x: cfg.manual,
        m: cfg.dowMap, o: cfg.overrides, keepPins, stayClose, period,
    }), [cfg, keepPins, stayClose, period]);

    const refDate = useMemo(() => pickReferenceDate(dates, cfg, openByDate, crit.anchorCore),
        [dates, cfg, openByDate, crit.anchorCore]);

    // ── Solve: the reference plan, then the dates (all, or a list) ─────
    const solveDates = useCallback(async (only = null) => {
        if (!history || !dates.length || !refDate) return;
        const run = ++runRef.current;
        setSolving(true);
        const ctx = buildCtx();
        const ref = solveReference(ctx, refDate);
        const partial = only && draft;
        const byDate = partial ? { ...draft.byDate } : {};
        const reports = partial ? { ...draft.reports } : {};
        const anchors = partial ? { ...draft.anchors } : {};
        const alignDiffs = partial ? { ...draft.alignDiffs } : {};
        // A re-solved date also changes the next date's 05 → 07 report.
        const list = partial ? dates.filter((d, i) => only.includes(d) || (i > 0 && only.includes(dates[i - 1]))) : dates;
        setProgress({ done: 0, total: list.length });
        for (let i = 0; i < list.length; i++) {
            const d = list[i];
            const di = dates.indexOf(d);
            let prevDateLast = di > 0 ? (byDate[dates[di - 1]] || {})[lastCore()] : readBlockMap(store, addDays(d, -1), lastCore());
            if (prevDateLast && !prevDateLast.size) prevDateLast = null;
            const r = solveDate(ctx, d, { ref, prevDateLast });
            byDate[d] = r.byCore; reports[d] = r.report; anchors[d] = r.anchor; alignDiffs[d] = r.alignDiffs;
            setProgress({ done: i + 1, total: list.length });
            await tick();
            if (runRef.current !== run) return;
        }
        const pins = {};
        for (const d of dates) pins[d] = pinsFor(d);
        setDraft({ byDate, reports, pins, at: Date.now(), key: solveKey, coreKey, ref, refDate, anchors, alignDiffs });
        setSolving(false);
    }, [history, dates, refDate, buildCtx, draft, store, pinsFor, solveKey, coreKey]);

    // Manual prices: save the rule, then re-solve once the setting lands.
    // A change on the reference date's anchor block moves the reference → all dates.
    const pendingRef = useRef(null);
    useEffect(() => {
        if (!pendingRef.current) return;
        const only = pendingRef.current;
        pendingRef.current = null;
        solveDates(only === 'all' ? null : only);
    }, [cfg.manual, cfg.rules, solveDates]);
    const setManual = useCallback((date, core, keys, tierId) => {
        const anchorOfRef = pickAnchor(CORE_HOURS, crit.anchorCore, openByDate[refDate]);
        if (draft) pendingRef.current = date === refDate && core === anchorOfRef ? 'all' : [date];
        let next = withManual(cfg, date, core, keys, tierId);
        // A manual price outside a sub-segment's list joins the list.
        if (tierId) {
            for (const sub of new Set(keys.map((k) => (tableByKey.get(k) || {}).sub).filter(Boolean))) {
                const lad = ladders[sub] || [];
                if (!lad.includes(tierId)) next = withPrices(next, sub, [...lad, tierId], tiersAsc);
            }
        }
        setCfg(next);
    }, [cfg, setCfg, draft, refDate, openByDate, crit.anchorCore, tableByKey, ladders, tiersAsc]);
    const keepAndResolve = useCallback((date, core, key, tier) => setManual(date, core, [key], tier), [setManual]);
    // A rule for tables picked on the floor (lock / range / max step), every
    // date. A locked price outside a sub-segment's list joins the list.
    const addTableRule = useCallback((ruleDraft, keys) => {
        let next = {
            ...cfg,
            rules: [...cfg.rules, { id: cfg.nextRuleId, on: true, scope: tablesScope(keys), ...ruleDraft }],
            nextRuleId: cfg.nextRuleId + 1,
        };
        if (ruleDraft.type === 'lock') {
            for (const sub of new Set(keys.map((k) => (tableByKey.get(k) || {}).sub).filter(Boolean))) {
                const lad = ladders[sub] || [];
                if (!lad.includes(ruleDraft.tier)) next = withPrices(next, sub, [...lad, ruleDraft.tier], tiersAsc);
            }
        }
        if (draft) pendingRef.current = 'all';
        setCfg(next);
    }, [cfg, setCfg, draft, tableByKey, ladders, tiersAsc]);
    const clearManual = useCallback((date) => {
        if (draft) pendingRef.current = date === refDate ? 'all' : [date];
        setCfg(clearManualDate(cfg, date));
    }, [cfg, setCfg, draft, refDate]);

    const discard = useCallback(() => { runRef.current++; setDraft(null); setSolving(false); }, []);

    const apply = useCallback(() => {
        if (!draft) return 0;
        const n = Object.keys(draft.byDate).length;
        setStore((prev) => applyDraft(prev, draft.byDate, { openHoursByDate: schedule.byDate, pinsByDate: draft.pins }));
        setDraft(null);
        return n;
    }, [draft, setStore, schedule.byDate]);

    // Store with the draft overlaid for one date (what the floor / charts show).
    const overlay = useCallback((base, date) => {
        if (!draft || !draft.byDate[date]) return base;
        const plan = base.plans?.[date] || { byDaypart: {}, versions: [] };
        return { ...base, plans: { ...base.plans, [date]: { ...plan, byDaypart: { ...plan.byDaypart, ...expandDate(draft.byDate[date], schedule.byDate[date] || null, draft.pins[date]) } } } };
    }, [draft, schedule.byDate]);

    const closedCheck = useCallback((date) => (draft && draft.byDate[date] ? closedHourCheck(draft.byDate[date], schedule.byDate[date] || null) : null),
        [draft, schedule.byDate]);

    const dateStats = useMemo(() => {
        const out = {};
        if (!draft) return out;
        for (const d of dates) {
            const rep = draft.reports[d];
            if (!rep) continue;
            // Within the day vs the overnight handover (previous date's last core → first core).
            let changes = 0, lb = 0, problems = 0, podOver = 0;
            for (const c of CORE_HOURS) {
                problems += rep[c].problems.length; podOver += (rep[c].podOver || []).length;
                if (c === CORE_HOURS[0]) continue;
                changes += rep[c].changes.length; lb += rep[c].lb;
            }
            out[d] = { changes, lb, problems, podOver, overnight: rep[CORE_HOURS[0]].changes.length, alignDiffs: (draft.alignDiffs || {})[d] || 0 };
        }
        return out;
    }, [draft, dates]);
    const totals = useMemo(() => Object.values(dateStats).reduce((a, s) => ({
        changes: a.changes + s.changes, lb: a.lb + s.lb, problems: a.problems + s.problems, podOver: a.podOver + s.podOver, alignDiffs: a.alignDiffs + s.alignDiffs, overnight: a.overnight + s.overnight,
    }), { changes: 0, lb: 0, problems: 0, podOver: 0, alignDiffs: 0, overnight: 0 }), [dateStats]);

    // Rule checks + per-rule cost and the hour-by-hour baseline, for one date.
    const [measure, setMeasure] = useState({ key: null, costs: new Map(), baseline: null, busy: false });
    const measureDate = useCallback(async (date) => {
        if (!draft || !draft.byDate[date] || !history) return;
        const key = `${draft.at}|${date}`;
        if (measure.key === key) return;
        setMeasure({ key, costs: new Map(), baseline: null, busy: true });
        const i = dates.indexOf(date);
        const prevDateLast = i > 0 ? (draft.byDate[dates[i - 1]] || {})[lastCore()] || null : null;
        const count = (rep) => CORE_HOURS.slice(1).reduce((a, c) => a + rep[c].changes.length, 0);
        const base = count(draft.reports[date]);
        const costs = new Map();
        for (const r of cfg.rules.filter((x) => x.on)) {
            await tick();
            const ctx = buildCtx({ ...cfg, rules: cfg.rules.map((x) => (x.id === r.id ? { ...x, on: false } : x)) });
            costs.set(r.id, base - count(solveDate(ctx, date, { ref: draft.ref, prevDateLast }).report));
        }
        await tick();
        const flat = buildCtx({ ...cfg, weights: { ...cfg.weights, change: 0, step: 0, stay: 0, align: 0, hold: 0 } });
        const rep = solveDate({ ...flat, stayClose: false }, date, {}).report;
        setMeasure({ key, costs, baseline: count(rep), busy: false });
    }, [draft, history, measure.key, dates, cfg, buildCtx]);

    const ruleChecks = useCallback((date) => {
        if (!draft || !draft.byDate[date]) return [];
        const plan = draft.byDate[date], rep = draft.reports[date];
        return cfg.rules.filter((r) => r.on).map((r) => {
            let ok = true;
            for (const core of r.hours) {
                const a = plan[core];
                if (!a) continue;
                if (r.type === 'zonecap') {
                    const have = {}, size = {};
                    for (const [k, id] of a) {
                        const t = tableByKey.get(k);
                        if (!t || !inScope(t, r.scope)) continue;
                        const z = `${t.sub}|${t.zone}`;
                        size[z] = (size[z] || 0) + 1;
                        if (id === r.tier) have[z] = (have[z] || 0) + 1;
                    }
                    if (r.maxOn !== false && Object.values(have).some((c) => c > r.n)) ok = false;
                    if (r.minOn && Object.keys(size).some((z) => (have[z] || 0) < Math.min(r.min, size[z]))) ok = false;
                }
                if (r.type === 'range') for (const [k, id] of a) { const t = tableByKey.get(k); if (t && inScope(t, r.scope) && (tierIndex.get(id) < tierIndex.get(r.lo) || tierIndex.get(id) > tierIndex.get(r.hi))) ok = false; }
                if (r.type === 'lock') {
                    // Every open table in scope must carry the locked price (a missing price fails too).
                    const open = (openByDate[date] && openByDate[date].get(core)) || new Set();
                    for (const t of tables) if (open.has(t.key) && inScope(t, r.scope) && a.get(t.key) !== r.tier) ok = false;
                }
                if (r.type === 'maxstep') for (const c of rep[core].changes) { const t = tableByKey.get(c.key); if (t && inScope(t, r.scope) && Math.abs(tierIndex.get(c.to) - tierIndex.get(c.from)) > r.n) ok = false; }
            }
            return { rule: r, ok, cost: measure.key && measure.key.endsWith(`|${date}`) ? measure.costs.get(r.id) ?? null : null };
        });
    }, [draft, cfg.rules, tableByKey, tierIndex, measure, openByDate, tables]);

    const changeSheet = useCallback(() => {
        if (!draft) return '';
        const lines = ['date,day_type,block,table,sub_segment,zone,from,to'];
        for (const d of dates) {
            const rep = draft.reports[d];
            if (!rep) continue;
            for (const c of CORE_HOURS) for (const ch of rep[c].changes) {
                const t = tableByKey.get(ch.key) || {};
                lines.push([d, dtOf(d), blockLabel(c), ch.key.replace('|', ''), t.sub || '', t.zone || '', tierLabel(tierById.get(ch.from)), tierLabel(tierById.get(ch.to))].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(','));
            }
        }
        return lines.join('\n');
    }, [draft, dates, tableByKey, dtOf, tierById]);

    // Top-percent rank of a table within its sub-segment at a core hour.
    const rankPctOf = useCallback((date, key, core = crit.anchorCore) => {
        if (!history) return 50;
        const vals = history.valuesFor(dtOf(date), core);
        const t = tableByKey.get(key);
        if (!t) return 50;
        const peers = tables.filter((x) => x.sub === t.sub).map((x) => vals.get(x.key) || 0).sort((a, b) => b - a);
        const i = peers.findIndex((x) => x <= (vals.get(key) || 0));
        return Math.max(1, Math.round(((i < 0 ? peers.length : i + 1) / Math.max(1, peers.length)) * 100));
    }, [history, dtOf, tableByKey, tables, crit.anchorCore]);
    const rankBreakdown = useCallback((dt, core, sub) => (history ? history.breakdown(dt, core, sub) : []), [history]);

    // Core hours change the blocks: rules that covered every core hour keep
    // covering every core hour; hours that no longer exist drop out.
    // `patch` saves other settings in the same write (Reset all).
    const setCoreHoursCfg = useCallback((list, patch = {}) => {
        const next = normalizeCoreHours(list);
        const old = cfg.coreHours;
        const rules = cfg.rules.map((r) => {
            const all = old.every((h) => r.hours.includes(h));
            return { ...r, hours: all ? [...next] : r.hours.filter((h) => next.includes(h)) };
        });
        setCfg({ ...cfg, ...patch, coreHours: next, rules });
    }, [cfg, setCfg]);

    const dateCounts = useMemo(() => {
        const c = {};
        for (const d of dates) c[dtOf(d)] = (c[dtOf(d)] || 0) + 1;
        return c;
    }, [dates, dtOf]);

    return {
        cfg, setCfg, setCoreHours: setCoreHoursCfg, period, setPeriod, keepPins, setKeepPins, stayClose, setStayClose,
        stale: !!draft && draft.key !== solveKey,
        ready: !!history && dates.length > 0, loading: active && !rows, history, dates, dtOf, dateCounts,
        tables, tableByKey, tiersAsc, tierIndex, tierById, ladders, historyLadders: base, priceSourceOf, subs,
        refOpen, openCountFor, seeded, mixFor, capsFor, floorsFor, fitMix, seedDayType, openByDate, missingSchedule, hasSchedule: (d) => !!schedule.byDate[d],
        refDate, anchorFor: (d) => pickAnchor(CORE_HOURS, crit.anchorCore, openByDate[d]),
        draft, solving, progress, solve: () => solveDates(null), keepAndResolve, setManual, clearManual, addTableRule, discard, apply, overlay, closedCheck,
        dateStats, totals, measure, measureDate, ruleChecks, changeSheet, pinsFor, rankPctOf, rankBreakdown, dateKey,
    };
}
