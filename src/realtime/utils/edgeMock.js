// Mock live house edge — one deterministic path per shoe per bet option.
// ======================================================================
// The table row's live edge and the shoe feed's per-hand edge must agree
// (the map ring and the hand-by-hand chart show the same number), so both
// read the same path: the row takes its last value, the shoe every value.

import { PATRON_360 } from '../constants/rtConfig';
import { hashKey, mulberry32 } from './shoeData';

const { BET_OPTIONS } = PATRON_360;
const SIDE_CODES = BET_OPTIONS.filter((o) => o.side).map((o) => o.code);

function gaussFrom(rand) {
    let u = 0;
    while (!u) u = rand();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
}

// About one shoe in five has a side option that the cards have turned
// against the house — enough for rings and a counter seat in mock mode.
export function hotOption(shoeKey) {
    const h = hashKey(`hot|${shoeKey}`);
    return h % 5 === 0 ? SIDE_CODES[(h >>> 3) % SIDE_CODES.length] : null;
}

// Brownian bridge from the option's theo to its end value over n hands.
export function mockEdgePath(shoeKey, code, n) {
    const opt = BET_OPTIONS.find((o) => o.code === code);
    if (!opt || n < 1) return [];
    const rand = mulberry32(hashKey(`edge|${shoeKey}|${code}`));
    const theo = opt.theo;
    const scale = opt.side ? 0.42 : 0.3;
    let end = theo + gaussFrom(rand) * theo * scale * Math.sqrt(Math.min(n, 80) / 70);
    if (hotOption(shoeKey) === code) end = -(0.6 + rand() * 5.4);
    if (n === 1) return [+end.toFixed(2)];
    const walk = [0];
    for (let h = 1; h < n; h++) walk.push(walk[h - 1] + gaussFrom(rand));
    const last = walk[n - 1];
    const amp = theo * (opt.side ? 0.12 : 0.05);
    return walk.map((w, h) => {
        const f = h / (n - 1);
        return +(theo + (end - theo) * f + amp * (w - last * f)).toFixed(2);
    });
}

export function mockEdgePaths(shoeKey, n) {
    return Object.fromEntries(BET_OPTIONS.map((o) => [o.code, mockEdgePath(shoeKey, o.code, n)]));
}
