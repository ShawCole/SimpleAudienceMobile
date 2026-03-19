/**
 * Cap Breaker — Split capped grid anchors with 5-year age brackets
 *
 * Takes the 23 capped anchors from probe-grid and re-probes with finer age
 * granularity to find where counts drop below 500k.
 *
 * For anchors with NO age: test all 13 five-year brackets (18-22 through 78+)
 * For anchors WITH a 10-year bracket: split into 5-year halves
 *
 * Usage:
 *   API_BASE=http://localhost:3001/api npx tsx backend/src/scripts/filter-explorer/cap-breaker.ts
 *   API_BASE=http://localhost:3001/api npx tsx backend/src/scripts/filter-explorer/cap-breaker.ts --dry-run
 */

import fs from 'fs';
import path from 'path';
import { buildPayload, type FilterSpec, type TestCase } from './payload-factory';
import { EXPLORER_CONFIG } from './config';

// ── Types ────────────────────────────────────────────────────────────────────

interface GridResult {
  id: string;
  combo: Record<string, string>;
  filters: FilterSpec[];
  count: number;
  success: boolean;
}

interface CapBreakerResult {
  id: string;
  anchorId: string;
  anchorCombo: Record<string, string>;
  ageLabel: string;
  ageMin: number;
  ageMax: number;
  count: number;
  capped: boolean;
  durationMs: number;
  timestamp: string;
  success: boolean;
  error?: string;
}

// ── Config ───────────────────────────────────────────────────────────────────

const API_BASE = process.env.API_BASE || 'http://localhost:3001/api';
const CAP = 500_000;

// 5-year brackets
const FIVE_YEAR_BRACKETS = [
  { label: '18-22', min: 18, max: 22 },
  { label: '23-27', min: 23, max: 27 },
  { label: '28-32', min: 28, max: 32 },
  { label: '33-37', min: 33, max: 37 },
  { label: '38-42', min: 38, max: 42 },
  { label: '43-47', min: 43, max: 47 },
  { label: '48-52', min: 48, max: 52 },
  { label: '53-57', min: 53, max: 57 },
  { label: '58-62', min: 58, max: 62 },
  { label: '63-67', min: 63, max: 67 },
  { label: '68-72', min: 68, max: 72 },
  { label: '73-77', min: 73, max: 77 },
  { label: '78+', min: 78, max: 99 },
];

// Splits for existing 10-year brackets
const TEN_TO_FIVE: Record<string, { label: string; min: number; max: number }[]> = {
  '18-24': [{ label: '18-21', min: 18, max: 21 }, { label: '22-24', min: 22, max: 24 }],
  '25-34': [{ label: '25-29', min: 25, max: 29 }, { label: '30-34', min: 30, max: 34 }],
  '35-44': [{ label: '35-39', min: 35, max: 39 }, { label: '40-44', min: 40, max: 44 }],
  '45-54': [{ label: '45-49', min: 45, max: 49 }, { label: '50-54', min: 50, max: 54 }],
  '55-64': [{ label: '55-59', min: 55, max: 59 }, { label: '60-64', min: 60, max: 64 }],
  '65+':   [{ label: '65-69', min: 65, max: 69 }, { label: '70-74', min: 70, max: 74 },
            { label: '75-79', min: 75, max: 79 }, { label: '80+', min: 80, max: 99 }],
};

// ── Helpers ──────────────────────────────────────────────────────────────────

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

function comboLabel(combo: Record<string, string>): string {
  return Object.values(combo).join(' + ');
}

// ── Grid Loader ──────────────────────────────────────────────────────────────

function loadCappedAnchors(): GridResult[] {
  const dir = path.join(EXPLORER_CONFIG.dataDir, 'calibration');
  const files = fs.readdirSync(dir).filter(f => f.startsWith('probe-grid-full-') && f.endsWith('.ndjson'));
  if (files.length === 0) throw new Error('No probe-grid-full results found.');
  files.sort().reverse();
  const filePath = path.join(dir, files[0]);
  const lines = fs.readFileSync(filePath, 'utf-8').trim().split('\n');
  const all: GridResult[] = lines.map(l => JSON.parse(l));
  const capped = all.filter(r => r.success && r.count >= CAP);
  console.log(`[cap-breaker] Loaded ${all.length} grid results, ${capped.length} capped from ${files[0]}`);
  return capped;
}

// ── Checkpoint ───────────────────────────────────────────────────────────────

class CapBreakerCheckpoint {
  private cpPath: string;
  resultPath: string;
  private completedIds: Set<string>;

  constructor() {
    const dir = path.join(EXPLORER_CONFIG.dataDir, 'calibration');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    this.cpPath = path.join(dir, 'checkpoint-cap-breaker.json');

    if (fs.existsSync(this.cpPath)) {
      const data = JSON.parse(fs.readFileSync(this.cpPath, 'utf-8'));
      this.resultPath = data.resultFile;
      this.completedIds = new Set(data.completedIds);
      console.log(`[checkpoint] Resuming: ${this.completedIds.size} probes completed`);
    } else {
      const ts = new Date().toISOString().replace(/[:.]/g, '-');
      this.resultPath = path.join(dir, `cap-breaker-${ts}.ndjson`);
      this.completedIds = new Set();
    }
  }

  isCompleted(id: string): boolean { return this.completedIds.has(id); }
  getCompletedCount(): number { return this.completedIds.size; }

  record(result: CapBreakerResult): void {
    fs.appendFileSync(this.resultPath, JSON.stringify(result) + '\n');
    this.completedIds.add(result.id);
    this.save();
  }

  private save(): void {
    fs.writeFileSync(this.cpPath, JSON.stringify({
      resultFile: this.resultPath,
      completedIds: Array.from(this.completedIds),
    }, null, 2));
  }

  finalize(): void {
    if (fs.existsSync(this.cpPath)) fs.unlinkSync(this.cpPath);
    console.log(`[checkpoint] Run complete. Results: ${this.resultPath}`);
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const capped = loadCappedAnchors();

  // Build probe list
  const probes: { anchor: GridResult; age: { label: string; min: number; max: number } }[] = [];

  for (const anchor of capped) {
    const existingAge = anchor.combo.Age;
    if (!existingAge) {
      // No age — test all 13 five-year brackets
      for (const bracket of FIVE_YEAR_BRACKETS) {
        probes.push({ anchor, age: bracket });
      }
    } else {
      // Has 10-year bracket — split into 5-year halves
      const splits = TEN_TO_FIVE[existingAge];
      if (!splits) {
        console.warn(`[cap-breaker] Unknown age bracket: ${existingAge}`);
        continue;
      }
      for (const split of splits) {
        probes.push({ anchor, age: split });
      }
    }
  }

  console.log(`\n======================================================`);
  console.log(`  CAP BREAKER — 5-Year Age Splits`);
  console.log(`  Capped anchors: ${capped.length}`);
  console.log(`  Total probes: ${probes.length}`);
  console.log(`  Est time: ~${Math.round(probes.length * 8.5 / 60)} min`);
  console.log(`======================================================\n`);

  if (dryRun) {
    for (const p of probes) {
      console.log(`  ${comboLabel(p.anchor.combo)} + age ${p.age.label}`);
    }
    console.log(`\n  Total: ${probes.length} probes (dry run)`);
    return;
  }

  // Prewarm + init
  console.log('[cap-breaker] Pre-warming VacuumEngine...');
  const prewarmResult = await api('/vacuum/prewarm', {});
  if (!prewarmResult.success) throw new Error('Prewarm failed');
  console.log('[cap-breaker] Pre-warm complete.\n');

  console.log('[cap-breaker] Initializing audience...');
  const initResult = await api('/vacuum/init', { name: 'Cap Breaker' });
  if (!initResult.success) throw new Error('Init failed');
  const audienceId = initResult.audienceId;
  console.log(`[cap-breaker] Audience ready: ${audienceId}\n`);

  const checkpoint = new CapBreakerCheckpoint();
  let completed = 0;
  let consecutiveFailures = 0;
  const total = probes.length;

  for (const probe of probes) {
    const probeId = `cb:${probe.anchor.id}|age=${probe.age.label}`;

    if (checkpoint.isCompleted(probeId)) {
      completed++;
      continue;
    }

    // Build filters: anchor filters (minus any existing age) + new 5-year age
    const filters: FilterSpec[] = probe.anchor.filters.filter(f => f.key !== 'age');
    filters.push({ key: 'age', values: [probe.age.label], range: { min: probe.age.min, max: probe.age.max } });

    const start = Date.now();
    try {
      const testCase: TestCase = {
        id: probeId,
        phase: 'baseline',
        label: probeId,
        filters,
      };
      const payload = buildPayload(testCase, audienceId);
      const result = await api('/audiences/preview', payload);
      const durationMs = Date.now() - start;
      const count = result.data?.count ?? result.count ?? 0;

      checkpoint.record({
        id: probeId,
        anchorId: probe.anchor.id,
        anchorCombo: probe.anchor.combo,
        ageLabel: probe.age.label,
        ageMin: probe.age.min,
        ageMax: probe.age.max,
        count,
        capped: count >= CAP,
        durationMs,
        timestamp: new Date().toISOString(),
        success: true,
      });
      consecutiveFailures = 0;
      completed++;

      const cappedStr = count >= CAP ? ' (STILL CAPPED)' : '';
      console.log(`[${completed}/${total}] ${comboLabel(probe.anchor.combo)} + ${probe.age.label} => ${count.toLocaleString()}${cappedStr} (${durationMs}ms)`);

    } catch (err: any) {
      const durationMs = Date.now() - start;
      consecutiveFailures++;
      completed++;

      checkpoint.record({
        id: probeId,
        anchorId: probe.anchor.id,
        anchorCombo: probe.anchor.combo,
        ageLabel: probe.age.label,
        ageMin: probe.age.min,
        ageMax: probe.age.max,
        count: 0,
        capped: false,
        durationMs,
        timestamp: new Date().toISOString(),
        success: false,
        error: String(err.message || err),
      });
      console.error(`[${completed}/${total}] ERROR: ${err.message}`);
    }

    if (consecutiveFailures >= 5) {
      console.error(`\n[cap-breaker] 5 consecutive failures — cooling down 30s\n`);
      await sleep(30000);
      consecutiveFailures = 0;
    }

    await sleep(1500 + Math.random() * 1000);
  }

  // Summary
  const lines = fs.readFileSync(checkpoint.resultPath, 'utf-8').trim().split('\n');
  const results: CapBreakerResult[] = lines.map(l => JSON.parse(l));
  const successes = results.filter(r => r.success);
  const stillCapped = successes.filter(r => r.capped);
  const uncapped = successes.filter(r => !r.capped && r.count > 0);

  console.log('\n======================================================');
  console.log(`  CAP BREAKER RESULTS`);
  console.log(`  Total probes: ${successes.length}`);
  console.log(`  Uncapped: ${uncapped.length}`);
  console.log(`  Still capped: ${stillCapped.length}`);
  console.log('======================================================\n');

  if (stillCapped.length > 0) {
    console.log('--- STILL CAPPED (need even finer splits) ---');
    for (const r of stillCapped) {
      console.log(`  ${comboLabel(r.anchorCombo)} + ${r.ageLabel} => ${r.count.toLocaleString()}`);
    }
  }

  console.log('\n--- UNCAPPED RESULTS (sorted by count desc) ---');
  uncapped.sort((a, b) => b.count - a.count);
  for (const r of uncapped) {
    console.log(`  ${r.count.toLocaleString().padStart(10)}  ${comboLabel(r.anchorCombo)} + ${r.ageLabel}`);
  }

  // Show distribution by 5-year bracket
  console.log('\n--- COUNT BY 5-YEAR BRACKET (summed across anchors) ---');
  const byAge: Record<string, { total: number; n: number }> = {};
  for (const r of successes) {
    if (!byAge[r.ageLabel]) byAge[r.ageLabel] = { total: 0, n: 0 };
    byAge[r.ageLabel].total += r.count;
    byAge[r.ageLabel].n++;
  }
  for (const [label, data] of Object.entries(byAge).sort((a, b) => {
    const aMin = parseInt(a[0]);
    const bMin = parseInt(b[0]);
    return aMin - bMin;
  })) {
    console.log(`  ${label.padEnd(8)} ${data.total.toLocaleString().padStart(12)} total (${data.n} probes)`);
  }

  checkpoint.finalize();
}

main().catch(err => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
