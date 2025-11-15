/**
 * XPath utilities for DOM interaction
 * Provides robust methods for waiting, clicking, typing, and extracting data
 */

import { Page, ElementHandle } from 'puppeteer';
import logger from './logger';

export interface WaitOptions {
  timeout?: number;
  polling?: number;
  throwOnTimeout?: boolean;
}

export interface ClickOptions {
  delay?: number;
  waitForNavigation?: boolean;
  retries?: number;
}

export interface TypeOptions {
  delay?: number;
  clear?: boolean;
  pressEnter?: boolean;
}

/**
 * Wait for an element to appear in the DOM via XPath
 */
export async function waitForXPath(
  page: Page,
  xpath: string,
  options: WaitOptions = {}
): Promise<ElementHandle | null> {
  const {
    timeout = 30000,
    polling = 500,
    throwOnTimeout = true,
  } = options;

  const startTime = Date.now();

  while (Date.now() - startTime < timeout) {
    try {
      const elements = await page.$x(xpath);
      if (elements.length > 0) {
        logger.debug(`Found element: ${xpath}`);
        return elements[0];
      }
    } catch (error) {
      logger.debug(`Error finding element ${xpath}: ${error}`);
    }

    await new Promise(resolve => setTimeout(resolve, polling));
  }

  const message = `Element not found after ${timeout}ms: ${xpath}`;
  logger.warn(message);

  if (throwOnTimeout) {
    throw new Error(message);
  }

  return null;
}

/**
 * Wait for an element to disappear from the DOM
 */
export async function waitForXPathToDisappear(
  page: Page,
  xpath: string,
  options: WaitOptions = {}
): Promise<void> {
  const { timeout = 30000, polling = 500 } = options;
  const startTime = Date.now();

  while (Date.now() - startTime < timeout) {
    const elements = await page.$x(xpath);
    if (elements.length === 0) {
      logger.debug(`Element disappeared: ${xpath}`);
      return;
    }
    await new Promise(resolve => setTimeout(resolve, polling));
  }

  logger.warn(`Element still present after ${timeout}ms: ${xpath}`);
}

/**
 * Click an element via XPath with retry logic
 */
export async function clickXPath(
  page: Page,
  xpath: string,
  options: ClickOptions = {}
): Promise<void> {
  const { delay = 100, waitForNavigation = false, retries = 3 } = options;

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const element = await waitForXPath(page, xpath, { timeout: 10000 });
      if (!element) {
        throw new Error(`Element not found: ${xpath}`);
      }

      // Scroll element into view
      await element.evaluate((el: any) => {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      });

      await new Promise(resolve => setTimeout(resolve, delay));

      if (waitForNavigation) {
        await Promise.all([
          page.waitForNavigation({ waitUntil: 'networkidle2' }),
          element.click(),
        ]);
      } else {
        await element.click();
      }

      logger.debug(`Clicked element: ${xpath}`);
      return;
    } catch (error) {
      logger.warn(`Click attempt ${attempt}/${retries} failed for ${xpath}: ${error}`);
      if (attempt === retries) {
        throw error;
      }
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
}

/**
 * Type text into an input field via XPath
 */
export async function typeIntoXPath(
  page: Page,
  xpath: string,
  text: string,
  options: TypeOptions = {}
): Promise<void> {
  const { delay = 50, clear = true, pressEnter = false } = options;

  const element = await waitForXPath(page, xpath);
  if (!element) {
    throw new Error(`Element not found: ${xpath}`);
  }

  // Scroll into view
  await element.evaluate((el: any) => {
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });

  await new Promise(resolve => setTimeout(resolve, 100));

  // Clear existing text if requested
  if (clear) {
    await element.click({ clickCount: 3 });
    await page.keyboard.press('Backspace');
  }

  // Type text
  await element.type(text, { delay });

  // Press Enter if requested
  if (pressEnter) {
    await page.keyboard.press('Enter');
  }

  logger.debug(`Typed into element: ${xpath}`);
}

/**
 * Extract text from an element via XPath
 */
export async function getTextFromXPath(
  page: Page,
  xpath: string
): Promise<string | null> {
  const element = await waitForXPath(page, xpath, { throwOnTimeout: false });
  if (!element) {
    return null;
  }

  const text = await element.evaluate((el: any) => el.textContent?.trim() || '');
  return text;
}

/**
 * Extract attribute from an element via XPath
 */
export async function getAttributeFromXPath(
  page: Page,
  xpath: string,
  attribute: string
): Promise<string | null> {
  const element = await waitForXPath(page, xpath, { throwOnTimeout: false });
  if (!element) {
    return null;
  }

  const value = await element.evaluate(
    (el: any, attr: string) => el.getAttribute(attr),
    attribute
  );
  return value;
}

/**
 * Check if an element exists
 */
export async function elementExists(
  page: Page,
  xpath: string,
  timeout: number = 2000
): Promise<boolean> {
  const element = await waitForXPath(page, xpath, {
    timeout,
    throwOnTimeout: false,
  });
  return element !== null;
}

/**
 * Get all elements matching an XPath
 */
export async function getAllElements(
  page: Page,
  xpath: string
): Promise<ElementHandle[]> {
  try {
    const elements = await page.$x(xpath);
    return elements;
  } catch (error) {
    logger.error(`Error getting elements: ${xpath}`, error);
    return [];
  }
}

/**
 * Select an option from a dropdown
 */
export async function selectDropdownOption(
  page: Page,
  dropdownXPath: string,
  optionText: string
): Promise<void> {
  // Click dropdown to open
  await clickXPath(page, dropdownXPath);
  await new Promise(resolve => setTimeout(resolve, 500));

  // Find and click option
  const optionXPath = `//*[contains(text(), "${optionText}")]`;
  await clickXPath(page, optionXPath);

  logger.debug(`Selected dropdown option: ${optionText}`);
}
