/**
 * download-audiences.mjs — Download CSVs for existing audiences by name prefix.
 * Navigates to IntentCore, finds audiences matching a prefix, downloads each via LIST_EXPORTS.
 *
 * Usage:
 *   node tools/download-audiences.mjs --prefix "Anthony Will" --outdir /tmp/explorer-build/
 */

import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import https from 'https';
import http from 'http';
import { ACCOUNT_ID, WORKSPACE_SLUG } from './lib/payload-template.mjs';

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
    LIST_EXPORTS: '7f7a0fa032eb7f78c1f6cbd4061c6bc26badc9b2f0',
    SEARCH: '7f98be21c683ee295940810938e7ff6b25159afb9d',
};

const args = process.argv.slice(2);
function getArg(flag) { const i = args.indexOf(flag); return i !== -1 ? args[i + 1] : null; }

const PREFIX = getArg('--prefix');
const OUTDIR = getArg('--outdir') || path.join(ROOT, 'tools', 'exports');

if (!PREFIX) { console.error('Usage: node tools/download-audiences.mjs --prefix "Anthony Will" --outdir /tmp/dir/'); process.exit(1); }
if (!fs.existsSync(OUTDIR)) fs.mkdirSync(OUTDIR, { recursive: true });

async function fire(page, pathname, actionId, payload, rst, depId) {
    return page.evaluate(async (pn, aid, pl, r, d) => {
        try {
            const res = await fetch(pn, { method: 'POST', headers: {
                'accept': 'text/x-component', 'content-type': 'text/plain;charset=UTF-8',
                'next-action': aid, 'next-router-state-tree': r, 'x-deployment-id': d
            }, body: JSON.stringify(pl) });
            return { status: res.status, ok: res.ok, text: await res.text() };
        } catch (e) { return { error: e.message }; }
    }, pathname, actionId, payload, rst, depId);
}

function downloadFile(url, dest) {
    return new Promise((resolve, reject) => {
        const proto = url.startsWith('https') ? https : http;
        const file = fs.createWriteStream(dest);
        proto.get(url, (res) => {
            if (res.statusCode === 301 || res.statusCode === 302) {
                return downloadFile(res.headers.location, dest).then(resolve).catch(reject);
            }
            let downloaded = 0;
            res.on('data', (chunk) => { downloaded += chunk.length; });
            res.pipe(file);
            file.on('finish', () => { file.close(); resolve(downloaded); });
        }).on('error', reject);
    });
}

async function main() {
    log('init', `Downloading audiences matching "${PREFIX}" to ${OUTDIR}`);

    const lockFile = path.join(USER_DATA_DIR, 'SingletonLock');
    if (fs.existsSync(lockFile)) fs.unlinkSync(lockFile);

    const browser = await puppeteer.default.launch({
        executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        headless: false, userDataDir: USER_DATA_DIR,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1400,1024'],
        defaultViewport: null
    });
    const page = await browser.newPage();

    // Login
    log('login', 'Signing in...');
    await page.goto(`${BASE_URL}/auth/sign-in`, { waitUntil: 'load', timeout: 30000 });
    if (page.url().includes('sign-in')) {
        await page.waitForSelector('input[type="email"]', { visible: true, timeout: 10000 });
        await page.type('input[type="email"]', EMAIL, { delay: 50 });
        await page.waitForSelector('input[type="password"]', { visible: true, timeout: 5000 });
        await page.type('input[type="password"]', PASSWORD, { delay: 50 });
        await page.click('button[type="submit"]');
        await delay(5000);
    }
    log('login', `At: ${page.url()}`);

    // Workspace
    await page.goto(`${BASE_URL}/home/${WORKSPACE_SLUG}`, { waitUntil: 'load', timeout: 30000 });
    await delay(3000);

    const depId = await page.evaluate(() => {
        const m = document.documentElement.outerHTML.match(/dpl_[A-Za-z0-9]+/);
        return m ? m[0] : null;
    });
    log('deploy', `Deployment: ${depId}`);

    const listRST = encodeURIComponent(JSON.stringify(
        ["", { "children": ["home", { "children": [["account", WORKSPACE_SLUG, "d"], { "children": ["__PAGE__", {}, null, null] }, null, null] }, null, null] }, null, null, true]
    ));

    // Search for audiences
    const searchResult = await fire(page, `/home/${WORKSPACE_SLUG}`, ACTIONS.SEARCH,
        [{ accountId: ACCOUNT_ID, search: PREFIX, page: 1, pageSize: 50 }], listRST, depId);

    // Parse audience IDs and names
    const audienceMatches = [];
    const seen = new Set();
    const patterns = [
        /"id"\s*:\s*"([0-9a-f-]{36})"[^}]*?"name"\s*:\s*"([^"]+)"/g,
        /"name"\s*:\s*"([^"]+)"[^}]*?"id"\s*:\s*"([0-9a-f-]{36})"/g,
    ];
    const text = searchResult.text || '';
    for (const pat of patterns) {
        let match;
        while ((match = pat.exec(text)) !== null) {
            const id = match[1].length === 36 ? match[1] : match[2];
            const name = match[1].length === 36 ? match[2] : match[1];
            if (name.toLowerCase().includes(PREFIX.toLowerCase()) && !seen.has(id)) {
                seen.add(id);
                audienceMatches.push({ id, name });
            }
        }
    }

    log('search', `Found ${audienceMatches.length} audiences:`);
    for (const a of audienceMatches) log('search', `  ${a.name} (${a.id})`);

    if (audienceMatches.length === 0) {
        log('error', 'No audiences found. Closing.');
        await browser.close(); return;
    }

    // Download each
    for (const aud of audienceMatches) {
        log('download', `Processing: ${aud.name}`);

        const slug = aud.name
            .replace(new RegExp(PREFIX.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'), '')
            .replace(/^\s*-\s*/, '').replace(/\s*-\s*SC$/, '').replace(/\s*v\d+\s*$/i, '')
            .trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
        const csvPath = path.join(OUTDIR, `${slug}.csv`);

        const exportResult = await fire(page, `/home/${WORKSPACE_SLUG}`, ACTIONS.LIST_EXPORTS,
            [{ audienceId: aud.id, page: 1, pageSize: 10 }], listRST, depId);

        if (!exportResult.ok) {
            log('download', `  LIST_EXPORTS failed: ${exportResult.status}`);
            continue;
        }

        const csvMatch = exportResult.text?.match(/"csv_url"\s*:\s*"([^"]+)"/);
        if (!csvMatch) {
            log('download', `  No CSV found — audience may not be generated yet`);
            continue;
        }

        const csvUrl = csvMatch[1];
        const recordMatch = exportResult.text?.match(/"current"\s*:\s*(\d+)/);
        const records = recordMatch ? recordMatch[1] : '?';

        log('download', `  ${records} records → ${csvPath}`);
        const bytes = await downloadFile(csvUrl, csvPath);
        log('download', `  Done: ${(bytes / 1024 / 1024).toFixed(1)}MB`);
    }

    log('done', '═══════════════════════════════════════════');
    log('done', `Downloaded ${audienceMatches.length} audiences to ${OUTDIR}`);
    log('done', '═══════════════════════════════════════════');

    await browser.close();
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
