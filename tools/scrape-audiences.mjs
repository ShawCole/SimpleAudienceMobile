import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import fs from 'fs';
import path from 'path';
import https from 'https';
import http from 'http';
import { ACCOUNT_ID, WORKSPACE_SLUG } from './lib/payload-template.mjs';

const ROOT = process.cwd();
const envContent = fs.readFileSync(path.join(ROOT, 'backend', '.env'), 'utf8');
const env = {};
for (const line of envContent.split('\n')) { const m = line.match(/^([^#=]+)=(.*)$/); if (m) env[m[1].trim()] = m[2].trim(); }

puppeteer.default.use(StealthPlugin());
const delay = ms => new Promise(r => setTimeout(r, ms));
const BASE_URL = env.SIMPLEAUDIENCE_BASE_URL || 'https://app.intentcore.io';
const USER_DATA_DIR = path.join(ROOT, 'tools', '.chrome-inject-profile');
const lockFile = path.join(USER_DATA_DIR, 'SingletonLock');
if (fs.existsSync(lockFile)) fs.unlinkSync(lockFile);

const OUTDIR = '/tmp/explorer-build-anthony-will-1776102439000';

function downloadFile(url, dest) {
    return new Promise((resolve, reject) => {
        const proto = url.startsWith('https') ? https : http;
        const file = fs.createWriteStream(dest);
        proto.get(url, (res) => {
            if (res.statusCode === 301 || res.statusCode === 302) return downloadFile(res.headers.location, dest).then(resolve).catch(reject);
            let downloaded = 0;
            res.on('data', c => { downloaded += c.length; });
            res.pipe(file);
            file.on('finish', () => { file.close(); resolve(downloaded); });
        }).on('error', reject);
    });
}

const browser = await puppeteer.default.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: false, userDataDir: USER_DATA_DIR,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1800,1024'],
    defaultViewport: { width: 1800, height: 1024 }
});
const page = await browser.newPage();

await page.goto(BASE_URL + '/auth/sign-in', { waitUntil: 'load', timeout: 30000 });
if (page.url().includes('sign-in')) {
    await page.waitForSelector('input[type="email"]', { visible: true, timeout: 10000 });
    await page.type('input[type="email"]', env.SIMPLEAUDIENCE_EMAIL, { delay: 50 });
    await page.type('input[type="password"]', env.SIMPLEAUDIENCE_PASSWORD, { delay: 50 });
    await page.click('button[type="submit"]');
    await delay(5000);
}
console.log('Logged in:', page.url());

await page.goto(BASE_URL + '/home/' + WORKSPACE_SLUG, { waitUntil: 'load', timeout: 30000 });
await delay(4000);

// Capture all network responses for GCS CSV URLs
const gcsUrls = new Map();
page.on('response', async resp => {
    try {
        const text = await resp.text();
        const csvMatches = [...text.matchAll(/"csv_url"\s*:\s*"([^"]+)"/g)];
        for (const m of csvMatches) gcsUrls.set(m[1], true);
    } catch {}
});

// Find all download buttons and audience names
const audiences = await page.evaluate(() => {
    const rows = document.querySelectorAll('tr');
    const results = [];
    for (const row of rows) {
        const cells = row.querySelectorAll('td');
        if (cells.length === 0) continue;
        const name = cells[0]?.textContent?.trim() || '';
        if (!name.includes('Anthony Will')) continue;
        // Find the download button (lucide-download icon)
        const downloadBtn = row.querySelector('button svg.lucide-download')?.closest('button') ||
                           row.querySelector('[class*="download"]');
        results.push({ name, hasBtn: !!downloadBtn });
    }
    return results;
});

console.log('Audiences found in table:', audiences.length);
audiences.forEach(a => console.log(' ', a.name, a.hasBtn ? '(has download btn)' : '(no btn)'));

// For each audience, click its download button and capture the URL
for (let i = 0; i < audiences.length; i++) {
    const aud = audiences[i];
    console.log(`\nDownloading [${i+1}/${audiences.length}]: ${aud.name}`);
    
    // Click the download icon for this row
    const clicked = await page.evaluate((idx) => {
        const rows = document.querySelectorAll('tr');
        let audIdx = 0;
        for (const row of rows) {
            const name = row.querySelector('td')?.textContent?.trim() || '';
            if (!name.includes('Anthony Will')) continue;
            if (audIdx === idx) {
                const btn = row.querySelector('button svg.lucide-download')?.closest('button');
                if (btn) { btn.click(); return true; }
                return false;
            }
            audIdx++;
        }
        return false;
    }, i);

    if (!clicked) {
        console.log('  Could not find download button, skipping');
        continue;
    }

    await delay(2000);

    // Click the "Download" button in the dialog
    const downloaded = await page.evaluate(() => {
        const buttons = document.querySelectorAll('button');
        for (const btn of buttons) {
            if (btn.textContent.trim() === 'Download') {
                btn.click();
                return true;
            }
        }
        return false;
    });

    if (downloaded) {
        await delay(3000);
        // Close the dialog
        await page.evaluate(() => {
            const buttons = document.querySelectorAll('button');
            for (const btn of buttons) {
                if (btn.textContent.trim() === 'Close') { btn.click(); break; }
            }
        });
        await delay(1000);
    }
}

// Now check all captured GCS URLs
console.log('\nCaptured GCS URLs:', gcsUrls.size);

// Download each unique CSV URL
let idx = 0;
for (const url of gcsUrls.keys()) {
    // Extract audience info from the URL path
    const slug = `audience-${idx}`;
    const csvPath = path.join(OUTDIR, `${slug}.csv`);
    console.log(`Downloading: ${url.slice(0, 100)}...`);
    const bytes = await downloadFile(url, csvPath);
    console.log(`  → ${csvPath} (${(bytes/1024/1024).toFixed(1)}MB)`);
    idx++;
}

await browser.close();
console.log('\nDone. Files in', OUTDIR);
