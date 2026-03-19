import { By, Key, until, WebDriver } from 'selenium-webdriver';
import { SELECTORS } from '../config/selectors.js';
import { fillInput, clickXPath } from '../utils/dom.js';
import { logger } from '../utils/logger.js';

export interface LoginOptions {
  manual?: boolean;
}

const DASHBOARD_PATH_SNIPPET = '/home';

export async function ensureLoggedIn(driver: WebDriver, options: LoginOptions = {}): Promise<void> {
  await driver.get(SELECTORS.baseUrl);

  if (options.manual) {
    logger.info('Manual login enabled. Complete authentication in the opened browser window.');
    await waitForDashboard(driver);
    await openAudienceBuilder(driver);
    return;
  }

  const needsCredentials = await loginFormPresent(driver);

  if (!needsCredentials) {
    logger.info('Already authenticated.');
    await waitForDashboard(driver);
    await openAudienceBuilder(driver);
    return;
  }

  if (!process.env.AUDLAB_EMAIL || !process.env.AUDLAB_PASSWORD) {
    logger.warn('AUDLAB_EMAIL/AUDLAB_PASSWORD not set. Please log in manually.');
    await waitForDashboard(driver);
    await openAudienceBuilder(driver);
    return;
  }

  logger.info('Attempting automated login...');
  await fillInput(driver, SELECTORS.login.email, process.env.AUDLAB_EMAIL);
  await fillInput(driver, SELECTORS.login.password, process.env.AUDLAB_PASSWORD);
  const submit = await driver.findElement(By.css(SELECTORS.login.submit));
  await submit.click();
  await waitForDashboard(driver);
  await openAudienceBuilder(driver);
}

async function openAudienceBuilder(driver: WebDriver): Promise<void> {
  // Step 1: Click the first workspace card (link containing /home/)
  logger.info('Opening workspace card...');
  const workspaceClicked = await driver.executeScript<boolean>(`
    // Try the original absolute XPath first
    let el = document.evaluate("/html/body/div[2]/div/div[2]/div[2]/div[2]/div/div/a[1]", document, null, 9, null).singleNodeValue;
    if (el) { el.click(); return true; }
    // Fallback: find first anchor that links to a workspace
    const links = Array.from(document.querySelectorAll('a[href*="/home/"]'));
    const card = links.find(a => a.offsetParent !== null);
    if (card) { card.click(); return true; }
    return false;
  `);
  if (!workspaceClicked) {
    // Last resort: try original XPath via Selenium
    await clickXPath(driver, "/html/body/div[2]/div/div[2]/div[2]/div[2]/div/div/a[1]", 20000);
  }

  // Wait for workspace page to load
  await driver.sleep(3000);

  // Step 2: Click "Create" button (text-based, resilient to DOM changes)
  logger.info('Clicking Create button...');
  const createClicked = await driver.executeScript<boolean>(`
    // Try original absolute XPath
    let el = document.evaluate("/html/body/div[2]/div/div[2]/div[2]/div[3]/div/div[1]/button", document, null, 9, null).singleNodeValue;
    if (el && el.offsetParent !== null) { el.click(); return true; }
    // Fallback: find a visible button whose text includes "Create"
    const buttons = Array.from(document.querySelectorAll('button'));
    const target = buttons.find(btn => {
      const text = (btn.textContent || '').trim().toLowerCase();
      return btn.offsetParent !== null && !btn.disabled && (text.includes('create') || text.includes('new audience'));
    });
    if (target) { target.scrollIntoView({ block: 'center' }); target.click(); return true; }
    return false;
  `);
  if (!createClicked) {
    await clickXPath(driver, "//button[contains(normalize-space(.), 'Create')]", 20000);
  }

  logger.info('Waiting for modal dialog...');
  const dialog = await driver.wait(until.elementLocated(By.css('div[role="dialog"]')), 15000);
  await driver.wait(until.elementIsVisible(dialog), 5000);

  logger.info('Typing audience name...');
  const nameInput = await dialog.findElement(By.css('input'));
  await nameInput.clear();
  const testName = `sniffer-generate-${Date.now()}`;
  await nameInput.sendKeys(testName);

  logger.info('Clicking modal Create button...');
  const createBtn = await dialog.findElement(By.xpath(".//button[contains(normalize-space(.), 'Create')][last()]"));
  await createBtn.click();

  logger.info('Waiting for audience builder to load...');
  await driver.wait(until.urlContains('/audience/'), 30000);
  logger.info('Audience builder opened.');
}

async function loginFormPresent(driver: WebDriver): Promise<boolean> {
  const emailFields = await driver.findElements(By.css(SELECTORS.login.email));
  return emailFields.length > 0;
}

async function waitForDashboard(driver: WebDriver): Promise<void> {
  await driver.wait(async () => {
    const url = await driver.getCurrentUrl();
    return url.includes(DASHBOARD_PATH_SNIPPET);
  }, 120000);
  logger.info('Login confirmed. Dashboard loaded.');
}
