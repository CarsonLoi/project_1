// Auto-plan — core hours, blocks and day types.
// Prices are planned at the core hours; every other hour copies the core hour
// before it (gaming day 07:00 → 06:00). The core hours are a setting
// (Criteria tab): CORE_HOURS is a live binding that setCoreHours replaces,
// so every importer reads the current list.

export const DEFAULT_CORE_HOURS = [7, 11, 13, 15, 21, 3, 5];
export const GAMING_HOURS = [7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 0, 1, 2, 3, 4, 5, 6];
const POS = new Map(GAMING_HOURS.map((h, i) => [h, i]));
const norm = (h) => ((Number(h) % 24) + 24) % 24;

// Valid, de-duplicated, in gaming-day order, always starting at 07:00.
export function normalizeCoreHours(list) {
    const set = new Set([GAMING_HOURS[0]]);
    for (const h of Array.isArray(list) ? list : []) if (Number.isInteger(Number(h)) && Number(h) >= 0 && Number(h) <= 23) set.add(Number(h));
    return GAMING_HOURS.filter((h) => set.has(h));
}
export let CORE_HOURS = [...DEFAULT_CORE_HOURS];
export function setCoreHours(list) {
    const next = normalizeCoreHours(list);
    if (next.join() !== CORE_HOURS.join()) CORE_HOURS = next;
    return CORE_HOURS;
}
export const firstCore = () => CORE_HOURS[0];
export const lastCore = () => CORE_HOURS[CORE_HOURS.length - 1];

export function coreFor(hour) {
    const p = POS.get(norm(hour));
    let c = CORE_HOURS[0];
    for (const k of CORE_HOURS) if (POS.get(k) <= p) c = k;
    return c;
}
export const blockHours = (core) => GAMING_HOURS.filter((h) => coreFor(h) === core);
const two = (h) => String(h).padStart(2, '0');
export function blockLabel(core) {
    const hs = blockHours(core);
    return hs.length > 1 ? `${two(hs[0])}–${two(hs[hs.length - 1])}` : two(hs[0]);
}
export const prevCore = (core) => { const i = CORE_HOURS.indexOf(core); return i > 0 ? CORE_HOURS[i - 1] : null; };

export const DAY_TYPES = [
    { id: 'wd', label: 'Weekday' },
    { id: 'fri', label: 'Friday' },
    { id: 'sat', label: 'Saturday' },
    { id: 'sun', label: 'Sunday' },
];
export const DEFAULT_DOW_MAP = { 0: 'sun', 1: 'wd', 2: 'wd', 3: 'wd', 4: 'wd', 5: 'fri', 6: 'sat' };
export const DOW_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const parse = (iso) => { const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)); };
const fmt = (dt) => dt.toISOString().slice(0, 10);
export const dowOf = (iso) => parse(iso).getUTCDay();
export function dayTypeOf(iso, cfg) {
    const o = cfg && cfg.overrides && cfg.overrides[iso];
    if (o) return o;
    return ((cfg && cfg.dowMap) || DEFAULT_DOW_MAP)[dowOf(iso)];
}
export const addDays = (iso, n) => fmt(new Date(parse(iso).getTime() + n * 86400000));
export function datesBetween(from, to) {
    const out = [];
    if (!from || !to || from > to) return out;
    for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
    return out;
}
export function nextMonthRange(todayIso) {
    const t = parse(todayIso);
    const first = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 1));
    const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 2, 0));
    return { from: fmt(first), to: fmt(last) };
}
