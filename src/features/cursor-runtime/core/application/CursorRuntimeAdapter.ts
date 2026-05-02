import type {
  CursorRuntimeRunRequest,
  CursorRuntimeRunResult,
  CursorRuntimeStatus,
} from '../../contracts';

export interface CursorRuntimeAdapter {
  readonly id: 'cursor';

  probeStatus(): Promise<CursorRuntimeStatus>;

  runOneShot(request: CursorRuntimeRunRequest): Promise<CursorRuntimeRunResult>;

  runSoloTurn(request: CursorRuntimeRunRequest): Promise<CursorRuntimeRunResult>;

  cancel(runId: string): boolean;
}
