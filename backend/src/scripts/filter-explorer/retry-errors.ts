/**
 * Retry Errors — Re-run failed probes from any grid NDJSON file
 *
 * Reads the NDJSON, finds error rows, retries them, and appends corrected results.
 *
 * Usage:
 *   API_BASE=http://localhost:3001/api npx tsx backend/src/scripts/filter-explorer/retry-errors.ts <ndjson-file>
 *   API_BASE=http://localhost:3001/api npx tsx backend/src/scripts/filter-explorer/retry-errors.ts <ndjson-file> --dry-run
 */

import fs from 'fs';
import { buildPayload, type FilterSpec, type TestCase } from './payload-factory';

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

async function main() {
  const args = process.argv.slice(2);
  const filePath = args.find(a => !a.startsWith('--'));
  const dryRun = args.includes('--dry-run');

  if (!filePath) {
    console.error('Usage: retry-errors.ts <ndjson-file> [--dry-run]');
    process.exit(1);
  }

  const lines = fs.readFileSync(filePath, 'utf-8').trim().split('\n');
  const allRows = lines.map(l => JSON.parse(l));
  const errors = allRows.filter(r => !r.success);
  const goodRows = allRows.filter(r => r.success);

  console.log(`File: ${filePath}`);
  console.log(`Total rows: ${allRows.length} | Errors: ${errors.length} | Good: ${goodRows.length}\n`);

  if (errors.length === 0) {
    console.log('No errors to retry.');
    return;
  }

  for (const e of errors) {
    console.log(`  ${Object.values(e.combo).join(' + ')} — ${(e.error || '').substring(0, 60)}`);
  }

  if (dryRun) {
    console.log(`\n${errors.length} combos to retry (dry run)`);
    return;
  }

  // Prewarm + init
  console.log('\n[retry] Pre-warming VacuumEngine...');
  const prewarmResult = await api('/vacuum/prewarm', {});
  if (!prewarmResult.success) throw new Error('Prewarm failed');
  console.log('[retry] Pre-warm complete.\n');

  console.log('[retry] Initializing audience...');
  const initResult = await api('/vacuum/init', { name: 'Retry Errors' });
  if (!initResult.success) throw new Error('Init failed');
  const audienceId = initResult.audienceId;
  console.log(`[retry] Audience ready: ${audienceId}\n`);

  const retried: any[] = [];

  for (let i = 0; i < errors.length; i++) {
    const err = errors[i];
    const start = Date.now();

    try {
      const testCase: TestCase = {
        id: err.id,
        phase: 'grid',
        label: err.id,
        filters: err.filters,
      };
      const payload = buildPayload(testCase, audienceId);
      const result = await api('/audiences/preview', payload);
      const durationMs = Date.now() - start;
      const count = result.data?.count ?? result.count ?? 0;

      const fixed = {
        ...err,
        count,
        durationMs,
        timestamp: new Date().toISOString(),
        success: true,
        error: undefined,
      };
      delete fixed.error;
      retried.push(fixed);

      const countStr = count >= 500000 ? '500k+ (CAPPED)' : count.toLocaleString();
      console.log(`[${i + 1}/${errors.length}] ${Object.values(err.combo).join(' + ')} => ${countStr} (${durationMs}ms)`);

    } catch (retryErr: any) {
      const durationMs = Date.now() - start;
      retried.push({
        ...err,
        durationMs,
        timestamp: new Date().toISOString(),
        success: false,
        error: String(retryErr.message || retryErr),
      });
      console.error(`[${i + 1}/${errors.length}] STILL FAILING: ${retryErr.message}`);
    }

    await sleep(1500 + Math.random() * 1000);
  }

  // Rewrite the file: good rows + retried rows (in original order by id)
  const retriedMap = new Map(retried.map(r => [r.id, r]));
  const newRows = allRows.map(r => {
    if (!r.success && retriedMap.has(r.id)) {
      return retriedMap.get(r.id);
    }
    return r;
  });

  fs.writeFileSync(filePath, newRows.map(r => JSON.stringify(r)).join('\n') + '\n');

  const newErrors = newRows.filter(r => !r.success);
  console.log(`\nFile updated. Remaining errors: ${newErrors.length}`);
}

main().catch(err => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
