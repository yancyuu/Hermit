import { execFile, execFileSync } from 'child_process';

export interface WindowsProcessTableRow {
  pid: number;
  ppid: number;
  command: string;
}

interface RawWindowsProcessRow {
  ProcessId?: number | string | null;
  ParentProcessId?: number | string | null;
  CommandLine?: string | null;
}

const PROCESS_TABLE_SCRIPT = [
  '$ErrorActionPreference = "Stop"',
  'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,CommandLine | ConvertTo-Json -Compress',
].join('; ');

const PROCESS_TABLE_ARGS = [
  '-NoProfile',
  '-NonInteractive',
  '-ExecutionPolicy',
  'Bypass',
  '-Command',
  PROCESS_TABLE_SCRIPT,
];
// Reading full Windows command lines requires spawning PowerShell + CIM, which is
// visibly expensive when runtime status is polled. Keep this coarse-grained and
// share one snapshot across all runtime liveness checks.
const PROCESS_TABLE_CACHE_TTL_MS = 30_000;
const PROCESS_TABLE_ERROR_CACHE_TTL_MS = 10_000;

let cachedProcessTable: {
  expiresAtMs: number;
  rows: WindowsProcessTableRow[];
} | null = null;
let inFlightProcessTable: Promise<WindowsProcessTableRow[]> | null = null;

function parsePositiveInteger(value: unknown): number | null {
  const parsed =
    typeof value === 'number'
      ? value
      : typeof value === 'string'
        ? Number.parseInt(value, 10)
        : Number.NaN;
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : null;
}

export function parseWindowsProcessTableJson(stdout: string): WindowsProcessTableRow[] {
  const trimmed = stdout.trim();
  if (!trimmed) {
    return [];
  }

  let parsed: RawWindowsProcessRow | RawWindowsProcessRow[];
  try {
    parsed = JSON.parse(trimmed) as RawWindowsProcessRow | RawWindowsProcessRow[];
  } catch {
    return [];
  }

  const rows = Array.isArray(parsed) ? parsed : [parsed];
  const result: WindowsProcessTableRow[] = [];

  for (const row of rows) {
    const pid = parsePositiveInteger(row?.ProcessId);
    const ppid = parsePositiveInteger(row?.ParentProcessId) ?? 0;
    const command = row?.CommandLine?.trim() ?? '';
    if (!pid || !command) {
      continue;
    }
    result.push({ pid, ppid, command });
  }

  return result;
}

export async function listWindowsProcessTable(
  timeoutMs = 4_000
): Promise<WindowsProcessTableRow[]> {
  const now = Date.now();
  if (cachedProcessTable && cachedProcessTable.expiresAtMs > now) {
    return cachedProcessTable.rows;
  }
  if (inFlightProcessTable) {
    return inFlightProcessTable;
  }

  const nextRead = new Promise<WindowsProcessTableRow[]>((resolve, reject) => {
    execFile(
      'powershell.exe',
      PROCESS_TABLE_ARGS,
      {
        encoding: 'utf8',
        timeout: timeoutMs,
        windowsHide: true,
        maxBuffer: 8 * 1024 * 1024,
      },
      (error, stdout, stderr) => {
        if (error) {
          cachedProcessTable = {
            expiresAtMs: Date.now() + PROCESS_TABLE_ERROR_CACHE_TTL_MS,
            rows: [],
          };
          reject(error);
          return;
        }
        if (stderr?.trim()) {
          cachedProcessTable = {
            expiresAtMs: Date.now() + PROCESS_TABLE_ERROR_CACHE_TTL_MS,
            rows: [],
          };
          reject(new Error(stderr.trim()));
          return;
        }
        const rows = parseWindowsProcessTableJson(String(stdout));
        cachedProcessTable = {
          expiresAtMs: Date.now() + PROCESS_TABLE_CACHE_TTL_MS,
          rows,
        };
        resolve(rows);
      }
    );
  }).finally(() => {
    inFlightProcessTable = null;
  });
  inFlightProcessTable = nextRead;

  return nextRead;
}

export function listWindowsProcessTableSync(timeoutMs = 4_000): WindowsProcessTableRow[] {
  const now = Date.now();
  if (cachedProcessTable && cachedProcessTable.expiresAtMs > now) {
    return cachedProcessTable.rows;
  }

  const stdout = execFileSync('powershell.exe', PROCESS_TABLE_ARGS, {
    encoding: 'utf8',
    timeout: timeoutMs,
    windowsHide: true,
    maxBuffer: 8 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const rows = parseWindowsProcessTableJson(String(stdout));
  cachedProcessTable = {
    expiresAtMs: Date.now() + PROCESS_TABLE_CACHE_TTL_MS,
    rows,
  };
  return rows;
}
