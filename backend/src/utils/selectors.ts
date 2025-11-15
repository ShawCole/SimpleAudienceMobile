/**
 * SimpleAudience XPath Selectors
 * NOTE: These are placeholder XPaths and need to be updated based on actual SimpleAudience DOM structure
 */

export const SELECTORS = {
  // Navigation
  createAudienceButton: '//button[contains(text(), "Create Audience")]',
  audienceTable: '//table[contains(@class, "audience-table")]',
  audienceTableBody: '//table[contains(@class, "audience-table")]//tbody',

  // Main filter tabs
  businessFiltersTab: '//button[contains(text(), "Business")]',
  financialFiltersTab: '//button[contains(text(), "Financial")]',
  personalFiltersTab: '//button[contains(text(), "Personal")]',
  familyFiltersTab: '//button[contains(text(), "Family")]',
  housingFiltersTab: '//button[contains(text(), "Housing")]',
  locationFiltersTab: '//button[contains(text(), "Location")]',
  contactFiltersTab: '//button[contains(text(), "Contact")]',
  intentFiltersTab: '//button[contains(text(), "Intent")]',

  // Location inputs
  citiesInput: '//input[@placeholder="Enter cities" or @name="cities"]',
  statesInput: '//input[@placeholder="Enter states" or @name="states"]',
  zipCodesInput: '//input[@placeholder="Enter zip codes" or @name="zipCodes"]',
  locationLoadingSpinner: '//*[contains(@class, "spinner") or contains(@class, "loading")]',
  locationContinueButton: '//button[contains(text(), "Continue")]',

  // Intent section
  premadeIntentSearch: '//input[@placeholder="Search premade intents"]',
  customKeywordInput: '//input[@placeholder="Enter keywords"]',
  aiIntentTextarea: '//textarea[@placeholder="Describe your target audience"]',
  aiGenerateButton: '//button[contains(text(), "Generate") and contains(text(), "AI")]',
  intentScoreLow: '//button[contains(text(), "Low") or @data-score="low"]',
  intentScoreMedium: '//button[contains(text(), "Medium") or @data-score="medium"]',
  intentScoreHigh: '//button[contains(text(), "High") or @data-score="high"]',
  intentContinueButton: '//button[contains(text(), "Continue")]',

  // Preview and Generate
  previewButtonMid: '//button[contains(text(), "Preview Audience")]',
  previewButtonTop: '//button[contains(@class, "preview")]',
  previewLoader: '//*[contains(@class, "preview-loader") or contains(@class, "calculating")]',
  previewCount: '//*[contains(@class, "preview-count") or contains(text(), "Results")]',
  generateButton: '//button[contains(text(), "Generate Audience")]',
  generateConfirmPopup: '//*[contains(@class, "confirm-modal") or contains(@role, "dialog")]',
  generateConfirmButton: '//button[contains(text(), "Confirm") or contains(text(), "Yes")]',

  // Audience table columns
  tableRow: (audienceName: string) => `//tr[contains(., "${audienceName}")]`,
  tableNameColumn: '//td[1]',
  tableStatusColumn: '//td[2]',
  tableSizeColumn: '//td[3]',
  tableCreatedColumn: '//td[4]',
  tableRefreshedColumn: '//td[5]',
  tableActionsColumn: '//td[last()]',

  // Action buttons (relative to row)
  rowActionButton: (rowXPath: string, action: string) =>
    `${rowXPath}//button[@title="${action}" or contains(text(), "${action}")]`,

  // Popups
  refreshPopup: '//*[contains(@class, "refresh-modal")]',
  refreshScheduleDropdown: '//select[@name="schedule" or contains(@class, "schedule-select")]',
  refreshNowButton: '//button[contains(text(), "Refresh Now")]',
  refreshScheduleConfirm: '//button[contains(text(), "Save") or contains(text(), "Confirm")]',

  downloadPopup: '//*[contains(@class, "download-modal")]',
  downloadList: '//div[contains(@class, "download-list")]',
  downloadListItem: '//div[contains(@class, "download-item")]',
  downloadLatestButton: '//button[contains(text(), "Download Latest")]',

  webhookPopup: '//*[contains(@class, "webhook-modal")]',
  webhookUrlInput: '//input[@name="webhookUrl" or @placeholder="Webhook URL"]',
  webhookTestButton: '//button[contains(text(), "Test")]',
  webhookAddButton: '//button[contains(text(), "Add Webhook")]',

  duplicatePopup: '//*[contains(@class, "duplicate-modal")]',
  duplicateNameInput: '//input[@name="audienceName" or @placeholder="Audience name"]',
  duplicateConfirmButton: '//button[contains(text(), "Duplicate")]',

  deletePopup: '//*[contains(@class, "delete-modal") or contains(@class, "confirm-delete")]',
  deleteConfirmButton: '//button[contains(text(), "Delete") or contains(text(), "Confirm")]',
  deleteCancelButton: '//button[contains(text(), "Cancel")]',

  // Status indicators
  statusBadge: (status: string) => `//*[contains(@class, "status") and contains(text(), "${status}")]`,

  // Close buttons for popups
  closePopupButton: '//button[contains(@class, "close") or @aria-label="Close"]',
  popupOverlay: '//*[contains(@class, "modal-overlay") or contains(@class, "backdrop")]',
};
