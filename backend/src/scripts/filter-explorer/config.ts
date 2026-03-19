import path from 'path';

export const EXPLORER_CONFIG = {
  // Live session IDs — set from active VacuumEngine session
  accountId: '', // Filled dynamically from VacuumEngine session
  audienceId: '', // Filled dynamically from live URL after login

  // Rate limiting
  delay: { min: 2000, max: 5000 }, // ms, randomized between requests

  // Phase toggles
  phases: {
    baseline: true,
    singles: true,
    pairs: true,
    saturation: true,
  },

  // Key filters for pair testing (keeps combinatorics manageable: C(15,2) = 105 pairs)
  pairFilterKeys: [
    'businessProfile.seniority',
    'businessProfile.department',
    'businessProfile.industry',
    'businessProfile.employeeCount',
    'profile.incomeRange',
    'profile.netWorth',
    'attributes.credit_rating',
    'attributes.education',
    'attributes.occupation_group',
    'state',
    'gender',
    'age',
    'profile.homeowner',
    'profile.children',
    'attributes.dwelling_type',
  ],

  // Representative values for pair testing (first/most common value per filter)
  pairRepresentativeValues: {
    'businessProfile.seniority': { values: ['cxo'] },
    'businessProfile.department': { values: ['engineering'] },
    'businessProfile.industry': { values: ['Information Technology & Services'] },
    'businessProfile.employeeCount': { values: ['51 to 100'] },
    'profile.incomeRange': { values: ['$75,000 - $99,999'] },
    'profile.netWorth': { values: ['$100,000 to $249,999'] },
    'attributes.credit_rating': { values: ['750-799'] },
    'attributes.education': { values: ["Bachelor's"] },
    'attributes.occupation_group': { values: ['Professional/Technical'] },
    'state': { values: ['california'] },
    'gender': { values: ['Male'] },
    'age': { range: { min: 30, max: 55 } },
    'profile.homeowner': { values: ['Homeowner'] },
    'profile.children': { values: ['Has children'] },
    'attributes.dwelling_type': { values: ['Single-Family'] },
  } as Record<string, { values?: string[]; range?: { min: number | null; max: number | null } }>,

  // Saturation testing
  saturationFilters: [
    { key: 'businessProfile.seniority', values: ['cxo', 'vp', 'director', 'manager', 'staff'] },
    { key: 'businessProfile.department', values: ['engineering', 'sales', 'marketing', 'finance', 'executive', 'operations'] },
    { key: 'state', values: ['florida', 'california', 'texas', 'new york', 'illinois'] },
    { key: 'profile.incomeRange', values: ['Less than $20,000', '$20,000 - $29,999', '$30,000 - $39,999', '$40,000 - $49,999', '$50,000 - $74,999', '$75,000 - $99,999', '$100,000 - $149,999', '$150,000 - $174,999', '$175,000+'] },
    { key: 'attributes.credit_rating', values: ['800+', '750-799', '700-749', '650-699', '600-649', '550-599', '500-549', 'Under 500'] },
  ],

  // Large-cardinality filters: only sample first N values
  largeSampleLimit: 5,
  largeCardinalityThreshold: 20,

  // Known-good filter keys (manually verified via portal)
  knownGoodKeys: [
    'businessProfile.seniority',
    'profile.netWorth',
    'age',
    'gender',
    'profile.married',
    'profile.homeowner',
    'contact.verifiedBusinessEmails',
  ],

  // Max consecutive failures before abort
  maxConsecutiveFailures: 3,
  cooldownMs: 30000,

  // Output
  dataDir: path.resolve(__dirname, '..', '..', '..', 'data', 'filter-explorer'),
};
