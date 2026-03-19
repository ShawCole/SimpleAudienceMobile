/**
 * Topic Pipeline — Full End-to-End Automation
 *
 * Creates audiences on IntentCore for each intent tier (high/medium/low),
 * generates them, exports CSVs, ingests into Cloud SQL via the receiver,
 * and refreshes materialized views.
 *
 * Usage:
 *   node tools/topic-pipeline.mjs --config topics/wealth-management.json
 *   node tools/topic-pipeline.mjs --config topics/wealth-management.json --step create
 *   node tools/topic-pipeline.mjs --config topics/wealth-management.json --step generate
 *   node tools/topic-pipeline.mjs --config topics/wealth-management.json --step export
 *   node tools/topic-pipeline.mjs --config topics/wealth-management.json --step refresh
 *   node tools/topic-pipeline.mjs --config topics/wealth-management.json --step all
 *
 * Config format (JSON):
 *   {
 *     "topicPath": "Financial Services > Retirement & College Savings > Wealth Management Services",
 *     "topicSlug": "wealth-management-services",
 *     "fourEyesId": 101950,
 *     "tiers": ["high", "medium", "low"],
 *     "filters": { ... same shape as buildFilters inner filters ... },
 *     "daysBack": 7
 *   }
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
const WORKSPACE_SLUG = 'simple-audience';
const ACCOUNT_ID = 'fceffb3b-552d-413a-9442-e62e9d423aa0';
const CAPTURES_DIR = path.join(ROOT, 'tools', 'captures');

const RECEIVER_URL = 'https://listmagic-receiver-1062039415876.us-east1.run.app';
const RECEIVER_API_KEY = '7c6374263cc1f2561b2a9519e9f9cb4c45c32db5f3d5caae9eb8b0724d1bc034';

// Action IDs — verified stable across deployments. Re-capture on 404.
const ACTIONS = {
    PREVIEW: '7f2fedc1659914fecb5d57837dc4b06ab5c2e0e744',
    GENERATE: '7f437ee100a328c3149f7f41b6ef0aa67929d43bcc',
    CREATE_AUDIENCE: '7ffaba0e7b99bdefb0ee5b9715f0f99be2eb57cfbf',
    EXPORT_CSV: '7f363cd62fa8f404dea17c964a943548c33f48d96f',
    SAVE_SEGMENT: '7f69e0fb84999ede7adb06dab9a09fe86476d84abe',
};

// All 74 fields to export
const SELECTED_FIELDS = [
    "AGE_RANGE", "BUSINESS_EMAIL", "CHILDREN", "COMPANY_ADDRESS", "COMPANY_CITY",
    "COMPANY_DESCRIPTION", "COMPANY_DOMAIN", "COMPANY_EMPLOYEE_COUNT", "COMPANY_INDUSTRY",
    "COMPANY_NAICS", "COMPANY_NAME", "COMPANY_NAME_HISTORY", "COMPANY_PHONE",
    "COMPANY_REVENUE", "COMPANY_SIC", "COMPANY_STATE", "COMPANY_ZIP", "COMPANY_LINKEDIN_URL",
    "PERSONAL_VERIFIED_EMAILS", "BUSINESS_VERIFIED_EMAILS", "DEPARTMENT", "DIRECT_NUMBER",
    "DIRECT_NUMBER_DNC", "EDUCATION_HISTORY", "FACEBOOK_URL", "TWITTER_URL", "FIRST_NAME",
    "GENDER", "HEADLINE", "HOMEOWNER", "INCOME_RANGE", "INFERRED_YEARS_EXPERIENCE",
    "INTERESTS", "JOB_TITLE", "JOB_TITLE_HISTORY", "LAST_NAME", "LINKEDIN_URL", "MARRIED",
    "MOBILE_PHONE", "MOBILE_PHONE_DNC", "NET_WORTH", "PERSONAL_ADDRESS", "PERSONAL_CITY",
    "PERSONAL_EMAILS", "PERSONAL_PHONE", "PERSONAL_PHONE_DNC", "PERSONAL_STATE",
    "PERSONAL_ZIP", "PERSONAL_ZIP4", "SENIORITY_LEVEL", "SHA256_BUSINESS_EMAIL",
    "SHA256_PERSONAL_EMAIL", "SKILLS", "SKIPTRACE_ADDRESS", "SKIPTRACE_B2B_ADDRESS",
    "SKIPTRACE_B2B_PHONE", "SKIPTRACE_B2B_SOURCE", "SKIPTRACE_B2B_WEBSITE", "SKIPTRACE_CITY",
    "SKIPTRACE_CREDIT_RATING", "SKIPTRACE_DNC", "SKIPTRACE_ETHNIC_CODE", "SKIPTRACE_EXACT_AGE",
    "SKIPTRACE_IP", "SKIPTRACE_LANDLINE_NUMBERS", "SKIPTRACE_LANGUAGE_CODE",
    "SKIPTRACE_MATCH_SCORE", "SKIPTRACE_NAME", "SKIPTRACE_STATE", "SKIPTRACE_WIRELESS_NUMBERS",
    "SKIPTRACE_ZIP", "SOCIAL_CONNECTIONS", "UUID", "VALID_PHONES"
];

// ── CLI PARSING ──
const args = process.argv.slice(2);
function getArg(flag) {
    const idx = args.indexOf(flag);
    return idx !== -1 ? args[idx + 1] : null;
}

const ARG_CONFIG = getArg('--config');
const ARG_STEP = getArg('--step') || 'all';
const ARG_BATCH_SIZE = parseInt(getArg('--batch-size') || '5000');

if (!ARG_CONFIG) {
    console.error('Usage: node tools/topic-pipeline.mjs --config <topic-config.json> [--step create|generate|export|refresh|all]');
    console.error('\nExample configs in tools/topics/');
    process.exit(1);
}

// Resolve config path relative to tools/ if not absolute
const configPath = path.isAbsolute(ARG_CONFIG)
    ? ARG_CONFIG
    : path.resolve(ROOT, 'tools', ARG_CONFIG);

if (!fs.existsSync(configPath)) {
    console.error(`Config file not found: ${configPath}`);
    process.exit(1);
}

const CONFIG = JSON.parse(fs.readFileSync(configPath, 'utf8'));

// Validate config
const REQUIRED_CONFIG = ['topicPath', 'topicSlug', 'tiers'];
for (const key of REQUIRED_CONFIG) {
    if (!CONFIG[key]) {
        console.error(`Config missing required field: ${key}`);
        process.exit(1);
    }
}

// State file per topic slug
const STATE_FILE = path.join(CAPTURES_DIR, `pipeline-${CONFIG.topicSlug}-state.json`);
const CHROME_DIR = path.join(ROOT, 'tools', '.chrome-pipeline-profile');

if (!fs.existsSync(CAPTURES_DIR)) fs.mkdirSync(CAPTURES_DIR, { recursive: true });

// ── STATE MANAGEMENT ──
function loadState() {
    if (fs.existsSync(STATE_FILE)) {
        return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    }
    return { topic: CONFIG.topicSlug, audiences: {}, exports: {}, lastRefresh: null };
}
function saveState(state) {
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

// ── DEFAULT FILTER TEMPLATE ──
// All empty — topic config overlays its specific filters on top
const EMPTY_FILTERS = {
    age: { minAge: null, maxAge: null },
    city: [], state: [], zip: [], gender: [],
    profile: { incomeRange: [], homeowner: [], married: [], netWorth: [], children: [] },
    businessProfile: {
        companyDescription: [], jobTitle: [], seniority: [],
        department: [], companyName: [], companyDomain: [],
        industry: [], sic: [], employeeCount: [],
        companyRevenue: [], companyNaics: []
    },
    attributes: {
        credit_rating: [], language_code: [], occupation_group: [],
        occupation_type: [], home_year_built: { min: null, max: null },
        single_parent: [], cra_code: [], dwelling_type: [],
        credit_range_new_credit: [], ethnic_code: [],
        marital_status: [], net_worth: [], education: [],
        credit_card_user: [], investment: [], smoker: [],
        home_purchase_price: { min: null, max: null },
        home_purchase_year: { min: null, max: null },
        home_purchase_month: [], estimated_home_value: [],
        mortgage_amount: { min: null, max: null },
        generations_in_household: []
    },
    notNulls: [], nullOnly: []
};

function buildFilters(scoreValues) {
    // Deep clone empty filters, then overlay config-specific filters
    const filters = JSON.parse(JSON.stringify(EMPTY_FILTERS));

    if (CONFIG.filters) {
        // Overlay each category from config
        for (const [category, values] of Object.entries(CONFIG.filters)) {
            if (typeof values === 'object' && !Array.isArray(values)) {
                if (!filters[category]) filters[category] = {};
                Object.assign(filters[category], values);
            } else {
                filters[category] = values;
            }
        }
    }

    return {
        audience: {
            type: "premade",
            b2b: null,
            customTopic: "",
            customDescription: "",
            segmentSearches: [CONFIG.topicPath]
        },
        jobId: "",
        segment: [],
        score: scoreValues,
        daysBack: CONFIG.daysBack || 7,
        filters
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
    return JSON.stringify(
        ["", { "children": ["home", { "children": [["account", WORKSPACE_SLUG, "d"], { "children": ["audience", { "children": ["__PAGE__", {}, null, null] }, null, null] }, null, null] }, null, null] }, null, null, true]
    );
}

// ── CSV PARSER (handles quoted newlines correctly) ──
function parseCSV(csvText) {
    const records = [];
    let pos = 0;
    const len = csvText.length;

    function parseRecord() {
        const fields = [];
        let current = '';
        let inQuotes = false;

        while (pos < len) {
            const ch = csvText[pos];
            if (ch === '"') {
                if (inQuotes && pos + 1 < len && csvText[pos + 1] === '"') {
                    current += '"';
                    pos += 2;
                } else {
                    inQuotes = !inQuotes;
                    pos++;
                }
            } else if (ch === ',' && !inQuotes) {
                fields.push(current);
                current = '';
                pos++;
            } else if ((ch === '\n' || ch === '\r') && !inQuotes) {
                fields.push(current);
                if (ch === '\r' && pos + 1 < len && csvText[pos + 1] === '\n') pos++;
                pos++;
                return fields;
            } else {
                current += ch;
                pos++;
            }
        }

        if (current || fields.length > 0) {
            fields.push(current);
        }
        return fields.length > 0 ? fields : null;
    }

    const headers = parseRecord();
    if (!headers) return [];

    while (pos < len) {
        if (csvText[pos] === '\n' || csvText[pos] === '\r') { pos++; continue; }
        const values = parseRecord();
        if (!values || values.length === 0) continue;
        if (values.length !== headers.length) continue;

        const record = {};
        for (let j = 0; j < headers.length; j++) {
            record[headers[j]] = values[j] || '';
        }
        records.push(record);
    }

    return records;
}

// ── DEPLOYMENT ID ──
let deploymentId = null;

async function detectDeploymentId(page) {
    const detected = await page.evaluate(() => {
        const html = document.documentElement.outerHTML;
        const m = html.match(/dpl_[A-Za-z0-9]+/);
        return m ? m[0] : null;
    });
    if (detected) {
        if (detected !== deploymentId) {
            console.log(`[deploy] Deployment ID: ${detected}${deploymentId ? ` (changed from ${deploymentId})` : ''}`);
        }
        deploymentId = detected;
    } else {
        const fromHeaders = await page.evaluate(async () => {
            try {
                const res = await fetch(window.location.href, { method: 'HEAD' });
                return res.headers.get('x-deployment-id');
            } catch { return null; }
        });
        if (fromHeaders) {
            deploymentId = fromHeaders;
            console.log(`[deploy] Deployment ID from headers: ${fromHeaders}`);
        } else {
            console.log(`[deploy] WARNING: Could not detect deployment ID`);
        }
    }
    return deploymentId;
}

// ── SERVER ACTION ──
async function serverAction(page, pathname, actionId, payload, routerStateTree) {
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
    }, pathname, actionId, payload, encodedRst, deploymentId);
}

// ── BROWSER HELPERS ──
async function login(page) {
    console.log('[login] Navigating to sign-in...');
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
        console.log('[login] Logged in.');
    } else {
        console.log('[login] Already authenticated.');
    }

    // Select workspace if on selector page
    if (page.url() === `${BASE_URL}/home` || page.url() === `${BASE_URL}/home/`) {
        await page.evaluate((slug) => {
            const links = Array.from(document.querySelectorAll('a'));
            const target = links.find(a => a.href.includes(`/home/${slug}`));
            if (target) target.click();
        }, WORKSPACE_SLUG);
        await page.waitForNavigation({ waitUntil: 'load', timeout: 30000 }).catch(() => {});
        await page.waitForTimeout(2000);
    }

    console.log(`[login] URL: ${page.url()}\n`);
}

async function postBatch(url, batch, batchNum) {
    const ts = new Date().toISOString().slice(11, 23);
    process.stdout.write(`  [${ts}] Batch ${batchNum} (${batch.length} records)... `);
    const t0 = performance.now();
    try {
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-api-key': RECEIVER_API_KEY },
            body: JSON.stringify(batch),
        });
        const data = await res.json();
        const ms = Math.round(performance.now() - t0);
        if (data.success) {
            console.log(`inserted=${data.inserted} skipped=${data.skipped || 0} (${ms}ms)`);
            return { inserted: data.inserted, skipped: data.skipped || 0 };
        } else {
            console.log(`ERROR: ${data.error} (${ms}ms)`);
            return { inserted: 0, skipped: batch.length };
        }
    } catch (err) {
        const ms = Math.round(performance.now() - t0);
        console.log(`ERROR: ${err.message} (${ms}ms)`);
        return { inserted: 0, skipped: batch.length };
    }
}

// ══════════════════════════════════════════════════════════════
//  STEP 1: CREATE AUDIENCES
// ══════════════════════════════════════════════════════════════

async function stepCreate(page) {
    console.log('='.repeat(60));
    console.log('  STEP: CREATE AUDIENCES');
    console.log('='.repeat(60) + '\n');

    const state = loadState();
    const audiencesUrl = `${BASE_URL}/home/${WORKSPACE_SLUG}/audience`;

    for (const tier of CONFIG.tiers) {
        // Check if already created
        if (state.audiences[tier]?.id) {
            console.log(`[${tier}] Already exists: ${state.audiences[tier].id}`);
            continue;
        }

        // Check config for pre-existing IDs
        if (CONFIG.existingAudiences?.[tier]) {
            const existingId = CONFIG.existingAudiences[tier];
            console.log(`[${tier}] Using existing audience from config: ${existingId}`);
            state.audiences[tier] = { id: existingId, status: 'existing' };
            saveState(state);
            continue;
        }

        const name = `${CONFIG.topicSlug} - ${tier} intent`;
        console.log(`[${tier}] Creating: "${name}"`);

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
            console.log(`[${tier}] Could not find Create button`);
            continue;
        }

        await page.waitForTimeout(2000);

        // Type name
        const nameInput = await page.waitForSelector(
            'div[role="dialog"] form input[name="name"], div[role="dialog"] input',
            { visible: true, timeout: 10000 }
        );
        if (nameInput) {
            await nameInput.click({ clickCount: 3 });
            await nameInput.type(name, { delay: 30 });
        } else {
            console.log(`[${tier}] Could not find name input`);
            continue;
        }

        await page.waitForTimeout(500);

        // Submit
        const submitted = await page.evaluate(() => {
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

        if (!submitted) {
            console.log(`[${tier}] Could not find submit button`);
            continue;
        }

        await page.waitForNavigation({ waitUntil: 'load', timeout: 30000 }).catch(() => {});
        await page.waitForTimeout(3000);

        // Extract audience ID from URL
        const newUrl = page.url();
        const idMatch = newUrl.match(/\/audience\/([0-9a-f-]+)/);
        if (idMatch) {
            console.log(`[${tier}] Created: ${idMatch[1]}`);
            state.audiences[tier] = { id: idMatch[1], status: 'created', createdAt: new Date().toISOString() };
            saveState(state);
        } else {
            console.log(`[${tier}] Could not extract audience ID from URL: ${newUrl}`);
        }
        console.log('');
    }

    printAudienceState(state);
}

// ══════════════════════════════════════════════════════════════
//  STEP 2: GENERATE AUDIENCES
// ══════════════════════════════════════════════════════════════

async function stepGenerate(page) {
    console.log('='.repeat(60));
    console.log('  STEP: GENERATE AUDIENCES');
    console.log('='.repeat(60) + '\n');

    const state = loadState();

    for (const tier of CONFIG.tiers) {
        const audienceId = state.audiences[tier]?.id;
        if (!audienceId) {
            console.log(`[${tier}] No audience ID — run create step first`);
            continue;
        }

        if (state.audiences[tier]?.status === 'generated' || state.audiences[tier]?.status === 'exported') {
            console.log(`[${tier}] Already generated (status: ${state.audiences[tier].status}). Set status to 'needs-regenerate' to re-run.`);
            continue;
        }

        console.log(`[${tier}] Generating: ${audienceId} (score: [${tier}])`);

        const audienceUrl = `${BASE_URL}/home/${WORKSPACE_SLUG}/audience/${audienceId}`;
        await page.goto(audienceUrl, { waitUntil: 'networkidle2', timeout: 60000 });
        await page.waitForTimeout(5000);
        await detectDeploymentId(page);

        const filters = buildFilters([tier]);
        const rst = buildRouterStateTree('audience', audienceId);
        const pathname = `/home/${WORKSPACE_SLUG}/audience/${audienceId}`;

        // Preview
        console.log(`[${tier}] Running preview...`);
        const previewPayload = [{ accountId: ACCOUNT_ID, id: audienceId, filters }];
        const previewResult = await serverAction(page, pathname, ACTIONS.PREVIEW, previewPayload, rst);

        if (!previewResult.ok) {
            console.log(`[${tier}] Preview failed: ${previewResult.status} ${previewResult.error || ''}`);
            if (previewResult.status === 404) console.log(`[${tier}] Action ID may be stale — re-capture from DevTools`);
            continue;
        }

        const countMatch = previewResult.text?.match(/"count"\s*:\s*(\d+)/);
        const previewCount = countMatch?.[1] || 'unknown';
        console.log(`[${tier}] Preview count: ${previewCount}`);

        // Generate
        console.log(`[${tier}] Running generate...`);
        const generatePayload = [{
            accountId: ACCOUNT_ID,
            audienceId,
            filters,
            hasSegmentChanged: state.audiences[tier]?.status === 'needs-regenerate',
            resolveIntents: true
        }];

        const genResult = await serverAction(page, pathname, ACTIONS.GENERATE, generatePayload, rst);

        if (genResult.ok) {
            console.log(`[${tier}] Generated. Count: ${previewCount}`);
            state.audiences[tier] = {
                ...state.audiences[tier],
                status: 'generated',
                previewCount,
                generatedAt: new Date().toISOString()
            };
            saveState(state);
        } else {
            console.log(`[${tier}] Generate failed: ${genResult.status}`);
            if (genResult.text) console.log(`  Response: ${genResult.text.substring(0, 300)}`);
        }

        // Wait between tiers
        if (CONFIG.tiers.indexOf(tier) < CONFIG.tiers.length - 1) {
            console.log(`[${tier}] Waiting 10s...\n`);
            await page.waitForTimeout(10000);
        }
    }

    console.log('');
    printAudienceState(state);
}

// ══════════════════════════════════════════════════════════════
//  STEP 3: EXPORT + INGEST
// ══════════════════════════════════════════════════════════════

async function stepExport(page) {
    console.log('='.repeat(60));
    console.log('  STEP: EXPORT + INGEST');
    console.log('='.repeat(60) + '\n');

    const state = loadState();

    for (const tier of CONFIG.tiers) {
        const audienceId = state.audiences[tier]?.id;
        if (!audienceId) {
            console.log(`[${tier}] No audience ID — run create step first`);
            continue;
        }

        if (state.audiences[tier]?.status !== 'generated' && state.audiences[tier]?.status !== 'existing') {
            console.log(`[${tier}] Not generated yet (status: ${state.audiences[tier]?.status}). Run generate step first.`);
            continue;
        }

        if (state.exports[tier]?.status === 'ingested') {
            console.log(`[${tier}] Already exported + ingested (${state.exports[tier].inserted} records). Delete exports.${tier} from state file to re-run.`);
            continue;
        }

        console.log(`[${tier}] Exporting audience: ${audienceId}`);

        // Navigate to studio with audience
        const studioUrl = `${BASE_URL}/home/${WORKSPACE_SLUG}/studio?audience=${audienceId}`;
        await page.goto(studioUrl, { waitUntil: 'networkidle2', timeout: 60000 });
        await page.waitForTimeout(2000);
        await detectDeploymentId(page);

        // Wait for data to load
        console.log(`[${tier}] Waiting for data to load...`);
        const DATA_LOADING_XPATH = '/html/body/div[2]/div/div[2]/div[2]/div[2]/div[6]/div[2]/div';
        const TOTAL_ROWS_XPATH = '/html/body/div[2]/div/div[2]/div[2]/div[2]/div[7]/div[2]/div[1]/div/div[2]';
        const MAX_WAIT = 300000;
        const startWait = Date.now();
        let dataLoaded = false;

        while (Date.now() - startWait < MAX_WAIT) {
            const status = await page.evaluate((loadXp, rowsXp) => {
                const getByXPath = (xp) => {
                    const r = document.evaluate(xp, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
                    return r.singleNodeValue?.textContent?.trim() || '';
                };
                return { loadingText: getByXPath(loadXp), totalRowsText: getByXPath(rowsXp) };
            }, DATA_LOADING_XPATH, TOTAL_ROWS_XPATH);

            const isLoading = status.loadingText.toLowerCase().includes('loading');
            const rowsMatch = status.totalRowsText.match(/([\d,]+)/);
            const rowCount = rowsMatch ? parseInt(rowsMatch[1].replace(/,/g, '')) : 0;

            if (!isLoading && rowCount > 0) {
                console.log(`[${tier}] Data loaded. Total rows: ${rowCount.toLocaleString()}`);
                dataLoaded = true;
                break;
            }

            const elapsed = ((Date.now() - startWait) / 1000).toFixed(0);
            process.stdout.write(`\r[${tier}] Loading... (${elapsed}s)`);
            await page.waitForTimeout(2000);
        }

        if (!dataLoaded) {
            console.log(`\n[${tier}] Timed out waiting for data. Skipping.`);
            continue;
        }

        // Request CSV export
        const pathname = `/home/${WORKSPACE_SLUG}/studio?audience=${audienceId}`;
        const exportPayload = [{
            audienceId,
            accountId: ACCOUNT_ID,
            filters: { id: "root", operator: "AND", rules: [] },
            selectedFields: SELECTED_FIELDS,
            onlyFirstValueFields: [],
            format: "csv",
        }];

        console.log(`[${tier}] Requesting CSV export...`);
        let exportResult;
        for (let attempt = 1; attempt <= 6; attempt++) {
            exportResult = await serverAction(page, pathname, ACTIONS.EXPORT_CSV, exportPayload, buildRouterStateTree('studio'));
            if (exportResult.ok) break;
            if (exportResult.status === 404) {
                console.log(`[${tier}] 404 — EXPORT_CSV action ID stale. Re-capture from DevTools.`);
                return;
            }
            if (attempt < 6) {
                console.log(`[${tier}] Attempt ${attempt}/6 failed. Retrying in 15s...`);
                await page.waitForTimeout(15000);
            }
        }

        if (!exportResult.ok) {
            console.log(`[${tier}] Export failed after 6 attempts`);
            continue;
        }

        // Parse GCS URL
        const fileUrlMatch = exportResult.text?.match(/"fileUrl"\s*:\s*"([^"]+)"/);
        if (!fileUrlMatch) {
            console.log(`[${tier}] Could not find fileUrl in response`);
            continue;
        }

        const csvUrl = fileUrlMatch[1];
        console.log(`[${tier}] CSV URL: ${csvUrl}`);

        // Download CSV
        console.log(`[${tier}] Downloading...`);
        const csvResponse = await fetch(csvUrl);
        if (!csvResponse.ok) {
            console.log(`[${tier}] Download failed: ${csvResponse.status}`);
            continue;
        }

        const csvFile = path.join(CAPTURES_DIR, `pipeline-${CONFIG.topicSlug}-${tier}-${Date.now()}.csv`);
        const fileStream = fs.createWriteStream(csvFile);
        let totalBytes = 0;

        for await (const chunk of csvResponse.body) {
            fileStream.write(chunk);
            totalBytes += chunk.length;
            if (totalBytes % (10 * 1024 * 1024) < chunk.length) {
                process.stdout.write(`\r[${tier}] ${(totalBytes / 1024 / 1024).toFixed(1)} MB...`);
            }
        }
        fileStream.end();
        await new Promise(resolve => fileStream.on('finish', resolve));
        console.log(`[${tier}] Downloaded ${(totalBytes / 1024 / 1024).toFixed(1)} MB -> ${path.basename(csvFile)}`);

        // Parse CSV and ingest to receiver
        // Uses parseCSV() which correctly handles quoted newlines (not readline)
        const ingestUrl = `${RECEIVER_URL}/ingest/batch/${CONFIG.topicSlug}/${tier}`;
        console.log(`[${tier}] Parsing CSV...`);
        const csvText = fs.readFileSync(csvFile, 'utf8');
        const records = parseCSV(csvText);
        console.log(`[${tier}] Parsed ${records.length} records. Ingesting...`);

        let inserted = 0;
        let skipped = 0;
        let batchNum = 0;

        for (let i = 0; i < records.length; i += ARG_BATCH_SIZE) {
            const batch = records.slice(i, i + ARG_BATCH_SIZE);
            batchNum++;
            const result = await postBatch(ingestUrl, batch, batchNum);
            inserted += result.inserted;
            skipped += result.skipped;
        }

        console.log(`[${tier}] Ingested: ${inserted} inserted, ${skipped} skipped`);

        state.exports[tier] = {
            status: 'ingested',
            csvFile,
            csvUrl,
            records: records.length,
            inserted,
            skipped,
            exportedAt: new Date().toISOString()
        };
        state.audiences[tier] = { ...state.audiences[tier], status: 'exported' };
        saveState(state);

        // Wait between tiers
        if (CONFIG.tiers.indexOf(tier) < CONFIG.tiers.length - 1) {
            console.log(`[${tier}] Waiting 5s...\n`);
            await page.waitForTimeout(5000);
        }
    }

    console.log('');
    printExportState(state);
}

// ══════════════════════════════════════════════════════════════
//  STEP 4: REFRESH MATERIALIZED VIEWS
// ══════════════════════════════════════════════════════════════

async function stepRefresh() {
    console.log('='.repeat(60));
    console.log('  STEP: REFRESH MATERIALIZED VIEWS');
    console.log('='.repeat(60) + '\n');

    const url = `${RECEIVER_URL}/api/geo/refresh`;
    console.log(`[refresh] POST ${url}`);

    try {
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'x-api-key': RECEIVER_API_KEY }
        });
        const data = await res.json();
        console.log(`[refresh] Status: ${res.status}`);
        console.log(`[refresh] Response:`, JSON.stringify(data, null, 2));

        // Verify topic shows up
        const topicsRes = await fetch(`${RECEIVER_URL}/api/topics`, {
            headers: { 'x-api-key': RECEIVER_API_KEY }
        });
        const topics = await topicsRes.json();
        const ourTopic = topics.find(t => t.topic_slug === CONFIG.topicSlug);
        if (ourTopic) {
            console.log(`\n[refresh] Topic "${CONFIG.topicSlug}" confirmed in dashboard: ${ourTopic.signal_count} signals`);
        } else {
            console.log(`\n[refresh] WARNING: Topic "${CONFIG.topicSlug}" not found in /api/topics`);
        }

        const state = loadState();
        state.lastRefresh = new Date().toISOString();
        saveState(state);

    } catch (err) {
        console.log(`[refresh] ERROR: ${err.message}`);
    }
}

// ── HELPERS ──
function printAudienceState(state) {
    console.log('Audience state:');
    for (const tier of CONFIG.tiers) {
        const a = state.audiences[tier];
        console.log(`  [${tier}] ${a?.id || 'NOT CREATED'} — ${a?.status || 'unknown'} — count: ${a?.previewCount || 'N/A'}`);
    }
    console.log('');
}

function printExportState(state) {
    console.log('Export state:');
    for (const tier of CONFIG.tiers) {
        const e = state.exports[tier];
        console.log(`  [${tier}] ${e?.status || 'NOT EXPORTED'} — ${e?.inserted || 0} inserted — ${e?.csvFile ? path.basename(e.csvFile) : 'N/A'}`);
    }
    console.log('');
}

// ══════════════════════════════════════════════════════════════
//  MAIN
// ══════════════════════════════════════════════════════════════

async function main() {
    console.log('='.repeat(60));
    console.log('  TOPIC PIPELINE');
    console.log(`  Topic:  ${CONFIG.topicPath}`);
    console.log(`  Slug:   ${CONFIG.topicSlug}`);
    console.log(`  Tiers:  ${CONFIG.tiers.join(', ')}`);
    console.log(`  Step:   ${ARG_STEP}`);
    console.log(`  State:  ${STATE_FILE}`);
    console.log('='.repeat(60) + '\n');

    const needsBrowser = ['create', 'generate', 'export', 'all'].includes(ARG_STEP);

    let browser, page;

    if (needsBrowser) {
        const lockFile = path.join(CHROME_DIR, 'SingletonLock');
        if (fs.existsSync(lockFile)) fs.unlinkSync(lockFile);

        browser = await puppeteer.default.launch({
            executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
            headless: false,
            userDataDir: CHROME_DIR,
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1400,1024'],
            defaultViewport: null
        });

        page = await browser.newPage();
        await login(page);
        await detectDeploymentId(page);
    }

    try {
        if (ARG_STEP === 'create' || ARG_STEP === 'all') {
            await stepCreate(page);
        }
        if (ARG_STEP === 'generate' || ARG_STEP === 'all') {
            await stepGenerate(page);
            if (ARG_STEP === 'all') {
                console.log('Waiting 30s for audiences to finalize before export...\n');
                await page.waitForTimeout(30000);
            }
        }
        if (ARG_STEP === 'export' || ARG_STEP === 'all') {
            await stepExport(page);
        }
        if (ARG_STEP === 'refresh' || ARG_STEP === 'all') {
            await stepRefresh();
        }
    } finally {
        if (browser) {
            // Keep browser open briefly for inspection
            console.log('\nPipeline complete. Browser closing in 5s...');
            await page?.waitForTimeout(5000);
            await browser.close();
        }
    }

    // Final summary
    const state = loadState();
    console.log('\n' + '='.repeat(60));
    console.log('  PIPELINE SUMMARY');
    console.log('='.repeat(60));
    printAudienceState(state);
    printExportState(state);
    if (state.lastRefresh) console.log(`Last MV refresh: ${state.lastRefresh}`);
    console.log('');
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
