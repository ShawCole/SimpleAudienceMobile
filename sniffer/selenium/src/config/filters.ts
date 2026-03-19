import { By, Key, WebDriver } from 'selenium-webdriver';
import fs from 'fs';
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

async function clickBuildAudienceButton(driver: WebDriver): Promise<void> {
  const clicked = await driver.executeScript<boolean>(
    `
      const buttons = Array.from(document.querySelectorAll('button'));
      const target = buttons.find(btn => {
        if (!btn || typeof btn.textContent !== 'string') return false;
        const label = btn.textContent.trim().toLowerCase();
        const enabled = !btn.disabled && !btn.getAttribute('aria-disabled');
        const visible = btn.offsetParent !== null;
        return enabled && visible && (
          label.includes('build audience') ||
          label.includes('order') ||
          label.includes('generate') ||
          label.includes('export')
        );
      });
      if (!target) return false;
      target.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
      target.click();
      return true;
    `
  );

  if (!clicked) {
    logger.warn('[filters] Unable to locate Build Audience button via DOM query, falling back to XPath');
    await clickXPath(driver, SELECTORS.buttons.buildAudience);
  }
}

async function waitForNavigationOrNetwork(
  driver: WebDriver,
  sniffer: SnifferClient,
  timeout = 60000
): Promise<void> {
  const startUrl = await driver.getCurrentUrl();
  const start = Date.now();

  // Generate may trigger a page navigation (redirect to home/audience list)
  // OR it may fire an API call and stay on the same page.
  // We wait for whichever happens first.
  while (Date.now() - start < timeout) {
    const currentUrl = await driver.getCurrentUrl();
    if (currentUrl !== startUrl) {
      logger.info(`[filters] Navigation detected: ${startUrl} -> ${currentUrl}`);
      // Give the sniffer a moment to capture the request that triggered navigation
      await driver.sleep(2000);
      return;
    }

    const entries = await sniffer.getEntries();
    if (entries.length > 0) {
      logger.info(`[filters] Network activity captured (${entries.length} entries)`);
      return;
    }

    await driver.sleep(500);
  }

  logger.warn(`[filters] Timed out waiting for navigation or network after ${timeout}ms`);
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
  {
    buttonKey: 'action.generate',
    section: 'actions',
    description: 'Clicks Preview first (required precondition), then clicks Build Audience / Generate and captures the full request + response including Next-Action headers. Expects a redirect to the audience list page.',
    async run({ driver, sniffer }) {
      // Step 1: Apply a minimal filter so Preview returns a count
      // (Generate is typically disabled without a preview first)
      logger.info('[action.generate] Applying minimal filter (seniority=cxo) for Preview precondition...');
      await openBusinessTab(driver);
      await selectSeniority(driver);
      await closeBusinessPanel(driver);

      // Step 2: Click Preview and wait for the count to return
      logger.info('[action.generate] Clicking Preview...');
      await clickPreviewButton(driver);
      await waitForNetworkOrLog(sniffer, 30000);
      logger.info('[action.generate] Preview complete. Waiting for Build Audience button to enable...');

      // Give the UI time to process the preview response and enable the Generate button
      await driver.sleep(3000);

      // Step 3: Reset sniffer — we only care about the GENERATE request
      await sniffer.reset();

      // Step 4: Diagnostic — dump all visible buttons so we know what we're clicking
      const buttonDump = await driver.executeScript<string[]>(`
        return Array.from(document.querySelectorAll('button')).map(btn => {
          const rect = btn.getBoundingClientRect();
          const visible = btn.offsetParent !== null;
          return JSON.stringify({
            text: btn.textContent?.trim()?.substring(0, 80),
            disabled: btn.disabled,
            ariaDisabled: btn.getAttribute('aria-disabled'),
            visible,
            classes: btn.className?.substring(0, 100),
            rect: { top: rect.top, left: rect.left, w: rect.width, h: rect.height }
          });
        });
      `);
      logger.info(`[action.generate] Visible buttons on page (${buttonDump.length}):`);
      buttonDump.forEach((b, i) => logger.info(`  [${i}] ${b}`));

      // Step 4b: Take screenshot before clicking
      const screenshotBefore = await driver.takeScreenshot();
      const outDir = 'docs/provider-traces';
      if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
      fs.writeFileSync(`${outDir}/generate-before-click.png`, screenshotBefore, 'base64');
      logger.info(`[action.generate] Screenshot saved: ${outDir}/generate-before-click.png`);

      // Step 5: Click Build Audience / Generate
      logger.info('[action.generate] Clicking Build Audience...');
      await clickBuildAudienceButton(driver);

      // Step 5b: Wait a moment then screenshot + check for confirmation dialogs
      await driver.sleep(2000);
      const screenshotAfter = await driver.takeScreenshot();
      fs.writeFileSync(`${outDir}/generate-after-click.png`, screenshotAfter, 'base64');
      logger.info(`[action.generate] Post-click screenshot saved`);

      // Check for any confirmation dialog / modal that appeared
      const dialogCheck = await driver.executeScript<string>(`
        // Look for common modal/dialog patterns
        const modals = document.querySelectorAll('[role="dialog"], [role="alertdialog"], .modal, .dialog, [class*="modal"], [class*="Modal"], [class*="dialog"], [class*="Dialog"], [class*="popup"], [class*="Popup"], [class*="overlay"], [class*="Overlay"]');
        const results = [];
        modals.forEach(m => {
          if (m.offsetParent !== null || getComputedStyle(m).display !== 'none') {
            results.push({
              tag: m.tagName,
              role: m.getAttribute('role'),
              classes: m.className?.substring(0, 120),
              text: m.textContent?.trim()?.substring(0, 300)
            });
          }
        });
        // Also check for any newly appeared buttons (like "Confirm", "Yes", "OK")
        const confirmBtns = Array.from(document.querySelectorAll('button')).filter(btn => {
          const txt = btn.textContent?.trim()?.toLowerCase() || '';
          return btn.offsetParent !== null && (txt.includes('confirm') || txt.includes('yes') || txt === 'ok' || txt.includes('proceed'));
        }).map(btn => btn.textContent?.trim());
        return JSON.stringify({ modals: results, confirmButtons: confirmBtns });
      `);
      logger.info(`[action.generate] Dialog/modal check: ${dialogCheck}`);

      // Click the confirmation button in the dialog
      const dialogData = JSON.parse(dialogCheck);
      if (dialogData.modals && dialogData.modals.length > 0) {
        logger.info(`[action.generate] Confirmation dialog detected — looking for Generate button inside it`);
        const confirmClicked = await driver.executeScript<boolean>(`
          // Find buttons inside dialog/modal elements
          const dialogs = document.querySelectorAll('[role="dialog"], [role="alertdialog"], [class*="modal"], [class*="Modal"], [class*="dialog"], [class*="Dialog"]');
          for (const dialog of dialogs) {
            const btns = Array.from(dialog.querySelectorAll('button'));
            // Look for the affirmative action button (not Cancel, not Close)
            const target = btns.find(btn => {
              const txt = btn.textContent?.trim()?.toLowerCase() || '';
              return btn.offsetParent !== null && !btn.disabled && (
                txt === 'generate' || txt.includes('confirm') || txt.includes('yes') || txt === 'ok' || txt.includes('proceed')
              ) && !txt.includes('cancel') && !txt.includes('close');
            });
            if (target) {
              target.click();
              return true;
            }
          }
          return false;
        `);
        if (confirmClicked) {
          logger.info('[action.generate] Clicked Generate in confirmation dialog');
        } else {
          logger.warn('[action.generate] Could not find confirmation button in dialog');
        }
      }

      // Step 6: Wait for network + possible navigation redirect to home page
      await waitForNavigationOrNetwork(driver, sniffer, 60000);

      // Step 7: Final pause to catch any trailing requests
      await driver.sleep(2000);

      // Final screenshot
      const screenshotFinal = await driver.takeScreenshot();
      fs.writeFileSync(`${outDir}/generate-final.png`, screenshotFinal, 'base64');

      // Dump all captured entries regardless
      const allEntries = await sniffer.getEntries();
      logger.info(`[action.generate] Total entries captured: ${allEntries.length}`);
      if (allEntries.length > 0) {
        fs.writeFileSync(`${outDir}/generate-raw-entries.json`, JSON.stringify(allEntries, null, 2));
        logger.info(`[action.generate] Raw entries saved to ${outDir}/generate-raw-entries.json`);
      }

      logger.info('[action.generate] Capture complete.');
    },
  },
];
