/**
 * Dump Column Names — navigates to Studio, opens an audience's column config,
 * and dumps all column names from the grid.
 *
 * Usage: node tools/dump-column-names.mjs [audience-search-query]
 *   Default: "0-50 Cali"
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
const USER_DATA_DIR = path.join(ROOT, 'tools', '.chrome-dump-profile');

async function main() {
    const searchQuery = process.argv[2] || '0-50 Cali';

    console.log('🚀 Column Name Dumper starting...');

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

    // Navigate to Studio
    console.log('📊 Navigating to Studio...');
    await page.goto(`${BASE_URL}/home/bizypro/studio`, { waitUntil: 'load', timeout: 30000 });
    await page.waitForTimeout(3000);

    // Search for the audience
    console.log(`🔍 Searching for "${searchQuery}"...`);
    const searchInput = await page.waitForSelector('input', { visible: true, timeout: 10000 });
    await searchInput.click({ clickCount: 3 }); // select all existing text
    await searchInput.type(searchQuery, { delay: 30 });
    // Search triggers page navigation with ?query= param
    await Promise.all([
        page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15000 }).catch(() => {}),
        page.keyboard.press('Enter')
    ]);
    await page.waitForTimeout(4000);

    // After search, click the dataset result card
    console.log('📝 Selecting dataset from search results...');
    // XPath: /html/body/div[2]/div/div[2]/div[2]/div[2]/div[1]/div[3]/div/div
    const datasetXPath = '/html/body/div[2]/div/div[2]/div[2]/div[2]/div[1]/div[3]/div/div';
    try {
        await page.waitForXPath(datasetXPath, { visible: true, timeout: 10000 });
    } catch {
        console.error('❌ Dataset result not found at expected XPath after search.');
        console.log('   Keeping browser open — check the page manually.');
        await new Promise(() => {});
    }
    const [datasetEl] = await page.$x(datasetXPath);
    await datasetEl.click();
    console.log('✅ Dataset selected.');
    await page.waitForTimeout(4000);

    // Now we should be on the audience detail/segment page with the column grid
    // Dump all column names by querying the grid
    console.log('\n📋 Dumping column names from grid...\n');

    const columns = await page.evaluate(() => {
        // The column grid cards have class "cursor-pointer rounded border p-3"
        const cards = document.querySelectorAll('div.cursor-pointer.rounded.border.p-3');
        const results = [];
        cards.forEach((card, i) => {
            const nameSpan = card.querySelector('span.truncate');
            const name = nameSpan ? nameSpan.textContent.trim() : '???';

            // Check if selected (has blue/checked icon)
            const svg = card.querySelector('svg');
            const isSelected = svg ? (svg.getAttribute('class') || '').includes('text-blue') || card.classList.contains('border-blue') : false;

            // Check data type
            const typeSpan = card.querySelector('div:nth-child(2) span:first-child');
            const dataType = typeSpan ? typeSpan.textContent.trim() : '';

            // Check for "Only First" toggle
            const toggle = card.querySelector('button[role="switch"]');
            const hasOnlyFirst = !!toggle;
            const onlyFirstChecked = toggle ? toggle.getAttribute('data-state') === 'checked' : false;

            results.push({
                gridIndex: i + 1,
                name,
                dataType,
                hasOnlyFirst,
                onlyFirstChecked,
            });
        });
        return results;
    });

    if (columns.length === 0) {
        console.error('❌ No column cards found. The page might not have loaded the grid yet.');
        console.log('   Current URL:', page.url());
        console.log('   Keeping browser open — check the page manually.');
        // Don't close, let user investigate
        await new Promise(() => {});
    }

    console.log(`Found ${columns.length} columns:\n`);
    console.log('Grid# | Column Name                    | Type       | Only First');
    console.log('------|--------------------------------|------------|----------');
    for (const col of columns) {
        const onlyFirst = col.hasOnlyFirst ? (col.onlyFirstChecked ? '✅ ON' : '⬜ OFF') : '';
        console.log(
            `  ${String(col.gridIndex).padStart(2)}  | ${col.name.padEnd(30)} | ${col.dataType.padEnd(10)} | ${onlyFirst}`
        );
    }

    // Save to file
    const outFile = path.join(ROOT, 'tools', 'captures', 'column-names.json');
    fs.writeFileSync(outFile, JSON.stringify(columns, null, 2));
    console.log(`\n💾 Saved to ${outFile}`);

    await browser.close();
    console.log('✅ Done.');
}

main().catch(e => {
    console.error('Fatal:', e);
    process.exit(1);
});
