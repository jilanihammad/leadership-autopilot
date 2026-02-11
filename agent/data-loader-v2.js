/**
 * Data Loader v2 — Consolidated file reader with GL-level CTC computation
 * 
 * Reads consolidated ALL files, filters by GL using mapping, and computes
 * GL-level CTCs using the CTC engine formulas.
 * 
 * Key differences from v1 (tools.js):
 * - Reads from ALL/ folder instead of per-GL folders
 * - Computes CTCs at GL level (not pre-computed)
 * - Uses mapping file for GL assignment
 * - Supports portfolio view (ALL level) with pre-computed CTCs
 * - New header format (wk06+): single header row, not merged
 */

const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');
const { loadMapping, resolveGL, assignRowsToGLs } = require('./mapping');
const { getMetricType, computeNonRatioCTC, computePercentageCTC, computePerUnitCTC } = require('./ctc-engine');

const DATA_DIR = path.join(__dirname, '..', 'data');

// ============================================================================
// FILE READING
// ============================================================================

/**
 * Detect file column layout from header row.
 * wk06+ format: headers in row 0, data from row 1.
 * wk05 format: merge row 0, headers row 1, data from row 2.
 * 
 * Returns { layout: 'standard'|'margin', dataStartRow, colMap }
 */
function detectLayout(rows) {
  // Check if row 0 is a proper header (contains descriptive names)
  const row0 = rows[0] || [];
  const row0Str = row0.map(v => String(v || '')).join(' ').toLowerCase();
  
  // wk06+ format: row 0 has full column names like "Product Subcategory Code"
  const isWk06Format = row0Str.includes('product subcategory') || row0Str.includes('asin');
  
  if (isWk06Format) {
    const colCount = row0.filter(v => v !== null && v !== undefined && String(v).trim() !== '').length;
    // Standard: 9 meaningful columns, Margin: 13
    if (colCount >= 12) {
      return { layout: 'margin', dataStartRow: 1, headerRow: 0, colCount };
    } else {
      return { layout: 'standard', dataStartRow: 1, headerRow: 0, colCount };
    }
  }
  
  // wk05 format: check row 1 for column count
  const row1 = rows[1] || [];
  const colCount = row1.length;
  const hasWowVariance = row0.some(v => v && /wow\s+variance/i.test(String(v)));
  
  if (hasWowVariance) {
    if (colCount === 13) return { layout: 'margin', dataStartRow: 2, headerRow: 1, colCount };
    if (colCount === 9) return { layout: 'standard', dataStartRow: 2, headerRow: 1, colCount };
  }
  
  // Fallback: guess from column count
  if (colCount >= 12) return { layout: 'margin', dataStartRow: 2, headerRow: 1, colCount };
  return { layout: 'standard', dataStartRow: 2, headerRow: 1, colCount };
}

/**
 * Parse a standard (9-col) file: Code, Name, Value, WoW%, YoY%, WoW CTC($), WoW CTC(bps), YoY CTC($), YoY CTC(bps)
 */
function parseStandardFile(rows, layout) {
  const startRow = layout.dataStartRow;
  const segments = [];
  let total = null;

  for (let i = startRow; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row[0] === null || row[0] === undefined) continue;
    
    const code = String(row[0]).trim();
    const name = row[1] ? String(row[1]).trim() : '';
    
    const entry = {
      code,
      name,
      value: row[2],
      wowPct: row[3],
      yoyPct: row[4],
      wowCtcDollars: row[5],
      wowCtcBps: row[6],
      yoyCtcDollars: row[7],
      yoyCtcBps: row[8],
    };

    if (code.toLowerCase() === 'total') {
      total = entry;
    } else {
      segments.push(entry);
    }
  }

  return { segments, total };
}

/**
 * Parse a margin (13-col) file: Code, Name, Value%, NR, Revenue$, WoW, YoY, WoW CTC, Mix, Rate, YoY CTC, Mix, Rate
 */
function parseMarginFile(rows, layout) {
  const startRow = layout.dataStartRow;
  const segments = [];
  let total = null;

  for (let i = startRow; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row[0] === null || row[0] === undefined) continue;
    
    const code = String(row[0]).trim();
    const name = row[1] ? String(row[1]).trim() : '';
    
    const entry = {
      code,
      name,
      value: row[2],      // rate as decimal (e.g., 0.30 for 30%)
      nr: row[3],          // numerator (e.g., Net PPM $)
      revenue: row[4],     // revenue / denominator
      wowBps: row[5],      // WoW change in bps
      yoyBps: row[6],      // YoY change in bps
      wowCtcBps: row[7],
      wowMixBps: row[8],
      wowRateBps: row[9],
      yoyCtcBps: row[10],
      yoyMixBps: row[11],
      yoyRateBps: row[12],
    };

    if (code.toLowerCase() === 'total') {
      total = entry;
    } else {
      segments.push(entry);
    }
  }

  return { segments, total };
}

/**
 * Read and parse an Excel file.
 */
function readExcelFile(filepath) {
  if (!fs.existsSync(filepath)) {
    return { error: `File not found: ${path.basename(filepath)}` };
  }
  
  try {
    const wb = XLSX.readFile(filepath);
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null });
    
    const layout = detectLayout(rows);
    
    if (layout.layout === 'margin') {
      return { ...parseMarginFile(rows, layout), layout, rows };
    } else {
      return { ...parseStandardFile(rows, layout), layout, rows };
    }
  } catch (err) {
    return { error: `Failed to parse ${path.basename(filepath)}: ${err.message}` };
  }
}

// ============================================================================
// CONSOLIDATED DATA ACCESS
// ============================================================================

let _mappingCache = null;
let _mappingPath = null;

function getMapping() {
  const mappingFile = path.join(DATA_DIR, 'GL to Subcat mapping.xlsx');
  if (_mappingCache && _mappingPath === mappingFile) return _mappingCache;
  _mappingCache = loadMapping(mappingFile);
  _mappingPath = mappingFile;
  return _mappingCache;
}

/**
 * Find the ALL folder for a given week.
 */
function getAllFolder(week) {
  const weekDir = path.join(DATA_DIR, 'weekly', week);
  if (!fs.existsSync(weekDir)) return null;
  const dirs = fs.readdirSync(weekDir);
  const allDir = dirs.find(d => d.toUpperCase() === 'ALL');
  return allDir ? path.join(weekDir, allDir) : null;
}

/**
 * Find the data folder for a given week + GL.
 * Priority: ALL/ (consolidated), then gl/<name>/ (legacy per-GL).
 */
function getDataFolder(week, gl) {
  const allFolder = getAllFolder(week);
  if (allFolder) return { folder: allFolder, mode: 'consolidated' };
  
  // Legacy per-GL fallback
  const weekDir = path.join(DATA_DIR, 'weekly', week);
  if (!fs.existsSync(weekDir)) return null;
  
  // Try gl/<name>/ (case-insensitive)
  const glDir = path.join(weekDir, 'gl');
  if (!fs.existsSync(glDir)) return null;
  
  const dirs = fs.readdirSync(glDir);
  const match = dirs.find(d => d.toLowerCase() === gl.toLowerCase());
  if (match) return { folder: path.join(glDir, match), mode: 'legacy' };
  
  return null;
}

/**
 * Find the metric file in a folder by metric name and level (SUBCAT/ASIN).
 */
function findMetricFile(folder, metric, level) {
  if (!fs.existsSync(folder)) return null;
  const files = fs.readdirSync(folder);
  const pattern = new RegExp(`^${metric.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}.*ctc_by_${level}`, 'i');
  const match = files.find(f => pattern.test(f));
  return match ? path.join(folder, match) : null;
}

/**
 * List available weeks.
 */
function listWeeks() {
  const weeklyDir = path.join(DATA_DIR, 'weekly');
  if (!fs.existsSync(weeklyDir)) return { weeks: [] };
  
  const parseWeek = (w) => {
    const m = w.match(/^(\d{4})-wk(\d+)$/);
    return m ? { year: parseInt(m[1]), week: parseInt(m[2]) } : { year: 0, week: 0 };
  };
  
  const weeks = fs.readdirSync(weeklyDir)
    .filter(d => d.match(/^\d{4}-wk\d+$/))
    .sort((a, b) => {
      const wa = parseWeek(a), wb = parseWeek(b);
      return wa.year !== wb.year ? wb.year - wa.year : wb.week - wa.week;
    });
  
  return { weeks };
}

/**
 * List available GLs for a week (derived from mapping + available data).
 */
function listGLs(week) {
  const knownMetrics = ['GMS', 'ShippedUnits', 'ASP', 'NetPPMLessSD', 'CM', 'SOROOS_PROCURABLE_PRODUCT_OOS_GV_PCT', 'GV'];
  
  const allFolder = getAllFolder(week);
  if (allFolder) {
    // Consolidated mode: ALL + each GL from mapping
    const mapping = getMapping();
    const metricsAvailable = knownMetrics.filter(m => findMetricFile(allFolder, m, 'SUBCAT'));
    
    return {
      gls: [
        { name: 'ALL', label: 'All Categories', metrics: metricsAvailable },
        ...mapping.glList.map(gl => ({ name: gl, label: gl, metrics: metricsAvailable })),
      ],
    };
  }
  
  // Legacy per-GL fallback
  const weekDir = path.join(DATA_DIR, 'weekly', week);
  const glDir = path.join(weekDir, 'gl');
  if (!fs.existsSync(glDir)) return { gls: [], error: `No data for ${week}` };
  
  const glFolders = fs.readdirSync(glDir).filter(d => {
    return fs.statSync(path.join(glDir, d)).isDirectory();
  });
  
  return {
    gls: glFolders.map(gl => {
      const folder = path.join(glDir, gl);
      const metricsAvailable = knownMetrics.filter(m => findMetricFile(folder, m, 'SUBCAT'));
      return { name: gl.toUpperCase(), label: gl.toUpperCase(), metrics: metricsAvailable };
    }),
  };
}

/**
 * Get metric totals for a GL (or ALL) — for dashboard metric cards.
 * Includes sparkline data from all available weeks.
 */
function getMetricTotals(week, gl) {
  const dataInfo = getDataFolder(week, gl);
  if (!dataInfo) return { metrics: [], error: `No data for ${week}` };
  
  const metricDefs = [
    { key: 'GMS', label: 'GMS', format: 'currency' },
    { key: 'ShippedUnits', label: 'Units', format: 'number' },
    { key: 'ASP', label: 'ASP', format: 'currency_small' },
    { key: 'NetPPMLessSD', label: 'Net PPM', format: 'percent' },
    { key: 'CM', label: 'CM', format: 'percent' },
  ];
  
  const isAll = gl.toUpperCase() === 'ALL';
  const mapping = isAll ? null : getMapping();
  
  // Build sparkline: get total values for each available week
  const { weeks } = listWeeks();
  
  const metrics = [];
  
  for (const def of metricDefs) {
    // Get current week value
    const result = _getMetricTotal(dataInfo.folder, dataInfo.mode, def.key, gl, isAll, mapping, week);
    
    if (!result) {
      metrics.push({ name: def.key.toLowerCase(), label: def.label, value: '—', wow: 0, yoy: 0, sparkline: [0] });
      continue;
    }
    
    const { totalValue, totalWow, totalYoy } = result;
    
    // Build sparkline across available weeks (oldest → newest)
    const sparkline = [];
    for (const w of [...weeks].reverse()) {
      const wInfo = getDataFolder(w, gl);
      if (!wInfo) continue;
      const wResult = _getMetricTotal(wInfo.folder, wInfo.mode, def.key, gl, isAll, mapping, w);
      if (wResult) sparkline.push(wResult.totalValue);
    }
    if (sparkline.length === 0) sparkline.push(totalValue);
    
    // Format display value
    let displayValue = '—';
    const hasVal = totalValue !== null && totalValue !== undefined && isFinite(totalValue);
    if (hasVal) {
      if (def.format === 'currency') {
        displayValue = totalValue >= 1e6 ? `$${(totalValue / 1e6).toFixed(2)}M`
          : totalValue >= 1e3 ? `$${(totalValue / 1e3).toFixed(1)}K`
          : `$${Math.round(totalValue).toLocaleString()}`;
      } else if (def.format === 'currency_small') {
        displayValue = `$${totalValue.toFixed(2)}`;
      } else if (def.format === 'number') {
        displayValue = totalValue >= 1e6 ? `${(totalValue / 1e6).toFixed(2)}M`
          : totalValue >= 1e3 ? `${(totalValue / 1e3).toFixed(1)}K`
          : totalValue.toLocaleString();
      } else if (def.format === 'percent') {
        displayValue = `${(totalValue * 100).toFixed(1)}%`;
      }
    }
    
    // Format WoW/YoY
    let wow, yoy, wowUnit, yoyUnit;
    if (def.format === 'percent') {
      wow = totalWow != null && isFinite(totalWow) ? Math.round(totalWow) : 0;
      yoy = totalYoy != null && isFinite(totalYoy) ? Math.round(totalYoy) : 0;
      wowUnit = 'bps'; yoyUnit = 'bps';
    } else {
      wow = totalWow != null && isFinite(totalWow) ? parseFloat((totalWow * 100).toFixed(1)) : 0;
      yoy = totalYoy != null && isFinite(totalYoy) ? parseFloat((totalYoy * 100).toFixed(1)) : 0;
      wowUnit = '%'; yoyUnit = '%';
    }
    
    metrics.push({
      name: def.key.toLowerCase(),
      label: def.label,
      value: displayValue,
      wow, yoy, wowUnit, yoyUnit,
      sparkline,
    });
  }
  
  return { metrics, week, gl };
}

/**
 * Internal: get total value/wow/yoy for a single metric in a single folder.
 */
function _getMetricTotal(folder, mode, metricKey, gl, isAll, mapping, week) {
  const filepath = findMetricFile(folder, metricKey, 'SUBCAT');
  if (!filepath) return null;
  
  const parsed = readExcelFile(filepath);
  if (parsed.error) return null;
  
  if (isAll || mode === 'legacy') {
    // ALL view or legacy per-GL: use Total row directly
    if (!parsed.total) return null;
    const isMargin = parsed.layout.layout === 'margin';
    return {
      totalValue: parsed.total.value,
      totalWow: isMargin ? parsed.total.wowBps : parsed.total.wowPct,
      totalYoy: isMargin ? parsed.total.yoyBps : parsed.total.yoyPct,
    };
  }
  
  // Consolidated mode: compute GL total
  const metricType = getMetricType(metricKey);
  const glResult = computeGLTotal(parsed, mapping, gl, metricKey, metricType, week);
  if (!glResult) return null;
  return { totalValue: glResult.value, totalWow: glResult.wow, totalYoy: glResult.yoy };
}

/**
 * Compute GL-level total for a metric from consolidated data.
 * 
 * KEY INSIGHT: For ratio metrics (percentage, per-unit), you cannot compute
 * the aggregate P1 value by averaging per-subcat P1 rates with P2 weights.
 * The weights themselves changed YoY. You must:
 * 1. Derive P1 numerator and P1 denominator per subcat
 * 2. Sum them independently
 * 3. Divide to get the true P1 aggregate rate
 * 
 * This requires cross-referencing with GMS and ShippedUnits files.
 */
function computeGLTotal(parsed, mapping, gl, metricKey, metricType, week) {
  // Filter segments to this GL
  const glSegments = [];
  for (const seg of parsed.segments) {
    const resolution = resolveGL(mapping, seg.code, seg.name);
    let proportion = 0;
    if (resolution.gl === gl) {
      proportion = 1.0;
    } else if (resolution.confidence === 'shared' && resolution.sharedGLs && resolution.sharedGLs[gl]) {
      proportion = resolution.sharedGLs[gl];
    }
    if (proportion > 0) {
      glSegments.push({ ...seg, proportion });
    }
  }
  
  if (glSegments.length === 0) return null;
  
  if (metricType === 'non_ratio') {
    // Sum values, compute weighted YoY
    let totalP2 = 0, totalP1 = 0;
    let totalWowP2 = 0, totalWowP1 = 0;
    for (const seg of glSegments) {
      const p2 = (seg.value || 0) * seg.proportion;
      totalP2 += p2;
      if (seg.yoyPct != null && seg.yoyPct !== -1) totalP1 += p2 / (1 + seg.yoyPct);
      if (seg.wowPct != null && seg.wowPct !== -1) {
        totalWowP2 += p2;
        totalWowP1 += p2 / (1 + seg.wowPct);
      }
    }
    const yoyPct = totalP1 > 0 ? (totalP2 - totalP1) / totalP1 : null;
    const wowPct = totalWowP1 > 0 ? (totalWowP2 - totalWowP1) / totalWowP1 : null;
    return { value: totalP2, yoy: yoyPct, wow: wowPct };
  }
  
  if (metricType === 'percentage') {
    // Percentage metrics (Net PPM, CM, SOROOS):
    //   P2 rate = sum(P2 NR) / sum(P2 Revenue)
    //   P1 rate = sum(P1 NR) / sum(P1 Revenue)
    //   P1 Revenue = P2 Revenue / (1 + GMS YoY%)  -- need GMS cross-reference
    //   P1 NR = P1 rate_subcat × P1 Revenue_subcat
    //   P1 rate_subcat = P2 rate - yoyBps/10000
    
    // Load GMS data for revenue YoY derivation
    const gmsLookup = _loadCrossReference(week, 'GMS', gl, mapping);
    
    let sumP2NR = 0, sumP2Rev = 0;
    let sumP1NR = 0, sumP1Rev = 0;
    let sumWowP1NR = 0, sumWowP1Rev = 0;
    
    for (const seg of glSegments) {
      const p = seg.proportion;
      const p2Rev = (seg.revenue || 0) * p;
      const p2NR = (seg.nr || 0) * p;
      
      sumP2Rev += p2Rev;
      sumP2NR += p2NR;
      
      // Derive P1 Revenue using GMS YoY%
      const gmsYoyPct = gmsLookup[seg.code]?.yoyPct;
      if (gmsYoyPct != null && gmsYoyPct !== -1 && p2Rev > 0) {
        const p1Rev = p2Rev / (1 + gmsYoyPct);
        sumP1Rev += p1Rev;
        
        // P1 NR = P1 rate × P1 revenue
        const p1Rate = seg.value != null && seg.yoyBps != null
          ? seg.value - seg.yoyBps / 10000 : null;
        if (p1Rate !== null) {
          sumP1NR += p1Rate * p1Rev;
        }
      }
      
      // WoW: derive previous-week revenue using GMS WoW%
      const gmsWowPct = gmsLookup[seg.code]?.wowPct;
      if (gmsWowPct != null && gmsWowPct !== -1 && p2Rev > 0) {
        const wowP1Rev = p2Rev / (1 + gmsWowPct);
        sumWowP1Rev += wowP1Rev;
        const wowP1Rate = seg.value != null && seg.wowBps != null
          ? seg.value - seg.wowBps / 10000 : null;
        if (wowP1Rate !== null) {
          sumWowP1NR += wowP1Rate * wowP1Rev;
        }
      }
    }
    
    const p2Rate = sumP2Rev > 0 ? sumP2NR / sumP2Rev : null;
    const p1Rate = sumP1Rev > 0 ? sumP1NR / sumP1Rev : null;
    const yoyBps = (p2Rate !== null && p1Rate !== null)
      ? Math.round((p2Rate - p1Rate) * 10000) : null;
    
    const wowP1Rate = sumWowP1Rev > 0 ? sumWowP1NR / sumWowP1Rev : null;
    const wowBps = (p2Rate !== null && wowP1Rate !== null)
      ? Math.round((p2Rate - wowP1Rate) * 10000) : null;
    
    return { value: p2Rate, yoy: yoyBps, wow: wowBps };
  }
  
  if (metricType === 'per_unit') {
    // Per-unit metrics (ASP):
    //   ASP = Revenue / Units
    //   P2 ASP = sum(P2 Revenue) / sum(P2 Units)
    //   P1 ASP = sum(P1 Revenue) / sum(P1 Units)
    //   P1 Revenue = P2 Revenue / (1 + GMS YoY%)
    //   P1 Units = P2 Units / (1 + ShippedUnits YoY%)
    //
    // ASP file: col3 (parsed as 'nr') = Revenue, col4 (parsed as 'revenue') = Units
    
    // Load cross-references for P1 derivation
    const gmsLookup = _loadCrossReference(week, 'GMS', gl, mapping);
    const unitsLookup = _loadCrossReference(week, 'ShippedUnits', gl, mapping);
    
    let sumP2Rev = 0, sumP2Units = 0;
    let sumP1Rev = 0, sumP1Units = 0;
    let sumWowP1Rev = 0, sumWowP1Units = 0;
    
    for (const seg of glSegments) {
      const p = seg.proportion;
      const p2Units = (seg.revenue || 0) * p;  // col4 = units for ASP
      const p2Rev = (seg.nr || 0) * p;          // col3 = revenue for ASP
      
      sumP2Units += p2Units;
      sumP2Rev += p2Rev;
      
      // P1 Revenue from GMS YoY%
      const gmsYoyPct = gmsLookup[seg.code]?.yoyPct;
      if (gmsYoyPct != null && gmsYoyPct !== -1 && p2Rev > 0) {
        sumP1Rev += p2Rev / (1 + gmsYoyPct);
      }
      
      // P1 Units from ShippedUnits YoY%
      const unitsYoyPct = unitsLookup[seg.code]?.yoyPct;
      if (unitsYoyPct != null && unitsYoyPct !== -1 && p2Units > 0) {
        sumP1Units += p2Units / (1 + unitsYoyPct);
      }
      
      // WoW
      const gmsWowPct = gmsLookup[seg.code]?.wowPct;
      if (gmsWowPct != null && gmsWowPct !== -1 && p2Rev > 0) {
        sumWowP1Rev += p2Rev / (1 + gmsWowPct);
      }
      const unitsWowPct = unitsLookup[seg.code]?.wowPct;
      if (unitsWowPct != null && unitsWowPct !== -1 && p2Units > 0) {
        sumWowP1Units += p2Units / (1 + unitsWowPct);
      }
    }
    
    const p2Asp = sumP2Units > 0 ? sumP2Rev / sumP2Units : null;
    const p1Asp = sumP1Units > 0 ? sumP1Rev / sumP1Units : null;
    const yoyPct = (p2Asp !== null && p1Asp !== null && p1Asp !== 0)
      ? (p2Asp - p1Asp) / p1Asp : null;
    
    const wowP1Asp = sumWowP1Units > 0 ? sumWowP1Rev / sumWowP1Units : null;
    const wowPct = (p2Asp !== null && wowP1Asp !== null && wowP1Asp !== 0)
      ? (p2Asp - wowP1Asp) / wowP1Asp : null;
    
    return { value: p2Asp, yoy: yoyPct, wow: wowPct };
  }
  
  return null;
}

/**
 * Load cross-reference data (GMS or ShippedUnits) for a given week,
 * filtered to a GL. Returns a lookup by subcat code.
 */
let _crossRefCache = {};
function _loadCrossReference(week, metric, gl, mapping) {
  const cacheKey = `${week}:${metric}`;
  if (!_crossRefCache[cacheKey]) {
    const folder = getAllFolder(week);
    if (!folder) return {};
    const filepath = findMetricFile(folder, metric, 'SUBCAT');
    if (!filepath) return {};
    const parsed = readExcelFile(filepath);
    if (parsed.error) return {};
    // Cache the full parsed segments (not filtered — filter per GL on access)
    _crossRefCache[cacheKey] = parsed.segments;
  }
  
  const segments = _crossRefCache[cacheKey];
  const lookup = {};
  for (const seg of segments) {
    const resolution = resolveGL(mapping, seg.code, seg.name);
    let include = false;
    if (resolution.gl === gl) include = true;
    else if (resolution.confidence === 'shared' && resolution.sharedGLs?.[gl]) include = true;
    if (include) {
      lookup[seg.code] = seg;
    }
  }
  return lookup;
}

/**
 * Get subcategory-level drivers for a metric within a GL, with computed CTCs.
 */
function getMetricDrivers(week, gl, metric, options = {}) {
  const { period = 'yoy', limit = 10, direction = 'both' } = options;
  
  const dataInfo = getDataFolder(week, gl);
  if (!dataInfo) return { drivers: null, error: `No data for ${week}` };
  
  const filepath = findMetricFile(dataInfo.folder, metric, 'SUBCAT');
  if (!filepath) return { drivers: null, error: `${metric} not found` };
  
  const parsed = readExcelFile(filepath);
  if (parsed.error) return { drivers: null, error: parsed.error };
  
  const isAll = gl.toUpperCase() === 'ALL' || dataInfo.mode === 'legacy';
  const metricType = getMetricType(metric);
  
  if (isAll) {
    // Use pre-computed CTCs from the file
    return formatDriversFromParsed(parsed, metric, metricType, limit, direction, period);
  }
  
  // GL-level: filter and compute CTCs
  const mapping = getMapping();
  const glSegments = filterToGL(parsed.segments, mapping, gl);
  
  if (glSegments.length === 0) {
    return { drivers: [], total: null, metric, period };
  }
  
  return computeAndFormatDrivers(glSegments, parsed, mapping, gl, metric, metricType, week, limit, direction, period, dataInfo.folder);
}

/**
 * Filter parsed segments to a specific GL.
 */
function filterToGL(segments, mapping, gl) {
  const result = [];
  for (const seg of segments) {
    const resolution = resolveGL(mapping, seg.code, seg.name);
    let proportion = 0;
    if (resolution.gl === gl) {
      proportion = 1.0;
    } else if (resolution.confidence === 'shared' && resolution.sharedGLs?.[gl]) {
      proportion = resolution.sharedGLs[gl];
    }
    if (proportion > 0) {
      result.push({ ...seg, proportion });
    }
  }
  return result;
}

/**
 * Format drivers from pre-parsed data (for ALL view using pre-computed CTCs).
 */
function formatDriversFromParsed(parsed, metric, metricType, limit, direction, period) {
  const isMargin = parsed.layout.layout === 'margin';
  
  let drivers = parsed.segments.map(seg => {
    const ctcBps = isMargin ? seg.yoyCtcBps : seg.yoyCtcBps;
    return {
      subcat_code: seg.code,
      subcat_name: seg.name,
      value: seg.value,
      wow_pct: isMargin ? seg.wowBps : seg.wowPct,
      yoy_pct: isMargin ? seg.yoyBps : seg.yoyPct,
      ctc: ctcBps,
    };
  });
  
  // Filter direction
  if (direction === 'positive') drivers = drivers.filter(d => d.ctc > 0);
  if (direction === 'negative') drivers = drivers.filter(d => d.ctc < 0);
  
  // Sort by absolute CTC
  drivers.sort((a, b) => Math.abs(b.ctc || 0) - Math.abs(a.ctc || 0));
  
  return {
    metric,
    period,
    total: parsed.total ? {
      value: parsed.total.value,
      wow_pct: isMargin ? parsed.total.wowBps : parsed.total.wowPct,
      yoy_pct: isMargin ? parsed.total.yoyBps : parsed.total.yoyPct,
    } : null,
    drivers: drivers.slice(0, limit),
  };
}

/**
 * Compute GL-level CTCs and format as drivers.
 */
function computeAndFormatDrivers(glSegments, parsed, mapping, gl, metric, metricType, week, limit, direction, period, folder) {
  if (metricType === 'non_ratio') {
    const input = glSegments.map(seg => ({
      code: seg.code,
      name: seg.name,
      p2Value: seg.value,
      yoyPct: seg.yoyPct,
      wowPct: seg.wowPct,
      proportion: seg.proportion,
    }));
    
    const result = computeNonRatioCTC(input);
    
    let drivers = result.segments.map(s => ({
      subcat_code: s.code,
      subcat_name: s.name,
      value: s.value,
      wow_pct: s.wowPct,
      yoy_pct: s.yoyPct,
      ctc: s.yoyCtcBps,
    }));
    
    if (direction === 'positive') drivers = drivers.filter(d => d.ctc > 0);
    if (direction === 'negative') drivers = drivers.filter(d => d.ctc < 0);
    
    return {
      metric, period,
      total: {
        value: result.total.p2,
        wow_pct: null, // would need separate WoW computation
        yoy_pct: result.total.yoyPct,
      },
      drivers: drivers.slice(0, limit),
    };
  }
  
  if (metricType === 'percentage') {
    // Need GMS data for cross-reference (to derive P1 revenue)
    const gmsFile = findMetricFile(folder, 'GMS', 'SUBCAT');
    const gmsData = gmsFile ? readExcelFile(gmsFile) : null;
    const gmsLookup = {};
    if (gmsData?.segments) {
      for (const seg of gmsData.segments) {
        gmsLookup[seg.code] = seg;
      }
    }
    
    const input = glSegments.map(seg => {
      const gmsSeg = gmsLookup[seg.code];
      return {
        code: seg.code,
        name: seg.name,
        p2Rate: seg.value,
        p2Revenue: seg.revenue,
        yoyBps: seg.yoyBps,
        wowBps: seg.wowBps,
        gmsYoyPct: gmsSeg?.yoyPct,
        proportion: seg.proportion,
      };
    });
    
    const result = computePercentageCTC(input);
    
    let drivers = result.segments.map(s => ({
      subcat_code: s.code,
      subcat_name: s.name,
      value: s.value,
      wow_pct: s.wowBps,
      yoy_pct: s.yoyBps,
      ctc: s.yoyCtcBps,
      mix: s.yoyMixBps,
      rate: s.yoyRateBps,
    }));
    
    if (direction === 'positive') drivers = drivers.filter(d => d.ctc > 0);
    if (direction === 'negative') drivers = drivers.filter(d => d.ctc < 0);
    
    return {
      metric, period,
      total: {
        value: result.total.p2Rate,
        yoy_pct: result.total.yoyBps,
      },
      drivers: drivers.slice(0, limit),
    };
  }
  
  if (metricType === 'per_unit') {
    // ASP file: col4 = Shipped Units (parsed as 'revenue' in margin layout)
    // ASP YoY (col6) is a PERCENTAGE, not bps.
    // Need ShippedUnits YoY% to derive P1 units for Mix computation.
    const unitsFile = findMetricFile(folder, 'ShippedUnits', 'SUBCAT');
    const unitsData = unitsFile ? readExcelFile(unitsFile) : null;
    const unitsLookup = {};
    if (unitsData?.segments) {
      for (const seg of unitsData.segments) {
        unitsLookup[seg.code] = seg;
      }
    }
    
    const input = glSegments.map(seg => {
      const unitsSeg = unitsLookup[seg.code];
      return {
        code: seg.code,
        name: seg.name,
        p2Rate: seg.value,                        // ASP ($)
        p2Denominator: seg.revenue,               // col4 = Shipped Units in ASP file
        yoyPct: seg.yoyBps,                       // ASP col6 = YoY PERCENTAGE (not bps!)
        wowPct: seg.wowBps,
        unitsYoyPct: unitsSeg?.yoyPct,            // From ShippedUnits file for P1 units
        proportion: seg.proportion,
      };
    });
    
    const result = computePerUnitCTC(input);
    
    let drivers = result.segments.map(s => ({
      subcat_code: s.code,
      subcat_name: s.name,
      value: s.value,
      wow_pct: s.wowBps,
      yoy_pct: s.yoyBps,
      ctc: s.yoyCtc,
      mix: s.yoyMix,
      rate: s.yoyRate,
    }));
    
    if (direction === 'positive') drivers = drivers.filter(d => d.ctc > 0);
    if (direction === 'negative') drivers = drivers.filter(d => d.ctc < 0);
    
    return {
      metric, period,
      total: {
        value: result.total.p2Rate,
        yoy_change: result.total.yoyChange,
      },
      drivers: drivers.slice(0, limit),
    };
  }
  
  return { drivers: [], total: null, metric, period };
}

/**
 * Get ASIN-level detail for a metric within a GL, with computed CTCs.
 */
function getAsinDetail(week, gl, metric, options = {}) {
  const { period = 'yoy', limit = 25 } = options;
  
  const dataInfo = getDataFolder(week, gl);
  if (!dataInfo) return { asins: null, error: `No data for ${week}` };
  
  const filepath = findMetricFile(dataInfo.folder, metric, 'ASIN');
  if (!filepath) return { asins: null, error: `ASIN data for ${metric} not found` };
  
  const parsed = readExcelFile(filepath);
  if (parsed.error) return { asins: null, error: parsed.error };
  
  const isAll = gl.toUpperCase() === 'ALL';
  const isMargin = parsed.layout.layout === 'margin';
  
  // For ASIN files, we can't easily map ASINs to GLs (no mapping for ASINs).
  // For GL-level: we'd need to either:
  // 1. Know which ASINs belong to which GL (not available)
  // 2. Use per-GL ASIN files if they exist
  // For now: return ALL-level ASIN data with pre-computed CTCs.
  // GL-level ASIN will require the per-GL files or an ASIN-to-GL mapping.
  
  const asins = parsed.segments.map(seg => {
    const ctc = isMargin ? seg.yoyCtcBps : seg.yoyCtcBps;
    const yoyDelta = isMargin ? seg.yoyBps : seg.yoyPct;
    const isNewAsin = (yoyDelta === null || yoyDelta === undefined);
    
    return {
      asin: seg.code,
      item_name: (seg.name || '').substring(0, 100),
      value: seg.value,
      yoy_delta: yoyDelta,
      ctc: ctc,
      // For new ASINs (no P1 sales): CTC bps is null but dollar CTC is their full P2 value
      ctc_dollars: seg.yoyCtcDollars,
      is_new: isNewAsin,
    };
  });

  // Separate existing ASINs (have bps CTC) from new ASINs (no P1 sales)
  const existingAsins = asins.filter(a => a.ctc !== null && a.ctc !== undefined);
  const newAsins = asins.filter(a => a.is_new && a.value > 0);
  
  // Sort existing by absolute CTC bps
  existingAsins.sort((a, b) => Math.abs(b.ctc) - Math.abs(a.ctc));
  // Sort new by absolute dollar CTC (= their P2 value, since P1 = 0)
  newAsins.sort((a, b) => Math.abs(b.ctc_dollars || b.value || 0) - Math.abs(a.ctc_dollars || a.value || 0));

  // Reserve up to 5 slots for new ASINs (if any exist), rest for existing
  const newSlots = Math.min(5, newAsins.length);
  const existingSlots = limit - newSlots;
  const combined = [
    ...existingAsins.slice(0, existingSlots),
    ...newAsins.slice(0, newSlots),
  ];
  
  return {
    metric,
    period,
    subcat_filter: null,
    asins: combined,
    newAsinCount: newAsins.length,
  };
}

module.exports = {
  listWeeks,
  listGLs,
  getMetricTotals,
  getMetricDrivers,
  getAsinDetail,
  readExcelFile,
  detectLayout,
  getAllFolder,
  findMetricFile,
  filterToGL,
  getMapping,
  // Re-export for compatibility
  computeNonRatioCTC,
  computePercentageCTC,
  computePerUnitCTC,
};
