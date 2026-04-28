/**
 * ApiKeyFormDialog — create or edit an API key entry.
 * Edit mode pre-fills all fields except the value (which must be re-entered).
 */

import { useEffect, useState } from 'react';

import { Button } from '@renderer/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@renderer/components/ui/dialog';
import { Input } from '@renderer/components/ui/input';
import { Label } from '@renderer/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@renderer/components/ui/select';
import { useStore } from '@renderer/store';
import { AlertTriangle, Key } from 'lucide-react';

import type { ApiKeyEntry } from '@shared/types/extensions';

const ENV_KEY_RE = /^[A-Z_][A-Z0-9_]{0,100}$/i;

interface ApiKeyFormDialogProps {
  open: boolean;
  editingKey: ApiKeyEntry | null;
  currentProjectPath: string | null;
  currentProjectLabel: string | null;
  onClose: () => void;
}

type Scope = 'user' | 'project';

const SCOPE_OPTIONS: { value: Scope; label: string }[] = [
  { value: 'user', label: '个人（全局）' },
  { value: 'project', label: '项目' },
];

export const ApiKeyFormDialog = ({
  open,
  editingKey,
  currentProjectPath,
  currentProjectLabel,
  onClose,
}: ApiKeyFormDialogProps): React.JSX.Element => {
  const saveApiKey = useStore((s) => s.saveApiKey);
  const apiKeySaving = useStore((s) => s.apiKeySaving);
  const storageStatus = useStore((s) => s.apiKeyStorageStatus);

  const [name, setName] = useState('');
  const [envVarName, setEnvVarName] = useState('');
  const [value, setValue] = useState('');
  const [scope, setScope] = useState<Scope>('user');
  const [error, setError] = useState<string | null>(null);
  const [envVarError, setEnvVarError] = useState<string | null>(null);
  const editingProjectPath =
    editingKey?.scope === 'project' ? (editingKey.projectPath ?? null) : null;
  const effectiveProjectPath = editingProjectPath ?? currentProjectPath;
  const effectiveProjectLabel =
    effectiveProjectPath && effectiveProjectPath === currentProjectPath
      ? currentProjectLabel
      : effectiveProjectPath;
  const canUseProjectScope = Boolean(effectiveProjectPath);

  // Reset form when dialog opens/closes or editing key changes
  useEffect(() => {
    if (open) {
      if (editingKey) {
        setName(editingKey.name);
        setEnvVarName(editingKey.envVarName);
        setScope(editingKey.scope);
        setValue('');
      } else {
        setName('');
        setEnvVarName('');
        setValue('');
        setScope('user');
      }
      setError(null);
      setEnvVarError(null);
    }
  }, [open, editingKey]);

  useEffect(() => {
    if (open && scope === 'project' && !canUseProjectScope) {
      setScope('user');
    }
  }, [canUseProjectScope, open, scope]);

  const validateEnvVar = (v: string) => {
    if (!v.trim()) {
      setEnvVarError(null);
      return;
    }
    if (!ENV_KEY_RE.test(v)) {
      setEnvVarError('Use letters, digits, underscores. Must start with a letter or underscore.');
    } else {
      setEnvVarError(null);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!name.trim()) {
      setError('Name is required');
      return;
    }
    if (!envVarName.trim()) {
      setError('Environment variable name is required');
      return;
    }
    if (!ENV_KEY_RE.test(envVarName)) {
      setError('Invalid environment variable name');
      return;
    }
    if (!value) {
      setError('Key value is required');
      return;
    }
    if (scope === 'project' && !effectiveProjectPath) {
      setError('Project-scoped API keys require an active project');
      return;
    }

    try {
      await saveApiKey({
        id: editingKey?.id,
        name: name.trim(),
        envVarName: envVarName.trim(),
        value,
        scope,
        projectPath: scope === 'project' ? (effectiveProjectPath ?? undefined) : undefined,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    }
  };

  const isEdit = editingKey !== null;
  const canSubmit =
    name.trim() &&
    envVarName.trim() &&
    value &&
    !envVarError &&
    !apiKeySaving &&
    (scope !== 'project' || canUseProjectScope);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <div className="flex size-8 items-center justify-center rounded-lg border border-border bg-surface-raised">
              <Key className="size-4 text-text-muted" />
            </div>
            <div>
              <DialogTitle>{isEdit ? '编辑 API Key' : '添加 API Key'}</DialogTitle>
              <DialogDescription>
                {isEdit
                  ? '更新 Key 信息。你需要重新输入 Key 值。'
                  : '保存 API Key，用于安装 MCP 服务器时自动填充。'}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {storageStatus && storageStatus.encryptionMethod !== 'os-keychain' && (
          <div className="flex items-center gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-400">
            <AlertTriangle className="size-3.5 shrink-0" />
            系统钥匙串不可用，Key 会用 AES-256 在本地加密。安装 gnome-keyring 可获得系统级保护。
          </div>
        )}

        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
          {/* Name */}
          <div className="space-y-1.5">
            <Label htmlFor="apikey-name" className="text-xs">
              名称
            </Label>
            <Input
              id="apikey-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. OpenAI Production"
              className="h-8 text-sm"
              autoFocus
            />
          </div>

          {/* Env var name */}
          <div className="space-y-1.5">
            <Label htmlFor="apikey-envvar" className="text-xs">
              环境变量名
            </Label>
            <Input
              id="apikey-envvar"
              value={envVarName}
              onChange={(e) => {
                setEnvVarName(e.target.value);
                validateEnvVar(e.target.value);
              }}
              placeholder="e.g. OPENAI_API_KEY"
              className={`h-8 font-mono text-sm ${envVarError ? 'border-red-500/50' : ''}`}
            />
            {envVarError && <p className="text-xs text-red-400">{envVarError}</p>}
          </div>

          {/* Value */}
          <div className="space-y-1.5">
            <Label htmlFor="apikey-value" className="text-xs">
              值
            </Label>
            <Input
              id="apikey-value"
              type="password"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={isEdit ? '重新输入 Key 值' : 'sk-...'}
              className="h-8 text-sm"
            />
          </div>

          {/* Scope */}
          <div className="space-y-1.5">
            <Label className="text-xs">作用域</Label>
            <Select value={scope} onValueChange={(v) => setScope(v as Scope)}>
              <SelectTrigger className="h-8 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SCOPE_OPTIONS.map((opt) => (
                  <SelectItem
                    key={opt.value}
                    value={opt.value}
                    disabled={opt.value === 'project' && !canUseProjectScope}
                  >
                    {opt.value === 'project'
                      ? effectiveProjectPath
                        ? `项目：${effectiveProjectLabel}`
                        : '当前无可用项目'
                      : opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {scope === 'project' && effectiveProjectPath && (
              <p className="text-xs text-text-muted">绑定到 {effectiveProjectPath}</p>
            )}
          </div>

          {/* Error display */}
          {error && (
            <div className="rounded-md border border-red-500/30 bg-red-500/5 px-3 py-2 text-xs text-red-400">
              {error}
            </div>
          )}

          {/* Actions */}
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" size="sm" onClick={onClose}>
              取消
            </Button>
            <Button type="submit" size="sm" disabled={!canSubmit}>
              {apiKeySaving ? '保存中...' : isEdit ? '更新' : '保存'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
};
