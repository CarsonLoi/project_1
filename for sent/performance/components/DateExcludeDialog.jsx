// DateExcludeDialog
//
// Two-pane transfer-list dialog for excluding specific dates from the
// active date range. Use case: the user picks a wide range like
// 2026-01-01..2026-02-28 but wants to drop the CNY holiday block
// (e.g. 2026-02-18..2026-02-24) from the analysis so KPIs aren't
// skewed by the period of unusual play.
//
// The dialog enumerates every date inside [startDate, endDate] and
// splits them into Included (left) and Excluded (right). The user
// shuttles items between the two lists with the four arrow buttons,
// then commits with Apply — only at that point is the parent's
// excludedDates state updated. Cancel reverts.
//
// We show the day-of-week beside each date (e.g. "2026-02-18 (Wed)")
// so the user can spot holidays/weekends at a glance.

import React, { useEffect, useMemo, useState } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Box,
  Typography,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Checkbox,
  Paper,
  Divider,
} from '@mui/material';
import dayjs from 'dayjs';

// ---------- helpers ----------------------------------------------------

// Enumerate every YYYY-MM-DD between two date strings (inclusive).
function enumerateDates(start, end) {
  const out = [];
  if (!start || !end) return out;
  let d = dayjs(start);
  const last = dayjs(end);
  if (!d.isValid() || !last.isValid()) return out;
  while (d.isBefore(last) || d.isSame(last, 'day')) {
    out.push(d.format('YYYY-MM-DD'));
    d = d.add(1, 'day');
  }
  return out;
}

// Small set-style helpers — readable enough to inline transfer logic.
function not(a, bSet)            { return a.filter((v) => !bSet.has(v)); }
function intersection(a, bSet)   { return a.filter((v) =>  bSet.has(v)); }
function unionUnique(a, b)       { return [...a, ...b.filter((v) => !a.includes(v))]; }

const DOW_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const labelFor = (d) => `${d} (${DOW_SHORT[dayjs(d).day()]})`;

// ---------- component --------------------------------------------------

export default function DateExcludeDialog({
  open,
  onClose,
  startDate,
  endDate,
  excludedDates,   // string[] (YYYY-MM-DD)
  onApply,         // (newExcluded: string[]) => void
}) {
  // All dates within the active range — re-derived if the range changes.
  const allDates = useMemo(
    () => enumerateDates(startDate, endDate),
    [startDate, endDate]
  );

  // Local working copy so Cancel discards changes.
  const [right, setRight] = useState([]);
  // Checkbox selection — independent of which pane the item lives in.
  const [checked, setChecked] = useState([]);

  // Reset working state every time the dialog (re)opens.
  useEffect(() => {
    if (!open) return;
    // Drop excluded entries that fall outside the current range so
    // stale picks don't haunt the list after the user shrinks the
    // date picker.
    const allSet = new Set(allDates);
    setRight(excludedDates.filter((d) => allSet.has(d)));
    setChecked([]);
  }, [open, excludedDates, allDates]);

  const rightSet = useMemo(() => new Set(right), [right]);
  const left = useMemo(() => not(allDates, rightSet), [allDates, rightSet]);

  const leftSet = useMemo(() => new Set(left), [left]);
  const leftChecked  = intersection(checked, leftSet);
  const rightChecked = intersection(checked, rightSet);

  const toggle = (d) => () => {
    setChecked((prev) =>
      prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d]
    );
  };

  const moveAllRight     = () => { setRight(unionUnique(right, left)); setChecked([]); };
  const moveCheckedRight = () => {
    setRight(unionUnique(right, leftChecked));
    setChecked((prev) => prev.filter((d) => !leftChecked.includes(d)));
  };
  const moveCheckedLeft  = () => {
    const drop = new Set(rightChecked);
    setRight(right.filter((d) => !drop.has(d)));
    setChecked((prev) => prev.filter((d) => !drop.has(d)));
  };
  const moveAllLeft      = () => { setRight([]); setChecked([]); };

  // Reusable list pane — header with title + count, scrollable body.
  const Pane = ({ title, items, accent }) => (
    <Paper
      variant="outlined"
      sx={{
        width: 280,
        height: 420,
        display: 'flex',
        flexDirection: 'column',
        bgcolor: 'rgba(255,255,255,0.02)',
        borderColor: 'rgba(255,255,255,0.08)',
      }}
    >
      <Box
        sx={{
          px: 1.5,
          py: 1.1,
          borderBottom: '1px solid rgba(255,255,255,0.08)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Box sx={{ width: 4, height: 14, bgcolor: accent, borderRadius: 1 }} />
          <Typography sx={{ color: '#fff', fontWeight: 600, fontSize: 15 }}>
            {title}
          </Typography>
        </Box>
        <Typography sx={{ color: 'rgba(255,255,255,0.55)', fontSize: 13 }}>
          {items.length}
        </Typography>
      </Box>
      <List dense disablePadding sx={{ flex: 1, overflow: 'auto' }}>
        {items.length === 0 && (
          <Box sx={{ p: 2, textAlign: 'center', color: 'rgba(255,255,255,0.4)', fontSize: 13 }}>
            (empty)
          </Box>
        )}
        {items.map((d) => (
          <ListItemButton
            key={d}
            onClick={toggle(d)}
            sx={{ py: 0.5, px: 1.2 }}
          >
            <ListItemIcon sx={{ minWidth: 32 }}>
              <Checkbox
                edge="start"
                checked={checked.includes(d)}
                tabIndex={-1}
                disableRipple
                size="small"
              />
            </ListItemIcon>
            <ListItemText
              primary={labelFor(d)}
              primaryTypographyProps={{ fontSize: 14, color: '#fff' }}
            />
          </ListItemButton>
        ))}
      </List>
    </Paper>
  );

  const arrowSx = {
    minWidth: 40,
    px: 0,
    fontSize: 20,
    fontWeight: 700,
    color: 'rgba(255,255,255,0.85)',
    borderColor: 'rgba(255,255,255,0.18)',
    '&:hover': { bgcolor: 'rgba(122,162,247,0.12)', borderColor: '#7aa2f7' },
    '&.Mui-disabled': { color: 'rgba(255,255,255,0.25)', borderColor: 'rgba(255,255,255,0.08)' },
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="md"
      PaperProps={{
        sx: {
          bgcolor: 'rgba(22, 24, 38, 0.98)',
          border: '1px solid rgba(255,255,255,0.08)',
          backgroundImage: 'none',
        },
      }}
    >
      <DialogTitle sx={{ color: '#fff', fontWeight: 600, fontSize: 19 }}>
        Exclude Dates from Analysis
      </DialogTitle>
      <DialogContent>
        <Typography sx={{ mb: 2, color: 'rgba(255,255,255,0.6)', fontSize: 14 }}>
          Move dates from <b>Included</b> to <b>Excluded</b> to drop them from
          every chart in the dashboard (e.g. CNY or other holidays).
          Day-of-week is shown beside each date so weekends and holiday
          blocks are easy to spot.
        </Typography>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 2 }}>
          <Pane title="Included" items={left}  accent="#7aa2f7" />
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            <Button variant="outlined" size="small" onClick={moveAllRight}     disabled={left.length === 0}        sx={arrowSx}>≫</Button>
            <Button variant="outlined" size="small" onClick={moveCheckedRight} disabled={leftChecked.length === 0} sx={arrowSx}>›</Button>
            <Button variant="outlined" size="small" onClick={moveCheckedLeft}  disabled={rightChecked.length === 0} sx={arrowSx}>‹</Button>
            <Button variant="outlined" size="small" onClick={moveAllLeft}      disabled={right.length === 0}       sx={arrowSx}>≪</Button>
          </Box>
          <Pane title="Excluded" items={right} accent="#f7768e" />
        </Box>
      </DialogContent>
      <Divider sx={{ borderColor: 'rgba(255,255,255,0.08)' }} />
      <DialogActions sx={{ px: 3, py: 1.8 }}>
        <Button onClick={onClose} sx={{ color: 'rgba(255,255,255,0.7)', textTransform: 'none', fontSize: 15 }}>
          Cancel
        </Button>
        <Button
          variant="contained"
          onClick={() => { onApply(right); onClose(); }}
          sx={{ textTransform: 'none', fontWeight: 600, fontSize: 15 }}
        >
          Apply
        </Button>
      </DialogActions>
    </Dialog>
  );
}
