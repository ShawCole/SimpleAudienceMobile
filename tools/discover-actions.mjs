/**
 * Discover current Next.js server action IDs from IntentCore.
 * Clicks Preview and Generate buttons, intercepts the next-action header.
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
const WORKSPACE_SLUG = 'simple-audience';

// Use the audience we just created
const AUDIENCE_ID = 'd34c3940-e687-4869-b197-b3b3e9c8d701';

async function main() {
    console.log('═══ ACTION ID DISCOVERY ═══\n');

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

    // Intercept all requests to capture next-action headers
    const actionIds = {};
    const client = await page.createCDPSession();
    await client.send('Network.enable');

    client.on('Network.requestWillBeSent', (params) => {
        const headers = params.request.headers;
        if (headers['next-action']) {
            console.log(`[INTERCEPTED] next-action: ${headers['next-action']}`);
            console.log(`  URL: ${params.request.url}`);
            console.log(`  PostData: ${params.request.postData?.substring(0, 300)}`);
            actionIds[params.request.url] = headers['next-action'];
        }
    });

    // Login
    console.log('[1] Login...');
    await page.goto(`${BASE_URL}/auth/sign-in`, { waitUntil: 'load', timeout: 30000 });
    if (page.url().includes('sign-in')) {
        await page.waitForSelector('input[type="email"]', { visible: true, timeout: 10000 });
        await page.type('input[type="email"]', EMAIL, { delay: 50 });
        await page.waitForSelector('input[type="password"]', { visible: true, timeout: 5000 });
        await page.type('input[type="password"]', PASSWORD, { delay: 50 });
        await page.click('button[type="submit"]');
        await delay(5000);
    }
    console.log(`[1] At: ${page.url()}`);

    // Navigate to workspace
    console.log('[2] Workspace...');
    await page.goto(`${BASE_URL}/home/${WORKSPACE_SLUG}`, { waitUntil: 'load', timeout: 30000 });
    await delay(2000);

    // Navigate to audience page
    console.log('[3] Audience page...');
    await page.goto(`${BASE_URL}/home/${WORKSPACE_SLUG}/audience/${AUDIENCE_ID}`, { waitUntil: 'load', timeout: 30000 });
    await delay(5000);
    console.log(`[3] At: ${page.url()}`);

    // Also scan page source for action IDs embedded in JS
    console.log('\n[4] Scanning page source for action IDs...');
    const sourceIds = await page.evaluate(() => {
        const html = document.documentElement.outerHTML;
        const matches = [...html.matchAll(/(7f[0-9a-f]{38,42})/g)];
        return [...new Set(matches.map(m => m[1]))];
    });
    console.log(`[4] Found ${sourceIds.length} action IDs in page source:`);
    sourceIds.forEach(id => console.log(`  ${id}`));

    // Also check all script tags
    console.log('\n[5] Checking script srcs and inline scripts...');
    const scriptInfo = await page.evaluate(() => {
        const scripts = Array.from(document.querySelectorAll('script[src]'));
        return scripts.map(s => s.src).filter(s => s.includes('_next'));
    });
    console.log(`[5] Found ${scriptInfo.length} Next.js scripts`);

    // Try clicking Preview button to capture the action ID
    console.log('\n[6] Clicking Preview button to capture action ID...');
    const previewBtnFound = await page.evaluate(() => {
        const btns = Array.from(document.querySelectorAll('button'));
        const btn = btns.find(b => b.textContent?.trim().includes('Preview'));
        if (btn) { btn.click(); return true; }
        return false;
    });
    console.log(`[6] Preview button found and clicked: ${previewBtnFound}`);
    await delay(3000);

    // Try clicking Generate button
    console.log('\n[7] Clicking Generate Audience button to capture action ID...');
    const genBtnFound = await page.evaluate(() => {
        const btns = Array.from(document.querySelectorAll('button'));
        const btn = btns.find(b => b.textContent?.trim().includes('Generate'));
        if (btn) { btn.click(); return true; }
        return false;
    });
    console.log(`[7] Generate button found and clicked: ${genBtnFound}`);
    await delay(3000);

    // Summary
    console.log('\n═══ DISCOVERED ACTION IDs ═══');
    console.log('From network intercepts:');
    for (const [url, id] of Object.entries(actionIds)) {
        console.log(`  ${id} → ${url}`);
    }
    console.log('\nFrom page source:');
    sourceIds.forEach(id => console.log(`  ${id}`));

    console.log('\nBrowser open 5 min for manual testing. Ctrl+C to close.');
    await delay(300000);
    await browser.close();
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
