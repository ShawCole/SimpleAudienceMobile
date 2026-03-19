/**
 * Fill the 6 missing NW probes from renter isolation sweep.
 * Uses the same 3 anchors, correct bracket: $250,000 to $374,999
 */
import { buildPayload, type FilterSpec, type TestCase } from './payload-factory';

const API_BASE = process.env.API_BASE || 'http://localhost:3001/api';

async function preview(audienceId: string, label: string, filters: FilterSpec[]): Promise<number> {
  const tc: TestCase = { id: label, phase: 'single', label, filters };
  const payload = buildPayload(tc, audienceId);
  const r = await fetch(`${API_BASE}/audiences/preview`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!r.ok) {
    const text = await r.text().catch(() => '');
    console.log(`  ⚠️ ERROR ${label}: ${text.substring(0, 200)}`);
    return -1;
  }
  const data = await r.json() as any;
  return data.data?.count ?? data.count ?? -1;
}

const RENTER: FilterSpec = { key: 'profile.homeowner', values: ['Renter'] };
const HOMEOWNER: FilterSpec = { key: 'profile.homeowner', values: ['Homeowner'] };
const NW_FILTER: FilterSpec = { key: 'profile.netWorth', values: ['$250,000 to $374,999'] };

const ANCHORS = [
  {
    label: 'F+NoMarried+NoKids+Staff+25-34',
    filters: [
      { key: 'profile.gender', values: ['Female'] },
      { key: 'profile.married', values: ['No'] },
      { key: 'profile.children', values: ['No children'] },
      { key: 'businessProfile.seniority', values: ['staff'] },
      { key: 'age', values: ['25-34'], range: { min: 25, max: 34 } },
    ] as FilterSpec[],
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
    ] as FilterSpec[],
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
    ] as FilterSpec[],
    renterCount: 78838,
    hoCount: 342233,
  },
];

async function main() {
  const aid = process.env.AUDIENCE_ID;
  if (!aid) throw new Error('Set AUDIENCE_ID');

  console.log('NW $250k-$374k fill — 6 probes\n');
  console.log(`${'Anchor'.padEnd(40)} ${'Renter'.padStart(10)} ${'R-Ret%'.padStart(8)} ${'Homeowner'.padStart(10)} ${'HO-Ret%'.padStart(8)} ${'R/HO'.padStart(7)}`);
  console.log('-'.repeat(85));

  for (const a of ANCHORS) {
    const rc = await preview(aid, `NW-fill:R:${a.label}`, [...a.filters, RENTER, NW_FILTER]);
    await new Promise(r => setTimeout(r, 1500));
    const hc = await preview(aid, `NW-fill:HO:${a.label}`, [...a.filters, HOMEOWNER, NW_FILTER]);
    await new Promise(r => setTimeout(r, 1500));

    const rRet = rc >= 0 ? (rc / a.renterCount * 100).toFixed(1) + '%' : 'ERR';
    const hoRet = hc >= 0 ? (hc / a.hoCount * 100).toFixed(1) + '%' : 'ERR';
    const ratio = rc >= 0 && hc > 0 ? ((rc / a.renterCount) / (hc / a.hoCount)).toFixed(2) + 'x' : 'N/A';

    console.log(`${a.label.padEnd(40)} ${(rc >= 0 ? rc.toLocaleString() : 'ERR').padStart(10)} ${rRet.padStart(8)} ${(hc >= 0 ? hc.toLocaleString() : 'ERR').padStart(10)} ${hoRet.padStart(8)} ${ratio.padStart(7)}`);
  }
  console.log('\nDone.');
}

main().catch(e => { console.error(e); process.exit(1); });
