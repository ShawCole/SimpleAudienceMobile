/**
 * Estimator Validation Script
 *
 * Runs a diverse set of filter combos through BOTH:
 *   1. The local estimator (POST /audiences/estimate) — instant
 *   2. Real AudienceLab preview (POST /audiences/preview) — via Puppeteer
 *
 * Compares results to measure estimator accuracy.
 *
 * Test cases cover:
 *   - Demographics only (gender, age, seniority, married, children)
 *   - Homeowner vs Renter vs blended
 *   - Single enrichment filters (credit, income, NW, education)
 *   - Multi-enrichment stacking (upper-tier and lower-tier)
 *   - State filters
 *   - Mixed (demographics + enrichment + state)
 *
 * Usage:
 *   AUDIENCE_ID=<id> npx tsx backend/src/scripts/filter-explorer/validate-estimator.ts
 *   # or let it create one:
 *   npx tsx backend/src/scripts/filter-explorer/validate-estimator.ts
 */

import { buildPayload, type FilterSpec, type TestCase } from './payload-factory';

const API_BASE = process.env.API_BASE || 'http://localhost:3001/api';

async function api(path: string, body?: any): Promise<any> {
  const r = await fetch(`${API_BASE}${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) {
    const text = await r.text().catch(() => '');
    throw new Error(`API ${path} returned ${r.status}: ${text.substring(0, 200)}`);
  }
  return r.json();
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** Real AudienceLab preview via Puppeteer */
async function realPreview(audienceId: string, label: string, filters: FilterSpec[]): Promise<number> {
  const tc: TestCase = { id: label, phase: 'single', label, filters };
  const payload = buildPayload(tc, audienceId);
  try {
    const result = await api('/audiences/preview', payload);
    return result.data?.count ?? result.count ?? -1;
  } catch (err: any) {
    console.log(`    ⚠️ PREVIEW ERROR: ${err.message.substring(0, 120)}`);
    return -1;
  }
}

/** Local estimator — instant, no Puppeteer */
async function estimate(filters: FilterSpec[]): Promise<{ count: number; confidence: string }> {
  try {
    const result = await api('/audiences/estimate', { filters });
    const data = result.data ?? result;
    return {
      count: data.estimatedCount ?? -1,
      confidence: data.confidence ?? 'unknown',
    };
  } catch (err: any) {
    console.log(`    ⚠️ ESTIMATE ERROR: ${err.message.substring(0, 120)}`);
    return { count: -1, confidence: 'error' };
  }
}

function fmt(n: number): string {
  if (n < 0) return 'ERR';
  return n.toLocaleString();
}

function pctError(estimated: number, actual: number): string {
  if (actual <= 0 || estimated < 0) return 'N/A';
  const pct = ((estimated - actual) / actual) * 100;
  const sign = pct >= 0 ? '+' : '';
  return `${sign}${pct.toFixed(1)}%`;
}

// ── TEST CASES ──────────────────────────────────────────────────────────────

interface ValidationCase {
  label: string;
  category: string;
  filters: FilterSpec[];
}

const CASES: ValidationCase[] = [
  // ── Demographics only ─────────────────────────────────────────────────────
  {
    label: 'M+Staff+25-34',
    category: 'demographics',
    filters: [
      { key: 'profile.gender', values: ['Male'] },
      { key: 'businessProfile.seniority', values: ['staff'] },
      { key: 'age', values: ['25-34'], range: { min: 25, max: 34 } },
    ],
  },
  {
    label: 'F+CXO+45-54',
    category: 'demographics',
    filters: [
      { key: 'profile.gender', values: ['Female'] },
      { key: 'businessProfile.seniority', values: ['cxo'] },
      { key: 'age', values: ['45-54'], range: { min: 45, max: 54 } },
    ],
  },
  {
    label: 'M+Manager+Married+HasKids+35-44',
    category: 'demographics',
    filters: [
      { key: 'profile.gender', values: ['Male'] },
      { key: 'businessProfile.seniority', values: ['manager'] },
      { key: 'profile.married', values: ['Yes'] },
      { key: 'profile.children', values: ['Has children'] },
      { key: 'age', values: ['35-44'], range: { min: 35, max: 44 } },
    ],
  },
  {
    label: 'F+VP+NoMarried+NoKids+55-64',
    category: 'demographics',
    filters: [
      { key: 'profile.gender', values: ['Female'] },
      { key: 'businessProfile.seniority', values: ['vp'] },
      { key: 'profile.married', values: ['No'] },
      { key: 'profile.children', values: ['No children'] },
      { key: 'age', values: ['55-64'], range: { min: 55, max: 64 } },
    ],
  },

  // ── Homeowner vs Renter ───────────────────────────────────────────────────
  {
    label: 'M+Staff+25-34+HO',
    category: 'ho-split',
    filters: [
      { key: 'profile.gender', values: ['Male'] },
      { key: 'businessProfile.seniority', values: ['staff'] },
      { key: 'age', values: ['25-34'], range: { min: 25, max: 34 } },
      { key: 'profile.homeowner', values: ['Homeowner'] },
    ],
  },
  {
    label: 'M+Staff+25-34+Renter',
    category: 'ho-split',
    filters: [
      { key: 'profile.gender', values: ['Male'] },
      { key: 'businessProfile.seniority', values: ['staff'] },
      { key: 'age', values: ['25-34'], range: { min: 25, max: 34 } },
      { key: 'profile.homeowner', values: ['Renter'] },
    ],
  },
  {
    label: 'F+Manager+HasKids+35-44+HO',
    category: 'ho-split',
    filters: [
      { key: 'profile.gender', values: ['Female'] },
      { key: 'businessProfile.seniority', values: ['manager'] },
      { key: 'profile.children', values: ['Has children'] },
      { key: 'age', values: ['35-44'], range: { min: 35, max: 44 } },
      { key: 'profile.homeowner', values: ['Homeowner'] },
    ],
  },
  {
    label: 'F+Manager+HasKids+35-44+Renter',
    category: 'ho-split',
    filters: [
      { key: 'profile.gender', values: ['Female'] },
      { key: 'businessProfile.seniority', values: ['manager'] },
      { key: 'profile.children', values: ['Has children'] },
      { key: 'age', values: ['35-44'], range: { min: 35, max: 44 } },
      { key: 'profile.homeowner', values: ['Renter'] },
    ],
  },

  // ── Single enrichment (HO baseline) ───────────────────────────────────────
  {
    label: 'F+Staff+25-34+HO+Credit750',
    category: 'single-enrich-HO',
    filters: [
      { key: 'profile.gender', values: ['Female'] },
      { key: 'profile.married', values: ['No'] },
      { key: 'profile.children', values: ['No children'] },
      { key: 'businessProfile.seniority', values: ['staff'] },
      { key: 'age', values: ['25-34'], range: { min: 25, max: 34 } },
      { key: 'profile.homeowner', values: ['Homeowner'] },
      { key: 'attributes.credit_rating', values: ['750 - 799'] },
    ],
  },
  {
    label: 'F+Staff+25-34+HO+Income100k',
    category: 'single-enrich-HO',
    filters: [
      { key: 'profile.gender', values: ['Female'] },
      { key: 'profile.married', values: ['No'] },
      { key: 'profile.children', values: ['No children'] },
      { key: 'businessProfile.seniority', values: ['staff'] },
      { key: 'age', values: ['25-34'], range: { min: 25, max: 34 } },
      { key: 'profile.homeowner', values: ['Homeowner'] },
      { key: 'profile.incomeRange', values: ['$100,000 to $149,999'] },
    ],
  },
  {
    label: 'F+Staff+25-34+HO+NW750k',
    category: 'single-enrich-HO',
    filters: [
      { key: 'profile.gender', values: ['Female'] },
      { key: 'profile.married', values: ['No'] },
      { key: 'profile.children', values: ['No children'] },
      { key: 'businessProfile.seniority', values: ['staff'] },
      { key: 'age', values: ['25-34'], range: { min: 25, max: 34 } },
      { key: 'profile.homeowner', values: ['Homeowner'] },
      { key: 'profile.netWorth', values: ['$750,000 to $999,999'] },
    ],
  },

  // ── Single enrichment (Renter) ────────────────────────────────────────────
  {
    label: 'F+Staff+25-34+R+Credit750',
    category: 'single-enrich-R',
    filters: [
      { key: 'profile.gender', values: ['Female'] },
      { key: 'profile.married', values: ['No'] },
      { key: 'profile.children', values: ['No children'] },
      { key: 'businessProfile.seniority', values: ['staff'] },
      { key: 'age', values: ['25-34'], range: { min: 25, max: 34 } },
      { key: 'profile.homeowner', values: ['Renter'] },
      { key: 'attributes.credit_rating', values: ['750 - 799'] },
    ],
  },
  {
    label: 'F+Staff+25-34+R+Income100k',
    category: 'single-enrich-R',
    filters: [
      { key: 'profile.gender', values: ['Female'] },
      { key: 'profile.married', values: ['No'] },
      { key: 'profile.children', values: ['No children'] },
      { key: 'businessProfile.seniority', values: ['staff'] },
      { key: 'age', values: ['25-34'], range: { min: 25, max: 34 } },
      { key: 'profile.homeowner', values: ['Renter'] },
      { key: 'profile.incomeRange', values: ['$100,000 to $149,999'] },
    ],
  },
  {
    label: 'F+Staff+25-34+R+NW750k',
    category: 'single-enrich-R',
    filters: [
      { key: 'profile.gender', values: ['Female'] },
      { key: 'profile.married', values: ['No'] },
      { key: 'profile.children', values: ['No children'] },
      { key: 'businessProfile.seniority', values: ['staff'] },
      { key: 'age', values: ['25-34'], range: { min: 25, max: 34 } },
      { key: 'profile.homeowner', values: ['Renter'] },
      { key: 'profile.netWorth', values: ['$750,000 to $999,999'] },
    ],
  },

  // ── Upper-tier stacking (HO) ─────────────────────────────────────────────
  {
    label: 'F+Staff+25-34+HO+Cr750+Inc100k',
    category: 'stack-upper-HO',
    filters: [
      { key: 'profile.gender', values: ['Female'] },
      { key: 'profile.married', values: ['No'] },
      { key: 'profile.children', values: ['No children'] },
      { key: 'businessProfile.seniority', values: ['staff'] },
      { key: 'age', values: ['25-34'], range: { min: 25, max: 34 } },
      { key: 'profile.homeowner', values: ['Homeowner'] },
      { key: 'attributes.credit_rating', values: ['750 - 799'] },
      { key: 'profile.incomeRange', values: ['$100,000 to $149,999'] },
    ],
  },
  {
    label: 'F+Staff+25-34+HO+Cr750+Inc100k+NW750k',
    category: 'stack-upper-HO',
    filters: [
      { key: 'profile.gender', values: ['Female'] },
      { key: 'profile.married', values: ['No'] },
      { key: 'profile.children', values: ['No children'] },
      { key: 'businessProfile.seniority', values: ['staff'] },
      { key: 'age', values: ['25-34'], range: { min: 25, max: 34 } },
      { key: 'profile.homeowner', values: ['Homeowner'] },
      { key: 'attributes.credit_rating', values: ['750 - 799'] },
      { key: 'profile.incomeRange', values: ['$100,000 to $149,999'] },
      { key: 'profile.netWorth', values: ['$750,000 to $999,999'] },
    ],
  },

  // ── Upper-tier stacking (Renter) ──────────────────────────────────────────
  {
    label: 'F+Staff+25-34+R+Cr750+Inc100k',
    category: 'stack-upper-R',
    filters: [
      { key: 'profile.gender', values: ['Female'] },
      { key: 'profile.married', values: ['No'] },
      { key: 'profile.children', values: ['No children'] },
      { key: 'businessProfile.seniority', values: ['staff'] },
      { key: 'age', values: ['25-34'], range: { min: 25, max: 34 } },
      { key: 'profile.homeowner', values: ['Renter'] },
      { key: 'attributes.credit_rating', values: ['750 - 799'] },
      { key: 'profile.incomeRange', values: ['$100,000 to $149,999'] },
    ],
  },
  {
    label: 'F+Staff+25-34+R+Cr750+Inc100k+NW750k',
    category: 'stack-upper-R',
    filters: [
      { key: 'profile.gender', values: ['Female'] },
      { key: 'profile.married', values: ['No'] },
      { key: 'profile.children', values: ['No children'] },
      { key: 'businessProfile.seniority', values: ['staff'] },
      { key: 'age', values: ['25-34'], range: { min: 25, max: 34 } },
      { key: 'profile.homeowner', values: ['Renter'] },
      { key: 'attributes.credit_rating', values: ['750 - 799'] },
      { key: 'profile.incomeRange', values: ['$100,000 to $149,999'] },
      { key: 'profile.netWorth', values: ['$750,000 to $999,999'] },
    ],
  },

  // ── Lower-tier stacking (HO) — should multiply freely ────────────────────
  {
    label: 'F+Staff+25-34+HO+Cr650+Inc45k',
    category: 'stack-lower-HO',
    filters: [
      { key: 'profile.gender', values: ['Female'] },
      { key: 'profile.married', values: ['No'] },
      { key: 'profile.children', values: ['No children'] },
      { key: 'businessProfile.seniority', values: ['staff'] },
      { key: 'age', values: ['25-34'], range: { min: 25, max: 34 } },
      { key: 'profile.homeowner', values: ['Homeowner'] },
      { key: 'attributes.credit_rating', values: ['650 - 699'] },
      { key: 'profile.incomeRange', values: ['$45,000 to $59,999'] },
    ],
  },

  // ── State filter ──────────────────────────────────────────────────────────
  {
    label: 'M+Staff+25-34+HO+CA',
    category: 'state',
    filters: [
      { key: 'profile.gender', values: ['Male'] },
      { key: 'businessProfile.seniority', values: ['staff'] },
      { key: 'age', values: ['25-34'], range: { min: 25, max: 34 } },
      { key: 'profile.homeowner', values: ['Homeowner'] },
      { key: 'state', values: ['California'] },
    ],
  },
  {
    label: 'M+Staff+25-34+HO+TX',
    category: 'state',
    filters: [
      { key: 'profile.gender', values: ['Male'] },
      { key: 'businessProfile.seniority', values: ['staff'] },
      { key: 'age', values: ['25-34'], range: { min: 25, max: 34 } },
      { key: 'profile.homeowner', values: ['Homeowner'] },
      { key: 'state', values: ['Texas'] },
    ],
  },
  {
    label: 'F+Manager+35-44+HO+FL',
    category: 'state',
    filters: [
      { key: 'profile.gender', values: ['Female'] },
      { key: 'businessProfile.seniority', values: ['manager'] },
      { key: 'age', values: ['35-44'], range: { min: 35, max: 44 } },
      { key: 'profile.homeowner', values: ['Homeowner'] },
      { key: 'state', values: ['Florida'] },
    ],
  },

  // ── Mixed: demographics + enrichment + state ──────────────────────────────
  {
    label: 'M+CXO+45-54+HO+Married+CA+NW750k',
    category: 'mixed',
    filters: [
      { key: 'profile.gender', values: ['Male'] },
      { key: 'businessProfile.seniority', values: ['cxo'] },
      { key: 'age', values: ['45-54'], range: { min: 45, max: 54 } },
      { key: 'profile.homeowner', values: ['Homeowner'] },
      { key: 'profile.married', values: ['Yes'] },
      { key: 'state', values: ['California'] },
      { key: 'profile.netWorth', values: ['$750,000 to $999,999'] },
    ],
  },
  {
    label: 'F+Director+35-44+HO+HasKids+TX+Credit750',
    category: 'mixed',
    filters: [
      { key: 'profile.gender', values: ['Female'] },
      { key: 'businessProfile.seniority', values: ['director'] },
      { key: 'age', values: ['35-44'], range: { min: 35, max: 44 } },
      { key: 'profile.homeowner', values: ['Homeowner'] },
      { key: 'profile.children', values: ['Has children'] },
      { key: 'state', values: ['Texas'] },
      { key: 'attributes.credit_rating', values: ['750 - 799'] },
    ],
  },

  // ── Education + Renter special case (HS = 2.05x boost) ────────────────────
  {
    label: 'M+Staff+25-34+R+EduHS',
    category: 'edu-renter',
    filters: [
      { key: 'profile.gender', values: ['Male'] },
      { key: 'businessProfile.seniority', values: ['staff'] },
      { key: 'age', values: ['25-34'], range: { min: 25, max: 34 } },
      { key: 'profile.homeowner', values: ['Renter'] },
      { key: 'attributes.education', values: ['High School'] },
    ],
  },
  {
    label: 'M+Staff+25-34+R+EduBach',
    category: 'edu-renter',
    filters: [
      { key: 'profile.gender', values: ['Male'] },
      { key: 'businessProfile.seniority', values: ['staff'] },
      { key: 'age', values: ['25-34'], range: { min: 25, max: 34 } },
      { key: 'profile.homeowner', values: ['Renter'] },
      { key: 'attributes.education', values: ["Bachelor's"] },
    ],
  },

  // ── Different anchor profile (older, married, CXO) ────────────────────────
  {
    label: 'M+CXO+Married+HasKids+55-64+HO',
    category: 'alt-profile',
    filters: [
      { key: 'profile.gender', values: ['Male'] },
      { key: 'businessProfile.seniority', values: ['cxo'] },
      { key: 'profile.married', values: ['Yes'] },
      { key: 'profile.children', values: ['Has children'] },
      { key: 'age', values: ['55-64'], range: { min: 55, max: 64 } },
      { key: 'profile.homeowner', values: ['Homeowner'] },
    ],
  },
  {
    label: 'M+CXO+Married+HasKids+55-64+HO+Credit750',
    category: 'alt-profile',
    filters: [
      { key: 'profile.gender', values: ['Male'] },
      { key: 'businessProfile.seniority', values: ['cxo'] },
      { key: 'profile.married', values: ['Yes'] },
      { key: 'profile.children', values: ['Has children'] },
      { key: 'age', values: ['55-64'], range: { min: 55, max: 64 } },
      { key: 'profile.homeowner', values: ['Homeowner'] },
      { key: 'attributes.credit_rating', values: ['750 - 799'] },
    ],
  },

  // ── Age × Seniority — Staff across all ages ─────────────────────────────
  {
    label: 'M+Staff+18-24+HO',
    category: 'age-x-seniority',
    filters: [
      { key: 'profile.gender', values: ['Male'] },
      { key: 'profile.homeowner', values: ['Homeowner'] },
      { key: 'profile.married', values: ['No'] },
      { key: 'profile.children', values: ['No children'] },
      { key: 'businessProfile.seniority', values: ['staff'] },
      { key: 'age', values: ['18-24'], range: { min: 18, max: 24 } },
    ],
  },
  {
    label: 'M+Staff+25-34+HO+axs',
    category: 'age-x-seniority',
    filters: [
      { key: 'profile.gender', values: ['Male'] },
      { key: 'profile.homeowner', values: ['Homeowner'] },
      { key: 'profile.married', values: ['No'] },
      { key: 'profile.children', values: ['No children'] },
      { key: 'businessProfile.seniority', values: ['staff'] },
      { key: 'age', values: ['25-34'], range: { min: 25, max: 34 } },
    ],
  },
  {
    label: 'M+Staff+35-44+HO',
    category: 'age-x-seniority',
    filters: [
      { key: 'profile.gender', values: ['Male'] },
      { key: 'profile.homeowner', values: ['Homeowner'] },
      { key: 'profile.married', values: ['No'] },
      { key: 'profile.children', values: ['No children'] },
      { key: 'businessProfile.seniority', values: ['staff'] },
      { key: 'age', values: ['35-44'], range: { min: 35, max: 44 } },
    ],
  },
  {
    label: 'M+Staff+45-54+HO',
    category: 'age-x-seniority',
    filters: [
      { key: 'profile.gender', values: ['Male'] },
      { key: 'profile.homeowner', values: ['Homeowner'] },
      { key: 'profile.married', values: ['No'] },
      { key: 'profile.children', values: ['No children'] },
      { key: 'businessProfile.seniority', values: ['staff'] },
      { key: 'age', values: ['45-54'], range: { min: 45, max: 54 } },
    ],
  },
  {
    label: 'M+Staff+55-64+HO',
    category: 'age-x-seniority',
    filters: [
      { key: 'profile.gender', values: ['Male'] },
      { key: 'profile.homeowner', values: ['Homeowner'] },
      { key: 'profile.married', values: ['No'] },
      { key: 'profile.children', values: ['No children'] },
      { key: 'businessProfile.seniority', values: ['staff'] },
      { key: 'age', values: ['55-64'], range: { min: 55, max: 64 } },
    ],
  },
  {
    label: 'M+Staff+65+HO',
    category: 'age-x-seniority',
    filters: [
      { key: 'profile.gender', values: ['Male'] },
      { key: 'profile.homeowner', values: ['Homeowner'] },
      { key: 'profile.married', values: ['No'] },
      { key: 'profile.children', values: ['No children'] },
      { key: 'businessProfile.seniority', values: ['staff'] },
      { key: 'age', values: ['65+'], range: { min: 65, max: 120 } },
    ],
  },

  // ── Age × Seniority — CXO across all ages ───────────────────────────────
  {
    label: 'M+CXO+18-24+HO',
    category: 'age-x-seniority',
    filters: [
      { key: 'profile.gender', values: ['Male'] },
      { key: 'profile.homeowner', values: ['Homeowner'] },
      { key: 'profile.married', values: ['No'] },
      { key: 'profile.children', values: ['No children'] },
      { key: 'businessProfile.seniority', values: ['cxo'] },
      { key: 'age', values: ['18-24'], range: { min: 18, max: 24 } },
    ],
  },
  {
    label: 'M+CXO+25-34+HO',
    category: 'age-x-seniority',
    filters: [
      { key: 'profile.gender', values: ['Male'] },
      { key: 'profile.homeowner', values: ['Homeowner'] },
      { key: 'profile.married', values: ['No'] },
      { key: 'profile.children', values: ['No children'] },
      { key: 'businessProfile.seniority', values: ['cxo'] },
      { key: 'age', values: ['25-34'], range: { min: 25, max: 34 } },
    ],
  },
  {
    label: 'M+CXO+35-44+HO',
    category: 'age-x-seniority',
    filters: [
      { key: 'profile.gender', values: ['Male'] },
      { key: 'profile.homeowner', values: ['Homeowner'] },
      { key: 'profile.married', values: ['No'] },
      { key: 'profile.children', values: ['No children'] },
      { key: 'businessProfile.seniority', values: ['cxo'] },
      { key: 'age', values: ['35-44'], range: { min: 35, max: 44 } },
    ],
  },
  {
    label: 'M+CXO+45-54+HO',
    category: 'age-x-seniority',
    filters: [
      { key: 'profile.gender', values: ['Male'] },
      { key: 'profile.homeowner', values: ['Homeowner'] },
      { key: 'profile.married', values: ['No'] },
      { key: 'profile.children', values: ['No children'] },
      { key: 'businessProfile.seniority', values: ['cxo'] },
      { key: 'age', values: ['45-54'], range: { min: 45, max: 54 } },
    ],
  },
  {
    label: 'M+CXO+55-64+HO',
    category: 'age-x-seniority',
    filters: [
      { key: 'profile.gender', values: ['Male'] },
      { key: 'profile.homeowner', values: ['Homeowner'] },
      { key: 'profile.married', values: ['No'] },
      { key: 'profile.children', values: ['No children'] },
      { key: 'businessProfile.seniority', values: ['cxo'] },
      { key: 'age', values: ['55-64'], range: { min: 55, max: 64 } },
    ],
  },
  {
    label: 'M+CXO+65+HO',
    category: 'age-x-seniority',
    filters: [
      { key: 'profile.gender', values: ['Male'] },
      { key: 'profile.homeowner', values: ['Homeowner'] },
      { key: 'profile.married', values: ['No'] },
      { key: 'profile.children', values: ['No children'] },
      { key: 'businessProfile.seniority', values: ['cxo'] },
      { key: 'age', values: ['65+'], range: { min: 65, max: 120 } },
    ],
  },

  // ── Age × Seniority — Director across all ages (ZERO L1 data before) ────
  {
    label: 'M+Director+18-24+HO',
    category: 'age-x-seniority',
    filters: [
      { key: 'profile.gender', values: ['Male'] },
      { key: 'profile.homeowner', values: ['Homeowner'] },
      { key: 'profile.married', values: ['No'] },
      { key: 'profile.children', values: ['No children'] },
      { key: 'businessProfile.seniority', values: ['director'] },
      { key: 'age', values: ['18-24'], range: { min: 18, max: 24 } },
    ],
  },
  {
    label: 'M+Director+25-34+HO',
    category: 'age-x-seniority',
    filters: [
      { key: 'profile.gender', values: ['Male'] },
      { key: 'profile.homeowner', values: ['Homeowner'] },
      { key: 'profile.married', values: ['No'] },
      { key: 'profile.children', values: ['No children'] },
      { key: 'businessProfile.seniority', values: ['director'] },
      { key: 'age', values: ['25-34'], range: { min: 25, max: 34 } },
    ],
  },
  {
    label: 'M+Director+35-44+HO',
    category: 'age-x-seniority',
    filters: [
      { key: 'profile.gender', values: ['Male'] },
      { key: 'profile.homeowner', values: ['Homeowner'] },
      { key: 'profile.married', values: ['No'] },
      { key: 'profile.children', values: ['No children'] },
      { key: 'businessProfile.seniority', values: ['director'] },
      { key: 'age', values: ['35-44'], range: { min: 35, max: 44 } },
    ],
  },
  {
    label: 'M+Director+45-54+HO',
    category: 'age-x-seniority',
    filters: [
      { key: 'profile.gender', values: ['Male'] },
      { key: 'profile.homeowner', values: ['Homeowner'] },
      { key: 'profile.married', values: ['No'] },
      { key: 'profile.children', values: ['No children'] },
      { key: 'businessProfile.seniority', values: ['director'] },
      { key: 'age', values: ['45-54'], range: { min: 45, max: 54 } },
    ],
  },
  {
    label: 'M+Director+55-64+HO',
    category: 'age-x-seniority',
    filters: [
      { key: 'profile.gender', values: ['Male'] },
      { key: 'profile.homeowner', values: ['Homeowner'] },
      { key: 'profile.married', values: ['No'] },
      { key: 'profile.children', values: ['No children'] },
      { key: 'businessProfile.seniority', values: ['director'] },
      { key: 'age', values: ['55-64'], range: { min: 55, max: 64 } },
    ],
  },
  {
    label: 'M+Director+65+HO',
    category: 'age-x-seniority',
    filters: [
      { key: 'profile.gender', values: ['Male'] },
      { key: 'profile.homeowner', values: ['Homeowner'] },
      { key: 'profile.married', values: ['No'] },
      { key: 'profile.children', values: ['No children'] },
      { key: 'businessProfile.seniority', values: ['director'] },
      { key: 'age', values: ['65+'], range: { min: 65, max: 120 } },
    ],
  },

  // ── Age × Seniority — Manager age-distance test ─────────────────────────
  {
    label: 'M+Manager+55-64+HO',
    category: 'age-x-seniority',
    filters: [
      { key: 'profile.gender', values: ['Male'] },
      { key: 'profile.homeowner', values: ['Homeowner'] },
      { key: 'profile.married', values: ['No'] },
      { key: 'profile.children', values: ['No children'] },
      { key: 'businessProfile.seniority', values: ['manager'] },
      { key: 'age', values: ['55-64'], range: { min: 55, max: 64 } },
    ],
  },
  {
    label: 'M+Manager+25-34+HO',
    category: 'age-x-seniority',
    filters: [
      { key: 'profile.gender', values: ['Male'] },
      { key: 'profile.homeowner', values: ['Homeowner'] },
      { key: 'profile.married', values: ['No'] },
      { key: 'profile.children', values: ['No children'] },
      { key: 'businessProfile.seniority', values: ['manager'] },
      { key: 'age', values: ['25-34'], range: { min: 25, max: 34 } },
    ],
  },

  // ── Age × Seniority — VP edge ages ──────────────────────────────────────
  {
    label: 'M+VP+18-24+HO',
    category: 'age-x-seniority',
    filters: [
      { key: 'profile.gender', values: ['Male'] },
      { key: 'profile.homeowner', values: ['Homeowner'] },
      { key: 'profile.married', values: ['No'] },
      { key: 'profile.children', values: ['No children'] },
      { key: 'businessProfile.seniority', values: ['vp'] },
      { key: 'age', values: ['18-24'], range: { min: 18, max: 24 } },
    ],
  },
  {
    label: 'M+VP+65+HO',
    category: 'age-x-seniority',
    filters: [
      { key: 'profile.gender', values: ['Male'] },
      { key: 'profile.homeowner', values: ['Homeowner'] },
      { key: 'profile.married', values: ['No'] },
      { key: 'profile.children', values: ['No children'] },
      { key: 'businessProfile.seniority', values: ['vp'] },
      { key: 'age', values: ['65+'], range: { min: 65, max: 120 } },
    ],
  },

  // ── Age × Seniority + Enrichment (Credit 750) ──────────────────────────
  {
    label: 'M+Staff+25-34+HO+Cr750+axs',
    category: 'age-x-seniority-enriched',
    filters: [
      { key: 'profile.gender', values: ['Male'] },
      { key: 'profile.homeowner', values: ['Homeowner'] },
      { key: 'profile.married', values: ['No'] },
      { key: 'profile.children', values: ['No children'] },
      { key: 'businessProfile.seniority', values: ['staff'] },
      { key: 'age', values: ['25-34'], range: { min: 25, max: 34 } },
      { key: 'attributes.credit_rating', values: ['750 - 799'] },
    ],
  },
  {
    label: 'M+Staff+55-64+HO+Cr750',
    category: 'age-x-seniority-enriched',
    filters: [
      { key: 'profile.gender', values: ['Male'] },
      { key: 'profile.homeowner', values: ['Homeowner'] },
      { key: 'profile.married', values: ['No'] },
      { key: 'profile.children', values: ['No children'] },
      { key: 'businessProfile.seniority', values: ['staff'] },
      { key: 'age', values: ['55-64'], range: { min: 55, max: 64 } },
      { key: 'attributes.credit_rating', values: ['750 - 799'] },
    ],
  },
  {
    label: 'M+CXO+25-34+HO+Cr750',
    category: 'age-x-seniority-enriched',
    filters: [
      { key: 'profile.gender', values: ['Male'] },
      { key: 'profile.homeowner', values: ['Homeowner'] },
      { key: 'profile.married', values: ['No'] },
      { key: 'profile.children', values: ['No children'] },
      { key: 'businessProfile.seniority', values: ['cxo'] },
      { key: 'age', values: ['25-34'], range: { min: 25, max: 34 } },
      { key: 'attributes.credit_rating', values: ['750 - 799'] },
    ],
  },
  {
    label: 'M+CXO+55-64+HO+Cr750',
    category: 'age-x-seniority-enriched',
    filters: [
      { key: 'profile.gender', values: ['Male'] },
      { key: 'profile.homeowner', values: ['Homeowner'] },
      { key: 'profile.married', values: ['No'] },
      { key: 'profile.children', values: ['No children'] },
      { key: 'businessProfile.seniority', values: ['cxo'] },
      { key: 'age', values: ['55-64'], range: { min: 55, max: 64 } },
      { key: 'attributes.credit_rating', values: ['750 - 799'] },
    ],
  },
  {
    label: 'M+Director+35-44+HO+Cr750',
    category: 'age-x-seniority-enriched',
    filters: [
      { key: 'profile.gender', values: ['Male'] },
      { key: 'profile.homeowner', values: ['Homeowner'] },
      { key: 'profile.married', values: ['No'] },
      { key: 'profile.children', values: ['No children'] },
      { key: 'businessProfile.seniority', values: ['director'] },
      { key: 'age', values: ['35-44'], range: { min: 35, max: 44 } },
      { key: 'attributes.credit_rating', values: ['750 - 799'] },
    ],
  },
  {
    label: 'M+Director+55-64+HO+Cr750',
    category: 'age-x-seniority-enriched',
    filters: [
      { key: 'profile.gender', values: ['Male'] },
      { key: 'profile.homeowner', values: ['Homeowner'] },
      { key: 'profile.married', values: ['No'] },
      { key: 'profile.children', values: ['No children'] },
      { key: 'businessProfile.seniority', values: ['director'] },
      { key: 'age', values: ['55-64'], range: { min: 55, max: 64 } },
      { key: 'attributes.credit_rating', values: ['750 - 799'] },
    ],
  },
];

// ── MAIN ──────────────────────────────────────────────────────────────────────

async function main() {
  const existingId = process.env.AUDIENCE_ID;
  let audienceId: string;

  if (existingId) {
    audienceId = existingId;
    console.log(`[validate] Reusing audience: ${audienceId}`);
  } else {
    console.log('[validate] Initializing...');
    const initResult = await api('/vacuum/init', { name: 'Estimator Validation' });
    if (!initResult.success) throw new Error('Init failed');
    audienceId = initResult.audienceId;
    console.log(`[validate] Audience: ${audienceId}`);
  }

  const startTime = Date.now();
  const totalProbes = CASES.length;
  let completed = 0;

  console.log(`\n[validate] ${totalProbes} test cases\n`);

  // Header
  console.log(`  ${'Label'.padEnd(45)} ${'Actual'.padStart(9)} ${'Estimated'.padStart(10)} ${'Error'.padStart(8)} ${'Conf'.padStart(6)}`);
  console.log(`  ${'-'.repeat(82)}`);

  const results: Array<{
    label: string; category: string;
    actual: number; estimated: number; error: number; confidence: string;
  }> = [];

  for (const tc of CASES) {
    // Get real preview
    const actual = await realPreview(audienceId, tc.label, tc.filters);
    await sleep(1500);

    // Get estimate (instant)
    const est = await estimate(tc.filters);

    completed++;
    const elapsed = (Date.now() - startTime) / 1000;
    const remaining = Math.round((elapsed / completed) * (totalProbes - completed) / 60);

    const errorPct = actual > 0 && est.count >= 0
      ? ((est.count - actual) / actual) * 100
      : NaN;
    const errorStr = isNaN(errorPct) ? 'N/A' : pctError(est.count, actual);

    console.log(
      `  ${tc.label.padEnd(45)} ${fmt(actual).padStart(9)} ${fmt(est.count).padStart(10)} ${errorStr.padStart(8)} ${est.confidence.padStart(6)}  ~${remaining}m left`
    );

    if (actual > 0 && est.count >= 0) {
      results.push({
        label: tc.label,
        category: tc.category,
        actual,
        estimated: est.count,
        error: errorPct,
        confidence: est.confidence,
      });
    }
  }

  // ── SUMMARY ─────────────────────────────────────────────────────────────────
  console.log('\n' + '═'.repeat(85));
  console.log('  ESTIMATOR VALIDATION SUMMARY');
  console.log('═'.repeat(85) + '\n');

  // By category
  const categories = [...new Set(results.map(r => r.category))];
  console.log(`  ${'Category'.padEnd(22)} ${'N'.padStart(3)} ${'Mean Err'.padStart(9)} ${'|Mean|Err'.padStart(10)} ${'Min'.padStart(8)} ${'Max'.padStart(8)}`);
  console.log(`  ${'-'.repeat(65)}`);

  for (const cat of categories) {
    const catResults = results.filter(r => r.category === cat);
    const meanErr = catResults.reduce((a, r) => a + r.error, 0) / catResults.length;
    const absMeanErr = catResults.reduce((a, r) => a + Math.abs(r.error), 0) / catResults.length;
    const minErr = Math.min(...catResults.map(r => r.error));
    const maxErr = Math.max(...catResults.map(r => r.error));
    console.log(
      `  ${cat.padEnd(22)} ${catResults.length.toString().padStart(3)} ${(meanErr.toFixed(1) + '%').padStart(9)} ${(absMeanErr.toFixed(1) + '%').padStart(10)} ${(minErr.toFixed(1) + '%').padStart(8)} ${(maxErr.toFixed(1) + '%').padStart(8)}`
    );
  }

  // Overall
  const overallMean = results.reduce((a, r) => a + r.error, 0) / results.length;
  const overallAbsMean = results.reduce((a, r) => a + Math.abs(r.error), 0) / results.length;
  const overallMin = Math.min(...results.map(r => r.error));
  const overallMax = Math.max(...results.map(r => r.error));
  const within25 = results.filter(r => Math.abs(r.error) <= 25).length;
  const within50 = results.filter(r => Math.abs(r.error) <= 50).length;

  console.log(`  ${'-'.repeat(65)}`);
  console.log(
    `  ${'OVERALL'.padEnd(22)} ${results.length.toString().padStart(3)} ${(overallMean.toFixed(1) + '%').padStart(9)} ${(overallAbsMean.toFixed(1) + '%').padStart(10)} ${(overallMin.toFixed(1) + '%').padStart(8)} ${(overallMax.toFixed(1) + '%').padStart(8)}`
  );

  console.log(`\n  Accuracy bands:`);
  console.log(`    Within ±25%:  ${within25}/${results.length} (${(within25/results.length*100).toFixed(0)}%)`);
  console.log(`    Within ±50%:  ${within50}/${results.length} (${(within50/results.length*100).toFixed(0)}%)`);

  // Worst cases
  const sorted = [...results].sort((a, b) => Math.abs(b.error) - Math.abs(a.error));
  console.log(`\n  Worst 5 misses:`);
  for (const r of sorted.slice(0, 5)) {
    console.log(`    ${r.label.padEnd(45)} actual=${fmt(r.actual).padStart(9)}  est=${fmt(r.estimated).padStart(9)}  err=${pctError(r.estimated, r.actual).padStart(8)}`);
  }

  // Best cases
  console.log(`\n  Best 5 hits:`);
  const sortedBest = [...results].sort((a, b) => Math.abs(a.error) - Math.abs(b.error));
  for (const r of sortedBest.slice(0, 5)) {
    console.log(`    ${r.label.padEnd(45)} actual=${fmt(r.actual).padStart(9)}  est=${fmt(r.estimated).padStart(9)}  err=${pctError(r.estimated, r.actual).padStart(8)}`);
  }

  const elapsedMin = ((Date.now() - startTime) / 60000).toFixed(1);
  console.log(`\n  Completed in ${elapsedMin} min. ${results.length} valid comparisons.\n`);
}

main().catch(err => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
