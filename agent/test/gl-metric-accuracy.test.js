#!/usr/bin/env node
/**
 * GL-Level Metric Accuracy Tests
 *
 * Validates that GL-level metrics computed from ALL consolidated data
 * (via getMetricTotals and getMetricDrivers) are accurate by comparing
 * against the PC per-GL file's pre-computed Total row values.
 *
 * These tests specifically catch the "revenue-weighted averaging" mistake
 * for margin metrics (NPPM, CM, ASP). The correct approach uses
 * cross-metric denominator estimation to account for mix effects.
 *
 * IMPORTANT: If you are modifying getMetricTotals or getMetricDrivers,
 * run these tests to ensure GL-level totals remain accurate.
 * DO NOT use revenue-weighted averaging of per-subcat bps changes for
 * margin metrics — it misses the mix effect and gives wrong WoW/YoY.
 *
 * Run: node test/gl-metric-accuracy.test.js
 * Requires: data/weekly/2026-wk06/gl/all/ AND data/weekly/2026-wk06/gl/pc/
 */

const XLSX = require('xlsx');
const path = require('path');
const fs = require('fs');
const yaml = require('yaml');
const tools = require('../tools');

const WK06_ALL_DIR = path.join(__dirname, '..', '..', 'data', 'weekly', '2026-wk06', 'gl', 'all');
const WK06_PC_DIR = path.join(__dirname, '..', '..', 'data', 'weekly', '2026-wk06', 'gl', 'pc');

if (!fs.existsSync(WK06_ALL_DIR) || !fs.existsSync(WK06_PC_DIR)) {
  console.log('⚠ Need both ALL and PC data in data/weekly/2026-wk06/ — skipping GL accuracy tests');
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

function assertApprox(actual, expected, tol, msg) {
  if (Math.abs(actual - expected) > tol) {
    throw new Error(msg || `Expected ~${expected} ± ${tol}, got ${actual} (diff: ${(actual - expected).toFixed(4)})`);
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'Assertion failed');
}

// Load PC per-GL manifest and raw Total rows as reference
const pcManifest = yaml.parse(fs.readFileSync(path.join(WK06_PC_DIR, '_manifest.yaml'), 'utf-8'));

function loadPCTotal(metricKey) {
  const filename = pcManifest.files?.subcat?.[metricKey];
  if (!filename) return null;
  const wb = XLSX.readFile(path.join(WK06_PC_DIR, filename));
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: null });
  for (const row of rows) {
    if (row && String(row[0]).toLowerCase() === 'total') return row;
  }
  return null;
}

// =============================================================================
// 1. getMetricTotals — GL-computed values vs PC per-GL file Total rows
//
// These tests catch the critical bug where margin metric WoW/YoY is computed
// using revenue-weighted averaging (WRONG) instead of the cross-metric
// denominator approach (CORRECT).
//
// The revenue-weighted approach gives: NPPM WoW ≈ 189 bps (WRONG)
// The correct approach gives:          NPPM WoW ≈ 276 bps (close to truth 270)
// =============================================================================
console.log('\n🎯 GL Metric Totals — Value Accuracy');

const pcTotals = tools.getMetricTotals('2026-wk06', 'pc');
assert(pcTotals.metrics && pcTotals.metrics.length > 0, 'getMetricTotals returned no metrics');

// --- NetPPMLessSD ---
const nppmRef = loadPCTotal('NetPPMLessSD');
const nppmComputed = pcTotals.metrics.find(m => m.name === 'netppmlesssd');

test('NPPM value within 1pp of PC reference (32.57%)', () => {
  // PC file Total: 32.57%. Our computed: ~32.27% (missing UNKNOWN + 1 shared subcat).
  // Tolerance: 1pp (0.01 as ratio) accounts for unmappable subcats.
  assertApprox(nppmComputed.sparkline[0], nppmRef[2], 0.01,
    `NPPM value: computed ${(nppmComputed.sparkline[0] * 100).toFixed(2)}% vs reference ${(nppmRef[2] * 100).toFixed(2)}%`);
});

test('NPPM WoW within 30 bps of PC reference (270 bps)', () => {
  // This is the KEY test. Revenue-weighted averaging gives ~189 bps (WRONG).
  // Cross-metric approach gives ~276 bps. Truth is 270 bps.
  // If this fails with error > 30 bps, the WoW computation is likely broken.
  assertApprox(nppmComputed.wow, nppmRef[5], 30,
    `NPPM WoW: computed ${nppmComputed.wow} bps vs reference ${nppmRef[5]} bps. ` +
    `If error > 80 bps, you are probably using revenue-weighted averaging ` +
    `instead of the cross-metric denominator approach.`);
});

test('NPPM YoY within 200 bps of PC reference (-1406 bps)', () => {
  // YoY has larger residual (~100 bps) because NPPM denominator !== GMS exactly.
  // Revenue-weighted gives ~-625 bps (WRONG). Cross-metric gives ~-1305 bps.
  assertApprox(nppmComputed.yoy, nppmRef[6], 200,
    `NPPM YoY: computed ${nppmComputed.yoy} bps vs reference ${nppmRef[6]} bps. ` +
    `If error > 500 bps, WoW/YoY computation is likely broken.`);
});

// --- CM ---
const cmRef = loadPCTotal('CM');
const cmComputed = pcTotals.metrics.find(m => m.name === 'cm');

test('CM value within 0.5pp of PC reference (-0.93%)', () => {
  assertApprox(cmComputed.sparkline[0], cmRef[2], 0.005,
    `CM value: computed ${(cmComputed.sparkline[0] * 100).toFixed(2)}% vs reference ${(cmRef[2] * 100).toFixed(2)}%`);
});

test('CM WoW within 30 bps of PC reference (286 bps)', () => {
  assertApprox(cmComputed.wow, cmRef[5], 30,
    `CM WoW: computed ${cmComputed.wow} bps vs reference ${cmRef[5]} bps. ` +
    `If error > 50 bps, check the cross-metric denominator approach.`);
});

test('CM YoY within 150 bps of PC reference (-1066 bps)', () => {
  assertApprox(cmComputed.yoy, cmRef[6], 150,
    `CM YoY: computed ${cmComputed.yoy} bps vs reference ${cmRef[6]} bps`);
});

// --- ASP ---
const aspRef = loadPCTotal('ASP');
const aspComputed = pcTotals.metrics.find(m => m.name === 'asp');

test('ASP value within $1 of PC reference', () => {
  assertApprox(aspComputed.sparkline[0], aspRef[2], 1.0,
    `ASP value: computed $${aspComputed.sparkline[0].toFixed(2)} vs reference $${aspRef[2].toFixed(2)}`);
});

test('ASP WoW within 2pp of PC reference', () => {
  // ASP WoW is fractional (e.g., 0.0256 = 2.56%), displayed as wow * 100
  const computedPct = aspComputed.wow; // already multiplied by 100
  const refPct = aspRef[5] * 100;
  assertApprox(computedPct, refPct, 2.0,
    `ASP WoW: computed ${computedPct.toFixed(1)}% vs reference ${refPct.toFixed(1)}%`);
});

test('ASP YoY sign matches PC reference', () => {
  const computedSign = Math.sign(aspComputed.yoy);
  const refSign = Math.sign(aspRef[6]);
  assert(computedSign === refSign || aspComputed.yoy === 0,
    `ASP YoY sign mismatch: computed ${aspComputed.yoy.toFixed(1)}% vs reference ${(aspRef[6] * 100).toFixed(1)}%`);
});

// --- GMS (absolute metric, simpler) ---
const gmsRef = loadPCTotal('GMS');
const gmsComputed = pcTotals.metrics.find(m => m.name === 'gms');

test('GMS value within 5% of PC reference', () => {
  const pctDiff = Math.abs(gmsComputed.sparkline[0] - gmsRef[2]) / Math.abs(gmsRef[2]);
  assert(pctDiff < 0.05,
    `GMS value: computed ${gmsComputed.sparkline[0].toFixed(0)} vs reference ${gmsRef[2].toFixed(0)} (${(pctDiff * 100).toFixed(1)}% diff)`);
});

// =============================================================================
// 2. getMetricDrivers — GL total should match getMetricTotals
//    (cross-function parity for GL-filtered metrics)
// =============================================================================
console.log('\n🔗 GL Cross-Function Parity');

for (const metric of ['NetPPMLessSD', 'CM', 'GMS']) {
  const drivers = tools.getMetricDrivers('2026-wk06', 'pc', metric, { period: 'yoy', limit: 5 });
  const totalsMetric = pcTotals.metrics.find(m => m.name === metric.toLowerCase());

  test(`${metric}: getMetricDrivers total.value ≈ getMetricTotals value`, () => {
    assert(drivers.total, `getMetricDrivers returned no total for ${metric}`);
    const driverVal = drivers.total.value;
    const totalVal = totalsMetric.sparkline[0];
    assertApprox(driverVal, totalVal, 0.001,
      `${metric} value mismatch: drivers=${driverVal}, totals=${totalVal}`);
  });

  test(`${metric}: getMetricDrivers total.yoy_pct ≈ getMetricTotals yoy`, () => {
    const driverYoy = drivers.total.yoy_pct;
    let totalYoy = totalsMetric.yoy;
    // getMetricTotals applies multiplier: GMS yoy is *100 (%), margin is bps (no mult)
    // getMetricDrivers returns raw values: GMS yoy is fraction, margin is bps
    if (metric === 'GMS') totalYoy = totalYoy / 100; // convert % back to fraction
    const tol = metric === 'GMS' ? 0.01 : 30;
    assertApprox(driverYoy, totalYoy, tol,
      `${metric} YoY mismatch: drivers=${driverYoy}, totals=${totalYoy}`);
  });
}

// =============================================================================
// 3. Anti-regression: Revenue-weighted averaging MUST NOT be used
//    These tests have TIGHT tolerances that ONLY pass with the cross-metric
//    approach. Revenue-weighted averaging gives values far outside these bounds.
// =============================================================================
console.log('\n🛡️  Anti-Regression: Cross-Metric Approach Required');

test('NPPM WoW is NOT ~189 bps (revenue-weighted bug)', () => {
  // Revenue-weighted gives ~189. Cross-metric gives ~276. Truth is 270.
  // If wow is between 170-210, it means someone reverted to revenue-weighted.
  assert(nppmComputed.wow > 220 || nppmComputed.wow < 150,
    `NPPM WoW = ${nppmComputed.wow} bps — this looks like revenue-weighted averaging (expected ~189). ` +
    `Should be ~276 bps using cross-metric denominator approach. ` +
    `See data/METRIC_CALCULATION_GUIDE.md for the correct formula.`);
});

test('NPPM YoY is NOT ~-625 bps (revenue-weighted bug)', () => {
  assert(nppmComputed.yoy < -800,
    `NPPM YoY = ${nppmComputed.yoy} bps — this looks like revenue-weighted averaging (expected ~-625). ` +
    `Should be ~-1305 bps using cross-metric denominator approach.`);
});

test('CM WoW is NOT ~248 bps (revenue-weighted bug)', () => {
  assert(cmComputed.wow > 260 || cmComputed.wow < 220,
    `CM WoW = ${cmComputed.wow} bps — this looks like revenue-weighted averaging (expected ~248). ` +
    `Should be ~289 bps using cross-metric denominator approach.`);
});

test('CM YoY is NOT ~-693 bps (revenue-weighted bug)', () => {
  assert(cmComputed.yoy < -800,
    `CM YoY = ${cmComputed.yoy} bps — this looks like revenue-weighted averaging (expected ~-693). ` +
    `Should be ~-1011 bps using cross-metric denominator approach.`);
});

// =============================================================================
// 4. Margin metric formula: value must equal sum(num)/sum(den), NOT average of %
// =============================================================================
console.log('\n📐 Margin Value = sum(num)/sum(den)');

const allManifest = yaml.parse(fs.readFileSync(path.join(WK06_ALL_DIR, '_manifest.yaml'), 'utf-8'));
const glSubcats = tools.getSubcatsForGL('pc');

for (const metric of ['NetPPMLessSD', 'CM']) {
  test(`${metric} GL value = sum(col3)/sum(col4) for GL subcats`, () => {
    const filename = allManifest.files?.subcat?.[metric];
    assert(filename, `No file for ${metric}`);
    const wb = XLSX.readFile(path.join(WK06_ALL_DIR, filename));
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: null });

    let sumNum = 0, sumDen = 0;
    for (let i = 2; i < rows.length; i++) {
      const row = rows[i];
      if (!row || !row[0]) continue;
      const code = String(row[0]).trim();
      if (code.toLowerCase() === 'total') continue;
      if (glSubcats && !glSubcats.has(code)) continue;
      sumNum += (row[3] || 0);
      sumDen += (row[4] || 0);
    }

    const computed = sumDen !== 0 ? sumNum / sumDen : null;
    const fromTool = pcTotals.metrics.find(m => m.name === metric.toLowerCase()).sparkline[0];
    assertApprox(fromTool, computed, 0.0001,
      `${metric}: tool value ${fromTool} != sum(num)/sum(den) ${computed}. ` +
      `Are you averaging percentages instead of computing the ratio?`);
  });
}

// =============================================================================
// Summary
// =============================================================================
console.log('\n' + '='.repeat(50));
console.log(`\n📋 GL Accuracy Tests: ${passed} passed, ${failed} failed`);

if (failures.length > 0) {
  console.log('\nFailures:');
  for (const f of failures) {
    console.log(`  ✗ ${f.name}`);
    console.log(`    ${f.error}\n`);
  }
  process.exit(1);
}

console.log('\nAll GL accuracy tests passed! ✓\n');
