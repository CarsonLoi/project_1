// Auto-plan — the table minimums each sub-segment can be priced at
// =================================================================
//
// EDIT THIS FILE to set which prices appear (as rows) in the Targets grid
// and which prices the solver may give a sub-segment's tables. Amounts are
// the $ minimum and must match a tier in Settings → Tier library
// (defaultTiers.js); an amount with no matching tier is ignored.
//
// Precedence for a sub-segment's price list:
//   1. what you add / remove in the Targets tab (saved in this browser;
//      "Reset to config prices" there drops the edit),
//   2. this file,
//   3. the prices its history ran (only for sub-segments not listed here,
//      or listed with an empty array).
//
// Keys are the sub-segment names used on the floor (shared/constants/
// pitSegments.js → SUB_SEGMENT_ORDER). The values below are a starting
// point: replace them with the floor's real price bands.

export const SEGMENT_PRICES = {
    MSC:   [300, 500, 1000, 2000, 3000, 5000],
    Main:  [200, 300, 500, 1000, 2000],
    Slots: [100, 200, 300, 500, 1000],
    VIP:   [500, 1000, 2000, 3000, 5000, 10000],
    PM:    [300, 500, 1000, 2000, 3000],
};
