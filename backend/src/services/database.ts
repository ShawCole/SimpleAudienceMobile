/**
 * Database Service
 * SQLite database for storing audience metadata, webhooks, and operations
 */

import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import logger from '../utils/logger';
import { AudienceMetadata, DownloadEntry, Webhook, AudienceFilters } from '../../../shared/types';

export class DatabaseService {
  private db: Database.Database;

  constructor(dbPath?: string) {
    const dataDir = path.join(__dirname, '../../data');
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    const finalPath = dbPath || path.join(dataDir, 'simpleaudience.db');
    this.db = new Database(finalPath);
    this.initialize();
    logger.info(`Database initialized: ${finalPath}`);
  }

  /**
   * Initialize database schema
   */
  private initialize(): void {
    // Create audiences table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS audiences (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        status TEXT NOT NULL,
        size INTEGER,
        preview_size INTEGER,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        last_refreshed TEXT,
        refresh_count INTEGER DEFAULT 0,
        next_refresh TEXT,
        filters TEXT NOT NULL
      )
    `);

    // Create downloads table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS downloads (
        id TEXT PRIMARY KEY,
        audience_id TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        row_count INTEGER NOT NULL,
        file_size INTEGER NOT NULL,
        file_type TEXT NOT NULL,
        download_url TEXT NOT NULL,
        status TEXT NOT NULL,
        FOREIGN KEY (audience_id) REFERENCES audiences (id) ON DELETE CASCADE
      )
    `);

    // Create webhooks table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS webhooks (
        id TEXT PRIMARY KEY,
        audience_id TEXT NOT NULL,
        url TEXT NOT NULL,
        events TEXT NOT NULL,
        active INTEGER DEFAULT 1,
        created_at TEXT NOT NULL,
        last_triggered TEXT,
        FOREIGN KEY (audience_id) REFERENCES audiences (id) ON DELETE CASCADE
      )
    `);

    // Create operations table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS operations (
        id TEXT PRIMARY KEY,
        audience_id TEXT,
        type TEXT NOT NULL,
        status TEXT NOT NULL,
        started_at TEXT NOT NULL,
        completed_at TEXT,
        error TEXT
      )
    `);

    logger.info('Database schema initialized');
  }

  /**
   * Save or update an audience
   */
  saveAudience(audience: AudienceMetadata): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO audiences
      (id, name, status, size, preview_size, created_at, updated_at, last_refreshed, refresh_count, next_refresh, filters)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      audience.id,
      audience.name,
      audience.status,
      audience.size || null,
      audience.previewSize || null,
      audience.createdAt.toISOString(),
      audience.updatedAt.toISOString(),
      audience.lastRefreshed?.toISOString() || null,
      audience.refreshCount,
      audience.nextRefresh?.toISOString() || null,
      JSON.stringify(audience.filters)
    );

    logger.debug(`Audience saved: ${audience.id}`);
  }

  /**
   * Get an audience by ID
   */
  getAudience(id: string): AudienceMetadata | null {
    const stmt = this.db.prepare('SELECT * FROM audiences WHERE id = ?');
    const row: any = stmt.get(id);

    if (!row) {
      return null;
    }

    return this.rowToAudience(row);
  }

  /**
   * Get all audiences
   */
  getAllAudiences(limit?: number, offset?: number): AudienceMetadata[] {
    let query = 'SELECT * FROM audiences ORDER BY created_at DESC';

    if (limit) {
      query += ` LIMIT ${limit}`;
    }

    if (offset) {
      query += ` OFFSET ${offset}`;
    }

    const stmt = this.db.prepare(query);
    const rows: any[] = stmt.all();

    return rows.map(row => this.rowToAudience(row));
  }

  /**
   * Delete an audience
   */
  deleteAudience(id: string): void {
    const stmt = this.db.prepare('DELETE FROM audiences WHERE id = ?');
    stmt.run(id);
    logger.debug(`Audience deleted: ${id}`);
  }

  /**
   * Update audience status
   */
  updateAudienceStatus(id: string, status: string): void {
    const stmt = this.db.prepare(`
      UPDATE audiences
      SET status = ?, updated_at = ?
      WHERE id = ?
    `);
    stmt.run(status, new Date().toISOString(), id);
  }

  /**
   * Save a download entry
   */
  saveDownload(download: DownloadEntry): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO downloads
      (id, audience_id, timestamp, row_count, file_size, file_type, download_url, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      download.id,
      download.audienceId,
      download.timestamp.toISOString(),
      download.rowCount,
      download.fileSize,
      download.fileType,
      download.downloadUrl,
      download.status
    );

    logger.debug(`Download saved: ${download.id}`);
  }

  /**
   * Get downloads for an audience
   */
  getDownloads(audienceId: string): DownloadEntry[] {
    const stmt = this.db.prepare(`
      SELECT * FROM downloads
      WHERE audience_id = ?
      ORDER BY timestamp DESC
    `);
    const rows: any[] = stmt.all(audienceId);

    return rows.map(row => this.rowToDownload(row));
  }

  /**
   * Save a webhook
   */
  saveWebhook(webhook: Webhook): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO webhooks
      (id, audience_id, url, events, active, created_at, last_triggered)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      webhook.id,
      webhook.audienceId,
      webhook.url,
      JSON.stringify(webhook.events),
      webhook.active ? 1 : 0,
      webhook.createdAt.toISOString(),
      webhook.lastTriggered?.toISOString() || null
    );

    logger.debug(`Webhook saved: ${webhook.id}`);
  }

  /**
   * Get webhooks for an audience
   */
  getWebhooks(audienceId: string): Webhook[] {
    const stmt = this.db.prepare(`
      SELECT * FROM webhooks
      WHERE audience_id = ? AND active = 1
    `);
    const rows: any[] = stmt.all(audienceId);

    return rows.map(row => this.rowToWebhook(row));
  }

  /**
   * Delete a webhook
   */
  deleteWebhook(id: string): void {
    const stmt = this.db.prepare('DELETE FROM webhooks WHERE id = ?');
    stmt.run(id);
    logger.debug(`Webhook deleted: ${id}`);
  }

  /**
   * Convert database row to AudienceMetadata
   */
  private rowToAudience(row: any): AudienceMetadata {
    return {
      id: row.id,
      name: row.name,
      status: row.status,
      size: row.size,
      previewSize: row.preview_size,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
      lastRefreshed: row.last_refreshed ? new Date(row.last_refreshed) : undefined,
      refreshCount: row.refresh_count,
      nextRefresh: row.next_refresh ? new Date(row.next_refresh) : undefined,
      filters: JSON.parse(row.filters),
    };
  }

  /**
   * Convert database row to DownloadEntry
   */
  private rowToDownload(row: any): DownloadEntry {
    return {
      id: row.id,
      audienceId: row.audience_id,
      timestamp: new Date(row.timestamp),
      rowCount: row.row_count,
      fileSize: row.file_size,
      fileType: row.file_type,
      downloadUrl: row.download_url,
      status: row.status,
    };
  }

  /**
   * Convert database row to Webhook
   */
  private rowToWebhook(row: any): Webhook {
    return {
      id: row.id,
      audienceId: row.audience_id,
      url: row.url,
      events: JSON.parse(row.events),
      active: row.active === 1,
      createdAt: new Date(row.created_at),
      lastTriggered: row.last_triggered ? new Date(row.last_triggered) : undefined,
    };
  }

  /**
   * Close the database connection
   */
  close(): void {
    this.db.close();
    logger.info('Database connection closed');
  }
}

export default DatabaseService;
