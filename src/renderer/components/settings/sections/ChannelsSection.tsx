import { useCallback, useEffect, useMemo, useState } from 'react';

import { api } from '@renderer/api';
import { Button } from '@renderer/components/ui/button';
import { Input } from '@renderer/components/ui/input';
import { Label } from '@renderer/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@renderer/components/ui/select';
import { AlertTriangle, CheckCircle2, Loader2, PlugZap, Plus, Trash2, Unplug } from 'lucide-react';

import { SettingsSectionHeader } from '../components/SettingsSectionHeader';

import type { LeadChannelDefinition, LeadChannelStatus, TeamSummary } from '@shared/types';

type FeishuChannelDraft = LeadChannelDefinition & {
  provider: 'feishu';
  feishu: NonNullable<LeadChannelDefinition['feishu']>;
};

function createFeishuDraft(): FeishuChannelDraft {
  const id = `feishu-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  return {
    id,
    name: '飞书长连接',
    provider: 'feishu',
    enabled: true,
    feishu: {
      enabled: true,
      appId: '',
      appSecret: '',
    },
  };
}

function normalizeFeishuChannels(channels: FeishuChannelDraft[]): FeishuChannelDraft[] {
  return channels.map((channel) => ({
    ...channel,
    name: channel.name.trim() || '飞书长连接',
    feishu: {
      enabled: channel.enabled,
      appId: channel.feishu.appId.trim(),
      appSecret: channel.feishu.appSecret.trim(),
    },
  }));
}

function getStatusLabel(status?: LeadChannelStatus): string {
  if (!status) return '未连接';
  if (status.message) return status.message;
  if (status.state === 'connected') return '已连接';
  if (status.state === 'connecting') return '连接中';
  if (status.state === 'reconnecting') return '重连中';
  if (status.state === 'error') return '连接异常';
  return '未连接';
}

function getStatusClassName(status?: LeadChannelStatus): string {
  if (status?.state === 'connected') {
    return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300';
  }
  if (status?.state === 'connecting' || status?.state === 'reconnecting') {
    return 'border-sky-500/30 bg-sky-500/10 text-sky-300';
  }
  if (status?.state === 'error') {
    return 'border-red-500/30 bg-red-500/10 text-red-300';
  }
  return 'border-[var(--color-border)] bg-[var(--color-surface-raised)] text-[var(--color-text-muted)]';
}

function isChannelRunning(status?: LeadChannelStatus): boolean {
  return (
    status?.running === true || status?.state === 'connected' || status?.state === 'connecting'
  );
}

export const ChannelsSection = (): React.JSX.Element => {
  const [feishuChannels, setFeishuChannels] = useState<FeishuChannelDraft[]>([]);
  const [teams, setTeams] = useState<TeamSummary[]>([]);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [busyChannelId, setBusyChannelId] = useState<string | null>(null);
  const [statusesByChannel, setStatusesByChannel] = useState<Record<string, LeadChannelStatus>>({});

  const refreshStatuses = useCallback(async (channels: FeishuChannelDraft[]): Promise<void> => {
    const teamsToRefresh = Array.from(
      new Set(channels.map((channel) => channel.boundTeam).filter((team): team is string => !!team))
    );
    const snapshots = await Promise.all(
      teamsToRefresh.map((teamName) => api.teams.getLeadChannel(teamName).catch(() => null))
    );
    const nextStatuses: Record<string, LeadChannelStatus> = {};
    for (const snapshot of snapshots) {
      if (!snapshot) continue;
      Object.assign(nextStatuses, snapshot.statusesByChannel);
    }
    setStatusesByChannel(nextStatuses);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void api.teams
      .list()
      .then((list) => {
        if (cancelled) return;
        setTeams(list);
      })
      .catch(() => {
        /* ignore */
      });
    void api.teams
      .getGlobalLeadChannel()
      .then((snapshot) => {
        if (cancelled) return;
        const channels = snapshot.config.channels
          .filter(
            (channel): channel is FeishuChannelDraft =>
              channel.provider === 'feishu' && Boolean(channel.feishu)
          )
          .map((channel) => ({
            ...channel,
            feishu: channel.feishu,
          }));
        if (channels.length > 0) {
          setFeishuChannels(channels);
          void refreshStatuses(channels);
          return;
        }
        if (snapshot.config.feishu.appId || snapshot.config.feishu.appSecret) {
          const legacyChannels: FeishuChannelDraft[] = [
            {
              id: 'feishu-default',
              name: '飞书长连接',
              provider: 'feishu' as const,
              enabled: true,
              feishu: snapshot.config.feishu,
            },
          ];
          setFeishuChannels(legacyChannels);
          void refreshStatuses(legacyChannels);
        }
      })
      .catch((error) => {
        if (cancelled) return;
        setMessage(error instanceof Error ? error.message : '读取渠道配置失败');
      });
    return () => {
      cancelled = true;
    };
  }, [refreshStatuses]);

  const save = async (
    channelsToSave: FeishuChannelDraft[] = feishuChannels,
    options: { showMessage?: boolean } = {}
  ): Promise<FeishuChannelDraft[]> => {
    setSaving(true);
    setMessage(null);
    try {
      const channels = normalizeFeishuChannels(channelsToSave);
      const firstFeishu = channels[0]?.feishu ?? { enabled: false, appId: '', appSecret: '' };
      await api.teams.saveGlobalLeadChannel({
        channels,
        feishu: firstFeishu,
      });
      setFeishuChannels(channels);
      if (options.showMessage) {
        setMessage('渠道配置已保存。');
      }
      return channels;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '保存渠道配置失败');
      throw error;
    } finally {
      setSaving(false);
    }
  };

  const startChannel = async (channelId: string): Promise<void> => {
    setBusyChannelId(channelId);
    setMessage(null);
    try {
      const savedChannels = await save(feishuChannels);
      const snapshot = await api.teams.startFeishuLeadChannel(channelId);
      if (snapshot) {
        setStatusesByChannel((prev) => ({ ...prev, ...snapshot.statusesByChannel }));
      } else {
        await refreshStatuses(savedChannels);
      }
      setMessage('已保存并连接渠道。');
    } catch (error) {
      if (error instanceof Error && !error.message.includes('保存渠道配置失败')) {
        setMessage(error instanceof Error ? error.message : '连接渠道失败');
      }
    } finally {
      setBusyChannelId(null);
    }
  };

  const stopChannel = async (channelId: string): Promise<void> => {
    setBusyChannelId(channelId);
    setMessage(null);
    try {
      const snapshot = await api.teams.stopFeishuLeadChannel(channelId);
      if (snapshot) {
        setStatusesByChannel((prev) => ({ ...prev, ...snapshot.statusesByChannel }));
      } else {
        await refreshStatuses(feishuChannels);
      }
      setMessage('渠道已断开。');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '断开渠道失败');
    } finally {
      setBusyChannelId(null);
    }
  };

  const updateFeishuChannel = (
    id: string,
    updater: (channel: FeishuChannelDraft) => FeishuChannelDraft
  ): void => {
    setFeishuChannels((channels) =>
      channels.map((channel) => (channel.id === id ? updater(channel) : channel))
    );
  };

  const removeChannel = async (channelId: string): Promise<void> => {
    const nextChannels = feishuChannels.filter((item) => item.id !== channelId);
    setFeishuChannels(nextChannels);
    setBusyChannelId(channelId);
    try {
      await save(nextChannels);
      setStatusesByChannel((prev) => {
        const next = { ...prev };
        delete next[channelId];
        return next;
      });
      setMessage('渠道实例已删除并保存。');
    } catch {
      // save() already sets the visible error.
    } finally {
      setBusyChannelId(null);
    }
  };

  const connectedCount = useMemo(
    () =>
      feishuChannels.filter((channel) => statusesByChannel[channel.id]?.state === 'connected')
        .length,
    [feishuChannels, statusesByChannel]
  );

  return (
    <div className="space-y-4">
      <SettingsSectionHeader icon={<PlugZap className="size-3.5" />} title="渠道集成" />
      <p className="-mt-4 text-xs text-[var(--color-text-muted)]">
        将外部消息源绑定到团队负责人。连接时会自动保存配置，避免“已编辑但未生效”。
      </p>

      <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-raised)]">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--color-border)] px-4 py-3">
          <div>
            <h3 className="text-sm font-medium text-[var(--color-text)]">飞书消息源</h3>
            <p className="mt-1 text-xs leading-relaxed text-[var(--color-text-muted)]">
              使用飞书企业自建应用长连接接收消息事件。需要启用长连接并订阅
              <span className="font-mono"> im.message.receive_v1</span>。
            </p>
          </div>
          <div className="flex items-center gap-2 text-[11px] text-[var(--color-text-muted)]">
            <span>{feishuChannels.length} 个实例</span>
            <span>·</span>
            <span>{connectedCount} 个已连接</span>
          </div>
        </div>

        <div className="space-y-2 p-3">
          {feishuChannels.map((channel, index) => (
            <div
              key={channel.id}
              className="rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-3"
            >
              <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-xs font-medium text-[var(--color-text)]">
                      飞书实例 {index + 1}
                    </p>
                    <span
                      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] ${getStatusClassName(statusesByChannel[channel.id])}`}
                    >
                      {statusesByChannel[channel.id]?.state === 'connected' ? (
                        <CheckCircle2 className="size-3" />
                      ) : statusesByChannel[channel.id]?.state === 'error' ? (
                        <AlertTriangle className="size-3" />
                      ) : busyChannelId === channel.id ? (
                        <Loader2 className="size-3 animate-spin" />
                      ) : null}
                      {getStatusLabel(statusesByChannel[channel.id])}
                    </span>
                  </div>
                  {statusesByChannel[channel.id]?.lastEventAt ? (
                    <p className="mt-1 text-[10px] text-[var(--color-text-muted)]">
                      最近事件：
                      {new Date(statusesByChannel[channel.id].lastEventAt!).toLocaleString()}
                    </p>
                  ) : null}
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 gap-1 px-2 text-xs text-red-300 hover:bg-red-500/10 hover:text-red-200"
                  onClick={() => void removeChannel(channel.id)}
                  disabled={saving || busyChannelId === channel.id}
                >
                  <Trash2 className="size-3.5" />
                  删除
                </Button>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor={`${channel.id}-name`}>实例名称</Label>
                  <Input
                    id={`${channel.id}-name`}
                    value={channel.name}
                    onChange={(event) =>
                      updateFeishuChannel(channel.id, (item) => ({
                        ...item,
                        name: event.target.value,
                      }))
                    }
                    placeholder="如：售前飞书群"
                    disabled={saving}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor={`${channel.id}-app-id`}>App ID</Label>
                  <Input
                    id={`${channel.id}-app-id`}
                    value={channel.feishu.appId}
                    onChange={(event) =>
                      updateFeishuChannel(channel.id, (item) => ({
                        ...item,
                        feishu: { ...item.feishu, appId: event.target.value },
                      }))
                    }
                    placeholder="cli_xxx"
                    disabled={saving}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor={`${channel.id}-app-secret`}>App Secret</Label>
                  <Input
                    id={`${channel.id}-app-secret`}
                    type="password"
                    value={channel.feishu.appSecret}
                    onChange={(event) =>
                      updateFeishuChannel(channel.id, (item) => ({
                        ...item,
                        feishu: { ...item.feishu, appSecret: event.target.value },
                      }))
                    }
                    placeholder="飞书应用密钥"
                    disabled={saving}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>绑定团队</Label>
                  <Select
                    value={channel.boundTeam ?? '__none__'}
                    onValueChange={(value) =>
                      updateFeishuChannel(channel.id, (item) => ({
                        ...item,
                        boundTeam: value === '__none__' ? undefined : value,
                      }))
                    }
                    disabled={saving}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="选择要绑定的团队" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">不绑定</SelectItem>
                      {teams.map((team) => (
                        <SelectItem key={team.teamName} value={team.teamName}>
                          {team.displayName || team.teamName}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="mt-3 space-y-2">
                <p className="text-[11px] leading-relaxed text-[var(--color-text-muted)]">
                  连接前会保存当前实例列表和密钥。修改团队或密钥后直接重新连接即可生效。
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    className="h-7 gap-1 text-xs"
                    disabled={
                      !channel.boundTeam ||
                      !channel.feishu.appId.trim() ||
                      !channel.feishu.appSecret.trim() ||
                      busyChannelId === channel.id
                    }
                    onClick={() => void startChannel(channel.id)}
                  >
                    {busyChannelId === channel.id ? (
                      <Loader2 className="size-3 animate-spin" />
                    ) : (
                      <PlugZap className="size-3" />
                    )}
                    {busyChannelId === channel.id ? '保存并连接中...' : '保存并连接'}
                  </Button>
                  {isChannelRunning(statusesByChannel[channel.id]) ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-7 gap-1 text-xs"
                      disabled={busyChannelId === channel.id}
                      onClick={() => void stopChannel(channel.id)}
                    >
                      <Unplug className="size-3" />
                      断开
                    </Button>
                  ) : null}
                </div>
              </div>
            </div>
          ))}
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setFeishuChannels((channels) => [...channels, createFeishuDraft()])}
              disabled={saving}
            >
              <Plus className="mr-1 size-3.5" />
              新增飞书实例
            </Button>
            <span className="text-[11px] text-[var(--color-text-muted)]">
              每个实例使用&ldquo;保存并连接&rdquo;生效；删除会立即保存。
            </span>
          </div>
          {message ? <p className="text-xs text-[var(--color-text-muted)]">{message}</p> : null}
        </div>
      </div>

      <p className="text-[11px] leading-relaxed text-[var(--color-text-muted)]">
        后续建议把这里抽成统一事件总线：飞书、Webhook、GitHub
        事件和企业消息源都先归一成事件，再路由到团队负责人或团队看板。
      </p>
    </div>
  );
};
