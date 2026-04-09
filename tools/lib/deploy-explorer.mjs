/**
 * deploy-explorer.mjs
 * Takes a scaffolded explorer project, builds it, pushes to GitHub, and deploys to Netlify.
 *
 * Exports:
 *   deployExplorer({ projectDir, slug }) → { url: string, repoUrl: string }
 *
 * Security note: execSync is used intentionally here because the commands rely on shell
 * features (npx, PATH resolution for gh/git, piped output capture). All user-controlled
 * inputs (slug, projectDir) are validated/sanitised before being interpolated into any
 * command string. This module is internal tooling only — not exposed to web requests.
 */

import { execSync } from 'child_process';
import path from 'path';

// ════════════════════════════════════════════════════════
// INPUT VALIDATION
// slug must be a safe identifier — letters, digits, hyphens only.
// projectDir must be an absolute path.
// Both are validated before any shell interpolation.
// ════════════════════════════════════════════════════════

const SAFE_SLUG_RE = /^[a-z0-9][a-z0-9-]*[a-z0-9]$/;

/**
 * Validate inputs early to prevent any accidental shell injection.
 * @param {string} slug
 * @param {string} projectDir
 */
function validateInputs(slug, projectDir) {
  if (!SAFE_SLUG_RE.test(slug)) {
    throw new Error(
      `Invalid slug "${slug}". Must match /^[a-z0-9][a-z0-9-]*[a-z0-9]$/ (lowercase, hyphens only).`
    );
  }
  if (!path.isAbsolute(projectDir)) {
    throw new Error(`projectDir must be an absolute path. Got: "${projectDir}"`);
  }
}

// ════════════════════════════════════════════════════════
// LOGGING
// ════════════════════════════════════════════════════════

/**
 * Log a deploy step with a timestamp prefix.
 * @param {string} message
 */
function log(message) {
  const ts = new Date().toISOString();
  console.log(`[deploy] [${ts}] ${message}`);
}

// ════════════════════════════════════════════════════════
// EXEC HELPER
// Wraps execSync with shared options (cwd, env, encoding)
// and surfaces stdout/stderr in thrown errors.
// ════════════════════════════════════════════════════════

/**
 * Run a shell command synchronously in projectDir.
 *
 * @param {string} cmd - Command string to execute
 * @param {object} opts
 * @param {string} opts.cwd - Working directory
 * @param {Record<string, string>} [opts.env] - Extra env vars merged into process.env
 * @param {number} [opts.timeout] - Timeout in ms (default: 60_000)
 * @param {boolean} [opts.fatal=true] - If false, errors are caught and returned instead of thrown
 * @returns {{ stdout: string, stderr: string, error: Error|null }}
 */
function run(cmd, { cwd, env = {}, timeout = 60_000, fatal = true } = {}) {
  log(`  $ ${cmd}`);
  const mergedEnv = { ...process.env, ...env };
  try {
    const stdout = execSync(cmd, {
      cwd,
      env: mergedEnv,
      timeout,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const out = typeof stdout === 'string' ? stdout.trim() : '';
    if (out) log(`  stdout: ${out.slice(0, 500)}${out.length > 500 ? '...' : ''}`);
    return { stdout: out, stderr: '', error: null };
  } catch (err) {
    const stderr = err.stderr ? err.stderr.toString().trim() : '';
    const stdout = err.stdout ? err.stdout.toString().trim() : '';
    const combined = [stdout, stderr].filter(Boolean).join('\n');
    if (fatal) {
      const fatErr = new Error(`Command failed: ${cmd}\n${combined}`);
      fatErr.stdout = stdout;
      fatErr.stderr = stderr;
      throw fatErr;
    }
    if (combined) log(`  (non-fatal) ${combined.slice(0, 500)}`);
    return { stdout, stderr, error: err };
  }
}

// ════════════════════════════════════════════════════════
// GIT AUTHOR ENV
// ════════════════════════════════════════════════════════

const GIT_ENV = {
  GIT_AUTHOR_NAME: 'Shaw Cole',
  GIT_AUTHOR_EMAIL: 'shaw@strategysimple.com',
  GIT_COMMITTER_NAME: 'Shaw Cole',
  GIT_COMMITTER_EMAIL: 'shaw@strategysimple.com',
};

// ════════════════════════════════════════════════════════
// PUBLIC API
// ════════════════════════════════════════════════════════

/**
 * Build, push to GitHub, and deploy to Netlify.
 *
 * Steps:
 *   1. npm install
 *   2. npm run build  (tsc -b && vite build → dist/)
 *   3. git init + checkout -b main
 *   4. git add -A + commit
 *   5. gh repo create (or remote add + push if already exists)
 *   6. netlify-cli sites:create (skip if already exists)
 *   7. netlify-cli deploy --prod --dir=dist
 *
 * @param {object} params
 * @param {string} params.projectDir - Absolute path to the scaffolded explorer project
 * @param {string} params.slug       - Short identifier, e.g. "dental-cancun"
 * @returns {Promise<{ url: string, repoUrl: string }>}
 */
export async function deployExplorer({ projectDir, slug }) {
  // Validate before any shell usage
  validateInputs(slug, projectDir);

  const repoName = `${slug}-explorer`;
  const repoUrl = `https://github.com/ShawCole/${repoName}`;
  const siteUrl = `https://${repoName}.netlify.app`;

  log(`Starting deploy for slug="${slug}" in ${projectDir}`);

  // ── Step 1: npm install ────────────────────────────────
  log('npm install...');
  run('npm install', { cwd: projectDir, timeout: 120_000 });
  log('npm install complete.');

  // ── Step 2: npm run build ──────────────────────────────
  log('Building (tsc -b && vite build)...');
  run('npm run build', { cwd: projectDir, timeout: 60_000 });
  log('Build complete.');

  // ── Step 3: git init + checkout -b main ───────────────
  log('Initializing git repo...');
  // init is idempotent; safe to re-run on existing repos
  run('git init', { cwd: projectDir, env: GIT_ENV });
  // checkout -b main may fail if branch already exists — non-fatal
  const checkoutResult = run('git checkout -b main', {
    cwd: projectDir,
    env: GIT_ENV,
    fatal: false,
  });
  if (checkoutResult.error) {
    // Branch already exists — switch to it
    run('git checkout main', { cwd: projectDir, env: GIT_ENV });
  }
  log('Git repo ready on branch main.');

  // ── Step 4: git add -A + commit ────────────────────────
  log('Staging and committing files...');
  run('git add -A', { cwd: projectDir, env: GIT_ENV });
  // --allow-empty handles re-deploy scenario where tree is unchanged
  run(`git commit --allow-empty -m "Initial deploy: ${slug} explorer"`, {
    cwd: projectDir,
    env: GIT_ENV,
  });
  log(`Committed: "Initial deploy: ${slug} explorer"`);

  // ── Step 5: gh repo create or remote add + push ────────
  log(`Creating GitHub repo ShawCole/${repoName}...`);
  const ghResult = run(
    `gh repo create ShawCole/${repoName} --private --source=. --push`,
    { cwd: projectDir, fatal: false }
  );

  if (ghResult.error) {
    // Repo likely already exists — wire up remote and push manually
    log(`gh repo create failed (repo may already exist). Falling back to remote add + push...`);

    // Remove stale remote if present, then re-add
    run('git remote remove origin', { cwd: projectDir, fatal: false });
    run(`git remote add origin https://github.com/ShawCole/${repoName}.git`, {
      cwd: projectDir,
    });
    run('git push -u origin main --force', { cwd: projectDir, env: GIT_ENV });
    log('Pushed to existing GitHub repo.');
  } else {
    log('GitHub repo created and pushed.');
  }

  // ── Step 6: netlify-cli sites:create ──────────────────
  log(`Creating Netlify site "${repoName}"...`);
  const netlifyCreate = run(
    `npx netlify-cli sites:create --name ${repoName} --account-slug shawcole`,
    { cwd: projectDir, timeout: 60_000, fatal: false }
  );

  if (netlifyCreate.error) {
    log(`Netlify site creation failed (site may already exist). Continuing to deploy...`);
  } else {
    log('Netlify site created.');
  }

  // ── Step 7: netlify-cli deploy --prod --dir=dist ───────
  log('Deploying to Netlify (production)...');
  run(`npx netlify-cli deploy --prod --dir=dist --site=${repoName}`, {
    cwd: projectDir,
    timeout: 120_000,
  });
  log(`Netlify deploy complete. Live at ${siteUrl}`);

  // ── Done ───────────────────────────────────────────────
  log(`Deploy finished. url=${siteUrl} repoUrl=${repoUrl}`);
  return { url: siteUrl, repoUrl };
}
