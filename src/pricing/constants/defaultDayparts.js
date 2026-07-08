// Pricing dayparts — by-hour pricing without a per-hour plan
// ==========================================================
//
// A table's minimum can change through the day, but operators don't draw
// a fresh plan for all 24 hours — they price in a few BLOCKS ("dayparts")
// and let one block span several hours. A daypart is a contiguous hour
// window (inclusive end, gaming-day ordered) that owns a table→tier map.
//
// Resolving "what's the minimum at hour H" = find the daypart covering H,
// then read its assignment for the table. Editing a couple of hours at
// once = just edit that daypart (or copy one daypart's plan into others).
//
// Dayparts are user-editable (Settings → Dayparts) and persist in
// pricingStorage; this is the seed for a fresh install. The gaming day
// starts at 07:00, so the defaults split Day (07:00–18:59) and Night
// (19:00–06:59).

export const DEFAULT_DAYPARTS = [
    { id: 'day',   label: 'Day',   startHour: 7,  endHour: 18 },
    { id: 'night', label: 'Night', startHour: 19, endHour: 6  },
];

const norm = (h) => ((Number(h) % 24) + 24) % 24;

// Inclusive-end hour list for a daypart, in clock order (wraps past
// midnight). e.g. {start:19,end:6} → [19,20,21,22,23,0,1,2,3,4,5,6].
export function daypartHours(dp) {
    if (!dp) return [];
    const s = norm(dp.startHour);
    const e = norm(dp.endHour);
    const out = [];
    let h = s;
    // Always include at least the start hour; walk forward (wrapping)
    // until we pass the inclusive end.
    for (let i = 0; i < 24; i++) {
        out.push(h);
        if (h === e) break;
        h = (h + 1) % 24;
    }
    return out;
}

// True when this daypart covers clock hour H (inclusive end).
export function daypartCoversHour(dp, hour) {
    return daypartHours(dp).includes(norm(hour));
}

// "07:00 – 18:59" inclusive-end clock label.
export function formatDaypartClock(dp) {
    if (!dp) return '—';
    const pad = (n) => String(norm(n)).padStart(2, '0');
    const endMin = `${pad(dp.endHour)}:59`;
    return `${pad(dp.startHour)}:00 – ${endMin}`;
}

// Which daypart owns clock hour H? Returns the first match (dayparts
// should tile the day, but on a gap this returns null = unpriced hour).
export function daypartForHour(dayparts, hour) {
    return (dayparts || []).find((dp) => daypartCoversHour(dp, hour)) || null;
}
