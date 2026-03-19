/**
 * Quick test: HWNI CXOs at 1-5M revenue companies
 */
import dotenv from 'dotenv';
dotenv.config({ path: new URL('../../.env', import.meta.url).pathname });

import { VacuumEngine } from '../automation/vacuum';
import { buildPayload } from './filter-explorer/payload-factory';
import type { TestCase } from './filter-explorer/payload-factory';

const testCase: TestCase = {
  id: 'manual:hwni-cxo-1to5m',
  phase: 'single',
  label: 'HWNI CXOs at 1-5M revenue companies',
  filters: [
    {
      key: 'profile.netWorth',
      values: ['$500,000 to $749,999', '$750,000 to $999,999', 'More Than $1,000,000'],
    },
    {
      key: 'businessProfile.seniority',
      values: ['cxo'],
    },
    {
      key: 'businessProfile.companyRevenue',
      values: ['1 Million to 5 Million'],
    },
  ],
};

async function main() {
  const payload = buildPayload(testCase, '');

  console.log('=== PAYLOAD CHECK ===');
  console.log('seniority:', payload.filters.filters.businessProfile.seniority);
  console.log('companyRevenue:', payload.filters.filters.businessProfile.companyRevenue);
  console.log('netWorth (profile):', payload.filters.filters.profile.netWorth);
  console.log();
  console.log('Running Preview: HWNI CXOs at 1-5M revenue companies...');
  console.log();

  const start = Date.now();
  const result = await VacuumEngine.preview(payload);
  const ms = Date.now() - start;

  console.log('Success:', result.success);
  console.log('Count:', result.data?.count?.toLocaleString() || 'N/A');
  console.log('Duration:', ms + 'ms');

  if (result.error) {
    console.log('Error:', result.error);
  }

  if (result.raw) {
    const countMatch = result.raw.match(/"(?:count|total|totalCount)":(\d+)/);
    console.log('Raw count regex match:', countMatch ? countMatch[1] : 'NONE');
    console.log('Raw response (first 500):', result.raw.substring(0, 500));
  }

  process.exit(0);
}

main().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
