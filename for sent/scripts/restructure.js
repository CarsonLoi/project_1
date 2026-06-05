// One-shot restructure script:
//   • Move source files into src/{performance,trend,shared}/
//   • Walk every .js/.jsx and rewrite each relative import so it
//     points to the file's new location.
//
// Run from project root: `node scripts/restructure.js`.
// Safe to re-run — moves that have already happened are skipped.

const fs = require('fs');
const path = require('path');

const SRC = path.resolve(__dirname, '..', 'src');

// ---- Move plan ---------------------------------------------------
// Each entry: [oldPathRelativeToSrc, newPathRelativeToSrc].
const MOVES = [
  // Performance — page
  ['pages/PerformanceDashboard.js', 'performance/PerformanceDashboard.js'],

  // Performance — components
  ['components/performance/ConfigurableScatter.jsx', 'performance/components/ConfigurableScatter.jsx'],
  ['components/performance/DropdownSelector.js',     'performance/components/DropdownSelector.js'],
  ['components/performance/HourlyDemand.jsx',        'performance/components/HourlyDemand.jsx'],
  ['components/performance/PerformanceLegend.js',    'performance/components/PerformanceLegend.js'],
  ['components/performance/ScatterHeatmap.js',       'performance/components/ScatterHeatmap.js'],
  ['components/performance/ScatterHeatmapAvg.js',    'performance/components/ScatterHeatmapAvg.js'],
  ['components/performance/ScatterHeatmapPlay.js',   'performance/components/ScatterHeatmapPlay.js'],
  ['components/performance/ScatterHeatmapPlayWD.js', 'performance/components/ScatterHeatmapPlayWD.js'],
  ['components/performance/SelectorDate.js',         'performance/components/SelectorDate.js'],
  ['components/performance/TrendCharts.js',          'performance/components/TrendCharts.js'],
  ['components/performance/insightsTheme.js',        'performance/components/insightsTheme.js'],

  // Performance — utils
  ['utils/performance/dataProcessing.js',       'performance/utils/dataProcessing.js'],
  ['utils/performance/dataProcessingHourly.js', 'performance/utils/dataProcessingHourly.js'],
  ['utils/performance/wdDataSource.js',         'performance/utils/wdDataSource.js'],

  // Performance — data
  ['data/data_cod.json',        'performance/data/data_cod.json'],
  ['data/data_hourly_cod.json', 'performance/data/data_hourly_cod.json'],
  ['data/data_wd_cod.json',     'performance/data/data_wd_cod.json'],

  // Trend — page
  ['pages/TrendSeekerDashboard.js', 'trend/TrendSeekerDashboard.js'],

  // Trend — components
  ['components/BaccaratBoard.jsx',         'trend/components/BaccaratBoard.jsx'],
  ['components/CasinoFloor.js',            'trend/components/CasinoFloor.js'],
  ['components/FloorStats.js',             'trend/components/FloorStats.js'],
  ['components/HotTablesPanel.js',         'trend/components/HotTablesPanel.js'],
  ['components/Table3D.js',                'trend/components/Table3D.js'],
  ['components/TimeControls.js',           'trend/components/TimeControls.js'],
  ['components/TrendAnalyticsOverlay.jsx', 'trend/components/TrendAnalyticsOverlay.jsx'],
  ['components/TrendBoard.js',             'trend/components/TrendBoard.js'],
  ['components/TrendDatePicker.js',        'trend/components/TrendDatePicker.js'],
  ['components/TrendInfoDialog.jsx',       'trend/components/TrendInfoDialog.jsx'],
  ['components/TrendScoreChart.js',        'trend/components/TrendScoreChart.js'],
  ['components/TrendStatsTable.jsx',       'trend/components/TrendStatsTable.jsx'],

  // Trend — utils (floorLayout is only consumed by trend code today)
  ['utils/baccaratLayout.js',     'trend/utils/baccaratLayout.js'],
  ['utils/floorLayout.js',        'trend/utils/floorLayout.js'],
  ['utils/roadmaps.js',           'trend/utils/roadmaps.js'],
  ['utils/tableStatusSource.js',  'trend/utils/tableStatusSource.js'],
  ['utils/timeSeriesData.js',     'trend/utils/timeSeriesData.js'],
  ['utils/trendAnalyzer.js',      'trend/utils/trendAnalyzer.js'],
  ['utils/trendDataSource.js',    'trend/utils/trendDataSource.js'],

  // Shared (used by both subsystems)
  ['constants/heatmapConstants.js', 'shared/constants/heatmapConstants.js'],
  ['data/config_cod.json',          'shared/data/config_cod.json'],
];

// ---- Phase 1: ensure directories exist + move files --------------

function ensureDir(p) {
  const d = path.dirname(p);
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
}

const moveResolver = new Map(); // absoluteOldPath → absoluteNewPath
const newPathSet = new Set();   // set of absoluteNewPath, for resolver

for (const [oldRel, newRel] of MOVES) {
  newPathSet.add(path.normalize(path.join(SRC, newRel)));
}
for (const [oldRel, newRel] of MOVES) {
  const oldAbs = path.join(SRC, oldRel);
  const newAbs = path.join(SRC, newRel);
  moveResolver.set(path.normalize(oldAbs), path.normalize(newAbs));

  if (fs.existsSync(newAbs)) {
    // Already moved — skip.
    continue;
  }
  if (!fs.existsSync(oldAbs)) {
    // Source doesn't exist either — likely already moved on a prior
    // run; ignore.
    continue;
  }
  ensureDir(newAbs);
  fs.renameSync(oldAbs, newAbs);
  console.log('move', oldRel, '→', newRel);
}

// ---- Phase 2: rewrite imports in every .js/.jsx under src/ -------

function walk(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(full));
    else if (/\.(jsx?|tsx?)$/.test(e.name)) out.push(full);
  }
  return out;
}

// Resolve an import specifier (relative to `fromFile`) to an absolute
// file path. Returns null for non-relative specs (packages etc.).
//
// Tries three signals so it works during a re-run (where some files
// have moved and some haven't):
//   1. The spec resolves to a key in `moveResolver` (an OLD path).
//   2. The spec resolves to a value in `moveResolver` (a NEW path).
//   3. The spec resolves to a file that currently exists on disk
//      (untouched files).
function resolveImport(fromFile, spec) {
  if (!spec.startsWith('.')) return null;
  const fromDir = path.dirname(fromFile);
  const base = path.resolve(fromDir, spec);
  const candidates = [
    base,
    base + '.js',
    base + '.jsx',
    base + '.ts',
    base + '.tsx',
    base + '.json',
    path.join(base, 'index.js'),
    path.join(base, 'index.jsx'),
  ];
  for (const c of candidates) {
    const norm = path.normalize(c);
    if (moveResolver.has(norm)) return norm;       // old path matches a moved file
    if (newPathSet.has(norm)) return norm;         // new path matches a moved file
    if (fs.existsSync(c) && fs.statSync(c).isFile()) return norm;
  }
  return null;
}

// Pre-compute reverse map: any file that USED to live at oldAbs now
// lives at newAbs. For resolving imports written against the OLD
// layout, we need both old→new and a "current" location for files
// that didn't move.
function moveResolverGet(absolutePath) {
  return moveResolver.get(path.normalize(absolutePath)) || absolutePath;
}

// Rewrite every relative import in `file` so it points at the new
// location of the imported file.
function rewriteFile(file) {
  // Where this file LIVES after the move (we walk the new tree so
  // `file` IS already the post-move path).
  const fileNow = file;

  // To resolve old-style relative paths we also need to know what
  // this file was BEFORE the move (if it moved). Reverse the move
  // table for that lookup.
  let fileBefore = file;
  for (const [oldAbs, newAbs] of moveResolver.entries()) {
    if (newAbs === path.normalize(file)) {
      fileBefore = oldAbs;
      break;
    }
  }

  let src = fs.readFileSync(file, 'utf8');
  let changed = false;
  const replace = (matchStr, q, spec) => {
    if (!spec.startsWith('.')) return matchStr;

    // Resolve the spec relative to BOTH the old and new file
    // locations. If neither resolves to a real file, leave it
    // alone (might be an asset or already correct).
    let target = resolveImport(fileBefore, spec);
    if (!target) target = resolveImport(fileNow, spec);
    if (!target) return matchStr;

    // Where the target sits now (after moves).
    const targetNow = moveResolverGet(target);

    // Compute new relative path from `fileNow`'s directory.
    let rel = path.relative(path.dirname(fileNow), targetNow).replace(/\\/g, '/');
    if (!rel.startsWith('.')) rel = './' + rel;

    // Strip recognised extensions so import strings stay the way
    // the codebase already writes them (".js"/".jsx"/".json" are
    // usually omitted; ".json" is sometimes kept for clarity).
    const ext = path.extname(rel);
    if (ext === '.js' || ext === '.jsx') {
      rel = rel.slice(0, -ext.length);
    }
    // Keep .json explicit — bundlers handle that fine and the
    // existing code already imports JSON with the extension.

    if (rel === spec) return matchStr;
    changed = true;
    return matchStr.replace(spec, rel);
  };

  // `from '…'` / `from "…"` (ES imports + re-exports).
  src = src.replace(/from\s+(['"])([^'"]+)\1/g, (m, q, s) => replace(m, q, s));
  // `import(…)` dynamic imports.
  src = src.replace(/import\(\s*(['"])([^'"]+)\1\s*\)/g, (m, q, s) => replace(m, q, s));
  // `require('…')` (CommonJS, in case any sneaked in).
  src = src.replace(/require\(\s*(['"])([^'"]+)\1\s*\)/g, (m, q, s) => replace(m, q, s));

  if (changed) {
    fs.writeFileSync(file, src);
    console.log('rewrite', path.relative(SRC, file));
  }
}

const files = walk(SRC);
for (const f of files) rewriteFile(f);

// ---- Phase 3: prune empty legacy folders --------------------------

function pruneEmpty(dir) {
  if (!fs.existsSync(dir)) return;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) pruneEmpty(path.join(dir, e.name));
  }
  try {
    if (fs.readdirSync(dir).length === 0) {
      fs.rmdirSync(dir);
      console.log('rmdir ', path.relative(SRC, dir) || '(src)');
    }
  } catch (_) { /* not empty, leave it */ }
}
pruneEmpty(path.join(SRC, 'pages'));
pruneEmpty(path.join(SRC, 'components', 'performance'));
pruneEmpty(path.join(SRC, 'components'));
pruneEmpty(path.join(SRC, 'utils', 'performance'));
pruneEmpty(path.join(SRC, 'utils'));
pruneEmpty(path.join(SRC, 'constants'));
pruneEmpty(path.join(SRC, 'data'));

console.log('done');
