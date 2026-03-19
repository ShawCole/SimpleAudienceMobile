/**
 * Standalone script: Login → Search → Navigate → Click Preview → Capture request payload.
 * Own browser, own Chrome profile. Does NOT touch VacuumEngine.
 *
 * Usage: node tools/capture-preview-payload.mjs "0-50"
 */

import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// Load .env
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
const USER_DATA_DIR = path.join(ROOT, 'tools', '.chrome-explore-profile');
const OUTPUT_DIR = path.join(ROOT, 'tools', 'captures');
const SCREENSHOT_DIR = path.join(ROOT, 'tools', 'screenshots');

const SEARCH_INPUT_XPATH = '/html/body/div[2]/div/div[2]/div[2]/div[2]/div/div[1]/div/input';
const EDIT_BUTTON_XPATH = '/html/body/div[2]/div/div[2]/div[2]/div[2]/div/div[2]/div[1]/table/tbody/tr[1]/td[8]/div/a[1]';
const PREVIEW_BUTTON_XPATH = '/html/body/div[2]/div/div[2]/div[2]/div[1]/div/div[2]/div/button[1]';

for (const dir of [OUTPUT_DIR, SCREENSHOT_DIR]) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

async function shot(page, name) {
    const file = path.join(SCREENSHOT_DIR, `${name}.png`);
    await page.screenshot({ path: file, fullPage: true });
    console.log(`📸 ${file}`);
}

async function main() {
    const searchTerm = process.argv[2] || '0-50';
    console.log(`🚀 Launching browser...`);
    console.log(`🔍 Search term: "${searchTerm}"`);

    const browser = await puppeteer.default.launch({
        executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        headless: false,
        userDataDir: USER_DATA_DIR,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1400,1024', '--window-position=800,50'],
        defaultViewport: null
    });

    const page = await browser.newPage();

    try {
        // === 1. LOGIN ===
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
            console.log('✅ Login successful.');
        } else {
            console.log('✅ Already authenticated.');
        }

        // === 2. DASHBOARD ===
        console.log('📊 Navigating to dashboard...');
        await page.goto(`${BASE_URL}/home/bizypro`, { waitUntil: 'load', timeout: 30000 });
        await page.waitForFunction(() => {
            const rows = document.querySelectorAll('table tbody tr');
            return rows.length > 0;
        }, { timeout: 30000 });
        console.log('✅ Dashboard loaded.');

        // === 3. SEARCH ===
        console.log(`🔍 Typing "${searchTerm}" into search...`);
        const [inputHandle] = await page.$$('::-p-xpath(' + SEARCH_INPUT_XPATH + ')');
        if (!inputHandle) throw new Error('Search input not found');
        await inputHandle.click();
        await page.waitForTimeout(300);
        await inputHandle.type(searchTerm, { delay: 50 });
        await page.waitForTimeout(300);

        console.log('⏎ Pressing Enter...');
        await Promise.all([
            page.waitForNavigation({ waitUntil: 'load', timeout: 30000 }),
            page.keyboard.press('Enter')
        ]);
        console.log(`✅ Search submitted. URL: ${page.url()}`);

        // Wait for filtered results
        await page.waitForFunction(() => {
            const row = document.querySelector('table tbody tr:first-child');
            return row && !row.textContent.includes('No data');
        }, { timeout: 15000 });
        await page.waitForTimeout(1000);

        const firstRowText = await page.evaluate(() => {
            const row = document.querySelector('table tbody tr:first-child');
            return row?.textContent?.substring(0, 80) || 'EMPTY';
        });
        console.log(`📋 First row: ${firstRowText}`);
        await shot(page, 'search-results');

        // === 4. CLICK EDIT ===
        console.log('✏️ Clicking edit button...');
        const editInfo = await page.evaluate((xpath) => {
            const result = document.evaluate(xpath, document, null, 9, null);
            const el = result.singleNodeValue;
            if (el) {
                const info = { tag: el.tagName, href: el.getAttribute('href'), text: el.textContent?.trim() };
                el.click();
                return info;
            }
            // Fallback: find <a> with /audience/ in first row
            const row = document.querySelector('table tbody tr:first-child');
            if (!row) return null;
            const links = Array.from(row.querySelectorAll('a'));
            for (const a of links) {
                if ((a.getAttribute('href') || '').includes('/audience/')) {
                    a.click();
                    return { tag: 'A', href: a.getAttribute('href'), text: a.textContent?.trim(), fallback: true };
                }
            }
            return null;
        }, EDIT_BUTTON_XPATH);

        if (!editInfo) throw new Error('Edit button not found');
        console.log(`📎 Clicked: ${JSON.stringify(editInfo)}`);
        await page.waitForNavigation({ waitUntil: 'load', timeout: 30000 });
        console.log(`✅ On audience page: ${page.url()}`);
        await page.waitForTimeout(2000);
        await shot(page, 'audience-edit');

        // === 5. SET UP NETWORK INTERCEPTION, THEN CLICK PREVIEW ===
        console.log('📡 Setting up network interception for Preview payload...');

        // Listen for the POST request that carries the preview payload
        const payloadPromise = new Promise((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error('No preview POST detected within 30s')), 30000);

            page.on('request', (req) => {
                if (req.method() === 'POST' && req.headers()['next-action']) {
                    const postData = req.postData();
                    const nextAction = req.headers()['next-action'];
                    clearTimeout(timeout);
                    resolve({
                        url: req.url(),
                        method: req.method(),
                        nextAction,
                        postData,
                        headers: req.headers()
                    });
                }
            });
        });

        // Click Preview button
        console.log('👆 Clicking Preview button...');
        await page.evaluate((xpath) => {
            const result = document.evaluate(xpath, document, null, 9, null);
            const el = result.singleNodeValue;
            if (el) {
                console.log('Found preview button:', el.textContent);
                el.click();
            } else {
                throw new Error('Preview button not found at XPath');
            }
        }, PREVIEW_BUTTON_XPATH);

        console.log('⏳ Waiting for preview network request...');
        const payload = await payloadPromise;

        console.log('\n========================================');
        console.log('  CAPTURED PREVIEW PAYLOAD');
        console.log('========================================');
        console.log(`URL: ${payload.url}`);
        console.log(`Next-Action: ${payload.nextAction}`);
        console.log(`\nPOST Body:`);

        // Parse and pretty-print the payload
        let parsedBody = payload.postData;
        try {
            parsedBody = JSON.parse(payload.postData);
            console.log(JSON.stringify(parsedBody, null, 2));
        } catch {
            console.log(parsedBody);
        }

        // Save to file
        const captureFile = path.join(OUTPUT_DIR, `preview-payload-${searchTerm.replace(/\s+/g, '-')}-${Date.now()}.json`);
        fs.writeFileSync(captureFile, JSON.stringify({
            capturedAt: new Date().toISOString(),
            searchTerm,
            audienceUrl: page.url(),
            request: {
                url: payload.url,
                nextAction: payload.nextAction,
                body: parsedBody
            }
        }, null, 2));
        console.log(`\n💾 Saved: ${captureFile}`);

        console.log('\n🖥️  Browser open. Ctrl+C to close.');
        await new Promise(() => {});

    } catch (err) {
        console.error('❌', err.message);
        await shot(page, 'error');
        await browser.close();
        process.exit(1);
    }
}

main();
