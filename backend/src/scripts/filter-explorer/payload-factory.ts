import type { AudiencePayload } from '../../../../shared/types/audience-payload';
import { EXPLORER_CONFIG } from './config';

export interface FilterSpec {
  key: string;       // dot-path: 'businessProfile.seniority', 'state', 'age'
  values: string[];  // option labels from taxonomy
  range?: { min: number | null; max: number | null };
}

export interface TestCase {
  id: string;
  phase: 'baseline' | 'single' | 'pair' | 'saturation' | 'grid';
  label: string;
  filters: FilterSpec[];
}

// ---------------------------------------------------------------------------
// Transform helpers — exact mirrors of handlePreview() in create/page.tsx
// ---------------------------------------------------------------------------

/** Strips "Category: " prefix if present, then lowercases */
function formatFilterLabel(label: string): string {
  if (label.includes(': ')) return label.split(': ')[1].trim().toLowerCase();
  return label.trim().toLowerCase();
}

/** Currency fields: prepend $ so "$75,000" → "$$75,000"; digit-start also gets "$$" */
function formatCurrencyLabel(label: string): string {
  const lower = label.trim().toLowerCase();
  if (lower.startsWith('$')) return '$' + lower;
  if (/^\d/.test(lower)) return '$$' + lower;
  return lower;
}

// ---------------------------------------------------------------------------
// Blank payload — matches handlePreview() shape exactly
// ---------------------------------------------------------------------------

function blankPayload(accountId: string, audienceId: string): AudiencePayload {
  return {
    accountId,
    id: audienceId,
    filters: {
      audience: {
        type: 'premade',
        b2b: null,
        customTopic: '',
        customDescription: '',
        segmentSearches: [],
      },
      jobId: '',
      segment: [],
      daysBack: null,
      score: [],
      filters: {
        age: { minAge: null, maxAge: null },
        city: [],
        state: [],
        zip: [],
        gender: [],
        profile: {
          incomeRange: [],
          homeowner: [],
          married: [],
          netWorth: [],
          children: [],
        },
        businessProfile: {
          companyDescription: [],
          jobTitle: [],
          seniority: [],
          department: [],
          companyName: [],
          companyDomain: [],
          industry: [],
          sic: [],
          employeeCount: [],
          companyRevenue: [],
          companyNaics: [],
        },
        attributes: {
          credit_rating: [],
          language_code: [],
          occupation_group: [],
          occupation_type: [],
          home_year_built: { min: null, max: null },
          single_parent: [],
          cra_code: [],
          dwelling_type: [],
          credit_range_new_credit: [],
          ethnic_code: [],
          marital_status: [],
          net_worth: [],
          education: [],
          credit_card_user: [],
          investment: [],
          smoker: [],
          home_purchase_price: { min: null, max: null },
          home_purchase_year: { min: null, max: null },
          estimated_home_value: [],
          mortgage_amount: { min: null, max: null },
          generations_in_household: [],
        },
        notNulls: [],
        nullOnly: [],
      },
    },
  };
}

// ---------------------------------------------------------------------------
// FILTER_SETTERS — each applies the SAME transform handlePreview() uses
// ---------------------------------------------------------------------------

type PayloadSetter = (payload: AudiencePayload, spec: FilterSpec) => void;

const FILTER_SETTERS: Record<string, PayloadSetter> = {
  // Business — handlePreview passes raw o.label (no transform)
  'businessProfile.seniority': (p, s) => { p.filters.filters.businessProfile.seniority = s.values; },
  'businessProfile.department': (p, s) => { p.filters.filters.businessProfile.department = s.values; },
  'businessProfile.industry': (p, s) => { p.filters.filters.businessProfile.industry = s.values; },
  'businessProfile.employeeCount': (p, s) => { p.filters.filters.businessProfile.employeeCount = s.values; },
  'businessProfile.companyRevenue': (p, s) => { p.filters.filters.businessProfile.companyRevenue = s.values; },
  'businessProfile.companyName': (p, s) => { p.filters.filters.businessProfile.companyName = s.values; },
  'businessProfile.companyDomain': (p, s) => { p.filters.filters.businessProfile.companyDomain = s.values; },
  'businessProfile.companyNaics': (p, s) => { p.filters.filters.businessProfile.companyNaics = s.values; },
  'businessProfile.sic': (p, s) => { p.filters.filters.businessProfile.sic = s.values; },
  'businessProfile.jobTitle': (p, s) => { p.filters.filters.businessProfile.jobTitle = s.values; },
  'businessProfile.companyDescription': (p, s) => { p.filters.filters.businessProfile.companyDescription = s.values; },

  // Profile — handlePreview applies formatCurrencyLabel to incomeRange/netWorth, formatFilterLabel to rest
  'profile.incomeRange': (p, s) => { p.filters.filters.profile.incomeRange = s.values.map(formatCurrencyLabel); },
  'profile.netWorth': (p, s) => { p.filters.filters.profile.netWorth = s.values.map(formatCurrencyLabel); },
  'profile.homeowner': (p, s) => { p.filters.filters.profile.homeowner = s.values.map(formatFilterLabel); },
  'profile.married': (p, s) => { p.filters.filters.profile.married = s.values.map(formatFilterLabel); },
  'profile.children': (p, s) => { p.filters.filters.profile.children = s.values.map(formatFilterLabel); },

  // Attributes — handlePreview applies formatFilterLabel to arrays, formatCurrencyLabel to estimated_home_value
  'attributes.credit_rating': (p, s) => { p.filters.filters.attributes.credit_rating = s.values.map(formatFilterLabel); },
  'attributes.language_code': (p, s) => { p.filters.filters.attributes.language_code = s.values.map(formatFilterLabel); },
  'attributes.occupation_group': (p, s) => { p.filters.filters.attributes.occupation_group = s.values.map(formatFilterLabel); },
  'attributes.occupation_type': (p, s) => { p.filters.filters.attributes.occupation_type = s.values.map(formatFilterLabel); },
  'attributes.single_parent': (p, s) => { p.filters.filters.attributes.single_parent = s.values.map(formatFilterLabel); },
  'attributes.cra_code': (p, s) => { p.filters.filters.attributes.cra_code = s.values.map(formatFilterLabel); },
  'attributes.dwelling_type': (p, s) => { p.filters.filters.attributes.dwelling_type = s.values.map(formatFilterLabel); },
  'attributes.credit_range_new_credit': (p, s) => { p.filters.filters.attributes.credit_range_new_credit = s.values; },
  'attributes.ethnic_code': (p, s) => { p.filters.filters.attributes.ethnic_code = s.values.map(formatFilterLabel); },
  'attributes.marital_status': (p, s) => { p.filters.filters.attributes.marital_status = s.values.map(formatFilterLabel); },
  'attributes.net_worth': (p, s) => { p.filters.filters.attributes.net_worth = s.values.map(formatFilterLabel); },
  'attributes.education': (p, s) => { p.filters.filters.attributes.education = s.values.map(formatFilterLabel); },
  'attributes.credit_card_user': (p, s) => { p.filters.filters.attributes.credit_card_user = s.values.map(formatFilterLabel); },
  'attributes.investment': (p, s) => { p.filters.filters.attributes.investment = s.values.map(formatFilterLabel); },
  'attributes.smoker': (p, s) => { p.filters.filters.attributes.smoker = s.values.map(formatFilterLabel); },
  'attributes.estimated_home_value': (p, s) => { p.filters.filters.attributes.estimated_home_value = s.values.map(formatCurrencyLabel); },
  'attributes.generations_in_household': (p, s) => { p.filters.filters.attributes.generations_in_household = s.values.map(formatFilterLabel); },

  // Attribute ranges
  'attributes.home_year_built': (p, s) => { if (s.range) p.filters.filters.attributes.home_year_built = s.range; },
  'attributes.home_purchase_price': (p, s) => { if (s.range) p.filters.filters.attributes.home_purchase_price = s.range; },
  'attributes.home_purchase_year': (p, s) => { if (s.range) p.filters.filters.attributes.home_purchase_year = s.range; },
  'attributes.mortgage_amount': (p, s) => { if (s.range) p.filters.filters.attributes.mortgage_amount = s.range; },

  // Top-level filters
  'state': (p, s) => { p.filters.filters.state = s.values; },
  'city': (p, s) => { p.filters.filters.city = s.values; },
  'zip': (p, s) => { p.filters.filters.zip = s.values; },
  'gender': (p, s) => { p.filters.filters.gender = s.values.map(formatFilterLabel); },
  'profile.gender': (p, s) => { p.filters.filters.gender = s.values.map(formatFilterLabel); },
  'age': (p, s) => {
    if (s.range) {
      p.filters.filters.age.minAge = s.range.min;
      p.filters.filters.age.maxAge = s.range.max;
    }
  },

  // Contact toggles — handlePreview maps to UPPERCASE Partner Portal constants
  'contact.verifiedPersonalEmails': (p) => { p.filters.filters.notNulls.push('PERSONAL_EMAILS_VALIDATION_STATUS'); },
  'contact.verifiedBusinessEmails': (p) => { p.filters.filters.notNulls.push('BUSINESS_EMAILS_VALIDATION_STATUS'); },
  'contact.validPhones': (p) => { p.filters.filters.notNulls.push('VALID_PHONES'); },
  'contact.skipTracedWireless': (p) => { p.filters.filters.notNulls.push('SKIPTRACE_WIRELESS_NUMBERS'); },
  'contact.skipTracedWirelessB2B': (p) => { p.filters.filters.notNulls.push('SKIPTRACE_B2B_PHONE'); },
};

/** Build a full AudiencePayload from a TestCase — produces identical JSON to handlePreview() */
export function buildPayload(testCase: TestCase, audienceId: string): AudiencePayload {
  const payload = blankPayload(EXPLORER_CONFIG.accountId, audienceId);

  for (const spec of testCase.filters) {
    const setter = FILTER_SETTERS[spec.key];
    if (!setter) {
      console.warn(`[payload-factory] No setter for filter key: ${spec.key}`);
      continue;
    }
    setter(payload, spec);
  }

  return payload;
}

/** All registered filter keys */
export function getAllFilterKeys(): string[] {
  return Object.keys(FILTER_SETTERS);
}
