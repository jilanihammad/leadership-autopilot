#!/usr/bin/env node
/**
 * Leadership Autopilot — Server API Endpoint Tests
 * 
 * Tests all Express API endpoints in server.js using supertest.
 * Covers: T1-API-01 through T1-API-11, T1-ERR-01, T1-ERR-02,
 *         T2-INT-01 through T2-INT-06, T2-PERS-01 through T2-PERS-04,
 *         T2-FMT-01, T2-INT-04 (SOROOS inversion), T2-EDGE-04 (case insensitivity)
 * 
 * Prevents: Dashboard crashes from malformed API responses, broken metric cards,
 *           empty GL selectors, SSE streaming failures, session data loss,
 *           information leakage in error responses.
 * 
 * Run: node test/server.test.js
 */

const request = require('supertest');
const fs = require('fs');
const path = require('path');
const tools = require('../tools');

// Import Express app (does NOT start listening)
const { app, AnalysisSession } = require('../server');

// ─── Test harness ───────────────────────────────────────────────────────────
let passed = 0;
let failed = 0;
const failures = [];

async function test(name, fn) {
  try {
    await fn();
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

// ─── Discover available test data ──────────────────────────────────────────
const weekData = tools.listWeeks();
const weeks = weekData.weeks || [];
const hasWeeks = weeks.length > 0;
let testWeek = null;
let testGL = null;

if (hasWeeks) {
  testWeek = weeks[0];
  const glData = tools.listGLs(testWeek);
  if (glData.gls && glData.gls.length > 0) {
    testGL = glData.gls[0].name;
  }
}

// =============================================================================
// TIER 1 — SHIP BLOCKERS: API Endpoint Validation
// =============================================================================

async function runTier1() {
  console.log('\n🚀 Tier 1 — API Endpoint Validation');

  // T1-API-01: POST /api/ask requires question parameter
  // Prevents: Server processing empty queries, wasting LLM tokens
  await test('T1-API-01: POST /api/ask returns 400 when question is missing', async () => {
    const res = await request(app)
      .post('/api/ask')
      .send({ sessionId: 'test-no-question' })
      .expect(400);
    assert(res.body.error, 'Should return error message');
    assert(res.body.error.toLowerCase().includes('question'), 'Error should mention "question"');
  });

  // T1-API-03: GET /api/weeks returns sorted week list
  // Prevents: Dashboard shows weeks in wrong order
  await test('T1-API-03: GET /api/weeks returns sorted array', async () => {
    const res = await request(app)
      .get('/api/weeks')
      .expect(200);
    assert(Array.isArray(res.body.weeks), 'weeks should be an array');
    if (res.body.weeks.length >= 2) {
      assert(res.body.weeks[0] >= res.body.weeks[1], 'Weeks should be sorted descending');
    }
  });

  // T1-API-04: GET /api/gls/:week returns GL list for valid week
  // Prevents: Dashboard can't populate GL selector
  if (testWeek) {
    await test('T1-API-04: GET /api/gls/:week returns GL list', async () => {
      const res = await request(app)
        .get(`/api/gls/${testWeek}`)
        .expect(200);
      assert(Array.isArray(res.body.gls), 'gls should be an array');
      if (res.body.gls.length > 0) {
        assertNotNull(res.body.gls[0].name, 'Each GL should have a name');
      }
    });
  }

  // T1-API-05: GET /api/gls/:week returns error for invalid week
  // Prevents: Silent failure when week doesn't exist
  await test('T1-API-05: GET /api/gls/:week handles invalid week', async () => {
    const res = await request(app)
      .get('/api/gls/9999-wk99')
      .expect(200); // The app returns 200 with error in body
    // Should either return error or empty gls array
    assert(res.body.error || (Array.isArray(res.body.gls) && res.body.gls.length === 0),
      'Should return error or empty array for invalid week');
  });

  // T1-API-06: GET /api/metrics/:week/:gl returns metric totals
  // Prevents: Dashboard metric cards show "—" for all values
  if (testWeek && testGL) {
    await test('T1-API-06: GET /api/metrics/:week/:gl returns metrics array', async () => {
      const res = await request(app)
        .get(`/api/metrics/${testWeek}/${testGL}`)
        .expect(200);
      assert(Array.isArray(res.body.metrics), 'metrics should be an array');
      assert(res.body.metrics.length >= 1, 'Should have at least 1 metric');
      // Each metric should have required fields
      const m = res.body.metrics[0];
      assertNotNull(m.name, 'Metric should have name');
      assertNotNull(m.label, 'Metric should have label');
      assert(m.value !== undefined, 'Metric should have value');
      assert(m.wow !== undefined, 'Metric should have wow');
      assert(m.yoy !== undefined, 'Metric should have yoy');
    });
  }

  // T1-API-07: POST /api/ask/stream returns valid SSE format
  // Prevents: Chat completely broken — streaming is the primary query path
  if (testWeek && testGL) {
    await test('T1-API-07: POST /api/ask/stream sets SSE headers for valid request', async () => {
      // We test with a question that triggers no-GL clarification (avoids LLM call)
      const res = await request(app)
        .post('/api/ask/stream')
        .send({ question: 'How are things?', sessionId: 'test-sse-headers' })
        .expect(200);
      // Should be SSE content type
      assert(res.headers['content-type'].includes('text/event-stream'),
        'Content-Type should be text/event-stream');
    });
  }

  // T1-API-08: POST /api/ask/stream handles missing question
  // Prevents: Client stuck waiting for SSE events that never come
  await test('T1-API-08: POST /api/ask/stream returns 400 for missing question', async () => {
    const res = await request(app)
      .post('/api/ask/stream')
      .send({ sessionId: 'test-no-question-stream' })
      .expect(400);
    assert(res.body.error, 'Should return error for missing question');
  });

  // T1-API-09: GET /api/movers/:week/:gl returns mover data
  // Prevents: Right sidebar movers panel empty/broken
  if (testWeek && testGL) {
    await test('T1-API-09: GET /api/movers/:week/:gl returns movers', async () => {
      const res = await request(app)
        .get(`/api/movers/${testWeek}/${testGL}`)
        .expect(200);
      assert(Array.isArray(res.body.movers), 'movers should be an array');
      assertNotNull(res.body.metric, 'Response should include metric');
      // If movers exist, check structure
      if (res.body.movers.length > 0) {
        const m = res.body.movers[0];
        assertNotNull(m.name, 'Mover should have name');
        assertNotNull(m.code, 'Mover should have code');
        assert(m.ctc !== undefined, 'Mover should have ctc');
        assertNotNull(m.direction, 'Mover should have direction');
        assert(m.direction === 'up' || m.direction === 'down',
          `Direction should be 'up' or 'down', got '${m.direction}'`);
      }
    });
  }

  // T1-API-10: GET /api/alerts/:week/:gl returns winds data
  // Prevents: Headwinds/tailwinds section broken
  if (testWeek && testGL) {
    await test('T1-API-10: GET /api/alerts/:week/:gl returns tailwinds/headwinds', async () => {
      const res = await request(app)
        .get(`/api/alerts/${testWeek}/${testGL}`)
        .expect(200);
      assert(Array.isArray(res.body.tailwinds), 'tailwinds should be an array');
      assert(Array.isArray(res.body.headwinds), 'headwinds should be an array');
      // Verify structure if any exist
      const allWinds = [...res.body.tailwinds, ...res.body.headwinds];
      if (allWinds.length > 0) {
        const w = allWinds[0];
        assertNotNull(w.subcat, 'Wind entry should have subcat');
        assertNotNull(w.metric, 'Wind entry should have metric label');
        assert(w.ctc !== undefined, 'Wind entry should have ctc');
        assert(w.magnitude === 'high' || w.magnitude === 'medium',
          `magnitude should be 'high' or 'medium', got '${w.magnitude}'`);
      }
    });
  }

  // T1-API-11: GET /api/trends/:gl returns multi-week trends
  // Prevents: Sparklines don't render, no trend data
  if (testGL) {
    await test('T1-API-11: GET /api/trends/:gl returns trend data', async () => {
      const res = await request(app)
        .get(`/api/trends/${testGL}`)
        .expect(200);
      assertNotNull(res.body.trends, 'Should have trends object');
      assertNotNull(res.body.gl, 'Should include gl');
      assert(Array.isArray(res.body.weeks), 'Should include weeks array');
      // Check that trends are in oldest→newest order (critical for sparklines)
      if (res.body.weeks.length >= 2) {
        assert(res.body.weeks[0] <= res.body.weeks[1],
          'Trends weeks should be in ascending (oldest→newest) order');
      }
    });
  }

  // T1-ERR-01: Error responses don't leak internal paths or stack traces
  // Prevents: Information leakage — internal paths, module names in errors
  await test('T1-ERR-01: Error responses are safe JSON without stack traces', async () => {
    const res = await request(app)
      .post('/api/ask')
      .send({ sessionId: 'test-err' })
      .expect(400);
    // Error should be a clean message, not a stack trace
    const errStr = JSON.stringify(res.body);
    assert(!errStr.includes('at Object'), 'Error should not contain stack trace');
    assert(!errStr.includes('node_modules'), 'Error should not reference node_modules');
  });

  // T1-ERR-02: Malformed JSON body doesn't crash server
  // Prevents: Single malformed request takes down the entire server
  await test('T1-ERR-02: Malformed JSON body returns error, server stays up', async () => {
    const res = await request(app)
      .post('/api/ask')
      .set('Content-Type', 'application/json')
      .send('{ this is not valid json }');
    // Should get an error response, not a crash
    assert(res.status >= 400, 'Should return 4xx error');
    // Verify server is still up by making another request
    const health = await request(app).get('/api/weeks');
    assertEqual(health.status, 200, 'Server should still respond after malformed request');
  });

  // T1-SESS-01: Session creation and retrieval
  // Prevents: Every request creates a fresh session, losing conversation history
  await test('T1-SESS-01: GET /api/session/:id returns session state', async () => {
    const sid = 'test-sess-create-' + Date.now();
    const res = await request(app)
      .get(`/api/session/${sid}`)
      .expect(200);
    // New session should have null GL and week
    assertEqual(res.body.currentGL, null, 'New session should have null GL');
    assertEqual(res.body.currentWeek, null, 'New session should have null week');
    assertEqual(res.body.historyLength, 0, 'New session should have empty history');
  });

  // T1-SESS-02: Session reset clears state
  // Prevents: Stale context from previous conversation leaks into new analysis
  await test('T1-SESS-02: POST /api/session/:id/reset clears session', async () => {
    const sid = 'test-sess-reset-' + Date.now();
    // Reset it (even if new — should not error)
    const res = await request(app)
      .post(`/api/session/${sid}/reset`)
      .expect(200);
    assert(res.body.success, 'Reset should return success');
    // Verify session is gone
    const check = await request(app).get(`/api/session/${sid}`).expect(200);
    assertEqual(check.body.historyLength, 0, 'Reset session should have empty history');
  });

  // T1-RESOLVE-01: resolveGLDataFolder routes correctly
  // Prevents: Every data function reads from wrong directory
  await test('T1-RESOLVE-01: GET /api/metrics works for gl=all (no filtering)', async () => {
    if (!testWeek) return; // skip if no data
    const res = await request(app)
      .get(`/api/metrics/${testWeek}/all`)
      .expect(200);
    // Should return metrics (possibly empty if no ALL folder, but shouldn't crash)
    assert(Array.isArray(res.body.metrics), 'Should return metrics array for all');
  });
}

// =============================================================================
// TIER 2 — PRODUCTION CONFIDENCE: Integration & Session Tests
// =============================================================================

async function runTier2() {
  console.log('\n📦 Tier 2 — Integration & Session Tests');

  // T2-INT-01: /api/metrics matches tools.getMetricTotals output
  // Prevents: API layer silently drops or transforms metric data
  if (testWeek && testGL) {
    await test('T2-INT-01: /api/metrics matches tools.getMetricTotals', async () => {
      const direct = tools.getMetricTotals(testWeek, testGL);
      const res = await request(app)
        .get(`/api/metrics/${testWeek}/${testGL}`)
        .expect(200);
      assertEqual(res.body.metrics.length, direct.metrics.length,
        'API and tools should return same number of metrics');
      // Compare first metric's values
      if (direct.metrics.length > 0) {
        assertEqual(res.body.metrics[0].name, direct.metrics[0].name,
          'First metric name should match');
        assertEqual(res.body.metrics[0].value, direct.metrics[0].value,
          'First metric value should match');
      }
    });
  }

  // T2-INT-02: /api/movers direction field is correct
  // Prevents: Mover direction inverted (down shown as up)
  if (testWeek && testGL) {
    await test('T2-INT-02: /api/movers direction matches CTC sign', async () => {
      const res = await request(app)
        .get(`/api/movers/${testWeek}/${testGL}`)
        .expect(200);
      for (const mover of res.body.movers) {
        if (mover.ctc >= 0) {
          assertEqual(mover.direction, 'up',
            `Positive CTC ${mover.ctc} should have direction 'up' for ${mover.name}`);
        } else {
          assertEqual(mover.direction, 'down',
            `Negative CTC ${mover.ctc} should have direction 'down' for ${mover.name}`);
        }
      }
    });
  }

  // T2-INT-04: /api/alerts inverts SOROOS direction
  // Prevents: Rising out-of-stock rate shown as good news (CRITICAL)
  if (testWeek && testGL) {
    await test('T2-INT-04: SOROOS positive CTC → headwind (higher OOS is bad)', async () => {
      const res = await request(app)
        .get(`/api/alerts/${testWeek}/${testGL}`)
        .expect(200);
      // Check any SOROOS entries have correct wind classification
      const allEntries = [...res.body.tailwinds, ...res.body.headwinds];
      const soroosEntries = allEntries.filter(e => 
        e.metricKey === 'SOROOS_PROCURABLE_PRODUCT_OOS_GV_PCT');
      for (const entry of soroosEntries) {
        // Positive CTC for SOROOS = headwind (more OOS is bad)
        if (entry.ctc > 0) {
          assert(res.body.headwinds.includes(entry),
            `SOROOS positive CTC should be headwind, not tailwind: ${entry.subcat}`);
        }
        // Negative CTC for SOROOS = tailwind (less OOS is good)
        if (entry.ctc < 0) {
          assert(res.body.tailwinds.includes(entry),
            `SOROOS negative CTC should be tailwind, not headwind: ${entry.subcat}`);
        }
      }
      // This test passes even with no SOROOS data — the logic is structural
    });
  }

  // T2-INT-05: /api/trends returns trends in oldest→newest order
  // Prevents: Sparklines rendered backwards
  if (testGL && weeks.length >= 2) {
    await test('T2-INT-05: /api/trends week order is oldest→newest', async () => {
      const res = await request(app)
        .get(`/api/trends/${testGL}`)
        .expect(200);
      for (let i = 0; i < res.body.weeks.length - 1; i++) {
        assert(res.body.weeks[i] <= res.body.weeks[i + 1],
          `Week ${res.body.weeks[i]} should come before ${res.body.weeks[i + 1]}`);
      }
    });
  }

  // T2-INT-06: /api/freshness calculates age correctly
  // Prevents: "Updated 5m ago" when data is actually 3 days old
  if (testWeek) {
    await test('T2-INT-06: /api/freshness returns valid age info', async () => {
      const res = await request(app)
        .get(`/api/freshness/${testWeek}`)
        .expect(200);
      if (res.body.fresh) {
        assertNotNull(res.body.updatedAt, 'Should have updatedAt');
        assertNotNull(res.body.ageMinutes, 'Should have ageMinutes');
        assert(res.body.ageMinutes >= 0, 'Age should be non-negative');
        assertNotNull(res.body.label, 'Should have human-readable label');
        assert(res.body.label.includes('Updated'), 'Label should say "Updated"');
      }
    });
  }

  // T2-PERS-01: Session save/load round-trip
  // Prevents: User loses conversation context after save/load
  await test('T2-PERS-01: Session save/load round-trip preserves state', async () => {
    const sid = 'test-save-load-' + Date.now();
    // Initialize the session by accessing it (GET creates an entry or returns defaults)
    // We need the session to exist in memory for save to work.
    // Accessing /api/session/:id GET doesn't create one if it doesn't exist,
    // but POST /api/ask would (via getSession). Let's use the session endpoint 
    // directly: first GET to verify it doesn't exist, then trigger creation 
    // via /api/ask with a question that doesn't need LLM (missing GL → clarification).
    // Actually, the simplest path: just call getSession() by hitting any endpoint 
    // that uses it. The /api/ask endpoint calls getSession().
    const askRes = await request(app)
      .post('/api/ask')
      .send({ question: 'How are things?', sessionId: sid });
    // This will either succeed (asking for GL clarification) or error (no GL) — either way the session exists now
    
    // Save it
    const saveRes = await request(app)
      .post(`/api/session/${sid}/save`)
      .expect(200);
    assert(saveRes.body.saved, 'Save should succeed');
    
    // Delete from memory to prove load works from disk
    await request(app).post(`/api/session/${sid}/reset`);
    
    // Load it back
    const loadRes = await request(app)
      .post(`/api/session/${sid}/load`)
      .expect(200);
    assert(loadRes.body.loaded, 'Load should succeed');
    
    // Clean up saved file
    const sessionsDir = path.join(__dirname, '..', '..', 'data', 'sessions');
    const savedFile = path.join(sessionsDir, `${sid}.json`);
    if (fs.existsSync(savedFile)) fs.unlinkSync(savedFile);
  });

  // T2-PERS-02: Session export returns 404 for empty session
  // Prevents: User exports blank document thinking it contains analysis
  await test('T2-PERS-03: Session export returns 404 for empty/nonexistent session', async () => {
    const res = await request(app)
      .get('/api/session/nonexistent-session-xyz/export')
      .expect(404);
    assert(res.body.error, 'Should return error message');
  });

  // T2-PERS-04: List saved sessions returns array
  // Prevents: User can't find their saved sessions
  await test('T2-PERS-04: GET /api/sessions/saved returns sessions array', async () => {
    const res = await request(app)
      .get('/api/sessions/saved')
      .expect(200);
    assert(Array.isArray(res.body.sessions), 'sessions should be an array');
  });

  // T2-FMT-01: Format CRUD lifecycle
  // Prevents: Templates can't be managed
  await test('T2-FMT-01: Format template CRUD lifecycle', async () => {
    const testName = 'test-format-' + Date.now();
    const testTemplate = '## Summary\n{{content}}';
    
    // Create
    const createRes = await request(app)
      .post('/api/formats')
      .send({ name: testName, template: testTemplate })
      .expect(200);
    assertNotNull(createRes.body.format, 'Create should return format');
    assertEqual(createRes.body.format.name, testName, 'Created format name should match');
    
    // List — should contain our format
    const listRes = await request(app)
      .get('/api/formats')
      .expect(200);
    assert(Array.isArray(listRes.body.formats), 'formats should be an array');
    const found = listRes.body.formats.find(f => f.name === testName);
    assert(found, 'Created format should appear in list');
    
    // Delete
    const deleteRes = await request(app)
      .delete(`/api/formats/${testName}`)
      .expect(200);
    assertEqual(deleteRes.body.deleted, testName, 'Deleted name should match');
    
    // Verify deletion — 404 on re-delete
    const reDeleteRes = await request(app)
      .delete(`/api/formats/${testName}`)
      .expect(404);
    assert(reDeleteRes.body.error, 'Re-delete should return error');
  });

  // T2-FMT validation: missing fields
  await test('T2-FMT: Format creation requires name and template', async () => {
    const res = await request(app)
      .post('/api/formats')
      .send({ name: 'test-no-template' })
      .expect(400);
    assert(res.body.error, 'Should return error for missing template');
  });

  // T2-EDGE-04: GL name case insensitivity
  // Prevents: Dashboard sends lowercase, tools use uppercase → empty data
  if (testWeek && testGL) {
    await test('T2-EDGE-04: GL name is case-insensitive in metrics endpoint', async () => {
      const lower = await request(app)
        .get(`/api/metrics/${testWeek}/${testGL.toLowerCase()}`)
        .expect(200);
      const upper = await request(app)
        .get(`/api/metrics/${testWeek}/${testGL.toUpperCase()}`)
        .expect(200);
      // Both should return metrics (not error out)
      assert(Array.isArray(lower.body.metrics), 'Lowercase GL should return metrics');
      assert(Array.isArray(upper.body.metrics), 'Uppercase GL should return metrics');
    });
  }

  // CORS headers
  await test('T2: CORS headers are set on responses', async () => {
    const res = await request(app)
      .get('/api/weeks')
      .expect(200);
    assertEqual(res.headers['access-control-allow-origin'], '*',
      'CORS Allow-Origin should be *');
  });

  // OPTIONS preflight
  await test('T2: OPTIONS preflight returns 200', async () => {
    const res = await request(app)
      .options('/api/ask')
      .expect(200);
    assertNotNull(res.headers['access-control-allow-methods'],
      'Should have Allow-Methods header');
  });

  // LLM config endpoints (no actual LLM calls needed)
  await test('T2-LLM: GET /api/providers returns provider list', async () => {
    const res = await request(app)
      .get('/api/providers')
      .expect(200);
    assert(Array.isArray(res.body), 'Providers should be an array');
    assert(res.body.length >= 1, 'Should have at least 1 provider');
    const first = res.body[0];
    assertNotNull(first.id, 'Provider should have id');
    assertNotNull(first.name, 'Provider should have name');
    assert(Array.isArray(first.models), 'Provider should have models array');
    assert(first.configured === true || first.configured === false,
      'Provider should have configured boolean');
  });

  // Bridge returns 404 for empty session
  await test('T2: Bridge returns 404 for empty session', async () => {
    const res = await request(app)
      .post('/api/session/nonexistent-bridge-test/bridge')
      .expect(404);
    assert(res.body.error, 'Should return error');
  });

  // Save returns 404 for nonexistent session
  await test('T2: Save returns 404 for session that was never created', async () => {
    // This tests a session ID that was never accessed via getSession()
    // The session won't exist in the Map, so save should return 404
    const res = await request(app)
      .post('/api/session/never-created-session/save');
    assertEqual(res.status, 404, 'Save should return 404 for unknown session');
  });

  // Load returns 404 for nonexistent saved session
  await test('T2: Load returns 404 for session with no saved file', async () => {
    const res = await request(app)
      .post('/api/session/no-saved-file-here/load')
      .expect(404);
    assert(res.body.error, 'Should return error');
  });
}

// =============================================================================
// TIER 3 — HARDENING: Security & Edge Cases
// =============================================================================

async function runTier3() {
  console.log('\n🔒 Tier 3 — Security & Edge Cases');

  // T3-SEC-01: Path traversal prevention in week/GL parameters
  // Prevents: Reading arbitrary files via crafted week/GL params
  await test('T3-SEC-01: Path traversal in week param returns no data', async () => {
    // Express normalizes ../../ in paths, so use encoded dots or test
    // with a traversal-like week name that doesn't get URL-normalized
    const res = await request(app)
      .get('/api/metrics/..%2F..%2Fetc/passwd');
    // Should return a safe response — either 200 with empty/error metrics, or 404
    assert(res.status === 200 || res.status === 404,
      'Should return safe HTTP status for traversal attempt');
    if (res.status === 200) {
      // Verify no sensitive data leaked
      const body = JSON.stringify(res.body);
      assert(!body.includes('root:'), 'Should not leak /etc/passwd content');
    }
  });

  // T3-SEC-03: Very long input string doesn't cause DoS
  // Prevents: Denial of service via oversized request
  await test('T3-SEC-03: Very long question string handled gracefully', async () => {
    const longQuestion = 'A'.repeat(50000);
    const res = await request(app)
      .post('/api/ask')
      .send({ question: longQuestion, sessionId: 'test-long-input' })
      .timeout(5000); // Don't wait forever
    // Should respond (either error or proceed) without hanging
    assert(res.status >= 200 && res.status < 600, 'Should return a valid HTTP status');
  });

  // Freshness for invalid week
  await test('T3: Freshness returns not-fresh for nonexistent week', async () => {
    const res = await request(app)
      .get('/api/freshness/9999-wk99')
      .expect(200);
    assertEqual(res.body.fresh, false, 'Should not be fresh for missing week');
  });
}

// =============================================================================
// RUN ALL
// =============================================================================

async function main() {
  console.log('═══════════════════════════════════════════════════');
  console.log('  Server API Endpoint Tests');
  console.log('═══════════════════════════════════════════════════');
  console.log(`  Test data: week=${testWeek || 'NONE'}, gl=${testGL || 'NONE'}`);

  await runTier1();
  await runTier2();
  await runTier3();

  console.log('\n' + '═'.repeat(50));
  console.log(`\n📋 Server Tests: ${passed} passed, ${failed} failed\n`);

  if (failed > 0) {
    console.log('Failed tests:');
    failures.forEach(f => {
      console.log(`  • ${f.name}: ${f.error}`);
    });
    process.exit(1);
  } else {
    console.log('All server tests passed! ✓\n');
    process.exit(0);
  }
}

main().catch(err => {
  console.error('Test runner error:', err);
  process.exit(1);
});
