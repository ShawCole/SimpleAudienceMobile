/**
 * E-Waste Recycling — create audience, preview, generate. Fully self-contained.
 */

import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const envContent = fs.readFileSync(path.join(ROOT, 'backend', '.env'), 'utf8');
const env = {};
for (const line of envContent.split('\n')) {
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (match) env[match[1].trim()] = match[2].trim();
}

puppeteer.default.use(StealthPlugin());
const delay = ms => new Promise(r => setTimeout(r, ms));

const BASE_URL = env.SIMPLEAUDIENCE_BASE_URL || 'https://app.intentcore.io';
const EMAIL = env.SIMPLEAUDIENCE_EMAIL;
const PASSWORD = env.SIMPLEAUDIENCE_PASSWORD;
const USER_DATA_DIR = path.join(ROOT, 'tools', '.chrome-inject-profile');
const CAPTURES_DIR = path.join(ROOT, 'tools', 'captures');
if (!fs.existsSync(CAPTURES_DIR)) fs.mkdirSync(CAPTURES_DIR, { recursive: true });

const WORKSPACE_SLUG = 'simple-audience';
const ACCOUNT_ID = 'fceffb3b-552d-413a-9442-e62e9d423aa0';
const AUDIENCE_NAME = 'E-Waste Recycling Intent - Medical Dental Legal Education - SC';

const ACTIONS = {
    PREVIEW: '7f2fedc1659914fecb5d57837dc4b06ab5c2e0e744',
    GENERATE: '7f437ee100a328c3149f7f41b6ef0aa67929d43bcc',
};

const AUDIENCE_BLOCK = {
    type: "premade",
    b2b: null,
    customTopic: "",
    customDescription: "",
    segmentSearches: ["Sustainability & Green Living > Recycling & Waste Management > E-waste Management"]
};

const FILTERS = {
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
};

function buildRST(audienceId) {
    return JSON.stringify(
        ["", { "children": ["home", { "children": [["account", WORKSPACE_SLUG, "d"], { "children": ["audience", { "children": [["id", audienceId, "d"], { "children": ["__PAGE__", {}, null, null] }, null, null] }, null, null] }, null, null] }, null, null] }, null, null, true]
    );
}

async function fireServerAction(page, pathname, actionId, payload, rstEncoded, deploymentId) {
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
    }, pathname, actionId, payload, rstEncoded, deploymentId);
}

async function main() {
    console.log('═══ E-WASTE RECYCLING AUDIENCE — CREATE + PREVIEW + GENERATE ═══\n');

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

    // ════════════════════════════════════════
    // STEP 1: LOGIN
    // ════════════════════════════════════════
    console.log('[1/6] Logging in...');
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
        console.log('[1/6] Logged in.');
    } else {
        console.log('[1/6] Already authenticated.');
    }

    // ════════════════════════════════════════
    // STEP 2: SELECT WORKSPACE
    // ════════════════════════════════════════
    console.log('[2/6] Selecting simple-audience workspace...');
    await page.goto(`${BASE_URL}/home/${WORKSPACE_SLUG}`, { waitUntil: 'load', timeout: 30000 });
    await delay(2000);
    console.log(`[2/6] At: ${page.url()}`);

    // ════════════════════════════════════════
    // STEP 3: CREATE AUDIENCE
    // ════════════════════════════════════════
    console.log(`[3/6] Creating audience: "${AUDIENCE_NAME}"`);
    await page.goto(`${BASE_URL}/home/${WORKSPACE_SLUG}/audience`, { waitUntil: 'load', timeout: 30000 });
    await delay(3000);

    // Click "Create" button
    const createClicked = await page.evaluate(() => {
        const btns = Array.from(document.querySelectorAll('button, a'));
        const btn = btns.find(b => b.textContent?.trim() === 'Create');
        if (btn) { btn.click(); return true; }
        return false;
    });

    if (!createClicked) {
        console.log('[3/6] FATAL: Cannot find Create button.');
        await page.screenshot({ path: path.join(CAPTURES_DIR, 'ewaste-no-create.png'), fullPage: true });
        console.log('[3/6] Screenshot saved. Keeping browser open.');
        await delay(300000);
        await browser.close();
        return;
    }

    // Wait for dialog, type name
    await delay(2000);
    const nameInput = await page.waitForSelector('div[role="dialog"] form input[name="name"], div[role="dialog"] input', { visible: true, timeout: 10000 });
    await nameInput.click({ clickCount: 3 });
    await nameInput.type(AUDIENCE_NAME, { delay: 30 });

    // Click submit in dialog
    await page.evaluate(() => {
        const dialog = document.querySelector('div[role="dialog"]');
        if (!dialog) return;
        const btns = Array.from(dialog.querySelectorAll('button'));
        const submit = btns.find(b => b.textContent?.trim() === 'Create' || b.type === 'submit');
        if (submit) submit.click();
    });

    // Wait for redirect to new audience page
    await page.waitForNavigation({ waitUntil: 'load', timeout: 30000 }).catch(() => {});
    await delay(3000);

    // Extract audience ID from URL
    const urlMatch = page.url().match(/\/audience\/([0-9a-f-]+)/);
    if (!urlMatch) {
        console.log(`[3/6] FATAL: No audience ID in URL: ${page.url()}`);
        await page.screenshot({ path: path.join(CAPTURES_DIR, 'ewaste-no-id.png'), fullPage: true });
        await delay(300000);
        await browser.close();
        return;
    }
    const audienceId = urlMatch[1];
    console.log(`[3/6] Created audience: ${audienceId}`);

    // ════════════════════════════════════════
    // STEP 4: DETECT DEPLOYMENT ID
    // ════════════════════════════════════════
    console.log('[4/6] Detecting deployment ID...');
    const deploymentId = await page.evaluate(() => {
        const html = document.documentElement.outerHTML;
        const m = html.match(/dpl_[A-Za-z0-9]+/);
        return m ? m[0] : null;
    });
    if (!deploymentId) {
        console.log('[4/6] FATAL: No deployment ID.');
        await delay(300000);
        await browser.close();
        return;
    }
    console.log(`[4/6] Deployment ID: ${deploymentId}`);

    const pathname = `/home/${WORKSPACE_SLUG}/audience/${audienceId}`;
    const rstEncoded = encodeURIComponent(buildRST(audienceId));

    // ════════════════════════════════════════
    // STEP 5: PREVIEW INJECTION
    // ════════════════════════════════════════
    const previewPayload = [{
        accountId: ACCOUNT_ID,
        id: audienceId,
        filters: {
            audience: AUDIENCE_BLOCK,
            jobId: "",
            segment: [],
            daysBack: 7,
            score: [],
            filters: FILTERS
        }
    }];

    console.log('[5/6] Firing PREVIEW server action...');
    const previewResult = await fireServerAction(page, pathname, ACTIONS.PREVIEW, previewPayload, rstEncoded, deploymentId);

    console.log(`[5/6] Status: ${previewResult.status} | OK: ${previewResult.ok}`);
    console.log(`[5/6] Response (first 500): ${previewResult.text?.substring(0, 500)}`);

    if (!previewResult.ok) {
        const digest = previewResult.text?.match(/"digest"\s*:\s*"(\d+)"/);
        console.log(`[5/6] PREVIEW FAILED — digest: ${digest?.[1] || 'unknown'}`);
        if (previewResult.status === 404) {
            console.log('[5/6] Action ID stale. Scanning page for new IDs...');
            const ids = await page.evaluate(() => {
                const found = [];
                if (window.__next_f) {
                    for (const chunk of window.__next_f) {
                        if (typeof chunk[1] === 'string') {
                            for (const m of chunk[1].matchAll(/(7f[0-9a-f]{38,42})/g)) found.push(m[1]);
                        }
                    }
                }
                return [...new Set(found)];
            });
            console.log(`[5/6] Found action IDs: ${ids.join(', ')}`);
        }
        await delay(300000);
        await browser.close();
        return;
    }

    const countMatch = previewResult.text?.match(/"count"\s*:\s*(\d+)/);
    const previewCount = countMatch?.[1] || 'unknown';
    console.log(`[5/6] PREVIEW SUCCESS — Count: ${previewCount}`);

    // ════════════════════════════════════════
    // STEP 6: GENERATE INJECTION
    // ════════════════════════════════════════
    const generatePayload = [{
        accountId: ACCOUNT_ID,
        audienceId: audienceId,
        filters: {
            audience: AUDIENCE_BLOCK,
            jobId: "",
            segment: [],
            score: [],
            daysBack: 7,
            filters: FILTERS
        },
        hasSegmentChanged: false,
        resolveIntents: true
    }];

    console.log('[6/6] Firing GENERATE server action...');
    const generateResult = await fireServerAction(page, pathname, ACTIONS.GENERATE, generatePayload, rstEncoded, deploymentId);

    console.log(`[6/6] Status: ${generateResult.status} | OK: ${generateResult.ok}`);
    console.log(`[6/6] Response (first 500): ${generateResult.text?.substring(0, 500)}`);

    if (generateResult.ok) {
        console.log(`\n${'═'.repeat(60)}`);
        console.log('  AUDIENCE GENERATING');
        console.log(`  Name:    ${AUDIENCE_NAME}`);
        console.log(`  ID:      ${audienceId}`);
        console.log(`  Count:   ${previewCount}`);
        console.log(`  Topic:   Sustainability & Green Living > Recycling & Waste Management > E-waste Management`);
        console.log(`  Status:  In Queue → Hydrating → Completed`);
        console.log(`${'═'.repeat(60)}`);
    } else {
        const digest = generateResult.text?.match(/"digest"\s*:\s*"(\d+)"/);
        console.log(`[6/6] GENERATE FAILED — digest: ${digest?.[1] || 'unknown'}`);
    }

    // Save log
    const logFile = path.join(CAPTURES_DIR, `inject-ewaste-${audienceId}-${Date.now()}.json`);
    fs.writeFileSync(logFile, JSON.stringify({
        audienceId, name: AUDIENCE_NAME, deploymentId, previewCount,
        preview: { status: previewResult.status, ok: previewResult.ok },
        generate: { status: generateResult.status, ok: generateResult.ok },
    }, null, 2));
    console.log(`\nLog: ${logFile}`);

    console.log('\nBrowser open 5 min. Ctrl+C to close.');
    await delay(300000);
    await browser.close();
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
