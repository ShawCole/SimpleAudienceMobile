import { buildPayload, type FilterSpec, type TestCase } from './payload-factory';

const API_BASE = process.env.API_BASE || 'http://localhost:3001/api';
const AUDIENCE_ID = 'ee4b23bc-0705-434d-8861-c3a67ae2070f';

async function preview(label: string, filters: FilterSpec[]): Promise<void> {
  const testCase: TestCase = { id: label, phase: 'single', label, filters };
  const payload = buildPayload(testCase, AUDIENCE_ID);
  const res = await fetch(`${API_BASE}/audiences/preview`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  const count = data.data?.count ?? data.count ?? 'ERROR';
  console.log(`  ${label.padEnd(65)} => ${typeof count === 'number' ? count.toLocaleString() : count}`);
}

async function main() {
  console.log('\n=== RENTER: PROGRESSIVE FILTER STACKING ===\n');

  // 1 filter
  await preview('Renter', [
    { key: 'profile.homeowner', values: ['Renter'] },
  ]);

  // 2 filters
  await preview('Renter + Staff', [
    { key: 'profile.homeowner', values: ['Renter'] },
    { key: 'businessProfile.seniority', values: ['staff'] },
  ]);

  // 3 filters
  await preview('Renter + Staff + Married', [
    { key: 'profile.homeowner', values: ['Renter'] },
    { key: 'businessProfile.seniority', values: ['staff'] },
    { key: 'profile.married', values: ['Yes'] },
  ]);

  // 4 filters
  await preview('Renter + Staff + Married + HasChildren', [
    { key: 'profile.homeowner', values: ['Renter'] },
    { key: 'businessProfile.seniority', values: ['staff'] },
    { key: 'profile.married', values: ['Yes'] },
    { key: 'profile.children', values: ['Has children'] },
  ]);

  // 5 filters
  await preview('Renter + Staff + Married + HasChildren + Age55-64', [
    { key: 'profile.homeowner', values: ['Renter'] },
    { key: 'businessProfile.seniority', values: ['staff'] },
    { key: 'profile.married', values: ['Yes'] },
    { key: 'profile.children', values: ['Has children'] },
    { key: 'age', values: ['55-64'], range: { min: 55, max: 64 } },
  ]);

  // 5 filters + Credit (the "kill" test)
  await preview('Renter + Staff + Married + HasChildren + Age55-64 + Credit750', [
    { key: 'profile.homeowner', values: ['Renter'] },
    { key: 'businessProfile.seniority', values: ['staff'] },
    { key: 'profile.married', values: ['Yes'] },
    { key: 'profile.children', values: ['Has children'] },
    { key: 'age', values: ['55-64'], range: { min: 55, max: 64 } },
    { key: 'attributes.credit_rating', values: ['750 - 799'] },
  ]);

  console.log('\n=== HOMEOWNER: SAME PROGRESSIVE STACK ===\n');

  await preview('Homeowner', [
    { key: 'profile.homeowner', values: ['Homeowner'] },
  ]);

  await preview('Homeowner + Staff', [
    { key: 'profile.homeowner', values: ['Homeowner'] },
    { key: 'businessProfile.seniority', values: ['staff'] },
  ]);

  await preview('Homeowner + Staff + Married', [
    { key: 'profile.homeowner', values: ['Homeowner'] },
    { key: 'businessProfile.seniority', values: ['staff'] },
    { key: 'profile.married', values: ['Yes'] },
  ]);

  await preview('Homeowner + Staff + Married + HasChildren', [
    { key: 'profile.homeowner', values: ['Homeowner'] },
    { key: 'businessProfile.seniority', values: ['staff'] },
    { key: 'profile.married', values: ['Yes'] },
    { key: 'profile.children', values: ['Has children'] },
  ]);

  await preview('Homeowner + Staff + Married + HasChildren + Age55-64', [
    { key: 'profile.homeowner', values: ['Homeowner'] },
    { key: 'businessProfile.seniority', values: ['staff'] },
    { key: 'profile.married', values: ['Yes'] },
    { key: 'profile.children', values: ['Has children'] },
    { key: 'age', values: ['55-64'], range: { min: 55, max: 64 } },
  ]);

  await preview('Homeowner + Staff + Married + HasChildren + Age55-64 + Credit750', [
    { key: 'profile.homeowner', values: ['Homeowner'] },
    { key: 'businessProfile.seniority', values: ['staff'] },
    { key: 'profile.married', values: ['Yes'] },
    { key: 'profile.children', values: ['Has children'] },
    { key: 'age', values: ['55-64'], range: { min: 55, max: 64 } },
    { key: 'attributes.credit_rating', values: ['750 - 799'] },
  ]);

  // Also test Renter with just 3 consumer filters (no B2B)
  console.log('\n=== RENTER: CONSUMER-ONLY STACK ===\n');

  await preview('Renter + California + Credit750', [
    { key: 'profile.homeowner', values: ['Renter'] },
    { key: 'state', values: ['California'] },
    { key: 'attributes.credit_rating', values: ['750 - 799'] },
  ]);

  await preview('Renter + California + Credit750 + Income100k', [
    { key: 'profile.homeowner', values: ['Renter'] },
    { key: 'state', values: ['California'] },
    { key: 'attributes.credit_rating', values: ['750 - 799'] },
    { key: 'profile.incomeRange', values: ['$100,000 to $149,999'] },
  ]);

  await preview('Homeowner + California + Credit750 + Income100k (control)', [
    { key: 'profile.homeowner', values: ['Homeowner'] },
    { key: 'state', values: ['California'] },
    { key: 'attributes.credit_rating', values: ['750 - 799'] },
    { key: 'profile.incomeRange', values: ['$100,000 to $149,999'] },
  ]);
}

main().catch(err => console.error('Error:', err.message));
