#!/usr/bin/env node
/**
 * Leadership Autopilot — LLM Provider Abstraction Tests
 * 
 * Tests llm.js configuration, validation, and provider listing.
 * NO actual LLM calls — tests the provider infrastructure only.
 * Covers: T2-LLM-01 through T2-LLM-04
 * 
 * Prevents: Server starts but all queries fail with cryptic SDK errors,
 *           silent fallback to wrong provider, unconfigured provider selected.
 * 
 * Run: node test/llm.test.js
 */

const llm = require('../llm');

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

// =============================================================================
// T2-LLM-01: getConfig returns valid provider configuration
// Prevents: LLM layer fails to initialize, all queries broken
// =============================================================================

console.log('\n🤖 LLM Provider Configuration');

test('T2-LLM-01a: getConfig returns object with required fields', () => {
  const config = llm.getConfig();
  assertNotNull(config.provider, 'Config should have provider');
  assertNotNull(config.providerName, 'Config should have providerName');
  assertNotNull(config.model, 'Config should have model');
  assert(Array.isArray(config.availableModels), 'Config should have availableModels array');
  assert(config.availableModels.length >= 1, 'Should have at least 1 available model');
});

test('T2-LLM-01b: getConfig provider is a known provider', () => {
  const config = llm.getConfig();
  const knownProviders = ['anthropic', 'openai', 'gemini', 'bedrock'];
  assert(knownProviders.includes(config.provider),
    `Provider "${config.provider}" should be one of: ${knownProviders.join(', ')}`);
});

// =============================================================================
// T2-LLM-02: getConfig throws for unknown provider
// Prevents: Silent fallback to wrong provider
// =============================================================================

console.log('\n❌ Unknown Provider Handling');

test('T2-LLM-02: Unknown provider throws with helpful message', () => {
  const original = process.env.LLM_PROVIDER;
  try {
    process.env.LLM_PROVIDER = 'totally_fake_provider';
    let threw = false;
    let errorMsg = '';
    try {
      llm.getConfig();
    } catch (e) {
      threw = true;
      errorMsg = e.message;
    }
    assert(threw, 'Should throw for unknown provider');
    assert(errorMsg.includes('totally_fake_provider'),
      'Error should mention the bad provider name');
    assert(errorMsg.includes('Available') || errorMsg.includes('available'),
      'Error should list available providers');
  } finally {
    // Restore original
    if (original !== undefined) {
      process.env.LLM_PROVIDER = original;
    } else {
      delete process.env.LLM_PROVIDER;
    }
  }
});

// =============================================================================
// T2-LLM-03: validateCredentials checks required env vars per provider
// Prevents: Server starts but all queries fail with cryptic SDK errors
// =============================================================================

console.log('\n🔑 Credential Validation');

test('T2-LLM-03: validateCredentials checks appropriate env vars', () => {
  // Save original provider
  const origProvider = process.env.LLM_PROVIDER;
  const origAnthropicKey = process.env.ANTHROPIC_API_KEY;
  
  try {
    // Test with anthropic (simplest — single env var)
    process.env.LLM_PROVIDER = 'anthropic';
    
    // Clear the API key
    delete process.env.ANTHROPIC_API_KEY;
    
    let threw = false;
    let errorMsg = '';
    try {
      llm.validateCredentials();
    } catch (e) {
      threw = true;
      errorMsg = e.message;
    }
    assert(threw, 'Should throw when ANTHROPIC_API_KEY is missing');
    assert(errorMsg.includes('ANTHROPIC_API_KEY'),
      'Error should mention the missing env var');
  } finally {
    // Restore
    if (origProvider !== undefined) process.env.LLM_PROVIDER = origProvider;
    else delete process.env.LLM_PROVIDER;
    if (origAnthropicKey !== undefined) process.env.ANTHROPIC_API_KEY = origAnthropicKey;
  }
});

test('T2-LLM-03b: validateCredentials checks AWS keys for bedrock', () => {
  const origProvider = process.env.LLM_PROVIDER;
  const origAccessKey = process.env.AWS_ACCESS_KEY_ID;
  const origSecretKey = process.env.AWS_SECRET_ACCESS_KEY;
  
  try {
    process.env.LLM_PROVIDER = 'bedrock';
    delete process.env.AWS_ACCESS_KEY_ID;
    delete process.env.AWS_SECRET_ACCESS_KEY;
    
    let threw = false;
    let errorMsg = '';
    try {
      llm.validateCredentials();
    } catch (e) {
      threw = true;
      errorMsg = e.message;
    }
    assert(threw, 'Should throw when AWS keys are missing');
    assert(errorMsg.includes('AWS'), 'Error should mention AWS credentials');
  } finally {
    if (origProvider !== undefined) process.env.LLM_PROVIDER = origProvider;
    else delete process.env.LLM_PROVIDER;
    if (origAccessKey !== undefined) process.env.AWS_ACCESS_KEY_ID = origAccessKey;
    if (origSecretKey !== undefined) process.env.AWS_SECRET_ACCESS_KEY = origSecretKey;
  }
});

// =============================================================================
// T2-LLM-04: listProviders shows configuration status
// Prevents: User selects unconfigured provider, gets unhelpful error
// =============================================================================

console.log('\n📋 Provider Listing');

test('T2-LLM-04a: listProviders returns all known providers', () => {
  const providers = llm.listProviders();
  assert(Array.isArray(providers), 'listProviders should return array');
  assert(providers.length >= 4, 'Should have at least 4 providers');
  
  const ids = providers.map(p => p.id);
  assert(ids.includes('anthropic'), 'Should include anthropic');
  assert(ids.includes('openai'), 'Should include openai');
  assert(ids.includes('gemini'), 'Should include gemini');
  assert(ids.includes('bedrock'), 'Should include bedrock');
});

test('T2-LLM-04b: Each provider has required fields', () => {
  const providers = llm.listProviders();
  for (const p of providers) {
    assertNotNull(p.id, `Provider should have id`);
    assertNotNull(p.name, `Provider ${p.id} should have name`);
    assert(Array.isArray(p.models), `Provider ${p.id} should have models array`);
    assertNotNull(p.defaultModel, `Provider ${p.id} should have defaultModel`);
    assert(typeof p.configured === 'boolean', 
      `Provider ${p.id} should have boolean configured field`);
  }
});

test('T2-LLM-04c: configured reflects actual env var presence', () => {
  const providers = llm.listProviders();
  const anthropic = providers.find(p => p.id === 'anthropic');
  const hasKey = !!process.env.ANTHROPIC_API_KEY;
  assertEqual(anthropic.configured, hasKey,
    `Anthropic configured=${anthropic.configured} should match env key presence=${hasKey}`);
});

// =============================================================================
// PROVIDERS constant validation
// =============================================================================

console.log('\n🏗️ PROVIDERS Constant');

test('PROVIDERS has expected provider keys', () => {
  const providerKeys = Object.keys(llm.PROVIDERS);
  assert(providerKeys.includes('anthropic'), 'Should have anthropic');
  assert(providerKeys.includes('openai'), 'Should have openai');
  assert(providerKeys.includes('gemini'), 'Should have gemini');
  assert(providerKeys.includes('bedrock'), 'Should have bedrock');
});

test('Each PROVIDERS entry has envKey or envKeys', () => {
  for (const [id, config] of Object.entries(llm.PROVIDERS)) {
    assert(config.envKey || config.envKeys,
      `Provider ${id} should have envKey or envKeys`);
    assertNotNull(config.name, `Provider ${id} should have name`);
    assertNotNull(config.defaultModel, `Provider ${id} should have defaultModel`);
    assert(Array.isArray(config.models), `Provider ${id} should have models array`);
  }
});

// =============================================================================
// SUMMARY
// =============================================================================

console.log('\n' + '═'.repeat(50));
console.log(`\n📋 LLM Tests: ${passed} passed, ${failed} failed\n`);

if (failed > 0) {
  console.log('Failed tests:');
  failures.forEach(f => {
    console.log(`  • ${f.name}: ${f.error}`);
  });
  process.exit(1);
} else {
  console.log('All LLM tests passed! ✓\n');
  process.exit(0);
}
