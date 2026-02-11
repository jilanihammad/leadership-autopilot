#!/usr/bin/env node
/**
 * Data Accuracy Tests
 * 
 * Cross-references tool outputs against raw Excel column values.
 * These tests catch column-mapping regressions — if someone changes
 * which column getAsinDetail or getMetricDrivers reads, these fail.
 * 
 * Run: node test/data-accuracy.test.js
 * Requires real data in data/weekly/2026-wk05/gl/pc/
 */

const XLSX = require('xlsx');
const path = require('path');
const fs = require('fs');
const tools = require('../tools');

const DATA_DIR = path.join(__dirname, '..', '..', 'data', 'weekly', '2026-wk05', 'gl', 'pc');

// Skip if no real data available
if (!fs.existsSync(DATA_DIR)) {
  console.log('⚠ No real data at ' + DATA_DIR + ' — skipping accuracy tests');
  process.exit(0);
}

let passed = 0;
let failed = 0;
const failures = [];

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed++;
    failures.push({ name, error: err.message });
    console.log(`  ✗ ${name}`);
    console.log(`    → ${err.message}`);
  }
}

function assertEqual(actual, expected, msg) {
  if (actual !== expected) throw new Error(msg || `Expected ${expected}, got ${actual}`);
}

function assertApprox(actual, expected, tol = 0.01, msg) {
  if (Math.abs(actual - expected) > tol) throw new Error(msg || `Expected ~${expected}, got ${actual}`);
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'Assertion failed');
}

// Helper: load raw Excel rows
function loadRaw(filename) {
  const wb = XLSX.readFile(path.join(DATA_DIR, filename));
  return XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: null });
}

// Helper: find data row by code (col 0)
function findRow(rows, code) {
  for (let i = 2; i < rows.length; i++) {
    if (rows[i] && String(rows[i][0]) === String(code)) return rows[i];
  }
  return null;
}

// =============================================================================
// 1. getMetricTotals — verify all metrics against raw Total rows
// =============================================================================
console.log('\n📊 getMetricTotals vs Raw Excel');

const totals = tools.getMetricTotals('2026-wk05', 'pc');

test('GMS total value', () => {
  const raw = loadRaw('GMS_Week 5_ctc_by_SUBCAT.xlsx');
  const totalRow = findRow(raw, 'Total');
  assertApprox(totals.metrics.find(m => m.name === 'gms').sparkline[0], totalRow[2]);
});

test('GMS YoY%', () => {
  const m = totals.metrics.find(m => m.name === 'gms');
  // Raw: 0.6595 → tool: 66.0%
  assertApprox(m.yoy, 66.0, 0.5);
});

test('NetPPM YoY bps', () => {
  const m = totals.metrics.find(m => m.name === 'netppmlesssd');
  assertEqual(m.yoy, -1902);
});

test('CM YoY bps', () => {
  const m = totals.metrics.find(m => m.name === 'cm');
  assertEqual(m.yoy, -1493);
});

test('NetPPM value renders as percentage', () => {
  const m = totals.metrics.find(m => m.name === 'netppmlesssd');
  assertEqual(m.value, '29.9%');
});

// =============================================================================
// 2. getMetricDrivers — verify CTC column for standard + margin metrics
// =============================================================================
console.log('\n📈 getMetricDrivers CTC Column Mapping');

test('GMS drivers use col 8 (YoY CTC bps)', () => {
  const raw = loadRaw('GMS_Week 5_ctc_by_SUBCAT.xlsx');
  const result = tools.getMetricDrivers('2026-wk05', 'pc', 'GMS', { limit: 30 });
  const flashSD = result.drivers.find(d => d.subcat_code === '14700701');
  const rawRow = findRow(raw, '14700701');
  assertEqual(flashSD.ctc, rawRow[8], 'GMS subcat CTC should be col 8 (bps)');
});

test('NetPPM drivers use col 10 (YoY CTC bps)', () => {
  const raw = loadRaw('NetPPMLessSD_Week 5_ctc_by_SUBCAT.xlsx');
  const result = tools.getMetricDrivers('2026-wk05', 'pc', 'NetPPMLessSD', { limit: 30 });
  const microSD = result.drivers.find(d => d.subcat_code === '14700705');
  const rawRow = findRow(raw, '14700705');
  assertEqual(microSD.ctc, rawRow[10], 'NetPPM subcat CTC should be col 10');
});

test('CM drivers use col 10 (YoY CTC bps)', () => {
  const raw = loadRaw('CM_Week 5_ctc_by_SUBCAT.xlsx');
  const result = tools.getMetricDrivers('2026-wk05', 'pc', 'CM', { limit: 30 });
  const monitors = result.drivers.find(d => d.subcat_code === '14700510');
  const rawRow = findRow(raw, '14700510');
  assertEqual(monitors.ctc, rawRow[10], 'CM subcat CTC should be col 10');
});

test('NetPPM drivers WoW/YoY use cols 5/6 (not 3/4)', () => {
  const raw = loadRaw('NetPPMLessSD_Week 5_ctc_by_SUBCAT.xlsx');
  const result = tools.getMetricDrivers('2026-wk05', 'pc', 'NetPPMLessSD', { limit: 30 });
  const mice = result.drivers.find(d => d.subcat_code === '14701002');
  const rawRow = findRow(raw, '14701002');
  assertEqual(mice.wow_pct, rawRow[5], 'NetPPM WoW should be col 5');
  assertEqual(mice.yoy_pct, rawRow[6], 'NetPPM YoY should be col 6');
});

test('GMS drivers WoW/YoY use cols 3/4', () => {
  const raw = loadRaw('GMS_Week 5_ctc_by_SUBCAT.xlsx');
  const result = tools.getMetricDrivers('2026-wk05', 'pc', 'GMS', { limit: 30 });
  const flashSD = result.drivers.find(d => d.subcat_code === '14700701');
  const rawRow = findRow(raw, '14700701');
  assertEqual(flashSD.wow_pct, rawRow[3], 'GMS WoW should be col 3');
  assertEqual(flashSD.yoy_pct, rawRow[4], 'GMS YoY should be col 4');
});

// =============================================================================
// 3. getAsinDetail — verify CTC is bps for ALL metrics
// =============================================================================
console.log('\n🔍 getAsinDetail CTC Column Mapping');

test('GMS ASIN CTC uses col 8 (bps), not col 7 (dollars)', () => {
  const raw = loadRaw('GMS_Week 5_ctc_by_ASIN.xlsx');
  const result = tools.getAsinDetail('2026-wk05', 'pc', 'GMS', { limit: 50 });
  // B08TJZDJ4D: col 7 = 226133.51 ($), col 8 = 1027 (bps)
  const asin = result.asins.find(a => a.asin === 'B08TJZDJ4D');
  const rawRow = findRow(raw, 'B08TJZDJ4D');
  assertEqual(asin.ctc, rawRow[8], 'GMS ASIN CTC should be col 8 (bps), not col 7 (dollars)');
  assert(asin.ctc === 1027, 'B08TJZDJ4D should be 1027 bps, not $226,133');
});

test('ShippedUnits ASIN CTC uses col 8 (bps)', () => {
  const raw = loadRaw('ShippedUnits_Week 5_ctc_by_ASIN.xlsx');
  const result = tools.getAsinDetail('2026-wk05', 'pc', 'ShippedUnits', { limit: 50 });
  const asin = result.asins.find(a => a.asin === 'B08TJZDJ4D');
  const rawRow = findRow(raw, 'B08TJZDJ4D');
  assertEqual(asin.ctc, rawRow[8], 'Units ASIN CTC should be col 8 (bps)');
});

test('NetPPM ASIN CTC uses col 10 (bps)', () => {
  const raw = loadRaw('NetPPMLessSD_Week 5_ctc_by_ASIN.xlsx');
  const result = tools.getAsinDetail('2026-wk05', 'pc', 'NetPPMLessSD', { limit: 50 });
  const asin = result.asins.find(a => a.asin === 'B0DB4Z1LKX');
  const rawRow = findRow(raw, 'B0DB4Z1LKX');
  assertEqual(asin.ctc, rawRow[10], 'NetPPM ASIN CTC should be col 10');
});

test('CM ASIN CTC uses col 10 (bps)', () => {
  const raw = loadRaw('CM_Week 5_ctc_by_ASIN.xlsx');
  const result = tools.getAsinDetail('2026-wk05', 'pc', 'CM', { limit: 50 });
  const asin = result.asins.find(a => a.asin === 'B08TJRVWV1');
  const rawRow = findRow(raw, 'B08TJRVWV1');
  assertEqual(asin.ctc, rawRow[10], 'CM ASIN CTC should be col 10');
});

test('ASP ASIN CTC uses col 10 (dollars — ASP is the exception)', () => {
  const raw = loadRaw('ASP_Week 5_ctc_by_ASIN.xlsx');
  const result = tools.getAsinDetail('2026-wk05', 'pc', 'ASP', { limit: 50 });
  const asin = result.asins.find(a => a.asin === 'B08TJRVWV1');
  const rawRow = findRow(raw, 'B08TJRVWV1');
  assertEqual(asin.ctc, rawRow[10], 'ASP ASIN CTC should be col 10');
});

test('GMS ASIN yoy_delta uses col 4 (YoY %)', () => {
  const raw = loadRaw('GMS_Week 5_ctc_by_ASIN.xlsx');
  const result = tools.getAsinDetail('2026-wk05', 'pc', 'GMS', { limit: 50 });
  const asin = result.asins.find(a => a.asin === 'B08TJZDJ4D');
  const rawRow = findRow(raw, 'B08TJZDJ4D');
  assertEqual(asin.yoy_delta, rawRow[4], 'GMS ASIN yoy_delta should be col 4');
});

test('NetPPM ASIN yoy_delta uses col 6 (YoY bps)', () => {
  const raw = loadRaw('NetPPMLessSD_Week 5_ctc_by_ASIN.xlsx');
  const result = tools.getAsinDetail('2026-wk05', 'pc', 'NetPPMLessSD', { limit: 50 });
  const asin = result.asins.find(a => a.asin === 'B0DB4Z1LKX');
  const rawRow = findRow(raw, 'B0DB4Z1LKX');
  assertEqual(asin.yoy_delta, rawRow[6], 'NetPPM ASIN yoy_delta should be col 6');
});

// =============================================================================
// 4. getSubcatDetail — verify margin layout fields
// =============================================================================
console.log('\n📋 getSubcatDetail Layout Verification');

test('Standard metric returns standard fields', () => {
  const result = tools.getSubcatDetail('2026-wk05', 'pc', 'GMS', '14700701');
  assert(!result.isMarginMetric, 'GMS should not be margin metric');
  const s = result.subcat;
  assert(s.wow_pct !== undefined, 'Should have wow_pct');
  assert(s.yoy_ctc_bps !== undefined, 'Should have yoy_ctc_bps');
  assert(s.yoy_mix_bps === undefined, 'Should NOT have mix/rate for standard');
});

test('Margin metric returns mix/rate decomposition', () => {
  const result = tools.getSubcatDetail('2026-wk05', 'pc', 'NetPPMLessSD', '14701002');
  assert(result.isMarginMetric, 'NetPPM should be margin metric');
  const s = result.subcat;
  assert(s.yoy_ctc_bps !== undefined, 'Should have yoy_ctc_bps');
  assert(s.yoy_mix_bps !== undefined, 'Should have yoy_mix_bps');
  assert(s.yoy_rate_bps !== undefined, 'Should have yoy_rate_bps');
});

test('Margin subcat detail matches raw columns', () => {
  const raw = loadRaw('NetPPMLessSD_Week 5_ctc_by_SUBCAT.xlsx');
  const rawRow = findRow(raw, '14701002'); // Mice
  const result = tools.getSubcatDetail('2026-wk05', 'pc', 'NetPPMLessSD', '14701002');
  const s = result.subcat;
  assertEqual(s.wow_pct, rawRow[5], 'WoW should be col 5');
  assertEqual(s.yoy_pct, rawRow[6], 'YoY should be col 6');
  assertEqual(s.yoy_ctc_bps, rawRow[10], 'YoY CTC should be col 10');
  assertEqual(s.yoy_mix_bps, rawRow[11], 'YoY Mix should be col 11');
  assertEqual(s.yoy_rate_bps, rawRow[12], 'YoY Rate should be col 12');
});

// =============================================================================
// 5. Layout detection
// =============================================================================
console.log('\n🔧 Layout Detection');

test('GMS detected as standard (9 cols)', () => {
  const raw = loadRaw('GMS_Week 5_ctc_by_SUBCAT.xlsx');
  const layout = tools.detectFileLayout(raw);
  assert(layout.valid, 'Should be valid');
  assertEqual(layout.layout, 'standard');
});

test('NetPPM detected as margin (13 cols)', () => {
  const raw = loadRaw('NetPPMLessSD_Week 5_ctc_by_SUBCAT.xlsx');
  const layout = tools.detectFileLayout(raw);
  assert(layout.valid, 'Should be valid');
  assertEqual(layout.layout, 'margin');
});

test('ASIN files also have correct layout', () => {
  const rawGms = loadRaw('GMS_Week 5_ctc_by_ASIN.xlsx');
  assertEqual(tools.detectFileLayout(rawGms).layout, 'standard');
  const rawNpm = loadRaw('NetPPMLessSD_Week 5_ctc_by_ASIN.xlsx');
  assertEqual(tools.detectFileLayout(rawNpm).layout, 'margin');
});

// =============================================================================
// 6. bps conversion consistency
// =============================================================================
console.log('\n🔄 bps Conversion Consistency');

test('getAllSubcatData and searchSubcats agree on bps values', () => {
  const all = tools.getAllSubcatData('2026-wk05', 'pc');
  const search = tools.searchSubcats('2026-wk05', 'pc', 'Mice');
  
  const allMice = all.subcats.find(s => s.code === '14701002');
  const searchMice = search.results.find(r => r.code === '14701002');
  
  assertApprox(
    allMice.metrics.NetPPMLessSD.yoy_pct,
    searchMice.metrics.NetPPMLessSD.yoy_pct,
    0.0001,
    'bps conversion should be consistent'
  );
});

test('Margin bps values round-trip correctly', () => {
  // Raw NetPPM YoY for Mice = -437 bps
  // getAllSubcatData divides by 10000 → -0.0437
  // buildContext multiplies by 10000 → -437 (back to bps)
  const all = tools.getAllSubcatData('2026-wk05', 'pc');
  const mice = all.subcats.find(s => s.code === '14701002');
  const yoyDecimal = mice.metrics.NetPPMLessSD.yoy_pct;
  const roundTripped = Math.round(yoyDecimal * 10000);
  assertEqual(roundTripped, -437, 'bps should round-trip: -437 → -0.0437 → -437');
});

// =============================================================================
// 7. Sort ordering
// =============================================================================
console.log('\n📉 Sort Ordering');

test('ASIN results sorted by absolute CTC descending', () => {
  const result = tools.getAsinDetail('2026-wk05', 'pc', 'NetPPMLessSD', { limit: 25 });
  for (let i = 1; i < result.asins.length; i++) {
    assert(
      Math.abs(result.asins[i].ctc) <= Math.abs(result.asins[i - 1].ctc),
      `Sort broken at position ${i}: |${result.asins[i].ctc}| > |${result.asins[i - 1].ctc}|`
    );
  }
});

test('Subcat drivers sorted by absolute CTC descending', () => {
  const result = tools.getMetricDrivers('2026-wk05', 'pc', 'GMS', { limit: 30 });
  for (let i = 1; i < result.drivers.length; i++) {
    assert(
      Math.abs(result.drivers[i].ctc) <= Math.abs(result.drivers[i - 1].ctc),
      `Sort broken at position ${i}`
    );
  }
});

// =============================================================================
// 8. GL detection (including plurals)
// =============================================================================
console.log('\n🌐 GL Detection');

// Need AnalysisSession — load server without binding port
const express = require('express');
express.application.listen = function() {};
const { AnalysisSession } = require('../server');
const session = new AnalysisSession('test');

const glTests = [
  // Tier 1: explicit GL names
  ['what happened in the PC GL', 'pc'],
  ['tell me about toys', 'toys'],
  ['consumer electronics summary', 'ce'],
  // Tier 2: product keywords (singular)
  ['how is the laptop category', 'pc'],
  ['tell me about lego', 'toys'],
  ['how are earbuds doing', 'ce'],
  // Tier 2: product keywords (plural — regression test)
  ['how are monitors doing', 'pc'],
  ['tell me about keyboards', 'pc'],
  ['what about headphones', 'ce'],
  ['how are tvs performing', 'ce'],
  ['tell me about puzzles', 'toys'],
  // Tier 3: ambiguous
  ['what about speakers', 'pc'],
  ['how are cables performing', 'pc'],
  // No match
  ['why is margin down', null],
  ['tell me about this week', null],
];

for (const [q, expected] of glTests) {
  test(`detectGL("${q}") → ${expected || 'null'}`, () => {
    assertEqual(session.detectGL(q), expected);
  });
}

// =============================================================================
// 9. detectQuestionMetrics
// =============================================================================
console.log('\n🎯 Question Metric Detection');

const metricTests = [
  ['why is net ppm down', ['NetPPMLessSD']],
  ['what drove GMS', ['GMS']],
  ['tell me about CM', ['CM']],
  ['units and margin', ['ShippedUnits', 'NetPPMLessSD']],
  ['what about OOS', ['SOROOS_PROCURABLE_PRODUCT_OOS_GV_PCT']],
  ['what is happening', ['GMS']], // default
];

for (const [q, expected] of metricTests) {
  test(`detectQuestionMetrics("${q}")`, () => {
    const result = session.detectQuestionMetrics(q.toLowerCase());
    const resultSet = new Set(result);
    assertEqual(result.length, expected.length, `Expected ${expected.length} metrics, got ${result.length}: [${result}]`);
    for (const e of expected) {
      assert(resultSet.has(e), `Missing expected metric: ${e}. Got: [${result}]`);
    }
  });
}

// =============================================================================
// SUMMARY
// =============================================================================
console.log('\n' + '='.repeat(50));
console.log(`\n📋 Accuracy Tests: ${passed} passed, ${failed} failed\n`);

if (failed > 0) {
  console.log('Failed tests:');
  failures.forEach(f => console.log(`  • ${f.name}: ${f.error}`));
  process.exit(1);
} else {
  console.log('All accuracy tests passed! ✓\n');
  process.exit(0);
}
