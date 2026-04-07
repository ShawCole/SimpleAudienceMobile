/**
 * E-Waste Recycling Audience Injection
 *
 * Creates an audience on IntentCore for e-waste recycling intent
 * targeting Medical/Dental, Law Firms, and Educational Institutions.
 *
 * Usage:
 *   node tools/inject-ewaste.mjs
 *   node tools/inject-ewaste.mjs --audience <existing-uuid>
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

const ACTIONS = {
    PREVIEW: '7f2fedc1659914fecb5d57837dc4b06ab5c2e0e744',
    GENERATE: '7f437ee100a328c3149f7f41b6ef0aa67929d43bcc',
    CREATE_AUDIENCE: '7ffaba0e7b99bdefb0ee5b9715f0f99be2eb57cfbf',
};

const AUDIENCE_NAME = 'E-Waste Recycling Intent - Medical Dental Legal Education - SC';

// Parse CLI
const args = process.argv.slice(2);
function getArg(flag) {
    const idx = args.indexOf(flag);
    return idx !== -1 ? args[idx + 1] : null;
}
const ARG_AUDIENCE = getArg('--audience');

// ── Build the e-waste payload (exact shape from Shaw's captured payload) ──
function buildPreviewPayload(audienceId) {
    return [{
        accountId: ACCOUNT_ID,
        id: audienceId,
        filters: {
            audience: {
                type: "premade",
                b2b: null,
                customTopic: "",
                customDescription: "",
                segmentSearches: ["Sustainability & Green Living > Recycling & Waste Management > E-waste Management"]
            },
            jobId: "",
            segment: [],
            daysBack: 7,
            score: [],
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
                    netWorth: [],
                    children: []
                },
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
                    generations_in_household: [],
                    religion_code: []
                },
                notNulls: [],
                nullOnly: []
            }
        }
    }];
}

function buildRST(audienceId) {
    return JSON.stringify(
        ["", { "children": ["home", { "children": [["account", WORKSPACE_SLUG, "d"], { "children": ["audience", { "children": [["id", audienceId, "d"], { "children": ["__PAGE__", {}, null, null] }, null, null] }, null, null] }, null, null] }, null, null] }, null, null, true]
    );
}

async function serverAction(page, pathname, actionId, payload, rst, deploymentId) {
    const encodedRst = encodeURIComponent(rst);
    return page.evaluate(async (pn, aid, pl, rstEnc, depId) => {
        try {
            const res = await fetch(pn, {
                method: 'POST',
                headers: {
                    'accept': 'text/x-component',
                    'content-type': 'text/plain;charset=UTF-8',
                    'next-action': aid,
                    'next-router-state-tree': rstEnc,
                    'x-deployment-id': depId,
                },
                body: JSON.stringify(pl)
            });
            const text = await res.text();
            const hdrs = {};
            res.headers.forEach((v, k) => { hdrs[k] = v; });
            return { status: res.status, ok: res.ok, text, headers: hdrs };
        } catch (e) {
            return { error: e.message };
        }
    }, pathname, actionId, payload, encodedRst, deploymentId);
}

async function getDeploymentId(page) {
    const fromSource = await page.evaluate(() => {
        const html = document.documentElement.outerHTML;
        const m = html.match(/dpl_[A-Za-z0-9]+/);
        return m ? m[0] : null;
    });
    if (fromSource) return fromSource;

    const fromHeaders = await page.evaluate(async () => {
        try {
            const res = await fetch(window.location.href, { method: 'HEAD' });
            return res.headers.get('x-deployment-id');
        } catch { return null; }
    });
    return fromHeaders || null;
}

// ── MAIN ──
async function main() {
    console.log('═'.repeat(60));
    console.log('  E-WASTE RECYCLING AUDIENCE INJECTION');
    console.log(`  Name:  ${AUDIENCE_NAME}`);
    console.log(`  Topic: Sustainability & Green Living > Recycling & Waste Management > E-waste Management`);
    console.log(`  Score: [] (all scores)`);
    console.log(`  Filters: None (topic-only, no industry/b2b/geo filters)`);
    console.log('═'.repeat(60) + '\n');

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

    // ── NAVIGATE TO WORKSPACE (critical — must select simple-audience subaccount) ──
    console.log('[workspace] Navigating to simple-audience workspace...');
    await page.goto(`${BASE_URL}/home/${WORKSPACE_SLUG}`, { waitUntil: 'load', timeout: 30000 });
    await delay(3000);
    console.log(`[workspace] URL: ${page.url()}\n`);

    let audienceId = ARG_AUDIENCE;

    // ── CREATE AUDIENCE ──
    if (!audienceId) {
        console.log(`[create] Creating audience: "${AUDIENCE_NAME}"`);
        await page.goto(`${BASE_URL}/home/${WORKSPACE_SLUG}/audience`, { waitUntil: 'load', timeout: 30000 });
        await delay(3000);

        const clicked = await page.evaluate(() => {
            const btns = Array.from(document.querySelectorAll('button, a'));
            const btn = btns.find(b => b.textContent?.trim() === 'Create');
            if (btn) { btn.click(); return true; }
            return false;
        });
        if (!clicked) {
            console.log('[create] Could not find Create button! Taking screenshot...');
            await page.screenshot({ path: path.join(CAPTURES_DIR, 'ewaste-no-create-btn.png'), fullPage: true });
            await browser.close();
            return;
        }

        await delay(2000);
        const input = await page.waitForSelector('div[role="dialog"] form input[name="name"], div[role="dialog"] input', { visible: true, timeout: 10000 });
        await input.click({ clickCount: 3 });
        await input.type(AUDIENCE_NAME, { delay: 30 });

        await page.evaluate(() => {
            const dialog = document.querySelector('div[role="dialog"]');
            const btns = Array.from(dialog.querySelectorAll('button'));
            const submit = btns.find(b => b.textContent?.trim() === 'Create' || b.type === 'submit');
            if (submit) submit.click();
        });

        await page.waitForNavigation({ waitUntil: 'load', timeout: 30000 }).catch(() => {});
        await delay(3000);

        const match = page.url().match(/\/audience\/([0-9a-f-]+)/);
        if (!match) {
            console.log(`[create] Could not get audience ID from URL: ${page.url()}`);
            await page.screenshot({ path: path.join(CAPTURES_DIR, 'ewaste-no-uuid.png'), fullPage: true });
            await browser.close();
            return;
        }
        audienceId = match[1];
        console.log(`[create] Created: ${audienceId}\n`);
    }

    // ── NAVIGATE TO AUDIENCE PAGE ──
    const audUrl = `${BASE_URL}/home/${WORKSPACE_SLUG}/audience/${audienceId}`;
    console.log(`[nav] Loading audience page: ${audUrl}`);
    await page.goto(audUrl, { waitUntil: 'networkidle2', timeout: 60000 });
    await delay(5000);
    console.log(`[nav] URL: ${page.url()}\n`);

    // ── DETECT DEPLOYMENT ID ──
    const deploymentId = await getDeploymentId(page);
    if (!deploymentId) {
        console.log('[deploy] FATAL: Could not detect deployment ID');
        await page.screenshot({ path: path.join(CAPTURES_DIR, 'ewaste-no-deploy-id.png'), fullPage: true });
        await browser.close();
        return;
    }
    console.log(`[deploy] Deployment ID: ${deploymentId}\n`);

    const rst = buildRST(audienceId);
    const pathname = `/home/${WORKSPACE_SLUG}/audience/${audienceId}`;

    // ── PREVIEW ──
    const payload = buildPreviewPayload(audienceId);
    console.log('[preview] Injecting preview...');
    console.log(`[preview] Topic: ${payload[0].filters.audience.segmentSearches[0]}`);
    console.log(`[preview] Action ID: ${ACTIONS.PREVIEW}`);

    const previewResult = await serverAction(page, pathname, ACTIONS.PREVIEW, payload, rst, deploymentId);

    console.log(`[preview] Status: ${previewResult.status} (ok: ${previewResult.ok})`);
    console.log(`[preview] Response: ${previewResult.text?.substring(0, 500)}`);

    let previewCount = 'unknown';
    if (previewResult.ok) {
        const cm = previewResult.text?.match(/"count"\s*:\s*(\d+)/);
        previewCount = cm?.[1] || 'unknown';
        console.log(`[preview] SUCCESS — Count: ${previewCount}\n`);
    } else {
        const digest = previewResult.text?.match(/"digest"\s*:\s*"(\d+)"/);
        console.log(`[preview] FAILED — digest: ${digest?.[1] || 'unknown'}`);

        if (previewResult.status === 404) {
            console.log('[preview] 404 — action ID is stale. Need to re-capture from DevTools.');
            // Try to find new action IDs
            const newIds = await page.evaluate(() => {
                const ids = [];
                if (window.__next_f) {
                    for (const chunk of window.__next_f) {
                        if (typeof chunk[1] === 'string') {
                            const matches = chunk[1].matchAll(/(7f[0-9a-f]{38,42})/g);
                            for (const m of matches) ids.push(m[1]);
                        }
                    }
                }
                return [...new Set(ids)];
            });
            if (newIds.length > 0) {
                console.log(`[preview] Found ${newIds.length} action IDs in page:`);
                newIds.forEach(id => console.log(`   ${id}`));
            }
        }

        await page.screenshot({ path: path.join(CAPTURES_DIR, 'ewaste-preview-fail.png'), fullPage: true });
        console.log('[preview] Screenshot saved. Browser stays open for debugging.');
        await delay(300000);
        await browser.close();
        return;
    }

    // ── GENERATE ──
    console.log('[generate] Running generate injection...');
    const { id, ...rest } = payload[0];
    const generatePayload = [{
        ...rest,
        audienceId: audienceId,
        hasSegmentChanged: true,
        resolveIntents: true
    }];

    console.log(`[generate] Action ID: ${ACTIONS.GENERATE}`);

    const generateResult = await serverAction(page, pathname, ACTIONS.GENERATE, generatePayload, rst, deploymentId);

    console.log(`[generate] Status: ${generateResult.status} (ok: ${generateResult.ok})`);
    console.log(`[generate] Response: ${generateResult.text?.substring(0, 500)}`);

    if (generateResult.ok) {
        console.log(`\n${'═'.repeat(60)}`);
        console.log(`  SUCCESS`);
        console.log(`  Audience: "${AUDIENCE_NAME}"`);
        console.log(`  ID: ${audienceId}`);
        console.log(`  Preview Count: ${previewCount}`);
        console.log(`  Topic: Sustainability & Green Living > Recycling & Waste Management > E-waste Management`);
        console.log(`  Score: [] (all)`);
        console.log(`  Status: Generating → In Queue → Hydrating → Completed`);
        console.log(`${'═'.repeat(60)}`);
    } else if (generateResult.status === 404) {
        console.log('[generate] 404 — action ID is stale.');
    } else {
        const digest = generateResult.text?.match(/"digest"\s*:\s*"(\d+)"/);
        console.log(`[generate] FAILED — digest: ${digest?.[1] || 'unknown'}`);
        await page.screenshot({ path: path.join(CAPTURES_DIR, 'ewaste-generate-fail.png'), fullPage: true });
    }

    // ── SAVE DEBUG LOG ──
    const logFile = path.join(CAPTURES_DIR, `inject-ewaste-${audienceId}-${Date.now()}.json`);
    fs.writeFileSync(logFile, JSON.stringify({
        audienceId,
        name: AUDIENCE_NAME,
        deploymentId,
        previewCount,
        preview: { status: previewResult.status, ok: previewResult.ok },
        generate: generateResult ? { status: generateResult.status, ok: generateResult.ok } : null,
    }, null, 2));
    console.log(`\n[log] Saved to ${logFile}`);

    // ── SLEEP ──
    console.log('\n[sleep] Browser open for 5 minutes. Ctrl+C to close.\n');
    await delay(300000);

    await browser.close();
    console.log('[done]');
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
