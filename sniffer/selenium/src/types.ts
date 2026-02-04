import { WebDriver } from 'selenium-webdriver';

export interface CaptureOptions {
  section?: string;
  filter?: string;
  all?: boolean;
  manualLogin?: boolean;
  outputDir: string;
}

export interface SnifferEntry {
  type: 'FETCH' | 'XHR';
  url: string;
  method: string;
  payload: unknown;
  response: unknown;
  status?: number;
  timestamp: string;
}

export interface CaptureContext {
  driver: WebDriver;
  sniffer: SnifferClient;
}

export interface FilterDefinition {
  buttonKey: string;
  section: string;
  description: string;
  run(context: CaptureContext): Promise<void>;
  skip?: boolean;
}

export interface SnifferClient {
  inject(): Promise<void>;
  reset(): Promise<void>;
  getEntries(): Promise<SnifferEntry[]>;
  waitForNextEntry(timeout?: number): Promise<SnifferEntry>;
}

export interface TraceEvent {
  buttonKey: string;
  buttonLabel: string;
  selectorHint?: string;
  notes?: string;
  network: SnifferEntry;
}

export interface TraceFileSchema {
  meta: {
    sessionId: string;
    section: string;
    capturedAt: string;
    operator: string;
    environment: string;
    topLevelButton?: string;
  };
  events: TraceEvent[];
}
