// Shift hour-coverage helpers
// ============================
//
// `endHour` is INCLUSIVE — a shift from 11 → 2 covers
// 11..23, 0, 1, 2 = 16 hours. `startHour === endHour` is the 24-hour
// pattern (e.g. 7 → 7). Mirrors the convention in HourlyDemand.jsx.

const norm = (h) => ((Math.round(Number(h)) % 24) + 24) % 24;

export function shiftCoversHour(shift, hour) {
    const s = norm(shift.startHour);
    const e = norm(shift.endHour);
    const h = norm(hour);
    if (s === e) return true; // 24h pattern — covers everything
    if (s < e)   return h >= s && h <= e;
    return h >= s || h <= e;  // wrap across midnight
}

export function shiftLengthHours(shift) {
    const s = norm(shift.startHour);
    const e = norm(shift.endHour);
    if (s === e) return 24;
    return s < e ? e - s + 1 : 24 - s + e + 1;
}

// Returns an array of length 24 — each slot is true/false for whether
// this shift covers that hour (0..23). Used to render the per-shift
// timeline ribbon in ShiftLibrary + tooltips.
export function shiftCoverageMask(shift) {
    const mask = new Array(24);
    for (let h = 0; h < 24; h++) mask[h] = shiftCoversHour(shift, h);
    return mask;
}

// Human label like "07:00 → 07:00 next day" / "11:00 → 02:00".
export function formatShiftRange(shift) {
    // Guard: non-shift payloads (e.g. pricing tiers reusing the floor
    // map) have no start/end hour — render an em-dash instead of NaN.
    if (!shift || !Number.isFinite(shift.startHour) || !Number.isFinite(shift.endHour)) return '—';
    const fmt = (h) => `${String(norm(h)).padStart(2, '0')}:00`;
    const s = norm(shift.startHour);
    const e = norm(shift.endHour);
    if (s === e) return `${fmt(s)} → ${fmt(e)} next day`;
    return `${fmt(s)} → ${fmt(e)}`;
}

// Clock-window label. End hour is INCLUSIVE — a shift ending at hour `e`
// covers through e:59 — so B (11 → 2) renders "11:00 - 02:59". The 24h
// pattern (start === end) renders "HH:00 - HH:00" (e.g. "07:00 - 07:00").
export function formatShiftClock(shift) {
    const pad = (n) => String(n).padStart(2, '0');
    const s = norm(shift.startHour);
    const e = norm(shift.endHour);
    if (s === e) return `${pad(s)}:00 - ${pad(s)}:00`;
    return `${pad(s)}:00 - ${pad(e)}:59`;
}
