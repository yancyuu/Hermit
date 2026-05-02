import type { CursorRuntimeNormalizedEvent } from '../../contracts';

interface CursorContentBlock {
  type?: unknown;
  text?: unknown;
}

interface CursorStreamJsonEvent {
  type?: unknown;
  subtype?: unknown;
  session_id?: unknown;
  timestamp_ms?: unknown;
  message?: {
    content?: unknown;
  };
  result?: unknown;
  duration_ms?: unknown;
  model?: unknown;
  cwd?: unknown;
  attempt?: unknown;
  is_error?: unknown;
  [key: string]: unknown;
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

function readNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function extractContentText(content: unknown): string | null {
  if (typeof content === 'string') {
    return content;
  }
  if (!Array.isArray(content)) {
    return null;
  }
  const text = content
    .map((block: CursorContentBlock) => {
      if (block?.type === 'text' && typeof block.text === 'string') {
        return block.text;
      }
      return '';
    })
    .filter(Boolean)
    .join('');
  return text || null;
}

function normalizeEventType(rawType: string | null): CursorRuntimeNormalizedEvent['type'] {
  switch (rawType) {
    case 'system':
      return 'session';
    case 'user':
      return 'user';
    case 'assistant':
      return 'assistant';
    case 'result':
      return 'result';
    case 'connection':
      return 'connection';
    case 'retry':
      return 'retry';
    default:
      return 'raw';
  }
}

export function parseCursorStreamJsonLines(stdout: string): CursorStreamJsonEvent[] {
  const events: CursorStreamJsonEvent[] = [];
  for (const rawLine of stdout.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }
    try {
      const parsed = JSON.parse(line) as CursorStreamJsonEvent;
      if (parsed && typeof parsed === 'object') {
        events.push(parsed);
      }
    } catch {
      events.push({
        type: 'parse_error',
        result: line,
      });
    }
  }
  return events;
}

export function normalizeCursorStreamEvent(
  event: CursorStreamJsonEvent
): CursorRuntimeNormalizedEvent {
  const rawType = readString(event.type);
  const rawSubtype = readString(event.subtype);
  const normalizedType = normalizeEventType(rawType);
  const resultText = readString(event.result);
  const messageText = extractContentText(event.message?.content);

  return {
    type: normalizedType,
    sessionId: readString(event.session_id),
    text: resultText ?? messageText,
    rawType,
    rawSubtype,
    timestampMs: readNumber(event.timestamp_ms),
    metadata: {
      attempt: event.attempt,
      cwd: event.cwd,
      durationMs: event.duration_ms,
      isError: event.is_error,
      model: event.model,
    },
  };
}

export function normalizeCursorStreamJson(stdout: string): CursorRuntimeNormalizedEvent[] {
  return parseCursorStreamJsonLines(stdout).map(normalizeCursorStreamEvent);
}

export function summarizeCursorRuntimeEvents(events: readonly CursorRuntimeNormalizedEvent[]): {
  sessionId: string | null;
  resultText: string;
  diagnostics: string[];
} {
  let sessionId: string | null = null;
  let resultText = '';
  const diagnostics: string[] = [];

  for (const event of events) {
    if (event.sessionId) {
      sessionId = event.sessionId;
    }
    if (event.type === 'assistant' && event.text) {
      resultText = event.text;
    }
    if (event.type === 'result' && event.text) {
      resultText = event.text;
    }
    if (event.type === 'connection' && event.rawSubtype) {
      diagnostics.push(`connection:${event.rawSubtype}`);
    }
    if (event.type === 'retry' && event.rawSubtype) {
      diagnostics.push(`retry:${event.rawSubtype}`);
    }
    if (event.type === 'raw' && event.rawType === 'parse_error' && event.text) {
      diagnostics.push(`unparsed:${event.text.slice(0, 160)}`);
    }
  }

  return {
    sessionId,
    resultText,
    diagnostics,
  };
}
