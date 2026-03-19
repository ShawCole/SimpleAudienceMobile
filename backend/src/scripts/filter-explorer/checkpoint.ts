import fs from 'fs';
import path from 'path';
import { EXPLORER_CONFIG } from './config';

export interface TestResult {
  id: string;
  phase: string;
  label: string;
  filters: Array<{ key: string; values: string[]; range?: { min: number | null; max: number | null } }>;
  result: {
    success: boolean;
    count: number;
    durationMs: number;
    timestamp: string;
    error?: string;
    raw?: string;
  };
}

interface CheckpointData {
  startedAt: string;
  resultFile: string;
  completedIds: string[];
}

export class Checkpoint {
  private checkpointPath: string;
  private resultPath: string;
  private completedIds: Set<string>;
  private startedAt: string;

  constructor(resumeFile?: string) {
    const dir = EXPLORER_CONFIG.dataDir;
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    this.checkpointPath = path.join(dir, 'checkpoint.json');

    // Try to resume from existing checkpoint
    if (fs.existsSync(this.checkpointPath)) {
      const data: CheckpointData = JSON.parse(fs.readFileSync(this.checkpointPath, 'utf-8'));
      this.resultPath = data.resultFile;
      this.completedIds = new Set(data.completedIds);
      this.startedAt = data.startedAt;
      console.log(`[checkpoint] Resuming: ${this.completedIds.size} tests already completed`);
    } else {
      const ts = new Date().toISOString().replace(/[:.]/g, '-');
      this.resultPath = resumeFile || path.join(dir, `results-${ts}.ndjson`);
      this.completedIds = new Set();
      this.startedAt = new Date().toISOString();
    }
  }

  isCompleted(testId: string): boolean {
    return this.completedIds.has(testId);
  }

  getCompletedCount(): number {
    return this.completedIds.size;
  }

  getResultPath(): string {
    return this.resultPath;
  }

  record(result: TestResult): void {
    // Append to NDJSON
    fs.appendFileSync(this.resultPath, JSON.stringify(result) + '\n');
    this.completedIds.add(result.id);
    this.saveCheckpoint();
  }

  private saveCheckpoint(): void {
    const data: CheckpointData = {
      startedAt: this.startedAt,
      resultFile: this.resultPath,
      completedIds: Array.from(this.completedIds),
    };
    fs.writeFileSync(this.checkpointPath, JSON.stringify(data, null, 2));
  }

  finalize(): void {
    // Remove checkpoint on clean completion
    if (fs.existsSync(this.checkpointPath)) {
      fs.unlinkSync(this.checkpointPath);
    }
    console.log(`[checkpoint] Run complete. Results: ${this.resultPath}`);
  }

  /** Read all results from the NDJSON file */
  static readResults(filePath: string): TestResult[] {
    if (!fs.existsSync(filePath)) return [];
    return fs.readFileSync(filePath, 'utf-8')
      .trim()
      .split('\n')
      .filter(Boolean)
      .map(line => JSON.parse(line));
  }
}
