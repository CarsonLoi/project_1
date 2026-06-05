// 2D layout schema for the baccarat table, consumed by the 3D renderer.
// Coordinates are in meters. The table sits on the XZ plane with Y up.
// Dealer is at -Z, players are at +Z.

export const TABLE = {
  width: 4.5,        // X span (left-right, dealer's POV)
  depth: 2.4,        // Z span (front-back)
  height: 0.78,      // distance from floor to felt
  feltColor: '#0a6b3a',
  railColor: '#3a1f10',
  cornerRadius: 0.55,
};

// Betting regions, defined as 2D rectangles on the felt.
// box = [xMin, zMin, xMax, zMax].
export const REGIONS = [
  {
    id: 'player',
    label: 'PLAYER',
    sub: '闲 · 1:1',
    box: [-1.55, 0.05, -0.22, 0.75],
    fill: '#1e4d8a',
    stroke: '#7cb4ff',
  },
  {
    id: 'banker',
    label: 'BANKER',
    sub: '庄 · 1:0.95',
    box: [0.22, 0.05, 1.55, 0.75],
    fill: '#8a1e1e',
    stroke: '#ff8a8a',
  },
  {
    id: 'tie',
    label: 'TIE',
    sub: '和 · 8:1',
    box: [-0.2, 0.05, 0.2, 0.45],
    fill: '#0e5a2a',
    stroke: '#7cff9a',
  },
  {
    id: 'player_pair',
    label: 'P PAIR',
    sub: '闲对 · 11:1',
    box: [-1.55, -0.25, -0.9, 0.05],
    fill: '#143560',
    stroke: '#7cb4ff',
  },
  {
    id: 'banker_pair',
    label: 'B PAIR',
    sub: '庄对 · 11:1',
    box: [0.9, -0.25, 1.55, 0.05],
    fill: '#601414',
    stroke: '#ff8a8a',
  },
];

// Where dealt cards land.
export const CARD_SLOTS = {
  player: { x: -0.55, z: -0.55 },
  banker: { x: 0.55, z: -0.55 },
};

// Dealer-side equipment positions.
export const SHOE = { x: 1.55, z: -0.85, w: 0.28, h: 0.20, d: 0.36 };
export const DISCARD = { x: -1.55, z: -0.85, w: 0.32, h: 0.06, d: 0.28 };

// Helper: convert a region box to its center point + size.
export function regionCenter(region) {
  const [x1, z1, x2, z2] = region.box;
  return {
    x: (x1 + x2) / 2,
    z: (z1 + z2) / 2,
    w: x2 - x1,
    d: z2 - z1,
  };
}

// Chip denominations (color, value) — for stack rendering.
export const CHIP_DENOMS = [
  { value: 1000, color: '#5a2bff', stripe: '#fff' },
  { value: 500,  color: '#8a2be2', stripe: '#fff' },
  { value: 100,  color: '#222',    stripe: '#fff' },
  { value: 25,   color: '#0a8a3a', stripe: '#fff' },
  { value: 5,    color: '#c0392b', stripe: '#fff' },
  { value: 1,    color: '#f0f0f0', stripe: '#222' },
];
