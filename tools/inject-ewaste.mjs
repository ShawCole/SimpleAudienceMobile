/**
 * E-Waste Recycling — create audience, preview, generate.
 * VERBOSE logging at every step. No waitForNavigation (hangs in Puppeteer v24).
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
const log = (step, msg) => console.log(`[${new Date().toISOString()}] [${step}] ${msg}`);

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
    type: "premade", b2b: null, customTopic: "", customDescription: "",
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

async function main() {
    log('init', '═══ E-WASTE RECYCLING AUDIENCE — FULL PIPELINE ═══');
    log('init', `Name: ${AUDIENCE_NAME}`);
    log('init', `Email: ${EMAIL}`);
    log('init', `Base URL: ${BASE_URL}`);
    log('init', `Workspace: ${WORKSPACE_SLUG}`);
    log('init', `User data dir: ${USER_DATA_DIR}`);

    // Clean up stale lock
    const lockFile = path.join(USER_DATA_DIR, 'SingletonLock');
    if (fs.existsSync(lockFile)) {
        fs.unlinkSync(lockFile);
        log('init', 'Removed stale SingletonLock');
    }

    log('browser', 'Launching Chrome...');
    const browser = await puppeteer.default.launch({
        executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        headless: false,
        userDataDir: USER_DATA_DIR,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1400,1024'],
        defaultViewport: null
    });
    log('browser', 'Chrome launched.');

    const page = await browser.newPage();
    log('browser', 'New page created.');

    // Enable CDP for HAR capture
    const client = await page.createCDPSession();
    await client.send('Network.enable');
    const networkLogs = [];
    client.on('Network.requestWillBeSent', (params) => {
        if (params.request.url.includes('intentcore') && params.request.method === 'POST') {
            networkLogs.push({
                ts: new Date().toISOString(),
                type: 'request',
                url: params.request.url,
                method: params.request.method,
                headers: params.request.headers,
                postData: params.request.postData?.substring(0, 500),
                requestId: params.requestId
            });
            log('network', `POST → ${params.request.url} (reqId: ${params.requestId})`);
        }
    });
    client.on('Network.responseReceived', (params) => {
        if (params.response.url.includes('intentcore') && params.type === 'Fetch') {
            networkLogs.push({
                ts: new Date().toISOString(),
                type: 'response',
                url: params.response.url,
                status: params.response.status,
                requestId: params.requestId
            });
            log('network', `← ${params.response.status} ${params.response.url} (reqId: ${params.requestId})`);
        }
    });
    log('browser', 'CDP Network monitoring enabled.');

    // ══════════════════════════════════════════════════════════
    // STEP 1: LOGIN
    // ══════════════════════════════════════════════════════════
    try {
        log('login', `Navigating to ${BASE_URL}/auth/sign-in ...`);
        await page.goto(`${BASE_URL}/auth/sign-in`, { waitUntil: 'load', timeout: 30000 });
        log('login', `Current URL after goto: ${page.url()}`);

        if (page.url().includes('sign-in')) {
            log('login', 'On sign-in page. Waiting for email input...');
            await page.waitForSelector('input[type="email"]', { visible: true, timeout: 10000 });
            log('login', 'Email input found. Typing email...');
            await page.type('input[type="email"]', EMAIL, { delay: 50 });
            log('login', 'Email typed. Waiting for password input...');
            await page.waitForSelector('input[type="password"]', { visible: true, timeout: 5000 });
            log('login', 'Password input found. Typing password...');
            await page.type('input[type="password"]', PASSWORD, { delay: 50 });
            log('login', 'Password typed. Clicking submit...');
            await page.click('button[type="submit"]');
            log('login', 'Submit clicked. Waiting 5s for redirect...');
            await delay(5000);
            log('login', `URL after login: ${page.url()}`);
        } else {
            log('login', `Already authenticated. URL: ${page.url()}`);
        }
    } catch (e) {
        log('login', `ERROR: ${e.message}`);
        await page.screenshot({ path: path.join(CAPTURES_DIR, 'ewaste-login-error.png'), fullPage: true });
        log('login', 'Screenshot saved: ewaste-login-error.png');
        await browser.close();
        return;
    }

    // ══════════════════════════════════════════════════════════
    // STEP 2: SELECT WORKSPACE
    // ══════════════════════════════════════════════════════════
    try {
        log('workspace', `Navigating to ${BASE_URL}/home/${WORKSPACE_SLUG} ...`);
        await page.goto(`${BASE_URL}/home/${WORKSPACE_SLUG}`, { waitUntil: 'load', timeout: 30000 });
        log('workspace', `URL after workspace nav: ${page.url()}`);
        log('workspace', 'Waiting 3s for page to settle...');
        await delay(3000);
        log('workspace', `Final URL: ${page.url()}`);
    } catch (e) {
        log('workspace', `ERROR: ${e.message}`);
        await page.screenshot({ path: path.join(CAPTURES_DIR, 'ewaste-workspace-error.png'), fullPage: true });
        await browser.close();
        return;
    }

    // ══════════════════════════════════════════════════════════
    // STEP 3: NAVIGATE TO AUDIENCE LIST
    // ══════════════════════════════════════════════════════════
    try {
        log('audienceList', `Navigating to ${BASE_URL}/home/${WORKSPACE_SLUG}/audience ...`);
        await page.goto(`${BASE_URL}/home/${WORKSPACE_SLUG}/audience`, { waitUntil: 'load', timeout: 30000 });
        log('audienceList', `URL: ${page.url()}`);
        log('audienceList', 'Waiting 3s for audience list to load...');
        await delay(3000);

        // Screenshot the audience list page
        await page.screenshot({ path: path.join(CAPTURES_DIR, 'ewaste-audience-list.png'), fullPage: true });
        log('audienceList', 'Screenshot saved: ewaste-audience-list.png');

        // Log all buttons on page
        const buttons = await page.evaluate(() => {
            return Array.from(document.querySelectorAll('button, a')).map(b => ({
                tag: b.tagName, text: b.textContent?.trim().substring(0, 50), href: b.href || null
            })).filter(b => b.text);
        });
        log('audienceList', `Found ${buttons.length} buttons/links:`);
        buttons.forEach(b => log('audienceList', `  <${b.tag}> "${b.text}" ${b.href || ''}`));
    } catch (e) {
        log('audienceList', `ERROR: ${e.message}`);
        await browser.close();
        return;
    }

    // ══════════════════════════════════════════════════════════
    // STEP 4: CREATE AUDIENCE
    // ══════════════════════════════════════════════════════════
    let audienceId = null;
    try {
        log('create', 'Clicking Create button...');
        const createClicked = await page.evaluate(() => {
            const btns = Array.from(document.querySelectorAll('button, a'));
            const btn = btns.find(b => b.textContent?.trim() === 'Create');
            if (btn) { btn.click(); return { clicked: true, tag: btn.tagName, text: btn.textContent?.trim() }; }
            return { clicked: false };
        });
        log('create', `Create click result: ${JSON.stringify(createClicked)}`);

        if (!createClicked.clicked) {
            log('create', 'FATAL: No Create button found.');
            await browser.close();
            return;
        }

        log('create', 'Waiting 2s for dialog...');
        await delay(2000);

        // Screenshot the dialog
        await page.screenshot({ path: path.join(CAPTURES_DIR, 'ewaste-create-dialog.png'), fullPage: true });
        log('create', 'Screenshot saved: ewaste-create-dialog.png');

        // Check for dialog
        const dialogExists = await page.evaluate(() => !!document.querySelector('div[role="dialog"]'));
        log('create', `Dialog present: ${dialogExists}`);

        if (!dialogExists) {
            log('create', 'FATAL: No dialog appeared after clicking Create.');
            await browser.close();
            return;
        }

        log('create', 'Looking for name input...');
        const nameInput = await page.waitForSelector('div[role="dialog"] input', { visible: true, timeout: 10000 });
        log('create', 'Name input found. Clearing and typing name...');
        await nameInput.click({ clickCount: 3 });
        await nameInput.type(AUDIENCE_NAME, { delay: 30 });
        log('create', `Typed: "${AUDIENCE_NAME}"`);

        log('create', 'Clicking submit button in dialog...');
        const submitClicked = await page.evaluate(() => {
            const dialog = document.querySelector('div[role="dialog"]');
            if (!dialog) return { clicked: false, reason: 'no dialog' };
            const btns = Array.from(dialog.querySelectorAll('button'));
            const submit = btns.find(b => b.textContent?.trim() === 'Create' || b.type === 'submit');
            if (submit) { submit.click(); return { clicked: true, text: submit.textContent?.trim() }; }
            return { clicked: false, reason: 'no submit button', buttons: btns.map(b => b.textContent?.trim()) };
        });
        log('create', `Submit click result: ${JSON.stringify(submitClicked)}`);

        // DO NOT use waitForNavigation — it hangs in Puppeteer v24.
        // Instead, poll the URL for the audience UUID to appear.
        log('create', 'Polling URL for audience UUID (max 15s)...');
        let pollCount = 0;
        while (pollCount < 30) {
            await delay(500);
            pollCount++;
            const currentUrl = page.url();
            const match = currentUrl.match(/\/audience\/([0-9a-f-]{36})/);
            if (match) {
                audienceId = match[1];
                log('create', `Found audience ID in URL after ${pollCount * 500}ms: ${audienceId}`);
                break;
            }
            if (pollCount % 6 === 0) {
                log('create', `Still polling... URL: ${currentUrl} (${pollCount * 500}ms elapsed)`);
            }
        }

        if (!audienceId) {
            log('create', `FATAL: No audience ID after 15s. Final URL: ${page.url()}`);
            await page.screenshot({ path: path.join(CAPTURES_DIR, 'ewaste-no-redirect.png'), fullPage: true });
            log('create', 'Screenshot saved: ewaste-no-redirect.png');
            await delay(300000);
            await browser.close();
            return;
        }

        log('create', `SUCCESS: Audience created with ID: ${audienceId}`);
    } catch (e) {
        log('create', `ERROR: ${e.message}`);
        log('create', `Stack: ${e.stack}`);
        await page.screenshot({ path: path.join(CAPTURES_DIR, 'ewaste-create-error.png'), fullPage: true });
        await browser.close();
        return;
    }

    // ══════════════════════════════════════════════════════════
    // STEP 5: WAIT ON AUDIENCE PAGE + DETECT DEPLOYMENT ID
    // ══════════════════════════════════════════════════════════
    try {
        log('page', `On audience page: ${page.url()}`);
        log('page', 'Waiting 3s for page to fully load...');
        await delay(3000);

        await page.screenshot({ path: path.join(CAPTURES_DIR, 'ewaste-audience-page.png'), fullPage: true });
        log('page', 'Screenshot saved: ewaste-audience-page.png');

        log('deploy', 'Scanning page source for deployment ID...');
        const deploymentId = await page.evaluate(() => {
            const html = document.documentElement.outerHTML;
            const m = html.match(/dpl_[A-Za-z0-9]+/);
            return m ? m[0] : null;
        });

        if (!deploymentId) {
            log('deploy', 'FATAL: No deployment ID found in page source.');
            await browser.close();
            return;
        }
        log('deploy', `Deployment ID: ${deploymentId}`);

        const pathname = `/home/${WORKSPACE_SLUG}/audience/${audienceId}`;
        const rstEncoded = encodeURIComponent(buildRST(audienceId));

        // ══════════════════════════════════════════════════════════
        // STEP 6: FIRE PREVIEW SERVER ACTION
        // ══════════════════════════════════════════════════════════
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

        log('preview', '══════════════════════════════════════');
        log('preview', 'FIRING PREVIEW SERVER ACTION');
        log('preview', `POST ${pathname}`);
        log('preview', `next-action: ${ACTIONS.PREVIEW}`);
        log('preview', `x-deployment-id: ${deploymentId}`);
        log('preview', `next-router-state-tree length: ${rstEncoded.length}`);
        log('preview', `Payload (full): ${JSON.stringify(previewPayload)}`);
        log('preview', '══════════════════════════════════════');

        const previewResult = await page.evaluate(async (pn, aid, pl, rst, depId) => {
            try {
                console.log('[BROWSER] Firing preview fetch to:', pn);
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
                console.log('[BROWSER] Preview response status:', res.status);
                console.log('[BROWSER] Preview response text:', text.substring(0, 200));
                return { status: res.status, ok: res.ok, text };
            } catch (e) {
                console.log('[BROWSER] Preview fetch error:', e.message);
                return { error: e.message };
            }
        }, pathname, ACTIONS.PREVIEW, previewPayload, rstEncoded, deploymentId);

        log('preview', `Status: ${previewResult.status}`);
        log('preview', `OK: ${previewResult.ok}`);
        log('preview', `Error: ${previewResult.error || 'none'}`);
        log('preview', `Response (full): ${previewResult.text}`);

        if (previewResult.error) {
            log('preview', `PREVIEW FETCH ERROR: ${previewResult.error}`);
            await browser.close();
            return;
        }

        let previewCount = 'unknown';
        if (previewResult.ok) {
            const cm = previewResult.text?.match(/"count"\s*:\s*(\d+)/);
            previewCount = cm?.[1] || 'unknown';
            log('preview', `PREVIEW SUCCESS — Count: ${previewCount}`);
        } else {
            const digest = previewResult.text?.match(/"digest"\s*:\s*"(\d+)"/);
            log('preview', `PREVIEW FAILED — HTTP ${previewResult.status} — digest: ${digest?.[1] || 'unknown'}`);

            if (previewResult.status === 404) {
                log('preview', 'Action ID is stale. Scanning for new IDs...');
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
                log('preview', `Found action IDs: ${JSON.stringify(ids)}`);
            }
            // Save network logs and exit
            const logFile = path.join(CAPTURES_DIR, `ewaste-network-${Date.now()}.json`);
            fs.writeFileSync(logFile, JSON.stringify({ networkLogs, previewResult }, null, 2));
            log('preview', `Network log saved: ${logFile}`);
            await delay(300000);
            await browser.close();
            return;
        }

        // ══════════════════════════════════════════════════════════
        // STEP 7: FIRE GENERATE SERVER ACTION
        // ══════════════════════════════════════════════════════════
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

        log('generate', '══════════════════════════════════════');
        log('generate', 'FIRING GENERATE SERVER ACTION');
        log('generate', `POST ${pathname}`);
        log('generate', `next-action: ${ACTIONS.GENERATE}`);
        log('generate', `x-deployment-id: ${deploymentId}`);
        log('generate', `Payload (full): ${JSON.stringify(generatePayload)}`);
        log('generate', '══════════════════════════════════════');

        const generateResult = await page.evaluate(async (pn, aid, pl, rst, depId) => {
            try {
                console.log('[BROWSER] Firing generate fetch to:', pn);
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
                console.log('[BROWSER] Generate response status:', res.status);
                return { status: res.status, ok: res.ok, text };
            } catch (e) {
                return { error: e.message };
            }
        }, pathname, ACTIONS.GENERATE, generatePayload, rstEncoded, deploymentId);

        log('generate', `Status: ${generateResult.status}`);
        log('generate', `OK: ${generateResult.ok}`);
        log('generate', `Error: ${generateResult.error || 'none'}`);
        log('generate', `Response (full): ${generateResult.text}`);

        if (generateResult.ok) {
            log('done', '══════════════════════════════════════');
            log('done', 'AUDIENCE GENERATING SUCCESSFULLY');
            log('done', `Name:  ${AUDIENCE_NAME}`);
            log('done', `ID:    ${audienceId}`);
            log('done', `Count: ${previewCount}`);
            log('done', `Topic: Sustainability & Green Living > Recycling & Waste Management > E-waste Management`);
            log('done', 'Status: In Queue → Hydrating → Completed');
            log('done', '══════════════════════════════════════');
        } else {
            const digest = generateResult.text?.match(/"digest"\s*:\s*"(\d+)"/);
            log('generate', `GENERATE FAILED — HTTP ${generateResult.status} — digest: ${digest?.[1] || 'unknown'}`);
        }

        // Save all network logs + results
        const logFile = path.join(CAPTURES_DIR, `ewaste-full-${audienceId}-${Date.now()}.json`);
        fs.writeFileSync(logFile, JSON.stringify({
            audienceId, name: AUDIENCE_NAME, deploymentId, previewCount,
            preview: { status: previewResult.status, ok: previewResult.ok, text: previewResult.text },
            generate: { status: generateResult.status, ok: generateResult.ok, text: generateResult.text },
            networkLogs
        }, null, 2));
        log('done', `Full log saved: ${logFile}`);

    } catch (e) {
        log('error', `UNCAUGHT ERROR: ${e.message}`);
        log('error', `Stack: ${e.stack}`);
        await page.screenshot({ path: path.join(CAPTURES_DIR, 'ewaste-uncaught-error.png'), fullPage: true });

        const logFile = path.join(CAPTURES_DIR, `ewaste-error-${Date.now()}.json`);
        fs.writeFileSync(logFile, JSON.stringify({ error: e.message, stack: e.stack, networkLogs }, null, 2));
        log('error', `Error log saved: ${logFile}`);
    }

    log('sleep', 'Browser open 5 min. Ctrl+C to close.');
    await delay(300000);
    await browser.close();
}

main().catch(e => { console.error(`[${new Date().toISOString()}] [FATAL] ${e.message}\n${e.stack}`); process.exit(1); });
