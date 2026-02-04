import {
  ButtonIntent,
  buttonMapByKey,
} from '@simpleaudience/automation';

export interface BrainPlan {
  prompt: string;
  intents: ButtonIntent[];
  missingButtons: string[];
  notes: string[];
}

const STATE_ALIASES: Record<string, string> = {
  california: 'CA',
  ca: 'CA',
  texas: 'TX',
  tx: 'TX',
  florida: 'FL',
  fl: 'FL',
  newyork: 'NY',
  ny: 'NY',
  illinois: 'IL',
  il: 'IL',
  washington: 'WA',
  wa: 'WA',
  colorado: 'CO',
  co: 'CO',
};

const B2B_KEYWORDS = ['b2b', 'business', 'company', 'enterprise'];
const B2C_KEYWORDS = ['b2c', 'consumer', 'household', 'individual'];

function extractStates(prompt: string): string[] {
  const normalized = prompt.toLowerCase().replace(/[^a-z0-9\s]/g, '');
  const tokens = normalized.split(/\s+/);
  const matches = new Set<string>();
  tokens.forEach(token => {
    const alias = STATE_ALIASES[token as keyof typeof STATE_ALIASES];
    if (alias) {
      matches.add(alias);
    }
  });
  return Array.from(matches);
}

function containsKeyword(prompt: string, keywords: string[]): boolean {
  const lower = prompt.toLowerCase();
  return keywords.some(keyword => lower.includes(keyword));
}

export class TextToAudienceBrain {
  plan(prompt: string): BrainPlan {
    const intents: ButtonIntent[] = [];
    const missingButtons: string[] = [];
    const notes: string[] = [];

    const states = extractStates(prompt);
    if (states.length) {
      this.pushIntent(intents, missingButtons, {
        buttonKey: 'location.states',
        description: `Target states ${states.join(', ')}`,
        payloadOverrides: { query: states[0] },
      });
      notes.push(`Detected states: ${states.join(', ')}`);
    }

    if (containsKeyword(prompt, B2B_KEYWORDS)) {
      this.pushIntent(intents, missingButtons, {
        buttonKey: 'intent.audience_type',
        description: 'Prefer B2B audience type',
        payloadOverrides: { mode: 'b2b' },
      });
      notes.push('Detected B2B intent keyword');
    } else if (containsKeyword(prompt, B2C_KEYWORDS)) {
      this.pushIntent(intents, missingButtons, {
        buttonKey: 'intent.audience_type',
        description: 'Prefer B2C audience type',
        payloadOverrides: { mode: 'b2c' },
      });
      notes.push('Detected B2C intent keyword');
    }

    return {
      prompt,
      intents,
      missingButtons,
      notes,
    };
  }

  private pushIntent(intents: ButtonIntent[], missing: string[], intent: ButtonIntent): void {
    if (!buttonMapByKey.has(intent.buttonKey)) {
      missing.push(intent.buttonKey);
      return;
    }
    intents.push(intent);
  }
}

