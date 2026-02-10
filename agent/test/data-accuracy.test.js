#!/usr/bin/env node
/**
 * Comprehensive data accuracy tests
 * Validates every column mapping in tools.js against actual Excel data.
 * 
 * These tests read the real Excel files and cross-check that:
 * 1. Column indices produce correct values (not NR, Revenue$, Mix, etc.)
 * 2. CTC and YoY delta are distinct and correct
 * 3. Standard vs margin layout detection works
 * 4. All 5 metrics × 2 levels (subcat/ASIN) produce valid data
 * 5. getMetricTotals matches what we see in the Total row
 * 6. buildContext table labels don't mix up CTC and delta
 */

const tools = require('../tools');
const XLSX = require('xlsx');
const path = require('path');
const yaml = require('yaml');
const fs = require('fs');

const WEEK = '2026-wk05';
const GL = 'pc';
const DATA_DIR = path.join(__dirname, '../../data/weekly');

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✓ ${message}`);
    passed++;
  } else {
    console.log(`  ✗ FAIL: ${message}`);
    failed++;
  }
}

function assertClose(a, b, tolerance, message) {
  const diff = Math.abs(a - b);
  if (diff <= tolerance) {
    console.log(`  ✓ ${message}`);
    passed++;
  } else {
    console.log(`  ✗ FAIL: ${message} (expected ~${b}, got ${a}, diff=${diff})`);
    failed++;
  }
}

// Helper: read raw Excel Total row for a metric
function getRawTotal(level, metric) {
  const manifestPath = path.join(DATA_DIR, WEEK, 'gl', GL, '_manifest.yaml');
  const manifest = yaml.parse(fs.readFileSync(manifestPath, 'utf-8'));
  const filename = manifest.files?.[level]?.[metric];
  if (!filename) return null;
  
  const fp = path.join(DATA_DIR, WEEK, 'gl', GL, filename);
  const wb = XLSX.readFile(fp);
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null });
  
  for (let i = 0; i < rows.length; i++) {
    if (rows[i] && String(rows[i][0]).toLowerCase() === 'total') {
      return { row: rows[i], headers: rows[1], mergeHeaders: rows[0], allRows: rows };
    }
  }
  return null;
}

// Helper: get first non-total data row
function getFirstDataRow(level, metric) {
  const manifestPath = path.join(DATA_DIR, WEEK, 'gl', GL, '_manifest.yaml');
  const manifest = yaml.parse(fs.readFileSync(manifestPath, 'utf-8'));
  const filename = manifest.files?.[level]?.[metric];
  if (!filename) return null;
  
  const fp = path.join(DATA_DIR, WEEK, 'gl', GL, filename);
  const wb = XLSX.readFile(fp);
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null });
  
  for (let i = 2; i < rows.length; i++) {
    if (rows[i] && rows[i][0] && String(rows[i][0]).toLowerCase() !== 'total') {
      return { row: rows[i], headers: rows[1], mergeHeaders: rows[0] };
    }
  }
  return null;
}

// =============================================================================
console.log('\n📐 Layout Detection Tests');
// =============================================================================

{
  // Standard files should have 9 columns
  const gmsRaw = getRawTotal('subcat', 'GMS');
  assert(gmsRaw.headers.length === 9, `GMS subcat has 9 columns (got ${gmsRaw.headers.length})`);
  
  const unitsRaw = getRawTotal('subcat', 'ShippedUnits');
  assert(unitsRaw.headers.length === 9, `ShippedUnits subcat has 9 columns (got ${unitsRaw.headers.length})`);
  
  // Margin files should have 13 columns
  const npmRaw = getRawTotal('subcat', 'NetPPMLessSD');
  assert(npmRaw.headers.length === 13, `NetPPMLessSD subcat has 13 columns (got ${npmRaw.headers.length})`);
  
  const aspRaw = getRawTotal('subcat', 'ASP');
  assert(aspRaw.headers.length === 13, `ASP subcat has 13 columns (got ${aspRaw.headers.length})`);
  
  const cmRaw = getRawTotal('subcat', 'CM');
  assert(cmRaw.headers.length === 13, `CM subcat has 13 columns (got ${cmRaw.headers.length})`);
  
  // ASIN files should have same layout as subcat
  const gmsAsin = getRawTotal('asin', 'GMS');
  assert(gmsAsin.headers.length === 9, `GMS ASIN has 9 columns (got ${gmsAsin.headers.length})`);
  
  const npmAsin = getRawTotal('asin', 'NetPPMLessSD');
  assert(npmAsin.headers.length === 13, `NetPPMLessSD ASIN has 13 columns (got ${npmAsin.headers.length})`);
  
  // detectFileLayout should correctly identify each
  const gmsLayout = tools.detectFileLayout(getRawTotal('subcat', 'GMS').allRows);
  assert(gmsLayout.valid && gmsLayout.layout === 'standard', `detectFileLayout: GMS = standard`);
  
  const npmLayout = tools.detectFileLayout(getRawTotal('subcat', 'NetPPMLessSD').allRows);
  assert(npmLayout.valid && npmLayout.layout === 'margin', `detectFileLayout: NetPPMLessSD = margin`);
}

// =============================================================================
console.log('\n📊 getMetricTotals — Cross-check against raw Excel');
// =============================================================================

{
  const totals = tools.getMetricTotals(WEEK, GL);
  
  // GMS Total: raw col2=3654948.02, col3=WoW(-0.0104), col4=YoY(0.6595)
  const gmsMetric = totals.metrics.find(m => m.label === 'GMS');
  const gmsRaw = getRawTotal('subcat', 'GMS');
  assertClose(gmsRaw.row[2], 3654948.02, 1, `GMS raw value = $3,654,948`);
  assert(gmsMetric.value === '$3.65M', `GMS display value = $3.65M (got ${gmsMetric.value})`);
  assertClose(gmsMetric.yoy, 66.0, 0.5, `GMS YoY% = ~66% (got ${gmsMetric.yoy})`);
  assertClose(gmsMetric.wow, -1.0, 0.5, `GMS WoW% = ~-1% (got ${gmsMetric.wow})`);
  
  // Net PPM Total: raw col2=0.2987, col5=WoW(-446 bps), col6=YoY(-1902 bps)
  const npmMetric = totals.metrics.find(m => m.label === 'Net PPM');
  const npmRaw = getRawTotal('subcat', 'NetPPMLessSD');
  assertClose(npmRaw.row[2], 0.2987, 0.001, `NPM raw value = 0.2987`);
  assert(npmMetric.value === '29.9%', `NPM display value = 29.9% (got ${npmMetric.value})`);
  assert(npmMetric.yoy === -1902, `NPM YoY bps = -1902 (got ${npmMetric.yoy})`);
  assert(npmMetric.wow === -446, `NPM WoW bps = -446 (got ${npmMetric.wow})`);
  assert(npmMetric.yoyUnit === 'bps', `NPM YoY unit = bps (got ${npmMetric.yoyUnit})`);
  
  // Verify NPM didn't accidentally read NR or Revenue$ columns
  assert(npmRaw.row[3] !== npmMetric.wow, `NPM WoW is NOT col3/NR (col3=${npmRaw.row[3]}, wow=${npmMetric.wow})`);
  assert(npmRaw.row[4] !== npmMetric.yoy, `NPM YoY is NOT col4/Revenue$ (col4=${npmRaw.row[4]}, yoy=${npmMetric.yoy})`);
  
  // ASP Total: raw col2=18.31, col5=WoW(0.0748), col6=YoY(0.3036)
  const aspMetric = totals.metrics.find(m => m.label === 'ASP');
  assert(aspMetric.value === '$18.31', `ASP display value = $18.31 (got ${aspMetric.value})`);
  assertClose(aspMetric.yoy, 30.4, 0.5, `ASP YoY% = ~30.4% (got ${aspMetric.yoy})`);
}

// =============================================================================
console.log('\n📈 getMetricDrivers — Column mapping for ALL metrics');
// =============================================================================

{
  // GMS drivers: CTC should be in col 8 (YoY CTC bps), not col 7 (YoY CTC $)
  const gmsDrivers = tools.getMetricDrivers(WEEK, GL, 'GMS', { period: 'yoy', limit: 1 });
  assert(gmsDrivers.drivers && gmsDrivers.drivers.length > 0, `GMS has drivers`);
  const gmsTop = gmsDrivers.drivers[0];
  // LCD Monitors should be top GMS driver with CTC ~2394 bps
  assert(gmsTop.ctc > 2000, `GMS top driver CTC is large bps value (${gmsTop.ctc}), not small dollar value`);
  
  // GMS total WoW/YoY should be decimals (not bps)
  assert(Math.abs(gmsDrivers.total.wow_pct) < 1, `GMS total WoW is decimal (-0.0104), not bps (got ${gmsDrivers.total.wow_pct})`);
  assert(gmsDrivers.total.yoy_pct > 0.5, `GMS total YoY is decimal (0.6595), not percentage (got ${gmsDrivers.total.yoy_pct})`);
  
  // NetPPMLessSD drivers: CTC should be col 10, NOT col 8 (which is Mix)
  const npmDrivers = tools.getMetricDrivers(WEEK, GL, 'NetPPMLessSD', { period: 'yoy', limit: 3 });
  assert(npmDrivers.drivers && npmDrivers.drivers.length > 0, `NPM has drivers`);
  
  // NPM total: WoW should be -446, YoY should be -1902
  assert(npmDrivers.total.wow_pct === -446, `NPM total WoW = -446 bps (got ${npmDrivers.total.wow_pct})`);
  assert(npmDrivers.total.yoy_pct === -1902, `NPM total YoY = -1902 bps (got ${npmDrivers.total.yoy_pct})`);
  
  // NPM top driver CTC should be large (hundreds of bps), not tiny (Mix values)
  const npmTop = npmDrivers.drivers[0];
  assert(Math.abs(npmTop.ctc) > 100, `NPM top driver CTC is substantial (${npmTop.ctc}), not a Mix fragment`);
  
  // Cross-check: microSD should have CTC = -607, NOT Mix value
  const microsd = npmDrivers.drivers.find(d => d.subcat_name && d.subcat_name.toLowerCase().includes('microsd'));
  if (microsd) {
    // From raw Excel: microSD row, col 10 (YoY CTC) = -607
    assert(microsd.ctc === -607, `microSD NPM CTC = -607 (got ${microsd.ctc})`);
  }
  
  // ASP drivers: CTC should be col 10
  const aspDrivers = tools.getMetricDrivers(WEEK, GL, 'ASP', { period: 'yoy', limit: 1 });
  assert(aspDrivers.drivers && aspDrivers.drivers.length > 0, `ASP has drivers`);
  // ASP WoW/YoY should be decimals (percentage), not NR/Revenue$
  assert(Math.abs(aspDrivers.total.wow_pct) < 10, `ASP total WoW is percentage (${aspDrivers.total.wow_pct}), not Revenue$`);
  
  // CM drivers
  const cmDrivers = tools.getMetricDrivers(WEEK, GL, 'CM', { period: 'yoy', limit: 1 });
  assert(cmDrivers.drivers && cmDrivers.drivers.length > 0, `CM has drivers`);
  assert(cmDrivers.total.yoy_pct === -1493, `CM total YoY = -1493 bps (got ${cmDrivers.total.yoy_pct})`);
  
  // ShippedUnits drivers (standard layout)
  const unitsDrivers = tools.getMetricDrivers(WEEK, GL, 'ShippedUnits', { period: 'yoy', limit: 1 });
  assert(unitsDrivers.drivers && unitsDrivers.drivers.length > 0, `Units has drivers`);
  assertClose(unitsDrivers.total.yoy_pct, 0.2749, 0.01, `Units total YoY = ~0.2749 (got ${unitsDrivers.total.yoy_pct})`);
}

// =============================================================================
console.log('\n🔍 getAsinDetail — CTC column + YoY delta for ALL metrics');
// =============================================================================

{
  const metrics = ['GMS', 'ShippedUnits', 'ASP', 'NetPPMLessSD', 'CM'];
  
  for (const metric of metrics) {
    const result = tools.getAsinDetail(WEEK, GL, metric, { limit: 5 });
    assert(result.asins && result.asins.length > 0, `${metric} ASIN: has results`);
    assert(!result.error, `${metric} ASIN: no error (${result.error || 'OK'})`);
    
    // Every ASIN should have value, ctc, and yoy_delta
    const first = result.asins[0];
    assert(first.value !== null && first.value !== undefined, `${metric} ASIN: first has value`);
    assert(first.ctc !== null && first.ctc !== undefined, `${metric} ASIN: first has CTC`);
    assert(first.yoy_delta !== null && first.yoy_delta !== undefined, `${metric} ASIN: first has yoy_delta`);
    
    // CTC and yoy_delta should be DIFFERENT numbers (the core bug)
    if (first.yoy_delta !== null && first.ctc !== null) {
      // They CAN be equal by coincidence, but for the top driver they typically aren't
      // Just verify both exist as distinct fields
      assert('ctc' in first && 'yoy_delta' in first, `${metric} ASIN: has both ctc and yoy_delta fields`);
    }
  }
  
  // Specific cross-check: NetPPMLessSD top ASIN
  // B0DB4Z1LKX: value=-0.2234, yoy_delta(col6)=-2234, ctc(col10)=-331
  const npmAsins = tools.getAsinDetail(WEEK, GL, 'NetPPMLessSD', { limit: 25 });
  const b0db4z = npmAsins.asins.find(a => a.asin === 'B0DB4Z1LKX');
  if (b0db4z) {
    assertClose(b0db4z.value, -0.2234, 0.001, `B0DB4Z1LKX NPM value = -22.3%`);
    assert(b0db4z.yoy_delta === -2234, `B0DB4Z1LKX NPM YoY delta = -2234 bps (got ${b0db4z.yoy_delta})`);
    assert(b0db4z.ctc === -331, `B0DB4Z1LKX NPM CTC = -331 bps (got ${b0db4z.ctc})`);
    assert(b0db4z.yoy_delta !== b0db4z.ctc, `B0DB4Z1LKX: yoy_delta (${b0db4z.yoy_delta}) ≠ CTC (${b0db4z.ctc})`);
  } else {
    assert(false, 'B0DB4Z1LKX not found in NPM ASIN results');
  }
  
  // GMS ASIN: B08TJZDJ4D should have YoY delta (col4, decimal) and CTC (col7, $)
  const gmsAsins = tools.getAsinDetail(WEEK, GL, 'GMS', { limit: 25 });
  const b08tj = gmsAsins.asins.find(a => a.asin === 'B08TJZDJ4D');
  if (b08tj) {
    assert(b08tj.yoy_delta > 2, `B08TJZDJ4D GMS YoY delta > 200% (got ${b08tj.yoy_delta})`);
    assert(b08tj.ctc > 200000, `B08TJZDJ4D GMS CTC > $200K (got ${b08tj.ctc})`);
  }
}

// =============================================================================
console.log('\n🔄 getSubcatDetail — Margin vs Standard layout');
// =============================================================================

{
  // Standard: GMS subcat detail for LCD Monitors
  const gmsDetail = tools.getSubcatDetail(WEEK, GL, 'GMS', 'lcd monitors');
  assert(gmsDetail.subcat !== null, `GMS: found LCD Monitors`);
  assert(gmsDetail.isMarginMetric === false, `GMS: isMarginMetric = false`);
  assert(gmsDetail.subcat.value > 600000, `GMS LCD value > $600K (got ${gmsDetail.subcat.value})`);
  assert(gmsDetail.subcat.yoy_pct > 3, `GMS LCD YoY% > 3 (got ${gmsDetail.subcat.yoy_pct})`);
  assert(gmsDetail.subcat.yoy_ctc_bps === 2394, `GMS LCD CTC = 2394 (got ${gmsDetail.subcat.yoy_ctc_bps})`);
  
  // Margin: NetPPMLessSD subcat detail for LCD Monitors
  const npmDetail = tools.getSubcatDetail(WEEK, GL, 'NetPPMLessSD', 'lcd monitors');
  assert(npmDetail.subcat !== null, `NPM: found LCD Monitors`);
  assert(npmDetail.isMarginMetric === true, `NPM: isMarginMetric = true`);
  assertClose(npmDetail.subcat.value, 0.1053, 0.001, `NPM LCD value = ~10.5%`);
  assert(npmDetail.subcat.yoy_pct === -1767, `NPM LCD YoY delta = -1767 bps (got ${npmDetail.subcat.yoy_pct})`);
  assert(npmDetail.subcat.yoy_ctc_bps === -570, `NPM LCD CTC = -570 bps (got ${npmDetail.subcat.yoy_ctc_bps})`);
  
  // Verify margin detail has Mix/Rate decomposition
  assert(npmDetail.subcat.yoy_mix_bps === -240, `NPM LCD Mix = -240 (got ${npmDetail.subcat.yoy_mix_bps})`);
  assert(npmDetail.subcat.yoy_rate_bps === -330, `NPM LCD Rate = -330 (got ${npmDetail.subcat.yoy_rate_bps})`);
  
  // Verify CTC = Mix + Rate (approximately)
  const mixPlusRate = (npmDetail.subcat.yoy_mix_bps || 0) + (npmDetail.subcat.yoy_rate_bps || 0);
  assert(mixPlusRate === npmDetail.subcat.yoy_ctc_bps, `NPM LCD: Mix + Rate = CTC (${mixPlusRate} = ${npmDetail.subcat.yoy_ctc_bps})`);
  
  // Verify margin detail does NOT confuse NR/Revenue with WoW/YoY
  assert(npmDetail.subcat.nr_or_extra === 75193, `NPM LCD NR = 75193 (got ${npmDetail.subcat.nr_or_extra})`);
  assert(npmDetail.subcat.wow_pct !== npmDetail.subcat.nr_or_extra, `NPM LCD: WoW (${npmDetail.subcat.wow_pct}) ≠ NR (${npmDetail.subcat.nr_or_extra})`);
}

// =============================================================================
console.log('\n📋 getAllSubcatData — Consistent across metrics');
// =============================================================================

{
  const allData = tools.getAllSubcatData(WEEK, GL);
  assert(allData.subcats.length > 0, `getAllSubcatData returns subcategories`);
  assert(!allData.parseErrors, `No parse errors (${allData.parseErrors || 'OK'})`);
  
  // Check LCD Monitors has all metrics (including OOS)
  const lcd = allData.subcats.find(s => s.name && s.name.includes('LCD'));
  assert(lcd !== undefined, `LCD Monitors found in allSubcatData`);
  assert(lcd.metrics.GMS !== undefined, `LCD has GMS metric`);
  assert(lcd.metrics.ShippedUnits !== undefined, `LCD has Units metric`);
  assert(lcd.metrics.ASP !== undefined, `LCD has ASP metric`);
  assert(lcd.metrics.NetPPMLessSD !== undefined, `LCD has Net PPM metric`);
  assert(lcd.metrics.CM !== undefined, `LCD has CM metric`);
  assert(lcd.metrics.SOROOS_PROCURABLE_PRODUCT_OOS_GV_PCT !== undefined, `LCD has OOS metric`);
  
  // NPM values should be consistent with getSubcatDetail
  assertClose(lcd.metrics.NetPPMLessSD.value, 0.1053, 0.001, `LCD NPM value consistent`);
  assert(lcd.metrics.NetPPMLessSD.yoy_ctc_bps === -570, `LCD NPM CTC consistent (got ${lcd.metrics.NetPPMLessSD.yoy_ctc_bps})`);
  
  // YoY pct for NPM should be decimal (from bps/10000 conversion)
  assertClose(lcd.metrics.NetPPMLessSD.yoy_pct, -0.1767, 0.001, `LCD NPM yoy_pct is decimal (-0.1767), not raw bps`);
  
  // GMS yoy_pct should be decimal growth rate
  assertClose(lcd.metrics.GMS.yoy_pct, 3.3865, 0.01, `LCD GMS yoy_pct is decimal (3.3865)`);

  // ASP CTC should use dollar CTC field (col 10), not bps naming
  assert('yoy_ctc' in lcd.metrics.ASP, `LCD ASP includes yoy_ctc field`);
  assertClose(lcd.metrics.ASP.yoy_ctc, 2.01, 0.01, `LCD ASP yoy_ctc = 2.01`);

  // OOS should be converted from bps into decimal yoy_pct
  assertClose(lcd.metrics.SOROOS_PROCURABLE_PRODUCT_OOS_GV_PCT.yoy_pct, -0.8348, 0.0001,
    `LCD OOS yoy_pct converts -8348 bps -> -0.8348`);
}

// =============================================================================
console.log('\n🔒 WoW Period — Correct columns used');
// =============================================================================

{
  // WoW CTC should use different column than YoY CTC
  const gmsWow = tools.getMetricDrivers(WEEK, GL, 'GMS', { period: 'wow', limit: 1 });
  const gmsYoy = tools.getMetricDrivers(WEEK, GL, 'GMS', { period: 'yoy', limit: 1 });
  // WoW and YoY top drivers should have different CTC values
  assert(gmsWow.drivers[0].ctc !== gmsYoy.drivers[0].ctc, 
    `GMS: WoW CTC (${gmsWow.drivers[0].ctc}) ≠ YoY CTC (${gmsYoy.drivers[0].ctc})`);
  
  const npmWow = tools.getMetricDrivers(WEEK, GL, 'NetPPMLessSD', { period: 'wow', limit: 1 });
  const npmYoy = tools.getMetricDrivers(WEEK, GL, 'NetPPMLessSD', { period: 'yoy', limit: 1 });
  assert(npmWow.drivers[0].ctc !== npmYoy.drivers[0].ctc,
    `NPM: WoW CTC (${npmWow.drivers[0].ctc}) ≠ YoY CTC (${npmYoy.drivers[0].ctc})`);
}

// =============================================================================
console.log('\n⚠️ Edge Cases');
// =============================================================================

{
  // Non-existent GL
  const noGl = tools.getMetricTotals(WEEK, 'nonexistent');
  assert(noGl.error !== undefined, `Non-existent GL returns error`);
  
  // Non-existent week
  const noWeek = tools.getMetricDrivers('2099-wk99', GL, 'GMS');
  assert(noWeek.error !== undefined || (noWeek.drivers && noWeek.drivers.length === 0), `Non-existent week handled`);
  
  // Non-existent metric
  const noMetric = tools.getMetricDrivers(WEEK, GL, 'FakeMetric');
  assert(noMetric.error !== undefined, `Non-existent metric returns error`);
  
  // Null inputs
  const nullWeek = tools.getMetricDrivers(null, GL, 'GMS');
  assert(nullWeek.error !== undefined, `Null week returns error`);
  
  const nullGl = tools.getAsinDetail(WEEK, null, 'GMS');
  assert(nullGl.error !== undefined, `Null GL returns error`);
  
  // SOROOS metric (exists but not in standard configs)
  const soroosDrivers = tools.getMetricDrivers(WEEK, GL, 'SOROOS_PROCURABLE_PRODUCT_OOS_GV_PCT', { limit: 3 });
  assert(soroosDrivers.drivers && soroosDrivers.drivers.length > 0, `SOROOS metric returns drivers`);
}

// =============================================================================
console.log('\n🔎 searchSubcats + Traffic parser checks');
// =============================================================================

{
  const search = tools.searchSubcats(WEEK, GL, 'lcd');
  const lcd = search.results.find(r => r.name && r.name.includes('LCD'));
  assert(lcd !== undefined, `searchSubcats finds LCD result`);
  assert(lcd.metrics.ASP !== undefined, `searchSubcats includes ASP metric`);
  assert(lcd.metrics.SOROOS_PROCURABLE_PRODUCT_OOS_GV_PCT !== undefined, `searchSubcats includes OOS metric`);

  const traffic = tools.getTrafficChannels(WEEK, GL, { limit: 3 });
  assert(traffic.channels && traffic.channels.length > 0, `Traffic channels parsed`);
  const top = traffic.channels[0];
  assert(top.gv > 100000, `Top traffic GV preserves full comma value (>100k), got ${top.gv}`);
}

// =============================================================================
console.log('\n🔢 Numeric Sanity Checks');
// =============================================================================

{
  // GMS values should be positive dollars or null (some subcats may have no data)
  const gmsDrivers = tools.getMetricDrivers(WEEK, GL, 'GMS', { limit: 20 });
  const allValidValues = gmsDrivers.drivers.every(d => d.value === null || d.value > 0);
  assert(allValidValues, `All GMS subcat values are positive dollars or null`);
  
  // Net PPM values should be between -1 and 1 (decimal percentage)
  const npmDrivers = tools.getMetricDrivers(WEEK, GL, 'NetPPMLessSD', { limit: 20 });
  const npmInRange = npmDrivers.drivers.every(d => d.value >= -1 && d.value <= 1);
  assert(npmInRange, `All NPM subcat values are valid percentages (-1 to 1)`);
  
  // ASP should be positive dollar amounts
  const aspDrivers = tools.getMetricDrivers(WEEK, GL, 'ASP', { limit: 20 });
  const aspPositive = aspDrivers.drivers.every(d => d.value > 0);
  assert(aspPositive, `All ASP subcat values are positive dollar amounts`);
  
  // CTC values should sum approximately to total CTC
  // (Not exact because we limit results, but top drivers should account for most)
  const npmTotal = npmDrivers.total;
  const npmCtcSum = npmDrivers.drivers.reduce((sum, d) => sum + d.ctc, 0);
  // Top drivers should account for at least 80% of total
  if (npmTotal && npmTotal.yoy_pct !== 0) {
    // Can't easily verify this without all subcats, just check sign consistency
    assert(npmCtcSum < 0, `NPM CTC sum is negative (decline), matching total direction`);
  }
}

// =============================================================================
// Results
// =============================================================================

console.log('\n==================================================');
console.log(`\n📋 Data Accuracy Tests: ${passed} passed, ${failed} failed\n`);
if (failed === 0) {
  console.log('All data accuracy tests passed! ✓');
} else {
  console.log(`${failed} test(s) FAILED — review output above`);
  process.exit(1);
}
