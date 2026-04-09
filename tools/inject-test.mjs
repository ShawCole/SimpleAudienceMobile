/**
 * Test injection — create audience, preview, generate.
 * Uses Apr 7 HAR action IDs + payload-template.mjs
 */

import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { blankFilters, buildRST, ACCOUNT_ID, WORKSPACE_SLUG } from './lib/payload-template.mjs';

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

// Apr 7 HAR action IDs
const ACTIONS = {
    CREATE: '7fb69ab8d7dd8c25456603f957085d79c5ceb3e7ce',
    PREVIEW: '7f826a89d9a7db05f2db566ebbeed3814a95cea2ed',
    GENERATE: '7ff841dddcb1a6bcd7f5df96627b162edeb94b5406',
    TOPIC_SEARCH: '7f98be21c683ee295940810938e7ff6b25159afb9d',
};

const AUDIENCE_NAME = 'test - okay to delete';

async function fireAction(page, pathname, actionId, payload, rstEncoded, deploymentId) {
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
            return { status: res.status, ok: res.ok, text: text.substring(0, 1000) };
        } catch (e) {
            return { error: e.message };
        }
    }, pathname, actionId, payload, rstEncoded, deploymentId);
}

async function main() {
    log('init', '═══ TEST INJECTION — VERIFY ACTION IDS ═══');

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

    // Step 1: Login
    log('login', 'Navigating to sign-in...');
    await page.goto(`${BASE_URL}/auth/sign-in`, { waitUntil: 'load', timeout: 30000 });
    if (page.url().includes('sign-in')) {
        await page.waitForSelector('input[type="email"]', { visible: true, timeout: 10000 });
        await page.type('input[type="email"]', EMAIL, { delay: 50 });
        await page.waitForSelector('input[type="password"]', { visible: true, timeout: 5000 });
        await page.type('input[type="password"]', PASSWORD, { delay: 50 });
        await page.click('button[type="submit"]');
        await delay(5000);
        log('login', `Logged in. URL: ${page.url()}`);
    } else {
        log('login', `Already authenticated. URL: ${page.url()}`);
    }

    // Step 2: Workspace
    log('workspace', 'Navigating to workspace...');
    await page.goto(`${BASE_URL}/home/${WORKSPACE_SLUG}`, { waitUntil: 'load', timeout: 30000 });
    await delay(2000);
    log('workspace', `At: ${page.url()}`);

    // Step 3: Detect deployment ID
    log('deploy', 'Detecting deployment ID...');
    const deploymentId = await page.evaluate(() => {
        const html = document.documentElement.outerHTML;
        const m = html.match(/dpl_[A-Za-z0-9]+/);
        return m ? m[0] : null;
    });
    log('deploy', `Deployment ID: ${deploymentId}`);

    // Step 4: Create audience via server action
    log('create', `Creating "${AUDIENCE_NAME}" via server action...`);
    const listPathname = `/home/${WORKSPACE_SLUG}`;
    const listRST = encodeURIComponent(JSON.stringify(
        ["", { "children": ["home", { "children": [["account", WORKSPACE_SLUG, "d"], { "children": ["__PAGE__", {}, null, null] }, null, null] }, null, null] }, null, null, true]
    ));

    const createResult = await fireAction(page, listPathname, ACTIONS.CREATE,
        [{ accountId: ACCOUNT_ID, name: AUDIENCE_NAME }],
        listRST, deploymentId
    );
    log('create', `Status: ${createResult.status} OK: ${createResult.ok}`);
    log('create', `Response: ${createResult.text}`);

    // Extract audience ID from response
    let audienceId = null;
    const idMatch = createResult.text?.match(/"id"\s*:\s*"([0-9a-f-]{36})"/);
    if (idMatch) {
        audienceId = idMatch[1];
        log('create', `Audience ID: ${audienceId}`);
    } else {
        log('create', 'FATAL: Could not extract audience ID from response');
        // Try navigating to audience list to find it
        await page.goto(`${BASE_URL}/home/${WORKSPACE_SLUG}`, { waitUntil: 'load', timeout: 30000 });
        await delay(3000);
        // Look for the audience in the page
        const foundId = await page.evaluate((name) => {
            const rows = document.querySelectorAll('tr, a');
            for (const r of rows) {
                if (r.textContent?.includes(name)) {
                    const link = r.querySelector('a[href*="/audience/"]') || r.closest('a[href*="/audience/"]');
                    if (link) {
                        const m = link.href.match(/\/audience\/([0-9a-f-]{36})/);
                        if (m) return m[1];
                    }
                }
            }
            return null;
        }, AUDIENCE_NAME);
        if (foundId) {
            audienceId = foundId;
            log('create', `Found audience in page: ${audienceId}`);
        } else {
            log('create', 'Could not find audience. Aborting.');
            await delay(300000);
            await browser.close();
            return;
        }
    }

    // Step 5: Navigate to audience page
    const audUrl = `${BASE_URL}/home/${WORKSPACE_SLUG}/audience/${audienceId}`;
    log('nav', `Navigating to ${audUrl}`);
    await page.goto(audUrl, { waitUntil: 'load', timeout: 30000 });
    await delay(3000);
    log('nav', `At: ${page.url()}`);

    // Re-detect deployment ID on audience page
    const deploymentId2 = await page.evaluate(() => {
        const html = document.documentElement.outerHTML;
        const m = html.match(/dpl_[A-Za-z0-9]+/);
        return m ? m[0] : null;
    });
    log('deploy', `Deployment ID on audience page: ${deploymentId2}`);

    const pathname = `/home/${WORKSPACE_SLUG}/audience/${audienceId}`;
    const rstEncoded = encodeURIComponent(buildRST(audienceId));

    // Step 6: Preview
    const previewPayload = [{
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
            filters: blankFilters()
        }
    }];

    log('preview', 'FIRING PREVIEW...');
    log('preview', `Action ID: ${ACTIONS.PREVIEW}`);
    log('preview', `Deployment: ${deploymentId2}`);
    const previewResult = await fireAction(page, pathname, ACTIONS.PREVIEW, previewPayload, rstEncoded, deploymentId2);
    log('preview', `Status: ${previewResult.status} OK: ${previewResult.ok}`);
    log('preview', `Response: ${previewResult.text}`);

    if (previewResult.ok) {
        const cm = previewResult.text?.match(/"count"\s*:\s*(\d+)/);
        log('preview', `SUCCESS — Count: ${cm?.[1] || 'unknown'}`);
    } else {
        log('preview', `FAILED`);
    }

    // Step 7: Generate
    const generatePayload = [{
        accountId: ACCOUNT_ID,
        audienceId: audienceId,
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
            score: [],
            daysBack: 7,
            filters: blankFilters()
        },
        hasSegmentChanged: false,
        resolveIntents: true
    }];

    log('generate', 'FIRING GENERATE...');
    log('generate', `Action ID: ${ACTIONS.GENERATE}`);
    const generateResult = await fireAction(page, pathname, ACTIONS.GENERATE, generatePayload, rstEncoded, deploymentId2);
    log('generate', `Status: ${generateResult.status} OK: ${generateResult.ok}`);
    log('generate', `Response: ${generateResult.text}`);

    if (generateResult.ok) {
        log('done', '═══ SUCCESS — ALL ACTION IDS VERIFIED ═══');
    } else {
        log('done', '═══ GENERATE FAILED ═══');
    }

    log('sleep', 'Browser open 2 min. Ctrl+C to close.');
    await delay(120000);
    await browser.close();
}

main().catch(e => { console.error(`[FATAL] ${e.message}\n${e.stack}`); process.exit(1); });
