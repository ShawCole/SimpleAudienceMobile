/**
 * Backend Server Entry Point
 * Express API server with automation layer
 */

import express, { Application } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import logger from './utils/logger';
import DatabaseService from './services/database';
import AudienceService from './services/audience-service';
import GoogleDriveService from './services/google-drive-service';
import { createRouter } from './api/routes';

// Load environment variables
dotenv.config({ path: path.join(__dirname, '../.env') });

const PORT = process.env.PORT || 3001;

class Server {
  private app: Application;
  private db: DatabaseService;
  private audienceService: AudienceService;
  private driveService: GoogleDriveService;

  constructor() {
    this.app = express();
    this.db = new DatabaseService();
    this.audienceService = new AudienceService(this.db);
    this.driveService = new GoogleDriveService();

    this.initializeMiddleware();
    this.initializeRoutes();
    this.initializeErrorHandling();
  }

  /**
   * Initialize Express middleware
   */
  private initializeMiddleware(): void {
    // CORS
    this.app.use(
      cors({
        origin: process.env.CORS_ORIGIN || '*',
        methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
        allowedHeaders: ['Content-Type', 'Authorization'],
      })
    );

    // JSON body parser
    this.app.use(express.json());
    this.app.use(express.urlencoded({ extended: true }));

    // Request logging
    this.app.use((req, res, next) => {
      logger.info(`${req.method} ${req.path}`, {
        query: req.query,
        ip: req.ip,
      });
      next();
    });
  }

  /**
   * Initialize API routes
   */
  private initializeRoutes(): void {
    const router = createRouter(this.audienceService, this.driveService);

    // Mount routes
    this.app.use('/api', router);

    // Root endpoint
    this.app.get('/', (req, res) => {
      res.json({
        name: 'SimpleAudience Mobile API',
        version: '1.0.0',
        status: 'running',
        endpoints: {
          health: '/api/health',
          audiences: '/api/audiences',
          createAudience: 'POST /api/audiences',
          refreshAudience: 'POST /api/audiences/:id/refresh',
          duplicateAudience: 'POST /api/audiences/:id/duplicate',
          deleteAudience: 'DELETE /api/audiences/:id',
          generateIntent: 'POST /api/intent/generate',
          uploadToDrive: 'POST /api/drive/upload',
        },
      });
    });
  }

  /**
   * Initialize error handling
   */
  private initializeErrorHandling(): void {
    // 404 handler
    this.app.use((req, res) => {
      res.status(404).json({
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: `Route not found: ${req.method} ${req.path}`,
        },
        timestamp: new Date(),
      });
    });

    // Global error handler
    this.app.use((err: any, req: any, res: any, next: any) => {
      logger.error('Unhandled error', err);

      res.status(err.status || 500).json({
        success: false,
        error: {
          code: err.code || 'INTERNAL_SERVER_ERROR',
          message: err.message || 'An unexpected error occurred',
          details: process.env.NODE_ENV === 'development' ? err.stack : undefined,
        },
        timestamp: new Date(),
      });
    });
  }

  /**
   * Start the server
   */
  public start(): void {
    this.app.listen(PORT, () => {
      logger.info(`Server started on port ${PORT}`);
      logger.info(`Environment: ${process.env.NODE_ENV || 'development'}`);
      logger.info(`API available at http://localhost:${PORT}/api`);
    });
  }

  /**
   * Graceful shutdown
   */
  public async shutdown(): Promise<void> {
    logger.info('Shutting down server...');

    try {
      await this.audienceService.close();
      this.db.close();
      logger.info('Server shut down successfully');
      process.exit(0);
    } catch (error) {
      logger.error('Error during shutdown', error);
      process.exit(1);
    }
  }
}

// Create and start server
const server = new Server();
server.start();

// Handle shutdown signals
process.on('SIGTERM', () => server.shutdown());
process.on('SIGINT', () => server.shutdown());

// Handle uncaught errors
process.on('uncaughtException', (error) => {
  logger.error('Uncaught exception', error);
  server.shutdown();
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled promise rejection', { reason, promise });
});

export default server;
