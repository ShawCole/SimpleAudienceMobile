/**
 * csv-to-dataset.mjs
 * Converts IntentCore CSV exports to compact JSON datasets for map visualization.
 *
 * Exports:
 *   convertCsvToDataset(csvPath, intent) → CompactRecord[]
 *   mergeDatasets(recordArrays, outputPath) → void
 *
 * Key differences from ListMagic_Dev reference:
 *   - Uses PERSONAL_ZIP/STATE/CITY first, falls back to SKIPTRACE_* if personal is empty
 *   - Loads uszips.csv (not zip-lookup.json) for lat/lng/county_fips lookup
 *   - Standalone ESM module — no Express dependency
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Path to shared uszips data relative to this file: tools/lib → shared/data
const USZIPS_PATH = path.join(__dirname, '..', '..', 'shared', 'data', 'uszips.csv');

// ════════════════════════════════════════════════════════
// QUOTE-AWARE CSV PARSER
// Handles newlines inside quoted fields (COMPANY_DESCRIPTION, EDUCATION_HISTORY)
// ════════════════════════════════════════════════════════

/**
 * @param {string} csvText
 * @returns {Record<string, string>[]}
 */
function parseCSV(csvText) {
  const records = [];
  let pos = 0;
  const len = csvText.length;

  function parseRecord() {
    const fields = [];
    let current = '';
    let inQuotes = false;
    while (pos < len) {
      const ch = csvText[pos];
      if (ch === '"') {
        if (inQuotes && pos + 1 < len && csvText[pos + 1] === '"') {
          // Escaped double-quote inside quoted field
          current += '"'; pos += 2;
        } else {
          inQuotes = !inQuotes; pos++;
        }
      } else if (ch === ',' && !inQuotes) {
        fields.push(current); current = ''; pos++;
      } else if ((ch === '\n' || ch === '\r') && !inQuotes) {
        fields.push(current);
        if (ch === '\r' && pos + 1 < len && csvText[pos + 1] === '\n') pos++;
        pos++;
        return fields;
      } else {
        current += ch; pos++;
      }
    }
    // End of file
    if (current || fields.length > 0) fields.push(current);
    return fields.length > 0 ? fields : null;
  }

  const headers = parseRecord();
  if (!headers) return [];

  while (pos < len) {
    // Skip bare newlines between records
    if (csvText[pos] === '\n' || csvText[pos] === '\r') { pos++; continue; }
    const values = parseRecord();
    if (!values || values.length === 0) continue;
    if (values.length !== headers.length) continue;
    const record = {};
    for (let j = 0; j < headers.length; j++) {
      record[headers[j]] = values[j] || '';
    }
    records.push(record);
  }
  return records;
}

// ════════════════════════════════════════════════════════
// USZIPS LOOKUP
// Map: ZIP (5-char string) → { lat, lng, county_fips }
// Parsed once and cached in module scope.
// ════════════════════════════════════════════════════════

/** @type {Map<string, { lat: number, lng: number, county_fips: string }> | null} */
let zipMap = null;

/**
 * Load uszips.csv into a ZIP→{lat,lng,county_fips} Map.
 * Uses a lightweight line-by-line parser (uszips.csv is well-formed, no embedded newlines).
 * @returns {Map<string, { lat: number, lng: number, county_fips: string }>}
 */
function loadZipLookup() {
  if (zipMap) return zipMap;

  zipMap = new Map();

  let text;
  try {
    text = fs.readFileSync(USZIPS_PATH, 'utf8');
  } catch (e) {
    console.warn(`[csv-to-dataset] uszips.csv not found at ${USZIPS_PATH} — geo fields will be empty`);
    return zipMap;
  }

  const lines = text.split('\n');
  if (lines.length < 2) return zipMap;

  // Parse header to find column indices
  const headerLine = lines[0];
  const headers = parseSimpleLine(headerLine);
  const iZip = headers.indexOf('zip');
  const iLat = headers.indexOf('lat');
  const iLng = headers.indexOf('lng');
  const iFips = headers.indexOf('county_fips');

  if (iZip === -1 || iLat === -1 || iLng === -1) {
    console.warn('[csv-to-dataset] uszips.csv missing expected columns (zip, lat, lng)');
    return zipMap;
  }

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const cols = parseSimpleLine(line);
    if (cols.length <= Math.max(iZip, iLat, iLng)) continue;

    const zip = cols[iZip].replace(/^"/, '').replace(/"$/, '').padStart(5, '0');
    const lat = parseFloat(cols[iLat].replace(/"/g, ''));
    const lng = parseFloat(cols[iLng].replace(/"/g, ''));
    const fips = iFips !== -1 ? cols[iFips].replace(/"/g, '') : '';

    if (zip && !isNaN(lat) && !isNaN(lng)) {
      zipMap.set(zip, { lat, lng, county_fips: fips });
    }
  }

  console.log(`[csv-to-dataset] uszips loaded: ${zipMap.size} ZIPs`);
  return zipMap;
}

/**
 * Simple CSV line parser — no embedded-newline support needed for uszips.csv.
 * Strips surrounding quotes from each field.
 * @param {string} line
 * @returns {string[]}
 */
function parseSimpleLine(line) {
  const fields = [];
  let current = '';
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQ && line[i + 1] === '"') { current += '"'; i++; }
      else { inQ = !inQ; }
    } else if (ch === ',' && !inQ) {
      fields.push(current); current = '';
    } else {
      current += ch;
    }
  }
  fields.push(current);
  return fields;
}

// ════════════════════════════════════════════════════════
// COLUMN MAPPING
// IntentCore columns → compact keys
// PERSONAL_* takes priority over SKIPTRACE_* for geo fields
// ════════════════════════════════════════════════════════

/**
 * Normalize a ZIP string: strip decimals, hyphens, pad to 5 digits.
 * Returns '' if result is not a valid 5-digit string.
 * @param {string} raw
 * @returns {string}
 */
function normalizeZip(raw) {
  if (!raw) return '';
  let z = raw.trim().split('.')[0].split('-')[0].trim().padStart(5, '0');
  if (z.length !== 5 || !/^\d{5}$/.test(z)) return '';
  return z;
}

/**
 * Convert an IntentCore CSV row to a compact map record.
 * @param {Record<string, string>} row
 * @param {string} intent
 * @param {Map<string, { lat: number, lng: number, county_fips: string }>} lookup
 * @returns {Record<string, unknown>}
 */
function rowToCompact(row, intent, lookup) {
  // --- ZIP: PERSONAL first, fallback SKIPTRACE ---
  const personalZip = normalizeZip(row.PERSONAL_ZIP || '');
  const skiptraceZip = normalizeZip(row.SKIPTRACE_ZIP || '');
  const z = personalZip || skiptraceZip;

  // --- STATE: PERSONAL first, fallback SKIPTRACE ---
  const personalState = (row.PERSONAL_STATE || '').trim().toUpperCase();
  const skiptraceState = (row.SKIPTRACE_STATE || '').trim().toUpperCase();
  const st = (personalState.length === 2 ? personalState : '') || (skiptraceState.length === 2 ? skiptraceState : '');

  // --- CITY: PERSONAL first, fallback SKIPTRACE ---
  const personalCity = (row.PERSONAL_CITY || '').trim();
  const skiptraceCity = (row.SKIPTRACE_CITY || '').trim();
  const city = personalCity || skiptraceCity;

  // --- Demographic fields ---
  const age = (row.AGE_RANGE || '').trim();

  let gender = (row.GENDER || '').trim().toUpperCase();
  if (gender !== 'M' && gender !== 'F') gender = 'U';

  const income = (row.INCOME_RANGE || '').trim();
  const nw = (row.NET_WORTH || '').trim();

  let cr = (row.SKIPTRACE_CREDIT_RATING || '').trim().toUpperCase();
  if (cr.length !== 1) cr = '';

  const lang = (row.SKIPTRACE_LANGUAGE_CODE || '').trim().toUpperCase();
  const sen = (row.SENIORITY_LEVEL || '').trim().toLowerCase();

  const married = (row.MARRIED || '').trim().toUpperCase();
  const children = (row.CHILDREN || '').trim().toUpperCase();
  const homeowner = (row.HOMEOWNER || '').trim().toUpperCase();

  const empCount = (row.COMPANY_EMPLOYEE_COUNT || '').trim();
  const compRev = (row.COMPANY_REVENUE || '').trim();

  // --- Geo backfill from uszips ---
  const geoEntry = z ? lookup.get(z) : undefined;
  const fips = geoEntry ? geoEntry.county_fips : '';
  const lat = geoEntry ? Math.round(geoEntry.lat * 10000) / 10000 : undefined;
  const lng = geoEntry ? Math.round(geoEntry.lng * 10000) / 10000 : undefined;

  // --- Build sparse record (only include non-empty fields) ---
  const rec = {};

  if (z) rec.z = z;
  if (st) rec.s = st;
  if (city) rec.c = city;
  if (age) rec.a = age;
  if (gender) rec.g = gender;
  if (income) rec.i = income;
  if (nw) rec.n = nw;
  if (cr) rec.r = cr;
  if (lang) rec.l = lang;
  if (sen) rec.e = sen;
  if (married === 'Y' || married === 'N') rec.m = married;
  if (children === 'Y' || children === 'N') rec.h = children;
  if (homeowner === 'Y' || homeowner === 'N') rec.o = homeowner;
  if (empCount) rec.ec = empCount;
  if (compRev) rec.cr2 = compRev;
  if (fips) rec.f = fips;
  if (lat !== undefined) rec.y = lat;
  if (lng !== undefined) rec.x = lng;

  // Intent tag always present
  rec.intent = intent;

  return rec;
}

// ════════════════════════════════════════════════════════
// PUBLIC API
// ════════════════════════════════════════════════════════

/**
 * Convert an IntentCore CSV file to an array of compact map records.
 *
 * @param {string} csvPath - Absolute or relative path to IntentCore CSV export
 * @param {'high'|'medium'|'low'} intent - Intent tier tag applied to every record
 * @returns {Record<string, unknown>[]} Array of compact records
 */
export function convertCsvToDataset(csvPath, intent) {
  const resolvedPath = path.resolve(csvPath);
  const csvText = fs.readFileSync(resolvedPath, 'utf8');
  const rows = parseCSV(csvText);
  const lookup = loadZipLookup();
  return rows.map(row => rowToCompact(row, intent, lookup));
}

/**
 * Merge multiple CompactRecord arrays and write to a JSON file.
 *
 * @param {Record<string, unknown>[][]} recordArrays - Arrays from convertCsvToDataset calls
 * @param {string} outputPath - File path to write merged JSON array
 */
export function mergeDatasets(recordArrays, outputPath) {
  const merged = recordArrays.flat();
  const resolvedOutput = path.resolve(outputPath);
  fs.mkdirSync(path.dirname(resolvedOutput), { recursive: true });
  fs.writeFileSync(resolvedOutput, JSON.stringify(merged), 'utf8');
  console.log(`[csv-to-dataset] Wrote ${merged.length} records to ${resolvedOutput}`);
}
