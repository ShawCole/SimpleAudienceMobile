/**
 * API Routes
 * REST API endpoints for audience operations
 */

import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import AudienceService from '../services/audience-service';
import GoogleDriveService from '../services/google-drive-service';
import logger from '../utils/logger';
import {
  CreateAudienceRequest,
  RefreshAudienceRequest,
  DuplicateAudienceRequest,
  AddWebhookRequest,
  GenerateIntentRequest,
  UploadToGoogleDriveRequest,
  ApiResponse,
} from '../../../shared/types/api';

export function createRouter(
  audienceService: AudienceService,
  driveService: GoogleDriveService
): Router {
  const router = Router();

  /**
   * Health check
   */
  router.get('/health', (req: Request, res: Response) => {
    res.json({ status: 'ok', timestamp: new Date() });
  });

  /**
   * Get all audiences
   */
  router.get('/audiences', async (req: Request, res: Response) => {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const pageSize = parseInt(req.query.pageSize as string) || 20;

      const result = audienceService.getAllAudiences(page, pageSize);

      const response: ApiResponse = {
        success: true,
        data: result,
        timestamp: new Date(),
      };

      res.json(response);
    } catch (error) {
      logger.error('Failed to get audiences', error);
      const response: ApiResponse = {
        success: false,
        error: {
          code: 'GET_AUDIENCES_ERROR',
          message: error instanceof Error ? error.message : 'Unknown error',
        },
        timestamp: new Date(),
      };
      res.status(500).json(response);
    }
  });

  /**
   * Get audience by ID
   */
  router.get('/audiences/:id', async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const audience = audienceService.getAudience(id);

      if (!audience) {
        const response: ApiResponse = {
          success: false,
          error: {
            code: 'AUDIENCE_NOT_FOUND',
            message: `Audience not found: ${id}`,
          },
          timestamp: new Date(),
        };
        return res.status(404).json(response);
      }

      const response: ApiResponse = {
        success: true,
        data: { audience },
        timestamp: new Date(),
      };

      res.json(response);
    } catch (error) {
      logger.error('Failed to get audience', error);
      const response: ApiResponse = {
        success: false,
        error: {
          code: 'GET_AUDIENCE_ERROR',
          message: error instanceof Error ? error.message : 'Unknown error',
        },
        timestamp: new Date(),
      };
      res.status(500).json(response);
    }
  });

  /**
   * Create a new audience
   */
  router.post('/audiences', async (req: Request, res: Response) => {
    try {
      const { name, filters }: CreateAudienceRequest = req.body;

      if (!name || !filters) {
        const response: ApiResponse = {
          success: false,
          error: {
            code: 'INVALID_REQUEST',
            message: 'Name and filters are required',
          },
          timestamp: new Date(),
        };
        return res.status(400).json(response);
      }

      const audience = await audienceService.createAudience(name, filters);

      const response: ApiResponse = {
        success: true,
        data: { audience },
        timestamp: new Date(),
      };

      res.status(201).json(response);
    } catch (error) {
      logger.error('Failed to create audience', error);
      const response: ApiResponse = {
        success: false,
        error: {
          code: 'CREATE_AUDIENCE_ERROR',
          message: error instanceof Error ? error.message : 'Unknown error',
        },
        timestamp: new Date(),
      };
      res.status(500).json(response);
    }
  });

  /**
   * Refresh an audience
   */
  router.post('/audiences/:id/refresh', async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { schedule }: RefreshAudienceRequest = req.body;

      await audienceService.refreshAudience(id, schedule);

      const response: ApiResponse = {
        success: true,
        data: { message: 'Audience refresh started' },
        timestamp: new Date(),
      };

      res.json(response);
    } catch (error) {
      logger.error('Failed to refresh audience', error);
      const response: ApiResponse = {
        success: false,
        error: {
          code: 'REFRESH_AUDIENCE_ERROR',
          message: error instanceof Error ? error.message : 'Unknown error',
        },
        timestamp: new Date(),
      };
      res.status(500).json(response);
    }
  });

  /**
   * Duplicate an audience
   */
  router.post('/audiences/:id/duplicate', async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { newName }: DuplicateAudienceRequest = req.body;

      if (!newName) {
        const response: ApiResponse = {
          success: false,
          error: {
            code: 'INVALID_REQUEST',
            message: 'New name is required',
          },
          timestamp: new Date(),
        };
        return res.status(400).json(response);
      }

      const newAudience = await audienceService.duplicateAudience(id, newName);

      const response: ApiResponse = {
        success: true,
        data: { audience: newAudience },
        timestamp: new Date(),
      };

      res.status(201).json(response);
    } catch (error) {
      logger.error('Failed to duplicate audience', error);
      const response: ApiResponse = {
        success: false,
        error: {
          code: 'DUPLICATE_AUDIENCE_ERROR',
          message: error instanceof Error ? error.message : 'Unknown error',
        },
        timestamp: new Date(),
      };
      res.status(500).json(response);
    }
  });

  /**
   * Delete an audience
   */
  router.delete('/audiences/:id', async (req: Request, res: Response) => {
    try {
      const { id } = req.params;

      await audienceService.deleteAudience(id);

      const response: ApiResponse = {
        success: true,
        data: { message: 'Audience deleted successfully' },
        timestamp: new Date(),
      };

      res.json(response);
    } catch (error) {
      logger.error('Failed to delete audience', error);
      const response: ApiResponse = {
        success: false,
        error: {
          code: 'DELETE_AUDIENCE_ERROR',
          message: error instanceof Error ? error.message : 'Unknown error',
        },
        timestamp: new Date(),
      };
      res.status(500).json(response);
    }
  });

  /**
   * Generate AI intent keywords
   */
  router.post('/intent/generate', async (req: Request, res: Response) => {
    try {
      const { prompt }: GenerateIntentRequest = req.body;

      if (!prompt || prompt.length < 10) {
        const response: ApiResponse = {
          success: false,
          error: {
            code: 'INVALID_REQUEST',
            message: 'Prompt must be at least 10 characters',
          },
          timestamp: new Date(),
        };
        return res.status(400).json(response);
      }

      // Placeholder - real implementation would call SimpleAudience AI
      const keywords = [
        'example keyword 1',
        'example keyword 2',
        'example keyword 3',
      ];

      const response: ApiResponse = {
        success: true,
        data: {
          keywords,
          suggestedScore: 'medium',
        },
        timestamp: new Date(),
      };

      res.json(response);
    } catch (error) {
      logger.error('Failed to generate intent', error);
      const response: ApiResponse = {
        success: false,
        error: {
          code: 'GENERATE_INTENT_ERROR',
          message: error instanceof Error ? error.message : 'Unknown error',
        },
        timestamp: new Date(),
      };
      res.status(500).json(response);
    }
  });

  /**
   * Upload file to Google Drive
   */
  router.post('/drive/upload', async (req: Request, res: Response) => {
    try {
      const { fileId, fileName }: UploadToGoogleDriveRequest = req.body;

      if (!fileId || !fileName) {
        const response: ApiResponse = {
          success: false,
          error: {
            code: 'INVALID_REQUEST',
            message: 'File ID and name are required',
          },
          timestamp: new Date(),
        };
        return res.status(400).json(response);
      }

      // Placeholder - real implementation would handle actual file upload
      const result = {
        driveFileId: uuidv4(),
        shareableLink: 'https://drive.google.com/file/d/example',
        fileName,
      };

      const response: ApiResponse = {
        success: true,
        data: result,
        timestamp: new Date(),
      };

      res.json(response);
    } catch (error) {
      logger.error('Failed to upload to Google Drive', error);
      const response: ApiResponse = {
        success: false,
        error: {
          code: 'GOOGLE_DRIVE_UPLOAD_ERROR',
          message: error instanceof Error ? error.message : 'Unknown error',
        },
        timestamp: new Date(),
      };
      res.status(500).json(response);
    }
  });

  /**
   * Get Google Drive OAuth URL
   */
  router.get('/auth/google/url', (req: Request, res: Response) => {
    try {
      const authUrl = driveService.getAuthUrl();

      const response: ApiResponse = {
        success: true,
        data: { authUrl },
        timestamp: new Date(),
      };

      res.json(response);
    } catch (error) {
      logger.error('Failed to get Google auth URL', error);
      const response: ApiResponse = {
        success: false,
        error: {
          code: 'AUTH_URL_ERROR',
          message: error instanceof Error ? error.message : 'Unknown error',
        },
        timestamp: new Date(),
      };
      res.status(500).json(response);
    }
  });

  /**
   * Handle Google OAuth callback
   */
  router.get('/auth/google/callback', async (req: Request, res: Response) => {
    try {
      const { code } = req.query;

      if (!code) {
        return res.status(400).send('Authorization code required');
      }

      const tokens = await driveService.getTokens(code as string);

      res.json({
        success: true,
        data: { tokens },
      });
    } catch (error) {
      logger.error('Failed to exchange auth code', error);
      res.status(500).send('Authentication failed');
    }
  });

  return router;
}
