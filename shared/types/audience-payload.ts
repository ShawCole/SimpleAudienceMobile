export interface AudiencePayload {
    // --- IDENTIFIERS ---
    accountId: string;
    id: string;
    name?: string; // Metadata for recovery & display

    // --- GENERATE SPECIFIC FLAGS (Optional) ---
    // These appear in the Generate payload but not always in Preview.
    // We include them here so the Store can manage them.
    hasSegmentChanged?: boolean;
    resolveIntents?: boolean;
    audienceId?: string; // Sometimes the API expects 'audienceId' instead of 'id'

    // --- THE MEGA FILTER OBJECT ---
    filters: {
        // 1. AUDIENCE METADATA
        audience: {
            type: "premade" | "keyword" | "custom";
            b2b: boolean;
            customTopic: string;
            customDescription: string;
            segmentSearches: string[];
        };
        jobId: string;
        segment: string[];
        daysBack: number | null;
        score: string[];

        // 2. THE CORE FILTERS
        filters: {
            // 2a. GEOGRAPHY & DEMOGRAPHICS
            age: {
                minAge: number | null;
                maxAge: number | null;
            };
            city: string[];
            state: string[];
            zip: string[];
            gender: string[];

            // 2b. B2C PROFILE (Personal)
            profile: {
                incomeRange: string[];
                homeowner: string[];
                married: string[];
                netWorth: string[];
                children: string[];
            };

            // 2c. B2B FIRMOGRAPHICS (Professional)
            businessProfile: {
                companyDescription: string[];
                jobTitle: string[];
                seniority: string[];
                department: string[];
                companyName: string[];
                companyDomain: string[];
                industry: string[];
                sic: string[];
                employeeCount: string[];
                companyRevenue: string[];
                companyNaics: string[];
            };

            // 2d. ATTRIBUTES (The Long Tail)
            attributes: {
                credit_rating: string[];
                language_code: string[];
                occupation_group: string[];
                occupation_type: string[];
                home_year_built: { min: number | null; max: number | null };
                single_parent: string[];
                cra_code: string[];
                dwelling_type: string[];
                credit_range_new_credit: string[];
                ethnic_code: string[];
                marital_status: string[];
                net_worth: string[];
                education: string[];
                credit_card_user: string[];
                investment: string[];
                smoker: string[];
                home_purchase_price: { min: number | null; max: number | null };
                home_purchase_year: { min: number | null; max: number | null };
                estimated_home_value: string[];
                mortgage_amount: { min: number | null; max: number | null };
                generations_in_household: string[];
            };

            // 2e. CONTACT TOGGLES
            notNulls: string[];
            nullOnly: string[];
        };
    };
}