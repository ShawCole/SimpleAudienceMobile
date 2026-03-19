/**
 * Click Logger — logs the full XPath + element details of every click in the browser.
 * Injects a listener on every page/navigation. Logs to tools/captures/click-log.jsonl.
 *
 * Usage: node tools/click-logger.mjs [start-url]
 *   Default start URL: app.intentcore.io/home/bizypro/studio
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
const USER_DATA_DIR = path.join(ROOT, 'tools', '.chrome-click-logger-profile');
const CAPTURES_DIR = path.join(ROOT, 'tools', 'captures');

if (!fs.existsSync(CAPTURES_DIR)) fs.mkdirSync(CAPTURES_DIR, { recursive: true });

const LOG_FILE = path.join(CAPTURES_DIR, 'click-log.jsonl');
// Clear previous log
fs.writeFileSync(LOG_FILE, '');

const logStream = fs.createWriteStream(LOG_FILE, { flags: 'a' });
let clickCount = 0;

function logClick(data) {
    clickCount++;
    const entry = { n: clickCount, t: new Date().toISOString(), ...data };
    logStream.write(JSON.stringify(entry) + '\n');
    console.log(`\n🖱️  Click #${clickCount}`);
    console.log(`   XPath:   ${data.xpath}`);
    console.log(`   Tag:     <${data.tag}>`);
    if (data.text) console.log(`   Text:    "${data.text.substring(0, 60)}"`);
    if (data.href) console.log(`   Href:    ${data.href}`);
    if (data.name) console.log(`   Name:    ${data.name}`);
    if (data.type) console.log(`   Type:    ${data.type}`);
    if (data.role) console.log(`   Role:    ${data.role}`);
    if (data.classes) console.log(`   Classes: ${data.classes.substring(0, 80)}`);
    if (data.id) console.log(`   ID:      ${data.id}`);
    console.log(`   Page:    ${data.url}`);
}

// The script we inject into every page
const INJECTED_SCRIPT = `
(function() {
    if (window.__clickLoggerActive) return;
    window.__clickLoggerActive = true;

    function getFullXPath(el) {
        if (!el || el.nodeType !== 1) return '';
        const parts = [];
        let current = el;
        while (current && current.nodeType === 1) {
            let index = 1;
            let sibling = current.previousSibling;
            while (sibling) {
                if (sibling.nodeType === 1 && sibling.tagName === current.tagName) index++;
                sibling = sibling.previousSibling;
            }
            const tagName = current.tagName.toLowerCase();
            parts.unshift(tagName + '[' + index + ']');
            current = current.parentNode;
        }
        return '/' + parts.join('/');
    }

    function getAbsoluteXPath(el) {
        if (!el || el.nodeType !== 1) return '';
        const parts = [];
        let current = el;
        while (current && current !== document) {
            if (current.nodeType !== 1) { current = current.parentNode; continue; }
            let index = 1;
            let sibling = current.previousElementSibling;
            while (sibling) {
                if (sibling.tagName === current.tagName) index++;
                sibling = sibling.previousElementSibling;
            }
            parts.unshift(current.tagName.toLowerCase() + '[' + index + ']');
            current = current.parentNode;
        }
        return '/html/' + parts.join('/').replace('/html/', '');
    }

    document.addEventListener('click', function(e) {
        const el = e.target;
        const data = {
            xpath: getAbsoluteXPath(el),
            tag: el.tagName.toLowerCase(),
            text: (el.textContent || '').trim().substring(0, 100),
            innerText: (el.innerText || '').trim().substring(0, 100),
            id: el.id || null,
            classes: el.className || null,
            name: el.getAttribute('name'),
            type: el.getAttribute('type'),
            href: el.getAttribute('href') || (el.closest('a') ? el.closest('a').getAttribute('href') : null),
            role: el.getAttribute('role'),
            ariaLabel: el.getAttribute('aria-label'),
            dataState: el.getAttribute('data-state'),
            placeholder: el.getAttribute('placeholder'),
            value: el.value !== undefined ? el.value : null,
            parentTag: el.parentElement ? el.parentElement.tagName.toLowerCase() : null,
            parentClasses: el.parentElement ? el.parentElement.className : null,
            url: window.location.href
        };

        // Send to Node via console with a special prefix
        console.log('__CLICK_LOG__' + JSON.stringify(data));
    }, true);  // Use capture phase to catch everything

    console.log('[ClickLogger] Injected and listening for clicks.');
})();
`;

async function injectLogger(page) {
    try {
        await page.evaluate(INJECTED_SCRIPT);
    } catch (e) {
        // Page might not be ready yet, that's ok
    }
}

async function main() {
    const startPath = process.argv[2] || '/home/bizypro/studio';
    const startUrl = startPath.startsWith('http') ? startPath : `${BASE_URL}${startPath}`;

    console.log('🚀 Click Logger starting...');
    console.log(`📁 Log file: ${LOG_FILE}`);
    console.log(`🌐 Start URL: ${startUrl}`);

    const browser = await puppeteer.default.launch({
        executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        headless: false,
        userDataDir: USER_DATA_DIR,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1400,1024', '--window-position=800,50'],
        defaultViewport: null
    });

    const page = await browser.newPage();

    // Listen for our special console messages from the injected script
    page.on('console', (msg) => {
        const text = msg.text();
        if (text.startsWith('__CLICK_LOG__')) {
            try {
                const data = JSON.parse(text.replace('__CLICK_LOG__', ''));
                logClick(data);
            } catch (e) {
                console.error('Failed to parse click log:', e.message);
            }
        }
    });

    // Re-inject logger on every navigation
    page.on('domcontentloaded', async () => {
        await injectLogger(page);
    });

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

    // Navigate to start URL
    console.log(`📊 Navigating to ${startUrl}...`);
    await page.goto(startUrl, { waitUntil: 'load', timeout: 30000 });
    await page.waitForTimeout(2000);
    await injectLogger(page);

    console.log('\n========================================');
    console.log('  CLICK LOGGER ACTIVE');
    console.log('  Click anything in the browser.');
    console.log('  Every click is logged here + to file.');
    console.log(`  Log: ${LOG_FILE}`);
    console.log('  Ctrl+C to stop.');
    console.log('========================================\n');

    // Keep alive
    await new Promise(() => {});
}

main();
