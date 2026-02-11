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
  // Look for ALL folder (case-insensitive)
  if (!fs.existsSync(weekDir)) return null;
  const dirs = fs.readdirSync(weekDir);
  const allDir = dirs.find(d => d.toUpperCase() === 'ALL');
  return allDir ? path.join(weekDir, allDir) : null;
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
  const mapping = getMapping();
  const allFolder = getAllFolder(week);
  
  if (!allFolder) {
    return { gls: [], error: `No ALL data found for ${week}` };
  }
  
  // Check which metrics have files
  const metricsAvailable = [];
  const knownMetrics = ['GMS', 'ShippedUnits', 'ASP', 'NetPPMLessSD', 'CM', 'SOROOS_PROCURABLE_PRODUCT_OOS_GV_PCT', 'GV'];
  for (const m of knownMetrics) {
    if (findMetricFile(allFolder, m, 'SUBCAT')) {
      metricsAvailable.push(m);
    }
  }
  
  // Return ALL + each GL from mapping
  const gls = [
    { name: 'ALL', label: 'All Categories', metrics: metricsAvailable },
    ...mapping.glList.map(gl => ({
      name: gl,
      label: gl,
      metrics: metricsAvailable,
    })),
  ];
  
  return { gls };
}

/**
 * Get metric totals for a GL (or ALL) — for dashboard metric cards.
 */
function getMetricTotals(week, gl) {
  const allFolder = getAllFolder(week);
  if (!allFolder) return { metrics: [], error: `No data for ${week}` };
  
  const metricDefs = [
    { key: 'GMS', label: 'GMS', format: 'currency' },
    { key: 'ShippedUnits', label: 'Units', format: 'number' },
    { key: 'ASP', label: 'ASP', format: 'currency_small' },
    { key: 'NetPPMLessSD', label: 'Net PPM', format: 'percent' },
    { key: 'CM', label: 'CM', format: 'percent' },
  ];
  
  const isAll = gl.toUpperCase() === 'ALL';
  const mapping = isAll ? null : getMapping();
  
  const metrics = [];
  
  for (const def of metricDefs) {
    const filepath = findMetricFile(allFolder, def.key, 'SUBCAT');
    if (!filepath) {
      metrics.push({ name: def.key.toLowerCase(), label: def.label, value: '—', wow: 0, yoy: 0, sparkline: [0] });
      continue;
    }
    
    const parsed = readExcelFile(filepath);
    if (parsed.error) {
      metrics.push({ name: def.key.toLowerCase(), label: def.label, value: '—', wow: 0, yoy: 0, sparkline: [0] });
      continue;
    }
    
    let totalValue, totalWow, totalYoy;
    
    if (isAll) {
      // Use the Total row directly
      if (!parsed.total) {
        metrics.push({ name: def.key.toLowerCase(), label: def.label, value: '—', wow: 0, yoy: 0, sparkline: [0] });
        continue;
      }
      totalValue = parsed.total.value;
      if (parsed.layout.layout === 'margin') {
        totalWow = parsed.total.wowBps;
        totalYoy = parsed.total.yoyBps;
      } else {
        totalWow = parsed.total.wowPct;
        totalYoy = parsed.total.yoyPct;
      }
    } else {
      // Compute GL-level totals
      const metricType = getMetricType(def.key);
      const glResult = computeGLTotal(parsed, mapping, gl, def.key, metricType, week);
      if (!glResult) {
        metrics.push({ name: def.key.toLowerCase(), label: def.label, value: '—', wow: 0, yoy: 0, sparkline: [0] });
        continue;
      }
      totalValue = glResult.value;
      totalWow = glResult.wow;
      totalYoy = glResult.yoy;
    }
    
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
      // Already in bps
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
      sparkline: [totalValue],
    });
  }
  
  return { metrics, week, gl };
}

/**
 * Compute GL-level total for a metric from consolidated data.
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
    let totalWowP2 = 0, totalWowP1 = 0; // for WoW computation
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
    // Weighted average rate by revenue
    let sumP2NR = 0, sumP2Rev = 0;
    for (const seg of glSegments) {
      sumP2NR += (seg.nr || 0) * seg.proportion;
      sumP2Rev += (seg.revenue || 0) * seg.proportion;
    }
    const rate = sumP2Rev > 0 ? sumP2NR / sumP2Rev : null;
    
    // For YoY: compute P1 rate via weighted average of P1 rates
    let sumP1NR = 0, sumP1Rev = 0;
    for (const seg of glSegments) {
      const p2Rev = (seg.revenue || 0) * seg.proportion;
      const p1Rate = seg.value != null && seg.yoyBps != null ? seg.value - seg.yoyBps / 10000 : null;
      // Approximate P1 revenue from GMS
      // Load GMS data for this segment to get GMS YoY
      // For now, use revenue as P2 and approximate P1 from aggregate
      // This is a simplification — will be refined
      if (p1Rate !== null && p2Rev > 0) {
        // Rough: assume revenue grew at same rate as total
        // Better: cross-reference with GMS file
        sumP1Rev += p2Rev; // placeholder — will refine
        sumP1NR += p1Rate * p2Rev;
      }
    }
    const p1Rate = sumP1Rev > 0 ? sumP1NR / sumP1Rev : null;
    const yoyBps = (rate !== null && p1Rate !== null) ? Math.round((rate - p1Rate) * 10000) : null;
    
    // WoW similar
    let wowBps = null;
    if (glSegments[0]?.wowBps !== undefined) {
      let sumWowP1NR = 0, sumWowRev = 0;
      for (const seg of glSegments) {
        const p2Rev = (seg.revenue || 0) * seg.proportion;
        const wowP1Rate = seg.value != null && seg.wowBps != null ? seg.value - seg.wowBps / 10000 : null;
        if (wowP1Rate !== null && p2Rev > 0) {
          sumWowRev += p2Rev;
          sumWowP1NR += wowP1Rate * p2Rev;
        }
      }
      const wowP1Rate = sumWowRev > 0 ? sumWowP1NR / sumWowRev : null;
      wowBps = (rate !== null && wowP1Rate !== null) ? Math.round((rate - wowP1Rate) * 10000) : null;
    }
    
    return { value: rate, yoy: yoyBps, wow: wowBps };
  }
  
  if (metricType === 'per_unit') {
    // ASP file: col2=ASP, col3=Revenue, col4=Shipped Units
    // In the generic margin parser, col4 is parsed as 'revenue' field
    // but for ASP it's actually Units. col3 (parsed as 'nr') is Revenue.
    // ASP YoY (col6) is a PERCENTAGE, not bps.
    
    // Weighted average ASP by units
    let sumP2Rev = 0, totalP2Units = 0;
    for (const seg of glSegments) {
      const units = (seg.revenue || 0) * seg.proportion; // col4 = units for ASP
      if (seg.value != null && units > 0) {
        sumP2Rev += seg.value * units; // ASP * units = revenue
        totalP2Units += units;
      }
    }
    const avgRate = totalP2Units > 0 ? sumP2Rev / totalP2Units : null;
    
    // P1 ASP from YoY percentage: P1 = P2 / (1 + yoyPct)
    let sumP1Rev = 0, totalP1Units = 0;
    for (const seg of glSegments) {
      const units = (seg.revenue || 0) * seg.proportion; // col4
      const yoyPct = seg.yoyBps; // for ASP, col6 is YoY PERCENTAGE
      if (seg.value != null && yoyPct != null && yoyPct !== -1) {
        const p1Rate = seg.value / (1 + yoyPct);
        // Need P1 units — use ShippedUnits file or approximate
        // For total computation, approximate that unit mix hasn't changed much
        sumP1Rev += p1Rate * units;
        totalP1Units += units;
      }
    }
    const avgP1Rate = totalP1Units > 0 ? sumP1Rev / totalP1Units : null;
    const yoyPct = avgRate !== null && avgP1Rate !== null && avgP1Rate !== 0
      ? (avgRate - avgP1Rate) / avgP1Rate : null;
    
    return { value: avgRate, yoy: yoyPct, wow: null };
  }
  
  return null;
}

/**
 * Get subcategory-level drivers for a metric within a GL, with computed CTCs.
 */
function getMetricDrivers(week, gl, metric, options = {}) {
  const { period = 'yoy', limit = 10, direction = 'both' } = options;
  
  const allFolder = getAllFolder(week);
  if (!allFolder) return { drivers: null, error: `No data for ${week}` };
  
  const filepath = findMetricFile(allFolder, metric, 'SUBCAT');
  if (!filepath) return { drivers: null, error: `${metric} not found` };
  
  const parsed = readExcelFile(filepath);
  if (parsed.error) return { drivers: null, error: parsed.error };
  
  const isAll = gl.toUpperCase() === 'ALL';
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
  
  return computeAndFormatDrivers(glSegments, parsed, mapping, gl, metric, metricType, week, limit, direction, period);
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
function computeAndFormatDrivers(glSegments, parsed, mapping, gl, metric, metricType, week, limit, direction, period) {
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
    const gmsFile = findMetricFile(getAllFolder(week), 'GMS', 'SUBCAT');
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
    const unitsFile = findMetricFile(getAllFolder(week), 'ShippedUnits', 'SUBCAT');
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
  
  const allFolder = getAllFolder(week);
  if (!allFolder) return { asins: null, error: `No data for ${week}` };
  
  const filepath = findMetricFile(allFolder, metric, 'ASIN');
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
    
    return {
      asin: seg.code,
      item_name: (seg.name || '').substring(0, 100),
      value: seg.value,
      yoy_delta: yoyDelta,
      ctc: ctc,
    };
  }).filter(a => a.ctc !== null && a.ctc !== undefined);
  
  // Sort by absolute CTC
  asins.sort((a, b) => Math.abs(b.ctc) - Math.abs(a.ctc));
  
  return {
    metric,
    period,
    subcat_filter: null,
    asins: asins.slice(0, limit),
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
