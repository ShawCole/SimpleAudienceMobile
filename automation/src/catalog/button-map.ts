import buttonMapJson from './button-map.json';
import { buttonRosterByKey } from './button-roster';
import { ButtonMapEntry, ButtonMapFile, ButtonRosterEntry } from '../types';

const mapData = buttonMapJson as ButtonMapFile;

export const buttonMap: ButtonMapFile = mapData;
export const buttonMapByKey = new Map<string, ButtonMapEntry>(
  mapData.entries.map(entry => [entry.buttonKey, entry])
);

export function getMappedButton(buttonKey: string): ButtonMapEntry | undefined {
  return buttonMapByKey.get(buttonKey);
}

export function getMissingButtons(): ButtonRosterEntry[] {
  const missing: ButtonRosterEntry[] = [];
  buttonRosterByKey.forEach(entry => {
    if (!buttonMapByKey.has(entry.buttonKey)) {
      missing.push(entry);
    }
  });
  return missing;
}

export function upsertButtonEntry(entry: ButtonMapEntry): void {
  const existingIndex = mapData.entries.findIndex(item => item.buttonKey === entry.buttonKey);
  if (existingIndex >= 0) {
    mapData.entries[existingIndex] = entry;
  } else {
    mapData.entries.push(entry);
  }
  buttonMapByKey.set(entry.buttonKey, entry);
}

