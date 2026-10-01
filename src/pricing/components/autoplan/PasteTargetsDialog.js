// Paste from Excel — one paste fills a whole target mix: every sub-segment,
// game type, price and core hour, and optionally several day types or dates at once.
// Shows what will be filled and what can't be read before anything is saved.

import React, { useEffect, useMemo, useState } from 'react';
import { Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, Stack, Typography } from '@mui/material';
import ContentPasteIcon from '@mui/icons-material/ContentPaste';
import { AP, ghostSx, primarySx, labelSx } from './apStyles';

export default function PasteTargetsDialog({ open, onClose, parse, onApply, scopeLabel, scopeName, example, initialText = '' }) {
    const [text, setText] = useState('');
    useEffect(() => { if (open) setText(initialText || ''); }, [open, initialText]);
    const r = useMemo(() => (text.trim() ? parse(text) : null), [text, parse]);
    const scopes = r ? [...new Set(r.cells.map((c) => c.scope))] : [];
    const groups = r ? [...new Set(r.cells.map((c) => c.group))] : [];
    const close = () => { setText(''); onClose(); };
    return (
        <Dialog open={open} onClose={close} maxWidth="md" fullWidth
            slotProps={{ paper: { sx: { bgcolor: AP.pop, color: AP.text, border: `1px solid ${AP.line}`, backgroundImage: 'none' } } }}>
            <DialogTitle sx={{ fontWeight: 800, display: 'flex', alignItems: 'center', gap: 1 }}>
                <ContentPasteIcon sx={{ color: AP.accent }} /> Paste target mix from Excel
            </DialogTitle>
            <DialogContent>
                <Typography sx={{ fontSize: 13, color: AP.muted, mb: 1 }}>
                    Copy the cells in Excel, including the header row (Date or Day of week, Segment, Sub segment, Game type, Price, then the core hours), and paste them below. Without a Date or Day of week column, rows fill {scopeName}.
                </Typography>
                <Box component="pre" sx={{ m: 0, mb: 1, p: 1, borderRadius: 1, bgcolor: 'rgba(255,255,255,0.04)', border: `1px solid ${AP.lineSoft}`, fontSize: 12, color: AP.faint, overflowX: 'auto' }}>{example}</Box>
                <Box component="textarea" value={text} onChange={(e) => setText(e.target.value)} autoFocus spellCheck={false}
                    aria-label="Pasted cells" placeholder="Paste here (Ctrl+V)"
                    sx={{
                        width: '100%', minHeight: 170, boxSizing: 'border-box', p: 1, borderRadius: 1, resize: 'vertical',
                        fontFamily: 'ui-monospace, Consolas, monospace', fontSize: 12.5, color: AP.text, bgcolor: 'rgba(8,22,36,0.7)',
                        border: `1px solid ${AP.line}`, '&:focus-visible': { outline: `2px solid ${AP.accent}` },
                    }} />
                {r ? (
                    <Stack spacing={1} sx={{ mt: 1.2 }} role="status">
                        <Typography sx={{ fontSize: 13.5, fontWeight: 800, color: r.cells.length ? AP.ok : AP.warn }}>
                            {r.cells.length ? `Fills ${r.cells.length} cells · ${groups.length} sub-segment × game type${groups.length === 1 ? '' : 's'} · ${scopes.map(scopeLabel).join(', ')}` : 'Nothing to fill yet.'}
                        </Typography>
                        {r.newPrices.length ? (
                            <Typography sx={{ fontSize: 12.5, color: AP.text }}>
                                Adds to the price list: {r.newPrices.map((p) => `${p.label} to ${p.sub}`).join(', ')}.
                            </Typography>
                        ) : null}
                        {r.errors.length ? (
                            <Box>
                                <Typography sx={{ ...labelSx, fontSize: 10.5, color: AP.warn }}>Not filled ({r.errors.length})</Typography>
                                <Box component="ul" sx={{ m: 0, pl: 2.2, maxHeight: 120, overflow: 'auto' }}>
                                    {r.errors.map((e) => <Box component="li" key={e} sx={{ fontSize: 12.5, color: AP.warn }}>{e}</Box>)}
                                </Box>
                            </Box>
                        ) : null}
                    </Stack>
                ) : null}
            </DialogContent>
            <DialogActions sx={{ px: 3, pb: 2 }}>
                <Button sx={ghostSx} onClick={close}>Cancel</Button>
                <Button sx={primarySx} disabled={!r || !r.cells.length} onClick={() => { onApply(r); close(); }}>
                    Fill {r && r.cells.length ? `${r.cells.length} cells` : 'targets'}
                </Button>
            </DialogActions>
        </Dialog>
    );
}
