/**
 * Stacking Validation Sweep
 *
 * Measures actual stacking behavior vs multiplicative assumption.
 * For each anchor:
 *   1. Probe single filters (A, B, C) → get individual retentions
 *   2. Probe pairs (A+B) → get actual combined count
 *   3. Probe triples (A+B+C) → get actual combined count
 *   4. Compare actual vs predicted (anchor × retA × retB × ...) → stacking correction
 *
 * Covers:
 *   - Homeowner vs Renter
 *   - Married vs Unmarried (new finding: 1.42x NW split)
 *   - Staff vs CXO (seniority spread)
 *   - Upper-tier stacks (credit 750 + income 100k + NW 500k)
 *   - Mixed-tier stacks (credit 650 + income 45k)
 *   - Cross-category stacks (credit + state, income + education)
 *
 * Usage:
 *   API_BASE=http://localhost:3001/api npx tsx backend/src/scripts/filter-explorer/stacking-validation.ts
 *   API_BASE=http://localhost:3001/api npx tsx backend/src/scripts/filter-explorer/stacking-validation.ts --dry-run
 */

import fs from 'fs';
import path from 'path';
import { buildPayload, type FilterSpec, type TestCase } from './payload-factory';
import { EXPLORER_CONFIG } from './config';

const API_BASE = process.env.API_BASE || 'http://localhost:3001/api';

async function api(apiPath: string, body?: any): Promise<any> {
  const url = `${API_BASE}${apiPath}`;
  const res = await fetch(url, {
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

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function preview(audienceId: string, label: string, filters: FilterSpec[]): Promise<number> {
  const testCase: TestCase = { id: label, phase: 'single', label, filters };
  const payload = buildPayload(testCase, audienceId);
  try {
    const result = await api('/audiences/preview', payload);
    return result.data?.count ?? result.count ?? -1;
  } catch (err: any) {
    console.log(`    ⚠️ ERROR: ${err.message.substring(0, 100)}`);
    return -1;
  }
}

// ── Anchors ─────────────────────────────────────────────────────────────────

interface Anchor {
  label: string;
  baseFilters: FilterSpec[];
  expectedCount: number;
}

const ANCHORS: Anchor[] = [
  // HO + Unmarried + Staff (large pop, well-calibrated)
  {
    label: 'HO:F+Unmarried+Staff+35-44',
    baseFilters: [
      { key: 'profile.gender', values: ['Female'] },
      { key: 'profile.homeowner', values: ['Homeowner'] },
      { key: 'profile.married', values: ['No'] },
      { key: 'businessProfile.seniority', values: ['staff'] },
      { key: 'age', values: ['35-44'], range: { min: 35, max: 44 } },
    ],
    expectedCount: 0, // will be measured
  },
  // HO + Married + CXO (small pop, high-value)
  {
    label: 'HO:M+Married+CXO+45-54',
    baseFilters: [
      { key: 'profile.gender', values: ['Male'] },
      { key: 'profile.homeowner', values: ['Homeowner'] },
      { key: 'profile.married', values: ['Yes'] },
      { key: 'businessProfile.seniority', values: ['cxo'] },
      { key: 'age', values: ['45-54'], range: { min: 45, max: 54 } },
    ],
    expectedCount: 0,
  },
  // Renter + Unmarried + Staff (largest Renter pop)
  {
    label: 'R:F+Unmarried+Staff+35-44',
    baseFilters: [
      { key: 'profile.gender', values: ['Female'] },
      { key: 'profile.homeowner', values: ['Renter'] },
      { key: 'profile.married', values: ['No'] },
      { key: 'businessProfile.seniority', values: ['staff'] },
      { key: 'age', values: ['35-44'], range: { min: 35, max: 44 } },
    ],
    expectedCount: 0,
  },
  // Renter + Married + Staff (test married Renter split)
  {
    label: 'R:F+Married+Staff+35-44',
    baseFilters: [
      { key: 'profile.gender', values: ['Female'] },
      { key: 'profile.homeowner', values: ['Renter'] },
      { key: 'profile.married', values: ['Yes'] },
      { key: 'businessProfile.seniority', values: ['staff'] },
      { key: 'age', values: ['35-44'], range: { min: 35, max: 44 } },
    ],
    expectedCount: 0,
  },
  // Renter + Unmarried + CXO (small Renter, high seniority)
  {
    label: 'R:F+Unmarried+CXO+45-54',
    baseFilters: [
      { key: 'profile.gender', values: ['Female'] },
      { key: 'profile.homeowner', values: ['Renter'] },
      { key: 'profile.married', values: ['No'] },
      { key: 'businessProfile.seniority', values: ['cxo'] },
      { key: 'age', values: ['45-54'], range: { min: 45, max: 54 } },
    ],
    expectedCount: 0,
  },
  // Renter + Married + Manager (mid-seniority married)
  {
    label: 'R:M+Married+Mgr+35-44',
    baseFilters: [
      { key: 'profile.gender', values: ['Male'] },
      { key: 'profile.homeowner', values: ['Renter'] },
      { key: 'profile.married', values: ['Yes'] },
      { key: 'businessProfile.seniority', values: ['manager'] },
      { key: 'age', values: ['35-44'], range: { min: 35, max: 44 } },
    ],
    expectedCount: 0,
  },
];

// ── Enrichment Filters ──────────────────────────────────────────────────────

const FILTERS: Record<string, FilterSpec> = {
  'Cr750':   { key: 'attributes.credit_rating', values: ['750 - 799'] },
  'Cr650':   { key: 'attributes.credit_rating', values: ['650 - 699'] },
  'Inc100k': { key: 'profile.incomeRange', values: ['$100,000 to $149,999'] },
  'Inc45k':  { key: 'profile.incomeRange', values: ['$45,000 to $59,999'] },
  'NW500k':  { key: 'profile.netWorth', values: ['$500,000 to $749,999'] },
  'NW750k':  { key: 'profile.netWorth', values: ['$750,000 to $999,999'] },
  'EduBach': { key: 'attributes.education', values: ["Bachelor's"] },
  'CA':      { key: 'state', values: ['California'] },
  'TX':      { key: 'state', values: ['Texas'] },
};

// ── Stack Combos to Test ────────────────────────────────────────────────────

interface StackCombo {
  label: string;
  filters: string[]; // keys into FILTERS
  tier: 'upper' | 'mixed' | 'cross';
}

const STACKS: StackCombo[] = [
  // 2-filter upper-tier
  { label: 'Cr750+Inc100k',       filters: ['Cr750', 'Inc100k'],       tier: 'upper' },
  { label: 'Cr750+NW500k',        filters: ['Cr750', 'NW500k'],        tier: 'upper' },
  { label: 'Inc100k+NW500k',      filters: ['Inc100k', 'NW500k'],      tier: 'upper' },
  { label: 'Cr750+EduBach',       filters: ['Cr750', 'EduBach'],       tier: 'upper' },

  // 2-filter mixed-tier
  { label: 'Cr650+Inc45k',        filters: ['Cr650', 'Inc45k'],        tier: 'mixed' },
  { label: 'Cr750+Inc45k',        filters: ['Cr750', 'Inc45k'],        tier: 'mixed' },

  // 2-filter cross-category (enrichment + geo)
  { label: 'Cr750+CA',            filters: ['Cr750', 'CA'],            tier: 'cross' },
  { label: 'Inc100k+TX',          filters: ['Inc100k', 'TX'],          tier: 'cross' },
  { label: 'NW500k+CA',           filters: ['NW500k', 'CA'],           tier: 'cross' },

  // 3-filter upper-tier
  { label: 'Cr750+Inc100k+NW500k', filters: ['Cr750', 'Inc100k', 'NW500k'], tier: 'upper' },
  { label: 'Cr750+Inc100k+EduBach', filters: ['Cr750', 'Inc100k', 'EduBach'], tier: 'upper' },
  { label: 'Cr750+NW750k+CA',      filters: ['Cr750', 'NW750k', 'CA'],       tier: 'upper' },

  // 3-filter mixed
  { label: 'Cr650+Inc45k+TX',     filters: ['Cr650', 'Inc45k', 'TX'],  tier: 'mixed' },
];

// ── Main ────────────────────────────────────────────────────────────────────

interface ProbeResult {
  anchor: string;
  anchorCount: number;
  combo: string;
  tier: string;
  filterCount: number;
  singleRetentions: Record<string, number>;
  predictedCount: number;
  actualCount: number;
  stackingCorrection: number;
  timestamp: string;
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const skipArg = parseInt(process.env.SKIP_ANCHORS || '0', 10);

  if (dryRun) {
    console.log('=== DRY RUN: Stacking Validation ===\n');
    const totalProbes = ANCHORS.length * (Object.keys(FILTERS).length + STACKS.length + 1); // +1 for base
    console.log(`${ANCHORS.length} anchors × (1 base + ${Object.keys(FILTERS).length} singles + ${STACKS.length} stacks) = ${totalProbes} probes`);
    console.log(`Estimated time: ~${Math.round(totalProbes * 3 / 60)} minutes\n`);

    for (const anchor of ANCHORS) {
      console.log(`  ${anchor.label}`);
      for (const stack of STACKS) {
        console.log(`    ${stack.label} (${stack.tier}, ${stack.filters.length}-filter)`);
      }
    }
    return;
  }

  // Init — use existing audience ID from env, or prewarm+init
  let audienceId = process.env.AUDIENCE_ID || '';
  if (audienceId) {
    console.log(`[stacking] Reusing audience: ${audienceId}\n`);
  } else {
    console.log('[stacking] Pre-warming VacuumEngine...');
    try {
      await api('/vacuum/prewarm', {});
      console.log('[stacking] Pre-warm complete.');
    } catch (e: any) {
      console.log('[stacking] Pre-warm skipped:', e.message?.substring(0, 80));
    }
    console.log('[stacking] Initializing audience...');
    const initResult = await api('/vacuum/init', { name: 'Stacking Validation' });
    if (!initResult.success) throw new Error('Init failed');
    audienceId = initResult.audienceId;
  }
  console.log(`[stacking] Audience: ${audienceId}\n`);

  // Output file
  const dir = path.join(EXPLORER_CONFIG.dataDir, 'calibration');
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const outPath = path.join(dir, `stacking-validation-${ts}.ndjson`);
  console.log(`[stacking] Results: ${outPath}\n`);

  const allResults: ProbeResult[] = [];
  let probeNum = 0;
  const totalProbes = ANCHORS.length * (1 + Object.keys(FILTERS).length + STACKS.length);

  const anchorsToRun = skipArg > 0 ? ANCHORS.slice(skipArg) : ANCHORS;
  if (skipArg > 0) console.log(`[stacking] Skipping first ${skipArg} anchors, running ${anchorsToRun.length} remaining\n`);

  for (const anchor of anchorsToRun) {
    console.log('═══════════════════════════════════════════════════════════');
    console.log(`  ANCHOR: ${anchor.label}`);
    console.log('═══════════════════════════════════════════════════════════');

    // Step 1: Get base count
    probeNum++;
    console.log(`\n  [${probeNum}/${totalProbes}] Base count...`);
    const baseCount = await preview(audienceId, `base:${anchor.label}`, anchor.baseFilters);
    if (baseCount <= 0) {
      console.log(`  ⚠️ Base count is ${baseCount} — skipping this anchor`);
      continue;
    }
    console.log(`  Base: ${baseCount.toLocaleString()}`);
    await sleep(1500);

    // Step 2: Probe each single filter
    const singleCounts: Record<string, number> = {};
    const singleRetentions: Record<string, number> = {};

    for (const [name, filter] of Object.entries(FILTERS)) {
      probeNum++;
      const count = await preview(audienceId, `single:${anchor.label}|${name}`,
        [...anchor.baseFilters, filter]);
      singleCounts[name] = count;
      singleRetentions[name] = count > 0 ? count / baseCount : 0;
      const retStr = singleRetentions[name] > 0 ? (singleRetentions[name] * 100).toFixed(1) + '%' : 'ZERO';
      console.log(`  [${probeNum}/${totalProbes}] ${name}: ${count.toLocaleString()} (${retStr})`);
      await sleep(1500);
    }

    // Step 3: Probe each stacked combo
    console.log('');
    for (const stack of STACKS) {
      probeNum++;
      const stackFilters = stack.filters.map(name => FILTERS[name]);
      const actualCount = await preview(audienceId, `stack:${anchor.label}|${stack.label}`,
        [...anchor.baseFilters, ...stackFilters]);

      // Predicted = base × product of individual retentions
      let predicted = baseCount;
      const retentionsUsed: Record<string, number> = {};
      for (const name of stack.filters) {
        const ret = singleRetentions[name];
        retentionsUsed[name] = ret;
        predicted *= ret;
      }
      predicted = Math.round(predicted);

      const correction = predicted > 0 ? actualCount / predicted : 0;

      const result: ProbeResult = {
        anchor: anchor.label,
        anchorCount: baseCount,
        combo: stack.label,
        tier: stack.tier,
        filterCount: stack.filters.length,
        singleRetentions: retentionsUsed,
        predictedCount: predicted,
        actualCount,
        stackingCorrection: correction,
        timestamp: new Date().toISOString(),
      };
      allResults.push(result);
      fs.appendFileSync(outPath, JSON.stringify(result) + '\n');

      const corrStr = correction > 0 ? correction.toFixed(2) + 'x' : 'N/A';
      const predStr = predicted.toLocaleString();
      const actStr = actualCount.toLocaleString();
      console.log(`  [${probeNum}/${totalProbes}] ${stack.label.padEnd(25)} actual=${actStr.padStart(8)} pred=${predStr.padStart(8)} correction=${corrStr}`);
      await sleep(1500);
    }
    console.log('');
  }

  // ── Summary ─────────────────────────────────────────────────────────────────

  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('  STACKING VALIDATION SUMMARY');
  console.log('═══════════════════════════════════════════════════════════\n');

  // Group by anchor type (HO/Renter) and filter count
  const groups: Record<string, ProbeResult[]> = {};
  for (const r of allResults) {
    const hoType = r.anchor.startsWith('HO:') ? 'HO' : 'Renter';
    const key = `${hoType}|${r.filterCount}-filter|${r.tier}`;
    if (!groups[key]) groups[key] = [];
    groups[key].push(r);
  }

  console.log('Group'.padEnd(30) + 'Avg Corr'.padStart(10) + 'Min'.padStart(8) + 'Max'.padStart(8) + 'N'.padStart(5));
  console.log('-'.repeat(61));
  for (const [key, results] of Object.entries(groups).sort()) {
    const corrections = results.filter(r => r.stackingCorrection > 0).map(r => r.stackingCorrection);
    if (corrections.length === 0) continue;
    const avg = corrections.reduce((a, b) => a + b, 0) / corrections.length;
    const min = Math.min(...corrections);
    const max = Math.max(...corrections);
    console.log(
      key.padEnd(30) +
      (avg.toFixed(2) + 'x').padStart(10) +
      (min.toFixed(2) + 'x').padStart(8) +
      (max.toFixed(2) + 'x').padStart(8) +
      String(corrections.length).padStart(5)
    );
  }

  // Compare against current hardcoded corrections
  console.log('\n--- vs Current Hardcoded Corrections ---');
  console.log('Current HO:  2-filter=1.03x  3-filter=1.21x  4-filter=1.42x');
  console.log('Current R:   2-filter=1.54x  3-filter=5.23x  4-filter=10.0x');

  // Detailed per-combo breakdown
  console.log('\n--- Per-Combo Detail ---');
  console.log('Anchor'.padEnd(30) + 'Combo'.padEnd(28) + 'Actual'.padStart(8) + 'Predicted'.padStart(10) + 'Correction'.padStart(12));
  console.log('-'.repeat(88));
  for (const r of allResults) {
    if (r.actualCount <= 0) continue;
    console.log(
      r.anchor.padEnd(30) +
      r.combo.padEnd(28) +
      r.actualCount.toLocaleString().padStart(8) +
      r.predictedCount.toLocaleString().padStart(10) +
      (r.stackingCorrection.toFixed(2) + 'x').padStart(12)
    );
  }

  console.log(`\nResults saved to: ${outPath}`);
  console.log(`Total probes: ${probeNum}`);
}

main().catch(err => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
