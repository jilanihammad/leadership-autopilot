# Leadership Autopilot

AI agent that answers natural language questions about business metrics. Ask "Why did margin compress this week?" and get a decomposition into volume vs. price, mix vs. rate, with specific product-level CTC attribution.

Upload Excel data for a business unit, select the time period, ask questions, get streaming structured analysis.

## What It Does

- Natural language queries over structured business data ("What drove GMS growth?" / "Which subcategories are losing money?")
- Automatic Excel ingestion: revenue, units, ASP, Net PPM, contribution margin by subcategory and product
- CTC (contribution-to-change) attribution by subcategory and product, not just raw deltas
- WHAT/WHY response format: headline bullets stream in ~2 seconds, full root-cause analysis is collapsible
- Multi-week trend support with WoW and YoY comparisons
- Product-level drilldowns with SKU-to-Subcategory-to-Category mapping
- Session persistence per business unit for follow-up questions

## Architecture

```
┌──────────────────────────────────────────────────┐
│            Dashboard (Next.js + Tailwind)         │
│  Metric Cards · Sparklines · Chat · Movers Panel │
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
│  points/GL  │              │  Anthropic direct  │
└─────────────┘              └────────────────────┘
```

**No LLM in the data path.** All parsing, column mapping, CTC computation, and YoY delta calculation is deterministic (`tools.js`, 1,724 lines). The LLM only does reasoning over pre-extracted tables.

## Data Pipeline

```
Excel files (weekly/2026-wk05/gl/pc/*.xlsx)
    │
    ├── _manifest.yaml (available metrics + file paths)
    ├── GMS, ShippedUnits, ASP, NetPPM, CM by SUBCAT and by ASIN
    │
    ▼
tools.js extracts deterministic data:
    getAllSubcatData()  → 27 subcats × 5 metrics = ~150 data points
    getMetricDrivers() → top CTC contributors for any metric
    getAsinDetail()    → product-level drilldown
    │
    ▼
Context builder assembles ~1,000 tokens of structured data
    │
    ▼
LLM generates WHAT/WHY analysis with exact CTC attribution
```

Every query loads all ~150 data points regardless of the question. Selective loading caused too many "I don't have that data" errors. Full loading costs ~1,000 tokens, well within budget.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 14, React, Tailwind, Recharts, shadcn/ui |
| Backend | Express.js, Node.js |
| Data parsing | SheetJS (xlsx), YAML manifests |
| LLM | AWS Bedrock (Claude), Anthropic, OpenAI, Google Gemini |
| Streaming | Server-Sent Events (SSE) |

## Testing

229 tests across 4 suites:

```
├── tools.test.js (44)            data extraction unit tests
├── tools.fixture.test.js (43)    fixture-based tests with generated Excel files
├── data-accuracy.test.js (114)   column mapping, CTC computation, metric detection
└── gl-metric-accuracy.test.js (28) cross-GL, cross-metric parity checks
```

Run: `cd agent && npm test`

## Quick Start

```bash
# Backend
cd agent && cp .env.example .env  # add your LLM credentials
npm install && npm start          # → http://localhost:3456

# Dashboard
cd dashboard && npm install --legacy-peer-deps
npm run dev                       # → http://localhost:3000
```

### Sample Data

```bash
pip3 install openpyxl
python3 scripts/generate_sample_data.py
cp -r data/sample/2099-wk01 data/weekly/2099-wk01
cp -r data/sample/2099-wk02 data/weekly/2099-wk02
```

The data loader expects files in `data/weekly/{YYYY-wkNN}/ALL/`.

## License

MIT
