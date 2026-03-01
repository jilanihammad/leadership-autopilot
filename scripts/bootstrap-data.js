#!/usr/bin/env node
/**
 * Bootstrap Data — Auto-generates gl/ structure, manifests, and summaries.
 *
 * Runs on startup (before the API server) and:
 * 1. Scans data/weekly/ for week folders
 * 2. Finds source GL directories (ALL/, PC/, etc.) with Excel files
 * 3. Creates gl/{name}/ with symlinks to source files
 * 4. Generates _manifest.yaml and _summary.md per GL
 *
 * Skips GLs that already have an up-to-date manifest.
 */

const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const yaml = require('yaml');
const {
  parseFilename,
  readExcelFile,
  parseSubcatData,
  parseTrafficData,
  generateSummaryMd,
  generateManifest,
} = require('./generate_summary');
const { detectMetric } = require('./metric-detection');

const DATA_DIR = path.join(__dirname, '..', 'data', 'weekly');
const GL_MAPPING_PATH = path.join(__dirname, '..', 'data', 'GL to Subcat mapping.xlsx');

/**
 * Load GL-to-subcat mapping. Returns Map<glName, Set<shortSubcatCode>>.
 */
function loadGLMapping() {
  if (!fs.existsSync(GL_MAPPING_PATH)) return null;
  const wb = XLSX.readFile(GL_MAPPING_PATH);
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null });

  const glToSubcats = new Map();
  for (let i = 1; i < rows.length; i++) {
    const gl = rows[i][0];
    if (!gl) continue;
    const glKey = String(gl).trim().toLowerCase();
    const desc = String(rows[i][1] || '').trim();
    const codeMatch = desc.match(/^(\d+)\s/);
    const shortCode = codeMatch ? codeMatch[1] : null;

    if (!glToSubcats.has(glKey)) glToSubcats.set(glKey, new Set());
    if (shortCode) glToSubcats.get(glKey).add(shortCode);
  }
  return glToSubcats;
}

/**
 * Check if a directory contains Excel data files (by naming convention OR content detection).
 */
function hasExcelDataFiles(dirPath) {
  if (!fs.statSync(dirPath).isDirectory()) return false;
  const files = fs.readdirSync(dirPath);
  // Quick check: any .xlsx files at all?
  const xlsxFiles = files.filter(f => f.endsWith('.xlsx'));
  if (xlsxFiles.length === 0) return false;
  // Fast path: check naming convention first
  if (xlsxFiles.some(f => /^.+_Week\s*\d+_ctc_by_(SUBCAT|ASIN)\.xlsx$/i.test(f))) return true;
  // Slow path: try content-based detection on first .xlsx file
  const firstFile = xlsxFiles[0];
  const result = detectMetric(path.join(dirPath, firstFile), firstFile);
  return result !== null;
}

/**
 * Get the newest mtime among data files in a directory.
 */
function newestFileMtime(dirPath) {
  let newest = 0;
  for (const f of fs.readdirSync(dirPath)) {
    if (f.startsWith('_')) continue; // skip manifest/summary
    const stat = fs.statSync(path.join(dirPath, f));
    if (stat.mtimeMs > newest) newest = stat.mtimeMs;
  }
  return newest;
}

/**
 * Bootstrap a single GL directory: create symlinks, manifest, and summary.
 */
function bootstrapGL(weekDir, weekNum, sourceDirName) {
  const sourceDir = path.join(weekDir, sourceDirName);
  const glName = sourceDirName.toLowerCase();
  const glDir = path.join(weekDir, 'gl');
  const targetDir = path.join(glDir, glName);

  // Check if manifest already exists and is newer than source files
  const manifestPath = path.join(targetDir, '_manifest.yaml');
  if (fs.existsSync(manifestPath)) {
    const manifestMtime = fs.statSync(manifestPath).mtimeMs;
    const sourceMtime = newestFileMtime(sourceDir);
    if (manifestMtime > sourceMtime) {
      return null; // up-to-date, skip
    }
  }

  // Ensure gl/ and gl/{name}/ exist
  fs.mkdirSync(targetDir, { recursive: true });

  // Get data files from source
  const dataFiles = fs.readdirSync(sourceDir).filter(f =>
    f.endsWith('.xlsx') || f.endsWith('.csv')
  );

  // Create symlinks for each data file
  for (const file of dataFiles) {
    const linkPath = path.join(targetDir, file);
    const targetPath = path.join('..', '..', sourceDirName, file);

    // Remove existing symlink/file if present
    try {
      fs.lstatSync(linkPath);
      fs.unlinkSync(linkPath);
    } catch (e) {
      // doesn't exist, nothing to remove
    }

    fs.symlinkSync(targetPath, linkPath);
  }

  // Parse metrics for summary generation (content-based detection with filename fallback)
  const metrics = {};
  let traffic = null;
  const detectedFiles = []; // { file, metric, level, isTraffic }

  for (const file of dataFiles) {
    const filepath = path.join(sourceDir, file);
    const detected = detectMetric(filepath, file);
    if (!detected) continue;

    detectedFiles.push({ file, ...detected });

    if (detected.isTraffic) {
      traffic = parseTrafficData(filepath);
    } else if (detected.level === 'SUBCAT') {
      const rows = readExcelFile(filepath);
      metrics[detected.metric] = parseSubcatData(rows, detected.metric);
    }
  }

  // Generate manifest using detected info
  const manifest = generateManifest(glName, weekNum, dataFiles, null, detectedFiles);
  fs.writeFileSync(manifestPath, yaml.stringify(manifest));

  // Generate summary
  const summaryMd = generateSummaryMd(glName, weekNum, metrics, traffic);
  fs.writeFileSync(path.join(targetDir, '_summary.md'), summaryMd);

  return { glName, metrics: manifest.metrics_available.length, files: dataFiles.length };
}

/**
 * Main bootstrap: scan all weeks and process GL directories.
 */
function main() {
  if (!fs.existsSync(DATA_DIR)) {
    console.log('bootstrap-data: No data/weekly/ directory found, skipping.');
    return;
  }

  const weeks = fs.readdirSync(DATA_DIR)
    .filter(d => d.match(/^\d{4}-wk\d+$/) && fs.statSync(path.join(DATA_DIR, d)).isDirectory())
    .sort();

  let totalBootstrapped = 0;

  for (const week of weeks) {
    const weekDir = path.join(DATA_DIR, week);
    const weekMatch = week.match(/wk(\d+)/);
    const weekNum = weekMatch ? parseInt(weekMatch[1]) : 0;

    // Find source GL directories (direct children with Excel data files)
    // Skip 'gl/' itself — that's our output directory
    const sourceDirs = fs.readdirSync(weekDir)
      .filter(d => {
        if (d === 'gl' || d.startsWith('.')) return false;
        const fullPath = path.join(weekDir, d);
        return fs.statSync(fullPath).isDirectory() && hasExcelDataFiles(fullPath);
      });

    if (sourceDirs.length === 0) {
      // No source dirs found — check if gl/ already has manifests (legacy layout like wk05)
      const glDir = path.join(weekDir, 'gl');
      if (fs.existsSync(glDir)) {
        const existingGLs = fs.readdirSync(glDir)
          .filter(d => fs.statSync(path.join(glDir, d)).isDirectory());

        // Regenerate manifests for legacy GLs that have Excel files but no manifest
        for (const gl of existingGLs) {
          const glPath = path.join(glDir, gl);
          const manifestPath = path.join(glPath, '_manifest.yaml');
          if (!fs.existsSync(manifestPath) && hasExcelDataFiles(glPath)) {
            // This GL has data but no manifest — generate one
            const dataFiles = fs.readdirSync(glPath).filter(f =>
              f.endsWith('.xlsx') || f.endsWith('.csv')
            );

            const metrics = {};
            let traffic = null;
            const detectedFiles = [];
            for (const file of dataFiles) {
              const filepath = path.join(glPath, file);
              const detected = detectMetric(filepath, file);
              if (!detected) continue;
              detectedFiles.push({ file, ...detected });
              if (detected.isTraffic) {
                traffic = parseTrafficData(filepath);
              } else if (detected.level === 'SUBCAT') {
                const rows = readExcelFile(filepath);
                metrics[detected.metric] = parseSubcatData(rows, detected.metric);
              }
            }

            const manifest = generateManifest(gl, weekNum, dataFiles, null, detectedFiles);
            fs.writeFileSync(manifestPath, yaml.stringify(manifest));
            fs.writeFileSync(path.join(glPath, '_summary.md'),
              generateSummaryMd(gl, weekNum, metrics, traffic));

            console.log(`  ${week}/${gl}: regenerated manifest + summary (${manifest.metrics_available.length} metrics)`);
            totalBootstrapped++;
          }
        }
      }
      continue;
    }

    // Bootstrap each source directory
    for (const sourceDir of sourceDirs) {
      const result = bootstrapGL(weekDir, weekNum, sourceDir);
      if (result) {
        console.log(`  ${week}/${result.glName}: ${result.metrics} metrics, ${result.files} files`);
        totalBootstrapped++;
      }
    }

    // If an ALL folder exists, derive per-GL directories using the GL mapping
    const allDir = sourceDirs.find(d => d.toUpperCase() === 'ALL');
    if (allDir) {
      const glMapping = loadGLMapping();
      if (glMapping) {
        for (const [glName, subcatCodes] of glMapping) {
          // Skip if this GL already has a dedicated source folder (e.g., PC/)
          const hasOwnFolder = sourceDirs.some(d => d.toLowerCase() === glName);
          if (hasOwnFolder) continue;

          const targetDir = path.join(weekDir, 'gl', glName);
          const manifestPath = path.join(targetDir, '_manifest.yaml');

          // Check freshness — skip if manifest is newer than ALL source
          if (fs.existsSync(manifestPath)) {
            const manifestMtime = fs.statSync(manifestPath).mtimeMs;
            const sourceMtime = newestFileMtime(path.join(weekDir, allDir));
            if (manifestMtime > sourceMtime) continue;
          }

          // Create dir and symlink ALL data files
          fs.mkdirSync(targetDir, { recursive: true });
          const allSourceDir = path.join(weekDir, allDir);
          const dataFiles = fs.readdirSync(allSourceDir).filter(f =>
            f.endsWith('.xlsx') || f.endsWith('.csv')
          );

          for (const file of dataFiles) {
            const linkPath = path.join(targetDir, file);
            try { fs.lstatSync(linkPath); fs.unlinkSync(linkPath); } catch (e) {}
            fs.symlinkSync(path.join('..', '..', allDir, file), linkPath);
          }

          // Parse metrics and generate summary using content-based detection
          const metrics = {};
          let traffic = null;
          const detectedFiles = [];
          for (const file of dataFiles) {
            const filepath = path.join(allSourceDir, file);
            const detected = detectMetric(filepath, file);
            if (!detected) continue;
            detectedFiles.push({ file, ...detected });
            if (detected.isTraffic) {
              traffic = parseTrafficData(filepath);
            } else if (detected.level === 'SUBCAT') {
              const rows = readExcelFile(filepath);
              metrics[detected.metric] = parseSubcatData(rows, detected.metric);
            }
          }

          // Generate manifest using detected info
          const manifest = generateManifest(glName, weekNum, dataFiles, null, detectedFiles);
          fs.writeFileSync(manifestPath, yaml.stringify(manifest));
          fs.writeFileSync(path.join(targetDir, '_summary.md'),
            generateSummaryMd(glName, weekNum, metrics, traffic));

          console.log(`  ${week}/${glName}: derived from ALL (${manifest.metrics_available.length} metrics)`);
          totalBootstrapped++;
        }
      }
    }
  }

  if (totalBootstrapped > 0) {
    console.log(`bootstrap-data: ${totalBootstrapped} GL(s) bootstrapped.`);
  } else {
    console.log('bootstrap-data: All GLs up-to-date.');
  }
}

main();
