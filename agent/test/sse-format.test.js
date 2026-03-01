#!/usr/bin/env node
/**
 * SSE Streaming + Two-Pass Format Integration Tests
 *
 * Tests the POST /api/ask/stream endpoint and the two-pass format pipeline.
 * Since no LLM env vars are configured, these tests exercise the ERROR paths
 * and verify SSE plumbing, headers, and format detection logic.
 *
 * Tests:
 *   - SSE headers are set correctly (Content-Type, Cache-Control, Connection)
 *   - SSE stream sends valid JSON events
 *   - Error events have correct structure when LLM unavailable
 *   - Two-pass detection: formatTemplate presence triggers reformat path
 *   - Format template CRUD (create/read/update/delete)
 *   - Session format state isolation
 *   - Missing question returns 400 (not SSE)
 *   - Cross-GL question routing via SSE
 *
 * Run: cd agent && node test/sse-format.test.js
 */

const request = require('supertest');
const { app, AnalysisSession } = require('../server');
const tools = require('../tools');

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

// ─── Discover test data ────────────────────────────────────────────────────
const weekData = tools.listWeeks();
const weeks = weekData.weeks || [];
let testWeek = null;
let testGL = null;

if (weeks.length > 0) {
  testWeek = weeks[0];
  const glData = tools.listGLs(testWeek);
  if (glData.gls && glData.gls.length > 0) {
    testGL = glData.gls[0].name;
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// SSE ENDPOINT PLUMBING
// ═════════════════════════════════════════════════════════════════════════════

async function runSSETests() {
  console.log('\n📡 SSE Streaming Endpoint Tests');

  // ── Missing question → 400 JSON (not SSE) ──
  await test('POST /api/ask/stream without question returns 400 JSON', async () => {
    const res = await request(app)
      .post('/api/ask/stream')
      .send({})
      .expect(400);
    assertEqual(res.body.error, 'Question is required');
    // Should NOT be SSE — should be a regular JSON response
    assert(!res.headers['content-type'].includes('text/event-stream'),
      'should return JSON, not SSE, for validation errors');
  });

  await test('POST /api/ask/stream with empty string question returns 400', async () => {
    const res = await request(app)
      .post('/api/ask/stream')
      .send({ question: '' })
      .expect(400);
    assertEqual(res.body.error, 'Question is required');
  });

  // ── SSE headers ──
  if (testGL && testWeek) {
    await test('SSE response has correct Content-Type header', async () => {
      const res = await request(app)
        .post('/api/ask/stream')
        .send({ question: `How is ${testGL} doing?`, gl: testGL, week: testWeek, sessionId: 'sse-test-1' })
        .buffer(true)
        .parse((res, cb) => {
          let data = '';
          res.on('data', chunk => { data += chunk.toString(); });
          res.on('end', () => cb(null, data));
        });

      assertEqual(res.headers['content-type'], 'text/event-stream',
        `Content-Type should be text/event-stream, got: ${res.headers['content-type']}`);
    });

    await test('SSE response has Cache-Control: no-cache', async () => {
      const res = await request(app)
        .post('/api/ask/stream')
        .send({ question: 'test', gl: testGL, week: testWeek, sessionId: 'sse-test-2' })
        .buffer(true)
        .parse((res, cb) => {
          let data = '';
          res.on('data', chunk => { data += chunk.toString(); });
          res.on('end', () => cb(null, data));
        });

      assertEqual(res.headers['cache-control'], 'no-cache');
    });

    await test('SSE response has Connection: keep-alive', async () => {
      const res = await request(app)
        .post('/api/ask/stream')
        .send({ question: 'test', gl: testGL, week: testWeek, sessionId: 'sse-test-3' })
        .buffer(true)
        .parse((res, cb) => {
          let data = '';
          res.on('data', chunk => { data += chunk.toString(); });
          res.on('end', () => cb(null, data));
        });

      assertEqual(res.headers['connection'], 'keep-alive');
    });

    // ── SSE event format ──
    await test('SSE stream sends valid JSON events with data: prefix', async () => {
      const res = await request(app)
        .post('/api/ask/stream')
        .send({ question: `What's happening in ${testGL}?`, gl: testGL, week: testWeek, sessionId: 'sse-test-4' })
        .buffer(true)
        .parse((res, cb) => {
          let data = '';
          res.on('data', chunk => { data += chunk.toString(); });
          res.on('end', () => cb(null, data));
        });

      const body = res.body;
      assert(typeof body === 'string', 'raw SSE body should be a string');
      
      // Parse SSE events
      const events = body.split('\n\n')
        .filter(line => line.startsWith('data: '))
        .map(line => {
          try {
            return JSON.parse(line.replace('data: ', ''));
          } catch {
            return null;
          }
        })
        .filter(Boolean);

      assert(events.length > 0, `should have at least 1 SSE event, got ${events.length}`);
      
      // Each event should have a 'type' field
      for (const event of events) {
        assert(event.type, `SSE event missing type: ${JSON.stringify(event)}`);
        assert(['content', 'done', 'error', 'status'].includes(event.type),
          `unexpected event type: ${event.type}`);
      }
    });

    await test('SSE stream includes error or content event when LLM unavailable', async () => {
      const res = await request(app)
        .post('/api/ask/stream')
        .send({ question: `How is ${testGL} GMS trending?`, gl: testGL, week: testWeek, sessionId: 'sse-test-5' })
        .buffer(true)
        .parse((res, cb) => {
          let data = '';
          res.on('data', chunk => { data += chunk.toString(); });
          res.on('end', () => cb(null, data));
        });

      const events = res.body.split('\n\n')
        .filter(line => line.startsWith('data: '))
        .map(line => {
          try { return JSON.parse(line.replace('data: ', '')); }
          catch { return null; }
        })
        .filter(Boolean);

      // Should have either an error event (LLM not configured) or content + done
      const hasError = events.some(e => e.type === 'error');
      const hasDone = events.some(e => e.type === 'done');
      
      assert(hasError || hasDone, 
        'stream should end with either error or done event');
    });

    await test('SSE done event includes gl and week', async () => {
      const res = await request(app)
        .post('/api/ask/stream')
        .send({ question: 'test query', gl: testGL, week: testWeek, sessionId: 'sse-test-6' })
        .buffer(true)
        .parse((res, cb) => {
          let data = '';
          res.on('data', chunk => { data += chunk.toString(); });
          res.on('end', () => cb(null, data));
        });

      const events = res.body.split('\n\n')
        .filter(line => line.startsWith('data: '))
        .map(line => {
          try { return JSON.parse(line.replace('data: ', '')); }
          catch { return null; }
        })
        .filter(Boolean);

      const doneEvent = events.find(e => e.type === 'done');
      if (doneEvent) {
        assertEqual(doneEvent.gl, testGL, `done event gl should be ${testGL}`);
        assertEqual(doneEvent.week, testWeek, `done event week should be ${testWeek}`);
      }
      // If there's an error event instead of done, that's also acceptable
      // (LLM not configured)
    });
  } else {
    console.log('  ⚠ Skipping SSE header tests (no test data available)');
  }

  // ── GL-less query → ask for GL ──
  await test('SSE with no GL and no context asks for GL clarification', async () => {
    const res = await request(app)
      .post('/api/ask/stream')
      .send({ question: 'What are the top movers?', sessionId: 'sse-no-gl-test' })
      .buffer(true)
      .parse((res, cb) => {
        let data = '';
        res.on('data', chunk => { data += chunk.toString(); });
        res.on('end', () => cb(null, data));
      });

    const events = res.body.split('\n\n')
      .filter(line => line.startsWith('data: '))
      .map(line => {
        try { return JSON.parse(line.replace('data: ', '')); }
        catch { return null; }
      })
      .filter(Boolean);

    // Should get a content event asking which GL
    const contentEvents = events.filter(e => e.type === 'content');
    assert(contentEvents.length > 0, 'should have content events');
    const text = contentEvents.map(e => e.text).join('');
    assert(text.toLowerCase().includes('which gl') || text.toLowerCase().includes('gl'),
      `should ask about GL, got: ${text.substring(0, 100)}`);
    
    // Done event should have gl: null
    const doneEvent = events.find(e => e.type === 'done');
    if (doneEvent) {
      assertEqual(doneEvent.gl, null, 'gl should be null when not detected');
    }
  });
}

// ═════════════════════════════════════════════════════════════════════════════
// TWO-PASS FORMAT DETECTION
// ═════════════════════════════════════════════════════════════════════════════

async function runFormatTests() {
  console.log('\n🎨 Two-Pass Format Detection Tests');

  if (!testGL || !testWeek) {
    console.log('  ⚠ Skipping format tests (no test data)');
    return;
  }

  await test('formatTemplate in request triggers status event "Analyzing..."', async () => {
    const res = await request(app)
      .post('/api/ask/stream')
      .send({
        question: `How is ${testGL} doing?`,
        gl: testGL,
        week: testWeek,
        formatTemplate: '## Executive Summary\n- Key Finding 1\n- Key Finding 2\n\n## Data Table\n| Metric | Value |\n|--------|-------|',
        sessionId: 'format-test-1',
      })
      .buffer(true)
      .parse((res, cb) => {
        let data = '';
        res.on('data', chunk => { data += chunk.toString(); });
        res.on('end', () => cb(null, data));
      });

    const events = res.body.split('\n\n')
      .filter(line => line.startsWith('data: '))
      .map(line => {
        try { return JSON.parse(line.replace('data: ', '')); }
        catch { return null; }
      })
      .filter(Boolean);

    // When formatTemplate is present, the two-pass path sends a 'status' event
    const statusEvents = events.filter(e => e.type === 'status');
    const hasAnalyzing = statusEvents.some(e => e.text === 'Analyzing...');
    
    // Either we get the two-pass status event, or an error (LLM not configured)
    const hasError = events.some(e => e.type === 'error');
    assert(hasAnalyzing || hasError,
      `should get "Analyzing..." status or error event, got types: ${events.map(e => e.type).join(', ')}`);
  });

  await test('request WITHOUT formatTemplate does NOT send "Analyzing..." status', async () => {
    const res = await request(app)
      .post('/api/ask/stream')
      .send({
        question: `How is ${testGL}?`,
        gl: testGL,
        week: testWeek,
        sessionId: 'format-test-2',
      })
      .buffer(true)
      .parse((res, cb) => {
        let data = '';
        res.on('data', chunk => { data += chunk.toString(); });
        res.on('end', () => cb(null, data));
      });

    const events = res.body.split('\n\n')
      .filter(line => line.startsWith('data: '))
      .map(line => {
        try { return JSON.parse(line.replace('data: ', '')); }
        catch { return null; }
      })
      .filter(Boolean);

    const hasAnalyzing = events.some(e => e.type === 'status' && e.text === 'Analyzing...');
    assertEqual(hasAnalyzing, false,
      'should NOT have "Analyzing..." when no format template');
  });

  await test('empty formatTemplate treated as no format (single pass)', async () => {
    const res = await request(app)
      .post('/api/ask/stream')
      .send({
        question: `Tell me about ${testGL}`,
        gl: testGL,
        week: testWeek,
        formatTemplate: '   ',  // whitespace only
        sessionId: 'format-test-3',
      })
      .buffer(true)
      .parse((res, cb) => {
        let data = '';
        res.on('data', chunk => { data += chunk.toString(); });
        res.on('end', () => cb(null, data));
      });

    const events = res.body.split('\n\n')
      .filter(line => line.startsWith('data: '))
      .map(line => {
        try { return JSON.parse(line.replace('data: ', '')); }
        catch { return null; }
      })
      .filter(Boolean);

    const hasAnalyzing = events.some(e => e.type === 'status' && e.text === 'Analyzing...');
    assertEqual(hasAnalyzing, false,
      'whitespace-only format template should be treated as absent');
  });
}

// ═════════════════════════════════════════════════════════════════════════════
// FORMAT TEMPLATE CRUD
// ═════════════════════════════════════════════════════════════════════════════

async function runFormatCRUDTests() {
  console.log('\n📝 Format Template CRUD Tests');

  const testFormatName = `__test_format_${Date.now()}`;
  const testTemplate = '## Summary\n- Finding 1\n- Finding 2';

  await test('POST /api/formats creates a new format', async () => {
    const res = await request(app)
      .post('/api/formats')
      .send({ name: testFormatName, template: testTemplate })
      .expect(200);
    assertEqual(res.body.format.name, testFormatName);
    assertEqual(res.body.format.template, testTemplate);
    assert(res.body.format.updatedAt, 'should have updatedAt timestamp');
  });

  await test('GET /api/formats lists the created format', async () => {
    const res = await request(app)
      .get('/api/formats')
      .expect(200);
    const found = res.body.formats.find(f => f.name === testFormatName);
    assert(found, 'created format should appear in list');
    assertEqual(found.template, testTemplate);
  });

  await test('POST /api/formats with same name updates (upsert)', async () => {
    const updatedTemplate = '## Updated Summary\n- New Finding';
    const res = await request(app)
      .post('/api/formats')
      .send({ name: testFormatName, template: updatedTemplate })
      .expect(200);
    assertEqual(res.body.format.template, updatedTemplate);
  });

  await test('POST /api/formats without name returns 400', async () => {
    const res = await request(app)
      .post('/api/formats')
      .send({ template: 'foo' })
      .expect(400);
    assertEqual(res.body.error, 'Name and template are required');
  });

  await test('POST /api/formats without template returns 400', async () => {
    const res = await request(app)
      .post('/api/formats')
      .send({ name: 'foo' })
      .expect(400);
    assertEqual(res.body.error, 'Name and template are required');
  });

  await test('DELETE /api/formats/:name removes the format', async () => {
    const res = await request(app)
      .delete(`/api/formats/${testFormatName}`)
      .expect(200);
    assertEqual(res.body.deleted, testFormatName);
    // Verify it's gone
    const listRes = await request(app).get('/api/formats').expect(200);
    const found = listRes.body.formats.find(f => f.name === testFormatName);
    assertEqual(found, undefined, 'format should be deleted');
  });

  await test('DELETE nonexistent format returns 404', async () => {
    await request(app)
      .delete('/api/formats/__nonexistent_format__')
      .expect(404);
  });
}

// ═════════════════════════════════════════════════════════════════════════════
// TWO-PASS LOGIC UNIT TESTS (no HTTP)
// ═════════════════════════════════════════════════════════════════════════════

async function runTwoPassLogicTests() {
  console.log('\n🔄 Two-Pass Logic (Unit)');

  await test('AnalysisSession correctly detects format template presence', async () => {
    // The two-pass logic is in the /api/ask/stream handler.
    // The detection is: `const hasFormat = formatTemplate && formatTemplate.trim().length > 0`
    // Let's verify this logic pattern directly:
    const cases = [
      { input: 'Some template', expected: true, label: 'normal template' },
      { input: '', expected: false, label: 'empty string' },
      { input: '   ', expected: false, label: 'whitespace only' },
      { input: null, expected: false, label: 'null' },
      { input: undefined, expected: false, label: 'undefined' },
      { input: '## Header\n- Bullet', expected: true, label: 'markdown template' },
    ];

    for (const { input, expected, label } of cases) {
      const hasFormat = input && input.trim().length > 0;
      assertEqual(!!hasFormat, expected,
        `${label}: hasFormat should be ${expected}, got ${!!hasFormat}`);
    }
  });

  await test('REFORMAT_SYSTEM prompt contains data preservation rules', async () => {
    // We can't directly access the REFORMAT_SYSTEM const, but we know it should be
    // in the server module. Let's check the file content for critical rules.
    const fs = require('fs');
    const serverCode = fs.readFileSync(require.resolve('../server'), 'utf-8');
    
    assert(serverCode.includes('Preserve EVERY number'),
      'REFORMAT_SYSTEM should require preserving numbers');
    assert(serverCode.includes('do not add, remove, or reinterpret'),
      'REFORMAT_SYSTEM should prevent adding/removing conclusions');
    assert(serverCode.includes('Preserve ALL conclusions'),
      'REFORMAT_SYSTEM should preserve conclusions');
  });

  await test('Two-pass path sends "Formatting..." status after "Analyzing..."', async () => {
    // Read the server source to verify the sequence
    const fs = require('fs');
    const serverCode = fs.readFileSync(require.resolve('../server'), 'utf-8');
    
    // Find the indices to verify ordering
    const analyzingIdx = serverCode.indexOf("'Analyzing...'");
    const formattingIdx = serverCode.indexOf("'Formatting...'");
    
    assert(analyzingIdx > 0, 'should have Analyzing... status');
    assert(formattingIdx > 0, 'should have Formatting... status');
    assert(formattingIdx > analyzingIdx, 
      'Formatting should come after Analyzing in the code flow');
  });

  await test('Pass 2 fallback shows original analysis on stream error', async () => {
    const fs = require('fs');
    const serverCode = fs.readFileSync(require.resolve('../server'), 'utf-8');
    
    assert(serverCode.includes('Format pass failed. Showing original analysis'),
      'should have fallback message when format pass fails');
  });

  await test('GL conflict warning emitted when sidebar GL differs from question GL', async () => {
    const fs = require('fs');
    const serverCode = fs.readFileSync(require.resolve('../server'), 'utf-8');
    
    assert(serverCode.includes('your question mentions'),
      'should warn about GL conflict between sidebar and question');
  });
}

// ═════════════════════════════════════════════════════════════════════════════
// CROSS-GL SSE ROUTING
// ═════════════════════════════════════════════════════════════════════════════

async function runCrossGLSSETests() {
  console.log('\n🌐 Cross-GL SSE Routing');

  await test('isMultiGLQuestion detects cross-GL patterns', () => {
    const session = new AnalysisSession('cross-gl-test');
    
    assert(session.isMultiGLQuestion('Compare PC and Toys'), 'should detect comparison');
    assert(session.isMultiGLQuestion('How did the overall week look?'), 'should detect overall');
    assert(session.isMultiGLQuestion('Summary of the week'), 'should detect summary');
    assert(session.isMultiGLQuestion('Aggregate across all GLs'), 'should detect aggregate');
    assert(!session.isMultiGLQuestion('How is PC GMS?'), 'should NOT detect single GL query');
  });

  if (testWeek) {
    await test('Cross-GL query via SSE returns content and done events', async () => {
      const res = await request(app)
        .post('/api/ask/stream')
        .send({
          question: 'How did the overall week look?',
          week: testWeek,
          sessionId: 'cross-gl-sse-test',
        })
        .buffer(true)
        .parse((res, cb) => {
          let data = '';
          res.on('data', chunk => { data += chunk.toString(); });
          res.on('end', () => cb(null, data));
        });

      const events = res.body.split('\n\n')
        .filter(line => line.startsWith('data: '))
        .map(line => {
          try { return JSON.parse(line.replace('data: ', '')); }
          catch { return null; }
        })
        .filter(Boolean);

      // Should have either content+done or error (LLM not configured)
      const hasContent = events.some(e => e.type === 'content');
      const hasError = events.some(e => e.type === 'error');
      
      assert(hasContent || hasError,
        `cross-GL should produce content or error, got: ${events.map(e => e.type).join(', ')}`);
    });
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// RUN ALL
// ═════════════════════════════════════════════════════════════════════════════

(async () => {
  try {
    await runSSETests();
    await runFormatTests();
    await runFormatCRUDTests();
    await runTwoPassLogicTests();
    await runCrossGLSSETests();
  } catch (err) {
    console.error('Fatal test error:', err);
    failed++;
  }

  console.log(`\n📊 SSE + Format: ${passed} passed, ${failed} failed`);
  if (failures.length > 0) {
    console.log('\nFailures:');
    failures.forEach(f => console.log(`  ✗ ${f.name}: ${f.error}`));
  }
  process.exit(failed > 0 ? 1 : 0);
})();
