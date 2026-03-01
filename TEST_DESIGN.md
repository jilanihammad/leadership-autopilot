# TEST_DESIGN.md — Comprehensive Test Plan

> **Leadership Autopilot** — AI-powered WBR Analysis Assistant  
> **Author:** Testing Agent (Senior Staff Engineer, Reliability & QA Architecture)  
> **Date:** 2025-07-16  
> **Status:** Design complete. No test code generated.

---

## Table of Contents

1. [System Understanding](#1-system-understanding)
2. [Existing Test Inventory](#2-existing-test-inventory)
3. [Functional Coverage Map](#3-functional-coverage-map)
4. [Test Design — Tier 1 (Ship Blockers)](#4-test-design--tier-1-ship-blockers)
5. [Test Design — Tier 2 (Production Confidence)](#5-test-design--tier-2-production-confidence)
6. [Test Design — Tier 3 (Hardening)](#6-test-design--tier-3-hardening)
7. [Coverage Summary](#7-coverage-summary)

---

## 1. System Understanding

### Architecture

Two-subsystem monorepo:

1. **Agent API** (`agent/server.js`, Express on port 3456) — 20+ API endpoints, session management, SSE streaming, context building, LLM integration
2. **Dashboard** (`dashboard/`, Next.js on port 3000) — metric cards, sparklines, chat interface, movers panel

### Critical Data Path

```
Excel files → tools.js (deterministic extraction) → server.js (context builder) → LLM → SSE stream → Dashboard
```

The **most critical invariant**: all metric computation is deterministic in `tools.js` (1,740 lines). The LLM only does reasoning over pre-extracted tables. This means `tools.js` correctness directly determines whether executives see correct numbers.

### Key Risk Areas

| Area | Risk | Impact |
|------|------|--------|
| Metric computation (`tools.js`) | Wrong CTC/WoW/YoY values | Executives make decisions on wrong data |
| GL filtering | Wrong subcats assigned to GL | Metrics attributed to wrong business unit |
| Column mapping | Reading wrong Excel column | Silent data corruption — numbers look plausible but are wrong |
| SSE streaming | Broken stream, hung connections | UI freezes, user thinks system is down |
| Session management | State leaks between sessions | User sees another user's data/conversation |
| Error handling | Unhandled exceptions crash server | All users affected |

---

## 2. Existing Test Inventory

### Suite Summary

| # | File | Tests | Pass | Fail | Status |
|---|------|-------|------|------|--------|
| 1 | `agent/tools.test.js` | 22 | 22 | 0 | ✅ Clean |
| 2 | `agent/test/tools.fixture.test.js` | 27 | 27 | 0 | ✅ Clean |
| 3 | `agent/test/data-accuracy.test.js` | 113 | 67 | 46 | ❌ 46 failures (data-dependent) |
| 4 | `agent/test/gl-metric-accuracy.test.js` | 28 | — | — | ⚠️ Skipped (missing wk06 data) |
| 5 | `scripts/metric-detection.test.js` | 29 | 29 | 0 | ✅ Clean |
| **Total** | | **219** | **145** | **46** | **28 skipped** |

### What's Covered

- **`tools.js` pure functions:** `safeDivide`, `safeReadExcel`, `getDataFreshness`, `detectFileLayout` — well tested via suites 1 & 2
- **Fixture-based parsing:** GMS/NetPPM/ASIN Excel parsing, malformed file handling, zero/null values — suite 2
- **Column-mapping accuracy:** `getMetricTotals`, `getMetricDrivers`, `getAsinDetail` column indices vs raw Excel — suite 3 (partially broken)
- **GL-level metric accuracy:** Revenue-weighted averaging bug detection — suite 4 (skipped)
- **Metric detection:** Header matching, level detection, week extraction, filename parsing — suite 5

### What's NOT Covered (Gaps)

**Zero test coverage for:**
1. `agent/server.js` — All 20+ API endpoints, `AnalysisSession` class, SSE streaming, session CRUD, bridge generation, format templates, CORS, error responses
2. `agent/llm.js` — Multi-provider abstraction, `chat()`, `chatStream()`, credential validation, provider switching
3. `scripts/bootstrap-data.js` — GL folder creation, symlink generation, manifest auto-generation, idempotency
4. `scripts/generate_summary.js` — `parseSubcatData()`, `parseTrafficData()`, `generateSummaryMd()`, `generateManifest()`, `readExcelFile()`, `fmt()`
5. `dashboard/` — Zero test infrastructure. No testing library installed. No test files exist.

---

## 3. Functional Coverage Map

### 3.1 Core User Flows

| # | Flow | Module | Tested? |
|---|------|--------|---------|
| 1 | User asks a business question and gets streaming analysis | `server.js` POST `/api/ask/stream` + `llm.js` + `tools.js` | ❌ No |
| 2 | User selects a week and GL, sees metric cards | `server.js` GET `/api/metrics/:week/:gl` + `tools.js getMetricTotals` | Partial (tools only) |
| 3 | User views top movers for a metric | `server.js` GET `/api/movers/:week/:gl` + `tools.js getMetricDrivers` | Partial (tools only) |
| 4 | User views tailwinds/headwinds alerts | `server.js` GET `/api/alerts/:week/:gl` | ❌ No |
| 5 | User views multi-week trend sparklines | `server.js` GET `/api/trends/:gl` | ❌ No |
| 6 | User exports session as markdown | `server.js` GET `/api/session/:id/export` | ❌ No |
| 7 | User generates bridge narrative | `server.js` POST `/api/session/:id/bridge` | ❌ No |
| 8 | User saves/loads/lists sessions | `server.js` session CRUD endpoints | ❌ No |
| 9 | User manages format templates | `server.js` format CRUD endpoints | ❌ No |
| 10 | User switches GL mid-conversation | `AnalysisSession` GL detection + context flush | ❌ No |

### 3.2 Secondary Flows

| Flow | Module | Tested? |
|------|--------|---------|
| LLM provider configuration | `llm.js getConfig`, `/api/config`, `/api/providers` | ❌ No |
| Credential validation | `llm.js validateCredentials`, `/api/config/validate` | ❌ No |
| Data freshness check | `/api/freshness/:week`, `tools.js getDataFreshness` | Partial (tools only) |
| Subcategory search | `tools.js searchSubcats` | Minimal |
| Cross-GL queries | `AnalysisSession.handleCrossGLQuery` | ❌ No |
| Weekly findings persistence | `AnalysisSession` appendToWeeklyFindings | ❌ No |
| Data bootstrapping | `scripts/bootstrap-data.js` | ❌ No |
| Summary generation | `scripts/generate_summary.js` | ❌ No |

### 3.3 Failure Paths

| Failure | Expected Behavior | Tested? |
|---------|-------------------|---------|
| Excel file missing | Graceful error in `safeReadExcel`, null metric | ✅ Yes |
| Excel file corrupted | `safeReadExcel` returns error, no crash | ✅ Yes |
| Malformed YAML manifest | Parse error caught | ✅ Yes |
| Missing GL in data | `resolveGLDataFolder` returns null | ❌ No |
| LLM provider unavailable | `chat()`/`chatStream()` error propagation | ❌ No |
| LLM returns empty/malformed response | Graceful handling in `handleQuery` | ❌ No |
| SSE connection dropped mid-stream | Client reconnect, server cleanup | ❌ No |
| Missing API key | `validateCredentials` throws | ❌ No |
| Session not found | 404 response | ❌ No |
| Invalid week format | Error response | ❌ No |
| `data/weekly/` directory missing | `listWeeks` returns empty | ✅ Partial |
| File system permissions error | Error handling | ❌ No |
| Very large Excel file | Memory/performance | ❌ No |

### 3.4 State Transitions

| Transition | Module | Tested? |
|------------|--------|---------|
| No GL selected → GL detected from question | `AnalysisSession.detectGL` | ❌ No |
| Same GL follow-up (context preserved) | `AnalysisSession.handleQuery` | ❌ No |
| GL switch (context flushed, findings saved) | `AnalysisSession.handleQuery` | ❌ No |
| Single-GL → cross-GL query | `AnalysisSession.isMultiGLQuestion` | ❌ No |
| Session reset (history cleared) | `POST /api/session/:id/reset` | ❌ No |
| Session save → load round-trip | Session persistence endpoints | ❌ No |
| Conversation history trimming | `maxHistoryTurns` enforcement | ❌ No |

### 3.5 Security Boundaries

| Boundary | Tested? |
|----------|---------|
| CORS headers (Allow-Origin: *) | ❌ No |
| Input validation on `/api/ask` (question required) | ❌ No |
| Path traversal via week/GL params | ❌ No |
| Session isolation (no cross-session data leaks) | ❌ No |
| LLM API key exposure in error responses | ❌ No |
| Error responses don't leak internal paths | ❌ No |
| Format template XSS (stored template injection) | ❌ No |
| Session ID predictability | ❌ No |

### 3.6 Async/Concurrency Risks

| Risk | Tested? |
|------|---------|
| Concurrent requests to same session | ❌ No |
| SSE stream interrupted by client disconnect | ❌ No |
| LLM timeout during streaming | ❌ No |
| Race condition: GL switch during active stream | ❌ No |
| File system reads during data bootstrap | ❌ No |
| In-memory session Map under concurrent access | ❌ No |

### 3.7 Data Boundaries

| Boundary | Tested? |
|----------|---------|
| Zero-value metrics (GMS=0, Units=0) | ✅ Partial (fixture) |
| Null/missing columns in Excel | ✅ Partial (fixture) |
| Empty subcategory list (GL with no matching codes) | ❌ No |
| Single subcategory GL | ❌ No |
| 100+ subcategories (large GL) | ❌ No |
| Metric value formatting edge cases ($0, 0%, NaN) | ❌ No |
| Week format variations ("2026-wk5" vs "2026-wk05") | ❌ No |
| GL name case sensitivity ("PC" vs "pc" vs "Pc") | ❌ No |
| Empty conversation history on export | ❌ No |
| Max history turns boundary (exactly 5, 6 turns) | ❌ No |
| Very long question string | ❌ No |
| Unicode/special characters in question | ❌ No |
| ASIN names with special characters (quotes, commas) | ❌ No |

---

## 4. Test Design — Tier 1 (Ship Blockers)

### 4.1 API Endpoint Validation

#### T1-API-01: POST /api/ask requires question parameter
- **What it validates:** Input validation — server returns 400 when `question` is missing
- **Tier:** 1
- **Prevents:** Server processing empty/null queries, wasting LLM tokens
- **Status:** NEW

#### T1-API-02: POST /api/ask returns valid response structure
- **What it validates:** Response shape has `response`, `gl`, `week` fields
- **Tier:** 1
- **Prevents:** Dashboard crash on malformed API response
- **Status:** NEW

#### T1-API-03: GET /api/weeks returns sorted week list
- **What it validates:** `/api/weeks` returns `{ weeks: [...] }` array sorted descending
- **Tier:** 1
- **Prevents:** Dashboard shows weeks in wrong order, user selects stale data
- **Status:** NEW

#### T1-API-04: GET /api/gls/:week returns GL list for valid week
- **What it validates:** Returns `{ gls: [...] }` with name and metrics fields
- **Tier:** 1
- **Prevents:** Dashboard can't populate GL selector
- **Status:** NEW

#### T1-API-05: GET /api/gls/:week returns error for invalid week
- **What it validates:** Returns error for non-existent week, not empty success
- **Tier:** 1
- **Prevents:** Silent failure, user thinks no GLs exist
- **Status:** NEW

#### T1-API-06: GET /api/metrics/:week/:gl returns metric totals
- **What it validates:** Returns array of 5 metrics (GMS, Units, ASP, Net PPM, CM) with value/wow/yoy
- **Tier:** 1
- **Prevents:** Dashboard metric cards show "—" for all values
- **Status:** NEW

#### T1-API-07: POST /api/ask/stream returns valid SSE format
- **What it validates:** Response is `text/event-stream`, each line is `data: {json}\n\n`, final event is `type: done`
- **Tier:** 1
- **Prevents:** Chat completely broken — streaming is the primary query path
- **Status:** NEW

#### T1-API-08: POST /api/ask/stream handles missing question
- **What it validates:** Returns 400 JSON error, not an SSE stream
- **Tier:** 1
- **Prevents:** Client stuck waiting for SSE events that never come
- **Status:** NEW

#### T1-API-09: GET /api/movers/:week/:gl returns mover data
- **What it validates:** Returns `{ movers: [...] }` with name, code, ctc, direction fields
- **Tier:** 1
- **Prevents:** Right sidebar movers panel empty/broken
- **Status:** NEW

#### T1-API-10: GET /api/alerts/:week/:gl returns winds data
- **What it validates:** Returns `{ tailwinds: [...], headwinds: [...] }` with proper structure
- **Tier:** 1
- **Prevents:** Headwinds/tailwinds section broken
- **Status:** NEW

#### T1-API-11: GET /api/trends/:gl returns multi-week trends
- **What it validates:** Returns `{ trends: { gms: [...], units: [...], ... } }` with rawValue per week
- **Tier:** 1
- **Prevents:** Sparklines don't render, no trend data
- **Status:** NEW

### 4.2 Core Data Computation

#### T1-DATA-01: getMetricTotals computes GL-filtered GMS correctly
- **What it validates:** GMS total for a specific GL = sum of filtered subcat values from ALL file
- **Tier:** 1
- **Prevents:** Dashboard shows wrong revenue number for a business unit
- **Status:** NEW (extends partial coverage in suite 3)

#### T1-DATA-02: getMetricTotals computes margin metrics using cross-metric denominator approach
- **What it validates:** Net PPM and CM WoW/YoY use proper weighted computation, NOT revenue-weighted averaging
- **Tier:** 1
- **Prevents:** The "80–780 bps error" bug documented in README. Wrong margin change = wrong business narrative
- **Status:** EXISTING (suite 4 `gl-metric-accuracy.test.js` — but currently skipped). Needs to be made runnable.

#### T1-DATA-03: getMetricDrivers returns drivers sorted by absolute CTC
- **What it validates:** Top drivers are sorted by |CTC| descending, respects limit parameter
- **Tier:** 1
- **Prevents:** "Top driver" callout in analysis is actually the 5th biggest — misleads executives
- **Status:** EXISTING (partial in `tools.test.js` and `data-accuracy.test.js`). Needs fixture-based test that doesn't depend on real data.

#### T1-DATA-04: getMetricDrivers direction filter works correctly
- **What it validates:** `direction: 'positive'` only returns positive CTC, `'negative'` only negative
- **Tier:** 1
- **Prevents:** Headwinds showing in tailwinds panel and vice versa
- **Status:** EXISTING (partial in `data-accuracy.test.js`). Needs self-contained fixture test.

#### T1-DATA-05: GL-to-subcat mapping assigns correct subcats
- **What it validates:** `loadGLMapping()` and `getSubcatsForGL(gl)` return correct subcat codes for known GLs
- **Tier:** 1
- **Prevents:** Metrics from wrong business unit bleeding into another GL's dashboard cards
- **Status:** NEW

#### T1-DATA-06: getMetricTotals with `gl='all'` uses Total row directly
- **What it validates:** When GL is 'all', values come from the Total row, not re-computed
- **Tier:** 1
- **Prevents:** ALL view showing different numbers than sum-of-parts, confusing reconciliation
- **Status:** NEW

#### T1-DATA-07: getMetricDrivers recomputes CTC(bps) relative to GL total when filtered
- **What it validates:** CTC bps values are recalculated against GL denominator, not ALL denominator
- **Tier:** 1
- **Prevents:** CTC attribution percentages don't sum to ~100% for a GL, misleading analysis
- **Status:** NEW

#### T1-DATA-08: getAllSubcatData returns all metrics per subcategory
- **What it validates:** Each subcat has GMS, Units, ASP, NetPPM, CM, SOROOS metrics with value/wow/yoy/ctc
- **Tier:** 1
- **Prevents:** Context table sent to LLM has missing columns → LLM says "data not available"
- **Status:** EXISTING (basic check in `tools.test.js`). Needs metric completeness assertion.

### 4.3 Session Management

#### T1-SESS-01: Session creation and retrieval
- **What it validates:** `getSession(id)` creates new session, returns same session on repeat call
- **Tier:** 1
- **Prevents:** Every request creates a fresh session, losing conversation history
- **Status:** NEW

#### T1-SESS-02: Session reset clears state
- **What it validates:** `POST /api/session/:id/reset` clears GL, week, conversation history
- **Tier:** 1
- **Prevents:** Stale context from previous conversation leaks into new analysis
- **Status:** NEW

#### T1-SESS-03: Conversation history trimming
- **What it validates:** History is trimmed to `maxHistoryTurns * 2` messages after each query
- **Tier:** 1
- **Prevents:** Unbounded memory growth, context window overflow
- **Status:** NEW

### 4.4 Error Handling

#### T1-ERR-01: API endpoints return proper error JSON, not stack traces
- **What it validates:** 400/404/500 responses are `{ error: "message" }`, no internal paths or stack traces
- **Tier:** 1
- **Prevents:** Information leakage — internal paths, module names, API keys in error responses
- **Status:** NEW

#### T1-ERR-02: Server doesn't crash on malformed JSON body
- **What it validates:** `POST /api/ask` with non-JSON body returns 400, server stays up
- **Tier:** 1
- **Prevents:** Single malformed request takes down the entire server
- **Status:** NEW

#### T1-ERR-03: getMetricDrivers/getAllSubcatData handle null parameters
- **What it validates:** Null/undefined week, gl, metric return `{ error: ... }` not exceptions
- **Tier:** 1
- **Prevents:** Unhandled null pointer crashes
- **Status:** EXISTING (`tools.test.js` edge cases). Already passing.

---

## 5. Test Design — Tier 2 (Production Confidence)

### 5.1 AnalysisSession Logic

#### T2-SESS-01: detectGL identifies GL from explicit mentions
- **What it validates:** "How is PC doing?" → `'pc'`, "Toys business" → `'toys'`, "consumer electronics" → `'ce'`
- **Tier:** 2
- **Prevents:** System can't detect which GL user is asking about, asks for clarification unnecessarily
- **Status:** NEW

#### T2-SESS-02: detectGL identifies GL from product keywords
- **What it validates:** "laptop sales" → `'pc'`, "dog food" → `'pets'`, "yoga equipment" → `'sports'`
- **Tier:** 2
- **Prevents:** Product-specific questions route to wrong GL
- **Status:** NEW

#### T2-SESS-03: detectGL returns null for ambiguous queries
- **What it validates:** "How are things going?" → `null` (no GL detected)
- **Tier:** 2
- **Prevents:** Random GL assigned to generic questions
- **Status:** NEW

#### T2-SESS-04: isMultiGLQuestion detects cross-GL patterns
- **What it validates:** "Compare PC and Toys" → `true`, "overall summary" → `true`, "PC GMS" → `false`
- **Tier:** 2
- **Prevents:** Single-GL question routed to cross-GL handler (slower, less data)
- **Status:** NEW

#### T2-SESS-05: GL switch flushes conversation history
- **What it validates:** When `detectedGL !== currentGL`, history is cleared and new data loaded
- **Tier:** 2
- **Prevents:** Follow-up analysis references data from wrong GL
- **Status:** NEW

#### T2-SESS-06: determineDataNeeds correctly identifies ASIN-level requirements
- **What it validates:** "Which products drove GMS decline?" → `asin: true`, "What's the summary?" → `asin: false`
- **Tier:** 2
- **Prevents:** Missing product-level data when user asks for drilldown, or loading unnecessary ASIN data
- **Status:** NEW

#### T2-SESS-07: detectQuestionMetrics maps question terms to metric keys
- **What it validates:** "margin" → `NetPPMLessSD`, "revenue" → `GMS`, "price" → `ASP`, "volume" → `ShippedUnits`
- **Tier:** 2
- **Prevents:** Wrong metric loaded at ASIN level → analysis answers about wrong thing
- **Status:** NEW

#### T2-SESS-08: buildContext produces well-formed LLM context
- **What it validates:** Context string contains data availability section, summary, subcategory table with all columns
- **Tier:** 2
- **Prevents:** LLM receives malformed/empty context, generates hallucinated analysis
- **Status:** NEW

### 5.2 Integration: API ↔ Tools

#### T2-INT-01: /api/metrics/:week/:gl matches tools.getMetricTotals output
- **What it validates:** API response is the exact output of `getMetricTotals`, not transformed/lost
- **Tier:** 2
- **Prevents:** API layer silently drops or transforms metric data
- **Status:** NEW

#### T2-INT-02: /api/movers/:week/:gl transforms getMetricDrivers correctly
- **What it validates:** Movers endpoint maps driver fields to mover shape (direction, ctcUnit)
- **Tier:** 2
- **Prevents:** Mover direction inverted (down shown as up), wrong unit label
- **Status:** NEW

#### T2-INT-03: /api/alerts/:week/:gl threshold logic
- **What it validates:** Only drivers with |CTC| ≥ threshold appear in alerts, correct wind classification
- **Tier:** 2
- **Prevents:** Trivial 10bps movements flagged as alerts, or significant 500bps changes missed
- **Status:** NEW

#### T2-INT-04: /api/alerts inverts SOROOS direction
- **What it validates:** SOROOS positive CTC → headwind (higher OOS is bad), negative → tailwind
- **Tier:** 2
- **Prevents:** Rising out-of-stock rate shown as good news
- **Status:** NEW

#### T2-INT-05: /api/trends/:gl returns trends across all available weeks
- **What it validates:** Trends cover all weeks in `listWeeks()`, ordered oldest→newest, with rawValue extraction
- **Tier:** 2
- **Prevents:** Sparklines missing weeks, wrong order, null values not handled
- **Status:** NEW

#### T2-INT-06: /api/freshness/:week calculates age correctly
- **What it validates:** Age in minutes matches actual file modification times, label formatting is correct
- **Tier:** 2
- **Prevents:** "Updated 5m ago" when data is actually 3 days old
- **Status:** NEW

### 5.3 Session Persistence

#### T2-PERS-01: Session save/load round-trip preserves state
- **What it validates:** Save session → load session → GL, week, history all match
- **Tier:** 2
- **Prevents:** User loses conversation context after save/load
- **Status:** NEW

#### T2-PERS-02: Session export produces valid markdown
- **What it validates:** Export contains Q&A pairs in order, GL/week header, date
- **Tier:** 2
- **Prevents:** Garbled export document presented to leadership
- **Status:** NEW

#### T2-PERS-03: Session export returns 404 for empty session
- **What it validates:** No conversation → 404, not empty markdown
- **Tier:** 2
- **Prevents:** User exports blank document thinking it contains their analysis
- **Status:** NEW

#### T2-PERS-04: List saved sessions returns metadata
- **What it validates:** `/api/sessions/saved` returns array with sessionId, gl, week, messageCount, savedAt
- **Tier:** 2
- **Prevents:** User can't find their saved sessions
- **Status:** NEW

### 5.4 Format Templates

#### T2-FMT-01: Format CRUD lifecycle
- **What it validates:** Create format → list (appears) → update (overwrite) → delete (disappears)
- **Tier:** 2
- **Prevents:** Templates can't be managed, accumulate garbage
- **Status:** NEW

#### T2-FMT-02: Format creation validates required fields
- **What it validates:** Missing name or template → 400 error
- **Tier:** 2
- **Prevents:** Empty/unnamed templates pollute template list
- **Status:** NEW

#### T2-FMT-03: Format deletion returns 404 for non-existent name
- **What it validates:** Deleting a name that doesn't exist returns 404
- **Tier:** 2
- **Prevents:** Silent success misleads client into thinking delete worked
- **Status:** NEW

### 5.5 Edge Cases — Data

#### T2-EDGE-01: getMetricTotals handles GL with zero matching subcats
- **What it validates:** GL that exists in mapping but has no subcat data → empty metrics, not crash
- **Tier:** 2
- **Prevents:** Server crash when new GL added to mapping before data arrives
- **Status:** NEW

#### T2-EDGE-02: getAsinDetail with subcat filter returns mapping coverage
- **What it validates:** Response includes `mapping_coverage` with `total_asins`, `matched`, and note
- **Tier:** 2
- **Prevents:** User asks for ASIN drilldown, gets empty result with no explanation
- **Status:** NEW

#### T2-EDGE-03: getAsinDetail with non-existent subcat returns empty with explanation
- **What it validates:** `subcat_code` that matches nothing → `matched: 0` with explanatory note
- **Tier:** 2
- **Prevents:** Confusing empty result with no context about why
- **Status:** NEW

#### T2-EDGE-04: GL name case insensitivity
- **What it validates:** `getMetricTotals(week, 'PC')` and `getMetricTotals(week, 'pc')` return same results
- **Tier:** 2
- **Prevents:** Case mismatch between sidebar selection and tools causes "no data found"
- **Status:** NEW

#### T2-EDGE-05: detectFileLayout handles both merge-row and direct-header formats
- **What it validates:** Both Excel structures (with and without WoW/YoY Variance merge row) detected correctly
- **Tier:** 2
- **Prevents:** New file format silently misread, columns shifted by 1
- **Status:** EXISTING (implicit in `data-accuracy.test.js`). Needs explicit fixture tests.

#### T2-EDGE-06: safeDivide returns null for NaN/Infinity denominator
- **What it validates:** `safeDivide(10, NaN)` → `null`, `safeDivide(10, Infinity)` → 0 or null
- **Tier:** 2
- **Prevents:** NaN propagating through metric calculations
- **Status:** EXISTING (partial in fixture tests). Needs NaN/Infinity cases.

#### T2-EDGE-07: getTrafficChannels handles CSV with quoted commas
- **What it validates:** Channel names with commas parse correctly, GV values extracted
- **Tier:** 2
- **Prevents:** Traffic channel data garbled, wrong GV numbers
- **Status:** NEW

#### T2-EDGE-08: Metric value formatting boundaries
- **What it validates:** $0 → "$0", $999 → "$999", $1000 → "$1.0K", $999999 → "$1000.0K", $1000000 → "$1.00M"
- **Tier:** 2
- **Prevents:** Dashboard shows ugly/wrong formatted values like "$0.00M"
- **Status:** NEW

### 5.6 LLM Provider Abstraction

#### T2-LLM-01: getConfig returns valid provider configuration
- **What it validates:** Returns `{ provider, providerName, model, availableModels }` for each supported provider
- **Tier:** 2
- **Prevents:** LLM layer fails to initialize, all queries broken
- **Status:** NEW

#### T2-LLM-02: getConfig throws for unknown provider
- **What it validates:** `LLM_PROVIDER=invalid` → throws with list of available providers
- **Tier:** 2
- **Prevents:** Silent fallback to wrong provider
- **Status:** NEW

#### T2-LLM-03: validateCredentials checks required env vars per provider
- **What it validates:** Missing ANTHROPIC_API_KEY → throws, missing AWS keys → throws, etc.
- **Tier:** 2
- **Prevents:** Server starts but all queries fail with cryptic SDK errors
- **Status:** NEW

#### T2-LLM-04: listProviders shows configuration status
- **What it validates:** Each provider has `configured: true/false` based on env vars
- **Tier:** 2
- **Prevents:** User selects unconfigured provider, gets unhelpful error
- **Status:** NEW

### 5.7 Scripts

#### T2-SCRIPT-01: metric-detection parseFilename handles standard patterns
- **What it validates:** "GMS_Week 5_ctc_by_SUBCAT.xlsx" → `{ metric: 'GMS', week: 5, level: 'SUBCAT' }`
- **Tier:** 2
- **Prevents:** New data files not recognized, not included in manifest
- **Status:** EXISTING (`scripts/metric-detection.test.js`). Already passing.

#### T2-SCRIPT-02: generate_summary.js METRIC_CONFIG column indices match tools.js
- **What it validates:** Column indices in `generate_summary.js` align with column indices in `tools.js`
- **Tier:** 2
- **Prevents:** Summary shows WoW% but tools.js reads YoY% from same column → inconsistent numbers
- **Status:** NEW

---

## 6. Test Design — Tier 3 (Hardening)

### 6.1 Concurrency & Resilience

#### T3-CONC-01: Concurrent requests to different sessions don't interfere
- **What it validates:** Two parallel requests with different sessionIds maintain independent state
- **Tier:** 3
- **Prevents:** Session state corruption under concurrent load
- **Status:** NEW

#### T3-CONC-02: Concurrent requests to same session serialize correctly
- **What it validates:** Two rapid requests to same session don't produce garbled conversation history
- **Tier:** 3
- **Prevents:** Race condition: both requests read same history, both append, one overwrites the other
- **Status:** NEW

#### T3-CONC-03: SSE client disconnect is handled gracefully
- **What it validates:** Client closing connection mid-stream doesn't crash server or leak resources
- **Tier:** 3
- **Prevents:** Server resource leak per disconnected client, eventual OOM
- **Status:** NEW

### 6.2 Performance

#### T3-PERF-01: getMetricTotals completes within 500ms for large GL
- **What it validates:** Performance of filtered metric computation with 100+ subcategories
- **Tier:** 3
- **Prevents:** Dashboard cards take >2s to load, user perceives system as broken
- **Status:** NEW

#### T3-PERF-02: getAllSubcatData completes within 1s
- **What it validates:** Loading 6 metric files × 100+ subcats doesn't cause noticeable delay
- **Tier:** 3
- **Prevents:** Context building blocks the streaming response start
- **Status:** NEW

#### T3-PERF-03: buildContext output stays under 10KB
- **What it validates:** Context string size is bounded, doesn't explode with large GLs
- **Tier:** 3
- **Prevents:** Context exceeds LLM token limit, request fails or gets truncated
- **Status:** NEW

### 6.3 Data Integrity

#### T3-DATA-01: CTC(bps) values sum to approximately total change
- **What it validates:** Sum of all subcat CTC bps ≈ total WoW/YoY bps (within 5%)
- **Tier:** 3
- **Prevents:** CTC attribution doesn't add up — executives notice and lose trust
- **Status:** NEW

#### T3-DATA-02: Cross-metric consistency: GMS = Units × ASP
- **What it validates:** For each subcat, GMS ≈ ShippedUnits × ASP (within reasonable rounding)
- **Tier:** 3
- **Prevents:** Inconsistent metrics confuse analysts trying to reconcile
- **Status:** NEW

#### T3-DATA-03: GL-filtered totals ≤ ALL totals
- **What it validates:** Filtered GL metrics never exceed the ALL total
- **Tier:** 3
- **Prevents:** Impossible numbers (GL > total portfolio) destroy credibility
- **Status:** NEW

### 6.4 Regression Guards

#### T3-REG-01: Fix data-accuracy.test.js failures (46 tests)
- **What it validates:** The 46 currently-failing tests in suite 3, root-caused and either fixed or marked as known data gaps
- **Tier:** 3
- **Prevents:** Ongoing CI noise masking real regressions
- **Status:** EXISTING (broken). Needs investigation — likely data format mismatch, not code bugs.

#### T3-REG-02: Enable gl-metric-accuracy.test.js with fixture data
- **What it validates:** GL-level accuracy tests running against deterministic fixtures instead of missing real data
- **Tier:** 3
- **Prevents:** Critical revenue-weighted averaging bug going undetected
- **Status:** EXISTING (skipped). Needs fixture generation or sample data setup.

### 6.5 Input Sanitization

#### T3-SEC-01: Path traversal prevention in week/GL parameters
- **What it validates:** Week param like `../../etc/passwd` or GL like `../../../secret` can't read arbitrary files
- **Tier:** 3
- **Prevents:** Path traversal attack reading files outside data directory
- **Status:** NEW

#### T3-SEC-02: Session ID injection
- **What it validates:** Session IDs with path separators (`../admin`) can't write to arbitrary paths
- **Tier:** 3
- **Prevents:** Arbitrary file write via crafted session save
- **Status:** NEW

#### T3-SEC-03: Very long input strings don't cause DoS
- **What it validates:** 100KB question string doesn't crash or hang the server
- **Tier:** 3
- **Prevents:** Denial of service via oversized request
- **Status:** NEW

---

## 7. Coverage Summary

### 7.1 Already Covered by Existing Tests

| Area | Files | Quality |
|------|-------|---------|
| `safeDivide`, `safeReadExcel` pure helpers | `tools.test.js`, `tools.fixture.test.js` | ✅ Good |
| `getDataFreshness` week parsing & warnings | `tools.test.js`, `tools.fixture.test.js` | ✅ Good |
| `detectFileLayout` (implicit) | `data-accuracy.test.js` | ⚠️ Implicit, needs explicit tests |
| Malformed Excel/YAML handling | `tools.fixture.test.js` | ✅ Good |
| Zero/null value handling | `tools.fixture.test.js` (edge-cases fixtures) | ✅ Adequate |
| Metric detection from headers/filenames | `metric-detection.test.js` | ✅ Good (29 tests) |
| Column mapping accuracy (GMS, Units, ASP, NPPM, CM) | `data-accuracy.test.js` | ⚠️ 46/113 failing — data-dependent |
| GL-level metric accuracy (cross-metric denominator) | `gl-metric-accuracy.test.js` | ❌ Skipped — blocked on data |
| `listWeeks`, `listGLs` basic shape | `tools.test.js` | ✅ Adequate |
| `getMetricDrivers` null-param handling | `tools.test.js` | ✅ Good |
| `getAllSubcatData` basic shape | `tools.test.js` | ⚠️ Minimal — no metric completeness check |
| `searchSubcats` basic shape | `tools.test.js` | ⚠️ Minimal — no result correctness check |

### 7.2 NOT Covered (Gaps — What Agent 4 Should Write)

**Priority order for maximum risk reduction:**

1. **`server.js` API endpoint tests** (T1-API-01 through T1-API-11) — The biggest gap. 20+ endpoints with zero tests. Use `supertest` or direct HTTP against Express `app`.

2. **`AnalysisSession` unit tests** (T2-SESS-01 through T2-SESS-08) — GL detection, context building, history management. These are the brains of the system.

3. **Session CRUD integration tests** (T1-SESS-01 through T1-SESS-03, T2-PERS-01 through T2-PERS-04) — Save/load/export/reset lifecycle.

4. **GL mapping correctness** (T1-DATA-05, T1-DATA-06, T1-DATA-07) — GL filtering is the foundation; wrong mapping means all GL-specific data is wrong.

5. **Fixture-based metric computation** (T1-DATA-01, T1-DATA-02, T1-DATA-03, T1-DATA-04) — Self-contained versions of currently-broken/skipped data-accuracy tests.

6. **Format template CRUD** (T2-FMT-01 through T2-FMT-03) — Small surface area, easy to test.

7. **LLM abstraction** (T2-LLM-01 through T2-LLM-04) — Config/validation only (don't call actual LLM in tests).

8. **Error handling & security** (T1-ERR-01, T1-ERR-02, T3-SEC-01 through T3-SEC-03) — Critical for production.

### 7.3 Existing Tests That Need Strengthening

| Test File | Issue | Recommendation |
|-----------|-------|----------------|
| `data-accuracy.test.js` | 46 failures due to data-dependent subcat lookups | Root-cause: subcats expected in tests don't exist in wk05/pc/ data. Either update expected values or create fixture data that matches. |
| `gl-metric-accuracy.test.js` | Entirely skipped (needs wk06 data) | Create synthetic fixture data matching expected structure, or automate `bootstrap-data.js` in test setup. |
| `tools.test.js` integration section | Depends on whatever data happens to exist at runtime | Add fixture-based equivalents that are self-contained and deterministic. |
| `tools.fixture.test.js` | Tests Excel parsing but not metric *computation* through fixtures | Add fixture tests that call `getMetricTotals`, `getMetricDrivers`, `getAllSubcatData` against mock data and assert computed values. |

### 7.4 Test Infrastructure Recommendations

1. **Add `supertest` to agent dependencies** — Enables HTTP-level endpoint testing without starting the server.
2. **Create a test helper for session setup** — Factory function that creates a session with known state (GL, week, history).
3. **Expand mock data fixtures** — Current fixtures in `agent/test/fixtures/mock-data/2099-wk01/gl/testgl/` only have 3 subcategories. Add a second GL (`testgl2`) with different subcats to test GL filtering.
4. **Add a `_manifest.yaml` for `all` GL** in fixtures — Needed to test `resolveGLDataFolder` ALL-with-filter path.
5. **Consider adding `vitest` to dashboard** — Lightest path to frontend testing. But frontend tests are Tier 3 priority — focus on backend first.
6. **CI gate**: Tests should run in `npm test` and block merges. The 46 failing tests in suite 3 need to be either fixed or moved to a separate "accuracy" suite that's run manually.

### 7.5 Test Count Summary

| Category | New Tests | Existing (Good) | Existing (Needs Work) | Total |
|----------|-----------|------------------|-----------------------|-------|
| Tier 1 — Ship Blockers | 17 | 3 | 2 | 22 |
| Tier 2 — Production Confidence | 28 | 1 | 1 | 30 |
| Tier 3 — Hardening | 10 | 0 | 2 | 12 |
| **Total** | **55** | **4** | **5** | **64** |

Plus the existing 145 passing tests = **~210 total tests** at full coverage.

---

*End of test design. No test code has been generated. This document is the input for Agent 4 (test writer).*
