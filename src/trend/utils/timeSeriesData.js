import { buildFloor } from './floorLayout';
import { analyzeHand } from './trendAnalyzer';

function mulberry32(seed) {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = t;
    r = Math.imul(r ^ (r >>> 15), r | 1);
    r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

// Generate a per-minute simulation:
// Returns { tables: [...static info], frames: [ {minute, perTable: [{tableId, headcount, surprise, ...}]} ] }
export function generateTimeSeries({
  minutes = 180,
  seed = 1,
  startHour = 19,
} = {}) {
  const rand = mulberry32(seed);
  const tables = buildFloor();

  // Per-table runtime state.
  //
  // `priorHistory12` etc. mirror the prior-12-hand snapshot that the
  // real walker path (transformWalkerHands) captures BEFORE appending
  // each new hand result. Keeping the two paths in sync means the
  // tooltip + analytics overlay see the same field shape regardless
  // of whether the dashboard is in demo or live mode — if these
  // weren't emitted here, the tooltip's "Visible Trend" + mini Big
  // Road would render empty whenever the synthetic generator is in
  // use. See trendDataSource.js for the canonical implementation.
  const state = tables.map((t) => ({
    ...t,
    history: '',
    shoeHistory: '',
    headcount: 1 + Math.floor(rand() * 3),
    shoeId: 1,
    shoeHand: 0,
    lastSurprise: 0,
    priorHistory12: '',
    priorSurprise: 0,
    priorPeriod: 0,
    priorLength: 0,
    priorMotif: '',
  }));

  // Same hot / warm / cool bucketing as trendDataSource.js. Duplicated
  // (rather than extracted) because it's a one-line rule and keeping
  // it inline avoids a cross-file dependency for two demo/live paths
  // that already track each other field-by-field.
  const trendStatusFor = (surprise) =>
    surprise >= 5 ? 'hot' : surprise >= 3 ? 'warm' : 'cool';

  const frames = [];

  for (let m = 0; m < minutes; m++) {
    const hour = (startHour + Math.floor(m / 60)) % 24;
    // Floor-wide busy-ness wave (more activity 21:00-02:00)
    const wave =
      0.55 +
      0.45 *
        Math.max(
          0,
          Math.cos(((hour - 23) / 3) * Math.PI * 0.6)
        );

    const perTable = state.map((t) => {
      // ~1 hand per minute average, scaled by tier; VIP slower
      const handProb = t.min >= 1000 ? 0.55 : t.min >= 300 ? 0.75 : 0.9;
      const hasHand = rand() < handProb;

      if (hasHand) {
        if (t.shoeHand >= 65 + Math.floor(rand() * 10)) {
          t.shoeId += 1;
          t.shoeHand = 0;
          t.history = '';
          t.shoeHistory = '';
        }

        // Bias toward trends so visualization is interesting
        let pB = 0.5068;
        const bias = rand();
        if (bias < 0.18) pB = 0.85;
        else if (bias < 0.30) pB = 0.15;
        const flipChop = rand() < 0.12 && t.history.length > 0;
        let r;
        if (flipChop) r = t.history.slice(-1) === 'B' ? 'P' : 'B';
        else r = rand() < pB ? 'B' : 'P';

        // Capture the prior-12 trend BEFORE appending this hand's
        // result — same semantics as transformWalkerHands. Walk-up
        // patrons would have seen this bead-plate slice when they
        // decided whether to sit, so pairing it with the headcount
        // recorded below answers "does a visible trend attract?".
        const priorHistory12 = t.shoeHistory.slice(-12);
        const priorTrend = analyzeHand(priorHistory12 || 'B');
        t.priorHistory12 = priorHistory12;
        t.priorSurprise = priorTrend.surprise;
        t.priorPeriod = priorTrend.p;
        t.priorLength = priorTrend.L;
        t.priorMotif = priorTrend.motif;

        t.history = (t.history + r).slice(-15);
        t.shoeHistory = t.shoeHistory + r;
        t.shoeHand += 1;
      }

      const a = analyzeHand(t.history || 'B');

      // Headcount dynamics:
      // - Hot trend (surprise high) attracts: arrival rate up
      // - Broken streak repels
      // - VIP tables more selective
      const openSeats = Math.max(0, 7 - t.headcount);
      const tierDamp = 1 / (1 + t.min / 500);
      const surpriseEffect = Math.max(0, a.surprise - 2) * 0.45 * tierDamp;
      const cooldown = a.broken ? -0.6 : 0;

      const arrivalLambda =
        wave * (0.18 + surpriseEffect * (openSeats / 7)) + cooldown;
      const leaveProb = 0.08 + (a.broken ? 0.15 : 0);

      const arrivals =
        rand() < arrivalLambda
          ? 1 + (rand() < arrivalLambda * 0.4 ? 1 : 0)
          : 0;
      const leaves = t.headcount > 0 && rand() < leaveProb ? 1 : 0;
      t.headcount = Math.max(0, Math.min(7, t.headcount + arrivals - leaves));
      t.lastSurprise = a.surprise;

      // Average bet placed on this hand:
      //   baseline = table min, scaled up when a hot trend is in play
      //   (players press the streak / press the chop), plus noise
      const surpriseBoost = Math.max(0, a.surprise - 2) * 0.14;
      const cooldownPenalty = a.broken ? -0.18 : 0;
      const noise = 0.82 + rand() * 0.42; // ~ ±20%
      const avgBet = Math.max(
        t.min,
        Math.round(t.min * (1 + surpriseBoost + cooldownPenalty) * noise)
      );

      return {
        tableId: t.id,
        x: t.x,
        y: t.y,
        min: t.min,
        pit: t.pit,
        label: t.label,
        headcount: t.headcount,
        history: t.history,
        shoeHistory: t.shoeHistory,
        shoeId: t.shoeId,
        shoeHand: t.shoeHand,
        surprise: a.surprise,
        period: a.p,
        length: a.L,
        motif: a.motif,
        broken: a.broken,
        brokenLength: a.brokenLength,
        newPlayers: arrivals,
        avgBet,
        // Prior-12 trend snapshot — see state-init comment + capture
        // inside the `if (hasHand)` block above. Forward-fills across
        // hand-less minutes (state struct retains the last set values),
        // matching transformWalkerHands behavior.
        priorHistory12: t.priorHistory12,
        priorSurprise: t.priorSurprise,
        priorPeriod: t.priorPeriod,
        priorLength: t.priorLength,
        priorMotif: t.priorMotif,
        priorTrendStatus: trendStatusFor(t.priorSurprise),
      };
    });

    frames.push({ minute: m, hour, perTable });
  }

  return { tables, frames };
}
