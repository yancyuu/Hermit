import React from 'react';

import { Label } from '@renderer/components/ui/label';
import { useEffectiveCliProviderStatus } from '@renderer/hooks/useEffectiveCliProviderStatus';
import { cn } from '@renderer/lib/utils';
import { getTeamEffortOptions } from '@renderer/utils/teamEffortOptions';
import { Brain } from 'lucide-react';

import type { TeamProviderId } from '@shared/types';

export interface EffortLevelSelectorProps {
  value: string;
  onValueChange: (value: string) => void;
  id?: string;
  providerId?: TeamProviderId;
  model?: string;
  limitContext?: boolean;
}

export const EffortLevelSelector: React.FC<EffortLevelSelectorProps> = ({
  value,
  onValueChange,
  id,
  providerId,
  model,
  limitContext,
}) => {
  const { providerStatus } = useEffectiveCliProviderStatus(providerId);
  const effortOptions = getTeamEffortOptions({ providerId, model, limitContext, providerStatus });
  const showsAnthropicMax =
    providerId === 'anthropic' && effortOptions.some((option) => option.value === 'max');

  return (
    <div className="mb-3">
      <Label htmlFor={id} className="label-optional mb-1.5 block">
        推理强度（可选）
      </Label>
      <div className="flex items-center gap-2">
        <Brain size={16} className="shrink-0 text-[var(--color-text-muted)]" />
        <div className="inline-flex flex-wrap rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] p-0.5">
          {effortOptions.map((opt) => (
            <button
              key={opt.value || '__default__'}
              type="button"
              id={opt.value === value ? id : undefined}
              className={cn(
                'rounded-[3px] px-3 py-1 text-xs font-medium transition-colors',
                value === opt.value
                  ? 'bg-[var(--color-surface-raised)] text-[var(--color-text)] shadow-sm'
                  : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]'
              )}
              onClick={() => onValueChange(opt.value)}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>
      <p className="mt-1 text-[11px] text-[var(--color-text-muted)]">
        控制所选提供商在回复前投入多少推理。默认会使用该提供商针对所选模型的标准行为。
      </p>
      {showsAnthropicMax ? (
        <p className="mt-1 text-[11px] text-[var(--color-text-muted)]">
          Max 是 Anthropic 的更高强度推理模式，仅在实际启动模型支持时显示。
        </p>
      ) : null}
    </div>
  );
};
