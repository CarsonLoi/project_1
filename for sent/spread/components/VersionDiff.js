// VersionDiff
// ============
//
// Side-by-side comparison of two ScheduleVersions for the same target
// date. Renders three categories: assignments CHANGED (table on one
// shift in A, different shift in B), assignments ADDED (no shift in
// A, has one in B), assignments REMOVED. Plus a config-drift summary
// when the two versions' tableSnapshots differ.

import React, { useMemo } from 'react';
import { Box, Stack, Typography, IconButton } from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import { diffSnapshots } from '../utils/configSnapshot';

export default function VersionDiff({ versionA, versionB, shifts, onClose }) {
    const shiftName = useMemo(
        () => new Map((shifts || []).map((s) => [s.id, s])),
        [shifts]
    );

    const diff = useMemo(() => {
        if (!versionA || !versionB) return null;
        const aA = versionA.assignments || {};
        const aB = versionB.assignments || {};
        const allKeys = new Set([...Object.keys(aA), ...Object.keys(aB)]);
        const changed = [];
        const addedOnly = [];
        const removedOnly = [];
        for (const k of allKeys) {
            const a = aA[k];
            const b = aB[k];
            if (a && b && a !== b) changed.push({ key: k, from: a, to: b });
            else if (!a && b)       addedOnly.push({ key: k, to: b });
            else if (a && !b)       removedOnly.push({ key: k, from: a });
        }
        const tableDrift = diffSnapshots(versionA.tableSnapshot, versionB.tableSnapshot);
        return { changed, addedOnly, removedOnly, tableDrift };
    }, [versionA, versionB]);

    if (!versionA || !versionB || !diff) return null;

    return (
        <Box sx={{
            p: 1.5,
            bgcolor: 'rgba(8, 22, 36, 0.55)',
            borderRadius: 2,
            border: '1px solid rgba(247, 118, 142, 0.3)',
            fontVariantNumeric: 'tabular-nums',
        }}>
            <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }}>
                <Typography sx={{
                    color: '#f7768e', fontSize: 16, fontWeight: 700,
                    letterSpacing: 1.2, textTransform: 'uppercase',
                }}>
                    Comparing v{versionA.versionNumber} → v{versionB.versionNumber}
                </Typography>
                <Box sx={{ flex: 1 }} />
                <IconButton size="small" onClick={onClose} sx={{ color: 'rgba(255,255,255,0.55)' }}>
                    <CloseIcon fontSize="small" />
                </IconButton>
            </Stack>

            <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5}>
                <DiffColumn
                    title="Changed shift"
                    color="#f7b500"
                    items={diff.changed}
                    renderItem={(it) => (
                        <>
                            <strong>{it.key}</strong>
                            <span style={{ opacity: 0.55, margin: '0 6px' }}>
                                {shiftLabel(shiftName.get(it.from))}
                            </span>
                            →
                            <span style={{ color: '#5ae6b0', marginLeft: 6 }}>
                                {shiftLabel(shiftName.get(it.to))}
                            </span>
                        </>
                    )}
                />
                <DiffColumn
                    title="Newly assigned"
                    color="#5ae6b0"
                    items={diff.addedOnly}
                    renderItem={(it) => (
                        <>
                            <strong>{it.key}</strong>
                            <span style={{ marginLeft: 6, color: '#5ae6b0' }}>
                                + {shiftLabel(shiftName.get(it.to))}
                            </span>
                        </>
                    )}
                />
                <DiffColumn
                    title="Unassigned"
                    color="#f7768e"
                    items={diff.removedOnly}
                    renderItem={(it) => (
                        <>
                            <strong>{it.key}</strong>
                            <span style={{ marginLeft: 6, color: '#f7768e', opacity: 0.8 }}>
                                − {shiftLabel(shiftName.get(it.from))}
                            </span>
                        </>
                    )}
                />
            </Stack>

            {/* Config-drift summary — only shown when the two versions
                were taken against different table sets. The numeric
                badges keep this readable at a glance. */}
            {diff.tableDrift.hasDrift && (
                <Stack
                    direction="row"
                    spacing={1.5}
                    sx={{ mt: 1.4, pt: 1, borderTop: '1px solid rgba(255,255,255,0.1)' }}
                >
                    <Typography sx={{ color: 'rgba(255,255,255,0.55)', fontSize: 13 }}>
                        Floor config drift:
                    </Typography>
                    <DriftBadge color="#5ae6b0" label="added"   n={diff.tableDrift.added.length} />
                    <DriftBadge color="#f7768e" label="removed" n={diff.tableDrift.removed.length} />
                    <DriftBadge color="#f7b500" label="moved"   n={diff.tableDrift.moved.length} />
                </Stack>
            )}
        </Box>
    );
}

function DiffColumn({ title, color, items, renderItem }) {
    return (
        <Box sx={{ flex: 1, minWidth: 0 }}>
            <Stack direction="row" alignItems="center" spacing={0.8} sx={{ mb: 0.6 }}>
                <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: color }} />
                <Typography sx={{
                    color: 'rgba(255,255,255,0.7)', fontSize: 12,
                    letterSpacing: 0.8, textTransform: 'uppercase', fontWeight: 700,
                }}>
                    {title} ({items.length})
                </Typography>
            </Stack>
            {items.length === 0 ? (
                <Typography sx={{ color: 'rgba(255,255,255,0.3)', fontSize: 13, fontStyle: 'italic' }}>
                    none
                </Typography>
            ) : (
                <Stack spacing={0.3} sx={{ maxHeight: 200, overflow: 'auto' }}>
                    {items.map((it, i) => (
                        <Typography key={i} sx={{
                            color: '#dff5ff', fontSize: 13, fontFamily: 'monospace',
                            px: 0.6, py: 0.2,
                        }}>
                            {renderItem(it)}
                        </Typography>
                    ))}
                </Stack>
            )}
        </Box>
    );
}

function DriftBadge({ color, label, n }) {
    if (!n) return null;
    return (
        <Typography sx={{
            color, fontSize: 13, fontWeight: 700,
            display: 'inline-flex', alignItems: 'center', gap: 0.4,
        }}>
            <span>{n}</span>
            <span style={{ opacity: 0.7, fontWeight: 500 }}>{label}</span>
        </Typography>
    );
}

function shiftLabel(shift) {
    if (!shift) return 'Unknown';
    return shift.name || shift.id;
}
