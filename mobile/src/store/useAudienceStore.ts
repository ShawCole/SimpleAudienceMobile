import { create } from 'zustand';
import { produce } from 'immer';
import { AudiencePayload } from '@shared/types/audience-payload';
import { AudienceApi } from '../services/audience';

// --- THE ROSETTA STONE STATE OBJECT ---
// This matches the Partner API payload structure 1:1.
const INITIAL_STATE: AudiencePayload = {
    accountId: "",
    id: "",
    // Optional flags handled by Vacuum, but good to have in type
    hasSegmentChanged: false,
    resolveIntents: true,

    filters: {
        // 1. METADATA
        jobId: "",
        daysBack: null,
        score: [],
        segment: [],

        audience: {
            type: "premade",
            b2b: false,
            customTopic: "",
            customDescription: "",
            segmentSearches: []
        },

        // 2. CORE FILTERS
        filters: {
            // Geography
            city: [],
            state: [],
            zip: [],

            // Demographics
            age: { minAge: null, maxAge: null },
            gender: [],

            // B2C Profile
            profile: {
                incomeRange: [], // "$$75,000..."
                homeowner: [],
                married: [],
                netWorth: [],    // "$$1,000,000..."
                children: []
            },

            // B2B Firmographics
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
                companyNaics: []
            },

            // Attributes (The Long Tail)
            attributes: {
                credit_rating: [],
                language_code: [],
                occupation_group: [],
                occupation_type: [],
                single_parent: [],
                cra_code: [],
                dwelling_type: [],
                credit_range_new_credit: [],
                ethnic_code: [],
                marital_status: [],
                net_worth: [], // Note: API sometimes duplicates this here
                education: [],
                credit_card_user: [],
                investment: [],
                smoker: [],
                estimated_home_value: [],
                generations_in_household: [],

                // Range Objects (MUST be initialized as objects with nulls)
                home_year_built: { min: null, max: null },
                home_purchase_price: { min: null, max: null },
                home_purchase_year: { min: null, max: null },
                mortgage_amount: { min: null, max: null }
            },

            // Toggles
            notNulls: [],
            nullOnly: []
        }
    }
};

interface Store {
    payload: AudiencePayload;
    previewData: any[];
    previewCount: number | null;
    isLoading: boolean;
    error: string | null;

    // NEW: List Management
    audiences: any[];
    totalAudiences: number;
    currentAudience: any | null;

    // NEW: Credits & Context
    credits_remaining: number | null;
    selectedPixelSession: any | null;

    // Actions
    setIds: (accId: string, audId: string) => void;
    reset: () => void;

    // Generic setter for arrays (e.g. seniority, income)
    updateFilter: (
        section: 'profile' | 'businessProfile' | 'attributes',
        field: string,
        value: any
    ) => void;

    // Specific setter for ranges
    updateRange: (
        target: 'age' | 'home_year_built' | 'home_purchase_price' | 'home_purchase_year' | 'mortgage_amount',
        min: number | null,
        max: number | null
    ) => void;

    // Toggle setter
    toggleNotNull: (key: string, active: boolean) => void;

    // API Triggers - Audience Lifecycle
    fetchAudiences: (page?: number, pageSize?: number) => Promise<void>;
    fetchAudienceById: (id: string) => Promise<void>;
    runPreview: () => Promise<void>;
    runGenerate: () => Promise<void>;

    // Helpers
    setCredits: (credits: number) => void;
    setSelectedPixelSession: (session: any) => void;
}

export const useAudienceStore = create<Store>((set, get) => ({
    payload: INITIAL_STATE,
    previewData: [],
    previewCount: null,
    isLoading: false,
    error: null,

    audiences: [],
    totalAudiences: 0,
    currentAudience: null,
    credits_remaining: null,
    selectedPixelSession: null,

    setIds: (accId, audId) => set(produce((state) => {
        state.payload.accountId = accId;
        state.payload.id = audId;
    })),

    reset: () => set({
        payload: INITIAL_STATE,
        previewData: [],
        previewCount: null,
        audiences: [],
        totalAudiences: 0,
        currentAudience: null,
        error: null
    }),

    updateFilter: (section, field, value) => set(produce((state) => {
        // @ts-ignore - Dynamic key access is safe here due to strict typing of 'section'
        state.payload.filters.filters[section][field] = value;
    })),

    updateRange: (target, min, max) => set(produce((state) => {
        if (target === 'age') {
            state.payload.filters.filters.age = { minAge: min, maxAge: max };
        } else {
            // @ts-ignore
            state.payload.filters.filters.attributes[target] = { min, max };
        }
    })),

    toggleNotNull: (key, active) => set(produce((state) => {
        const list = state.payload.filters.filters.notNulls;
        const exists = list.includes(key);

        if (active && !exists) {
            list.push(key);
        } else if (!active && exists) {
            state.payload.filters.filters.notNulls = list.filter((k: string) => k !== key);
        }
    })),

    // --- API CALLS ---

    fetchAudiences: async (page = 1, pageSize = 20) => {
        // We don't set global isLoading to true here to avoid UI flicker during polling
        try {
            const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000'}/api/audiences?page=${page}&pageSize=${pageSize}`);
            const response = await res.json();
            if (response.success) {
                set({
                    audiences: response.data.audiences,
                    totalAudiences: response.data.total
                });
            }
        } catch (err) {
            console.error("Failed to load audiences", err);
            // Optionally set error if it's the first load
            if (get().audiences.length === 0) {
                set({ error: 'Failed to load audiences' });
            }
        }
    },

    fetchAudienceById: async (id: string) => {
        set({ isLoading: true, error: null });
        try {
            const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000'}/api/audiences/${id}`);
            const response = await res.json();
            if (response.success) {
                set({
                    currentAudience: response.data.audience,
                    isLoading: false
                });

                // AUTO-FILL PAYLOAD:
                // When we "Edit" an audience, we want the form to fill with its saved filters
                set(produce((state) => {
                    const audience = response.data.audience;
                    state.payload.filters = audience.filters;
                    state.payload.accountId = audience.accountId || "";
                    state.payload.id = audience.id || "";
                }));
            }
        } catch (err: any) {
            console.error("Failed to fetch audience details", err);
            set({ error: err.message || 'Failed to fetch audience details', isLoading: false });
        }
    },

    runPreview: async () => {
        set({ isLoading: true, error: null });
        try {
            const { payload } = get();
            const response = await AudienceApi.preview(payload);

            set({
                previewData: response.data.preview || [],
                previewCount: response.data.count || 0,
                isLoading: false
            });
        } catch (err: any) {
            console.error("Preview Error:", err);
            set({ error: err.message || 'Preview failed', isLoading: false });
        }
    },

    runGenerate: async () => {
        set({ isLoading: true, error: null });
        try {
            const { payload } = get();
            const response = await AudienceApi.generate(payload);
            set({ isLoading: false });

            // Update credits if returned in response
            if (response.data?.credits_remaining !== undefined) {
                set({ credits_remaining: response.data.credits_remaining });
            }

            alert("Audience generation queued!");
        } catch (err: any) {
            console.error("Generate Error:", err);
            set({ error: err.message || 'Generation failed', isLoading: false });
        }
    },

    setCredits: (credits) => set({ credits_remaining: credits }),

    setSelectedPixelSession: (session) => set({ selectedPixelSession: session })
}));