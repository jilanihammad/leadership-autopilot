#!/usr/bin/env node
/**
 * loadDenominatorPctMap() Unit Tests
 *
 * This function computes the cross-metric denominator percentage map that's
 * critical for margin metric accuracy. The "80-780 bps bug" was caused by
 * incorrect denominator estimation — this test suite prevents regressions.
 *
 * Creates Excel fixture files programmatically (no real business data).
 * Tests:
 *   - Happy path: correct wowPct/yoyPct extraction from known rows
 *   - Missing denMetricKey → empty Map
 *   - Missing file in manifest → empty Map
 *   - 'Total' row excluded from map
 *   - Empty/malformed rows handled gracefully
 *
 * Run: cd agent && node test/denominator-pct-map.test.js
 */

const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const yaml = require('yaml');
const tools = require('../tools');

// ─── Test harness ───────────────────────────────────────────────────────────
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

function assert(condition, message) {
  if (!condition) throw new Error(message || 'Assertion failed');
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(message || `Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function assertApprox(actual, expected, tol, msg) {
  if (Math.abs(actual - expected) > tol) {
    throw new Error(msg || `Expected ~${expected} ± ${tol}, got ${actual}`);
  }
}

// ─── Fixture helpers ────────────────────────────────────────────────────────

/**
 * Create a minimal standard-layout Excel file in memory and write to disk.
 * Standard layout:
 *   Row 0: merge labels (WoW Variance, YoY Variance)
 *   Row 1: column headers
 *   Row 2+: data rows
 * 
 * Standard metric columns (9 cols):
 *   0: Subcat Code
 *   1: Subcat Name
 *   2: Current Value
 *   3: WoW % change
 *   4: YoY % change
 *   5: WoW Δ (absolute)
 *   6: YoY Δ (absolute)
 *   7: WoW CTC (bps)
 *   8: YoY CTC (bps)
 */
function createStandardMetricExcel(filePath, rows) {
  const wb = XLSX.utils.book_new();
  
  // Build full data array with header rows
  const data = [
    // Row 0: merge labels
    [null, null, null, 'WoW Variance', null, null, 'YoY Variance', null, null],
    // Row 1: column headers
    ['Subcat', 'Name', 'Value', 'WoW %', 'YoY %', 'WoW Δ', 'YoY Δ', 'WoW CTC', 'YoY CTC'],
    // Row 2+: data
    ...rows,
  ];
  
  const ws = XLSX.utils.aoa_to_sheet(data);
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
  XLSX.writeFile(wb, filePath);
}

const FIXTURE_DIR = path.join(__dirname, '_fixture_denom_test');
const FIXTURE_GMS_FILE = 'GMS_subcats.xlsx';
const FIXTURE_UNITS_FILE = 'Units_subcats.xlsx';

function setupFixtures() {
  fs.mkdirSync(FIXTURE_DIR, { recursive: true });
  
  // Create a GMS fixture with known values
  // Columns: [code, name, value, wowPct, yoyPct, wowDelta, yoyDelta, wowCtc, yoyCtc]
  createStandardMetricExcel(path.join(FIXTURE_DIR, FIXTURE_GMS_FILE), [
    ['SC001', 'Keyboards',    5000000, 0.05,  0.12,  238095, 535714, 150, 320],
    ['SC002', 'Mice',         3000000, -0.03, 0.08,  -92784, 222222, -60, 130],
    ['SC003', 'Monitors',     8000000, 0.10,  -0.05, 727273, -421053, 450, -250],
    ['Total', 'Total',       16000000, 0.04,  0.05,  615385, 761905, null, null],
    [null,    null,           null,    null,   null,  null,   null,   null, null],  // empty row
  ]);
  
  // Create a ShippedUnits fixture
  createStandardMetricExcel(path.join(FIXTURE_DIR, FIXTURE_UNITS_FILE), [
    ['SC001', 'Keyboards', 100000, 0.02,  0.15,  1961, 13043, 80, 400],
    ['SC002', 'Mice',       75000, -0.01, 0.10,  -758, 6818,  -30, 200],
    ['SC003', 'Monitors',   50000, 0.08,  -0.02, 3704, -1020, 150, -60],
  ]);
}

function cleanupFixtures() {
  if (fs.existsSync(FIXTURE_DIR)) {
    fs.rmSync(FIXTURE_DIR, { recursive: true, force: true });
  }
}

// ─── Tests ──────────────────────────────────────────────────────────────────
console.log('\n📐 loadDenominatorPctMap() Unit Tests');

setupFixtures();

try {
  // ── getDenominatorMetric() ──
  console.log('\n  getDenominatorMetric() mapping');

  test('NetPPMLessSD denominator is GMS', () => {
    assertEqual(tools.getDenominatorMetric('NetPPMLessSD'), 'GMS');
  });

  test('CM denominator is GMS', () => {
    assertEqual(tools.getDenominatorMetric('CM'), 'GMS');
  });

  test('ASP denominator is ShippedUnits', () => {
    assertEqual(tools.getDenominatorMetric('ASP'), 'ShippedUnits');
  });

  test('SOROOS denominator is GMS (proxy)', () => {
    assertEqual(tools.getDenominatorMetric('SOROOS_PROCURABLE_PRODUCT_OOS_GV_PCT'), 'GMS');
  });

  test('unknown metric returns null', () => {
    assertEqual(tools.getDenominatorMetric('FakeMetric'), null);
  });

  test('GMS itself has no denominator (it IS a denominator)', () => {
    assertEqual(tools.getDenominatorMetric('GMS'), null);
  });

  // ── loadDenominatorPctMap() — happy path ──
  console.log('\n  loadDenominatorPctMap() — happy path');

  const gmsManifest = {
    files: {
      subcat: {
        GMS: FIXTURE_GMS_FILE,
        ShippedUnits: FIXTURE_UNITS_FILE,
      },
    },
  };

  test('loads GMS pctMap with correct subcats', () => {
    const pctMap = tools.loadDenominatorPctMap(FIXTURE_DIR, gmsManifest, 'GMS');
    assertEqual(pctMap.size, 3, `expected 3 subcats, got ${pctMap.size}`);
    assert(pctMap.has('SC001'), 'should have SC001');
    assert(pctMap.has('SC002'), 'should have SC002');
    assert(pctMap.has('SC003'), 'should have SC003');
  });

  test('SC001 (Keyboards) has correct wowPct=0.05', () => {
    const pctMap = tools.loadDenominatorPctMap(FIXTURE_DIR, gmsManifest, 'GMS');
    const sc001 = pctMap.get('SC001');
    assertApprox(sc001.wowPct, 0.05, 0.001, `wowPct should be 0.05, got ${sc001.wowPct}`);
  });

  test('SC001 (Keyboards) has correct yoyPct=0.12', () => {
    const pctMap = tools.loadDenominatorPctMap(FIXTURE_DIR, gmsManifest, 'GMS');
    const sc001 = pctMap.get('SC001');
    assertApprox(sc001.yoyPct, 0.12, 0.001, `yoyPct should be 0.12, got ${sc001.yoyPct}`);
  });

  test('SC002 (Mice) has negative wowPct=-0.03', () => {
    const pctMap = tools.loadDenominatorPctMap(FIXTURE_DIR, gmsManifest, 'GMS');
    const sc002 = pctMap.get('SC002');
    assertApprox(sc002.wowPct, -0.03, 0.001, `wowPct should be -0.03, got ${sc002.wowPct}`);
  });

  test('SC003 (Monitors) has negative yoyPct=-0.05', () => {
    const pctMap = tools.loadDenominatorPctMap(FIXTURE_DIR, gmsManifest, 'GMS');
    const sc003 = pctMap.get('SC003');
    assertApprox(sc003.yoyPct, -0.05, 0.001, `yoyPct should be -0.05, got ${sc003.yoyPct}`);
  });

  test('Total row is excluded from pctMap', () => {
    const pctMap = tools.loadDenominatorPctMap(FIXTURE_DIR, gmsManifest, 'GMS');
    assert(!pctMap.has('Total'), 'Total should not be in pctMap');
    assert(!pctMap.has('total'), 'total should not be in pctMap');
  });

  test('loads ShippedUnits pctMap correctly', () => {
    const pctMap = tools.loadDenominatorPctMap(FIXTURE_DIR, gmsManifest, 'ShippedUnits');
    assertEqual(pctMap.size, 3, `expected 3 subcats, got ${pctMap.size}`);
    const sc001 = pctMap.get('SC001');
    assertApprox(sc001.wowPct, 0.02, 0.001);
    assertApprox(sc001.yoyPct, 0.15, 0.001);
  });

  // ── loadDenominatorPctMap() — edge cases ──
  console.log('\n  loadDenominatorPctMap() — edge cases');

  test('returns empty Map when denMetricKey is null', () => {
    const pctMap = tools.loadDenominatorPctMap(FIXTURE_DIR, gmsManifest, null);
    assertEqual(pctMap.size, 0, 'should be empty');
    assert(pctMap instanceof Map, 'should be a Map');
  });

  test('returns empty Map when denMetricKey is undefined', () => {
    const pctMap = tools.loadDenominatorPctMap(FIXTURE_DIR, gmsManifest, undefined);
    assertEqual(pctMap.size, 0, 'should be empty');
  });

  test('returns empty Map when denMetricKey is empty string', () => {
    // Empty string is falsy, should hit the early return
    const pctMap = tools.loadDenominatorPctMap(FIXTURE_DIR, gmsManifest, '');
    assertEqual(pctMap.size, 0, 'should be empty');
  });

  test('returns empty Map when metric not in manifest', () => {
    const pctMap = tools.loadDenominatorPctMap(FIXTURE_DIR, gmsManifest, 'NonExistentMetric');
    assertEqual(pctMap.size, 0, 'should be empty for unknown metric');
  });

  test('returns empty Map when manifest has no files section', () => {
    const emptyManifest = { week: 'test' };
    const pctMap = tools.loadDenominatorPctMap(FIXTURE_DIR, emptyManifest, 'GMS');
    assertEqual(pctMap.size, 0, 'should be empty');
  });

  test('returns empty Map when manifest files.subcat is empty', () => {
    const noSubcatManifest = { files: { subcat: {} } };
    const pctMap = tools.loadDenominatorPctMap(FIXTURE_DIR, noSubcatManifest, 'GMS');
    assertEqual(pctMap.size, 0, 'should be empty');
  });

  test('returns empty Map when file does not exist on disk', () => {
    const badManifest = { files: { subcat: { GMS: 'nonexistent_file.xlsx' } } };
    const pctMap = tools.loadDenominatorPctMap(FIXTURE_DIR, badManifest, 'GMS');
    assertEqual(pctMap.size, 0, 'should be empty when file missing');
  });

  test('handles null/empty rows in Excel gracefully', () => {
    // The fixture GMS file has an empty row at the end — verify it doesn't crash
    const pctMap = tools.loadDenominatorPctMap(FIXTURE_DIR, gmsManifest, 'GMS');
    // Should still have exactly 3 valid subcats (null row and Total excluded)
    assertEqual(pctMap.size, 3, 'null rows should be skipped');
  });

  // ── Cross-check: getDenominatorMetric → loadDenominatorPctMap pipeline ──
  console.log('\n  Full pipeline: getDenominatorMetric → loadDenominatorPctMap');

  test('NetPPMLessSD pipeline: gets GMS denominators for margin computation', () => {
    const denKey = tools.getDenominatorMetric('NetPPMLessSD');
    assertEqual(denKey, 'GMS');
    const pctMap = tools.loadDenominatorPctMap(FIXTURE_DIR, gmsManifest, denKey);
    assertEqual(pctMap.size, 3);
    // SC001's GMS grew 12% YoY — this is used to estimate prior-period denominator
    assertApprox(pctMap.get('SC001').yoyPct, 0.12, 0.001);
  });

  test('ASP pipeline: gets ShippedUnits denominators', () => {
    const denKey = tools.getDenominatorMetric('ASP');
    assertEqual(denKey, 'ShippedUnits');
    const pctMap = tools.loadDenominatorPctMap(FIXTURE_DIR, gmsManifest, denKey);
    assertEqual(pctMap.size, 3);
    // SC001's units grew 15% YoY
    assertApprox(pctMap.get('SC001').yoyPct, 0.15, 0.001);
  });

  test('GMS pipeline: no denominator needed (GMS is a standard metric)', () => {
    const denKey = tools.getDenominatorMetric('GMS');
    assertEqual(denKey, null);
    const pctMap = tools.loadDenominatorPctMap(FIXTURE_DIR, gmsManifest, denKey);
    assertEqual(pctMap.size, 0, 'no denominator map for standard metrics');
  });

} finally {
  cleanupFixtures();
}

// ─── Report ─────────────────────────────────────────────────────────────────
console.log(`\n📊 loadDenominatorPctMap: ${passed} passed, ${failed} failed`);
if (failures.length > 0) {
  console.log('\nFailures:');
  failures.forEach(f => console.log(`  ✗ ${f.name}: ${f.error}`));
}
process.exit(failed > 0 ? 1 : 0);
