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
  console.log(`  ${label.padEnd(55)} => ${typeof count === 'number' ? count.toLocaleString() : count}`);
}

async function main() {
  console.log('\n=== MINIMAL RENTER TESTS (2 filters max) ===\n');

  // Renter alone
  await preview('Renter only', [
    { key: 'profile.homeowner', values: ['Renter'] },
  ]);

  // Renter + one enrichment filter
  await preview('Renter + Credit 750-799', [
    { key: 'profile.homeowner', values: ['Renter'] },
    { key: 'attributes.credit_rating', values: ['750 - 799'] },
  ]);

  await preview('Renter + California', [
    { key: 'profile.homeowner', values: ['Renter'] },
    { key: 'state', values: ['California'] },
  ]);

  await preview('Renter + Income $100k-$149k', [
    { key: 'profile.homeowner', values: ['Renter'] },
    { key: 'profile.incomeRange', values: ['$100,000 to $149,999'] },
  ]);

  await preview('Renter + NW $250k-$499k', [
    { key: 'profile.homeowner', values: ['Renter'] },
    { key: 'profile.netWorth', values: ['$250,000 to $499,999'] },
  ]);

  await preview('Renter + Education Bachelors', [
    { key: 'profile.homeowner', values: ['Renter'] },
    { key: 'attributes.education', values: ["Bachelor's"] },
  ]);

  await preview('Renter + Male', [
    { key: 'profile.homeowner', values: ['Renter'] },
    { key: 'profile.gender', values: ['Male'] },
  ]);

  await preview('Renter + Age 35-44', [
    { key: 'profile.homeowner', values: ['Renter'] },
    { key: 'age', values: ['35-44'], range: { min: 35, max: 44 } },
  ]);

  console.log('\n=== HOMEOWNER CONTROLS (same filters) ===\n');

  await preview('Homeowner only', [
    { key: 'profile.homeowner', values: ['Homeowner'] },
  ]);

  await preview('Homeowner + Credit 750-799', [
    { key: 'profile.homeowner', values: ['Homeowner'] },
    { key: 'attributes.credit_rating', values: ['750 - 799'] },
  ]);

  await preview('Homeowner + California', [
    { key: 'profile.homeowner', values: ['Homeowner'] },
    { key: 'state', values: ['California'] },
  ]);

  await preview('Homeowner + Income $100k-$149k', [
    { key: 'profile.homeowner', values: ['Homeowner'] },
    { key: 'profile.incomeRange', values: ['$100,000 to $149,999'] },
  ]);

  await preview('Homeowner + Education Bachelors', [
    { key: 'profile.homeowner', values: ['Homeowner'] },
    { key: 'attributes.education', values: ["Bachelor's"] },
  ]);
}

main().catch(err => console.error('Error:', err.message));
