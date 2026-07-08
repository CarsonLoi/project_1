// SpreadDashboard — Table Scheduling
// ===================================
//
// Page composition for the new shift-scheduling workflow. Glues
// together the floor map, shift palette, date scope, version history,
// coverage report, and config-drift banner.
//
// Layout (CSS grid, 3 columns):
//
//   ┌─────────────────────────────────────────────────────────────────┐
//   │  Toolbar: target date · dirty/saved · save / refresh            │
//   ├──────────────────────┬──────────────────────────────────────────┤
//   │                      │                                          │
//   │   Floor map          │   Right column                           │
//   │   (the heatmap)      │   ─ Shift palette                        │
//   │                      │   ─ Date scope (target + apply-to-many)  │
//   │                      │   ─ Version history                      │
//   │                      │   ─ Shift library (collapsible)          │
//   │                      │                                          │
//   ├──────────────────────┴──────────────────────────────────────────┤
//   │  Coverage report (24-hour bar chart + gap warnings)             │
//   ├─────────────────────────────────────────────────────────────────┤
//   │  Version diff (only when comparing two versions)                │
//   └─────────────────────────────────────────────────────────────────┘
//
// State boundaries:
//   • `store`            — the persisted root from scheduleStorage
//   • `targetDate`       — current editing date (string YYYY-MM-DD)
//   • `editingAssignments` — the in-progress map. Diverges from the
//                            active version's assignments while the
//                            user is editing; "Save as new version"
//                            commits it.
//   • `selectedKeys`     — multi-select set for the floor map
//   • `activeBrushShiftId` — armed shift for click-to-assign
//   • `comparingVersionId` — second version id when diff view is open

import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { Box, Stack, Typography, CircularProgress } from '@mui/material';
import SettingsIcon from '@mui/icons-material/Settings';
import CompareArrowsIcon from '@mui/icons-material/CompareArrows';
import HistoryIcon from '@mui/icons-material/History';
import GridViewIcon from '@mui/icons-material/GridView';
import CalendarMonthIcon from '@mui/icons-material/CalendarMonth';

import {
    loadStore, saveStore, setScheduleDocument,
    downloadStore, normalizeImportedStore, storeStats,
} from './utils/scheduleStorage';
import {
    makeScheduleDocument, makeScheduleVersion, makeShiftTemplate,
    nextVersionNumber, findVersion,
} from './utils/spreadDataModel';
import {
    liveFloorTables, liveFloorSnapshot, diffSnapshots, carryAssignmentsForward,
} from './utils/configSnapshot';
import { assignmentCountsByShift } from './utils/coverageAnalysis';
import { shiftCoversHour as shiftCoversHourLocal, shiftLengthHours } from './utils/shiftCoverage';
import { deriveSpreadAssignments, expandAssignmentsToSpreadRows } from './utils/deriveScheduledShifts';
import { fetchSpreadHours, SPREAD_LOAD_FROM } from './utils/spreadDataSource';
import { SHIFT_LENGTH_BANDS } from './constants/defaultShifts';
import { PLAN_FLOOR_ASPECT } from './constants/floorLayout';
import { SPREAD_FONTS } from './constants/fontSizes';

import FloorScheduleMap from './components/FloorScheduleMap';
import SelectionActionBar from './components/SelectionActionBar';
import ReferenceFloorMap from './components/ReferenceFloorMap';
import ReferenceDateDialog from './components/ReferenceDateDialog';
import HeaderControls from './components/HeaderControls';
import TimelineControl from './components/TimelineControl';
import SpreadComparePanel from './components/SpreadComparePanel';
import ShiftPalette     from './components/ShiftPalette';
import ShiftLibrary     from './components/ShiftLibrary';
import DateScopePanel   from './components/DateScopePanel';
import VersionDiff      from './components/VersionDiff';
import PlanCompareView  from './components/PlanCompareView';
import CoverageReport   from './components/CoverageReport';
import HistoryComparePanel from './components/HistoryComparePanel';
import ConfigDriftBanner from './components/ConfigDriftBanner';

// Today (HKT-naïve) — used as the default target date when no schedule
// exists yet. The trend dashboard's date picker already handles real
// gaming-date semantics; this is fine to keep simple here.
// LOCAL calendar date (YYYY-MM-DD). NOTE: must be local, not UTC — a UTC
// `toISOString().slice(0,10)` rolls to the wrong day in non-UTC zones (e.g.
// after 16:00 in GMT+8, or before 19:00 in GMT-5).
const todayIso = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// Synthetic id for the LIVE database baseline (v0). v0 is re-derived from
// the spread DB on every date change and is never persisted — only the
// user's adjusted versions (v1, v2, …) are saved (localStorage / JSON).
const V0_ID = '__v0_db__';

// "2026-06-18" → "Jun 18, 2026 (Thu)" for the floor info card.
const PRETTY_MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const PRETTY_DOW = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
function prettyLongDate(iso) {
    if (!iso || typeof iso !== 'string' || iso.length < 10) return iso || '—';
    const m = parseInt(iso.slice(5, 7), 10);
    const d = parseInt(iso.slice(8, 10), 10);
    const y = iso.slice(0, 4);
    if (!m || !d) return iso;
    // Parse as UTC midnight so the weekday never rolls with the local zone.
    const dow = PRETTY_DOW[new Date(iso.slice(0, 10) + 'T00:00:00Z').getUTCDay()];
    return `${PRETTY_MONTHS[m - 1]} ${d}, ${y}${dow ? ` (${dow})` : ''}`;
}

export default function SpreadDashboard() {
    const [store, setStore] = useState(loadStore);

    const [targetDate, setTargetDate] = useState(() => {
        const dates = Object.keys(loadStore().schedules || {});
        return dates.length > 0 ? dates.sort().slice(-1)[0] : todayIso();
    });

    // Spread database — INDEPENDENT of the Performance Heatmap's hourly
    // dataset. One row per (table × date × hour) with a binary `spread`
    // column (1 = scheduled open, 0 = closed), read via the dedicated
    // spread fetcher (its own endpoint + bundled fixture).
    //
    // PRELOAD: on dashboard access we pull every spread row from a
    // configurable start date (SPREAD_LOAD_FROM, default May) so the
    // historical baseline + the same-weekday-last-week fallback are
    // available client-side without a request per date. Nothing here
    // touches the performance data.
    const [spreadRows, setSpreadRows] = useState([]);
    // True while the initial preload is in flight — drives the on-map
    // "Loading schedule…" notice.
    const [spreadLoading, setSpreadLoading] = useState(false);
    useEffect(() => {
        let cancelled = false;
        setSpreadLoading(true);
        fetchSpreadHours({ from: SPREAD_LOAD_FROM })
            .then((rows) => { if (!cancelled) setSpreadRows(rows || []); })
            .catch(() => { if (!cancelled) setSpreadRows([]); })
            .finally(() => { if (!cancelled) setSpreadLoading(false); });
        return () => { cancelled = true; };
    }, []);

    // Live floor — the set of tables whose validity window contains the
    // TARGET date: config rows where startdate <= targetDate <= enddate
    // (plus active TG tables). NOT "today's" floor — it's whatever
    // config_cod.json currently says is on the floor for the target
    // date. Because the user keeps each table's start/end dates current,
    // editing config_cod.json (a table moves out → set its enddate; a
    // new table arrives → add a row with its startdate) instantly
    // changes which tables appear here on the next render, with no app
    // change. Re-computed whenever the target date changes.
    const liveTables = useMemo(() => liveFloorTables(targetDate), [targetDate]);

    // Saved-versions document for this date (v1, v2, …). v0 is NOT stored
    // here — it's the live DB baseline, derived below. Null for a date with
    // no saved adjustments yet.
    const doc = store.schedules[targetDate] || null;

    // The floor ALWAYS uses the most-updated config_cod.json, filtered to
    // the target date's validity window (startdate <= targetDate <=
    // enddate). config.json is the single source of truth for which
    // tables exist on a date — assignments are keyed by table id, so they
    // survive config edits (removed tables drop off, new tables come in
    // empty). The version's frozen tableSnapshot is still saved for audit
    // (see saveNewVersion) but is never an editing surface, so there's no
    // Live/Planned toggle to confuse the planning flow.
    const floorTables = liveTables;

    // ── Filter slicers ───────────────────────────────────────────────
    // Area (MS / PM), Sub-segment, Game. These are ANALYTICAL slicers only —
    // they filter the Coverage report + summary counts, but NEVER gate the
    // floor's interactivity (the whole floor stays editable). [] = no filter.
    const [areaFilter, setAreaFilter] = useState([]);
    const [subFilter, setSubFilter]   = useState([]);
    const [gtFilter, setGtFilter]     = useState([]);
    const availableSubs = useMemo(
        () => [...new Set((floorTables || []).map((t) => t.sub_segment).filter(Boolean))].sort(),
        [floorTables]
    );
    const availableGames = useMemo(
        () => [...new Set((floorTables || []).map((t) => t.gametype).filter(Boolean))].sort(),
        [floorTables]
    );
    const filteredTables = useMemo(() => (
        (floorTables || []).filter((t) => (
            (areaFilter.length === 0 || areaFilter.includes(t.segment)) &&
            (subFilter.length === 0 || subFilter.includes(t.sub_segment)) &&
            (gtFilter.length === 0 || gtFilter.includes(t.gametype))
        ))
    ), [floorTables, areaFilter, subFilter, gtFilter]);
    const filterActive = areaFilter.length + subFilter.length + gtFilter.length > 0;

    // Per-date summary from the already-loaded spreadRows — one pass, then
    // used by the DateScopePanel calendar to show hour + table counts on
    // each day cell. No extra fetch: this is derived from the same
    // spreadRows the derivation and comparison already consume.
    //   openHours  = number of (row.spread === 1) rows for that date
    //   openTables = number of distinct tables open at least ONCE that day
    const dateSummary = useMemo(() => {
        const map = new Map(); // iso → { openHours, tables:Set }
        for (const r of spreadRows || []) {
            if (Number(r.spread) !== 1) continue;
            const d = String(r.date).slice(0, 10);
            if (!d) continue;
            let e = map.get(d);
            if (!e) { e = { openHours: 0, tables: new Set() }; map.set(d, e); }
            e.openHours += 1;
            e.tables.add(String(r.gametype ?? '') + '|' + String(r.table ?? ''));
        }
        const out = new Map();
        for (const [d, e] of map) out.set(d, { openHours: e.openHours, openTables: e.tables.size });
        return out;
    }, [spreadRows]);

    // ── Version model ────────────────────────────────────────────────
    // v0  = the LIVE spread-DATABASE baseline for THIS date — derived from
    //       the DB's own rows for the date (no same-weekday fallback),
    //       re-extracted on every date change, never persisted.
    // v1+ = user-adjusted versions, saved to localStorage and round-tripped
    //       as JSON via Export / Import.
    const dbDerived = useMemo(() => {
        // THIS date's own DB rows only — no same-weekday fallback.
        const rows = spreadRows.filter((r) => r.date === targetDate);
        if (rows.length === 0) return { assignments: {}, unmatched: [] };
        return deriveSpreadAssignments(rows, store.shifts);
    }, [spreadRows, targetDate, store.shifts]);
    const dbV0Assignments = useMemo(() => {
        const keySet = new Set((floorTables || []).map((t) => t.key));
        const out = {};
        for (const [k, sid] of Object.entries(dbDerived.assignments)) if (keySet.has(k)) out[k] = sid;
        return out;
    }, [dbDerived, floorTables]);
    // DB rows that had scheduled hours but no clean shift match (flagged).
    const derivedUnmatched = dbDerived.unmatched;
    const dbV0Key = useMemo(
        () => Object.entries(dbV0Assignments).map(([k, v]) => `${k}:${v}`).sort().join(','),
        [dbV0Assignments]
    );
    const liveV0 = useMemo(() => ({
        versionId: V0_ID, versionNumber: 0, assignments: dbV0Assignments,
        tableSnapshot: null, notes: 'Database (live)', live: true,
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }), [dbV0Key]);
    // Saved versions (v1+). Any legacy persisted v0 is ignored.
    const savedVersions = useMemo(
        () => (doc?.versions || []).filter((v) => (v.versionNumber || 0) > 0),
        [doc]
    );
    // Active version = a pinned saved version, else the live DB v0.
    const active = useMemo(() => {
        const pinned = doc?.activeVersionId
            ? savedVersions.find((v) => v.versionId === doc.activeVersionId)
            : null;
        return pinned || liveV0;
    }, [doc, savedVersions, liveV0]);
    const activeIsV0 = active.versionId === V0_ID;

    // In-progress edits — seeded from the active version; reset on date or
    // version switch.
    const [editingAssignments, setEditingAssignments] = useState({});
    useEffect(() => {
        setEditingAssignments({ ...active.assignments });
        setSelectedKeys(new Set());
        setComparingVersionId(null);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [targetDate, active.versionId]);
    // Refresh edits as the live DB v0 arrives / changes — only while v0 is
    // the active version, so it never clobbers a pinned saved version.
    useEffect(() => {
        if (!activeIsV0) return;
        setEditingAssignments({ ...dbV0Assignments });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [dbV0Key]);

    // Multi-select state for the floor map.
    const [selectedKeys, setSelectedKeys] = useState(new Set());
    // Armed shift (click-to-assign mode). Null = selection mode.
    const [activeBrushShiftId, setActiveBrushShiftId] = useState(null);

    // Esc — universal escape route: clears the table selection (which
    // also dismisses the floating action bar and wipes the lasso trace
    // on the map) and disarms any armed shift. Listener attached once;
    // setState with the same empty Set is a cheap no-op re-render.
    useEffect(() => {
        const onKey = (e) => {
            if (e.key !== 'Escape') return;
            setSelectedKeys((prev) => (prev.size === 0 ? prev : new Set()));
            setActiveBrushShiftId(null);
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, []);
    // Diff view second version. Null = closed.
    const [comparingVersionId, setComparingVersionId] = useState(null);
    // Right-column toggle: scheduling panels vs the shift library
    // vs the new "compare" view (target vs reference plan).
    const [rightView, setRightView] = useState('palette'); // 'palette' (Shifts) | 'compare' (Summary) | 'apply' (Calendar) | 'library' (Settings)
    // Bottom-row toggle: the Coverage bar chart vs the reference floor
    // heatmap (only meaningful when a reference is selected). Defaults
    // to the reference heatmap when a reference is picked (see effect).
    const [bottomView, setBottomView] = useState('coverage'); // 'coverage' | 'reference'

    // Top-level mode: 'plan' = the normal target-date editor; 'compare' =
    // a read-only variance view between two saved plans (Plan A = base,
    // Plan B = compared). Selections persist while the dashboard is open.
    const [appMode, setAppMode] = useState('plan'); // 'plan' | 'compare'
    const [planA, setPlanA] = useState(null); // { date, versionId }
    const [planB, setPlanB] = useState(null); // { date, versionId }
    // Seed sensible Plan A / Plan B defaults the first time the user
    // enters Compare mode: A = the current target date's newest version,
    // B = the most recent OTHER dated plan (falls back to the same date).
    useEffect(() => {
        if (appMode !== 'compare') return;
        const sched = loadStore().schedules || {};
        const dates = Object.keys(sched).sort();
        const newestVid = (d) => {
            const vs = (sched[d]?.versions || []).slice()
                .sort((a, b) => (b.versionNumber || 0) - (a.versionNumber || 0));
            return vs[0]?.versionId || null;
        };
        setPlanA((p) => p || (sched[targetDate]
            ? { date: targetDate, versionId: newestVid(targetDate) }
            : (dates[0] ? { date: dates[0], versionId: newestVid(dates[0]) } : null)));
        setPlanB((p) => p || (() => {
            const other = dates.filter((d) => d !== targetDate);
            const pick = (other[other.length - 1] || dates[dates.length - 1]);
            return pick ? { date: pick, versionId: newestVid(pick) } : null;
        })());
    }, [appMode, targetDate]);

    // ---- View mode + hourly playback --------------------------------
    //
    // 'overall' (default) — shift color per table; 'hourly' — 2-color
    // (open/closed) at the current hour, with the timeline controlling
    // `hourCursor`. The cursor is gaming-day-ordered; the timeline
    // component starts at 06 and wraps to 05 just like the Performance
    // Heatmap hourly play.
    const [viewMode, setViewMode]       = useState('overall');
    const [hourCursor, setHourCursor]   = useState(7); // scheduling day starts 07:00
    // Native visualMap `selected` state for the shift legend (opaque ECharts
    // map). Reset when the target date changes. Persists across other
    // filter/mode changes.
    const [vmShiftSel, setVmShiftSel] = useState(null);
    useEffect(() => { setVmShiftSel(null); }, [targetDate]);
    const [playing, setPlaying]         = useState(false);
    // Overview coloring — 'shift' (each table = its shift's own color) or
    // 'length' (each table = its shift-LENGTH band: 24h / 16h / 8h / 0h).
    const [overallColorMode, setOverallColorMode] = useState('shift');

    // ---- Reference spread -------------------------------------------
    //
    // referenceMode:
    //   'none'  — no reference; bottom row shows Coverage as before
    //   'all'   — cycle through every version saved for the target date
    //             (header dropdown wired to this)
    //   'other' — referenceContext points at an arbitrary (date, version)
    const [referenceMode, setReferenceMode] = useState('none');
    const [referenceContext, setReferenceContext] = useState(null); // { date, versionId }
    const [refDialogOpen, setRefDialogOpen] = useState(false);
    // When referenceMode === 'all', this is the version id the user
    // has cycled to via ReferenceFloorMap's pill row.
    const [allModeVersionId, setAllModeVersionId] = useState(null);
    // Banner dismissal — stored in component state (per session). A
    // hard refresh re-evaluates drift and re-shows.
    const [bannerDismissed, setBannerDismissed] = useState(false);

    // Drift between the active version's frozen tableSnapshot and the
    // current live floor. Re-computed when either changes. Cheap —
    // both sides are < 200 tables typically.
    const drift = useMemo(() => {
        // The live DB v0 has no frozen tableSnapshot → no drift to show.
        if (!active || activeIsV0 || !active.tableSnapshot) return null;
        return diffSnapshots(active.tableSnapshot, liveFloorSnapshot(targetDate));
    }, [active, activeIsV0, targetDate]);

    // Dirty flag — true when the in-progress edits differ from the
    // active version's assignments. Drives the "Save as new version"
    // button's enabled state.
    const dirty = useMemo(
        () => !sameAssignments(editingAssignments, active.assignments),
        [active, editingAssignments]
    );

    // ---- Assignment commands ----------------------------------------

    const assignOne = useCallback((tableKey, shiftId) => {
        setEditingAssignments((prev) => {
            const next = { ...prev };
            // shiftId === null OR '__none' both mean "unassign". We also
            // strip stale keys not in the current floor — keeps the
            // editing map clean across config drift.
            if (!shiftId || shiftId === '__none') delete next[tableKey];
            else next[tableKey] = shiftId;
            return next;
        });
    }, []);

    const assignToSelection = useCallback((shiftId) => {
        if (selectedKeys.size === 0) return;
        setEditingAssignments((prev) => {
            const next = { ...prev };
            for (const k of selectedKeys) {
                if (!shiftId || shiftId === '__none') delete next[k];
                else next[k] = shiftId;
            }
            return next;
        });
        // Keep the selection so users can rapidly re-assign the same
        // group (e.g. picked the wrong shift, click another).
    }, [selectedKeys]);

    const onSelectionChange = useCallback((nextSet, info = {}) => {
        // The floor map's click handler emits {clicked: tableKey} when
        // the user single-clicks a table. We translate that into a
        // toggle on the current selection set instead of replacing it,
        // which lets users build up the multi-select with a series of
        // clicks (no modifier key required — easier on touch screens).
        if (info.clicked && !info.brushed && !info.cleared) {
            setSelectedKeys((prev) => {
                const ns = new Set(prev);
                if (ns.has(info.clicked)) ns.delete(info.clicked);
                else                       ns.add(info.clicked);
                return ns;
            });
            return;
        }
        setSelectedKeys(nextSet);
    }, []);

    // ---- Version commands -------------------------------------------

    const saveNewVersion = useCallback(() => {
        // Freeze the live floor (most-updated config for this date) into
        // the version for audit — "this plan was drawn against these
        // tables." Editing always uses live config, so this is just a
        // historical record, never an editing surface.
        const snap = liveFloorSnapshot(targetDate);
        const baseDoc = doc || makeScheduleDocument({ targetDate });
        // Persisted versions are v1+ only — v0 is never stored.
        const savedOnly = (baseDoc.versions || []).filter((v) => (v.versionNumber || 0) > 0);
        const nextNum = savedOnly.length ? Math.max(...savedOnly.map((v) => v.versionNumber || 0)) + 1 : 1;
        const newVersion = makeScheduleVersion({
            versionNumber: nextNum,
            basedOnVersionId: activeIsV0 ? null : active.versionId,
            configSnapshotDate: todayIso(),
            tableSnapshot: snap,
            assignments: editingAssignments,
        });
        const nextDoc = {
            ...baseDoc,
            activeVersionId: newVersion.versionId,
            versions: [...savedOnly, newVersion],
        };
        setStore(setScheduleDocument(store, targetDate, nextDoc));
        setBannerDismissed(false); // new version → re-evaluate drift on next render
    }, [doc, active, activeIsV0, editingAssignments, targetDate, store]);

    const activateVersion = useCallback((versionId) => {
        // v0 / null → unpin → fall back to the LIVE database baseline.
        // Any other id pins that saved version (v1, v2, …).
        const pinId = (!versionId || versionId === V0_ID) ? null : versionId;
        if (!doc) return; // no saved versions to pin; already on live v0
        const nextDoc = { ...doc, activeVersionId: pinId };
        setStore(setScheduleDocument(store, targetDate, nextDoc));
    }, [doc, targetDate, store]);

    const renameVersion = useCallback((versionId, notes) => {
        if (!doc) return;
        const nextDoc = {
            ...doc,
            versions: doc.versions.map((v) =>
                v.versionId === versionId ? { ...v, notes } : v
            ),
        };
        setStore(setScheduleDocument(store, targetDate, nextDoc));
    }, [doc, targetDate, store]);

    const compareVersion = useCallback((idA, idB) => {
        // Open the diff with `idB` (the user-clicked one) against
        // `idA` (currently active). The diff component reads from
        // `comparingVersionId` for B and falls back to active for A.
        setComparingVersionId(idB);
    }, []);

    const migrateToCurrentConfig = useCallback(() => {
        if (!active) return;
        const snap = liveFloorSnapshot(targetDate);
        const carried = carryAssignmentsForward(active.assignments, snap.tables);
        const newVersion = makeScheduleVersion({
            versionNumber: nextVersionNumber(doc),
            basedOnVersionId: active.versionId,
            configSnapshotDate: todayIso(),
            tableSnapshot: snap,
            assignments: carried,
            notes: `Migrated from v${active.versionNumber} — floor config updated`,
        });
        const nextDoc = {
            ...doc,
            activeVersionId: newVersion.versionId,
            versions: [...doc.versions, newVersion],
        };
        setStore(setScheduleDocument(store, targetDate, nextDoc));
    }, [active, doc, targetDate, store]);

    const applyToDates = useCallback((dates) => {
        // Copy the CURRENT editing assignments (not the saved version)
        // so users can do "edit + apply" in one motion without an
        // extra save click. Each destination gets a fresh document
        // with a v1 that references this date's active version (when
        // there is one) as the lineage source.
        let next = store;
        for (const d of dates) {
            const snap = liveFloorSnapshot(d);
            const existing = next.schedules[d] || makeScheduleDocument({ targetDate: d });
            const newVersion = makeScheduleVersion({
                versionNumber: nextVersionNumber(existing),
                basedOnVersionId: active ? active.versionId : null,
                configSnapshotDate: todayIso(),
                tableSnapshot: snap,
                assignments: { ...editingAssignments },
                notes: `Applied from ${targetDate}`,
            });
            const nextDoc = {
                ...existing,
                activeVersionId: newVersion.versionId,
                versions: [...(existing.versions || []), newVersion],
            };
            next = setScheduleDocument(next, d, nextDoc);
        }
        setStore(next);
    }, [store, editingAssignments, active, targetDate]);

    const revertEdits = useCallback(() => {
        setEditingAssignments(active ? { ...active.assignments } : {});
        setSelectedKeys(new Set());
    }, [active]);

    // ---- Shift library mutations ------------------------------------

    const setShifts = useCallback((nextShifts) => {
        // Replaces the whole shifts array — used by ShiftLibrary's
        // add/edit/remove/REORDER. We assign the array wholesale (not a
        // per-id upsert loop) so the caller's ORDER is preserved — the
        // old loop merged by id and silently kept the original order,
        // which made the reorder arrows appear to do nothing. saveStore
        // persists it in the same atomic unit as the schedule documents.
        setStore(saveStore({ ...store, shifts: nextShifts }));
    }, [store]);

    // ---- Export / Import — consolidated JSON file -------------------
    //
    // Export pulls the ENTIRE store (shifts + every date's versions +
    // frozen config snapshots) into one downloadable .json file so the
    // plans aren't trapped in this browser's localStorage. Import loads
    // such a file back, replacing the current store (after confirm).

    const exportStore = useCallback(() => {
        downloadStore(store);
    }, [store]);

    const importStoreFile = useCallback((file) => {
        if (!file) return;
        // file.text() is supported in all modern browsers.
        file.text()
            .then((text) => {
                const res = normalizeImportedStore(text);
                if (!res.ok) {
                    window.alert(`Import failed: ${res.error}`);
                    return;
                }
                const incoming = storeStats(res.store);
                const current = storeStats(store);
                const ok = window.confirm(
                    `Import this schedule file?\n\n` +
                    `Incoming: ${incoming.dates} dates · ${incoming.versions} versions · ${incoming.shifts} shifts\n` +
                    `This REPLACES your current store ` +
                    `(${current.dates} dates · ${current.versions} versions).\n\n` +
                    `Tip: export your current store first if you want a backup.`
                );
                if (!ok) return;
                const saved = saveStore(res.store);
                setStore(saved);
            })
            .catch((e) => window.alert(`Import failed: ${e?.message || 'could not read file'}`));
    }, [store]);

    // Export a TEMP SPREAD FILE for the target date — the per-(table,hour)
    // binary rows the spread DB ingests. Expands each table's edited SHIFT
    // back into 24 hourly `spread` flags (1 = covered, 0 = not). This is
    // the file the user uploads to push the plan back to the database.
    const exportTempSpreadFile = useCallback(() => {
        if (typeof document === 'undefined') return;
        if (Object.keys(editingAssignments).length === 0) {
            window.alert('Nothing to export — assign at least one table first.');
            return;
        }
        // revised_date = the day this plan was revised/exported. Every floor
        // table × 24 hours is emitted (open=1 / closed=0) for a clean DB load.
        const rows = expandAssignmentsToSpreadRows(
            targetDate, editingAssignments, store.shifts, floorTables, todayIso()
        );
        const name = `spread-upload-${targetDate}.json`;
        try {
            const blob = new Blob([JSON.stringify(rows, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = name;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        } catch (e) {
            window.alert(`Export failed: ${e?.message || 'unknown error'}`);
        }
    }, [targetDate, editingAssignments, store.shifts, floorTables]);

    // ---- Derived data for child components --------------------------

    const counts = useMemo(
        () => assignmentCountsByShift(editingAssignments),
        [editingAssignments]
    );
    // Headline metrics for the on-map plan card.
    //   • total open tables = # tables with a shift assigned
    //   • total hours = Σ over assignments of the shift's length (h)
    const totalOpenTables = Object.keys(editingAssignments).length;
    const totalScheduledHours = useMemo(() => {
        const shiftMap = new Map(store.shifts.map((s) => [s.id, s]));
        let sum = 0;
        for (const sid of Object.values(editingAssignments)) {
            const s = shiftMap.get(sid);
            if (s) sum += shiftLengthHours(s);
        }
        return sum;
    }, [editingAssignments, store.shifts]);
    const availableDates = useMemo(
        () => Object.keys(store.schedules || {}).sort(),
        [store.schedules]
    );
    const compareWithVersion = comparingVersionId
        ? findVersion(doc, comparingVersionId)
        : null;

    // Versions for the active target date — used by the header's "Active
    // version" dropdown: the live DB v0 first, then saved v1+.
    const targetVersions = useMemo(
        () => [liveV0, ...savedVersions.slice().sort((a, b) => (a.versionNumber || 0) - (b.versionNumber || 0))],
        [liveV0, savedVersions]
    );

    // Resolve the reference version + the floor tables for ITS date.
    // 'all' mode picks the user-cycled allModeVersionId (defaults to
    // the newest version of the target date); 'other' mode reads from
    // referenceContext; 'none' returns null.
    const { referenceVersion, referenceDate, allModeVersions } = useMemo(() => {
        if (referenceMode === 'none') {
            return { referenceVersion: null, referenceDate: null, allModeVersions: null };
        }
        if (referenceMode === 'all') {
            const allVs = (doc?.versions || []).slice().sort(
                (a, b) => (b.versionNumber || 0) - (a.versionNumber || 0)
            );
            if (allVs.length === 0) {
                return { referenceVersion: null, referenceDate: targetDate, allModeVersions: [] };
            }
            const pickId = allModeVersionId || allVs[0].versionId;
            const pick = allVs.find((v) => v.versionId === pickId) || allVs[0];
            return { referenceVersion: pick, referenceDate: targetDate, allModeVersions: allVs };
        }
        if (referenceMode === 'other' && referenceContext) {
            const refDoc = store.schedules[referenceContext.date];
            const refV = refDoc?.versions?.find((v) => v.versionId === referenceContext.versionId) || null;
            return { referenceVersion: refV, referenceDate: referenceContext.date, allModeVersions: null };
        }
        return { referenceVersion: null, referenceDate: null, allModeVersions: null };
    }, [referenceMode, referenceContext, allModeVersionId, doc, store, targetDate]);

    // Floor tables for the reference date (different from target tables
    // because the floor config may have drifted). Falls back to
    // liveTables when the reference is on the same date.
    const referenceTables = useMemo(() => {
        if (!referenceVersion || !referenceDate) return [];
        if (referenceDate === targetDate) return liveTables;
        return liveFloorTables(referenceDate);
    }, [referenceVersion, referenceDate, targetDate, liveTables]);

    // Adopt the currently-selected reference plan as the EDITABLE base
    // for the target date. Unlike the non-destructive "fill" (which only
    // fills empty tables), this REPLACES the working map with the
    // reference's assignments for every matching floor table — the
    // direct "use another date's spread as a base to edit" action.
    // Defined here (after referenceVersion/referenceDate) so its deps
    // are initialised. Confirms first when edits exist; result is unsaved.
    const useReferenceAsBase = useCallback(() => {
        if (!referenceVersion) return;
        const refAssign = referenceVersion.assignments || {};
        const keySet = new Set((floorTables || []).map((t) => t.key));
        const next = {};
        for (const [tableKey, shiftId] of Object.entries(refAssign)) {
            if (keySet.has(tableKey)) next[tableKey] = shiftId;
        }
        if (Object.keys(editingAssignments).length > 0) {
            const ok = window.confirm(
                `Replace the current ${targetDate} floor with this reference plan ` +
                `(${referenceDate})?\n\n${Object.keys(next).length} tables will be set; ` +
                `your unsaved edits will be overwritten. Save as a new version afterwards to keep it.`
            );
            if (!ok) return;
        }
        setEditingAssignments(next);
        setSelectedKeys(new Set());
    }, [referenceVersion, referenceDate, floorTables, editingAssignments, targetDate]);

    // When a reference plan becomes selected, jump the bottom row to the
    // reference heatmap (the user just expressed interest in it); when
    // it's cleared, fall back to the Coverage chart. The toggle lets the
    // user override either way.
    const referenceVersionId = referenceVersion?.versionId || null;
    useEffect(() => {
        setBottomView(referenceVersionId ? 'reference' : 'coverage');
    }, [referenceVersionId]);

    // Point 2 — "fill from reference". When a reference is selected, seed
    // the live floor's UNASSIGNED tables with the reference plan's shift
    // for the matching table (matched by table key). Existing assignments
    // are preserved (non-destructive "try to fill"); tables new vs the
    // reference stay unassigned.
    const floorTableKeys = useMemo(
        () => (floorTables || []).map((t) => t.key),
        [floorTables]
    );
    useEffect(() => {
        if (!referenceVersion) return;
        const refAssign = referenceVersion.assignments || {};
        const keySet = new Set(floorTableKeys);
        setEditingAssignments((prev) => {
            let changed = false;
            const next = { ...prev };
            for (const [tableKey, shiftId] of Object.entries(refAssign)) {
                if (!keySet.has(tableKey)) continue;
                if (next[tableKey]) continue;
                next[tableKey] = shiftId;
                changed = true;
            }
            return changed ? next : prev;
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [referenceVersionId]);

    // (v0 is derived live from the DB above — no same-weekday fallback and
    // no materialization into localStorage. Saved versions are v1+ only.)

    // Reference dropdown change handler. The dropdown emits one of:
    //   'none'              → clear reference
    //   'other'             → open the date-picker dialog
    //   'tv:<versionId>'    → use that specific target-date version
    //                         (no separate "all" cycler step — each
    //                          version is its own menu entry now)
    const handleReferenceModeChange = useCallback((mode) => {
        if (mode === 'other') {
            setRefDialogOpen(true);
            return;
        }
        if (typeof mode === 'string' && mode.startsWith('tv:')) {
            setReferenceMode('all');
            setAllModeVersionId(mode.slice(3) || null);
            return;
        }
        setReferenceMode(mode);
    }, []);

    const handleReferenceConfirm = useCallback(({ date, versionId }) => {
        setReferenceMode('other');
        setReferenceContext({ date, versionId });
        setRefDialogOpen(false);
    }, []);

    // Hourly view + playing don't make sense together with edits in
    // flight — when the user starts playing we disarm the brush.
    useEffect(() => {
        if (playing) setActiveBrushShiftId(null);
    }, [playing]);

    // Compose a label for the header's "Reference" dropdown trailing
    // text — just enough context to identify the picked plan.
    const referenceLabel = referenceVersion
        ? `${referenceDate} v${referenceVersion.versionNumber}`
        : null;

    return (
        <Box sx={{
            height: '100%',
            overflow: 'auto',
            bgcolor: 'rgba(30,32,48,1)',
            p: 1.5,
            boxSizing: 'border-box',
        }}>
            {/* Top toolbar — extracted to HeaderControls so the
                page-level component doesn't drown in markup. Owns the
                target-date picker, version dropdown, view toggle, and
                reference dropdown in addition to the original
                dirty/save/refresh actions. */}
            <HeaderControls
                targetDate={targetDate}
                setTargetDate={setTargetDate}
                targetVersions={targetVersions}
                activeVersionId={active.versionId}
                onActivateVersion={activateVersion}
                viewMode={viewMode}
                onViewMode={setViewMode}
                appMode={appMode}
                onAppMode={setAppMode}
                referenceMode={referenceMode}
                referenceVersionId={allModeVersionId}
                onReferenceModeChange={handleReferenceModeChange}
                referenceLabel={referenceLabel}
                dirty={dirty}
                onRevert={revertEdits}
                onSaveNew={saveNewVersion}
                onReload={() => setStore(loadStore())}
                onExport={exportStore}
                onImportFile={importStoreFile}
                onExportSpread={exportTempSpreadFile}
                areaFilter={areaFilter} setAreaFilter={setAreaFilter}
                subFilter={subFilter}   setSubFilter={setSubFilter}
                gtFilter={gtFilter}     setGtFilter={setGtFilter}
                availableSubs={availableSubs}
                availableGames={availableGames}
            />

            {appMode === 'compare' && (
                <PlanCompareView
                    store={store}
                    shifts={store.shifts}
                    planA={planA}
                    planB={planB}
                    setPlanA={setPlanA}
                    setPlanB={setPlanB}
                />
            )}

            {/* "Other…" reference picker — popover with date + version. */}
            <ReferenceDateDialog
                open={refDialogOpen}
                onClose={() => setRefDialogOpen(false)}
                onConfirm={handleReferenceConfirm}
                store={store}
                initialDate={referenceContext?.date || targetDate}
                initialVersionId={referenceContext?.versionId || null}
            />

            {appMode === 'plan' && (<>
            {/* Config-drift banner sits ABOVE the editor so the user
                always sees the warning before making more edits. */}
            {drift && !bannerDismissed && (
                <Box sx={{ mb: 1.2 }}>
                    <ConfigDriftBanner
                        drift={drift}
                        onMigrate={migrateToCurrentConfig}
                        onDismiss={() => setBannerDismissed(true)}
                    />
                </Box>
            )}

            {/* Main grid — map on the left, scheduling panels on the
                right. Locked 7/3 ratio so the map gets the lion's
                share of horizontal space (it's the primary canvas). */}
            <Box sx={{
                display: 'grid',
                gridTemplateColumns: { xs: '1fr', lg: '7.6fr 2.4fr' },
                gap: 1.5,
                mb: 1.5,
            }}>
                <Box sx={{
                    bgcolor: 'rgba(22, 24, 38, 0.9)',
                    borderRadius: 2,
                    border: '1px solid rgba(255,255,255,0.06)',
                    boxShadow: '0 4px 24px rgba(0,0,0,0.3)',
                    overflow: 'hidden',
                    // Lock to the SAME aspect ratio as the Performance
                    // Heatmap scatter card (1500 × 723). Both views use
                    // identical SCATTER_X/Y bounds + SCATTER_GRID, so
                    // matching the container ratio makes the floor map
                    // render at the same proportions as the heatmap
                    // instead of stretching to a fixed 600px height.
                    width: '100%',
                    aspectRatio: PLAN_FLOOR_ASPECT,
                    // Anchor for the floating SelectionActionBar — it
                    // positions absolute against this card so the bulk
                    // actions hover over the floor, near the selection.
                    position: 'relative',
                }}>
                    {/* Timeline strip — only renders in hourly view.
                        Sits at the top of the map card so it doesn't
                        compete with the bottom SelectionActionBar.
                        `colorAtHour` previews per-tick aggregate state
                        so the timeline doubles as a coverage glance. */}
                    {viewMode === 'hourly' && (
                        <Box sx={{ position: 'absolute', top: 12, left: 12, right: 12, zIndex: 6 }}>
                            <TimelineControl
                                currentHour={hourCursor}
                                onCurrentHour={setHourCursor}
                                playing={playing}
                                onPlaying={setPlaying}
                                colorAtHour={(h) => {
                                    // Cheap pre-compute: how many tables are
                                    // open at this hour under the current edit?
                                    // Used as the tick tint so the user sees a
                                    // coverage curve along the timeline.
                                    const shiftMap = new Map(store.shifts.map((s) => [s.id, s]));
                                    let openCount = 0;
                                    for (const sid of Object.values(editingAssignments || {})) {
                                        const s = shiftMap.get(sid);
                                        if (s && shiftCoversHourLocal(s, h)) openCount += 1;
                                    }
                                    if (openCount === 0) return 'rgba(255,255,255,0.06)';
                                    const max = floorTables.length || 1;
                                    const t = Math.min(1, openCount / max);
                                    return `rgba(61, 213, 133, ${0.18 + 0.6 * t})`;
                                }}
                            />
                        </Box>
                    )}

                    {/* Loading notice — shown while the spread DB request
                        for the target date is in flight. Floats at the
                        top-center of the map so it reads as "pulling this
                        date's schedule" without blocking the canvas. */}
                    {spreadLoading && (
                        <Box sx={{
                            position: 'absolute',
                            top: viewMode === 'hourly' ? 64 : 12,
                            left: '50%', transform: 'translateX(-50%)',
                            zIndex: 8,
                            display: 'flex', alignItems: 'center', gap: 1,
                            px: 1.6, py: 0.8, borderRadius: 1.2,
                            bgcolor: 'rgba(10,22,35,0.92)',
                            border: '1px solid rgba(122,200,220,0.35)',
                            backdropFilter: 'blur(6px)',
                            boxShadow: '0 6px 24px rgba(0,0,0,0.4)',
                        }}>
                            <CircularProgress size={16} thickness={5} sx={{ color: '#7adfff' }} />
                            <Typography sx={{ color: '#dff5ff', fontSize: 13, fontWeight: 700 }}>
                                Loading spread schedule data…
                            </Typography>
                        </Box>
                    )}

                    {/* Plan info card — BOTTOM-left, sitting directly
                        ABOVE the Pointer/Rect/Polygon selection pills
                        (pills are at bottom:12, ~44px tall, so this clears
                        them at bottom:64). Shows the planning date plus the
                        two headline totals (scheduled table-hours + open
                        tables). */}
                    <Box sx={{
                        position: 'absolute',
                        bottom: 64,
                        left: 12, zIndex: 5,
                        px: 2, py: 1.5,
                        borderRadius: 1.4,
                        bgcolor: 'rgba(10,22,35,0.9)',
                        border: '1px solid rgba(122,200,220,0.25)',
                        backdropFilter: 'blur(6px)',
                        minWidth: 270,
                    }}>
                        <Typography sx={{
                            color: 'rgba(255,255,255,0.5)', fontSize: SPREAD_FONTS.card.label, fontWeight: 800,
                            letterSpacing: 1.2, textTransform: 'uppercase',
                        }}>
                            Planning Date
                        </Typography>
                        <Typography sx={{ color: '#7adfff', fontSize: SPREAD_FONTS.card.date, fontWeight: 800, lineHeight: 1.2 }}>
                            {prettyLongDate(targetDate)}
                        </Typography>

                        {/* Headline totals */}
                        <Stack direction="row" spacing={3} sx={{
                            mt: 1, pt: 1, borderTop: '1px solid rgba(255,255,255,0.1)',
                        }}>
                            <Box>
                                <Typography sx={{ color: '#dff5ff', fontSize: SPREAD_FONTS.card.metric, fontWeight: 800, lineHeight: 1 }}>
                                    {totalScheduledHours}
                                </Typography>
                                <Typography sx={{ color: 'rgba(255,255,255,0.55)', fontSize: SPREAD_FONTS.card.metricLabel, fontWeight: 600, mt: 0.5 }}>
                                    Total hours
                                </Typography>
                            </Box>
                            <Box>
                                <Typography sx={{ color: '#dff5ff', fontSize: SPREAD_FONTS.card.metric, fontWeight: 800, lineHeight: 1 }}>
                                    {totalOpenTables}
                                </Typography>
                                <Typography sx={{ color: 'rgba(255,255,255,0.55)', fontSize: SPREAD_FONTS.card.metricLabel, fontWeight: 600, mt: 0.5 }}>
                                    Open tables
                                </Typography>
                            </Box>
                        </Stack>

                        {/* v0 = live database baseline indicator. */}
                        {activeIsV0 && !dirty && (
                            <Typography sx={{ color: 'rgba(255,255,255,0.5)', fontSize: 11, mt: 0.6 }}>
                                v0 · live from spread database ({prettyLongDate(targetDate)})
                            </Typography>
                        )}
                        {/* Flag — tables with scheduled hours in the DB but no
                            clean shift match (left unassigned for review). */}
                        {derivedUnmatched.length > 0 && (
                            <Typography sx={{
                                mt: 0.5, color: '#f7768e', fontSize: 11, fontWeight: 700,
                            }}>
                                ⚠ {derivedUnmatched.length} table{derivedUnmatched.length === 1 ? '' : 's'} need review — no matching shift
                            </Typography>
                        )}
                    </Box>

                    {/* Overview color-mode toggle + length legend — only
                        in the Overall view (hourly is always 2-color).
                        TOP-RIGHT corner, labeled "Table colored by:". */}
                    {viewMode === 'overall' && (
                        <Box sx={{
                            position: 'absolute', top: 12, right: 12, zIndex: 7,
                            display: 'flex', flexDirection: 'column', gap: 0.6,
                            alignItems: 'flex-end',
                        }}>
                            <Stack direction="row" alignItems="center" spacing={1.2} sx={{
                                px: 1.2, py: 0.6, borderRadius: 1,
                                bgcolor: 'rgba(10,22,35,0.85)', backdropFilter: 'blur(4px)',
                                border: '1px solid rgba(122,200,220,0.2)',
                            }}>
                                <Typography sx={{
                                    color: 'rgba(255,255,255,0.65)', fontSize: 14, fontWeight: 600,
                                    whiteSpace: 'nowrap', lineHeight: 1,
                                }}>
                                    Table colored by:
                                </Typography>
                                <Stack direction="row" alignItems="stretch" sx={{
                                    border: '1px solid rgba(122,200,220,0.3)',
                                    borderRadius: 1, overflow: 'hidden',
                                }}>
                                    {[
                                        { v: 'shift',  label: 'By shift' },
                                        { v: 'length', label: 'By shift hours' },
                                    ].map((opt) => (
                                        <Box
                                            key={opt.v}
                                            onClick={() => setOverallColorMode(opt.v)}
                                            sx={{
                                                px: 1.4, py: 0.5, cursor: 'pointer',
                                                fontSize: 14, fontWeight: 700, whiteSpace: 'nowrap',
                                                lineHeight: 1,
                                                display: 'flex', alignItems: 'center',
                                                bgcolor: overallColorMode === opt.v ? '#7adfff' : 'transparent',
                                                color: overallColorMode === opt.v ? '#0a1a2c' : 'rgba(255,255,255,0.65)',
                                                '&:hover': overallColorMode !== opt.v ? { bgcolor: 'rgba(122,223,255,0.1)' } : undefined,
                                            }}
                                        >
                                            {opt.label}
                                        </Box>
                                    ))}
                                </Stack>
                            </Stack>
                            {/* Length-band legend — only in "By shift hours". */}
                            {overallColorMode === 'length' && (
                                <Stack direction="row" spacing={1} sx={{
                                    px: 1, py: 0.5, borderRadius: 1,
                                    bgcolor: 'rgba(10,22,35,0.85)', backdropFilter: 'blur(4px)',
                                    border: '1px solid rgba(122,200,220,0.2)',
                                }}>
                                    {SHIFT_LENGTH_BANDS.map((b) => (
                                        <Stack key={b.hours} direction="row" alignItems="center" spacing={0.4}>
                                            <Box sx={{ width: 11, height: 11, borderRadius: '2px', bgcolor: b.color }} />
                                            <Typography sx={{ color: 'rgba(255,255,255,0.7)', fontSize: 11, fontWeight: 600 }}>
                                                {b.label}
                                            </Typography>
                                        </Stack>
                                    ))}
                                </Stack>
                            )}
                        </Box>
                    )}

                    {/* Filter status chip — shows the active slicers + a live
                        count of matching tables. The floor itself is NOT gated
                        by these filters; they only affect the Coverage report /
                        summary counts (see filteredTables usage). */}
                    {filterActive && (
                        <Stack direction="row" spacing={0.8} alignItems="center" sx={{
                            mb: 1, px: 1.2, py: 0.6, borderRadius: 1,
                            bgcolor: 'rgba(122,223,255,0.10)',
                            border: '1px solid rgba(122,223,255,0.35)',
                            flexWrap: 'wrap', rowGap: 0.4,
                        }}>
                            <Typography sx={{ fontSize: 11, fontWeight: 800, letterSpacing: 0.5, color: '#7adfff', textTransform: 'uppercase' }}>Filter</Typography>
                            {areaFilter.length > 0 && (
                                <Typography sx={{ fontSize: 13, fontWeight: 700, color: '#dff5ff' }}>Area: {areaFilter.join(', ')}</Typography>
                            )}
                            {subFilter.length > 0 && (
                                <Typography sx={{ fontSize: 13, fontWeight: 700, color: '#dff5ff' }}>· Sub-seg: {subFilter.join(', ')}</Typography>
                            )}
                            {gtFilter.length > 0 && (
                                <Typography sx={{ fontSize: 13, fontWeight: 700, color: '#dff5ff' }}>· Game: {gtFilter.join(', ')}</Typography>
                            )}
                            <Box sx={{ flex: 1 }} />
                            <Typography sx={{ fontSize: 12, fontWeight: 800, color: 'rgba(255,255,255,0.75)' }}>
                                {filteredTables.length} of {floorTables.length} tables
                            </Typography>
                            <Box onClick={() => { setAreaFilter([]); setSubFilter([]); setGtFilter([]); }}
                                sx={{ cursor: 'pointer', fontSize: 12, fontWeight: 700, color: '#f7768e', ml: 0.5, '&:hover': { color: '#ff98a7' } }}>Clear</Box>
                        </Stack>
                    )}

                    <FloorScheduleMap
                        tables={floorTables}
                        assignments={editingAssignments}
                        shifts={store.shifts}
                        selectedKeys={selectedKeys}
                        activeBrushShiftId={activeBrushShiftId}
                        onSelectionChange={onSelectionChange}
                        onAssign={assignOne}
                        mode={viewMode}
                        currentHour={hourCursor}
                        colorMode={overallColorMode}
                        vmSelected={vmShiftSel}
                        onVmSelected={setVmShiftSel}
                        layoutMode="planning"
                    />
                    {/* Floating bulk-action menu — appears whenever the
                        selection is non-empty. Assign / adjust = swatch
                        click (overwrite); Remove unassigns; Clear or
                        Esc dismisses. */}
                    <SelectionActionBar
                        selectedKeys={selectedKeys}
                        assignments={editingAssignments}
                        shifts={store.shifts}
                        onAssignShift={assignToSelection}
                        onRemoveShift={() => assignToSelection(null)}
                        onClear={() => setSelectedKeys(new Set())}
                    />
                </Box>

                <Stack spacing={1.2}>
                    {/* Right-column tabs — Shifts · Summary · Calendar · Settings. */}
                    <Stack
                        direction="row"
                        sx={{
                            border: '1px solid rgba(122,200,220,0.25)',
                            borderRadius: 1.2,
                            overflow: 'hidden',
                            alignSelf: 'flex-start',
                        }}
                    >
                        {[
                            { v: 'palette', label: 'Shifts',   icon: <GridViewIcon sx={{ fontSize: 19, mr: 0.6 }} /> },
                            { v: 'compare', label: 'Summary',  icon: <CompareArrowsIcon sx={{ fontSize: 19, mr: 0.6 }} /> },
                            { v: 'history', label: 'History',  icon: <HistoryIcon sx={{ fontSize: 19, mr: 0.6 }} /> },
                            { v: 'apply',   label: 'Calendar', icon: <CalendarMonthIcon sx={{ fontSize: 19, mr: 0.6 }} /> },
                            { v: 'library', label: 'Settings', icon: <SettingsIcon sx={{ fontSize: 19, mr: 0.6 }} /> },
                        ].map((opt) => (
                            <Box
                                key={opt.v}
                                onClick={() => setRightView(opt.v)}
                                sx={{
                                    px: 1.8, py: 0.9, cursor: 'pointer',
                                    fontSize: SPREAD_FONTS.tabs, fontWeight: 700, letterSpacing: 0.4,
                                    display: 'flex', alignItems: 'center',
                                    bgcolor: rightView === opt.v ? '#7adfff' : 'transparent',
                                    color: rightView === opt.v ? '#0a1a2c' : 'rgba(255,255,255,0.6)',
                                    transition: 'background-color 140ms',
                                    '&:hover': rightView !== opt.v
                                        ? { bgcolor: 'rgba(122,223,255,0.08)' } : undefined,
                                }}
                            >
                                {opt.icon}{opt.label}
                            </Box>
                        ))}
                    </Stack>

                    {rightView === 'palette' && (
                        <ShiftPalette
                            shifts={store.shifts}
                            activeShiftId={activeBrushShiftId}
                            onPick={setActiveBrushShiftId}
                            assignmentCounts={counts}
                            selectedTableCount={selectedKeys.size}
                            onAssignToSelected={assignToSelection}
                        />
                    )}
                    {rightView === 'compare' && (
                        <SpreadComparePanel
                            targetVersion={{ assignments: editingAssignments }}
                            referenceVersion={referenceVersion}
                            shifts={store.shifts}
                            tables={floorTables}
                        />
                    )}
                    {rightView === 'history' && (
                        <HistoryComparePanel
                            spreadRows={spreadRows}
                            targetDate={targetDate}
                            tables={floorTables}
                            subSegments={availableSubs}
                        />
                    )}
                    {rightView === 'apply' && (
                        <DateScopePanel
                            targetDate={targetDate}
                            setTargetDate={setTargetDate}
                            onApplyToDates={applyToDates}
                            assignmentCount={Object.keys(editingAssignments).length}
                            availableDates={availableDates}
                            dateSummary={dateSummary}
                        />
                    )}
                    {rightView === 'library' && (
                        <ShiftLibrary
                            shifts={store.shifts}
                            onChange={setShifts}
                        />
                    )}
                </Stack>
            </Box>

            {/* Bottom row — Coverage bar chart by default. When a
                reference plan is selected, a toggle lets the user switch
                between the Coverage bar chart and the reference floor
                heatmap (so both views of the reference date are one
                click apart instead of the heatmap fully replacing the
                coverage chart). */}
            <Box sx={{ mb: 1.5 }}>
                {referenceVersion && (
                    <Stack
                        direction="row"
                        sx={{
                            border: '1px solid rgba(122,200,220,0.25)',
                            borderRadius: 1, overflow: 'hidden',
                            alignSelf: 'flex-start', display: 'inline-flex',
                            mb: 1,
                        }}
                    >
                        {[
                            { v: 'coverage',  label: 'Coverage Chart' },
                            { v: 'reference', label: 'Reference Heatmap' },
                        ].map((opt) => (
                            <Box
                                key={opt.v}
                                onClick={() => setBottomView(opt.v)}
                                sx={{
                                    px: 1.6, py: 0.6, cursor: 'pointer',
                                    fontSize: 14, fontWeight: 700, letterSpacing: 0.4,
                                    bgcolor: bottomView === opt.v ? '#7adfff' : 'transparent',
                                    color: bottomView === opt.v ? '#0a1a2c' : 'rgba(255,255,255,0.6)',
                                    transition: 'background-color 140ms',
                                    '&:hover': bottomView !== opt.v ? { bgcolor: 'rgba(122,223,255,0.08)' } : undefined,
                                }}
                            >
                                {opt.label}
                            </Box>
                        ))}
                    </Stack>
                )}
                {referenceVersion && bottomView === 'reference' ? (
                    <ReferenceFloorMap
                        targetDate={targetDate}
                        referenceVersion={referenceVersion}
                        referenceDate={referenceDate}
                        shifts={store.shifts}
                        tables={referenceTables}
                        mode={viewMode}
                        currentHour={hourCursor}
                        versions={referenceMode === 'all' ? allModeVersions : null}
                        activeVersionId={allModeVersionId}
                        onPickVersion={setAllModeVersionId}
                        onUseAsBase={useReferenceAsBase}
                    />
                ) : (
                    <CoverageReport
                        assignments={editingAssignments}
                        shifts={store.shifts}
                        tables={filteredTables}
                    />
                )}
            </Box>

            {compareWithVersion && active && (
                <Box sx={{ mb: 1.5 }}>
                    <VersionDiff
                        versionA={active}
                        versionB={compareWithVersion}
                        shifts={store.shifts}
                        onClose={() => setComparingVersionId(null)}
                    />
                </Box>
            )}
            </>)}

            {/* The old fixed-position "N selected" hint toast was
                replaced by the SelectionActionBar overlay inside the
                floor-map card — it shows the count AND the actions,
                so the hint had nothing left to teach. */}
        </Box>
    );
}

// Pure equality check for two assignment maps. Order-independent;
// values must match exactly.
function sameAssignments(a, b) {
    const ak = Object.keys(a || {});
    const bk = Object.keys(b || {});
    if (ak.length !== bk.length) return false;
    for (const k of ak) if (a[k] !== b[k]) return false;
    return true;
}
