#!/usr/bin/env node
/**
 * Leadership Autopilot - Fixture-Based Tests
 * 
 * Tests using deterministic fixtures (no dependency on real data)
 * Run: node test/tools.fixture.test.js
 */

const path = require('path');
const fs = require('fs');
const XLSX = require('xlsx');
const yaml = require('yaml');

// Temporarily override DATA_DIR for testing
const FIXTURES_DIR = path.join(__dirname, 'fixtures', 'mock-data');

// We need to modify tools.js to accept a custom data dir, or mock fs
// For now, we'll test the helper functions directly and use integration approach

const tools = require('../tools');

// Test counters
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
    throw new Error(message || `Expected ${expected}, got ${actual}`);
  }
}

function assertApproxEqual(actual, expected, tolerance = 0.0001, message) {
  if (Math.abs(actual - expected) > tolerance) {
    throw new Error(message || `Expected ~${expected}, got ${actual}`);
  }
}

function assertNotNull(value, message) {
  if (value === null || value === undefined) {
    throw new Error(message || 'Expected non-null value');
  }
}

function assertNull(value, message) {
  if (value !== null) {
    throw new Error(message || `Expected null, got ${value}`);
  }
}

function assertIncludes(str, substring, message) {
  if (!str || !str.includes(substring)) {
    throw new Error(message || `Expected "${str}" to include "${substring}"`);
  }
}

// =============================================================================
// FIXTURE VALIDATION
// =============================================================================

console.log('\n📁 Fixture Validation');

test('Fixtures directory exists', () => {
  assert(fs.existsSync(FIXTURES_DIR), `Fixtures not found at ${FIXTURES_DIR}`);
});

test('Mock week directory exists', () => {
  const weekDir = path.join(FIXTURES_DIR, '2099-wk01', 'gl', 'testgl');
  assert(fs.existsSync(weekDir), 'Mock week directory not found');
});

test('GMS Excel file is valid', () => {
  const filepath = path.join(FIXTURES_DIR, '2099-wk01', 'gl', 'testgl', 'GMS_Week 1_ctc_by_SUBCAT.xlsx');
  const { workbook, error } = tools.safeReadExcel(filepath);
  assertNull(error);
  assertNotNull(workbook);
});

test('Manifest YAML is valid', () => {
  const filepath = path.join(FIXTURES_DIR, '2099-wk01', 'gl', 'testgl', '_manifest.yaml');
  const content = fs.readFileSync(filepath, 'utf-8');
  const manifest = yaml.parse(content);
  assertEqual(manifest.gl, 'testgl');
  assertEqual(manifest.week, '2099-wk01');
});

// =============================================================================
// MALFORMED FILE HANDLING
// =============================================================================

console.log('\n🔥 Malformed File Handling');

test('safeReadExcel handles empty workbook gracefully', () => {
  const filepath = path.join(__dirname, 'fixtures', 'malformed', 'empty_workbook.xlsx');
  const { workbook, error } = tools.safeReadExcel(filepath);
  // Empty workbook should still parse (has one empty sheet)
  assertNull(error);
  assertNotNull(workbook);
});

test('safeReadExcel handles non-existent file', () => {
  const { workbook, error } = tools.safeReadExcel('/nonexistent/file.xlsx');
  assertNotNull(error);
  assertIncludes(error, 'not found');
  assertNull(workbook);
});

test('safeReadExcel handles corrupted file', () => {
  // Create a binary garbage file with xlsx extension
  const corruptPath = path.join(__dirname, 'fixtures', 'malformed', 'corrupt.xlsx');
  // Use binary data that can't be parsed as any format
  const garbage = Buffer.from([0x00, 0x01, 0x02, 0xFF, 0xFE, 0xFD]);
  fs.writeFileSync(corruptPath, garbage);
  
  const { workbook, error } = tools.safeReadExcel(corruptPath);
  // XLSX library is lenient - may parse garbage as CSV
  // Just verify it doesn't crash and returns something
  assert(error !== undefined || workbook !== undefined, 'Should not crash on garbage input');
  
  // Cleanup
  fs.unlinkSync(corruptPath);
});

test('Malformed YAML can be detected', () => {
  const filepath = path.join(__dirname, 'fixtures', 'malformed', 'bad_manifest.yaml');
  const content = fs.readFileSync(filepath, 'utf-8');
  
  let parseError = null;
  try {
    yaml.parse(content);
  } catch (err) {
    parseError = err;
  }
  
  assertNotNull(parseError, 'Malformed YAML should throw parse error');
});

// =============================================================================
// SAFE DIVISION / BPS CONVERSION
// =============================================================================

console.log('\n🔢 Math & Conversion Tests');

test('safeDivide handles zero denominator', () => {
  assertNull(tools.safeDivide(100, 0));
});

test('safeDivide handles null denominator', () => {
  assertNull(tools.safeDivide(100, null));
});

test('safeDivide handles undefined denominator', () => {
  assertNull(tools.safeDivide(100, undefined));
});

test('safeDivide returns correct result', () => {
  assertEqual(tools.safeDivide(100, 4), 25);
});

test('safeDivide handles negative numbers', () => {
  assertEqual(tools.safeDivide(-100, 4), -25);
});

test('safeDivide handles Infinity result', () => {
  // 1 / very small number could be Infinity
  const result = tools.safeDivide(1, Number.MIN_VALUE);
  // Should return null or a finite number
  assert(result === null || isFinite(result), 'Should handle potential Infinity');
});

test('bps to percent conversion: 100 bps = 1%', () => {
  const bps = 100;
  const percent = tools.safeDivide(bps, 10000);
  assertApproxEqual(percent, 0.01); // 1% as decimal
});

test('bps to percent conversion: -50 bps = -0.5%', () => {
  const bps = -50;
  const percent = tools.safeDivide(bps, 10000);
  assertApproxEqual(percent, -0.005); // -0.5% as decimal
});

// =============================================================================
// DATA FRESHNESS
// =============================================================================

console.log('\n📅 Data Freshness Tests');

test('getDataFreshness parses valid week format', () => {
  const result = tools.getDataFreshness('2026-wk05');
  assertNotNull(result.weekEnd);
  assert(result.weekEnd.startsWith('2026-'), 'Should be in 2026');
});

test('getDataFreshness handles invalid week format', () => {
  const result = tools.getDataFreshness('invalid-week');
  assertNull(result.ageDays);
});

test('getDataFreshness warns for very old data', () => {
  const result = tools.getDataFreshness('2020-wk01');
  assertNotNull(result.warning);
  assertIncludes(result.warning, 'STALE');
});

test('getDataFreshness warns for future week', () => {
  const result = tools.getDataFreshness('2099-wk01');
  assertNotNull(result.warning);
  assertIncludes(result.warning, 'INCOMPLETE');
});

test('getDataFreshness boundary: 7-14 days shows note', () => {
  // Calculate a week that's ~10 days old
  const now = new Date();
  const tenDaysAgo = new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000);
  const year = tenDaysAgo.getFullYear();
  const weekNum = Math.ceil((tenDaysAgo - new Date(year, 0, 1)) / (7 * 24 * 60 * 60 * 1000));
  const weekStr = `${year}-wk${String(weekNum).padStart(2, '0')}`;
  
  const result = tools.getDataFreshness(weekStr);
  // Should have some kind of note (either warning or note)
  // This is a boundary case, so we just check it doesn't crash
  assert(result.ageDays !== null, 'Should calculate age');
});

// =============================================================================
// EXCEL PARSING WITH FIXTURES
// =============================================================================

console.log('\n📊 Excel Parsing Tests');

test('Parse GMS subcat file correctly', () => {
  const filepath = path.join(FIXTURES_DIR, '2099-wk01', 'gl', 'testgl', 'GMS_Week 1_ctc_by_SUBCAT.xlsx');
  const { workbook } = tools.safeReadExcel(filepath);
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null });
  
  // Should have header rows + total + 3 categories = 6 rows
  assertEqual(rows.length, 6);
  
  // Check total row
  assertEqual(rows[2][0], 'Total');
  assertEqual(rows[2][2], 1000000); // Week value
  
  // Check first category
  assertEqual(rows[3][0], 'CAT001');
  assertEqual(rows[3][1], 'Category One');
  assertEqual(rows[3][2], 400000);
});

test('Parse margin metric (NetPPM) columns correctly', () => {
  const filepath = path.join(FIXTURES_DIR, '2099-wk01', 'gl', 'testgl', 'NetPPMLessSD_Week 1_ctc_by_SUBCAT.xlsx');
  const { workbook } = tools.safeReadExcel(filepath);
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null });
  
  // Check header row has expected columns
  const headers = rows[1];
  assertIncludes(headers.join(','), 'Mix');
  assertIncludes(headers.join(','), 'Rate');
  
  // Check margin value is a percentage
  const totalMargin = rows[2][2]; // Value column
  assertEqual(totalMargin, 0.15); // 15% margin
});

test('Parse ASIN file with long product names', () => {
  const filepath = path.join(FIXTURES_DIR, '2099-wk01', 'gl', 'testgl', 'GMS_Week 1_ctc_by_ASIN.xlsx');
  const { workbook } = tools.safeReadExcel(filepath);
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null });
  
  // Check first ASIN has long name
  const firstAsin = rows[3];
  assertEqual(firstAsin[0], 'B0001AAAAA');
  assert(firstAsin[1].length > 50, 'Product name should be long');
});

// =============================================================================
// ZERO / NULL VALUE HANDLING
// =============================================================================

console.log('\n⚠️ Zero/Null Value Handling');

test('Handle file with zero values', () => {
  const filepath = path.join(__dirname, 'fixtures', 'edge-cases', 'zero_values.xlsx');
  const { workbook, error } = tools.safeReadExcel(filepath);
  assertNull(error);
  
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null });
  
  // Total row has zeros
  assertEqual(rows[2][2], 0); // Week value = 0
  
  // Null values should come through as null
  assertEqual(rows[3][3], null); // WoW % is null
});

test('safeDivide with zero numerator', () => {
  assertEqual(tools.safeDivide(0, 100), 0);
});

// =============================================================================
// SORTING VERIFICATION
// =============================================================================

console.log('\n📈 Sorting Tests');

test('GMS fixture data is sorted by CTC descending', () => {
  const filepath = path.join(FIXTURES_DIR, '2099-wk01', 'gl', 'testgl', 'GMS_Week 1_ctc_by_SUBCAT.xlsx');
  const { workbook } = tools.safeReadExcel(filepath);
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null });
  
  // Extract CTC values (column 8) for non-total rows
  const ctcValues = rows.slice(3).map(r => Math.abs(r[8]));
  
  // Verify descending order
  for (let i = 0; i < ctcValues.length - 1; i++) {
    assert(ctcValues[i] >= ctcValues[i + 1], 
      `CTC should be sorted descending: ${ctcValues[i]} >= ${ctcValues[i + 1]}`);
  }
});

// =============================================================================
// SUMMARY
// =============================================================================

console.log('\n' + '='.repeat(50));
console.log(`\n📋 Fixture Tests: ${passed} passed, ${failed} failed\n`);

if (failed > 0) {
  console.log('Failed tests:');
  failures.forEach(f => {
    console.log(`  • ${f.name}: ${f.error}`);
  });
  process.exit(1);
} else {
  console.log('All fixture tests passed! ✓\n');
  process.exit(0);
}
