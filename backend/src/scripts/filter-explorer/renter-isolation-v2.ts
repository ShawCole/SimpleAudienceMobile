/**
 * Renter Isolation Test v2
 *
 * NO calibration needed — anchors chosen from probe grid data (480 combos).
 * Picked 3 anchors where BOTH Renter and Homeowner are uncapped:
 *
 *   Anchor 1: F, NoMarried, NoKids, Staff, 25-34  → R=46,492  HO=57,409 (0.81x)
 *   Anchor 2: M, NoMarried, NoKids, Staff, 25-34  → R=43,783  HO=69,822 (0.63x)
 *   Anchor 3: F, NoMarried, HasKids, Manager, 35-44 → R=78,838  HO=342,233 (0.23x)
 *
 * For each: add 10 enrichment filters on Renter vs Homeowner, compare retention %.
 */

import { buildPayload, type FilterSpec, type TestCase } from './payload-factory';

const API_BASE = process.env.API_BASE || 'http://localhost:3001/api';
const CAP = 500_000;

async function api(apiPath: string, body?: any): Promise<any> {
  const url = `${API_BASE}${apiPath}`;
  const res = await fetch(url, {
    method: body ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`API ${apiPath} returned ${res.status}: ${text.substring(0, 200)}`);
  }
  return res.json();
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function preview(audienceId: string, label: string, filters: FilterSpec[]): Promise<number> {
  const testCase: TestCase = { id: label, phase: 'single', label, filters };
  const payload = buildPayload(testCase, audienceId);
  try {
    const result = await api('/audiences/preview', payload);
    const count = result.data?.count ?? result.count ?? -1;
    return count;
  } catch (err: any) {
    console.log(`    ⚠️ ERROR: ${err.message.substring(0, 100)}`);
    return -1;
  }
}

function fmt(count: number): string {
  if (count < 0) return 'ERROR';
  if (count >= CAP) return '500k+ (CAP)';
  return count.toLocaleString();
}

// ── ANCHORS (from probe grid data — both sides uncapped) ────────────────────

interface Anchor {
  label: string;
  baseFilters: FilterSpec[];  // WITHOUT homeowner
  renterCount: number;        // known from probe grid
  hoCount: number;            // known from probe grid
}

const ANCHORS: Anchor[] = [
  {
    label: 'F+NoMarried+NoKids+Staff+25-34',
    baseFilters: [
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
    baseFilters: [
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
    baseFilters: [
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

// ── ENRICHMENT FILTERS ──────────────────────────────────────────────────────

const ENRICHMENT_FILTERS: Array<{ label: string; filter: FilterSpec }> = [
  { label: 'Credit 750-799', filter: { key: 'attributes.credit_rating', values: ['750 - 799'] } },
  { label: 'Credit 650-699', filter: { key: 'attributes.credit_rating', values: ['650 - 699'] } },
  { label: 'Income $100k-$149k', filter: { key: 'profile.incomeRange', values: ['$100,000 to $149,999'] } },
  { label: 'Income $45k-$59k', filter: { key: 'profile.incomeRange', values: ['$45,000 to $59,999'] } },
  { label: 'California', filter: { key: 'state', values: ['California'] } },
  { label: 'Texas', filter: { key: 'state', values: ['Texas'] } },
  { label: 'Education Bachelors', filter: { key: 'attributes.education', values: ["Bachelor's"] } },
  { label: 'Education HighSchool', filter: { key: 'attributes.education', values: ['High School'] } },
  { label: 'NW $250k-$374k', filter: { key: 'profile.netWorth', values: ['$250,000 to $374,999'] } },
  { label: 'NW $750k-$999k', filter: { key: 'profile.netWorth', values: ['$750,000 to $999,999'] } },
];

const RENTER: FilterSpec = { key: 'profile.homeowner', values: ['Renter'] };
const HOMEOWNER: FilterSpec = { key: 'profile.homeowner', values: ['Homeowner'] };

// ── MAIN ────────────────────────────────────────────────────────────────────

async function main() {
  const existingId = process.env.AUDIENCE_ID;
  let audienceId: string;

  if (existingId) {
    audienceId = existingId;
    console.log(`[v2] Reusing audience: ${audienceId}\n`);
  } else {
    console.log('[v2] Initializing...');
    const initResult = await api('/vacuum/init', { name: 'Renter Isolation v2' });
    if (!initResult.success) throw new Error('Init failed');
    audienceId = initResult.audienceId;
    console.log(`[v2] Audience: ${audienceId}\n`);
  }

  // Track all results for summary
  const allResults: Array<{
    anchor: string; filter: string;
    rCount: number; hoCount: number;
    rRet: number; hoRet: number; ratio: number;
  }> = [];

  for (const anchor of ANCHORS) {
    console.log('═══════════════════════════════════════════════════════════════');
    console.log(`  ANCHOR: ${anchor.label}`);
    console.log(`  Renter: ${anchor.renterCount.toLocaleString()}  |  Homeowner: ${anchor.hoCount.toLocaleString()}  (from probe grid)`);
    console.log('═══════════════════════════════════════════════════════════════');

    console.log(`\n  ${'Filter'.padEnd(25)} ${'Renter'.padStart(10)} ${'R-Ret%'.padStart(8)} ${'Homeowner'.padStart(10)} ${'HO-Ret%'.padStart(8)} ${'R/HO'.padStart(7)}`);
    console.log(`  ${'-'.repeat(70)}`);

    for (const ef of ENRICHMENT_FILTERS) {
      // Renter + enrichment
      const rc = await preview(audienceId, `R:${anchor.label}+${ef.label}`,
        [...anchor.baseFilters, RENTER, ef.filter]);
      await sleep(1500);

      // Homeowner + enrichment
      const hc = await preview(audienceId, `HO:${anchor.label}+${ef.label}`,
        [...anchor.baseFilters, HOMEOWNER, ef.filter]);
      await sleep(1500);

      const rRet = rc >= 0 ? rc / anchor.renterCount : -1;
      const hoRet = hc >= 0 ? hc / anchor.hoCount : -1;
      const ratio = hoRet > 0 && rRet >= 0 ? rRet / hoRet : -1;

      const rRetStr = rRet >= 0 ? (rRet * 100).toFixed(1) + '%' : 'ERR';
      const hoRetStr = hoRet >= 0 ? (hoRet * 100).toFixed(1) + '%' : 'ERR';
      const ratioStr = ratio >= 0 ? ratio.toFixed(2) + 'x' : 'N/A';

      console.log(`  ${ef.label.padEnd(25)} ${fmt(rc).padStart(10)} ${rRetStr.padStart(8)} ${fmt(hc).padStart(10)} ${hoRetStr.padStart(8)} ${ratioStr.padStart(7)}`);

      if (rRet >= 0 && hoRet >= 0) {
        allResults.push({
          anchor: anchor.label, filter: ef.label,
          rCount: rc, hoCount: hc,
          rRet, hoRet, ratio,
        });
      }
    }
    console.log('');
  }

  // ── SUMMARY ─────────────────────────────────────────────────────────────────
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  SUMMARY: Renter vs Homeowner Enrichment Retention');
  console.log('═══════════════════════════════════════════════════════════════\n');

  if (allResults.length === 0) {
    console.log('  No valid results to summarize.');
    return;
  }

  // Average ratio by filter type
  const byFilter = new Map<string, number[]>();
  for (const r of allResults) {
    if (!byFilter.has(r.filter)) byFilter.set(r.filter, []);
    byFilter.get(r.filter)!.push(r.ratio);
  }

  console.log(`  ${'Enrichment Filter'.padEnd(25)} ${'Avg R/HO'.padStart(10)} ${'Samples'.padStart(8)}`);
  console.log(`  ${'-'.repeat(45)}`);
  for (const [filter, ratios] of byFilter) {
    const avg = ratios.reduce((a, b) => a + b, 0) / ratios.length;
    console.log(`  ${filter.padEnd(25)} ${(avg.toFixed(2) + 'x').padStart(10)} ${ratios.length.toString().padStart(8)}`);
  }

  const allRatios = allResults.map(r => r.ratio);
  const overallAvg = allRatios.reduce((a, b) => a + b, 0) / allRatios.length;
  const min = Math.min(...allRatios);
  const max = Math.max(...allRatios);

  console.log(`\n  Overall: avg=${overallAvg.toFixed(2)}x  min=${min.toFixed(2)}x  max=${max.toFixed(2)}x  (n=${allRatios.length})`);
  console.log(`\n  If avg ~1.0x → same multipliers work for Renter and Homeowner.`);
  console.log(`  If consistently <0.5x or >2.0x → Renter needs its own multiplier set.\n`);

  console.log('Done.');
}

main().catch(err => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
