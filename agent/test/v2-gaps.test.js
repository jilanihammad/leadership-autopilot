#!/usr/bin/env node
/**
 * V2 Gap-Closing Tests
 * 
 * Closes test coverage gaps identified after the P2-weight bug:
 * 1. WoW values validated against PC baseline
 * 2. ALL-level totals cross-checked against ALL file Total row
 * 3. API endpoint smoke tests (movers, alerts, freshness, trends)
 * 4. Multi-GL spot checks (Kitchen, Toys) for mapping sanity
 */

const path = require('path');
const XLSX = require('xlsx');
const loader = require('../data-loader-v2');

const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const WEEK = '2026-wk06';

let passed = 0, failed = 0, skipped = 0;

function assert(condition, message, details) {
  if (condition) { passed++; console.log(`  ✓ ${message}`); }
  else { failed++; console.log(`  ✗ ${message}`); if (details) console.log(`    ${details}`); }
}

function assertClose(actual, expected, tolerance, message) {
  if (expected === null || expected === undefined) { skipped++; return; }
  if (actual === null || actual === undefined) { failed++; console.log(`  ✗ ${message}: got null, expected ${expected}`); return; }
  const diff = Math.abs(actual - expected);
  if (diff <= tolerance) { passed++; console.log(`  ✓ ${message} (${actual} vs ${expected}, diff=${diff.toFixed(2)})`); }
  else { failed++; console.log(`  ✗ ${message}: got ${actual}, expected ${expected}, diff=${diff.toFixed(2)}`); }
}

function readBaseline(folder, metric, level) {
  const dir = path.join(DATA_DIR, 'weekly', WEEK, folder);
  const files = require('fs').readdirSync(dir);
  const pattern = new RegExp(`^${metric.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}.*ctc_by_${level}`, 'i');
  const match = files.find(f => pattern.test(f));
  if (!match) return null;
  const wb = XLSX.readFile(path.join(dir, match));
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: null });
  return rows.find(r => String(r[0]).toLowerCase() === 'total');
}

// ============================================================================
// 1. ALL-Level Totals vs ALL File Total Row
// ============================================================================
console.log('\n=== 1. ALL-Level Totals vs ALL Baseline ===');

const allMetrics = loader.getMetricTotals(WEEK, 'ALL');

// GMS
const allGmsBaseline = readBaseline('ALL', 'GMS', 'SUBCAT');
const allGms = allMetrics.metrics.find(m => m.name === 'gms');
assertClose(allGms.yoy, parseFloat((allGmsBaseline[4] * 100).toFixed(1)), 0.1, 'ALL GMS YoY%');
assertClose(allGms.wow, parseFloat((allGmsBaseline[3] * 100).toFixed(1)), 0.1, 'ALL GMS WoW%');

// Units
const allUnitsBaseline = readBaseline('ALL', 'ShippedUnits', 'SUBCAT');
const allUnits = allMetrics.metrics.find(m => m.name === 'shippedunits');
assertClose(allUnits.yoy, parseFloat((allUnitsBaseline[4] * 100).toFixed(1)), 0.1, 'ALL Units YoY%');
assertClose(allUnits.wow, parseFloat((allUnitsBaseline[3] * 100).toFixed(1)), 0.1, 'ALL Units WoW%');

// ASP
const allAspBaseline = readBaseline('ALL', 'ASP', 'SUBCAT');
const allAsp = allMetrics.metrics.find(m => m.name === 'asp');
assertClose(allAsp.yoy, parseFloat((allAspBaseline[6] * 100).toFixed(1)), 0.1, 'ALL ASP YoY%');
assertClose(allAsp.wow, parseFloat((allAspBaseline[5] * 100).toFixed(1)), 0.1, 'ALL ASP WoW%');

// Net PPM
const allNpmBaseline = readBaseline('ALL', 'NetPPMLessSD', 'SUBCAT');
const allNpm = allMetrics.metrics.find(m => m.name === 'netppmlesssd');
assertClose(allNpm.yoy, allNpmBaseline[6], 0.1, 'ALL Net PPM YoY bps');
assertClose(allNpm.wow, allNpmBaseline[5], 0.1, 'ALL Net PPM WoW bps');

// CM
const allCmBaseline = readBaseline('ALL', 'CM', 'SUBCAT');
const allCm = allMetrics.metrics.find(m => m.name === 'cm');
assertClose(allCm.yoy, allCmBaseline[6], 0.1, 'ALL CM YoY bps');
assertClose(allCm.wow, allCmBaseline[5], 0.1, 'ALL CM WoW bps');

// ============================================================================
// 2. PC WoW Values vs PC Baseline
// ============================================================================
console.log('\n=== 2. PC WoW Values vs Baseline ===');

const pcMetrics = loader.getMetricTotals(WEEK, 'PC');

// GMS WoW
const pcGmsBaseline = readBaseline('PC', 'GMS', 'SUBCAT');
const pcGms = pcMetrics.metrics.find(m => m.name === 'gms');
assertClose(pcGms.wow, parseFloat((pcGmsBaseline[3] * 100).toFixed(1)), 3, 'PC GMS WoW%');

// ASP WoW
const pcAspBaseline = readBaseline('PC', 'ASP', 'SUBCAT');
const pcAsp = pcMetrics.metrics.find(m => m.name === 'asp');
assertClose(pcAsp.wow, parseFloat((pcAspBaseline[5] * 100).toFixed(1)), 3, 'PC ASP WoW%');

// Net PPM WoW
const pcNpmBaseline = readBaseline('PC', 'NetPPMLessSD', 'SUBCAT');
const pcNpm = pcMetrics.metrics.find(m => m.name === 'netppmlesssd');
assertClose(pcNpm.wow, pcNpmBaseline[5], 50, 'PC Net PPM WoW bps');

// CM WoW
const pcCmBaseline = readBaseline('PC', 'CM', 'SUBCAT');
const pcCm = pcMetrics.metrics.find(m => m.name === 'cm');
assertClose(pcCm.wow, pcCmBaseline[5], 50, 'PC CM WoW bps');

// ============================================================================
// 3. Multi-GL Spot Checks (mapping sanity)
// ============================================================================
console.log('\n=== 3. Multi-GL Spot Checks ===');

// Kitchen — should have subcats and non-zero GMS
const kitchenMetrics = loader.getMetricTotals(WEEK, 'Kitchen');
const kitchenGms = kitchenMetrics.metrics.find(m => m.name === 'gms');
assert(kitchenGms && kitchenGms.value !== '—', `Kitchen GMS: ${kitchenGms?.value}`);
assert(kitchenGms.sparkline[kitchenGms.sparkline.length - 1] > 0, 'Kitchen GMS > 0');

const kitchenDrivers = loader.getMetricDrivers(WEEK, 'Kitchen', 'GMS', { limit: 3 });
assert(kitchenDrivers.drivers && kitchenDrivers.drivers.length > 0, `Kitchen has ${kitchenDrivers.drivers?.length} GMS drivers`);
// Baking Sheets should be a Kitchen subcat
const bakingSheets = kitchenDrivers.drivers?.find(d => /baking/i.test(d.subcat_name));
// May not be in top 3, just check the list works

// Toys
const toysMetrics = loader.getMetricTotals(WEEK, 'Toys');
const toysGms = toysMetrics.metrics.find(m => m.name === 'gms');
assert(toysGms && toysGms.value !== '—', `Toys GMS: ${toysGms?.value}`);
assert(toysGms.sparkline[toysGms.sparkline.length - 1] > 0, 'Toys GMS > 0');

// Electronics
const elecMetrics = loader.getMetricTotals(WEEK, 'Electronics');
const elecGms = elecMetrics.metrics.find(m => m.name === 'gms');
assert(elecGms && elecGms.value !== '—', `Electronics GMS: ${elecGms?.value}`);

// Sports
const sportsMetrics = loader.getMetricTotals(WEEK, 'Sports');
const sportsGms = sportsMetrics.metrics.find(m => m.name === 'gms');
assert(sportsGms && sportsGms.value !== '—', `Sports GMS: ${sportsGms?.value}`);

// Home
const homeMetrics = loader.getMetricTotals(WEEK, 'Home');
const homeGms = homeMetrics.metrics.find(m => m.name === 'gms');
assert(homeGms && homeGms.value !== '—', `Home GMS: ${homeGms?.value}`);

// Verify no GL returns zero GMS (mapping broken)
const mapping = loader.getMapping();
for (const gl of mapping.glList) {
  const m = loader.getMetricTotals(WEEK, gl);
  const gms = m.metrics.find(x => x.name === 'gms');
  const raw = gms?.sparkline?.[gms.sparkline.length - 1];
  assert(raw > 0, `${gl} GMS > 0 ($${raw ? (raw / 1e6).toFixed(2) + 'M' : '0'})`);
}

// ============================================================================
// 4. API Endpoint Smoke Tests
// ============================================================================
console.log('\n=== 4. API Endpoint Smoke Tests ===');

// Movers
const movers = loader.getMetricDrivers(WEEK, 'PC', 'GMS', { limit: 5, direction: 'both' });
assert(movers.drivers && movers.drivers.length === 5, `Movers returns 5 drivers (got ${movers.drivers?.length})`);
assert(movers.drivers[0].ctc !== null, 'First mover has CTC value');
// Should be sorted by absolute CTC
const absCTCs = movers.drivers.map(d => Math.abs(d.ctc));
const isSorted = absCTCs.every((v, i) => i === 0 || v <= absCTCs[i - 1]);
assert(isSorted, 'Movers sorted by absolute CTC descending');

// Movers for ALL
const allMovers = loader.getMetricDrivers(WEEK, 'ALL', 'GMS', { limit: 5 });
assert(allMovers.drivers && allMovers.drivers.length === 5, `ALL movers returns 5 (got ${allMovers.drivers?.length})`);

// Movers for Net PPM
const npmMovers = loader.getMetricDrivers(WEEK, 'PC', 'NetPPMLessSD', { limit: 5 });
assert(npmMovers.drivers && npmMovers.drivers.length >= 3, `NPM movers returns ${npmMovers.drivers?.length}`);
assert(npmMovers.drivers[0].mix !== undefined, 'NPM movers include mix/rate decomposition');

// ASIN detail
const asinData = loader.getAsinDetail(WEEK, 'PC', 'GMS', { limit: 10 });
assert(asinData.asins && asinData.asins.length === 10, `ASIN returns 10 (got ${asinData.asins?.length})`);
assert(asinData.asins[0].asin && asinData.asins[0].asin.length === 10, 'ASIN code is 10 chars');
assert(asinData.asins[0].ctc !== null, 'First ASIN has CTC');

// GL list
const gls = loader.listGLs(WEEK);
assert(gls.gls.length === 22, `GL list has 22 entries (ALL + 21 GLs), got ${gls.gls.length}`);
assert(gls.gls[0].name === 'ALL', 'First GL is ALL');
assert(gls.gls[0].metrics.length >= 5, `ALL has ${gls.gls[0].metrics.length} available metrics`);

// Week list
const weeks = loader.listWeeks();
assert(weeks.weeks.length >= 2, `At least 2 weeks available (got ${weeks.weeks.length})`);
assert(weeks.weeks[0] === '2026-wk06', `Latest week is 2026-wk06`);

// Legacy wk05 fallback
const wk05Gls = loader.listGLs('2026-wk05');
assert(wk05Gls.gls.length >= 1, `wk05 has at least 1 GL (got ${wk05Gls.gls.length})`);
const wk05Metrics = loader.getMetricTotals('2026-wk05', 'PC');
const wk05Gms = wk05Metrics.metrics.find(m => m.name === 'gms');
assert(wk05Gms && wk05Gms.value !== '—', `wk05 PC GMS: ${wk05Gms?.value}`);

// Multi-week sparkline
const pcMultiWeek = loader.getMetricTotals(WEEK, 'PC');
const pcGmsSparkline = pcMultiWeek.metrics.find(m => m.name === 'gms');
assert(pcGmsSparkline.sparkline.length >= 2, `PC GMS sparkline has ${pcGmsSparkline.sparkline.length} points (expected >= 2)`);
assert(pcGmsSparkline.sparkline[1] > pcGmsSparkline.sparkline[0], 'PC GMS grew wk05 → wk06');

// Direction filter
const posMovers = loader.getMetricDrivers(WEEK, 'PC', 'GMS', { limit: 5, direction: 'positive' });
assert(posMovers.drivers.every(d => d.ctc >= 0), 'Positive filter: all CTCs >= 0');
const negMovers = loader.getMetricDrivers(WEEK, 'PC', 'GMS', { limit: 5, direction: 'negative' });
assert(negMovers.drivers.every(d => d.ctc <= 0), 'Negative filter: all CTCs <= 0');

// ============================================================================
// 5. Cross-GL Sum Sanity (ALL ≈ sum of GLs for non-ratio metrics)
// ============================================================================
console.log('\n=== 5. Cross-GL Sum Sanity ===');

const allGmsRaw = allMetrics.metrics.find(m => m.name === 'gms').sparkline;
const allGmsTotal = allGmsRaw[allGmsRaw.length - 1];

let sumGLGms = 0;
for (const gl of mapping.glList) {
  const m = loader.getMetricTotals(WEEK, gl);
  const gms = m.metrics.find(x => x.name === 'gms');
  sumGLGms += gms?.sparkline?.[gms.sparkline.length - 1] || 0;
}

// Sum of all GL GMS should approximately equal ALL GMS
// Won't be exact due to shared-code subcats (counted proportionally in each GL)
const gmsDiffPct = Math.abs(sumGLGms - allGmsTotal) / allGmsTotal * 100;
assertClose(gmsDiffPct, 0, 5, `Sum of GL GMS vs ALL GMS (${gmsDiffPct.toFixed(1)}% diff)`);

// ============================================================================
// Summary
// ============================================================================

console.log(`\n${'='.repeat(50)}`);
console.log(`Gap Tests: ${passed} passed, ${failed} failed, ${skipped} skipped`);
console.log(`${'='.repeat(50)}`);

if (failed > 0) process.exit(1);
