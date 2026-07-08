// Pricing store — localStorage persistence (per date × daypart)
// =============================================================
//
// Shape:
//   {
//     tiers:    [ { id, label, min, color }, ... ],   // price tier library
//     dayparts: [ { id, label, startHour, endHour }, ... ],  // time blocks
//     plans: {                                        // keyed by gaming date
//       '2026-06-19': {
//         byDaypart: { [daypartId]: { assignments: { [tableKey]: tierId } } },
//         versions: [ { versionId, versionNumber, savedAt, byDaypart } ],
//         activeVersionId: 'v_…' | null,
//       },
//     },
//   }
//
// By-hour pricing without a per-hour plan: assignments live per DAYPART
// (a few-hour block). Resolving an hour = find its daypart, read that
// block's map. Same shape family as the scheduling store, so planDiff +
// the floor map still drop in (a tier plays the role of a shift).

import { DEFAULT_TIERS, DEFAULT_BOUNDARY_PRESETS } from '../constants/defaultTiers';
import { DEFAULT_DAYPARTS } from '../constants/defaultDayparts';

const KEY = 'pricing.plan.v1';

export function emptyStore() {
    return {
        tiers: DEFAULT_TIERS.map((t) => ({ ...t })),
        dayparts: DEFAULT_DAYPARTS.map((d) => ({ ...d })),
        boundaryPresets: DEFAULT_BOUNDARY_PRESETS.map((p) => ({ ...p })),
        plans: {},
    };
}

export function loadPricing() {
    try {
        const raw = typeof window !== 'undefined' && window.localStorage.getItem(KEY);
        if (!raw) return emptyStore();
        const parsed = JSON.parse(raw);
        if (!parsed.tiers || parsed.tiers.length === 0) parsed.tiers = DEFAULT_TIERS.map((t) => ({ ...t }));
        if (!parsed.dayparts || parsed.dayparts.length === 0) parsed.dayparts = DEFAULT_DAYPARTS.map((d) => ({ ...d }));
        if (!parsed.boundaryPresets) parsed.boundaryPresets = DEFAULT_BOUNDARY_PRESETS.map((p) => ({ ...p }));
        if (!parsed.plans) parsed.plans = {};
        // One-time migration: seed the Performance Heatmap "Table minimum"
        // ladder (12 bands: 50…10,000) with its colors. The old default ids
        // (m50…m5000) are a subset, so existing assignments are preserved.
        // Runs once per install; edits afterward are kept.
        if ((parsed._tierColorV || 0) < 2) {
            parsed.tiers = DEFAULT_TIERS.map((t) => ({ ...t }));
            parsed._tierColorV = 2;
        }
        // Migrate any legacy flat `assignments` (pre-daypart) into the
        // first daypart so existing work isn't orphaned.
        const firstDp = parsed.dayparts[0]?.id;
        for (const date of Object.keys(parsed.plans)) {
            const plan = parsed.plans[date];
            if (plan && !plan.byDaypart) {
                plan.byDaypart = firstDp ? { [firstDp]: { assignments: plan.assignments || {} } } : {};
                delete plan.assignments;
            }
        }
        return parsed;
    } catch {
        return emptyStore();
    }
}

export function savePricing(store) {
    try {
        if (typeof window !== 'undefined') window.localStorage.setItem(KEY, JSON.stringify(store));
    } catch (e) {
        // eslint-disable-next-line no-console
        console.warn('[Pricing] could not persist store:', e?.message);
    }
    return store;
}

// ---- Library mutators ------------------------------------------------

export function setTiers(store, tiers) {
    return savePricing({ ...store, tiers });
}

export function setDayparts(store, dayparts) {
    return savePricing({ ...store, dayparts });
}

export function setBoundaryPresets(store, boundaryPresets) {
    return savePricing({ ...store, boundaryPresets });
}

// ---- Per (date × daypart) assignment access --------------------------

function ensurePlan(plan) {
    return plan || { byDaypart: {}, versions: [], activeVersionId: null };
}

export function getDaypartAssignments(store, date, daypartId) {
    return store.plans?.[date]?.byDaypart?.[daypartId]?.assignments || {};
}

export function setDaypartAssignments(store, date, daypartId, assignments) {
    const plan = ensurePlan(store.plans?.[date]);
    const nextPlan = {
        ...plan,
        byDaypart: {
            ...plan.byDaypart,
            [daypartId]: { assignments },
        },
    };
    return savePricing({ ...store, plans: { ...store.plans, [date]: nextPlan } });
}

// Copy one daypart's assignments into a set of OTHER dayparts (the
// "assign the same plan for a couple of hours" action).
export function copyDaypart(store, date, fromId, toIds) {
    const plan = ensurePlan(store.plans?.[date]);
    const src = plan.byDaypart?.[fromId]?.assignments || {};
    const nextByDaypart = { ...plan.byDaypart };
    for (const id of toIds || []) {
        if (id === fromId) continue;
        nextByDaypart[id] = { assignments: { ...src } };
    }
    const nextPlan = { ...plan, byDaypart: nextByDaypart };
    return savePricing({ ...store, plans: { ...store.plans, [date]: nextPlan } });
}

// Snapshot the whole day (every daypart) as an immutable, optionally
// named version.
export function saveVersion(store, date, name = '') {
    const plan = ensurePlan(store.plans?.[date]);
    const versionNumber = (plan.versions || []).reduce((m, v) => Math.max(m, v.versionNumber || 0), 0) + 1;
    const version = {
        versionId: `v_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        versionNumber,
        name: String(name || '').trim(),
        savedAt: new Date().toISOString(),
        byDaypart: JSON.parse(JSON.stringify(plan.byDaypart || {})),
    };
    const nextPlan = {
        ...plan,
        versions: [...(plan.versions || []), version],
        activeVersionId: version.versionId,
    };
    return savePricing({ ...store, plans: { ...store.plans, [date]: nextPlan } });
}

// Load a saved version back into the live working plan (every daypart).
export function restoreVersion(store, date, versionId) {
    const plan = ensurePlan(store.plans?.[date]);
    const v = (plan.versions || []).find((x) => x.versionId === versionId);
    if (!v) return store;
    const nextPlan = {
        ...plan,
        byDaypart: JSON.parse(JSON.stringify(v.byDaypart || {})),
        activeVersionId: v.versionId,
    };
    return savePricing({ ...store, plans: { ...store.plans, [date]: nextPlan } });
}

// Rename a saved version.
export function renameVersion(store, date, versionId, name) {
    const plan = ensurePlan(store.plans?.[date]);
    const versions = (plan.versions || []).map((v) =>
        v.versionId === versionId ? { ...v, name: String(name || '').trim() } : v);
    return savePricing({ ...store, plans: { ...store.plans, [date]: { ...plan, versions } } });
}

// Apply (copy) the current date's whole plan onto a set of OTHER dates.
export function applyPlanToDates(store, fromDate, toDates) {
    const src = store.plans?.[fromDate];
    if (!src) return store;
    const nextPlans = { ...store.plans };
    for (const d of toDates || []) {
        if (d === fromDate) continue;
        const existing = ensurePlan(nextPlans[d]);
        nextPlans[d] = {
            ...existing,
            byDaypart: JSON.parse(JSON.stringify(src.byDaypart || {})),
        };
    }
    return savePricing({ ...store, plans: nextPlans });
}
