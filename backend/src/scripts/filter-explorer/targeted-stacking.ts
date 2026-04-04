/**
 * Targeted Stacking Sweep — HO Manager, Director, VP + Renter VP/Director
 *
 * Fills the gap: we have stacking data for HO Staff and CXO, but Manager/Director/VP
 * are interpolated. This sweep measures them directly.
 *
 * Also measures Renter VP and Director to validate interpolation there.
 *
 * Usage:
 *   AUDIENCE_ID=<id> API_BASE=http://localhost:3001/api npx tsx backend/src/scripts/filter-explorer/targeted-stacking.ts
 */

import fs from 'fs';
import path from 'path';
import { buildPayload, type FilterSpec, type TestCase } from './payload-factory';
import { EXPLORER_CONFIG } from './config';
import { estimateAudienceSize } from '../../services/audience-estimator';

const API_BASE = process.env.API_BASE || 'http://localhost:3001/api';
const AUDIENCE_ID = process.env.AUDIENCE_ID || '';

async function api(apiPath: string, body?: any): Promise<any> {
  const url = `${API_BASE}${apiPath}`;
  const res = await fetch(url, {
    method: body ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`API ${apiPath} returned ${res.status}`);
  return res.json();
}

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

async function preview(label: string, filters: FilterSpec[]): Promise<number> {
  const tc: TestCase = { id: label, phase: 'single', label, filters };
  const payload = buildPayload(tc, AUDIENCE_ID);
  try {
    const result = await api('/audiences/preview', payload);
    return result.data?.count ?? result.count ?? -1;
  } catch (err: any) {
    console.log(`  ⚠️ ERROR: ${err.message.substring(0, 80)}`);
    return -1;
  }
}

interface Anchor {
  label: string;
  filters: FilterSpec[];
}

const ANCHORS: Anchor[] = [
  // HO — the 3 missing seniorities
  { label: 'HO:M+Mgr+35-44', filters: [
    { key: 'profile.gender', values: ['Male'] }, { key: 'profile.homeowner', values: ['Homeowner'] },
    { key: 'profile.married', values: ['No'] }, { key: 'businessProfile.seniority', values: ['manager'] },
    { key: 'age', values: ['35-44'], range: { min: 35, max: 44 } },
  ]},
  { label: 'HO:M+Dir+35-44', filters: [
    { key: 'profile.gender', values: ['Male'] }, { key: 'profile.homeowner', values: ['Homeowner'] },
    { key: 'profile.married', values: ['No'] }, { key: 'businessProfile.seniority', values: ['director'] },
    { key: 'age', values: ['35-44'], range: { min: 35, max: 44 } },
  ]},
  { label: 'HO:F+VP+45-54', filters: [
    { key: 'profile.gender', values: ['Female'] }, { key: 'profile.homeowner', values: ['Homeowner'] },
    { key: 'profile.married', values: ['No'] }, { key: 'businessProfile.seniority', values: ['vp'] },
    { key: 'age', values: ['45-54'], range: { min: 45, max: 54 } },
  ]},
  // Renter — VP and Director (have Staff, CXO, Manager already)
  { label: 'R:M+Dir+35-44', filters: [
    { key: 'profile.gender', values: ['Male'] }, { key: 'profile.homeowner', values: ['Renter'] },
    { key: 'profile.married', values: ['No'] }, { key: 'businessProfile.seniority', values: ['director'] },
    { key: 'age', values: ['35-44'], range: { min: 35, max: 44 } },
  ]},
  { label: 'R:F+VP+45-54', filters: [
    { key: 'profile.gender', values: ['Female'] }, { key: 'profile.homeowner', values: ['Renter'] },
    { key: 'profile.married', values: ['No'] }, { key: 'businessProfile.seniority', values: ['vp'] },
    { key: 'age', values: ['45-54'], range: { min: 45, max: 54 } },
  ]},
];

// Key combos — focus on the ones that showed biggest errors
const FILTERS: Record<string, FilterSpec> = {
  'Cr750': { key: 'attributes.credit_rating', values: ['750 - 799'] },
  'Cr650': { key: 'attributes.credit_rating', values: ['650 - 699'] },
  'Inc100k': { key: 'profile.incomeRange', values: ['$100,000 to $149,999'] },
  'Inc45k': { key: 'profile.incomeRange', values: ['$45,000 to $59,999'] },
  'NW500k': { key: 'profile.netWorth', values: ['$500,000 to $749,999'] },
  'EduBach': { key: 'attributes.education', values: ["Bachelor's"] },
  'CA': { key: 'state', values: ['California'] },
};

interface StackCombo { label: string; filters: string[]; }

const STACKS: StackCombo[] = [
  { label: 'Cr750+Inc100k', filters: ['Cr750', 'Inc100k'] },
  { label: 'Cr750+NW500k', filters: ['Cr750', 'NW500k'] },
  { label: 'Cr750+EduBach', filters: ['Cr750', 'EduBach'] },
  { label: 'Cr750+CA', filters: ['Cr750', 'CA'] },
  { label: 'Cr650+Inc45k', filters: ['Cr650', 'Inc45k'] },
  { label: 'Inc100k+NW500k', filters: ['Inc100k', 'NW500k'] },
  { label: 'Cr750+Inc100k+NW500k', filters: ['Cr750', 'Inc100k', 'NW500k'] },
  { label: 'Cr750+Inc100k+EduBach', filters: ['Cr750', 'Inc100k', 'EduBach'] },
  { label: 'Cr750+NW500k+CA', filters: ['Cr750', 'NW500k', 'CA'] },
];

async function main() {
  if (!AUDIENCE_ID) { console.error('AUDIENCE_ID required'); process.exit(1); }

  const dir = path.join(EXPLORER_CONFIG.dataDir, 'calibration');
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const outPath = path.join(dir, `stacking-validation-${ts}.ndjson`);
  const calPath = path.join(dir, 'stacking-corrections-calibrated.json');

  // Load existing calibrated corrections to append to
  let calData: any[] = [];
  try { calData = JSON.parse(fs.readFileSync(calPath, 'utf-8')); } catch {}

  let probeNum = 0;
  const totalProbes = ANCHORS.length * (1 + Object.keys(FILTERS).length + STACKS.length);
  console.log(`[targeted] ${ANCHORS.length} anchors × ${1 + Object.keys(FILTERS).length + STACKS.length} probes = ${totalProbes} total\n`);

  for (const anchor of ANCHORS) {
    console.log('═══════════════════════════════════════════════════════════');
    console.log(`  ANCHOR: ${anchor.label}`);
    console.log('═══════════════════════════════════════════════════════════');

    probeNum++;
    const baseCount = await preview(`base:${anchor.label}`, anchor.filters);
    if (baseCount <= 0) { console.log('  ⚠️ Bad base count, skipping'); continue; }
    console.log(`  [${probeNum}/${totalProbes}] Base: ${baseCount.toLocaleString()}`);
    await sleep(1500);

    // Singles
    const singleRet: Record<string, number> = {};
    for (const [name, filter] of Object.entries(FILTERS)) {
      probeNum++;
      const count = await preview(`single:${anchor.label}|${name}`, [...anchor.filters, filter]);
      singleRet[name] = count > 0 ? count / baseCount : 0;
      console.log(`  [${probeNum}/${totalProbes}] ${name}: ${count.toLocaleString()} (${(singleRet[name]*100).toFixed(1)}%)`);
      await sleep(1500);
    }

    // Stacks
    console.log('');
    for (const stack of STACKS) {
      probeNum++;
      const stackFilters = stack.filters.map(n => FILTERS[n]);
      const actual = await preview(`stack:${anchor.label}|${stack.label}`, [...anchor.filters, ...stackFilters]);

      let predicted = baseCount;
      for (const n of stack.filters) predicted *= singleRet[n];
      predicted = Math.round(predicted);

      const sweepCorrection = predicted > 0 ? actual / predicted : 0;

      // Also compute estimator-calibrated correction
      const est = estimateAudienceSize([...anchor.filters, ...stackFilters]);
      const estStacking = est.breakdown.stackingCorrection;
      const estRaw = estStacking !== 0 ? est.estimatedCount / estStacking : est.estimatedCount;
      const estNeededCorr = estRaw > 0 ? actual / estRaw : 0;

      const hoType = anchor.label.startsWith('HO:') ? 'HO' : 'Renter';
      const senMatch = anchor.label.match(/(Mgr|Dir|VP|Staff|CXO)/i);
      const seniority = senMatch ? senMatch[1].toLowerCase().replace('mgr','manager').replace('dir','director') : '';

      // Save to stacking validation file
      fs.appendFileSync(outPath, JSON.stringify({
        anchor: anchor.label, anchorCount: baseCount, combo: stack.label,
        tier: 'upper', filterCount: stack.filters.length,
        singleRetentions: Object.fromEntries(stack.filters.map(n => [n, singleRet[n]])),
        predictedCount: predicted, actualCount: actual,
        stackingCorrection: sweepCorrection, timestamp: new Date().toISOString(),
      }) + '\n');

      // Append to calibrated corrections
      if (estNeededCorr > 0) {
        calData.push({ hoType, combo: stack.label, seniority, anchor: anchor.label,
          actual, estimatorRaw: Math.round(estRaw), correction: Math.round(estNeededCorr * 1000) / 1000 });
      }

      const corrStr = sweepCorrection > 0 ? sweepCorrection.toFixed(2) + 'x' : 'N/A';
      const estErr = actual > 0 ? ((est.estimatedCount - actual) / actual * 100).toFixed(0) : 'N/A';
      console.log(`  [${probeNum}/${totalProbes}] ${stack.label.padEnd(25)} actual=${actual.toLocaleString().padStart(8)} pred=${predicted.toLocaleString().padStart(8)} corr=${corrStr.padStart(6)} estErr=${estErr}%`);
      await sleep(1500);
    }
    console.log('');
  }

  // Save updated calibrated corrections
  fs.writeFileSync(calPath, JSON.stringify(calData, null, 2));
  console.log(`\nResults: ${outPath}`);
  console.log(`Updated calibrated corrections: ${calData.length} entries`);
  console.log(`Total probes: ${probeNum}`);
}

main().catch(err => { console.error('Fatal:', err.message); process.exit(1); });
