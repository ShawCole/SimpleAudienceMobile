import { By, Key, until, WebDriver, WebElement } from 'selenium-webdriver';
import { logger } from './logger.js';

export async function waitForElement(driver: WebDriver, locator: By, timeout = 5000): Promise<WebElement> {
  return driver.wait(until.elementLocated(locator), timeout);
}

export async function clickXPath(driver: WebDriver, xpath: string, timeout = 5000): Promise<void> {
  const locator = By.xpath(xpath);
  const maxAttempts = 3;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const element = await waitForElement(driver, locator, timeout);

    await driver.executeScript(
      'arguments[0].scrollIntoView({ block: "center", inline: "center", behavior: "instant" });',
      element
    );

    const rect = await driver.executeScript<Record<string, number>>(
      'const r = arguments[0].getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height };',
      element
    );

    logger.info('[clickXPath] candidate', {
      xpath,
      attempt,
      rect,
    });

    try {
      await driver.wait(until.elementIsVisible(element), timeout);
      await driver.wait(until.elementIsEnabled(element), timeout);
      await element.click();
      logger.info('[clickXPath] success', { xpath, attempt, rect });
      return;
    } catch (error: any) {
      const intercepted = error?.name === 'ElementClickInterceptedError';
      logger.warn('[clickXPath] click failed', {
        xpath,
        attempt,
        intercepted,
        message: error?.message,
      });

      if (!intercepted || attempt === maxAttempts) {
        throw error;
      }

      await driver.sleep(250);
    }
  }
}

export async function fillInput(driver: WebDriver, selector: string, value: string): Promise<void> {
  const element = await waitForElement(driver, By.css(selector));
  await element.clear();
  await element.sendKeys(value);
}

export async function clickByText(driver: WebDriver, tag: string, text: string, timeout = 5000): Promise<void> {
  const xpath = `//${tag}[contains(normalize-space(.), "${text}")]`;
  await clickXPath(driver, xpath, timeout);
}

export async function selectChipByLabel(driver: WebDriver, label: string): Promise<void> {
  try {
    const xpath = `//*[contains(@class, 'chip') or contains(@class, 'option')][contains(normalize-space(.), "${label}")]`;
    await clickXPath(driver, xpath, 2000);
  } catch (error) {
    logger.warn(`Failed to click option ${label}, attempting label element fallback`);
    const xpath = `//label[contains(normalize-space(.), "${label}")]`;
    await clickXPath(driver, xpath, 2000);
  }
}

export async function pressEnter(driver: WebDriver): Promise<void> {
  const body = await driver.findElement(By.css('body'));
  await body.sendKeys(Key.ENTER);
}
