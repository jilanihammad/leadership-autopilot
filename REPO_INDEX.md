# REPO_INDEX.md — Leadership Autopilot

> Auto-generated codebase index for test suite generation pipeline.
> Repo: `/Users/jilani/gt/autopilot/refinery/rig`
> 146 tracked files | 30 commits

---

## Tech Stack

| Layer | Technology | Version |
|-------|-----------|---------|
| **Backend** | Node.js, Express.js | Express 4.18 |
| **Frontend** | Next.js, React 19, TypeScript | Next 16.1 |
| **Styling** | Tailwind CSS 3.4, shadcn/ui | — |
| **Charts** | Recharts 2.15 | — |
| **Data parsing** | SheetJS (xlsx 0.18), YAML 2.3 | — |
| **LLM** | Anthropic SDK, OpenAI SDK, Google Generative AI, AWS Bedrock | Multi-provider |
| **Streaming** | Server-Sent Events (SSE) | — |
| **Test framework** | Custom (no framework — vanilla Node.js `test()` harness) | — |
| **Package mgmt** | npm (root + agent + scripts), pnpm (dashboard lockfile present) | — |

---

## Project Overview

AI-powered Weekly Business Review (WBR) analysis assistant. Ingests Excel metric files (GMS, margins, units, ASP) by product subcategory, and answers natural language business questions with data-backed CTC (contribution-to-change) attribution. Two main subsystems:

1. **Agent API** (Express, port 3456) — deterministic data extraction from Excel + LLM reasoning
2. **Dashboard** (Next.js, port 3000) — metric cards, sparklines, chat interface, movers panel

---

## Directory Structure

```
.
├── agent/                  # Backend API + data engine
│   ├── server.js           # Express server, sessions, context builder, 20+ API endpoints
│   ├── tools.js            # Core: ALL metric computation logic (1,740 lines)
│   ├── llm.js              # Multi-provider LLM abstraction
│   ├── cli.js              # Interactive CLI for testing
│   ├── src/server.js        # Alternate minimal HTTP server (placeholder/v2)
│   ├── SYSTEM_PROMPT.md    # LLM system prompt
│   ├── ANALYSIS_FRAMEWORK.md # Analysis rules sent to LLM
│   ├── TOOLS.md            # Tool descriptions
│   └── test/               # Test suites + fixtures
├── dashboard/              # Next.js frontend
│   ├── app/                # Next.js app router (page.tsx, layout.tsx)
│   ├── components/         # 9 custom components + 40+ shadcn/ui components
│   ├── lib/                # API client, context, types, utils
│   ├── hooks/              # Custom React hooks
│   └── styles/             # Global CSS
├── scripts/                # Data processing utilities
│   ├── bootstrap-data.js   # Startup: creates gl/ folders, symlinks, manifests
│   ├── generate_summary.js # Generates _summary.md + _manifest.yaml from Excel
│   ├── metric-detection.js # Content-based Excel metric detection
│   └── metric-detection.test.js
├── data/                   # Metric data + reference files
│   ├── weekly/             # Real data (2026-wk05, 2026-wk06)
│   ├── sample/             # Synthetic demo data (2099-wk01, 2099-wk02)
│   ├── METRIC_CALCULATION_GUIDE.md
│   └── gl_prefix_mapping.json
├── docs/                   # Architecture, API, configuration docs
├── evals/                  # Evaluation inputs (sample-input.json)
└── [root config]           # package.json, .gitignore, README, SPEC, CLAUDE.md, etc.
```

---

## Module Breakdown

### 1. Agent — Backend API (`agent/`)

#### `agent/server.js` (1,255 lines)
- **Description:** Express API server with session management, context building, streaming SSE
- **Key exports:** `app` (Express), `AnalysisSession` (class)
- **Key class:** `AnalysisSession` — manages per-user GL context, conversation history, data loading
- **API endpoints (20+):**
  - `POST /api/ask` — non-streaming query
  - `POST /api/ask/stream` — SSE streaming query (primary)
  - `GET /api/weeks` — list available weeks
  - `GET /api/gls/:week` — list GLs for a week
  - `GET /api/metrics/:week/:gl` — metric totals for dashboard cards
  - `GET /api/session/:sessionId` — get session state
  - `POST /api/session/:sessionId/reset` — reset session
  - `GET /api/movers/:week/:gl` — top subcategory movers
  - `GET /api/alerts/:week/:gl` — headwinds/tailwinds alerts
  - `GET /api/trends/:gl` — multi-week trend data
  - `GET /api/freshness/:week` — data freshness info
  - `GET /api/session/:sessionId/export` — export conversation
  - `POST /api/session/:sessionId/bridge` — generate bridge narrative
  - `POST /api/session/:sessionId/save` — save session
  - `POST /api/session/:sessionId/load` — load session
  - `GET /api/sessions/saved` — list saved sessions
  - `GET /api/formats` — list format templates
  - `POST /api/formats` — create format template
  - `DELETE /api/formats/:name` — delete format template
  - `GET /api/config` — LLM configuration
  - `GET /api/providers` — available LLM providers
  - `POST /api/config/validate` — validate LLM credentials

#### `agent/tools.js` (1,740 lines) — **Most critical file**
- **Description:** All deterministic data extraction and metric computation. No LLM in data path.
- **Key exports:**
  - `listWeeks()` — available data weeks
  - `listGLs(week)` — GLs for a week
  - `getSummary(week, gl)` — pre-computed narrative summary
  - `getManifest(week, gl)` — manifest metadata
  - `getAllSubcatData(week, gl)` — all subcats with all metrics (~150 data points)
  - `getMetricDrivers(week, gl, metric, period?, direction?)` — top CTC drivers
  - `getMetricTotals(week, gl)` — GL-level metric values, WoW, YoY
  - `getSubcatDetail(week, gl, subcatCode)` — single subcat deep dive
  - `searchSubcats(week, gl, query)` — search subcategories
  - `getAsinDetail(week, gl, metric, asin?)` — product-level drilldown
  - `getTrafficChannels(week, gl)` — glance view traffic data
  - `compareMetrics(week, gl)` — cross-metric comparison
  - `getDataAvailability(week, gl)` — check data presence
  - `getDataFreshness(weekStr)` — calculate data staleness
  - `loadGLMapping()` — GL-to-subcat code mapping
  - `getSubcatsForGL(gl)` — subcat codes belonging to a GL
  - `getGLNamesFromMapping()` — all GL names
  - `safeReadExcel(path)` — safe Excel read with error handling
  - `safeDivide(num, den)` — null-safe division
  - `detectFileLayout(rows)` — detect standard vs margin column layout
  - `loadAsinMapping()` — ASIN-to-subcat mapping

#### `agent/llm.js` (331 lines)
- **Description:** Unified LLM interface across Anthropic, OpenAI, Google Gemini, AWS Bedrock
- **Key exports:** `chat()`, `chatStream()`, `getConfig()`, `validateCredentials()`, `listProviders()`, `PROVIDERS`
- **Supported providers:** Anthropic (Claude), OpenAI (GPT-4), Google Gemini, AWS Bedrock

#### `agent/cli.js` (149 lines)
- **Description:** Interactive CLI for testing the agent (uses readline, imports AnalysisSession)
- **Entry point:** `node cli.js`

#### `agent/src/server.js` (53 lines)
- **Description:** Minimal alternate HTTP server (placeholder/v2 sketch). Has `/health` and `/runWeeklyUpdate` endpoints.
- **Not connected** to main application flow.

#### `agent/SYSTEM_PROMPT.md`, `agent/ANALYSIS_FRAMEWORK.md`, `agent/TOOLS.md`
- Static prompt files loaded by server.js and sent to LLM as system context.

---

### 2. Dashboard — Frontend (`dashboard/`)

#### Core Application
| File | Lines | Description |
|------|-------|-------------|
| `app/page.tsx` | 10 | Root page — wraps DashboardShell in DashboardProvider |
| `app/layout.tsx` | ~20 | Root layout with ThemeProvider |
| `app/globals.css` | — | Global styles |

#### Custom Components
| File | Lines | Description |
|------|-------|-------------|
| `components/dashboard-shell.tsx` | 68 | Main layout: left sidebar + chat + right sidebar |
| `components/chat-interface.tsx` | 242 | Chat input, quick action buttons, message submission |
| `components/chat-message.tsx` | 259 | Message rendering, markdown, Deep Dive collapsible |
| `components/left-sidebar.tsx` | 356 | GL/week navigation, session management |
| `components/right-sidebar.tsx` | 197 | Subcategory data tables, movers panel |
| `components/metric-cards.tsx` | 98 | Top metric cards (GMS, Units, ASP, NPPM, CM) |
| `components/sparkline.tsx` | 86 | Sparkline chart using Recharts |
| `components/dashboard-header.tsx` | 60 | Header bar with title + controls |
| `components/theme-provider.tsx` | — | next-themes wrapper |

#### Library
| File | Lines | Description |
|------|-------|-------------|
| `lib/api.ts` | 282 | API client: fetchWeeks, fetchGLs, fetchMetrics, fetchTrends, streamAsk |
| `lib/dashboard-context.tsx` | 337 | React context: state management, SSE streaming, session logic |
| `lib/types.ts` | 68 | TypeScript interfaces: MetricData, GL, ChatMessage, Mover, WindEntry, etc. |
| `lib/utils.ts` | ~10 | Tailwind `cn()` utility |

#### UI Components (`components/ui/`) — 40+ shadcn/ui components
Standard shadcn/ui library components (accordion, alert, badge, button, card, dialog, dropdown-menu, form, input, select, sheet, sidebar, table, tabs, toast, tooltip, etc.). Auto-generated, not custom logic.

---

### 3. Scripts (`scripts/`)

| File | Lines | Description | Key Exports |
|------|-------|-------------|-------------|
| `bootstrap-data.js` | 313 | Startup script: scans `data/weekly/`, creates `gl/` folders with symlinks + manifests | (runs as script) |
| `generate_summary.js` | 580 | Generates `_summary.md` and `_manifest.yaml` from Excel files | `METRIC_CONFIG`, `parseFilename`, `readExcelFile`, `parseSubcatData`, `parseTrafficData`, `generateSummaryMd`, `generateManifest`, `fmt` |
| `metric-detection.js` | 201 | Content-based Excel metric detection (header parsing, level detection) | `detectMetricFromFile`, `detectMetricFromRows`, `matchMetricHeader`, `detectLevel`, `extractWeekNumber`, `parseFilename`, `detectMetric` |
| `generate_sample_data.py` | — | Python script to generate synthetic demo data (requires openpyxl) | — |

---

### 4. Data (`data/`)

| Path | Description |
|------|-------------|
| `data/weekly/2026-wk05/` | Real business data (week 5, 2026) — used by data-accuracy tests |
| `data/weekly/2026-wk06/` | Real business data (week 6, 2026) — used by gl-metric-accuracy tests |
| `data/sample/2099-wk01/` | Synthetic demo data (ALL/) |
| `data/sample/2099-wk02/` | Synthetic demo data (ALL/) |
| `data/METRIC_CALCULATION_GUIDE.md` | How metrics are calculated — essential reference |
| `data/gl_prefix_mapping.json` | 8-digit subcat code prefix → GL name mapping |

---

### 5. Documentation (`docs/`)

| File | Description |
|------|-------------|
| `docs/API.md` | Full API endpoint reference |
| `docs/ARCHITECTURE.md` | System architecture overview |
| `docs/ARCHITECTURE_GUIDE.md` | Detailed architecture walkthrough |
| `docs/CONFIGURATION.md` | Configuration and environment variables |
| `docs/DATA.md` | Data structure and format documentation |
| `docs/DEVELOPMENT.md` | Development setup guide |
| `docs/PROMPTS.md` | LLM prompt engineering documentation |

---

### 6. Root Files

| File | Description |
|------|-------------|
| `package.json` | Root monorepo config: `npm run dev` starts API + UI concurrently |
| `README.md` | Comprehensive project README |
| `CLAUDE.md` | Claude Code instructions: structure, key functions, data flow |
| `SPEC.md` | Product specification v0 |
| `ARCHITECTURE-V2.md` | Architecture v2 vision |
| `METRICS.md` | Metrics hierarchy documentation |
| `ROADMAP.md` | Project roadmap |
| `prd.md` | Product Requirements Document |
| `AUDIT.md`, `AUDIT-v2.md` | Code audit notes |
| `n8n-blueprint.md` | n8n automation blueprint |
| `LICENSE` | MIT license |

---

## Existing Test Inventory

### How to Run All Tests

```bash
# Agent tests (4 suites)
cd agent && npm test
# Equivalent to:
#   node tools.test.js && node test/tools.fixture.test.js && node test/data-accuracy.test.js && node test/gl-metric-accuracy.test.js

# Individual suites:
cd agent && node tools.test.js                    # Unit tests
cd agent && node test/tools.fixture.test.js        # Fixture tests
cd agent && node test/data-accuracy.test.js        # Accuracy tests (needs real data)
cd agent && node test/gl-metric-accuracy.test.js   # GL accuracy (needs real data)

# Scripts test (separate, not in npm test):
cd scripts && node metric-detection.test.js
```

### Test File Details

| # | File | Tests | Module/Feature | Framework | Data Dependency |
|---|------|-------|----------------|-----------|-----------------|
| 1 | `agent/tools.test.js` | 22 | `tools.js` — safety helpers, data freshness, core tool APIs, edge cases, integration | Custom vanilla Node.js | Needs `data/weekly/` for integration tests |
| 2 | `agent/test/tools.fixture.test.js` | 27 | `tools.js` — fixture validation, malformed file handling, math/conversion, Excel parsing, zero/null handling, sort verification | Custom vanilla Node.js | Uses `agent/test/fixtures/mock-data/` (self-contained) |
| 3 | `agent/test/data-accuracy.test.js` | 113 (67 pass, 46 fail) | `tools.js` — column mapping accuracy, CTC computation, cross-function parity, GL detection, metric detection, context rendering | Custom vanilla Node.js | **Requires real data** in `data/weekly/2026-wk05/gl/pc/` |
| 4 | `agent/test/gl-metric-accuracy.test.js` | 28 (skipped — needs wk06 data in specific format) | `tools.js` — GL-level metric computation accuracy, revenue-weighted averaging bug detection | Custom vanilla Node.js | **Requires real data** in `data/weekly/2026-wk06/gl/all/` AND `gl/pc/` |
| 5 | `scripts/metric-detection.test.js` | 29 | `scripts/metric-detection.js` — header matching, level detection, week extraction, filename parsing, row-based detection | Custom vanilla Node.js | Self-contained (no data dependency) |

### Test Fixture Files

| Path | Description |
|------|-------------|
| `agent/test/fixtures/generate.js` | Script to regenerate mock Excel/YAML fixtures |
| `agent/test/fixtures/mock-data/2099-wk01/gl/testgl/` | Mock GL data: GMS, NetPPM, ShippedUnits Excel files + manifest + summary |
| `agent/test/fixtures/malformed/bad_manifest.yaml` | Intentionally malformed YAML for error handling tests |
| `agent/test/fixtures/malformed/empty_workbook.xlsx` | Empty Excel workbook for edge case tests |
| `agent/test/fixtures/edge-cases/zero_values.xlsx` | Excel with zero/null values for boundary tests |

---

## Baseline Test Results (as of indexing)

### Suite 1: `agent/tools.test.js`
- **Result: 22 passed, 0 failed** ✅
- Sections: Safety Helpers (5), Data Freshness (3), Core Tools (3), Data Availability (2), Integration Tests (6), Edge Cases (3)

### Suite 2: `agent/test/tools.fixture.test.js`
- **Result: 27 passed, 0 failed** ✅
- Sections: Fixture Validation (4), Malformed File Handling (4), Math & Conversion (8), Data Freshness (5), Excel Parsing (3), Zero/Null Handling (2), Sorting (1)

### Suite 3: `agent/test/data-accuracy.test.js`
- **Result: 67 passed, 46 failed** ❌
- Pass sections: getMetricTotals (5), Layout Detection (3), Sort Ordering (2), GL Detection (15), Question Metric Detection (6), WoW ASIN detail (6), Missing Metric Coverage (4), Full getMetricTotals coverage (8), SOROOS subcat (2), SOROOS OOS accuracy (3), Traffic Data (2), direction filter (2), some ASIN/context tests (7)
- **Failure pattern:** 46 tests fail with `Cannot read properties of undefined (reading 'ctc')` or similar — indicates `getMetricDrivers`, `getAllSubcatData`, `getSubcatDetail`, and `searchSubcats` return `undefined` for specific subcategory lookups against the `2026-wk05/gl/pc/` dataset. Likely a data format mismatch or missing subcategories in the test dataset.

### Suite 4: `agent/test/gl-metric-accuracy.test.js`
- **Result: Skipped** (exits with code 0)
- Needs both `data/weekly/2026-wk06/gl/all/` AND `data/weekly/2026-wk06/gl/pc/` directories. The wk06 `gl/` subdirectories may not have been bootstrapped.

### Suite 5: `scripts/metric-detection.test.js`
- **Result: 29 passed, 0 failed** ✅
- Sections: matchMetricHeader (12), detectLevel (5), extractWeekNumber (4), parseFilename (4), detectMetricFromRows (4)

### Aggregate Baseline

| Suite | Passed | Failed | Skipped | Total |
|-------|--------|--------|---------|-------|
| tools.test.js | 22 | 0 | 0 | 22 |
| tools.fixture.test.js | 27 | 0 | 0 | 27 |
| data-accuracy.test.js | 67 | 46 | 0 | 113 |
| gl-metric-accuracy.test.js | — | — | 28 (skipped) | 28 |
| metric-detection.test.js | 29 | 0 | 0 | 29 |
| **TOTAL** | **145** | **46** | **28** | **219** |

---

## Untested Areas (Coverage Gaps)

### Backend — No Tests
1. **`agent/server.js`** — Zero test coverage for:
   - All 20+ API endpoints
   - `AnalysisSession` class (detectGL, context building, history management)
   - SSE streaming (`/api/ask/stream`)
   - Session save/load/export/reset
   - Bridge narrative generation
   - Format template CRUD
   - CORS handling
   - Error responses and edge cases
2. **`agent/llm.js`** — Zero test coverage for:
   - Multi-provider LLM abstraction
   - `chat()` and `chatStream()` functions
   - `validateCredentials()`
   - Provider configuration
3. **`agent/cli.js`** — No tests (interactive CLI)
4. **`agent/src/server.js`** — No tests (alternate server)

### Scripts — Partial Coverage
5. **`scripts/bootstrap-data.js`** — Zero test coverage for:
   - GL folder structure creation
   - Symlink generation
   - Manifest auto-generation
   - Idempotency (skip already-processed GLs)
6. **`scripts/generate_summary.js`** — Zero test coverage for:
   - `parseSubcatData()`, `parseTrafficData()`
   - `generateSummaryMd()`, `generateManifest()`
   - `readExcelFile()`, `fmt()`

### Frontend — No Tests At All
7. **`dashboard/`** — Zero test infrastructure, zero tests:
   - No testing library installed (no Jest, Vitest, or Testing Library)
   - No test files exist
   - Components, API client, context, hooks — all untested

---

## Key Architectural Notes for Test Generation

1. **Custom test framework**: All tests use a hand-rolled `test()` / `assert()` pattern. No jest, mocha, or vitest. Tests exit with `process.exit(1)` on failure.
2. **Data dependencies**: Suite 3 (data-accuracy) and Suite 4 (gl-metric-accuracy) require real Excel data in `data/weekly/`. They gracefully skip if data is missing.
3. **No mocking infrastructure**: Tests either use real data or pre-generated fixtures. No sinon, nock, or mock libraries.
4. **Monorepo structure**: Three independent package.json files (root, agent, scripts). Dashboard has its own.
5. **tools.js is the highest-value test target**: 1,740 lines of deterministic computation — pure functions with clear inputs/outputs.
6. **server.js is the biggest coverage gap**: 1,255 lines with 20+ endpoints, all untested. Would benefit from supertest or similar.
7. **The 46 failing tests** appear to be data-dependent regressions where specific subcategory codes expected in tests no longer exist in the dataset — not code bugs per se.
