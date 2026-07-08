// VersionHistory
// ===============
//
// Lists every ScheduleVersion for the active target date. Newest on
// top. The active version is tinted with a blue left stripe and an
// "Active" tag. Non-active rows reveal a "Restore" button on hover so
// the click target is explicit (clicking the row body also restores).
//
// Per-row actions: Restore (make this the editing baseline), Rename
// (notes), Compare (diff against the active version).

import React, { useState } from 'react';
import {
    Box, Stack, Typography, IconButton, Button, TextField, Tooltip,
} from '@mui/material';
import EditIcon from '@mui/icons-material/Edit';
import CompareArrowsIcon from '@mui/icons-material/CompareArrows';
import HistoryIcon from '@mui/icons-material/History';
import RestoreIcon from '@mui/icons-material/Restore';
import Inventory2OutlinedIcon from '@mui/icons-material/Inventory2Outlined';

export default function VersionHistory({
    versions,                  // ScheduleVersion[] (oldest first by versionNumber)
    activeVersionId,
    onActivate,                // (versionId) => void
    onRename,                  // (versionId, newName) => void  (name stored in notes for now)
    onCompare,                 // (versionIdA, versionIdB) => void
    onSaveNew,                 // () => void  — save current edits as a new version
    dirty,                     // true when the user has unsaved edits
}) {
    const [compareWith, setCompareWith] = useState(null);
    const [renamingId, setRenamingId] = useState(null);
    const [renameDraft, setRenameDraft] = useState('');

    const sorted = [...(versions || [])].sort(
        (a, b) => (b.versionNumber || 0) - (a.versionNumber || 0)
    );

    const startRename = (v) => {
        setRenamingId(v.versionId);
        setRenameDraft(v.notes || '');
    };
    const commitRename = (v) => {
        onRename(v.versionId, renameDraft);
        setRenamingId(null);
    };

    return (
        <Box sx={{
            p: 1.5,
            bgcolor: 'rgba(8, 22, 36, 0.55)',
            borderRadius: 2,
            border: '1px solid rgba(122, 200, 220, 0.12)',
            fontVariantNumeric: 'tabular-nums',
            display: 'flex',
            flexDirection: 'column',
            minHeight: 0,
        }}>
            {/* Header */}
            <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1.2 }}>
                <Box sx={{ width: 4, height: 18, bgcolor: '#7adfff', borderRadius: 1 }} />
                <Typography sx={{ color: '#dff5ff', fontSize: 16, fontWeight: 700, letterSpacing: 0.4 }}>
                    Version History
                </Typography>
                {sorted.length > 0 && (
                    <Typography sx={{
                        color: 'rgba(255,255,255,0.4)', fontSize: 12, fontWeight: 600,
                        bgcolor: 'rgba(255,255,255,0.05)', px: 0.8, py: 0.1, borderRadius: 1,
                    }}>
                        {sorted.length}
                    </Typography>
                )}
                <Box sx={{ flex: 1 }} />
                <Button
                    onClick={onSaveNew}
                    disabled={!dirty}
                    size="small"
                    startIcon={dirty ? <HistoryIcon sx={{ fontSize: 15 }} /> : null}
                    sx={{
                        textTransform: 'none', fontSize: 13, fontWeight: 700,
                        bgcolor: dirty ? '#7adfff' : 'transparent',
                        color: dirty ? '#0a1a2c' : 'rgba(255,255,255,0.3)',
                        border: dirty ? 'none' : '1px solid rgba(255,255,255,0.1)',
                        '&:hover': { bgcolor: dirty ? '#a0e8ff' : 'transparent' },
                    }}
                >
                    {dirty ? 'Save version' : 'No unsaved edits'}
                </Button>
            </Stack>

            {sorted.length === 0 ? (
                <Stack alignItems="center" spacing={1} sx={{ py: 3, px: 2 }}>
                    <Inventory2OutlinedIcon sx={{ color: 'rgba(255,255,255,0.2)', fontSize: 36 }} />
                    <Typography sx={{
                        color: 'rgba(255,255,255,0.45)', fontSize: 13, textAlign: 'center', lineHeight: 1.5,
                    }}>
                        No saved versions yet.<br />
                        Paint the floor, then <b style={{ color: 'rgba(255,255,255,0.7)' }}>Save version</b> to
                        snapshot it here.
                    </Typography>
                </Stack>
            ) : (
                <Stack spacing={0.6} sx={{ overflow: 'auto', maxHeight: 300, pr: 0.3 }}>
                    {sorted.map((v) => {
                        const active = v.versionId === activeVersionId;
                        const compared = compareWith === v.versionId;
                        const assignCount = Object.keys(v.assignments || {}).length;
                        return (
                            <Box
                                key={v.versionId}
                                sx={{
                                    p: 1,
                                    borderRadius: 1.2,
                                    bgcolor: active ? 'rgba(122,223,255,0.10)' : 'rgba(255,255,255,0.015)',
                                    borderLeft: active ? '3px solid #7adfff' : '3px solid transparent',
                                    outline: compared ? '1px solid rgba(247,118,142,0.4)' : 'none',
                                    cursor: active ? 'default' : 'pointer',
                                    transition: 'background-color 140ms',
                                    '&:hover': {
                                        bgcolor: active ? 'rgba(122,223,255,0.16)' : 'rgba(255,255,255,0.05)',
                                    },
                                    '&:hover .restore-btn': { opacity: 1 },
                                }}
                                onClick={() => !active && onActivate(v.versionId)}
                            >
                                {/* Top line: version label + tag + timestamp + actions */}
                                <Stack direction="row" alignItems="center" spacing={1}>
                                    <Typography sx={{ color: '#fff', fontSize: 16, fontWeight: 800, minWidth: 34 }}>
                                        v{v.versionNumber}
                                    </Typography>
                                    {active ? (
                                        <Typography sx={{
                                            color: '#7adfff', fontSize: 10, fontWeight: 800,
                                            letterSpacing: 1, textTransform: 'uppercase',
                                            bgcolor: 'rgba(122,223,255,0.15)', px: 0.7, py: 0.15, borderRadius: 0.6,
                                        }}>
                                            Active
                                        </Typography>
                                    ) : (
                                        <Button
                                            className="restore-btn"
                                            size="small"
                                            startIcon={<RestoreIcon sx={{ fontSize: 14 }} />}
                                            onClick={(e) => { e.stopPropagation(); onActivate(v.versionId); }}
                                            sx={{
                                                opacity: 0, transition: 'opacity 140ms',
                                                textTransform: 'none', fontSize: 11, fontWeight: 700,
                                                color: '#7adfff', minWidth: 0, px: 0.8, py: 0,
                                                '&:hover': { bgcolor: 'rgba(122,223,255,0.1)' },
                                            }}
                                        >
                                            Restore
                                        </Button>
                                    )}
                                    <Box sx={{ flex: 1 }} />
                                    <Typography sx={{ color: 'rgba(255,255,255,0.5)', fontSize: 11 }}>
                                        {fmtRelative(v.createdAt)}
                                    </Typography>
                                    <Tooltip title="Rename / add note">
                                        <IconButton
                                            size="small"
                                            onClick={(e) => { e.stopPropagation(); startRename(v); }}
                                            sx={{ color: 'rgba(255,255,255,0.4)', '&:hover': { color: '#7adfff' } }}
                                        >
                                            <EditIcon sx={{ fontSize: 14 }} />
                                        </IconButton>
                                    </Tooltip>
                                    <Tooltip title={compared ? 'Cancel compare' : 'Compare with active'}>
                                        <span>
                                            <IconButton
                                                size="small"
                                                disabled={active}
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    if (compared) { setCompareWith(null); return; }
                                                    setCompareWith(v.versionId);
                                                    onCompare(activeVersionId, v.versionId);
                                                }}
                                                sx={{
                                                    color: compared ? '#f7768e' : 'rgba(255,255,255,0.4)',
                                                    '&:hover': { color: '#f7768e' },
                                                    '&.Mui-disabled': { color: 'rgba(255,255,255,0.12)' },
                                                }}
                                            >
                                                <CompareArrowsIcon sx={{ fontSize: 16 }} />
                                            </IconButton>
                                        </span>
                                    </Tooltip>
                                </Stack>

                                {/* Meta line */}
                                <Stack direction="row" alignItems="center" spacing={1} sx={{ mt: 0.3, pl: 0.2 }}>
                                    <Typography sx={{ color: 'rgba(255,255,255,0.55)', fontSize: 12 }}>
                                        {assignCount} table{assignCount === 1 ? '' : 's'} · config {v.configSnapshotDate}
                                    </Typography>
                                    {v.basedOnVersionId && (
                                        <Typography sx={{ color: 'rgba(255,255,255,0.35)', fontSize: 11 }}>
                                            ← v{versionLookup(sorted, v.basedOnVersionId)?.versionNumber}
                                        </Typography>
                                    )}
                                </Stack>

                                {/* Rename row / note display */}
                                {renamingId === v.versionId ? (
                                    <Stack direction="row" spacing={0.4} sx={{ mt: 0.6 }}>
                                        <TextField
                                            value={renameDraft}
                                            onChange={(e) => setRenameDraft(e.target.value)}
                                            onClick={(e) => e.stopPropagation()}
                                            onKeyDown={(e) => { if (e.key === 'Enter') commitRename(v); }}
                                            size="small"
                                            autoFocus
                                            placeholder="Add a note…"
                                            sx={{ flex: 1, '& input': { color: '#fff', fontSize: 12, py: 0.3 } }}
                                        />
                                        <Button
                                            size="small"
                                            onClick={(e) => { e.stopPropagation(); commitRename(v); }}
                                            sx={{ minWidth: 0, px: 1, fontSize: 11, color: '#7adfff' }}
                                        >
                                            Save
                                        </Button>
                                    </Stack>
                                ) : v.notes ? (
                                    <Typography sx={{
                                        mt: 0.4, color: 'rgba(255,255,255,0.7)', fontSize: 12, fontStyle: 'italic',
                                    }}>
                                        "{v.notes}"
                                    </Typography>
                                ) : null}
                            </Box>
                        );
                    })}
                </Stack>
            )}
        </Box>
    );
}

function versionLookup(versions, id) {
    return versions.find((v) => v.versionId === id);
}

// "just now" / "5 min ago" / "3 hr ago" / "2 days ago" / falls back to
// the calendar date for anything older than a week.
function fmtRelative(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    const diffMs = Date.now() - d.getTime();
    const min = Math.floor(diffMs / 60000);
    if (min < 1)  return 'just now';
    if (min < 60) return `${min} min ago`;
    const hr = Math.floor(min / 60);
    if (hr < 24)  return `${hr} hr ago`;
    const days = Math.floor(hr / 24);
    if (days < 7) return `${days} day${days === 1 ? '' : 's'} ago`;
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
