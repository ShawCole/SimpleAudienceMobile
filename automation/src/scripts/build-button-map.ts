import { promises as fs } from 'fs';
import path from 'path';
import { z } from 'zod';
import {
  ButtonMapEntry,
  ButtonMapFile,
  ButtonRosterEntry,
  ButtonRosterFile,
  TraceSession,
} from '../types';

const traceSessionSchema = z.object({
  meta: z.object({
    sessionId: z.string(),
    section: z.string(),
    capturedAt: z.string(),
    operator: z.string().optional(),
    environment: z.string().optional(),
    topLevelButton: z.string().optional(),
  }),
  events: z.array(
    z.object({
      buttonKey: z.string(),
      buttonLabel: z.string(),
      selectorHint: z.string().optional(),
      notes: z.string().optional(),
      network: z.object({
        type: z.union([z.literal('FETCH'), z.literal('XHR')]),
        url: z.string(),
        method: z.string(),
        payload: z.any(),
        response: z.any(),
        headers: z.record(z.string()).optional(),
        status: z.number().optional(),
        timestamp: z.string(),
      }),
    })
  ),
});

const rootDir = path.resolve(__dirname, '../../..');
const rosterPath = path.join(rootDir, 'automation', 'src', 'catalog', 'button-roster.json');
const mapPath = path.join(rootDir, 'automation', 'src', 'catalog', 'button-map.json');
const tracesDir = path.join(rootDir, 'docs', 'provider-traces');

async function loadJson<T>(filePath: string): Promise<T> {
  const data = await fs.readFile(filePath, 'utf-8');
  return JSON.parse(data) as T;
}

async function listTraceFiles(): Promise<string[]> {
  const entries = await fs.readdir(tracesDir);
  return entries
    .filter(file => file.endsWith('.json'))
    .map(file => path.join(tracesDir, file));
}

async function buildButtonMap() {
  const roster = (await loadJson<ButtonRosterFile>(rosterPath)).entries;
  const rosterLookup = new Map<string, ButtonRosterEntry>();
  roster.forEach(entry => rosterLookup.set(entry.buttonKey, entry));

  const traceFiles = await listTraceFiles();

  const aggregated: Map<string, ButtonMapEntry> = new Map();

  for (const traceFile of traceFiles) {
    const fileContents = await loadJson<TraceSession>(traceFile);
    const session = traceSessionSchema.parse(fileContents);

    session.events.forEach((event, index) => {
      const rosterEntry = rosterLookup.get(event.buttonKey);
      if (!rosterEntry) {
        return;
      }

      const entry: ButtonMapEntry = {
        buttonKey: rosterEntry.buttonKey,
        label: rosterEntry.label,
        section: rosterEntry.section,
        type: rosterEntry.type,
        selectorHint: event.selectorHint ?? rosterEntry.selectorHint,
        prerequisites: rosterEntry.prerequisites,
        lastCapturedAt: event.network.timestamp,
        requestTemplate: {
          method: event.network.method,
          url: event.network.url,
          headers: event.network.headers ?? {},
          body: event.network.payload,
        },
        trace: {
          sessionId: session.meta.sessionId,
          file: path.relative(rootDir, traceFile),
          eventIndex: index,
        },
        responses: [
          {
            status: event.network.status,
            bodySample: event.network.response,
          },
        ],
        notes: event.notes ?? rosterEntry.notes,
      };

      aggregated.set(rosterEntry.buttonKey, entry);
    });
  }

  const buttonMapFile: ButtonMapFile = {
    version: 1,
    generatedAt: new Date().toISOString(),
    entries: Array.from(aggregated.values()).sort((a, b) => a.buttonKey.localeCompare(b.buttonKey)),
  };

  await fs.writeFile(mapPath, JSON.stringify(buttonMapFile, null, 2) + '\n', 'utf-8');

  console.log(
    `Button map updated with ${buttonMapFile.entries.length} entries from ${traceFiles.length} trace file(s).`
  );
}

buildButtonMap().catch(error => {
  console.error('Failed to build button map', error);
  process.exitCode = 1;
});

