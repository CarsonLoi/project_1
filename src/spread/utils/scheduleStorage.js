// Schedule store — persistence layer
// ===================================
//
// Wraps localStorage with a single typed surface so the rest of the
// dashboard never touches the storage API directly. When a backend is
// ready, swap the load/save bodies for fetch() calls; everything else
// stays the same.
//
// Storage key: 'spread.schedule.v1' — bumps with SCHEDULE_STORE_VERSION
// on schema changes; older payloads are discarded with a console warn.

import { SCHEDULE_STORE_VERSION } from './spreadDataModel';
import { DEFAULT_SHIFTS } from '../constants/defaultShifts';

const KEY = `spread.schedule.v${SCHEDULE_STORE_VERSION}`;

// Empty store — what we hand back when localStorage is empty / corrupt.
function emptyStore() {
    return {
        meta:      { version: SCHEDULE_STORE_VERSION, updatedAt: new Date().toISOString() },
        shifts:    DEFAULT_SHIFTS.map((s) => ({ ...s })),
        schedules: {},
    };
}

export function loadStore() {
    try {
        const raw = window.localStorage.getItem(KEY);
        if (!raw) return emptyStore();
        const parsed = JSON.parse(raw);
        if (!parsed || parsed.meta?.version !== SCHEDULE_STORE_VERSION) {
            // eslint-disable-next-line no-console
            console.warn('[Spread] schedule store version mismatch — starting fresh');
            return emptyStore();
        }
        // Defensive — guarantee the shape even if some fields were
        // hand-edited via DevTools.
        return {
            meta:      parsed.meta,
            shifts:    Array.isArray(parsed.shifts)    ? parsed.shifts    : emptyStore().shifts,
            schedules: parsed.schedules && typeof parsed.schedules === 'object'
                ? parsed.schedules
                : {},
        };
    } catch (e) {
        // eslint-disable-next-line no-console
        console.warn('[Spread] could not parse schedule store:', e?.message);
        return emptyStore();
    }
}

export function saveStore(store) {
    const next = {
        ...store,
        meta: { ...store.meta, version: SCHEDULE_STORE_VERSION, updatedAt: new Date().toISOString() },
    };
    try {
        window.localStorage.setItem(KEY, JSON.stringify(next));
    } catch (e) {
        // eslint-disable-next-line no-console
        console.warn('[Spread] could not persist schedule store:', e?.message);
    }
    return next;
}

// ---- Focused mutators — all return a NEW store (immutable update) ----

export function upsertShift(store, shift) {
    const exists = store.shifts.some((s) => s.id === shift.id);
    const shifts = exists
        ? store.shifts.map((s) => (s.id === shift.id ? shift : s))
        : [...store.shifts, shift];
    return saveStore({ ...store, shifts });
}

export function removeShift(store, shiftId) {
    return saveStore({ ...store, shifts: store.shifts.filter((s) => s.id !== shiftId) });
}

export function setScheduleDocument(store, targetDate, doc) {
    return saveStore({
        ...store,
        schedules: { ...store.schedules, [targetDate]: doc },
    });
}

export function removeScheduleDate(store, targetDate) {
    const next = { ...store.schedules };
    delete next[targetDate];
    return saveStore({ ...store, schedules: next });
}

// ---- Export / Import — consolidated JSON file persistence ----------
//
// The localStorage blob is browser-bound. These helpers let the user
// pull the WHOLE store (shifts + every date's versions + frozen config
// snapshots) into a single .json file they can back up, move between
// machines, or commit, then load it back later.

// Pretty-printed JSON for the entire store, stamped with an export time.
export function serializeStore(store) {
    const payload = {
        ...store,
        meta: {
            ...(store.meta || {}),
            version: SCHEDULE_STORE_VERSION,
            exportedAt: new Date().toISOString(),
        },
    };
    return JSON.stringify(payload, null, 2);
}

// Trigger a browser download of the store as a .json file. Returns the
// filename used (or null if the environment has no DOM).
export function downloadStore(store, filename) {
    if (typeof document === 'undefined') return null;
    const name =
        filename || `spread-schedule-${new Date().toISOString().slice(0, 10)}.json`;
    try {
        const blob = new Blob([serializeStore(store)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = name;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        return name;
    } catch (e) {
        // eslint-disable-next-line no-console
        console.warn('[Spread] export failed:', e?.message);
        return null;
    }
}

// Validate + normalize an imported payload (string or object) into a
// well-formed store. Returns { ok, store } or { ok:false, error }.
// Accepts files exported by serializeStore as well as a raw localStorage
// dump (both share the { meta, shifts, schedules } shape).
export function normalizeImportedStore(raw) {
    let parsed;
    try {
        parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    } catch (e) {
        return { ok: false, error: 'File is not valid JSON.' };
    }
    if (!parsed || typeof parsed !== 'object') {
        return { ok: false, error: 'File does not contain a schedule store.' };
    }
    if (!Array.isArray(parsed.shifts)) {
        return { ok: false, error: 'Missing "shifts" array.' };
    }
    if (!parsed.schedules || typeof parsed.schedules !== 'object') {
        return { ok: false, error: 'Missing "schedules" object.' };
    }
    return {
        ok: true,
        store: {
            meta: { version: SCHEDULE_STORE_VERSION, updatedAt: new Date().toISOString() },
            shifts: parsed.shifts,
            schedules: parsed.schedules,
        },
    };
}

// Convenience: count how much is in a store, for confirm dialogs.
export function storeStats(store) {
    const dates = Object.keys(store?.schedules || {});
    const versions = dates.reduce(
        (n, d) => n + (store.schedules[d]?.versions?.length || 0),
        0
    );
    return { dates: dates.length, versions, shifts: (store?.shifts || []).length };
}
