// Baccarat roadmaps: Big Road + the three derived roads (Big Eye Boy, Small Road, Cockroach Road)

// Group a B/P sequence into consecutive same-symbol streaks
export function buildStreaks(hands) {
  const streaks = [];
  for (const h of hands) {
    if (h !== 'B' && h !== 'P') continue;
    if (streaks.length && streaks[streaks.length - 1].symbol === h) {
      streaks[streaks.length - 1].length += 1;
    } else {
      streaks.push({ symbol: h, length: 1 });
    }
  }
  return streaks;
}

// Lay out a list of cells {symbol} into a "Big-Road-style" grid.
//
// Rules:
//   - Each consecutive same-symbol cell goes down one row.
//   - It turns right (dragon tail) only when the cell directly below
//     is already occupied OR would fall off the grid (row + 1 >= rows).
//   - When the symbol changes, the new column starts at the SMALLEST
//     column whose row-0 cell is empty. This packs the new symbol into
//     the empty space above a preceding dragon tail rather than
//     reserving a fresh empty column for it.
export function buildRoadGrid(items, rows = 6) {
  const positions = [];
  const occupied = new Set();
  let col = 0;
  let row = 0;
  let prevSymbol = null;

  for (const it of items) {
    if (prevSymbol === null || it.symbol !== prevSymbol) {
      // New column — pack into the leftmost column whose top cell is empty
      col = 0;
      row = 0;
      while (occupied.has(`${col},0`)) col += 1;
    } else {
      const downKey = `${col},${row + 1}`;
      if (row + 1 < rows && !occupied.has(downKey)) {
        row += 1;
      } else {
        // Turn right at the same row; skip any cells already taken
        col += 1;
        while (occupied.has(`${col},${row}`)) col += 1;
      }
    }
    occupied.add(`${col},${row}`);
    positions.push({ symbol: it.symbol, col, row });
    prevSymbol = it.symbol;
  }

  let maxCol = -1;
  for (const p of positions) if (p.col > maxCol) maxCol = p.col;
  return { positions, maxCol };
}

// Derive marks (R = regular, I = irregular) for Big Eye Boy (offset=1),
// Small Road (offset=2), Cockroach Road (offset=3).
//
// For each hand in Big Road order:
// - If it starts a new column (row 0): compare the previous column's length
//   to the column `offset` further back. If equal → R, else → I.
// - If it extends a column (row > 0): does the column `offset` back have
//   a cell at this row? Yes → R, No → I.
export function deriveRoadMarks(streaks, offset) {
  const marks = [];
  for (let s = 0; s < streaks.length; s++) {
    const len = streaks[s].length;
    for (let r = 0; r < len; r++) {
      if (r === 0) {
        const prevCol = s - 1;
        const compareCol = s - 1 - offset;
        if (compareCol < 0) continue;
        const prevLen = streaks[prevCol].length;
        const compareLen = streaks[compareCol].length;
        marks.push({ symbol: prevLen === compareLen ? 'R' : 'I' });
      } else {
        const compareCol = s - offset;
        if (compareCol < 0) continue;
        const compareLen = streaks[compareCol].length;
        marks.push({ symbol: compareLen > r ? 'R' : 'I' });
      }
    }
  }
  return marks;
}
