# Building Deterministic AI-Powered Business Analytics Tools

## A Technical Architecture Guide

*How to build LLM-powered analysis tools that leaders can trust — with zero hallucinations on data, clear separation of fact from inference, and production-grade accuracy.*

---

## 1. The Problem

Business leaders need fast, accurate analysis of operational metrics (WBR, QBR, financial reviews). Today this is manual: analysts pull Excel files, compute CTCs, write narratives, and present findings. It's slow, inconsistent, and doesn't scale across dozens of business lines.

**The temptation:** Throw an LLM at the spreadsheets and ask it to "analyze this data."

**Why that fails:**
- LLMs hallucinate numbers. They'll confidently cite "$4.2M GMS" when the actual value is $3.8M.
- LLMs can't do reliable math. Ask one to compute a weighted average across 25 subcategories and you'll get a wrong answer.
- LLMs don't understand your business context. "CTC" means nothing without explicit definition.
- LLMs mix up correlation and causation. They'll state hypotheses as facts.

**The right approach:** Use the LLM for what it's good at (pattern recognition, narrative synthesis, question understanding) and keep everything else in deterministic code.

---

## 2. Core Principle: The LLM Reads, It Doesn't Compute

This is the single most important architectural decision. Internalize it.

```
┌─────────────────────────────────────────────────────┐
│                     USER QUESTION                    │
│          "Why did PC margin drop this week?"         │
└───────────────────────┬─────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────┐
│              QUESTION CLASSIFIER (code)              │
│  • Detect metric family (topline vs margin)          │
│  • Detect business line (GL)                         │
│  • Determine data depth needed (subcat? ASIN?)       │
└───────────────────────┬─────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────┐
│              DATA LAYER (deterministic code)          │
│  • Parse Excel files with layout-aware column mapping │
│  • Compute CTCs, YoY deltas, mix/rate decomposition  │
│  • Filter to relevant metrics only                   │
│  • Format as structured markdown tables              │
└───────────────────────┬─────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────┐
│                  LLM CONTEXT WINDOW                  │
│  • System prompt (rules, guardrails, domain context) │
│  • Pre-computed data tables (read-only reference)    │
│  • Response scoping instructions                     │
│  • Conversation history                              │
└───────────────────────┬─────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────┐
│                    LLM RESPONSE                      │
│  • Reads tables, identifies patterns                 │
│  • Synthesizes narrative from pre-computed numbers   │
│  • Labels hypotheses separately from data            │
│  • Follows formatting rules                          │
└─────────────────────────────────────────────────────┘
```

**The LLM never sees raw Excel files.** It receives pre-computed, pre-validated tables. Every number in those tables was computed by your code, tested against known baselines, and verified to be correct.

The LLM's job is to:
1. Understand what the user is asking
2. Read the pre-computed tables in its context
3. Identify the most relevant insights
4. Synthesize a human-readable narrative
5. Clearly separate facts from hypotheses

---

## 3. Architecture Components

### 3.1 Data Ingestion Layer

**What it does:** Reads source files (Excel, CSV, database exports), detects their format, and produces a normalized internal representation.

**Key design decisions:**

**Layout detection is critical.** Business data comes in different Excel formats. You will encounter:
- Files with merged header rows vs flat headers
- Files with 9 columns (simple metrics like GMS) vs 13 columns (margin metrics with mix/rate decomposition)
- Files where column 4 means "Revenue" for most metrics but "Shipped Units" for ASP

Build a layout detector that inspects column count, header names, and known patterns to determine which parser to use. **Make this a hard gate** — if the layout doesn't match any known format, return an error. Never silently parse with the wrong column mapping.

```
function detectLayout(headers, columnCount) {
  if (columnCount === 9) return 'standard';    // GMS, Units
  if (columnCount === 13) return 'margin';     // ASP, Net PPM, CM
  throw new Error(`Unknown layout: ${columnCount} columns`);
}
```

**Column mapping must be explicit and per-metric.** Don't assume column positions are universal.

```
const COLUMN_MAP = {
  standard: {
    value: 2, wowPct: 3, yoyPct: 4,
    wowCtcDollars: 5, wowCtcBps: 6,
    yoyCtcDollars: 7, yoyCtcBps: 8,
  },
  margin: {
    value: 2, numerator: 3, denominator: 4,
    wowBps: 5, yoyBps: 6,
    wowCtcBps: 7, wowMixBps: 8, wowRateBps: 9,
    yoyCtcBps: 10, yoyMixBps: 11, yoyRateBps: 12,
  },
};
```

**Per-metric exceptions must be documented.** In our case, ASP uses the margin layout (13 columns) but column 4 is Shipped Units, not Revenue. Column 6 (YoY) is a percentage, not a bps delta. These exceptions should be explicitly coded and tested.

### 3.2 Computation Engine

**What it does:** Computes derived metrics — CTC (Contribution to Change), weighted averages, mix/rate decomposition, GL-level aggregations.

**Rule: Every computation has a formula, and every formula has a test.**

**CTC Formulas** (three types):

| Type | Use Case | Formula |
|------|----------|---------|
| Non-ratio | GMS, Units | `CTC_bps = (segment_change / total_change) × total_yoy% × 10000` |
| Percentage | Net PPM, CM | `Mix = (P2_mix - P1_mix) × (P1_rate - P1_total_rate) × 10000`<br>`Rate = P2_mix × rate_change × 10000` |
| Per-unit | ASP | Same as percentage but without ×10000 (result in dollars) |

**Why compute CTCs in code instead of relying on pre-computed columns?**

When you consolidate data across business lines, the pre-computed CTCs in source files are relative to each file's total. If you filter to a specific GL, you need to recompute CTCs relative to that GL's total. This requires a computation engine.

**Weighted average pitfall:** When computing GL-level averages for metrics like ASP or Net PPM, you need proper period-specific weights.

```
// WRONG: Using current period (P2) weights for prior period (P1) averages
P1_avg = sum(P2_weight_i × P1_rate_i)  // ← This is wrong!

// RIGHT: Derive P1 weights from the data
P1_units_i = P2_units_i / (1 + units_yoy_pct_i)
P1_ASP = sum(P1_revenue_i) / sum(P1_units_i)
```

This is a subtle but critical bug. If the volume mix shifted between periods (which it almost always does), using P2 weights to average P1 rates will produce incorrect YoY deltas. The error can be significant — we saw ASP YoY computed as +4% when the correct value was +30.6%.

### 3.3 Mapping Layer

**What it does:** Maps subcategories to business lines (GLs), resolves ambiguities, handles shared codes.

When working with consolidated data files that contain all business lines, you need a reliable way to filter rows by GL. This requires a mapping file (subcat code → GL name).

**Matching strategy (by priority):**
1. **Exact name match** (94% of cases) — normalize and compare subcat names
2. **Code suffix match** (3%) — extract GL code from subcat code
3. **Proportional split** (rare) — some subcats belong to multiple GLs; split their values proportionally using revenue weights from the mapping file
4. **"Other" bucket** — unmatched subcats go here; flag them for review

### 3.4 Question Classifier

**What it does:** Analyzes the user's question to determine what data to load into the LLM context.

**Why this matters:** Loading all data for all metrics into the LLM context is wasteful and counterproductive. The LLM will see Net PPM driver tables and talk about margin even when the user asked about topline growth. Scope the context to the question.

**Metric families:**

| Family | Trigger Words | Metrics Loaded |
|--------|--------------|----------------|
| Topline | "GMS", "revenue", "sales", "topline", "units", "volume", "traffic" | GMS, Units, ASP, Traffic, OOS |
| Margin | "margin", "Net PPM", "CM", "profitability", "ASP", "price" | Net PPM, CM, ASP, GMS, Units* |
| General | "what happened", "summary", "overview", both topline + margin terms | All metrics |

*Margin questions still need GMS and Units — you can't explain mix shifts without knowing what's selling and in what volume.

**Data depth:**
- **Summary only** — most questions need just metric totals + subcat drivers
- **ASIN-level** — triggered by "which product", "top ASIN", "deep dive", "drill down"
- **Trend data** — triggered by "trend", "over time", "compared to last week"

**GL detection:**
- Explicit GL names ("PC", "Kitchen") → direct match
- Product keywords ("monitors", "keyboards") → mapped to GL via keyword registry
- Sidebar selection → always overrides keyword detection
- **Beware false positives:** Short abbreviations like "HI" (Home Improvement) will match common words ("this", "hi there"). Require context words or use word-boundary matching.

### 3.5 Context Builder

**What it does:** Assembles the data payload that gets injected into the LLM's system prompt.

**Structure:**

```markdown
## RESPONSE SCOPE: TOPLINE
[Scoping instruction — focus on GMS/Units/ASP, don't discuss margin]

## PC Metric Totals (Week 06)
| Metric | Value | WoW | YoY |
|--------|-------|-----|-----|
| GMS    | $4.04M | +2.3% | +78.7% |
| Units  | 209K   | -1.2% | +35.4% |
| ASP    | $18.94 | +3.6% | +30.2% |
| Net PPM | 32.9% | -85 bps | -1385 bps |  ← Always include totals for awareness
| CM     | -0.7%  | -102 bps | -1035 bps |

### GMS Subcategory Drivers (Total: $4,040,444)
**Key:** "YoY Δ" = subcategory's own change. "YoY CTC" = contribution to GL total.

| Subcategory | Value | YoY Δ | CTC (bps) |
|-------------|-------|-------|-----------|
| LCD Monitors | $805,913 | +478.2% | +2,664 |
| Flash Memory SD | $928,837 | +256.5% | +1,899 |
...
```

**Key design decisions:**

1. **Metric totals always load** (compact, one row per metric) — gives the LLM general awareness even when the response is scoped.

2. **Subcat driver tables are filtered by question family** — topline questions don't see Net PPM/CM driver tables. This prevents unsolicited margin commentary.

3. **CTC and YoY delta are separate columns** — the LLM must understand these are different numbers. CTC = contribution to the total's change (weighted by size). YoY delta = the subcategory's own rate change.

4. **New items (no prior-year data) are flagged explicitly** — ASINs or subcats with null P1 values are tagged as "NEW (no P1 sales)" so the LLM can correctly identify new launches vs existing products.

5. **Table headers include units** — "CTC (bps)" not just "CTC". Prevents the LLM from confusing bps with dollars or percentages.

### 3.6 System Prompt Engineering

This is where you prevent hallucinations. The system prompt is not a suggestion — it's a contract.

**Critical rules to enforce:**

#### Rule 1: Data vs Hypothesis Boundary

```
Every claim you make falls into one of two categories:

DATA (cite freely): Anything you can read directly from the tables.
- Metric values, YoY deltas, CTC numbers
- Rankings and sort order
- Which subcats are top drivers

HYPOTHESIS (must label explicitly): Any inference about WHY something happened.
- "This is likely promo-driven" — you have no promo data
- "Competitive pricing pressure" — you have no competitor data
- "Seasonal effect" — you have no multi-year trend data

Rules:
- Layers 1-2 (what happened, volume vs price) = DATA. State as fact.
- Layers 3-4 (root cause, external factors) = HYPOTHESIS. Always prefix with:
  "Hypothesis (not in data):" or "Possible cause (requires verification):"
- NEVER present a hypothesis as a fact.
```

This is the single most impactful hallucination prevention technique. The LLM will naturally speculate about root causes — that's fine, as long as it labels speculation as such.

#### Rule 2: No Hedging When Data Exists

```
NEVER say "almost certainly", "likely", or "I believe" when the data is
available — just state the fact.

❌ "The single largest decliner is almost certainly LCD Monitors"
✅ "The single largest decliner is LCD Monitors at -445 bps CTC"
```

#### Rule 3: Explicit Missing Data Handling

```
If data is NOT in your context, say so clearly. Never fill gaps with
speculation.

✅ "ASIN-level Net PPM data was not loaded — I can only show
    subcategory-level drivers"
❌ "The ASIN driving this is probably B08TJZDJ4D" (guessing)
```

#### Rule 4: Response Scoping

```
Answer exactly what was asked. Do not volunteer analysis for metrics
the user didn't ask about.

Topline questions → Focus on GMS, Units, ASP. Do NOT discuss Net PPM or CM.
Margin questions → Focus on Net PPM, CM, ASP. Reference GMS/Units only
                   to explain mix shifts.
```

#### Rule 5: Terminology Consistency

```
Only use metric names exactly as they appear in the data:
✅ "Net PPM" or "NetPPMLessSD"
❌ "NPM", "NPPM", or other abbreviations

Never invent abbreviations. Match the source data exactly.
```

### 3.7 Two-Pass Response Formatting (Optional)

For teams that need responses in a specific format (WBR bridge style, executive summary style, etc.):

**Pass 1:** LLM generates analysis using the system prompt and data context. Optimized for accuracy.

**Pass 2:** A separate LLM call reformats the analysis into the user's preferred template. This pass only restructures — it does not add or change any data.

```
Pass 1 (Analysis):    System prompt + Data tables + Question → Raw analysis
Pass 2 (Formatting):  Raw analysis + Format template → Styled output
```

**Why two passes?** Asking the LLM to simultaneously analyze data AND match a specific format degrades accuracy. Separating concerns produces better results on both dimensions.

Users can save named format presets ("WBR Bridge", "Exec Summary", "Deep Dive") and switch between them without re-asking their question.

---

## 4. Hallucination Prevention Checklist

| Technique | What It Prevents | Implementation |
|-----------|-----------------|----------------|
| Pre-computed tables | Math errors | All computations in code, tested against baselines |
| Layout-aware parsing | Wrong column reads | Layout detector as hard gate; per-metric column maps |
| Context scoping | Off-topic commentary | Question classifier filters which metric tables load |
| Data/Hypothesis boundary | Stated-as-fact speculation | System prompt rule with explicit labeling requirement |
| No-hedging rule | Weak language on known data | System prompt rule: state facts, don't hedge |
| Missing data handling | Fabricated numbers | System prompt rule: say what's missing, don't guess |
| Terminology enforcement | Invented abbreviations | System prompt rule: use exact metric names from data |
| Unit labels on columns | bps/$/% confusion | Table headers include "(bps)", "($)", "(%)" |
| CTC vs YoY separation | Metric conflation | Separate columns with explicit definitions in context |
| New item flagging | Misidentifying new products | Tag null-P1 items as "NEW (no P1 sales)" |
| Response scoping | Unsolicited analysis | Dynamic "RESPONSE SCOPE" header in context |
| Accuracy test suite | Regression | Cross-reference every output against raw Excel values |

---

## 5. Testing Strategy

Testing is non-negotiable. Your test suite is the contract that guarantees accuracy.

### 5.1 Data Accuracy Tests

Cross-reference every data function's output against raw Excel cell values.

```javascript
// Read raw Excel directly
const workbook = XLSX.readFile('data/weekly/2026-wk06/ALL/GMS_Week 6_ctc_by_SUBCAT.xlsx');
const rawRow = sheet[rowIndex];

// Read via your data layer
const result = getMetricDrivers('2026-wk06', 'PC', 'GMS');
const driver = result.drivers.find(d => d.subcat_code === '14700510');

// Assert they match
assert(driver.value === rawRow[2], 'GMS value matches raw Excel');
assert(driver.ctc === rawRow[8], 'CTC bps matches raw Excel');
```

**What to test:**
- Every metric × every function (getMetricTotals, getMetricDrivers, getAsinDetail)
- Column mapping for both layouts (standard and margin)
- Sort order (CTC descending)
- Total row computation
- YoY/WoW sign and magnitude
- BPS conversion correctness
- Edge cases: null values, new items, zero denominators

### 5.2 CTC Validation Tests

Compare your CTC engine output against known-good baseline files.

```javascript
// Your engine computes CTC for PC subcats from consolidated ALL data
const computed = computeGLCTC('PC', 'GMS', allData, mapping);

// Baseline: pre-computed values from PC-specific files
const baseline = readExcelFile('data/weekly/2026-wk06/PC/GMS_ctc_by_SUBCAT.xlsx');

// Assert they're close (small rounding differences acceptable)
assert(Math.abs(computed.ctc - baseline.ctc) <= 2, 'CTC within 2 bps');
```

### 5.3 Question Classification Tests

```javascript
assert(classifyFamily('What drove topline growth?') === 'topline');
assert(classifyFamily('Why did margin drop?') === 'margin');
assert(classifyFamily('GMS grew but Net PPM declined') === 'general');  // Both → general
assert(classifyFamily('Give me a summary') === 'general');  // Neither → general
```

### 5.4 GL Detection Tests

```javascript
assert(detectGL('How is PC doing?') === 'PC');
assert(detectGL('What about monitors?') === 'PC');  // keyword mapping
assert(detectGL('This week looks good') === null);   // no false positive on "this"
assert(detectGL('How is the HI GL?') === 'Home Improvement');  // context word required
```

### 5.5 Integration Tests

Test the full pipeline: question → classification → data loading → context building → verify context contains correct tables with correct numbers.

### 5.6 Test Scale

Aim for 200+ tests minimum. Our implementation has 365. The test suite should take seconds to run so it gets run on every change.

---

## 6. Dashboard Architecture

### 6.1 Layout

```
┌──────────┬───────────────────────────────┬──────────┐
│          │                               │          │
│  Left    │        Main Chat Area         │  Right   │
│  Sidebar │                               │  Sidebar │
│          │  ┌─────────────────────────┐   │          │
│  • GL    │  │  Metric Cards + Sparks  │   │ Context  │
│  • Week  │  ├─────────────────────────┤   │ • GL     │
│  • Format│  │                         │   │ • Week   │
│  presets │  │  Streaming Chat         │   │ • Fresh  │
│          │  │  (SSE)                  │   │          │
│          │  │                         │   │ Movers   │
│          │  │                         │   │ • Top 5  │
│          │  │                         │   │          │
│          │  └─────────────────────────┘   │ Tailwinds│
│          │                               │ Headwinds│
│          │  [Ask a question...]           │          │
└──────────┴───────────────────────────────┴──────────┘
```

### 6.2 Key UX Patterns

**Streaming responses (SSE):** Use Server-Sent Events for real-time streaming. The LLM's response appears token-by-token. For two-pass formatting, show a "Formatting..." status between passes.

**Metric cards with sparklines:** Show headline metrics (GMS, Units, ASP, Net PPM, CM) as cards with multi-week sparklines. Data comes from the API, not the LLM.

**Tailwinds / Headwinds sidebar:** Replace generic "alerts" with directionally-coded insights:
- **Tailwinds** (green): positive GMS CTC, positive margin improvements
- **Headwinds** (red): negative GMS CTC, margin compression

This immediately tells leadership what's working and what's not, before they even ask a question.

**GL and Week selectors:** Changing the GL or week in the sidebar resets the conversation context and reloads all dashboard data. The chat is scoped to a single GL × week combination.

### 6.3 Real Data Everywhere

**No placeholder data.** Every number on the dashboard comes from the API, which comes from the Excel files. Metric cards, sparklines, movers, tailwinds/headwinds — all computed from real data.

**Data freshness indicator:** Show when the data was last updated (file modification time). Don't show "Live" or "Updated 2h ago" if you can't verify it.

---

## 7. Data Flow Summary

```
Excel Files (weekly drops)
    │
    ▼
Data Ingestion Layer
    │  • Layout detection (standard vs margin)
    │  • Column mapping (per-metric)
    │  • Normalization (names, codes, values)
    │
    ▼
Computation Engine
    │  • CTC calculation (3 formula types)
    │  • GL-level aggregation (weighted averages)
    │  • Mix/Rate decomposition
    │  • YoY and WoW deltas
    │
    ▼
Mapping Layer
    │  • Subcat → GL resolution
    │  • Shared-code proportional splitting
    │  • "Other" bucket for unmatched
    │
    ▼
Question Classifier
    │  • Metric family (topline/margin/general)
    │  • GL detection (name/keyword/sidebar)
    │  • Data depth (summary/ASIN/trend)
    │
    ▼
Context Builder
    │  • Scoping instruction
    │  • Metric totals table (always)
    │  • Filtered subcat driver tables
    │  • ASIN tables (if requested)
    │  • New item flags
    │
    ▼
LLM (Claude / GPT / Bedrock)
    │  • System prompt (rules, guardrails)
    │  • Pre-computed data (read-only)
    │  • Conversation history
    │
    ▼
Response
    │  • Narrative synthesis
    │  • DATA vs HYPOTHESIS labeling
    │  • Scoped to question
    │
    ▼ (optional)
Format Pass
    │  • Restructure to match template
    │  • No data modification
    │
    ▼
User
```

---

## 8. Common Pitfalls

### Pitfall 1: "Just Let the LLM Read the Excel"
**Don't.** LLMs can't reliably parse tabular data from raw files. They'll misread columns, skip rows, and invent numbers. Pre-process everything.

### Pitfall 2: Loading All Data Into Context
More context ≠ better answers. If you load Net PPM driver tables for a topline question, the LLM will talk about margin. Scope the context.

### Pitfall 3: Trusting LLM Math
Never ask the LLM to compute averages, percentages, or CTCs. It will be close but wrong. Do all math in code.

### Pitfall 4: CTC vs YoY Delta Confusion
These are two different numbers that happen to use the same unit (bps). CTC is weighted by segment size; YoY delta is the segment's own change. If your data tables don't clearly label both, the LLM will conflate them.

### Pitfall 5: Using P2 Weights for P1 Averages
When computing GL-level YoY for weighted-average metrics (ASP, margin rates), you must derive P1 weights from the YoY change data. Using P2 weights produces wrong numbers because the mix shifted.

### Pitfall 6: Hardcoded Column Indices
Excel formats change. What was column 7 last quarter might be column 8 this quarter. Build a layout detector that validates column count and header names. Make it a hard gate.

### Pitfall 7: No Accuracy Tests
Without tests that cross-reference your output against raw Excel values, you have no idea if your data is correct. Build the test suite before the dashboard.

### Pitfall 8: Generic Alerts
An "alert" that shows a big number in red is useless if the big number is positive growth. Split into tailwinds (good) and headwinds (bad). Color-code by business impact, not magnitude.

---

## 9. Deterministic Logic Deep Dive

This section walks through the actual implementation logic — the regex patterns, filtering rules, sorting algorithms, and edge case handling that make the system deterministic.

### 9.1 Excel Parsing and Layout Detection

Raw Excel files are parsed row by row. The first step is detecting which layout the file uses.

```javascript
function readExcelFile(filepath) {
  const workbook = XLSX.readFile(filepath);
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null });
  
  // Skip header rows — some files have 1 header row, some have 2 (merged cells)
  // Detect by checking if row 1 has numeric data or is still headers
  let dataStartRow = 1;
  if (rows.length > 2 && typeof rows[1][2] !== 'number') {
    dataStartRow = 2;  // Two-row merged header
  }
  
  // Detect layout from column count of first data row
  const firstDataRow = rows[dataStartRow];
  const colCount = firstDataRow ? firstDataRow.length : 0;
  
  let layout;
  if (colCount <= 9) {
    layout = 'standard';  // GMS, ShippedUnits: code, name, value, wow%, yoy%, wowCtc$, wowCtcBps, yoyCtc$, yoyCtcBps
  } else if (colCount <= 13) {
    layout = 'margin';    // ASP, NetPPM, CM: code, name, rate, numerator, denominator, wowBps, yoyBps, wowCtc, wowMix, wowRate, yoyCtc, yoyMix, yoyRate
  } else {
    return { error: `Unknown layout: ${colCount} columns in ${filepath}` };
  }
  
  // Parse segments (each row is a subcategory or ASIN)
  const segments = [];
  const totalRow = null;
  
  for (let i = dataStartRow; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row[0] === null || row[0] === undefined) continue;
    
    const code = String(row[0]).trim();
    const name = row[1] ? String(row[1]).trim() : '';
    
    // Detect "Total" row (usually last, code is 'Total' or 'Grand Total')
    if (/^(grand\s*)?total$/i.test(code) || /^(grand\s*)?total$/i.test(name)) {
      totalRow = parseRow(row, layout);
      continue;
    }
    
    segments.push(parseRow(row, layout));
  }
  
  return { segments, total: totalRow, layout: { layout, colCount } };
}
```

**Why this matters:** If you get the column mapping wrong at this layer, every downstream number is wrong. The layout detection is a hard gate — unknown layouts throw errors, they don't silently produce garbage.

### 9.2 File Discovery (Finding the Right Excel File)

Data folders contain files like `GMS_Week 6_ctc_by_SUBCAT.xlsx`, `NetPPMLessSD_Week 6_ctc_by_ASIN.xlsx`, etc. You need to find the right file given a metric name and level (SUBCAT vs ASIN).

```javascript
function findMetricFile(folder, metric, level = 'SUBCAT') {
  const files = fs.readdirSync(folder);
  
  // Normalize metric name for matching
  // Handle aliases: 'NetPPMLessSD' might appear as 'Net PPM Less SD' or 'NPPM' in filenames
  const metricPatterns = {
    'GMS':            /gms/i,
    'ShippedUnits':   /shipped\s*units|units/i,
    'ASP':            /\basp\b/i,
    'NetPPMLessSD':   /net\s*ppm|netppm/i,
    'CM':             /\bcm\b|contribution\s*margin/i,
    'SOROOS_PROCURABLE_PRODUCT_OOS_GV_PCT': /soroos|oos.*gv/i,
    'GV':             /\bgv\b|glance\s*view/i,
  };
  
  const metricRegex = metricPatterns[metric];
  if (!metricRegex) return null;
  
  // Match: metric name + level (SUBCAT or ASIN) in filename
  const levelRegex = new RegExp(level, 'i');
  
  const match = files.find(f => 
    f.endsWith('.xlsx') && 
    metricRegex.test(f) && 
    levelRegex.test(f)
  );
  
  return match ? path.join(folder, match) : null;
}
```

**Edge case:** Some metric names are substrings of others. `CM` matches `CM_Week_6...` but could also false-match a filename containing "DOCUMENT". The `\b` word boundary in the regex prevents this.

### 9.3 GL Detection from Natural Language

When a user types "How is PC doing?" you need to extract "PC" as the GL. When they type "What happened with monitors?" you need to map "monitors" → "PC".

```javascript
function detectGL(question) {
  const q = question.toLowerCase();
  
  // Tier 1: Explicit GL names (highest confidence)
  // Check longest names first to avoid partial matches
  const glNames = [
    { name: 'Home Improvement', patterns: [/\bhome\s*improvement\b/i] },
    { name: 'Major Appliances', patterns: [/\bmajor\s*appliances?\b/i] },
    { name: 'Musical Instruments', patterns: [/\bmusical\s*instruments?\b/i] },
    { name: 'Office Products', patterns: [/\boffice\s*products?\b/i] },
    { name: 'Pet Products', patterns: [/\bpet\s*products?\b/i] },
    { name: 'Lawn and Garden', patterns: [/\blawn\s*(and|&)\s*garden\b/i] },
    { name: 'PC', patterns: [/\bpc\b/i] },
    { name: 'Electronics', patterns: [/\belectronics\b/i] },
    { name: 'Kitchen', patterns: [/\bkitchen\b/i] },
    // ... all GLs
  ];
  
  for (const gl of glNames) {
    for (const pattern of gl.patterns) {
      if (pattern.test(q)) return gl.name;
    }
  }
  
  // Tier 2: Unambiguous product keywords (medium confidence)
  // These keywords uniquely identify a GL
  const productKeywords = [
    { gl: 'PC', keywords: [/\bmonitors?\b/i, /\bkeyboards?\b/i, /\blaptop\b/i, /\bflash\s*memory\b/i, /\busb\s*(hub|drive)/i] },
    { gl: 'Kitchen', keywords: [/\bcookware\b/i, /\bcutlery\b/i, /\bbakeware\b/i] },
    { gl: 'Electronics', keywords: [/\bheadphones?\b/i, /\bspeakers?\b/i, /\bbatteries\b/i] },
    // ... more mappings
  ];
  
  for (const mapping of productKeywords) {
    for (const kw of mapping.keywords) {
      if (kw.test(q)) return mapping.gl;
    }
  }
  
  // Tier 3: Ambiguous keywords (low confidence, last resort)
  // These could belong to multiple GLs — only match with context words
  // "HI" could mean "hello" or "Home Improvement"
  // Only match if adjacent to GL-related words
  const ambiguous = [
    { gl: 'Home Improvement', pattern: /\bhi\b.*\b(gl|business|category)\b|\b(gl|business|category)\b.*\bhi\b/i },
    { gl: 'Musical Instruments', pattern: /\bmi\b.*\b(gl|business|category)\b|\b(gl|business|category)\b.*\bmi\b/i },
  ];
  
  for (const entry of ambiguous) {
    if (entry.pattern.test(q)) return entry.gl;
  }
  
  return null;  // No GL detected — will use sidebar selection or ask user
}
```

**Critical subtlety: Word boundaries.** Without `\b`, the regex for "HI" would match "this", "while", "thinking". Without context-word requirements, "MI" would match "tvs" (Musical Instruments was historically abbreviated MI, but "tvs" is a common substring). The tiered approach prevents these false positives.

**Sidebar always wins.** If the user has selected a GL in the sidebar, that overrides keyword detection. The sidebar is explicit intent; keywords are inferred.

### 9.4 Question Classification (Metric Family)

Determines which metric tables to load into the LLM context.

```javascript
function classifyQuestionFamily(question) {
  const q = question.toLowerCase();
  
  // Check for topline indicators
  const isTopline = /topline|gms\b|revenue|sales|unit|volume|shipped|traffic|gv\b|glance|views|oos\b|out\s*of\s*stock|soroos|roos|availability/i.test(q);
  
  // Check for margin indicators  
  const isMargin = /margin|net\s*ppm|netppm|\bcm\b|contribution\s*margin|profitab|asp\b|price|average\s*sell/i.test(q);
  
  // Decision logic:
  // Both present → general (user is comparing topline to margin)
  // Only topline → topline
  // Only margin → margin
  // Neither → general (broad question like "what happened?")
  if (isTopline && isMargin) return 'general';
  if (isTopline) return 'topline';
  if (isMargin) return 'margin';
  return 'general';
}
```

**Why "both = general":** If someone asks "Why did GMS grow but margin dropped?", they want analysis of both. Loading only topline or only margin tables would miss half the answer.

**Why "neither = general":** Questions like "What happened this week?" or "Any concerns?" don't specify a metric family. Load everything and let the LLM determine what's most important.

The family maps to a specific set of driver tables:

```javascript
function getDriverMetricsForFamily(family) {
  switch (family) {
    case 'topline':
      // No Net PPM, no CM — prevents unsolicited margin commentary
      return ['GMS', 'ShippedUnits', 'ASP', 'SOROOS', 'GV'];
    case 'margin':
      // Includes GMS + Units because you need them to explain mix shifts
      // No traffic, no OOS
      return ['NetPPMLessSD', 'CM', 'ASP', 'GMS', 'ShippedUnits'];
    case 'general':
      return ['GMS', 'ShippedUnits', 'ASP', 'NetPPMLessSD', 'CM', 'SOROOS', 'GV'];
  }
}
```

### 9.5 ASIN-Level Data Depth Detection

Not every question needs ASIN-level data (25 rows per metric, 60+ columns). Detect when the user is drilling down.

```javascript
function needsAsinData(question) {
  const q = question.toLowerCase();
  
  return (
    // Explicit ASIN/product mentions
    /asin|product|sku|item|deep\s*dive|drill|specific\s+product/.test(q)
    // "Top/biggest/worst driver/decliner" patterns
    || /(?:single|top|biggest|largest|highest|worst|best|#1)\b.*\b(?:asin|product|item|driver|decliner|degrader|gainer|contributor|mover|detractor|improver|grower)/.test(q)
    // "Which/what product drove/caused..." patterns
    || /(?:which|what)\b.*\b(?:asin|product|item)\b.*\b(?:driv|caus|declin|degrad|increas|drop|grow|hurt|help|impact)/.test(q)
    // "Largest/biggest decline/increase" (implies ASIN-level detail)
    || /(?:largest|biggest|top|worst|single)\b.*\b(?:declin|degrad|drop|increas|improv|grow|hurt|drag|impact)/.test(q)
    // Explicit drill-down requests
    || /(?:drill|deep\s*dive|break\s*down|decompos)/.test(q)
  );
}
```

**Design choice: Multi-pattern OR.** Each regex targets a different phrasing pattern. Users ask the same question many ways: "What ASIN is dragging margin?" vs "Which product is the biggest decliner?" vs "Drill into Net PPM." The regex set covers natural language variation.

### 9.6 Sorting and Ranking Logic

Every data table is sorted by absolute CTC descending. This ensures the LLM sees the most impactful items first.

```javascript
// Sort subcategory drivers by absolute CTC (biggest impact first)
drivers.sort((a, b) => Math.abs(b.ctc) - Math.abs(a.ctc));

// For ASIN tables: separate existing ASINs (have CTC bps) from new ASINs (null YoY)
const existing = asins.filter(a => a.ctc !== null);
const newAsins = asins.filter(a => a.yoyDelta === null && a.value > 0);

existing.sort((a, b) => Math.abs(b.ctc) - Math.abs(a.ctc));     // by bps CTC
newAsins.sort((a, b) => Math.abs(b.ctcDollars) - Math.abs(a.ctcDollars));  // by dollar impact

// Reserve slots: 20 existing + up to 5 new ASINs
const newSlots = Math.min(5, newAsins.length);
const existingSlots = limit - newSlots;
const combined = [
  ...existing.slice(0, existingSlots),
  ...newAsins.slice(0, newSlots),
];
```

**Why absolute value sort?** A subcategory with CTC of -500 bps is just as important as one with +500 bps. Sorting by absolute value shows the biggest movers regardless of direction. The LLM can then distinguish positive vs negative in its narrative.

**Why separate new ASIN handling?** New ASINs (no prior-year sales) have null bps CTC because you can't compute `segment_change / total_change` when the prior value is zero. But they may have significant dollar impact. Without special handling, all new ASINs would be filtered out and invisible — potentially missing a major growth driver.

### 9.7 CTC Computation (Non-Ratio Example)

CTC answers: "How much did this segment contribute to the total's change?"

```javascript
// Non-ratio CTC (for GMS, Shipped Units — additive metrics)
function computeNonRatioCTC(segmentP2, segmentP1, totalP2, totalP1) {
  const totalChange = totalP2 - totalP1;
  if (totalChange === 0) return 0;
  
  const segmentChange = segmentP2 - segmentP1;
  const totalYoyPct = (totalP2 - totalP1) / totalP1;
  
  // CTC in bps = (segment's share of total change) × (total % change) × 10000
  const ctcBps = Math.round((segmentChange / totalChange) * totalYoyPct * 10000);
  return ctcBps;
}
```

**Percentage CTC (for Net PPM, CM — rate metrics):**

```javascript
function computePercentageCTC(segP2Rate, segP1Rate, segP2Mix, segP1Mix, totalP1Rate) {
  // Mix component: did this segment become a larger/smaller share?
  // Weighted by how different this segment's rate is from the total
  const mixBps = Math.round((segP2Mix - segP1Mix) * (segP1Rate - totalP1Rate) * 10000);
  
  // Rate component: did this segment's rate change?
  // Weighted by current period mix (how big is this segment now)
  const rateBps = Math.round(segP2Mix * (segP2Rate - segP1Rate) * 10000);
  
  return { ctcBps: mixBps + rateBps, mixBps, rateBps };
}
```

**Why mix + rate decomposition matters:** "Net PPM declined 190 bps" is a fact. But WHY? Two possibilities:
- **Mix shift:** Selling more of a low-margin product (the rate didn't change, but the mix did)
- **Rate erosion:** The same products got less profitable (margins dropped across the board)

These require different business responses. Mix shift → review portfolio strategy. Rate erosion → investigate COGS, pricing, promotions.

### 9.8 GL-Level Aggregation (Weighted Average)

When computing GL-level ASP or margin from subcategory data, you must use proper weights.

```javascript
function computeGLAverageASP(subcats, glMapping) {
  let sumP2Revenue = 0, sumP2Units = 0;
  let sumP1Revenue = 0, sumP1Units = 0;
  
  for (const seg of subcats) {
    if (!glMapping.includes(seg.code)) continue;  // Filter to this GL's subcats
    
    const proportion = seg.proportion || 1;  // For shared subcats
    
    // P2 (current period) values — directly from data
    const p2Units = (seg.units || 0) * proportion;
    const p2Revenue = (seg.revenue || 0) * proportion;
    sumP2Revenue += p2Revenue;
    sumP2Units += p2Units;
    
    // P1 (prior period) values — DERIVED from P2 and YoY%
    // This is critical: you can't use P2 weights for P1 averages
    if (seg.unitsYoyPct !== null && seg.unitsYoyPct !== undefined) {
      const p1Units = p2Units / (1 + seg.unitsYoyPct);
      sumP1Units += p1Units;
    }
    if (seg.revenueYoyPct !== null && seg.revenueYoyPct !== undefined) {
      const p1Revenue = p2Revenue / (1 + seg.revenueYoyPct);
      sumP1Revenue += p1Revenue;
    }
  }
  
  const p2ASP = sumP2Units > 0 ? sumP2Revenue / sumP2Units : null;
  const p1ASP = sumP1Units > 0 ? sumP1Revenue / sumP1Units : null;
  const yoyPct = (p2ASP && p1ASP && p1ASP !== 0) 
    ? (p2ASP - p1ASP) / p1ASP 
    : null;
  
  return { value: p2ASP, yoyPct };
}
```

**The P1 derivation pattern:** You don't have P1 values directly — you have P2 values and YoY change percentages. Derive P1:

```
P1 = P2 / (1 + YoY%)

Example: P2 Units = 10,000, Units YoY = +25%
P1 Units = 10,000 / 1.25 = 8,000
```

This works for any metric where you have the current value and the year-over-year change.

### 9.9 Subcat-to-GL Mapping Resolution

Consolidated data files contain all subcategories across all business lines. To analyze a specific GL, you filter by subcat code using a mapping file.

```javascript
function resolveGL(mapping, subcatCode, subcatName) {
  // Strategy 1: Exact code match (most common)
  const exactMatch = mapping.find(m => m.code === subcatCode);
  if (exactMatch && exactMatch.gls.length === 1) {
    return { gl: exactMatch.gls[0], proportion: 1.0 };
  }
  
  // Strategy 2: Shared code — subcat belongs to multiple GLs
  // Split proportionally using GMS weights from mapping
  if (exactMatch && exactMatch.gls.length > 1) {
    return {
      gl: null,  // caller handles multi-GL split
      shared: true,
      proportions: exactMatch.gls.map(g => ({
        gl: g.name,
        proportion: g.gms / exactMatch.totalGms,  // Revenue-weighted split
      })),
    };
  }
  
  // Strategy 3: Code suffix fallback
  // Some codes have GL identifiers as suffixes (e.g., "14700510" → "147" prefix = PC)
  const codePrefix = subcatCode.substring(0, 3);
  const prefixMatch = GL_CODE_PREFIXES[codePrefix];
  if (prefixMatch) return { gl: prefixMatch, proportion: 1.0 };
  
  // Strategy 4: Name matching (fuzzy, last resort)
  const normalized = subcatName.toLowerCase().replace(/[^a-z0-9]/g, '');
  const nameMatch = mapping.find(m => 
    m.normalizedName === normalized
  );
  if (nameMatch) return { gl: nameMatch.gl, proportion: 1.0 };
  
  // Unmatched — goes to "Other" bucket
  return { gl: 'Other', proportion: 1.0, unmatched: true };
}
```

**Shared subcategories:** Some subcategory codes appear in multiple GLs (e.g., "UNKNOWN" or "Laptop Cases" might span PC and Electronics). You can't just pick one — split the values proportionally using GMS weights from the mapping file. If PC accounts for 60% of that subcat's total GMS and Electronics 40%, apply those proportions.

### 9.10 Tailwinds vs Headwinds Classification

Not all positive numbers are good, and not all negative numbers are bad. The classification depends on the metric.

```javascript
function classifyWind(metric, ctcValue) {
  // For most metrics: positive CTC = tailwind, negative CTC = headwind
  // Exception: SOROOS (Share of Rate of OOS)
  //   Positive SOROOS CTC = MORE out-of-stock = headwind (bad)
  //   Negative SOROOS CTC = LESS out-of-stock = tailwind (good)
  
  const invertedMetrics = ['SOROOS_PROCURABLE_PRODUCT_OOS_GV_PCT'];
  const isInverted = invertedMetrics.includes(metric);
  
  if (isInverted) {
    return ctcValue > 0 ? 'headwind' : 'tailwind';
  }
  return ctcValue > 0 ? 'tailwind' : 'headwind';
}
```

**Why this matters for UX:** A dashboard that shows "+500 bps SOROOS CTC" in green (positive = good?) is misleading. More OOS is bad. The classification logic ensures the UI tells the right story.

### 9.11 Data Freshness Detection

No fake "Updated 2h ago" labels. Check actual file modification times.

```javascript
function getDataFreshness(week) {
  const weekDir = path.join(DATA_DIR, 'weekly', week);
  if (!fs.existsSync(weekDir)) return { fresh: false, label: 'No data' };
  
  // Find the most recently modified file in the week folder
  let latestMtime = 0;
  function walkDir(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walkDir(fullPath);
      } else if (entry.name.endsWith('.xlsx')) {
        const stat = fs.statSync(fullPath);
        if (stat.mtimeMs > latestMtime) latestMtime = stat.mtimeMs;
      }
    }
  }
  walkDir(weekDir);
  
  const ageMinutes = (Date.now() - latestMtime) / 60000;
  const label = ageMinutes < 60 
    ? `Updated ${Math.round(ageMinutes)}m ago`
    : ageMinutes < 1440 
      ? `Updated ${Math.round(ageMinutes / 60)}h ago`
      : `Updated ${Math.round(ageMinutes / 1440)}d ago`;
  
  return { fresh: ageMinutes < 10080, updatedAt: new Date(latestMtime).toISOString(), ageMinutes, label };
}
```

### 9.12 New Item Detection (No Prior-Year Sales)

ASINs or subcategories with zero P1 sales have null YoY percentages in the data. These are either new launches or items that were unavailable last year.

```javascript
function processAsins(segments, layout) {
  return segments.map(seg => {
    const yoyDelta = layout === 'margin' ? seg.yoyBps : seg.yoyPct;
    const isNew = (yoyDelta === null || yoyDelta === undefined);
    
    return {
      asin: seg.code,
      name: seg.name,
      value: seg.value,
      yoyDelta: isNew ? null : yoyDelta,
      ctcBps: seg.yoyCtcBps,         // null for new items (can't compute bps CTC)
      ctcDollars: seg.yoyCtcDollars,  // equals P2 value for new items (P1 was $0)
      isNew,
    };
  });
}
```

**Why track dollar CTC separately:** For existing items, bps CTC is the right ranking metric (normalizes for scale). For new items, bps CTC is undefined (division by zero). Dollar CTC tells you the absolute impact — "This ASIN contributed $165K of incremental GMS."

**Context rendering for the LLM:**

```
| ASIN | Product | Value | YoY Δ | CTC |
|------|---------|-------|-------|-----|
| B01FV0F13E | Amazon Basics HDMI Cable | $892K | +34.2% | +191 bps |
| B07K8WHH5J | Flash Memory SD 256GB | $412K | +89.1% | +111 bps |
| ⚡ NEW: B0DSH5V1TT | Amazon Basics Cardstock Paper | $165K | NEW (no P1) | $165.0K |
```

The "NEW" flag tells the LLM to state the fact ("no prior-year sales") and the two possible causes ("new launch or was unavailable last year") as a hypothesis — not assume it's a new launch.

### 9.13 Auto-Discovery of New Week Data

When someone drops a new `data/weekly/2026-wk07/ALL/` folder, the system should pick it up automatically.

```javascript
function listWeeks() {
  const weeklyDir = path.join(DATA_DIR, 'weekly');
  if (!fs.existsSync(weeklyDir)) return { weeks: [] };
  
  const weeks = fs.readdirSync(weeklyDir)
    .filter(d => /^\d{4}-wk\d{2}$/.test(d))   // Match "2026-wk06" pattern
    .filter(d => fs.statSync(path.join(weeklyDir, d)).isDirectory())
    .sort()
    .reverse();  // Most recent first
  
  return { weeks };
}
```

No code changes needed to add new weeks. Drop the folder, refresh the dashboard, new week appears in the selector. Trends and sparklines automatically extend.

### 9.14 Format Template Two-Pass System

Pass 1 (analysis) uses the full system prompt with data tables. Pass 2 (formatting) takes the analysis output and restructures it.

```javascript
// Pass 1: Generate analysis (optimized for accuracy)
const analysis = await llm.chat(systemPrompt + dataContext, [
  ...conversationHistory,
  { role: 'user', content: question }
]);

// Pass 2: Reformat (only if user has a format template active)
if (formatTemplate) {
  const reformatPrompt = `You are a formatting assistant. Your ONLY job is to restructure 
the analysis below to match the user's preferred format.

Rules:
- Do NOT add new data, numbers, or analysis
- Do NOT remove any data points or findings
- ONLY change structure, style, and presentation
- If the format uses tables, convert to tables
- If the format uses bullets, convert to bullets
- Preserve all numbers exactly as they appear`;

  const formatted = await llm.chat(reformatPrompt, [{
    role: 'user',
    content: `Analysis:\n${analysis}\n\nFormat template:\n${formatTemplate}`
  }]);
  
  return formatted;
}

return analysis;
```

**Why two passes:** Asking one LLM call to simultaneously (a) analyze data accurately and (b) match a specific format degrades both. The analysis pass focuses on accuracy. The format pass focuses on presentation. Neither compromises.

---

## 10. Technology Stack (Recommended)

| Component | Technology | Why |
|-----------|-----------|-----|
| Backend | Node.js / Express | Simple, fast, good Excel library support |
| Excel Parsing | `xlsx` (SheetJS) | Handles merged headers, formulas, all Excel formats |
| LLM | Claude (Anthropic) or GPT (OpenAI) via Bedrock | Strong instruction following, good at reading tables |
| Frontend | Next.js + Tailwind | Fast to build, good streaming support (SSE) |
| Charts | Recharts or Victory | Sparklines, trend charts |
| Streaming | Server-Sent Events (SSE) | Simpler than WebSockets for one-way streaming |
| Persistence | JSON files or SQLite | No database server needed for MVP |
| Testing | Plain Node.js assert or Vitest | Fast execution, no test framework overhead |

---

## 11. Phased Rollout

### Phase 1: Foundation (2-3 weeks)
- Data ingestion for one metric (GMS)
- Layout detection + column mapping
- Basic question → pre-computed context → LLM → response
- System prompt with hallucination guardrails
- 50+ accuracy tests
- Single GL, single week

### Phase 2: Full Metrics (2 weeks)
- All metrics (GMS, Units, ASP, Net PPM, CM, Traffic, OOS)
- CTC computation engine
- Multi-GL support with mapping
- Question classification (topline/margin/general)
- Dashboard with metric cards and chat
- 150+ tests

### Phase 3: Intelligence (2 weeks)
- Multi-week trends + sparklines
- ASIN-level drill-down
- Tailwinds/headwinds sidebar
- Export and session persistence
- Format presets
- 300+ tests

### Phase 4: Scale (ongoing)
- Automated data ingestion (no manual file drops)
- Proactive insights (scheduled analysis)
- Portfolio view (cross-GL comparison)
- Waterfall decomposition visualization
- Targets and benchmarks

---

## 12. Key Metrics for the Tool Itself

How do you know the tool is working?

| Metric | Target | How to Measure |
|--------|--------|---------------|
| Data accuracy | 100% of stated numbers match source | Automated test suite, run on every change |
| Hypothesis labeling | 0 unlabeled hypotheses | Spot-check LLM responses against data/hypothesis rules |
| Response relevance | <5% off-topic content | User feedback, question-family scoping |
| Latency | <5s for summary, <10s for deep dive | API response time logging |
| Test coverage | 300+ tests, all passing | CI/CD pipeline |

---

## 13. Summary

Building a trustworthy AI analytics tool is not about finding the right LLM. It's about building the right architecture around it.

**The formula:**
1. **Deterministic data layer** — every number computed in code, tested against source
2. **Smart context scoping** — load only what's relevant to the question
3. **Strict system prompt** — data/hypothesis boundary, no hedging, explicit gaps
4. **Comprehensive testing** — cross-reference every output against raw data
5. **Directional UX** — tailwinds/headwinds, not generic alerts

The LLM is the narrator, not the analyst. Your code is the analyst. Get that right and leadership will trust the tool — because the tool will deserve that trust.

---

*Architecture based on production implementation with 365 tests, zero data accuracy issues, across 22 business lines and 7 metrics.*
