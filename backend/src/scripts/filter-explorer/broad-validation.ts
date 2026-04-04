/**
 * Broad Validation — 25 novel queries across diverse demographics and filter combos.
 * Tests generalization of the retention-based interaction model.
 *
 * Usage:
 *   AUDIENCE_ID=<id> API_BASE=http://localhost:3001/api npx tsx backend/src/scripts/filter-explorer/broad-validation.ts
 */

import { estimateAudienceSize } from '../../services/audience-estimator';
import { buildPayload, type FilterSpec, type TestCase } from './payload-factory';

const API_BASE = process.env.API_BASE || 'http://localhost:3001/api';
const AUDIENCE_ID = process.env.AUDIENCE_ID || '';

async function api(path: string, body?: any): Promise<any> {
  const r = await fetch(`${API_BASE}${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) throw new Error(`API ${path} returned ${r.status}`);
  return r.json();
}

async function realPreview(label: string, filters: FilterSpec[]): Promise<number> {
  const tc: TestCase = { id: label, phase: 'single', label, filters };
  const payload = buildPayload(tc, AUDIENCE_ID);
  try {
    const result = await api('/audiences/preview', payload);
    return result.data?.count ?? result.count ?? -1;
  } catch (err: any) {
    console.log(`  ⚠️ ERROR: ${err.message.substring(0, 80)}`);
    return -1;
  }
}

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

// Helper to build filter arrays concisely
function f(key: string, values: string[], range?: { min: number; max: number }): FilterSpec {
  return range ? { key, values, range } : { key, values };
}

const tests: Array<{ label: string; filters: FilterSpec[] }> = [
  // ── DEMOGRAPHICS ONLY (grid accuracy) ──────────────────────────────
  { label: 'HO:F+Staff+25-34 (demo)', filters: [
    f('profile.gender', ['Female']), f('profile.homeowner', ['Homeowner']),
    f('businessProfile.seniority', ['staff']), f('age', ['25-34'], { min: 25, max: 34 }),
  ]},
  { label: 'R:M+CXO+55-64 (demo)', filters: [
    f('profile.gender', ['Male']), f('profile.homeowner', ['Renter']),
    f('businessProfile.seniority', ['cxo']), f('age', ['55-64'], { min: 55, max: 64 }),
  ]},
  { label: 'HO:F+Married+VP+65+ (demo)', filters: [
    f('profile.gender', ['Female']), f('profile.homeowner', ['Homeowner']),
    f('profile.married', ['Yes']), f('businessProfile.seniority', ['vp']),
    f('age', ['65+'], { min: 65, max: 99 }),
  ]},

  // ── SINGLE ENRICHMENT (L1 retention accuracy) ─────────────────────
  { label: 'HO:M+VP+35-44+Inc150k', filters: [
    f('profile.gender', ['Male']), f('profile.homeowner', ['Homeowner']),
    f('businessProfile.seniority', ['vp']), f('age', ['35-44'], { min: 35, max: 44 }),
    f('profile.incomeRange', ['$150,000 to $199,999']),
  ]},
  { label: 'R:F+Mgr+25-34+Cr800+', filters: [
    f('profile.gender', ['Female']), f('profile.homeowner', ['Renter']),
    f('businessProfile.seniority', ['manager']), f('age', ['25-34'], { min: 25, max: 34 }),
    f('attributes.credit_rating', ['800+']),
  ]},
  { label: 'HO:M+Dir+45-54+NW1M+', filters: [
    f('profile.gender', ['Male']), f('profile.homeowner', ['Homeowner']),
    f('businessProfile.seniority', ['director']), f('age', ['45-54'], { min: 45, max: 54 }),
    f('profile.netWorth', ['more than $1,000,000']),
  ]},
  { label: 'R:M+Staff+35-44+EduHS', filters: [
    f('profile.gender', ['Male']), f('profile.homeowner', ['Renter']),
    f('businessProfile.seniority', ['staff']), f('age', ['35-44'], { min: 35, max: 44 }),
    f('attributes.education', ['High School']),
  ]},
  { label: 'HO:F+CXO+45-54+Florida', filters: [
    f('profile.gender', ['Female']), f('profile.homeowner', ['Homeowner']),
    f('businessProfile.seniority', ['cxo']), f('age', ['45-54'], { min: 45, max: 54 }),
    f('state', ['Florida']),
  ]},

  // ── 2-FILTER STACKS (interaction accuracy) ─────────────────────────
  { label: 'HO:M+Mgr+45-54+Cr750+TX', filters: [
    f('profile.gender', ['Male']), f('profile.homeowner', ['Homeowner']),
    f('businessProfile.seniority', ['manager']), f('age', ['45-54'], { min: 45, max: 54 }),
    f('attributes.credit_rating', ['750 - 799']), f('state', ['Texas']),
  ]},
  { label: 'R:F+Staff+35-44+Inc100k+EduBach', filters: [
    f('profile.gender', ['Female']), f('profile.homeowner', ['Renter']),
    f('businessProfile.seniority', ['staff']), f('age', ['35-44'], { min: 35, max: 44 }),
    f('profile.incomeRange', ['$100,000 to $149,999']), f('attributes.education', ["Bachelor's"]),
  ]},
  { label: 'HO:F+Dir+35-44+Cr650+Inc45k', filters: [
    f('profile.gender', ['Female']), f('profile.homeowner', ['Homeowner']),
    f('businessProfile.seniority', ['director']), f('age', ['35-44'], { min: 35, max: 44 }),
    f('attributes.credit_rating', ['650 - 699']), f('profile.incomeRange', ['$45,000 to $59,999']),
  ]},
  { label: 'R:M+CXO+45-54+NW500k+FL', filters: [
    f('profile.gender', ['Male']), f('profile.homeowner', ['Renter']),
    f('businessProfile.seniority', ['cxo']), f('age', ['45-54'], { min: 45, max: 54 }),
    f('profile.netWorth', ['$500,000 to $749,999']), f('state', ['Florida']),
  ]},
  { label: 'HO:M+Staff+25-34+Cr750+NW500k', filters: [
    f('profile.gender', ['Male']), f('profile.homeowner', ['Homeowner']),
    f('businessProfile.seniority', ['staff']), f('age', ['25-34'], { min: 25, max: 34 }),
    f('attributes.credit_rating', ['750 - 799']), f('profile.netWorth', ['$500,000 to $749,999']),
  ]},
  { label: 'R:F+Married+Mgr+35-44+Cr750+Inc100k', filters: [
    f('profile.gender', ['Female']), f('profile.homeowner', ['Renter']),
    f('profile.married', ['Yes']), f('businessProfile.seniority', ['manager']),
    f('age', ['35-44'], { min: 35, max: 44 }),
    f('attributes.credit_rating', ['750 - 799']), f('profile.incomeRange', ['$100,000 to $149,999']),
  ]},

  // ── 3-FILTER STACKS (hardest) ──────────────────────────────────────
  { label: 'HO:M+Dir+45-54+Cr750+Inc100k+CA', filters: [
    f('profile.gender', ['Male']), f('profile.homeowner', ['Homeowner']),
    f('businessProfile.seniority', ['director']), f('age', ['45-54'], { min: 45, max: 54 }),
    f('attributes.credit_rating', ['750 - 799']), f('profile.incomeRange', ['$100,000 to $149,999']),
    f('state', ['California']),
  ]},
  { label: 'R:M+Mgr+35-44+Cr750+NW500k+EduBach', filters: [
    f('profile.gender', ['Male']), f('profile.homeowner', ['Renter']),
    f('businessProfile.seniority', ['manager']), f('age', ['35-44'], { min: 35, max: 44 }),
    f('attributes.credit_rating', ['750 - 799']), f('profile.netWorth', ['$500,000 to $749,999']),
    f('attributes.education', ["Bachelor's"]),
  ]},
  { label: 'HO:F+VP+45-54+Cr750+Inc100k+EduBach', filters: [
    f('profile.gender', ['Female']), f('profile.homeowner', ['Homeowner']),
    f('businessProfile.seniority', ['vp']), f('age', ['45-54'], { min: 45, max: 54 }),
    f('attributes.credit_rating', ['750 - 799']), f('profile.incomeRange', ['$100,000 to $149,999']),
    f('attributes.education', ["Bachelor's"]),
  ]},
  { label: 'R:F+Staff+25-34+Cr650+Inc45k+TX', filters: [
    f('profile.gender', ['Female']), f('profile.homeowner', ['Renter']),
    f('businessProfile.seniority', ['staff']), f('age', ['25-34'], { min: 25, max: 34 }),
    f('attributes.credit_rating', ['650 - 699']), f('profile.incomeRange', ['$45,000 to $59,999']),
    f('state', ['Texas']),
  ]},

  // ── EDGE CASES ─────────────────────────────────────────────────────
  { label: 'R:M+Staff+18-24+Cr650 (young)', filters: [
    f('profile.gender', ['Male']), f('profile.homeowner', ['Renter']),
    f('businessProfile.seniority', ['staff']), f('age', ['18-24'], { min: 18, max: 24 }),
    f('attributes.credit_rating', ['650 - 699']),
  ]},
  { label: 'HO:F+CXO+65++Inc100k (old)', filters: [
    f('profile.gender', ['Female']), f('profile.homeowner', ['Homeowner']),
    f('businessProfile.seniority', ['cxo']), f('age', ['65+'], { min: 65, max: 99 }),
    f('profile.incomeRange', ['$100,000 to $149,999']),
  ]},
  { label: 'R:F+Dir+55-64+NW750k+CA', filters: [
    f('profile.gender', ['Female']), f('profile.homeowner', ['Renter']),
    f('businessProfile.seniority', ['director']), f('age', ['55-64'], { min: 55, max: 64 }),
    f('profile.netWorth', ['$750,000 to $999,999']), f('state', ['California']),
  ]},
  { label: 'HO:M+Married+Staff+35-44+Cr750+NY', filters: [
    f('profile.gender', ['Male']), f('profile.homeowner', ['Homeowner']),
    f('profile.married', ['Yes']), f('businessProfile.seniority', ['staff']),
    f('age', ['35-44'], { min: 35, max: 44 }),
    f('attributes.credit_rating', ['750 - 799']), f('state', ['New York']),
  ]},

  // ── BLENDED (no homeowner filter) ──────────────────────────────────
  { label: 'Blended:F+Mgr+35-44+Cr750', filters: [
    f('profile.gender', ['Female']),
    f('businessProfile.seniority', ['manager']), f('age', ['35-44'], { min: 35, max: 44 }),
    f('attributes.credit_rating', ['750 - 799']),
  ]},
  { label: 'Blended:M+Staff+25-34+Inc100k+CA', filters: [
    f('profile.gender', ['Male']),
    f('businessProfile.seniority', ['staff']), f('age', ['25-34'], { min: 25, max: 34 }),
    f('profile.incomeRange', ['$100,000 to $149,999']), f('state', ['California']),
  ]},
];

async function main() {
  if (!AUDIENCE_ID) { console.error('AUDIENCE_ID required'); process.exit(1); }

  let w25 = 0, w50 = 0, tot = 0, tErr = 0;
  const categories: Record<string, { w25: number; tot: number }> = {
    'demo': { w25: 0, tot: 0 },
    'single': { w25: 0, tot: 0 },
    '2-stack': { w25: 0, tot: 0 },
    '3-stack': { w25: 0, tot: 0 },
    'edge': { w25: 0, tot: 0 },
    'blended': { w25: 0, tot: 0 },
  };

  console.log('Test'.padEnd(46) + 'Actual'.padStart(8) + 'Est'.padStart(8) + 'Err%'.padStart(8) + ' ±25%');
  console.log('-'.repeat(74));

  for (let i = 0; i < tests.length; i++) {
    const t = tests[i];
    const est = estimateAudienceSize(t.filters);
    const actual = await realPreview(t.label, t.filters);
    await sleep(2000);

    if (actual < 0) {
      console.log(t.label.padEnd(46) + 'ERROR'.padStart(8));
      continue;
    }

    const err = actual > 0 ? (est.estimatedCount - actual) / actual : 0;
    const ae = Math.abs(err);
    tot++; tErr += ae;
    if (ae <= 0.25) w25++;
    if (ae <= 0.50) w50++;

    // Categorize
    const cat = t.label.includes('(demo)') ? 'demo'
      : t.label.includes('Blended') ? 'blended'
      : t.label.includes('(young)') || t.label.includes('(old)') || i >= 18 && i <= 21 ? 'edge'
      : t.filters.filter(f => !['profile.gender','profile.homeowner','profile.married','businessProfile.seniority','age'].includes(f.key)).length >= 3 ? '3-stack'
      : t.filters.filter(f => !['profile.gender','profile.homeowner','profile.married','businessProfile.seniority','age'].includes(f.key)).length >= 2 ? '2-stack'
      : 'single';
    if (categories[cat]) {
      categories[cat].tot++;
      if (ae <= 0.25) categories[cat].w25++;
    }

    const m = ae <= 0.25 ? '✓' : ae <= 0.50 ? '~' : '✗';
    console.log(
      t.label.padEnd(46) +
      actual.toLocaleString().padStart(8) +
      est.estimatedCount.toLocaleString().padStart(8) +
      ((err >= 0 ? '+' : '') + (err * 100).toFixed(0) + '%').padStart(8) +
      ' ' + m
    );
  }

  console.log();
  console.log('=== BROAD VALIDATION ===');
  console.log(`Within ±25%: ${w25}/${tot} (${(w25/tot*100).toFixed(0)}%)`);
  console.log(`Within ±50%: ${w50}/${tot} (${(w50/tot*100).toFixed(0)}%)`);
  console.log(`MAE: ${(tErr/tot*100).toFixed(1)}%`);
  console.log();
  console.log('=== BY CATEGORY ===');
  for (const [cat, s] of Object.entries(categories)) {
    if (s.tot === 0) continue;
    console.log(`  ${cat.padEnd(10)} ${s.w25}/${s.tot} (${(s.w25/s.tot*100).toFixed(0)}%) within ±25%`);
  }
}

main().catch(err => { console.error('Fatal:', err.message); process.exit(1); });
