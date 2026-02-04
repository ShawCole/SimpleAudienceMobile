import { Builder, WebDriver } from 'selenium-webdriver';
import chrome from 'selenium-webdriver/chrome.js';
import { logger } from '../utils/logger.js';

export interface DriverOptions {
  headless?: boolean;
}

export async function createDriver(options: DriverOptions = {}): Promise<WebDriver> {
  const chromeOptions = new chrome.Options();
  chromeOptions.addArguments('--disable-gpu');
  chromeOptions.addArguments('--window-size=1400,900');
  chromeOptions.addArguments('--no-sandbox');
  chromeOptions.addArguments('--disable-dev-shm-usage');

  if (options.headless || process.env.HEADLESS === 'true') {
    chromeOptions.addArguments('--headless=new');
  }

  const builder = new Builder().forBrowser('chrome').setChromeOptions(chromeOptions);
  logger.info('Launching Chrome via Selenium...');
  const driver = await builder.build();
  await driver.manage().setTimeouts({ implicit: 5000, pageLoad: 60000, script: 60000 });
  return driver;
}
