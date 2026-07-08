// Spread Dashboard — data model
// =============================
//
// One ScheduleDocument per (target date). Each document keeps a
// versioned history of edits so config changes between planning and
// review never overwrite an earlier version — every save creates a new
// version and the old ones stay browsable / restorable.
//
// Top-level shape (persisted by scheduleStorage.js):
//
//   ScheduleStore {
//     shifts:    ShiftTemplate[]             — global shift library
//     schedules: { [date]: ScheduleDocument }
//     meta: { version: 1, updatedAt: ISO }   — for schema migrations
//   }
//
// All IDs are short uuids (8 hex chars) — long enough for collision
// safety inside a single user's local storage, short enough to be
// readable in URLs and the version list.

// Single source of truth for the spread store's schema version. Bump
// on incompatible model changes; scheduleStorage.js reads this and
// migrates / discards older payloads accordingly.
export const SCHEDULE_STORE_VERSION = 1;

// Short-uuid helper. Crypto.randomUUID is widely available in modern
// browsers; the Math.random fallback exists for old test environments.
export function shortUuid() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
        return crypto.randomUUID().replace(/-/g, '').slice(0, 8);
    }
    return Math.floor(Math.random() * 0xffffffff).toString(16).padStart(8, '0');
}

// ---------------------------------------------------------------------
// Shift template
// ---------------------------------------------------------------------
//
// `endHour` is INCLUSIVE — a shift from 11 → 2 covers hours
// 11..23, 0, 1, 2 = 16 hours total. Matches the casino-floor convention
// the existing HourlyDemand panel already uses (and the user is used to).
//
// `startHour === endHour` means a 24-hour shift (e.g. 7 → 7 next day).
//
// `kind` is purely a label/sort hint — derive the actual hour count via
// shiftLengthHours() in shiftCoverage.js.

export function makeShiftTemplate({ id, name, startHour, endHour, color, kind, description }) {
    return {
        id: id || shortUuid(),
        name: name || 'New shift',
        startHour: clampHour(startHour),
        endHour: clampHour(endHour),
        color: color || '#7aa2f7',
        // 8h / 16h / 24h / 'custom' — informational tag only.
        kind: kind || 'custom',
        description: description || '',
    };
}

function clampHour(h) {
    const n = Number(h);
    if (!Number.isFinite(n)) return 0;
    return ((Math.round(n) % 24) + 24) % 24;
}

// ---------------------------------------------------------------------
// Table snapshot — what tables existed when a version was saved
// ---------------------------------------------------------------------
//
// Frozen with the version so we can detect when the live floor config
// drifts from the planning baseline (tables added, removed, or moved).
// `key` follows the same gametype+table convention the Performance
// Heatmap uses, so a number reused across gametypes never collides.

export function makeTableSnapshot(tables) {
    return {
        capturedAt: new Date().toISOString(),
        tables: (tables || []).map((t) => ({
            key:         t.key         ?? t.id ?? '',
            label:       t.label       ?? '',
            gametype:    t.gametype    ?? '',
            x:           Number(t.x)   || 0,
            y:           Number(t.y)   || 0,
            // Heading in degrees — REQUIRED to re-render the floor map
            // exactly as planned (drives symbolRotate). Without it a
            // restored snapshot would draw every table at 0°. Captured
            // here so a saved version is a complete, reproducible floor.
            rotation:    Number(t.rotation) || 0,
            pit:         String(t.pit ?? ''),
            area:        t.area        ?? '',
            sub_segment: t.sub_segment ?? '',
            tableMin:    Number(t.tableMin) || 0,
        })),
    };
}

// ---------------------------------------------------------------------
// Schedule version — one immutable snapshot of assignments
// ---------------------------------------------------------------------
//
// `assignments` is a plain { tableKey: shiftId } map. Stored as an
// object (not Map) so JSON round-trips cleanly.
//
// `basedOnVersionId` tracks lineage: when the user clicks "Migrate to
// current config" on v1, the new v2 records v1 as its parent — useful
// for the diff view and the "restore" trail.

export function makeScheduleVersion({
    versionNumber,
    notes = '',
    basedOnVersionId = null,
    configSnapshotDate,
    tableSnapshot,
    assignments = {},
}) {
    return {
        versionId:          shortUuid(),
        // Allow 0 (the spread-database baseline = v0); only fall back to
        // 1 when the number is genuinely missing.
        versionNumber:      (versionNumber === undefined || versionNumber === null) ? 1 : versionNumber,
        createdAt:          new Date().toISOString(),
        basedOnVersionId,
        // The CONFIG-as-of date (typically "today" when the version was
        // saved). Distinct from the TARGET date the schedule applies to.
        // Example: on Jun 10 you plan Jul 1 → configSnapshotDate=Jun 10,
        // targetDate=Jul 1. Reviewing on Jun 20, the config has drifted
        // → save v2 with configSnapshotDate=Jun 20.
        configSnapshotDate: configSnapshotDate || new Date().toISOString().slice(0, 10),
        tableSnapshot:      tableSnapshot || makeTableSnapshot([]),
        assignments:        { ...assignments },
        notes,
    };
}

// ---------------------------------------------------------------------
// Schedule document — per target date
// ---------------------------------------------------------------------

export function makeScheduleDocument({ targetDate, initialVersion }) {
    const versions = initialVersion ? [initialVersion] : [];
    return {
        targetDate,
        // The version the dashboard considers "current" when this date
        // is opened. User can pin an older version as active via the
        // version history.
        activeVersionId: initialVersion ? initialVersion.versionId : null,
        versions,
    };
}

// Convenience: derive the next version number for a document.
export function nextVersionNumber(doc) {
    if (!doc || !doc.versions || doc.versions.length === 0) return 1;
    return Math.max(...doc.versions.map((v) => v.versionNumber || 0)) + 1;
}

// Find a version by id within a document. Returns null when not found.
export function findVersion(doc, versionId) {
    if (!doc || !versionId) return null;
    return doc.versions.find((v) => v.versionId === versionId) || null;
}

// Resolve the active version for a document — falls back to the most
// recent version when activeVersionId is stale / missing.
export function activeVersion(doc) {
    if (!doc || !doc.versions || doc.versions.length === 0) return null;
    return (
        findVersion(doc, doc.activeVersionId) ||
        doc.versions[doc.versions.length - 1]
    );
}
