import { buildPayload, type FilterSpec, type TestCase } from './payload-factory';

const AID = process.env.AUDIENCE_ID || 'fdefd63d-7add-4381-980d-8d3b24ab3251';

async function test(label: string, nwValue: string) {
  const filters: FilterSpec[] = [{ key: 'profile.netWorth', values: [nwValue] }];
  const tc: TestCase = { id: label, phase: 'single', label, filters };
  const payload = buildPayload(tc, AID);
  console.log(label, '→ payload netWorth:', JSON.stringify(payload.filters.filters.profile.netWorth));

  const r = await fetch('http://localhost:3001/api/audiences/preview', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await r.json() as any;
  const count = data.data?.count ?? data.count ?? 'ERROR';
  console.log(label, '→ status:', r.status, 'count:', count);
  if (!r.ok) console.log(label, '→ error:', JSON.stringify(data).substring(0, 300));
}

async function testRaw(label: string, nwValues: string[]) {
  const payload = buildPayload(
    { id: label, phase: 'single', label, filters: [] },
    AID
  );
  // Override netWorth directly to test different formats
  (payload.filters.filters.profile as any).netWorth = nwValues;
  console.log(label, '→ raw netWorth:', JSON.stringify(nwValues));

  const r = await fetch('http://localhost:3001/api/audiences/preview', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await r.json() as any;
  const count = data.data?.count ?? data.count ?? 'ERROR';
  console.log(label, '→ status:', r.status, 'count:', count);
  if (!r.ok) console.log(label, '→ error:', JSON.stringify(data).substring(0, 300));
}

async function main() {
  // Control: credit should work
  await test('Credit-750', '$750,000 to $999,999');
  // Wait — that's NW not credit. Let me test credit first as control
  const creditFilters: FilterSpec[] = [{ key: 'attributes.credit_rating', values: ['750 - 799'] }];
  const creditTc: TestCase = { id: 'credit-control', phase: 'single', label: 'credit-control', filters: creditFilters };
  const creditPayload = buildPayload(creditTc, AID);
  const cr = await fetch('http://localhost:3001/api/audiences/preview', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(creditPayload),
  });
  const cd = await cr.json() as any;
  console.log('Credit control → status:', cr.status, 'count:', cd.data?.count ?? cd.count ?? 'ERROR');

  await new Promise(r => setTimeout(r, 2000));

  // Test NW with double-dollar (current behavior)
  await testRaw('NW-dd-750k', ['$$750,000 to $999,999']);
  await new Promise(r => setTimeout(r, 2000));

  // Test NW with single-dollar
  await testRaw('NW-sd-750k', ['$750,000 to $999,999']);
  await new Promise(r => setTimeout(r, 2000));

  // Test NW with double-dollar on both
  await testRaw('NW-dd-both-750k', ['$$750,000 to $$999,999']);
  await new Promise(r => setTimeout(r, 2000));

  // Test NW lowercase
  await testRaw('NW-lower-750k', ['$$750,000 to $$999,999']);
}

main().catch(e => console.error(e));
