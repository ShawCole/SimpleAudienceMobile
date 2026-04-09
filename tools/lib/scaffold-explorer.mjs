import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';

/**
 * Clones the BFA explorer template and configures it for a new client.
 *
 * @param {object} options
 * @param {string} options.slug           - URL-safe identifier, e.g. "acme-plumbing"
 * @param {string} options.businessName   - Human-readable client name, e.g. "Acme Plumbing"
 * @param {string} options.audienceTitle  - Title shown in the explorer, must contain {topic}
 * @param {Array}  options.datasets       - [{ slug, label, jsonPath }]
 * @param {string} [options.brandColor]   - Hex color, defaults to "#6366f1"
 * @param {string} [options.logoPath]     - Optional path to a logo file (copied to public/logo.svg)
 * @param {string} options.outputDir      - Absolute path where the explorer will be written
 */
export async function scaffoldExplorer({
  slug,
  businessName,
  audienceTitle,
  datasets,
  brandColor = '#6366f1',
  logoPath,
  outputDir,
}) {
  // ── Validate required inputs ──────────────────────────────────────────────
  if (!slug) throw new Error('scaffoldExplorer: slug is required');
  if (!businessName) throw new Error('scaffoldExplorer: businessName is required');
  if (!audienceTitle) throw new Error('scaffoldExplorer: audienceTitle is required');
  if (!Array.isArray(datasets) || datasets.length === 0)
    throw new Error('scaffoldExplorer: datasets must be a non-empty array');
  if (!outputDir) throw new Error('scaffoldExplorer: outputDir is required');

  // ── Step 1: Handle existing outputDir ────────────────────────────────────
  if (fs.existsSync(outputDir)) {
    console.log(`[scaffold-explorer] Output dir already exists — removing: ${outputDir}`);
    fs.rmSync(outputDir, { recursive: true, force: true });
    console.log(`[scaffold-explorer] Removed existing output dir.`);
  }

  // ── Step 2: Clone the BFA explorer template ───────────────────────────────
  console.log(`[scaffold-explorer] Cloning ShawCole/bfa-media-explorer into ${outputDir} ...`);
  try {
    execFileSync('gh', ['repo', 'clone', 'ShawCole/bfa-media-explorer', outputDir], {
      stdio: 'inherit',
    });
  } catch (err) {
    throw new Error(
      `[scaffold-explorer] Failed to clone repo. ` +
        `Make sure 'gh' is installed and you are authenticated (gh auth login).\n` +
        `Original error: ${err.message}`
    );
  }
  console.log(`[scaffold-explorer] Clone complete.`);

  // ── Step 3: Remove .git directory ────────────────────────────────────────
  const gitDir = path.join(outputDir, '.git');
  if (fs.existsSync(gitDir)) {
    console.log(`[scaffold-explorer] Removing .git directory ...`);
    fs.rmSync(gitDir, { recursive: true, force: true });
    console.log(`[scaffold-explorer] .git removed.`);
  }

  // ── Step 4: Remove BFA-specific files ────────────────────────────────────
  const bfaLogoPath = path.join(outputDir, 'public', 'logo.svg');
  if (fs.existsSync(bfaLogoPath)) {
    console.log(`[scaffold-explorer] Removing BFA logo: public/logo.svg`);
    fs.rmSync(bfaLogoPath);
  }

  const bfaFaviconPath = path.join(outputDir, 'public', 'favicon.png');
  if (fs.existsSync(bfaFaviconPath)) {
    console.log(`[scaffold-explorer] Removing BFA favicon: public/favicon.png`);
    fs.rmSync(bfaFaviconPath);
  }

  const datasetsDir = path.join(outputDir, 'public', 'datasets');
  if (fs.existsSync(datasetsDir)) {
    console.log(`[scaffold-explorer] Removing BFA datasets directory: public/datasets/`);
    fs.rmSync(datasetsDir, { recursive: true, force: true });
  }
  console.log(`[scaffold-explorer] Recreating empty public/datasets/ directory`);
  fs.mkdirSync(datasetsDir, { recursive: true });

  // ── Step 5: Write public/config.json ─────────────────────────────────────
  const configObj = {
    title: audienceTitle,
    clientName: businessName,
    datasets: datasets.map(({ slug: dSlug, label }) => ({
      id: dSlug,
      label,
      path: `/datasets/${dSlug}.json`,
    })),
    brandColor,
    accentColor: '#a78bfa',
    ctaUrl: 'https://calendly.com/shaw-listmagic/45min',
    ctaText: 'Book a Call',
    logoUrl: '/logo.svg',
  };

  const configPath = path.join(outputDir, 'public', 'config.json');
  console.log(`[scaffold-explorer] Writing public/config.json ...`);
  fs.writeFileSync(configPath, JSON.stringify(configObj, null, 2), 'utf8');
  console.log(`[scaffold-explorer] config.json written.`);

  // ── Step 6: Copy dataset JSON files ──────────────────────────────────────
  for (const { slug: dSlug, label, jsonPath } of datasets) {
    if (!jsonPath) {
      console.warn(`[scaffold-explorer] Dataset "${label}" has no jsonPath — skipping copy.`);
      continue;
    }
    if (!fs.existsSync(jsonPath)) {
      throw new Error(
        `[scaffold-explorer] Dataset file not found for "${label}": ${jsonPath}`
      );
    }
    const destPath = path.join(datasetsDir, `${dSlug}.json`);
    console.log(`[scaffold-explorer] Copying dataset "${label}": ${jsonPath} → ${destPath}`);
    fs.copyFileSync(jsonPath, destPath);
  }
  console.log(`[scaffold-explorer] All datasets copied.`);

  // ── Step 7: Copy logo if provided ────────────────────────────────────────
  if (logoPath) {
    if (!fs.existsSync(logoPath)) {
      throw new Error(`[scaffold-explorer] logoPath does not exist: ${logoPath}`);
    }
    const logoDestPath = path.join(outputDir, 'public', 'logo.svg');
    console.log(`[scaffold-explorer] Copying logo: ${logoPath} → ${logoDestPath}`);
    fs.copyFileSync(logoPath, logoDestPath);
    console.log(`[scaffold-explorer] Logo copied.`);
  }

  // ── Step 8: Update package.json name field ────────────────────────────────
  const pkgPath = path.join(outputDir, 'package.json');
  if (fs.existsSync(pkgPath)) {
    console.log(`[scaffold-explorer] Updating package.json name to "${slug}-explorer" ...`);
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    pkg.name = `${slug}-explorer`;
    fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2), 'utf8');
    console.log(`[scaffold-explorer] package.json updated.`);
  } else {
    console.warn(`[scaffold-explorer] package.json not found in cloned repo — skipping name update.`);
  }

  console.log(`[scaffold-explorer] Done. Explorer scaffolded at: ${outputDir}`);
}
