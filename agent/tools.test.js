#!/usr/bin/env node
/**
 * Leadership Autopilot - Tools Test Suite
 * 
 * Run: node tools.test.js
 * Or:  npm test
 */

const tools = require('./tools');
const fs = require('fs');
const path = require('path');

// Test counters
let passed = 0;
let failed = 0;
const failures = [];

// Test helpers
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
  if (!condition) {
    throw new Error(message || 'Assertion failed');
  }
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(message || `Expected ${expected}, got ${actual}`);
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

// =============================================================================
// SAFETY HELPERS TESTS
// =============================================================================

console.log('\n📦 Safety Helpers');

test('safeDivide returns null for zero denominator', () => {
  assertNull(tools.safeDivide(10, 0));
});

test('safeDivide returns null for null denominator', () => {
  assertNull(tools.safeDivide(10, null));
});

test('safeDivide returns correct value for valid inputs', () => {
  assertEqual(tools.safeDivide(10, 2), 5);
});

test('safeDivide handles negative numbers', () => {
  assertEqual(tools.safeDivide(-10, 2), -5);
});

test('safeReadExcel returns error for non-existent file', () => {
  const result = tools.safeReadExcel('/nonexistent/file.xlsx');
  assertNotNull(result.error);
  assertNull(result.workbook);
});

// =============================================================================
// DATA FRESHNESS TESTS
// =============================================================================

console.log('\n📅 Data Freshness');

test('getDataFreshness parses week format correctly', () => {
  const result = tools.getDataFreshness('2026-wk05');
  assertNotNull(result.weekEnd);
  assert(result.weekEnd.startsWith('2026-'), 'Week end should be in 2026');
});

test('getDataFreshness returns warning for old data', () => {
  // Week 1 of 2024 should definitely be stale
  const result = tools.getDataFreshness('2024-wk01');
  assertNotNull(result.warning);
  assert(result.warning.includes('STALE'), 'Should warn about stale data');
});

test('getDataFreshness returns warning for future week', () => {
  // Week 52 of 2030 should be incomplete
  const result = tools.getDataFreshness('2030-wk52');
  assertNotNull(result.warning);
  assert(result.warning.includes('INCOMPLETE'), 'Should warn about incomplete data');
});

// =============================================================================
// CORE TOOLS TESTS
// =============================================================================

console.log('\n🔧 Core Tools');

test('listWeeks returns array', () => {
  const result = tools.listWeeks();
  assert(Array.isArray(result.weeks), 'weeks should be an array');
});

test('listWeeks weeks are sorted descending', () => {
  const result = tools.listWeeks();
  if (result.weeks.length >= 2) {
    assert(result.weeks[0] >= result.weeks[1], 'Should be sorted descending');
  }
});

test('listGLs returns error for non-existent week', () => {
  const result = tools.listGLs('9999-wk99');
  assertNotNull(result.error);
});

// =============================================================================
// DATA AVAILABILITY TESTS
// =============================================================================

console.log('\n📊 Data Availability');

test('getDataAvailability returns error for non-existent GL', () => {
  const result = tools.getDataAvailability('2026-wk05', 'nonexistent');
  assertEqual(result.available, false);
  assertNotNull(result.error);
});

test('getDataAvailability includes freshness info', () => {
  // This will work even if GL doesn't exist - freshness is calculated from week
  const weeks = tools.listWeeks().weeks;
  if (weeks.length > 0) {
    const gls = tools.listGLs(weeks[0]).gls;
    if (gls && gls.length > 0) {
      const result = tools.getDataAvailability(weeks[0], gls[0].name);
      assertNotNull(result.freshness);
    }
  }
});

// =============================================================================
// INTEGRATION TESTS (require actual data)
// =============================================================================

console.log('\n🔗 Integration Tests');

// Check if we have test data
const weeks = tools.listWeeks().weeks;
const hasData = weeks.length > 0;

if (hasData) {
  const testWeek = weeks[0];
  const gls = tools.listGLs(testWeek).gls;
  const hasGLs = gls && gls.length > 0;
  
  if (hasGLs) {
    const testGL = gls[0].name;
    
    test(`getSummary returns content for ${testGL}`, () => {
      const result = tools.getSummary(testWeek, testGL);
      // May or may not have summary - just shouldn't crash
      assert(!result.error || result.summary === null, 'Should not throw');
    });
    
    test(`getAllSubcatData returns subcats for ${testGL}`, () => {
      const result = tools.getAllSubcatData(testWeek, testGL);
      assert(Array.isArray(result.subcats), 'subcats should be an array');
    });
    
    test(`getAllSubcatData includes parseErrors array`, () => {
      const result = tools.getAllSubcatData(testWeek, testGL);
      // parseErrors should be null or array, not undefined
      assert(result.parseErrors === null || Array.isArray(result.parseErrors), 
        'parseErrors should be null or array');
    });
    
    test(`getDataAvailability returns valid structure for ${testGL}`, () => {
      const result = tools.getDataAvailability(testWeek, testGL);
      assertEqual(result.available, true);
      assertNotNull(result.availability);
      assertNotNull(result.availability.subcat);
      assertNotNull(result.summary);
    });
    
    test(`getMetricDrivers handles missing metric gracefully`, () => {
      const result = tools.getMetricDrivers(testWeek, testGL, 'NonExistentMetric');
      assertNotNull(result.error);
      assertNull(result.drivers);
    });
    
    test(`searchSubcats returns results array`, () => {
      const result = tools.searchSubcats(testWeek, testGL, 'test');
      assert(Array.isArray(result.results), 'results should be an array');
    });
    
  } else {
    console.log('  ⚠ No GLs found - skipping GL-specific tests');
  }
} else {
  console.log('  ⚠ No data found - skipping integration tests');
}

// =============================================================================
// EDGE CASE TESTS
// =============================================================================

console.log('\n⚠️ Edge Cases');

test('getMetricDrivers handles null week', () => {
  const result = tools.getMetricDrivers(null, 'pc', 'GMS');
  assertNotNull(result.error);
});

test('getAllSubcatData handles null gl', () => {
  const result = tools.getAllSubcatData('2026-wk05', null);
  assertNotNull(result.error);
});

test('searchSubcats handles empty query', () => {
  if (hasData) {
    const testWeek = weeks[0];
    const gls = tools.listGLs(testWeek).gls;
    if (gls && gls.length > 0) {
      const result = tools.searchSubcats(testWeek, gls[0].name, '');
      // Should return all results or empty array, not crash
      assert(Array.isArray(result.results), 'Should return array');
    }
  }
});

// =============================================================================
// SUMMARY
// =============================================================================

console.log('\n' + '='.repeat(50));
console.log(`\n📋 Results: ${passed} passed, ${failed} failed\n`);

if (failed > 0) {
  console.log('Failed tests:');
  failures.forEach(f => {
    console.log(`  • ${f.name}: ${f.error}`);
  });
  process.exit(1);
} else {
  console.log('All tests passed! ✓\n');
  process.exit(0);
}
