/**
 * Audience Injection — create, preview, and generate an audience via
 * Next.js Server Action injection.
 *
 * Usage:
 *   node tools/inject-audience.mjs --name "Wealth Management Test" --score medium
 *   node tools/inject-audience.mjs --audience <existing-uuid> --score medium,high
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
const USER_DATA_DIR = path.join(ROOT, 'tools', '.chrome-inject-profile');
const CAPTURES_DIR = path.join(ROOT, 'tools', 'captures');
if (!fs.existsSync(CAPTURES_DIR)) fs.mkdirSync(CAPTURES_DIR, { recursive: true });

const WORKSPACE_SLUG = 'simple-audience';
const ACCOUNT_ID = 'fceffb3b-552d-413a-9442-e62e9d423aa0';

// Known action IDs — re-capture from DevTools on 404
const ACTIONS = {
    PREVIEW: '7f2fedc1659914fecb5d57837dc4b06ab5c2e0e744',
    GENERATE: '7f437ee100a328c3149f7f41b6ef0aa67929d43bcc',
    CREATE_AUDIENCE: '7ffaba0e7b99bdefb0ee5b9715f0f99be2eb57cfbf',
};

// Parse CLI
const args = process.argv.slice(2);
function getArg(flag) {
    const idx = args.indexOf(flag);
    return idx !== -1 ? args[idx + 1] : null;
}

const ARG_NAME = getArg('--name');
const ARG_AUDIENCE = getArg('--audience');
const ARG_SCORE = (getArg('--score') || 'medium').split(',');

// ── Build the filters payload ──
function buildPreviewPayload(audienceId, scoreValues) {
    return [{
        accountId: ACCOUNT_ID,
        id: audienceId,
        filters: {
            audience: {
                type: "premade",
                b2b: null,
                customTopic: "",
                customDescription: "",
                segmentSearches: ["Financial Services > Retirement & College Savings > Wealth Management Services"]
            },
            jobId: "",
            segment: [],
            daysBack: 7,
            score: scoreValues,
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
        }
    }];
}

function buildGeneratePayload(audienceId, scoreValues) {
    const preview = buildPreviewPayload(audienceId, scoreValues);
    // Generate uses audienceId (not id), plus hasSegmentChanged and resolveIntents
    const { id, ...rest } = preview[0];
    return [{
        ...rest,
        audienceId: audienceId,
        hasSegmentChanged: true,
        resolveIntents: true
    }];
}

function buildRST(audienceId) {
    return JSON.stringify(
        ["", { "children": ["home", { "children": [["account", WORKSPACE_SLUG, "d"], { "children": ["audience", { "children": [["id", audienceId, "d"], { "children": ["__PAGE__", {}, null, null] }, null, null] }, null, null] }, null, null] }, null, null] }, null, null, true]
    );
}

// ── Injection helper ──
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

// ── Detect deployment ID from live page ──
async function getDeploymentId(page) {
    // Try page source first
    const fromSource = await page.evaluate(() => {
        const html = document.documentElement.outerHTML;
        const m = html.match(/dpl_[A-Za-z0-9]+/);
        return m ? m[0] : null;
    });
    if (fromSource) return fromSource;

    // Fallback: response headers
    const fromHeaders = await page.evaluate(async () => {
        try {
            const res = await fetch(window.location.href, { method: 'HEAD' });
            return res.headers.get('x-deployment-id');
        } catch { return null; }
    });
    return fromHeaders || 'dpl_3Jq2xYTjAQXwfkA9Pv9W1ZB2Sj27';
}

// ── MAIN ──
async function main() {
    console.log('═'.repeat(60));
    console.log('  AUDIENCE INJECTION');
    console.log(`  Name:  ${ARG_NAME || '(existing audience)'}`);
    console.log(`  ID:    ${ARG_AUDIENCE || '(will create)'}`);
    console.log(`  Score: ${JSON.stringify(ARG_SCORE)}`);
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

    let audienceId = ARG_AUDIENCE;

    // ── CREATE (if --name provided and no --audience) ──
    if (ARG_NAME && !ARG_AUDIENCE) {
        console.log(`[create] Creating audience: "${ARG_NAME}"`);
        await page.goto(`${BASE_URL}/home/${WORKSPACE_SLUG}/audience`, { waitUntil: 'load', timeout: 30000 });
        await page.waitForTimeout(3000);

        const clicked = await page.evaluate(() => {
            const btns = Array.from(document.querySelectorAll('button, a'));
            const btn = btns.find(b => b.textContent?.trim() === 'Create');
            if (btn) { btn.click(); return true; }
            return false;
        });
        if (!clicked) { console.log('[create] Could not find Create button!'); await browser.close(); return; }

        await page.waitForTimeout(2000);
        const input = await page.waitForSelector('div[role="dialog"] form input[name="name"], div[role="dialog"] input', { visible: true, timeout: 10000 });
        await input.click({ clickCount: 3 });
        await input.type(ARG_NAME, { delay: 30 });

        await page.evaluate(() => {
            const dialog = document.querySelector('div[role="dialog"]');
            const btns = Array.from(dialog.querySelectorAll('button'));
            const submit = btns.find(b => b.textContent?.trim() === 'Create' || b.type === 'submit');
            if (submit) submit.click();
        });

        await page.waitForNavigation({ waitUntil: 'load', timeout: 30000 }).catch(() => {});
        await page.waitForTimeout(3000);

        const match = page.url().match(/\/audience\/([0-9a-f-]+)/);
        if (!match) { console.log(`[create] Could not get audience ID from URL: ${page.url()}`); await browser.close(); return; }
        audienceId = match[1];
        console.log(`[create] Created: ${audienceId}\n`);
    }

    if (!audienceId) {
        console.log('Error: provide --name to create or --audience <uuid> for existing');
        await browser.close();
        return;
    }

    // ── NAVIGATE TO AUDIENCE PAGE ──
    const audUrl = `${BASE_URL}/home/${WORKSPACE_SLUG}/audience/${audienceId}`;
    console.log(`[nav] Loading audience page: ${audUrl}`);
    await page.goto(audUrl, { waitUntil: 'networkidle2', timeout: 60000 });
    await page.waitForTimeout(5000);
    console.log(`[nav] URL: ${page.url()}\n`);

    // ── DETECT DEPLOYMENT ID ──
    const deploymentId = await getDeploymentId(page);
    console.log(`[deploy] Deployment ID: ${deploymentId}\n`);

    const rst = buildRST(audienceId);
    const pathname = `/home/${WORKSPACE_SLUG}/audience/${audienceId}`;

    // ── PREVIEW — try multiple payload variations ──
    const variations = [
        {
            label: 'Attempt 1: standard payload ($$first, $second)',
            payload: buildPreviewPayload(audienceId, ARG_SCORE)
        },
        {
            label: 'Attempt 2: no netWorth filter (isolate $ issue)',
            payload: (() => {
                const p = buildPreviewPayload(audienceId, ARG_SCORE);
                p[0].filters.filters.profile.netWorth = [];
                return p;
            })()
        },
        {
            label: 'Attempt 3: no topic, no score, no daysBack (bare filters)',
            payload: (() => {
                const p = buildPreviewPayload(audienceId, []);
                p[0].filters.audience.segmentSearches = [];
                p[0].filters.score = [];
                p[0].filters.daysBack = null;
                p[0].filters.filters.profile.netWorth = [];
                return p;
            })()
        },
    ];

    let previewResult = null;
    let previewCount = 'unknown';
    let successPayload = null;

    for (const v of variations) {
        console.log(`\n[preview] ${v.label}`);
        console.log(`[preview] Action ID: ${ACTIONS.PREVIEW}`);
        console.log(`[preview] Deployment: ${deploymentId}`);
        console.log(`[preview] Payload: ${JSON.stringify(v.payload)}`);
        console.log('');

        const result = await serverAction(page, pathname, ACTIONS.PREVIEW, v.payload, rst, deploymentId);

        console.log(`[preview] Status: ${result.status} (ok: ${result.ok})`);
        console.log(`[preview] Response: ${result.text}`);
        if (result.headers) {
            console.log(`[preview] x-action-revalidated: ${result.headers['x-action-revalidated']}`);
        }

        if (result.ok) {
            const cm = result.text?.match(/"count"\s*:\s*(\d+)/);
            previewCount = cm?.[1] || 'unknown';
            console.log(`[preview] SUCCESS — Count: ${previewCount}`);
            previewResult = result;
            successPayload = v;
            break;
        } else if (result.status === 404) {
            console.log('[preview] 404 — action ID is stale. Need to re-capture.');
            // Try to find new action IDs from the page
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
                return ids;
            });
            if (newIds.length > 0) {
                console.log(`[preview] Found ${newIds.length} action IDs in page:`);
                newIds.forEach(id => console.log(`   ${id}`));
            }
            break; // No point trying other payloads if action ID is wrong
        } else {
            const digest = result.text?.match(/"digest"\s*:\s*"(\d+)"/);
            console.log(`[preview] 500 digest: ${digest?.[1] || 'unknown'}`);
        }

        previewResult = result;
        console.log('[preview] Trying next variation...\n');
        await page.waitForTimeout(2000);
    }

    console.log('');

    // ── GENERATE ──
    if (previewResult?.ok && successPayload) {
        console.log('[generate] Running generate injection...');
        // Build generate payload from the successful preview payload
        const genPayload = JSON.parse(JSON.stringify(successPayload.payload));
        const { id, ...rest } = genPayload[0];
        const generatePayload = [{
            ...rest,
            audienceId: audienceId,
            hasSegmentChanged: true,
            resolveIntents: true
        }];
        console.log(`[generate] Action ID: ${ACTIONS.GENERATE}`);
        console.log(`[generate] Payload: ${JSON.stringify(generatePayload).substring(0, 500)}`);

        const generateResult = await serverAction(page, pathname, ACTIONS.GENERATE, generatePayload, rst, deploymentId);

        console.log(`[generate] Status: ${generateResult.status} (ok: ${generateResult.ok})`);
        console.log(`[generate] Response: ${generateResult.text}`);
        if (generateResult.headers) {
            console.log(`[generate] x-action-revalidated: ${generateResult.headers['x-action-revalidated']}`);
        }

        if (generateResult.ok) {
            console.log(`[generate] SUCCESS — "${ARG_NAME || audienceId}" generated. Count: ${previewCount}`);
        } else if (generateResult.status === 404) {
            console.log('[generate] 404 — action ID is stale.');
        } else if (generateResult.status === 500) {
            const digest = generateResult.text?.match(/"digest"\s*:\s*"(\d+)"/);
            console.log(`[generate] 500 digest: ${digest?.[1] || 'unknown'}`);
        }
    } else {
        console.log('[generate] Skipping — all preview attempts failed.\n');
    }

    // ── SAVE DEBUG LOG ──
    const logFile = path.join(CAPTURES_DIR, `inject-${audienceId}-${Date.now()}.json`);
    fs.writeFileSync(logFile, JSON.stringify({
        audienceId,
        name: ARG_NAME,
        score: ARG_SCORE,
        deploymentId,
        preview: { status: previewResult.status, ok: previewResult.ok, text: previewResult.text, headers: previewResult.headers },
        generate: previewResult.ok ? 'attempted' : 'skipped',
    }, null, 2));
    console.log(`\n[log] Saved to ${logFile}`);

    // ── SLEEP ──
    console.log('\n[sleep] Browser open for 5 minutes. Ctrl+C to close.\n');
    await page.waitForTimeout(300000);

    await browser.close();
    console.log('[done]');
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
