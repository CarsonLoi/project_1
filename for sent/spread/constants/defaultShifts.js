// Default shift library
// =====================
//
// The same 10-shift set the HourlyDemand panel ships with — one 24h
// pattern (A), three 16h patterns (B/C/D) covering the day, six 8h
// split patterns (B1/B2/C1/C2/D1/D2) that pair up to their parent 16h.
//
// All hours are inclusive on both ends; B (11 → 2) covers
// 11..23, 0, 1, 2 = 16 hours total. See shiftCoverage.js helpers.

// Color scheme — each shift FAMILY gets its own hue so they're easy to
// tell apart, and the two 8h sub-shifts inherit their parent 16h shift's
// hue (a lighter + a darker tint) so the eye reads "B1, B2 belong to B":
//   A  (24h) → violet (standalone)
//   B family → blue   (B mid · B1 light · B2 dark)
//   C family → green  (C mid · C1 light · C2 dark)
//   D family → amber  (D mid · D1 light · D2 dark)
export const DEFAULT_SHIFTS = [
    // 24-hour anchor — its own distinct hue.
    { id: 'A',  name: 'A',  kind: '24h', startHour: 7,  endHour: 7,  color: '#a855f7', description: '24-hour open' },

    // B family — blue.
    { id: 'B',  name: 'B',  kind: '16h', startHour: 11, endHour: 2,  color: '#2563eb', description: '11:00 → 02:00 (16h)' },
    { id: 'B1', name: 'B1', kind: '8h',  startHour: 11, endHour: 18, color: '#60a5fa', description: '11:00 → 18:00 (8h)' },
    { id: 'B2', name: 'B2', kind: '8h',  startHour: 19, endHour: 2,  color: '#1e40af', description: '19:00 → 02:00 (8h)' },

    // C family — green.
    { id: 'C',  name: 'C',  kind: '16h', startHour: 13, endHour: 4,  color: '#16a34a', description: '13:00 → 04:00 (16h)' },
    { id: 'C1', name: 'C1', kind: '8h',  startHour: 13, endHour: 20, color: '#4ade80', description: '13:00 → 20:00 (8h)' },
    { id: 'C2', name: 'C2', kind: '8h',  startHour: 21, endHour: 4,  color: '#15803d', description: '21:00 → 04:00 (8h)' },

    // D family — amber / orange.
    { id: 'D',  name: 'D',  kind: '16h', startHour: 15, endHour: 6,  color: '#ea580c', description: '15:00 → 06:00 (16h)' },
    { id: 'D1', name: 'D1', kind: '8h',  startHour: 15, endHour: 22, color: '#fb923c', description: '15:00 → 22:00 (8h)' },
    { id: 'D2', name: 'D2', kind: '8h',  startHour: 23, endHour: 6,  color: '#9a3412', description: '23:00 → 06:00 (8h)' },
];

// id → default color, so the Shift Library can offer a "reset to default
// colors" action (existing stores keep whatever colors were saved; this
// lets the user adopt the new family scheme without losing assignments).
export const DEFAULT_SHIFT_COLORS = DEFAULT_SHIFTS.reduce((m, s) => {
    m[s.id] = s.color;
    return m;
}, {});

// Special sentinel — "no assignment" / "table is closed". When a table
// has no entry in a version's `assignments` map this is what the floor
// map renders for it. Kept as a constant so legend + map agree.
export const UNASSIGNED_COLOR = 'rgba(120, 130, 145, 0.35)';
export const UNASSIGNED_LABEL = 'Unassigned';

// ---------------------------------------------------------------------
// Shift-LENGTH band colors — used by the Overview's "by shift hour"
// display mode (color a table by how long its shift is, not which shift
// it is): 24h / 16h / 8h / 0h (unassigned-closed). Distinct from each
// shift's own configurable color (used by the "by shift" mode).
// ---------------------------------------------------------------------
export const SHIFT_LENGTH_COLORS = {
    24: '#fc6e78', // 24-hour — red
    16: '#f59e0b', // 16-hour — amber
    8:  '#00d4ff', // 8-hour  — cyan
    0:  UNASSIGNED_COLOR, // 0-hour / unassigned — grey
};
// Ordered bands for legends.
export const SHIFT_LENGTH_BANDS = [
    { hours: 24, label: '24 hr', color: SHIFT_LENGTH_COLORS[24] },
    { hours: 16, label: '16 hr', color: SHIFT_LENGTH_COLORS[16] },
    { hours: 8,  label: '8 hr',  color: SHIFT_LENGTH_COLORS[8] },
    { hours: 0,  label: '0 hr',  color: SHIFT_LENGTH_COLORS[0] },
];
export function shiftLengthColor(lengthHours) {
    return SHIFT_LENGTH_COLORS[lengthHours] || UNASSIGNED_COLOR;
}
