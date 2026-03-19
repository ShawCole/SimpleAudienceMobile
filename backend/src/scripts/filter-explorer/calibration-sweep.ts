/**
 * Calibration Sweep — Anchor-Based Filter Impact Measurement
 *
 * Strategy:
 *   1. Start with an anchor profile (escalation ladder of cumulative filters)
 *   2. Try each rung of the ladder until we get under 500k
 *   3. Once under 500k, sweep every other filter on top of the anchor and record retention ratios
 *
 * Output: NDJSON with { anchor, filter, anchorCount, combinedCount, retentionRatio }
 *
 * Usage:
 *   npx tsx src/scripts/filter-explorer/calibration-sweep.ts --profile healthcare
 *   npx tsx src/scripts/filter-explorer/calibration-sweep.ts --profile married-cxo --dry-run
 *   npx tsx src/scripts/filter-explorer/calibration-sweep.ts --profile middle-class-family
 *   npx tsx src/scripts/filter-explorer/calibration-sweep.ts --profile healthcare --targeted businessProfile.industry
 *   npx tsx src/scripts/filter-explorer/calibration-sweep.ts --profile healthcare --targeted-batch businessProfile.industry,businessProfile.sic
 *   npx tsx src/scripts/filter-explorer/calibration-sweep.ts --profile married-cxo --anchor-only
 *   npx tsx src/scripts/filter-explorer/calibration-sweep.ts --profile middle-class-family --variant inverted --dry-run
 *   npx tsx src/scripts/filter-explorer/calibration-sweep.ts --profile middle-class-family --variant inverted --sweep-anchor profile.incomeRange
 *
 * Profiles (each has a sampleOffset for rotating high-cardinality samples):
 *   healthcare          (offset 0) — NAICS 621111, resolves at 74,900
 *   married-cxo         (offset 1) — Married + CXO, escalate with NW/Credit/Age
 *   middle-class-family (offset 2) — Children + $75-99k income
 *   multicultural-urban (offset 3) — Female + Bachelor's + Spanish
 *   smb-b2b             (offset 4) — Sales + 1-10 employees + <$1M revenue
 *   consumer-elder      (offset 5) — Age 56-80 + credit card user
 *   tech-singles        (offset 6) — IT industry + Single
 *   business-probe      (offset 0) — Original: probe individual business filters
 */

import fs from 'fs';
import path from 'path';
import { FILTER_TAXONOMY } from '../../../../shared/taxonomy/filter-taxonomy';
import { buildPayload, type FilterSpec, type TestCase } from './payload-factory';
import { EXPLORER_CONFIG } from './config';

// ── Types ──────────────────────────────────────────────────────────────────

interface AnchorSpec {
  filters: FilterSpec[];
  label: string;
}

interface CalibrationResult {
  id: string;
  phase: 'anchor-probe' | 'calibration';
  anchorLabel: string;
  anchorFilters: FilterSpec[];
  testFilter: FilterSpec | null;  // null for anchor-only probes
  testLabel: string;
  anchorCount: number;
  combinedCount: number;
  retentionRatio: number | null;  // combinedCount / anchorCount
  durationMs: number;
  timestamp: string;
  success: boolean;
  error?: string;
}

// ── Config ─────────────────────────────────────────────────────────────────

const API_BASE = process.env.API_BASE || 'http://localhost:8001/api';
const TEST_AUDIENCE_NAME = process.env.AUDIENCE_NAME || 'Filter Sweep Test';
const CAP_THRESHOLD = 500_000;  // At or above this = capped, need more anchors

// ── Anchor Profiles ────────────────────────────────────────────────────────
// Each profile is an escalation ladder: try rung 1 (cumulative filters),
// if still capped, try rung 2 (adds another filter), etc.
// Each rung is the FULL set of anchor filters at that level.

interface AnchorProfile {
  name: string;
  description: string;
  rungs: FilterSpec[][];  // Each rung is the complete set of filters to apply
  sampleOffset: number;   // Rotates high-cardinality sample window (0-6)
}

const ANCHOR_PROFILES: Record<string, AnchorProfile> = {
  'healthcare': {
    name: 'Healthcare (NAICS 621111)',
    description: 'Physician offices — known to resolve at 74,900',
    sampleOffset: 0,
    rungs: [
      // Rung 1: NAICS alone — resolves immediately
      [{ key: 'businessProfile.companyNaics', values: ['621111'] }],
    ],
  },

  'married-cxo': {
    name: 'Married CXOs',
    description: 'Married + CXO, escalate with NW $1M+, Homeowner, Credit 750+, then state',
    sampleOffset: 1,
    rungs: [
      // Rung 1: Married + CXO
      [
        { key: 'profile.married', values: ['Yes'] },
        { key: 'businessProfile.seniority', values: ['cxo'] },
      ],
      // Rung 2: + Net Worth $1M+
      [
        { key: 'profile.married', values: ['Yes'] },
        { key: 'businessProfile.seniority', values: ['cxo'] },
        { key: 'profile.netWorth', values: ['more than $1,000,000'] },
      ],
      // Rung 3: + Homeowner
      [
        { key: 'profile.married', values: ['Yes'] },
        { key: 'businessProfile.seniority', values: ['cxo'] },
        { key: 'profile.netWorth', values: ['more than $1,000,000'] },
        { key: 'profile.homeowner', values: ['Homeowner'] },
      ],
      // Rung 4: + Credit Rating 750-799
      [
        { key: 'profile.married', values: ['Yes'] },
        { key: 'businessProfile.seniority', values: ['cxo'] },
        { key: 'profile.netWorth', values: ['more than $1,000,000'] },
        { key: 'profile.homeowner', values: ['Homeowner'] },
        { key: 'attributes.credit_rating', values: ['750 - 799'] },
      ],
      // Rung 5: + Age 36-55
      [
        { key: 'profile.married', values: ['Yes'] },
        { key: 'businessProfile.seniority', values: ['cxo'] },
        { key: 'profile.netWorth', values: ['more than $1,000,000'] },
        { key: 'profile.homeowner', values: ['Homeowner'] },
        { key: 'attributes.credit_rating', values: ['750 - 799'] },
        { key: 'age', values: ['36-55'], range: { min: 36, max: 55 } },
      ],
      // Rung 6: + Bachelor's education
      [
        { key: 'profile.married', values: ['Yes'] },
        { key: 'businessProfile.seniority', values: ['cxo'] },
        { key: 'profile.netWorth', values: ['more than $1,000,000'] },
        { key: 'profile.homeowner', values: ['Homeowner'] },
        { key: 'attributes.credit_rating', values: ['750 - 799'] },
        { key: 'age', values: ['36-55'], range: { min: 36, max: 55 } },
        { key: 'attributes.education', values: ["Bachelor's"] },
      ],
      // Rung 7: + Has children
      [
        { key: 'profile.married', values: ['Yes'] },
        { key: 'businessProfile.seniority', values: ['cxo'] },
        { key: 'profile.netWorth', values: ['more than $1,000,000'] },
        { key: 'profile.homeowner', values: ['Homeowner'] },
        { key: 'attributes.credit_rating', values: ['750 - 799'] },
        { key: 'age', values: ['36-55'], range: { min: 36, max: 55 } },
        { key: 'attributes.education', values: ["Bachelor's"] },
        { key: 'profile.children', values: ['Has children'] },
      ],
    ],
  },

  'business-probe': {
    name: 'Business Filter Probe',
    description: 'Original: probe individual business filters, escalate to pairs/triples',
    sampleOffset: 0,
    rungs: [
      [{ key: 'businessProfile.seniority', values: ['cxo'] }],
      [{ key: 'businessProfile.seniority', values: ['vp'] }],
      [{ key: 'businessProfile.seniority', values: ['director'] }],
      [{ key: 'businessProfile.department', values: ['engineering'] }],
      [{ key: 'businessProfile.department', values: ['finance'] }],
      [{ key: 'businessProfile.department', values: ['sales'] }],
      [{ key: 'businessProfile.employeeCount', values: ['1 to 10'] }],
      [{ key: 'businessProfile.employeeCount', values: ['51 to 100'] }],
      [{ key: 'businessProfile.companyRevenue', values: ['$1M to $10M'] }],
      [{ key: 'businessProfile.industry', values: ['Information Technology & Services'] }],
      [{ key: 'businessProfile.companyNaics', values: ['621111'] }],
    ],
  },

  'middle-class-family': {
    name: 'Middle-Class Family',
    description: 'Has children + $75-99k income, escalate with age 36-55, single-family, married',
    sampleOffset: 2,
    rungs: [
      // Rung 1: Children + Income
      [
        { key: 'profile.children', values: ['Has children'] },
        { key: 'profile.incomeRange', values: ['$75,000 to $99,999'] },
      ],
      // Rung 2: + Age 36-55
      [
        { key: 'profile.children', values: ['Has children'] },
        { key: 'profile.incomeRange', values: ['$75,000 to $99,999'] },
        { key: 'age', values: ['36-55'], range: { min: 36, max: 55 } },
      ],
      // Rung 3: + Single-Family dwelling
      [
        { key: 'profile.children', values: ['Has children'] },
        { key: 'profile.incomeRange', values: ['$75,000 to $99,999'] },
        { key: 'age', values: ['36-55'], range: { min: 36, max: 55 } },
        { key: 'attributes.dwelling_type', values: ['Single-Family'] },
      ],
      // Rung 4: + Married
      [
        { key: 'profile.children', values: ['Has children'] },
        { key: 'profile.incomeRange', values: ['$75,000 to $99,999'] },
        { key: 'age', values: ['36-55'], range: { min: 36, max: 55 } },
        { key: 'attributes.dwelling_type', values: ['Single-Family'] },
        { key: 'attributes.marital_status', values: ['Married'] },
      ],
      // Rung 5: + Homeowner
      [
        { key: 'profile.children', values: ['Has children'] },
        { key: 'profile.incomeRange', values: ['$75,000 to $99,999'] },
        { key: 'age', values: ['36-55'], range: { min: 36, max: 55 } },
        { key: 'attributes.dwelling_type', values: ['Single-Family'] },
        { key: 'attributes.marital_status', values: ['Married'] },
        { key: 'profile.homeowner', values: ['Homeowner'] },
      ],
      // Rung 6: + Credit card user
      [
        { key: 'profile.children', values: ['Has children'] },
        { key: 'profile.incomeRange', values: ['$75,000 to $99,999'] },
        { key: 'age', values: ['36-55'], range: { min: 36, max: 55 } },
        { key: 'attributes.dwelling_type', values: ['Single-Family'] },
        { key: 'attributes.marital_status', values: ['Married'] },
        { key: 'profile.homeowner', values: ['Homeowner'] },
        { key: 'attributes.credit_card_user', values: ['Yes'] },
      ],
    ],
  },

  'multicultural-urban': {
    name: 'Multicultural Urban',
    description: "Female + Bachelor's, escalate with Spanish, home value $100-149k, 1 gen household",
    sampleOffset: 3,
    rungs: [
      // Rung 1: Female + Bachelor's
      [
        { key: 'gender', values: ['Female'] },
        { key: 'attributes.education', values: ["Bachelor's"] },
      ],
      // Rung 2: + Spanish language
      [
        { key: 'gender', values: ['Female'] },
        { key: 'attributes.education', values: ["Bachelor's"] },
        { key: 'attributes.language_code', values: ['S8: Spanish'] },
      ],
      // Rung 3: + Home value $100-149k
      [
        { key: 'gender', values: ['Female'] },
        { key: 'attributes.education', values: ["Bachelor's"] },
        { key: 'attributes.language_code', values: ['S8: Spanish'] },
        { key: 'attributes.estimated_home_value', values: ['$100,000 - $124,999'] },
      ],
      // Rung 4: + 1 generation in household
      [
        { key: 'gender', values: ['Female'] },
        { key: 'attributes.education', values: ["Bachelor's"] },
        { key: 'attributes.language_code', values: ['S8: Spanish'] },
        { key: 'attributes.estimated_home_value', values: ['$100,000 - $124,999'] },
        { key: 'attributes.generations_in_household', values: ['1'] },
      ],
    ],
  },

  'smb-b2b': {
    name: 'SMB B2B',
    description: 'Sales dept + 1-10 employees, escalate with revenue <$1M, CRA High Income, credit card user',
    sampleOffset: 4,
    rungs: [
      // Rung 1: Sales + Small company
      [
        { key: 'businessProfile.department', values: ['sales'] },
        { key: 'businessProfile.employeeCount', values: ['1 to 10'] },
      ],
      // Rung 2: + Revenue under $1M
      [
        { key: 'businessProfile.department', values: ['sales'] },
        { key: 'businessProfile.employeeCount', values: ['1 to 10'] },
        { key: 'businessProfile.companyRevenue', values: ['Under 1 Million'] },
      ],
      // Rung 3: + CRA Code A
      [
        { key: 'businessProfile.department', values: ['sales'] },
        { key: 'businessProfile.employeeCount', values: ['1 to 10'] },
        { key: 'businessProfile.companyRevenue', values: ['Under 1 Million'] },
        { key: 'attributes.cra_code', values: ['High Income'] },
      ],
      // Rung 4: + Credit card user
      [
        { key: 'businessProfile.department', values: ['sales'] },
        { key: 'businessProfile.employeeCount', values: ['1 to 10'] },
        { key: 'businessProfile.companyRevenue', values: ['Under 1 Million'] },
        { key: 'attributes.cra_code', values: ['High Income'] },
        { key: 'attributes.credit_card_user', values: ['Yes'] },
      ],
    ],
  },

  'consumer-elder': {
    name: 'Consumer Elder',
    description: 'Age 56-80 + NW $250-499k, escalate with homeowner, married, credit 700-749, Bachelor\'s',
    sampleOffset: 5,
    rungs: [
      // Rung 1: Age 56-80 + Net worth $250-499k (strong wealth filter for discrimination)
      [
        { key: 'age', values: ['56-80'], range: { min: 56, max: 80 } },
        { key: 'profile.netWorth', values: ['$250,000 to $374,999'] },
      ],
      // Rung 2: + Homeowner
      [
        { key: 'age', values: ['56-80'], range: { min: 56, max: 80 } },
        { key: 'profile.netWorth', values: ['$250,000 to $374,999'] },
        { key: 'profile.homeowner', values: ['Homeowner'] },
      ],
      // Rung 3: + Married
      [
        { key: 'age', values: ['56-80'], range: { min: 56, max: 80 } },
        { key: 'profile.netWorth', values: ['$250,000 to $374,999'] },
        { key: 'profile.homeowner', values: ['Homeowner'] },
        { key: 'attributes.marital_status', values: ['Married'] },
      ],
      // Rung 4: + Credit rating 700-749
      [
        { key: 'age', values: ['56-80'], range: { min: 56, max: 80 } },
        { key: 'profile.netWorth', values: ['$250,000 to $374,999'] },
        { key: 'profile.homeowner', values: ['Homeowner'] },
        { key: 'attributes.marital_status', values: ['Married'] },
        { key: 'attributes.credit_rating', values: ['700 - 749'] },
      ],
      // Rung 5: + Bachelor's education
      [
        { key: 'age', values: ['56-80'], range: { min: 56, max: 80 } },
        { key: 'profile.netWorth', values: ['$250,000 to $374,999'] },
        { key: 'profile.homeowner', values: ['Homeowner'] },
        { key: 'attributes.marital_status', values: ['Married'] },
        { key: 'attributes.credit_rating', values: ['700 - 749'] },
        { key: 'attributes.education', values: ["Bachelor's"] },
      ],
    ],
  },

  'tech-singles': {
    name: 'Tech Singles',
    description: 'Tech industry + single, escalate with age 25-40, NW $100-249k, renter, male',
    sampleOffset: 6,
    rungs: [
      // Rung 1: Tech industry + Single
      [
        { key: 'businessProfile.industry', values: ['Technology, Information And Internet'] },
        { key: 'attributes.marital_status', values: ['Single'] },
      ],
      // Rung 2: + Age 25-40
      [
        { key: 'businessProfile.industry', values: ['Technology, Information And Internet'] },
        { key: 'attributes.marital_status', values: ['Single'] },
        { key: 'age', values: ['25-40'], range: { min: 25, max: 40 } },
      ],
      // Rung 3: + NW $100-249k (tech workers with savings, not yet wealthy)
      [
        { key: 'businessProfile.industry', values: ['Technology, Information And Internet'] },
        { key: 'attributes.marital_status', values: ['Single'] },
        { key: 'age', values: ['25-40'], range: { min: 25, max: 40 } },
        { key: 'profile.netWorth', values: ['$100,000 to $249,999'] },
      ],
      // Rung 4: + Renter (tech hub singles skew renter)
      [
        { key: 'businessProfile.industry', values: ['Technology, Information And Internet'] },
        { key: 'attributes.marital_status', values: ['Single'] },
        { key: 'age', values: ['25-40'], range: { min: 25, max: 40 } },
        { key: 'profile.netWorth', values: ['$100,000 to $249,999'] },
        { key: 'profile.homeowner', values: ['Renter'] },
      ],
      // Rung 5: + Male (IT skews heavily male)
      [
        { key: 'businessProfile.industry', values: ['Technology, Information And Internet'] },
        { key: 'attributes.marital_status', values: ['Single'] },
        { key: 'age', values: ['25-40'], range: { min: 25, max: 40 } },
        { key: 'profile.netWorth', values: ['$100,000 to $249,999'] },
        { key: 'profile.homeowner', values: ['Renter'] },
        { key: 'gender', values: ['Male'] },
      ],
    ],
  },
};

const DEFAULT_PROFILE = 'married-cxo';

// ── Inversion Map (for --variant inverted) ────────────────────────────────
// Maps filter key → { originalValue → invertedValue } for binary/near-binary filters.
// Filters not in this map (NAICS, industry, department, employeeCount, companyRevenue,
// cra_code, netWorth, investment, language_code, estimated_home_value,
// generations_in_household, credit_range_new_credit) are kept unchanged.

const INVERSION_MAP: Record<string, Record<string, string>> = {
  'profile.children': { 'Has children': 'No children' },
  'profile.married': { 'Yes': 'No' },
  'attributes.marital_status': { 'Married': 'Single', 'Single': 'Married' },
  'gender': { 'Female': 'Male', 'Male': 'Female' },
  'attributes.smoker': { 'Non-Smoker': 'Smoker', 'Smoker': 'Non-Smoker' },
  'attributes.credit_card_user': { 'Yes': 'No', 'No': 'Yes' },
  'attributes.single_parent': { 'No': 'Yes', 'Yes': 'No' },
  'profile.homeowner': { 'Homeowner': 'Renter' },
  'attributes.education': { "Bachelor's": 'High School' },
  // Age ranges: flip young ↔ old
  'age': { '18-35': '56-80', '36-55': '18-35', '56-80': '18-35' },
};

// Age range inversions need range objects too
const AGE_RANGE_MAP: Record<string, { min: number; max: number }> = {
  '18-35': { min: 18, max: 35 },
  '36-55': { min: 36, max: 55 },
  '56-80': { min: 56, max: 80 },
};

function invertRungs(rungs: FilterSpec[][]): FilterSpec[][] {
  return rungs.map(rung =>
    rung.map(filter => {
      const inversions = INVERSION_MAP[filter.key];
      if (!inversions) return filter; // no inversion available — keep as-is

      const originalValue = filter.values[0];
      const invertedValue = inversions[originalValue];
      if (!invertedValue) return filter; // specific value not mapped — keep as-is

      const inverted: FilterSpec = { key: filter.key, values: [invertedValue] };
      // Handle age range objects
      if (filter.key === 'age' && AGE_RANGE_MAP[invertedValue]) {
        inverted.range = AGE_RANGE_MAP[invertedValue];
      }
      return inverted;
    })
  );
}

// Taxonomy key mapping — shared between buildSweepFilters and buildTargetedFilters
const TAXONOMY_TO_KEY: Record<string, Record<string, string>> = {
  Business: {
    Seniority: 'businessProfile.seniority',
    Departments: 'businessProfile.department',
    Industries: 'businessProfile.industry',
    'Employee Count': 'businessProfile.employeeCount',
    'Estimated Company Revenue': 'businessProfile.companyRevenue',
    'SIC Codes': 'businessProfile.sic',
    'NAICS Codes': 'businessProfile.companyNaics',
  },
  Financial: {
    'Income Range': 'profile.incomeRange',
    'Net Worth': 'profile.netWorth',
    'Credit Rating': 'attributes.credit_rating',
    'New Credit Range': 'attributes.credit_range_new_credit',
    'Credit Card User': 'attributes.credit_card_user',
    Investment: 'attributes.investment',
    'CRA Code': 'attributes.cra_code',
    'Occupation Group': 'attributes.occupation_group',
    'Occupation Type': 'attributes.occupation_type',
  },
  Personal: {
    Gender: 'gender',
    Ethnicity: 'attributes.ethnic_code',
    Language: 'attributes.language_code',
    Education: 'attributes.education',
    Smoker: 'attributes.smoker',
  },
  Family: {
    Married: 'profile.married',
    'Marital Status': 'attributes.marital_status',
    'Single Parent': 'attributes.single_parent',
    'Generations in Household': 'attributes.generations_in_household',
    Children: 'profile.children',
  },
  Housing: {
    'Homeowner Status': 'profile.homeowner',
    'Dwelling Type': 'attributes.dwelling_type',
    'Estimated Home Value': 'attributes.estimated_home_value',
  },
};

// Reverse lookup: filterKey → { category, filterName } for targeted sweeps
function findTaxonomyEntry(filterKey: string): { category: string; filterName: string } | null {
  for (const [category, keyMap] of Object.entries(TAXONOMY_TO_KEY)) {
    for (const [filterName, key] of Object.entries(keyMap)) {
      if (key === filterKey) return { category, filterName };
    }
  }
  return null;
}

// All filters to sweep once we have a working anchor.
// Built dynamically from taxonomy + range filters + contact toggles.
// sampleOffset rotates the window for high-cardinality filters.
function buildSweepFilters(sampleOffset: number = 0): FilterSpec[] {
  const filters: FilterSpec[] = [];
  const taxonomy = FILTER_TAXONOMY as unknown as Record<string, Record<string, { type: string; options?: Array<{ label: string }> }>>;

  const LARGE_THRESHOLD = 20;
  const SAMPLE_LIMIT = 5;

  for (const [category, catFilters] of Object.entries(taxonomy)) {
    if (category === 'Contact') continue;
    const keyMap = TAXONOMY_TO_KEY[category];
    if (!keyMap) continue;

    for (const [filterName, def] of Object.entries(catFilters)) {
      const filterKey = keyMap[filterName];
      if (!filterKey || !def.options) continue;

      const isLarge = def.options.length > LARGE_THRESHOLD;
      let options: Array<{ label: string }>;
      if (isLarge) {
        // Rotate window: offset wraps around the options array
        const start = (sampleOffset * SAMPLE_LIMIT) % def.options.length;
        options = [];
        for (let i = 0; i < SAMPLE_LIMIT; i++) {
          options.push(def.options[(start + i) % def.options.length]);
        }
      } else {
        options = def.options;
      }

      for (const opt of options) {
        filters.push({ key: filterKey, values: [opt.label] });
      }
    }
  }

  // Range filters
  const ranges: Array<{ key: string; ranges: Array<{ label: string; min: number | null; max: number | null }> }> = [
    { key: 'age', ranges: [{ label: '18-35', min: 18, max: 35 }, { label: '36-55', min: 36, max: 55 }, { label: '56-80', min: 56, max: 80 }] },
    { key: 'attributes.home_year_built', ranges: [{ label: '1950-1980', min: 1950, max: 1980 }, { label: '2000-2025', min: 2000, max: 2025 }] },
  ];
  for (const r of ranges) {
    for (const range of r.ranges) {
      filters.push({ key: r.key, values: [range.label], range: { min: range.min, max: range.max } });
    }
  }

  // Contact toggles
  const contactKeys: Record<string, string> = {
    'Verified Personal Emails': 'contact.verifiedPersonalEmails',
    'Verified Business Emails': 'contact.verifiedBusinessEmails',
    'Valid Phones': 'contact.validPhones',
    'Skip Traced Wireless': 'contact.skipTracedWireless',
    'Skip Traced Wireless B2B': 'contact.skipTracedWirelessB2B',
  };
  for (const [name, key] of Object.entries(contactKeys)) {
    filters.push({ key, values: ['on'] });
  }

  return filters;
}

/**
 * Build a targeted filter list: ALL values for a single high-cardinality filter key.
 * Used with --targeted mode to get full coverage of one taxonomy dimension.
 */
function buildTargetedFilters(filterKey: string): FilterSpec[] {
  const entry = findTaxonomyEntry(filterKey);
  if (!entry) {
    throw new Error(`Unknown filter key: "${filterKey}". Not found in TAXONOMY_TO_KEY. Available keys:\n${
      Object.values(TAXONOMY_TO_KEY).flatMap(m => Object.values(m)).sort().join('\n  ')
    }`);
  }

  const taxonomy = FILTER_TAXONOMY as unknown as Record<string, Record<string, { type: string; options?: Array<{ label: string }> }>>;
  const def = taxonomy[entry.category]?.[entry.filterName];
  if (!def?.options || def.options.length === 0) {
    throw new Error(`Filter "${entry.filterName}" in category "${entry.category}" has no options`);
  }

  const filters: FilterSpec[] = [];
  for (const opt of def.options) {
    filters.push({ key: filterKey, values: [opt.label] });
  }

  console.log(`[targeted] Built ${filters.length} filters for ${filterKey} (${entry.category} → ${entry.filterName})`);
  return filters;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function randomDelay(): number {
  return Math.floor(Math.random() * (EXPLORER_CONFIG.delay.max - EXPLORER_CONFIG.delay.min + 1)) + EXPLORER_CONFIG.delay.min;
}

async function api(path: string, body?: any): Promise<any> {
  const url = `${API_BASE}${path}`;
  const res = await fetch(url, {
    method: body ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`API ${path} returned ${res.status}: ${text.substring(0, 300)}`);
  }
  return res.json();
}

function filterLabel(spec: FilterSpec): string {
  if (spec.range) return `${spec.key}=[${spec.range.min}-${spec.range.max}]`;
  return `${spec.key}=${spec.values.join('+')}`;
}

function anchorLabel(filters: FilterSpec[]): string {
  return filters.map(filterLabel).join(' & ');
}

// ── Checkpoint (calibration-specific) ──────────────────────────────────────

interface CalibrationCheckpoint {
  startedAt: string;
  resultFile: string;
  completedIds: string[];
  resolvedAnchor: AnchorSpec | null;
  anchorCount: number;
}

class CalibrationCheckpointManager {
  private checkpointPath: string;
  private resultPath: string;
  private completedIds: Set<string>;
  private startedAt: string;
  resolvedAnchor: AnchorSpec | null;
  anchorCount: number;

  constructor(profileName?: string) {
    const dir = path.join(EXPLORER_CONFIG.dataDir, 'calibration');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    const cpFile = profileName ? `checkpoint-${profileName}.json` : 'checkpoint.json';
    this.checkpointPath = path.join(dir, cpFile);

    if (fs.existsSync(this.checkpointPath)) {
      const data: CalibrationCheckpoint = JSON.parse(fs.readFileSync(this.checkpointPath, 'utf-8'));
      this.resultPath = data.resultFile;
      this.completedIds = new Set(data.completedIds);
      this.startedAt = data.startedAt;
      this.resolvedAnchor = data.resolvedAnchor;
      this.anchorCount = data.anchorCount;
      console.log(`[checkpoint] Resuming: ${this.completedIds.size} tests completed, anchor: ${data.resolvedAnchor?.label || 'not yet resolved'}`);
    } else {
      const ts = new Date().toISOString().replace(/[:.]/g, '-');
      const prefix = profileName ? `calibration-${profileName}` : 'calibration';
      this.resultPath = path.join(dir, `${prefix}-${ts}.ndjson`);
      this.completedIds = new Set();
      this.startedAt = new Date().toISOString();
      this.resolvedAnchor = null;
      this.anchorCount = 0;
    }
  }

  isCompleted(id: string): boolean { return this.completedIds.has(id); }
  getCompletedCount(): number { return this.completedIds.size; }
  getResultPath(): string { return this.resultPath; }

  record(result: CalibrationResult): void {
    fs.appendFileSync(this.resultPath, JSON.stringify(result) + '\n');
    this.completedIds.add(result.id);
    this.save();
  }

  setAnchor(anchor: AnchorSpec, count: number): void {
    this.resolvedAnchor = anchor;
    this.anchorCount = count;
    this.save();
  }

  private save(): void {
    const data: CalibrationCheckpoint = {
      startedAt: this.startedAt,
      resultFile: this.resultPath,
      completedIds: Array.from(this.completedIds),
      resolvedAnchor: this.resolvedAnchor,
      anchorCount: this.anchorCount,
    };
    fs.writeFileSync(this.checkpointPath, JSON.stringify(data, null, 2));
  }

  finalize(): void {
    if (fs.existsSync(this.checkpointPath)) fs.unlinkSync(this.checkpointPath);
    console.log(`[checkpoint] Run complete. Results: ${this.resultPath}`);
  }
}

// ── Core Logic ─────────────────────────────────────────────────────────────

async function previewWithFilters(filters: FilterSpec[], audienceId: string): Promise<{ success: boolean; count: number; raw?: string }> {
  const testCase: TestCase = {
    id: 'probe',
    phase: 'baseline',
    label: 'probe',
    filters,
  };
  const payload = buildPayload(testCase, audienceId);
  const result = await api('/audiences/preview', payload);
  return {
    success: !!result.success,
    count: result.data?.count ?? result.count ?? 0,
    raw: result.raw?.substring(0, 500),
  };
}

/**
 * Phase 1: Find a working anchor by climbing the profile's escalation ladder.
 * Each rung adds more filters. Stops at the first rung that gets under 500k.
 */
async function resolveAnchor(
  profile: AnchorProfile,
  audienceId: string,
  checkpoint: CalibrationCheckpointManager,
  dryRun: boolean
): Promise<{ anchor: AnchorSpec; count: number }> {

  // If checkpoint already has a resolved anchor, use it
  if (checkpoint.resolvedAnchor && checkpoint.anchorCount > 0 && checkpoint.anchorCount < CAP_THRESHOLD) {
    console.log(`[anchor] Resuming with saved anchor: ${checkpoint.resolvedAnchor.label} → ${checkpoint.anchorCount.toLocaleString()}`);
    return { anchor: checkpoint.resolvedAnchor, count: checkpoint.anchorCount };
  }

  console.log('\n══════════════════════════════════════════════════');
  console.log('  PHASE 1: ANCHOR RESOLUTION');
  console.log(`  Profile: ${profile.name}`);
  console.log(`  ${profile.description}`);
  console.log(`  Escalation rungs: ${profile.rungs.length}`);
  console.log('══════════════════════════════════════════════════\n');

  for (let i = 0; i < profile.rungs.length; i++) {
    const rungFilters = profile.rungs[i];
    const rungLabel = anchorLabel(rungFilters);
    const probeId = `anchor-probe:rung${i + 1}:${rungLabel}`;

    if (checkpoint.isCompleted(probeId)) {
      console.log(`  ⊘ Rung ${i + 1}/${profile.rungs.length}: ${rungLabel} — already probed, skipping`);
      continue;
    }

    if (dryRun) {
      console.log(`  ◇ Rung ${i + 1}/${profile.rungs.length}: ${rungLabel} — DRY RUN`);
      continue;
    }

    const start = Date.now();
    try {
      const result = await previewWithFilters(rungFilters, audienceId);
      const durationMs = Date.now() - start;

      checkpoint.record({
        id: probeId,
        phase: 'anchor-probe',
        anchorLabel: rungLabel,
        anchorFilters: rungFilters,
        testFilter: null,
        testLabel: `(rung ${i + 1}/${profile.rungs.length})`,
        anchorCount: 0,
        combinedCount: result.count,
        retentionRatio: null,
        durationMs,
        timestamp: new Date().toISOString(),
        success: result.success,
        error: result.success ? undefined : 'Non-success response',
      });

      if (result.count > 0 && result.count < CAP_THRESHOLD) {
        const anchor: AnchorSpec = { filters: rungFilters, label: rungLabel };
        checkpoint.setAnchor(anchor, result.count);
        console.log(`  ✓ Rung ${i + 1}: ${rungLabel} → ${result.count.toLocaleString()} ← ANCHOR RESOLVED`);
        return { anchor, count: result.count };
      }

      const icon = result.count >= CAP_THRESHOLD ? '▲' : (result.count === 0 ? '✗' : '?');
      console.log(`  ${icon} Rung ${i + 1}: ${rungLabel} → ${result.count.toLocaleString()} (${durationMs}ms)`);

      if (result.count >= CAP_THRESHOLD && i < profile.rungs.length - 1) {
        console.log(`    Still capped — escalating to rung ${i + 2}...`);
      }

    } catch (err: any) {
      const durationMs = Date.now() - start;
      checkpoint.record({
        id: probeId,
        phase: 'anchor-probe',
        anchorLabel: rungLabel,
        anchorFilters: rungFilters,
        testFilter: null,
        testLabel: `(rung ${i + 1}/${profile.rungs.length})`,
        anchorCount: 0,
        combinedCount: 0,
        retentionRatio: null,
        durationMs,
        timestamp: new Date().toISOString(),
        success: false,
        error: String(err.message || err),
      });
      console.error(`  ✗ Rung ${i + 1}: ${rungLabel} → ERROR: ${err.message}`);
    }

    await sleep(randomDelay());
  }

  if (dryRun) {
    const lastRung = profile.rungs[profile.rungs.length - 1];
    return { anchor: { filters: lastRung, label: 'DRY RUN: ' + anchorLabel(lastRung) }, count: 100000 };
  }

  throw new Error(`All ${profile.rungs.length} rungs exhausted for profile "${profile.name}". Could not get under ${CAP_THRESHOLD.toLocaleString()}. Add more rungs or try a different profile.`);
}

/**
 * Phase 2: Sweep filters on top of the resolved anchor.
 * For each filter, POST anchor + filter and record the combined count.
 * Accepts pre-built filter list (from buildSweepFilters or buildTargetedFilters).
 */
async function runCalibrationSweep(
  anchor: AnchorSpec,
  anchorCount: number,
  audienceId: string,
  checkpoint: CalibrationCheckpointManager,
  dryRun: boolean,
  sweepFilters: FilterSpec[]
): Promise<void> {

  // Skip filters that are part of the anchor itself (same key+value)
  const anchorKeys = new Set(anchor.filters.map(f => `${f.key}:${f.values.join('+')}`));
  const filteredSweep = sweepFilters.filter(f => !anchorKeys.has(`${f.key}:${f.values.join('+')}`));

  console.log('\n══════════════════════════════════════════════════');
  console.log('  PHASE 2: CALIBRATION SWEEP');
  console.log(`  Anchor: ${anchor.label}`);
  console.log(`  Anchor count: ${anchorCount.toLocaleString()}`);
  console.log(`  Filters to sweep: ${filteredSweep.length}`);
  console.log('══════════════════════════════════════════════════\n');

  if (dryRun) {
    console.log('DRY RUN — Test cases:\n');
    for (const f of filteredSweep) {
      console.log(`  anchor(${anchor.label}) + ${filterLabel(f)}`);
    }
    console.log(`\n  Total: ${filteredSweep.length} tests`);
    return;
  }

  let completed = 0;
  let consecutiveFailures = 0;
  const total = filteredSweep.length;

  for (const testFilter of filteredSweep) {
    const testId = `cal:${anchor.label}+${filterLabel(testFilter)}`;

    if (checkpoint.isCompleted(testId)) {
      completed++;
      continue;
    }

    const allFilters = [...anchor.filters, testFilter];
    const start = Date.now();

    try {
      const result = await previewWithFilters(allFilters, audienceId);
      const durationMs = Date.now() - start;
      const retention = anchorCount > 0 ? result.count / anchorCount : null;

      const calResult: CalibrationResult = {
        id: testId,
        phase: 'calibration',
        anchorLabel: anchor.label,
        anchorFilters: anchor.filters,
        testFilter,
        testLabel: filterLabel(testFilter),
        anchorCount,
        combinedCount: result.count,
        retentionRatio: retention,
        durationMs,
        timestamp: new Date().toISOString(),
        success: result.success,
      };
      checkpoint.record(calResult);
      consecutiveFailures = result.success ? 0 : consecutiveFailures + 1;
      completed++;

      const retStr = retention !== null ? `${(retention * 100).toFixed(1)}%` : 'N/A';
      const icon = result.success ? '✓' : '✗';
      console.log(`${icon} [${completed}/${total}] ${filterLabel(testFilter)} → ${result.count.toLocaleString()} (${retStr} retention, ${durationMs}ms)`);

    } catch (err: any) {
      const durationMs = Date.now() - start;
      consecutiveFailures++;
      completed++;

      checkpoint.record({
        id: testId,
        phase: 'calibration',
        anchorLabel: anchor.label,
        anchorFilters: anchor.filters,
        testFilter,
        testLabel: filterLabel(testFilter),
        anchorCount,
        combinedCount: 0,
        retentionRatio: null,
        durationMs,
        timestamp: new Date().toISOString(),
        success: false,
        error: String(err.message || err),
      });
      console.error(`✗ [${completed}/${total}] ${filterLabel(testFilter)} → ERROR: ${err.message}`);
    }

    // Circuit breaker
    if (consecutiveFailures >= EXPLORER_CONFIG.maxConsecutiveFailures) {
      console.error(`\n[sweep] ${consecutiveFailures} consecutive failures — cooling down ${EXPLORER_CONFIG.cooldownMs / 1000}s\n`);
      await sleep(EXPLORER_CONFIG.cooldownMs);
      consecutiveFailures = 0;
    }

    await sleep(randomDelay());
  }
}

// ── Analysis ───────────────────────────────────────────────────────────────

function analyzeCalibration(resultsPath: string): void {
  if (!fs.existsSync(resultsPath)) {
    console.log('[analysis] No results file found.');
    return;
  }

  const lines = fs.readFileSync(resultsPath, 'utf-8').trim().split('\n').filter(Boolean);
  const results: CalibrationResult[] = lines.map(l => JSON.parse(l));

  const calibrations = results.filter(r => r.phase === 'calibration' && r.success && r.retentionRatio !== null);
  if (calibrations.length === 0) {
    console.log('[analysis] No calibration results to analyze.');
    return;
  }

  // Sort by retention ratio (ascending = most restrictive filters first)
  const sorted = [...calibrations].sort((a, b) => (a.retentionRatio ?? 1) - (b.retentionRatio ?? 1));

  console.log('\n══════════════════════════════════════════════════');
  console.log('  CALIBRATION SWEEP RESULTS');
  console.log(`  Anchor: ${sorted[0].anchorLabel}`);
  console.log(`  Anchor count: ${sorted[0].anchorCount.toLocaleString()}`);
  console.log(`  Filters tested: ${calibrations.length}`);
  console.log('══════════════════════════════════════════════════\n');

  // Top 20 most restrictive (lowest retention)
  console.log('--- TOP 20 MOST RESTRICTIVE FILTERS (lowest retention) ---');
  for (const r of sorted.slice(0, 20)) {
    const ret = r.retentionRatio !== null ? `${(r.retentionRatio * 100).toFixed(1)}%` : 'N/A';
    console.log(`  ${ret.padStart(7)}  ${r.testLabel.padEnd(55)}  → ${r.combinedCount.toLocaleString()}`);
  }

  // Filters that had zero impact (retention ~100% = still at anchor count)
  const noImpact = sorted.filter(r => r.retentionRatio !== null && r.retentionRatio >= 0.99);
  if (noImpact.length > 0) {
    console.log(`\n--- NO-IMPACT FILTERS (${noImpact.length} filters with ≥99% retention) ---`);
    for (const r of noImpact.slice(0, 10)) {
      console.log(`  ${((r.retentionRatio ?? 0) * 100).toFixed(1)}%  ${r.testLabel}`);
    }
    if (noImpact.length > 10) console.log(`  ... and ${noImpact.length - 10} more`);
  }

  // Zero-count filters (broken or incompatible)
  const zeroes = results.filter(r => r.phase === 'calibration' && r.success && r.combinedCount === 0);
  if (zeroes.length > 0) {
    console.log(`\n--- ZERO-COUNT FILTERS (${zeroes.length} — likely broken) ---`);
    for (const r of zeroes) {
      console.log(`  ${r.testLabel}`);
    }
  }

  // Group by category
  console.log('\n--- RETENTION BY CATEGORY (median) ---');
  const byCategory: Record<string, number[]> = {};
  for (const r of calibrations) {
    if (r.retentionRatio === null) continue;
    const cat = r.testLabel.split('=')[0].split('.')[0].trim();
    if (!byCategory[cat]) byCategory[cat] = [];
    byCategory[cat].push(r.retentionRatio);
  }
  for (const [cat, ratios] of Object.entries(byCategory).sort((a, b) => median(a[1]) - median(b[1]))) {
    const med = median(ratios);
    console.log(`  ${(med * 100).toFixed(1)}%  ${cat} (${ratios.length} filters)`);
  }

  // Save summary JSON
  const summaryPath = resultsPath.replace('.ndjson', '-summary.json');
  const summary = {
    anchor: sorted[0]?.anchorLabel,
    anchorCount: sorted[0]?.anchorCount,
    totalFilters: calibrations.length,
    mostRestrictive: sorted.slice(0, 20).map(r => ({
      filter: r.testLabel,
      count: r.combinedCount,
      retention: r.retentionRatio,
    })),
    noImpact: noImpact.map(r => r.testLabel),
    zeroes: zeroes.map(r => r.testLabel),
  };
  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2));
  console.log(`\n[analysis] Summary saved: ${summaryPath}`);
}

function median(arr: number[]): number {
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

// ── Main ───────────────────────────────────────────────────────────────────

function parseArg(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  return idx >= 0 && args[idx + 1] ? args[idx + 1] : undefined;
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const anchorOnly = args.includes('--anchor-only');

  // Parse --profile <name>
  const profileName = parseArg(args, '--profile') || DEFAULT_PROFILE;
  const variant = parseArg(args, '--variant');
  const isInverted = variant === 'inverted';

  if (variant && variant !== 'inverted') {
    console.error(`Unknown variant: "${variant}". Available: inverted`);
    process.exit(1);
  }

  const baseProfile = ANCHOR_PROFILES[profileName];
  if (!baseProfile) {
    console.error(`Unknown profile: "${profileName}". Available: ${Object.keys(ANCHOR_PROFILES).join(', ')}`);
    process.exit(1);
  }

  // Apply inversion if requested
  const profile: AnchorProfile = isInverted
    ? { ...baseProfile, name: `${baseProfile.name} (INVERTED)`, rungs: invertRungs(baseProfile.rungs) }
    : baseProfile;

  // Parse --targeted <filterKey> and --targeted-batch <key1,key2,...>
  const targetedKey = parseArg(args, '--targeted');
  const targetedBatch = parseArg(args, '--targeted-batch');
  const targetedKeys: string[] = [];
  if (targetedKey) targetedKeys.push(targetedKey);
  if (targetedBatch) targetedKeys.push(...targetedBatch.split(',').map(k => k.trim()).filter(Boolean));

  // Parse --sweep-anchor <filterKey>
  const sweepAnchorKey = parseArg(args, '--sweep-anchor');

  const isTargeted = targetedKeys.length > 0;
  const isSweepAnchor = !!sweepAnchorKey;
  const modeLabel = isSweepAnchor ? 'ANCHOR SWEEP' : (isTargeted ? 'TARGETED SWEEP' : 'Anchor + Sweep');
  const variantLabel = isInverted ? ' (INVERTED)' : '';

  console.log('╔══════════════════════════════════════════════════╗');
  console.log(`║        CALIBRATION SWEEP — ${modeLabel.padEnd(22)}║`);
  console.log('║                                                  ║');
  console.log(`║  Profile: ${profile.name.padEnd(38)}║`);
  if (isInverted) {
    console.log(`║  Variant: INVERTED                               ║`);
  }
  if (isSweepAnchor) {
    console.log(`║  Sweep-anchor: ${sweepAnchorKey!.padEnd(33)}║`);
  }
  if (isTargeted) {
    console.log(`║  Targeted keys: ${targetedKeys.length.toString().padEnd(32)}║`);
    for (const k of targetedKeys) {
      console.log(`║    → ${k.padEnd(43)}║`);
    }
  }
  console.log('║  1. Escalate anchor until under 500k            ║');
  console.log('║  2. Sweep filters on top of anchor              ║');
  console.log('║  3. Record retention ratios                     ║');
  console.log('╚══════════════════════════════════════════════════╝\n');

  // Build checkpoint name with variant and targeted suffixes
  const variantSuffix = isInverted ? '-inverted' : '';
  const checkpointName = isTargeted
    ? `${profileName}${variantSuffix}-targeted-${targetedKeys.join('-').replace(/\./g, '_')}`
    : `${profileName}${variantSuffix}`;
  const checkpoint = new CalibrationCheckpointManager(checkpointName);

  if (!dryRun) {
    // Prewarm + init
    console.log('[main] Pre-warming VacuumEngine...');
    const prewarmResult = await api('/vacuum/prewarm', {});
    if (!prewarmResult.success) throw new Error('Prewarm failed: ' + JSON.stringify(prewarmResult));
    console.log('[main] Pre-warm complete.\n');

    console.log(`[main] Initializing audience: "${TEST_AUDIENCE_NAME}"...`);
    const initResult = await api('/vacuum/init', { name: TEST_AUDIENCE_NAME });
    if (!initResult.success) throw new Error('Init failed: ' + JSON.stringify(initResult));
    EXPLORER_CONFIG.accountId = initResult.accountId;
    EXPLORER_CONFIG.audienceId = initResult.audienceId;
    console.log(`[main] Audience ready — ${initResult.accountId} / ${initResult.audienceId}\n`);
  }

  const audienceId = EXPLORER_CONFIG.audienceId || 'dry-run-id';

  // Phase 1: Resolve anchor
  const { anchor, count: anchorCount } = await resolveAnchor(profile, audienceId, checkpoint, dryRun);
  console.log(`\n[main] Anchor resolved: ${anchor.label} → ${anchorCount.toLocaleString()}\n`);

  if (anchorOnly) {
    console.log('[main] --anchor-only flag set. Stopping after anchor resolution.');
    checkpoint.finalize();
    return;
  }

  // Phase 2: Calibration sweep (sweep-anchor, targeted, or normal)
  if (isSweepAnchor) {
    // Sweep-anchor mode: for each value of the specified filter key,
    // substitute it into the anchor and run a full sweep with a separate checkpoint.
    const allValues = buildTargetedFilters(sweepAnchorKey!);
    const sweepFilters = buildSweepFilters(profile.sampleOffset);

    // Check which filter in the anchor matches the sweep key
    const anchorMatchIdx = anchor.filters.findIndex(f => f.key === sweepAnchorKey);
    if (anchorMatchIdx === -1) {
      throw new Error(`--sweep-anchor key "${sweepAnchorKey}" not found in resolved anchor filters: ${anchor.filters.map(f => f.key).join(', ')}`);
    }
    const originalAnchorValue = anchor.filters[anchorMatchIdx].values[0];

    console.log(`\n[sweep-anchor] Sweeping ${allValues.length} values for ${sweepAnchorKey}`);
    console.log(`[sweep-anchor] Original anchor value: ${originalAnchorValue}`);
    console.log(`[sweep-anchor] Each iteration: re-anchor + ${sweepFilters.length} filter sweep\n`);

    // Finalize the top-level checkpoint (anchor resolution is done)
    checkpoint.finalize();

    for (let vi = 0; vi < allValues.length; vi++) {
      const sub = allValues[vi];
      const subLabel = filterLabel(sub);
      const subTag = sub.values[0].replace(/[^a-zA-Z0-9]/g, '_').substring(0, 40);

      console.log(`\n${'═'.repeat(60)}`);
      console.log(`  ANCHOR SWEEP [${vi + 1}/${allValues.length}]: ${subLabel}`);
      console.log(`${'═'.repeat(60)}\n`);

      // Skip if this is the same value already in the anchor
      if (sub.values[0] === originalAnchorValue) {
        console.log(`[sweep-anchor] Skipping — same as original anchor value\n`);
        continue;
      }

      // Build substituted anchor
      const subFilters = anchor.filters.map((f, i) => i === anchorMatchIdx ? sub : f);
      const subAnchor: AnchorSpec = { filters: subFilters, label: anchorLabel(subFilters) };

      // Each substitution gets its own checkpoint
      const subCheckpointName = `${profileName}${variantSuffix}-swanchor-${sweepAnchorKey!.replace(/\./g, '_')}-${subTag}`;
      const subCheckpoint = new CalibrationCheckpointManager(subCheckpointName);

      if (dryRun) {
        console.log(`[sweep-anchor] DRY RUN — anchor: ${subAnchor.label}`);
        console.log(`[sweep-anchor] Would sweep ${sweepFilters.length} filters\n`);
        continue;
      }

      // Probe the substituted anchor to get its count
      let subCount: number;
      const probeId = `anchor-probe:sweep-anchor:${subLabel}`;
      if (subCheckpoint.resolvedAnchor && subCheckpoint.anchorCount > 0) {
        subCount = subCheckpoint.anchorCount;
        console.log(`[sweep-anchor] Resuming with saved anchor count: ${subCount.toLocaleString()}`);
      } else if (subCheckpoint.isCompleted(probeId)) {
        console.log(`[sweep-anchor] Anchor probe already done, skipping`);
        continue;
      } else {
        const probeResult = await previewWithFilters(subFilters, audienceId);
        subCount = probeResult.count;

        subCheckpoint.record({
          id: probeId, phase: 'anchor-probe', anchorLabel: subAnchor.label,
          anchorFilters: subFilters, testFilter: null, testLabel: '(sweep-anchor probe)',
          anchorCount: 0, combinedCount: subCount, retentionRatio: null,
          durationMs: 0, timestamp: new Date().toISOString(),
          success: probeResult.success, error: probeResult.success ? undefined : 'Non-success',
        });

        if (subCount === 0 || subCount >= CAP_THRESHOLD) {
          console.log(`[sweep-anchor] ${subLabel} → ${subCount.toLocaleString()} (${subCount >= CAP_THRESHOLD ? 'CAPPED' : 'ZERO'}) — skipping sweep`);
          subCheckpoint.finalize();
          await sleep(randomDelay());
          continue;
        }

        subCheckpoint.setAnchor(subAnchor, subCount);
        console.log(`[sweep-anchor] ${subLabel} → ${subCount.toLocaleString()} ← sweeping`);
      }

      await runCalibrationSweep(subAnchor, subCount, audienceId, subCheckpoint, dryRun, sweepFilters);
      subCheckpoint.finalize();
      analyzeCalibration(subCheckpoint.getResultPath());

      await sleep(randomDelay());
    }

    console.log('\n[main] Anchor sweep complete.');
  } else if (isTargeted) {
    // Targeted mode: sweep ALL values for each specified filter key
    for (const filterKey of targetedKeys) {
      console.log(`\n[main] === Targeted sweep: ${filterKey} ===\n`);
      const targetedFilters = buildTargetedFilters(filterKey);
      await runCalibrationSweep(anchor, anchorCount, audienceId, checkpoint, dryRun, targetedFilters);
    }

    checkpoint.finalize();
    analyzeCalibration(checkpoint.getResultPath());
    console.log('\n[main] Calibration sweep complete.');
  } else {
    // Normal mode: sweep sampled filters using profile's sampleOffset
    const sweepFilters = buildSweepFilters(profile.sampleOffset);
    await runCalibrationSweep(anchor, anchorCount, audienceId, checkpoint, dryRun, sweepFilters);

    checkpoint.finalize();
    analyzeCalibration(checkpoint.getResultPath());
    console.log('\n[main] Calibration sweep complete.');
  }
}

main().catch(err => {
  console.error('[main] Fatal error:', err);
  process.exit(1);
});
