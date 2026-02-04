import { WebDriver } from 'selenium-webdriver';
import { injectedSniffer } from '../scripts/injected-sniffer.js';
import { logger } from '../utils/logger.js';
import { sleep } from '../utils/wait.js';
import { SnifferClient, SnifferEntry } from '../types.js';

export class BrowserSniffer implements SnifferClient {
  private injected = false;

  constructor(private driver: WebDriver) {}

  async inject(): Promise<void> {
    await this.driver.executeScript(injectedSniffer);
    this.injected = true;
  }

  async reset(): Promise<void> {
    if (!this.injected) {
      await this.inject();
      return;
    }
    await this.driver.executeScript('if (window.__simpleAudienceSniffer) { window.__simpleAudienceSniffer.reset(); }');
  }

  async getEntries(): Promise<SnifferEntry[]> {
    if (!this.injected) {
      await this.inject();
    }
    const result = await this.driver.executeScript('return window.__simpleAudienceSniffer ? window.__simpleAudienceSniffer.getLog() : []');
    return (result as SnifferEntry[]) ?? [];
  }

  async waitForNextEntry(timeout = 10000): Promise<SnifferEntry> {
    const start = Date.now();
    const initialLength = (await this.getEntries()).length;
    while (Date.now() - start < timeout) {
      const entries = await this.getEntries();
      if (entries.length > initialLength) {
        return entries[entries.length - 1];
      }
      await sleep(500);
    }
    throw new Error('Timed out waiting for network activity');
  }
}
