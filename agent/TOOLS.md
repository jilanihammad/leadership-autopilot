# Leadership Autopilot — Agent Tools

## Overview

You have access to deterministic tools that extract structured data from WBR Excel files.
**Use these tools** instead of trying to parse raw data. They handle the heavy lifting.

---

## Available Tools

### 1. `list_weeks`
List all available weeks of data.

**Returns:** `{ weeks: ["2026-wk05", "2026-wk04", ...] }`

**Use when:** Starting analysis, checking what data is available.

---

### 2. `list_gls`
List available GLs (product lines) for a given week.

**Parameters:**
- `week` (required): Week identifier, e.g., "2026-wk05"

**Returns:**
```json
{
  "gls": [
    { "name": "pc", "metrics": ["GMS", "ASP", "NetPPMLessSD", ...] },
    { "name": "office", "metrics": [...] }
  ]
}
```

**Use when:** Finding which GLs have data for a week.

---

### 3. `get_summary`
Get the pre-generated summary for a GL. **Start here for most questions.**

**Parameters:**
- `week` (required): e.g., "2026-wk05"
- `gl` (required): e.g., "pc"

**Returns:** Markdown summary with:
- Total values and WoW/YoY changes
- Top 3 drivers per metric
- Mix vs Rate breakdown for ASP/NetPPM

**Use when:** Answering "what happened" questions. This is your first stop.

---

### 4. `get_metric_drivers`
Get top N drivers for a specific metric at sub-category level.

**Parameters:**
- `week` (required): e.g., "2026-wk05"
- `gl` (required): e.g., "pc"
- `metric` (required): One of: GMS, ShippedUnits, ASP, NetPPMLessSD, CM, SOROOS_PROCURABLE_PRODUCT_OOS_GV_PCT
- `period` (optional): "yoy" (default) or "wow"
- `limit` (optional): Number of drivers (default 5)
- `direction` (optional): "positive", "negative", or "both" (default)

**Returns:**
```json
{
  "metric": "GMS",
  "period": "yoy",
  "total": { "value": 3654948.02, "wow_pct": -0.01, "yoy_pct": 0.66 },
  "drivers": [
    { "subcat_code": "14700510", "subcat_name": "LCD Monitors", "value": 683028.29, "ctc": 2394 },
    { "subcat_code": "14700701", "subcat_name": "Flash Memory SD", "value": 845742.54, "ctc": 1781 },
    ...
  ]
}
```

**Use when:** You need exact numbers beyond the summary, or want to filter by direction.

---

### 5. `get_asin_detail`
Get ASIN-level detail for a metric.

**Parameters:**
- `week` (required)
- `gl` (required)
- `metric` (required)
- `subcat_code` (optional): Filter to specific sub-category
- `period` (optional): "yoy" or "wow"
- `limit` (optional): Number of ASINs (default 10)

**Returns:**
```json
{
  "metric": "GMS",
  "asins": [
    { "asin": "B08TJRVWV1", "item_name": "Amazon Basics Micro SDXC Memory Card...", "value": 398177.97, "ctc": 500 },
    ...
  ]
}
```

**Use when:** Drilling into specific products. Use sparingly — ASIN data is large.

---

### 6. `get_traffic_channels`
Get traffic (Glance Views) breakdown by channel.

**Parameters:**
- `week` (required)
- `gl` (required)
- `limit` (optional): Number of channels (default 10)

**Returns:**
```json
{
  "channels": [
    { "channel": "Organic Search", "gv": 156279, "yoy": 0.247 },
    { "channel": "Featured Products", "gv": 325724, "yoy": 0.524 },
    ...
  ]
}
```

**Use when:** Analyzing traffic patterns, investigating GV changes.

---

### 7. `compare_metrics`
Compare two metrics to find common drivers.

**Parameters:**
- `week` (required)
- `gl` (required)
- `metric1` (required): e.g., "GMS"
- `metric2` (required): e.g., "ShippedUnits"

**Returns:**
```json
{
  "metric1": { "name": "GMS", "total": {...} },
  "metric2": { "name": "ShippedUnits", "total": {...} },
  "common_drivers": [
    { "subcat_code": "14700510", "subcat_name": "LCD Monitors", "GMS": { "ctc": 2394 }, "ShippedUnits": { "ctc": 400 } }
  ]
}
```

**Use when:** Investigating relationships (e.g., "GMS up but Units flat — why?")

---

## Recommended Workflow

```
1. Start with get_summary
   - Gives you the headline story
   - Shows top 3 drivers for each metric
   - Usually enough for initial response

2. Drill with get_metric_drivers
   - Need exact numbers?
   - Want more than 3 drivers?
   - Filter positive/negative only?

3. Compare with compare_metrics
   - Investigating mix shift (GMS vs Units)
   - Finding margin drivers (GMS vs NetPPM)

4. Drill to ASIN only if needed
   - Specific product questions
   - Top drivers need ASIN-level explanation
   - Keep limit low (5-10)

5. Traffic for GV questions
   - "Why did traffic drop?"
   - Channel mix analysis
```

---

## Metric Reference

| Metric Key | Full Name | Unit | Good Direction |
|------------|-----------|------|----------------|
| GMS | Shipped GMS | $ | Up |
| ShippedUnits | Shipped Units | count | Up |
| ASP | Average Selling Price | $ | Neutral (context-dependent) |
| NetPPMLessSD | Net PPM (less S&D) | % | Up |
| CM | Contribution Margin | $ | Up |
| SOROOS_PROCURABLE_PRODUCT_OOS_GV_PCT | OOS GV % | % | Down (lower is better) |

---

## CTC Explained

**CTC = Contribution to Change**

- Measured in **basis points (bps)** for most metrics
- Shows how much each sub-category contributed to the total change
- Sum of all CTCs ≈ total change
- Positive CTC = contributed to growth
- Negative CTC = contributed to decline

Example: If GMS is up 66% YoY (6600 bps), and LCD Monitors has CTC of 2394 bps, that means LCD Monitors drove about 36% of the total increase.

---

## Mix vs Rate

For ASP and NetPPM, drivers are decomposed into:

- **Mix**: Change due to product mix shift (e.g., selling more high-ASP items)
- **Rate**: Change due to rate change within products (e.g., price increase)

Example:
- LCD Monitors: CTC +2.01, Mix +3.05, Rate -1.04
- Interpretation: We sold more monitors (mix +3.05), but monitor prices dropped (rate -1.04), net effect +2.01
