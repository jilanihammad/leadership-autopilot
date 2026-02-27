# Leadership Autopilot

**Business leaders spend 3–5 hours per week manually combing through spreadsheets to prep for operational reviews.** They open dozens of Excel files, compute year-over-year deltas, identify which product categories drove changes, and try to construct a narrative — all before the meeting even starts.

Leadership Autopilot is an AI-powered analysis agent that ingests periodic business metrics (revenue, margins, units, cost-to-customer) across product categories and answers natural-language questions with data-backed insights. Ask *"Why did margin compress this week?"* and get an instant decomposition into volume vs. price, mix vs. rate, with specific product-level attribution — not a vague summary.

**Live demo workflow:** Upload Excel data for a business unit → select the time period → ask questions in natural language → get streaming, structured analysis with CTC (contribution-to-change) attribution across subcategories and individual products.

---

## What It Does

- **Natural language queries** over structured business data ("What drove GMS growth?" / "Which subcategories are losing money?")
- **Automatic Excel ingestion** — parses weekly metric files (revenue, units, ASP, Net PPM, contribution margin) by subcategory and product
- **CTC attribution** — decomposes every metric movement into contribution-to-change by subcategory and product, not just raw deltas
- **WHAT/WHY response format** — headline bullets stream in ~2 seconds; full root-cause analysis is collapsible
- **Multi-week trend support** — WoW and YoY comparisons with sparkline visualizations
- **Product-level drilldowns** — ASIN-to-subcategory mapping covers ~86% of revenue by value
- **Session persistence** — maintains conversation context per business unit for follow-up questions
- **Export** — bridge narratives and metric tables export-ready for leadership presentations

## Architecture

```
┌──────────────────────────────────────────────────┐
│            Dashboard (Next.js + Tailwind)         │
│  Metric Cards · Sparklines · Chat · Movers Panel │
│  Left sidebar: business unit/week selection       │
│  Right sidebar: top movers, tailwinds/headwinds  │
└──────────────────────┬───────────────────────────┘
                       │ SSE streaming
┌──────────────────────▼───────────────────────────┐
│              Agent API (Express, port 3456)       │
│  Session mgmt · Context builder · GL detection   │
│  Deterministic data tools · Multi-provider LLM   │
└──────┬───────────────────────────────┬───────────┘
       │                               │
┌──────▼──────┐              ┌─────────▼──────────┐
│  Data Layer │              │     LLM Layer      │
│  Excel/YAML │              │  Claude (Bedrock)  │
│  ~150 data  │              │  GPT-4 · Gemini    │
│  points/GL  │              │  Anthropic direct   │
└─────────────┘              └────────────────────┘
```

**Key numbers:**
- `agent/tools.js` — 1,724 lines of deterministic data extraction (no LLM in the data path)
- `agent/server.js` — 1,255 lines covering session management, context building, streaming
- Dashboard — 1,387 lines across 9 custom components (chat, sparklines, metric cards, movers panel)
- 229 tests across 4 test suites (unit, fixture, data accuracy, cross-metric parity)
- 30 commits

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 14, React, Tailwind CSS, Recharts, shadcn/ui |
| Backend | Express.js, Node.js |
| Data parsing | SheetJS (xlsx), YAML manifests |
| LLM | AWS Bedrock (Claude), Anthropic, OpenAI, Google Gemini |
| Streaming | Server-Sent Events (SSE) |

## How the Data Pipeline Works

```
Excel files (weekly/2026-wk05/gl/pc/*.xlsx)
    │
    ├── _manifest.yaml — declares available metrics and file paths
    ├── GMS_Week5_ctc_by_SUBCAT.xlsx — revenue by subcategory
    ├── ShippedUnits_Week5_ctc_by_SUBCAT.xlsx
    ├── ASP, NetPPM, CM — by SUBCAT and by ASIN
    └── _summary.md — auto-generated overview
    │
    ▼
tools.js extracts deterministic data:
    getAllSubcatData()  → 27 subcats × 5 metrics = ~150 data points
    getMetricDrivers() → top CTC contributors for any metric
    getAsinDetail()    → product-level drilldown with ASIN-to-subcat mapping
    getSummary()       → pre-computed narrative summary
    │
    ▼
Context builder assembles ~1,000 tokens of structured data
    │
    ▼
LLM generates WHAT/WHY analysis with exact CTC attribution
```

The agent uses **no LLM for data extraction** — all parsing, column mapping, CTC computation, and YoY delta calculation is deterministic. The LLM only does reasoning over pre-extracted tables.

## Product Decisions & Tradeoffs

### Deterministic data extraction, LLM only for reasoning
**Decision:** All data parsing happens in `tools.js` with zero LLM calls. The LLM receives pre-computed tables.

**Why:** Early versions used the LLM to read Excel files directly. This caused: (1) hallucinated numbers, (2) missed subcategories due to context window limits, (3) non-reproducible results. Moving to deterministic extraction eliminated an entire class of accuracy bugs and made the system testable — 229 tests verify column mapping, CTC computation, and metric accuracy.

**Tradeoff:** Adding a new metric or file format requires code changes to `tools.js`, not just a prompt tweak. Worth it for data integrity in a leadership-facing tool.

### Always load all subcategory data
**Decision:** Every query loads all ~150 data points for the selected business unit, regardless of the question.

**Why:** Selective loading (only load what the question asks about) caused frequent "I don't have that data" errors. Pattern matching missed edge cases (e.g., user asks about "USB" but system only loaded "Flash Memory"). Full loading costs ~1,000 tokens — well within budget — and eliminates data availability as a failure mode.

**Tradeoff:** Slightly higher token cost per query. Negligible given the context stays under 5KB.

### WHAT/WHY collapsible response format
**Decision:** Every response streams a 2–4 bullet "WHAT" section first, with detailed "WHY" analysis collapsible below.

**Why:** Target users are directors/VPs who need the answer in the first 3 seconds. The WHY section contains full decomposition (volume vs. price, mix vs. rate, product-level attribution) for anyone who wants to dig deeper. Streaming means the WHAT appears in ~2–3 seconds even when the full response takes 20+ seconds.

### Data vs. Hypothesis boundary enforcement
**Decision:** The system prompt enforces a hard boundary between claims backed by data and inferences about root causes. Hypotheses must be explicitly labeled.

**Why:** In a leadership context, presenting an AI's guess as a fact is worse than having no answer. The system can decompose what happened (data-backed) but cannot explain why (no competitor data, no promo data, no cost breakdowns). Forcing explicit labeling prevents executives from acting on AI speculation.

### In-memory sessions (no database)
**Decision:** Conversation history lives in a JavaScript Map, not persisted to disk.

**Why:** MVP tradeoff. The tool is used synchronously during review prep — sessions lasting 15–60 minutes. Losing history on server restart is acceptable. Adds no infrastructure dependency.

### Multi-provider LLM abstraction
**Decision:** Unified interface across Anthropic, OpenAI, Google, and AWS Bedrock.

**Why:** Enterprise environments often mandate Bedrock for compliance. Personal/dev use prefers direct API calls for cost. The abstraction layer (`llm.js`, 331 lines) lets the same deployment work in both contexts.

## Testing

```
229 tests across 4 suites:
├── tools.test.js (44)           — unit tests for data extraction functions
├── tools.fixture.test.js (43)   — fixture-based tests with generated Excel files
├── data-accuracy.test.js (114)  — column mapping, CTC computation, metric detection
└── gl-metric-accuracy.test.js (28) — cross-GL, cross-metric parity checks
```

Run: `cd agent && npm test`

## Quick Start

```bash
# Backend
cd agent && cp .env.example .env  # add your LLM credentials
npm install && npm start          # → http://localhost:3456

# Dashboard (new terminal)
cd dashboard && npm install --legacy-peer-deps
npm run dev                       # → http://localhost:3000
```

## Using Sample Data

The repo includes synthetic sample data for demo purposes:

```bash
# Generate sample data (requires openpyxl)
pip3 install openpyxl
python3 scripts/generate_sample_data.py

# Copy sample data to the expected location
cp -r data/sample/2099-wk01 data/weekly/2099-wk01
cp -r data/sample/2099-wk02 data/weekly/2099-wk02
```

The data loader expects files in `data/weekly/{YYYY-wkNN}/ALL/`. The sample data uses fake product categories (Smart Home, Fitness Gear, Kitchen Gadgets, Pet Tech, Gaming Accessories) with synthetic metrics.

## License

MIT
