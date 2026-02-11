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
  // Tier 1: explicit GL names (now return full names from mapping)
  ['what happened in the PC GL', 'PC'],
  ['tell me about toys', 'Toys'],
  ['consumer electronics summary', 'Electronics'],
  // Tier 2: product keywords (singular)
  ['how is the laptop category', 'PC'],
  ['tell me about lego', 'Toys'],
  ['how are earbuds doing', 'Electronics'],
  // Tier 2: product keywords (plural — regression test)
  ['how are monitors doing', 'PC'],
  ['tell me about keyboards', 'PC'],
  ['what about headphones', 'Electronics'],
  ['how are tvs performing', 'Electronics'],
  ['tell me about puzzles', 'Toys'],
  // Tier 3: ambiguous — removed since v2 server dropped tier 3 in favor of mapping-based detection
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
// 10. WoW Period — getMetricDrivers
// =============================================================================
console.log('\n⏪ WoW Period — getMetricDrivers');

test('GMS WoW CTC uses col 6 (bps), not col 5 ($) or col 8 (YoY)', () => {
  const raw = loadRaw('GMS_Week 5_ctc_by_SUBCAT.xlsx');
  const result = tools.getMetricDrivers('2026-wk05', 'pc', 'GMS', { limit: 30, period: 'wow' });
  const flashSD = result.drivers.find(d => d.subcat_code === '14700701');
  const rawRow = findRow(raw, '14700701');
  assertEqual(flashSD.ctc, rawRow[6], 'GMS WoW CTC should be col 6 (bps)');
  assert(flashSD.ctc !== rawRow[5], 'Should NOT be col 5 (dollars)');
  assert(flashSD.ctc !== rawRow[8], 'Should NOT be col 8 (YoY bps)');
});

test('ShippedUnits WoW CTC uses col 6 (bps)', () => {
  const raw = loadRaw('ShippedUnits_Week 5_ctc_by_SUBCAT.xlsx');
  const result = tools.getMetricDrivers('2026-wk05', 'pc', 'ShippedUnits', { limit: 30, period: 'wow' });
  const flashSD = result.drivers.find(d => d.subcat_code === '14700701');
  const rawRow = findRow(raw, '14700701');
  assertEqual(flashSD.ctc, rawRow[6], 'Units WoW CTC should be col 6 (bps)');
});

test('NetPPM WoW CTC uses col 7 (margin), not col 10 (YoY)', () => {
  const raw = loadRaw('NetPPMLessSD_Week 5_ctc_by_SUBCAT.xlsx');
  const result = tools.getMetricDrivers('2026-wk05', 'pc', 'NetPPMLessSD', { limit: 30, period: 'wow' });
  const microSD = result.drivers.find(d => d.subcat_code === '14700705');
  const rawRow = findRow(raw, '14700705');
  assertEqual(microSD.ctc, rawRow[7], 'NetPPM WoW CTC should be col 7');
  assert(microSD.ctc !== rawRow[10], 'Should NOT be col 10 (YoY CTC)');
});

test('CM WoW CTC uses col 7 (margin)', () => {
  const raw = loadRaw('CM_Week 5_ctc_by_SUBCAT.xlsx');
  const result = tools.getMetricDrivers('2026-wk05', 'pc', 'CM', { limit: 30, period: 'wow' });
  const monitors = result.drivers.find(d => d.subcat_code === '14700510');
  const rawRow = findRow(raw, '14700510');
  assertEqual(monitors.ctc, rawRow[7], 'CM WoW CTC should be col 7');
});

test('SOROOS WoW CTC uses col 7 (margin)', () => {
  const raw = loadRaw('SOROOS_PROCURABLE_PRODUCT_OOS_GV_PCT_Week 5_ctc_by_SUBCAT.xlsx');
  const result = tools.getMetricDrivers('2026-wk05', 'pc', 'SOROOS_PROCURABLE_PRODUCT_OOS_GV_PCT', { limit: 30, period: 'wow' });
  const top = result.drivers[0];
  const rawRow = findRow(raw, top.subcat_code);
  assertEqual(top.ctc, rawRow[7], 'SOROOS WoW CTC should be col 7');
});

test('ASP WoW CTC uses col 7 (dollar, margin layout)', () => {
  const raw = loadRaw('ASP_Week 5_ctc_by_SUBCAT.xlsx');
  const result = tools.getMetricDrivers('2026-wk05', 'pc', 'ASP', { limit: 30, period: 'wow' });
  const top = result.drivers[0];
  const rawRow = findRow(raw, top.subcat_code);
  assertEqual(top.ctc, rawRow[7], 'ASP WoW CTC should be col 7');
});

// =============================================================================
// 11. WoW Period — getAsinDetail
// =============================================================================
console.log('\n⏪ WoW Period — getAsinDetail');

test('GMS ASIN WoW CTC uses col 6 (bps), not col 5 ($)', () => {
  const raw = loadRaw('GMS_Week 5_ctc_by_ASIN.xlsx');
  const result = tools.getAsinDetail('2026-wk05', 'pc', 'GMS', { limit: 10, period: 'wow' });
  const top = result.asins[0];
  const rawRow = findRow(raw, top.asin);
  assertEqual(top.ctc, rawRow[6], 'GMS ASIN WoW CTC should be col 6 (bps)');
  assert(top.ctc !== rawRow[5], 'Should NOT be col 5 (dollars)');
});

test('ShippedUnits ASIN WoW CTC uses col 6 (bps)', () => {
  const raw = loadRaw('ShippedUnits_Week 5_ctc_by_ASIN.xlsx');
  const result = tools.getAsinDetail('2026-wk05', 'pc', 'ShippedUnits', { limit: 10, period: 'wow' });
  const top = result.asins[0];
  const rawRow = findRow(raw, top.asin);
  assertEqual(top.ctc, rawRow[6], 'Units ASIN WoW CTC should be col 6 (bps)');
});

test('NetPPM ASIN WoW CTC uses col 7 (margin)', () => {
  const raw = loadRaw('NetPPMLessSD_Week 5_ctc_by_ASIN.xlsx');
  const result = tools.getAsinDetail('2026-wk05', 'pc', 'NetPPMLessSD', { limit: 10, period: 'wow' });
  const top = result.asins[0];
  const rawRow = findRow(raw, top.asin);
  assertEqual(top.ctc, rawRow[7], 'NetPPM ASIN WoW CTC should be col 7');
});

test('CM ASIN WoW CTC uses col 7 (margin)', () => {
  const raw = loadRaw('CM_Week 5_ctc_by_ASIN.xlsx');
  const result = tools.getAsinDetail('2026-wk05', 'pc', 'CM', { limit: 10, period: 'wow' });
  const top = result.asins[0];
  const rawRow = findRow(raw, top.asin);
  assertEqual(top.ctc, rawRow[7], 'CM ASIN WoW CTC should be col 7');
});

test('SOROOS ASIN WoW CTC uses col 7 (margin)', () => {
  const raw = loadRaw('SOROOS_PROCURABLE_PRODUCT_OOS_GV_PCT_Week 5_ctc_by_ASIN.xlsx');
  const result = tools.getAsinDetail('2026-wk05', 'pc', 'SOROOS_PROCURABLE_PRODUCT_OOS_GV_PCT', { limit: 10, period: 'wow' });
  const top = result.asins[0];
  const rawRow = findRow(raw, top.asin);
  assertEqual(top.ctc, rawRow[7], 'SOROOS ASIN WoW CTC should be col 7');
});

test('ASP ASIN WoW CTC uses col 7 (dollar, margin layout)', () => {
  const raw = loadRaw('ASP_Week 5_ctc_by_ASIN.xlsx');
  const result = tools.getAsinDetail('2026-wk05', 'pc', 'ASP', { limit: 10, period: 'wow' });
  const top = result.asins[0];
  const rawRow = findRow(raw, top.asin);
  assertEqual(top.ctc, rawRow[7], 'ASP ASIN WoW CTC should be col 7');
});

// =============================================================================
// 12. Missing Metric Coverage — getMetricDrivers
// =============================================================================
console.log('\n📊 Missing Metric Coverage — getMetricDrivers');

test('ShippedUnits YoY CTC uses col 8 (bps)', () => {
  const raw = loadRaw('ShippedUnits_Week 5_ctc_by_SUBCAT.xlsx');
  const result = tools.getMetricDrivers('2026-wk05', 'pc', 'ShippedUnits', { limit: 30 });
  const top = result.drivers[0];
  const rawRow = findRow(raw, top.subcat_code);
  assertEqual(top.ctc, rawRow[8], 'Units subcat CTC should be col 8 (bps)');
  assert(top.ctc !== rawRow[7], 'Should NOT be col 7 (raw units)');
});

test('ASP YoY CTC uses col 10 (dollar)', () => {
  const raw = loadRaw('ASP_Week 5_ctc_by_SUBCAT.xlsx');
  const result = tools.getMetricDrivers('2026-wk05', 'pc', 'ASP', { limit: 30 });
  const top = result.drivers[0];
  const rawRow = findRow(raw, top.subcat_code);
  assertEqual(top.ctc, rawRow[10], 'ASP subcat CTC should be col 10');
});

test('SOROOS YoY CTC uses col 10 (bps)', () => {
  const raw = loadRaw('SOROOS_PROCURABLE_PRODUCT_OOS_GV_PCT_Week 5_ctc_by_SUBCAT.xlsx');
  const result = tools.getMetricDrivers('2026-wk05', 'pc', 'SOROOS_PROCURABLE_PRODUCT_OOS_GV_PCT', { limit: 30 });
  const top = result.drivers[0];
  const rawRow = findRow(raw, top.subcat_code);
  assertEqual(top.ctc, rawRow[10], 'SOROOS subcat CTC should be col 10');
  assert(top.ctc !== rawRow[12], 'Should NOT be col 12 (Rate)');
});

test('SOROOS ASIN YoY CTC uses col 10 (bps)', () => {
  const raw = loadRaw('SOROOS_PROCURABLE_PRODUCT_OOS_GV_PCT_Week 5_ctc_by_ASIN.xlsx');
  const result = tools.getAsinDetail('2026-wk05', 'pc', 'SOROOS_PROCURABLE_PRODUCT_OOS_GV_PCT', { limit: 10 });
  const top = result.asins[0];
  const rawRow = findRow(raw, top.asin);
  assertEqual(top.ctc, rawRow[10], 'SOROOS ASIN CTC should be col 10');
});

// =============================================================================
// 13. getMetricTotals — remaining metrics
// =============================================================================
console.log('\n📊 getMetricTotals — Full Coverage');

test('Units total value matches raw', () => {
  const raw = loadRaw('ShippedUnits_Week 5_ctc_by_SUBCAT.xlsx');
  const totalRow = findRow(raw, 'Total');
  const m = totals.metrics.find(m => m.name === 'shippedunits');
  assertEqual(m.sparkline[0], totalRow[2]);
});

test('Units WoW% matches raw col 3', () => {
  const raw = loadRaw('ShippedUnits_Week 5_ctc_by_SUBCAT.xlsx');
  const totalRow = findRow(raw, 'Total');
  const m = totals.metrics.find(m => m.name === 'shippedunits');
  assertApprox(m.wow, totalRow[3] * 100, 0.5);
});

test('ASP total value matches raw', () => {
  const raw = loadRaw('ASP_Week 5_ctc_by_SUBCAT.xlsx');
  const totalRow = findRow(raw, 'Total');
  const m = totals.metrics.find(m => m.name === 'asp');
  assertApprox(m.sparkline[0], totalRow[2], 0.01);
});

test('ASP WoW% matches raw col 5 (margin layout)', () => {
  const raw = loadRaw('ASP_Week 5_ctc_by_SUBCAT.xlsx');
  const totalRow = findRow(raw, 'Total');
  const m = totals.metrics.find(m => m.name === 'asp');
  // ASP WoW is in col 5, multiplied by 100 for display
  assertApprox(m.wow, totalRow[5] * 100, 0.5);
});

test('ASP YoY% matches raw col 6 (margin layout)', () => {
  const raw = loadRaw('ASP_Week 5_ctc_by_SUBCAT.xlsx');
  const totalRow = findRow(raw, 'Total');
  const m = totals.metrics.find(m => m.name === 'asp');
  assertApprox(m.yoy, totalRow[6] * 100, 0.5);
});

test('NetPPM WoW bps matches raw col 5', () => {
  const raw = loadRaw('NetPPMLessSD_Week 5_ctc_by_SUBCAT.xlsx');
  const totalRow = findRow(raw, 'Total');
  const m = totals.metrics.find(m => m.name === 'netppmlesssd');
  assertEqual(m.wow, Math.round(totalRow[5]));
});

test('CM value renders as percentage', () => {
  const m = totals.metrics.find(m => m.name === 'cm');
  assertEqual(m.value, '-3.9%');
});

test('GMS WoW% matches raw col 3', () => {
  const raw = loadRaw('GMS_Week 5_ctc_by_SUBCAT.xlsx');
  const totalRow = findRow(raw, 'Total');
  const m = totals.metrics.find(m => m.name === 'gms');
  assertApprox(m.wow, totalRow[3] * 100, 0.5);
});

// =============================================================================
// 14. getAllSubcatData — raw accuracy (not just consistency)
// =============================================================================
console.log('\n📦 getAllSubcatData Raw Accuracy');

const allData = tools.getAllSubcatData('2026-wk05', 'pc');

test('GMS value matches raw col 2', () => {
  const raw = loadRaw('GMS_Week 5_ctc_by_SUBCAT.xlsx');
  const rawRow = findRow(raw, '14700701'); // Flash Memory SD
  const subcat = allData.subcats.find(s => s.code === '14700701');
  assertEqual(subcat.metrics.GMS.value, rawRow[2]);
});

test('GMS yoy_ctc_bps matches raw col 8', () => {
  const raw = loadRaw('GMS_Week 5_ctc_by_SUBCAT.xlsx');
  const rawRow = findRow(raw, '14700701');
  const subcat = allData.subcats.find(s => s.code === '14700701');
  assertEqual(subcat.metrics.GMS.yoy_ctc_bps, rawRow[8]);
});

test('GMS yoy_pct matches raw col 4 (no conversion)', () => {
  const raw = loadRaw('GMS_Week 5_ctc_by_SUBCAT.xlsx');
  const rawRow = findRow(raw, '14700701');
  const subcat = allData.subcats.find(s => s.code === '14700701');
  assertEqual(subcat.metrics.GMS.yoy_pct, rawRow[4]);
});

test('NetPPM yoy_ctc_bps matches raw col 10 (no conversion)', () => {
  const raw = loadRaw('NetPPMLessSD_Week 5_ctc_by_SUBCAT.xlsx');
  const rawRow = findRow(raw, '14700705'); // Flash Memory microSD
  const subcat = allData.subcats.find(s => s.code === '14700705');
  assertEqual(subcat.metrics.NetPPMLessSD.yoy_ctc_bps, rawRow[10]);
});

test('NetPPM yoy_pct = raw col 6 / 10000 (bps conversion)', () => {
  const raw = loadRaw('NetPPMLessSD_Week 5_ctc_by_SUBCAT.xlsx');
  const rawRow = findRow(raw, '14700705');
  const subcat = allData.subcats.find(s => s.code === '14700705');
  assertApprox(subcat.metrics.NetPPMLessSD.yoy_pct, rawRow[6] / 10000, 0.0001);
});

test('ASP yoy_ctc is raw col 10 (dollar, NO bps conversion)', () => {
  const raw = loadRaw('ASP_Week 5_ctc_by_SUBCAT.xlsx');
  const rawRow = findRow(raw, '14700510'); // LCD Monitors
  const subcat = allData.subcats.find(s => s.code === '14700510');
  assertEqual(subcat.metrics.ASP.yoy_ctc, rawRow[10], 'ASP CTC should be raw col 10, not divided by 10000');
});

test('ShippedUnits value matches raw col 2', () => {
  const raw = loadRaw('ShippedUnits_Week 5_ctc_by_SUBCAT.xlsx');
  const rawRow = findRow(raw, '14700701');
  const subcat = allData.subcats.find(s => s.code === '14700701');
  assertEqual(subcat.metrics.ShippedUnits.value, rawRow[2]);
});

test('CM yoy_ctc_bps matches raw col 10', () => {
  const raw = loadRaw('CM_Week 5_ctc_by_SUBCAT.xlsx');
  const rawRow = findRow(raw, '14700510');
  const subcat = allData.subcats.find(s => s.code === '14700510');
  assertEqual(subcat.metrics.CM.yoy_ctc_bps, rawRow[10]);
});

// =============================================================================
// 15. getSubcatDetail — WoW CTC mapping + SOROOS/ASP
// =============================================================================
console.log('\n📋 getSubcatDetail — WoW CTC + Missing Metrics');

test('Standard subcat WoW CTC = raw col 5 ($)', () => {
  const raw = loadRaw('GMS_Week 5_ctc_by_SUBCAT.xlsx');
  const rawRow = findRow(raw, '14700701');
  const result = tools.getSubcatDetail('2026-wk05', 'pc', 'GMS', '14700701');
  assertEqual(result.subcat.wow_ctc, rawRow[5], 'GMS WoW CTC($) should be col 5');
});

test('Standard subcat WoW CTC bps = raw col 6', () => {
  const raw = loadRaw('GMS_Week 5_ctc_by_SUBCAT.xlsx');
  const rawRow = findRow(raw, '14700701');
  const result = tools.getSubcatDetail('2026-wk05', 'pc', 'GMS', '14700701');
  assertEqual(result.subcat.wow_ctc_bps, rawRow[6], 'GMS WoW CTC(bps) should be col 6');
});

test('Margin subcat WoW CTC = raw col 7', () => {
  const raw = loadRaw('NetPPMLessSD_Week 5_ctc_by_SUBCAT.xlsx');
  const rawRow = findRow(raw, '14701002');
  const result = tools.getSubcatDetail('2026-wk05', 'pc', 'NetPPMLessSD', '14701002');
  assertEqual(result.subcat.wow_ctc_bps, rawRow[7], 'NetPPM WoW CTC should be col 7');
});

test('SOROOS subcat full field mapping', () => {
  const raw = loadRaw('SOROOS_PROCURABLE_PRODUCT_OOS_GV_PCT_Week 5_ctc_by_SUBCAT.xlsx');
  // Find a subcat that exists
  const result = tools.getMetricDrivers('2026-wk05', 'pc', 'SOROOS_PROCURABLE_PRODUCT_OOS_GV_PCT', { limit: 1 });
  const code = result.drivers[0].subcat_code;
  const rawRow = findRow(raw, code);
  const detail = tools.getSubcatDetail('2026-wk05', 'pc', 'SOROOS_PROCURABLE_PRODUCT_OOS_GV_PCT', code);
  const s = detail.subcat;
  assertEqual(s.value, rawRow[2], 'Value should be col 2');
  assertEqual(s.wow_pct, rawRow[5], 'WoW should be col 5');
  assertEqual(s.yoy_pct, rawRow[6], 'YoY should be col 6');
  assertEqual(s.wow_ctc_bps, rawRow[7], 'WoW CTC should be col 7');
  assertEqual(s.yoy_ctc_bps, rawRow[10], 'YoY CTC should be col 10');
});

test('ASP subcat full field mapping', () => {
  const raw = loadRaw('ASP_Week 5_ctc_by_SUBCAT.xlsx');
  const result = tools.getMetricDrivers('2026-wk05', 'pc', 'ASP', { limit: 1 });
  const code = result.drivers[0].subcat_code;
  const rawRow = findRow(raw, code);
  const detail = tools.getSubcatDetail('2026-wk05', 'pc', 'ASP', code);
  const s = detail.subcat;
  assertEqual(s.value, rawRow[2], 'Value should be col 2');
  assertEqual(s.wow_pct, rawRow[5], 'WoW should be col 5');
  assertEqual(s.yoy_pct, rawRow[6], 'YoY should be col 6');
  assertEqual(s.wow_ctc_bps, rawRow[7], 'WoW CTC should be col 7');
  assertEqual(s.yoy_ctc_bps, rawRow[10], 'YoY CTC should be col 10');
  assertEqual(s.yoy_mix_bps, rawRow[11], 'YoY Mix should be col 11');
  assertEqual(s.yoy_rate_bps, rawRow[12], 'YoY Rate should be col 12');
});

// =============================================================================
// 16. searchSubcats — raw accuracy
// =============================================================================
console.log('\n🔎 searchSubcats Raw Accuracy');

test('searchSubcats GMS fields match raw columns', () => {
  const raw = loadRaw('GMS_Week 5_ctc_by_SUBCAT.xlsx');
  const rawRow = findRow(raw, '14701002'); // Mice
  const search = tools.searchSubcats('2026-wk05', 'pc', 'Mice');
  const mice = search.results.find(r => r.code === '14701002');
  assertEqual(mice.metrics.GMS.value, rawRow[2], 'GMS value should be col 2');
  assertEqual(mice.metrics.GMS.wow_pct, rawRow[3], 'GMS WoW should be col 3');
  assertEqual(mice.metrics.GMS.yoy_pct, rawRow[4], 'GMS YoY should be col 4');
  assertEqual(mice.metrics.GMS.yoy_ctc_bps, rawRow[8], 'GMS CTC should be col 8');
});

test('searchSubcats NetPPM fields match raw columns (with bps conversion)', () => {
  const raw = loadRaw('NetPPMLessSD_Week 5_ctc_by_SUBCAT.xlsx');
  const rawRow = findRow(raw, '14701002'); // Mice
  const search = tools.searchSubcats('2026-wk05', 'pc', 'Mice');
  const mice = search.results.find(r => r.code === '14701002');
  assertEqual(mice.metrics.NetPPMLessSD.value, rawRow[2], 'NetPPM value should be col 2 (raw)');
  assertApprox(mice.metrics.NetPPMLessSD.wow_pct, rawRow[5] / 10000, 0.0001, 'WoW should be col 5 / 10000');
  assertApprox(mice.metrics.NetPPMLessSD.yoy_pct, rawRow[6] / 10000, 0.0001, 'YoY should be col 6 / 10000');
  assertEqual(mice.metrics.NetPPMLessSD.yoy_ctc_bps, rawRow[10], 'CTC should be col 10 (raw, not converted)');
});

test('searchSubcats ASP CTC is raw col 10 (dollar, not bps-converted)', () => {
  const raw = loadRaw('ASP_Week 5_ctc_by_SUBCAT.xlsx');
  const rawRow = findRow(raw, '14701002'); // Mice
  const search = tools.searchSubcats('2026-wk05', 'pc', 'Mice');
  const mice = search.results.find(r => r.code === '14701002');
  assertEqual(mice.metrics.ASP.yoy_ctc, rawRow[10], 'ASP CTC should be col 10 (raw dollar)');
});

// =============================================================================
// 17. Direction filter
// =============================================================================
console.log('\n🔀 Direction Filter');

test('direction=negative only returns negative CTC', () => {
  const result = tools.getMetricDrivers('2026-wk05', 'pc', 'NetPPMLessSD', { limit: 30, direction: 'negative' });
  for (const d of result.drivers) {
    assert(d.ctc < 0, `direction=negative should only return ctc < 0, got ${d.ctc} for ${d.subcat_name}`);
  }
});

test('direction=positive only returns positive CTC', () => {
  const result = tools.getMetricDrivers('2026-wk05', 'pc', 'GMS', { limit: 30, direction: 'positive' });
  for (const d of result.drivers) {
    assert(d.ctc > 0, `direction=positive should only return ctc > 0, got ${d.ctc} for ${d.subcat_name}`);
  }
});

// =============================================================================
// 18. buildContext Rendering (v2 server format)
// =============================================================================
console.log('\n🖥️  buildContext Rendering');

test('buildContext renders GMS driver table for PC', () => {
  const ctx = session.buildContext('2026-wk05', 'PC', 'overview', {
    allSubcats: true, asin: false,
  });
  // v2 renders per-metric driver tables
  assert(ctx.includes('GMS Subcategory Drivers'), 'Should have GMS drivers section');
  const line = ctx.split('\n').find(l => l.includes('LCD Monitors') && l.includes('|'));
  assert(line, 'LCD Monitors should appear in driver table');
});

test('buildContext renders metric totals for PC', () => {
  const ctx = session.buildContext('2026-wk05', 'PC', 'overview', {
    allSubcats: true, asin: false,
  });
  assert(ctx.includes('Metric Totals'), 'Should have metric totals section');
  assert(ctx.includes('GMS'), 'Should include GMS metric');
});

test('buildContext renders ASIN tables with CTC headers', () => {
  const ctx = session.buildContext('2026-wk05', 'PC', 'GMS ASINs', {
    allSubcats: true, asin: true, asinMetrics: ['GMS'],
  });
  // ASIN tables should have CTC columns
  const header = ctx.split('\n').find(l => l.includes('ASIN') && l.includes('CTC'));
  assert(header, 'ASIN table should have CTC header');
});

test('buildContext ASP ASIN CTC in dollars', () => {
  const ctx = session.buildContext('2026-wk05', 'PC', 'ASP ASINs', {
    allSubcats: true, asin: true, asinMetrics: ['ASP'],
  });
  const header = ctx.split('\n').find(l => l.includes('CTC') && l.includes('$'));
  assert(header, 'ASP ASIN CTC header should indicate dollars');
});

test('buildContext includes GL-wide ASIN note', () => {
  const ctx = session.buildContext('2026-wk05', 'PC', 'GMS ASINs', {
    allSubcats: true, asin: true, asinMetrics: ['GMS'],
  });
  assert(ctx.includes('GL-wide') || ctx.includes('ranked'), 'ASIN context should include ranking note');
});

// =============================================================================
// 19. Cross-Function Parity
// =============================================================================
console.log('\n🔗 Cross-Function Parity');

test('getMetricDrivers total matches getMetricTotals for GMS', () => {
  const drivers = tools.getMetricDrivers('2026-wk05', 'pc', 'GMS', { limit: 1 });
  const totalsGms = totals.metrics.find(m => m.name === 'gms');
  assertApprox(drivers.total.value, totalsGms.sparkline[0], 0.01, 'GMS total value should match');
});

test('getMetricDrivers total matches getMetricTotals for NetPPM', () => {
  const drivers = tools.getMetricDrivers('2026-wk05', 'pc', 'NetPPMLessSD', { limit: 1 });
  const totalsNpm = totals.metrics.find(m => m.name === 'netppmlesssd');
  assertApprox(drivers.total.value, totalsNpm.sparkline[0], 0.0001, 'NetPPM total value should match');
});

test('getMetricDrivers CTC == getAllSubcatData CTC for same subcat (GMS)', () => {
  const drivers = tools.getMetricDrivers('2026-wk05', 'pc', 'GMS', { limit: 30 });
  const flashSD_driver = drivers.drivers.find(d => d.subcat_code === '14700701');
  const flashSD_all = allData.subcats.find(s => s.code === '14700701');
  assertEqual(flashSD_driver.ctc, flashSD_all.metrics.GMS.yoy_ctc_bps, 'CTC should match between functions');
});

test('getMetricDrivers CTC == getAllSubcatData CTC for same subcat (NetPPM)', () => {
  const drivers = tools.getMetricDrivers('2026-wk05', 'pc', 'NetPPMLessSD', { limit: 30 });
  const microSD_driver = drivers.drivers.find(d => d.subcat_code === '14700705');
  const microSD_all = allData.subcats.find(s => s.code === '14700705');
  assertEqual(microSD_driver.ctc, microSD_all.metrics.NetPPMLessSD.yoy_ctc_bps, 'CTC should match between functions');
});

test('getSubcatDetail CTC == getMetricDrivers CTC (NetPPM, Mice)', () => {
  const drivers = tools.getMetricDrivers('2026-wk05', 'pc', 'NetPPMLessSD', { limit: 30 });
  const mice_driver = drivers.drivers.find(d => d.subcat_code === '14701002');
  const detail = tools.getSubcatDetail('2026-wk05', 'pc', 'NetPPMLessSD', '14701002');
  assertEqual(mice_driver.ctc, detail.subcat.yoy_ctc_bps, 'CTC should match between getMetricDrivers and getSubcatDetail');
});

test('getSubcatDetail CTC == getMetricDrivers CTC (GMS, Flash SD)', () => {
  const drivers = tools.getMetricDrivers('2026-wk05', 'pc', 'GMS', { limit: 30 });
  const flashSD_driver = drivers.drivers.find(d => d.subcat_code === '14700701');
  const detail = tools.getSubcatDetail('2026-wk05', 'pc', 'GMS', '14700701');
  assertEqual(flashSD_driver.ctc, detail.subcat.yoy_ctc_bps, 'CTC should match between getMetricDrivers and getSubcatDetail');
});

// =============================================================================
// 20. Traffic data accuracy
// =============================================================================
console.log('\n🚦 Traffic Data');

test('getTrafficChannels returns positive GV values', () => {
  const traffic = tools.getTrafficChannels('2026-wk05', 'pc');
  assert(!traffic.error, 'Should not error');
  assert(traffic.channels.length > 0, 'Should have channels');
  for (const c of traffic.channels) {
    assert(c.gv > 0, `Channel ${c.channel} should have positive GV, got ${c.gv}`);
    assert(typeof c.yoy === 'number', `Channel ${c.channel} YoY should be a number`);
  }
});

test('Traffic channels sorted by GV descending', () => {
  const traffic = tools.getTrafficChannels('2026-wk05', 'pc');
  for (let i = 1; i < traffic.channels.length; i++) {
    assert(traffic.channels[i].gv <= traffic.channels[i-1].gv,
      `Traffic should be sorted by GV desc: ${traffic.channels[i].gv} > ${traffic.channels[i-1].gv}`);
  }
});

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
