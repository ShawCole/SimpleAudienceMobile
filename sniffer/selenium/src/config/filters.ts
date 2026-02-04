import { By, Key, WebDriver } from 'selenium-webdriver';
import { SELECTORS } from './selectors.js';
import { clickXPath } from '../utils/dom.js';
import { BUSINESS_DEPARTMENT_OPTIONS, BUSINESS_SENIORITY_OPTIONS } from '../utils/options.js';
import { selectAllOptions } from '../utils/dropdown.js';
import { FilterDefinition, SnifferClient } from '../types.js';
import { logger } from '../utils/logger.js';

async function openBusinessTab(driver: WebDriver) {
  await clickXPath(driver, SELECTORS.tabs.business);
}

async function waitForNetworkOrLog(sniffer: SnifferClient, timeout = 30000): Promise<void> {
  try {
    await sniffer.waitForNextEntry(timeout);
  } catch (error) {
    if (error instanceof Error && error.message.includes('Timed out waiting for network activity')) {
      logger.warn(`[filters] No network detected within ${timeout}ms after Preview click; continuing`);
    } else {
      throw error;
    }
  }
}

async function closeBusinessPanel(driver: WebDriver): Promise<void> {
  try {
    await driver.actions({ bridge: true }).sendKeys(Key.ESCAPE).perform();
    await driver.sleep(150);
  } catch {
    // no-op
  }
}

async function clickPreviewButton(driver: WebDriver): Promise<void> {
  const clicked = await driver.executeScript<boolean>(
    `
      const buttons = Array.from(document.querySelectorAll('button'));
      const target = buttons.find(btn => {
        if (!btn || typeof btn.textContent !== 'string') return false;
        const label = btn.textContent.trim().toLowerCase();
        const enabled = !btn.disabled && !btn.getAttribute('aria-disabled');
        const visible = btn.offsetParent !== null;
        return enabled && visible && label.includes('preview');
      });
      if (!target) {
        return false;
      }
      target.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
      target.click();
      return true;
    `
  );

  if (!clicked) {
    logger.warn('[filters] Unable to locate enabled Preview button via DOM query, falling back to XPath selector');
    await clickXPath(driver, SELECTORS.buttons.preview);
  }
}

interface LocatorOptions {
  retry?: boolean;
  onRetry?: () => Promise<void>;
}

async function resolveDropdownLocator(
  driver: WebDriver,
  label: string,
  candidates: string[],
  options: LocatorOptions = {}
): Promise<By> {
  for (const xp of candidates) {
    const matches = await driver.findElements(By.xpath(xp));
    if (matches.length > 0) {
      return By.xpath(xp);
    }
  }
  if (options.retry && options.onRetry) {
    await options.onRetry();
    return resolveDropdownLocator(driver, label, candidates, { retry: false });
  }
  throw new Error(`Unable to locate dropdown trigger for ${label}`);
}

async function selectSeniority(driver: WebDriver) {
  const candidates = [
    "//div[@role='dialog']//*[normalize-space(text())='Seniority']/following::button[contains(@aria-haspopup,'listbox') or contains(@role,'combobox')][1]",
    "//div[@role='dialog']//*[normalize-space(text())='Seniority']/ancestor::*[self::div or self::label][1]//button[contains(@aria-haspopup,'listbox') or contains(@role,'combobox')]",
    "//div[@role='dialog']//*[normalize-space(text())='Seniority']/following::*[@role='combobox' or @aria-label='Select option'][1]"
  ];

  const locatorFactory = async () =>
    resolveDropdownLocator(driver, 'Seniority', candidates, {
      retry: true,
      onRetry: () => openBusinessTab(driver),
    });
  await selectAllOptions(driver, locatorFactory, BUSINESS_SENIORITY_OPTIONS);
}

async function selectDepartments(driver: WebDriver) {
  const candidates = [
    "//div[@role='dialog']//*[normalize-space(text())='Departments']/following::button[contains(@aria-haspopup,'listbox') or contains(@role,'combobox')][1]",
    "//div[@role='dialog']//*[normalize-space(text())='Departments']/ancestor::*[self::div or self::label][1]//button[contains(@aria-haspopup,'listbox') or contains(@role,'combobox')]",
    "//div[@role='dialog']//*[normalize-space(text())='Departments']/following::*[@role='combobox' or @aria-label='Select option'][1]",
  ];

  const locatorFactory = async () =>
    resolveDropdownLocator(driver, 'Departments', candidates, {
      retry: true,
      onRetry: () => openBusinessTab(driver),
    });
  await selectAllOptions(driver, locatorFactory, BUSINESS_DEPARTMENT_OPTIONS);
}

export const FILTERS: FilterDefinition[] = [
  {
    buttonKey: 'business.seniority',
    section: 'business',
    description: 'Opens Business tab, selects Seniority options, and clicks Preview.',
    async run({ driver, sniffer }) {
      await openBusinessTab(driver);
      await selectSeniority(driver);
      await closeBusinessPanel(driver);
      await clickPreviewButton(driver);
      await waitForNetworkOrLog(sniffer);
    },
  },
  {
    buttonKey: 'business.departments',
    section: 'business',
    description: 'Opens Business tab, selects Department options, and clicks Preview.',
    async run({ driver, sniffer }) {
      await openBusinessTab(driver);
      await selectDepartments(driver);
      await closeBusinessPanel(driver);
      await clickPreviewButton(driver);
      await waitForNetworkOrLog(sniffer);
    },
  },
];
