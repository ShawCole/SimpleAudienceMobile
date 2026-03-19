#!/usr/bin/env npx tsx
/**
 * Filter Relationship Explorer
 *
 * Systematically runs Preview requests with different filter combinations
 * to map how each filter affects audience list size.
 *
 * Usage:
 *   npx tsx src/scripts/filter-explorer.ts [options]
 *
 * Options:
 *   --dry-run              Print test matrix without running previews
 *   --phase <name>         Run only: baseline, singles, pairs, saturation
 *   --limit <n>            Run only first N tests
 *   --audience-id <id>     Override audience ID (otherwise auto-detected)
 */

import dotenv from 'dotenv';
dotenv.config({ path: new URL('../../.env', import.meta.url).pathname });

import { VacuumEngine } from '../automation/vacuum';
import { EXPLORER_CONFIG } from './filter-explorer/config';
import { generateTestMatrix } from './filter-explorer/test-matrix';
import { buildPayload } from './filter-explorer/payload-factory';
import { Checkpoint, type TestResult } from './filter-explorer/checkpoint';
import { analyze } from './filter-explorer/analyzer';
import fs from 'fs';
import path from 'path';

function parseArgs() {
  const args = process.argv.slice(2);
  const opts: {
    dryRun: boolean;
    phase: string | null;
    limit: number | null;
    audienceId: string | null;
  } = { dryRun: false, phase: null, limit: null, audienceId: null };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--dry-run') opts.dryRun = true;
    if (args[i] === '--phase' && args[i + 1]) opts.phase = args[++i];
    if (args[i] === '--limit' && args[i + 1]) opts.limit = parseInt(args[++i]);
    if (args[i] === '--audience-id' && args[i + 1]) opts.audienceId = args[++i];
  }

  return opts;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function randomDelay(): number {
  const { min, max } = EXPLORER_CONFIG.delay;
  return min + Math.random() * (max - min);
}

async function main() {
  const opts = parseArgs();

  // Build test matrix
  const phases = opts.phase
    ? { baseline: opts.phase === 'baseline', singles: opts.phase === 'singles', pairs: opts.phase === 'pairs', saturation: opts.phase === 'saturation' }
    : EXPLORER_CONFIG.phases;

  let matrix = generateTestMatrix(phases);

  if (opts.limit) {
    matrix = matrix.slice(0, opts.limit);
  }

  console.log(`\n=== FILTER RELATIONSHIP EXPLORER ===`);
  console.log(`Total test cases: ${matrix.length}`);
  console.log(`Phases: ${Object.entries(phases).filter(([, v]) => v).map(([k]) => k).join(', ')}`);

  if (opts.dryRun) {
    console.log('\n--- DRY RUN: Test Matrix ---\n');
    const byCat: Record<string, number> = {};
    for (const tc of matrix) {
      byCat[tc.phase] = (byCat[tc.phase] || 0) + 1;
    }
    for (const [phase, count] of Object.entries(byCat)) {
      console.log(`  ${phase}: ${count} tests`);
    }
    console.log();
    for (const tc of matrix) {
      console.log(`  [${tc.phase}] ${tc.id}`);
      console.log(`    ${tc.label}`);
    }
    return;
  }

  // Initialize VacuumEngine
  console.log('\nWarming up VacuumEngine (login + navigate)...');

  // We need to create or find an audience to use for all tests.
  // The VacuumEngine session will be on the audience filter page.
  // For now, we'll call the preview directly which handles catchUp internally.

  // Create checkpoint tracker
  const checkpoint = new Checkpoint();
  const remaining = matrix.filter(tc => !checkpoint.isCompleted(tc.id));

  console.log(`Already completed: ${checkpoint.getCompletedCount()}`);
  console.log(`Remaining: ${remaining.length}`);
  console.log(`Results: ${checkpoint.getResultPath()}\n`);

  if (remaining.length === 0) {
    console.log('All tests already completed! Running analyzer...');
    const summary = analyze(checkpoint.getResultPath());
    const summaryPath = path.join(EXPLORER_CONFIG.dataDir, `summary-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
    fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2));
    console.log(`Summary: ${summaryPath}`);
    checkpoint.finalize();
    return;
  }

  // We need an audience ID for all payloads.
  // The VacuumEngine will create one if needed, but we need to know it.
  // Strategy: use the audienceId from opts, or create a test audience first.
  let audienceId = opts.audienceId || EXPLORER_CONFIG.audienceId;

  if (!audienceId) {
    console.log('No audience ID provided. Creating a test audience...');
    // We'll do the first preview with a dummy payload and extract the ID from the URL
    // Actually, the VacuumEngine.preview() handles this via catchUp - it navigates to
    // the audience filter page and extracts IDs from the URL.
    // Let's run the baseline test first to discover the audienceId.
    console.log('Running baseline to discover audience ID...');
  }

  let consecutiveFailures = 0;
  let testsRun = 0;

  for (const tc of remaining) {
    testsRun++;
    const progress = `[${checkpoint.getCompletedCount() + 1}/${matrix.length}]`;
    console.log(`${progress} ${tc.phase}: ${tc.label}`);

    const payload = buildPayload(tc, audienceId || 'placeholder');
    const startTime = Date.now();

    try {
      const result = await VacuumEngine.preview(payload);
      const durationMs = Date.now() - startTime;

      // Try to extract audienceId from result trace if we don't have one
      if (!audienceId && result.trace?.requestUrl) {
        const match = result.trace.requestUrl.match(/audience\/([a-f0-9-]+)/);
        if (match) {
          audienceId = match[1];
          console.log(`  -> Discovered audienceId: ${audienceId}`);
        }
      }

      const count = result.data?.count ?? 0;
      const hasCountMatch = result.raw ? /"(?:count|total|totalCount)":(\d+)/.test(result.raw) : false;

      const testResult: TestResult = {
        id: tc.id,
        phase: tc.phase,
        label: tc.label,
        filters: tc.filters,
        result: {
          success: result.success,
          count,
          durationMs,
          timestamp: new Date().toISOString(),
          ...(result.success ? {} : { error: result.error }),
          ...(count === 0 && !hasCountMatch ? { error: 'No count found in response' } : {}),
        },
      };

      checkpoint.record(testResult);
      consecutiveFailures = 0;
      console.log(`  -> count: ${count.toLocaleString()} (${durationMs}ms)`);
    } catch (err: any) {
      const durationMs = Date.now() - startTime;
      consecutiveFailures++;

      const testResult: TestResult = {
        id: tc.id,
        phase: tc.phase,
        label: tc.label,
        filters: tc.filters,
        result: {
          success: false,
          count: 0,
          durationMs,
          timestamp: new Date().toISOString(),
          error: err.message,
        },
      };
      checkpoint.record(testResult);
      console.log(`  -> FAILED: ${err.message} (${durationMs}ms)`);

      if (consecutiveFailures >= EXPLORER_CONFIG.maxConsecutiveFailures) {
        console.log(`\n${EXPLORER_CONFIG.maxConsecutiveFailures} consecutive failures. Cooling down for ${EXPLORER_CONFIG.cooldownMs / 1000}s...`);
        await sleep(EXPLORER_CONFIG.cooldownMs);

        // Try to re-authenticate
        try {
          console.log('Attempting re-authentication...');
          // The next preview call will trigger catchUp which handles login
          consecutiveFailures = 0;
        } catch (reAuthErr: any) {
          console.error('Re-authentication failed. Aborting.', reAuthErr.message);
          break;
        }
      }
    }

    // Delay between requests
    if (testsRun < remaining.length) {
      const delay = randomDelay();
      await sleep(delay);
    }
  }

  // Run analyzer
  console.log('\n--- Running Analysis ---\n');
  const summary = analyze(checkpoint.getResultPath());
  const summaryPath = path.join(EXPLORER_CONFIG.dataDir, `summary-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2));
  console.log(`Summary saved: ${summaryPath}`);

  checkpoint.finalize();
  console.log('\nDone!');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
