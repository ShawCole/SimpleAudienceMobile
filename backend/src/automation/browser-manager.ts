/**
 * Browser Manager
 * Handles Puppeteer browser lifecycle and page management
 */

import puppeteer, { Browser, Page } from 'puppeteer';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import logger from '../utils/logger';

// Add stealth plugin to avoid detection
const puppeteerExtra = require('puppeteer-extra');
puppeteerExtra.use(StealthPlugin());

export class BrowserManager {
  private browser: Browser | null = null;
  private page: Page | null = null;
  private isInitialized = false;

  constructor(
    private headless: boolean = process.env.HEADLESS !== 'false',
    private timeout: number = parseInt(process.env.BROWSER_TIMEOUT || '30000')
  ) {}

  /**
   * Initialize the browser
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      logger.warn('Browser already initialized');
      return;
    }

    try {
      logger.info('Launching browser...');

      this.browser = await puppeteerExtra.launch({
        headless: this.headless,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--disable-gpu',
          '--window-size=1920,1080',
        ],
        defaultViewport: {
          width: 1920,
          height: 1080,
        },
      });

      this.page = await this.browser.newPage();

      // Set default timeout
      this.page.setDefaultTimeout(this.timeout);
      this.page.setDefaultNavigationTimeout(this.timeout);

      // Set user agent
      await this.page.setUserAgent(
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      );

      this.isInitialized = true;
      logger.info('Browser initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize browser', error);
      throw error;
    }
  }

  /**
   * Get the current page
   */
  getPage(): Page {
    if (!this.page) {
      throw new Error('Browser not initialized. Call initialize() first.');
    }
    return this.page;
  }

  /**
   * Get the browser instance
   */
  getBrowser(): Browser {
    if (!this.browser) {
      throw new Error('Browser not initialized. Call initialize() first.');
    }
    return this.browser;
  }

  /**
   * Navigate to a URL
   */
  async goto(url: string, options?: any): Promise<void> {
    const page = this.getPage();
    logger.info(`Navigating to: ${url}`);
    await page.goto(url, {
      waitUntil: 'networkidle2',
      ...options,
    });
  }

  /**
   * Take a screenshot
   */
  async screenshot(path: string): Promise<void> {
    const page = this.getPage();
    await page.screenshot({ path, fullPage: true });
    logger.debug(`Screenshot saved: ${path}`);
  }

  /**
   * Execute JavaScript in the page context
   */
  async evaluate<T>(fn: any, ...args: any[]): Promise<T> {
    const page = this.getPage();
    return await page.evaluate(fn, ...args);
  }

  /**
   * Wait for a specified amount of time
   */
  async wait(ms: number): Promise<void> {
    await new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Close the current page
   */
  async closePage(): Promise<void> {
    if (this.page) {
      await this.page.close();
      this.page = null;
      logger.debug('Page closed');
    }
  }

  /**
   * Close the browser
   */
  async close(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
      this.page = null;
      this.isInitialized = false;
      logger.info('Browser closed');
    }
  }

  /**
   * Check if browser is initialized
   */
  isReady(): boolean {
    return this.isInitialized && this.browser !== null && this.page !== null;
  }

  /**
   * Restart the browser
   */
  async restart(): Promise<void> {
    logger.info('Restarting browser...');
    await this.close();
    await this.initialize();
  }
}

export default BrowserManager;
