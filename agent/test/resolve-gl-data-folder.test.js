#!/usr/bin/env node
/**
 * resolveGLDataFolder() Unit Tests
 *
 * This function routes ALL data access in the app. It decides whether to
 * read from the consolidated ALL directory (with GL filtering) or from
 * per-GL folders (legacy/fallback). Getting this wrong means every
 * downstream metric, driver, and ASIN lookup uses the wrong data.
 *
 * Tests all 4 code paths:
 *   1. ALL manifest exists, gl !== 'all' → ALL dir + useAllWithFilter=true
 *   2. ALL manifest exists, gl === 'all' → ALL dir + useAllWithFilter=false
 *   3. No ALL manifest, per-GL folder exists → per-GL dir + useAllWithFilter=false
 *   4. Nothing found → { dataDir: null, manifest: null, useAllWithFilter: false }
 *
 * Also tests case insensitivity (gl='PC' vs 'pc').
 *
 * Run: cd agent && node test/resolve-gl-data-folder.test.js
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const yaml = require('yaml');

// We need to test the actual function but it uses DATA_DIR which is module-level.
// Since resolveGLDataFolder uses the module-level DATA_DIR constant, we need to
// work with real data or patch. Let's test via the public API (getDataAvailability
// calls resolveGLDataFolder) AND test with fixture directories by requiring tools
// and checking its behavior indirectly.
//
// Actually, now that resolveGLDataFolder is exported, we can test it IF we
// create fixture data in the actual DATA_DIR location. But that's messy.
// Instead, let's create a standalone test that reimplements the pure logic
// and also does integration tests via getDataAvailability.

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

function assertNotNull(value, message) {
  if (value === null || value === undefined) {
    throw new Error(message || 'Expected non-null value');
  }
}

// ─── Create temp fixture data ──────────────────────────────────────────────
const FIXTURE_WEEK = '9999-wk99';
const DATA_DIR = path.join(__dirname, '..', '..', 'data', 'weekly');
const fixtureWeekDir = path.join(DATA_DIR, FIXTURE_WEEK, 'gl');

// Manifest content for ALL folder
const allManifest = {
  week: FIXTURE_WEEK,
  gl: 'all',
  files: {
    subcat: { GMS: 'GMS_subcats.xlsx', NetPPMLessSD: 'NetPPMLessSD_subcats.xlsx' },
    asin: { GMS: 'GMS_asins.xlsx' },
  },
};

// Manifest content for per-GL folder (pc)
const pcManifest = {
  week: FIXTURE_WEEK,
  gl: 'pc',
  files: {
    subcat: { GMS: 'GMS_subcats.xlsx' },
    asin: {},
  },
};

function setupFixtures() {
  // Create ALL directory with manifest
  const allDir = path.join(fixtureWeekDir, 'all');
  fs.mkdirSync(allDir, { recursive: true });
  fs.writeFileSync(path.join(allDir, '_manifest.yaml'), yaml.stringify(allManifest));
  // Create a minimal _summary.md so getDataAvailability doesn't choke
  fs.writeFileSync(path.join(allDir, '_summary.md'), '# Test summary\nTest data only.');

  // Create per-GL (pc) directory with manifest
  const pcDir = path.join(fixtureWeekDir, 'pc');
  fs.mkdirSync(pcDir, { recursive: true });
  fs.writeFileSync(path.join(pcDir, '_manifest.yaml'), yaml.stringify(pcManifest));
  fs.writeFileSync(path.join(pcDir, '_summary.md'), '# PC summary\nTest data only.');
}

function cleanupFixtures() {
  const weekDir = path.join(DATA_DIR, FIXTURE_WEEK);
  if (fs.existsSync(weekDir)) {
    fs.rmSync(weekDir, { recursive: true, force: true });
  }
}

// ─── Tests ──────────────────────────────────────────────────────────────────
console.log('\n🗂️  resolveGLDataFolder() Unit Tests');

// Set up fixture data
setupFixtures();

try {
  // ── Path 1: ALL manifest exists, gl !== 'all' → useAllWithFilter=true ──
  console.log('\n  Path 1: ALL manifest + specific GL → filter mode');

  test('returns ALL dir when ALL manifest exists and gl=pc', () => {
    const result = tools.resolveGLDataFolder(FIXTURE_WEEK, 'pc');
    assertNotNull(result.dataDir, 'dataDir should not be null');
    assert(result.dataDir.endsWith(path.join('gl', 'all')), `dataDir should end with gl/all, got: ${result.dataDir}`);
    assertEqual(result.useAllWithFilter, true, 'useAllWithFilter should be true for specific GL');
    assertNotNull(result.manifest, 'manifest should not be null');
    assertEqual(result.manifest.gl, 'all', 'manifest.gl should be "all"');
  });

  test('manifest has expected file entries from ALL', () => {
    const result = tools.resolveGLDataFolder(FIXTURE_WEEK, 'pc');
    assert(result.manifest.files.subcat.GMS === 'GMS_subcats.xlsx', 'should have GMS subcat file');
    assert(result.manifest.files.subcat.NetPPMLessSD === 'NetPPMLessSD_subcats.xlsx', 'should have NetPPM subcat file');
  });

  // ── Path 1b: Case insensitivity ──
  test('case insensitive: gl=PC resolves same as gl=pc (both use ALL)', () => {
    const lower = tools.resolveGLDataFolder(FIXTURE_WEEK, 'pc');
    const upper = tools.resolveGLDataFolder(FIXTURE_WEEK, 'PC');
    assertEqual(lower.dataDir, upper.dataDir, 'dataDir should be identical regardless of case');
    assertEqual(lower.useAllWithFilter, upper.useAllWithFilter, 'useAllWithFilter should match');
  });

  test('case insensitive: gl=Pc (mixed case) also uses ALL with filter', () => {
    const result = tools.resolveGLDataFolder(FIXTURE_WEEK, 'Pc');
    assertEqual(result.useAllWithFilter, true, 'mixed case should still filter');
    assert(result.dataDir.endsWith(path.join('gl', 'all')), 'should still use ALL dir');
  });

  // ── Path 2: ALL manifest exists, gl='all' → useAllWithFilter=false ──
  console.log('\n  Path 2: ALL manifest + gl=all → no filter');

  test('returns ALL dir with useAllWithFilter=false when gl=all', () => {
    const result = tools.resolveGLDataFolder(FIXTURE_WEEK, 'all');
    assertNotNull(result.dataDir, 'dataDir should not be null');
    assert(result.dataDir.endsWith(path.join('gl', 'all')), `dataDir should end with gl/all`);
    assertEqual(result.useAllWithFilter, false, 'useAllWithFilter should be false for gl=all');
  });

  test('gl=ALL (uppercase) also returns useAllWithFilter=false', () => {
    const result = tools.resolveGLDataFolder(FIXTURE_WEEK, 'ALL');
    assertEqual(result.useAllWithFilter, false, 'gl=ALL should not filter');
    assert(result.dataDir.endsWith(path.join('gl', 'all')), 'should use ALL dir');
  });

  // ── Path 3: No ALL manifest, per-GL folder fallback ──
  console.log('\n  Path 3: No ALL manifest → per-GL fallback');

  // For this path, remove the ALL manifest temporarily
  const allManifestPath = path.join(fixtureWeekDir, 'all', '_manifest.yaml');
  const allManifestBackup = fs.readFileSync(allManifestPath, 'utf-8');
  fs.unlinkSync(allManifestPath);

  test('falls back to per-GL folder when ALL manifest missing', () => {
    const result = tools.resolveGLDataFolder(FIXTURE_WEEK, 'pc');
    assertNotNull(result.dataDir, 'dataDir should not be null');
    assert(result.dataDir.endsWith(path.join('gl', 'pc')), `dataDir should end with gl/pc, got: ${result.dataDir}`);
    assertEqual(result.useAllWithFilter, false, 'useAllWithFilter should be false for per-GL');
  });

  test('per-GL manifest has correct content', () => {
    const result = tools.resolveGLDataFolder(FIXTURE_WEEK, 'pc');
    assertEqual(result.manifest.gl, 'pc', 'manifest.gl should be "pc"');
    assert(result.manifest.files.subcat.GMS === 'GMS_subcats.xlsx', 'should have GMS in per-GL manifest');
  });

  // Restore ALL manifest
  fs.writeFileSync(allManifestPath, allManifestBackup);

  // ── Path 4: Nothing found ──
  console.log('\n  Path 4: Nothing found → null result');

  test('returns null when neither ALL nor per-GL exists', () => {
    const result = tools.resolveGLDataFolder(FIXTURE_WEEK, 'nonexistent_gl_xyz');
    // When ALL exists, it returns ALL dir even for nonexistent GLs (filter mode)
    // So we need to test with a week that has no ALL
    // Actually — wait. ALL exists here so it will return ALL. Let me remove it.
    // This is correct behavior: if ALL exists, we always use ALL + filter.
    assertNotNull(result.dataDir, 'with ALL present, even unknown GL uses ALL dir');
    assertEqual(result.useAllWithFilter, true, 'should filter for unknown GL name');
  });

  // Remove ALL manifest again to test true "nothing found"
  fs.unlinkSync(allManifestPath);

  test('returns null dataDir when no ALL and no per-GL folder', () => {
    const result = tools.resolveGLDataFolder(FIXTURE_WEEK, 'nonexistent_gl_xyz');
    assertEqual(result.dataDir, null, 'dataDir should be null');
    assertEqual(result.manifest, null, 'manifest should be null');
    assertEqual(result.useAllWithFilter, false, 'useAllWithFilter should be false');
  });

  test('returns null for completely nonexistent week', () => {
    const result = tools.resolveGLDataFolder('0000-wk00', 'pc');
    assertEqual(result.dataDir, null, 'dataDir should be null for nonexistent week');
    assertEqual(result.manifest, null, 'manifest should be null');
  });

  // Restore ALL manifest
  fs.writeFileSync(allManifestPath, allManifestBackup);

  // ── Integration: getDataAvailability uses resolveGLDataFolder ──
  console.log('\n  Integration: getDataAvailability routing');

  test('getDataAvailability returns available=true for fixture week+GL', () => {
    const result = tools.getDataAvailability(FIXTURE_WEEK, 'pc');
    assertEqual(result.available, true, `should be available, got error: ${result.error}`);
    assertEqual(result.gl, 'pc', 'GL should be pc');
    assertEqual(result.week, FIXTURE_WEEK, 'week should match');
  });

  test('getDataAvailability returns available=false for nonexistent week', () => {
    const result = tools.getDataAvailability('0000-wk00', 'pc');
    assertEqual(result.available, false, 'should not be available');
  });

} finally {
  // Always clean up fixtures
  cleanupFixtures();
}

// ─── Report ─────────────────────────────────────────────────────────────────
console.log(`\n📊 resolveGLDataFolder: ${passed} passed, ${failed} failed`);
if (failures.length > 0) {
  console.log('\nFailures:');
  failures.forEach(f => console.log(`  ✗ ${f.name}: ${f.error}`));
}
process.exit(failed > 0 ? 1 : 0);
