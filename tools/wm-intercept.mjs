/**
 * Intercept the REAL Preview request that Next.js client sends
 * to compare headers/payload with our manual fetch approach.
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
const TEST_AUDIENCE_ID = 'a4666209-caa6-4a93-80db-dea6abf7470f';

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

// Login
console.log('Logging in...');
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
// Select workspace if needed
const currentUrl = page.url();
if (currentUrl.includes('/home') && !currentUrl.includes('simple-audience')) {
    await page.evaluate(() => {
        const l = Array.from(document.querySelectorAll('a')).find(a => a.href.includes('/home/simple-audience'));
        if (l) l.click();
    });
    await page.waitForNavigation({ waitUntil: 'load', timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(2000);
}
console.log(`Logged in. URL: ${page.url()}\n`);

// Navigate to the working audience page
const audienceUrl = `${BASE_URL}/home/${WORKSPACE_SLUG}/audience/${TEST_AUDIENCE_ID}`;
console.log(`Navigating to: ${audienceUrl}`);
await page.goto(audienceUrl, { waitUntil: 'networkidle2', timeout: 60000 });
await page.waitForTimeout(3000);
console.log(`Page loaded: ${page.url()}\n`);

// Get cookies
const cookies = await page.cookies();
console.log('COOKIES:');
cookies.forEach(c => console.log(`  ${c.name} = ${c.value.substring(0, 60)}...`));
console.log('');

// Set up request interception to capture the real Preview POST
console.log('Setting up request interception...');
await page.setRequestInterception(true);

let capturedRequests = [];
page.on('request', (req) => {
    if (req.method() === 'POST' && req.headers()['next-action']) {
        capturedRequests.push({
            url: req.url(),
            headers: req.headers(),
            postData: req.postData()
        });
        console.log(`\nCAPTURED POST with next-action: ${req.headers()['next-action'].substring(0, 20)}...`);
    }
    req.continue();
});

// List all buttons so we can find the Preview button
const buttons = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('button')).map((b, i) => ({
        index: i,
        text: b.textContent?.trim().substring(0, 50),
        classes: b.className?.substring(0, 80),
        type: b.type,
        disabled: b.disabled
    }));
});
console.log('\nAll buttons on page:');
buttons.forEach(b => console.log(`  [${b.index}] "${b.text}" type=${b.type} disabled=${b.disabled}`));

// Try to click the Preview button
console.log('\nClicking Preview...');
const clickResult = await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    // Look for preview button
    const preview = btns.find(b => {
        const text = b.textContent?.trim().toLowerCase();
        return text === 'preview' || text.includes('preview');
    });
    if (preview) {
        preview.click();
        return `Clicked: "${preview.textContent.trim()}"`;
    }
    return 'No preview button found';
});
console.log(`Click result: ${clickResult}`);

// Wait for the request to fire
console.log('Waiting 10s for request...');
await page.waitForTimeout(10000);

await page.setRequestInterception(false);

if (capturedRequests.length > 0) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`CAPTURED ${capturedRequests.length} REQUEST(S)`);
    console.log('='.repeat(60));

    for (const [i, req] of capturedRequests.entries()) {
        console.log(`\n--- Request ${i + 1} ---`);
        console.log(`URL: ${req.url}`);
        console.log(`\nHEADERS:`);
        for (const [k, v] of Object.entries(req.headers)) {
            if (['next-action', 'next-router-state-tree', 'content-type', 'accept', 'x-deployment-id', 'x-csrf-token', 'cookie'].includes(k)) {
                console.log(`  ${k}: ${k === 'cookie' ? v.substring(0, 100) + '...' : v}`);
            }
        }
        console.log(`\nPOST DATA:\n${req.postData?.substring(0, 1500)}`);
    }

    // Save full capture
    fs.writeFileSync(
        path.join(ROOT, 'tools', 'captures', 'wm-intercepted-request.json'),
        JSON.stringify(capturedRequests, null, 2)
    );
    console.log('\nSaved to tools/captures/wm-intercepted-request.json');
} else {
    console.log('\nNo POST requests captured. Preview button may not have triggered.');
}

console.log('\nClosing in 10s...');
await page.waitForTimeout(10000);
await browser.close();
