export type CursorRuntimeStatusState = 'ready' | 'missing' | 'needs-auth' | 'degraded';

export type CursorRuntimeRunMode = 'agent' | 'ask' | 'plan';

export interface CursorRuntimeCapabilitySummary {
  oneShot: {
    supported: boolean;
    outputFormats: readonly ('json' | 'stream-json' | 'text')[];
  };
  solo: {
    supported: boolean;
    resumeStrategy: 'session-id';
    limitations: readonly string[];
  };
  teamLaunch: {
    supported: boolean;
    reason: string;
  };
}

export interface CursorRuntimeStatus {
  state: CursorRuntimeStatusState;
  command: string | null;
  binaryPath: string | null;
  version: string | null;
  authenticated: boolean;
  authMessage: string | null;
  models: readonly string[];
  capabilities: CursorRuntimeCapabilitySummary;
  diagnostics: readonly string[];
}

export interface CursorRuntimeRunRequest {
  runId?: string;
  prompt: string;
  cwd: string;
  mode?: CursorRuntimeRunMode;
  model?: string | null;
  resumeSessionId?: string | null;
  force?: boolean;
  timeoutMs?: number;
  env?: NodeJS.ProcessEnv;
}

export interface CursorRuntimeNormalizedEvent {
  type: 'session' | 'user' | 'assistant' | 'result' | 'connection' | 'retry' | 'raw';
  sessionId: string | null;
  text: string | null;
  rawType: string | null;
  rawSubtype: string | null;
  timestampMs: number | null;
  metadata: Record<string, unknown>;
}

export interface CursorRuntimeRunResult {
  ok: boolean;
  exitCode: number | null;
  sessionId: string | null;
  resultText: string;
  stdout: string;
  stderr: string;
  durationMs: number;
  events: readonly CursorRuntimeNormalizedEvent[];
  diagnostics: readonly string[];
}
