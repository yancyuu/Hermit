import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { api } from '@renderer/api';
import { MemberExecutionLog } from '@renderer/components/team/members/MemberExecutionLog';
import { asEnhancedChunkArray } from '@renderer/types/data';
import { AlertCircle, Clock, FileText, Loader2 } from 'lucide-react';

import type {
  BoardTaskLogActor,
  BoardTaskLogSegment,
  BoardTaskLogStreamResponse,
} from '@shared/types';

interface TaskLogStreamSectionProps {
  teamName: string;
  taskId: string;
  taskStatus?: string;
  liveEnabled?: boolean;
}

const LIVE_RELOAD_DEBOUNCE_MS = 350;

function formatRelativeTime(isoString: string): string {
  const date = new Date(isoString);
  const diffMs = Date.now() - date.getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  const diffHours = Math.floor(diffMin / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (!Number.isFinite(diffMs)) return '--';
  if (diffMin < 1) return '刚刚';
  if (diffMin < 60) return `${diffMin} 分钟前`;
  if (diffHours < 24) return `${diffHours} 小时前`;
  return `${diffDays} 天前`;
}

function actorLabel(actor: BoardTaskLogActor): string {
  if (actor.memberName) {
    return actor.memberName;
  }
  if (actor.role === 'lead' || actor.isSidechain === false) {
    return '负责人会话';
  }
  if (actor.agentId) {
    return `成员 ${actor.agentId.slice(0, 8)}`;
  }
  return `成员会话 ${actor.sessionId.slice(0, 8)}`;
}

function normalizeResponse(response: BoardTaskLogStreamResponse): BoardTaskLogStreamResponse {
  return {
    participants: response.participants,
    defaultFilter: response.defaultFilter,
    source: response.source,
    runtimeProjection: response.runtimeProjection,
    segments: response.segments.map((segment) => ({
      ...segment,
      chunks: asEnhancedChunkArray(segment.chunks) ?? [],
    })),
  };
}

function buildStableSegmentRenderKey(segment: BoardTaskLogSegment): string {
  const firstChunkId = segment.chunks[0]?.id;
  if (firstChunkId) {
    return `${segment.participantKey}:${firstChunkId}`;
  }
  return `${segment.participantKey}:${segment.startTimestamp}`;
}

function describeStreamSource(stream: BoardTaskLogStreamResponse | null): string {
  if (stream?.source === 'opencode_runtime_attribution') {
    return '按任务归属聚合的 OpenCode 运行日志，使用与日志页相同的执行日志视图展示。';
  }
  if (stream?.source === 'opencode_runtime_fallback') {
    if (stream.runtimeProjection?.fallbackReason === 'task_tool_markers') {
      const spanCount = stream.runtimeProjection.markerSpanCount;
      const spanDetails =
        typeof spanCount === 'number' && spanCount > 1 ? `，覆盖 ${spanCount} 个片段` : '';
      return `根据匹配到的任务工具标记聚合 OpenCode 运行日志${spanDetails}，使用与日志页相同的执行日志视图展示。`;
    }
    return '按任务聚合的 OpenCode 运行日志，使用与日志页相同的执行日志视图展示。';
  }
  return '按任务聚合的转录日志，使用与日志页相同的执行日志视图展示。';
}

const SegmentMarker = ({ segment }: { segment: BoardTaskLogSegment }): React.JSX.Element => {
  return (
    <div className="mb-2 flex items-center gap-2 text-[10px] text-[var(--color-text-muted)]">
      <span className="rounded-full border border-[var(--color-border)] px-2 py-0.5 font-medium text-[var(--color-text-secondary)]">
        {actorLabel(segment.actor)}
      </span>
      <span className="flex items-center gap-1">
        <Clock size={10} />
        {formatRelativeTime(segment.endTimestamp)}
      </span>
    </div>
  );
};

const SegmentBlock = ({
  segment,
  showHeader,
}: {
  segment: BoardTaskLogSegment;
  showHeader: boolean;
}): React.JSX.Element => {
  return (
    <div className="min-w-0 overflow-hidden">
      {showHeader ? <SegmentMarker segment={segment} /> : null}
      <MemberExecutionLog chunks={segment.chunks} memberName={segment.actor.memberName} />
    </div>
  );
};

export const TaskLogStreamSection = ({
  teamName,
  taskId,
  taskStatus,
  liveEnabled = true,
}: TaskLogStreamSectionProps): React.JSX.Element => {
  const [stream, setStream] = useState<BoardTaskLogStreamResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedParticipantKey, setSelectedParticipantKey] = useState<'all' | string>('all');
  const requestSeqRef = useRef(0);
  const streamRef = useRef<BoardTaskLogStreamResponse | null>(null);
  const reloadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    streamRef.current = stream;
  }, [stream]);

  const loadStream = useCallback(
    async (options?: { resetSelection?: boolean; background?: boolean }): Promise<void> => {
      const resetSelection = options?.resetSelection ?? false;
      const background = options?.background ?? false;
      const hadExistingStream = streamRef.current != null;
      const requestSeq = requestSeqRef.current + 1;
      requestSeqRef.current = requestSeq;

      if (!background) {
        setLoading(true);
      }
      setError((prev) => (background ? prev : null));

      try {
        const response = normalizeResponse(await api.teams.getTaskLogStream(teamName, taskId));
        if (requestSeqRef.current !== requestSeq) {
          return;
        }

        setStream(response);
        setSelectedParticipantKey((prev) => {
          if (resetSelection) {
            return response.defaultFilter;
          }
          const availableParticipantKeys = new Set([
            'all',
            ...response.participants.map((participant) => participant.key),
          ]);
          return availableParticipantKeys.has(prev) ? prev : response.defaultFilter;
        });
        setError(null);
      } catch (loadError) {
        if (requestSeqRef.current !== requestSeq) {
          return;
        }

        if (!background || streamRef.current == null) {
          setError(loadError instanceof Error ? loadError.message : '加载任务日志流失败');
          setStream(null);
        }
      } finally {
        if (requestSeqRef.current === requestSeq && (!background || !hadExistingStream)) {
          setLoading(false);
        }
      }
    },
    [taskId, teamName]
  );

  useEffect(() => {
    setStream(null);
    streamRef.current = null;
    setError(null);
    setSelectedParticipantKey('all');
    requestSeqRef.current += 1;
    if (reloadTimerRef.current) {
      clearTimeout(reloadTimerRef.current);
      reloadTimerRef.current = null;
    }
    void loadStream({ resetSelection: true });
  }, [loadStream]);

  const previousTaskMetaRef = useRef({ taskId, taskStatus });

  useEffect(() => {
    const previousTaskMeta = previousTaskMetaRef.current;
    previousTaskMetaRef.current = { taskId, taskStatus };

    if (previousTaskMeta.taskId !== taskId) {
      return;
    }

    if (
      previousTaskMeta.taskStatus === 'in_progress' &&
      taskStatus &&
      taskStatus !== 'in_progress'
    ) {
      void loadStream({ background: true });
    }
  }, [loadStream, taskId, taskStatus]);

  useEffect(() => {
    if (!liveEnabled) {
      if (reloadTimerRef.current) {
        clearTimeout(reloadTimerRef.current);
        reloadTimerRef.current = null;
      }
      return;
    }

    const scheduleReload = (): void => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
        return;
      }
      if (reloadTimerRef.current) {
        clearTimeout(reloadTimerRef.current);
      }
      reloadTimerRef.current = setTimeout(() => {
        reloadTimerRef.current = null;
        void loadStream({ background: true });
      }, LIVE_RELOAD_DEBOUNCE_MS);
    };

    const unsubscribe = api.teams.onTeamChange?.((_event, event) => {
      if (event.teamName !== teamName) {
        return;
      }
      const shouldReload =
        event.type === 'log-source-change' ||
        (event.type === 'task-log-change' && event.taskId === taskId);
      if (!shouldReload) {
        return;
      }
      scheduleReload();
    });

    const handleVisibilityChange = (): void => {
      if (document.visibilityState === 'visible') {
        scheduleReload();
      }
    };

    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', handleVisibilityChange);
    }

    return () => {
      if (reloadTimerRef.current) {
        clearTimeout(reloadTimerRef.current);
        reloadTimerRef.current = null;
      }
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', handleVisibilityChange);
      }
      if (typeof unsubscribe === 'function') {
        unsubscribe();
      }
    };
  }, [liveEnabled, loadStream, taskId, teamName]);

  const participants = stream?.participants ?? [];
  const showChips = participants.length > 1;
  const streamDescription = useMemo(() => describeStreamSource(stream), [stream]);
  const visibleSegments = useMemo(() => {
    const source = stream?.segments ?? [];
    const filtered =
      selectedParticipantKey === 'all'
        ? source
        : source.filter((segment) => segment.participantKey === selectedParticipantKey);
    return [...filtered].reverse();
  }, [selectedParticipantKey, stream?.segments]);

  const showSegmentHeaders =
    participants.length > 1 || (selectedParticipantKey !== 'all' && visibleSegments.length > 1);

  if (loading) {
    return (
      <div className="space-y-2">
        <h4 className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--color-text-muted)]">
          任务日志流
        </h4>
        <div className="flex items-center gap-2 py-4 text-xs text-[var(--color-text-muted)]">
          <Loader2 size={12} className="animate-spin" />
          正在加载任务日志流...
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-2">
        <h4 className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--color-text-muted)]">
          任务日志流
        </h4>
        <div className="flex items-center gap-2 py-4 text-xs text-red-400">
          <AlertCircle size={14} />
          {error}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <h4 className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--color-text-muted)]">
        任务日志流
      </h4>
      <p className="text-xs text-[var(--color-text-muted)]">{streamDescription}</p>

      {showChips ? (
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            className={`rounded-full border px-2.5 py-1 text-[11px] transition-colors ${
              selectedParticipantKey === 'all'
                ? 'bg-[var(--color-accent)]/10 border-[var(--color-accent)] text-[var(--color-text)]'
                : 'border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-text)]'
            }`}
            onClick={() => setSelectedParticipantKey('all')}
          >
            全部
          </button>
          {participants.map((participant) => (
            <button
              key={participant.key}
              type="button"
              className={`rounded-full border px-2.5 py-1 text-[11px] transition-colors ${
                selectedParticipantKey === participant.key
                  ? 'bg-[var(--color-accent)]/10 border-[var(--color-accent)] text-[var(--color-text)]'
                  : 'border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-text)]'
              }`}
              onClick={() => setSelectedParticipantKey(participant.key)}
            >
              {participant.label}
            </button>
          ))}
        </div>
      ) : null}

      {visibleSegments.length === 0 ? (
        <div className="py-8 text-center text-xs text-[var(--color-text-muted)]">
          <FileText size={20} className="mx-auto mb-2 opacity-40" />
          暂无任务日志流
          <p className="mt-1 text-[10px] opacity-60">
            当转录元数据或运行时投影可用时，任务相关日志会显示在这里。
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {visibleSegments.map((segment) => (
            <SegmentBlock
              key={buildStableSegmentRenderKey(segment)}
              segment={segment}
              showHeader={showSegmentHeaders}
            />
          ))}
        </div>
      )}
    </div>
  );
};
