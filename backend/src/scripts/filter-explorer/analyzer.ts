import fs from 'fs';
import path from 'path';
import { Checkpoint, type TestResult } from './checkpoint';
import { EXPLORER_CONFIG } from './config';

interface SingleMetric {
  filterKey: string;
  value: string;
  count: number;
  reductionFromBaseline: number;
  reductionPct: number;
}

interface PairMetric {
  filterA: string;
  valueA: string;
  filterB: string;
  valueB: string;
  actualCount: number;
  expectedCount: number;
  interactionRatio: number;
  interactionType: 'multiplicative' | 'overlapping' | 'near-independent';
}

interface SaturationPoint {
  nValues: number;
  values: string[];
  count: number;
  deltaFromPrev: number;
}

export interface ExplorerSummary {
  meta: {
    runAt: string;
    totalTests: number;
    successfulTests: number;
    failedTests: number;
    baseline: number;
  };
  singles: {
    ranked: SingleMetric[];
    byCategory: Record<string, SingleMetric[]>;
  };
  pairs: {
    mostMultiplicative: PairMetric[];
    mostOverlapping: PairMetric[];
    nearIndependent: PairMetric[];
  };
  saturation: Record<string, SaturationPoint[]>;
}

export function analyze(resultsPath: string): ExplorerSummary {
  const results = Checkpoint.readResults(resultsPath);

  // Find baseline
  const baselineResult = results.find(r => r.phase === 'baseline' && r.result.success);
  const baseline = baselineResult?.result.count || 0;

  if (!baseline) {
    console.warn('[analyzer] No baseline count found! Pair interaction analysis will be skipped.');
  }

  // Singles analysis
  const singles = results
    .filter(r => r.phase === 'single' && r.result.success)
    .map(r => {
      const filterKey = r.filters[0]?.key || 'unknown';
      const value = r.filters[0]?.values?.join('+') || r.filters[0]?.range ? `${r.filters[0].range?.min}-${r.filters[0].range?.max}` : 'unknown';
      const count = r.result.count;
      const reduction = baseline - count;
      return {
        filterKey,
        value,
        count,
        reductionFromBaseline: reduction,
        reductionPct: baseline > 0 ? (reduction / baseline) * 100 : 0,
      };
    })
    .sort((a, b) => b.reductionPct - a.reductionPct);

  // Group by category
  const byCategory: Record<string, SingleMetric[]> = {};
  for (const s of singles) {
    const cat = s.filterKey.split('.')[0] || 'top-level';
    if (!byCategory[cat]) byCategory[cat] = [];
    byCategory[cat].push(s);
  }

  // Pairs analysis
  const singleCounts = new Map<string, number>();
  for (const s of singles) {
    singleCounts.set(`${s.filterKey}:${s.value}`, s.count);
  }

  const pairResults = results.filter(r => r.phase === 'pair' && r.result.success);
  const pairs: PairMetric[] = [];

  for (const r of pairResults) {
    if (r.filters.length < 2 || !baseline) continue;

    const fA = r.filters[0];
    const fB = r.filters[1];
    const valA = fA.values?.join('+') || `${fA.range?.min}-${fA.range?.max}`;
    const valB = fB.values?.join('+') || `${fB.range?.min}-${fB.range?.max}`;

    const countA = singleCounts.get(`${fA.key}:${valA}`);
    const countB = singleCounts.get(`${fB.key}:${valB}`);

    if (countA === undefined || countB === undefined) continue;

    const expected = (countA / baseline) * (countB / baseline) * baseline;
    const actual = r.result.count;
    const ratio = expected > 0 ? actual / expected : 0;

    pairs.push({
      filterA: fA.key,
      valueA: valA,
      filterB: fB.key,
      valueB: valB,
      actualCount: actual,
      expectedCount: Math.round(expected),
      interactionRatio: Math.round(ratio * 1000) / 1000,
      interactionType: ratio < 0.8 ? 'multiplicative' : ratio > 1.2 ? 'overlapping' : 'near-independent',
    });
  }

  pairs.sort((a, b) => Math.abs(1 - a.interactionRatio) - Math.abs(1 - b.interactionRatio));

  // Saturation analysis
  const saturation: Record<string, SaturationPoint[]> = {};
  const satResults = results.filter(r => r.phase === 'saturation' && r.result.success);

  for (const r of satResults) {
    const key = r.filters[0]?.key;
    if (!key) continue;
    if (!saturation[key]) saturation[key] = [];
  }

  // Group and sort by nValues
  for (const r of satResults) {
    const key = r.filters[0]?.key;
    if (!key) continue;
    const values = r.filters[0].values;
    saturation[key].push({
      nValues: values.length,
      values,
      count: r.result.count,
      deltaFromPrev: 0,
    });
  }

  for (const key of Object.keys(saturation)) {
    saturation[key].sort((a, b) => a.nValues - b.nValues);
    for (let i = 1; i < saturation[key].length; i++) {
      saturation[key][i].deltaFromPrev = saturation[key][i].count - saturation[key][i - 1].count;
    }
  }

  const summary: ExplorerSummary = {
    meta: {
      runAt: new Date().toISOString(),
      totalTests: results.length,
      successfulTests: results.filter(r => r.result.success).length,
      failedTests: results.filter(r => !r.result.success).length,
      baseline,
    },
    singles: {
      ranked: singles,
      byCategory,
    },
    pairs: {
      mostMultiplicative: pairs.filter(p => p.interactionType === 'multiplicative').sort((a, b) => a.interactionRatio - b.interactionRatio),
      mostOverlapping: pairs.filter(p => p.interactionType === 'overlapping').sort((a, b) => b.interactionRatio - a.interactionRatio),
      nearIndependent: pairs.filter(p => p.interactionType === 'near-independent'),
    },
    saturation,
  };

  return summary;
}

/** CLI entry point: analyze the most recent results file */
if (require.main === module) {
  const dir = EXPLORER_CONFIG.dataDir;
  const arg = process.argv[2];

  let filePath: string;
  if (arg) {
    filePath = path.resolve(arg);
  } else {
    // Find most recent results file
    const files = fs.readdirSync(dir)
      .filter(f => f.startsWith('results-') && f.endsWith('.ndjson'))
      .sort()
      .reverse();
    if (!files.length) {
      console.error('No results files found in', dir);
      process.exit(1);
    }
    filePath = path.join(dir, files[0]);
  }

  console.log(`[analyzer] Reading: ${filePath}`);
  const summary = analyze(filePath);

  // Save summary
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const summaryPath = path.join(dir, `summary-${ts}.json`);
  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2));
  console.log(`[analyzer] Summary saved: ${summaryPath}`);

  // Print highlights
  console.log('\n=== FILTER RELATIONSHIP EXPLORER — SUMMARY ===\n');
  console.log(`Baseline universe: ${summary.meta.baseline.toLocaleString()}`);
  console.log(`Tests: ${summary.meta.successfulTests} successful, ${summary.meta.failedTests} failed\n`);

  console.log('--- TOP 15 FILTERS BY REDUCTION ---');
  for (const s of summary.singles.ranked.slice(0, 15)) {
    console.log(`  ${s.reductionPct.toFixed(1)}%  ${s.filterKey} = ${s.value}  (${s.count.toLocaleString()})`);
  }

  if (summary.pairs.mostMultiplicative.length) {
    console.log('\n--- MOST MULTIPLICATIVE PAIRS (compound reduction) ---');
    for (const p of summary.pairs.mostMultiplicative.slice(0, 10)) {
      console.log(`  ratio=${p.interactionRatio}  ${p.filterA}(${p.valueA}) + ${p.filterB}(${p.valueB})  actual=${p.actualCount.toLocaleString()} expected=${p.expectedCount.toLocaleString()}`);
    }
  }

  if (summary.pairs.mostOverlapping.length) {
    console.log('\n--- MOST OVERLAPPING PAIRS (redundant filters) ---');
    for (const p of summary.pairs.mostOverlapping.slice(0, 10)) {
      console.log(`  ratio=${p.interactionRatio}  ${p.filterA}(${p.valueA}) + ${p.filterB}(${p.valueB})  actual=${p.actualCount.toLocaleString()} expected=${p.expectedCount.toLocaleString()}`);
    }
  }

  console.log('\n--- SATURATION CURVES ---');
  for (const [key, points] of Object.entries(summary.saturation)) {
    console.log(`  ${key}:`);
    for (const pt of points) {
      const delta = pt.deltaFromPrev > 0 ? `+${pt.deltaFromPrev.toLocaleString()}` : pt.deltaFromPrev.toLocaleString();
      console.log(`    [${pt.nValues}] ${pt.count.toLocaleString()} (${delta}): ${pt.values.join(', ')}`);
    }
  }
}
