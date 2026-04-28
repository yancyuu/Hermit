import { useEffect, useState } from 'react';

import { api } from '@renderer/api';
import { Button } from '@renderer/components/ui/button';
import { Input } from '@renderer/components/ui/input';
import { Label } from '@renderer/components/ui/label';
import { PlugZap, Plus, Trash2 } from 'lucide-react';

import { SettingsSectionHeader } from '../components/SettingsSectionHeader';

import type { LeadChannelDefinition } from '@shared/types';

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

export const ChannelsSection = (): React.JSX.Element => {
  const [feishuChannels, setFeishuChannels] = useState<FeishuChannelDraft[]>([]);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
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
          return;
        }
        if (snapshot.config.feishu.appId || snapshot.config.feishu.appSecret) {
          setFeishuChannels([
            {
              id: 'feishu-default',
              name: '飞书长连接',
              provider: 'feishu',
              enabled: true,
              feishu: snapshot.config.feishu,
            },
          ]);
        }
      })
      .catch((error) => {
        if (cancelled) return;
        setMessage(error instanceof Error ? error.message : '读取渠道配置失败');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const save = async (): Promise<void> => {
    setSaving(true);
    setMessage(null);
    try {
      const channels = feishuChannels.map((channel) => ({
        ...channel,
        name: channel.name.trim() || '飞书长连接',
        feishu: {
          enabled: channel.enabled,
          appId: channel.feishu.appId.trim(),
          appSecret: channel.feishu.appSecret.trim(),
        },
      }));
      const firstFeishu = channels[0]?.feishu ?? { enabled: false, appId: '', appSecret: '' };
      await api.teams.saveGlobalLeadChannel({
        channels,
        feishu: firstFeishu,
      });
      setMessage('飞书渠道实例已保存。团队负责人可在“渠道”里分别启动监听。');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '保存渠道配置失败');
    } finally {
      setSaving(false);
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

  return (
    <div className="space-y-6">
      <SettingsSectionHeader icon={<PlugZap className="size-3.5" />} title="渠道集成" />
      <p className="-mt-4 text-xs text-[var(--color-text-muted)]">
        统一配置外部渠道密钥；团队负责人只选择要监听的渠道。
      </p>

      <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-raised)] p-4">
        <div className="mb-4">
          <h3 className="text-sm font-medium text-[var(--color-text)]">飞书长连接实例</h3>
          <p className="mt-1 text-xs leading-relaxed text-[var(--color-text-muted)]">
            使用飞书企业自建应用的长连接模式接收消息事件。请在飞书后台启用“使用长连接接收事件”，并订阅
            <span className="font-mono"> im.message.receive_v1</span>。
          </p>
        </div>

        <div className="space-y-3">
          {feishuChannels.map((channel, index) => (
            <div
              key={channel.id}
              className="rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-3"
            >
              <div className="mb-3 flex items-center justify-between gap-3">
                <p className="text-xs font-medium text-[var(--color-text)]">飞书实例 {index + 1}</p>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 gap-1 px-2 text-xs text-red-300 hover:text-red-200"
                  onClick={() =>
                    setFeishuChannels((channels) =>
                      channels.filter((item) => item.id !== channel.id)
                    )
                  }
                  disabled={saving}
                >
                  <Trash2 className="size-3.5" />
                  删除
                </Button>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
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
                <div className="space-y-1.5 sm:col-span-2">
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
              </div>
            </div>
          ))}
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setFeishuChannels((channels) => [...channels, createFeishuDraft()])}
              disabled={saving}
            >
              <Plus className="mr-1 size-3.5" />
              新增飞书实例
            </Button>
            <Button type="button" onClick={() => void save()} disabled={saving}>
              {saving ? '保存中...' : '保存渠道实例'}
            </Button>
          </div>
          {message ? <p className="text-xs text-[var(--color-text-muted)]">{message}</p> : null}
        </div>
      </div>

      <div className="rounded-lg border border-dashed border-[var(--color-border)] bg-[var(--color-surface)] p-4">
        <h3 className="text-sm font-medium text-[var(--color-text)]">后续多渠道</h3>
        <p className="mt-1 text-xs leading-relaxed text-[var(--color-text-muted)]">
          底层已按渠道实例列表保存，后续可继续添加企业微信、钉钉、Slack、Telegram 和多个命名
          Webhook。团队负责人只绑定需要监听的渠道实例。
        </p>
      </div>
    </div>
  );
};
