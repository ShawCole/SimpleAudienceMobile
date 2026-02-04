import rosterJson from './button-roster.json';
import { ButtonRosterEntry, ButtonRosterFile } from '../types';

const rosterData = rosterJson as ButtonRosterFile;

if (!Array.isArray(rosterData.entries)) {
  throw new Error('button-roster.json is missing the entries array');
}

export const buttonRoster: ButtonRosterFile = rosterData;
export const buttonRosterByKey = new Map<string, ButtonRosterEntry>(
  rosterData.entries.map(entry => [entry.buttonKey, entry])
);

export function getButton(buttonKey: string): ButtonRosterEntry | undefined {
  return buttonRosterByKey.get(buttonKey);
}

export function listSection(section: string): ButtonRosterEntry[] {
  return rosterData.entries.filter(entry => entry.section === section);
}

export function missingParents(): ButtonRosterEntry[] {
  return rosterData.entries.filter(entry => entry.parentKey && !buttonRosterByKey.has(entry.parentKey));
}

export function pendingButtons(): ButtonRosterEntry[] {
  return rosterData.entries.filter(entry => entry.captureStatus !== 'captured');
}

