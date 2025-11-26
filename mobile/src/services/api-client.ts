/**
 * API Client
 * HTTP client for communicating with backend API
 */

import axios, { AxiosInstance, AxiosError } from 'axios';
import {
  ApiResponse,
  CreateAudienceRequest,
  RefreshAudienceRequest,
  DuplicateAudienceRequest,
  GenerateIntentRequest,
  AudienceListResponse,
  AudienceMetadata,
  AudiencePayload,
  PreviewResponse,
} from '../../../shared/types';

class ApiClient {
  private client: AxiosInstance;

  constructor() {
    this.client = axios.create({
      baseURL: process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api',
      timeout: 30000,
      headers: {
        'Content-Type': 'application/json',
      },
    });

    // Response interceptor
    this.client.interceptors.response.use(
      (response) => response,
      (error: AxiosError) => {
        console.error('API Error:', error.response?.data || error.message);
        return Promise.reject(error);
      }
    );
  }

  /**
   * Get all audiences
   */
  async getAudiences(page: number = 1, pageSize: number = 20): Promise<AudienceListResponse> {
    const response = await this.client.get<ApiResponse<AudienceListResponse>>('/audiences', {
      params: { page, pageSize },
    });
    return response.data.data!;
  }

  /**
   * Get audience by ID
   */
  async getAudience(id: string): Promise<AudienceMetadata> {
    const response = await this.client.get<ApiResponse>(`/audiences/${id}`);
    return response.data.data!.audience;
  }

  /**
   * Create a new audience
   */
  async createAudience(data: CreateAudienceRequest): Promise<AudienceMetadata> {
    const response = await this.client.post<ApiResponse>('/audiences', data);
    return response.data.data!.audience;
  }

  /**
   * Refresh an audience
   */
  async refreshAudience(id: string, data: Partial<RefreshAudienceRequest> = {}): Promise<void> {
    await this.client.post(`/audiences/${id}/refresh`, data);
  }

  /**
   * Duplicate an audience
   */
  async duplicateAudience(id: string, newName: string): Promise<AudienceMetadata> {
    const response = await this.client.post<ApiResponse>(`/audiences/${id}/duplicate`, {
      newName,
    });
    return response.data.data!.audience;
  }

  /**
   * Delete an audience
   */
  async deleteAudience(id: string): Promise<void> {
    await this.client.delete(`/audiences/${id}`);
  }

  /**
   * Generate AI intent keywords
   */
  async generateIntent(
    prompt: string,
    draft?: AudiencePayload
  ): Promise<{ keywords: string[]; suggestedScore: string }> {
    const response = await this.client.post<ApiResponse>('/intent/generate', {
      prompt,
      draft,
    });
    return response.data.data!;
  }

  /**
   * Preview an audience (placeholder – backend route may not yet exist)
   */
  async previewAudience(draft: AudiencePayload): Promise<PreviewResponse> {
    const response = await this.client.post<ApiResponse<PreviewResponse>>('/audiences/preview', {
      draft,
    });
    return response.data.data!;
  }

  /**
   * Upload file to Google Drive
   */
  async uploadToGoogleDrive(fileId: string, fileName: string): Promise<any> {
    const response = await this.client.post<ApiResponse>('/drive/upload', {
      fileId,
      fileName,
    });
    return response.data.data!;
  }

  /**
   * Get Google Drive auth URL
   */
  async getGoogleAuthUrl(): Promise<string> {
    const response = await this.client.get<ApiResponse>('/auth/google/url');
    return response.data.data!.authUrl;
  }

  /**
   * Health check
   */
  async healthCheck(): Promise<{ status: string }> {
    const response = await this.client.get<ApiResponse>('/health');
    return response.data.data!;
  }
}

export const apiClient = new ApiClient();
export default apiClient;
