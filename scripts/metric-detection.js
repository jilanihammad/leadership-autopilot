/**
 * Content-based metric detection for Excel data files.
 *
 * Instead of relying on filenames like "GMS_Week 6_ctc_by_SUBCAT.xlsx",
 * this module reads the actual Excel content to identify:
 *   - Which metric the file contains (GMS, ShippedUnits, ASP, etc.)
 *   - Whether it's SUBCAT or ASIN level
 *   - Which week number
 *
 * Filename-based detection is kept as a fallback for backward compatibility.
 */

const XLSX = require('xlsx');

// ── Header patterns ─────────────────────────────────────────────────────────
// Maps regex patterns (tested against row 0, col 2 header text) to internal
// metric keys. Order matters: first match wins.

const METRIC_HEADER_PATTERNS = [
  { pattern: /^GMS\b/i,                        metric: 'GMS' },
  { pattern: /^Shipped\s*Units\b/i,            metric: 'ShippedUnits' },
  { pattern: /^ASP\b/i,                        metric: 'ASP' },
  { pattern: /^Net\s*PPM/i,                    metric: 'NetPPMLessSD' },
  { pattern: /^CM\s*[\(%]/i,                   metric: 'CM' },
  { pattern: /^CM\b/i,                         metric: 'CM' },
  { pattern: /SoROOS|SOROOS|OOS\s*GV/i,        metric: 'SOROOS_PROCURABLE_PRODUCT_OOS_GV_PCT' },
  { pattern: /^GV\b|^Glance\s*View/i,          metric: 'GV' },
];

// ── Detection functions ─────────────────────────────────────────────────────

/**
 * Detect metric, level, and week from Excel file content.
 *
 * @param {string} filepath - Path to the .xlsx file
 * @returns {{ metric: string, level: 'SUBCAT'|'ASIN', week: number|null } | null}
 *          Returns null if detection fails.
 */
function detectMetricFromFile(filepath) {
  try {
    const workbook = XLSX.readFile(filepath, { sheetRows: 3 }); // only need first 3 rows
    if (!workbook.SheetNames || workbook.SheetNames.length === 0) return null;

    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null });

    return detectMetricFromRows(rows);
  } catch (err) {
    return null;
  }
}

/**
 * Detect metric, level, and week from already-parsed rows.
 *
 * Excel structure (row 0 = header row with metric name):
 *   Row 0: [col0: level header, col1: name header, col2: metric header, ...]
 *   Row 1: [col0: "Total" or first subcat code, ...]
 *
 * OR (merge-row format used by some files):
 *   Row 0: [merge labels like "WoW Variance", "YoY Variance"]
 *   Row 1: [col0: level header, col1: name, col2: metric header, ...]
 *   Row 2: [col0: "Total" or first subcat code, ...]
 *
 * @param {Array<Array>} rows - Parsed sheet rows (at least 2-3 rows)
 * @returns {{ metric: string, level: 'SUBCAT'|'ASIN', week: number|null } | null}
 */
function detectMetricFromRows(rows) {
  if (!rows || rows.length < 2) return null;

  // Try both row 0 and row 1 as potential header rows
  // (some files have a merge row at row 0, real headers at row 1)
  for (const headerRowIdx of [0, 1]) {
    const headerRow = rows[headerRowIdx];
    if (!headerRow) continue;

    const col2 = String(headerRow[2] || '').trim();
    if (!col2) continue;

    // Match metric from col 2 header
    const metric = matchMetricHeader(col2);
    if (!metric) continue;

    // Detect level from col 0
    const col0 = String(headerRow[0] || '').trim();
    const level = detectLevel(col0);

    // Extract week number from col 2
    const week = extractWeekNumber(col2);

    return { metric, level, week };
  }

  return null;
}

/**
 * Match a header string against known metric patterns.
 * @param {string} headerText - The text from col 2 of the header row
 * @returns {string|null} - Internal metric key or null
 */
function matchMetricHeader(headerText) {
  for (const { pattern, metric } of METRIC_HEADER_PATTERNS) {
    if (pattern.test(headerText)) return metric;
  }
  return null;
}

/**
 * Detect SUBCAT vs ASIN from the col 0 header.
 * @param {string} col0Text - Text from col 0 of the header row
 * @returns {'SUBCAT'|'ASIN'}
 */
function detectLevel(col0Text) {
  const lower = col0Text.toLowerCase();
  if (lower.includes('asin')) return 'ASIN';
  if (lower.includes('subcategory') || lower.includes('subcat') || lower.includes('product sub')) return 'SUBCAT';
  // Default to SUBCAT if unclear (most files are subcat-level)
  return 'SUBCAT';
}

/**
 * Extract week number from a header string like "GMS (Week 6)($)".
 * @param {string} headerText
 * @returns {number|null}
 */
function extractWeekNumber(headerText) {
  const match = headerText.match(/Week\s*(\d+)/i);
  return match ? parseInt(match[1], 10) : null;
}

// ── Filename fallback ───────────────────────────────────────────────────────

/**
 * Parse metric info from filename (backward compatibility).
 * Pattern: {METRIC}_Week {N}_ctc_by_{LEVEL}.xlsx
 *
 * @param {string} filename
 * @returns {{ metric: string, week: number, level: string, isTraffic?: boolean } | null}
 */
function parseFilename(filename) {
  const match = filename.match(/^(.+?)_Week\s*(\d+)_ctc_by_(SUBCAT|ASIN)\.xlsx$/i);
  if (match) {
    return {
      metric: match[1],
      week: parseInt(match[2]),
      level: match[3].toUpperCase(),
    };
  }

  // GVs / traffic file
  if (filename.startsWith('GVs_By_Week') || filename.startsWith('GVs_')) {
    return { metric: 'GVs', level: 'CHANNEL', isTraffic: true };
  }

  return null;
}

// ── Combined detection ──────────────────────────────────────────────────────

/**
 * Detect metric info using content-based detection, falling back to filename.
 *
 * @param {string} filepath - Full path to the .xlsx file
 * @param {string} filename - Just the filename (for fallback)
 * @returns {{ metric: string, level: string, week: number|null, source: 'content'|'filename' } | null}
 */
function detectMetric(filepath, filename) {
  // Skip non-Excel files
  if (!filename.endsWith('.xlsx')) {
    // Try filename-based for CSVs (traffic files)
    const parsed = parseFilename(filename);
    if (parsed) return { ...parsed, source: 'filename' };
    return null;
  }

  // Try content-based detection first
  const contentResult = detectMetricFromFile(filepath);
  if (contentResult) {
    return { ...contentResult, source: 'content' };
  }

  // Fall back to filename
  const filenameResult = parseFilename(filename);
  if (filenameResult) {
    return { ...filenameResult, source: 'filename' };
  }

  return null;
}

module.exports = {
  METRIC_HEADER_PATTERNS,
  detectMetricFromFile,
  detectMetricFromRows,
  matchMetricHeader,
  detectLevel,
  extractWeekNumber,
  parseFilename,
  detectMetric,
};
