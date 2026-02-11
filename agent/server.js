#!/usr/bin/env node
/**
 * Leadership Autopilot Server — v2 Consolidated
 * 
 * Uses consolidated ALL data files with CTC recomputation.
 * Supports ALL (portfolio) and per-GL views.
 * Computes GL-level CTCs dynamically from consolidated data.
 */

require('dotenv').config();

const express = require('express');
const fs = require('fs');
const path = require('path');
const dataLoader = require('./data-loader-v2');
const llm = require('./llm');

const app = express();

// CORS for dashboard
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});
app.use(express.json());

// Load static prompts
const SYSTEM_PROMPT = fs.readFileSync(path.join(__dirname, 'SYSTEM_PROMPT.md'), 'utf-8');
const ANALYSIS_FRAMEWORK = fs.readFileSync(path.join(__dirname, 'ANALYSIS_FRAMEWORK.md'), 'utf-8');

// Session storage (in-memory)
const sessions = new Map();

// ============================================================================
// Analysis Session
// ============================================================================

class AnalysisSession {
  constructor(sessionId) {
    this.sessionId = sessionId;
    this.currentGL = null;
    this.currentWeek = null;
    this.conversationHistory = [];
    this.maxHistoryTurns = 5;
  }

  /**
   * Detect GL from question using mapping-based GL list.
   */
  detectGL(question) {
    const q = question.toLowerCase();

    // Build GL patterns from mapping (dynamic, not hardcoded)
    const mapping = dataLoader.getMapping();
    const glList = mapping.glList; // e.g., ['Apparel', 'Automotive', ..., 'PC', ...]

    // TIER 1: Explicit GL name mentions
    for (const gl of glList) {
      const glLower = gl.toLowerCase();
      // Match "PC", "PC GL", "the PC business", etc.
      const pattern = new RegExp(`\\b${glLower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*(?:gl|business|category)?\\b`, 'i');
      if (pattern.test(question)) return gl;
    }

    // TIER 1b: Common aliases (word-boundary matching to avoid false hits)
    const aliases = [
      [/\bce\b/, 'Electronics'],
      [/\bconsumer\s*electronics\b/, 'Electronics'],
      [/\bhi\b(?=\s+(gl|business|category))/, 'Home Improvement'], // "hi" only with context
      [/\bhome\s*improvement\b/, 'Home Improvement'],
      [/\blawn\s*(?:&|and)\s*garden\b/, 'Lawn and Garden'],
      [/\bmajap\b/, 'Major Appliances'],
      [/\bmajor\s*appliances?\b/, 'Major Appliances'],
      [/\bmi\b(?=\s+(gl|business|category))/, 'Musical Instruments'], // "mi" only with context
      [/\bmusical\s*instruments?\b/, 'Musical Instruments'],
      [/\boffice\s*products?\b/, 'Office Products'],
      [/\bpets?\b/, 'Pet Products'],
      [/\bpet\s*products?\b/, 'Pet Products'],
      [/\bbiss\b/, 'Biss'],
    ];
    for (const [pattern, gl] of aliases) {
      if (pattern.test(q)) return gl;
    }

    // TIER 2: Product keywords → GL (unambiguous only)
    const productMap = {
      'PC': /\b(laptops?|monitors?|keyboards?|mice|mous(?:e|es)|memory\s*cards?|usb\s*drives?|sdxc|microsd|flash\s*memory|ssds?|hard\s*drives?)\b/i,
      'Toys': /\b(legos?|puzzles?|action\s*figures?|toy\s*cars?|dolls?|board\s*games?)\b/i,
      'Electronics': /\b(tvs?|televisions?|headphones?|earbuds?|soundbars?|bluetooth\s*speakers?)\b/i,
      'Kitchen': /\b(cookware|bakeware|kitchen\s*appli|blenders?|mixers?)\b/i,
      'Sports': /\b(fitness|exercise|yoga|dumbbells?|treadmills?)\b/i,
      'Wireless': /\b(cell\s*phones?|mobile\s*cases?|phone\s*chargers?|sim\s*cards?)\b/i,
      'Camera': /\b(camera\s*lens(?:es)?|tripods?|dslrs?|mirrorless)\b/i,
    };
    for (const [gl, pattern] of Object.entries(productMap)) {
      if (pattern.test(question)) return gl;
    }

    return null;
  }

  isMultiGLQuestion(question) {
    return /compare.*(?:and|vs|versus|to)|across\s+(?:all\s+)?gl|all\s+gl|summary\s+(?:of\s+)?(?:the\s+)?week|overall|total|aggregate|how\s+(?:did|does)\s+(?:the\s+)?week\s+look|portfolio/i.test(question);
  }

  detectQuestionMetrics(q) {
    const metrics = new Set();
    if (/net\s*ppm|margin|profitab|npm|netppm/i.test(q)) metrics.add('NetPPMLessSD');
    if (/\bcm\b|contribution\s*margin/i.test(q)) metrics.add('CM');
    if (/gms|revenue|sales|topline/i.test(q)) metrics.add('GMS');
    if (/unit|volume/i.test(q)) metrics.add('ShippedUnits');
    if (/asp|price|average\s*sell/i.test(q)) metrics.add('ASP');
    if (/oos|out\s*of\s*stock|availability|soroos|roos/i.test(q)) metrics.add('SOROOS_PROCURABLE_PRODUCT_OOS_GV_PCT');
    if (/traffic|gv|glance|views/i.test(q)) metrics.add('GV');
    if (metrics.size === 0) metrics.add('GMS');
    return Array.from(metrics);
  }

  determineDataNeeds(question) {
    const q = question.toLowerCase();
    const needsAsin = /asin|product|sku|item|deep\s*dive|drill|specific\s+product/.test(q)
      || /(?:single|top|biggest|largest|highest|worst|best|#1)\b.*\b(?:asin|product|item|driver|decliner|degrader|gainer|contributor|mover|detractor|improver|grower)/.test(q)
      || /(?:which|what)\b.*\b(?:asin|product|item)\b.*\b(?:driv|caus|declin|degrad|increas|drop|grow|hurt|help|impact)/.test(q)
      || /(?:largest|biggest|top|worst|single)\b.*\b(?:declin|degrad|drop|increas|improv|grow|hurt|drag|impact)/.test(q)
      || /(?:drill|deep\s*dive|break\s*down|decompos)/.test(q);

    return {
      allSubcats: true,
      asin: needsAsin,
      asinMetrics: this.detectQuestionMetrics(q),
    };
  }

  /**
   * Build context using v2 data loader.
   */
  buildContext(week, gl, question, dataNeeds) {
    let dataContext = '';
    const isAll = gl.toUpperCase() === 'ALL';

    // Metric totals
    const totals = dataLoader.getMetricTotals(week, gl);
    if (totals.metrics && totals.metrics.length > 0) {
      dataContext += `## ${gl.toUpperCase()} Metric Totals (Week ${week.split('-wk')[1]})\n\n`;
      dataContext += `| Metric | Value | WoW | YoY |\n|--------|-------|-----|-----|\n`;
      for (const m of totals.metrics) {
        const wowStr = m.wowUnit === 'bps' ? `${m.wow} bps` : `${m.wow}%`;
        const yoyStr = m.yoyUnit === 'bps' ? `${m.yoy} bps` : `${m.yoy}%`;
        dataContext += `| ${m.label} | ${m.value} | ${wowStr} | ${yoyStr} |\n`;
      }
      dataContext += '\n';
    }

    // Subcategory drivers — load all metrics
    if (dataNeeds.allSubcats) {
      const metrics = ['GMS', 'ShippedUnits', 'ASP', 'NetPPMLessSD', 'CM', 'SOROOS_PROCURABLE_PRODUCT_OOS_GV_PCT', 'GV'];

      for (const metric of metrics) {
        const result = dataLoader.getMetricDrivers(week, gl, metric, { limit: 50, direction: 'both' });
        if (!result.drivers || result.drivers.length === 0) continue;

        const metricLabel = {
          'GMS': 'GMS', 'ShippedUnits': 'Shipped Units', 'ASP': 'ASP',
          'NetPPMLessSD': 'Net PPM', 'CM': 'Contribution Margin',
          'SOROOS_PROCURABLE_PRODUCT_OOS_GV_PCT': 'OOS GV%', 'GV': 'Glance Views',
        }[metric] || metric;

        const isASP = metric === 'ASP';
        const ctcUnit = isASP ? '($)' : '(bps)';

        dataContext += `\n### ${metricLabel} Subcategory Drivers`;
        if (result.total) {
          dataContext += ` (Total: ${result.total.value})`;
        }
        dataContext += '\n';
        dataContext += `**Key:** "YoY Δ" = subcategory's own change. "YoY CTC" = contribution to GL total. Rank by CTC.\n\n`;

        if (result.drivers[0]?.mix !== undefined) {
          dataContext += `| Subcategory | Value | YoY Δ | CTC ${ctcUnit} | Mix ${ctcUnit} | Rate ${ctcUnit} |\n`;
          dataContext += `|-------------|-------|-------|------|-----|------|\n`;
          for (const d of result.drivers) {
            dataContext += `| ${d.subcat_name} | ${fmtVal(d.value, metric)} | ${fmtDelta(d.yoy_pct, metric)} | ${d.ctc ?? '-'} | ${d.mix ?? '-'} | ${d.rate ?? '-'} |\n`;
          }
        } else {
          dataContext += `| Subcategory | Value | YoY Δ | CTC ${ctcUnit} |\n`;
          dataContext += `|-------------|-------|-------|------|\n`;
          for (const d of result.drivers) {
            dataContext += `| ${d.subcat_name} | ${fmtVal(d.value, metric)} | ${fmtDelta(d.yoy_pct, metric)} | ${d.ctc ?? '-'} |\n`;
          }
        }
        dataContext += '\n';
      }
    }

    // ASIN detail
    if (dataNeeds.asin) {
      const metricsToLoad = dataNeeds.asinMetrics || ['GMS'];
      for (const metric of metricsToLoad) {
        const asinData = dataLoader.getAsinDetail(week, gl, metric, { limit: 25 });
        if (!asinData.asins || asinData.asins.length === 0) {
          if (asinData.error) dataContext += `\n### ASIN ${metric}: NOT AVAILABLE (${asinData.error})\n`;
          continue;
        }

        const metricLabel = {
          'GMS': 'GMS', 'ShippedUnits': 'Shipped Units', 'ASP': 'ASP',
          'NetPPMLessSD': 'Net PPM', 'CM': 'CM', 'GV': 'Glance Views',
        }[metric] || metric;

        const isASP = metric === 'ASP';
        const ctcUnit = isASP ? '($)' : '(bps)';
        dataContext += `\n### Top ASINs by ${metricLabel} YoY CTC\n`;
        dataContext += `**Note:** ASINs ranked GL-wide. "YoY Δ" = ASIN's own change. "YoY CTC" = contribution to total.\n\n`;
        dataContext += `| ASIN | Product | Value | YoY Δ | CTC ${ctcUnit} |\n|------|---------|-------|-------|------|\n`;
        for (const a of asinData.asins) {
          dataContext += `| ${a.asin} | ${(a.item_name || '').substring(0, 60)} | ${fmtVal(a.value, metric)} | ${fmtDelta(a.yoy_delta, metric)} | ${a.ctc ?? '-'} |\n`;
        }
        dataContext += '\n';
      }
    }

    return dataContext;
  }

  async handleQuery(question, week, requestedGL) {
    if (!week) {
      week = dataLoader.listWeeks().weeks[0] || '2026-wk06';
    }

    // GL resolution
    let gl = requestedGL || this.detectGL(question) || this.currentGL;

    if (!gl) {
      return {
        response: "Which GL would you like me to analyze? Select one from the sidebar, or mention it in your question.",
        gl: null, week,
      };
    }

    // Check GL change
    if (gl !== this.currentGL) {
      this.currentGL = gl;
      this.currentWeek = week;
      this.conversationHistory = [];
    }

    const dataNeeds = this.determineDataNeeds(question);
    const dataContext = this.buildContext(week, gl, question, dataNeeds);

    const messages = [
      ...this.conversationHistory,
      { role: 'user', content: question },
    ];
    const systemPrompt = `${SYSTEM_PROMPT}\n\n${ANALYSIS_FRAMEWORK}\n\n---\n\n# Current Data\n${dataContext}`;
    const assistantMessage = await llm.chat(systemPrompt, messages);

    this.conversationHistory.push({ role: 'user', content: question });
    this.conversationHistory.push({ role: 'assistant', content: assistantMessage });
    if (this.conversationHistory.length > this.maxHistoryTurns * 2) {
      this.conversationHistory = this.conversationHistory.slice(-this.maxHistoryTurns * 2);
    }

    return { response: assistantMessage, gl, week };
  }
}

// ============================================================================
// Helpers
// ============================================================================

function fmtVal(v, metric) {
  if (v === null || v === undefined || !isFinite(v)) return '-';
  if (['NetPPMLessSD', 'CM', 'SOROOS_PROCURABLE_PRODUCT_OOS_GV_PCT'].includes(metric)) {
    return `${(v * 100).toFixed(1)}%`;
  }
  if (metric === 'ASP') return `$${v.toFixed(2)}`;
  if (metric === 'GMS') return `$${Math.round(v).toLocaleString()}`;
  if (metric === 'ShippedUnits' || metric === 'GV') return Math.round(v).toLocaleString();
  return String(v);
}

function fmtDelta(v, metric) {
  if (v === null || v === undefined || !isFinite(v)) return '-';
  if (['NetPPMLessSD', 'CM', 'SOROOS_PROCURABLE_PRODUCT_OOS_GV_PCT'].includes(metric)) {
    return `${Math.round(v)} bps`;
  }
  if (metric === 'ASP') return `${(v * 100).toFixed(1)}%`;
  return `${(v * 100).toFixed(1)}%`;
}

function getSession(sessionId) {
  if (!sessions.has(sessionId)) sessions.set(sessionId, new AnalysisSession(sessionId));
  return sessions.get(sessionId);
}

// ============================================================================
// API Routes
// ============================================================================

// --- Data APIs ---

app.get('/api/weeks', (req, res) => {
  res.json(dataLoader.listWeeks());
});

app.get('/api/gls/:week', (req, res) => {
  res.json(dataLoader.listGLs(req.params.week));
});

app.get('/api/metrics/:week/:gl', (req, res) => {
  res.json(dataLoader.getMetricTotals(req.params.week, req.params.gl));
});

/**
 * Trends — metric values across all available weeks for a GL.
 * Returns per-metric arrays of {week, value, wow, yoy} for sparklines and charts.
 */
app.get('/api/trends/:gl', (req, res) => {
  const { gl } = req.params;
  const { weeks } = dataLoader.listWeeks();
  
  // Go oldest → newest
  const orderedWeeks = [...weeks].reverse();
  
  const metricKeys = ['GMS', 'ShippedUnits', 'ASP', 'NetPPMLessSD', 'CM'];
  const trends = {};
  
  for (const key of metricKeys) {
    trends[key.toLowerCase()] = [];
  }
  
  for (const week of orderedWeeks) {
    const totals = dataLoader.getMetricTotals(week, gl);
    if (!totals.metrics) continue;
    
    for (const m of totals.metrics) {
      const key = m.name;
      if (trends[key]) {
        trends[key].push({
          week,
          value: m.value,
          rawValue: m.sparkline?.[m.sparkline.length - 1] ?? null,
          wow: m.wow,
          wowUnit: m.wowUnit,
          yoy: m.yoy,
          yoyUnit: m.yoyUnit,
        });
      }
    }
  }
  
  // Compute WoW from actual cross-week values
  for (const key of Object.keys(trends)) {
    const series = trends[key];
    for (let i = 1; i < series.length; i++) {
      const curr = series[i].rawValue;
      const prev = series[i - 1].rawValue;
      if (curr != null && prev != null && prev !== 0) {
        series[i].computedWow = parseFloat(((curr - prev) / prev * 100).toFixed(2));
      }
    }
  }
  
  res.json({ gl, weeks: orderedWeeks, trends });
});

/**
 * Top movers — subcats with highest absolute CTC for a metric.
 */
app.get('/api/movers/:week/:gl', (req, res) => {
  const { week, gl } = req.params;
  const metric = req.query.metric || 'GMS';
  const limit = parseInt(req.query.limit) || 5;

  const result = dataLoader.getMetricDrivers(week, gl, metric, { limit, direction: 'both' });
  if (result.error) return res.json({ movers: [], error: result.error });

  const movers = (result.drivers || []).map(d => ({
    name: d.subcat_name,
    code: d.subcat_code,
    ctc: d.ctc,
    direction: d.ctc >= 0 ? 'up' : 'down',
    metric,
  }));

  res.json({ movers, metric, week, gl });
});

/**
 * Alerts — significant metric movements worth highlighting.
 */
app.get('/api/alerts/:week/:gl', (req, res) => {
  const { week, gl } = req.params;
  const alerts = [];

  // Check key metrics for significant movements
  const checks = [
    { metric: 'GMS', threshold: 500, label: 'GMS' },
    { metric: 'NetPPMLessSD', threshold: 200, label: 'Net PPM' },
    { metric: 'CM', threshold: 200, label: 'CM' },
  ];

  for (const check of checks) {
    const result = dataLoader.getMetricDrivers(week, gl, check.metric, { limit: 3, direction: 'both' });
    if (!result.drivers) continue;

    for (const d of result.drivers) {
      if (Math.abs(d.ctc) >= check.threshold) {
        const sign = d.ctc > 0 ? '+' : '';
        alerts.push({
          severity: Math.abs(d.ctc) >= check.threshold * 2 ? 'high' : 'medium',
          message: `${d.subcat_name}: ${check.label} CTC ${sign}${d.ctc} bps YoY`,
          metric: check.metric,
          subcat: d.subcat_code,
        });
      }
    }
  }

  // Sort by severity then absolute impact
  alerts.sort((a, b) => {
    if (a.severity !== b.severity) return a.severity === 'high' ? -1 : 1;
    return 0;
  });

  res.json({ alerts: alerts.slice(0, 8), week, gl });
});

/**
 * Data freshness — when was data last updated.
 */
app.get('/api/freshness/:week', (req, res) => {
  const { week } = req.params;
  const allFolder = dataLoader.getAllFolder(week);
  if (!allFolder) return res.json({ fresh: false, error: 'No data folder' });

  // Check file modification times
  const files = fs.readdirSync(allFolder);
  let latestMtime = 0;
  for (const f of files) {
    const stat = fs.statSync(path.join(allFolder, f));
    if (stat.mtimeMs > latestMtime) latestMtime = stat.mtimeMs;
  }

  const updatedAt = new Date(latestMtime);
  const ageMinutes = (Date.now() - latestMtime) / 60000;

  res.json({
    fresh: true,
    updatedAt: updatedAt.toISOString(),
    ageMinutes: Math.round(ageMinutes),
    label: ageMinutes < 60 ? `Updated ${Math.round(ageMinutes)}m ago`
      : ageMinutes < 1440 ? `Updated ${Math.round(ageMinutes / 60)}h ago`
      : `Updated ${Math.round(ageMinutes / 1440)}d ago`,
    week,
  });
});

// --- Session APIs ---

app.get('/api/session/:sessionId', (req, res) => {
  const session = sessions.get(req.params.sessionId);
  if (!session) return res.json({ currentGL: null, currentWeek: null, historyLength: 0 });
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

/**
 * Export session as markdown.
 */
app.get('/api/session/:sessionId/export', (req, res) => {
  const session = sessions.get(req.params.sessionId);
  if (!session || session.conversationHistory.length === 0) {
    return res.status(404).json({ error: 'No session data to export' });
  }
  
  const { format = 'markdown' } = req.query;
  const gl = session.currentGL || 'Unknown';
  const week = session.currentWeek || 'Unknown';
  const now = new Date().toISOString().split('T')[0];
  
  let output = `# WBR Analysis — ${gl} / ${week}\n`;
  output += `*Generated ${now}*\n\n---\n\n`;
  
  for (const msg of session.conversationHistory) {
    if (msg.role === 'user') {
      output += `## Q: ${msg.content}\n\n`;
    } else {
      output += `${msg.content}\n\n---\n\n`;
    }
  }
  
  if (format === 'download') {
    const filename = `wbr-${gl.toLowerCase()}-${week}-${now}.md`;
    res.setHeader('Content-Type', 'text/markdown');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return res.send(output);
  }
  
  res.json({ markdown: output, gl, week, messageCount: session.conversationHistory.length });
});

/**
 * Generate WBR bridge summary — uses LLM to synthesize key findings.
 */
app.post('/api/session/:sessionId/bridge', async (req, res) => {
  const session = sessions.get(req.params.sessionId);
  if (!session || session.conversationHistory.length === 0) {
    return res.status(404).json({ error: 'No analysis to summarize' });
  }
  
  try {
    const gl = session.currentGL || 'Unknown';
    const week = session.currentWeek || 'Unknown';
    
    // Build a summary prompt from the conversation
    const conversationText = session.conversationHistory
      .map(m => `${m.role === 'user' ? 'Question' : 'Analysis'}: ${m.content}`)
      .join('\n\n');
    
    const bridgePrompt = `You are a senior business analyst. Based on the following WBR analysis conversation for ${gl} (${week}), generate a concise executive WBR bridge document.

Format:
1. **Executive Summary** (2-3 sentences max)
2. **Key Metrics** (table: Metric | Value | YoY | Driver)
3. **Top 3 Callouts** (most important findings, ranked by business impact)
4. **Risks & Watch Items** (if any emerged from the analysis)
5. **Recommended Actions** (if the analysis suggests any)

Be data-driven. Use exact numbers from the conversation. No hedging.

---

${conversationText}`;
    
    const bridge = await llm.chat(bridgePrompt, [{ role: 'user', content: 'Generate the WBR bridge document.' }]);
    
    res.json({
      bridge,
      gl,
      week,
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Bridge generation error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Save session to disk.
 */
app.post('/api/session/:sessionId/save', (req, res) => {
  const session = sessions.get(req.params.sessionId);
  if (!session) return res.status(404).json({ error: 'Session not found' });
  
  const sessionsDir = path.join(__dirname, '..', 'data', 'sessions');
  if (!fs.existsSync(sessionsDir)) fs.mkdirSync(sessionsDir, { recursive: true });
  
  const sessionData = {
    sessionId: req.params.sessionId,
    gl: session.currentGL,
    week: session.currentWeek,
    history: session.conversationHistory,
    savedAt: new Date().toISOString(),
  };
  
  const filename = `${req.params.sessionId}.json`;
  fs.writeFileSync(path.join(sessionsDir, filename), JSON.stringify(sessionData, null, 2));
  
  res.json({ saved: true, path: `data/sessions/${filename}` });
});

/**
 * Load session from disk.
 */
app.post('/api/session/:sessionId/load', (req, res) => {
  const sessionsDir = path.join(__dirname, '..', 'data', 'sessions');
  const filepath = path.join(sessionsDir, `${req.params.sessionId}.json`);
  
  if (!fs.existsSync(filepath)) return res.status(404).json({ error: 'Saved session not found' });
  
  try {
    const data = JSON.parse(fs.readFileSync(filepath, 'utf-8'));
    const session = getSession(req.params.sessionId);
    session.currentGL = data.gl;
    session.currentWeek = data.week;
    session.conversationHistory = data.history || [];
    
    res.json({
      loaded: true,
      gl: data.gl,
      week: data.week,
      messageCount: data.history?.length || 0,
      savedAt: data.savedAt,
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to load session' });
  }
});

/**
 * List saved sessions.
 */
app.get('/api/sessions/saved', (req, res) => {
  const sessionsDir = path.join(__dirname, '..', 'data', 'sessions');
  if (!fs.existsSync(sessionsDir)) return res.json({ sessions: [] });
  
  const files = fs.readdirSync(sessionsDir).filter(f => f.endsWith('.json'));
  const sessionList = files.map(f => {
    try {
      const data = JSON.parse(fs.readFileSync(path.join(sessionsDir, f), 'utf-8'));
      return {
        sessionId: data.sessionId,
        gl: data.gl,
        week: data.week,
        messageCount: data.history?.length || 0,
        savedAt: data.savedAt,
      };
    } catch {
      return null;
    }
  }).filter(Boolean);
  
  res.json({ sessions: sessionList });
});

// --- Query APIs ---

app.post('/api/ask', async (req, res) => {
  try {
    const { question, week, gl, sessionId = 'default' } = req.body;
    if (!question) return res.status(400).json({ error: 'Question is required' });
    const session = getSession(sessionId);
    const result = await session.handleQuery(question, week, gl);
    res.json(result);
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Reformat prompt — used for two-pass style formatting.
// Aggressive about data preservation since accuracy is #1.
const REFORMAT_SYSTEM = `You are a formatting assistant. Your ONLY job is to restructure and restyle the analysis below to match the user's preferred format.

ABSOLUTE RULES:
- Preserve EVERY number, metric, bps value, dollar amount, percentage, and ASIN exactly as-is
- Preserve ALL conclusions and findings — do not add, remove, or reinterpret
- Do not add hedging language ("approximately", "roughly") — if the original says a number, keep it exact
- Do not add new analysis or opinions
- Only change: structure, bullet style, headers, tone, sentence phrasing, ordering
- If the format example uses tables, convert to tables. If it uses bullets, convert to bullets.
- If a data point exists in the original, it MUST appear in your output`;

app.post('/api/ask/stream', async (req, res) => {
  try {
    const { question, week, gl: requestedGL, formatTemplate, sessionId = 'default' } = req.body;
    if (!question) return res.status(400).json({ error: 'Question is required' });

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const session = getSession(sessionId);
    const activeWeek = week || session.currentWeek || dataLoader.listWeeks().weeks[0];

    // GL resolution: sidebar > question keyword > session
    const questionGL = session.detectGL(question);
    let gl;
    if (requestedGL) {
      gl = requestedGL;
      if (questionGL && questionGL !== requestedGL) {
        const warning = `**Note:** Viewing **${requestedGL}** data, but question mentions **${questionGL}**. Switch GLs in sidebar if needed.\n\n`;
        res.write(`data: ${JSON.stringify({ type: 'content', text: warning })}\n\n`);
      }
    } else if (session.isMultiGLQuestion(question)) {
      gl = 'ALL';
    } else {
      gl = questionGL || session.currentGL;
    }

    if (!gl) {
      res.write(`data: ${JSON.stringify({ type: 'content', text: "Which GL would you like to analyze? Select one from the sidebar." })}\n\n`);
      res.write(`data: ${JSON.stringify({ type: 'done', gl: null, week: activeWeek })}\n\n`);
      return res.end();
    }

    // Switch GL if changed
    if (gl !== session.currentGL) {
      session.currentGL = gl;
      session.currentWeek = activeWeek;
      session.conversationHistory = [];
    }

    const dataNeeds = session.determineDataNeeds(question);
    const dataContext = session.buildContext(activeWeek, gl, question, dataNeeds);
    const messages = [...session.conversationHistory, { role: 'user', content: question }];
    const systemPrompt = `${SYSTEM_PROMPT}\n\n${ANALYSIS_FRAMEWORK}\n\n---\n\n# Current Data\n${dataContext}`;

    // === PASS 1: Analysis ===
    let fullResponse = '';
    const hasFormat = formatTemplate && formatTemplate.trim().length > 0;
    
    if (hasFormat) {
      // Don't stream pass 1 to user — collect it silently
      res.write(`data: ${JSON.stringify({ type: 'status', text: 'Analyzing...' })}\n\n`);
      try {
        fullResponse = await llm.chat(systemPrompt, messages);
      } catch (err) {
        console.error('Pass 1 error:', err);
        res.write(`data: ${JSON.stringify({ type: 'error', error: err.message })}\n\n`);
        return res.end();
      }
      
      // === PASS 2: Reformat ===
      res.write(`data: ${JSON.stringify({ type: 'status', text: 'Formatting...' })}\n\n`);
      
      const reformatMessages = [{
        role: 'user',
        content: `Here is the analysis to reformat:\n\n---\n${fullResponse}\n---\n\nRewrite it to match this format/style:\n\n---\n${formatTemplate.trim()}\n---`,
      }];
      
      let reformattedResponse = '';
      try {
        for await (const chunk of llm.chatStream(REFORMAT_SYSTEM, reformatMessages)) {
          reformattedResponse += chunk;
          res.write(`data: ${JSON.stringify({ type: 'content', text: chunk })}\n\n`);
        }
      } catch (streamError) {
        console.error('Pass 2 stream error:', streamError);
        // Fallback: send the original unformatted analysis
        res.write(`data: ${JSON.stringify({ type: 'content', text: '\n\n---\n*Format pass failed. Showing original analysis:*\n\n' + fullResponse })}\n\n`);
        reformattedResponse = fullResponse;
      }
      
      // Store the reformatted version in history
      fullResponse = reformattedResponse;
    } else {
      // No format template — stream directly (single pass)
      try {
        for await (const chunk of llm.chatStream(systemPrompt, messages)) {
          fullResponse += chunk;
          res.write(`data: ${JSON.stringify({ type: 'content', text: chunk })}\n\n`);
        }
      } catch (streamError) {
        console.error('Stream error:', streamError);
        res.write(`data: ${JSON.stringify({ type: 'error', error: streamError.message })}\n\n`);
      }
    }

    session.conversationHistory.push({ role: 'user', content: question });
    session.conversationHistory.push({ role: 'assistant', content: fullResponse });
    if (session.conversationHistory.length > session.maxHistoryTurns * 2) {
      session.conversationHistory = session.conversationHistory.slice(-session.maxHistoryTurns * 2);
    }

    res.write(`data: ${JSON.stringify({ type: 'done', gl, week: activeWeek })}\n\n`);
    res.end();
  } catch (error) {
    console.error('Stream error:', error);
    res.write(`data: ${JSON.stringify({ type: 'error', error: error.message })}\n\n`);
    res.end();
  }
});

// --- Config APIs ---

app.get('/api/config', (req, res) => {
  try {
    res.json({ config: llm.getConfig(), providers: llm.listProviders() });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/providers', (req, res) => res.json(llm.listProviders()));

app.post('/api/config/validate', (req, res) => {
  try {
    llm.validateCredentials();
    res.json({ valid: true, config: llm.getConfig() });
  } catch (error) {
    res.json({ valid: false, error: error.message });
  }
});

// Start server
const PORT = process.env.PORT || 3456;
app.listen(PORT, () => {
  console.log(`Leadership Autopilot v2 server on http://localhost:${PORT}`);
  console.log('  POST /api/ask/stream   - Streaming chat');
  console.log('  GET  /api/weeks        - List weeks');
  console.log('  GET  /api/gls/:week    - List GLs (from mapping)');
  console.log('  GET  /api/metrics/:w/:gl - Metric totals');
  console.log('  GET  /api/movers/:w/:gl  - Top movers');
  console.log('  GET  /api/alerts/:w/:gl  - Alerts');
  console.log('  GET  /api/freshness/:w   - Data freshness');
});

module.exports = { app, AnalysisSession };
