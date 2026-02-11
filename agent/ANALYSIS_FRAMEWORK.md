# Analysis Framework — Always Go Deep, But Know Your Limits

## The Golden Rule

**Never stop at WHAT. Always decompose to the deepest level the DATA supports.**

- ❌ "LCD Monitors drove growth" (too shallow)
- ✅ "LCD Monitors drove +2,394 bps GMS CTC. Units +473% YoY, ASP -23.3%. Net PPM 10.5% vs GL avg 29.9% — growth is coming at the cost of margin. *Hypothesis: ASP drop may reflect competitive pricing to gain share, but no competitor data available to confirm.*" (data-backed with labeled hypothesis)

---

## Layered Analysis — DATA vs HYPOTHESIS Boundary

For every major driver (top 3 CTC contributors), go through these layers:

### Layer 1: What happened? [DATA]
- State the metric movement
- CTC contribution (how much of total change)

### Layer 2: Volume vs. Price decomposition [DATA]
- Is it units or ASP driving the change?
- Check Mix vs. Rate for ASP/Net PPM

### Layer 3: Sub-driver identification [DATA, with caveats]
- Which ASINs are the top GL-wide CTC contributors?
- Are these new products? (null YoY = new ASIN)
- **Caveat:** ASIN data is GL-wide, not filtered by subcat. Match ASINs to subcats by product name only when unambiguous; note the limitation when it's not clear.

### ── HYPOTHESIS BOUNDARY ── Everything below must be labeled ──

### Layer 4: Root cause [HYPOTHESIS — always label]
- WHY is this happening? **You usually don't have the data to answer this definitively.**
- External factors? (competition, seasonality, market) — NO competitor/market data available
- Internal factors? (launches, pricing, inventory) — NO promo/cost/inventory data available
- Is this sustainable or one-time? — Cannot assess with a single week of data
- **Always prefix with:** "Hypothesis (not in data):" or "Possible cause (requires verification):"

### Layer 5: Margin sanity check [DATA]
- What's the Net PPM for this driver?
- Is growth coming at the expense of margin?
- Any red flags? (negative margin, unsustainable pricing)

---

## Analysis Checklist

Before finalizing any response, verify:

```
□ Did I decompose each top driver (volume vs price, mix vs rate)? [DATA]
□ Did I check ASP data to understand price vs. volume? [DATA]
□ Did I look at ASIN level to find specific products? [DATA — note GL-wide caveat]
□ Did I check margin impact for each growth driver? [DATA]
□ Did I flag any concerning patterns (negative Net PPM, margin compression)? [DATA]
□ Did I clearly label any root cause claims as HYPOTHESIS?
□ Did I note ASIN-to-subcat mapping is approximate (by product name only)?
□ Did I avoid presenting hypotheses as facts?
```

---

## Data to Always Check for Top Drivers

| Question | Data Source |
|----------|-------------|
| Is it volume or price? | Compare Units YoY vs ASP YoY |
| Mix or rate? | ASP/Net PPM files have Mix and Rate columns |
| Which products? | ASIN-level files for top subcat |
| Margin healthy? | NetPPM file for the subcat |
| New products? | ASIN with no YoY comparison = new |
| Traffic issue? | GVs file by channel |

---

## Example: Good vs. Bad Analysis

### ❌ Bad (Surface Level)
> PC GMS increased 66% YoY driven by LCD Monitors (+24% CTC), Flash Memory SD (+18% CTC), and Flash Memory microSD (+17% CTC).

### ❌ Also Bad (Speculation Presented as Fact)
> LCD Monitors drove growth, enabled by 23% ASP reduction that made us competitive at the $90 price tier. This is a healthy growth pattern.

### ✅ Good (Data-Backed with Labeled Hypotheses)
> PC GMS increased 66% YoY driven by:
>
> **1. LCD Monitors (+2,394 bps GMS CTC)** [DATA]
> - Units +473% YoY, ASP -23.3% YoY — growth is volume-driven at lower price points
> - Top ASINs by GMS CTC (GL-wide, matched to Monitors by product name): B0CP7RZRMD ($178.7K CTC), B0CP7TRZWR ($194.5K CTC) — both are new monitor launches (null YoY = new product)
> - ⚠️ Margin flag: Net PPM 10.5% (vs GL avg 29.9%, -1,767 bps YoY Δ, -570 bps CTC)
>
> **2. Flash Memory microSD (+1,674 bps GMS CTC)** [DATA]
> - ASP +117% YoY — mix shifting to high-capacity cards (512GB, 1TB ASINs visible as new products)
> - 🚨 Net PPM is -4.95% (every sale loses money). CTC = -607 bps — the single largest Net PPM drag.
>
> **Hypotheses (not in data):**
> - Monitor ASP decline could reflect competitive pricing or intentional price positioning — no competitor data available to confirm.
> - microSD negative margin may be a COGS or aggressive pricing issue — warrants supplier cost review.

---

## Red Flags to Always Call Out

| Pattern | What It Means [DATA] | Possible Cause [HYPOTHESIS] | Action |
|---------|---------------------|---------------------------|--------|
| GMS ↑, Units flat | ASP increase (mix shift or price) | Intentional upsell or price hike | Check if sustainable |
| GMS ↑, Net PPM ↓ | Trading margin for growth | Promo-driven or competitive pricing | Flag for review |
| Net PPM negative | Losing money on every sale | COGS issue, aggressive pricing | Urgent escalation |
| ASP ↓ significantly | Lower-priced mix growing faster | Price war or new low-ASP launches | Investigate cause |
| New ASIN = top driver (null YoY) | New product contributing to GL | Launch ramping | Monitor ramp |
| Units ↓, GMS ↑ | Fewer units at higher prices | Premium mix shift | Check if intentional |

---

## Memory: Key Learnings

1. **Always decompose** — Don't accept a metric at face value. Break it into components.

2. **ASIN level matters** — Subcat tells you WHERE, ASIN tells you WHAT PRODUCT and WHY.

3. **Margin is the punchline** — Growth without margin is not healthy growth. Always check Net PPM.

4. **New products change everything** — A new launch can explain most movements. Look for ASINs with no YoY comparison.

5. **Mix vs. Rate is crucial** — Tells you if it's product mix shifting or rates within products changing.

---

## Standard Response Structure

```markdown
## [Metric] Analysis

### Driver 1: [Subcat Name] (+X bps CTC)

**Layer 1 — What:**
- [Metric] moved X% YoY

**Layer 2 — Volume vs. Price:**
- Units: X% YoY
- ASP: X% YoY

**Layer 3 — Product Level:**
| ASIN | Product | Impact | Note |
|------|---------|--------|------|
| ... | ... | ... | ... |

**Layer 4 — Root Cause:**
→ [Specific explanation of WHY]

**Margin Check:**
- Net PPM: X% ([healthy/concerning/critical])
- [Any flags]

### [Repeat for Driver 2, 3...]

## Summary
[One paragraph connecting it all, with recommended actions]
```
