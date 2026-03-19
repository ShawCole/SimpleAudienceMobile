import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { AudiencePayload } from '@shared/types/audience-payload';
import logger from '../utils/logger';
import fs from 'fs';
import path from 'path';

puppeteer.use(StealthPlugin());

// Action IDs
// Action IDs vary per deployment — these are used as initial guesses only.
// Auto-discovery will find the correct IDs if these are stale.
const ACTION_IDS = {
    PREVIEW: "7f2fedc1659914fecb5d57837dc4b06ab5c2e0e744",
    GENERATE: "7f437ee100a328c3149f7f41b6ef0aa67929d43bcc",
    CREATE_AUDIENCE: "7f6511f2963792b67a0b1696484be2bc032e617be0"
};

// Phase Definitions
export enum VacuumPhase {
    IDLE = 0,
    AUTHED = 1,           // Logged in
    ACCOUNT_SET = 2,      // Account selected (workspace slug from env)
    NAMING_MODAL_OPEN = 3,// Create button clicked, modal visible
    INITIALIZED = 4,      // Audience named, saved
    AUDIENCE_FILTERS = 5, // On the main audience page (previously READY)
    READY = 5,            // Alias for AUDIENCE_FILTERS for backward compat
    PREVIEWED = 6,        // Filters applied, preview generated
    GENERATED = 7         // Audience fully generated/ordered
}

interface DiscoveryCache {
    previewActionId: string | null;
    generateActionId: string | null;
    routerStateTree: string | null;
    deploymentId: string | null;
}

export class VacuumEngine {
    private static browser: any | null = null;
    private static page: any | null = null;
    private static debug = process.env.DEBUG === 'true' || true;
    private static prewarmingPromise: Promise<any> | null = null;
    private static get BASE_URL() { return process.env.SIMPLEAUDIENCE_BASE_URL || 'https://app.intentcore.io'; }
    private static get WORKSPACE_SLUG() { return process.env.SIMPLEAUDIENCE_WORKSPACE_SLUG || 'bizypro'; }

    private static cache: DiscoveryCache = {
        previewActionId: null,
        generateActionId: null,
        routerStateTree: null,
        deploymentId: null,
    };

    private static currentPhase: VacuumPhase = VacuumPhase.IDLE;
    private static currentContext: any = {};

    // Robust Selectors
    private static SELECTORS = {
        get ACCOUNT_CARD() { return `//a[contains(@href, "/home/${VacuumEngine.WORKSPACE_SLUG}")] | //div[contains(@href, "/home/${VacuumEngine.WORKSPACE_SLUG}") and (contains(@class, "card") or @role="button")]`; },
        // User provided exact path: /html/body/div[2]/div/div[2]/div[2]/div[2]/div[2]/button
        DASHBOARD_CREATE_BUTTON: '::-p-xpath(//button[contains(normalize-space(), "Create") and @aria-haspopup="dialog"])',
        NAMING_MODAL: 'xpath://div[@role="dialog"] | //div[contains(@id, "radix-")] | //div[contains(@class, "modal") and (contains(., "Create Audience") or contains(., "New Audience"))]',
        NAMING_INPUT: 'div[role="dialog"] form input[name="name"]',
        NAMING_SUBMIT: '::-p-xpath(//form//button[contains(@class, "bg-primary") and normalize-space()="Create"])',
        PREVIEW_BUTTON: 'xpath://button[contains(., "Refresh Preview") or contains(., "Run Preview") or contains(., "Preview")]',
        GENERATE_BUTTON: 'xpath://button[contains(., "Generate Audience") or contains(., "Update Audience") or contains(., "Order") or contains(., "Export") or contains(., "Process")]',
        STATUS_BADGE: '//span[contains(@class, "badge") or contains(@class, "status")]',
        AUDIENCE_ROW: (name: string) => `//tr[contains(., "${name}")]`
    };

    /**
     * Phase 2: Discovery Routine (The "Sniffer")
     * Captures dynamic Action IDs and Router State Trees from the live app
     */
    private static async discoverHeaders(page: any, target: 'PREVIEW' | 'GENERATE' = 'PREVIEW') {
        logger.info(`[Vacuum] Discovery Sniffer: ID cache miss. Triggering ${target} action...`);

        const selector = target === 'PREVIEW' ? this.SELECTORS.PREVIEW_BUTTON : this.SELECTORS.GENERATE_BUTTON;

        try {
            const currentUrl = page.url();
            logger.warn(`[Vacuum] Discovery triggered outside audience context. Current URL: ${currentUrl}`);

            // Helper: find and click a button by XPath or CSS selector via JS
            const clickSelector = async (s: string): Promise<boolean> => {
                return page.evaluate((s: string) => {
                    const isXpath = s.startsWith('//') || s.startsWith('(') || s.startsWith('xpath:');
                    const cleanS = s.startsWith('xpath:') ? s.substring(6) : s;
                    let el: Element | null = null;
                    if (isXpath) {
                        el = (document as any).evaluate(cleanS, document, null, 9, null).singleNodeValue;
                    } else {
                        el = document.querySelector(s);
                    }
                    if (el && 'click' in el) { (el as any).click(); return true; }
                    return false;
                }, s);
            };

            // 2. Click while listening for the next-action request
            const [request] = await Promise.all([
                page.waitForRequest((req: any) => {
                    const hasAction = !!req.headers()['next-action'];
                    const isPost = req.method() === 'POST';
                    return isPost && hasAction;
                }, { timeout: 20000 }),
                (async () => {
                    logger.info(`[Vacuum] Waiting for button: ${selector}`);
                    await page.waitForTimeout(1500);

                    const clicked = await clickSelector(selector);
                    if (!clicked) {
                        throw new Error(`Could not find or click button: ${selector}`);
                    }

                    // GENERATE opens a confirmation dialog — click the inner "Generate" to fire the request
                    if (target === 'GENERATE') {
                        logger.info('[Vacuum] GENERATE: waiting for confirmation dialog...');
                        await page.waitForTimeout(2500);
                        const dialogClicked = await clickSelector('xpath://button[normalize-space(text())="Generate"]');
                        if (!dialogClicked) {
                            // Fallback: try any button with just "Generate" text
                            await clickSelector('xpath://button[contains(., "Generate") and not(contains(., "Audience"))]');
                        }
                        logger.info('[Vacuum] GENERATE: clicked confirmation dialog Generate button');
                    }
                })()
            ]);

            const nextAction = request.headers()['next-action'];
            const routerTree = request.headers()['next-router-state-tree'];

            if (nextAction && routerTree) {
                logger.info(`[Vacuum] 🎯 Discovery SUCCESS: ${target} ID: ${nextAction}`);
                if (target === 'PREVIEW') {
                    this.cache.previewActionId = nextAction;
                } else {
                    this.cache.generateActionId = nextAction;
                }
                this.cache.routerStateTree = routerTree;
                return { actionId: nextAction, routerStateTree: routerTree };
            }

            throw new Error('POST request caught but missing required Next.js headers');
        } catch (err: any) {
            logger.error(`[Vacuum] ❌ Discovery FAILED for ${target}: ${err.message}`);
            // Diagnostic: List buttons to see what's on page
            try {
                const buttons = await page.evaluate(() => Array.from(document.querySelectorAll('button')).map(b => b.innerText).filter(t => t.length > 1));
                logger.info(`[Vacuum] Buttons visible on page: ${JSON.stringify(buttons)}`);
            } catch (e) { }
            throw err;
        }
    }

    /**
     * Singleton Browser & Page Instance (Headed)
     * Now with connection and page state checks
     */
    private static async getSession() {
        // Check if browser is disconnected or null
        if (!this.browser || !this.browser.isConnected()) {
            logger.info(`[Vacuum] 🛠️ Launching Headed Browser...`);
            this.browser = await puppeteer.launch({
                executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
                headless: false, // Always headed for visibility and debugging
                args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1280,1024'],
                defaultViewport: null
            });

            this.browser.on('disconnected', () => {
                logger.info('[Vacuum] 🔌 Browser disconnected, clearing session...');
                this.browser = null;
                this.page = null;
                this.currentPhase = VacuumPhase.IDLE;
            });

            this.page = null; // Force new page creation
        }

        // Check if page is closed or null
        if (!this.page || this.page.isClosed()) {
            logger.info('[Vacuum] 📄 Creating new page...');
            this.page = await this.browser.newPage();

            // Enable verbose logging from browser to Node console
            this.page.on('console', (msg) => {
                const type = msg.type();
                const text = msg.text();
                logger.info(`[Vacuum Browser Console] [${type.toUpperCase()}] ${text}`);
            });

            // Network logging — captures all Puppeteer browser traffic to JSONL
            const logsDir = path.resolve(process.cwd(), 'logs');
            if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });
            const netLog = fs.createWriteStream(path.join(logsDir, 'puppeteer-network.jsonl'), { flags: 'a' });

            this.page.on('request', (req: any) => {
                const url = req.url();
                // Skip noise: images, fonts, stylesheets, favicon
                const skip = /\.(png|jpg|jpeg|gif|svg|ico|woff2?|ttf|eot|css)(\?|$)/i;
                if (skip.test(url)) return;

                netLog.write(JSON.stringify({
                    t: new Date().toISOString(),
                    d: '>>',
                    method: req.method(),
                    url,
                    type: req.resourceType(),
                    headers: req.headers(),
                    postData: req.postData() || null
                }) + '\n');
            });

            this.page.on('response', async (res: any) => {
                const url = res.url();
                const skip = /\.(png|jpg|jpeg|gif|svg|ico|woff2?|ttf|eot|css)(\?|$)/i;
                if (skip.test(url)) return;

                let body: string | null = null;
                try {
                    const ct = res.headers()['content-type'] || '';
                    if (ct.includes('json') || ct.includes('text/html') || ct.includes('text/plain')) {
                        body = await res.text();
                        // Truncate huge responses to keep log readable
                        if (body && body.length > 10000) {
                            body = body.substring(0, 10000) + `... [TRUNCATED ${body.length} chars]`;
                        }
                    }
                } catch (_) { /* body unavailable for redirects, etc */ }

                netLog.write(JSON.stringify({
                    t: new Date().toISOString(),
                    d: '<<',
                    status: res.status(),
                    url,
                    headers: res.headers(),
                    body
                }) + '\n');
            });

            logger.info('[Vacuum] 📡 Network logger attached — writing to logs/puppeteer-network.jsonl');
        }
        return { browser: this.browser, page: this.page };
    }

    /**
     * Public Sniffer: Returns the exact current browser state
     * Used by the API to synchronize frontend UI
     */
    static async getBrowserState(): Promise<VacuumPhase> {
        if (!this.page) return VacuumPhase.IDLE;
        return await this.determineCurrentPhase(this.page);
    }

    /**
     * Internal: Determine current browser phase based on URL and DOM
     */
    private static async determineCurrentPhase(page: any): Promise<VacuumPhase> {
        const url = page.url();
        logger.info(`[Vacuum] 🔍 Phase Detector: Analyzing ${url}`);

        const baseHost = new URL(this.BASE_URL).hostname;
        if (url.includes('sign-in') || !url.includes(baseHost)) return VacuumPhase.IDLE;

        if (url.includes('/audience/')) return VacuumPhase.AUDIENCE_FILTERS;

        const isNamingModalOpen = await page.evaluate((selector) => {
            try {
                const doc = document;
                const isXpath = selector.startsWith('//') || selector.startsWith('(') || selector.startsWith('xpath:');
                const s = selector.startsWith('xpath:') ? selector.substring(6) : selector;

                let el = null;
                if (isXpath) {
                    el = doc.evaluate(s, doc, null, 9, null).singleNodeValue;
                } else {
                    el = doc.querySelector(s);
                }
                return !!el;
            } catch (e) {
                return false;
            }
        }, this.SELECTORS.NAMING_MODAL);

        if (isNamingModalOpen) {
            logger.info('[Vacuum] Phase Detector: Naming modal detected.');
            return VacuumPhase.NAMING_MODAL_OPEN;
        }

        if (url.includes('/home/')) {
            const pathParts = url.split('/');
            // /home/<slug> -> [https, , <host>, home, <slug>] -> length 5
            if (pathParts.length >= 5 && pathParts[pathParts.length - 1] !== 'home') {
                logger.info(`[Vacuum] Phase Detector: Account context detected (${pathParts[4]})`);
                return VacuumPhase.ACCOUNT_SET;
            }
            console.log('[Vacuum] Phase Detector: Home dashboard detected (no account).');
            return VacuumPhase.AUTHED;
        }

        return VacuumPhase.AUTHED;
    }

    /**
     * Universal Catch-Up: Ensures the browser is at the target phase
     */
    private static async catchUp(target: VacuumPhase, context: any = {}) {
        const startTime = Date.now();
        const { page } = await this.getSession();
        let current = await this.determineCurrentPhase(page);

        logger.info(`[Vacuum] 🏁 Catch-Up [Start]: Current=${VacuumPhase[current]}, Target=${VacuumPhase[target]}`);

        const logStep = (step: string) => {
            const delta = ((Date.now() - startTime) / 1000).toFixed(2);
            logger.info(`[Vacuum] ⏱️ Catch-Up [T+${delta}s]: ${step}`);
        };

        if (current >= target) {
            logStep('Target already reached.');
            return;
        }

        // Phase 1 -> Authed
        if (current < VacuumPhase.AUTHED && target >= VacuumPhase.AUTHED) {
            logStep('Transitioning to AUTHED...');
            await this.prewarm();
            current = VacuumPhase.AUTHED;
        }

        // Phase 2 -> Account Selected
        if (current < VacuumPhase.ACCOUNT_SET && target >= VacuumPhase.ACCOUNT_SET) {
            const currentUrl = page.url();
            if (currentUrl.includes(`/home/${this.WORKSPACE_SLUG}`)) {
                logStep(`Already on ${this.WORKSPACE_SLUG} account dashboard, skipping navigation.`);
            } else {
                logStep(`Navigating to ${this.WORKSPACE_SLUG} account (Current URL: ${currentUrl})...`);
                try {
                    // Direct jump with immediate list detection
                    await page.goto(`${this.BASE_URL}/home/${this.WORKSPACE_SLUG}`, { waitUntil: 'load', timeout: 30000 });
                    logger.info(`[Vacuum] Transitioned to ACCOUNT_SET. New URL: ${page.url()}`);

                    // Combined wait for either the Create button or an audience table row
                    logStep('Waiting for dashboard content (List or Button)...');
                    await page.waitForFunction(() => {
                        // Look for Create button by text content (no Puppeteer pseudo-selectors in browser context)
                        const btns = Array.from(document.querySelectorAll('button'));
                        const createBtn = btns.some(b =>
                            b.textContent?.trim().includes('Create') && b.offsetParent !== null
                        );
                        // Or look for audience table rows
                        const rows = document.querySelectorAll('tr');
                        return createBtn || rows.length > 5;
                    }, { timeout: 30000 });
                } catch (err: any) {
                    logger.warn(`⚠️ [Vacuum] Direct jump failed, falling back to click: ${err.message}`);
                    await page.waitForSelector(this.SELECTORS.ACCOUNT_CARD, { timeout: 10000 });
                    logger.info(`🚀 [Vacuum] CLICKING: Account Card (${this.WORKSPACE_SLUG})`);
                    await Promise.all([
                        page.waitForNavigation({ waitUntil: 'load', timeout: 30000 }),
                        page.click(this.SELECTORS.ACCOUNT_CARD)
                    ]);
                }
            }
            current = VacuumPhase.ACCOUNT_SET;
        }

        // Phase 3: Naming Modal Open
        if (current < VacuumPhase.NAMING_MODAL_OPEN && target >= VacuumPhase.NAMING_MODAL_OPEN) {
            if (context.id) {
                logStep('Skipping Naming Modal (Direct ID jump requested)');
            } else {
                logStep('Transitioning to NAMING_MODAL_OPEN...');
                await this.transitionToNamingReady();
            }
            current = VacuumPhase.NAMING_MODAL_OPEN;
        }

        // Phase 4: Initialized / Audience Filters
        if (current < VacuumPhase.INITIALIZED && target >= VacuumPhase.INITIALIZED) {
            if (context.id) {
                const audienceUrl = `${this.BASE_URL}/home/${this.WORKSPACE_SLUG}/audience/${context.id}`;
                const currentUrl = page.url();

                if (!currentUrl.includes(context.id)) {
                    logStep(`Direct Jump to Audience ID: ${context.id}`);
                    await page.goto(audienceUrl, { waitUntil: 'load', timeout: 30000 });

                    // Self-healing check
                    const isOuch = await page.evaluate(() => document.body.innerText.includes('Ouch!'));
                    if (isOuch) {
                        logStep('Hit Ouch! page. Attempting recovery reload...');
                        await page.reload({ waitUntil: 'load' });
                    }
                }
                current = VacuumPhase.AUDIENCE_FILTERS;
            } else if (context.name) {
                if (current === VacuumPhase.NAMING_MODAL_OPEN) {
                    logStep(`Submitting name "${context.name}"...`);
                    await this.submitAudienceName(context.name);
                } else {
                    logStep(`Full Initialization for "${context.name}"...`);
                    await this.initAudience(context.name);
                }
                current = VacuumPhase.AUDIENCE_FILTERS;
            } else {
                throw new Error('Cannot catch up to INITIALIZED without audience id or name');
            }
        }

        logStep(`Catch-Up Complete in ${((Date.now() - startTime) / 1000).toFixed(2)}s`);
    }

    /**
     * Pre-warm: Login ONLY (Phase 1)
     */
    static async prewarm() {
        if (this.prewarmingPromise) {
            logger.info('[Vacuum] ⏳ Pre-warm already in progress, waiting...');
            return this.prewarmingPromise;
        }

        let pageInstance: any = null;
        this.prewarmingPromise = (async () => {
            logger.info('--- VACUUM PREWARM STARTING ---');
            try {
                const { page } = await this.getSession();
                pageInstance = page;
                await page.waitForTimeout(100);

                const currentUrl = page.url();
                logger.info(`[Vacuum] 🔗 Session obtained. Current URL: ${currentUrl}`);

                // 1. AUTHENTICATION / NAVIGATION
                const baseHost = new URL(this.BASE_URL).hostname;
                if (!currentUrl.includes(baseHost) || currentUrl.includes('sign-in')) {
                    logger.info(`[Vacuum] 🧱 Not on site or on sign-in page, navigating to auth on ${baseHost}...`);
                    await page.goto(`${this.BASE_URL}/auth/sign-in`, { waitUntil: 'load', timeout: 30000 });

                    if (page.url().includes('sign-in')) {
                        logger.info('[Vacuum] 🔑 Performing login...');
                        const email = process.env.SIMPLEAUDIENCE_EMAIL || process.env.PARTNER_EMAIL;
                        const password = process.env.SIMPLEAUDIENCE_PASSWORD || process.env.PARTNER_PASSWORD;

                        if (!email || !password) {
                            throw new Error('Missing SIMPLEAUDIENCE_EMAIL or SIMPLEAUDIENCE_PASSWORD in .env');
                        }

                        await page.waitForSelector('input[type="email"]', { visible: true, timeout: 10000 });
                        logger.info('[Vacuum] 🔑 Typing email...');
                        await page.type('input[type="email"]', email, { delay: 50 });

                        await page.waitForSelector('input[type="password"]', { visible: true, timeout: 5000 });
                        logger.info('[Vacuum] 🔑 Typing password...');
                        await page.type('input[type="password"]', password, { delay: 50 });

                        logger.info('[Vacuum] 🚀 Clicking login button...');
                        await Promise.all([
                            page.waitForNavigation({ waitUntil: 'load', timeout: 30000 }),
                            page.click('button[type="submit"]')
                        ]);
                        logger.info('[Vacuum] ✅ Login successful.');
                    }
                }

                logger.info('[Vacuum] Login/Navigation Complete. Transitioning to dashboard...');
                this.currentPhase = VacuumPhase.AUTHED;

                // Navigate to account dashboard (always go to dashboard, even if on a sub-page like /audience/...)
                const currentNavUrl = page.url();
                const dashboardUrl = `${this.BASE_URL}/home/${this.WORKSPACE_SLUG}`;
                const isOnDashboard = currentNavUrl === dashboardUrl || currentNavUrl === dashboardUrl + '/';
                if (!isOnDashboard) {
                    logger.info(`[Vacuum] Navigating to ${this.WORKSPACE_SLUG} account dashboard (was: ${currentNavUrl})...`);
                    await page.goto(dashboardUrl, { waitUntil: 'load', timeout: 30000 });
                }

                // Wait for dashboard content to load
                logger.info('[Vacuum] ⏳ Waiting for dashboard content...');
                await page.waitForFunction(() => {
                    const btns = Array.from(document.querySelectorAll('button'));
                    const createBtn = btns.some(b => b.textContent?.trim().includes('Create') && b.offsetParent !== null);
                    const rows = document.querySelectorAll('tr');
                    return createBtn || rows.length > 5;
                }, { timeout: 30000 });

                this.currentPhase = VacuumPhase.ACCOUNT_SET;
                logger.info('[Vacuum] ✅ Dashboard loaded. Clicking Create button...');

                // Click Create button to open naming modal
                await page.waitForTimeout(300);
                const createClicked = await page.evaluate(() => {
                    const btns = Array.from(document.querySelectorAll('button'));
                    const target = btns.find(b => b.textContent?.trim().includes('Create') && b.offsetParent !== null);
                    if (target) { target.click(); return true; }
                    return false;
                });
                if (!createClicked) {
                    throw new Error('Create button not found on dashboard');
                }

                // Wait for naming input to appear
                await page.waitForSelector(this.SELECTORS.NAMING_INPUT, { visible: true, timeout: 15000 });

                this.currentPhase = VacuumPhase.NAMING_MODAL_OPEN;
                logger.info('--- VACUUM PREWARM SUCCESSFUL (NAMING MODAL OPEN) ---');
                return { success: true };
            } catch (err: any) {
                logger.warn(`[Vacuum] ⚠️ Pre-warm sequence snagged: ${err.message}. Performing final state check...`);

                // Final Check: Even if catchUp threw an error, are we actually where we need to be?
                if (pageInstance) {
                    const finalPhase = await this.determineCurrentPhase(pageInstance);
                    if (finalPhase === VacuumPhase.NAMING_MODAL_OPEN) {
                        logger.info('--- VACUUM PREWARM SUCCESSFUL (MODAL OPEN - RECOVERED) ---');
                        return { success: true };
                    }
                }

                logger.error(`[Vacuum] ❌ Pre-warm definitively failed: ${err.message}`);
                throw err;
            }
        })();

        try {
            // Add a hard timeout to prewarm to prevent stuck sessions
            return await Promise.race([
                this.prewarmingPromise,
                new Promise((_, reject) => setTimeout(() => reject(new Error('Pre-warm Timeout (90s)')), 90000))
            ]);
        } finally {
            this.prewarmingPromise = null;
        }
    }

    /**
     * Transition specifically to the "Naming Modal Open" state.
     * Idempotent: If already open, does nothing.
     */
    static async transitionToNamingReady() {
        const { page } = await this.getSession();
        logger.info('[Vacuum] 🔍 transitionToNamingReady: Checking state...');

        // 1. Check if already open
        const currentState = await this.determineCurrentPhase(page);
        if (currentState === VacuumPhase.NAMING_MODAL_OPEN) {
            logger.info('[Vacuum] ✨ Naming modal already open.');
            return;
        }

        // 2. Ensure on Dashboard
        if (currentState < VacuumPhase.ACCOUNT_SET) {
            await this.catchUp(VacuumPhase.ACCOUNT_SET);
        }

        // 3. Open Logic (Click Create)
        logger.info('[Vacuum] ⏳ Waiting for "Create" button...');

        // Use JS-based detection (reliable across Puppeteer versions)
        await page.waitForFunction(() => {
            const btns = Array.from(document.querySelectorAll('button'));
            return btns.some(b => b.textContent?.trim().includes('Create') && b.offsetParent !== null);
        }, { timeout: 30000 });
        await page.waitForTimeout(300); // Small settle buffer

        // Click via JS evaluate (most reliable across DOM structures)
        logger.info(`🚀 [Vacuum] CLICKING: "Create" Button`);
        const clicked = await page.evaluate(() => {
            const btns = Array.from(document.querySelectorAll('button'));
            const target = btns.find(b => b.textContent?.trim().includes('Create') && b.offsetParent !== null);
            if (target) { target.click(); return true; }
            return false;
        });
        if (!clicked) {
            throw new Error('Create button found by waitForFunction but click target not found');
        }

        await page.waitForSelector(this.SELECTORS.NAMING_INPUT, { visible: true, timeout: 15000 });
        logger.info('[Vacuum] 🏁 Naming modal ready.');
    }

    /**
     * Submit name from the Naming Modal state
     */
    static async submitAudienceName(name: string) {
        const { page } = await this.getSession();
        logger.info(`[Vacuum] submitAudienceName: "${name}"`);

        await page.waitForSelector(this.SELECTORS.NAMING_INPUT);
        await page.type(this.SELECTORS.NAMING_INPUT, name);
        await page.waitForTimeout(500); // Small type buffer

        logger.info(`🚀 [Vacuum] SUBMITTING Name: "${name}"`);

        // Set up request interceptor to capture accountId from the create-audience POST
        let capturedAccountId: string | null = null;
        const captureHandler = (req: any) => {
            try {
                const postData = req.postData?.();
                if (postData && postData.includes('accountId')) {
                    const match = postData.match(/"accountId"\s*:\s*"([0-9a-f-]{36})"/);
                    if (match) capturedAccountId = match[1];
                }
            } catch {}
        };
        page.on('request', captureHandler);

        // Use page.evaluate for submit click (same reliable pattern as transitionToNamingReady)
        await Promise.all([
            page.waitForNavigation({ waitUntil: 'load', timeout: 30000 }),
            page.evaluate(() => {
                // Find submit button inside the dialog form: primary-styled or type=submit
                const dialog = document.querySelector('div[role="dialog"]');
                if (!dialog) throw new Error('No dialog found');
                const btns = Array.from(dialog.querySelectorAll('button'));
                const target = btns.find(b => {
                    const text = b.textContent?.trim().toLowerCase() || '';
                    const isPrimary = b.classList.contains('bg-primary') || b.getAttribute('type') === 'submit';
                    return (text === 'create' || text === 'submit' || text === 'save') && isPrimary;
                }) || btns.find(b => {
                    // Fallback: any button with "Create" text in the form
                    return b.textContent?.trim().toLowerCase() === 'create' && b.offsetParent !== null;
                });
                if (target) { target.click(); return true; }
                throw new Error('Submit button not found in dialog');
            })
        ]);

        logger.info('[Vacuum] 🎯 Audience created, now on Filters page.');
        this.currentPhase = VacuumPhase.AUDIENCE_FILTERS;
        page.off('request', captureHandler);

        // Context Capture
        const currentUrl = page.url();
        const parts = currentUrl.split('/');
        const audienceId = parts[parts.indexOf('audience') + 1];

        // Extract accountId: try intercepted value, then __NEXT_DATA__, then HTML scan, then network log
        if (capturedAccountId) logger.info(`[Vacuum] Captured accountId from request interceptor: ${capturedAccountId}`);
        let accountId = capturedAccountId || await this.getAccountUuidFromPage(page) || await this.extractAccountIdFromUrl(page);

        // Final fallback: extract from the audience page URL's own fetch calls
        if (!accountId) {
            logger.info('[Vacuum] Attempting accountId extraction via page fetch...');
            accountId = await page.evaluate(async () => {
                try {
                    // The page's own JS has the accountId in its closure — try to find it in performance entries
                    const entries = performance.getEntriesByType('resource') as PerformanceResourceTiming[];
                    for (const e of entries) {
                        if (e.name.includes('accountId')) {
                            const match = e.name.match(/accountId=([0-9a-f-]{36})/);
                            if (match) return match[1];
                        }
                    }
                    // Try fetching the RSC data for the current page
                    const resp = await fetch(window.location.href + '?_rsc=1', {
                        headers: { 'RSC': '1' }
                    });
                    const text = await resp.text();
                    const match = text.match(/"accountId"\s*:\s*"([0-9a-f-]{36})"/);
                    if (match) return match[1];
                    return null;
                } catch { return null; }
            });
        }

        if (!accountId) throw new Error('Could not extract accountId from page. Check SIMPLEAUDIENCE_WORKSPACE_SLUG.');
        logger.info(`[Vacuum] Extracted accountId: ${accountId}`);
        this.currentContext = { name, audienceId, accountId };

        return { accountId, audienceId };
    }

    /**
     * Initialize Audience: Smart Entry (Find Existing OR Create)
     */
    static async initAudience(name: string) {
        const start = performance.now();
        const logTime = (msg: string) => {
            const delta = ((performance.now() - start) / 1000).toFixed(3);
            logger.info(`[Vacuum] ⏱️ [T+${delta}s] initAudience: ${msg}`);
        };

        logTime(`Initializing audience: "${name}"`);
        const { page } = await this.getSession();

        try {
            // Catch up to ACCOUNT_SET (handles navigation to dashboard)
            await this.catchUp(VacuumPhase.ACCOUNT_SET);

            // --- RACE CONDITION FIX: Wait for Dashboard Content ---
            logTime('Waiting for dashboard presence...');
            await page.waitForSelector('body', { timeout: 5000 });
            logTime('Dashboard presence confirmed.');

            // --- SMART ENTRY: FIND EXISTING ---
            logTime(`Searching for "${name}"...`);
            const rowSelector = this.SELECTORS.AUDIENCE_ROW(name);
            const existingFound = await page.evaluate((selector: string) => {
                try {
                    const doc = document;
                    const isXpath = selector.startsWith('//') || selector.startsWith('(') || selector.startsWith('xpath:');
                    const s = selector.startsWith('xpath:') ? selector.substring(6) : selector;

                    let el = null;
                    if (isXpath) {
                        el = doc.evaluate(s, doc, null, 9, null).singleNodeValue;
                    } else {
                        el = doc.querySelector(s);
                    }
                    return !!el;
                } catch (e) { return false; }
            }, rowSelector);

            if (existingFound) {
                logTime(`Found "${name}". Navigating...`);
                await Promise.all([
                    page.waitForNavigation({ waitUntil: 'load', timeout: 30000 }),
                    page.click(rowSelector)
                ]);

                const currentUrl = page.url();
                const parts = currentUrl.split('/');
                const audienceId = parts[parts.indexOf('audience') + 1];
                const accountId = await this.getAccountUuidFromPage(page) || await this.extractAccountIdFromUrl(page);
                if (!accountId) throw new Error('Could not extract accountId from page. Check SIMPLEAUDIENCE_WORKSPACE_SLUG.');

                logTime(`Context ACTIVE. ID: ${audienceId}`);
                this.currentPhase = VacuumPhase.AUDIENCE_FILTERS;
                this.currentContext = { name, audienceId, accountId };
                return { accountId, audienceId };
            }

            logTime(`"${name}" not found. Proceeding with creation via DOM...`);

            // --- DOM-BASED CREATION (replaces fragile server action injection) ---
            // Open the naming modal and submit through the real UI
            await this.transitionToNamingReady();
            const result = await this.submitAudienceName(name);

            logTime(`Created via DOM. ID: ${result.audienceId}`);
            return result;

        } catch (error: any) {
            logger.error(`[Vacuum] ❌ Init Audience Failed: ${error.message}`);
            throw error;
        }
    }

    /**
     * Internal method to extract account UUID from page state
     */
    private static async getAccountUuidFromPage(page: any): Promise<string | null> {
        return await page.evaluate(() => {
            try {
                if (typeof window !== 'undefined' && window.__NEXT_DATA__) {
                    const nextData = window.__NEXT_DATA__;
                    const pageProps = nextData?.props?.pageProps;
                    if (pageProps?.account?.id) return pageProps.account.id;
                    if (pageProps?.accountId) return pageProps.accountId;
                    if (nextData?.query?.account) return nextData.query.account;
                }
                if (window.accountId) return window.accountId;
                if (window.currentAccount?.id) return window.currentAccount.id;
                const storedAccount = window.localStorage.getItem('currentAccount');
                if (storedAccount) {
                    const parsed = JSON.parse(storedAccount);
                    if (parsed.id) return parsed.id;
                }
                return null;
            } catch (e) {
                return null;
            }
        });
    }

    /**
     * Fallback: extract account UUID by fetching the account's API endpoint or scanning page HTML
     */
    private static async extractAccountIdFromUrl(page: any): Promise<string | null> {
        // Method 1: Scan all script tags and full HTML for accountId pattern
        const fromHtml = await page.evaluate(() => {
            try {
                const html = document.documentElement.outerHTML;
                const match = html.match(/"accountId"\s*:\s*"([0-9a-f-]{36})"/);
                if (match) return match[1];
                // Also try "account":{"id":"..."}
                const match2 = html.match(/"account"\s*:\s*\{\s*"id"\s*:\s*"([0-9a-f-]{36})"/);
                if (match2) return match2[1];
                return null;
            } catch (e) {
                return null;
            }
        });
        if (fromHtml) return fromHtml;

        // Method 2: Make a fetch to the account's RSC endpoint to trigger accountId in response
        const fromFetch = await page.evaluate(async (slug: string) => {
            try {
                const resp = await fetch(`/home/${slug}?_rsc=1`, {
                    headers: { 'RSC': '1', 'Next-Router-State-Tree': '' }
                });
                const text = await resp.text();
                const match = text.match(/"accountId"\s*:\s*"([0-9a-f-]{36})"/);
                if (match) return match[1];
                const match2 = text.match(/"id"\s*:\s*"([0-9a-f-]{36})"/);
                if (match2) return match2[1];
                return null;
            } catch (e) {
                return null;
            }
        }, this.WORKSPACE_SLUG);
        if (fromFetch) return fromFetch;

        // Method 3: Read from puppeteer network log file (last 100 lines)
        try {
            const logPath = path.join(process.cwd(), 'backend', 'logs', 'puppeteer-network.jsonl');
            if (fs.existsSync(logPath)) {
                const lines = fs.readFileSync(logPath, 'utf-8').split('\n').slice(-100);
                for (const line of lines.reverse()) {
                    const match = line.match(/"accountId\\?"\\?\s*:\\?\s*\\?"([0-9a-f-]{36})\\?"/);
                    if (match) {
                        logger.info(`[Vacuum] Found accountId in network log: ${match[1]}`);
                        return match[1];
                    }
                }
            }
        } catch (e) { /* ignore */ }

        return null;
    }

    /**
     * Internal method to extract audience UUID from page state
     */
    private static async getAudienceUuidFromPage(page: any): Promise<string | null> {
        return await page.evaluate(() => {
            try {
                if (typeof window !== 'undefined' && window.__NEXT_DATA__) {
                    const nextData = window.__NEXT_DATA__;
                    const pageProps = nextData?.props?.pageProps;
                    if (pageProps?.audience?.id) return pageProps.audience.id;
                    if (pageProps?.audienceId) return pageProps.audienceId;
                }
                if (window.audienceId) return window.audienceId;
                if (window.currentAudience?.id) return window.currentAudience.id;
                return null;
            } catch (e) {
                return null;
            }
        });
    }

    /**
     * Sanitizes and formats clean UI filter strings into portal-ready payloads.
     * Handles capitalization, prefixing ($$), and specific range rules.
     */
    private static prepareFilters(input: any) {
        if (!input) return input;

        const filters = JSON.parse(JSON.stringify(input)); // Deep clone to avoid mutating input

        // 1. Income Range Formatting ($ -> $$)
        if (filters.filters?.profile?.incomeRange) {
            filters.filters.profile.incomeRange = filters.filters.profile.incomeRange.map((val: string) => {
                if (val.startsWith('less than')) return val;
                if (val.startsWith('$') && !val.startsWith('$$')) return '$' + val;
                return val;
            });
        }

        // 2. Net Worth Formatting ($ -> $$)
        if (filters.filters?.profile?.netWorth) {
            filters.filters.profile.netWorth = filters.filters.profile.netWorth.map((val: string) => {
                if (val.startsWith('-')) return val; // Negative ranges stay as -$
                if (val.startsWith('more than')) return val;
                if (val.startsWith('$') && !val.startsWith('$$')) return '$' + val;
                return val;
            });
        }

        // 3. Credit Rating Formatting (Capitalized -> Lowercase)
        if (filters.filters?.attributes?.credit_rating) {
            filters.filters.attributes.credit_rating = filters.filters.attributes.credit_rating.map((val: string) => {
                if (val === 'Under 499') return 'under 499';
                return val;
            });
        }

        // 4. New Credit Range Formatting ($ -> $$ and Capitalization)
        if (filters.filters?.attributes?.credit_range_new_credit) {
            filters.filters.attributes.credit_range_new_credit = filters.filters.attributes.credit_range_new_credit.map((val: string) => {
                if (val === 'Greater Than $9,999') return 'Greater than $9,999';
                if (val.startsWith('$') && !val.startsWith('$$')) return '$' + val;
                return val;
            });
        }

        // 5. Credit Card User Formatting (Capitalized -> Lowercase)
        if (filters.filters?.attributes?.credit_card_user) {
            filters.filters.attributes.credit_card_user = filters.filters.attributes.credit_card_user.map((val: string) => {
                return val.toLowerCase();
            });
        }

        // 6. Investment Formatting (Capitalized -> Lowercase)
        if (filters.filters?.attributes?.investment) {
            filters.filters.attributes.investment = filters.filters.attributes.investment.map((val: string) => {
                return val.toLowerCase();
            });
        }

        // 7. Occupation Group Formatting (Title Case -> Lowercase)
        if (filters.filters?.attributes?.occupation_group) {
            filters.filters.attributes.occupation_group = filters.filters.attributes.occupation_group.map((val: string) => {
                return val.toLowerCase();
            });
        }

        // 8. Occupation Type Formatting (Title Case -> Lowercase)
        if (filters.filters?.attributes?.occupation_type) {
            filters.filters.attributes.occupation_type = filters.filters.attributes.occupation_type.map((val: string) => {
                return val.toLowerCase();
            });
        }

        // 9. CRA Code Formatting (Title Case -> Lowercase)
        if (filters.filters?.attributes?.cra_code) {
            filters.filters.attributes.cra_code = filters.filters.attributes.cra_code.map((val: string) => {
                return val.toLowerCase();
            });
        }

        // 10. Seniority Formatting (Title Case -> Lowercase) — platform expects "cxo" not "CXO"
        if (filters.filters?.businessProfile?.seniority) {
            filters.filters.businessProfile.seniority = filters.filters.businessProfile.seniority.map((val: string) => {
                return val.toLowerCase();
            });
        }

        // 11. Department Formatting (Title Case -> Lowercase)
        if (filters.filters?.businessProfile?.department) {
            filters.filters.businessProfile.department = filters.filters.businessProfile.department.map((val: string) => {
                return val.toLowerCase();
            });
        }

        // 12. Ensure home_purchase_month and mortgage_amount exist in attributes (platform expects them)
        if (filters.filters?.attributes && !('home_purchase_month' in filters.filters.attributes)) {
            filters.filters.attributes.home_purchase_month = [];
        }
        if (filters.filters?.attributes && !('mortgage_amount' in filters.filters.attributes)) {
            filters.filters.attributes.mortgage_amount = { min: null, max: null };
        }

        // 13. Gender Formatting (Title Case -> Lowercase) — safety net for backend-direct calls
        if (filters.filters?.gender && Array.isArray(filters.filters.gender)) {
            filters.filters.gender = filters.filters.gender.map((val: string) => val.toLowerCase());
        }

        // 14b. Profile fields lowercase — platform crashes on "Homeowner", expects "homeowner"
        if (filters.filters?.profile?.homeowner) {
            filters.filters.profile.homeowner = filters.filters.profile.homeowner.map((val: string) => val.toLowerCase());
        }
        if (filters.filters?.profile?.children) {
            filters.filters.profile.children = filters.filters.profile.children.map((val: string) => val.toLowerCase());
        }
        if (filters.filters?.profile?.married) {
            filters.filters.profile.married = filters.filters.profile.married.map((val: string) => val.toLowerCase());
        }

        // 14c. Marital Status lowercase — platform crashes on "Married", expects "married"
        if (filters.filters?.attributes?.marital_status) {
            filters.filters.attributes.marital_status = filters.filters.attributes.marital_status.map((val: string) => val.toLowerCase());
        }

        // 14. Estimated Home Value Formatting ($ -> $$) — safety net for backend-direct calls
        if (filters.filters?.attributes?.estimated_home_value) {
            filters.filters.attributes.estimated_home_value = filters.filters.attributes.estimated_home_value.map((val: string) => {
                if (val.startsWith('$$')) return val; // Already prefixed
                if (val.startsWith('$')) return '$' + val; // $25,000 -> $$25,000
                return val;
            });
        }

        return filters;
    }

    /**
     * Universal Injector: Login -> Navigate -> Inject
     */
    private static async executeInjection(
        payload: AudiencePayload,
        actionType: 'PREVIEW' | 'GENERATE'
    ) {
        const { page } = await this.getSession();

        try {
            // 1. CATCH UP: Ensure we are on the audience filters page
            // Use ID if available, otherwise name
            await this.catchUp(VacuumPhase.AUDIENCE_FILTERS, {
                id: payload.id,
                name: payload.name || "Auto-Recovered"
            });

            // 2. DYNAMIC CONTEXT EXTRACTION
            logger.info('[Vacuum] Extracting dynamic context for injection...');
            const dynamicContext = await page.evaluate(() => {
                try {
                    // CSRF Token
                    let csrf = null;
                    const meta = document.querySelector('meta[name="csrf-token"]');
                    if (meta) csrf = meta.getAttribute('content');
                    if (!csrf) {
                        const match = document.cookie.match(/x-csrf-token=([^;]+)/);
                        if (match) csrf = match[1];
                    }

                    // Deployment ID
                    let dpl = null;
                    const dplMatch = document.documentElement.outerHTML.match(/dpl_[a-zA-Z0-9]+/);
                    if (dplMatch) dpl = dplMatch[0];

                    // Account Slug (from URL)
                    const url = window.location.href;
                    const urlMatch = url.match(/\/home\/([^\/]+)\/audience\/([^\/\?]+)/);
                    const accSlug = urlMatch ? urlMatch[1] : null;
                    const audId = urlMatch ? urlMatch[2] : null;

                    return { csrf, dpl, accSlug, audId };
                } catch (e) { return { csrf: null, dpl: null, accSlug: null, audId: null }; }
            });

            const currentAccountId = payload.accountId || this.currentContext?.accountId;
            if (!currentAccountId) throw new Error('No accountId available. Run initAudience first or provide in payload.');
            const currentAudienceId = dynamicContext.audId || payload.id;

            // Bust action ID cache when deployment changes
            if (dynamicContext.dpl && this.cache.deploymentId && this.cache.deploymentId !== dynamicContext.dpl) {
                logger.warn(`[Vacuum] 🚀 Deployment changed (${this.cache.deploymentId} → ${dynamicContext.dpl}). Clearing action ID cache.`);
                this.cache.previewActionId = null;
                this.cache.generateActionId = null;
            }
            if (dynamicContext.dpl) this.cache.deploymentId = dynamicContext.dpl;

            logger.info(`[Vacuum] 📋 Using IDs - Slug: ${dynamicContext.accSlug}, Account: ${currentAccountId}, Audience: ${currentAudienceId}`);

            const preparedFilters = this.prepareFilters(payload.filters);

            let injectionBody;
            if (actionType === 'GENERATE') {
                injectionBody = [{
                    accountId: currentAccountId,
                    audienceId: currentAudienceId,
                    hasSegmentChanged: false, // Defaulting as per common portal behavior
                    resolveIntents: true,
                    filters: preparedFilters
                }];
            } else {
                injectionBody = [{
                    accountId: currentAccountId,
                    id: currentAudienceId,
                    filters: preparedFilters
                }];
            }

            // 4. ACTION ID RESOLUTION (with auto-discovery fallback)
            let targetActionId = actionType === 'PREVIEW'
                ? (this.cache.previewActionId || ACTION_IDS.PREVIEW)
                : (this.cache.generateActionId || ACTION_IDS.GENERATE);

            // 5. ROUTER STATE TREE HEURISTIC (with null,null padding at each level to match native format)
            const routerState = `["",{"children":["home",{"children":[["account","${dynamicContext.accSlug}","d"],{"children":["audience",{"children":[["id","${currentAudienceId}","d"],{"children":["__PAGE__",{},null,null]},null,null]},null,null]},null,null]},null,null]},null,null,true]`;

            // Inner injection function (reusable for retry with different action IDs)
            const doInjection = async (aid: string) => {
                return page.evaluate(async (aid: string, rst: string, body: any, csrf: string | null, dpl: string | null) => {
                    try {
                        const headers: Record<string, string> = {
                            'Accept': 'text/x-component',
                            'Next-Action': aid,
                            'Next-Router-State-Tree': encodeURIComponent(rst),
                            'Content-Type': 'text/plain;charset=UTF-8'
                        };

                        if (csrf) headers['x-csrf-token'] = csrf;
                        if (dpl) headers['x-deployment-id'] = dpl;

                        const requestUrl = window.location.href;
                        const requestBody = JSON.stringify(body);

                        const response = await fetch(requestUrl, {
                            method: 'POST',
                            headers,
                            body: requestBody
                        });

                        const text = await response.text();

                        // Capture response headers
                        const responseHeaders: Record<string, string> = {};
                        response.headers.forEach((v: string, k: string) => { responseHeaders[k] = v; });

                        if (!response.ok) {
                            return {
                                success: false,
                                status: response.status,
                                error: `HTTP ${response.status}`,
                                raw: text.substring(0, 1000),
                                trace: {
                                    requestUrl,
                                    requestMethod: 'POST',
                                    requestHeaders: headers,
                                    requestBody: body,
                                    responseStatus: response.status,
                                    responseHeaders,
                                    responseRaw: text
                                }
                            };
                        }

                        // RSC response parsing
                        let count = 0;
                        let preview: any[] = [];

                        // RSC format: line "1:" contains {"result":[...],"count":N}
                        const lines = text.split('\n');
                        for (const line of lines) {
                            const lineMatch = line.match(/^\d+:(.*)/);
                            if (!lineMatch) continue;
                            try {
                                const parsed = JSON.parse(lineMatch[1]);
                                if (parsed.count !== undefined) count = parsed.count;
                                if (Array.isArray(parsed.result)) preview = parsed.result;
                            } catch {}
                        }

                        // Fallback: regex count extraction if RSC parse missed it
                        if (count === 0) {
                            const countMatch = text.match(/"(?:count|total|totalCount)":(\d+)/);
                            if (countMatch) count = parseInt(countMatch[1]);
                        }

                        return {
                            success: true,
                            status: response.status,
                            data: {
                                count,
                                preview: preview.slice(0, 500),
                                fullCount: count
                            },
                            raw: text.substring(0, 2000),
                            trace: {
                                requestUrl,
                                requestMethod: 'POST',
                                requestHeaders: headers,
                                requestBody: body,
                                responseStatus: response.status,
                                responseHeaders,
                                responseRaw: text
                            }
                        };
                    } catch (e: any) {
                        return { success: false, error: e.message };
                    }
                }, aid, routerState, injectionBody, dynamicContext.csrf, dynamicContext.dpl);
            };

            // Helper: save network trace to disk
            const saveTrace = (result: any) => {
                if (!result.trace) return;
                const traceDir = path.resolve(__dirname, '..', '..', '..', 'docs', 'provider-traces');
                try {
                    if (!fs.existsSync(traceDir)) fs.mkdirSync(traceDir, { recursive: true });
                    const traceFile = path.join(traceDir, `${new Date().toISOString().replace(/[:]/g, '-')}-vacuum-${actionType.toLowerCase()}.json`);
                    const traceData = {
                        meta: {
                            capturedAt: new Date().toISOString(),
                            actionType,
                            source: 'vacuum-engine',
                            audienceId: currentAudienceId,
                            accountId: currentAccountId,
                            accountSlug: dynamicContext.accSlug
                        },
                        request: {
                            url: result.trace.requestUrl,
                            method: result.trace.requestMethod,
                            headers: result.trace.requestHeaders,
                            body: result.trace.requestBody
                        },
                        response: {
                            status: result.trace.responseStatus,
                            headers: result.trace.responseHeaders,
                            raw: result.trace.responseRaw
                        }
                    };
                    fs.writeFileSync(traceFile, JSON.stringify(traceData, null, 2));
                    logger.info(`[Vacuum] Network trace saved to ${traceFile}`);
                } catch (traceErr: any) {
                    logger.warn(`[Vacuum] Failed to save trace: ${traceErr.message}`);
                }
            };

            // 6. INJECTION WITH AUTO-DISCOVERY RETRY
            logger.info(`🚀 [Vacuum] Injecting ${actionType} (Action: ${targetActionId})...`);
            let result = await doInjection(targetActionId);
            saveTrace(result);

            // If 404 or 500 with RSC error → stale action ID (deployment changed) → auto-discover fresh one
            const isStaleActionId = !result.success && (
                result.status === 404 ||
                (result.status === 500 && typeof result.raw === 'string' && result.raw.includes('1:E{'))
            );
            if (isStaleActionId) {
                logger.warn(`[Vacuum] ⚠️ ${actionType} got ${result.status} — stale action ID. Auto-discovering fresh ID...`);
                try {
                    const discovered = await this.discoverHeaders(page, actionType);
                    targetActionId = discovered.actionId;
                    logger.info(`[Vacuum] 🔄 Retrying ${actionType} with fresh action ID: ${targetActionId}`);
                    result = await doInjection(targetActionId);
                    saveTrace(result);
                } catch (discoverErr: any) {
                    logger.error(`[Vacuum] ❌ Auto-discovery failed: ${discoverErr.message}`);
                    // Fall through to the error handling below with the original 404 result
                }
            }

            if (!result.success) {
                logger.error(`[Vacuum] ${actionType} Injection Failed: ${result.error}`, { raw: result.raw });
                throw new Error(`${actionType} Injection Failed: ${result.error}`);
            }

            logger.info(`[Vacuum] ${actionType} Success. Count: ${result.data?.count}`);
            return result;

        } catch (err: any) {
            logger.error(`[Vacuum] ${actionType} Error:`, err.message);
            throw err;
        }
    }

    // --- PUBLIC API ---



    static async preview(payload: AudiencePayload) {
        return this.executeInjection(payload, 'PREVIEW');
    }

    static async generate(payload: AudiencePayload) {
        return this.executeInjection(payload, 'GENERATE');
    }

    /**
     * Phase 4: Status Monitoring
     */
    /**
     * Navigate to an audience's edit page by searching for it by name.
     * Does NOT press Generate. Safe for read-only exploration.
     */
    static async navigateToAudience(name: string) {
        const { page } = await this.getSession();

        // Ensure we're on the dashboard
        const currentUrl = page.url();
        const dashboardUrl = `${this.BASE_URL}/home/${this.WORKSPACE_SLUG}`;
        if (!currentUrl.startsWith(dashboardUrl) || currentUrl.includes('/audience/')) {
            logger.info(`[Vacuum] Navigating to dashboard for search...`);
            await page.goto(dashboardUrl, { waitUntil: 'load', timeout: 30000 });
        }

        // Dismiss any open modal (press Escape)
        await page.keyboard.press('Escape');
        await page.waitForTimeout(500);

        // Search for the audience by name
        const searchInput = '/html/body/div[2]/div/div[2]/div[2]/div[2]/div/div[1]/div/input';
        logger.info(`[Vacuum] Searching for audience: "${name}"`);
        await page.waitForSelector('::-p-xpath(' + searchInput + ')', { visible: true, timeout: 10000 });

        // Clear existing search text and type new name
        await page.evaluate((xpath: string) => {
            const result = document.evaluate(xpath, document, null, 9, null);
            const input = result.singleNodeValue as HTMLInputElement;
            if (input) { input.value = ''; input.dispatchEvent(new Event('input', { bubbles: true })); }
        }, searchInput);
        await page.waitForTimeout(300);

        // Type the search query
        const inputEl = await page.waitForSelector('::-p-xpath(' + searchInput + ')');
        await inputEl.click({ clickCount: 3 }); // Select all existing text
        await inputEl.type(name, { delay: 30 });
        await page.waitForTimeout(1500); // Wait for search results to filter

        // Click the edit button on the first row
        const editButton = '/html/body/div[2]/div/div[2]/div[2]/div[2]/div/div[2]/div[1]/table/tbody/tr[1]/td[8]/div/a[1]';
        logger.info(`[Vacuum] Clicking edit button for first result...`);

        await Promise.all([
            page.waitForNavigation({ waitUntil: 'load', timeout: 30000 }),
            page.evaluate((xpath: string) => {
                const result = document.evaluate(xpath, document, null, 9, null);
                const el = result.singleNodeValue as HTMLElement;
                if (el) el.click();
                else throw new Error('Edit button not found');
            }, editButton)
        ]);

        const newUrl = page.url();
        logger.info(`[Vacuum] Navigated to audience edit: ${newUrl}`);

        // Extract audience ID from URL
        const match = newUrl.match(/\/audience\/([^\/\?]+)/);
        const audienceId = match ? match[1] : null;

        return { success: true, url: newUrl, audienceId };
    }

    /**
     * Take a screenshot of the current Puppeteer page
     */
    static async screenshot(filename?: string) {
        const { page } = await this.getSession();
        const screenshotDir = path.resolve(process.cwd(), 'logs', 'screenshots');
        if (!fs.existsSync(screenshotDir)) fs.mkdirSync(screenshotDir, { recursive: true });
        const file = path.join(screenshotDir, filename || `screenshot-${Date.now()}.png`);
        await page.screenshot({ path: file, fullPage: true });
        logger.info(`[Vacuum] Screenshot saved: ${file}`);
        return { success: true, path: file };
    }

    /**
     * Get full page DOM snapshot (text content, buttons, links, inputs visible)
     */
    static async getPageSnapshot() {
        const { page } = await this.getSession();
        const snapshot = await page.evaluate(() => {
            const url = window.location.href;
            const title = document.title;

            // Get all visible buttons
            const buttons = Array.from(document.querySelectorAll('button'))
                .filter(b => b.offsetParent !== null)
                .map(b => ({ text: b.textContent?.trim(), classes: b.className }));

            // Get all visible links
            const links = Array.from(document.querySelectorAll('a'))
                .filter(a => a.offsetParent !== null)
                .map(a => ({ text: a.textContent?.trim(), href: a.getAttribute('href') }));

            // Get all visible inputs
            const inputs = Array.from(document.querySelectorAll('input, select, textarea'))
                .filter(i => (i as HTMLElement).offsetParent !== null)
                .map(i => ({
                    tag: i.tagName,
                    type: i.getAttribute('type'),
                    name: i.getAttribute('name'),
                    placeholder: i.getAttribute('placeholder'),
                    value: (i as HTMLInputElement).value
                }));

            // Get tab-like elements (for segments)
            const tabs = Array.from(document.querySelectorAll('[role="tab"], [data-state], .tab, [class*="tab"]'))
                .map(t => ({ text: (t as HTMLElement).textContent?.trim(), classes: (t as HTMLElement).className, state: t.getAttribute('data-state') }));

            // Get table headers if any
            const tableHeaders = Array.from(document.querySelectorAll('th'))
                .map(th => th.textContent?.trim());

            return { url, title, buttons: buttons.slice(0, 50), links: links.slice(0, 50), inputs: inputs.slice(0, 30), tabs: tabs.slice(0, 30), tableHeaders };
        });

        return snapshot;
    }

    static async checkStatus(audienceName: string) {
        const { page } = await this.getSession();

        try {
            // Jump to Dashboard (where segments are listed)
            await this.catchUp(VacuumPhase.ACCOUNT_SET);

            // Wait for audience row
            const rowSelector = this.SELECTORS.AUDIENCE_ROW(audienceName);
            console.log(`[Vacuum] Checking status for row: ${audienceName}`);

            await page.waitForSelector(rowSelector, { timeout: 10000 });

            // Extract status text from row
            const status = await page.evaluate((selector) => {
                try {
                    const s = selector.startsWith('xpath:') ? selector.substring(6) : selector;
                    const doc = document;
                    const row = doc.evaluate(s, doc, null, 9, null).singleNodeValue;
                    if (!row) return 'NOT_FOUND';

                    const text = row.innerText;
                    if (text.includes('Processing')) return 'PROCESSING';
                    if (text.includes('Completed')) return 'COMPLETED';
                    if (text.includes('Failed')) return 'FAILED';
                    if (text.includes('Active')) return 'ACTIVE';
                    if (text.includes('Queued')) return 'QUEUED';

                    return 'UNKNOWN';
                } catch (e) { return 'ERROR'; }
            }, rowSelector);

            console.log(`[Vacuum] Status found: ${status}`);
            return { status };
        } catch (err: any) {
            console.error('[Vacuum] Status check failed:', err.message);
            throw err;
        }
    }
}