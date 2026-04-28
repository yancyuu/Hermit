import React, { useMemo } from 'react';

import {
  CODEX_FAST_CREDIT_COST_MULTIPLIER,
  CODEX_FAST_SPEED_MULTIPLIER,
  resolveCodexFastMode,
  resolveCodexRuntimeSelection,
} from '@features/codex-runtime-profile/renderer';
import { Label } from '@renderer/components/ui/label';
import { useEffectiveCliProviderStatus } from '@renderer/hooks/useEffectiveCliProviderStatus';
import { cn } from '@renderer/lib/utils';
import { Zap } from 'lucide-react';

import type { TeamFastMode, TeamProviderBackendId } from '@shared/types';

export interface CodexFastModeSelectorProps {
  value: TeamFastMode;
  onValueChange: (value: TeamFastMode) => void;
  model?: string;
  providerBackendId?: TeamProviderBackendId | string | null;
  id?: string;
}

export const CodexFastModeSelector: React.FC<CodexFastModeSelectorProps> = ({
  value,
  onValueChange,
  model,
  providerBackendId,
  id,
}) => {
  const { providerStatus } = useEffectiveCliProviderStatus('codex');
  const selection = useMemo(
    () =>
      resolveCodexRuntimeSelection({
        source: {
          providerStatus,
          providerBackendId,
        },
        selectedModel: model,
      }),
    [model, providerBackendId, providerStatus]
  );
  const resolution = useMemo(
    () =>
      resolveCodexFastMode({
        selection,
        selectedFastMode: value,
      }),
    [selection, value]
  );

  if (!resolution.showFastModeControl) {
    return null;
  }

  const helperText =
    value === 'inherit'
      ? resolution.selectable
        ? `默认关闭。启用快速模式后速度约为 ${CODEX_FAST_SPEED_MULTIPLIER}x，消耗约为 ${CODEX_FAST_CREDIT_COST_MULTIPLIER}x credits。`
        : (resolution.disabledReason ?? '需要支持快速模式的 Codex 模型和 ChatGPT 账号。')
      : (resolution.disabledReason ??
        '需要支持快速模式的 Codex 模型和 ChatGPT 账号。API Key 模式使用标准 API 计费。');

  return (
    <div className="mb-3">
      <Label htmlFor={id} className="label-optional mb-1.5 block">
        快速模式（2x credits）
      </Label>
      <div className="flex items-center gap-2">
        <Zap size={16} className="shrink-0 text-[var(--color-text-muted)]" />
        <div className="inline-flex flex-wrap rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] p-0.5">
          {[
            { value: 'inherit' as const, label: '默认（关闭）', disabled: false },
            { value: 'on' as const, label: '快速', disabled: !resolution.selectable },
            { value: 'off' as const, label: '关闭', disabled: false },
          ].map((option) => (
            <button
              key={option.value}
              type="button"
              id={option.value === value ? id : undefined}
              className={cn(
                'rounded-[3px] px-3 py-1 text-xs font-medium transition-colors',
                value === option.value
                  ? 'bg-[var(--color-surface-raised)] text-[var(--color-text)] shadow-sm'
                  : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]',
                option.disabled &&
                  'cursor-not-allowed opacity-50 hover:text-[var(--color-text-muted)]'
              )}
              disabled={option.disabled}
              onClick={() => onValueChange(option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>
      <p className="mt-1 text-[11px] text-[var(--color-text-muted)]">{helperText}</p>
    </div>
  );
};
