# Prompts & Analysis Framework

## Overview

The agent uses two main prompt documents:

1. **SYSTEM_PROMPT.md** - Agent persona, response format, terminology
2. **ANALYSIS_FRAMEWORK.md** - Analytical methodology, decomposition approach

Both are loaded at startup and included in every LLM call.

---

## Response Format

All responses follow the WHAT/WHY structure:

```markdown
**WHAT:**
- Key insight #1 (with numbers)
- Key insight #2 (with numbers)
- Key insight #3 (with numbers)

**WHY:**
[Detailed analysis with root causes, tables, and supporting data]
```

### Why This Format?

| Section | Purpose | Visibility |
|---------|---------|------------|
| WHAT | Executive summary | Always visible |
| WHY | Detailed analysis | Collapsed by default |

This allows:
- Instant answers for busy executives
- Deep dives available on demand
- Faster perceived response time (WHAT appears in ~2-3 seconds)

---

## Metric Terminology

The agent is instructed to use exact metric names from the data files.

### Approved Terms

| Metric | Approved Names | Avoid |
|--------|---------------|-------|
| Net PPM | "Net PPM", "NetPPMLessSD" | "NPM", "NPPM" |
| GMS | "GMS", "Shipped GMS" | "GMV", "revenue" (ambiguous) |
| Units | "Shipped Units", "Units" | "volume" (ambiguous) |
| ASP | "ASP", "Average Selling Price" | "price" (ambiguous) |
| CM | "CM", "Contribution Margin" | "margin" (use "Net PPM" or "CM" specifically) |

### Margin Clarification

When user asks about "margin", the agent checks both:
- **Net PPM** (product margin) = (GMS - PCOGS) / GMS
- **CM** (contribution margin) = margin after all variable costs

---

## Analysis Methodology

### GMS Decomposition

```
GMS Change = Units Change × ASP Change

If GMS ↑ but Units flat → ASP driving growth (mix shift or price increase)
If GMS ↑ and Units ↑ → Volume-driven growth
If GMS ↑ but ASP ↓ → Pure volume growth offsetting price decline
```

### ASP Decomposition (Mix vs Rate)

```
ASP Change = Mix Effect + Rate Effect

Mix Effect: Selling more of higher/lower priced items
Rate Effect: Price changes within items

High Mix, Low Rate → Selling more expensive items, but item prices dropped
Low Mix, High Rate → Same product mix, but prices increased
```

### Margin Analysis

```
Margin Change = Mix Effect + Rate Effect

Mix Effect: Selling more of higher/lower margin items
Rate Effect: Margin changes within items (cost or price changes)
```

---

## Causal Rules

The agent uses pattern matching to identify root causes:

| Pattern | Likely Cause |
|---------|--------------|
| CVR ↓ + ASP ↑ | Price sensitivity |
| CVR ↓ + shipping estimate ↑ | Regionalization issue |
| Buy Box lost + competitor price lower | Price competition |
| Net PPM ↓ + GMS ↑ | Promo-driven growth (margin compression) |
| GMS ↑ + Units flat | ASP increase (mix shift or price hike) |
| Traffic ↓ sharply | Listing suppression or SEO issue |

---

## GL-Specific Considerations

Different GLs have different characteristics:

### PC
- High ASP items (monitors, laptops)
- Strong seasonality (back-to-school, holiday)
- Mix effects often dominate margin changes

### Toys
- Highly seasonal (Q4 = 40%+ of annual volume)
- Licensed products drive traffic spikes
- Margin pressure from big box competition

### Office
- B2B heavy (bulk orders)
- Back-to-school and new year spikes
- Commodity pricing pressure

---

## Prompt Structure

The full prompt sent to the LLM:

```
┌─────────────────────────────────────────────────────────────┐
│ SYSTEM_PROMPT.md                                            │
│ - Agent persona                                             │
│ - Response format (WHAT/WHY)                                │
│ - Metric terminology                                        │
│ - Analysis approach                                         │
│ - Causal rules                                              │
│ - Seasonality patterns                                      │
├─────────────────────────────────────────────────────────────┤
│ ANALYSIS_FRAMEWORK.md                                       │
│ - Decomposition methodology                                 │
│ - Mix vs Rate analysis                                      │
│ - CTC (Contribution to Change) explanation                  │
├─────────────────────────────────────────────────────────────┤
│ # Current Data                                              │
│ ## PC Summary (Week wk05)                                   │
│ [Summary markdown]                                          │
│                                                             │
│ ## Complete Subcategory Data                                │
│ [Full data table - all 27 subcats × 5 metrics]              │
├─────────────────────────────────────────────────────────────┤
│ Conversation History                                        │
│ - Previous user questions                                   │
│ - Previous assistant responses                              │
├─────────────────────────────────────────────────────────────┤
│ Current Question                                            │
│ "Why did PC GMS grow this week?"                            │
└─────────────────────────────────────────────────────────────┘
```

---

## Customization

### Adding New Causal Rules

Edit `knowledge/causal_rules.yaml`:

```yaml
rules:
  - pattern: "Traffic down + OOS up"
    cause: "Supply chain issue limiting availability"
    action: "Check procurement and fulfillment metrics"
```

### Adding Metric Aliases

Edit `knowledge/metric_aliases.yaml`:

```yaml
aliases:
  profit:
    refers_to: [NetPPMLessSD, CM]
    note: "Check both Net PPM and CM when user asks about profit"
```

### Modifying Response Format

Edit `agent/SYSTEM_PROMPT.md`, specifically the "Response Format" section.

---

## Testing Prompts

You can test prompt changes via CLI:

```bash
npm run cli
# Then ask: "Why did PC GMS grow?"
```

Or via API:

```bash
curl -X POST http://localhost:3456/api/ask \
  -H "Content-Type: application/json" \
  -d '{"question": "Why did PC GMS grow?", "gl": "pc"}'
```
