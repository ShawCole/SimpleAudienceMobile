/**
 * Standalone exploration script — launches its OWN browser window.
 * Does NOT touch the VacuumEngine singleton.
 *
 * Usage: npx tsx src/scripts/explore-audience.ts [audience-name]
 */

import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });
puppeteer.use(StealthPlugin());

const BASE_URL = process.env.SIMPLEAUDIENCE_BASE_URL || 'https://app.intentcore.io';
const EMAIL = process.env.SIMPLEAUDIENCE_EMAIL!;
const PASSWORD = process.env.SIMPLEAUDIENCE_PASSWORD!;

const SEARCH_INPUT = '/html/body/div[2]/div/div[2]/div[2]/div[2]/div/div[1]/div/input';
const EDIT_BUTTON_FIRST_ROW = '/html/body/div[2]/div/div[2]/div[2]/div[2]/div/div[2]/div[1]/table/tbody/tr[1]/td[8]/div/a[1]';

const SCREENSHOT_DIR = path.resolve(__dirname, '../../logs/screenshots');

async function screenshot(page: any, name: string) {
    if (!fs.existsSync(SCREENSHOT_DIR)) fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
    const file = path.join(SCREENSHOT_DIR, `${name}.png`);
    await page.screenshot({ path: file, fullPage: true });
    console.log(`📸 Screenshot: ${file}`);
    return file;
}

async function getPageSnapshot(page: any) {
    return page.evaluate(() => {
        const buttons = Array.from(document.querySelectorAll('button'))
            .filter(b => b.offsetParent !== null)
            .map(b => b.textContent?.trim()).filter(Boolean);
        const links = Array.from(document.querySelectorAll('a'))
            .filter(a => a.offsetParent !== null)
            .map(a => ({ text: a.textContent?.trim(), href: a.getAttribute('href') }));
        const tabs = Array.from(document.querySelectorAll('[role="tab"]'))
            .map(t => ({ text: (t as HTMLElement).textContent?.trim(), state: t.getAttribute('data-state') || t.getAttribute('aria-selected') }));
        const tableHeaders = Array.from(document.querySelectorAll('th')).map(th => th.textContent?.trim());
        return { url: window.location.href, title: document.title, buttons, links: links.slice(0, 30), tabs, tableHeaders };
    });
}

async function main() {
    const audienceName = process.argv[2] || '0-50 Cali Homeowners looking to sell their home';
    console.log(`🚀 Launching NEW browser for exploration...`);
    console.log(`🎯 Target audience: "${audienceName}"`);

    const browser = await puppeteer.launch({
        executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        headless: false,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1400,1024', '--window-position=100,100'],
        defaultViewport: null
    });

    const page = await browser.newPage();

    try {
        // 1. LOGIN
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

        // 2. NAVIGATE TO DASHBOARD
        console.log('📊 Navigating to BizyPro dashboard...');
        await page.goto(`${BASE_URL}/home/bizypro`, { waitUntil: 'load', timeout: 30000 });
        await page.waitForFunction(() => {
            const btns = Array.from(document.querySelectorAll('button'));
            const rows = document.querySelectorAll('tr');
            return btns.some(b => b.textContent?.trim().includes('Create') && b.offsetParent !== null) || rows.length > 5;
        }, { timeout: 30000 });
        console.log('✅ Dashboard loaded.');
        await screenshot(page, '01-dashboard');

        // 3. SEARCH FOR AUDIENCE
        console.log(`🔍 Searching for "${audienceName}"...`);
        const inputEl = await page.waitForSelector('::-p-xpath(' + SEARCH_INPUT + ')', { visible: true, timeout: 10000 });
        await inputEl!.click({ clickCount: 3 });
        await inputEl!.type(audienceName, { delay: 30 });
        await page.waitForTimeout(2000); // Wait for search filter
        await screenshot(page, '02-search-results');

        // 4. CLICK EDIT ON FIRST ROW
        console.log('✏️ Clicking edit button on first row...');
        await Promise.all([
            page.waitForNavigation({ waitUntil: 'load', timeout: 30000 }),
            page.evaluate((xpath: string) => {
                const result = document.evaluate(xpath, document, null, 9, null);
                const el = result.singleNodeValue as HTMLElement;
                if (el) el.click();
                else throw new Error('Edit button not found');
            }, EDIT_BUTTON_FIRST_ROW)
        ]);
        console.log(`✅ On audience page: ${page.url()}`);
        await page.waitForTimeout(2000);
        await screenshot(page, '03-audience-edit');

        // 5. SNAPSHOT THE PAGE
        const snapshot = await getPageSnapshot(page);
        console.log('\n📋 PAGE SNAPSHOT:');
        console.log(`URL: ${snapshot.url}`);
        console.log(`Buttons: ${JSON.stringify(snapshot.buttons, null, 2)}`);
        console.log(`Tabs: ${JSON.stringify(snapshot.tabs, null, 2)}`);
        console.log(`Table Headers: ${JSON.stringify(snapshot.tableHeaders, null, 2)}`);

        // Save snapshot to file
        const snapshotFile = path.join(SCREENSHOT_DIR, 'page-snapshot.json');
        fs.writeFileSync(snapshotFile, JSON.stringify(snapshot, null, 2));
        console.log(`\n💾 Full snapshot saved: ${snapshotFile}`);

        // Keep browser open for manual exploration
        console.log('\n🖥️  Browser is open. Press Ctrl+C to close.');
        await new Promise(() => {}); // Keep alive

    } catch (err: any) {
        console.error('❌ Error:', err.message);
        await screenshot(page, 'error-state');
        await browser.close();
        process.exit(1);
    }
}

main();
