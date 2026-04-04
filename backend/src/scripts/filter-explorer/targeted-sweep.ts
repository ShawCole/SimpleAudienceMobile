/**
 * Targeted Sweeps — High-ROI probes for specific accuracy gaps
 *
 * 1. Broad-base state retention: M+Staff+25-34+HO (no married/children) × 6 states
 *    → Fixes state -31% error caused by narrow anchor mismatch
 *
 * 2. Female L2 paired enrichment: F+Staff+25-34+HO + Cr750/Inc100k/NW750k → sweep enrichment
 *    → Fixes HO stacking +32% error caused by Male-only L2 data
 *
 * Usage:
 *   AUDIENCE_ID=<id> API_BASE=http://localhost:3001/api npx tsx backend/src/scripts/filter-explorer/targeted-sweep.ts
 */

import fs from 'fs';
import path from 'path';
import { buildPayload, type FilterSpec, type TestCase } from './payload-factory';
import { EXPLORER_CONFIG } from './config';

const API_BASE = process.env.API_BASE || 'http://localhost:3001/api';

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function api(apiPath: string, body?: any): Promise<any> {
  const res = await fetch(`${API_BASE}${apiPath}`, {
    method: body ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`API ${apiPath} returned ${res.status}: ${text.substring(0, 300)}`);
  }
  return res.json();
}

function filterLabel(spec: FilterSpec): string {
  if (spec.range) return `${spec.key}=[${spec.range.min}-${spec.range.max}]`;
  return `${spec.key}=${spec.values.join('+')}`;
}

async function preview(audienceId: string, label: string, filters: FilterSpec[]): Promise<number> {
  const tc: TestCase = { id: label, phase: 'targeted', label, filters };
  const payload = buildPayload(tc, audienceId);
  const result = await api('/audiences/preview', payload);
  return result.data?.count ?? result.count ?? -1;
}

// ── Sweep 1: Broad-base state retention ─────────────────────────────────────
// Measure state retention on BROAD demographics (no married/children)
// to compare against narrow-anchor measurements.

interface BroadStateCombo {
  label: string;
  filters: FilterSpec[];
}

const BROAD_STATE_COMBOS: BroadStateCombo[] = [
  // The exact combos from validation that showed -31% to -42% error
  {
    label: 'M+Staff+25-34+HO',
    filters: [
      { key: 'profile.gender', values: ['Male'] },
      { key: 'businessProfile.seniority', values: ['staff'] },
      { key: 'age', values: ['25-34'], range: { min: 25, max: 34 } },
      { key: 'profile.homeowner', values: ['Homeowner'] },
    ],
  },
  {
    label: 'F+Manager+35-44+HO',
    filters: [
      { key: 'profile.gender', values: ['Female'] },
      { key: 'businessProfile.seniority', values: ['manager'] },
      { key: 'age', values: ['35-44'], range: { min: 35, max: 44 } },
      { key: 'profile.homeowner', values: ['Homeowner'] },
    ],
  },
  {
    label: 'M+CXO+45-54+HO',
    filters: [
      { key: 'profile.gender', values: ['Male'] },
      { key: 'businessProfile.seniority', values: ['cxo'] },
      { key: 'age', values: ['45-54'], range: { min: 45, max: 54 } },
      { key: 'profile.homeowner', values: ['Homeowner'] },
    ],
  },
  {
    label: 'F+Director+35-44+HO',
    filters: [
      { key: 'profile.gender', values: ['Female'] },
      { key: 'businessProfile.seniority', values: ['director'] },
      { key: 'age', values: ['35-44'], range: { min: 35, max: 44 } },
      { key: 'profile.homeowner', values: ['Homeowner'] },
    ],
  },
];

const ALL_STATES = [
  'California', 'Texas', 'Florida', 'New York', 'Pennsylvania', 'Ohio',
  'Illinois', 'North Carolina', 'Georgia', 'Michigan', 'Virginia', 'New Jersey',
  'Colorado', 'Washington', 'Tennessee', 'Maryland', 'Indiana', 'Arizona',
  'Missouri', 'Wisconsin', 'Massachusetts', 'Minnesota', 'Alabama', 'South Carolina',
  'Louisiana', 'Oregon', 'Kentucky', 'Connecticut', 'Oklahoma', 'Nevada',
  'Utah', 'Iowa', 'Arkansas', 'Kansas', 'Mississippi', 'Nebraska',
  'New Mexico', 'Idaho', 'West Virginia', 'Delaware', 'Maine', 'New Hampshire',
  'Rhode Island', 'Montana', 'Hawaii', 'South Dakota', 'North Dakota', 'Alaska',
  'Vermont', 'Wyoming',
];

async function sweepBroadState(audienceId: string): Promise<void> {
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const outDir = path.join(__dirname, '../../../data/filter-explorer/calibration');
  const outFile = path.join(outDir, `broad-state-${ts}.ndjson`);

  console.log('\n' + '='.repeat(60));
  console.log('  SWEEP 1: Broad-base State Retention');
  console.log('  (no married/children → matches grid base)');
  console.log('='.repeat(60));

  let total = 0;
  for (const combo of BROAD_STATE_COMBOS) {
    // First get the broad base count
    const baseCount = await preview(audienceId, `base:${combo.label}`, combo.filters);
    console.log(`\n  ${combo.label}: base=${baseCount.toLocaleString()}`);
    await sleep(1500);

    for (const state of ALL_STATES) {
      const stateFilters = [...combo.filters, { key: 'state', values: [state] }];
      try {
        const count = await preview(audienceId, `${combo.label}+${state}`, stateFilters);
        const retention = baseCount > 0 ? count / baseCount : 0;

        const record = {
          comboLabel: combo.label,
          baseCount,
          state,
          count,
          retention,
          timestamp: new Date().toISOString(),
          success: true,
        };
        fs.appendFileSync(outFile, JSON.stringify(record) + '\n');
        total++;

        console.log(`    ${state.padEnd(20)} ${count.toLocaleString().padStart(10)} (${(retention * 100).toFixed(2)}%)`);
      } catch (err: any) {
        console.error(`    ${state.padEnd(20)} ERROR: ${err.message.substring(0, 80)}`);
        fs.appendFileSync(outFile, JSON.stringify({
          comboLabel: combo.label, baseCount, state, count: 0, retention: 0,
          timestamp: new Date().toISOString(), success: false, error: err.message,
        }) + '\n');
        total++;
      }

      await sleep(1500 + Math.random() * 500);
    }
  }

  console.log(`\n  Broad state sweep: ${total} probes → ${path.basename(outFile)}`);
}

// ── Sweep 2: Female L2 paired enrichment ────────────────────────────────────

const FEMALE_STAFF_25_34_HO: FilterSpec[] = [
  { key: 'profile.gender', values: ['Female'] },
  { key: 'profile.homeowner', values: ['Homeowner'] },
  { key: 'profile.married', values: ['No'] },
  { key: 'profile.children', values: ['No children'] },
  { key: 'businessProfile.seniority', values: ['staff'] },
  { key: 'age', values: ['25-34'], range: { min: 25, max: 34 } },
];

interface L2Combo {
  label: string;
  anchorFilters: FilterSpec[];
  fixedEnrichment: FilterSpec;
}

const FEMALE_L2_COMBOS: L2Combo[] = [
  { label: 'F-Staff25-34-HO+Cr750', anchorFilters: FEMALE_STAFF_25_34_HO, fixedEnrichment: { key: 'attributes.credit_rating', values: ['750 - 799'] } },
  { label: 'F-Staff25-34-HO+Inc100k', anchorFilters: FEMALE_STAFF_25_34_HO, fixedEnrichment: { key: 'profile.incomeRange', values: ['$100,000 to $149,999'] } },
  { label: 'F-Staff25-34-HO+NW750k', anchorFilters: FEMALE_STAFF_25_34_HO, fixedEnrichment: { key: 'profile.netWorth', values: ['$750,000 to $999,999'] } },
];

const ENRICHMENT_SWEEP: FilterSpec[] = [
  { key: 'profile.incomeRange', values: ['less than $20,000'] },
  { key: 'profile.incomeRange', values: ['$20,000 to $44,999'] },
  { key: 'profile.incomeRange', values: ['$45,000 to $59,999'] },
  { key: 'profile.incomeRange', values: ['$60,000 to $74,999'] },
  { key: 'profile.incomeRange', values: ['$75,000 to $99,999'] },
  { key: 'profile.incomeRange', values: ['$100,000 to $149,999'] },
  { key: 'profile.incomeRange', values: ['$150,000 to $199,999'] },
  { key: 'profile.incomeRange', values: ['$200,000 to $249,999'] },
  { key: 'profile.incomeRange', values: ['$250,000+'] },
  { key: 'attributes.credit_rating', values: ['Under 499'] },
  { key: 'attributes.credit_rating', values: ['500 - 549'] },
  { key: 'attributes.credit_rating', values: ['550 - 599'] },
  { key: 'attributes.credit_rating', values: ['600 - 649'] },
  { key: 'attributes.credit_rating', values: ['650 - 699'] },
  { key: 'attributes.credit_rating', values: ['700 - 749'] },
  { key: 'attributes.credit_rating', values: ['750 - 799'] },
  { key: 'attributes.credit_rating', values: ['800+'] },
  { key: 'profile.netWorth', values: ['-$20,000 to -$2,500'] },
  { key: 'profile.netWorth', values: ['-$2,499 to $2,499'] },
  { key: 'profile.netWorth', values: ['$2,500 to $24,999'] },
  { key: 'profile.netWorth', values: ['$25,000 to $49,999'] },
  { key: 'profile.netWorth', values: ['$50,000 to $74,999'] },
  { key: 'profile.netWorth', values: ['$75,000 to $99,999'] },
  { key: 'profile.netWorth', values: ['$100,000 to $149,999'] },
  { key: 'profile.netWorth', values: ['$150,000 to $249,999'] },
  { key: 'profile.netWorth', values: ['$250,000 to $374,999'] },
  { key: 'profile.netWorth', values: ['$375,000 to $499,999'] },
  { key: 'profile.netWorth', values: ['$500,000 to $749,999'] },
  { key: 'profile.netWorth', values: ['$750,000 to $999,999'] },
  { key: 'profile.netWorth', values: ['more than $1,000,000'] },
  { key: 'attributes.education', values: ['High School'] },
  { key: 'attributes.education', values: ["Bachelor's"] },
  { key: 'attributes.education', values: ["Master's"] },
  { key: 'attributes.education', values: ['Doctorate'] },
];

async function sweepFemaleL2(audienceId: string): Promise<void> {
  console.log('\n' + '='.repeat(60));
  console.log('  SWEEP 2: Female L2 Paired Enrichment');
  console.log('='.repeat(60));

  for (const combo of FEMALE_L2_COMBOS) {
    const baseFilters = [...combo.anchorFilters, combo.fixedEnrichment];
    const fixedLabel = filterLabel(combo.fixedEnrichment);

    // Get base count
    let baseCount: number;
    try {
      baseCount = await preview(audienceId, `base:${combo.label}`, baseFilters);
      console.log(`\n  ${combo.label} (base=${baseCount.toLocaleString()})`);
    } catch (err: any) {
      console.error(`  ❌ ${combo.label} base failed: ${err.message}`);
      continue;
    }
    await sleep(2000);

    // Sweep enrichment (skip own key)
    const sweepFilters = ENRICHMENT_SWEEP.filter(f => f.key !== combo.fixedEnrichment.key);

    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const outDir = path.join(__dirname, '../../../data/filter-explorer/calibration');
    const outFile = path.join(outDir, `layer2-${combo.label}-${ts}.ndjson`);

    let completed = 0;
    for (const testFilter of sweepFilters) {
      const allFilters = [...baseFilters, testFilter];
      const testLabel = filterLabel(testFilter);

      try {
        const count = await preview(audienceId, `${combo.label}|${testLabel}`, allFilters);
        const retentionFromBase = baseCount > 0 ? count / baseCount : 0;

        fs.appendFileSync(outFile, JSON.stringify({
          comboLabel: combo.label,
          fixedFilter: combo.fixedEnrichment,
          fixedLabel,
          baseCount,
          testFilter,
          testLabel,
          combinedCount: count,
          retentionFromBase,
          timestamp: new Date().toISOString(),
          success: true,
        }) + '\n');

        completed++;
        console.log(`    [${completed}/${sweepFilters.length}] ${testLabel} => ${count.toLocaleString()} (${(retentionFromBase * 100).toFixed(1)}%)`);
      } catch (err: any) {
        completed++;
        fs.appendFileSync(outFile, JSON.stringify({
          comboLabel: combo.label,
          fixedFilter: combo.fixedEnrichment,
          fixedLabel,
          baseCount,
          testFilter,
          testLabel,
          combinedCount: 0,
          retentionFromBase: null,
          timestamp: new Date().toISOString(),
          success: false,
          error: err.message,
        }) + '\n');
        console.error(`    [${completed}/${sweepFilters.length}] ${testLabel} => ERROR`);
      }

      await sleep(1500 + Math.random() * 500);
    }

    console.log(`  → ${path.basename(outFile)}`);
  }
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const audienceId = process.env.AUDIENCE_ID || EXPLORER_CONFIG.defaultAudienceId;
  if (!audienceId) {
    console.error('Set AUDIENCE_ID env var');
    process.exit(1);
  }

  const statesOnly = process.argv.includes('--states-only');

  console.log(`[targeted] Audience: ${audienceId}`);
  console.log(`[targeted] Sweep 1: ${BROAD_STATE_COMBOS.length} combos × ${ALL_STATES.length} states = ${BROAD_STATE_COMBOS.length * ALL_STATES.length} probes`);
  if (!statesOnly) {
    console.log(`[targeted] Sweep 2: ${FEMALE_L2_COMBOS.length} combos × ~26 enrichment = ~${FEMALE_L2_COMBOS.length * 26} probes`);
  }
  console.log();

  await sweepBroadState(audienceId);
  if (!statesOnly) {
    await sweepFemaleL2(audienceId);
  }

  console.log('\n[targeted] ALL SWEEPS COMPLETE');
}

main().catch(err => {
  console.error('[targeted] Fatal:', err.message);
  process.exit(1);
});
