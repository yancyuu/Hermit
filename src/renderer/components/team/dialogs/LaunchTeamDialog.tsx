import React, { useEffect, useMemo, useRef, useState } from 'react';

import {
  reconcileAnthropicRuntimeSelections,
  resolveAnthropicFastMode,
  resolveAnthropicRuntimeSelection,
} from '@features/anthropic-runtime-profile/renderer';
import { api } from '@renderer/api';
import { SkipPermissionsCheckbox } from '@renderer/components/team/dialogs/SkipPermissionsCheckbox';
import {
  buildMemberDraftColorMap,
  buildMemberDraftSuggestions,
  buildMembersFromDrafts,
  clearMemberModelOverrides,
  createMemberDraftsFromInputs,
  filterEditableMemberInputs,
  normalizeLeadProviderForMode,
  normalizeMemberDraftForProviderMode,
  normalizeProviderForMode,
  validateMemberNameInline,
} from '@renderer/components/team/members/MembersEditorSection';
import { TeamRosterEditorSection } from '@renderer/components/team/members/TeamRosterEditorSection';
import { Button } from '@renderer/components/ui/button';
import { Checkbox } from '@renderer/components/ui/checkbox';
import { Combobox } from '@renderer/components/ui/combobox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@renderer/components/ui/dialog';
import { Input } from '@renderer/components/ui/input';
import { Label } from '@renderer/components/ui/label';
import { MentionableTextarea } from '@renderer/components/ui/MentionableTextarea';
import { getTeamColorSet } from '@renderer/constants/teamColors';
import { useChipDraftPersistence } from '@renderer/hooks/useChipDraftPersistence';
import { useDraftPersistence } from '@renderer/hooks/useDraftPersistence';
import { useFileListCacheWarmer } from '@renderer/hooks/useFileListCacheWarmer';
import { useTaskSuggestions } from '@renderer/hooks/useTaskSuggestions';
import { useTeamSuggestions } from '@renderer/hooks/useTeamSuggestions';
import { useTheme } from '@renderer/hooks/useTheme';
import { useStore } from '@renderer/store';
import { createLoadingMultimodelCliStatus } from '@renderer/store/slices/cliInstallerSlice';
import {
  isTeamProvisioningActive,
  selectResolvedMembersForTeamName,
} from '@renderer/store/slices/teamSlice';
import { normalizeCreateLaunchProviderForUi } from '@renderer/utils/claudeCodeOnlyProviders';
import { normalizePath } from '@renderer/utils/pathNormalize';
import { nameColorSet } from '@renderer/utils/projectColor';
import { resolveUiOwnedProviderBackendId } from '@renderer/utils/providerBackendIdentity';
import { refreshCliStatusForCurrentMode } from '@renderer/utils/refreshCliStatus';
import {
  getTeamModelSelectionError,
  normalizeExplicitTeamModelForUi,
} from '@renderer/utils/teamModelAvailability';
import { getTeamProviderLabel as getCatalogTeamProviderLabel } from '@renderer/utils/teamModelCatalog';
import { isEphemeralProjectPath } from '@shared/utils/ephemeralProjectPath';
import { CANONICAL_LEAD_MEMBER_NAME, isLeadMemberName } from '@shared/utils/leadDetection';
import { migrateProviderBackendId } from '@shared/utils/providerBackend';
import { DEFAULT_PROVIDER_MODEL_SELECTION } from '@shared/utils/providerModelSelection';
import { isTeamProviderId, normalizeOptionalTeamProviderId } from '@shared/utils/teamProvider';
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Info,
  Loader2,
  RotateCcw,
  X,
} from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';

import { CronScheduleInput } from '../schedule/CronScheduleInput';

import { AdvancedCliSection } from './AdvancedCliSection';
import { AnthropicFastModeSelector } from './AnthropicFastModeSelector';
import { EffortLevelSelector } from './EffortLevelSelector';
import { resolveLaunchDialogPrefill } from './launchDialogPrefill';
import {
  clearInheritedMemberModelsUnavailableForProvider,
  resolveProviderScopedMemberModel,
} from './memberModelScope';
import { OptionalSettingsSection } from './OptionalSettingsSection';
import { ProjectPathSelector } from './ProjectPathSelector';
import { buildProviderPrepareModelCacheKey } from './providerPrepareCacheKey';
import {
  buildReusableProviderPrepareModelResults,
  getProviderPrepareCachedSnapshot,
  type ProviderPrepareDiagnosticsModelResult,
  runProviderPrepareDiagnostics,
} from './providerPrepareDiagnostics';
import {
  buildProviderPrepareModelChecksSignature,
  buildProviderPrepareRequestSignature,
  buildProviderPrepareRuntimeStatusSignature,
} from './providerPrepareRequestSignature';
import {
  getShortLivedProviderPrepareModelResults,
  storeShortLivedProviderPrepareModelResults,
} from './providerPrepareShortLivedCache';
import { getProvisioningModelIssue } from './provisioningModelIssues';
import {
  deriveEffectiveProvisioningPrepareState,
  failIncompleteProviderChecks,
  getPrimaryProvisioningFailureDetail,
  getProvisioningFailureHint,
  getProvisioningProviderBackendSummary,
  type ProvisioningProviderCheck,
  ProvisioningProviderStatusList,
  shouldHideProvisioningProviderStatusList,
  updateProviderCheck,
} from './ProvisioningProviderStatusList';
import {
  analyzeTeammateRuntimeCompatibility,
  useTmuxRuntimeReadiness,
} from './teammateRuntimeCompatibility';
import { TeammateRuntimeCompatibilityNotice } from './TeammateRuntimeCompatibilityNotice';
import {
  computeEffectiveTeamModel,
  formatTeamModelSummary,
  TeamModelSelector,
} from './TeamModelSelector';

import type { ActiveTeamRef } from './CreateTeamDialog';
import type { MemberDraft } from '@renderer/components/team/members/membersEditorTypes';
import type { MentionSuggestion } from '@renderer/types/mention';
import type {
  CreateScheduleInput,
  EffortLevel,
  MachineProfile,
  Project,
  ResolvedTeamMember,
  Schedule,
  ScheduleLaunchConfig,
  TeamCreateRequest,
  TeamFastMode,
  TeamLaunchRequest,
  TeamProviderId,
  UpdateSchedulePatch,
} from '@shared/types';

function alignProvisioningChecks(
  existingChecks: ProvisioningProviderCheck[],
  providerIds: TeamProviderId[]
): ProvisioningProviderCheck[] {
  const existingByProviderId = new Map(
    existingChecks.map((check) => [check.providerId, check] as const)
  );
  return providerIds.map(
    (providerId) =>
      existingByProviderId.get(providerId) ?? {
        providerId,
        status: 'pending',
        backendSummary: null,
        details: [],
      }
  );
}

// =============================================================================
// Props — discriminated union
// =============================================================================

interface LaunchDialogBase {
  open: boolean;
  teamName: string;
  onClose: () => void;
}

export type TeamLaunchDialogMode = 'launch' | 'relaunch';

interface LaunchDialogLaunchMode extends LaunchDialogBase {
  mode: 'launch';
  members: ResolvedTeamMember[];
  defaultProjectPath?: string;
  provisioningError: string | null;
  clearProvisioningError?: (teamName?: string) => void;
  activeTeams?: ActiveTeamRef[];
  onLaunch: (request: TeamLaunchRequest) => Promise<void>;
}

interface LaunchDialogRelaunchMode extends LaunchDialogBase {
  mode: 'relaunch';
  members: ResolvedTeamMember[];
  defaultProjectPath?: string;
  provisioningError: string | null;
  clearProvisioningError?: (teamName?: string) => void;
  activeTeams?: ActiveTeamRef[];
  onRelaunch: (request: TeamLaunchRequest, members: TeamCreateRequest['members']) => Promise<void>;
}

interface LaunchDialogScheduleMode {
  mode: 'schedule';
  open: boolean;
  /** Team name — optional when creating from standalone schedules page */
  teamName?: string;
  onClose: () => void;
  /** When provided → edit mode; null/undefined → create mode */
  schedule?: Schedule | null;
}

export type LaunchTeamDialogProps =
  | LaunchDialogLaunchMode
  | LaunchDialogRelaunchMode
  | LaunchDialogScheduleMode;

const APP_TEAM_RUNTIME_DISALLOWED_TOOLS = 'TeamDelete,TodoWrite,TaskCreate,TaskUpdate';

// =============================================================================
// Helpers
// =============================================================================

function getLocalTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return 'UTC';
  }
}

function getStoredTeamProvider(): TeamProviderId {
  const stored = localStorage.getItem('team:lastSelectedProvider');
  return normalizeCreateLaunchProviderForUi(normalizeOptionalTeamProviderId(stored), true);
}

function getStoredTeamModel(providerId: TeamProviderId): string {
  const stored = localStorage.getItem(`team:lastSelectedModel:${providerId}`);
  if (stored === null) {
    return providerId === 'anthropic' ? 'opus' : '';
  }
  return normalizeExplicitTeamModelForUi(providerId, stored === '__default__' ? '' : stored);
}

function getStoredTeamFastMode(): TeamFastMode {
  const stored = localStorage.getItem('team:lastSelectedFastMode');
  return stored === 'on' || stored === 'off' || stored === 'inherit' ? stored : 'inherit';
}

function getProviderLabel(providerId: TeamProviderId): string {
  return getCatalogTeamProviderLabel(providerId) ?? 'Anthropic';
}

function resolveMemberDraftRuntime(
  member: Pick<MemberDraft, 'providerId' | 'model' | 'effort'>,
  inheritedProviderId: TeamProviderId,
  inheritedModel: string,
  inheritedEffort: EffortLevel | undefined
): { providerId: TeamProviderId; model: string; effort: EffortLevel | undefined } {
  return {
    providerId: member.providerId ?? inheritedProviderId,
    model: member.model?.trim() || inheritedModel,
    effort: member.effort ?? inheritedEffort,
  };
}

function resolveResolvedMemberRuntime(
  member: Pick<ResolvedTeamMember, 'providerId' | 'model' | 'effort'>,
  inheritedProviderId: TeamProviderId,
  inheritedModel: string,
  inheritedEffort: EffortLevel | undefined
): { providerId: TeamProviderId; model: string; effort: EffortLevel | undefined } {
  return {
    providerId: normalizeOptionalTeamProviderId(member.providerId) ?? inheritedProviderId,
    model: member.model?.trim() || inheritedModel,
    effort: member.effort ?? inheritedEffort,
  };
}

function deriveTeammateWorktreeDefault(
  members: readonly {
    name: string;
    isolation?: 'worktree';
    removedAt?: number | string | null;
  }[]
): boolean {
  const activeTeammates = members.filter((member) => {
    const name = member.name.trim().toLowerCase();
    return !member.removedAt && !isLeadMemberName(name);
  });
  return (
    activeTeammates.length > 0 && activeTeammates.every((member) => member.isolation === 'worktree')
  );
}

// =============================================================================
// Component
// =============================================================================

export const LaunchTeamDialog = (props: LaunchTeamDialogProps): React.JSX.Element => {
  const { open, onClose } = props;
  const { isLight } = useTheme();
  const multimodelEnabled = useStore((s) => s.appConfig?.general?.multimodelEnabled ?? false);
  const anthropicProviderFastModeDefault = useStore(
    (s) => s.appConfig?.providerConnections?.anthropic.fastModeDefault ?? false
  );
  const cliStatus = useStore((s) => s.cliStatus);
  const cliStatusLoading = useStore((s) => s.cliStatusLoading);
  const bootstrapCliStatus = useStore((s) => s.bootstrapCliStatus);
  const fetchCliStatus = useStore((s) => s.fetchCliStatus);
  const isLaunchMode = props.mode === 'launch' || props.mode === 'relaunch';
  const isRelaunch = props.mode === 'relaunch';
  const loadingCliStatus = useMemo(
    () =>
      !cliStatus && cliStatusLoading && multimodelEnabled
        ? createLoadingMultimodelCliStatus()
        : cliStatus,
    [cliStatus, cliStatusLoading, multimodelEnabled]
  );
  const effectiveCliStatus = loadingCliStatus;
  const isSchedule = props.mode === 'schedule';
  const schedule = isSchedule ? (props.schedule ?? null) : null;
  const isEditing = isSchedule && !!schedule;

  // Team name: always present for launch mode, may be absent in schedule mode (standalone page)
  const propsTeamName = props.teamName ?? '';
  const [selectedTeamName, setSelectedTeamName] = useState('');
  const { teamByName, openDashboard } = useStore(
    useShallow((s) => ({
      teamByName: s.teamByName,
      openDashboard: s.openDashboard,
    }))
  );
  const openTeamTab = useStore((s) => s.openTeamTab);
  const teamOptions = useMemo(
    () =>
      Object.values(teamByName)
        .sort((a, b) => a.teamName.localeCompare(b.teamName))
        .map((team) => ({
          value: team.teamName,
          label: team.displayName || team.teamName,
          description: team.description || undefined,
          meta: { color: team.color },
        })),
    [teamByName]
  );

  // Effective team name: from props if provided, otherwise from local selection
  const effectiveTeamName = propsTeamName || selectedTeamName;
  const needsTeamSelector = isSchedule && !propsTeamName;

  // ---------------------------------------------------------------------------
  // Shared form state
  // ---------------------------------------------------------------------------

  const [cwdMode, setCwdMode] = useState<'project' | 'custom'>('project');
  const [selectedProjectPath, setSelectedProjectPath] = useState('');
  const [customCwd, setCustomCwd] = useState('');
  const promptDraft = useDraftPersistence({
    key: `launchTeam:${effectiveTeamName || 'standalone'}:${props.mode}:prompt`,
  });
  const chipDraft = useChipDraftPersistence(
    `launchTeam:${effectiveTeamName || 'standalone'}:${props.mode}:chips`
  );
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectsLoading, setProjectsLoading] = useState(false);
  const [projectsError, setProjectsError] = useState<string | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [machineProfiles, setMachineProfiles] = useState<MachineProfile[]>([]);
  const [selectedMachineId, setSelectedMachineId] = useState('local');

  const [selectedProviderId, setSelectedProviderIdRaw] = useState<TeamProviderId>(() =>
    normalizeLeadProviderForMode(getStoredTeamProvider(), multimodelEnabled)
  );
  const [selectedModel, setSelectedModelRaw] = useState(() =>
    getStoredTeamModel(normalizeLeadProviderForMode(getStoredTeamProvider(), multimodelEnabled))
  );
  const [membersDrafts, setMembersDrafts] = useState<MemberDraft[]>([]);
  const [teammateWorktreeDefault, setTeammateWorktreeDefault] = useState(false);
  const [syncModelsWithLead, setSyncModelsWithLead] = useState(false);
  const [skipPermissions, setSkipPermissionsRaw] = useState(
    () => localStorage.getItem('team:lastSkipPermissions') !== 'false'
  );
  const [selectedEffort, setSelectedEffortRaw] = useState(() => {
    const stored = localStorage.getItem('team:lastSelectedEffort');
    return stored === null ? 'medium' : stored;
  });
  const [selectedFastMode, setSelectedFastModeRaw] = useState<TeamFastMode>(getStoredTeamFastMode);
  const [anthropicRuntimeNotice, setAnthropicRuntimeNotice] = useState<string | null>(null);

  // ---------------------------------------------------------------------------
  // Launch-only state
  // ---------------------------------------------------------------------------

  const [limitContext, setLimitContextRaw] = useState(
    () => localStorage.getItem('team:lastLimitContext') === 'true'
  );
  const [clearContext, setClearContext] = useState(false);
  const [conflictDismissed, setConflictDismissed] = useState(false);
  const [prepareState, setPrepareState] = useState<'idle' | 'loading' | 'ready' | 'failed'>('idle');
  const [prepareMessage, setPrepareMessage] = useState<string | null>(null);
  const [prepareWarnings, setPrepareWarnings] = useState<string[]>([]);
  const [prepareChecks, setPrepareChecks] = useState<ProvisioningProviderCheck[]>([]);
  const prepareRequestSeqRef = useRef(0);
  const storeMembers = useStore((s) => selectResolvedMembersForTeamName(s, s.selectedTeamName));
  const previousLaunchParams = useStore((s) =>
    effectiveTeamName ? s.launchParamsByTeam[effectiveTeamName] : undefined
  );
  const members = isLaunchMode ? props.members : storeMembers;
  const [savedLaunchProviderId, setSavedLaunchProviderId] = useState<TeamProviderId | null>(null);
  const [savedLaunchProviderBackendId, setSavedLaunchProviderBackendId] = useState<string | null>(
    null
  );

  // Advanced CLI section state (with localStorage persistence)
  const [worktreeEnabled, setWorktreeEnabledRaw] = useState(
    () =>
      localStorage.getItem(`team:lastWorktreeEnabled:${effectiveTeamName}`) === 'true' &&
      Boolean(localStorage.getItem(`team:lastWorktreeName:${effectiveTeamName}`))
  );
  const [worktreeName, setWorktreeNameRaw] = useState(
    () => localStorage.getItem(`team:lastWorktreeName:${effectiveTeamName}`) ?? ''
  );
  const [customArgs, setCustomArgsRaw] = useState(
    () => localStorage.getItem(`team:lastCustomArgs:${effectiveTeamName}`) ?? ''
  );

  // ---------------------------------------------------------------------------
  // Schedule-only state
  // ---------------------------------------------------------------------------

  const [schedLabel, setSchedLabel] = useState('');
  const [schedExpanded, setSchedExpanded] = useState(true);
  const [cronExpression, setCronExpression] = useState('0 9 * * 1-5');
  const [timezone, setTimezone] = useState(getLocalTimezone);
  const [warmUpMinutes, setWarmUpMinutes] = useState(15);
  const [maxTurns, setMaxTurns] = useState(50);
  const [maxBudgetUsd, setMaxBudgetUsd] = useState('');
  const [scheduleHydrationKey, setScheduleHydrationKey] = useState<string | null>(null);
  const effectiveMemberDrafts = useMemo(
    () => (syncModelsWithLead ? membersDrafts.map(clearMemberModelOverrides) : membersDrafts),
    [membersDrafts, syncModelsWithLead]
  );
  const tmuxRuntime = useTmuxRuntimeReadiness(open && isLaunchMode);
  const selectedMemberProviders = useMemo<TeamProviderId[]>(
    () =>
      !multimodelEnabled
        ? ['anthropic']
        : Array.from(
            new Set([
              selectedProviderId,
              ...effectiveMemberDrafts.flatMap((member) =>
                !member.removedAt && isTeamProviderId(member.providerId) ? [member.providerId] : []
              ),
            ])
          ),
    [effectiveMemberDrafts, multimodelEnabled, selectedProviderId]
  );

  const runtimeBackendSummaryByProvider = useMemo(() => {
    const entries: (readonly [TeamProviderId, string | null])[] = (
      effectiveCliStatus?.providers ?? []
    ).map(
      (provider) =>
        [
          provider.providerId as TeamProviderId,
          getProvisioningProviderBackendSummary(provider),
        ] as const
    );
    return new Map<TeamProviderId, string | null>(entries);
  }, [effectiveCliStatus?.providers]);
  const runtimeBackendSummaryByProviderRef = useRef(runtimeBackendSummaryByProvider);
  const prepareChecksRef = useRef<ProvisioningProviderCheck[]>([]);
  const prepareModelResultsCacheRef = useRef(
    new Map<string, Record<string, ProviderPrepareDiagnosticsModelResult>>()
  );
  const lastPrepareRequestSignatureRef = useRef<string | null>(null);

  useEffect(() => {
    runtimeBackendSummaryByProviderRef.current = runtimeBackendSummaryByProvider;
  }, [runtimeBackendSummaryByProvider]);
  useEffect(() => {
    prepareChecksRef.current = prepareChecks;
  }, [prepareChecks]);
  useEffect(() => {
    if (!open) {
      lastPrepareRequestSignatureRef.current = null;
    }
  }, [open]);
  useEffect(() => {
    if (!open) return;
    void api.ssh
      .listMachines()
      .then(setMachineProfiles)
      .catch((error: unknown) => {
        console.warn('[LaunchTeamDialog] Failed to load machine profiles:', error);
        setMachineProfiles([]);
      });
  }, [open]);
  const runtimeProviderStatusById = useMemo(
    () =>
      new Map(
        (effectiveCliStatus?.providers ?? []).map(
          (provider) => [provider.providerId, provider] as const
        )
      ),
    [effectiveCliStatus?.providers]
  );

  useEffect(() => {
    if (!open) {
      return;
    }

    setMembersDrafts((prev) => {
      const sanitized = clearInheritedMemberModelsUnavailableForProvider({
        members: prev,
        selectedProviderId,
        runtimeProviderStatusById,
      });
      return sanitized.changed ? sanitized.members : prev;
    });
  }, [membersDrafts, open, runtimeProviderStatusById, selectedProviderId]);

  useEffect(() => {
    if (multimodelEnabled) {
      return;
    }
    if (selectedProviderId !== 'anthropic') {
      setSelectedProviderIdRaw('anthropic');
      setSelectedModelRaw(getStoredTeamModel('anthropic'));
    }
    setMembersDrafts((prev) => {
      let changed = false;
      const next = prev.map((member) => {
        const normalized = normalizeMemberDraftForProviderMode(member, false);
        if (normalized !== member) changed = true;
        return normalized;
      });
      return changed ? next : prev;
    });
  }, [multimodelEnabled, selectedProviderId]);

  useEffect(() => {
    if (!open || cliStatus || cliStatusLoading) {
      return;
    }
    void refreshCliStatusForCurrentMode({
      multimodelEnabled,
      bootstrapCliStatus,
      fetchCliStatus,
    });
  }, [bootstrapCliStatus, cliStatus, cliStatusLoading, fetchCliStatus, multimodelEnabled, open]);

  // Schedule store actions
  const createSchedule = useStore((s) => s.createSchedule);
  const updateSchedule = useStore((s) => s.updateSchedule);

  // ---------------------------------------------------------------------------
  // localStorage persistence wrappers
  // ---------------------------------------------------------------------------

  const setWorktreeEnabled = (value: boolean): void => {
    setWorktreeEnabledRaw(value);
    localStorage.setItem(`team:lastWorktreeEnabled:${effectiveTeamName}`, String(value));
    if (!value) {
      setWorktreeNameRaw('');
      localStorage.setItem(`team:lastWorktreeName:${effectiveTeamName}`, '');
    }
  };
  const setWorktreeName = (value: string): void => {
    setWorktreeNameRaw(value);
    localStorage.setItem(`team:lastWorktreeName:${effectiveTeamName}`, value);
  };
  const setCustomArgs = (value: string): void => {
    setCustomArgsRaw(value);
    localStorage.setItem(`team:lastCustomArgs:${effectiveTeamName}`, value);
  };

  const setSelectedProviderId = (value: TeamProviderId): void => {
    const normalizedValue = normalizeLeadProviderForMode(value, multimodelEnabled);
    setSelectedProviderIdRaw(normalizedValue);
    localStorage.setItem('team:lastSelectedProvider', normalizedValue);
    if (normalizedValue !== 'anthropic') {
      setLimitContextRaw(false);
      localStorage.setItem('team:lastLimitContext', 'false');
    }
    setSelectedModelRaw(getStoredTeamModel(normalizedValue));
  };

  const setSelectedModel = (value: string): void => {
    const normalizedValue = normalizeExplicitTeamModelForUi(selectedProviderId, value);
    setSelectedModelRaw(normalizedValue);
    localStorage.setItem(`team:lastSelectedModel:${selectedProviderId}`, normalizedValue);
  };

  const setLimitContext = (value: boolean): void => {
    setLimitContextRaw(value);
    localStorage.setItem('team:lastLimitContext', String(value));
  };

  const setSkipPermissions = (value: boolean): void => {
    setSkipPermissionsRaw(value);
    localStorage.setItem('team:lastSkipPermissions', String(value));
  };

  const setSelectedEffort = (value: string): void => {
    setSelectedEffortRaw(value);
    localStorage.setItem('team:lastSelectedEffort', value);
  };

  const setSelectedFastMode = (value: TeamFastMode): void => {
    setSelectedFastModeRaw(value);
    localStorage.setItem('team:lastSelectedFastMode', value);
  };

  // ---------------------------------------------------------------------------
  // localStorage migration: schedule → team namespace (one-time)
  // ---------------------------------------------------------------------------

  useEffect(() => {
    const legacyTeamModel = localStorage.getItem('team:lastSelectedModel');
    if (
      legacyTeamModel != null &&
      localStorage.getItem('team:lastSelectedModel:anthropic') == null
    ) {
      localStorage.setItem('team:lastSelectedModel:anthropic', legacyTeamModel);
    }
    localStorage.removeItem('team:lastSelectedModel');

    for (const suffix of ['lastSelectedModel', 'lastSelectedEffort']) {
      const schedKey = `schedule:${suffix}`;
      const teamKey =
        suffix === 'lastSelectedModel' ? 'team:lastSelectedModel:anthropic' : `team:${suffix}`;
      const schedVal = localStorage.getItem(schedKey);
      if (schedVal != null && localStorage.getItem(teamKey) == null) {
        localStorage.setItem(teamKey, schedVal);
      }
      localStorage.removeItem(schedKey);
    }
  }, []);

  // ---------------------------------------------------------------------------
  // Form reset / populate
  // ---------------------------------------------------------------------------

  const resetFormState = (): void => {
    setLocalError(null);
    setIsSubmitting(false);
    setPrepareState('idle');
    setPrepareMessage(null);
    setPrepareWarnings([]);
    setPrepareChecks([]);
    setCwdMode('project');
    setSelectedProjectPath('');
    setCustomCwd('');
    setClearContext(false);
    setConflictDismissed(false);
    setSelectedMachineId('local');
    setMembersDrafts([]);
    setSyncModelsWithLead(false);
    chipDraft.clearChipDraft();
    // Schedule fields
    setSelectedTeamName('');
    setSchedLabel('');
    setCronExpression('0 9 * * 1-5');
    setTimezone(getLocalTimezone());
    setWarmUpMinutes(15);
    setMaxTurns(50);
    setMaxBudgetUsd('');
  };

  const closeDialog = (): void => {
    if (isLaunchMode) {
      resetFormState();
    }
    onClose();
  };

  // Populate form in schedule edit mode
  useEffect(() => {
    if (!open || !isSchedule) return;

    if (schedule) {
      // Edit mode — populate from existing schedule
      setSchedLabel(schedule.label ?? '');
      setCronExpression(schedule.cronExpression);
      setTimezone(schedule.timezone);
      setWarmUpMinutes(schedule.warmUpMinutes);
      setMaxTurns(schedule.maxTurns);
      setMaxBudgetUsd(schedule.maxBudgetUsd != null ? String(schedule.maxBudgetUsd) : '');
      promptDraft.setValue(schedule.launchConfig.prompt);
      setCustomCwd(schedule.launchConfig.cwd);
      setCwdMode('custom');
      const scheduleProviderId = normalizeLeadProviderForMode(
        schedule.launchConfig.providerId,
        multimodelEnabled
      );
      setSelectedProviderIdRaw(scheduleProviderId);
      setSelectedModelRaw(
        scheduleProviderId === normalizeLeadProviderForMode(schedule.launchConfig.providerId, true)
          ? (schedule.launchConfig.model ?? '')
          : getStoredTeamModel('anthropic')
      );
      setSkipPermissionsRaw(schedule.launchConfig.skipPermissions !== false);
      setSelectedEffortRaw(schedule.launchConfig.effort ?? '');
      setSelectedFastModeRaw(schedule.launchConfig.fastMode ?? getStoredTeamFastMode());
      setSavedLaunchProviderBackendId(schedule.launchConfig.providerBackendId ?? null);
      setScheduleHydrationKey(`${schedule.id}:${schedule.updatedAt ?? ''}`);
    } else {
      // Create mode — reset to defaults
      setSchedLabel('');
      setCronExpression('0 9 * * 1-5');
      setTimezone(getLocalTimezone());
      setWarmUpMinutes(15);
      setMaxTurns(50);
      setMaxBudgetUsd('');
      promptDraft.setValue('');
      setCwdMode('project');
      setSelectedProjectPath('');
      setCustomCwd('');
      const storedProviderId = normalizeLeadProviderForMode(
        getStoredTeamProvider(),
        multimodelEnabled
      );
      setSelectedProviderIdRaw(storedProviderId);
      setSelectedModelRaw(getStoredTeamModel(storedProviderId));
      setSelectedEffortRaw('medium');
      setSelectedFastModeRaw(getStoredTeamFastMode());
      setSavedLaunchProviderBackendId(null);
      setScheduleHydrationKey(null);
    }

    setLocalError(null);
    setIsSubmitting(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, isSchedule, schedule?.id]);

  useEffect(() => {
    if (!open || !isLaunchMode) return;

    let cancelled = false;
    void (async () => {
      let savedRequest = null;
      try {
        savedRequest = effectiveTeamName
          ? await api.teams.getSavedRequest(effectiveTeamName)
          : null;
      } catch {
        savedRequest = null;
      }
      if (cancelled) return;

      const nextMembersSource =
        members.length > 0
          ? members
          : savedRequest?.members && savedRequest.members.length > 0
            ? savedRequest.members
            : [];
      const editableMembersSource = filterEditableMemberInputs(nextMembersSource);
      const storedEffort = localStorage.getItem('team:lastSelectedEffort');
      const savedProviderId = normalizeOptionalTeamProviderId(savedRequest?.providerId) ?? null;
      const savedProviderBackendId =
        typeof savedRequest?.providerBackendId === 'string' &&
        savedRequest.providerBackendId.trim().length > 0
          ? savedRequest.providerBackendId.trim()
          : null;
      const storedProviderId = normalizeLeadProviderForMode(
        getStoredTeamProvider(),
        multimodelEnabled
      );
      const launchPrefill = resolveLaunchDialogPrefill({
        members,
        savedRequest,
        previousLaunchParams,
        multimodelEnabled,
        storedProviderId,
        storedEffort: storedEffort === null ? 'medium' : storedEffort,
        storedFastMode: getStoredTeamFastMode(),
        storedLimitContext: localStorage.getItem('team:lastLimitContext') === 'true',
        getStoredModel: getStoredTeamModel,
      });
      setSavedLaunchProviderId(savedProviderId);
      setSavedLaunchProviderBackendId(
        launchPrefill.providerBackendId ?? savedProviderBackendId ?? null
      );

      setMembersDrafts(
        createMemberDraftsFromInputs(editableMembersSource).map((member) =>
          normalizeMemberDraftForProviderMode(member, multimodelEnabled)
        )
      );
      setTeammateWorktreeDefault(deriveTeammateWorktreeDefault(editableMembersSource));
      setSyncModelsWithLead(
        !editableMembersSource.some((member) => member.providerId || member.model || member.effort)
      );
      const leadProviderId = normalizeLeadProviderForMode(
        launchPrefill.providerId,
        multimodelEnabled
      );
      setSelectedProviderIdRaw(leadProviderId);
      setSelectedModelRaw(leadProviderId === launchPrefill.providerId ? launchPrefill.model : '');
      setSelectedEffortRaw(launchPrefill.effort);
      setSelectedFastModeRaw(launchPrefill.fastMode);
      setLimitContextRaw(launchPrefill.limitContext);
      setSkipPermissionsRaw(
        savedRequest?.skipPermissions ??
          localStorage.getItem('team:lastSkipPermissions') !== 'false'
      );
    })();

    return () => {
      cancelled = true;
    };
  }, [open, isLaunchMode, effectiveTeamName, members, multimodelEnabled, previousLaunchParams]);

  const previousProviderId = useMemo<TeamProviderId | null>(() => {
    if (!isLaunchMode) {
      return null;
    }
    return (
      normalizeOptionalTeamProviderId(previousLaunchParams?.providerId) ?? savedLaunchProviderId
    );
  }, [isLaunchMode, previousLaunchParams?.providerId, savedLaunchProviderId]);

  const providerChangeForcesFreshLeadContext = useMemo(() => {
    if (!isLaunchMode || !previousProviderId) {
      return false;
    }
    return previousProviderId !== selectedProviderId;
  }, [isLaunchMode, previousProviderId, selectedProviderId]);

  const effectiveAnthropicRuntimeLimitContext = isSchedule ? false : limitContext;

  const effectiveLeadRuntimeModel = useMemo(
    () =>
      computeEffectiveTeamModel(
        selectedModel,
        limitContext,
        selectedProviderId,
        runtimeProviderStatusById.get(selectedProviderId)
      ) ?? '',
    [limitContext, runtimeProviderStatusById, selectedModel, selectedProviderId]
  );
  const selectedProviderBackendId = useMemo(
    () =>
      resolveUiOwnedProviderBackendId(
        selectedProviderId,
        runtimeProviderStatusById.get(selectedProviderId)
      ) ??
      migrateProviderBackendId(
        selectedProviderId,
        previousLaunchParams?.providerBackendId ?? savedLaunchProviderBackendId
      ) ??
      undefined,
    [
      previousLaunchParams?.providerBackendId,
      runtimeProviderStatusById,
      savedLaunchProviderBackendId,
      selectedProviderId,
    ]
  );
  const teammateRuntimeCompatibility = useMemo(
    () =>
      analyzeTeammateRuntimeCompatibility({
        leadProviderId: selectedProviderId,
        leadProviderBackendId: selectedProviderBackendId,
        members: isLaunchMode ? effectiveMemberDrafts : [],
        extraCliArgs: isLaunchMode ? customArgs : undefined,
        tmuxStatus: tmuxRuntime.status,
        tmuxStatusLoading: tmuxRuntime.loading,
        tmuxStatusError: tmuxRuntime.error,
      }),
    [
      customArgs,
      effectiveMemberDrafts,
      isLaunchMode,
      selectedProviderBackendId,
      selectedProviderId,
      tmuxRuntime.error,
      tmuxRuntime.loading,
      tmuxRuntime.status,
    ]
  );
  const anthropicRuntimeSelection = useMemo(
    () =>
      selectedProviderId === 'anthropic'
        ? resolveAnthropicRuntimeSelection({
            source: {
              modelCatalog: runtimeProviderStatusById.get('anthropic')?.modelCatalog,
              runtimeCapabilities: runtimeProviderStatusById.get('anthropic')?.runtimeCapabilities,
            },
            selectedModel,
            limitContext: effectiveAnthropicRuntimeLimitContext,
          })
        : null,
    [
      effectiveAnthropicRuntimeLimitContext,
      runtimeProviderStatusById,
      selectedModel,
      selectedProviderId,
    ]
  );
  const anthropicFastModeResolution = useMemo(
    () =>
      selectedProviderId === 'anthropic' && anthropicRuntimeSelection
        ? resolveAnthropicFastMode({
            selection: anthropicRuntimeSelection,
            selectedFastMode,
            providerFastModeDefault: anthropicProviderFastModeDefault,
          })
        : null,
    [
      anthropicProviderFastModeDefault,
      anthropicRuntimeSelection,
      selectedFastMode,
      selectedProviderId,
    ]
  );
  useEffect(() => {
    if (isSchedule && schedule) {
      const nextHydrationKey = `${schedule.id}:${schedule.updatedAt ?? ''}`;
      if (scheduleHydrationKey !== nextHydrationKey) {
        return;
      }
    }

    if (selectedProviderId !== 'anthropic') {
      setAnthropicRuntimeNotice(null);
      return;
    }

    const reconciliation = reconcileAnthropicRuntimeSelections({
      selection:
        anthropicRuntimeSelection ??
        resolveAnthropicRuntimeSelection({
          source: {
            modelCatalog: null,
            runtimeCapabilities: null,
          },
          selectedModel,
          limitContext: effectiveAnthropicRuntimeLimitContext,
        }),
      selectedEffort,
      selectedFastMode,
      providerFastModeDefault: anthropicProviderFastModeDefault,
    });

    const notices: string[] = [];
    if (reconciliation.nextEffort !== selectedEffort) {
      setSelectedEffortRaw(reconciliation.nextEffort);
      localStorage.setItem('team:lastSelectedEffort', reconciliation.nextEffort);
      if (reconciliation.effortResetReason) {
        notices.push(reconciliation.effortResetReason);
      }
    }
    if (reconciliation.nextFastMode !== selectedFastMode) {
      setSelectedFastModeRaw(reconciliation.nextFastMode);
      localStorage.setItem('team:lastSelectedFastMode', reconciliation.nextFastMode);
      if (reconciliation.fastModeResetReason) {
        notices.push(reconciliation.fastModeResetReason);
      }
    }
    setAnthropicRuntimeNotice(notices.length > 0 ? notices.join(' ') : null);
  }, [
    anthropicProviderFastModeDefault,
    anthropicRuntimeSelection,
    effectiveAnthropicRuntimeLimitContext,
    selectedEffort,
    selectedFastMode,
    selectedModel,
    selectedProviderId,
    schedule,
    scheduleHydrationKey,
    isSchedule,
  ]);

  const selectedModelChecksByProvider = useMemo(() => {
    const modelsByProvider = new Map<TeamProviderId, string[]>();
    const defaultSelectionByProvider = new Map<TeamProviderId, boolean>();
    const addModel = (providerId: TeamProviderId, model: string | undefined): void => {
      const trimmed = model?.trim() ?? '';
      if (!trimmed) {
        return;
      }
      const existing = modelsByProvider.get(providerId) ?? [];
      if (!existing.includes(trimmed)) {
        modelsByProvider.set(providerId, [...existing, trimmed]);
      }
    };
    const addDefaultSelection = (providerId: TeamProviderId): void => {
      if (providerId === 'anthropic' && selectedProviderId === 'anthropic') {
        defaultSelectionByProvider.set(providerId, true);
      }
    };

    if (selectedModel.trim()) {
      addModel(selectedProviderId, effectiveLeadRuntimeModel);
    } else {
      addDefaultSelection(selectedProviderId);
    }
    for (const member of effectiveMemberDrafts) {
      if (member.removedAt) {
        continue;
      }
      const scopedModel = resolveProviderScopedMemberModel({
        memberProviderId: member.providerId,
        memberModel: member.model,
        selectedProviderId,
        runtimeProviderStatusById,
      });
      if (scopedModel.model) {
        addModel(scopedModel.providerId, scopedModel.model);
      } else {
        addDefaultSelection(scopedModel.providerId);
      }
    }
    for (const providerId of defaultSelectionByProvider.keys()) {
      addModel(providerId, DEFAULT_PROVIDER_MODEL_SELECTION);
    }

    return modelsByProvider;
  }, [
    effectiveLeadRuntimeModel,
    effectiveMemberDrafts,
    runtimeProviderStatusById,
    selectedModel,
    selectedProviderId,
  ]);

  const runtimeChangeNotes = useMemo(() => {
    if (!isLaunchMode) {
      return [] as { key: string; memberName: string; message: string }[];
    }

    const notes: { key: string; memberName: string; message: string }[] = [];
    const previousLeadModel = previousLaunchParams?.model?.trim() || '';
    const previousLeadEffort = previousLaunchParams?.effort;
    const currentLeadDisplayModel = selectedModel.trim() || effectiveLeadRuntimeModel;

    if (
      previousProviderId &&
      (previousProviderId !== selectedProviderId ||
        previousLeadModel !== currentLeadDisplayModel ||
        (previousLeadEffort ?? '') !== ((selectedEffort as EffortLevel | '') || ''))
    ) {
      notes.push({
        key: 'lead',
        memberName: CANONICAL_LEAD_MEMBER_NAME,
        message: `${formatTeamModelSummary(
          selectedProviderId,
          currentLeadDisplayModel,
          (selectedEffort as EffortLevel) || undefined
        )}，而不是 ${formatTeamModelSummary(
          previousProviderId,
          previousLeadModel,
          previousLeadEffort
        )}`,
      });
    }

    const previousMembersByName = new Map(
      members.map((member) => [member.name.trim().toLowerCase(), member] as const)
    );

    for (const member of effectiveMemberDrafts) {
      if (member.removedAt) {
        continue;
      }

      const name = member.name.trim();
      if (!name) {
        continue;
      }

      const previousMember = previousMembersByName.get(name.toLowerCase());
      if (!previousMember) {
        continue;
      }

      const {
        providerId: currentProviderId,
        model: currentModel,
        effort: currentEffort,
      } = resolveMemberDraftRuntime(
        member,
        selectedProviderId,
        currentLeadDisplayModel,
        (selectedEffort as EffortLevel) || undefined
      );

      const {
        providerId: previousProvider,
        model: previousModel,
        effort: previousEffort,
      } = resolveResolvedMemberRuntime(
        previousMember,
        previousProviderId ?? 'anthropic',
        previousLeadModel,
        previousLeadEffort
      );

      if (
        previousProvider === currentProviderId &&
        previousModel === currentModel &&
        (previousEffort ?? '') === (currentEffort ?? '') &&
        (previousMember.isolation ?? '') === (member.isolation ?? '')
      ) {
        continue;
      }

      const runtimeMessage =
        previousProvider !== currentProviderId ||
        previousModel !== currentModel ||
        (previousEffort ?? '') !== (currentEffort ?? '')
          ? `${formatTeamModelSummary(
              currentProviderId,
              currentModel,
              currentEffort
            )}，而不是 ${formatTeamModelSummary(previousProvider, previousModel, previousEffort)}`
          : null;
      const isolationMessage =
        previousMember.isolation !== member.isolation
          ? `${member.isolation === 'worktree' ? '独立 worktree' : '共享工作区'}，而不是 ${
              previousMember.isolation === 'worktree' ? '独立 worktree' : '共享工作区'
            }`
          : null;

      notes.push({
        key: `member:${name.toLowerCase()}`,
        memberName: name,
        message: [runtimeMessage, isolationMessage]
          .filter((part): part is string => Boolean(part))
          .join('; '),
      });
    }

    return notes;
  }, [
    isLaunchMode,
    previousLaunchParams?.effort,
    previousLaunchParams?.model,
    previousProviderId,
    selectedProviderId,
    selectedModel,
    effectiveLeadRuntimeModel,
    selectedEffort,
    members,
    effectiveMemberDrafts,
  ]);

  const runtimeChangeNoteByKey = useMemo(
    () => new Map(runtimeChangeNotes.map((note) => [note.key, note.message] as const)),
    [runtimeChangeNotes]
  );

  const leadRuntimeWarningText = useMemo(() => {
    const parts: string[] = [];
    if (providerChangeForcesFreshLeadContext && previousProviderId) {
      parts.push(
        `提供商已从 ${getProviderLabel(previousProviderId)} 更改为 ${getProviderLabel(selectedProviderId)}。之前的负责人会话不会恢复，负责人会以全新上下文启动。`
      );
    }
    const runtimeChange = runtimeChangeNoteByKey.get('lead');
    if (runtimeChange) {
      parts.push(`下次启动将使用 ${runtimeChange}。`);
    }
    return parts.length > 0 ? parts.join(' ') : null;
  }, [
    providerChangeForcesFreshLeadContext,
    previousProviderId,
    selectedProviderId,
    runtimeChangeNoteByKey,
  ]);

  const memberRuntimeWarningById = useMemo(() => {
    const warnings: Record<string, string> = {};
    for (const member of effectiveMemberDrafts) {
      const name = member.name.trim();
      if (!name || member.removedAt) {
        continue;
      }
      const note = runtimeChangeNoteByKey.get(`member:${name.toLowerCase()}`);
      if (note) {
        warnings[member.id] = `下次启动将使用 ${note}。`;
      }
    }
    return warnings;
  }, [effectiveMemberDrafts, runtimeChangeNoteByKey]);
  const combinedMemberRuntimeWarningById = useMemo(() => {
    const warnings: Record<string, string> = { ...memberRuntimeWarningById };
    for (const [memberId, warning] of Object.entries(
      teammateRuntimeCompatibility.memberWarningById
    )) {
      warnings[memberId] = warnings[memberId] ? `${warnings[memberId]} ${warning}` : warning;
    }
    return warnings;
  }, [memberRuntimeWarningById, teammateRuntimeCompatibility.memberWarningById]);

  // ---------------------------------------------------------------------------
  // Launch-only effects
  // ---------------------------------------------------------------------------

  const selectedProjectCwd = isEphemeralProjectPath(selectedProjectPath)
    ? ''
    : selectedProjectPath.trim();
  const effectiveCwd = cwdMode === 'project' ? selectedProjectCwd : customCwd.trim();
  const prepareRuntimeStatusSignature = useMemo(
    () =>
      buildProviderPrepareRuntimeStatusSignature(
        selectedMemberProviders,
        runtimeProviderStatusById
      ),
    [runtimeProviderStatusById, selectedMemberProviders]
  );
  const selectedModelChecksByProviderSignature = useMemo(
    () => buildProviderPrepareModelChecksSignature(selectedModelChecksByProvider),
    [selectedModelChecksByProvider]
  );
  const prepareRequestSignature = useMemo(
    () =>
      buildProviderPrepareRequestSignature({
        cwd: effectiveCwd,
        selectedProviderId,
        selectedModel,
        selectedMemberProviders,
        limitContext,
        runtimeStatusSignature: prepareRuntimeStatusSignature,
        modelChecksSignature: selectedModelChecksByProviderSignature,
      }),
    [
      effectiveCwd,
      limitContext,
      prepareRuntimeStatusSignature,
      selectedMemberProviders,
      selectedModel,
      selectedModelChecksByProviderSignature,
      selectedProviderId,
    ]
  );

  // Clear stale provisioning error when dialog opens
  useEffect(() => {
    if (!open || !isLaunchMode) return;
    props.clearProvisioningError?.(effectiveTeamName);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, isLaunchMode, effectiveTeamName]);

  // Warm up CLI for the currently selected working directory (launch mode only).
  useEffect(() => {
    if (!open || !isLaunchMode) {
      prepareRequestSeqRef.current += 1;
      lastPrepareRequestSignatureRef.current = null;
      return;
    }

    if (typeof api.teams.prepareProvisioning !== 'function') {
      prepareRequestSeqRef.current += 1;
      lastPrepareRequestSignatureRef.current = null;
      setPrepareState('failed');
      setPrepareWarnings([]);
      setPrepareChecks([]);
      setPrepareMessage('当前 preload 版本不支持 team:prepareProvisioning，请重启开发应用。');
      return;
    }

    if (!effectiveCwd) {
      prepareRequestSeqRef.current += 1;
      lastPrepareRequestSignatureRef.current = null;
      setPrepareState('idle');
      setPrepareWarnings([]);
      setPrepareChecks([]);
      setPrepareMessage('请选择工作目录以验证启动环境。');
      return;
    }

    if (lastPrepareRequestSignatureRef.current === prepareRequestSignature) {
      return;
    }
    lastPrepareRequestSignatureRef.current = prepareRequestSignature;

    const requestSeq = ++prepareRequestSeqRef.current;
    const initialChecks = alignProvisioningChecks(
      prepareChecksRef.current,
      selectedMemberProviders
    );
    setPrepareState('loading');
    setPrepareMessage('正在并行检查选中的提供商...');
    setPrepareWarnings([]);
    setPrepareChecks(initialChecks);

    void (async () => {
      let checks = initialChecks;
      const providerPlans = selectedMemberProviders.map((providerId) => {
        const selectedModelChecks = selectedModelChecksByProvider.get(providerId) ?? [];
        const backendSummary = runtimeBackendSummaryByProviderRef.current.get(providerId) ?? null;
        const cacheKey = buildProviderPrepareModelCacheKey({
          cwd: effectiveCwd,
          providerId,
          backendSummary,
          limitContext,
          runtimeStatusSignature: prepareRuntimeStatusSignature,
        });
        const cachedModelResultsById = {
          ...getShortLivedProviderPrepareModelResults({
            providerId,
            cacheKey,
          }),
          ...(prepareModelResultsCacheRef.current.get(cacheKey) ?? {}),
        };
        const cachedSnapshot = getProviderPrepareCachedSnapshot({
          providerId,
          selectedModelIds: selectedModelChecks,
          cachedModelResultsById,
        });
        return {
          providerId,
          selectedModelChecks,
          backendSummary,
          cacheKey,
          cachedModelResultsById,
          cachedSnapshot,
        };
      });

      try {
        for (const plan of providerPlans) {
          checks = updateProviderCheck(checks, plan.providerId, {
            status: plan.selectedModelChecks.length > 0 ? plan.cachedSnapshot.status : 'checking',
            backendSummary: plan.backendSummary,
            details: plan.cachedSnapshot.details,
          });
        }
        if (prepareRequestSeqRef.current === requestSeq) {
          setPrepareChecks(checks);
        }
        const providerResults = await Promise.all(
          providerPlans.map(async (plan) => {
            const prepResult = await runProviderPrepareDiagnostics({
              cwd: effectiveCwd,
              providerId: plan.providerId,
              selectedModelIds: plan.selectedModelChecks,
              prepareProvisioning: api.teams.prepareProvisioning,
              limitContext,
              cachedModelResultsById: plan.cachedModelResultsById,
              onModelProgress: ({ status, details }) => {
                checks = updateProviderCheck(checks, plan.providerId, {
                  status,
                  backendSummary: plan.backendSummary,
                  details,
                });
                if (prepareRequestSeqRef.current === requestSeq) {
                  setPrepareChecks(checks);
                }
              },
            });
            return { ...plan, prepResult };
          })
        );
        let anyFailure = false;
        let anyNotes = false;
        const collectedWarnings: string[] = [];
        for (const plan of providerResults) {
          if (plan.prepResult.warnings.length > 0) {
            anyNotes = true;
            collectedWarnings.push(
              ...plan.prepResult.warnings.map(
                (warning) => `${getProviderLabel(plan.providerId)}: ${warning}`
              )
            );
          }
          if (plan.prepResult.status === 'failed') {
            anyFailure = true;
          } else if (plan.prepResult.status === 'notes') {
            anyNotes = true;
          }
          if (prepareRequestSeqRef.current === requestSeq) {
            const reusableModelResults = buildReusableProviderPrepareModelResults(
              plan.prepResult.modelResultsById
            );
            prepareModelResultsCacheRef.current.set(plan.cacheKey, reusableModelResults);
            storeShortLivedProviderPrepareModelResults({
              providerId: plan.providerId,
              cacheKey: plan.cacheKey,
              modelResultsById: plan.prepResult.modelResultsById,
            });
          }
          checks = updateProviderCheck(checks, plan.providerId, {
            status: plan.prepResult.status,
            backendSummary: plan.backendSummary,
            details: plan.prepResult.details,
          });
        }
        if (prepareRequestSeqRef.current === requestSeq) {
          setPrepareChecks(checks);
        }
        if (prepareRequestSeqRef.current !== requestSeq) return;
        const failureMessage =
          getPrimaryProvisioningFailureDetail(checks) ?? '部分所选提供商需要处理。';
        setPrepareState(anyFailure ? 'failed' : 'ready');
        setPrepareMessage(
          anyFailure
            ? failureMessage
            : anyNotes
              ? '所选提供商已就绪（含提示）。'
              : '所选提供商已就绪。'
        );
        setPrepareWarnings(collectedWarnings);
      } catch (error) {
        if (prepareRequestSeqRef.current !== requestSeq) return;
        const failureMessage = error instanceof Error ? error.message : '预热 Claude CLI 环境失败';
        setPrepareState('failed');
        setPrepareWarnings([]);
        setPrepareChecks(failIncompleteProviderChecks(checks, failureMessage));
        setPrepareMessage(failureMessage);
      }
    })();
  }, [
    open,
    isLaunchMode,
    effectiveCwd,
    prepareRequestSignature,
    selectedProviderId,
    selectedMemberProviders,
    selectedModelChecksByProvider,
  ]);

  // ---------------------------------------------------------------------------
  // Shared effects: projects
  // ---------------------------------------------------------------------------

  const repositoryGroups = useStore(useShallow((s) => s.repositoryGroups));

  useEffect(() => {
    if (!open) return;

    setProjectsLoading(true);
    setProjectsError(null);

    let cancelled = false;
    void (async () => {
      try {
        const apiProjects = (await api.getProjects()).filter(
          (project) => !isEphemeralProjectPath(project.path)
        );
        if (cancelled) return;

        const pathSet = new Set(apiProjects.map((p) => p.path));
        const extras: Project[] = [];
        for (const repo of repositoryGroups) {
          for (const wt of repo.worktrees) {
            if (!isEphemeralProjectPath(wt.path) && !pathSet.has(wt.path)) {
              pathSet.add(wt.path);
              extras.push({
                id: wt.id,
                path: wt.path,
                name: wt.name,
                sessions: [],
                totalSessions: 0,
                createdAt: wt.createdAt ?? Date.now(),
              });
            }
          }
        }

        setProjects([...apiProjects, ...extras]);
      } catch (error) {
        if (cancelled) return;
        setProjectsError(error instanceof Error ? error.message : '项目加载失败');
        setProjects([]);
      } finally {
        if (!cancelled) setProjectsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, repositoryGroups]);

  // Pre-select defaultProjectPath (launch mode) or first project
  const defaultProjectPath = isLaunchMode ? props.defaultProjectPath : undefined;

  useEffect(() => {
    if (!open || cwdMode !== 'project' || selectedProjectPath) return;
    const selectableProjects = projects.filter((project) => !isEphemeralProjectPath(project.path));
    if (selectableProjects.length === 0) return;
    if (defaultProjectPath && !isEphemeralProjectPath(defaultProjectPath)) {
      const normalizedDefaultProjectPath = normalizePath(defaultProjectPath);
      const match = selectableProjects.find(
        (p) => normalizePath(p.path) === normalizedDefaultProjectPath
      );
      if (match) {
        setSelectedProjectPath(match.path);
        return;
      }
    }
    setSelectedProjectPath(selectableProjects[0].path);
  }, [open, cwdMode, projects, selectedProjectPath, defaultProjectPath]);

  useEffect(() => {
    if (!open || cwdMode !== 'project' || !selectedProjectPath) {
      return;
    }
    if (!isEphemeralProjectPath(selectedProjectPath)) {
      return;
    }
    setSelectedProjectPath('');
  }, [open, cwdMode, selectedProjectPath, setSelectedProjectPath]);

  // Pre-warm file list cache so @-mention file search is instant
  useFileListCacheWarmer(effectiveCwd || null);

  // ---------------------------------------------------------------------------
  // Launch-only: conflict detection
  // ---------------------------------------------------------------------------

  const activeTeams = isLaunchMode ? props.activeTeams : undefined;

  const conflictingTeam = useMemo(() => {
    if (!isLaunchMode || !activeTeams?.length || !effectiveCwd) return null;
    const norm = normalizePath(effectiveCwd);
    return (
      activeTeams.find(
        (t) => t.teamName !== effectiveTeamName && normalizePath(t.projectPath) === norm
      ) ?? null
    );
  }, [isLaunchMode, activeTeams, effectiveCwd, effectiveTeamName]);

  useEffect(() => {
    setConflictDismissed(false);
  }, [conflictingTeam?.teamName, effectiveCwd]);

  // ---------------------------------------------------------------------------
  // Mention suggestions (shared — from props in launch, from store in schedule)
  // ---------------------------------------------------------------------------

  const { suggestions: taskSuggestions } = useTaskSuggestions(null);
  const { suggestions: teamMentionSuggestions } = useTeamSuggestions(null);
  const memberColorMap = useMemo(
    () => buildMemberDraftColorMap(membersDrafts, members),
    [membersDrafts, members]
  );
  const mentionSuggestions = useMemo<MentionSuggestion[]>(
    () => buildMemberDraftSuggestions(membersDrafts, memberColorMap),
    [memberColorMap, membersDrafts]
  );

  // ---------------------------------------------------------------------------
  // Launch-only: internal args preview
  // ---------------------------------------------------------------------------

  const internalArgs = useMemo(() => {
    if (!isLaunchMode) return [];
    const args: string[] = [];
    args.push('--input-format', 'stream-json', '--output-format', 'stream-json');
    args.push('--verbose', '--setting-sources', 'user,project,local');
    args.push('--mcp-config', '<auto>', '--disallowedTools', APP_TEAM_RUNTIME_DISALLOWED_TOOLS);
    if (skipPermissions) args.push('--dangerously-skip-permissions');
    const model = computeEffectiveTeamModel(
      selectedModel,
      limitContext,
      selectedProviderId,
      runtimeProviderStatusById.get(selectedProviderId)
    );
    if (model) args.push('--model', model);
    const effectiveEffort =
      selectedProviderId === 'anthropic'
        ? selectedEffort || anthropicRuntimeSelection?.defaultEffort || ''
        : selectedEffort;
    if (effectiveEffort) args.push('--effort', effectiveEffort);
    if (selectedProviderId === 'anthropic') {
      const fastSettings = anthropicFastModeResolution?.resolvedFastMode
        ? { fastMode: true, fastModePerSessionOptIn: false }
        : { fastMode: false };
      args.push('--settings', JSON.stringify(fastSettings));
    }
    if (!clearContext) args.push('--resume', '<previous>');
    return args;
  }, [
    anthropicFastModeResolution?.resolvedFastMode,
    anthropicRuntimeSelection?.defaultEffort,
    isLaunchMode,
    skipPermissions,
    selectedModel,
    limitContext,
    selectedEffort,
    selectedProviderId,
    clearContext,
    runtimeProviderStatusById,
  ]);

  const launchOptionalSummary = useMemo(() => {
    if (!isLaunchMode) return [];

    const summary: string[] = [];
    if (promptDraft.value.trim()) summary.push('负责人提示词');
    const worktreeMemberCount = effectiveMemberDrafts.filter(
      (member) => !member.removedAt && member.isolation === 'worktree'
    ).length;
    if (worktreeMemberCount > 0) {
      summary.push(`${worktreeMemberCount} 个成员使用独立 worktree`);
    }
    summary.push(`提供商：${getProviderLabel(selectedProviderId)}`);
    if (selectedModel) summary.push(`模型：${selectedModel}`);
    if (selectedEffort) summary.push(`推理强度：${selectedEffort}`);
    if (selectedProviderId === 'anthropic') {
      if (selectedFastMode === 'on') summary.push('快速模式');
      else if (selectedFastMode === 'off') summary.push('快速模式关闭');
      else if (selectedProviderId === 'anthropic' && anthropicProviderFastModeDefault) {
        summary.push('快速默认');
      }
    }
    if (selectedProviderId === 'anthropic' && limitContext) summary.push('上下文限制为 200K');
    if (skipPermissions) summary.push('自动批准工具');
    if (clearContext) summary.push('全新会话');
    if (worktreeEnabled && worktreeName.trim()) summary.push(`Worktree：${worktreeName.trim()}`);
    if (customArgs.trim()) summary.push('自定义 CLI 参数');
    return summary;
  }, [
    isLaunchMode,
    effectiveMemberDrafts,
    promptDraft.value,
    selectedModel,
    selectedProviderId,
    selectedEffort,
    selectedFastMode,
    anthropicProviderFastModeDefault,
    limitContext,
    skipPermissions,
    clearContext,
    worktreeEnabled,
    worktreeName,
    customArgs,
  ]);

  // ---------------------------------------------------------------------------
  // Validation
  // ---------------------------------------------------------------------------

  const validationErrors = useMemo(() => {
    const errors: string[] = [];
    if (!effectiveCwd) errors.push('必须填写工作目录');
    if (isSchedule) {
      if (!effectiveTeamName) errors.push('必须选择团队');
      if (!promptDraft.value.trim()) errors.push('必须填写提示词');
      if (!cronExpression.trim()) errors.push('必须填写 Cron 表达式');
    }
    return errors;
  }, [effectiveCwd, isSchedule, effectiveTeamName, promptDraft.value, cronExpression]);
  const modelValidationError = useMemo(() => {
    const leadError = getTeamModelSelectionError(
      selectedProviderId,
      selectedModel,
      runtimeProviderStatusById.get(selectedProviderId)
    );
    if (leadError) {
      return leadError;
    }

    if (!isLaunchMode) {
      return null;
    }

    for (const member of effectiveMemberDrafts) {
      if (member.removedAt) {
        continue;
      }

      const providerId = normalizeOptionalTeamProviderId(member.providerId) ?? selectedProviderId;
      const memberError = getTeamModelSelectionError(
        providerId,
        member.model,
        runtimeProviderStatusById.get(providerId)
      );
      if (!memberError) {
        continue;
      }

      const memberName = member.name.trim();
      return memberName ? `${memberName}: ${memberError}` : memberError;
    }

    return null;
  }, [
    effectiveMemberDrafts,
    isLaunchMode,
    runtimeProviderStatusById,
    selectedModel,
    selectedProviderId,
  ]);
  const leadModelIssueText = useMemo(() => {
    const issue = getProvisioningModelIssue(
      prepareChecks,
      selectedProviderId,
      effectiveLeadRuntimeModel || selectedModel
    );
    return issue?.reason ?? issue?.detail ?? null;
  }, [effectiveLeadRuntimeModel, prepareChecks, selectedModel, selectedProviderId]);
  const memberModelIssueById = useMemo(() => {
    const next: Record<string, string> = {};
    if (!isLaunchMode) {
      return next;
    }
    for (const member of effectiveMemberDrafts) {
      if (member.removedAt) {
        continue;
      }
      if (syncModelsWithLead && leadModelIssueText) {
        next[member.id] = leadModelIssueText;
        continue;
      }
      const providerId = normalizeOptionalTeamProviderId(member.providerId) ?? selectedProviderId;
      const issue = getProvisioningModelIssue(prepareChecks, providerId, member.model);
      const issueText = issue?.reason ?? issue?.detail ?? null;
      if (issueText) {
        next[member.id] = issueText;
      }
    }
    return next;
  }, [
    effectiveMemberDrafts,
    isLaunchMode,
    leadModelIssueText,
    prepareChecks,
    selectedProviderId,
    syncModelsWithLead,
  ]);
  const hasInvalidLaunchMemberNames = useMemo(
    () =>
      isLaunchMode &&
      membersDrafts.some(
        (member) => !member.name.trim() || validateMemberNameInline(member.name.trim()) !== null
      ),
    [isLaunchMode, membersDrafts]
  );
  const hasDuplicateLaunchMemberNames = useMemo(() => {
    if (!isLaunchMode) return false;
    const activeNames = membersDrafts
      .map((member) => member.name.trim().toLowerCase())
      .filter(Boolean);
    return new Set(activeNames).size !== activeNames.length;
  }, [isLaunchMode, membersDrafts]);

  // ---------------------------------------------------------------------------
  // Error
  // ---------------------------------------------------------------------------

  const provisioningError = isLaunchMode ? props.provisioningError : null;
  const activeError = localError ?? modelValidationError ?? provisioningError;
  const effectivePrepare = useMemo(
    () =>
      deriveEffectiveProvisioningPrepareState({
        state: prepareState,
        message: prepareMessage,
        warnings: prepareWarnings,
        checks: prepareChecks,
      }),
    [prepareChecks, prepareMessage, prepareState, prepareWarnings]
  );
  const launchInFlight = useStore((s) =>
    isLaunchMode && effectiveTeamName ? isTeamProvisioningActive(s, effectiveTeamName) : false
  );

  useEffect(() => {
    if (!open || !isLaunchMode || !effectiveTeamName || !launchInFlight) {
      return;
    }

    openTeamTab(effectiveTeamName, effectiveCwd || defaultProjectPath);
    closeDialog();
  }, [
    closeDialog,
    defaultProjectPath,
    effectiveCwd,
    effectiveTeamName,
    isLaunchMode,
    launchInFlight,
    open,
    openTeamTab,
  ]);

  // ---------------------------------------------------------------------------
  // Submit
  // ---------------------------------------------------------------------------

  const handleSubmit = (): void => {
    if (validationErrors.length > 0) {
      setLocalError(validationErrors[0]);
      return;
    }
    if (modelValidationError) {
      setLocalError(modelValidationError);
      return;
    }
    if (isLaunchMode && teammateRuntimeCompatibility.blocksSubmission) {
      setLocalError(teammateRuntimeCompatibility.message);
      return;
    }
    if (isLaunchMode && !effectiveCwd) {
      setLocalError('请选择工作目录（cwd）');
      return;
    }
    if (
      isLaunchMode &&
      membersDrafts.some(
        (member) => !member.name.trim() || validateMemberNameInline(member.name.trim()) !== null
      )
    ) {
      setLocalError('请先修正成员名称再启动');
      return;
    }
    if (isLaunchMode) {
      const activeNames = membersDrafts
        .map((member) => member.name.trim().toLowerCase())
        .filter(Boolean);
      if (new Set(activeNames).size !== activeNames.length) {
        setLocalError('启动前成员名称不能重复');
        return;
      }
    }
    setLocalError(null);
    setIsSubmitting(true);

    void (async () => {
      try {
        if (isLaunchMode) {
          const nextMembers = buildMembersFromDrafts(effectiveMemberDrafts);
          const launchRequest: TeamLaunchRequest = {
            teamName: effectiveTeamName,
            cwd: effectiveCwd,
            executionTarget:
              selectedMachineId === 'local'
                ? { type: 'local', cwd: effectiveCwd || undefined }
                : { type: 'ssh', machineId: selectedMachineId, cwd: effectiveCwd || undefined },
            prompt: promptDraft.value.trim() || undefined,
            providerId: selectedProviderId,
            providerBackendId:
              resolveUiOwnedProviderBackendId(
                selectedProviderId,
                runtimeProviderStatusById.get(selectedProviderId)
              ) ??
              selectedProviderBackendId ??
              undefined,
            model: computeEffectiveTeamModel(
              selectedModel,
              limitContext,
              selectedProviderId,
              runtimeProviderStatusById.get(selectedProviderId)
            ),
            effort: (selectedEffort as EffortLevel) || undefined,
            fastMode: selectedFastMode,
            limitContext,
            clearContext: clearContext || undefined,
            skipPermissions,
            worktree: worktreeEnabled && worktreeName.trim() ? worktreeName.trim() : undefined,
            extraCliArgs: customArgs.trim() || undefined,
          };
          if (isRelaunch) {
            await props.onRelaunch(launchRequest, nextMembers);
          } else {
            await api.teams.replaceMembers(effectiveTeamName, {
              members: nextMembers,
            });
            await props.onLaunch(launchRequest);
          }
          openTeamTab(effectiveTeamName, effectiveCwd || defaultProjectPath);
          closeDialog();
        } else {
          // Schedule mode: create or update
          const parsedBudget = maxBudgetUsd ? parseFloat(maxBudgetUsd) : undefined;
          const scheduleProviderBackendId =
            resolveUiOwnedProviderBackendId(
              selectedProviderId,
              runtimeProviderStatusById.get(selectedProviderId)
            ) ??
            selectedProviderBackendId ??
            undefined;
          const scheduleModel = computeEffectiveTeamModel(
            selectedModel,
            false,
            selectedProviderId,
            runtimeProviderStatusById.get(selectedProviderId)
          );
          const explicitScheduleEffort = selectedEffort
            ? (selectedEffort as EffortLevel)
            : undefined;
          const scheduleEffort =
            selectedProviderId === 'anthropic'
              ? (explicitScheduleEffort ?? anthropicRuntimeSelection?.defaultEffort ?? undefined)
              : explicitScheduleEffort;
          const launchConfig: ScheduleLaunchConfig = {
            cwd: effectiveCwd,
            prompt: promptDraft.value.trim(),
            providerId: selectedProviderId,
            providerBackendId: scheduleProviderBackendId,
            model: scheduleModel,
            effort: scheduleEffort,
            fastMode: selectedFastMode,
            resolvedFastMode: anthropicFastModeResolution?.resolvedFastMode ?? false,
            skipPermissions,
          };

          if (isEditing && schedule) {
            const patch: UpdateSchedulePatch = {
              label: schedLabel.trim() || undefined,
              cronExpression: cronExpression.trim(),
              timezone,
              warmUpMinutes,
              maxTurns,
              maxBudgetUsd: parsedBudget,
              launchConfig,
            };
            await updateSchedule(schedule.id, patch);
          } else {
            const input: CreateScheduleInput = {
              teamName: effectiveTeamName,
              label: schedLabel.trim() || undefined,
              cronExpression: cronExpression.trim(),
              timezone,
              warmUpMinutes,
              maxTurns,
              maxBudgetUsd: parsedBudget,
              launchConfig,
            };
            await createSchedule(input);
          }
          closeDialog();
        }
      } catch (err) {
        const message =
          err instanceof Error
            ? err.message
            : isSchedule
              ? '保存计划失败'
              : isRelaunch
                ? '重新启动团队失败'
                : '启动团队失败';
        setLocalError(message);
        if (isLaunchMode) {
          console.error(
            isRelaunch
              ? 'Failed to relaunch team from dialog:'
              : 'Failed to launch team from dialog:',
            err
          );
        }
      } finally {
        setIsSubmitting(false);
      }
    })();
  };

  // ---------------------------------------------------------------------------
  // Disabled state
  // ---------------------------------------------------------------------------

  const isDisabled = isLaunchMode
    ? isSubmitting ||
      launchInFlight ||
      validationErrors.length > 0 ||
      !!modelValidationError ||
      hasInvalidLaunchMemberNames ||
      hasDuplicateLaunchMemberNames ||
      teammateRuntimeCompatibility.blocksSubmission
    : isSubmitting || validationErrors.length > 0 || !!modelValidationError;

  // ---------------------------------------------------------------------------
  // Dynamic labels
  // ---------------------------------------------------------------------------

  const dialogTitle = isLaunchMode
    ? isRelaunch
      ? '重新启动团队'
      : '启动团队'
    : isEditing
      ? '编辑计划'
      : '创建计划';

  const dialogDescription = isLaunchMode ? (
    isRelaunch ? (
      <>
        停止 <span className="font-mono font-medium">{effectiveTeamName}</span> 的当前运行，并通过
        Claude CLI 重新启动。
      </>
    ) : (
      <>
        通过 Claude CLI 启动团队 <span className="font-mono font-medium">{effectiveTeamName}</span>
        。
      </>
    )
  ) : isEditing ? (
    `正在编辑团队“${effectiveTeamName}”的计划`
  ) : effectiveTeamName ? (
    `为团队“${effectiveTeamName}”创建自动运行计划`
  ) : (
    '创建团队任务自动执行计划'
  );

  const submitLabel = isLaunchMode
    ? isRelaunch
      ? '重新启动团队'
      : '启动团队'
    : isEditing
      ? '保存更改'
      : '创建计划';

  const submittingLabel = isLaunchMode
    ? isRelaunch
      ? '重新启动中...'
      : '启动中...'
    : isEditing
      ? '保存中...'
      : '创建中...';

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          closeDialog();
        }
      }}
    >
      <DialogContent
        className={isSchedule ? 'max-h-[90vh] max-w-3xl overflow-y-auto' : 'max-w-3xl'}
      >
        <DialogHeader>
          <DialogTitle className="text-sm">{dialogTitle}</DialogTitle>
          <DialogDescription className="text-xs">{dialogDescription}</DialogDescription>
        </DialogHeader>

        {isRelaunch ? (
          <div
            className="rounded-md border p-3 text-xs"
            style={{
              backgroundColor: 'var(--warning-bg)',
              borderColor: 'var(--warning-border)',
              color: 'var(--warning-text)',
            }}
          >
            <div className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              <div className="min-w-0 flex-1 space-y-1">
                <p className="font-medium">重新启动会重置当前团队运行实例</p>
                <p className="opacity-80">
                  保存这些设置后，系统会停止当前团队进程，持久化最新成员配置，并使用新的运行时重新启动团队。
                </p>
              </div>
            </div>
          </div>
        ) : null}

        {/* Launch-only: Conflict warning */}
        {isLaunchMode && conflictingTeam && !conflictDismissed ? (
          <div
            className="rounded-md border p-3 text-xs"
            style={{
              backgroundColor: 'var(--warning-bg)',
              borderColor: 'var(--warning-border)',
              color: 'var(--warning-text)',
            }}
          >
            <div className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              <div className="min-w-0 flex-1 space-y-1">
                <p className="font-medium">
                  该工作目录下已有团队“{conflictingTeam.displayName}”正在运行
                </p>
                <p className="opacity-80">
                  在同一目录同时运行两个团队存在风险，可能会修改同一批文件。建议改用不同目录或 git
                  worktree 进行隔离。
                </p>
                <p className="text-[11px] opacity-70">
                  工作目录：<span className="font-mono">{effectiveCwd}</span>
                </p>
              </div>
              <button
                type="button"
                className="shrink-0 rounded p-0.5 opacity-60 transition-colors hover:opacity-100"
                onClick={() => setConflictDismissed(true)}
              >
                <X className="size-3.5" />
              </button>
            </div>
          </div>
        ) : null}

        {isLaunchMode ? (
          <TeammateRuntimeCompatibilityNotice
            analysis={teammateRuntimeCompatibility}
            onOpenDashboard={() => {
              closeDialog();
              openDashboard();
            }}
          />
        ) : null}

        <div className="space-y-4">
          {/* ═══════════════════════════════════════════════════════════════════
              Schedule-only: Team selector (standalone mode)
              ═══════════════════════════════════════════════════════════════════ */}
          {needsTeamSelector ? (
            <div className="space-y-1.5">
              <Label className="text-xs">团队</Label>
              <Combobox
                options={teamOptions}
                value={selectedTeamName}
                onValueChange={setSelectedTeamName}
                placeholder="选择团队..."
                searchPlaceholder="搜索团队..."
                emptyMessage={
                  teamOptions.length === 0 ? '暂无可用团队，请先创建团队。' : '没有匹配的团队。'
                }
                disabled={teamOptions.length === 0}
                renderOption={(option, isSelected) => {
                  const colorName = option.meta?.color as string | undefined;
                  const colorSet = colorName
                    ? getTeamColorSet(colorName)
                    : nameColorSet(option.label);
                  return (
                    <>
                      {isSelected ? (
                        <Check className="mr-2 size-3.5 shrink-0 text-[var(--color-text)]" />
                      ) : (
                        <span
                          className="mr-2 size-3.5 shrink-0 rounded-full"
                          style={{ backgroundColor: colorSet.text }}
                        />
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          {isSelected ? (
                            <span
                              className="size-2 shrink-0 rounded-full"
                              style={{ backgroundColor: colorSet.text }}
                            />
                          ) : null}
                          <p className="truncate font-medium text-[var(--color-text)]">
                            {option.label}
                          </p>
                        </div>
                        {option.description ? (
                          <p className="truncate text-[var(--color-text-muted)]">
                            {option.description}
                          </p>
                        ) : null}
                      </div>
                    </>
                  );
                }}
              />
            </div>
          ) : null}

          {/* ═══════════════════════════════════════════════════════════════════
              Schedule-only: Schedule configuration section
              ═══════════════════════════════════════════════════════════════════ */}
          {isSchedule ? (
            <div
              className="rounded-lg border border-[var(--color-border-emphasis)] shadow-sm"
              style={{
                backgroundColor: isLight
                  ? 'color-mix(in srgb, var(--color-surface-overlay) 24%, white 76%)'
                  : 'var(--color-surface-overlay)',
              }}
            >
              <button
                type="button"
                className="flex w-full items-center gap-1.5 px-3 py-2 text-left"
                onClick={() => setSchedExpanded((v) => !v)}
              >
                {schedExpanded ? (
                  <ChevronDown className="size-3.5 shrink-0 text-[var(--color-text-muted)]" />
                ) : (
                  <ChevronRight className="size-3.5 shrink-0 text-[var(--color-text-muted)]" />
                )}
                <span className="text-[11px] font-medium uppercase tracking-wider text-[var(--color-text-muted)]">
                  定时计划
                </span>
                {!schedExpanded && (schedLabel || cronExpression) ? (
                  <span className="ml-auto truncate text-[11px] text-[var(--color-text-muted)] opacity-70">
                    {schedLabel || cronExpression}
                  </span>
                ) : null}
              </button>

              {schedExpanded ? (
                <div className="space-y-3 border-t border-[var(--color-border)] px-3 pb-3 pt-2">
                  {/* Label */}
                  <div className="space-y-1.5">
                    <Label htmlFor="schedule-label" className="label-optional">
                      标签（可选）
                    </Label>
                    <Input
                      id="schedule-label"
                      className="h-8 text-xs"
                      value={schedLabel}
                      onChange={(e) => setSchedLabel(e.target.value)}
                      placeholder="例如：每日代码评审、夜间自动测试..."
                    />
                  </div>

                  {/* Cron + Timezone + Warmup */}
                  <CronScheduleInput
                    cronExpression={cronExpression}
                    onCronExpressionChange={setCronExpression}
                    timezone={timezone}
                    onTimezoneChange={setTimezone}
                    warmUpMinutes={warmUpMinutes}
                    onWarmUpMinutesChange={setWarmUpMinutes}
                  />
                </div>
              ) : null}
            </div>
          ) : null}

          {/* ═══════════════════════════════════════════════════════════════════
              Shared: Working directory
              ═══════════════════════════════════════════════════════════════════ */}
          <ProjectPathSelector
            cwdMode={cwdMode}
            onCwdModeChange={setCwdMode}
            selectedProjectPath={selectedProjectPath}
            onSelectedProjectPathChange={setSelectedProjectPath}
            customCwd={customCwd}
            onCustomCwdChange={setCustomCwd}
            projects={projects}
            projectsLoading={projectsLoading}
            projectsError={projectsError}
          />

          {isLaunchMode ? (
            <div className="space-y-1.5">
              <Label htmlFor="launch-execution-target">运行位置</Label>
              <select
                id="launch-execution-target"
                value={selectedMachineId}
                onChange={(event) => setSelectedMachineId(event.target.value)}
                className="h-9 w-full rounded-md border px-3 text-sm"
                style={{
                  backgroundColor: 'var(--color-surface-raised)',
                  borderColor: 'var(--color-border)',
                  color: 'var(--color-text)',
                }}
              >
                <option value="local">本机</option>
                {machineProfiles.map((machine) => (
                  <option key={machine.id} value={machine.id}>
                    {machine.displayName || machine.name}（{machine.username}@{machine.host}）
                  </option>
                ))}
              </select>
              <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                MVP 先支持整支团队运行在同一台 SSH 机器。
              </p>
            </div>
          ) : null}

          {/* ═══════════════════════════════════════════════════════════════════
              Launch: optional settings
              Schedule: prompt + execution defaults
              ═══════════════════════════════════════════════════════════════════ */}
          {isLaunchMode ? (
            <OptionalSettingsSection
              title={isRelaunch ? '重新启动设置' : '可选启动设置'}
              description={
                isRelaunch
                  ? '重新启动团队前，请确认成员名单和团队负责人运行时。'
                  : '默认只需关注项目路径；需要更多控制时再展开这里。'
              }
              summary={launchOptionalSummary}
            >
              <div className="space-y-4">
                {selectedProviderId === 'anthropic' ? (
                  <div className="space-y-2">
                    <AnthropicFastModeSelector
                      value={selectedFastMode}
                      onValueChange={setSelectedFastMode}
                      providerFastModeDefault={anthropicProviderFastModeDefault}
                      model={selectedModel}
                      limitContext={effectiveAnthropicRuntimeLimitContext}
                      id="launch-fast-mode"
                    />
                    {anthropicRuntimeNotice ? (
                      <div className="bg-amber-500/8 flex items-start gap-2 rounded-md border border-amber-500/25 px-3 py-2 text-[11px] leading-relaxed text-amber-200">
                        <Info className="mt-0.5 size-3.5 shrink-0 text-amber-300" />
                        <p>{anthropicRuntimeNotice}</p>
                      </div>
                    ) : null}
                  </div>
                ) : null}
                <TeamRosterEditorSection
                  members={membersDrafts}
                  onMembersChange={setMembersDrafts}
                  validateMemberName={validateMemberNameInline}
                  showWorkflow
                  showJsonEditor
                  draftKeyPrefix={`launchTeam:${effectiveTeamName}`}
                  projectPath={effectiveCwd || null}
                  taskSuggestions={taskSuggestions}
                  teamSuggestions={teamMentionSuggestions}
                  existingMembers={members}
                  defaultProviderId={selectedProviderId}
                  inheritedProviderId={selectedProviderId}
                  inheritedModel={selectedModel}
                  inheritedEffort={(selectedEffort as EffortLevel) || undefined}
                  inheritModelSettingsByDefault
                  lockProviderModel={syncModelsWithLead}
                  forceInheritedModelSettings={syncModelsWithLead}
                  modelLockReason="该成员当前与团队负责人模型保持同步。关闭同步后可单独设置提供商、模型或推理强度。"
                  providerId={selectedProviderId}
                  model={selectedModel}
                  effort={(selectedEffort as EffortLevel) || undefined}
                  limitContext={limitContext}
                  onProviderChange={setSelectedProviderId}
                  onModelChange={setSelectedModel}
                  onEffortChange={setSelectedEffort}
                  onLimitContextChange={setLimitContext}
                  syncModelsWithTeammates={syncModelsWithLead}
                  onSyncModelsWithTeammatesChange={setSyncModelsWithLead}
                  showWorktreeIsolationControls
                  teammateWorktreeDefault={teammateWorktreeDefault}
                  onTeammateWorktreeDefaultChange={setTeammateWorktreeDefault}
                  leadWarningText={leadRuntimeWarningText}
                  memberWarningById={combinedMemberRuntimeWarningById}
                  leadModelIssueText={leadModelIssueText}
                  memberModelIssueById={memberModelIssueById}
                  softDeleteMembers
                  disableGeminiOption={true}
                />

                <div className="space-y-1.5">
                  <Label htmlFor="dialog-prompt" className="label-optional">
                    给团队负责人的提示（可选）
                  </Label>
                  <MentionableTextarea
                    id="dialog-prompt"
                    className="min-h-[100px] text-xs"
                    minRows={4}
                    maxRows={12}
                    value={promptDraft.value}
                    onValueChange={promptDraft.setValue}
                    suggestions={mentionSuggestions}
                    projectPath={effectiveCwd || null}
                    chips={chipDraft.chips}
                    onChipRemove={chipDraft.removeChip}
                    onFileChipInsert={chipDraft.addChip}
                    placeholder="填写给团队负责人的说明..."
                    footerRight={
                      promptDraft.isSaved ? (
                        <span className="text-[10px] text-[var(--color-text-muted)]">已保存</span>
                      ) : null
                    }
                  />
                </div>

                <div>
                  <SkipPermissionsCheckbox
                    id="dialog-skip-permissions"
                    checked={skipPermissions}
                    onCheckedChange={setSkipPermissions}
                  />
                </div>

                <div className="space-y-2">
                  {providerChangeForcesFreshLeadContext ? (
                    <div
                      className="rounded-md border px-3 py-2 text-xs"
                      style={{
                        backgroundColor: 'var(--warning-bg)',
                        borderColor: 'var(--warning-border)',
                        color: 'var(--warning-text)',
                      }}
                    >
                      <div className="flex items-start gap-2">
                        <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                        <p>
                          提供商已从 {getProviderLabel(previousProviderId!)} 更改为{' '}
                          {getProviderLabel(selectedProviderId)}
                          。之前的负责人会话不会恢复，负责人会以全新上下文启动，以正确应用新的运行时。
                        </p>
                      </div>
                    </div>
                  ) : null}
                  <div className="flex items-center gap-2">
                    <Checkbox
                      id="clear-context"
                      checked={clearContext}
                      onCheckedChange={(checked) => setClearContext(checked === true)}
                    />
                    <Label
                      htmlFor="clear-context"
                      className="flex cursor-pointer items-center gap-1.5 text-xs font-normal text-text-secondary"
                    >
                      <RotateCcw className="size-3 shrink-0" />
                      清空上下文（新会话）
                    </Label>
                  </div>
                  {clearContext && (
                    <div
                      className="rounded-md border px-3 py-2 text-xs"
                      style={{
                        backgroundColor: 'var(--warning-bg)',
                        borderColor: 'var(--warning-border)',
                        color: 'var(--warning-text)',
                      }}
                    >
                      <div className="flex items-start gap-2">
                        <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                        <p>
                          团队负责人会启动一个新会话，不再恢复之前的上下文。已积累的会话记忆和对话历史将不可用。
                        </p>
                      </div>
                    </div>
                  )}
                </div>

                <AdvancedCliSection
                  teamName={effectiveTeamName}
                  internalArgs={internalArgs}
                  worktreeEnabled={worktreeEnabled}
                  onWorktreeEnabledChange={setWorktreeEnabled}
                  worktreeName={worktreeName}
                  onWorktreeNameChange={setWorktreeName}
                  customArgs={customArgs}
                  onCustomArgsChange={setCustomArgs}
                />
              </div>
            </OptionalSettingsSection>
          ) : (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="dialog-prompt">提示词</Label>
                <MentionableTextarea
                  id="dialog-prompt"
                  className="min-h-[100px] text-xs"
                  minRows={4}
                  maxRows={12}
                  value={promptDraft.value}
                  onValueChange={promptDraft.setValue}
                  suggestions={mentionSuggestions}
                  projectPath={effectiveCwd || null}
                  chips={chipDraft.chips}
                  onChipRemove={chipDraft.removeChip}
                  onFileChipInsert={chipDraft.addChip}
                  placeholder="填写定时执行时给 Claude 的说明..."
                  footerRight={
                    promptDraft.isSaved ? (
                      <span className="text-[10px] text-[var(--color-text-muted)]">已保存</span>
                    ) : null
                  }
                />
                <p className="text-[11px] text-[var(--color-text-muted)]">
                  该提示词会传递给 <code className="font-mono">claude -p</code> 用于 one-shot
                  execution
                </p>
              </div>

              <div>
                <TeamModelSelector
                  providerId={selectedProviderId}
                  onProviderChange={setSelectedProviderId}
                  value={selectedModel}
                  onValueChange={setSelectedModel}
                  id="dialog-model"
                  disableGeminiOption={true}
                />
                <EffortLevelSelector
                  value={selectedEffort}
                  onValueChange={setSelectedEffort}
                  id="dialog-effort"
                  providerId={selectedProviderId}
                  model={selectedModel}
                  limitContext={false}
                />
                {selectedProviderId === 'anthropic' ? (
                  <div className="mt-2">
                    <AnthropicFastModeSelector
                      value={selectedFastMode}
                      onValueChange={setSelectedFastMode}
                      providerFastModeDefault={anthropicProviderFastModeDefault}
                      model={selectedModel}
                      limitContext={false}
                      id="dialog-fast-mode"
                    />
                    {anthropicRuntimeNotice ? (
                      <div className="bg-amber-500/8 mt-2 rounded-md border border-amber-500/25 px-3 py-2 text-[11px] leading-relaxed text-amber-200">
                        {anthropicRuntimeNotice}
                      </div>
                    ) : null}
                  </div>
                ) : null}
                <SkipPermissionsCheckbox
                  id="dialog-skip-permissions"
                  checked={skipPermissions}
                  onCheckedChange={setSkipPermissions}
                />
              </div>
            </>
          )}

          {/* ═══════════════════════════════════════════════════════════════════
              Schedule-only: Execution limits
              ═══════════════════════════════════════════════════════════════════ */}
          {isSchedule ? (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label
                  htmlFor="schedule-max-turns"
                  className="text-[11px] text-[var(--color-text-muted)]"
                >
                  Max turns
                </Label>
                <Input
                  id="schedule-max-turns"
                  type="number"
                  min={1}
                  max={500}
                  className="h-8 text-xs"
                  value={maxTurns}
                  onChange={(e) => setMaxTurns(Math.max(1, parseInt(e.target.value) || 50))}
                />
              </div>

              <div className="space-y-1">
                <Label
                  htmlFor="schedule-max-budget"
                  className="text-[11px] text-[var(--color-text-muted)]"
                >
                  Max budget (USD)
                </Label>
                <Input
                  id="schedule-max-budget"
                  type="number"
                  min={0}
                  step={0.5}
                  className="h-8 text-xs"
                  value={maxBudgetUsd}
                  onChange={(e) => setMaxBudgetUsd(e.target.value)}
                  placeholder="不限"
                />
              </div>
            </div>
          ) : null}
        </div>

        {/* Error display */}
        {activeError ? (
          <div className="flex items-start gap-2 rounded border border-red-500/40 bg-red-500/10 p-2 text-xs text-red-300">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
            <span>{activeError}</span>
          </div>
        ) : null}

        <DialogFooter className={isLaunchMode ? 'pt-4 sm:justify-between' : 'pt-4'}>
          {/* Launch-only: CLI warm-up status */}
          {isLaunchMode ? (
            <div className="min-w-0">
              {effectivePrepare.state === 'idle' || effectivePrepare.state === 'loading' ? (
                <>
                  <div className="flex items-center gap-2 text-xs text-[var(--color-text-muted)]">
                    <span className="inline-block size-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
                    <div>
                      <span>
                        {effectivePrepare.message ??
                          (effectivePrepare.state === 'idle'
                            ? '正在预热 CLI 环境...'
                            : '正在准备环境...')}
                      </span>
                      <p className="mt-0.5 flex items-center gap-1.5 text-[10px] text-[var(--color-text-muted)] opacity-70">
                        <span>启动前检查会提前发现{isRelaunch ? '重新启动' : '启动'}问题</span>
                      </p>
                    </div>
                  </div>
                  <ProvisioningProviderStatusList checks={prepareChecks} className="mt-2" />
                </>
              ) : null}

              {effectivePrepare.state === 'ready' ? (
                <div>
                  <div className="flex items-center gap-1.5 text-xs font-medium text-emerald-400">
                    <CheckCircle2 className="size-3.5 shrink-0" />
                    <span>
                      {prepareChecks.some((check) => check.status === 'notes') ||
                      prepareWarnings.length > 0
                        ? 'CLI 环境已就绪（有提示）'
                        : 'CLI 环境已就绪'}
                    </span>
                  </div>
                  {effectivePrepare.message ? (
                    <p className="mt-0.5 pl-5 text-[11px] text-[var(--color-text-muted)]">
                      {effectivePrepare.message}
                    </p>
                  ) : null}
                  <ProvisioningProviderStatusList checks={prepareChecks} className="mt-1" />
                  {prepareWarnings.length > 0 && prepareChecks.length === 0 ? (
                    <div className="mt-0.5 space-y-0.5 pl-5">
                      {prepareWarnings.map((warning) => (
                        <p key={warning} className="text-[11px] text-sky-300">
                          {warning}
                        </p>
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : null}

              {effectivePrepare.state === 'failed' ? (
                <div className="text-xs">
                  <div className="flex items-start gap-2 text-red-300">
                    <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                    <div className="min-w-0">
                      <p className="font-medium">
                        CLI 环境不可用，已阻止{isRelaunch ? '重新启动' : '启动'}
                      </p>
                      <p className="mt-0.5 text-red-300/80">
                        {effectivePrepare.message ?? '准备环境失败'}
                      </p>
                      <p className="mt-0.5 text-[10px] text-[var(--color-text-muted)] opacity-70">
                        启动前检查会提前发现{isRelaunch ? '重新启动' : '启动'}问题
                      </p>
                    </div>
                  </div>
                  {!shouldHideProvisioningProviderStatusList(
                    prepareChecks,
                    effectivePrepare.message
                  ) ? (
                    <ProvisioningProviderStatusList
                      checks={prepareChecks}
                      className="mt-2"
                      suppressDetailsMatching={effectivePrepare.message}
                    />
                  ) : null}
                  {prepareWarnings.length > 0 && prepareChecks.length === 0 ? (
                    <div className="mt-1 space-y-0.5 pl-6">
                      {prepareWarnings.map((warning) => (
                        <p
                          key={warning}
                          className="text-[11px]"
                          style={{ color: 'var(--warning-text)' }}
                        >
                          {warning}
                        </p>
                      ))}
                    </div>
                  ) : null}
                  <div className="mt-1 flex items-center gap-2 pl-6">
                    <p className="text-[11px] text-[var(--color-text-muted)]">
                      {getProvisioningFailureHint(effectivePrepare.message, prepareChecks)}
                    </p>
                    {(effectivePrepare.message ?? '').toLowerCase().includes('spawn ') ||
                    prepareChecks.some((check) =>
                      check.details.some((detail) => detail.toLowerCase().includes('spawn '))
                    ) ? (
                      <button
                        type="button"
                        className="shrink-0 rounded bg-blue-600 px-2 py-0.5 text-[11px] font-medium text-white transition-colors hover:bg-blue-500"
                        onClick={() => {
                          closeDialog();
                          openDashboard();
                        }}
                      >
                        前往首页
                      </button>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}

          <div className="flex shrink-0 items-center gap-2">
            <Button variant="outline" size="sm" onClick={closeDialog}>
              {isLaunchMode ? '关闭' : '取消'}
            </Button>
            <Button
              size="sm"
              className="bg-emerald-600 text-white hover:bg-emerald-700"
              disabled={isDisabled}
              onClick={handleSubmit}
            >
              {isSubmitting || launchInFlight ? (
                <>
                  <Loader2 className="mr-1.5 size-3.5 animate-spin" />
                  {submittingLabel}
                </>
              ) : (
                submitLabel
              )}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
