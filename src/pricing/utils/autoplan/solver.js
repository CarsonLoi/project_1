// Auto-plan solver — one core-hour block at a time, as a min-cost flow:
//   source → table → (pod rule node) → (sub-segment × price, cap = target) → sink
// The change weight dominates every other term, so each block keeps the
// most tables at their parent hour's price that the targets and rules allow;
// the per-level step keeps forced changes to the closest price; the smaller
// terms decide WHICH tables move. Pod minimums are exact: their first units
// carry a large negative cost, so the flow fills them whenever it can.

export function MCMF(n) {
    const g = Array.from({ length: n }, () => []);
    return {
        add(u, v, cap, cost) {
            g[u].push({ v, cap, cost, rev: g[v].length });
            g[v].push({ v: u, cap: 0, cost: -cost, rev: g[u].length - 1 });
            return g[u][g[u].length - 1];
        },
        run(s, t, need) {
            let flow = 0;
            const dist = new Float64Array(n), inq = new Uint8Array(n), pv = new Int32Array(n), pe = new Int32Array(n);
            while (flow < need) {
                dist.fill(Infinity); dist[s] = 0; inq.fill(0);
                const q = [s]; inq[s] = 1;
                for (let qi = 0; qi < q.length; qi++) {
                    const u = q[qi]; inq[u] = 0;
                    for (let i = 0; i < g[u].length; i++) {
                        const e = g[u][i];
                        if (e.cap > 0 && dist[u] + e.cost < dist[e.v] - 1e-9) {
                            dist[e.v] = dist[u] + e.cost; pv[e.v] = u; pe[e.v] = i;
                            if (!inq[e.v]) { inq[e.v] = 1; q.push(e.v); }
                        }
                    }
                }
                if (dist[t] === Infinity) break;
                let f = need - flow;
                for (let v = t; v !== s; v = pv[v]) f = Math.min(f, g[pv[v]][pe[v]].cap);
                for (let v = t; v !== s; v = pv[v]) { const e = g[pv[v]][pe[v]]; e.cap -= f; g[v][e.rev].cap += f; }
                flow += f;
            }
            return flow;
        },
    };
}

export function inScope(t, scope) {
    if (!scope || scope === 'all') return true;
    const [kind, val] = [scope.slice(0, scope.indexOf(':')), scope.slice(scope.indexOf(':') + 1)];
    if (kind === 'sub') return t.sub === val;
    if (kind === 'gt') return t.gametype === val;
    if (kind === 'zone') return t.zone === val;
    if (kind === 'table') return t.key === val;
    if (kind === 'tables') return val.split(',').includes(t.key);
    return false;
}
export const rulesFor = (rules, core) => (rules || []).filter((r) => r.on && (r.hours || []).includes(core));

const BIG = 1e8;

// Tier limits a sub-segment's pod maximums allow in total (pods × max).
export function capsForSub(rules, openTables, sub) {
    const caps = new Map();
    const ts = openTables.filter((t) => t.sub === sub);
    for (const r of rules) {
        if (r.type !== 'zonecap' || r.maxOn === false) continue;
        const zones = new Set(ts.filter((t) => inScope(t, r.scope)).map((t) => t.zone));
        if (!zones.size) continue;
        const inScopeAll = ts.every((t) => inScope(t, r.scope));
        if (!inScopeAll) continue;              // partial scopes can't be summarised safely
        const lim = zones.size * r.n;
        caps.set(r.tier, Math.min(caps.get(r.tier) ?? Infinity, lim));
    }
    return caps;
}

// Tables a sub-segment's pod minimums need at a price (Σ pods min(min, pod size)).
export function floorsForSub(rules, openTables, sub) {
    const floors = new Map();
    const ts = openTables.filter((t) => t.sub === sub);
    for (const r of rules) {
        if (r.type !== 'zonecap' || !r.minOn || !(r.min > 0)) continue;
        const byZone = new Map();
        for (const t of ts) if (inScope(t, r.scope)) byZone.set(t.zone, (byZone.get(t.zone) || 0) + 1);
        let need = 0;
        for (const n of byZone.values()) need += Math.min(r.min, n);
        if (need) floors.set(r.tier, Math.max(floors.get(r.tier) || 0, need));
    }
    return floors;
}

// Points for taking price level k when the parent hour had level pk.
// direction: 'fwd' = time runs parent → this hour; 'back' = this hour → parent.
export function changeCost(W, { k, pk, direction = 'fwd', scale = 1 }) {
    if (pk == null || k === pk) return 0;
    let c = W.change * scale + W.step * Math.abs(k - pk);
    const up = direction === 'back' ? pk > k : k > pk;
    if (up) c += W.raise || 0;
    return c;
}

export function changesBetween(a, b) {
    const out = [];
    for (const [k, to] of b) if (a && a.has(k) && a.get(k) !== to) out.push({ key: k, from: a.get(k), to });
    return out;
}

// Fewest changes the targets allow (rules ignored): per sub-segment, tables
// open in both blocks minus those that can keep their price.
export function lowerBound(prev, targets, openTables) {
    if (!prev) return 0;
    let lb = 0;
    const bySub = new Map();
    for (const t of openTables) {
        if (!prev.has(t.key)) continue;
        if (!bySub.has(t.sub)) bySub.set(t.sub, {});
        const c = bySub.get(t.sub);
        c[prev.get(t.key)] = (c[prev.get(t.key)] || 0) + 1;
    }
    for (const [sub, c] of bySub) {
        const tg = targets[sub] || {};
        let both = 0, keep = 0;
        for (const [id, n] of Object.entries(c)) { both += n; keep += Math.min(n, tg[id] || 0); }
        lb += both - keep;
    }
    return lb;
}

// Pinned tables take their slot: raise the pinned price's target and take
// the table from the price with the most unpinned room.
function accommodatePins(targets, pins, openTables, tierLabel = (id) => id) {
    const out = {};
    const notes = [];
    for (const sub of Object.keys(targets)) out[sub] = { ...targets[sub] };
    const pinCount = {};
    for (const t of openTables) {
        if (!pins.has(t.key)) continue;
        const id = pins.get(t.key);
        pinCount[t.sub] = pinCount[t.sub] || {};
        pinCount[t.sub][id] = (pinCount[t.sub][id] || 0) + 1;
    }
    for (const [sub, pc] of Object.entries(pinCount)) {
        const tg = out[sub] || (out[sub] = {});
        for (const [id, n] of Object.entries(pc)) {
            let need = n - (tg[id] || 0);
            if (need <= 0) continue;
            tg[id] = n;
            const moved = need;
            while (need > 0) {
                let best = null, room = 0;
                for (const [oid, c] of Object.entries(tg)) {
                    if (oid === id) continue;
                    const r = c - ((pc[oid]) || 0);
                    if (r > room) { room = r; best = oid; }
                }
                if (!best) break;
                tg[best] -= 1; need -= 1;
            }
            notes.push(`${sub}: ${moved} target table${moved === 1 ? '' : 's'} moved to ${tierLabel(id)} for locked or manual prices`);
        }
    }
    return { targets: out, notes };
}

// Tables whose price changed in the last n transitions of a chain of
// assignments (oldest → newest).
export function recentChanges(chain, n) {
    const out = new Set();
    for (let j = chain.length - 1; j >= 1 && j >= chain.length - n; j--) {
        const a = chain[j - 1], b = chain[j];
        if (!a || !b) continue;
        for (const [k, id] of b) if (a.has(k) && a.get(k) !== id) out.add(k);
    }
    return out;
}

export function solveBlock({
    tables, targets, ladders, tierIndex, prev = null, current = null, shares = null,
    pins = new Map(), rules = [], weights, sticky = true, recentChanged = null,
    direction = 'fwd', changeScale = 1, podPenalty = null, night = null, tierLabel = (id) => id,
}) {
    const W = weights;
    const { targets: tg, notes } = accommodatePins(targets, pins, tables, tierLabel);
    // Price each table's performance rank implies, given the targets.
    const rankLvl = new Map();
    for (const sub of Object.keys(ladders)) {
        const ts = tables.filter((t) => t.sub === sub).sort((a, b) => (b.value || 0) - (a.value || 0));
        const slots = [];
        for (const id of [...ladders[sub]].reverse()) for (let i = 0; i < ((tg[sub] || {})[id] || 0); i++) slots.push(id);
        ts.forEach((t, i) => rankLvl.set(t.key, tierIndex.get(slots[Math.min(i, slots.length - 1)] ?? ladders[sub][0])));
    }
    let N = 2;
    const tNode = new Map(tables.map((t) => [t.key, N++]));
    const lNode = new Map();
    for (const sub of Object.keys(ladders)) for (const id of ladders[sub]) lNode.set(`${sub}|${id}`, N++);
    // Pod rule nodes: one per pod × price × sub-segment a rule covers.
    const caps = new Map();
    for (const r of rules.filter((x) => x.type === 'zonecap' && (x.maxOn !== false || (x.minOn && x.min > 0)))) {
        for (const t of tables) {
            if (!inScope(t, r.scope)) continue;
            const k = `${t.zone}|${r.tier}|${t.sub}`;
            let c = caps.get(k);
            if (!c) { c = { node: N++, n: Infinity, min: 0, size: 0, zone: t.zone, sub: t.sub, tier: r.tier, keys: new Set() }; caps.set(k, c); }
            if (r.maxOn !== false) c.n = Math.min(c.n, r.n);
            if (r.minOn && r.min > 0) c.min = Math.max(c.min, r.min);
            if (!c.keys.has(t.key)) { c.keys.add(t.key); c.size += 1; }
        }
    }
    const f = MCMF(N);
    const arcsBy = new Map();
    const unplaced = [];
    for (const t of tables) {
        const u = tNode.get(t.key);
        f.add(0, u, 1, 0);
        const p = prev ? prev.get(t.key) : undefined;
        const pinned = pins.has(t.key);
        let allowed = [...(ladders[t.sub] || [])];
        for (const r of rules) {
            if (!inScope(t, r.scope)) continue;
            if (r.type === 'range') allowed = allowed.filter((id) => tierIndex.get(id) >= tierIndex.get(r.lo) && tierIndex.get(id) <= tierIndex.get(r.hi));
            if (r.type === 'lock') allowed = [r.tier];
            if (r.type === 'maxstep' && sticky && p != null && !pinned) allowed = allowed.filter((id) => Math.abs(tierIndex.get(id) - tierIndex.get(p)) <= r.n);
        }
        if (pinned) allowed = [pins.get(t.key)];
        allowed = allowed.filter((id) => lNode.has(`${t.sub}|${id}`));
        if (!allowed.length) { unplaced.push(t.key); continue; }
        const sh = shares ? shares.get(t.key) || {} : {};
        const arcs = [];
        for (const id of allowed) {
            const k = tierIndex.get(id);
            let c = W.rank * Math.abs(k - (rankLvl.get(t.key) ?? k)) + Math.round(W.hist * (1 - (sh[id] || 0)));
            if (sticky && p != null && id !== p) {
                c += changeCost(W, { k, pk: tierIndex.get(p), direction, scale: changeScale });
                // Minimum hold: changing again soon after the last change.
                if (recentChanged && recentChanged.has(t.key)) c += W.hold || 0;
                if (podPenalty && podPenalty.get(t.zone)) c += podPenalty.get(t.zone);
            }
            if (current && current.has(t.key) && current.get(t.key) !== id) c += W.stay;
            // First core hour: prefer the price the table ended on last night.
            if (night && night.has(t.key) && night.get(t.key) !== id) c += W.night || 0;
            const cap = caps.get(`${t.zone}|${id}|${t.sub}`);
            arcs.push([id, f.add(u, cap ? cap.node : lNode.get(`${t.sub}|${id}`), 1, c)]);
        }
        arcsBy.set(t.key, arcs);
    }
    for (const c of caps.values()) {
        const lvl = lNode.get(`${c.sub}|${c.tier}`);
        if (lvl == null) continue;
        const max = Math.min(c.n, c.size);
        const min = Math.min(c.min, max);
        if (min > 0) f.add(c.node, lvl, min, -BIG);
        if (max - min > 0) f.add(c.node, lvl, max - min, 0);
    }
    for (const sub of Object.keys(ladders)) for (const id of ladders[sub]) f.add(lNode.get(`${sub}|${id}`), 1, (tg[sub] || {})[id] || 0, 0);
    const flow = f.run(0, 1, tables.length);
    const assign = new Map();
    for (const [key, arcs] of arcsBy) for (const [id, e] of arcs) if (e.cap === 0) assign.set(key, id);
    for (const t of tables) if (!assign.has(t.key) && !unplaced.includes(t.key)) unplaced.push(t.key);
    // Pod minimums the flow could not meet (not enough open tables or slots).
    const podShort = [];
    for (const c of caps.values()) {
        if (!c.min) continue;
        const have = [...c.keys].filter((k) => assign.get(k) === c.tier).length;
        if (have < Math.min(c.min, c.size)) podShort.push({ zone: c.zone, sub: c.sub, tier: c.tier, have, min: c.min });
    }
    return { assign, ok: flow === tables.length && !unplaced.length, unplaced, notes, targets: tg, podShort };
}

// Why a block can't be solved — the clashes a person can fix.
export function diagnose({ tables, targets, rules, pins = new Map(), tierLabel = (id) => id }) {
    const out = [];
    const subs = new Set(tables.map((t) => t.sub));
    for (const sub of subs) {
        const ts = tables.filter((t) => t.sub === sub);
        const tot = Object.values(targets[sub] || {}).reduce((a, b) => a + b, 0);
        if (tot !== ts.length) out.push(`${sub}: targets add up to ${tot} but ${ts.length} tables are open`);
        for (const r of rules.filter((x) => x.type === 'zonecap' && x.maxOn !== false)) {
            const zs = new Set(ts.filter((t) => inScope(t, r.scope)).map((t) => t.zone));
            const want = (targets[sub] || {})[r.tier] || 0;
            if (zs.size && ts.every((t) => inScope(t, r.scope)) && want > zs.size * r.n) out.push(`${sub}: target ${want} × ${tierLabel(r.tier)} but "max ${r.n} per zone" allows ${zs.size * r.n}`);
            const perZone = {};
            for (const t of ts) if (inScope(t, r.scope) && pins.get(t.key) === r.tier) perZone[t.zone] = (perZone[t.zone] || 0) + 1;
            for (const [z, c] of Object.entries(perZone)) if (c > r.n) out.push(`${sub} zone ${z}: ${c} pinned at ${tierLabel(r.tier)} but the cap is ${r.n}`);
        }
    }
    for (const t of tables) {
        if (!pins.has(t.key)) continue;
        for (const r of rules) {
            if (!inScope(t, r.scope)) continue;
            if (r.type === 'lock' && r.tier !== pins.get(t.key)) out.push(`${t.key}: pinned at ${tierLabel(pins.get(t.key))} but locked at ${tierLabel(r.tier)}`);
        }
    }
    return out;
}
