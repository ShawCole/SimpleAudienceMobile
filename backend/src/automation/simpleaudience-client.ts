/**
 * SimpleAudience Client
 * Main automation class for interacting with SimpleAudience web app
 */

import { Page } from 'puppeteer';
import BrowserManager from './browser-manager';
import { AudienceStateMachine } from './state-machine';
import logger from '../utils/logger';
import * as xpath from '../utils/xpath';
import { SELECTORS } from '../utils/selectors';
import { retry } from '../utils/retry';
import {
  AudienceFilters,
  AudienceMetadata,
  AudienceStatus,
  DownloadEntry,
  RefreshSchedule,
} from '../../../shared/types';

export class SimpleAudienceClient {
  private browserManager: BrowserManager;
  private stateMachine: AudienceStateMachine;
  private baseUrl: string;
  private email: string;
  private password: string;
  private isAuthenticated = false;

  constructor() {
    this.browserManager = new BrowserManager();
    this.stateMachine = new AudienceStateMachine();
    this.baseUrl = process.env.SIMPLEAUDIENCE_BASE_URL || 'https://app.simpleaudience.io';
    this.email = process.env.SIMPLEAUDIENCE_EMAIL || '';
    this.password = process.env.SIMPLEAUDIENCE_PASSWORD || '';
  }

  /**
   * Initialize the client and authenticate
   */
  async initialize(): Promise<void> {
    await this.browserManager.initialize();
    await this.authenticate();
  }

  /**
   * Get the current page
   */
  private getPage(): Page {
    return this.browserManager.getPage();
  }

  /**
   * Authenticate to SimpleAudience
   */
  async authenticate(): Promise<void> {
    if (this.isAuthenticated) {
      logger.info('Already authenticated');
      return;
    }

    logger.info('Authenticating to SimpleAudience...');
    const page = this.getPage();

    try {
      await this.browserManager.goto(`${this.baseUrl}/login`);

      // Wait for and fill email field
      await xpath.typeIntoXPath(
        page,
        '//input[@type="email" or @name="email"]',
        this.email
      );

      // Fill password field
      await xpath.typeIntoXPath(
        page,
        '//input[@type="password" or @name="password"]',
        this.password
      );

      // Click login button
      await xpath.clickXPath(
        page,
        '//button[@type="submit" or contains(text(), "Log in") or contains(text(), "Sign in")]',
        { waitForNavigation: true }
      );

      // Wait for dashboard to load
      await page.waitForNavigation({ waitUntil: 'networkidle2' });

      this.isAuthenticated = true;
      logger.info('Authentication successful');
    } catch (error) {
      logger.error('Authentication failed', error);
      throw new Error('Failed to authenticate to SimpleAudience');
    }
  }

  /**
   * Navigate to audiences page
   */
  async navigateToAudiences(): Promise<void> {
    const page = this.getPage();
    await this.browserManager.goto(`${this.baseUrl}/audiences`);
    await xpath.waitForXPath(page, SELECTORS.audienceTable, { timeout: 10000 });
    logger.info('Navigated to audiences page');
  }

  /**
   * Create a new audience
   */
  async createAudience(name: string, filters: AudienceFilters): Promise<string> {
    logger.info(`Creating audience: ${name}`);
    const page = this.getPage();

    this.stateMachine.reset();
    this.stateMachine.transition('building_filters', 'start_creation');

    try {
      // Navigate to audiences page
      await this.navigateToAudiences();

      // Click "Create Audience" button
      await xpath.clickXPath(page, SELECTORS.createAudienceButton);
      await this.browserManager.wait(1000);

      // Apply filters
      await this.applyFilters(filters);

      // Preview audience
      const previewSize = await this.previewAudience();
      logger.info(`Preview size: ${previewSize}`);

      // Generate audience
      const audienceId = await this.generateAudience(name);

      this.stateMachine.transition('completed', 'audience_created', {
        audienceId,
      });

      logger.info(`Audience created successfully: ${audienceId}`);
      return audienceId;
    } catch (error) {
      this.stateMachine.handleError(error as Error);
      throw error;
    }
  }

  /**
   * Apply filters to the audience builder
   */
  private async applyFilters(filters: AudienceFilters): Promise<void> {
    const page = this.getPage();

    // Apply location filters
    if (filters.location) {
      await this.applyLocationFilters(filters.location);
    }

    // Apply intent filters
    if (filters.intent) {
      await this.applyIntentFilters(filters.intent);
    }

    // Apply business filters (placeholder)
    if (filters.business) {
      // TODO: Implement business filter application
      logger.debug('Business filters not yet implemented');
    }

    // Apply other filters as needed
    // TODO: Implement remaining filter types

    logger.info('Filters applied successfully');
  }

  /**
   * Apply location filters
   */
  private async applyLocationFilters(location: any): Promise<void> {
    const page = this.getPage();
    this.stateMachine.transition('setting_location', 'apply_location');

    try {
      // Click location tab if exists
      const locationTabExists = await xpath.elementExists(
        page,
        SELECTORS.locationFiltersTab,
        2000
      );

      if (locationTabExists) {
        await xpath.clickXPath(page, SELECTORS.locationFiltersTab);
        await this.browserManager.wait(500);
      }

      // Enter cities
      if (location.cities && location.cities.length > 0) {
        const citiesText = location.cities.join(', ');
        await xpath.typeIntoXPath(page, SELECTORS.citiesInput, citiesText);

        // Wait for loading spinner to disappear
        await xpath.waitForXPathToDisappear(
          page,
          SELECTORS.locationLoadingSpinner,
          { timeout: 5000 }
        );

        // Press Enter to confirm
        await page.keyboard.press('Enter');
        await this.browserManager.wait(500);
      }

      // Enter states
      if (location.states && location.states.length > 0) {
        const statesText = location.states.join(', ');
        await xpath.typeIntoXPath(page, SELECTORS.statesInput, statesText);

        await xpath.waitForXPathToDisappear(
          page,
          SELECTORS.locationLoadingSpinner,
          { timeout: 5000 }
        );

        await page.keyboard.press('Enter');
        await this.browserManager.wait(500);
      }

      // Enter zip codes
      if (location.zipCodes && location.zipCodes.length > 0) {
        const zipText = location.zipCodes.join(', ');
        await xpath.typeIntoXPath(page, SELECTORS.zipCodesInput, zipText);

        await xpath.waitForXPathToDisappear(
          page,
          SELECTORS.locationLoadingSpinner,
          { timeout: 5000 }
        );

        await page.keyboard.press('Enter');
        await this.browserManager.wait(500);
      }

      // Click Continue button if it exists
      const continueExists = await xpath.elementExists(
        page,
        SELECTORS.locationContinueButton,
        2000
      );

      if (continueExists) {
        await xpath.clickXPath(page, SELECTORS.locationContinueButton);
      }

      logger.info('Location filters applied');
    } catch (error) {
      logger.error('Failed to apply location filters', error);
      throw error;
    }
  }

  /**
   * Apply intent filters
   */
  private async applyIntentFilters(intent: any): Promise<void> {
    const page = this.getPage();
    this.stateMachine.transition('setting_intent', 'apply_intent');

    try {
      // Click intent tab if exists
      const intentTabExists = await xpath.elementExists(
        page,
        SELECTORS.intentFiltersTab,
        2000
      );

      if (intentTabExists) {
        await xpath.clickXPath(page, SELECTORS.intentFiltersTab);
        await this.browserManager.wait(500);
      }

      // Handle different intent types
      if (intent.type === 'custom' && intent.keywords) {
        const keywordsText = intent.keywords.join(', ');
        await xpath.typeIntoXPath(page, SELECTORS.customKeywordInput, keywordsText);
      } else if (intent.type === 'ai_generated' && intent.aiPrompt) {
        // Enter AI prompt
        await xpath.typeIntoXPath(page, SELECTORS.aiIntentTextarea, intent.aiPrompt);

        // Click generate button
        await xpath.clickXPath(page, SELECTORS.aiGenerateButton);

        // Wait for AI generation (placeholder - adjust based on actual UI)
        await this.browserManager.wait(3000);
      }

      // Set intent score
      if (intent.score) {
        const scoreSelector =
          intent.score === 'low'
            ? SELECTORS.intentScoreLow
            : intent.score === 'medium'
            ? SELECTORS.intentScoreMedium
            : SELECTORS.intentScoreHigh;

        await xpath.clickXPath(page, scoreSelector);
      }

      // Click Continue button
      const continueExists = await xpath.elementExists(
        page,
        SELECTORS.intentContinueButton,
        2000
      );

      if (continueExists) {
        await xpath.clickXPath(page, SELECTORS.intentContinueButton);
      }

      logger.info('Intent filters applied');
    } catch (error) {
      logger.error('Failed to apply intent filters', error);
      throw error;
    }
  }

  /**
   * Preview the audience
   */
  async previewAudience(): Promise<number> {
    const page = this.getPage();
    this.stateMachine.transition('previewing', 'start_preview');

    try {
      // Click preview button (try mid button first, then top)
      const midButtonExists = await xpath.elementExists(
        page,
        SELECTORS.previewButtonMid,
        2000
      );

      if (midButtonExists) {
        await xpath.clickXPath(page, SELECTORS.previewButtonMid);
      } else {
        await xpath.clickXPath(page, SELECTORS.previewButtonTop);
      }

      // Wait for preview loader to disappear
      await xpath.waitForXPathToDisappear(page, SELECTORS.previewLoader, {
        timeout: 60000,
      });

      // Extract preview count
      const countText = await xpath.getTextFromXPath(page, SELECTORS.previewCount);
      const previewSize = countText ? parseInt(countText.replace(/,/g, '')) : 0;

      this.stateMachine.transition('ready_to_generate', 'preview_complete', {
        metadata: { previewSize },
      });

      return previewSize;
    } catch (error) {
      logger.error('Failed to preview audience', error);
      throw error;
    }
  }

  /**
   * Generate the audience
   */
  async generateAudience(name: string): Promise<string> {
    const page = this.getPage();
    this.stateMachine.transition('generating', 'start_generation');

    try {
      // Click generate button
      await xpath.clickXPath(page, SELECTORS.generateButton);
      await this.browserManager.wait(1000);

      // Handle confirmation popup
      const popupExists = await xpath.elementExists(
        page,
        SELECTORS.generateConfirmPopup,
        3000
      );

      if (popupExists) {
        await xpath.clickXPath(page, SELECTORS.generateConfirmButton);
      }

      // Wait for generation to start
      await this.browserManager.wait(2000);

      // TODO: Extract actual audience ID from the UI
      const audienceId = `audience_${Date.now()}`;

      this.stateMachine.transition('monitoring_status', 'generation_started', {
        audienceId,
      });

      return audienceId;
    } catch (error) {
      logger.error('Failed to generate audience', error);
      throw error;
    }
  }

  /**
   * Get all audiences from the table
   */
  async getAllAudiences(): Promise<AudienceMetadata[]> {
    const page = this.getPage();
    await this.navigateToAudiences();

    // TODO: Implement table scraping logic
    logger.warn('getAllAudiences not yet fully implemented');
    return [];
  }

  /**
   * Refresh an audience
   */
  async refreshAudience(audienceId: string, schedule?: RefreshSchedule): Promise<void> {
    logger.info(`Refreshing audience: ${audienceId}`);
    // TODO: Implement refresh logic
    logger.warn('refreshAudience not yet fully implemented');
  }

  /**
   * Download audience CSV
   */
  async downloadAudience(audienceId: string): Promise<DownloadEntry[]> {
    logger.info(`Downloading audience: ${audienceId}`);
    // TODO: Implement download logic
    logger.warn('downloadAudience not yet fully implemented');
    return [];
  }

  /**
   * Duplicate an audience
   */
  async duplicateAudience(audienceId: string, newName: string): Promise<string> {
    logger.info(`Duplicating audience: ${audienceId} -> ${newName}`);
    // TODO: Implement duplicate logic
    logger.warn('duplicateAudience not yet fully implemented');
    return `audience_${Date.now()}`;
  }

  /**
   * Delete an audience
   */
  async deleteAudience(audienceId: string): Promise<void> {
    logger.info(`Deleting audience: ${audienceId}`);
    // TODO: Implement delete logic
    logger.warn('deleteAudience not yet fully implemented');
  }

  /**
   * Close the client
   */
  async close(): Promise<void> {
    await this.browserManager.close();
    logger.info('SimpleAudience client closed');
  }
}

export default SimpleAudienceClient;
