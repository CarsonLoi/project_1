import React from 'react';
import { FormControl, InputLabel, Select, MenuItem, OutlinedInput, Checkbox, ListItemText, Divider, Box } from '@mui/material';

const DropdownSelector = ({ label, availableOptions, selectedOptions, setSelectedOptions, multiple = true, width = 160 }) => {

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
                renderValue={(selected) => (multiple ? selected.join(', ') : selected)}
                MenuProps={{
                    PaperProps: {
                        style: {
                            maxHeight: 48 * 6 + 8,
                            width: 250,
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
                        <ListItemText primary={option} />
                    </MenuItem>
                ))}
            </Select>
        </FormControl>
    );
};

export default DropdownSelector;
