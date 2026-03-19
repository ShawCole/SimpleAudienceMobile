/**
 * State Grid Sweep
 *
 * 6 representative anchors × 50 states = 300 probes
 * ~30-40s per probe = ~3 hours total
 *
 * Anchors chosen from probe grid data to represent broad US demographics:
 *   1. Young single F renter (urban professional)        — 46k
 *   2. Family man M homeowner (suburban family)           — 96k
 *   3. Older married F homeowner (empty nester)           — 96k
 *   4. Single M renter w/kids (single dad / cohabiting)   — 143k
 *   5. Working mom F homeowner (professional mother)      — 80k
 *   6. Older married M homeowner (pre-retiree)            — 92k
 *
 * Output: NDJSON to calibration/ + console summary table
 */

import { buildPayload, type FilterSpec, type TestCase } from './payload-factory';
import * as fs from 'fs';
import * as path from 'path';

const API_BASE = process.env.API_BASE || 'http://localhost:3001/api';
const CAP = 500_000;
const DATA_DIR = path.resolve(__dirname, '../../../data/filter-explorer/calibration');

async function api(apiPath: string, body?: any): Promise<any> {
  const url = `${API_BASE}${apiPath}`;
  const res = await fetch(url, {
    method: body ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`API ${apiPath} returned ${res.status}: ${text.substring(0, 200)}`);
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
    console.error(`    ⚠️ ERROR on "${label}": ${err.message.substring(0, 120)}`);
    return -1;
  }
}

function fmt(count: number): string {
  if (count < 0) return 'ERR';
  if (count >= CAP) return '500k+';
  return count.toLocaleString();
}

// ── ANCHORS ─────────────────────────────────────────────────────────────────

interface Anchor {
  label: string;
  shortLabel: string;
  filters: FilterSpec[];
  knownCount: number;
}

const ANCHORS: Anchor[] = [
  {
    label: 'F+NoMarried+NoKids+Staff+25-34 (Young F Renter)',
    shortLabel: 'YoungFRenter',
    filters: [
      { key: 'profile.gender', values: ['Female'] },
      { key: 'profile.married', values: ['No'] },
      { key: 'profile.children', values: ['No children'] },
      { key: 'businessProfile.seniority', values: ['staff'] },
      { key: 'age', values: ['25-34'], range: { min: 25, max: 34 } },
      { key: 'profile.homeowner', values: ['Renter'] },
    ],
    knownCount: 46492,
  },
  {
    label: 'M+Married+HasKids+Manager+25-34 (Family Man HO)',
    shortLabel: 'FamilyManHO',
    filters: [
      { key: 'profile.gender', values: ['Male'] },
      { key: 'profile.married', values: ['Yes'] },
      { key: 'profile.children', values: ['Has children'] },
      { key: 'businessProfile.seniority', values: ['manager'] },
      { key: 'age', values: ['25-34'], range: { min: 25, max: 34 } },
      { key: 'profile.homeowner', values: ['Homeowner'] },
    ],
    knownCount: 95643,
  },
  {
    label: 'F+Married+NoKids+Staff+55-64 (Empty Nester F)',
    shortLabel: 'EmptyNesterF',
    filters: [
      { key: 'profile.gender', values: ['Female'] },
      { key: 'profile.married', values: ['Yes'] },
      { key: 'profile.children', values: ['No children'] },
      { key: 'businessProfile.seniority', values: ['staff'] },
      { key: 'age', values: ['55-64'], range: { min: 55, max: 64 } },
      { key: 'profile.homeowner', values: ['Homeowner'] },
    ],
    knownCount: 96457,
  },
  {
    label: 'M+NoMarried+HasKids+Staff+35-44 (Single Dad Renter)',
    shortLabel: 'SingleDadR',
    filters: [
      { key: 'profile.gender', values: ['Male'] },
      { key: 'profile.married', values: ['No'] },
      { key: 'profile.children', values: ['Has children'] },
      { key: 'businessProfile.seniority', values: ['staff'] },
      { key: 'age', values: ['35-44'], range: { min: 35, max: 44 } },
      { key: 'profile.homeowner', values: ['Renter'] },
    ],
    knownCount: 142583,
  },
  {
    label: 'F+NoMarried+HasKids+CXO+25-34 (Working Mom HO)',
    shortLabel: 'WorkingMomHO',
    filters: [
      { key: 'profile.gender', values: ['Female'] },
      { key: 'profile.married', values: ['No'] },
      { key: 'profile.children', values: ['Has children'] },
      { key: 'businessProfile.seniority', values: ['cxo'] },
      { key: 'age', values: ['25-34'], range: { min: 25, max: 34 } },
      { key: 'profile.homeowner', values: ['Homeowner'] },
    ],
    knownCount: 79632,
  },
  {
    label: 'M+Married+NoKids+Staff+55-64 (Pre-Retiree M)',
    shortLabel: 'PreRetireeM',
    filters: [
      { key: 'profile.gender', values: ['Male'] },
      { key: 'profile.married', values: ['Yes'] },
      { key: 'profile.children', values: ['No children'] },
      { key: 'businessProfile.seniority', values: ['staff'] },
      { key: 'age', values: ['55-64'], range: { min: 55, max: 64 } },
      { key: 'profile.homeowner', values: ['Homeowner'] },
    ],
    knownCount: 91553,
  },
];

// ── 50 US STATES ────────────────────────────────────────────────────────────

const STATES = [
  'Alabama', 'Alaska', 'Arizona', 'Arkansas', 'California',
  'Colorado', 'Connecticut', 'Delaware', 'Florida', 'Georgia',
  'Hawaii', 'Idaho', 'Illinois', 'Indiana', 'Iowa',
  'Kansas', 'Kentucky', 'Louisiana', 'Maine', 'Maryland',
  'Massachusetts', 'Michigan', 'Minnesota', 'Mississippi', 'Missouri',
  'Montana', 'Nebraska', 'Nevada', 'New Hampshire', 'New Jersey',
  'New Mexico', 'New York', 'North Carolina', 'North Dakota', 'Ohio',
  'Oklahoma', 'Oregon', 'Pennsylvania', 'Rhode Island', 'South Carolina',
  'South Dakota', 'Tennessee', 'Texas', 'Utah', 'Vermont',
  'Virginia', 'Washington', 'West Virginia', 'Wisconsin', 'Wyoming',
];

// ── MAIN ────────────────────────────────────────────────────────────────────

async function main() {
  const existingId = process.env.AUDIENCE_ID;
  let audienceId: string;

  if (existingId) {
    audienceId = existingId;
    console.log(`[state-grid] Reusing audience: ${audienceId}`);
  } else {
    console.log('[state-grid] Initializing...');
    const initResult = await api('/vacuum/init', { name: 'State Grid' });
    if (!initResult.success) throw new Error('Init failed');
    audienceId = initResult.audienceId;
    console.log(`[state-grid] Audience: ${audienceId}`);
  }

  // Resume support: check for existing output file
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const outFile = path.join(DATA_DIR, `state-grid-${ts}.ndjson`);
  fs.mkdirSync(DATA_DIR, { recursive: true });

  const totalProbes = ANCHORS.length * STATES.length;
  let completed = 0;
  let errors = 0;
  const startTime = Date.now();

  // Results matrix: anchor → state → count
  const matrix: Record<string, Record<string, number>> = {};

  console.log(`\n[state-grid] ${ANCHORS.length} anchors × ${STATES.length} states = ${totalProbes} probes`);
  console.log(`[state-grid] Output: ${outFile}\n`);

  for (const anchor of ANCHORS) {
    matrix[anchor.shortLabel] = {};
    console.log('═══════════════════════════════════════════════════════════════');
    console.log(`  ANCHOR: ${anchor.label}  (known count: ${anchor.knownCount.toLocaleString()})`);
    console.log('═══════════════════════════════════════════════════════════════\n');

    for (const state of STATES) {
      const stateFilter: FilterSpec = { key: 'state', values: [state] };
      const label = `${anchor.shortLabel}:${state}`;
      const count = await preview(audienceId, label, [...anchor.filters, stateFilter]);
      await sleep(1500);

      completed++;
      const elapsed = (Date.now() - startTime) / 1000;
      const rate = elapsed / completed;
      const remaining = Math.round(rate * (totalProbes - completed) / 60);

      const ret = count >= 0 ? (count / anchor.knownCount * 100).toFixed(1) + '%' : 'ERR';
      if (count < 0) errors++;

      matrix[anchor.shortLabel][state] = count;

      // Log progress
      console.log(`  [${completed}/${totalProbes}] ${state.padEnd(20)} ${fmt(count).padStart(8)} (${ret.padStart(6)})  ~${remaining}m left`);

      // Write NDJSON
      const row = {
        anchor: anchor.shortLabel,
        anchorLabel: anchor.label,
        anchorCount: anchor.knownCount,
        state,
        count,
        retention: count >= 0 ? count / anchor.knownCount : null,
        timestamp: new Date().toISOString(),
      };
      fs.appendFileSync(outFile, JSON.stringify(row) + '\n');
    }

    // Per-anchor top/bottom states
    const stateResults = Object.entries(matrix[anchor.shortLabel])
      .filter(([, c]) => c > 0)
      .sort((a, b) => b[1] - a[1]);

    console.log(`\n  Top 5: ${stateResults.slice(0, 5).map(([s, c]) => `${s}=${fmt(c)}`).join(', ')}`);
    console.log(`  Bottom 5: ${stateResults.slice(-5).map(([s, c]) => `${s}=${fmt(c)}`).join(', ')}\n`);
  }

  // ── SUMMARY ─────────────────────────────────────────────────────────────────
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('  STATE GRID SUMMARY');
  console.log('═══════════════════════════════════════════════════════════════\n');

  // Average retention by state across all anchors
  const stateAvgRet: Record<string, number[]> = {};
  for (const anchor of ANCHORS) {
    for (const state of STATES) {
      const count = matrix[anchor.shortLabel]?.[state] ?? -1;
      if (count >= 0) {
        if (!stateAvgRet[state]) stateAvgRet[state] = [];
        stateAvgRet[state].push(count / anchor.knownCount);
      }
    }
  }

  const stateAvgs = Object.entries(stateAvgRet)
    .map(([state, rets]) => ({
      state,
      avgRet: rets.reduce((a, b) => a + b, 0) / rets.length,
      samples: rets.length,
    }))
    .sort((a, b) => b.avgRet - a.avgRet);

  console.log(`  ${'State'.padEnd(20)} ${'Avg Ret%'.padStart(10)} ${'Samples'.padStart(8)}`);
  console.log(`  ${'-'.repeat(40)}`);
  for (const { state, avgRet, samples } of stateAvgs) {
    console.log(`  ${state.padEnd(20)} ${(avgRet * 100).toFixed(2).padStart(9)}% ${samples.toString().padStart(8)}`);
  }

  console.log(`\n  Total probes: ${completed}, Errors: ${errors}`);
  console.log(`  Output: ${outFile}`);
  console.log('\nDone.');
}

main().catch(err => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
