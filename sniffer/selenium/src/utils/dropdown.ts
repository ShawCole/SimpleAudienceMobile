import { By, Key, until, WebDriver, WebElement } from 'selenium-webdriver';
import { logger } from './logger.js';

const CASE_NORMALIZER = "translate(normalize-space(.), 'abcdefghijklmnopqrstuvwxyz', 'ABCDEFGHIJKLMNOPQRSTUVWXYZ')";
const DEFAULT_IMPLICIT_TIMEOUT = 5000;
const OPTION_POLL_INTERVAL_MS = 150;
const OPTION_MAX_ATTEMPTS = 40;
const CHIP_MAX_ATTEMPTS = 20;

type LocatorFactory = () => By | Promise<By>;
type LocatorLike = By | LocatorFactory;

function escapeForXPath(value: string): string {
  if (!value.includes("'")) {
    return `'${value}'`;
  }
  const parts = value.split("'");
  const concatParts: string[] = [];
  parts.forEach((part, index) => {
    const literal = part ? `'${part}'` : "''";
    concatParts.push(literal);
    if (index !== parts.length - 1) {
      concatParts.push("\"'\"");
    }
  });
  return `concat(${concatParts.join(', ')})`;
}

async function resolveLocator(locator: LocatorLike): Promise<By> {
  if (typeof locator === 'function') {
    return await locator();
  }
  return locator;
}

async function ensureDropdownOpen(driver: WebDriver, locator: By): Promise<WebElement> {
  const trigger = await driver.findElement(locator);
  const expanded = await trigger.getAttribute('aria-expanded');
  if (expanded !== 'true') {
    await trigger.click();
    await driver
      .wait(async () => (await trigger.getAttribute('aria-expanded')) === 'true', 800)
      .catch(() => { });
  }
  return trigger;
}

async function closeDropdown(driver: WebDriver): Promise<void> {
  await driver.actions({ bridge: true }).sendKeys(Key.ESCAPE).perform();
  await driver.sleep(50);
}

async function readVisibleLabels(driver: WebDriver, listElement: any): Promise<string[]> {
  const options = await listElement.findElements(By.css('[role="option"], [data-option], [data-test-select-option]'));
  const labels: string[] = [];
  for (const option of options) {
    const text = (await option.getText()).trim();
    if (text) {
      labels.push(text);
    }
  }
  return labels;
}

async function scrollList(driver: WebDriver, listElement: any) {
  await driver.executeScript('arguments[0].scrollTop = arguments[0].scrollTop + arguments[0].clientHeight;', listElement);
  await driver.sleep(150);
}

async function collectAllLabels(driver: WebDriver, listElement: any): Promise<string[]> {
  const labels = new Set<string>();
  let lastSize = -1;
  let guard = 0;

  while (guard < 100) {
    const visible = await readVisibleLabels(driver, listElement);
    visible.forEach(label => labels.add(label));

    const scrollHeight: number = await driver.executeScript('return arguments[0].scrollHeight;', listElement);
    const clientHeight: number = await driver.executeScript('return arguments[0].clientHeight;', listElement);
    const scrollTop: number = await driver.executeScript('return arguments[0].scrollTop;', listElement);
    const atBottom = scrollTop + clientHeight >= scrollHeight - 2;

    if (labels.size === lastSize && atBottom) {
      break;
    }

    lastSize = labels.size;
    await scrollList(driver, listElement);
    guard++;
  }

  return Array.from(labels);
}

async function waitForChip(driver: WebDriver, normalized: string): Promise<void> {
  const chipLocator = By.xpath(
    `//div[contains(@class,'multiValue')]//*[contains(${CASE_NORMALIZER}, ${escapeForXPath(normalized)})]`
  );

  for (let attempt = 0; attempt < CHIP_MAX_ATTEMPTS; attempt++) {
    const chips = await driver.findElements(chipLocator);
    if (chips.length > 0) {
      return;
    }
    await driver.sleep(OPTION_POLL_INTERVAL_MS);
  }

  throw new Error(`Chip for ${normalized} did not appear in time`);
}

async function findOptionWithRetry(driver: WebDriver, locator: By): Promise<WebElement> {
  const startedAt = Date.now();

  for (let attempt = 0; attempt < OPTION_MAX_ATTEMPTS; attempt++) {
    const matches = await driver.findElements(locator);
    if (matches.length > 0) {
      const option = matches[0];
      await driver.wait(until.elementIsVisible(option), 500);
      logger.info('[dropdown] option located', {
        locator: locator.toString(),
        attempts: attempt + 1,
        ms: Date.now() - startedAt,
      });
      return option;
    }
    await driver.sleep(OPTION_POLL_INTERVAL_MS);
  }

  throw new Error(`Unable to locate dropdown option using ${locator.toString()}`);
}

async function clickOption(driver: WebDriver, triggerLocator: LocatorLike, label: string): Promise<void> {
  const resolvedLocator = await resolveLocator(triggerLocator);
  const normalized = label.trim().toUpperCase();
  await ensureDropdownOpen(driver, resolvedLocator);
  const optionLocator = By.xpath(`//div[@role='option'][contains(${CASE_NORMALIZER}, ${escapeForXPath(normalized)})]`);
  const option = await findOptionWithRetry(driver, optionLocator);
  await option.click();
  logger.info('[dropdown] clicked option', { label, mode: 'list' });
  await waitForChip(driver, normalized);
}

export async function selectAllOptions(driver: WebDriver, triggerLocator: LocatorLike, knownLabels?: string[]): Promise<void> {
  await driver.manage().setTimeouts({ implicit: 0 });

  try {
    const labels = Array.from(knownLabels ?? await (await (async () => {
      const locator = await resolveLocator(triggerLocator);
      await ensureDropdownOpen(driver, locator);
      const list = await driver.wait(until.elementLocated(By.css('[role="listbox"]')), 5000);
      const discovered = await collectAllLabels(driver, list);
      logger.info(`Dropdown options detected: ${discovered.join(', ')}`);
      return discovered;
    })()));

    for (const label of labels) {
      const startedAt = Date.now();
      logger.info(`Selecting dropdown option: ${label}`);
      await clickOption(driver, triggerLocator, label);
      logger.info('[dropdown] selection complete', {
        label,
        durationMs: Date.now() - startedAt,
      });
    }
    await closeDropdown(driver);
  } finally {
    await driver.manage().setTimeouts({ implicit: DEFAULT_IMPLICIT_TIMEOUT });
  }
}
