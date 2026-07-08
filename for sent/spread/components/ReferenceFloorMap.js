// ReferenceFloorMap — read-only floor view for a reference plan
// ==============================================================
//
// Sits in the bottom row of the SpreadDashboard when the user picks
// a Reference spread. Wraps the regular FloorScheduleMap in readOnly
// mode and adds a thin header strip describing what's being shown
// (date + version + table count + a "view all plans" cycler when
// referenceMode === 'all').
//
// Props:
//   targetDate         — the editing date (just for the header copy)
//   referenceVersion   — the ScheduleVersion being shown
//   shifts             — the global shift library (versions don't carry shifts)
//   tables             — live floor tables FOR THE REFERENCE'S date
//   mode               — 'overall' | 'hourly' (mirrors the main map)
//   currentHour        — hour for hourly mode
//   versions           — array of versions in the 'all' cycler (or null)
//   activeVersionId    — currently-displayed version id (controlled by parent)
//   onPickVersion(id)  — when the user clicks a version pill in the 'all' cycler

import React from 'react';
import { Box, Stack, Typography, Button, Tooltip } from '@mui/material';
import SouthIcon from '@mui/icons-material/South';
import FloorScheduleMap from './FloorScheduleMap';

export default function ReferenceFloorMap({
    targetDate,
    referenceVersion,
    referenceDate,
    shifts,
    tables,
    mode,
    currentHour,
    versions,
    activeVersionId,
    onPickVersion,
    onUseAsBase,            // () => void — copy this reference into the editable map
}) {
    return (
        <Box sx={{
            bgcolor: 'rgba(22, 24, 38, 0.9)',
            borderRadius: 2,
            border: '1px solid rgba(255,255,255,0.06)',
            boxShadow: '0 4px 24px rgba(0,0,0,0.3)',
            overflow: 'hidden',
            minHeight: 320,
            display: 'flex',
            flexDirection: 'column',
        }}>
            {/* Header strip — context + 'all plans' cycler */}
            <Stack
                direction="row"
                alignItems="center"
                spacing={1.4}
                sx={{
                    p: 1.2,
                    bgcolor: 'rgba(10, 22, 35, 0.6)',
                    borderBottom: '1px solid rgba(122, 200, 220, 0.18)',
                    flexShrink: 0,
                }}
            >
                <Box sx={{ width: 4, height: 18, bgcolor: '#7adfff', borderRadius: 1 }} />
                <Typography sx={{
                    color: '#dff5ff', fontSize: 15, fontWeight: 700, letterSpacing: 0.3,
                }}>
                    Reference Spread
                </Typography>
                {referenceVersion && (
                    <Typography sx={{ color: 'rgba(255,255,255,0.55)', fontSize: 13 }}>
                        · {referenceDate}{' '}
                        · v{referenceVersion.versionNumber}{' '}
                        · {Object.keys(referenceVersion.assignments || {}).length} assignments
                    </Typography>
                )}
                <Box sx={{ flex: 1 }} />
                {/* Cycler — only renders when the parent passed a
                    `versions` array (i.e. referenceMode === 'all').
                    Click a chip to swap which version is displayed. */}
                {Array.isArray(versions) && versions.length > 1 && (
                    <Stack direction="row" spacing={0.4}>
                        {versions.map((v) => {
                            const active = v.versionId === activeVersionId;
                            return (
                                <Box
                                    key={v.versionId}
                                    onClick={() => onPickVersion(v.versionId)}
                                    sx={{
                                        px: 1, py: 0.4, cursor: 'pointer',
                                        borderRadius: 0.8,
                                        fontSize: 12, fontWeight: 700,
                                        bgcolor: active ? '#7adfff' : 'rgba(255,255,255,0.05)',
                                        color: active ? '#0a1a2c' : 'rgba(255,255,255,0.6)',
                                        border: '1px solid ' + (active ? '#7adfff' : 'rgba(255,255,255,0.08)'),
                                        '&:hover': active ? undefined : { bgcolor: 'rgba(122,223,255,0.10)' },
                                    }}
                                >
                                    v{v.versionNumber}
                                </Box>
                            );
                        })}
                    </Stack>
                )}
                {/* Adopt this reference as the editable base for the
                    target date — copies its assignments into the working
                    map (overwriting, after a confirm). This is how you
                    "use another date's spread as a base to edit". */}
                {onUseAsBase && referenceVersion && (
                    <Tooltip title={`Load this plan into ${targetDate}'s editable map`}>
                        <Button
                            onClick={onUseAsBase}
                            size="small"
                            startIcon={<SouthIcon sx={{ fontSize: 15 }} />}
                            sx={{
                                textTransform: 'none', fontSize: 12, fontWeight: 700,
                                color: '#0a1a2c', bgcolor: '#7adfff',
                                px: 1.2, py: 0.3,
                                '&:hover': { bgcolor: '#a0e8ff' },
                            }}
                        >
                            Use as editing base
                        </Button>
                    </Tooltip>
                )}
                {/* Differentiator badge — clarifies it's the reference,
                    not a second editor. */}
                <Typography sx={{
                    px: 0.8, py: 0.2, borderRadius: 0.6,
                    bgcolor: 'rgba(122,223,255,0.15)', color: '#7adfff',
                    fontSize: 11, fontWeight: 800, letterSpacing: 1.2,
                }}>
                    READ-ONLY
                </Typography>
            </Stack>

            {/* The floor itself — reused FloorScheduleMap, just with the
                reference's assignments and readOnly: true. */}
            <Box sx={{ flex: 1, minHeight: 0, position: 'relative' }}>
                {referenceVersion ? (
                    <FloorScheduleMap
                        tables={tables}
                        assignments={referenceVersion.assignments || {}}
                        shifts={shifts}
                        selectedKeys={new Set()}
                        activeBrushShiftId={null}
                        onSelectionChange={() => {}}
                        onAssign={() => {}}
                        mode={mode}
                        currentHour={currentHour}
                        readOnly={true}
                    />
                ) : (
                    <Box sx={{
                        position: 'absolute', inset: 0,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        color: 'rgba(255,255,255,0.4)', fontStyle: 'italic',
                    }}>
                        <Typography sx={{ fontSize: 15 }}>
                            No reference plan selected.
                        </Typography>
                    </Box>
                )}
            </Box>
        </Box>
    );
}
