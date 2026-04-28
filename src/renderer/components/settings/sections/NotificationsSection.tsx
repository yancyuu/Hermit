/**
 * NotificationsSection - Notification settings including triggers and ignored repositories.
 */

import { useState } from 'react';

import { api } from '@renderer/api';
import {
  RepositoryDropdown,
  SelectedRepositoryItem,
} from '@renderer/components/common/RepositoryDropdown';
import {
  AlertTriangle,
  ArrowRightLeft,
  Bell,
  BellRing,
  CheckCircle2,
  CirclePlus,
  Clock,
  ExternalLink,
  EyeOff,
  GitBranch,
  HelpCircle,
  Inbox,
  Info,
  Mail,
  MessageSquare,
  PartyPopper,
  Rocket,
  Send,
  ShieldQuestion,
  Users,
  Volume2,
} from 'lucide-react';

import { SettingRow, SettingsSectionHeader, SettingsSelect, SettingsToggle } from '../components';
import { NotificationTriggerSettings } from '../NotificationTriggerSettings';

import type { RepositoryDropdownItem, SafeConfig } from '../hooks/useSettingsConfig';
import type { NotificationTrigger } from '@renderer/types/data';
import type { TeamReviewState, TeamTaskStatus } from '@shared/types';

/** Notification targets span workflow status plus the explicit review axis. */
type NotifiableStatus =
  | TeamTaskStatus
  | Extract<TeamReviewState, 'review' | 'needsFix' | 'approved'>;

// Snooze duration options
const SNOOZE_OPTIONS = [
  { value: 15, label: '15 minutes' },
  { value: 30, label: '30 minutes' },
  { value: 60, label: '1 hour' },
  { value: 120, label: '2 hours' },
  { value: 240, label: '4 hours' },
  { value: -1, label: 'Until tomorrow' },
] as const;

interface NotificationsSectionProps {
  readonly safeConfig: SafeConfig;
  readonly saving: boolean;
  readonly isSnoozed: boolean;
  readonly ignoredRepositoryItems: RepositoryDropdownItem[];
  readonly excludedRepositoryIds: string[];
  readonly onNotificationToggle: (
    key:
      | 'enabled'
      | 'soundEnabled'
      | 'includeSubagentErrors'
      | 'notifyOnLeadInbox'
      | 'notifyOnUserInbox'
      | 'notifyOnClarifications'
      | 'notifyOnStatusChange'
      | 'notifyOnTaskComments'
      | 'notifyOnTaskCreated'
      | 'notifyOnAllTasksCompleted'
      | 'notifyOnCrossTeamMessage'
      | 'notifyOnTeamLaunched'
      | 'notifyOnToolApproval'
      | 'autoResumeOnRateLimit'
      | 'statusChangeOnlySolo',
    value: boolean
  ) => void;
  readonly onStatusChangeStatusesUpdate: (statuses: string[]) => void;
  readonly onSnooze: (minutes: number) => Promise<void>;
  readonly onClearSnooze: () => Promise<void>;
  readonly onAddIgnoredRepository: (item: RepositoryDropdownItem) => Promise<void>;
  readonly onRemoveIgnoredRepository: (repositoryId: string) => Promise<void>;
  readonly onAddTrigger: (trigger: Omit<NotificationTrigger, 'isBuiltin'>) => Promise<void>;
  readonly onUpdateTrigger: (
    triggerId: string,
    updates: Partial<NotificationTrigger>
  ) => Promise<void>;
  readonly onRemoveTrigger: (triggerId: string) => Promise<void>;
}

export const NotificationsSection = ({
  safeConfig,
  saving,
  isSnoozed,
  ignoredRepositoryItems,
  excludedRepositoryIds,
  onNotificationToggle,
  onSnooze,
  onClearSnooze,
  onAddIgnoredRepository,
  onRemoveIgnoredRepository,
  onAddTrigger,
  onUpdateTrigger,
  onRemoveTrigger,
  onStatusChangeStatusesUpdate,
}: NotificationsSectionProps): React.JSX.Element => {
  const [testStatus, setTestStatus] = useState<'idle' | 'sending' | 'success' | 'error'>('idle');
  const [testError, setTestError] = useState<string | null>(null);

  const handleTestNotification = async (): Promise<void> => {
    setTestStatus('sending');
    setTestError(null);
    try {
      const result = await api.notifications.testNotification();
      if (result.success) {
        setTestStatus('success');
        setTimeout(() => setTestStatus('idle'), 3000);
      } else {
        setTestStatus('error');
        setTestError(result.error ?? 'Unknown error');
        setTimeout(() => setTestStatus('idle'), 5000);
      }
    } catch (err) {
      console.error('[notifications] testNotification failed:', err);
      setTestStatus('error');
      const message = err instanceof Error ? err.message : 'Failed to send test notification';
      setTestError(message);
      setTimeout(() => setTestStatus('idle'), 5000);
    }
  };

  const isDev = import.meta.env.DEV;

  return (
    <div>
      {/* Dev-mode warning */}
      {isDev ? (
        <div
          className="mb-4 flex items-start gap-2.5 rounded-lg border p-3"
          style={{
            borderColor: 'rgba(234, 179, 8, 0.2)',
            backgroundColor: 'rgba(234, 179, 8, 0.05)',
          }}
        >
          <Info className="mt-0.5 size-4 shrink-0 text-yellow-500" />
          <div>
            <div className="text-sm font-medium text-yellow-500">开发模式</div>
            <div className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
              开发模式下通知可能无法正常工作。macOS 会把应用识别为 &quot;Electron&quot;（bundle ID
              <code className="text-xs">com.github.Electron</code>
              ），而不是正式应用名称。请到系统设置 → 通知 → Electron 检查权限。
            </div>
          </div>
        </div>
      ) : null}

      {/* Notification Settings */}
      <SettingsSectionHeader title="通知设置" icon={<Bell className="size-3.5" />} />
      <SettingRow
        label="启用系统通知"
        description="为错误和事件显示系统通知"
        icon={<BellRing className="size-4" />}
      >
        <SettingsToggle
          enabled={safeConfig.notifications.enabled}
          onChange={(v) => onNotificationToggle('enabled', v)}
          disabled={saving}
        />
      </SettingRow>
      <SettingRow
        label="播放声音"
        description="通知出现时播放提示音"
        icon={<Volume2 className="size-4" />}
      >
        <SettingsToggle
          enabled={safeConfig.notifications.soundEnabled}
          onChange={(v) => onNotificationToggle('soundEnabled', v)}
          disabled={saving || !safeConfig.notifications.enabled}
        />
      </SettingRow>
      <SettingRow
        label="包含子 Agent 错误"
        description="检测并通知子 Agent 会话中的错误"
        icon={<AlertTriangle className="size-4" />}
      >
        <SettingsToggle
          enabled={safeConfig.notifications.includeSubagentErrors}
          onChange={(v) => onNotificationToggle('includeSubagentErrors', v)}
          disabled={saving || !safeConfig.notifications.enabled}
        />
      </SettingRow>
      <SettingRow
        label="测试通知"
        description="发送测试通知以确认能否送达"
        icon={<Send className="size-4" />}
      >
        <div className="flex items-center gap-2">
          {testStatus === 'success' ? (
            <span className="text-xs text-green-400">已发送！</span>
          ) : testStatus === 'error' ? (
            <span className="max-w-48 truncate text-xs text-red-400">{testError}</span>
          ) : null}
          <button
            onClick={handleTestNotification}
            disabled={saving || !safeConfig.notifications.enabled || testStatus === 'sending'}
            className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors hover:brightness-125 ${
              saving || !safeConfig.notifications.enabled || testStatus === 'sending'
                ? 'cursor-not-allowed opacity-50'
                : ''
            }`}
            style={{
              backgroundColor: 'var(--color-border-emphasis)',
              color: 'var(--color-text)',
            }}
          >
            {testStatus === 'sending' ? '发送中...' : '发送测试'}
          </button>
        </div>
      </SettingRow>
      <SettingRow
        label="暂停通知"
        description={
          isSnoozed
            ? `已暂停到 ${new Date(safeConfig.notifications.snoozedUntil!).toLocaleTimeString()}`
            : '临时暂停通知'
        }
        icon={<Clock className="size-4" />}
      >
        <div className="flex items-center gap-2">
          {isSnoozed ? (
            <button
              onClick={onClearSnooze}
              disabled={saving}
              className={`rounded-md bg-red-500/10 px-3 py-1.5 text-sm font-medium text-red-400 transition-all duration-150 hover:bg-red-500/20 ${saving ? 'cursor-not-allowed opacity-50' : ''} `}
            >
              取消暂停
            </button>
          ) : (
            <SettingsSelect
              value={0}
              options={[{ value: 0, label: '选择时长...' }, ...SNOOZE_OPTIONS]}
              onChange={(v) => v !== 0 && onSnooze(v)}
              disabled={saving || !safeConfig.notifications.enabled}
              dropUp
            />
          )}
        </div>
      </SettingRow>

      {/* Team Notifications — grouped card */}
      <SettingsSectionHeader title="团队通知" icon={<Users className="size-3.5" />} />
      <div
        className="mb-4 rounded-lg border p-4"
        style={{
          borderColor: 'var(--color-border)',
          backgroundColor: 'var(--color-surface-raised)',
        }}
      >
        <SettingRow
          label="负责人收件箱通知"
          description="成员向团队负责人发送消息时通知"
          icon={<Inbox className="size-4" />}
        >
          <SettingsToggle
            enabled={safeConfig.notifications.notifyOnLeadInbox}
            onChange={(v) => onNotificationToggle('notifyOnLeadInbox', v)}
            disabled={saving || !safeConfig.notifications.enabled}
          />
        </SettingRow>
        <SettingRow
          label="用户收件箱通知"
          description="成员向你发送消息时通知"
          icon={<Mail className="size-4" />}
        >
          <SettingsToggle
            enabled={safeConfig.notifications.notifyOnUserInbox}
            onChange={(v) => onNotificationToggle('notifyOnUserInbox', v)}
            disabled={saving || !safeConfig.notifications.enabled}
          />
        </SettingRow>
        <SettingRow
          label="任务澄清通知"
          description="任务需要你补充信息时显示系统通知"
          icon={<HelpCircle className="size-4" />}
        >
          <SettingsToggle
            enabled={safeConfig.notifications.notifyOnClarifications}
            onChange={(v) => onNotificationToggle('notifyOnClarifications', v)}
            disabled={saving || !safeConfig.notifications.enabled}
          />
        </SettingRow>
        <SettingRow
          label="任务评论通知"
          description="Agent 评论任务时显示系统通知"
          icon={<MessageSquare className="size-4" />}
        >
          <SettingsToggle
            enabled={safeConfig.notifications.notifyOnTaskComments}
            onChange={(v) => onNotificationToggle('notifyOnTaskComments', v)}
            disabled={saving || !safeConfig.notifications.enabled}
          />
        </SettingRow>
        <SettingRow
          label="任务创建通知"
          description="创建新任务时显示系统通知"
          icon={<CirclePlus className="size-4" />}
        >
          <SettingsToggle
            enabled={safeConfig.notifications.notifyOnTaskCreated}
            onChange={(v) => onNotificationToggle('notifyOnTaskCreated', v)}
            disabled={saving || !safeConfig.notifications.enabled}
          />
        </SettingRow>
        <SettingRow
          label="全部任务完成"
          description="团队中的所有任务都完成时通知"
          icon={<CheckCircle2 className="size-4" />}
        >
          <SettingsToggle
            enabled={safeConfig.notifications.notifyOnAllTasksCompleted}
            onChange={(v) => onNotificationToggle('notifyOnAllTasksCompleted', v)}
            disabled={saving || !safeConfig.notifications.enabled}
          />
        </SettingRow>
        <SettingRow
          label="跨团队消息通知"
          description="收到其他团队的消息时通知"
          icon={<GitBranch className="size-4" />}
        >
          <SettingsToggle
            enabled={safeConfig.notifications.notifyOnCrossTeamMessage}
            onChange={(v) => onNotificationToggle('notifyOnCrossTeamMessage', v)}
            disabled={saving || !safeConfig.notifications.enabled}
          />
        </SettingRow>
        <SettingRow
          label="团队启动完成通知"
          description="团队启动完成并准备就绪时通知"
          icon={<Rocket className="size-4" />}
        >
          <SettingsToggle
            enabled={safeConfig.notifications.notifyOnTeamLaunched}
            onChange={(v) => onNotificationToggle('notifyOnTeamLaunched', v)}
            disabled={saving || !safeConfig.notifications.enabled}
          />
        </SettingRow>
        <SettingRow
          label="工具审批通知"
          description="应用未聚焦且工具需要你审批（允许/拒绝）时通知"
          icon={<ShieldQuestion className="size-4" />}
        >
          <SettingsToggle
            enabled={safeConfig.notifications.notifyOnToolApproval}
            onChange={(v) => onNotificationToggle('notifyOnToolApproval', v)}
            disabled={saving || !safeConfig.notifications.enabled}
          />
        </SettingRow>
        <SettingRow
          label="速率限制后自动恢复"
          description="当 Claude 返回重置时间时，在限制解除后自动提醒团队负责人继续"
          icon={<Clock className="size-4" />}
        >
          <SettingsToggle
            enabled={safeConfig.notifications.autoResumeOnRateLimit}
            onChange={(v) => onNotificationToggle('autoResumeOnRateLimit', v)}
            disabled={saving || !safeConfig.notifications.enabled}
          />
        </SettingRow>

        {/* Task Status Change Notifications — nested within team card */}
        <div className="last:*:border-b-0">
          <SettingRow
            label="任务状态变更通知"
            description="任务状态变化时显示系统通知"
            icon={<ArrowRightLeft className="size-4" />}
          >
            <SettingsToggle
              enabled={safeConfig.notifications.notifyOnStatusChange}
              onChange={(v) => onNotificationToggle('notifyOnStatusChange', v)}
              disabled={saving || !safeConfig.notifications.enabled}
            />
          </SettingRow>
          {safeConfig.notifications.notifyOnStatusChange && safeConfig.notifications.enabled ? (
            <div
              className="flex flex-col gap-3 border-b pb-3"
              style={{ borderColor: 'var(--color-border-subtle)', paddingLeft: 30 }}
            >
              <div className="flex items-center justify-between">
                <div>
                  <div
                    className="text-sm font-medium"
                    style={{ color: 'var(--color-text-secondary)' }}
                  >
                    仅 Solo 模式
                  </div>
                  <div className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                    仅当团队没有成员时通知
                  </div>
                </div>
                <div className="shrink-0">
                  <SettingsToggle
                    enabled={safeConfig.notifications.statusChangeOnlySolo}
                    onChange={(v) => onNotificationToggle('statusChangeOnlySolo', v)}
                    disabled={saving}
                  />
                </div>
              </div>
              <div className="flex flex-col gap-1.5">
                <div>
                  <div
                    className="text-sm font-medium"
                    style={{ color: 'var(--color-text-secondary)' }}
                  >
                    这些状态触发通知
                  </div>
                  <div className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                    选择哪些目标状态会触发通知
                  </div>
                </div>
                <StatusCheckboxGroup
                  selected={safeConfig.notifications.statusChangeStatuses}
                  onChange={onStatusChangeStatusesUpdate}
                  disabled={saving}
                />
              </div>
            </div>
          ) : null}
        </div>
      </div>

      {/* Custom Triggers */}
      <NotificationTriggerSettings
        triggers={safeConfig.notifications.triggers || []}
        saving={saving}
        onUpdateTrigger={onUpdateTrigger}
        onAddTrigger={onAddTrigger}
        onRemoveTrigger={onRemoveTrigger}
      />

      <SettingsSectionHeader title="忽略的仓库" icon={<EyeOff className="size-3.5" />} />
      <p className="mb-3 text-xs" style={{ color: 'var(--color-text-muted)' }}>
        来自这些仓库的通知将被忽略
      </p>
      {ignoredRepositoryItems.length > 0 ? (
        <div className="mb-3">
          {ignoredRepositoryItems.map((item) => (
            <SelectedRepositoryItem
              key={item.id}
              item={item}
              onRemove={() => onRemoveIgnoredRepository(item.id)}
              disabled={saving}
            />
          ))}
        </div>
      ) : (
        <div
          className="mb-3 rounded-md border border-dashed py-3 text-center"
          style={{ borderColor: 'var(--color-border)' }}
        >
          <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
            暂无忽略的仓库
          </p>
        </div>
      )}
      <RepositoryDropdown
        onSelect={onAddIgnoredRepository}
        excludeIds={excludedRepositoryIds}
        placeholder="选择要忽略的仓库..."
        disabled={saving}
        dropUp
      />

      {/* Task Completion Notifications */}
      <SettingsSectionHeader title="任务完成通知" icon={<PartyPopper className="size-3.5" />} />
      <div
        className="mb-4 rounded-lg border p-4"
        style={{
          borderColor: 'var(--color-border)',
          backgroundColor: 'var(--color-surface-raised)',
        }}
      >
        <p className="mb-3 text-sm" style={{ color: 'var(--color-text-secondary)' }}>
          Claude 完成任务时获取系统原生通知，包括声音、横幅和 Dock/任务栏徽标。支持 macOS、Linux 和
          Windows。
        </p>
        <button
          onClick={() =>
            void api.openExternal('https://github.com/777genius/claude-notifications-go')
          }
          className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors hover:brightness-125"
          style={{
            backgroundColor: 'var(--color-border-emphasis)',
            color: 'var(--color-text)',
          }}
        >
          <ExternalLink className="size-3.5" />
          安装 claude-notifications-go 插件
        </button>
      </div>
    </div>
  );
};

const STATUS_OPTIONS: { value: NotifiableStatus; label: string }[] = [
  { value: 'in_progress', label: 'Started' },
  { value: 'completed', label: 'Completed' },
  { value: 'review', label: 'Review' },
  { value: 'needsFix', label: 'Needs Fixes' },
  { value: 'approved', label: 'Approved' },
  { value: 'pending', label: 'Pending' },
  { value: 'deleted', label: 'Deleted' },
];

const StatusCheckboxGroup = ({
  selected,
  onChange,
  disabled,
}: {
  selected: string[];
  onChange: (statuses: string[]) => void;
  disabled: boolean;
}) => (
  <div className="flex flex-wrap gap-2">
    {STATUS_OPTIONS.map((opt) => {
      const checked = selected.includes(opt.value);
      return (
        <button
          key={opt.value}
          type="button"
          disabled={disabled}
          onClick={() => {
            const next = checked
              ? selected.filter((s) => s !== opt.value)
              : [...selected, opt.value];
            onChange(next);
          }}
          className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
            checked
              ? 'bg-indigo-500/20 text-indigo-400'
              : 'bg-[var(--color-surface-raised)] text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]'
          } ${disabled ? 'cursor-not-allowed opacity-50' : ''}`}
        >
          {opt.label}
        </button>
      );
    })}
  </div>
);
