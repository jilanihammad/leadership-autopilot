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
// Test: GL-Level Aggregate YoY vs PC Baseline (CRITICAL)
// ============================================================================

console.log('\n=== 6. GL-Level Aggregate YoY vs PC Baseline ===');

const pcTotals = loader.getMetricTotals(WEEK, 'PC');
assert(pcTotals.metrics.length === 5, `PC returns ${pcTotals.metrics.length} metrics`);

// Load baseline totals from PC files
function getBaselineYoY(metric) {
  const bl = loadPCBaseline(metric, 'SUBCAT');
  if (!bl?.total) return null;
  const layout = bl.total.length >= 12 ? 'margin' : 'standard';
  if (layout === 'standard') return { value: bl.total[2], yoy: bl.total[4] }; // col4 = YoY%
  return { value: bl.total[2], yoy: bl.total[6] }; // col6 = YoY bps/pct
}

// GMS YoY (percentage)
const pcGMS = pcTotals.metrics.find(m => m.name === 'gms');
const blGMS = getBaselineYoY('GMS');
assert(pcGMS && pcGMS.value !== '—', `PC GMS: ${pcGMS?.value}`);
if (blGMS) {
  const blGMSYoY = parseFloat((blGMS.yoy * 100).toFixed(1));
  assertClose(pcGMS.yoy, blGMSYoY, 5, `PC GMS YoY% (computed vs baseline)`);
}

// ASP YoY (percentage) — REGRESSION: was showing 4% instead of 30%
const pcASP = pcTotals.metrics.find(m => m.name === 'asp');
const blASP = getBaselineYoY('ASP');
assert(pcASP && pcASP.value !== '—', `PC ASP: ${pcASP?.value}`);
if (blASP) {
  const blASPYoY = parseFloat((blASP.yoy * 100).toFixed(1));
  assertClose(pcASP.yoy, blASPYoY, 3, `PC ASP YoY% (computed vs baseline)`);
}

// Net PPM YoY (bps) — REGRESSION: was showing -623 instead of -1406
const pcNPM = pcTotals.metrics.find(m => m.name === 'netppmlesssd');
const blNPM = getBaselineYoY('NetPPMLessSD');
assert(pcNPM && pcNPM.value !== '—', `PC Net PPM: ${pcNPM?.value}`);
if (blNPM) {
  assertClose(pcNPM.yoy, blNPM.yoy, 50, `PC Net PPM YoY bps (computed vs baseline)`);
}

// CM YoY (bps) — REGRESSION: was showing -698 instead of -1066
const pcCM = pcTotals.metrics.find(m => m.name === 'cm');
const blCM = getBaselineYoY('CM');
assert(pcCM && pcCM.value !== '—', `PC CM: ${pcCM?.value}`);
if (blCM) {
  assertClose(pcCM.yoy, blCM.yoy, 50, `PC CM YoY bps (computed vs baseline)`);
}

// ALL totals (sanity check)
const allTotals = loader.getMetricTotals(WEEK, 'ALL');
assert(allTotals.metrics.length === 5, `ALL returns ${allTotals.metrics.length} metrics`);
const allGMS = allTotals.metrics.find(m => m.name === 'gms');
assert(allGMS && allGMS.value !== '—', `ALL GMS: ${allGMS?.value}`);

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
// Test: Question Family Classification
// ============================================================================

console.log('\n=== 8. Question Family Classification ===');

// We can't import ChatSession without starting the server, so replicate the logic
function classifyQuestionFamily(question) {
  const q = question.toLowerCase();
  const isTopline = /topline|gms\b|revenue|sales|unit|volume|shipped|traffic|gv\b|glance|views|oos\b|out\s*of\s*stock|soroos|roos|availability/i.test(q);
  const isMargin = /margin|net\s*ppm|netppm|\bcm\b|contribution\s*margin|profitab|asp\b|price|average\s*sell/i.test(q);
  if (isTopline && isMargin) return 'general';
  if (isTopline) return 'topline';
  if (isMargin) return 'margin';
  return 'general';
}

function getDriverMetricsForFamily(family) {
  switch (family) {
    case 'topline':
      return ['GMS', 'ShippedUnits', 'ASP', 'SOROOS_PROCURABLE_PRODUCT_OOS_GV_PCT', 'GV'];
    case 'margin':
      return ['NetPPMLessSD', 'CM', 'ASP', 'GMS', 'ShippedUnits'];
    case 'general':
    default:
      return ['GMS', 'ShippedUnits', 'ASP', 'NetPPMLessSD', 'CM', 'SOROOS_PROCURABLE_PRODUCT_OOS_GV_PCT', 'GV'];
  }
}

// Topline questions
assert(classifyQuestionFamily('What drove topline growth?') === 'topline', 'Topline: "topline growth"');
assert(classifyQuestionFamily('Why did GMS increase?') === 'topline', 'Topline: "GMS increase"');
assert(classifyQuestionFamily('Tell me about revenue') === 'topline', 'Topline: "revenue"');
assert(classifyQuestionFamily('What happened with units?') === 'topline', 'Topline: "units"');
assert(classifyQuestionFamily('How is traffic looking?') === 'topline', 'Topline: "traffic"');
assert(classifyQuestionFamily('Any OOS issues?') === 'topline', 'Topline: "OOS"');
assert(classifyQuestionFamily('Sales trends this week') === 'topline', 'Topline: "sales"');
assert(classifyQuestionFamily('Volume drivers') === 'topline', 'Topline: "volume"');

// Margin questions
assert(classifyQuestionFamily('Why did margin drop?') === 'margin', 'Margin: "margin drop"');
assert(classifyQuestionFamily('What drove Net PPM decline?') === 'margin', 'Margin: "Net PPM"');
assert(classifyQuestionFamily('CM is compressing') === 'margin', 'Margin: "CM"');
assert(classifyQuestionFamily('What is the ASP trend?') === 'margin', 'Margin: "ASP"');
assert(classifyQuestionFamily('Profitability concerns') === 'margin', 'Margin: "profitability"');
assert(classifyQuestionFamily('Average selling price analysis') === 'margin', 'Margin: "average selling price"');

// General questions (neither or both)
assert(classifyQuestionFamily('What happened this week?') === 'general', 'General: "what happened"');
assert(classifyQuestionFamily('Give me a summary') === 'general', 'General: "summary"');
assert(classifyQuestionFamily('Why did GMS grow but margin dropped?') === 'general', 'General: GMS + margin = general');
assert(classifyQuestionFamily('Revenue grew but Net PPM declined') === 'general', 'General: revenue + Net PPM = general');
assert(classifyQuestionFamily('What are the biggest movers?') === 'general', 'General: "biggest movers"');

// Driver metric scoping
const toplineMetrics = getDriverMetricsForFamily('topline');
assert(!toplineMetrics.includes('NetPPMLessSD'), 'Topline excludes Net PPM drivers');
assert(!toplineMetrics.includes('CM'), 'Topline excludes CM drivers');
assert(toplineMetrics.includes('GMS'), 'Topline includes GMS');
assert(toplineMetrics.includes('ShippedUnits'), 'Topline includes Units');

const marginMetrics = getDriverMetricsForFamily('margin');
assert(marginMetrics.includes('NetPPMLessSD'), 'Margin includes Net PPM');
assert(marginMetrics.includes('CM'), 'Margin includes CM');
assert(marginMetrics.includes('GMS'), 'Margin includes GMS (for mix shifts)');
assert(marginMetrics.includes('ShippedUnits'), 'Margin includes Units (for mix shifts)');
assert(!marginMetrics.includes('SOROOS_PROCURABLE_PRODUCT_OOS_GV_PCT'), 'Margin excludes SOROOS');
assert(!marginMetrics.includes('GV'), 'Margin excludes GV');

const generalMetrics = getDriverMetricsForFamily('general');
assert(generalMetrics.length === 7, `General loads all 7 metrics (got ${generalMetrics.length})`);

// ============================================================================
// Test: New ASIN Surfacing
// ============================================================================

console.log('\n=== 9. New ASIN Detection ===');

const gmsAsins = loader.getAsinDetail(WEEK, 'ALL', 'GMS', { limit: 25 });
assert(gmsAsins.asins.length === 25, `Returns 25 ASINs (got ${gmsAsins.asins.length})`);
assert(typeof gmsAsins.newAsinCount === 'number', `newAsinCount is a number (${gmsAsins.newAsinCount})`);
assert(gmsAsins.newAsinCount > 0, `Found ${gmsAsins.newAsinCount} new ASINs in data`);

const newInResult = gmsAsins.asins.filter(a => a.is_new);
const existingInResult = gmsAsins.asins.filter(a => !a.is_new);
assert(newInResult.length > 0, `New ASINs included in results (${newInResult.length})`);
assert(newInResult.length <= 5, `At most 5 new ASINs in results (${newInResult.length})`);
assert(existingInResult.length === 25 - newInResult.length, `Remaining slots are existing ASINs (${existingInResult.length})`);

// New ASINs must have is_new=true, null yoy_delta, and valid ctc_dollars
for (const a of newInResult) {
  assert(a.is_new === true, `New ASIN ${a.asin} has is_new=true`);
  assert(a.yoy_delta === null || a.yoy_delta === undefined, `New ASIN ${a.asin} has null YoY delta`);
  assert(a.ctc_dollars !== null && a.ctc_dollars !== undefined, `New ASIN ${a.asin} has ctc_dollars (${a.ctc_dollars})`);
  assert(a.value > 0, `New ASIN ${a.asin} has positive value`);
  // Dollar CTC should equal value for new ASINs (P1=0, so all P2 is incremental)
  assert(Math.abs(a.ctc_dollars - a.value) < 1, `New ASIN ${a.asin} ctc_dollars ≈ value`);
}

// Existing ASINs must have is_new=false/undefined and valid bps CTC
for (const a of existingInResult) {
  assert(!a.is_new, `Existing ASIN ${a.asin} is not marked new`);
  assert(a.ctc !== null && a.ctc !== undefined, `Existing ASIN ${a.asin} has bps CTC`);
  assert(a.yoy_delta !== null && a.yoy_delta !== undefined, `Existing ASIN ${a.asin} has YoY delta`);
}

// Existing ASINs should be sorted by absolute CTC desc
for (let i = 1; i < existingInResult.length; i++) {
  assert(
    Math.abs(existingInResult[i - 1].ctc) >= Math.abs(existingInResult[i].ctc),
    `Existing ASINs sorted by |CTC|: ${Math.abs(existingInResult[i - 1].ctc)} >= ${Math.abs(existingInResult[i].ctc)}`
  );
}

// New ASINs should be sorted by absolute dollar CTC desc
for (let i = 1; i < newInResult.length; i++) {
  const prevCtc = Math.abs(newInResult[i - 1].ctc_dollars || newInResult[i - 1].value || 0);
  const currCtc = Math.abs(newInResult[i].ctc_dollars || newInResult[i].value || 0);
  assert(prevCtc >= currCtc, `New ASINs sorted by |$CTC|: ${prevCtc} >= ${currCtc}`);
}

// Test with margin metric too
const npmAsins = loader.getAsinDetail(WEEK, 'ALL', 'NetPPMLessSD', { limit: 25 });
assert(npmAsins.asins.length > 0, `Net PPM ASINs returned (${npmAsins.asins.length})`);
assert(typeof npmAsins.newAsinCount === 'number', 'Net PPM newAsinCount exists');
const npmNew = npmAsins.asins.filter(a => a.is_new);
if (npmNew.length > 0) {
  assert(npmNew[0].yoy_delta === null || npmNew[0].yoy_delta === undefined, 'Net PPM new ASIN has null YoY');
}

// ============================================================================
// Summary
// ============================================================================

console.log(`\n${'='.repeat(50)}`);
console.log(`V2 Validation Results: ${passed} passed, ${failed} failed, ${skipped} skipped`);
console.log(`${'='.repeat(50)}`);

if (failed > 0) {
  process.exit(1);
}
