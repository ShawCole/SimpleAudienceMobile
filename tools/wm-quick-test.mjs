/**
 * Quick test: preview on Shaw's working audience with URL-encoded RST fix
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
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (m) env[m[1].trim()] = m[2].trim();
}
puppeteer.default.use(StealthPlugin());

const BASE_URL = 'https://app.intentcore.io';
const USER_DATA_DIR = path.join(ROOT, 'tools', '.chrome-wealth-mgmt-profile');
const WORKSPACE_SLUG = 'simple-audience';
const ACCOUNT_ID = 'fceffb3b-552d-413a-9442-e62e9d423aa0';
const AUDIENCE_ID = 'a4666209-caa6-4a93-80db-dea6abf7470f';
const PREVIEW_ACTION = '7f2fedc1659914fecb5d57837dc4b06ab5c2e0e744';
const DEPLOYMENT_ID = 'dpl_9cFrMNRqDM2AorX4o5sGU3X9uo8S';

const lockFile = path.join(USER_DATA_DIR, 'SingletonLock');
if (fs.existsSync(lockFile)) fs.unlinkSync(lockFile);

const browser = await puppeteer.default.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: false,
    userDataDir: USER_DATA_DIR,
    args: ['--no-sandbox', '--window-size=1400,1024'],
    defaultViewport: null
});

const page = await browser.newPage();
await page.goto(`${BASE_URL}/auth/sign-in`, { waitUntil: 'load', timeout: 30000 });
if (page.url().includes('sign-in')) {
    await page.waitForSelector('input[type="email"]', { visible: true, timeout: 10000 });
    await page.type('input[type="email"]', env.SIMPLEAUDIENCE_EMAIL, { delay: 50 });
    await page.waitForSelector('input[type="password"]', { visible: true, timeout: 5000 });
    await page.type('input[type="password"]', env.SIMPLEAUDIENCE_PASSWORD, { delay: 50 });
    await Promise.all([
        page.waitForNavigation({ waitUntil: 'load', timeout: 30000 }),
        page.click('button[type="submit"]')
    ]);
}
const cur = page.url();
if (cur.includes('/home') && !cur.includes('simple-audience')) {
    await page.evaluate(() => {
        const l = Array.from(document.querySelectorAll('a')).find(a => a.href.includes('/home/simple-audience'));
        if (l) l.click();
    });
    await page.waitForNavigation({ waitUntil: 'load', timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(2000);
}
console.log(`Logged in: ${page.url()}\n`);

// Navigate to audience
await page.goto(`${BASE_URL}/home/${WORKSPACE_SLUG}/audience/${AUDIENCE_ID}`, { waitUntil: 'networkidle2', timeout: 60000 });
await page.waitForTimeout(3000);
console.log(`On audience page: ${page.url()}\n`);

// Build payload matching intercepted real request
const payload = [{"accountId":ACCOUNT_ID,"id":AUDIENCE_ID,"filters":{"audience":{"type":"premade","b2b":null,"customTopic":"","customDescription":"","segmentSearches":["Financial Services > Retirement & College Savings > Wealth Management Services"]},"jobId":"","segment":["4eyes_101950"],"score":["medium","high"],"daysBack":7,"filters":{"age":{"minAge":null,"maxAge":null},"city":[],"state":[],"zip":[],"gender":[],"profile":{"incomeRange":[],"homeowner":[],"married":[],"netWorth":["$$500,000 to $749,999","$$750,000 to $999,999","more than $1,000,000"],"children":[]},"businessProfile":{"companyDescription":[],"jobTitle":[],"seniority":[],"department":[],"companyName":[],"companyDomain":[],"industry":[],"sic":[],"employeeCount":[],"companyRevenue":[],"companyNaics":[]},"attributes":{"credit_rating":[],"language_code":[],"occupation_group":[],"occupation_type":[],"home_year_built":{"min":null,"max":null},"single_parent":[],"cra_code":[],"dwelling_type":[],"credit_range_new_credit":[],"ethnic_code":[],"marital_status":[],"net_worth":[],"education":[],"credit_card_user":[],"investment":[],"smoker":[],"home_purchase_price":{"min":null,"max":null},"home_purchase_year":{"min":null,"max":null},"home_purchase_month":[],"estimated_home_value":[],"mortgage_amount":{"min":null,"max":null},"generations_in_household":[]},"notNulls":[],"nullOnly":[]}}}];

// Build URL-encoded router state tree (THE FIX)
const rst = JSON.stringify(
    ["", {"children":["home",{"children":[["account",WORKSPACE_SLUG,"d"],{"children":["audience",{"children":[["id",AUDIENCE_ID,"d"],{"children":["__PAGE__",{},null,null]},null,null]},null,null]},null,null]},null,null]},null,null,true]
);
const encodedRst = encodeURIComponent(rst);

console.log('Sending Preview with URL-encoded RST...');
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
        return { status: res.status, ok: res.ok, text: text.substring(0, 3000) };
    } catch (e) {
        return { error: e.message };
    }
}, `/home/${WORKSPACE_SLUG}/audience/${AUDIENCE_ID}`, PREVIEW_ACTION, payload, encodedRst, DEPLOYMENT_ID);

console.log(`Status: ${result.status} | OK: ${result.ok}`);
if (result.ok) {
    const countMatch = result.text?.match(/"count"\s*:\s*(\d+)/);
    console.log(`COUNT: ${countMatch?.[1] || 'not found'}`);
}
console.log(`Response: ${result.text?.substring(0, 500)}`);

await page.waitForTimeout(5000);
await browser.close();
console.log('Done.');
