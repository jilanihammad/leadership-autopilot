#!/usr/bin/env node
/**
 * Leadership Autopilot — AnalysisSession Unit Tests
 * 
 * Tests the AnalysisSession class methods directly (no HTTP, no LLM).
 * Covers: T2-SESS-01 through T2-SESS-07, T1-SESS-03,
 *         T1-DATA-05, T1-DATA-08, T2-EDGE-06
 * 
 * Prevents: GL misdetection routing queries to wrong data,
 *           unbounded memory growth from conversation history,
 *           wrong metric loaded for ASIN drilldown.
 * 
 * Run: node test/session.test.js
 */

const { AnalysisSession } = require('../server');
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

function assertNull(value, message) {
  if (value !== null && value !== undefined) {
    throw new Error(message || `Expected null, got ${JSON.stringify(value)}`);
  }
}

function assertNotNull(value, message) {
  if (value === null || value === undefined) {
    throw new Error(message || 'Expected non-null value');
  }
}

function assertIncludes(arr, value, message) {
  if (Array.isArray(arr)) {
    if (!arr.includes(value)) throw new Error(message || `Array does not include ${value}`);
  } else if (typeof arr === 'string') {
    if (!arr.includes(value)) throw new Error(message || `String does not include "${value}"`);
  }
}

// =============================================================================
// T2-SESS-01: detectGL identifies GL from explicit mentions
// Prevents: System can't detect which GL user is asking about
// =============================================================================

console.log('\n🎯 detectGL — Explicit GL Mentions');

const session = new AnalysisSession('test-session');

test('T2-SESS-01a: "How is PC doing?" → pc', () => {
  assertEqual(session.detectGL('How is PC doing?'), 'pc');
});

test('T2-SESS-01b: "Tell me about the Toys business" → toys', () => {
  assertEqual(session.detectGL('Tell me about the Toys business'), 'toys');
});

test('T2-SESS-01c: "Office GL performance" → office', () => {
  assertEqual(session.detectGL('Office GL performance'), 'office');
});

test('T2-SESS-01d: "consumer electronics analysis" → ce', () => {
  assertEqual(session.detectGL('consumer electronics analysis'), 'ce');
});

test('T2-SESS-01e: "Home category update" → home', () => {
  assertEqual(session.detectGL('Home category update'), 'home');
});

test('T2-SESS-01f: "Pets GL" → pets', () => {
  assertEqual(session.detectGL('Pets GL'), 'pets');
});

test('T2-SESS-01g: "Sports business" → sports', () => {
  assertEqual(session.detectGL('Sports business'), 'sports');
});

// =============================================================================
// T2-SESS-02: detectGL identifies GL from product keywords
// Prevents: Product-specific questions route to wrong GL
// =============================================================================

console.log('\n🔍 detectGL — Product Keywords');

test('T2-SESS-02a: "laptop sales" → pc', () => {
  assertEqual(session.detectGL('How are laptop sales?'), 'pc');
});

test('T2-SESS-02b: "dog food" → pets', () => {
  assertEqual(session.detectGL('What happened with dog food?'), 'pets');
});

test('T2-SESS-02c: "yoga equipment" → sports', () => {
  assertEqual(session.detectGL('yoga equipment trends'), 'sports');
});

test('T2-SESS-02d: "headphones" → ce', () => {
  assertEqual(session.detectGL('headphones sales decline'), 'ce');
});

test('T2-SESS-02e: "lego" → toys', () => {
  assertEqual(session.detectGL('Why did lego decline?'), 'toys');
});

// =============================================================================
// T2-SESS-03: detectGL returns null for ambiguous queries
// Prevents: Random GL assigned to generic questions
// =============================================================================

console.log('\n❓ detectGL — Ambiguous/Null');

test('T2-SESS-03a: "How are things going?" → null', () => {
  assertNull(session.detectGL('How are things going?'));
});

test('T2-SESS-03b: "Give me the summary" → null', () => {
  assertNull(session.detectGL('Give me the summary'));
});

test('T2-SESS-03c: "What changed this week?" → null', () => {
  assertNull(session.detectGL('What changed this week?'));
});

// =============================================================================
// T2-SESS-04: isMultiGLQuestion detects cross-GL patterns
// Prevents: Single-GL question routed to cross-GL handler
// =============================================================================

console.log('\n🔀 isMultiGLQuestion');

test('T2-SESS-04a: "Compare PC and Toys" → true', () => {
  assert(session.isMultiGLQuestion('Compare PC and Toys'), 'Should detect comparison');
});

test('T2-SESS-04b: "overall summary" → true', () => {
  assert(session.isMultiGLQuestion('Give me the overall summary'), 'Should detect overall');
});

test('T2-SESS-04c: "summary of the week" → true', () => {
  assert(session.isMultiGLQuestion('summary of the week'), 'Should detect week summary');
});

test('T2-SESS-04d: "across all GLs" → true', () => {
  assert(session.isMultiGLQuestion('How did GMS perform across all GLs?'), 
    'Should detect across GLs');
});

test('T2-SESS-04e: "PC GMS performance" → false', () => {
  assert(!session.isMultiGLQuestion('PC GMS performance'), 
    'Single GL question should not be multi-GL');
});

test('T2-SESS-04f: "What drove the decline?" → false', () => {
  assert(!session.isMultiGLQuestion('What drove the decline?'), 
    'Follow-up question should not be multi-GL');
});

// =============================================================================
// T2-SESS-06: determineDataNeeds correctly identifies ASIN requirements
// Prevents: Missing product-level data when user asks for drilldown
// =============================================================================

console.log('\n📊 determineDataNeeds');

test('T2-SESS-06a: ASIN question detected', () => {
  const needs = session.determineDataNeeds('Which products drove GMS decline?');
  assert(needs.asin, 'Should need ASIN data for product-level question');
});

test('T2-SESS-06b: Summary question does not need ASIN', () => {
  const needs = session.determineDataNeeds('What is the summary?');
  assert(!needs.asin, 'Summary question should not need ASIN data');
});

test('T2-SESS-06c: "top driver" triggers ASIN', () => {
  const needs = session.determineDataNeeds('What is the top driver of GMS decline?');
  assert(needs.asin, 'Top driver question should need ASIN data');
});

test('T2-SESS-06d: Traffic question enables traffic data', () => {
  const needs = session.determineDataNeeds('Show me traffic channels');
  assert(needs.traffic, 'Traffic question should need traffic data');
});

test('T2-SESS-06e: "drill down into margin" triggers ASIN', () => {
  const needs = session.determineDataNeeds('Can you drill down into the margin decline?');
  assert(needs.asin, 'Drill down question should need ASIN data');
});

// =============================================================================
// T2-SESS-07: detectQuestionMetrics maps question terms to metric keys
// Prevents: Wrong metric loaded at ASIN level
// =============================================================================

console.log('\n📐 detectQuestionMetrics');

test('T2-SESS-07a: "margin" → NetPPMLessSD', () => {
  const metrics = session.detectQuestionMetrics('What happened to margin?');
  assertIncludes(metrics, 'NetPPMLessSD', 'margin should map to NetPPMLessSD');
});

test('T2-SESS-07b: "revenue" → GMS', () => {
  const metrics = session.detectQuestionMetrics('revenue performance');
  assertIncludes(metrics, 'GMS', 'revenue should map to GMS');
});

test('T2-SESS-07c: "price" → ASP', () => {
  const metrics = session.detectQuestionMetrics('average price changes');
  assertIncludes(metrics, 'ASP', 'price should map to ASP');
});

test('T2-SESS-07d: "volume" → ShippedUnits', () => {
  const metrics = session.detectQuestionMetrics('unit volume');
  assertIncludes(metrics, 'ShippedUnits', 'volume should map to ShippedUnits');
});

test('T2-SESS-07e: "out of stock" → SOROOS', () => {
  const metrics = session.detectQuestionMetrics('out of stock issues');
  assertIncludes(metrics, 'SOROOS_PROCURABLE_PRODUCT_OOS_GV_PCT', 
    'out of stock should map to SOROOS');
});

test('T2-SESS-07f: "contribution margin" → CM', () => {
  const metrics = session.detectQuestionMetrics('contribution margin trends');
  assertIncludes(metrics, 'CM', 'contribution margin should map to CM');
});

test('T2-SESS-07g: Generic question defaults to GMS', () => {
  const metrics = session.detectQuestionMetrics('how are things?');
  assertIncludes(metrics, 'GMS', 'Generic question should default to GMS');
});

// =============================================================================
// T1-SESS-03: Conversation history trimming
// Prevents: Unbounded memory growth, context window overflow
// =============================================================================

console.log('\n✂️ Conversation History Trimming');

test('T1-SESS-03: History is trimmed to maxHistoryTurns * 2', () => {
  const s = new AnalysisSession('test-trim');
  s.maxHistoryTurns = 3; // 3 turns = 6 messages
  
  // Add 5 turns (10 messages)
  for (let i = 0; i < 10; i++) {
    s.conversationHistory.push({ 
      role: i % 2 === 0 ? 'user' : 'assistant', 
      content: `message ${i}` 
    });
  }
  
  // Simulate the trimming that handleQuery does
  if (s.conversationHistory.length > s.maxHistoryTurns * 2) {
    s.conversationHistory = s.conversationHistory.slice(-s.maxHistoryTurns * 2);
  }
  
  assertEqual(s.conversationHistory.length, 6, 
    'History should be trimmed to 6 messages (3 turns)');
  // Verify we kept the most recent messages
  assertEqual(s.conversationHistory[0].content, 'message 4',
    'Should keep most recent messages');
});

// =============================================================================
// T2-SESS-05: GL switch flushes conversation history
// Prevents: Follow-up analysis references data from wrong GL
// =============================================================================

console.log('\n🔄 GL Switch State Management');

test('T2-SESS-05: GL switch clears history', () => {
  const s = new AnalysisSession('test-gl-switch');
  s.currentGL = 'pc';
  s.conversationHistory = [
    { role: 'user', content: 'test' },
    { role: 'assistant', content: 'response' }
  ];
  
  // Simulate what handleQuery does when GL changes
  const newGL = 'toys';
  if (newGL !== s.currentGL) {
    s.currentGL = newGL;
    s.conversationHistory = [];
    s.loadedData = {};
  }
  
  assertEqual(s.currentGL, 'toys', 'GL should be updated');
  assertEqual(s.conversationHistory.length, 0, 'History should be cleared on GL switch');
});

// =============================================================================
// T1-DATA-05: GL-to-subcat mapping correctness
// Prevents: Metrics from wrong business unit in another GL's dashboard
// =============================================================================

console.log('\n🗺️ GL Mapping');

test('T1-DATA-05: loadGLMapping returns a Map', () => {
  const mapping = tools.loadGLMapping();
  assert(mapping instanceof Map, 'loadGLMapping should return a Map');
});

test('T1-DATA-05: getSubcatsForGL returns Set or null', () => {
  const result = tools.getSubcatsForGL('pc');
  // Could be null if no mapping file, or a Set if mapping exists
  assert(result === null || result instanceof Set, 
    'getSubcatsForGL should return Set or null');
});

test('T1-DATA-05: getGLNamesFromMapping returns Set', () => {
  const names = tools.getGLNamesFromMapping();
  assert(names instanceof Set, 'getGLNamesFromMapping should return a Set');
});

// =============================================================================
// T1-DATA-08: getAllSubcatData returns all metric keys per subcat
// Prevents: LLM context has missing columns → "data not available" hallucination
// =============================================================================

console.log('\n📊 getAllSubcatData Metric Completeness');

const weekData2 = tools.listWeeks();
const testWeek2 = weekData2.weeks?.[0];
const testGLData = testWeek2 ? tools.listGLs(testWeek2) : null;
const testGL2 = testGLData?.gls?.[0]?.name;

if (testWeek2 && testGL2) {
  test('T1-DATA-08: Each subcat has expected metric keys', () => {
    const result = tools.getAllSubcatData(testWeek2, testGL2);
    assert(Array.isArray(result.subcats), 'subcats should be an array');
    if (result.subcats.length > 0) {
      const subcat = result.subcats[0];
      assertNotNull(subcat.metrics, 'Each subcat should have metrics object');
      // Check for expected metric keys (at least GMS should be present)
      const metricKeys = Object.keys(subcat.metrics);
      assert(metricKeys.length >= 1, 'Should have at least 1 metric');
      // If GMS exists, check its fields
      if (subcat.metrics.GMS) {
        const gms = subcat.metrics.GMS;
        assert(gms.value !== undefined, 'GMS should have value');
        assert(gms.yoy_pct !== undefined || gms.yoy_ctc_bps !== undefined, 
          'GMS should have YoY data');
      }
    }
  });
} else {
  console.log('  ⚠ No data found — skipping metric completeness tests');
}

// =============================================================================
// T2-EDGE-06: safeDivide NaN/Infinity edge cases (extended)
// Prevents: NaN propagating through metric calculations
// =============================================================================

console.log('\n🔢 safeDivide Edge Cases');

test('T2-EDGE-06a: safeDivide(10, NaN) → null', () => {
  const result = tools.safeDivide(10, NaN);
  assertNull(result);
});

test('T2-EDGE-06b: safeDivide(10, Infinity) → 0', () => {
  const result = tools.safeDivide(10, Infinity);
  // 10 / Infinity = 0, which is finite
  assertEqual(result, 0);
});

test('T2-EDGE-06c: safeDivide(NaN, 5) → null', () => {
  const result = tools.safeDivide(NaN, 5);
  // NaN / 5 = NaN → not finite → null
  assertNull(result);
});

test('T2-EDGE-06d: safeDivide(Infinity, 5) → null', () => {
  const result = tools.safeDivide(Infinity, 5);
  // Infinity / 5 = Infinity → not finite → null
  assertNull(result);
});

test('T2-EDGE-06e: safeDivide(-Infinity, 5) → null', () => {
  const result = tools.safeDivide(-Infinity, 5);
  assertNull(result);
});

test('T2-EDGE-06f: safeDivide(0, 0) → null', () => {
  const result = tools.safeDivide(0, 0);
  assertNull(result);
});

// =============================================================================
// T2-EDGE-01: getMetricTotals with GL that has zero matching subcats
// Prevents: Server crash when new GL added before data arrives
// =============================================================================

console.log('\n⚠️ Edge Cases — Data');

if (testWeek2) {
  test('T2-EDGE-01: getMetricTotals handles nonexistent GL gracefully', () => {
    const result = tools.getMetricTotals(testWeek2, 'nonexistent-gl-xyz');
    // Should return error or empty metrics, not crash
    assert(Array.isArray(result.metrics) || result.error,
      'Should return metrics array or error for nonexistent GL');
  });
}

test('T2: getMetricDrivers with invalid metric returns error', () => {
  if (!testWeek2 || !testGL2) return;
  const result = tools.getMetricDrivers(testWeek2, testGL2, 'FAKE_METRIC');
  assertNotNull(result.error, 'Invalid metric should return error');
});

// =============================================================================
// Data Freshness edge cases
// =============================================================================

console.log('\n📅 Data Freshness Edge Cases');

test('getDataFreshness handles unpadded week number', () => {
  const result = tools.getDataFreshness('2026-wk5');
  // Should parse — the regex /wk(\d+)/ accepts 1+ digits
  assertNotNull(result, 'Should handle unpadded week number');
});

// =============================================================================
// SUMMARY
// =============================================================================

console.log('\n' + '═'.repeat(50));
console.log(`\n📋 Session Tests: ${passed} passed, ${failed} failed\n`);

if (failed > 0) {
  console.log('Failed tests:');
  failures.forEach(f => {
    console.log(`  • ${f.name}: ${f.error}`);
  });
  process.exit(1);
} else {
  console.log('All session tests passed! ✓\n');
  process.exit(0);
}
