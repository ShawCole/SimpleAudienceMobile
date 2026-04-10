/**
 * Impossible Solutions — 3 topics x 3 tiers = 9 pulls
 * Creates 1 audience per topic, re-generates with different score filters.
 * Goes back to workspace between re-generations.
 *
 * Filters (from taxonomy):
 *   seniority: cxo
 *   credit_rating: 800+, 750 - 799, 700 - 749  (700+ credit)
 *   homeowner: homeowner
 */
import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const PULL = path.resolve('/Users/ShawCole/SimpleAudienceMobile/tools/pull-audience.mjs');
const OUT_DIR = '/tmp/impossible-build';
fs.mkdirSync(OUT_DIR + '/datasets', { recursive: true });

const TOPICS = [
    { name: 'Business Loans', path: 'Financial Services > Business Banking & Lending > Business Loans', slug: 'business-loans' },
    { name: 'Capital Equipment Financing', path: 'Financial Services > Business Lending & Credit > Capital Equipment Financing', slug: 'capital-equipment-financing' },
    { name: 'Working Capital Management', path: 'Financial Services > Commercial & Business Banking > Working Capital Management', slug: 'working-capital-management' },
];

const TIERS = ['low', 'medium', 'high'];

// Filter values from shared/taxonomy/filter-taxonomy.ts via formatFilterLabel
const FILTER_ARGS = [
    '--seniority', 'cxo',
    '--credit', '800+,750 - 799,700 - 749',
    '--homeowner', 'homeowner',
];

function run(args) {
    const argStr = args.map(a => a.includes(' ') ? `"${a}"` : a).join(' ');
    console.log(`\n[run] node pull-audience.mjs ${argStr}\n`);
    try {
        const result = execFileSync('node', [PULL, ...args], {
            encoding: 'utf8',
            stdio: ['pipe', 'pipe', 'pipe'],
            timeout: 300_000,
            cwd: '/Users/ShawCole/SimpleAudienceMobile'
        });
        console.log(result);
        const idMatch = result.match(/ID:\s*([0-9a-f-]{36})/);
        return { audienceId: idMatch?.[1] || null, output: result };
    } catch (e) {
        const out = e.stdout || '';
        const err = e.stderr || '';
        console.log('STDOUT:', out.substring(0, 3000));
        if (err) console.error('STDERR:', err.substring(0, 500));
        const idMatch = out.match(/ID:\s*([0-9a-f-]{36})/);
        return { audienceId: idMatch?.[1] || null, output: out, error: true };
    }
}

async function main() {
    console.log('═══ Impossible Solutions — 3 Topics x 3 Tiers ═══');
    console.log(`Output: ${OUT_DIR}`);
    console.log(`Filters: CXO seniority, 700+ credit, homeowner`);
    console.log('');

    let pullCount = 0;
    const results = {};

    for (const topic of TOPICS) {
        console.log(`\n${'═'.repeat(60)}`);
        console.log(`TOPIC: ${topic.name}`);
        console.log(`PATH:  ${topic.path}`);
        console.log('═'.repeat(60));

        let audienceId = null;

        for (const tier of TIERS) {
            pullCount++;
            const csvPath = `${OUT_DIR}/${topic.slug}-${tier}.csv`;

            if (fs.existsSync(csvPath) && fs.statSync(csvPath).size > 1000) {
                console.log(`\n[${pullCount}/9] ${topic.name} (${tier}) — SKIPPING, exists (${(fs.statSync(csvPath).size / 1024 / 1024).toFixed(1)}MB)`);
                continue;
            }

            console.log(`\n[${pullCount}/9] ${topic.name} — ${tier} intent`);

            const args = [];
            if (!audienceId) {
                args.push('--name', `Impossible Solutions - ${topic.name} - SC`);
            } else {
                args.push('--audience', audienceId);
                console.log(`  Reusing audience: ${audienceId}`);
            }
            args.push('--topic', topic.path);
            args.push('--score', tier);
            args.push(...FILTER_ARGS);
            args.push('--output', csvPath);

            const result = run(args);

            if (result.audienceId && !audienceId) {
                audienceId = result.audienceId;
                console.log(`[audience] Created: ${audienceId}`);
            }

            if (fs.existsSync(csvPath)) {
                const size = fs.statSync(csvPath).size;
                console.log(`[csv] ${path.basename(csvPath)} — ${(size / 1024 / 1024).toFixed(1)}MB`);
                if (!results[topic.slug]) results[topic.slug] = {};
                results[topic.slug][tier] = { csv: csvPath, size };
            } else {
                console.log(`[csv] MISSING: ${csvPath}`);
            }
        }
    }

    console.log(`\n${'═'.repeat(60)}`);
    console.log('SUMMARY');
    console.log('═'.repeat(60));
    for (const [slug, tiers] of Object.entries(results)) {
        console.log(`\n${slug}:`);
        for (const [tier, info] of Object.entries(tiers)) {
            console.log(`  ${tier}: ${(info.size / 1024 / 1024).toFixed(1)}MB`);
        }
    }
}

main().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
