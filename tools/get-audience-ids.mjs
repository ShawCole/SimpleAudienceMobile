import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import fs from 'fs';
import path from 'path';

const ROOT = process.cwd();
const envContent = fs.readFileSync(path.join(ROOT, 'backend', '.env'), 'utf8');
const env = {};
for (const line of envContent.split('\n')) { const m = line.match(/^([^#=]+)=(.*)$/); if (m) env[m[1].trim()] = m[2].trim(); }

puppeteer.default.use(StealthPlugin());
const delay = ms => new Promise(r => setTimeout(r, ms));
const USER_DATA_DIR = path.join(ROOT, 'tools', '.chrome-inject-profile');
const lf = path.join(USER_DATA_DIR, 'SingletonLock');
if (fs.existsSync(lf)) fs.unlinkSync(lf);

const browser = await puppeteer.default.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: false, userDataDir: USER_DATA_DIR,
    args: ['--no-sandbox', '--window-size=1800,1024'], defaultViewport: {width:1800,height:1024}
});
const page = await browser.newPage();

// Intercept all responses and look for audience data
const allResponses = [];
page.on('response', async resp => {
    try {
        if (resp.url().includes('intentcore.io')) {
            const text = await resp.text();
            if (text.includes('Anthony Will')) {
                // Extract name+id pairs
                const chunks = text.split('\n');
                for (const chunk of chunks) {
                    if (chunk.includes('Anthony Will')) {
                        allResponses.push(chunk.slice(0, 500));
                    }
                }
            }
        }
    } catch {}
});

await page.goto('https://app.intentcore.io/auth/sign-in', {waitUntil:'load',timeout:30000});
if (page.url().includes('sign-in')) {
    await page.waitForSelector('input[type="email"]',{visible:true,timeout:10000});
    await page.type('input[type="email"]', env.SIMPLEAUDIENCE_EMAIL, {delay:50});
    await page.type('input[type="password"]', env.SIMPLEAUDIENCE_PASSWORD, {delay:50});
    await page.click('button[type="submit"]');
    await delay(5000);
}
await page.goto('https://app.intentcore.io/home/simple-audience', {waitUntil:'load',timeout:30000});
await delay(5000);

console.log('Captured', allResponses.length, 'chunks with Anthony Will');
for (const r of allResponses) console.log(r, '\n---');

await browser.close();
