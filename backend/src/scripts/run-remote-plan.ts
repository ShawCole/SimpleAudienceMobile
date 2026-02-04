#!/usr/bin/env tsx
import process from 'process';
import { ProviderRemoteControl } from '../automation/remote-control';
import { TextToAudienceBrain } from '../brain';

function getPromptFromArgs(): { prompt: string; dryRun: boolean } {
  const args = process.argv.slice(2);
  let prompt = '';
  let dryRun = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--prompt' || arg === '-p') {
      prompt = args[i + 1] ?? '';
      i++;
    } else if (arg === '--dry-run') {
      dryRun = true;
    } else {
      prompt += (prompt ? ' ' : '') + arg;
    }
  }

  if (!prompt) {
    prompt = process.env.BRAIN_PROMPT ?? '';
  }

  if (!prompt) {
    throw new Error('Please provide a prompt via --prompt or BRAIN_PROMPT');
  }

  return { prompt, dryRun };
}

async function main() {
  const { prompt, dryRun } = getPromptFromArgs();
  const brain = new TextToAudienceBrain();
  const plan = brain.plan(prompt);

  console.log('\n🧠 Brain Output');
  console.log('Prompt:', plan.prompt);
  console.log('Detected intents:', plan.intents);
  if (plan.missingButtons.length) {
    console.warn('Missing button captures:', plan.missingButtons.join(', '));
  }

  if (!plan.intents.length) {
    console.warn('No executable intents detected. Exiting.');
    return;
  }

  const token = process.env.PROVIDER_API_TOKEN;
  const remote = new ProviderRemoteControl({
    baseUrl: process.env.PROVIDER_API_BASE_URL,
    defaultHeaders: token ? { Authorization: `Bearer ${token}` } : undefined,
    dryRun: dryRun || process.env.REMOTE_CONTROL_DRY_RUN === 'true',
  });

  const results = await remote.executePlan(plan.intents);
  console.log('\n📡 Remote Control Results');
  results.forEach(result => {
    console.log(`${result.buttonKey} -> ${result.success ? 'OK' : 'ERROR'}`, result);
  });
}

main().catch(error => {
  console.error('Failed to run remote plan', error);
  process.exitCode = 1;
});

