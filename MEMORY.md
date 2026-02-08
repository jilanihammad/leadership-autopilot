# Memory System — Leadership Autopilot

## Overview

The memory system gives the agent **institutional knowledge** — the kind of context that lives in experienced analysts' heads but never makes it into spreadsheets.

Two core types:
1. **Episodic Memory** — What happened (events, decisions, outcomes)
2. **Domain Knowledge** — Why things happen (causal rules, nuances, patterns)

---

## Part 1: Domain Knowledge Base

### Purpose
Capture business nuances that help the agent generate better hypotheses. This is knowledge that:
- Doesn't exist in Excel/reports
- Comes from experience and tribal knowledge
- Helps narrow down root causes faster

### Knowledge Types

#### 1.1 Causal Rules (If-Then Heuristics)
Structured rules the agent checks when diagnosing issues.

```yaml
# Example causal rules
causal_rules:
  - id: cvr_asp_inverse
    trigger:
      metric: cvr
      direction: down
    check:
      metric: asp
      direction: up
      same_period: true
    explanation: "CVR often drops when ASP increases — price sensitivity"
    confidence: 0.85
    applies_to: [all]  # or specific GLs

  - id: cvr_shipping_delay
    trigger:
      metric: cvr
      direction: down
    check:
      metric: shipping_estimate_days
      direction: up
    explanation: "Longer shipping estimates reduce conversion — check inventory regionalization or FC capacity"
    confidence: 0.80
    applies_to: [all]

  - id: cvr_inventory_regionalization
    trigger:
      metric: cvr
      direction: down
    check:
      condition: "in_stock_rate > 95% AND shipping_estimate_days > 5"
    explanation: "High in-stock but slow shipping suggests inventory is concentrated in distant FCs — regionalization issue"
    confidence: 0.75
    applies_to: [all]

  - id: traffic_search_rank
    trigger:
      metric: glance_views
      direction: down
      threshold: 0.10  # >10% drop
    check:
      metric: search_rank_top_keywords
      direction: down
    explanation: "Traffic drops often correlate with organic search rank loss — check keyword positions"
    confidence: 0.90
    applies_to: [all]

  - id: buy_box_competitor_price
    trigger:
      metric: buy_box_pct
      direction: down
    check:
      metric: price_vs_competition
      condition: "our_price > competitor_price"
    explanation: "Lost Buy Box usually means competitor undercut on price"
    confidence: 0.95
    applies_to: [all]

  - id: cvr_review_velocity
    trigger:
      metric: cvr
      direction: down
    check:
      metric: negative_review_count_7d
      threshold: 3
    explanation: "Multiple negative reviews in a short period tanks CVR — check for product/fulfillment issues"
    confidence: 0.70
    applies_to: [all]

  - id: nppm_storage_q4
    trigger:
      metric: nppm
      direction: down
      period: [oct, nov, dec]
    check:
      metric: storage_fees
      direction: up
    explanation: "Q4 storage fees spike due to peak season surcharges — expected pattern"
    confidence: 0.95
    applies_to: [all]

  - id: gms_prime_day_hangover
    trigger:
      metric: gms
      direction: down
      period: [july_week_3, july_week_4]
    check:
      condition: "prime_day was within 14 days"
    explanation: "Post-Prime Day demand pull-forward — customers bought early, expect 2-3 week recovery"
    confidence: 0.85
    applies_to: [all]
```

#### 1.2 GL/Category Profiles
Characteristics specific to product lines that affect analysis.

```yaml
gl_profiles:
  GL3:
    name: "Widgets"
    characteristics:
      price_sensitivity: high  # Small price changes = big CVR impact
      seasonality: "Q4 heavy, summer slow"
      typical_nppm: 0.12  # 12% baseline
      key_competitors: ["BrandX", "BrandY"]
      notes:
        - "Commoditized category — Buy Box is everything"
        - "Prime badge critical — FBM won't convert"
        - "Customers compare across 3-4 listings before buying"
    
  GL5:
    name: "Premium Gadgets"
    characteristics:
      price_sensitivity: low  # Customers less price-driven
      seasonality: "Flat, slight Q4 lift"
      typical_nppm: 0.22
      key_competitors: ["PremiumCo"]
      notes:
        - "Brand matters more than price"
        - "A+ content and video significantly impact CVR"
        - "Longer consideration cycle — traffic doesn't convert same-day"
        - "Review quality > review quantity"

  GL7:
    name: "Consumables"
    characteristics:
      price_sensitivity: medium
      seasonality: "Steady, holiday gifting bump"
      typical_nppm: 0.08
      subscribe_save_heavy: true
      notes:
        - "S&S is 40% of volume — churn rate matters"
        - "Coupon stacking common — watch margin erosion"
        - "Expiration date issues can spike returns"
```

#### 1.3 ASIN-Specific Knowledge
Tribal knowledge about individual products.

```yaml
asin_profiles:
  B00ABC123:
    title: "Widget Pro 2000"
    gl: GL3
    notes:
      - "Our hero SKU — 30% of GL3 revenue"
      - "Highly seasonal: 3x volume in Q4"
      - "Price floor is $22 — below that, margin goes negative"
      - "Competitor BrandX launched knockoff in Sept 2025 — monitor closely"
      - "Review rating dropped from 4.5 to 4.2 after supplier change in Aug 2025"
    sensitivities:
      - "CVR very sensitive to Prime badge — loses 40% conversion without it"
      - "Buy Box loss = immediate 60% traffic drop (customers filter Prime)"
    historical_issues:
      - date: 2025-10-15
        issue: "Went OOS due to supplier delay"
        impact: "Lost $50K GMS over 2 weeks"
        resolution: "Diversified to backup supplier"

  B00DEF456:
    title: "Widget Lite"
    gl: GL3
    notes:
      - "Entry-level product, low margin but drives new customers"
      - "Often bundled — check bundle attach rate"
    sensitivities:
      - "Cannibalizes B00ABC123 when promo'd — be careful with discounts"
```

#### 1.4 Metric Nuances
Subtleties about how to interpret metrics.

```yaml
metric_notes:
  cvr:
    general:
      - "CVR = Orders / Glance Views — but GV can include bots/scrapers"
      - "Mobile vs Desktop CVR differs significantly — mobile is 30% lower"
      - "CVR benchmarks vary wildly by category"
    
    interpretation_rules:
      - "CVR drop + no other changes → check for listing suppression or A+ content issues"
      - "CVR drop + traffic up → might be low-quality traffic (broad ads)"
      - "CVR stable + GMS down → it's a traffic or ASP issue, not conversion"

  glance_views:
    general:
      - "Glance Views ≠ Sessions — one session can have multiple GV"
      - "PPC traffic shows in GV but may be tagged differently in some reports"
    
    interpretation_rules:
      - "GV down + ad spend stable → organic traffic issue"
      - "GV down sharply (>30%) → check for listing suppression"
      - "GV up + orders flat → traffic quality issue"

  nppm:
    general:
      - "NPPM = (GMS - PCOGS) / GMS"
      - "PCOGS includes product cost, fees, and sometimes ad spend (verify definition)"
    
    interpretation_rules:
      - "NPPM down + GMS up → check if we're buying growth with promos"
      - "NPPM down + GMS stable → cost increase (fees, COGS, returns)"
      - "NPPM varies by channel — 1P vs 3P, FBA vs FBM have different structures"
```

#### 1.5 External Factors
Things outside the data that affect performance.

```yaml
external_factors:
  events:
    - name: "Prime Day"
      typical_dates: ["July week 2", "October week 2"]
      effects:
        - "GMS spike 2-5x during event"
        - "NPPM compression due to deals"
        - "Post-event demand hangover for 2-3 weeks"
        - "Competitor deals can steal share even if we don't participate"
    
    - name: "Q4 Peak"
      typical_dates: ["Nov 15 - Dec 31"]
      effects:
        - "Storage fees increase 3x"
        - "Shipping capacity constraints"
        - "Customer expectations for fast delivery higher"
        - "Returns spike in January"

  market_dynamics:
    - "New competitor launches typically take 2-3 weeks to show impact"
    - "Amazon algorithm changes can cause sudden rank shifts"
    - "Category Best Seller rank resets can shuffle visibility"

  known_issues:
    - "Amazon reporting delay: data can lag 24-48 hours"
    - "GMS in Business Reports may not match Payments Reports (timing)"
    - "Advertising attributed sales have 7-day lookback — compare carefully"
```

---

## Part 2: Episodic Memory

### Purpose
Remember what happened, what we did, and whether it worked.

### 2.1 Weekly Snapshots
```sql
CREATE TABLE weekly_snapshots (
    id INTEGER PRIMARY KEY,
    week_start DATE NOT NULL,
    gl VARCHAR(50),
    
    -- Key metrics
    gms DECIMAL(18,2),
    gms_wow_delta DECIMAL(10,4),
    nppm DECIMAL(10,4),
    nppm_wow_delta DECIMAL(10,4),
    
    -- LLM-generated content
    summary TEXT,           -- "GL3 had a tough week due to..."
    root_causes JSON,       -- [{metric: "cvr", cause: "lost buy box", confidence: 0.9}]
    recommendations JSON,   -- [{action: "reprice B00ABC", priority: "high"}]
    
    -- For semantic search
    embedding BLOB,         -- Vector embedding of summary
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### 2.2 Decisions & Outcomes
```sql
CREATE TABLE decisions (
    id INTEGER PRIMARY KEY,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    -- What
    gl VARCHAR(50),
    asin VARCHAR(20),
    action_type VARCHAR(50),    -- "reprice", "restock", "promo", "content_update"
    action_description TEXT,     -- "Lowered price from $29.99 to $26.99"
    rationale TEXT,              -- "Competitor undercut us by $3"
    
    -- Outcome tracking
    expected_outcome TEXT,       -- "Recover Buy Box within 48h"
    actual_outcome TEXT,         -- Filled in later
    outcome_date DATE,
    success BOOLEAN,
    
    -- Learnings
    learnings TEXT,              -- "Price matching works but took 5 days not 2"
    
    -- Link to analysis that prompted this
    source_snapshot_id INTEGER REFERENCES weekly_snapshots(id)
);
```

### 2.3 Confirmed Patterns
When a hypothesis is validated, save it for future reference.

```sql
CREATE TABLE confirmed_patterns (
    id INTEGER PRIMARY KEY,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    pattern_type VARCHAR(50),    -- "cause_effect", "seasonality", "threshold"
    description TEXT,            -- "For GL3, CVR drops >5% when ASP increases >3%"
    
    -- Scope
    gl VARCHAR(50),              -- NULL = applies to all
    asin VARCHAR(20),            -- NULL = applies to GL level
    
    -- Confidence tracking
    times_observed INTEGER DEFAULT 1,
    times_confirmed INTEGER DEFAULT 1,
    last_confirmed DATE,
    confidence DECIMAL(3,2),     -- 0.00 to 1.00
    
    -- Evidence
    evidence JSON                -- [{date, snapshot_id, description}]
);
```

### 2.4 Open Items / Pending Actions
```sql
CREATE TABLE pending_actions (
    id INTEGER PRIMARY KEY,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    gl VARCHAR(50),
    asin VARCHAR(20),
    
    action TEXT,                 -- "Waiting for restock shipment"
    expected_date DATE,
    
    status VARCHAR(20),          -- "pending", "done", "cancelled", "overdue"
    resolved_at TIMESTAMP,
    resolution_notes TEXT
);
```

---

## Part 3: Memory Retrieval

### How the Agent Uses Memory

When analyzing a metric change, the agent:

1. **Checks causal rules** — "CVR is down. Do any rules match?"
   ```python
   matching_rules = memory.get_causal_rules(
       trigger_metric="cvr",
       trigger_direction="down",
       gl="GL3"
   )
   # Returns rules about ASP, shipping, reviews, etc.
   ```

2. **Retrieves GL/ASIN profile** — "What do I know about this product?"
   ```python
   context = memory.get_entity_profile(gl="GL3", asin="B00ABC123")
   # Returns sensitivities, historical issues, notes
   ```

3. **Searches episodic memory** — "Have we seen this before?"
   ```python
   similar_episodes = memory.search_similar_situations(
       symptoms=["cvr_down", "buy_box_lost"],
       gl="GL3",
       limit=5
   )
   # Returns past weeks with similar patterns + what we did
   ```

4. **Checks pending actions** — "Are we waiting on something?"
   ```python
   pending = memory.get_pending_actions(gl="GL3")
   # Returns "Restock arriving Feb 15" etc.
   ```

5. **Checks decision outcomes** — "Did our last fix work?"
   ```python
   recent_decisions = memory.get_recent_decisions(gl="GL3", days=30)
   # Returns what we tried and whether it helped
   ```

### Retrieval Functions

```python
class MemorySystem:
    
    # Domain knowledge retrieval
    def get_causal_rules(
        self, 
        trigger_metric: str, 
        trigger_direction: str,
        gl: str = None
    ) -> list[CausalRule]:
        """Get rules that might explain this metric movement"""
    
    def get_entity_profile(
        self, 
        gl: str = None, 
        asin: str = None
    ) -> EntityProfile:
        """Get everything we know about this GL/ASIN"""
    
    def get_metric_interpretation_notes(
        self, 
        metric: str
    ) -> list[str]:
        """Get nuances about interpreting this metric"""
    
    def get_external_factors(
        self, 
        date: date
    ) -> list[ExternalFactor]:
        """What external events might be relevant?"""
    
    # Episodic retrieval
    def search_similar_situations(
        self,
        symptoms: list[str],  # ["cvr_down", "traffic_stable"]
        gl: str = None,
        asin: str = None,
        limit: int = 5
    ) -> list[Episode]:
        """Find past situations that looked like this"""
    
    def get_seasonal_baseline(
        self,
        gl: str,
        week_of_year: int
    ) -> Baseline:
        """What's normal for this time of year?"""
    
    def get_recent_decisions(
        self,
        gl: str = None,
        asin: str = None,
        days: int = 30
    ) -> list[Decision]:
        """What actions have we taken recently?"""
    
    def get_pending_actions(
        self,
        gl: str = None
    ) -> list[PendingAction]:
        """What are we waiting on?"""
    
    # Memory updates
    def save_weekly_snapshot(self, snapshot: WeeklySnapshot) -> None:
        """Save this week's analysis"""
    
    def record_decision(self, decision: Decision) -> int:
        """Log a decision/action taken"""
    
    def update_decision_outcome(
        self, 
        decision_id: int, 
        outcome: str, 
        success: bool
    ) -> None:
        """Record whether a decision worked"""
    
    def confirm_pattern(
        self,
        pattern_description: str,
        evidence: dict
    ) -> None:
        """When a hypothesis is validated, strengthen the pattern"""
```

---

## Part 4: Populating Domain Knowledge

### Initial Seeding
You provide the baseline knowledge:

1. **Edit YAML files** with your GL profiles, ASIN notes, known rules
2. **Review and refine** as the agent makes mistakes
3. **Add nuances** when you notice the agent missing something

### Agent Learning
The agent can propose new patterns:

```
Agent: I've noticed that the last 3 times CVR dropped for GL3 
       while in-stock was >95%, the root cause was inventory 
       regionalization (slow shipping from distant FCs).
       
       Should I save this as a pattern to check in the future?
       
User: Yes, save it.

[Memory adds new causal rule with confidence 0.70]
```

### Feedback Loop
When agent's hypothesis is wrong:

```
Agent: CVR dropped. Based on the ASP→CVR rule, I think it's 
       price sensitivity.

User: No, it's actually because we lost the Amazon's Choice badge.

Agent: Got it. I'll note that for B00ABC123, Amazon's Choice 
       badge significantly impacts CVR. Should I add this as 
       a general rule or ASIN-specific?

User: ASIN-specific for now.

[Memory updates B00ABC123 profile]
```

---

## Part 5: Storage Recommendations

### For Domain Knowledge (mostly static)
- **YAML files** in repo (version controlled, human-editable)
- Loaded into memory at startup
- Agent can propose edits → human approves → PR merged

### For Episodic Memory (grows over time)
- **SQLite or DuckDB** for structured queries
- **Vector store** (ChromaDB, Pinecone) for semantic search
- Embeddings generated from weekly summaries

### Hybrid Approach
```
/leadership-autopilot
├── knowledge/
│   ├── causal_rules.yaml      # If-then heuristics
│   ├── gl_profiles.yaml       # Category characteristics  
│   ├── asin_profiles.yaml     # Product-specific notes
│   ├── metric_notes.yaml      # Interpretation guidance
│   └── external_factors.yaml  # Events, market dynamics
├── data/
│   └── memory.db              # SQLite: episodes, decisions, patterns
└── ...
```

---

## Summary

| Layer | What It Stores | How It Helps |
|-------|----------------|--------------|
| **Causal Rules** | "If X then usually Y" | Faster hypothesis generation |
| **GL/ASIN Profiles** | Product/category nuances | Context-aware analysis |
| **Metric Notes** | Interpretation subtleties | Avoid misreading data |
| **External Factors** | Events, market context | Explain anomalies |
| **Weekly Snapshots** | What happened | "We've seen this before" |
| **Decisions** | What we did + outcomes | Learn what works |
| **Confirmed Patterns** | Validated hypotheses | Increasing confidence |
| **Pending Actions** | Open items | Track follow-through |

This turns the agent from a **calculator** into an **analyst with institutional memory**.
