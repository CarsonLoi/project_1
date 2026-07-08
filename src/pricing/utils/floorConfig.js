// Floor config (pricing) — read the live floor from config_cod.json
// ==================================================================
//
// Cloned from the scheduling configSnapshot so the pricing dashboard does
// not depend on the spread module. Trimmed to exactly what pricing needs:
//   • liveFloorTables(date) — the floor for a date (with pit-derived
//     segment / sub-segment + table minimum)
//   • configGametypes()     — every game type defined in the config
// (The spread-only snapshot/diff helpers are intentionally not cloned.)

import config_data from '../../shared/data/config_cod.json';
import { gametypeTableKey } from '../../performance/utils/dataSource';
import { segmentForPit, subSegmentForPit } from '../../shared/constants/pitSegments';

// Which tables exist on `forDate` — active TG tables whose validity window
// (startdate..enddate, inclusive ISO compare) covers the date. Keep
// config_cod.json current and the live floor tracks the latest config.
export function liveFloorTables(forDate = null) {
    const date = forDate || new Date().toISOString().slice(0, 10);
    const tables = [];
    for (const cfg of config_data) {
        if (cfg.Group !== 'TG') continue;
        if (cfg.is_Active !== 1) continue;
        // Only real 5-digit table ids (drop placeholder / aggregate rows).
        if (String(cfg.table ?? '').length !== 5) continue;
        if (cfg.startdate && cfg.startdate > date) continue;
        if (cfg.enddate   && cfg.enddate   < date) continue;
        tables.push({
            key:         gametypeTableKey(cfg.game, cfg.table),
            label:       cfg.game ? `${cfg.game}${cfg.table}` : String(cfg.table),
            gametype:    cfg.game,
            x:           Number(cfg.x) || 0,
            y:           Number(cfg.y) || 0,
            rotation:    Number(cfg.rotation) || 0,
            pit:         String(cfg.pit ?? ''),
            area:        cfg.Location || cfg.area || '',
            // Macro segment ("MS" / "PM") + sub-segment, derived from the pit.
            segment:     segmentForPit(cfg.pit),
            sub_segment: subSegmentForPit(cfg.pit, cfg.sub_segment || cfg.Location || ''),
            tableMin:    Number(cfg.table_min) || 0,
        });
    }
    return tables;
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
