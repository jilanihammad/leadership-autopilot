# Leadership Autopilot — Architecture v2

## Vision Shift

**v1 (Current Spec):** Weekly digest generator — summarizes what happened.

**v2 (This Doc):** Interactive root-cause analysis tool — answers "why did X change?" by tracing through the metric tree automatically.

---

## Core Capabilities

### 1. Metric Ingestion & Normalization
- Accept Excel/PDF exports from multiple sources
- Parse and normalize into a unified time-series data model
- Auto-detect metric type from file structure/headers

### 2. Anomaly Detection
- Automatically flag significant WoW/MoM/YoY changes
- Configurable thresholds per metric type
- Seasonal adjustment (don't alert on expected Prime Day spikes)

### 3. Root Cause Tracing
- Given a metric movement (e.g., "GMS -12% WoW"), automatically:
  - Decompose into contributing factors (Traffic, CVR, ASP)
  - Quantify each factor's contribution (waterfall)
  - Drill into each factor's sub-drivers
  - Surface correlated metrics that moved together

### 4. Interactive Q&A
- Natural language queries: "Why did GL3 NPPM drop last week?"
- Agent traces through data, generates hypothesis, cites evidence
- Can ask follow-ups: "Was it driven by a specific ASIN?"

### 5. Automated Reporting (Optional)
- Generate weekly/daily digests from the analysis
- Slack/email delivery
- Appendix with full drill-down available

---

## System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         USER INTERFACE                          │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐  │
│  │   Slack     │  │   Web UI    │  │   CLI / API            │  │
│  │   Bot       │  │  (Future)   │  │   (Power Users)        │  │
│  └──────┬──────┘  └──────┬──────┘  └───────────┬─────────────┘  │
└─────────┼────────────────┼─────────────────────┼────────────────┘
          │                │                     │
          ▼                ▼                     ▼
┌─────────────────────────────────────────────────────────────────┐
│                      REASONING LAYER                            │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │                   LLM Agent (Claude/GPT)                │    │
│  │  - Interprets user questions                            │    │
│  │  - Plans analysis steps                                 │    │
│  │  - Generates hypotheses                                 │    │
│  │  - Synthesizes findings into narrative                  │    │
│  └─────────────────────────┬───────────────────────────────┘    │
│                            │                                    │
│  ┌─────────────────────────▼───────────────────────────────┐    │
│  │               Analysis Tools (Agent Calls)              │    │
│  │  - get_metric(metric, gl, asin, date_range)             │    │
│  │  - compare_periods(metric, period1, period2)            │    │
│  │  - decompose_change(metric, gl, date_range)             │    │
│  │  - find_anomalies(gl, date_range, threshold)            │    │
│  │  - get_correlated_changes(metric, date_range)           │    │
│  │  - get_top_movers(metric, direction, n, date_range)     │    │
│  │  - waterfall_analysis(metric, gl, date_range)           │    │
│  └─────────────────────────┬───────────────────────────────┘    │
└─────────────────────────────┼───────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                       DATA LAYER                                │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │                  Metric Store (SQLite/DuckDB)           │    │
│  │                                                         │    │
│  │  Tables:                                                │    │
│  │  - metrics_daily (date, gl, asin, metric_name, value)   │    │
│  │  - metric_definitions (name, formula, parents, unit)    │    │
│  │  - gl_hierarchy (gl, parent_gl, name)                   │    │
│  │  - asin_catalog (asin, gl, title, status)               │    │
│  │  - ingestion_log (file, timestamp, rows, status)        │    │
│  └─────────────────────────┬───────────────────────────────┘    │
│                            │                                    │
│  ┌─────────────────────────▼───────────────────────────────┐    │
│  │                  Ingestion Pipeline                     │    │
│  │  - Excel parser (pandas/openpyxl)                       │    │
│  │  - PDF parser (pdfplumber/tabula)                       │    │
│  │  - Schema mapper (auto-detect columns)                  │    │
│  │  - Validation & deduplication                           │    │
│  └─────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────┘
```

---

## Key Analysis Functions

### 1. Waterfall Analysis
Quantifies contribution of each factor to a metric change.

```
Input: GMS dropped -$50K WoW for GL3

Output:
┌────────────────────────────────────────────┐
│ GMS Change Waterfall (GL3, WoW)            │
├────────────────────────────────────────────┤
│ Starting GMS (Last Week)      $500,000     │
│ ─────────────────────────────────────────  │
│ Traffic Impact               -$20,000 (40%)│
│   └─ Glance Views: -8%                     │
│ CVR Impact                   -$25,000 (50%)│
│   └─ CVR: 12% → 10.2% (-15%)               │
│ ASP Impact                   -$5,000  (10%)│
│   └─ ASP: $45 → $44 (-2%)                  │
│ ─────────────────────────────────────────  │
│ Ending GMS (This Week)        $450,000     │
└────────────────────────────────────────────┘
```

### 2. Drill-Down Trace
Recursively explores why a component changed.

```
User: "Why did CVR drop?"

Agent traces:
1. Check Buy Box % → Down 5% (possible cause)
2. Check Reviews → Stable
3. Check Price vs Competition → We're 8% higher (possible cause)
4. Check In-Stock Rate → 98% (not the issue)
5. Check new negative reviews → Found 3 new 1-stars mentioning "shipping damage"

Output:
"CVR dropped primarily due to:
1. Buy Box loss (-5% WoW) — competitor undercut by $2
2. 3 new 1-star reviews citing shipping damage
Recommend: Review pricing strategy + investigate fulfillment issues."
```

### 3. ASIN-Level Decomposition
Attributes GL-level changes to specific ASINs.

```
Input: GL3 GMS -$50K

Output:
┌─────────────────────────────────────────────────┐
│ Top ASIN Contributors to GL3 GMS Decline        │
├─────────────────────────────────────────────────┤
│ ASIN        │ Title          │ Impact   │ Why?  │
├─────────────────────────────────────────────────┤
│ B00ABC123   │ Widget Pro     │ -$32K    │ OOS 3d│
│ B00DEF456   │ Widget Lite    │ -$12K    │ CVR ↓ │
│ B00GHI789   │ Widget Max     │ -$8K     │ Traffic↓│
│ (Others)    │                │ +$2K     │       │
└─────────────────────────────────────────────────┘
```

---

## Data Model

### metrics_daily
```sql
CREATE TABLE metrics_daily (
  id INTEGER PRIMARY KEY,
  date DATE NOT NULL,
  gl VARCHAR(50),           -- NULL for company-wide
  asin VARCHAR(20),         -- NULL for GL-level
  metric_name VARCHAR(100) NOT NULL,
  value DECIMAL(18,4),
  source_file VARCHAR(255),
  ingested_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(date, gl, asin, metric_name)
);

-- Indexes for common queries
CREATE INDEX idx_metrics_date ON metrics_daily(date);
CREATE INDEX idx_metrics_gl_date ON metrics_daily(gl, date);
CREATE INDEX idx_metrics_asin_date ON metrics_daily(asin, date);
```

### metric_definitions
```sql
CREATE TABLE metric_definitions (
  name VARCHAR(100) PRIMARY KEY,
  display_name VARCHAR(200),
  formula TEXT,                -- e.g., "gms / glance_views"
  parent_metrics TEXT,         -- JSON array of parent metric names
  unit VARCHAR(20),            -- "currency", "percent", "count", "ratio"
  direction VARCHAR(10),       -- "up_good", "down_good", "neutral"
  threshold_warn DECIMAL(10,4),-- WoW change % to flag as warning
  threshold_alert DECIMAL(10,4)-- WoW change % to flag as alert
);
```

### Pre-loaded metric definitions
```sql
INSERT INTO metric_definitions VALUES
('gms', 'Gross Merchandise Sales', NULL, NULL, 'currency', 'up_good', 0.05, 0.10),
('pcogs', 'Product COGS', NULL, NULL, 'currency', 'down_good', 0.05, 0.10),
('nppm', 'Net Pure Product Margin', '(gms - pcogs) / gms', '["gms", "pcogs"]', 'percent', 'up_good', 0.02, 0.05),
('glance_views', 'Glance Views', NULL, NULL, 'count', 'up_good', 0.10, 0.20),
('cvr', 'Conversion Rate', 'orders / glance_views', '["orders", "glance_views"]', 'percent', 'up_good', 0.05, 0.10),
('asp', 'Average Selling Price', 'gms / units', '["gms", "units"]', 'currency', 'neutral', 0.05, 0.10),
('units', 'Units Sold', NULL, NULL, 'count', 'up_good', 0.10, 0.20),
('orders', 'Orders', NULL, NULL, 'count', 'up_good', 0.10, 0.20),
('buy_box_pct', 'Buy Box %', NULL, NULL, 'percent', 'up_good', 0.03, 0.10),
('ad_spend', 'Advertising Spend', NULL, NULL, 'currency', 'neutral', 0.15, 0.30),
('tacos', 'Total ACoS', 'ad_spend / gms', '["ad_spend", "gms"]', 'percent', 'down_good', 0.02, 0.05),
('return_rate', 'Return Rate', 'returns / units', '["returns", "units"]', 'percent', 'down_good', 0.02, 0.05);
```

---

## Ingestion Pipeline

### Excel Parser Flow
```
1. User uploads/drops Excel file
2. Auto-detect report type from:
   - Filename patterns (e.g., "BusinessReport_*")
   - Header row patterns
   - Known column combinations
3. Map columns to standard metric names
4. Extract date range from file/filename
5. Transform to normalized rows
6. Upsert into metrics_daily (handle duplicates)
7. Log ingestion result
```

### Supported Report Types (Initial)
| Report | Metrics Extracted |
|--------|-------------------|
| Business Reports (Detail Page) | Glance Views, Units, Orders, GMS |
| Business Reports (ASIN) | Same, per-ASIN |
| Advertising Reports | Spend, Impressions, Clicks, Sales, ACoS |
| Inventory Report | In-Stock, FBA Qty, IPI |
| Payments Report | Fees breakdown |
| Custom P&L Export | GMS, PCOGS, NPPM |

### PDF Handling
- Use `pdfplumber` or `tabula` to extract tables
- More fragile — require template definitions per PDF type
- Fallback: OCR with layout analysis

---

## Agent Tools (Function Calling)

```typescript
interface AnalysisTools {
  // Core data retrieval
  get_metric(params: {
    metric: string;
    gl?: string;
    asin?: string;
    start_date: string;
    end_date: string;
  }): TimeSeriesData;

  // Period comparison
  compare_periods(params: {
    metric: string;
    gl?: string;
    period1_start: string;
    period1_end: string;
    period2_start: string;
    period2_end: string;
  }): ComparisonResult;

  // Decomposition
  waterfall_analysis(params: {
    target_metric: string;  // e.g., "gms"
    gl: string;
    start_date: string;
    end_date: string;
    compare_to: "wow" | "mom" | "yoy" | string;  // or specific date range
  }): WaterfallResult;

  // Discovery
  find_anomalies(params: {
    gl?: string;
    start_date: string;
    end_date: string;
    threshold_sigma?: number;  // default 2
  }): Anomaly[];

  get_top_movers(params: {
    metric: string;
    level: "gl" | "asin";
    direction: "up" | "down" | "both";
    n: number;
    start_date: string;
    end_date: string;
  }): Mover[];

  // Correlation
  get_correlated_changes(params: {
    anchor_metric: string;
    gl?: string;
    asin?: string;
    date: string;
    lookback_days?: number;
  }): CorrelatedMetric[];

  // Drill-down
  drill_down(params: {
    metric: string;
    gl: string;
    date: string;
  }): DrillDownResult;  // Returns ASIN-level breakdown
}
```

---

## User Interaction Examples

### Example 1: Proactive Alert
```
[Monday 9am - Automated]

🚨 NPPM Alert: GL3 dropped -3.2pp WoW (12.1% → 8.9%)

Quick Analysis:
- GMS: -$45K (-8%) — Traffic down, CVR stable
- PCOGS: +$12K (+4%) — Storage fees spiked (aged inventory)

Top ASIN impact:
- B00ABC123: -2.1pp (went OOS, sold through promos to clear)

Recommended actions:
1. Review GL3 inventory health
2. Check B00ABC123 restock ETA

Reply "drill down GL3" for full analysis.
```

### Example 2: Interactive Q&A
```
User: Why did GL5 underperform last week?

Agent: Let me analyze GL5 for last week (Jan 20-26)...

📊 GL5 Performance Summary:
- GMS: $234K (-12% WoW) ❌
- NPPM: 14.2% (-1.8pp WoW) ❌

Decomposing GMS decline:
┌──────────────┬──────────┬────────────────────────────┐
│ Factor       │ Impact   │ Driver                     │
├──────────────┼──────────┼────────────────────────────┤
│ Traffic      │ -$18K    │ Organic search rank drop   │
│ CVR          │ -$14K    │ Lost Buy Box on 2 ASINs    │
│ ASP          │ +$2K     │ Mix shift to premium SKU   │
└──────────────┴──────────┴────────────────────────────┘

Root cause: Competitor launched aggressive pricing on Jan 21.
- B00XYZ789 lost Buy Box (our price $24.99 vs competitor $21.99)
- B00XYZ790 lost Buy Box (our price $34.99 vs competitor $31.99)

User: Should we match their price?

Agent: Let me model that...

If we match prices on both ASINs:
- Projected GMS recovery: +$28K/week
- NPPM impact: -0.8pp (margin compression)
- Net contribution change: +$1.2K/week

Recommendation: Match on B00XYZ789 (high volume, margin still healthy).
Hold on B00XYZ790 (lower volume, would go negative margin).
```

---

## Implementation Phases

### Phase 1: Foundation (Week 1-2)
- [ ] Set up project structure (Python or Node)
- [ ] Implement SQLite/DuckDB data store
- [ ] Build Excel ingestion pipeline for Business Reports
- [ ] Implement core `get_metric`, `compare_periods` functions
- [ ] Basic CLI for testing

### Phase 2: Analysis Engine (Week 3-4)
- [ ] Implement `waterfall_analysis` with GMS decomposition
- [ ] Implement `find_anomalies` with configurable thresholds
- [ ] Implement `get_top_movers` at GL and ASIN level
- [ ] Implement `drill_down` for ASIN-level attribution

### Phase 3: LLM Integration (Week 5-6)
- [ ] Define function-calling schema for all tools
- [ ] Build agent loop with Claude/GPT
- [ ] Implement hypothesis generation prompts
- [ ] Add citation/evidence requirements

### Phase 4: Interface & Delivery (Week 7-8)
- [ ] Slack bot for interactive Q&A
- [ ] Scheduled digest generation
- [ ] Email delivery
- [ ] (Optional) Simple web UI

### Phase 5: Polish & Scale (Ongoing)
- [ ] PDF ingestion for additional reports
- [ ] More metric types (advertising, inventory)
- [ ] Caching & performance optimization
- [ ] User feedback loop for hypothesis quality

---

## Tech Stack Recommendation

| Component | Recommendation | Why |
|-----------|---------------|-----|
| Language | Python | Best for data manipulation, LLM libs |
| Data Store | DuckDB | Fast analytics, embedded, SQL |
| Excel Parsing | pandas + openpyxl | Robust, handles complex sheets |
| PDF Parsing | pdfplumber | Good table extraction |
| LLM | Claude 3.5 Sonnet | Strong reasoning, function calling |
| Agent Framework | LangChain or raw | Keep simple initially |
| API | FastAPI | Clean, async, auto-docs |
| Slack | slack-bolt | Official SDK |

---

## Open Items

1. **Metric tree confirmation** — Review METRICS.md, add your specific definitions
2. **Report samples** — Share sample Excel/PDF exports to build parsers
3. **GL/ASIN catalog** — List of GLs and key ASINs to track
4. **Alert thresholds** — What % change warrants attention?
5. **Access/auth** — Who can query? Any data sensitivity controls?
