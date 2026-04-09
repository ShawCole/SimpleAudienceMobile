/**
 * scrape-icp.mjs
 * Fetches a business website and uses Claude API to infer their Ideal Customer Profile (ICP).
 *
 * Exports:
 *   scrapeICP({ url, context, transcript }) → ICP object
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import Anthropic from '@anthropic-ai/sdk';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ════════════════════════════════════════════════════════
// INDUSTRY TAXONOMY — parsed from filter-taxonomy.ts
// ════════════════════════════════════════════════════════

const TAXONOMY_PATH = path.join(__dirname, '..', '..', 'shared', 'taxonomy', 'filter-taxonomy.ts');

/**
 * Parse the Industries options from filter-taxonomy.ts.
 * Reads the raw TS file, extracts the "Industries" section JSON block,
 * and returns an array of label strings.
 * @returns {string[]}
 */
function loadIndustryTaxonomy() {
  const raw = fs.readFileSync(TAXONOMY_PATH, 'utf8');

  // Find the Industries block start
  const industriesStart = raw.indexOf('"Industries"');
  if (industriesStart === -1) {
    throw new Error('Could not find "Industries" section in filter-taxonomy.ts');
  }

  // Find the options array within the Industries block
  const optionsStart = raw.indexOf('"options"', industriesStart);
  if (optionsStart === -1) {
    throw new Error('Could not find "options" array for Industries in filter-taxonomy.ts');
  }

  // Find the opening bracket of the options array
  const arrayStart = raw.indexOf('[', optionsStart);
  if (arrayStart === -1) {
    throw new Error('Could not find start of Industries options array');
  }

  // Walk forward to find the matching closing bracket
  let depth = 0;
  let arrayEnd = -1;
  for (let i = arrayStart; i < raw.length; i++) {
    if (raw[i] === '[') depth++;
    else if (raw[i] === ']') {
      depth--;
      if (depth === 0) {
        arrayEnd = i;
        break;
      }
    }
  }

  if (arrayEnd === -1) {
    throw new Error('Could not find end of Industries options array');
  }

  const arrayJson = raw.slice(arrayStart, arrayEnd + 1);
  const options = JSON.parse(arrayJson);
  return options.map(opt => opt.label);
}

// ════════════════════════════════════════════════════════
// API KEY RESOLUTION
// Priority: env var ANTHROPIC_API_KEY → backend/.env ANTHROPIC_API_KEY → backend/.env CLAUDE_API_KEY
// ════════════════════════════════════════════════════════

function resolveApiKey() {
  // 1. Check process.env directly (set by shell or parent process)
  if (process.env.ANTHROPIC_API_KEY) {
    return process.env.ANTHROPIC_API_KEY;
  }

  // 2. Load from .env files
  const envPaths = [
    path.join(__dirname, '..', '..', 'backend', '.env'),
    path.join(__dirname, '..', '..', '.env'),
    path.join(__dirname, '..', '..', '..', 'ListMagic_Dev', 'server', '.env'),
  ];

  for (const envPath of envPaths) {
    if (!fs.existsSync(envPath)) continue;

    const lines = fs.readFileSync(envPath, 'utf8').split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('#') || !trimmed.includes('=')) continue;

      const eqIdx = trimmed.indexOf('=');
      const key = trimmed.slice(0, eqIdx).trim();
      const value = trimmed.slice(eqIdx + 1).trim();

      if (key === 'ANTHROPIC_API_KEY' && value) return value;
      if (key === 'CLAUDE_API_KEY' && value) return value;
    }
  }

  return null;
}

// ════════════════════════════════════════════════════════
// HTML → VISIBLE TEXT EXTRACTOR
// ════════════════════════════════════════════════════════

/**
 * Extract visible text from HTML. Prioritizes headings, meta description,
 * paragraphs, and list items. Strips all tags. Limits to ~4000 chars.
 * @param {string} html
 * @param {string} url
 * @returns {string}
 */
function extractVisibleText(html, url) {
  const chunks = [];

  // Extract meta description
  const metaMatch = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i)
    || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']description["']/i);
  if (metaMatch) {
    chunks.push(`[Meta Description] ${metaMatch[1]}`);
  }

  // Extract title
  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  if (titleMatch) {
    chunks.push(`[Title] ${titleMatch[1].trim()}`);
  }

  // Extract headings h1-h6
  const headingMatches = html.matchAll(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi);
  for (const m of headingMatches) {
    const text = m[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    if (text) chunks.push(`[H${m[1]}] ${text}`);
  }

  // Extract paragraphs
  const pMatches = html.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi);
  for (const m of pMatches) {
    const text = m[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    if (text && text.length > 20) chunks.push(text);
  }

  // Extract list items
  const liMatches = html.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi);
  for (const m of liMatches) {
    const text = m[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    if (text && text.length > 10) chunks.push(`• ${text}`);
  }

  // Fallback: strip all tags from body if chunks are sparse
  if (chunks.length < 5) {
    const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
    if (bodyMatch) {
      const stripped = bodyMatch[1]
        .replace(/<script[\s\S]*?<\/script>/gi, '')
        .replace(/<style[\s\S]*?<\/style>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      chunks.push(stripped);
    }
  }

  const combined = chunks.join('\n').slice(0, 4000);
  return combined || `[No readable content extracted from ${url}]`;
}

// ════════════════════════════════════════════════════════
// MAIN EXPORT
// ════════════════════════════════════════════════════════

/**
 * Fetch a business website and use Claude to infer their ICP.
 *
 * @param {Object} options
 * @param {string} options.url - Business website URL
 * @param {string} [options.context] - Optional short context from the caller
 * @param {string} [options.transcript] - Optional conversation transcript
 * @returns {Promise<{
 *   businessName: string,
 *   slug: string,
 *   industries: string[],
 *   seniority: string[],
 *   revenueRange: string,
 *   topicQueries: string[],
 *   audienceTitle: string,
 *   brandColor: string,
 *   confidence: number
 * }>}
 */
export async function scrapeICP({ url, context = '', transcript = '' }) {
  // --- 1. Load taxonomy ---
  const validIndustries = loadIndustryTaxonomy();

  // --- 2. Resolve API key ---
  const apiKey = resolveApiKey();
  if (!apiKey) {
    throw new Error(
      'ANTHROPIC_API_KEY not found. Set it in environment variables or backend/.env'
    );
  }

  // --- 3. Fetch website ---
  let websiteText = '';
  let fetchSuccess = false;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
          '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
      },
    });

    clearTimeout(timeout);

    if (response.ok) {
      const html = await response.text();
      websiteText = extractVisibleText(html, url);
      fetchSuccess = true;
    } else {
      websiteText = `[Fetch failed with HTTP ${response.status} for ${url}]`;
    }
  } catch (err) {
    if (err.name === 'AbortError') {
      websiteText = `[Fetch timed out after 10s for ${url}]`;
    } else {
      websiteText = `[Fetch error for ${url}: ${err.message}]`;
    }
  }

  // --- 4. Build Claude prompt ---
  const industryList = validIndustries.join('\n');
  const validSeniority = ['cxo', 'director', 'manager', 'staff', 'vp'];

  const systemPrompt = `You are an expert B2B audience strategist. Your task is to analyze a business website and infer their Ideal Customer Profile (ICP) — the type of companies and decision-makers they are trying to sell to.

WEBSITE URL: ${url}
${context ? `\nCALLER CONTEXT: ${context}` : ''}
${transcript ? `\nCONVERSATION TRANSCRIPT:\n${transcript}` : ''}

WEBSITE TEXT (extracted):
---
${websiteText}
---

VALID INDUSTRY VALUES (you MUST only use values from this exact list):
${industryList}

VALID SENIORITY VALUES (you MUST only use values from this exact list):
${validSeniority.join(', ')}

Based on the website content, infer who this business's customers are — what industries do their customers work in, what seniority levels buy their product/service, what company revenue range would buy from them, etc.

Return ONLY a valid JSON object with this exact structure (no markdown, no explanation, just JSON):
{
  "businessName": "Human-readable company name",
  "slug": "url-safe-slug-lowercase-hyphens",
  "industries": ["Industry Name 1", "Industry Name 2"],
  "seniority": ["cxo", "director"],
  "revenueRange": "1 Million to 50 Million",
  "topicQueries": [
    "natural language description of what their customers search for online",
    "another query their customers would use",
    "a third relevant search query"
  ],
  "audienceTitle": "Descriptive title with {topic} placeholder for the audience",
  "brandColor": "#hexcolor",
  "confidence": 0.85
}

CRITICAL RULES:
1. industries[] values MUST be exact matches from the VALID INDUSTRY VALUES list above. Do NOT invent industry names.
2. seniority[] values MUST be from: ${validSeniority.join(', ')}
3. topicQueries should have 2-5 entries — natural language phrases a prospect would type into Google
4. audienceTitle should include "{topic}" as a placeholder, e.g. "Marketing Leaders Researching {topic}"
5. brandColor should be a hex color extracted or inferred from the site (use #2563EB if unknown)
6. confidence: 0-1 score reflecting how much usable content was available (lower if site was down or minimal content)
7. revenueRange should use the format "X Million to Y Million" or "Under 1 Million" or "1 Billion and Over"
8. slug must be url-safe: lowercase, hyphens only, no spaces or special chars`;

  // --- 5. Call Claude API ---
  const client = new Anthropic({ apiKey });

  const message = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1024,
    messages: [
      {
        role: 'user',
        content: systemPrompt,
      },
    ],
  });

  // --- 6. Parse response ---
  const rawText = message.content[0]?.text || '';

  // Extract JSON from response (handle potential markdown fences)
  const jsonMatch = rawText.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error(`Claude did not return valid JSON. Raw response: ${rawText.slice(0, 300)}`);
  }

  let icp;
  try {
    icp = JSON.parse(jsonMatch[0]);
  } catch (parseErr) {
    throw new Error(`Failed to parse Claude's JSON response: ${parseErr.message}\nRaw: ${jsonMatch[0].slice(0, 300)}`);
  }

  // --- 7. Validate and sanitize ---
  const validIndustriesSet = new Set(validIndustries);

  // Strip invalid industries
  if (Array.isArray(icp.industries)) {
    const before = icp.industries.length;
    icp.industries = icp.industries.filter(ind => validIndustriesSet.has(ind));
    const stripped = before - icp.industries.length;
    if (stripped > 0) {
      console.warn(`[scrape-icp] Stripped ${stripped} invalid industry value(s) from Claude response`);
    }
  } else {
    icp.industries = [];
  }

  // Strip invalid seniority values
  const validSenioritySet = new Set(validSeniority);
  if (Array.isArray(icp.seniority)) {
    icp.seniority = icp.seniority.filter(s => validSenioritySet.has(s));
  } else {
    icp.seniority = [];
  }

  // Ensure required fields have defaults
  icp.businessName = icp.businessName || new URL(url).hostname.replace('www.', '');
  icp.slug = icp.slug || icp.businessName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  icp.revenueRange = icp.revenueRange || 'Under 1 Million';
  icp.topicQueries = Array.isArray(icp.topicQueries) ? icp.topicQueries.slice(0, 5) : [];
  icp.audienceTitle = icp.audienceTitle || `${icp.businessName} Prospects Researching {topic}`;
  icp.brandColor = /^#[0-9a-fA-F]{3,6}$/.test(icp.brandColor || '') ? icp.brandColor : '#2563EB';
  icp.confidence = typeof icp.confidence === 'number'
    ? Math.max(0, Math.min(1, icp.confidence))
    : fetchSuccess ? 0.6 : 0.3;

  // If site didn't load, lower confidence
  if (!fetchSuccess && icp.confidence > 0.4) {
    icp.confidence = Math.min(icp.confidence, 0.4);
  }

  return icp;
}
