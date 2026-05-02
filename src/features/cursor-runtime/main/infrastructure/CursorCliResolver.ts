import { buildMergedCliPath } from '@main/utils/cliPathMerge';
import { resolveInteractiveShellEnv } from '@main/utils/shellEnv';
import { existsSync } from 'fs';
import path from 'path';

const CURSOR_AGENT_ENV_PATH = 'CURSOR_AGENT_PATH';
const CURSOR_CLI_CANDIDATES = ['agent', 'cursor-agent'];

function pathEntries(env: NodeJS.ProcessEnv): string[] {
  const pathValue = env.PATH ?? buildMergedCliPath();
  return pathValue.split(path.delimiter).filter(Boolean);
}

function windowsCandidateNames(command: string): string[] {
  if (process.platform !== 'win32') {
    return [command];
  }
  return [command, `${command}.exe`, `${command}.cmd`, `${command}.bat`];
}

function resolveFromPath(command: string, env: NodeJS.ProcessEnv): string | null {
  if (path.isAbsolute(command)) {
    return existsSync(command) ? command : null;
  }

  for (const dir of pathEntries(env)) {
    for (const name of windowsCandidateNames(command)) {
      const candidate = path.join(dir, name);
      if (existsSync(candidate)) {
        return candidate;
      }
    }
  }

  return null;
}

export interface CursorCliResolveResult {
  binaryPath: string | null;
  command: string | null;
  env: NodeJS.ProcessEnv;
  diagnostics: string[];
}

export class CursorCliResolver {
  static async resolve(): Promise<CursorCliResolveResult> {
    const shellEnv = await resolveInteractiveShellEnv();
    const env = {
      ...process.env,
      ...shellEnv,
      PATH: buildMergedCliPath(process.env[CURSOR_AGENT_ENV_PATH]),
    };
    const diagnostics: string[] = [];
    const configuredPath = process.env[CURSOR_AGENT_ENV_PATH]?.trim();

    if (configuredPath) {
      const resolved = resolveFromPath(configuredPath, env);
      if (resolved) {
        return {
          binaryPath: resolved,
          command: configuredPath,
          env,
          diagnostics,
        };
      }
      diagnostics.push(
        `${CURSOR_AGENT_ENV_PATH} points to a missing Cursor CLI: ${configuredPath}`
      );
    }

    for (const command of CURSOR_CLI_CANDIDATES) {
      const resolved = resolveFromPath(command, env);
      if (resolved) {
        return {
          binaryPath: resolved,
          command,
          env,
          diagnostics,
        };
      }
    }

    diagnostics.push(
      'Cursor CLI was not found on PATH. Install Cursor CLI or set CURSOR_AGENT_PATH.'
    );
    return {
      binaryPath: null,
      command: null,
      env,
      diagnostics,
    };
  }
}
