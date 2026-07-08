// ConfigDriftBanner
// ==================
//
// Surfaces when the active version's frozen tableSnapshot differs from
// the LIVE floor config (config_cod.json filtered to the target date).
//
// Two-line layout: summary (counts + a short caption) and a primary
// action — "Save new version with updated config". When the user
// clicks the action, the dashboard:
//   1. Takes the active version's assignments
//   2. Carries forward only the surviving tables (key still in current
//      config)
//   3. Creates a new version with the current config snapshot
//   4. New tables come in unassigned; removed tables drop off
//
// Designed to be loud (red border, warning icon) but compact — it sits
// between the toolbar and the floor map so it's always in the user's
// line of sight without stealing layout from the editor below.

import React from 'react';
import { Box, Stack, Typography, Button, IconButton } from '@mui/material';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import CloseIcon from '@mui/icons-material/Close';

export default function ConfigDriftBanner({
    drift,                  // { added, removed, moved, hasDrift }
    onMigrate,              // () => void  — save a new version with current config
    onDismiss,              // () => void  — hide until next session / data change
}) {
    if (!drift || !drift.hasDrift) return null;
    return (
        <Box sx={{
            p: 1.2,
            bgcolor: 'rgba(247, 118, 142, 0.08)',
            borderRadius: 1.5,
            border: '1px solid rgba(247, 118, 142, 0.35)',
            fontVariantNumeric: 'tabular-nums',
        }}>
            <Stack direction="row" alignItems="center" spacing={1.2}>
                <WarningAmberIcon sx={{ color: '#f7768e', fontSize: 26, flexShrink: 0 }} />
                <Stack sx={{ flex: 1, minWidth: 0 }}>
                    <Typography sx={{ color: '#f7768e', fontSize: 15, fontWeight: 700 }}>
                        Floor config has drifted since this version was saved
                    </Typography>
                    <Typography sx={{ color: 'rgba(255,255,255,0.7)', fontSize: 13 }}>
                        {[
                            drift.added.length   && `${drift.added.length} added`,
                            drift.removed.length && `${drift.removed.length} removed`,
                            drift.moved.length   && `${drift.moved.length} moved`,
                        ].filter(Boolean).join(' · ')}
                        {' — assignments for surviving tables can be carried forward into a new version.'}
                    </Typography>
                </Stack>
                <Button
                    onClick={onMigrate}
                    size="small"
                    sx={{
                        textTransform: 'none', fontSize: 13, fontWeight: 700,
                        bgcolor: '#f7768e', color: '#0a1a2c',
                        '&:hover': { bgcolor: '#fb96a8' },
                        flexShrink: 0,
                    }}
                >
                    Save new version with current config
                </Button>
                {onDismiss && (
                    <IconButton
                        size="small"
                        onClick={onDismiss}
                        sx={{ color: 'rgba(255,255,255,0.5)' }}
                    >
                        <CloseIcon fontSize="small" />
                    </IconButton>
                )}
            </Stack>
        </Box>
    );
}
