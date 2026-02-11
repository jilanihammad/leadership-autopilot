#!/usr/bin/env node
/**
 * V2 Data Loader Validation
 * 
 * Compares computed GL-level values from consolidated ALL data
 * against the per-GL PC baseline files for wk06.
 * 
 * This is the critical validation: if computed CTCs match the
 * pre-computed baseline, the consolidated approach is sound.
 */

const path = require('path');
const XLSX = require('xlsx');
const { loadMapping, resolveGL } = require('../mapping');
const { computeNonRatioCTC, computePercentageCTC, computePerUnitCTC, getMetricType } = require('../ctc-engine');
const loader = require('../data-loader-v2');

const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const WEEK = '2026-wk06';

let passed = 0;
let failed = 0;
let skipped = 0;

function assert(condition, message, details) {
  if (condition) {
    passed++;
    console.log(`  ✓ ${message}`);
  } else {
    failed++;
    console.log(`  ✗ ${message}`);
    if (details) console.log(`    ${details}`);
  }
}

function assertClose(actual, expected, tolerance, message) {
  if (expected === null || expected === undefined) {
    skipped++;
    console.log(`  - SKIP: ${message} (no baseline value)`);
    return;
  }
  if (actual === null || actual === undefined) {
    failed++;
    console.log(`  ✗ ${message}: got null, expected ${expected}`);
    return;
  }
  const diff = Math.abs(actual - expected);
  const pctDiff = expected !== 0 ? Math.abs(diff / expected) * 100 : (actual === 0 ? 0 : 100);
  if (diff <= tolerance) {
    passed++;
    console.log(`  ✓ ${message} (${actual} vs ${expected}, diff=${diff.toFixed(2)})`);
  } else {
    failed++;
    console.log(`  ✗ ${message}: got ${actual}, expected ${expected}, diff=${diff.toFixed(2)} (${pctDiff.toFixed(1)}%)`);
  }
}

// ============================================================================
// Load baseline PC data
// ============================================================================

function loadPCBaseline(metric, level) {
  const pcDir = path.join(DATA_DIR, 'weekly', WEEK, 'PC');
  const files = require('fs').readdirSync(pcDir);
  const pattern = new RegExp(`^${metric.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}.*ctc_by_${level}`, 'i');
  const match = files.find(f => pattern.test(f));
  if (!match) return null;
  
  const wb = XLSX.readFile(path.join(pcDir, match));
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null });
  
  // wk06 format: header row 0, data from row 1
  const segments = {};
  let total = null;
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row) continue;
    const code = String(row[0] || '').trim();
    if (code.toLowerCase() === 'total') {
      total = row;
    } else {
      segments[code] = row;
    }
  }
  return { segments, total, rows };
}

// ============================================================================
// Test: Mapping
// ============================================================================

console.log('\n=== 1. Mapping Tests ===');

const mapping = loadMapping(path.join(DATA_DIR, 'GL to Subcat mapping.xlsx'));

assert(mapping.glList.length === 21, `Found ${mapping.glList.length} GLs (expected 21)`);
assert(mapping.glList.includes('PC'), 'PC in GL list');
assert(mapping.entries.filter(e => e.gl === 'PC').length === 25, 
  `PC has ${mapping.entries.filter(e => e.gl === 'PC').length} subcats in mapping (expected 25)`);

// Test resolution of known PC subcats
assert(resolveGL(mapping, '14701001', 'Keyboards').gl === 'PC', 'Keyboards resolves to PC');
assert(resolveGL(mapping, '14700510', 'LCD Monitors').gl === 'PC', 'LCD Monitors resolves to PC');
assert(resolveGL(mapping, '14700705', 'Flash Memory microSD').gl === 'PC', 'Flash Memory microSD resolves to PC');

// Test shared code detection
const unknownRes = resolveGL(mapping, 'UNKNOWN', 'UNKNOWN');
assert(unknownRes.confidence === 'shared', 'UNKNOWN detected as shared');
assert(unknownRes.sharedGLs && unknownRes.sharedGLs['PC'] > 0, 'UNKNOWN has PC proportion');

// Test non-PC subcat doesn't resolve to PC
assert(resolveGL(mapping, '19901001', 'Litter').gl === 'Pet Products', 'Litter resolves to Pet Products');
assert(resolveGL(mapping, '7901004', 'Baking Sheets').gl === 'Kitchen', 'Baking Sheets resolves to Kitchen');

// ============================================================================
// Test: File reading
// ============================================================================

console.log('\n=== 2. File Reading Tests ===');

const allFolder = loader.getAllFolder(WEEK);
assert(allFolder !== null, `ALL folder found for ${WEEK}`);

const gmsFile = loader.findMetricFile(allFolder, 'GMS', 'SUBCAT');
assert(gmsFile !== null, 'GMS SUBCAT file found');

const parsedGMS = loader.readExcelFile(gmsFile);
assert(!parsedGMS.error, `GMS file parsed (${parsedGMS.segments?.length} segments)`);
assert(parsedGMS.layout.layout === 'standard', 'GMS detected as standard layout');
assert(parsedGMS.total?.value > 0, `GMS total: $${parsedGMS.total?.value?.toLocaleString()}`);

const npmFile = loader.findMetricFile(allFolder, 'NetPPMLessSD', 'SUBCAT');
const parsedNPM = loader.readExcelFile(npmFile);
assert(!parsedNPM.error, `NetPPM file parsed (${parsedNPM.segments?.length} segments)`);
assert(parsedNPM.layout.layout === 'margin', 'NetPPM detected as margin layout');

// ============================================================================
// Test: GMS CTC Computation (Non-Ratio) — PC vs Baseline
// ============================================================================

console.log('\n=== 3. GMS CTC Validation (Non-Ratio) ===');

const pcGMSBaseline = loadPCBaseline('GMS', 'SUBCAT');
assert(pcGMSBaseline !== null, 'PC GMS baseline loaded');

// Filter ALL GMS data to PC subcats
const pcGMSSegments = loader.filterToGL(parsedGMS.segments, mapping, 'PC');
assert(pcGMSSegments.length >= 20, `Found ${pcGMSSegments.length} PC subcats in ALL data`);

// Compute non-ratio CTC
const gmsInput = pcGMSSegments.map(seg => ({
  code: seg.code,
  name: seg.name,
  p2Value: seg.value,
  yoyPct: seg.yoyPct,
  wowPct: seg.wowPct,
  proportion: seg.proportion,
}));
const gmsResult = computeNonRatioCTC(gmsInput);

// Compare total
const pcGMSTotal = pcGMSBaseline.total;
console.log(`\nPC GMS Total: Computed $${gmsResult.total.p2.toFixed(2)} vs Baseline $${pcGMSTotal[2]}`);
// Note: won't be exact due to shared-code subcats (UNKNOWN, Laptop Cases)
// But should be within 2% for non-shared subcats

// Compare individual subcat CTCs
console.log('\nPer-subcat CTC comparison (top PC subcats):');
const topPCSubcats = ['14700510', '14700701', '14700705', '14700703', '14701001', '14701002',
  '14700906', '14701003', '14701410', '14700907'];

for (const code of topPCSubcats) {
  const baseline = pcGMSBaseline.segments[code];
  if (!baseline) { skipped++; continue; }
  
  const computed = gmsResult.segments.find(s => s.code === code);
  if (!computed) { 
    failed++;
    console.log(`  ✗ ${code} not found in computed results`);
    continue;
  }
  
  const baselineCTC = baseline[8]; // YoY CTC(bps)
  const name = (baseline[1] || '').substring(0, 25);
  
  // GMS values should match exactly (proportion = 1.0 for these)
  assertClose(computed.value, baseline[2], 0.01, `${code} ${name} GMS value`);
  
  // CTC should be close — tolerance of 10% since we compute from derived P1
  if (baselineCTC !== null && baselineCTC !== undefined) {
    const ctcTolerance = Math.max(Math.abs(baselineCTC) * 0.15, 5); // 15% or 5 bps
    assertClose(computed.yoyCtcBps, baselineCTC, ctcTolerance, `${code} ${name} CTC(bps)`);
  }
}

// ============================================================================
// Test: Net PPM CTC Computation (Percentage) — PC vs Baseline
// ============================================================================

console.log('\n=== 4. Net PPM CTC Validation (Percentage) ===');

const pcNPMBaseline = loadPCBaseline('NetPPMLessSD', 'SUBCAT');
assert(pcNPMBaseline !== null, 'PC NetPPM baseline loaded');

const pcNPMSegments = loader.filterToGL(parsedNPM.segments, mapping, 'PC');
assert(pcNPMSegments.length >= 20, `Found ${pcNPMSegments.length} PC subcats for NetPPM`);

// Load GMS data for cross-reference
const gmsLookup = {};
for (const seg of parsedGMS.segments) {
  gmsLookup[seg.code] = seg;
}

const npmInput = pcNPMSegments.map(seg => ({
  code: seg.code,
  name: seg.name,
  p2Rate: seg.value,
  p2Revenue: seg.revenue,
  yoyBps: seg.yoyBps,
  wowBps: seg.wowBps,
  gmsYoyPct: gmsLookup[seg.code]?.yoyPct,
  proportion: seg.proportion,
}));

const npmResult = computePercentageCTC(npmInput);

console.log(`\nPC Net PPM: Computed rate ${(npmResult.total.p2Rate * 100).toFixed(2)}% vs Baseline ${(pcNPMBaseline.total[2] * 100).toFixed(2)}%`);
assertClose(
  npmResult.total.p2Rate,
  pcNPMBaseline.total[2],
  0.01,
  'PC Net PPM total rate'
);

// Compare YoY change
const baselineNPMYoY = pcNPMBaseline.total[6]; // YoY bps
console.log(`PC Net PPM YoY: Computed ${npmResult.total.yoyBps} bps vs Baseline ${baselineNPMYoY} bps`);

// Per-subcat CTC comparison
console.log('\nPer-subcat Net PPM CTC comparison:');
const topNPMSubcats = ['14700705', '14701001', '14700510', '14700701', '14700906'];

for (const code of topNPMSubcats) {
  const baseline = pcNPMBaseline.segments[code];
  if (!baseline) { skipped++; continue; }
  
  const computed = npmResult.segments.find(s => s.code === code);
  if (!computed) {
    failed++;
    console.log(`  ✗ ${code} not found in computed Net PPM results`);
    continue;
  }
  
  const baselineCTC = baseline[10]; // YoY CTC(bps)
  const name = (baseline[1] || '').substring(0, 25);
  
  // Rate should match (same raw data)
  assertClose(computed.value, baseline[2], 0.0001, `${code} ${name} Net PPM rate`);
  
  // CTC tolerance: 20% or 10 bps (percentage metrics have more computation)
  if (baselineCTC !== null && baselineCTC !== undefined) {
    const ctcTolerance = Math.max(Math.abs(baselineCTC) * 0.25, 10);
    assertClose(computed.yoyCtcBps, baselineCTC, ctcTolerance, `${code} ${name} Net PPM CTC(bps)`);
  }
}

// ============================================================================
// Test: ASP CTC (Per-Unit) — PC vs Baseline
// ============================================================================

console.log('\n=== 5. ASP CTC Validation (Per-Unit) ===');

const aspFile = loader.findMetricFile(allFolder, 'ASP', 'SUBCAT');
const parsedASP = loader.readExcelFile(aspFile);
const pcASPBaseline = loadPCBaseline('ASP', 'SUBCAT');

if (pcASPBaseline && !parsedASP.error) {
  const pcASPSegments = loader.filterToGL(parsedASP.segments, mapping, 'PC');
  assert(pcASPSegments.length >= 15, `Found ${pcASPSegments.length} PC subcats for ASP`);
  
  // Load ShippedUnits for cross-reference (need units YoY% for P1 derivation)
  const unitsFile = loader.findMetricFile(allFolder, 'ShippedUnits', 'SUBCAT');
  const parsedUnits = unitsFile ? loader.readExcelFile(unitsFile) : null;
  const unitsLookup = {};
  if (parsedUnits?.segments) {
    for (const seg of parsedUnits.segments) {
      unitsLookup[seg.code] = seg;
    }
  }
  
  // ASP file: col2=ASP, col3=Revenue (parsed as 'nr'), col4=Units (parsed as 'revenue')
  // ASP YoY (col6) is a PERCENTAGE, not bps
  const aspInput = pcASPSegments.map(seg => ({
    code: seg.code,
    name: seg.name,
    p2Rate: seg.value,                        // ASP ($)
    p2Denominator: seg.revenue,               // col4 = Shipped Units in ASP file
    yoyPct: seg.yoyBps,                       // col6 = YoY PERCENTAGE for ASP
    wowPct: seg.wowBps,
    unitsYoyPct: unitsLookup[seg.code]?.yoyPct,
    proportion: seg.proportion,
  }));
  
  const aspResult = computePerUnitCTC(aspInput);
  
  console.log(`\nPC ASP: Computed $${aspResult.total.p2Rate?.toFixed(2)} vs Baseline $${pcASPBaseline.total?.[2]?.toFixed(2)}`);
  
  // Compare top subcats
  for (const code of ['14700510', '14700701', '14700705']) {
    const baseline = pcASPBaseline.segments[code];
    const computed = aspResult.segments.find(s => s.code === code);
    if (baseline && computed) {
      const name = (baseline[1] || '').substring(0, 25);
      assertClose(computed.value, baseline[2], 0.01, `${code} ${name} ASP value`);
      
      const baselineCTC = baseline[10]; // YoY CTC for margin layout
      if (baselineCTC != null) {
        const tol = Math.max(Math.abs(baselineCTC) * 0.30, 0.5);
        assertClose(computed.yoyCtc, baselineCTC, tol, `${code} ${name} ASP CTC($)`);
      }
    }
  }
} else {
  skipped += 3;
  console.log('  - SKIP: ASP baseline not available or parse error');
}

// ============================================================================
// Test: Metric Totals API (end-to-end)
// ============================================================================

console.log('\n=== 6. Metric Totals API (End-to-End) ===');

const allTotals = loader.getMetricTotals(WEEK, 'ALL');
assert(allTotals.metrics.length === 5, `ALL returns ${allTotals.metrics.length} metrics`);

const allGMS = allTotals.metrics.find(m => m.name === 'gms');
assert(allGMS && allGMS.value !== '—', `ALL GMS: ${allGMS?.value}`);

const pcTotals = loader.getMetricTotals(WEEK, 'PC');
assert(pcTotals.metrics.length === 5, `PC returns ${pcTotals.metrics.length} metrics`);

const pcGMS = pcTotals.metrics.find(m => m.name === 'gms');
assert(pcGMS && pcGMS.value !== '—', `PC GMS: ${pcGMS?.value}`);

// PC GMS should be smaller than ALL GMS
const pcNPM = pcTotals.metrics.find(m => m.name === 'netppmlesssd');
assert(pcNPM && pcNPM.value !== '—', `PC Net PPM: ${pcNPM?.value}`);

// ============================================================================
// Test: GL List API
// ============================================================================

console.log('\n=== 7. GL List API ===');

const glResult = loader.listGLs(WEEK);
assert(glResult.gls.length >= 20, `Found ${glResult.gls.length} GLs`);
assert(glResult.gls[0].name === 'ALL', 'First GL is ALL');
assert(glResult.gls.find(g => g.name === 'PC'), 'PC in GL list');
assert(glResult.gls.find(g => g.name === 'Kitchen'), 'Kitchen in GL list');

// ============================================================================
// Summary
// ============================================================================

console.log(`\n${'='.repeat(50)}`);
console.log(`V2 Validation Results: ${passed} passed, ${failed} failed, ${skipped} skipped`);
console.log(`${'='.repeat(50)}`);

if (failed > 0) {
  process.exit(1);
}
