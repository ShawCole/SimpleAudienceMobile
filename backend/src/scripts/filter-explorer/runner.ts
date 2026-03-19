/**
 * Filter Explorer Runner — Full-Stack Validation
 *
 * Tests every filter option through the actual API stack:
 *   Frontend payload shape → POST /api/audiences/preview → VacuumEngine → Partner Portal
 *
 * Prerequisites:
 *   1. Backend running: npm run dev (port 8001)
 *   2. Runner handles prewarm + audience init automatically
 *
 * Usage:
 *   npx tsx src/scripts/filter-explorer/runner.ts --singles-only
 *   npx tsx src/scripts/filter-explorer/runner.ts --singles-only --dry-run
 */

import { generateTestMatrix } from './test-matrix';
import { buildPayload } from './payload-factory';
import { Checkpoint, type TestResult } from './checkpoint';
import { analyze } from './analyzer';
import { EXPLORER_CONFIG } from './config';

const API_BASE = process.env.API_BASE || 'http://localhost:8001/api';
const TEST_AUDIENCE_NAME = process.env.AUDIENCE_NAME || 'Filter Sweep Test';

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function randomBetween(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

async function api(path: string, body?: any): Promise<any> {
  const url = `${API_BASE}${path}`;
  const res = await fetch(url, {
    method: body ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`API ${path} returned ${res.status}: ${text.substring(0, 300)}`);
  }
  return res.json();
}

async function prewarm(): Promise<void> {
  console.log('[runner] Pre-warming VacuumEngine (login + navigate to dashboard)...');
  const result = await api('/vacuum/prewarm', {});
  if (!result.success) throw new Error('Prewarm failed: ' + JSON.stringify(result));
  console.log('[runner] Pre-warm complete — browser is on dashboard with Create modal open');
}

async function initAudience(): Promise<{ accountId: string; audienceId: string }> {
  console.log(`[runner] Initializing audience: "${TEST_AUDIENCE_NAME}"...`);
  const result = await api('/vacuum/init', { name: TEST_AUDIENCE_NAME });
  if (!result.success) throw new Error('Init failed: ' + JSON.stringify(result));
  console.log(`[runner] Audience ready — accountId: ${result.accountId}, audienceId: ${result.audienceId}`);
  return { accountId: result.accountId, audienceId: result.audienceId };
}

async function previewAudience(payload: any): Promise<{ success: boolean; count: number; raw?: string }> {
  const result = await api('/audiences/preview', payload);
  return {
    success: !!result.success,
    count: result.data?.count ?? result.count ?? 0,
    raw: result.raw?.substring(0, 500),
  };
}

async function run() {
  const args = process.argv.slice(2);
  const singlesOnly = args.includes('--singles-only');
  const dryRun = args.includes('--dry-run');
  const knownOnly = args.includes('--known-only');

  // Generate test matrix
  let matrix = generateTestMatrix({
    baseline: true,
    singles: true,
    pairs: !singlesOnly,
    saturation: !singlesOnly,
  });

  // Filter to known-good keys only
  if (knownOnly) {
    const allowed = new Set(EXPLORER_CONFIG.knownGoodKeys);
    matrix = matrix.filter(tc =>
      tc.phase === 'baseline' || tc.filters.every(f => allowed.has(f.key))
    );
  }

  console.log(`[runner] ${matrix.length} test cases generated${knownOnly ? ' (known-good only)' : ''}`);
  console.log(`[runner] Phases: baseline + singles${singlesOnly ? '' : ' + pairs + saturation'}`);

  if (dryRun) {
    console.log('\n=== DRY RUN — Test Cases ===\n');
    const phaseCount: Record<string, number> = {};
    for (const tc of matrix) {
      phaseCount[tc.phase] = (phaseCount[tc.phase] || 0) + 1;
    }
    console.log('Phase breakdown:');
    for (const [phase, count] of Object.entries(phaseCount)) {
      console.log(`  ${phase}: ${count}`);
    }
    console.log(`\n  Total: ${matrix.length}\n`);

    console.log('Test cases:');
    for (const tc of matrix) {
      const filters = tc.filters.map(f => {
        if (f.range) return `${f.key}=[${f.range.min}-${f.range.max}]`;
        return `${f.key}=${f.values.join('+')}`;
      }).join(' & ');
      console.log(`  [${tc.phase}] ${tc.id} → ${filters || '(none)'}`);
    }
    return;
  }

  // ── Step 1: Pre-warm (login + dashboard) ──
  await prewarm();

  // ── Step 2: Init audience (creates or reuses by name) ──
  const { accountId, audienceId } = await initAudience();

  // Update config with live IDs
  EXPLORER_CONFIG.accountId = accountId;
  EXPLORER_CONFIG.audienceId = audienceId;

  // ── Step 3: Run tests ──
  const checkpoint = new Checkpoint();
  const skipped = checkpoint.getCompletedCount();
  if (skipped > 0) {
    console.log(`[runner] Resuming — ${skipped}/${matrix.length} already completed`);
  }

  let consecutiveFailures = 0;
  let completed = checkpoint.getCompletedCount();
  const total = matrix.length;

  console.log(`\n[runner] Starting filter sweep: ${total - completed} tests remaining\n`);

  for (const testCase of matrix) {
    if (checkpoint.isCompleted(testCase.id)) continue;

    const payload = buildPayload(testCase, audienceId);
    const start = Date.now();

    try {
      const result = await previewAudience(payload);
      const durationMs = Date.now() - start;

      const testResult: TestResult = {
        id: testCase.id,
        phase: testCase.phase,
        label: testCase.label,
        filters: testCase.filters,
        result: {
          success: result.success,
          count: result.count,
          durationMs,
          timestamp: new Date().toISOString(),
          error: result.success ? undefined : 'Non-success response',
          raw: result.success ? undefined : result.raw,
        },
      };

      checkpoint.record(testResult);
      consecutiveFailures = result.success ? 0 : consecutiveFailures + 1;
      completed++;

      const icon = result.success ? '✓' : '✗';
      console.log(`${icon} [${completed}/${total}] ${testCase.label} → ${result.count.toLocaleString()} (${durationMs}ms)`);

    } catch (err: any) {
      const durationMs = Date.now() - start;
      consecutiveFailures++;
      completed++;

      checkpoint.record({
        id: testCase.id,
        phase: testCase.phase,
        label: testCase.label,
        filters: testCase.filters,
        result: {
          success: false,
          count: 0,
          durationMs,
          timestamp: new Date().toISOString(),
          error: String(err.message || err),
        },
      });

      console.error(`✗ [${completed}/${total}] ${testCase.label} → ERROR: ${err.message || err}`);
    }

    // Circuit breaker
    if (consecutiveFailures >= EXPLORER_CONFIG.maxConsecutiveFailures) {
      console.error(`\n[runner] ${consecutiveFailures} consecutive failures — cooling down ${EXPLORER_CONFIG.cooldownMs / 1000}s\n`);
      await sleep(EXPLORER_CONFIG.cooldownMs);
      consecutiveFailures = 0;
    }

    // Rate limit
    await sleep(randomBetween(EXPLORER_CONFIG.delay.min, EXPLORER_CONFIG.delay.max));
  }

  checkpoint.finalize();

  // ── Step 4: Analyze and print summary ──
  const resultsPath = checkpoint.getResultPath();
  console.log(`\n[runner] Analyzing results: ${resultsPath}`);

  const summary = analyze(resultsPath);
  const results = Checkpoint.readResults(resultsPath);
  const failures = results.filter(r => !r.result.success);

  console.log('\n=== FILTER VALIDATION SWEEP — RESULTS ===\n');
  console.log(`Baseline: ${summary.meta.baseline.toLocaleString()}`);
  console.log(`Passed: ${summary.meta.successfulTests}  Failed: ${summary.meta.failedTests}  Total: ${summary.meta.totalTests}`);

  if (failures.length > 0) {
    console.log(`\n--- FAILED FILTERS (${failures.length}) ---`);
    for (const f of failures) {
      console.log(`  ✗ ${f.label}: ${f.result.error}`);
    }
  }

  if (summary.singles.ranked.length > 0) {
    console.log('\n--- TOP 10 FILTERS BY REDUCTION ---');
    for (const s of summary.singles.ranked.slice(0, 10)) {
      console.log(`  ${s.reductionPct.toFixed(1)}%  ${s.filterKey} = ${s.value}  (${s.count.toLocaleString()})`);
    }
  }

  console.log('\n[runner] Done.');
}

run().catch(err => {
  console.error('[runner] Fatal error:', err);
  process.exit(1);
});
