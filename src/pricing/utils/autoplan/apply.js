// Write a solved draft into the store: a version of each date first, then
// the block's price into every hour of the block (open hours only when a
// schedule is known). Saves once.

import { CORE_HOURS, blockHours } from './core';
import { savePricing } from '../pricingStorage';

export function applyDraft(store, draft, { openHoursByDate = {}, pinsByDate = {}, versionName = 'Before Auto-plan', now = new Date() } = {}) {
    const plans = { ...(store.plans || {}) };
    for (const date of Object.keys(draft)) {
        const plan = plans[date] || { byDaypart: {}, versions: [], activeVersionId: null };
        const versions = plan.versions || [];
        const versionNumber = versions.reduce((m, v) => Math.max(m, v.versionNumber || 0), 0) + 1;
        const snapshot = {
            versionId: `v_${now.getTime()}_${date.replace(/-/g, '')}`,
            versionNumber, name: versionName, savedAt: now.toISOString(),
            byDaypart: JSON.parse(JSON.stringify(plan.byDaypart || {})),
        };
        const byDaypart = { ...(plan.byDaypart || {}) };
        const openHours = openHoursByDate[date] || null;
        for (const core of CORE_HOURS) {
            const assign = draft[date][core];
            if (!assign) continue;
            const pins = ((pinsByDate[date] || {})[core]) || new Map();
            for (const h of blockHours(core)) {
                const openH = openHours ? openHours.get(h) : null;
                const assignments = {};
                for (const [k, tier] of assign) {
                    if (openH && !openH.has(k)) continue;
                    assignments[k] = { base: tier, min: tier, max: tier, src: 'auto', ...(pins.has(k) ? { pin: true } : {}) };
                }
                byDaypart[`h_${h}`] = { assignments };
            }
        }
        plans[date] = { ...plan, byDaypart, versions: [...versions, snapshot], activeVersionId: snapshot.versionId };
    }
    return savePricing({ ...store, plans });
}
