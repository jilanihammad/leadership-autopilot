#!/usr/bin/env node
/**
 * Leadership Autopilot — generate_summary.js Tests
 * 
 * Tests the summary generator's parsing, formatting, and manifest generation.
 * Covers: T2-SCRIPT-02 (column index consistency), fmt(), parseSubcatData(),
 *         generateSummaryMd(), generateManifest()
 * 
 * Prevents: Summary showing wrong values due to column mismatch,
 *           malformed manifest preventing data loading,
 *           formatting edge cases showing "NaN" or "undefined".
 * 
 * Run: node generate_summary.test.js
 */

const path = require('path');
const {
  METRIC_CONFIG,
  parseFilename,
  readExcelFile,
  parseSubcatData,
  generateSummaryMd,
  generateManifest,
  fmt,
} = require('./generate_summary');

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

function assertNotNull(value, message) {
  if (value === null || value === undefined) {
    throw new Error(message || 'Expected non-null value');
  }
}

function assertIncludes(str, sub, message) {
  if (!str || !str.includes(sub)) {
    throw new Error(message || `Expected "${str}" to include "${sub}"`);
  }
}

// =============================================================================
// fmt() — Number Formatting
// Prevents: Dashboard/summary showing ugly/wrong formatted values like "NaN"
// =============================================================================

console.log('\n🔢 fmt() — Number Formatting');

test('fmt: null returns N/A', () => {
  assertEqual(fmt(null), 'N/A');
});

test('fmt: undefined returns N/A', () => {
  assertEqual(fmt(undefined), 'N/A');
});

test('fmt: NaN returns N/A', () => {
  assertEqual(fmt(NaN), 'N/A');
});

test('fmt: percentage formatting', () => {
  assertEqual(fmt(0.156, 'pct'), '15.6%');
});

test('fmt: negative percentage', () => {
  assertEqual(fmt(-0.032, 'pct'), '-3.2%');
});

test('fmt: zero percentage', () => {
  assertEqual(fmt(0, 'pct'), '0.0%');
});

test('fmt: bps formatting', () => {
  assertEqual(fmt(150, 'bps'), '150 bps');
});

test('fmt: negative bps', () => {
  assertEqual(fmt(-250, 'bps'), '-250 bps');
});

test('fmt: currency millions', () => {
  const result = fmt(5000000, 'currency');
  assert(result.includes('$'), 'Currency should have $ sign');
  assert(result.includes('M'), 'Millions should show M');
  assertEqual(result, '$5.00M');
});

test('fmt: currency thousands', () => {
  assertEqual(fmt(5000, 'currency'), '$5.0K');
});

test('fmt: currency small', () => {
  assertEqual(fmt(42.5, 'currency'), '$42.50');
});

test('fmt: currency zero', () => {
  assertEqual(fmt(0, 'currency'), '$0.00');
});

test('fmt: units millions', () => {
  assertEqual(fmt(2500000, 'units'), '2.50M');
});

test('fmt: units thousands', () => {
  assertEqual(fmt(2500, 'units'), '2.5K');
});

test('fmt: units small', () => {
  assertEqual(fmt(42, 'units'), '42');
});

test('fmt: default number formatting', () => {
  assertEqual(fmt(3.14159), '3.14');
});

// =============================================================================
// METRIC_CONFIG — Column Index Consistency
// Prevents: Summary reads YoY% but tools.js reads from different column
// =============================================================================

console.log('\n📊 METRIC_CONFIG — Column Definitions');

test('T2-SCRIPT-02a: GMS has correct column indices', () => {
  const c = METRIC_CONFIG.GMS;
  assertEqual(c.valueCol, 2, 'GMS value should be col 2');
  assertEqual(c.wowPctCol, 3, 'GMS WoW% should be col 3');
  assertEqual(c.yoyPctCol, 4, 'GMS YoY% should be col 4');
  assertEqual(c.yoyCtcBpsCol, 8, 'GMS YoY CTC bps should be col 8');
});

test('T2-SCRIPT-02b: ShippedUnits has same layout as GMS', () => {
  const c = METRIC_CONFIG.ShippedUnits;
  assertEqual(c.valueCol, 2, 'Units value should be col 2');
  assertEqual(c.wowPctCol, 3, 'Units WoW% should be col 3');
  assertEqual(c.yoyPctCol, 4, 'Units YoY% should be col 4');
  assertEqual(c.yoyCtcBpsCol, 8, 'Units YoY CTC bps should be col 8');
});

test('T2-SCRIPT-02c: NetPPMLessSD uses margin layout (13 cols)', () => {
  const c = METRIC_CONFIG.NetPPMLessSD;
  assertEqual(c.valueCol, 2, 'NetPPM value should be col 2');
  assert(c.isBps, 'NetPPM should be marked as bps metric');
  assert(c.hasMixRate, 'NetPPM should have mix/rate');
  assertEqual(c.yoyCtcBpsCol, 10, 'NetPPM YoY CTC bps should be col 10');
  assertEqual(c.wowBpsCol, 5, 'NetPPM WoW bps should be col 5');
  assertEqual(c.yoyBpsCol, 6, 'NetPPM YoY bps should be col 6');
});

test('T2-SCRIPT-02d: CM uses same margin layout as NetPPM', () => {
  const c = METRIC_CONFIG.CM;
  assertEqual(c.valueCol, 2);
  assert(c.isBps);
  assert(c.hasMixRate);
  assertEqual(c.yoyCtcBpsCol, 10);
});

test('T2-SCRIPT-02e: ASP has mix/rate columns', () => {
  const c = METRIC_CONFIG.ASP;
  assert(c.hasMixRate, 'ASP should have mix/rate');
  assertEqual(c.yoyCtcCol, 10, 'ASP YoY CTC should be col 10');
  assertEqual(c.yoyMixCol, 11, 'ASP YoY Mix should be col 11');
  assertEqual(c.yoyRateCol, 12, 'ASP YoY Rate should be col 12');
});

test('T2-SCRIPT-02f: SOROOS uses bps layout', () => {
  const c = METRIC_CONFIG.SOROOS_PROCURABLE_PRODUCT_OOS_GV_PCT;
  assert(c.isBps, 'SOROOS should be bps');
  assertEqual(c.yoyCtcBpsCol, 10, 'SOROOS YoY CTC bps should be col 10');
  assertEqual(c.direction, 'down_good', 'SOROOS direction should be down_good');
});

test('All METRIC_CONFIG entries have required fields', () => {
  for (const [key, config] of Object.entries(METRIC_CONFIG)) {
    assertNotNull(config.name, `${key} should have name`);
    assertNotNull(config.unit, `${key} should have unit`);
    assertNotNull(config.direction, `${key} should have direction`);
    assertNotNull(config.valueCol, `${key} should have valueCol`);
    assert(config.direction === 'up_good' || config.direction === 'down_good' || config.direction === 'neutral',
      `${key} direction should be up_good, down_good, or neutral`);
  }
});

// =============================================================================
// parseSubcatData() — using fixture data
// Prevents: Metric data not parsed, empty summaries
// =============================================================================

console.log('\n📊 parseSubcatData() — Fixture Data');

const fixtureDir = path.join(__dirname, '..', 'agent', 'test', 'fixtures', 'mock-data', 
  '2099-wk01', 'gl', 'testgl');
const XLSX = require('xlsx');
const fs = require('fs');

if (fs.existsSync(fixtureDir)) {
  test('parseSubcatData parses GMS fixture correctly', () => {
    const filepath = path.join(fixtureDir, 'GMS_Week 1_ctc_by_SUBCAT.xlsx');
    const rows = readExcelFile(filepath);
    const result = parseSubcatData(rows, 'GMS');
    
    assertNotNull(result, 'Should return parsed data');
    assert(result.hasData, 'Should have data');
    assertNotNull(result.total, 'Should have total row');
    assertNotNull(result.total.value, 'Total should have value');
    assert(result.topYoyDrivers.length > 0, 'Should have YoY drivers');
    assert(result.topYoyDrivers.length <= 5, 'Should have at most 5 top drivers');
  });

  test('parseSubcatData parses NetPPM fixture correctly', () => {
    const filepath = path.join(fixtureDir, 'NetPPMLessSD_Week 1_ctc_by_SUBCAT.xlsx');
    const rows = readExcelFile(filepath);
    const result = parseSubcatData(rows, 'NetPPMLessSD');
    
    assertNotNull(result, 'Should return parsed data');
    assert(result.hasData, 'Should have data');
    assertNotNull(result.total, 'Should have total row');
    // NetPPM total should be a percentage (0-1 range)
    assert(Math.abs(result.total.value) <= 1, 
      'NetPPM total should be in percentage range');
  });

  test('parseSubcatData returns null for unknown metric', () => {
    const filepath = path.join(fixtureDir, 'GMS_Week 1_ctc_by_SUBCAT.xlsx');
    const rows = readExcelFile(filepath);
    const result = parseSubcatData(rows, 'FAKE_METRIC');
    assertEqual(result, null, 'Unknown metric should return null');
  });

  test('parseSubcatData top drivers are sorted by |CTC| descending', () => {
    const filepath = path.join(fixtureDir, 'GMS_Week 1_ctc_by_SUBCAT.xlsx');
    const rows = readExcelFile(filepath);
    const result = parseSubcatData(rows, 'GMS');
    
    for (let i = 0; i < result.topYoyDrivers.length - 1; i++) {
      const a = Math.abs(result.topYoyDrivers[i].yoyCtcBps || 0);
      const b = Math.abs(result.topYoyDrivers[i + 1].yoyCtcBps || 0);
      assert(a >= b, `CTC should be sorted descending: ${a} >= ${b}`);
    }
  });
} else {
  console.log('  ⚠ Fixture directory not found — skipping parseSubcatData tests');
}

// =============================================================================
// generateSummaryMd() — Output validation
// Prevents: Garbled summary, missing sections
// =============================================================================

console.log('\n📝 generateSummaryMd()');

test('generateSummaryMd produces valid markdown', () => {
  const metrics = {
    GMS: {
      hasData: true,
      metric: 'Shipped GMS',
      total: { value: 5000000, wowPct: 0.05, yoyPct: -0.02 },
      topYoyDrivers: [
        { name: 'Category A', yoyCtcBps: -200 },
        { name: 'Category B', yoyCtcBps: 150 },
      ],
      topWowDrivers: [],
    },
  };
  
  const md = generateSummaryMd('test', 5, metrics, null);
  assertIncludes(md, '# TEST', 'Should have GL name header');
  assertIncludes(md, 'Week 5', 'Should mention week number');
  assertIncludes(md, 'Shipped GMS', 'Should have GMS section');
  assertIncludes(md, '$5.00M', 'Should format GMS total as currency');
  assertIncludes(md, 'Category A', 'Should include top driver');
});

test('generateSummaryMd handles empty metrics', () => {
  const md = generateSummaryMd('empty', 1, {}, null);
  assertIncludes(md, '# EMPTY', 'Should still have GL header');
  assertIncludes(md, 'Week 1', 'Should still have week');
  // Should not crash or include "undefined"
  assert(!md.includes('undefined'), 'Should not contain "undefined"');
});

test('generateSummaryMd includes margin metrics', () => {
  const metrics = {
    NetPPMLessSD: {
      hasData: true,
      metric: 'Net PPM',
      total: { value: 0.15, wowBps: 30, yoyBps: -50 },
      topYoyDrivers: [
        { name: 'Cat X', yoyCtcBps: -80, yoyMix: -20, yoyRate: -60 },
      ],
      topWowDrivers: [],
    },
  };
  
  const md = generateSummaryMd('test', 3, metrics, null);
  assertIncludes(md, 'Net PPM', 'Should have Net PPM section');
  assertIncludes(md, '15.0%', 'Should format as percentage');
  assertIncludes(md, 'Mix', 'Should include Mix column');
  assertIncludes(md, 'Rate', 'Should include Rate column');
});

// =============================================================================
// generateManifest()
// Prevents: Manifest missing metrics, preventing tools.js from loading data
// =============================================================================

console.log('\n📄 generateManifest()');

test('generateManifest creates valid structure', () => {
  const files = [
    'GMS_Week 5_ctc_by_SUBCAT.xlsx',
    'GMS_Week 5_ctc_by_ASIN.xlsx',
    'NetPPMLessSD_Week 5_ctc_by_SUBCAT.xlsx',
    'random_file.txt',
  ];
  
  const manifest = generateManifest('pc', 5, files);
  assertEqual(manifest.gl, 'pc', 'GL should match');
  assertEqual(manifest.week, 5, 'Week should match');
  assertNotNull(manifest.files.subcat.GMS, 'Should have GMS subcat file');
  assertNotNull(manifest.files.asin.GMS, 'Should have GMS asin file');
  assertNotNull(manifest.files.subcat.NetPPMLessSD, 'Should have NetPPM subcat file');
  assert(manifest.files.other.includes('random_file.txt'), 'Unknown file should be in other');
  assert(manifest.metrics_available.includes('GMS'), 'GMS should be in metrics_available');
  assert(manifest.metrics_available.includes('NetPPMLessSD'), 'NetPPM should be in metrics_available');
});

test('generateManifest handles empty file list', () => {
  const manifest = generateManifest('test', 1, []);
  assertEqual(manifest.gl, 'test');
  assertEqual(manifest.week, 1);
  assertEqual(Object.keys(manifest.files.subcat).length, 0, 'Should have no subcat files');
  assertEqual(manifest.metrics_available.length, 0, 'Should have no metrics');
});

test('generateManifest with pre-detected files', () => {
  const files = ['data.xlsx'];
  const detectedFiles = [
    { file: 'data.xlsx', metric: 'GMS', level: 'SUBCAT', week: 5, source: 'content' },
  ];
  
  const manifest = generateManifest('pc', 5, files, null, detectedFiles);
  assertEqual(manifest.files.subcat.GMS, 'data.xlsx',
    'Should use content-detected metric mapping');
});

// =============================================================================
// parseFilename() — additional edge cases
// =============================================================================

console.log('\n📄 parseFilename() — Edge Cases');

test('parseFilename handles traffic files', () => {
  const result = parseFilename('GVs_By_Week.csv');
  assertNotNull(result, 'Should parse traffic filename');
  assert(result.isTraffic, 'Should be marked as traffic');
  assertEqual(result.metric, 'GVs');
});

test('parseFilename returns null for non-matching filename', () => {
  const result = parseFilename('random_document.xlsx');
  assertEqual(result, null, 'Should return null for non-matching filename');
});

test('parseFilename case insensitive level', () => {
  const result = parseFilename('GMS_Week 5_ctc_by_subcat.xlsx');
  assertNotNull(result, 'Should parse lowercase level');
  assertEqual(result.level, 'SUBCAT', 'Level should be normalized to uppercase');
});

// =============================================================================
// SUMMARY
// =============================================================================

console.log('\n' + '═'.repeat(50));
console.log(`\n📋 Generate Summary Tests: ${passed} passed, ${failed} failed\n`);

if (failed > 0) {
  console.log('Failed tests:');
  failures.forEach(f => {
    console.log(`  • ${f.name}: ${f.error}`);
  });
  process.exit(1);
} else {
  console.log('All generate_summary tests passed! ✓\n');
  process.exit(0);
}
