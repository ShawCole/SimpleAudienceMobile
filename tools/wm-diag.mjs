/**
 * Diagnostic: test preview with Shaw's known-working audience ID + payload
 * Compare against our script's approach to isolate the 500 error cause.
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

const BASE_URL = env.SIMPLEAUDIENCE_BASE_URL || 'https://app.intentcore.io';
const EMAIL = env.SIMPLEAUDIENCE_EMAIL;
const PASSWORD = env.SIMPLEAUDIENCE_PASSWORD;
const USER_DATA_DIR = path.join(ROOT, 'tools', '.chrome-wealth-mgmt-profile');
const WORKSPACE_SLUG = 'simple-audience';

// Shaw's known-working audience from the DevTools capture
const TEST_AUDIENCE_ID = 'a4666209-caa6-4a93-80db-dea6abf7470f';
// Our audience IDs
const OUR_HIGH_ID = '9496f7af-d945-4d6e-a64c-6bd26b5da18e';
const OUR_MEDIUM_ID = 'ba66149f-1511-48ad-9364-c3fd1a2a507b';

const ACCOUNT_ID = 'fceffb3b-552d-413a-9442-e62e9d423aa0';
const PREVIEW_ACTION = '7f2fedc1659914fecb5d57837dc4b06ab5c2e0e744';
const DEPLOYMENT_ID = 'dpl_9cFrMNRqDM2AorX4o5sGU3X9uo8S';

// Exact payload from Shaw's browser capture
const SHAWS_PAYLOAD = [{"accountId":"fceffb3b-552d-413a-9442-e62e9d423aa0","id":"a4666209-caa6-4a93-80db-dea6abf7470f","filters":{"audience":{"type":"premade","b2b":null,"customTopic":"","customDescription":"","segmentSearches":["Financial Services > Retirement & College Savings > Wealth Management Services"]},"jobId":"","segment":[],"daysBack":7,"score":["medium","high"],"filters":{"age":{"minAge":null,"maxAge":null},"city":[],"state":[],"zip":[],"gender":[],"profile":{"incomeRange":[],"homeowner":[],"married":[],"netWorth":["$500,000 to $749,999","$750,000 to $999,999","more than $1,000,000"],"children":[]},"businessProfile":{"companyDescription":[],"jobTitle":[],"seniority":[],"department":[],"companyName":[],"companyDomain":[],"industry":[],"sic":[],"employeeCount":[],"companyRevenue":[],"companyNaics":[]},"attributes":{"credit_rating":[],"language_code":[],"occupation_group":[],"occupation_type":[],"home_year_built":{"min":null,"max":null},"single_parent":[],"cra_code":[],"dwelling_type":[],"credit_range_new_credit":[],"ethnic_code":[],"marital_status":[],"net_worth":[],"education":[],"credit_card_user":[],"investment":[],"smoker":[],"home_purchase_price":{"min":null,"max":null},"home_purchase_year":{"min":null,"max":null},"home_purchase_month":[],"estimated_home_value":[],"mortgage_amount":{"min":null,"max":null},"generations_in_household":[]},"notNulls":[],"nullOnly":[]}}}];

// Same payload but with our high-intent audience ID
const OUR_HIGH_PAYLOAD = JSON.parse(JSON.stringify(SHAWS_PAYLOAD));
OUR_HIGH_PAYLOAD[0].id = OUR_HIGH_ID;
OUR_HIGH_PAYLOAD[0].filters.score = ['high'];

function buildRouterStateTree(audienceId) {
    return JSON.stringify(
        ["", { "children": ["home", { "children": [["account", WORKSPACE_SLUG, "d"], { "children": ["audience", { "children": [["id", audienceId, "d"], { "children": ["__PAGE__", {}, null, null] }, null, null] }, null, null] }, null, null] }, null, null] }, null, null, true]
    );
}

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

// Login
console.log('Logging in...');
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
}
if (page.url() === `${BASE_URL}/home` || page.url() === `${BASE_URL}/home/`) {
    await page.evaluate((slug) => {
        const links = Array.from(document.querySelectorAll('a'));
        const target = links.find(a => a.href.includes(`/home/${slug}`));
        if (target) target.click();
    }, WORKSPACE_SLUG);
    await page.waitForNavigation({ waitUntil: 'load', timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(2000);
}
console.log(`Logged in. URL: ${page.url()}\n`);

// ── TEST 1: Shaw's exact audience ID + payload ──
console.log('═══ TEST 1: Shaw\'s exact audience + payload ═══');
const url1 = `${BASE_URL}/home/${WORKSPACE_SLUG}/audience/${TEST_AUDIENCE_ID}`;
console.log(`Navigating to: ${url1}`);
await page.goto(url1, { waitUntil: 'networkidle2', timeout: 60000 });
await page.waitForTimeout(3000);
console.log(`Page title: ${await page.title()}`);
console.log(`Page URL: ${page.url()}`);

// Check if the page has an error or loaded correctly
const pageCheck1 = await page.evaluate(() => {
    return {
        bodyText: document.body?.innerText?.substring(0, 500),
        hasError: document.body?.innerText?.includes('404') || document.body?.innerText?.includes('not found'),
    };
});
console.log(`Has error on page: ${pageCheck1.hasError}`);
console.log(`Page snippet: ${pageCheck1.bodyText?.substring(0, 200)}\n`);

const rst1 = buildRouterStateTree(TEST_AUDIENCE_ID);
const result1 = await page.evaluate(async (pn, aid, pl, rst, depId) => {
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
        return { status: res.status, ok: res.ok, text: text.substring(0, 2000), headers: Object.fromEntries(res.headers.entries()) };
    } catch (e) {
        return { error: e.message };
    }
}, `/home/${WORKSPACE_SLUG}/audience/${TEST_AUDIENCE_ID}`, PREVIEW_ACTION, SHAWS_PAYLOAD, rst1, DEPLOYMENT_ID);

console.log(`Result 1 status: ${result1.status} ok: ${result1.ok}`);
console.log(`Result 1 text: ${result1.text?.substring(0, 500)}`);
console.log(`Result 1 headers:`, JSON.stringify(result1.headers, null, 2));
console.log('');

// ── TEST 2: Our high-intent audience ID ──
console.log('═══ TEST 2: Our high-intent audience ID ═══');
const url2 = `${BASE_URL}/home/${WORKSPACE_SLUG}/audience/${OUR_HIGH_ID}`;
console.log(`Navigating to: ${url2}`);
await page.goto(url2, { waitUntil: 'networkidle2', timeout: 60000 });
await page.waitForTimeout(3000);
console.log(`Page URL: ${page.url()}`);

const pageCheck2 = await page.evaluate(() => {
    return {
        bodyText: document.body?.innerText?.substring(0, 500),
        hasError: document.body?.innerText?.includes('404') || document.body?.innerText?.includes('not found'),
    };
});
console.log(`Has error on page: ${pageCheck2.hasError}`);
console.log(`Page snippet: ${pageCheck2.bodyText?.substring(0, 200)}\n`);

const rst2 = buildRouterStateTree(OUR_HIGH_ID);
const result2 = await page.evaluate(async (pn, aid, pl, rst, depId) => {
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
        return { status: res.status, ok: res.ok, text: text.substring(0, 2000), headers: Object.fromEntries(res.headers.entries()) };
    } catch (e) {
        return { error: e.message };
    }
}, `/home/${WORKSPACE_SLUG}/audience/${OUR_HIGH_ID}`, PREVIEW_ACTION, OUR_HIGH_PAYLOAD, rst2, DEPLOYMENT_ID);

console.log(`Result 2 status: ${result2.status} ok: ${result2.ok}`);
console.log(`Result 2 text: ${result2.text?.substring(0, 500)}`);
console.log('');

// ── TEST 3: Shaw's payload but with our audience ID (test if it's the ID or the payload) ──
console.log('═══ TEST 3: Shaw\'s payload structure + our high ID ═══');
const hybridPayload = JSON.parse(JSON.stringify(SHAWS_PAYLOAD));
hybridPayload[0].id = OUR_HIGH_ID;
// Keep score as ["medium","high"] from Shaw's capture

const result3 = await page.evaluate(async (pn, aid, pl, rst, depId) => {
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
        return { status: res.status, ok: res.ok, text: text.substring(0, 2000) };
    } catch (e) {
        return { error: e.message };
    }
}, `/home/${WORKSPACE_SLUG}/audience/${OUR_HIGH_ID}`, PREVIEW_ACTION, hybridPayload, rst2, DEPLOYMENT_ID);

console.log(`Result 3 status: ${result3.status} ok: ${result3.ok}`);
console.log(`Result 3 text: ${result3.text?.substring(0, 500)}`);
console.log('');

// Save all results
const diagOutput = { result1, result2, result3, pageCheck1, pageCheck2 };
fs.writeFileSync(path.join(ROOT, 'tools', 'captures', 'wm-diagnostic.json'), JSON.stringify(diagOutput, null, 2));
console.log('Saved diagnostic results to tools/captures/wm-diagnostic.json');

console.log('\nClosing in 15s...');
await page.waitForTimeout(15000);
await browser.close();
