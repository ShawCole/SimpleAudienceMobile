#!/usr/bin/env tsx
import { TextToAudienceBrain } from '../brain';
import { ProviderRemoteControl } from '../automation/remote-control';
import { buttonMap } from '@simpleaudience/automation';

async function main() {
  const prompt = 'Insurance agencies in California with verified emails';
  const brain = new TextToAudienceBrain();
  const plan = brain.plan(prompt);
  if (!plan.intents.length) {
    throw new Error('Smoke test failed: brain did not emit any executable intents.');
  }

  const remote = new ProviderRemoteControl({ catalog: buttonMap, dryRun: true });
  const results = await remote.executePlan(plan.intents);

  const failed = results.filter(result => !result.success);
  if (failed.length) {
    throw new Error(`Smoke test failed for buttons: ${failed.map(item => item.buttonKey).join(', ')}`);
  }

  console.log('✅ Trace → Catalog → Remote replay smoke test passed');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

