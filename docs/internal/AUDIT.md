# Data Accuracy Audit — 2026-02-10

## Methodology
Audited every function in `tools.js` and `server.js` that reads Excel column data.
Cross-referenced hardcoded column indices against actual file headers for all 12 file types (6 metrics × subcat/asin).

## File Layouts (ground truth from Excel headers)

**Standard (9 cols) — GMS, ShippedUnits:**
| Col | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 |
|-----|---|---|---|---|---|---|---|---|---|
| | Code/ASIN | Name | Value | WoW% | YoY% | WoW CTC($) | WoW CTC(bps) | YoY CTC($) | YoY CTC(bps) |

**Margin (13 cols) — ASP, NetPPMLessSD, CM, SOROOS:**
| Col | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 |
|-----|---|---|---|---|---|---|---|---|---|---|---|---|---|
| | Code/ASIN | Name | Value | NR/Extra | Revenue$ | WoW(bps/%) | YoY(bps/%) | WoW CTC | Mix | Rate | YoY CTC | Mix | Rate |

---

## Critical — Will Give Wrong Numbers

### 1. `getMetricDrivers()` — wrong columns for margin metrics
- **WoW/YoY% hardcoded to cols 3,4** — correct for standard, but for margin metrics col 3=NR, col 4=Revenue$.
- **CTC fallback uses col 8** — correct for standard (YoY CTC bps), but for margin col 8=Mix. Should be col 10.
- **Header auto-detection fails** — it searches row 1 for "yoy" AND "ctc" but headers say just "CTC (bps)" without "yoy". Falls through to wrong fallback every time.
- **Impact**: Any analysis that calls `getMetricDrivers` for ASP/NetPPM/CM returns Mix values as CTC, and NR/Revenue as WoW/YoY%.

### 2. `getSubcatDetail()` — all columns hardcoded to standard layout
- Returns `wow_pct: row[3], yoy_pct: row[4], yoy_ctc_bps: row[8]` for ALL metrics.
- For margin metrics: wow_pct=NR, yoy_pct=Revenue$, yoy_ctc_bps=Mix.
- **Impact**: Any specific subcat lookup for margin metrics returns garbage.

### 3. `buildContext()` subcat table — only GMS CTC column
- Table ends with `CTC (bps)` that always shows `gms.yoy_ctc_bps`.
- If LLM is reasoning about Net PPM drivers, it sees GMS CTC ranked ordering, not Net PPM CTC.
- **Impact**: LLM may incorrectly rank subcategories when answering margin questions.

---

## High — Will Break at Multi-GL Scale

### 4. GL detection keyword collisions
- "speaker" → matches CE, but PC sells USB speakers (B07DDK3W5D, B07D7TV5J3)
- "cable" → matches PC, but cables exist in CE/wireless
- "charger" → matches wireless, but PC has USB chargers
- "mouse" → matches PC, but could appear in pets context
- "keyboard" → matches PC, but could appear in office
- **Impact**: Wrong GL selected → wrong data loaded → wrong analysis. User has no idea.
- **At scale**: With 10 GLs, collisions multiply. A question about "speakers" gets PC data when user meant CE.

### 5. Dashboard sidebar GL vs. question intent mismatch
- Streaming endpoint: `requestedGL || session.detectGL(question)` — sidebar wins.
- If user selects "Toys" sidebar but asks "what about PC monitors?", system analyzes Toys data with a PC question.
- **Impact**: Data-question mismatch → hallucinated answers.

### 6. No header validation on file read
- All column indices are hardcoded assumptions. If a new GL has a different Excel export format (different column order, extra columns, renamed headers), data is silently wrong.
- **Impact**: Every new GL added is a latent accuracy risk. No error, just wrong numbers.

---

## Medium — Data Quality Issues

### 7. Inconsistent bps conversion
- `searchSubcats`: divides bps by 100 (`wowPct = wowPct / 100`)
- `getAllSubcatData`: divides bps by 10000 (`safeDivide(wowPct, 10000)`)
- These produce different results for the same input.

### 8. CSV traffic parser fragile
- Uses `split(',')` without handling quoted fields.
- If a channel name contains a comma, all columns shift.

### 9. SOROOS metric not accessible
- Data exists in manifest but not in any `metricConfigs`. Questions about OOS/availability can't be answered with data.

### 10. Table labels mix growth rates with bps changes
- "GMS YoY: 66.0%" = grew 66% (relative)
- "Net PPM YoY: -19.0%" = dropped 19 percentage points (absolute)
- Same format, different semantics. LLM may misinterpret.

---

## Low — Edge Cases

### 11. Null CTC ASINs filtered out
- ASINs with `null` CTC are skipped. Some may be important (new products with no prior year).

### 12. In-memory sessions lost on restart
- Server restart clears all conversation context.

### 13. `extractKeyFindings` unreliable
- Regex-based finding extraction may save wrong/incomplete findings to weekly file.
