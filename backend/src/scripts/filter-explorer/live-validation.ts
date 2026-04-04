/**
 * Live Validation — tests estimator against real IntentCore previews.
 * Uses NOVEL queries (demographics and combos NOT in stacking training data).
 *
 * Usage:
 *   AUDIENCE_ID=<id> API_BASE=http://localhost:3001/api npx tsx backend/src/scripts/filter-explorer/live-validation.ts
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
  if (!r.ok) {
    const text = await r.text().catch(() => '');
    throw new Error(`API ${path} returned ${r.status}: ${text.substring(0, 200)}`);
  }
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

const tests: Array<{ label: string; filters: FilterSpec[] }> = [
  // HO Director (not in stacking data)
  { label: 'HO:M+Dir+35-44+Cr750+Inc100k', filters: [
    { key: 'profile.gender', values: ['Male'] }, { key: 'profile.homeowner', values: ['Homeowner'] },
    { key: 'profile.married', values: ['No'] }, { key: 'businessProfile.seniority', values: ['director'] },
    { key: 'age', values: ['35-44'], range: { min: 35, max: 44 } },
    { key: 'attributes.credit_rating', values: ['750 - 799'] },
    { key: 'profile.incomeRange', values: ['$100,000 to $149,999'] },
  ]},
  // HO VP (not in stacking data)
  { label: 'HO:F+VP+45-54+Cr750+NW500k', filters: [
    { key: 'profile.gender', values: ['Female'] }, { key: 'profile.homeowner', values: ['Homeowner'] },
    { key: 'profile.married', values: ['No'] }, { key: 'businessProfile.seniority', values: ['vp'] },
    { key: 'age', values: ['45-54'], range: { min: 45, max: 54 } },
    { key: 'attributes.credit_rating', values: ['750 - 799'] },
    { key: 'profile.netWorth', values: ['$500,000 to $749,999'] },
  ]},
  // Renter Director (not in stacking data)
  { label: 'R:M+Dir+35-44+Cr750+EduBach', filters: [
    { key: 'profile.gender', values: ['Male'] }, { key: 'profile.homeowner', values: ['Renter'] },
    { key: 'profile.married', values: ['No'] }, { key: 'businessProfile.seniority', values: ['director'] },
    { key: 'age', values: ['35-44'], range: { min: 35, max: 44 } },
    { key: 'attributes.credit_rating', values: ['750 - 799'] },
    { key: 'attributes.education', values: ["Bachelor's"] },
  ]},
  // Renter VP married (not in stacking data)
  { label: 'R:F+MarriedVP+45-54+Inc100k+CA', filters: [
    { key: 'profile.gender', values: ['Female'] }, { key: 'profile.homeowner', values: ['Renter'] },
    { key: 'profile.married', values: ['Yes'] }, { key: 'businessProfile.seniority', values: ['vp'] },
    { key: 'age', values: ['45-54'], range: { min: 45, max: 54 } },
    { key: 'profile.incomeRange', values: ['$100,000 to $149,999'] },
    { key: 'state', values: ['California'] },
  ]},
  // Single filters — baseline accuracy
  { label: 'HO:M+Mgr+25-34+Cr750', filters: [
    { key: 'profile.gender', values: ['Male'] }, { key: 'profile.homeowner', values: ['Homeowner'] },
    { key: 'businessProfile.seniority', values: ['manager'] },
    { key: 'age', values: ['25-34'], range: { min: 25, max: 34 } },
    { key: 'attributes.credit_rating', values: ['750 - 799'] },
  ]},
  { label: 'R:F+Staff+25-34+NW750k', filters: [
    { key: 'profile.gender', values: ['Female'] }, { key: 'profile.homeowner', values: ['Renter'] },
    { key: 'businessProfile.seniority', values: ['staff'] },
    { key: 'age', values: ['25-34'], range: { min: 25, max: 34 } },
    { key: 'profile.netWorth', values: ['$750,000 to $999,999'] },
  ]},
  // Triple stack on novel anchor
  { label: 'HO:F+Mgr+35-44+Cr750+Inc100k+NW500k', filters: [
    { key: 'profile.gender', values: ['Female'] }, { key: 'profile.homeowner', values: ['Homeowner'] },
    { key: 'profile.married', values: ['Yes'] }, { key: 'businessProfile.seniority', values: ['manager'] },
    { key: 'age', values: ['35-44'], range: { min: 35, max: 44 } },
    { key: 'attributes.credit_rating', values: ['750 - 799'] },
    { key: 'profile.incomeRange', values: ['$100,000 to $149,999'] },
    { key: 'profile.netWorth', values: ['$500,000 to $749,999'] },
  ]},
  { label: 'R:M+Staff+35-44+Cr750+Inc100k+EduBach', filters: [
    { key: 'profile.gender', values: ['Male'] }, { key: 'profile.homeowner', values: ['Renter'] },
    { key: 'profile.married', values: ['No'] }, { key: 'businessProfile.seniority', values: ['staff'] },
    { key: 'age', values: ['35-44'], range: { min: 35, max: 44 } },
    { key: 'attributes.credit_rating', values: ['750 - 799'] },
    { key: 'profile.incomeRange', values: ['$100,000 to $149,999'] },
    { key: 'attributes.education', values: ["Bachelor's"] },
  ]},
  // Demographics only — no enrichment (should match grid exactly)
  { label: 'R:F+Married+CXO+45-54 (demo)', filters: [
    { key: 'profile.gender', values: ['Female'] }, { key: 'profile.homeowner', values: ['Renter'] },
    { key: 'profile.married', values: ['Yes'] }, { key: 'businessProfile.seniority', values: ['cxo'] },
    { key: 'age', values: ['45-54'], range: { min: 45, max: 54 } },
  ]},
  { label: 'HO:M+Dir+55-64 (demo)', filters: [
    { key: 'profile.gender', values: ['Male'] }, { key: 'profile.homeowner', values: ['Homeowner'] },
    { key: 'businessProfile.seniority', values: ['director'] },
    { key: 'age', values: ['55-64'], range: { min: 55, max: 64 } },
  ]},
];

async function main() {
  if (!AUDIENCE_ID) {
    console.error('AUDIENCE_ID env var required');
    process.exit(1);
  }

  let w25 = 0, w50 = 0, tot = 0, tErr = 0;
  console.log('Test'.padEnd(44) + 'Actual'.padStart(8) + 'Est'.padStart(8) + 'Err%'.padStart(8) + ' ±25%');
  console.log('-'.repeat(72));

  for (const t of tests) {
    const est = estimateAudienceSize(t.filters);
    const actual = await realPreview(t.label, t.filters);
    await sleep(2000);

    if (actual < 0) {
      console.log(t.label.padEnd(44) + 'ERROR'.padStart(8));
      continue;
    }

    const err = actual > 0 ? (est.estimatedCount - actual) / actual : 0;
    const ae = Math.abs(err);
    tot++;
    tErr += ae;
    if (ae <= 0.25) w25++;
    if (ae <= 0.50) w50++;
    const m = ae <= 0.25 ? '✓' : ae <= 0.50 ? '~' : '✗';
    console.log(
      t.label.padEnd(44) +
      actual.toLocaleString().padStart(8) +
      est.estimatedCount.toLocaleString().padStart(8) +
      ((err >= 0 ? '+' : '') + (err * 100).toFixed(0) + '%').padStart(8) +
      ' ' + m
    );
  }

  console.log();
  console.log('=== LIVE VALIDATION ===');
  console.log(`Within ±25%: ${w25}/${tot} (${(w25/tot*100).toFixed(0)}%)`);
  console.log(`Within ±50%: ${w50}/${tot} (${(w50/tot*100).toFixed(0)}%)`);
  console.log(`MAE: ${(tErr/tot*100).toFixed(1)}%`);
}

main().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
