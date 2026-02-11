/**
 * CTC Computation Engine
 * 
 * Implements the three CTC formula types from the Rate/Mix/CTC primer:
 * 
 * 1. Non-ratio metrics (GMS, ShippedUnits, GV):
 *    CTC($) = segment_change
 *    CTC(bps) = (segment_change / total_change) × total_pct_change × 10000
 * 
 * 2. Percentage metrics (NetPPMLessSD, CM, SOROOS):
 *    Mix Impact = (P2_mix - P1_mix) × (P1_rate - P1_total_rate) × 10000
 *    Rate Impact = P2_mix × (P2_rate - P1_rate) × 10000
 *    CTC = Mix + Rate
 * 
 * 3. Per-unit metrics (ASP):
 *    Mix Impact = (P2_mix - P1_mix) × (P1_rate - P1_total_rate)
 *    Rate Impact = P2_mix × (P2_rate - P1_rate)
 *    CTC = Mix + Rate
 * 
 * All formulas compute CTC at whatever aggregation level you provide
 * (business-wide, GL-level, etc.) based on the segments and totals passed in.
 */

// Metric type classification
const NON_RATIO_METRICS = new Set(['GMS', 'ShippedUnits', 'GV']);
const PERCENTAGE_METRICS = new Set(['NetPPMLessSD', 'CM', 'SOROOS_PROCURABLE_PRODUCT_OOS_GV_PCT']);
const PER_UNIT_METRICS = new Set(['ASP']);

function getMetricType(metric) {
  if (NON_RATIO_METRICS.has(metric)) return 'non_ratio';
  if (PERCENTAGE_METRICS.has(metric)) return 'percentage';
  if (PER_UNIT_METRICS.has(metric)) return 'per_unit';
  return 'unknown';
}

// ============================================================================
// NON-RATIO METRICS (GMS, ShippedUnits, GV)
// ============================================================================

/**
 * Compute CTC for non-ratio metrics.
 * 
 * Input: array of segments, each with { code, name, p2Value, yoyPct, proportion }
 * - p2Value: current period value (e.g., GMS dollars)
 * - yoyPct: YoY percentage change as decimal (e.g., 0.66 for 66%)
 * - proportion: 1.0 for exact GL matches, <1.0 for shared-code splits
 * 
 * Output: { total, segments[] } with computed CTC for each segment
 */
function computeNonRatioCTC(segments, period = 'yoy') {
  // Step 1: Compute P1 and change for each segment
  const computed = [];
  let totalP2 = 0;
  let totalP1 = 0;

  for (const seg of segments) {
    const p2 = (seg.p2Value || 0) * (seg.proportion || 1.0);
    const yoyPct = seg.yoyPct;
    
    // Derive P1: P1 = P2 / (1 + yoyPct)
    // Handle edge cases: null YoY (new product), -100% (completely lost)
    let p1 = null;
    let change = null;

    if (yoyPct !== null && yoyPct !== undefined && isFinite(yoyPct) && yoyPct !== -1) {
      p1 = p2 / (1 + yoyPct);
      change = p2 - p1;
    } else if (yoyPct === null || yoyPct === undefined) {
      // New product (no prior period) — entire P2 is the change
      p1 = 0;
      change = p2;
    }

    totalP2 += p2;
    totalP1 += (p1 !== null ? p1 : 0);

    computed.push({
      code: seg.code,
      name: seg.name,
      p2,
      p1,
      change,
      yoyPct,
      wowPct: seg.wowPct,
      proportion: seg.proportion || 1.0,
    });
  }

  const totalChange = totalP2 - totalP1;
  const totalPctChange = totalP1 !== 0 ? totalChange / totalP1 : null;

  // Step 2: Compute CTC for each segment
  const results = computed.map(seg => {
    let ctcDollars = seg.change;
    let ctcBps = null;

    if (totalChange !== 0 && seg.change !== null && totalPctChange !== null) {
      ctcBps = Math.round((seg.change / totalChange) * totalPctChange * 10000);
    } else if (totalChange === 0) {
      ctcBps = 0;
    }

    // WoW CTC: same formula but with WoW values
    // For now, we only compute YoY CTC. WoW can use the same approach with wowPct.
    let wowCtcBps = null;
    if (seg.wowPct !== null && seg.wowPct !== undefined) {
      // We'd need total WoW change to compute WoW CTC properly
      // Defer to separate call if needed
    }

    return {
      code: seg.code,
      name: seg.name,
      value: seg.p2,
      yoyPct: seg.yoyPct,
      wowPct: seg.wowPct,
      yoyCtcDollars: ctcDollars !== null ? Math.round(ctcDollars * 100) / 100 : null,
      yoyCtcBps: ctcBps,
    };
  });

  // Sort by absolute CTC
  results.sort((a, b) => Math.abs(b.yoyCtcBps || 0) - Math.abs(a.yoyCtcBps || 0));

  return {
    total: {
      p2: totalP2,
      p1: totalP1,
      change: totalChange,
      yoyPct: totalPctChange,
    },
    segments: results,
  };
}

// ============================================================================
// PERCENTAGE METRICS (NetPPMLessSD, CM, SOROOS)
// ============================================================================

/**
 * Compute CTC with Mix/Rate decomposition for percentage metrics.
 * 
 * Input: array of segments, each with:
 * - p2Rate: current period rate (decimal, e.g., 0.30 for 30%)
 * - p2Revenue: current period revenue (denominator for rate calculation)
 * - yoyBps: YoY rate change in bps (e.g., -1902)
 * - p1Revenue: prior period revenue (if available)
 *   If not available, we derive from GMS data via gmsYoyPct
 * - gmsYoyPct: GMS YoY change (used to derive P1 revenue if p1Revenue not provided)
 * - proportion: for shared-code splits
 */
function computePercentageCTC(segments) {
  // Step 1: Compute all values needed for the formula
  const computed = [];
  let totalP2Revenue = 0;
  let totalP1Revenue = 0;

  for (const seg of segments) {
    const proportion = seg.proportion || 1.0;
    const p2Revenue = (seg.p2Revenue || 0) * proportion;
    const p2Rate = seg.p2Rate; // rate is not proportioned

    // P1 rate = P2 rate - YoY change
    const yoyBps = seg.yoyBps;
    const p1Rate = (yoyBps !== null && yoyBps !== undefined && p2Rate !== null && p2Rate !== undefined)
      ? p2Rate - (yoyBps / 10000)
      : null;

    // P1 revenue: derive from GMS YoY if not directly available
    let p1Revenue;
    if (seg.p1Revenue !== undefined && seg.p1Revenue !== null) {
      p1Revenue = seg.p1Revenue * proportion;
    } else if (seg.gmsYoyPct !== null && seg.gmsYoyPct !== undefined && seg.gmsYoyPct !== -1) {
      p1Revenue = p2Revenue / (1 + seg.gmsYoyPct);
    } else if (seg.gmsYoyPct === null || seg.gmsYoyPct === undefined) {
      // New product — no prior revenue
      p1Revenue = 0;
    } else {
      p1Revenue = 0;
    }

    totalP2Revenue += p2Revenue;
    totalP1Revenue += p1Revenue;

    computed.push({
      code: seg.code,
      name: seg.name,
      p2Rate,
      p1Rate,
      p2Revenue,
      p1Revenue,
      yoyBps,
      wowBps: seg.wowBps,
      proportion,
    });
  }

  // Step 2: Compute total rates (weighted averages)
  let totalP2Rate = null;
  let totalP1Rate = null;

  if (totalP2Revenue > 0) {
    let sumP2Weighted = 0;
    let sumP1Weighted = 0;
    for (const seg of computed) {
      if (seg.p2Rate !== null) sumP2Weighted += seg.p2Revenue * seg.p2Rate;
      if (seg.p1Rate !== null && seg.p1Revenue > 0) sumP1Weighted += seg.p1Revenue * seg.p1Rate;
    }
    totalP2Rate = sumP2Weighted / totalP2Revenue;
    totalP1Rate = totalP1Revenue > 0 ? sumP1Weighted / totalP1Revenue : null;
  }

  // Step 3: Compute Mix/Rate/CTC for each segment
  const results = computed.map(seg => {
    let mixImpact = null;
    let rateImpact = null;
    let ctcBps = null;

    const p2Mix = totalP2Revenue > 0 ? seg.p2Revenue / totalP2Revenue : 0;
    const p1Mix = totalP1Revenue > 0 ? seg.p1Revenue / totalP1Revenue : 0;

    if (seg.p1Rate !== null && totalP1Rate !== null) {
      // Mix Impact = (P2_mix - P1_mix) × (P1_rate - P1_total_rate) × 10000
      mixImpact = (p2Mix - p1Mix) * (seg.p1Rate - totalP1Rate) * 10000;
      
      // Rate Impact = P2_mix × (P2_rate - P1_rate) × 10000
      rateImpact = p2Mix * ((seg.p2Rate - seg.p1Rate) * 10000);
      
      // CTC = Mix + Rate
      ctcBps = Math.round(mixImpact + rateImpact);
      mixImpact = Math.round(mixImpact);
      rateImpact = Math.round(rateImpact);
    }

    return {
      code: seg.code,
      name: seg.name,
      value: seg.p2Rate,
      yoyBps: seg.yoyBps,
      wowBps: seg.wowBps,
      yoyCtcBps: ctcBps,
      yoyMixBps: mixImpact,
      yoyRateBps: rateImpact,
    };
  });

  results.sort((a, b) => Math.abs(b.yoyCtcBps || 0) - Math.abs(a.yoyCtcBps || 0));

  return {
    total: {
      p2Rate: totalP2Rate,
      p1Rate: totalP1Rate,
      p2Revenue: totalP2Revenue,
      p1Revenue: totalP1Revenue,
      yoyBps: totalP1Rate !== null && totalP2Rate !== null
        ? Math.round((totalP2Rate - totalP1Rate) * 10000)
        : null,
    },
    segments: results,
  };
}

// ============================================================================
// PER-UNIT METRICS (ASP)
// ============================================================================

/**
 * Compute CTC for per-unit metrics (ASP).
 * Same as percentage but without ×10000 multiplier (result in dollars, not bps).
 * 
 * Input: array of segments with:
 * - p2Rate: current ASP ($)
 * - p2Denominator: current period units (col 4 from ASP file = Shipped Units)
 * - yoyPct: YoY PERCENTAGE change as decimal (e.g., 0.4649 for +46.49%)
 *           NOTE: ASP YoY is a percentage, NOT a bps delta like Net PPM
 * - proportion: for shared-code splits
 */
function computePerUnitCTC(segments) {
  const computed = [];
  let totalP2Units = 0;
  let totalP1Units = 0;

  for (const seg of segments) {
    const proportion = seg.proportion || 1.0;
    const p2Units = (seg.p2Denominator || 0) * proportion;
    const p2Rate = seg.p2Rate; // ASP value in dollars

    // P1 rate from YoY PERCENTAGE change
    // ASP YoY is a percentage (e.g., 0.4649 = +46.49%), not a bps delta
    // So P1 = P2 / (1 + yoyPct)
    const yoyPct = seg.yoyPct;
    let p1Rate = null;
    if (yoyPct !== null && yoyPct !== undefined && p2Rate !== null && yoyPct !== -1) {
      p1Rate = p2Rate / (1 + yoyPct);
    }

    // P1 units: derive from P2 units and units YoY%
    // The units YoY is available from the ASP file's denominator column
    // or from the ShippedUnits file cross-reference
    let p1Units;
    if (seg.unitsYoyPct !== null && seg.unitsYoyPct !== undefined && seg.unitsYoyPct !== -1) {
      p1Units = p2Units / (1 + seg.unitsYoyPct);
    } else if (yoyPct === null || yoyPct === undefined) {
      p1Units = 0; // new product
    } else {
      p1Units = 0;
    }

    totalP2Units += p2Units;
    totalP1Units += p1Units;

    computed.push({
      code: seg.code, name: seg.name,
      p2Rate, p1Rate, p2Units, p1Units,
      yoyPct, wowPct: seg.wowPct, proportion,
    });
  }

  // Total rates (weighted by units)
  let totalP2Rate = null, totalP1Rate = null;
  if (totalP2Units > 0) {
    let sumP2 = 0, sumP1 = 0;
    for (const seg of computed) {
      if (seg.p2Rate !== null) sumP2 += seg.p2Units * seg.p2Rate;
      if (seg.p1Rate !== null && seg.p1Units > 0) sumP1 += seg.p1Units * seg.p1Rate;
    }
    totalP2Rate = sumP2 / totalP2Units;
    totalP1Rate = totalP1Units > 0 ? sumP1 / totalP1Units : null;
  }

  // Mix/Rate/CTC (same formula as percentage, but no ×10000 — result in dollars)
  const results = computed.map(seg => {
    let mixImpact = null, rateImpact = null, ctc = null;
    const p2Mix = totalP2Units > 0 ? seg.p2Units / totalP2Units : 0;
    const p1Mix = totalP1Units > 0 ? seg.p1Units / totalP1Units : 0;

    if (seg.p1Rate !== null && totalP1Rate !== null) {
      mixImpact = (p2Mix - p1Mix) * (seg.p1Rate - totalP1Rate);
      rateImpact = p2Mix * (seg.p2Rate - seg.p1Rate);
      ctc = Math.round((mixImpact + rateImpact) * 100) / 100;
      mixImpact = Math.round(mixImpact * 100) / 100;
      rateImpact = Math.round(rateImpact * 100) / 100;
    }

    return {
      code: seg.code, name: seg.name,
      value: seg.p2Rate,
      yoyPct: seg.yoyPct,
      wowPct: seg.wowPct,
      yoyCtc: ctc,        // in dollars for ASP
      yoyMix: mixImpact,
      yoyRate: rateImpact,
    };
  });

  results.sort((a, b) => Math.abs(b.yoyCtc || 0) - Math.abs(a.yoyCtc || 0));

  return {
    total: {
      p2Rate: totalP2Rate,
      p1Rate: totalP1Rate,
      p2Units: totalP2Units,
      p1Units: totalP1Units,
      yoyChange: totalP1Rate !== null && totalP2Rate !== null
        ? Math.round((totalP2Rate - totalP1Rate) * 100) / 100
        : null,
    },
    segments: results,
  };
}

module.exports = {
  getMetricType,
  computeNonRatioCTC,
  computePercentageCTC,
  computePerUnitCTC,
  NON_RATIO_METRICS,
  PERCENTAGE_METRICS,
  PER_UNIT_METRICS,
};
