import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { api } from '@renderer/api';
import { AttachmentPreviewList } from '@renderer/components/team/attachments/AttachmentPreviewList';
import { DropZoneOverlay } from '@renderer/components/team/attachments/DropZoneOverlay';
import { MemberBadge } from '@renderer/components/team/MemberBadge';
import { OpenCodeDeliveryWarning } from '@renderer/components/team/messages/OpenCodeDeliveryWarning';
import { MentionableTextarea } from '@renderer/components/ui/MentionableTextarea';
import { Popover, PopoverContent, PopoverTrigger } from '@renderer/components/ui/popover';
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/components/ui/tooltip';
import { getTeamColorSet } from '@renderer/constants/teamColors';
import { useComposerDraft } from '@renderer/hooks/useComposerDraft';
import { useTaskSuggestions } from '@renderer/hooks/useTaskSuggestions';
import { useTeamSuggestions } from '@renderer/hooks/useTeamSuggestions';
import { cn } from '@renderer/lib/utils';
import { useStore } from '@renderer/store';
import { isTeamProvisioningActive } from '@renderer/store/slices/teamSlice';
import { serializeChipsWithText } from '@renderer/types/inlineChip';
import { formatAgentRole } from '@renderer/utils/formatAgentRole';
import { buildMemberColorMap } from '@renderer/utils/memberHelpers';
import { nameColorSet } from '@renderer/utils/projectColor';
import { getSuggestedSlashCommandsForProvider } from '@renderer/utils/providerSlashCommands';
import { buildSlashCommandSuggestions } from '@renderer/utils/skillCommandSuggestions';
import {
  extractTaskRefsFromText,
  stripEncodedTaskReferenceMetadata,
} from '@renderer/utils/taskReferenceUtils';
import { MAX_TEXT_LENGTH } from '@shared/constants';
import { CANONICAL_LEAD_MEMBER_NAME, isLeadMember } from '@shared/utils/leadDetection';
import { parseStandaloneSlashCommand } from '@shared/utils/slashCommands';
import {
  inferTeamProviderIdFromModel,
  normalizeOptionalTeamProviderId,
} from '@shared/utils/teamProvider';
import { AlertCircle, Check, ChevronDown, Mic, Paperclip, Search, Send } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';

import type { MentionSuggestion } from '@renderer/types/mention';
import type { OpenCodeRuntimeDeliveryDebugDetails } from '@renderer/utils/openCodeRuntimeDeliveryDiagnostics';
import type {
  AgentActionMode,
  AttachmentPayload,
  ResolvedTeamMember,
  SendMessageResult,
  TaskRef,
} from '@shared/types';

interface MessageComposerProps {
  teamName: string;
  members: ResolvedTeamMember[];
  layout?: 'default' | 'compact';
  isTeamAlive?: boolean;
  sending: boolean;
  sendError: string | null;
  sendWarning?: string | null;
  sendDebugDetails?: OpenCodeRuntimeDeliveryDebugDetails | null;
  lastResult?: SendMessageResult | null;
  /** Ref to the underlying textarea element for external focus management. */
  textareaRef?: React.Ref<HTMLTextAreaElement>;
  onSend: (
    recipient: string,
    text: string,
    summary?: string,
    attachments?: AttachmentPayload[],
    actionMode?: AgentActionMode,
    taskRefs?: TaskRef[]
  ) => void;
  onCrossTeamSend?: (
    toTeam: string,
    text: string,
    summary?: string,
    actionMode?: AgentActionMode,
    taskRefs?: TaskRef[]
  ) => void;
}

export const MessageComposer = ({
  teamName,
  members,
  layout = 'default',
  isTeamAlive,
  sending,
  sendError,
  sendWarning,
  sendDebugDetails,
  lastResult,
  textareaRef: externalTextareaRef,
  onSend,
  onCrossTeamSend,
}: MessageComposerProps): React.JSX.Element => {
  const internalTextareaRef = useRef<HTMLTextAreaElement>(null);
  const textareaRef = useMemo(() => {
    // Merge internal and external refs into a single callback ref
    return (node: HTMLTextAreaElement | null) => {
      (internalTextareaRef as React.MutableRefObject<HTMLTextAreaElement | null>).current = node;
      if (typeof externalTextareaRef === 'function') {
        externalTextareaRef(node);
      } else if (externalTextareaRef) {
        (externalTextareaRef as React.MutableRefObject<HTMLTextAreaElement | null>).current = node;
      }
    };
  }, [externalTextareaRef]);
  const [recipient, setRecipient] = useState<string>(() => {
    const lead = members.find((m) => isLeadMember(m));
    return lead?.name ?? members[0]?.name ?? '';
  });
  const [recipientOpen, setRecipientOpen] = useState(false);
  const [recipientSearch, setRecipientSearch] = useState('');
  const recipientSearchRef = useRef<HTMLInputElement>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const dragCounterRef = useRef(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [fileRestrictionError, setFileRestrictionError] = useState<string | null>(null);
  const fileRestrictionTimerRef = useRef(0);
  const dismissMentionsRef = useRef<(() => void) | null>(null);

  // Cross-team state
  const [selectedTeam, setSelectedTeam] = useState<string | null>(null);
  const [teamSelectorOpen, setTeamSelectorOpen] = useState(false);
  const [aliveTeams, setAliveTeams] = useState<Set<string>>(new Set());
  const allCrossTeamTargets = useStore(useShallow((s) => s.crossTeamTargets));
  const fetchCrossTeamTargets = useStore((s) => s.fetchCrossTeamTargets);

  useEffect(() => {
    void fetchCrossTeamTargets();
  }, [fetchCrossTeamTargets]);

  const refreshAliveTeams = useCallback(async () => {
    try {
      const list = await api.teams.aliveList();
      setAliveTeams(new Set(list));
    } catch {
      // best-effort
    }
  }, []);

  useEffect(() => {
    void refreshAliveTeams();
  }, [refreshAliveTeams]);

  useEffect(() => {
    if (!teamSelectorOpen) return;
    void refreshAliveTeams();
  }, [teamSelectorOpen, refreshAliveTeams]);

  // Always filter out current team on the UI side (store is global, shared across tabs)
  const crossTeamTargets = useMemo(
    () => allCrossTeamTargets.filter((t) => t.teamName !== teamName),
    [allCrossTeamTargets, teamName]
  );
  const sortedCrossTeamTargets = useMemo(
    () =>
      crossTeamTargets
        .map((target) => ({
          ...target,
          isOnline: aliveTeams.has(target.teamName),
        }))
        .sort((a, b) => {
          if (a.isOnline && !b.isOnline) return -1;
          if (!a.isOnline && b.isOnline) return 1;
          return (a.displayName || a.teamName).localeCompare(
            b.displayName || b.teamName,
            undefined,
            {
              sensitivity: 'base',
            }
          );
        }),
    [aliveTeams, crossTeamTargets]
  );
  const hasCrossTeamOptions = sortedCrossTeamTargets.length > 0;

  const isCrossTeam = selectedTeam !== null;
  const selectedTarget = sortedCrossTeamTargets.find((t) => t.teamName === selectedTeam);
  const targetDisplayName = selectedTarget?.displayName ?? selectedTeam;
  const crossTeamHintText = isCrossTeam
    ? 'Tips：跨团队消息会发送到目标团队负责人。如果你希望回复发回你当前团队负责人而不是你本人，请在消息中明确说明。'
    : undefined;

  // Members load async with team data; keep recipient stable if valid, otherwise default to lead/first.
  useEffect(() => {
    if (recipient && members.some((m) => m.name === recipient)) {
      return;
    }
    const lead = members.find((m) => isLeadMember(m));
    const next = lead?.name ?? members[0]?.name ?? '';
    if (next && next !== recipient) {
      queueMicrotask(() => setRecipient(next));
    }
  }, [members, recipient]);

  const projectPath = useStore((s) =>
    s.selectedTeamName === teamName ? (s.selectedTeamData?.config.projectPath ?? null) : null
  );
  const currentTeamColor = useStore((s) => {
    if (s.selectedTeamName !== teamName) {
      return nameColorSet(teamName).border;
    }
    const configColor = s.selectedTeamData?.config.color;
    if (configColor) return getTeamColorSet(configColor).border;
    const displayName = s.selectedTeamData?.config.name ?? teamName;
    return nameColorSet(displayName).border;
  });
  const isProvisioning = useStore((s) => isTeamProvisioningActive(s, teamName));
  const draft = useComposerDraft(teamName);

  const colorMap = useMemo(() => buildMemberColorMap(members), [members]);

  const mentionSuggestions = useMemo<MentionSuggestion[]>(
    () =>
      members.map((m) => ({
        id: m.name,
        name: m.name,
        subtitle: formatAgentRole(m.role) ?? formatAgentRole(m.agentType) ?? undefined,
        color: colorMap.get(m.name),
      })),
    [members, colorMap]
  );
  const leadProviderId = useMemo(() => {
    const lead = members.find((member) => isLeadMember(member));
    return (
      normalizeOptionalTeamProviderId(lead?.providerId) ?? inferTeamProviderIdFromModel(lead?.model)
    );
  }, [members]);

  const { suggestions: teamMentionSuggestions } = useTeamSuggestions(teamName);
  const { suggestions: taskSuggestions } = useTaskSuggestions(teamName);
  // Project skills as slash command suggestions
  const projectSkills = useStore(
    useShallow((s) => (projectPath ? (s.skillsProjectCatalogByProjectPath[projectPath] ?? []) : []))
  );
  const userSkills = useStore(useShallow((s) => s.skillsUserCatalog));
  const fetchSkillsCatalog = useStore((s) => s.fetchSkillsCatalog);

  // Fetch skills catalog for the team's project on mount / project change
  useEffect(() => {
    void fetchSkillsCatalog(projectPath ?? undefined);
  }, [fetchSkillsCatalog, projectPath]);

  const slashCommandSuggestions = useMemo<MentionSuggestion[]>(
    () =>
      buildSlashCommandSuggestions(
        getSuggestedSlashCommandsForProvider(leadProviderId),
        projectSkills,
        userSkills,
        leadProviderId
      ),
    [leadProviderId, projectSkills, userSkills]
  );

  const trimmed = stripEncodedTaskReferenceMetadata(draft.text).trim();
  const standaloneSlashCommand = useMemo(() => parseStandaloneSlashCommand(trimmed), [trimmed]);

  const selectedMember = members.find((m) => m.name === recipient);
  const selectedResolvedColor = selectedMember ? colorMap.get(selectedMember.name) : undefined;
  const isLeadRecipient = selectedMember ? isLeadMember(selectedMember) : false;
  // NOTE: lead context ring disabled — usage formula is inaccurate
  // const isLeadAgentRecipient = selectedMember?.agentType === 'lead';
  // const leadContext = useStore((s) =>
  //   isLeadAgentRecipient ? s.leadContextByTeam[teamName] : undefined
  // );
  const supportsAttachments = isLeadRecipient && !isCrossTeam && !!isTeamAlive;
  const canAttach = supportsAttachments && draft.canAddMore;
  const attachmentRestrictionReason = !supportsAttachments
    ? isCrossTeam
      ? '跨团队消息暂不支持文件附件'
      : !isLeadRecipient
        ? '文件只能发送给团队负责人'
        : '团队在线时才能添加文件'
    : undefined;
  const attachmentsBlocked = draft.attachments.length > 0 && !supportsAttachments;
  const slashCommandRestrictionReason = standaloneSlashCommand
    ? draft.attachments.length > 0
      ? '斜杠命令需要团队负责人在线，且不能与附件同时发送'
      : isCrossTeam
        ? '斜杠命令只能在当前团队负责人上执行'
        : !isLeadRecipient
          ? '斜杠命令只能发送给团队负责人'
          : !isTeamAlive
            ? '斜杠命令需要团队负责人在线'
            : null
    : null;
  const canSend =
    recipient.length > 0 &&
    trimmed.length > 0 &&
    trimmed.length <= MAX_TEXT_LENGTH &&
    !sending &&
    !isProvisioning &&
    !attachmentsBlocked &&
    !slashCommandRestrictionReason &&
    (!isCrossTeam || onCrossTeamSend !== undefined);

  // Track whether we initiated a send — clear draft only on confirmed success
  const pendingSendRef = useRef(false);

  const handleSend = useCallback(() => {
    if (!canSend) return;
    dismissMentionsRef.current?.();
    pendingSendRef.current = true;
    const taskRefs = extractTaskRefsFromText(draft.text, taskSuggestions);
    const serialized = serializeChipsWithText(trimmed, draft.chips);
    if (isCrossTeam && selectedTeam && onCrossTeamSend) {
      onCrossTeamSend(selectedTeam, serialized, trimmed, undefined, taskRefs);
    } else {
      // Summary should stay compact (no expanded chip markdown)
      onSend(
        recipient,
        serialized,
        trimmed,
        draft.attachments.length > 0 ? draft.attachments : undefined,
        undefined,
        taskRefs
      );
    }
  }, [
    canSend,
    recipient,
    trimmed,
    onSend,
    onCrossTeamSend,
    isCrossTeam,
    selectedTeam,
    draft.attachments,
    draft.chips,
    taskSuggestions,
  ]);

  // Clear draft only after send completes successfully (sending: true → false, no error)
  useEffect(() => {
    if (!sending && pendingSendRef.current) {
      pendingSendRef.current = false;
      if (!sendError && sendDebugDetails?.delivered !== false) {
        draft.clearDraft();
      }
    }
  }, [sending, sendError, sendDebugDetails, draft]);

  const { addFiles: draftAddFiles } = draft;
  const handleFileInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const input = e.target;
      if (input.files?.length) {
        void draftAddFiles(input.files);
      }
      input.value = '';
    },
    [draftAddFiles]
  );

  const showFileRestrictionError = useCallback(() => {
    setFileRestrictionError(
      attachmentRestrictionReason ?? 'Files can only be sent to the team lead'
    );
    window.clearTimeout(fileRestrictionTimerRef.current);
    fileRestrictionTimerRef.current = window.setTimeout(() => {
      setFileRestrictionError(null);
    }, 4000);
  }, [attachmentRestrictionReason]);

  // Cleanup restriction error timer on unmount
  useEffect(() => {
    const ref = fileRestrictionTimerRef;
    return () => window.clearTimeout(ref.current);
  }, []);

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    dragCounterRef.current += 1;
    if (dragCounterRef.current === 1) setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    dragCounterRef.current -= 1;
    if (dragCounterRef.current <= 0) {
      dragCounterRef.current = 0;
      setIsDragOver(false);
    }
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
  }, []);

  const { handleDrop: draftHandleDrop } = draft;
  const handleDropWrapper = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      dragCounterRef.current = 0;
      setIsDragOver(false);
      if (!supportsAttachments) {
        const files = e.dataTransfer?.files;
        if (files?.length) {
          showFileRestrictionError();
        }
        return;
      }
      draftHandleDrop(e);
    },
    [supportsAttachments, draftHandleDrop, showFileRestrictionError]
  );

  const { handlePaste: draftHandlePaste } = draft;
  const handlePasteWrapper = useCallback(
    (e: React.ClipboardEvent) => {
      if (!supportsAttachments) {
        const hasFiles = Array.from(e.clipboardData.items).some((item) => item.kind === 'file');
        if (hasFiles) {
          e.preventDefault();
          showFileRestrictionError();
        }
        return;
      }
      draftHandlePaste(e);
    },
    [supportsAttachments, draftHandlePaste, showFileRestrictionError]
  );

  const remaining = MAX_TEXT_LENGTH - trimmed.length;
  const hasAttachmentPreviewContent =
    draft.attachments.length > 0 || Boolean(draft.attachmentError ?? fileRestrictionError);
  const shouldDockRecipientSelector = !hasAttachmentPreviewContent;
  const isCompactLayout = layout === 'compact';
  const compactFooterNotice = slashCommandRestrictionReason ? (
    <span className="inline-flex items-center gap-1 rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-300">
      <AlertCircle size={10} className="shrink-0" />
      {slashCommandRestrictionReason}
    </span>
  ) : sendError ? (
    <span className="inline-flex items-center gap-1 rounded bg-red-500/10 px-1.5 py-0.5 text-[10px] text-red-400">
      <AlertCircle size={10} className="shrink-0" />
      {sendError}
    </span>
  ) : sendWarning ? (
    <OpenCodeDeliveryWarning warning={sendWarning} debugDetails={sendDebugDetails} />
  ) : lastResult?.deduplicated ? (
    <span className="inline-flex items-center gap-1 rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-300">
      <Check size={10} className="shrink-0" />
      已复用最近一次跨团队请求
    </span>
  ) : null;

  return (
    <div
      className={cn('relative', isCompactLayout ? 'pb-1' : 'mb-1.5 pb-1.5')}
      role="group"
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDropWrapper}
      onPaste={handlePasteWrapper}
    >
      <div
        className={cn(
          shouldDockRecipientSelector ? 'mb-0' : 'mb-1',
          isCompactLayout ? 'space-y-1.5' : 'space-y-2'
        )}
      >
        <div className="flex items-center gap-2">
          {isLeadRecipient ? (
            <>
              <input
                ref={fileInputRef}
                type="file"
                accept="*/*"
                multiple
                className="hidden"
                onChange={handleFileInputChange}
              />
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    className={cn(
                      'inline-flex shrink-0 items-center gap-1 rounded p-1 transition-colors',
                      canAttach
                        ? 'text-[var(--color-text-secondary)] hover:text-[var(--color-text)]'
                        : 'text-[var(--color-text-muted)] opacity-40'
                    )}
                    disabled={!canAttach}
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <Paperclip size={14} />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="top">
                  {!isTeamAlive
                    ? '团队在线时才能添加文件'
                    : !draft.canAddMore
                      ? '已达到附件上限'
                      : '添加文件（支持粘贴或拖拽）'}
                </TooltipContent>
              </Tooltip>
            </>
          ) : null}

          <div className="ml-auto flex shrink-0 items-center gap-2">
            {!isTeamAlive && !isProvisioning && (
              <span className="text-[10px]" style={{ color: 'var(--warning-text)' }}>
                团队离线
              </span>
            )}

            {/* Combined team + member selector */}
            <div
              className={cn(
                'mr-[15px] inline-flex items-center border text-xs transition-colors',
                shouldDockRecipientSelector
                  ? 'relative z-10 -mb-px overflow-hidden rounded-b-none rounded-t-[1.35rem] border-b-0 bg-[var(--color-surface-raised)]'
                  : 'rounded-full',
                isCrossTeam ? 'border-[var(--cross-team-border)]' : 'border-[var(--color-border)]'
              )}
            >
              <Popover open={teamSelectorOpen} onOpenChange={setTeamSelectorOpen}>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    className={cn(
                      'inline-flex items-center gap-1.5 border-r border-r-[var(--color-border)] px-2.5 py-1 text-xs transition-colors',
                      shouldDockRecipientSelector
                        ? 'rounded-bl-none rounded-tl-[1.35rem]'
                        : 'rounded-l-full',
                      isCrossTeam
                        ? 'hover:bg-[var(--cross-team-bg)]/80 bg-[var(--cross-team-bg)] text-purple-400'
                        : 'hover:bg-[var(--color-surface-raised)]'
                    )}
                  >
                    {isCrossTeam ? (
                      <>
                        <span
                          className={cn(
                            'inline-block size-2 shrink-0 rounded-full',
                            selectedTarget?.isOnline && 'animate-pulse'
                          )}
                          style={{
                            backgroundColor: selectedTarget?.isOnline
                              ? '#22c55e'
                              : selectedTarget
                                ? selectedTarget.color
                                  ? getTeamColorSet(selectedTarget.color).border
                                  : nameColorSet(selectedTarget.displayName).border
                                : undefined,
                          }}
                        />
                        <span className="max-w-[100px] truncate">{targetDisplayName}</span>
                      </>
                    ) : (
                      <>
                        {currentTeamColor ? (
                          <span
                            className="inline-block size-2 shrink-0 rounded-full"
                            style={{ backgroundColor: currentTeamColor }}
                          />
                        ) : null}
                        <span className="text-[var(--color-text-secondary)]">当前团队</span>
                      </>
                    )}
                    <ChevronDown size={12} className="shrink-0 text-[var(--color-text-muted)]" />
                  </button>
                </PopoverTrigger>
                <PopoverContent align="end" className="w-56 p-1.5">
                  <div className="max-h-48 space-y-0.5 overflow-y-auto">
                    {/* Current team option */}
                    <button
                      type="button"
                      className={cn(
                        'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors hover:bg-[var(--color-surface-raised)]',
                        !isCrossTeam && 'bg-[var(--color-surface-raised)]'
                      )}
                      onClick={() => {
                        setSelectedTeam(null);
                        setTeamSelectorOpen(false);
                      }}
                    >
                      {currentTeamColor ? (
                        <span
                          className="inline-block size-2 shrink-0 rounded-full"
                          style={{ backgroundColor: currentTeamColor }}
                        />
                      ) : null}
                      <span className="truncate text-[var(--color-text)]">当前团队</span>
                      <span className="shrink-0 text-[10px] text-[var(--color-text-muted)]">
                        当前
                      </span>
                      {!isCrossTeam ? (
                        <Check size={12} className="ml-auto shrink-0 text-blue-400" />
                      ) : null}
                    </button>

                    {hasCrossTeamOptions ? (
                      <>
                        <div className="my-1 h-px bg-[var(--color-border)]" />

                        {sortedCrossTeamTargets.map((target) => {
                          const isSelected = selectedTeam === target.teamName;
                          return (
                            <button
                              key={target.teamName}
                              type="button"
                              className={cn(
                                'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors hover:bg-[var(--color-surface-raised)]',
                                isSelected && 'bg-[var(--cross-team-bg)]'
                              )}
                              onClick={() => {
                                setSelectedTeam(target.teamName);
                                setRecipient(CANONICAL_LEAD_MEMBER_NAME);
                                setTeamSelectorOpen(false);
                              }}
                            >
                              <span
                                className={cn(
                                  'inline-block size-2 shrink-0 rounded-full',
                                  target.isOnline && 'animate-pulse'
                                )}
                                style={{
                                  backgroundColor: target.isOnline
                                    ? '#22c55e'
                                    : target.color
                                      ? getTeamColorSet(target.color).border
                                      : nameColorSet(target.displayName).border,
                                }}
                                title={target.isOnline ? '在线' : '离线'}
                              />
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-1.5">
                                  <div className="truncate text-[var(--color-text)]">
                                    {target.displayName}
                                  </div>
                                  <span
                                    className={cn(
                                      'shrink-0 text-[10px]',
                                      target.isOnline
                                        ? 'text-green-400'
                                        : 'text-[var(--color-text-muted)]'
                                    )}
                                  >
                                    {target.isOnline ? '在线' : '离线'}
                                  </span>
                                </div>
                                {target.description ? (
                                  <div className="truncate text-[10px] text-[var(--color-text-muted)]">
                                    {target.description}
                                  </div>
                                ) : null}
                              </div>
                              {isSelected ? (
                                <Check size={12} className="ml-auto shrink-0 text-purple-400" />
                              ) : null}
                            </button>
                          );
                        })}
                      </>
                    ) : null}
                  </div>
                </PopoverContent>
              </Popover>

              <Popover
                open={isCrossTeam ? false : recipientOpen}
                onOpenChange={isCrossTeam ? undefined : setRecipientOpen}
              >
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    className={cn(
                      'inline-flex items-center gap-1.5 px-2.5 py-1 text-xs transition-colors',
                      shouldDockRecipientSelector
                        ? 'rounded-br-none rounded-tr-[1.35rem]'
                        : 'rounded-r-full',
                      isCrossTeam
                        ? 'cursor-default bg-[var(--cross-team-bg)] opacity-60'
                        : 'hover:bg-[var(--color-surface-raised)]'
                    )}
                    disabled={isCrossTeam}
                  >
                    {recipient ? (
                      <MemberBadge
                        name={recipient}
                        color={selectedResolvedColor}
                        size="sm"
                        hideAvatar={recipient === 'user'}
                        disableHoverCard
                      />
                    ) : (
                      <span className="text-[var(--color-text-muted)]">选择...</span>
                    )}
                    <ChevronDown size={12} className="shrink-0 text-[var(--color-text-muted)]" />
                  </button>
                </PopoverTrigger>
                <PopoverContent
                  align="end"
                  className="w-56 p-1.5"
                  onOpenAutoFocus={(e) => {
                    e.preventDefault();
                    setRecipientSearch('');
                    setTimeout(() => recipientSearchRef.current?.focus(), 0);
                  }}
                >
                  {members.length > 5 && (
                    <div className="relative mb-1">
                      <Search
                        size={12}
                        className="absolute left-2 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]"
                      />
                      <input
                        ref={recipientSearchRef}
                        type="text"
                        className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] py-1 pl-6 pr-2 text-xs text-[var(--color-text)] placeholder:text-[var(--color-text-muted)] focus:border-[var(--color-border-emphasis)] focus:outline-none"
                        placeholder="搜索..."
                        value={recipientSearch}
                        onChange={(e) => setRecipientSearch(e.target.value)}
                      />
                    </div>
                  )}
                  <div className="max-h-48 space-y-0.5 overflow-y-auto">
                    {/* eslint-disable-next-line sonarjs/function-return-type -- IIFE rendering mixed elements/null */}
                    {(() => {
                      const query = recipientSearch.toLowerCase().trim();
                      const filtered = query
                        ? members.filter((m) => m.name.toLowerCase().includes(query))
                        : members;
                      if (filtered.length === 0) {
                        return (
                          <div className="px-2 py-3 text-center text-xs text-[var(--color-text-muted)]">
                            无匹配结果
                          </div>
                        );
                      }
                      const sorted = [...filtered].sort((a, b) => {
                        const aIsLead = isLeadMember(a) ? 1 : 0;
                        const bIsLead = isLeadMember(b) ? 1 : 0;
                        return bIsLead - aIsLead;
                      });
                      return sorted.map((m) => {
                        const resolvedColor = colorMap.get(m.name);
                        const role = formatAgentRole(m.role) ?? formatAgentRole(m.agentType);
                        const isSelected = m.name === recipient;
                        return (
                          <button
                            key={m.name}
                            type="button"
                            className={cn(
                              'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors hover:bg-[var(--color-surface-raised)]',
                              isSelected && 'bg-[var(--color-surface-raised)]'
                            )}
                            onClick={() => {
                              setRecipient(m.name);
                              setRecipientOpen(false);
                              setRecipientSearch('');
                            }}
                          >
                            <MemberBadge
                              name={m.name}
                              color={resolvedColor}
                              size="sm"
                              hideAvatar={m.name === 'user'}
                              disableHoverCard
                            />
                            {role ? (
                              <span className="shrink-0 text-[10px] text-[var(--color-text-muted)]">
                                {role}
                              </span>
                            ) : null}
                            {isSelected ? (
                              <Check size={12} className="ml-auto shrink-0 text-blue-400" />
                            ) : null}
                          </button>
                        );
                      });
                    })()}
                  </div>
                </PopoverContent>
              </Popover>
            </div>
          </div>
        </div>

        {hasAttachmentPreviewContent ? (
          <AttachmentPreviewList
            attachments={draft.attachments}
            onRemove={draft.removeAttachment}
            error={draft.attachmentError ?? fileRestrictionError}
            onDismissError={draft.clearAttachmentError}
            disabled={attachmentsBlocked}
            disabledHint="仅在团队在线且接收人为团队负责人时支持附件。请移除附件或切换接收人。"
          />
        ) : null}
      </div>

      <div className="relative">
        <DropZoneOverlay
          active={isDragOver}
          rejected={!supportsAttachments}
          rejectionReason={attachmentRestrictionReason}
        />
        <MentionableTextarea
          ref={textareaRef}
          id={`compose-${teamName}`}
          placeholder={
            isProvisioning
              ? '团队正在启动中... 消息将排队并在稍后投递到收件箱。'
              : isCrossTeam
                ? `发送跨团队消息到 ${targetDisplayName ?? '目标团队'}...`
                : '输入消息...（回车发送，Shift+Enter 换行）'
          }
          value={draft.text}
          onValueChange={draft.setText}
          suggestions={mentionSuggestions}
          teamSuggestions={teamMentionSuggestions}
          taskSuggestions={taskSuggestions}
          commandSuggestions={slashCommandSuggestions}
          chips={draft.chips}
          onChipRemove={draft.removeChip}
          projectPath={projectPath}
          onFileChipInsert={draft.addChip}
          onModEnter={handleSend}
          dismissMentionsRef={dismissMentionsRef}
          extraTips={['Tips：你可以输入 "/" 来运行 Claude 命令。']}
          surfaceClassName="message-composer-shell message-composer-orbit-surface border border-transparent bg-[var(--color-surface-raised)] shadow-[0_8px_24px_rgba(0,0,0,0.18),inset_0_1px_0_rgba(255,255,255,0.03)]"
          surfaceDecoration="orbit-border"
          surfaceFadeColor="var(--color-surface-raised)"
          className="border-transparent shadow-none"
          minRows={1}
          maxRows={6}
          maxLength={MAX_TEXT_LENGTH}
          disabled={sending}
          hintText={crossTeamHintText}
          showHint={!isCompactLayout}
          cornerActionInset="compact"
          cornerAction={
            <div className="flex items-center gap-2">
              {/* NOTE: ContextRing disabled — usage formula is inaccurate */}
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    className="inline-flex shrink-0 items-center rounded-full p-1.5 text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-surface-raised)] hover:text-[var(--color-text-secondary)]"
                    onClick={() => void window.electronAPI.openExternal('https://voicetext.site')}
                  >
                    <Mic size={14} />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="top">语音转文字</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="inline-flex">
                    <button
                      type="button"
                      className="inline-flex shrink-0 items-center gap-1 rounded-full bg-blue-600 px-3 py-1.5 text-[11px] font-medium text-white shadow-sm transition-colors hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
                      disabled={!canSend}
                      onClick={handleSend}
                    >
                      <Send size={12} />
                      发送
                    </button>
                  </span>
                </TooltipTrigger>
                {slashCommandRestrictionReason ? (
                  <TooltipContent side="top">{slashCommandRestrictionReason}</TooltipContent>
                ) : isProvisioning && !sending ? (
                  <TooltipContent side="top">团队启动期间暂不可发送</TooltipContent>
                ) : null}
              </Tooltip>
            </div>
          }
          footerRight={
            isCompactLayout ? (
              compactFooterNotice
            ) : (
              <div className="flex items-center gap-2">
                {compactFooterNotice}
                {remaining < 200 ? (
                  <span
                    className={`text-[10px] ${remaining < 100 ? 'text-yellow-400' : 'text-[var(--color-text-muted)]'}`}
                  >
                    剩余 {remaining} 字符
                  </span>
                ) : null}
                {draft.isSaved ? (
                  <span className="text-[10px] text-[var(--color-text-muted)]">已保存</span>
                ) : null}
              </div>
            )
          }
        />
      </div>
    </div>
  );
};
