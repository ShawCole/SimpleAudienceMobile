/**
 * Cap Breaker 2-Year — Drill into still-capped 5-year brackets with 2-year resolution
 *
 * Targets: Male + Homeowner + Yes + CXO + Has children (capped at 43-47, 53-57, 63-67)
 * Plus the original cap-breaker anchors that still need processing.
 *
 * Usage:
 *   API_BASE=http://localhost:3001/api npx tsx backend/src/scripts/filter-explorer/cap-breaker-2yr.ts
 */

import fs from 'fs';
import path from 'path';
import { buildPayload, type FilterSpec, type TestCase } from './payload-factory';
import { EXPLORER_CONFIG } from './config';

const API_BASE = process.env.API_BASE || 'http://localhost:3001/api';
const CAP = 500_000;

// The anchor that had 3 capped 5-year brackets
const ANCHOR_FILTERS: FilterSpec[] = [
  { key: 'gender', values: ['Male'] },
  { key: 'profile.homeowner', values: ['Homeowner'] },
  { key: 'profile.married', values: ['Yes'] },
  { key: 'businessProfile.seniority', values: ['cxo'] },
  { key: 'profile.children', values: ['Has children'] },
];

const ANCHOR_LABEL = 'Male + Homeowner + Yes + cxo + Has children';

// User-specified 2-year brackets covering the capped zones (43-67)
const TWO_YEAR_BRACKETS = [
  { label: '43-44', min: 43, max: 44 },
  { label: '45-46', min: 45, max: 46 },
  { label: '47-48', min: 47, max: 48 },
  { label: '48-49', min: 48, max: 49 },
  { label: '50-51', min: 50, max: 51 },
  { label: '52-53', min: 52, max: 53 },
  { label: '54-55', min: 54, max: 55 },
  { label: '56-57', min: 56, max: 57 },
  { label: '58-59', min: 58, max: 59 },
  { label: '60-61', min: 60, max: 61 },
  { label: '62-63', min: 62, max: 63 },
  { label: '64-65', min: 64, max: 65 },
  { label: '66-67', min: 66, max: 67 },
];

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

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

async function main() {
  const dryRun = process.argv.includes('--dry-run');

  console.log('\n======================================================');
  console.log('  CAP BREAKER 2-YEAR — Drilling capped 5yr brackets');
  console.log(`  Anchor: ${ANCHOR_LABEL}`);
  console.log(`  Probes: ${TWO_YEAR_BRACKETS.length}`);
  console.log(`  Est time: ~${Math.round(TWO_YEAR_BRACKETS.length * 100 / 60)} min`);
  console.log('======================================================\n');

  if (dryRun) {
    for (const b of TWO_YEAR_BRACKETS) console.log(`  ${b.label}`);
    return;
  }

  console.log('[2yr] Pre-warming VacuumEngine...');
  const prewarmResult = await api('/vacuum/prewarm', {});
  if (!prewarmResult.success) throw new Error('Prewarm failed');
  console.log('[2yr] Pre-warm complete.\n');

  console.log('[2yr] Initializing audience...');
  const initResult = await api('/vacuum/init', { name: 'Cap Breaker 2yr' });
  if (!initResult.success) throw new Error('Init failed');
  const audienceId = initResult.audienceId;
  console.log(`[2yr] Audience ready: ${audienceId}\n`);

  const dir = path.join(EXPLORER_CONFIG.dataDir, 'calibration');
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const resultPath = path.join(dir, `cap-breaker-2yr-${ts}.ndjson`);

  const total = TWO_YEAR_BRACKETS.length;
  let consecutiveFailures = 0;

  for (let i = 0; i < TWO_YEAR_BRACKETS.length; i++) {
    const bracket = TWO_YEAR_BRACKETS[i];
    const filters: FilterSpec[] = [
      ...ANCHOR_FILTERS,
      { key: 'age', values: [bracket.label], range: { min: bracket.min, max: bracket.max } },
    ];

    const start = Date.now();
    try {
      const testCase: TestCase = {
        id: `cb2:${bracket.label}`,
        phase: 'baseline',
        label: `cb2:${bracket.label}`,
        filters,
      };
      const payload = buildPayload(testCase, audienceId);
      const result = await api('/audiences/preview', payload);
      const durationMs = Date.now() - start;
      const count = result.data?.count ?? result.count ?? 0;
      const capped = count >= CAP;

      const row = {
        ageLabel: bracket.label,
        ageMin: bracket.min,
        ageMax: bracket.max,
        count,
        capped,
        durationMs,
        timestamp: new Date().toISOString(),
        success: true,
      };
      fs.appendFileSync(resultPath, JSON.stringify(row) + '\n');
      consecutiveFailures = 0;

      const cappedStr = capped ? ' STILL CAPPED' : '';
      console.log(`[${i + 1}/${total}] age ${bracket.label} => ${count.toLocaleString()}${cappedStr} (${durationMs}ms)`);

    } catch (err: any) {
      const durationMs = Date.now() - start;
      consecutiveFailures++;
      const row = {
        ageLabel: bracket.label,
        ageMin: bracket.min,
        ageMax: bracket.max,
        count: 0,
        capped: false,
        durationMs,
        timestamp: new Date().toISOString(),
        success: false,
        error: String(err.message || err),
      };
      fs.appendFileSync(resultPath, JSON.stringify(row) + '\n');
      console.error(`[${i + 1}/${total}] age ${bracket.label} => ERROR: ${err.message}`);
    }

    if (consecutiveFailures >= 5) {
      console.error('\n[2yr] 5 consecutive failures — cooling down 30s\n');
      await sleep(30000);
      consecutiveFailures = 0;
    }

    await sleep(1500 + Math.random() * 1000);
  }

  // Summary
  const lines = fs.readFileSync(resultPath, 'utf-8').trim().split('\n');
  const results = lines.map(l => JSON.parse(l));
  const successes = results.filter((r: any) => r.success);

  console.log('\n======================================================');
  console.log(`  2-YEAR RESULTS — ${ANCHOR_LABEL}`);
  console.log('======================================================\n');

  for (const r of successes) {
    const bar = '█'.repeat(Math.round(r.count / 10000));
    const cappedStr = r.capped ? ' ** CAPPED **' : '';
    console.log(`  ${r.ageLabel.padEnd(6)} ${r.count.toLocaleString().padStart(10)} ${bar}${cappedStr}`);
  }

  const stillCapped = successes.filter((r: any) => r.capped);
  if (stillCapped.length > 0) {
    console.log(`\n  ${stillCapped.length} bracket(s) still capped — may need 1-year resolution.`);
  } else {
    console.log('\n  All brackets uncapped!');
  }

  console.log(`\n  Results: ${resultPath}`);
}

main().catch(err => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
