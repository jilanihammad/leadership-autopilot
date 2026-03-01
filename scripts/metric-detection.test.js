#!/usr/bin/env node
/**
 * Tests for metric-detection.js — content-based Excel metric detection.
 */

const {
  matchMetricHeader,
  detectLevel,
  extractWeekNumber,
  parseFilename,
  detectMetricFromRows,
} = require('./metric-detection');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.log(`  ✗ ${name}: ${err.message}`);
    failed++;
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'Assertion failed');
}

// ── matchMetricHeader ────────────────────────────────────────────────────────

console.log('📊 matchMetricHeader');

test('GMS header', () => {
  assert(matchMetricHeader('GMS (Week 6)($)') === 'GMS');
});

test('Shipped Units header', () => {
  assert(matchMetricHeader('Shipped Units (Week 6)') === 'ShippedUnits');
});

test('ShippedUnits no space', () => {
  assert(matchMetricHeader('ShippedUnits (Week 5)') === 'ShippedUnits');
});

test('ASP header', () => {
  assert(matchMetricHeader('ASP (Week 6)') === 'ASP');
});

test('Net PPM header', () => {
  assert(matchMetricHeader('Net PPM (%) (Week 6)(%)') === 'NetPPMLessSD');
});

test('CM header with paren', () => {
  assert(matchMetricHeader('CM (%) (Week 6)(%)') === 'CM');
});

test('CM header plain', () => {
  assert(matchMetricHeader('CM (Week 6)') === 'CM');
});

test('SOROOS header', () => {
  assert(matchMetricHeader('SoROOS Procurable Product OOS (%) (Week 6)(%)') === 'SOROOS_PROCURABLE_PRODUCT_OOS_GV_PCT');
});

test('GV header', () => {
  assert(matchMetricHeader('GV (Week 6)') === 'GV');
});

test('Glance Views header', () => {
  assert(matchMetricHeader('Glance Views (Week 6)') === 'GV');
});

test('Unknown header returns null', () => {
  assert(matchMetricHeader('Random Column Name') === null);
});

test('Empty string returns null', () => {
  assert(matchMetricHeader('') === null);
});

// ── detectLevel ──────────────────────────────────────────────────────────────

console.log('\n📁 detectLevel');

test('Product Subcategory Code → SUBCAT', () => {
  assert(detectLevel('Product Subcategory Code') === 'SUBCAT');
});

test('ASIN → ASIN', () => {
  assert(detectLevel('ASIN') === 'ASIN');
});

test('asin lowercase → ASIN', () => {
  assert(detectLevel('asin') === 'ASIN');
});

test('Product Sub Category → SUBCAT', () => {
  assert(detectLevel('Product Sub Category') === 'SUBCAT');
});

test('Unknown defaults to SUBCAT', () => {
  assert(detectLevel('Something') === 'SUBCAT');
});

// ── extractWeekNumber ────────────────────────────────────────────────────────

console.log('\n📅 extractWeekNumber');

test('GMS (Week 6)($) → 6', () => {
  assert(extractWeekNumber('GMS (Week 6)($)') === 6);
});

test('Shipped Units (Week 12) → 12', () => {
  assert(extractWeekNumber('Shipped Units (Week 12)') === 12);
});

test('No week → null', () => {
  assert(extractWeekNumber('GMS Total') === null);
});

test('Week1 no space → 1', () => {
  assert(extractWeekNumber('GMS (Week1)') === 1);
});

// ── parseFilename ────────────────────────────────────────────────────────────

console.log('\n📄 parseFilename');

test('Standard filename', () => {
  const r = parseFilename('GMS_Week 6_ctc_by_SUBCAT.xlsx');
  assert(r && r.metric === 'GMS' && r.week === 6 && r.level === 'SUBCAT');
});

test('ASIN filename', () => {
  const r = parseFilename('NetPPMLessSD_Week 5_ctc_by_ASIN.xlsx');
  assert(r && r.metric === 'NetPPMLessSD' && r.level === 'ASIN');
});

test('Traffic filename', () => {
  const r = parseFilename('GVs_By_Week_123456.csv');
  assert(r && r.isTraffic === true);
});

test('Random filename returns null', () => {
  assert(parseFilename('random_data.xlsx') === null);
});

// ── detectMetricFromRows ─────────────────────────────────────────────────────

console.log('\n🔍 detectMetricFromRows');

test('Direct header format (row 0 has metric)', () => {
  const rows = [
    ['Product Subcategory Code', 'Description', 'GMS (Week 6)($)', 'WoW%', 'YoY%'],
    ['Total', 'Total', 1000000, 0.05, 0.10],
  ];
  const r = detectMetricFromRows(rows);
  assert(r && r.metric === 'GMS' && r.level === 'SUBCAT' && r.week === 6);
});

test('Merge-row format (row 0 has WoW/YoY, row 1 has headers)', () => {
  const rows = [
    [null, null, null, 'WoW Variance', null, null, 'YoY Variance'],
    ['ASIN', 'Item Name', 'ASP (Week 5)', 'WoW%', 'YoY%'],
    ['B00TEST', 'Test Item', 25.99, 0.01, -0.02],
  ];
  const r = detectMetricFromRows(rows);
  assert(r && r.metric === 'ASP' && r.level === 'ASIN' && r.week === 5);
});

test('Empty rows returns null', () => {
  assert(detectMetricFromRows([]) === null);
});

test('No metric in header returns null', () => {
  const rows = [
    ['Code', 'Name', 'Value', 'Change'],
    ['001', 'Test', 100, 5],
  ];
  assert(detectMetricFromRows(rows) === null);
});

// ── Summary ──────────────────────────────────────────────────────────────────

console.log(`\n📋 Results: ${passed} passed, ${failed} failed\n`);
if (failed > 0) {
  process.exit(1);
} else {
  console.log('All metric-detection tests passed! ✓');
}
