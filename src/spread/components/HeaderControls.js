// HeaderControls — the dashboard top bar
// =======================================
//
// Extracted from SpreadDashboard so the page-level component doesn't
// drown in toolbar markup. Holds everything the user touches BEFORE
// editing assignments:
//
//   • Title + version + UNSAVED badge
//   • Target date picker
//   • Active-version dropdown for the target date
//   • View-mode toggle (Overall ↔ Hourly)
//   • Reference Spread dropdown (None / All / Other…)
//   • Discard / Save / Refresh actions
//
// All state lives in the parent — this is a presentational shell.

import React from 'react';
import {
    Box, Stack, Typography, Button, IconButton, Tooltip, TextField,
    Select, MenuItem, FormControl, InputLabel, ToggleButtonGroup, ToggleButton, Checkbox, ListItemText,
} from '@mui/material';
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider';
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs';
import { DatePicker } from '@mui/x-date-pickers/DatePicker';
import dayjs from 'dayjs';
import UndoIcon from '@mui/icons-material/Undo';
import RefreshIcon from '@mui/icons-material/Refresh';
import LibraryAddCheckIcon from '@mui/icons-material/LibraryAddCheck';
import GridViewIcon from '@mui/icons-material/GridView';
import ScheduleIcon from '@mui/icons-material/Schedule';
import FileDownloadIcon from '@mui/icons-material/FileDownload';
import FileUploadIcon from '@mui/icons-material/FileUpload';

// "2026-06-10" → "Jun 10" — used in the reference dropdown so each
// version entry reads naturally (e.g. "Jun 10 v2") instead of leaking
// the ISO date.
const SHORT_MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
function shortDate(iso) {
    if (!iso || typeof iso !== 'string' || iso.length < 10) return iso || '';
    const m = parseInt(iso.slice(5, 7), 10);
    const d = parseInt(iso.slice(8, 10), 10);
    if (!m || !d) return iso;
    return `${SHORT_MONTHS[m - 1]} ${d}`;
}

// Compact multi-select dropdown matching the other HeaderControls fields.
// Supports "Select all" and "Clear all" convenience items (like the
// pricing dashboard's DropdownSelector), and shows the picked labels in
// the trigger. Options like ['MS','PM'] or a list of sub-segment names.
function FilterSelect({ label, value = [], onChange, options = [], width = 130 }) {
    const handle = (e) => {
        const v = e.target.value;
        if (v.includes('__all__')) { onChange(options.slice()); return; }
        if (v.includes('__clear__')) { onChange([]); return; }
        onChange(v);
    };
    return (
        <FormControl size="small" sx={{ minWidth: width, '& .MuiInputBase-root': { height: 40 } }}>
            <InputLabel sx={{ color: 'rgba(255,255,255,0.55)' }}>{label}</InputLabel>
            <Select
                multiple displayEmpty
                value={value} onChange={handle} label={label}
                renderValue={(sel) => (sel.length === 0 ? `All ${label.toLowerCase()}` : sel.join(', '))}
                MenuProps={{ PaperProps: { sx: { maxHeight: 380, bgcolor: 'rgba(18,22,34,0.98)', color: '#fff', border: '1px solid rgba(122,200,220,0.25)' } } }}
                sx={{ color: '#fff', fontSize: 14 }}
            >
                <MenuItem value="__all__" sx={{ fontSize: 13, fontWeight: 700, color: '#7adfff', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>Select all</MenuItem>
                <MenuItem value="__clear__" sx={{ fontSize: 13, fontWeight: 700, color: '#f7768e', borderBottom: '1px solid rgba(255,255,255,0.12)' }}>Clear all</MenuItem>
                {options.map((o) => (
                    <MenuItem key={o} value={o} sx={{ fontSize: 14, py: 0.2 }}>
                        <Checkbox checked={value.includes(o)} size="small" sx={{ p: 0.4, color: 'rgba(255,255,255,0.35)', '&.Mui-checked': { color: '#7adfff' } }} />
                        <ListItemText primary={o} sx={{ '& .MuiListItemText-primary': { fontSize: 14 } }} />
                    </MenuItem>
                ))}
            </Select>
        </FormControl>
    );
}

export default function HeaderControls({
    // Target date
    targetDate, setTargetDate,

    // Versions for the target date (dropdown of historical spreads)
    targetVersions,             // array (oldest first by versionNumber)
    activeVersionId, onActivateVersion,

    // View toggle
    viewMode,                   // 'overall' | 'hourly'
    onViewMode,

    // App mode toggle — 'plan' editor vs 'compare' two-plan variance
    appMode,                    // 'plan' | 'compare'
    onAppMode,

    // Reference
    referenceMode,              // 'none' | 'all' | 'other'
    referenceVersionId,         // when mode==='all', the picked version id
    onReferenceModeChange,      // (mode) => void; 'other' opens dialog; 'tv:<id>' picks a target-date version
    referenceLabel,             // human label shown next to the dropdown when not 'none'

    // Dirty/save state
    dirty,
    onRevert,
    onSaveNew,
    onReload,

    // Export / Import the whole store as a .json file
    onExport,
    onImportFile,               // (File) => void
    onExportSpread,             // () => void — temp spread file for DB upload

    // Filter slicers — Area (MS / PM), Sub-segment, Game. Purely visible
    // state (never gate the floor's interactivity) — used to filter the
    // Coverage report + summary counts. [] = no filter (all).
    areaFilter = [], setAreaFilter,     // ['MS','PM']
    subFilter  = [], setSubFilter,      // sub-segment names
    gtFilter   = [], setGtFilter,       // gametypes
    availableSubs = [],
    availableGames = [],
}) {
    const importInputRef = React.useRef(null);

    return (
        <Stack
            direction="row"
            alignItems="center"
            spacing={1.2}
            sx={{ mb: 1.5, flexWrap: 'wrap', rowGap: 1 }}
        >
            {/* Title block */}
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mr: 1 }}>
                <Box sx={{ width: 4, height: 28, bgcolor: '#7adfff', borderRadius: 1 }} />
                <Typography sx={{ color: '#dff5ff', fontSize: 20, fontWeight: 700 }}>
                    Table Spread Scheduling
                </Typography>
                {dirty && (
                    <Box component="span" sx={{
                        ml: 0.6, px: 0.8, py: 0.1, borderRadius: 0.6,
                        bgcolor: 'rgba(247,181,0,0.2)',
                        color: '#f7b500', fontSize: 11, fontWeight: 800, letterSpacing: 0.6,
                    }}>
                        UNSAVED
                    </Box>
                )}
            </Box>

            {/* Target date picker — calendar popover (MUI X DatePicker). */}
            <LocalizationProvider dateAdapter={AdapterDayjs}>
                <DatePicker
                    label="Target date"
                    value={targetDate ? dayjs(targetDate) : null}
                    onChange={(v) => setTargetDate(v && v.isValid() ? v.format('YYYY-MM-DD') : '')}
                    format="YYYY-MM-DD"
                    slotProps={{
                        textField: {
                            size: 'small',
                            sx: {
                                minWidth: 170,
                                '& .MuiInputBase-root': { height: 40 },
                                '& input': { color: '#fff', fontSize: 14 },
                                '& label':  { color: 'rgba(255,255,255,0.55)' },
                                '& .MuiSvgIcon-root': { color: 'rgba(122,223,255,0.8)' },
                                '& .MuiOutlinedInput-notchedOutline': { borderColor: 'rgba(255,255,255,0.18)' },
                                '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: 'rgba(122,223,255,0.5)' },
                            },
                        },
                    }}
                />
            </LocalizationProvider>

            {/* Active version dropdown. v0 = the LIVE spread database for
                this date (re-extracted on every date change, never saved).
                v1+ = your saved adjustments (localStorage / imported JSON). */}
            <FormControl size="small" sx={{ minWidth: 160, '& .MuiInputBase-root': { height: 40 } }}>
                <InputLabel sx={{ color: 'rgba(255,255,255,0.55)' }}>Active version</InputLabel>
                <Select
                    value={activeVersionId || ''}
                    onChange={(e) => onActivateVersion(e.target.value)}
                    label="Active version"
                    sx={{ color: '#fff', fontSize: 14 }}
                >
                    {(targetVersions || [])
                        .slice()
                        .sort((a, b) => (b.versionNumber || 0) - (a.versionNumber || 0))
                        .map((v) => (
                            <MenuItem key={v.versionId} value={v.versionId}>
                                v{v.versionNumber}
                                {v.notes ? ` — ${v.notes.slice(0, 24)}` : ''}
                            </MenuItem>
                        ))}
                </Select>
            </FormControl>

            {/* (Config-snapshot date moved to the on-map "Planning for"
                info card, alongside the target date + save time, so the
                three dates are read together and never confused.) */}

            {/* View toggle — Overall vs Hourly */}
            <ToggleButtonGroup
                value={viewMode}
                exclusive
                onChange={(_, v) => v && onViewMode(v)}
                size="small"
                sx={{
                    height: 40,
                    '& .MuiToggleButton-root': {
                        height: 40, py: 0,
                        textTransform: 'none', fontSize: 13, fontWeight: 700,
                        color: 'rgba(255,255,255,0.65)',
                        borderColor: 'rgba(122,200,220,0.3)',
                        px: 1.6,
                        '&.Mui-selected': {
                            bgcolor: '#7adfff',
                            color: '#0a1a2c',
                            '&:hover': { bgcolor: '#a0e8ff' },
                        },
                    },
                }}
            >
                <ToggleButton value="overall">
                    <GridViewIcon sx={{ fontSize: 16, mr: 0.4 }} /> Overall
                </ToggleButton>
                <ToggleButton value="hourly">
                    <ScheduleIcon sx={{ fontSize: 16, mr: 0.4 }} /> Hourly
                </ToggleButton>
            </ToggleButtonGroup>

            {/* Reference dropdown — every target-date version is its own
                entry (e.g. "Jun 10 v1", "Jun 10 v2"). Picking one sets
                reference to that specific version directly; no separate
                "all" cycler step is required. */}
            <FormControl size="small" sx={{ minWidth: 180, '& .MuiInputBase-root': { height: 40 } }}>
                <InputLabel sx={{ color: 'rgba(255,255,255,0.55)' }}>Reference</InputLabel>
                <Select
                    value={
                        referenceMode === 'all'   ? `tv:${referenceVersionId || ''}`
                      : referenceMode === 'other' ? 'other'
                      :                              'none'
                    }
                    onChange={(e) => onReferenceModeChange(e.target.value)}
                    label="Reference"
                    sx={{ color: '#fff', fontSize: 14 }}
                    renderValue={(v) => {
                        if (v === 'none') return 'None';
                        if (v === 'other') return referenceLabel ? `Other · ${referenceLabel}` : 'Other…';
                        if (typeof v === 'string' && v.startsWith('tv:')) {
                            const id = v.slice(3);
                            const ver = (targetVersions || []).find((x) => x.versionId === id);
                            return ver
                                ? `${shortDate(targetDate)} v${ver.versionNumber}`
                                : 'Reference';
                        }
                        return 'Reference';
                    }}
                >
                    <MenuItem value="none">None (no reference)</MenuItem>
                    {(targetVersions || []).length > 0 && (
                        <Typography sx={{
                            px: 1.5, pt: 0.6, pb: 0.2,
                            fontSize: 10, fontWeight: 700, letterSpacing: 1,
                            color: 'rgba(255,255,255,0.4)',
                        }}>
                            FROM TARGET DATE
                        </Typography>
                    )}
                    {(targetVersions || [])
                        .slice()
                        .sort((a, b) => (b.versionNumber || 0) - (a.versionNumber || 0))
                        .map((v) => (
                            <MenuItem key={v.versionId} value={`tv:${v.versionId}`}>
                                {shortDate(targetDate)} v{v.versionNumber}
                                {v.notes ? ` — ${v.notes.slice(0, 18)}` : ''}
                            </MenuItem>
                        ))}
                    <MenuItem value="other">Other date…</MenuItem>
                </Select>
            </FormControl>

            {/* Filter slicers — visible state (do NOT gate the floor).
                Drive the Coverage report + summary counts so users can
                slice metrics by area / sub-segment / game while the floor
                stays fully editable. */}
            <FilterSelect
                label="Area" value={areaFilter} onChange={setAreaFilter}
                options={['MS', 'PM']} width={110}
            />
            <FilterSelect
                label="Sub-seg" value={subFilter} onChange={setSubFilter}
                options={availableSubs} width={140}
            />
            <FilterSelect
                label="Game" value={gtFilter} onChange={setGtFilter}
                options={availableGames} width={130}
            />

            {/* App-mode toggle — sits right of the Reference dropdown so
                the plan editor and the two-plan comparison share a row. */}
            {onAppMode && (
                <ToggleButtonGroup
                    value={appMode}
                    exclusive
                    onChange={(_, v) => v && onAppMode(v)}
                    size="small"
                    sx={{
                        height: 40,
                        '& .MuiToggleButton-root': {
                            height: 40, py: 0,
                            textTransform: 'none', fontSize: 13, fontWeight: 700,
                            color: 'rgba(255,255,255,0.65)',
                            borderColor: 'rgba(122,200,220,0.3)',
                            px: 1.6,
                            '&.Mui-selected': {
                                bgcolor: '#7adfff',
                                color: '#0a1a2c',
                                '&:hover': { bgcolor: '#a0e8ff' },
                            },
                        },
                    }}
                >
                    <ToggleButton value="plan">Plan</ToggleButton>
                    <ToggleButton value="compare">Compare</ToggleButton>
                </ToggleButtonGroup>
            )}

            <Box sx={{ flex: 1 }} />

            {/* Right-edge actions */}
            <Tooltip title="Discard unsaved edits">
                <span>
                    <IconButton
                        onClick={onRevert}
                        disabled={!dirty}
                        size="small"
                        sx={{
                            color: dirty ? 'rgba(255,255,255,0.7)' : 'rgba(255,255,255,0.25)',
                            border: '1px solid',
                            borderColor: dirty ? 'rgba(255,255,255,0.15)' : 'rgba(255,255,255,0.06)',
                            '&:hover': { borderColor: 'rgba(247,181,0,0.5)', color: '#f7b500' },
                        }}
                    >
                        <UndoIcon fontSize="small" />
                    </IconButton>
                </span>
            </Tooltip>

            <Button
                onClick={onSaveNew}
                disabled={!dirty}
                startIcon={<LibraryAddCheckIcon />}
                sx={{
                    textTransform: 'none', fontSize: 14, fontWeight: 700,
                    bgcolor: dirty ? '#7adfff' : 'rgba(255,255,255,0.05)',
                    color: dirty ? '#0a1a2c' : 'rgba(255,255,255,0.3)',
                    '&:hover': { bgcolor: dirty ? '#a0e8ff' : 'rgba(255,255,255,0.05)' },
                    px: 2,
                }}
            >
                Save as new version
            </Button>

            <Tooltip title="Reload from storage">
                <IconButton
                    onClick={onReload}
                    size="small"
                    sx={{
                        color: 'rgba(255,255,255,0.7)',
                        border: '1px solid rgba(255,255,255,0.15)',
                        '&:hover': { borderColor: 'rgba(122,223,255,0.5)' },
                    }}
                >
                    <RefreshIcon fontSize="small" />
                </IconButton>
            </Tooltip>

            {/* Export the target-date plan as a temp spread file (per-hour
                binary) for re-uploading to the spread database. */}
            {onExportSpread && (
                <Tooltip title="Export this date's plan as a spread file for upload">
                    <Button
                        onClick={onExportSpread}
                        startIcon={<FileDownloadIcon sx={{ fontSize: 18 }} />}
                        sx={{
                            textTransform: 'none', fontSize: 13, fontWeight: 700,
                            color: '#7adfff', border: '1px solid rgba(122,223,255,0.4)',
                            px: 1.4,
                            '&:hover': { bgcolor: 'rgba(122,223,255,0.08)', borderColor: '#7adfff' },
                        }}
                    >
                        Export spread
                    </Button>
                </Tooltip>
            )}

            {/* Export — download the whole store as one .json backup. */}
            {onExport && (
                <Tooltip title="Export all schedules to a JSON file">
                    <IconButton
                        onClick={onExport}
                        size="small"
                        sx={{
                            color: 'rgba(255,255,255,0.7)',
                            border: '1px solid rgba(255,255,255,0.15)',
                            '&:hover': { borderColor: 'rgba(122,223,255,0.5)', color: '#7adfff' },
                        }}
                    >
                        <FileDownloadIcon fontSize="small" />
                    </IconButton>
                </Tooltip>
            )}

            {/* Import — load a previously-exported .json back in. The
                hidden input is triggered by the button; resetting its
                value on each open lets the user re-pick the same file. */}
            {onImportFile && (
                <>
                    <input
                        ref={importInputRef}
                        type="file"
                        accept="application/json,.json"
                        style={{ display: 'none' }}
                        onChange={(e) => {
                            const file = e.target.files && e.target.files[0];
                            if (file) onImportFile(file);
                            e.target.value = '';
                        }}
                    />
                    <Tooltip title="Import schedules from a JSON file">
                        <IconButton
                            onClick={() => importInputRef.current && importInputRef.current.click()}
                            size="small"
                            sx={{
                                color: 'rgba(255,255,255,0.7)',
                                border: '1px solid rgba(255,255,255,0.15)',
                                '&:hover': { borderColor: 'rgba(122,223,255,0.5)', color: '#7adfff' },
                            }}
                        >
                            <FileUploadIcon fontSize="small" />
                        </IconButton>
                    </Tooltip>
                </>
            )}
        </Stack>
    );
}
