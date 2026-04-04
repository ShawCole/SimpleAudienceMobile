import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { validatePayload } from '../payload-validator';

// ---------------------------------------------------------------------------
// Shaw's working generate payload (captured tonight)
// ---------------------------------------------------------------------------
const WORKING_PAYLOAD = {
  accountId: 'fceffb3b-552d-413a-9442-e62e9d423aa0',
  audienceId: 'e47344a6-2f57-4a21-87b4-c7cfd4daae8c',
  filters: {
    audience: {
      type: 'premade',
      b2b: 'B2B',
      customTopic: '',
      customDescription: '',
      segmentSearches: [
        'Business & Professional Services > HR & Staffing > Executive Search',
      ],
    },
    jobId: '',
    segment: ['4eyes_117027'],
    score: [],
    daysBack: 7,
    filters: {
      age: { minAge: 30, maxAge: 65 },
      city: [],
      state: [],
      zip: [],
      gender: [],
      profile: {
        incomeRange: [
          '$$100,000 to $149,999',
          '$$150,000 to $199,999',
          '$$200,000 to $249,999',
          '$$250,000+',
        ],
        homeowner: [],
        married: [],
        netWorth: [],
        children: [],
      },
      businessProfile: {
        companyDescription: [],
        jobTitle: [],
        seniority: ['cxo', 'vp', 'director'],
        department: [],
        companyName: [],
        companyDomain: [],
        industry: [],
        sic: [],
        employeeCount: [],
        companyRevenue: [
          '5 Million to 10 Million',
          '1 Million to 5 Million',
          '10 Million to 25 Million',
          '25 Million to 50 Million',
          '50 Million to 100 Million',
          '100 Million to 250 Million',
          '250 Million to 500 Million',
          '500 Million to 1 Billion',
          '1 Billion and Over',
        ],
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
        home_purchase_month: [],
        estimated_home_value: [],
        mortgage_amount: { min: null, max: null },
        generations_in_household: [],
      },
      notNulls: ['PERSONAL_EMAILS_VALIDATION_STATUS'],
      nullOnly: [],
    },
  },
};

// ---------------------------------------------------------------------------
// Test 1: Working payload passes
// ---------------------------------------------------------------------------
describe('payload-validator', () => {
  it('should pass Shaw\'s working generate payload', () => {
    const result = validatePayload(WORKING_PAYLOAD);
    assert.equal(result.valid, true, `Expected valid but got errors: ${JSON.stringify(result.errors, null, 2)}`);
    assert.equal(result.errors.length, 0);
    assert.equal(result.warnings.length, 0);
    assert.equal(result.corrected, undefined);
  });

  // -------------------------------------------------------------------------
  // Test 2: Dollar-formatted companyRevenue should FAIL
  // -------------------------------------------------------------------------
  it('should fail on dollar-formatted companyRevenue', () => {
    const broken = JSON.parse(JSON.stringify(WORKING_PAYLOAD));
    broken.filters.filters.businessProfile.companyRevenue = [
      '$1,000,000 to $2,499,999',
    ];

    const result = validatePayload(broken);
    assert.equal(result.valid, false);
    const revenueError = result.errors.find(
      (e) => e.field === 'filters.filters.businessProfile.companyRevenue',
    );
    assert.ok(revenueError, 'Expected a companyRevenue error');
    assert.ok(
      revenueError.value.includes('$1,000,000'),
      'Error should reference the bad value',
    );
    assert.ok(
      revenueError.validOptions && revenueError.validOptions.length > 0,
      'Should include valid options',
    );
  });

  // -------------------------------------------------------------------------
  // Test 3: Boolean b2b should FAIL
  // -------------------------------------------------------------------------
  it('should fail on boolean b2b', () => {
    const broken = JSON.parse(JSON.stringify(WORKING_PAYLOAD));
    broken.filters.audience.b2b = true;

    const result = validatePayload(broken);
    // It should have an error but also an auto-correction
    const b2bError = result.errors.find(
      (e) => e.field === 'filters.audience.b2b',
    );
    assert.ok(b2bError, 'Expected a b2b error');
    assert.ok(
      b2bError.message.includes('not a boolean'),
      'Error should mention boolean',
    );
    assert.equal(b2bError.autoCorrection, 'B2B');
    // Since it has an auto-correction, `valid` should be true (correctable)
    assert.equal(result.valid, true, 'Should be valid since auto-correctable');
    assert.ok(result.corrected, 'Should have corrected payload');
    assert.equal(result.corrected.filters.audience.b2b, 'B2B');
  });

  // -------------------------------------------------------------------------
  // Test 4: PERSONAL_EMAIL should auto-correct
  // -------------------------------------------------------------------------
  it('should auto-correct PERSONAL_EMAIL to PERSONAL_EMAILS_VALIDATION_STATUS', () => {
    const broken = JSON.parse(JSON.stringify(WORKING_PAYLOAD));
    broken.filters.filters.notNulls = ['PERSONAL_EMAIL'];

    const result = validatePayload(broken);
    // Should be valid because it's auto-correctable
    assert.equal(result.valid, true, 'Should be valid since auto-correctable');
    const notNullError = result.errors.find(
      (e) => e.field === 'filters.filters.notNulls',
    );
    assert.ok(notNullError, 'Expected a notNulls error');
    assert.equal(
      notNullError.autoCorrection,
      'PERSONAL_EMAILS_VALIDATION_STATUS',
    );
    assert.ok(result.corrected, 'Should have corrected payload');
    assert.deepEqual(result.corrected.filters.filters.notNulls, [
      'PERSONAL_EMAILS_VALIDATION_STATUS',
    ]);
  });

  // -------------------------------------------------------------------------
  // Test 5: Non-existent income bucket should FAIL
  // -------------------------------------------------------------------------
  it('should fail on non-existent income bucket $$150,000 to $174,999', () => {
    const broken = JSON.parse(JSON.stringify(WORKING_PAYLOAD));
    broken.filters.filters.profile.incomeRange = ['$$150,000 to $174,999'];

    const result = validatePayload(broken);
    assert.equal(result.valid, false);
    const incomeError = result.errors.find(
      (e) => e.field === 'filters.filters.profile.incomeRange',
    );
    assert.ok(incomeError, 'Expected an incomeRange error');
    assert.equal(incomeError.value, '$$150,000 to $174,999');
    assert.ok(
      incomeError.validOptions && incomeError.validOptions.includes('$$150,000 to $199,999'),
      'Valid options should include the correct single bucket',
    );
  });

  // -------------------------------------------------------------------------
  // Test 6: Age range validation
  // -------------------------------------------------------------------------
  it('should fail when minAge >= maxAge', () => {
    const broken = JSON.parse(JSON.stringify(WORKING_PAYLOAD));
    broken.filters.filters.age = { minAge: 65, maxAge: 30 };

    const result = validatePayload(broken);
    assert.equal(result.valid, false);
    const ageError = result.errors.find(
      (e) => e.field === 'filters.filters.age',
    );
    assert.ok(ageError, 'Expected an age range error');
  });

  it('should fail when age is out of bounds', () => {
    const broken = JSON.parse(JSON.stringify(WORKING_PAYLOAD));
    broken.filters.filters.age = { minAge: 10, maxAge: 65 };

    const result = validatePayload(broken);
    assert.equal(result.valid, false);
    const ageError = result.errors.find(
      (e) => e.field === 'filters.filters.age.minAge',
    );
    assert.ok(ageError, 'Expected a minAge error');
    assert.ok(ageError.message.includes('18'));
  });

  // -------------------------------------------------------------------------
  // Test 7: Invalid score
  // -------------------------------------------------------------------------
  it('should fail on invalid score value', () => {
    const broken = JSON.parse(JSON.stringify(WORKING_PAYLOAD));
    broken.filters.score = ['extreme'];

    const result = validatePayload(broken);
    assert.equal(result.valid, false);
    const scoreError = result.errors.find(
      (e) => e.field === 'filters.score',
    );
    assert.ok(scoreError, 'Expected a score error');
  });

  // -------------------------------------------------------------------------
  // Test 8: Suspicious segmentSearches
  // -------------------------------------------------------------------------
  it('should warn on segmentSearches with ">" without spaces', () => {
    const broken = JSON.parse(JSON.stringify(WORKING_PAYLOAD));
    broken.filters.audience.segmentSearches = [
      'Business & Professional Services>HR & Staffing>Executive Search',
    ];

    const result = validatePayload(broken);
    // Warnings, not errors
    assert.ok(result.warnings.length > 0, 'Expected a warning');
    assert.ok(
      result.warnings[0].message.includes('">"'),
      'Warning should mention ">" separator issue',
    );
  });

  // -------------------------------------------------------------------------
  // Test 9: Empty payload fields pass (no false positives)
  // -------------------------------------------------------------------------
  it('should pass when optional array fields are empty', () => {
    const minimal = JSON.parse(JSON.stringify(WORKING_PAYLOAD));
    minimal.filters.filters.profile.incomeRange = [];
    minimal.filters.filters.businessProfile.companyRevenue = [];
    minimal.filters.filters.businessProfile.seniority = [];
    minimal.filters.filters.notNulls = [];
    minimal.filters.score = [];

    const result = validatePayload(minimal);
    assert.equal(result.valid, true);
    assert.equal(result.errors.length, 0);
  });

  // -------------------------------------------------------------------------
  // Test 10: Multiple errors in one payload
  // -------------------------------------------------------------------------
  it('should catch multiple errors in a single payload', () => {
    const broken = JSON.parse(JSON.stringify(WORKING_PAYLOAD));
    broken.filters.audience.b2b = true; // auto-correctable
    broken.filters.filters.businessProfile.companyRevenue = ['$1M-$5M']; // bad
    broken.filters.filters.profile.incomeRange = ['$$150,000 to $174,999']; // bad

    const result = validatePayload(broken);
    assert.equal(result.valid, false);
    // b2b (auto-correctable) + companyRevenue + incomeRange = 3 errors
    assert.ok(result.errors.length >= 3, `Expected >= 3 errors, got ${result.errors.length}`);
  });
});
