#!/usr/bin/env tsx
import path from 'node:path';
import { Command } from 'commander';
import dotenv from 'dotenv';
import { runCapture } from './workflows/capture.js';
import { logger } from './utils/logger.js';
import { CaptureOptions } from './types.js';

const rootEnv = path.resolve(process.cwd(), '..', '..', '.env');
dotenv.config({ path: rootEnv });
dotenv.config();

const program = new Command();
program
  .name('selenium-sniffer')
  .description('Drive Audience Lab filters with Selenium and capture Fetch/XHR logs')
  .option('--section <name>', 'section id (business, financial, etc.)')
  .option('--filter <buttonKey>', 'button key from button-roster.json')
  .option('--all', 'run every configured filter')
  .option('--manual-login', 'skip automated credential entry')
  .option('--output <dir>', 'directory for trace files', 'docs/provider-traces')
  .action(async (cmdOptions) => {
    const captureOptions: CaptureOptions = {
      section: cmdOptions.section,
      filter: cmdOptions.filter,
      all: cmdOptions.all,
      manualLogin: cmdOptions.manualLogin,
      outputDir: cmdOptions.output,
    };

    try {
      await runCapture(captureOptions);
    } catch (error) {
      logger.error('Capture run failed', error);
      process.exitCode = 1;
    }
  });

program.parseAsync(process.argv);
