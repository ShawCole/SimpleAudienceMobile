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

// Filter keys we track per-anchor from L1 sweep data
const ENRICHMENT_FILTER_KEYS = new Set([
  'profile.incomeRange', 'attributes.credit_rating',
  'profile.netWorth', 'attributes.education',
  'state', // state retention varies by demographics (CA: 0.074→0.146 across anchors)
  'businessProfile.industry', // VP FinServ=0.11 vs Staff=0.04 (2.5x variance)
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
 *   1. If Renter selected AND Renter L1 anchors exist → use them directly
 *   2. Exact seniority + exact age → use that anchor
 *   3. Exact seniority + adjacent age → weighted blend by age distance
 *   4. Exact seniority + any age → average across all ages for that seniority
 *   5. No seniority match → average across all anchors for that homeowner type
 *   6. If Renter with no Renter anchors → fall back to HO anchors (caller applies modifiers)
 */
function getRetentionTable(
  filterKey: string,
  selectedSeniorities: string[] | null,
  selectedAges: string[] | null,
  homeownerStatus: 'Homeowner' | 'Renter' | 'blended' = 'blended',
): { table: RetentionTable; matchedAnchor: string | null; directRenter: boolean } {

  // Try Renter L1 anchors first when user selects Renter
  if (homeownerStatus === 'Renter') {
    const renterAnchors = L1_ANCHORS.filter(a => a.homeowner === 'Renter');
    if (renterAnchors.length > 0) {
      const result = matchAnchors(renterAnchors, filterKey, selectedSeniorities, selectedAges, 'Renter');
      if (result.table && Object.keys(result.table).length > 0) {
        return { ...result, directRenter: true };
      }
    }
  }

  // Use Homeowner L1 anchors (default path, or Renter fallback)
  const hoAnchors = L1_ANCHORS.filter(a => a.homeowner === 'Homeowner');
  if (hoAnchors.length === 0) {
    return { table: {}, matchedAnchor: null, directRenter: false };
  }

  const result = matchAnchors(hoAnchors, filterKey, selectedSeniorities, selectedAges, 'HO');
  return { ...result, directRenter: false };
}

/** Core anchor matching logic — shared between Homeowner and Renter paths */
function matchAnchors(
  anchors: L1Anchor[],
  filterKey: string,
  selectedSeniorities: string[] | null,
  selectedAges: string[] | null,
  label: string,
): { table: RetentionTable; matchedAnchor: string | null } {

  const seniorities = selectedSeniorities?.length ? selectedSeniorities : null;
  const matchingSen = seniorities
    ? anchors.filter(a => seniorities.includes(a.seniority))
    : anchors;

  if (matchingSen.length === 0) {
    return blendAnchors(anchors, filterKey, null, `${label}-global(${anchors.length})`);
  }

  const userAge = selectedAges?.length === 1 ? selectedAges[0] : null;

  if (userAge && AGE_BRACKET_ORDER[userAge] != null) {
    const exact = matchingSen.filter(a => a.age === userAge);
    if (exact.length > 0) {
      return blendAnchors(exact, filterKey, null, `${label}:${exact[0].seniority}@${userAge}`);
    }

    const userOrd = AGE_BRACKET_ORDER[userAge];
    const weighted: Array<{ anchor: L1Anchor; weight: number }> = [];
    for (const a of matchingSen) {
      const aOrd = AGE_BRACKET_ORDER[a.age];
      if (aOrd == null) { weighted.push({ anchor: a, weight: 1 }); continue; }
      const dist = Math.abs(userOrd - aOrd);
      weighted.push({ anchor: a, weight: 1 / (1 + dist) });
    }
    return blendAnchorsWeighted(weighted, filterKey,
      `${label}:${seniorities!.join('+')}~${userAge}(${weighted.length})`);
  }

  return blendAnchors(matchingSen, filterKey, null,
    `${label}:${matchingSen[0].seniority}(${matchingSen.length})`);
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

// ── Combo-Type Stacking Corrections (Apr 2, 2026 — 74 measured data points) ──
//
// Fixed correction factors don't work: HO Staff=0.51x pair vs HO CXO=1.22x pair.
// New system: categorize enrichment filters into correlation groups, then look up
// the correction based on which groups are being stacked.
//
// Correlation groups:
//   'wealth' = credit_rating, incomeRange (financially correlated)
//   'networth' = netWorth (sparse data, acts as selection gate — amplifies corrections)
//   'education' = education (correlated with wealth but different dimension)
//   'geo' = state (geographically independent — near-multiplicative)
//   'industry' = industry (independent)
//
// Correction = f(homeowner_type, set_of_groups_involved)

type CorrectionGroup = 'wealth' | 'networth' | 'education' | 'geo' | 'industry';

const FILTER_KEY_TO_GROUP: Record<string, CorrectionGroup> = {
  'attributes.credit_rating': 'wealth',
  'profile.incomeRange': 'wealth',
  'profile.netWorth': 'networth',
  'attributes.education': 'education',
  'state': 'geo',
  'businessProfile.industry': 'industry',
};

// ── Pure Interaction Coefficients (retention-based, Apr 3 2026) ──────────────
// Derived from sweep data: actual_combo_retention / (retA × retB)
// These measure ONLY filter correlation — independent of base or single-filter errors.
// This means they generalize across anchors better than count-calibrated corrections.
//
// Loaded from stacking-validation-*.ndjson files at module init.
// Keyed by "HO|comboLabel" or "Renter|comboLabel", value = median coefficient.

const INTERACTION_COEFFICIENTS: Record<string, number> = {};

try {
  const stackDir = join(__dirname, '../../data/filter-explorer/calibration');
  const stackFiles = readdirSync(stackDir).filter(f => f.startsWith('stacking-validation-') && f.endsWith('.ndjson'));
  const byKey: Record<string, number[]> = {};
  for (const file of stackFiles) {
    const lines = readFileSync(join(stackDir, file), 'utf-8').trim().split('\n');
    for (const line of lines) {
      const d = JSON.parse(line);
      if (!d.combo || d.stackingCorrection <= 0 || d.actualCount <= 0) continue;
      const hoType = d.anchor.startsWith('HO:') ? 'HO' : 'Renter';
      const key = `${hoType}|${d.combo}`;
      if (!byKey[key]) byKey[key] = [];
      byKey[key].push(d.stackingCorrection);
    }
  }
  for (const [key, vals] of Object.entries(byKey)) {
    const sorted = [...vals].sort((a, b) => a - b);
    INTERACTION_COEFFICIENTS[key] = sorted[Math.floor(sorted.length / 2)]; // median
  }
  console.log(`[estimator] Loaded ${Object.keys(INTERACTION_COEFFICIENTS).length} interaction coefficients from ${stackFiles.length} files`);
} catch (err) {
  console.error('[estimator] Failed to load interaction coefficients:', err);
}

// Fallback group-based interaction coefficients for unmeasured combos
// These are medians from measured data, grouped by filter category pattern
const FALLBACK_INTERACTIONS: Record<string, { ho: number; renter: number }> = {
  'wealth':                   { ho: 1.12, renter: 1.10 },  // credit+income
  'wealth+networth':          { ho: 1.46, renter: 2.23 },  // credit+NW or income+NW
  'wealth+education':         { ho: 1.86, renter: 2.49 },  // credit+edu
  'wealth+geo':               { ho: 0.98, renter: 0.97 },  // credit+state (near-independent)
  'networth+geo':             { ho: 1.46, renter: 2.26 },  // NW+state
  'networth+education':       { ho: 1.50, renter: 2.30 },  // NW+edu (interpolated)
  'education+geo':            { ho: 1.00, renter: 1.00 },  // edu+state (interpolated)
  'wealth+networth+education': { ho: 2.44, renter: 4.08 },  // triple wealth+edu
  'wealth+networth+geo':      { ho: 2.74, renter: 4.58 },  // triple wealth+geo
  'wealth+education+geo':     { ho: 1.30, renter: 1.09 },  // triple mixed
};

/** Identify which correlation groups are present in the enrichment filters */
function getStackingGroups(filters: FilterSpec[]): Set<CorrectionGroup> {
  const groups = new Set<CorrectionGroup>();
  for (const f of filters) {
    const g = FILTER_KEY_TO_GROUP[f.key];
    if (g) groups.add(g);
  }
  return groups;
}

/** Build a short label for a filter value (matches stacking-validation combo labels) */
function filterShortName(f: FilterSpec): string {
  const v = f.values[0] || '';
  if (f.key === 'attributes.credit_rating') return v.includes('750') || v.includes('800') || v.includes('700') ? 'Cr750' : 'Cr650';
  if (f.key === 'profile.incomeRange') return v.includes('100,000') || v.includes('150,000') || v.includes('200,000') || v.includes('250,000+') ? 'Inc100k' : 'Inc45k';
  if (f.key === 'profile.netWorth') {
    if (v.includes('750,000') || v.includes('999,999') || v.includes('1,000,000')) return 'NW750k';
    return 'NW500k'; // Use NW500k as default for any upper NW
  }
  if (f.key === 'attributes.education') return v.includes('Bachelor') || v.includes('Master') || v.includes('Doctor') ? 'EduBach' : 'Edu';
  if (f.key === 'state') return v.includes('California') ? 'CA' : v.includes('Texas') ? 'TX' : v;
  return f.key;
}

/** Get the pure interaction coefficient for a set of enrichment filters.
 *  Measures filter correlation independent of base/retention errors.
 *  Generalizes across anchors because it's a property of the filters, not the population. */
function getStackingCorrection(
  enrichmentFilters: FilterSpec[],
  isRenter: boolean,
  _directRenter: boolean,
  _selectedSeniorities: string[] | null,
): number {
  const groups = getStackingGroups(enrichmentFilters);
  if (groups.size < 2) return 1.0;

  const comboLabel = enrichmentFilters.map(filterShortName).join('+');
  const hoType = isRenter ? 'Renter' : 'HO';

  // Exact combo match from measured interaction data
  const coeff = INTERACTION_COEFFICIENTS[`${hoType}|${comboLabel}`];
  if (coeff) return coeff;

  // Fallback: group-based interaction coefficient
  const groupKey = [...groups].sort().join('+');
  const fallback = FALLBACK_INTERACTIONS[groupKey];
  if (fallback) return isRenter ? fallback.renter : fallback.ho;

  return 1.0;
}

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

// Filter keys that use per-anchor retention tables (matched by seniority+age)
const ANCHOR_MATCHED_KEYS = new Set([
  'profile.incomeRange', 'attributes.credit_rating',
  'profile.netWorth', 'attributes.education',
  'state', // CA: 0.074→0.146 across anchors
  'businessProfile.industry', // VP FinServ=0.11 vs Staff=0.04 (2.5x variance)
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
  let usingDirectRenter = false;

  for (const filter of enrichmentFilters) {
    const { key, values } = filter;

    // Per-anchor matched filters (enrichment + state + industry)
    if (ANCHOR_MATCHED_KEYS.has(key)) {
      const { table: retentionTable, matchedAnchor: anchor, directRenter } = getRetentionTable(key, selectedSeniorities, selectedAges, homeownerStatus);
      if (anchor && !matchedAnchor) matchedAnchor = anchor;
      if (directRenter) usingDirectRenter = true;

      let totalRetention = 0;
      for (const v of values) {
        let ret = retentionTable[v];
        // Fallback to global tables when L1 anchor doesn't have a specific value
        if (ret == null && key === 'state') ret = STATE_MULTIPLIERS[v] ?? null;
        if (ret == null && key === 'businessProfile.industry') ret = INDUSTRY_RETENTION[v] ?? null;
        if (ret == null) {
          uncalibratedFilters.push(`${key}=${v}`);
          confidence = 'low';
          continue;
        }

        // Apply renter modifier ONLY when falling back to HO anchors (skip when using direct Renter L1 data)
        if (isRenter && !directRenter && key !== 'state' && key !== 'businessProfile.industry' && RENTER_MODIFIERS[key]) {
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

  // ── Step 3: Combo-type-aware stacking correction ───────────────────────────
  // Uses measured corrections from 74 stacking validation probes (Apr 2).
  // Correction depends on which filter categories are combined and seniority.
  const stackingCorrection = getStackingCorrection(enrichmentFilters, isRenter, usingDirectRenter, selectedSeniorities);
  if (stackingCorrection !== 1.0) {
    estimate *= stackingCorrection;
  }

  // Renter estimates without direct L1 data have less calibration confidence
  if (isRenter && !usingDirectRenter && confidence === 'high') {
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
