import { WebDriver } from 'selenium-webdriver';
import { injectedSniffer } from '../scripts/injected-sniffer.js';
import { logger } from '../utils/logger.js';
import { sleep } from '../utils/wait.js';
import { SnifferClient, SnifferEntry } from '../types.js';

export class BrowserSniffer implements SnifferClient {
  constructor(private driver: WebDriver) {}

  /**
   * Check if the sniffer script is alive in the current page context.
   * Navigation destroys injected scripts, so we must always verify.
   */
  private async isAlive(): Promise<boolean> {
    try {
      return await this.driver.executeScript('return typeof window.__simpleAudienceSniffer !== "undefined"') as boolean;
    } catch {
      return false;
    }
  }

  /**
   * Ensure the sniffer is injected in the current page context.
   * Safe to call multiple times — re-injects if the page has navigated.
   */
  private async ensureInjected(): Promise<void> {
    if (!(await this.isAlive())) {
      logger.info('[sniffer] Injecting instrumentation into current page context...');
      await this.driver.executeScript(injectedSniffer);
    }
  }

  async inject(): Promise<void> {
    await this.driver.executeScript(injectedSniffer);
  }

  async reset(): Promise<void> {
    await this.ensureInjected();
    await this.driver.executeScript('window.__simpleAudienceSniffer.reset();');
  }

  async getEntries(): Promise<SnifferEntry[]> {
    await this.ensureInjected();
    const result = await this.driver.executeScript('return window.__simpleAudienceSniffer.getLog()');
    return (result as SnifferEntry[]) ?? [];
  }

  async waitForNextEntry(timeout = 10000): Promise<SnifferEntry> {
    await this.ensureInjected();
    const start = Date.now();
    const initialLength = (await this.getEntries()).length;
    while (Date.now() - start < timeout) {
      // Re-check alive in case of mid-wait navigation
      await this.ensureInjected();
      const entries = await this.getEntries();
      if (entries.length > initialLength) {
        return entries[entries.length - 1];
      }
      await sleep(500);
    }
    throw new Error('Timed out waiting for network activity');
  }
}
