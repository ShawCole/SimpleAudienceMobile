/**
 * Injection Diagnostic — captures the real browser Preview request
 * vs our injection to find the mismatch.
 *
 * Usage:
 *   node tools/injection-diag.mjs --audience <uuid>
 *   node tools/injection-diag.mjs   (uses the test audience created earlier)
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

const BASE_URL = env.SIMPLEAUDIENCE_BASE_URL || 'https://app.intentcore.io';
const EMAIL = env.SIMPLEAUDIENCE_EMAIL;
const PASSWORD = env.SIMPLEAUDIENCE_PASSWORD;
const USER_DATA_DIR = path.join(ROOT, 'tools', '.chrome-diag-profile');
const CAPTURES_DIR = path.join(ROOT, 'tools', 'captures');

if (!fs.existsSync(CAPTURES_DIR)) fs.mkdirSync(CAPTURES_DIR, { recursive: true });

const WORKSPACE_SLUG = 'simple-audience';
const ACCOUNT_ID = 'fceffb3b-552d-413a-9442-e62e9d423aa0';

// Parse CLI args
const audienceIdx = process.argv.indexOf('--audience');
const AUDIENCE_ID = audienceIdx !== -1
    ? process.argv[audienceIdx + 1]
    : '2ad169a1-6f29-456f-90a2-08ca24ed4135'; // test audience from earlier

async function main() {
    console.log('═'.repeat(60));
    console.log('  INJECTION DIAGNOSTIC');
    console.log(`  Audience: ${AUDIENCE_ID}`);
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

    // ── LOGIN ──
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

    // Navigate into workspace
    if (page.url() === `${BASE_URL}/home` || page.url() === `${BASE_URL}/home/`) {
        await page.evaluate((slug) => {
            const links = Array.from(document.querySelectorAll('a'));
            const target = links.find(a => a.href.includes(`/home/${slug}`));
            if (target) target.click();
        }, WORKSPACE_SLUG);
        await page.waitForNavigation({ waitUntil: 'load', timeout: 30000 }).catch(() => {});
        await page.waitForTimeout(2000);
    }
    console.log(`   📍 URL: ${page.url()}\n`);

    // ── NAVIGATE TO AUDIENCE ──
    const audienceUrl = `${BASE_URL}/home/${WORKSPACE_SLUG}/audience/${AUDIENCE_ID}`;
    console.log(`Navigating to audience page: ${audienceUrl}`);
    await page.goto(audienceUrl, { waitUntil: 'networkidle2', timeout: 60000 });
    await page.waitForTimeout(5000);
    console.log(`📍 Current URL: ${page.url()}\n`);

    // ── STEP 1: DETECT DEPLOYMENT ID ──
    console.log('── STEP 1: Detect Deployment ID ──');

    // From page source
    const dplFromSource = await page.evaluate(() => {
        const html = document.documentElement.outerHTML;
        const match = html.match(/dpl_[A-Za-z0-9]+/);
        return match ? match[0] : null;
    });
    console.log(`   From page source: ${dplFromSource || 'NOT FOUND'}`);

    // From response headers via a HEAD request
    const dplFromHeaders = await page.evaluate(async () => {
        try {
            const res = await fetch(window.location.href, { method: 'HEAD' });
            return res.headers.get('x-deployment-id');
        } catch { return null; }
    });
    console.log(`   From response headers: ${dplFromHeaders || 'NOT FOUND'}`);

    const DEPLOYMENT_ID = dplFromSource || dplFromHeaders || 'dpl_3Jq2xYTjAQXwfkA9Pv9W1ZB2Sj27';
    console.log(`   Using: ${DEPLOYMENT_ID}\n`);

    // ── STEP 2: SCAN FOR ACTION IDS ──
    console.log('── STEP 2: Scan for Action IDs in page scripts ──');
    const actionIds = await page.evaluate(() => {
        const ids = new Set();
        // Check inline scripts
        document.querySelectorAll('script').forEach(script => {
            const text = script.textContent || '';
            const matches = text.matchAll(/(7f[0-9a-f]{38,42})/g);
            for (const m of matches) ids.add(m[1]);
        });
        // Check __next_f data chunks
        if (window.__next_f) {
            for (const chunk of window.__next_f) {
                if (typeof chunk[1] === 'string') {
                    const matches = chunk[1].matchAll(/(7f[0-9a-f]{38,42})/g);
                    for (const m of matches) ids.add(m[1]);
                }
            }
        }
        return Array.from(ids);
    });

    console.log(`   Found ${actionIds.length} action ID(s):`);
    actionIds.forEach(id => console.log(`   - ${id}`));

    const KNOWN_PREVIEW = '7f2fedc1659914fecb5d57837dc4b06ab5c2e0e744';
    const KNOWN_GENERATE = '7f437ee100a328c3149f7f41b6ef0aa67929d43bcc';
    console.log(`   Known PREVIEW (${KNOWN_PREVIEW}): ${actionIds.includes(KNOWN_PREVIEW) ? '✅ FOUND' : '❌ NOT FOUND'}`);
    console.log(`   Known GENERATE (${KNOWN_GENERATE}): ${actionIds.includes(KNOWN_GENERATE) ? '✅ FOUND' : '❌ NOT FOUND'}`);
    console.log('');

    // ── STEP 3: SET UP REQUEST INTERCEPTION ──
    console.log('── STEP 3: Intercepting network requests ──');
    console.log('   Capturing all POST requests to detect server action calls...\n');

    const capturedRequests = [];
    await page.setRequestInterception(true);
    page.on('request', (req) => {
        if (req.method() === 'POST' && req.headers()['next-action']) {
            const headers = req.headers();
            let body;
            try { body = req.postData(); } catch { body = null; }
            capturedRequests.push({
                url: req.url(),
                actionId: headers['next-action'],
                deploymentId: headers['x-deployment-id'],
                rst: headers['next-router-state-tree'],
                contentType: headers['content-type'],
                accept: headers['accept'],
                body: body,
                timestamp: new Date().toISOString()
            });
            console.log(`   🔵 CAPTURED: POST ${req.url()}`);
            console.log(`      action: ${headers['next-action']}`);
            console.log(`      deployment: ${headers['x-deployment-id']}`);
            console.log(`      body length: ${body?.length || 0}`);
            console.log(`      body preview: ${body?.substring(0, 200)}`);
            console.log('');
        }
        req.continue();
    });

    // ── STEP 4: OUR INJECTION ATTEMPT ──
    console.log('── STEP 4: Running our Preview injection ──');

    // Use the action IDs found in the page if available, otherwise fallback
    const previewActionId = actionIds.find(id => id.startsWith('7f') && id.length >= 40) || KNOWN_PREVIEW;
    // Actually let's try with our known ID first, and if the page has different ones, we log both
    console.log(`   Using Preview action ID: ${KNOWN_PREVIEW}`);

    const filters = {
        audience: {
            type: "premade",
            b2b: null,
            customTopic: "",
            customDescription: "",
            segmentSearches: ["Financial Services > Retirement & College Savings > Wealth Management Services"]
        },
        jobId: "",
        segment: [],
        score: ["medium"],
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
                netWorth: ["$500,000 to $749,999", "$750,000 to $999,999", "more than $1,000,000"],
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

    const routerStateTree = JSON.stringify(
        ["", { "children": ["home", { "children": [["account", WORKSPACE_SLUG, "d"], { "children": ["audience", { "children": [["id", AUDIENCE_ID, "d"], { "children": ["__PAGE__", {}, null, null] }, null, null] }, null, null] }, null, null] }, null, null] }, null, null, true]
    );

    const previewPayload = [{
        accountId: ACCOUNT_ID,
        id: AUDIENCE_ID,
        filters: filters
    }];

    console.log('   Payload preview (first 500 chars):');
    console.log(`   ${JSON.stringify(previewPayload).substring(0, 500)}`);
    console.log(`   RST (decoded, first 200 chars): ${routerStateTree.substring(0, 200)}`);
    console.log(`   RST (encoded, first 200 chars): ${encodeURIComponent(routerStateTree).substring(0, 200)}`);
    console.log(`   Deployment ID: ${DEPLOYMENT_ID}`);
    console.log('');

    // Run the injection
    const encodedRst = encodeURIComponent(routerStateTree);
    const result = await page.evaluate(async (pn, aid, pl, rst, depId) => {
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
            const respHeaders = {};
            res.headers.forEach((v, k) => { respHeaders[k] = v; });
            return { status: res.status, ok: res.ok, text, headers: respHeaders };
        } catch (e) {
            return { error: e.message };
        }
    }, `/home/${WORKSPACE_SLUG}/audience/${AUDIENCE_ID}`, KNOWN_PREVIEW, previewPayload, encodedRst, DEPLOYMENT_ID);

    console.log('── INJECTION RESULT ──');
    console.log(`   Status: ${result.status} (ok: ${result.ok})`);
    console.log(`   Response headers: ${JSON.stringify(result.headers, null, 2)}`);
    console.log(`   Response body (full):`);
    console.log(`   ${result.text}`);
    console.log('');

    if (result.error) {
        console.log(`   ❌ Error: ${result.error}`);
    }

    // ── STEP 5: PROMPT USER TO CLICK PREVIEW MANUALLY ──
    console.log('── STEP 5: Manual comparison ──');
    console.log('   👉 NOW CLICK THE PREVIEW BUTTON IN THE BROWSER MANUALLY');
    console.log('   I will capture the real request and compare it to our injection.');
    console.log('   Waiting 120 seconds for manual interaction...\n');

    await page.waitForTimeout(120000);

    // ── SAVE ALL CAPTURES ──
    const diagFile = path.join(CAPTURES_DIR, `injection-diag-${Date.now()}.json`);
    fs.writeFileSync(diagFile, JSON.stringify({
        audienceId: AUDIENCE_ID,
        detectedDeploymentId: DEPLOYMENT_ID,
        dplFromSource,
        dplFromHeaders,
        actionIdsInPage: actionIds,
        knownPreviewFound: actionIds.includes(KNOWN_PREVIEW),
        knownGenerateFound: actionIds.includes(KNOWN_GENERATE),
        ourInjection: {
            actionId: KNOWN_PREVIEW,
            deploymentId: DEPLOYMENT_ID,
            payload: previewPayload,
            rst: routerStateTree,
            result: {
                status: result.status,
                ok: result.ok,
                text: result.text,
                headers: result.headers
            }
        },
        capturedBrowserRequests: capturedRequests
    }, null, 2));

    console.log(`\n💾 Full diagnostic saved to: ${diagFile}`);
    console.log(`   Captured ${capturedRequests.length} browser request(s)\n`);

    if (capturedRequests.length > 0) {
        console.log('── COMPARISON: Our injection vs Browser request ──');
        const browserReq = capturedRequests[capturedRequests.length - 1];

        console.log('\n   DEPLOYMENT ID:');
        console.log(`     Ours:    ${DEPLOYMENT_ID}`);
        console.log(`     Browser: ${browserReq.deploymentId}`);
        console.log(`     Match:   ${DEPLOYMENT_ID === browserReq.deploymentId ? '✅' : '❌ MISMATCH'}`);

        console.log('\n   ACTION ID:');
        console.log(`     Ours:    ${KNOWN_PREVIEW}`);
        console.log(`     Browser: ${browserReq.actionId}`);
        console.log(`     Match:   ${KNOWN_PREVIEW === browserReq.actionId ? '✅' : '❌ MISMATCH'}`);

        console.log('\n   CONTENT TYPE:');
        console.log(`     Ours:    text/plain;charset=UTF-8`);
        console.log(`     Browser: ${browserReq.contentType}`);

        console.log('\n   RST (first 100 decoded chars):');
        try {
            const ourRstDecoded = routerStateTree.substring(0, 100);
            const browserRstDecoded = decodeURIComponent(browserReq.rst).substring(0, 100);
            console.log(`     Ours:    ${ourRstDecoded}`);
            console.log(`     Browser: ${browserRstDecoded}`);
        } catch {
            console.log(`     Browser (raw): ${browserReq.rst?.substring(0, 100)}`);
        }

        console.log('\n   BODY (first 300 chars):');
        console.log(`     Ours:    ${JSON.stringify(previewPayload).substring(0, 300)}`);
        console.log(`     Browser: ${browserReq.body?.substring(0, 300)}`);

        // Deep comparison of payloads
        if (browserReq.body) {
            try {
                const browserPayload = JSON.parse(browserReq.body);
                const ourPayloadStr = JSON.stringify(previewPayload, Object.keys(previewPayload[0]).sort());
                const browserPayloadStr = JSON.stringify(browserPayload, Object.keys(browserPayload[0] || {}).sort());

                // Find key differences
                const ourKeys = Object.keys(previewPayload[0]);
                const browserKeys = Object.keys(browserPayload[0] || {});
                const missingInOurs = browserKeys.filter(k => !ourKeys.includes(k));
                const extraInOurs = ourKeys.filter(k => !browserKeys.includes(k));

                if (missingInOurs.length > 0) {
                    console.log(`\n   ❌ MISSING FROM OUR PAYLOAD: ${missingInOurs.join(', ')}`);
                }
                if (extraInOurs.length > 0) {
                    console.log(`\n   ⚠️  EXTRA IN OUR PAYLOAD: ${extraInOurs.join(', ')}`);
                }

                // Compare filter structures
                if (browserPayload[0]?.filters) {
                    const ourFilterKeys = Object.keys(previewPayload[0].filters);
                    const browserFilterKeys = Object.keys(browserPayload[0].filters);
                    const missingFilters = browserFilterKeys.filter(k => !ourFilterKeys.includes(k));
                    const extraFilters = ourFilterKeys.filter(k => !browserFilterKeys.includes(k));

                    if (missingFilters.length > 0) {
                        console.log(`   ❌ MISSING FILTER KEYS: ${missingFilters.join(', ')}`);
                    }
                    if (extraFilters.length > 0) {
                        console.log(`   ⚠️  EXTRA FILTER KEYS: ${extraFilters.join(', ')}`);
                    }
                }
            } catch (e) {
                console.log(`   Could not parse browser payload: ${e.message}`);
            }
        }
    }

    console.log('\n🔍 Browser staying open for 3 more minutes for manual inspection...');
    console.log('   Press Ctrl+C to close early.\n');
    await page.waitForTimeout(180000);

    await browser.close();
    console.log('🏁 Done.');
}

main().catch(e => {
    console.error('Fatal:', e);
    process.exit(1);
});
