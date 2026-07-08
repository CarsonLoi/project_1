// Hourly-chart styling knobs (pricing). EDIT to tune the stacked + line
// charts independently of the rest of the dashboard.
// ======================================================================

// In-bar value-LABEL font color, PER table-minimum. Key = the tier's $
// minimum. Set each minimum's label color independently (e.g. dark text on
// light bars, white on dark bars). Falls back to MIN_LABEL_DEFAULT.
export const MIN_LABEL_DEFAULT = '#ffffff';
export const MIN_LABEL_COLOR = {
    50: '#ffffff',
    100: '#ffffff',
    200: '#ffffff',
    300: '#ffffff',
    500: '#0a1a2c',
    800: '#0a1a2c',
    1000: '#ffffff',
    1500: '#ffffff',
    2000: '#ffffff',
    3000: '#ffffff',
    5000: '#ffffff',
    10000: '#ffffff',
};
export const minLabelColor = (min) =>
    (Object.prototype.hasOwnProperty.call(MIN_LABEL_COLOR, min) ? MIN_LABEL_COLOR[min] : MIN_LABEL_DEFAULT);

// Black border drawn around every stacked-series segment.
export const SERIES_BORDER_COLOR = '#000000';
export const SERIES_BORDER_WIDTH = 1;
