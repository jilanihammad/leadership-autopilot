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

// Enable CORS for dashboard (runs on different port)
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

app.use(express.json());
// Note: Static UI moved to /dashboard (Next.js app on port 3000)

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
   * Detect GL from question.
   * Uses explicit GL name matches first, then product-keyword fallback.
   * Only returns a GL if confidence is reasonable — avoids false matches
   * on ambiguous words like "speaker" or "charger" that span multiple GLs.
   */
  detectGL(question) {
    const q = question.toLowerCase();
    
    // TIER 1: Explicit GL name mentions (high confidence)
    // These are unambiguous — if someone says "PC GL" or "the toys business", we know.
    const explicitPatterns = {
      'pc': /\b(pc\s*(gl|business|category)?|pc\b)/i,
      'toys': /\b(toys?\s*(gl|business|category)?)\b/i,
      'office': /\b(office\s*(gl|business|category|supplies)?)\b/i,
      'home': /\b(home\s*(gl|business|category)?)\b/i,
      'pets': /\b(pets?\s*(gl|business|category)?)\b/i,
      'ce': /\b(consumer\s*electronics|ce\s*(gl|business|category)?)\b/i,
      'wireless': /\b(wireless\s*(gl|business|category)?)\b/i,
      'camera': /\b(camera\s*(gl|business|category)?)\b/i,
      'garden': /\b(garden\s*(gl|business|category)?)\b/i,
      'sports': /\b(sports?\s*(gl|business|category)?)\b/i,
    };
    
    for (const [gl, pattern] of Object.entries(explicitPatterns)) {
      if (pattern.test(question)) {
        return gl;
      }
    }
    
    // TIER 2: Product-keyword detection (lower confidence)
    // Only use unambiguous product keywords — skip words that appear in multiple GLs
    // (e.g., "speaker" could be PC USB speakers or CE audio speakers)
    const productPatterns = {
      'pc': /\b(laptops?|monitors?|keyboards?|mice|mous(?:e|es)|memory\s*cards?|usb\s*drives?|sdxc|microsd|flash\s*memory|ssds?|hard\s*drives?|computer\s*accessor(?:y|ies))\b/i,
      'toys': /\b(legos?|puzzles?|action\s*figures?|toy\s*cars?|dolls?|board\s*games?)\b/i,
      'office': /\b(paper|printer\s*ink|toners?|stationery|binders?|folders?)\b/i,
      'home': /\b(kitchen|furniture|cookware|mattress(?:es)?|bedding|vacuums?)\b/i,
      'pets': /\b(dog\s*food|cat\s*food|pet\s*toys?|leash(?:es)?|aquariums?|pet\s*beds?)\b/i,
      'ce': /\b(tvs?|televisions?|headphones?|earbuds?|soundbars?|bluetooth\s*speakers?|home\s*theat(?:er|re)s?)\b/i,
      'wireless': /\b(cell\s*phones?|mobile\s*cases?|phone\s*chargers?|cellular|sim\s*cards?)\b/i,
      'camera': /\b(camera\s*lens(?:es)?|tripods?|dslrs?|mirrorless|camera\s*bags?|photo\s*printers?)\b/i,
      'garden': /\b(lawn\s*mowers?|garden\s*hoses?|patios?|planters?|outdoor\s*furniture)\b/i,
      'sports': /\b(fitness|exercise|yoga|dumbbells?|treadmills?|sports\s*equipment)\b/i,
    };
    
    for (const [gl, pattern] of Object.entries(productPatterns)) {
      if (pattern.test(question)) {
        return gl;
      }
    }
    
    // TIER 3: Ambiguous keywords — only match if nothing else did and we need a guess
    // These words appear in multiple GLs. We map them to the most common GL
    // but this is low-confidence. The sidebar GL should override these.
    const ambiguousPatterns = {
      'pc': /\b(cables?|usb|chargers?|speakers?|adapters?|hubs?|dongles?)\b/i,
    };
    
    for (const [gl, pattern] of Object.entries(ambiguousPatterns)) {
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
    
    // Detect if question needs ASIN-level data
    const needsAsin = /asin|product|sku|item|deep\s*dive|drill|specific\s+product/.test(q)
      || /(?:single|top|biggest|largest|highest|worst|best|#1|number\s*one)\b.*\b(?:asin|product|item|driver|decliner|degrader|gainer|contributor|mover|detractor|improver|grower)/.test(q)
      || /(?:which|what)\b.*\b(?:asin|product|item)\b.*\b(?:driv|caus|declin|degrad|increas|drop|grow|hurt|help|impact)/.test(q)
      || /(?:largest|biggest|top|worst|single)\b.*\b(?:declin|degrad|drop|increas|improv|grow|hurt|drag|impact)/.test(q)
      || /(?:drill|deep\s*dive|break\s*down|decompos)/.test(q)
      || /(?:net\s*ppm|margin|gms|revenue|asp|price)\b.*\b(?:declin|drop|compress|increas|grew|growth)/.test(q)
      || /(?:declin|drop|compress|increas|grew|growth)\b.*\b(?:net\s*ppm|margin|gms|revenue|asp|price)/.test(q);

    // Detect which metric the question is about (for ASIN loading)
    const asinMetrics = this.detectQuestionMetrics(q);

    // Always load both GMS and Net PPM at ASIN level — these are the two
    // most important Business Review metrics and cover 90%+ of analytical questions
    if (needsAsin) {
      if (!asinMetrics.includes('GMS')) asinMetrics.push('GMS');
      if (!asinMetrics.includes('NetPPMLessSD')) asinMetrics.push('NetPPMLessSD');
    }

    return {
      // Always load these
      summary: true,
      allSubcats: true,

      // Optional extras based on question
      traffic: /traffic|gv|glance|views|visit|channel/.test(q),
      asin: needsAsin,
      asinMetrics: asinMetrics,  // Which metrics to load at ASIN level
    };
  }

  /**
   * Detect which metrics the question is asking about
   * Returns array of metric keys to load at ASIN level
   */
  detectQuestionMetrics(q) {
    const metrics = new Set();
    
    if (/net\s*ppm|margin|profitab|npm|netppm/i.test(q)) {
      metrics.add('NetPPMLessSD');
    }
    if (/\bcm\b|contribution\s*margin/i.test(q)) {
      metrics.add('CM');
    }
    if (/gms|revenue|sales|topline/i.test(q)) {
      metrics.add('GMS');
    }
    if (/unit|volume/i.test(q)) {
      metrics.add('ShippedUnits');
    }
    if (/asp|price|average\s*sell/i.test(q)) {
      metrics.add('ASP');
    }
    if (/oos|out\s*of\s*stock|availability|soroos|roos/i.test(q)) {
      metrics.add('SOROOS_PROCURABLE_PRODUCT_OOS_GV_PCT');
    }
    
    // Default to GMS if no specific metric detected
    if (metrics.size === 0) {
      metrics.add('GMS');
    }
    
    return Array.from(metrics);
  }

  /**
   * Build context for LLM - now always includes all subcat data
   */
  buildContext(week, gl, question, dataNeeds) {
    let dataContext = '';

    // FIRST: Include data availability status
    const availabilityResult = tools.getDataAvailability(week, gl);
    if (availabilityResult.summary) {
      dataContext += availabilityResult.summary;
      dataContext += '\n\n---\n\n';
    }

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
        
        // Build comprehensive table with all metrics + per-metric CTC
        // IMPORTANT: Column labels must clearly distinguish:
        //   "YoY Δ" = this subcat's own rate change (how much ITS rate moved)
        //   "YoY CTC" = contribution to change (how much it moved the GL TOTAL)
        dataContext += `\n**Key:** "YoY Δ" = this subcategory's own rate change. "YoY CTC" = its weighted contribution to the GL-level total change. Rank drivers by CTC, not by Δ.\n\n`;
        dataContext += `| Subcategory | GMS | GMS YoY Δ | GMS CTC(bps) | Units | Units YoY Δ | Units CTC(bps) | ASP | ASP YoY Δ | ASP CTC($) | Net PPM | Net PPM YoY Δ(bps) | Net PPM CTC(bps) | CM | CM YoY Δ(bps) | CM CTC(bps) | OOS GV% | OOS YoY Δ(bps) | OOS CTC(bps) |\n`;
        dataContext += `|-------------|-----|-----------|-------------|-------|------------|---------------|-----|-----------|------------|---------|--------------------|------------------|-----|---------------|------------|---------|----------------|---------------|\n`;
        
        allData.subcats.forEach(s => {
          const gms = s.metrics.GMS || {};
          const units = s.metrics.ShippedUnits || {};
          const asp = s.metrics.ASP || {};
          const netPpm = s.metrics.NetPPMLessSD || {};
          const cm = s.metrics.CM || {};
          const oos = s.metrics.SOROOS_PROCURABLE_PRODUCT_OOS_GV_PCT || {};

          const hasNum = (v) => v !== null && v !== undefined && Number.isFinite(v);
          const fmtPct = (v) => hasNum(v) ? `${(v * 100).toFixed(1)}%` : '-';
          const fmtBpsFromDecimal = (v) => hasNum(v) ? Math.round(v * 10000) : '-';
          const fmtCurrency = (v) => hasNum(v) ? `$${Math.round(v).toLocaleString()}` : '-';
          const fmtCurrency2 = (v) => hasNum(v) ? `$${v.toFixed(2)}` : '-';
          const fmtNumber = (v) => hasNum(v) ? v.toLocaleString() : '-';
          const fmtRaw = (v) => hasNum(v) ? v : '-';

          // GMS / Units / ASP
          const gmsVal = fmtCurrency(gms.value);
          const gmsYoyDelta = fmtPct(gms.yoy_pct);
          const gmsCtc = fmtRaw(gms.yoy_ctc_bps);

          const unitsVal = fmtNumber(units.value);
          const unitsYoyDelta = fmtPct(units.yoy_pct);
          const unitsCtc = fmtRaw(units.yoy_ctc_bps);

          const aspVal = fmtCurrency2(asp.value);
          const aspYoyDelta = fmtPct(asp.yoy_pct);
          const aspCtc = fmtRaw(asp.yoy_ctc);

          // Net PPM / CM / OOS use bps deltas converted to decimal in tools
          const netPpmVal = fmtPct(netPpm.value);
          const netPpmYoyDelta = fmtBpsFromDecimal(netPpm.yoy_pct);
          const netPpmCtc = fmtRaw(netPpm.yoy_ctc_bps);

          const cmVal = fmtPct(cm.value);
          const cmYoyDelta = fmtBpsFromDecimal(cm.yoy_pct);
          const cmCtc = fmtRaw(cm.yoy_ctc_bps);

          const oosVal = fmtPct(oos.value);
          const oosYoyDelta = fmtBpsFromDecimal(oos.yoy_pct);
          const oosCtc = fmtRaw(oos.yoy_ctc_bps);
          
          dataContext += `| ${s.name} | ${gmsVal} | ${gmsYoyDelta} | ${gmsCtc} | ${unitsVal} | ${unitsYoyDelta} | ${unitsCtc} | ${aspVal} | ${aspYoyDelta} | ${aspCtc} | ${netPpmVal} | ${netPpmYoyDelta} | ${netPpmCtc} | ${cmVal} | ${cmYoyDelta} | ${cmCtc} | ${oosVal} | ${oosYoyDelta} | ${oosCtc} |\n`;
        });

        if (allData.parseErrors && allData.parseErrors.length > 0) {
          dataContext += `\n\n**Data parsing warnings:** ${allData.parseErrors.join('; ')}\n`;
        }
      }
    }

    // Optional: ASIN detail — load for each relevant metric
    if (dataNeeds.asin) {
      const metricsToLoad = dataNeeds.asinMetrics || ['GMS'];

      for (const metric of metricsToLoad) {
        const isMarginMetric = ['NetPPMLessSD', 'CM', 'SOROOS_PROCURABLE_PRODUCT_OOS_GV_PCT'].includes(metric);
        const metricLabel = {
          'GMS': 'GMS',
          'ShippedUnits': 'Shipped Units',
          'ASP': 'ASP',
          'NetPPMLessSD': 'Net PPM',
          'CM': 'Contribution Margin',
          'SOROOS_PROCURABLE_PRODUCT_OOS_GV_PCT': 'OOS GV%',
        }[metric] || metric;

        // Helper to render an ASIN table
        const renderAsinTable = (asins, heading, note) => {
          if (!asins || asins.length === 0) return;
          dataContext += `\n\n${heading}\n`;
          if (note) dataContext += `${note}\n`;
          dataContext += `**Reminder:** "YoY Δ" = this ASIN's own rate change. "YoY CTC" = its weighted contribution to the total. Rank by CTC.\n\n`;

          if (isMarginMetric) {
            dataContext += `| ASIN | Product | ${metricLabel} Value | YoY Δ (bps) | YoY CTC (bps) |\n|------|---------|-------|------|------|\n`;
            asins.forEach(a => {
              const val = a.value !== null && a.value !== undefined
                ? `${(a.value * 100).toFixed(1)}%` : '-';
              const yoyDelta = a.yoy_delta !== null && a.yoy_delta !== undefined
                ? a.yoy_delta : '-';
              dataContext += `| ${a.asin} | ${a.item_name.substring(0, 60)} | ${val} | ${yoyDelta} | ${a.ctc} |\n`;
            });
          } else {
            const prefix = metric === 'ASP' ? '$' : (metric === 'GMS' ? '$' : '');
            const ctcUnit = metric === 'ASP' ? '($)' : '(bps)';
            dataContext += `| ASIN | Product | ${metricLabel} | YoY Δ (%) | YoY CTC ${ctcUnit} |\n|------|---------|-------|------|------|\n`;
            asins.forEach(a => {
              const val = a.value !== null && a.value !== undefined
                ? `${prefix}${typeof a.value === 'number' ? a.value.toLocaleString() : a.value}` : '-';
              const yoyDelta = a.yoy_delta !== null && a.yoy_delta !== undefined
                ? (typeof a.yoy_delta === 'number' ? `${(a.yoy_delta * 100).toFixed(1)}%` : a.yoy_delta) : '-';
              dataContext += `| ${a.asin} | ${a.item_name.substring(0, 60)} | ${val} | ${yoyDelta} | ${a.ctc} |\n`;
            });
          }
        };

        // 1) GL-wide top ASINs
        const asinData = tools.getAsinDetail(week, gl, metric, { limit: 15 });
        if (asinData.asins && asinData.asins.length > 0) {
          renderAsinTable(
            asinData.asins,
            `## Top ASINs by ${metricLabel} YoY CTC (GL-wide)`,
            null
          );
        } else if (asinData.error) {
          dataContext += `\n\n## ASIN-level ${metricLabel} data: NOT AVAILABLE (${asinData.error})\n`;
        }

        // 2) Per-subcat ASIN drilldowns for top 3 drivers
        const drivers = tools.getMetricDrivers(week, gl, metric, { period: 'yoy', limit: 3 });
        if (drivers.drivers && drivers.drivers.length > 0) {
          for (const driver of drivers.drivers) {
            const subcatAsinData = tools.getAsinDetail(week, gl, metric, {
              subcat_code: driver.subcat_code,
              limit: 5,
            });
            if (subcatAsinData.asins && subcatAsinData.asins.length > 0) {
              const coverage = subcatAsinData.mapping_coverage;
              const coverageNote = coverage
                ? `*Showing ${coverage.matched} ASINs filtered to this subcategory.*`
                : '';
              renderAsinTable(
                subcatAsinData.asins,
                `### Top ASINs in ${driver.subcat_name} (${driver.subcat_code}) — ${metricLabel} CTC`,
                coverageNote
              );
            }
          }
        }
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

app.get('/api/metrics/:week/:gl', (req, res) => {
  res.json(tools.getMetricTotals(req.params.week, req.params.gl));
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

// ============================================================================
// New API Endpoints (v2 features)
// ============================================================================

/**
 * Top movers — subcats with highest absolute CTC for a metric.
 */
app.get('/api/movers/:week/:gl', (req, res) => {
  const { week, gl } = req.params;
  const metric = req.query.metric || 'GMS';
  const limit = parseInt(req.query.limit) || 5;

  const result = tools.getMetricDrivers(week, gl, metric, { limit, direction: 'both' });
  if (result.error) return res.json({ movers: [], error: result.error });

  const isASP = metric === 'ASP';
  const movers = (result.drivers || []).map(d => ({
    name: d.subcat_name,
    code: d.subcat_code,
    value: d.value,
    ctc: d.ctc,
    yoy_pct: d.yoy_pct,
    direction: d.ctc >= 0 ? 'up' : 'down',
    metric,
    ctcUnit: isASP ? '$' : 'bps',
  }));

  res.json({ movers, metric, week, gl });
});

/**
 * Tailwinds & Headwinds — significant positive and negative metric movements.
 */
app.get('/api/alerts/:week/:gl', (req, res) => {
  const { week, gl } = req.params;
  const tailwinds = [];
  const headwinds = [];

  const checks = [
    { metric: 'GMS', threshold: 300, label: 'GMS', unit: 'bps' },
    { metric: 'NetPPMLessSD', threshold: 150, label: 'Net PPM', unit: 'bps' },
  ];

  const secondary = [
    { metric: 'SOROOS_PROCURABLE_PRODUCT_OOS_GV_PCT', threshold: 500, label: 'SOROOS', unit: 'bps' },
  ];

  for (const check of [...checks, ...secondary]) {
    const result = tools.getMetricDrivers(week, gl, check.metric, { limit: 5, direction: 'both' });
    if (!result.drivers) continue;

    for (const d of result.drivers) {
      if (Math.abs(d.ctc) < check.threshold) continue;

      const entry = {
        subcat: d.subcat_name,
        subcatCode: d.subcat_code,
        metric: check.label,
        metricKey: check.metric,
        ctc: d.ctc,
        unit: check.unit,
        magnitude: Math.abs(d.ctc) >= check.threshold * 3 ? 'high' : 'medium',
      };

      if (d.ctc > 0) {
        if (check.metric === 'SOROOS_PROCURABLE_PRODUCT_OOS_GV_PCT') {
          headwinds.push(entry);
        } else {
          tailwinds.push(entry);
        }
      } else {
        if (check.metric === 'SOROOS_PROCURABLE_PRODUCT_OOS_GV_PCT') {
          tailwinds.push(entry);
        } else {
          headwinds.push(entry);
        }
      }
    }
  }

  tailwinds.sort((a, b) => Math.abs(b.ctc) - Math.abs(a.ctc));
  headwinds.sort((a, b) => Math.abs(b.ctc) - Math.abs(a.ctc));

  res.json({
    tailwinds: tailwinds.slice(0, 5),
    headwinds: headwinds.slice(0, 5),
    week,
    gl,
  });
});

/**
 * Trends — metric values across all available weeks for a GL.
 */
app.get('/api/trends/:gl', (req, res) => {
  const { gl } = req.params;
  const { weeks } = tools.listWeeks();

  // Go oldest → newest
  const orderedWeeks = [...weeks].reverse();

  const metricKeys = ['GMS', 'ShippedUnits', 'ASP', 'NetPPMLessSD', 'CM'];
  const trends = {};

  for (const key of metricKeys) {
    trends[key.toLowerCase()] = [];
  }

  // Map backend metric names to the lowercase keys used by the dashboard
  const nameMap = {
    'gms': 'gms',
    'units': 'units',
    'shippedunits': 'units',
    'asp': 'asp',
    'nppm': 'nppm',
    'netppmlesssd': 'nppm',
    'net ppm': 'nppm',
    'cm': 'cm',
  };

  for (const week of orderedWeeks) {
    const totals = tools.getMetricTotals(week, gl);
    if (!totals.metrics) continue;

    for (const m of totals.metrics) {
      const key = nameMap[(m.name || '').toLowerCase()] || (m.name || '').toLowerCase();
      if (trends[key]) {
        // Extract raw numeric value from formatted string
        let rawValue = null;
        if (typeof m.value === 'string') {
          const cleaned = m.value.replace(/[$,%KMB]/g, '').replace(/,/g, '');
          rawValue = parseFloat(cleaned) || null;
        } else if (typeof m.value === 'number') {
          rawValue = m.value;
        }

        trends[key].push({
          week,
          value: m.value,
          rawValue,
          wow: m.wow,
          wowUnit: m.wowUnit || '%',
          yoy: m.yoy,
          yoyUnit: m.yoyUnit || '%',
        });
      }
    }
  }

  res.json({ gl, weeks: orderedWeeks, trends });
});

/**
 * Data freshness — when was data last updated.
 */
app.get('/api/freshness/:week', (req, res) => {
  const { week } = req.params;
  const dataDir = path.join(__dirname, '..', 'data', 'weekly', week);

  if (!fs.existsSync(dataDir)) {
    return res.json({ fresh: false, error: 'No data folder' });
  }

  // Check file modification times in the GL folders
  let latestMtime = 0;
  try {
    const glDir = path.join(dataDir, 'gl');
    if (fs.existsSync(glDir)) {
      const gls = fs.readdirSync(glDir);
      for (const gl of gls) {
        const glPath = path.join(glDir, gl);
        const stat = fs.statSync(glPath);
        if (stat.isDirectory()) {
          const files = fs.readdirSync(glPath);
          for (const f of files) {
            const fstat = fs.statSync(path.join(glPath, f));
            if (fstat.mtimeMs > latestMtime) latestMtime = fstat.mtimeMs;
          }
        }
      }
    }
  } catch (e) {
    return res.json({ fresh: false, error: e.message });
  }

  if (latestMtime === 0) {
    return res.json({ fresh: false, error: 'No data files found' });
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

/**
 * Export session as markdown.
 */
app.get('/api/session/:sessionId/export', (req, res) => {
  const session = sessions.get(req.params.sessionId);
  if (!session || session.conversationHistory.length === 0) {
    return res.status(404).json({ error: 'No session data to export' });
  }

  const gl = session.currentGL || 'Unknown';
  const week = session.currentWeek || 'Unknown';
  const now = new Date().toISOString().split('T')[0];

  let output = `# Business Review Analysis — ${gl} / ${week}\n`;
  output += `*Generated ${now}*\n\n---\n\n`;

  for (const msg of session.conversationHistory) {
    if (msg.role === 'user') {
      output += `## Q: ${msg.content}\n\n`;
    } else {
      output += `${msg.content}\n\n---\n\n`;
    }
  }

  res.json({ markdown: output, gl, week, messageCount: session.conversationHistory.length });
});

/**
 * Generate Business Review bridge summary — uses LLM to synthesize key findings.
 */
app.post('/api/session/:sessionId/bridge', async (req, res) => {
  const session = sessions.get(req.params.sessionId);
  if (!session || session.conversationHistory.length === 0) {
    return res.status(404).json({ error: 'No analysis to summarize' });
  }

  try {
    const gl = session.currentGL || 'Unknown';
    const week = session.currentWeek || 'Unknown';

    const conversationText = session.conversationHistory
      .map(m => `${m.role === 'user' ? 'Question' : 'Analysis'}: ${m.content}`)
      .join('\n\n');

    const bridgePrompt = `You are a senior business analyst. Based on the following Business Review analysis conversation for ${gl} (${week}), generate a concise executive bridge document.

Format:
1. **Executive Summary** (2-3 sentences max)
2. **Key Metrics** (table: Metric | Value | YoY | Driver)
3. **Top 3 Callouts** (most important findings, ranked by business impact)
4. **Risks & Watch Items** (if any emerged from the analysis)
5. **Recommended Actions** (if the analysis suggests any)

Be data-driven. Use exact numbers from the conversation. No hedging.

---

${conversationText}`;

    const bridge = await llm.chat(bridgePrompt, [{ role: 'user', content: 'Generate the Business Review bridge document.' }]);

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

// --- Format Presets ---

const FORMATS_FILE = path.join(__dirname, '..', 'data', 'formats.json');

function loadFormats() {
  try {
    if (fs.existsSync(FORMATS_FILE)) return JSON.parse(fs.readFileSync(FORMATS_FILE, 'utf-8'));
  } catch {}
  return [];
}

function saveFormats(formats) {
  const dir = path.dirname(FORMATS_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(FORMATS_FILE, JSON.stringify(formats, null, 2));
}

app.get('/api/formats', (req, res) => {
  res.json({ formats: loadFormats() });
});

app.post('/api/formats', (req, res) => {
  const { name, template } = req.body;
  if (!name || !template) return res.status(400).json({ error: 'Name and template are required' });

  const formats = loadFormats();
  const existing = formats.findIndex(f => f.name === name);
  const entry = { name: name.trim(), template: template.trim(), updatedAt: new Date().toISOString() };

  if (existing >= 0) {
    formats[existing] = entry;
  } else {
    formats.push(entry);
  }

  saveFormats(formats);
  res.json({ format: entry, formats });
});

app.delete('/api/formats/:name', (req, res) => {
  const formats = loadFormats();
  const filtered = formats.filter(f => f.name !== req.params.name);
  if (filtered.length === formats.length) return res.status(404).json({ error: 'Format not found' });
  saveFormats(filtered);
  res.json({ deleted: req.params.name, formats: filtered });
});

// Reformat prompt — used for two-pass style formatting
const REFORMAT_SYSTEM = `You are a formatting assistant. Your ONLY job is to restructure and restyle the analysis below to match the user's preferred format.

ABSOLUTE RULES:
- Preserve EVERY number, metric, bps value, dollar amount, percentage, and ASIN exactly as-is
- Preserve ALL conclusions and findings — do not add, remove, or reinterpret
- Do not add hedging language ("approximately", "roughly") — if the original says a number, keep it exact
- Do not add new analysis or opinions
- Only change: structure, bullet style, headers, tone, sentence phrasing, ordering
- If the format example uses tables, convert to tables. If it uses bullets, convert to bullets.
- If a data point exists in the original, it MUST appear in your output`;

// Streaming endpoint (with two-pass format support)
app.post('/api/ask/stream', async (req, res) => {
  try {
    const { question, week, gl: requestedGL, formatTemplate, sessionId = 'default' } = req.body;

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

    // GL resolution priority:
    // 1. Explicit sidebar selection (requestedGL) — always trusted
    // 2. Keyword detection from question — only as fallback
    // 3. Current session GL — for follow-up questions
    const questionGL = session.detectGL(question);
    let detectedGL;
    
    if (requestedGL) {
      // Sidebar selection is authoritative
      detectedGL = requestedGL;
      
      // Conflict detection: if question clearly mentions a different GL, warn the user
      if (questionGL && questionGL !== requestedGL) {
        const warning = `**Note:** You're viewing **${requestedGL.toUpperCase()}** data, but your question mentions **${questionGL.toUpperCase()}** products. ` +
          `I'll answer using ${requestedGL.toUpperCase()} data. Switch GLs in the sidebar if you meant ${questionGL.toUpperCase()}.\n\n`;
        res.write(`data: ${JSON.stringify({ type: 'content', text: warning })}\n\n`);
      }
    } else if (questionGL) {
      detectedGL = questionGL;
    } else if (session.currentGL) {
      detectedGL = session.currentGL;
    }
    
    // If still no GL, ask for clarification
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

    // Stream response (with optional two-pass formatting)
    let fullResponse = '';
    const hasFormat = formatTemplate && formatTemplate.trim().length > 0;

    if (hasFormat) {
      // === PASS 1: Analysis (silent collection) ===
      res.write(`data: ${JSON.stringify({ type: 'status', text: 'Analyzing...' })}\n\n`);
      try {
        fullResponse = await llm.chat(systemPrompt, messages);
      } catch (err) {
        console.error('Pass 1 error:', err);
        res.write(`data: ${JSON.stringify({ type: 'error', error: err.message })}\n\n`);
        res.end();
        return;
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
        res.write(`data: ${JSON.stringify({ type: 'content', text: '\n\n---\n*Format pass failed. Showing original analysis:*\n\n' + fullResponse })}\n\n`);
        reformattedResponse = fullResponse;
      }

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
  console.log('  POST /api/ask/stream     - Streaming chat');
  console.log('  GET  /api/weeks          - List weeks');
  console.log('  GET  /api/gls/:week      - List GLs');
  console.log('  GET  /api/metrics/:w/:gl - Metric totals');
  console.log('  GET  /api/movers/:w/:gl  - Top movers');
  console.log('  GET  /api/alerts/:w/:gl  - Tailwinds/Headwinds');
  console.log('  GET  /api/trends/:gl     - Sparkline trends');
  console.log('  GET  /api/freshness/:w   - Data freshness');
  console.log('  GET  /api/formats        - Format presets');
});

module.exports = { app, AnalysisSession };
