/**
 * Audience Service
 * Business logic for audience operations
 */

import { v4 as uuidv4 } from 'uuid';
import logger from '../utils/logger';
import DatabaseService from './database';
import SimpleAudienceClient from '../automation/simpleaudience-client';
import {
  AudienceFilters,
  AudienceMetadata,
  AudienceStatus,
  RefreshSchedule,
} from '../../../shared/types';

export class AudienceService {
  private db: DatabaseService;
  private client: SimpleAudienceClient | null = null;

  constructor(db: DatabaseService) {
    this.db = db;
  }

  /**
   * Get or initialize the SimpleAudience client
   */
  private async getClient(): Promise<SimpleAudienceClient> {
    if (!this.client) {
      this.client = new SimpleAudienceClient();
      await this.client.initialize();
    }
    return this.client;
  }

  /**
   * Create a new audience
   */
  async createAudience(name: string, filters: AudienceFilters): Promise<AudienceMetadata> {
    logger.info(`Creating audience: ${name}`);

    const audienceId = uuidv4();
    const now = new Date();

    // Create initial metadata
    const audience: AudienceMetadata = {
      id: audienceId,
      name,
      status: 'building',
      filters,
      createdAt: now,
      updatedAt: now,
      refreshCount: 0,
    };

    // Save to database
    this.db.saveAudience(audience);

    // Start automation in background
    this.runAudienceCreation(audienceId, name, filters).catch(error => {
      logger.error(`Failed to create audience ${audienceId}:`, error);
      this.db.updateAudienceStatus(audienceId, 'failed');
    });

    return audience;
  }

  /**
   * Run audience creation automation
   */
  private async runAudienceCreation(
    audienceId: string,
    name: string,
    filters: AudienceFilters
  ): Promise<void> {
    try {
      const client = await this.getClient();

      // Update status to building
      this.db.updateAudienceStatus(audienceId, 'building');

      // Create audience via automation
      const simpleAudienceId = await client.createAudience(name, filters);

      // Update status to monitoring
      this.db.updateAudienceStatus(audienceId, 'monitoring_status');

      // Poll for completion (simplified - real implementation would be more sophisticated)
      await this.pollAudienceStatus(audienceId);

      logger.info(`Audience created successfully: ${audienceId}`);
    } catch (error) {
      logger.error(`Audience creation failed: ${audienceId}`, error);
      this.db.updateAudienceStatus(audienceId, 'failed');
      throw error;
    }
  }

  /**
   * Poll audience status until completion
   */
  private async pollAudienceStatus(audienceId: string): Promise<void> {
    const maxAttempts = 60; // 5 minutes with 5-second intervals
    let attempts = 0;

    while (attempts < maxAttempts) {
      await new Promise(resolve => setTimeout(resolve, 5000));

      // In a real implementation, this would check the actual status from SimpleAudience
      // For now, we'll simulate completion after a few attempts
      attempts++;

      if (attempts > 10) {
        // Simulate completion
        this.db.updateAudienceStatus(audienceId, 'completed');

        // Update audience with size
        const audience = this.db.getAudience(audienceId);
        if (audience) {
          audience.size = Math.floor(Math.random() * 100000) + 1000; // Placeholder
          audience.status = 'completed';
          audience.updatedAt = new Date();
          this.db.saveAudience(audience);
        }

        return;
      }
    }

    throw new Error('Audience generation timed out');
  }

  /**
   * Get an audience by ID
   */
  getAudience(id: string): AudienceMetadata | null {
    return this.db.getAudience(id);
  }

  /**
   * Get all audiences
   */
  getAllAudiences(page: number = 1, pageSize: number = 20): {
    audiences: AudienceMetadata[];
    total: number;
    page: number;
    pageSize: number;
  } {
    const offset = (page - 1) * pageSize;
    const audiences = this.db.getAllAudiences(pageSize, offset);
    const total = audiences.length; // Simplified - should query total count separately

    return {
      audiences,
      total,
      page,
      pageSize,
    };
  }

  /**
   * Refresh an audience
   */
  async refreshAudience(id: string, schedule?: RefreshSchedule): Promise<void> {
    logger.info(`Refreshing audience: ${id}`);

    const audience = this.db.getAudience(id);
    if (!audience) {
      throw new Error(`Audience not found: ${id}`);
    }

    this.db.updateAudienceStatus(id, 'refreshing');

    try {
      const client = await this.getClient();
      await client.refreshAudience(id, schedule);

      // Update metadata
      audience.status = 'completed';
      audience.lastRefreshed = new Date();
      audience.refreshCount++;
      audience.updatedAt = new Date();

      // Set next refresh if schedule provided
      if (schedule && schedule !== 'manual') {
        audience.nextRefresh = this.calculateNextRefresh(schedule);
      }

      this.db.saveAudience(audience);

      logger.info(`Audience refreshed: ${id}`);
    } catch (error) {
      logger.error(`Failed to refresh audience ${id}:`, error);
      this.db.updateAudienceStatus(id, 'failed');
      throw error;
    }
  }

  /**
   * Duplicate an audience
   */
  async duplicateAudience(id: string, newName: string): Promise<AudienceMetadata> {
    logger.info(`Duplicating audience: ${id} -> ${newName}`);

    const original = this.db.getAudience(id);
    if (!original) {
      throw new Error(`Audience not found: ${id}`);
    }

    // Create new audience with same filters
    return await this.createAudience(newName, original.filters);
  }

  /**
   * Delete an audience
   */
  async deleteAudience(id: string): Promise<void> {
    logger.info(`Deleting audience: ${id}`);

    const audience = this.db.getAudience(id);
    if (!audience) {
      throw new Error(`Audience not found: ${id}`);
    }

    try {
      const client = await this.getClient();
      await client.deleteAudience(id);
      this.db.deleteAudience(id);

      logger.info(`Audience deleted: ${id}`);
    } catch (error) {
      logger.error(`Failed to delete audience ${id}:`, error);
      throw error;
    }
  }

  /**
   * Calculate next refresh date based on schedule
   */
  private calculateNextRefresh(schedule: RefreshSchedule): Date {
    const now = new Date();

    switch (schedule) {
      case 'everyday':
        return new Date(now.getTime() + 24 * 60 * 60 * 1000);
      case '3_days':
        return new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);
      case '7_days':
        return new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
      case '14_days':
        return new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);
      case 'monthly':
        const next = new Date(now);
        next.setMonth(next.getMonth() + 1);
        next.setDate(1);
        return next;
      default:
        return now;
    }
  }

  /**
   * Close the service and cleanup
   */
  async close(): Promise<void> {
    if (this.client) {
      await this.client.close();
    }
    logger.info('Audience service closed');
  }
}

export default AudienceService;
