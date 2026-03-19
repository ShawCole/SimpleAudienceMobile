/**
 * Export Audience to ListMagic Receiver
 *
 * Full pipeline: navigate to studio → save segment → export CSV → download → batch POST to receiver
 *
 * Usage:
 *   node tools/export-to-receiver.mjs --audience <uuid> --topic wealth-management-services --intent high
 *   node tools/export-to-receiver.mjs --audience <uuid> --topic wealth-management-services --intent medium --segment-name "Wealth Management - Medium"
 */

import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { parse } from 'url';

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
const USER_DATA_DIR = path.join(ROOT, 'tools', '.chrome-export-profile');
const CAPTURES_DIR = path.join(ROOT, 'tools', 'captures');
if (!fs.existsSync(CAPTURES_DIR)) fs.mkdirSync(CAPTURES_DIR, { recursive: true });

const WORKSPACE_SLUG = 'simple-audience';
const ACCOUNT_ID = 'fceffb3b-552d-413a-9442-e62e9d423aa0';

const RECEIVER_URL = 'https://listmagic-receiver-1062039415876.us-east1.run.app';
const RECEIVER_API_KEY = '7c6374263cc1f2561b2a9519e9f9cb4c45c32db5f3d5caae9eb8b0724d1bc034';

// Action IDs — re-capture from DevTools on 404
const ACTIONS = {
    SAVE_SEGMENT: '7f69e0fb84999ede7adb06dab9a09fe86476d84abe',
    EXPORT_CSV: '7f363cd62fa8f404dea17c964a943548c33f48d96f',
};

// All 74 fields to export
const SELECTED_FIELDS = [
    "AGE_RANGE", "BUSINESS_EMAIL", "CHILDREN", "COMPANY_ADDRESS", "COMPANY_CITY",
    "COMPANY_DESCRIPTION", "COMPANY_DOMAIN", "COMPANY_EMPLOYEE_COUNT", "COMPANY_INDUSTRY",
    "COMPANY_NAICS", "COMPANY_NAME", "COMPANY_NAME_HISTORY", "COMPANY_PHONE",
    "COMPANY_REVENUE", "COMPANY_SIC", "COMPANY_STATE", "COMPANY_ZIP", "COMPANY_LINKEDIN_URL",
    "PERSONAL_VERIFIED_EMAILS", "BUSINESS_VERIFIED_EMAILS", "DEPARTMENT", "DIRECT_NUMBER",
    "DIRECT_NUMBER_DNC", "EDUCATION_HISTORY", "FACEBOOK_URL", "TWITTER_URL", "FIRST_NAME",
    "GENDER", "HEADLINE", "HOMEOWNER", "INCOME_RANGE", "INFERRED_YEARS_EXPERIENCE",
    "INTERESTS", "JOB_TITLE", "JOB_TITLE_HISTORY", "LAST_NAME", "LINKEDIN_URL", "MARRIED",
    "MOBILE_PHONE", "MOBILE_PHONE_DNC", "NET_WORTH", "PERSONAL_ADDRESS", "PERSONAL_CITY",
    "PERSONAL_EMAILS", "PERSONAL_PHONE", "PERSONAL_PHONE_DNC", "PERSONAL_STATE",
    "PERSONAL_ZIP", "PERSONAL_ZIP4", "SENIORITY_LEVEL", "SHA256_BUSINESS_EMAIL",
    "SHA256_PERSONAL_EMAIL", "SKILLS", "SKIPTRACE_ADDRESS", "SKIPTRACE_B2B_ADDRESS",
    "SKIPTRACE_B2B_PHONE", "SKIPTRACE_B2B_SOURCE", "SKIPTRACE_B2B_WEBSITE", "SKIPTRACE_CITY",
    "SKIPTRACE_CREDIT_RATING", "SKIPTRACE_DNC", "SKIPTRACE_ETHNIC_CODE", "SKIPTRACE_EXACT_AGE",
    "SKIPTRACE_IP", "SKIPTRACE_LANDLINE_NUMBERS", "SKIPTRACE_LANGUAGE_CODE",
    "SKIPTRACE_MATCH_SCORE", "SKIPTRACE_NAME", "SKIPTRACE_STATE", "SKIPTRACE_WIRELESS_NUMBERS",
    "SKIPTRACE_ZIP", "SOCIAL_CONNECTIONS", "UUID", "VALID_PHONES"
];

// Parse CLI
const args = process.argv.slice(2);
function getArg(flag) {
    const idx = args.indexOf(flag);
    return idx !== -1 ? args[idx + 1] : null;
}

const ARG_AUDIENCE = getArg('--audience');
const ARG_TOPIC = getArg('--topic') || 'unknown';
const ARG_INTENT = getArg('--intent') || 'high';
const ARG_SEGMENT_NAME = getArg('--segment-name');
const ARG_BATCH_SIZE = parseInt(getArg('--batch-size') || '5000');

if (!ARG_AUDIENCE) {
    console.error('Usage: node tools/export-to-receiver.mjs --audience <uuid> --topic <slug> --intent <high|medium|low>');
    process.exit(1);
}

// ── Server Action helper (same pattern as inject-audience.mjs) ──
async function serverAction(page, pathname, actionId, payload, deploymentId) {
    return page.evaluate(async (pn, aid, pl, depId) => {
        try {
            const res = await fetch(pn, {
                method: 'POST',
                headers: {
                    'accept': 'text/x-component',
                    'content-type': 'text/plain;charset=UTF-8',
                    'next-action': aid,
                    'x-deployment-id': depId,
                },
                body: JSON.stringify(pl)
            });
            const text = await res.text();
            return { status: res.status, ok: res.ok, text };
        } catch (e) {
            return { error: e.message };
        }
    }, pathname, actionId, payload, deploymentId);
}

// ── Detect deployment ID ──
async function getDeploymentId(page) {
    const fromSource = await page.evaluate(() => {
        const html = document.documentElement.outerHTML;
        const m = html.match(/dpl_[A-Za-z0-9]+/);
        return m ? m[0] : null;
    });
    if (fromSource) return fromSource;

    const fromHeaders = await page.evaluate(async () => {
        try {
            const res = await fetch(window.location.href, { method: 'HEAD' });
            return res.headers.get('x-deployment-id');
        } catch { return null; }
    });
    return fromHeaders;
}

// ── Parse CSV to array of objects (handles newlines inside quoted fields) ──
function parseCSV(csvText) {
    const records = [];
    let pos = 0;
    const len = csvText.length;

    // Parse one record (may span multiple lines due to quoted newlines)
    function parseRecord() {
        const fields = [];
        let current = '';
        let inQuotes = false;

        while (pos < len) {
            const ch = csvText[pos];

            if (ch === '"') {
                if (inQuotes && pos + 1 < len && csvText[pos + 1] === '"') {
                    current += '"';
                    pos += 2;
                } else {
                    inQuotes = !inQuotes;
                    pos++;
                }
            } else if (ch === ',' && !inQuotes) {
                fields.push(current);
                current = '';
                pos++;
            } else if ((ch === '\n' || ch === '\r') && !inQuotes) {
                fields.push(current);
                // Skip \r\n
                if (ch === '\r' && pos + 1 < len && csvText[pos + 1] === '\n') pos++;
                pos++;
                return fields;
            } else {
                current += ch;
                pos++;
            }
        }

        // End of file
        if (current || fields.length > 0) {
            fields.push(current);
        }
        return fields.length > 0 ? fields : null;
    }

    // Parse header
    const headers = parseRecord();
    if (!headers) return [];

    // Parse rows
    while (pos < len) {
        // Skip blank lines
        if (csvText[pos] === '\n' || csvText[pos] === '\r') {
            pos++;
            continue;
        }

        const values = parseRecord();
        if (!values || values.length === 0) continue;

        // Only accept rows with correct column count
        if (values.length !== headers.length) continue;

        const record = {};
        for (let j = 0; j < headers.length; j++) {
            record[headers[j]] = values[j] || '';
        }
        records.push(record);
    }

    return records;
}

// ── Parse CSV file and batch POST to receiver ──
// Uses parseCSV() (line 129) which correctly handles quoted newlines.
// The old readline-based streamIngest() broke on \n inside quoted fields
// (COMPANY_DESCRIPTION, EDUCATION_HISTORY), corrupting 46% of rows.

async function ingestCSV(csvFile, topic, intent, batchSize) {
    const url = `${RECEIVER_URL}/ingest/batch/${topic}/${intent}`;
    console.log(`[ingest] Reading CSV with quote-aware parser...`);
    const csvText = fs.readFileSync(csvFile, 'utf8');
    const records = parseCSV(csvText);
    console.log(`[ingest] Parsed ${records.length} records from CSV`);

    let inserted = 0;
    let skipped = 0;
    let batchNum = 0;

    for (let i = 0; i < records.length; i += batchSize) {
        const batch = records.slice(i, i + batchSize);
        batchNum++;
        const result = await postBatch(url, batch, batchNum);
        inserted += result.inserted;
        skipped += result.skipped;
    }

    return { inserted, skipped, total: records.length };
}

async function postBatch(url, batch, batchNum) {
    const ts = new Date().toISOString().slice(11, 23);
    process.stdout.write(`[${ts}] Batch ${batchNum} (${batch.length} records)... `);
    const t0 = performance.now();
    try {
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-api-key': RECEIVER_API_KEY },
            body: JSON.stringify(batch),
        });
        const data = await res.json();
        const ms = Math.round(performance.now() - t0);
        if (data.success) {
            console.log(`✓ inserted=${data.inserted} skipped=${data.skipped || 0} (${ms}ms)`);
            return { inserted: data.inserted, skipped: data.skipped || 0 };
        } else {
            console.log(`✗ ${data.error} (${ms}ms)`);
            return { inserted: 0, skipped: batch.length };
        }
    } catch (err) {
        const ms = Math.round(performance.now() - t0);
        console.log(`✗ ${err.message} (${ms}ms)`);
        return { inserted: 0, skipped: batch.length };
    }
}

// ── MAIN ──
async function main() {
    console.log('═'.repeat(60));
    console.log('  EXPORT TO RECEIVER');
    console.log(`  Audience: ${ARG_AUDIENCE}`);
    console.log(`  Topic:    ${ARG_TOPIC}`);
    console.log(`  Intent:   ${ARG_INTENT}`);
    console.log(`  Segment:  ${ARG_SEGMENT_NAME || '(skip save, export only)'}`);
    console.log('═'.repeat(60) + '\n');

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

    // ── LOGIN ──
    console.log('[login] Navigating to sign-in...');
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
        console.log('[login] Logged in.');
    } else {
        console.log('[login] Already authenticated.');
    }

    // Select workspace if on selector page
    if (page.url() === `${BASE_URL}/home` || page.url() === `${BASE_URL}/home/`) {
        await page.evaluate((slug) => {
            const links = Array.from(document.querySelectorAll('a'));
            const target = links.find(a => a.href.includes(`/home/${slug}`));
            if (target) target.click();
        }, WORKSPACE_SLUG);
        await page.waitForNavigation({ waitUntil: 'load', timeout: 15000 }).catch(() => {});
        await page.waitForTimeout(1000);
    }
    console.log(`[login] URL: ${page.url()}\n`);

    // ── NAVIGATE TO STUDIO ──
    const studioUrl = `${BASE_URL}/home/${WORKSPACE_SLUG}/studio?audience=${ARG_AUDIENCE}`;
    console.log(`[nav] Loading studio: ${studioUrl}`);
    await page.goto(studioUrl, { waitUntil: 'networkidle2', timeout: 60000 });
    await page.waitForTimeout(2000);
    console.log(`[nav] URL: ${page.url()}`);

    // Wait for data to finish loading — "Loading Data" must disappear and "Total Rows:" must be > 0
    console.log('[nav] Waiting for data to load...');
    const DATA_LOADING_XPATH = '/html/body/div[2]/div/div[2]/div[2]/div[2]/div[6]/div[2]/div';
    const TOTAL_ROWS_XPATH = '/html/body/div[2]/div/div[2]/div[2]/div[2]/div[7]/div[2]/div[1]/div/div[2]';
    const SEGMENT_ROWS_XPATH = '/html/body/div[2]/div/div[2]/div[2]/div[2]/div[5]/div[2]/div[2]/div/div/div[2]';
    const MAX_WAIT = 300000; // 5 minutes
    const POLL_INTERVAL = 2000;
    const startWait = Date.now();

    while (Date.now() - startWait < MAX_WAIT) {
        const status = await page.evaluate((loadXp, rowsXp) => {
            const getByXPath = (xp) => {
                const result = document.evaluate(xp, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
                return result.singleNodeValue?.textContent?.trim() || '';
            };
            return {
                loadingText: getByXPath(loadXp),
                totalRowsText: getByXPath(rowsXp),
            };
        }, DATA_LOADING_XPATH, TOTAL_ROWS_XPATH);

        const isLoading = status.loadingText.toLowerCase().includes('loading');
        const rowsMatch = status.totalRowsText.match(/([\d,]+)/);
        const rowCount = rowsMatch ? parseInt(rowsMatch[1].replace(/,/g, '')) : 0;

        if (!isLoading && rowCount > 0) {
            console.log(`[nav] Data loaded. Total rows: ${rowCount.toLocaleString()}\n`);
            break;
        }

        const elapsed = ((Date.now() - startWait) / 1000).toFixed(0);
        process.stdout.write(`\r[nav] Still loading... (${elapsed}s) loading=${isLoading} rows=${rowCount}`);
        await page.waitForTimeout(POLL_INTERVAL);
    }

    if (Date.now() - startWait >= MAX_WAIT) {
        console.error('\n[nav] Timed out waiting for data to load. Aborting.');
        await browser.close();
        process.exit(1);
    }

    // ── DETECT DEPLOYMENT ID ──
    const deploymentId = await getDeploymentId(page);
    console.log(`[deploy] Deployment ID: ${deploymentId}\n`);

    if (!deploymentId) {
        console.error('[deploy] Could not detect deployment ID. Aborting.');
        await browser.close();
        process.exit(1);
    }

    const pathname = `/home/${WORKSPACE_SLUG}/studio?audience=${ARG_AUDIENCE}`;

    // ── SAVE SEGMENT (if --segment-name provided) ──
    if (ARG_SEGMENT_NAME) {
        console.log(`[save] Saving segment: "${ARG_SEGMENT_NAME}"`);

        // Get row count from Total Rows XPath, fallback to Recent Segments div
        const rowCount = await page.evaluate((rowsXp, segXp) => {
            const getByXPath = (xp) => {
                const result = document.evaluate(xp, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
                return result.singleNodeValue?.textContent?.trim() || '';
            };
            // Try Total Rows first
            const totalText = getByXPath(rowsXp);
            const m1 = totalText.match(/([\d,]+)/);
            if (m1 && parseInt(m1[1].replace(/,/g, '')) > 0) return parseInt(m1[1].replace(/,/g, ''));
            // Fallback: Recent Segments row count
            const segText = getByXPath(segXp);
            const m2 = segText.match(/([\d,]+)/);
            if (m2 && parseInt(m2[1].replace(/,/g, '')) > 0) return parseInt(m2[1].replace(/,/g, ''));
            return 0;
        }, TOTAL_ROWS_XPATH, SEGMENT_ROWS_XPATH);

        const savePayload = [{
            name: ARG_SEGMENT_NAME,
            description: "",
            filters: { id: "root", operator: "AND", rules: [] },
            selectedFields: SELECTED_FIELDS,
            onlyFirstValueFields: [],
            rowCount: rowCount || 0,
            audienceId: ARG_AUDIENCE,
            pixelId: "$undefined",
            accountId: ACCOUNT_ID,
        }];

        console.log(`[save] Row count: ${rowCount || 'unknown'}`);
        const saveResult = await serverAction(page, pathname, ACTIONS.SAVE_SEGMENT, savePayload, deploymentId);
        console.log(`[save] Status: ${saveResult.status} (ok: ${saveResult.ok})`);

        if (saveResult.ok) {
            console.log('[save] Segment saved.\n');
        } else {
            console.log(`[save] Response: ${saveResult.text?.substring(0, 300)}`);
            console.log('[save] Save failed — continuing to export anyway.\n');
        }

        // Wait for segment data to reload after save
        console.log('[save] Waiting for segment data to reload...');
        await page.waitForTimeout(3000);
        const saveStart = Date.now();
        while (Date.now() - saveStart < MAX_WAIT) {
            const status = await page.evaluate((loadXp, rowsXp) => {
                const getByXPath = (xp) => {
                    const result = document.evaluate(xp, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
                    return result.singleNodeValue?.textContent?.trim() || '';
                };
                return {
                    loadingText: getByXPath(loadXp),
                    totalRowsText: getByXPath(rowsXp),
                };
            }, DATA_LOADING_XPATH, TOTAL_ROWS_XPATH);

            const isLoading = status.loadingText.toLowerCase().includes('loading');
            const rowsMatch = status.totalRowsText.match(/([\d,]+)/);
            const rowCount = rowsMatch ? parseInt(rowsMatch[1].replace(/,/g, '')) : 0;

            if (!isLoading && rowCount > 0) {
                console.log(`[save] Data reloaded. Total rows: ${rowCount.toLocaleString()}\n`);
                break;
            }

            await page.waitForTimeout(POLL_INTERVAL);
        }
    }

    // ── EXPORT CSV (with retry — large audiences need server prep time) ──
    console.log('[export] Requesting CSV export...');
    const exportPayload = [{
        audienceId: ARG_AUDIENCE,
        accountId: ACCOUNT_ID,
        filters: { id: "root", operator: "AND", rules: [] },
        selectedFields: SELECTED_FIELDS,
        onlyFirstValueFields: [],
        format: "csv",
    }];

    const MAX_EXPORT_RETRIES = 6;
    const EXPORT_RETRY_DELAY = 15000; // 15s between retries
    let exportResult;

    for (let attempt = 1; attempt <= MAX_EXPORT_RETRIES; attempt++) {
        exportResult = await serverAction(page, pathname, ACTIONS.EXPORT_CSV, exportPayload, deploymentId);
        console.log(`[export] Attempt ${attempt}/${MAX_EXPORT_RETRIES} — Status: ${exportResult.status}`);

        if (exportResult.ok) break;

        if (exportResult.status === 404) {
            console.error('[export] Action ID stale — re-capture from DevTools.');
            await browser.close();
            process.exit(1);
        }

        if (attempt < MAX_EXPORT_RETRIES) {
            console.log(`[export] Server not ready — retrying in ${EXPORT_RETRY_DELAY / 1000}s...`);
            await page.waitForTimeout(EXPORT_RETRY_DELAY);
        }
    }

    if (!exportResult.ok) {
        console.error(`[export] Failed after ${MAX_EXPORT_RETRIES} attempts: ${exportResult.text?.substring(0, 300)}`);
        await browser.close();
        process.exit(1);
    }

    // Parse the GCS URL from response
    // Response format: 0:{"a":"$@1",...}\n1:{"fileUrl":"https://storage.googleapis.com/..."}
    const fileUrlMatch = exportResult.text?.match(/"fileUrl"\s*:\s*"([^"]+)"/);
    if (!fileUrlMatch) {
        console.error(`[export] Could not find fileUrl in response: ${exportResult.text?.substring(0, 300)}`);
        await browser.close();
        process.exit(1);
    }

    const csvUrl = fileUrlMatch[1];
    console.log(`[export] CSV URL: ${csvUrl}\n`);

    // ── DOWNLOAD CSV (stream to disk) ──
    console.log('[download] Downloading CSV...');
    const csvResponse = await fetch(csvUrl);
    if (!csvResponse.ok) {
        console.error(`[download] Failed: ${csvResponse.status} ${csvResponse.statusText}`);
        await browser.close();
        process.exit(1);
    }

    const csvFile = path.join(CAPTURES_DIR, `export-${ARG_AUDIENCE}-${Date.now()}.csv`);
    const fileStream = fs.createWriteStream(csvFile);
    let totalBytes = 0;

    for await (const chunk of csvResponse.body) {
        fileStream.write(chunk);
        totalBytes += chunk.length;
        if (totalBytes % (10 * 1024 * 1024) < chunk.length) {
            process.stdout.write(`\r[download] ${(totalBytes / 1024 / 1024).toFixed(1)} MB...`);
        }
    }
    fileStream.end();
    await new Promise(resolve => fileStream.on('finish', resolve));
    console.log(`\r[download] Downloaded ${(totalBytes / 1024 / 1024).toFixed(1)} MB → ${csvFile}`);

    // ── STREAM-PARSE CSV AND BATCH POST ──
    console.log(`[receiver] Streaming ingest → ${ARG_TOPIC}/${ARG_INTENT} (batch size: ${ARG_BATCH_SIZE})\n`);

    const { inserted, skipped, total } = await ingestCSV(csvFile, ARG_TOPIC, ARG_INTENT, ARG_BATCH_SIZE);

    console.log('');
    console.log('═'.repeat(60));
    console.log('  EXPORT COMPLETE');
    console.log(`  Records:  ${total}`);
    console.log(`  Inserted: ${inserted}`);
    console.log(`  Skipped:  ${skipped} (no UUID)`);
    console.log(`  Topic:    ${ARG_TOPIC}`);
    console.log(`  Intent:   ${ARG_INTENT}`);
    console.log(`  CSV:      ${csvFile}`);
    console.log('═'.repeat(60));

    // Save log
    const logFile = path.join(CAPTURES_DIR, `export-log-${ARG_AUDIENCE}-${Date.now()}.json`);
    fs.writeFileSync(logFile, JSON.stringify({
        audienceId: ARG_AUDIENCE,
        topic: ARG_TOPIC,
        intent: ARG_INTENT,
        segmentName: ARG_SEGMENT_NAME,
        records: total,
        inserted,
        skipped,
        csvUrl,
        csvFile,
        timestamp: new Date().toISOString(),
    }, null, 2));

    await browser.close();
    console.log('\n[done]');
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
