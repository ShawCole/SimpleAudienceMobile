import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { AudiencePayload } from '@shared/types/audience-payload';
import logger from '../utils/logger';

puppeteer.use(StealthPlugin());

// Action IDs
const ACTION_IDS = {
    PREVIEW: "7f7f8f7985fc40c758292e808ba764826e0651d70c",
    GENERATE: "7f8333d47deaa609d85bbe9e6f643ef0bb6f85b2dc",
    CREATE_AUDIENCE: "7f1b35a65f18ae14fda8ce71ff232cbccaba10029c"
};

// Phase Definitions
export enum VacuumPhase {
    IDLE = 0,
    AUTHED = 1,           // Logged in
    ACCOUNT_SET = 2,      // Account (BizyPro) selected
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
}

export class VacuumEngine {
    private static browser: any | null = null;
    private static page: any | null = null;
    private static debug = process.env.DEBUG === 'true' || true;
    private static prewarmingPromise: Promise<any> | null = null;

    private static cache: DiscoveryCache = {
        previewActionId: null,
        generateActionId: null,
        routerStateTree: null
    };

    private static currentPhase: VacuumPhase = VacuumPhase.IDLE;
    private static currentContext: any = {};

    // Robust Selectors
    private static SELECTORS = {
        ACCOUNT_CARD: '//a[contains(@href, "/home/bizypro") or contains(., "BizyPro")] | //div[contains(., "BizyPro") and (contains(@class, "card") or @role="button")]',
        // User provided exact path: /html/body/div[2]/div/div[2]/div[2]/div[2]/div[2]/button
        DASHBOARD_CREATE_BUTTON: 'xpath://button[contains(normalize-space(), "Create")]',
        NAMING_MODAL: 'xpath://div[@role="dialog"] | //div[contains(@id, "radix-")] | //div[contains(@class, "modal") and (contains(., "Create Audience") or contains(., "New Audience"))]',
        NAMING_INPUT: 'input[id$="-form-item"], xpath://label[text()="Name"]/following-sibling::input',
        NAMING_SUBMIT: 'button.bg-primary, xpath://div[@role="dialog"]//button[normalize-space()="Create"]',
        PREVIEW_BUTTON: 'xpath://button[contains(., "Refresh Preview") or contains(., "Run Preview")]',
        GENERATE_BUTTON: 'xpath://button[contains(., "Order") or contains(., "Export") or contains(., "Process")]',
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

            // 2. Click while listening for the next-action request
            // We use promise structure to ensure listener is active before click
            const [request] = await Promise.all([
                page.waitForRequest((req: any) => {
                    const hasAction = !!req.headers()['next-action'];
                    const isPost = req.method() === 'POST';
                    return isPost && hasAction;
                }, { timeout: 15000 }),
                (async () => {
                    logger.info(`[Vacuum] Waiting for button: ${selector}`);
                    await page.waitForTimeout(2000); // Give it a sec to settle

                    // Try to find and click via JS as fallback if standard click fails
                    const clicked = await page.evaluate((s) => {
                        const doc = document;
                        const isXpath = s.startsWith('//') || s.startsWith('(') || s.startsWith('xpath:');
                        const cleanS = s.startsWith('xpath:') ? s.substring(6) : s;

                        let el = null;
                        if (isXpath) {
                            el = doc.evaluate(cleanS, doc, null, 9, null).singleNodeValue;
                        } else {
                            el = doc.querySelector(s);
                        }

                        if (el && 'click' in el) {
                            (el as any).click();
                            return true;
                        }
                        return false;
                    }, selector);

                    if (!clicked) {
                        throw new Error(`Could not find or click button: ${selector}`);
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

        if (url.includes('sign-in') || !url.includes('audiencelab.io')) return VacuumPhase.IDLE;

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
            // /home/bizypro -> [https, , build.audiencelab.io, home, bizypro] -> length 5
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

        // Phase 2 -> Account Selected (BizyPro)
        if (current < VacuumPhase.ACCOUNT_SET && target >= VacuumPhase.ACCOUNT_SET) {
            const currentUrl = page.url();
            if (currentUrl.includes('/home/bizypro')) {
                logStep('Already on BizyPro account dashboard, skipping navigation.');
            } else {
                logStep(`Navigating to BizyPro account (Current URL: ${currentUrl})...`);
                try {
                    // Direct jump with immediate list detection
                    await page.goto('https://build.audiencelab.io/home/bizypro', { waitUntil: 'load', timeout: 30000 });
                    logger.info(`[Vacuum] Transitioned to ACCOUNT_SET. New URL: ${page.url()}`);

                    // Combined wait for either the Create button or an audience row
                    logStep('Waiting for dashboard content (List or Button)...');
                    await page.waitForFunction(`(selector) => {
                        const doc = document;
                        const isXpath = selector.startsWith('//') || selector.startsWith('(') || selector.startsWith('xpath:');
                        const s = selector.startsWith('xpath:') ? selector.substring(6) : selector;
                        
                        let btn = null;
                        if (isXpath) {
                            btn = doc.evaluate(s, doc, null, 9, null).singleNodeValue;
                        } else {
                            btn = doc.querySelector(s);
                        }
                        
                        const rows = doc.querySelectorAll('tr');
                        return !!btn || rows.length > 5;
                    }`, { timeout: 15000 }, this.SELECTORS.DASHBOARD_CREATE_BUTTON);
                } catch (err: any) {
                    logger.warn(`⚠️ [Vacuum] Direct jump failed, falling back to click: ${err.message}`);
                    await page.waitForSelector(this.SELECTORS.ACCOUNT_CARD, { timeout: 10000 });
                    logger.info('🚀 [Vacuum] CLICKING: Account Card (BizyPro)');
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
                const audienceUrl = `https://build.audiencelab.io/home/bizypro/audience/${context.id}`;
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
                if (!currentUrl.includes('audiencelab.io') || currentUrl.includes('sign-in')) {
                    logger.info('[Vacuum] 🧱 Not on site or on sign-in page, navigating to auth...');
                    await page.goto('https://build.audiencelab.io/auth/sign-in', { waitUntil: 'load', timeout: 30000 });

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

                logger.info('[Vacuum] Login/Navigation Complete. Transitioning to ACCOUNT_SET...');
                this.currentPhase = VacuumPhase.AUTHED;

                // Stop at Account Set to avoid the "Create" button hang during pre-warm
                await this.catchUp(VacuumPhase.ACCOUNT_SET);

                logger.info('--- VACUUM PREWARM SUCCESSFUL (MODAL OPEN) ---');
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
                new Promise((_, reject) => setTimeout(() => reject(new Error('Pre-warm Timeout (45s)')), 45000))
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
        await page.waitForSelector(this.SELECTORS.DASHBOARD_CREATE_BUTTON, { visible: true, timeout: 15000 });
        await page.waitForTimeout(200); // Minimal clicking buffer

        // Try standard click
        try {
            logger.info(`🚀 [Vacuum] CLICKING: "Create" Button (Standard)`);
            await page.click(this.SELECTORS.DASHBOARD_CREATE_BUTTON);
        } catch (e) {
            logger.warn('⚠️ [Vacuum] Standard click failed, attempting JS click fallback...');
            await page.evaluate((selector) => {
                const doc = document;
                const isXpath = selector.startsWith('//') || selector.startsWith('(') || selector.startsWith('xpath:');
                const s = selector.startsWith('xpath:') ? selector.substring(6) : selector;
                let el = null;
                if (isXpath) {
                    el = doc.evaluate(s, doc, null, 9, null).singleNodeValue;
                } else {
                    el = doc.querySelector(s);
                }
                if (el) el.click();
            }, this.SELECTORS.DASHBOARD_CREATE_BUTTON);
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
        await Promise.all([
            page.waitForNavigation({ waitUntil: 'load', timeout: 30000 }),
            page.click(this.SELECTORS.NAMING_SUBMIT)
        ]);

        logger.info('[Vacuum] 🎯 Audience created, now on Filters page.');
        this.currentPhase = VacuumPhase.AUDIENCE_FILTERS;

        // Context Capture
        const currentUrl = page.url();
        const parts = currentUrl.split('/');
        const audienceId = parts[parts.indexOf('audience') + 1];
        const accountId = '27e2bf65-59ba-4a31-b754-97a6652fe36d'; // TODO: Dynamic extraction
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
                const accountId = await this.getAccountUuidFromPage(page) || '27e2bf65-59ba-4a31-b754-97a6652fe36d';

                logTime(`Context ACTIVE. ID: ${audienceId}`);
                this.currentPhase = VacuumPhase.AUDIENCE_FILTERS;
                this.currentContext = { name, audienceId, accountId };
                return { accountId, audienceId };
            }

            logTime(`"${name}" not found. Proceeding with creation...`);

            // --- DYNAMIC DATA EXTRACTION ---
            logTime('Extracting dynamic context for injection...');
            const dynamicContext = await page.evaluate(() => {
                try {
                    // 1. Account ID
                    let accId = null;
                    if (typeof window !== 'undefined' && (window as any).__NEXT_DATA__) {
                        const pageProps = (window as any).__NEXT_DATA__?.props?.pageProps;
                        accId = pageProps?.account?.id || pageProps?.accountId || (window as any).__NEXT_DATA__?.query?.account;
                    }
                    if (!accId) {
                        const stored = localStorage.getItem('currentAccount');
                        if (stored) accId = JSON.parse(stored).id;
                    }

                    // 2. CSRF Token
                    let csrf = null;
                    const meta = document.querySelector('meta[name="csrf-token"]');
                    if (meta) csrf = meta.getAttribute('content');
                    if (!csrf) {
                        const match = document.cookie.match(/x-csrf-token=([^;]+)/);
                        if (match) csrf = match[1];
                    }

                    // 3. Deployment ID (Critical for Vercel/Next.js Actions)
                    let dpl = null;
                    const dplMatch = document.documentElement.outerHTML.match(/dpl_[a-zA-Z0-9]+/);
                    if (dplMatch) dpl = dplMatch[0];

                    return { accId, csrf, dpl };
                } catch (e) { return { accId: null, csrf: null, dpl: null }; }
            });

            const activeAccountId = dynamicContext.accId || '27e2bf65-59ba-4a31-b754-97a6652fe36d';
            logTime(`Using Account ID: ${activeAccountId}`);
            if (dynamicContext.dpl) logTime(`Using Deployment ID: ${dynamicContext.dpl}`);

            // --- DIRECT INJECTION: CREATE AUDIENCE ---
            logTime(`Injecting audience creation for "${name}"...`);

            const createResult = await page.evaluate(async (aid: string, audienceName: string, accId: string, csrfToken: string | null, dplId: string | null) => {
                const routerState = '["",{"children":["home",{"children":[["account","bizypro","d"],{"children":["__PAGE__",{},null,null]},null,null]},null,null]},null,null,true]';
                try {
                    const headers: Record<string, string> = {
                        'Accept': 'text/x-component',
                        'Next-Action': aid,
                        'Next-Router-State-Tree': encodeURIComponent(routerState),
                        'Content-Type': 'text/plain;charset=UTF-8'
                    };

                    if (csrfToken) headers['x-csrf-token'] = csrfToken;
                    if (dplId) headers['x-deployment-id'] = dplId;

                    const response = await fetch(window.location.href, {
                        method: 'POST',
                        headers,
                        body: JSON.stringify([{
                            accountId: accId,
                            name: audienceName
                        }])
                    });

                    const text = await response.text();

                    if (!response.ok) {
                        return { success: false, status: response.status, text: text.substring(0, 1000) };
                    }

                    // Look for the new audience UUID
                    const uuidMatch = text.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g);
                    // Filter out the account ID to find the actual audience ID
                    const newId = uuidMatch ? uuidMatch.find(id => id !== accId) || uuidMatch[uuidMatch.length - 1] : null;

                    return {
                        success: true,
                        status: response.status,
                        newId: newId,
                        text: text.substring(0, 2000) // Log more for diagnostics
                    };
                } catch (e: any) {
                    return { success: false, error: e.message };
                }
            }, ACTION_IDS.CREATE_AUDIENCE, name, activeAccountId, dynamicContext.csrf, dynamicContext.dpl);

            if (!createResult.success) {
                logger.error(`[Vacuum] Creation Failed Response: ${createResult.text}`);
                throw new Error(`Audience creation injection failed [Status ${createResult.status}]: ${createResult.error || 'Check backend logs for response text'}`);
            }

            // Diagnostic Log
            logTime(`Creation Response (Trancated): ${createResult.text?.substring(0, 300)}...`);

            if (createResult.newId) {
                logTime(`🎯 EXCEPTIONALLY SUCCESSFUL: Captured New ID: ${createResult.newId}`);
                const targetUrl = `https://build.audiencelab.io/home/bizypro/audience/${createResult.newId}`;
                logTime(`Navigating directly to filters: ${targetUrl}`);

                // Move immediately to the target URL
                await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });

                // Quick Ouch check
                const isOuch = await page.evaluate(() => document.body.innerText.includes('Ouch!'));
                if (isOuch) {
                    logTime('⚠️ Hit Ouch page. Refreshing...');
                    await page.reload({ waitUntil: 'domcontentloaded' });
                }

                this.currentPhase = VacuumPhase.READY;
                this.currentContext = { name, audienceId: createResult.newId, accountId: activeAccountId };
                return { accountId: activeAccountId, audienceId: createResult.newId };
            }

            logTime('ID not found in response. Falling back to dashboard refresh...');
            await page.goto('https://build.audiencelab.io/home/bizypro', { waitUntil: 'domcontentloaded', timeout: 30000 });

            const newRowSelector = this.SELECTORS.AUDIENCE_ROW(name);
            await page.waitForSelector(newRowSelector, { timeout: 15000 });

            await Promise.all([
                page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 30000 }),
                page.click(newRowSelector)
            ]);

            const newUrl = page.url();
            const parts = newUrl.split('/');
            const audienceId = parts[parts.indexOf('audience') + 1];
            const accountId = activeAccountId;

            this.currentPhase = VacuumPhase.READY;
            this.currentContext = { name, audienceId, accountId };

            return { accountId, audienceId };
        } catch (err: any) {
            logger.error(`[Vacuum] ❌ Init Audience Failed: ${err.message}`);
            throw err;
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
                    const accSlug = urlMatch ? urlMatch[1] : 'bizypro';
                    const audId = urlMatch ? urlMatch[2] : null;

                    return { csrf, dpl, accSlug, audId };
                } catch (e) { return { csrf: null, dpl: null, accSlug: 'bizypro', audId: null }; }
            });

            const currentAccountId = payload.accountId || '27e2bf65-59ba-4a31-b754-97a6652fe36d';
            const currentAudienceId = dynamicContext.audId || payload.id;

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

            // 4. ACTION ID RESOLUTION
            const targetActionId = actionType === 'PREVIEW'
                ? (this.cache.previewActionId || ACTION_IDS.PREVIEW)
                : (this.cache.generateActionId || ACTION_IDS.GENERATE);

            // 5. ROUTER STATE TREE HEURISTIC
            const routerState = `["",{"children":["home",{"children":[["account","${dynamicContext.accSlug}","d"],{"children":["audience",{"children":[["id","${currentAudienceId}","d"],{"children":["__PAGE__",{},null,null]}]}]}]}]},"null","null",true]`;

            logger.info(`🚀 [Vacuum] Injecting ${actionType} (Action: ${targetActionId})...`);

            const result = await page.evaluate(async (aid, rst, body, csrf, dpl) => {
                try {
                    const headers: Record<string, string> = {
                        'Accept': 'text/x-component',
                        'Next-Action': aid,
                        'Next-Router-State-Tree': encodeURIComponent(rst),
                        'Content-Type': 'text/plain;charset=UTF-8'
                    };

                    if (csrf) headers['x-csrf-token'] = csrf;
                    if (dpl) headers['x-deployment-id'] = dpl;

                    const response = await fetch(window.location.href, {
                        method: 'POST',
                        headers,
                        body: JSON.stringify(body)
                    });

                    const text = await response.text();

                    if (!response.ok) {
                        return { success: false, status: response.status, error: `HTTP ${response.status}`, raw: text.substring(0, 1000) };
                    }

                    // Simple Parsing Logic for RSC
                    // We look for common patterns in the response text
                    let count = 0;
                    let preview = [];

                    // Heuristic: Find count
                    const countMatch = text.match(/"(?:count|total|totalCount)":(\d+)/);
                    if (countMatch) count = parseInt(countMatch[1]);

                    // Heuristic: Find objects that look like preview records (sha256 is common)
                    const records = [];
                    const recordRegex = /\{"sha256":"[a-f0-9]+"[^}]+\}/g;
                    let m;
                    while ((m = recordRegex.exec(text)) !== null) {
                        try { records.push(JSON.parse(m[0])); } catch (e) { }
                    }
                    preview = records;

                    return {
                        success: true,
                        status: response.status,
                        data: {
                            count,
                            preview: preview.slice(0, 50), // Limited for API response
                            fullCount: count
                        },
                        raw: text.substring(0, 2000)
                    };
                } catch (e: any) {
                    return { success: false, error: e.message };
                }
            }, targetActionId, routerState, injectionBody, dynamicContext.csrf, dynamicContext.dpl);

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