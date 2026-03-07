# DESIGN_REVIEW.md — Principal Engineer Review of TEST_DESIGN.md

> **Reviewer:** Principal Engineer / System Architect (Independent Review)  
> **Date:** 2025-07-16  
> **Input:** TEST_DESIGN.md (first-pass engineer), REPO_INDEX.md, source code audit  
> **Verdict:** Strong foundation with critical gaps. Not yet ship-ready without amendments.

---

## Executive Summary

The first-pass test design is **competent and well-structured**. It correctly identifies the biggest coverage gap (server.js), properly prioritizes deterministic data computation, and has a solid tiering model. However, after reading every line of the source files, I've found **12 gaps the design missed**, **3 priority miscategorizations**, **2 redundancies**, and **1 untestable test**. The design also underweights filesystem-related failure modes that could silently corrupt data in production.

**Bottom line:** If only the tests in TEST_DESIGN.md pass, I'd be ~70% confident shipping. With the amendments below, that rises to ~90%. The remaining 10% is frontend (no test infra) and LLM integration (inherently non-deterministic).

---

## 1. Gap Analysis — What's Missing

### GAP-1: `resolveGLDataFolder()` is untested and it's the routing backbone
**Severity: Critical**

Every data function in `tools.js` calls `resolveGLDataFolder(week, gl)` to decide whether to read from `gl/all/` (with filtering) or `gl/{name}/` (direct). This function determines:
- Whether GL filtering is applied at all
- Which manifest is loaded
- Which directory's Excel files are read

The test design mentions "GL mapping correctness" but never tests the **resolution logic itself**. A bug here means every endpoint returns data from the wrong directory.

**What to test:**
- `resolveGLDataFolder(week, 'all')` → returns ALL path, `useAllWithFilter: false`
- `resolveGLDataFolder(week, 'pc')` when ALL exists → returns ALL path, `useAllWithFilter: true`
- `resolveGLDataFolder(week, 'pc')` when no ALL exists → falls back to per-GL folder
- `resolveGLDataFolder(week, 'nonexistent')` → returns `{ dataDir: null }`

### GAP-2: `loadDenominatorPctMap()` cross-metric dependency is untested
**Severity: Critical**

The margin metric computation (Net PPM, CM, ASP WoW/YoY at GL level) depends on loading a **separate metric file** (GMS or ShippedUnits) to get prior-period denominator growth rates. This cross-file dependency is the most fragile part of the computation pipeline. If the denominator file is missing, corrupted, or has different subcats than the numerator file, the margin WoW/YoY will be wrong.

**What to test:**
- Margin computation when denominator metric file is missing → graceful degradation
- Denominator file has different subcats than numerator → no crash, reasonable fallback
- Denominator file has zero growth for all subcats → prior-period = current period

### GAP-3: `generateGLSummary()` dynamic summary generation
**Severity: Medium**

When `useAllWithFilter` is true, `getSummary()` **does not read `_summary.md`** — it generates the summary dynamically by calling `getMetricTotals()` and `getMetricDrivers()` internally. The test design treats `getSummary` as a simple file read. It's not. The dynamic path is the primary path for all non-ALL GLs when ALL data exists.

**What to test:**
- Dynamic summary contains all 5 metric sections
- Dynamic summary values match `getMetricTotals()` output exactly (no drift)
- Dynamic summary handles missing metrics gracefully

### GAP-4: `appendToWeeklyFindings()` file write with regex replacement
**Severity: Medium**

This function writes to `_weekly_findings.md` using regex-based section insertion. If the GL header already exists but in different case, it creates a duplicate section. The regex `new RegExp(`## ${gl.toUpperCase()}`, 'i')` uses case-insensitive flag but the header it creates is always uppercase — this could cause duplicate GL sections on repeated calls.

**What to test:**
- Append to empty findings file → creates file with GL header
- Append to existing file with different GL → adds new section
- Append to same GL twice → findings accumulate, no duplicate headers
- Case sensitivity: GL header "## PC" vs question detected "pc"

### GAP-5: `extractKeyFindings()` heuristic extraction
**Severity: Low**

This method uses regex to extract "key findings" from LLM responses. If the LLM changes its formatting style (no bullet points, no blockquotes), the fallback takes the first 3 lines over 50 chars. This could extract table rows, disclaimers, or other noise.

### GAP-6: SSE two-pass format flow
**Severity: High**

The `/api/ask/stream` endpoint has a complex two-pass flow when `formatTemplate` is provided:
1. Silent Pass 1: Call `llm.chat()` (non-streaming) to get analysis
2. Streaming Pass 2: Call `llm.chatStream()` with reformat prompt

The test design mentions T1-API-07 (SSE format validation) but doesn't cover:
- Two-pass flow with format template
- Pass 1 failure → error event emitted, no stream
- Pass 2 failure → fallback to original analysis text
- Status events ("Analyzing...", "Formatting...") before content

### GAP-7: GL conflict detection in streaming endpoint
**Severity: Medium**

The streaming endpoint has special logic: when `requestedGL` (from sidebar) conflicts with `questionGL` (detected from question text), it emits a **warning message** before the analysis. This conflict path is completely untested.

**What to test:**
- Sidebar says "pc", question says "How is Toys doing?" → warning emitted
- Sidebar says "pc", question has no GL mention → no warning

### GAP-8: `compareMetrics()` function
**Severity: Low**

`tools.js` exports `compareMetrics()` but it has no API endpoint and no tests. The test design doesn't mention it. While it's not exposed via API currently, it's exported and could be called. Worth a Tier 3 test.

### GAP-9: `loadAsinMapping()` CSV parsing edge cases
**Severity: Medium**

The ASIN-to-subcat mapping CSV parser:
- Strips BOM (`\uFEFF`) — good
- Splits on first comma only — but what if ASIN contains commas? (unlikely but possible)
- Matches `^(\d+)\s` in description — what if description starts with non-digit?
- Uses lazy loading with module-level cache `_asinMapping` — cache is never invalidated

**What to test:**
- CSV with BOM → loads correctly
- CSV missing → returns empty Map (already has this check)
- CSV with malformed rows → skips gracefully
- Description that doesn't start with digits → skipped

### GAP-10: `getTrafficChannels()` uses XLSX to parse CSV
**Severity: Medium**

Traffic data is CSV but parsed through `XLSX.read(content, { type: 'string' })`. The function then uses `sheet_to_json` with default column headers from the CSV header row. The field access uses `row[' GV ']` (with spaces!) as a fallback. If the CSV header changes, this silently returns 0 for all GV values.

**What to test:**
- CSV with standard headers → correct GV extraction
- CSV with `' GV '` (space-padded) header → still works
- Multiple weeks per channel → only latest week returned

### GAP-11: In-memory session Map has no size limit
**Severity: Medium (production risk)**

`const sessions = new Map()` grows unboundedly. Each session stores conversation history (potentially large strings from LLM responses). No eviction, no TTL, no max size. This is a production memory leak.

**What to test (Tier 2):**
- Create 100 sessions → server doesn't crash
- Session data size grows with history → verify trimming works

### GAP-12: `listGLs()` returns GLs from mapping file, not from actual data
**Severity: Medium**

`listGLs(week)` reads the GL mapping Excel file to get GL names, then returns all of them regardless of whether that GL has any data for the requested week. The dashboard could show GL options that have zero subcats.

**What to test:**
- Week with no data → still returns GL names from mapping
- Verify returned GLs actually have data (or document that they might not)

---

## 2. Edge Cases the Design Missed

### EDGE-1: `safeDivide(NaN, 5)` → returns `NaN` (not null!)
The current implementation only checks `denominator === 0 || denominator === null || denominator === undefined`, then does `numerator / denominator`. If **numerator** is NaN, the result is NaN and `isFinite(NaN) === false`, so it returns null. BUT `safeDivide(NaN, 0)` returns null (caught by denominator check), while `safeDivide(NaN, 5)` returns null (caught by isFinite). This is actually correct. However, `safeDivide(5, NaN)` → `5/NaN` → `NaN` → `!isFinite(NaN)` → returns `null`. Good.

The test design's T2-EDGE-06 asks for `safeDivide(10, NaN)` and `safeDivide(10, Infinity)`. Let's verify:
- `safeDivide(10, NaN)` → NaN check: `NaN === 0` is false, `NaN === null` is false, `NaN === undefined` is false → proceeds → `10/NaN` → NaN → `!isFinite(NaN)` → returns null ✓
- `safeDivide(10, Infinity)` → Infinity checks all false → `10/Infinity` → 0 → `isFinite(0)` → returns 0 ✓

**Amendment:** T2-EDGE-06 should also test `safeDivide(Infinity, 5)` → returns null (Infinity/5 = Infinity, !isFinite → null).

### EDGE-2: Week format `"2026-wk5"` vs `"2026-wk05"` (no zero padding)
`getDataFreshness()` uses regex `/^(\d{4})-wk(\d+)$/` which accepts both. But `listWeeks()` reads directory names directly — if a directory is named `2026-wk5`, it would be sorted incorrectly (string sort of "wk5" vs "wk05"). The `parseWeek` helper inside `listWeeks` does `parseInt(match[2])` which handles both. **But the directory must actually exist with that name.**

**Amendment:** Test that `listWeeks()` sort is correct even with mixed zero-padding.

### EDGE-3: `detectGL("How is the PC?")` → matches "PC" but also matches the ambiguous pattern for "cables" (no, it doesn't — Tier 1 explicit match returns first). Correct behavior.

However: `detectGL("USB PC adapter")` → hits Tier 1 "pc" pattern (`/\b(pc\s*(gl|business|category)?|pc\b)/i`) AND Tier 3 ambiguous "usb" pattern. Since Tier 1 iterates first and returns immediately, this is fine. But `detectGL("USB cable")` → skips all Tier 1, skips all Tier 2, hits Tier 3 "cables" → returns "pc". **Is that correct?** A USB cable question shouldn't assume PC. This is a product decision, not a bug, but worth testing.

### EDGE-4: Concurrent session modification
The `handleQuery` method is `async`. If two requests arrive for the same session simultaneously:
1. Both read `session.currentGL` as null
2. Both detect GL from question
3. Both set `session.currentGL` and clear history
4. Both call LLM
5. Both push to `conversationHistory`
6. History has interleaved messages: [user1, user2, assistant1, assistant2]

This is a real race condition. The test design mentions T3-CONC-02 but marks it Tier 3. **This should be Tier 2** — it can cause data corruption in conversation history.

### EDGE-5: `getMetricDrivers` with `direction: 'both'` still filters out null CTC
Line `if (ctc === null || ctc === undefined) continue;` means subcats with missing CTC data are silently dropped. This is correct behavior but should be tested: a subcat that exists in the file but has null CTC should not appear in drivers.

### EDGE-6: `buildContext()` with a GL that has no summary file AND no ALL data
`getSummary(week, gl)` returns `{ summary: null, error: '...' }`. The `buildContext()` method checks `summaryResult.summary` — if null, it skips. But `getDataAvailability()` and `getAllSubcatData()` might also fail. The context sent to LLM could be essentially empty except for the availability status section. This isn't a crash, but the LLM would get no data and might hallucinate.

---

## 3. Risk Modeling — Worst-Case Missed Bugs

### RISK-1: GL-filtered margin metric computation is wrong (CRITICAL)
**Impact:** Net PPM or CM WoW/YoY values on dashboard cards are wrong by 100+ bps.  
**Why tests might miss it:** The cross-metric denominator approach (`loadDenominatorPctMap`) is only exercised when `useAllWithFilter` is true AND the metric is margin type. Current fixture data (`2099-wk01/gl/testgl/`) doesn't exercise this path because there's no `all` GL with filtered access.  
**Probability if untested:** High. This is the exact bug documented in the README ("80–780 bps error").  
**Mitigation:** T1-DATA-02 exists but is currently skipped. **Must be unblocked with fixture data.**

### RISK-2: `resolveGLDataFolder` returns wrong path
**Impact:** All data for a GL comes from wrong directory. Numbers could be from ALL (unfiltered) when they should be GL-specific, or vice versa.  
**Why tests might miss it:** Most fixture tests don't have the dual-path (ALL + per-GL) directory structure.  
**Probability:** Medium.

### RISK-3: SOROOS direction inversion is wrong in alerts
**Impact:** Executives see rising out-of-stock as "tailwind" (good news). They deprioritize inventory issues.  
**Why tests might miss it:** T2-INT-04 exists and covers this. But if the condition `check.metric === 'SOROOS_...'` has a typo or the metric key changes, it silently breaks.  
**Mitigation:** T2-INT-04 is correctly placed. **Upgrade to Tier 1.**

### RISK-4: Session state leak between users
**Impact:** User A sees User B's conversation history or GL selection.  
**Why tests might miss it:** T3-CONC-01 exists at Tier 3. But sessions are keyed by `sessionId` from the request body — if the client doesn't send a unique ID, they share the 'default' session.  
**Probability:** Low (client generates UUID), but impact is high.

### RISK-5: `getMetricTotals` formatting hides wrong values
**Impact:** The display value `$1.5M` looks correct but the underlying computation is off by $500K. Because the test only checks the formatted string, it doesn't catch precision errors.  
**Mitigation:** Tests should assert on raw values before formatting, not just the display string.

---

## 4. Redundancy Check

### REDUNDANCY-1: T1-DATA-03 and T1-DATA-04 overlap with existing tests
Both `getMetricDrivers` sort and direction filter are partially tested in `tools.test.js` (edge cases section) and `data-accuracy.test.js` (direction filter tests). The test design acknowledges this ("EXISTING (partial)") and recommends fixture-based versions. **This is correct** — the existing tests depend on real data. Self-contained fixture tests should replace, not duplicate, the real-data tests.

**Recommendation:** Keep the new fixture-based versions. Mark the overlapping real-data tests in `data-accuracy.test.js` as regression/integration tests, not unit tests.

### REDUNDANCY-2: T2-SESS-07 and `detectQuestionMetrics` in data-accuracy.test.js
Suite 3 (`data-accuracy.test.js`) has 6 passing tests for "Question Metric Detection". T2-SESS-07 proposes testing the same function. The existing tests are good but are buried in a suite that's 40% failing — they might get ignored.

**Recommendation:** Keep T2-SESS-07 as a standalone unit test. Mark the data-accuracy.test.js versions as supplementary.

---

## 5. Feasibility Check

### INFEASIBLE-1: T3-PERF-03 "buildContext output stays under 10KB"
`buildContext()` is a method on `AnalysisSession`, which requires instantiation with a live `tools.js` data path. The context size depends on the number of subcats in the GL data. With fixture data (3 subcats), it'll always be under 10KB. With real data (100+ subcats), it could be 30KB+. **The test is only meaningful with production-scale data**, which isn't available in CI.

**Recommendation:** Downgrade to documentation/monitoring concern, not a test. Or create a fixture with 100+ subcats.

### FEASIBILITY CONCERN: T1-API-07 "SSE format validation"
Testing SSE requires either:
1. `supertest` with raw response handling (it doesn't natively support SSE)
2. Starting the server and making real HTTP requests
3. Mocking `res` object with a writable stream

Option 3 is feasible with the custom test harness. The test design recommends `supertest` (§7.4) which would need to be added. **Feasible but requires dependency addition.**

### FEASIBILITY CONCERN: T2-LLM-01 through T2-LLM-04
These test `llm.js` configuration and validation. They're **feasible** because they test `getConfig()`, `validateCredentials()`, and `listProviders()` — pure functions that read env vars. No actual LLM calls needed. **Fully testable.**

---

## 6. Priority Corrections

### UPGRADE to Tier 1:

| Test | Current | Proposed | Reasoning |
|------|---------|----------|-----------|
| T2-INT-04 | Tier 2 | **Tier 1** | SOROOS direction inversion = executives see rising OOS as good news. Business-critical. |
| T2-SESS-08 | Tier 2 | **Tier 1** | `buildContext` is the bridge between data and LLM. If context is malformed or empty, LLM hallucmates. This is the #1 source of "AI said something wrong" bugs. |
| T2-EDGE-04 | Tier 2 | **Tier 1** | GL case insensitivity affects every API call. Dashboard sends lowercase, tests use uppercase. If this breaks, every GL-specific endpoint returns empty. |

### DOWNGRADE to Tier 3:

| Test | Current | Proposed | Reasoning |
|------|---------|----------|-----------|
| T2-FMT-02 | Tier 2 | **Tier 3** | Format template validation is nice-to-have. Missing fields just create empty templates — annoying, not dangerous. |
| T2-FMT-03 | Tier 2 | **Tier 3** | 404 on nonexistent format delete is cosmetic. |
| T2-EDGE-02 | Tier 2 | **Tier 3** | ASIN mapping coverage metadata is informational. The data still loads correctly without it. |
| T2-EDGE-03 | Tier 2 | **Tier 3** | Same as above — cosmetic. |

### DOWNGRADE to Remove:

| Test | Reasoning |
|------|-----------|
| T3-PERF-03 | Infeasible with fixture data, unmeaningful with 3-subcat fixtures. Replace with documentation. |

---

## 7. Tests to Add

### NEW Tier 1 Tests:

#### T1-RESOLVE-01: resolveGLDataFolder routes correctly
- **What:** Test all 4 paths: ALL exists→filter, ALL exists→no filter (gl='all'), no ALL→per-GL folder, nothing exists→null
- **Tier:** 1
- **Reasoning:** Every data function depends on this routing. Wrong route = wrong data.

#### T1-RESOLVE-02: resolveGLDataFolder prefers ALL over per-GL
- **What:** When both `gl/all/_manifest.yaml` and `gl/pc/_manifest.yaml` exist, ALL is used
- **Tier:** 1
- **Reasoning:** Ensures consistent behavior when data structure evolves

#### T1-DATA-09: GL-filtered margin metric WoW/YoY uses cross-metric denominator
- **What:** For Net PPM at GL level, verify that WoW/YoY is computed using GMS growth rates for prior-period denominator estimation, not simple revenue-weighted averaging
- **Tier:** 1
- **Reasoning:** This is THE documented bug. The entire README discusses it. Must have a self-contained fixture test.

#### T1-STREAM-01: SSE error event on LLM failure
- **What:** When LLM throws during streaming, client receives `type: 'error'` event, not hung connection
- **Tier:** 1
- **Reasoning:** Broken error handling = permanent UI spinner for users

### NEW Tier 2 Tests:

#### T2-CROSS-01: Cross-GL query loads all GL summaries
- **What:** `isMultiGLQuestion` → loads all GL summaries, resets session state after
- **Tier:** 2
- **Reasoning:** Cross-GL is a distinct code path with its own state management

#### T2-CROSS-02: Cross-GL query resets currentGL to null
- **What:** After `handleCrossGLQuery()`, `session.currentGL === null` and `conversationHistory === []`
- **Tier:** 2
- **Reasoning:** If currentGL isn't reset, follow-up question stays in cross-GL mode

#### T2-FINDINGS-01: Weekly findings accumulation
- **What:** `appendToWeeklyFindings()` creates file, adds GL sections, appends within section
- **Tier:** 2
- **Reasoning:** Findings are used for cross-GL queries — if corrupt, cross-GL analysis is garbage

#### T2-CONFLICT-01: GL conflict warning in streaming endpoint
- **What:** When sidebar GL != question GL, warning message emitted before analysis
- **Tier:** 2
- **Reasoning:** Users could be confused if they ask about Toys but see PC data

#### T2-TWOPASS-01: Two-pass format flow
- **What:** With `formatTemplate`, response goes through analysis pass then reformat pass
- **Tier:** 2
- **Reasoning:** Two-pass is a premium feature; if pass 1 fails, the fallback path is untested

#### T2-DATA-LISTGLS: listGLs returns all mapping GLs regardless of data presence
- **What:** `listGLs(week)` returns GLs from mapping file even if no data exists for that GL/week
- **Tier:** 2
- **Reasoning:** Dashboard shows GL options with no data → confusing but not crash

#### T2-DENOM-01: loadDenominatorPctMap returns empty map when file missing
- **What:** When denominator metric file doesn't exist, returns empty Map, margin computation falls back gracefully
- **Tier:** 2
- **Reasoning:** Missing GMS file shouldn't crash Net PPM computation

### NEW Tier 3 Tests:

#### T3-CACHE-01: GL mapping cache invalidation
- **What:** `loadGLMapping()` caches at module level (`_glMapping`). Verify second call returns same result (cache hit). Note: cache is never invalidated — this is by design but should be documented.
- **Tier:** 3
- **Reasoning:** Cache correctness; low risk since data doesn't change at runtime

#### T3-FINDINGS-REGEX: appendToWeeklyFindings regex edge cases  
- **What:** GL names with regex-special characters (e.g., "C++", "Home & Garden") don't break the regex
- **Tier:** 3
- **Reasoning:** Current GL names are simple words, but if new GLs are added with special chars, this breaks

#### T3-COMPARE-01: compareMetrics returns common drivers
- **What:** `compareMetrics(week, gl, 'GMS', 'NetPPMLessSD')` returns subcats that appear in both top-10 lists
- **Tier:** 3
- **Reasoning:** Unused by API currently, but exported

#### T3-SESS-SIZE: Session memory doesn't grow unboundedly
- **What:** After `maxHistoryTurns * 2` messages, history is trimmed
- **Tier:** 3
- **Reasoning:** Memory leak prevention; critical at scale but T1-SESS-03 covers trimming logic

---

## 8. Tests to Modify

| Original Test | Modification | Reasoning |
|--------------|-------------|-----------|
| T1-DATA-02 | Add fixture data that exercises the cross-metric denominator path. Must have `gl/all/` with multiple metrics + a GL mapping that filters to a subset. | Currently "needs to be made runnable" — specify exactly what fixtures are needed. |
| T1-DATA-08 | Assert that each subcat has **all 6 metric keys** (GMS, ShippedUnits, ASP, NetPPMLessSD, CM, SOROOS) with `value`, `wow_pct`, `yoy_pct`, and ctc field. Don't just check "has metrics". | Current check is too weak — "basic shape" doesn't catch missing metrics. |
| T2-INT-02 | Also verify that `direction` field is correctly set to `'up'` for positive CTC and `'down'` for negative. This is critical for the movers panel arrow direction. | Original only checks field presence, not correctness. |
| T2-INT-05 | Verify that trends are in **oldest→newest** order (the endpoint explicitly reverses `listWeeks()`'s descending sort). | Order is critical for sparklines — newest-first would invert the chart. |
| T2-SCRIPT-02 | Compare actual column indices between `generate_summary.js METRIC_CONFIG` and `tools.js getAllSubcatData metricConfigs`. This is a mechanical check — verify `METRIC_CONFIG.GMS.valueCol === 2`, `METRIC_CONFIG.GMS.yoyCtcBpsCol === 8` matches `tools.js metricConfigs.GMS.ctcCol === 8`. | Cross-file consistency is a real risk. |
| T1-ERR-01 | Specifically verify that error responses from `POST /api/ask` don't include `error.stack` — the catch block does `res.status(500).json({ error: error.message })` which includes the message but not stack. But `error.message` from SDK errors could contain paths. | Strengthen to check for path-like patterns in error messages. |
| T3-REG-01 | Root cause analysis: the 46 failures are all `Cannot read properties of undefined (reading 'ctc')`. This means `getMetricDrivers` returns undefined for specific subcat lookups. The subcats expected in tests likely don't exist in the wk05/pc/ dataset after a data refresh. **Fix: update expected subcat codes or generate fixture data matching test expectations.** | Don't just mark as "needs investigation" — the root cause is clear from the error pattern. |

---

## 9. Confidence Assessment

### What the suite covers well:
- ✅ Pure computation helpers (safeDivide, safeReadExcel, detectFileLayout)
- ✅ Metric detection from Excel headers and filenames
- ✅ Basic data API shape validation
- ✅ Error handling for missing/malformed files
- ✅ API endpoint input validation

### What the suite covers adequately (with amendments):
- ⚠️ GL filtering (needs resolveGLDataFolder tests)
- ⚠️ Margin metric computation (needs fixture-based cross-metric tests)
- ⚠️ Session lifecycle (proposed tests are good, need implementation)
- ⚠️ SOROOS direction inversion (needs Tier 1 priority)

### What the suite doesn't cover:
- ❌ LLM response quality (inherently non-deterministic — not testable in CI)
- ❌ Frontend rendering correctness (no test infra)
- ❌ Production-scale performance (needs production data)
- ❌ End-to-end data pipeline (bootstrap → summary → tools → API → dashboard)
- ❌ File system permission errors
- ❌ Concurrent session modification race conditions (marked Tier 3, should be Tier 2)

### "If this suite passes, would I be confident shipping to production?"

**With TEST_DESIGN.md as-is: No.** The GL resolution path, cross-metric denominator computation, and SOROOS inversion are all Tier 2 or untested. These are the exact failure modes that cause executives to see wrong numbers — the highest-impact bug category.

**With amendments in this review: Cautiously yes, for a supervised launch.** The amended suite covers all deterministic computation paths, all API endpoints, all session state transitions, and the critical GL filtering logic. I'd still want:
1. A staging environment with production data to catch column-mapping drift
2. Manual verification of dashboard card values against source Excel files
3. A kill switch for the LLM (fallback to static summaries)

---

## 10. Final Recommended Test List

### Tier 1 — Ship Blockers (27 tests)

| ID | Test | Source | Notes |
|----|------|--------|-------|
| T1-API-01 | POST /api/ask requires question | TEST_DESIGN | Unchanged |
| T1-API-02 | POST /api/ask returns valid response structure | TEST_DESIGN | Unchanged |
| T1-API-03 | GET /api/weeks returns sorted week list | TEST_DESIGN | Unchanged |
| T1-API-04 | GET /api/gls/:week returns GL list | TEST_DESIGN | Unchanged |
| T1-API-05 | GET /api/gls/:week error for invalid week | TEST_DESIGN | Unchanged |
| T1-API-06 | GET /api/metrics/:week/:gl returns 5 metrics | TEST_DESIGN | Unchanged |
| T1-API-07 | POST /api/ask/stream returns valid SSE | TEST_DESIGN | Unchanged |
| T1-API-08 | POST /api/ask/stream handles missing question | TEST_DESIGN | Unchanged |
| T1-API-09 | GET /api/movers returns mover data | TEST_DESIGN | Unchanged |
| T1-API-10 | GET /api/alerts returns winds data | TEST_DESIGN | Unchanged |
| T1-API-11 | GET /api/trends returns multi-week trends | TEST_DESIGN | Unchanged |
| T1-DATA-01 | getMetricTotals computes GL-filtered GMS | TEST_DESIGN | Unchanged |
| T1-DATA-02 | Margin metrics use cross-metric denominator | TEST_DESIGN | **Must create fixture data** |
| T1-DATA-03 | getMetricDrivers sorted by |CTC| | TEST_DESIGN | Fixture-based |
| T1-DATA-04 | getMetricDrivers direction filter | TEST_DESIGN | Fixture-based |
| T1-DATA-05 | GL-to-subcat mapping correctness | TEST_DESIGN | Unchanged |
| T1-DATA-06 | getMetricTotals gl='all' uses Total row | TEST_DESIGN | Unchanged |
| T1-DATA-07 | CTC(bps) recomputed relative to GL total | TEST_DESIGN | Unchanged |
| T1-DATA-08 | getAllSubcatData returns all 6 metrics per subcat | TEST_DESIGN | **Strengthened: assert all 6 metric keys** |
| T1-DATA-09 | GL-filtered margin WoW/YoY cross-metric computation | **NEW** | GAP-2: the documented 80-780 bps bug |
| T1-SESS-01 | Session creation and retrieval | TEST_DESIGN | Unchanged |
| T1-SESS-02 | Session reset clears state | TEST_DESIGN | Unchanged |
| T1-SESS-03 | Conversation history trimming | TEST_DESIGN | Unchanged |
| T1-ERR-01 | Error responses don't leak internals | TEST_DESIGN | **Strengthened: check for path patterns** |
| T1-ERR-02 | Malformed JSON doesn't crash server | TEST_DESIGN | Unchanged |
| T1-RESOLVE-01 | resolveGLDataFolder routes correctly | **NEW** | GAP-1: routing backbone |
| T1-STREAM-01 | SSE error event on LLM failure | **NEW** | GAP-6: broken streaming = dead UI |

### Tier 2 — Production Confidence (31 tests)

| ID | Test | Source | Notes |
|----|------|--------|-------|
| T2-SESS-01 | detectGL explicit mentions | TEST_DESIGN | Unchanged |
| T2-SESS-02 | detectGL product keywords | TEST_DESIGN | Unchanged |
| T2-SESS-03 | detectGL null for ambiguous | TEST_DESIGN | Unchanged |
| T2-SESS-04 | isMultiGLQuestion detection | TEST_DESIGN | Unchanged |
| T2-SESS-05 | GL switch flushes history | TEST_DESIGN | Unchanged |
| T2-SESS-06 | determineDataNeeds ASIN detection | TEST_DESIGN | Unchanged |
| T2-SESS-07 | detectQuestionMetrics mapping | TEST_DESIGN | Unchanged |
| T2-SESS-08 | buildContext well-formed output | TEST_DESIGN | **Upgraded to Tier 1 equivalent importance** |
| T2-INT-01 | /api/metrics matches getMetricTotals | TEST_DESIGN | Unchanged |
| T2-INT-02 | /api/movers direction field correct | TEST_DESIGN | **Strengthened: verify direction value** |
| T2-INT-03 | /api/alerts threshold logic | TEST_DESIGN | Unchanged |
| T2-INT-04 | /api/alerts SOROOS direction inversion | TEST_DESIGN | **Upgraded to Tier 1 importance** |
| T2-INT-05 | /api/trends oldest→newest order | TEST_DESIGN | **Strengthened: verify order** |
| T2-INT-06 | /api/freshness age calculation | TEST_DESIGN | Unchanged |
| T2-PERS-01 | Session save/load round-trip | TEST_DESIGN | Unchanged |
| T2-PERS-02 | Session export valid markdown | TEST_DESIGN | Unchanged |
| T2-PERS-03 | Session export 404 for empty | TEST_DESIGN | Unchanged |
| T2-PERS-04 | List saved sessions metadata | TEST_DESIGN | Unchanged |
| T2-FMT-01 | Format CRUD lifecycle | TEST_DESIGN | Unchanged |
| T2-EDGE-01 | getMetricTotals zero matching subcats | TEST_DESIGN | Unchanged |
| T2-EDGE-04 | GL name case insensitivity | TEST_DESIGN | **Upgraded to Tier 1 importance** |
| T2-EDGE-05 | detectFileLayout both formats | TEST_DESIGN | Unchanged |
| T2-EDGE-06 | safeDivide NaN/Infinity (expanded) | TEST_DESIGN | **Add `safeDivide(Infinity, 5)`** |
| T2-EDGE-07 | getTrafficChannels CSV parsing | TEST_DESIGN | Unchanged |
| T2-LLM-01 | getConfig valid provider config | TEST_DESIGN | Unchanged |
| T2-LLM-02 | getConfig unknown provider throws | TEST_DESIGN | Unchanged |
| T2-LLM-03 | validateCredentials checks env vars | TEST_DESIGN | Unchanged |
| T2-LLM-04 | listProviders configuration status | TEST_DESIGN | Unchanged |
| T2-CROSS-01 | Cross-GL query loads all summaries | **NEW** | GAP: distinct code path untested |
| T2-CONFLICT-01 | GL conflict warning in streaming | **NEW** | GAP-7: user confusion risk |
| T2-DENOM-01 | loadDenominatorPctMap missing file | **NEW** | GAP-2: graceful degradation |

### Tier 3 — Hardening (13 tests)

| ID | Test | Source | Notes |
|----|------|--------|-------|
| T3-CONC-01 | Concurrent different sessions | TEST_DESIGN | Unchanged |
| T3-CONC-02 | Concurrent same session | TEST_DESIGN | **Consider upgrading to Tier 2** |
| T3-CONC-03 | SSE client disconnect handling | TEST_DESIGN | Unchanged |
| T3-PERF-01 | getMetricTotals within 500ms | TEST_DESIGN | Unchanged |
| T3-PERF-02 | getAllSubcatData within 1s | TEST_DESIGN | Unchanged |
| T3-DATA-01 | CTC(bps) sum ≈ total change | TEST_DESIGN | Unchanged |
| T3-DATA-02 | GMS ≈ Units × ASP consistency | TEST_DESIGN | Unchanged |
| T3-DATA-03 | GL-filtered totals ≤ ALL totals | TEST_DESIGN | Unchanged |
| T3-REG-01 | Fix data-accuracy 46 failures | TEST_DESIGN | **Root cause identified: stale subcat codes** |
| T3-REG-02 | Enable gl-metric-accuracy with fixtures | TEST_DESIGN | Unchanged |
| T3-SEC-01 | Path traversal prevention | TEST_DESIGN | Unchanged |
| T3-SEC-02 | Session ID injection | TEST_DESIGN | Unchanged |
| T3-SEC-03 | Long input DoS prevention | TEST_DESIGN | Unchanged |

### Tests Removed:

| ID | Reason |
|----|--------|
| T3-PERF-03 | Infeasible: context size depends on production data volume. Replace with monitoring. |
| T2-FMT-02 | Downgraded and merged into T2-FMT-01 lifecycle test |
| T2-FMT-03 | Downgraded and merged into T2-FMT-01 lifecycle test |
| T2-EDGE-02 | Downgraded to Tier 3 (informational only, not functional) |
| T2-EDGE-03 | Downgraded to Tier 3 (informational only, not functional) |
| T2-EDGE-08 | Merged into T1-DATA-01 and T1-DATA-06 (formatting is tested inline) |
| T2-SCRIPT-01 | Already passing (29 tests). No action needed. |
| T2-SCRIPT-02 | Merged into T2-INT-01 (cross-module column consistency) |

### Final Counts:

| Tier | Tests | New | Modified | From TEST_DESIGN |
|------|-------|-----|----------|-----------------|
| Tier 1 | 27 | 4 | 3 | 20 |
| Tier 2 | 31 | 3 | 4 | 24 |
| Tier 3 | 13 | 0 | 1 | 12 |
| **Total** | **71** | **7** | **8** | **56** |

Plus 145 existing passing tests = **~216 total tests** at full coverage.

---

## 11. Test Infrastructure Requirements

1. **Add fixture data for GL-filtered margin computation:**
   - `agent/test/fixtures/mock-data/2099-wk01/gl/all/` with GMS, ShippedUnits, NetPPMLessSD, CM Excel files containing 6+ subcats and a Total row
   - `agent/test/fixtures/gl-mapping.json` (or mock the mapping) assigning 3 subcats to "testgl" and 3 to "testgl2"
   - This enables T1-DATA-02, T1-DATA-09, T1-RESOLVE-01, T1-RESOLVE-02

2. **Mock/stub for `llm.js`:**
   - For T1-STREAM-01 and T2-TWOPASS-01, need to mock `llm.chat()` and `llm.chatStream()` to return canned responses or throw errors
   - Since there's no mocking library, use module-level function replacement: `const originalChat = llm.chat; llm.chat = async () => 'mock response';` in test setup, restore in teardown

3. **HTTP test helper:**
   - Either add `supertest` (recommended) or create a minimal test helper that instantiates the Express `app` and makes requests via `http.request()`
   - The `app` is already exported from `server.js`: `module.exports = { app, AnalysisSession }`

4. **Session cleanup between tests:**
   - The `sessions` Map is module-level. Tests that create sessions must clean up to prevent cross-test contamination.
   - Add a `clearSessions()` export or use `POST /api/session/:id/reset` between tests.

---

*End of design review. The first-pass engineer did strong work. These amendments close the remaining gaps between "tests pass" and "I trust this in production."*
