/**
 * Layer 1 Sweep — High-Cardinality Filter Profiling on Grid Anchors
 *
 * Takes uncapped anchors from the probe grid and sweeps high-cardinality
 * filters on top to build per-anchor filter profiles.
 *
 * Usage:
 *   # List available anchors from grid results
 *   API_BASE=http://localhost:3001/api npx tsx src/scripts/filter-explorer/layer1-sweep.ts --list
 *
 *   # Sweep a specific anchor by index (from --list output)
 *   API_BASE=http://localhost:3001/api npx tsx src/scripts/filter-explorer/layer1-sweep.ts --anchor 3
 *
 *   # Sweep the N smallest uncapped anchors automatically
 *   API_BASE=http://localhost:3001/api npx tsx src/scripts/filter-explorer/layer1-sweep.ts --auto 5
 *
 *   # Dry run
 *   API_BASE=http://localhost:3001/api npx tsx src/scripts/filter-explorer/layer1-sweep.ts --anchor 3 --dry-run
 *
 * Sweep dimensions (additive on anchor):
 *   Industry (141), State (50), Age (6 brackets), Income (12), Net Worth (12),
 *   Credit Rating (8), Education (7), Marital Status (4) = ~240 probes per anchor
 */

import fs from 'fs';
import path from 'path';
import { FILTER_TAXONOMY } from '../../../../shared/taxonomy/filter-taxonomy';
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

interface SweepResult {
  id: string;
  anchorId: string;
  anchorCombo: Record<string, string>;
  anchorCount: number;
  testFilter: FilterSpec;
  testLabel: string;
  combinedCount: number;
  retentionRatio: number | null;
  durationMs: number;
  timestamp: string;
  success: boolean;
  error?: string;
}

// ── Config ───────────────────────────────────────────────────────────────────

const API_BASE = process.env.API_BASE || 'http://localhost:3001/api';
const CAP = 500_000;

// ── Sweep Filter Builder ─────────────────────────────────────────────────────

// Taxonomy key mapping
const TAXONOMY_TO_KEY: Record<string, Record<string, string>> = {
  Business: {
    Industries: 'businessProfile.industry',
  },
  Financial: {
    'Income Range': 'profile.incomeRange',
    'Net Worth': 'profile.netWorth',
    'Credit Rating': 'attributes.credit_rating',
  },
  Personal: {
    Education: 'attributes.education',
  },
};

function buildSweepFilters(): FilterSpec[] {
  const filters: FilterSpec[] = [];
  const taxonomy = FILTER_TAXONOMY as unknown as Record<string, Record<string, { type: string; options?: Array<{ label: string }> }>>;

  // Taxonomy-based filters (Industry, Income, Net Worth, Credit, Education)
  for (const [category, keyMap] of Object.entries(TAXONOMY_TO_KEY)) {
    for (const [filterName, filterKey] of Object.entries(keyMap)) {
      const def = taxonomy[category]?.[filterName];
      if (!def?.options) continue;
      for (const opt of def.options) {
        filters.push({ key: filterKey, values: [opt.label] });
      }
    }
  }

  // State (all 50 + DC)
  const states = [
    'Alabama','Alaska','Arizona','Arkansas','California','Colorado','Connecticut',
    'Delaware','Florida','Georgia','Hawaii','Idaho','Illinois','Indiana','Iowa',
    'Kansas','Kentucky','Louisiana','Maine','Maryland','Massachusetts','Michigan',
    'Minnesota','Mississippi','Missouri','Montana','Nebraska','Nevada','New Hampshire',
    'New Jersey','New Mexico','New York','North Carolina','North Dakota','Ohio',
    'Oklahoma','Oregon','Pennsylvania','Rhode Island','South Carolina','South Dakota',
    'Tennessee','Texas','Utah','Vermont','Virginia','Washington','West Virginia',
    'Wisconsin','Wyoming','District of Columbia'
  ];
  for (const s of states) {
    filters.push({ key: 'state', values: [s] });
  }

  // Age brackets
  const ageBrackets = [
    { label: '18-24', min: 18, max: 24 },
    { label: '25-34', min: 25, max: 34 },
    { label: '35-44', min: 35, max: 44 },
    { label: '45-54', min: 45, max: 54 },
    { label: '55-64', min: 55, max: 64 },
    { label: '65+', min: 65, max: 99 },
  ];
  for (const a of ageBrackets) {
    filters.push({ key: 'age', values: [a.label], range: { min: a.min, max: a.max } });
  }

  // Marital Status (moved from grid anchors — tests retention of each value independently)
  const maritalStatuses = ['Married', 'Single', 'Inferred Married', 'Inferred Single'];
  for (const ms of maritalStatuses) {
    filters.push({ key: 'attributes.marital_status', values: [ms] });
  }

  return filters;
}

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

function filterLabel(spec: FilterSpec): string {
  if (spec.range) return `${spec.key}=[${spec.range.min}-${spec.range.max}]`;
  return `${spec.key}=${spec.values.join('+')}`;
}

function comboLabel(combo: Record<string, string>): string {
  return Object.values(combo).join(' + ');
}

// ── Grid Results Loader ──────────────────────────────────────────────────────

function loadGridResults(): GridResult[] {
  const dir = path.join(EXPLORER_CONFIG.dataDir, 'calibration');
  const files = fs.readdirSync(dir).filter(f => f.startsWith('probe-grid-full-') && f.endsWith('.ndjson'));
  if (files.length === 0) throw new Error('No probe-grid-full results found. Run probe-grid.ts first.');

  // Use most recent
  files.sort().reverse();
  const filePath = path.join(dir, files[0]);
  const lines = fs.readFileSync(filePath, 'utf-8').trim().split('\n');
  console.log(`[layer1] Loaded ${lines.length} grid results from ${files[0]}`);

  return lines.map(l => JSON.parse(l));
}

function getUncappedAnchors(results: GridResult[]): GridResult[] {
  return results
    .filter(r => r.success && r.count > 0 && r.count < CAP)
    .sort((a, b) => a.count - b.count);
}

// ── Checkpoint ───────────────────────────────────────────────────────────────

class Layer1Checkpoint {
  private cpPath: string;
  resultPath: string;
  private completedIds: Set<string>;

  constructor(anchorId: string) {
    const dir = path.join(EXPLORER_CONFIG.dataDir, 'calibration');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    const safeName = anchorId.replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 80);
    this.cpPath = path.join(dir, `checkpoint-layer1-${safeName}.json`);

    if (fs.existsSync(this.cpPath)) {
      const data = JSON.parse(fs.readFileSync(this.cpPath, 'utf-8'));
      this.resultPath = data.resultFile;
      this.completedIds = new Set(data.completedIds);
      console.log(`[checkpoint] Resuming: ${this.completedIds.size} filters completed`);
    } else {
      const ts = new Date().toISOString().replace(/[:.]/g, '-');
      this.resultPath = path.join(dir, `layer1-${safeName}-${ts}.ndjson`);
      this.completedIds = new Set();
    }
  }

  isCompleted(id: string): boolean { return this.completedIds.has(id); }
  getCompletedCount(): number { return this.completedIds.size; }

  record(result: SweepResult): void {
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

// ── Sweep Runner ─────────────────────────────────────────────────────────────

async function sweepAnchor(anchor: GridResult, audienceId: string, dryRun: boolean): Promise<void> {
  const sweepFilters = buildSweepFilters();

  // Skip filters already in the anchor
  const anchorKeys = new Set(anchor.filters.map(f => `${f.key}:${f.values.join('+')}`));
  const filtered = sweepFilters.filter(f => !anchorKeys.has(`${f.key}:${f.values.join('+')}`));

  console.log('\n======================================================');
  console.log(`  LAYER 1 SWEEP`);
  console.log(`  Anchor: ${comboLabel(anchor.combo)}`);
  console.log(`  Anchor count: ${anchor.count.toLocaleString()}`);
  console.log(`  Filters to sweep: ${filtered.length}`);
  console.log('======================================================\n');

  if (dryRun) {
    for (const f of filtered) {
      console.log(`  ${filterLabel(f)}`);
    }
    console.log(`\n  Total: ${filtered.length} probes`);
    return;
  }

  const checkpoint = new Layer1Checkpoint(anchor.id);
  let completed = 0;
  let consecutiveFailures = 0;
  const total = filtered.length;

  for (const testFilter of filtered) {
    const testId = `l1:${anchor.id}|${filterLabel(testFilter)}`;

    if (checkpoint.isCompleted(testId)) {
      completed++;
      continue;
    }

    const allFilters = [...anchor.filters, testFilter];
    const start = Date.now();

    try {
      const testCase: TestCase = {
        id: testId,
        phase: 'layer1',
        label: testId,
        filters: allFilters,
      };
      const payload = buildPayload(testCase, audienceId);
      const result = await api('/audiences/preview', payload);
      const durationMs = Date.now() - start;
      const count = result.data?.count ?? result.count ?? 0;
      const retention = anchor.count > 0 ? count / anchor.count : null;

      checkpoint.record({
        id: testId,
        anchorId: anchor.id,
        anchorCombo: anchor.combo,
        anchorCount: anchor.count,
        testFilter,
        testLabel: filterLabel(testFilter),
        combinedCount: count,
        retentionRatio: retention,
        durationMs,
        timestamp: new Date().toISOString(),
        success: !!result.success,
      });
      consecutiveFailures = 0;
      completed++;

      const retStr = retention !== null ? `${(retention * 100).toFixed(1)}%` : 'N/A';
      const countStr = count >= CAP ? '500k+ (CAPPED)' : count.toLocaleString();
      console.log(`[${completed}/${total}] ${filterLabel(testFilter)} => ${countStr} (${retStr}, ${durationMs}ms)`);

    } catch (err: any) {
      const durationMs = Date.now() - start;
      consecutiveFailures++;
      completed++;

      checkpoint.record({
        id: testId,
        anchorId: anchor.id,
        anchorCombo: anchor.combo,
        anchorCount: anchor.count,
        testFilter,
        testLabel: filterLabel(testFilter),
        combinedCount: 0,
        retentionRatio: null,
        durationMs,
        timestamp: new Date().toISOString(),
        success: false,
        error: String(err.message || err),
      });
      console.error(`[${completed}/${total}] ${filterLabel(testFilter)} => ERROR: ${err.message}`);
    }

    if (consecutiveFailures >= 5) {
      console.error(`\n[sweep] ${consecutiveFailures} consecutive failures — cooling down 30s\n`);
      await sleep(30000);
      consecutiveFailures = 0;
    }

    // Sanity check: if first 10 probes all returned 0, the session is probably bad
    if (completed === 10) {
      const lines = fs.readFileSync(checkpoint.resultPath, 'utf-8').trim().split('\n');
      const recent = lines.slice(-10).map(l => JSON.parse(l));
      const allZero = recent.every((r: SweepResult) => r.combinedCount === 0);
      if (allZero) {
        console.error('\n[sweep] ⚠️ SANITY CHECK FAILED: First 10 probes ALL returned 0.');
        console.error('[sweep] This likely means the VacuumEngine session is bad.');
        console.error('[sweep] Aborting. Restart the backend and try again.\n');
        process.exit(1);
      }
    }

    await sleep(1500 + Math.random() * 1000);
  }

  // Summary
  const lines = fs.readFileSync(checkpoint.resultPath, 'utf-8').trim().split('\n');
  const results: SweepResult[] = lines.map(l => JSON.parse(l));
  const successes = results.filter(r => r.success && r.retentionRatio !== null);
  const sorted = [...successes].sort((a, b) => (a.retentionRatio ?? 1) - (b.retentionRatio ?? 1));

  console.log('\n======================================================');
  console.log(`  LAYER 1 RESULTS — ${comboLabel(anchor.combo)}`);
  console.log(`  Anchor count: ${anchor.count.toLocaleString()}`);
  console.log(`  Filters swept: ${successes.length}`);
  console.log('======================================================\n');

  console.log('--- TOP 20 MOST RESTRICTIVE (lowest retention) ---');
  for (const r of sorted.slice(0, 20)) {
    const ret = r.retentionRatio !== null ? `${(r.retentionRatio * 100).toFixed(1)}%` : 'N/A';
    console.log(`  ${ret.padStart(7)}  ${r.testLabel.padEnd(55)} => ${r.combinedCount.toLocaleString()}`);
  }

  const zeros = results.filter(r => r.success && r.combinedCount === 0);
  if (zeros.length > 0) {
    console.log(`\n--- ZEROS (${zeros.length} dead filters) ---`);
    for (const r of zeros.slice(0, 15)) {
      console.log(`  ${r.testLabel}`);
    }
  }

  // Group by filter category
  console.log('\n--- RETENTION BY CATEGORY (median) ---');
  const byCategory: Record<string, number[]> = {};
  for (const r of successes) {
    if (r.retentionRatio === null) continue;
    const cat = r.testLabel.split('=')[0].split('.')[0];
    if (!byCategory[cat]) byCategory[cat] = [];
    byCategory[cat].push(r.retentionRatio);
  }
  const median = (arr: number[]) => { const s = [...arr].sort((a,b) => a-b); return s[Math.floor(s.length/2)]; };
  for (const [cat, ratios] of Object.entries(byCategory).sort((a,b) => median(a[1]) - median(b[1]))) {
    console.log(`  ${(median(ratios) * 100).toFixed(1)}%  ${cat} (${ratios.length} filters)`);
  }

  checkpoint.finalize();
}

// ── Main ─────────────────────────────────────────────────────────────────────

function parseArg(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  return idx >= 0 && args[idx + 1] ? args[idx + 1] : undefined;
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const listMode = args.includes('--list');
  const anchorIdx = parseInt(parseArg(args, '--anchor') || '-1', 10);
  const anchorIdxList = parseArg(args, '--anchors')?.split(',').map(s => parseInt(s.trim(), 10)) || [];
  const autoCount = parseInt(parseArg(args, '--auto') || '0', 10);

  const gridResults = loadGridResults();
  const uncapped = getUncappedAnchors(gridResults);

  if (listMode) {
    console.log(`\n${uncapped.length} uncapped anchors (sorted by count):\n`);
    for (let i = 0; i < uncapped.length; i++) {
      const r = uncapped[i];
      console.log(`  [${i}] ${r.count.toLocaleString().padStart(10)}  ${comboLabel(r.combo)}`);
    }
    console.log(`\nUse --anchor <index> to sweep one, or --auto N to sweep the N smallest.`);
    return;
  }

  // Select anchors to sweep
  let anchorsToSweep: GridResult[] = [];
  if (anchorIdxList.length > 0) {
    for (const idx of anchorIdxList) {
      if (idx < 0 || idx >= uncapped.length) {
        console.error(`Anchor index ${idx} out of range (0-${uncapped.length - 1})`);
        process.exit(1);
      }
      anchorsToSweep.push(uncapped[idx]);
    }
  } else if (anchorIdx >= 0) {
    if (anchorIdx >= uncapped.length) {
      console.error(`Anchor index ${anchorIdx} out of range (0-${uncapped.length - 1})`);
      process.exit(1);
    }
    anchorsToSweep = [uncapped[anchorIdx]];
  } else if (autoCount > 0) {
    anchorsToSweep = uncapped.slice(0, autoCount);
  } else {
    console.error('Specify --anchor <index>, --anchors <i,j,k>, --auto <count>, or --list');
    process.exit(1);
  }

  const sweepFilters = buildSweepFilters();
  console.log(`\nSweeping ${anchorsToSweep.length} anchor(s) x ${sweepFilters.length} filters each\n`);

  if (!dryRun) {
    console.log('[layer1] Pre-warming VacuumEngine...');
    const prewarmResult = await api('/vacuum/prewarm', {});
    if (!prewarmResult.success) throw new Error('Prewarm failed');
    console.log('[layer1] Pre-warm complete.\n');

    console.log('[layer1] Initializing audience...');
    const initResult = await api('/vacuum/init', { name: 'Layer 1 Sweep' });
    if (!initResult.success) throw new Error('Init failed');
    const audienceId = initResult.audienceId;
    console.log(`[layer1] Audience ready: ${audienceId}\n`);

    for (const anchor of anchorsToSweep) {
      await sweepAnchor(anchor, audienceId, false);
    }
  } else {
    for (const anchor of anchorsToSweep) {
      await sweepAnchor(anchor, audienceId_placeholder(), true);
    }
  }
}

function audienceId_placeholder(): string { return 'dry-run'; }

main().catch(err => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
