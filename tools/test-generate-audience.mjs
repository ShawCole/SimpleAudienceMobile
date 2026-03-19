/**
 * Test Generate Audience via API POST
 *
 * STANDALONE SCRIPT — does NOT touch the existing backend server.
 * Uses its own Chrome profile and Puppeteer instance.
 *
 * 1. Logs in via Puppeteer (own Chrome profile)
 * 2. Navigates to the audience filters page (establishes context)
 * 3. Fires the Preview POST first (safe, read-only) to get a count
 * 4. Optionally fires the Generate POST (creates audience data)
 *
 * Usage:
 *   node tools/test-generate-audience.mjs <audienceId> [--generate]
 *
 *   Without --generate: Preview only (safe, read-only)
 *   With --generate:    Actually generates the audience data
 *
 * Example:
 *   node tools/test-generate-audience.mjs 812e48cc-1574-4d7e-917c-96a2045b4771
 *   node tools/test-generate-audience.mjs 812e48cc-1574-4d7e-917c-96a2045b4771 --generate
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
// Completely separate Chrome profile — will NOT interfere with anything
const USER_DATA_DIR = path.join(ROOT, 'tools', '.chrome-test-generate-profile');
const CAPTURES_DIR = path.join(ROOT, 'tools', 'captures');

if (!fs.existsSync(CAPTURES_DIR)) fs.mkdirSync(CAPTURES_DIR, { recursive: true });

const ACCOUNT_ID = '27e2bf65-59ba-4a31-b754-97a6652fe36d';

// Server action IDs (from network capture)
const PREVIEW_ACTION = '7f1518b4f7ad169f2fdcc2d2a52581b6c08649c230';
const GENERATE_ACTION = '7fb0c8b4dda7ec25a0ede6149bb7b6dca0493573ac';

// The filter template for "Sell Home for Cash" in California, 50-100k home value
// (same filters from the captured payloads — empty here since this is a test)
function buildFilters(opts = {}) {
    return {
        audience: {
            type: "premade",
            b2b: null,
            customTopic: "",
            customDescription: "",
            segmentSearches: opts.segmentSearches || []
        },
        jobId: "",
        segment: opts.segment || [],
        score: [],
        daysBack: opts.daysBack || null,
        filters: {
            age: { minAge: null, maxAge: null },
            city: [],
            state: opts.state || [],
            zip: [],
            gender: [],
            profile: {
                incomeRange: [],
                homeowner: opts.homeowner || [],
                married: [],
                netWorth: [],
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
                estimated_home_value: opts.estimatedHomeValue || [],
                mortgage_amount: { min: null, max: null },
                generations_in_household: []
            },
            notNulls: [],
            nullOnly: []
        }
    };
}

async function main() {
    const audienceId = process.argv[2];
    const doGenerate = process.argv.includes('--generate');

    if (!audienceId) {
        console.error('Usage: node tools/test-generate-audience.mjs <audienceId> [--generate]');
        console.error('');
        console.error('  Without --generate: Preview only (safe, read-only)');
        console.error('  With --generate:    Actually generates the audience data');
        process.exit(1);
    }

    console.log('='.repeat(60));
    console.log('  TEST: Generate Audience via API POST');
    console.log('  STANDALONE — does NOT touch existing backend');
    console.log('='.repeat(60));
    console.log(`  Audience ID: ${audienceId}`);
    console.log(`  Mode: ${doGenerate ? '⚠️  GENERATE (will create data)' : '👀 PREVIEW ONLY (safe, read-only)'}`);
    console.log('='.repeat(60));
    console.log('');

    // Clean up stale lock
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
    console.log('STEP 1: Login');
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
        console.log('   ✅ Logged in.\n');
    } else {
        console.log('   ✅ Already authenticated.\n');
    }

    // ── NAVIGATE TO AUDIENCE PAGE ──
    console.log('STEP 2: Navigate to audience filters page');
    const audienceUrl = `${BASE_URL}/home/bizypro/audience/${audienceId}`;
    console.log(`   📍 ${audienceUrl}`);
    await page.goto(audienceUrl, { waitUntil: 'networkidle2', timeout: 60000 });
    await page.waitForTimeout(8000);

    // Verify the audienceId matches the URL path
    const currentUrl = page.url();
    const urlAudienceId = currentUrl.match(/\/audience\/([0-9a-f-]+)/)?.[1];
    if (urlAudienceId !== audienceId) {
        console.error(`   ❌ URL audienceId mismatch! Expected ${audienceId}, got ${urlAudienceId}`);
        console.error(`   Current URL: ${currentUrl}`);
        await browser.close();
        process.exit(1);
    }
    console.log(`   ✅ audienceId confirmed from URL: ${urlAudienceId}`);

    // Grab the current page title/audience name if visible
    const pageInfo = await page.evaluate(() => {
        const headings = Array.from(document.querySelectorAll('h1, h2, h3'));
        return {
            headings: headings.map(h => h.textContent.trim()).filter(t => t.length > 0 && t.length < 100),
            url: window.location.href
        };
    });
    console.log(`   Page headings: ${JSON.stringify(pageInfo.headings)}`);
    console.log('');

    // ── BUILD FILTERS ──
    // Using California + "Sell Home for Cash" + homeowner + 0-50k home value
    // This should produce well under 500,000 results
    const filters = buildFilters({
        segmentSearches: ["Real Estate > Selling a Home > Sell Home for Cash"],
        segment: ["4eyes_500089"],
        daysBack: 7,
        state: ["California"],
        homeowner: ["homeowner"],
        estimatedHomeValue: ["$$1,000 - $24,999", "$$25,000 - $49,999"]
    });
    console.log('   Filters: California, homeowner, Sell Home for Cash, $0-50k home value\n');

    // Wait for page to be fully interactive before making API calls
    console.log('   Waiting for page to be fully interactive...');
    await page.waitForTimeout(5000);

    // ── STEP 3: PREVIEW (always do this first — safe, read-only) ──
    console.log('STEP 3: Preview (read-only count)');

    const previewPayload = [{
        accountId: ACCOUNT_ID,
        id: audienceId,
        filters: filters
    }];

    const routerStateTree = JSON.stringify(
        ["", {"children": ["home", {"children": [["account", "bizypro", "d"], {"children": ["audience", {"children": [["id", audienceId, "d"], {"children": ["__PAGE__", {}, null, null]}, null, null]}, null, null]}, null, null]}, null, null]}, null, null, true]
    );

    console.log('   📤 Sending Preview POST...');
    const previewResult = await page.evaluate(async (payload, actionId, stateTree) => {
        try {
            const res = await fetch(window.location.pathname, {
                method: 'POST',
                headers: {
                    'accept': 'text/x-component',
                    'content-type': 'text/plain;charset=UTF-8',
                    'next-action': actionId,
                    'next-router-state-tree': stateTree,
                },
                body: JSON.stringify(payload)
            });
            const text = await res.text();
            return { status: res.status, ok: res.ok, text };
        } catch (e) {
            return { error: e.message };
        }
    }, previewPayload, PREVIEW_ACTION, routerStateTree);

    console.log(`   📥 Response: ${previewResult.status} (ok: ${previewResult.ok})`);
    if (previewResult.error) {
        console.log(`   ❌ Error: ${previewResult.error}`);
    } else {
        // Try to extract count from response
        const countMatch = previewResult.text.match(/"count"\s*:\s*(\d+)/);
        const rowMatch = previewResult.text.match(/"row_count"\s*:\s*(\d+)/);
        const totalMatch = previewResult.text.match(/"total"\s*:\s*(\d+)/);
        if (countMatch) console.log(`   📊 Count: ${countMatch[1]}`);
        if (rowMatch) console.log(`   📊 Row count: ${rowMatch[1]}`);
        if (totalMatch) console.log(`   📊 Total: ${totalMatch[1]}`);

        // Show first 500 chars of response for debugging
        console.log(`   Response preview (500 chars):\n   ${previewResult.text.substring(0, 500)}`);
    }

    // Save preview result
    const previewOutFile = path.join(CAPTURES_DIR, 'generate-test-preview.json');
    fs.writeFileSync(previewOutFile, JSON.stringify({
        type: 'preview',
        audienceId,
        payload: previewPayload,
        status: previewResult.status,
        ok: previewResult.ok,
        response: previewResult.text?.substring(0, 5000)
    }, null, 2));
    console.log(`   💾 Saved to ${previewOutFile}\n`);

    // ── STEP 4: GENERATE (only if --generate flag was passed) ──
    if (doGenerate) {
        console.log('STEP 4: ⚠️  GENERATE AUDIENCE (creating data)');

        const generatePayload = [{
            accountId: ACCOUNT_ID,
            audienceId: audienceId,
            filters: filters,
            hasSegmentChanged: false,
            resolveIntents: true
        }];

        console.log('   📤 Sending Generate POST...');
        const generateResult = await page.evaluate(async (payload, actionId, stateTree) => {
            try {
                const res = await fetch(window.location.pathname, {
                    method: 'POST',
                    headers: {
                        'accept': 'text/x-component',
                        'content-type': 'text/plain;charset=UTF-8',
                        'next-action': actionId,
                        'next-router-state-tree': stateTree,
                    },
                    body: JSON.stringify(payload)
                });
                const text = await res.text();
                return { status: res.status, ok: res.ok, text };
            } catch (e) {
                return { error: e.message };
            }
        }, generatePayload, GENERATE_ACTION, routerStateTree);

        console.log(`   📥 Response: ${generateResult.status} (ok: ${generateResult.ok})`);
        if (generateResult.error) {
            console.log(`   ❌ Error: ${generateResult.error}`);
        } else {
            console.log(`   Response preview (500 chars):\n   ${generateResult.text?.substring(0, 500)}`);
        }

        // Save generate result
        const genOutFile = path.join(CAPTURES_DIR, 'generate-test-generate.json');
        fs.writeFileSync(genOutFile, JSON.stringify({
            type: 'generate',
            audienceId,
            payload: generatePayload,
            status: generateResult.status,
            ok: generateResult.ok,
            response: generateResult.text?.substring(0, 5000)
        }, null, 2));
        console.log(`   💾 Saved to ${genOutFile}\n`);

        // Keep browser open so user can review the results on the platform
        console.log('   🔍 Browser staying open for 120 seconds so you can review...');
        console.log('   Check the audience page in the browser to verify generation worked.');
        console.log('   Press Ctrl+C to close early.\n');
        await page.waitForTimeout(120000);
    } else {
        console.log('STEP 4: Skipped (no --generate flag). To actually generate, run:');
        console.log(`   node tools/test-generate-audience.mjs ${audienceId} --generate\n`);
    }

    console.log('🏁 Test complete. Closing browser.');
    await browser.close();
}

main().catch(e => {
    console.error('Fatal:', e);
    process.exit(1);
});
