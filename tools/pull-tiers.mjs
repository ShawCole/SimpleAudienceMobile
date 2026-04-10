/**
 * Pull 3 intent tiers from one existing IntentCore audience.
 * Pattern: low → back to list → medium → back to list → high
 *
 * Usage: node tools/pull-tiers.mjs --audience <uuid> --topic "Cat > Sub > Premade" --slug "topic-slug"
 */
import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import fs from 'fs';
import path from 'path';
import https from 'https';
import { fileURLToPath } from 'url';
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

const ACTIONS = {
    PREVIEW: '7f826a89d9a7db05f2db566ebbeed3814a95cea2ed',
    GENERATE: '7ff841dddcb1a6bcd7f5df96627b162edeb94b5406',
    LIST_EXPORTS: '7f7a0fa032eb7f78c1f6cbd4061c6bc26badc9b2f0',
};

// CLI
const args = process.argv.slice(2);
function getArg(flag) { const i = args.indexOf(flag); return i !== -1 ? args[i + 1] : null; }

const AUDIENCE_ID = getArg('--audience');
const TOPIC = getArg('--topic');
const SLUG = getArg('--slug') || 'output';
const OUT_DIR = getArg('--outdir') || '/tmp/impossible-build';
const ARG_SENIORITY = getArg('--seniority')?.split(',') || [];
const ARG_CREDIT = getArg('--credit')?.split(',') || [];
const ARG_HOMEOWNER = getArg('--homeowner')?.split(',') || [];

if (!AUDIENCE_ID || !TOPIC) {
    console.error('Usage: node tools/pull-tiers.mjs --audience <uuid> --topic "Cat > Sub > Premade" --slug "topic-slug"');
    console.error('  --seniority cxo       --credit "800+,750 - 799,700 - 749"  --homeowner homeowner');
    console.error('  --outdir /tmp/build');
    process.exit(1);
}

fs.mkdirSync(OUT_DIR, { recursive: true });

const TIERS = ['low', 'medium', 'high'];

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
        https.get(url, (res) => {
            if (res.statusCode === 301 || res.statusCode === 302) {
                return downloadFile(res.headers.location, dest).then(resolve).catch(reject);
            }
            const file = fs.createWriteStream(dest);
            res.pipe(file);
            file.on('finish', () => { file.close(); resolve(); });
        }).on('error', reject);
    });
}

async function main() {
    log('init', `═══ PULL 3 TIERS: ${SLUG} ═══`);
    log('init', `Audience: ${AUDIENCE_ID}`);
    log('init', `Topic: ${TOPIC}`);
    log('init', `Output: ${OUT_DIR}/${SLUG}-{low,medium,high}.csv`);
    if (ARG_SENIORITY.length) log('init', `Seniority: ${ARG_SENIORITY}`);
    if (ARG_CREDIT.length) log('init', `Credit: ${ARG_CREDIT}`);
    if (ARG_HOMEOWNER.length) log('init', `Homeowner: ${ARG_HOMEOWNER}`);

    const lockFile = path.join(USER_DATA_DIR, 'SingletonLock');
    if (fs.existsSync(lockFile)) fs.unlinkSync(lockFile);

    const browser = await puppeteer.default.launch({
        executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        headless: false, userDataDir: USER_DATA_DIR,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1400,1024'],
        defaultViewport: null
    });
    const page = await browser.newPage();

    // Login
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

    // Build filters from taxonomy values
    const filters = blankFilters();
    if (ARG_SENIORITY.length) filters.businessProfile.seniority = ARG_SENIORITY;
    if (ARG_CREDIT.length) filters.attributes.credit_rating = ARG_CREDIT;
    if (ARG_HOMEOWNER.length) filters.profile.homeowner = ARG_HOMEOWNER;

    for (let t = 0; t < TIERS.length; t++) {
        const tier = TIERS[t];
        const csvPath = `${OUT_DIR}/${SLUG}-${tier}.csv`;

        if (fs.existsSync(csvPath) && fs.statSync(csvPath).size > 1000) {
            log(tier, `SKIPPING — ${csvPath} exists (${(fs.statSync(csvPath).size / 1024 / 1024).toFixed(1)}MB)`);
            continue;
        }

        log(tier, `═══ [${t + 1}/3] ${tier.toUpperCase()} INTENT ═══`);

        // Step 1: Navigate to audience list
        log(tier, 'Navigating to audience list...');
        await page.goto(`${BASE_URL}/home/${WORKSPACE_SLUG}`, { waitUntil: 'load', timeout: 30000 });
        await delay(3000);
        log(tier, `At: ${page.url()}`);

        // Step 2: Navigate to audience page
        const audUrl = `${BASE_URL}/home/${WORKSPACE_SLUG}/audience/${AUDIENCE_ID}`;
        log(tier, `Navigating to audience: ${audUrl}`);
        await page.goto(audUrl, { waitUntil: 'load', timeout: 30000 });
        await delay(3000);
        log(tier, `At: ${page.url()}`);

        // Detect deployment ID
        const depId = await page.evaluate(() => {
            const m = document.documentElement.outerHTML.match(/dpl_[A-Za-z0-9]+/);
            return m ? m[0] : null;
        });
        log(tier, `Deployment: ${depId}`);

        const pathname = `/home/${WORKSPACE_SLUG}/audience/${AUDIENCE_ID}`;
        const rstEncoded = encodeURIComponent(buildRST(AUDIENCE_ID));

        // Step 3: Preview
        const previewPayload = [{
            accountId: ACCOUNT_ID, id: AUDIENCE_ID,
            filters: {
                audience: { type: 'premade', b2b: null, customTopic: '', customDescription: '',
                    segmentSearches: [TOPIC] },
                jobId: '', segment: [], daysBack: 7, score: [tier],
                filters
            }
        }];

        log(tier, `Firing preview with score: ["${tier}"]...`);
        const pr = await fire(page, pathname, ACTIONS.PREVIEW, previewPayload, rstEncoded, depId);
        log(tier, `Preview: ${pr.status} OK:${pr.ok}`);
        if (pr.ok) {
            const cm = pr.text?.match(/"count"\s*:\s*(\d+)/);
            log(tier, `Preview count: ${cm?.[1] || 'unknown'}`);
        } else {
            log(tier, `Preview FAILED: ${pr.text?.substring(0, 300)}`);
            continue;
        }

        // Step 4: Generate
        const generatePayload = [{
            accountId: ACCOUNT_ID, audienceId: AUDIENCE_ID,
            filters: {
                audience: { type: 'premade', b2b: null, customTopic: '', customDescription: '',
                    segmentSearches: [TOPIC] },
                jobId: '', segment: [], score: [tier], daysBack: 7,
                filters
            },
            hasSegmentChanged: false, resolveIntents: true
        }];

        log(tier, 'Firing generate...');
        const gr = await fire(page, pathname, ACTIONS.GENERATE, generatePayload, rstEncoded, depId);
        log(tier, `Generate: ${gr.status} OK:${gr.ok}`);
        if (!gr.ok) {
            log(tier, `Generate FAILED: ${gr.text?.substring(0, 300)}`);
            continue;
        }

        // Step 5: Poll for new export (track by created_at timestamp)
        // Use epoch ms for comparison — avoids timezone string format issues (+00:00 vs Z)
        const generateEpoch = Date.now();
        log(tier, `Polling for export newer than ${new Date(generateEpoch).toISOString()}...`);
        const listRST = encodeURIComponent(JSON.stringify(
            ['', { children: ['home', { children: [['account', WORKSPACE_SLUG, 'd'], { children: ['__PAGE__', {}, null, null] }, null, null] }, null, null] }, null, null, true]
        ));

        let csvUrl = null;
        let recordCount = null;
        for (let i = 0; i < 60; i++) {
            await delay(10000);
            const listResult = await fire(page, `/home/${WORKSPACE_SLUG}`, ACTIONS.LIST_EXPORTS,
                [{ audienceId: AUDIENCE_ID, page: 1, pageSize: 50 }], listRST, depId);

            if (listResult.ok) {
                // Parse all exports with their timestamps
                // Response is newest-first. Find the first export created after our generate call.
                const exports = [...listResult.text.matchAll(/"csv_url"\s*:\s*"([^"]+)"[^}]*?"current"\s*:\s*(\d+)[^}]*?"created_at"\s*:\s*"([^"]+)"/g)];

                if (exports.length === 0) {
                    log(tier, `Still processing... (${(i + 1) * 10}s)`);
                    continue;
                }

                // Exports are newest-first. Find one created after our generate.
                const newExport = exports.find(e => e[3] > generateTimestamp);
                if (newExport) {
                    csvUrl = newExport[1];
                    recordCount = newExport[2];
                    log(tier, `Completed! Records: ${recordCount} (created: ${newExport[3]})`);
                    break;
                }

                log(tier, `Waiting for new export... (${exports.length} existing, newest: ${exports[0]?.[3]}) (${(i + 1) * 10}s)`);
            } else {
                log(tier, `Poll error: ${listResult.status}`);
            }
        }

        if (!csvUrl) {
            log(tier, 'TIMEOUT — no new CSV after polling');
            continue;
        }

        // Step 6: Download
        log(tier, `Downloading ${recordCount} records...`);
        await downloadFile(csvUrl, csvPath);
        const size = fs.statSync(csvPath).size;
        log(tier, `Downloaded: ${(size / 1024 / 1024).toFixed(1)}MB → ${csvPath}`);
    }

    log('done', '═══════════════════════════════════');
    const csvs = fs.readdirSync(OUT_DIR).filter(f => f.startsWith(SLUG + '-') && f.endsWith('.csv'));
    csvs.forEach(f => {
        const size = fs.statSync(`${OUT_DIR}/${f}`).size;
        log('done', `  ${f} — ${(size / 1024 / 1024).toFixed(1)}MB`);
    });

    await browser.close();
}

main().catch(e => { console.error(`[FATAL] ${e.message}\n${e.stack}`); process.exit(1); });
