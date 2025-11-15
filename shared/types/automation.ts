/**
 * Browser Automation Types
 * Used by the headless automation engine
 */

export interface XPathSelector {
  path: string;
  description: string;
  timeout?: number;
}

export interface SimpleAudienceSelectors {
  // Navigation
  createAudienceButton: string;
  audienceTable: string;

  // Filters
  businessFiltersTab: string;
  financialFiltersTab: string;
  personalFiltersTab: string;
  familyFiltersTab: string;
  housingFiltersTab: string;
  locationFiltersTab: string;
  contactFiltersTab: string;
  intentFiltersTab: string;

  // Location inputs
  citiesInput: string;
  statesInput: string;
  zipCodesInput: string;
  locationLoadingSpinner: string;
  locationContinueButton: string;

  // Intent
  premadeIntentSearch: string;
  customKeywordInput: string;
  aiIntentTextarea: string;
  aiGenerateButton: string;
  intentScoreLow: string;
  intentScoreMedium: string;
  intentScoreHigh: string;
  intentContinueButton: string;

  // Preview & Generate
  previewButtonMid: string;
  previewButtonTop: string;
  previewLoader: string;
  previewCount: string;
  generateButton: string;
  generateConfirmPopup: string;
  generateConfirmButton: string;

  // Table columns
  tableNameColumn: string;
  tableStatusColumn: string;
  tableSizeColumn: string;
  tableCreatedColumn: string;
  tableRefreshedColumn: string;
  tableActionsColumn: string;

  // Action buttons
  refreshButton: string;
  editButton: string;
  viewStudioButton: string;
  downloadButton: string;
  webhookButton: string;
  duplicateButton: string;
  deleteButton: string;

  // Refresh popup
  refreshPopup: string;
  refreshScheduleDropdown: string;
  refreshNowButton: string;
  refreshScheduleConfirm: string;

  // Download popup
  downloadPopup: string;
  downloadList: string;
  downloadLatestButton: string;

  // Webhook popup
  webhookPopup: string;
  webhookUrlInput: string;
  webhookTestButton: string;
  webhookAddButton: string;

  // Duplicate popup
  duplicatePopup: string;
  duplicateNameInput: string;
  duplicateConfirmButton: string;

  // Delete popup
  deletePopup: string;
  deleteConfirmButton: string;
  deleteCancelButton: string;
}

export interface AutomationState {
  currentStep: string;
  isRunning: boolean;
  error?: string;
  retryCount: number;
  maxRetries: number;
}

export interface WaitOptions {
  timeout?: number;
  polling?: number;
  throwOnTimeout?: boolean;
}

export interface ClickOptions {
  delay?: number;
  waitForNavigation?: boolean;
  retries?: number;
}

export interface TypeOptions {
  delay?: number;
  clear?: boolean;
  pressEnter?: boolean;
}
