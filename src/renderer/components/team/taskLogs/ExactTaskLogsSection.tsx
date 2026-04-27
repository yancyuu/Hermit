import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { api } from '@renderer/api';
import { asEnhancedChunkArray } from '@renderer/types/data';
import { AlertCircle, FileText, Loader2 } from 'lucide-react';

import { ExactTaskLogCard, type ExactTaskLogDetailState } from './ExactTaskLogCard';

import type { BoardTaskExactLogSummary } from '@shared/types';

interface ExactTaskLogsSectionProps {
  teamName: string;
  taskId: string;
}

export const ExactTaskLogsSection = ({
  teamName,
  taskId,
}: ExactTaskLogsSectionProps): React.JSX.Element => {
  const [summaries, setSummaries] = useState<BoardTaskExactLogSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [detailStates, setDetailStates] = useState<Record<string, ExactTaskLogDetailState>>({});
  const latestRequestSeqById = useRef<Record<string, number>>({});

  const loadSummaries = useCallback(async (): Promise<BoardTaskExactLogSummary[]> => {
    const result = await api.teams.getTaskExactLogSummaries(teamName, taskId);
    const nextItems = [...result.items].sort((left, right) => {
      const leftTs = Date.parse(left.timestamp);
      const rightTs = Date.parse(right.timestamp);
      if (Number.isFinite(leftTs) && Number.isFinite(rightTs) && leftTs !== rightTs) {
        return rightTs - leftTs;
      }
      if (left.source.filePath !== right.source.filePath) {
        return left.source.filePath.localeCompare(right.source.filePath);
      }
      if (left.source.sourceOrder !== right.source.sourceOrder) {
        return left.source.sourceOrder - right.source.sourceOrder;
      }
      return left.id.localeCompare(right.id);
    });
    setSummaries(nextItems);
    return nextItems;
  }, [taskId, teamName]);

  useEffect(() => {
    let cancelled = false;

    const run = async (): Promise<void> => {
      try {
        setLoading(true);
        setError(null);
        setExpandedId(null);
        setDetailStates({});
        latestRequestSeqById.current = {};
        const nextItems = await api.teams.getTaskExactLogSummaries(teamName, taskId);
        if (cancelled) return;
        setSummaries(
          [...nextItems.items].sort((left, right) => {
            const leftTs = Date.parse(left.timestamp);
            const rightTs = Date.parse(right.timestamp);
            if (Number.isFinite(leftTs) && Number.isFinite(rightTs) && leftTs !== rightTs) {
              return rightTs - leftTs;
            }
            if (left.source.filePath !== right.source.filePath) {
              return left.source.filePath.localeCompare(right.source.filePath);
            }
            if (left.source.sourceOrder !== right.source.sourceOrder) {
              return left.source.sourceOrder - right.source.sourceOrder;
            }
            return left.id.localeCompare(right.id);
          })
        );
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : '加载精确任务日志失败');
          setSummaries([]);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [taskId, teamName]);

  const fetchDetail = useCallback(
    async (
      summary: Extract<BoardTaskExactLogSummary, { canLoadDetail: true }>,
      retryOnStale: boolean
    ): Promise<void> => {
      const nextSeq = (latestRequestSeqById.current[summary.id] ?? 0) + 1;
      latestRequestSeqById.current[summary.id] = nextSeq;
      setDetailStates((prev) => ({
        ...prev,
        [summary.id]: {
          status: 'loading',
          generation: summary.sourceGeneration,
        },
      }));

      try {
        const result = await api.teams.getTaskExactLogDetail(
          teamName,
          taskId,
          summary.id,
          summary.sourceGeneration
        );
        if (latestRequestSeqById.current[summary.id] !== nextSeq) {
          return;
        }

        if (result.status === 'stale' && retryOnStale) {
          const refreshed = await loadSummaries();
          const refreshedSummary = refreshed.find(
            (item): item is Extract<BoardTaskExactLogSummary, { canLoadDetail: true }> =>
              item.id === summary.id && item.canLoadDetail
          );
          if (!refreshedSummary) {
            setDetailStates((prev) => ({
              ...prev,
              [summary.id]: { status: 'missing' },
            }));
            return;
          }
          await fetchDetail(refreshedSummary, false);
          return;
        }

        if (result.status === 'ok') {
          setDetailStates((prev) => ({
            ...prev,
            [summary.id]: {
              status: 'ok',
              generation: summary.sourceGeneration,
              chunks: asEnhancedChunkArray(result.detail.chunks),
            },
          }));
          return;
        }

        setDetailStates((prev) => ({
          ...prev,
          [summary.id]: { status: 'missing', generation: summary.sourceGeneration },
        }));
      } catch (detailError) {
        if (latestRequestSeqById.current[summary.id] !== nextSeq) {
          return;
        }
        setDetailStates((prev) => ({
          ...prev,
          [summary.id]: {
            status: 'error',
            generation: summary.sourceGeneration,
            error: detailError instanceof Error ? detailError.message : '加载精确任务日志失败',
          },
        }));
      }
    },
    [loadSummaries, taskId, teamName]
  );

  const handleToggle = useCallback(
    async (summary: BoardTaskExactLogSummary): Promise<void> => {
      if (!summary.canLoadDetail) {
        return;
      }
      if (expandedId === summary.id) {
        setExpandedId(null);
        return;
      }
      setExpandedId(summary.id);

      const existing = detailStates[summary.id];
      if (existing?.generation === summary.sourceGeneration && existing.status !== 'error') {
        return;
      }

      await fetchDetail(summary, true);
    },
    [detailStates, expandedId, fetchDetail]
  );

  const visibleSummaries = useMemo(() => summaries, [summaries]);

  if (loading && visibleSummaries.length === 0) {
    return (
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <h4 className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--color-text-muted)]">
            精确任务日志
          </h4>
        </div>
        <div className="flex items-center gap-2 py-4 text-xs text-[var(--color-text-muted)]">
          <Loader2 size={12} className="animate-spin" />
          正在加载精确任务日志...
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <h4 className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--color-text-muted)]">
            精确任务日志
          </h4>
        </div>
        <div className="flex items-center gap-2 py-4 text-xs text-red-400">
          <AlertCircle size={14} />
          {error}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <h4 className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--color-text-muted)]">
          精确任务日志
        </h4>
      </div>
      <p className="text-xs text-[var(--color-text-muted)]">
        精确匹配的转录片段会使用与日志页相同的执行日志视图展示。
      </p>

      {visibleSummaries.length === 0 ? (
        <div className="py-8 text-center text-xs text-[var(--color-text-muted)]">
          <FileText size={20} className="mx-auto mb-2 opacity-40" />
          暂无精确任务日志
          <p className="mt-1 text-[10px] opacity-60">
            当明确关联任务的转录元数据可用时，精确转录片段会显示在这里。
          </p>
        </div>
      ) : (
        <div className="w-full min-w-0 space-y-1.5">
          {visibleSummaries.map((summary) => (
            <ExactTaskLogCard
              key={summary.id}
              summary={summary}
              expanded={expandedId === summary.id}
              detailState={detailStates[summary.id]}
              onToggle={() => void handleToggle(summary)}
            />
          ))}
        </div>
      )}
    </div>
  );
};
