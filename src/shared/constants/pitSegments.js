// Pit → segment classification (config)
// ======================================
//
// Single source of truth for how each PIT rolls up into:
//   • a macro SEGMENT  — "MS" (mass) or "PM" (premium)
//   • a SUB-SEGMENT    — the finer floor grouping (MSC / Main / VIP / …)
//
// The floor config (config_cod.json) only carries `pit` + `Location`, so
// these maps derive the segment/sub-segment from the pit at floor-build
// time (see spread/utils/configSnapshot.liveFloorTables). Edit these two
// objects to re-classify the floor — every consumer (pricing Summary,
// hourly charts, etc.) updates from here.

// pit → "MS" | "PM"
export const PIT_TO_SEGMENT = {
    // Mass floor
    '123': 'MS', '124': 'MS', '125': 'MS',   // MSC
    '555': 'MS', '556': 'MS', '557': 'MS',   // Main
    '883': 'MS', '884': 'MS',                // Slots
    // Premium floor
    '666': 'PM', '667': 'PM',                // VIP
    '999': 'PM',                             // PM
};

// pit → sub-segment label (the finer grouping within a segment)
export const PIT_TO_SUB_SEGMENT = {
    '123': 'MSC', '124': 'MSC', '125': 'MSC',
    '555': 'Main', '556': 'Main', '557': 'Main',
    '666': 'VIP', '667': 'VIP',
    '883': 'Slots', '884': 'Slots',
    '999': 'PM',
};

// Display order for the two macro segments.
export const SEGMENT_ORDER = ['MS', 'PM'];

// Display-order DICTIONARY for sub-segments — EDIT this list to arrange the
// order shown in the pricing Summary, comparison, and hourly charts.
// Sub-segments not listed here are appended at the end (alphabetically).
export const SUB_SEGMENT_ORDER = ['MSC', 'Main', 'Slots', 'VIP', 'PM'];

// Sort a list of sub-segment labels by SUB_SEGMENT_ORDER (unknowns last,
// then alphabetical). De-duplicates and drops blanks.
export function sortSubSegments(list) {
    const rank = new Map(SUB_SEGMENT_ORDER.map((s, i) => [s, i]));
    return [...new Set((list || []).filter(Boolean))].sort((a, b) => {
        const ra = rank.has(a) ? rank.get(a) : Infinity;
        const rb = rank.has(b) ? rank.get(b) : Infinity;
        return ra !== rb ? ra - rb : String(a).localeCompare(String(b));
    });
}

// Default when a pit isn't mapped (keeps unmapped tables visible under MS).
export const DEFAULT_SEGMENT = 'MS';

// Resolve a pit → macro segment ("MS" / "PM").
export function segmentForPit(pit) {
    return PIT_TO_SEGMENT[String(pit ?? '')] || DEFAULT_SEGMENT;
}

// Resolve a pit → sub-segment label. Falls back to a provided default
// (e.g. the config Location) when the pit isn't mapped.
export function subSegmentForPit(pit, fallback = '') {
    return PIT_TO_SUB_SEGMENT[String(pit ?? '')] || fallback || '';
}
