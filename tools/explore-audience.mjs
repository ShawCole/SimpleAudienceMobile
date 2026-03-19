/**
 * Standalone exploration script — completely independent of backend.
 * Launches its OWN browser with its OWN Chrome profile.
 * Does NOT touch VacuumEngine or the backend server.
 *
 * Usage: node tools/explore-audience.mjs "audience name"
 */

import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// Load .env manually (no dotenv dependency needed)
const envPath = path.join(ROOT, 'backend', '.env');
const envContent = fs.readFileSync(envPath, 'utf8');
const env = {};
for (const line of envContent.split('\n')) {
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (match) env[match[1].trim()] = match[2].trim();
}

puppeteer.default.use(StealthPlugin());

const BASE_URL = env.SIMPLEAUDIENCE_BASE_URL || 'https://app.intentcore.io';
const EMAIL = env.SIMPLEAUDIENCE_EMAIL;
const PASSWORD = env.SIMPLEAUDIENCE_PASSWORD;

const SEARCH_INPUT_XPATH = '/html/body/div[2]/div/div[2]/div[2]/div[2]/div/div[1]/div/input';
const EDIT_BUTTON_FIRST_ROW = '/html/body/div[2]/div/div[2]/div[2]/div[2]/div/div[2]/div[1]/table/tbody/tr[1]/td[8]/div/a[1]';

const SCREENSHOT_DIR = path.join(ROOT, 'tools', 'screenshots');
if (!fs.existsSync(SCREENSHOT_DIR)) fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

// Separate Chrome profile so we don't conflict with VacuumEngine's browser
const USER_DATA_DIR = path.join(ROOT, 'tools', '.chrome-explore-profile');

async function shot(page, name) {
    const file = path.join(SCREENSHOT_DIR, `${name}.png`);
    await page.screenshot({ path: file, fullPage: true });
    console.log(`📸 ${file}`);
    return file;
}

async function main() {
    const audienceName = process.argv[2] || '0-50 Cali Homeowners looking to sell their home';
    console.log(`🚀 Launching SEPARATE browser (own profile)...`);
    console.log(`🎯 Target: "${audienceName}"`);
    console.log(`🌐 Base URL: ${BASE_URL}`);

    const browser = await puppeteer.default.launch({
        executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        headless: false,
        userDataDir: USER_DATA_DIR,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--window-size=1400,1024',
            '--window-position=800,50'  // Offset so it doesn't overlap the other window
        ],
        defaultViewport: null
    });

    const page = await browser.newPage();

    try {
        // 1. LOGIN
        console.log('🔑 Navigating to sign-in...');
        await page.goto(`${BASE_URL}/auth/sign-in`, { waitUntil: 'load', timeout: 30000 });

        if (page.url().includes('sign-in')) {
            console.log('🔑 Typing credentials...');
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
            console.log('✅ Already authenticated (cached session).');
        }

        // 2. DASHBOARD
        console.log('📊 Navigating to BizyPro dashboard...');
        await page.goto(`${BASE_URL}/home/bizypro`, { waitUntil: 'load', timeout: 30000 });
        await page.waitForFunction(() => {
            const rows = document.querySelectorAll('table tbody tr');
            return rows.length > 0;
        }, { timeout: 30000 });
        console.log('✅ Dashboard loaded.');
        await shot(page, '01-dashboard');

        // 3. SEARCH — click input, type name, press Enter
        console.log(`🔍 Searching for "${audienceName}"...`);

        const [inputHandle] = await page.$$('::-p-xpath(' + SEARCH_INPUT_XPATH + ')');
        if (!inputHandle) throw new Error('Search input not found');

        await inputHandle.click();
        await page.waitForTimeout(300);
        await inputHandle.type('0-50', { delay: 50 });
        await page.waitForTimeout(300);

        // Press Enter and wait for the page to navigate/reload with ?query=
        console.log('⏳ Pressing Enter to search...');
        await Promise.all([
            page.waitForNavigation({ waitUntil: 'load', timeout: 30000 }),
            page.keyboard.press('Enter')
        ]);
        console.log(`✅ Search submitted. URL: ${page.url()}`);

        // Wait for table rows to appear after search reload
        await page.waitForFunction(() => {
            const row = document.querySelector('table tbody tr:first-child');
            return row && !row.textContent.includes('No data');
        }, { timeout: 15000 });
        await page.waitForTimeout(1000); // Let DOM settle

        const searchResult = await page.evaluate(() => {
            const rows = document.querySelectorAll('table tbody tr');
            const firstRow = rows[0];
            return {
                rowCount: rows.length,
                firstRowText: firstRow ? firstRow.textContent?.substring(0, 80) : 'NO ROWS'
            };
        });
        console.log(`📋 Results: ${searchResult.rowCount} row(s)`);
        console.log(`📋 First row: ${searchResult.firstRowText}`);
        await shot(page, '02-search-filtered');

        // 4. CLICK EDIT ON FIRST ROW
        console.log('✏️ Clicking edit button (first row, XPath)...');
        // Try the user-provided XPath for the edit button
        const editClicked = await page.evaluate((xpath) => {
            const result = document.evaluate(xpath, document, null, 9, null);
            const el = result.singleNodeValue;
            if (el) {
                // Log what we're clicking for debugging
                const tag = el.tagName;
                const href = el.getAttribute('href');
                const text = el.textContent?.trim();
                el.click();
                return { tag, href, text };
            }
            // Fallback: find any <a> with /audience/ href in first row
            const firstRow = document.querySelector('table tbody tr:first-child');
            if (!firstRow) return null;
            const links = Array.from(firstRow.querySelectorAll('a'));
            for (const link of links) {
                const h = link.getAttribute('href') || '';
                if (h.includes('/audience/')) {
                    link.click();
                    return { tag: 'A', href: h, text: link.textContent?.trim(), fallback: true };
                }
            }
            return null;
        }, EDIT_BUTTON_FIRST_ROW);

        if (!editClicked) throw new Error('Could not find edit button in first row');
        console.log(`📎 Clicked: ${JSON.stringify(editClicked)}`);
        await page.waitForNavigation({ waitUntil: 'load', timeout: 30000 });

        console.log(`✅ Navigated to: ${page.url()}`);
        await page.waitForTimeout(2000);
        await shot(page, '03-audience-edit');

        // 5. SNAPSHOT
        const snapshot = await page.evaluate(() => {
            const buttons = Array.from(document.querySelectorAll('button'))
                .filter(b => b.offsetParent !== null)
                .map(b => b.textContent?.trim()).filter(Boolean);
            const tabs = Array.from(document.querySelectorAll('[role="tab"]'))
                .map(t => ({ text: t.textContent?.trim(), selected: t.getAttribute('aria-selected') }));
            const links = Array.from(document.querySelectorAll('a'))
                .filter(a => a.offsetParent !== null && a.getAttribute('href'))
                .map(a => ({ text: a.textContent?.trim()?.substring(0, 40), href: a.getAttribute('href') }))
                .slice(0, 30);
            return { url: window.location.href, buttons, tabs, links };
        });

        console.log('\n📋 PAGE STATE:');
        console.log('Buttons:', JSON.stringify(snapshot.buttons));
        console.log('Tabs:', JSON.stringify(snapshot.tabs));
        console.log('Links:', JSON.stringify(snapshot.links.filter(l => l.text?.length > 0), null, 2));

        fs.writeFileSync(path.join(SCREENSHOT_DIR, 'snapshot.json'), JSON.stringify(snapshot, null, 2));

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
