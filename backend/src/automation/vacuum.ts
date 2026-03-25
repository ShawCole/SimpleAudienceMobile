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
    CREATE_AUDIENCE: "7f6511f2963792b67a0b1696484be2bc032e617be0",
    EXPORT_CSV: "7f363cd62fa8f404dea17c964a943548c33f48d96f",
    SAVE_SEGMENT: "7f69e0fb84999ede7adb06dab9a09fe86476d84abe"
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
            const isHeadless = process.env.HEADLESS === 'true';
            const execPath = process.env.PUPPETEER_EXECUTABLE_PATH
                || (process.platform === 'darwin'
                    ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
                    : '/usr/bin/chromium');
            logger.info(`[Vacuum] 🛠️ Launching ${isHeadless ? 'Headless' : 'Headed'} Browser (${execPath})...`);
            this.browser = await puppeteer.launch({
                executablePath: execPath,
                headless: isHeadless ? 'new' : false,
                args: [
                    '--no-sandbox', '--disable-setuid-sandbox', '--window-size=1280,1024',
                    ...(isHeadless ? ['--disable-gpu', '--disable-dev-shm-usage', '--disable-software-rasterizer'] : [])
                ],
                timeout: 60000,
                defaultViewport: isHeadless ? { width: 1280, height: 1024 } : null
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
                    await page.goto(`${this.BASE_URL}/home/${this.WORKSPACE_SLUG}`, { waitUntil: 'load', timeout: 60000 });
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
                    }, { timeout: 60000 });
                } catch (err: any) {
                    logger.warn(`⚠️ [Vacuum] Direct jump failed, falling back to click: ${err.message}`);
                    await page.waitForSelector(this.SELECTORS.ACCOUNT_CARD, { timeout: 10000 });
                    logger.info(`🚀 [Vacuum] CLICKING: Account Card (${this.WORKSPACE_SLUG})`);
                    await Promise.all([
                        page.waitForNavigation({ waitUntil: 'load', timeout: 60000 }),
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
                    await page.goto(audienceUrl, { waitUntil: 'load', timeout: 60000 });

                    // Self-healing check
                    const isOuch = await page.evaluate(() => document.body.innerText.includes('Ouch!'));
                    if (isOuch) {
                        logStep('Hit Ouch! page. Attempting recovery reload...');
                        await page.reload({ waitUntil: 'load' });
                    }
                }

                // Extract accountId if not already in context (critical for injection)
                if (!this.currentContext?.accountId) {
                    logStep('Extracting accountId from page after direct jump...');
                    const accountId = await this.getAccountUuidFromPage(page) || await this.extractAccountIdFromUrl(page);
                    if (accountId) {
                        this.currentContext = { ...this.currentContext, accountId, audienceId: context.id };
                        logStep(`Captured accountId: ${accountId}`);
                    } else {
                        logStep('⚠️ Could not extract accountId from page');
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
                    await page.goto(`${this.BASE_URL}/auth/sign-in`, { waitUntil: 'load', timeout: 60000 });

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
                            page.waitForNavigation({ waitUntil: 'load', timeout: 60000 }),
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
                    await page.goto(dashboardUrl, { waitUntil: 'load', timeout: 60000 });
                }

                // Wait for dashboard content to load
                logger.info('[Vacuum] ⏳ Waiting for dashboard content...');
                await page.waitForFunction(() => {
                    const btns = Array.from(document.querySelectorAll('button'));
                    const createBtn = btns.some(b => b.textContent?.trim().includes('Create') && b.offsetParent !== null);
                    const rows = document.querySelectorAll('tr');
                    return createBtn || rows.length > 5;
                }, { timeout: 60000 });

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
        }, { timeout: 60000 });
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
            page.waitForNavigation({ waitUntil: 'load', timeout: 60000 }),
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
                    page.waitForNavigation({ waitUntil: 'load', timeout: 60000 }),
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
            await page.goto(dashboardUrl, { waitUntil: 'load', timeout: 60000 });
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
            page.waitForNavigation({ waitUntil: 'load', timeout: 60000 }),
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
                    if (text.includes('Hydrating')) return 'HYDRATING';
                    if (text.includes('Processing')) return 'PROCESSING';
                    if (text.includes('Completed')) return 'COMPLETED';
                    if (text.includes('Failed')) return 'FAILED';
                    if (text.includes('Active')) return 'ACTIVE';
                    if (text.includes('Queued')) return 'QUEUED';
                    if (text.includes('Generating')) return 'GENERATING';

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

    /**
     * Poll status for a specific audience by name until it reaches a terminal state.
     * Handles the IntentCore lifecycle: Generating → Hydrating → Completed
     */
    static async pollUntilComplete(audienceName: string, timeoutMs: number = 600000, pollIntervalMs: number = 5000): Promise<{ status: string }> {
        const start = Date.now();
        const terminalStates = ['COMPLETED', 'FAILED', 'ACTIVE', 'ERROR'];

        while (Date.now() - start < timeoutMs) {
            try {
                const result = await this.checkStatus(audienceName);
                console.log(`[Vacuum] Poll: ${audienceName} → ${result.status} (${Math.round((Date.now() - start) / 1000)}s)`);

                if (terminalStates.includes(result.status)) {
                    return result;
                }
            } catch (err: any) {
                console.error(`[Vacuum] Poll error (will retry): ${err.message}`);
            }

            await new Promise(r => setTimeout(r, pollIntervalMs));
        }

        throw new Error(`Timed out waiting for audience "${audienceName}" after ${timeoutMs / 1000}s`);
    }

    /**
     * Export a generated audience as CSV from IntentCore Studio.
     *
     * CRITICAL FLOW:
     * 1. Audience must already be "Completed" on IntentCore
     * 2. Page MUST be reloaded after Completed status (download modal not available otherwise)
     * 3. Navigate to Studio with audience UUID
     * 4. Wait for data to load
     * 5. Fire EXPORT_CSV server action
     * 6. Parse GCS URL from RSC response
     * 7. Return the download URL
     */
    static async exportAudience(audienceId: string): Promise<{ success: boolean; csvUrl?: string; error?: string }> {
        const { page } = await this.getSession();
        const ACCOUNT_ID = 'fceffb3b-552d-413a-9442-e62e9d423aa0';

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

        try {
            // Ensure we're logged in and on the account dashboard
            await this.catchUp(VacuumPhase.ACCOUNT_SET);

            // Navigate to Studio for this audience (AFTER reload — critical for download availability)
            const studioUrl = `${this.BASE_URL}/home/${this.WORKSPACE_SLUG}/studio?audience=${audienceId}`;
            console.log(`[Vacuum Export] Navigating to studio: ${studioUrl}`);
            await page.goto(studioUrl, { waitUntil: 'networkidle2', timeout: 60000 });
            await new Promise(r => setTimeout(r, 2000));

            // Wait for data to load — poll for "Loading Data" to disappear and row count > 0
            console.log('[Vacuum Export] Waiting for studio data to load...');
            const maxWait = 300000; // 5 minutes
            const pollInterval = 2000;
            const startWait = Date.now();

            while (Date.now() - startWait < maxWait) {
                const loadStatus = await page.evaluate(() => {
                    // Search for any element containing "Loading Data" text
                    const allText = document.body?.innerText || '';
                    const isLoading = allText.includes('Loading Data') || allText.includes('loading');
                    // Look for a row count number
                    const rowMatch = allText.match(/Total\s*Rows[:\s]*\n?\s*([\d,]+)/i);
                    const rowCount = rowMatch ? parseInt(rowMatch[1].replace(/,/g, '')) : 0;
                    return { isLoading, rowCount };
                });

                if (!loadStatus.isLoading && loadStatus.rowCount > 0) {
                    console.log(`[Vacuum Export] Data loaded. Total rows: ${loadStatus.rowCount.toLocaleString()}`);
                    break;
                }

                const elapsed = Math.round((Date.now() - startWait) / 1000);
                console.log(`[Vacuum Export] Still loading... (${elapsed}s) loading=${loadStatus.isLoading} rows=${loadStatus.rowCount}`);
                await new Promise(r => setTimeout(r, pollInterval));
            }

            if (Date.now() - startWait >= maxWait) {
                return { success: false, error: 'Timed out waiting for studio data to load' };
            }

            // Detect deployment ID
            const deploymentId = await page.evaluate(() => {
                const html = document.documentElement.outerHTML;
                const m = html.match(/dpl_[A-Za-z0-9]+/);
                return m ? m[0] : null;
            });

            if (!deploymentId) {
                return { success: false, error: 'Could not detect deployment ID' };
            }
            console.log(`[Vacuum Export] Deployment ID: ${deploymentId}`);

            // Build export payload
            const pathname = `/home/${this.WORKSPACE_SLUG}/studio?audience=${audienceId}`;
            const exportPayload = [{
                audienceId: audienceId,
                accountId: ACCOUNT_ID,
                filters: { id: "root", operator: "AND", rules: [] },
                selectedFields: SELECTED_FIELDS,
                onlyFirstValueFields: [],
                format: "csv",
            }];

            // Fire EXPORT_CSV server action with retry
            const maxRetries = 6;
            const retryDelay = 15000;
            let lastResult: any = null;

            for (let attempt = 1; attempt <= maxRetries; attempt++) {
                console.log(`[Vacuum Export] Export attempt ${attempt}/${maxRetries}...`);

                const result = await page.evaluate(async (pn: string, actionId: string, payload: any, depId: string) => {
                    try {
                        const res = await fetch(pn, {
                            method: 'POST',
                            headers: {
                                'accept': 'text/x-component',
                                'content-type': 'text/plain;charset=UTF-8',
                                'next-action': actionId,
                                'x-deployment-id': depId,
                            },
                            body: JSON.stringify(payload),
                        });
                        const text = await res.text();
                        return { status: res.status, ok: res.ok, text };
                    } catch (e: any) {
                        return { error: e.message };
                    }
                }, pathname, ACTION_IDS.EXPORT_CSV, exportPayload, deploymentId);

                lastResult = result;
                console.log(`[Vacuum Export] Attempt ${attempt} → status: ${result.status || 'error'}`);

                if (result.ok) break;

                if (result.status === 404) {
                    return { success: false, error: 'Export action ID stale (404). Need to re-capture from DevTools.' };
                }

                if (attempt < maxRetries) {
                    console.log(`[Vacuum Export] Server not ready — retrying in ${retryDelay / 1000}s...`);
                    await new Promise(r => setTimeout(r, retryDelay));
                }
            }

            if (!lastResult?.ok) {
                return { success: false, error: `Export failed after ${maxRetries} attempts: ${lastResult?.text?.substring(0, 200) || lastResult?.error}` };
            }

            // Parse GCS URL from RSC response
            const fileUrlMatch = lastResult.text?.match(/"fileUrl"\s*:\s*"([^"]+)"/);
            if (!fileUrlMatch) {
                return { success: false, error: `No fileUrl in response: ${lastResult.text?.substring(0, 300)}` };
            }

            const csvUrl = fileUrlMatch[1];
            console.log(`[Vacuum Export] CSV URL: ${csvUrl}`);

            return { success: true, csvUrl };
        } catch (err: any) {
            console.error('[Vacuum Export] Failed:', err.message);
            return { success: false, error: err.message };
        }
    }

    /**
     * COMPLETE POST-GENERATION RETRIEVAL FLOW
     *
     * After an audience has been generated on IntentCore, this method:
     * 1. Navigate to the audience LIST page (/home/simple-audience)
     * 2. Find the audience row BY NAME in the table
     * 3. Poll its status until "Completed" (handles Hydrating, Processing, etc.)
     * 4. REFRESH the page (critical — download modal won't work without this)
     * 5. Navigate to Studio page for this audience
     * 6. Wait for Studio data to load
     * 7. Fire EXPORT_CSV server action
     * 8. Parse GCS download URL from response
     * 9. Return the URL
     *
     * @param audienceName — The exact name to search for in the list table
     * @param intentcoreId — The IntentCore audience UUID (for Studio navigation)
     * @param timeoutMs — Max time to wait for Completed status (default 10 min)
     */
    static async retrieveGeneratedCSV(
        audienceName: string,
        intentcoreId: string,
        timeoutMs: number = 600000
    ): Promise<{ success: boolean; csvUrl?: string; status?: string; error?: string }> {
        const { page } = await this.getSession();
        const ACCOUNT_ID = 'fceffb3b-552d-413a-9442-e62e9d423aa0';
        const listUrl = `${this.BASE_URL}/home/${this.WORKSPACE_SLUG}`;
        const studioUrl = `${this.BASE_URL}/home/${this.WORKSPACE_SLUG}/studio?audience=${intentcoreId}`;

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

        try {
            // ═══════════════════════════════════════════════════
            // STEP 1: Navigate to audience list page
            // ═══════════════════════════════════════════════════
            console.log(`[Retrieve] Step 1: Navigating to audience list: ${listUrl}`);
            await page.goto(listUrl, { waitUntil: 'load', timeout: 60000 });
            await new Promise(r => setTimeout(r, 2000));

            // Wait for the table to appear
            await page.waitForFunction(() => {
                return document.querySelectorAll('tr').length > 1 ||
                       document.querySelector('table') !== null;
            }, { timeout: 15000 }).catch(() => {
                console.log('[Retrieve] Warning: Table not found immediately, continuing...');
            });

            // ═══════════════════════════════════════════════════
            // STEP 2: Find audience row by name and poll status
            // ═══════════════════════════════════════════════════
            console.log(`[Retrieve] Step 2: Polling status for "${audienceName}"...`);
            const rowXPath = `//tr[contains(., "${audienceName}")]`;
            const startPoll = Date.now();
            let lastStatus = 'UNKNOWN';

            while (Date.now() - startPoll < timeoutMs) {
                const statusText = await page.evaluate((xpath: string) => {
                    try {
                        const result = document.evaluate(xpath, document, null, 9, null);
                        const row = result.singleNodeValue as HTMLElement | null;
                        if (!row) return 'ROW_NOT_FOUND';
                        const text = row.innerText || '';
                        // Extract status from row text
                        if (text.includes('Completed') || text.includes('completed')) return 'COMPLETED';
                        if (text.includes('Hydrating') || text.includes('hydrating')) return 'HYDRATING';
                        if (text.includes('Processing') || text.includes('processing')) return 'PROCESSING';
                        if (text.includes('Generating') || text.includes('generating')) return 'GENERATING';
                        if (text.includes('Failed') || text.includes('failed')) return 'FAILED';
                        if (text.includes('Active') || text.includes('active')) return 'ACTIVE';
                        if (text.includes('Queued') || text.includes('queued')) return 'QUEUED';
                        return 'UNKNOWN: ' + text.substring(0, 100);
                    } catch (e: any) {
                        return 'ERROR: ' + e.message;
                    }
                }, rowXPath);

                lastStatus = statusText;
                const elapsed = Math.round((Date.now() - startPoll) / 1000);
                console.log(`[Retrieve] [${elapsed}s] Status: ${statusText}`);

                if (statusText === 'COMPLETED' || statusText === 'ACTIVE') {
                    console.log(`[Retrieve] Step 2 done: audience is ${statusText}`);
                    break;
                }

                if (statusText === 'FAILED') {
                    return { success: false, status: 'FAILED', error: 'IntentCore generation failed' };
                }

                // Wait 5 seconds then reload the page to get fresh status
                await new Promise(r => setTimeout(r, 5000));
                await page.reload({ waitUntil: 'load', timeout: 60000 });
                await new Promise(r => setTimeout(r, 2000));
            }

            if (lastStatus !== 'COMPLETED' && lastStatus !== 'ACTIVE') {
                return { success: false, status: lastStatus, error: `Timed out waiting for Completed (last: ${lastStatus})` };
            }

            // ═══════════════════════════════════════════════════
            // STEP 3: REFRESH the page (critical for download)
            // ═══════════════════════════════════════════════════
            console.log('[Retrieve] Step 3: Refreshing page (required for download modal)...');
            await page.reload({ waitUntil: 'load', timeout: 60000 });
            await new Promise(r => setTimeout(r, 3000));

            // ═══════════════════════════════════════════════════
            // STEP 4: Navigate to Studio for this audience
            // ═══════════════════════════════════════════════════
            console.log(`[Retrieve] Step 4: Navigating to Studio: ${studioUrl}`);
            await page.goto(studioUrl, { waitUntil: 'networkidle2', timeout: 60000 });
            await new Promise(r => setTimeout(r, 2000));

            // ═══════════════════════════════════════════════════
            // STEP 5: Wait for Studio data to load
            // ═══════════════════════════════════════════════════
            console.log('[Retrieve] Step 5: Waiting for Studio data...');
            const maxDataWait = 300000; // 5 min
            const dataStart = Date.now();

            while (Date.now() - dataStart < maxDataWait) {
                const loadStatus = await page.evaluate(() => {
                    const allText = document.body?.innerText || '';
                    const isLoading = allText.toLowerCase().includes('loading data');
                    const rowMatch = allText.match(/Total\s*Rows[:\s]*\n?\s*([\d,]+)/i);
                    const rowCount = rowMatch ? parseInt(rowMatch[1].replace(/,/g, '')) : 0;
                    return { isLoading, rowCount };
                });

                if (!loadStatus.isLoading && loadStatus.rowCount > 0) {
                    console.log(`[Retrieve] Step 5 done: ${loadStatus.rowCount.toLocaleString()} rows loaded`);
                    break;
                }

                const elapsed = Math.round((Date.now() - dataStart) / 1000);
                if (elapsed % 10 === 0) {
                    console.log(`[Retrieve] Still loading Studio... (${elapsed}s) loading=${loadStatus.isLoading} rows=${loadStatus.rowCount}`);
                }
                await new Promise(r => setTimeout(r, 2000));
            }

            // ═══════════════════════════════════════════════════
            // STEP 6: Detect deployment ID
            // ═══════════════════════════════════════════════════
            const deploymentId = await page.evaluate(() => {
                const html = document.documentElement.outerHTML;
                const m = html.match(/dpl_[A-Za-z0-9]+/);
                return m ? m[0] : null;
            });

            if (!deploymentId) {
                return { success: false, error: 'Could not detect deployment ID on Studio page' };
            }
            console.log(`[Retrieve] Step 6: Deployment ID: ${deploymentId}`);

            // ═══════════════════════════════════════════════════
            // STEP 7: Fire EXPORT_CSV server action
            // ═══════════════════════════════════════════════════
            console.log('[Retrieve] Step 7: Firing CSV export...');
            const pathname = `/home/${this.WORKSPACE_SLUG}/studio?audience=${intentcoreId}`;
            const exportPayload = [{
                audienceId: intentcoreId,
                accountId: ACCOUNT_ID,
                filters: { id: "root", operator: "AND", rules: [] },
                selectedFields: SELECTED_FIELDS,
                onlyFirstValueFields: [],
                format: "csv",
            }];

            const maxRetries = 6;
            const retryDelay = 15000;
            let lastResult: any = null;

            for (let attempt = 1; attempt <= maxRetries; attempt++) {
                console.log(`[Retrieve] Export attempt ${attempt}/${maxRetries}...`);

                const result = await page.evaluate(
                    async (pn: string, actionId: string, payload: any, depId: string) => {
                        try {
                            const res = await fetch(pn, {
                                method: 'POST',
                                headers: {
                                    'accept': 'text/x-component',
                                    'content-type': 'text/plain;charset=UTF-8',
                                    'next-action': actionId,
                                    'x-deployment-id': depId,
                                },
                                body: JSON.stringify(payload),
                            });
                            const text = await res.text();
                            return { status: res.status, ok: res.ok, text };
                        } catch (e: any) {
                            return { error: e.message };
                        }
                    },
                    pathname,
                    ACTION_IDS.EXPORT_CSV,
                    exportPayload,
                    deploymentId
                );

                lastResult = result;
                console.log(`[Retrieve] Attempt ${attempt} → status: ${result.status || 'error'}`);

                if (result.ok) break;

                if (result.status === 404 && attempt === 1) {
                    // Auto-discover fresh export action ID by scanning page JS for action IDs
                    console.log('[Retrieve] Export action ID stale (404). Scanning page source for action IDs...');
                    try {
                        // Scan all script elements and inline JS for 7f-prefixed hex strings (action IDs)
                        const candidates = await page.evaluate(() => {
                            const ids = new Set<string>();
                            // Scan all script tags
                            document.querySelectorAll('script').forEach(s => {
                                const text = s.textContent || '';
                                const matches = text.matchAll(/["']?(7f[0-9a-f]{38,48})["']?/g);
                                for (const m of matches) ids.add(m[1]);
                            });
                            // Also scan __next_f data
                            if ((window as any).__next_f) {
                                const nf = JSON.stringify((window as any).__next_f);
                                const matches = nf.matchAll(/7f[0-9a-f]{38,48}/g);
                                for (const m of matches) ids.add(m[0]);
                            }
                            return [...ids];
                        });

                        console.log(`[Retrieve] Found ${candidates.length} candidate action IDs: ${candidates.join(', ')}`);

                        // Filter out known IDs (preview, generate, create) — remaining ones are likely export/segment
                        const knownIds = new Set([ACTION_IDS.PREVIEW, ACTION_IDS.GENERATE, ACTION_IDS.CREATE_AUDIENCE, ACTION_IDS.SAVE_SEGMENT]);
                        const unknownIds = candidates.filter(id => !knownIds.has(id));
                        console.log(`[Retrieve] Unknown action IDs (potential export): ${unknownIds.join(', ')}`);

                        // Try each unknown ID
                        for (const candidateId of unknownIds) {
                            console.log(`[Retrieve] Trying candidate: ${candidateId}`);
                            const tryResult = await page.evaluate(
                                async (pn: string, actionId: string, payload: any, depId: string) => {
                                    try {
                                        const res = await fetch(pn, {
                                            method: 'POST',
                                            headers: {
                                                'accept': 'text/x-component',
                                                'content-type': 'text/plain;charset=UTF-8',
                                                'next-action': actionId,
                                                'x-deployment-id': depId,
                                            },
                                            body: JSON.stringify(payload),
                                        });
                                        return { status: res.status, ok: res.ok, text: (await res.text()).substring(0, 200) };
                                    } catch (e: any) { return { error: e.message }; }
                                },
                                pathname, candidateId, exportPayload, deploymentId
                            );

                            if (tryResult.ok || (tryResult.status && tryResult.status < 404)) {
                                console.log(`[Retrieve] Found working export action ID: ${candidateId}`);
                                (ACTION_IDS as any).EXPORT_CSV = candidateId;
                                lastResult = tryResult;
                                break;
                            }
                            console.log(`[Retrieve] Candidate ${candidateId} returned ${tryResult.status}`);
                        }

                        if (lastResult?.ok) break; // Exit retry loop with success
                    } catch (discErr: any) {
                        console.log(`[Retrieve] Auto-discovery failed: ${discErr.message}`);
                    }
                    if (!lastResult?.ok) {
                        return { success: false, error: 'Export action ID stale (404) and auto-discovery failed.' };
                    }
                } else if (result.status === 404) {
                    return { success: false, error: 'Export action ID stale (404).' };
                }

                if (attempt < maxRetries) {
                    console.log(`[Retrieve] Server not ready — retrying in ${retryDelay / 1000}s...`);
                    await new Promise(r => setTimeout(r, retryDelay));
                }
            }

            if (!lastResult?.ok) {
                return { success: false, error: `Export failed: ${lastResult?.text?.substring(0, 200) || lastResult?.error}` };
            }

            // ═══════════════════════════════════════════════════
            // STEP 8: Parse GCS URL from RSC response
            // ═══════════════════════════════════════════════════
            const fileUrlMatch = lastResult.text?.match(/"fileUrl"\s*:\s*"([^"]+)"/);
            if (!fileUrlMatch) {
                return { success: false, error: `No fileUrl in export response: ${lastResult.text?.substring(0, 300)}` };
            }

            const csvUrl = fileUrlMatch[1];
            console.log(`[Retrieve] Step 8 done: CSV URL obtained`);
            console.log(`[Retrieve] ✅ RETRIEVAL COMPLETE`);

            return { success: true, csvUrl, status: 'COMPLETED' };

        } catch (err: any) {
            console.error(`[Retrieve] FAILED: ${err.message}`);
            return { success: false, error: err.message };
        }
    }
}