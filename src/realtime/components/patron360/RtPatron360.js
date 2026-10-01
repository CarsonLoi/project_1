// Player 360 — period summary and step drill-down.
// ================================================
// Spec: docs/superpowers/specs/2026-09-26-patron-360-drilldown-design.md
//
// Full-screen overlay. The last 12 months of the patron's bets (§8) and
// shoe edges (§9) load once; Today / Last 3 months / Last 12 months are
// filtered in the browser. One level fills the screen at a time —
// Summary → Option → Shoe (or Compare) → Hand — with a breadcrumb, Back
// (Alt+←) and Prev / Next between siblings.

import React, { forwardRef, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    Box, Button, ButtonBase, Dialog, Skeleton, Slide, Stack, ToggleButton, ToggleButtonGroup, Typography, useMediaQuery,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import { CARD_TIERS } from '../../../live/constants/winPalette';
import { fetchPatronBets, fetchPatronShoeEdges } from '../../utils/rtDataSource';
import { buildPatron360, currentGamingDate } from '../../utils/patron360';
import {
    PERIODS, DEFAULT_PERIOD, periodLabel, periodFrom, fetchRange, viewsInPeriod, summaryRows, sortSummary,
    periodVerdict, worstOption, shoeRowsFor, sortBy,
} from '../../utils/p360Periods';
import { SURFACE, TEXT, STATE, ACCENT } from '../../constants/rtTheme';
import P360Nav from './P360Nav';
import SummaryLevel, { Stamp } from './SummaryLevel';
import OptionLevel, { shoeSortGet } from './OptionLevel';
import { ShoeLevel, CompareLevel } from './ShoeLevel';
import HandLevel from './HandLevel';

const SlideUp = forwardRef(function SlideUp(props, ref) {
    return <Slide direction="up" ref={ref} {...props} />;
});

const skeletonSx = { bgcolor: 'rgba(255,255,255,0.05)', borderRadius: 2 };
const segmentedSx = {
    height: 34,
    '& .MuiToggleButton-root': { color: TEXT.muted, borderColor: 'rgba(122,162,247,0.35)', textTransform: 'none', fontSize: 13, fontWeight: 700, px: 1.5 },
    '& .Mui-selected': { color: `${TEXT.primary} !important`, bgcolor: 'rgba(122,162,247,0.24) !important' },
};
const countChipSx = {
    px: 1, py: 0.25, borderRadius: 1, fontSize: 12, fontWeight: 800, color: TEXT.secondary,
    bgcolor: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.12)',
};
const INITIAL_SORTS = { sum: { key: 'gap', dir: 1 }, shoes: { key: 'negMoney', dir: -1 }, bets: { key: 'wager', dir: -1 } };
const SUMMARY = { level: 'summary', code: null, shoeKey: null, cmp: [], handNo: null };

const duration = (m) => (m == null || !Number.isFinite(Number(m)) ? '—'
    : Number(m) < 60 ? `${Math.round(m)}m` : `${Math.floor(m / 60)}h ${String(Math.round(m % 60)).padStart(2, '0')}m`);
const shoeCrumb = (v) => `Shoe ${String(v.date).slice(5)} · ${v.tableKey} · ${v.shoeId}`;

function Header({ patronId, patronRow, source, period, onPeriod, verdict, onClose }) {
    const p = patronRow || {};
    const tier = CARD_TIERS[p.card_type] || CARD_TIERS.BASE;
    return (
        <Box sx={{ position: 'sticky', top: 0, zIndex: 3, bgcolor: 'rgba(13,14,24,0.94)', backdropFilter: 'blur(8px)', borderBottom: `1px solid ${SURFACE.panelBorder}` }}>
            <Stack direction="row" sx={{ alignItems: 'center', columnGap: 2.5, rowGap: 1, flexWrap: 'wrap', px: { xs: 1.5, md: 2.5 }, py: 1.25, maxWidth: 2000, mx: 'auto', boxSizing: 'border-box' }}>
                <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', minWidth: 0 }}>
                    <Box sx={{ width: 46, height: 46, borderRadius: '50%', display: 'grid', placeItems: 'center', flexShrink: 0, bgcolor: `${tier.accent}26`, border: `1.5px solid ${tier.accent}`, color: tier.accent, fontWeight: 800, fontSize: 14 }}>
                        {String(patronId).slice(-2)}
                    </Box>
                    <Box sx={{ minWidth: 0 }}>
                        <Typography id="p360-title" component="h2" sx={{ fontSize: 24, fontWeight: 800, color: TEXT.primary, lineHeight: 1.1 }}>{patronId}</Typography>
                        <Typography sx={{ fontSize: 12, color: TEXT.faint }}>
                            <Box component="span" sx={{ color: tier.accent, fontWeight: 700 }}>{tier.label}</Box>
                            {` · ${p.segment || '—'} · ${p.current_table_key ? `seat ${p.current_seat ?? '—'} · ${p.current_table_key}` : 'not seated'} · ${duration(p.sign_in_mins_ago)}`}
                        </Typography>
                    </Box>
                </Stack>
                <ToggleButtonGroup exclusive size="small" value={period} onChange={(_, v) => v && onPeriod(v)} aria-label="Period" sx={segmentedSx}>
                    {PERIODS.map((x) => <ToggleButton key={x.id} value={x.id}>{x.label}</ToggleButton>)}
                </ToggleButtonGroup>
                {verdict ? <Box title={verdict.reason}><Stamp level={verdict.level} /></Box> : null}
                {source ? (
                    <Box sx={{ ...countChipSx, borderColor: source.live ? STATE.positiveBorder : 'rgba(255,255,255,0.12)', bgcolor: source.live ? STATE.positiveBg : 'rgba(255,255,255,0.05)' }}>
                        {source.live ? 'LIVE' : 'MOCK'}
                    </Box>
                ) : null}
                <Box sx={{ flex: 1 }} />
                <ButtonBase onClick={onClose} aria-label="Close Player 360"
                    sx={{ width: 40, height: 40, borderRadius: 1.5, color: TEXT.muted, border: `1px solid ${SURFACE.panelBorder}`, '&:hover': { color: TEXT.primary, borderColor: ACCENT }, '&.Mui-focusVisible': { outline: `2px solid ${ACCENT}`, outlineOffset: 2 } }}>
                    <CloseIcon />
                </ButtonBase>
            </Stack>
        </Box>
    );
}

function Loading() {
    return (
        <Stack spacing={1.5} aria-busy="true" aria-label="Loading">
            <Skeleton variant="rectangular" height={86} sx={skeletonSx} />
            <Skeleton variant="rectangular" height={460} sx={skeletonSx} />
        </Stack>
    );
}

function Message({ title, body, action }) {
    return (
        <Stack spacing={1.25} sx={{ alignItems: 'center', textAlign: 'center', py: 12 }}>
            <Typography sx={{ fontSize: 17, fontWeight: 800, color: TEXT.primary }}>{title}</Typography>
            {body ? <Typography sx={{ fontSize: 13, color: TEXT.muted, maxWidth: 560 }}>{body}</Typography> : null}
            {action}
        </Stack>
    );
}

export default function RtPatron360({ open, patronId, patronRow, onClose }) {
    const reducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
    const today = currentGamingDate();
    const range = useMemo(() => fetchRange(today), [today]);

    // ── Data: last 12 months, once per patron (and per retry) ──────────
    const [attempt, setAttempt] = useState(0);
    const [data, setData] = useState({ key: null, bets: null, edges: null, live: false, error: null });
    const reqKey = `${patronId}|${range.from}|${range.to}|${attempt}`;
    useEffect(() => {
        if (!open || !patronId) return undefined;
        let cancelled = false;
        Promise.all([fetchPatronBets(patronId, range), fetchPatronShoeEdges(patronId, range)]).then(([b, e]) => {
            if (!cancelled) setData({ key: reqKey, bets: b.rows, edges: e.rows, live: b.live && e.live, error: b.error || e.error });
        });
        return () => { cancelled = true; };
        // reqKey encodes patron, range and retry attempt.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, reqKey]);
    const ready = data.key === reqKey;
    const model = useMemo(
        () => (ready && !data.error && data.bets && data.bets.length ? buildPatron360(data.bets, data.edges || []) : null),
        [ready, data],
    );
    const allViews = model ? model.views : null;

    // ── Navigation state ───────────────────────────────────────────────
    const [period, setPeriodId] = useState(DEFAULT_PERIOD);
    const [nav, setNav] = useState(SUMMARY);
    const [sorts, setSorts] = useState(INITIAL_SORTS);
    const [onlyNeg, setOnlyNeg] = useState(true);
    const [picks, setPicks] = useState(() => new Set());
    const [showAll, setShowAll] = useState(false);
    useEffect(() => {
        setPeriodId(DEFAULT_PERIOD); setNav(SUMMARY); setSorts(INITIAL_SORTS); setOnlyNeg(true); setPicks(new Set()); setShowAll(false);
    }, [patronId]);

    const topRef = useRef(null);
    const go = useCallback((patch) => {
        setNav((n) => ({ ...n, ...patch }));
        requestAnimationFrame(() => { if (topRef.current) topRef.current.scrollIntoView({ block: 'start' }); });
    }, []);
    const setSort = (table) => (s) => setSorts((cur) => ({ ...cur, [table]: s }));

    // ── Period-derived model ───────────────────────────────────────────
    const byPeriod = useMemo(() => {
        const out = {};
        for (const p of PERIODS) {
            const views = allViews ? viewsInPeriod(allViews, p.id, today) : [];
            const rows = summaryRows(views);
            out[p.id] = { views, rows, map: new Map(rows.map((r) => [r.code, r])) };
        }
        return out;
    }, [allViews, today]);
    const cur = byPeriod[period];
    const sortedRows = useMemo(() => sortSummary(cur.rows, sorts.sum), [cur, sorts.sum]);
    const verdict = useMemo(() => (allViews ? periodVerdict(cur.rows) : null), [allViews, cur]);
    const worst = useMemo(() => worstOption(cur.rows), [cur]);
    const viewByKey = useMemo(() => new Map((allViews || []).map((v) => [v.shoeKey, v])), [allViews]);
    const kpi = nav.code ? cur.map.get(nav.code) || null : null;
    const shoeRows = useMemo(() => (nav.code
        ? sortBy(shoeRowsFor(cur.views, nav.code, { onlyNeg }), shoeSortGet(sorts.shoes.key), sorts.shoes.dir)
        : []), [cur, nav.code, onlyNeg, sorts.shoes]);

    // Switching period keeps the level when it still exists there.
    const onPeriod = (p) => {
        setPeriodId(p);
        setShowAll(false);
        const from = periodFrom(p, today);
        const inP = (key) => { const v = viewByKey.get(key); return !!v && String(v.date) >= from; };
        setPicks((s) => new Set([...s].filter(inP)));
        setNav((n) => {
            if (n.code && !byPeriod[p].map.has(n.code)) return SUMMARY;
            if (n.shoeKey && !inP(n.shoeKey)) return { ...n, level: 'option', shoeKey: null, handNo: null, cmp: [] };
            if (n.cmp.length) {
                const cmp = n.cmp.filter(inP);
                if (cmp.length < 2) return { ...n, level: n.level === 'compare' ? 'option' : n.level, cmp: [] };
                return { ...n, cmp };
            }
            return n;
        });
    };

    const openOption = (code) => { setShowAll(false); setPicks(new Set()); go({ level: 'option', code, shoeKey: null, cmp: [], handNo: null }); };
    const openShoe = (shoeKey, keepCmp = false) => go({ level: 'shoe', shoeKey, handNo: null, ...(keepCmp ? null : { cmp: [] }) });
    const openHand = (shoeKey, handNo, keepCmp = false) => go({ level: 'hand', shoeKey, handNo, ...(keepCmp ? null : { cmp: [] }) });

    const back = useCallback(() => {
        setNav((n) => {
            if (n.level === 'hand') return { ...n, level: 'shoe', handNo: null };
            if (n.level === 'shoe' && n.cmp.length > 1) return { ...n, level: 'compare', shoeKey: null };
            if (n.level === 'shoe' || n.level === 'compare') return { ...n, level: 'option', shoeKey: null, cmp: [] };
            if (n.level === 'option') return SUMMARY;
            return n;
        });
        requestAnimationFrame(() => { if (topRef.current) topRef.current.scrollIntoView({ block: 'start' }); });
    }, []);
    useEffect(() => {
        if (!open) return undefined;
        const onKey = (e) => { if (e.altKey && e.key === 'ArrowLeft') { e.preventDefault(); back(); } };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [open, back]);

    // ── Breadcrumb + siblings ──────────────────────────────────────────
    const pLabel = periodLabel(period);
    const view = nav.shoeKey ? viewByKey.get(nav.shoeKey) || null : null;
    const crumbs = [{ label: 'Summary', onClick: () => go(SUMMARY) }];
    if (nav.code) crumbs.push({ label: `${nav.code} · ${pLabel}`, onClick: () => go({ level: 'option', shoeKey: null, cmp: [], handNo: null }) });
    if (nav.cmp.length > 1 && nav.level !== 'option') crumbs.push({ label: `Compare ${nav.cmp.length} shoes`, onClick: () => go({ level: 'compare', shoeKey: null, handNo: null }) });
    if (view && (nav.level === 'shoe' || nav.level === 'hand')) crumbs.push({ label: shoeCrumb(view), onClick: () => go({ level: 'shoe', handNo: null }) });
    if (nav.level === 'hand') crumbs.push({ label: `Hand #${nav.handNo}` });

    let prev = null, next = null, position = null;
    if (nav.level === 'option') {
        const i = sortedRows.findIndex((r) => r.code === nav.code);
        const a = sortedRows[i - 1], b = sortedRows[i + 1];
        prev = { label: a ? a.code : 'Prev option', onClick: a ? () => openOption(a.code) : null };
        next = { label: b ? b.code : 'Next option', onClick: b ? () => openOption(b.code) : null };
    } else if (nav.level === 'shoe' && view) {
        const list = nav.cmp.length > 1 ? nav.cmp : shoeRows.map((r) => r.view.shoeKey);
        const i = list.indexOf(view.shoeKey);
        if (i >= 0) position = `${i + 1} of ${list.length}`;
        const keep = nav.cmp.length > 1;
        prev = { label: 'Prev shoe', onClick: i > 0 ? () => openShoe(list[i - 1], keep) : null };
        next = { label: 'Next shoe', onClick: i >= 0 && i < list.length - 1 ? () => openShoe(list[i + 1], keep) : null };
    } else if (nav.level === 'hand' && view) {
        const i = view.hands.findIndex((h) => h.handNo === nav.handNo);
        const a = view.hands[i - 1], b = view.hands[i + 1];
        const keep = nav.cmp.length > 1;
        prev = { label: a ? `#${a.handNo}` : 'Prev hand', onClick: a ? () => openHand(view.shoeKey, a.handNo, keep) : null };
        next = { label: b ? `#${b.handNo}` : 'Next hand', onClick: b ? () => openHand(view.shoeKey, b.handNo, keep) : null };
    }

    // ── Body ───────────────────────────────────────────────────────────
    let body;
    if (!ready) {
        body = <Loading />;
    } else if (data.error) {
        body = (
            <Message
                title={`Couldn't load ${patronId}`}
                body={data.error}
                action={<Button variant="outlined" onClick={() => setAttempt((n) => n + 1)} sx={{ color: ACCENT, borderColor: ACCENT, textTransform: 'none', fontWeight: 700 }}>Retry</Button>}
            />
        );
    } else if (!model) {
        body = <Message title={`No bets · ${range.from} – ${range.to}`} body="Nothing in the last 12 months." />;
    } else if (nav.level === 'option' && kpi) {
        body = (
            <OptionLevel
                kpi={kpi} views={cur.views} periodLabel={pLabel} shoeRows={shoeRows}
                sort={sorts.shoes} onSort={setSort('shoes')}
                onlyNeg={onlyNeg} onOnlyNeg={(v) => { setOnlyNeg(v); setShowAll(false); }}
                showAll={showAll} onShowAll={() => setShowAll(true)}
                picks={picks}
                onTogglePick={(k) => setPicks((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; })}
                onClearPicks={() => setPicks(new Set())}
                onCompare={() => go({ level: 'compare', cmp: [...picks], shoeKey: null, handNo: null })}
                onOpenShoe={(k) => openShoe(k)}
                onOpenHand={(k, h) => openHand(k, h)}
            />
        );
    } else if (nav.level === 'compare' && nav.code && nav.cmp.length > 1) {
        body = (
            <CompareLevel
                views={nav.cmp.map((k) => viewByKey.get(k)).filter(Boolean)} code={nav.code}
                onOpenShoe={(k) => openShoe(k, true)} onOpenHand={(k, h) => openHand(k, h, true)}
            />
        );
    } else if (nav.level === 'shoe' && view && nav.code) {
        body = <ShoeLevel view={view} code={nav.code} onOpenHand={(h) => openHand(view.shoeKey, h, nav.cmp.length > 1)} />;
    } else if (nav.level === 'hand' && view && nav.code) {
        body = (
            <HandLevel view={view} code={nav.code} handNo={nav.handNo} sort={sorts.bets} onSort={setSort('bets')}
                onOpenHand={(h) => openHand(view.shoeKey, h, nav.cmp.length > 1)} />
        );
    } else {
        body = (
            <SummaryLevel
                rows={sortedRows}
                byPeriod={{ today: byPeriod.today.map, '3m': byPeriod['3m'].map, '12m': byPeriod['12m'].map }}
                verdict={verdict || { level: 'NO DATA', reason: '' }}
                worst={worst}
                periodLabel={pLabel}
                sort={sorts.sum}
                onSort={setSort('sum')}
                onOpen={openOption}
            />
        );
    }

    const source = ready && !data.error && model ? { live: data.live } : null;
    const showNav = ready && !data.error && model;

    return (
        <Dialog
            fullScreen
            open={open}
            onClose={onClose}
            transitionDuration={reducedMotion ? 0 : 220}
            slots={{ transition: SlideUp }}
            slotProps={{ paper: { sx: { bgcolor: SURFACE.page, backgroundImage: 'none', color: TEXT.primary } } }}
            aria-labelledby="p360-title"
        >
            <Header
                patronId={patronId}
                patronRow={patronRow}
                source={source}
                period={period}
                onPeriod={onPeriod}
                verdict={showNav ? verdict : null}
                onClose={onClose}
            />
            <Box ref={topRef} sx={{ px: { xs: 1.5, md: 2.5 }, py: 1.5, width: '100%', maxWidth: 2000, mx: 'auto', boxSizing: 'border-box', scrollMarginTop: 80 }}>
                <Stack spacing={1.5}>
                    {showNav ? (
                        <P360Nav crumbs={crumbs} onBack={nav.level === 'summary' ? null : back} prev={prev} next={next} position={position} />
                    ) : null}
                    <Box key={`${nav.level}|${nav.code}|${nav.shoeKey}|${nav.handNo}`} sx={{
                        animation: reducedMotion ? 'none' : 'p360In 160ms ease-out',
                        '@keyframes p360In': { from: { opacity: 0.4, transform: 'translateY(4px)' }, to: { opacity: 1, transform: 'none' } },
                    }}>
                        {body}
                    </Box>
                </Stack>
            </Box>
        </Dialog>
    );
}
