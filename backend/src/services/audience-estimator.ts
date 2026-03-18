/**
 * Audience Size Estimator v3.2 — Per-Anchor Retention with Age×Seniority Matching
 *
 * Architecture:
 *   1. Load probe grid (480 real measured counts) at module init
 *   2. Load all Layer 1 sweep ndjson files → per-anchor retention maps
 *   3. For user's demographic filters, find matching grid entries and sum
 *   4. Match user's seniority+age to closest L1 anchor(s)
 *   5. Apply that anchor's enrichment retention ratios (not global averages)
 *   6. Apply renter modifiers + stacking correction + state multiplier
 *   7. Warn when any single filter would devastate the audience
 *
 * Data sources:
 *   - Probe grid: 480 combos (Gender × Homeowner × Married × Children × Seniority × Age)
 *   - Layer 1 sweeps: auto-loaded from calibration/*.ndjson → per-anchor retention
 *   - Renter isolation: R/HO modifiers for Renter enrichment adjustment
 *   - State grid: 300 probes (50 states × 6 anchors)
 *   - Stacking correction: recalibrated for per-seniority tables
 */

import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import type { FilterSpec } from '../scripts/filter-explorer/payload-factory';

// ── Probe Grid ──────────────────────────────────────────────────────────────

interface GridEntry {
  gender: string;
  homeowner: string;
  married: string;
  seniority: string;
  children: string;
  age: string;
  count: number;
}

const GRID: GridEntry[] = [];

// Load probe grid at module init
const GRID_PATH = join(__dirname, '../../data/filter-explorer/calibration/probe-grid-full-2026-03-06T04-27-16-746Z.ndjson');
try {
  const lines = readFileSync(GRID_PATH, 'utf-8').split('\n').filter(l => l.trim());
  for (const line of lines) {
    const d = JSON.parse(line);
    if (!d.success || d.count == null) continue;
    const combo = d.combo;
    // Only use entries with age (the full 480)
    const ageFilter = d.filters?.find((f: any) => f.key === 'age');
    if (!ageFilter) continue;
    GRID.push({
      gender: combo.Gender,
      homeowner: combo.Homeowner,
      married: combo.Married,
      seniority: combo.Seniority.toLowerCase(),
      children: combo.Children,
      age: ageFilter.values[0],
      count: d.count,
    });
  }
} catch (err) {
  console.error(`[estimator] Failed to load probe grid from ${GRID_PATH}:`, err);
}

// Map age range to matching brackets
const AGE_BRACKETS = ['18-24', '25-34', '35-44', '45-54', '55-64', '65+'];

function ageBracketsForRange(range: { min: number | null; max: number | null }): string[] {
  if (range.min == null && range.max == null) return AGE_BRACKETS;
  const matches: string[] = [];
  for (const bracket of AGE_BRACKETS) {
    const [bMin, bMax] = bracket.replace('+', '-99').split('-').map(Number);
    const lo = range.min ?? 0;
    const hi = range.max ?? 99;
    if (bMax >= lo && bMin <= hi) matches.push(bracket);
  }
  return matches;
}

/**
 * Sum all probe grid entries matching the user's demographic selections.
 * Unselected dimensions → sum across all values for that dimension.
 */
function lookupGridBase(filters: FilterSpec[]): { count: number; capped: number; matched: number } {
  // Extract demographic selections from filters
  let genders: string[] | null = null;
  let homeowners: string[] | null = null;
  let marrieds: string[] | null = null;
  let seniorities: string[] | null = null;
  let childrenVals: string[] | null = null;
  let ages: string[] | null = null;

  for (const f of filters) {
    switch (f.key) {
      case 'profile.gender':
      case 'gender':
        genders = f.values;
        break;
      case 'profile.homeowner':
        homeowners = f.values;
        break;
      case 'profile.married':
        marrieds = f.values.map(v => v === 'Yes' ? 'Yes' : 'No');
        break;
      case 'businessProfile.seniority':
        seniorities = f.values.map(v => v.toLowerCase());
        break;
      case 'profile.children':
        childrenVals = f.values;
        break;
      case 'age':
        if (f.range) {
          ages = ageBracketsForRange(f.range);
        } else {
          ages = f.values;
        }
        break;
    }
  }

  let total = 0;
  let capped = 0;
  let matched = 0;

  for (const entry of GRID) {
    if (genders && !genders.includes(entry.gender)) continue;
    if (homeowners && !homeowners.includes(entry.homeowner)) continue;
    if (marrieds && !marrieds.includes(entry.married)) continue;
    if (seniorities && !seniorities.includes(entry.seniority)) continue;
    if (childrenVals && !childrenVals.includes(entry.children)) continue;
    if (ages && !ages.includes(entry.age)) continue;

    total += entry.count;
    matched++;
    if (entry.count >= 500_000) capped++;
  }

  return { count: total, capped, matched };
}

// ── Enrichment Retention — Dynamic L1 Anchor Loading ────────────────────────
// Loads all layer1-*.ndjson files from calibration/ at module init.
// Each anchor is keyed by homeowner|seniority|age for precise matching.
// When estimating, we find the closest anchor(s) to the user's demographics.

type RetentionTable = Record<string, number>;

// Enrichment filter keys we track per-anchor
const ENRICHMENT_FILTER_KEYS = new Set([
  'profile.incomeRange', 'attributes.credit_rating',
  'profile.netWorth', 'attributes.education',
]);

interface L1Anchor {
  homeowner: string;  // 'Homeowner' | 'Renter'
  seniority: string;  // 'staff' | 'manager' | 'vp' | 'cxo' | 'director'
  age: string;        // '18-24' | '25-34' | ... | '65+' | ''
  count: number;
  // filterKey → filterValue → retention ratio
  retention: Record<string, RetentionTable>;
}

const L1_ANCHORS: L1Anchor[] = [];

// Load all L1 sweep data at module init
const L1_DIR = join(__dirname, '../../data/filter-explorer/calibration');
try {
  const files = readdirSync(L1_DIR).filter(f => f.startsWith('layer1-') && f.endsWith('.ndjson'));
  for (const file of files) {
    const lines = readFileSync(join(L1_DIR, file), 'utf-8').trim().split('\n');
    if (lines.length === 0) continue;

    let anchor: L1Anchor | null = null;
    const retentionAccum: Record<string, Record<string, number[]>> = {};

    for (const line of lines) {
      const d = JSON.parse(line);
      if (!d.success || !d.anchorCombo) continue;

      // Initialize anchor from first entry
      if (!anchor) {
        const combo = d.anchorCombo;
        anchor = {
          homeowner: combo.Homeowner || '',
          seniority: (combo.Seniority || '').toLowerCase(),
          age: combo.Age || '',
          count: d.anchorCount || 0,
          retention: {},
        };
      }

      const testKey = d.testFilter?.key;
      if (!testKey || !ENRICHMENT_FILTER_KEYS.has(testKey)) continue;
      if (d.combinedCount <= 0 || d.retentionRatio == null || d.retentionRatio <= 0) continue;

      const testValue = d.testFilter.values?.[0];
      if (!testValue) continue;

      if (!retentionAccum[testKey]) retentionAccum[testKey] = {};
      if (!retentionAccum[testKey][testValue]) retentionAccum[testKey][testValue] = [];
      retentionAccum[testKey][testValue].push(d.retentionRatio);
    }

    if (anchor && Object.keys(retentionAccum).length > 0) {
      // Average multiple measurements per value (shouldn't happen, but safety)
      for (const [key, valueMap] of Object.entries(retentionAccum)) {
        anchor.retention[key] = {};
        for (const [val, ratios] of Object.entries(valueMap)) {
          anchor.retention[key][val] = ratios.reduce((a, b) => a + b, 0) / ratios.length;
        }
      }
      L1_ANCHORS.push(anchor);
    }
  }
  console.log(`[estimator] Loaded ${L1_ANCHORS.length} L1 anchors from ${files.length} files`);

  // Log coverage
  const senCounts: Record<string, number> = {};
  for (const a of L1_ANCHORS) {
    const key = `${a.homeowner}|${a.seniority}`;
    senCounts[key] = (senCounts[key] || 0) + 1;
  }
  for (const [k, n] of Object.entries(senCounts).sort()) {
    console.log(`[estimator]   ${k}: ${n} anchor(s)`);
  }
} catch (err) {
  console.error(`[estimator] Failed to load L1 data from ${L1_DIR}:`, err);
}

// Age bracket ordering for distance calculation
const AGE_BRACKET_ORDER: Record<string, number> = {
  '18-24': 0, '25-34': 1, '35-44': 2, '45-54': 3, '55-64': 4, '65+': 5,
};

/**
 * Find the best retention table for a filter key given user's demographics.
 *
 * Match priority:
 *   1. Exact seniority + exact age → use that anchor
 *   2. Exact seniority + adjacent age → weighted blend by age distance
 *   3. Exact seniority + any age → average across all ages for that seniority
 *   4. No seniority match → average across all Homeowner anchors (global fallback)
 *
 * Only matches Homeowner anchors (Renter retention handled via Renter modifiers).
 */
function getRetentionTable(
  filterKey: string,
  selectedSeniorities: string[] | null,
  selectedAges: string[] | null,
): { table: RetentionTable; matchedAnchor: string | null } {

  // Only use Homeowner L1 anchors (Renter retention = HO × renter modifier)
  const hoAnchors = L1_ANCHORS.filter(a => a.homeowner === 'Homeowner');
  if (hoAnchors.length === 0) {
    return { table: {}, matchedAnchor: null };
  }

  // Find anchors matching the user's seniority
  const seniorities = selectedSeniorities?.length ? selectedSeniorities : null;
  const matchingSen = seniorities
    ? hoAnchors.filter(a => seniorities.includes(a.seniority))
    : hoAnchors; // no seniority → use all

  if (matchingSen.length === 0) {
    // Seniority not in L1 data — fall back to all HO anchors
    return blendAnchors(hoAnchors, filterKey, null, `global(${hoAnchors.length})`);
  }

  // If user selected an age, try to match
  const userAge = selectedAges?.length === 1 ? selectedAges[0] : null;

  if (userAge && AGE_BRACKET_ORDER[userAge] != null) {
    // Exact age match?
    const exact = matchingSen.filter(a => a.age === userAge);
    if (exact.length > 0) {
      return blendAnchors(exact, filterKey, null, `${exact[0].seniority}@${userAge}`);
    }

    // No exact → distance-weighted blend across all matching seniority anchors
    const userOrd = AGE_BRACKET_ORDER[userAge];
    const weighted: Array<{ anchor: L1Anchor; weight: number }> = [];
    for (const a of matchingSen) {
      const aOrd = AGE_BRACKET_ORDER[a.age];
      if (aOrd == null) { weighted.push({ anchor: a, weight: 1 }); continue; }
      const dist = Math.abs(userOrd - aOrd);
      // Weight: 1/(1+dist) so exact=1.0, adjacent=0.5, 2-away=0.33, etc.
      weighted.push({ anchor: a, weight: 1 / (1 + dist) });
    }
    return blendAnchorsWeighted(weighted, filterKey,
      `${seniorities!.join('+')}~${userAge}(${weighted.length})`);
  }

  // No age or multiple ages → average across all matching seniority anchors
  return blendAnchors(matchingSen, filterKey, null,
    `${matchingSen[0].seniority}(${matchingSen.length})`);
}

/** Blend retention tables from multiple anchors (equal weight or by count) */
function blendAnchors(
  anchors: L1Anchor[], filterKey: string,
  _weights: null, label: string,
): { table: RetentionTable; matchedAnchor: string | null } {
  const weighted = anchors.map(a => ({ anchor: a, weight: a.count }));
  return blendAnchorsWeighted(weighted, filterKey, label);
}

/** Blend retention tables with explicit weights */
function blendAnchorsWeighted(
  items: Array<{ anchor: L1Anchor; weight: number }>,
  filterKey: string,
  label: string,
): { table: RetentionTable; matchedAnchor: string | null } {
  if (items.length === 0) return { table: {}, matchedAnchor: null };
  if (items.length === 1) {
    const table = items[0].anchor.retention[filterKey] ?? {};
    // Add space/spaceless credit aliases
    if (filterKey === 'attributes.credit_rating') {
      return { table: addCreditAliases(table), matchedAnchor: label };
    }
    return { table, matchedAnchor: label };
  }

  const blended: RetentionTable = {};
  const totalWeight = items.reduce((s, i) => s + i.weight, 0);
  if (totalWeight <= 0) return { table: {}, matchedAnchor: null };

  // Collect all values across anchors
  const allValues = new Set<string>();
  for (const { anchor } of items) {
    const t = anchor.retention[filterKey];
    if (t) for (const k of Object.keys(t)) allValues.add(k);
  }

  for (const val of allValues) {
    let wSum = 0, wUsed = 0;
    for (const { anchor, weight } of items) {
      const ret = anchor.retention[filterKey]?.[val];
      if (ret != null) { wSum += ret * weight; wUsed += weight; }
    }
    if (wUsed > 0) blended[val] = wSum / wUsed;
  }

  if (filterKey === 'attributes.credit_rating') {
    return { table: addCreditAliases(blended), matchedAnchor: label };
  }
  return { table: blended, matchedAnchor: label };
}

/** Credit rating values come as "750 - 799" from L1 but users may send "750-799" */
function addCreditAliases(table: RetentionTable): RetentionTable {
  const result = { ...table };
  for (const [k, v] of Object.entries(table)) {
    const noSpace = k.replace(/ /g, '');
    if (noSpace !== k && !(noSpace in result)) result[noSpace] = v;
    const withSpace = k.replace(/(\d)-(\d)/g, '$1 - $2');
    if (withSpace !== k && !(withSpace in result)) result[withSpace] = v;
  }
  return result;
}

const INDUSTRY_RETENTION: Record<string, number> = {
  'Financial Services': 0.0605,
  'Retail': 0.0399,
  'Insurance': 0.0255,
  'Banking': 0.0226,
  'Food And Beverage Services': 0.0180,
  'Automotive': 0.0176,
  'Advertising Services': 0.0163,
  'Telecommunications': 0.0161,
  'Non-Profit Organizations': 0.0159,
  'Primary And Secondary Education': 0.0156,
  'Machinery Manufacturing': 0.0154,
  'Restaurants': 0.0124,
  'Law Practice': 0.0118,
  'Mechanical Or Industrial Engineering': 0.0115,
  'Oil And Gas': 0.0114,
  'Transportation, Logistics, Supply Chain And Storage': 0.0104,
  'Medical Practices': 0.0099,
  'Entertainment Providers': 0.0093,
  'Appliances, Electrical, And Electronics Manufacturing': 0.0090,
  'Defense And Space Manufacturing': 0.0089,
  'Research': 0.0085,
  'Utilities': 0.0074,
  'Education Administration Programs': 0.0074,
  'Consumer Services': 0.0070,
  'Pharmaceutical Manufacturing': 0.0066,
  'Armed Forces': 0.0063,
  'Accounting': 0.0062,
  'Individual And Family Services': 0.0062,
  'Wholesale': 0.0059,
  'Aviation And Aerospace Component Manufacturing': 0.0055,
  'Environmental Services': 0.0054,
  'Logistics And Supply Chain': 0.0053,
  'Civil Engineering': 0.0052,
  'Professional Training And Coaching': 0.0052,
  'Design Services': 0.0050,
  'Religious Institutions': 0.0049,
  'Airlines And Aviation': 0.0047,
  'Architecture And Planning': 0.0046,
  'Book And Periodical Publishing': 0.0046,
  'Facilities Services': 0.0045,
  'Semiconductor Manufacturing': 0.0041,
  'Sports': 0.0040,
  'Mental Health Care': 0.0039,
  'Legal Services': 0.0036,
  'Investment Management': 0.0034,
  'Human Resources Services': 0.0033,
  'Printing Services': 0.0030,
  'Public Relations And Communications Services': 0.0029,
  'Events Services': 0.0028,
  'Furniture And Home Furnishings Manufacturing': 0.0028,
  'Civic And Social Organizations': 0.0027,
  'Law Enforcement': 0.0022,
  'Venture Capital And Private Equity Principals': 0.0020,
  'Farming': 0.0020,
  'Public Safety': 0.0019,
  'Computer Hardware Manufacturing': 0.0019,
  'Online Audio And Video Media': 0.0018,
  'Plastics Manufacturing': 0.0017,
  'E-Learning Providers': 0.0017,
  'Computer And Network Security': 0.0016,
  'Freight And Package Transportation': 0.0015,
  'Recreational Facilities': 0.0015,
  'Gambling Facilities And Casinos': 0.0015,
  'Fundraising': 0.0014,
  'Consumer Goods': 0.0013,
  'Photography': 0.0013,
  'Maritime Transportation': 0.0013,
  'Paper And Forest Product Manufacturing': 0.0013,
  'Writing And Editing': 0.0012,
  'Biotechnology Research': 0.0012,
  'Veterinary Services': 0.0012,
  'Sporting Goods Manufacturing': 0.0012,
  'Textile Manufacturing': 0.0011,
  'Outsourcing And Offshoring Consulting': 0.0011,
  'Libraries': 0.0009,
  'Warehousing And Storage': 0.0009,
  'International Trade And Development': 0.0009,
  'Market Research': 0.0009,
  'Investment Banking': 0.0009,
  'International Affairs': 0.0009,
  'Internet': 0.0008,
  'Computer Networking': 0.0008,
  'Computer Games': 0.0008,
  'Executive Offices': 0.0008,
  'Public Policy Offices': 0.0006,
  'Technology, Information And Internet': 0.0006,
  'Glass, Ceramics And Concrete Manufacturing': 0.0006,
  'Wireless Services': 0.0005,
  'Industrial Machinery Manufacturing': 0.0005,
  'Commercial Real Estate': 0.0005,
  'Manufacturing': 0.0004,
  'Political Organizations': 0.0004,
  'IT Services And IT Consulting': 0.0004,
  'Consumer Electronics': 0.0004,
  'Railroad Equipment Manufacturing': 0.0004,
  'Translation And Localization': 0.0004,
  'Software Development': 0.0004,
  'Alternative Medicine': 0.0003,
  'Think Tanks': 0.0003,
  'Legislative Offices': 0.0003,
  'Dairy Product Manufacturing': 0.0003,
  'Cosmetics': 0.0003,
  'Shipbuilding': 0.0003,
  'Animation And Post-Production': 0.0003,
  'Ranching': 0.0002,
  'Wellness And Fitness Services': 0.0002,
  'Fine Art': 0.0002,
  'Mining': 0.0002,
  'Fisheries': 0.0002,
  'Philanthropic Fundraising Services': 0.0001,
  'Alternative Dispute Resolution': 0.0001,
  'Tobacco Manufacturing': 0.0001,
  'Program Development': 0.0001,
  'Nanotechnology Research': 0.0001,
  'Truck Transportation': 0.0001,
  'Wholesale Building Materials': 0.0001,
  'Personal Care Product Manufacturing': 0.0001,
  'Automation Machinery Manufacturing': 0.0001,
  'Spectator Sports': 0.0001,
  'Medical Equipment Manufacturing': 0.0001,
  'Renewable Energy Semiconductor Manufacturing': 0.0001,
  'Leasing Real Estate': 0.0001,
};

// ── State Multipliers (6-anchor averages from state grid, Mar 11) ────────────

const STATE_MULTIPLIERS: Record<string, number> = {
  'California': 0.0955, 'Texas': 0.0851, 'Florida': 0.0749,
  'New York': 0.0614, 'Pennsylvania': 0.0420, 'Ohio': 0.0399,
  'Illinois': 0.0386, 'North Carolina': 0.0366, 'Georgia': 0.0327,
  'Michigan': 0.0321, 'Virginia': 0.0262, 'New Jersey': 0.0226,
  'Colorado': 0.0223, 'Washington': 0.0208, 'Tennessee': 0.0202,
  'Maryland': 0.0199, 'Indiana': 0.0197, 'Arizona': 0.0194,
  'Missouri': 0.0189, 'Wisconsin': 0.0184, 'Massachusetts': 0.0176,
  'Minnesota': 0.0168, 'Alabama': 0.0146, 'South Carolina': 0.0143,
  'Louisiana': 0.0142, 'Oregon': 0.0116, 'Kentucky': 0.0115,
  'Connecticut': 0.0113, 'Oklahoma': 0.0107, 'Nevada': 0.0102,
  'Utah': 0.0089, 'Iowa': 0.0086, 'Arkansas': 0.0085,
  'Kansas': 0.0083, 'Mississippi': 0.0061, 'Nebraska': 0.0058,
  'New Mexico': 0.0045, 'Idaho': 0.0044, 'West Virginia': 0.0034,
  'Delaware': 0.0033, 'Maine': 0.0030, 'New Hampshire': 0.0028,
  'Rhode Island': 0.0028, 'Montana': 0.0026, 'Hawaii': 0.0023,
  'South Dakota': 0.0020, 'North Dakota': 0.0017, 'Alaska': 0.0016,
  'Vermont': 0.0015, 'Wyoming': 0.0014,
  'District of Columbia': 0.0000, // dead filter
};

// ── Renter R/HO Modifiers (isolation sweep, 3 anchors, Mar 11) ──────────────

interface RenterTierModifiers {
  upper: Record<string, number>;
  lower: Record<string, number>;
  defaultUpper: number;
  defaultLower: number;
}

const RENTER_MODIFIERS: Record<string, RenterTierModifiers> = {
  'attributes.credit_rating': {
    upper: {
      '750 - 799': 0.38, '750-799': 0.38,
      '800+': 0.38,
      '700 - 749': 0.60, '700-749': 0.60,
    },
    lower: {
      '650 - 699': 1.00, '650-699': 1.00,
      '600 - 649': 1.00, '600-649': 1.00,
      '550 - 599': 1.00, '550-599': 1.00,
      '500 - 549': 1.00, '500-549': 1.00,
      'Under 499': 1.00,
    },
    defaultUpper: 0.38,
    defaultLower: 1.00,
  },
  'profile.incomeRange': {
    upper: {
      '$100,000 to $149,999': 0.44,
      '$150,000 to $199,999': 0.42,
      '$200,000 to $249,999': 0.40,
      '$250,000+': 0.38,
    },
    lower: {
      '$45,000 to $59,999': 0.97,
      '$60,000 to $74,999': 0.95,
      '$75,000 to $99,999': 0.80,
      '$20,000 to $44,999': 1.00,
      'less than $20,000': 1.00,
    },
    defaultUpper: 0.42,
    defaultLower: 0.95,
  },
  'profile.netWorth': {
    upper: {
      '$750,000 to $999,999': 0.20,
      'more than $1,000,000': 0.20,
      '$500,000 to $749,999': 0.30,
      '$375,000 to $499,999': 0.39,
      '$250,000 to $374,999': 0.39,
    },
    lower: {
      '$150,000 to $249,999': 0.60,
      '$100,000 to $149,999': 0.70,
      '$75,000 to $99,999': 0.80,
      '$50,000 to $74,999': 0.90,
      '$25,000 to $49,999': 0.95,
      '$2,500 to $24,999': 1.00,
      '-$2,499 to $2,499': 1.00,
      '-$20,000 to -$2,500': 1.00,
    },
    defaultUpper: 0.20,
    defaultLower: 0.80,
  },
  'attributes.education': {
    upper: {
      "Bachelor's": 0.42,
      "Master's": 0.42,
      'Doctorate': 0.42,
    },
    lower: {
      'High School': 2.05,
    },
    defaultUpper: 0.42,
    defaultLower: 1.00,
  },
};

// ── Upper-Tier Stacking Correction ──────────────────────────────────────────

// Stacking corrections recalibrated for per-seniority tables (Mar 17).
// Old values (global avg era): 2=1.44/2.27, 3=2.46/8.28, 4=4.86/13.0.
// HO: per-seniority tables capture most correlation → corrections near 1.0.
// Renter: Renter modifiers (0.38/0.44/0.20) compress retentions so aggressively
//   that multiplicative independence breaks down → still needs real correction.
// Measured from validation data (Staff anchor, F+25-34):
//   HO pair=1.03x triple=1.21x  |  R pair=1.54x triple=5.23x
const STACKING_CORRECTION: Record<string, { renter: number; homeowner: number }> = {
  '2': { renter: 1.54, homeowner: 1.03 },
  '3': { renter: 5.23, homeowner: 1.21 },
  '4': { renter: 10.0, homeowner: 1.42 },
};

const UPPER_TIER_VALUES: Record<string, Set<string>> = {
  'attributes.credit_rating': new Set([
    '750 - 799', '750-799', '800+', '700 - 749', '700-749',
  ]),
  'profile.incomeRange': new Set([
    '$100,000 to $149,999', '$150,000 to $199,999',
    '$200,000 to $249,999', '$250,000+',
  ]),
  'profile.netWorth': new Set([
    '$250,000 to $374,999', '$375,000 to $499,999',
    '$500,000 to $749,999', '$750,000 to $999,999',
    'more than $1,000,000',
  ]),
  'attributes.education': new Set([
    "Bachelor's", "Master's", 'Doctorate',
  ]),
};

// ── Dead Filters ────────────────────────────────────────────────────────────

const DEAD_FILTERS = new Set([
  'businessProfile.industry=Administration Of Justice',
  'businessProfile.industry=Judiciary',
  'businessProfile.industry=Leisure, Travel & Tourism',
  'businessProfile.industry=Military',
  'businessProfile.industry=Newspapers',
  'businessProfile.industry=Renewables & Environment',
  'businessProfile.industry=Supermarkets',
  'businessProfile.industry=Wine And Spirits',
  'state=District of Columbia',
]);

// ── Demographic filter keys (handled by probe grid lookup) ──────────────────

const DEMOGRAPHIC_KEYS = new Set([
  'profile.gender', 'gender',
  'profile.homeowner',
  'profile.married',
  'profile.children',
  'businessProfile.seniority',
  'age',
]);

// Filter keys that use per-seniority retention tables
const SENIORITY_MATCHED_KEYS = new Set([
  'profile.incomeRange', 'attributes.credit_rating',
  'profile.netWorth', 'attributes.education',
]);

// ── Devastating cut threshold ───────────────────────────────────────────────
// Warn when a single filter retains less than this fraction of the base
const DEVASTATING_CUT_THRESHOLD = 0.005; // 0.5% — audience drops to <0.5% of base

// ── Types ───────────────────────────────────────────────────────────────────

export interface FilterWarning {
  filter: string;
  value: string;
  retention: number;
  estimatedRemaining: number;
  message: string;
}

export interface EstimateResult {
  estimatedCount: number;
  confidence: 'high' | 'medium' | 'low';
  breakdown: {
    gridBase: number;
    gridEntriesMatched: number;
    gridEntriesCapped: number;
    appliedRetentions: Array<{ filter: string; value: string; retention: number }>;
    homeownerStatus: 'Homeowner' | 'Renter' | 'blended';
    matchedAnchor: string | null; // seniority used for retention lookup
    renterModifiersApplied: Array<{ filter: string; value: string; modifier: number }>;
    upperTierFilterCount: number;
    stackingCorrection: number;
    deadFilters: string[];
    uncalibratedFilters: string[];
    warnings: FilterWarning[];
  };
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function getRenterModifier(filterKey: string, value: string): number {
  const mods = RENTER_MODIFIERS[filterKey];
  if (!mods) return 1.0;
  if (mods.upper[value] !== undefined) return mods.upper[value];
  if (mods.lower[value] !== undefined) return mods.lower[value];
  const upperSet = UPPER_TIER_VALUES[filterKey];
  if (upperSet?.has(value)) return mods.defaultUpper;
  return mods.defaultLower;
}

function isUpperTier(filterKey: string, value: string): boolean {
  return UPPER_TIER_VALUES[filterKey]?.has(value) ?? false;
}

function countUpperTierFilters(filters: FilterSpec[]): number {
  let count = 0;
  for (const f of filters) {
    if (UPPER_TIER_VALUES[f.key] && f.values.some(v => isUpperTier(f.key, v))) {
      count++;
    }
  }
  return count;
}

function getStackingCorrection(upperCount: number, isRenter: boolean): number {
  if (upperCount < 2) return 1.0;
  const key = String(Math.min(upperCount, 4));
  const entry = STACKING_CORRECTION[key];
  if (!entry) return 1.0;
  return isRenter ? entry.renter : entry.homeowner;
}

// ── Estimator ───────────────────────────────────────────────────────────────

export function estimateAudienceSize(filters: FilterSpec[]): EstimateResult {
  const appliedRetentions: EstimateResult['breakdown']['appliedRetentions'] = [];
  const renterModifiersApplied: EstimateResult['breakdown']['renterModifiersApplied'] = [];
  const deadFilters: string[] = [];
  const uncalibratedFilters: string[] = [];
  const warnings: FilterWarning[] = [];
  let confidence: 'high' | 'medium' | 'low' = 'high';

  // Check for dead filters
  for (const f of filters) {
    for (const v of f.values) {
      if (DEAD_FILTERS.has(`${f.key}=${v}`)) {
        deadFilters.push(`${f.key}=${v}`);
      }
    }
  }
  if (deadFilters.length > 0) {
    return {
      estimatedCount: 0,
      confidence: 'high',
      breakdown: {
        gridBase: 0, gridEntriesMatched: 0, gridEntriesCapped: 0,
        appliedRetentions: [], homeownerStatus: 'blended', matchedAnchor: null,
        renterModifiersApplied: [], upperTierFilterCount: 0,
        stackingCorrection: 1, deadFilters, uncalibratedFilters: [],
        warnings: [{ filter: deadFilters[0].split('=')[0], value: deadFilters[0].split('=')[1],
          retention: 0, estimatedRemaining: 0, message: 'Dead filter — always returns 0' }],
      },
    };
  }

  // ── Step 1: Probe grid lookup for demographics ────────────────────────────
  const gridResult = lookupGridBase(filters);
  const gridBase = gridResult.count;

  if (gridBase === 0 && GRID.length > 0) {
    return {
      estimatedCount: 0,
      confidence: 'high',
      breakdown: {
        gridBase: 0, gridEntriesMatched: 0, gridEntriesCapped: 0,
        appliedRetentions: [], homeownerStatus: 'blended', matchedAnchor: null,
        renterModifiersApplied: [], upperTierFilterCount: 0,
        stackingCorrection: 1, deadFilters, uncalibratedFilters: [],
        warnings: [{ filter: 'demographics', value: '', retention: 0,
          estimatedRemaining: 0, message: 'No matching probe grid entries for this demographic combination' }],
      },
    };
  }

  // Determine homeowner status
  const hoFilter = filters.find(f => f.key === 'profile.homeowner');
  const homeownerStatus: 'Homeowner' | 'Renter' | 'blended' =
    hoFilter?.values[0] === 'Homeowner' ? 'Homeowner' :
    hoFilter?.values[0] === 'Renter' ? 'Renter' : 'blended';
  const isRenter = homeownerStatus === 'Renter';

  // Capped entries mean the base is a floor estimate
  if (gridResult.capped > 0) {
    confidence = 'medium';
  }

  // ── Step 2: Apply enrichment filters with per-seniority matching ──────────

  // Extract user's seniority + age for anchor matching
  const seniorityFilter = filters.find(f => f.key === 'businessProfile.seniority');
  const selectedSeniorities = seniorityFilter?.values.map(v => v.toLowerCase()) ?? null;
  const ageFilter = filters.find(f => f.key === 'age');
  const selectedAges = ageFilter?.range
    ? ageBracketsForRange(ageFilter.range)
    : ageFilter?.values ?? null;

  const enrichmentFilters = filters.filter(f => !DEMOGRAPHIC_KEYS.has(f.key));
  const upperTierCount = countUpperTierFilters(enrichmentFilters);

  let estimate = gridBase;
  let matchedAnchor: string | null = null;

  for (const filter of enrichmentFilters) {
    const { key, values } = filter;

    if (key === 'state') {
      // State: sum multipliers for selected states
      const stateSum = values.reduce((sum, s) => sum + (STATE_MULTIPLIERS[s] ?? 0), 0);
      const retention = Math.min(stateSum, 1.0);
      if (retention === 0) {
        uncalibratedFilters.push(`state=${values.join(',')}`);
        confidence = 'low';
        continue;
      }
      estimate *= retention;
      appliedRetentions.push({ filter: key, value: values.join(', '), retention });

      // Warning check
      const remaining = Math.round(gridBase * retention);
      if (retention < DEVASTATING_CUT_THRESHOLD) {
        warnings.push({
          filter: key, value: values.join(', '), retention, estimatedRemaining: remaining,
          message: `State filter retains only ${(retention * 100).toFixed(2)}% of your audience (${remaining.toLocaleString()} remaining)`,
        });
      }
      continue;
    }

    // Industry uses global retention (no per-seniority variation measured)
    if (key === 'businessProfile.industry') {
      let totalRetention = 0;
      for (const v of values) {
        const ret = INDUSTRY_RETENTION[v];
        if (ret == null) {
          uncalibratedFilters.push(`${key}=${v}`);
          confidence = 'low';
          continue;
        }
        totalRetention += ret;
      }
      if (totalRetention <= 0) continue;
      totalRetention = Math.min(totalRetention, 1.0);
      estimate *= totalRetention;
      appliedRetentions.push({ filter: key, value: values.join(', '), retention: totalRetention });
      const remaining = Math.round(gridBase * totalRetention);
      if (totalRetention < DEVASTATING_CUT_THRESHOLD) {
        warnings.push({
          filter: key, value: values.join(', '), retention: totalRetention, estimatedRemaining: remaining,
          message: `This filter retains only ${(totalRetention * 100).toFixed(2)}% of your base audience (${remaining.toLocaleString()} remaining)`,
        });
      }
      continue;
    }

    // Per-seniority matched enrichment filters
    if (SENIORITY_MATCHED_KEYS.has(key)) {
      const { table: retentionTable, matchedAnchor: anchor } = getRetentionTable(key, selectedSeniorities, selectedAges);
      if (anchor && !matchedAnchor) matchedAnchor = anchor;

      let totalRetention = 0;
      for (const v of values) {
        let ret = retentionTable[v];
        if (ret == null) {
          uncalibratedFilters.push(`${key}=${v}`);
          confidence = 'low';
          continue;
        }

        // Apply renter modifier on top of seniority-matched retention
        if (isRenter && RENTER_MODIFIERS[key]) {
          const mod = getRenterModifier(key, v);
          ret *= mod;
          renterModifiersApplied.push({ filter: key, value: v, modifier: mod });
        }

        totalRetention += ret;
      }

      if (totalRetention <= 0) continue;
      totalRetention = Math.min(totalRetention, 1.0);

      estimate *= totalRetention;
      appliedRetentions.push({ filter: key, value: values.join(', '), retention: totalRetention });

      // Warning: would this single filter devastate the audience?
      const remaining = Math.round(gridBase * totalRetention);
      if (totalRetention < DEVASTATING_CUT_THRESHOLD) {
        warnings.push({
          filter: key, value: values.join(', '), retention: totalRetention, estimatedRemaining: remaining,
          message: `This filter retains only ${(totalRetention * 100).toFixed(2)}% of your base audience (${remaining.toLocaleString()} remaining)`,
        });
      }
      continue;
    }

    // Unknown/uncalibrated filter type
    uncalibratedFilters.push(`${key}=${values.join(',')}`);
    confidence = 'low';
  }

  // ── Step 3: Stacking correction for upper-tier wealth combos ──────────────

  const stackingCorrection = getStackingCorrection(upperTierCount, isRenter);
  if (stackingCorrection > 1.0) {
    estimate *= stackingCorrection;
  }

  // Renter estimates have less calibration data
  if (isRenter && confidence === 'high') {
    confidence = 'medium';
  }

  // Cap at grid base (enrichment can't add people)
  estimate = Math.min(estimate, gridBase);
  estimate = Math.max(0, Math.round(estimate));

  return {
    estimatedCount: estimate,
    confidence,
    breakdown: {
      gridBase,
      gridEntriesMatched: gridResult.matched,
      gridEntriesCapped: gridResult.capped,
      appliedRetentions,
      homeownerStatus,
      matchedAnchor,
      renterModifiersApplied,
      upperTierFilterCount: upperTierCount,
      stackingCorrection,
      deadFilters,
      uncalibratedFilters,
      warnings,
    },
  };
}

export default estimateAudienceSize;
