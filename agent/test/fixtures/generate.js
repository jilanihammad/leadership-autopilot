#!/usr/bin/env node
/**
 * Generate test fixtures for tools.test.js
 * Creates mock XLSX and YAML files for deterministic testing
 */

const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');
const yaml = require('yaml');

const FIXTURES_DIR = __dirname;
const MOCK_DATA_DIR = path.join(FIXTURES_DIR, 'mock-data');

// Create directory structure
const weekDir = path.join(MOCK_DATA_DIR, '2099-wk01', 'gl', 'testgl');
fs.mkdirSync(weekDir, { recursive: true });

console.log('Creating test fixtures...\n');

// =============================================================================
// 1. Valid GMS subcat file
// =============================================================================
function createGMSSubcat() {
  const data = [
    ['', '', '', '', '', '', '', '', ''], // Header row 1
    ['Code', 'Description', 'Week Value', 'WoW %', 'YoY %', 'WoW CTC', 'WoW bps', 'YoY CTC', 'YoY bps'],
    ['Total', '', 1000000, 0.05, 0.25, 50000, 500, 200000, 2000],
    ['CAT001', 'Category One', 400000, 0.10, 0.30, 40000, 400, 90000, 900],
    ['CAT002', 'Category Two', 350000, 0.02, 0.20, 7000, 70, 60000, 600],
    ['CAT003', 'Category Three', 250000, -0.05, 0.15, -12500, -125, 50000, 500],
  ];
  
  const ws = XLSX.utils.aoa_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
  XLSX.writeFile(wb, path.join(weekDir, 'GMS_Week 1_ctc_by_SUBCAT.xlsx'));
  console.log('✓ Created GMS_Week 1_ctc_by_SUBCAT.xlsx');
}

// =============================================================================
// 2. Valid Units subcat file
// =============================================================================
function createUnitsSubcat() {
  const data = [
    ['', '', '', '', '', '', '', '', ''],
    ['Code', 'Description', 'Week Value', 'WoW %', 'YoY %', 'WoW CTC', 'WoW bps', 'YoY CTC', 'YoY bps'],
    ['Total', '', 50000, 0.03, 0.20, 1500, 300, 8333, 1667],
    ['CAT001', 'Category One', 20000, 0.08, 0.25, 1600, 320, 4000, 800],
    ['CAT002', 'Category Two', 18000, 0.01, 0.18, 180, 36, 2745, 549],
    ['CAT003', 'Category Three', 12000, -0.02, 0.12, -240, -48, 1286, 257],
  ];
  
  const ws = XLSX.utils.aoa_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
  XLSX.writeFile(wb, path.join(weekDir, 'ShippedUnits_Week 1_ctc_by_SUBCAT.xlsx'));
  console.log('✓ Created ShippedUnits_Week 1_ctc_by_SUBCAT.xlsx');
}

// =============================================================================
// 3. Valid Net PPM subcat file (margin metric with different columns)
// =============================================================================
function createNetPPMSubcat() {
  // Margin metrics have: Code, Name, Value%, NR, Rev$, WoW(bps), YoY(bps), WoW CTC, Mix, Rate, YoY CTC, Mix, Rate
  const data = [
    ['', '', '', '', '', '', '', '', '', '', '', '', ''],
    ['Code', 'Description', 'Value %', 'NR', 'Rev Share', 'WoW bps', 'YoY bps', 'WoW CTC', 'Mix', 'Rate', 'YoY CTC', 'Mix', 'Rate'],
    ['Total', '', 0.15, 0, 1000000, 50, -100, 50, 20, 30, -100, -40, -60],
    ['CAT001', 'Category One', 0.18, 0, 400000, 80, -50, 32, 10, 22, -20, -8, -12],
    ['CAT002', 'Category Two', 0.12, 0, 350000, 30, -120, 10, 5, 5, -42, -15, -27],
    ['CAT003', 'Category Three', 0.14, 0, 250000, 20, -80, 5, 3, 2, -28, -10, -18],
  ];
  
  const ws = XLSX.utils.aoa_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
  XLSX.writeFile(wb, path.join(weekDir, 'NetPPMLessSD_Week 1_ctc_by_SUBCAT.xlsx'));
  console.log('✓ Created NetPPMLessSD_Week 1_ctc_by_SUBCAT.xlsx');
}

// =============================================================================
// 4. Valid ASIN file
// =============================================================================
function createASINFile() {
  const data = [
    ['', '', '', '', '', '', '', '', ''],
    ['ASIN', 'Item Name', 'Week Value', 'WoW %', 'YoY %', 'WoW CTC', 'WoW bps', 'YoY CTC', 'YoY bps'],
    ['Total', '', 1000000, 0.05, 0.25, 50000, 500, 200000, 2000],
    ['B0001AAAAA', 'Test Product One - Very Long Name That Should Be Truncated For Display Purposes In The UI', 150000, 0.15, 0.40, 22500, 225, 42857, 429],
    ['B0002BBBBB', 'Test Product Two', 120000, 0.08, 0.30, 9600, 96, 27692, 277],
    ['B0003CCCCC', 'Test Product Three', 80000, -0.10, 0.10, -8000, -80, 7273, 73],
  ];
  
  const ws = XLSX.utils.aoa_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
  XLSX.writeFile(wb, path.join(weekDir, 'GMS_Week 1_ctc_by_ASIN.xlsx'));
  console.log('✓ Created GMS_Week 1_ctc_by_ASIN.xlsx');
}

// =============================================================================
// 5. Valid manifest
// =============================================================================
function createManifest() {
  const manifest = {
    gl: 'testgl',
    week: '2099-wk01',
    generated: new Date().toISOString(),
    metrics_available: ['GMS', 'ShippedUnits', 'NetPPMLessSD'],
    files: {
      subcat: {
        GMS: 'GMS_Week 1_ctc_by_SUBCAT.xlsx',
        ShippedUnits: 'ShippedUnits_Week 1_ctc_by_SUBCAT.xlsx',
        NetPPMLessSD: 'NetPPMLessSD_Week 1_ctc_by_SUBCAT.xlsx',
      },
      asin: {
        GMS: 'GMS_Week 1_ctc_by_ASIN.xlsx',
      },
    },
  };
  
  fs.writeFileSync(path.join(weekDir, '_manifest.yaml'), yaml.stringify(manifest));
  console.log('✓ Created _manifest.yaml');
}

// =============================================================================
// 6. Valid summary
// =============================================================================
function createSummary() {
  const summary = `# TestGL — Week 1 Summary

## Shipped GMS
**Total:** $1.0M | **WoW:** +5.0% | **YoY:** +25.0%

### Top YoY Drivers (by CTC)
| Rank | Sub-Category | YoY CTC | Note |
|------|--------------|---------|------|
| 1 | Category One | +900 bps | |
| 2 | Category Two | +600 bps | |
| 3 | Category Three | +500 bps | |

## Shipped Units
**Total:** 50.0K | **WoW:** +3.0% | **YoY:** +20.0%
`;
  
  fs.writeFileSync(path.join(weekDir, '_summary.md'), summary);
  console.log('✓ Created _summary.md');
}

// =============================================================================
// 7. Empty workbook (malformed)
// =============================================================================
function createEmptyWorkbook() {
  const wb = XLSX.utils.book_new();
  // Don't add any sheets - this is malformed
  const emptyDir = path.join(FIXTURES_DIR, 'malformed');
  fs.mkdirSync(emptyDir, { recursive: true });
  
  // XLSX requires at least one sheet, so create with empty sheet
  const ws = XLSX.utils.aoa_to_sheet([]);
  XLSX.utils.book_append_sheet(wb, ws, 'Empty');
  XLSX.writeFile(wb, path.join(emptyDir, 'empty_workbook.xlsx'));
  console.log('✓ Created malformed/empty_workbook.xlsx');
}

// =============================================================================
// 8. Malformed YAML
// =============================================================================
function createMalformedYAML() {
  const malformedDir = path.join(FIXTURES_DIR, 'malformed');
  fs.mkdirSync(malformedDir, { recursive: true });
  
  // Invalid YAML syntax
  fs.writeFileSync(path.join(malformedDir, 'bad_manifest.yaml'), `
gl: testgl
week: [unclosed bracket
  invalid: : : colons
`);
  console.log('✓ Created malformed/bad_manifest.yaml');
}

// =============================================================================
// 9. File with zero values (for division testing)
// =============================================================================
function createZeroValuesFile() {
  const data = [
    ['', '', '', '', '', '', '', '', ''],
    ['Code', 'Description', 'Week Value', 'WoW %', 'YoY %', 'WoW CTC', 'WoW bps', 'YoY CTC', 'YoY bps'],
    ['Total', '', 0, 0, 0, 0, 0, 0, 0],
    ['CAT001', 'Zero Category', 0, null, null, 0, 0, 0, 0],
  ];
  
  const ws = XLSX.utils.aoa_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
  
  const edgeCaseDir = path.join(FIXTURES_DIR, 'edge-cases');
  fs.mkdirSync(edgeCaseDir, { recursive: true });
  XLSX.writeFile(wb, path.join(edgeCaseDir, 'zero_values.xlsx'));
  console.log('✓ Created edge-cases/zero_values.xlsx');
}

// Run all generators
createGMSSubcat();
createUnitsSubcat();
createNetPPMSubcat();
createASINFile();
createManifest();
createSummary();
createEmptyWorkbook();
createMalformedYAML();
createZeroValuesFile();

console.log('\n✅ All fixtures created successfully!');
console.log(`   Location: ${MOCK_DATA_DIR}`);
