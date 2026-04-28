/**
 * WorkspaceSection - Settings section for managing saved SSH connection profiles.
 *
 * Provides CRUD UI for:
 * - Listing saved SSH profiles
 * - Adding new profiles (name, host, port, username, auth method)
 * - Inline editing existing profile fields
 * - Deleting profiles with confirmation
 *
 * Profile changes persist via ConfigManager and trigger context list refresh.
 */

import { useCallback, useEffect, useState } from 'react';

import { api } from '@renderer/api';
import { confirm } from '@renderer/components/common/ConfirmDialog';
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/components/ui/tooltip';
import { useStore } from '@renderer/store';
import { Activity, Edit2, Loader2, Plus, Save, Server, Trash2, X } from 'lucide-react';

import { SettingsSectionHeader } from '../components/SettingsSectionHeader';
import { SettingsSelect } from '../components/SettingsSelect';

import type { MachineProfile, MachineRuntimeProcess, SshAuthMethod } from '@shared/types';

const inputClass = 'w-full rounded-md border px-3 py-1.5 text-sm focus:outline-none focus:ring-1';
const inputStyle = {
  backgroundColor: 'var(--color-surface-raised)',
  borderColor: 'var(--color-border)',
  color: 'var(--color-text)',
};

const authMethodOptions: readonly { value: SshAuthMethod; label: string }[] = [
  { value: 'auto', label: '自动（读取 SSH Config）' },
  { value: 'agent', label: 'SSH Agent' },
  { value: 'privateKey', label: '私钥' },
  { value: 'password', label: '密码' },
];

const defaultForm = {
  name: '',
  host: '',
  port: '22',
  username: '',
  authMethod: 'auto' as SshAuthMethod,
  privateKeyPath: '',
  claudeRoot: '',
  workspaceRoot: '',
};

export const WorkspaceSection = (): React.JSX.Element => {
  const [profiles, setProfiles] = useState<MachineProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [checkingId, setCheckingId] = useState<string | null>(null);
  const [processesByMachine, setProcessesByMachine] = useState<
    Record<string, MachineRuntimeProcess[]>
  >({});
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);

  // Form state
  const [formName, setFormName] = useState(defaultForm.name);
  const [formHost, setFormHost] = useState(defaultForm.host);
  const [formPort, setFormPort] = useState(defaultForm.port);
  const [formUsername, setFormUsername] = useState(defaultForm.username);
  const [formAuthMethod, setFormAuthMethod] = useState<SshAuthMethod>(defaultForm.authMethod);
  const [formPrivateKeyPath, setFormPrivateKeyPath] = useState(defaultForm.privateKeyPath);
  const [formClaudeRoot, setFormClaudeRoot] = useState(defaultForm.claudeRoot);
  const [formWorkspaceRoot, setFormWorkspaceRoot] = useState(defaultForm.workspaceRoot);

  const resetForm = useCallback(() => {
    setFormName(defaultForm.name);
    setFormHost(defaultForm.host);
    setFormPort(defaultForm.port);
    setFormUsername(defaultForm.username);
    setFormAuthMethod(defaultForm.authMethod);
    setFormPrivateKeyPath(defaultForm.privateKeyPath);
    setFormClaudeRoot(defaultForm.claudeRoot);
    setFormWorkspaceRoot(defaultForm.workspaceRoot);
  }, []);

  const loadProfiles = useCallback(async () => {
    try {
      const loaded = await api.ssh.listMachines();
      setProfiles(loaded);
    } catch (error) {
      console.error('[WorkspaceSection] Failed to load profiles:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadProfiles();
  }, [loadProfiles]);

  // Populate form when editing starts
  useEffect(() => {
    if (editingId) {
      const profile = profiles.find((p) => p.id === editingId);
      if (profile) {
        setFormName(profile.name);
        setFormHost(profile.host);
        setFormPort(String(profile.port));
        setFormUsername(profile.username);
        setFormAuthMethod(profile.authMethod);
        setFormPrivateKeyPath(profile.privateKeyPath ?? '');
        setFormClaudeRoot(profile.claudeRoot ?? '');
        setFormWorkspaceRoot(profile.workspaceRoot ?? '');
      }
    }
  }, [editingId, profiles]);

  const handleAdd = async (): Promise<void> => {
    const now = new Date().toISOString();
    const newProfile: MachineProfile = {
      id: crypto.randomUUID(),
      name: formName.trim(),
      displayName: formName.trim(),
      host: formHost.trim(),
      port: parseInt(formPort, 10) || 22,
      username: formUsername.trim(),
      authMethod: formAuthMethod,
      privateKeyPath: formAuthMethod === 'privateKey' ? formPrivateKeyPath.trim() : undefined,
      claudeRoot: formClaudeRoot.trim() || undefined,
      workspaceRoot: formWorkspaceRoot.trim() || undefined,
      runtimeStatus: { claude: { state: 'unknown' } },
      createdAt: now,
      updatedAt: now,
    };

    await api.ssh.saveMachine(newProfile);
    await loadProfiles();
    resetForm();
    setShowAddForm(false);
    void useStore.getState().fetchAvailableContexts();
  };

  const handleEdit = async (): Promise<void> => {
    const current = profiles.find((p) => p.id === editingId);
    if (!current) return;
    await api.ssh.saveMachine({
      ...current,
      name: formName.trim(),
      displayName: formName.trim(),
      host: formHost.trim(),
      port: parseInt(formPort, 10) || 22,
      username: formUsername.trim(),
      authMethod: formAuthMethod,
      privateKeyPath: formAuthMethod === 'privateKey' ? formPrivateKeyPath.trim() : undefined,
      claudeRoot: formClaudeRoot.trim() || undefined,
      workspaceRoot: formWorkspaceRoot.trim() || undefined,
      updatedAt: new Date().toISOString(),
    });
    await loadProfiles();
    setEditingId(null);
    resetForm();
    void useStore.getState().fetchAvailableContexts();
  };

  const handleDelete = async (id: string): Promise<void> => {
    const profile = profiles.find((p) => p.id === id);
    if (!profile) return;

    const confirmed = await confirm({
      title: '删除配置',
      message: `确定要删除 "${profile.name}" 吗？此操作无法撤销。`,
      confirmLabel: '删除',
      variant: 'danger',
    });
    if (!confirmed) return;

    await api.ssh.removeMachine(id);
    await loadProfiles();
    void useStore.getState().fetchAvailableContexts();
  };

  const handleCheck = async (id: string): Promise<void> => {
    setCheckingId(id);
    try {
      await api.ssh.checkMachine(id);
      const processes = await api.ssh.listMachineProcesses(id).catch(() => []);
      setProcessesByMachine((prev) => ({ ...prev, [id]: processes }));
      await loadProfiles();
    } finally {
      setCheckingId(null);
    }
  };

  const handleStopProcess = async (machineId: string, pid: number): Promise<void> => {
    await api.ssh.stopMachineProcess(machineId, pid);
    const processes = await api.ssh.listMachineProcesses(machineId).catch(() => []);
    setProcessesByMachine((prev) => ({ ...prev, [machineId]: processes }));
  };

  const isFormValid =
    formName.trim() !== '' && formHost.trim() !== '' && formUsername.trim() !== '';

  const renderForm = (onSave: () => Promise<void>, onCancel: () => void): React.JSX.Element => (
    <div
      className="space-y-3 rounded-md border p-4"
      style={{
        backgroundColor: 'var(--color-surface-raised)',
        borderColor: 'var(--color-border)',
      }}
    >
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label
            htmlFor="ws-profile-name"
            className="mb-1 block text-xs"
            style={{ color: 'var(--color-text-muted)' }}
          >
            名称
          </label>
          <input
            id="ws-profile-name"
            type="text"
            value={formName}
            onChange={(e) => setFormName(e.target.value)}
            placeholder="我的服务器"
            className={inputClass}
            style={inputStyle}
          />
        </div>
        <div>
          <label
            htmlFor="ws-profile-host"
            className="mb-1 block text-xs"
            style={{ color: 'var(--color-text-muted)' }}
          >
            主机
          </label>
          <input
            id="ws-profile-host"
            type="text"
            value={formHost}
            onChange={(e) => setFormHost(e.target.value)}
            placeholder="主机名或 IP"
            className={inputClass}
            style={inputStyle}
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label
            htmlFor="ws-profile-port"
            className="mb-1 block text-xs"
            style={{ color: 'var(--color-text-muted)' }}
          >
            端口
          </label>
          <input
            id="ws-profile-port"
            type="text"
            value={formPort}
            onChange={(e) => setFormPort(e.target.value)}
            placeholder="22"
            className={inputClass}
            style={inputStyle}
          />
        </div>
        <div>
          <label
            htmlFor="ws-profile-username"
            className="mb-1 block text-xs"
            style={{ color: 'var(--color-text-muted)' }}
          >
            用户名
          </label>
          <input
            id="ws-profile-username"
            type="text"
            value={formUsername}
            onChange={(e) => setFormUsername(e.target.value)}
            placeholder="user"
            className={inputClass}
            style={inputStyle}
          />
        </div>
      </div>

      <div>
        {/* eslint-disable-next-line jsx-a11y/label-has-associated-control -- SettingsSelect is a custom dropdown without a native control */}
        <label className="mb-1 block text-xs" style={{ color: 'var(--color-text-muted)' }}>
          认证方式
        </label>
        <SettingsSelect
          value={formAuthMethod}
          options={authMethodOptions}
          onChange={setFormAuthMethod}
          fullWidth
        />
      </div>

      {formAuthMethod === 'privateKey' && (
        <div>
          <label
            htmlFor="ws-profile-private-key-path"
            className="mb-1 block text-xs"
            style={{ color: 'var(--color-text-muted)' }}
          >
            私钥路径
          </label>
          <input
            id="ws-profile-private-key-path"
            type="text"
            value={formPrivateKeyPath}
            onChange={(e) => setFormPrivateKeyPath(e.target.value)}
            placeholder="~/.ssh/id_rsa"
            className={inputClass}
            style={inputStyle}
          />
        </div>
      )}

      {formAuthMethod === 'password' && (
        <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
          连接时会提示你输入密码。
        </p>
      )}

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label
            htmlFor="ws-profile-claude-root"
            className="mb-1 block text-xs"
            style={{ color: 'var(--color-text-muted)' }}
          >
            Claude 根目录
          </label>
          <input
            id="ws-profile-claude-root"
            type="text"
            value={formClaudeRoot}
            onChange={(e) => setFormClaudeRoot(e.target.value)}
            placeholder="默认 ~/.claude"
            className={inputClass}
            style={inputStyle}
          />
        </div>
        <div>
          <label
            htmlFor="ws-profile-workspace-root"
            className="mb-1 block text-xs"
            style={{ color: 'var(--color-text-muted)' }}
          >
            工作区根目录
          </label>
          <input
            id="ws-profile-workspace-root"
            type="text"
            value={formWorkspaceRoot}
            onChange={(e) => setFormWorkspaceRoot(e.target.value)}
            placeholder="例如 ~/work"
            className={inputClass}
            style={inputStyle}
          />
        </div>
      </div>

      <div className="flex items-center gap-2 pt-1">
        <button
          onClick={() => void onSave()}
          disabled={!isFormValid}
          className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm transition-colors disabled:opacity-50"
          style={{
            backgroundColor: 'var(--color-surface-raised)',
            color: 'var(--color-text)',
          }}
        >
          <Save className="size-3.5" />
          保存
        </button>
        <button
          onClick={onCancel}
          className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm transition-colors"
          style={{
            backgroundColor: 'transparent',
            color: 'var(--color-text-muted)',
          }}
        >
          <X className="size-3.5" />
          取消
        </button>
      </div>
    </div>
  );

  return (
    <div className="space-y-6">
      <SettingsSectionHeader title="机器管理" />
      <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
        登记可运行 ClaudeCode 的 SSH 主机，并检测远程 CLI 可用性。
      </p>

      {loading && (
        <div className="flex items-center gap-2 py-4" style={{ color: 'var(--color-text-muted)' }}>
          <Loader2 className="size-4 animate-spin" />
          <span className="text-sm">正在加载配置...</span>
        </div>
      )}

      {!loading && profiles.length === 0 && !showAddForm && (
        <div
          className="rounded-md border py-8 text-center"
          style={{
            borderColor: 'var(--color-border)',
            color: 'var(--color-text-muted)',
          }}
        >
          <Server className="mx-auto mb-2 size-8 opacity-40" />
          <p className="text-sm">暂无已登记机器</p>
          <p className="mt-1 text-xs">添加 SSH 主机后可作为团队运行位置</p>
        </div>
      )}

      {!loading && (
        <div className="space-y-3">
          {profiles.map((profile) =>
            editingId === profile.id ? (
              <div key={profile.id}>
                {renderForm(handleEdit, () => {
                  setEditingId(null);
                  resetForm();
                })}
              </div>
            ) : (
              <div
                key={profile.id}
                className="rounded-md border p-4"
                style={{
                  backgroundColor: 'var(--color-surface-raised)',
                  borderColor: 'var(--color-border)',
                }}
              >
                <div className="flex items-center gap-3">
                  <Server
                    className="size-4 shrink-0"
                    style={{ color: 'var(--color-text-muted)' }}
                  />
                  <div className="min-w-0 flex-1">
                    <p
                      className="truncate text-sm font-medium"
                      style={{ color: 'var(--color-text)' }}
                    >
                      {profile.displayName || profile.name}
                    </p>
                    <p className="truncate text-xs" style={{ color: 'var(--color-text-muted)' }}>
                      {profile.username}@{profile.host}:{profile.port}
                    </p>
                    {profile.runtimeStatus?.claude && (
                      <p
                        className="mt-1 truncate text-xs"
                        style={{ color: 'var(--color-text-muted)' }}
                      >
                        ClaudeCode：{profile.runtimeStatus.claude.state}
                        {profile.runtimeStatus.claude.version
                          ? ` · ${profile.runtimeStatus.claude.version}`
                          : ''}
                      </p>
                    )}
                  </div>
                  <span
                    className="shrink-0 rounded px-1.5 py-0.5 text-xs"
                    style={{
                      backgroundColor: 'var(--color-surface)',
                      color: 'var(--color-text-muted)',
                    }}
                  >
                    {profile.authMethod}
                  </span>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        onClick={() => void handleCheck(profile.id)}
                        disabled={checkingId === profile.id}
                        className="shrink-0 rounded p-1 transition-colors hover:bg-surface-raised disabled:opacity-50"
                        style={{ color: 'var(--color-text-muted)' }}
                      >
                        {checkingId === profile.id ? (
                          <Loader2 className="size-3.5 animate-spin" />
                        ) : (
                          <Activity className="size-3.5" />
                        )}
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="top" className="text-xs">
                      检测并刷新进程
                    </TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        onClick={() => setEditingId(profile.id)}
                        className="shrink-0 rounded p-1 transition-colors hover:bg-surface-raised"
                        style={{ color: 'var(--color-text-muted)' }}
                      >
                        <Edit2 className="size-3.5" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="top" className="text-xs">
                      编辑机器
                    </TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        onClick={() => void handleDelete(profile.id)}
                        className="shrink-0 rounded p-1 transition-colors hover:bg-surface-raised"
                        style={{ color: 'var(--color-text-muted)' }}
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="top" className="text-xs">
                      删除机器
                    </TooltipContent>
                  </Tooltip>
                </div>
                {(processesByMachine[profile.id]?.length ?? 0) > 0 && (
                  <div
                    className="mt-3 space-y-2 border-t pt-3"
                    style={{ borderColor: 'var(--color-border)' }}
                  >
                    <p className="text-xs font-medium" style={{ color: 'var(--color-text-muted)' }}>
                      远程进程
                    </p>
                    {processesByMachine[profile.id].map((process) => (
                      <div key={process.pid} className="flex items-center gap-2 text-xs">
                        <code className="shrink-0" style={{ color: 'var(--color-text-muted)' }}>
                          PID {process.pid}
                        </code>
                        <span
                          className="min-w-0 flex-1 truncate"
                          style={{ color: 'var(--color-text)' }}
                        >
                          {process.command}
                        </span>
                        <button
                          onClick={() => void handleStopProcess(profile.id, process.pid)}
                          className="rounded px-2 py-1"
                          style={{
                            backgroundColor: 'var(--color-surface)',
                            color: 'var(--color-text-muted)',
                          }}
                        >
                          停止
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          )}
        </div>
      )}

      {!loading && (
        <div>
          {showAddForm ? (
            renderForm(handleAdd, () => {
              setShowAddForm(false);
              resetForm();
            })
          ) : (
            <button
              onClick={() => {
                resetForm();
                setShowAddForm(true);
              }}
              className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm transition-colors"
              style={{
                backgroundColor: 'var(--color-surface-raised)',
                color: 'var(--color-text-secondary)',
              }}
            >
              <Plus className="size-3.5" />
              添加机器
            </button>
          )}
        </div>
      )}
    </div>
  );
};
