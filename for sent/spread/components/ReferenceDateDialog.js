// ReferenceDateDialog — pop-up for "Other" reference selection
// ============================================================
//
// Fires when the user picks "Other…" in the Reference dropdown.
// Lets them choose any date that has a saved schedule + any version
// within it.

import React, { useState, useEffect } from 'react';
import {
    Dialog, DialogTitle, DialogContent, DialogActions,
    TextField, Select, MenuItem, Button, FormControl, InputLabel,
    Stack, Typography, Box,
} from '@mui/material';

export default function ReferenceDateDialog({
    open,
    onClose,
    onConfirm,           // ({ date, versionId }) => void
    store,               // the schedule store — for available dates / versions
    initialDate,
    initialVersionId,
}) {
    const [date, setDate]            = useState(initialDate || '');
    const [versionId, setVersionId]  = useState(initialVersionId || '');

    // When the dialog reopens with a different seed, refresh local state.
    useEffect(() => {
        if (open) {
            setDate(initialDate || '');
            setVersionId(initialVersionId || '');
        }
    }, [open, initialDate, initialVersionId]);

    const availableDates = Object.keys(store?.schedules || {}).sort();
    const versionsForDate = (store?.schedules?.[date]?.versions) || [];

    // Auto-select the most-recent version on date change so the user
    // doesn't have to pick a version most of the time.
    useEffect(() => {
        if (!versionsForDate.length) {
            setVersionId('');
            return;
        }
        if (!versionsForDate.find((v) => v.versionId === versionId)) {
            const newest = [...versionsForDate]
                .sort((a, b) => (b.versionNumber || 0) - (a.versionNumber || 0))[0];
            setVersionId(newest?.versionId || '');
        }
    }, [date, versionsForDate, versionId]);

    const canConfirm = !!(date && versionId);

    return (
        <Dialog
            open={open}
            onClose={onClose}
            PaperProps={{
                sx: {
                    bgcolor: 'rgba(22, 24, 38, 0.98)',
                    border: '1px solid rgba(122, 200, 220, 0.25)',
                    minWidth: 380,
                },
            }}
        >
            <DialogTitle sx={{
                color: '#7adfff', fontSize: 17, fontWeight: 800,
                letterSpacing: 0.4, borderBottom: '1px solid rgba(255,255,255,0.08)',
            }}>
                Pick a reference plan
            </DialogTitle>
            <DialogContent sx={{ pt: 2 }}>
                <Stack spacing={2} sx={{ mt: 0.5 }}>
                    <TextField
                        type="date"
                        label="Reference date"
                        value={date}
                        onChange={(e) => setDate(e.target.value)}
                        size="small"
                        fullWidth
                        InputLabelProps={{ shrink: true }}
                        sx={{
                            '& input': { color: '#fff' },
                            '& label': { color: 'rgba(255,255,255,0.55)' },
                        }}
                    />
                    {availableDates.length > 0 && (
                        <Stack direction="row" spacing={0.5} sx={{ flexWrap: 'wrap', rowGap: 0.5 }}>
                            {availableDates.slice(0, 16).map((d) => (
                                <Box
                                    key={d}
                                    onClick={() => setDate(d)}
                                    sx={{
                                        px: 0.8, py: 0.2, borderRadius: 0.6,
                                        bgcolor: d === date ? 'rgba(122,223,255,0.20)' : 'rgba(255,255,255,0.04)',
                                        color: d === date ? '#7adfff' : 'rgba(255,255,255,0.6)',
                                        border: '1px solid ' + (d === date ? 'rgba(122,223,255,0.5)' : 'rgba(255,255,255,0.08)'),
                                        fontSize: 11, fontWeight: 700, cursor: 'pointer',
                                    }}
                                >
                                    {d}
                                </Box>
                            ))}
                        </Stack>
                    )}
                    <FormControl size="small" disabled={!date || versionsForDate.length === 0}>
                        <InputLabel sx={{ color: 'rgba(255,255,255,0.55)' }}>Version</InputLabel>
                        <Select
                            value={versionId}
                            onChange={(e) => setVersionId(e.target.value)}
                            label="Version"
                            sx={{ color: '#fff' }}
                        >
                            {versionsForDate
                                .slice()
                                .sort((a, b) => (b.versionNumber || 0) - (a.versionNumber || 0))
                                .map((v) => (
                                    <MenuItem key={v.versionId} value={v.versionId}>
                                        v{v.versionNumber}
                                        {v.notes ? ` — ${v.notes}` : ''}
                                    </MenuItem>
                                ))}
                        </Select>
                    </FormControl>
                    {!versionsForDate.length && date && (
                        <Typography sx={{ color: 'rgba(247,118,142,0.85)', fontSize: 12 }}>
                            No saved versions for {date}.
                        </Typography>
                    )}
                </Stack>
            </DialogContent>
            <DialogActions sx={{ p: 2, borderTop: '1px solid rgba(255,255,255,0.08)' }}>
                <Button onClick={onClose} sx={{
                    color: 'rgba(255,255,255,0.6)', textTransform: 'none',
                }}>
                    Cancel
                </Button>
                <Button
                    onClick={() => onConfirm({ date, versionId })}
                    disabled={!canConfirm}
                    sx={{
                        textTransform: 'none', fontWeight: 700,
                        bgcolor: canConfirm ? '#7adfff' : 'rgba(255,255,255,0.05)',
                        color: canConfirm ? '#0a1a2c' : 'rgba(255,255,255,0.3)',
                        '&:hover': { bgcolor: canConfirm ? '#a0e8ff' : 'rgba(255,255,255,0.05)' },
                        px: 2,
                    }}
                >
                    Use as reference
                </Button>
            </DialogActions>
        </Dialog>
    );
}
