// Pod-limit exemption for a locked or manually priced table: does it count
// toward the pod rules (e.g. "each pod at most 1 × $1,000")? Value is []
// (counts), ['*'] (exempt from every pod rule) or [ruleId] (exempt from one).

import React from 'react';
import { MenuItem, Select } from '@mui/material';
import { AP, inputSx, selectMenuProps } from './apStyles';

const toKey = (v) => (!v || !v.length ? 'counts' : v.includes('*') ? 'all' : `r:${v[0]}`);
const fromKey = (k) => (k === 'counts' ? [] : k === 'all' ? ['*'] : [Number(k.slice(2))]);

export default function ExemptSelect({ value, onChange, podRules, label = 'Pod limits', compact = false, disabled = false }) {
    const key = toKey(value);
    const known = key === 'counts' || key === 'all' || podRules.some((r) => `r:${r.id}` === key);
    return (
        <Select size="small" value={known ? key : 'counts'} disabled={disabled} MenuProps={selectMenuProps}
            inputProps={{ 'aria-label': label }} onChange={(e) => onChange(fromKey(e.target.value))}
            sx={{ ...inputSx, minWidth: compact ? 132 : 210, '& .MuiSelect-select': { py: compact ? 0.4 : 0.9, fontSize: compact ? 12.5 : 13.5 }, ...(key !== 'counts' ? { '& .MuiOutlinedInput-notchedOutline': { borderColor: AP.warn } } : {}) }}>
            <MenuItem value="counts">Counts toward pod limits</MenuItem>
            <MenuItem value="all" disabled={!podRules.length}>Exempt from all pod limits</MenuItem>
            {podRules.map((r) => <MenuItem key={r.id} value={`r:${r.id}`}>{`Exempt from: ${r.text}`}</MenuItem>)}
        </Select>
    );
}
