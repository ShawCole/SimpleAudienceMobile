/**
 * pull-audience.mjs — End-to-end audience pipeline.
 * Create → Preview → Generate → Poll Status → Download CSV
 *
 * Usage:
 *   node tools/pull-audience.mjs --name "My Audience - SC" --topic "Category > Sub > Premade"
 *   node tools/pull-audience.mjs --name "My Audience - SC" --topic "Category > Sub > Premade" --industry "Medical Practices,Law Practice"
 *   node tools/pull-audience.mjs --name "My Audience - SC" --topic "Category > Sub > Premade" --score "medium,high"
 *   node tools/pull-audience.mjs --audience <existing-uuid>  (skip create, just generate + download)
 */

import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import https from 'https';
import http from 'http';
import { blankFilters, buildRST, ACCOUNT_ID, WORKSPACE_SLUG } from './lib/payload-template.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const envContent = fs.readFileSync(path.join(ROOT, 'backend', '.env'), 'utf8');
const env = {};
for (const line of envContent.split('\n')) { const m = line.match(/^([^#=]+)=(.*)$/); if (m) env[m[1].trim()] = m[2].trim(); }

puppeteer.default.use(StealthPlugin());
const delay = ms => new Promise(r => setTimeout(r, ms));
const log = (s, m) => console.log(`[${new Date().toISOString()}] [${s}] ${m}`);

const BASE_URL = env.SIMPLEAUDIENCE_BASE_URL || 'https://app.intentcore.io';
const EMAIL = env.SIMPLEAUDIENCE_EMAIL;
const PASSWORD = env.SIMPLEAUDIENCE_PASSWORD;
const USER_DATA_DIR = path.join(ROOT, 'tools', '.chrome-inject-profile');
const OUTPUT_DIR = path.join(ROOT, 'tools', 'exports');
if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

// Stable action IDs — verified across deployments Apr 7-9, 2026
const ACTIONS = {
    PREVIEW: '7f826a89d9a7db05f2db566ebbeed3814a95cea2ed',
    GENERATE: '7ff841dddcb1a6bcd7f5df96627b162edeb94b5406',
    LIST_EXPORTS: '7f7a0fa032eb7f78c1f6cbd4061c6bc26badc9b2f0',
    TOPIC_SEARCH: '7f98be21c683ee295940810938e7ff6b25159afb9d',
};

// ── CLI ──
const args = process.argv.slice(2);
function getArg(flag) { const i = args.indexOf(flag); return i !== -1 ? args[i + 1] : null; }

const ARG_NAME = getArg('--name');
const ARG_TOPIC = getArg('--topic');
const ARG_AUDIENCE = getArg('--audience');
const ARG_SCORE = getArg('--score')?.split(',') || [];
const ARG_INDUSTRY = getArg('--industry')?.split(',') || [];
const ARG_SENIORITY = getArg('--seniority')?.split(',') || [];
const ARG_CREDIT = getArg('--credit')?.split(',') || [];
const ARG_HOMEOWNER = getArg('--homeowner')?.split(',') || [];
const ARG_INCOME = getArg('--income')?.split('|') || [];
const ARG_B2B = args.includes('--b2b') ? 'B2B' : null;
const ARG_OUTPUT = getArg('--output');

if (!ARG_AUDIENCE && (!ARG_NAME || !ARG_TOPIC)) {
    console.error('Usage:');
    console.error('  node tools/pull-audience.mjs --name "Name - SC" --topic "Cat > Sub > Premade"');
    console.error('  node tools/pull-audience.mjs --audience <uuid>');
    console.error('');
    console.error('Options:');
    console.error('  --industry "Medical Practices,Law Practice"  Comma-separated industry filter');
    console.error('  --score "medium,high"                        Intent score filter');
    console.error('  --b2b                                        Set b2b flag');
    console.error('  --output /path/to/file.csv                   Custom output path');
    process.exit(1);
}

// ── Helpers ──
async function fire(page, pathname, actionId, payload, rst, depId) {
    return page.evaluate(async (pn, aid, pl, r, d) => {
        try {
            const res = await fetch(pn, { method: 'POST', headers: {
                'accept': 'text/x-component', 'content-type': 'text/plain;charset=UTF-8',
                'next-action': aid, 'next-router-state-tree': r, 'x-deployment-id': d
            }, body: JSON.stringify(pl) });
            return { status: res.status, ok: res.ok, text: await res.text() };
        } catch (e) { return { error: e.message }; }
    }, pathname, actionId, payload, rst, depId);
}

function downloadFile(url, dest) {
    return new Promise((resolve, reject) => {
        const proto = url.startsWith('https') ? https : http;
        const file = fs.createWriteStream(dest);
        proto.get(url, (res) => {
            if (res.statusCode === 301 || res.statusCode === 302) {
                return downloadFile(res.headers.location, dest).then(resolve).catch(reject);
            }
            const total = parseInt(res.headers['content-length'] || '0');
            let downloaded = 0;
            res.on('data', (chunk) => {
                downloaded += chunk.length;
                if (total > 0 && downloaded % (5 * 1024 * 1024) < chunk.length) {
                    log('download', `${(downloaded / 1024 / 1024).toFixed(1)}MB / ${(total / 1024 / 1024).toFixed(1)}MB`);
                }
            });
            res.pipe(file);
            file.on('finish', () => { file.close(); resolve(); });
        }).on('error', reject);
    });
}

// ── Main ──
async function main() {
    log('init', '═══ PULL AUDIENCE — FULL PIPELINE ═══');
    log('init', `Name: ${ARG_NAME || '(existing)'}`);
    log('init', `Topic: ${ARG_TOPIC || '(from existing)'}`);
    log('init', `Audience: ${ARG_AUDIENCE || '(will create)'}`);
    if (ARG_INDUSTRY.length) log('init', `Industry: ${ARG_INDUSTRY.join(', ')}`);
    if (ARG_SCORE.length) log('init', `Score: ${ARG_SCORE.join(', ')}`);

    const lockFile = path.join(USER_DATA_DIR, 'SingletonLock');
    if (fs.existsSync(lockFile)) fs.unlinkSync(lockFile);

    const browser = await puppeteer.default.launch({
        executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        headless: false, userDataDir: USER_DATA_DIR,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1400,1024'],
        defaultViewport: null
    });
    const page = await browser.newPage();

    // ── Step 1: Login ──
    log('login', 'Signing in...');
    await page.goto(`${BASE_URL}/auth/sign-in`, { waitUntil: 'load', timeout: 30000 });
    if (page.url().includes('sign-in')) {
        await page.waitForSelector('input[type="email"]', { visible: true, timeout: 10000 });
        await page.type('input[type="email"]', EMAIL, { delay: 50 });
        await page.waitForSelector('input[type="password"]', { visible: true, timeout: 5000 });
        await page.type('input[type="password"]', PASSWORD, { delay: 50 });
        await page.click('button[type="submit"]');
        await delay(5000);
    }
    log('login', `At: ${page.url()}`);

    // ── Step 2: Workspace ──
    log('workspace', 'Selecting workspace...');
    await page.goto(`${BASE_URL}/home/${WORKSPACE_SLUG}`, { waitUntil: 'load', timeout: 30000 });
    await delay(2000);

    let audienceId = ARG_AUDIENCE;

    // ── Step 3: Create audience (if needed) ──
    if (!audienceId) {
        log('create', `Creating "${ARG_NAME}"...`);
        await page.goto(`${BASE_URL}/home/${WORKSPACE_SLUG}/audience`, { waitUntil: 'load', timeout: 30000 });
        await delay(3000);

        await page.evaluate(() => {
            const b = [...document.querySelectorAll('button')].find(b => b.textContent?.trim() === 'Create');
            if (b) b.click();
        });
        await delay(2000);

        const inp = await page.waitForSelector('div[role="dialog"] input', { visible: true, timeout: 10000 });
        await inp.click({ clickCount: 3 });
        await inp.type(ARG_NAME, { delay: 30 });

        await page.evaluate(() => {
            const d = document.querySelector('div[role="dialog"]');
            if (!d) return;
            const b = [...d.querySelectorAll('button')].find(b => b.textContent?.trim() === 'Create' || b.type === 'submit');
            if (b) b.click();
        });

        for (let i = 0; i < 30; i++) {
            await delay(500);
            const m = page.url().match(/\/audience\/([0-9a-f-]{36})/);
            if (m) { audienceId = m[1]; break; }
        }

        if (!audienceId) {
            log('create', `FATAL: No audience ID in URL: ${page.url()}`);
            await browser.close(); return;
        }
        log('create', `Created: ${audienceId}`);
    }

    // ── Step 4: Navigate to workspace first, then audience page ──
    // Must visit workspace before audience page to ensure proper session state
    log('nav', `Navigating to workspace first...`);
    await page.goto(`${BASE_URL}/home/${WORKSPACE_SLUG}`, { waitUntil: 'load', timeout: 30000 });
    await delay(2000);
    const audUrl = `${BASE_URL}/home/${WORKSPACE_SLUG}/audience/${audienceId}`;
    log('nav', `Loading ${audUrl}`);
    await page.goto(audUrl, { waitUntil: 'load', timeout: 30000 });
    await delay(3000);

    const depId = await page.evaluate(() => {
        const m = document.documentElement.outerHTML.match(/dpl_[A-Za-z0-9]+/);
        return m ? m[0] : null;
    });
    log('deploy', `Deployment: ${depId}`);

    const pathname = `/home/${WORKSPACE_SLUG}/audience/${audienceId}`;
    const rstEncoded = encodeURIComponent(buildRST(audienceId));

    // ── Step 5: Preview ──
    const filters = blankFilters();
    if (ARG_INDUSTRY.length) filters.businessProfile.industry = ARG_INDUSTRY;
    if (ARG_SENIORITY.length) filters.businessProfile.seniority = ARG_SENIORITY;
    if (ARG_CREDIT.length) filters.attributes.credit_rating = ARG_CREDIT;
    if (ARG_HOMEOWNER.length) filters.profile.homeowner = ARG_HOMEOWNER;
    if (ARG_INCOME.length) filters.profile.incomeRange = ARG_INCOME;

    const previewPayload = [{
        accountId: ACCOUNT_ID, id: audienceId,
        filters: {
            audience: {
                type: "premade", b2b: ARG_B2B, customTopic: "", customDescription: "",
                segmentSearches: ARG_TOPIC ? [ARG_TOPIC] : []
            },
            jobId: "", segment: [],
            daysBack: ARG_TOPIC ? 7 : null,
            score: ARG_SCORE,
            filters
        }
    }];

    log('preview', 'Firing preview...');
    const pr = await fire(page, pathname, ACTIONS.PREVIEW, previewPayload, rstEncoded, depId);
    log('preview', `Status: ${pr.status} OK: ${pr.ok}`);

    if (!pr.ok) {
        log('preview', `FAILED: ${pr.text?.substring(0, 300)}`);
        await browser.close(); return;
    }

    const countMatch = pr.text?.match(/"count"\s*:\s*(\d+)/);
    const previewCount = countMatch?.[1] || 'unknown';
    log('preview', `Preview count: ${previewCount}`);

    // ── Step 6: Generate ──
    const generatePayload = [{
        accountId: ACCOUNT_ID, audienceId,
        filters: previewPayload[0].filters,
        hasSegmentChanged: false, resolveIntents: true
    }];
    // Generate uses same filters but audienceId instead of id
    delete generatePayload[0].filters; // remove then re-add properly
    generatePayload[0] = {
        accountId: ACCOUNT_ID, audienceId,
        filters: {
            audience: previewPayload[0].filters.audience,
            jobId: "", segment: [],
            score: ARG_SCORE,
            daysBack: ARG_TOPIC ? 7 : null,
            filters
        },
        hasSegmentChanged: false, resolveIntents: true
    };

    log('generate', 'Firing generate...');
    const gr = await fire(page, pathname, ACTIONS.GENERATE, generatePayload, rstEncoded, depId);
    log('generate', `Status: ${gr.status} OK: ${gr.ok}`);

    if (!gr.ok) {
        log('generate', `FAILED: ${gr.text?.substring(0, 300)}`);
        await browser.close(); return;
    }
    log('generate', 'Audience queued for generation.');

    // ── Step 7: Poll for completion ──
    log('poll', 'Waiting for audience to complete (In Queue → Hydrating → Completed)...');
    const listRST = encodeURIComponent(JSON.stringify(
        ["", { "children": ["home", { "children": [["account", WORKSPACE_SLUG, "d"], { "children": ["__PAGE__", {}, null, null] }, null, null] }, null, null] }, null, null, true]
    ));
    const listPathname = `/home/${WORKSPACE_SLUG}`;

    let csvUrl = null;
    let recordCount = null;
    const maxPolls = 60; // 10 min max (10s intervals)

    for (let i = 0; i < maxPolls; i++) {
        await delay(10000);

        const listResult = await fire(page, listPathname, ACTIONS.LIST_EXPORTS,
            [{ audienceId, page: 1, pageSize: 10 }], listRST, depId);

        if (listResult.ok) {
            // Parse RSC response for export data
            const dataMatch = listResult.text?.match(/\{[^{]*"csv_url"\s*:\s*"([^"]+)"[^}]*"current"\s*:\s*(\d+)/);
            if (dataMatch) {
                csvUrl = dataMatch[1];
                recordCount = dataMatch[2];
                log('poll', `Completed! Records: ${recordCount}`);
                break;
            }

            // Check if data array is empty (still processing)
            const emptyMatch = listResult.text?.match(/"data"\s*:\s*\[\s*\]/);
            if (emptyMatch) {
                log('poll', `Still processing... (${(i + 1) * 10}s elapsed)`);
                continue;
            }
        }

        log('poll', `Polling... (${(i + 1) * 10}s elapsed)`);
    }

    if (!csvUrl) {
        log('poll', 'TIMEOUT: Audience did not complete within 10 minutes.');
        log('poll', `Check manually: ${audUrl}`);
        await browser.close(); return;
    }

    // ── Step 8: Download CSV ──
    const slug = ARG_NAME ? ARG_NAME.replace(/[^a-zA-Z0-9-_ ]/g, '').replace(/\s+/g, '-').toLowerCase() : audienceId;
    const outputPath = ARG_OUTPUT || path.join(OUTPUT_DIR, `${slug}-${audienceId.substring(0, 8)}.csv`);

    log('download', `Downloading ${recordCount} records...`);
    log('download', `URL: ${csvUrl}`);
    log('download', `Output: ${outputPath}`);

    await downloadFile(csvUrl, outputPath);

    const fileSize = fs.statSync(outputPath).size;
    log('download', `Downloaded: ${(fileSize / 1024 / 1024).toFixed(1)}MB`);

    // ── Done ──
    log('done', '═══════════════════════════════════════════');
    log('done', `Audience: ${ARG_NAME || audienceId}`);
    log('done', `ID: ${audienceId}`);
    log('done', `Records: ${recordCount}`);
    log('done', `CSV: ${outputPath}`);
    log('done', `Size: ${(fileSize / 1024 / 1024).toFixed(1)}MB`);
    log('done', '═══════════════════════════════════════════');

    await browser.close();
}

main().catch(e => { console.error(`[FATAL] ${e.message}\n${e.stack}`); process.exit(1); });
