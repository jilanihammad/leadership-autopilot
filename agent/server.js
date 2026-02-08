#!/usr/bin/env node
/**
 * Leadership Autopilot Server
 * 
 * Handles queries with smart context management:
 * - Keep context within same GL (follow-ups)
 * - Flush context when switching GLs
 * - Cross-GL queries use weekly findings only
 */

require('dotenv').config();

const express = require('express');
const fs = require('fs');
const path = require('path');
const tools = require('./tools');
const llm = require('./llm');

// Initialize
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Load static prompts
const SYSTEM_PROMPT = fs.readFileSync(path.join(__dirname, 'SYSTEM_PROMPT.md'), 'utf-8');
const ANALYSIS_FRAMEWORK = fs.readFileSync(path.join(__dirname, 'ANALYSIS_FRAMEWORK.md'), 'utf-8');

// Session storage (in-memory for now)
const sessions = new Map();

/**
 * Analysis Session - manages context per user
 */
class AnalysisSession {
  constructor(sessionId) {
    this.sessionId = sessionId;
    this.currentGL = null;
    this.currentWeek = null;
    this.conversationHistory = [];
    this.maxHistoryTurns = 5;
    this.loadedData = {};
  }

  /**
   * Detect GL from question
   */
  detectGL(question) {
    const glPatterns = {
      'pc': /\b(pc|computer|laptop|monitor|keyboard|mouse|memory\s*card|usb|cable|flash|sdxc|microsd)\b/i,
      'toys': /\b(toys|toy|games|gaming|lego|puzzle|action\s*figure)\b/i,
      'office': /\b(office|supplies|paper|printer|desk|stationery)\b/i,
      'home': /\b(home|kitchen|furniture|appliance|cookware)\b/i,
      'pets': /\b(pets|pet|dog|cat|animal|food)\b/i,
      'ce': /\b(electronics|ce|tv|audio|speaker|headphone)\b/i,
      'wireless': /\b(wireless|mobile|phone|cellular|charger)\b/i,
      'camera': /\b(camera|photo|lens|tripod)\b/i,
      'garden': /\b(garden|outdoor|lawn|patio)\b/i,
      'sports': /\b(sports|fitness|exercise|outdoor)\b/i,
    };

    for (const [gl, pattern] of Object.entries(glPatterns)) {
      if (pattern.test(question)) {
        return gl;
      }
    }
    return null;
  }

  /**
   * Check if question is about multiple GLs
   */
  isMultiGLQuestion(question) {
    const patterns = [
      /compare.*(?:and|vs|versus|to)/i,
      /across\s+(?:all\s+)?gl/i,
      /all\s+gl/i,
      /summary\s+(?:of\s+)?(?:the\s+)?week/i,
      /overall|total|aggregate/i,
      /how\s+(?:did|does)\s+(?:the\s+)?week\s+look/i,
    ];
    return patterns.some(p => p.test(question));
  }

  /**
   * Determine what data to load based on question
   * Simplified: always load all subcat data, only check for optional extras
   */
  determineDataNeeds(question) {
    const q = question.toLowerCase();
    
    return {
      // Always load these
      summary: true,
      allSubcats: true,  // NEW: Always load complete subcat data
      
      // Optional extras based on question
      traffic: /traffic|gv|glance|views|visit|channel/.test(q),
      asin: /asin|product|sku|item|deep\s*dive|drill|specific\s+product/.test(q),
    };
  }

  /**
   * Build context for LLM - now always includes all subcat data
   */
  buildContext(week, gl, question, dataNeeds) {
    let dataContext = '';

    // Always include summary
    const summaryResult = tools.getSummary(week, gl);
    if (summaryResult.summary) {
      dataContext += `\n## ${gl.toUpperCase()} Summary (Week ${week.split('-')[1]})\n\n`;
      dataContext += summaryResult.summary;
    }

    // ALWAYS load all subcategory data - this is the key change
    if (dataNeeds.allSubcats) {
      const allData = tools.getAllSubcatData(week, gl);
      if (allData.subcats && allData.subcats.length > 0) {
        dataContext += `\n\n## Complete Subcategory Data\n`;
        dataContext += `*All ${allData.subcats.length} subcategories, sorted by GMS impact*\n\n`;
        
        // Build comprehensive table with all metrics
        dataContext += `| Subcategory | GMS | GMS YoY | Units | Units YoY | ASP | ASP YoY | Net PPM | Net PPM YoY | CTC (bps) |\n`;
        dataContext += `|-------------|-----|---------|-------|-----------|-----|---------|---------|-------------|----------|\n`;
        
        allData.subcats.forEach(s => {
          const gms = s.metrics.GMS || {};
          const units = s.metrics.ShippedUnits || {};
          const asp = s.metrics.ASP || {};
          const npm = s.metrics.NetPPMLessSD || {};
          
          // Format values
          const gmsVal = gms.value ? `$${Math.round(gms.value).toLocaleString()}` : '-';
          const gmsYoy = gms.yoy_pct ? `${(gms.yoy_pct * 100).toFixed(1)}%` : '-';
          const unitsVal = units.value ? units.value.toLocaleString() : '-';
          const unitsYoy = units.yoy_pct ? `${(units.yoy_pct * 100).toFixed(1)}%` : '-';
          const aspVal = asp.value ? `$${asp.value.toFixed(2)}` : '-';
          const aspYoy = asp.yoy_pct ? `${(asp.yoy_pct * 100).toFixed(1)}%` : '-';
          const npmVal = npm.value ? `${(npm.value * 100).toFixed(1)}%` : '-';
          const npmYoy = npm.yoy_pct ? `${(npm.yoy_pct * 100).toFixed(1)}%` : '-';
          const ctc = gms.yoy_ctc_bps || 0;
          
          dataContext += `| ${s.name} | ${gmsVal} | ${gmsYoy} | ${unitsVal} | ${unitsYoy} | ${aspVal} | ${aspYoy} | ${npmVal} | ${npmYoy} | ${ctc} |\n`;
        });
      }
    }

    // Optional: ASIN detail (only when explicitly requested)
    if (dataNeeds.asin) {
      const asinData = tools.getAsinDetail(week, gl, 'GMS', { limit: 15 });
      if (asinData.asins) {
        dataContext += `\n\n## Top ASINs (by GMS CTC)\n`;
        dataContext += `| ASIN | Product | GMS | CTC |\n|------|---------|-----|-----|\n`;
        asinData.asins.forEach(a => {
          dataContext += `| ${a.asin} | ${a.item_name.substring(0, 50)}... | $${(a.value || 0).toLocaleString()} | ${a.ctc} |\n`;
        });
      }
    }

    // Optional: Traffic channels (only when asked)
    if (dataNeeds.traffic) {
      const trafficData = tools.getTrafficChannels(week, gl, { limit: 10 });
      if (trafficData.channels) {
        dataContext += `\n\n## Traffic by Channel\n`;
        dataContext += `| Channel | GV | YoY |\n|---------|-----|-----|\n`;
        trafficData.channels.forEach(c => {
          dataContext += `| ${c.channel} | ${c.gv.toLocaleString()} | ${(c.yoy * 100).toFixed(1)}% |\n`;
        });
      }
    }

    return dataContext;
  }

  /**
   * Get or create weekly findings file path
   */
  getWeeklyFindingsPath(week) {
    const weekDir = path.join(__dirname, '..', 'data', 'weekly', week);
    return path.join(weekDir, '_weekly_findings.md');
  }

  /**
   * Load weekly findings
   */
  getWeeklyFindings(week) {
    const findingsPath = this.getWeeklyFindingsPath(week);
    if (fs.existsSync(findingsPath)) {
      return fs.readFileSync(findingsPath, 'utf-8');
    }
    return '# Weekly Findings\n\nNo findings recorded yet.';
  }

  /**
   * Append findings to weekly file
   */
  appendToWeeklyFindings(week, gl, findings) {
    const findingsPath = this.getWeeklyFindingsPath(week);
    let content = '';
    
    if (fs.existsSync(findingsPath)) {
      content = fs.readFileSync(findingsPath, 'utf-8');
    } else {
      content = `# Week ${week.split('-')[1]} Findings\n\n`;
    }

    // Check if GL section exists
    const glHeader = `## ${gl.toUpperCase()}`;
    if (!content.includes(glHeader)) {
      content += `\n${glHeader}\n\n`;
    }

    // Append findings under GL section
    const glSectionRegex = new RegExp(`(## ${gl.toUpperCase()}\n\n)`, 'i');
    content = content.replace(glSectionRegex, `$1${findings}\n\n`);

    fs.writeFileSync(findingsPath, content);
  }

  /**
   * Extract key findings from response
   */
  extractKeyFindings(response) {
    // Simple extraction - look for key patterns
    const lines = response.split('\n');
    const findings = [];
    
    for (const line of lines) {
      // Look for bullet points with key info
      if (line.match(/^[-*]\s+.*(?:driven|caused|due to|because|↑|↓|🚨|⚠️)/i)) {
        findings.push(line);
      }
      // Look for summary lines
      if (line.match(/^>\s+/)) {
        findings.push(line);
      }
    }

    if (findings.length === 0) {
      // Fallback: take first 3 meaningful lines
      const meaningful = lines.filter(l => l.length > 50 && !l.startsWith('#') && !l.startsWith('|'));
      return meaningful.slice(0, 3).map(l => `- ${l}`).join('\n');
    }

    return findings.slice(0, 5).join('\n');
  }

  /**
   * Handle a query
   */
  async handleQuery(question, week) {
    // Default week if not specified
    if (!week) {
      const weeks = tools.listWeeks();
      week = weeks.weeks[0] || '2026-wk05';
    }

    // Check for multi-GL question
    if (this.isMultiGLQuestion(question)) {
      return this.handleCrossGLQuery(question, week);
    }

    // Detect GL
    let detectedGL = this.detectGL(question);

    // If no GL detected, assume follow-up on current GL
    if (!detectedGL) {
      if (this.currentGL) {
        detectedGL = this.currentGL;
      } else {
        // No context yet - ask for clarification
        return {
          response: "Which GL would you like me to analyze? (e.g., PC, Toys, Office, Home, Pets)",
          gl: null,
          week: week,
        };
      }
    }

    // Check if GL changed
    if (detectedGL !== this.currentGL) {
      // Save findings from previous GL
      if (this.currentGL && this.conversationHistory.length > 0) {
        const lastResponse = this.conversationHistory[this.conversationHistory.length - 1]?.content || '';
        const findings = this.extractKeyFindings(lastResponse);
        if (findings) {
          this.appendToWeeklyFindings(this.currentWeek || week, this.currentGL, findings);
        }
      }

      // Switch to new GL
      this.currentGL = detectedGL;
      this.currentWeek = week;
      this.conversationHistory = [];
      this.loadedData = {};
    }

    // Determine what data to load
    const dataNeeds = this.determineDataNeeds(question);

    // Build data context
    const dataContext = this.buildContext(week, detectedGL, question, dataNeeds);

    // Build messages
    const messages = [
      ...this.conversationHistory,
      { role: 'user', content: question }
    ];

    // Call LLM (uses configured provider)
    const systemPrompt = `${SYSTEM_PROMPT}\n\n${ANALYSIS_FRAMEWORK}\n\n---\n\n# Current Data\n${dataContext}`;
    const assistantMessage = await llm.chat(systemPrompt, messages);

    // Update conversation history
    this.conversationHistory.push({ role: 'user', content: question });
    this.conversationHistory.push({ role: 'assistant', content: assistantMessage });

    // Trim history if too long
    if (this.conversationHistory.length > this.maxHistoryTurns * 2) {
      this.conversationHistory = this.conversationHistory.slice(-this.maxHistoryTurns * 2);
    }

    return {
      response: assistantMessage,
      gl: detectedGL,
      week: week,
    };
  }

  /**
   * Handle cross-GL query
   */
  async handleCrossGLQuery(question, week) {
    // Save current GL findings first
    if (this.currentGL && this.conversationHistory.length > 0) {
      const lastResponse = this.conversationHistory[this.conversationHistory.length - 1]?.content || '';
      const findings = this.extractKeyFindings(lastResponse);
      if (findings) {
        this.appendToWeeklyFindings(this.currentWeek || week, this.currentGL, findings);
      }
    }

    // Load weekly findings
    const weeklyFindings = this.getWeeklyFindings(week);

    // Also load summaries for all available GLs
    const glList = tools.listGLs(week);
    let summaries = '';
    for (const gl of glList.gls) {
      const summary = tools.getSummary(week, gl.name);
      if (summary.summary) {
        summaries += `\n## ${gl.name.toUpperCase()}\n${summary.summary}\n`;
      }
    }

    // Build context
    const dataContext = `# Weekly Findings (Prior Analyses)\n${weeklyFindings}\n\n# GL Summaries\n${summaries}`;

    // Call LLM (uses configured provider)
    const systemPrompt = `${SYSTEM_PROMPT}\n\n---\n\n${dataContext}`;
    const assistantMessage = await llm.chat(systemPrompt, [{ role: 'user', content: question }]);

    // Reset state for cross-GL
    this.currentGL = null;
    this.conversationHistory = [];

    return {
      response: assistantMessage,
      gl: 'cross-gl',
      week: week,
    };
  }
}

/**
 * Get or create session
 */
function getSession(sessionId) {
  if (!sessions.has(sessionId)) {
    sessions.set(sessionId, new AnalysisSession(sessionId));
  }
  return sessions.get(sessionId);
}

// API Routes

app.post('/api/ask', async (req, res) => {
  try {
    const { question, week, sessionId = 'default' } = req.body;

    if (!question) {
      return res.status(400).json({ error: 'Question is required' });
    }

    const session = getSession(sessionId);
    const result = await session.handleQuery(question, week);

    res.json(result);
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/weeks', (req, res) => {
  res.json(tools.listWeeks());
});

app.get('/api/gls/:week', (req, res) => {
  res.json(tools.listGLs(req.params.week));
});

app.get('/api/session/:sessionId', (req, res) => {
  const session = sessions.get(req.params.sessionId);
  if (!session) {
    return res.json({ currentGL: null, currentWeek: null, historyLength: 0 });
  }
  res.json({
    currentGL: session.currentGL,
    currentWeek: session.currentWeek,
    historyLength: session.conversationHistory.length,
  });
});

app.post('/api/session/:sessionId/reset', (req, res) => {
  sessions.delete(req.params.sessionId);
  res.json({ success: true });
});

// Streaming endpoint
app.post('/api/ask/stream', async (req, res) => {
  try {
    const { question, week, gl: requestedGL, sessionId = 'default' } = req.body;

    if (!question) {
      return res.status(400).json({ error: 'Question is required' });
    }

    // Set up SSE
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const session = getSession(sessionId);
    
    // Check for cross-GL query first (only if no GL was explicitly selected)
    if (!requestedGL && session.isMultiGLQuestion(question)) {
      // For now, fallback to non-streaming for cross-GL
      const result = await session.handleCrossGLQuery(question, week || tools.listWeeks().weeks[0]);
      res.write(`data: ${JSON.stringify({ type: 'content', text: result.response })}\n\n`);
      res.write(`data: ${JSON.stringify({ type: 'done', gl: result.gl, week: result.week })}\n\n`);
      res.end();
      return;
    }

    // Get week
    const activeWeek = week || session.currentWeek || tools.listWeeks().weeks[0];

    // Determine GL: explicit selection > detected from question > session context
    let detectedGL = requestedGL || session.detectGL(question);
    if (!detectedGL && session.currentGL) {
      detectedGL = session.currentGL;
    }
    
    // If still no GL and none was explicitly selected, ask for clarification
    if (!detectedGL) {
      res.write(`data: ${JSON.stringify({ type: 'content', text: "Which GL would you like me to analyze? (e.g., PC, Toys, Office, Home, Pets)" })}\n\n`);
      res.write(`data: ${JSON.stringify({ type: 'done', gl: null, week: activeWeek })}\n\n`);
      res.end();
      return;
    }

    // Check if GL changed
    if (detectedGL !== session.currentGL) {
      session.currentGL = detectedGL;
      session.currentWeek = activeWeek;
      session.conversationHistory = [];
      session.loadedData = {};
    }

    // Determine what data to load
    const dataNeeds = session.determineDataNeeds(question);
    const dataContext = session.buildContext(activeWeek, detectedGL, question, dataNeeds);

    // Build messages
    const messages = [
      ...session.conversationHistory,
      { role: 'user', content: question }
    ];

    const systemPrompt = `${SYSTEM_PROMPT}\n\n${ANALYSIS_FRAMEWORK}\n\n---\n\n# Current Data\n${dataContext}`;

    // Stream response
    let fullResponse = '';
    try {
      for await (const chunk of llm.chatStream(systemPrompt, messages)) {
        fullResponse += chunk;
        res.write(`data: ${JSON.stringify({ type: 'content', text: chunk })}\n\n`);
      }
    } catch (streamError) {
      console.error('Stream error:', streamError);
      res.write(`data: ${JSON.stringify({ type: 'error', error: streamError.message })}\n\n`);
    }

    // Update conversation history
    session.conversationHistory.push({ role: 'user', content: question });
    session.conversationHistory.push({ role: 'assistant', content: fullResponse });

    // Trim history if too long
    if (session.conversationHistory.length > session.maxHistoryTurns * 2) {
      session.conversationHistory = session.conversationHistory.slice(-session.maxHistoryTurns * 2);
    }

    res.write(`data: ${JSON.stringify({ type: 'done', gl: detectedGL, week: activeWeek })}\n\n`);
    res.end();

  } catch (error) {
    console.error('Stream error:', error);
    res.write(`data: ${JSON.stringify({ type: 'error', error: error.message })}\n\n`);
    res.end();
  }
});

// LLM Configuration endpoints
app.get('/api/config', (req, res) => {
  try {
    const config = llm.getConfig();
    const providers = llm.listProviders();
    res.json({ config, providers });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/providers', (req, res) => {
  res.json(llm.listProviders());
});

app.post('/api/config/validate', (req, res) => {
  try {
    llm.validateCredentials();
    const config = llm.getConfig();
    res.json({ valid: true, config });
  } catch (error) {
    res.json({ valid: false, error: error.message });
  }
});

// Start server
const PORT = process.env.PORT || 3456;
app.listen(PORT, () => {
  console.log(`Leadership Autopilot server running on http://localhost:${PORT}`);
  console.log('\nAPI Endpoints:');
  console.log('  POST /api/ask          - Ask a question');
  console.log('  GET  /api/weeks        - List available weeks');
  console.log('  GET  /api/gls/:week    - List GLs for a week');
  console.log('  GET  /api/session/:id  - Get session state');
  console.log('  POST /api/session/:id/reset - Reset session');
});

module.exports = { app, AnalysisSession };
