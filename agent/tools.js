#!/usr/bin/env node
/**
 * Leadership Autopilot - Agent Tools
 * 
 * Deterministic tools for the agent to access Weekly Business Review data.
 * Each tool does structured data extraction - no LLM needed.
 */

const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');
const yaml = require('yaml');

// Base data path
const DATA_DIR = path.join(__dirname, '..', 'data', 'weekly');

// Metric layout definitions
const MARGIN_METRICS = new Set([
  'ASP',
  'NetPPMLessSD',
  'CM',
  'SOROOS_PROCURABLE_PRODUCT_OOS_GV_PCT',
]);

function isMarginMetric(metric) {
  return MARGIN_METRICS.has(metric);
}

function getExpectedLayout(metric) {
  return isMarginMetric(metric) ? 'margin' : 'standard';
}

// =============================================================================
// ASIN-TO-SUBCAT MAPPING (lazy-loaded, cached)
// =============================================================================

let _asinMapping = null;

/**
 * Load ASIN-to-subcategory mapping from CSV.
 * Returns Map<ASIN, shortSubcatCode> e.g. "B0FAKE001" → "1001"
 * Covers ~86% of GMS by value; long-tail ASINs are unmapped.
 */
function loadAsinMapping() {
  if (_asinMapping) return _asinMapping;
  const csvPath = path.join(__dirname, '..', 'data', 'ASIN to Subcategory Mapping.csv');
  if (!fs.existsSync(csvPath)) {
    _asinMapping = new Map();
    return _asinMapping;
  }
  const content = fs.readFileSync(csvPath, 'utf-8');
  // Strip BOM if present
  const lines = content.replace(/^\uFEFF/, '').trim().split('\n');
  const map = new Map();
  for (let i = 1; i < lines.length; i++) {
    const comma = lines[i].indexOf(',');
    if (comma === -1) continue;
    const asin = lines[i].substring(0, comma).trim();
    const desc = lines[i].substring(comma + 1).trim();
    const codeMatch = desc.match(/^(\d+)\s/);
    if (codeMatch) {
      map.set(asin, codeMatch[1]); // short code like "0705"
    }
  }
  _asinMapping = map;
  return _asinMapping;
}

// =============================================================================
// GL-TO-SUBCAT MAPPING (lazy-loaded, cached)
// =============================================================================

let _glMapping = null;       // Map<fullCode, glName>
let _glSubcatSets = null;    // Map<glNameLower, Set<fullCode>>
let _glNames = null;         // Set<glName> (original case from mapping file)

/**
 * Load GL-to-subcategory mapping.
 * Uses the mapping Excel file (GL → short codes + names) combined with
 * the ALL GMS subcat file (8-digit full codes + names) to build:
 *   fullCode → GL name
 *
 * Matching strategy:
 * 1. Match by last-4-digits of code + normalized subcat name → unique GL
 * 2. For ambiguous matches, disambiguate by code prefix (each GL has known prefixes)
 * 3. For unmatched codes, assign by prefix lookup against known GL prefix sets
 */
function loadGLMapping() {
  if (_glMapping) return _glMapping;

  const mappingPath = path.join(__dirname, '..', 'data', 'GL to Subcat mapping.xlsx');
  if (!fs.existsSync(mappingPath)) {
    _glMapping = new Map();
    _glSubcatSets = new Map();
    _glNames = new Set();
    return _glMapping;
  }

  const normalize = (s) => s.toLowerCase().replace(/[,&\-]/g, ' ').replace(/\s+/g, ' ').trim();

  // Step 1: Parse mapping file → GL → [{shortCode, name}]
  const wb = XLSX.readFile(mappingPath);
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const mRows = XLSX.utils.sheet_to_json(sheet, { header: 1 });

  const glShortCodes = {};  // GL → [{code, name}]
  const glNamesSet = new Set();
  for (let i = 1; i < mRows.length; i++) {
    const gl = String(mRows[i][0] || '').trim();
    const desc = String(mRows[i][1] || '');
    const m = desc.match(/^(\d+)\s+(.*)/);
    if (!gl || !m) continue;
    if (!glShortCodes[gl]) glShortCodes[gl] = [];
    glShortCodes[gl].push({ code: m[1], name: normalize(m[2]) });
    glNamesSet.add(gl);
  }

  // Step 2: Read ALL GMS subcat file to get full codes + names
  const latestWeek = listWeeks().weeks?.[0];
  if (!latestWeek) {
    _glMapping = new Map();
    _glSubcatSets = new Map();
    _glNames = glNamesSet;
    return _glMapping;
  }

  const allManifestPath = path.join(DATA_DIR, latestWeek, 'gl', 'all', '_manifest.yaml');
  if (!fs.existsSync(allManifestPath)) {
    _glMapping = new Map();
    _glSubcatSets = new Map();
    _glNames = glNamesSet;
    return _glMapping;
  }

  const allManifest = yaml.parse(fs.readFileSync(allManifestPath, 'utf-8'));
  const gmsFile = allManifest.files?.subcat?.GMS;
  if (!gmsFile) {
    _glMapping = new Map();
    _glSubcatSets = new Map();
    _glNames = glNamesSet;
    return _glMapping;
  }

  const gmsPath = path.join(DATA_DIR, latestWeek, 'gl', 'all', gmsFile);
  const { workbook, error } = safeReadExcel(gmsPath);
  if (error) {
    _glMapping = new Map();
    _glSubcatSets = new Map();
    _glNames = glNamesSet;
    return _glMapping;
  }

  const dataSheet = workbook.Sheets[workbook.SheetNames[0]];
  const dataRows = XLSX.utils.sheet_to_json(dataSheet, { header: 1 });

  // Collect all full codes + names from ALL file
  const allSubcats = [];
  for (let i = 2; i < dataRows.length; i++) {
    const row = dataRows[i];
    if (!row || !row[0]) continue;
    const full = String(row[0]).trim();
    if (full.toLowerCase() === 'total' || full === 'UNKNOWN') continue;
    allSubcats.push({ full, name: normalize(String(row[1] || '')) });
  }

  // Step 3: Match each full code to GL(s) using last4 + name
  const fullToGLs = {};
  for (const sub of allSubcats) {
    const last4 = sub.full.slice(-4);
    const matches = [];
    for (const [gl, entries] of Object.entries(glShortCodes)) {
      for (const e of entries) {
        if (e.code.slice(-4) === last4 &&
            (e.name === sub.name || sub.name.includes(e.name) || e.name.includes(sub.name))) {
          matches.push(gl);
          break;
        }
      }
    }
    fullToGLs[sub.full] = matches;
  }

  // Step 4: Build GL → prefix sets from unique matches
  const glPrefixSets = {};
  for (const [full, gls] of Object.entries(fullToGLs)) {
    if (gls.length !== 1) continue;
    const gl = gls[0];
    const prefix = full.substring(0, full.length - 4);
    if (!glPrefixSets[gl]) glPrefixSets[gl] = new Set();
    glPrefixSets[gl].add(prefix);
  }

  // Step 5: Resolve multi-GL and unmatched using prefix disambiguation
  const fullCodeToGL = new Map();
  for (const sub of allSubcats) {
    const gls = fullToGLs[sub.full] || [];
    const prefix = sub.full.substring(0, sub.full.length - 4);
    if (gls.length === 1) {
      fullCodeToGL.set(sub.full, gls[0]);
    } else if (gls.length > 1) {
      const match = gls.find(gl => glPrefixSets[gl]?.has(prefix));
      fullCodeToGL.set(sub.full, match || gls[0]);
    } else {
      // No name match — assign by prefix
      for (const [gl, prefixes] of Object.entries(glPrefixSets)) {
        if (prefixes.has(prefix)) {
          fullCodeToGL.set(sub.full, gl);
          break;
        }
      }
    }
  }

  // Step 6: Build reverse map: GL → Set<fullCode>
  const glSets = new Map();
  for (const [full, gl] of fullCodeToGL) {
    const key = gl.toLowerCase();
    if (!glSets.has(key)) glSets.set(key, new Set());
    glSets.get(key).add(full);
  }

  _glMapping = fullCodeToGL;
  _glSubcatSets = glSets;
  _glNames = glNamesSet;
  return _glMapping;
}

/**
 * Get the set of full subcat codes belonging to a GL.
 * Returns null for "all" (meaning no filtering).
 */
function getSubcatsForGL(gl) {
  if (!gl || gl.toLowerCase() === 'all') return null;
  loadGLMapping();
  return _glSubcatSets?.get(gl.toLowerCase()) || new Set();
}

/**
 * Get the list of GL names from the mapping file.
 */
function getGLNamesFromMapping() {
  loadGLMapping();
  return _glNames || new Set();
}

/**
 * Resolve data folder for a GL: prefer ALL data with GL filtering,
 * fall back to per-GL folder if ALL doesn't exist (e.g., older weeks).
 * Returns { dataDir, manifest, useAllWithFilter }
 */
function resolveGLDataFolder(week, gl) {
  const allManifestPath = path.join(DATA_DIR, week, 'gl', 'all', '_manifest.yaml');
  if (fs.existsSync(allManifestPath)) {
    const manifest = yaml.parse(fs.readFileSync(allManifestPath, 'utf-8'));
    return {
      dataDir: path.join(DATA_DIR, week, 'gl', 'all'),
      manifest,
      useAllWithFilter: gl.toLowerCase() !== 'all',
    };
  }
  // Fallback: per-GL folder
  const glManifestPath = path.join(DATA_DIR, week, 'gl', gl, '_manifest.yaml');
  if (fs.existsSync(glManifestPath)) {
    const manifest = yaml.parse(fs.readFileSync(glManifestPath, 'utf-8'));
    return { dataDir: path.join(DATA_DIR, week, 'gl', gl), manifest, useAllWithFilter: false };
  }
  return { dataDir: null, manifest: null, useAllWithFilter: false };
}

// =============================================================================
// SAFETY HELPERS
// =============================================================================

/**
 * Safe Excel file reader with error handling
 * Returns { workbook, error }
 */
function safeReadExcel(filepath) {
  try {
    if (!fs.existsSync(filepath)) {
      return { workbook: null, error: `File not found: ${path.basename(filepath)}` };
    }
    const workbook = XLSX.readFile(filepath);
    if (!workbook.SheetNames || workbook.SheetNames.length === 0) {
      return { workbook: null, error: `Empty workbook: ${path.basename(filepath)}` };
    }
    return { workbook, error: null };
  } catch (err) {
    return { workbook: null, error: `Failed to parse ${path.basename(filepath)}: ${err.message}` };
  }
}

/**
 * Safe division - returns null instead of Infinity/NaN
 */
function safeDivide(numerator, denominator) {
  if (denominator === 0 || denominator === null || denominator === undefined) {
    return null;
  }
  const result = numerator / denominator;
  if (!isFinite(result)) return null;
  return result;
}

/**
 * Safe percentage - handles edge cases
 */
function safePercent(value) {
  if (value === null || value === undefined || !isFinite(value)) {
    return null;
  }
  return value;
}

/**
 * Get the denominator metric for a margin metric.
 * Used to estimate prior-period denominators via the cross-metric approach.
 * Returns the metric key whose col2 value ≈ the margin metric's col4 (denominator).
 */
function getDenominatorMetric(metric) {
  const map = {
    'NetPPMLessSD': 'GMS',
    'CM': 'GMS',
    'ASP': 'ShippedUnits',
    'SOROOS_PROCURABLE_PRODUCT_OOS_GV_PCT': 'GMS', // GMS as best available proxy
  };
  return map[metric] || null;
}

/**
 * Load denominator metric's WoW%/YoY% per subcat for cross-metric prior-period estimation.
 * Returns Map<code, { wowPct, yoyPct }> from the standard metric file.
 */
function loadDenominatorPctMap(dataDir, manifest, denMetricKey) {
  const pctMap = new Map();
  if (!denMetricKey) return pctMap;
  const denFile = manifest.files?.subcat?.[denMetricKey];
  if (!denFile) return pctMap;
  const denPath = path.join(dataDir, denFile);
  const { workbook: denWb } = safeReadExcel(denPath);
  if (!denWb) return pctMap;
  const denSheet = denWb.Sheets[denWb.SheetNames[0]];
  const denRows = XLSX.utils.sheet_to_json(denSheet, { header: 1, defval: null });
  // Standard metric: col3=WoW%, col4=YoY%
  for (let i = 2; i < denRows.length; i++) {
    const dr = denRows[i];
    if (!dr || !dr[0]) continue;
    const c = String(dr[0]).trim();
    if (c.toLowerCase() === 'total') continue;
    pctMap.set(c, { wowPct: dr[3] || 0, yoyPct: dr[4] || 0 });
  }
  return pctMap;
}

/**
 * Validate Excel column layout matches expected structure.
 * Returns { valid, layout, warning } where layout is 'standard' or 'margin'.
 * Standard: 9 cols (GMS, ShippedUnits)
 * Margin: 13 cols (ASP, NetPPMLessSD, CM, SOROOS)
 */
function detectFileLayout(rows) {
  const headerRow = rows[1] || [];
  const colCount = headerRow.length;
  const mergeRow = rows[0] || [];
  
  // Check for WoW/YoY Variance in merge row to confirm structure
  const hasWowVariance = mergeRow.some(v => v && /wow\s+variance/i.test(String(v)));
  const hasYoyVariance = mergeRow.some(v => v && /yoy\s+variance/i.test(String(v)));
  
  if (!hasWowVariance || !hasYoyVariance) {
    return { valid: false, layout: null, warning: 'Missing WoW/YoY Variance headers — unexpected file format' };
  }
  
  // Detect layout from column count
  if (colCount === 9) {
    return { valid: true, layout: 'standard' };
  } else if (colCount === 13) {
    return { valid: true, layout: 'margin' };
  } else {
    return { valid: false, layout: null, warning: `Unexpected column count: ${colCount} (expected 9 or 13)` };
  }
}

function validateMetricLayout(rows, metric, level) {
  const layoutCheck = detectFileLayout(rows);
  if (!layoutCheck.valid) {
    return `${metric} ${level} file has unexpected format: ${layoutCheck.warning}`;
  }

  const expectedLayout = getExpectedLayout(metric);
  if (layoutCheck.layout !== expectedLayout) {
    return `${metric} ${level} file layout mismatch: expected ${expectedLayout} but detected ${layoutCheck.layout}`;
  }

  return null;
}

/**
 * Get data freshness info for a week
 * Returns age in days and a warning if stale
 */
function getDataFreshness(week) {
  // Parse week format: "2026-wk05"
  const match = week.match(/^(\d{4})-wk(\d+)$/);
  if (!match) {
    return { ageDays: null, warning: null };
  }
  
  const year = parseInt(match[1]);
  const weekNum = parseInt(match[2]);
  
  // Calculate approximate week end date (Sunday)
  // Week 1 starts on first Monday of the year (ISO week)
  const jan1 = new Date(year, 0, 1);
  const daysToFirstMonday = (8 - jan1.getDay()) % 7;
  const firstMonday = new Date(year, 0, 1 + daysToFirstMonday);
  const weekStart = new Date(firstMonday.getTime() + (weekNum - 1) * 7 * 24 * 60 * 60 * 1000);
  const weekEnd = new Date(weekStart.getTime() + 6 * 24 * 60 * 60 * 1000);
  
  const now = new Date();
  const ageDays = Math.floor((now - weekEnd) / (24 * 60 * 60 * 1000));
  
  let warning = null;
  if (ageDays < 0) {
    warning = `⚠️ INCOMPLETE: This week ends ${-ageDays} days from now. Data may be partial.`;
  } else if (ageDays > 14) {
    warning = `⚠️ STALE DATA: This data is ${ageDays} days old (${Math.floor(ageDays/7)} weeks ago).`;
  } else if (ageDays > 7) {
    warning = `Note: Data is from last week (${ageDays} days old).`;
  }
  
  return { ageDays, weekEnd: weekEnd.toISOString().split('T')[0], warning };
}

/**
 * Tool: list_weeks
 * List all available weeks of data
 */
function listWeeks() {
  if (!fs.existsSync(DATA_DIR)) {
    return { weeks: [], error: null };
  }

  const parseWeek = (weekStr) => {
    const match = weekStr.match(/^(\d{4})-wk(\d+)$/);
    if (!match) return { year: 0, week: 0 };
    return { year: parseInt(match[1], 10), week: parseInt(match[2], 10) };
  };
  
  const weeks = fs.readdirSync(DATA_DIR)
    .filter(d => d.match(/^\d{4}-wk\d+$/))
    .sort((a, b) => {
      const wa = parseWeek(a);
      const wb = parseWeek(b);
      if (wa.year !== wb.year) return wb.year - wa.year;
      return wb.week - wa.week;
    });
  
  return { weeks };
}

/**
 * Tool: list_gls
 * List available GLs for a given week
 */
function listGLs(week) {
  const glDir = path.join(DATA_DIR, week, 'gl');

  if (!fs.existsSync(glDir)) {
    return { gls: [], error: `Week ${week} not found` };
  }

  // Load ALL manifest for metrics list
  const allManifestPath = path.join(glDir, 'all', '_manifest.yaml');
  let allMetrics = [];
  if (fs.existsSync(allManifestPath)) {
    const manifest = yaml.parse(fs.readFileSync(allManifestPath, 'utf-8'));
    allMetrics = manifest.metrics_available || [];
  }

  // Start with 'all' from the directory
  const glInfo = [{ name: 'all', metrics: allMetrics }];

  // Add GLs from the mapping file
  const glNames = getGLNamesFromMapping();
  for (const name of glNames) {
    glInfo.push({ name: name.toLowerCase(), metrics: allMetrics });
  }

  return { gls: glInfo };
}

/**
 * Tool: get_summary
 * Get the summary markdown for a GL.
 * When ALL data is available and gl != 'all', generates the summary dynamically
 * from getMetricTotals/getMetricDrivers so numbers match the dashboard cards.
 */
function getSummary(week, gl) {
  const { dataDir, useAllWithFilter } = resolveGLDataFolder(week, gl);

  // For specific GLs using ALL data, generate summary dynamically
  // so agent narrative matches dashboard metric cards exactly.
  if (useAllWithFilter) {
    return { summary: generateGLSummary(week, gl) };
  }

  // For 'all' or per-GL folders (no ALL data), use static summary file
  let summaryPath = path.join(DATA_DIR, week, 'gl', gl, '_summary.md');
  if (!fs.existsSync(summaryPath) && dataDir) {
    summaryPath = path.join(dataDir, '_summary.md');
  }

  if (!fs.existsSync(summaryPath)) {
    return { summary: null, error: `Summary not found for ${gl} in ${week}` };
  }

  const summary = fs.readFileSync(summaryPath, 'utf-8');
  return { summary };
}

/**
 * Generate a GL-specific summary dynamically from computed values.
 * Uses getMetricTotals and getMetricDrivers so numbers are consistent
 * with the dashboard metric cards.
 */
function generateGLSummary(week, gl) {
  const weekNum = week.split('-')[1]?.replace('wk', '') || week;
  let md = `# ${gl.toUpperCase()} — Week ${weekNum} Summary\n\n`;
  md += `*Computed from ALL consolidated data, filtered to ${gl.toUpperCase()} subcategories.*\n\n---\n\n`;

  const totals = getMetricTotals(week, gl);
  if (!totals.metrics || totals.metrics.length === 0) {
    md += 'No metric data available.\n';
    return md;
  }

  // Build a lookup
  const tm = {};
  for (const m of totals.metrics) tm[m.name] = m;

  const fmtBps = (v) => v >= 0 ? `+${v} bps` : `${v} bps`;
  const fmtPct = (v) => v >= 0 ? `+${v.toFixed(1)}%` : `${v.toFixed(1)}%`;

  // Helper: render metric section with top drivers
  function renderSection(key, label, unit) {
    const m = tm[key];
    if (!m || m.value === '—') return '';

    let section = `## ${label}\n\n`;
    section += `**Total:** ${m.value} | `;
    if (m.wowUnit === 'bps') {
      section += `**WoW:** ${fmtBps(m.wow)} | **YoY:** ${fmtBps(m.yoy)}\n\n`;
    } else {
      section += `**WoW:** ${fmtPct(m.wow)} | **YoY:** ${fmtPct(m.yoy)}\n\n`;
    }

    // Top YoY drivers
    const metricKey = {
      'gms': 'GMS', 'shippedunits': 'ShippedUnits', 'asp': 'ASP',
      'netppmlesssd': 'NetPPMLessSD', 'cm': 'CM',
    }[key];
    if (metricKey) {
      const drivers = getMetricDrivers(week, gl, metricKey, { period: 'yoy', limit: 3 });
      if (drivers.drivers && drivers.drivers.length > 0) {
        const ctcLabel = (m.wowUnit === 'bps') ? 'CTC (bps)' : 'CTC';
        section += `### Top YoY Drivers\n\n`;
        section += `| Rank | Sub-Category | ${ctcLabel} |\n`;
        section += `|------|--------------|------|\n`;
        drivers.drivers.forEach((d, i) => {
          const sign = d.ctc >= 0 ? '+' : '';
          section += `| ${i + 1} | ${d.subcat_name} | ${sign}${d.ctc} |\n`;
        });
        section += `\n`;
      }
    }
    return section;
  }

  md += renderSection('gms', 'Shipped GMS');
  md += renderSection('shippedunits', 'Shipped Units');
  md += renderSection('asp', 'ASP (Average Selling Price)');
  md += renderSection('netppmlesssd', 'Net PPM');
  md += renderSection('cm', 'CM (Contribution Margin)');

  return md;
}

/**
 * Tool: get_manifest
 * Get the manifest for a GL (lists all available files)
 */
function getManifest(week, gl) {
  const { manifest } = resolveGLDataFolder(week, gl);
  if (!manifest) {
    return { manifest: null, error: `Manifest not found for ${week}` };
  }
  manifest.gl = gl;
  return { manifest };
}

/**
 * Tool: get_metric_drivers
 * Get top N drivers for a metric at SUBCAT level
 */
function getMetricDrivers(week, gl, metric, options = {}) {
  // Null guard
  if (!week || !gl || !metric) {
    return { drivers: null, error: 'Missing required parameters: week, gl, metric' };
  }

  const {
    period = 'yoy',      // 'yoy' or 'wow'
    limit = 5,           // Number of drivers to return
    direction = 'both',  // 'positive', 'negative', or 'both'
  } = options;

  // Prefer ALL data with GL filtering; fall back to per-GL folder
  const { dataDir, manifest, useAllWithFilter } = resolveGLDataFolder(week, gl);
  if (!dataDir || !manifest) {
    return { drivers: null, error: `Data not found for ${gl} in ${week}` };
  }

  const filename = manifest.files?.subcat?.[metric];

  if (!filename) {
    return { drivers: null, error: `Metric ${metric} not found` };
  }

  const filepath = path.join(dataDir, filename);
  const { workbook, error: readError } = safeReadExcel(filepath);
  if (readError) {
    return { drivers: null, error: readError };
  }
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null });

  // Validate file layout
  const layoutError = validateMetricLayout(rows, metric, 'subcat');
  if (layoutError) {
    return { drivers: null, error: layoutError };
  }

  const isMargin = isMarginMetric(metric);
  const valueColIndex = 2;
  const glSubcats = useAllWithFilter ? getSubcatsForGL(gl) : null;
  const isGLFiltered = glSubcats !== null;

  let wowPctCol, yoyPctCol, ctcColIndex;
  if (isMargin) {
    wowPctCol = 5;
    yoyPctCol = 6;
    ctcColIndex = period === 'yoy' ? 10 : 7;
  } else {
    wowPctCol = 3;
    yoyPctCol = 4;
    ctcColIndex = period === 'yoy' ? 8 : 6;
  }

  // For GL-filtered absolute metrics, compute GL-level totals for CTC(bps) recalculation
  // CTC(bps) = (subcat_delta / GL_delta) * GL_pct_change * 10000  [primer sheet 3]
  let glTotalDelta = 0, glTotalPct = 0;
  if (isGLFiltered && !isMargin) {
    const ctcDollarCol = period === 'yoy' ? 7 : 5;
    let sumValue = 0, sumCtcDollar = 0;
    for (let i = 2; i < rows.length; i++) {
      const row = rows[i];
      if (!row || !row[0]) continue;
      const code = String(row[0]).trim();
      if (code.toLowerCase() === 'total' || !glSubcats.has(code)) continue;
      sumValue += (row[valueColIndex] || 0);
      sumCtcDollar += (row[ctcDollarCol] || 0);
    }
    glTotalDelta = sumCtcDollar;
    const prior = sumValue - sumCtcDollar;
    glTotalPct = prior !== 0 ? sumCtcDollar / prior : 0;
  }

  // For GL-filtered margin metrics, compute GL-level denominator for revenue-mix weighting
  let glTotalDen = 0;
  if (isGLFiltered && isMargin) {
    const denCol = 4; // denominator (revenue) column for margin metrics
    for (let i = 2; i < rows.length; i++) {
      const row = rows[i];
      if (!row || !row[0]) continue;
      const code = String(row[0]).trim();
      if (code.toLowerCase() === 'total' || !glSubcats.has(code)) continue;
      glTotalDen += Math.abs(row[denCol] || 0);
    }
  }

  const drivers = [];

  // Parse data rows (skip header rows)
  for (let i = 2; i < rows.length; i++) {
    const row = rows[i];
    if (!row || !row[0]) continue;

    const code = String(row[0]).trim();
    if (code.toLowerCase() === 'total') continue;

    // Apply GL filter
    if (isGLFiltered && !glSubcats.has(code)) continue;

    const name = row[1] ? String(row[1]).trim() : code;
    const value = row[valueColIndex];
    let ctc = row[ctcColIndex];

    if (ctc === null || ctc === undefined) continue;

    // Recompute CTC(bps) relative to GL total when GL-filtered
    if (isGLFiltered) {
      if (!isMargin) {
        // Absolute metric: CTC(bps) = (subcat_delta / GL_delta) * GL_pct * 10000
        const ctcDollarCol = period === 'yoy' ? 7 : 5;
        const subcatDelta = row[ctcDollarCol] || 0;
        if (glTotalDelta !== 0) {
          ctc = Math.round((subcatDelta / glTotalDelta) * glTotalPct * 10000);
        }
      } else {
        // Margin metric: CTC ≈ Rate Impact = (GL revenue mix) × (subcat bps change)
        const den = Math.abs(row[4] || 0);
        const bpsChange = period === 'yoy' ? (row[6] || 0) : (row[5] || 0);
        if (glTotalDen > 0) {
          ctc = Math.round((den / glTotalDen) * bpsChange);
        }
      }
    }

    // Filter by direction
    if (direction === 'positive' && ctc < 0) continue;
    if (direction === 'negative' && ctc > 0) continue;

    const wowPct = row[wowPctCol];
    const yoyPct = row[yoyPctCol];

    drivers.push({
      subcat_code: code,
      subcat_name: name,
      value: value,
      wow_pct: wowPct,
      yoy_pct: yoyPct,
      ctc: ctc,
    });
  }

  // Sort by absolute CTC
  drivers.sort((a, b) => Math.abs(b.ctc) - Math.abs(a.ctc));

  // Limit results
  const topDrivers = drivers.slice(0, limit);

  // Get total row (for 'all') or compute GL total
  let total = null;
  if (!isGLFiltered) {
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      if (row && String(row[0]).toLowerCase() === 'total') {
        total = {
          value: row[valueColIndex],
          wow_pct: row[wowPctCol],
          yoy_pct: row[yoyPctCol],
        };
        break;
      }
    }
  } else {
    // Compute GL total from filtered subcats using cross-metric denominator approach
    if (isMargin) {
      const denMetricKey = getDenominatorMetric(metric);
      const denPctMap = loadDenominatorPctMap(dataDir, manifest, denMetricKey);
      // Per-unit metrics (ASP) use fractional WoW/YoY; percent metrics use bps
      const isBps = isMarginMetric(metric) && !['ASP'].includes(metric);
      let sumP2Num = 0, sumP2Den = 0;
      let sumP1NumWow = 0, sumP1DenWow = 0;
      let sumP1NumYoy = 0, sumP1DenYoy = 0;
      for (let i = 2; i < rows.length; i++) {
        const row = rows[i];
        if (!row || !row[0]) continue;
        const code = String(row[0]).trim();
        if (code.toLowerCase() === 'total' || !glSubcats.has(code)) continue;
        const num = row[3] || 0;
        const den = row[4] || 0;
        const rate = den !== 0 ? num / den : 0;
        const wowChg = row[5] || 0;
        const yoyChg = row[6] || 0;
        sumP2Num += num;
        sumP2Den += den;
        // Prior rate from subcat's own WoW/YoY
        let p1RW, p1RY;
        if (isBps) {
          p1RW = rate - wowChg / 10000;
          p1RY = rate - yoyChg / 10000;
        } else {
          p1RW = (wowChg > -1) ? rate / (1 + wowChg) : rate;
          p1RY = (yoyChg > -1) ? rate / (1 + yoyChg) : rate;
        }
        // Prior denominator from cross-metric growth rate
        const dp = denPctMap.get(code);
        const wDenPct = dp ? (dp.wowPct || 0) : 0;
        const yDenPct = dp ? (dp.yoyPct || 0) : 0;
        const p1DenW = (wDenPct > -1) ? den / (1 + wDenPct) : den;
        const p1DenY = (yDenPct > -1) ? den / (1 + yDenPct) : den;
        sumP1NumWow += p1RW * p1DenW;
        sumP1DenWow += p1DenW;
        sumP1NumYoy += p1RY * p1DenY;
        sumP1DenYoy += p1DenY;
      }
      const p2Rate = sumP2Den !== 0 ? sumP2Num / sumP2Den : 0;
      const p1RateW = sumP1DenWow !== 0 ? sumP1NumWow / sumP1DenWow : p2Rate;
      const p1RateY = sumP1DenYoy !== 0 ? sumP1NumYoy / sumP1DenYoy : p2Rate;
      if (isBps) {
        total = {
          value: sumP2Den !== 0 ? sumP2Num / sumP2Den : null,
          wow_pct: (p2Rate - p1RateW) * 10000,
          yoy_pct: (p2Rate - p1RateY) * 10000,
        };
      } else {
        total = {
          value: sumP2Den !== 0 ? sumP2Num / sumP2Den : null,
          wow_pct: p1RateW !== 0 ? (p2Rate / p1RateW - 1) : 0,
          yoy_pct: p1RateY !== 0 ? (p2Rate / p1RateY - 1) : 0,
        };
      }
    } else {
      let sumVal = 0, sumWowCtc = 0, sumYoyCtc = 0;
      for (let i = 2; i < rows.length; i++) {
        const row = rows[i];
        if (!row || !row[0]) continue;
        const code = String(row[0]).trim();
        if (code.toLowerCase() === 'total' || !glSubcats.has(code)) continue;
        sumVal += (row[valueColIndex] || 0);
        sumWowCtc += (row[5] || 0);
        sumYoyCtc += (row[7] || 0);
      }
      const priorW = sumVal - sumWowCtc;
      const priorY = sumVal - sumYoyCtc;
      total = {
        value: sumVal,
        wow_pct: priorW !== 0 ? sumWowCtc / priorW : 0,
        yoy_pct: priorY !== 0 ? sumYoyCtc / priorY : 0,
      };
    }
  }

  return {
    metric,
    period,
    total,
    drivers: topDrivers,
  };
}

/**
 * Tool: get_all_subcat_data
 * Load ALL subcategory data for a GL - comprehensive view
 * Returns one row per subcat with all key metrics
 */
function getAllSubcatData(week, gl) {
  // Null guard
  if (!week || !gl) {
    return { subcats: [], error: 'Missing required parameters: week, gl' };
  }

  // Prefer ALL data with GL filtering; fall back to per-GL folder
  const { dataDir, manifest, useAllWithFilter } = resolveGLDataFolder(week, gl);
  if (!dataDir || !manifest) {
    return { subcats: [], error: `Data not found for ${gl} in ${week}` };
  }
  const glSubcats = useAllWithFilter ? getSubcatsForGL(gl) : null;
  
  // Define metrics to load and their column configs
  const metricConfigs = {
    'GMS': { valueCol: 2, wowCol: 3, yoyCol: 4, ctcCol: 8, format: 'currency', ctcField: 'yoy_ctc_bps' },
    'ShippedUnits': { valueCol: 2, wowCol: 3, yoyCol: 4, ctcCol: 8, format: 'number', ctcField: 'yoy_ctc_bps' },
    'ASP': { valueCol: 2, wowCol: 5, yoyCol: 6, ctcCol: 10, format: 'currency', ctcField: 'yoy_ctc' },
    'NetPPMLessSD': { valueCol: 2, wowCol: 5, yoyCol: 6, ctcCol: 10, format: 'percent', isBps: true, ctcField: 'yoy_ctc_bps' },
    'CM': { valueCol: 2, wowCol: 5, yoyCol: 6, ctcCol: 10, format: 'percent', isBps: true, ctcField: 'yoy_ctc_bps' },
    'SOROOS_PROCURABLE_PRODUCT_OOS_GV_PCT': { valueCol: 2, wowCol: 5, yoyCol: 6, ctcCol: 10, format: 'percent', isBps: true, ctcField: 'yoy_ctc_bps' },
  };
  
  // Build subcat lookup: code -> { name, metrics: {} }
  const subcatMap = {};
  
  const parseErrors = [];
  
  for (const [metric, config] of Object.entries(metricConfigs)) {
    const filename = manifest.files?.subcat?.[metric];
    if (!filename) continue;
    
    const filepath = path.join(dataDir, filename);
    const { workbook, error: readError } = safeReadExcel(filepath);
    if (readError) {
      parseErrors.push(`${metric}: ${readError}`);
      continue;
    }
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null });

    const layoutError = validateMetricLayout(rows, metric, 'subcat');
    if (layoutError) {
      parseErrors.push(layoutError);
      continue;
    }

    for (let i = 2; i < rows.length; i++) {
      const row = rows[i];
      if (!row || !row[0]) continue;

      const code = String(row[0]).trim();
      if (code.toLowerCase() === 'total') continue;

      // Apply GL filter
      if (glSubcats && !glSubcats.has(code)) continue;

      const name = row[1] ? String(row[1]).trim() : code;
      
      if (!subcatMap[code]) {
        subcatMap[code] = { code, name, metrics: {} };
      }
      
      // Get WoW/YoY values with safe handling
      let wowPct = safePercent(row[config.wowCol]);
      let yoyPct = safePercent(row[config.yoyCol]);
      
      // For margin metrics, values are in bps - convert to decimal %
      if (config.isBps && wowPct !== null) {
        wowPct = safeDivide(wowPct, 10000); // bps to decimal
      }
      if (config.isBps && yoyPct !== null) {
        yoyPct = safeDivide(yoyPct, 10000);
      }
      
      subcatMap[code].metrics[metric] = {
        value: row[config.valueCol],
        wow_pct: wowPct,
        yoy_pct: yoyPct,
        [config.ctcField || 'yoy_ctc_bps']: row[config.ctcCol],
        format: config.format,
      };
    }
  }
  
  // Convert to array and sort by GMS CTC contribution (biggest impact first)
  const subcats = Object.values(subcatMap);
  subcats.sort((a, b) => {
    const aCtc = Math.abs(a.metrics.GMS?.yoy_ctc_bps || 0);
    const bCtc = Math.abs(b.metrics.GMS?.yoy_ctc_bps || 0);
    return bCtc - aCtc;
  });
  
  return { 
    subcats, 
    week, 
    gl,
    parseErrors: parseErrors.length > 0 ? parseErrors : null,
  };
}

/**
 * Tool: get_subcat_detail
 * Get detail for a specific subcategory by name or code
 */
function getSubcatDetail(week, gl, metric, subcatQuery) {
  const { dataDir, manifest } = resolveGLDataFolder(week, gl);
  if (!dataDir || !manifest) {
    return { subcat: null, error: `Data not found for ${gl} in ${week}` };
  }

  const filename = manifest.files?.subcat?.[metric];

  if (!filename) {
    return { subcat: null, error: `Metric ${metric} not found` };
  }

  const filepath = path.join(dataDir, filename);
  const { workbook, error: readError } = safeReadExcel(filepath);
  if (readError) {
    return { subcat: null, error: readError };
  }
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null });
  
  const layoutError = validateMetricLayout(rows, metric, 'subcat');
  if (layoutError) {
    return { subcat: null, error: layoutError };
  }

  // Column layout differs by metric type (same as getMetricDrivers)
  const isMargin = isMarginMetric(metric);
  
  const query = String(subcatQuery || '').toLowerCase();
  
  // Search for matching subcat
  for (let i = 2; i < rows.length; i++) {
    const row = rows[i];
    if (!row || !row[0]) continue;
    
    const code = String(row[0]).trim();
    const name = row[1] ? String(row[1]).trim() : '';
    
    // Match by code or partial name match
    if (code.toLowerCase() === query || 
        name.toLowerCase().includes(query) ||
        code === query) {
      
      if (isMargin) {
        // Margin layout: 0:Code, 1:Name, 2:Value%, 3:NR, 4:Revenue$, 5:WoW(bps), 6:YoY(bps),
        //   7:WoW CTC, 8:Mix, 9:Rate, 10:YoY CTC, 11:Mix, 12:Rate
        return {
          subcat: {
            code: code,
            name: name,
            value: row[2],
            nr_or_extra: row[3],
            revenue_or_extra: row[4],
            wow_pct: row[5],
            yoy_pct: row[6],
            wow_ctc_bps: row[7],
            wow_mix_bps: row[8],
            wow_rate_bps: row[9],
            yoy_ctc_bps: row[10],
            yoy_mix_bps: row[11],
            yoy_rate_bps: row[12],
          },
          metric: metric,
          isMarginMetric: true,
        };
      } else {
        // Standard layout: 0:Code, 1:Name, 2:Value, 3:WoW%, 4:YoY%, 5:WoW CTC($), 6:WoW CTC(bps),
        //   7:YoY CTC($), 8:YoY CTC(bps)
        return {
          subcat: {
            code: code,
            name: name,
            value: row[2],
            wow_pct: row[3],
            yoy_pct: row[4],
            wow_ctc: row[5],
            wow_ctc_bps: row[6],
            yoy_ctc: row[7],
            yoy_ctc_bps: row[8],
          },
          metric: metric,
          isMarginMetric: false,
        };
      }
    }
  }
  
  return { subcat: null, error: `Subcategory "${subcatQuery}" not found` };
}

/**
 * Tool: search_subcats
 * Search for subcategories matching a query across key metrics
 * Returns properly parsed data for each metric
 */
function searchSubcats(week, gl, query) {
  const { dataDir, manifest, useAllWithFilter } = resolveGLDataFolder(week, gl);
  if (!dataDir || !manifest) {
    return { results: [], error: `Data not found for ${gl} in ${week}` };
  }
  const glSubcats = useAllWithFilter ? getSubcatsForGL(gl) : null;
  const q = String(query || '').toLowerCase();
  
  // Define column mappings for different metric types
  // Standard: Code, Name, Value, WoW%, YoY%, WoW CTC, WoW bps, YoY CTC, YoY bps
  // Margin: Code, Name, Value%, NR, Rev$, WoW(bps), YoY(bps), WoW CTC, Mix, Rate, YoY CTC, Mix, Rate
  const metricConfigs = {
    'GMS': { valueCol: 2, wowCol: 3, yoyCol: 4, ctcCol: 8, isPercent: false, ctcField: 'yoy_ctc_bps' },
    'ShippedUnits': { valueCol: 2, wowCol: 3, yoyCol: 4, ctcCol: 8, isPercent: false, ctcField: 'yoy_ctc_bps' },
    'ASP': { valueCol: 2, wowCol: 5, yoyCol: 6, ctcCol: 10, isPercent: false, ctcField: 'yoy_ctc' },
    'NetPPMLessSD': { valueCol: 2, wowCol: 5, yoyCol: 6, ctcCol: 10, isPercent: true, isBps: true, ctcField: 'yoy_ctc_bps' },
    'CM': { valueCol: 2, wowCol: 5, yoyCol: 6, ctcCol: 10, isPercent: true, isBps: true, ctcField: 'yoy_ctc_bps' },
    'SOROOS_PROCURABLE_PRODUCT_OOS_GV_PCT': { valueCol: 2, wowCol: 5, yoyCol: 6, ctcCol: 10, isPercent: true, isBps: true, ctcField: 'yoy_ctc_bps' },
  };
  
  const results = [];
  
  for (const [metric, config] of Object.entries(metricConfigs)) {
    const filename = manifest.files?.subcat?.[metric];
    if (!filename) continue;
    
    const filepath = path.join(dataDir, filename);
    const { workbook, error: readError } = safeReadExcel(filepath);
    if (readError) continue;

    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null });

    const layoutError = validateMetricLayout(rows, metric, 'subcat');
    if (layoutError) continue;

    for (let i = 2; i < rows.length; i++) {
      const row = rows[i];
      if (!row || !row[0]) continue;

      const code = String(row[0]).trim();
      if (glSubcats && !glSubcats.has(code)) continue;

      const name = row[1] ? String(row[1]).trim() : '';

      if (name.toLowerCase().includes(q) || code.toLowerCase().includes(q)) {
        let existing = results.find(r => r.code === code);
        if (!existing) {
          existing = { code, name, metrics: {} };
          results.push(existing);
        }
        
        // For margin metrics, WoW/YoY are in bps — convert to decimal for consistency
        // (same as getAllSubcatData: divide by 10000 to get decimal, e.g., -446 bps → -0.0446)
        let wowPct = row[config.wowCol];
        let yoyPct = row[config.yoyCol];
        if (config.isBps) {
          wowPct = safeDivide(wowPct, 10000);
          yoyPct = safeDivide(yoyPct, 10000);
        }
        
        existing.metrics[metric] = {
          value: row[config.valueCol],
          wow_pct: wowPct,
          yoy_pct: yoyPct,
          [config.ctcField || 'yoy_ctc_bps']: row[config.ctcCol],
          isPercent: config.isPercent,
        };
      }
    }
  }
  
  return { results, query };
}

/**
 * Tool: get_asin_detail
 * Get ASIN-level detail, optionally filtered by subcat
 */
function getAsinDetail(week, gl, metric, options = {}) {
  // Null guard
  if (!week || !gl || !metric) {
    return { asins: null, error: 'Missing required parameters: week, gl, metric' };
  }
  
  const {
    subcat_code = null,  // Filter to specific subcat
    period = 'yoy',
    limit = 10,
  } = options;
  
  // Prefer ALL data; fall back to per-GL folder
  const { dataDir, manifest } = resolveGLDataFolder(week, gl);
  if (!dataDir || !manifest) {
    return { asins: null, error: `Data not found for ${gl} in ${week}` };
  }

  const filename = manifest.files?.asin?.[metric];

  if (!filename) {
    return { asins: null, error: `ASIN data for ${metric} not found` };
  }

  const filepath = path.join(dataDir, filename);
  const { workbook, error: readError } = safeReadExcel(filepath);
  if (readError) {
    return { asins: null, error: readError };
  }
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null });
  
  // Validate file layout matches expectations
  const layoutCheck = detectFileLayout(rows);
  if (!layoutCheck.valid) {
    return { asins: null, error: `${metric} ASIN file has unexpected format: ${layoutCheck.warning}. Cannot safely read columns.` };
  }
  
  // Cross-check: detected layout should match metric type
  const expectedLayout = getExpectedLayout(metric);
  if (layoutCheck.layout !== expectedLayout) {
    return { asins: null, error: `${metric} ASIN file layout mismatch: expected ${expectedLayout} (${expectedLayout === 'standard' ? 9 : 13} cols) but detected ${layoutCheck.layout} (${layoutCheck.layout === 'standard' ? 9 : 13} cols). Data may be corrupt.` };
  }
  
  const isMargin = layoutCheck.layout === 'margin';
  const asins = [];
  // Always use bps CTC columns for consistent units across all metrics
  // Standard: col 6 = WoW CTC(bps), col 8 = YoY CTC(bps)
  // Margin:   col 7 = WoW CTC(bps), col 10 = YoY CTC(bps)
  let ctcColIndex;
  if (isMargin) {
    ctcColIndex = period === 'yoy' ? 10 : 7;
  } else {
    ctcColIndex = period === 'yoy' ? 8 : 6;
  }
  
  for (let i = 2; i < rows.length; i++) {
    const row = rows[i];
    if (!row || !row[0]) continue;
    
    const asin = String(row[0]).trim();
    if (asin.toLowerCase() === 'total') continue;
    
    const itemName = row[1] ? String(row[1]).trim() : '';
    const value = row[2];
    const ctc = row[ctcColIndex];
    
    if (ctc === null || ctc === undefined) continue;
    
    // Get YoY delta (the ASIN's own rate change, distinct from CTC)
    // Standard: col 4 = YoY%
    // Margin: col 6 = YoY (bps)
    const yoyDeltaCol = isMargin ? 6 : 4;
    const yoyDelta = row[yoyDeltaCol] !== null && row[yoyDeltaCol] !== undefined
      ? row[yoyDeltaCol] : null;
    
    asins.push({
      asin,
      item_name: itemName.substring(0, 100), // Truncate long names
      value,
      yoy_delta: yoyDelta,
      ctc,
    });
  }
  
  // Filter by subcat if requested
  let filtered = asins;
  let mappingCoverage = null;
  if (subcat_code) {
    const mapping = loadAsinMapping();
    filtered = asins.filter(a => {
      const shortCode = mapping.get(a.asin);
      return shortCode && String(subcat_code).endsWith(shortCode);
    });
    mappingCoverage = {
      total_asins: asins.length,
      matched: filtered.length,
      note: filtered.length === 0
        ? 'No ASINs matched this subcat in the mapping file'
        : `${filtered.length} of ${asins.length} ASINs mapped to this subcat`,
    };
  }

  // Sort by absolute CTC
  filtered.sort((a, b) => Math.abs(b.ctc) - Math.abs(a.ctc));

  return {
    metric,
    period,
    subcat_filter: subcat_code,
    mapping_coverage: mappingCoverage,
    asins: filtered.slice(0, limit),
  };
}

/**
 * Tool: get_traffic_channels
 * Get traffic breakdown by channel
 */
function getTrafficChannels(week, gl, options = {}) {
  const { limit = 10 } = options;

  const { dataDir } = resolveGLDataFolder(week, gl);
  if (!dataDir) {
    return { channels: null, error: `Data not found for week ${week}` };
  }
  const glDir = dataDir;

  // Find GVs file
  const files = fs.readdirSync(glDir).filter(f => f.startsWith('GVs_'));
  if (files.length === 0) {
    return { channels: null, error: 'Traffic data not found' };
  }

  const filepath = path.join(glDir, files[0]);

  // Parse CSV using XLSX parser to correctly handle quoted commas
  const workbook = XLSX.read(fs.readFileSync(filepath, 'utf-8'), { type: 'string' });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: null });

  // Group by channel, keep latest week
  const byChannel = {};

  for (const row of rows) {
    const channel = String(row.Channel || '').trim();
    if (!channel) continue;

    const weekEnd = row['Week End Date'];
    const gvRaw = row[' GV '] ?? row.GV ?? row.gv;
    const yoyRaw = row.YoY ?? row.yoy;

    const gv = typeof gvRaw === 'number'
      ? gvRaw
      : parseInt(String(gvRaw || '').replace(/[",\s]/g, ''), 10) || 0;
    const yoy = typeof yoyRaw === 'number' ? yoyRaw : parseFloat(String(yoyRaw || '')) || 0;

    // Keep only latest week per channel
    if (!byChannel[channel] || byChannel[channel].weekEnd < weekEnd) {
      byChannel[channel] = { channel, weekEnd, gv, yoy };
    }
  }
  
  // Convert to array and sort by GV
  const channels = Object.values(byChannel)
    .sort((a, b) => b.gv - a.gv)
    .slice(0, limit);
  
  return { channels };
}

/**
 * Tool: compare_metrics
 * Compare two metrics to identify relationships
 */
function compareMetrics(week, gl, metric1, metric2) {
  const result1 = getMetricDrivers(week, gl, metric1, { limit: 10 });
  const result2 = getMetricDrivers(week, gl, metric2, { limit: 10 });
  
  if (result1.error || result2.error) {
    return { error: result1.error || result2.error };
  }
  
  // Find common subcats in both top drivers
  const subcats1 = new Set(result1.drivers.map(d => d.subcat_code));
  const subcats2 = new Set(result2.drivers.map(d => d.subcat_code));
  
  const common = [...subcats1].filter(s => subcats2.has(s));
  
  // Build comparison
  const comparison = common.map(code => {
    const d1 = result1.drivers.find(d => d.subcat_code === code);
    const d2 = result2.drivers.find(d => d.subcat_code === code);
    return {
      subcat_code: code,
      subcat_name: d1?.subcat_name || d2?.subcat_name,
      [metric1]: { ctc: d1?.ctc },
      [metric2]: { ctc: d2?.ctc },
    };
  });
  
  return {
    metric1: { name: metric1, total: result1.total },
    metric2: { name: metric2, total: result2.total },
    common_drivers: comparison,
  };
}

/**
 * Tool: get_data_availability
 * Check what data is available for a GL/week
 * Returns clear status for each data type
 */
function getDataAvailability(week, gl) {
  const { dataDir, manifest } = resolveGLDataFolder(week, gl);

  if (!dataDir || !manifest) {
    return {
      available: false,
      error: `Data not found for ${gl} in week ${week}`,
      summary: null,
    };
  }
  const glDir = dataDir;

  // Check each data type
  const availability = {
    summary: fs.existsSync(path.join(glDir, '_summary.md')),
    subcat: {},
    asin: {},
    traffic: false,
  };

  // Check subcat-level files
  const subcatFiles = manifest.files?.subcat || {};
  for (const [metric, filename] of Object.entries(subcatFiles)) {
    availability.subcat[metric] = !!(filename && fs.existsSync(path.join(glDir, String(filename))));
  }
  
  // Check ASIN-level files — check ALL metrics in the manifest, not a hardcoded list
  const asinFiles = manifest.files?.asin || {};
  for (const [metric, filename] of Object.entries(asinFiles)) {
    availability.asin[metric] = !!(filename && fs.existsSync(path.join(glDir, String(filename))));
  }
  
  // Check traffic data
  const gvFiles = fs.readdirSync(glDir).filter(f => f.startsWith('GVs_') || f.includes('traffic'));
  availability.traffic = gvFiles.length > 0;
  
  // Check data freshness
  const freshness = getDataFreshness(week);
  
  // Generate human-readable summary
  const lines = [];
  lines.push(`## Data Availability for ${gl.toUpperCase()} (${week})`);
  
  // Add freshness warning at the top if applicable
  if (freshness.warning) {
    lines.push('');
    lines.push(freshness.warning);
  }
  lines.push('');
  lines.push('**Subcategory Level:**');
  for (const [metric, avail] of Object.entries(availability.subcat)) {
    lines.push(`- ${metric}: ${avail ? '✓' : '✗ NOT AVAILABLE'}`);
  }
  lines.push('');
  lines.push('**ASIN Level:**');
  for (const [metric, avail] of Object.entries(availability.asin)) {
    lines.push(`- ${metric}: ${avail ? '✓' : '✗ NOT AVAILABLE'}`);
  }
  lines.push('');
  lines.push(`**Traffic (GVs):** ${availability.traffic ? '✓' : '✗ NOT AVAILABLE'}`);
  
  // Add limitations note if anything is missing
  const missingSubcat = Object.entries(availability.subcat).filter(([_, v]) => !v).map(([k]) => k);
  const missingAsin = Object.entries(availability.asin).filter(([_, v]) => !v).map(([k]) => k);
  
  if (missingSubcat.length > 0 || missingAsin.length > 0 || !availability.traffic) {
    lines.push('');
    lines.push('**⚠️ Limitations:**');
    if (missingSubcat.length > 0) {
      lines.push(`- Cannot analyze: ${missingSubcat.join(', ')} at subcat level`);
    }
    if (missingAsin.length > 0) {
      lines.push(`- Cannot drill into ASINs for: ${missingAsin.join(', ')}`);
    }
    if (!availability.traffic) {
      lines.push('- Cannot analyze traffic/conversion (no GV data)');
    }
  }
  
  return {
    available: true,
    week,
    gl,
    availability,
    freshness,
    summary: lines.join('\n'),
  };
}

/**
 * Tool: get_metric_totals
 * Get GL-level totals for all key metrics (for dashboard metric cards)
 * Returns formatted values, WoW%, YoY% from the Total row in each subcat file
 */
function getMetricTotals(week, gl) {
  if (!week || !gl) {
    return { metrics: [], error: 'Missing required parameters: week, gl' };
  }

  // Resolve data folder: prefer ALL with GL filtering, fall back to per-GL
  const { dataDir, manifest, useAllWithFilter } = resolveGLDataFolder(week, gl);
  if (!manifest) {
    return { metrics: [], error: `Data not found for ${gl} in ${week}` };
  }

  const glSubcats = useAllWithFilter ? getSubcatsForGL(gl) : null;
  const isGLFiltered = glSubcats !== null;

  // Column mappings per metric type (from Excel structure)
  // Standard (GMS, Units): col2=value, col3=WoW%, col4=YoY%, col5=WoW CTC($), col7=YoY CTC($)
  // Margin (ASP, NetPPM, CM): col2=value%, col3=numerator$, col4=denominator$, col5=WoW(bps), col6=YoY(bps)
  const metricDefs = [
    {
      key: 'GMS', label: 'GMS', file: manifest.files?.subcat?.GMS,
      valueCol: 2, wowCol: 3, yoyCol: 4, wowCtcDollarCol: 5, yoyCtcDollarCol: 7,
      format: 'currency', wowMultiplier: 100, yoyMultiplier: 100,
    },
    {
      key: 'ShippedUnits', label: 'Units', file: manifest.files?.subcat?.ShippedUnits,
      valueCol: 2, wowCol: 3, yoyCol: 4, wowCtcDollarCol: 5, yoyCtcDollarCol: 7,
      format: 'number', wowMultiplier: 100, yoyMultiplier: 100,
    },
    {
      key: 'ASP', label: 'ASP', file: manifest.files?.subcat?.ASP,
      valueCol: 2, numCol: 3, denCol: 4, wowCol: 5, yoyCol: 6,
      format: 'currency_small', wowMultiplier: 100, yoyMultiplier: 100,
      denMetric: 'ShippedUnits', // denominator metric for prior-period estimation
    },
    {
      key: 'NetPPMLessSD', label: 'Net PPM', file: manifest.files?.subcat?.NetPPMLessSD,
      valueCol: 2, numCol: 3, denCol: 4, wowCol: 5, yoyCol: 6,
      format: 'percent', wowMultiplier: 1, yoyMultiplier: 1,
      denMetric: 'GMS', // denominator metric for prior-period estimation
    },
    {
      key: 'CM', label: 'CM', file: manifest.files?.subcat?.CM,
      valueCol: 2, numCol: 3, denCol: 4, wowCol: 5, yoyCol: 6,
      format: 'percent', wowMultiplier: 1, yoyMultiplier: 1,
      denMetric: 'GMS', // denominator metric for prior-period estimation
    },
  ];

  const emptyMetric = (def) => ({
    name: def.key.toLowerCase(), label: def.label,
    value: '—', wow: 0, yoy: 0, sparkline: [0],
  });

  const metrics = [];

  for (const def of metricDefs) {
    if (!def.file) { metrics.push(emptyMetric(def)); continue; }

    const filepath = path.join(dataDir, def.file);
    const { workbook, error: readError } = safeReadExcel(filepath);
    if (readError) { metrics.push(emptyMetric(def)); continue; }

    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null });

    const layoutError = validateMetricLayout(rows, def.key, 'subcat');
    if (layoutError) { metrics.push({ ...emptyMetric(def), error: layoutError }); continue; }

    let rawValue, rawWow, rawYoy;
    const margin = isMarginMetric(def.key);

    if (!isGLFiltered) {
      // ALL: use Total row directly
      let totalRow = null;
      for (let i = 0; i < rows.length; i++) {
        if (rows[i] && String(rows[i][0]).toLowerCase() === 'total') { totalRow = rows[i]; break; }
      }
      if (!totalRow) { metrics.push(emptyMetric(def)); continue; }
      rawValue = totalRow[def.valueCol];
      rawWow = totalRow[def.wowCol];
      rawYoy = totalRow[def.yoyCol];
    } else {
      // GL-specific: compute from filtered subcats using primer formulas
      if (margin) {
        // Margin metric: total = sum(numerator$) / sum(denominator$)
        // WoW/YoY: use cross-metric denominator approach to estimate prior-period ratio
        // (revenue-weighted averaging of subcat bps misses the mix effect)

        // Load denominator metric's WoW%/YoY% per subcat for prior-period estimation
        const denPctMap = loadDenominatorPctMap(dataDir, manifest, def.denMetric);
        // Per-unit metrics (ASP) have WoW/YoY as fractional change (0.03 = 3%)
        // Percent metrics (NPPM, CM) have WoW/YoY in bps (270 = 2.70pp)
        const isBpsMetric = def.format === 'percent';

        let sumP2Num = 0, sumP2Den = 0;
        let sumP1NumWow = 0, sumP1DenWow = 0;
        let sumP1NumYoy = 0, sumP1DenYoy = 0;

        for (let i = 2; i < rows.length; i++) {
          const row = rows[i];
          if (!row || !row[0]) continue;
          const code = String(row[0]).trim();
          if (code.toLowerCase() === 'total' || !glSubcats.has(code)) continue;
          const num = row[def.numCol] || 0;
          const den = row[def.denCol] || 0;
          const rate = den !== 0 ? num / den : 0;
          const wowChange = row[def.wowCol] || 0;
          const yoyChange = row[def.yoyCol] || 0;
          sumP2Num += num;
          sumP2Den += den;

          // Compute prior-period rate from subcat WoW/YoY
          let p1RateWow, p1RateYoy;
          if (isBpsMetric) {
            // bps: P1_rate = P2_rate - change/10000
            p1RateWow = rate - wowChange / 10000;
            p1RateYoy = rate - yoyChange / 10000;
          } else {
            // fractional: P1_rate = P2_rate / (1 + change)
            p1RateWow = (wowChange > -1) ? rate / (1 + wowChange) : rate;
            p1RateYoy = (yoyChange > -1) ? rate / (1 + yoyChange) : rate;
          }

          // Compute prior-period denominator from cross-metric growth rate
          const denPct = denPctMap.get(code);
          const wowDenPct = denPct ? (denPct.wowPct || 0) : 0;
          const yoyDenPct = denPct ? (denPct.yoyPct || 0) : 0;
          const p1DenWow = (wowDenPct > -1) ? den / (1 + wowDenPct) : den;
          const p1DenYoy = (yoyDenPct > -1) ? den / (1 + yoyDenPct) : den;

          sumP1NumWow += p1RateWow * p1DenWow;
          sumP1DenWow += p1DenWow;
          sumP1NumYoy += p1RateYoy * p1DenYoy;
          sumP1DenYoy += p1DenYoy;
        }

        rawValue = sumP2Den !== 0 ? sumP2Num / sumP2Den : null;
        const p2Rate = rawValue || 0;
        const p1RateWow = sumP1DenWow !== 0 ? sumP1NumWow / sumP1DenWow : p2Rate;
        const p1RateYoy = sumP1DenYoy !== 0 ? sumP1NumYoy / sumP1DenYoy : p2Rate;
        if (isBpsMetric) {
          rawWow = (p2Rate - p1RateWow) * 10000;
          rawYoy = (p2Rate - p1RateYoy) * 10000;
        } else {
          rawWow = p1RateWow !== 0 ? (p2Rate / p1RateWow - 1) : 0;
          rawYoy = p1RateYoy !== 0 ? (p2Rate / p1RateYoy - 1) : 0;
        }
      } else {
        // Absolute metric: total = sum(values), WoW/YoY from CTC$ columns
        // WoW% = sum(CTC$) / (sum(value) - sum(CTC$))   [per primer sheet 3]
        let sumValue = 0, sumWowCtc = 0, sumYoyCtc = 0;
        for (let i = 2; i < rows.length; i++) {
          const row = rows[i];
          if (!row || !row[0]) continue;
          const code = String(row[0]).trim();
          if (code.toLowerCase() === 'total' || !glSubcats.has(code)) continue;
          sumValue += (row[def.valueCol] || 0);
          sumWowCtc += (row[def.wowCtcDollarCol] || 0);
          sumYoyCtc += (row[def.yoyCtcDollarCol] || 0);
        }
        rawValue = sumValue;
        const priorWow = sumValue - sumWowCtc;
        const priorYoy = sumValue - sumYoyCtc;
        rawWow = priorWow !== 0 ? sumWowCtc / priorWow : 0;
        rawYoy = priorYoy !== 0 ? sumYoyCtc / priorYoy : 0;
      }
    }

    // Format the display value
    let displayValue = '—';
    const hasNumericValue = rawValue !== null && rawValue !== undefined && isFinite(rawValue);

    if (hasNumericValue && def.format === 'currency') {
      if (rawValue >= 1000000) {
        displayValue = `$${(rawValue / 1000000).toFixed(2)}M`;
      } else if (rawValue >= 1000) {
        displayValue = `$${(rawValue / 1000).toFixed(1)}K`;
      } else {
        displayValue = `$${Math.round(rawValue).toLocaleString()}`;
      }
    } else if (hasNumericValue && def.format === 'currency_small') {
      displayValue = `$${rawValue.toFixed(2)}`;
    } else if (hasNumericValue && def.format === 'number') {
      if (rawValue >= 1000000) {
        displayValue = `${(rawValue / 1000000).toFixed(2)}M`;
      } else if (rawValue >= 1000) {
        displayValue = `${(rawValue / 1000).toFixed(1)}K`;
      } else {
        displayValue = rawValue.toLocaleString();
      }
    } else if (hasNumericValue && def.format === 'percent') {
      displayValue = `${(rawValue * 100).toFixed(1)}%`;
    }

    // Format WoW/YoY
    let wow, yoy;
    if (def.format === 'percent') {
      wow = rawWow !== null && rawWow !== undefined && isFinite(rawWow) ? Math.round(rawWow) : 0;
      yoy = rawYoy !== null && rawYoy !== undefined && isFinite(rawYoy) ? Math.round(rawYoy) : 0;
    } else {
      wow = rawWow !== null && rawWow !== undefined && isFinite(rawWow)
        ? parseFloat((rawWow * def.wowMultiplier).toFixed(1)) : 0;
      yoy = rawYoy !== null && rawYoy !== undefined && isFinite(rawYoy)
        ? parseFloat((rawYoy * def.yoyMultiplier).toFixed(1)) : 0;
    }

    metrics.push({
      name: def.key.toLowerCase(),
      label: def.label,
      value: displayValue,
      wow,
      yoy,
      wowUnit: def.format === 'percent' ? 'bps' : '%',
      yoyUnit: def.format === 'percent' ? 'bps' : '%',
      sparkline: [rawValue],
    });
  }

  return { metrics, week, gl };
}

// Export tools
module.exports = {
  listWeeks,
  listGLs,
  getSummary,
  getManifest,
  getAllSubcatData,
  getMetricDrivers,
  getMetricTotals,
  getSubcatDetail,
  searchSubcats,
  getAsinDetail,
  getTrafficChannels,
  compareMetrics,
  getDataAvailability,
  getDataFreshness,
  // GL mapping
  loadGLMapping,
  getSubcatsForGL,
  getGLNamesFromMapping,
  // Safety helpers (exported for testing)
  safeReadExcel,
  safeDivide,
  detectFileLayout,
  loadAsinMapping,
};

// CLI interface for testing
if (require.main === module) {
  const args = process.argv.slice(2);
  const cmd = args[0];
  
  const commands = {
    'list-weeks': () => console.log(JSON.stringify(listWeeks(), null, 2)),
    'list-gls': () => console.log(JSON.stringify(listGLs(args[1]), null, 2)),
    'get-summary': () => console.log(getSummary(args[1], args[2]).summary),
    'get-drivers': () => console.log(JSON.stringify(
      getMetricDrivers(args[1], args[2], args[3], { period: args[4] || 'yoy', limit: 5 }), null, 2
    )),
    'get-asins': () => console.log(JSON.stringify(
      getAsinDetail(args[1], args[2], args[3], { limit: 10 }), null, 2
    )),
    'get-traffic': () => console.log(JSON.stringify(
      getTrafficChannels(args[1], args[2]), null, 2
    )),
  };
  
  if (commands[cmd]) {
    commands[cmd]();
  } else {
    console.log('Usage:');
    console.log('  node tools.js list-weeks');
    console.log('  node tools.js list-gls <week>');
    console.log('  node tools.js get-summary <week> <gl>');
    console.log('  node tools.js get-drivers <week> <gl> <metric> [period]');
    console.log('  node tools.js get-asins <week> <gl> <metric>');
    console.log('  node tools.js get-traffic <week> <gl>');
  }
}
