/**
 * Probe Grid — Seniority + Age Edition
 *
 * Adds Age to the original Seniority grid to bridge with NW/Income grids.
 * Gender(2) x Homeowner(2) x Married(2) x Seniority(5) x Children(2) x Age(6) = 480 combos
 *
 * Usage:
 *   API_BASE=http://localhost:3001/api npx tsx backend/src/scripts/filter-explorer/probe-grid-seniority-age.ts
 *   API_BASE=http://localhost:3001/api npx tsx backend/src/scripts/filter-explorer/probe-grid-seniority-age.ts --dry-run
 *   API_BASE=http://localhost:3001/api npx tsx backend/src/scripts/filter-explorer/probe-grid-seniority-age.ts --limit 10
 */

import fs from 'fs';
import path from 'path';
import { buildPayload, type FilterSpec, type TestCase } from './payload-factory';
import { EXPLORER_CONFIG } from './config';

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

class GridCheckpoint {
  private cpPath: string;
  resultPath: string;
  private completedIds: Set<string>;

  constructor(mode: string) {
    const dir = path.join(EXPLORER_CONFIG.dataDir, 'calibration');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    this.cpPath = path.join(dir, `checkpoint-grid-seniority-age-${mode}.json`);

    if (fs.existsSync(this.cpPath)) {
      const data = JSON.parse(fs.readFileSync(this.cpPath, 'utf-8'));
      this.resultPath = data.resultFile;
      this.completedIds = new Set(data.completedIds);
      console.log(`[checkpoint] Resuming: ${this.completedIds.size} combos completed`);
    } else {
      const ts = new Date().toISOString().replace(/[:.]/g, '-');
      this.resultPath = path.join(dir, `grid-seniority-age-${mode}-${ts}.ndjson`);
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

function parseArg(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  return idx >= 0 && args[idx + 1] ? args[idx + 1] : undefined;
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const limit = parseInt(parseArg(args, '--limit') || '0', 10);

  let combos = generateCombos(GRID_DIMENSIONS);
  const mode = limit > 0 ? `limit-${limit}` : 'full';

  if (limit > 0) {
    combos = combos.slice(0, limit);
  }

  console.log('======================================================');
  console.log(`  PROBE GRID — SENIORITY + AGE (${mode.toUpperCase()})`);
  console.log(`  Dimensions: ${GRID_DIMENSIONS.map(d => `${d.label}(${d.values.length})`).join(' x ')}`);
  console.log(`  Total combos: ${combos.length}`);
  console.log(`  API: ${API_BASE}`);
  console.log('======================================================\n');

  if (dryRun) {
    for (const c of combos) {
      const labels = Object.values(c.combo).join(' + ');
      console.log(`  ${labels}`);
    }
    console.log(`\n  Total: ${combos.length} combos`);
    return;
  }

  console.log('[grid-sen-age] Pre-warming VacuumEngine...');
  const prewarmResult = await api('/vacuum/prewarm', {});
  if (!prewarmResult.success) throw new Error('Prewarm failed: ' + JSON.stringify(prewarmResult));
  console.log('[grid-sen-age] Pre-warm complete.\n');

  console.log('[grid-sen-age] Initializing audience...');
  const initResult = await api('/vacuum/init', { name: 'Grid Seniority Age' });
  if (!initResult.success) throw new Error('Init failed: ' + JSON.stringify(initResult));
  const audienceId = initResult.audienceId;
  console.log(`[grid-sen-age] Audience ready: ${audienceId}\n`);

  const checkpoint = new GridCheckpoint(mode);
  let completed = 0;
  let consecutiveFailures = 0;
  const total = combos.length;

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

      checkpoint.record({
        id: combo.id,
        combo: combo.combo,
        filters: combo.filters,
        count,
        durationMs,
        timestamp: new Date().toISOString(),
        success: !!result.success,
      });
      consecutiveFailures = 0;
      completed++;

      const labels = Object.values(combo.combo).join(' + ');
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

    if (consecutiveFailures >= 5) {
      console.error(`\n[grid-sen-age] 5 consecutive failures — cooling down 30s\n`);
      await sleep(30000);
      consecutiveFailures = 0;
    }

    await sleep(1500 + Math.random() * 1000);
  }

  // Summary
  const allLines = fs.readFileSync(checkpoint.resultPath, 'utf-8').trim().split('\n');
  const allResults: GridResult[] = allLines.map(l => JSON.parse(l));
  const successful = allResults.filter(r => r.success);
  const capped = successful.filter(r => r.count >= 500000);
  const uncapped = successful.filter(r => r.count < 500000 && r.count > 0);
  const zeros = successful.filter(r => r.count === 0);

  console.log('\n======================================================');
  console.log('  GRID SENIORITY + AGE RESULTS');
  console.log('======================================================\n');
  console.log(`  Total: ${allResults.length} | Capped: ${capped.length} | Uncapped: ${uncapped.length} | Zeros: ${zeros.length}`);

  if (uncapped.length > 0) {
    const totalPop = uncapped.reduce((s, r) => s + r.count, 0) + capped.length * 500000;
    console.log(`  Est. population: ${totalPop.toLocaleString()}`);
  }

  checkpoint.finalize();
  console.log(`\nResults: ${checkpoint.resultPath}`);
}

main().catch(err => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
