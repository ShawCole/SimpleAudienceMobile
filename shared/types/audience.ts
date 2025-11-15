/**
 * Audience Types and Interfaces
 * Shared between backend automation and mobile UI
 */

export type AudienceStatus =
  | 'idle'
  | 'building'
  | 'previewing'
  | 'ready_to_generate'
  | 'generating'
  | 'in_queue'
  | 'processing'
  | 'hydrating'
  | 'completed'
  | 'failed'
  | 'refreshing';

export type IntentScore = 'low' | 'medium' | 'high';

export type RefreshSchedule =
  | 'manual'
  | 'everyday'
  | '3_days'
  | '7_days'
  | '14_days'
  | 'monthly';

export interface LocationFilter {
  cities?: string[];
  states?: string[];
  zipCodes?: string[];
}

export interface BusinessFilter {
  industries?: string[];
  companySize?: string[];
  revenue?: string[];
  sicCodes?: string[];
  naicsCodes?: string[];
}

export interface FinancialFilter {
  creditScore?: string[];
  homeValue?: string[];
  netWorth?: string[];
  income?: string[];
}

export interface PersonalFilter {
  age?: string[];
  gender?: string[];
  education?: string[];
  occupation?: string[];
}

export interface FamilyFilter {
  maritalStatus?: string[];
  childrenPresent?: boolean;
  childrenAges?: string[];
}

export interface HousingFilter {
  homeOwner?: boolean;
  homeType?: string[];
  lengthOfResidence?: string[];
}

export interface ContactFilter {
  emailType?: ('personal' | 'work')[];
  phoneType?: ('mobile' | 'landline')[];
  hasEmail?: boolean;
  hasPhone?: boolean;
  hasAddress?: boolean;
}

export interface IntentFilter {
  type: 'premade' | 'custom' | 'ai_generated';
  keywords?: string[];
  score?: IntentScore;
  aiPrompt?: string;
}

export interface AudienceFilters {
  location?: LocationFilter;
  business?: BusinessFilter;
  financial?: FinancialFilter;
  personal?: PersonalFilter;
  family?: FamilyFilter;
  housing?: HousingFilter;
  contact?: ContactFilter;
  intent?: IntentFilter;
}

export interface AudienceMetadata {
  id: string;
  name: string;
  status: AudienceStatus;
  size?: number;
  previewSize?: number;
  createdAt: Date;
  updatedAt: Date;
  lastRefreshed?: Date;
  refreshCount: number;
  nextRefresh?: Date;
  filters: AudienceFilters;
}

export interface DownloadEntry {
  id: string;
  audienceId: string;
  timestamp: Date;
  rowCount: number;
  fileSize: number;
  fileType: 'contacts' | 'companies' | 'activity' | 'full';
  downloadUrl: string;
  status: 'available' | 'generating' | 'expired';
}

export interface Webhook {
  id: string;
  audienceId: string;
  url: string;
  events: ('completed' | 'refreshed' | 'csv_ready' | 'failed')[];
  active: boolean;
  createdAt: Date;
  lastTriggered?: Date;
}

export interface AudienceOperation {
  type: 'create' | 'refresh' | 'edit' | 'duplicate' | 'delete' | 'download';
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  startedAt: Date;
  completedAt?: Date;
  error?: string;
}
