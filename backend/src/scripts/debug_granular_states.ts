
import { VacuumEngine, VacuumPhase } from '../automation/vacuum';
import dotenv from 'dotenv';
import path from 'path';

// Load env from backend root
dotenv.config({ path: path.join(__dirname, '../../.env') });

async function verifyGranularStates() {
    console.log('--- VERIFYING GRANULAR STATES (Phase 1.5) ---');
    try {
        const targetAudience = 'Granular-Test-' + Date.now();
        console.log(`Target Audience: ${targetAudience}`);

        // 1. Prewarm -> Should end at AUTHED or ACCOUNT_SET or NAMING_MODAL_OPEN (if proactive)
        console.log('\n[Step 1] Pre-warming...');
        await VacuumEngine.prewarm();
        let state = await VacuumEngine.getBrowserState();
        console.log(`State after Prewarm: ${VacuumPhase[state]} (${state})`);

        // 2. Transition to Naming Modal -> Should end at NAMING_MODAL_OPEN (3)
        console.log('\n[Step 2] Opening Naming Modal (transitionToNamingReady)...');
        await VacuumEngine.transitionToNamingReady();
        state = await VacuumEngine.getBrowserState();
        console.log(`State after Open Modal: ${VacuumPhase[state]} (${state})`);

        if (state !== VacuumPhase.NAMING_MODAL_OPEN) {
            throw new Error('FAILED: Expected NAMING_MODAL_OPEN (3)');
        }

        // 3. Submit Name -> Should end at AUDIENCE_FILTERS (5)
        console.log(`\n[Step 3] Submitting Name "${targetAudience}" (submitAudienceName)...`);
        await VacuumEngine.submitAudienceName(targetAudience);
        state = await VacuumEngine.getBrowserState();
        console.log(`State after Submit Name: ${VacuumPhase[state]} (${state})`);

        if (state !== VacuumPhase.AUDIENCE_FILTERS) {
            throw new Error('FAILED: Expected AUDIENCE_FILTERS (5)');
        }

        console.log('\n--- SUCCESS: Granular State Machine Verified ---');
    } catch (error) {
        console.error('\n--- FATAL ERROR ---');
        console.error(error);
    } finally {
        process.exit(0);
    }
}

verifyGranularStates();
