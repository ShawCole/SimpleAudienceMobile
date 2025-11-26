/**
 * Audience Types and Interfaces
 * Shared between backend automation and mobile UI
 */

import { FILTER_TAXONOMY } from '../taxonomy/filter-taxonomy';

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

export type AudienceMode = 'b2b' | 'b2c';
export type IntentMode = 'none' | 'custom' | 'ai' | 'premade';
export type BinaryChoice = 'yes' | 'no' | 'any';
export type ToggleChoice = 'on' | 'off' | 'any';

export interface IndexedOptionValue {
  index: number;
  label: string;
}

export interface NumericRange {
  min?: number;
  max?: number;
}

export interface LocationFilters {
  cities: string[];
  states: string[];
  zipCodes: string[];
}

export interface IntentFilters {
  mode: IntentMode;
  keywords: string[];
  aiPrompt?: string;
  score?: IntentScore;
  audienceType?: AudienceMode;
  premadeTopics?: IndexedOptionValue[];
}

export interface BusinessFilters {
  seniority?: IndexedOptionValue[];
  departments?: IndexedOptionValue[];
  industries?: IndexedOptionValue[];
  employeeCount?: IndexedOptionValue[];
  companyRevenue?: IndexedOptionValue[];
}

export interface FinancialFilters {
  incomeRange?: IndexedOptionValue[];
  netWorth?: IndexedOptionValue[];
  creditRating?: IndexedOptionValue[];
  newCreditRange?: IndexedOptionValue[];
  investment?: IndexedOptionValue[];
  craCode?: IndexedOptionValue[];
  occupationGroup?: IndexedOptionValue[];
  occupationType?: IndexedOptionValue[];
  creditCardUser?: IndexedOptionValue[];
  mortgageAmount?: NumericRange;
}

export interface PersonalFilters {
  ageRange?: NumericRange;
  gender?: IndexedOptionValue[];
  ethnicity?: IndexedOptionValue[];
  language?: IndexedOptionValue[];
  education?: IndexedOptionValue[];
  smoker?: IndexedOptionValue[];
}

export interface FamilyFilters {
  married?: IndexedOptionValue[];
  maritalStatus?: IndexedOptionValue[];
  singleParent?: IndexedOptionValue[];
  generationsInHousehold?: IndexedOptionValue[];
  children?: IndexedOptionValue[];
}

export interface HousingFilters {
  homeownerStatus?: IndexedOptionValue[];
  dwellingType?: IndexedOptionValue[];
  yearBuilt?: NumericRange;
  purchasePrice?: NumericRange;
  purchaseYear?: NumericRange;
  estimatedHomeValue?: IndexedOptionValue[];
}

export interface ContactFilters {
  verifiedPersonalEmails?: ToggleChoice;
  verifiedBusinessEmails?: ToggleChoice;
  validPhones?: ToggleChoice;
  skipTracedWireless?: ToggleChoice;
  skipTracedWirelessB2B?: ToggleChoice;
}

export interface AdvancedFilters {
  business?: BusinessFilters;
  financial?: FinancialFilters;
  personal?: PersonalFilters;
  family?: FamilyFilters;
  housing?: HousingFilters;
  contact?: ContactFilters;
}

export interface AudiencePayload {
  name: string;
  /**
   * Human-friendly client label for this audience
   * Optional for backwards compatibility with existing payloads,
   * but required by the create-audience UI for new audiences.
   */
  clientName?: string;
  /**
   * Optional freeform price note for how much the list will be sold for.
   * Stored as a string so users can include currency symbols and ranges.
   */
  listPrice?: string;
  location: LocationFilters;
  intent: IntentFilters;
  filters: AdvancedFilters;
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
  payload: AudiencePayload;
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

export type AudienceFilters = AdvancedFilters;
export const TAXONOMY = FILTER_TAXONOMY;

