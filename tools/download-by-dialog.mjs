import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import fs from 'fs';
import path from 'path';
import https from 'https';
import http from 'http';
import { WORKSPACE_SLUG } from './lib/payload-template.mjs';

const ROOT = path.resolve('.');
const envContent = fs.readFileSync(path.join(ROOT, 'backend', '.env'), 'utf8');
const env = {};
for (const line of envContent.split('\n')) { const m = line.match(/^([^#=]+)=(.*)$/); if (m) env[m[1].trim()] = m[2].trim(); }

puppeteer.default.use(StealthPlugin());
const delay = ms => new Promise(r => setTimeout(r, ms));
const USER_DATA_DIR = path.join(ROOT, 'tools', '.chrome-inject-profile');
const lf = path.join(USER_DATA_DIR, 'SingletonLock');
if (fs.existsSync(lf)) fs.unlinkSync(lf);
const OUTDIR = '/tmp/explorer-build-anthony-will-1776102439000';

function downloadFile(url, dest) {
    return new Promise((resolve, reject) => {
        const proto = url.startsWith('https') ? https : http;
        const file = fs.createWriteStream(dest);
        proto.get(url, (res) => {
            if (res.statusCode >= 300 && res.statusCode < 400) return downloadFile(res.headers.location, dest).then(resolve).catch(reject);
            let dl = 0; res.on('data', c => { dl += c.length; }); res.pipe(file);
            file.on('finish', () => { file.close(); resolve(dl); });
        }).on('error', reject);
    });
}

const browser = await puppeteer.default.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: false, userDataDir: USER_DATA_DIR,
    args: ['--no-sandbox', '--window-size=1800,1024'], defaultViewport: {width:1800,height:1024}
});
const page = await browser.newPage();

await page.goto('https://app.intentcore.io/auth/sign-in', {waitUntil:'load',timeout:30000});
if (page.url().includes('sign-in')) {
    await page.waitForSelector('input[type="email"]',{visible:true,timeout:10000});
    await page.type('input[type="email"]', env.SIMPLEAUDIENCE_EMAIL, {delay:50});
    await page.type('input[type="password"]', env.SIMPLEAUDIENCE_PASSWORD, {delay:50});
    await page.click('button[type="submit"]'); await delay(5000);
}
console.log('Logged in:', page.url());
await page.goto('https://app.intentcore.io/home/' + WORKSPACE_SLUG, {waitUntil:'load',timeout:30000});
await delay(4000);

// Count Anthony Will rows
const rowCount = await page.evaluate(() => {
    return [...document.querySelectorAll('tr')].filter(r => r.textContent.includes('Anthony Will')).length;
});
console.log('Anthony Will rows:', rowCount);

for (let i = 0; i < rowCount; i++) {
    // Capture GCS URL from network for this specific download
    let capturedUrl = null;
    const responseHandler = async (resp) => {
        try {
            const t = await resp.text();
            const m = t.match(/"csv_url"\s*:\s*"([^"]+)"/);
            if (m) capturedUrl = m[1];
        } catch {}
    };
    page.on('response', responseHandler);

    // Click download icon on row i
    const audName = await page.evaluate((idx) => {
        const rows = [...document.querySelectorAll('tr')].filter(r => r.textContent.includes('Anthony Will'));
        if (!rows[idx]) return null;
        const btn = rows[idx].querySelector('button svg.lucide-download')?.closest('button');
        if (btn) btn.click();
        return rows[idx].querySelector('td')?.textContent?.trim() || 'unknown';
    }, i);

    if (!audName) { console.log(`Row ${i}: not found`); continue; }
    console.log(`\n[${i+1}/${rowCount}] ${audName}`);
    await delay(2000);

    // Click "Download" in dialog
    await page.evaluate(() => {
        const btns = document.querySelectorAll('button');
        for (const b of btns) { if (b.textContent.trim() === 'Download') { b.click(); break; } }
    });
    await delay(3000);

    // Get the captured URL
    page.off('response', responseHandler);

    if (capturedUrl) {
        // Derive filename from audience name
        const slug = audName.replace(/Anthony Will\s*-\s*/i, '').replace(/\s*-\s*SC\s*$/i, '').replace(/\s*-\s*$/,'')
            .trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
        const csvPath = path.join(OUTDIR, slug + '.csv');
        console.log(`  Downloading → ${slug}.csv`);
        const bytes = await downloadFile(capturedUrl, csvPath);
        console.log(`  Done: ${(bytes/1024/1024).toFixed(1)}MB`);
    } else {
        console.log('  No CSV URL captured');
    }

    // Close dialog
    await page.evaluate(() => {
        const btns = document.querySelectorAll('button');
        for (const b of btns) { if (b.textContent.trim() === 'Close') { b.click(); break; } }
    });
    await delay(1500);
}

await browser.close();
console.log('\nDone. Files:');
for (const f of fs.readdirSync(OUTDIR).filter(f => f.endsWith('.csv') && !f.startsWith('audience-'))) {
    const size = fs.statSync(path.join(OUTDIR, f)).size;
    console.log(`  ${f} (${(size/1024/1024).toFixed(1)}MB)`);
}
