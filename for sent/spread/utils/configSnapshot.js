// Floor config snapshot helpers
// ==============================
//
// Read the live floor (from config_cod.json) and compare it against the
// tableSnapshot frozen in a saved ScheduleVersion. The diff feeds the
// ConfigDriftBanner (added/removed/moved) and the "migrate to current
// config" command.

import config_data from '../../shared/data/config_cod.json';
import { gametypeTableKey } from '../../performance/utils/dataSource';
import { makeTableSnapshot } from './spreadDataModel';
import { segmentForPit, subSegmentForPit } from '../../shared/constants/pitSegments';

// Filter shape mirrors the Performance Heatmap's config filter — only
// active TG tables whose validity window covers the target date.
// `forDate` is YYYY-MM-DD. When omitted we fall back to today.
//
// The validity test is purely date-window based:
//     startdate <= forDate <= enddate
// (string comparison is correct because dates are ISO YYYY-MM-DD).
// This is the single mechanism for "which tables exist on this date":
// the user keeps config_cod.json current — when a table leaves the
// floor they set its enddate, when one arrives they add a row with a
// startdate — and this filter re-derives the floor for `forDate` on
// every call, so the Live floor always tracks the latest config.
export function liveFloorTables(forDate = null) {
    const date = forDate || new Date().toISOString().slice(0, 10);
    const tables = [];
    for (const cfg of config_data) {
        if (cfg.Group !== 'TG') continue;
        if (cfg.is_Active !== 1) continue;
        // Spread planning only deals with real 5-digit table ids — drop
        // any config row whose table id isn't exactly 5 characters
        // (placeholder / aggregate / malformed rows).
        if (String(cfg.table ?? '').length !== 5) continue;
        if (cfg.startdate && cfg.startdate > date) continue;
        if (cfg.enddate   && cfg.enddate   < date) continue;
        tables.push({
            key:         gametypeTableKey(cfg.game, cfg.table),
            label:       cfg.game ? `${cfg.game}${cfg.table}` : String(cfg.table),
            gametype:    cfg.game,
            x:           Number(cfg.x) || 0,
            y:           Number(cfg.y) || 0,
            // Table heading in degrees — drives symbolRotate on the
            // floor map so each table renders at its real orientation,
            // exactly like the Performance Heatmap scatter.
            rotation:    Number(cfg.rotation) || 0,
            pit:         String(cfg.pit ?? ''),
            area:        cfg.Location || cfg.area || '',
            // Macro segment ("MS" / "PM") + sub-segment, both derived from
            // the pit via the pitSegments config. sub_segment falls back to
            // the config Location so unmapped pits still group sensibly.
            segment:     segmentForPit(cfg.pit),
            sub_segment: subSegmentForPit(cfg.pit, cfg.sub_segment || cfg.Location || ''),
            tableMin:    Number(cfg.table_min) || 0,
        });
    }
    return tables;
}

export function liveFloorSnapshot(forDate = null) {
    return makeTableSnapshot(liveFloorTables(forDate));
}

// Distinct game types defined in the floor config (TG group), regardless of
// date — the canonical list for game-type slicers/filters. Sorted.
export function configGametypes() {
    const set = new Set();
    for (const cfg of config_data) {
        if (cfg.Group !== 'TG') continue;
        if (cfg.game) set.add(String(cfg.game));
    }
    return [...set].sort();
}

// Compare two snapshots — returns the structural diff. `added` /
// `removed` are arrays of table descriptors; `moved` only fires when
// a key exists in both but a meaningful field (pit, sub_segment, x/y)
// changed. The banner uses the three array lengths to decide whether
// to surface a warning, and the version-migrate command uses them
// directly to seed the new version's assignments map.
export function diffSnapshots(prev, current) {
    const prevMap = new Map((prev?.tables || []).map((t) => [t.key, t]));
    const curMap  = new Map((current?.tables || []).map((t) => [t.key, t]));

    const added = [];
    for (const [key, t] of curMap.entries()) {
        if (!prevMap.has(key)) added.push(t);
    }

    const removed = [];
    for (const [key, t] of prevMap.entries()) {
        if (!curMap.has(key)) removed.push(t);
    }

    const moved = [];
    for (const [key, t] of curMap.entries()) {
        const p = prevMap.get(key);
        if (!p) continue;
        const dx = Math.abs((p.x || 0) - (t.x || 0));
        const dy = Math.abs((p.y || 0) - (t.y || 0));
        if (
            String(p.pit) !== String(t.pit) ||
            String(p.sub_segment) !== String(t.sub_segment) ||
            dx > 1 || dy > 1
        ) {
            moved.push({ key, before: p, after: t });
        }
    }

    return {
        added, removed, moved,
        hasDrift: added.length + removed.length + moved.length > 0,
    };
}

// Carry assignments forward from `prevVersion` into a new map keyed on
// the CURRENT floor's tables. Tables that survived keep their shift;
// new tables come in unassigned; removed tables drop off.
export function carryAssignmentsForward(prevAssignments, currentTables) {
    const carried = {};
    const curKeys = new Set(currentTables.map((t) => t.key));
    for (const [tableKey, shiftId] of Object.entries(prevAssignments || {})) {
        if (curKeys.has(tableKey)) carried[tableKey] = shiftId;
    }
    return carried;
}
