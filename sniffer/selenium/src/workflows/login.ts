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
  logger.info('Opening workspace card...');
  await clickXPath(driver, "/html/body/div[2]/div/div[2]/div[2]/div[2]/div/div/a[1]", 20000);

  logger.info('Clicking Create button...');
  await clickXPath(driver, "/html/body/div[2]/div/div[2]/div[2]/div[3]/div/div[1]/button", 20000);

  logger.info('Waiting for modal dialog...');
  const dialog = await driver.wait(until.elementLocated(By.css('div[role="dialog"]')), 10000);
  await driver.wait(until.elementIsVisible(dialog), 5000);

  logger.info('Typing audience name...');
  const nameInput = await dialog.findElement(By.css('input'));
  await nameInput.clear();
  await nameInput.sendKeys('test');

  logger.info('Clicking modal Create button...');
  const createBtn = await dialog.findElement(By.xpath(".//button[contains(normalize-space(.), 'Create')][last()]"));
  await createBtn.click();

  logger.info('Waiting for audience builder to load...');
  await driver.wait(until.urlContains('/audience/'), 20000);
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
