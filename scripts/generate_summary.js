#!/usr/bin/env node
/**
 * Summary Generator for Leadership Autopilot
 * 
 * Reads Excel files from a GL folder and generates:
 * 1. _summary.md - Human/LLM readable summary with top drivers
 * 2. _manifest.yaml - Machine-readable file inventory
 * 
 * Usage: node generate_summary.js <gl_folder_path>
 * Example: node generate_summary.js data/weekly/2026-wk05/gl/pc
 */

const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');
const yaml = require('yaml');

// Parse command line args
const glFolderPath = process.argv[2];
if (!glFolderPath) {
  console.error('Usage: node generate_summary.js <gl_folder_path>');
  process.exit(1);
}

// Metric configurations
const METRIC_CONFIG = {
  'GMS': {
    name: 'Shipped GMS',
    unit: '$',
    direction: 'up_good',
    valueCol: 2,  // Column index for metric value
    wowPctCol: 3,
    yoyPctCol: 4,
    wowCtcCol: 5,
    wowCtcBpsCol: 6,
    yoyCtcCol: 7,
    yoyCtcBpsCol: 8,
  },
  'ShippedUnits': {
    name: 'Shipped Units',
    unit: 'units',
    direction: 'up_good',
    valueCol: 2,
    wowPctCol: 3,
    yoyPctCol: 4,
    wowCtcCol: 5,
    wowCtcBpsCol: 6,
    yoyCtcCol: 7,
    yoyCtcBpsCol: 8,
  },
  'ASP': {
    name: 'Average Selling Price',
    unit: '$',
    direction: 'neutral',
    valueCol: 2,
    // ASP has different columns: value, rev share, units, wow%, yoy%, ctc, mix, rate, ctc, mix, rate
    wowPctCol: 5,
    yoyPctCol: 6,
    wowCtcCol: 7,
    wowMixCol: 8,
    wowRateCol: 9,
    yoyCtcCol: 10,
    yoyMixCol: 11,
    yoyRateCol: 12,
    hasMixRate: true,
  },
  'NetPPMLessSD': {
    name: 'Net PPM',
    unit: '%',
    direction: 'up_good',
    valueCol: 2,
    // NetPPM columns: value, net ppm nr, rev share, wow bps, yoy bps, ctc, mix, rate, ctc, mix, rate
    wowBpsCol: 5,
    yoyBpsCol: 6,
    wowCtcBpsCol: 7,
    wowMixCol: 8,
    wowRateCol: 9,
    yoyCtcBpsCol: 10,
    yoyMixCol: 11,
    yoyRateCol: 12,
    hasMixRate: true,
    isBps: true,
  },
  'CM': {
    name: 'Contribution Margin',
    unit: '$',
    direction: 'up_good',
    valueCol: 2,
    wowPctCol: 3,
    yoyPctCol: 4,
    wowCtcCol: 5,
    wowCtcBpsCol: 6,
    yoyCtcCol: 7,
    yoyCtcBpsCol: 8,
  },
  'SOROOS_PROCURABLE_PRODUCT_OOS_GV_PCT': {
    name: 'OOS GV %',
    unit: '%',
    direction: 'down_good',
    valueCol: 2,
    wowBpsCol: 3,
    yoyBpsCol: 4,
    wowCtcBpsCol: 5,
    yoyCtcBpsCol: 7,
    isBps: true,
  },
};

/**
 * Parse filename to extract metric info
 */
function parseFilename(filename) {
  // Pattern: {METRIC}_Week {N}_ctc_by_{LEVEL}.xlsx
  const match = filename.match(/^(.+?)_Week\s*(\d+)_ctc_by_(SUBCAT|ASIN)\.xlsx$/i);
  if (match) {
    return {
      metric: match[1],
      week: parseInt(match[2]),
      level: match[3].toUpperCase(),
    };
  }
  
  // GVs file
  if (filename.startsWith('GVs_By_Week')) {
    return { metric: 'GVs', level: 'CHANNEL', isTraffic: true };
  }
  
  return null;
}

/**
 * Read Excel file and extract data
 */
function readExcelFile(filepath) {
  const workbook = XLSX.readFile(filepath);
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  return XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null });
}

/**
 * Parse SUBCAT data for a metric
 */
function parseSubcatData(rows, metricKey) {
  const config = METRIC_CONFIG[metricKey];
  if (!config) return null;
  
  const results = {
    metric: config.name,
    total: null,
    topYoyDrivers: [],
    topWowDrivers: [],
    hasData: false,
  };
  
  // Skip header rows (usually 2)
  for (let i = 2; i < rows.length; i++) {
    const row = rows[i];
    if (!row || !row[0]) continue;
    
    const subcatCode = String(row[0]).trim();
    const subcatName = row[1] ? String(row[1]).trim() : subcatCode;
    
    // Total row
    if (subcatCode.toLowerCase() === 'total') {
      results.total = {
        value: row[config.valueCol],
        wowPct: config.wowPctCol ? row[config.wowPctCol] : null,
        yoyPct: config.yoyPctCol ? row[config.yoyPctCol] : null,
        wowBps: config.wowBpsCol ? row[config.wowBpsCol] : null,
        yoyBps: config.yoyBpsCol ? row[config.yoyBpsCol] : null,
      };
      results.hasData = true;
      continue;
    }
    
    // Data rows
    const entry = {
      code: subcatCode,
      name: subcatName,
      value: row[config.valueCol],
    };
    
    // YoY CTC
    if (config.yoyCtcBpsCol !== undefined) {
      entry.yoyCtcBps = row[config.yoyCtcBpsCol];
    }
    if (config.yoyCtcCol !== undefined) {
      entry.yoyCtc = row[config.yoyCtcCol];
    }
    
    // WoW CTC
    if (config.wowCtcBpsCol !== undefined) {
      entry.wowCtcBps = row[config.wowCtcBpsCol];
    }
    if (config.wowCtcCol !== undefined) {
      entry.wowCtc = row[config.wowCtcCol];
    }
    
    // Mix/Rate for ASP and NetPPM
    if (config.hasMixRate) {
      entry.yoyMix = row[config.yoyMixCol];
      entry.yoyRate = row[config.yoyRateCol];
      entry.wowMix = row[config.wowMixCol];
      entry.wowRate = row[config.wowRateCol];
    }
    
    results.topYoyDrivers.push(entry);
    results.topWowDrivers.push(entry);
  }
  
  // Sort by absolute CTC (YoY)
  const yoyKey = config.isBps ? 'yoyCtcBps' : 'yoyCtc';
  results.topYoyDrivers.sort((a, b) => {
    const aVal = Math.abs(a[yoyKey] || 0);
    const bVal = Math.abs(b[yoyKey] || 0);
    return bVal - aVal;
  });
  results.topYoyDrivers = results.topYoyDrivers.slice(0, 5);
  
  // Sort by absolute CTC (WoW)
  const wowKey = config.isBps ? 'wowCtcBps' : 'wowCtc';
  results.topWowDrivers.sort((a, b) => {
    const aVal = Math.abs(a[wowKey] || 0);
    const bVal = Math.abs(b[wowKey] || 0);
    return bVal - aVal;
  });
  results.topWowDrivers = results.topWowDrivers.slice(0, 5);
  
  return results;
}

/**
 * Parse traffic CSV
 */
function parseTrafficData(filepath) {
  const content = fs.readFileSync(filepath, 'utf-8');
  const lines = content.trim().split('\n');
  
  const results = {
    metric: 'Glance Views (Traffic)',
    byChannel: {},
    latestWeek: null,
  };
  
  // Parse CSV
  for (let i = 1; i < lines.length; i++) {
    const parts = lines[i].split(',');
    if (parts.length < 7) continue;
    
    const channel = parts[3].trim();
    const weekEnd = parts[4].trim();
    const gv = parseInt(parts[5].replace(/[",\s]/g, '')) || 0;
    const yoy = parseFloat(parts[6]) || 0;
    
    if (!results.byChannel[channel]) {
      results.byChannel[channel] = [];
    }
    results.byChannel[channel].push({ weekEnd, gv, yoy });
  }
  
  return results;
}

/**
 * Format number for display
 */
function fmt(val, type = 'number') {
  if (val === null || val === undefined || isNaN(val)) return 'N/A';
  
  if (type === 'pct') {
    return (val * 100).toFixed(1) + '%';
  }
  if (type === 'bps') {
    return val.toFixed(0) + ' bps';
  }
  if (type === 'currency') {
    if (Math.abs(val) >= 1000000) {
      return '$' + (val / 1000000).toFixed(2) + 'M';
    }
    if (Math.abs(val) >= 1000) {
      return '$' + (val / 1000).toFixed(1) + 'K';
    }
    return '$' + val.toFixed(2);
  }
  if (type === 'units') {
    if (Math.abs(val) >= 1000000) {
      return (val / 1000000).toFixed(2) + 'M';
    }
    if (Math.abs(val) >= 1000) {
      return (val / 1000).toFixed(1) + 'K';
    }
    return val.toFixed(0);
  }
  return val.toFixed(2);
}

/**
 * Generate summary markdown
 */
function generateSummaryMd(glName, week, metrics, traffic) {
  let md = `# ${glName.toUpperCase()} — Week ${week} Summary\n\n`;
  md += `*Auto-generated summary. See individual files for full data.*\n\n`;
  md += `---\n\n`;
  
  // GMS
  if (metrics.GMS && metrics.GMS.hasData) {
    const m = metrics.GMS;
    md += `## Shipped GMS\n\n`;
    md += `**Total:** ${fmt(m.total.value, 'currency')} | `;
    md += `**WoW:** ${fmt(m.total.wowPct, 'pct')} | `;
    md += `**YoY:** ${fmt(m.total.yoyPct, 'pct')}\n\n`;
    
    md += `### Top YoY Drivers (by CTC)\n\n`;
    md += `| Rank | Sub-Category | YoY CTC | Note |\n`;
    md += `|------|--------------|---------|------|\n`;
    m.topYoyDrivers.slice(0, 3).forEach((d, i) => {
      const ctc = d.yoyCtcBps !== undefined ? fmt(d.yoyCtcBps, 'bps') : fmt(d.yoyCtc, 'currency');
      const sign = (d.yoyCtcBps || d.yoyCtc || 0) >= 0 ? '+' : '';
      md += `| ${i + 1} | ${d.name} | ${sign}${ctc} | |\n`;
    });
    md += `\n`;
  }
  
  // Shipped Units
  if (metrics.ShippedUnits && metrics.ShippedUnits.hasData) {
    const m = metrics.ShippedUnits;
    md += `## Shipped Units\n\n`;
    md += `**Total:** ${fmt(m.total.value, 'units')} | `;
    md += `**WoW:** ${fmt(m.total.wowPct, 'pct')} | `;
    md += `**YoY:** ${fmt(m.total.yoyPct, 'pct')}\n\n`;
    
    md += `### Top YoY Drivers (by CTC)\n\n`;
    md += `| Rank | Sub-Category | YoY CTC | Note |\n`;
    md += `|------|--------------|---------|------|\n`;
    m.topYoyDrivers.slice(0, 3).forEach((d, i) => {
      const ctc = fmt(d.yoyCtcBps, 'bps');
      const sign = (d.yoyCtcBps || 0) >= 0 ? '+' : '';
      md += `| ${i + 1} | ${d.name} | ${sign}${ctc} | |\n`;
    });
    md += `\n`;
  }
  
  // ASP
  if (metrics.ASP && metrics.ASP.hasData) {
    const m = metrics.ASP;
    md += `## ASP (Average Selling Price)\n\n`;
    md += `**Total:** ${fmt(m.total.value, 'currency')} | `;
    md += `**WoW:** ${fmt(m.total.wowPct, 'pct')} | `;
    md += `**YoY:** ${fmt(m.total.yoyPct, 'pct')}\n\n`;
    
    md += `### Top YoY Drivers (Mix vs Rate)\n\n`;
    md += `| Rank | Sub-Category | CTC | Mix | Rate |\n`;
    md += `|------|--------------|-----|-----|------|\n`;
    m.topYoyDrivers.slice(0, 3).forEach((d, i) => {
      md += `| ${i + 1} | ${d.name} | ${fmt(d.yoyCtc)} | ${fmt(d.yoyMix)} | ${fmt(d.yoyRate)} |\n`;
    });
    md += `\n`;
  }
  
  // Net PPM
  if (metrics.NetPPMLessSD && metrics.NetPPMLessSD.hasData) {
    const m = metrics.NetPPMLessSD;
    md += `## Net PPM\n\n`;
    md += `**Total:** ${(m.total.value * 100).toFixed(1)}% | `;
    md += `**WoW:** ${fmt(m.total.wowBps, 'bps')} | `;
    md += `**YoY:** ${fmt(m.total.yoyBps, 'bps')}\n\n`;
    
    md += `### Top YoY Drivers (Mix vs Rate)\n\n`;
    md += `| Rank | Sub-Category | CTC (bps) | Mix | Rate |\n`;
    md += `|------|--------------|-----------|-----|------|\n`;
    m.topYoyDrivers.slice(0, 3).forEach((d, i) => {
      const sign = (d.yoyCtcBps || 0) >= 0 ? '+' : '';
      md += `| ${i + 1} | ${d.name} | ${sign}${fmt(d.yoyCtcBps, 'bps')} | ${fmt(d.yoyMix)} | ${fmt(d.yoyRate)} |\n`;
    });
    md += `\n`;
  }
  
  // OOS
  if (metrics.SOROOS_PROCURABLE_PRODUCT_OOS_GV_PCT && metrics.SOROOS_PROCURABLE_PRODUCT_OOS_GV_PCT.hasData) {
    const m = metrics.SOROOS_PROCURABLE_PRODUCT_OOS_GV_PCT;
    md += `## OOS (Out of Stock GV %)\n\n`;
    md += `**Total:** ${(m.total.value * 100).toFixed(2)}% | `;
    md += `**WoW:** ${fmt(m.total.wowBps, 'bps')} | `;
    md += `**YoY:** ${fmt(m.total.yoyBps, 'bps')}\n\n`;
    
    md += `### Biggest OOS Contributors\n\n`;
    md += `| Rank | Sub-Category | YoY CTC (bps) |\n`;
    md += `|------|--------------|---------------|\n`;
    m.topYoyDrivers.slice(0, 3).forEach((d, i) => {
      md += `| ${i + 1} | ${d.name} | ${fmt(d.yoyCtcBps, 'bps')} |\n`;
    });
    md += `\n`;
  }
  
  // Traffic summary
  if (traffic) {
    md += `## Traffic (Glance Views)\n\n`;
    md += `*See GVs file for channel breakdown*\n\n`;
    
    // Find top channels by GV
    const latestByChannel = [];
    for (const [channel, data] of Object.entries(traffic.byChannel)) {
      if (data.length > 0) {
        const latest = data[0];
        latestByChannel.push({ channel, ...latest });
      }
    }
    latestByChannel.sort((a, b) => b.gv - a.gv);
    
    md += `### Top Channels (Latest Week)\n\n`;
    md += `| Channel | GV | YoY |\n`;
    md += `|---------|-----|-----|\n`;
    latestByChannel.slice(0, 5).forEach(c => {
      md += `| ${c.channel} | ${fmt(c.gv, 'units')} | ${fmt(c.yoy, 'pct')} |\n`;
    });
    md += `\n`;
  }
  
  md += `---\n\n`;
  md += `*Generated: ${new Date().toISOString()}*\n`;
  
  return md;
}

/**
 * Generate manifest YAML
 */
function generateManifest(glName, week, files, glFolderPath) {
  const manifest = {
    gl: glName,
    week: week,
    generated: new Date().toISOString(),
    files: {
      subcat: {},
      asin: {},
      other: [],
    },
    metrics_available: [],
  };
  
  for (const file of files) {
    const parsed = parseFilename(file);
    if (!parsed) {
      manifest.files.other.push(file);
      continue;
    }
    
    if (parsed.level === 'SUBCAT') {
      manifest.files.subcat[parsed.metric] = file;
      if (!manifest.metrics_available.includes(parsed.metric)) {
        manifest.metrics_available.push(parsed.metric);
      }
    } else if (parsed.level === 'ASIN') {
      manifest.files.asin[parsed.metric] = file;
    } else if (parsed.isTraffic) {
      manifest.files.other.push(file);
      manifest.metrics_available.push('Traffic');
    }
  }
  
  return manifest;
}

// Main execution
async function main() {
  const absPath = path.resolve(glFolderPath);
  
  if (!fs.existsSync(absPath)) {
    console.error(`Folder not found: ${absPath}`);
    process.exit(1);
  }
  
  // Get GL name from folder
  const glName = path.basename(absPath);
  
  // Get week from parent folder
  const weekFolder = path.basename(path.dirname(path.dirname(absPath)));
  const weekMatch = weekFolder.match(/wk(\d+)/i);
  const week = weekMatch ? parseInt(weekMatch[1]) : 0;
  
  console.log(`Processing: ${glName} (Week ${week})`);
  console.log(`Path: ${absPath}`);
  
  // List files
  const files = fs.readdirSync(absPath).filter(f => 
    f.endsWith('.xlsx') || f.endsWith('.csv')
  );
  console.log(`Found ${files.length} data files`);
  
  // Parse each metric
  const metrics = {};
  let traffic = null;
  
  for (const file of files) {
    const parsed = parseFilename(file);
    if (!parsed) continue;
    
    const filepath = path.join(absPath, file);
    
    if (parsed.isTraffic) {
      console.log(`  Parsing traffic: ${file}`);
      traffic = parseTrafficData(filepath);
    } else if (parsed.level === 'SUBCAT') {
      console.log(`  Parsing ${parsed.metric} SUBCAT: ${file}`);
      const rows = readExcelFile(filepath);
      metrics[parsed.metric] = parseSubcatData(rows, parsed.metric);
    }
  }
  
  // Generate summary
  const summaryMd = generateSummaryMd(glName, week, metrics, traffic);
  const summaryPath = path.join(absPath, '_summary.md');
  fs.writeFileSync(summaryPath, summaryMd);
  console.log(`Generated: ${summaryPath}`);
  
  // Generate manifest
  const manifest = generateManifest(glName, week, files, absPath);
  const manifestPath = path.join(absPath, '_manifest.yaml');
  fs.writeFileSync(manifestPath, yaml.stringify(manifest));
  console.log(`Generated: ${manifestPath}`);
  
  console.log('\nDone!');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
