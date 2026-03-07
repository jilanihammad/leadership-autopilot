# Metrics Hierarchy — Leadership Autopilot

## Core Formula
```
NPPM = (GMS - PCOGS) / GMS
```
Where:
- **GMS** = Gross Merchandise Sales (topline revenue)
- **PCOGS** = Product Cost of Goods Sold
- **NPPM** = Net Pure Product Margin (profitability %)

---

## Topline (GMS) Decomposition

```
GMS = Traffic × CVR × ASP × Units_per_Order

Where:
├── Traffic (Glance Views / Sessions)
│   ├── Organic Traffic
│   │   ├── Search Rank (keyword positions)
│   │   ├── Browse Node Placement
│   │   └── Recommendations (frequently bought together, etc.)
│   ├── Paid Traffic
│   │   ├── Sponsored Products Spend & ROAS
│   │   ├── Sponsored Brands Spend & ROAS
│   │   └── DSP / Display Spend & ROAS
│   ├── External Traffic
│   │   ├── Social referrals
│   │   ├── Affiliate/influencer
│   │   └── Direct/brand.com
│   └── Seasonal / Event-driven
│       ├── Prime Day
│       ├── Black Friday / Cyber Monday
│       └── Category-specific events
│
├── CVR (Conversion Rate = Orders / Glance Views)
│   ├── Content Quality
│   │   ├── Image count & quality
│   │   ├── A+ Content presence
│   │   ├── Video presence
│   │   └── Bullet points / description completeness
│   ├── Reviews & Ratings
│   │   ├── Star rating
│   │   ├── Review count
│   │   ├── Review recency
│   │   └── Review sentiment
│   ├── Price Competitiveness
│   │   ├── Buy Box %
│   │   ├── Price vs. competition
│   │   └── Promotion/deal presence
│   ├── Availability
│   │   ├── In-stock rate
│   │   ├── FBA vs. FBM
│   │   └── Delivery speed (Prime badge)
│   └── Trust Signals
│       ├── Brand Store presence
│       ├── Featured badge
│       └── Best Seller rank
│
├── ASP (Average Selling Price)
│   ├── List Price
│   ├── Promotions / Coupons
│   ├── Subscribe & Save discounts
│   ├── Lightning Deals
│   └── Mix shift (high-ASP vs low-ASP SKUs)
│
└── Units per Order
    ├── Multi-pack offerings
    ├── Subscribe & Save frequency
    └── Cross-sell / bundle attach rate
```

---

## Bottomline (NPPM) Decomposition

```
NPPM = (GMS - PCOGS) / GMS

PCOGS includes:
├── Product Cost (Manufacturing/Wholesale)
│   ├── Raw material costs
│   ├── Manufacturing costs
│   ├── Supplier pricing changes
│   └── Currency fluctuations (if international sourcing)
│
├── Inbound Logistics
│   ├── Freight / shipping to FC
│   ├── Duties / tariffs
│   └── Prep / labeling costs
│
├── Platform Fees
│   ├── Referral Fee (category-based %)
│   ├── Fulfillment Fee (size/weight tiers)
│   ├── Storage Fees (monthly + aged inventory)
│   ├── Long-term Storage Fees (LTSF)
│   └── Removal / disposal fees
│
├── Advertising Cost (if included in PCOGS)
│   ├── TACOS (Total Advertising Cost of Sale)
│   └── By campaign type
│
└── Returns & Chargebacks
    ├── Return rate %
    ├── Return processing fees
    └── Damaged/unsellable returns
```

---

## Key Diagnostic Questions (Root Cause Paths)

### GMS Dropped — Why?
```
1. Traffic down?
   → Check: Glance views WoW
   → If yes: Organic or Paid?
     → Organic: Search rank changes? Suppressed listing? New competitor?
     → Paid: Budget cut? ROAS dropped? Campaign paused?

2. CVR down?
   → Check: CVR WoW
   → If yes: Reviews dropped? Price increased? Out of stock? Lost Buy Box?

3. ASP down?
   → Check: ASP WoW
   → If yes: Deeper discounts? Mix shift to lower-priced SKUs? Competitor price war?

4. Combination?
   → Waterfall: Traffic impact + CVR impact + ASP impact = Total GMS delta
```

### NPPM Dropped — Why?
```
1. GMS dropped? (see above)

2. PCOGS increased?
   → Supplier cost increase?
   → FBA fee tier change (product size/weight)?
   → Storage fees spiked (inventory buildup)?
   → Return rate increased?
   → Ad spend increased without GMS lift?

3. Mix shift?
   → Higher sales of low-margin SKUs?
   → Promo-heavy period compressing margin?
```

---

## Data Sources (To Be Configured)

| Metric | Source | Format |
|--------|--------|--------|
| GMS, Units, ASP | Business Reports | Excel/CSV |
| Traffic (Glance Views) | Business Reports | Excel/CSV |
| CVR | Business Reports | Excel/CSV |
| Advertising (Spend, ROAS) | Advertising Console | Excel/CSV |
| PCOGS breakdown | ? | Excel/PDF |
| Fees breakdown | Payments Reports | Excel/CSV |
| Inventory / IPI | Inventory Reports | Excel/CSV |
| Reviews / Ratings | ? | Scrape / API |

---

## Influencing Metrics Watchlist

These are leading indicators that predict GMS/NPPM changes:

| Metric | Impact | Leading Indicator For |
|--------|--------|----------------------|
| Search Rank (top keywords) | High | Organic Traffic |
| Buy Box % | High | CVR |
| In-Stock Rate | High | CVR, Traffic (suppression) |
| Review Rating | Medium | CVR |
| Ad Spend / TACOS | Medium | Traffic, NPPM |
| IPI Score | Medium | Storage fees, restock limits |
| Return Rate | Medium | NPPM |
| Competitor Price | Medium | CVR, ASP pressure |

---

## Notes
- Add your specific GL/sub-category breakdowns here
- Add ASIN-level detail mappings
- Add any internal metric definitions that differ from standard
