/**
 * Test Segment Creation via API POST
 *
 * Logs in via Puppeteer to get the auth cookie, then fires
 * the segment creation POST directly (no UI clicks).
 *
 * Usage: node tools/test-segment-create.mjs
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
const USER_DATA_DIR = path.join(ROOT, 'tools', '.chrome-test-segment-profile');

// Target audience: "50-100 Cali Homeowners looking to sell their home"
const AUDIENCE_ID = 'b98c6319-d7bd-4c7f-b8db-56de4c72da92';
const ACCOUNT_ID = '27e2bf65-59ba-4a31-b754-97a6652fe36d';

// Segment creation server action ID (from network capture)
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
    console.log('🚀 Test Segment Creation via API POST');

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

    // Login
    console.log('🔑 Logging in...');
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
        console.log('✅ Logged in.');
    } else {
        console.log('✅ Already authenticated.');
    }

    // Navigate to the studio page first (needed to establish RSC context)
    console.log('📊 Navigating to Studio...');
    await page.goto(`${BASE_URL}/home/bizypro/studio`, { waitUntil: 'load', timeout: 30000 });
    await page.waitForTimeout(3000);

    // Get all cookies for the auth
    const cookies = await page.cookies();
    const cookieHeader = cookies.map(c => `${c.name}=${c.value}`).join('; ');

    // Build the segment payload
    const segmentPayload = [{
        name: "API Test Segment",
        description: "",
        filters: { id: "root", operator: "AND", rules: [] },
        selectedFields: SELECTED_FIELDS,
        onlyFirstValueFields: ONLY_FIRST_VALUE_FIELDS,
        rowCount: 946,
        audienceId: AUDIENCE_ID,
        pixelId: "$undefined",
        accountId: ACCOUNT_ID
    }];

    console.log('\n📤 Sending segment creation POST...');
    console.log('   Name: "API Test Segment"');
    console.log(`   Audience: ${AUDIENCE_ID}`);
    console.log(`   Fields: ${SELECTED_FIELDS.length} selected, ${ONLY_FIRST_VALUE_FIELDS.length} "only first"`);

    // Execute the POST from within the browser context to get the right cookies/headers
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
            return { status, text: text.substring(0, 2000), ok: res.ok };
        } catch (e) {
            return { error: e.message };
        }
    }, segmentPayload, SEGMENT_CREATE_ACTION);

    console.log('\n📥 Response:');
    console.log(`   Status: ${result.status}`);
    console.log(`   OK: ${result.ok}`);
    if (result.error) {
        console.log(`   Error: ${result.error}`);
    } else {
        console.log(`   Body (first 2000 chars):\n${result.text}`);
    }

    // Save the result
    const outFile = path.join(ROOT, 'tools', 'captures', 'segment-create-test-result.json');
    fs.writeFileSync(outFile, JSON.stringify(result, null, 2));
    console.log(`\n💾 Saved to ${outFile}`);

    await browser.close();
    console.log('✅ Done.');
}

main().catch(e => {
    console.error('Fatal:', e);
    process.exit(1);
});
