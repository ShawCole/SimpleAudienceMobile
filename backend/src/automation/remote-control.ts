import axios, { AxiosInstance } from 'axios';
import { v4 as uuidv4 } from 'uuid';
import {
  ButtonIntent,
  ButtonMapEntry,
  ButtonMapFile,
  RemoteExecutionResult,
  buttonMap,
} from '@simpleaudience/automation';
import logger from '../utils/logger';
import { retry } from '../utils/retry';

export interface RemoteControlOptions {
  /** Default base URL for provider API calls */
  baseUrl?: string;
  /** Static headers that should be sent with every request */
  defaultHeaders?: Record<string, string>;
  /** async hook to fetch session headers/cookies */
  sessionHeadersProvider?: () => Promise<Record<string, string>>;
  /** Whether to prevent network calls and just log the plan */
  dryRun?: boolean;
  /** Optional button map override (mainly for tests) */
  catalog?: ButtonMapFile;
}

interface ResolvedRequestContext {
  entry: ButtonMapEntry;
  headers: Record<string, string>;
  body?: unknown;
  params?: Record<string, unknown>;
  url: string;
  method: string;
}

const DEFAULT_RETRY = {
  maxRetries: 3,
  initialDelay: 750,
  shouldRetry: (error: any) => {
    if (!error || !error.response) return true;
    const status = error.response.status;
    return status >= 500 || status === 429;
  },
};

export class ProviderRemoteControl {
  private readonly http: AxiosInstance;
  private readonly dryRun: boolean;
  private readonly defaultHeaders: Record<string, string>;
  private sessionHeadersProvider?: () => Promise<Record<string, string>>;
  private readonly map: ButtonMapFile;

  constructor(options: RemoteControlOptions = {}) {
    const { baseUrl, defaultHeaders, sessionHeadersProvider, dryRun, catalog } = options;
    this.http = axios.create({ baseURL: baseUrl });
    this.dryRun = Boolean(dryRun);
    this.defaultHeaders = defaultHeaders ?? {};
    this.sessionHeadersProvider = sessionHeadersProvider;
    this.map = catalog ?? buttonMap;
  }

  setSessionHeadersProvider(provider: () => Promise<Record<string, string>>): void {
    this.sessionHeadersProvider = provider;
  }

  private resolveEntry(buttonKey: string): ButtonMapEntry {
    const entry = this.map.entries.find(item => item.buttonKey === buttonKey);
    if (!entry) {
      throw new Error(`Button ${buttonKey} is not present in the button map`);
    }
    if (!entry.requestTemplate) {
      throw new Error(`Button ${buttonKey} does not have a recorded request template yet`);
    }
    return entry;
  }

  private async buildHeaders(entry: ButtonMapEntry, intent?: ButtonIntent): Promise<Record<string, string>> {
    const headers: Record<string, string> = {
      ...this.defaultHeaders,
      ...(entry.requestTemplate?.headers ?? {}),
      ...(this.sessionHeadersProvider ? await this.sessionHeadersProvider() : {}),
      ...(intent?.headerOverrides ?? {}),
    };
    return headers;
  }

  private mergeBody(templateBody: unknown, overrides?: Record<string, unknown>): unknown {
    if (!overrides) {
      return templateBody;
    }

    if (templateBody && typeof templateBody === 'object' && !Array.isArray(templateBody)) {
      return { ...(templateBody as Record<string, unknown>), ...overrides };
    }

    return overrides;
  }

  private async buildRequestContext(intent: ButtonIntent): Promise<ResolvedRequestContext> {
    const entry = this.resolveEntry(intent.buttonKey);
    const template = entry.requestTemplate!;
    const method = template.method.toUpperCase();
    const headers = await this.buildHeaders(entry, intent);
    const mergedPayload = this.mergeBody(template.body, intent.payloadOverrides);
    const query = intent.queryOverrides ?? {};

    const isGet = method === 'GET';
    const body = isGet ? undefined : mergedPayload;
    const params = isGet ? { ...(template.body as Record<string, unknown>), ...query } : Object.keys(query).length ? query : undefined;

    const url = template.url.startsWith('http') || !this.http.defaults.baseURL
      ? template.url
      : template.url.startsWith('/')
        ? template.url
        : `/${template.url}`;

    return { entry, headers, body, params, url, method };
  }

  async executeIntent(intent: ButtonIntent): Promise<RemoteExecutionResult> {
    const requestId = uuidv4();
    const startedAt = new Date();
    const ctx = await this.buildRequestContext(intent);

    if (this.dryRun || intent.dryRun) {
      logger.info('[remote-control] dry run', {
        buttonKey: intent.buttonKey,
        requestId,
        method: ctx.method,
        url: ctx.url,
      });
      const finished = new Date();
      return {
        buttonKey: intent.buttonKey,
        requestId,
        success: true,
        startedAt: startedAt.toISOString(),
        finishedAt: finished.toISOString(),
      };
    }

    const response = await retry(
      async () =>
        this.http.request({
          method: ctx.method,
          url: ctx.url,
          data: ctx.body,
          params: ctx.params,
          headers: ctx.headers,
        }),
      DEFAULT_RETRY
    );

    const finishedAt = new Date();
    logger.info('[remote-control] executed button intent', {
      buttonKey: intent.buttonKey,
      requestId,
      status: response.status,
    });

    return {
      buttonKey: intent.buttonKey,
      requestId,
      success: true,
      status: response.status,
      responseBody: response.data,
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
    };
  }

  async executePlan(intents: ButtonIntent[]): Promise<RemoteExecutionResult[]> {
    const results: RemoteExecutionResult[] = [];
    for (const intent of intents) {
      try {
        const result = await this.executeIntent(intent);
        results.push(result);
      } catch (error) {
        const finishedAt = new Date();
        const failedResult: RemoteExecutionResult = {
          buttonKey: intent.buttonKey,
          requestId: uuidv4(),
          success: false,
          error: error instanceof Error ? error.message : String(error),
          startedAt: finishedAt.toISOString(),
          finishedAt: finishedAt.toISOString(),
        };
        results.push(failedResult);
        throw error;
      }
    }
    return results;
  }
}

