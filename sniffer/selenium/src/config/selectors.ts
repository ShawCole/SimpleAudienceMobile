export const SELECTORS = {
  baseUrl: process.env.AUDLAB_BASE_URL || 'https://build.audiencelab.io',
  login: {
    email: 'input[type="email"]',
    password: 'input[type="password"]',
    submit: 'button[type="submit"]'
  },
  tabs: {
    business: "//button[contains(normalize-space(.), 'Business')]",
    financial: "//button[contains(normalize-space(.), 'Financial')]",
    personal: "//button[contains(normalize-space(.), 'Personal')]",
    family: "//button[contains(normalize-space(.), 'Family')]",
    housing: "//button[contains(normalize-space(.), 'Housing')]",
    contact: "//button[contains(normalize-space(.), 'Contact')]",
    intent: "//button[contains(normalize-space(.), 'Intent')]"
  },
  buttons: {
    preview: "//button[contains(normalize-space(.), 'Preview')]",
    buildAudience: "//button[contains(normalize-space(.), 'Build Audience')]"
  },
  filters: {
    business: {
      seniorityTrigger: "//div[contains(., 'Seniority')]//button[contains(@aria-expanded, 'false') or contains(@class, 'trigger')]",
      employeeCountTrigger: "//div[contains(., 'Employee Count')]//button"
    }
  }
} as const;
