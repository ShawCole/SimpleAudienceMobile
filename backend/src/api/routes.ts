/**
 * API Routes
 * REST API endpoints for audience operations
 */

import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import AudienceService from '../services/audience-service';
import GoogleDriveService from '../services/google-drive-service';
import { VacuumEngine } from '../automation/vacuum'; // Vacuum Integration
import { estimateAudienceSize, getFilterImpacts } from '../services/audience-estimator';
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
   * Audience Size Estimator — instant local prediction (no Puppeteer needed)
   * Uses calibrated retention multipliers from probe grids + Layer 1 sweeps
   */
  router.post('/audiences/estimate', async (req: Request, res: Response) => {
    try {
      const { filters } = req.body; // Array of FilterSpec objects
      if (!Array.isArray(filters)) {
        res.status(400).json({ success: false, error: { code: 'BAD_REQUEST', message: 'filters must be an array' } });
        return;
      }

      const result = estimateAudienceSize(filters);
      const response: ApiResponse = {
        success: true,
        data: result,
        timestamp: new Date(),
      };
      res.json(response);
    } catch (error: any) {
      const response: ApiResponse = {
        success: false,
        error: {
          code: 'ESTIMATE_ERROR',
          message: error.message || 'Estimation failed',
        },
        timestamp: new Date(),
      };
      res.status(500).json(response);
    }
  });

  /**
   * Filter Impact Analysis — predict how each available filter would affect audience size
   * Given current filters, returns retention predictions for all remaining filter options.
   * Powers real-time "this filter will reduce your audience by X%" UI guidance.
   */
  router.post('/audiences/filter-impact', async (req: Request, res: Response) => {
    try {
      const { filters } = req.body;
      if (!Array.isArray(filters)) {
        res.status(400).json({ success: false, error: { code: 'BAD_REQUEST', message: 'filters must be an array' } });
        return;
      }

      const result = getFilterImpacts(filters);
      const response: ApiResponse = {
        success: true,
        data: result,
        timestamp: new Date(),
      };
      res.json(response);
    } catch (error: any) {
      const response: ApiResponse = {
        success: false,
        error: {
          code: 'FILTER_IMPACT_ERROR',
          message: error.message || 'Filter impact analysis failed',
        },
        timestamp: new Date(),
      };
      res.status(500).json(response);
    }
  });

  /**
   * Vacuum: Live Preview via Partner Injection
   * Connects to Partner Portal via Puppeteer to fetch real-time preview data
   */
  router.post('/audiences/preview', async (req: Request, res: Response) => {
    try {
      const payload = req.body; // Expects AudiencePayload structure
      logger.info('Starting Vacuum Preview...', { accountId: payload.accountId });

      const vacuumResult = await VacuumEngine.preview(payload);

      if (vacuumResult.success) {
        const response: ApiResponse = {
          success: true,
          // @ts-ignore - Extending ApiResponse dynamically for this specific endpoint contract
          source: 'remote',
          data: vacuumResult.data, // { count, preview, fullCount }
          debug: {
            raw: vacuumResult.raw,
            payloadSent: payload
          },
          timestamp: new Date(),
        };
        res.json(response);
      } else {
        const response: ApiResponse = {
          success: false,
          error: {
            code: 'REMOTE_ERROR',
            message: vacuumResult.error || 'Unknown remote error',
          },
          // @ts-ignore
          debug: {
            status: vacuumResult.status
          },
          timestamp: new Date(),
        };
        res.status(vacuumResult.status || 500).json(response);
      }

    } catch (error) {
      logger.error('Vacuum Preview Failed', error);
      const response: ApiResponse = {
        success: false,
        error: {
          code: 'VACUUM_PREVIEW_ERROR',
          message: error instanceof Error ? error.message : 'Unknown error',
        },
        timestamp: new Date(),
      };
      res.status(500).json(response);
    }
  });

  /**
   * Vacuum: Live Generate via Partner Injection
   * Commits the audience to the Partner Platform to begin file generation
   */
  router.post('/audiences/generate', async (req: Request, res: Response) => {
    try {
      const payload = req.body; // Expects AudiencePayload structure
      logger.info('Starting Vacuum Generate...', { accountId: payload.accountId });

      const rawResponse = await VacuumEngine.generate(payload);

      const response: ApiResponse = {
        success: true,
        data: {
          status: 'QUEUED',
          raw: rawResponse
        },
        timestamp: new Date(),
      };

      res.json(response);
    } catch (error) {
      logger.error('Vacuum Generate Failed', error);
      const response: ApiResponse = {
        success: false,
        error: {
          code: 'VACUUM_GENERATE_ERROR',
          message: error instanceof Error ? error.message : 'Unknown error',
        },
        timestamp: new Date(),
      };
      res.status(500).json(response);
    }
  });

  /**
   * Vacuum: Initialize Audience
   * Initialize audience on Partner Portal (Name -> Create -> Capture ID)
   */
  router.post('/vacuum/init', async (req: Request, res: Response) => {
    try {
      const { name } = req.body;
      if (!name) {
        return res.status(400).json({
          success: false,
          error: { code: 'MISSING_NAME', message: 'Audience name is required' }
        });
      }

      logger.info(`Received vacuum/init for name: ${name}`);
      const result = await VacuumEngine.initAudience(name);

      res.status(200).json({
        success: true,
        ...result
      });
    } catch (error: any) {
      logger.error('Vacuum Init Error:', error.message);
      res.status(500).json({
        success: false,
        error: {
          code: 'VACUUM_INIT_ERROR',
          message: error.message || 'Unknown error'
        }
      });
    }
  });

  /**
   * Vacuum: Pre-warm Session
   * Launches headed browser and performs login to prepare for injection
   */
  router.post('/vacuum/prewarm', async (req: Request, res: Response) => {
    try {
      logger.info('Pre-warming Vacuum Session...');
      await VacuumEngine.prewarm();
      res.json({ success: true, message: 'Vacuum pre-warmed' });
    } catch (error) {
      logger.error('Vacuum Pre-warm Failed', error);
      res.status(500).json({
        success: false,
        error: {
          code: 'VACUUM_PREWARM_ERROR',
          message: error instanceof Error ? error.message : 'Unknown error',
        },
      });
    }
  });

  /**
   * Vacuum: Navigate to audience edit page by name (read-only, safe)
   */
  router.post('/vacuum/navigate', async (req: Request, res: Response) => {
    try {
      const { name } = req.body;
      if (!name) return res.status(400).json({ success: false, error: { message: 'name is required' } });
      logger.info(`Navigating to audience: ${name}`);
      const result = await VacuumEngine.navigateToAudience(name);
      res.json(result);
    } catch (error: any) {
      logger.error('Navigate failed', error);
      res.status(500).json({ success: false, error: { code: 'NAVIGATE_ERROR', message: error.message } });
    }
  });

  /**
   * Vacuum: Take a screenshot of current browser state
   */
  router.post('/vacuum/screenshot', async (req: Request, res: Response) => {
    try {
      const { filename } = req.body || {};
      const result = await VacuumEngine.screenshot(filename);
      res.json(result);
    } catch (error: any) {
      logger.error('Screenshot failed', error);
      res.status(500).json({ success: false, error: { code: 'SCREENSHOT_ERROR', message: error.message } });
    }
  });

  /**
   * Vacuum: Get page DOM snapshot (buttons, links, inputs, tabs, etc.)
   */
  router.get('/vacuum/snapshot', async (req: Request, res: Response) => {
    try {
      const snapshot = await VacuumEngine.getPageSnapshot();
      res.json({ success: true, data: snapshot });
    } catch (error: any) {
      logger.error('Snapshot failed', error);
      res.status(500).json({ success: false, error: { code: 'SNAPSHOT_ERROR', message: error.message } });
    }
  });

  /**
   * Vacuum: Deep DOM analysis — full interactive surface map
   * Returns every clickable element, form input, heading, table, dialog,
   * with positions, aria labels, data attributes, and CSS paths.
   */
  router.get('/vacuum/analyze', async (req: Request, res: Response) => {
    try {
      const analysis = await VacuumEngine.deepAnalyze();
      res.json({ success: true, data: analysis });
    } catch (error: any) {
      logger.error('Deep analysis failed', error);
      res.status(500).json({ success: false, error: { code: 'ANALYZE_ERROR', message: error.message } });
    }
  });

  /**
   * Vacuum: Discover action ID by clicking a button
   * Clicks a button matching the given text and intercepts the Next.js server action request.
   * Returns the captured action ID, router state tree, request body, and response.
   *
   * Body: { buttonText: string, confirmText?: string, timeout?: number }
   */
  router.post('/vacuum/discover-action', async (req: Request, res: Response) => {
    try {
      const { buttonText, confirmText, timeout } = req.body;
      if (!buttonText) {
        return res.status(400).json({ success: false, error: { message: 'buttonText is required' } });
      }
      const result = await VacuumEngine.discoverActionByClick(buttonText, { confirmText, timeout });
      res.json({ success: true, data: result });
    } catch (error: any) {
      logger.error('Action discovery failed', error);
      res.status(500).json({ success: false, error: { code: 'DISCOVER_ERROR', message: error.message } });
    }
  });

  /**
   * Vacuum: Click a button by text and return the page state after
   * Useful for navigating through UI flows (save segment, open dialogs, etc.)
   *
   * Body: { buttonText: string, waitMs?: number }
   */
  router.post('/vacuum/click', async (req: Request, res: Response) => {
    try {
      const { buttonText, waitMs } = req.body;
      if (!buttonText) {
        return res.status(400).json({ success: false, error: { message: 'buttonText is required' } });
      }
      const { page } = await (VacuumEngine as any).getSession();
      const clicked = await page.evaluate((searchText: string) => {
        const lower = searchText.toLowerCase();
        const buttons = Array.from(document.querySelectorAll('button, [role="button"], a'));
        for (const btn of buttons) {
          const btnText = (btn.textContent || '').trim().toLowerCase();
          if (btnText.includes(lower) && (btn as HTMLElement).offsetParent !== null) {
            (btn as HTMLElement).click();
            return btnText;
          }
        }
        return null;
      }, buttonText);

      if (!clicked) {
        const allButtons = await page.evaluate(() =>
          Array.from(document.querySelectorAll('button'))
            .filter((b: any) => b.offsetParent !== null)
            .map((b: any) => (b.textContent || '').trim())
            .filter((t: string) => t.length > 0 && t.length < 80)
        );
        return res.status(404).json({ success: false, error: { message: `No button matching "${buttonText}"`, visibleButtons: allButtons } });
      }

      await new Promise(r => setTimeout(r, waitMs || 2000));
      const snapshot = await VacuumEngine.getPageSnapshot();
      res.json({ success: true, data: { clicked, snapshot } });
    } catch (error: any) {
      logger.error('Click failed', error);
      res.status(500).json({ success: false, error: { code: 'CLICK_ERROR', message: error.message } });
    }
  });

  /**
   * Vacuum: Navigate to a URL
   * Body: { url: string }
   */
  router.post('/vacuum/goto', async (req: Request, res: Response) => {
    try {
      const { url } = req.body;
      if (!url) return res.status(400).json({ success: false, error: { message: 'url is required' } });
      const { page } = await (VacuumEngine as any).getSession();
      await page.goto(url, { waitUntil: 'load', timeout: 60000 });
      await new Promise(r => setTimeout(r, 2000));
      const snapshot = await VacuumEngine.getPageSnapshot();
      res.json({ success: true, data: snapshot });
    } catch (error: any) {
      logger.error('Goto failed', error);
      res.status(500).json({ success: false, error: { code: 'GOTO_ERROR', message: error.message } });
    }
  });

  /**
   * Vacuum: Check Audience Status
   */
  router.get('/audiences/:id/status', async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const audience = audienceService.getAudience(id);

      if (!audience) {
        return res.status(404).json({ success: false, error: { message: 'Audience not found in local DB' } });
      }

      logger.info(`Checking Vacuum status for audience: ${audience.name}`);
      const result = await VacuumEngine.checkStatus(audience.name);

      res.json({
        success: true,
        data: result,
        timestamp: new Date()
      });
    } catch (error: any) {
      logger.error('Status check failed', error);
      res.status(500).json({
        success: false,
        error: { code: 'STATUS_CHECK_ERROR', message: error.message }
      });
    }
  });

  /**
   * Poll audience status until terminal state (Completed/Failed)
   * Uses audience name to find the correct row in IntentCore's dashboard table.
   */
  router.post('/audiences/:id/poll', async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const audience = audienceService.getAudience(id);

      if (!audience) {
        return res.status(404).json({ success: false, error: { message: 'Audience not found in local DB' } });
      }

      const timeoutMs = req.body?.timeoutMs || 600000;  // 10 min default
      const pollIntervalMs = req.body?.pollIntervalMs || 5000;

      logger.info(`Polling status for audience: "${audience.name}" (timeout: ${timeoutMs / 1000}s)`);
      const result = await VacuumEngine.pollUntilComplete(audience.name, timeoutMs, pollIntervalMs);

      res.json({
        success: true,
        data: result,
        timestamp: new Date()
      });
    } catch (error: any) {
      logger.error('Status poll failed', error);
      res.status(500).json({
        success: false,
        error: { code: 'STATUS_POLL_ERROR', message: error.message }
      });
    }
  });

  /**
   * Export audience CSV from IntentCore Studio (direct Studio navigation).
   */
  router.post('/audiences/export', async (req: Request, res: Response) => {
    try {
      const { intentcore_id } = req.body;

      if (!intentcore_id) {
        return res.status(400).json({
          success: false,
          error: { message: 'intentcore_id is required (the IntentCore audience UUID)' }
        });
      }

      logger.info(`Exporting audience CSV: ${intentcore_id}`);
      const result = await VacuumEngine.exportAudience(intentcore_id);

      if (!result.success) {
        return res.status(500).json({
          success: false,
          error: { code: 'EXPORT_FAILED', message: result.error }
        });
      }

      res.json({
        success: true,
        data: { csvUrl: result.csvUrl },
        timestamp: new Date()
      });
    } catch (error: any) {
      logger.error('Export failed', error);
      res.status(500).json({
        success: false,
        error: { code: 'EXPORT_ERROR', message: error.message }
      });
    }
  });

  /**
   * FULL POST-GENERATION RETRIEVAL
   *
   * After an audience has been generated, this endpoint:
   * 1. Navigates to the audience list page
   * 2. Finds the audience row by name
   * 3. Polls status until "Completed"
   * 4. Refreshes the page (required for download modal)
   * 5. Navigates to Studio
   * 6. Exports CSV via server action
   * 7. Returns the GCS download URL
   *
   * Body: { audience_name: string, intentcore_id: string, timeout_ms?: number }
   */
  router.post('/audiences/retrieve-csv', async (req: Request, res: Response) => {
    try {
      const { audience_name, intentcore_id, timeout_ms } = req.body;

      if (!audience_name || !intentcore_id) {
        return res.status(400).json({
          success: false,
          error: { message: 'audience_name and intentcore_id are required' }
        });
      }

      logger.info(`[Retrieve CSV] Starting for "${audience_name}" (${intentcore_id})`);
      const result = await VacuumEngine.retrieveGeneratedCSV(
        audience_name,
        intentcore_id,
        timeout_ms || 600000
      );

      if (!result.success) {
        return res.status(500).json({
          success: false,
          error: { code: 'RETRIEVE_FAILED', message: result.error, status: result.status }
        });
      }

      res.json({
        success: true,
        data: { csvUrl: result.csvUrl, status: result.status },
        timestamp: new Date()
      });
    } catch (error: any) {
      logger.error('Retrieve CSV failed', error);
      res.status(500).json({
        success: false,
        error: { code: 'RETRIEVE_ERROR', message: error.message }
      });
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
   * Create a new audience (Local DB Persistence)
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