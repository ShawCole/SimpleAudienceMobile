/**
 * End-to-End Segment Creation Test
 *
 * 1. Log in
 * 2. Navigate to segments page
 * 3. Grab a "View in Studio" link
 * 4. Navigate to that Studio URL (loads audience context)
 * 5. Fire segment creation POST from that page context
 * 6. Verify the new segment appears
 *
 * Usage: node tools/test-segment-e2e.mjs [segment-name]
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
const USER_DATA_DIR = path.join(ROOT, 'tools', '.chrome-test-e2e-profile');
const CAPTURES_DIR = path.join(ROOT, 'tools', 'captures');

const ACCOUNT_ID = '27e2bf65-59ba-4a31-b754-97a6652fe36d';
const SEGMENT_CREATE_ACTION = '7f64516de2ed77be9587cc5061f2316ee744572e54';

const SELECTED_FIELDS = [
    "AGE_RANGE", "CHILDREN", "COMPANY_NAME", "PERSONAL_VERIFIED_EMAILS",
    "BUSINESS_VERIFIED_EMAILS", "EDUCATION_HISTORY", "FACEBOOK_URL", "TWITTER_URL",
    "FIRST_NAME", "GENDER", "INCOME_RANGE", "JOB_TITLE", "LAST_NAME", "LINKEDIN_URL",
    "MARRIED", "MOBILE_PHONE", "MOBILE_PHONE_DNC", "NET_WORTH", "PERSONAL_ADDRESS",
    "PERSONAL_CITY", "PERSONAL_PHONE", "PERSONAL_PHONE_DNC", "PERSONAL_STATE",
    "PERSONAL_ZIP", "PERSONAL_ZIP4", "SENIORITY_LEVEL", "SHA256_PERSONAL_EMAIL",
    "SKIPTRACE_ADDRESS", "SKIPTRACE_CITY", "SKIPTRACE_CREDIT_RATING", "SKIPTRACE_DNC",
    "SKIPTRACE_LANGUAGE_CODE", "SKIPTRACE_NAME", "SKIPTRACE_STATE",
    "SKIPTRACE_WIRELESS_NUMBERS", "SKIPTRACE_ZIP", "UUID", "VALID_PHONES"
];

const ONLY_FIRST_VALUE_FIELDS = [
    "MOBILE_PHONE", "MOBILE_PHONE_DNC", "PERSONAL_PHONE",
    "PERSONAL_PHONE_DNC", "VALID_PHONES"
];

async function main() {
    const testSegmentName = process.argv[2] || `E2E Test ${new Date().toISOString().slice(0, 16)}`;

    console.log('🚀 End-to-End Segment Creation Test');
    console.log(`   Segment name: "${testSegmentName}"\n`);

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

    // ──────────────────────────────────
    // STEP 1: Login
    // ──────────────────────────────────
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

    // ──────────────────────────────────
    // STEP 2: Navigate to segments page
    // ──────────────────────────────────
    console.log('STEP 2: Navigate to segments page');
    await page.goto(`${BASE_URL}/home/bizypro/segment`, { waitUntil: 'load', timeout: 30000 });
    await page.waitForTimeout(3000);
    console.log(`   📍 URL: ${page.url()}\n`);

    // ──────────────────────────────────
    // STEP 3: Find a "View in Studio" link
    // ──────────────────────────────────
    console.log('STEP 3: Find "View in Studio" link');

    // Look for links that point to /home/bizypro/studio?segment=...
    const studioLinks = await page.evaluate(() => {
        const links = Array.from(document.querySelectorAll('a[href*="/studio?segment="]'));
        return links.map(a => ({
            href: a.href,
            text: a.textContent.trim().substring(0, 80),
            title: a.getAttribute('title') || ''
        }));
    });

    if (studioLinks.length === 0) {
        // Maybe the links are buttons or differently structured — let's look broader
        console.log('   No <a> links found. Searching for any element with "Studio" text...');
        const allStudioRefs = await page.evaluate(() => {
            // Check all links on the page
            const allLinks = Array.from(document.querySelectorAll('a'));
            return allLinks
                .filter(a => a.href.includes('studio'))
                .map(a => ({ href: a.href, text: a.textContent.trim().substring(0, 80) }));
        });
        console.log('   All studio links found:', JSON.stringify(allStudioRefs, null, 2));

        if (allStudioRefs.length === 0) {
            console.log('   ⚠️  No studio links found on first page. Let me dump page structure...');
            // Dump what we can see on the segments page
            const pageInfo = await page.evaluate(() => {
                const rows = document.querySelectorAll('tr');
                const info = [];
                rows.forEach((row, i) => {
                    if (i > 5) return; // just first few
                    const cells = Array.from(row.querySelectorAll('td, th'));
                    info.push(cells.map(c => c.textContent.trim().substring(0, 40)).join(' | '));
                });
                // Also look for any buttons
                const buttons = Array.from(document.querySelectorAll('button'));
                const btnTexts = buttons.map(b => b.textContent.trim().substring(0, 40)).filter(t => t);
                return { tableRows: info, buttons: btnTexts.slice(0, 20) };
            });
            console.log('   Table rows:', pageInfo.tableRows);
            console.log('   Buttons:', pageInfo.buttons);
            console.log('\n   Keeping browser open — check the segments page manually.');
            await new Promise(() => {});
        }
    }

    console.log(`   Found ${studioLinks.length} "View in Studio" link(s):`);
    studioLinks.forEach((l, i) => console.log(`     [${i}] ${l.href}`));

    // Use the first one
    const targetLink = studioLinks[0];
    const segmentMatch = targetLink.href.match(/segment=([0-9a-f-]+)/);
    const existingSegmentId = segmentMatch ? segmentMatch[1] : null;
    console.log(`   📎 Using: ${targetLink.href}`);
    console.log(`   📎 Segment ID: ${existingSegmentId}\n`);

    // ──────────────────────────────────
    // STEP 4: Navigate to Studio via that link
    // ──────────────────────────────────
    console.log('STEP 4: Navigate to Studio via "View in Studio" link');
    await page.goto(targetLink.href, { waitUntil: 'load', timeout: 30000 });
    await page.waitForTimeout(5000);
    console.log(`   📍 URL: ${page.url()}`);

    // Extract the audienceId from the page context
    // We need to find it — it should be in the page data
    const audienceInfo = await page.evaluate(() => {
        // Look for audience ID in the page's data/props
        const text = document.body.innerText;
        // Try to find audience name displayed on page
        const h1s = Array.from(document.querySelectorAll('h1, h2, h3'));
        const headings = h1s.map(h => h.textContent.trim());

        // Look for any element containing the audience ID pattern
        const allText = document.body.innerHTML;
        const audienceIdMatch = allText.match(/"audience_id"\s*:\s*"([0-9a-f-]+)"/);
        const audienceIdMatch2 = allText.match(/"audienceId"\s*:\s*"([0-9a-f-]+)"/);

        return {
            headings,
            audienceId: audienceIdMatch?.[1] || audienceIdMatch2?.[1] || null,
            url: window.location.href
        };
    });

    console.log(`   Headings on page: ${JSON.stringify(audienceInfo.headings)}`);

    // We might need to get the audienceId from the segment data
    // Let's try intercepting by fetching the segment info
    let audienceId = audienceInfo.audienceId;

    if (!audienceId) {
        console.log('   audienceId not found in page HTML directly. Trying to fetch segment data...');
        // We can call the segment list action to get audience info
        const segData = await page.evaluate(async (segId) => {
            try {
                const res = await fetch('/home/bizypro/studio', {
                    method: 'POST',
                    headers: {
                        'accept': 'text/x-component',
                        'content-type': 'text/plain;charset=UTF-8',
                        'next-action': '7fb0ef6facb6a60db9198ecbf459eff7091a73eb95',
                        'next-router-state-tree': JSON.stringify(
                            ["", {"children": ["home", {"children": [["account", "bizypro", "d"], {"children": ["studio", {"children": ["__PAGE__", {}, null, null]}, null, null]}, null, null]}, null, null]}, null, null, true]
                        ),
                    },
                    body: JSON.stringify([{ id: segId }])
                });
                const text = await res.text();
                // Try to extract audience_id from the response
                const match = text.match(/"audience_id"\s*:\s*"([0-9a-f-]+)"/);
                return { audienceId: match?.[1] || null, text: text.substring(0, 500) };
            } catch (e) {
                return { error: e.message };
            }
        }, existingSegmentId);

        if (segData.audienceId) {
            audienceId = segData.audienceId;
            console.log(`   ✅ Got audienceId from segment fetch: ${audienceId}`);
        } else {
            console.log(`   Response preview: ${segData.text || segData.error}`);
            // Fallback: just look for it in the full page source
            const fullSource = await page.content();
            const fallbackMatch = fullSource.match(/audience_id['":\s]+([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/);
            if (fallbackMatch) {
                audienceId = fallbackMatch[1];
                console.log(`   ✅ Got audienceId from page source: ${audienceId}`);
            } else {
                console.error('   ❌ Could not find audienceId. Keeping browser open to investigate.');
                await new Promise(() => {});
            }
        }
    }

    console.log(`   🎯 Audience ID: ${audienceId}\n`);

    // ──────────────────────────────────
    // STEP 5: Get the row count from the page
    // ──────────────────────────────────
    console.log('STEP 5: Get row count from page');
    const rowCount = await page.evaluate(() => {
        // Look for text showing the row count — usually displayed near the data table
        const allText = document.body.innerText;
        // Common patterns: "946 rows", "Row Count: 946", etc.
        const match = allText.match(/(\d+)\s*rows?/i) || allText.match(/row[_\s]*count[:\s]*(\d+)/i);
        // Also check for a badge/chip with the count
        const badges = Array.from(document.querySelectorAll('span, div, p'));
        for (const el of badges) {
            const t = el.textContent.trim();
            if (/^\d+$/.test(t) && parseInt(t) > 10 && parseInt(t) < 100000) {
                // Might be a row count
            }
        }
        return match ? parseInt(match[1]) : null;
    });
    console.log(`   Row count: ${rowCount || 'unknown (will use 0)'}\n`);

    // ──────────────────────────────────
    // STEP 6: Fire the segment creation POST
    // ──────────────────────────────────
    console.log('STEP 6: Create segment via API POST');

    const segmentPayload = [{
        name: testSegmentName,
        description: "",
        filters: { id: "root", operator: "AND", rules: [] },
        selectedFields: SELECTED_FIELDS,
        onlyFirstValueFields: ONLY_FIRST_VALUE_FIELDS,
        rowCount: rowCount || 0,
        audienceId: audienceId,
        pixelId: "$undefined",
        accountId: ACCOUNT_ID
    }];

    console.log(`   📤 Payload:`);
    console.log(`      name: "${testSegmentName}"`);
    console.log(`      audienceId: ${audienceId}`);
    console.log(`      selectedFields: ${SELECTED_FIELDS.length}`);
    console.log(`      onlyFirstValueFields: ${ONLY_FIRST_VALUE_FIELDS.length}`);
    console.log(`      rowCount: ${rowCount || 0}`);

    const result = await page.evaluate(async (payload, actionId) => {
        try {
            const res = await fetch('/home/bizypro/studio', {
                method: 'POST',
                headers: {
                    'accept': 'text/x-component',
                    'content-type': 'text/plain;charset=UTF-8',
                    'next-action': actionId,
                    'next-router-state-tree': JSON.stringify(
                        ["", {"children": ["home", {"children": [["account", "bizypro", "d"], {"children": ["studio", {"children": ["__PAGE__", {}, null, null]}, null, null]}, null, null]}, null, null]}, null, null, true]
                    ),
                },
                body: JSON.stringify(payload)
            });

            const status = res.status;
            const text = await res.text();
            return { status, text, ok: res.ok };
        } catch (e) {
            return { error: e.message };
        }
    }, segmentPayload, SEGMENT_CREATE_ACTION);

    console.log(`\n   📥 Response: ${result.status} (ok: ${result.ok})`);
    if (result.error) {
        console.log(`   ❌ Error: ${result.error}`);
    }

    // Parse the RSC response to check for segment data
    const responseText = result.text || '';
    const newSegmentIdMatch = responseText.match(/"id"\s*:\s*"([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})"/);
    const nameInResponse = responseText.includes(testSegmentName);

    if (nameInResponse) {
        console.log(`   ✅ Segment name "${testSegmentName}" found in response!`);
    }
    if (newSegmentIdMatch) {
        console.log(`   ✅ New segment ID: ${newSegmentIdMatch[1]}`);
    }

    // Save full response
    const outFile = path.join(CAPTURES_DIR, 'segment-e2e-result.json');
    fs.writeFileSync(outFile, JSON.stringify({
        testSegmentName,
        audienceId,
        rowCount,
        existingSegmentId,
        responseStatus: result.status,
        responseOk: result.ok,
        responseText: responseText.substring(0, 5000),
        newSegmentId: newSegmentIdMatch?.[1] || null,
        nameFoundInResponse: nameInResponse
    }, null, 2));
    console.log(`   💾 Saved to ${outFile}\n`);

    // ──────────────────────────────────
    // STEP 7: Verify — reload page and check segments
    // ──────────────────────────────────
    console.log('STEP 7: Verify — reload studio and check if segment appears');
    await page.reload({ waitUntil: 'load', timeout: 30000 });
    await page.waitForTimeout(4000);

    // Check if our segment name appears on the page
    const verification = await page.evaluate((name) => {
        const text = document.body.innerText;
        return {
            found: text.includes(name),
            // Look for segment selector/dropdown
            pageText: text.substring(0, 3000)
        };
    }, testSegmentName);

    if (verification.found) {
        console.log(`   ✅ SUCCESS! "${testSegmentName}" is visible on the page after reload!`);
    } else {
        console.log(`   ⚠️  Segment name not found on visible page text.`);
        console.log(`   Let me check the segments list page...`);

        // Navigate to segments page to verify
        await page.goto(`${BASE_URL}/home/bizypro/segment`, { waitUntil: 'load', timeout: 30000 });
        await page.waitForTimeout(3000);

        const segListCheck = await page.evaluate((name) => {
            return document.body.innerText.includes(name);
        }, testSegmentName);

        if (segListCheck) {
            console.log(`   ✅ SUCCESS! "${testSegmentName}" found on segments list page!`);
        } else {
            console.log(`   ⚠️  Not on first page of segments. It might be on a later page.`);
            console.log(`   Keeping browser open for manual verification.`);
            await new Promise((resolve) => setTimeout(resolve, 30000));
        }
    }

    console.log('\n🏁 Test complete.');
    await browser.close();
}

main().catch(e => {
    console.error('Fatal:', e);
    process.exit(1);
});
