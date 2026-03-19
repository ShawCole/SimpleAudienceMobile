/**
 * Probe Grid — Exhaustive Anchor Census
 *
 * Tests all combos of low-cardinality anchor dimensions to map the platform's
 * audience universe. Each combo is a single preview injection.
 *
 * Full grid: Gender(2) x Homeowner(2) x Married(2) x Seniority(5) x Children(2) x Age(6) = 480 combos
 * MaritalStatus removed from anchors (moved to Layer 1 sweep) — it OR-expands with Married, creating contradictory combos.
 * Age(6) added to break the 500k cap — each bracket is distinct.
 *
 * Usage:
 *   API_BASE=http://localhost:3001/api npx tsx src/scripts/filter-explorer/probe-grid.ts
 *   API_BASE=http://localhost:3001/api npx tsx src/scripts/filter-explorer/probe-grid.ts --dry-run
 *   API_BASE=http://localhost:3001/api npx tsx src/scripts/filter-explorer/probe-grid.ts --brief
 *   API_BASE=http://localhost:3001/api npx tsx src/scripts/filter-explorer/probe-grid.ts --limit 10
 *
 * Flags:
 *   --dry-run    Print combos without executing
 *   --brief      Only test 16 combos (Gender x Married x MaritalStatus)
 *   --limit N    Run only first N combos from the full grid
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
  durationMs: number;
  timestamp: string;
  success: boolean;
  error?: string;
}

interface DimensionValue {
  label: string;
  range?: { min: number; max: number };
}

interface Dimension {
  key: string;
  label: string;
  values: (string | DimensionValue)[];
}

// ── Dimension Definitions ────────────────────────────────────────────────────

// Full grid: Gender(2) x Homeowner(2) x Married(2) x Seniority(5) x Children(2) x Age(6) = 480 combos
// MaritalStatus removed — it OR-expands with Married (different data sources), creating
// contradictory combos like Married=Yes + MaritalStatus=Single that return MORE results, not fewer.
// MaritalStatus is tested as a Layer 1 sweep dimension instead.
// Age added to break 500k cap — each bracket is distinct (18-24, 25-34, 35-44, 45-54, 55-64, 65+).
const GRID_DIMENSIONS: Dimension[] = [
  {
    key: 'gender',
    label: 'Gender',
    values: ['Male', 'Female'],
  },
  {
    key: 'profile.homeowner',
    label: 'Homeowner',
    values: ['Homeowner', 'Renter'],
  },
  {
    key: 'profile.married',
    label: 'Married',
    values: ['Yes', 'No'],
  },
  {
    key: 'businessProfile.seniority',
    label: 'Seniority',
    values: ['cxo', 'vp', 'director', 'manager', 'staff'],
  },
  {
    key: 'profile.children',
    label: 'Children',
    values: ['Has children', 'No children'],
  },
  {
    key: 'age',
    label: 'Age',
    values: [
      { label: '18-24', range: { min: 18, max: 24 } },
      { label: '25-34', range: { min: 25, max: 34 } },
      { label: '35-44', range: { min: 35, max: 44 } },
      { label: '45-54', range: { min: 45, max: 54 } },
      { label: '55-64', range: { min: 55, max: 64 } },
      { label: '65+', range: { min: 65, max: 99 } },
    ],
  },
];

// Brief mode: test both marital dimensions to verify interaction effects
// Gender(2) x Married(2) x MaritalStatus(4) = 16 combos
const BRIEF_DIMENSIONS: Dimension[] = [
  {
    key: 'gender',
    label: 'Gender',
    values: ['Male', 'Female'],
  },
  {
    key: 'profile.married',
    label: 'Married',
    values: ['Yes', 'No'],
  },
  {
    key: 'attributes.marital_status',
    label: 'MaritalStatus',
    values: ['Married', 'Single', 'Inferred Married', 'Inferred Single'],
  },
];

// ── Helpers ──────────────────────────────────────────────────────────────────

const API_BASE = process.env.API_BASE || 'http://localhost:3001/api';

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

function generateCombos(dimensions: Dimension[]): Array<{ id: string; combo: Record<string, string>; filters: FilterSpec[] }> {
  const combos: Array<{ id: string; combo: Record<string, string>; filters: FilterSpec[] }> = [];

  function recurse(dimIdx: number, currentCombo: Record<string, string>, currentFilters: FilterSpec[]) {
    if (dimIdx === dimensions.length) {
      const id = Object.entries(currentCombo).map(([k, v]) => `${k}=${v}`).join('|');
      combos.push({
        id,
        combo: { ...currentCombo },
        filters: [...currentFilters],
      });
      return;
    }

    const dim = dimensions[dimIdx];
    for (const val of dim.values) {
      const isObj = typeof val === 'object';
      const label = isObj ? val.label : val;
      const spec: FilterSpec = {
        key: dim.key,
        values: [label],
        ...(isObj && val.range ? { range: { min: val.range.min, max: val.range.max } } : {}),
      };
      recurse(dimIdx + 1, { ...currentCombo, [dim.label]: label }, [...currentFilters, spec]);
    }
  }

  recurse(0, {}, []);
  return combos;
}

// ── Checkpoint ───────────────────────────────────────────────────────────────

class GridCheckpoint {
  private cpPath: string;
  resultPath: string;
  private completedIds: Set<string>;

  constructor(mode: string) {
    const dir = path.join(EXPLORER_CONFIG.dataDir, 'calibration');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    this.cpPath = path.join(dir, `checkpoint-probe-grid-${mode}.json`);

    if (fs.existsSync(this.cpPath)) {
      const data = JSON.parse(fs.readFileSync(this.cpPath, 'utf-8'));
      this.resultPath = data.resultFile;
      this.completedIds = new Set(data.completedIds);
      console.log(`[checkpoint] Resuming: ${this.completedIds.size} combos completed`);
    } else {
      const ts = new Date().toISOString().replace(/[:.]/g, '-');
      this.resultPath = path.join(dir, `probe-grid-${mode}-${ts}.ndjson`);
      this.completedIds = new Set();
    }
  }

  isCompleted(id: string): boolean { return this.completedIds.has(id); }
  getCompletedCount(): number { return this.completedIds.size; }

  record(result: GridResult): void {
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

function parseArg(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  return idx >= 0 && args[idx + 1] ? args[idx + 1] : undefined;
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const brief = args.includes('--brief');
  const limit = parseInt(parseArg(args, '--limit') || '0', 10);

  const dimensions = brief ? BRIEF_DIMENSIONS : GRID_DIMENSIONS;
  let combos = generateCombos(dimensions);
  const mode = brief ? 'brief' : (limit > 0 ? `limit-${limit}` : 'full');

  if (limit > 0) {
    combos = combos.slice(0, limit);
  }

  console.log('======================================================');
  console.log(`  PROBE GRID — ${mode.toUpperCase()} ANCHOR CENSUS`);
  console.log(`  Dimensions: ${dimensions.map(d => `${d.label}(${d.values.length})`).join(' x ')}`);
  console.log(`  Total combos: ${combos.length}`);
  console.log(`  API: ${API_BASE}`);
  console.log('======================================================\n');

  if (dryRun) {
    for (const c of combos) {
      const labels = Object.entries(c.combo).map(([k, v]) => `${v}`).join(' + ');
      console.log(`  ${labels}`);
    }
    console.log(`\n  Total: ${combos.length} combos`);
    return;
  }

  // Prewarm + init
  console.log('[grid] Pre-warming VacuumEngine...');
  const prewarmResult = await api('/vacuum/prewarm', {});
  if (!prewarmResult.success) throw new Error('Prewarm failed: ' + JSON.stringify(prewarmResult));
  console.log('[grid] Pre-warm complete.\n');

  console.log('[grid] Initializing audience...');
  const initResult = await api('/vacuum/init', { name: 'Probe Grid Census' });
  if (!initResult.success) throw new Error('Init failed: ' + JSON.stringify(initResult));
  const audienceId = initResult.audienceId;
  console.log(`[grid] Audience ready: ${audienceId}\n`);

  const checkpoint = new GridCheckpoint(mode);
  let completed = 0;
  let consecutiveFailures = 0;
  const total = combos.length;
  const results: GridResult[] = [];

  for (const combo of combos) {
    if (checkpoint.isCompleted(combo.id)) {
      completed++;
      continue;
    }

    const start = Date.now();
    try {
      const testCase: TestCase = {
        id: combo.id,
        phase: 'grid',
        label: combo.id,
        filters: combo.filters,
      };
      const payload = buildPayload(testCase, audienceId);
      const result = await api('/audiences/preview', payload);
      const durationMs = Date.now() - start;
      const count = result.data?.count ?? result.count ?? 0;

      const gridResult: GridResult = {
        id: combo.id,
        combo: combo.combo,
        filters: combo.filters,
        count,
        durationMs,
        timestamp: new Date().toISOString(),
        success: !!result.success,
      };
      checkpoint.record(gridResult);
      results.push(gridResult);
      consecutiveFailures = 0;
      completed++;

      const labels = Object.entries(combo.combo).map(([k, v]) => `${v}`).join(' + ');
      const countStr = count >= 500000 ? '500k+ (CAPPED)' : count.toLocaleString();
      console.log(`[${completed}/${total}] ${labels} => ${countStr} (${durationMs}ms)`);

    } catch (err: any) {
      const durationMs = Date.now() - start;
      consecutiveFailures++;
      completed++;

      checkpoint.record({
        id: combo.id,
        combo: combo.combo,
        filters: combo.filters,
        count: 0,
        durationMs,
        timestamp: new Date().toISOString(),
        success: false,
        error: String(err.message || err),
      });
      console.error(`[${completed}/${total}] ERROR: ${err.message}`);
    }

    // Circuit breaker
    if (consecutiveFailures >= 5) {
      console.error(`\n[grid] ${consecutiveFailures} consecutive failures — cooling down 30s\n`);
      await sleep(30000);
      consecutiveFailures = 0;
    }

    // Brief delay between requests
    await sleep(1500 + Math.random() * 1000);
  }

  // Summary
  console.log('\n======================================================');
  console.log('  PROBE GRID RESULTS');
  console.log('======================================================\n');

  const successful = results.filter(r => r.success);
  const capped = successful.filter(r => r.count >= 500000);
  const uncapped = successful.filter(r => r.count < 500000 && r.count > 0);
  const zeros = successful.filter(r => r.count === 0);

  console.log(`  Total: ${results.length} | Capped: ${capped.length} | Uncapped: ${uncapped.length} | Zeros: ${zeros.length}`);

  if (uncapped.length > 0) {
    console.log('\n  --- UNCAPPED (viable anchor candidates) ---');
    const sorted = [...uncapped].sort((a, b) => a.count - b.count);
    for (const r of sorted.slice(0, 30)) {
      const labels = Object.entries(r.combo).map(([k, v]) => `${v}`).join(' + ');
      console.log(`    ${r.count.toLocaleString().padStart(10)}  ${labels}`);
    }
  }

  if (zeros.length > 0) {
    console.log('\n  --- ZEROS (dead combos) ---');
    for (const r of zeros.slice(0, 20)) {
      const labels = Object.entries(r.combo).map(([k, v]) => `${v}`).join(' + ');
      console.log(`    ${labels}`);
    }
  }

  checkpoint.finalize();
  console.log(`\nResults: ${checkpoint.resultPath}`);
}

main().catch(err => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
