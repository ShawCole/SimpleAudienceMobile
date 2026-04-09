/**
 * Test injection — create via UI, then test preview + generate action IDs.
 */
import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { blankFilters, buildRST, ACCOUNT_ID, WORKSPACE_SLUG } from './lib/payload-template.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const envContent = fs.readFileSync(path.join(ROOT, 'backend', '.env'), 'utf8');
const env = {};
for (const line of envContent.split('\n')) { const m = line.match(/^([^#=]+)=(.*)$/); if (m) env[m[1].trim()] = m[2].trim(); }

puppeteer.default.use(StealthPlugin());
const delay = ms => new Promise(r => setTimeout(r, ms));
const log = (s, m) => console.log(`[${new Date().toISOString()}] [${s}] ${m}`);

const BASE_URL = env.SIMPLEAUDIENCE_BASE_URL || 'https://app.intentcore.io';
const EMAIL = env.SIMPLEAUDIENCE_EMAIL;
const PASSWORD = env.SIMPLEAUDIENCE_PASSWORD;
const USER_DATA_DIR = path.join(ROOT, 'tools', '.chrome-inject-profile');

const ACTIONS = {
    PREVIEW: '7f826a89d9a7db05f2db566ebbeed3814a95cea2ed',
    GENERATE: '7ff841dddcb1a6bcd7f5df96627b162edeb94b5406',
};

async function fire(page, pathname, actionId, payload, rst, depId) {
    return page.evaluate(async (pn, aid, pl, r, d) => {
        try {
            const res = await fetch(pn, { method: 'POST', headers: { 'accept': 'text/x-component', 'content-type': 'text/plain;charset=UTF-8', 'next-action': aid, 'next-router-state-tree': r, 'x-deployment-id': d }, body: JSON.stringify(pl) });
            return { status: res.status, ok: res.ok, text: (await res.text()).substring(0, 1000) };
        } catch (e) { return { error: e.message }; }
    }, pathname, actionId, payload, rst, depId);
}

async function main() {
    log('init', '═══ TEST — VERIFY ACTION IDS ═══');
    const lf = path.join(USER_DATA_DIR, 'SingletonLock'); if (fs.existsSync(lf)) fs.unlinkSync(lf);
    const browser = await puppeteer.default.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: false, userDataDir: USER_DATA_DIR, args: ['--no-sandbox','--disable-setuid-sandbox','--window-size=1400,1024'], defaultViewport: null });
    const page = await browser.newPage();

    log('login', 'Signing in...'); await page.goto(`${BASE_URL}/auth/sign-in`, { waitUntil: 'load', timeout: 30000 });
    if (page.url().includes('sign-in')) { await page.waitForSelector('input[type="email"]', {visible:true,timeout:10000}); await page.type('input[type="email"]', EMAIL, {delay:50}); await page.waitForSelector('input[type="password"]', {visible:true,timeout:5000}); await page.type('input[type="password"]', PASSWORD, {delay:50}); await page.click('button[type="submit"]'); await delay(5000); }
    log('login', `At: ${page.url()}`);

    log('ws', 'Workspace...'); await page.goto(`${BASE_URL}/home/${WORKSPACE_SLUG}`, {waitUntil:'load',timeout:30000}); await delay(2000);
    log('ws', `At: ${page.url()}`);

    log('create', 'Audience list...'); await page.goto(`${BASE_URL}/home/${WORKSPACE_SLUG}/audience`, {waitUntil:'load',timeout:30000}); await delay(3000);
    log('create', 'Click Create...'); await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find(b => b.textContent?.trim()==='Create'); if(b) b.click(); }); await delay(2000);
    const inp = await page.waitForSelector('div[role="dialog"] input', {visible:true,timeout:10000}); await inp.click({clickCount:3}); await inp.type('test - okay to delete', {delay:30});
    log('create', 'Submit...'); await page.evaluate(() => { const d=document.querySelector('div[role="dialog"]'); if(!d)return; const b=[...d.querySelectorAll('button')].find(b=>b.textContent?.trim()==='Create'||b.type==='submit'); if(b) b.click(); });

    let audienceId = null;
    for (let i=0;i<30;i++) { await delay(500); const m=page.url().match(/\/audience\/([0-9a-f-]{36})/); if(m){audienceId=m[1];break;} }
    if (!audienceId) { log('create','FATAL: no ID'); await delay(300000); await browser.close(); return; }
    log('create', `ID: ${audienceId}`); await delay(3000);

    const depId = await page.evaluate(() => { const m = document.documentElement.outerHTML.match(/dpl_[A-Za-z0-9]+/); return m?m[0]:null; });
    log('deploy', `Deployment: ${depId}`);

    const pn = `/home/${WORKSPACE_SLUG}/audience/${audienceId}`;
    const rst = encodeURIComponent(buildRST(audienceId));

    log('preview', `FIRE — ${ACTIONS.PREVIEW}`);
    const pr = await fire(page, pn, ACTIONS.PREVIEW, [{ accountId: ACCOUNT_ID, id: audienceId, filters: { audience: { type:"premade", b2b:null, customTopic:"", customDescription:"", segmentSearches:["Sustainability & Green Living > Recycling & Waste Management > E-waste Management"] }, jobId:"", segment:[], daysBack:7, score:[], filters: blankFilters() } }], rst, depId);
    log('preview', `${pr.status} OK:${pr.ok}`); log('preview', pr.text);
    if (!pr.ok) { log('preview','FAILED'); await delay(300000); await browser.close(); return; }
    log('preview', `Count: ${pr.text?.match(/"count"\s*:\s*(\d+)/)?.[1]||'?'}`);

    log('generate', `FIRE — ${ACTIONS.GENERATE}`);
    const gr = await fire(page, pn, ACTIONS.GENERATE, [{ accountId: ACCOUNT_ID, audienceId, filters: { audience: { type:"premade", b2b:null, customTopic:"", customDescription:"", segmentSearches:["Sustainability & Green Living > Recycling & Waste Management > E-waste Management"] }, jobId:"", segment:[], score:[], daysBack:7, filters: blankFilters() }, hasSegmentChanged:false, resolveIntents:true }], rst, depId);
    log('generate', `${gr.status} OK:${gr.ok}`); log('generate', gr.text);

    if (gr.ok) { log('done','═══ ALL ACTION IDS VERIFIED ═══'); log('done',`Preview: ${ACTIONS.PREVIEW} ✓`); log('done',`Generate: ${ACTIONS.GENERATE} ✓`); log('done',`Deployment changed: ${depId} (was dpl_E1CZwNZsRi1KAkFtbwHL7mMCJBLW)`); }
    else { log('done','GENERATE FAILED'); }

    log('sleep','2 min...'); await delay(120000); await browser.close();
}
main().catch(e => { console.error(e); process.exit(1); });
