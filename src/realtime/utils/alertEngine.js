// Surveillance alert engine.
// ==========================
// A pure function over the polled feeds: no React, no charts, no
// fetching. Given tables + patrons and a threshold config it returns a
// sorted Alert[]. That shape is deliberate — the rules are the part
// most likely to need tuning and testing, so they are kept free of any
// rendering concern.
//
// Thresholds live in constants/rtConfig.js (ALERT_RULES) so they can be
// retuned without touching this logic.
//
// The four rules map to the three things surveillance actually watches
// for, per the design conversation:
//
//   big win/loss           → TABLE_LOSS, PATRON_WIN
//   negative house edge    → NEG_EDGE
//   patrons worth tracing  → BET_SPREAD
//
// SIGN CONVENTION: every feed is casino-perspective (positive = house
// won). So a patron winning big shows as a NEGATIVE cum_win, and the
// PATRON_WIN rule tests for values BELOW its threshold. See §0 of
// docs/realtime-surveillance-data-contract.md.

import { ALERT_RULES, ALERT_SEVERITY, HOUSE_EDGE_OPTIONS } from '../constants/rtConfig';

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

// Bet-option keys that carry a house_edge_<key> column.
const EDGE_KEYS = HOUSE_EDGE_OPTIONS.filter((o) => o.key !== 'lowest').map((o) => o.key);

const fmtMoney = (v) => {
    const a = Math.abs(v);
    const s = v < 0 ? '-' : '';
    if (a >= 1e6) return `${s}$${(a / 1e6).toFixed(2)}M`;
    if (a >= 1e3) return `${s}$${(a / 1e3).toFixed(0)}K`;
    return `${s}$${a.toFixed(0)}`;
};

/**
 * @param {object[]} tables  rows from GET /realtime
 * @param {object[]} patrons rows from GET /realtime/patrons
 * @param {object}   rules   threshold config (defaults to ALERT_RULES)
 * @returns {object[]} alerts, most severe first
 */
export function evaluateAlerts(tables = [], patrons = [], rules = ALERT_RULES) {
    const alerts = [];

    // ── Table-grain rules ────────────────────────────────────────────
    for (const t of tables) {
        const tableKey = `${t.gametype}|${t.table}`;

        // NEG_EDGE — the shoe has turned in the player's favour. The
        // primary advantage-play signal, so it sorts first.
        //
        // Guarded on shoe hands rather than day hands: edge is a
        // per-shoe property, and a freshly-shuffled shoe reporting a
        // wild edge off three hands is noise, not a counter.
        const negRule = rules.NEG_EDGE;
        if (negRule) {
            const shoeHands = num(t.shoe_hands_dealt);
            if (shoeHands == null || shoeHands >= negRule.minShoeHands) {
                let worstKey = null, worstVal = null;
                for (const k of EDGE_KEYS) {
                    const v = num(t['house_edge_' + k]);
                    if (v == null) continue;               // bet not offered here
                    if (v < negRule.edgeBelow && (worstVal == null || v < worstVal)) {
                        worstVal = v; worstKey = k;
                    }
                }
                if (worstKey) {
                    const label = (HOUSE_EDGE_OPTIONS.find((o) => o.key === worstKey) || {}).label || worstKey;
                    alerts.push({
                        id: `NEG_EDGE:${tableKey}:${worstKey}`,
                        rule: 'NEG_EDGE',
                        label: negRule.label,
                        tableKey,
                        patronId: null,
                        value: worstVal,
                        headline: tableKey,
                        detail: `${label} edge ${worstVal.toFixed(2)}%`
                            + (t.shoe_id ? ` · shoe ${t.shoe_id}` : ''),
                    });
                }
            }
        }

        // TABLE_LOSS — the table is down beyond tolerance on the day.
        const lossRule = rules.TABLE_LOSS;
        if (lossRule) {
            const win = num(t.win);
            const hands = num(t.hands) ?? num(t.game_count);
            if (win != null && win < lossRule.winBelow && (hands == null || hands >= lossRule.minHands)) {
                const seated = num(t.avg_headcount_10m);
                alerts.push({
                    id: `TABLE_LOSS:${tableKey}`,
                    rule: 'TABLE_LOSS',
                    label: lossRule.label,
                    tableKey,
                    patronId: null,
                    value: win,
                    headline: tableKey,
                    detail: `Casino Win ${fmtMoney(win)} today`
                        + (seated != null && seated > 0 ? ` · ${seated.toFixed(1)} seated` : ''),
                });
            }
        }
    }

    // ── Patron-grain rules ───────────────────────────────────────────
    for (const p of patrons) {
        const pid = p.patron_id;

        // PATRON_WIN — casino-perspective, so "patron winning" is a
        // large NEGATIVE cum_win.
        const winRule = rules.PATRON_WIN;
        if (winRule) {
            const cw = num(p.cum_win);
            const hands = num(p.hands);
            if (cw != null && cw < winRule.cumWinBelow && (hands == null || hands >= winRule.minHands)) {
                alerts.push({
                    id: `PATRON_WIN:${pid}`,
                    rule: 'PATRON_WIN',
                    label: winRule.label,
                    tableKey: p.current_table_key || null,
                    patronId: pid,
                    value: cw,
                    headline: pid,
                    // Reported from the patron's point of view, because
                    // that is how an operator would say it out loud.
                    detail: `Patron Win +${fmtMoney(-cw)} · ${p.card_type || '—'}`
                        + (p.tables_played ? ` · ${p.tables_played} tables` : ''),
                });
            }
        }

        // BET_SPREAD — flat betting until the count turns, then a jump.
        // This is the COEFFICIENT OF VARIATION (stdev ÷ mean), not the
        // max/min "bet spread" surveillance usually quotes — see the
        // threshold note in rtConfig.js ALERT_RULES.BET_SPREAD.
        const spreadRule = rules.BET_SPREAD;
        if (spreadRule) {
            const hands = num(p.hands);
            const handsOk = hands == null || hands >= spreadRule.minHands;

            // Prefer the TRUE spread (max ÷ min bet) when the feed carries
            // it — that is the metric surveillance works to, and the one
            // Player360Panel already shows. Fall back to the coefficient
            // of variation when it does not.
            const minBet = num(p.min_bet);
            const maxBet = num(p.max_bet);
            const sd = num(p.bet_stdev);
            const avg = num(p.avg_bet);

            let ratio = null, threshold = null, isTrue = false;
            if (minBet != null && maxBet != null && minBet > 0) {
                ratio = maxBet / minBet;
                threshold = spreadRule.trueRatioAbove;
                isTrue = true;
            } else if (sd != null && avg != null && avg > 0) {
                ratio = sd / avg;
                threshold = spreadRule.ratioAbove;
            }

            if (ratio != null && handsOk && ratio > threshold) {
                alerts.push({
                    id: `BET_SPREAD:${pid}`,
                    rule: 'BET_SPREAD',
                    label: spreadRule.label,
                    tableKey: p.current_table_key || null,
                    patronId: pid,
                    value: ratio,
                    headline: pid,
                    // Labelled so nobody reads a CV as though it were a
                    // max/min ratio — they differ by roughly 10×.
                    detail: (isTrue ? `spread ${ratio.toFixed(0)}:1` : `bet CV ${ratio.toFixed(1)}`)
                        + ` · ${p.card_type || '—'}`
                        + (p.tables_played ? ` · ${p.tables_played} tables` : ''),
                });
            }
        }
    }

    // Severity first, then by magnitude within a rule so the worst
    // offender of each kind leads.
    alerts.sort((a, b) => {
        const s = (ALERT_SEVERITY[a.rule] ?? 99) - (ALERT_SEVERITY[b.rule] ?? 99);
        if (s !== 0) return s;
        return Math.abs(b.value ?? 0) - Math.abs(a.value ?? 0);
    });

    return alerts;
}

// Counts by rule, for the summary tile and tab badges.
export function alertCounts(alerts = []) {
    const out = { total: alerts.length };
    for (const a of alerts) out[a.rule] = (out[a.rule] || 0) + 1;
    return out;
}

// Set of tableKeys with at least one alert — the map uses this to ring
// the offending tables.
export function alertingTableKeys(alerts = []) {
    return new Set(alerts.map((a) => a.tableKey).filter(Boolean));
}
