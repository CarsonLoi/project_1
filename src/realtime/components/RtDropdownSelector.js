import React from 'react';
import { FormControl, InputLabel, Select, MenuItem, OutlinedInput, Checkbox, ListItemText, Divider, Box } from '@mui/material';
import { kpiDisplayLabel } from '../vendor/heatmapConstants';

/**
 * DropdownSelector props
 * ----------------------
 *   label              — text shown above the closed control
 *   availableOptions   — string[] of all selectable values
 *   selectedOptions    — current value (string when multiple=false; string[] when multiple=true)
 *   setSelectedOptions — setter the parent passes in
 *   multiple           — when true, enables the checkbox + "Select All / Clear All" UX
 *
 *   width              — closed-control width in px (default 160). Override when a
 *                        toolbar slot needs the control itself to be wider.
 *   menuWidth          — open-popup width in px. Defaults to
 *                        `Math.max(width, 250)` so the popup never shows narrower
 *                        than the control. Override explicitly when the control
 *                        is narrow but the option labels are long — e.g.
 *                        <DropdownSelector label="KPI" width={140} menuWidth={320} />.
 */
const RtDropdownSelector = ({
    label,
    availableOptions,
    selectedOptions,
    setSelectedOptions,
    multiple = true,
    width = 160,
    menuWidth,
}) => {
    const effectiveMenuWidth = menuWidth ?? Math.max(width, 250);

    const handleChange = (event) => {
        const {
            target: { value },
        } = event;

        // Check for special "Select All" or "Clear All" items
        if (multiple) {
            if (value.includes('Select All')) {
                setSelectedOptions(availableOptions);
                return;
            }
            if (value.includes('Clear All')) {
                setSelectedOptions([]);
                return;
            }
        }

        setSelectedOptions(
            typeof value === 'string' ? value.split(',') : value,
        );
    };

    return (
        <FormControl sx={{ m: 1, width: width }} size="small">
            <InputLabel id={`${label}-label`} sx={{ color: 'rgba(255,255,255,0.7)' }}>{label}</InputLabel>
            <Select
                labelId={`${label}-label`}
                id={`${label}-select`}
                multiple={multiple}
                value={selectedOptions}
                onChange={handleChange}
                input={<OutlinedInput label={label} sx={{ color: '#fff', '& .MuiOutlinedInput-notchedOutline': { borderColor: 'rgba(255,255,255,0.3)' } }} />}
                renderValue={(selected) => (multiple ? selected.map(kpiDisplayLabel).join(', ') : kpiDisplayLabel(selected))}
                MenuProps={{
                    PaperProps: {
                        style: {
                            // No maxHeight cap — the dropdown grows to fit
                            // every option without an inner scrollbar. The
                            // viewport's own scroll handles the rare case
                            // where the option list exceeds screen height
                            // (MUI's Popper still clamps to viewport).
                            //
                            // Popup width follows the `menuWidth` prop
                            // (falls back to max(width, 250) so the popup
                            // is never narrower than the control). Pass
                            // `menuWidth` explicitly when the control is
                            // narrow but option labels are long.
                            width: effectiveMenuWidth,
                            backgroundColor: 'rgba(50,52,72,1)',
                            color: '#fff'
                        },
                    },
                }}
            >
                {multiple && [
                    <MenuItem key="select-all" value="Select All" sx={{ color: '#7aa2f7' }}>
                        <ListItemText primary="Select All" />
                    </MenuItem>,
                    <MenuItem key="clear-all" value="Clear All" sx={{ color: '#f7768e' }}>
                        <ListItemText primary="Clear All" />
                    </MenuItem>,
                    <Divider key="divider" sx={{ bgcolor: 'rgba(255,255,255,0.1)', my: 0.5 }} />
                ]}
                {availableOptions.map((option) => (
                    <MenuItem key={option} value={option} sx={{ '&.Mui-selected': { backgroundColor: 'rgba(255,255,255,0.1)' } }}>
                        {multiple && <Checkbox checked={selectedOptions.indexOf(option) > -1} sx={{ color: 'rgba(255,255,255,0.5)', '&.Mui-checked': { color: '#7aa2f7' } }} />}
                        <ListItemText primary={kpiDisplayLabel(option)} />
                    </MenuItem>
                ))}
            </Select>
        </FormControl>
    );
};

export default RtDropdownSelector;
