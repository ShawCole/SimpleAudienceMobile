/**
 * Google Drive Service
 * Handles file uploads and sharing via Google Drive API
 */

import { google } from 'googleapis';
import fs from 'fs';
import path from 'path';
import logger from '../utils/logger';

export class GoogleDriveService {
  private oauth2Client: any;
  private drive: any;

  constructor() {
    this.oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI
    );

    this.drive = google.drive({ version: 'v3', auth: this.oauth2Client });
  }

  /**
   * Set access token for authenticated requests
   */
  setAccessToken(accessToken: string): void {
    this.oauth2Client.setCredentials({
      access_token: accessToken,
    });
  }

  /**
   * Upload a file to Google Drive
   */
  async uploadFile(
    filePath: string,
    fileName: string,
    mimeType: string = 'text/csv'
  ): Promise<{ fileId: string; shareableLink: string }> {
    logger.info(`Uploading file to Google Drive: ${fileName}`);

    try {
      const fileMetadata = {
        name: fileName,
      };

      const media = {
        mimeType,
        body: fs.createReadStream(filePath),
      };

      const response = await this.drive.files.create({
        requestBody: fileMetadata,
        media: media,
        fields: 'id, webViewLink, webContentLink',
      });

      const fileId = response.data.id;

      // Make file shareable
      await this.drive.permissions.create({
        fileId: fileId,
        requestBody: {
          role: 'reader',
          type: 'anyone',
        },
      });

      const shareableLink = response.data.webViewLink;

      logger.info(`File uploaded successfully: ${fileId}`);

      return {
        fileId,
        shareableLink,
      };
    } catch (error) {
      logger.error('Failed to upload file to Google Drive', error);
      throw new Error('Failed to upload file to Google Drive');
    }
  }

  /**
   * Delete a file from Google Drive
   */
  async deleteFile(fileId: string): Promise<void> {
    logger.info(`Deleting file from Google Drive: ${fileId}`);

    try {
      await this.drive.files.delete({
        fileId: fileId,
      });

      logger.info(`File deleted: ${fileId}`);
    } catch (error) {
      logger.error('Failed to delete file from Google Drive', error);
      throw error;
    }
  }

  /**
   * Get OAuth authorization URL
   */
  getAuthUrl(): string {
    const scopes = [
      'https://www.googleapis.com/auth/drive.file',
    ];

    return this.oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: scopes,
    });
  }

  /**
   * Exchange authorization code for tokens
   */
  async getTokens(code: string): Promise<any> {
    const { tokens } = await this.oauth2Client.getToken(code);
    this.oauth2Client.setCredentials(tokens);
    return tokens;
  }
}

export default GoogleDriveService;
