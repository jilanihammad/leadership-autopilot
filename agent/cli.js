#!/usr/bin/env node
/**
 * Leadership Autopilot CLI
 * 
 * Interactive command-line interface for testing the agent.
 */

require('dotenv').config();

const readline = require('readline');
const { AnalysisSession } = require('./server');
const llm = require('./llm');

const session = new AnalysisSession('cli');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

// Show config on startup
let config;
try {
  config = llm.getConfig();
  llm.validateCredentials();
} catch (error) {
  console.error('❌ Configuration Error:', error.message);
  console.log('\n💡 Run: npm run setup');
  console.log('   Then edit .env with your credentials\n');
  process.exit(1);
}

console.log('═══════════════════════════════════════════════════════════════');
console.log('  Leadership Autopilot CLI');
console.log('═══════════════════════════════════════════════════════════════');
console.log('');
console.log(`🤖 Provider: ${config.providerName} | Model: ${config.model}`);
console.log('');
console.log('Commands:');
console.log('  /week <week>  - Set week (e.g., /week 2026-wk05)');
console.log('  /status       - Show current session state');
console.log('  /config       - Show LLM configuration');
console.log('  /reset        - Reset session');
console.log('  /quit         - Exit');
console.log('');
console.log('Ask questions like:');
console.log('  "Why did PC GMS grow this week?"');
console.log('  "What about margin?"');
console.log('  "Go deeper on monitors"');
console.log('  "Now tell me about Toys"');
console.log('');
console.log('═══════════════════════════════════════════════════════════════');
console.log('');

let currentWeek = '2026-wk05';

async function handleInput(input) {
  const trimmed = input.trim();

  if (!trimmed) return;

  // Handle commands
  if (trimmed.startsWith('/')) {
    const [cmd, ...args] = trimmed.slice(1).split(' ');

    switch (cmd.toLowerCase()) {
      case 'week':
        currentWeek = args[0] || currentWeek;
        console.log(`\n📅 Week set to: ${currentWeek}\n`);
        return;

      case 'status':
        console.log('\n📊 Session Status:');
        console.log(`  Current GL: ${session.currentGL || 'None'}`);
        console.log(`  Current Week: ${session.currentWeek || currentWeek}`);
        console.log(`  Conversation turns: ${session.conversationHistory.length / 2}`);
        console.log('');
        return;

      case 'reset':
        session.currentGL = null;
        session.currentWeek = null;
        session.conversationHistory = [];
        console.log('\n🔄 Session reset.\n');
        return;

      case 'config':
        const cfg = llm.getConfig();
        const providers = llm.listProviders();
        console.log('\n🔧 LLM Configuration:');
        console.log(`  Provider: ${cfg.providerName}`);
        console.log(`  Model: ${cfg.model}`);
        console.log('\n📋 Available Providers:');
        providers.forEach(p => {
          const status = p.configured ? '✅' : '❌';
          console.log(`  ${status} ${p.name} (${p.id})`);
          console.log(`     Models: ${p.models.join(', ')}`);
        });
        console.log('\n💡 Edit .env to change provider/model\n');
        return;

      case 'quit':
      case 'exit':
        console.log('\n👋 Goodbye!\n');
        rl.close();
        process.exit(0);

      default:
        console.log(`\n❓ Unknown command: ${cmd}\n`);
        return;
    }
  }

  // Handle question
  console.log('\n⏳ Analyzing...\n');

  try {
    const result = await session.handleQuery(trimmed, currentWeek);

    console.log(`📁 GL: ${result.gl?.toUpperCase() || 'N/A'} | Week: ${result.week}`);
    console.log('───────────────────────────────────────────────────────────────');
    console.log('');
    console.log(result.response);
    console.log('');
    console.log('═══════════════════════════════════════════════════════════════');
    console.log('');
  } catch (error) {
    console.error(`\n❌ Error: ${error.message}\n`);
    if (error.message.includes('ANTHROPIC_API_KEY')) {
      console.log('💡 Set your API key: export ANTHROPIC_API_KEY=your-key-here\n');
    }
  }
}

function prompt() {
  const glIndicator = session.currentGL ? `[${session.currentGL.toUpperCase()}]` : '';
  rl.question(`${glIndicator}> `, async (input) => {
    await handleInput(input);
    prompt();
  });
}

// Handle single question mode (for scripting)
if (process.argv.length > 2) {
  const question = process.argv.slice(2).join(' ');
  handleInput(question).then(() => process.exit(0));
} else {
  prompt();
}
