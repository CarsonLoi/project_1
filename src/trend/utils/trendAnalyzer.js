// Anchored Dominant Trailing Pattern (DTP) detector.
// Given a chronological string of B/P, find the longest periodic suffix
// ending exactly at the most recent hand.
//
// IMPORTANT: a "trend" is only considered real if the repeating motif
// itself has a CLEAN run-structure — one block of B's followed by one
// block of P's (or vice versa), i.e. at most one transition inside the
// motif. Motifs like "BBPB" technically satisfy a periodic constraint
// but are not shapes baccarat players recognize as a trend.

function isCanonicalMotif(motif) {
  if (motif.length <= 1) return true;
  let transitions = 0;
  for (let i = 1; i < motif.length; i++) {
    if (motif[i] !== motif[i - 1]) {
      transitions += 1;
      if (transitions > 1) return false;
    }
  }
  return true;
}

// Friendly shape label for a canonical motif. Falls back to raw motif
// when the shape isn't one of the named ones (shouldn't happen post-filter).
export function shapeName(motif) {
  if (!motif) return '–';
  if (motif.length === 1) {
    return motif === 'B' ? 'Banker streak' : 'Player streak';
  }
  // Count run lengths
  let firstRun = 1;
  while (firstRun < motif.length && motif[firstRun] === motif[0]) firstRun += 1;
  const secondRun = motif.length - firstRun;
  if (secondRun === 0) {
    return motif[0] === 'B' ? 'Banker streak' : 'Player streak';
  }
  if (firstRun === 1 && secondRun === 1) return 'Single chop';
  return `${firstRun}-${secondRun} pattern`;
}

export function detectDominantPattern(suffix) {
  const k = suffix.length;
  if (k === 0) return { p: 0, L: 0, surprise: 0, motif: '', reps: 0 };

  let best = {
    p: 1,
    L: 1,
    surprise: 0,
    motif: suffix[k - 1],
    reps: 1,
  };

  for (let p = 1; p <= 5; p++) {
    if (p > k) break;
    let L = p; // the seed always satisfies period p vacuously
    while (L < k) {
      const newIdx = k - 1 - L;     // position being absorbed on the left
      const cmpIdx = newIdx + p;    // its required twin p steps to the right
      if (cmpIdx >= k) break;
      if (suffix[newIdx] === suffix[cmpIdx]) L++;
      else break;
    }
    // Walk back from the longest L and accept the first L whose motif
    // is canonical. This handles phase alignment: if BBPP repeats but
    // we're observing it phased as BPPB, we shrink one position and
    // pick up "PPBB" instead.
    for (let tryL = L; tryL >= p; tryL--) {
      const motif = suffix.slice(k - tryL, k - tryL + p);
      if (!isCanonicalMotif(motif)) continue;
      const surprise = tryL - p;
      const reps = tryL / p;
      const better =
        surprise > best.surprise ||
        (surprise === best.surprise && reps > best.reps);
      if (better) {
        best = { p, L: tryL, surprise, motif, reps };
      }
      break; // accepted at this period, don't shrink further
    }
  }
  return best;
}

export function analyzeHand(history) {
  const current = detectDominantPattern(history);
  let prevSurprise = 0;
  let prevLength = 0;
  if (history.length >= 2) {
    const prev = detectDominantPattern(history.slice(0, -1));
    prevSurprise = prev.surprise;
    prevLength = prev.L;
  }
  const broken = prevSurprise >= 3 && current.surprise < 3;
  return {
    ...current,
    broken,
    prevSurprise,
    brokenLength: broken ? prevLength : 0,
  };
}

export function patternLabel(a) {
  if (a.broken) return `Broken (${a.brokenLength})`;
  if (a.surprise < 3) return 'No trend';
  return `${shapeName(a.motif)} (${a.motif})`;
}
