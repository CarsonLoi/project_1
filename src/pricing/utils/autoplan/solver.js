// Auto-plan solver — one core-hour block at a time, as a min-cost flow:
//   source → table → (pod rule cell) → (mix group × price, cap = target) → sink
// A mix group is a sub-segment × game type: a table only fills its own game
// type's targets. The change weight dominates every other term, so each
// block keeps the most tables at their parent hour's price that the targets
// and rules allow; the per-level step keeps forced changes to the closest
// price; the smaller terms decide WHICH tables move. Pod minimums are exact:
// their first units carry a large negative cost, so the flow fills them
// whenever it can. A pod holding several game types shares its limit: a
// first pass lets each game type use the whole limit, then the limit is
// split between them (keeping that first placement where it fits) and the
// block is solved again with those exact shares.

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
// The mix group a table plans in (sub-segment × game type; the sub-segment
// alone for callers without game types).
export const groupOf = (t) => t.grp ?? t.sub;
const groupName = (g) => String(g).replace('|', ' · ');

// Tier limits a mix group's pod maximums allow in total (its pods × max).
// Game types sharing a pod share its limit, so this is an upper bound.
export function capsForSub(rules, openTables, group) {
    const caps = new Map();
    const ts = openTables.filter((t) => groupOf(t) === group);
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

// Tables a mix group's pod minimums need at a price. A pod's minimum
// (min(min, pod size)) goes to its game types largest first, so the
// groups' floors add up to exactly what the pods need.
export function floorsForSub(rules, openTables, group) {
    const floors = new Map();
    for (const r of rules) {
        if (r.type !== 'zonecap' || !r.minOn || !(r.min > 0)) continue;
        const byZone = new Map();
        for (const t of openTables) {
            if (!inScope(t, r.scope)) continue;
            if (!byZone.has(t.zone)) byZone.set(t.zone, new Map());
            const z = byZone.get(t.zone), g = groupOf(t);
            z.set(g, (z.get(g) || 0) + 1);
        }
        let need = 0;
        for (const z of byZone.values()) {
            if (!z.has(group)) continue;
            let left = Math.min(r.min, [...z.values()].reduce((x, y) => x + y, 0));
            for (const [g, n] of [...z].sort((x, y) => y[1] - x[1] || (x[0] < y[0] ? -1 : 1))) {
                const take = Math.min(n, left);
                left -= take;
                if (g === group) need += take;
            }
        }
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

// Fewest changes the targets allow (rules ignored): per mix group, tables
// open in both blocks minus those that can keep their price.
export function lowerBound(prev, targets, openTables) {
    if (!prev) return 0;
    let lb = 0;
    const bySub = new Map();
    for (const t of openTables) {
        if (!prev.has(t.key)) continue;
        const g = groupOf(t);
        if (!bySub.has(g)) bySub.set(g, {});
        const c = bySub.get(g);
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
        const id = pins.get(t.key), g = groupOf(t);
        pinCount[g] = pinCount[g] || {};
        pinCount[g][id] = (pinCount[g][id] || 0) + 1;
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
            notes.push(`${groupName(sub)}: ${moved} target table${moved === 1 ? '' : 's'} moved to ${tierLabel(id)} for locked or manual prices`);
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
    exempt = null,
}) {
    const W = weights;
    const { targets: tg, notes } = accommodatePins(targets, pins, tables, tierLabel);
    // Price each table's performance rank implies, given its group's targets.
    const rankLvl = new Map();
    for (const g of Object.keys(ladders)) {
        const ts = tables.filter((t) => groupOf(t) === g).sort((a, b) => (b.value || 0) - (a.value || 0));
        const slots = [];
        for (const id of [...ladders[g]].reverse()) for (let i = 0; i < ((tg[g] || {})[id] || 0); i++) slots.push(id);
        ts.forEach((t, i) => rankLvl.set(t.key, tierIndex.get(slots[Math.min(i, slots.length - 1)] ?? ladders[g][0])));
    }
    // Pods: one per pod × price × sub-segment a pod rule covers, its tables
    // grouped by game type (one cell each).
    const pods = new Map();
    for (const r of rules.filter((x) => x.type === 'zonecap' && (x.maxOn !== false || (x.minOn && x.min > 0)))) {
        for (const t of tables) {
            if (!inScope(t, r.scope)) continue;
            // A table exempt from this pod rule neither uses nor fills its slots.
            const ex = exempt && exempt.get(t.key);
            if (ex && (ex.includes('*') || ex.includes(r.id))) continue;
            const k = `${t.zone}|${r.tier}|${t.sub}`;
            let c = pods.get(k);
            if (!c) { c = { key: k, n: Infinity, min: 0, size: 0, zone: t.zone, sub: t.sub, tier: r.tier, keys: new Set(), byGroup: new Map() }; pods.set(k, c); }
            if (r.maxOn !== false) c.n = Math.min(c.n, r.n);
            if (r.minOn && r.min > 0) c.min = Math.max(c.min, r.min);
            if (!c.keys.has(t.key)) {
                c.keys.add(t.key); c.size += 1;
                const g = groupOf(t);
                if (!c.byGroup.has(g)) c.byGroup.set(g, []);
                c.byGroup.get(g).push(t.key);
            }
        }
    }
    const podOf = (t, id) => { const c = pods.get(`${t.zone}|${id}|${t.sub}`); return c && c.keys.has(t.key) ? c : null; };
    // Each table's prices and their costs (the same in both passes).
    const unplaced = [];
    const options = [];
    for (const t of tables) {
        const p = prev ? prev.get(t.key) : undefined;
        const pinned = pins.has(t.key);
        const ladder = ladders[groupOf(t)] || [];
        let allowed = [...ladder];
        for (const r of rules) {
            if (!inScope(t, r.scope)) continue;
            if (r.type === 'range') allowed = allowed.filter((id) => tierIndex.get(id) >= tierIndex.get(r.lo) && tierIndex.get(id) <= tierIndex.get(r.hi));
            if (r.type === 'lock') allowed = [r.tier];
            if (r.type === 'maxstep' && sticky && p != null && !pinned) allowed = allowed.filter((id) => Math.abs(tierIndex.get(id) - tierIndex.get(p)) <= r.n);
        }
        if (pinned) allowed = [pins.get(t.key)];
        allowed = allowed.filter((id) => ladder.includes(id));
        if (!allowed.length) { unplaced.push(t.key); continue; }
        const sh = shares ? shares.get(t.key) || {} : {};
        const opts = [];
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
            opts.push([id, c]);
        }
        options.push([t, opts]);
    }

    // One flow. share: null = each game type may use a shared pod's whole
    // limit (first pass); else pod key → game type → its exact tables.
    const runFlow = (share) => {
        let N = 2;
        const tNode = new Map(tables.map((t) => [t.key, N++]));
        const lNode = new Map();
        for (const g of Object.keys(ladders)) for (const id of ladders[g]) lNode.set(`${g}|${id}`, N++);
        const cellNode = new Map();
        for (const c of pods.values()) for (const g of c.byGroup.keys()) cellNode.set(`${c.key}|${g}`, N++);
        const f = MCMF(N);
        const arcsBy = new Map();
        for (const [t, opts] of options) {
            const u = tNode.get(t.key);
            f.add(0, u, 1, 0);
            const g = groupOf(t);
            arcsBy.set(t.key, opts.map(([id, c]) => {
                const pod = podOf(t, id);
                return [id, f.add(u, pod ? cellNode.get(`${pod.key}|${g}`) : lNode.get(`${g}|${id}`), 1, c)];
            }));
        }
        for (const c of pods.values()) {
            const max = Math.min(c.n, c.size);
            for (const [g, keys] of c.byGroup) {
                const node = cellNode.get(`${c.key}|${g}`), lvl = lNode.get(`${g}|${c.tier}`);
                if (lvl == null) continue;
                if (c.byGroup.size === 1) {
                    const min = Math.min(c.min, max);
                    if (min > 0) f.add(node, lvl, min, -BIG);
                    if (max - min > 0) f.add(node, lvl, max - min, 0);
                } else if (!share) {
                    f.add(node, lvl, Math.min(max, keys.length), 0);
                } else {
                    const q = (share.get(c.key) || new Map()).get(g) || 0;
                    if (q > 0) f.add(node, lvl, q, -BIG);
                }
            }
        }
        for (const g of Object.keys(ladders)) for (const id of ladders[g]) f.add(lNode.get(`${g}|${id}`), 1, (tg[g] || {})[id] || 0, 0);
        const flow = f.run(0, 1, tables.length);
        const assign = new Map();
        for (const [key, arcs] of arcsBy) for (const [id, e] of arcs) if (e.cap === 0) assign.set(key, id);
        return { flow, assign };
    };

    let { flow, assign } = runFlow(null);
    const shared = [...pods.values()].filter((c) => c.byGroup.size > 1);
    if (shared.length) ({ flow, assign } = runFlow(splitPods(shared, assign, pins)));
    for (const t of tables) if (!assign.has(t.key) && !unplaced.includes(t.key)) unplaced.push(t.key);
    // Pod minimums the flow could not meet (not enough open tables or slots).
    const podShort = [];
    for (const c of pods.values()) {
        if (!c.min) continue;
        const have = [...c.keys].filter((k) => assign.get(k) === c.tier).length;
        if (have < Math.min(c.min, c.size)) podShort.push({ zone: c.zone, sub: c.sub, tier: c.tier, have, min: c.min });
    }
    return { assign, ok: flow === tables.length && !unplaced.length, unplaced, notes, targets: tg, podShort };
}

// Split shared pods' limits between their game types. Per price ×
// sub-segment, each game type keeps as many tables at that price in these
// pods as the first pass gave it, placed by a small flow: game type → pod
// (pinned tables first, then the pods the first pass used) → pod limit
// (minimums first). Returns pod key → game type → tables at the pod's price.
export function splitPods(shared, assign, pins = new Map()) {
    const out = new Map();
    const families = new Map();
    for (const c of shared) {
        const k = `${c.tier}|${c.sub}`;
        if (!families.has(k)) families.set(k, []);
        families.get(k).push(c);
    }
    for (const fam of families.values()) {
        const tier = fam[0].tier;
        const groups = [...new Set(fam.flatMap((c) => [...c.byGroup.keys()]))];
        let N = 2;
        const gNode = new Map(groups.map((g) => [g, N++]));
        const pNode = new Map(fam.map((c) => [c.key, N++]));
        const f = MCMF(N);
        const arcs = [];
        let need = 0;
        const arc = (pk, g, cap, cost) => { if (cap > 0) arcs.push([pk, g, cap, f.add(gNode.get(g), pNode.get(pk), cap, cost)]); };
        for (const g of groups) {
            const d = fam.reduce((a, c) => a + (c.byGroup.get(g) || []).filter((k) => assign.get(k) === tier).length, 0);
            if (!d) continue;
            need += d;
            f.add(0, gNode.get(g), d, 0);
            for (const c of fam) {
                const keys = c.byGroup.get(g) || [];
                // Tables pinned at another price can't take this one.
                const free = keys.filter((k) => !pins.has(k) || pins.get(k) === tier).length;
                const pinned = keys.filter((k) => pins.get(k) === tier).length;
                const used = Math.max(pinned, keys.filter((k) => assign.get(k) === tier).length);
                arc(c.key, g, pinned, -BIG);
                arc(c.key, g, used - pinned, 0);
                arc(c.key, g, free - used, 1);
            }
        }
        for (const c of fam) {
            const max = Math.min(c.n, c.size);
            const min = Math.min(c.min, max);
            if (min > 0) f.add(pNode.get(c.key), 1, min, -BIG);
            if (max - min > 0) f.add(pNode.get(c.key), 1, max - min, 0);
        }
        f.run(0, 1, need);
        for (const [pk, g, cap, e] of arcs) {
            const used = cap - e.cap;
            if (!used) continue;
            if (!out.has(pk)) out.set(pk, new Map());
            out.get(pk).set(g, (out.get(pk).get(g) || 0) + used);
        }
    }
    return out;
}

// Why a block can't be solved — the clashes a person can fix.
export function diagnose({ tables, targets, rules, pins = new Map(), tierLabel = (id) => id }) {
    const out = [];
    for (const g of new Set(tables.map(groupOf))) {
        const n = tables.filter((t) => groupOf(t) === g).length;
        const tot = Object.values(targets[g] || {}).reduce((a, b) => a + b, 0);
        if (tot !== n) out.push(`${groupName(g)}: targets add up to ${tot} but ${n} tables are open`);
    }
    // Pod limits are shared by a sub-segment's game types.
    for (const sub of new Set(tables.map((t) => t.sub))) {
        const ts = tables.filter((t) => t.sub === sub);
        const groups = [...new Set(ts.map(groupOf))];
        for (const r of rules.filter((x) => x.type === 'zonecap' && x.maxOn !== false)) {
            const zs = new Set(ts.filter((t) => inScope(t, r.scope)).map((t) => t.zone));
            const want = groups.reduce((a, g) => a + ((targets[g] || {})[r.tier] || 0), 0);
            if (zs.size && ts.every((t) => inScope(t, r.scope)) && want > zs.size * r.n) out.push(`${sub}: targets need ${want} × ${tierLabel(r.tier)} but "max ${r.n} per pod" allows ${zs.size * r.n}`);
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
