# Architecture

## Overview

Leadership Autopilot is a conversational AI agent for WBR (Weekly Business Review) analysis. It combines structured data extraction with LLM reasoning to answer business questions.

```
┌─────────────────────────────────────────────────────────────────┐
│                         User Interface                          │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  Web UI (localhost:3456)  │  CLI (npm run cli)          │   │
│  └─────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                         Express Server                          │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐  │
│  │ API Routes   │  │ Session Mgmt │  │ Streaming (SSE)      │  │
│  │ /api/ask     │  │ Per-user     │  │ Token-by-token       │  │
│  │ /api/stream  │  │ context      │  │ response             │  │
│  └──────────────┘  └──────────────┘  └──────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                                │
                    ┌───────────┴───────────┐
                    ▼                       ▼
┌───────────────────────────┐  ┌───────────────────────────────────┐
│      Data Layer           │  │          LLM Layer                │
│  ┌─────────────────────┐  │  │  ┌─────────────────────────────┐  │
│  │ tools.js            │  │  │  │ llm.js                      │  │
│  │ - getAllSubcatData  │  │  │  │ - Anthropic (Claude)        │  │
│  │ - getMetricDrivers  │  │  │  │ - OpenAI (GPT-4)            │  │
│  │ - getSummary        │  │  │  │ - Google (Gemini)           │  │
│  │ - getAsinDetail     │  │  │  │ - AWS Bedrock               │  │
│  └─────────────────────┘  │  │  └─────────────────────────────┘  │
│           │               │  │               │                   │
│           ▼               │  │               ▼                   │
│  ┌─────────────────────┐  │  │  ┌─────────────────────────────┐  │
│  │ Excel/CSV Files     │  │  │  │ Streaming Response          │  │
│  │ data/weekly/...     │  │  │  │ Token-by-token via SSE      │  │
│  └─────────────────────┘  │  │  └─────────────────────────────┘  │
└───────────────────────────┘  └───────────────────────────────────┘
```

## Data Flow

### 1. User Asks a Question

```
User: "Why did PC GMS grow this week?"
       │
       ▼
┌──────────────────────────────────────────────────────────────┐
│ Frontend (index.html)                                        │
│ - Captures question                                          │
│ - Includes selected GL (if any) and week                     │
│ - Sends POST /api/ask/stream                                 │
└──────────────────────────────────────────────────────────────┘
       │
       ▼
┌──────────────────────────────────────────────────────────────┐
│ Server (server.js)                                           │
│ 1. Get or create session                                     │
│ 2. Detect GL from question (or use selected GL)              │
│ 3. Determine data needs                                      │
│ 4. Build context (load data)                                 │
│ 5. Call LLM with streaming                                   │
│ 6. Stream response back via SSE                              │
└──────────────────────────────────────────────────────────────┘
```

### 2. Context Building (Deterministic)

```
buildContext(week, gl, question, dataNeeds)
       │
       ▼
┌──────────────────────────────────────────────────────────────┐
│ ALWAYS LOADED:                                               │
│ ├── Summary (_summary.md)                                    │
│ └── All Subcat Data (getAllSubcatData)                       │
│     └── 27 subcats × 5 metrics = ~150 data points            │
│                                                              │
│ OPTIONALLY LOADED:                                           │
│ ├── ASIN Detail (if "drill down" or "specific product")      │
│ └── Traffic Channels (if "traffic" or "GV" mentioned)        │
└──────────────────────────────────────────────────────────────┘
       │
       ▼
┌──────────────────────────────────────────────────────────────┐
│ Context sent to LLM (~5KB, ~1000 tokens):                    │
│                                                              │
│ ## PC Summary (Week wk05)                                    │
│ [Summary markdown]                                           │
│                                                              │
│ ## Complete Subcategory Data                                 │
│ | Subcategory | GMS | GMS YoY | Units | Units YoY | ... |   │
│ |-------------|-----|---------|-------|-----------|-----|   │
│ | LCD Monitors| $683K| 338.6% | 7,935 | 472.9%   | ... |   │
│ | Flash SD    | $846K| 86.5%  | 37,686| 16.5%    | ... |   │
│ | ...         | ...  | ...    | ...   | ...      | ... |   │
└──────────────────────────────────────────────────────────────┘
```

### 3. LLM Response Format

```
LLM generates response in WHAT/WHY format:
       │
       ▼
┌──────────────────────────────────────────────────────────────┐
│ **WHAT:**                                                    │
│ - PC GMS grew +66% YoY driven by LCD Monitors (+$683K)       │
│ - Flash Memory (SD + microSD) contributed +$1.3M combined    │
│ - Margin compressed -190 bps due to mix shift                │
│                                                              │
│ **WHY:**                                                     │
│ LCD Monitors saw exceptional growth driven by...             │
│ [Detailed analysis with tables and root causes]              │
└──────────────────────────────────────────────────────────────┘
       │
       ▼
┌──────────────────────────────────────────────────────────────┐
│ Frontend renders:                                            │
│ ┌────────────────────────────────────────────────────────┐   │
│ │ • PC GMS grew +66% YoY driven by LCD Monitors         │   │
│ │ • Flash Memory contributed +$1.3M combined            │   │
│ │ • Margin compressed -190 bps                          │   │
│ │                                                        │   │
│ │ ┌────────────────────────────────────────────────────┐│   │
│ │ │ ▶ Show reasoning (WHY)                             ││   │
│ │ └────────────────────────────────────────────────────┘│   │
│ └────────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────┘
```

## Session Management

```
Sessions Map (in-memory)
       │
       ▼
┌──────────────────────────────────────────────────────────────┐
│ sessionId: "web-1707350400000"                               │
│ ├── currentGL: "pc"                                          │
│ ├── currentWeek: "2026-wk05"                                 │
│ ├── conversationHistory: [                                   │
│ │   { role: "user", content: "Why did PC grow?" },           │
│ │   { role: "assistant", content: "**WHAT:**..." },          │
│ │   { role: "user", content: "What about margin?" },         │
│ │   { role: "assistant", content: "**WHAT:**..." },          │
│ │ ]                                                          │
│ └── loadedData: { ... }                                      │
└──────────────────────────────────────────────────────────────┘
```

### Session Behavior

| Scenario | Action |
|----------|--------|
| New question about same GL | Keep history, continue conversation |
| Question about different GL | Clear history, switch context |
| Cross-GL question ("summarize all") | Load all GL summaries, reset context |
| Reset button clicked | Clear session, start fresh |

## GL Detection

```
Priority order for determining GL:

1. Explicit selection (user clicked dropdown)
   └── requestedGL parameter in API call

2. Detected from question
   └── Pattern matching: /pc|computer|laptop|monitor/i → "pc"

3. Current session context
   └── session.currentGL (from previous question)

4. Ask for clarification
   └── "Which GL would you like me to analyze?"
```

## File Structure Detail

### Data Files

```
data/weekly/2026-wk05/gl/pc/
├── _manifest.yaml           # Lists available files and metrics
├── _summary.md              # Auto-generated summary
├── GMS_Week 5_ctc_by_SUBCAT.xlsx
├── GMS_Week 5_ctc_by_ASIN.xlsx
├── ShippedUnits_Week 5_ctc_by_SUBCAT.xlsx
├── ShippedUnits_Week 5_ctc_by_ASIN.xlsx
├── ASP_Week 5_ctc_by_SUBCAT.xlsx
├── ASP_Week 5_ctc_by_ASIN.xlsx
├── NetPPMLessSD_Week 5_ctc_by_SUBCAT.xlsx
├── NetPPMLessSD_Week 5_ctc_by_ASIN.xlsx
├── CM_Week 5_ctc_by_SUBCAT.xlsx
├── CM_Week 5_ctc_by_ASIN.xlsx
└── GVs_By_Week_*.csv        # Traffic data
```

### Manifest Structure

```yaml
# _manifest.yaml
gl: pc
week: "2026-wk05"
generated: "2026-02-07T13:16:00"

metrics_available:
  - GMS
  - ShippedUnits
  - ASP
  - NetPPMLessSD
  - CM

files:
  subcat:
    GMS: GMS_Week 5_ctc_by_SUBCAT.xlsx
    ShippedUnits: ShippedUnits_Week 5_ctc_by_SUBCAT.xlsx
    # ...
  asin:
    GMS: GMS_Week 5_ctc_by_ASIN.xlsx
    # ...
```

## Key Design Decisions

### 1. Deterministic Data Loading
**Decision**: Always load all subcat data, not selective loading.

**Rationale**:
- Eliminates "I don't have that data" errors
- Pattern matching was missing edge cases (USB Hubs, Speakers, etc.)
- Context size is manageable (~1000 tokens)
- Simpler, more reliable

### 2. WHAT/WHY Response Format
**Decision**: Structure all responses with WHAT first, WHY expandable.

**Rationale**:
- Executives want the answer immediately
- Details can be explored on demand
- Reduces perceived response time with streaming

### 3. Streaming Responses
**Decision**: Stream tokens as they're generated via SSE.

**Rationale**:
- WHAT section appears in ~2-3 seconds
- User sees progress immediately
- Better UX for 20+ second responses

### 4. Multi-Provider LLM Abstraction
**Decision**: Support multiple LLM providers with unified interface.

**Rationale**:
- Flexibility to switch providers
- Cost optimization
- Bedrock for enterprise/AWS integration

### 5. In-Memory Sessions
**Decision**: Store sessions in memory (Map), not database.

**Rationale**:
- Simple for MVP
- Stateless restart is acceptable
- Can add persistence later if needed

## Future Considerations

### Short-term
- [ ] Add more GLs (Toys, Office, Home, Pets)
- [ ] Week selector dropdown
- [ ] Persist sessions to file/DB
- [ ] Add user authentication

### Medium-term
- [ ] Historical comparison (WoW, MoM, YoY trends)
- [ ] Automated anomaly detection
- [ ] Email/Slack notifications
- [ ] Export to PDF/Slides

### Long-term
- [ ] Multi-week analysis
- [ ] Forecasting integration
- [ ] Action item tracking
- [ ] Integration with data pipeline
