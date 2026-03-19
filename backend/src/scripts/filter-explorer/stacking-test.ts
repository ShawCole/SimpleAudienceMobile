/**
 * Filter Stacking Test
 *
 * Tests whether enrichment filters are independent (multiplicative)
 * or correlated (need dampening/boost factor).
 *
 * Uses 4 enrichment filters we already have singles for:
 *   Credit 750-799, Income $100k-$149k, NW $750k-$999k, Education Bachelors
 *
 * Runs all pairs (6), triples (4), and the quad (1) = 11 combos
 * × 2 (Renter + Homeowner) × 3 anchors = 66 probes, ~1 hour
 *
 * Compares actual count vs multiplicative prediction from singles.
 */

import { buildPayload, type FilterSpec, type TestCase } from './payload-factory';

const API_BASE = process.env.API_BASE || 'http://localhost:3001/api';

async function api(path: string, body?: any): Promise<any> {
  const r = await fetch(`${API_BASE}${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) {
    const text = await r.text().catch(() => '');
    throw new Error(`API ${path} returned ${r.status}: ${text.substring(0, 200)}`);
  }
  return r.json();
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function preview(audienceId: string, label: string, filters: FilterSpec[]): Promise<number> {
  const tc: TestCase = { id: label, phase: 'single', label, filters };
  const payload = buildPayload(tc, audienceId);
  try {
    const result = await api('/audiences/preview', payload);
    return result.data?.count ?? result.count ?? -1;
  } catch (err: any) {
    console.log(`    ⚠️ ERROR: ${err.message.substring(0, 120)}`);
    return -1;
  }
}

function fmt(n: number): string {
  if (n < 0) return 'ERR';
  return n.toLocaleString();
}

// ── ENRICHMENT FILTERS (same values as renter isolation sweep) ──────────────

const ENRICHMENT: Record<string, FilterSpec> = {
  'Cr750': { key: 'attributes.credit_rating', values: ['750 - 799'] },
  'Inc100k': { key: 'profile.incomeRange', values: ['$100,000 to $149,999'] },
  'NW750k': { key: 'profile.netWorth', values: ['$750,000 to $999,999'] },
  'EduBach': { key: 'attributes.education', values: ["Bachelor's"] },
};

// ── KNOWN SINGLES (from renter isolation sweep) ─────────────────────────────
// Format: { anchorIdx: { 'R:filterKey': count, 'HO:filterKey': count } }

const KNOWN_SINGLES: Record<string, Record<string, number>> = {
  // Anchor 0: F+NoMarried+NoKids+Staff+25-34 (R=46492, HO=57409)
  '0': {
    'R:Cr750': 2881, 'HO:Cr750': 9712,
    'R:Inc100k': 1894, 'HO:Inc100k': 5802,
    'R:NW750k': 532, 'HO:NW750k': 3618,
    'R:EduBach': 5862, 'HO:EduBach': 20878,
  },
  // Anchor 1: M+NoMarried+NoKids+Staff+25-34 (R=43783, HO=69822)
  '1': {
    'R:Cr750': 2442, 'HO:Cr750': 11672,
    'R:Inc100k': 1776, 'HO:Inc100k': 7251,
    'R:NW750k': 522, 'HO:NW750k': 4421,
    'R:EduBach': 6102, 'HO:EduBach': 25248,
  },
  // Anchor 2: F+NoMarried+HasKids+Manager+35-44 (R=78838, HO=342233)
  '2': {
    'R:Cr750': 4609, 'HO:Cr750': 44217,
    'R:Inc100k': 5224, 'HO:Inc100k': 42730,
    'R:NW750k': 1908, 'HO:NW750k': 34718,
    'R:EduBach': 10950, 'HO:EduBach': 91315,
  },
};

// ── ANCHORS ─────────────────────────────────────────────────────────────────

interface Anchor {
  label: string;
  filters: FilterSpec[];
  renterCount: number;
  hoCount: number;
}

const RENTER: FilterSpec = { key: 'profile.homeowner', values: ['Renter'] };
const HOMEOWNER: FilterSpec = { key: 'profile.homeowner', values: ['Homeowner'] };

const ANCHORS: Anchor[] = [
  {
    label: 'F+NoMarried+NoKids+Staff+25-34',
    filters: [
      { key: 'profile.gender', values: ['Female'] },
      { key: 'profile.married', values: ['No'] },
      { key: 'profile.children', values: ['No children'] },
      { key: 'businessProfile.seniority', values: ['staff'] },
      { key: 'age', values: ['25-34'], range: { min: 25, max: 34 } },
    ],
    renterCount: 46492,
    hoCount: 57409,
  },
  {
    label: 'M+NoMarried+NoKids+Staff+25-34',
    filters: [
      { key: 'profile.gender', values: ['Male'] },
      { key: 'profile.married', values: ['No'] },
      { key: 'profile.children', values: ['No children'] },
      { key: 'businessProfile.seniority', values: ['staff'] },
      { key: 'age', values: ['25-34'], range: { min: 25, max: 34 } },
    ],
    renterCount: 43783,
    hoCount: 69822,
  },
  {
    label: 'F+NoMarried+HasKids+Manager+35-44',
    filters: [
      { key: 'profile.gender', values: ['Female'] },
      { key: 'profile.married', values: ['No'] },
      { key: 'profile.children', values: ['Has children'] },
      { key: 'businessProfile.seniority', values: ['manager'] },
      { key: 'age', values: ['35-44'], range: { min: 35, max: 44 } },
    ],
    renterCount: 78838,
    hoCount: 342233,
  },
];

// ── COMBOS ──────────────────────────────────────────────────────────────────

const filterKeys = Object.keys(ENRICHMENT); // ['Cr750', 'Inc100k', 'NW750k', 'EduBach']

interface Combo {
  label: string;
  keys: string[];
  filters: FilterSpec[];
}

function generateCombos(): Combo[] {
  const combos: Combo[] = [];

  // Pairs (6)
  for (let i = 0; i < filterKeys.length; i++) {
    for (let j = i + 1; j < filterKeys.length; j++) {
      const keys = [filterKeys[i], filterKeys[j]];
      combos.push({
        label: keys.join('+'),
        keys,
        filters: keys.map(k => ENRICHMENT[k]),
      });
    }
  }

  // Triples (4)
  for (let i = 0; i < filterKeys.length; i++) {
    for (let j = i + 1; j < filterKeys.length; j++) {
      for (let k = j + 1; k < filterKeys.length; k++) {
        const keys = [filterKeys[i], filterKeys[j], filterKeys[k]];
        combos.push({
          label: keys.join('+'),
          keys,
          filters: keys.map(k => ENRICHMENT[k]),
        });
      }
    }
  }

  // Quad (1)
  combos.push({
    label: filterKeys.join('+'),
    keys: [...filterKeys],
    filters: filterKeys.map(k => ENRICHMENT[k]),
  });

  return combos;
}

// ── MAIN ────────────────────────────────────────────────────────────────────

async function main() {
  const existingId = process.env.AUDIENCE_ID;
  let audienceId: string;

  if (existingId) {
    audienceId = existingId;
    console.log(`[stacking] Reusing audience: ${audienceId}`);
  } else {
    console.log('[stacking] Initializing...');
    const initResult = await api('/vacuum/init', { name: 'Stacking Test' });
    if (!initResult.success) throw new Error('Init failed');
    audienceId = initResult.audienceId;
    console.log(`[stacking] Audience: ${audienceId}`);
  }

  const combos = generateCombos();
  const totalProbes = combos.length * 2 * ANCHORS.length; // × R + HO × anchors
  let completed = 0;
  const startTime = Date.now();

  console.log(`\n[stacking] ${combos.length} combos × 2 (R+HO) × ${ANCHORS.length} anchors = ${totalProbes} probes\n`);

  // All results for final summary
  const allResults: Array<{
    anchor: number; combo: string; side: string;
    actual: number; predicted: number; ratio: number;
  }> = [];

  for (let ai = 0; ai < ANCHORS.length; ai++) {
    const anchor = ANCHORS[ai];
    const singles = KNOWN_SINGLES[String(ai)];

    console.log('═══════════════════════════════════════════════════════════════');
    console.log(`  ANCHOR ${ai}: ${anchor.label}`);
    console.log(`  Renter: ${anchor.renterCount.toLocaleString()}  |  Homeowner: ${anchor.hoCount.toLocaleString()}`);
    console.log('═══════════════════════════════════════════════════════════════\n');

    console.log(`  ${'Combo'.padEnd(30)} ${'Side'.padEnd(4)} ${'Actual'.padStart(8)} ${'Predicted'.padStart(10)} ${'Act/Pred'.padStart(9)}`);
    console.log(`  ${'-'.repeat(65)}`);

    for (const combo of combos) {
      for (const { side, hoFilter, baseCount } of [
        { side: 'R', hoFilter: RENTER, baseCount: anchor.renterCount },
        { side: 'HO', hoFilter: HOMEOWNER, baseCount: anchor.hoCount },
      ]) {
        // Get actual count
        const label = `${side}:A${ai}:${combo.label}`;
        const actual = await preview(audienceId, label, [...anchor.filters, hoFilter, ...combo.filters]);
        await sleep(1500);
        completed++;

        // Calculate multiplicative prediction from singles
        // predicted = baseCount × Π(single_i / baseCount)
        let predicted = baseCount;
        for (const k of combo.keys) {
          const singleCount = singles[`${side}:${k}`];
          if (singleCount !== undefined && singleCount >= 0) {
            predicted *= singleCount / baseCount;
          }
        }
        predicted = Math.round(predicted);

        const ratio = actual >= 0 && predicted > 0 ? actual / predicted : -1;
        const ratioStr = ratio >= 0 ? ratio.toFixed(2) + 'x' : 'N/A';

        const elapsed = (Date.now() - startTime) / 1000;
        const remaining = Math.round((elapsed / completed) * (totalProbes - completed) / 60);

        console.log(`  ${combo.label.padEnd(30)} ${side.padEnd(4)} ${fmt(actual).padStart(8)} ${fmt(predicted).padStart(10)} ${ratioStr.padStart(9)}  ~${remaining}m left`);

        if (ratio >= 0) {
          allResults.push({ anchor: ai, combo: combo.label, side, actual, predicted, ratio });
        }
      }
    }
    console.log('');
  }

  // ── SUMMARY ─────────────────────────────────────────────────────────────────
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  STACKING SUMMARY: Actual vs Multiplicative Prediction');
  console.log('═══════════════════════════════════════════════════════════════\n');

  // By combo
  const byCombo = new Map<string, number[]>();
  for (const r of allResults) {
    const key = r.combo;
    if (!byCombo.has(key)) byCombo.set(key, []);
    byCombo.get(key)!.push(r.ratio);
  }

  console.log(`  ${'Combo'.padEnd(30)} ${'Avg Ratio'.padStart(10)} ${'Min'.padStart(7)} ${'Max'.padStart(7)} ${'N'.padStart(4)}`);
  console.log(`  ${'-'.repeat(60)}`);
  for (const [combo, ratios] of byCombo) {
    const avg = ratios.reduce((a, b) => a + b, 0) / ratios.length;
    const min = Math.min(...ratios);
    const max = Math.max(...ratios);
    console.log(`  ${combo.padEnd(30)} ${(avg.toFixed(2) + 'x').padStart(10)} ${(min.toFixed(2) + 'x').padStart(7)} ${(max.toFixed(2) + 'x').padStart(7)} ${ratios.length.toString().padStart(4)}`);
  }

  // By side (R vs HO)
  console.log('');
  for (const side of ['R', 'HO']) {
    const sideResults = allResults.filter(r => r.side === side);
    if (sideResults.length === 0) continue;
    const avg = sideResults.reduce((a, r) => a + r.ratio, 0) / sideResults.length;
    const pairs = sideResults.filter(r => r.combo.split('+').length === 2);
    const triples = sideResults.filter(r => r.combo.split('+').length === 3);
    const quads = sideResults.filter(r => r.combo.split('+').length === 4);

    const pAvg = pairs.length > 0 ? pairs.reduce((a, r) => a + r.ratio, 0) / pairs.length : 0;
    const tAvg = triples.length > 0 ? triples.reduce((a, r) => a + r.ratio, 0) / triples.length : 0;
    const qAvg = quads.length > 0 ? quads.reduce((a, r) => a + r.ratio, 0) / quads.length : 0;

    console.log(`  ${side}: overall=${avg.toFixed(2)}x  pairs=${pAvg.toFixed(2)}x  triples=${tAvg.toFixed(2)}x  quad=${qAvg.toFixed(2)}x`);
  }

  const overall = allResults.reduce((a, r) => a + r.ratio, 0) / allResults.length;
  console.log(`\n  Overall avg ratio: ${overall.toFixed(2)}x (n=${allResults.length})`);
  console.log(`\n  ~1.0x = independent (multiply freely)`);
  console.log(`  >1.0x = correlated (actual > predicted, need boost factor)`);
  console.log(`  <1.0x = anti-correlated (unusual)\n`);

  console.log('Done.');
}

main().catch(err => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
