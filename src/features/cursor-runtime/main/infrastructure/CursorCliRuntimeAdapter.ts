import { killProcessTree, spawnCli } from '@main/utils/childProcess';
import type { ChildProcessWithoutNullStreams } from 'child_process';
import { randomUUID } from 'crypto';

import type { CursorRuntimeAdapter } from '../../core/application';
import { normalizeCursorStreamJson, summarizeCursorRuntimeEvents } from '../../core/domain';
import type {
  CursorRuntimeCapabilitySummary,
  CursorRuntimeRunMode,
  CursorRuntimeRunRequest,
  CursorRuntimeRunResult,
  CursorRuntimeStatus,
} from '../../contracts';
import { CursorCliResolver, type CursorCliResolveResult } from './CursorCliResolver';

const DEFAULT_RUN_TIMEOUT_MS = 10 * 60 * 1000;
const PROBE_TIMEOUT_MS = 15_000;
const DEFAULT_CAPABILITIES: CursorRuntimeCapabilitySummary = {
  oneShot: {
    supported: true,
    outputFormats: ['json', 'stream-json', 'text'],
  },
  solo: {
    supported: true,
    resumeStrategy: 'session-id',
    limitations: [
      'Cursor solo mode uses CLI session resume and does not provide Claude Agent Teams teammate semantics.',
      'Task/subagent timeline linking remains best-effort until Cursor emits a stable Hermit team protocol.',
    ],
  },
  teamLaunch: {
    supported: false,
    reason:
      'Cursor CLI does not expose Hermit-compatible Agent Teams bootstrap, lead inbox relay, or teammate spawn semantics.',
  },
};

interface CursorStatusJson {
  isAuthenticated?: boolean;
  message?: string;
  status?: string;
}

interface CursorProcessOutput {
  stdout: string;
  stderr: string;
  exitCode: number | null;
}

function parseStatusJson(stdout: string): CursorStatusJson | null {
  try {
    const parsed = JSON.parse(stdout) as CursorStatusJson;
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function normalizeModelList(stdout: string): string[] {
  return stdout
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line && line !== 'No models available for this account.');
}

function normalizeMode(mode: CursorRuntimeRunRequest['mode']): CursorRuntimeRunMode {
  return mode ?? 'agent';
}

function buildRunArgs(request: CursorRuntimeRunRequest): string[] {
  const args = ['-p', '--output-format', 'stream-json', '--workspace', request.cwd];
  const mode = normalizeMode(request.mode);
  if (mode !== 'agent') {
    args.push('--mode', mode);
  }
  if (request.force) {
    args.push('--force');
  }
  if (request.model?.trim()) {
    args.push('--model', request.model.trim());
  }
  if (request.resumeSessionId?.trim()) {
    args.push('--resume', request.resumeSessionId.trim());
  }
  args.push(request.prompt);
  return args;
}

function collectProcessOutput(
  child: ChildProcessWithoutNullStreams,
  timeoutMs: number
): Promise<CursorProcessOutput> {
  return new Promise((resolve, reject) => {
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      killProcessTree(child, 'SIGKILL');
      reject(new Error(`Cursor CLI timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
    child.once('error', (error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      reject(error);
    });
    child.once('close', (exitCode) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      resolve({
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
        exitCode,
      });
    });
  });
}

export class CursorCliRuntimeAdapter implements CursorRuntimeAdapter {
  readonly id = 'cursor' as const;

  private readonly activeRuns = new Map<string, ChildProcessWithoutNullStreams>();

  async probeStatus(): Promise<CursorRuntimeStatus> {
    const resolved = await CursorCliResolver.resolve();
    if (!resolved.binaryPath) {
      return {
        state: 'missing',
        command: resolved.command,
        binaryPath: null,
        version: null,
        authenticated: false,
        authMessage: null,
        models: [],
        capabilities: DEFAULT_CAPABILITIES,
        diagnostics: resolved.diagnostics,
      };
    }

    const diagnostics = [...resolved.diagnostics];
    const version = await this.probeVersion(resolved, diagnostics);
    const auth = await this.probeAuth(resolved, diagnostics);
    const models = await this.probeModels(resolved, diagnostics);
    const state = auth.authenticated ? 'ready' : 'needs-auth';

    return {
      state,
      command: resolved.command,
      binaryPath: resolved.binaryPath,
      version,
      authenticated: auth.authenticated,
      authMessage: auth.message,
      models,
      capabilities: DEFAULT_CAPABILITIES,
      diagnostics,
    };
  }

  async runOneShot(request: CursorRuntimeRunRequest): Promise<CursorRuntimeRunResult> {
    return this.runCursor({ ...request, resumeSessionId: null });
  }

  async runSoloTurn(request: CursorRuntimeRunRequest): Promise<CursorRuntimeRunResult> {
    return this.runCursor(request);
  }

  cancel(runId: string): boolean {
    const child = this.activeRuns.get(runId);
    if (!child) {
      return false;
    }
    killProcessTree(child, 'SIGTERM');
    this.activeRuns.delete(runId);
    return true;
  }

  private async probeVersion(
    resolved: CursorCliResolveResult,
    diagnostics: string[]
  ): Promise<string | null> {
    try {
      const result = await collectProcessOutput(
        spawnCli(resolved.binaryPath!, ['--version'], {
          env: resolved.env,
          stdio: 'pipe',
        }) as ChildProcessWithoutNullStreams,
        PROBE_TIMEOUT_MS
      );
      return result.exitCode === 0 ? result.stdout.trim() || null : null;
    } catch (error) {
      diagnostics.push(`Cursor CLI version probe failed: ${String(error)}`);
      return null;
    }
  }

  private async probeAuth(
    resolved: CursorCliResolveResult,
    diagnostics: string[]
  ): Promise<{ authenticated: boolean; message: string | null }> {
    try {
      const result = await collectProcessOutput(
        spawnCli(resolved.binaryPath!, ['status', '--format', 'json'], {
          env: resolved.env,
          stdio: 'pipe',
        }) as ChildProcessWithoutNullStreams,
        PROBE_TIMEOUT_MS
      );
      const status = parseStatusJson(result.stdout);
      if (!status) {
        diagnostics.push('Cursor CLI auth status did not return JSON.');
        return {
          authenticated: false,
          message: result.stdout.trim() || result.stderr.trim() || null,
        };
      }
      return {
        authenticated: status.isAuthenticated === true || status.status === 'authenticated',
        message: status.message ?? null,
      };
    } catch (error) {
      diagnostics.push(`Cursor CLI auth status failed: ${String(error)}`);
      return { authenticated: false, message: null };
    }
  }

  private async probeModels(
    resolved: CursorCliResolveResult,
    diagnostics: string[]
  ): Promise<string[]> {
    try {
      const result = await collectProcessOutput(
        spawnCli(resolved.binaryPath!, ['models'], {
          env: resolved.env,
          stdio: 'pipe',
        }) as ChildProcessWithoutNullStreams,
        PROBE_TIMEOUT_MS
      );
      const models = normalizeModelList(result.stdout);
      if (models.length === 0 && result.stdout.includes('No models available')) {
        diagnostics.push(
          'Cursor CLI reported no explicit model list; default account model may still work.'
        );
      }
      return models;
    } catch (error) {
      diagnostics.push(`Cursor CLI model probe failed: ${String(error)}`);
      return [];
    }
  }

  private async runCursor(request: CursorRuntimeRunRequest): Promise<CursorRuntimeRunResult> {
    const start = Date.now();
    const resolved = await CursorCliResolver.resolve();
    if (!resolved.binaryPath) {
      return {
        ok: false,
        exitCode: null,
        sessionId: null,
        resultText: '',
        stdout: '',
        stderr: '',
        durationMs: Date.now() - start,
        events: [],
        diagnostics: resolved.diagnostics,
      };
    }

    const runId = request.runId ?? randomUUID();
    const diagnostics = [...resolved.diagnostics];
    const env = { ...resolved.env, ...(request.env ?? {}) };
    const child = spawnCli(resolved.binaryPath, buildRunArgs(request), {
      cwd: request.cwd,
      env,
      stdio: 'pipe',
    }) as ChildProcessWithoutNullStreams;
    this.activeRuns.set(runId, child);

    try {
      const output = await collectProcessOutput(child, request.timeoutMs ?? DEFAULT_RUN_TIMEOUT_MS);
      const events = normalizeCursorStreamJson(output.stdout);
      const summary = summarizeCursorRuntimeEvents(events);
      return {
        ok: output.exitCode === 0,
        exitCode: output.exitCode,
        sessionId: summary.sessionId,
        resultText: summary.resultText,
        stdout: output.stdout,
        stderr: output.stderr,
        durationMs: Date.now() - start,
        events,
        diagnostics: [...diagnostics, ...summary.diagnostics],
      };
    } catch (error) {
      return {
        ok: false,
        exitCode: null,
        sessionId: null,
        resultText: '',
        stdout: '',
        stderr: error instanceof Error ? error.message : String(error),
        durationMs: Date.now() - start,
        events: [],
        diagnostics,
      };
    } finally {
      this.activeRuns.delete(runId);
    }
  }
}
