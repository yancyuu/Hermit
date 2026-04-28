import { useCallback, useEffect, useMemo, useState } from 'react';

import { api } from '@renderer/api';
import { cn } from '@renderer/lib/utils';
import { Radio, RefreshCw, Settings } from 'lucide-react';

import { Button } from '../../ui/button';

import type { LeadChannelDefinition, LeadChannelSnapshot, LeadChannelStatus } from '@shared/types';

interface LeadChannelPanelProps {
  teamName?: string;
  className?: string;
}

function resolveFeishuChannels(
  snapshot: Awaited<ReturnType<typeof api.teams.getGlobalLeadChannel>>
): LeadChannelDefinition[] {
  const channels = snapshot.config.channels.filter(
    (channel) =>
      channel.provider === 'feishu' &&
      channel.enabled !== false &&
      Boolean(channel.feishu?.appId.trim() && channel.feishu.appSecret.trim())
  );
  if (channels.length > 0) return channels;
  if (snapshot.config.feishu.appId.trim() && snapshot.config.feishu.appSecret.trim()) {
    return [
      {
        id: 'feishu-default',
        name: '飞书长连接',
        provider: 'feishu',
        enabled: true,
        feishu: snapshot.config.feishu,
      },
    ];
  }
  return [];
}

function statusTone(status?: LeadChannelStatus): string {
  if (!status)
    return 'border-[var(--color-border)] bg-[var(--color-surface-raised)] text-[var(--color-text-muted)]';
  if (status.state === 'connected')
    return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300';
  if (status.state === 'connecting' || status.state === 'reconnecting') {
    return 'border-sky-500/30 bg-sky-500/10 text-sky-300';
  }
  if (status.state === 'error') return 'border-red-500/35 bg-red-500/10 text-red-300';
  return 'border-[var(--color-border)] bg-[var(--color-surface-raised)] text-[var(--color-text-muted)]';
}

function statusLabel(status?: LeadChannelStatus): string {
  if (!status) return '未启动';
  if (status.message) return status.message;
  if (status.state === 'connected') return '已连接';
  if (status.state === 'connecting') return '正在连接';
  if (status.state === 'reconnecting') return '重连中';
  if (status.state === 'error') return '连接失败';
  return '已停止';
}

function isLongConnecting(status?: LeadChannelStatus): boolean {
  if (!status?.startedAt || (status.state !== 'connecting' && status.state !== 'reconnecting'))
    return false;
  return Date.now() - new Date(status.startedAt).getTime() > 15_000;
}

function formatTime(value: Date | null): string {
  if (!value) return '尚未刷新';
  return value.toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

export const LeadChannelPanel = ({
  teamName,
  className,
}: LeadChannelPanelProps): React.JSX.Element => {
  const [channels, setChannels] = useState<LeadChannelDefinition[]>([]);
  const [statusesById, setStatusesById] = useState<Record<string, LeadChannelStatus>>({});
  const [panelError, setPanelError] = useState<string | null>(null);
  const [busyChannelId, setBusyChannelId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<Date | null>(null);

  const hasPendingConnection = useMemo(
    () =>
      Object.values(statusesById).some(
        (status) => status.state === 'connecting' || status.state === 'reconnecting'
      ),
    [statusesById]
  );

  const applySnapshot = useCallback((snapshot: LeadChannelSnapshot): void => {
    setStatusesById(snapshot.statusesByChannel);
    setLastRefreshedAt(new Date());
  }, []);

  const refresh = useCallback(
    async (silent = false): Promise<void> => {
      if (!silent) setRefreshing(true);
      setPanelError(null);
      try {
        const globalSnapshot = await api.teams.getGlobalLeadChannel();
        setChannels(resolveFeishuChannels(globalSnapshot));
        if (teamName) {
          applySnapshot(await api.teams.getLeadChannel(teamName));
        } else {
          setStatusesById({});
          setLastRefreshedAt(new Date());
        }
      } catch (error) {
        setPanelError(error instanceof Error ? error.message : '读取渠道状态失败');
      } finally {
        if (!silent) setRefreshing(false);
      }
    },
    [applySnapshot, teamName]
  );

  useEffect(() => {
    void refresh(true);
  }, [refresh]);

  useEffect(() => {
    if (!teamName || !hasPendingConnection) return;
    const timer = window.setInterval(() => {
      void refresh(true);
    }, 2500);
    return () => window.clearInterval(timer);
  }, [hasPendingConnection, refresh, teamName]);

  const startChannel = async (channelId: string): Promise<void> => {
    if (!teamName) return;
    setBusyChannelId(channelId);
    setPanelError(null);
    try {
      applySnapshot(await api.teams.startFeishuLeadChannel(teamName, channelId));
      window.setTimeout(() => void refresh(true), 1200);
      window.setTimeout(() => void refresh(true), 3500);
    } catch (error) {
      setPanelError(error instanceof Error ? error.message : '启动飞书长连接失败');
    } finally {
      setBusyChannelId(null);
    }
  };

  const stopChannel = async (channelId: string): Promise<void> => {
    if (!teamName) return;
    setBusyChannelId(channelId);
    setPanelError(null);
    try {
      applySnapshot(await api.teams.stopFeishuLeadChannel(teamName, channelId));
    } catch (error) {
      setPanelError(error instanceof Error ? error.message : '停止飞书长连接失败');
    } finally {
      setBusyChannelId(null);
    }
  };

  return (
    <div className={cn('space-y-3', className)}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-[var(--color-text)]">负责人渠道监听</p>
          <p className="mt-0.5 text-[11px] leading-relaxed text-[var(--color-text-muted)]">
            外部消息会进入负责人收件箱，由负责人继续记录、回复或分派给成员。渠道接入在“设置 →
            渠道”统一配置。
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7 shrink-0 gap-1 px-2 text-xs"
          disabled={refreshing}
          onClick={() => void refresh(false)}
        >
          <RefreshCw className={cn('size-3.5', refreshing && 'animate-spin')} />
          刷新
        </Button>
      </div>

      <div className="rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Radio className="size-3.5 text-sky-300" />
            <p className="text-xs font-medium text-[var(--color-text)]">飞书长连接实例</p>
          </div>
          <p className="text-[11px] text-[var(--color-text-muted)]">
            最后刷新：{formatTime(lastRefreshedAt)}
          </p>
        </div>

        {channels.length === 0 ? (
          <div className="mt-3 rounded-md border border-dashed border-[var(--color-border)] bg-[var(--color-surface-raised)] p-3">
            <div className="flex items-start gap-2">
              <Settings className="mt-0.5 size-3.5 shrink-0 text-[var(--color-text-muted)]" />
              <p className="text-[11px] leading-relaxed text-[var(--color-text-muted)]">
                还没有可用的飞书实例。请先到“设置 →
                渠道”新增飞书长连接实例，再回到这里给负责人启动监听。
              </p>
            </div>
          </div>
        ) : (
          <div className="mt-3 space-y-2">
            {channels.map((channel) => {
              const status = statusesById[channel.id];
              const pendingTooLong = isLongConnecting(status);
              return (
                <div
                  key={channel.id}
                  className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-surface-raised)] p-3"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="truncate text-xs font-medium text-[var(--color-text)]">
                          {channel.name}
                        </p>
                        <span
                          className={cn(
                            'rounded-full border px-2 py-0.5 text-[10px]',
                            statusTone(status)
                          )}
                        >
                          {status?.state === 'connected'
                            ? '已连接'
                            : status?.state === 'connecting'
                              ? '连接中'
                              : status?.state === 'reconnecting'
                                ? '重连中'
                                : status?.state === 'error'
                                  ? '异常'
                                  : '未启动'}
                        </span>
                      </div>
                      <p className="mt-1 text-[11px] leading-relaxed text-[var(--color-text-muted)]">
                        {statusLabel(status)}
                      </p>
                      {pendingTooLong ? (
                        <p className="mt-1 rounded-md border border-amber-500/25 bg-amber-500/10 px-2 py-1 text-[11px] leading-relaxed text-amber-200">
                          连接等待较久。请检查飞书应用是否启用了“使用长连接接收事件”、App ID/Secret
                          是否正确，并已订阅 im.message.receive_v1。
                        </p>
                      ) : null}
                      {status?.lastEventAt ? (
                        <p className="mt-1 text-[10px] text-[var(--color-text-muted)]">
                          最近收到消息：{new Date(status.lastEventAt).toLocaleString('zh-CN')}
                        </p>
                      ) : null}
                    </div>
                    <div className="flex shrink-0 gap-1">
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        className="h-7 text-xs"
                        disabled={!teamName || busyChannelId === channel.id}
                        onClick={() => void startChannel(channel.id)}
                      >
                        {busyChannelId === channel.id ? '处理中...' : '启动'}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-7 text-xs"
                        disabled={!teamName || busyChannelId === channel.id}
                        onClick={() => void stopChannel(channel.id)}
                      >
                        停止
                      </Button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {panelError ? <p className="mt-3 text-[11px] text-red-300">{panelError}</p> : null}
        {!teamName ? (
          <p className="mt-1 text-[11px] text-amber-300">
            创建团队前无法启动长连接；创建完成后可在团队详情里绑定渠道。
          </p>
        ) : null}
      </div>
    </div>
  );
};
