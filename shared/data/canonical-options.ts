/**
 * Canonical valid options for IntentCore audience payloads.
 * Verified from the portal — these are the EXACT strings the backend accepts.
 * IntentCore silently drops/ignores invalid values, so validation must happen client-side.
 */

export const VALID_OPTIONS: Record<string, Set<string>> = {
  'audience.b2b': new Set(['B2B']),  // string, never boolean
  'score': new Set(['low', 'medium', 'high']),
  'filters.gender': new Set(['male', 'female']),
  'filters.profile.incomeRange': new Set([
    '$$less than $20,000',
    '$$20,000 to $44,999',
    '$$45,000 to $59,999',
    '$$60,000 to $74,999',
    '$$75,000 to $99,999',
    '$$100,000 to $149,999',
    '$$150,000 to $199,999',   // Single bucket — no $150K-$175K split
    '$$200,000 to $249,999',
    '$$250,000+',
  ]),
  'filters.profile.homeowner': new Set(['homeowner', 'renter']),
  'filters.profile.married': new Set(['yes', 'no']),
  'filters.profile.children': new Set(['no children', 'has children']),
  'filters.businessProfile.seniority': new Set(['cxo', 'vp', 'director', 'manager', 'staff']),
  'filters.businessProfile.companyRevenue': new Set([
    'Under 1 Million',
    '1 Million to 5 Million',
    '5 Million to 10 Million',
    '10 Million to 25 Million',
    '25 Million to 50 Million',
    '50 Million to 100 Million',
    '100 Million to 250 Million',
    '250 Million to 500 Million',
    '500 Million to 1 Billion',
    '1 Billion and Over',
  ]),
  'filters.businessProfile.department': new Set([
    'administrative', 'community and social services', 'education', 'engineering',
    'executive', 'finance', 'government', 'health services', 'human resources',
    'information technology', 'legal', 'media and communications',
    'military and protective services', 'marketing', 'operations',
    'product management', 'real estate', 'sales',
  ]),
  'filters.notNulls': new Set([
    'PERSONAL_EMAILS_VALIDATION_STATUS',
    'BUSINESS_EMAILS_VALIDATION_STATUS',
    'VALID_PHONES',
    'SKIPTRACE_WIRELESS_NUMBERS',
    'SKIPTRACE_B2B_PHONE',
  ]),
};

/** Common mistakes and their corrections */
export const AUTO_CORRECTIONS: Record<string, Record<string, string>> = {
  'filters.notNulls': {
    'PERSONAL_EMAIL': 'PERSONAL_EMAILS_VALIDATION_STATUS',
    'BUSINESS_EMAIL': 'BUSINESS_EMAILS_VALIDATION_STATUS',
  },
};

export const FORMATTING_RULES: Record<string, 'currency' | 'lowercase' | 'word_label' | 'uppercase' | 'none'> = {
  'filters.profile.incomeRange': 'currency',
  'filters.profile.netWorth': 'currency',
  'filters.profile.homeowner': 'lowercase',
  'filters.profile.married': 'lowercase',
  'filters.profile.children': 'lowercase',
  'filters.businessProfile.seniority': 'lowercase',
  'filters.businessProfile.department': 'lowercase',
  'filters.businessProfile.companyRevenue': 'word_label',  // NO formatting — pass through
  'filters.businessProfile.industry': 'none',
  'filters.attributes.credit_rating': 'lowercase',
  'filters.attributes.estimated_home_value': 'currency',
  'filters.attributes.credit_range_new_credit': 'currency',
  'filters.attributes.marital_status': 'lowercase',
  'filters.attributes.occupation_group': 'lowercase',
  'filters.attributes.occupation_type': 'lowercase',
  'filters.attributes.cra_code': 'lowercase',
  'filters.attributes.credit_card_user': 'lowercase',
  'filters.attributes.investment': 'lowercase',
};
