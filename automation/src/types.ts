export type ButtonType = 'top_level' | 'filter' | 'action';

export type CaptureStatus = 'pending' | 'captured';

export interface ButtonRosterEntry {
  buttonKey: string;
  label: string;
  section: string;
  type: ButtonType;
  path: string[];
  parentKey?: string;
  selectorHint?: string;
  prerequisites?: string[];
  notes?: string;
  captureStatus?: CaptureStatus;
  trace?: TraceReference | null;
}

export interface ButtonRosterFile {
  version: number;
  updatedAt: string;
  entries: ButtonRosterEntry[];
}

export interface TraceReference {
  sessionId: string;
  file: string;
  eventIndex: number;
}

export interface NetworkPayload {
  headers?: Record<string, string>;
  body?: unknown;
  query?: Record<string, string | number>;
}

export interface NetworkRequestTemplate {
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: unknown;
}

export interface ResponseSummary {
  status?: number;
  bodySample?: unknown;
}

export interface ButtonMapEntry {
  buttonKey: string;
  label: string;
  section: string;
  type: ButtonType;
  selectorHint?: string;
  prerequisites?: string[];
  lastCapturedAt?: string;
  requestTemplate?: NetworkRequestTemplate;
  trace?: TraceReference | null;
  responses?: ResponseSummary[];
  notes?: string;
}

export interface ButtonMapFile {
  version: number;
  generatedAt: string;
  entries: ButtonMapEntry[];
}

export type TraceTransport = 'FETCH' | 'XHR';

export interface TraceNetworkEntry {
  type: TraceTransport;
  url: string;
  method: string;
  payload: unknown;
  response: unknown;
  headers?: Record<string, string>;
  status?: number;
  timestamp: string;
}

export interface TraceEvent {
  buttonKey: string;
  buttonLabel: string;
  selectorHint?: string;
  notes?: string;
  network: TraceNetworkEntry;
}

export interface TraceSessionMeta {
  sessionId: string;
  section: string;
  capturedAt: string;
  operator?: string;
  environment?: string;
  topLevelButton?: string;
}

export interface TraceSession {
  meta: TraceSessionMeta;
  events: TraceEvent[];
}

export interface ButtonIntent {
  buttonKey: string;
  description?: string;
  payloadOverrides?: Record<string, unknown>;
  headerOverrides?: Record<string, string>;
  queryOverrides?: Record<string, string>;
  dryRun?: boolean;
}

export interface RemoteExecutionResult {
  buttonKey: string;
  requestId: string;
  success: boolean;
  status?: number;
  error?: string;
  startedAt: string;
  finishedAt: string;
  responseBody?: unknown;
}

