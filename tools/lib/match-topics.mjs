/**
 * match-topics.mjs
 * Matches natural language topic queries to premade IntentCore topic paths.
 *
 * Exports:
 *   matchTopics({ topicQueries }) → { topics: [{ path, label, slug, score }] }
 *
 * Strategy:
 *   1. Pre-filter 19,350 topics to ~100 candidates using word overlap
 *   2. Send top 50 candidates to Claude Haiku for semantic selection
 *   3. Deduplicate (same path → keep highest score)
 *   4. Return exact paths from premade-topics.json — never fabricated
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import Anthropic from '@anthropic-ai/sdk';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');

// ────────────────────────────────────────────────────────────
// LOAD ENV
// Reads ANTHROPIC_API_KEY from process.env first, then backend/.env
// ────────────────────────────────────────────────────────────

function loadApiKey() {
  if (process.env.ANTHROPIC_API_KEY) {
    return process.env.ANTHROPIC_API_KEY;
  }

  const envPath = path.join(ROOT, 'backend', '.env');
  try {
    const envContent = fs.readFileSync(envPath, 'utf8');
    for (const line of envContent.split('\n')) {
      const match = line.match(/^ANTHROPIC_API_KEY\s*=\s*(.+)$/);
      if (match) return match[1].trim();
    }
  } catch {
    // .env not found — rely on process.env
  }

  return null;
}

// ────────────────────────────────────────────────────────────
// LOAD TOPIC CATALOG (cached in module scope)
// ────────────────────────────────────────────────────────────

const TOPICS_PATH = path.join(ROOT, 'shared', 'data', 'premade-topics.json');

/** @type {Array<{id:string, path:string, category:string, subcategory:string, premade:string, description:string, keywords:string, type:string}> | null} */
let topicCatalog = null;

function getTopicCatalog() {
  if (topicCatalog) return topicCatalog;

  console.log(`[match-topics] Loading topic catalog from ${TOPICS_PATH}`);
  const raw = fs.readFileSync(TOPICS_PATH, 'utf8');
  topicCatalog = JSON.parse(raw);
  console.log(`[match-topics] Loaded ${topicCatalog.length} topics`);
  return topicCatalog;
}

// ────────────────────────────────────────────────────────────
// TOKENIZATION
// ────────────────────────────────────────────────────────────

const STOP_WORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'for', 'of', 'in', 'on', 'at',
  'to', 'with', 'by', 'from', 'up', 'about', 'into', 'through', 'is',
  'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had',
  'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might',
  'this', 'that', 'these', 'those', 'it', 'its', 'they', 'their',
  'who', 'which', 'what', 'how', 'when', 'where', 'why', 'can',
  'looking', 'searching', 'seeking', 'finding', 'companies', 'businesses',
  'someone', 'people', 'users', 'customers', 'someone', 'anyone',
]);

/**
 * Tokenize a string into lowercase words, filtering stop words.
 * @param {string} text
 * @returns {string[]}
 */
function tokenize(text) {
  if (!text) return [];
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length >= 3 && !STOP_WORDS.has(w));
}

/**
 * Build a searchable text blob from a topic entry.
 * Combines category, subcategory, premade name, keywords.
 * @param {object} topic
 * @returns {string}
 */
function topicSearchText(topic) {
  return [
    topic.category || '',
    topic.subcategory || '',
    topic.premade || '',
    topic.keywords || '',
  ].join(' ').toLowerCase();
}

// ────────────────────────────────────────────────────────────
// PRE-FILTER: word overlap scoring
// ────────────────────────────────────────────────────────────

/**
 * Pre-filter topics to top N candidates by word overlap score.
 * @param {string} query
 * @param {object[]} catalog
 * @param {number} topN
 * @returns {{ topic: object, score: number }[]}
 */
function preFilterTopics(query, catalog, topN = 100) {
  const queryTokens = tokenize(query);

  if (queryTokens.length === 0) {
    // No meaningful tokens — return first topN as fallback
    return catalog.slice(0, topN).map(topic => ({ topic, score: 0 }));
  }

  const querySet = new Set(queryTokens);
  const scored = [];

  for (const topic of catalog) {
    const searchText = topicSearchText(topic);
    const topicTokens = tokenize(searchText);
    const topicSet = new Set(topicTokens);

    let overlap = 0;
    for (const word of querySet) {
      if (topicSet.has(word)) {
        overlap++;
      }
      // Partial match: topic text contains query word as substring
      else if (searchText.includes(word)) {
        overlap += 0.5;
      }
    }

    if (overlap > 0) {
      scored.push({ topic, score: overlap });
    }
  }

  // Sort by overlap descending, take top N
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topN);
}

// ────────────────────────────────────────────────────────────
// SLUG GENERATION
// ────────────────────────────────────────────────────────────

/**
 * Generate a URL-safe slug from a premade name.
 * e.g. "E-waste Management" → "e-waste-management"
 * @param {string} name
 * @returns {string}
 */
function toSlug(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\-\s]/g, ' ')  // keep hyphens, replace other non-alphanum
    .replace(/\s+/g, '-')             // spaces → hyphens
    .replace(/-{2,}/g, '-')           // collapse multiple hyphens
    .replace(/^-+|-+$/g, '');         // trim leading/trailing hyphens
}

// ────────────────────────────────────────────────────────────
// CLAUDE MATCHING
// ────────────────────────────────────────────────────────────

const MODEL = 'claude-haiku-4-5-20251001';
const LOW_CONFIDENCE_THRESHOLD = 0.3;
const MAX_CANDIDATES_TO_SEND = 50;

/**
 * Ask Claude to pick the best topic match from a candidate list.
 * @param {string} query
 * @param {{ topic: object, score: number }[]} candidates
 * @param {Anthropic} client
 * @returns {Promise<{ path: string, confidence: number } | null>}
 */
async function pickBestMatch(query, candidates, client) {
  const topCandidates = candidates.slice(0, MAX_CANDIDATES_TO_SEND);

  if (topCandidates.length === 0) {
    console.log(`[match-topics] No candidates found for query: "${query}"`);
    return null;
  }

  // Build compact candidate list for the prompt
  const candidateLines = topCandidates.map((c, i) =>
    `${i + 1}. PATH: "${c.topic.path}"\n   DESC: ${c.topic.description ? c.topic.description.slice(0, 120) + '...' : '(no description)'}`
  ).join('\n\n');

  const prompt = `Which of these premade intent topics best matches someone searching for: '${query}'?

CANDIDATES:
${candidateLines}

Return ONLY valid JSON with no markdown, no explanation, no code fences:
{"path": "<exact path from the list above>", "confidence": <0.0-1.0>}

Rules:
- The "path" field MUST be copied EXACTLY as shown in one of the candidates above
- "confidence" should reflect how well the topic matches the query intent (1.0 = perfect match, 0.0 = no match)
- If none match well, still pick the closest and set a low confidence score`;

  console.log(`[match-topics] Sending ${topCandidates.length} candidates to Claude for: "${query}"`);

  const message = await client.messages.create({
    model: MODEL,
    max_tokens: 256,
    messages: [{ role: 'user', content: prompt }],
  });

  const responseText = message.content[0]?.text || '';
  console.log(`[match-topics] Claude response for "${query}": ${responseText.trim()}`);

  // Parse JSON response — strip any accidental markdown fences
  const cleaned = responseText.trim().replace(/^```[a-z]*\n?/i, '').replace(/\n?```$/i, '').trim();
  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch (e) {
    // Try to extract JSON from the response
    const jsonMatch = cleaned.match(/\{[^}]+\}/s);
    if (jsonMatch) {
      try {
        parsed = JSON.parse(jsonMatch[0]);
      } catch {
        console.warn(`[match-topics] Failed to parse Claude response: ${responseText}`);
        return null;
      }
    } else {
      console.warn(`[match-topics] No JSON found in Claude response: ${responseText}`);
      return null;
    }
  }

  if (!parsed.path || typeof parsed.confidence !== 'number') {
    console.warn(`[match-topics] Invalid response shape: ${JSON.stringify(parsed)}`);
    return null;
  }

  // Validate that the returned path actually exists in the candidates
  const validPaths = new Set(topCandidates.map(c => c.topic.path));
  if (!validPaths.has(parsed.path)) {
    console.warn(`[match-topics] Claude returned a path NOT in candidates: "${parsed.path}" — finding closest match`);

    // Try to find the closest match by normalized comparison
    const normalizedReturn = parsed.path.toLowerCase().trim();
    for (const c of topCandidates) {
      if (c.topic.path.toLowerCase().trim() === normalizedReturn) {
        parsed.path = c.topic.path; // Correct casing/whitespace
        break;
      }
    }

    // If still not valid, fall back to top candidate
    if (!validPaths.has(parsed.path)) {
      console.warn(`[match-topics] Falling back to top candidate: "${topCandidates[0].topic.path}"`);
      parsed.path = topCandidates[0].topic.path;
      parsed.confidence = Math.min(parsed.confidence, 0.4); // Cap confidence on fallback
    }
  }

  return { path: parsed.path, confidence: parsed.confidence };
}

// ────────────────────────────────────────────────────────────
// PUBLIC API
// ────────────────────────────────────────────────────────────

/**
 * Match natural language topic queries to premade IntentCore topic paths.
 *
 * @param {{ topicQueries: string[] }} options
 * @returns {Promise<{ topics: Array<{ path: string, label: string, slug: string, score: number }> }>}
 */
export async function matchTopics({ topicQueries }) {
  if (!Array.isArray(topicQueries) || topicQueries.length === 0) {
    return { topics: [] };
  }

  console.log(`[match-topics] Processing ${topicQueries.length} topic queries`);

  // Load API key
  const apiKey = loadApiKey();
  if (!apiKey) {
    throw new Error(
      '[match-topics] ANTHROPIC_API_KEY not found in process.env or backend/.env'
    );
  }

  // Initialize Anthropic client
  const client = new Anthropic({ apiKey });

  // Load topic catalog
  const catalog = getTopicCatalog();

  // Build a path → topic lookup for fast retrieval
  const pathToTopic = new Map(catalog.map(t => [t.path, t]));

  // Process each query
  /** @type {Map<string, { path: string, label: string, slug: string, score: number }>} */
  const bestByPath = new Map();

  for (const query of topicQueries) {
    const trimmedQuery = (query || '').trim();
    if (!trimmedQuery) {
      console.log(`[match-topics] Skipping empty query`);
      continue;
    }

    console.log(`\n[match-topics] ── Query: "${trimmedQuery}"`);

    // Step 1: Pre-filter to top candidates by word overlap
    const candidates = preFilterTopics(trimmedQuery, catalog, 100);
    console.log(`[match-topics] Pre-filter found ${candidates.length} candidates`);

    if (candidates.length === 0) {
      console.log(`[match-topics] No candidates for "${trimmedQuery}" — skipping`);
      continue;
    }

    // Step 2: Ask Claude to pick the best match
    let result;
    try {
      result = await pickBestMatch(trimmedQuery, candidates, client);
    } catch (err) {
      console.error(`[match-topics] Claude API error for "${trimmedQuery}": ${err.message}`);
      // Fallback: use top pre-filter candidate with low confidence
      const fallbackTopic = candidates[0].topic;
      result = { path: fallbackTopic.path, confidence: 0.2 };
      console.log(`[match-topics] Using pre-filter fallback: "${result.path}"`);
    }

    if (!result) continue;

    const { path: matchedPath, confidence } = result;

    if (confidence < LOW_CONFIDENCE_THRESHOLD) {
      console.log(`[match-topics] Low confidence (${confidence.toFixed(2)}) for "${trimmedQuery}" → "${matchedPath}"`);
    } else {
      console.log(`[match-topics] Matched "${trimmedQuery}" → "${matchedPath}" (confidence: ${confidence.toFixed(2)})`);
    }

    // Step 3: Deduplicate — if same path matched before, keep higher confidence
    const existing = bestByPath.get(matchedPath);
    if (!existing || confidence > existing.score) {
      const topic = pathToTopic.get(matchedPath);
      if (!topic) {
        console.warn(`[match-topics] Matched path not found in catalog (should not happen): "${matchedPath}"`);
        continue;
      }

      bestByPath.set(matchedPath, {
        path: matchedPath,
        label: topic.premade,
        slug: toSlug(topic.premade),
        score: confidence,
      });
    } else {
      console.log(`[match-topics] Dedup: keeping existing higher-confidence entry for "${matchedPath}"`);
    }
  }

  const topics = Array.from(bestByPath.values());

  // Sort by score descending
  topics.sort((a, b) => b.score - a.score);

  console.log(`\n[match-topics] Done. Returning ${topics.length} matched topics.`);

  return { topics };
}
