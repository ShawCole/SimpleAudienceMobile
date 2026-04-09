/**
 * orchestrate-explorer.mjs
 * Full pipeline orchestrator — chains all 6 modules end-to-end.
 *
 * Usage (CLI):
 *   node tools/orchestrate-explorer.mjs --url "https://example.com" --context "plumbing" --notify
 *   node tools/orchestrate-explorer.mjs --topics "Cat > Sub > Premade" --name "Client" --slug "client" --industry "Medical Practices"
 *   node tools/orchestrate-explorer.mjs --topics "Topic1" --topics "Topic2" --name "Client" --slug "client" --notify
 *
 * Usage (import):
 *   import { orchestrateExplorer } from './tools/orchestrate-explorer.mjs';
 *   await orchestrateExplorer({ url, name, slug, notify: true });
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';
import https from 'https';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// ════════════════════════════════════════════════════════
// LOGGING HELPERS
// log()  → human-readable to stderr
// emit() → machine-readable JSON line to stdout
// ════════════════════════════════════════════════════════

/**
 * Human-readable log to stderr.
 * @param {string} message
 */
function log(message) {
  process.stderr.write(`[orchestrate] ${message}\n`);
}

/**
 * Emit a machine-readable JSON line to stdout for SSE consumption.
 * @param {object} payload
 */
function emit(payload) {
  process.stdout.write(JSON.stringify(payload) + '\n');
}

// ════════════════════════════════════════════════════════
// TELEGRAM NOTIFICATION
// ════════════════════════════════════════════════════════

const TELEGRAM_CHAT_ID = '6046524812';

/**
 * Resolve the Telegram bot token from env or onboard-client.sh.
 * @returns {string|null}
 */
function resolveTelegramToken() {
  if (process.env.TELEGRAM_BOT_TOKEN) {
    return process.env.TELEGRAM_BOT_TOKEN;
  }

  const scriptPath = '/Users/ShawCole/scripts/agent-orchestra/onboard-client.sh';
  try {
    const content = fs.readFileSync(scriptPath, 'utf8');
    const match = content.match(/BOT_TOKEN\s*=\s*["']([^"']+)["']/);
    if (match) return match[1];
  } catch {
    // file not found or unreadable
  }

  return null;
}

/**
 * Send a Telegram message via the Bot API.
 * @param {string} message
 * @returns {Promise<void>}
 */
function sendTelegram(message) {
  return new Promise((resolve) => {
    const token = resolveTelegramToken();
    if (!token) {
      log('Warning: TELEGRAM_BOT_TOKEN not found — skipping notification');
      return resolve();
    }

    const body = JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text: message });
    const options = {
      hostname: 'api.telegram.org',
      path: `/bot${token}/sendMessage`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    };

    const req = https.request(options, (res) => {
      res.resume(); // drain
      log(`Telegram notification sent (HTTP ${res.statusCode})`);
      resolve();
    });

    req.on('error', (err) => {
      log(`Telegram notification failed: ${err.message}`);
      resolve(); // non-fatal
    });

    req.write(body);
    req.end();
  });
}

// ════════════════════════════════════════════════════════
// ARGUMENT PARSER
// ════════════════════════════════════════════════════════

/**
 * Parse process.argv into an options object.
 * Handles repeated flags (--topics can appear multiple times).
 * @param {string[]} argv
 * @returns {object}
 */
function parseArgs(argv) {
  const args = argv.slice(2);
  const opts = {
    url: null,
    context: null,
    transcript: null,
    name: null,
    slug: null,
    topics: [],
    industry: null,
    seniority: null,
    score: null,
    notify: false,
    b2b: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    switch (arg) {
      case '--url':        opts.url        = args[++i]; break;
      case '--context':   opts.context    = args[++i]; break;
      case '--transcript':opts.transcript = args[++i]; break;
      case '--name':      opts.name       = args[++i]; break;
      case '--slug':      opts.slug       = args[++i]; break;
      case '--topics':    opts.topics.push(args[++i]); break;
      case '--industry':  opts.industry   = args[++i]; break;
      case '--seniority': opts.seniority  = args[++i]; break;
      case '--score':     opts.score      = args[++i]; break;
      case '--notify':    opts.notify     = true; break;
      case '--b2b':       opts.b2b        = true; break;
      default:
        // Support --flag=value syntax
        const eqMatch = arg.match(/^--([^=]+)=(.+)$/);
        if (eqMatch) {
          const key = eqMatch[1].replace(/-([a-z])/g, (_, c) => c.toUpperCase());
          const val = eqMatch[2];
          if (key === 'topics') opts.topics.push(val);
          else if (key in opts) opts[key] = val;
        }
    }
  }

  return opts;
}

// ════════════════════════════════════════════════════════
// SLUG HELPERS
// ════════════════════════════════════════════════════════

/**
 * Convert a string to a URL-safe slug.
 * @param {string} str
 * @returns {string}
 */
function toSlug(str) {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9\-\s]/g, ' ')
    .replace(/\s+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '');
}

// ════════════════════════════════════════════════════════
// MAIN ORCHESTRATOR
// ════════════════════════════════════════════════════════

/**
 * Run the full Auto Explorer pipeline.
 *
 * @param {object} opts
 * @param {string} [opts.url]           - Business website URL (triggers ICP scraping)
 * @param {string} [opts.context]       - Extra context for ICP inference
 * @param {string} [opts.transcript]    - Voice transcript for ICP inference
 * @param {string} [opts.name]          - Business name (required if no url)
 * @param {string} [opts.slug]          - URL-safe slug (required if no url)
 * @param {string[]} [opts.topics]      - Explicit topic path(s)
 * @param {string} [opts.industry]      - Comma-separated industry filter
 * @param {string} [opts.seniority]     - Comma-separated seniority filter
 * @param {string} [opts.score]         - Comma-separated score filter (default: all three tiers)
 * @param {boolean} [opts.notify]       - Send Telegram notification on completion
 * @param {boolean} [opts.b2b]          - Set b2b flag on audiences
 * @returns {Promise<{ url: string, repoUrl: string, records: number, topics: string[] }>}
 */
export async function orchestrateExplorer(opts = {}) {
  const {
    url,
    context = '',
    transcript = '',
    name: nameOpt,
    slug: slugOpt,
    topics: topicsOpt = [],
    industry: industryOpt = null,
    seniority: seniorityOpt = null,
    score: scoreOpt = null,
    notify = false,
    b2b = false,
  } = opts;

  // ── Validate minimal inputs ────────────────────────────────────────────────
  if (!url && topicsOpt.length === 0) {
    throw new Error('Must provide either --url or at least one --topics path');
  }
  if (!url && !nameOpt) {
    throw new Error('--name is required when not using --url');
  }
  if (!url && !slugOpt) {
    throw new Error('--slug is required when not using --url');
  }

  // ── Derive slug for temp dir (may change after ICP phase) ─────────────────
  let businessName = nameOpt || '';
  let slug = slugOpt || '';

  // ── Temp dir ───────────────────────────────────────────────────────────────
  const timestamp = Date.now();
  const tempSlug = slug || 'pending';
  const tempDir = `/tmp/explorer-build-${tempSlug}-${timestamp}`;
  fs.mkdirSync(tempDir, { recursive: true });
  log(`Temp dir: ${tempDir}`);

  // ── Stage tracking ─────────────────────────────────────────────────────────
  let matchedTopics = []; // [{ path, label, slug, score }]
  let industries = industryOpt ? industryOpt.split(',').map(s => s.trim()) : [];
  let seniorities = seniorityOpt ? seniorityOpt.split(',').map(s => s.trim()) : [];
  let audienceTitle = `{topic} Audience`;
  let brandColor = '#2563EB';

  // ══════════════════════════════════════════════════════════════════════════
  // PHASE 1: ICP SCRAPING
  // ══════════════════════════════════════════════════════════════════════════

  if (url && topicsOpt.length === 0) {
    emit({ stage: 'scraping', message: 'Analyzing website...' });
    log('Phase 1: ICP scraping...');

    const { scrapeICP } = await import('./lib/scrape-icp.mjs');
    const icp = await scrapeICP({ url, context, transcript });

    log(`ICP result: confidence=${icp.confidence}, name="${icp.businessName}"`);

    if (icp.confidence < 0.7) {
      const output = {
        status: 'needs_confirmation',
        icp,
        message: `Low confidence (${icp.confidence.toFixed(2)}) — please confirm ICP before proceeding`,
      };
      emit(output);
      process.exitCode = 2;
      return output;
    }

    businessName = icp.businessName;
    slug = icp.slug;
    industries = icp.industries || [];
    seniorities = icp.seniority || [];
    audienceTitle = icp.audienceTitle || audienceTitle;
    brandColor = icp.brandColor || brandColor;

    // Use the ICP topic queries for topic matching in next phase
    opts._topicQueries = icp.topicQueries;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // PHASE 2: TOPIC MATCHING
  // ══════════════════════════════════════════════════════════════════════════

  if (topicsOpt.length > 0) {
    // Explicit topics provided — parse them directly as matched topics
    log(`Phase 2: Using ${topicsOpt.length} explicit topic path(s)`);
    matchedTopics = topicsOpt.map((topicPath) => {
      const parts = topicPath.split('>').map(s => s.trim());
      const label = parts[parts.length - 1] || topicPath;
      return {
        path: topicPath,
        label,
        slug: toSlug(label),
        score: 1.0,
      };
    });
  } else {
    // Topic queries from ICP — run semantic matching
    const topicQueries = opts._topicQueries || [];
    if (topicQueries.length === 0) {
      throw new Error('No topic queries available for matching — ICP may have returned empty topicQueries');
    }

    emit({ stage: 'matching', message: `Matching ${topicQueries.length} topic queries...` });
    log(`Phase 2: Topic matching for ${topicQueries.length} queries...`);

    const { matchTopics } = await import('./lib/match-topics.mjs');
    const matchResult = await matchTopics({ topicQueries });
    matchedTopics = matchResult.topics;

    log(`Matched ${matchedTopics.length} topics`);

    // Check for low-confidence matches
    const lowConfidence = matchedTopics.filter(t => t.score < 0.5);
    if (lowConfidence.length > 0) {
      const output = {
        status: 'needs_confirmation',
        topics: matchedTopics,
        message: `${lowConfidence.length} topic(s) have low confidence — please confirm before proceeding`,
        lowConfidenceTopics: lowConfidence.map(t => ({ path: t.path, label: t.label, score: t.score })),
      };
      emit(output);
      process.exitCode = 2;
      return output;
    }

    emit({ stage: 'matching', message: `Matched ${matchedTopics.length} topics` });
  }

  if (matchedTopics.length === 0) {
    throw new Error('No topics matched — cannot proceed');
  }

  log(`Topics: ${matchedTopics.map(t => t.label).join(', ')}`);

  // ══════════════════════════════════════════════════════════════════════════
  // PHASE 3: PULL AUDIENCES
  // ══════════════════════════════════════════════════════════════════════════

  // Determine tiers to pull
  const allTiers = ['high', 'medium', 'low'];
  const tiersToUse = scoreOpt
    ? scoreOpt.split(',').map(s => s.trim()).filter(s => allTiers.includes(s))
    : allTiers;

  const totalPulls = matchedTopics.length * tiersToUse.length;
  let pullsDone = 0;
  const csvResults = []; // [{ topicSlug, tier, csvPath }]

  const pullScript = path.join(__dirname, 'pull-audience.mjs');

  for (const topic of matchedTopics) {
    for (const tier of tiersToUse) {
      pullsDone++;
      const csvPath = path.join(tempDir, `${topic.slug}-${tier}.csv`);

      // Resume support: skip if CSV already exists
      if (fs.existsSync(csvPath)) {
        const size = fs.statSync(csvPath).size;
        if (size > 0) {
          log(`Resuming — ${topic.slug}-${tier}.csv already complete (${size} bytes)`);
          csvResults.push({ topicSlug: topic.slug, topicLabel: topic.label, tier, csvPath });
          continue;
        }
      }

      const audienceName = `${businessName} - ${topic.label} - ${tier} - SC`;
      emit({
        stage: 'pulling',
        message: `Pulling ${topic.label} (${tier})...`,
        progress: pullsDone,
        total: totalPulls,
      });
      log(`Pulling audience: "${audienceName}" [${pullsDone}/${totalPulls}]`);

      // Build pull-audience.mjs args
      const pullArgs = [
        pullScript,
        '--name', audienceName,
        '--topic', topic.path,
        '--score', tier,
        '--output', csvPath,
      ];

      if (industries.length > 0) {
        pullArgs.push('--industry', industries.join(','));
      }
      if (seniorities.length > 0) {
        pullArgs.push('--seniority', seniorities.join(','));
      }
      if (b2b) {
        pullArgs.push('--b2b');
      }

      try {
        log(`  Spawning: node ${pullArgs.slice(1).join(' ')}`);
        execFileSync('node', pullArgs, {
          stdio: ['ignore', 'inherit', 'inherit'],
          timeout: 300_000, // 5 min per pull
        });

        if (!fs.existsSync(csvPath) || fs.statSync(csvPath).size === 0) {
          log(`Warning: pull-audience produced no output for ${topic.slug}-${tier}`);
        } else {
          log(`CSV ready: ${csvPath} (${fs.statSync(csvPath).size} bytes)`);
          csvResults.push({ topicSlug: topic.slug, topicLabel: topic.label, tier, csvPath });
        }
      } catch (err) {
        log(`Error pulling ${topic.slug}-${tier}: ${err.message} — continuing`);
      }
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // PHASE 4: CONVERT CSVs TO DATASETS
  // ══════════════════════════════════════════════════════════════════════════

  emit({ stage: 'converting', message: 'Converting CSVs to datasets...' });
  log('Phase 4: Converting CSVs...');

  const { convertCsvToDataset, mergeDatasets } = await import('./lib/csv-to-dataset.mjs');

  const datasetsDir = path.join(tempDir, 'datasets');
  fs.mkdirSync(datasetsDir, { recursive: true });

  const datasetMeta = []; // [{ slug, label, jsonPath, recordCount }]
  let totalRecords = 0;

  for (const topic of matchedTopics) {
    const datasetJsonPath = path.join(datasetsDir, `${topic.slug}.json`);

    // Resume support
    if (fs.existsSync(datasetJsonPath)) {
      log(`Resuming — datasets/${topic.slug}.json already complete`);
      const existing = JSON.parse(fs.readFileSync(datasetJsonPath, 'utf8'));
      const count = Array.isArray(existing) ? existing.length : 0;
      totalRecords += count;
      datasetMeta.push({ slug: topic.slug, label: topic.label, jsonPath: datasetJsonPath, recordCount: count });
      continue;
    }

    const recordArrays = [];

    for (const tier of tiersToUse) {
      const csvPath = path.join(tempDir, `${topic.slug}-${tier}.csv`);
      if (!fs.existsSync(csvPath) || fs.statSync(csvPath).size === 0) {
        log(`Skipping convert for ${topic.slug}-${tier} (no CSV)`);
        continue;
      }

      try {
        log(`Converting ${topic.slug}-${tier}.csv...`);
        const records = convertCsvToDataset(csvPath, tier);
        log(`  → ${records.length} records`);
        recordArrays.push(records);
      } catch (err) {
        log(`Error converting ${topic.slug}-${tier}: ${err.message} — skipping`);
      }
    }

    if (recordArrays.length === 0) {
      log(`No records for topic "${topic.label}" — skipping dataset`);
      continue;
    }

    try {
      mergeDatasets(recordArrays, datasetJsonPath);
      const merged = JSON.parse(fs.readFileSync(datasetJsonPath, 'utf8'));
      const count = Array.isArray(merged) ? merged.length : 0;
      totalRecords += count;
      datasetMeta.push({ slug: topic.slug, label: topic.label, jsonPath: datasetJsonPath, recordCount: count });
      log(`Dataset: ${topic.slug}.json — ${count} records`);
    } catch (err) {
      log(`Error merging datasets for ${topic.slug}: ${err.message}`);
    }
  }

  if (datasetMeta.length === 0) {
    throw new Error('No datasets were produced — cannot scaffold or deploy');
  }

  // ══════════════════════════════════════════════════════════════════════════
  // PHASE 5: SCAFFOLD
  // ══════════════════════════════════════════════════════════════════════════

  const projectDir = path.join(tempDir, 'project');
  const configCheckPath = path.join(projectDir, 'public', 'config.json');

  emit({ stage: 'scaffolding', message: 'Building explorer project...' });
  log('Phase 5: Scaffolding explorer...');

  // Resume support
  if (fs.existsSync(configCheckPath)) {
    log('Resuming — project/public/config.json already complete');
  } else {
    const { scaffoldExplorer } = await import('./lib/scaffold-explorer.mjs');

    await scaffoldExplorer({
      slug,
      businessName,
      audienceTitle,
      datasets: datasetMeta.map(d => ({
        slug: d.slug,
        label: d.label,
        jsonPath: d.jsonPath,
      })),
      brandColor,
      outputDir: projectDir,
    });

    log(`Explorer scaffolded at: ${projectDir}`);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // PHASE 6: DEPLOY
  // ══════════════════════════════════════════════════════════════════════════

  emit({ stage: 'deploying', message: 'Deploying to Netlify...' });
  log('Phase 6: Deploying...');

  const { deployExplorer } = await import('./lib/deploy-explorer.mjs');
  const { url: deployedUrl, repoUrl } = await deployExplorer({ projectDir, slug });

  log(`Deployed: ${deployedUrl}`);
  log(`Repo: ${repoUrl}`);

  // ══════════════════════════════════════════════════════════════════════════
  // PHASE 7: NOTIFY + SUMMARY
  // ══════════════════════════════════════════════════════════════════════════

  const topicLabels = datasetMeta.map(d => d.label);

  const completionPayload = {
    stage: 'complete',
    url: deployedUrl,
    repoUrl,
    records: totalRecords,
    topics: topicLabels,
  };
  emit(completionPayload);

  if (notify) {
    const message =
      `Explorer deployed!\n\n${deployedUrl}\n\n${businessName} — ${totalRecords.toLocaleString()} records across ${datasetMeta.length} topic${datasetMeta.length !== 1 ? 's' : ''}`;
    await sendTelegram(message);
  }

  // Print human-readable summary to stderr
  log('');
  log('═══════════════════════════════════════════════');
  log(' EXPLORER PIPELINE COMPLETE');
  log('═══════════════════════════════════════════════');
  log(` Client:    ${businessName}`);
  log(` Slug:      ${slug}`);
  log(` URL:       ${deployedUrl}`);
  log(` Repo:      ${repoUrl}`);
  log(` Records:   ${totalRecords.toLocaleString()}`);
  log(` Topics:    ${topicLabels.join(', ')}`);
  log(` Temp dir:  ${tempDir}`);
  log('═══════════════════════════════════════════════');

  return {
    url: deployedUrl,
    repoUrl,
    records: totalRecords,
    topics: topicLabels,
    slug,
    businessName,
    tempDir,
  };
}

// ════════════════════════════════════════════════════════
// CLI ENTRYPOINT
// ════════════════════════════════════════════════════════

// Detect if running as CLI (not imported as module)
const isCLI = process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isCLI) {
  const opts = parseArgs(process.argv);

  log(`Starting orchestrate-explorer`);
  log(`  url:      ${opts.url || '(none)'}`);
  log(`  name:     ${opts.name || '(none)'}`);
  log(`  slug:     ${opts.slug || '(none)'}`);
  log(`  topics:   ${opts.topics.length > 0 ? opts.topics.join(', ') : '(none)'}`);
  log(`  industry: ${opts.industry || '(none)'}`);
  log(`  score:    ${opts.score || '(all tiers)'}`);
  log(`  notify:   ${opts.notify}`);
  log(`  b2b:      ${opts.b2b}`);

  orchestrateExplorer(opts).catch((err) => {
    log(`Fatal error: ${err.message}`);
    if (err.stack) log(err.stack);
    emit({ stage: 'error', message: err.message });
    process.exit(1);
  });
}
