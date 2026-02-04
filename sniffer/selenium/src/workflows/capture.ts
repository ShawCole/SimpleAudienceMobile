import path from 'node:path';
import fs from 'fs-extra';
import { createDriver } from '../services/browser.js';
import { BrowserSniffer } from '../services/sniffer.js';
import { ensureLoggedIn } from './login.js';
import { FILTERS } from '../config/filters.js';
import { logger } from '../utils/logger.js';
import { CaptureOptions, FilterDefinition, TraceFileSchema } from '../types.js';

const repoRoot = path.resolve(process.cwd(), '..', '..');
const rosterPath = path.join(repoRoot, 'automation', 'src', 'catalog', 'button-roster.json');

interface RosterEntry {
  buttonKey: string;
  label: string;
  section: string;
  type: string;
  path: string[];
  parentKey?: string;
}

async function loadRoster(): Promise<Map<string, RosterEntry>> {
  const map = new Map<string, RosterEntry>();
  try {
    const raw = await fs.readFile(rosterPath, 'utf-8');
    const json = JSON.parse(raw);
    for (const entry of json.entries as RosterEntry[]) {
      map.set(entry.buttonKey, entry);
    }
  } catch (error) {
    logger.warn('Unable to load button-roster.json. Labels in trace files will use button keys.');
  }
  return map;
}

function resolveFilters(options: CaptureOptions): FilterDefinition[] {
  if (options.all) {
    return FILTERS;
  }
  if (options.filter) {
    const match = FILTERS.find(f => f.buttonKey === options.filter);
    if (!match) {
      throw new Error(`Unknown filter ${options.filter}`);
    }
    return [match];
  }
  if (options.section) {
    const list = FILTERS.filter(f => f.section === options.section);
    if (!list.length) {
      throw new Error(`No filters configured for section ${options.section}`);
    }
    return list;
  }
  throw new Error('Provide --filter, --section, or --all');
}

export async function runCapture(options: CaptureOptions): Promise<void> {
  const driver = await createDriver();
  const sniffer = new BrowserSniffer(driver);
  const roster = await loadRoster();
  await sniffer.inject();

  try {
    await ensureLoggedIn(driver, { manual: options.manualLogin });

    const filters = resolveFilters(options);
    for (const filter of filters) {
      if (filter.skip) {
        logger.warn(`Skipping ${filter.buttonKey} (marked as skip).`);
        continue;
      }

      logger.info(`Capturing ${filter.buttonKey}...`);
      await sniffer.reset();
      await filter.run({ driver, sniffer });
      const entries = await sniffer.getEntries();
      if (!entries.length) {
        logger.warn(`No network entries recorded for ${filter.buttonKey}`);
        continue;
      }

      const rosterEntry = roster.get(filter.buttonKey);
      const trace: TraceFileSchema = {
        meta: {
          sessionId: `selenium-${filter.buttonKey}-${Date.now()}`,
          section: filter.section,
          capturedAt: new Date().toISOString(),
          operator: process.env.USER || 'selenium',
          environment: process.env.AUDLAB_ENV || 'prod',
          topLevelButton: rosterEntry?.parentKey,
        },
        events: entries.map(entry => ({
          buttonKey: filter.buttonKey,
          buttonLabel: rosterEntry?.label ?? filter.buttonKey,
          selectorHint: rosterEntry?.path?.join(' > '),
          network: entry,
        })),
      };

      const outputDir = path.resolve(repoRoot, options.outputDir);
      await fs.ensureDir(outputDir);
      const fileName = `${new Date().toISOString().replace(/[:]/g, '-')}-${filter.buttonKey}.json`;
      const filePath = path.join(outputDir, fileName);
      await fs.writeJson(filePath, trace, { spaces: 2 });
      logger.info(`Saved trace to ${filePath}`);
    }
  } finally {
    await driver.quit();
  }
}
