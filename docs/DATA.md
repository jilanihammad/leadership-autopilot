# Data Structure

## Overview

Data is organized by week and GL (business unit):

```
data/
└── weekly/
    └── 2026-wk05/
        └── gl/
            ├── pc/
            │   ├── _manifest.yaml
            │   ├── _summary.md
            │   ├── GMS_Week 5_ctc_by_SUBCAT.xlsx
            │   ├── GMS_Week 5_ctc_by_ASIN.xlsx
            │   └── ...
            ├── toys/
            └── office/
```

---

## File Types

### 1. Manifest (`_manifest.yaml`)

Lists available files and metrics for a GL.

```yaml
gl: pc
week: "2026-wk05"
generated: "2026-02-07T13:16:00"

metrics_available:
  - GMS
  - ShippedUnits
  - ASP
  - NetPPMLessSD
  - CM
  - SOROOS_PROCURABLE_PRODUCT_OOS_GV_PCT

files:
  subcat:
    GMS: GMS_Week 5_ctc_by_SUBCAT.xlsx
    ShippedUnits: ShippedUnits_Week 5_ctc_by_SUBCAT.xlsx
    ASP: ASP_Week 5_ctc_by_SUBCAT.xlsx
    NetPPMLessSD: NetPPMLessSD_Week 5_ctc_by_SUBCAT.xlsx
    CM: CM_Week 5_ctc_by_SUBCAT.xlsx
  asin:
    GMS: GMS_Week 5_ctc_by_ASIN.xlsx
    # ...
```

---

### 2. Summary (`_summary.md`)

Auto-generated markdown summary of the GL's weekly performance.

```markdown
# PC — Week 5 Summary

## Shipped GMS
**Total:** $3.65M | **WoW:** -1.0% | **YoY:** 66.0%

### Top YoY Drivers (by CTC)
| Rank | Sub-Category | YoY CTC | Note |
|------|--------------|---------|------|
| 1 | Smart Speakers | +2394 bps | |
| 2 | Fitness Trackers | +1781 bps | |

## Shipped Units
**Total:** 209.0K | **WoW:** -7.6% | **YoY:** 27.5%
...
```

Generate summaries:
```bash
cd scripts
node generate_summary.js 2026-wk05 pc
```

---

### 3. Metric Files (Excel)

Two levels of granularity:

| Level | Filename Pattern | Use Case |
|-------|-----------------|----------|
| SUBCAT | `*_ctc_by_SUBCAT.xlsx` | Category-level analysis |
| ASIN | `*_ctc_by_ASIN.xlsx` | Product-level deep dive |

---

## Excel File Structures

### Standard Metrics (GMS, Units)

```
| Code | Description | Week 5 | WoW % | YoY % | WoW CTC | WoW bps | YoY CTC | YoY bps |
|------|-------------|--------|-------|-------|---------|---------|---------|---------|
| Total | | 3,650,000 | -0.01 | 0.66 | -36,500 | -100 | 1,456,000 | 6600 |
| 10201001 | Fitness Trackers | 845,743 | 0.08 | 0.87 | 67,659 | 185 | 395,347 | 1781 |
```

Column indices:
- 0: Subcat Code
- 1: Subcat Description
- 2: Week Value
- 3: WoW %
- 4: YoY %
- 5: WoW CTC ($)
- 6: WoW CTC (bps)
- 7: YoY CTC ($)
- 8: YoY CTC (bps)

---

### Margin Metrics (ASP, Net PPM, CM)

These have additional Mix/Rate breakdown columns:

```
| Code | Description | Week 5 | Rev Share | Units | WoW bps | YoY bps | WoW CTC | Mix | Rate | YoY CTC | Mix | Rate |
```

Column indices:
- 0: Subcat Code
- 1: Subcat Description
- 2: Metric Value (ASP in $, Net PPM/CM in %)
- 3: Revenue Share ($)
- 4: Units
- 5: WoW (bps)
- 6: YoY (bps)
- 7: WoW CTC
- 8: WoW Mix
- 9: WoW Rate
- 10: YoY CTC
- 11: YoY Mix
- 12: YoY Rate

---

### Traffic Data (CSV)

```csv
GL,Subcat,SubcatCode,Channel,WeekEnd,GV,YoY
PC,,,"Buy Again",2026-02-01,903,0.713
PC,,,"Featured Products",2026-02-01,325,724.0
```

---

## Key Metrics

| Metric | Field | Description |
|--------|-------|-------------|
| GMS | Shipped GMS ($) | Gross Merchandise Sales |
| Units | Shipped Units | Number of units sold |
| ASP | Average Selling Price ($) | GMS / Units |
| Net PPM | Net PPM (%) | Net Pure Product Margin |
| CM | Contribution Margin (%) | Margin after variable costs |
| OOS | SoROOS (%) | Share of glance views that are out-of-stock |
| GVs | Glance Views | Traffic / page views |

---

## CTC (Contribution to Change)

CTC measures how much each subcategory contributed to the total change.

**Formula:**
```
CTC (bps) = (Subcat Change / Total Base) × 10000

Example:
- Total GMS last week: $3.5M
- Smart Speakers grew by $200K
- Smart Speakers CTC = ($200K / $3.5M) × 10000 = 571 bps
```

**Interpretation:**
- Positive CTC = Subcat grew faster than average
- Negative CTC = Subcat dragged down total
- Sum of all CTCs = Total YoY/WoW % change

---

## Adding New Data

### 1. Create Week Directory

```bash
mkdir -p data/weekly/2026-wk06/gl/pc
```

### 2. Add Excel Files

Copy your CTC files with naming convention:
```
{Metric}_Week {N}_ctc_by_{SUBCAT|ASIN}.xlsx
```

### 3. Generate Manifest

```bash
cd scripts
node generate_summary.js 2026-wk06 pc
```

This creates both `_manifest.yaml` and `_summary.md`.

---

## Data Validation

The tools validate data on load:

| Check | Error |
|-------|-------|
| File not found | `Metric {X} not found for {GL}` |
| Invalid manifest | `Manifest not found for {GL}` |
| Missing columns | May return null values |

---

## Troubleshooting

### "Manifest not found"

```bash
# Check directory exists
ls data/weekly/2026-wk05/gl/pc/

# Check manifest exists
cat data/weekly/2026-wk05/gl/pc/_manifest.yaml
```

### "Metric not found"

```bash
# Check available files
ls data/weekly/2026-wk05/gl/pc/*.xlsx

# Check manifest lists the metric
grep "GMS" data/weekly/2026-wk05/gl/pc/_manifest.yaml
```

### Wrong column values

Check the Excel file structure matches the expected format. Margin metrics (ASP, Net PPM, CM) have different column layouts than standard metrics (GMS, Units).
