# Leadership Autopilot — Roadmap

*Created 2026-02-10 from first-principles review*

## Current State (v0.5)
Strong analytical engine with audited data accuracy, CTC decomposition, Data/Hypothesis boundary, WHAT/WHY response structure, and multi-metric coverage (GMS, Units, ASP, Net PPM, CM, OOS, Traffic). 97 tests passing.

Gap: it's a chat-over-spreadsheet, not yet a leadership tool.

---

## Phase 1: Now

### 1. Multi-Week Data + Trend Lines
- **Why:** Single-week snapshot can't answer "is this getting worse?" or "is this a blip?"
- **What:** Support 4+ weeks of data, compute WoW trends, populate sparklines, enable "compare to last week" queries
- **Impact:** Unlocks trend detection, makes sparklines meaningful, enables real WoW comparison

### 6. Fix Unfinished Dashboard Surfaces
- **Why:** Placeholder data and hardcoded text ("Live - Updated 2h ago", fake movers, empty alerts) erode trust
- **What:** Wire real data to Top 5 Movers, generate real alerts from anomaly detection, show actual data freshness, disable or remove non-functional nav items (History, Settings)
- **Impact:** Dashboard feels real, leaders trust what they see

### 7. Output Artifact / Export
- **Why:** Business Review prep ends with a document. Ephemeral chat with in-memory sessions (lost on restart) means work is lost
- **What:** "Generate BR bridge" button that exports structured narrative. Session persistence (at minimum to disk). Copy/export analysis to clipboard, markdown, or slides format
- **Impact:** Tool produces something leaders can bring to the meeting

---

## Phase 2: Later

### 2. Proactive Insights on Load
- **Why:** Leaders shouldn't have to know what to ask. Tool should surface what matters
- **What:** On dashboard load, show top 3 anomalies with drivers. No typing required
- **Depends on:** #1 (multi-week data for anomaly baselines)

### 3. Automated Data Ingestion
- **Why:** Manual file placement kills adoption for anyone other than the builder
- **What:** Drag-and-drop upload or API pull from source. Auto-detect GL and week from file contents. Validate on upload
- **Impact:** Other people can actually use this

### 4. Waterfall Decomposition
- **Why:** GMS = Traffic x CVR x ASP is THE most powerful Business Review lens. Currently not computed
- **What:** Multiplicative decomposition showing exactly how much of GMS change came from each factor, with computed contributions
- **Depends on:** Traffic + CVR data availability per GL

### 5. Portfolio View Across GLs
- **Why:** Leaders managing multiple GLs need at-a-glance comparison — "which GL needs my attention?"
- **What:** Cross-GL dashboard with heatmap/table of key metrics, ranked by concern level
- **Approach:** Compute from per-GL Excel data (same structure, multiple GL folders). No separate PDF needed — dynamic ranking from existing tools

### 8. Targets / Benchmarks / Plan Variance
- **Why:** "Net PPM is 29.9%" means nothing without context. Is that above plan? Below? On track for quarterly goal?
- **What:** Accept budget/plan/target data, show variance-to-plan alongside actuals
- **Depends on:** Target data format from user

---

## Principles
- Every number must be backed by data (no guessing, no hedging)
- CTC always in bps (ASP exception: inherently in dollars)
- Data vs Hypothesis boundary enforced in all outputs
- Tool should be useful without typing a single question
