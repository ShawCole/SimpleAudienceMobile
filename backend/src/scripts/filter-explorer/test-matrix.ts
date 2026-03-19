import { FILTER_TAXONOMY } from '../../../../shared/taxonomy/filter-taxonomy';
import { EXPLORER_CONFIG } from './config';
import type { FilterSpec, TestCase } from './payload-factory';

/**
 * Maps taxonomy category + filter name → the FilterSpec key used by payload-factory.
 */
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
  Contact: {
    'Verified Personal Emails': 'contact.verifiedPersonalEmails',
    'Verified Business Emails': 'contact.verifiedBusinessEmails',
    'Valid Phones': 'contact.validPhones',
    'Skip Traced Wireless Phone Number': 'contact.skipTracedWireless',
    'Skip Traced Wireless B2B Phone Number': 'contact.skipTracedWirelessB2B',
  },
};

/** Dynamic range filters tested with representative ranges */
const RANGE_TESTS: Array<{ key: string; label: string; ranges: Array<{ label: string; min: number | null; max: number | null }> }> = [
  {
    key: 'age',
    label: 'Age',
    ranges: [
      { label: '18-35', min: 18, max: 35 },
      { label: '36-55', min: 36, max: 55 },
      { label: '56-80', min: 56, max: 80 },
    ],
  },
  {
    key: 'attributes.home_year_built',
    label: 'Home Year Built',
    ranges: [
      { label: '1950-1980', min: 1950, max: 1980 },
      { label: '1980-2000', min: 1980, max: 2000 },
      { label: '2000-2025', min: 2000, max: 2025 },
    ],
  },
  {
    key: 'attributes.home_purchase_price',
    label: 'Purchase Price',
    ranges: [
      { label: '100k-300k', min: 100000, max: 300000 },
      { label: '300k-600k', min: 300000, max: 600000 },
      { label: '600k+', min: 600000, max: null },
    ],
  },
  {
    key: 'attributes.mortgage_amount',
    label: 'Mortgage Amount',
    ranges: [
      { label: '50k-200k', min: 50000, max: 200000 },
      { label: '200k-500k', min: 200000, max: 500000 },
      { label: '500k+', min: 500000, max: null },
    ],
  },
];

/** States to test individually */
const TEST_STATES = ['florida', 'california', 'texas', 'new york', 'illinois'];

function makeId(phase: string, key: string, values: string[]): string {
  return `${phase}:${key}:${values.join('+')}`;
}

/** Phase 1: Baseline */
function generateBaseline(): TestCase[] {
  return [{
    id: 'baseline',
    phase: 'baseline',
    label: 'No filters (total universe)',
    filters: [],
  }];
}

/** Phase 2: Singles */
function generateSingles(): TestCase[] {
  const tests: TestCase[] = [];
  const taxonomy = FILTER_TAXONOMY as Record<string, Record<string, { type: string; options?: Array<{ label: string }> }>>;

  // Option-type filters from taxonomy (skip Contact — handled separately as toggles below)
  for (const [category, filters] of Object.entries(taxonomy)) {
    if (category === 'Contact') continue;
    const keyMap = TAXONOMY_TO_KEY[category];
    if (!keyMap) continue;

    for (const [filterName, def] of Object.entries(filters)) {
      const filterKey = keyMap[filterName];
      if (!filterKey || !def.options) continue;

      const isLarge = def.options.length > EXPLORER_CONFIG.largeCardinalityThreshold;
      const options = isLarge
        ? def.options.slice(0, EXPLORER_CONFIG.largeSampleLimit)
        : def.options;

      for (const opt of options) {
        tests.push({
          id: makeId('single', filterKey, [opt.label]),
          phase: 'single',
          label: `${filterName} = ${opt.label}`,
          filters: [{ key: filterKey, values: [opt.label] }],
        });
      }
    }
  }

  // State filters
  for (const state of TEST_STATES) {
    tests.push({
      id: makeId('single', 'state', [state]),
      phase: 'single',
      label: `State = ${state}`,
      filters: [{ key: 'state', values: [state] }],
    });
  }

  // Dynamic range filters
  for (const rt of RANGE_TESTS) {
    for (const range of rt.ranges) {
      tests.push({
        id: makeId('single', rt.key, [range.label]),
        phase: 'single',
        label: `${rt.label} = ${range.label}`,
        filters: [{ key: rt.key, values: [range.label], range: { min: range.min, max: range.max } }],
      });
    }
  }

  // Contact toggles
  for (const [name, key] of Object.entries(TAXONOMY_TO_KEY.Contact)) {
    tests.push({
      id: makeId('single', key, ['on']),
      phase: 'single',
      label: `${name} = On`,
      filters: [{ key, values: ['on'] }],
    });
  }

  return tests;
}

/** Phase 3: Pairs */
function generatePairs(): TestCase[] {
  const tests: TestCase[] = [];
  const keys = EXPLORER_CONFIG.pairFilterKeys;
  const reps = EXPLORER_CONFIG.pairRepresentativeValues;

  for (let i = 0; i < keys.length; i++) {
    for (let j = i + 1; j < keys.length; j++) {
      const keyA = keys[i];
      const keyB = keys[j];
      const repA = reps[keyA];
      const repB = reps[keyB];
      if (!repA || !repB) continue;

      const specA: FilterSpec = {
        key: keyA,
        values: repA.values || [],
        range: repA.range,
      };
      const specB: FilterSpec = {
        key: keyB,
        values: repB.values || [],
        range: repB.range,
      };

      const idA = repA.values ? repA.values.join('+') : `${repA.range?.min}-${repA.range?.max}`;
      const idB = repB.values ? repB.values.join('+') : `${repB.range?.min}-${repB.range?.max}`;

      tests.push({
        id: `pair:${keyA}=${idA}&${keyB}=${idB}`,
        phase: 'pair',
        label: `${keyA}(${idA}) + ${keyB}(${idB})`,
        filters: [specA, specB],
      });
    }
  }

  return tests;
}

/** Phase 4: Saturation */
function generateSaturation(): TestCase[] {
  const tests: TestCase[] = [];

  for (const sf of EXPLORER_CONFIG.saturationFilters) {
    const values = sf.values;
    for (let n = 1; n <= values.length; n++) {
      const subset = values.slice(0, n);
      tests.push({
        id: `saturation:${sf.key}:${n}of${values.length}`,
        phase: 'saturation',
        label: `${sf.key} [${n}/${values.length}]: ${subset.join(', ')}`,
        filters: [{ key: sf.key, values: subset }],
      });
    }
  }

  return tests;
}

/** Generate the full test matrix */
export function generateTestMatrix(phases?: {
  baseline?: boolean;
  singles?: boolean;
  pairs?: boolean;
  saturation?: boolean;
}): TestCase[] {
  const p = phases || EXPLORER_CONFIG.phases;
  const matrix: TestCase[] = [];

  if (p.baseline) matrix.push(...generateBaseline());
  if (p.singles) matrix.push(...generateSingles());
  if (p.pairs) matrix.push(...generatePairs());
  if (p.saturation) matrix.push(...generateSaturation());

  return matrix;
}
