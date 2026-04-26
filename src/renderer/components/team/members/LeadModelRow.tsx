import React, { useState } from 'react';

import { ProviderBrandLogo } from '@renderer/components/common/ProviderBrandLogo';
import { EffortLevelSelector } from '@renderer/components/team/dialogs/EffortLevelSelector';
import { LimitContextCheckbox } from '@renderer/components/team/dialogs/LimitContextCheckbox';
import {
  getProviderScopedTeamModelLabel,
  getTeamProviderLabel,
  TeamModelSelector,
} from '@renderer/components/team/dialogs/TeamModelSelector';
import { Checkbox } from '@renderer/components/ui/checkbox';
import { Label } from '@renderer/components/ui/label';
import { getTeamColorSet } from '@renderer/constants/teamColors';
import { useTheme } from '@renderer/hooks/useTheme';
import { cn } from '@renderer/lib/utils';
import { agentAvatarUrl } from '@renderer/utils/memberHelpers';
import { isAnthropicHaikuTeamModel } from '@renderer/utils/teamModelCatalog';
import { resolveTeamLeadColorName } from '@shared/utils/teamMemberColors';
import { AlertTriangle, BellRing, ChevronDown, ChevronRight, Info } from 'lucide-react';

import { Button } from '../../ui/button';
import { LeadChannelPanel } from './LeadChannelPanel';

import type { EffortLevel, TeamProviderId } from '@shared/types';

interface LeadModelRowProps {
  providerId: TeamProviderId;
  model: string;
  effort?: EffortLevel;
  limitContext: boolean;
  onProviderChange: (providerId: TeamProviderId) => void;
  onModelChange: (model: string) => void;
  onEffortChange: (effort: string) => void;
  onLimitContextChange: (value: boolean) => void;
  syncModelsWithTeammates: boolean;
  onSyncModelsWithTeammatesChange: (value: boolean) => void;
  warningText?: string | null;
  disableGeminiOption?: boolean;
  modelIssueText?: string | null;
  teamName?: string;
}

export const LeadModelRow = ({
  providerId,
  model,
  effort,
  limitContext,
  onProviderChange,
  onModelChange,
  onEffortChange,
  onLimitContextChange,
  syncModelsWithTeammates,
  onSyncModelsWithTeammatesChange,
  warningText,
  disableGeminiOption = false,
  modelIssueText,
  teamName,
}: LeadModelRowProps): React.JSX.Element => {
  const { isLight } = useTheme();
  const [modelExpanded, setModelExpanded] = useState(false);
  const [channelExpanded, setChannelExpanded] = useState(false);
  const leadColorSet = getTeamColorSet(resolveTeamLeadColorName());
  const modelButtonLabel = model.trim()
    ? getProviderScopedTeamModelLabel(providerId, model.trim())
    : '默认';
  const modelButtonAriaLabel = `${getTeamProviderLabel(providerId)} 提供商，${modelButtonLabel}`;
  const hasModelIssue = Boolean(modelIssueText);

  return (
    <div
      className="relative grid grid-cols-1 gap-2 rounded-md p-2 shadow-sm md:grid-cols-[minmax(0,1fr)_auto_auto]"
      style={{
        backgroundColor: isLight
          ? 'color-mix(in srgb, var(--color-surface-raised) 22%, white 78%)'
          : 'var(--color-surface-raised)',
        boxShadow: isLight ? '0 1px 2px rgba(15, 23, 42, 0.06)' : '0 1px 2px rgba(0, 0, 0, 0.28)',
      }}
    >
      <div
        className="absolute inset-y-0 left-0 w-1 rounded-l-md"
        style={{ backgroundColor: leadColorSet.border }}
        aria-hidden="true"
      />
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <img
            src={agentAvatarUrl('lead', 32)}
            alt=""
            className="size-8 shrink-0 rounded-full bg-[var(--color-surface-raised)]"
            loading="lazy"
          />
          <div className="flex h-8 min-w-0 items-center gap-3">
            <span className="truncate text-sm font-medium text-[var(--color-text)]">负责人</span>
            <span className="shrink-0 text-xs text-[var(--color-text-secondary)]">团队负责人</span>
          </div>
        </div>
      </div>
      <div className="min-w-0">
        <div className="flex h-8 items-center justify-end px-2 text-xs text-[var(--color-text-secondary)]">
          <div className="flex min-w-0 items-center gap-2">
            <Checkbox
              id="sync-models-with-lead"
              checked={syncModelsWithTeammates}
              onCheckedChange={(checked) => onSyncModelsWithTeammatesChange(checked === true)}
            />
            <Label
              htmlFor="sync-models-with-lead"
              className="cursor-pointer truncate text-xs font-normal text-text-secondary"
            >
              与成员同步模型
            </Label>
          </div>
        </div>
      </div>
      <div className="space-y-1">
        <div className="flex w-full min-w-0 gap-1 sm:w-[230px] sm:min-w-[230px]">
          <Button
            variant="outline"
            size="sm"
            className={cn(
              'h-8 w-full justify-start gap-1 overflow-hidden text-left',
              hasModelIssue &&
                'border-red-500/50 bg-red-500/10 text-red-100 hover:border-red-400/60 hover:bg-red-500/15 hover:text-red-50'
            )}
            aria-label={modelButtonAriaLabel}
            onClick={() => setModelExpanded((prev) => !prev)}
          >
            {modelExpanded ? (
              <ChevronDown className="size-3.5" />
            ) : (
              <ChevronRight className="size-3.5" />
            )}
            <ProviderBrandLogo providerId={providerId} className="size-3.5 shrink-0" />
            <span className="min-w-0 flex-1 truncate">{modelButtonLabel}</span>
            {hasModelIssue ? <AlertTriangle className="size-3.5 shrink-0 text-red-300" /> : null}
          </Button>
          <Button
            variant="outline"
            size="sm"
            className={cn(
              'h-8 shrink-0 gap-1 px-2',
              channelExpanded && 'border-sky-500/45 bg-sky-500/10 text-sky-100 hover:bg-sky-500/15'
            )}
            title="配置负责人渠道监听"
            aria-label="配置负责人渠道监听"
            onClick={() => setChannelExpanded((prev) => !prev)}
          >
            <BellRing className="size-3.5" />
            渠道
          </Button>
        </div>
      </div>
      {warningText ? (
        <div className="md:col-span-3">
          <div className="bg-amber-500/8 ml-3 flex items-start gap-2 rounded-md border border-amber-500/25 px-3 py-2 text-[11px] leading-relaxed text-amber-200">
            <Info className="mt-0.5 size-3.5 shrink-0 text-amber-300" />
            <p>{warningText}</p>
          </div>
        </div>
      ) : null}
      {modelExpanded ? (
        <div className="space-y-2 md:col-span-3">
          <TeamModelSelector
            providerId={providerId}
            onProviderChange={onProviderChange}
            value={model}
            onValueChange={onModelChange}
            id="lead-model"
            disableGeminiOption={disableGeminiOption}
            modelIssueReasonByValue={model.trim() ? { [model.trim()]: modelIssueText } : undefined}
          />
          <EffortLevelSelector
            value={effort ?? ''}
            onValueChange={onEffortChange}
            id="lead-effort"
            providerId={providerId}
            model={model}
            limitContext={limitContext}
          />
          {providerId === 'anthropic' ? (
            <LimitContextCheckbox
              id="lead-limit-context"
              checked={limitContext}
              onCheckedChange={onLimitContextChange}
              disabled={isAnthropicHaikuTeamModel(model)}
            />
          ) : null}
          <div className="flex items-start gap-2 rounded-md border border-sky-500/20 bg-sky-500/5 px-3 py-2">
            <Info className="mt-0.5 size-3.5 shrink-0 text-sky-400" />
            <p className="text-[11px] leading-relaxed text-sky-300">
              这些设置控制团队负责人，并作为未单独覆盖设置的成员默认运行时。
            </p>
          </div>
        </div>
      ) : null}
      {channelExpanded ? (
        <div className="md:col-span-3">
          <div className="ml-3 rounded-md border border-sky-500/25 bg-sky-500/5 p-3">
            <LeadChannelPanel teamName={teamName} />
          </div>
        </div>
      ) : null}
    </div>
  );
};
