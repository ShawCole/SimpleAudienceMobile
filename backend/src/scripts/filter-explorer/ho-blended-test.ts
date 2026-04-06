/**
 * Tests: does no-homeowner-filter = HO + Renter, or is there an "unknown" population?
 */
import { buildPayload, type FilterSpec, type TestCase } from './payload-factory';

const API = process.env.API_BASE || 'http://localhost:3001/api';
const AID = process.env.AUDIENCE_ID || '';

async function preview(label: string, filters: FilterSpec[]): Promise<number> {
  const tc: TestCase = { id: label, phase: 'single', label, filters };
  const payload = buildPayload(tc, AID);
  const r = await fetch(`${API}/audiences/preview`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
  });
  const d = await r.json();
  return d.data?.count ?? d.count ?? -1;
}

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

const HO: FilterSpec = { key: 'profile.homeowner', values: ['Homeowner'] };
const RENTER: FilterSpec = { key: 'profile.homeowner', values: ['Renter'] };

const bases = [
  { label: 'M+Staff+35-44', filters: [
    { key: 'profile.gender', values: ['Male'] },
    { key: 'businessProfile.seniority', values: ['staff'] },
    { key: 'age', values: ['35-44'], range: { min: 35, max: 44 } },
  ] as FilterSpec[] },
  { label: 'F+CXO+45-54', filters: [
    { key: 'profile.gender', values: ['Female'] },
    { key: 'businessProfile.seniority', values: ['cxo'] },
    { key: 'age', values: ['45-54'], range: { min: 45, max: 54 } },
  ] as FilterSpec[] },
  { label: 'M+Dir+35-44+Cr750', filters: [
    { key: 'profile.gender', values: ['Male'] },
    { key: 'businessProfile.seniority', values: ['director'] },
    { key: 'age', values: ['35-44'], range: { min: 35, max: 44 } },
    { key: 'attributes.credit_rating', values: ['750 - 799'] },
  ] as FilterSpec[] },
];

async function main() {
  if (!AID) { console.error('AUDIENCE_ID required'); process.exit(1); }

  console.log('Combo'.padEnd(25) + 'No Filter'.padStart(10) + 'HO'.padStart(10) + 'Renter'.padStart(10) + 'HO+R'.padStart(10) + 'Gap'.padStart(8) + ' Gap%'.padStart(7));
  console.log('-'.repeat(80));

  for (const b of bases) {
    const noFilter = await preview(b.label + ':none', b.filters);
    await sleep(2000);
    const ho = await preview(b.label + ':HO', [...b.filters, HO]);
    await sleep(2000);
    const renter = await preview(b.label + ':R', [...b.filters, RENTER]);
    await sleep(2000);

    const sum = ho + renter;
    const gap = noFilter - sum;
    const gapPct = noFilter > 0 ? ((gap / noFilter) * 100).toFixed(1) : 'n/a';

    console.log(
      b.label.padEnd(25) +
      noFilter.toLocaleString().padStart(10) +
      ho.toLocaleString().padStart(10) +
      renter.toLocaleString().padStart(10) +
      sum.toLocaleString().padStart(10) +
      gap.toLocaleString().padStart(8) +
      (gapPct + '%').padStart(7)
    );
  }
}

main().catch(err => { console.error('Fatal:', err.message); process.exit(1); });
