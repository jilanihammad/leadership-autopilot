/**
 * GL-to-Subcategory Mapping
 * 
 * Loads the mapping file and provides lookup functions to assign
 * subcats (by name or code) to their GL.
 * 
 * Handles:
 * - Unique subcats (94% of data): direct name match
 * - Code suffix fallback (3%): match last N digits of full code to mapping short code
 * - Shared-code subcats (1.6%): UNKNOWN, Laptop Carrying Cases, Audio Video Cables
 *   → proportional split using mapping GMS values
 * - Unmatched subcats (~6%): assigned to "Other"
 */

const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');

/**
 * Normalize a string for matching: lowercase, collapse whitespace, trim
 */
function normalize(s) {
  return String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Load the GL-to-Subcat mapping from Excel.
 * 
 * Returns {
 *   nameToGL: { normalized_name -> GL },
 *   codeToGL: { short_code -> GL },
 *   sharedCodes: { short_code -> { gl1: gms, gl2: gms, ... } },
 *   glList: string[],
 *   entries: [{ gl, shortCode, name, gms }],
 * }
 */
function loadMapping(mappingPath) {
  if (!fs.existsSync(mappingPath)) {
    throw new Error(`Mapping file not found: ${mappingPath}`);
  }

  const wb = XLSX.readFile(mappingPath);
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null });

  // Col 0 = GL Description, Col 1 = "ShortCode SubcatName", Col 2 = GMS($)
  const nameToGL = {};       // normalized name -> GL (first match wins; overwritten by dupes)
  const codeToGL = {};       // short code -> GL (first match wins; overwritten by dupes)
  const codeGLMap = {};      // short code -> { gl -> gms } (for shared codes)
  const nameGLMap = {};      // normalized name -> { gl -> gms }
  const entries = [];
  const glSet = new Set();

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || !row[0]) continue;

    const gl = String(row[0]).trim();
    const rawSubcat = String(row[1] || '').trim();
    const gms = parseFloat(row[2]) || 0;

    glSet.add(gl);

    // Parse "ShortCode SubcatName" format
    const match = rawSubcat.match(/^(\d+)\s+(.+)$/);
    let shortCode, name;
    if (match) {
      shortCode = match[1];
      name = match[2].trim();
    } else if (rawSubcat.toUpperCase() === 'UNKNOWN') {
      shortCode = 'UNKNOWN';
      name = 'UNKNOWN';
    } else {
      shortCode = rawSubcat;
      name = rawSubcat;
    }

    entries.push({ gl, shortCode, name, gms });

    const normName = normalize(name);

    // Track all GLs per code/name for detecting shared codes
    if (!codeGLMap[shortCode]) codeGLMap[shortCode] = {};
    codeGLMap[shortCode][gl] = (codeGLMap[shortCode][gl] || 0) + gms;

    if (!nameGLMap[normName]) nameGLMap[normName] = {};
    nameGLMap[normName][gl] = (nameGLMap[normName][gl] || 0) + gms;

    // Simple lookups (last writer wins — fine for unique codes/names)
    nameToGL[normName] = gl;
    codeToGL[shortCode] = gl;
  }

  // Identify shared codes (appear in >1 GL)
  const sharedCodes = {};
  for (const [code, glGms] of Object.entries(codeGLMap)) {
    if (Object.keys(glGms).length > 1) {
      sharedCodes[code] = glGms;
    }
  }

  // For shared names, nameToGL is unreliable — remove them
  // so code-based matching takes priority
  const sharedNames = new Set();
  for (const [name, glGms] of Object.entries(nameGLMap)) {
    if (Object.keys(glGms).length > 1) {
      sharedNames.add(name);
    }
  }

  return {
    nameToGL,
    codeToGL,
    sharedCodes,
    sharedNames,
    nameGLMap,
    glList: [...glSet].sort(),
    entries,
    _normalize: normalize,
  };
}

/**
 * Resolve a data file row (fullCode, name) to a GL assignment.
 * 
 * Returns {
 *   gl: string | null,
 *   confidence: 'exact' | 'code_suffix' | 'shared' | 'unmatched',
 *   sharedGLs: { gl: proportion } | null  (only for shared codes)
 * }
 */
function resolveGL(mapping, fullCode, name) {
  const normName = normalize(name);
  const code = String(fullCode).trim();

  // Strategy 1: Name match (if name is not shared across GLs)
  if (!mapping.sharedNames.has(normName) && mapping.nameToGL[normName]) {
    return {
      gl: mapping.nameToGL[normName],
      confidence: 'exact',
      sharedGLs: null,
    };
  }

  // Strategy 2: Code suffix match (try 4, 5, 6 digit suffixes)
  for (const len of [4, 5, 6]) {
    if (code.length >= len) {
      const suffix = code.slice(-len);
      const sharedInfo = mapping.sharedCodes[suffix];
      
      if (sharedInfo) {
        // This is a shared code — return proportional split info
        const totalGMS = Object.values(sharedInfo).reduce((a, b) => a + b, 0);
        const proportions = {};
        for (const [gl, gms] of Object.entries(sharedInfo)) {
          proportions[gl] = totalGMS > 0 ? gms / totalGMS : 1 / Object.keys(sharedInfo).length;
        }
        return {
          gl: null, // ambiguous — caller must handle
          confidence: 'shared',
          sharedGLs: proportions,
        };
      }

      if (mapping.codeToGL[suffix]) {
        return {
          gl: mapping.codeToGL[suffix],
          confidence: 'code_suffix',
          sharedGLs: null,
        };
      }
    }
  }

  // Strategy 3: Check UNKNOWN
  if (code === 'UNKNOWN' || normName === 'unknown') {
    const sharedInfo = mapping.sharedCodes['UNKNOWN'];
    if (sharedInfo) {
      const totalGMS = Object.values(sharedInfo).reduce((a, b) => a + b, 0);
      const proportions = {};
      for (const [gl, gms] of Object.entries(sharedInfo)) {
        proportions[gl] = totalGMS > 0 ? gms / totalGMS : 0;
      }
      return {
        gl: null,
        confidence: 'shared',
        sharedGLs: proportions,
      };
    }
  }

  // Strategy 4: Shared name — try to disambiguate by name
  if (mapping.sharedNames.has(normName) && mapping.nameGLMap[normName]) {
    const glGms = mapping.nameGLMap[normName];
    const gls = Object.keys(glGms);
    if (gls.length === 1) {
      return { gl: gls[0], confidence: 'exact', sharedGLs: null };
    }
    // Multiple GLs — return as shared
    const totalGMS = Object.values(glGms).reduce((a, b) => a + b, 0);
    const proportions = {};
    for (const [gl, gms] of Object.entries(glGms)) {
      proportions[gl] = totalGMS > 0 ? gms / totalGMS : 1 / gls.length;
    }
    return { gl: null, confidence: 'shared', sharedGLs: proportions };
  }

  return { gl: null, confidence: 'unmatched', sharedGLs: null };
}

/**
 * Assign all rows from a consolidated file to GLs.
 * 
 * Returns Map<GL, Row[]> where each row includes the original data
 * plus a `_proportion` field (1.0 for exact matches, <1.0 for shared splits)
 */
function assignRowsToGLs(mapping, rows) {
  // rows is array of parsed data rows (skip header/total)
  const glRows = new Map();

  for (const row of rows) {
    const code = String(row.code).trim();
    const name = String(row.name || '').trim();
    const resolution = resolveGL(mapping, code, name);

    if (resolution.confidence === 'exact' || resolution.confidence === 'code_suffix') {
      const gl = resolution.gl;
      if (!glRows.has(gl)) glRows.set(gl, []);
      glRows.get(gl).push({ ...row, _proportion: 1.0, _confidence: resolution.confidence });
    } else if (resolution.confidence === 'shared' && resolution.sharedGLs) {
      // Split row across GLs proportionally
      for (const [gl, proportion] of Object.entries(resolution.sharedGLs)) {
        if (!glRows.has(gl)) glRows.set(gl, []);
        glRows.get(gl).push({ ...row, _proportion: proportion, _confidence: 'shared' });
      }
    }
    // 'unmatched' rows are dropped (could be tracked separately if needed)
  }

  return glRows;
}

module.exports = {
  loadMapping,
  resolveGL,
  assignRowsToGLs,
  normalize,
};
