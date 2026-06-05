import React, { useState, useMemo, useEffect } from 'react';

// =====================================================================
// BACCARAT DISPLAY BOARD — Macao style
// =====================================================================
// Outcome model for a single hand:
//   {
//     result: 'B' | 'P' | 'T',          // Banker / Player / Tie
//     bankerPair: boolean,
//     playerPair: boolean,
//     lucky6: boolean,                   // Banker wins with 6
//     lucky7: boolean,                   // Banker wins with 7 (house side bet)
//     monkey: boolean,                   // 花牌至尊 — face cards / monkey
//   }
// =====================================================================

// ---------- Mock shoe generator (deterministic by shoeId) ----------
function hashStringToSeed(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
function mulberry32(seed) {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
// Card helpers
const SUITS = ['♠', '♥', '♦', '♣'];
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
function cardValue(rank) {
  if (rank === 'A') return 1;
  if (['10', 'J', 'Q', 'K'].includes(rank)) return 0;
  return parseInt(rank, 10);
}
function isFaceOrTen(rank) {
  return ['10', 'J', 'Q', 'K'].includes(rank);
}
function drawCard(rand) {
  const rank = RANKS[Math.floor(rand() * RANKS.length)];
  const suit = SUITS[Math.floor(rand() * SUITS.length)];
  return { rank, suit, value: cardValue(rank) };
}
function pointTotal(cards) {
  return cards.reduce((s, c) => s + c.value, 0) % 10;
}

// Build a shoe whose results EXACTLY match a heatmap shoeHistory string
// ('B'/'P'/'T' per hand). Cards are drawn deterministically and forced to
// satisfy the target result so the rendered Big Road aligns 1:1 with the
// trend heatmap's per-table sequence.
function generateShoeFromHistory(history, seedKey) {
  const rand = mulberry32(hashStringToSeed(seedKey || 'demo'));
  const hands = [];
  if (!history) return hands;
  for (let i = 0; i < history.length; i++) {
    const target = history[i];
    if (!['B', 'P', 'T'].includes(target)) continue;

    let player, banker, attempts = 0;
    do {
      player = [drawCard(rand), drawCard(rand)];
      banker = [drawCard(rand), drawCard(rand)];
      const pT = pointTotal(player);
      const bT = pointTotal(banker);
      if (pT < 8 && bT < 8) {
        if (pT <= 5) player.push(drawCard(rand));
        if (pointTotal(banker) <= 5 && rand() < 0.5) banker.push(drawCard(rand));
      }
      attempts++;
      const pTot = pointTotal(player), bTot = pointTotal(banker);
      if (target === 'B' && bTot > pTot) break;
      if (target === 'P' && pTot > bTot) break;
      if (target === 'T' && pTot === bTot) break;
    } while (attempts < 40);

    const pTotal = pointTotal(player);
    const bTotal = pointTotal(banker);
    // Force the displayed result to the heatmap target — even if sampling
    // didn't converge, the road must mirror the heatmap.
    const result = target;
    const bankerPair = banker[0].rank === banker[1].rank;
    const playerPair = player[0].rank === player[1].rank;
    const lucky6 = result === 'B' && bTotal === 6;
    const lucky7 = result === 'P' && pTotal === 7;
    const monkey = isFaceOrTen(player[0].rank) && isFaceOrTen(banker[0].rank);

    hands.push({
      index: i + 1,
      result,
      playerCards: player,
      bankerCards: banker,
      playerTotal: pTotal,
      bankerTotal: bTotal,
      bankerPair,
      playerPair,
      lucky6,
      lucky7,
      monkey,
    });
  }
  return hands;
}

function generateShoe(shoeId) {
  const rand = mulberry32(hashStringToSeed(shoeId || 'demo'));
  const handCount = 60 + Math.floor(rand() * 15); // 60–74 hands
  const hands = [];
  let lastResult = null;
  let streak = 0;
  for (let i = 0; i < handCount; i++) {
    // Decide intended outcome (biased for streaks & realism)
    let r;
    const roll = rand();
    if (lastResult && lastResult !== 'T' && streak < 8 && roll < 0.55) {
      r = lastResult;
    } else if (roll < 0.92) {
      r = rand() < 0.51 ? 'B' : 'P';
    } else {
      r = 'T';
    }
    if (r === lastResult) streak++; else { streak = 1; lastResult = r === 'T' ? lastResult : r; }

    // Generate plausible cards that match the chosen result.
    // We just draw 2-3 cards per side until totals satisfy the outcome.
    let player, banker, attempts = 0;
    do {
      player = [drawCard(rand), drawCard(rand)];
      banker = [drawCard(rand), drawCard(rand)];
      // simple third-card simulation
      const pT = pointTotal(player);
      const bT = pointTotal(banker);
      if (pT < 8 && bT < 8) {
        if (pT <= 5) player.push(drawCard(rand));
        if (pointTotal(banker) <= 5 && rand() < 0.5) banker.push(drawCard(rand));
      }
      attempts++;
      const pTot = pointTotal(player), bTot = pointTotal(banker);
      if (r === 'B' && bTot > pTot) break;
      if (r === 'P' && pTot > bTot) break;
      if (r === 'T' && pTot === bTot) break;
    } while (attempts < 40);

    const pTotal = pointTotal(player);
    const bTotal = pointTotal(banker);
    // Recompute actual result from cards (so what the table shows is consistent)
    const actualResult = bTotal > pTotal ? 'B' : pTotal > bTotal ? 'P' : 'T';

    // Pairs — true if first two cards of a side share a rank
    const bankerPair = banker[0].rank === banker[1].rank;
    const playerPair = player[0].rank === player[1].rank;
    // Lucky 6: Banker wins with exactly 6 (banker side bet)
    const lucky6 = actualResult === 'B' && bTotal === 6;
    // Lucky 7: Player wins with exactly 7 (player side bet)
    const lucky7 = actualResult === 'P' && pTotal === 7;
    // Monkey (花牌至尊): both first cards on each side are 10/J/Q/K
    const monkey = isFaceOrTen(player[0].rank) && isFaceOrTen(banker[0].rank);

    hands.push({
      index: i + 1,
      result: actualResult,
      playerCards: player,
      bankerCards: banker,
      playerTotal: pTotal,
      bankerTotal: bTotal,
      bankerPair,
      playerPair,
      lucky6,
      lucky7,
      monkey,
    });
  }
  return hands;
}

// ---------- Big Road derivation ----------
// Returns a 2D grid [col][row] with cells {result, ties, bankerPair, playerPair, lucky6, lucky7, monkey}
// Ties attach to the most recent non-tie cell (rendered as a slash).
// ---------- Big Road derivation ----------
// Returns columns[col] = array of cells, where cells[row] = {result, ties, ...} or undefined.
// Rules:
//   - Each new B/P streak starts a new column at row 0.
//   - Same side continues down the same column (row 0,1,2,3,4,5).
//   - When the column is full (row 5) and same side continues, it "dragon tails":
//     it moves RIGHT at row 5, occupying new columns at row 5 only.
//   - Ties attach as slashes on the most recent non-tie cell.
function buildBigRoad(hands, rows = 6) {
  // Use a sparse 2D structure: grid[col][row] = cell
  const grid = [];
  const setCell = (c, r, cell) => {
    if (!grid[c]) grid[c] = [];
    grid[c][r] = cell;
  };
  const getCell = (c, r) => (grid[c] ? grid[c][r] : undefined);

  let curCol = -1;
  let curRow = -1;
  let lastSide = null;
  let lastCell = null;

  for (const h of hands) {
    if (h.result === 'T') {
      if (lastCell) {
        lastCell.ties = (lastCell.ties || 0) + 1;
        mergeExtras(lastCell, h);
      } else {
        // tie before any decision — place a tie-only cell at (0,0)
        const cell = { result: null, ties: 1, ...extras(h) };
        setCell(0, 0, cell);
        curCol = 0; curRow = 0; lastCell = cell;
      }
      continue;
    }

    if (h.result !== lastSide) {
      // New streak → place at the FIRST column whose row 0 is empty.
      // This ensures we don't leave "gap" columns visible at row 0 after
      // dragon tails have filled row 5 of intermediate columns.
      let c = 0;
      while (getCell(c, 0)) c++;
      curCol = c;
      curRow = 0;
      const cell = { result: h.result, ties: 0, ...extras(h) };
      setCell(curCol, curRow, cell);
      lastCell = cell;
      lastSide = h.result;
    } else {
      // Same side: try to go down
      const nextRow = curRow + 1;
      if (nextRow < rows && !getCell(curCol, nextRow)) {
        curRow = nextRow;
        const cell = { result: h.result, ties: 0, ...extras(h) };
        setCell(curCol, curRow, cell);
        lastCell = cell;
      } else {
        // Dragon tail: walk RIGHT at the current row, find the next empty cell
        let c = curCol + 1;
        while (getCell(c, curRow)) c++;
        const cell = { result: h.result, ties: 0, ...extras(h) };
        setCell(c, curRow, cell);
        curCol = c;
        // curRow stays the same
        lastCell = cell;
      }
    }
  }

  // Normalize: ensure each grid[c] is an array of length up to rows (with undefined for empty)
  const cols = [];
  const maxCol = grid.length;
  for (let c = 0; c < maxCol; c++) {
    const col = [];
    for (let r = 0; r < rows; r++) col[r] = getCell(c, r) || null;
    cols[c] = col;
  }
  return cols;
}
function extras(h) {
  return {
    bankerPair: !!h.bankerPair,
    playerPair: !!h.playerPair,
    lucky6: !!h.lucky6,
    lucky7: !!h.lucky7,
    monkey: !!h.monkey,
  };
}
function mergeExtras(cell, h) {
  cell.bankerPair ||= !!h.bankerPair;
  cell.playerPair ||= !!h.playerPair;
  cell.lucky6 ||= !!h.lucky6;
  cell.lucky7 ||= !!h.lucky7;
  cell.monkey ||= !!h.monkey;
}

// ---------- Derived roads (Big Eye / Small / Cockroach) ----------
// k = how many "streaks" back to look (1=Big Eye, 2=Small, 3=Cockroach)
//
// Per Interblock spec:
//
//   For each NEW position added to the Main Road (after enough history):
//
//     If R == 0 (the hand starts a new column on the Main Road):
//       Compare DEPTHS of column (N-1) and column (N-1-k).
//       Same depth → RED (regular), different → BLUE (irregular).
//
//     If R > 0 (the hand extends the current column):
//       Compare cell (N-k, R) with cell (N-k, R-1) in the Main Road.
//       If BOTH have the same state (both filled OR both blank) → RED.
//       If they differ (one filled, one not) → BLUE.
//
//   Translated to streak-length terms:
//     cell (N-k, R) is filled iff streakLen(N-k) > R
//     cell (N-k, R-1) is filled iff streakLen(N-k) > R - 1
//     They have the same state iff streakLen(N-k) != R (because the only point
//     where they disagree is exactly when the column has stopped at row R).
//     So: red if streakLen(N-k) != R, blue if streakLen(N-k) == R.
function buildDerivedRoad(hands, k, maxRows = 6) {
  // Build streak sequence from logical hands (B/P only; ties merge into the
  // previous streak without creating a new one).
  const streakLens = [];
  let curSide = null;
  for (const h of hands) {
    if (!h || h.result === 'T' || !h.result) continue;
    if (h.result !== curSide) {
      streakLens.push(1);
      curSide = h.result;
    } else {
      streakLens[streakLens.length - 1] += 1;
    }
  }

  const marks = [];
  for (let N = 0; N < streakLens.length; N++) {
    const len = streakLens[N];
    for (let R = 0; R < len; R++) {
      let mark;
      if (R === 0) {
        // Need column (N-1) and (N-1-k)
        if (N < k + 1) continue;
        const a = Math.min(streakLens[N - 1], maxRows);
        const b = Math.min(streakLens[N - 1 - k], maxRows);
        mark = a === b ? 'R' : 'B';
      } else {
        // Need column (N-k)
        if (N < k) continue;
        const ref = Math.min(streakLens[N - k], maxRows);
        // Red if cells at row R and row R-1 in column (N-k) match in fill state.
        // They match for every R EXCEPT R == ref (where row R-1 is filled but
        // row R is not).
        mark = ref === R ? 'B' : 'R';
      }
      marks.push(mark);
    }
  }

  // Lay out marks into columns, same logic as Main Road.
  const grid = [];
  const setCell = (c, r, v) => { if (!grid[c]) grid[c] = []; grid[c][r] = v; };
  const getCell = (c, r) => (grid[c] ? grid[c][r] : undefined);

  let curCol = -1, curRow = -1, lastMark = null;
  for (const m of marks) {
    if (m !== lastMark) {
      let c = 0;
      while (getCell(c, 0)) c++;
      curCol = c;
      curRow = 0;
      setCell(curCol, curRow, m);
      lastMark = m;
    } else {
      const nextRow = curRow + 1;
      if (nextRow < maxRows && !getCell(curCol, nextRow)) {
        curRow = nextRow;
        setCell(curCol, curRow, m);
      } else {
        let c = curCol + 1;
        while (getCell(c, curRow)) c++;
        setCell(c, curRow, m);
        curCol = c;
      }
    }
  }

  const cols = [];
  for (let c = 0; c < grid.length; c++) {
    const col = [];
    for (let r = 0; r < maxRows; r++) col[r] = getCell(c, r) || null;
    cols[c] = col;
  }
  return cols;
}
function colHeight(bigRoad, c) {
  if (c < 0 || !bigRoad[c]) return 0;
  let h = 0;
  for (const cell of bigRoad[c]) if (cell && cell.result) h++;
  return h;
}

// ---------- Stats ----------
function computeStats(hands) {
  let B = 0, P = 0, T = 0, L6 = 0, L7 = 0, pairs = 0, monkey = 0;
  for (const h of hands) {
    if (h.result === 'B') B++;
    else if (h.result === 'P') P++;
    else T++;
    if (h.lucky6) L6++;
    if (h.lucky7) L7++;
    if (h.bankerPair || h.playerPair) pairs++;
    if (h.monkey) monkey++;
  }
  return { game: hands.length, B, P, T, L6, L7, pairs, monkey };
}

// =====================================================================
// Visual constants
// =====================================================================
const BANKER = '#c8202b';
const PLAYER = '#1f4fb8';
const TIE = '#1f9d4d';
const PANEL_BG = '#cfe1f5';
const GRID_LINE = '#a9c4dc';
const BOARD_BG = '#0e3a6b';

// =====================================================================
// Cell renderers
// =====================================================================
function BigRoadCell({ cell, size }) {
  if (!cell) return <div style={{ width: size, height: size }} />;
  const color = cell.result === 'B' ? BANKER : cell.result === 'P' ? PLAYER : null;
  const stroke = 2.6;
  const r = (size - stroke * 2) / 2 - 0.5;
  const cx = size / 2, cy = size / 2;
  const shapeSize = r * 2; // for square version

  // Tie slashes per Interblock spec: small green diagonal placed in the
  // LOWER-LEFT corner of the cell of the previous decision. Consecutive ties
  // are indicated by a number next to the slash.
  const tieLines = [];
  if (cell.ties > 0) {
    tieLines.push(
      <line key="t1"
            x1={cx - r * 1.05} y1={cy + r * 1.05}
            x2={cx + r * 0.15} y2={cy - r * 0.15}
            stroke={TIE} strokeWidth={2.4} strokeLinecap="round" />
    );
    // For 2+ consecutive ties, show a small count number next to the slash
    if (cell.ties > 1) {
      tieLines.push(
        <text key="tn"
          x={cx - r * 0.55} y={cy + r * 0.95}
          fontSize={size * 0.30}
          fontWeight={800}
          fill={TIE}
          textAnchor="middle"
          dominantBaseline="middle"
        >{cell.ties}</text>
      );
    }
  }

  const luckyNum = cell.lucky7 ? '7' : cell.lucky6 ? '6' : null;
  const luckyColor = color;

  // Pair markers per Interblock spec:
  //   Banker pair → red DOT in the upper-LEFT corner
  //   Player pair → blue DOT in the lower-RIGHT corner
  //   Both pairs → both dots shown simultaneously
  const pairMarks = [];
  if (cell.bankerPair) {
    pairMarks.push(
      <circle key="bp"
        cx={cx - r * 0.7} cy={cy - r * 0.7}
        r={size * 0.08}
        fill={BANKER}
      />
    );
  }
  if (cell.playerPair) {
    pairMarks.push(
      <circle key="pp"
        cx={cx + r * 0.7} cy={cy + r * 0.7}
        r={size * 0.08}
        fill={PLAYER}
      />
    );
  }

  // Choose shape:
  //   - monkey present → square (rectangle outline) in the side's colour
  //   - else → circle (hollow or lucky-filled)
  const isMonkey = !!cell.monkey;

  let mainShape = null;
  if (color) {
    if (isMonkey && !luckyNum) {
      // Monkey turns the hollow circle into a hollow square of the side's colour
      mainShape = (
        <rect
          x={cx - r} y={cy - r}
          width={shapeSize} height={shapeSize}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
        />
      );
    } else if (isMonkey && luckyNum) {
      // Monkey + lucky number: filled square with the number
      mainShape = (
        <>
          <rect x={cx - r} y={cy - r} width={shapeSize} height={shapeSize}
                fill={luckyColor} />
          <text x={cx} y={cy + size * 0.13} textAnchor="middle"
                fontSize={size * 0.55} fontWeight={800} fill="#fff"
                fontFamily="Georgia, serif">{luckyNum}</text>
        </>
      );
    } else if (luckyNum) {
      // Filled circle with lucky number
      mainShape = (
        <>
          <circle cx={cx} cy={cy} r={r} fill={luckyColor} />
          <text x={cx} y={cy + size * 0.13} textAnchor="middle"
                fontSize={size * 0.55} fontWeight={800} fill="#fff"
                fontFamily="Georgia, serif">{luckyNum}</text>
        </>
      );
    } else {
      // Default: hollow circle
      mainShape = (
        <circle cx={cx} cy={cy} r={r} fill="none"
                stroke={color} strokeWidth={stroke} />
      );
    }
  }

  return (
    <svg width={size} height={size} style={{ display: 'block', overflow: 'visible' }}>
      {mainShape}
      {tieLines}
      {pairMarks}
    </svg>
  );
}

function DerivedDotCell({ mark, size, filled }) {
  if (!mark) return <div style={{ width: size, height: size }} />;
  const color = mark === 'R' ? BANKER : PLAYER;
  const r = size * 0.32;
  return (
    <svg width={size} height={size} style={{ display: 'block' }}>
      <circle cx={size / 2} cy={size / 2} r={r}
              fill={filled ? color : 'none'} stroke={color} strokeWidth={1.6} />
    </svg>
  );
}

function CockroachCell({ mark, size }) {
  if (!mark) return <div style={{ width: size, height: size }} />;
  const color = mark === 'R' ? BANKER : PLAYER;
  return (
    <svg width={size} height={size} style={{ display: 'block' }}>
      <line x1={size * 0.2} y1={size * 0.8} x2={size * 0.8} y2={size * 0.2}
            stroke={color} strokeWidth={2.2} strokeLinecap="round" />
    </svg>
  );
}

function BeadPlateCell({ hand, size }) {
  if (!hand) return <div style={{ width: size, height: size }} />;
  const color = hand.result === 'B' ? BANKER : hand.result === 'P' ? PLAYER : TIE;
  const label = hand.result === 'B' ? '庄' : hand.result === 'P' ? '闲' : '和';
  const r = size * 0.42;
  const cx = size / 2, cy = size / 2;

  const luckyNum = hand.lucky7 ? '7' : hand.lucky6 ? '6' : null;
  const display = luckyNum || label;
  const isMonkey = !!hand.monkey;

  // Main shape: square if monkey, otherwise circle. Both filled with side colour.
  const mainShape = isMonkey ? (
    <rect x={cx - r} y={cy - r} width={r * 2} height={r * 2}
          rx={size * 0.05} ry={size * 0.05} fill={color} />
  ) : (
    <circle cx={cx} cy={cy} r={r} fill={color} />
  );

  // Pair markers per Interblock spec:
  //   Banker pair → red dot upper-LEFT
  //   Player pair → blue dot lower-RIGHT
  //   Both → both shown
  const pairMarks = [];
  if (hand.bankerPair) {
    pairMarks.push(
      <circle key="bp" cx={cx - r * 0.7} cy={cy - r * 0.7}
              r={size * 0.09} fill={BANKER}
              stroke="#fff" strokeWidth={1} />
    );
  }
  if (hand.playerPair) {
    pairMarks.push(
      <circle key="pp" cx={cx + r * 0.7} cy={cy + r * 0.7}
              r={size * 0.09} fill={PLAYER}
              stroke="#fff" strokeWidth={1} />
    );
  }

  return (
    <svg width={size} height={size} style={{ display: 'block', overflow: 'visible' }}>
      {mainShape}
      <text x={cx} y={cy + size * 0.13} textAnchor="middle"
            fontSize={size * 0.5} fontWeight={700} fill="#fff"
            fontFamily="'Noto Sans SC', sans-serif">
        {display}
      </text>
      {pairMarks}
    </svg>
  );
}

// =====================================================================
// Grid wrappers
// =====================================================================
function RoadGrid({ cols, rows, cellSize, render, minCols, fillWidth = true }) {
  const dataMaxCol = Math.max(cols.length, minCols);
  return (
    <div style={{
      width: fillWidth ? '100%' : dataMaxCol * cellSize,
      overflowX: 'auto',
      backgroundColor: PANEL_BG,
    }}>
      <div style={{
        display: 'grid',
        gridTemplateColumns: fillWidth
          ? `repeat(auto-fill, ${cellSize}px)`
          : `repeat(${dataMaxCol}, ${cellSize}px)`,
        gridTemplateRows: `repeat(${rows}, ${cellSize}px)`,
        backgroundColor: PANEL_BG,
        backgroundImage: `linear-gradient(${GRID_LINE} 1px, transparent 1px), linear-gradient(90deg, ${GRID_LINE} 1px, transparent 1px)`,
        backgroundSize: `${cellSize}px ${cellSize}px`,
        minWidth: dataMaxCol * cellSize,
        width: fillWidth ? '100%' : dataMaxCol * cellSize,
        height: rows * cellSize,
      }}>
        {Array.from({ length: rows }).map((_, r) => (
          Array.from({ length: dataMaxCol }).map((__, c) => {
            const item = cols[c] ? cols[c][r] : null;
            return (
              <div key={`${c}-${r}`} style={{
                gridColumn: c + 1, gridRow: r + 1,
                width: cellSize, height: cellSize,
              }}>
                {render(item, cellSize)}
              </div>
            );
          })
        ))}
      </div>
    </div>
  );
}

// =====================================================================
// Main component
// =====================================================================
export default function BaccaratBoard({ table, data, tableLabel, onBack }) {
  // Prefer the live heatmap data; fall back to a label-seeded demo shoe so the
  // component is still usable on its own.
  const liveLabel = table?.label || tableLabel || 'SHOE-001';
  const liveShoeKey = data?.shoeId != null
    ? `${liveLabel}-S${data.shoeId}`
    : liveLabel;
  const liveHistory = data?.shoeHistory || '';
  const hasLive = !!liveHistory;

  const [shoeIdInput, setShoeIdInput] = useState(liveShoeKey);
  const [activeShoe, setActiveShoe] = useState(liveShoeKey);
  const [tab, setTab] = useState('board'); // 'board' | 'hands'

  // Whenever the upstream selection or shoe rotates, resync the shoe key.
  useEffect(() => {
    setShoeIdInput(liveShoeKey);
    setActiveShoe(liveShoeKey);
  }, [liveShoeKey]);

  const hands = useMemo(() => {
    if (hasLive) return generateShoeFromHistory(liveHistory, liveShoeKey);
    return generateShoe(activeShoe);
  }, [hasLive, liveHistory, liveShoeKey, activeShoe]);
  const bigRoad = useMemo(() => buildBigRoad(hands, 6), [hands]);
  const bigEye = useMemo(() => buildDerivedRoad(hands, 1, 6), [hands]);
  const smallRoad = useMemo(() => buildDerivedRoad(hands, 2, 6), [hands]);
  const cockroach = useMemo(() => buildDerivedRoad(hands, 3, 6), [hands]);
  const stats = useMemo(() => computeStats(hands), [hands]);

  const loadShoe = () => setActiveShoe(shoeIdInput.trim() || 'SHOE-001');

  // Cell sizes — match casino-board proportions. Big Road and Big Eye Boy
  // get larger cells (and fewer columns) than Small Road / Cockroach so
  // they're easier to read while still aligning widths visually.
  const BR_CELL = 40;       // Big Road
  const BE_CELL = 20;       // Big Eye Boy — half of BR so widths align
  const DR_CELL = 14;       // Small Road & Cockroach Road
  const BP_CELL = 38;       // bead plate

  return (
    <div style={{
      backgroundColor: BOARD_BG,
      padding: 16,
      fontFamily: "'Noto Sans SC', 'Helvetica Neue', sans-serif",
      color: '#fff',
      height: '100%',
      width: '100%',
      overflow: 'auto',
      boxSizing: 'border-box',
    }}>
      {/* Shoe input */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14,
        backgroundColor: 'rgba(255,255,255,0.08)', padding: '10px 14px',
        borderRadius: 6,
      }}>
        {onBack && (
          <button onClick={onBack} style={{
            padding: '8px 16px', border: '1px solid rgba(255,255,255,0.3)',
            borderRadius: 4, background: 'rgba(0,0,0,0.3)', color: '#fff',
            fontWeight: 700, cursor: 'pointer', fontSize: 15,
            fontFamily: 'inherit',
          }}>← Back to Heatmap</button>
        )}
        {hasLive ? (
          <>
            <span style={{ fontSize: 16, opacity: 0.9 }}>
              Table <strong style={{ color: '#ffd27a' }}>{liveLabel}</strong>
              {table?.pit && (
                <span style={{ opacity: 0.75 }}> · Pit {table.pit}</span>
              )}
              <span style={{ opacity: 0.75 }}>
                {data?.min != null
                  ? ` · $${data.min.toLocaleString()} min`
                  : ' · — min'}
              </span>
            </span>
            <span style={{
              padding: '5px 12px', borderRadius: 4,
              background: 'rgba(255,210,122,0.18)',
              border: '1px solid rgba(255,210,122,0.4)',
              fontSize: 15, fontWeight: 700, color: '#ffd27a',
              letterSpacing: 0.5,
            }}>
              Shoe #{data?.shoeId ?? '–'}
            </span>
            {data && (
              <span style={{ fontSize: 14, opacity: 0.75 }}>
                Hand {data.shoeHand ?? hands.length} · Headcount {data.headcount}/7
              </span>
            )}
            <span style={{ marginLeft: 'auto', fontSize: 14, opacity: 0.65 }}>
              Aligned with Trend Heatmap · {hands.length} hands
            </span>
          </>
        ) : (
          <>
            <label style={{ fontSize: 14, opacity: 0.85 }}>Shoe ID:</label>
            <input
              value={shoeIdInput}
              onChange={(e) => setShoeIdInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && loadShoe()}
              style={{
                padding: '6px 10px', border: '1px solid rgba(255,255,255,0.3)',
                background: 'rgba(0,0,0,0.25)', color: '#fff', borderRadius: 4,
                fontSize: 14, width: 180, fontFamily: 'inherit',
              }}
              placeholder="e.g. SHOE-001"
            />
            <button onClick={loadShoe} style={{
              padding: '6px 16px', border: 'none', borderRadius: 4,
              background: '#d4a043', color: '#1a2a3f', fontWeight: 700,
              cursor: 'pointer', fontSize: 14,
            }}>Load</button>
            <span style={{ marginLeft: 'auto', fontSize: 13, opacity: 0.7 }}>
              Active: <strong style={{ color: '#ffd27a' }}>{activeShoe}</strong> · {hands.length} hands
            </span>
          </>
        )}
      </div>

      {/* Tabs */}
      <div style={{
        display: 'flex', gap: 2, marginBottom: 12,
        borderBottom: '2px solid rgba(255,255,255,0.15)',
      }}>
        {[
          { id: 'board', label: 'Board' },
          { id: 'hands', label: `Hands (${hands.length})` },
        ].map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            style={{
              padding: '10px 26px',
              border: 'none',
              borderRadius: '6px 6px 0 0',
              background: tab === t.id ? '#d4a043' : 'rgba(255,255,255,0.08)',
              color: tab === t.id ? '#1a2a3f' : '#cfd9e5',
              fontWeight: 700,
              cursor: 'pointer',
              fontSize: 17,
              fontFamily: 'inherit',
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'board' && (
        <BoardView
          hands={hands} bigRoad={bigRoad} bigEye={bigEye}
          smallRoad={smallRoad} cockroach={cockroach} stats={stats}
          BR_CELL={BR_CELL} BE_CELL={BE_CELL} DR_CELL={DR_CELL} BP_CELL={BP_CELL}
        />
      )}
      {tab === 'hands' && <HandsView hands={hands} />}
    </div>
  );
}

// =====================================================================
// Board view (the original road / bead / stats layout)
// =====================================================================
function BoardView({ hands, bigRoad, bigEye, smallRoad, cockroach, stats, BR_CELL, BE_CELL, DR_CELL, BP_CELL }) {
  // Keep Big Road and Big Eye visually aligned (same total width):
  //   BR width  = BR_MIN_COLS * BR_CELL
  //   BE width  = BE_MIN_COLS * BE_CELL
  // With BE_CELL = BR_CELL / 2, set BE_MIN_COLS = BR_MIN_COLS * 2.
  const BR_MIN_COLS = 28;
  const BE_MIN_COLS = BR_MIN_COLS * 2;   // = 56
  return (
    <div>
      {/* Big Road */}
      <div style={{ marginBottom: 10, position: 'relative' }}>
        <WatermarkLabel text="大　路" />
        <RoadGrid
          cols={bigRoad}
          rows={6}
          cellSize={BR_CELL}
          minCols={Math.max(BR_MIN_COLS, bigRoad.length + 2)}
          render={(cell, s) => <BigRoadCell cell={cell} size={s} />}
        />
      </div>

      {/* Big Eye Boy */}
      <div style={{ marginBottom: 10, position: 'relative' }}>
        <WatermarkLabel text="大 眼 仔" small />
        <RoadGrid
          cols={bigEye}
          rows={6}
          cellSize={BE_CELL}
          minCols={BE_MIN_COLS}
          render={(m, s) => <DerivedDotCell mark={m} size={s} filled={false} />}
        />
      </div>

      {/* Small Road + Cockroach Road side by side */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 10 }}>
        <div style={{ position: 'relative', flex: 1, minWidth: 0 }}>
          <WatermarkLabel text="小 路" small />
          <RoadGrid
            cols={smallRoad}
            rows={6}
            cellSize={DR_CELL}
            minCols={40}
            render={(m, s) => <DerivedDotCell mark={m} size={s} filled={true} />}
          />
        </div>
        <div style={{ position: 'relative', flex: 1, minWidth: 0 }}>
          <WatermarkLabel text="曱 甴 路" small />
          <RoadGrid
            cols={cockroach}
            rows={6}
            cellSize={DR_CELL}
            minCols={40}
            render={(m, s) => <CockroachCell mark={m} size={s} />}
          />
        </div>
      </div>

      {/* Bottom section: bead plate + legend + stats */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'stretch' }}>
        <div style={{ position: 'relative', flexShrink: 0 }}>
          <WatermarkLabel text="珠" small />
          <RoadGrid
            cols={chunkBeadPlate(hands, 6)}
            rows={6}
            cellSize={BP_CELL}
            minCols={Math.max(12, Math.ceil(hands.length / 6))}
            fillWidth={false}
            render={(h, s) => <BeadPlateCell hand={h} size={s} />}
          />
        </div>
        <Legend />
        <StatsPanel stats={stats} />
      </div>
    </div>
  );
}

// =====================================================================
// Hands view — table of every hand
// =====================================================================
function HandsView({ hands }) {
  const [filter, setFilter] = useState('all'); // all | B | P | T

  const filtered = filter === 'all' ? hands : hands.filter(h => h.result === filter);

  const headerCell = {
    padding: '10px 12px',
    textAlign: 'left',
    fontSize: 12,
    fontWeight: 700,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    color: '#1a2a3f',
    borderBottom: '2px solid #a9c4dc',
    background: '#bfd5ed',
    position: 'sticky',
    top: 0,
  };
  const bodyCell = {
    padding: '8px 12px',
    fontSize: 13,
    color: '#1a2a3f',
    borderBottom: '1px solid #d6e3f0',
    verticalAlign: 'middle',
  };

  const FilterButton = ({ id, label, color }) => (
    <button
      onClick={() => setFilter(id)}
      style={{
        padding: '6px 14px', borderRadius: 4, fontSize: 13, fontWeight: 700,
        border: filter === id ? `2px solid ${color || '#d4a043'}` : '2px solid transparent',
        background: filter === id ? '#d4a043' : 'rgba(255,255,255,0.1)',
        color: filter === id ? '#1a2a3f' : '#cfd9e5',
        cursor: 'pointer', fontFamily: 'inherit',
      }}
    >{label}</button>
  );

  return (
    <div>
      {/* Filter bar */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 10, alignItems: 'center' }}>
        <span style={{ fontSize: 13, opacity: 0.8, marginRight: 4 }}>Filter:</span>
        <FilterButton id="all" label={`All (${hands.length})`} />
        <FilterButton id="B" label={`Banker (${hands.filter(h => h.result === 'B').length})`} color={BANKER} />
        <FilterButton id="P" label={`Player (${hands.filter(h => h.result === 'P').length})`} color={PLAYER} />
        <FilterButton id="T" label={`Tie (${hands.filter(h => h.result === 'T').length})`} color={TIE} />
      </div>

      <div style={{
        background: PANEL_BG, borderRadius: 4, overflow: 'hidden',
        maxHeight: '70vh', overflowY: 'auto',
      }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: 'inherit' }}>
          <thead>
            <tr>
              <th style={{ ...headerCell, width: 50 }}>#</th>
              <th style={headerCell}>Result</th>
              <th style={headerCell}>Player Cards</th>
              <th style={{ ...headerCell, width: 60, textAlign: 'center' }}>P Total</th>
              <th style={headerCell}>Banker Cards</th>
              <th style={{ ...headerCell, width: 60, textAlign: 'center' }}>B Total</th>
              <th style={headerCell}>Side Bets</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(h => (
              <tr key={h.index} style={{
                background: h.index % 2 === 0 ? 'rgba(255,255,255,0.4)' : 'transparent',
              }}>
                <td style={{ ...bodyCell, fontWeight: 700, color: '#3a5070' }}>{h.index}</td>
                <td style={bodyCell}><ResultBadge result={h.result} /></td>
                <td style={bodyCell}><CardList cards={h.playerCards} side="P" /></td>
                <td style={{ ...bodyCell, textAlign: 'center', fontWeight: 700,
                  color: h.result === 'P' ? PLAYER : '#1a2a3f' }}>{h.playerTotal}</td>
                <td style={bodyCell}><CardList cards={h.bankerCards} side="B" /></td>
                <td style={{ ...bodyCell, textAlign: 'center', fontWeight: 700,
                  color: h.result === 'B' ? BANKER : '#1a2a3f' }}>{h.bankerTotal}</td>
                <td style={bodyCell}><SideBetTags hand={h} /></td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr><td colSpan={7} style={{ ...bodyCell, textAlign: 'center', padding: 30, opacity: 0.6 }}>
                No hands match this filter.
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ResultBadge({ result }) {
  const map = {
    B: { label: 'BANKER 庄', color: BANKER },
    P: { label: 'PLAYER 闲', color: PLAYER },
    T: { label: 'TIE 和', color: TIE },
  };
  const r = map[result];
  return (
    <span style={{
      display: 'inline-block', padding: '3px 10px', borderRadius: 12,
      background: r.color, color: '#fff', fontSize: 12, fontWeight: 700,
      letterSpacing: 0.5,
    }}>{r.label}</span>
  );
}

function CardList({ cards, side }) {
  return (
    <div style={{ display: 'flex', gap: 4 }}>
      {cards.map((c, i) => (
        <span key={i} style={{
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          minWidth: 32, height: 28, padding: '0 6px',
          background: '#fff', border: '1px solid #b8c8d8', borderRadius: 3,
          fontSize: 13, fontWeight: 700,
          color: (c.suit === '♥' || c.suit === '♦') ? '#c8202b' : '#1a2a3f',
          fontFamily: 'Georgia, serif',
        }}>
          {c.rank}{c.suit}
        </span>
      ))}
    </div>
  );
}

function SideBetTags({ hand }) {
  const tags = [];
  if (hand.bankerPair) tags.push({ label: 'Banker Pair', bg: BANKER });
  if (hand.playerPair) tags.push({ label: 'Player Pair', bg: PLAYER });
  if (hand.lucky6) tags.push({ label: 'Lucky 6', bg: BANKER });
  if (hand.lucky7) tags.push({ label: 'Lucky 7', bg: PLAYER });
  if (hand.monkey) tags.push({ label: 'Monkey 花牌', bg: '#1a6e3a' });
  if (tags.length === 0) return <span style={{ opacity: 0.4 }}>—</span>;
  return (
    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
      {tags.map((t, i) => (
        <span key={i} style={{
          padding: '2px 8px', borderRadius: 10, background: t.bg, color: '#fff',
          fontSize: 11, fontWeight: 700,
        }}>{t.label}</span>
      ))}
    </div>
  );
}

function chunkBeadPlate(hands, rows) {
  const cols = [];
  for (let i = 0; i < hands.length; i++) {
    const c = Math.floor(i / rows);
    const r = i % rows;
    if (!cols[c]) cols[c] = [];
    cols[c][r] = hands[i];
  }
  return cols;
}

function WatermarkLabel({ text, small }) {
  return (
    <div style={{
      position: 'absolute',
      inset: 0,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: small ? 36 : 64,
      color: 'rgba(80, 110, 150, 0.18)',
      fontWeight: 800,
      letterSpacing: small ? 6 : 14,
      pointerEvents: 'none',
      zIndex: 0,
    }}>{text}</div>
  );
}

function Legend() {
  return (
    <div style={{
      backgroundColor: PANEL_BG,
      color: '#1a2a3f',
      padding: 10,
      display: 'grid',
      gridTemplateColumns: 'auto auto',
      alignItems: 'center',
      justifyItems: 'center',
      gap: '8px 14px',
      borderRadius: 4,
      height: '100%',
      boxSizing: 'border-box',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <svg width={26} height={26}><circle cx={13} cy={13} r={10} fill={BANKER} /><text x={13} y={17} textAnchor="middle" fontSize={13} fontWeight={700} fill="#fff">庄</text></svg>
        <svg width={26} height={26}><circle cx={13} cy={13} r={10} fill={PLAYER} /><text x={13} y={17} textAnchor="middle" fontSize={13} fontWeight={700} fill="#fff">闲</text></svg>
      </div>
      <div />
      <svg width={26} height={26}><circle cx={13} cy={13} r={9} fill="none" stroke={BANKER} strokeWidth={2} /></svg>
      <svg width={26} height={26}><circle cx={13} cy={13} r={9} fill="none" stroke={PLAYER} strokeWidth={2} /></svg>
      <svg width={26} height={26}><circle cx={13} cy={13} r={6} fill={PLAYER} /></svg>
      <svg width={26} height={26}><circle cx={13} cy={13} r={6} fill={BANKER} /></svg>
      <svg width={26} height={26}><line x1={6} y1={20} x2={20} y2={6} stroke={PLAYER} strokeWidth={2.4} strokeLinecap="round" /></svg>
      <svg width={26} height={26}><line x1={6} y1={20} x2={20} y2={6} stroke={BANKER} strokeWidth={2.4} strokeLinecap="round" /></svg>
    </div>
  );
}

function StatsPanel({ stats }) {
  const row = (label, value, color, indicator) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      {indicator}
      <span style={{ color, fontWeight: 700, minWidth: 88, fontSize: 17 }}>{label}</span>
      <span style={{ marginLeft: 'auto', fontSize: 28, fontWeight: 800, color: '#1a2a3f' }}>{value}</span>
    </div>
  );
  const dot = (fill, label) => (
    <svg width={28} height={28}><circle cx={14} cy={14} r={12} fill={fill} />
      <text x={14} y={19} textAnchor="middle" fontSize={14} fontWeight={700} fill="#fff">{label}</text>
    </svg>
  );
  return (
    <div style={{
      flex: 1,
      backgroundColor: PANEL_BG,
      color: '#1a2a3f',
      padding: '14px 18px',
      display: 'grid',
      gridTemplateColumns: '1fr 1fr',
      gap: '12px 20px',
      borderRadius: 4,
      fontSize: 17,
      minWidth: 420,
    }}>
      <div style={{ gridColumn: '1 / 2' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
          <span style={{ fontWeight: 700, fontSize: 20 }}>局数 GAME</span>
          <span style={{ marginLeft: 'auto', fontSize: 28, fontWeight: 800 }}>{stats.game}</span>
        </div>
        {row('庄 BANKER', stats.B, BANKER, dot(BANKER, '庄'))}
        <div style={{ height: 8 }} />
        {row('闲 PLAYER', stats.P, PLAYER, dot(PLAYER, '闲'))}
        <div style={{ height: 8 }} />
        {row('和 TIE', stats.T, TIE, dot(TIE, '和'))}
      </div>
      <div style={{ gridColumn: '2 / 3' }}>
        <div style={{ height: 28, marginBottom: 8 }} />
        {row('幸运 6', stats.L6, BANKER, dot(BANKER, '6'))}
        <div style={{ height: 8 }} />
        {row('幸运 7', stats.L7, PLAYER, dot(PLAYER, '7'))}
        <div style={{ height: 8 }} />
        {row('对子 +', stats.pairs, '#8a6d10',
          <svg width={28} height={28}><circle cx={14} cy={14} r={12} fill="#d4c060" />
            <text x={14} y={19} textAnchor="middle" fontSize={16} fontWeight={900} fill="#1a2a3f">+</text></svg>
        )}
        <div style={{ height: 8 }} />
        {row('花牌至尊', stats.monkey, '#1a6e3a',
          <svg width={28} height={28}><rect x={4} y={4} width={20} height={20} fill="#d4c060" stroke={TIE} strokeWidth={1.5} /></svg>
        )}
      </div>
    </div>
  );
}
