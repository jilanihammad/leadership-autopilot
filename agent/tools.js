#!/usr/bin/env node
/**
 * Leadership Autopilot - Agent Tools
 * 
 * Deterministic tools for the agent to access WBR data.
 * Each tool does structured data extraction - no LLM needed.
 */

const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');
const yaml = require('yaml');

// Base data path
const DATA_DIR = path.join(__dirname, '..', 'data', 'weekly');

/**
 * Tool: list_weeks
 * List all available weeks of data
 */
function listWeeks() {
  if (!fs.existsSync(DATA_DIR)) {
    return { weeks: [], error: null };
  }
  
  const weeks = fs.readdirSync(DATA_DIR)
    .filter(d => d.match(/^\d{4}-wk\d+$/))
    .sort()
    .reverse(); // Most recent first
  
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
  
  const gls = fs.readdirSync(glDir)
    .filter(d => fs.statSync(path.join(glDir, d)).isDirectory());
  
  // Load manifest for each GL to get metrics available
  const glInfo = gls.map(gl => {
    const manifestPath = path.join(glDir, gl, '_manifest.yaml');
    if (fs.existsSync(manifestPath)) {
      const manifest = yaml.parse(fs.readFileSync(manifestPath, 'utf-8'));
      return {
        name: gl,
        metrics: manifest.metrics_available || [],
      };
    }
    return { name: gl, metrics: [] };
  });
  
  return { gls: glInfo };
}

/**
 * Tool: get_summary
 * Get the summary markdown for a GL
 */
function getSummary(week, gl) {
  const summaryPath = path.join(DATA_DIR, week, 'gl', gl, '_summary.md');
  
  if (!fs.existsSync(summaryPath)) {
    return { summary: null, error: `Summary not found for ${gl} in ${week}` };
  }
  
  const summary = fs.readFileSync(summaryPath, 'utf-8');
  return { summary };
}

/**
 * Tool: get_manifest
 * Get the manifest for a GL (lists all available files)
 */
function getManifest(week, gl) {
  const manifestPath = path.join(DATA_DIR, week, 'gl', gl, '_manifest.yaml');
  
  if (!fs.existsSync(manifestPath)) {
    return { manifest: null, error: `Manifest not found for ${gl} in ${week}` };
  }
  
  const manifest = yaml.parse(fs.readFileSync(manifestPath, 'utf-8'));
  return { manifest };
}

/**
 * Tool: get_metric_drivers
 * Get top N drivers for a metric at SUBCAT level
 */
function getMetricDrivers(week, gl, metric, options = {}) {
  const {
    period = 'yoy',      // 'yoy' or 'wow'
    limit = 5,           // Number of drivers to return
    direction = 'both',  // 'positive', 'negative', or 'both'
  } = options;
  
  // Find the SUBCAT file
  const manifestPath = path.join(DATA_DIR, week, 'gl', gl, '_manifest.yaml');
  if (!fs.existsSync(manifestPath)) {
    return { drivers: null, error: `Manifest not found for ${gl}` };
  }
  
  const manifest = yaml.parse(fs.readFileSync(manifestPath, 'utf-8'));
  const filename = manifest.files?.subcat?.[metric];
  
  if (!filename) {
    return { drivers: null, error: `Metric ${metric} not found for ${gl}` };
  }
  
  const filepath = path.join(DATA_DIR, week, 'gl', gl, filename);
  const workbook = XLSX.readFile(filepath);
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null });
  
  // Parse based on metric type
  const drivers = [];
  
  // Determine column indices based on metric
  // This varies by metric - we need to detect from headers
  const headers = rows[0] || [];
  const headerRow = rows[1] || [];
  
  // Find CTC column for the period
  let ctcColIndex = -1;
  let valueColIndex = 2; // Usually column C
  
  // Standard metrics (GMS, Units, CM) have: Code, Name, Value, WoW%, YoY%, WoW CTC $, WoW CTC bps, YoY CTC $, YoY CTC bps
  // ASP/NetPPM have Mix/Rate columns
  
  for (let i = 0; i < headerRow.length; i++) {
    const h = String(headerRow[i] || '').toLowerCase();
    if (period === 'yoy' && h.includes('yoy') && h.includes('ctc')) {
      ctcColIndex = i;
      break;
    }
    if (period === 'wow' && h.includes('wow') && h.includes('ctc')) {
      ctcColIndex = i;
      break;
    }
  }
  
  // If we can't find CTC column, use fallback positions
  if (ctcColIndex === -1) {
    ctcColIndex = period === 'yoy' ? 8 : 6; // Common positions
  }
  
  // Parse data rows (skip header rows)
  for (let i = 2; i < rows.length; i++) {
    const row = rows[i];
    if (!row || !row[0]) continue;
    
    const code = String(row[0]).trim();
    if (code.toLowerCase() === 'total') continue; // Skip total row
    
    const name = row[1] ? String(row[1]).trim() : code;
    const value = row[valueColIndex];
    const ctc = row[ctcColIndex];
    
    if (ctc === null || ctc === undefined) continue;
    
    // Filter by direction
    if (direction === 'positive' && ctc < 0) continue;
    if (direction === 'negative' && ctc > 0) continue;
    
    // Get WoW% and YoY% (columns 3 and 4 based on Excel structure)
    const wowPct = row[3];
    const yoyPct = row[4];
    
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
  
  // Get total row
  let total = null;
  for (let i = 2; i < rows.length; i++) {
    const row = rows[i];
    if (row && String(row[0]).toLowerCase() === 'total') {
      total = {
        value: row[valueColIndex],
        wow_pct: row[3],
        yoy_pct: row[4],
      };
      break;
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
  const manifestPath = path.join(DATA_DIR, week, 'gl', gl, '_manifest.yaml');
  if (!fs.existsSync(manifestPath)) {
    return { subcats: [], error: `Manifest not found for ${gl}` };
  }
  
  const manifest = yaml.parse(fs.readFileSync(manifestPath, 'utf-8'));
  
  // Define metrics to load and their column configs
  const metricConfigs = {
    'GMS': { valueCol: 2, wowCol: 3, yoyCol: 4, ctcCol: 8, format: 'currency' },
    'ShippedUnits': { valueCol: 2, wowCol: 3, yoyCol: 4, ctcCol: 8, format: 'number' },
    'ASP': { valueCol: 2, wowCol: 5, yoyCol: 6, ctcCol: 10, format: 'currency' },
    'NetPPMLessSD': { valueCol: 2, wowCol: 5, yoyCol: 6, ctcCol: 10, format: 'percent', isBps: true },
    'CM': { valueCol: 2, wowCol: 5, yoyCol: 6, ctcCol: 10, format: 'percent', isBps: true },
  };
  
  // Build subcat lookup: code -> { name, metrics: {} }
  const subcatMap = {};
  
  for (const [metric, config] of Object.entries(metricConfigs)) {
    const filename = manifest.files?.subcat?.[metric];
    if (!filename) continue;
    
    const filepath = path.join(DATA_DIR, week, 'gl', gl, filename);
    if (!fs.existsSync(filepath)) continue;
    
    const workbook = XLSX.readFile(filepath);
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null });
    
    for (let i = 2; i < rows.length; i++) {
      const row = rows[i];
      if (!row || !row[0]) continue;
      
      const code = String(row[0]).trim();
      if (code.toLowerCase() === 'total') continue;
      
      const name = row[1] ? String(row[1]).trim() : code;
      
      if (!subcatMap[code]) {
        subcatMap[code] = { code, name, metrics: {} };
      }
      
      // Get WoW/YoY values
      let wowPct = row[config.wowCol];
      let yoyPct = row[config.yoyCol];
      
      // For margin metrics, values are in bps - convert to decimal %
      if (config.isBps) {
        wowPct = (wowPct || 0) / 10000; // bps to decimal
        yoyPct = (yoyPct || 0) / 10000;
      }
      
      subcatMap[code].metrics[metric] = {
        value: row[config.valueCol],
        wow_pct: wowPct,
        yoy_pct: yoyPct,
        yoy_ctc_bps: row[config.ctcCol],
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
  
  return { subcats, week, gl };
}

/**
 * Tool: get_subcat_detail
 * Get detail for a specific subcategory by name or code
 */
function getSubcatDetail(week, gl, metric, subcatQuery) {
  // Find the SUBCAT file
  const manifestPath = path.join(DATA_DIR, week, 'gl', gl, '_manifest.yaml');
  if (!fs.existsSync(manifestPath)) {
    return { subcat: null, error: `Manifest not found for ${gl}` };
  }
  
  const manifest = yaml.parse(fs.readFileSync(manifestPath, 'utf-8'));
  const filename = manifest.files?.subcat?.[metric];
  
  if (!filename) {
    return { subcat: null, error: `Metric ${metric} not found for ${gl}` };
  }
  
  const filepath = path.join(DATA_DIR, week, 'gl', gl, filename);
  const workbook = XLSX.readFile(filepath);
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null });
  
  const query = subcatQuery.toLowerCase();
  
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
      };
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
  const manifestPath = path.join(DATA_DIR, week, 'gl', gl, '_manifest.yaml');
  if (!fs.existsSync(manifestPath)) {
    return { results: [], error: `Manifest not found for ${gl}` };
  }
  
  const manifest = yaml.parse(fs.readFileSync(manifestPath, 'utf-8'));
  const q = query.toLowerCase();
  
  // Define column mappings for different metric types
  // Standard: Code, Name, Value, WoW%, YoY%, WoW CTC, WoW bps, YoY CTC, YoY bps
  // Margin: Code, Name, Value%, NR, Rev$, WoW(bps), YoY(bps), WoW CTC, Mix, Rate, YoY CTC, Mix, Rate
  const metricConfigs = {
    'GMS': { valueCol: 2, wowCol: 3, yoyCol: 4, ctcCol: 8, isPercent: false },
    'ShippedUnits': { valueCol: 2, wowCol: 3, yoyCol: 4, ctcCol: 8, isPercent: false },
    'NetPPMLessSD': { valueCol: 2, wowCol: 5, yoyCol: 6, ctcCol: 10, isPercent: true, isBps: true },
    'CM': { valueCol: 2, wowCol: 5, yoyCol: 6, ctcCol: 10, isPercent: true, isBps: true },
  };
  
  const results = [];
  
  for (const [metric, config] of Object.entries(metricConfigs)) {
    const filename = manifest.files?.subcat?.[metric];
    if (!filename) continue;
    
    const filepath = path.join(DATA_DIR, week, 'gl', gl, filename);
    if (!fs.existsSync(filepath)) continue;
    
    const workbook = XLSX.readFile(filepath);
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null });
    
    for (let i = 2; i < rows.length; i++) {
      const row = rows[i];
      if (!row || !row[0]) continue;
      
      const code = String(row[0]).trim();
      const name = row[1] ? String(row[1]).trim() : '';
      
      if (name.toLowerCase().includes(q) || code.toLowerCase().includes(q)) {
        let existing = results.find(r => r.code === code);
        if (!existing) {
          existing = { code, name, metrics: {} };
          results.push(existing);
        }
        
        // For margin metrics, WoW/YoY are already in bps, convert to %
        let wowPct = row[config.wowCol];
        let yoyPct = row[config.yoyCol];
        if (config.isBps) {
          wowPct = wowPct / 100; // bps to %
          yoyPct = yoyPct / 100;
        }
        
        existing.metrics[metric] = {
          value: row[config.valueCol],
          wow_pct: wowPct,
          yoy_pct: yoyPct,
          yoy_ctc_bps: row[config.ctcCol],
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
  const {
    subcat_code = null,  // Filter to specific subcat
    period = 'yoy',
    limit = 10,
  } = options;
  
  // Find the ASIN file
  const manifestPath = path.join(DATA_DIR, week, 'gl', gl, '_manifest.yaml');
  if (!fs.existsSync(manifestPath)) {
    return { asins: null, error: `Manifest not found for ${gl}` };
  }
  
  const manifest = yaml.parse(fs.readFileSync(manifestPath, 'utf-8'));
  const filename = manifest.files?.asin?.[metric];
  
  if (!filename) {
    return { asins: null, error: `ASIN data for ${metric} not found` };
  }
  
  const filepath = path.join(DATA_DIR, week, 'gl', gl, filename);
  const workbook = XLSX.readFile(filepath);
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null });
  
  // ASIN files have: ASIN, Item Name, Value, WoW%, YoY%, WoW CTC, WoW CTC bps, YoY CTC, YoY CTC bps
  const asins = [];
  const ctcColIndex = period === 'yoy' ? 7 : 5; // Standard positions
  
  for (let i = 2; i < rows.length; i++) {
    const row = rows[i];
    if (!row || !row[0]) continue;
    
    const asin = String(row[0]).trim();
    if (asin.toLowerCase() === 'total') continue;
    
    const itemName = row[1] ? String(row[1]).trim() : '';
    const value = row[2];
    const ctc = row[ctcColIndex];
    
    if (ctc === null || ctc === undefined) continue;
    
    // If filtering by subcat, we need to match somehow
    // Note: ASIN files may not have subcat - this is a limitation
    // For now, return all ASINs sorted by CTC
    
    asins.push({
      asin,
      item_name: itemName.substring(0, 100), // Truncate long names
      value,
      ctc,
    });
  }
  
  // Sort by absolute CTC
  asins.sort((a, b) => Math.abs(b.ctc) - Math.abs(a.ctc));
  
  return {
    metric,
    period,
    subcat_filter: subcat_code,
    asins: asins.slice(0, limit),
  };
}

/**
 * Tool: get_traffic_channels
 * Get traffic breakdown by channel
 */
function getTrafficChannels(week, gl, options = {}) {
  const { limit = 10 } = options;
  
  const glDir = path.join(DATA_DIR, week, 'gl', gl);
  
  // Find GVs file
  const files = fs.readdirSync(glDir).filter(f => f.startsWith('GVs_'));
  if (files.length === 0) {
    return { channels: null, error: 'Traffic data not found' };
  }
  
  const filepath = path.join(glDir, files[0]);
  const content = fs.readFileSync(filepath, 'utf-8');
  const lines = content.trim().split('\n');
  
  // Parse CSV - group by channel, get latest week
  const byChannel = {};
  
  for (let i = 1; i < lines.length; i++) {
    const parts = lines[i].split(',');
    if (parts.length < 7) continue;
    
    const channel = parts[3].replace(/"/g, '').trim();
    const weekEnd = parts[4].replace(/"/g, '').trim();
    const gvStr = parts[5].replace(/[",\s]/g, '');
    const gv = parseInt(gvStr) || 0;
    const yoy = parseFloat(parts[6]) || 0;
    
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

// Export tools
module.exports = {
  listWeeks,
  listGLs,
  getSummary,
  getManifest,
  getAllSubcatData,
  getMetricDrivers,
  getSubcatDetail,
  searchSubcats,
  getAsinDetail,
  getTrafficChannels,
  compareMetrics,
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
