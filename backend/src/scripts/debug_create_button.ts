
import { VacuumEngine, VacuumPhase } from '../automation/vacuum';
import dotenv from 'dotenv';
import path from 'path';

// Load env from backend root
dotenv.config({ path: path.join(__dirname, '../../.env') });

async function runDebug() {
    console.log('--- STARTING VACUUM DEBUG: CREATE BUTTON ---');
    try {
        const targetAudience = 'Debug-Audience-' + Date.now();
        console.log(`Target Audience: ${targetAudience}`);

        // 1. Prewarm (Login + Navigate)
        console.log('\n[Phase 1] Pre-warming...');
        await VacuumEngine.prewarm();

        // 2. Init Audience (This triggers the "Create" button logic)
        console.log('\n[Phase 2] Initializing Audience (Testing Create Button)...');
        await VacuumEngine.initAudience(targetAudience);

        console.log('\n--- SUCCESS: Audience Created & Initialized ---');
    } catch (error) {
        console.error('\n--- FATAL ERROR ---');
        console.error(error);
    } finally {
        // Keep browser open for a moment if needed
        console.log('Done.');
        process.exit(0);
    }
}

runDebug();
