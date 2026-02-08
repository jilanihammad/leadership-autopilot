# Analysis Framework — Always Go Deep

## The Golden Rule

**Never stop at WHAT. Always get to WHY.**

- ❌ "LCD Monitors drove growth" (WHAT)
- ✅ "New 27" monitor launches (B0CP7RZRMD, B0DZ619WZN) drove growth, enabled by 23% ASP reduction that made us competitive at the $90 price tier" (WHY)

---

## Layered Analysis (Minimum 3-4 Layers)

For every major driver (top 3 CTC contributors), go through these layers:

### Layer 1: What happened?
- State the metric movement
- CTC contribution (how much of total change)

### Layer 2: Volume vs. Price decomposition
- Is it units or ASP driving the change?
- Check Mix vs. Rate for ASP/NPM

### Layer 3: Sub-driver identification
- Which ASINs are driving the subcat?
- Are these new products? Existing products growing?
- Any launches, promotions, or price changes?

### Layer 4: Root cause
- WHY is this happening?
- External factors? (competition, seasonality, market)
- Internal factors? (launches, pricing, inventory)
- Is this sustainable or one-time?

### Layer 5: Margin sanity check
- What's the NPM for this driver?
- Is growth coming at the expense of margin?
- Any red flags? (negative margin, unsustainable pricing)

---

## Analysis Checklist

Before finalizing any response, verify:

```
□ Did I explain WHY each top driver is moving, not just that it moved?
□ Did I check ASP data to understand price vs. volume?
□ Did I look at ASIN level to find specific products driving change?
□ Did I check margin impact for each growth driver?
□ Did I flag any concerning patterns (negative NPM, margin compression)?
□ Did I connect to root cause (new launch, price cut, competition)?
```

---

## Data to Always Check for Top Drivers

| Question | Data Source |
|----------|-------------|
| Is it volume or price? | Compare Units YoY vs ASP YoY |
| Mix or rate? | ASP/NPM files have Mix and Rate columns |
| Which products? | ASIN-level files for top subcat |
| Margin healthy? | NetPPM file for the subcat |
| New products? | ASIN with no YoY comparison = new |
| Traffic issue? | GVs file by channel |

---

## Example: Good vs. Bad Analysis

### ❌ Bad (Surface Level)
> PC GMS increased 66% YoY driven by LCD Monitors (+24% CTC), Flash Memory SD (+18% CTC), and Flash Memory microSD (+17% CTC).

### ✅ Good (Deep Analysis)
> PC GMS increased 66% YoY driven by:
>
> **1. LCD Monitors (+24% CTC)**
> - New 27" monitor launches (B0CP7RZRMD, B0DZ619WZN) are ramping
> - ASP dropped 23% YoY making us competitive at $90 price tier
> - Units +473% as volume responded to lower prices
> - ⚠️ Margin impact: NPM 10.5% (vs 30% category avg) — mix shift hurting profitability
>
> **2. Flash Memory microSD (+17% CTC)**
> - Mix shift to high-capacity cards (512GB, 1TB launches)
> - ASP +117% as customers buy larger capacities
> - 🚨 NPM is NEGATIVE (-4.95%) — every sale loses money
> - Root cause: Likely COGS issue or aggressive pricing on new SKUs

---

## Red Flags to Always Call Out

| Pattern | What It Means | Action |
|---------|---------------|--------|
| GMS ↑, Units flat | ASP increase (price or mix) | Check if sustainable |
| GMS ↑, NPM ↓ | Trading margin for growth | Flag for review |
| NPM negative | Losing money on every sale | Urgent escalation |
| ASP ↓ significantly | Price war or competitive pressure | Investigate cause |
| New ASIN = top driver | Launch is working | Monitor ramp |
| Units ↓, GMS ↑ | Selling fewer, pricier items | Check if intentional |

---

## Memory: Key Learnings

1. **Always decompose** — Don't accept a metric at face value. Break it into components.

2. **ASIN level matters** — Subcat tells you WHERE, ASIN tells you WHAT PRODUCT and WHY.

3. **Margin is the punchline** — Growth without margin is not healthy growth. Always check NPM.

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
- NPM: X% ([healthy/concerning/critical])
- [Any flags]

### [Repeat for Driver 2, 3...]

## Summary
[One paragraph connecting it all, with recommended actions]
```
