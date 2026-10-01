// Table focus — shared colours and helpers.

import { PATRON_360 } from '../../constants/rtConfig';
import { CARD_TIERS } from '../../../live/constants/winPalette';
import { STATE, TEXT } from '../../constants/rtTheme';

// One identity colour per seat, shared by the table, the charts and the
// trend board, so "S5" is the same colour everywhere.
export const SEAT_COLORS = ['#7aa2f7', '#f2c14e', '#6ad08f', '#ff7eb6', '#7dcfff', '#ff9e64', '#c0a6ff'];
export const seatColor = (seat) => SEAT_COLORS[(seat - 1) % SEAT_COLORS.length];

export const MAGENTA = 'rgb(214,92,255)';
export const MAGENTA_TEXT = 'rgb(235,150,255)';

export const OPT = new Map(PATRON_360.BET_OPTIONS.map((o) => [o.code, o]));
export const optColor = (code) => (OPT.get(code) || {}).color || '#8a93b2';

export const tierColor = (cardType) => (CARD_TIERS[cardType] || CARD_TIERS.BASE).accent;

export const VERDICT = {
    ACTION: { text: '▲ ACTION', color: STATE.negative },
    WATCH: { text: '◆ WATCH', color: STATE.warning },
    CLEAR: { text: 'CLEAR', color: STATE.positive },
    'NO DATA': { text: 'NO DATA', color: TEXT.muted },
};

export const RESULT_COLOR = { B: '#e5484d', P: '#3e63dd', T: '#30a46c' };
export const RESULT_ZH = { B: '庄', P: '闲', T: '和' };

export const shortId = (id) => String(id || '').slice(-4);
