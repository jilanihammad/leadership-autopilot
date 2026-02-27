# Metric Calculation Guide

How GL-level metrics are computed from the ALL consolidated data files.

**This document is the authoritative reference for how metrics should be calculated.**
If you are modifying `agent/tools.js`, read this first.

---

## Data Structure

### File Layout

Each metric has a subcat-level Excel file in `data/weekly/{week}/gl/all/`.
There are two column layouts:

**Standard layout (9 columns)** — used by GMS, ShippedUnits:
```
Col  | Content
-----|--------
  0  | Subcat code (8-digit, e.g., "10101001")
  1  | Subcat name (e.g., "Voice Assistants")
  2  | Value (absolute: $, units)
  3  | WoW % (fractional, e.g., 0.098 = 9.8%)
  4  | YoY % (fractional, e.g., 0.807 = 80.7%)
  5  | WoW CTC ($) — dollar change from prior week
  6  | WoW CTC (bps) — contribution to total in bps
  7  | YoY CTC ($) — dollar change from prior year
  8  | YoY CTC (bps) — contribution to total in bps
```

**Margin layout (13 columns)** — used by NetPPMLessSD, CM, ASP, SOROOS:
```
Col  | Content
-----|--------
  0  | Subcat code
  1  | Subcat name
  2  | Value (ratio for NPPM/CM/SOROOS; dollar for ASP)
  3  | Numerator ($)
  4  | Denominator ($)
  5  | WoW change (bps for NPPM/CM/SOROOS; fractional for ASP)
  6  | YoY change (bps for NPPM/CM/SOROOS; fractional for ASP)
  7  | WoW CTC (bps for NPPM/CM/SOROOS; dollars for ASP)
  8  | WoW Mix component
  9  | WoW Rate component
 10  | YoY CTC (bps for NPPM/CM/SOROOS; dollars for ASP)
 11  | YoY Mix component
 12  | YoY Rate component
```

### GL-to-Subcat Mapping

Each 8-digit subcat code encodes the GL in its prefix and the subcategory in its
last 4 digits. For example: `10101001` = prefix `1010` (Smart Home) + subcat `1001`.

See `data/gl_prefix_mapping.json` for the complete prefix-to-GL mapping.

The mapping can be loaded from a GL-to-Subcat mapping file and disambiguated
using prefix matching. Some subcats (UNKNOWN, shared codes) cannot be mapped
and are excluded from GL-specific computations.

---

## Computing GL-Level Totals (getMetricTotals)

### When GL = "all"

Read the **Total row** (row where col0 = "Total") directly from the file.
No computation needed — the file already has the correct aggregated values.

### When GL = specific (e.g., "Smart Home")

Filter rows from the ALL file to only include subcats belonging to that GL
(using `getSubcatsForGL(gl)`), then compute:

#### Absolute Metrics (GMS, ShippedUnits)

**Current value:**
```
GL_value = sum(col2) for all GL subcats
```

**WoW %:**
```
GL_WoW = sum(col5) / (GL_value - sum(col5))
```
where col5 = WoW CTC ($). This gives the prior-period value as
`GL_prior = GL_value - sum(WoW_CTC$)`, then `WoW% = sum(WoW_CTC$) / GL_prior`.

**YoY %:** Same formula using col7 (YoY CTC $).

#### Margin Metrics (NetPPMLessSD, CM, ASP, SOROOS)

**Current value:**
```
GL_value = sum(col3) / sum(col4)
```
This is sum(numerator) / sum(denominator). **Never average the percentages.**

**WoW/YoY — Cross-Metric Denominator Approach:**

This is the most critical computation. You CANNOT simply average the per-subcat
WoW/YoY values, even revenue-weighted. That misses the **mix effect** — when
subcats grow at different rates, their weight in the aggregate shifts between
periods. Using revenue-weighted averaging produces substantially wrong results
(e.g., NPPM WoW = 189 bps instead of correct ~270 bps).

The correct approach estimates the prior-period aggregate ratio by reconstructing
prior-period numerators and denominators for each subcat:

**Step 1: Load the denominator metric's subcat file**

Each margin metric has a corresponding standard metric that represents its denominator:

| Margin Metric | Denominator Metric | What col4 represents |
|---|---|---|
| NetPPMLessSD | GMS | Revenue Share Amount ($) |
| CM | GMS | Total Revenue ($) |
| ASP | ShippedUnits | Shipped Units |
| SOROOS | GMS | SOROOS denominator (proxy) |

Note: NPPM/CM col4 is "Revenue Share Amount" / "Total Revenue", which differs
from GMS by 2-10%. GMS is the best available proxy.

**Step 2: For each subcat, compute prior-period rate and denominator**

```
# From the denominator metric's standard file:
den_wow_pct = col3 of denominator file  (e.g., GMS WoW% as fraction)
den_yoy_pct = col4 of denominator file  (e.g., GMS YoY% as fraction)

# Prior-period denominator:
P1_den_wow = P2_den / (1 + den_wow_pct)
P1_den_yoy = P2_den / (1 + den_yoy_pct)

# Prior-period rate (differs by metric type):
# For bps metrics (NPPM, CM, SOROOS):
P1_rate_wow = P2_rate - wow_bps / 10000
P1_rate_yoy = P2_rate - yoy_bps / 10000

# For fractional metrics (ASP):
P1_rate_wow = P2_rate / (1 + wow_frac)
P1_rate_yoy = P2_rate / (1 + yoy_frac)

# Prior-period numerator:
P1_num = P1_rate × P1_den
```

**Step 3: Compute GL-level prior ratio and change**

```
GL_P2_rate = sum(P2_num) / sum(P2_den)   # current period
GL_P1_rate = sum(P1_num) / sum(P1_den)   # prior period (estimated)

# For bps metrics (NPPM, CM, SOROOS):
GL_WoW = (GL_P2_rate - GL_P1_rate) × 10000   # in bps

# For fractional metrics (ASP):
GL_WoW = GL_P2_rate / GL_P1_rate - 1   # as fraction (e.g., 0.02 = 2%)
```

**Why this works:** The cross-metric approach uses the denominator metric's
growth rate to estimate how each subcat's denominator changed between periods.
This captures the mix shift that simple averaging misses. Results are within
~6 bps of the true values for WoW, and ~100 bps for YoY (where denominator
changes are larger).

---

## Computing Subcat-Level Drivers (getMetricDrivers)

### When GL = "all"

Read CTC values directly from the file. CTC (Contribution to Change) is already
correctly computed relative to the ALL total.

### When GL = specific

The CTC values in the ALL file are relative to the ALL-level total, not the
GL-level total. They must be recomputed:

**Absolute metrics:** Recompute CTC(bps) relative to GL totals:
```
GL_total_delta = sum(WoW_CTC$) or sum(YoY_CTC$) for GL subcats
GL_prior = GL_value - GL_total_delta
GL_pct_change = GL_total_delta / GL_prior

subcat_CTC_bps = (subcat_delta / GL_total_delta) × GL_pct_change × 10000
```

**Margin metrics:** Use rate-impact approximation:
```
GL_total_den = sum(|col4|) for GL subcats
subcat_CTC ≈ (|subcat_col4| / GL_total_den) × subcat_bps_change
```
This captures the rate component. The mix component requires prior-period data
and is excluded (acceptable approximation for driver ranking).

---

## Known Limitations

1. **Missing subcats:** Some subcats with UNKNOWN codes or shared codes exist in
   per-GL files but cannot be mapped from the ALL file. This causes computed
   values to be slightly lower than the per-GL file's Total row.

2. **Denominator proxy mismatch (~2-10%):** NPPM denominator is "Revenue Share
   Amount" and CM denominator is "Total Revenue", both of which differ slightly
   from GMS. This introduces small errors in the prior-period estimation.

3. **YoY larger error than WoW:** Year-over-year denominators change more than
   week-over-week, so the proxy-based estimation has larger residual error.
   Typical: WoW within 6 bps, YoY within 100 bps for NPPM.

4. **SOROOS denominator has no exact proxy:** SOROOS uses a specialized
   denominator that is not GV. GMS is used as a proxy, which is imperfect.

5. **Per-GL Total row includes hidden subcats:** The Total row in per-GL files
   includes data from subcats below the display threshold. The sum of visible
   subcat rows does not equal the Total row. This is a data source limitation,
   not a calculation error.

---

## CTC Formula Reference

The three formula types for CTC decomposition:

1. **For percentage metrics** (NPPM, CM, SOROOS): CTC = Rate Impact + Mix Impact
2. **For per-unit metrics** (ASP): Same decomposition in dollar terms
3. **For non-ratio metrics** (GMS, Units): CTC($) = P2 - P1

---

## Tests

- `test/gl-metric-accuracy.test.js` — Validates GL-level computed metrics
  against per-GL file reference values. **Specifically catches the
  revenue-weighted averaging bug.** Always run after modifying metric
  computation logic.

- `test/data-accuracy.test.js` — Validates tool outputs against raw Excel
  column values (column mapping accuracy).

Run all tests: `cd agent && npm test`
