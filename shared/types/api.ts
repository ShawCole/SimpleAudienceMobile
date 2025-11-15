/**
 * API Request/Response Types
 * Defines the contract between mobile UI and backend API
 */

import { AudienceFilters, AudienceMetadata, AudienceStatus, DownloadEntry, RefreshSchedule, Webhook } from './audience';

// Request types
export interface CreateAudienceRequest {
  name: string;
  filters: AudienceFilters;
}

export interface UpdateAudienceRequest {
  id: string;
  name?: string;
  filters?: Partial<AudienceFilters>;
}

export interface RefreshAudienceRequest {
  id: string;
  schedule?: RefreshSchedule;
}

export interface DuplicateAudienceRequest {
  id: string;
  newName: string;
}

export interface DeleteAudienceRequest {
  id: string;
}

export interface AddWebhookRequest {
  audienceId: string;
  url: string;
  events: ('completed' | 'refreshed' | 'csv_ready' | 'failed')[];
}

export interface GenerateIntentRequest {
  prompt: string;
}

export interface DownloadFileRequest {
  audienceId: string;
  downloadId?: string; // If not provided, downloads latest
}

// Response types
export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: any;
  };
  timestamp: Date;
}

export interface PreviewResponse {
  audienceId: string;
  previewSize: number;
  estimatedTime?: number;
}

export interface GenerateResponse {
  audienceId: string;
  status: AudienceStatus;
  queuePosition?: number;
}

export interface AudienceListResponse {
  audiences: AudienceMetadata[];
  total: number;
  page: number;
  pageSize: number;
}

export interface AudienceDetailResponse {
  audience: AudienceMetadata;
  downloads: DownloadEntry[];
  webhooks: Webhook[];
}

export interface GenerateIntentResponse {
  keywords: string[];
  suggestedScore: 'low' | 'medium' | 'high';
}

export interface WebhookTestResponse {
  success: boolean;
  statusCode?: number;
  responseTime?: number;
  error?: string;
}

export interface DownloadListResponse {
  downloads: DownloadEntry[];
  total: number;
}

export interface UploadToGoogleDriveRequest {
  fileId: string;
  fileName: string;
}

export interface GoogleDriveUploadResponse {
  driveFileId: string;
  shareableLink: string;
  fileName: string;
}
