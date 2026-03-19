/**
 * Renter Isolation Test
 *
 * Goal: Determine if Renter has an enrichment data gap or if our sweep zeros
 * were just a volume problem from stacking too many filters.
 *
 * Method:
 *   1. Start with combos that DON'T include Homeowner and are below 500k
 *   2. Record the base count
 *   3. Add Homeowner=Renter → record count
 *   4. Add Homeowner=Homeowner → record count (control)
 *   5. From the Renter version, sweep a few enrichment filters
 *   6. From the Homeowner version, sweep the same filters (control)
 *   7. Compare retention ratios
 */

import { buildPayload, type FilterSpec, type TestCase } from './payload-factory';

const API_BASE = process.env.API_BASE || 'http://localhost:3001/api';

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
  const result = await api('/audiences/preview', payload);
  const count = result.data?.count ?? result.count ?? -1;
  return count;
}

async function main() {
  // Init audience
  console.log('[renter-test] Pre-warming...');
  await api('/vacuum/prewarm', {});
  console.log('[renter-test] Initializing audience...');
  const initResult = await api('/vacuum/init', { name: 'Layer 1 Sweep' });
  if (!initResult.success) throw new Error('Init failed');
  const audienceId = initResult.audienceId;
  console.log(`[renter-test] Audience ready: ${audienceId}\n`);

  // Base combos WITHOUT homeowner, designed to be under 500k
  const baseAnchors: Array<{ label: string; filters: FilterSpec[] }> = [
    {
      label: 'Male + Married + Staff + Age45-54',
      filters: [
        { key: 'profile.gender', values: ['Male'] },
        { key: 'profile.married', values: ['Yes'] },
        { key: 'businessProfile.seniority', values: ['staff'] },
        { key: 'age', values: ['45-54'], range: { min: 45, max: 54 } },
      ],
    },
    {
      label: 'Female + CXO + Age55-64',
      filters: [
        { key: 'profile.gender', values: ['Female'] },
        { key: 'businessProfile.seniority', values: ['cxo'] },
        { key: 'age', values: ['55-64'], range: { min: 55, max: 64 } },
      ],
    },
    {
      label: 'Male + Manager + HasChildren + Age35-44',
      filters: [
        { key: 'profile.gender', values: ['Male'] },
        { key: 'businessProfile.seniority', values: ['manager'] },
        { key: 'profile.children', values: ['Has children'] },
        { key: 'age', values: ['35-44'], range: { min: 35, max: 44 } },
      ],
    },
  ];

  // Enrichment filters to sweep on top
  const enrichmentFilters: Array<{ label: string; filter: FilterSpec }> = [
    { label: 'Credit 750-799', filter: { key: 'attributes.credit_rating', values: ['750 - 799'] } },
    { label: 'Income $100k-$149k', filter: { key: 'profile.incomeRange', values: ['$100,000 to $149,999'] } },
    { label: 'California', filter: { key: 'state', values: ['California'] } },
    { label: 'Education Bachelors', filter: { key: 'attributes.education', values: ["Bachelor's"] } },
    { label: 'NW $250k-$499k', filter: { key: 'profile.netWorth', values: ['$250,000 to $499,999'] } },
  ];

  const renterFilter: FilterSpec = { key: 'profile.homeowner', values: ['Renter'] };
  const homeownerFilter: FilterSpec = { key: 'profile.homeowner', values: ['Homeowner'] };

  for (const anchor of baseAnchors) {
    console.log(`\n${'='.repeat(70)}`);
    console.log(`  BASE: ${anchor.label}`);
    console.log(`${'='.repeat(70)}`);

    // Step 1: Base count (no homeowner)
    const baseCount = await preview(audienceId, `BASE: ${anchor.label}`, anchor.filters);
    console.log(`\n  Base (no homeowner):  ${baseCount >= 500000 ? '500k+ (CAPPED)' : baseCount.toLocaleString()}`);
    await sleep(2000);

    // Step 2: Add Renter
    const renterCount = await preview(audienceId, `RENTER: ${anchor.label}`, [...anchor.filters, renterFilter]);
    console.log(`  + Renter:            ${renterCount >= 500000 ? '500k+ (CAPPED)' : renterCount.toLocaleString()}`);
    await sleep(2000);

    // Step 3: Add Homeowner (control)
    const hoCount = await preview(audienceId, `HO: ${anchor.label}`, [...anchor.filters, homeownerFilter]);
    console.log(`  + Homeowner:         ${hoCount >= 500000 ? '500k+ (CAPPED)' : hoCount.toLocaleString()}`);
    await sleep(2000);

    if (renterCount <= 0) {
      console.log(`\n  ⚠️  Renter base is 0 — skipping enrichment sweep`);
      continue;
    }

    // Step 4: Sweep enrichment on Renter
    console.log(`\n  --- RENTER + Enrichment Filters ---`);
    for (const ef of enrichmentFilters) {
      const count = await preview(audienceId, `RENTER+${ef.label}`, [...anchor.filters, renterFilter, ef.filter]);
      const retention = renterCount > 0 ? (count / renterCount * 100).toFixed(1) : 'N/A';
      const countStr = count >= 500000 ? '500k+ (CAPPED)' : count.toLocaleString();
      console.log(`    + ${ef.label.padEnd(25)} => ${countStr.padStart(10)}  (${retention}% of Renter base)`);
      await sleep(2000);
    }

    // Step 5: Sweep enrichment on Homeowner (control)
    console.log(`\n  --- HOMEOWNER + Enrichment Filters (control) ---`);
    for (const ef of enrichmentFilters) {
      const count = await preview(audienceId, `HO+${ef.label}`, [...anchor.filters, homeownerFilter, ef.filter]);
      const retention = hoCount > 0 ? (count / hoCount * 100).toFixed(1) : 'N/A';
      const countStr = count >= 500000 ? '500k+ (CAPPED)' : count.toLocaleString();
      console.log(`    + ${ef.label.padEnd(25)} => ${countStr.padStart(10)}  (${retention}% of HO base)`);
      await sleep(2000);
    }
  }

  console.log('\n\nDone.');
}

main().catch(err => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
