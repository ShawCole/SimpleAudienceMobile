/**
 * SINGLE SOURCE OF TRUTH for IntentCore payload filter shapes.
 * When IntentCore adds a new field, update it HERE.
 * Last updated: 2026-04-09
 */

export const ACCOUNT_ID = 'fceffb3b-552d-413a-9442-e62e9d423aa0';
export const WORKSPACE_SLUG = 'simple-audience';

export function blankFilters() {
    return JSON.parse(JSON.stringify({
        age: { minAge: null, maxAge: null },
        city: [], state: [], zip: [], gender: [],
        profile: { incomeRange: [], homeowner: [], married: [], netWorth: [], children: [] },
        businessProfile: {
            companyDescription: [], jobTitle: [], seniority: [], department: [],
            companyName: [], companyDomain: [], industry: [], sic: [],
            employeeCount: [], companyRevenue: [], companyNaics: []
        },
        attributes: {
            credit_rating: [], language_code: [], occupation_group: [], occupation_type: [],
            home_year_built: { min: null, max: null },
            single_parent: [], cra_code: [], dwelling_type: [],
            credit_range_new_credit: [], ethnic_code: [],
            marital_status: [], net_worth: [], education: [],
            credit_card_user: [], investment: [], smoker: [],
            home_purchase_price: { min: null, max: null },
            home_purchase_year: { min: null, max: null },
            home_purchase_month: [], estimated_home_value: [],
            mortgage_amount: { min: null, max: null },
            generations_in_household: [], religion_code: []
        },
        notNulls: [], nullOnly: []
    }));
}

export function buildRST(audienceId) {
    return JSON.stringify(
        ["", { "children": ["home", { "children": [["account", WORKSPACE_SLUG, "d"], { "children": ["audience", { "children": [["id", audienceId, "d"], { "children": ["__PAGE__", {}, null, null] }, null, null] }, null, null] }, null, null] }, null, null] }, null, null, true]
    );
}
