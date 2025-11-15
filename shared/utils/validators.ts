/**
 * Validation utilities for audience filters and inputs
 */

export function isValidEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

export function isValidUrl(url: string): boolean {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}

export function isValidZipCode(zip: string): boolean {
  // US ZIP code (5 digits or 5+4 format)
  const zipRegex = /^\d{5}(-\d{4})?$/;
  return zipRegex.test(zip);
}

export function parseCommaSeparated(input: string): string[] {
  return input
    .split(',')
    .map(item => item.trim())
    .filter(item => item.length > 0);
}

export function validateLocationInput(input: string, type: 'city' | 'state' | 'zip'): {
  valid: boolean;
  items: string[];
  errors: string[];
} {
  const items = parseCommaSeparated(input);
  const errors: string[] = [];

  if (type === 'zip') {
    items.forEach(zip => {
      if (!isValidZipCode(zip)) {
        errors.push(`Invalid ZIP code: ${zip}`);
      }
    });
  }

  if (type === 'state') {
    items.forEach(state => {
      if (state.length !== 2) {
        errors.push(`State codes must be 2 characters: ${state}`);
      }
    });
  }

  return {
    valid: errors.length === 0,
    items,
    errors,
  };
}

export function sanitizeAudienceName(name: string): string {
  // Remove special characters, keep alphanumeric, spaces, hyphens, underscores
  return name.replace(/[^a-zA-Z0-9\s\-_]/g, '').trim();
}

export function validateAudienceName(name: string): {
  valid: boolean;
  error?: string;
} {
  if (!name || name.trim().length === 0) {
    return { valid: false, error: 'Audience name is required' };
  }

  if (name.length < 3) {
    return { valid: false, error: 'Audience name must be at least 3 characters' };
  }

  if (name.length > 100) {
    return { valid: false, error: 'Audience name must be less than 100 characters' };
  }

  return { valid: true };
}
