/**
 * Discover Workspace — simple|AUDIENCE team
 *
 * Logs into app.intentcore.io as shaw@strategysimple.com
 * Navigates to the audiences page, lists existing audiences,
 * confirms workspace slug + account ID, and reports back.
 *
 * Usage: node tools/discover-workspace.mjs
 */

import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// Load .env from backend
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
const USER_DATA_DIR = path.join(ROOT, 'tools', '.chrome-discover-profile');
const CAPTURES_DIR = path.join(ROOT, 'tools', 'captures');

if (!fs.existsSync(CAPTURES_DIR)) fs.mkdirSync(CAPTURES_DIR, { recursive: true });

async function main() {
    console.log('='.repeat(60));
    console.log('  DISCOVER: simple|AUDIENCE Workspace');
    console.log('  Login: ' + EMAIL);
    console.log('='.repeat(60));
    console.log('');

    // Clean stale lock
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

    // Enable network logging to capture any useful requests
    const networkLog = [];
    page.on('response', async (res) => {
        const url = res.url();
        if (url.includes('intentcore.io') && !url.includes('.css') && !url.includes('.js') && !url.includes('.png') && !url.includes('.svg') && !url.includes('.ico')) {
            networkLog.push({
                timestamp: new Date().toISOString(),
                status: res.status(),
                url: url,
                method: res.request().method()
            });
        }
    });

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
        console.log('   ✅ Logged in.');
    } else {
        console.log('   ✅ Already authenticated.');
    }

    // ── DISCOVER WORKSPACE ──
    console.log('\nSTEP 2: Discover workspace');
    const postLoginUrl = page.url();
    console.log(`   Post-login URL: ${postLoginUrl}`);

    // Check if we're on a workspace selector page (no slug in URL)
    let workspaceSlug;
    const slugMatch = postLoginUrl.match(/\/home\/([^\/]+)/);

    if (slugMatch) {
        workspaceSlug = slugMatch[1];
        console.log(`   Workspace slug (from URL): ${workspaceSlug}`);
    } else {
        console.log('   On workspace selector page. Looking for "simple|AUDIENCE" link...');

        // Find and click the workspace link
        const workspaceLinks = await page.evaluate(() => {
            const links = Array.from(document.querySelectorAll('a'));
            return links.map(a => ({
                text: a.textContent?.trim(),
                href: a.href,
                className: a.className
            })).filter(l => l.text && l.text.length < 100);
        });

        console.log('   Available links:');
        workspaceLinks.forEach(l => console.log(`     "${l.text}" → ${l.href}`));

        // Click on "simple|AUDIENCE" link
        const clicked = await page.evaluate(() => {
            const links = Array.from(document.querySelectorAll('a'));
            const target = links.find(a => {
                const text = a.textContent?.trim();
                return text === 'simple|AUDIENCE' || text?.includes('simple|AUDIENCE');
            });
            if (target) {
                target.click();
                return target.href;
            }
            return null;
        });

        if (clicked) {
            console.log(`   Clicked: ${clicked}`);
            await page.waitForNavigation({ waitUntil: 'load', timeout: 30000 }).catch(() => {});
            await page.waitForTimeout(3000);
        } else {
            console.log('   ⚠️  Could not find "simple|AUDIENCE" link. Trying direct navigation...');
            // Try common slug patterns
            for (const slug of ['simple-audience', 'simpleaudience', 'simple_audience']) {
                const testUrl = `${BASE_URL}/home/${slug}/audience`;
                console.log(`   Trying: ${testUrl}`);
                await page.goto(testUrl, { waitUntil: 'load', timeout: 15000 });
                await page.waitForTimeout(2000);
                if (page.url().includes(`/home/${slug}`)) {
                    console.log(`   ✅ Found workspace at slug: ${slug}`);
                    break;
                }
            }
        }

        const currentUrl = page.url();
        console.log(`   Current URL after workspace selection: ${currentUrl}`);
        const newSlugMatch = currentUrl.match(/\/home\/([^\/]+)/);
        workspaceSlug = newSlugMatch ? newSlugMatch[1] : 'unknown';
        console.log(`   Workspace slug: ${workspaceSlug}`);
    }

    await page.waitForTimeout(2000);

    // ── LIST AUDIENCES ──
    console.log('\nSTEP 3: Navigate to audiences page');
    const audiencesUrl = `${BASE_URL}/home/${workspaceSlug}/audience`;
    await page.goto(audiencesUrl, { waitUntil: 'load', timeout: 30000 });
    await page.waitForTimeout(5000);
    console.log(`   📍 URL: ${page.url()}`);

    // Extract audience table data
    const audiences = await page.evaluate(() => {
        const rows = [];

        // Try to find table rows
        const tableRows = document.querySelectorAll('table tbody tr');
        if (tableRows.length > 0) {
            tableRows.forEach(row => {
                const cells = Array.from(row.querySelectorAll('td'));
                const links = Array.from(row.querySelectorAll('a'));
                const audienceLink = links.find(a => a.href.includes('/audience/'));
                const audienceId = audienceLink?.href.match(/\/audience\/([0-9a-f-]+)/)?.[1];

                rows.push({
                    name: cells[0]?.textContent?.trim() || '',
                    status: cells[1]?.textContent?.trim() || '',
                    count: cells[2]?.textContent?.trim() || '',
                    created: cells[3]?.textContent?.trim() || '',
                    audienceId: audienceId || null,
                    cellTexts: cells.map(c => c.textContent?.trim()).filter(Boolean)
                });
            });
        }

        // Also get any headings/page info
        const headings = Array.from(document.querySelectorAll('h1, h2, h3'))
            .map(h => h.textContent?.trim())
            .filter(t => t && t.length < 100);

        // Get all links on the page that might contain audience IDs
        const allAudienceLinks = Array.from(document.querySelectorAll('a[href*="/audience/"]'))
            .map(a => ({
                text: a.textContent?.trim().substring(0, 80),
                href: a.href,
                audienceId: a.href.match(/\/audience\/([0-9a-f-]+)/)?.[1]
            }));

        // Get any buttons
        const buttons = Array.from(document.querySelectorAll('button'))
            .map(b => b.textContent?.trim())
            .filter(t => t && t.length > 0 && t.length < 40)
            .slice(0, 20);

        // Get visible text that might show audience names
        const bodyText = document.body.innerText.substring(0, 5000);

        return {
            tableRows: rows,
            headings,
            audienceLinks: allAudienceLinks,
            buttons,
            bodyTextPreview: bodyText
        };
    });

    console.log(`\n   Headings: ${JSON.stringify(audiences.headings)}`);
    console.log(`   Table rows found: ${audiences.tableRows.length}`);
    console.log(`   Audience links found: ${audiences.audienceLinks.length}`);

    if (audiences.tableRows.length > 0) {
        console.log('\n   AUDIENCES:');
        audiences.tableRows.forEach((row, i) => {
            console.log(`   [${i}] ${row.name} | ${row.status} | ${row.count} | ID: ${row.audienceId || 'N/A'}`);
            if (row.cellTexts.length > 4) {
                console.log(`       All cells: ${row.cellTexts.join(' | ')}`);
            }
        });
    } else if (audiences.audienceLinks.length > 0) {
        console.log('\n   AUDIENCE LINKS:');
        audiences.audienceLinks.forEach((link, i) => {
            console.log(`   [${i}] "${link.text}" → ID: ${link.audienceId}`);
        });
    } else {
        console.log('\n   No audiences found in table or links. Page content:');
        console.log(`   ${audiences.bodyTextPreview.substring(0, 2000)}`);
    }

    console.log(`\n   Buttons on page: ${audiences.buttons.join(', ')}`);

    // ── CHECK EXISTING AUDIENCE ──
    console.log('\nSTEP 4: Check existing high-intent audience');
    const existingAudienceId = '6310db26-d0fa-4036-a4d5-36b33a17eb8e';
    const existingUrl = `${BASE_URL}/home/${workspaceSlug}/audience/${existingAudienceId}`;
    console.log(`   📍 Navigating to: ${existingUrl}`);
    await page.goto(existingUrl, { waitUntil: 'load', timeout: 30000 });
    await page.waitForTimeout(5000);

    const existingInfo = await page.evaluate(() => {
        const headings = Array.from(document.querySelectorAll('h1, h2, h3'))
            .map(h => h.textContent?.trim())
            .filter(t => t && t.length < 100);

        const bodyText = document.body.innerText;

        // Try to find count/status info
        const countMatch = bodyText.match(/(\d[\d,]*)\s*(records?|rows?|results?|people|contacts)/i);
        const statusMatch = bodyText.match(/(generated|pending|processing|ready|draft)/i);

        // Find score/intent info
        const scoreMatch = bodyText.match(/(high|medium|low)\s*intent/i);

        return {
            url: window.location.href,
            headings,
            count: countMatch ? countMatch[0] : null,
            status: statusMatch ? statusMatch[1] : null,
            score: scoreMatch ? scoreMatch[0] : null,
            bodyPreview: bodyText.substring(0, 3000)
        };
    });

    console.log(`   Current URL: ${existingInfo.url}`);
    console.log(`   Headings: ${JSON.stringify(existingInfo.headings)}`);
    console.log(`   Count: ${existingInfo.count || 'not found'}`);
    console.log(`   Status: ${existingInfo.status || 'not found'}`);
    console.log(`   Score: ${existingInfo.score || 'not found'}`);

    // ── CHECK SEGMENTS ──
    console.log('\nSTEP 5: Check segments page');
    const segmentsUrl = `${BASE_URL}/home/${workspaceSlug}/segment`;
    await page.goto(segmentsUrl, { waitUntil: 'load', timeout: 30000 });
    await page.waitForTimeout(4000);

    const segments = await page.evaluate(() => {
        const rows = [];
        const tableRows = document.querySelectorAll('table tbody tr');
        tableRows.forEach(row => {
            const cells = Array.from(row.querySelectorAll('td'));
            const links = Array.from(row.querySelectorAll('a'));
            rows.push({
                cellTexts: cells.map(c => c.textContent?.trim()).filter(Boolean),
                links: links.map(a => ({ text: a.textContent?.trim(), href: a.href }))
            });
        });

        const studioLinks = Array.from(document.querySelectorAll('a[href*="/studio"]'))
            .map(a => ({
                text: a.textContent?.trim().substring(0, 80),
                href: a.href
            }));

        return { tableRows: rows, studioLinks };
    });

    console.log(`   Segment table rows: ${segments.tableRows.length}`);
    if (segments.tableRows.length > 0) {
        console.log('\n   SEGMENTS:');
        segments.tableRows.forEach((row, i) => {
            console.log(`   [${i}] ${row.cellTexts.join(' | ')}`);
        });
    }

    // ── CHECK SYNC PAGE ──
    console.log('\nSTEP 6: Check sync page');
    const syncUrl = `${BASE_URL}/home/${workspaceSlug}/sync`;
    await page.goto(syncUrl, { waitUntil: 'load', timeout: 30000 });
    await page.waitForTimeout(4000);

    const syncInfo = await page.evaluate(() => {
        const bodyText = document.body.innerText;
        const links = Array.from(document.querySelectorAll('a'))
            .map(a => ({ text: a.textContent?.trim(), href: a.href }))
            .filter(l => l.text && l.text.length < 80);
        const buttons = Array.from(document.querySelectorAll('button'))
            .map(b => b.textContent?.trim())
            .filter(t => t && t.length < 40);
        return { bodyPreview: bodyText.substring(0, 2000), links: links.slice(0, 20), buttons };
    });

    console.log(`   Buttons: ${syncInfo.buttons.join(', ')}`);
    console.log(`   Links: ${syncInfo.links.map(l => l.text).join(', ')}`);

    // ── SAVE DISCOVERY REPORT ──
    const report = {
        timestamp: new Date().toISOString(),
        workspace: {
            slug: workspaceSlug,
            accountId: 'fceffb3b-552d-413a-9442-e62e9d423aa0',
            loginEmail: EMAIL,
            baseUrl: BASE_URL
        },
        audienceTopic: {
            path: 'Financial Services > Retirement & College Savings > Wealth Management Services',
            segmentId: '4eyes_101950',
            netWorthFilter: ['$$500,000 to $749,999', '$$750,000 to $999,999', 'more than $1,000,000']
        },
        targetAudiences: [
            { name: 'Wealth Management - High Intent', score: ['high'], expectedCount: '~14,770' },
            { name: 'Wealth Management - Intent', score: [], expectedCount: '~23,370' },
            { name: 'Wealth Management - Low Intent', score: ['low'], expectedCount: '~499,853' }
        ],
        existingAudience: {
            id: '6310db26-d0fa-4036-a4d5-36b33a17eb8e',
            info: existingInfo
        },
        existingSegments: segments,
        syncPage: syncInfo,
        discoveredAudiences: audiences,
        networkLog: networkLog.slice(-50)
    };

    const reportFile = path.join(CAPTURES_DIR, 'workspace-discovery.json');
    fs.writeFileSync(reportFile, JSON.stringify(report, null, 2));
    console.log(`\n💾 Full report saved to ${reportFile}`);

    // Keep browser open for manual inspection
    console.log('\n🔍 Browser staying open for 60 seconds for manual inspection.');
    console.log('   Press Ctrl+C to close early.\n');
    await page.waitForTimeout(60000);

    await browser.close();
    console.log('🏁 Discovery complete.');
}

main().catch(e => {
    console.error('Fatal:', e);
    process.exit(1);
});
