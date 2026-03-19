/**
 * Wealth Management Audience Automation
 *
 * Creates 2 new audiences (medium+high, all intent), generates them,
 * and creates segments for all 3 (including existing high-intent audience).
 *
 * Workspace: simple-audience
 * Account: fceffb3b-552d-413a-9442-e62e9d423aa0
 * Topic: Financial Services > Retirement & College Savings > Wealth Management Services
 * Segment: [] for first generate; server assigns 4eyes_ ID after generation
 *
 * Usage:
 *   node tools/wealth-mgmt-automation.mjs --step discover     # List audiences, confirm state
 *   node tools/wealth-mgmt-automation.mjs --step create       # Create 2 new audiences
 *   node tools/wealth-mgmt-automation.mjs --step generate     # Generate all audiences (sets filters + generates)
 *   node tools/wealth-mgmt-automation.mjs --step segment      # Create segments for all 3
 *   node tools/wealth-mgmt-automation.mjs --step all          # Run full pipeline
 */

import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// Load .env
const envContent = fs.readFileSync(path.join(ROOT, 'backend', '.env'), 'utf8');
const env = {};
for (const line of envContent.split('\n')) {
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (match) env[match[1].trim()] = match[2].trim();
}

puppeteer.default.use(StealthPlugin());

// ── CONSTANTS ──
const BASE_URL = env.SIMPLEAUDIENCE_BASE_URL || 'https://app.intentcore.io';
const EMAIL = env.SIMPLEAUDIENCE_EMAIL;
const PASSWORD = env.SIMPLEAUDIENCE_PASSWORD;
const USER_DATA_DIR = path.join(ROOT, 'tools', '.chrome-wealth-mgmt-profile');
const CAPTURES_DIR = path.join(ROOT, 'tools', 'captures');
const STATE_FILE = path.join(CAPTURES_DIR, 'wealth-mgmt-state.json');

if (!fs.existsSync(CAPTURES_DIR)) fs.mkdirSync(CAPTURES_DIR, { recursive: true });

const WORKSPACE_SLUG = 'simple-audience';
const ACCOUNT_ID = 'fceffb3b-552d-413a-9442-e62e9d423aa0';

// Server action IDs — verified stable across deployments dpl_9cFr... and dpl_3Jq2...
// Action IDs do NOT always change with deployments. If requests return 404, re-capture from DevTools.
const ACTIONS = {
    PREVIEW: '7f2fedc1659914fecb5d57837dc4b06ab5c2e0e744',
    GENERATE: '7f437ee100a328c3149f7f41b6ef0aa67929d43bcc',
    // Below are from previous deployment — may need re-capture
    CREATE_AUDIENCE: '7ffaba0e7b99bdefb0ee5b9715f0f99be2eb57cfbf',
    DUPLICATE_AUDIENCE: '7f7620828df3050d098061a2f792b779c06efdf8b6',
    CREATE_SEGMENT: '7f64516de2ed77be9587cc5061f2316ee744572e54',
    REFRESH_SEGMENTS: '7f49946c32557ba99e76fec1652748b6b42fa23fda',
    SELECT_SEGMENT: '7fb0ef6facb6a60db9198ecbf459eff7091a73eb95',
};

// Segment column config (37 selected, 5 "Only First")
const SELECTED_FIELDS = [
    "AGE_RANGE", "CHILDREN", "COMPANY_NAME", "PERSONAL_VERIFIED_EMAILS",
    "BUSINESS_VERIFIED_EMAILS", "EDUCATION_HISTORY", "FACEBOOK_URL", "TWITTER_URL",
    "FIRST_NAME", "GENDER", "INCOME_RANGE", "JOB_TITLE", "LAST_NAME", "LINKEDIN_URL",
    "MARRIED", "MOBILE_PHONE", "MOBILE_PHONE_DNC", "NET_WORTH", "PERSONAL_ADDRESS",
    "PERSONAL_CITY", "PERSONAL_PHONE", "PERSONAL_PHONE_DNC", "PERSONAL_STATE",
    "PERSONAL_ZIP", "PERSONAL_ZIP4", "SENIORITY_LEVEL", "SHA256_PERSONAL_EMAIL",
    "SKIPTRACE_ADDRESS", "SKIPTRACE_CITY", "SKIPTRACE_CREDIT_RATING", "SKIPTRACE_DNC",
    "SKIPTRACE_LANGUAGE_CODE", "SKIPTRACE_NAME", "SKIPTRACE_STATE",
    "SKIPTRACE_WIRELESS_NUMBERS", "SKIPTRACE_ZIP", "UUID", "VALID_PHONES"
];
const ONLY_FIRST_VALUE_FIELDS = [
    "MOBILE_PHONE", "MOBILE_PHONE_DNC", "PERSONAL_PHONE",
    "PERSONAL_PHONE_DNC", "VALID_PHONES"
];

// ── AUDIENCE DEFINITIONS ──
// Each audience is a SEPARATE intent tier (not combined)
const AUDIENCES = [
    {
        key: 'high',
        name: 'WM HNW - High Intent',
        score: ['high'],
        expectedCount: '~15,000',
        existingId: '5126c098-ec93-41bb-81ee-b40e24402050',
        segmentName: 'WM HNW - High Intent'
    },
    {
        key: 'medium',
        name: 'WM HNW - Medium Intent',
        score: ['medium'],
        expectedCount: '~23,000',
        existingId: 'fea95853-96ce-4454-bed1-0d2580b49d0f',
        segmentName: 'WM HNW - Medium Intent'
    },
    {
        key: 'low',
        name: 'WM HNW - Low Intent',
        score: ['low'],
        expectedCount: '~500,000',
        existingId: null,
        segmentName: 'WM HNW - Low Intent'
    }
];

// Common filter template — verified against 8 manual captures (2026-03-06)
// NOTE: `score` is a sibling of `daysBack` (inside `filters`, NOT inside `filters.filters`)
// NOTE: `segment` is server-side audience state. The client echoes whatever the server stored from last generate.
//        Safe to always send [] — server ignores it and uses segmentSearches to determine topic.
//        After generate, server assigns a stable per-topic 4eyes_ ID (e.g. 4eyes_101950 = WM Services,
//        4eyes_122122 = Management Consulting, 4eyes_121448 = Computer Telephony Integration).
// NOTE: netWorth uses formatCurrencyLabel() — values starting with $ get prepended $ ("$500,000" → "$$500,000"), letter-start unchanged ("more than $1,000,000")
function buildFilters(scoreValues, segment = []) {
    return {
        audience: {
            type: "premade",
            b2b: null,
            customTopic: "",
            customDescription: "",
            segmentSearches: ["Financial Services > Retirement & College Savings > Wealth Management Services"]
        },
        jobId: "",
        segment: segment,
        score: scoreValues,
        daysBack: 7,
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
                netWorth: ["$$500,000 to $749,999", "$$750,000 to $999,999", "more than $1,000,000"],
                children: []
            },
            businessProfile: {
                companyDescription: [], jobTitle: [], seniority: [],
                department: [], companyName: [], companyDomain: [],
                industry: [], sic: [], employeeCount: [],
                companyRevenue: [], companyNaics: []
            },
            attributes: {
                credit_rating: [], language_code: [], occupation_group: [],
                occupation_type: [],
                home_year_built: { min: null, max: null },
                single_parent: [], cra_code: [], dwelling_type: [],
                credit_range_new_credit: [], ethnic_code: [],
                marital_status: [], net_worth: [], education: [],
                credit_card_user: [], investment: [], smoker: [],
                home_purchase_price: { min: null, max: null },
                home_purchase_year: { min: null, max: null },
                home_purchase_month: [],
                estimated_home_value: [],
                mortgage_amount: { min: null, max: null },
                generations_in_household: []
            },
            notNulls: [],
            nullOnly: []
        }
    };
}

function buildRouterStateTree(pageType, audienceId) {
    if (pageType === 'audience') {
        return JSON.stringify(
            ["", { "children": ["home", { "children": [["account", WORKSPACE_SLUG, "d"], { "children": ["audience", { "children": [["id", audienceId, "d"], { "children": ["__PAGE__", {}, null, null] }, null, null] }, null, null] }, null, null] }, null, null] }, null, null, true]
        );
    }
    if (pageType === 'studio') {
        return JSON.stringify(
            ["", { "children": ["home", { "children": [["account", WORKSPACE_SLUG, "d"], { "children": ["studio", { "children": ["__PAGE__", {}, null, null] }, null, null] }, null, null] }, null, null] }, null, null, true]
        );
    }
    // audiences list
    return JSON.stringify(
        ["", { "children": ["home", { "children": [["account", WORKSPACE_SLUG, "d"], { "children": ["audience", { "children": ["__PAGE__", {}, null, null] }, null, null] }, null, null] }, null, null] }, null, null, true]
    );
}

// Load/save state for resumability
function loadState() {
    if (fs.existsSync(STATE_FILE)) {
        return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    }
    return { audiences: {}, segments: {}, syncs: {} };
}
function saveState(state) {
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

// ── BROWSER HELPERS ──

async function login(page) {
    console.log('LOGIN: Navigating to sign-in...');
    await page.goto(`${BASE_URL}/auth/sign-in`, { waitUntil: 'load', timeout: 30000 });

    if (page.url().includes('sign-in')) {
        await page.waitForSelector('input[type="email"]', { visible: true, timeout: 10000 });
        await page.type('input[type="email"]', EMAIL, { delay: 50 });
        await page.waitForSelector('input[type="password"]', { visible: true, timeout: 5000 });
        await page.type('input[type="password"]', PASSWORD, { delay: 50 });
        await Promise.all([
            page.waitForNavigation({ waitUntil: 'load', timeout: 30000 }),
            page.click('button[type="submit"]')
        ]);
        console.log('   ✅ Logged in.');
    } else {
        console.log('   ✅ Already authenticated.');
    }

    // Navigate into workspace if on selector page
    if (page.url() === `${BASE_URL}/home` || page.url() === `${BASE_URL}/home/`) {
        console.log('   Selecting workspace...');
        await page.evaluate((slug) => {
            const links = Array.from(document.querySelectorAll('a'));
            const target = links.find(a => a.href.includes(`/home/${slug}`));
            if (target) target.click();
        }, WORKSPACE_SLUG);
        await page.waitForNavigation({ waitUntil: 'load', timeout: 30000 }).catch(() => {});
        await page.waitForTimeout(2000);
    }

    console.log(`   📍 URL: ${page.url()}\n`);
}

let DEPLOYMENT_ID = 'dpl_3Jq2xYTjAQXwfkA9Pv9W1ZB2Sj27';

// Auto-detect deployment ID from current page
async function detectDeploymentId(page) {
    const detected = await page.evaluate(() => {
        // Method 1: search page source for dpl_ pattern
        const html = document.documentElement.outerHTML;
        const match = html.match(/dpl_[A-Za-z0-9]+/);
        return match ? match[0] : null;
    });

    if (detected && detected !== DEPLOYMENT_ID) {
        console.log(`🔄 Deployment ID changed: ${DEPLOYMENT_ID} → ${detected}`);
        DEPLOYMENT_ID = detected;
    } else if (detected) {
        console.log(`✅ Deployment ID confirmed: ${detected}`);
    } else {
        // Method 2: fetch the page and check response headers
        const fromHeaders = await page.evaluate(async () => {
            try {
                const res = await fetch(window.location.href, { method: 'HEAD' });
                return res.headers.get('x-deployment-id');
            } catch { return null; }
        });
        if (fromHeaders) {
            console.log(`🔄 Deployment ID from headers: ${fromHeaders}`);
            DEPLOYMENT_ID = fromHeaders;
        } else {
            console.log(`⚠️  Could not detect deployment ID. Using cached: ${DEPLOYMENT_ID}`);
        }
    }
    return DEPLOYMENT_ID;
}

// Capture action IDs from the page's JS bundles (Next.js embeds them)
async function detectActionIds(page) {
    console.log('🔍 Scanning for action IDs in page source...');

    // Intercept the next server action to capture the real action ID
    // For now, try to find them in the __next_f data or script tags
    const actionIds = await page.evaluate(() => {
        const scripts = Array.from(document.querySelectorAll('script'));
        const ids = {};
        for (const script of scripts) {
            const src = script.textContent || '';
            // Next.js server action IDs are 40-char hex strings prefixed with 7f
            const matches = src.matchAll(/["']?(7f[0-9a-f]{38,42})["']?/g);
            for (const m of matches) {
                ids[m[1]] = true;
            }
        }
        return Object.keys(ids);
    });

    if (actionIds.length > 0) {
        console.log(`   Found ${actionIds.length} action ID(s) in page scripts:`);
        actionIds.forEach(id => console.log(`   - ${id}`));
    }
    return actionIds;
}

async function serverAction(page, pathname, actionId, payload, routerStateTree) {
    // Router state tree MUST be URL-encoded per Next.js client convention
    const encodedRst = encodeURIComponent(routerStateTree);
    return page.evaluate(async (pn, aid, pl, rst, depId) => {
        try {
            const res = await fetch(pn, {
                method: 'POST',
                headers: {
                    'accept': 'text/x-component',
                    'content-type': 'text/plain;charset=UTF-8',
                    'next-action': aid,
                    'next-router-state-tree': rst,
                    'x-deployment-id': depId,
                },
                body: JSON.stringify(pl)
            });
            const text = await res.text();
            return { status: res.status, ok: res.ok, text };
        } catch (e) {
            return { error: e.message };
        }
    }, pathname, actionId, payload, encodedRst, DEPLOYMENT_ID);
}

// ── STEP: CREATE AUDIENCES ──

async function createAudiences(page) {
    console.log('═'.repeat(60));
    console.log('  STEP: CREATE AUDIENCES');
    console.log('═'.repeat(60));
    console.log('');

    const state = loadState();
    const audiencesUrl = `${BASE_URL}/home/${WORKSPACE_SLUG}/audience`;

    for (const aud of AUDIENCES) {
        if (aud.existingId) {
            console.log(`[${aud.key}] Already exists: ${aud.existingId} (${aud.name})`);
            state.audiences[aud.key] = { id: aud.existingId, name: aud.name, status: 'existing' };
            saveState(state);
            continue;
        }

        if (state.audiences[aud.key]?.id) {
            console.log(`[${aud.key}] Already created in previous run: ${state.audiences[aud.key].id}`);
            continue;
        }

        console.log(`[${aud.key}] Creating audience: "${aud.name}"...`);

        // Navigate to audiences page
        await page.goto(audiencesUrl, { waitUntil: 'load', timeout: 30000 });
        await page.waitForTimeout(3000);

        // Click Create button
        const createClicked = await page.evaluate(() => {
            const buttons = Array.from(document.querySelectorAll('button, a'));
            const btn = buttons.find(b => b.textContent?.trim() === 'Create');
            if (btn) { btn.click(); return true; }
            return false;
        });

        if (!createClicked) {
            console.log(`   ❌ Could not find Create button!`);
            continue;
        }

        console.log('   Clicked Create button. Waiting for dialog...');
        await page.waitForTimeout(2000);

        // Type name into the dialog input
        const nameInput = await page.waitForSelector('div[role="dialog"] form input[name="name"], div[role="dialog"] input', { visible: true, timeout: 10000 });
        if (nameInput) {
            await nameInput.click({ clickCount: 3 }); // select all
            await nameInput.type(aud.name, { delay: 30 });
            console.log(`   Typed name: "${aud.name}"`);
        } else {
            console.log('   ❌ Could not find name input in dialog!');
            continue;
        }

        await page.waitForTimeout(500);

        // Click the Create/Submit button in the dialog
        const submitClicked = await page.evaluate(() => {
            const dialog = document.querySelector('div[role="dialog"]');
            if (!dialog) return false;
            const buttons = Array.from(dialog.querySelectorAll('button'));
            const submit = buttons.find(b => {
                const text = b.textContent?.trim();
                return text === 'Create' || text === 'Submit' || b.type === 'submit';
            });
            if (submit) { submit.click(); return true; }
            return false;
        });

        if (!submitClicked) {
            // Try XPath fallback
            const xpathSubmit = await page.$('::-p-xpath(//form//button[contains(@class, "bg-primary") and normalize-space()="Create"])');
            if (xpathSubmit) {
                await xpathSubmit.click();
                console.log('   Clicked Create via XPath fallback');
            } else {
                console.log('   ❌ Could not find Submit button in dialog!');
                continue;
            }
        } else {
            console.log('   Clicked Create in dialog');
        }

        // Wait for navigation to the new audience page
        await page.waitForNavigation({ waitUntil: 'load', timeout: 30000 }).catch(() => {});
        await page.waitForTimeout(3000);

        // Extract audience ID from URL
        const newUrl = page.url();
        const newIdMatch = newUrl.match(/\/audience\/([0-9a-f-]+)/);
        if (newIdMatch) {
            const newId = newIdMatch[1];
            console.log(`   ✅ Created! ID: ${newId}`);
            console.log(`   📍 URL: ${newUrl}`);
            state.audiences[aud.key] = { id: newId, name: aud.name, status: 'created' };
            saveState(state);
        } else {
            console.log(`   ⚠️  Could not extract audience ID from URL: ${newUrl}`);
            // Try to find it on the page
            const pageSource = await page.content();
            const fallback = pageSource.match(/audience\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/);
            if (fallback) {
                state.audiences[aud.key] = { id: fallback[1], name: aud.name, status: 'created' };
                saveState(state);
                console.log(`   Found ID in page source: ${fallback[1]}`);
            }
        }

        console.log('');
    }

    console.log('CREATE COMPLETE. State:');
    for (const aud of AUDIENCES) {
        const s = state.audiences[aud.key];
        console.log(`   [${aud.key}] ${s?.id || 'NOT CREATED'} — ${s?.status || 'unknown'}`);
    }
    console.log('');
}

// ── STEP: GENERATE AUDIENCES ──

async function generateAudiences(page) {
    console.log('═'.repeat(60));
    console.log('  STEP: GENERATE AUDIENCES');
    console.log('═'.repeat(60));
    console.log('');

    const state = loadState();

    // Skip low intent by default (~500k records, too large for client-side dashboard)
    const SKIP_KEYS = ['low'];

    for (const aud of AUDIENCES) {
        if (SKIP_KEYS.includes(aud.key)) {
            console.log(`[${aud.key}] Skipping (in SKIP_KEYS list — too large for client-side)\n`);
            continue;
        }

        const audienceId = state.audiences[aud.key]?.id || aud.existingId;
        if (!audienceId) {
            console.log(`[${aud.key}] ❌ No audience ID — run create step first`);
            continue;
        }

        if (state.audiences[aud.key]?.status === 'generated') {
            console.log(`[${aud.key}] Already generated in previous run. Skipping. (Set status to 'needs-regenerate' to re-run.)`);
            continue;
        }

        const isRegenerate = state.audiences[aud.key]?.status === 'needs-regenerate';
        if (isRegenerate) {
            console.log(`[${aud.key}] Re-generating with updated filters...`);
        }

        console.log(`[${aud.key}] Generating: "${aud.name}" (${audienceId})`);
        console.log(`   Score: ${JSON.stringify(aud.score)}`);
        console.log(`   Expected: ${aud.expectedCount}`);

        // Navigate to audience page
        const audienceUrl = `${BASE_URL}/home/${WORKSPACE_SLUG}/audience/${audienceId}`;
        await page.goto(audienceUrl, { waitUntil: 'networkidle2', timeout: 60000 });
        await page.waitForTimeout(5000);

        const filters = buildFilters(aud.score);
        const routerState = buildRouterStateTree('audience', audienceId);

        // ── PREVIEW first (safe, read-only) ──
        console.log('   📊 Running Preview...');
        const previewPayload = [{
            accountId: ACCOUNT_ID,
            id: audienceId,
            filters: filters
        }];

        const previewResult = await serverAction(
            page,
            `/home/${WORKSPACE_SLUG}/audience/${audienceId}`,
            ACTIONS.PREVIEW,
            previewPayload,
            routerState
        );

        if (previewResult.error) {
            console.log(`   ❌ Preview error: ${previewResult.error}`);
            continue;
        }

        console.log(`   Preview response: ${previewResult.status} (ok: ${previewResult.ok})`);

        // Extract count from preview
        const countMatch = previewResult.text?.match(/"count"\s*:\s*(\d+)/);
        const rowMatch = previewResult.text?.match(/"row_count"\s*:\s*(\d+)/);
        const previewCount = countMatch?.[1] || rowMatch?.[1] || 'unknown';
        console.log(`   📊 Preview count: ${previewCount}`);

        if (previewResult.status === 404) {
            console.log('   ⚠️  404 — server action ID may be stale. Needs re-capture from DevTools.');
            continue;
        }

        // ── GENERATE ──
        console.log('   ⚡ Running Generate...');
        const generatePayload = [{
            accountId: ACCOUNT_ID,
            audienceId: audienceId,
            filters: filters,
            hasSegmentChanged: false,
            resolveIntents: true
        }];

        const generateResult = await serverAction(
            page,
            `/home/${WORKSPACE_SLUG}/audience/${audienceId}`,
            ACTIONS.GENERATE,
            generatePayload,
            routerState
        );

        if (generateResult.error) {
            console.log(`   ❌ Generate error: ${generateResult.error}`);
            continue;
        }

        console.log(`   Generate response: ${generateResult.status} (ok: ${generateResult.ok})`);

        if (generateResult.ok) {
            console.log(`   ✅ Generate submitted for "${aud.name}"`);
            state.audiences[aud.key] = {
                ...state.audiences[aud.key],
                status: 'generated',
                previewCount,
                generatedAt: new Date().toISOString()
            };
            saveState(state);
        } else {
            console.log(`   ⚠️  Generate returned ${generateResult.status}`);
            console.log(`   Response: ${generateResult.text?.substring(0, 300)}`);

            if (generateResult.status === 404) {
                console.log('   ⚠️  404 — server action ID may be stale.');
            }
        }

        // Save raw response for debugging
        const debugFile = path.join(CAPTURES_DIR, `wm-generate-${aud.key}.json`);
        fs.writeFileSync(debugFile, JSON.stringify({
            audience: aud,
            audienceId,
            previewResult: { status: previewResult.status, ok: previewResult.ok, text: previewResult.text?.substring(0, 3000) },
            generateResult: { status: generateResult.status, ok: generateResult.ok, text: generateResult.text?.substring(0, 3000) }
        }, null, 2));
        console.log(`   💾 Debug saved to ${debugFile}`);

        // Wait between audiences (be polite to the platform)
        console.log('   ⏳ Waiting 10s before next audience...\n');
        await page.waitForTimeout(10000);
    }

    console.log('GENERATE COMPLETE. State:');
    for (const aud of AUDIENCES) {
        const s = state.audiences[aud.key];
        console.log(`   [${aud.key}] ${s?.id || 'N/A'} — ${s?.status || 'unknown'} — count: ${s?.previewCount || 'N/A'}`);
    }
    console.log('');
}

// ── STEP: CREATE SEGMENTS ──

async function createSegments(page) {
    console.log('═'.repeat(60));
    console.log('  STEP: CREATE SEGMENTS');
    console.log('═'.repeat(60));
    console.log('');

    const state = loadState();

    // Navigate to studio to establish page context
    const studioUrl = `${BASE_URL}/home/${WORKSPACE_SLUG}/studio`;
    await page.goto(studioUrl, { waitUntil: 'load', timeout: 30000 });
    await page.waitForTimeout(5000);

    const routerState = buildRouterStateTree('studio');

    for (const aud of AUDIENCES) {
        const audienceId = state.audiences[aud.key]?.id || aud.existingId;
        if (!audienceId) {
            console.log(`[${aud.key}] ❌ No audience ID — run create step first`);
            continue;
        }

        if (state.segments[aud.key]?.id) {
            console.log(`[${aud.key}] Segment already created: ${state.segments[aud.key].id}`);
            continue;
        }

        const rowCount = parseInt(state.audiences[aud.key]?.previewCount) || 0;

        console.log(`[${aud.key}] Creating segment: "${aud.segmentName}"`);
        console.log(`   Audience ID: ${audienceId}`);
        console.log(`   Row count: ${rowCount}`);

        const segmentPayload = [{
            name: aud.segmentName,
            description: "",
            filters: { id: "root", operator: "AND", rules: [] },
            selectedFields: SELECTED_FIELDS,
            onlyFirstValueFields: ONLY_FIRST_VALUE_FIELDS,
            rowCount: rowCount,
            audienceId: audienceId,
            pixelId: "$undefined",
            accountId: ACCOUNT_ID
        }];

        const result = await serverAction(
            page,
            `/home/${WORKSPACE_SLUG}/studio`,
            ACTIONS.CREATE_SEGMENT,
            segmentPayload,
            routerState
        );

        console.log(`   Response: ${result.status} (ok: ${result.ok})`);

        if (result.error) {
            console.log(`   ❌ Error: ${result.error}`);
            continue;
        }

        // Extract segment ID from RSC response
        const segIdMatch = result.text?.match(/"id"\s*:\s*"([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})"/);
        const nameFound = result.text?.includes(aud.segmentName);

        if (result.ok) {
            const segId = segIdMatch?.[1] || null;
            console.log(`   ✅ Segment created! ID: ${segId || 'unknown'}`);
            console.log(`   Name in response: ${nameFound}`);
            state.segments[aud.key] = {
                id: segId,
                name: aud.segmentName,
                audienceId,
                createdAt: new Date().toISOString()
            };
            saveState(state);
        } else {
            console.log(`   ⚠️  Response: ${result.text?.substring(0, 500)}`);
            if (result.status === 404) {
                console.log('   ⚠️  404 — server action ID may be stale.');
            }
        }

        // Save debug output
        const debugFile = path.join(CAPTURES_DIR, `wm-segment-${aud.key}.json`);
        fs.writeFileSync(debugFile, JSON.stringify({
            audience: aud,
            audienceId,
            rowCount,
            result: { status: result.status, ok: result.ok, text: result.text?.substring(0, 5000) },
            segmentId: segIdMatch?.[1] || null,
            nameFound
        }, null, 2));

        // Brief pause between segments
        await page.waitForTimeout(3000);
        console.log('');
    }

    console.log('SEGMENT CREATION COMPLETE. State:');
    for (const aud of AUDIENCES) {
        const s = state.segments[aud.key];
        console.log(`   [${aud.key}] Segment: ${s?.id || 'NOT CREATED'} — ${s?.name || 'N/A'}`);
    }
    console.log('');
}

// ── STEP: DISCOVER (list current state) ──

async function discover(page) {
    console.log('═'.repeat(60));
    console.log('  STEP: DISCOVER CURRENT STATE');
    console.log('═'.repeat(60));
    console.log('');

    const state = loadState();

    // List audiences
    const audiencesUrl = `${BASE_URL}/home/${WORKSPACE_SLUG}/audience`;
    await page.goto(audiencesUrl, { waitUntil: 'load', timeout: 30000 });
    await page.waitForTimeout(4000);

    const audiences = await page.evaluate(() => {
        const rows = [];
        document.querySelectorAll('table tbody tr').forEach(row => {
            const cells = Array.from(row.querySelectorAll('td'));
            const link = Array.from(row.querySelectorAll('a')).find(a => a.href.includes('/audience/'));
            rows.push({
                name: cells[0]?.textContent?.trim(),
                status: cells[1]?.textContent?.trim(),
                created: cells[2]?.textContent?.trim(),
                updated: cells[3]?.textContent?.trim(),
                count: cells[4]?.textContent?.trim(),
                segments: cells[5]?.textContent?.trim(),
                audienceId: link?.href.match(/\/audience\/([0-9a-f-]+)/)?.[1]
            });
        });
        return rows;
    });

    console.log(`Found ${audiences.length} audiences:\n`);
    audiences.forEach((a, i) => {
        const isOurs = AUDIENCES.some(def =>
            def.existingId === a.audienceId ||
            state.audiences[def.key]?.id === a.audienceId
        );
        const marker = isOurs ? '  ★' : '   ';
        console.log(`${marker} [${i}] ${a.name}`);
        console.log(`      ID: ${a.audienceId} | Status: ${a.status} | Count: ${a.count} | Segments: ${a.segments}`);
    });

    // List segments
    console.log('');
    const segmentsUrl = `${BASE_URL}/home/${WORKSPACE_SLUG}/segment`;
    await page.goto(segmentsUrl, { waitUntil: 'load', timeout: 30000 });
    await page.waitForTimeout(4000);

    const segments = await page.evaluate(() => {
        const rows = [];
        document.querySelectorAll('table tbody tr').forEach(row => {
            const cells = Array.from(row.querySelectorAll('td'));
            rows.push({
                name: cells[0]?.textContent?.trim(),
                source: cells[1]?.textContent?.trim(),
                type: cells[2]?.textContent?.trim(),
                count: cells[3]?.textContent?.trim(),
                created: cells[4]?.textContent?.trim()
            });
        });
        return rows;
    });

    console.log(`Found ${segments.length} segments:\n`);
    segments.forEach((s, i) => {
        const isOurs = AUDIENCES.some(def => def.segmentName === s.name);
        const marker = isOurs ? '  ★' : '   ';
        console.log(`${marker} [${i}] ${s.name} | Source: ${s.source} | Count: ${s.count}`);
    });

    console.log('\nSaved state:');
    console.log(JSON.stringify(state, null, 2));
    console.log('');
}

// ── STEP: QUICK (ad-hoc create + preview + generate) ──

async function quickCreateAndGenerate(page, audienceName, scoreValues) {
    console.log('═'.repeat(60));
    console.log('  STEP: QUICK CREATE + PREVIEW + GENERATE');
    console.log(`  Name: "${audienceName}"`);
    console.log(`  Score: ${JSON.stringify(scoreValues)}`);
    console.log('═'.repeat(60));
    console.log('');

    // ── CREATE ──
    const audiencesUrl = `${BASE_URL}/home/${WORKSPACE_SLUG}/audience`;
    await page.goto(audiencesUrl, { waitUntil: 'load', timeout: 30000 });
    await page.waitForTimeout(3000);

    const createClicked = await page.evaluate(() => {
        const buttons = Array.from(document.querySelectorAll('button, a'));
        const btn = buttons.find(b => b.textContent?.trim() === 'Create');
        if (btn) { btn.click(); return true; }
        return false;
    });

    if (!createClicked) {
        console.log('❌ Could not find Create button on audiences page!');
        return;
    }

    console.log('Clicked Create. Waiting for dialog...');
    await page.waitForTimeout(2000);

    const nameInput = await page.waitForSelector('div[role="dialog"] form input[name="name"], div[role="dialog"] input', { visible: true, timeout: 10000 });
    if (nameInput) {
        await nameInput.click({ clickCount: 3 });
        await nameInput.type(audienceName, { delay: 30 });
        console.log(`Typed name: "${audienceName}"`);
    } else {
        console.log('❌ Could not find name input in dialog!');
        return;
    }

    await page.waitForTimeout(500);

    const submitClicked = await page.evaluate(() => {
        const dialog = document.querySelector('div[role="dialog"]');
        if (!dialog) return false;
        const buttons = Array.from(dialog.querySelectorAll('button'));
        const submit = buttons.find(b => {
            const text = b.textContent?.trim();
            return text === 'Create' || text === 'Submit' || b.type === 'submit';
        });
        if (submit) { submit.click(); return true; }
        return false;
    });

    if (!submitClicked) {
        console.log('❌ Could not find Submit button in dialog!');
        return;
    }

    console.log('Clicked Create in dialog. Waiting for navigation...');
    await page.waitForNavigation({ waitUntil: 'load', timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(3000);

    const newUrl = page.url();
    const idMatch = newUrl.match(/\/audience\/([0-9a-f-]+)/);
    if (!idMatch) {
        console.log(`❌ Could not extract audience ID from URL: ${newUrl}`);
        return;
    }

    const audienceId = idMatch[1];
    console.log(`✅ Created! ID: ${audienceId}`);
    console.log(`📍 URL: ${newUrl}\n`);

    // Wait for page to fully load before injection
    await page.waitForTimeout(3000);

    // Auto-detect deployment ID from current page
    await detectDeploymentId(page);
    const pageActionIds = await detectActionIds(page);

    const filters = buildFilters(scoreValues);
    const routerState = buildRouterStateTree('audience', audienceId);

    // ── PREVIEW ──
    console.log('📊 Running Preview injection...');
    const previewPayload = [{
        accountId: ACCOUNT_ID,
        id: audienceId,
        filters: filters
    }];

    const previewResult = await serverAction(
        page,
        `/home/${WORKSPACE_SLUG}/audience/${audienceId}`,
        ACTIONS.PREVIEW,
        previewPayload,
        routerState
    );

    if (previewResult.error) {
        console.log(`❌ Preview error: ${previewResult.error}`);
        return;
    }

    console.log(`Preview response: ${previewResult.status} (ok: ${previewResult.ok})`);

    if (!previewResult.ok) {
        console.log(`⚠️  Preview failed. Response: ${previewResult.text?.substring(0, 500)}`);
        if (previewResult.status === 404) {
            console.log('⚠️  404 — action ID may be stale. Re-capture from DevTools.');
        }
        return;
    }

    const countMatch = previewResult.text?.match(/"count"\s*:\s*(\d+)/);
    const previewCount = countMatch?.[1] || 'unknown';
    console.log(`📊 Preview count: ${previewCount}\n`);

    // ── GENERATE ──
    console.log('⚡ Running Generate injection...');
    const generatePayload = [{
        accountId: ACCOUNT_ID,
        audienceId: audienceId,
        filters: filters,
        hasSegmentChanged: true,
        resolveIntents: true
    }];

    const generateResult = await serverAction(
        page,
        `/home/${WORKSPACE_SLUG}/audience/${audienceId}`,
        ACTIONS.GENERATE,
        generatePayload,
        routerState
    );

    if (generateResult.error) {
        console.log(`❌ Generate error: ${generateResult.error}`);
        return;
    }

    console.log(`Generate response: ${generateResult.status} (ok: ${generateResult.ok})`);

    if (generateResult.ok) {
        console.log(`✅ Generated! "${audienceName}" — count: ${previewCount}`);
    } else {
        console.log(`⚠️  Generate returned ${generateResult.status}`);
        console.log(`Response: ${generateResult.text?.substring(0, 500)}`);
    }

    // Save debug output
    const debugFile = path.join(CAPTURES_DIR, `wm-quick-${Date.now()}.json`);
    fs.writeFileSync(debugFile, JSON.stringify({
        audienceName,
        audienceId,
        scoreValues,
        previewResult: { status: previewResult.status, ok: previewResult.ok, text: previewResult.text?.substring(0, 3000) },
        generateResult: { status: generateResult.status, ok: generateResult.ok, text: generateResult.text?.substring(0, 3000) },
        previewCount
    }, null, 2));
    console.log(`💾 Debug saved to ${debugFile}\n`);
}

// ── MAIN ──

async function main() {
    const step = process.argv.find(a => a.startsWith('--step'))?.split('=')?.[1]
        || process.argv[process.argv.indexOf('--step') + 1]
        || 'discover';

    console.log('═'.repeat(60));
    console.log(`  WEALTH MANAGEMENT AUDIENCE AUTOMATION`);
    console.log(`  Step: ${step}`);
    console.log(`  Workspace: ${WORKSPACE_SLUG}`);
    console.log(`  Account: ${ACCOUNT_ID}`);
    console.log('═'.repeat(60));
    console.log('');

    // Clean stale lock
    const lockFile = path.join(USER_DATA_DIR, 'SingletonLock');
    if (fs.existsSync(lockFile)) fs.unlinkSync(lockFile);

    const browser = await puppeteer.default.launch({
        executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        headless: false,
        userDataDir: USER_DATA_DIR,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1400,1024'],
        defaultViewport: null
    });

    const page = await browser.newPage();
    await login(page);

    try {
        switch (step) {
            case 'discover':
                await discover(page);
                break;
            case 'create':
                await createAudiences(page);
                break;
            case 'generate':
                await generateAudiences(page);
                break;
            case 'segment':
                await createSegments(page);
                break;
            case 'all':
                await createAudiences(page);
                await generateAudiences(page);
                console.log('⏳ Waiting 30s for generation processing...\n');
                await page.waitForTimeout(30000);
                await createSegments(page);
                break;
            case 'quick': {
                const nameIdx = process.argv.indexOf('--name');
                const scoreIdx = process.argv.indexOf('--score');
                const qName = nameIdx !== -1 ? process.argv[nameIdx + 1] : null;
                const qScore = scoreIdx !== -1 ? process.argv[scoreIdx + 1]?.split(',') : ['medium'];
                if (!qName) {
                    console.log('Usage: node wealth-mgmt-automation.mjs --step quick --name "Audience Name" --score medium');
                    console.log('       --score accepts: low, medium, high (comma-separated for multiple)');
                    break;
                }
                await quickCreateAndGenerate(page, qName, qScore);
                break;
            }
            default:
                console.log(`Unknown step: ${step}`);
                console.log('Available: discover, create, generate, segment, quick, all');
        }
    } catch (err) {
        console.error('Error:', err.message);
        console.error(err.stack);
    }

    // Keep browser open briefly for inspection
    console.log('🔍 Browser staying open for 30 seconds...');
    console.log('   Press Ctrl+C to close early.\n');
    await page.waitForTimeout(30000);

    await browser.close();
    console.log('🏁 Done.');
}

main().catch(e => {
    console.error('Fatal:', e);
    process.exit(1);
});
