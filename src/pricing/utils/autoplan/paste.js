// Auto-plan — target mix to and from Excel (tab-separated cells).
//
// Layout (one header row, any column order):
//   [Date | Day of week]  [Segment]  Sub segment  Game type  Price  07  11  13  15  21  03  05
// Targets are per sub-segment × game type: a game type's tables never fill
// another game type's targets. The Date / Day of week column is optional
// (the page's current scope is used); it, Sub segment and Game type may be
// left blank to repeat the row above (merged cells). Day of week takes a
// day type (Weekday, Friday …) or a weekday (Monday → its day type).
// Segment is read for reference only. Hours accept 7, 07, 07:00, 7am, 9pm,
// 21:00. Prices accept $1,000, 1000, 1k.

const DT_ALIASES = {
    wd: ['wd', 'weekday', 'weekdays', 'mon-thu', 'mon–thu', 'mon to thu'],
    fri: ['fri', 'friday'],
    sat: ['sat', 'saturday'],
    sun: ['sun', 'sunday'],
};
const two = (h) => String(h).padStart(2, '0');
const splitRows = (text) => String(text || '').replace(/\r/g, '').replace(/\n+$/, '').split('\n').map((r) => r.split('\t'));

export function parseHourToken(v) {
    const m = String(v ?? '').trim().toLowerCase().match(/^(\d{1,2})(?::00)?\s*(am|pm)?$/);
    if (!m) return null;
    let h = Number(m[1]);
    if (m[2] === 'pm' && h < 12) h += 12;
    if (m[2] === 'am' && h === 12) h = 0;
    return h >= 0 && h <= 23 ? h : null;
}

function parsePrice(v) {
    const s = String(v ?? '').trim().toLowerCase().replace(/[$,\s]/g, '');
    const m = s.match(/^(\d+(?:\.\d+)?)(k?)$/);
    if (!m) return null;
    return Number(m[1]) * (m[2] ? 1000 : 1);
}

const WEEKDAYS = [
    ['sunday', 'sun'], ['monday', 'mon'], ['tuesday', 'tue', 'tues'], ['wednesday', 'wed'],
    ['thursday', 'thu', 'thur', 'thurs'], ['friday', 'fri'], ['saturday', 'sat'],
];

// A day type id, 'd:YYYY-MM-DD', null (blank) or undefined (unreadable).
// A day type's own name wins; another weekday maps through the week map.
function parseScope(v, dayTypes, dates, dowMap) {
    const s = String(v ?? '').trim();
    if (!s) return null;
    const low = s.toLowerCase();
    for (const d of dayTypes) if ((DT_ALIASES[d.id] || [d.id]).includes(low) || d.label.toLowerCase() === low) return d.id;
    const dow = WEEKDAYS.findIndex((names) => names.includes(low));
    if (dow >= 0 && dowMap && dowMap[dow]) return dowMap[dow];
    let iso = null;
    const a = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
    const b = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (a) iso = `${a[1]}-${two(a[2])}-${two(a[3])}`;
    else if (b) iso = `${b[3]}-${two(b[1])}-${two(b[2])}`;
    return iso && dates.includes(iso) ? `d:${iso}` : undefined;
}

// Header cell → column kind ('sub' before 'segment': "Sub segment" is a sub).
function columnKind(h) {
    const low = String(h).trim().toLowerCase().replace(/[^a-z]/g, '');
    if (!low) return null;
    if (low.startsWith('sub')) return 'sub';
    if (low.includes('game')) return 'game';
    if (low.startsWith('seg')) return 'segment';
    if (/price|min|tier/.test(low)) return 'price';
    if (/date|day|dow|week/.test(low)) return 'scope';
    return null;
}

/**
 * groups: [{ key, sub, game }] — the mix groups on the floor.
 * @returns {{ cells: {scope, group, sub, tierId, core, n}[], newPrices: {sub, tierId}[], errors: string[] }}
 */
export function parseTargetsPaste(text, { groups, tiers, coreHours, dayTypes, dates, scope, ladders, dowMap = null }) {
    const errors = [], cells = [], newPrices = [];
    const rows = splitRows(text);
    const hi = rows.findIndex((r) => r.some((c) => columnKind(c) === 'price') && r.some((c) => columnKind(c) === 'sub'));
    if (hi < 0) {
        errors.push('Include the header row: Sub segment, Game type, Price and the core hours (07, 11, 13 …).');
        return { cells, newPrices, errors };
    }
    const col = { scope: -1, sub: -1, game: -1, price: -1 };
    const hourCols = [];
    rows[hi].forEach((h, i) => {
        const t = String(h).trim();
        const hour = parseHourToken(t);
        if (hour != null) {
            if (coreHours.includes(hour)) hourCols.push({ i, core: hour });
            else errors.push(`Column ${t} is not a core hour; it was skipped.`);
            return;
        }
        const kind = columnKind(t);
        if (kind && kind !== 'segment' && col[kind] < 0) col[kind] = i;
    });
    if (col.game < 0) {
        errors.push('Include a Game type column: each game type has its own target mix.');
        return { cells, newPrices, errors };
    }
    const subByLow = new Map(groups.map((g) => [g.sub.toLowerCase(), g.sub]));
    const groupOf = new Map(groups.map((g) => [`${g.sub}|${String(g.game).toLowerCase()}`, g.key]));
    const tierByMin = new Map(tiers.map((t) => [Number(t.min), t.id]));
    // Two weekdays of one day type that disagree: the later row wins.
    const seen = new Map();
    const clash = new Set();
    let lastSub = null, lastGame = null, lastScope = scope, lastScopeRaw = '';
    for (let ri = hi + 1; ri < rows.length; ri++) {
        const r = rows[ri];
        if (!r.some((c) => String(c).trim())) continue;
        const rowNo = ri + 1;
        if (col.scope >= 0 && String(r[col.scope] ?? '').trim()) {
            const sc = parseScope(r[col.scope], dayTypes, dates, dowMap);
            if (!sc) { errors.push(`Row ${rowNo}: unknown day or date "${String(r[col.scope]).trim()}".`); continue; }
            lastScope = sc;
            lastScopeRaw = String(r[col.scope]).trim();
        }
        const subRaw = String(r[col.sub] ?? '').trim();
        if (subRaw) {
            const sub = subByLow.get(subRaw.toLowerCase());
            if (!sub) { errors.push(`Row ${rowNo}: unknown sub-segment "${subRaw}".`); lastSub = null; continue; }
            if (sub !== lastSub) lastGame = null;
            lastSub = sub;
        }
        if (!lastSub) { errors.push(`Row ${rowNo}: no sub-segment.`); continue; }
        const gameRaw = String(r[col.game] ?? '').trim();
        if (gameRaw) {
            const g = groupOf.get(`${lastSub}|${gameRaw.toLowerCase()}`);
            if (!g) { errors.push(`Row ${rowNo}: ${lastSub} has no ${gameRaw} tables.`); lastGame = null; continue; }
            lastGame = g;
        }
        if (!lastGame) { errors.push(`Row ${rowNo}: no game type.`); continue; }
        const priceRaw = String(r[col.price] ?? '').trim();
        const tierId = tierByMin.get(parsePrice(priceRaw));
        if (!tierId) { errors.push(`Row ${rowNo}: ${priceRaw || '(blank)'} is not a price level.`); continue; }
        const sub = lastSub;
        if (!(ladders[sub] || []).includes(tierId) && !newPrices.some((p) => p.sub === sub && p.tierId === tierId)) newPrices.push({ sub, tierId });
        for (const { i, core } of hourCols) {
            const v = String(r[i] ?? '').trim();
            if (!v) continue;
            const n = Number(v.replace(/,/g, ''));
            if (!Number.isFinite(n) || n < 0) { errors.push(`Row ${rowNo}, ${two(core)}:00: "${v}" is not a number.`); continue; }
            const k = `${lastScope}|${lastGame}|${tierId}|${core}`;
            const before = seen.get(k);
            if (before && before.n !== Math.round(n) && before.raw !== lastScopeRaw && !clash.has(`${before.raw}|${lastScopeRaw}`)) {
                clash.add(`${before.raw}|${lastScopeRaw}`);
                errors.push(`${before.raw} and ${lastScopeRaw} are the same day type but have different numbers; ${lastScopeRaw} was used.`);
            }
            seen.set(k, { n: Math.round(n), raw: lastScopeRaw });
            const at = cells.findIndex((c) => `${c.scope}|${c.group}|${c.tierId}|${c.core}` === k);
            const cell = { scope: lastScope, group: lastGame, sub: lastSub, tierId, core, n: Math.round(n) };
            if (at >= 0) cells[at] = cell; else cells.push(cell);
        }
    }
    return { cells, newPrices, errors };
}

// The same layout, for "Copy as Excel": every scope × mix group × price.
// groups: [{ key, sub, game, segment }].
export function formatTargetsTsv({ scopes, groups, coreHours, ladders, tierById, valueOf }) {
    const label = (id) => { const t = tierById.get(id); return t ? (t.label || `$${Number(t.min).toLocaleString('en-US')}`) : id; };
    const byDate = scopes.length && String(scopes[0].id).startsWith('d:');
    const lines = [[byDate ? 'Date' : 'Day of week', 'Segment', 'Sub segment', 'Game type', 'Price', ...coreHours.map(two)].join('\t')];
    for (const s of scopes) {
        for (const g of groups) {
            for (const id of [...(ladders[g.sub] || [])].reverse()) {
                lines.push([s.label, g.segment || '', g.sub, g.game, label(id), ...coreHours.map((c) => valueOf(s.id, g.key, id, c) || 0)].join('\t'));
            }
        }
    }
    return lines.join('\n');
}

// ── One mix group's grid: a prices × core-hours block ──────────────
// Pasted into a cell of the Targets grid. Maps by price labels ($1,000 in
// the first column) and hour headers (07, 21:00, 9pm) when present; a bare
// block that is exactly prices × hours fills the whole grid; any other bare
// block fills down and right from the cell it was pasted into.
const hasLetters = (c) => /[a-z:]/i.test(String(c));
export function parseMatrix(text, { ladderDesc, coreHours, tiers, anchor }) {
    const errors = [], cells = [], newPrices = [];
    const rows = splitRows(text).map((r) => r.map((c) => c.trim()));
    const head = rows[0] || [];
    const isHeader = head.some((c) => parseHourToken(c) != null)
        && (head.some(hasLetters) || head[0] === '' || head.some((c) => /^0\d$/.test(c)));
    const data = isHeader ? rows.slice(1) : rows;
    const labeled = (isHeader && parseHourToken(head[0]) == null)
        || (data.length > 0 && data.every((r) => /\$|\dk$/i.test(r[0] || '')));
    const tierByMin = new Map(tiers.map((t) => [Number(t.min), t.id]));
    const width = Math.max(0, ...data.map((r) => r.length - (labeled ? 1 : 0)));
    const full = !labeled && data.length === ladderDesc.length && width === coreHours.length;
    const mode = labeled ? 'labeled' : full ? 'full' : 'anchor';
    // Column → core hour.
    let colCore;
    if (isHeader) {
        colCore = head.slice(labeled ? 1 : 0).map((c) => {
            const h = parseHourToken(c);
            if (h == null || !coreHours.includes(h)) { if (c) errors.push(`Column ${c} is not a core hour; it was skipped.`); return null; }
            return h;
        });
    } else {
        const start = mode === 'anchor' ? Math.max(0, coreHours.indexOf(anchor.core)) : 0;
        colCore = Array.from({ length: width }, (_, j) => coreHours[start + j] ?? null);
    }
    const rowStart = mode === 'anchor' ? Math.max(0, ladderDesc.indexOf(anchor.tierId)) : 0;
    data.forEach((r, i) => {
        let tierId, vals = r;
        if (labeled) {
            const raw = r[0] || '';
            tierId = tierByMin.get(parsePrice(raw));
            if (!tierId) { errors.push(`${raw || '(blank)'} is not a price level.`); return; }
            if (!ladderDesc.includes(tierId) && !newPrices.includes(tierId)) newPrices.push(tierId);
            vals = r.slice(1);
        } else {
            tierId = ladderDesc[rowStart + i];
            if (!tierId) return;
        }
        vals.forEach((v, j) => {
            const core = colCore[j];
            if (core == null || v === '') return;
            const n = Number(String(v).replace(/,/g, ''));
            if (!Number.isFinite(n) || n < 0) { errors.push(`"${v}" is not a number.`); return; }
            cells.push({ tierId, core, n: Math.round(n) });
        });
    });
    return { cells, newPrices, errors, mode, rows: data.length, cols: width };
}
