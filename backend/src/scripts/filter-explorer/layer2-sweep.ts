/**
 * Layer 2 Sweep — Paired Enrichment Profiling
 *
 * Takes a demographic anchor + one "fixed" enrichment filter, then sweeps
 * remaining enrichment filters on top to measure real paired retention.
 *
 * This gives us data like: "given Staff+25-34+HO+Credit750, what fraction
 * also has Income100k?" — replacing the multiplicative independence assumption.
 *
 * Usage:
 *   API_BASE=http://localhost:3001/api npx tsx backend/src/scripts/filter-explorer/layer2-sweep.ts
 *
 * Runs all configured combos sequentially. Each combo ~38 probes (~6 min).
 */

import fs from 'fs';
import path from 'path';
import { buildPayload, type FilterSpec, type TestCase } from './payload-factory';
import { EXPLORER_CONFIG } from './config';

const API_BASE = process.env.API_BASE || 'http://localhost:3001/api';

// ── L2 Sweep Combos ────────────────────────────────────────────────────────
// Each combo: demographic anchor filters + one fixed enrichment filter.
// We sweep the remaining enrichment filters on top.

interface L2Combo {
  label: string;
  anchorFilters: FilterSpec[];      // demographic base
  fixedEnrichment: FilterSpec;      // the "first" enrichment filter
}

const ENRICHMENT_SWEEP_VALUES: FilterSpec[] = [
  // Income (9 tiers)
  { key: 'profile.incomeRange', values: ['less than $20,000'] },
  { key: 'profile.incomeRange', values: ['$20,000 to $44,999'] },
  { key: 'profile.incomeRange', values: ['$45,000 to $59,999'] },
  { key: 'profile.incomeRange', values: ['$60,000 to $74,999'] },
  { key: 'profile.incomeRange', values: ['$75,000 to $99,999'] },
  { key: 'profile.incomeRange', values: ['$100,000 to $149,999'] },
  { key: 'profile.incomeRange', values: ['$150,000 to $199,999'] },
  { key: 'profile.incomeRange', values: ['$200,000 to $249,999'] },
  { key: 'profile.incomeRange', values: ['$250,000+'] },
  // Credit (8 tiers)
  { key: 'attributes.credit_rating', values: ['Under 499'] },
  { key: 'attributes.credit_rating', values: ['500 - 549'] },
  { key: 'attributes.credit_rating', values: ['550 - 599'] },
  { key: 'attributes.credit_rating', values: ['600 - 649'] },
  { key: 'attributes.credit_rating', values: ['650 - 699'] },
  { key: 'attributes.credit_rating', values: ['700 - 749'] },
  { key: 'attributes.credit_rating', values: ['750 - 799'] },
  { key: 'attributes.credit_rating', values: ['800+'] },
  // Net Worth (13 tiers)
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
  // Education (4 tiers)
  { key: 'attributes.education', values: ['High School'] },
  { key: 'attributes.education', values: ["Bachelor's"] },
  { key: 'attributes.education', values: ["Master's"] },
  { key: 'attributes.education', values: ['Doctorate'] },
];

// Top 6 states for state×enrichment cross
const STATE_SWEEP_VALUES: FilterSpec[] = [
  { key: 'state', values: ['California'] },
  { key: 'state', values: ['Texas'] },
  { key: 'state', values: ['Florida'] },
  { key: 'state', values: ['New York'] },
  { key: 'state', values: ['Pennsylvania'] },
  { key: 'state', values: ['Ohio'] },
];

// Base demographics for Staff+25-34
const STAFF_25_34_HO: FilterSpec[] = [
  { key: 'profile.gender', values: ['Male'] },
  { key: 'profile.homeowner', values: ['Homeowner'] },
  { key: 'profile.married', values: ['No'] },
  { key: 'profile.children', values: ['No children'] },
  { key: 'businessProfile.seniority', values: ['staff'] },
  { key: 'age', values: ['25-34'], range: { min: 25, max: 34 } },
];

const STAFF_25_34_R: FilterSpec[] = [
  { key: 'profile.gender', values: ['Male'] },
  { key: 'profile.homeowner', values: ['Renter'] },
  { key: 'profile.married', values: ['No'] },
  { key: 'profile.children', values: ['No children'] },
  { key: 'businessProfile.seniority', values: ['staff'] },
  { key: 'age', values: ['25-34'], range: { min: 25, max: 34 } },
];

const CXO_45_54_HO: FilterSpec[] = [
  { key: 'profile.gender', values: ['Male'] },
  { key: 'profile.homeowner', values: ['Homeowner'] },
  { key: 'profile.married', values: ['No'] },
  { key: 'profile.children', values: ['No children'] },
  { key: 'businessProfile.seniority', values: ['cxo'] },
  { key: 'age', values: ['45-54'], range: { min: 45, max: 54 } },
];

const VP_45_54_HO: FilterSpec[] = [
  { key: 'profile.gender', values: ['Male'] },
  { key: 'profile.homeowner', values: ['Homeowner'] },
  { key: 'profile.married', values: ['No'] },
  { key: 'profile.children', values: ['No children'] },
  { key: 'businessProfile.seniority', values: ['vp'] },
  { key: 'age', values: ['45-54'], range: { min: 45, max: 54 } },
];

const DIRECTOR_35_44_HO: FilterSpec[] = [
  { key: 'profile.gender', values: ['Male'] },
  { key: 'profile.homeowner', values: ['Homeowner'] },
  { key: 'profile.married', values: ['No'] },
  { key: 'profile.children', values: ['No children'] },
  { key: 'businessProfile.seniority', values: ['director'] },
  { key: 'age', values: ['35-44'], range: { min: 35, max: 44 } },
];

// ── L2 PAIRED ENRICHMENT COMBOS ────────────────────────────────────────────
const L2_COMBOS: L2Combo[] = [
  // Staff+25-34+HO with each enrichment type fixed
  { label: 'Staff25-34-HO+Cr750', anchorFilters: STAFF_25_34_HO, fixedEnrichment: { key: 'attributes.credit_rating', values: ['750 - 799'] } },
  { label: 'Staff25-34-HO+Inc100k', anchorFilters: STAFF_25_34_HO, fixedEnrichment: { key: 'profile.incomeRange', values: ['$100,000 to $149,999'] } },
  { label: 'Staff25-34-HO+NW750k', anchorFilters: STAFF_25_34_HO, fixedEnrichment: { key: 'profile.netWorth', values: ['$750,000 to $999,999'] } },
  // Renter paired
  { label: 'Staff25-34-R+Cr750', anchorFilters: STAFF_25_34_R, fixedEnrichment: { key: 'attributes.credit_rating', values: ['750 - 799'] } },
  { label: 'Staff25-34-R+Inc100k', anchorFilters: STAFF_25_34_R, fixedEnrichment: { key: 'profile.incomeRange', values: ['$100,000 to $149,999'] } },
  // Different seniorities
  { label: 'CXO45-54-HO+Cr750', anchorFilters: CXO_45_54_HO, fixedEnrichment: { key: 'attributes.credit_rating', values: ['750 - 799'] } },
  { label: 'VP45-54-HO+Cr750', anchorFilters: VP_45_54_HO, fixedEnrichment: { key: 'attributes.credit_rating', values: ['750 - 799'] } },
  { label: 'Dir35-44-HO+Cr750', anchorFilters: DIRECTOR_35_44_HO, fixedEnrichment: { key: 'attributes.credit_rating', values: ['750 - 799'] } },
];

// ── L2 STATE×ENRICHMENT COMBOS ─────────────────────────────────────────────
// Fix Staff+25-34+HO + a state, sweep enrichment
const L2_STATE_COMBOS: L2Combo[] = STATE_SWEEP_VALUES.map(stateFilter => ({
  label: `Staff25-34-HO+${stateFilter.values[0].replace(/ /g, '')}`,
  anchorFilters: STAFF_25_34_HO,
  fixedEnrichment: stateFilter,
}));

// ── API ─────────────────────────────────────────────────────────────────────

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

// ── Sweep Runner ────────────────────────────────────────────────────────────

async function sweepL2Combo(combo: L2Combo, audienceId: string, sweepMode: 'enrichment' | 'state-enrichment'): Promise<void> {
  // Build the base: anchor demographics + fixed enrichment
  const baseFilters = [...combo.anchorFilters, combo.fixedEnrichment];
  const fixedLabel = filterLabel(combo.fixedEnrichment);

  // First, get the base count (anchor + fixed enrichment)
  const baseTC: TestCase = {
    id: `l2-base:${combo.label}`,
    phase: 'layer2',
    label: combo.label,
    filters: baseFilters,
  };
  const basePayload = buildPayload(baseTC, audienceId);

  console.log(`\n${'='.repeat(60)}`);
  console.log(`  L2 SWEEP: ${combo.label}`);
  console.log(`  Fixed: ${fixedLabel}`);
  console.log(`  Mode: ${sweepMode}`);
  console.log(`${'='.repeat(60)}`);

  let baseCount: number;
  try {
    const baseResult = await api('/audiences/preview', basePayload);
    baseCount = baseResult.data?.count ?? baseResult.count ?? 0;
    console.log(`  Base count: ${baseCount.toLocaleString()}`);
  } catch (err: any) {
    console.error(`  ❌ Base preview failed: ${err.message}`);
    return;
  }

  await sleep(2000);

  // Determine sweep filters — skip the fixed enrichment's own key
  const sweepFilters = sweepMode === 'state-enrichment'
    ? ENRICHMENT_SWEEP_VALUES  // state is fixed, sweep enrichment
    : ENRICHMENT_SWEEP_VALUES.filter(f => f.key !== combo.fixedEnrichment.key);

  // Output file
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const outDir = path.join(__dirname, '../../../data/filter-explorer/calibration');
  const outFile = path.join(outDir, `layer2-${combo.label}-${ts}.ndjson`);

  console.log(`  Sweep filters: ${sweepFilters.length}`);
  console.log(`  Output: ${path.basename(outFile)}\n`);

  let completed = 0;
  let consecutiveFailures = 0;

  for (const testFilter of sweepFilters) {
    const allFilters = [...baseFilters, testFilter];
    const testLabel = filterLabel(testFilter);
    const start = Date.now();

    try {
      const tc: TestCase = {
        id: `l2:${combo.label}|${testLabel}`,
        phase: 'layer2',
        label: `${combo.label}|${testLabel}`,
        filters: allFilters,
      };
      const payload = buildPayload(tc, audienceId);
      const result = await api('/audiences/preview', payload);
      const durationMs = Date.now() - start;
      const count = result.data?.count ?? result.count ?? 0;
      const retentionFromBase = baseCount > 0 ? count / baseCount : null;

      const record = {
        id: tc.id,
        comboLabel: combo.label,
        fixedFilter: combo.fixedEnrichment,
        fixedLabel,
        baseCount,
        testFilter,
        testLabel,
        combinedCount: count,
        retentionFromBase: retentionFromBase,
        durationMs,
        timestamp: new Date().toISOString(),
        success: true,
      };

      fs.appendFileSync(outFile, JSON.stringify(record) + '\n');
      consecutiveFailures = 0;
      completed++;

      const retStr = retentionFromBase !== null ? `${(retentionFromBase * 100).toFixed(1)}%` : 'N/A';
      console.log(`[${completed}/${sweepFilters.length}] ${testLabel} => ${count.toLocaleString()} (${retStr} of base, ${durationMs}ms)`);

    } catch (err: any) {
      const durationMs = Date.now() - start;
      consecutiveFailures++;
      completed++;

      const record = {
        id: `l2:${combo.label}|${testLabel}`,
        comboLabel: combo.label,
        fixedFilter: combo.fixedEnrichment,
        fixedLabel,
        baseCount,
        testFilter,
        testLabel,
        combinedCount: 0,
        retentionFromBase: null,
        durationMs,
        timestamp: new Date().toISOString(),
        success: false,
        error: String(err.message || err),
      };

      fs.appendFileSync(outFile, JSON.stringify(record) + '\n');
      console.error(`[${completed}/${sweepFilters.length}] ${testLabel} => ERROR: ${err.message}`);
    }

    if (consecutiveFailures >= 5) {
      console.error(`\n[l2-sweep] ${consecutiveFailures} consecutive failures — aborting combo\n`);
      break;
    }

    await sleep(1500 + Math.random() * 1000);
  }

  console.log(`\n  L2 ${combo.label}: ${completed}/${sweepFilters.length} complete → ${path.basename(outFile)}`);
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const audienceId = process.env.AUDIENCE_ID || EXPLORER_CONFIG.defaultAudienceId;
  if (!audienceId) {
    console.error('Set AUDIENCE_ID env var');
    process.exit(1);
  }

  const mode = process.argv.includes('--state') ? 'state-enrichment' : 'enrichment';
  const combos = mode === 'state-enrichment' ? L2_STATE_COMBOS : L2_COMBOS;

  console.log(`[l2-sweep] Mode: ${mode}`);
  console.log(`[l2-sweep] Audience: ${audienceId}`);
  console.log(`[l2-sweep] Combos: ${combos.length}`);
  console.log(`[l2-sweep] ~${combos.length * (mode === 'state-enrichment' ? 34 : 30)} probes total\n`);

  for (const combo of combos) {
    await sweepL2Combo(combo, audienceId, mode);
  }

  console.log('\n[l2-sweep] ALL COMBOS COMPLETE');
}

main().catch(err => {
  console.error('[l2-sweep] Fatal:', err.message);
  process.exit(1);
});
