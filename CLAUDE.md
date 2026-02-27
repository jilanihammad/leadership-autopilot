# Leadership Autopilot

AI-powered Weekly Business Review analysis assistant. Users ask business questions ("why is Net PPM down?") and get data-driven answers computed from weekly Excel metric files.

## Quick Start

```bash
npm run install:all    # Install agent + dashboard deps
npm run dev            # Starts API (port 3001) + UI (port 3000) concurrently
cd agent && npm test   # Run all tests (184 total across 4 suites)
```

## Repo Structure

```
├── agent/                  # Backend: Express API + LLM analysis engine
│   ├── server.js           # API server, session management, buildContext()
│   ├── tools.js            # ALL metric computation logic (the most critical file)
│   ├── llm.js              # LLM provider abstraction (Anthropic/OpenAI/Bedrock)
│   ├── SYSTEM_PROMPT.md    # System prompt sent to the LLM
│   └── test/
│       ├── data-accuracy.test.js       # Column-mapping accuracy (wk05 PC data)
│       ├── gl-metric-accuracy.test.js  # GL-level computation accuracy (wk06 ALL vs PC)
│       └── tools.fixture.test.js       # Fixture-based unit tests
│
├── dashboard/              # Frontend: Next.js 15 + TypeScript + Tailwind + shadcn/ui
│   ├── app/page.tsx        # Main dashboard page
│   └── components/
│       ├── dashboard-shell.tsx   # Layout: left sidebar + chat + right sidebar
│       ├── metric-cards.tsx      # Top metric cards (calls getMetricTotals)
│       ├── chat-interface.tsx    # Chat input + quick actions
│       ├── chat-message.tsx      # Message rendering + Deep Dive dropdown
│       ├── left-sidebar.tsx      # GL/week navigation
│       └── right-sidebar.tsx     # Subcat data tables
│
├── data/                   # Weekly metric data + reference files
│   ├── METRIC_CALCULATION_GUIDE.md   # HOW METRICS ARE CALCULATED (read this first!)
│   ├── gl_prefix_mapping.json        # 8-digit subcat code → GL mapping
│   ├── GL to Subcat mapping.xlsx     # Source GL→subcat mapping
│   ├── Rate Mix and CTC primer calculator - Hammad.xlsx  # CTC formula reference
│   └── weekly/{year}-wk{NN}/
│       ├── ALL/            # Raw consolidated Excel files (all GLs combined)
│       ├── PC/             # Raw PC-specific Excel files
│       └── gl/             # Auto-generated per-GL folders (symlinks + manifests)
│           ├── all/        # Symlinks to ALL/ + _manifest.yaml + _summary.md
│           ├── pc/         # Symlinks to PC/
│           └── {gl_name}/  # Symlinks to ALL/ (most GLs share ALL data)
│
├── scripts/
│   ├── bootstrap-data.js       # Runs on startup: creates gl/ folders, symlinks, manifests
│   └── generate_summary.js     # Generates _summary.md and _manifest.yaml from Excel
│
├── knowledge/              # YAML config for analysis rules
│   ├── causal_rules.yaml   # Metric relationship rules
│   └── metric_aliases.yaml # Metric name normalization
│
└── docs/                   # Architecture and API documentation
```

## Critical: How Metrics Are Computed

**Read `data/METRIC_CALCULATION_GUIDE.md` before touching `agent/tools.js`.**

All GL-level metrics are computed from the ALL consolidated files, filtered by GL-to-subcat mapping. Key rules:

- **Absolute metrics (GMS, Units):** `GL_value = sum(col2)`, WoW/YoY from CTC$ columns
- **Margin metrics (NPPM, CM, ASP):** `GL_value = sum(numerator) / sum(denominator)` — NEVER average percentages
- **WoW/YoY for margin metrics:** Uses cross-metric denominator approach (NOT revenue-weighted averaging). See the guide for why this matters — the wrong formula gives errors of 80-780 bps.

The test `gl-metric-accuracy.test.js` specifically catches the revenue-weighted averaging bug. Always run tests after modifying metric logic.

## Data Flow

1. Excel files land in `data/weekly/{week}/ALL/` and optionally `PC/`
2. `bootstrap-data.js` creates `gl/` folder structure with symlinks + manifests
3. `tools.js` reads from `gl/all/` and filters by GL using `getSubcatsForGL(gl)`
4. `server.js` calls tools functions, builds context, sends to LLM
5. Dashboard calls API, renders metric cards + chat + subcat tables

## Key Functions in tools.js

| Function | Purpose |
|----------|---------|
| `getMetricTotals(week, gl)` | GL-level metric values, WoW, YoY (dashboard cards) |
| `getMetricDrivers(week, gl, metric)` | Top subcat drivers by CTC impact |
| `getAllSubcatData(week, gl)` | All subcats with all metrics (subcat table) |
| `getSummary(week, gl)` | Summary markdown (dynamically generated for GL-filtered views) |
| `loadGLMapping()` | Builds 8-digit subcat code → GL mapping from prefix + name matching |
| `resolveGLDataFolder(week, gl)` | Resolves data path: prefers ALL with filter, falls back to per-GL |
| `loadDenominatorPctMap(...)` | Loads GMS/Units growth rates for cross-metric WoW/YoY estimation |

## GL-to-Subcat Code Mapping

Each 8-digit subcat code encodes the GL in its prefix: `10101001` = prefix `1010` (Smart Home) + subcat `1001`. See `data/gl_prefix_mapping.json` for the full mapping. Key prefixes:

- `1010` = Smart Home, `1020` = Fitness Gear, `1030` = Kitchen Gadgets
- `1040` = Pet Tech, `1050` = Gaming Accessories

## File Layouts (Excel)

**Standard (9 cols):** GMS, ShippedUnits
`Code | Name | Value | WoW% | YoY% | WoW CTC($) | WoW CTC(bps) | YoY CTC($) | YoY CTC(bps)`

**Margin (13 cols):** NetPPMLessSD, CM, ASP, SOROOS
`Code | Name | Value | Numerator($) | Denominator($) | WoW | YoY | WoW CTC | Mix | Rate | YoY CTC | Mix | Rate`

Note: For ASP, WoW/YoY are fractional (0.03 = 3%). For NPPM/CM/SOROOS, they are bps (270 = 2.70pp).

## Environment

- Agent needs `ANTHROPIC_API_KEY` in `agent/.env`
- Dashboard connects to agent API at `localhost:3001`
- Node.js required, no Docker
