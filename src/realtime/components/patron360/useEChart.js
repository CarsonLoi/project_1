// One ECharts instance per mounted element: init once, replace the
// option on change, follow the element's size, dispose on unmount.

import { useEffect, useRef } from 'react';
import * as echarts from 'echarts';

export default function useEChart(option, onEvents) {
    const ref = useRef(null);
    const inst = useRef(null);
    const events = useRef(onEvents);
    events.current = onEvents;

    useEffect(() => {
        const el = ref.current;
        if (!el) return undefined;
        const chart = echarts.init(el);
        inst.current = chart;
        for (const name of ['click', 'legendselectchanged', 'updateAxisPointer', 'globalout']) {
            chart.on(name, (p) => events.current && events.current[name] && events.current[name](p));
        }
        const ro = new ResizeObserver(() => chart.resize());
        ro.observe(el);
        return () => { ro.disconnect(); chart.dispose(); inst.current = null; };
    }, []);

    useEffect(() => {
        if (inst.current && option) inst.current.setOption(option, { notMerge: true });
    }, [option]);

    // The live instance, for small updates (a hover cursor) that should
    // not rebuild the whole option.
    ref.inst = inst;
    return ref;
}

// A series that only carries a vertical cursor line; update it by id.
export const CURSOR_ID = '__cursor';
export const cursorSeries = (color = '#7aa2f7') => ({
    id: CURSOR_ID, type: 'line', data: [], silent: true, tooltip: { show: false },
    markLine: { silent: true, symbol: 'none', animation: false, label: { show: false }, lineStyle: { color, width: 1.5, type: 'solid' }, data: [] },
});
export function setCursor(ref, xAxis) {
    const c = ref.inst && ref.inst.current;
    if (!c) return;
    c.setOption({ series: [{ id: CURSOR_ID, markLine: { data: xAxis == null ? [] : [{ xAxis }] } }] });
}
