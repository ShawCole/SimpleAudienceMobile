/**
 * Payload validator for IntentCore audience payloads.
 * IntentCore silently accepts malformed payloads — this catches errors before injection.
 */

import { VALID_OPTIONS, AUTO_CORRECTIONS } from '../data/canonical-options';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ValidationError {
  field: string;
  value: string;
  message: string;
  validOptions?: string[];
  autoCorrection?: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: Array<{ field: string; message: string }>;
  corrected?: any;  // Auto-corrected payload if corrections were applied
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Resolve a dot-path to a value inside a nested object.
 * e.g. getNestedValue(payload, 'filters.filters.profile.incomeRange')
 */
function getNestedValue(obj: any, path: string): any {
  return path.split('.').reduce((cur, key) => (cur != null ? cur[key] : undefined), obj);
}

/**
 * Set a value at a dot-path inside a nested object (mutates).
 */
function setNestedValue(obj: any, path: string, value: any): void {
  const keys = path.split('.');
  let cur = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    if (cur[keys[i]] == null) cur[keys[i]] = {};
    cur = cur[keys[i]];
  }
  cur[keys[keys.length - 1]] = value;
}

/**
 * Deep-clone a plain JSON-serialisable object.
 */
function deepClone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj));
}

// ---------------------------------------------------------------------------
// Mapping from canonical option keys to payload paths
// ---------------------------------------------------------------------------

/**
 * Maps VALID_OPTIONS keys to the actual dot-paths inside the generate payload.
 * The generate payload has a double-nested `filters.filters` structure.
 */
const OPTION_KEY_TO_PAYLOAD_PATH: Record<string, string> = {
  'audience.b2b':                          'filters.audience.b2b',
  'score':                                 'filters.score',
  'filters.gender':                        'filters.filters.gender',
  'filters.profile.incomeRange':           'filters.filters.profile.incomeRange',
  'filters.profile.homeowner':             'filters.filters.profile.homeowner',
  'filters.profile.married':               'filters.filters.profile.married',
  'filters.profile.children':              'filters.filters.profile.children',
  'filters.businessProfile.seniority':     'filters.filters.businessProfile.seniority',
  'filters.businessProfile.companyRevenue':'filters.filters.businessProfile.companyRevenue',
  'filters.businessProfile.department':    'filters.filters.businessProfile.department',
  'filters.notNulls':                      'filters.filters.notNulls',
};

// ---------------------------------------------------------------------------
// Core validator
// ---------------------------------------------------------------------------

export function validatePayload(payload: any): ValidationResult {
  const errors: ValidationError[] = [];
  const warnings: Array<{ field: string; message: string }> = [];
  let appliedCorrections = false;
  const corrected = deepClone(payload);

  // -----------------------------------------------------------------------
  // 1. audience.b2b — must be string "B2B" or null/empty, never boolean
  // -----------------------------------------------------------------------
  const b2bPath = 'filters.audience.b2b';
  const b2bValue = getNestedValue(payload, b2bPath);
  if (b2bValue != null && b2bValue !== '') {
    if (typeof b2bValue === 'boolean') {
      errors.push({
        field: b2bPath,
        value: String(b2bValue),
        message: 'audience.b2b must be the string "B2B", not a boolean',
        validOptions: ['B2B'],
        autoCorrection: b2bValue === true ? 'B2B' : undefined,
      });
      if (b2bValue === true) {
        setNestedValue(corrected, b2bPath, 'B2B');
        appliedCorrections = true;
      }
    } else if (typeof b2bValue === 'string' && b2bValue !== 'B2B') {
      errors.push({
        field: b2bPath,
        value: b2bValue,
        message: `audience.b2b must be "B2B", got "${b2bValue}"`,
        validOptions: ['B2B'],
      });
    }
  }

  // -----------------------------------------------------------------------
  // 2. Validate array fields against VALID_OPTIONS
  // -----------------------------------------------------------------------
  for (const [optionKey, validSet] of Object.entries(VALID_OPTIONS)) {
    if (optionKey === 'audience.b2b') continue; // handled above

    const payloadPath = OPTION_KEY_TO_PAYLOAD_PATH[optionKey];
    if (!payloadPath) continue;

    const value = getNestedValue(payload, payloadPath);
    if (!Array.isArray(value) || value.length === 0) continue;

    for (const item of value) {
      if (!validSet.has(item)) {
        // Check for auto-correction
        const corrections = AUTO_CORRECTIONS[optionKey];
        const correction = corrections?.[item];

        if (correction && validSet.has(correction)) {
          errors.push({
            field: payloadPath,
            value: item,
            message: `Invalid value "${item}" — auto-corrected to "${correction}"`,
            validOptions: Array.from(validSet),
            autoCorrection: correction,
          });
          // Apply correction
          const correctedArr: string[] = getNestedValue(corrected, payloadPath);
          const idx = correctedArr.indexOf(item);
          if (idx !== -1) correctedArr[idx] = correction;
          appliedCorrections = true;
        } else {
          errors.push({
            field: payloadPath,
            value: item,
            message: `Invalid value "${item}" for ${payloadPath}`,
            validOptions: Array.from(validSet),
          });
        }
      }
    }
  }

  // -----------------------------------------------------------------------
  // 3. segmentSearches — warn if paths look suspicious
  // -----------------------------------------------------------------------
  const segmentSearches = getNestedValue(payload, 'filters.audience.segmentSearches');
  if (Array.isArray(segmentSearches)) {
    for (const search of segmentSearches) {
      if (typeof search === 'string') {
        // Valid segments use " > " as separator
        if (search.includes('>') && !search.includes(' > ')) {
          warnings.push({
            field: 'filters.audience.segmentSearches',
            message: `Segment path "${search}" has ">" without surrounding spaces — expected " > " separator`,
          });
        }
      }
    }
  }

  // -----------------------------------------------------------------------
  // 4. Score values
  // -----------------------------------------------------------------------
  const scoreValue = getNestedValue(payload, 'filters.score');
  if (Array.isArray(scoreValue) && scoreValue.length > 0) {
    const validScores = VALID_OPTIONS['score'];
    for (const s of scoreValue) {
      if (!validScores.has(s)) {
        errors.push({
          field: 'filters.score',
          value: s,
          message: `Invalid score value "${s}"`,
          validOptions: Array.from(validScores),
        });
      }
    }
  }

  // -----------------------------------------------------------------------
  // 5. Age range
  // -----------------------------------------------------------------------
  const age = getNestedValue(payload, 'filters.filters.age');
  if (age != null) {
    const { minAge, maxAge } = age;
    if (minAge != null && maxAge != null) {
      if (minAge >= maxAge) {
        errors.push({
          field: 'filters.filters.age',
          value: `${minAge}-${maxAge}`,
          message: `minAge (${minAge}) must be less than maxAge (${maxAge})`,
        });
      }
    }
    if (minAge != null && (minAge < 18 || minAge > 100)) {
      errors.push({
        field: 'filters.filters.age.minAge',
        value: String(minAge),
        message: `minAge must be between 18 and 100, got ${minAge}`,
      });
    }
    if (maxAge != null && (maxAge < 18 || maxAge > 100)) {
      errors.push({
        field: 'filters.filters.age.maxAge',
        value: String(maxAge),
        message: `maxAge must be between 18 and 100, got ${maxAge}`,
      });
    }
  }

  // -----------------------------------------------------------------------
  // Result
  // -----------------------------------------------------------------------
  const result: ValidationResult = {
    valid: errors.filter(e => !e.autoCorrection).length === 0,
    errors,
    warnings,
  };

  if (appliedCorrections) {
    result.corrected = corrected;
  }

  return result;
}
