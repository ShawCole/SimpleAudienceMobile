/**
 * Lower-Tier Stacking Test
 *
 * Tests whether LOWER-tier enrichment filters are also correlated
 * or if correlation is only an upper-tier wealth clustering effect.
 *
 * Uses 4 lower/mid-tier filters:
 *   Credit 650-699, Income $45k-$59k, NW $25k-$49k, Education HighSchool
 *
 * Same 3 anchors as upper-tier test. Runs all pairs (6), triples (4),
 * and quad (1) = 11 combos × 2 (R+HO) × 3 anchors = 66 probes.
 *
 * Also runs singles first to get fresh baselines (8 probes per anchor = 24).
 * Total: 90 probes, ~1.5 hours.
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

// ── LOWER-TIER ENRICHMENT FILTERS ───────────────────────────────────────────

const ENRICHMENT: Record<string, FilterSpec> = {
  'Cr650': { key: 'attributes.credit_rating', values: ['650 - 699'] },
  'Inc45k': { key: 'profile.incomeRange', values: ['$45,000 to $59,999'] },
  'NW25k': { key: 'profile.netWorth', values: ['$25,000 to $49,999'] },
  'EduHS': { key: 'attributes.education', values: ['High School'] },
};

const filterKeys = Object.keys(ENRICHMENT);

// ── ANCHORS (same 3 as upper-tier test, from probe grid) ────────────────────

const RENTER: FilterSpec = { key: 'profile.homeowner', values: ['Renter'] };
const HOMEOWNER: FilterSpec = { key: 'profile.homeowner', values: ['Homeowner'] };

interface Anchor {
  label: string;
  filters: FilterSpec[];
  renterCount: number;
  hoCount: number;
}

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

// ── COMBO GENERATOR ─────────────────────────────────────────────────────────

interface Combo {
  label: string;
  keys: string[];
  filters: FilterSpec[];
}

function generateCombos(): Combo[] {
  const combos: Combo[] = [];
  for (let i = 0; i < filterKeys.length; i++)
    for (let j = i + 1; j < filterKeys.length; j++)
      combos.push({ label: `${filterKeys[i]}+${filterKeys[j]}`, keys: [filterKeys[i], filterKeys[j]], filters: [ENRICHMENT[filterKeys[i]], ENRICHMENT[filterKeys[j]]] });
  for (let i = 0; i < filterKeys.length; i++)
    for (let j = i + 1; j < filterKeys.length; j++)
      for (let k = j + 1; k < filterKeys.length; k++)
        combos.push({ label: `${filterKeys[i]}+${filterKeys[j]}+${filterKeys[k]}`, keys: [filterKeys[i], filterKeys[j], filterKeys[k]], filters: [ENRICHMENT[filterKeys[i]], ENRICHMENT[filterKeys[j]], ENRICHMENT[filterKeys[k]]] });
  combos.push({ label: filterKeys.join('+'), keys: [...filterKeys], filters: filterKeys.map(k => ENRICHMENT[k]) });
  return combos;
}

// ── MAIN ────────────────────────────────────────────────────────────────────

async function main() {
  const existingId = process.env.AUDIENCE_ID;
  let audienceId: string;

  if (existingId) {
    audienceId = existingId;
    console.log(`[lower-stack] Reusing audience: ${audienceId}`);
  } else {
    console.log('[lower-stack] Initializing...');
    const initResult = await api('/vacuum/init', { name: 'Lower Stacking' });
    if (!initResult.success) throw new Error('Init failed');
    audienceId = initResult.audienceId;
    console.log(`[lower-stack] Audience: ${audienceId}`);
  }

  const combos = generateCombos();
  // Phase 1: singles (4 filters × 2 sides × 3 anchors = 24)
  // Phase 2: combos (11 × 2 × 3 = 66)
  const totalProbes = (filterKeys.length * 2 * ANCHORS.length) + (combos.length * 2 * ANCHORS.length);
  let completed = 0;
  const startTime = Date.now();

  console.log(`\n[lower-stack] Phase 1: ${filterKeys.length * 2 * ANCHORS.length} singles + Phase 2: ${combos.length * 2 * ANCHORS.length} combos = ${totalProbes} total probes\n`);

  // Store singles: singles[anchorIdx]['R:filterKey'] = count
  const singles: Record<string, Record<string, number>> = {};

  const allResults: Array<{
    anchor: number; combo: string; side: string;
    actual: number; predicted: number; ratio: number;
  }> = [];

  for (let ai = 0; ai < ANCHORS.length; ai++) {
    const anchor = ANCHORS[ai];
    singles[String(ai)] = {};

    console.log('═══════════════════════════════════════════════════════════════');
    console.log(`  ANCHOR ${ai}: ${anchor.label}`);
    console.log(`  Renter: ${anchor.renterCount.toLocaleString()}  |  Homeowner: ${anchor.hoCount.toLocaleString()}`);
    console.log('═══════════════════════════════════════════════════════════════');

    // ── PHASE 1: SINGLES ──────────────────────────────────────────────────
    console.log('\n  --- Singles ---');
    for (const fk of filterKeys) {
      for (const { side, hoFilter } of [
        { side: 'R', hoFilter: RENTER },
        { side: 'HO', hoFilter: HOMEOWNER },
      ]) {
        const label = `single:${side}:A${ai}:${fk}`;
        const count = await preview(audienceId, label, [...anchor.filters, hoFilter, ENRICHMENT[fk]]);
        await sleep(1500);
        completed++;
        singles[String(ai)][`${side}:${fk}`] = count;

        const base = side === 'R' ? anchor.renterCount : anchor.hoCount;
        const ret = count >= 0 ? (count / base * 100).toFixed(1) + '%' : 'ERR';
        const elapsed = (Date.now() - startTime) / 1000;
        const remaining = Math.round((elapsed / completed) * (totalProbes - completed) / 60);
        console.log(`  [${completed}/${totalProbes}] ${side} ${fk.padEnd(8)} ${fmt(count).padStart(8)} (${ret.padStart(6)})  ~${remaining}m left`);
      }
    }

    // ── PHASE 2: COMBOS ───────────────────────────────────────────────────
    console.log('\n  --- Combos ---');
    console.log(`  ${'Combo'.padEnd(30)} ${'Side'.padEnd(4)} ${'Actual'.padStart(8)} ${'Predicted'.padStart(10)} ${'Act/Pred'.padStart(9)}`);
    console.log(`  ${'-'.repeat(65)}`);

    for (const combo of combos) {
      for (const { side, hoFilter, baseCount } of [
        { side: 'R', hoFilter: RENTER, baseCount: anchor.renterCount },
        { side: 'HO', hoFilter: HOMEOWNER, baseCount: anchor.hoCount },
      ]) {
        const label = `${side}:A${ai}:${combo.label}`;
        const actual = await preview(audienceId, label, [...anchor.filters, hoFilter, ...combo.filters]);
        await sleep(1500);
        completed++;

        let predicted = baseCount;
        for (const k of combo.keys) {
          const sc = singles[String(ai)][`${side}:${k}`];
          if (sc !== undefined && sc >= 0) predicted *= sc / baseCount;
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
  console.log('  LOWER-TIER STACKING SUMMARY');
  console.log('═══════════════════════════════════════════════════════════════\n');

  const byCombo = new Map<string, number[]>();
  for (const r of allResults) {
    if (!byCombo.has(r.combo)) byCombo.set(r.combo, []);
    byCombo.get(r.combo)!.push(r.ratio);
  }

  console.log(`  ${'Combo'.padEnd(30)} ${'Avg Ratio'.padStart(10)} ${'Min'.padStart(7)} ${'Max'.padStart(7)} ${'N'.padStart(4)}`);
  console.log(`  ${'-'.repeat(60)}`);
  for (const [combo, ratios] of byCombo) {
    const avg = ratios.reduce((a, b) => a + b, 0) / ratios.length;
    console.log(`  ${combo.padEnd(30)} ${(avg.toFixed(2) + 'x').padStart(10)} ${(Math.min(...ratios).toFixed(2) + 'x').padStart(7)} ${(Math.max(...ratios).toFixed(2) + 'x').padStart(7)} ${ratios.length.toString().padStart(4)}`);
  }

  console.log('');
  for (const side of ['R', 'HO']) {
    const sr = allResults.filter(r => r.side === side);
    if (!sr.length) continue;
    const pairs = sr.filter(r => r.combo.split('+').length === 2);
    const triples = sr.filter(r => r.combo.split('+').length === 3);
    const quads = sr.filter(r => r.combo.split('+').length === 4);
    const avg = (arr: typeof sr) => arr.length ? (arr.reduce((a, r) => a + r.ratio, 0) / arr.length).toFixed(2) : 'N/A';
    console.log(`  ${side}: pairs=${avg(pairs)}x  triples=${avg(triples)}x  quad=${avg(quads)}x`);
  }

  const overall = allResults.reduce((a, r) => a + r.ratio, 0) / allResults.length;
  console.log(`\n  Overall: ${overall.toFixed(2)}x (n=${allResults.length})`);

  console.log(`\n  Compare to UPPER-TIER results:`);
  console.log(`    Upper: HO pairs=1.44x  triples=2.46x  quad=4.86x`);
  console.log(`    Upper: R  pairs=2.27x  triples=8.28x  quad=13.0x`);
  console.log(`\n  If lower-tier ~1.0x → stacking correction only needed for upper-tier wealth clustering.`);
  console.log(`  If lower-tier also >1.5x → correlation is universal, need broader correction.\n`);

  console.log('Done.');
}

main().catch(err => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
