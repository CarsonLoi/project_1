// Auto-plan — solve a period the way the floor plans by hand:
//   1. a reference day's anchor hour (21:00 by default, the busiest) first;
//   2. every date's anchor hour aligned to that reference plan;
//   3. within each date, outward from the anchor: 15 ← 21, 13 ← 15, 11 ← 13,
//      07 ← 11 and 03 ← 21, 05 ← 03 — each hour against its neighbour.
// Every step is one exact min-cost flow (solver.js). Reports stay in time
// order (07 → 11 → … → 05, and the previous date's 05 → 07).

import { CORE_HOURS, dayTypeOf, prevCore, lastCore } from './core';
import { targetsForDate, manualFor, manualExemptFor, groupGame } from './config';
import { fitToCount, fitToCaps, fitToFloors, foldToLadder } from './inputs';
import { solveBlock, rulesFor, capsForSub, floorsForSub, diagnose, lowerBound, changesBetween, recentChanges, inScope, groupOf } from './solver';
import { getDaypartAssignments } from '../pricingStorage';
import { readPrice } from '../pricingModel';

export function planTargets({ stored, seeded, openCount, ladder, caps, floors, overflow = 'down', tierIndex = null }) {
    let base = stored && Object.values(stored).some((n) => n > 0) ? stored : (seeded || {});
    // A price removed from the list hands its tables to the next price.
    if (tierIndex) base = foldToLadder(base, ladder, tierIndex);
    let out = fitToCount(base, openCount, ladder);
    if (caps && caps.size) out = fitToCaps(out, caps, ladder, overflow).map;
    if (floors && floors.size) out = fitToFloors(out, floors, ladder).map;
    return out;
}

export function readBlockMap(store, date, core) {
    const out = new Map();
    for (const [k, v] of Object.entries(getDaypartAssignments(store, date, `h_${core}`))) {
        const p = readPrice(v);
        if (p) out.set(k, p.base);
    }
    return out;
}
export function readPins(store, date, core) {
    const out = new Map();
    for (const [k, v] of Object.entries(getDaypartAssignments(store, date, `h_${core}`))) if (v && v.pin && v.base) out.set(k, v.base);
    return out;
}

// ── Order ────────────────────────────────────────────────────────────
// Anchor first; then backward to the first core hour; then forward to the last.
export function solveOrder(coreHours, anchor) {
    const i = coreHours.indexOf(anchor);
    const out = [{ core: anchor, parent: null, dir: null }];
    for (let j = i - 1; j >= 0; j--) out.push({ core: coreHours[j], parent: coreHours[j + 1], dir: 'back' });
    for (let j = i + 1; j < coreHours.length; j++) out.push({ core: coreHours[j], parent: coreHours[j - 1], dir: 'fwd' });
    return out;
}

// The chosen anchor when it is a core hour, else the core hour with most open tables.
export function pickAnchor(coreHours, anchorCore, openByCore) {
    if (coreHours.includes(anchorCore)) return anchorCore;
    let best = coreHours[0], n = -1;
    for (const c of coreHours) {
        const s = ((openByCore && openByCore.get(c)) || new Set()).size;
        if (s > n) { n = s; best = c; }
    }
    return best;
}

// Reference date: the first date of the reference day type; "auto" (or none
// of that type in the period) → the day type with most open tables at the
// anchor on average, its first date.
export function pickReferenceDate(dates, cfg, openByDate, anchor) {
    if (!dates.length) return null;
    const want = (cfg.criteria || {}).refDayType || 'sat';
    if (want !== 'auto') {
        const d = dates.find((x) => dayTypeOf(x, cfg) === want);
        if (d) return d;
    }
    const open = (d) => ((openByDate[d] && openByDate[d].get(anchor)) || new Set()).size;
    const byDt = new Map();
    for (const d of dates) {
        const dt = dayTypeOf(d, cfg);
        const e = byDt.get(dt) || { sum: 0, n: 0, first: d };
        e.sum += open(d); e.n += 1;
        byDt.set(dt, e);
    }
    let best = null;
    for (const e of byDt.values()) if (!best || e.sum / e.n > best.sum / best.n) best = e;
    return best.first;
}

// Weights for a solve: with a base plan kept "as close as possible", a
// difference from it costs `base` (above a change) instead of `stay`.
function weightsOf(ctx) {
    const W = ctx.cfg.weights;
    return ctx.baseStrength === 'strong' ? { ...W, stay: W.base ?? 30000 } : W;
}

// ── One block ────────────────────────────────────────────────────────
const valuesOf = (ctx, dt, core) => (ctx.valuesFor ? ctx.valuesFor(dt, core) : (ctx.valuesByDt[dt] || new Map())) || new Map();

function blockInputs(ctx, date, dt, core) {
    const open = (ctx.openByDate[date] && ctx.openByDate[date].get(core)) || new Set();
    const vals = valuesOf(ctx, dt, core);
    const tables = ctx.tables.filter((t) => open.has(t.key)).map((t) => ({ ...t, value: vals.get(t.key) || 0 }));
    const rules = rulesFor(ctx.cfg.rules, core);
    const crit = ctx.cfg.criteria || {};
    // Hard locks: Planning pins (when kept) and manual prices (always; they win).
    const pins = new Map(ctx.keepPins ? (((ctx.pinsByDate[date] || {})[core]) || new Map()) : new Map());
    const exempt = new Map();
    for (const [k, id] of manualFor(ctx.cfg, date, core)) if (open.has(k)) pins.set(k, id);
    for (const [k, ex] of manualExemptFor(ctx.cfg, date, core)) if (open.has(k)) exempt.set(k, ex);
    // Lock rules hold like pins, so the target mix makes room for their price.
    for (const r of rules) {
        if (r.type !== 'lock') continue;
        for (const t of tables) {
            if (pins.has(t.key) || !inScope(t, r.scope)) continue;
            pins.set(t.key, r.tier);
            if (r.exempt && r.exempt.length) exempt.set(t.key, r.exempt);
        }
    }
    // Targets per mix group (sub-segment × game type).
    const targets = {};
    for (const g of Object.keys(ctx.ladders)) {
        const n = tables.filter((t) => groupOf(t) === g).length;
        // Locked tables exempt from a pod maximum sit on top of what it allows.
        const caps = capsForSub(rules, tables, g);
        for (const t of tables) {
            if (groupOf(t) !== g || !exempt.has(t.key) || !caps.has(pins.get(t.key))) continue;
            caps.set(pins.get(t.key), caps.get(pins.get(t.key)) + 1);
        }
        targets[g] = planTargets({
            stored: targetsForDate(ctx.cfg, date, dt, core, g),
            seeded: ((ctx.seededByDt[dt] || {})[core] || {})[g],
            openCount: n, ladder: ctx.ladders[g],
            caps, floors: floorsForSub(rules, tables, g),
            overflow: crit.overflow || 'down', tierIndex: ctx.tierIndex,
        });
    }
    const fit = fitSharedPods({ targets, tables, rules, ladders: ctx.ladders, pins, exempt, overflow: crit.overflow || 'down', tierLabel: ctx.tierLabel });
    const current = ctx.stayClose ? (((ctx.currentByDate[date] || {})[core]) || null) : null;
    const shares = new Map();
    const sh = ctx.sharesByDt[dt] || new Map();
    for (const t of tables) { const e = sh.get(`${t.key}|${core}`); if (e) shares.set(t.key, e); }
    return { tables, rules, targets: fit.targets, fitNotes: fit.notes, pins, current, shares, exempt };
}

// A sub-segment's game types share its pod maximums: when their targets at a
// price add up to more than the pods allow (pods × max, plus exempt locked
// tables), the excess moves one price down (up with overflow 'up') in the
// game types with the most tables at that price, never below their locked ones.
export function fitSharedPods({ targets, tables, rules, ladders, pins = new Map(), exempt = new Map(), overflow = 'down', tierLabel = (id) => id }) {
    const out = Object.fromEntries(Object.entries(targets).map(([g, m]) => [g, { ...m }]));
    const notes = [];
    for (const sub of new Set(tables.map((t) => t.sub))) {
        const ts = tables.filter((t) => t.sub === sub);
        const groups = [...new Set(ts.map(groupOf))].filter((g) => out[g] && ladders[g]);
        if (groups.length < 2) continue;
        for (const r of rules) {
            if (r.type !== 'zonecap' || r.maxOn === false || !ts.every((t) => inScope(t, r.scope))) continue;
            const free = (t) => !(exempt.get(t.key) || []).some((x) => x === '*' || x === r.id);
            const zones = new Set(ts.filter(free).map((t) => t.zone));
            const extra = ts.filter((t) => !free(t) && pins.get(t.key) === r.tier).length;
            const allow = zones.size * r.n + extra;
            const lockedIn = (g) => ts.filter((t) => groupOf(t) === g && pins.get(t.key) === r.tier).length;
            let over = groups.reduce((a, g) => a + (out[g][r.tier] || 0), 0) - allow;
            if (over <= 0) continue;
            const moved = {};
            while (over > 0) {
                const g = groups.filter((x) => (out[x][r.tier] || 0) > lockedIn(x))
                    .sort((a, b) => (out[b][r.tier] || 0) - (out[a][r.tier] || 0) || (a < b ? -1 : 1))[0];
                if (!g) break;
                const lad = ladders[g], i = lad.indexOf(r.tier);
                const to = overflow === 'up' ? (lad[i + 1] ?? lad[i - 1]) : (lad[i - 1] ?? lad[i + 1]);
                if (i < 0 || to == null) break;
                out[g][r.tier] -= 1; out[g][to] = (out[g][to] || 0) + 1;
                moved[g] = (moved[g] || 0) + 1; over -= 1;
            }
            const parts = Object.entries(moved).map(([g, n]) => `${n} ${groupGame(g)}`);
            if (parts.length) notes.push(`${sub}: ${parts.join(', ')} target table${Object.values(moved).reduce((a, b) => a + b, 0) === 1 ? '' : 's'} moved off ${tierLabel(r.tier)} to fit "max ${r.n} per pod" (shared by game types)`);
        }
    }
    return { targets: out, notes };
}

function runBlock(ctx, inp, { parent, dir, weights, scale, recentChanged, night = null }) {
    const cap = (ctx.cfg.criteria || {}).podChangeCap || {};
    const base = {
        tables: inp.tables, targets: inp.targets, ladders: ctx.ladders, tierIndex: ctx.tierIndex, prev: parent,
        current: inp.current, shares: inp.shares, pins: inp.pins, rules: inp.rules, weights, recentChanged, exempt: inp.exempt,
        direction: dir || 'fwd', changeScale: scale, night, tierLabel: ctx.tierLabel,
    };
    let r = solveBlock(base);
    let podOver = [];
    // Max changes per pod: re-solve with a penalty on pods over the cap.
    if (cap.on && parent) {
        const penalty = new Map();
        for (let i = 0; i < 4; i++) {
            const byZone = new Map();
            for (const c of changesBetween(parent, r.assign)) {
                const t = inp.tables.find((x) => x.key === c.key);
                if (t) byZone.set(t.zone, (byZone.get(t.zone) || 0) + 1);
            }
            podOver = [...byZone].filter(([, n]) => n > cap.n).map(([zone, changes]) => ({ zone, changes }));
            if (!podOver.length) break;
            for (const o of podOver) penalty.set(o.zone, (penalty.get(o.zone) || 0) + 2000);
            r = solveBlock({ ...base, podPenalty: penalty });
        }
    }
    return { ...r, podOver };
}

function problemsOf(ctx, inp, r) {
    const problems = r.ok ? [] : diagnose({ tables: inp.tables, targets: r.targets, rules: inp.rules, pins: inp.pins, tierLabel: ctx.tierLabel });
    if (!r.ok && !problems.length) problems.push(`${r.unplaced.length} table(s) could not be priced: ${r.unplaced.slice(0, 5).join(', ')}`);
    for (const s of r.podShort || []) problems.push(`Pod ${s.zone} (${s.sub}): ${s.have} of at least ${s.min} × ${ctx.tierLabel(s.tier)}`);
    return problems;
}

// ── Reference plan ───────────────────────────────────────────────────
// The reference date's anchor hour, from rank, history, saved plan and rules.
export function solveReference(ctx, refDate) {
    const dt = dayTypeOf(refDate, ctx.cfg);
    const anchor = pickAnchor(CORE_HOURS, (ctx.cfg.criteria || {}).anchorCore ?? 21, ctx.openByDate[refDate]);
    const inp = blockInputs(ctx, refDate, dt, anchor);
    return runBlock(ctx, inp, { parent: null, dir: null, weights: weightsOf(ctx), scale: 1, recentChanged: null }).assign;
}

// ── One date ─────────────────────────────────────────────────────────
// opts.ref: reference anchor plan (Map) · opts.prevDateLast: previous date's
// last core hour, only for the 05 → 07 report.
export function solveDate(ctx, date, opts) {
    const { ref = null, prevDateLast = null } = opts || {};
    const dt = dayTypeOf(date, ctx.cfg);
    const crit = ctx.cfg.criteria || {};
    const W = weightsOf(ctx);
    const holdN = crit.holdHours || 2;
    const mult = crit.changeMult || {};
    const anchor = pickAnchor(CORE_HOURS, crit.anchorCore ?? 21, ctx.openByDate[date]);
    const byCore = {}, inputs = {}, results = {}, lineage = {};
    let alignDiffs = 0;
    for (const step of solveOrder(CORE_HOURS, anchor)) {
        const inp = blockInputs(ctx, date, dt, step.core);
        inputs[step.core] = inp;
        let r;
        if (step.parent == null) {
            // Anchor hour: a difference from the reference costs `align`.
            r = runBlock(ctx, inp, { parent: ref, dir: null, weights: { ...W, change: W.align ?? W.change }, scale: 1, recentChanged: null });
            alignDiffs = ref ? changesBetween(ref, r.assign).length : 0;
            lineage[step.core] = [r.assign];
        } else {
            // The change happens at the later of the two hours in time.
            const when = step.dir === 'back' ? step.parent : step.core;
            r = runBlock(ctx, inp, {
                parent: byCore[step.parent], dir: step.dir, weights: W, scale: mult[when] || 1,
                recentChanged: recentChanges(lineage[step.parent], holdN),
                night: step.core === CORE_HOURS[0] ? prevDateLast : null,
            });
            lineage[step.core] = [...lineage[step.parent], r.assign];
        }
        byCore[step.core] = r.assign;
        results[step.core] = r;
    }
    // The minimum for a transition is measured the way it was solved: from
    // the parent hour's plan to the child hour's targets and open tables.
    const parentOf = new Map(solveOrder(CORE_HOURS, anchor).map((s) => [s.core, s.parent]));
    const report = {};
    CORE_HOURS.forEach((core, i) => {
        const prevCoreH = i > 0 ? CORE_HOURS[i - 1] : null;
        const prev = prevCoreH != null ? byCore[prevCoreH] : prevDateLast;
        const r = results[core], inp = inputs[core];
        let lb;
        if (prevCoreH == null) lb = lowerBound(prev, r.targets, inp.tables);
        else if (parentOf.get(prevCoreH) === core) lb = lowerBound(r.assign, results[prevCoreH].targets, inputs[prevCoreH].tables);
        else lb = lowerBound(prev, r.targets, inp.tables);
        report[core] = {
            ok: r.ok, notes: [...(inp.fitNotes || []), ...r.notes], problems: problemsOf(ctx, inp, r), targets: r.targets,
            changes: prev ? changesBetween(prev, r.assign) : [], lb,
            podOver: r.podOver || [],
            // Against the base plan (the old version being adjusted), when there is one.
            baseChanges: inp.current ? changesBetween(inp.current, r.assign) : [],
            baseLb: inp.current ? lowerBound(inp.current, r.targets, inp.tables) : 0,
            from: `${prevCore(core) == null ? 'previous date ' : ''}${String(prevCore(core) ?? lastCore()).padStart(2, '0')}:00`,
        };
    });
    return { byCore, report, dayType: dt, anchor, alignDiffs };
}

// A saved version's prices at one core hour (the base plan to adjust).
export function readVersionBlockMap(store, date, versionNumber, core) {
    const out = new Map();
    const v = ((((store.plans || {})[date] || {}).versions) || []).find((x) => x.versionNumber === versionNumber);
    const a = (((v || {}).byDaypart || {})[`h_${core}`] || {}).assignments || {};
    for (const [k, val] of Object.entries(a)) { const p = readPrice(val); if (p) out.set(k, p.base); }
    return out;
}
