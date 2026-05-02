import {
  resolveAnthropicFastMode,
  resolveAnthropicRuntimeSelection,
} from '@features/anthropic-runtime-profile/main';
import {
  buildCodexFastModeArgs,
  resolveCodexFastMode,
  resolveCodexRuntimeSelection,
} from '@features/codex-runtime-profile/main';
import {
  buildPlannedMemberLaneIdentity,
  fromProvisioningMembers,
  isMixedOpenCodeSideLanePlan,
  type TeamRuntimeLanePlan,
} from '@features/team-runtime-lanes';
import { createTeamRuntimeLaneCoordinator } from '@features/team-runtime-lanes/main';
import {
  killTmuxPaneForCurrentPlatformSync,
  listRuntimeProcessesForCurrentTmuxPlatform,
  listTmuxPanePidsForCurrentPlatform,
  listTmuxPaneRuntimeInfoForCurrentPlatform,
  type TmuxPaneRuntimeInfo,
} from '@features/tmux-installer/main';
import { SkillProjectionService } from '@main/services/extensions/skills/SkillProjectionService';
import { ConfigManager } from '@main/services/infrastructure/ConfigManager';
import { NotificationManager } from '@main/services/infrastructure/NotificationManager';
import { getLeadChannelListenerService } from '@main/services/team/LeadChannelListenerService';
import { getAppIconPath } from '@main/utils/appIcon';
import {
  execCli,
  killProcessTree,
  killTrackedCliProcesses,
  spawnCli,
} from '@main/utils/childProcess';
import { FileReadTimeoutError, readFileUtf8WithTimeout } from '@main/utils/fsRead';
import {
  encodePath,
  extractBaseDir,
  getAutoDetectedClaudeBasePath,
  getClaudeBasePath,
  getHomeDir,
  getProjectsBasePath,
  getTasksBasePath,
  getTeamsBasePath,
} from '@main/utils/pathDecoder';
import { isProcessAlive } from '@main/utils/processHealth';
import { killProcessByPid } from '@main/utils/processKill';
import { resolveInteractiveShellEnv } from '@main/utils/shellEnv';
import { shouldAutoAllow } from '@main/utils/toolApprovalRules';
import {
  listWindowsProcessTable,
  listWindowsProcessTableSync,
} from '@main/utils/windowsProcessTable';
import {
  AGENT_BLOCK_CLOSE,
  AGENT_BLOCK_OPEN,
  stripAgentBlocks,
  wrapAgentBlock,
} from '@shared/constants/agentBlocks';
import { CLI_NOT_FOUND_MESSAGE } from '@shared/constants/cli';
import {
  CROSS_TEAM_PREFIX_TAG,
  CROSS_TEAM_SENT_SOURCE,
  CROSS_TEAM_SOURCE,
  parseCrossTeamPrefix,
  stripCrossTeamPrefix,
} from '@shared/constants/crossTeam';
import { getMemberColorByName } from '@shared/constants/memberColors';
import { DEFAULT_TOOL_APPROVAL_SETTINGS } from '@shared/types/team';
import { resolveLanguageName } from '@shared/utils/agentLanguage';
import { resolveAnthropicLaunchModel } from '@shared/utils/anthropicLaunchModel';
import { getAnthropicDefaultTeamModel } from '@shared/utils/anthropicModelDefaults';
import { parseCliArgs } from '@shared/utils/cliArgsParser';
import { deriveContextMetrics, inferContextWindowTokens } from '@shared/utils/contextMetrics';
import { isTeamEffortLevel } from '@shared/utils/effortLevels';
import { getErrorMessage } from '@shared/utils/errorHandling';
import {
  isInboxNoiseMessage,
  isMeaningfulBootstrapCheckInMessage,
  type ParsedPermissionRequest,
  parsePermissionRequest,
} from '@shared/utils/inboxNoise';
import {
  CANONICAL_LEAD_MEMBER_NAME,
  isLeadAgentType,
  isLeadMember,
  isLeadMemberName,
  LEGACY_LEAD_MEMBER_NAME,
} from '@shared/utils/leadDetection';
import { createLogger } from '@shared/utils/logger';
import { migrateProviderBackendId } from '@shared/utils/providerBackend';
import { isDefaultProviderModelSelection } from '@shared/utils/providerModelSelection';
import { formatTaskDisplayLabel } from '@shared/utils/taskIdentity';
import {
  parseAllTeammateMessages,
  type ParsedTeammateContent,
} from '@shared/utils/teammateMessageParser';
import { buildTeamMemberColorMap } from '@shared/utils/teamMemberColors';
import { createCliAutoSuffixNameGuard, parseNumericSuffixName } from '@shared/utils/teamMemberName';
import {
  inferTeamProviderIdFromModel,
  normalizeOptionalTeamProviderId,
} from '@shared/utils/teamProvider';
import {
  extractToolPreview,
  extractToolResultPreview,
  formatToolSummaryFromCalls,
  parseAgentToolResultStatus,
} from '@shared/utils/toolSummary';
import * as agentTeamsControllerModule from 'agent-teams-controller';
import { type ChildProcess, execFileSync, type spawn } from 'child_process';
import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import pidusage from 'pidusage';
import * as readline from 'readline';

import {
  type GeminiRuntimeAuthState,
  resolveGeminiRuntimeAuth,
} from '../runtime/geminiRuntimeAuth';
import { buildProviderAwareCliEnv } from '../runtime/providerAwareCliEnv';
import { ProviderConnectionService } from '../runtime/ProviderConnectionService';
import {
  buildProviderPreflightPingArgs,
  getProviderModelProbeExpectedOutput,
  getProviderModelProbeTimeoutMs,
  normalizeProviderModelProbeFailureReason,
} from '../runtime/providerModelProbe';
import { resolveTeamProviderId } from '../runtime/providerRuntimeEnv';

import {
  createOpenCodePromptDeliveryLedgerStore,
  hashOpenCodePromptDeliveryPayload,
  isOpenCodePromptDeliveryAttemptDue,
  isOpenCodePromptResponseStateResponded,
  type OpenCodePromptDeliveryLedgerRecord,
  type OpenCodePromptDeliveryLedgerStore,
  type OpenCodePromptDeliveryStatus,
} from './opencode/delivery/OpenCodePromptDeliveryLedger';
import {
  isOpenCodePromptDeliveryObserveLaterResponseState,
  isOpenCodePromptDeliveryRetryableResponseState,
  isOpenCodeVisibleReplyReadCommitAllowed,
  isOpenCodeVisibleReplySemanticallySufficient,
  OPENCODE_PROMPT_DELIVERY_OBSERVE_DELAY_MS,
  OPENCODE_PROMPT_DELIVERY_RETRY_DELAY_MS,
  OPENCODE_PROMPT_WATCHDOG_GLOBAL_CONCURRENCY,
  OPENCODE_PROMPT_WATCHDOG_PER_TEAM_CONCURRENCY,
  type OpenCodeVisibleReplyProof,
} from './opencode/delivery/OpenCodePromptDeliveryWatchdog';
import { createRuntimeDeliveryJournalStore } from './opencode/delivery/RuntimeDeliveryJournal';
import {
  type RuntimeDeliveryDestinationPort,
  RuntimeDeliveryDestinationRegistry,
  RuntimeDeliveryReconciler,
  RuntimeDeliveryService,
} from './opencode/delivery/RuntimeDeliveryService';
import {
  clearOpenCodeRuntimeLaneStorage,
  getOpenCodeLaneScopedRuntimeFilePath,
  getOpenCodeRuntimeRunTombstonesPath,
  getOpenCodeTeamRuntimeDirectory,
  migrateLegacyOpenCodeRuntimeState,
  OpenCodeRuntimeManifestEvidenceReader,
  readOpenCodeRuntimeLaneIndex,
  recoverStaleOpenCodeRuntimeLaneIndexEntry,
  removeOpenCodeRuntimeLaneIndexEntry,
  upsertOpenCodeRuntimeLaneIndexEntry,
} from './opencode/store/OpenCodeRuntimeManifestEvidenceReader';
import {
  createRuntimeRunTombstoneStore,
  type RuntimeEvidenceKind,
} from './opencode/store/RuntimeRunTombstoneStore';
import { OpenCodeTaskLogAttributionStore } from './taskLogs/stream/OpenCodeTaskLogAttributionStore';
import { isAgentTeamsToolUse } from './agentTeamsToolNames';
import { atomicWriteAsync } from './atomicWrite';
import { peekAutoResumeService } from './AutoResumeService';
import { ClaudeBinaryResolver } from './ClaudeBinaryResolver';
import { getConfiguredCliCommandLabel } from './cliFlavor';
import { withFileLock } from './fileLock';
import {
  type ClassifiedMainProcessIdle,
  classifyIdleNotificationForMainProcess,
} from './idleNotificationMainProcessSemantics';
import { withInboxLock } from './inboxLock';
import { getEffectiveInboxMessageId } from './inboxMessageIdentity';
import {
  boundLaunchDiagnostics,
  buildProgressAssistantOutput,
  buildProgressLogsTail,
} from './progressPayload';
import { resolveDesktopTeammateModeDecision } from './runtimeTeammateMode';
import {
  choosePreferredLaunchSnapshot,
  clearBootstrapState,
  readBootstrapLaunchSnapshot,
  readBootstrapRuntimeState,
} from './TeamBootstrapStateReader';
import { TeamConfigReader } from './TeamConfigReader';
import { TeamInboxReader } from './TeamInboxReader';
import { TeamInboxWriter } from './TeamInboxWriter';
import {
  createPersistedLaunchSnapshot,
  deriveTeamLaunchAggregateState,
  hasMixedPersistedLaunchMetadata,
  snapshotFromRuntimeMemberStatuses,
  snapshotToMemberSpawnStatuses,
} from './TeamLaunchStateEvaluator';
import { TeamLaunchStateStore } from './TeamLaunchStateStore';
import { TeamMcpConfigBuilder } from './TeamMcpConfigBuilder';
import { TeamMemberLogsFinder } from './TeamMemberLogsFinder';
import { TeamMembersMetaStore } from './TeamMembersMetaStore';
import { TeamMemberWorktreeManager } from './TeamMemberWorktreeManager';
import { TeamMetaStore } from './TeamMetaStore';
import {
  commandArgEquals,
  isStrongRuntimeEvidence,
  resolveTeamMemberRuntimeLiveness,
  sanitizeProcessCommandForDiagnostics,
} from './TeamRuntimeLivenessResolver';
import { TeamSentMessagesStore } from './TeamSentMessagesStore';
import { TeamTaskReader } from './TeamTaskReader';
import { TeamTranscriptProjectResolver } from './TeamTranscriptProjectResolver';

import type {
  OpenCodeTeamRuntimeMessageInput,
  OpenCodeTeamRuntimeMessageResult,
  TeamLaunchRuntimeAdapter,
  TeamRuntimeAdapterRegistry,
  TeamRuntimeLaunchInput,
  TeamRuntimeLaunchResult,
  TeamRuntimeMemberLaunchEvidence,
  TeamRuntimePrepareResult,
  TeamRuntimeStopInput,
} from './runtime';
import type { SshConnectionManager } from '@main/services/infrastructure/SshConnectionManager';

/**
 * Kill a team CLI process using SIGKILL (uncatchable).
 *
 * Newer Claude CLI versions (≥2.1.x) handle SIGTERM gracefully and run cleanup
 * that deletes team files (config.json, inboxes/, tasks/). SIGKILL prevents this.
 *
 * ALWAYS use this instead of killProcessTree() for team processes.
 * stdin.end() is also forbidden — EOF triggers the same cleanup.
 */
function killTeamProcess(child: ChildProcess | null | undefined): void {
  killProcessTree(child, 'SIGKILL');
}

function buildRemoteKillProcessTreeCommand(pid: number): string {
  const safePid = Number.isFinite(pid) && pid > 0 ? Math.trunc(pid) : 0;
  return [
    'sh -lc',
    quoteShellArg(
      [
        `root=${safePid}`,
        'pids="$root"',
        'frontier="$root"',
        'while [ -n "$frontier" ]; do',
        '  next=""',
        '  for parent in $frontier; do',
        '    children=$(pgrep -P "$parent" 2>/dev/null || true)',
        '    if [ -n "$children" ]; then',
        '      next="$next $children"',
        '      pids="$pids $children"',
        '    fi',
        '  done',
        '  frontier="$next"',
        'done',
        'kill -9 $pids 2>/dev/null || true',
      ].join('\n')
    ),
  ].join(' ');
}

function quoteShellArg(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function buildRelayInboxView(messages: RelayInboxMessage[]): RelayInboxMessageView[] {
  return messages.map((message) => {
    const isCrossTeamLike =
      message.source === CROSS_TEAM_SOURCE || message.source === CROSS_TEAM_SENT_SOURCE;
    if (message.externalChannel) {
      return {
        message,
        idle: null,
        isCoarseNoise: false,
      };
    }
    return {
      message,
      idle: isCrossTeamLike ? null : classifyIdleNotificationForMainProcess(message.text),
      isCoarseNoise: isCrossTeamLike ? false : isInboxNoiseMessage(message.text),
    };
  });
}

interface PersistedRuntimeMemberLike {
  name?: string;
  agentId?: string;
  tmuxPaneId?: string;
  backendType?: string;
  providerId?: string;
  cwd?: string;
  runtimePid?: number;
  runtimeSessionId?: string;
}

type RelayInboxMessage = InboxMessage & { messageId: string };

interface RelayInboxMessageView {
  message: RelayInboxMessage;
  idle: ClassifiedMainProcessIdle | null;
  isCoarseNoise: boolean;
}

interface OpenCodeRuntimeControlAck {
  ok: true;
  providerId: 'opencode';
  teamName: string;
  runId: string;
  state: 'accepted' | 'delivered' | 'duplicate' | 'recorded';
  memberName?: string;
  runtimeSessionId?: string;
  idempotencyKey?: string;
  location?: unknown;
  diagnostics: string[];
  observedAt: string;
}

type BootstrapTranscriptOutcome =
  | {
      kind: 'success';
      observedAt: string;
    }
  | {
      kind: 'failure';
      observedAt: string;
      reason: string;
    };

import type {
  ActiveToolCall,
  AgentActionMode,
  CliProviderModelCatalog,
  CliProviderRuntimeCapabilities,
  CliProviderStatus,
  CrossTeamSendResult,
  EffortLevel,
  InboxMessage,
  LeadContextUsage,
  MemberLaunchState,
  MemberSpawnLivenessSource,
  MemberSpawnStatus,
  MemberSpawnStatusEntry,
  PersistedTeamLaunchMemberState,
  PersistedTeamLaunchPhase,
  PersistedTeamLaunchSnapshot,
  PersistedTeamLaunchSummary,
  ProviderModelLaunchIdentity,
  TaskRef,
  TeamAgentRuntimeBackendType,
  TeamAgentRuntimeDiagnosticSeverity,
  TeamAgentRuntimeEntry,
  TeamAgentRuntimeLivenessKind,
  TeamAgentRuntimePidSource,
  TeamAgentRuntimeSnapshot,
  TeamChangeEvent,
  TeamConfig,
  TeamCreateRequest,
  TeamCreateResponse,
  TeamFastMode,
  TeamLaunchAggregateState,
  TeamLaunchDiagnosticItem,
  TeamLaunchRequest,
  TeamLaunchResponse,
  TeamMember,
  TeamProviderBackendId,
  TeamProviderId,
  TeamProvisioningModelVerificationMode,
  TeamProvisioningPrepareResult,
  TeamProvisioningProgress,
  TeamProvisioningState,
  TeamRuntimeState,
  TeamTask,
  ToolActivityEventPayload,
  ToolApprovalAutoResolved,
  ToolApprovalEvent,
  ToolApprovalRequest,
  ToolApprovalSettings,
  ToolCallMeta,
} from '@shared/types';

const logger = createLogger('Service:TeamProvisioning');
const PREFLIGHT_DEBUG_LOG_PATH = path.join(os.tmpdir(), 'claude-team-preflight-debug.log');

function appendPreflightDebugLog(event: string, data: Record<string, unknown>): void {
  try {
    fs.appendFileSync(
      PREFLIGHT_DEBUG_LOG_PATH,
      `${JSON.stringify({
        at: new Date().toISOString(),
        event,
        ...data,
      })}\n`,
      'utf8'
    );
  } catch {
    // Best-effort debug logging only.
  }
}
const {
  AGENT_TEAMS_TEAMMATE_OPERATIONAL_TOOL_NAMES,
  AGENT_TEAMS_NAMESPACED_LEAD_BOOTSTRAP_TOOL_NAMES,
  AGENT_TEAMS_NAMESPACED_TEAMMATE_OPERATIONAL_TOOL_NAMES,
  createController,
  protocols,
} = agentTeamsControllerModule;
const TEAM_NAME_PATTERN = /^[a-z0-9][a-z0-9-]{0,127}$/;
const RUN_TIMEOUT_MS = 300_000;
const VERIFY_TIMEOUT_MS = 15_000;
const MCP_PREFLIGHT_INITIALIZE_TIMEOUT_MS = 45_000;
const MEMBER_BOOTSTRAP_PARALLEL_WINDOW = 4;

// MCP preflight is process-global: agent-teams server is bundled with the app,
// so one successful validation covers all subsequent team launches.
const mcpPreflightPassedKeys = new Set<string>();
const mcpPreflightPromisesByKey = new Map<string, Promise<void>>();

function asRuntimeRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('OpenCode runtime payload must be an object');
  }
  return value as Record<string, unknown>;
}

function requireRuntimeString(value: unknown, fieldName: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`OpenCode runtime payload missing ${fieldName}`);
  }
  return value.trim();
}

function optionalRuntimeString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function normalizeRuntimeIso(value: unknown, fallback: string = nowIso()): string {
  const raw = optionalRuntimeString(value);
  if (!raw) {
    return fallback;
  }
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : fallback;
}

function normalizeRuntimeStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : [];
}

interface RuntimeToolMetadata {
  runtimePid?: number;
  processCommand?: string;
  runtimeVersion?: string;
  hostPid?: number;
  cwd?: string;
}

function normalizeRuntimePositiveInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.trunc(value)
    : undefined;
}

function normalizeRuntimeMetadataString(value: unknown, maxLength: number): string | undefined {
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim().slice(0, maxLength)
    : undefined;
}

function parseRuntimeToolMetadata(value: unknown): RuntimeToolMetadata {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  const raw = value as Record<string, unknown>;
  return {
    ...(normalizeRuntimePositiveInteger(raw.runtimePid)
      ? { runtimePid: normalizeRuntimePositiveInteger(raw.runtimePid) }
      : {}),
    ...(normalizeRuntimeMetadataString(raw.processCommand, 500)
      ? { processCommand: normalizeRuntimeMetadataString(raw.processCommand, 500) }
      : {}),
    ...(normalizeRuntimeMetadataString(raw.runtimeVersion, 80)
      ? { runtimeVersion: normalizeRuntimeMetadataString(raw.runtimeVersion, 80) }
      : {}),
    ...(normalizeRuntimePositiveInteger(raw.hostPid)
      ? { hostPid: normalizeRuntimePositiveInteger(raw.hostPid) }
      : {}),
    ...(normalizeRuntimeMetadataString(raw.cwd, 500)
      ? { cwd: normalizeRuntimeMetadataString(raw.cwd, 500) }
      : {}),
  };
}

function mentionsProcessTableUnavailable(value: string | undefined): boolean {
  return /\bprocess table\b.*\bunavailable\b/i.test(value ?? '');
}

function buildRuntimeToolMetadataDiagnostics(metadata: RuntimeToolMetadata | undefined): string[] {
  if (!metadata) {
    return [];
  }
  const diagnostics: string[] = [];
  if (metadata.runtimePid != null) {
    diagnostics.push(`runtime pid: ${metadata.runtimePid}`);
  }
  if (metadata.processCommand) {
    const processCommand = sanitizeProcessCommandForDiagnostics(metadata.processCommand);
    if (processCommand) {
      diagnostics.push(`runtime process command: ${processCommand}`);
    }
  }
  if (metadata.runtimeVersion) {
    diagnostics.push(`runtime version: ${metadata.runtimeVersion}`);
  }
  if (metadata.hostPid != null) {
    diagnostics.push(`runtime host pid: ${metadata.hostPid}`);
  }
  if (metadata.cwd) {
    diagnostics.push(`runtime cwd: ${metadata.cwd}`);
  }
  return diagnostics;
}

function buildRuntimeDiagnosticForSpawn(
  metadata: LiveTeamAgentRuntimeMetadata
): string | undefined {
  const baseDiagnostic = metadata.runtimeDiagnostic;
  const processTableUnavailable =
    mentionsProcessTableUnavailable(baseDiagnostic) ||
    metadata.diagnostics?.some((diagnostic) => mentionsProcessTableUnavailable(diagnostic));
  if (!processTableUnavailable) {
    return baseDiagnostic;
  }
  if (mentionsProcessTableUnavailable(baseDiagnostic)) {
    return baseDiagnostic;
  }
  return baseDiagnostic
    ? `${baseDiagnostic}; process table unavailable`
    : 'process table unavailable';
}

function runtimeTaskRefs(teamName: string, value: unknown): InboxMessage['taskRefs'] | undefined {
  const refs = normalizeRuntimeStringArray(value);
  return refs.length > 0
    ? refs.map((ref) => ({
        teamName,
        taskId: ref,
        displayId: ref,
      }))
    : undefined;
}

function structuredTaskRefs(value: unknown): TaskRef[] | undefined {
  if (!Array.isArray(value) || value.length === 0) {
    return undefined;
  }

  const refs = value
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
    .map((item) => ({
      taskId: typeof item.taskId === 'string' ? item.taskId.trim() : '',
      displayId: typeof item.displayId === 'string' ? item.displayId.trim() : '',
      teamName: typeof item.teamName === 'string' ? item.teamName.trim() : '',
    }))
    .filter(
      (item) => item.taskId.length > 0 && item.displayId.length > 0 && item.teamName.length > 0
    );

  return refs.length > 0 ? refs : undefined;
}

function teamToolTaskRefs(teamName: string, value: unknown): TaskRef[] | undefined {
  return structuredTaskRefs(value) ?? runtimeTaskRefs(teamName, value);
}

// TODO(team-result-notification-v2): The safest long-term design is a runtime-authored
// task_result_notification emitted after task_complete with a validated resultCommentId.
// That would let the lead react to authoritative board/runtime state instead of
// teammate prose. Keep this relay hardening in place until that contract exists.
function buildLeadInboxTaskContextBlock(
  message: Pick<InboxMessage, 'taskRefs' | 'commentId' | 'messageKind' | 'source'>
): string {
  const taskRefs = Array.isArray(message.taskRefs) ? message.taskRefs : [];
  const commentId =
    typeof message.commentId === 'string' && message.commentId.trim().length > 0
      ? message.commentId.trim()
      : undefined;
  if (taskRefs.length === 0 && !commentId) {
    return '';
  }

  const lines = [
    `Authoritative structured task context for this inbox row. Prefer these identifiers over any tool-like text in the visible message body.`,
  ];
  if (typeof message.source === 'string' && message.source.trim().length > 0) {
    lines.push(`Source: ${message.source.trim()}`);
  }
  if (typeof message.messageKind === 'string' && message.messageKind.trim().length > 0) {
    lines.push(`Message kind: ${message.messageKind.trim()}`);
  }
  if (taskRefs.length > 0) {
    lines.push(`Task refs:`);
    for (const taskRef of taskRefs) {
      lines.push(
        `- ${formatTaskDisplayLabel({ id: taskRef.taskId, displayId: taskRef.displayId })} => teamName="${taskRef.teamName}", taskId="${taskRef.taskId}", displayId="${taskRef.displayId}"`
      );
    }
  }
  if (commentId) {
    lines.push(`Comment id: "${commentId}"`);
  }
  if (commentId && taskRefs.length === 1) {
    const [taskRef] = taskRefs;
    if (taskRef) {
      lines.push(
        `Fetch the authoritative task comment with: task_get_comment { teamName: "${taskRef.teamName}", taskId: "${taskRef.taskId}", commentId: "${commentId}" }`
      );
    }
  }

  return wrapAgentBlock(lines.join('\n'));
}

function mergeRuntimeDiagnostics(
  previous: string[] | undefined,
  incoming: unknown,
  fallback?: string
): string[] | undefined {
  const merged = [
    ...(previous ?? []),
    ...normalizeRuntimeStringArray(incoming),
    ...(fallback ? [fallback] : []),
  ].filter((value) => value.trim().length > 0);
  return merged.length > 0 ? [...new Set(merged)] : undefined;
}
const VERIFY_POLL_MS = 500;
const MCP_PREFLIGHT_SHUTDOWN_GRACE_MS = 250;
const MCP_PREFLIGHT_SHUTDOWN_TIMEOUT_MS = 2_000;
const MCP_PREFLIGHT_SHUTDOWN_POLL_MS = 50;
const STDERR_RING_LIMIT = 64 * 1024;
const STDOUT_RING_LIMIT = 64 * 1024;
// Progress emissions fan out the latest CLI tail + assistant output to the
// renderer over IPC. Under load the previous 300ms cadence combined with an
// unbounded payload (see `emitLogsProgress`) caused renderer OOM crashes
// (≈3 full-history serializations per second, each holding thousands of
// lines). The tail cap in `emitLogsProgress` bounds each payload; we also
// slow the cadence to ~1s so Zustand can keep up on large teams.
const LOG_PROGRESS_THROTTLE_MS = 1000;
const UI_LOGS_TAIL_LIMIT = 128 * 1024;
const PROBE_CACHE_TTL_MS = 36 * 60 * 60 * 1000;
const PREFLIGHT_BINARY_TIMEOUT_MS = 8000;
const PREFLIGHT_AUTH_RETRY_DELAY_MS = 2000;
const PREFLIGHT_AUTH_MAX_RETRIES = 2;
const OPENCODE_PREFLIGHT_MODEL_PROBE_CONCURRENCY = 2;

function applyDistinctProvisioningMemberColors<
  T extends { name: string; color?: string; removedAt?: number },
>(members: readonly T[]): T[] {
  const colorMap = buildTeamMemberColorMap(members, { preferProvidedColors: false });
  return members.map((member) => ({
    ...member,
    color: colorMap.get(member.name) ?? member.color ?? getMemberColorByName(member.name),
  }));
}
const FS_MONITOR_POLL_MS = 2000;
const TASK_WAIT_FALLBACK_MS = 15_000;
const STALL_CHECK_INTERVAL_MS = 10_000;
const STALL_WARNING_THRESHOLD_MS = 20_000;
const APP_TEAM_RUNTIME_DISALLOWED_TOOLS =
  'TeamDelete,TodoWrite,TaskCreate,TaskUpdate,mcp__agent-teams__team_launch,mcp__agent-teams__team_stop';
const AGENT_TEAMS_MCP_SERVER_NAME = 'agent-teams';
const AGENT_TEAMS_MEMBER_AGENT_TYPE = 'agent-teams-member';
const TEAM_JSON_READ_TIMEOUT_MS = 5_000;
const TEAM_CONFIG_MAX_BYTES = 10 * 1024 * 1024;
const TEAM_INBOX_MAX_BYTES = 2 * 1024 * 1024;
const MEMBER_SPAWN_AUDIT_MIN_INTERVAL_MS = 1_500;
const MEMBER_SPAWN_AUDIT_WARNING_THROTTLE_MS = 10_000;
const CROSS_TEAM_TOOL_RECIPIENT_NAMES = new Set([
  'cross_team_send',
  'cross_team_list_targets',
  'cross_team_get_outbox',
]);
const HANDLED_STREAM_JSON_TYPES = new Set([
  'user',
  'assistant',
  'control_request',
  'result',
  'system',
]);

function readAgentTeamsMcpServerForAgent(
  mcpConfigPath: string
): Record<string, AgentTeamsMcpConfigEntry> {
  const raw = fs.readFileSync(mcpConfigPath, 'utf8');
  const parsed = JSON.parse(raw) as AgentTeamsMcpConfigFile;
  const server = parsed.mcpServers?.[AGENT_TEAMS_MCP_SERVER_NAME];
  if (!server || typeof server !== 'object' || Array.isArray(server)) {
    throw new Error(
      `Generated MCP config ${mcpConfigPath} is missing ${AGENT_TEAMS_MCP_SERVER_NAME}`
    );
  }
  return { [AGENT_TEAMS_MCP_SERVER_NAME]: server };
}

function buildAgentTeamsMemberAgentsJson(mcpConfigPath: string): string {
  return JSON.stringify({
    [AGENT_TEAMS_MEMBER_AGENT_TYPE]: {
      description: 'Agent Teams persistent teammate',
      prompt:
        '你是由 Agent Teams 管理的持久团队成员。请遵循具体任务提示，并使用 agent-teams MCP 工具进行团队协作。',
      tools: ['*'],
      mcpServers: [readAgentTeamsMcpServerForAgent(mcpConfigPath)],
    },
  });
}

function assertAppDeterministicBootstrapEnabled(): void {
  if (process.env.CLAUDE_APP_DISABLE_DETERMINISTIC_TEAM_BOOTSTRAP === '1') {
    throw new Error(
      'Deterministic team bootstrap is disabled by the app rollout flag (CLAUDE_APP_DISABLE_DETERMINISTIC_TEAM_BOOTSTRAP=1).'
    );
  }
  if (process.env.CLAUDE_DISABLE_DETERMINISTIC_TEAM_BOOTSTRAP === '1') {
    throw new Error(
      'Deterministic team bootstrap is disabled by the runtime kill switch (CLAUDE_DISABLE_DETERMINISTIC_TEAM_BOOTSTRAP=1).'
    );
  }
}

function classifyDeterministicBootstrapFailure(reason: string): {
  title: string;
  normalizedReason: string;
} {
  const normalizedReason = reason.trim();
  const lower = normalizedReason.toLowerCase();
  if (lower.includes('disabled by kill switch')) {
    return {
      title: 'Deterministic bootstrap disabled',
      normalizedReason,
    };
  }
  if (
    lower.includes('requires claude_enable_deterministic_team_bootstrap=1') ||
    lower.includes('unsupported schema version') ||
    lower.includes('regular file and must not be a symlink')
  ) {
    return {
      title: 'Deterministic bootstrap compatibility failure',
      normalizedReason,
    };
  }
  return {
    title: 'Deterministic bootstrap failed',
    normalizedReason,
  };
}

function getPreflightPingArgs(providerId: TeamProviderId | undefined): string[] {
  return buildProviderPreflightPingArgs(providerId);
}

function getPreflightTimeoutMs(providerId: TeamProviderId | undefined): number {
  return getProviderModelProbeTimeoutMs(providerId);
}

function buildProviderCliCommandArgs(providerArgs: string[], args: string[]): string[] {
  return [...providerArgs, ...args];
}

interface ProviderModelListCommandResponse {
  schemaVersion?: number;
  providers?: Record<
    string,
    {
      defaultModel?: string | null;
      models?: (string | { id?: string; label?: string; description?: string })[];
    }
  >;
}

interface RuntimeStatusCommandResponse {
  providers?: Record<string, Partial<CliProviderStatus>>;
}

interface AuthStatusCommandResponse {
  loggedIn?: boolean;
  authMethod?: string | null;
  providers?: Record<string, Partial<CliProviderStatus>>;
}

interface RuntimeProviderLaunchFacts {
  defaultModel: string | null;
  modelIds: Set<string>;
  modelCatalog: CliProviderModelCatalog | null;
  runtimeCapabilities: CliProviderRuntimeCapabilities | null;
  providerStatus?:
    | (Partial<CliProviderStatus> & { providerId?: CliProviderStatus['providerId'] })
    | null;
}

function extractJsonObjectFromCli<T>(raw: string): T {
  const trimmed = raw.trim();
  try {
    return JSON.parse(trimmed) as T;
  } catch {
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start >= 0 && end > start) {
      return JSON.parse(trimmed.slice(start, end + 1)) as T;
    }
    throw new Error('No JSON object found in CLI output');
  }
}

function getExplicitLaunchModelSelection(model: string | undefined): string | undefined {
  const trimmed = model?.trim();
  if (!trimmed || isDefaultProviderModelSelection(trimmed)) {
    return undefined;
  }
  return trimmed;
}

function isAnthropicOneMillionModel(model: string | undefined | null): boolean {
  return /\[1m\]/i.test(model?.trim() ?? '');
}

function sanitizeAnthropicEffortForModel(
  providerId: TeamProviderId,
  model: string | undefined,
  effort: TeamCreateRequest['effort']
): TeamCreateRequest['effort'] {
  if (providerId === 'anthropic' && isAnthropicOneMillionModel(model)) {
    return undefined;
  }
  return effort;
}

function getLaunchModelArg(
  providerId: TeamProviderId,
  model: string | undefined,
  launchIdentity?: ProviderModelLaunchIdentity | null
): string | undefined {
  if (providerId === 'anthropic' && launchIdentity?.resolvedLaunchModel) {
    return launchIdentity.resolvedLaunchModel;
  }

  const explicitModel = getExplicitLaunchModelSelection(model);
  if (explicitModel) {
    return explicitModel;
  }

  if (
    providerId === 'codex' &&
    launchIdentity?.selectedModelKind === 'default' &&
    launchIdentity.resolvedLaunchModel
  ) {
    return launchIdentity.resolvedLaunchModel;
  }

  return undefined;
}

function normalizeProviderModelListModels(
  provider: NonNullable<ProviderModelListCommandResponse['providers']>[string] | undefined
): Set<string> {
  const models = new Set<string>();
  for (const entry of provider?.models ?? []) {
    const modelId = typeof entry === 'string' ? entry : entry.id;
    const trimmed = modelId?.trim();
    if (trimmed) {
      models.add(trimmed);
    }
  }
  return models;
}

function isLegacySafeEffort(effort: EffortLevel): boolean {
  return effort === 'low' || effort === 'medium' || effort === 'high';
}

function isCodexEffortRuntimeSupported(
  effort: EffortLevel,
  capabilities: CliProviderRuntimeCapabilities | null
): boolean {
  if (isLegacySafeEffort(effort)) {
    return true;
  }

  const reasoning = capabilities?.reasoningEffort;
  return reasoning?.configPassthrough === true && reasoning.values.includes(effort);
}

function getAnthropicFastModeDefault(): boolean {
  return (
    ConfigManager.getInstance().getConfig().providerConnections.anthropic.fastModeDefault === true
  );
}

function resolveAnthropicSelectionFromFacts(params: {
  selectedModel?: string;
  limitContext?: boolean;
  facts: Pick<RuntimeProviderLaunchFacts, 'modelCatalog' | 'runtimeCapabilities'>;
}) {
  return resolveAnthropicRuntimeSelection({
    source: {
      modelCatalog: params.facts.modelCatalog,
      runtimeCapabilities: params.facts.runtimeCapabilities,
    },
    selectedModel: params.selectedModel,
    limitContext: params.limitContext,
  });
}

function resolveCodexSelectionFromFacts(params: {
  selectedModel?: string;
  providerBackendId?: TeamCreateRequest['providerBackendId'];
  facts: Pick<RuntimeProviderLaunchFacts, 'providerStatus'>;
}) {
  return resolveCodexRuntimeSelection({
    source: {
      providerStatus: params.facts.providerStatus,
      providerBackendId: params.providerBackendId,
    },
    selectedModel: params.selectedModel,
  });
}

function buildAnthropicSettingsArgs(
  providerId: TeamProviderId,
  launchIdentity?: ProviderModelLaunchIdentity | null,
  skipPermissions?: boolean
): string[] {
  if (providerId !== 'anthropic' || typeof launchIdentity?.resolvedFastMode !== 'boolean') {
    return [];
  }

  const settings: Record<string, unknown> = launchIdentity.resolvedFastMode
    ? {
        fastMode: true,
        fastModePerSessionOptIn: false,
      }
    : {
        fastMode: false,
      };
  if (skipPermissions !== false) {
    settings.skipDangerousModePermissionPrompt = true;
  }

  return ['--settings', JSON.stringify(settings)];
}

function buildProviderFastModeArgs(
  providerId: TeamProviderId,
  launchIdentity?: ProviderModelLaunchIdentity | null,
  skipPermissions?: boolean
): string[] {
  if (providerId === 'anthropic') {
    return buildAnthropicSettingsArgs(providerId, launchIdentity, skipPermissions);
  }
  if (providerId === 'codex') {
    return buildCodexFastModeArgs(launchIdentity?.resolvedFastMode);
  }
  return [];
}

function isProbeTimeoutMessage(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    lower.includes('timeout running:') ||
    lower.includes('timed out') ||
    lower.includes('did not complete') ||
    lower.includes('etimedout')
  );
}

function resolveRequestedLaunchModel(params: {
  providerId: TeamProviderId;
  selectedModel?: string;
  limitContext?: boolean;
  facts: Pick<RuntimeProviderLaunchFacts, 'defaultModel' | 'modelIds'>;
}): string | null {
  if (params.providerId === 'anthropic') {
    return resolveAnthropicLaunchModel({
      selectedModel: params.selectedModel,
      limitContext: params.limitContext,
      availableLaunchModels: params.facts.modelIds,
      defaultLaunchModel: params.facts.defaultModel,
    });
  }

  const explicitModel = getExplicitLaunchModelSelection(params.selectedModel);
  return explicitModel ?? params.facts.defaultModel;
}

function getTeamProviderLabel(providerId: TeamProviderId): string {
  switch (providerId) {
    case 'opencode':
      return 'OpenCode';
    case 'codex':
      return 'Codex';
    case 'gemini':
      return 'Gemini';
    case 'anthropic':
    default:
      return 'Anthropic';
  }
}

interface CanonicalSendMessageExample {
  to: string;
  summary: string;
  message: string;
}

// TODO(refactor): If more prompt-bound tool contracts appear here, move these
// canonical examples/rules into a small dedicated module (for example
// `teamPromptContracts.ts`) and cover them with schema-backed tests. Keep this
// layer narrow and explicit; do not grow it into a generic schema-to-prompt
// generator.
const SEND_MESSAGE_CANONICAL_FIELDS = ['to', 'summary', 'message'] as const;
const SEND_MESSAGE_FORBIDDEN_ALIAS_FIELDS = ['recipient', 'content'] as const;

function buildCanonicalSendMessageExample(example: CanonicalSendMessageExample): string {
  return `{ ${SEND_MESSAGE_CANONICAL_FIELDS.map((field) => `${field}: "${example[field]}"`).join(', ')} }`;
}

function getCanonicalSendMessageFieldRule(): string {
  return `重要：SendMessage 工具入参必须使用真实字段名 \`${SEND_MESSAGE_CANONICAL_FIELDS.join('`, `')}\`。不要编造 \`${SEND_MESSAGE_FORBIDDEN_ALIAS_FIELDS.join('` 或 `')}\` 这类别名。只有工作流明确要求时，才可以添加可选字段（例如 \`taskRefs\`）。`;
}

function getCanonicalSendMessageToolRule(to: string): string {
  return `使用 SendMessage 工具，并设置 to="${to}"。`;
}

function getVisibleTaskReferenceFormattingRule(): string {
  return [
    '任务引用格式（重要）：在可见消息/评论文本里，任务引用必须写成普通 #<short-id> 文本，例如 #abcd1234。',
    '不要把任务引用或 Markdown 任务链接包在反引号/代码片段里，因为消息中的代码片段不会被自动链接。',
    '不要在可见文本里手写 [#abcd1234](task://...)。',
    '如果消息工具支持 taskRefs，请带上结构化 taskRefs 元数据，让应用自动把可见的 #abcd1234 文本转成链接。',
  ].join('\n');
}

function getConfiguredRuntimeBackend(providerId: TeamProviderId): string | null {
  const runtimeConfig = ConfigManager.getInstance().getConfig().runtime.providerBackends;
  switch (providerId) {
    case 'opencode':
      return null;
    case 'gemini':
      return runtimeConfig.gemini;
    case 'codex':
      return migrateProviderBackendId('codex', runtimeConfig.codex) ?? 'codex-native';
    case 'anthropic':
    default:
      return null;
  }
}

function isOpenCodeLegacyProvisioningRequest(request: {
  providerId?: unknown;
  members?: readonly { providerId?: unknown; provider?: unknown }[];
}): boolean {
  return (
    normalizeOptionalTeamProviderId(request.providerId) === 'opencode' ||
    (request.members ?? []).some(
      (member) =>
        normalizeOptionalTeamProviderId(member.providerId) === 'opencode' ||
        normalizeOptionalTeamProviderId(member.provider) === 'opencode'
    )
  );
}

function isPureOpenCodeProvisioningRequest(request: {
  providerId?: unknown;
  members?: readonly { providerId?: unknown; provider?: unknown }[];
}): boolean {
  if (!isOpenCodeLegacyProvisioningRequest(request)) {
    return false;
  }

  const rootProviderId = normalizeOptionalTeamProviderId(request.providerId);
  if (rootProviderId && rootProviderId !== 'opencode') {
    return false;
  }

  return (request.members ?? []).every((member) => {
    const memberProviderId =
      normalizeOptionalTeamProviderId(member.providerId) ??
      normalizeOptionalTeamProviderId(member.provider);
    return !memberProviderId || memberProviderId === 'opencode';
  });
}

export function getOpenCodeMixedProviderProvisioningError(): string {
  return (
    'This OpenCode mixed-team request is outside the current support scope. ' +
    'Supported mixed teams keep the lead on Anthropic, Codex, or Gemini. OpenCode-led mixed teams still remain blocked in this phase.'
  );
}

export function getMixedLaunchFallbackRecoveryError(): string {
  return (
    'Persisted mixed-team launch recovery requires members.meta.json lane-aware roster truth. ' +
    'Inbox/config fallback cannot safely reconstruct an OpenCode secondary lane in V1. ' +
    'Run a fresh team bootstrap or restore the missing mixed-team metadata first.'
  );
}

function assertOpenCodeNotLaunchedThroughLegacyProvisioning(request: {
  providerId?: unknown;
  members?: readonly { providerId?: unknown; provider?: unknown }[];
}): void {
  if (!isOpenCodeLegacyProvisioningRequest(request)) {
    return;
  }
  const lanePlan = fromProvisioningMembers(
    normalizeOptionalTeamProviderId(request.providerId),
    (request.members ?? []).map((member, index) => ({
      name: `member-${index + 1}`,
      providerId:
        normalizeOptionalTeamProviderId(member.providerId) ??
        normalizeOptionalTeamProviderId(member.provider),
    }))
  );
  if (!lanePlan.ok) {
    throw new Error(lanePlan.message || getOpenCodeMixedProviderProvisioningError());
  }
  if (!isPureOpenCodeProvisioningRequest(request)) {
    return;
  }
  throw new Error(
    'OpenCode team launch is not enabled in the legacy Claude stream-json provisioning path. ' +
      'Use the gated OpenCode runtime adapter once production launch is enabled.'
  );
}

function mergeProvisioningWarnings(
  existing: string[] | undefined,
  nextWarning: string | null
): string[] | undefined {
  if (!nextWarning) return existing;
  const merged = (existing ?? []).filter((warning) => warning !== nextWarning);
  merged.push(nextWarning);
  return merged.length > 0 ? merged : undefined;
}

function buildRuntimeLaunchWarning(
  request: Pick<
    TeamCreateRequest,
    'providerId' | 'providerBackendId' | 'model' | 'effort' | 'fastMode'
  >,
  env: NodeJS.ProcessEnv,
  options?: {
    geminiRuntimeAuth?: GeminiRuntimeAuthState | null;
    promptSize?: PromptSizeSummary | null;
    expectedMembersCount?: number;
  }
): string {
  const providerId = resolveTeamProviderId(request.providerId);
  const providerLabel = getTeamProviderLabel(providerId);
  const modelLabel = request.model?.trim() || 'default';
  const effortLabel = request.effort ?? 'default';
  const fastLabel =
    providerId === 'anthropic'
      ? `, fast ${request.fastMode ?? (getAnthropicFastModeDefault() ? 'inherit:on' : 'inherit:off')}`
      : providerId === 'codex'
        ? `, fast ${request.fastMode ?? 'inherit:off'}`
        : '';
  const backend =
    migrateProviderBackendId(providerId, request.providerBackendId?.trim()) ||
    getConfiguredRuntimeBackend(providerId);
  const flags: string[] = [];
  if (env.CLAUDE_CODE_USE_GEMINI === '1') flags.push('USE_GEMINI');
  if (env.CLAUDE_CODE_USE_OPENAI === '1') flags.push('USE_OPENAI');
  if (env.CLAUDE_CODE_ENTRY_PROVIDER) {
    flags.push(`ENTRY_PROVIDER=${env.CLAUDE_CODE_ENTRY_PROVIDER}`);
  }
  if (env.CLAUDE_CODE_GEMINI_BACKEND) {
    flags.push(`GEMINI_BACKEND=${env.CLAUDE_CODE_GEMINI_BACKEND}`);
  }
  if (env.CLAUDE_CODE_CODEX_BACKEND) {
    flags.push(`CODEX_BACKEND=${env.CLAUDE_CODE_CODEX_BACKEND}`);
  }
  const backendPart = backend ? `, backend ${backend}` : '';
  const flagsPart = flags.length > 0 ? `, env ${flags.join(', ')}` : '';
  const geminiAuth = options?.geminiRuntimeAuth;
  const authPart =
    providerId === 'gemini' && geminiAuth
      ? `, auth ${geminiAuth.authMethod ?? 'none'}/${geminiAuth.resolvedBackend}`
      : '';
  const promptSize = options?.promptSize;
  const promptPart = promptSize
    ? `, prompt ${promptSize.chars.toLocaleString('en-US')} chars/${promptSize.lines} lines`
    : '';
  const membersPart =
    typeof options?.expectedMembersCount === 'number'
      ? `, members ${options.expectedMembersCount}`
      : '';
  return `Launch runtime: ${providerLabel} · ${modelLabel} · ${effortLabel}${fastLabel}${backendPart}${authPart}${promptPart}${membersPart}${flagsPart}`;
}

function logRuntimeLaunchSnapshot(
  teamName: string,
  claudePath: string,
  args: string[],
  request: Pick<
    TeamCreateRequest,
    'providerId' | 'providerBackendId' | 'model' | 'effort' | 'fastMode'
  >,
  env: NodeJS.ProcessEnv,
  options?: {
    geminiRuntimeAuth?: GeminiRuntimeAuthState | null;
    promptSize?: PromptSizeSummary | null;
    expectedMembersCount?: number;
    launchIdentity?: ProviderModelLaunchIdentity | null;
  }
): void {
  const providerId = resolveTeamProviderId(request.providerId);
  const snapshot = {
    providerId,
    providerBackendId: migrateProviderBackendId(providerId, request.providerBackendId) ?? null,
    model: request.model ?? null,
    effort: request.effort ?? null,
    fastMode: request.fastMode ?? null,
    configuredBackend:
      migrateProviderBackendId(providerId, request.providerBackendId?.trim()) ||
      getConfiguredRuntimeBackend(providerId),
    promptSize: options?.promptSize ?? null,
    expectedMembersCount: options?.expectedMembersCount ?? null,
    launchIdentity: options?.launchIdentity ?? null,
    geminiRuntimeAuth:
      providerId === 'gemini'
        ? {
            authenticated: options?.geminiRuntimeAuth?.authenticated ?? null,
            authMethod: options?.geminiRuntimeAuth?.authMethod ?? null,
            resolvedBackend: options?.geminiRuntimeAuth?.resolvedBackend ?? null,
            projectId: options?.geminiRuntimeAuth?.projectId ?? null,
            statusMessage: options?.geminiRuntimeAuth?.statusMessage ?? null,
          }
        : null,
    env: {
      CLAUDE_CODE_USE_GEMINI: env.CLAUDE_CODE_USE_GEMINI ?? null,
      CLAUDE_CODE_USE_OPENAI: env.CLAUDE_CODE_USE_OPENAI ?? null,
      CLAUDE_CODE_ENTRY_PROVIDER: env.CLAUDE_CODE_ENTRY_PROVIDER ?? null,
      CLAUDE_CODE_GEMINI_BACKEND: env.CLAUDE_CODE_GEMINI_BACKEND ?? null,
      CLAUDE_CODE_CODEX_BACKEND: env.CLAUDE_CODE_CODEX_BACKEND ?? null,
      CLAUDE_CONFIG_DIR: env.CLAUDE_CONFIG_DIR ?? null,
      CLAUDE_TEAM_CONTROL_URL: env.CLAUDE_TEAM_CONTROL_URL ?? null,
    },
    args,
    claudePath,
  };
  logger.info(`[${teamName}] Launch runtime snapshot ${JSON.stringify(snapshot)}`);
}

function getPromptSizeSummary(prompt: string): PromptSizeSummary {
  return {
    chars: prompt.length,
    lines: prompt.length === 0 ? 0 : prompt.split(/\r?\n/g).length,
  };
}

type TeamsBaseLocation = 'configured' | 'default';

type ValidConfigProbeResult =
  | { ok: true; location: TeamsBaseLocation; configPath: string }
  | { ok: false };

function getTeamsBasePathsToProbe(): { location: TeamsBaseLocation; basePath: string }[] {
  const configured = getTeamsBasePath();
  const defaultBase = path.join(getAutoDetectedClaudeBasePath(), 'teams');
  if (path.resolve(configured) === path.resolve(defaultBase)) {
    return [{ location: 'configured', basePath: configured }];
  }
  return [
    { location: 'configured', basePath: configured },
    { location: 'default', basePath: defaultBase },
  ];
}

function logsSuggestShutdownOrCleanup(logs: string): boolean {
  const text = logs.toLowerCase();
  return (
    text.includes('shutdown') ||
    text.includes('clean up') ||
    text.includes('cleanup') ||
    text.includes('deactivate') ||
    text.includes('deactivated') ||
    text.includes('resources') ||
    // Russian keywords observed in some CLI outputs / user environments
    text.includes('очист') ||
    text.includes('очищ') ||
    text.includes('заверш') ||
    text.includes('деактив')
  );
}

function looksLikeClaudeStdoutJsonFragment(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) {
    return false;
  }
  return (
    /"type"\s*:/.test(trimmed) ||
    /"message"\s*:/.test(trimmed) ||
    /"content"\s*:/.test(trimmed) ||
    /"subtype"\s*:/.test(trimmed) ||
    /"session_id"\s*:/.test(trimmed)
  );
}

interface ProvisioningRun {
  runId: string;
  teamName: string;
  startedAt: string;
  progress: TeamProvisioningProgress;
  stdoutBuffer: string;
  stderrBuffer: string;
  /** Rolling buffer of CLI log lines (oldest -> newest). */
  claudeLogLines: string[];
  /** Last stream used for claudeLogLines markers. */
  lastClaudeLogStream: 'stdout' | 'stderr' | null;
  /** Carry buffer for stdout line splitting (CLI output). */
  stdoutLogLineBuf: string;
  /** Carry buffer for stderr line splitting (CLI output). */
  stderrLogLineBuf: string;
  /** Raw stdout parser carry that has not been newline-delimited yet. */
  stdoutParserCarry: string;
  /** Whether the current stdout parser carry is a complete JSON fragment. */
  stdoutParserCarryIsCompleteJson: boolean;
  /** Whether the current stdout parser carry looks like Claude stream-json structure. */
  stdoutParserCarryLooksLikeClaudeJson: boolean;
  /** ISO timestamp when the last CLI line was recorded. */
  claudeLogsUpdatedAt?: string;
  processKilled: boolean;
  finalizingByTimeout: boolean;
  cancelRequested: boolean;
  teamsBasePathsToProbe: { location: TeamsBaseLocation; basePath: string }[];
  child: ReturnType<typeof spawn> | null;
  timeoutHandle: NodeJS.Timeout | null;
  fsMonitorHandle: NodeJS.Timeout | null;
  onProgress: (progress: TeamProvisioningProgress) => void;
  expectedMembers: string[];
  request: TeamCreateRequest;
  allEffectiveMembers: TeamCreateRequest['members'];
  effectiveMembers: TeamCreateRequest['members'];
  launchIdentity: ProviderModelLaunchIdentity | null;
  mixedSecondaryLanes: MixedSecondaryRuntimeLaneState[];
  lastLogProgressAt: number;
  /** Monotonic ms timestamp of last stdout/stderr data. For stall detection. */
  lastDataReceivedAt: number;
  /** Monotonic ms timestamp of last stdout data only. Stall watchdog uses this
   *  instead of lastDataReceivedAt because stderr emits periodic debug logs
   *  that reset the timer without producing any user-visible output. */
  lastStdoutReceivedAt: number;
  /** Stall watchdog interval handle. Cleared in cleanupRun(). */
  stallCheckHandle: NodeJS.Timeout | null;
  /** Index of the current stall warning in provisioningOutputParts.
   *  Used to replace in-place instead of pushing duplicates. */
  stallWarningIndex: number | null;
  /** The progress.message before the stall watchdog overwrote it.
   *  Restored when stdout resumes and the stall warning is cleared. */
  preStallMessage: string | null;
  /** Monotonic ms timestamp of last api_retry message. When set, the stall
   *  watchdog defers to retry messages for progress.message (retries are
   *  more informative than the generic "CLI not responding" stall text). */
  lastRetryAt: number;
  /** Index of the latest api_retry warning block in provisioningOutputParts. */
  apiRetryWarningIndex: number | null;
  /** True after emitApiErrorWarning() fires once — prevents duplicate warnings and pre-complete false positives. */
  apiErrorWarningEmitted: boolean;
  fsPhase: 'waiting_config' | 'waiting_members' | 'waiting_tasks' | 'all_files_found';
  waitingTasksSince: number | null;
  provisioningComplete: boolean;
  /** Path to the generated MCP config file for later cleanup. */
  mcpConfigPath: string | null;
  /** Path to the deterministic bootstrap spec file for later cleanup. */
  bootstrapSpecPath: string | null;
  /** Path to the deferred first-user-task file consumed by runtime after bootstrap. */
  bootstrapUserPromptPath: string | null;
  isLaunch: boolean;
  deterministicBootstrap: boolean;
  leadRelayCapture: {
    leadName: string;
    startedAt: string;
    textParts: string[];
    settled: boolean;
    idleHandle: NodeJS.Timeout | null;
    idleMs: number;
    resolveOnce: (text: string) => void;
    rejectOnce: (error: string) => void;
    timeoutHandle: NodeJS.Timeout;
    externalChannel?: InboxMessage['externalChannel'];
    visibleUserMessageCaptured?: boolean;
  } | null;
  activeCrossTeamReplyHints: {
    toTeam: string;
    conversationId: string;
  }[];
  /** Monotonic counter for individual lead assistant messages. */
  leadMsgSeq: number;
  /** Accumulated tool_use details between text messages. */
  pendingToolCalls: ToolCallMeta[];
  /** Active runtime tool calls keyed by tool_use_id. */
  activeToolCalls: Map<string, ActiveToolCall>;
  /** True when a direct MCP cross_team_send happened and sentMessages history should refresh. */
  pendingDirectCrossTeamSendRefresh: boolean;
  /** Throttle timestamp for emitting inbox refresh events for lead text. */
  lastLeadTextEmitMs: number;
  /**
   * When set, the current stdin-injected turn is an internal "forward user DM to teammate"
   * request triggered by the UI. We suppress any lead→user echo for that turn.
   */
  silentUserDmForward: {
    target: string;
    startedAt: string;
    mode: 'user_dm' | 'member_inbox_relay';
  } | null;
  /** Safety valve: clears silentUserDmForward if turn never completes. */
  silentUserDmForwardClearHandle: NodeJS.Timeout | null;
  /** Exact inbox rows currently being bridged into the live teammate process. */
  pendingInboxRelayCandidates: PendingInboxRelayCandidate[];
  /** Accumulates assistant text during provisioning phase for live UI preview. */
  provisioningOutputParts: string[];
  /** Stable assistant message ids -> provisioningOutputParts index for in-place updates. */
  provisioningOutputIndexByMessageId: Map<string, number>;
  /** Session ID detected from stream-json output (result.session_id or message.session_id). */
  detectedSessionId: string | null;
  /** Lead process activity: 'active' during turn processing, 'idle' waiting for input, 'offline' after exit. */
  leadActivityState: LeadActivityState;
  /** Whether an auth failure retry was already attempted for this run. */
  authFailureRetried: boolean;
  /** Set to true while auth-failure respawn is in progress to prevent duplicate handling. */
  authRetryInProgress: boolean;
  /** Tracks lead process context window usage from stream-json usage data. */
  leadContextUsage: {
    promptInputTokens: number | null;
    outputTokens: number | null;
    contextUsedTokens: number | null;
    contextWindowTokens: number | null;
    promptInputSource: LeadContextUsage['promptInputSource'];
    lastUsageMessageId: string | null;
    lastEmittedAt: number;
  } | null;
  /** Saved spawn context for auth-failure respawn. */
  spawnContext: {
    claudePath: string;
    args: string[];
    cwd: string;
    env: NodeJS.ProcessEnv;
    prompt: string;
  } | null;
  /** Pending tool approval requests awaiting user response (control_request protocol). */
  pendingApprovals: Map<string, ToolApprovalRequest>;
  /** Teammate permission_request IDs already intercepted (prevents re-processing read messages). */
  processedPermissionRequestIds: Set<string>;
  /**
   * Post-compact context reinjection lifecycle.
   * - pendingPostCompactReminder: compact_boundary was received; waiting for idle to inject.
   * - postCompactReminderInFlight: the reminder turn has been injected via stdin, waiting for result.
   * - suppressPostCompactReminderOutput: true while processing a reminder turn — suppress
   *   low-value acknowledgement text so the user doesn't see "OK, I'll remember that."
   */
  pendingPostCompactReminder: boolean;
  postCompactReminderInFlight: boolean;
  suppressPostCompactReminderOutput: boolean;
  /** Gemini-only phase-2 launch hydration after the first successful provisioning turn. */
  pendingGeminiPostLaunchHydration: boolean;
  geminiPostLaunchHydrationInFlight: boolean;
  geminiPostLaunchHydrationSent: boolean;
  suppressGeminiPostLaunchHydrationOutput: boolean;
  /** Per-member spawn lifecycle statuses tracked from stream-json output. */
  memberSpawnStatuses: Map<string, MemberSpawnStatusEntry>;
  /** Agent tool_use_id -> teammate name for persistent teammate spawns. */
  memberSpawnToolUseIds: Map<string, string>;
  /** Explicit restart requests awaiting teammate rejoin or failure. */
  pendingMemberRestarts: Map<string, PendingMemberRestartContext>;
  /** Per-member latest processed lead-inbox bootstrap signal cursor for the current live run. */
  memberSpawnLeadInboxCursorByMember: Map<string, MemberSpawnInboxCursor>;
  /** Highest accepted deterministic bootstrap event sequence for this run. */
  lastDeterministicBootstrapSeq: number;
  /** Throttles config/inbox audit work triggered by frequent status polling. */
  lastMemberSpawnAuditAt: number;
  /** Throttles repeated audit warnings when config.json is temporarily unreadable. */
  lastMemberSpawnAuditConfigReadWarningAt: number;
  /** Per-member warning throttle for repeated "missing from config" logs. */
  lastMemberSpawnAuditMissingWarningAt: Map<string, number>;
}

interface MixedSecondaryRuntimeLaneState {
  laneId: string;
  providerId: 'opencode';
  member: TeamCreateRequest['members'][number];
  runId: string | null;
  state: 'queued' | 'launching' | 'finished';
  result: TeamRuntimeLaunchResult | null;
  warnings: string[];
  diagnostics: string[];
}

function createUnexpectedMixedSecondaryLaneFailureResult(input: {
  runId: string;
  teamName: string;
  memberName: string;
  message: string;
}): TeamRuntimeLaunchResult {
  return {
    runId: input.runId,
    teamName: input.teamName,
    launchPhase: 'finished',
    teamLaunchState: 'partial_failure',
    members: {
      [input.memberName]: {
        memberName: input.memberName,
        providerId: 'opencode',
        launchState: 'failed_to_start',
        agentToolAccepted: false,
        runtimeAlive: false,
        bootstrapConfirmed: false,
        hardFailure: true,
        hardFailureReason: input.message,
        diagnostics: [input.message],
      },
    },
    warnings: [],
    diagnostics: [input.message],
  };
}

type LeadActivityState = 'active' | 'idle' | 'offline';

type ProvisioningAuthSource =
  | 'anthropic_api_key'
  | 'anthropic_auth_token'
  | 'configured_api_key_missing'
  | 'codex_runtime'
  | 'gemini_runtime'
  | 'none';

interface ProvisioningEnvResolution {
  env: NodeJS.ProcessEnv;
  authSource: ProvisioningAuthSource;
  geminiRuntimeAuth: GeminiRuntimeAuthState | null;
  providerArgs?: string[];
  warning?: string;
}

interface PromptSizeSummary {
  chars: number;
  lines: number;
}

const MEMBER_LAUNCH_GRACE_MS = 90_000;
const MEMBER_BOOTSTRAP_STALL_MS = 5 * 60_000;

export function shouldWarnOnUnreadableMemberAuditConfig(params: {
  nowMs: number;
  lastWarnAt: number;
  expectedMembers: readonly string[];
  memberSpawnStatuses: ReadonlyMap<
    string,
    Pick<MemberSpawnStatusEntry, 'agentToolAccepted' | 'firstSpawnAcceptedAt'> | undefined
  >;
}): boolean {
  const { nowMs, lastWarnAt, expectedMembers, memberSpawnStatuses } = params;
  if (nowMs - lastWarnAt < MEMBER_SPAWN_AUDIT_WARNING_THROTTLE_MS) {
    return false;
  }
  return expectedMembers.some((memberName) => {
    const current = memberSpawnStatuses.get(memberName);
    if (!current?.agentToolAccepted || typeof current.firstSpawnAcceptedAt !== 'string') {
      return false;
    }
    const acceptedAtMs = Date.parse(current.firstSpawnAcceptedAt);
    return Number.isFinite(acceptedAtMs) && nowMs - acceptedAtMs >= MEMBER_LAUNCH_GRACE_MS;
  });
}

export function shouldWarnOnMissingRegisteredMember(params: {
  nowMs: number;
  lastWarnAt: number;
  graceExpired: boolean;
}): boolean {
  const { nowMs, lastWarnAt, graceExpired } = params;
  return graceExpired && nowMs - lastWarnAt >= MEMBER_SPAWN_AUDIT_WARNING_THROTTLE_MS;
}

function nowIso(): string {
  return new Date().toISOString();
}

function createInitialMemberSpawnStatusEntry(): MemberSpawnStatusEntry {
  const updatedAt = nowIso();
  return {
    status: 'offline',
    launchState: 'starting',
    agentToolAccepted: false,
    runtimeAlive: false,
    bootstrapConfirmed: false,
    hardFailure: false,
    updatedAt,
  };
}

interface LiveTeamAgentRuntimeMetadata {
  alive: boolean;
  backendType?: TeamAgentRuntimeBackendType;
  providerId?: TeamProviderId;
  agentId?: string;
  cwd?: string;
  pid?: number;
  metricsPid?: number;
  model?: string;
  tmuxPaneId?: string;
  livenessKind?: TeamAgentRuntimeLivenessKind;
  pidSource?: TeamAgentRuntimePidSource;
  processCommand?: string;
  panePid?: number;
  paneCurrentCommand?: string;
  runtimeSessionId?: string;
  runtimeLastSeenAt?: string;
  runtimeDiagnostic?: string;
  runtimeDiagnosticSeverity?: TeamAgentRuntimeDiagnosticSeverity;
  diagnostics?: string[];
}

function isNeverSpawnedDuringLaunchReason(reason?: string): boolean {
  return reason?.trim() === 'Teammate was never spawned during launch.';
}

function collectRuntimeLaunchFailureDiagnostics(
  result: TeamRuntimeLaunchResult,
  memberName: string
): string[] {
  const member = result.members[memberName];
  return [...(member?.diagnostics ?? []), member?.hardFailureReason, ...result.diagnostics].filter(
    (value): value is string => typeof value === 'string' && value.trim().length > 0
  );
}

function isReconciliableOpenCodeUnknownOutcome(diagnostics: readonly string[]): boolean {
  return diagnostics.some((diagnostic) =>
    /outcome must be reconciled before retry/i.test(diagnostic)
  );
}

function isDefinitiveOpenCodePreLaunchFailure(
  result: TeamRuntimeLaunchResult,
  memberName: string
): boolean {
  const member = result.members[memberName];
  if (!member) {
    return false;
  }
  const hardFailed = member.launchState === 'failed_to_start' || member.hardFailure === true;
  if (!hardFailed) {
    return false;
  }
  const runtimeMaterialized =
    member.agentToolAccepted ||
    member.runtimeAlive ||
    member.bootstrapConfirmed ||
    typeof member.sessionId === 'string';
  if (runtimeMaterialized) {
    return false;
  }
  return !isReconciliableOpenCodeUnknownOutcome(
    collectRuntimeLaunchFailureDiagnostics(result, memberName)
  );
}

function isLaunchGraceWindowFailureReason(reason?: string): boolean {
  return reason?.trim() === 'Teammate did not join within the launch grace window.';
}

function isConfigRegistrationFailureReason(reason?: string): boolean {
  return (
    reason?.trim() ===
    'Teammate was not registered in config.json during launch. Persistent spawn failed.'
  );
}

function isTmuxNoServerRunningError(error: unknown): boolean {
  const text = error instanceof Error ? error.message : String(error ?? '');
  return (
    /no server running on /i.test(text) ||
    /error connecting to .*no such file or directory/i.test(text)
  );
}

function isAutoClearableLaunchFailureReason(reason?: string): boolean {
  return (
    isNeverSpawnedDuringLaunchReason(reason) ||
    isLaunchGraceWindowFailureReason(reason) ||
    isConfigRegistrationFailureReason(reason)
  );
}

function summarizeMemberSpawnStatusRecord(
  expectedMembers: readonly string[],
  statuses: Record<string, MemberSpawnStatusEntry>
): PersistedTeamLaunchSummary {
  let confirmedCount = 0;
  let pendingCount = 0;
  let failedCount = 0;
  let skippedCount = 0;
  let runtimeAlivePendingCount = 0;
  let shellOnlyPendingCount = 0;
  let runtimeProcessPendingCount = 0;
  let runtimeCandidatePendingCount = 0;
  let noRuntimePendingCount = 0;
  let permissionPendingCount = 0;
  const memberNames = Array.from(new Set([...expectedMembers, ...Object.keys(statuses)]));

  for (const memberName of memberNames) {
    const entry = statuses[memberName];
    if (!entry) {
      pendingCount += 1;
      continue;
    }
    if (entry.launchState === 'confirmed_alive') {
      confirmedCount += 1;
      continue;
    }
    if (entry.launchState === 'skipped_for_launch' || entry.skippedForLaunch === true) {
      skippedCount += 1;
      continue;
    }
    if (entry.launchState === 'failed_to_start') {
      failedCount += 1;
      continue;
    }
    pendingCount += 1;
    if (entry.runtimeAlive) {
      runtimeAlivePendingCount += 1;
    }
    if (entry.launchState === 'runtime_pending_permission') {
      permissionPendingCount += 1;
    }
    if (entry.livenessKind === 'shell_only') {
      shellOnlyPendingCount += 1;
    } else if (entry.livenessKind === 'runtime_process') {
      runtimeProcessPendingCount += 1;
    } else if (entry.livenessKind === 'runtime_process_candidate') {
      runtimeCandidatePendingCount += 1;
    } else if (
      entry.livenessKind === 'not_found' ||
      entry.livenessKind === 'stale_metadata' ||
      entry.livenessKind === 'registered_only'
    ) {
      noRuntimePendingCount += 1;
    }
  }

  return {
    confirmedCount,
    pendingCount,
    failedCount,
    skippedCount,
    runtimeAlivePendingCount,
    shellOnlyPendingCount,
    runtimeProcessPendingCount,
    runtimeCandidatePendingCount,
    noRuntimePendingCount,
    permissionPendingCount,
  };
}

function buildRestartStillRunningReason(memberName: string): string {
  return (
    `Restart for teammate "${memberName}" was skipped because the previous runtime still appears ` +
    `to be active. The requested settings may not have been applied.`
  );
}

function buildRestartDuplicateUnconfirmedReason(memberName: string, rawReason?: string): string {
  const suffix = rawReason?.trim()
    ? ` Agent returned duplicate_skipped with unrecognized reason "${rawReason.trim()}".`
    : ' Agent returned duplicate_skipped without a reason.';
  return (
    `Restart for teammate "${memberName}" could not be confirmed and may not have applied.` + suffix
  );
}

function buildRestartGraceTimeoutReason(memberName: string): string {
  return `Teammate "${memberName}" did not rejoin within the restart grace window.`;
}

interface PendingMemberRestartContext {
  requestedAt: string;
  desired: Pick<
    TeamCreateRequest['members'][number],
    'name' | 'role' | 'workflow' | 'isolation' | 'providerId' | 'model' | 'effort'
  >;
}

function normalizeTeamAgentRuntimeBackendType(
  value: string | undefined,
  isLead: boolean
): TeamAgentRuntimeBackendType | undefined {
  if (isLead) return 'lead';
  const normalized = value?.trim().toLowerCase();
  if (normalized === 'tmux' || normalized === 'iterm2' || normalized === 'in-process') {
    return normalized;
  }
  return normalized ? 'process' : undefined;
}

function matchesMemberNameOrBase(candidateName: string, memberName: string): boolean {
  if (candidateName === memberName) {
    return true;
  }
  const parsed = parseNumericSuffixName(candidateName);
  return parsed !== null && parsed.suffix >= 2 && parsed.base === memberName;
}

function matchesTeamMemberIdentity(leftName: string, rightName: string): boolean {
  return (
    matchesMemberNameOrBase(leftName, rightName) || matchesMemberNameOrBase(rightName, leftName)
  );
}

function matchesObservedMemberNameForExpected(observedName: string, expectedName: string): boolean {
  return matchesMemberNameOrBase(observedName, expectedName);
}

function matchesExactTeamMemberName(candidateName: string, memberName: string): boolean {
  const left = candidateName.trim().toLowerCase();
  const right = memberName.trim().toLowerCase();
  return left.length > 0 && left === right;
}

interface MemberSpawnInboxCursor {
  timestamp: string;
  messageId: string;
}

type LeadInboxMemberSpawnMessage = InboxMessage & { messageId: string };
type LeadInboxLaunchReconcileMessage = Pick<
  InboxMessage,
  'from' | 'text' | 'timestamp' | 'messageId'
>;

function compareMemberSpawnInboxCursor(
  left: MemberSpawnInboxCursor,
  right: MemberSpawnInboxCursor
): number {
  const leftMs = Date.parse(left.timestamp);
  const rightMs = Date.parse(right.timestamp);
  const leftValid = Number.isFinite(leftMs);
  const rightValid = Number.isFinite(rightMs);

  if (leftValid && rightValid && leftMs !== rightMs) {
    return leftMs - rightMs;
  }
  if (leftValid !== rightValid) {
    return leftValid ? -1 : 1;
  }
  return left.messageId.localeCompare(right.messageId);
}

function toMemberSpawnInboxCursor(
  message: Pick<InboxMessage, 'timestamp' | 'messageId'>
): MemberSpawnInboxCursor | null {
  const messageId = typeof message.messageId === 'string' ? message.messageId.trim() : '';
  if (!messageId) {
    return null;
  }
  return {
    timestamp: message.timestamp,
    messageId,
  };
}

function maxMemberSpawnInboxCursor(
  left: MemberSpawnInboxCursor | undefined,
  right: MemberSpawnInboxCursor
): MemberSpawnInboxCursor {
  if (!left) {
    return right;
  }
  return compareMemberSpawnInboxCursor(left, right) >= 0 ? left : right;
}

function isMemberSpawnHeartbeatTimestampNewer(
  previous: string | undefined,
  incoming: string | undefined
): boolean {
  const normalizedIncoming = incoming?.trim();
  if (!normalizedIncoming) {
    return false;
  }
  const normalizedPrevious = previous?.trim();
  if (!normalizedPrevious) {
    return true;
  }

  const previousMs = Date.parse(normalizedPrevious);
  const incomingMs = Date.parse(normalizedIncoming);
  if (Number.isFinite(previousMs) && Number.isFinite(incomingMs)) {
    return incomingMs > previousMs;
  }
  return normalizedIncoming > normalizedPrevious;
}

function stripWrappedCliFlagValue(raw: string | undefined): string | undefined {
  const trimmed = raw?.trim();
  if (!trimmed) {
    return undefined;
  }
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    const unwrapped = trimmed.slice(1, -1).trim();
    return unwrapped.length > 0 ? unwrapped : undefined;
  }
  return trimmed;
}

function extractCliFlagValue(command: string, flagName: string): string | undefined {
  const escapedFlag = flagName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`(?:^|\\s)${escapedFlag}\\s+("([^"]*)"|'([^']*)'|([^\\s]+))`).exec(
    command
  );
  if (!match) {
    return undefined;
  }
  return stripWrappedCliFlagValue(match[2] ?? match[3] ?? match[4] ?? match[1]);
}

export function shouldAcceptDeterministicBootstrapEvent(params: {
  runId: string;
  teamName: string;
  lastSeq: number;
  msg: Record<string, unknown>;
}): { accept: boolean; nextSeq: number } {
  const msgRunId = typeof params.msg.run_id === 'string' ? params.msg.run_id.trim() : '';
  if (msgRunId && msgRunId !== params.runId) {
    return { accept: false, nextSeq: params.lastSeq };
  }

  const msgTeamName = typeof params.msg.team_name === 'string' ? params.msg.team_name.trim() : '';
  if (msgTeamName && msgTeamName !== params.teamName) {
    return { accept: false, nextSeq: params.lastSeq };
  }

  const seq = typeof params.msg.seq === 'number' ? params.msg.seq : NaN;
  if (Number.isFinite(seq)) {
    if (!Number.isInteger(seq) || seq <= params.lastSeq) {
      return { accept: false, nextSeq: params.lastSeq };
    }
    return { accept: true, nextSeq: seq };
  }

  return { accept: true, nextSeq: params.lastSeq };
}

function deriveMemberLaunchState(entry: {
  agentToolAccepted?: boolean;
  runtimeAlive?: boolean;
  bootstrapConfirmed?: boolean;
  hardFailure?: boolean;
  skippedForLaunch?: boolean;
  pendingPermissionRequestIds?: string[];
}): MemberLaunchState {
  if (entry.skippedForLaunch) {
    return 'skipped_for_launch';
  }
  if (entry.hardFailure) {
    return 'failed_to_start';
  }
  if (entry.bootstrapConfirmed) {
    return 'confirmed_alive';
  }
  if ((entry.pendingPermissionRequestIds?.length ?? 0) > 0) {
    return 'runtime_pending_permission';
  }
  if (entry.runtimeAlive || entry.agentToolAccepted) {
    return 'runtime_pending_bootstrap';
  }
  return 'starting';
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForPidsToExit(
  pids: readonly number[],
  opts: { timeoutMs: number; pollMs: number }
): Promise<number[]> {
  if (pids.length === 0) {
    return [];
  }

  const deadline = Date.now() + opts.timeoutMs;
  let remainingPids = [...new Set(pids)];
  while (Date.now() < deadline) {
    remainingPids = remainingPids.filter((pid) => isProcessAlive(pid));
    if (remainingPids.length === 0) {
      return [];
    }
    await sleep(opts.pollMs);
  }

  return remainingPids;
}

async function waitForTmuxPanesToExit(
  paneIds: readonly string[],
  opts: { timeoutMs: number; pollMs: number }
): Promise<string[]> {
  const normalizedPaneIds = [...new Set(paneIds.map((paneId) => paneId.trim()).filter(Boolean))];
  if (normalizedPaneIds.length === 0) {
    return [];
  }

  const deadline = Date.now() + opts.timeoutMs;
  let remainingPaneIds = normalizedPaneIds;
  let lastError: unknown = null;
  while (Date.now() < deadline) {
    let livePanePidById: Map<string, number>;
    try {
      livePanePidById = await listTmuxPanePidsForCurrentPlatform(remainingPaneIds);
      lastError = null;
    } catch (error) {
      if (isTmuxNoServerRunningError(error)) {
        return [];
      }
      lastError = error;
      await sleep(opts.pollMs);
      continue;
    }
    remainingPaneIds = remainingPaneIds.filter((paneId) => livePanePidById.has(paneId));
    if (remainingPaneIds.length === 0) {
      return [];
    }
    await sleep(opts.pollMs);
  }

  if (lastError) {
    throw lastError instanceof Error ? lastError : new Error(getErrorMessage(lastError));
  }
  return remainingPaneIds;
}

async function waitForChildProcessToExit(
  child: ChildProcess | null | undefined,
  timeoutMs: number
): Promise<void> {
  if (!child?.pid || !isProcessAlive(child.pid)) {
    return;
  }

  await new Promise<void>((resolve) => {
    let settled = false;
    let timeoutHandle: ReturnType<typeof setTimeout> | null = null;

    const finish = (): void => {
      if (settled) {
        return;
      }
      settled = true;
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
      child.off('close', finish);
      child.off('exit', finish);
      child.off('error', finish);
      resolve();
    };

    timeoutHandle = setTimeout(finish, timeoutMs);
    child.once('close', finish);
    child.once('exit', finish);
    child.once('error', finish);
  });
}

async function tryReadRegularFileUtf8(
  filePath: string,
  opts: { timeoutMs: number; maxBytes: number }
): Promise<string | null> {
  let stat: fs.Stats;
  try {
    stat = await fs.promises.stat(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    return null;
  }

  if (!stat.isFile() || stat.size > opts.maxBytes) {
    return null;
  }

  try {
    return await readFileUtf8WithTimeout(filePath, opts.timeoutMs);
  } catch (error) {
    if (error instanceof FileReadTimeoutError) {
      return null;
    }
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    return null;
  }
}

async function ensureCwdExists(cwd: string): Promise<void> {
  await fs.promises.mkdir(cwd, { recursive: true });
  const stat = await fs.promises.stat(cwd);
  if (!stat.isDirectory()) {
    throw new Error('cwd must be a directory');
  }
}

function isMissingCwdSpawnError(message: string): boolean {
  const lower = message.toLowerCase();
  return lower.includes('spawn ') && lower.includes(' enoent');
}

async function pathExistsAsDirectory(candidatePath: string): Promise<boolean> {
  try {
    const stat = await fs.promises.stat(candidatePath);
    return stat.isDirectory();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return false;
    }
    throw error;
  }
}

/** @deprecated Use wrapAgentBlock from @shared/constants/agentBlocks instead. */
const wrapInAgentBlock = wrapAgentBlock;

function indentMultiline(text: string, indent: string): string {
  return text
    .split(/\r?\n/g)
    .map((line) => `${indent}${line}`)
    .join('\n');
}

function formatWorkflowBlock(workflow: string, indent: string): string {
  const trimmed = workflow.trim();
  if (trimmed.length === 0) return '';
  const body = indentMultiline(trimmed, indent);
  return `\n${indent}---BEGIN WORKFLOW---\n${body}\n${indent}---END WORKFLOW---`;
}

type TeamMemberInput = TeamCreateRequest['members'][number];

function normalizeTeamMemberProviderId(providerId: unknown): TeamProviderId | undefined {
  return normalizeOptionalTeamProviderId(providerId);
}

function normalizeTeamProviderLike(providerId: unknown): TeamProviderId | undefined {
  return normalizeOptionalTeamProviderId(
    typeof providerId === 'string' ? providerId.trim().toLowerCase() : providerId
  );
}

function buildEffectiveTeamMemberSpec(
  member: TeamMemberInput,
  defaults: {
    providerId?: TeamProviderId;
    model?: string;
    effort?: TeamCreateRequest['effort'];
  }
): TeamMemberInput {
  const memberProviderId = normalizeTeamMemberProviderId(member.providerId);
  const defaultProviderId = normalizeTeamMemberProviderId(defaults.providerId);
  const effectiveProviderId = memberProviderId ?? defaultProviderId ?? 'anthropic';
  const model =
    getExplicitLaunchModelSelection(member.model) ||
    (memberProviderId == null || memberProviderId === defaultProviderId
      ? getExplicitLaunchModelSelection(defaults.model)
      : undefined) ||
    undefined;
  const effort =
    member.effort ??
    (memberProviderId == null || memberProviderId === defaultProviderId
      ? defaults.effort
      : undefined);
  const sanitizedEffort = sanitizeAnthropicEffortForModel(effectiveProviderId, model, effort);

  return {
    ...member,
    providerId: effectiveProviderId,
    model,
    effort: sanitizedEffort,
  };
}

function buildEffectiveTeamMemberSpecs(
  members: TeamCreateRequest['members'],
  defaults: {
    providerId?: TeamProviderId;
    model?: string;
    effort?: TeamCreateRequest['effort'];
  }
): TeamCreateRequest['members'] {
  return members.map((member) => buildEffectiveTeamMemberSpec(member, defaults));
}

function shouldSkipResumeForProviderRuntimeChange(
  request: Pick<TeamLaunchRequest, 'providerId' | 'providerBackendId' | 'model'>,
  config: Record<string, unknown>,
  persistedProviderBackendId?: string | null
): { skip: boolean; reason?: string } {
  const providerId = normalizeTeamMemberProviderId(request.providerId);
  if (providerId !== 'gemini' && providerId !== 'codex') {
    return { skip: false };
  }

  const requestedBackendId =
    migrateProviderBackendId(providerId, request.providerBackendId?.trim()) || null;
  const previousBackendId =
    migrateProviderBackendId(providerId, persistedProviderBackendId?.trim()) || null;
  if (requestedBackendId && previousBackendId && requestedBackendId !== previousBackendId) {
    return {
      skip: true,
      reason: `runtime backend changed (${previousBackendId} -> ${requestedBackendId})`,
    };
  }

  const members = Array.isArray(config.members)
    ? (config.members as Record<string, unknown>[])
    : [];
  const lead =
    members.find((member) => isLeadMember(member)) ??
    members.find((member) => {
      const name = typeof member?.name === 'string' ? member.name.trim().toLowerCase() : '';
      return isLeadMemberName(name);
    });
  if (!lead) {
    return { skip: false };
  }

  const currentLeadProviderId =
    normalizeTeamMemberProviderId(
      typeof lead.providerId === 'string'
        ? lead.providerId
        : typeof lead.provider === 'string'
          ? lead.provider
          : providerId
    ) ?? providerId;
  const requestedModel = request.model?.trim() || '';
  const currentLeadModel = typeof lead.model === 'string' ? lead.model.trim() : '';

  if (currentLeadProviderId !== providerId) {
    return {
      skip: true,
      reason: `provider changed (${currentLeadProviderId} -> ${providerId})`,
    };
  }

  if (requestedModel && currentLeadModel && requestedModel !== currentLeadModel) {
    return {
      skip: true,
      reason: `model changed (${currentLeadModel} -> ${requestedModel})`,
    };
  }

  return { skip: false };
}

function buildMembersPrompt(members: TeamCreateRequest['members']): string {
  return members
    .map((member) => {
      const rolePart = member.role?.trim() ? ` (role: ${member.role.trim()})` : '';
      const providerPart =
        member.providerId && member.providerId !== 'anthropic'
          ? ` [provider: ${member.providerId}]`
          : '';
      const modelPart = member.model?.trim() ? ` [model: ${member.model.trim()}]` : '';
      const effortPart = member.effort ? ` [effort: ${member.effort}]` : '';
      const isolationPart = member.isolation === 'worktree' ? ' [isolation: worktree]' : '';
      const workflowPart = member.workflow?.trim()
        ? `\n     Workflow/instructions:${formatWorkflowBlock(member.workflow, '       ')}`
        : '';
      return `- ${member.name}${rolePart}${providerPart}${modelPart}${effortPart}${isolationPart}${workflowPart}`;
    })
    .join('\n');
}

/** Compact roster: name + role only, no workflow details. Used for post-compact reminders. */
function buildCompactMembersRoster(members: TeamCreateRequest['members']): string {
  return members
    .map((member) => {
      const rolePart = member.role?.trim() ? ` (${member.role.trim()})` : '';
      return `- ${member.name}${rolePart}`;
    })
    .join('\n');
}

function buildTeammateAgentBlockReminder(): string {
  return [
    `隐藏内部指令规则（重要）：`,
    `- 如果你向其他 agent/成员发送内部操作指令，且这些内容不应在人类用户界面中展示，只把隐藏部分包在：`,
    `  ${AGENT_BLOCK_OPEN}`,
    `  ... 仅内部可见的隐藏指令 ...`,
    `  ${AGENT_BLOCK_CLOSE}`,
    `- 正常的人类可读协作内容放在该块外。`,
    `- 发给 "user" 的消息绝对不要使用 agent-only 块。`,
  ].join('\n');
}

function extractHeartbeatTimestamp(text: string, fallback?: string): string | undefined {
  const trimmed = text.trim();
  if (!trimmed) return fallback?.trim() || undefined;
  try {
    const parsed = JSON.parse(trimmed) as { timestamp?: unknown };
    if (typeof parsed.timestamp === 'string' && parsed.timestamp.trim().length > 0) {
      return parsed.timestamp.trim();
    }
  } catch {
    // Best-effort only. Non-JSON teammate messages still use the inbox timestamp fallback.
  }
  return fallback?.trim() || undefined;
}

function extractBootstrapFailureReason(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  if (isBootstrapInstructionPrompt(trimmed)) return null;
  const lower = trimmed.toLowerCase();
  if (isMemberBriefingUnavailableFallbackSignal(lower)) return null;
  const looksLikeBootstrapFailure =
    lower.includes('bootstrap failed') ||
    lower.includes('bootstrap failure') ||
    lower.includes('bootstrap error') ||
    lower.includes('bootstrap не удался') ||
    lower.includes('сбой bootstrap') ||
    ((lower.includes('member') || lower.includes('член')) && lower.includes('not found')) ||
    (lower.includes('не найден') &&
      (lower.includes('член') || lower.includes('member') || lower.includes('inbox'))) ||
    lower.includes('lead_briefing tool is not available') ||
    lower.includes('lead_briefing tool not found') ||
    lower.includes('no such tool available: mcp__agent_teams__lead_briefing') ||
    lower.includes('agent calls that include team_name must also include name') ||
    (lower.includes('lead_briefing') &&
      (lower.includes('not available') ||
        lower.includes('not found') ||
        lower.includes('lookup failure') ||
        lower.includes('validation error') ||
        lower.includes('api error') ||
        lower.includes('empty content') ||
        lower.includes('unspecified error'))) ||
    lower.includes('model is not supported') ||
    lower.includes('model is not available') ||
    lower.includes('model not available') ||
    lower.includes('model unavailable') ||
    lower.includes('model not found') ||
    lower.includes('unknown model') ||
    lower.includes('invalid model') ||
    lower.includes('unsupported model') ||
    lower.includes('not supported when using codex with a chatgpt account') ||
    lower.includes('please check the provided tool list');
  if (!looksLikeBootstrapFailure) return null;
  return trimmed.slice(0, 280);
}

function isMemberBriefingUnavailableFallbackSignal(lowerText: string): boolean {
  if (!lowerText.includes('member_briefing')) return false;
  return (
    lowerText.includes('not available') ||
    lowerText.includes('not found') ||
    lowerText.includes('unavailable') ||
    lowerText.includes('no such tool available') ||
    lowerText.includes('工具不可用') ||
    lowerText.includes('不可用') ||
    lowerText.includes('未连接') ||
    lowerText.includes('未配置') ||
    lowerText.includes('not connected') ||
    lowerText.includes('not configured')
  );
}

function isBootstrapInstructionPrompt(text: string): boolean {
  const normalized = text.replace(/\s+/g, ' ').trim().toLowerCase();
  if (!normalized.startsWith('you are bootstrapping into team ')) {
    return false;
  }
  return (
    normalized.includes('your first action is to call the mcp tool') &&
    (normalized.includes('member_briefing') || normalized.includes('lead_briefing'))
  );
}

function isBootstrapTranscriptSuccessText(
  text: string,
  teamName: string,
  memberName: string
): boolean {
  const normalizedText = text.replace(/\s+/g, ' ').trim().toLowerCase();
  if (!normalizedText) {
    return false;
  }

  const normalizedTeamName = teamName.trim().toLowerCase();
  const normalizedMemberName = memberName.trim().toLowerCase();
  if (!normalizedTeamName || !normalizedMemberName) {
    return false;
  }

  if (
    normalizedText.startsWith(
      `member briefing for ${normalizedMemberName} on team "${normalizedTeamName}" (${normalizedTeamName}).`
    ) ||
    normalizedText.startsWith(
      `member briefing for ${normalizedMemberName} on team '${normalizedTeamName}' (${normalizedTeamName}).`
    )
  ) {
    return true;
  }

  return (
    normalizedText.includes(`bootstrap выполнен для \`${normalizedMemberName}\``) &&
    normalizedText.includes(`команде \`${normalizedTeamName}\``)
  );
}

function isBootstrapTranscriptContextText(
  text: string,
  teamName: string,
  memberName: string
): boolean {
  const normalizedText = text.replace(/\s+/g, ' ').trim().toLowerCase();
  const normalizedTeamName = teamName.trim().toLowerCase();
  const normalizedMemberName = memberName.trim().toLowerCase();
  if (!normalizedText || !normalizedTeamName || !normalizedMemberName) {
    return false;
  }
  if (
    !normalizedText.includes(normalizedTeamName) ||
    !normalizedText.includes(normalizedMemberName)
  ) {
    return false;
  }
  return (
    normalizedText.includes('bootstrap') ||
    normalizedText.includes('bootstrapping') ||
    normalizedText.includes('member briefing') ||
    normalizedText.includes('task briefing')
  );
}

function extractTranscriptTextContent(value: unknown): string[] {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed ? [trimmed] : [];
  }
  if (!Array.isArray(value)) {
    return [];
  }
  const parts: string[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const record = item as { type?: unknown; text?: unknown; content?: unknown };
    if (record.type === 'text' && typeof record.text === 'string' && record.text.trim()) {
      parts.push(record.text.trim());
      continue;
    }
    parts.push(...extractTranscriptTextContent(record.content));
  }
  return parts;
}

function extractTranscriptMessageText(record: unknown): string | null {
  if (!record || typeof record !== 'object') {
    return null;
  }
  const normalizedRecord = record as {
    text?: unknown;
    content?: unknown;
    message?: unknown;
    toolUseResult?: unknown;
  };
  if (typeof normalizedRecord.text === 'string' && normalizedRecord.text.trim()) {
    return normalizedRecord.text.trim();
  }
  const fromContent = extractTranscriptTextContent(normalizedRecord.content);
  if (fromContent.length > 0) {
    return fromContent.join('\n');
  }
  const fromToolUseResult = extractTranscriptTextContent(normalizedRecord.toolUseResult);
  if (fromToolUseResult.length > 0) {
    return fromToolUseResult.join('\n');
  }
  if (normalizedRecord.message) {
    return extractTranscriptMessageText(normalizedRecord.message);
  }
  return null;
}

function normalizeMemberDiagnosticText(memberName: string, text: string): string {
  return `${memberName}: ${text.trim()}`;
}

function shouldUseGeminiStagedLaunch(providerId: TeamProviderId | undefined): boolean {
  return resolveTeamProviderId(providerId) === 'gemini';
}

function buildGeminiMemberSpawnPrompt(
  member: TeamCreateRequest['members'][number],
  displayName: string,
  teamName: string,
  leadName: string
): string {
  const role = member.role?.trim() || 'team member';
  const providerLine =
    member.providerId && member.providerId !== 'anthropic'
      ? `\nProvider override: ${member.providerId}.`
      : '';
  const modelLine = member.model?.trim() ? `\nModel override: ${member.model.trim()}.` : '';
  const effortLine = member.effort ? `\nEffort override: ${member.effort}.` : '';
  const workflowBlock = member.workflow?.trim() ? `\nWorkflow:\n${member.workflow.trim()}` : '';

  return `你是 ${member.name}，是团队 "${displayName}" (${teamName}) 中的 ${role}。${providerLine}${modelLine}${effortLine}${workflowBlock}

${getAgentLanguageInstruction()}
你的第一步：调用 MCP 工具 member_briefing，参数如下：
{ teamName: "${teamName}", memberName: "${member.name}" }
直接调用 member_briefing。不要使用 Agent、任何子 agent 或委托助手来完成这一步。
如果工具搜索提示 agent-teams 仍在连接，请短暂等待，并且最多重试一次工具搜索。
如果重试一次后 member_briefing 仍不可用，请用 SendMessage 发给 "${leadName}"，只发送一句简短自然语言，包含准确错误文本，然后停止本轮并等待。不要只发送 "bootstrap failed"。
报告 bootstrap 失败后，不要继续搜索 member_briefing、检查任务或重复发送状态/空闲消息。
${getCanonicalSendMessageFieldRule()}
${getVisibleTaskReferenceFormattingRule()}
正确示例：
${buildCanonicalSendMessageExample({ to: leadName, summary: 'bootstrap error', message: 'exact error text' })}
member_briefing 成功后，除非有真实阻塞、问题或任务结果，否则保持安静。不要发送原始工具输出、JSON、字典/对象 dump 或内部状态 payload。
- 审查流程规则：审查发生在同一个工作任务上。如果任务 #X 需要审查且审查人已存在或已指定，负责人先完成 #X 并通过 review_request 送审；审查人在 #X 上执行 review_start，然后执行 review_approve/review_request_changes。如果没有审查人，请让 #X 保持 completed。不要创建单独的 "review task"。`;
}

function buildGeminiReconnectMemberSpawnPrompt(
  member: TeamCreateRequest['members'][number],
  teamName: string,
  leadName: string
): string {
  const role = member.role?.trim() || 'team member';
  const providerLine =
    member.providerId && member.providerId !== 'anthropic'
      ? `\nProvider override: ${member.providerId}.`
      : '';
  const modelLine = member.model?.trim() ? `\nModel override: ${member.model.trim()}.` : '';
  const effortLine = member.effort ? `\nEffort override: ${member.effort}.` : '';
  const workflowBlock = member.workflow?.trim() ? `\nWorkflow:\n${member.workflow.trim()}` : '';

  return `你是 ${member.name}，是团队 "${teamName}" (${teamName}) 中的 ${role}。${providerLine}${modelLine}${effortLine}${workflowBlock}

${getAgentLanguageInstruction()}
团队刚刚在重启后重新连接。
你的第一步：调用 MCP 工具 member_briefing，参数如下：
{ teamName: "${teamName}", memberName: "${member.name}" }
直接调用 member_briefing。不要使用 Agent、任何子 agent 或委托助手来完成这一步。
如果工具搜索提示 agent-teams 仍在连接，请短暂等待，并且最多重试一次工具搜索。
如果重试一次后 member_briefing 仍不可用，请用 SendMessage 发给 "${leadName}"，只发送一句简短自然语言，包含准确错误文本，然后停止本轮并等待。不要只发送 "bootstrap failed"。
报告 bootstrap 失败后，不要继续搜索 member_briefing、检查任务或重复发送状态/空闲消息。
${getCanonicalSendMessageFieldRule()}
${getVisibleTaskReferenceFormattingRule()}
正确示例：
${buildCanonicalSendMessageExample({ to: leadName, summary: 'bootstrap error', message: 'exact error text' })}
member_briefing 成功后，除非有真实阻塞、问题或任务结果，否则保持安静。不要发送原始工具输出、JSON、字典/对象 dump 或内部状态 payload。
- 审查流程规则：审查发生在同一个工作任务上。如果任务 #X 需要审查且审查人已存在或已指定，负责人先完成 #X 并通过 review_request 送审；审查人在 #X 上执行 review_start，然后执行 review_approve/review_request_changes。如果没有审查人，请让 #X 保持 completed。不要创建单独的 "review task"。`;
}

function buildMemberReviewFlowReminder(): string {
  return [
    '- 审查流程规则：审查是同一个工作任务上的状态流转，不是单独任务。',
    '- 如果你的任务 #X 需要审查且审查人已存在或已指定，请先完成 #X 上的工作，调用 task_complete，然后对 #X 使用 review_request 发给该审查人。如果没有审查人，请让 #X 保持 completed。不要创建单独的 "review task"。',
    '- 如果你是任务 #X 的审查人，请先对 #X 调用 review_start，然后在 #X 本身调用 review_approve 或 review_request_changes。',
    '- 如果审查要求修改，请恢复/修复同一个任务 #X；准备好后先 task_complete #X，再通过 review_request 把 #X 送回审查。',
  ].join('\n');
}

function buildMemberSpawnPrompt(
  member: TeamCreateRequest['members'][number],
  displayName: string,
  teamName: string,
  leadName: string
): string {
  const role = member.role?.trim() || 'team member';
  const providerLine =
    member.providerId && member.providerId !== 'anthropic'
      ? `\nProvider override for this teammate: ${member.providerId}.`
      : '';
  const modelLine = member.model?.trim()
    ? `\nModel override for this teammate: ${member.model.trim()}.`
    : '';
  const effortLine = member.effort ? `\nEffort override for this teammate: ${member.effort}.` : '';
  const workflowBlock = member.workflow?.trim()
    ? `\n\nYour workflow and how you should behave:${formatWorkflowBlock(member.workflow, '')}`
    : '';
  return `You are ${member.name}, the ${role} on team "${displayName}" (${teamName}).${providerLine}${modelLine}${effortLine}${workflowBlock}

Language: reply to users and teammates in Chinese.
First action: call the MCP tool member_briefing with { teamName: "${teamName}", memberName: "${member.name}" }.
Call member_briefing yourself. Do not use another Agent/subagent for that step.
If member_briefing is temporarily unavailable, retry tool discovery once. If it is still unavailable, use these embedded rules and stay quiet when there is no task.

SendMessage discipline:
- To the lead, always use to="${leadName}" and the real fields to, summary, message.
- Visible task refs must be plain #<short-id>. Do not hand-write task:// markdown links. Use taskRefs metadata when available.
- Never hand-write [#abcd1234](task://...) in visible text.
- Do not send raw JSON/tool dumps/internal state. Write short human-readable Chinese.

After member_briefing:
- Do not send ready/online/status-only chatter.
- Use task_briefing as your work queue; task_list is only for browsing/searching.
- Act only on Actionable items. Awareness items are context only.
- Reply to task comments with task_add_comment on the same task.
- Before implementation after a new task comment: comment what you will do, task_start, work, comment result, task_complete.
- Before task_complete, post your deliverable as a task comment. A private SendMessage is not a substitute.
- After task_complete, SendMessage the lead with #<short-id>, a 2-4 sentence summary, and the short comment id.
- Review stays on the existing task: review_start, review_approve, review_request_changes. Do not create a separate review task.
- If no task/blocker exists, end the turn silently.`;
}

function buildReconnectMemberSpawnPrompt(
  member: TeamCreateRequest['members'][number],
  teamName: string,
  leadName: string,
  hasTasks: boolean
): string {
  const role = member.role?.trim() || 'team member';
  const providerLine =
    member.providerId && member.providerId !== 'anthropic'
      ? `\n     Provider override for this teammate: ${member.providerId}.`
      : '';
  const modelLine = member.model?.trim()
    ? `\n     Model override for this teammate: ${member.model.trim()}.`
    : '';
  const effortLine = member.effort
    ? `\n     Effort override for this teammate: ${member.effort}.`
    : '';
  const workflowBlock = member.workflow?.trim()
    ? `\n\nYour workflow and how you should behave:${formatWorkflowBlock(member.workflow, '     ')}`
    : '';
  const providerArgLine =
    member.providerId && member.providerId !== 'anthropic'
      ? `   - provider: "${member.providerId}"\n`
      : '';
  const modelArgLine = member.model?.trim() ? `   - model: "${member.model.trim()}"\n` : '';
  const effortArgLine = member.effort ? `   - effort: "${member.effort}"\n` : '';
  return `   For "${member.name}":
${providerArgLine}${modelArgLine}${effortArgLine}   - prompt:
     You are ${member.name}, the ${role} on team "${teamName}" (${teamName}).${providerLine}${modelLine}${effortLine}${workflowBlock}
     Language: reply to users and teammates in Chinese.
     This is a reconnect after restart. ${hasTasks ? 'You may have existing tasks from the prior session.' : 'You currently have no assigned tasks.'}
     First action: call member_briefing with { teamName: "${teamName}", memberName: "${member.name}" }.
     Call member_briefing yourself; do not delegate this bootstrap step.
     If member_briefing is unavailable after one retry, use these embedded rules and stay quiet when there is no task.
     SendMessage to the lead must use to="${leadName}" and the real fields to, summary, message.
     Visible task refs must be plain #<short-id>; never hand-write [#abcd1234](task://...) links; use taskRefs metadata when available.
     After briefing, do not send ready/online chatter. Use task_briefing as the work queue; task_list is only for browsing.
     Reply to task comments on the same task. Before task_complete, post your deliverable as a task comment.
     Review stays on the existing task; do not create a separate review task.
     If no actionable task/blocker exists, end the turn silently.`;
}

function buildAgentToolArgsSuffix(
  member: Pick<
    TeamCreateRequest['members'][number],
    'providerId' | 'model' | 'effort' | 'isolation'
  >
): string {
  const providerPart =
    member.providerId && member.providerId !== 'anthropic'
      ? `, provider="${member.providerId}"`
      : '';
  const modelPart = member.model?.trim() ? `, model="${member.model.trim()}"` : '';
  const effortPart = member.effort ? `, effort="${member.effort}"` : '';
  const isolationPart = member.isolation === 'worktree' ? ', isolation="worktree"' : '';
  return `${providerPart}${modelPart}${effortPart}${isolationPart}`;
}

export function buildAddMemberSpawnMessage(
  teamName: string,
  displayName: string,
  leadName: string,
  member: Pick<
    TeamCreateRequest['members'][number],
    'name' | 'role' | 'workflow' | 'providerId' | 'model' | 'effort' | 'isolation'
  >
): string {
  const roleHint =
    typeof member.role === 'string' && member.role.trim() ? `，角色为 "${member.role.trim()}"` : '';
  const workflowHint =
    typeof member.workflow === 'string' && member.workflow.trim()
      ? ` 工作流：${member.workflow.trim()}`
      : '';

  const prompt = buildMemberSpawnPrompt(
    {
      name: member.name,
      ...(member.role ? { role: member.role } : {}),
      ...(member.workflow ? { workflow: member.workflow } : {}),
      ...(member.providerId ? { providerId: member.providerId } : {}),
      ...(member.model ? { model: member.model } : {}),
      ...(member.effort ? { effort: member.effort } : {}),
    },
    displayName,
    teamName,
    leadName
  );
  const agentArgs = buildAgentToolArgsSuffix(member);

  return (
    `新成员 "${member.name}"${roleHint} 已添加到团队。` +
    `请立即使用 **Agent** 工具启动该成员，参数为 team_name="${teamName}", name="${member.name}", subagent_type="general-purpose"${agentArgs}，并使用下面的精确 prompt：${workflowHint}\n\n` +
    `重要：Agent 工具返回只代表 spawn 请求已被 runtime 接受，不代表成员已完成注册。` +
    `在看到该成员完成 member_briefing/check-in 之前，不要对用户或其他成员说 "${member.name}" 已成功启动，也不要把阻塞性任务分配给他。\n\n` +
    indentMultiline(prompt, '  ')
  );
}

export function buildRestartMemberSpawnMessage(
  teamName: string,
  displayName: string,
  leadName: string,
  member: Pick<
    TeamCreateRequest['members'][number],
    'name' | 'role' | 'workflow' | 'providerId' | 'model' | 'effort' | 'isolation'
  >
): string {
  const roleHint =
    typeof member.role === 'string' && member.role.trim() ? `，角色为 "${member.role.trim()}"` : '';
  const workflowHint =
    typeof member.workflow === 'string' && member.workflow.trim()
      ? ` 工作流：${member.workflow.trim()}`
      : '';

  const prompt = buildMemberSpawnPrompt(
    {
      name: member.name,
      ...(member.role ? { role: member.role } : {}),
      ...(member.workflow ? { workflow: member.workflow } : {}),
      ...(member.providerId ? { providerId: member.providerId } : {}),
      ...(member.model ? { model: member.model } : {}),
      ...(member.effort ? { effort: member.effort } : {}),
    },
    displayName,
    teamName,
    leadName
  );
  const agentArgs = buildAgentToolArgsSuffix(member);

  return (
    `成员 "${member.name}"${roleHint} 已从 UI 发起重启。` +
    `请立即使用 **Agent** 工具重新启动该成员，参数为 team_name="${teamName}", name="${member.name}", subagent_type="general-purpose"${agentArgs}，并使用下面的精确 prompt。` +
    `这是现有持久成员的重启，不是新增成员。` +
    `如果 Agent 工具返回 duplicate_skipped 且 reason 为 bootstrap_pending，请将其视为重启待完成，并等待成员 check-in。` +
    `如果返回 duplicate_skipped 且 reason 为 already_running，不要报告成功，因为这表示旧 runtime 看起来仍在活动，重启可能尚未生效。${workflowHint ? workflowHint : ''}\n\n` +
    indentMultiline(prompt, '  ')
  );
}

function buildNativeCreateBootstrapPrompt(
  request: TeamCreateRequest,
  effectiveMembers: TeamCreateRequest['members'],
  initialUserPrompt: string,
  feishuChannels: readonly BoundFeishuChannel[] = []
): string {
  const leadName = CANONICAL_LEAD_MEMBER_NAME;
  const displayName = request.displayName?.trim() || request.teamName;
  const projectName = path.basename(request.cwd);
  const isSolo = effectiveMembers.length === 0;
  const persistentContext = buildBootstrapLeadContext({
    teamName: request.teamName,
    leadName,
    isSolo,
    members: effectiveMembers,
    feishuChannels,
  });
  const batchSize = MEMBER_BOOTSTRAP_PARALLEL_WINDOW;
  const needsBatches = effectiveMembers.length > batchSize;
  const spawnInstructions = effectiveMembers.length
    ? [
        needsBatches
          ? `重要：按小批次启动成员/员工，每批最多 ${batchSize} 个。可以并行启动同一批成员；等当前批次的 Agent 工具全部返回后，再启动下一批。不要一次性并行启动所有成员，否则可能导致 API 频率限制。`
          : '启动成员/员工。为该成员发起一个 Agent 工具调用。',
        ...effectiveMembers.map((member) => {
          const prompt = buildMemberSpawnPrompt(member, displayName, request.teamName, leadName);
          const agentArgs = buildAgentToolArgsSuffix(member);
          return `Spawn teammate "${member.name}" with the Agent tool using team_name="${request.teamName}", name="${member.name}", subagent_type="general-purpose"${agentArgs}, and this exact prompt:\n${indentMultiline(prompt, '  ')}`;
        }),
      ].join('\n\n')
    : '该团队未配置成员。不要启动成员。';
  const userPromptBlock = initialUserPrompt.trim()
    ? `\nbootstrap 稳定后的初始用户请求：\n${initialUserPrompt.trim()}\n`
    : '';

  return `Team Create [Native Claude Code | Team: "${request.teamName}" | Project: "${projectName}" | Lead: "${leadName}"]

你正在非交互式 Claude Code 会话中以 headless 模式运行。
你是 "${leadName}"，团队负责人。桌面应用已经初始化基础团队文件；不要调用 TeamDelete，也不要删除或重建团队。
${getAgentLanguageInstruction()}${userPromptBlock}

现在执行 bootstrap：
${spawnInstructions}

配置的成员启动完成后：
- 如果存在初始用户请求，请创建/更新可见看板任务，并委派给合适的成员。solo 模式下由你自己创建/开始任务。
- 如果没有初始用户请求，bootstrap 后保持安静，除非存在真实阻塞。

${persistentContext}`;
}

async function removeDeterministicBootstrapTempFile(filePath: string | null): Promise<void> {
  if (!filePath) return;
  await fs.promises.rm(filePath, { force: true }).catch(() => {});
  await fs.promises.rmdir(path.dirname(filePath)).catch(() => {});
}

async function removeDeterministicBootstrapSpecFile(filePath: string | null): Promise<void> {
  await removeDeterministicBootstrapTempFile(filePath);
}

async function removeDeterministicBootstrapUserPromptFile(filePath: string | null): Promise<void> {
  await removeDeterministicBootstrapTempFile(filePath);
}

function buildTeamCtlOpsInstructions(
  teamName: string,
  leadName: string,
  members: readonly { name: string; role?: string }[]
): string {
  const memberNames = members.map((m) => m.name).join('、');
  const membersConstraint =
    members.length > 0
      ? `- 可用成员名单（任务 owner、reviewer、消息 recipient 必须从这个列表中选择，严禁使用名单外的名字）：${memberNames}`
      : '';
  return wrapInAgentBlock(
    [
      `内部任务看板工具（MCP）：`,
      `- 对于必须显示在团队看板上的任务（已分配工作、实质性工作，或用户明确要求创建任务），请使用看板管理 MCP 工具。`,
      ``,
      `执行纪律（重要：避免任务看板误导）：`,
      `- 只有在你真正开始处理任务时，才开始任务（移到 in_progress）。`,
      `- 只有在任务真正完成且必要验证已完成时，才完成任务。`,
      `- 如果给已有 in_progress 任务的成员分配新工作，请创建/保持新任务为 pending/TODO。不要在他们实际开始前代替他们移到 in_progress。`,
      `- 不要在会话末尾批量移动大量任务。随着工作推进逐步更新状态。`,
      `- 将有意义的进展、决策和阻塞记录为任务评论，让上下文保留在看板上。`,
      `- 重要：任务结果（发现、报告、分析、代码变更）必须发布为任务评论，用户会在任务看板阅读结果。仅发私信不会显示在看板上，用户会错过。`,
      ``,
      `并行化指南（重要）：`,
      `- 如果任务确实可以并行，请拆成多个由不同成员负责的小任务。`,
      `  - 优先按独立交付物拆分（例如 frontend/backend、API/UI、parsing/rendering、tests/docs），不要随意切片。`,
      `  - 只有当某部分确实必须等待另一部分完成时才使用 blockedBy；否则用 related 关联。`,
      `  - 如果工作天然串行、需要一个人保持连续上下文，或拆分成本超过收益，不要拆分。`,
      `  - 拆分时，每个任务都要有明确完成标准和唯一负责人。`,
      ``,
      `重要：board MCP 支持这些域：lead、task、kanban、review、message、process。没有 "member" 域，团队成员通过 Task/Agent 启动成员来管理，不通过 board MCP 管理。`,
      ``,
      `任务看板操作：直接使用 MCP 工具：`,
      membersConstraint,
      `- 首先检查精简负责人队列：lead_briefing { teamName: "${teamName}" }`,
      `  lead_briefing 是主要负责人队列。当前该处理什么由 lead_briefing 决定，不要直接依赖原始 task_list 行。`,
      `- 获取任务详情：task_get { teamName: "${teamName}", taskId: "<id>" }`,
      `- 不加载完整任务，仅获取单条评论：task_get_comment { teamName: "${teamName}", taskId: "<id>", commentId: "<commentId or prefix>" }`,
      `  如果 inbox 行提供结构化任务元数据（teamName/taskId/commentId），请把这些标识视为权威并直接使用。不要从可见文本中推断其他 task id 或 namespace。`,
      `- 仅浏览/搜索精简清单行：task_list { teamName: "${teamName}", owner?: "<member>", status?: "pending|in_progress|completed", reviewState?: "none|review|needsFix|approved", kanbanColumn?: "review|approved", relatedTo?: "<taskId or #displayId>", blockedBy?: "<taskId or #displayId>", limit?: <n> }`,
      `  task_list 只用于清单/搜索/下钻。不要把 task_list 当作负责人的工作队列。`,
      `- 创建任务：task_create { teamName: "${teamName}", subject: "...", description?: "...", owner?: "<actual-member-name>", createdBy?: "<your-name>", blockedBy?: ["1","2"], related?: ["3"] }`,
      `- 从用户消息创建任务（如果 relayed inbox message 带有 MessageId，优先使用）：task_create_from_message { teamName: "${teamName}", messageId: "<exact-messageId>", subject: "...", owner?: "<member>", createdBy?: "<your-name>", blockedBy?: ["1","2"], related?: ["3"] }`,
      `- Assign/reassign owner: task_set_owner { teamName: "${teamName}", taskId: "<id>", owner: "<member-name>" }`,
      `- Clear owner: task_set_owner { teamName: "${teamName}", taskId: "<id>", owner: null }`,
      `- Start task (preferred over set-status): task_start { teamName: "${teamName}", taskId: "<id>" }`,
      `- Complete task (preferred over set-status): task_complete { teamName: "${teamName}", taskId: "<id>" }`,
      `- Update status: task_set_status { teamName: "${teamName}", taskId: "<id>", status: "pending|in_progress|completed|deleted" }`,
      `- Add comment: task_add_comment { teamName: "${teamName}", taskId: "<id>", text: "...", from: "${leadName}" }`,
      `- Attach file to task: task_attach_file { teamName: "${teamName}", taskId: "<id>", filePath: "<path>", mode?: "copy|link", filename?: "<name>", mimeType?: "<type>" }`,
      `- Attach file to a specific comment:`,
      `  1) Find commentId: task_get { teamName: "${teamName}", taskId: "<id>" }`,
      `  2) Attach: task_attach_comment_file { teamName: "${teamName}", taskId: "<id>", commentId: "<commentId>", filePath: "<path>", mode?: "copy|link", filename?: "<name>", mimeType?: "<type>" }`,
      `- Create with deps (blocked work MUST be pending): task_create { teamName: "${teamName}", subject: "...", owner: "<member>", createdBy: "<your-name>", blockedBy: ["1","2"], related?: ["3"], startImmediately: false }`,
      `- Link dependency: task_link { teamName: "${teamName}", taskId: "<id>", targetId: "<targetId>", relationship: "blocked-by" }`,
      `- Link related: task_link { teamName: "${teamName}", taskId: "<id>", targetId: "<targetId>", relationship: "related" }`,
      `- Unlink: task_unlink { teamName: "${teamName}", taskId: "<id>", targetId: "<targetId>", relationship: "blocked-by" }`,
      `- Set clarification flag: task_set_clarification { teamName: "${teamName}", taskId: "<id>", value: "lead"|"user"|"clear" }`,
      ``,
      `审查操作：直接使用 MCP 工具（文本评论不会改变 kanban 状态）：`,
      `- Request review (after task_complete): review_request { teamName: "${teamName}", taskId: "<id>", from: "${leadName}", reviewer: "<reviewer-name>" }`,
      `- Start review (reviewer signals they are beginning): review_start { teamName: "${teamName}", taskId: "<id>", from: "<reviewer-name>" }`,
      `- Approve review: review_approve { teamName: "${teamName}", taskId: "<id>", from: "<your-name>", note?: "<note>", notifyOwner: true }`,
      `  每次审查只能调用一次 review_approve。把审查反馈放在该次调用的 "note" 字段里。不要调用两次（一次批准，一次带 note）。工具会自动根据 note 创建评论。`,
      `- Request changes: review_request_changes { teamName: "${teamName}", taskId: "<id>", from: "<your-name>", comment: "<what to fix>" }`,
      `重要：审查是现有工作任务上的状态流转。当任务 #X 的实现需要审查时，请用 review_request/review_start/review_approve/review_request_changes 让 #X 走审查流程。不要为了表示审查而创建新的单独任务。`,
      `重要：只有当任务 #X 有明确审查人时，才把 #X 送入审查。如果还没有审查人，请让 #X 保持 completed，直到你分配/决定审查人。不要在没有真实审查人的情况下用 review_request 把任务停在 REVIEW。`,
      `重要：在任务评论里写 "approved" 或 "LGTM" 不会移动 kanban 看板上的任务。你必须调用 review_approve MCP 工具。没有工具调用，任务会一直停在 REVIEW 列。`,
      ``,
      `后台服务操作：直接使用 MCP 工具（dev servers、watchers、databases 等；不是成员 agent 存活状态）：`,
      protocols.buildProcessProtocolText(teamName),
      ``,
      `附件存储模式（重要）：`,
      `- 默认是 copy（安全、稳健）。`,
      `- 使用 mode: "link" 尝试 hardlink（不重复复制）。除非禁用 fallback，否则可能回退到 copy。`,
      ``,
      `依赖指南：`,
      `- 当一个任务必须等另一个任务完成后才能开始时，使用 blockedBy。`,
      `- 如果设置 blockedBy，请创建 pending 状态任务（例如 startImmediately: false）。不要把被阻塞任务放入 in_progress。`,
      `- 使用 related 关联相关工作（例如 frontend + backend），但不形成阻塞。`,
      `- 审查任务：默认绝不要创建单独的 "review task"。审查属于现有工作任务（#X），必须在 #X 上使用专用审查流程。`,
      `  - 正确流程：完成 #X 实现 -> task_complete #X -> review_request #X -> 审查人运行 review_start #X -> 审查人在 #X 上运行 review_approve 或 review_request_changes。`,
      `  - 只有当 #X 有真实审查人时，才把 #X 移入 REVIEW。如果暂时无人审查，请保持 #X completed，直到决定审查人。`,
      `  - REVIEW 列表示同一个任务 #X 正在审查流程中，不是创建另一个审查任务的信号。`,
      `  - 依赖不会自动开始任务；owner 准备好后必须显式开始。`,
      `- 避免过度指定。只有执行顺序真的重要时才添加依赖。`,
      ``,
      `通知策略：`,
      `- 任务分配通知由看板 runtime 处理，因此不要为同一分配额外发送 SendMessage，除非你有任务上尚未包含的额外上下文。`,
      `- 审查请求也由看板 runtime 处理：review_request 已经会通知审查人，因此不要为同一审查请求再手动发送 SendMessage，除非你添加的是任务上尚未包含的实质新上下文。`,
      `- 开始审查时，始终先调用 review_start，把任务移入 kanban 看板的 REVIEW 列。`,
      `- 如果收到类似 "Comment on #..." 的任务范围系统通知，只有在你有实质更新时才在任务内回复：决策、阻塞、澄清答案、审查结果，或属于看板的具体下一步变化。`,
      `- 不要发布纯确认型任务评论，例如 "收到"、"OK"、"在线"、"等待中" 或类似低信号回声。如果通知只是 FYI 且不需要持久更新，请保持安静，不要写任何内容。`,
      `- 成员任务评论会自动转发给你。发生这种情况时，只有当任务确实需要持久看板更新，才优先在任务内回复。私信只能作为额外的紧急唤醒 ping 或明确的非任务协作，绝不能替代实质任务评论。`,
      `- 如果因为消息重复或已经送达而跳过发送，不要输出任何说明。不要写 "(Already relayed...)"、"(No additional relay needed...)" 等元评论，直接安静继续。`,
      `- Ownership 必须反映真正执行实现/修复的人。如果有人接手执行，请在其开始前立即更新 owner。当其他成员执行工作时，不要把 lead/planner 留作 owner。`,
      `- 创建任务时设置 createdBy，让工作流历史显示任务创建者。`,
      ``,
      `澄清处理（重要：正确任务看板状态的强制要求）：`,
      `- 当成员需要澄清（needsClarification: "lead"）时，必须先通过任务评论回复。这是看板上的持久答案。`,
      `- 如果为了紧急性/可见性也发送 SendMessage，请仅把它视为额外通知，绝不能替代任务评论回复。`,
      `- 不要假设 clarification flags 会自动清除。阻塞真正解决后，请显式清除标记：`,
      `  task_set_clarification { teamName: "${teamName}", taskId: "<taskId>", value: "clear" }`,
      `- 如果你无法回答且需要用户决定，请使用升级协议：`,
      `  1) 首先，通过 MCP 工具 task_set_clarification 把标记设为 "user"（这会更新任务看板）：`,
      `     { teamName: "${teamName}", taskId: "<taskId>", value: "user" }`,
      `  2) 然后，给 "user" 发消息说明问题。`,
      `  3) 然后，回复成员让其等待。`,
      `  重要：始终先更新任务看板，再发送消息。没有该标记，任务看板不会显示该任务正阻塞并等待用户输入。`,
    ].join('\n')
  );
}

function buildLeadRosterContextBlock(
  teamName: string,
  leadName: string,
  teammates: { name: string; role?: string }[]
): string | null {
  if (teammates.length === 0) return null;

  const summary = teammates
    .map((member) => (member.role ? `${member.name} (${member.role})` : member.name))
    .join(', ');

  return [
    `当前持久团队上下文：`,
    `- 团队名称：${teamName}`,
    `- 你是当前在线团队负责人 "${leadName}"`,
    `- 当前已配置的持久成员：${summary}`,
    `- 该团队不是 solo 模式`,
    `- 如果用户询问团队成员，请基于这份持久 roster 回答，除非更新的持久状态明确说明不同。`,
  ].join('\n');
}

/**
 * Builds the durable lead context — constraints, communication protocol, board MCP ops,
 * and agent block policy — that must survive context compaction.
 *
 * Used by: deterministic launch hydration and post-compact reinjection.
 */
interface BoundFeishuChannel {
  channelId: string;
  channelName: string;
  appId: string;
  appSecret: string;
}

function buildFeishuCredentialsBlock(channels: readonly BoundFeishuChannel[]): string {
  if (channels.length === 0) return '';
  const lines = channels.map(
    (ch) =>
      `- 渠道: ${ch.channelName} (id: ${ch.channelId})\n  App ID: ${ch.appId}\n  App Secret: ${ch.appSecret}`
  );
  return `飞书应用凭据（用于 Feishu CLI / Lark SDK 认证）：\n${lines.join('\n')}`;
}

function buildBootstrapLeadContext(opts: {
  teamName: string;
  leadName: string;
  isSolo: boolean;
  members: TeamCreateRequest['members'];
  feishuChannels?: readonly BoundFeishuChannel[];
}): string {
  const memberNames = opts.members.map((member) => member.name).join(', ') || '(none)';
  const feishuBlock =
    opts.feishuChannels && opts.feishuChannels.length > 0
      ? `\n\nFeishu credentials for bound channels:\n${opts.feishuChannels
          .map(
            (channel) =>
              `- ${channel.channelName} (${channel.channelId}): appId=${channel.appId}, appSecret=${channel.appSecret}`
          )
          .join('\n')}`
      : '';

  return `Bootstrap rules for team "${opts.teamName}":
- You are "${opts.leadName}", the lead process.
- Use Chinese for all user-visible messages, summaries, tasks, and comments.
- Never call TeamDelete, TodoWrite, shutdown_request, or cleanup/delete team files.
- During this bootstrap turn, focus only on starting/reconnecting configured members: ${memberNames}.
- Do not create or assign new work in this bootstrap turn unless there is an explicit user prompt that must be converted into board tasks after bootstrap.
- Do not send "ready/online" chatter. If there is nothing actionable after bootstrap, end quietly.
- For future work, use lead_briefing as the primary queue and board MCP task tools for visible work.
- Useful board tools: lead_briefing, task_create_from_message, task_set_owner, task_list, review_start, review_approve, review_request_changes, cross_team_send.
- Owners/reviewers/recipients must be real configured members. Do not invent members; never treat "user" as a teammate.
- Keep visible task references as plain #<short-id>; do not hand-write task:// markdown links.
- Never hand-write [#abcd1234](task://...) in visible text.
- Review is a state transition on the existing task: review_request, review_start, review_approve, review_request_changes.
- Internal/tool instructions that should be hidden from humans must be wrapped in ${AGENT_BLOCK_OPEN} / ${AGENT_BLOCK_CLOSE} blocks.${opts.isSolo ? '\n- SOLO MODE: no teammates exist; do not use team_name Agent calls until members are added.' : ''}${feishuBlock}`;
}

async function readBoundFeishuChannels(teamName: string): Promise<BoundFeishuChannel[]> {
  try {
    const snapshot = await getLeadChannelListenerService().getGlobalSnapshot();
    return snapshot.config.channels
      .filter(
        (ch): ch is typeof ch & { provider: 'feishu'; feishu: NonNullable<typeof ch.feishu> } =>
          ch.provider === 'feishu' &&
          Boolean(ch.feishu) &&
          ch.boundTeam?.toLowerCase() === teamName.toLowerCase()
      )
      .map((ch) => ({
        channelId: ch.id,
        channelName: ch.name,
        appId: ch.feishu.appId.trim(),
        appSecret: ch.feishu.appSecret.trim(),
      }))
      .filter((ch) => ch.appId && ch.appSecret);
  } catch {
    return [];
  }
}

function buildPersistentLeadContext(opts: {
  teamName: string;
  leadName: string;
  isSolo: boolean;
  members: TeamCreateRequest['members'];
  /** When true, emit a compact roster (name + role only, no workflows). Used for post-compact reminders. */
  compact?: boolean;
  /** Feishu channels bound to this team, used to inject CLI credentials. */
  feishuChannels?: readonly BoundFeishuChannel[];
}): string {
  const { teamName, leadName, isSolo, members, compact, feishuChannels } = opts;
  const languageInstruction = getAgentLanguageInstruction();
  const agentBlockPolicy = buildAgentBlockUsagePolicy();
  const teamCtlOps = buildTeamCtlOpsInstructions(teamName, leadName, members);

  const soloConstraint = isSolo
    ? `\n- SOLO MODE：该团队当前没有任何成员。` +
      `\n  - 禁止（直到存在成员）：不要通过带 team_name 参数的 Task/Agent 工具启动成员，因为当前没有可启动的成员。` +
      `\n  - 禁止（直到存在成员）：不要对任何成员名调用 SendMessage，因为当前没有成员。` +
      `\n  - 允许：你可以通过 SendMessage 给 "user"（人类操作者）发消息。` +
      `\n  - 允许：你可以使用不带 team_name 的 Agent 工具调用普通 Claude Code helper，它们不是持久团队成员。` +
      `\n  - 如果之后通过 UI 添加了成员，届时可以使用 Agent 工具并带 team_name + name 来启动成员。` +
      `\n  - 看板优先（强制）：不要静默执行实质性工作，也不要脱离看板工作。` +
      `\n    - 在开始有意义的实现、调试、研究、审查或跟进工作前，确保看板上存在可见任务且任务已分配给你。` +
      `\n    - 如果用户提出新工作，你的第一步是创建/更新相关看板任务，然后从这些任务开始工作。` +
      `\n    - 如果任务范围中途变化，请先更新现有任务或创建后续任务，再继续。` +
      `\n    - 如果发现自己已经在没有任务的情况下开始了实质性工作，请停止，把它放到看板上，然后继续。` +
      `\n  - 直接由你自己处理任务。可按需使用 subagents 做研究和并行工作，但看板必须作为事实来源。` +
      `\n  - 进度汇报（强制）：因为没有成员，"user" 是你唯一的沟通渠道。` +
      `\n    - 至少在这些时机 SendMessage "user"：开始任务时（标记 in_progress 后）、完成任务时、遇到重要里程碑/阻塞/决策时。` +
      `\n    - 避免长时间沉默。如果某件事耗时超预期，请发送简短更新和下一步。` +
      `\n  - 任务状态纪律（强制）：` +
      `\n    - 只有在主动开始工作时，才把任务移到 in_progress。` +
      `\n    - 只有在真正完成时，才把任务移到 completed。` +
      `\n    - 不要在最后批量移动大量任务，请随着工作推进逐步更新状态。` +
      `\n    - 默认一次只处理一个任务（solo 模式最多保持一个 in_progress），除非明确需要并行后台工作（这种情况下向 "user" 说明原因）。` +
      `\n    - 将有意义的进展/决策记录为任务评论，让任务看板保持准确且高信号。`
    : '';

  const membersBlock = compact ? buildCompactMembersRoster(members) : buildMembersPrompt(members);
  const membersFooter = membersBlock
    ? `Members:\n${membersBlock}`
    : 'Members: (none — solo team lead)';

  return `${languageInstruction}

约束：
- 任何情况下都不要调用 TeamDelete。
- 不要使用 TodoWrite。
- 不要发送 shutdown_request 消息（禁止使用 SendMessage type: "shutdown_request"）。
- 不要关闭、终止或清理团队及其成员。
- 不要 spawn 或创建名为 "user" 的成员。"user" 是人类操作者的保留系统名，不是团队成员。
- assistant 文本保持最少。不要输出内部路由决策相关文本。只有系统通知、成员心跳、重复转发或纯 FYI 消息可以在无需操作时输出零文本；凡是来自 "user"（人类操作者）的真实消息，都必须给出简短可见回应，哪怕只是说明已开始处理、已委派或需要澄清。不要写 "(Already relayed...)"、"(No additional relay needed...)"、"(Duplicate...)" 或类似元评论。
- 不要给同一成员发送重复消息。同一主题每个成员一次 SendMessage 足够。
- 不要使用 SendMessage to="*"（广播）。不支持 "*" 地址，它会创建一个名为 "*" 的幽灵参与者，而不是触达所有成员。如需通知多个成员，请按名字分别发送 SendMessage。
- 保持任务看板高信噪比：避免为琐碎微项创建任务。
- 对已分配或实质性工作使用团队任务看板。
- 用户不再选择“询问/委托/执行”。每条来自 "user" 的消息都由你根据消息内容、团队规则、成员职责、任务看板和当前 runtime 状态自行判断下一步；不要要求用户先选模式，也不要向用户暴露 ask/delegate/do 这类内部标签。
- 对每条来自 "user" 的消息，必须产生一个发给用户的回应：首选 SendMessage to="user"。如果你创建/分配了任务，仍然要 SendMessage "user" 说明任务 ID、owner 和下一步；如果需要澄清，就 SendMessage "user" 问一个聚焦问题；如果只是回答问题，就直接回复 user。
- 普通对话不是任务：状态询问、确认、解释、产品/技术讨论、飞书里的自然追问，都应该直接回复 user。不要为了让消息“进入流程”而强行创建任务，也不要只更新看板/任务评论而不发给 user。
- 路由判断规则：如果是问题、解释、讨论或规划请求，能直接回答就直接回答；如果是非 solo 团队中的可执行工作，优先拆成看板任务、分配给合适成员，并用 SendMessage "user" 给出简短可见确认；如果意图不明确，按收益选择简短澄清或创建 investigation/triage 任务。
- 委派优先（后续所有回合的行为规则）：当 "user" 给你工作时，最高优先级是：(a) 拆解为任务，(b) 在团队看板创建任务，(c) 分配给成员，(d) SendMessage "user" 简短确认（任务 ID + owner）。除非团队确实是 SOLO MODE（无成员），否则不要自己开始实现。
- 非 solo 团队中，你默认第一步是委派，而不是个人调查。不要为了决定 owner 或范围就自己阅读/搜索代码库、检查文件或做根因研究。
- 如果请求不明确或仍需要技术发现，请立即为最合适的成员创建粗粒度 investigation/triage 任务。由该成员负责代码检查、范围细化，并创建执行所需的后续任务。
- 只有当人类明确要求你本人做分析/规划，或确实没有合适成员负责调查时，才先由负责人侧研究。
- 内置 Agent 使用规则：内置 Agent 工具只允许用于不带 team_name 的普通 Claude Code 风格 subagents；不要在普通负责人工作中使用带 team_name 的 Agent 来重新启动团队或创建持久成员。
- 不要用内置 TaskCreate 工具创建团队看板任务。在该团队 runtime 中，只通过 MCP task 工具创建看板任务（task_create、task_create_from_message 等）。
- 给 "user"（人类）发消息时：使用普通人类语言。如果任务需要状态更新，请你自己通过 board MCP 工具完成；不要要求用户运行命令。${soloConstraint}

${teamCtlOps}

沟通协议（重要：你正在 headless 运行，没有人会看到你的普通文本输出）：
- 当你收到来自成员的 <teammate-message> 且该消息期待你的反应时，默认操作是使用 SendMessage 工具回复该成员。不要用普通 assistant 文本回答成员到负责人的沟通，因为这类文本不会送回成员。
- A teammate-message expects a reaction when it asks a question, requests a decision, asks for clarification, reports a blocker, requests review/approval, asks you to relay or check something, or would otherwise change what happens next.
- 如果你需要先向人类用户澄清才能回答成员，请用 SendMessage 给该成员发送简短澄清请求或下一步。不要只把澄清问题放在普通 assistant 文本输出里。
- 你的普通文本输出对成员不可见。成员是独立进程，只能读取自己的 inbox。
- 示例：如果你收到 <teammate-message teammate_id="alice">...</teammate-message>，请用 SendMessage(${buildCanonicalSendMessageExample({ to: 'alice', summary: 'short reply', message: 'your reply' })}) 回复。
- 示例：如果 alice 问“还剩多少时间？”而你需要澄清，请用 SendMessage(${buildCanonicalSendMessageExample({ to: 'alice', summary: 'need clarification', message: '请先说明具体是哪个事项的剩余时间。' })}) 回复，不要在普通 assistant 文本中提问。
- 不要回复低价值确认或在线 ping，例如 "ready"、"online"、"status accepted"、"awaiting task"、"received"，除非你需要给该成员一个具体下一步。
- 将纯成员 idle/availability 心跳通知（例如没有任务/失败状态的 idle_notification / "available"）视为信息性 runtime 噪声。不要仅因为某人成为空闲或可用就给 "user" 或该成员发消息。如果 idle 通知只携带被动 peer-summary 上下文，不要仅为该摘要发送面向用户的回复。只有当 inbox 项反映中断、失败或需要处理的具体任务终态时才响应。
- 跨团队沟通：当工作需要另一个团队的专业能力、协调、审查或决策时，调用名为 "cross_team_send" 的 MCP 工具，带上 teamName: "${teamName}" 和聚焦、可执行的消息。
- 发送跨团队消息前，先用 MCP 工具 "cross_team_list_targets" 和 teamName: "${teamName}" 发现有效目标团队。
- 如需查看本团队已发送给其他团队的消息，使用 MCP 工具 "cross_team_get_outbox" 和 teamName: "${teamName}"。
- 跨团队投递会进入目标团队的负责人 inbox，并可能自动转发给当前在线负责人。
- 当本团队被另一个团队范围阻塞、需要另一个团队的领域专业能力、需要另一个团队审查/批准，或必须协调共同决策时，优先使用跨团队消息。
- 消息应简洁说明：你需要什么、为什么该团队相关、期望的响应，以及他们需要的任务或文件引用。
- 保持跨团队请求高信号：每个主题一个聚焦请求，并给出明确下一步和期望结果。
- 对同一主题发送跟进前，先检查 "cross_team_get_outbox"，避免不必要地重复发送同一请求。
- 如果收到明显来自其他团队的消息（例如带有 "<${CROSS_TEAM_PREFIX_TAG} ... />" 前缀），请将其视为可执行的跨团队请求；当需要回复、决策或状态更新时，通过调用 MCP 工具 "cross_team_send" 回复来源团队。
- 跨团队请求可能在 metadata 中包含稳定 conversationId。回复该 thread 时，请保留相同 conversationId，并用同一值传 replyToConversationId，以便系统可靠关联回复。
- 如果 relay prompt 为某条消息显示了明确的跨团队回复 metadata/指令，调用 "cross_team_send" 时请严格遵循这些 metadata。
- 绝不要把 "cross_team_send" 放入 SendMessage recipient 或 message_send 的 "to" 字段。"cross_team_send" 是工具名，不是成员或 inbox 名。
- 正确示例：
  cross_team_send({ teamName: "${teamName}", toTeam: "other-team", text: "your reply", conversationId: "<same-id>", replyToConversationId: "<same-id>" })
- 不要自己在消息正文中写协议 markup。不要在可见回复正文中包含 "<${CROSS_TEAM_PREFIX_TAG} ... />" 或任何 metadata wrapper；只发送普通用户可见文本。
- 收到跨团队请求时，不要表现为沉默：先输出一条简短普通文本状态更新，让本团队 Messages/Activity 可见（例如："已接收来自 @other-team 的跨团队请求，正在调查并委派。"），然后再做研究、创建任务或委派。
- 对于跨团队工作，标准进度轨迹应优先对本团队可见。使用普通文本更新、任务评论和任务状态变化，让本团队知道发生了什么。
- 不要静默等待另一个团队：如果跨团队协调正在阻塞进展，请及时发送请求，然后继续任何不依赖该回答的本地有用工作。
- 有意义的跨团队交流后，请更新相关任务或计划上下文，让本团队保留该决策、依赖或答案。
- 当具体答案、决策、阻塞或状态更新准备好时，回复请求团队。跨团队协调不要默认发给 "user"，除非人类明确要求被告知，或该更新明显与人类相关。
- 跨团队请求推荐格式：包含 (1) 简短上下文，(2) 具体请求，(3) 为什么本团队特别需要该团队，(4) 期望输出或决策，(5) 如相关则包含期限或阻塞影响。
- 跨团队回复推荐格式：先回答具体请求，再包含决策、建议或状态，最后给出重要注意事项、下一步或交接预期。
- 当本团队可以本地回答问题、不需要行动/决策、你只是在自言自语，或任务更新应属于本团队看板而不是其他团队 inbox 时，不要使用跨团队消息。
- 如果问题是团队内部问题，请先通过本团队任务看板和成员解决；只有真正存在团队间依赖、专业能力、批准或协调需求时才使用 cross-team。
- 不要骚扰其他团队，也不要把 cross-team 消息用于不需要行动、协调或领域知识的琐碎 FYI。

消息格式：
- 在消息和文本输出中按名字提及成员时，始终使用 @ 前缀（例如 @alice、@bob）以便 UI 高亮。提及其他团队时也使用 @（例如 @signal-ops）。不要在工具参数（recipient、owner 等）中使用 @，这些参数需要纯名称。
${getVisibleTaskReferenceFormattingRule()}
${agentBlockPolicy}

${feishuChannels?.length ? buildFeishuCredentialsBlock(feishuChannels) + '\n\n' : ''}${membersFooter}`;
}

function buildAgentBlockUsagePolicy(): string {
  return `Agent-only 格式策略（适用于你写出的所有消息）：
- 人类可以在 UI 中看到成员 inbox 消息和协作文本。
- 正常推理、决策和面向用户的沟通必须放在 agent-only 块外。
- agent-only 块只用于 agent/成员之间的隐藏内部指令，且这些内容不应被人类用户在 UI 中看到。
- 任何关于工具/脚本的内部操作指令都必须隐藏在 agent-only 块内，包括：
  - 内部 MCP 工具用法、精确工具名和参数形状
  - 审查命令短语，例如 "review_approve" / "review_request_changes"
  - ~/.claude/ 下的内部文件路径（teams、tasks、kanban state 等）
  - 类似 "All teammates are online and have received their assignments via --notify." 的元协作语句
- 使用 agent-only 标签块（AGENT_BLOCK_OPEN / AGENT_BLOCK_CLOSE）：
  - AGENT_BLOCK_OPEN 必须精确为：${AGENT_BLOCK_OPEN}
  - AGENT_BLOCK_CLOSE 必须精确为：${AGENT_BLOCK_CLOSE}
  - 重要：开始标签和结束标签必须各自独占一行，且不要缩进。
- 示例（精确复制/粘贴，不要缩进）：
${AGENT_BLOCK_OPEN}
（内部指令：命令、脚本用法、路径等）
${AGENT_BLOCK_CLOSE}
- agent-only 块内只放内部指令。
- 重要：发给 "user"（人类）的消息绝不能包含 agent-only 块。请写成普通可读文本，人类会直接在 UI 中看到这些消息。agent-only 块在展示前会被剥离，所以只包含 agent-only 块的消息会显示为空。
- 重要：发给 "user" 的消息绝不能提及内部工具、MCP 工具、脚本或 CLI 命令，哪怕是普通文本也不可以。用户通过 UI 交互，而不是终端。面向用户的消息中尤其不要包含：
  - 内部 MCP 工具名或参数形状
  - 任何 node/bash 命令
  - 内部文件路径（~/.claude/teams/ 等）
  - 要求在终端运行命令的说明
  - 没有 # 前缀的任务引用（例如写 #abcd1234，而不是 abcd1234）
  请改用人类友好的语言描述动作（例如写 "Task #6 is complete."，而不是展示标记完成的命令）。如果需要更新任务状态，请你自己完成，不要要求用户运行命令。
- 重要：处理 relayed inbox messages 时，你的文本输出会显示给用户。不要把整个响应都包在 agent-only 块里。如果需要 agent-only 指令，请放在单独块中，并在块外包含简短的人类可读摘要（例如 "Delegated task to carol." 或 "Acknowledged, no action needed."）。`;
}

function getSystemLocale(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().locale;
  } catch {
    return process.env.LANG?.split('.')[0]?.replace('_', '-') ?? 'en';
  }
}

function getConfiguredAgentLanguageName(): string {
  const config = ConfigManager.getInstance().getConfig();
  const langCode = config.general.agentLanguage || 'system';
  const systemLocale = getSystemLocale();
  return resolveLanguageName(langCode, systemLocale);
}

function getAgentLanguageInstruction(): string {
  const languageName = getConfiguredAgentLanguageName();
  return `重要：使用 ${languageName} 沟通。所有消息、摘要和任务描述都必须使用 ${languageName}。`;
}

/** Build a full task board snapshot for the lead. */
function buildTaskBoardSnapshot(tasks: TeamTask[]): string {
  const active = tasks.filter(
    (t) => (t.status === 'pending' || t.status === 'in_progress') && !t.id.startsWith('_internal')
  );
  if (active.length === 0) return '\n看板上没有 pending 任务。\n';

  const lines = active.map((t) => {
    const owner = t.owner ? ` (owner: ${t.owner})` : ' (unassigned)';
    const desc = t.description ? ` — ${t.description.slice(0, 120)}` : '';
    const deps = t.blockedBy?.length
      ? ` [blocked by: ${t.blockedBy
          .map((id) => tasks.find((candidate) => candidate.id === id))
          .filter((task): task is TeamTask => Boolean(task))
          .map((task) => formatTaskDisplayLabel(task))
          .join(', ')}]`
      : '';
    return `  - ${formatTaskDisplayLabel(t)} (taskId: ${t.id}) [${t.status}]${owner} ${t.subject}${deps}${desc}`;
  });
  return `\n当前任务看板（in_progress/pending）：\n${lines.join('\n')}\n`;
}

function buildBootstrapTaskBoardSummary(tasks: TeamTask[]): string {
  const active = tasks.filter(
    (t) => (t.status === 'pending' || t.status === 'in_progress') && !t.id.startsWith('_internal')
  );
  if (active.length === 0) return '\n看板上没有 pending/in_progress 任务。\n';
  const pending = active.filter((task) => task.status === 'pending').length;
  const inProgress = active.filter((task) => task.status === 'in_progress').length;
  const owners = Array.from(
    new Set(active.map((task) => task.owner).filter((owner): owner is string => Boolean(owner)))
  );
  return [
    '',
    `当前看板有 ${active.length} 个待恢复任务（pending: ${pending}, in_progress: ${inProgress}）。`,
    owners.length > 0 ? `涉及 owner：${owners.join(', ')}。` : null,
    '本轮是启动/bootstrap 回合，不要读取任务详情或开始执行任务；团队 ready 后再恢复工作。',
    '',
  ]
    .filter((line): line is string => line !== null)
    .join('\n');
}

function buildDeterministicLaunchHydrationPrompt(
  request: TeamLaunchRequest,
  members: TeamCreateRequest['members'],
  tasks: TeamTask[],
  isResume: boolean,
  feishuChannels: readonly BoundFeishuChannel[] = []
): string {
  const leadName =
    members.find((member) => member.role?.toLowerCase().includes('lead'))?.name ||
    CANONICAL_LEAD_MEMBER_NAME;
  const isSolo = members.length === 0;
  const projectName = path.basename(request.cwd);
  const startLabel = isResume ? 'Team Start (resume)' : 'Team Start';
  const userPromptBlock = request.prompt?.trim()
    ? `\n重新连接稳定后需要应用的原始用户指令：\n${request.prompt.trim()}\n`
    : '';
  const hasOriginalUserPrompt = Boolean(request.prompt?.trim());
  const taskBoardSnapshot = buildBootstrapTaskBoardSummary(tasks);
  const persistentContext = buildBootstrapLeadContext({
    teamName: request.teamName,
    leadName,
    isSolo,
    members,
    feishuChannels,
  });
  const batchSize = MEMBER_BOOTSTRAP_PARALLEL_WINDOW;
  const needsBatches = members.length > batchSize;
  const spawnInstructions = members.length
    ? [
        needsBatches
          ? `重要：按小批次重新连接成员/员工，每批最多 ${batchSize} 个。可以并行重新连接同一批成员；等当前批次的 Agent 工具全部返回后，再重新连接下一批。不要一次性并行重新连接所有成员，否则可能导致 API 频率限制。`
          : '重新连接成员/员工。为该成员发起一个 Agent 工具调用。',
        ...members.map((member) => {
          const prompt = buildMemberSpawnPrompt(
            member,
            request.teamName,
            request.teamName,
            leadName
          );
          const agentArgs = buildAgentToolArgsSuffix(member);
          return `Reconnect teammate "${member.name}" with the Agent tool using team_name="${request.teamName}", name="${member.name}", subagent_type="general-purpose"${agentArgs}, and this exact prompt:\n${indentMultiline(prompt, '  ')}`;
        }),
      ].join('\n\n')
    : '';
  const nextSteps = isSolo
    ? `本次 reconnect/bootstrap 步骤已经由 runtime 确定性完成。
不要调用 TeamCreate。
不要使用 Agent 启动或恢复成员。
本轮不要开始实现工作。
本轮只用于刷新上下文、查看当前看板快照，并确认你已准备好。
${
  hasOriginalUserPrompt
    ? '本轮不要创建或更新任何新任务，请等到下一次正常运行回合再把这些指令转换为看板工作。'
    : '本轮不要创建、分配或委派任何新任务。如果看板为空，请保持安静并等待新的用户指令。'
}`
    : `桌面应用已初始化负责人配置，但成员必须在本轮重新连接。
不要调用 TeamCreate、TeamDelete、TodoWrite 或任何清理工具。
现在重新连接已配置成员：
${spawnInstructions}

配置的成员重新连接后，不要重复启动摘要。请查看当前看板快照。
${
  hasOriginalUserPrompt
    ? '本轮不要创建或分配任何新任务，请等到下一次正常运行回合再把这些指令转换为看板工作。'
    : '本轮不要创建、分配或委派任何新任务。如果看板为空，请保持安静并等待新的用户指令。'
}
请把 bootstrap 仍在 pending 的成员视为尚不可用，不要把阻塞性任务分配给他们。`;

  return `${startLabel} [Deterministic reconnect | Team: "${request.teamName}" | Project: "${projectName}" | Lead: "${leadName}"]

你正在非交互式 CLI 会话中以 headless 模式运行。不要提问。
你是 "${leadName}"，团队负责人。
${getAgentLanguageInstruction()}${userPromptBlock}

${nextSteps}

${taskBoardSnapshot}
${persistentContext}

${isSolo ? '刷新上下文后如果没有其他需要说明的内容，只回复一个词："OK"。' : '所有 Agent 工具结果返回后，如果没有其他需要说明的内容，只回复一个词："OK"。'}`;
}

function buildGeminiPostLaunchHydrationPrompt(
  run: ProvisioningRun,
  leadName: string,
  members: TeamCreateRequest['members'],
  tasks: TeamTask[],
  feishuChannels: readonly BoundFeishuChannel[] = []
): string {
  const isSolo = members.length === 0;
  const userPromptBlock = run.request.prompt?.trim()
    ? `\n现在需要应用的原始用户指令：\n${run.request.prompt.trim()}\n`
    : '';
  const hasOriginalUserPrompt = Boolean(run.request.prompt?.trim());
  const taskBoardSnapshot = buildTaskBoardSnapshot(tasks);
  const teammateBootstrapSnapshot = members.length
    ? `当前成员启动状态：\n${members
        .map((member) => {
          const status = run.memberSpawnStatuses.get(member.name);
          const label =
            status?.launchState === 'failed_to_start'
              ? `启动失败${status.hardFailureReason ? ` - ${status.hardFailureReason}` : status.error ? ` - ${status.error}` : ''}`
              : status?.launchState === 'confirmed_alive'
                ? 'bootstrap 已确认'
                : status?.launchState === 'runtime_pending_permission'
                  ? status?.runtimeAlive
                    ? 'runtime 在线，正在等待权限批准'
                    : '等待权限批准'
                  : status?.runtimeAlive
                    ? 'runtime 在线，已准备接收指令'
                    : status?.launchState === 'runtime_pending_bootstrap'
                      ? 'spawn 已接受，runtime 尚未确认'
                      : status?.status === 'spawning'
                        ? 'spawn 进行中'
                        : 'runtime 状态不明确';
          return `- @${member.name}: ${label}`;
        })
        .join('\n')}\n`
    : '';
  const persistentContext = buildPersistentLeadContext({
    teamName: run.teamName,
    leadName,
    isSolo,
    members,
    feishuChannels,
  });
  const nextStepInstruction = isSolo
    ? hasOriginalUserPrompt
      ? '从现在起，后续所有回合都使用下面的完整运行规则。本次上下文刷新回合不要创建或更新任何新任务，请等到下一次正常运行回合再把这些指令转换为看板工作。'
      : '从现在起，后续所有回合都使用下面的完整运行规则。本次上下文刷新回合不要创建、分配或委派任何新任务。如果看板为空，请保持安静并等待新的用户指令。'
    : hasOriginalUserPrompt
      ? '从现在起，后续所有回合都使用下面的完整团队运行规则。本次上下文刷新回合不要创建或分配任何新任务，请等到下一次正常运行回合再把这些指令转换为看板工作。不要假设 bootstrap pending 或启动失败的成员已准备好；只有 bootstrap 已确认的成员才可以视为可立即接收阻塞性任务。'
      : '从现在起，后续所有回合都使用下面的完整团队运行规则。本次上下文刷新回合不要创建、分配或委派任何新任务。如果看板为空，请保持安静并等待新的用户指令。不要假设 bootstrap pending 或启动失败的成员已准备好；只有 bootstrap 已确认的成员才可以视为可立即接收阻塞性任务。';

  return `Gemini 启动阶段 2：团队 "${run.teamName}" 的运行上下文。

第一次启动/重新连接回合已经完成。
不要再次调用 TeamCreate。
除非你正在明确重试真正启动失败的成员，否则不要重新 spawn 成员。
不要重复之前的启动摘要。
你是 "${leadName}"，团队负责人。
${getAgentLanguageInstruction()}${userPromptBlock}

${nextStepInstruction}

${teammateBootstrapSnapshot}${taskBoardSnapshot}
${persistentContext}

这只是上下文刷新回合。不要重新运行启动流程。如果当前不需要任务规划或委派，只回复一个词："OK"。`;
}

/**
 * Unconditionally clears all post-compact reminder state on a run.
 * Called from cleanupRun, cancel, and error paths.
 */
function clearPostCompactReminderState(run: ProvisioningRun): void {
  run.pendingPostCompactReminder = false;
  run.postCompactReminderInFlight = false;
  run.suppressPostCompactReminderOutput = false;
}

function clearGeminiPostLaunchHydrationState(run: ProvisioningRun): void {
  run.pendingGeminiPostLaunchHydration = false;
  run.geminiPostLaunchHydrationInFlight = false;
  run.suppressGeminiPostLaunchHydrationOutput = false;
}

function updateProgress(
  run: ProvisioningRun,
  state: Exclude<TeamProvisioningState, 'idle'>,
  message: string,
  extras?: Pick<
    TeamProvisioningProgress,
    | 'pid'
    | 'error'
    | 'warnings'
    | 'cliLogsTail'
    | 'configReady'
    | 'messageSeverity'
    | 'launchDiagnostics'
  >
): TeamProvisioningProgress {
  // Cap assistant output on every progress tick. `updateProgress` is invoked
  // from ~20 event-driven sites (auth retries, stall warnings, spawn events),
  // and an unbounded `provisioningOutputParts.join` was part of the same OOM
  // class that `emitLogsProgress` already guards against.
  const assistantOutput =
    buildProgressAssistantOutput(run.provisioningOutputParts) ?? run.progress.assistantOutput;
  run.progress = {
    ...run.progress,
    state,
    message,
    updatedAt: nowIso(),
    pid: extras?.pid ?? run.progress.pid,
    error: extras?.error,
    warnings: extras?.warnings,
    cliLogsTail: extras?.cliLogsTail ?? run.progress.cliLogsTail,
    assistantOutput,
    configReady: extras?.configReady ?? run.progress.configReady,
    messageSeverity: extras?.messageSeverity,
    launchDiagnostics: boundLaunchDiagnostics(
      extras?.launchDiagnostics ??
        buildLaunchDiagnosticsFromRun(run) ??
        run.progress.launchDiagnostics
    ),
  };
  return run.progress;
}

function buildLaunchDiagnosticsFromRun(
  run: ProvisioningRun
): TeamLaunchDiagnosticItem[] | undefined {
  const memberSpawnStatuses = run.memberSpawnStatuses;
  if (!run.isLaunch || !memberSpawnStatuses || memberSpawnStatuses.size === 0) {
    return undefined;
  }
  const observedAt = nowIso();
  const items: TeamLaunchDiagnosticItem[] = [];
  for (const [memberName, entry] of memberSpawnStatuses.entries()) {
    if (entry.launchState === 'confirmed_alive') {
      items.push({
        id: `${memberName}:bootstrap_confirmed`,
        memberName,
        severity: 'info',
        code: 'bootstrap_confirmed',
        label: `${memberName} - bootstrap 已确认`,
        observedAt,
      });
      continue;
    }
    if (entry.launchState === 'failed_to_start') {
      items.push({
        id: `${memberName}:bootstrap_stalled`,
        memberName,
        severity: 'error',
        code: 'bootstrap_stalled',
        label: `${memberName} - 启动失败`,
        detail: entry.hardFailureReason ?? entry.error,
        observedAt,
      });
      continue;
    }
    if (entry.launchState === 'runtime_pending_permission') {
      items.push({
        id: `${memberName}:permission_pending`,
        memberName,
        severity: 'warning',
        code: 'permission_pending',
        label: `${memberName} - awaiting permission`,
        detail: entry.runtimeDiagnostic,
        observedAt,
      });
      continue;
    }
    if (mentionsProcessTableUnavailable(entry.runtimeDiagnostic)) {
      items.push({
        id: `${memberName}:process_table_unavailable`,
        memberName,
        severity: 'warning',
        code: 'process_table_unavailable',
        label: `${memberName} - process table unavailable`,
        detail: entry.runtimeDiagnostic,
        observedAt,
      });
      continue;
    }
    if (entry.livenessKind === 'shell_only') {
      items.push({
        id: `${memberName}:tmux_shell_only`,
        memberName,
        severity: 'warning',
        code: 'tmux_shell_only',
        label: `${memberName} - shell only`,
        detail: entry.runtimeDiagnostic,
        observedAt,
      });
      continue;
    }
    if (entry.livenessKind === 'runtime_process_candidate') {
      items.push({
        id: `${memberName}:runtime_process_candidate`,
        memberName,
        severity: 'warning',
        code: 'runtime_process_candidate',
        label: `${memberName} - process candidate`,
        detail: entry.runtimeDiagnostic,
        observedAt,
      });
      continue;
    }
    if (entry.livenessKind === 'runtime_process') {
      items.push({
        id: `${memberName}:runtime_process_detected`,
        memberName,
        severity: 'info',
        code: 'runtime_process_detected',
        label: `${memberName} - waiting for bootstrap`,
        detail: entry.runtimeDiagnostic,
        observedAt,
      });
      continue;
    }
    if (
      entry.livenessKind === 'registered_only' ||
      entry.livenessKind === 'stale_metadata' ||
      entry.livenessKind === 'not_found'
    ) {
      items.push({
        id: `${memberName}:runtime_not_found`,
        memberName,
        severity: 'warning',
        code: 'runtime_not_found',
        label: `${memberName} - no runtime found`,
        detail: entry.runtimeDiagnostic,
        observedAt,
      });
      continue;
    }
    if (entry.agentToolAccepted) {
      items.push({
        id: `${memberName}:spawn_accepted`,
        memberName,
        severity: 'info',
        code: 'spawn_accepted',
        label: `${memberName} - spawn accepted`,
        detail: entry.runtimeDiagnostic,
        observedAt,
      });
    }
  }
  return items.length > 0 ? items : undefined;
}

function buildCombinedLogs(
  stdoutBuffer: string | undefined,
  stderrBuffer: string | undefined
): string {
  const stdoutTrimmed = (stdoutBuffer ?? '').trim();
  const stderrTrimmed = (stderrBuffer ?? '').trim();

  if (stdoutTrimmed.length === 0 && stderrTrimmed.length === 0) {
    return '';
  }
  if (stdoutTrimmed.length > 0 && stderrTrimmed.length === 0) {
    return stdoutTrimmed;
  }
  if (stdoutTrimmed.length === 0 && stderrTrimmed.length > 0) {
    return stderrTrimmed;
  }
  return [`[stdout]`, stdoutTrimmed, '', `[stderr]`, stderrTrimmed].join('\n');
}

interface AgentTeamsMcpConfigEntry {
  command?: unknown;
  args?: unknown;
  env?: unknown;
  cwd?: unknown;
}

interface AgentTeamsMcpConfigFile {
  mcpServers?: Record<string, AgentTeamsMcpConfigEntry>;
}

interface AgentTeamsMcpLaunchSpec {
  command: string;
  args: string[];
  cwd?: string;
  env: Record<string, string>;
}

interface McpJsonRpcErrorPayload {
  code?: number;
  message?: string;
}

interface McpJsonRpcResponse<TResult> {
  id?: number;
  result?: TResult;
  error?: McpJsonRpcErrorPayload;
}

interface McpToolsListResult {
  tools?: {
    name?: string;
    _meta?: Record<string, unknown>;
  }[];
}

interface McpToolCallResult {
  content?: {
    type?: string;
    text?: string;
  }[];
  isError?: boolean;
}

interface AgentTeamsMcpValidationFixture {
  claudeDir: string;
  teamName: string;
  memberName: string;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

function normalizeRecordStringValues(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object') {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value).flatMap(([key, entry]) =>
      typeof entry === 'string' ? [[key, entry]] : []
    )
  );
}

function extractLogsTail(
  stdoutBuffer: string | undefined,
  stderrBuffer: string | undefined
): string | undefined {
  const trimmed = buildCombinedLogs(stdoutBuffer, stderrBuffer).trim();
  if (trimmed.length === 0) {
    return undefined;
  }
  return trimmed.slice(-UI_LOGS_TAIL_LIMIT);
}

/**
 * Builds provisioning CLI logs from the line-buffered claudeLogLines array
 * instead of the byte-capped stdoutBuffer/stderrBuffer ring buffers.
 *
 * claudeLogLines already contains [stdout]/[stderr] markers and individual lines
 * in chronological order (up to CLAUDE_LOG_LINES_LIMIT = 50 000 lines), so it
 * does not suffer from the 64 KB ring-buffer truncation that causes the raw
 * stdoutBuffer to lose older assistant messages.
 *
 * Returns the full launch log history preserved in claudeLogLines. Falls back
 * to the legacy tail extraction only when claudeLogLines is empty (e.g. early
 * in provisioning before any output has been line-split).
 */
function extractCliLogsFromRun(run: ProvisioningRun): string | undefined {
  const claudeLogLines = Array.isArray(run.claudeLogLines) ? run.claudeLogLines : [];
  if (claudeLogLines.length > 0) {
    const joined = claudeLogLines.join('\n').trim();
    if (joined.length === 0) {
      return undefined;
    }
    return joined;
  }
  return extractLogsTail(run.stdoutBuffer, run.stderrBuffer);
}

interface RetainedClaudeLogsSnapshot {
  lines: string[];
  updatedAt?: string;
}

interface PersistedTranscriptClaudeLogsCacheEntry {
  transcriptPath: string;
  mtimeMs: number;
  size: number;
  snapshot: RetainedClaudeLogsSnapshot;
}

function buildRetainedClaudeLogsSnapshot(run: ProvisioningRun): RetainedClaudeLogsSnapshot | null {
  const claudeLogLines = Array.isArray(run.claudeLogLines) ? run.claudeLogLines : [];
  if (claudeLogLines.length > 0) {
    return {
      lines: [...claudeLogLines],
      updatedAt: run.claudeLogsUpdatedAt,
    };
  }

  const fallback = extractCliLogsFromRun(run);
  if (!fallback) {
    return null;
  }

  const lines = fallback
    .split('\n')
    .map((line) => (line.endsWith('\r') ? line.slice(0, -1) : line))
    .filter((line) => line.length > 0);

  if (lines.length === 0) {
    return null;
  }

  return {
    lines,
    updatedAt: run.claudeLogsUpdatedAt ?? run.progress.updatedAt,
  };
}

function sliceClaudeLogs(
  linesChronological: string[],
  updatedAt: string | undefined,
  query?: { offset?: number; limit?: number }
): { lines: string[]; total: number; hasMore: boolean; updatedAt?: string } {
  const offsetRaw = query?.offset ?? 0;
  const limitRaw = query?.limit ?? 100;
  const offset = Number.isFinite(offsetRaw) ? Math.max(0, Math.floor(offsetRaw)) : 0;
  const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(1000, Math.floor(limitRaw))) : 100;

  const total = linesChronological.length;
  if (total === 0) {
    return { lines: [], total: 0, hasMore: false, updatedAt };
  }

  const newestExclusive = Math.max(0, total - offset);
  const oldestInclusive = Math.max(0, newestExclusive - limit);
  const normalizeLine = (line: string): string => {
    // Back-compat: older builds prefixed every line with "[stdout] " / "[stderr] "
    if (line.startsWith('[stdout] ') && line !== '[stdout]') {
      return line.slice('[stdout] '.length);
    }
    if (line.startsWith('[stderr] ') && line !== '[stderr]') {
      return line.slice('[stderr] '.length);
    }
    return line;
  };

  const lines = linesChronological
    .slice(oldestInclusive, newestExclusive)
    .map(normalizeLine)
    .toReversed();

  return {
    lines,
    total,
    hasMore: oldestInclusive > 0,
    updatedAt,
  };
}

/**
 * Emit a throttled progress update for the renderer. Payloads are capped to a
 * tail window so that the hot emission path (called every LOG_PROGRESS_THROTTLE_MS
 * under streaming output) cannot accumulate into multi-megabyte IPC messages
 * that would OOM the renderer's Zustand state. The full history stays in
 * `run.claudeLogLines` / `run.provisioningOutputParts` for diagnostics and
 * one-shot completion emissions that intentionally use `extractCliLogsFromRun`.
 */
function emitLogsProgress(run: ProvisioningRun): void {
  // Prefer the line-buffered history (already chronological with [stdout]/[stderr]
  // markers) and fall back to the legacy ring-buffer tail only when no lines
  // have been captured yet (early in provisioning).
  const logsTail =
    buildProgressLogsTail(run.claudeLogLines) ??
    extractLogsTail(run.stdoutBuffer, run.stderrBuffer);
  const assistantOutput = buildProgressAssistantOutput(run.provisioningOutputParts);

  if (!logsTail && !assistantOutput) {
    return;
  }
  run.progress = {
    ...run.progress,
    updatedAt: nowIso(),
    ...(logsTail !== undefined && { cliLogsTail: logsTail }),
    ...(assistantOutput !== undefined && { assistantOutput }),
  };
  run.onProgress(run.progress);
}

function buildCliExitError(code: number | null, stdoutText: string, stderrText: string): string {
  const trimmed = buildCombinedLogs(stdoutText, stderrText).trim();
  const cliCommandLabel = getConfiguredCliCommandLabel();
  if (trimmed.length > 0) {
    if (trimmed.toLowerCase().includes('please run /login')) {
      return (
        `${cliCommandLabel} 报告尚未认证（"Please run /login"）。` +
        '请在普通终端中运行 CLI 并完成登录，然后重试。' +
        'For automation/headless use, set `ANTHROPIC_API_KEY` for `-p` mode.'
      );
    }
    return trimmed.slice(-4000);
  }

  if (code === 1) {
    return `${cliCommandLabel} exited with code 1 without stdout/stderr. Typical causes: missing auth/onboarding, interactive TTY requirements, or an early bootstrap/runtime crash. Check \`~/.claude/debug/latest\` for the real stack and retry.`;
  }

  return `${cliCommandLabel} exited with code ${code ?? 'unknown'}`;
}

interface CachedProbeResult {
  cacheKey: string;
  claudePath: string;
  authSource: ProvisioningAuthSource;
  warning?: string;
  cachedAtMs: number;
}

interface ProbeResult {
  claudePath: string;
  authSource: ProvisioningAuthSource;
  warning?: string;
}

type AuthWarningSource = 'probe' | 'stdout' | 'stderr' | 'assistant' | 'pre-complete';

const cachedProbeResults = new Map<string, CachedProbeResult>();
const probeInFlightByKey = new Map<string, Promise<ProbeResult | null>>();

function createProbeCacheKey(cwd: string, providerId: TeamProviderId | undefined): string {
  return `${path.resolve(cwd)}::${getClaudeBasePath()}::${resolveTeamProviderId(providerId)}`;
}

function isTransientProbeWarning(warning: string): boolean {
  const lower = warning.toLowerCase();
  return (
    lower.includes('timeout running:') ||
    lower.includes('did not complete') ||
    lower.includes('runtime status was unavailable') ||
    lower.includes('runtime status check did not complete') ||
    lower.includes('timed out') ||
    lower.includes('etimedout') ||
    lower.includes('econnreset') ||
    lower.includes('eai_again')
  );
}

function isBinaryProbeWarning(warning: string): boolean {
  const lower = warning.toLowerCase();
  return (
    (lower.includes('spawn ') && lower.includes(' enoent')) ||
    lower.includes('eacces') ||
    lower.includes('enoexec') ||
    lower.includes('bad cpu type in executable') ||
    lower.includes('image not found')
  );
}

interface PendingInboxRelayCandidate {
  recipient: string;
  sourceMessageId: string;
  normalizedText: string;
  normalizedSummary: string;
  queuedAtMs: number;
}

interface NativeSameTeamFingerprint {
  id: string;
  from: string;
  text: string;
  summary: string;
  seenAt: number;
}

interface OpenCodeMemberInboxDelivery {
  delivered: boolean;
  accepted?: boolean;
  responsePending?: boolean;
  acceptanceUnknown?: boolean;
  responseState?: NonNullable<OpenCodeTeamRuntimeMessageResult['responseObservation']>['state'];
  ledgerStatus?: OpenCodePromptDeliveryStatus;
  ledgerRecordId?: string;
  laneId?: string;
  visibleReplyMessageId?: string;
  visibleReplyCorrelation?:
    | 'relayOfMessageId'
    | 'direct_child_message_send'
    | 'plain_assistant_text';
  queuedBehindMessageId?: string;
  reason?: string;
  diagnostics?: string[];
}

interface OpenCodeMemberInboxRelayResult {
  relayed: number;
  attempted: number;
  delivered: number;
  failed: number;
  lastDelivery?: OpenCodeMemberInboxDelivery;
  diagnostics?: string[];
}

interface LiveInboxRelayResult {
  kind:
    | 'ignored'
    | 'native_lead'
    | 'native_member_noop'
    | 'opencode_member'
    | 'opencode_lead_unsupported';
  relayed: number;
  diagnostics?: string[];
  lastDelivery?: OpenCodeMemberInboxDelivery;
}

interface OpenCodeMemberInboxRelayOptions {
  onlyMessageId?: string;
  source?: 'watcher' | 'ui-send' | 'manual' | 'watchdog';
  deliveryMetadata?: {
    replyRecipient?: string;
    actionMode?: AgentActionMode;
    taskRefs?: TaskRef[];
  };
}

function normalizeSameTeamText(text: string): string {
  return text.trim().replace(/\r\n/g, '\n');
}

export class TeamProvisioningService {
  private readonly runtimeLaneCoordinator = createTeamRuntimeLaneCoordinator();
  private readonly providerConnectionService = ProviderConnectionService.getInstance();

  private static readonly CLAUDE_LOG_LINES_LIMIT = 50_000;
  private static readonly BOOTSTRAP_FAILURE_TAIL_BYTES = 128 * 1024;
  private static readonly RECENT_CROSS_TEAM_DELIVERY_TTL_MS = 10 * 60 * 1000;
  private static readonly PENDING_INBOX_RELAY_TTL_MS = 2 * 60 * 1000;
  private static readonly SAME_TEAM_NATIVE_DELIVERY_GRACE_MS = 15_000;
  private static readonly SAME_TEAM_NATIVE_FINGERPRINT_TTL_MS = 60_000;
  private static readonly SAME_TEAM_MATCH_WINDOW_MS = 30_000;
  private static readonly SAME_TEAM_RUN_START_SKEW_MS = 1_000;
  private static readonly SAME_TEAM_PERSIST_RETRY_MS = 2_000;
  private static readonly AGENT_RUNTIME_SNAPSHOT_CACHE_TTL_MS = 2_000;

  private readonly runs = new Map<string, ProvisioningRun>();
  private readonly provisioningRunByTeam = new Map<string, string>();
  private readonly aliveRunByTeam = new Map<string, string>();
  private readonly runtimeAdapterProgressByRunId = new Map<string, TeamProvisioningProgress>();
  private readonly runtimeAdapterRunByTeam = new Map<
    string,
    {
      runId: string;
      providerId: TeamProviderId;
      cwd?: string;
      members?: Record<string, TeamRuntimeMemberLaunchEvidence>;
    }
  >();
  private readonly cancelledRuntimeAdapterRunIds = new Set<string>();
  private stopAllTeamsGeneration = 0;
  private readonly transientProbeProcesses = new Set<ReturnType<typeof spawn>>();
  private readonly secondaryRuntimeRunByTeam = new Map<
    string,
    Map<
      string,
      { runId: string; providerId: 'opencode'; laneId: string; memberName: string; cwd?: string }
    >
  >();
  private readonly stoppingSecondaryRuntimeTeams = new Set<string>();
  private readonly retainedClaudeLogsByTeam = new Map<string, RetainedClaudeLogsSnapshot>();
  private readonly teamSendBlockReasonByTeam = new Map<string, string>();
  private readonly persistedTranscriptClaudeLogsCache = new Map<
    string,
    PersistedTranscriptClaudeLogsCacheEntry
  >();
  private readonly teamOpLocks = new Map<string, Promise<void>>();
  private readonly leadInboxRelayInFlight = new Map<string, Promise<number>>();
  private readonly relayedLeadInboxMessageIds = new Map<string, Set<string>>();
  private readonly inFlightLeadInboxMessageIds = new Map<string, Set<string>>();
  private readonly memberInboxRelayInFlight = new Map<string, Promise<number>>();
  private readonly openCodeMemberInboxRelayInFlight = new Map<
    string,
    Promise<OpenCodeMemberInboxRelayResult>
  >();
  private readonly openCodePromptDeliveryWatchdogTimers = new Map<string, NodeJS.Timeout>();
  private readonly openCodePromptDeliveryWatchdogQueue: {
    teamName: string;
    run: () => Promise<void>;
  }[] = [];
  private openCodePromptDeliveryWatchdogInFlight = 0;
  private openCodePromptDeliveryWatchdogDisabledLogged = false;
  private readonly openCodePromptDeliveryWatchdogInFlightByTeam = new Map<string, number>();
  private readonly relayedMemberInboxMessageIds = new Map<string, Set<string>>();
  private readonly pendingCrossTeamFirstReplies = new Map<string, Map<string, number>>();
  private readonly recentCrossTeamLeadDeliveryMessageIds = new Map<string, Map<string, number>>();
  private readonly liveLeadProcessMessages = new Map<string, InboxMessage[]>();
  private readonly recentSameTeamNativeFingerprints = new Map<
    string,
    NativeSameTeamFingerprint[]
  >();
  private readonly agentRuntimeSnapshotCache = new Map<
    string,
    { expiresAtMs: number; snapshot: TeamAgentRuntimeSnapshot }
  >();
  private sshConnectionManager: SshConnectionManager | null = null;
  private readonly remoteRuntimeByTeam = new Map<
    string,
    { runId: string; machineId: string; pid?: number; cwd: string; startedAt: string }
  >();
  private readonly liveTeamAgentRuntimeMetadataCache = new Map<
    string,
    { expiresAtMs: number; metadata: Map<string, LiveTeamAgentRuntimeMetadata> }
  >();
  private readonly launchStateStore = new TeamLaunchStateStore();
  private readonly memberLogsFinder: TeamMemberLogsFinder;
  private readonly transcriptProjectResolver: TeamTranscriptProjectResolver;
  private teamChangeEmitter: ((event: TeamChangeEvent) => void) | null = null;
  private helpOutputCache: string | null = null;
  private helpOutputCacheTime = 0;
  private static readonly HELP_CACHE_TTL_MS = 5 * 60 * 1000;
  private toolApprovalSettingsByTeam = new Map<string, ToolApprovalSettings>();
  // Process-level cache for provider launch facts (model list + runtime status).
  // Shared across materializeEffectiveTeamMemberSpecs and resolveAndValidateLaunchIdentity
  // so we don't spawn duplicate CLI subprocesses for the same provider.
  private readonly providerLaunchFactsCache = new Map<
    string,
    { promise: Promise<RuntimeProviderLaunchFacts>; expiresAt: number }
  >();
  private static readonly PROVIDER_FACTS_TTL_MS = 60_000;
  private pendingTimeouts = new Map<string, NodeJS.Timeout>();
  private inFlightResponses = new Set<string>();
  private runtimeAdapterRegistry: TeamRuntimeAdapterRegistry | null = null;
  private controlApiBaseUrlResolver: (() => Promise<string | null>) | null = null;
  private crossTeamSender:
    | ((request: {
        fromTeam: string;
        fromMember: string;
        toTeam: string;
        text: string;
        summary?: string;
        messageId?: string;
        timestamp?: string;
        conversationId?: string;
        replyToConversationId?: string;
      }) => Promise<CrossTeamSendResult>)
    | null = null;

  constructor(
    private readonly configReader: TeamConfigReader = new TeamConfigReader(),
    private readonly inboxReader: TeamInboxReader = new TeamInboxReader(),
    private readonly membersMetaStore: TeamMembersMetaStore = new TeamMembersMetaStore(),
    private readonly sentMessagesStore: TeamSentMessagesStore = new TeamSentMessagesStore(),
    private readonly mcpConfigBuilder: TeamMcpConfigBuilder = new TeamMcpConfigBuilder(),
    private readonly teamMetaStore: TeamMetaStore = new TeamMetaStore(),
    private readonly inboxWriter: TeamInboxWriter = new TeamInboxWriter(),
    private readonly openCodeTaskLogAttributionStore: OpenCodeTaskLogAttributionStore = new OpenCodeTaskLogAttributionStore(),
    private readonly memberWorktreeManager: TeamMemberWorktreeManager = new TeamMemberWorktreeManager(),
    private readonly skillProjectionService: SkillProjectionService = new SkillProjectionService()
  ) {
    this.memberLogsFinder = new TeamMemberLogsFinder(
      this.configReader,
      this.inboxReader,
      this.membersMetaStore
    );
    this.transcriptProjectResolver = new TeamTranscriptProjectResolver(this.configReader);
    setTimeout(() => {
      this.killEmptyOrphanedClaudeSwarmTmuxServers('startup');
    }, 5_000).unref?.();
  }

  setRuntimeAdapterRegistry(registry: TeamRuntimeAdapterRegistry | null): void {
    this.runtimeAdapterRegistry = registry;
  }

  setSshConnectionManager(manager: SshConnectionManager | null): void {
    this.sshConnectionManager = manager;
  }

  private isRemoteExecutionTarget(
    target: TeamCreateRequest['executionTarget']
  ): target is { type: 'ssh'; machineId: string; cwd?: string } {
    return (
      target?.type === 'ssh' && typeof target.machineId === 'string' && target.machineId.length > 0
    );
  }

  private shellQuote(value: string): string {
    return `'${value.replace(/'/g, `'\\''`)}'`;
  }

  private async ensureRemoteMachineConnected(machineId: string): Promise<void> {
    if (!this.sshConnectionManager) {
      throw new Error('SSH connection manager is not available');
    }
    if (this.sshConnectionManager.getMachineStatus(machineId)?.state === 'connected') {
      return;
    }
    const machine = ConfigManager.getInstance()
      .getMachineProfiles()
      .find((profile) => profile.id === machineId);
    if (!machine) {
      throw new Error(`Machine profile not found: ${machineId}`);
    }
    await this.sshConnectionManager.connectMachine(machineId, {
      host: machine.host,
      port: machine.port,
      username: machine.username,
      authMethod: machine.authMethod,
      privateKeyPath: machine.privateKeyPath,
    });
  }

  private async writeRemoteJson(
    machineId: string,
    filePath: string,
    payload: unknown
  ): Promise<void> {
    if (!this.sshConnectionManager) {
      throw new Error('SSH connection manager is not available');
    }
    const encoded = Buffer.from(JSON.stringify(payload, null, 2), 'utf8').toString('base64');
    const dir = path.posix.dirname(filePath);
    const command = `mkdir -p ${this.shellQuote(dir)} && printf %s ${this.shellQuote(
      encoded
    )} | base64 -d > ${this.shellQuote(filePath)}`;
    const result = await this.sshConnectionManager.execOnMachine(machineId, command);
    if (result.exitCode !== 0) {
      throw new Error(result.stderr.trim() || `Failed to write remote file: ${filePath}`);
    }
  }

  private buildRemoteClaudeCommand(request: TeamCreateRequest | TeamLaunchRequest): string {
    const prompt =
      request.prompt?.trim() ||
      `启动团队 ${request.teamName}，读取当前目录中的团队控制文件并按其中的任务执行。`;
    const args = [
      '-p',
      prompt,
      ...(request.model ? ['--model', request.model] : []),
      ...(request.effort ? ['--effort', request.effort] : []),
      ...(request.skipPermissions !== false ? ['--dangerously-skip-permissions'] : []),
      ...parseCliArgs(request.extraCliArgs),
    ];
    return `claude ${args.map((arg) => this.shellQuote(arg)).join(' ')}`;
  }

  private async runRemoteTeam(
    request: TeamCreateRequest | TeamLaunchRequest,
    onProgress: (progress: TeamProvisioningProgress) => void,
    mode: 'create' | 'launch'
  ): Promise<TeamCreateResponse | TeamLaunchResponse> {
    const target = request.executionTarget;
    if (!this.isRemoteExecutionTarget(target)) {
      throw new Error('Remote team launch requires an SSH execution target');
    }
    if (!this.sshConnectionManager) {
      throw new Error('SSH connection manager is not available');
    }

    const runId = randomUUID();
    const startedAt = nowIso();
    const cwd = target.cwd || request.cwd;
    const teamDir = path.posix.join(
      cwd,
      '.claude',
      'agent-teams-control',
      'teams',
      request.teamName
    );
    const runtimeDir = path.posix.join(teamDir, 'runtime');
    const logsDir = path.posix.join(teamDir, 'logs');
    const logPath = path.posix.join(logsDir, `${runId}.log`);

    const emit = (
      state: TeamProvisioningProgress['state'],
      message: string,
      extra: Partial<TeamProvisioningProgress> = {}
    ): void => {
      const now = nowIso();
      onProgress({
        runId,
        teamName: request.teamName,
        state,
        message,
        startedAt,
        updatedAt: now,
        ...extra,
      });
    };

    emit('validating', '正在连接远程机器');
    await this.ensureRemoteMachineConnected(target.machineId);

    emit('configuring', '正在写入远程团队控制文件');
    if (mode === 'create' && 'members' in request) {
      const localTeamDir = path.join(getTeamsBasePath(), request.teamName);
      const localTasksDir = path.join(getTasksBasePath(), request.teamName);
      await fs.promises.mkdir(localTeamDir, { recursive: true }).catch(() => undefined);
      await fs.promises.mkdir(localTasksDir, { recursive: true }).catch(() => undefined);
      await this.teamMetaStore
        .writeMeta(request.teamName, {
          displayName: request.displayName,
          description: request.description,
          color: request.color,
          cwd,
          executionTarget: request.executionTarget,
          prompt: request.prompt,
          providerId: request.providerId,
          providerBackendId: request.providerBackendId,
          model: request.model,
          effort: request.effort,
          fastMode: request.fastMode,
          skipPermissions: request.skipPermissions,
          worktree: request.worktree,
          extraCliArgs: request.extraCliArgs,
          limitContext: request.limitContext,
          createdAt: Date.now(),
        })
        .catch(() => undefined);
      await this.membersMetaStore
        .writeMembers(request.teamName, this.buildMembersMetaWritePayload(request.members), {
          providerBackendId: request.providerBackendId,
        })
        .catch(() => undefined);
    }
    const controlPayload = {
      version: 1,
      mode,
      runId,
      teamName: request.teamName,
      cwd,
      executionTarget: request.executionTarget,
      providerId: request.providerId,
      providerBackendId: request.providerBackendId,
      model: request.model,
      effort: request.effort,
      fastMode: request.fastMode,
      prompt: request.prompt,
      members: 'members' in request ? request.members : undefined,
      createdAt: startedAt,
    };
    await this.writeRemoteJson(
      target.machineId,
      path.posix.join(teamDir, 'request.json'),
      controlPayload
    );
    await this.writeRemoteJson(target.machineId, path.posix.join(runtimeDir, 'status.json'), {
      version: 1,
      runId,
      teamName: request.teamName,
      state: 'starting',
      machineId: target.machineId,
      cwd,
      logPath,
      updatedAt: nowIso(),
    });

    emit('spawning', '正在远程启动 ClaudeCode');
    const claudeCommand = this.buildRemoteClaudeCommand(request);
    const launchCommand = [
      `mkdir -p ${this.shellQuote(runtimeDir)} ${this.shellQuote(logsDir)}`,
      `cd ${this.shellQuote(cwd)}`,
      `nohup sh -lc ${this.shellQuote(claudeCommand)} > ${this.shellQuote(logPath)} 2>&1 & echo $!`,
    ].join(' && ');
    const result = await this.sshConnectionManager.execOnMachine(target.machineId, launchCommand);
    if (result.exitCode !== 0) {
      await this.writeRemoteJson(target.machineId, path.posix.join(runtimeDir, 'status.json'), {
        version: 1,
        runId,
        teamName: request.teamName,
        state: 'failed',
        machineId: target.machineId,
        cwd,
        logPath,
        error: result.stderr.trim() || 'Remote launch failed',
        updatedAt: nowIso(),
      });
      throw new Error(result.stderr.trim() || 'Remote launch failed');
    }

    const pid = Number(result.stdout.trim().split(/\s+/)[0]);
    await this.writeRemoteJson(target.machineId, path.posix.join(runtimeDir, 'status.json'), {
      version: 1,
      runId,
      teamName: request.teamName,
      state: 'running',
      machineId: target.machineId,
      pid: Number.isFinite(pid) ? pid : undefined,
      cwd,
      logPath,
      command: claudeCommand,
      updatedAt: nowIso(),
    });
    this.remoteRuntimeByTeam.set(request.teamName, {
      runId,
      machineId: target.machineId,
      pid: Number.isFinite(pid) ? pid : undefined,
      cwd,
      startedAt,
    });
    this.aliveRunByTeam.set(request.teamName, runId);
    this.provisioningRunByTeam.delete(request.teamName);
    emit('ready', '远程 ClaudeCode 已启动', {
      pid: Number.isFinite(pid) ? pid : undefined,
      configReady: true,
    });
    return { runId };
  }

  setCrossTeamSender(
    sender:
      | ((request: {
          fromTeam: string;
          fromMember: string;
          toTeam: string;
          text: string;
          summary?: string;
          messageId?: string;
          timestamp?: string;
          conversationId?: string;
          replyToConversationId?: string;
        }) => Promise<CrossTeamSendResult>)
      | null
  ): void {
    this.crossTeamSender = sender;
  }

  setControlApiBaseUrlResolver(resolver: (() => Promise<string | null>) | null): void {
    this.controlApiBaseUrlResolver = resolver;
  }

  private async readRuntimeProviderLaunchFacts(params: {
    claudePath: string;
    cwd: string;
    providerId: TeamProviderId;
    env: NodeJS.ProcessEnv;
    providerArgs?: string[];
    limitContext?: boolean;
  }): Promise<RuntimeProviderLaunchFacts> {
    const cacheKey = `${params.providerId}:${params.limitContext ? 'lc' : 'std'}`;
    const cached = this.providerLaunchFactsCache.get(cacheKey);
    if (cached && Date.now() < cached.expiresAt) {
      return cached.promise;
    }
    const promise = this._readRuntimeProviderLaunchFactsInner(params);
    this.providerLaunchFactsCache.set(cacheKey, {
      promise,
      expiresAt: Date.now() + TeamProvisioningService.PROVIDER_FACTS_TTL_MS,
    });
    // On failure, evict so next call retries
    promise.catch(() => this.providerLaunchFactsCache.delete(cacheKey));
    return promise;
  }

  private async _readRuntimeProviderLaunchFactsInner(params: {
    claudePath: string;
    cwd: string;
    providerId: TeamProviderId;
    env: NodeJS.ProcessEnv;
    providerArgs?: string[];
    limitContext?: boolean;
  }): Promise<RuntimeProviderLaunchFacts> {
    const providerArgs = params.providerArgs ?? [];
    const modelListPromise = execCli(
      params.claudePath,
      buildProviderCliCommandArgs(providerArgs, [
        'model',
        'list',
        '--json',
        '--provider',
        params.providerId,
      ]),
      {
        cwd: params.cwd,
        env: params.env,
        timeout: 10_000,
      }
    );
    const runtimeStatusPromise =
      params.providerId === 'codex' || params.providerId === 'anthropic'
        ? execCli(
            params.claudePath,
            buildProviderCliCommandArgs(providerArgs, [
              'runtime',
              'status',
              '--json',
              '--provider',
              params.providerId,
            ]),
            {
              cwd: params.cwd,
              env: params.env,
              timeout: 8_000,
            }
          )
        : null;

    const [modelListResult, runtimeStatusResult] = await Promise.allSettled([
      modelListPromise,
      runtimeStatusPromise,
    ]);

    let defaultModel: string | null = null;
    let modelIds = new Set<string>();
    if (modelListResult.status === 'fulfilled') {
      try {
        const parsed = extractJsonObjectFromCli<ProviderModelListCommandResponse>(
          modelListResult.value.stdout
        );
        const provider = parsed.providers?.[params.providerId];
        defaultModel =
          typeof provider?.defaultModel === 'string' && provider.defaultModel.trim().length > 0
            ? provider.defaultModel.trim()
            : null;
        modelIds = normalizeProviderModelListModels(provider);
      } catch (error) {
        logger.warn(
          `[${params.providerId}] Failed to parse runtime model list for launch validation: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }
    }

    let runtimeCapabilities: CliProviderRuntimeCapabilities | null = null;
    let modelCatalog: CliProviderModelCatalog | null = null;
    let providerStatus: RuntimeProviderLaunchFacts['providerStatus'] = null;
    if (
      runtimeStatusResult.status === 'fulfilled' &&
      runtimeStatusResult.value &&
      typeof runtimeStatusResult.value.stdout === 'string'
    ) {
      try {
        const parsed = extractJsonObjectFromCli<RuntimeStatusCommandResponse>(
          runtimeStatusResult.value.stdout
        );
        const parsedProviderStatus = parsed.providers?.[params.providerId] ?? null;
        providerStatus = parsedProviderStatus
          ? {
              ...parsedProviderStatus,
              providerId: parsedProviderStatus.providerId ?? params.providerId,
            }
          : null;
        runtimeCapabilities = providerStatus?.runtimeCapabilities ?? null;
        modelCatalog =
          providerStatus?.modelCatalog?.providerId === params.providerId
            ? providerStatus.modelCatalog
            : null;
      } catch (error) {
        logger.warn(
          `[${params.providerId}] Failed to parse runtime capabilities for launch validation: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }
    }

    if (modelCatalog) {
      for (const model of modelCatalog.models ?? []) {
        const launchModel = model.launchModel?.trim();
        if (launchModel) {
          modelIds.add(launchModel);
        }
        const catalogId = model.id?.trim();
        if (catalogId) {
          modelIds.add(catalogId);
        }
      }
      defaultModel = modelCatalog.defaultLaunchModel?.trim() || defaultModel;
    }

    if (params.providerId === 'codex' && runtimeCapabilities?.modelCatalog?.dynamic === true) {
      const codexCatalog = await this.providerConnectionService.getCodexModelCatalog({
        cwd: params.cwd,
      });
      if (codexCatalog?.providerId === 'codex' && codexCatalog.status === 'ready') {
        for (const model of codexCatalog.models ?? []) {
          const launchModel = model.launchModel?.trim();
          if (launchModel) {
            modelIds.add(launchModel);
          }
          const catalogId = model.id?.trim();
          if (catalogId) {
            modelIds.add(catalogId);
          }
        }

        if (!modelCatalog) {
          modelCatalog = codexCatalog;
        }
        defaultModel = codexCatalog.defaultLaunchModel?.trim() || defaultModel;
      }
    }

    return {
      defaultModel:
        params.providerId === 'anthropic'
          ? resolveAnthropicLaunchModel({
              limitContext: params.limitContext === true,
              availableLaunchModels:
                modelCatalog?.models.map((model) => model.launchModel) ?? modelIds,
              defaultLaunchModel: defaultModel,
            })
          : defaultModel,
      modelIds,
      modelCatalog,
      runtimeCapabilities,
      providerStatus,
    };
  }

  private buildProviderModelLaunchIdentity(params: {
    request: Pick<
      TeamCreateRequest,
      'providerId' | 'providerBackendId' | 'model' | 'effort' | 'fastMode' | 'limitContext'
    >;
    facts: RuntimeProviderLaunchFacts;
  }): ProviderModelLaunchIdentity {
    const providerId = resolveTeamProviderId(params.request.providerId);
    const explicitModel = getExplicitLaunchModelSelection(params.request.model);
    const resolvedLaunchModel = resolveRequestedLaunchModel({
      providerId,
      selectedModel: params.request.model,
      limitContext: params.request.limitContext,
      facts: params.facts,
    });
    if (providerId === 'anthropic') {
      const selection = resolveAnthropicSelectionFromFacts({
        selectedModel: params.request.model,
        limitContext: params.request.limitContext,
        facts: params.facts,
      });
      const fastResolution = resolveAnthropicFastMode({
        selection,
        selectedFastMode: params.request.fastMode,
        providerFastModeDefault: getAnthropicFastModeDefault(),
      });
      const requestedEffort = params.request.effort ?? null;
      const resolvedEffort =
        requestedEffort &&
        !isAnthropicOneMillionModel(selection.resolvedLaunchModel ?? resolvedLaunchModel) &&
        selection.supportedEfforts.includes(requestedEffort)
          ? requestedEffort
          : null;

      return {
        providerId,
        providerBackendId:
          migrateProviderBackendId(providerId, params.request.providerBackendId) ?? null,
        selectedModel: explicitModel ?? null,
        selectedModelKind: explicitModel ? 'explicit' : 'default',
        resolvedLaunchModel: selection.resolvedLaunchModel ?? resolvedLaunchModel,
        catalogId:
          selection.catalogModel?.id?.trim() ||
          selection.resolvedLaunchModel ||
          resolvedLaunchModel,
        catalogSource: selection.catalogSource,
        catalogFetchedAt: selection.catalogFetchedAt,
        selectedEffort: params.request.effort ?? null,
        resolvedEffort,
        selectedFastMode: params.request.fastMode ?? 'inherit',
        resolvedFastMode: fastResolution.resolvedFastMode,
        fastResolutionReason: fastResolution.disabledReason,
      };
    }

    if (providerId === 'codex') {
      const selection = resolveCodexSelectionFromFacts({
        selectedModel: params.request.model,
        providerBackendId: params.request.providerBackendId,
        facts: params.facts,
      });
      const fastResolution = resolveCodexFastMode({
        selection,
        selectedFastMode: params.request.fastMode,
      });
      const resolvedCodexModel = selection.resolvedLaunchModel ?? resolvedLaunchModel;

      return {
        providerId,
        providerBackendId:
          migrateProviderBackendId(providerId, params.request.providerBackendId) ??
          selection.providerBackendId,
        selectedModel: explicitModel ?? null,
        selectedModelKind: explicitModel ? 'explicit' : 'default',
        resolvedLaunchModel: resolvedCodexModel,
        catalogId:
          selection.catalogModel?.id?.trim() || selection.resolvedLaunchModel || resolvedCodexModel,
        catalogSource: selection.catalogSource,
        catalogFetchedAt: selection.catalogFetchedAt,
        selectedEffort: params.request.effort ?? null,
        resolvedEffort: params.request.effort ?? null,
        selectedFastMode: params.request.fastMode ?? 'inherit',
        resolvedFastMode: fastResolution.resolvedFastMode,
        fastResolutionReason: fastResolution.disabledReason,
      };
    }

    const resolvedEffort = params.request.effort ?? null;

    return {
      providerId,
      providerBackendId:
        migrateProviderBackendId(providerId, params.request.providerBackendId) ?? null,
      selectedModel: explicitModel ?? null,
      selectedModelKind: explicitModel ? 'explicit' : 'default',
      resolvedLaunchModel,
      catalogId: resolvedLaunchModel,
      catalogSource: 'runtime',
      catalogFetchedAt: null,
      selectedEffort: params.request.effort ?? null,
      resolvedEffort,
    };
  }

  private validateRuntimeLaunchSelection(params: {
    actorLabel: string;
    providerId: TeamProviderId;
    model?: string;
    effort?: EffortLevel;
    fastMode?: TeamFastMode;
    limitContext?: boolean;
    facts: RuntimeProviderLaunchFacts;
  }): void {
    const explicitModel = getExplicitLaunchModelSelection(params.model);

    if (params.providerId === 'anthropic') {
      const selection = resolveAnthropicSelectionFromFacts({
        selectedModel: params.model,
        limitContext: params.limitContext,
        facts: params.facts,
      });
      const resolvedLaunchModel = selection.resolvedLaunchModel?.trim() || null;
      if (!resolvedLaunchModel) {
        throw new Error(
          `${params.actorLabel} could not resolve the selected Anthropic model against the current runtime catalog.`
        );
      }
      if (params.facts.modelIds.size > 0 && !params.facts.modelIds.has(resolvedLaunchModel)) {
        throw new Error(
          `${params.actorLabel} resolves to Anthropic model "${resolvedLaunchModel}", but the current runtime does not list it as launchable.`
        );
      }
      const fastResolution = resolveAnthropicFastMode({
        selection,
        selectedFastMode: params.fastMode,
        providerFastModeDefault: getAnthropicFastModeDefault(),
      });
      if ((params.fastMode ?? 'inherit') === 'on' && !fastResolution.selectable) {
        throw new Error(
          `${params.actorLabel} 启用了 Anthropic Fast mode，但${
            fastResolution.disabledReason ?? '所选运行时或模型不可用。'
          }`
        );
      }
      if (params.effort) {
        if (isAnthropicOneMillionModel(resolvedLaunchModel)) {
          throw new Error(
            `${params.actorLabel} 使用了 effort "${params.effort}"，但 1M token 模型不支持 effort 参数。`
          );
        }
        if (!selection.supportedEfforts.includes(params.effort)) {
          throw new Error(
            `${params.actorLabel} 使用了 effort "${params.effort}"，但当前 Anthropic 运行时/模型不支持此 effort。支持的值：${selection.supportedEfforts.join(', ') || '（无）'}`
          );
        }
      }
      return;
    }

    if (params.providerId !== 'codex') {
      if (params.effort && !isLegacySafeEffort(params.effort)) {
        throw new Error(
          `${params.actorLabel} uses effort "${params.effort}", but ${getTeamProviderLabel(
            params.providerId
          )} currently supports only low, medium, or high effort in Agent Teams.`
        );
      }
      return;
    }

    if (
      params.effort &&
      !isCodexEffortRuntimeSupported(params.effort, params.facts.runtimeCapabilities)
    ) {
      throw new Error(
        `${params.actorLabel} uses Codex effort "${params.effort}", but this Agent Teams runtime does not expose Codex reasoning config passthrough yet. Use low, medium, or high for now.`
      );
    }

    const codexSelection = resolveCodexSelectionFromFacts({
      selectedModel: params.model,
      facts: params.facts,
    });
    const codexFastResolution = resolveCodexFastMode({
      selection: codexSelection,
      selectedFastMode: params.fastMode,
    });
    if ((params.fastMode ?? 'inherit') === 'on' && !codexFastResolution.selectable) {
      throw new Error(
        `${params.actorLabel} enables Codex Fast mode, but ${
          codexFastResolution.disabledReason ??
          'it is unavailable for the selected runtime, model, or auth mode.'
        }`
      );
    }

    if (!explicitModel || params.facts.modelIds.has(explicitModel)) {
      return;
    }

    if (params.facts.runtimeCapabilities?.modelCatalog?.dynamic === true) {
      return;
    }

    throw new Error(
      `${params.actorLabel} uses Codex model "${explicitModel}", but this Agent Teams runtime does not declare dynamic Codex model launch support yet. Upgrade the runtime or pick a listed Codex model.`
    );
  }

  private async resolveAndValidateLaunchIdentity(params: {
    claudePath: string;
    cwd: string;
    env: NodeJS.ProcessEnv;
    request: Pick<
      TeamCreateRequest,
      'providerId' | 'providerBackendId' | 'model' | 'effort' | 'fastMode' | 'limitContext'
    >;
    effectiveMembers: TeamCreateRequest['members'];
  }): Promise<ProviderModelLaunchIdentity> {
    const leadProviderId = resolveTeamProviderId(params.request.providerId);
    const factsByProvider = new Map<TeamProviderId, RuntimeProviderLaunchFacts>();
    const getFacts = async (providerId: TeamProviderId): Promise<RuntimeProviderLaunchFacts> => {
      const cached = factsByProvider.get(providerId);
      if (cached) {
        return cached;
      }
      const facts = await this.readRuntimeProviderLaunchFacts({
        claudePath: params.claudePath,
        cwd: params.cwd,
        providerId,
        env: params.env,
        limitContext: params.request.limitContext,
      });
      factsByProvider.set(providerId, facts);
      return facts;
    };

    const leadFacts = await getFacts(leadProviderId);
    this.validateRuntimeLaunchSelection({
      actorLabel: 'Team lead',
      providerId: leadProviderId,
      model: params.request.model,
      effort: params.request.effort,
      fastMode: params.request.fastMode,
      limitContext: params.request.limitContext,
      facts: leadFacts,
    });

    for (const member of params.effectiveMembers) {
      const memberProviderId = resolveTeamProviderId(member.providerId);
      const memberFacts = await getFacts(memberProviderId);
      this.validateRuntimeLaunchSelection({
        actorLabel: `Member ${member.name}`,
        providerId: memberProviderId,
        model: member.model,
        effort: member.effort,
        limitContext: params.request.limitContext,
        facts: memberFacts,
      });
    }

    return this.buildProviderModelLaunchIdentity({
      request: params.request,
      facts: leadFacts,
    });
  }

  async getClaudeLogs(
    teamName: string,
    query?: { offset?: number; limit?: number }
  ): Promise<{ lines: string[]; total: number; hasMore: boolean; updatedAt?: string }> {
    const runId = this.getTrackedRunId(teamName);
    if (runId) {
      const run = this.runs.get(runId);
      if (run) {
        return sliceClaudeLogs(run.claudeLogLines, run.claudeLogsUpdatedAt, query);
      }
    }

    const retained = this.retainedClaudeLogsByTeam.get(teamName);
    if (!retained) {
      const transcriptSnapshot = await this.getPersistedTranscriptClaudeLogs(teamName);
      if (!transcriptSnapshot) {
        return { lines: [], total: 0, hasMore: false };
      }
      return sliceClaudeLogs(transcriptSnapshot.lines, transcriptSnapshot.updatedAt, query);
    }

    return sliceClaudeLogs(retained.lines, retained.updatedAt, query);
  }

  private getProvisioningRunId(teamName: string): string | null {
    return this.provisioningRunByTeam.get(teamName) ?? null;
  }

  private getAliveRunId(teamName: string): string | null {
    return this.aliveRunByTeam.get(teamName) ?? null;
  }

  private getTrackedRunId(teamName: string): string | null {
    return this.getProvisioningRunId(teamName) ?? this.getAliveRunId(teamName);
  }

  private canDeliverToTrackedRuntimeRun(teamName: string, runId: string): boolean {
    const runtimeProgress = this.runtimeAdapterProgressByRunId.get(runId);
    if (
      runtimeProgress &&
      ['disconnected', 'failed', 'cancelled'].includes(runtimeProgress.state)
    ) {
      return false;
    }
    const run = this.runs.get(runId);
    if (
      run &&
      (run.processKilled ||
        run.cancelRequested ||
        ['disconnected', 'failed', 'cancelled'].includes(run.progress.state))
    ) {
      return false;
    }
    return (
      this.runtimeAdapterRunByTeam.get(teamName)?.runId === runId ||
      this.provisioningRunByTeam.get(teamName) === runId ||
      this.aliveRunByTeam.get(teamName) === runId
    );
  }

  private resolveDeliverableTrackedRuntimeRunId(teamName: string): string | null {
    const candidates = Array.from(
      new Set(
        [
          this.provisioningRunByTeam.get(teamName),
          this.aliveRunByTeam.get(teamName),
          this.runtimeAdapterRunByTeam.get(teamName)?.runId,
        ].filter((runId): runId is string => typeof runId === 'string' && runId.trim() !== '')
      )
    );
    for (const runId of candidates) {
      if (this.canDeliverToTrackedRuntimeRun(teamName, runId)) {
        return runId;
      }
    }
    return null;
  }

  private getOpenCodeRuntimeAdapter(): TeamLaunchRuntimeAdapter | null {
    if (!this.runtimeAdapterRegistry?.has('opencode')) {
      return null;
    }
    return this.runtimeAdapterRegistry.get('opencode');
  }

  private getOpenCodeRuntimeMessageAdapter():
    | (TeamLaunchRuntimeAdapter & {
        sendMessageToMember(
          input: OpenCodeTeamRuntimeMessageInput
        ): Promise<OpenCodeTeamRuntimeMessageResult>;
        observeMessageDelivery?(
          input: OpenCodeTeamRuntimeMessageInput & { prePromptCursor?: string | null }
        ): Promise<OpenCodeTeamRuntimeMessageResult>;
      })
    | null {
    const adapter = this.getOpenCodeRuntimeAdapter();
    if (!adapter || !('sendMessageToMember' in adapter)) {
      return null;
    }
    return adapter as TeamLaunchRuntimeAdapter & {
      sendMessageToMember(
        input: OpenCodeTeamRuntimeMessageInput
      ): Promise<OpenCodeTeamRuntimeMessageResult>;
      observeMessageDelivery?(
        input: OpenCodeTeamRuntimeMessageInput & { prePromptCursor?: string | null }
      ): Promise<OpenCodeTeamRuntimeMessageResult>;
    };
  }

  async isOpenCodeRuntimeRecipient(teamName: string, memberName: string): Promise<boolean> {
    const normalizedMemberName = memberName.trim().toLowerCase();
    if (!normalizedMemberName) {
      return false;
    }

    const [config, metaMembers] = await Promise.all([
      this.configReader.getConfig(teamName).catch(() => null),
      this.membersMetaStore.getMembers(teamName).catch(() => []),
    ]);
    const configMember = config?.members?.find(
      (member) => member.name?.trim().toLowerCase() === normalizedMemberName
    );
    const metaMember = metaMembers.find(
      (member) => member.name?.trim().toLowerCase() === normalizedMemberName
    );
    const configProvider = (configMember as { provider?: unknown } | undefined)?.provider;
    const metaProvider = (metaMember as { provider?: unknown } | undefined)?.provider;
    const providerId =
      normalizeTeamProviderLike(metaMember?.providerId) ??
      normalizeTeamProviderLike(metaProvider) ??
      normalizeTeamProviderLike(configMember?.providerId) ??
      normalizeTeamProviderLike(configProvider) ??
      inferTeamProviderIdFromModel(metaMember?.model ?? configMember?.model);
    return providerId === 'opencode';
  }

  private isOpenCodeDeliveryResponseReadCommitAllowed(input: {
    responseState?: NonNullable<OpenCodeTeamRuntimeMessageResult['responseObservation']>['state'];
    actionMode?: AgentActionMode;
    taskRefs?: TaskRef[];
    visibleReply?: OpenCodeVisibleReplyProof | null;
    ledgerRecord?: OpenCodePromptDeliveryLedgerRecord | null;
  }): boolean {
    const state = input.responseState;
    if (!state || !isOpenCodePromptResponseStateResponded(state)) {
      return false;
    }
    if (state === 'responded_plain_text') {
      return this.isOpenCodePlainTextResponseReadCommitAllowed({
        actionMode: input.actionMode,
        taskRefs: input.taskRefs,
        ledgerRecord: input.ledgerRecord,
      });
    }
    if (state === 'responded_visible_message') {
      return isOpenCodeVisibleReplyReadCommitAllowed({
        actionMode: input.actionMode,
        taskRefs: input.taskRefs,
        visibleReply: input.visibleReply,
        transcriptOnlyVisibleReply: !input.visibleReply,
      });
    }
    const hasTaskRefs = (input.taskRefs ?? []).length > 0;
    return hasTaskRefs || input.actionMode === 'do' || input.actionMode === 'delegate';
  }

  private isOpenCodePlainTextResponseReadCommitAllowed(input: {
    actionMode?: AgentActionMode;
    taskRefs?: TaskRef[];
    ledgerRecord?: OpenCodePromptDeliveryLedgerRecord | null;
  }): boolean {
    const preview = input.ledgerRecord?.observedAssistantPreview?.trim();
    if (!preview) {
      return true;
    }
    return isOpenCodeVisibleReplySemanticallySufficient({
      actionMode: input.actionMode,
      taskRefs: input.taskRefs,
      text: preview,
    }).sufficient;
  }

  private getOpenCodeDeliveryPendingReason(input: {
    responseState?: NonNullable<OpenCodeTeamRuntimeMessageResult['responseObservation']>['state'];
    actionMode?: AgentActionMode | null;
    taskRefs?: TaskRef[];
    visibleReply?: OpenCodeVisibleReplyProof | null;
    ledgerRecord?: OpenCodePromptDeliveryLedgerRecord | null;
  }): string {
    const record = input.ledgerRecord;
    const state = input.responseState ?? record?.responseState;
    if (record?.lastReason === 'visible_reply_ack_only_still_requires_answer') {
      return 'visible_reply_ack_only_still_requires_answer';
    }
    if (state === 'responded_plain_text') {
      const preview = record?.observedAssistantPreview?.trim();
      if (
        preview &&
        !isOpenCodeVisibleReplySemanticallySufficient({
          actionMode: input.actionMode,
          taskRefs: input.taskRefs,
          text: preview,
        }).sufficient
      ) {
        return 'plain_text_ack_only_still_requires_answer';
      }
    }
    if (state === 'responded_visible_message' && !input.visibleReply) {
      return 'visible_reply_destination_not_found_yet';
    }
    if (state === 'responded_non_visible_tool' || state === 'responded_tool_call') {
      const hasTaskRefs = (input.taskRefs ?? []).length > 0;
      if (!hasTaskRefs && input.actionMode !== 'do' && input.actionMode !== 'delegate') {
        return 'visible_reply_still_required';
      }
    }
    if (state === 'empty_assistant_turn') {
      return 'empty_assistant_turn';
    }
    return record?.lastReason ?? 'opencode_delivery_response_pending';
  }

  private isOpenCodeDeliveryRetryablePendingResponse(input: {
    ledgerRecord: OpenCodePromptDeliveryLedgerRecord;
    visibleReply?: OpenCodeVisibleReplyProof | null;
    readAllowed: boolean;
  }): boolean {
    if (input.readAllowed) {
      return false;
    }
    if (isOpenCodePromptDeliveryRetryableResponseState(input.ledgerRecord.responseState)) {
      return true;
    }
    if (
      input.ledgerRecord.lastReason === 'visible_reply_ack_only_still_requires_answer' ||
      input.ledgerRecord.lastReason === 'plain_text_ack_only_still_requires_answer'
    ) {
      return true;
    }
    if (input.ledgerRecord.responseState === 'responded_visible_message' && !input.visibleReply) {
      return true;
    }
    if (
      input.ledgerRecord.responseState === 'responded_non_visible_tool' ||
      input.ledgerRecord.responseState === 'responded_tool_call' ||
      input.ledgerRecord.responseState === 'responded_plain_text'
    ) {
      return true;
    }
    return false;
  }

  private buildOpenCodePromptDeliveryAttemptText(input: {
    ledgerRecord?: OpenCodePromptDeliveryLedgerRecord | null;
    text: string;
    replyRecipient: string;
  }): string {
    const record = input.ledgerRecord;
    if (!record || record.status === 'pending' || record.attempts <= 0) {
      return input.text;
    }
    const visibleAnswerRequired =
      record.lastReason === 'visible_reply_still_required' ||
      record.lastReason === 'plain_text_ack_only_still_requires_answer' ||
      (record.responseState === 'responded_non_visible_tool' &&
        record.actionMode === 'ask' &&
        record.taskRefs.length === 0);
    const attemptNumber = Math.min(record.attempts + 1, record.maxAttempts);
    const header = visibleAnswerRequired
      ? [
          '<opencode_delivery_retry>',
          `This is retry attempt ${attemptNumber}/${record.maxAttempts} for inbound app messageId "${record.inboxMessageId}".`,
          `你接受了之前的提示，但没有为接收者 "${input.replyRecipient}" 提供可见/具体的答复。`,
          `请使用 agent-teams_message_send 回复 "${input.replyRecipient}"，并包含 relayOfMessageId="${record.inboxMessageId}"。如果该工具不可用，请提供简洁的纯文本答复。`,
          '除非必要，不要重复工具工作，也不要只回复确认。',
          '</opencode_delivery_retry>',
        ]
      : [
          '<opencode_delivery_retry>',
          `This is retry attempt ${attemptNumber}/${record.maxAttempts} for inbound app messageId "${record.inboxMessageId}".`,
          'The previous OpenCode turn was accepted, but the app still has no sufficient response proof for this message.',
          `如果你已经处理过这条消息，不要重复工作；请通过 agent-teams_message_send 带 relayOfMessageId="${record.inboxMessageId}" 发送具体状态，或更新相关任务。`,
          'Do not reply only with acknowledgement.',
          '</opencode_delivery_retry>',
        ];
    return `${header.join('\n')}\n\n${input.text}`;
  }

  private isOpenCodePromptAcceptanceUnknownFailure(diagnostics: readonly string[]): boolean {
    return diagnostics.some((diagnostic) => isProbeTimeoutMessage(diagnostic));
  }

  private isOpenCodePromptDeliveryWatchdogEnabled(): boolean {
    const enabled = process.env.CLAUDE_TEAM_OPENCODE_PROMPT_DELIVERY_WATCHDOG !== '0';
    if (!enabled && !this.openCodePromptDeliveryWatchdogDisabledLogged) {
      this.openCodePromptDeliveryWatchdogDisabledLogged = true;
      logger.info(
        'OpenCode prompt delivery watchdog is disabled by CLAUDE_TEAM_OPENCODE_PROMPT_DELIVERY_WATCHDOG=0; using legacy prompt acceptance semantics.'
      );
    }
    return enabled;
  }

  private async findOpenCodeVisibleReplyByRelayOfMessageId(input: {
    teamName: string;
    replyRecipient?: string | null;
    from: string;
    relayOfMessageId: string;
  }): Promise<OpenCodeVisibleReplyProof | null> {
    const relayOfMessageId = input.relayOfMessageId.trim();
    if (!relayOfMessageId) {
      return null;
    }
    const candidates = await this.getOpenCodeVisibleReplyInboxCandidates({
      teamName: input.teamName,
      replyRecipient: input.replyRecipient,
    });
    const expectedFrom = input.from.trim().toLowerCase();
    for (const inboxName of candidates) {
      const messages = await this.inboxReader
        .getMessagesFor(input.teamName, inboxName)
        .catch(() => []);
      const matches = messages.filter(
        (message): message is InboxMessage & { messageId: string } =>
          typeof message.messageId === 'string' &&
          message.messageId.trim().length > 0 &&
          message.relayOfMessageId === relayOfMessageId &&
          message.from.trim().toLowerCase() === expectedFrom
      );
      const match =
        matches.find((message) => message.source === 'runtime_delivery') ?? matches[0] ?? null;
      if (match) {
        return {
          inboxName,
          message: { ...match, messageId: match.messageId! },
          missingRuntimeDeliverySource: match.source !== 'runtime_delivery',
        };
      }
    }
    return null;
  }

  private async getOpenCodeVisibleReplyInboxCandidates(input: {
    teamName: string;
    replyRecipient?: string | null;
  }): Promise<string[]> {
    const explicitRecipient = input.replyRecipient?.trim() || 'user';
    const candidates = [explicitRecipient];
    if (this.isOpenCodeLeadReplyRecipientAlias(explicitRecipient)) {
      const configuredLeadName = await this.configReader
        .getConfig(input.teamName)
        .then(
          (config) => config?.members?.find((member) => isLeadMember(member))?.name?.trim() || null
        )
        .catch(() => null);
      if (configuredLeadName) {
        candidates.push(configuredLeadName);
      }
      candidates.push(CANONICAL_LEAD_MEMBER_NAME);
      candidates.push(LEGACY_LEAD_MEMBER_NAME);
    }
    return candidates
      .filter((value): value is string => Boolean(value && value.trim()))
      .filter(
        (value, index, list) =>
          list.findIndex((item) => item.toLowerCase() === value.toLowerCase()) === index
      );
  }

  private isOpenCodeLeadReplyRecipientAlias(value: string): boolean {
    const normalized = value
      .trim()
      .toLowerCase()
      .replace(/[\s_]+/g, '-');
    return isLeadMemberName(normalized) || normalized === 'teamlead' || normalized === 'leader';
  }

  private async applyOpenCodeVisibleDestinationProof(input: {
    ledger: OpenCodePromptDeliveryLedgerStore;
    ledgerRecord: OpenCodePromptDeliveryLedgerRecord;
    teamName: string;
    replyRecipient?: string | null;
    memberName: string;
  }): Promise<{
    ledgerRecord: OpenCodePromptDeliveryLedgerRecord;
    visibleReply: OpenCodeVisibleReplyProof | null;
  }> {
    const visibleReply = await this.findOpenCodeVisibleReplyByRelayOfMessageId({
      teamName: input.teamName,
      replyRecipient: input.replyRecipient ?? input.ledgerRecord.replyRecipient,
      from: input.memberName,
      relayOfMessageId: input.ledgerRecord.inboxMessageId,
    });
    if (!visibleReply) {
      return { ledgerRecord: input.ledgerRecord, visibleReply: null };
    }
    const semantic = isOpenCodeVisibleReplyReadCommitAllowed({
      actionMode: input.ledgerRecord.actionMode,
      taskRefs: input.ledgerRecord.taskRefs,
      visibleReply,
    });
    const ledgerRecord = await input.ledger.applyDestinationProof({
      id: input.ledgerRecord.id,
      visibleReplyInbox: visibleReply.inboxName,
      visibleReplyMessageId: visibleReply.message.messageId,
      visibleReplyCorrelation: 'relayOfMessageId',
      semanticallySufficient: semantic,
      diagnostics: visibleReply.missingRuntimeDeliverySource
        ? ['visible_reply_missing_runtime_delivery_source']
        : [],
      observedAt: nowIso(),
    });
    return { ledgerRecord, visibleReply };
  }

  private getOpenCodeDeliveryWatchdogKey(input: {
    teamName: string;
    memberName: string;
    messageId: string;
  }): string {
    return `opencode-delivery:${input.teamName}:${input.memberName.toLowerCase()}:${input.messageId}`;
  }

  private enqueueOpenCodePromptDeliveryWatchdogJob(input: {
    teamName: string;
    run: () => Promise<void>;
  }): void {
    this.openCodePromptDeliveryWatchdogQueue.push(input);
    this.drainOpenCodePromptDeliveryWatchdogQueue();
  }

  private drainOpenCodePromptDeliveryWatchdogQueue(): void {
    while (
      this.openCodePromptDeliveryWatchdogInFlight < OPENCODE_PROMPT_WATCHDOG_GLOBAL_CONCURRENCY &&
      this.openCodePromptDeliveryWatchdogQueue.length > 0
    ) {
      const nextIndex = this.openCodePromptDeliveryWatchdogQueue.findIndex(
        (queued) =>
          (this.openCodePromptDeliveryWatchdogInFlightByTeam.get(queued.teamName) ?? 0) <
          OPENCODE_PROMPT_WATCHDOG_PER_TEAM_CONCURRENCY
      );
      if (nextIndex < 0) {
        return;
      }
      const [job] = this.openCodePromptDeliveryWatchdogQueue.splice(nextIndex, 1);
      if (!job) {
        return;
      }
      this.openCodePromptDeliveryWatchdogInFlight += 1;
      this.openCodePromptDeliveryWatchdogInFlightByTeam.set(
        job.teamName,
        (this.openCodePromptDeliveryWatchdogInFlightByTeam.get(job.teamName) ?? 0) + 1
      );
      void job
        .run()
        .catch((error: unknown) => {
          logger.warn(`OpenCode prompt delivery watchdog job failed: ${getErrorMessage(error)}`);
        })
        .finally(() => {
          this.openCodePromptDeliveryWatchdogInFlight = Math.max(
            0,
            this.openCodePromptDeliveryWatchdogInFlight - 1
          );
          const teamInFlight =
            (this.openCodePromptDeliveryWatchdogInFlightByTeam.get(job.teamName) ?? 1) - 1;
          if (teamInFlight > 0) {
            this.openCodePromptDeliveryWatchdogInFlightByTeam.set(job.teamName, teamInFlight);
          } else {
            this.openCodePromptDeliveryWatchdogInFlightByTeam.delete(job.teamName);
          }
          this.drainOpenCodePromptDeliveryWatchdogQueue();
        });
    }
  }

  private scheduleOpenCodePromptDeliveryWatchdog(input: {
    teamName: string;
    memberName: string;
    messageId?: string | null;
    delayMs: number;
  }): void {
    if (!this.isOpenCodePromptDeliveryWatchdogEnabled()) {
      return;
    }
    const messageId = input.messageId?.trim();
    if (!messageId) return;
    const key = this.getOpenCodeDeliveryWatchdogKey({
      teamName: input.teamName,
      memberName: input.memberName,
      messageId,
    });
    const existing = this.openCodePromptDeliveryWatchdogTimers.get(key);
    if (existing) {
      clearTimeout(existing);
    }
    const delayMs = Math.max(500, Math.min(input.delayMs, 60_000));
    const timer = setTimeout(() => {
      this.openCodePromptDeliveryWatchdogTimers.delete(key);
      this.enqueueOpenCodePromptDeliveryWatchdogJob({
        teamName: input.teamName,
        run: async () => {
          await this.relayOpenCodeMemberInboxMessages(input.teamName, input.memberName, {
            onlyMessageId: messageId,
            source: 'watchdog',
          });
        },
      });
    }, delayMs);
    this.openCodePromptDeliveryWatchdogTimers.set(key, timer);
  }

  private getOpenCodeDeliveryNextDelayMs(input: {
    responseState?: NonNullable<OpenCodeTeamRuntimeMessageResult['responseObservation']>['state'];
    retry: boolean;
  }): number {
    if (input.retry) {
      return OPENCODE_PROMPT_DELIVERY_RETRY_DELAY_MS;
    }
    if (isOpenCodePromptDeliveryObserveLaterResponseState(input.responseState)) {
      return OPENCODE_PROMPT_DELIVERY_OBSERVE_DELAY_MS;
    }
    return OPENCODE_PROMPT_DELIVERY_RETRY_DELAY_MS;
  }

  private async scheduleOpenCodePromptLedgerFollowUp(input: {
    ledger: OpenCodePromptDeliveryLedgerStore;
    ledgerRecord: OpenCodePromptDeliveryLedgerRecord;
    teamName: string;
    memberName: string;
    retry: boolean;
    reason: string;
  }): Promise<OpenCodePromptDeliveryLedgerRecord> {
    const now = nowIso();
    if (input.retry && input.ledgerRecord.attempts >= input.ledgerRecord.maxAttempts) {
      return await input.ledger.markFailedTerminal({
        id: input.ledgerRecord.id,
        reason: input.reason,
        failedAt: now,
      });
    }
    const delayMs = this.getOpenCodeDeliveryNextDelayMs({
      responseState: input.ledgerRecord.responseState,
      retry: input.retry,
    });
    const nextAttemptAt = new Date(Date.now() + delayMs).toISOString();
    const ledgerRecord = await input.ledger.markNextAttemptScheduled({
      id: input.ledgerRecord.id,
      status: input.retry ? 'retry_scheduled' : 'accepted',
      nextAttemptAt,
      reason: input.reason,
      scheduledAt: now,
    });
    this.logOpenCodePromptDeliveryEvent(
      input.retry
        ? 'opencode_prompt_delivery_retry_scheduled'
        : 'opencode_prompt_delivery_response_observed',
      ledgerRecord,
      { retry: input.retry, reason: input.reason }
    );
    this.scheduleOpenCodePromptDeliveryWatchdog({
      teamName: input.teamName,
      memberName: input.memberName,
      messageId: input.ledgerRecord.inboxMessageId,
      delayMs,
    });
    return ledgerRecord;
  }

  private logOpenCodePromptDeliveryEvent(
    event: string,
    record: OpenCodePromptDeliveryLedgerRecord,
    extra: Record<string, unknown> = {}
  ): void {
    logger.info(
      event,
      JSON.stringify({
        teamName: record.teamName,
        memberName: record.memberName,
        laneId: record.laneId,
        runId: record.runId,
        inboxMessageId: record.inboxMessageId,
        runtimeSessionId: record.runtimeSessionId,
        status: record.status,
        responseState: record.responseState,
        attempts: record.attempts,
        nextAttemptAt: record.nextAttemptAt,
        visibleReplyCorrelation: record.visibleReplyCorrelation,
        reason: record.lastReason,
        ...extra,
      })
    );
  }

  async scanOpenCodePromptDeliveryWatchdog(teamName: string): Promise<number> {
    if (!this.isOpenCodePromptDeliveryWatchdogEnabled()) {
      return 0;
    }
    const laneIndex = await readOpenCodeRuntimeLaneIndex(getTeamsBasePath(), teamName).catch(
      () => null
    );
    if (!laneIndex) {
      return 0;
    }
    return await this.scanOpenCodePromptDeliveryWatchdogForActiveLanes(
      teamName,
      Object.values(laneIndex.lanes)
        .filter((lane) => lane.state === 'active')
        .map((lane) => lane.laneId)
    );
  }

  private async scanOpenCodePromptDeliveryWatchdogForActiveLanes(
    teamName: string,
    laneIds: string[]
  ): Promise<number> {
    if (!this.isOpenCodePromptDeliveryWatchdogEnabled()) {
      return 0;
    }
    let scheduled = 0;
    for (const laneId of [...new Set(laneIds.map((laneId) => laneId.trim()).filter(Boolean))]) {
      const ledger = this.createOpenCodePromptDeliveryLedger(teamName, laneId);
      await ledger.pruneTerminalRecords({ now: new Date() }).catch((error: unknown) => {
        logger.warn(
          `[${teamName}] OpenCode prompt delivery ledger prune failed for ${laneId}: ${getErrorMessage(error)}`
        );
      });
      const records = await ledger.list().catch(() => []);
      for (const record of records) {
        if (record.status === 'failed_terminal' || record.status === 'responded') {
          continue;
        }
        const nextAttemptMs = record.nextAttemptAt ? Date.parse(record.nextAttemptAt) : NaN;
        const delayMs = Number.isFinite(nextAttemptMs)
          ? Math.max(500, nextAttemptMs - Date.now())
          : OPENCODE_PROMPT_DELIVERY_OBSERVE_DELAY_MS;
        this.scheduleOpenCodePromptDeliveryWatchdog({
          teamName,
          memberName: record.memberName,
          messageId: record.inboxMessageId,
          delayMs,
        });
        scheduled += 1;
      }
      const members = await this.resolveOpenCodeMembersForRuntimeLane(teamName, laneId);
      for (const memberName of members) {
        const inboxMessages = await this.inboxReader
          .getMessagesFor(teamName, memberName)
          .catch(() => []);
        for (const message of inboxMessages) {
          if (
            message.read ||
            typeof message.text !== 'string' ||
            message.text.trim().length === 0 ||
            !this.hasStableMessageId(message)
          ) {
            continue;
          }
          const existing = await ledger
            .getByInboxMessage({
              teamName,
              memberName,
              laneId,
              inboxMessageId: message.messageId,
            })
            .catch(() => null);
          if (existing) {
            continue;
          }
          const replyRecipient =
            typeof message.from === 'string' &&
            message.from.trim() &&
            message.from.trim().toLowerCase() !== memberName.trim().toLowerCase()
              ? message.from.trim()
              : 'user';
          const now = nowIso();
          const record = await ledger.ensurePending({
            teamName,
            memberName,
            laneId,
            runId: await this.resolveCurrentOpenCodeRuntimeRunId(teamName, laneId),
            inboxMessageId: message.messageId,
            inboxTimestamp: message.timestamp,
            source: 'watchdog',
            replyRecipient,
            actionMode: message.actionMode ?? null,
            taskRefs: message.taskRefs ?? [],
            payloadHash: hashOpenCodePromptDeliveryPayload({
              text: message.text,
              replyRecipient,
              actionMode: message.actionMode ?? null,
              taskRefs: message.taskRefs ?? [],
              attachments: message.attachments,
              source: 'watchdog',
            }),
            now,
          });
          if (message.attachments?.length) {
            await ledger.markFailedTerminal({
              id: record.id,
              reason: 'opencode_attachments_not_supported_for_secondary_runtime',
              failedAt: now,
            });
            continue;
          }
          const recovered = await ledger.markAcceptanceUnknown({
            id: record.id,
            reason: 'opencode_prompt_delivery_ledger_rebuilt_from_unread_inbox',
            nextAttemptAt: now,
            markedAt: now,
          });
          this.logOpenCodePromptDeliveryEvent(
            'opencode_prompt_delivery_retry_scheduled',
            recovered,
            { acceptanceUnknown: true, reason: recovered.lastReason }
          );
          this.scheduleOpenCodePromptDeliveryWatchdog({
            teamName,
            memberName: recovered.memberName,
            messageId: recovered.inboxMessageId,
            delayMs: 500,
          });
          scheduled += 1;
        }
      }
    }
    return scheduled;
  }

  async deliverOpenCodeMemberMessage(
    teamName: string,
    input: {
      memberName: string;
      text: string;
      messageId?: string;
      replyRecipient?: string;
      actionMode?: AgentActionMode;
      taskRefs?: TaskRef[];
      source?: OpenCodeMemberInboxRelayOptions['source'];
      inboxTimestamp?: string;
    }
  ): Promise<OpenCodeMemberInboxDelivery> {
    const adapter = this.getOpenCodeRuntimeMessageAdapter();
    if (!adapter) {
      return { delivered: false, reason: 'opencode_runtime_message_bridge_unavailable' };
    }

    const [config, teamMeta, metaMembers] = await Promise.all([
      this.configReader.getConfig(teamName).catch(() => null),
      this.teamMetaStore.getMeta(teamName).catch(() => null),
      this.membersMetaStore.getMembers(teamName).catch(() => []),
    ]);
    const normalizedMemberName = input.memberName.trim();
    const configMember = config?.members?.find(
      (member) => member.name?.trim().toLowerCase() === normalizedMemberName.toLowerCase()
    );
    const metaMember = metaMembers.find(
      (member) => member.name?.trim().toLowerCase() === normalizedMemberName.toLowerCase()
    );
    const configProvider = (configMember as { provider?: unknown } | undefined)?.provider;
    const metaProvider = (metaMember as { provider?: unknown } | undefined)?.provider;
    const providerId =
      normalizeTeamProviderLike(metaMember?.providerId) ??
      normalizeTeamProviderLike(metaProvider) ??
      normalizeTeamProviderLike(configMember?.providerId) ??
      normalizeTeamProviderLike(configProvider) ??
      inferTeamProviderIdFromModel(metaMember?.model ?? configMember?.model);
    if (providerId !== 'opencode') {
      return { delivered: false, reason: 'recipient_is_not_opencode' };
    }
    const removedAt =
      metaMember != null
        ? metaMember.removedAt
        : (configMember as { removedAt?: unknown } | undefined)?.removedAt;
    if (removedAt != null) {
      return { delivered: false, reason: 'recipient_removed' };
    }
    const canonicalMemberName =
      metaMember?.name?.trim() || configMember?.name?.trim() || normalizedMemberName;

    const leadMember = config?.members?.find((member) => isLeadMember(member));
    const leadProviderId =
      normalizeOptionalTeamProviderId(teamMeta?.launchIdentity?.providerId) ??
      normalizeOptionalTeamProviderId(teamMeta?.providerId) ??
      normalizeOptionalTeamProviderId(leadMember?.providerId);
    const laneIdentity = buildPlannedMemberLaneIdentity({
      leadProviderId,
      member: {
        name: canonicalMemberName,
        providerId,
      },
    });
    if (
      laneIdentity.laneKind === 'secondary' &&
      laneIdentity.laneOwnerProviderId === 'opencode' &&
      this.stoppingSecondaryRuntimeTeams.has(teamName)
    ) {
      return { delivered: false, reason: 'opencode_runtime_not_active' };
    }
    const memberRuntimeCwd = metaMember?.cwd?.trim() || configMember?.cwd?.trim();
    const cwd =
      laneIdentity.laneKind === 'secondary' && laneIdentity.laneOwnerProviderId === 'opencode'
        ? memberRuntimeCwd ||
          config?.projectPath?.trim() ||
          this.readPersistedTeamProjectPath(teamName)
        : config?.projectPath?.trim() ||
          memberRuntimeCwd ||
          this.readPersistedTeamProjectPath(teamName);
    if (!cwd) {
      return { delivered: false, reason: 'opencode_project_path_unavailable' };
    }

    const trackedRunId = this.resolveDeliverableTrackedRuntimeRunId(teamName);
    const trackedRun = trackedRunId ? this.runs.get(trackedRunId) : null;
    let liveSecondaryLaneRunId: string | null = null;
    let trackedSecondaryLanePresent = false;
    let trackedSecondaryLaneSnapshotKnown = false;
    if (
      trackedRun &&
      laneIdentity.laneKind === 'secondary' &&
      laneIdentity.laneOwnerProviderId === 'opencode'
    ) {
      const secondaryLanes = trackedRun.mixedSecondaryLanes;
      trackedSecondaryLaneSnapshotKnown = secondaryLanes.length > 0;
      const liveLane = secondaryLanes.find(
        (lane) =>
          lane.laneId === laneIdentity.laneId ||
          lane.member.name.trim().toLowerCase() === normalizedMemberName.toLowerCase()
      );
      trackedSecondaryLanePresent = liveLane != null;
      liveSecondaryLaneRunId = liveLane ? trackedRunId : null;
      if (!liveLane && trackedSecondaryLaneSnapshotKnown) {
        return { delivered: false, reason: 'opencode_runtime_not_active' };
      }
    }
    const runtimeRunId =
      laneIdentity.laneKind === 'secondary' && laneIdentity.laneOwnerProviderId === 'opencode'
        ? (liveSecondaryLaneRunId ??
          (await this.resolveCurrentOpenCodeRuntimeRunId(teamName, laneIdentity.laneId)))
        : (trackedRunId ??
          (await this.resolveCurrentOpenCodeRuntimeRunId(teamName, laneIdentity.laneId)));
    let runtimeActive = Boolean(runtimeRunId);
    if (!runtimeActive) {
      if (
        trackedRun &&
        laneIdentity.laneKind === 'secondary' &&
        laneIdentity.laneOwnerProviderId === 'opencode' &&
        !trackedSecondaryLanePresent &&
        trackedSecondaryLaneSnapshotKnown
      ) {
        return { delivered: false, reason: 'opencode_runtime_not_active' };
      }
      runtimeActive = await this.isOpenCodeRuntimeLaneIndexActive(teamName, laneIdentity.laneId);
    }
    if (!runtimeActive) {
      return { delivered: false, reason: 'opencode_runtime_not_active' };
    }

    if (!this.isOpenCodePromptDeliveryWatchdogEnabled()) {
      const result = await adapter.sendMessageToMember({
        ...(runtimeRunId ? { runId: runtimeRunId } : {}),
        teamName,
        laneId: laneIdentity.laneId,
        memberName: canonicalMemberName,
        cwd,
        text: input.text,
        messageId: input.messageId,
        replyRecipient: input.replyRecipient,
        actionMode: input.actionMode,
        taskRefs: input.taskRefs,
      });
      return {
        delivered: result.ok,
        accepted: result.ok,
        responsePending: false,
        responseState: result.responseObservation?.state,
        ...(result.ok
          ? {}
          : { reason: result.diagnostics[0] ?? 'opencode_message_delivery_failed' }),
        diagnostics: result.diagnostics,
      };
    }

    const messageId = input.messageId?.trim();
    const ledger =
      messageId && input.source
        ? this.createOpenCodePromptDeliveryLedger(teamName, laneIdentity.laneId)
        : null;
    const now = nowIso();
    let active = ledger
      ? await ledger.getActiveForMember({
          teamName,
          memberName: canonicalMemberName,
          laneId: laneIdentity.laneId,
        })
      : null;
    if (active && active.inboxMessageId !== messageId && ledger) {
      const proof = await this.applyOpenCodeVisibleDestinationProof({
        ledger,
        ledgerRecord: active,
        teamName,
        replyRecipient: active.replyRecipient,
        memberName: canonicalMemberName,
      });
      active = proof.ledgerRecord;
      const activeReadAllowed = this.isOpenCodeDeliveryResponseReadCommitAllowed({
        responseState: active.responseState,
        actionMode: active.actionMode ?? undefined,
        taskRefs: active.taskRefs,
        visibleReply: proof.visibleReply,
        ledgerRecord: active,
      });
      if (activeReadAllowed) {
        this.logOpenCodePromptDeliveryEvent('opencode_prompt_delivery_response_observed', active, {
          visibleReplySemanticallySufficient: true,
          unblockedNextDelivery: true,
        });
        active = null;
      }
    }
    if (active && active.inboxMessageId !== messageId) {
      const activeDueMs = active.nextAttemptAt ? Date.parse(active.nextAttemptAt) : NaN;
      this.scheduleOpenCodePromptDeliveryWatchdog({
        teamName,
        memberName: canonicalMemberName,
        messageId: active.inboxMessageId,
        delayMs: Number.isFinite(activeDueMs)
          ? Math.max(500, activeDueMs - Date.now())
          : OPENCODE_PROMPT_DELIVERY_OBSERVE_DELAY_MS,
      });
      return {
        delivered: true,
        accepted: false,
        responsePending: true,
        responseState: active.responseState,
        ledgerStatus: active.status,
        ledgerRecordId: active.id,
        laneId: laneIdentity.laneId,
        queuedBehindMessageId: active.inboxMessageId,
        reason: 'opencode_delivery_response_pending',
        diagnostics: [`OpenCode delivery is queued behind ${active.inboxMessageId}.`],
      };
    }

    let ledgerRecord = messageId
      ? await ledger?.ensurePending({
          teamName,
          memberName: canonicalMemberName,
          laneId: laneIdentity.laneId,
          runId: runtimeRunId ?? null,
          inboxMessageId: messageId,
          inboxTimestamp: input.inboxTimestamp ?? now,
          source: input.source ?? 'manual',
          replyRecipient: input.replyRecipient ?? 'user',
          actionMode: input.actionMode ?? null,
          taskRefs: input.taskRefs ?? [],
          payloadHash: hashOpenCodePromptDeliveryPayload({
            text: input.text,
            replyRecipient: input.replyRecipient ?? 'user',
            actionMode: input.actionMode ?? null,
            taskRefs: input.taskRefs ?? [],
            source: input.source,
          }),
          now,
        })
      : null;
    if (ledgerRecord?.createdAt === now) {
      this.logOpenCodePromptDeliveryEvent('opencode_prompt_delivery_ledger_created', ledgerRecord);
    }

    if (ledgerRecord && ledger && messageId) {
      let proof = await this.applyOpenCodeVisibleDestinationProof({
        ledger,
        ledgerRecord,
        teamName,
        replyRecipient: input.replyRecipient,
        memberName: canonicalMemberName,
      });
      ledgerRecord = proof.ledgerRecord;
      let readAllowed = this.isOpenCodeDeliveryResponseReadCommitAllowed({
        responseState: ledgerRecord.responseState,
        actionMode: ledgerRecord.actionMode ?? undefined,
        taskRefs: ledgerRecord.taskRefs,
        visibleReply: proof.visibleReply,
        ledgerRecord,
      });
      if (readAllowed) {
        this.logOpenCodePromptDeliveryEvent(
          'opencode_prompt_delivery_response_observed',
          ledgerRecord,
          { visibleReplySemanticallySufficient: true }
        );
        return {
          delivered: true,
          accepted: true,
          responsePending: false,
          responseState: ledgerRecord.responseState,
          ledgerStatus: ledgerRecord.status,
          ledgerRecordId: ledgerRecord.id,
          laneId: laneIdentity.laneId,
          visibleReplyMessageId: ledgerRecord.visibleReplyMessageId ?? undefined,
          visibleReplyCorrelation: ledgerRecord.visibleReplyCorrelation ?? undefined,
          diagnostics: ledgerRecord.diagnostics,
        };
      }

      if (ledgerRecord.status === 'failed_terminal') {
        this.logOpenCodePromptDeliveryEvent(
          'opencode_prompt_delivery_terminal_failure',
          ledgerRecord
        );
        return {
          delivered: false,
          accepted: false,
          responsePending: false,
          responseState: ledgerRecord.responseState,
          ledgerStatus: ledgerRecord.status,
          ledgerRecordId: ledgerRecord.id,
          laneId: laneIdentity.laneId,
          reason: ledgerRecord.lastReason ?? 'opencode_prompt_delivery_failed_terminal',
          diagnostics: ledgerRecord.diagnostics,
        };
      }

      const attemptDue = isOpenCodePromptDeliveryAttemptDue(ledgerRecord);
      if (ledgerRecord.status !== 'pending' && !attemptDue) {
        const nextAttemptMs = ledgerRecord.nextAttemptAt
          ? Date.parse(ledgerRecord.nextAttemptAt)
          : NaN;
        this.scheduleOpenCodePromptDeliveryWatchdog({
          teamName,
          memberName: canonicalMemberName,
          messageId,
          delayMs: Number.isFinite(nextAttemptMs)
            ? Math.max(500, nextAttemptMs - Date.now())
            : OPENCODE_PROMPT_DELIVERY_OBSERVE_DELAY_MS,
        });
        return {
          delivered: true,
          accepted: true,
          responsePending: true,
          responseState: ledgerRecord.responseState,
          ledgerStatus: ledgerRecord.status,
          ledgerRecordId: ledgerRecord.id,
          laneId: laneIdentity.laneId,
          visibleReplyMessageId: ledgerRecord.visibleReplyMessageId ?? undefined,
          visibleReplyCorrelation: ledgerRecord.visibleReplyCorrelation ?? undefined,
          reason: ledgerRecord.lastReason ?? 'opencode_delivery_response_pending',
          diagnostics: ledgerRecord.diagnostics,
        };
      }

      if (ledgerRecord.status !== 'pending' && !adapter.observeMessageDelivery) {
        return {
          delivered: true,
          accepted: true,
          responsePending: true,
          responseState: ledgerRecord.responseState,
          ledgerStatus: ledgerRecord.status,
          ledgerRecordId: ledgerRecord.id,
          laneId: laneIdentity.laneId,
          reason: 'opencode_delivery_observe_bridge_unavailable',
          diagnostics: [
            ...ledgerRecord.diagnostics,
            'OpenCode message delivery observe bridge is unavailable.',
          ],
        };
      }

      const retryDueBeforeObserve =
        attemptDue &&
        (ledgerRecord.status === 'retry_scheduled' || ledgerRecord.status === 'failed_retryable');
      if (ledgerRecord.status !== 'pending' && adapter.observeMessageDelivery) {
        const observed = await adapter.observeMessageDelivery({
          ...(runtimeRunId ? { runId: runtimeRunId } : {}),
          teamName,
          laneId: laneIdentity.laneId,
          memberName: canonicalMemberName,
          cwd,
          text: input.text,
          messageId,
          replyRecipient: input.replyRecipient,
          actionMode: input.actionMode,
          taskRefs: input.taskRefs,
          prePromptCursor: ledgerRecord.prePromptCursor,
        });
        ledgerRecord = await ledger.applyObservation({
          id: ledgerRecord.id,
          responseObservation: observed.responseObservation ?? {
            state: observed.ok ? 'not_observed' : 'reconcile_failed',
            deliveredUserMessageId: null,
            assistantMessageId: null,
            toolCallNames: [],
            visibleMessageToolCallId: null,
            visibleReplyMessageId: null,
            visibleReplyCorrelation: null,
            latestAssistantPreview: null,
            reason: observed.diagnostics[0] ?? null,
          },
          diagnostics: observed.diagnostics,
          observedAt: nowIso(),
        });
        proof = await this.applyOpenCodeVisibleDestinationProof({
          ledger,
          ledgerRecord,
          teamName,
          replyRecipient: input.replyRecipient,
          memberName: canonicalMemberName,
        });
        ledgerRecord = proof.ledgerRecord;
        readAllowed = this.isOpenCodeDeliveryResponseReadCommitAllowed({
          responseState: ledgerRecord.responseState,
          actionMode: ledgerRecord.actionMode ?? undefined,
          taskRefs: ledgerRecord.taskRefs,
          visibleReply: proof.visibleReply,
          ledgerRecord,
        });
        if (readAllowed) {
          this.logOpenCodePromptDeliveryEvent(
            'opencode_prompt_delivery_response_observed',
            ledgerRecord,
            { visibleReplySemanticallySufficient: true }
          );
          return {
            delivered: true,
            accepted: true,
            responsePending: false,
            responseState: ledgerRecord.responseState,
            ledgerStatus: ledgerRecord.status,
            ledgerRecordId: ledgerRecord.id,
            laneId: laneIdentity.laneId,
            visibleReplyMessageId: ledgerRecord.visibleReplyMessageId ?? undefined,
            visibleReplyCorrelation: ledgerRecord.visibleReplyCorrelation ?? undefined,
            diagnostics: ledgerRecord.diagnostics,
          };
        }

        const pendingReason = this.getOpenCodeDeliveryPendingReason({
          responseState: ledgerRecord.responseState,
          actionMode: ledgerRecord.actionMode,
          taskRefs: ledgerRecord.taskRefs,
          visibleReply: proof.visibleReply,
          ledgerRecord,
        });
        const retryable = this.isOpenCodeDeliveryRetryablePendingResponse({
          ledgerRecord,
          visibleReply: proof.visibleReply,
          readAllowed,
        });
        const retryDue = retryDueBeforeObserve;
        if (!retryDue || !retryable) {
          ledgerRecord = await this.scheduleOpenCodePromptLedgerFollowUp({
            ledger,
            ledgerRecord,
            teamName,
            memberName: canonicalMemberName,
            retry: retryable,
            reason: pendingReason,
          });
          return {
            delivered: true,
            accepted: true,
            responsePending: true,
            responseState: ledgerRecord.responseState,
            ledgerStatus: ledgerRecord.status,
            ledgerRecordId: ledgerRecord.id,
            laneId: laneIdentity.laneId,
            visibleReplyMessageId: ledgerRecord.visibleReplyMessageId ?? undefined,
            visibleReplyCorrelation: ledgerRecord.visibleReplyCorrelation ?? undefined,
            reason: ledgerRecord.lastReason ?? 'opencode_delivery_response_pending',
            diagnostics: ledgerRecord.diagnostics,
          };
        }
      }
    }

    const deliveryText = this.buildOpenCodePromptDeliveryAttemptText({
      ledgerRecord,
      text: input.text,
      replyRecipient: input.replyRecipient ?? ledgerRecord?.replyRecipient ?? 'user',
    });
    const result = await adapter.sendMessageToMember({
      ...(runtimeRunId ? { runId: runtimeRunId } : {}),
      teamName,
      laneId: laneIdentity.laneId,
      memberName: canonicalMemberName,
      cwd,
      text: deliveryText,
      messageId: input.messageId,
      replyRecipient: input.replyRecipient,
      actionMode: input.actionMode,
      taskRefs: input.taskRefs,
    });
    if (ledgerRecord && ledger) {
      ledgerRecord = await ledger.applyDeliveryResult({
        id: ledgerRecord.id,
        accepted: result.ok,
        attempted: true,
        responseObservation: result.responseObservation,
        sessionId: result.sessionId,
        prePromptCursor: result.prePromptCursor,
        diagnostics: result.diagnostics,
        reason: result.ok ? result.responseObservation?.reason : result.diagnostics[0],
        now: nowIso(),
      });
      const proof = await this.applyOpenCodeVisibleDestinationProof({
        ledger,
        ledgerRecord,
        teamName,
        replyRecipient: input.replyRecipient,
        memberName: canonicalMemberName,
      });
      ledgerRecord = proof.ledgerRecord;
      this.logOpenCodePromptDeliveryEvent(
        result.ok
          ? ledgerRecord.status === 'unanswered'
            ? 'opencode_prompt_delivery_unanswered'
            : ledgerRecord.status === 'responded'
              ? 'opencode_prompt_delivery_response_observed'
              : 'opencode_prompt_delivery_prompt_accepted'
          : 'opencode_prompt_delivery_retry_scheduled',
        ledgerRecord,
        { accepted: result.ok, reason: ledgerRecord.lastReason ?? result.diagnostics[0] ?? null }
      );
    }
    const responseState = ledgerRecord?.responseState ?? result.responseObservation?.state;
    const visibleReply = ledgerRecord
      ? await this.findOpenCodeVisibleReplyByRelayOfMessageId({
          teamName,
          replyRecipient: input.replyRecipient ?? ledgerRecord.replyRecipient,
          from: canonicalMemberName,
          relayOfMessageId: ledgerRecord.inboxMessageId,
        })
      : null;
    const readAllowed = this.isOpenCodeDeliveryResponseReadCommitAllowed({
      responseState,
      actionMode: input.actionMode,
      taskRefs: input.taskRefs,
      visibleReply,
      ledgerRecord,
    });
    if (ledgerRecord && result.ok && !readAllowed) {
      const retry = this.isOpenCodeDeliveryRetryablePendingResponse({
        ledgerRecord,
        visibleReply,
        readAllowed,
      });
      ledgerRecord = await this.scheduleOpenCodePromptLedgerFollowUp({
        ledger: ledger!,
        ledgerRecord,
        teamName,
        memberName: canonicalMemberName,
        retry,
        reason: this.getOpenCodeDeliveryPendingReason({
          responseState: ledgerRecord.responseState,
          actionMode: ledgerRecord.actionMode,
          taskRefs: ledgerRecord.taskRefs,
          visibleReply,
          ledgerRecord,
        }),
      });
      if (ledgerRecord.status === 'failed_terminal') {
        return {
          delivered: false,
          accepted: true,
          responsePending: false,
          responseState: ledgerRecord.responseState,
          ledgerStatus: ledgerRecord.status,
          ledgerRecordId: ledgerRecord.id,
          laneId: laneIdentity.laneId,
          reason: ledgerRecord.lastReason ?? 'opencode_prompt_delivery_failed_terminal',
          diagnostics: ledgerRecord.diagnostics.length
            ? ledgerRecord.diagnostics
            : [ledgerRecord.lastReason ?? 'opencode_prompt_delivery_failed_terminal'],
        };
      }
    }
    if (ledgerRecord && !result.ok) {
      const reason = this.isOpenCodePromptAcceptanceUnknownFailure(result.diagnostics)
        ? 'opencode_prompt_acceptance_unknown_after_bridge_timeout'
        : (result.diagnostics[0] ?? 'opencode_message_delivery_failed');
      if (reason === 'opencode_prompt_acceptance_unknown_after_bridge_timeout') {
        const delayMs = OPENCODE_PROMPT_DELIVERY_OBSERVE_DELAY_MS;
        ledgerRecord = await ledger!.markAcceptanceUnknown({
          id: ledgerRecord.id,
          reason,
          nextAttemptAt: new Date(Date.now() + delayMs).toISOString(),
          diagnostics: result.diagnostics,
          markedAt: nowIso(),
        });
        this.scheduleOpenCodePromptDeliveryWatchdog({
          teamName,
          memberName: canonicalMemberName,
          messageId: ledgerRecord.inboxMessageId,
          delayMs,
        });
        this.logOpenCodePromptDeliveryEvent(
          'opencode_prompt_delivery_retry_scheduled',
          ledgerRecord,
          { acceptanceUnknown: true, reason }
        );
      } else {
        ledgerRecord = await this.scheduleOpenCodePromptLedgerFollowUp({
          ledger: ledger!,
          ledgerRecord,
          teamName,
          memberName: canonicalMemberName,
          retry: true,
          reason,
        });
      }
    }
    const responseVisibleReplyMessageId =
      ledgerRecord?.visibleReplyMessageId ??
      result.responseObservation?.visibleReplyMessageId ??
      undefined;
    const responseVisibleReplyCorrelation =
      ledgerRecord?.visibleReplyCorrelation ??
      result.responseObservation?.visibleReplyCorrelation ??
      undefined;
    const acceptanceUnknown = Boolean(ledgerRecord?.acceptanceUnknown && !result.ok);
    const responsePending =
      acceptanceUnknown || (result.ok && Boolean(ledgerRecord || result.responseObservation))
        ? !readAllowed
        : false;
    const pendingReason =
      responsePending && ledgerRecord
        ? (ledgerRecord.lastReason ?? 'opencode_delivery_response_pending')
        : null;
    const diagnostics =
      pendingReason && result.diagnostics.length === 0
        ? [pendingReason]
        : ledgerRecord?.diagnostics.length
          ? ledgerRecord.diagnostics
          : result.diagnostics;
    return {
      delivered: result.ok || acceptanceUnknown,
      ...(ledgerRecord || result.responseObservation ? { accepted: result.ok } : {}),
      ...(ledgerRecord || result.responseObservation ? { responsePending } : {}),
      ...(acceptanceUnknown ? { acceptanceUnknown: true } : {}),
      ...(ledgerRecord
        ? {
            ledgerStatus: ledgerRecord.status,
            ledgerRecordId: ledgerRecord.id,
            laneId: laneIdentity.laneId,
          }
        : {}),
      ...(responseState
        ? {
            responseState,
            ...(responseVisibleReplyMessageId
              ? { visibleReplyMessageId: responseVisibleReplyMessageId }
              : {}),
            ...(responseVisibleReplyCorrelation
              ? { visibleReplyCorrelation: responseVisibleReplyCorrelation }
              : {}),
          }
        : {}),
      ...(pendingReason
        ? { reason: pendingReason }
        : result.ok
          ? {}
          : { reason: result.diagnostics[0] ?? 'opencode_message_delivery_failed' }),
      diagnostics,
    };
  }

  private shouldRouteOpenCodeToRuntimeAdapter(request: {
    providerId?: TeamProviderId;
    members?: readonly { providerId?: TeamProviderId; provider?: TeamProviderId }[];
  }): boolean {
    return isPureOpenCodeProvisioningRequest(request) && this.getOpenCodeRuntimeAdapter() !== null;
  }

  private planRuntimeLanesOrThrow(
    leadProviderId: TeamProviderId | undefined,
    members: TeamCreateRequest['members']
  ): TeamRuntimeLanePlan {
    return this.runtimeLaneCoordinator.planProvisioningMembers({
      leadProviderId,
      members,
      hasOpenCodeRuntimeAdapter: this.getOpenCodeRuntimeAdapter() !== null,
    });
  }

  private createMixedSecondaryLaneStates(
    plan: TeamRuntimeLanePlan
  ): MixedSecondaryRuntimeLaneState[] {
    if (!isMixedOpenCodeSideLanePlan(plan)) {
      return [];
    }
    return plan.sideLanes.map((sideLane) => ({
      laneId: sideLane.laneId,
      providerId: 'opencode',
      member: {
        ...sideLane.member,
      },
      runId: null,
      state: 'queued',
      result: null,
      warnings: [],
      diagnostics: [],
    }));
  }

  private createMixedSecondaryLaneStateForMember(
    run: Pick<ProvisioningRun, 'request'>,
    member: TeamCreateRequest['members'][number]
  ): MixedSecondaryRuntimeLaneState {
    const laneIdentity = buildPlannedMemberLaneIdentity({
      leadProviderId: resolveTeamProviderId(run.request.providerId),
      member: {
        name: member.name,
        providerId: normalizeOptionalTeamProviderId(member.providerId),
      },
    });

    if (laneIdentity.laneKind !== 'secondary' || laneIdentity.laneOwnerProviderId !== 'opencode') {
      throw new Error(
        `Member "${member.name}" is not eligible for an OpenCode secondary runtime lane`
      );
    }

    return {
      laneId: laneIdentity.laneId,
      providerId: 'opencode',
      member: {
        ...member,
      },
      runId: null,
      state: 'queued',
      result: null,
      warnings: [],
      diagnostics: [],
    };
  }

  private getMixedSecondaryLaunchPhase(run: ProvisioningRun): PersistedTeamLaunchPhase {
    return (run.mixedSecondaryLanes ?? []).some(
      (lane) =>
        (!lane.result && lane.state !== 'finished') ||
        lane.result?.teamLaunchState === 'partial_pending'
    )
      ? 'active'
      : 'finished';
  }

  private upsertRunAllEffectiveMember(
    run: ProvisioningRun,
    member: TeamCreateRequest['members'][number]
  ): void {
    const normalizedName = member.name.trim().toLowerCase();
    const nextMembers = run.allEffectiveMembers.filter(
      (candidate) => candidate.name.trim().toLowerCase() !== normalizedName
    );
    nextMembers.push(member);
    run.allEffectiveMembers = nextMembers;
    run.request.members = nextMembers;
  }

  private upsertRunEffectiveMember(
    run: ProvisioningRun,
    member: TeamCreateRequest['members'][number]
  ): void {
    const normalizedName = member.name.trim().toLowerCase();
    const nextMembers = run.effectiveMembers.filter(
      (candidate) => candidate.name.trim().toLowerCase() !== normalizedName
    );
    nextMembers.push(member);
    run.effectiveMembers = nextMembers;
  }

  private removeRunAllEffectiveMember(run: ProvisioningRun, memberName: string): void {
    const normalizedName = memberName.trim().toLowerCase();
    const nextMembers = run.allEffectiveMembers.filter(
      (candidate) => candidate.name.trim().toLowerCase() !== normalizedName
    );
    run.allEffectiveMembers = nextMembers;
    run.request.members = nextMembers;
  }

  private hasSecondaryRuntimeRuns(teamName: string): boolean {
    const runs = this.secondaryRuntimeRunByTeam.get(teamName);
    return Boolean(runs && runs.size > 0);
  }

  private getSecondaryRuntimeRuns(teamName: string): {
    runId: string;
    providerId: 'opencode';
    laneId: string;
    memberName: string;
    cwd?: string;
  }[] {
    return Array.from(this.secondaryRuntimeRunByTeam.get(teamName)?.values() ?? []);
  }

  private setSecondaryRuntimeRun(input: {
    teamName: string;
    runId: string;
    providerId: 'opencode';
    laneId: string;
    memberName: string;
    cwd?: string;
  }): void {
    const runs = this.secondaryRuntimeRunByTeam.get(input.teamName) ?? new Map();
    runs.set(input.laneId, {
      runId: input.runId,
      providerId: input.providerId,
      laneId: input.laneId,
      memberName: input.memberName,
      cwd: input.cwd,
    });
    this.secondaryRuntimeRunByTeam.set(input.teamName, runs);
  }

  private deleteSecondaryRuntimeRun(teamName: string, laneId: string): void {
    const runs = this.secondaryRuntimeRunByTeam.get(teamName);
    if (!runs) {
      return;
    }
    runs.delete(laneId);
    if (runs.size === 0) {
      this.secondaryRuntimeRunByTeam.delete(teamName);
    }
  }

  private clearSecondaryRuntimeRuns(teamName: string): void {
    this.secondaryRuntimeRunByTeam.delete(teamName);
  }

  private getCurrentOpenCodeRuntimeRunId(teamName: string, laneId: string): string | null {
    if (laneId === 'primary') {
      const trackedRunId = this.getTrackedRunId(teamName);
      const trackedRun = trackedRunId ? this.runs.get(trackedRunId) : null;
      if (trackedRun && this.shouldRouteOpenCodeToRuntimeAdapter(trackedRun.request)) {
        return trackedRunId;
      }
      if (
        trackedRunId &&
        this.provisioningRunByTeam.get(teamName) === trackedRunId &&
        this.runtimeAdapterProgressByRunId.has(trackedRunId)
      ) {
        const runtimeProgress = this.runtimeAdapterProgressByRunId.get(trackedRunId);
        if (runtimeProgress && this.isCancellableRuntimeAdapterProgress(runtimeProgress)) {
          return trackedRunId;
        }
      }
      const runtimeRun = this.runtimeAdapterRunByTeam.get(teamName);
      if (runtimeRun?.providerId === 'opencode') {
        return runtimeRun.runId;
      }
      return null;
    }

    const secondaryLaneRun = this.secondaryRuntimeRunByTeam.get(teamName)?.get(laneId);
    return secondaryLaneRun?.runId ?? null;
  }

  private async resolveCurrentOpenCodeRuntimeRunId(
    teamName: string,
    laneId: string
  ): Promise<string | null> {
    const inMemoryRunId = this.getCurrentOpenCodeRuntimeRunId(teamName, laneId);
    if (inMemoryRunId) {
      return inMemoryRunId;
    }

    const laneIndex = await readOpenCodeRuntimeLaneIndex(getTeamsBasePath(), teamName).catch(
      () => null
    );
    if (laneIndex?.lanes[laneId]?.state !== 'active') {
      return null;
    }

    const evidence = await new OpenCodeRuntimeManifestEvidenceReader({
      teamsBasePath: getTeamsBasePath(),
    })
      .read(teamName, laneId)
      .catch(() => null);
    const durableRunId = evidence?.activeRunId?.trim();
    return durableRunId || null;
  }

  private async resolveOpenCodeMemberDeliveryIdentity(
    teamName: string,
    memberName: string
  ): Promise<
    | {
        ok: true;
        canonicalMemberName: string;
        laneId: string;
      }
    | {
        ok: false;
        reason:
          | 'recipient_is_not_opencode'
          | 'recipient_removed'
          | 'opencode_recipient_unavailable';
      }
  > {
    const [config, teamMeta, metaMembers] = await Promise.all([
      this.configReader.getConfig(teamName).catch(() => null),
      this.teamMetaStore.getMeta(teamName).catch(() => null),
      this.membersMetaStore.getMembers(teamName).catch(() => []),
    ]);
    const normalizedMemberName = memberName.trim();
    const configMember = config?.members?.find(
      (member) => member.name?.trim().toLowerCase() === normalizedMemberName.toLowerCase()
    );
    const metaMember = metaMembers.find(
      (member) => member.name?.trim().toLowerCase() === normalizedMemberName.toLowerCase()
    );
    if (!configMember && !metaMember) {
      return { ok: false, reason: 'opencode_recipient_unavailable' };
    }
    const configProvider = (configMember as { provider?: unknown } | undefined)?.provider;
    const metaProvider = (metaMember as { provider?: unknown } | undefined)?.provider;
    const providerId =
      normalizeTeamProviderLike(metaMember?.providerId) ??
      normalizeTeamProviderLike(metaProvider) ??
      normalizeTeamProviderLike(configMember?.providerId) ??
      normalizeTeamProviderLike(configProvider) ??
      inferTeamProviderIdFromModel(metaMember?.model ?? configMember?.model);
    if (providerId !== 'opencode') {
      return { ok: false, reason: 'recipient_is_not_opencode' };
    }
    const removedAt =
      metaMember != null
        ? metaMember.removedAt
        : (configMember as { removedAt?: unknown } | undefined)?.removedAt;
    if (removedAt != null) {
      return { ok: false, reason: 'recipient_removed' };
    }
    const canonicalMemberName =
      metaMember?.name?.trim() || configMember?.name?.trim() || normalizedMemberName;
    const runtimeRun = this.runtimeAdapterRunByTeam.get(teamName);
    if (runtimeRun?.providerId === 'opencode') {
      return {
        ok: true,
        canonicalMemberName,
        laneId: 'primary',
      };
    }
    const leadMember = config?.members?.find((member) => isLeadMember(member));
    const leadProviderId =
      normalizeOptionalTeamProviderId(teamMeta?.launchIdentity?.providerId) ??
      normalizeOptionalTeamProviderId(teamMeta?.providerId) ??
      normalizeOptionalTeamProviderId(leadMember?.providerId);
    const laneIdentity = buildPlannedMemberLaneIdentity({
      leadProviderId,
      member: {
        name: canonicalMemberName,
        providerId,
      },
    });
    return {
      ok: true,
      canonicalMemberName,
      laneId: laneIdentity.laneId,
    };
  }

  private async resolveOpenCodeMembersForRuntimeLane(
    teamName: string,
    laneId: string
  ): Promise<string[]> {
    const [config, metaMembers] = await Promise.all([
      this.configReader.getConfig(teamName).catch(() => null),
      this.membersMetaStore.getMembers(teamName).catch(() => []),
    ]);
    const names = new Set<string>();
    for (const member of config?.members ?? []) {
      if (member.name?.trim()) {
        names.add(member.name.trim());
      }
    }
    for (const member of metaMembers) {
      if (member.name?.trim()) {
        names.add(member.name.trim());
      }
    }
    const resolved: string[] = [];
    for (const name of names) {
      const identity = await this.resolveOpenCodeMemberDeliveryIdentity(teamName, name);
      if (identity.ok && identity.laneId === laneId) {
        resolved.push(identity.canonicalMemberName);
      }
    }
    if (resolved.length > 0) {
      return [...new Set(resolved)];
    }
    const secondaryMatch = /^secondary:opencode:(.+)$/i.exec(laneId);
    const fallbackMember = secondaryMatch?.[1]?.trim();
    return fallbackMember ? [fallbackMember] : [];
  }

  private async isOpenCodeRuntimeLaneIndexActive(
    teamName: string,
    laneId: string
  ): Promise<boolean> {
    const laneIndex = await readOpenCodeRuntimeLaneIndex(getTeamsBasePath(), teamName).catch(
      () => null
    );
    return laneIndex?.lanes[laneId]?.state === 'active';
  }

  private async resolveOpenCodeRuntimeLaneId(params: {
    teamName: string;
    runId: string;
    memberName?: string;
  }): Promise<string> {
    const runtimeRun = this.runtimeAdapterRunByTeam.get(params.teamName);
    if (runtimeRun?.providerId === 'opencode' && runtimeRun.runId === params.runId) {
      return 'primary';
    }

    for (const lane of this.getSecondaryRuntimeRuns(params.teamName)) {
      if (lane.runId === params.runId) {
        return lane.laneId;
      }
    }

    if (params.memberName) {
      const trackedRunId = this.getTrackedRunId(params.teamName);
      const trackedRun = trackedRunId ? this.runs.get(trackedRunId) : null;
      const plannedLane = trackedRun?.mixedSecondaryLanes.find(
        (lane) => lane.member.name.trim() === params.memberName
      );
      if (plannedLane) {
        return plannedLane.laneId;
      }

      const persisted = await this.launchStateStore.read(params.teamName).catch(() => null);
      const persistedMember = persisted?.members?.[params.memberName];
      if (
        persistedMember?.laneOwnerProviderId === 'opencode' &&
        typeof persistedMember.laneId === 'string' &&
        persistedMember.laneId.trim().length > 0
      ) {
        return persistedMember.laneId.trim();
      }
    }

    return 'primary';
  }

  private buildConfiguredProvisioningMember(
    configuredMember: NonNullable<
      ReturnType<TeamProvisioningService['resolveEffectiveConfiguredMember']>
    >
  ): TeamCreateRequest['members'][number] {
    return {
      name: configuredMember.name,
      ...(configuredMember.role ? { role: configuredMember.role } : {}),
      ...(configuredMember.workflow ? { workflow: configuredMember.workflow } : {}),
      ...(configuredMember.isolation === 'worktree' ? { isolation: 'worktree' as const } : {}),
      ...(configuredMember.cwd ? { cwd: configuredMember.cwd } : {}),
      ...(configuredMember.providerId ? { providerId: configuredMember.providerId } : {}),
      ...(configuredMember.providerBackendId
        ? { providerBackendId: configuredMember.providerBackendId }
        : {}),
      ...(configuredMember.model ? { model: configuredMember.model } : {}),
      ...(configuredMember.effort ? { effort: configuredMember.effort } : {}),
      ...(configuredMember.fastMode ? { fastMode: configuredMember.fastMode } : {}),
    };
  }

  private buildMembersMetaWritePayload(members: TeamCreateRequest['members']): TeamMember[] {
    return applyDistinctProvisioningMemberColors(
      members.map((member) => ({
        name: member.name.trim(),
        role: member.role?.trim() || undefined,
        workflow: member.workflow?.trim() || undefined,
        isolation: member.isolation === 'worktree' ? ('worktree' as const) : undefined,
        cwd: member.cwd?.trim() || undefined,
        executionTarget: member.executionTarget,
        providerId: normalizeOptionalTeamProviderId(member.providerId),
        providerBackendId: migrateProviderBackendId(member.providerId, member.providerBackendId),
        model: member.model?.trim() || undefined,
        effort: isTeamEffortLevel(member.effort) ? member.effort : undefined,
        fastMode:
          member.fastMode === 'inherit' || member.fastMode === 'on' || member.fastMode === 'off'
            ? member.fastMode
            : undefined,
        agentType: 'general-purpose' as const,
        color: getMemberColorByName(member.name.trim()),
        joinedAt:
          typeof (member as { joinedAt?: unknown }).joinedAt === 'number'
            ? (member as { joinedAt?: number }).joinedAt!
            : Date.now(),
      }))
    );
  }

  private setRuntimeAdapterProgress(
    progress: TeamProvisioningProgress,
    onProgress?: (progress: TeamProvisioningProgress) => void
  ): TeamProvisioningProgress {
    this.runtimeAdapterProgressByRunId.set(progress.runId, progress);
    onProgress?.(progress);
    return progress;
  }

  private async getPersistedTranscriptClaudeLogs(
    teamName: string
  ): Promise<RetainedClaudeLogsSnapshot | null> {
    const context = await this.transcriptProjectResolver.getContext(teamName);
    const leadSessionId =
      typeof context?.config.leadSessionId === 'string' ? context.config.leadSessionId.trim() : '';
    if (!context || leadSessionId.length === 0) {
      this.persistedTranscriptClaudeLogsCache.delete(teamName);
      return null;
    }

    const transcriptPath = path.join(context.projectDir, `${leadSessionId}.jsonl`);

    let stat: fs.Stats;
    try {
      stat = await fs.promises.stat(transcriptPath);
    } catch {
      this.persistedTranscriptClaudeLogsCache.delete(teamName);
      return null;
    }

    if (!stat.isFile()) {
      this.persistedTranscriptClaudeLogsCache.delete(teamName);
      return null;
    }

    const cached = this.persistedTranscriptClaudeLogsCache.get(teamName);
    if (
      cached?.transcriptPath === transcriptPath &&
      cached.mtimeMs === stat.mtimeMs &&
      cached.size === stat.size
    ) {
      return cached.snapshot;
    }

    const lines = await this.readTranscriptClaudeLogLines(transcriptPath);
    if (lines.length === 0) {
      this.persistedTranscriptClaudeLogsCache.delete(teamName);
      return null;
    }

    const snapshot = {
      lines,
      updatedAt: stat.mtime.toISOString(),
    };
    this.persistedTranscriptClaudeLogsCache.set(teamName, {
      transcriptPath,
      mtimeMs: stat.mtimeMs,
      size: stat.size,
      snapshot,
    });
    return snapshot;
  }

  private async readTranscriptClaudeLogLines(filePath: string): Promise<string[]> {
    const lines: string[] = [];
    const stream = fs.createReadStream(filePath, { encoding: 'utf8' });
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

    try {
      for await (const rawLine of rl) {
        const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
        if (!line.trim()) {
          continue;
        }
        lines.push(line);
        if (lines.length > TeamProvisioningService.CLAUDE_LOG_LINES_LIMIT) {
          lines.splice(0, lines.length - TeamProvisioningService.CLAUDE_LOG_LINES_LIMIT);
        }
      }
    } finally {
      rl.close();
      stream.close();
    }

    return lines;
  }

  private clearSameTeamRetryTimers(teamName: string): void {
    for (const suffix of ['deferred', 'persist']) {
      const key = `same-team-${suffix}:${teamName}`;
      const timer = this.pendingTimeouts.get(key);
      if (timer) {
        clearTimeout(timer);
        this.pendingTimeouts.delete(key);
      }
    }
  }

  private resetTeamScopedTransientStateForNewRun(teamName: string): void {
    peekAutoResumeService()?.cancelPendingAutoResume(teamName);
    this.retainedClaudeLogsByTeam.delete(teamName);
    this.persistedTranscriptClaudeLogsCache.delete(teamName);
    this.leadInboxRelayInFlight.delete(teamName);
    this.relayedLeadInboxMessageIds.delete(teamName);
    this.inFlightLeadInboxMessageIds.delete(teamName);
    this.pendingCrossTeamFirstReplies.delete(teamName);
    this.recentCrossTeamLeadDeliveryMessageIds.delete(teamName);
    this.recentSameTeamNativeFingerprints.delete(teamName);
    this.clearSameTeamRetryTimers(teamName);

    for (const key of Array.from(this.memberInboxRelayInFlight.keys())) {
      if (key.startsWith(`${teamName}:`)) {
        this.memberInboxRelayInFlight.delete(key);
      }
    }
    for (const key of Array.from(this.openCodeMemberInboxRelayInFlight.keys())) {
      if (key.startsWith(`opencode:${teamName}:`)) {
        this.openCodeMemberInboxRelayInFlight.delete(key);
      }
    }
    for (const key of Array.from(this.openCodePromptDeliveryWatchdogTimers.keys())) {
      if (key.startsWith(`opencode-delivery:${teamName}:`)) {
        const timer = this.openCodePromptDeliveryWatchdogTimers.get(key);
        if (timer) clearTimeout(timer);
        this.openCodePromptDeliveryWatchdogTimers.delete(key);
      }
    }
    for (let index = this.openCodePromptDeliveryWatchdogQueue.length - 1; index >= 0; index -= 1) {
      if (this.openCodePromptDeliveryWatchdogQueue[index]?.teamName === teamName) {
        this.openCodePromptDeliveryWatchdogQueue.splice(index, 1);
      }
    }
    for (const key of Array.from(this.relayedMemberInboxMessageIds.keys())) {
      if (key.startsWith(`${teamName}:`)) {
        this.relayedMemberInboxMessageIds.delete(key);
      }
    }

    this.liveLeadProcessMessages.delete(teamName);
  }

  private appendCliLogs(run: ProvisioningRun, stream: 'stdout' | 'stderr', text: string): void {
    const nowMs = Date.now();
    run.claudeLogsUpdatedAt = new Date(nowMs).toISOString();

    const marker = stream === 'stdout' ? '[stdout]' : '[stderr]';
    if (run.lastClaudeLogStream !== stream) {
      run.lastClaudeLogStream = stream;
      run.claudeLogLines.push(marker);
    }

    if (stream === 'stdout') {
      run.stdoutLogLineBuf += text;
      const parts = run.stdoutLogLineBuf.split('\n');
      run.stdoutLogLineBuf = parts.pop() ?? '';
      for (const part of parts) {
        const normalized = part.endsWith('\r') ? part.slice(0, -1) : part;
        run.claudeLogLines.push(normalized);
      }
    } else {
      run.stderrLogLineBuf += text;
      const parts = run.stderrLogLineBuf.split('\n');
      run.stderrLogLineBuf = parts.pop() ?? '';
      for (const part of parts) {
        const normalized = part.endsWith('\r') ? part.slice(0, -1) : part;
        run.claudeLogLines.push(normalized);
      }
    }
    if (run.claudeLogLines.length > TeamProvisioningService.CLAUDE_LOG_LINES_LIMIT) {
      run.claudeLogLines.splice(
        0,
        run.claudeLogLines.length - TeamProvisioningService.CLAUDE_LOG_LINES_LIMIT
      );
    }
  }

  /**
   * Serializes operations per team name using promise-chaining.
   * Same pattern as withInboxLock / withTaskLock.
   * Prevents TOCTOU races between concurrent createTeam/launchTeam calls.
   */
  private async withTeamLock<T>(teamName: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.teamOpLocks.get(teamName) ?? Promise.resolve();
    let release!: () => void;
    const mine = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.teamOpLocks.set(teamName, mine);
    await prev;
    try {
      return await fn();
    } finally {
      release();
      if (this.teamOpLocks.get(teamName) === mine) {
        this.teamOpLocks.delete(teamName);
      }
    }
  }

  setTeamChangeEmitter(emitter: ((event: TeamChangeEvent) => void) | null): void {
    this.teamChangeEmitter = emitter;
  }

  private parseCrossTeamRecipient(
    currentTeam: string,
    recipient: string,
    localRecipientNames: Set<string>
  ): { teamName: string; memberName: string } | null {
    const trimmed = recipient.trim();
    if (localRecipientNames.has(trimmed)) return null;
    const pseudoTeamName = this.extractCrossTeamPseudoTargetTeam(trimmed);
    if (pseudoTeamName) {
      if (pseudoTeamName === currentTeam) {
        return null;
      }
      return { teamName: pseudoTeamName, memberName: CANONICAL_LEAD_MEMBER_NAME };
    }
    const dot = trimmed.indexOf('.');
    if (dot <= 0 || dot === trimmed.length - 1) return null;
    const teamName = trimmed.slice(0, dot).trim();
    const memberName = trimmed.slice(dot + 1).trim();
    if (!TEAM_NAME_PATTERN.test(teamName) || !memberName || teamName === currentTeam) {
      return null;
    }
    return { teamName, memberName };
  }

  private extractCrossTeamPseudoTargetTeam(value: string): string | null {
    const trimmed = value.trim();
    const prefixes = [
      'cross_team::',
      'cross_team--',
      'cross-team:',
      'cross-team-',
      'cross_team:',
      'cross_team-',
    ];
    for (const prefix of prefixes) {
      if (!trimmed.startsWith(prefix)) continue;
      const teamName = trimmed.slice(prefix.length).trim();
      if (TEAM_NAME_PATTERN.test(teamName)) {
        return teamName;
      }
    }
    return null;
  }

  private isCrossTeamToolRecipientName(name: string): boolean {
    return CROSS_TEAM_TOOL_RECIPIENT_NAMES.has(name.trim());
  }

  private isCrossTeamPseudoRecipientName(name: string): boolean {
    return this.extractCrossTeamPseudoTargetTeam(name) !== null;
  }

  private resolveSingleActiveCrossTeamReplyHint(
    run: ProvisioningRun
  ): { toTeam: string; conversationId: string } | null {
    const uniqueHints = new Map<string, { toTeam: string; conversationId: string }>();
    for (const hint of run.activeCrossTeamReplyHints ?? []) {
      const toTeam = typeof hint?.toTeam === 'string' ? hint.toTeam.trim() : '';
      const conversationId =
        typeof hint?.conversationId === 'string' ? hint.conversationId.trim() : '';
      if (!toTeam || !conversationId) continue;
      uniqueHints.set(`${toTeam}\0${conversationId}`, { toTeam, conversationId });
    }
    return uniqueHints.size === 1 ? (Array.from(uniqueHints.values())[0] ?? null) : null;
  }

  private looksLikeQualifiedExternalRecipientName(name: string): boolean {
    const trimmed = name.trim();
    const dot = trimmed.indexOf('.');
    if (dot <= 0 || dot === trimmed.length - 1) return false;
    const teamName = trimmed.slice(0, dot).trim();
    const memberName = trimmed.slice(dot + 1).trim();
    return TEAM_NAME_PATTERN.test(teamName) && memberName.length > 0;
  }

  private buildCrossTeamConversationKey(otherTeam: string, conversationId: string): string {
    return `${otherTeam.trim()}\0${conversationId.trim()}`;
  }

  registerPendingCrossTeamReplyExpectation(
    teamName: string,
    otherTeam: string,
    conversationId: string
  ): void {
    const normalizedTeam = teamName.trim();
    const normalizedOtherTeam = otherTeam.trim();
    const normalizedConversationId = conversationId.trim();
    if (!normalizedTeam || !normalizedOtherTeam || !normalizedConversationId) return;
    const teamMap =
      this.pendingCrossTeamFirstReplies.get(normalizedTeam) ?? new Map<string, number>();
    teamMap.set(
      this.buildCrossTeamConversationKey(normalizedOtherTeam, normalizedConversationId),
      Date.now()
    );
    this.pendingCrossTeamFirstReplies.set(normalizedTeam, teamMap);
  }

  clearPendingCrossTeamReplyExpectation(
    teamName: string,
    otherTeam: string,
    conversationId: string
  ): void {
    const teamMap = this.pendingCrossTeamFirstReplies.get(teamName.trim());
    if (!teamMap) return;
    teamMap.delete(this.buildCrossTeamConversationKey(otherTeam, conversationId));
    if (teamMap.size === 0) {
      this.pendingCrossTeamFirstReplies.delete(teamName.trim());
    }
  }

  private getPendingCrossTeamReplyExpectationKeys(teamName: string): Set<string> {
    const teamMap = this.pendingCrossTeamFirstReplies.get(teamName.trim());
    if (!teamMap) return new Set<string>();
    const cutoff = Date.now() - TeamProvisioningService.RECENT_CROSS_TEAM_DELIVERY_TTL_MS;
    for (const [key, createdAt] of teamMap.entries()) {
      if (createdAt < cutoff) {
        teamMap.delete(key);
      }
    }
    if (teamMap.size === 0) {
      this.pendingCrossTeamFirstReplies.delete(teamName.trim());
      return new Set<string>();
    }
    return new Set(teamMap.keys());
  }

  private getRunLeadName(run: ProvisioningRun): string {
    return (
      run.request.members.find((m) => m.role?.toLowerCase().includes('lead'))?.name ||
      CANONICAL_LEAD_MEMBER_NAME
    );
  }

  private rememberRecentCrossTeamLeadDeliveryMessageIds(
    teamName: string,
    messageIds: string[]
  ): void {
    const normalizedIds = messageIds.map((id) => id.trim()).filter((id) => id.length > 0);
    if (normalizedIds.length === 0) return;
    const teamKey = teamName.trim();
    const current =
      this.recentCrossTeamLeadDeliveryMessageIds.get(teamKey) ?? new Map<string, number>();
    const now = Date.now();
    const cutoff = now - TeamProvisioningService.RECENT_CROSS_TEAM_DELIVERY_TTL_MS;
    for (const [key, createdAt] of current.entries()) {
      if (createdAt < cutoff) current.delete(key);
    }
    for (const messageId of normalizedIds) {
      current.set(messageId, now);
    }
    if (current.size > 0) {
      this.recentCrossTeamLeadDeliveryMessageIds.set(teamKey, current);
    }
  }

  private wasRecentlyDeliveredToLead(teamName: string, messageId: string): boolean {
    const normalizedMessageId = messageId.trim();
    if (!normalizedMessageId) return false;
    const teamKey = teamName.trim();
    const current = this.recentCrossTeamLeadDeliveryMessageIds.get(teamKey);
    if (!current) return false;
    const cutoff = Date.now() - TeamProvisioningService.RECENT_CROSS_TEAM_DELIVERY_TTL_MS;
    for (const [key, createdAt] of current.entries()) {
      if (createdAt < cutoff) current.delete(key);
    }
    if (current.size === 0) {
      this.recentCrossTeamLeadDeliveryMessageIds.delete(teamKey);
      return false;
    }
    return current.has(normalizedMessageId);
  }

  private parseCrossTeamTargetTeam(value: string | undefined): string | null {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    if (!trimmed) return null;
    if (trimmed.startsWith('cross-team:')) {
      const teamName = trimmed.slice('cross-team:'.length).trim();
      return TEAM_NAME_PATTERN.test(teamName) ? teamName : null;
    }
    const dot = trimmed.indexOf('.');
    if (dot <= 0) return null;
    const teamName = trimmed.slice(0, dot).trim();
    return TEAM_NAME_PATTERN.test(teamName) ? teamName : null;
  }

  private getCrossTeamSourceTeam(value: string | undefined): string | null {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    const dot = trimmed.indexOf('.');
    if (dot <= 0) return null;
    const teamName = trimmed.slice(0, dot).trim();
    return TEAM_NAME_PATTERN.test(teamName) ? teamName : null;
  }

  private extractStreamUserText(msg: Record<string, unknown>): string | null {
    const topLevelContent = msg.content;
    if (typeof topLevelContent === 'string') {
      return topLevelContent;
    }
    if (Array.isArray(topLevelContent)) {
      const text = topLevelContent
        .filter(
          (part): part is Record<string, unknown> =>
            !!part &&
            typeof part === 'object' &&
            part.type === 'text' &&
            typeof part.text === 'string'
        )
        .map((part) => part.text as string)
        .join('\n')
        .trim();
      if (text.length > 0) return text;
    }

    const message = msg.message;
    if (!message || typeof message !== 'object') return null;
    const innerContent = (message as Record<string, unknown>).content;
    if (typeof innerContent === 'string') {
      const trimmed = innerContent.trim();
      return trimmed.length > 0 ? trimmed : null;
    }
    if (!Array.isArray(innerContent)) return null;
    const text = innerContent
      .filter(
        (part): part is Record<string, unknown> =>
          !!part &&
          typeof part === 'object' &&
          part.type === 'text' &&
          typeof part.text === 'string'
      )
      .map((part) => part.text as string)
      .join('\n')
      .trim();
    return text.length > 0 ? text : null;
  }

  private extractStreamContentBlocks(msg: Record<string, unknown>): Record<string, unknown>[] {
    const topLevelContent = msg.content;
    if (Array.isArray(topLevelContent)) {
      return topLevelContent as Record<string, unknown>[];
    }

    const message = msg.message;
    if (!message || typeof message !== 'object') return [];
    const innerContent = (message as Record<string, unknown>).content;
    return Array.isArray(innerContent) ? (innerContent as Record<string, unknown>[]) : [];
  }

  private hasCapturedVisibleSendMessage(
    content: Record<string, unknown>[],
    teamName: string
  ): boolean {
    return content.some((part) => {
      if (!part || typeof part !== 'object') return false;
      if (part.type !== 'tool_use' || typeof part.name !== 'string') return false;

      const input = part.input;
      if (!input || typeof input !== 'object') return false;
      const inp = input as Record<string, unknown>;

      if (part.name === 'SendMessage') {
        const target = this.extractMessageToolTarget(inp, ['recipient', 'to']);
        const text = this.extractMessageToolText(inp);
        return target === 'user' && text.length > 0;
      }

      const isTeamMessageSendTool = isAgentTeamsToolUse({
        rawName: part.name,
        canonicalName: 'message_send',
        toolInput: inp,
        currentTeamName: teamName,
      });
      const isDirectCrossTeamSendTool = isAgentTeamsToolUse({
        rawName: part.name,
        canonicalName: 'cross_team_send',
        toolInput: inp,
        currentTeamName: teamName,
      });
      if (!isTeamMessageSendTool && !isDirectCrossTeamSendTool) return false;

      const target = isTeamMessageSendTool
        ? this.extractMessageToolTarget(inp, ['to'])
        : this.extractMessageToolTarget(inp, ['toTeam']);
      const text = this.extractMessageToolText(inp);

      return target === 'user' && text.length > 0;
    });
  }

  private extractMessageToolTarget(input: Record<string, unknown>, keys: string[]): string {
    for (const key of keys) {
      const value = input[key];
      if (typeof value === 'string' && value.trim()) {
        return value.trim();
      }
    }
    return '';
  }

  private extractMessageToolText(input: Record<string, unknown>): string {
    for (const key of ['content', 'message', 'text']) {
      const value = input[key];
      if (typeof value === 'string' && value.trim()) {
        return value.trim();
      }
    }
    return '';
  }

  private async matchCrossTeamLeadInboxMessages(
    teamName: string,
    leadName: string,
    deliveredBlocks: {
      teammateId: string;
      content: string;
      toTeam: string;
      conversationId: string;
    }[]
  ): Promise<
    {
      teammateId: string;
      content: string;
      toTeam: string;
      conversationId: string;
      messageId: string;
      wasRead: boolean;
    }[]
  > {
    if (deliveredBlocks.length === 0) return [];

    let leadInboxMessages: Awaited<ReturnType<TeamInboxReader['getMessagesFor']>> = [];
    try {
      leadInboxMessages = await this.inboxReader.getMessagesFor(teamName, leadName);
    } catch {
      return [];
    }

    const usedMessageIds = new Set<string>();
    const matches: {
      teammateId: string;
      content: string;
      toTeam: string;
      conversationId: string;
      messageId: string;
      wasRead: boolean;
    }[] = [];
    for (const block of deliveredBlocks) {
      const matchesBlock = (message: InboxMessage, requireExactText: boolean): boolean => {
        if (message.source !== CROSS_TEAM_SOURCE) return false;
        if (!this.hasStableMessageId(message)) return false;
        if (usedMessageIds.has(message.messageId)) return false;
        if (message.from.trim() !== block.teammateId.trim()) return false;
        const messageConversationId =
          message.replyToConversationId?.trim() ??
          message.conversationId?.trim() ??
          parseCrossTeamPrefix(message.text)?.conversationId;
        if (messageConversationId !== block.conversationId) return false;
        return !requireExactText || message.text.trim() === block.content.trim();
      };
      const matched =
        leadInboxMessages.find((message) => matchesBlock(message, true)) ??
        leadInboxMessages.find((message) => matchesBlock(message, false));
      if (!matched || !this.hasStableMessageId(matched)) continue;
      usedMessageIds.add(matched.messageId);
      matches.push({
        teammateId: block.teammateId,
        content: block.content,
        toTeam: block.toTeam,
        conversationId: block.conversationId,
        messageId: matched.messageId,
        wasRead: matched.read === true,
      });
    }

    return matches;
  }

  private handleNativeTeammateUserMessage(
    run: ProvisioningRun,
    msg: Record<string, unknown>
  ): void {
    const rawText = this.extractStreamUserText(msg);
    if (!rawText) return;

    const blocks = parseAllTeammateMessages(rawText);
    if (blocks.length === 0) return;

    // Intercept teammate permission_request messages delivered natively via stdout.
    // This runs even during provisioning (unlike relayLeadInboxMessages which waits
    // for provisioningComplete). The lead already received the message — we can't
    // prevent that — but we create a ToolApprovalRequest so the user sees the dialog.
    for (const block of blocks) {
      const perm = parsePermissionRequest(block.content);
      if (perm) {
        this.handleTeammatePermissionRequest(run, perm, new Date().toISOString());
      }
    }

    const crossTeamBlocks = blocks.flatMap((block) => {
      const origin = parseCrossTeamPrefix(block.content);
      const sourceTeam = origin?.from.includes('.') ? origin.from.split('.', 1)[0] : null;
      const conversationId =
        origin?.conversationId?.trim() || origin?.replyToConversationId?.trim();
      if (!sourceTeam || !conversationId) return [];
      return [
        {
          teammateId: block.teammateId,
          content: block.content,
          toTeam: sourceTeam,
          conversationId,
        },
      ];
    });
    // Cross-team reconciliation (existing logic)
    if (crossTeamBlocks.length > 0) {
      const leadName = this.getRunLeadName(run);
      void (async () => {
        const matches = await this.matchCrossTeamLeadInboxMessages(
          run.teamName,
          leadName,
          crossTeamBlocks
        );
        const unreadMatches = matches.filter((match) => !match.wasRead);
        if (unreadMatches.length > 0) {
          try {
            await this.markInboxMessagesRead(run.teamName, leadName, unreadMatches);
          } catch {
            // best-effort
          }
        }
        const freshMatches = matches.filter(
          (match) => !this.wasRecentlyDeliveredToLead(run.teamName, match.messageId)
        );
        this.rememberRecentCrossTeamLeadDeliveryMessageIds(
          run.teamName,
          freshMatches.map((match) => match.messageId)
        );
        run.activeCrossTeamReplyHints = freshMatches.map((match) => ({
          toTeam: match.toTeam,
          conversationId: match.conversationId,
        }));
      })();
    }

    // Same-team teammate messages are the canonical heartbeat signal: they prove the
    // runtime produced a real post-spawn message, unlike writes to inboxes/<member>.json
    // which may simply be user/lead messages addressed TO the teammate.
    const sameTeamBlocks = blocks.filter((block) => !parseCrossTeamPrefix(block.content));
    const meaningfulSameTeamBlocks = sameTeamBlocks.filter((block) =>
      isMeaningfulBootstrapCheckInMessage(block.content)
    );
    for (const block of meaningfulSameTeamBlocks) {
      this.setMemberSpawnStatus(run, block.teammateId, 'online', undefined, 'heartbeat');
    }
    for (const block of sameTeamBlocks) {
      const bootstrapFailureReason = extractBootstrapFailureReason(block.content);
      if (!bootstrapFailureReason) continue;
      this.setMemberSpawnStatus(run, block.teammateId, 'error', bootstrapFailureReason);
    }
    if (sameTeamBlocks.length > 0) {
      this.rememberSameTeamNativeFingerprints(run.teamName, sameTeamBlocks);
      const leadName = this.getRunLeadName(run);
      void this.reconcileSameTeamNativeDeliveries(run.teamName, leadName);
    }
  }

  private async refreshMemberSpawnStatusesFromLeadInbox(run: ProvisioningRun): Promise<void> {
    const leadName = this.getRunLeadName(run);
    let leadInboxMessages: Awaited<ReturnType<TeamInboxReader['getMessagesFor']>> = [];
    try {
      leadInboxMessages = await this.inboxReader.getMessagesFor(run.teamName, leadName);
    } catch {
      return;
    }

    const runStartedAtMs = Date.parse(run.startedAt);
    const expectedMembers = Array.isArray(run.expectedMembers) ? run.expectedMembers : [];
    const teammateMessages = leadInboxMessages
      .filter((message): message is LeadInboxMemberSpawnMessage => {
        const from = typeof message.from === 'string' ? message.from.trim() : '';
        if (!from || from === leadName || from === 'user' || from === 'system') return false;
        if (!this.resolveExpectedLaunchMemberName(expectedMembers, from)) return false;
        if (typeof message.messageId !== 'string' || message.messageId.trim().length === 0) {
          return false;
        }
        const messageTs = Date.parse(message.timestamp);
        if (
          Number.isFinite(messageTs) &&
          Number.isFinite(runStartedAtMs) &&
          messageTs < runStartedAtMs
        ) {
          return false;
        }
        return typeof message.text === 'string' && message.text.trim().length > 0;
      })
      .sort((left, right) =>
        compareMemberSpawnInboxCursor(
          { timestamp: left.timestamp, messageId: left.messageId },
          { timestamp: right.timestamp, messageId: right.messageId }
        )
      );

    const messagesByMember = new Map<string, LeadInboxMemberSpawnMessage[]>();
    for (const message of teammateMessages) {
      const memberName = this.resolveExpectedLaunchMemberName(expectedMembers, message.from);
      if (!memberName) {
        continue;
      }
      const bucket = messagesByMember.get(memberName) ?? [];
      bucket.push(message);
      messagesByMember.set(memberName, bucket);
    }

    for (const [memberName, messages] of messagesByMember.entries()) {
      const currentCursor = run.memberSpawnLeadInboxCursorByMember.get(memberName);
      let nextCursor = currentCursor;

      for (const message of messages) {
        const messageCursor = toMemberSpawnInboxCursor(message);
        const effectiveCursor = nextCursor ?? currentCursor;
        if (messageCursor && effectiveCursor) {
          if (compareMemberSpawnInboxCursor(messageCursor, effectiveCursor) <= 0) {
            continue;
          }
        }

        this.applyLeadInboxSpawnSignal(run, memberName, message);
        if (messageCursor) {
          nextCursor = maxMemberSpawnInboxCursor(nextCursor, messageCursor);
        }
      }

      if (
        nextCursor &&
        (currentCursor == null || compareMemberSpawnInboxCursor(nextCursor, currentCursor) > 0)
      ) {
        run.memberSpawnLeadInboxCursorByMember.set(memberName, nextCursor);
      }
    }
  }

  private applyLeadInboxSpawnSignal(
    run: ProvisioningRun,
    memberName: string,
    message: LeadInboxMemberSpawnMessage
  ): void {
    const reason = extractBootstrapFailureReason(message.text);
    if (reason) {
      this.setMemberSpawnStatus(run, memberName, 'error', reason);
      return;
    }
    this.setMemberSpawnStatus(
      run,
      memberName,
      'online',
      undefined,
      'heartbeat',
      extractHeartbeatTimestamp(message.text, message.timestamp)
    );
  }

  private resolveExpectedLaunchMemberName(
    expectedMembers: readonly string[] | undefined,
    candidateName: string
  ): string | null {
    const trimmedCandidate = candidateName.trim();
    if (!trimmedCandidate || !Array.isArray(expectedMembers) || expectedMembers.length === 0) {
      return null;
    }

    const exact = expectedMembers.find((memberName) =>
      matchesExactTeamMemberName(memberName, trimmedCandidate)
    );
    if (exact) {
      return exact;
    }

    const matches = expectedMembers.filter((memberName) =>
      matchesObservedMemberNameForExpected(trimmedCandidate, memberName)
    );
    return matches.length === 1 ? (matches[0] ?? null) : null;
  }

  private persistSentMessage(teamName: string, message: InboxMessage): void {
    try {
      createController({
        teamName,
        claudeDir: getClaudeBasePath(),
      }).messages.appendSentMessage({
        from: message.from,
        to: message.to,
        text: message.text,
        timestamp: message.timestamp,
        summary: message.summary,
        messageId: message.messageId,
        relayOfMessageId: message.relayOfMessageId,
        source: message.source,
        leadSessionId: message.leadSessionId,
        conversationId: message.conversationId,
        replyToConversationId: message.replyToConversationId,
        taskRefs: message.taskRefs,
        attachments: message.attachments,
        color: message.color,
        toolSummary: message.toolSummary,
        toolCalls: message.toolCalls,
        messageKind: message.messageKind,
        slashCommand: message.slashCommand,
        commandOutput: message.commandOutput,
        externalChannel: message.externalChannel,
      });
    } catch (error) {
      logger.warn(`[${teamName}] sent-message persist failed: ${String(error)}`);
    }
  }

  private persistInboxMessage(teamName: string, recipient: string, message: InboxMessage): void {
    try {
      createController({
        teamName,
        claudeDir: getClaudeBasePath(),
      }).messages.sendMessage({
        member: recipient,
        from: message.from,
        text: message.text,
        timestamp: message.timestamp,
        summary: message.summary,
        messageId: message.messageId,
        relayOfMessageId: message.relayOfMessageId,
        source: message.source,
        leadSessionId: message.leadSessionId,
        conversationId: message.conversationId,
        replyToConversationId: message.replyToConversationId,
        taskRefs: message.taskRefs,
        attachments: message.attachments,
        color: message.color,
        toolSummary: message.toolSummary,
        toolCalls: message.toolCalls,
        messageKind: message.messageKind,
        slashCommand: message.slashCommand,
        commandOutput: message.commandOutput,
        externalChannel: message.externalChannel,
      });
    } catch (error) {
      logger.warn(`[${teamName}] inbox-message persist for ${recipient} failed: ${String(error)}`);
    }
  }

  private getMemberRelayKey(teamName: string, memberName: string): string {
    return `${teamName}:${memberName.trim()}`;
  }

  private getOpenCodeMemberRelayKey(teamName: string, memberName: string): string {
    return `opencode:${this.getMemberRelayKey(teamName, memberName)}`;
  }

  private normalizeRelayCandidateText(text: string): string {
    return stripAgentBlocks(String(text)).trim().replace(/\r\n/g, '\n');
  }

  private normalizeRelayCandidateSummary(summary?: string): string {
    return typeof summary === 'string' ? summary.trim() : '';
  }

  private prunePendingInboxRelayCandidates(run: ProvisioningRun): PendingInboxRelayCandidate[] {
    const cutoff = Date.now() - TeamProvisioningService.PENDING_INBOX_RELAY_TTL_MS;
    run.pendingInboxRelayCandidates = (run.pendingInboxRelayCandidates ?? []).filter(
      (candidate) => candidate.queuedAtMs >= cutoff
    );
    return run.pendingInboxRelayCandidates;
  }

  private rememberPendingInboxRelayCandidates(
    run: ProvisioningRun,
    recipient: string,
    messages: Pick<InboxMessage, 'messageId' | 'text' | 'summary'>[]
  ): string[] {
    const candidates = this.prunePendingInboxRelayCandidates(run);
    const queuedAtMs = Date.now();
    const rememberedIds: string[] = [];
    for (const message of messages) {
      const sourceMessageId = typeof message.messageId === 'string' ? message.messageId.trim() : '';
      const normalizedText = this.normalizeRelayCandidateText(message.text);
      if (!sourceMessageId || !normalizedText) {
        continue;
      }
      candidates.push({
        recipient,
        sourceMessageId,
        normalizedText,
        normalizedSummary: this.normalizeRelayCandidateSummary(message.summary),
        queuedAtMs,
      });
      rememberedIds.push(sourceMessageId);
    }
    return rememberedIds;
  }

  private forgetPendingInboxRelayCandidates(
    run: ProvisioningRun,
    recipient: string,
    sourceMessageIds: readonly string[]
  ): void {
    if (sourceMessageIds.length === 0) {
      return;
    }
    const idSet = new Set(sourceMessageIds);
    run.pendingInboxRelayCandidates = this.prunePendingInboxRelayCandidates(run).filter(
      (candidate) => !(candidate.recipient === recipient && idSet.has(candidate.sourceMessageId))
    );
  }

  private consumePendingInboxRelayCandidate(
    run: ProvisioningRun,
    recipient: string,
    text: string,
    summary?: string
  ): string | undefined {
    const normalizedText = this.normalizeRelayCandidateText(text);
    if (!normalizedText) {
      return undefined;
    }
    const normalizedSummary = this.normalizeRelayCandidateSummary(summary);
    const candidates = this.prunePendingInboxRelayCandidates(run);
    const exactSummaryIdx = candidates.findIndex(
      (candidate) =>
        candidate.recipient === recipient &&
        candidate.normalizedText === normalizedText &&
        candidate.normalizedSummary === normalizedSummary
    );
    const fallbackIdx =
      exactSummaryIdx >= 0
        ? exactSummaryIdx
        : candidates.findIndex(
            (candidate) =>
              candidate.recipient === recipient && candidate.normalizedText === normalizedText
          );
    if (fallbackIdx < 0) {
      return undefined;
    }
    const [matched] = candidates.splice(fallbackIdx, 1);
    return matched?.sourceMessageId;
  }

  private armSilentTeammateForward(
    run: ProvisioningRun,
    teammateName: string,
    mode: 'user_dm' | 'member_inbox_relay'
  ): void {
    run.silentUserDmForward = { target: teammateName, startedAt: nowIso(), mode };
    if (run.silentUserDmForwardClearHandle) {
      clearTimeout(run.silentUserDmForwardClearHandle);
      run.silentUserDmForwardClearHandle = null;
    }
    run.silentUserDmForwardClearHandle = setTimeout(() => {
      run.silentUserDmForward = null;
      run.silentUserDmForwardClearHandle = null;
    }, 60_000);
    run.silentUserDmForwardClearHandle.unref();
  }

  private toolApprovalEventEmitter: ((event: ToolApprovalEvent) => void) | null = null;
  private mainWindowRef: import('electron').BrowserWindow | null = null;
  private activeApprovalNotifications = new Map<string, import('electron').Notification>();

  setToolApprovalEventEmitter(emitter: (event: ToolApprovalEvent) => void): void {
    this.toolApprovalEventEmitter = emitter;
  }

  setMainWindow(win: import('electron').BrowserWindow | null): void {
    this.mainWindowRef = win;
  }

  private getToolApprovalSettings(teamName: string): ToolApprovalSettings {
    return this.toolApprovalSettingsByTeam.get(teamName) ?? DEFAULT_TOOL_APPROVAL_SETTINGS;
  }

  updateToolApprovalSettings(teamName: string, settings: ToolApprovalSettings): void {
    this.toolApprovalSettingsByTeam.set(teamName, settings);
    this.reEvaluatePendingApprovals();
  }

  private emitToolApprovalEvent(event: ToolApprovalEvent): void {
    this.toolApprovalEventEmitter?.(event);
  }

  getLiveLeadProcessMessages(teamName: string): InboxMessage[] {
    const runId = this.getTrackedRunId(teamName);
    const detectedSessionId = runId ? (this.runs.get(runId)?.detectedSessionId ?? null) : null;

    return (this.liveLeadProcessMessages.get(teamName) ?? []).map((message) =>
      !message.leadSessionId && detectedSessionId
        ? { ...message, leadSessionId: detectedSessionId }
        : { ...message }
    );
  }

  private pruneLiveLeadMessagesForCleanedRun(run: ProvisioningRun): void {
    const list = this.liveLeadProcessMessages.get(run.teamName);
    if (!list || list.length === 0) {
      return;
    }

    const runMessageIdPrefixes = [
      `lead-turn-${run.runId}-`,
      `lead-sendmsg-${run.runId}-`,
      `lead-process-${run.runId}-`,
      `compact-${run.runId}-`,
    ];

    const filtered = list.filter((message) => {
      const messageId = typeof message.messageId === 'string' ? message.messageId.trim() : '';
      if (messageId && runMessageIdPrefixes.some((prefix) => messageId.startsWith(prefix))) {
        return false;
      }

      if (run.detectedSessionId && message.leadSessionId === run.detectedSessionId) {
        return false;
      }

      return true;
    });

    if (filtered.length === 0) {
      this.liveLeadProcessMessages.delete(run.teamName);
      return;
    }

    this.liveLeadProcessMessages.set(run.teamName, filtered);
  }

  getCurrentLeadSessionId(teamName: string): string | null {
    const runId = this.getTrackedRunId(teamName);
    if (!runId) return null;
    return this.runs.get(runId)?.detectedSessionId ?? null;
  }

  getCurrentRunId(teamName: string): string | null {
    return this.getAliveRunId(teamName);
  }

  async recordOpenCodeRuntimeBootstrapCheckin(raw: unknown): Promise<OpenCodeRuntimeControlAck> {
    const payload = asRuntimeRecord(raw);
    const teamName = requireRuntimeString(payload.teamName, 'teamName');
    const runId = requireRuntimeString(payload.runId, 'runId');
    const memberName = requireRuntimeString(payload.memberName, 'memberName');
    const runtimeSessionId = requireRuntimeString(payload.runtimeSessionId, 'runtimeSessionId');
    const observedAt = normalizeRuntimeIso(payload.observedAt);
    const laneId = await this.resolveOpenCodeRuntimeLaneId({ teamName, runId, memberName });

    await this.assertOpenCodeRuntimeEvidenceAccepted({
      teamName,
      runId,
      laneId,
      evidenceKind: 'bootstrap_checkin',
    });
    await this.updateOpenCodeRuntimeMemberLiveness({
      teamName,
      runId,
      memberName,
      runtimeSessionId,
      observedAt,
      diagnostics: payload.diagnostics,
      metadata: parseRuntimeToolMetadata(payload.metadata),
      reason: 'OpenCode runtime bootstrap check-in accepted',
    });

    return {
      ok: true,
      providerId: 'opencode',
      teamName,
      runId,
      state: 'accepted',
      memberName,
      runtimeSessionId,
      diagnostics: [],
      observedAt,
    };
  }

  async deliverOpenCodeRuntimeMessage(raw: unknown): Promise<OpenCodeRuntimeControlAck> {
    const payload = asRuntimeRecord(raw);
    const teamName = requireRuntimeString(payload.teamName, 'teamName');
    const runId = requireRuntimeString(payload.runId, 'runId');
    const fromMemberName = requireRuntimeString(payload.fromMemberName, 'fromMemberName');
    const laneId = await this.resolveOpenCodeRuntimeLaneId({
      teamName,
      runId,
      memberName: fromMemberName,
    });
    await this.assertOpenCodeRuntimeEvidenceAccepted({
      teamName,
      runId,
      laneId,
      evidenceKind: 'delivery_call',
    });

    const delivery = this.createOpenCodeRuntimeDeliveryService(teamName, laneId);
    const ack = await delivery.deliver({
      ...payload,
      teamName,
      runId,
      providerId: 'opencode',
      createdAt: normalizeRuntimeIso(payload.createdAt),
    });

    if (!ack.ok) {
      throw new Error(`OpenCode runtime delivery rejected: ${ack.reason}`);
    }

    return {
      ok: true,
      providerId: 'opencode',
      teamName,
      runId,
      state: ack.delivered ? 'delivered' : 'duplicate',
      idempotencyKey: ack.idempotencyKey,
      location: ack.location,
      diagnostics: ack.reason ? [ack.reason] : [],
      observedAt: normalizeRuntimeIso(payload.createdAt),
    };
  }

  async recordOpenCodeRuntimeTaskEvent(raw: unknown): Promise<OpenCodeRuntimeControlAck> {
    const payload = asRuntimeRecord(raw);
    const teamName = requireRuntimeString(payload.teamName, 'teamName');
    const runId = requireRuntimeString(payload.runId, 'runId');
    const memberName = requireRuntimeString(payload.memberName, 'memberName');
    const taskId = requireRuntimeString(payload.taskId, 'taskId');
    const event = requireRuntimeString(payload.event, 'event');
    const idempotencyKey = requireRuntimeString(payload.idempotencyKey, 'idempotencyKey');
    const runtimeSessionId = optionalRuntimeString(payload.runtimeSessionId);
    const observedAt = normalizeRuntimeIso(payload.createdAt);
    const laneId = await this.resolveOpenCodeRuntimeLaneId({ teamName, runId, memberName });

    await this.assertOpenCodeRuntimeEvidenceAccepted({
      teamName,
      runId,
      laneId,
      evidenceKind: 'delivery_call',
    });

    const writeResult = await this.openCodeTaskLogAttributionStore.upsertTaskRecord(teamName, {
      taskId,
      memberName,
      scope: 'member_session_window',
      ...(runtimeSessionId ? { sessionId: runtimeSessionId } : {}),
      since: observedAt,
      source: 'launch_runtime',
    });
    this.teamChangeEmitter?.({
      type: 'task-log-change',
      teamName,
      runId,
      taskId,
      detail: `opencode-runtime-task-event:${event}`,
    });

    return {
      ok: true,
      providerId: 'opencode',
      teamName,
      runId,
      state: 'recorded',
      memberName,
      ...(runtimeSessionId ? { runtimeSessionId } : {}),
      idempotencyKey,
      diagnostics: [writeResult],
      observedAt,
    };
  }

  async recordOpenCodeRuntimeHeartbeat(raw: unknown): Promise<OpenCodeRuntimeControlAck> {
    const payload = asRuntimeRecord(raw);
    const teamName = requireRuntimeString(payload.teamName, 'teamName');
    const runId = requireRuntimeString(payload.runId, 'runId');
    const memberName = requireRuntimeString(payload.memberName, 'memberName');
    const runtimeSessionId = requireRuntimeString(payload.runtimeSessionId, 'runtimeSessionId');
    const observedAt = normalizeRuntimeIso(payload.observedAt);
    const laneId = await this.resolveOpenCodeRuntimeLaneId({ teamName, runId, memberName });

    await this.assertOpenCodeRuntimeEvidenceAccepted({
      teamName,
      runId,
      laneId,
      evidenceKind: 'heartbeat',
    });
    await this.updateOpenCodeRuntimeMemberLiveness({
      teamName,
      runId,
      memberName,
      runtimeSessionId,
      observedAt,
      diagnostics: undefined,
      metadata: parseRuntimeToolMetadata(payload.metadata),
      reason: `OpenCode runtime heartbeat accepted${optionalRuntimeString(payload.status) ? ` (${optionalRuntimeString(payload.status)})` : ''}`,
    });

    return {
      ok: true,
      providerId: 'opencode',
      teamName,
      runId,
      state: 'accepted',
      memberName,
      runtimeSessionId,
      diagnostics: [],
      observedAt,
    };
  }

  private async assertOpenCodeRuntimeEvidenceAccepted(input: {
    teamName: string;
    runId: string;
    laneId: string;
    evidenceKind: RuntimeEvidenceKind;
  }): Promise<void> {
    const store = createRuntimeRunTombstoneStore({
      filePath: getOpenCodeRuntimeRunTombstonesPath(
        getTeamsBasePath(),
        input.teamName,
        input.laneId
      ),
    });
    await store.assertEvidenceAccepted({
      teamName: input.teamName,
      runId: input.runId,
      currentRunId: await this.resolveCurrentOpenCodeRuntimeRunId(input.teamName, input.laneId),
      evidenceKind: input.evidenceKind,
    });
  }

  private async updateOpenCodeRuntimeMemberLiveness(input: {
    teamName: string;
    runId: string;
    memberName: string;
    runtimeSessionId: string;
    observedAt: string;
    diagnostics: unknown;
    metadata?: RuntimeToolMetadata;
    reason: string;
  }): Promise<void> {
    const previous = await this.launchStateStore.read(input.teamName);
    const expectedMembers = previous
      ? this.getPersistedLaunchMemberNames(previous)
      : this.readPersistedRuntimeMembers(input.teamName)
          .map((member) => (typeof member.name === 'string' ? member.name.trim() : ''))
          .filter((name) => name.length > 0 && name !== 'user' && !isLeadMember({ name }));
    const previousMember = previous?.members[input.memberName];
    const persistedIdentity = this.resolvePersistedRuntimeMemberIdentity({
      teamName: input.teamName,
      memberName: input.memberName,
      previousMember,
    });
    const nextMember: PersistedTeamLaunchMemberState = {
      ...persistedIdentity,
      ...(previousMember ?? {}),
      name: input.memberName,
      launchState: 'confirmed_alive',
      agentToolAccepted: true,
      runtimeAlive: true,
      bootstrapConfirmed: true,
      hardFailure: false,
      ...(input.metadata?.runtimePid ? { runtimePid: input.metadata.runtimePid } : {}),
      runtimeSessionId: input.runtimeSessionId,
      livenessKind: 'confirmed_bootstrap',
      ...(input.metadata?.runtimePid ? { pidSource: 'runtime_bootstrap' as const } : {}),
      runtimeDiagnostic: input.reason,
      runtimeDiagnosticSeverity: 'info',
      runtimeLastSeenAt: input.observedAt,
      firstSpawnAcceptedAt: previousMember?.firstSpawnAcceptedAt ?? input.observedAt,
      lastHeartbeatAt: input.observedAt,
      lastRuntimeAliveAt: input.observedAt,
      lastEvaluatedAt: input.observedAt,
      sources: {
        ...(previousMember?.sources ?? {}),
        nativeHeartbeat: true,
        processAlive: true,
      },
      diagnostics: mergeRuntimeDiagnostics(
        previousMember?.diagnostics,
        [
          ...normalizeRuntimeStringArray(input.diagnostics),
          ...buildRuntimeToolMetadataDiagnostics(input.metadata),
        ],
        input.reason
      ),
    };
    const snapshot = createPersistedLaunchSnapshot({
      teamName: input.teamName,
      expectedMembers: [...new Set([...expectedMembers, input.memberName])],
      leadSessionId: previous?.leadSessionId,
      launchPhase: previous?.launchPhase ?? 'active',
      members: {
        ...(previous?.members ?? {}),
        [input.memberName]: nextMember,
      },
      updatedAt: input.observedAt,
    });
    await this.launchStateStore.write(input.teamName, snapshot);
    this.agentRuntimeSnapshotCache.delete(input.teamName);
    this.liveTeamAgentRuntimeMetadataCache.delete(input.teamName);
    this.teamChangeEmitter?.({
      type: 'member-spawn',
      teamName: input.teamName,
      runId: input.runId,
      detail: input.memberName,
    });
  }

  private resolvePersistedRuntimeMemberIdentity(params: {
    teamName: string;
    memberName: string;
    previousMember?: PersistedTeamLaunchMemberState;
  }): Partial<PersistedTeamLaunchMemberState> {
    if (params.previousMember) {
      return {
        providerId: params.previousMember.providerId,
        providerBackendId: params.previousMember.providerBackendId,
        model: params.previousMember.model,
        effort: params.previousMember.effort,
        selectedFastMode: params.previousMember.selectedFastMode,
        resolvedFastMode: params.previousMember.resolvedFastMode,
        laneId: params.previousMember.laneId,
        laneKind: params.previousMember.laneKind,
        laneOwnerProviderId: params.previousMember.laneOwnerProviderId,
        launchIdentity: params.previousMember.launchIdentity,
      };
    }

    const trackedRunId = this.getTrackedRunId(params.teamName);
    const trackedRun = trackedRunId ? this.runs.get(trackedRunId) : null;
    const secondaryLane = trackedRun?.mixedSecondaryLanes?.find(
      (lane) => lane.member.name.trim() === params.memberName
    );
    if (secondaryLane) {
      return {
        providerId: 'opencode',
        model: secondaryLane.member.model,
        effort: secondaryLane.member.effort,
        laneId: secondaryLane.laneId,
        laneKind: 'secondary',
        laneOwnerProviderId: 'opencode',
      };
    }

    const primaryMember = trackedRun?.effectiveMembers?.find(
      (member) => member.name.trim() === params.memberName
    );
    if (!primaryMember) {
      return {};
    }

    const laneIdentity = buildPlannedMemberLaneIdentity({
      leadProviderId: resolveTeamProviderId(trackedRun?.request.providerId),
      member: {
        name: primaryMember.name,
        providerId: normalizeOptionalTeamProviderId(primaryMember.providerId),
      },
    });
    const providerId =
      normalizeOptionalTeamProviderId(primaryMember.providerId) ??
      resolveTeamProviderId(trackedRun?.request.providerId);

    return {
      providerId,
      providerBackendId: migrateProviderBackendId(
        providerId,
        primaryMember.providerBackendId ?? trackedRun?.request.providerBackendId
      ),
      model: primaryMember.model,
      effort: primaryMember.effort,
      selectedFastMode: primaryMember.fastMode ?? trackedRun?.request.fastMode,
      laneId: laneIdentity.laneId,
      laneKind: laneIdentity.laneKind,
      laneOwnerProviderId: laneIdentity.laneOwnerProviderId,
    };
  }

  private createOpenCodeRuntimeDeliveryService(
    teamName: string,
    laneId: string
  ): RuntimeDeliveryService {
    const journal = createRuntimeDeliveryJournalStore({
      filePath: getOpenCodeLaneScopedRuntimeFilePath({
        teamsBasePath: getTeamsBasePath(),
        teamName,
        laneId,
        fileName: 'opencode-delivery-journal.json',
      }),
    });
    return new RuntimeDeliveryService(
      {
        getCurrentRunId: async (candidateTeamName) =>
          this.resolveCurrentOpenCodeRuntimeRunId(candidateTeamName, laneId),
      },
      journal,
      new RuntimeDeliveryDestinationRegistry(this.createOpenCodeRuntimeDeliveryPorts()),
      {
        append: async (event) => {
          logger.warn(`[${event.teamName}] ${event.message}`);
        },
      },
      {
        emit: (event) => {
          this.teamChangeEmitter?.({
            type: event.type as TeamChangeEvent['type'],
            teamName: event.teamName,
            detail: typeof event.data?.detail === 'string' ? event.data.detail : undefined,
          });
        },
      }
    );
  }

  private createOpenCodePromptDeliveryLedger(teamName: string, laneId: string) {
    return createOpenCodePromptDeliveryLedgerStore({
      filePath: getOpenCodeLaneScopedRuntimeFilePath({
        teamsBasePath: getTeamsBasePath(),
        teamName,
        laneId,
        fileName: 'opencode-prompt-delivery-ledger.json',
      }),
    });
  }

  private createOpenCodeRuntimeDeliveryPorts(): RuntimeDeliveryDestinationPort[] {
    const userMessagesPort: RuntimeDeliveryDestinationPort = {
      kind: 'user_sent_messages',
      write: async ({ envelope, destinationMessageId }) => {
        await this.sentMessagesStore.appendMessage(envelope.teamName, {
          from: envelope.fromMemberName,
          to: 'user',
          text: envelope.text,
          timestamp: envelope.createdAt,
          read: true,
          summary: envelope.summary ?? undefined,
          messageId: destinationMessageId,
          source: 'lead_process',
          leadSessionId: envelope.runtimeSessionId,
          taskRefs: runtimeTaskRefs(envelope.teamName, envelope.taskRefs),
        });
        return {
          kind: 'user_sent_messages',
          teamName: envelope.teamName,
          messageId: destinationMessageId,
        };
      },
      verify: async ({ destination, destinationMessageId }) => {
        if (destination.kind !== 'user_sent_messages') {
          return { found: false, location: null, diagnostics: ['destination kind mismatch'] };
        }
        const messages = await this.sentMessagesStore.readMessages(destination.teamName);
        const found = messages.some((message) => message.messageId === destinationMessageId);
        return {
          found,
          location: found
            ? {
                kind: 'user_sent_messages',
                teamName: destination.teamName,
                messageId: destinationMessageId,
              }
            : null,
          diagnostics: [],
        };
      },
      buildChangeEvent: ({ teamName }) => ({
        type: 'lead-message',
        teamName,
        data: { detail: 'opencode-runtime-delivery' },
      }),
    };

    const memberInboxPort: RuntimeDeliveryDestinationPort = {
      kind: 'member_inbox',
      write: async ({ envelope, destinationMessageId }) => {
        if (typeof envelope.to !== 'object' || !('memberName' in envelope.to)) {
          throw new Error('Runtime delivery member destination missing memberName');
        }
        const memberName = envelope.to.memberName;
        await this.inboxWriter.sendMessage(envelope.teamName, {
          member: memberName,
          from: envelope.fromMemberName,
          to: memberName,
          text: envelope.text,
          timestamp: envelope.createdAt,
          messageId: destinationMessageId,
          summary: envelope.summary ?? undefined,
          source: 'inbox',
          leadSessionId: envelope.runtimeSessionId,
          taskRefs: runtimeTaskRefs(envelope.teamName, envelope.taskRefs),
        });
        return {
          kind: 'member_inbox',
          teamName: envelope.teamName,
          memberName,
          messageId: destinationMessageId,
        };
      },
      verify: async ({ destination, destinationMessageId }) => {
        if (destination.kind !== 'member_inbox') {
          return { found: false, location: null, diagnostics: ['destination kind mismatch'] };
        }
        const messages = await this.inboxReader.getMessagesFor(
          destination.teamName,
          destination.memberName
        );
        const found = messages.some((message) => message.messageId === destinationMessageId);
        return {
          found,
          location: found
            ? {
                kind: 'member_inbox',
                teamName: destination.teamName,
                memberName: destination.memberName,
                messageId: destinationMessageId,
              }
            : null,
          diagnostics: [],
        };
      },
      buildChangeEvent: ({ teamName, location }) => ({
        type: 'inbox',
        teamName,
        data: {
          detail:
            location.kind === 'member_inbox' ? `inboxes/${location.memberName}.json` : 'inboxes',
        },
      }),
    };

    const crossTeamPort: RuntimeDeliveryDestinationPort = {
      kind: 'cross_team_outbox',
      write: async ({ envelope, destinationMessageId }) => {
        if (typeof envelope.to !== 'object' || !('teamName' in envelope.to)) {
          throw new Error('Runtime delivery cross-team destination missing teamName');
        }
        if (!this.crossTeamSender) {
          throw new Error('Cross-team sender is not configured');
        }
        const taskRefs = runtimeTaskRefs(envelope.teamName, envelope.taskRefs);
        await this.crossTeamSender({
          fromTeam: envelope.teamName,
          fromMember: envelope.fromMemberName,
          toTeam: envelope.to.teamName,
          text: envelope.text,
          summary: envelope.summary ?? undefined,
          ...(taskRefs ? { taskRefs } : {}),
          messageId: destinationMessageId,
          timestamp: envelope.createdAt,
          conversationId: envelope.idempotencyKey,
        });
        return {
          kind: 'cross_team_outbox',
          fromTeamName: envelope.teamName,
          toTeamName: envelope.to.teamName,
          toMemberName: envelope.to.memberName,
          messageId: destinationMessageId,
        };
      },
      verify: async ({ destination, destinationMessageId }) => {
        if (destination.kind !== 'cross_team_outbox') {
          return { found: false, location: null, diagnostics: ['destination kind mismatch'] };
        }
        const messages = await this.sentMessagesStore.readMessages(destination.fromTeamName);
        const found = messages.some((message) => message.messageId === destinationMessageId);
        return {
          found,
          location: found
            ? {
                kind: 'cross_team_outbox',
                fromTeamName: destination.fromTeamName,
                toTeamName: destination.toTeamName,
                toMemberName: destination.toMemberName,
                messageId: destinationMessageId,
              }
            : null,
          diagnostics: [],
        };
      },
      buildChangeEvent: ({ teamName }) => ({
        type: 'inbox',
        teamName,
        data: { detail: 'cross-team-outbox' },
      }),
    };

    return [userMessagesPort, memberInboxPort, crossTeamPort];
  }

  async recoverOpenCodeRuntimeDeliveryJournal(teamName: string): Promise<{ recovered: true }> {
    const laneIndex = await readOpenCodeRuntimeLaneIndex(getTeamsBasePath(), teamName).catch(
      () => ({
        version: 1 as const,
        updatedAt: nowIso(),
        lanes: {},
      })
    );
    const recoveryLaneIds = await this.getOpenCodeRuntimeRecoveryLaneIds(teamName, laneIndex.lanes);
    for (const laneId of recoveryLaneIds) {
      const journal = createRuntimeDeliveryJournalStore({
        filePath: getOpenCodeLaneScopedRuntimeFilePath({
          teamsBasePath: getTeamsBasePath(),
          teamName,
          laneId,
          fileName: 'opencode-delivery-journal.json',
        }),
      });
      const reconciler = new RuntimeDeliveryReconciler(
        journal,
        new RuntimeDeliveryDestinationRegistry(this.createOpenCodeRuntimeDeliveryPorts()),
        {
          append: async (event) => {
            logger.warn(`[${event.teamName}] ${event.message}`);
          },
        }
      );
      await reconciler.reconcileTeam(teamName);
    }
    return { recovered: true };
  }

  private async getOpenCodeRuntimeRecoveryLaneIds(
    teamName: string,
    laneIndexEntries?: Record<string, { laneId: string }>
  ): Promise<string[]> {
    const laneIds = Object.keys(laneIndexEntries ?? {});
    if (laneIds.length > 0) {
      return laneIds;
    }

    const snapshot = await this.launchStateStore.read(teamName).catch(() => null);
    const snapshotLaneIds = Array.from(
      new Set(
        Object.values(snapshot?.members ?? {})
          .map((member) =>
            member?.laneOwnerProviderId === 'opencode' && typeof member.laneId === 'string'
              ? member.laneId.trim()
              : ''
          )
          .filter((laneId) => laneId.length > 0)
      )
    );
    return snapshotLaneIds.length > 0 ? snapshotLaneIds : ['primary'];
  }

  getLeadActivityState(teamName: string): {
    state: 'active' | 'idle' | 'offline';
    runId: string | null;
  } {
    const runId = this.getTrackedRunId(teamName);
    if (!runId) return { state: 'offline', runId: null };
    const run = this.runs.get(runId);
    if (!run || run.processKilled || run.cancelRequested) return { state: 'offline', runId: null };
    return { state: run.leadActivityState, runId };
  }

  getLeadContextUsage(teamName: string): { usage: LeadContextUsage | null; runId: string | null } {
    const runId = this.getTrackedRunId(teamName);
    if (!runId) return { usage: null, runId: null };
    const run = this.runs.get(runId);
    if (!run?.leadContextUsage || run.processKilled || run.cancelRequested) {
      return { usage: null, runId: null };
    }
    return {
      usage: this.buildLeadContextUsagePayload(run),
      runId,
    };
  }

  private getInitialLeadContextWindowTokens(run: ProvisioningRun): number | null {
    const providerId = normalizeOptionalTeamProviderId(run.request.providerId);
    const modelName =
      typeof run.request.model === 'string' && run.request.model.trim().length > 0
        ? run.request.model.trim()
        : providerId === 'anthropic'
          ? getAnthropicDefaultTeamModel(run.request.limitContext === true)
          : undefined;

    return inferContextWindowTokens({
      providerId,
      modelName,
      limitContext: run.request.limitContext === true,
    });
  }

  private buildLeadContextUsagePayload(run: ProvisioningRun): LeadContextUsage {
    const usage = run.leadContextUsage;
    if (!usage) {
      return {
        promptInputTokens: null,
        outputTokens: null,
        contextUsedTokens: null,
        contextWindowTokens: null,
        contextUsedPercent: null,
        promptInputSource: 'unavailable',
        updatedAt: new Date().toISOString(),
      };
    }

    const { contextUsedTokens, contextWindowTokens } = usage;
    const percentRaw =
      contextUsedTokens !== null && contextWindowTokens !== null && contextWindowTokens > 0
        ? Math.round((contextUsedTokens / contextWindowTokens) * 100)
        : null;

    return {
      promptInputTokens: usage.promptInputTokens,
      outputTokens: usage.outputTokens,
      contextUsedTokens: usage.contextUsedTokens,
      contextWindowTokens: usage.contextWindowTokens,
      contextUsedPercent: percentRaw === null ? null : Math.max(0, Math.min(100, percentRaw)),
      promptInputSource: usage.promptInputSource,
      updatedAt: new Date().toISOString(),
    };
  }

  private updateLeadContextUsageFromUsage(
    run: ProvisioningRun,
    usage: Record<string, unknown>,
    modelName: string | undefined
  ): void {
    const existingContextWindowTokens =
      run.leadContextUsage?.contextWindowTokens ?? this.getInitialLeadContextWindowTokens(run);
    const metrics = deriveContextMetrics({
      usage,
      providerId: normalizeOptionalTeamProviderId(run.request.providerId),
      modelName,
      contextWindowTokens: existingContextWindowTokens,
      limitContext: run.request.limitContext === true,
    });

    if (!run.leadContextUsage) {
      run.leadContextUsage = {
        promptInputTokens: metrics.promptInputTokens,
        outputTokens: metrics.outputTokens,
        contextUsedTokens: metrics.contextUsedTokens,
        contextWindowTokens: metrics.contextWindowTokens,
        promptInputSource: metrics.promptInputSource,
        lastUsageMessageId: null,
        lastEmittedAt: 0,
      };
      return;
    }

    run.leadContextUsage.promptInputTokens = metrics.promptInputTokens;
    run.leadContextUsage.outputTokens = metrics.outputTokens;
    run.leadContextUsage.contextUsedTokens = metrics.contextUsedTokens;
    run.leadContextUsage.contextWindowTokens =
      metrics.contextWindowTokens ?? run.leadContextUsage.contextWindowTokens;
    run.leadContextUsage.promptInputSource = metrics.promptInputSource;
  }

  private isCurrentTrackedRun(run: ProvisioningRun): boolean {
    return this.getTrackedRunId(run.teamName) === run.runId;
  }

  private getRunTrackedCwd(run: ProvisioningRun | null | undefined): string | null {
    const requestCwd = typeof run?.request?.cwd === 'string' ? run.request.cwd.trim() : '';
    if (requestCwd) return path.resolve(requestCwd);

    const spawnCwd = typeof run?.spawnContext?.cwd === 'string' ? run.spawnContext.cwd.trim() : '';
    if (spawnCwd) return path.resolve(spawnCwd);

    return null;
  }

  private getPreCompleteCliErrorText(run: ProvisioningRun): string {
    const parts: string[] = [];
    const stderrText = run.stderrBuffer.trim();
    if (stderrText) {
      parts.push(stderrText);
    }

    // Re-check only the parser-owned stdout carry that never became a newline-delimited message.
    // If it is complete JSON or clearly looks like Claude stream-json structure, ignore it here.
    // Otherwise treat it as trailing plaintext CLI output that should still participate in the
    // final auth/API failure guard.
    const trailingStdout = run.stdoutParserCarry.trim();
    if (
      trailingStdout &&
      !run.stdoutParserCarryIsCompleteJson &&
      !run.stdoutParserCarryLooksLikeClaudeJson
    ) {
      parts.push(trailingStdout);
    }

    return parts.join('\n').trim();
  }

  private setLeadActivity(run: ProvisioningRun, state: 'active' | 'idle' | 'offline'): void {
    if (run.leadActivityState === state) return;
    run.leadActivityState = state;
    if (!this.isCurrentTrackedRun(run)) return;
    this.teamChangeEmitter?.({
      type: 'lead-activity',
      teamName: run.teamName,
      runId: run.runId,
      detail: state,
    });
  }

  private emitToolActivity(run: ProvisioningRun, payload: ToolActivityEventPayload): void {
    if (!this.isCurrentTrackedRun(run)) return;
    this.teamChangeEmitter?.({
      type: 'tool-activity',
      teamName: run.teamName,
      runId: run.runId,
      detail: JSON.stringify(payload),
    });
  }

  private startRuntimeToolActivity(
    run: ProvisioningRun,
    memberName: string,
    block: Record<string, unknown>
  ): void {
    const rawId = typeof block.id === 'string' ? block.id.trim() : '';
    if (!rawId) return;

    const toolUseId = rawId;
    if (run.activeToolCalls.has(toolUseId)) return;

    const toolName = typeof block.name === 'string' ? block.name : 'unknown';
    const input = (block.input ?? {}) as Record<string, unknown>;
    const activity: ActiveToolCall = {
      memberName,
      toolUseId,
      toolName,
      preview: extractToolPreview(toolName, input),
      startedAt: nowIso(),
      state: 'running',
      source: 'runtime',
    };

    run.activeToolCalls.set(toolUseId, activity);
    this.emitToolActivity(run, {
      action: 'start',
      activity: {
        memberName: activity.memberName,
        toolUseId: activity.toolUseId,
        toolName: activity.toolName,
        preview: activity.preview,
        startedAt: activity.startedAt,
        source: activity.source,
      },
    });
  }

  private finishRuntimeToolActivity(
    run: ProvisioningRun,
    toolUseId: string,
    resultContent: unknown,
    isError: boolean
  ): void {
    const active = run.activeToolCalls.get(toolUseId);
    if (!active) return;

    run.activeToolCalls.delete(toolUseId);
    this.emitToolActivity(run, {
      action: 'finish',
      memberName: active.memberName,
      toolUseId,
      finishedAt: nowIso(),
      resultPreview: extractToolResultPreview(resultContent),
      isError,
    });

    const spawnedMemberName = run.memberSpawnToolUseIds.get(toolUseId);
    if (spawnedMemberName) {
      run.memberSpawnToolUseIds.delete(toolUseId);
      const pendingRestart = run.pendingMemberRestarts.get(spawnedMemberName);
      if (isError) {
        const resultPreview = extractToolResultPreview(resultContent);
        this.handleMemberSpawnFailure(run, spawnedMemberName, resultPreview);
      } else if (active.toolName === 'Agent') {
        const parsedStatus = parseAgentToolResultStatus(resultContent);
        if (parsedStatus?.status === 'duplicate_skipped') {
          const detail =
            parsedStatus.reason === 'already_running'
              ? 'duplicate spawn skipped - already running'
              : parsedStatus.reason === 'bootstrap_pending'
                ? 'duplicate spawn skipped - teammate bootstrap still pending'
                : parsedStatus.rawReason
                  ? `duplicate spawn skipped - unrecognized reason: ${parsedStatus.rawReason}`
                  : 'duplicate spawn skipped - reason unavailable';
          this.appendMemberBootstrapDiagnostic(run, spawnedMemberName, detail);
          if (pendingRestart && !parsedStatus.reason) {
            logger.warn(
              `[${run.teamName}] Restart for teammate "${spawnedMemberName}" returned duplicate_skipped without a recognized reason`
            );
            run.pendingMemberRestarts.delete(spawnedMemberName);
            this.setMemberSpawnStatus(
              run,
              spawnedMemberName,
              'error',
              buildRestartDuplicateUnconfirmedReason(spawnedMemberName, parsedStatus.rawReason)
            );
            return;
          }
          if (parsedStatus.reason === 'already_running') {
            if (pendingRestart) {
              run.pendingMemberRestarts.delete(spawnedMemberName);
              this.setMemberSpawnStatus(
                run,
                spawnedMemberName,
                'error',
                buildRestartStillRunningReason(spawnedMemberName)
              );
              return;
            }
            this.agentRuntimeSnapshotCache.delete(run.teamName);
            this.liveTeamAgentRuntimeMetadataCache.delete(run.teamName);
            this.setMemberSpawnStatus(run, spawnedMemberName, 'waiting');
            this.appendMemberBootstrapDiagnostic(
              run,
              spawnedMemberName,
              'already_running requires strong runtime verification'
            );
            void this.reevaluateMemberLaunchStatus(run, spawnedMemberName);
          } else {
            this.setMemberSpawnStatus(run, spawnedMemberName, 'waiting');
          }
          return;
        }

        // Agent tool_result only confirms that the runtime accepted the spawn.
        // The teammate becomes truly "online" only after the first inbox heartbeat.
        this.setMemberSpawnStatus(run, spawnedMemberName, 'waiting');
      } else {
        this.setMemberSpawnStatus(run, spawnedMemberName, 'waiting');
      }
    }
  }

  private handleMemberSpawnFailure(
    run: ProvisioningRun,
    memberName: string,
    resultPreview?: string
  ): void {
    const pendingRestart = run.pendingMemberRestarts.get(memberName);
    const reason =
      (typeof resultPreview === 'string' && resultPreview.trim().length > 0
        ? resultPreview.trim()
        : '成员启动后立即失败。') || '成员启动失败。';
    const message = pendingRestart
      ? `成员 "${memberName}" 重启失败：${reason}`
      : `成员 "${memberName}" 启动失败：${reason}`;

    run.pendingMemberRestarts.delete(memberName);

    this.setMemberSpawnStatus(run, memberName, 'error', message);

    const lastIndex = run.provisioningOutputParts.length - 1;
    if (lastIndex < 0 || run.provisioningOutputParts[lastIndex]?.trim() !== message) {
      run.provisioningOutputParts.push(message);
    }

    if (
      !run.provisioningComplete &&
      (run.progress.state === 'assembling' || run.progress.state === 'configuring')
    ) {
      const progress = updateProgress(run, 'assembling', `Failed to start member ${memberName}`);
      run.onProgress(progress);
    }
  }

  private appendMemberBootstrapDiagnostic(
    run: ProvisioningRun,
    memberName: string,
    text: string
  ): void {
    const line = normalizeMemberDiagnosticText(memberName, text);
    const lastIndex = run.provisioningOutputParts.length - 1;
    if (lastIndex >= 0 && run.provisioningOutputParts[lastIndex]?.trim() === line) {
      return;
    }
    run.provisioningOutputParts.push(line);
    logger.info(`[${run.teamName}] [bootstrap] ${line}`);
  }

  private resetRuntimeToolActivity(run: ProvisioningRun, memberName?: string): void {
    if (run.activeToolCalls.size === 0) return;

    if (!memberName) {
      run.activeToolCalls.clear();
      this.emitToolActivity(run, { action: 'reset' });
      return;
    }

    let removed = false;
    for (const [toolUseId, active] of run.activeToolCalls.entries()) {
      if (active.memberName !== memberName) continue;
      run.activeToolCalls.delete(toolUseId);
      removed = true;
    }

    if (removed) {
      this.emitToolActivity(run, { action: 'reset', memberName });
    }
  }

  private clearMemberSpawnToolTracking(run: ProvisioningRun, memberName: string): void {
    let removed = false;
    for (const [toolUseId, trackedMemberName] of run.memberSpawnToolUseIds.entries()) {
      if (trackedMemberName !== memberName) continue;
      run.memberSpawnToolUseIds.delete(toolUseId);
      removed = true;
    }

    if (removed) {
      this.appendMemberBootstrapDiagnostic(
        run,
        memberName,
        'cleared stale spawn tool tracking before manual restart'
      );
    }
  }

  /**
   * Update spawn status for a specific team member and emit a change event.
   */
  private setMemberSpawnStatus(
    run: ProvisioningRun,
    memberName: string,
    status: MemberSpawnStatus,
    error?: string,
    livenessSource?: MemberSpawnLivenessSource,
    heartbeatAt?: string
  ): void {
    const prev = run.memberSpawnStatuses.get(memberName) ?? createInitialMemberSpawnStatusEntry();
    if (
      status === 'waiting' &&
      !prev.hardFailure &&
      (prev.bootstrapConfirmed || prev.runtimeAlive)
    ) {
      this.setMemberSpawnStatus(
        run,
        memberName,
        'online',
        undefined,
        prev.livenessSource,
        prev.lastHeartbeatAt
      );
      return;
    }
    const updatedAt = nowIso();
    const next: MemberSpawnStatusEntry = {
      ...prev,
      status,
      updatedAt,
    };

    if (status === 'spawning') {
      next.skippedForLaunch = false;
      next.skipReason = undefined;
      next.skippedAt = undefined;
      next.agentToolAccepted = false;
      next.runtimeAlive = false;
      next.bootstrapConfirmed = false;
      next.hardFailure = false;
      next.error = undefined;
      next.hardFailureReason = undefined;
      next.livenessSource = undefined;
      next.livenessKind = undefined;
      next.runtimeDiagnostic = undefined;
      next.runtimeDiagnosticSeverity = undefined;
      next.livenessLastCheckedAt = undefined;
      next.firstSpawnAcceptedAt = undefined;
      next.lastHeartbeatAt = undefined;
      next.launchState = 'starting';
    } else if (status === 'waiting') {
      next.skippedForLaunch = false;
      next.skipReason = undefined;
      next.skippedAt = undefined;
      next.agentToolAccepted = true;
      next.runtimeAlive = false;
      next.bootstrapConfirmed = false;
      next.hardFailure = false;
      next.error = undefined;
      next.hardFailureReason = undefined;
      next.livenessSource = undefined;
      next.livenessKind = undefined;
      next.runtimeDiagnostic = undefined;
      next.runtimeDiagnosticSeverity = undefined;
      next.livenessLastCheckedAt = undefined;
      next.firstSpawnAcceptedAt = prev.firstSpawnAcceptedAt ?? updatedAt;
      next.lastHeartbeatAt = undefined;
      next.launchState = 'runtime_pending_bootstrap';
    } else if (status === 'online') {
      next.skippedForLaunch = false;
      next.skipReason = undefined;
      next.skippedAt = undefined;
      next.agentToolAccepted = true;
      next.runtimeAlive = true;
      next.livenessSource = livenessSource;
      next.firstSpawnAcceptedAt = prev.firstSpawnAcceptedAt ?? updatedAt;
      if (livenessSource === 'heartbeat') {
        const incomingHeartbeatAt = heartbeatAt?.trim() || updatedAt;
        next.bootstrapConfirmed = true;
        next.lastHeartbeatAt = isMemberSpawnHeartbeatTimestampNewer(
          prev.lastHeartbeatAt,
          incomingHeartbeatAt
        )
          ? incomingHeartbeatAt
          : prev.lastHeartbeatAt;
      }
      next.hardFailure = false;
      next.error = undefined;
      next.hardFailureReason = undefined;
      next.launchState = deriveMemberLaunchState(next);
    } else if (status === 'error') {
      next.skippedForLaunch = false;
      next.skipReason = undefined;
      next.skippedAt = undefined;
      next.error = error;
      next.hardFailure = true;
      next.hardFailureReason = error;
      next.launchState = 'failed_to_start';
    } else if (status === 'skipped') {
      next.skippedForLaunch = true;
      next.skipReason =
        error?.trim() || prev.hardFailureReason || prev.error || 'Skipped for this launch';
      next.skippedAt = updatedAt;
      next.agentToolAccepted = false;
      next.runtimeAlive = false;
      next.bootstrapConfirmed = false;
      next.hardFailure = false;
      next.error = undefined;
      next.hardFailureReason = undefined;
      next.livenessSource = undefined;
      next.livenessKind = undefined;
      next.runtimeDiagnostic = undefined;
      next.runtimeDiagnosticSeverity = undefined;
      next.livenessLastCheckedAt = undefined;
      next.firstSpawnAcceptedAt = undefined;
      next.lastHeartbeatAt = undefined;
      next.launchState = 'skipped_for_launch';
    } else if (status === 'offline') {
      Object.assign(next, createInitialMemberSpawnStatusEntry(), { updatedAt });
      next.error = undefined;
      next.hardFailureReason = undefined;
      next.skippedForLaunch = false;
      next.skipReason = undefined;
      next.skippedAt = undefined;
      next.livenessSource = undefined;
      next.livenessKind = undefined;
      next.runtimeDiagnostic = undefined;
      next.runtimeDiagnosticSeverity = undefined;
      next.livenessLastCheckedAt = undefined;
      next.firstSpawnAcceptedAt = undefined;
      next.lastHeartbeatAt = undefined;
    }

    next.launchState = deriveMemberLaunchState(next);
    if (
      prev.status === next.status &&
      prev.launchState === next.launchState &&
      prev.error === next.error &&
      prev.hardFailureReason === next.hardFailureReason &&
      (prev.skippedForLaunch === true) === (next.skippedForLaunch === true) &&
      prev.skipReason === next.skipReason &&
      prev.skippedAt === next.skippedAt &&
      prev.livenessSource === next.livenessSource &&
      prev.agentToolAccepted === next.agentToolAccepted &&
      prev.runtimeAlive === next.runtimeAlive &&
      prev.bootstrapConfirmed === next.bootstrapConfirmed &&
      prev.hardFailure === next.hardFailure &&
      prev.livenessKind === next.livenessKind &&
      prev.runtimeDiagnostic === next.runtimeDiagnostic &&
      prev.runtimeDiagnosticSeverity === next.runtimeDiagnosticSeverity &&
      prev.firstSpawnAcceptedAt === next.firstSpawnAcceptedAt &&
      prev.lastHeartbeatAt === next.lastHeartbeatAt
    ) {
      return;
    }

    run.memberSpawnStatuses.set(memberName, next);
    if (
      (status === 'online' && (next.bootstrapConfirmed || livenessSource === 'process')) ||
      status === 'offline' ||
      status === 'error' ||
      status === 'skipped'
    ) {
      run.pendingMemberRestarts?.delete(memberName);
    }
    this.syncMemberLaunchGraceCheck(run, memberName, next);
    const launchDiagnostics = boundLaunchDiagnostics(buildLaunchDiagnosticsFromRun(run));
    if (launchDiagnostics) {
      run.progress = {
        ...run.progress,
        updatedAt: nowIso(),
        launchDiagnostics,
      };
      run.onProgress(run.progress);
    }

    if (status === 'spawning') {
      this.appendMemberBootstrapDiagnostic(run, memberName, 'Agent tool invoked');
    } else if (status === 'waiting') {
      this.appendMemberBootstrapDiagnostic(
        run,
        memberName,
        'spawn accepted, waiting for teammate check-in'
      );
    } else if (status === 'online' && livenessSource === 'heartbeat' && !prev.bootstrapConfirmed) {
      this.appendMemberBootstrapDiagnostic(run, memberName, 'bootstrap 已确认 via first heartbeat');
    } else if (status === 'online' && livenessSource === 'process') {
      this.appendMemberBootstrapDiagnostic(
        run,
        memberName,
        'runtime process is alive, teammate check-in not yet received'
      );
    } else if (status === 'error') {
      this.appendMemberBootstrapDiagnostic(
        run,
        memberName,
        error?.trim().length ? error.trim() : 'bootstrap failed'
      );
    } else if (status === 'skipped') {
      this.appendMemberBootstrapDiagnostic(
        run,
        memberName,
        error?.trim().length
          ? `skipped for this launch: ${error.trim()}`
          : 'skipped for this launch'
      );
    }
    if (!this.isCurrentTrackedRun(run)) return;
    this.emitMemberSpawnChange(run, memberName);
    if (run.isLaunch) {
      void this.persistLaunchStateSnapshot(run, run.provisioningComplete ? 'finished' : 'active');
    }
  }

  private confirmMemberSpawnStatusFromTranscript(
    run: ProvisioningRun,
    memberName: string,
    observedAt: string
  ): void {
    const prev = run.memberSpawnStatuses.get(memberName) ?? createInitialMemberSpawnStatusEntry();
    const updatedAt = nowIso();
    const next: MemberSpawnStatusEntry = {
      ...prev,
      status: 'online',
      updatedAt,
      agentToolAccepted: true,
      runtimeAlive: prev.runtimeAlive === true,
      bootstrapConfirmed: true,
      hardFailure: false,
      error: undefined,
      hardFailureReason: undefined,
      livenessSource: prev.livenessSource ?? 'process',
      firstSpawnAcceptedAt: prev.firstSpawnAcceptedAt ?? observedAt,
      lastHeartbeatAt: isMemberSpawnHeartbeatTimestampNewer(prev.lastHeartbeatAt, observedAt)
        ? observedAt
        : prev.lastHeartbeatAt,
    };
    next.launchState = deriveMemberLaunchState(next);

    if (
      prev.status === next.status &&
      prev.launchState === next.launchState &&
      prev.error === next.error &&
      prev.hardFailureReason === next.hardFailureReason &&
      prev.livenessSource === next.livenessSource &&
      prev.agentToolAccepted === next.agentToolAccepted &&
      prev.runtimeAlive === next.runtimeAlive &&
      prev.bootstrapConfirmed === next.bootstrapConfirmed &&
      prev.hardFailure === next.hardFailure &&
      prev.firstSpawnAcceptedAt === next.firstSpawnAcceptedAt &&
      prev.lastHeartbeatAt === next.lastHeartbeatAt
    ) {
      return;
    }

    run.memberSpawnStatuses.set(memberName, next);
    run.pendingMemberRestarts?.delete(memberName);
    this.syncMemberLaunchGraceCheck(run, memberName, next);
    this.appendMemberBootstrapDiagnostic(run, memberName, 'bootstrap 已确认 via transcript');
    if (!this.isCurrentTrackedRun(run)) return;
    this.emitMemberSpawnChange(run, memberName);
    if (run.isLaunch) {
      void this.persistLaunchStateSnapshot(run, run.provisioningComplete ? 'finished' : 'active');
    }
  }

  /**
   * Get current member spawn statuses for a team.
   * Returns a map of memberName → MemberSpawnStatusEntry.
   */
  async getMemberSpawnStatuses(teamName: string): Promise<{
    statuses: Record<string, MemberSpawnStatusEntry>;
    runId: string | null;
    teamLaunchState?: TeamLaunchAggregateState;
    launchPhase?: PersistedTeamLaunchPhase;
    expectedMembers?: string[];
    updatedAt?: string;
    summary?: PersistedTeamLaunchSummary;
    source?: 'live' | 'persisted' | 'merged';
  }> {
    const readPersistedStatuses = async (resolvedRunId: string | null) => {
      const { snapshot, statuses } = await this.reconcilePersistedLaunchState(teamName);
      const nextStatuses = await this.attachLiveRuntimeMetadataToStatuses(teamName, statuses);
      const expectedMembers = snapshot ? this.getPersistedLaunchMemberNames(snapshot) : undefined;
      const summary = expectedMembers
        ? summarizeMemberSpawnStatusRecord(expectedMembers, nextStatuses)
        : undefined;
      return {
        statuses: nextStatuses,
        runId: resolvedRunId,
        teamLaunchState: summary
          ? deriveTeamLaunchAggregateState(summary)
          : snapshot?.teamLaunchState,
        launchPhase: snapshot?.launchPhase,
        expectedMembers,
        updatedAt: snapshot?.updatedAt,
        summary: summary ?? snapshot?.summary,
        source: 'persisted' as const,
      };
    };

    const runId = this.getTrackedRunId(teamName);
    if (!runId) {
      return readPersistedStatuses(null);
    }
    const run = this.runs.get(runId);
    if (!run) {
      return readPersistedStatuses(runId);
    }

    await this.refreshMemberSpawnStatusesFromLeadInbox(run);
    await this.maybeAuditMemberSpawnStatuses(run);
    await this.persistLaunchStateSnapshot(run, run.provisioningComplete ? 'finished' : 'active');

    const persisted = await this.launchStateStore.read(teamName);
    if (persisted) {
      this.syncRunMemberSpawnStatusesFromSnapshot(run, persisted);
    }
    const liveSnapshot =
      this.buildLiveLaunchSnapshotForRun(run, run.provisioningComplete ? 'finished' : 'active') ??
      snapshotFromRuntimeMemberStatuses({
        teamName: run.teamName,
        expectedMembers: run.expectedMembers,
        leadSessionId: run.detectedSessionId ?? undefined,
        launchPhase: run.provisioningComplete ? 'finished' : 'active',
        statuses: this.buildRuntimeSpawnStatusRecord(run),
      });
    const rawSnapshot = liveSnapshot ?? persisted;
    const metaMembers = await this.membersMetaStore.getMembers(teamName).catch(() => []);
    const snapshot = this.filterRemovedMembersFromLaunchSnapshot(rawSnapshot, metaMembers);
    const statuses = await this.attachLiveRuntimeMetadataToStatuses(
      teamName,
      snapshotToMemberSpawnStatuses(snapshot)
    );
    const expectedMembers = this.getPersistedLaunchMemberNames(snapshot);
    const summary = summarizeMemberSpawnStatusRecord(expectedMembers, statuses);
    return {
      statuses,
      runId,
      teamLaunchState: deriveTeamLaunchAggregateState(summary),
      launchPhase: snapshot.launchPhase,
      expectedMembers,
      updatedAt: snapshot.updatedAt,
      summary,
      source: persisted ? 'merged' : 'live',
    };
  }

  async getTeamAgentRuntimeSnapshot(teamName: string): Promise<TeamAgentRuntimeSnapshot> {
    const runId = this.getTrackedRunId(teamName);
    const cached = this.agentRuntimeSnapshotCache.get(teamName);
    if (cached && cached.expiresAtMs > Date.now() && cached.snapshot.runId === runId) {
      return cached.snapshot;
    }

    const updatedAt = nowIso();
    const run = runId ? (this.runs.get(runId) ?? null) : null;
    const currentRuntimeAdapterRun = this.runtimeAdapterRunByTeam.get(teamName);
    const persistedTeamMeta = await this.teamMetaStore.getMeta(teamName).catch(() => null);

    let configuredMembers: TeamConfig['members'] = [];
    try {
      configuredMembers = (await this.configReader.getConfig(teamName))?.members ?? [];
    } catch {
      configuredMembers = [];
    }
    const metaMembers = await this.membersMetaStore.getMembers(teamName).catch(() => []);
    const launchSnapshot = choosePreferredLaunchSnapshot(
      await readBootstrapLaunchSnapshot(teamName),
      await this.launchStateStore.read(teamName)
    );

    const liveRuntimeByMember = await this.getLiveTeamAgentRuntimeMetadata(teamName);
    const runtimePids = new Set<number>();
    const leadPid = run?.child?.pid;
    if (typeof leadPid === 'number' && Number.isFinite(leadPid) && leadPid > 0) {
      runtimePids.add(leadPid);
    }
    for (const metadata of liveRuntimeByMember.values()) {
      const memberPid = metadata.pid ?? metadata.metricsPid;
      if (typeof memberPid === 'number' && Number.isFinite(memberPid) && memberPid > 0) {
        runtimePids.add(memberPid);
      }
    }
    const rssBytesByPid = await this.readProcessRssBytesByPid([...runtimePids]);
    const persistedRuntimeMembers = this.readPersistedRuntimeMembers(teamName);
    const snapshotMembers: Record<string, TeamAgentRuntimeEntry> = {};

    const getPersistedRuntimeMember = (
      memberName: string
    ): PersistedRuntimeMemberLike | undefined => {
      return persistedRuntimeMembers.find((member) => {
        const candidateName = typeof member.name === 'string' ? member.name.trim() : '';
        return candidateName.length > 0 && matchesMemberNameOrBase(candidateName, memberName);
      });
    };

    const getLiveRuntimeMember = (memberName: string): LiveTeamAgentRuntimeMetadata | undefined => {
      let fallback: LiveTeamAgentRuntimeMetadata | undefined;
      for (const [candidateName, metadata] of liveRuntimeByMember.entries()) {
        if (candidateName === memberName) {
          return metadata;
        }
        if (matchesMemberNameOrBase(candidateName, memberName)) {
          fallback = metadata;
        }
      }
      return fallback;
    };

    const candidateMembers = new Map<string, TeamMember>();
    for (const member of configuredMembers) {
      const memberName = typeof member?.name === 'string' ? member.name.trim() : '';
      if (!memberName || this.isMemberRemovedInMeta(metaMembers, memberName)) continue;
      candidateMembers.set(memberName, member);
    }
    for (const member of metaMembers) {
      const memberName = typeof member?.name === 'string' ? member.name.trim() : '';
      if (!memberName || member.removedAt || candidateMembers.has(memberName)) continue;
      candidateMembers.set(memberName, member);
    }
    for (const memberName of launchSnapshot
      ? this.getPersistedLaunchMemberNames(launchSnapshot)
      : []) {
      if (candidateMembers.has(memberName) || this.isMemberRemovedInMeta(metaMembers, memberName)) {
        continue;
      }
      const launchMember = launchSnapshot?.members[memberName];
      candidateMembers.set(memberName, {
        name: memberName,
        agentType: 'general-purpose',
        providerId: launchMember?.providerId,
        providerBackendId: launchMember?.providerBackendId,
        model: launchMember?.model,
        effort: launchMember?.effort,
        fastMode: launchMember?.selectedFastMode,
      });
    }

    for (const member of candidateMembers.values()) {
      const memberName = typeof member?.name === 'string' ? member.name.trim() : '';
      if (!memberName) continue;

      const isLead = isLeadMember({ name: memberName, agentType: member.agentType });
      if (isLead) {
        const pid = run?.child?.pid;
        const rssBytes = pid ? rssBytesByPid.get(pid) : undefined;
        const runtimeModel =
          run?.request.model?.trim() ||
          (run?.spawnContext
            ? extractCliFlagValue(run.spawnContext.args.join(' '), '--model')
            : undefined) ||
          member.model?.trim() ||
          undefined;
        snapshotMembers[memberName] = {
          memberName,
          alive: Boolean(pid && !run?.processKilled && !run?.cancelRequested),
          restartable: false,
          backendType: 'lead',
          ...(pid ? { pid } : {}),
          ...(runtimeModel ? { runtimeModel } : {}),
          ...(rssBytes != null ? { rssBytes } : {}),
          updatedAt,
        };
        continue;
      }

      const persistedRuntimeMember = getPersistedRuntimeMember(memberName);
      const liveRuntimeMember = getLiveRuntimeMember(memberName);
      const launchMember = launchSnapshot?.members[memberName];
      const backendType =
        liveRuntimeMember?.backendType ??
        normalizeTeamAgentRuntimeBackendType(persistedRuntimeMember?.backendType, false);
      const runtimeModel =
        liveRuntimeMember?.model ??
        launchMember?.model?.trim() ??
        member.model?.trim() ??
        undefined;
      const memberProviderId =
        launchMember?.providerId ??
        normalizeOptionalTeamProviderId(member.providerId) ??
        inferTeamProviderIdFromModel(runtimeModel) ??
        inferTeamProviderIdFromModel(launchMember?.model) ??
        inferTeamProviderIdFromModel(member.model);
      const isOpenCodeMember = memberProviderId === 'opencode';
      const configuredCwd = typeof member.cwd === 'string' ? member.cwd.trim() : '';
      const runtimeCwd =
        liveRuntimeMember?.cwd ??
        (configuredCwd || (isOpenCodeMember ? currentRuntimeAdapterRun?.cwd : undefined));
      const metricsPid = liveRuntimeMember?.metricsPid;
      const isSharedOpenCodeHost =
        isOpenCodeMember &&
        typeof metricsPid === 'number' &&
        metricsPid > 0 &&
        liveRuntimeMember?.pidSource !== 'agent_process_table';
      const rssPid = isSharedOpenCodeHost ? metricsPid : (liveRuntimeMember?.pid ?? metricsPid);
      const displayPid = isSharedOpenCodeHost ? rssPid : liveRuntimeMember?.pid;
      const restartable = isOpenCodeMember
        ? !isSharedOpenCodeHost && Boolean(liveRuntimeMember?.pid)
        : isSharedOpenCodeHost
          ? false
          : backendType !== 'in-process';
      const historicalBootstrapConfirmed =
        launchMember?.bootstrapConfirmed === true ||
        launchMember?.launchState === 'confirmed_alive';
      let rssBytes = rssPid ? rssBytesByPid.get(rssPid) : undefined;
      if (rssBytes == null && isSharedOpenCodeHost && typeof rssPid === 'number' && rssPid > 0) {
        try {
          const refreshedStat = await pidusage(rssPid, { maxage: 0 });
          if (Number.isFinite(refreshedStat.memory) && refreshedStat.memory >= 0) {
            rssBytesByPid.set(rssPid, refreshedStat.memory);
            rssBytes = refreshedStat.memory;
          }
        } catch {
          // Shared OpenCode host can exit between discovery and the targeted RSS refresh.
        }
      }

      snapshotMembers[memberName] = {
        memberName,
        alive: liveRuntimeMember?.alive === true,
        restartable,
        ...(backendType ? { backendType } : {}),
        ...(memberProviderId ? { providerId: memberProviderId } : {}),
        ...(launchMember?.providerBackendId
          ? { providerBackendId: launchMember.providerBackendId }
          : {}),
        ...(launchMember?.laneId ? { laneId: launchMember.laneId } : {}),
        ...(launchMember?.laneKind ? { laneKind: launchMember.laneKind } : {}),
        ...(displayPid ? { pid: displayPid } : {}),
        ...(runtimeModel ? { runtimeModel } : {}),
        ...(runtimeCwd ? { cwd: runtimeCwd } : {}),
        ...(typeof rssBytes === 'number' && rssBytes >= 0 ? { rssBytes } : {}),
        ...(liveRuntimeMember?.livenessKind
          ? { livenessKind: liveRuntimeMember.livenessKind }
          : {}),
        ...(liveRuntimeMember?.pidSource ? { pidSource: liveRuntimeMember.pidSource } : {}),
        ...(liveRuntimeMember?.processCommand
          ? { processCommand: liveRuntimeMember.processCommand }
          : {}),
        ...(liveRuntimeMember?.tmuxPaneId ? { paneId: liveRuntimeMember.tmuxPaneId } : {}),
        ...(liveRuntimeMember?.panePid ? { panePid: liveRuntimeMember.panePid } : {}),
        ...(liveRuntimeMember?.paneCurrentCommand
          ? { paneCurrentCommand: liveRuntimeMember.paneCurrentCommand }
          : {}),
        ...(liveRuntimeMember?.metricsPid ? { runtimePid: liveRuntimeMember.metricsPid } : {}),
        ...(liveRuntimeMember?.runtimeSessionId
          ? { runtimeSessionId: liveRuntimeMember.runtimeSessionId }
          : {}),
        ...(liveRuntimeMember?.runtimeLastSeenAt
          ? { runtimeLastSeenAt: liveRuntimeMember.runtimeLastSeenAt }
          : {}),
        ...(historicalBootstrapConfirmed ? { historicalBootstrapConfirmed: true } : {}),
        ...(liveRuntimeMember?.runtimeDiagnostic
          ? { runtimeDiagnostic: liveRuntimeMember.runtimeDiagnostic }
          : {}),
        ...(liveRuntimeMember?.runtimeDiagnosticSeverity
          ? { runtimeDiagnosticSeverity: liveRuntimeMember.runtimeDiagnosticSeverity }
          : {}),
        ...(liveRuntimeMember?.diagnostics ? { diagnostics: liveRuntimeMember.diagnostics } : {}),
        updatedAt,
      };
    }

    const snapshot: TeamAgentRuntimeSnapshot = {
      teamName,
      updatedAt,
      runId: run?.runId ?? runId,
      providerBackendId: migrateProviderBackendId(
        run?.request.providerId ?? persistedTeamMeta?.providerId,
        run?.request.providerBackendId ?? persistedTeamMeta?.providerBackendId
      ),
      fastMode: run?.request.fastMode ?? persistedTeamMeta?.fastMode,
      members: snapshotMembers,
    };

    this.agentRuntimeSnapshotCache.set(teamName, {
      expiresAtMs: Date.now() + TeamProvisioningService.AGENT_RUNTIME_SNAPSHOT_CACHE_TTL_MS,
      snapshot,
    });
    return snapshot;
  }

  async restartMember(teamName: string, memberName: string): Promise<void> {
    const runId = this.getAliveRunId(teamName);
    if (!runId) {
      throw new Error(`Team "${teamName}" is not currently running`);
    }
    const run = this.runs.get(runId);
    if (!run || run.processKilled || run.cancelRequested) {
      throw new Error(`Team "${teamName}" is not currently running`);
    }

    const readCurrentConfiguredMember = async (): Promise<{
      config: TeamConfig | null;
      configuredMembers: TeamConfig['members'];
      metaMembers: Awaited<ReturnType<TeamMembersMetaStore['getMembers']>>;
      configuredMember: ReturnType<TeamProvisioningService['resolveEffectiveConfiguredMember']>;
    }> => {
      const config = await this.configReader.getConfig(teamName);
      const configuredMembers = config?.members ?? [];
      let metaMembers: Awaited<ReturnType<TeamMembersMetaStore['getMembers']>> = [];
      try {
        metaMembers = await this.membersMetaStore.getMembers(teamName);
      } catch {
        metaMembers = [];
      }

      return {
        config,
        configuredMembers,
        metaMembers,
        configuredMember: this.resolveEffectiveConfiguredMember(
          configuredMembers,
          metaMembers,
          memberName
        ),
      };
    };

    let { config, configuredMembers, metaMembers, configuredMember } =
      await readCurrentConfiguredMember();
    if (!config) {
      throw new Error(`Team "${teamName}" configuration is no longer available`);
    }
    if (!configuredMember) {
      throw new Error(`Member "${memberName}" is not configured in team "${teamName}"`);
    }
    if (configuredMember.removedAt) {
      throw new Error(`Member "${memberName}" has been removed`);
    }
    if (isLeadMember({ name: memberName, agentType: configuredMember.agentType })) {
      throw new Error('Lead restart is not supported from member controls');
    }
    const desiredProviderId = normalizeOptionalTeamProviderId(configuredMember.providerId);
    const mixedSecondaryLanes = run.mixedSecondaryLanes ?? [];
    const liveSecondaryLaneMemberName =
      mixedSecondaryLanes
        .find((lane) => lane.member.name.trim() === memberName)
        ?.member.name?.trim() ?? null;
    const leadProviderId = resolveTeamProviderId(run.request.providerId);
    const desiredSecondaryLane = desiredProviderId === 'opencode' && leadProviderId !== 'opencode';
    if (liveSecondaryLaneMemberName === memberName || desiredSecondaryLane) {
      await this.reattachOpenCodeOwnedMemberLane(teamName, memberName, {
        reason: 'manual_restart',
      });
      return;
    }
    if (run.pendingMemberRestarts.has(memberName)) {
      throw new Error(`Restart for teammate "${memberName}" is already in progress`);
    }

    const persistedRuntimeMembers = this.readPersistedRuntimeMembers(teamName).filter((member) => {
      const candidateName = typeof member.name === 'string' ? member.name.trim() : '';
      return candidateName.length > 0 && matchesMemberNameOrBase(candidateName, memberName);
    });

    const backendTypes = new Set(
      persistedRuntimeMembers
        .map((member) => member.backendType?.trim().toLowerCase())
        .filter((value): value is string => Boolean(value))
    );
    if (backendTypes.has('in-process')) {
      throw new Error(
        `Member "${memberName}" uses an in-process runtime and cannot be restarted here`
      );
    }

    this.agentRuntimeSnapshotCache.delete(teamName);
    this.liveTeamAgentRuntimeMetadataCache.delete(teamName);
    const liveRuntimeByMember = await this.getLiveTeamAgentRuntimeMetadata(teamName);
    const livePids = new Set<number>();
    let hasAliveRuntimeWithoutPid = false;
    for (const [candidateName, metadata] of liveRuntimeByMember.entries()) {
      if (!matchesMemberNameOrBase(candidateName, memberName)) {
        continue;
      }
      if (metadata.pid) {
        livePids.add(metadata.pid);
        continue;
      }
      if (metadata.alive && metadata.backendType !== 'in-process') {
        hasAliveRuntimeWithoutPid = true;
      }
    }

    if (hasAliveRuntimeWithoutPid) {
      throw new Error(
        `Member "${memberName}" is running, but its backend does not expose a restartable pid yet`
      );
    }

    const tmuxPaneIdsToVerify: string[] = [];
    for (const persistedRuntimeMember of persistedRuntimeMembers) {
      const paneId =
        typeof persistedRuntimeMember.tmuxPaneId === 'string'
          ? persistedRuntimeMember.tmuxPaneId.trim()
          : '';
      const backendType = persistedRuntimeMember.backendType?.trim().toLowerCase();
      if (!paneId || backendType !== 'tmux') {
        continue;
      }
      tmuxPaneIdsToVerify.push(paneId);
      try {
        killTmuxPaneForCurrentPlatformSync(paneId);
        logger.info(
          `[${teamName}] Killed teammate pane ${memberName} (${paneId}) for manual restart`
        );
      } catch (error) {
        logger.debug(
          `[${teamName}] Failed to kill teammate pane ${memberName} (${paneId}) for manual restart: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }
    }

    for (const pid of livePids) {
      try {
        killProcessByPid(pid);
      } catch (error) {
        logger.debug(
          `[${teamName}] Failed to kill teammate process ${memberName} pid=${pid} for manual restart: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }
    }

    if (livePids.size > 0) {
      const lingeringPids = await waitForPidsToExit(Array.from(livePids), {
        timeoutMs: 1_500,
        pollMs: 100,
      });
      if (lingeringPids.length > 0) {
        throw new Error(
          `Restart for teammate "${memberName}" is still waiting for the previous process to exit (${lingeringPids.join(', ')}).`
        );
      }
    }

    if (tmuxPaneIdsToVerify.length > 0) {
      let lingeringPaneIds: string[];
      try {
        lingeringPaneIds = await waitForTmuxPanesToExit(tmuxPaneIdsToVerify, {
          timeoutMs: 1_500,
          pollMs: 100,
        });
      } catch (error) {
        throw new Error(
          `Restart for teammate "${memberName}" could not verify that the previous tmux pane exited: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }
      if (lingeringPaneIds.length > 0) {
        throw new Error(
          `Restart for teammate "${memberName}" is still waiting for the previous tmux pane to exit (${lingeringPaneIds.join(', ')}).`
        );
      }
    }

    this.setMemberSpawnStatus(run, memberName, 'offline');

    const latestRunId = this.getAliveRunId(teamName);
    const currentRun = this.runs.get(runId);
    if (
      latestRunId !== runId ||
      !currentRun ||
      currentRun !== run ||
      currentRun.processKilled ||
      currentRun.cancelRequested
    ) {
      throw new Error(`Team "${teamName}" is not currently running`);
    }

    ({ config, configuredMembers, metaMembers, configuredMember } =
      await readCurrentConfiguredMember());
    if (!config) {
      throw new Error(`Team "${teamName}" configuration disappeared while restart was in progress`);
    }
    if (!configuredMember) {
      throw new Error(
        `Member "${memberName}" is no longer configured in team "${teamName}" after restart preparation`
      );
    }
    if (configuredMember.removedAt) {
      throw new Error(`Member "${memberName}" was removed while restart was in progress`);
    }
    if (isLeadMember({ name: memberName, agentType: configuredMember.agentType })) {
      throw new Error('Lead restart is not supported from member controls');
    }

    this.agentRuntimeSnapshotCache.delete(teamName);
    this.liveTeamAgentRuntimeMetadataCache.delete(teamName);
    this.resetRuntimeToolActivity(run, memberName);
    this.clearMemberSpawnToolTracking(run, memberName);
    this.setMemberSpawnStatus(run, memberName, 'spawning');
    this.appendMemberBootstrapDiagnostic(run, memberName, 'manual restart requested from UI');
    run.pendingMemberRestarts.set(memberName, {
      requestedAt: nowIso(),
      desired: {
        name: configuredMember.name,
        role: configuredMember.role,
        workflow: configuredMember.workflow,
        isolation: configuredMember.isolation === 'worktree' ? ('worktree' as const) : undefined,
        providerId: configuredMember.providerId,
        model: configuredMember.model,
        effort: configuredMember.effort,
      },
    });

    const leadName = this.resolveLeadMemberName(configuredMembers, metaMembers);
    const restartMessage = buildRestartMemberSpawnMessage(
      teamName,
      config?.name?.trim() || teamName,
      leadName,
      {
        name: configuredMember.name,
        role: configuredMember.role,
        workflow: configuredMember.workflow,
        isolation: configuredMember.isolation === 'worktree' ? ('worktree' as const) : undefined,
        providerId: configuredMember.providerId,
        model: configuredMember.model,
        effort: configuredMember.effort,
      }
    );

    try {
      await this.sendMessageToRun(run, restartMessage);
    } catch (error) {
      run.pendingMemberRestarts.delete(memberName);
      this.setMemberSpawnStatus(
        run,
        memberName,
        'error',
        error instanceof Error ? error.message : String(error)
      );
      throw error;
    }
  }

  async skipMemberForLaunch(teamName: string, memberName: string): Promise<void> {
    const normalizedMemberName = memberName.trim();
    if (!normalizedMemberName) {
      throw new Error('Member name is required');
    }

    const config = await this.configReader.getConfig(teamName);
    if (!config) {
      throw new Error(`Team "${teamName}" configuration is no longer available`);
    }

    let metaMembers: Awaited<ReturnType<TeamMembersMetaStore['getMembers']>> = [];
    try {
      metaMembers = await this.membersMetaStore.getMembers(teamName);
    } catch {
      metaMembers = [];
    }

    const configuredMember = this.resolveEffectiveConfiguredMember(
      config.members ?? [],
      metaMembers,
      normalizedMemberName
    );
    if (!configuredMember) {
      throw new Error(`Member "${normalizedMemberName}" is not configured in team "${teamName}"`);
    }
    if (configuredMember.removedAt) {
      throw new Error(`Member "${normalizedMemberName}" has been removed`);
    }
    if (isLeadMember({ name: normalizedMemberName, agentType: configuredMember.agentType })) {
      throw new Error('Lead cannot be skipped for a launch');
    }

    const runId = this.getTrackedRunId(teamName);
    const run = runId ? this.runs.get(runId) : undefined;
    const persistedSnapshot = await this.launchStateStore.read(teamName).catch(() => null);
    const runEntry = run?.memberSpawnStatuses.get(normalizedMemberName);
    const persistedMember = persistedSnapshot?.members[normalizedMemberName];
    const alreadySkipped =
      runEntry?.launchState === 'skipped_for_launch' ||
      runEntry?.skippedForLaunch === true ||
      persistedMember?.launchState === 'skipped_for_launch' ||
      persistedMember?.skippedForLaunch === true;

    if (alreadySkipped) {
      return;
    }

    const failedThisLaunch =
      runEntry?.launchState === 'failed_to_start' ||
      runEntry?.status === 'error' ||
      persistedMember?.launchState === 'failed_to_start' ||
      persistedMember?.hardFailure === true;
    if (!failedThisLaunch) {
      throw new Error(`Member "${normalizedMemberName}" has not failed this launch`);
    }

    if (run?.pendingMemberRestarts.has(normalizedMemberName)) {
      throw new Error(`Restart for teammate "${normalizedMemberName}" is already in progress`);
    }

    const previousFailureReason =
      runEntry?.hardFailureReason ??
      runEntry?.error ??
      persistedMember?.hardFailureReason ??
      persistedMember?.runtimeDiagnostic;
    const reason = previousFailureReason?.trim()
      ? `Skipped by user after launch failure: ${previousFailureReason.trim()}`
      : 'Skipped by user for this launch';

    if (run && !run.processKilled && !run.cancelRequested) {
      this.agentRuntimeSnapshotCache.delete(teamName);
      this.liveTeamAgentRuntimeMetadataCache.delete(teamName);
      this.resetRuntimeToolActivity(run, normalizedMemberName);
      this.clearMemberSpawnToolTracking(run, normalizedMemberName);
      this.setMemberSpawnStatus(run, normalizedMemberName, 'skipped', reason);
      if (run.isLaunch) {
        await this.persistLaunchStateSnapshot(
          run,
          run.provisioningComplete ? 'finished' : 'active'
        );
      }

      try {
        await this.sendMessageToRun(
          run,
          `Teammate "${normalizedMemberName}" was skipped for this launch after a startup failure. Continue without waiting for this teammate unless the user retries it.`
        );
      } catch (error) {
        logger.debug(
          `[${teamName}] Failed to notify lead about skipped teammate "${normalizedMemberName}": ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }
      return;
    }

    if (!persistedSnapshot || !persistedMember) {
      throw new Error(`No launch state is available for member "${normalizedMemberName}"`);
    }

    const updatedAt = nowIso();
    const nextMembers = {
      ...persistedSnapshot.members,
      [normalizedMemberName]: {
        ...persistedMember,
        launchState: 'skipped_for_launch' as const,
        skippedForLaunch: true,
        skipReason: reason,
        skippedAt: updatedAt,
        agentToolAccepted: false,
        runtimeAlive: false,
        bootstrapConfirmed: false,
        hardFailure: false,
        hardFailureReason: undefined,
        pendingPermissionRequestIds: undefined,
        livenessKind: undefined,
        runtimeDiagnostic: undefined,
        runtimeDiagnosticSeverity: undefined,
        lastEvaluatedAt: updatedAt,
        diagnostics: [`skipped for this launch: ${reason}`],
      },
    };
    const nextSnapshot = createPersistedLaunchSnapshot({
      teamName: persistedSnapshot.teamName,
      expectedMembers: persistedSnapshot.expectedMembers,
      bootstrapExpectedMembers: persistedSnapshot.bootstrapExpectedMembers,
      leadSessionId: persistedSnapshot.leadSessionId,
      launchPhase: persistedSnapshot.launchPhase,
      members: nextMembers,
      updatedAt,
    });
    await this.launchStateStore.write(teamName, nextSnapshot);
    this.agentRuntimeSnapshotCache.delete(teamName);
    this.liveTeamAgentRuntimeMetadataCache.delete(teamName);
  }

  private getMutableAliveRunOrThrow(teamName: string): ProvisioningRun {
    const runId = this.getAliveRunId(teamName);
    if (!runId) {
      throw new Error(`Team "${teamName}" is not currently running`);
    }
    const run = this.runs.get(runId);
    if (!run || run.processKilled || run.cancelRequested) {
      throw new Error(`Team "${teamName}" is not currently running`);
    }
    return run;
  }

  async markLiveMemberSpawnQueued(
    teamName: string,
    member: TeamCreateRequest['members'][number]
  ): Promise<void> {
    const run = this.getMutableAliveRunOrThrow(teamName);
    const memberName = member.name.trim();
    if (!memberName) return;

    this.upsertRunAllEffectiveMember(run, member);
    this.upsertRunEffectiveMember(run, member);
    if (!run.expectedMembers.some((name) => matchesExactTeamMemberName(name, memberName))) {
      run.expectedMembers.push(memberName);
    }
    this.agentRuntimeSnapshotCache.delete(teamName);
    this.liveTeamAgentRuntimeMetadataCache.delete(teamName);
    this.resetRuntimeToolActivity(run, memberName);
    this.clearMemberSpawnToolTracking(run, memberName);
    this.setMemberSpawnStatus(run, memberName, 'spawning');
    this.appendMemberBootstrapDiagnostic(run, memberName, 'live member add requested from UI');
    if (run.isLaunch) {
      await this.persistLaunchStateSnapshot(run, run.provisioningComplete ? 'finished' : 'active');
    }
  }

  async markLiveMemberSpawnQueueFailed(
    teamName: string,
    memberName: string,
    reason: string
  ): Promise<void> {
    const runId = this.getAliveRunId(teamName);
    if (!runId) return;
    const run = this.runs.get(runId);
    if (!run || run.processKilled || run.cancelRequested) return;
    this.setMemberSpawnStatus(run, memberName, 'error', reason);
    if (run.isLaunch) {
      await this.persistLaunchStateSnapshot(run, run.provisioningComplete ? 'finished' : 'active');
    }
  }

  async reattachOpenCodeOwnedMemberLane(
    teamName: string,
    memberName: string,
    options?: { reason?: 'member_added' | 'member_updated' | 'manual_restart' }
  ): Promise<void> {
    const run = this.getMutableAliveRunOrThrow(teamName);
    const leadProviderId = resolveTeamProviderId(run.request.providerId);
    if (leadProviderId === 'opencode') {
      throw new Error(
        'OpenCode-led mixed teams are not supported in this phase. Stop the team and relaunch with a non-OpenCode lead.'
      );
    }
    if (!this.getOpenCodeRuntimeAdapter()) {
      throw new Error('OpenCode runtime adapter is not available for controlled lane reattach.');
    }

    const config = await this.configReader.getConfig(teamName);
    if (!config) {
      throw new Error(`Team "${teamName}" configuration is no longer available`);
    }
    let metaMembers: Awaited<ReturnType<TeamMembersMetaStore['getMembers']>> = [];
    try {
      metaMembers = await this.membersMetaStore.getMembers(teamName);
    } catch {
      metaMembers = [];
    }
    const configuredMember = this.resolveEffectiveConfiguredMember(
      config.members ?? [],
      metaMembers,
      memberName
    );
    if (!configuredMember) {
      throw new Error(`Member "${memberName}" is not configured in team "${teamName}"`);
    }
    if (configuredMember.removedAt) {
      throw new Error(`Member "${memberName}" has been removed`);
    }
    if (isLeadMember({ name: configuredMember.name, agentType: configuredMember.agentType })) {
      throw new Error('Lead lane reattach is not supported');
    }
    const desiredProviderId = normalizeOptionalTeamProviderId(configuredMember.providerId);
    if (desiredProviderId !== 'opencode') {
      throw new Error(
        `Controlled reattach is only supported for OpenCode-owned members. "${memberName}" remains on the primary runtime owner.`
      );
    }

    const [memberSpec] = await this.resolveOpenCodeMemberWorkspacesForRuntime({
      teamName,
      baseCwd: run.request.cwd,
      leadProviderId,
      members: [this.buildConfiguredProvisioningMember(configuredMember)],
    });
    if (!memberSpec) {
      throw new Error(`Member "${memberName}" could not be resolved for OpenCode lane reattach.`);
    }
    const nextLane = this.createMixedSecondaryLaneStateForMember(run, memberSpec);
    const existingLaneIndex = run.mixedSecondaryLanes.findIndex(
      (lane) => lane.laneId === nextLane.laneId || lane.member.name.trim() === memberName
    );
    const existingLane = existingLaneIndex >= 0 ? run.mixedSecondaryLanes[existingLaneIndex] : null;

    if (existingLane) {
      await this.stopSingleMixedSecondaryRuntimeLane(run, existingLane, 'relaunch');
    }

    const laneState = existingLane ?? nextLane;
    laneState.laneId = nextLane.laneId;
    laneState.member = memberSpec;
    laneState.runId = null;
    laneState.state = 'queued';
    laneState.result = null;
    laneState.warnings = [];
    laneState.diagnostics = options?.reason ? [`controlled_reattach:${options.reason}`] : [];

    if (existingLaneIndex >= 0) {
      run.mixedSecondaryLanes[existingLaneIndex] = laneState;
    } else {
      run.mixedSecondaryLanes.push(laneState);
    }

    this.upsertRunAllEffectiveMember(run, memberSpec);
    this.agentRuntimeSnapshotCache.delete(teamName);
    this.liveTeamAgentRuntimeMetadataCache.delete(teamName);
    this.resetRuntimeToolActivity(run, memberName);
    this.clearMemberSpawnToolTracking(run, memberName);
    run.pendingMemberRestarts.delete(memberName);

    await this.launchSingleMixedSecondaryLane(run, laneState);
  }

  async detachOpenCodeOwnedMemberLane(teamName: string, memberName: string): Promise<void> {
    const run = this.getMutableAliveRunOrThrow(teamName);
    const laneIndex = run.mixedSecondaryLanes.findIndex((lane) =>
      matchesTeamMemberIdentity(lane.member.name, memberName)
    );
    if (laneIndex < 0) {
      this.removeRunAllEffectiveMember(run, memberName);
      this.agentRuntimeSnapshotCache.delete(teamName);
      this.liveTeamAgentRuntimeMetadataCache.delete(teamName);
      await this.persistLaunchStateSnapshot(run, this.getMixedSecondaryLaunchPhase(run));
      return;
    }

    const [lane] = run.mixedSecondaryLanes.splice(laneIndex, 1);
    await this.stopSingleMixedSecondaryRuntimeLane(run, lane, 'cleanup');
    this.removeRunAllEffectiveMember(run, memberName);
    this.agentRuntimeSnapshotCache.delete(teamName);
    this.liveTeamAgentRuntimeMetadataCache.delete(teamName);
    this.resetRuntimeToolActivity(run, memberName);
    this.clearMemberSpawnToolTracking(run, memberName);
    run.pendingMemberRestarts.delete(memberName);
    await this.persistLaunchStateSnapshot(run, this.getMixedSecondaryLaunchPhase(run));
  }

  private getMemberLaunchGraceKey(run: ProvisioningRun, memberName: string): string {
    return `member-launch-grace:${run.runId}:${memberName}`;
  }

  private syncMemberLaunchGraceCheck(
    run: ProvisioningRun,
    memberName: string,
    entry: MemberSpawnStatusEntry
  ): void {
    const key = this.getMemberLaunchGraceKey(run, memberName);
    const existing = this.pendingTimeouts.get(key);
    if (entry.launchState === 'failed_to_start' || entry.launchState === 'confirmed_alive') {
      if (existing) {
        clearTimeout(existing);
        this.pendingTimeouts.delete(key);
      }
      return;
    }
    if (!entry.firstSpawnAcceptedAt) {
      if (existing) {
        clearTimeout(existing);
        this.pendingTimeouts.delete(key);
      }
      return;
    }
    const remainingMs =
      Date.parse(entry.firstSpawnAcceptedAt) + MEMBER_LAUNCH_GRACE_MS - Date.now();
    if (remainingMs <= 0) {
      if (existing) {
        clearTimeout(existing);
        this.pendingTimeouts.delete(key);
      }
      void this.reevaluateMemberLaunchStatus(run, memberName);
      return;
    }
    if (existing) {
      return;
    }
    const timer = setTimeout(() => {
      this.pendingTimeouts.delete(key);
      void this.reevaluateMemberLaunchStatus(run, memberName);
    }, remainingMs);
    timer.unref?.();
    this.pendingTimeouts.set(key, timer);
  }

  private async reevaluateMemberLaunchStatus(
    run: ProvisioningRun,
    memberName: string
  ): Promise<void> {
    const current = run.memberSpawnStatuses.get(memberName);
    if (!current) return;
    if (
      current.launchState === 'failed_to_start' ||
      current.launchState === 'confirmed_alive' ||
      !current.firstSpawnAcceptedAt
    ) {
      return;
    }
    await this.refreshMemberSpawnStatusesFromLeadInbox(run);
    await this.maybeAuditMemberSpawnStatuses(run, { force: true });
    const refreshed = run.memberSpawnStatuses.get(memberName);
    if (!refreshed) return;
    if (
      refreshed.launchState === 'failed_to_start' ||
      refreshed.launchState === 'confirmed_alive'
    ) {
      return;
    }
    const refreshedFirstSpawnAcceptedAt = refreshed.firstSpawnAcceptedAt;
    if (!refreshedFirstSpawnAcceptedAt) {
      return;
    }
    const restartPending = run.pendingMemberRestarts.has(memberName);
    const runtimeByMember = await this.getLiveTeamAgentRuntimeMetadata(run.teamName);
    const metadata =
      runtimeByMember.get(memberName) ??
      [...runtimeByMember.entries()].find(([candidateName]) =>
        matchesObservedMemberNameForExpected(candidateName, memberName)
      )?.[1];
    const acceptedAtMs = Date.parse(refreshedFirstSpawnAcceptedAt);
    const elapsedMs = Number.isFinite(acceptedAtMs) ? Date.now() - acceptedAtMs : Infinity;
    const runtimeDiagnostic = metadata?.runtimeDiagnostic;
    if (metadata?.livenessKind === 'runtime_process') {
      if (elapsedMs >= MEMBER_BOOTSTRAP_STALL_MS) {
        run.memberSpawnStatuses.set(memberName, {
          ...refreshed,
          livenessKind: metadata.livenessKind,
          runtimeDiagnostic: 'Runtime process is alive, but no bootstrap check-in after 5 min.',
          runtimeDiagnosticSeverity: 'warning',
          livenessLastCheckedAt: nowIso(),
        });
      }
      this.setMemberSpawnStatus(run, memberName, 'online', undefined, 'process');
      return;
    }
    if (metadata?.livenessKind === 'permission_blocked') {
      const next = {
        ...refreshed,
        livenessKind: metadata.livenessKind,
        runtimeDiagnostic: runtimeDiagnostic ?? '等待权限批准',
        runtimeDiagnosticSeverity: metadata.runtimeDiagnosticSeverity ?? 'warning',
        livenessLastCheckedAt: nowIso(),
        launchState: 'runtime_pending_permission' as const,
      };
      run.memberSpawnStatuses.set(memberName, next);
      this.emitMemberSpawnChange(run, memberName);
      return;
    }
    if (
      metadata?.livenessKind === 'runtime_process_candidate' &&
      elapsedMs < MEMBER_BOOTSTRAP_STALL_MS
    ) {
      const next = {
        ...refreshed,
        livenessKind: metadata.livenessKind,
        runtimeDiagnostic: runtimeDiagnostic ?? 'runtime process candidate detected',
        runtimeDiagnosticSeverity: metadata.runtimeDiagnosticSeverity ?? 'warning',
        livenessLastCheckedAt: nowIso(),
      };
      run.memberSpawnStatuses.set(memberName, next);
      this.emitMemberSpawnChange(run, memberName);
      const stallDelayMs = Math.max(
        1_000,
        Date.parse(refreshedFirstSpawnAcceptedAt) + MEMBER_BOOTSTRAP_STALL_MS - Date.now()
      );
      const stallKey = `${this.getMemberLaunchGraceKey(run, memberName)}:bootstrap-stall`;
      if (!this.pendingTimeouts.has(stallKey)) {
        const timer = setTimeout(() => {
          this.pendingTimeouts.delete(stallKey);
          void this.reevaluateMemberLaunchStatus(run, memberName);
        }, stallDelayMs);
        timer.unref?.();
        this.pendingTimeouts.set(stallKey, timer);
      }
      return;
    }
    const strictReason = restartPending
      ? buildRestartGraceTimeoutReason(memberName)
      : (runtimeDiagnostic ??
        (metadata?.livenessKind === 'shell_only'
          ? 'Tmux pane is alive, but no teammate runtime process was found.'
          : 'Teammate did not join within the launch grace window.'));
    if (restartPending) {
      run.pendingMemberRestarts.delete(memberName);
    }
    run.memberSpawnStatuses.set(memberName, {
      ...refreshed,
      runtimeAlive: false,
      livenessSource: undefined,
      bootstrapConfirmed: false,
      ...(metadata?.livenessKind ? { livenessKind: metadata.livenessKind } : {}),
      ...(runtimeDiagnostic ? { runtimeDiagnostic } : {}),
      ...(metadata?.runtimeDiagnosticSeverity
        ? { runtimeDiagnosticSeverity: metadata.runtimeDiagnosticSeverity }
        : {}),
      livenessLastCheckedAt: nowIso(),
    });
    this.setMemberSpawnStatus(run, memberName, 'error', strictReason);
  }

  private shouldSkipMemberSpawnAudit(run: ProvisioningRun): boolean {
    if (!run.expectedMembers || run.expectedMembers.length === 0) {
      return true;
    }
    return run.expectedMembers.every((memberName) => {
      const entry = run.memberSpawnStatuses.get(memberName);
      return (
        entry?.launchState === 'failed_to_start' ||
        entry?.launchState === 'confirmed_alive' ||
        entry?.launchState === 'skipped_for_launch'
      );
    });
  }

  private async maybeAuditMemberSpawnStatuses(
    run: ProvisioningRun,
    options?: { force?: boolean }
  ): Promise<void> {
    if (!run.expectedMembers || run.expectedMembers.length === 0) {
      return;
    }
    await this.reconcileBootstrapTranscriptFailures(run);
    if (this.shouldSkipMemberSpawnAudit(run)) {
      return;
    }
    const now = Date.now();
    if (
      !options?.force &&
      run.lastMemberSpawnAuditAt > 0 &&
      now - run.lastMemberSpawnAuditAt < MEMBER_SPAWN_AUDIT_MIN_INTERVAL_MS
    ) {
      return;
    }
    run.lastMemberSpawnAuditAt = now;
    await this.auditMemberSpawnStatuses(run);
    await this.reconcileBootstrapTranscriptSuccesses(run);
  }

  private async reconcileBootstrapTranscriptFailures(run: ProvisioningRun): Promise<void> {
    for (const memberName of run.expectedMembers ?? []) {
      const current = run.memberSpawnStatuses.get(memberName);
      if (
        !current ||
        current.launchState === 'failed_to_start' ||
        current.launchState === 'confirmed_alive' ||
        current.hardFailure === true ||
        current.agentToolAccepted !== true
      ) {
        continue;
      }
      const acceptedAtMs =
        current.firstSpawnAcceptedAt != null ? Date.parse(current.firstSpawnAcceptedAt) : NaN;
      const transcriptFailureReason = await this.findBootstrapTranscriptFailureReason(
        run.teamName,
        memberName,
        Number.isFinite(acceptedAtMs) ? acceptedAtMs : null
      );
      if (!transcriptFailureReason) {
        continue;
      }
      this.setMemberSpawnStatus(run, memberName, 'error', transcriptFailureReason);
    }
  }

  private async reconcileBootstrapTranscriptSuccesses(run: ProvisioningRun): Promise<void> {
    for (const memberName of run.expectedMembers ?? []) {
      const current = run.memberSpawnStatuses.get(memberName);
      if (
        !current ||
        current.launchState === 'failed_to_start' ||
        current.launchState === 'confirmed_alive' ||
        current.bootstrapConfirmed === true ||
        current.agentToolAccepted !== true
      ) {
        continue;
      }
      const acceptedAtMs =
        current.firstSpawnAcceptedAt != null ? Date.parse(current.firstSpawnAcceptedAt) : NaN;
      const transcriptOutcome = await this.findBootstrapTranscriptOutcome(
        run.teamName,
        memberName,
        Number.isFinite(acceptedAtMs) ? acceptedAtMs : null
      );
      if (transcriptOutcome?.kind !== 'success') {
        continue;
      }
      this.confirmMemberSpawnStatusFromTranscript(run, memberName, transcriptOutcome.observedAt);
    }
  }

  private static readonly CONTEXT_EMIT_THROTTLE_MS = 2000;
  private static readonly LEAD_TEXT_EMIT_THROTTLE_MS = 2000;

  private emitLeadContextUsage(run: ProvisioningRun): void {
    if (!run.leadContextUsage || !run.provisioningComplete) return;
    if (!this.isCurrentTrackedRun(run)) return;
    const now = Date.now();
    if (
      now - run.leadContextUsage.lastEmittedAt <
      TeamProvisioningService.CONTEXT_EMIT_THROTTLE_MS
    ) {
      return;
    }
    run.leadContextUsage.lastEmittedAt = now;
    const payload = this.buildLeadContextUsagePayload(run);
    this.teamChangeEmitter?.({
      type: 'lead-context',
      teamName: run.teamName,
      runId: run.runId,
      detail: JSON.stringify(payload),
    });
  }

  async warmup(): Promise<void> {
    try {
      const cwd = process.cwd();
      if (this.getFreshCachedProbeResult(cwd, 'anthropic')) return;
      const result = await this.getCachedOrProbeResult(cwd, 'anthropic');
      if (!result) return;
      logger.info('CLI warmup completed');
    } catch (error) {
      logger.warn(`CLI warmup failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async prepareForProvisioning(
    cwd?: string,
    opts?: {
      forceFresh?: boolean;
      providerId?: TeamProviderId;
      providerIds?: TeamProviderId[];
      modelIds?: string[];
      limitContext?: boolean;
      modelVerificationMode?: TeamProvisioningModelVerificationMode;
    }
  ): Promise<TeamProvisioningPrepareResult> {
    const targetCwdForValidation = cwd?.trim() || process.cwd();
    await this.validatePrepareCwd(targetCwdForValidation);
    const providerIds = Array.from(
      new Set(
        [opts?.providerId, ...(opts?.providerIds ?? [])]
          .map((providerId) => resolveTeamProviderId(providerId))
          .filter((providerId): providerId is TeamProviderId => Boolean(providerId))
      )
    );
    if (providerIds.length === 0) {
      providerIds.push('anthropic');
    }

    // Allow callers (e.g. scheduler warm-up) to bypass the 36h probe cache
    if (opts?.forceFresh) {
      for (const providerId of providerIds) {
        this.clearProbeCache(targetCwdForValidation, providerId);
      }
    }

    const targetCwd = cwd?.trim() || process.cwd();
    if (!path.isAbsolute(targetCwd)) {
      throw new Error('cwd must be an absolute path');
    }

    const warnings: string[] = [];
    const details: string[] = [];
    const blockingMessages: string[] = [];
    const selectedModelIds = Array.from(
      new Set((opts?.modelIds ?? []).map((modelId) => modelId.trim()).filter(Boolean))
    );

    for (const providerId of providerIds) {
      if (providerId === 'opencode') {
        const adapter = this.getOpenCodeRuntimeAdapter();
        if (!adapter) {
          blockingMessages.push(
            'OpenCode team launch is not enabled yet. Production launch requires the gated OpenCode runtime adapter.'
          );
          continue;
        }

        if (selectedModelIds.length === 0) {
          const prepare = await adapter.prepare({
            runId: `prepare-${randomUUID()}`,
            teamName: '__prepare_opencode__',
            cwd: targetCwd,
            providerId: 'opencode',
            model: undefined,
            runtimeOnly: true,
            skipPermissions: true,
            expectedMembers: [],
            previousLaunchState: null,
          });
          details.push(...prepare.diagnostics);
          warnings.push(...prepare.warnings);
          if (!prepare.ok) {
            blockingMessages.push(`OpenCode: ${prepare.reason}`);
          }
          continue;
        }

        const openCodeModelPrepare = await this.prepareSelectedOpenCodeModels({
          adapter,
          cwd: targetCwd,
          modelIds: selectedModelIds,
          verificationMode: opts?.modelVerificationMode ?? 'deep',
        });
        details.push(...openCodeModelPrepare.details);
        warnings.push(...openCodeModelPrepare.warnings);
        blockingMessages.push(...openCodeModelPrepare.blockingMessages);
        continue;
      }

      const cached = this.getFreshCachedProbeResult(targetCwdForValidation, providerId);
      const probeResult = cached ?? (await this.getCachedOrProbeResult(targetCwd, providerId));
      if (!probeResult?.claudePath) {
        throw new Error(CLI_NOT_FOUND_MESSAGE);
      }

      const providerLabel = getTeamProviderLabel(providerId);
      const { authSource } = probeResult;
      if (authSource === 'anthropic_api_key') {
        logger.info(`Auth: using explicit ANTHROPIC_API_KEY for ${providerLabel}`);
      } else if (authSource === 'anthropic_auth_token') {
        logger.info(
          `Auth: using ANTHROPIC_AUTH_TOKEN mapped to ANTHROPIC_API_KEY for ${providerLabel}`
        );
      }

      const appendSelectedModelVerification = async (): Promise<void> => {
        if (selectedModelIds.length === 0) {
          return;
        }

        const modelVerification = await this.verifySelectedProviderModels({
          claudePath: probeResult.claudePath,
          cwd: targetCwd,
          providerId,
          modelIds: selectedModelIds,
          limitContext: opts?.limitContext === true,
        });
        details.push(...modelVerification.details);
        warnings.push(...modelVerification.warnings);
        blockingMessages.push(...modelVerification.blockingMessages);
      };

      const appendOneShotDiagnostic = async (): Promise<void> => {
        if (opts?.modelVerificationMode !== 'deep') {
          return;
        }
        const envResolution = await this.buildProvisioningEnv(providerId);
        if (envResolution.warning) {
          warnings.push(
            providerIds.length > 1
              ? `${providerLabel}: ${envResolution.warning}`
              : envResolution.warning
          );
          return;
        }
        const diagnostic = await this.runProviderOneShotDiagnostic(
          probeResult.claudePath,
          targetCwd,
          envResolution.env,
          providerId,
          envResolution.providerArgs
        );
        if (diagnostic.warning) {
          warnings.push(
            providerIds.length > 1 ? `${providerLabel}: ${diagnostic.warning}` : diagnostic.warning
          );
        }
      };

      if (!probeResult.warning) {
        const blockingCountBeforeModelChecks = blockingMessages.length;
        await appendSelectedModelVerification();
        if (blockingMessages.length === blockingCountBeforeModelChecks) {
          await appendOneShotDiagnostic();
        }
        continue;
      }

      {
        const prefixedWarning =
          providerIds.length > 1 ? `${providerLabel}: ${probeResult.warning}` : probeResult.warning;
        const isAuthFailure = this.isAuthFailureWarning(probeResult.warning, 'probe');
        const isBlockingPreflightWarning =
          authSource === 'configured_api_key_missing' ||
          ((authSource === 'none' ||
            authSource === 'codex_runtime' ||
            authSource === 'gemini_runtime') &&
            isAuthFailure) ||
          isBinaryProbeWarning(probeResult.warning);
        if (authSource === 'configured_api_key_missing') {
          blockingMessages.push(prefixedWarning);
        } else if (
          (authSource === 'none' ||
            authSource === 'codex_runtime' ||
            authSource === 'gemini_runtime') &&
          isAuthFailure
        ) {
          blockingMessages.push(prefixedWarning);
        } else if (isBinaryProbeWarning(probeResult.warning)) {
          blockingMessages.push(prefixedWarning);
        } else {
          // Preflight warnings (including timeouts) should not block provisioning.
          warnings.push(prefixedWarning);
          const blockingCountBeforeModelChecks = blockingMessages.length;
          if (!isBlockingPreflightWarning && selectedModelIds.length > 0) {
            await appendSelectedModelVerification();
          }
          if (
            !isBlockingPreflightWarning &&
            blockingMessages.length === blockingCountBeforeModelChecks
          ) {
            await appendOneShotDiagnostic();
          }
        }
      }
    }

    if (blockingMessages.length > 0) {
      const failureWarnings = Array.from(new Set([...warnings, ...blockingMessages]));
      return {
        ready: false,
        details: details.length > 0 ? details : undefined,
        message:
          blockingMessages.length === 1
            ? blockingMessages[0]
            : 'Some provider runtimes are not ready',
        warnings: failureWarnings.length > 0 ? failureWarnings : undefined,
      };
    }

    return {
      ready: true,
      details: details.length > 0 ? details : undefined,
      message:
        providerIds.length > 1
          ? warnings.length > 0
            ? `Validated ${providerIds.length}/${providerIds.length} provider runtimes (see notes)`
            : `Validated ${providerIds.length}/${providerIds.length} provider runtimes`
          : warnings.length > 0
            ? 'CLI is ready to launch (see notes)'
            : 'CLI is warmed up and ready to launch',
      warnings: warnings.length > 0 ? warnings : undefined,
    };
  }

  private async prepareSelectedOpenCodeModels({
    adapter,
    cwd,
    modelIds,
    verificationMode,
  }: {
    adapter: TeamLaunchRuntimeAdapter;
    cwd: string;
    modelIds: string[];
    verificationMode: TeamProvisioningModelVerificationMode;
  }): Promise<{
    details: string[];
    warnings: string[];
    blockingMessages: string[];
  }> {
    const details: string[] = [];
    const warnings: string[] = [];
    const blockingMessages: string[] = [];
    const startedAt = Date.now();

    if (modelIds.length === 0) {
      return { details, warnings, blockingMessages };
    }

    if (verificationMode === 'compatibility') {
      const sharedCompatibilityPrepare = await this.prepareSelectedOpenCodeModelsCompatibilityBatch(
        {
          adapter,
          cwd,
          modelIds,
        }
      );
      if (sharedCompatibilityPrepare) {
        return sharedCompatibilityPrepare;
      }
    }

    const results = new Array<{ modelId: string; prepare: TeamRuntimePrepareResult }>(
      modelIds.length
    );
    const workerCount = Math.min(OPENCODE_PREFLIGHT_MODEL_PROBE_CONCURRENCY, modelIds.length);
    let nextIndex = 0;

    const prepareModel = async (modelId: string): Promise<TeamRuntimePrepareResult> => {
      const startedAt = Date.now();
      try {
        const prepare = await adapter.prepare({
          runId: `prepare-${randomUUID()}`,
          teamName: '__prepare_opencode__',
          cwd,
          providerId: 'opencode',
          model: modelId,
          runtimeOnly: verificationMode === 'compatibility',
          skipPermissions: true,
          expectedMembers: [],
          previousLaunchState: null,
        });
        appendPreflightDebugLog('opencode_model_prepare_result', {
          cwd,
          modelId,
          verificationMode,
          durationMs: Date.now() - startedAt,
          ok: prepare.ok,
          reason: prepare.ok ? null : prepare.reason,
          diagnostics: prepare.diagnostics,
          warnings: prepare.warnings,
        });
        return prepare;
      } catch (error) {
        const message = getErrorMessage(error).trim() || 'OpenCode model verification failed';
        appendPreflightDebugLog('opencode_model_prepare_result', {
          cwd,
          modelId,
          verificationMode,
          durationMs: Date.now() - startedAt,
          ok: false,
          reason: 'unknown_error',
          diagnostics: [message],
          warnings: [],
        });
        return {
          ok: false,
          providerId: 'opencode',
          reason: 'unknown_error',
          retryable: false,
          diagnostics: [message],
          warnings: [],
        };
      }
    };

    await Promise.all(
      Array.from({ length: workerCount }, async () => {
        while (true) {
          const currentIndex = nextIndex;
          nextIndex += 1;
          if (currentIndex >= modelIds.length) {
            return;
          }

          const modelId = modelIds[currentIndex];
          results[currentIndex] = {
            modelId,
            prepare: await prepareModel(modelId),
          };
        }
      })
    );

    for (const result of results) {
      if (!result) {
        blockingMessages.push(
          'OpenCode preflight could not collect model verification results for all selected models.'
        );
        continue;
      }

      const { modelId, prepare } = result;
      warnings.push(...prepare.warnings);
      if (prepare.ok) {
        details.push(
          verificationMode === 'compatibility'
            ? `Selected model ${modelId} is compatible. Deep verification pending.`
            : `Selected model ${modelId} verified for launch.`
        );
        continue;
      }

      const primaryReason =
        prepare.diagnostics.find((entry) => entry.trim().length > 0) ?? prepare.reason;
      const unavailableLine = `Selected model ${modelId} is unavailable. ${primaryReason}`;
      const verificationWarningLine = `Selected model ${modelId} could not be verified. ${primaryReason}`;
      if (prepare.retryable) {
        warnings.push(verificationWarningLine);
        if (verificationMode === 'compatibility') {
          blockingMessages.push(verificationWarningLine);
        }
      } else {
        if (verificationMode === 'compatibility') {
          details.push(unavailableLine);
        }
        blockingMessages.push(unavailableLine);
      }
    }

    appendPreflightDebugLog('opencode_model_prepare_batch_complete', {
      cwd,
      modelIds,
      verificationMode,
      durationMs: Date.now() - startedAt,
      details,
      warnings,
      blockingMessages,
    });

    return { details, warnings, blockingMessages };
  }

  private async prepareSelectedOpenCodeModelsCompatibilityBatch({
    adapter,
    cwd,
    modelIds,
  }: {
    adapter: TeamLaunchRuntimeAdapter;
    cwd: string;
    modelIds: string[];
  }): Promise<{
    details: string[];
    warnings: string[];
    blockingMessages: string[];
  } | null> {
    const details: string[] = [];
    const warnings: string[] = [];
    const blockingMessages: string[] = [];
    const startedAt = Date.now();

    appendPreflightDebugLog('opencode_compatibility_batch_start', {
      cwd,
      modelIds,
    });

    let sharedPrepare: TeamRuntimePrepareResult;
    try {
      sharedPrepare = await adapter.prepare({
        runId: `prepare-${randomUUID()}`,
        teamName: '__prepare_opencode__',
        cwd,
        providerId: 'opencode',
        model: undefined,
        runtimeOnly: true,
        skipPermissions: true,
        expectedMembers: [],
        previousLaunchState: null,
      });
    } catch (error) {
      const message = getErrorMessage(error).trim() || 'OpenCode model verification failed';
      sharedPrepare = {
        ok: false,
        providerId: 'opencode',
        reason: 'unknown_error',
        retryable: false,
        diagnostics: [message],
        warnings: [],
      };
    }

    warnings.push(...sharedPrepare.warnings);
    appendPreflightDebugLog('opencode_compatibility_batch_shared_prepare', {
      cwd,
      modelIds,
      durationMs: Date.now() - startedAt,
      ok: sharedPrepare.ok,
      reason: sharedPrepare.ok ? null : sharedPrepare.reason,
      diagnostics: sharedPrepare.diagnostics,
    });

    if (!sharedPrepare.ok) {
      const primaryReason =
        sharedPrepare.diagnostics.find((entry) => entry.trim().length > 0) ?? sharedPrepare.reason;
      for (const modelId of modelIds) {
        const unavailableLine = `Selected model ${modelId} is unavailable. ${primaryReason}`;
        const verificationWarningLine = `Selected model ${modelId} could not be verified. ${primaryReason}`;
        if (sharedPrepare.retryable) {
          warnings.push(verificationWarningLine);
          blockingMessages.push(verificationWarningLine);
        } else {
          details.push(unavailableLine);
          blockingMessages.push(unavailableLine);
        }
      }
      return { details, warnings, blockingMessages };
    }

    const latestReadiness =
      'getLastOpenCodeTeamLaunchReadiness' in adapter &&
      typeof adapter.getLastOpenCodeTeamLaunchReadiness === 'function'
        ? adapter.getLastOpenCodeTeamLaunchReadiness(cwd)
        : null;
    const availableModels: string[] = Array.from(
      new Set(
        (Array.isArray(latestReadiness?.availableModels) ? latestReadiness.availableModels : [])
          .filter((modelId: unknown): modelId is string => typeof modelId === 'string')
          .map((modelId: string) => modelId.trim())
          .filter((modelId: string) => modelId.length > 0)
      )
    );
    appendPreflightDebugLog('opencode_compatibility_batch_catalog', {
      cwd,
      modelIds,
      availableModelCount: availableModels.length,
      availableModelsSample: availableModels.slice(0, 20),
      fellBackToPerModelPrepare: availableModels.length === 0,
    });

    if (availableModels.length === 0) {
      return null;
    }

    for (const modelId of modelIds) {
      const resolvedModel = this.resolveOpenCodeCompatibilityModel(modelId, availableModels);
      if (resolvedModel.ok) {
        details.push(`Selected model ${modelId} is compatible. Deep verification pending.`);
        continue;
      }

      const unavailableLine = `Selected model ${modelId} is unavailable. ${resolvedModel.reason}`;
      details.push(unavailableLine);
      blockingMessages.push(unavailableLine);
    }

    appendPreflightDebugLog('opencode_compatibility_batch_complete', {
      cwd,
      modelIds,
      durationMs: Date.now() - startedAt,
      blockingMessages,
      details,
    });

    return { details, warnings, blockingMessages };
  }

  private resolveOpenCodeCompatibilityModel(
    requestedModelId: string,
    availableModels: readonly string[]
  ): { ok: true; resolvedModelId: string } | { ok: false; reason: string } {
    const trimmedModelId = requestedModelId.trim();
    if (!trimmedModelId) {
      return {
        ok: false,
        reason: 'Selected model id is empty.',
      };
    }

    if (availableModels.includes(trimmedModelId)) {
      return {
        ok: true,
        resolvedModelId: trimmedModelId,
      };
    }

    const equivalentOpenRouterMatches = this.findEquivalentOpenRouterModelIds(
      trimmedModelId,
      availableModels
    );
    if (equivalentOpenRouterMatches.length === 1) {
      return {
        ok: true,
        resolvedModelId: equivalentOpenRouterMatches[0],
      };
    }
    if (equivalentOpenRouterMatches.length > 1) {
      return {
        ok: false,
        reason:
          `Selected model ${trimmedModelId} matched multiple live provider models: ` +
          equivalentOpenRouterMatches.join(', '),
      };
    }

    if (trimmedModelId.includes('/')) {
      const requestedProviderId = this.extractOpenCodeCatalogProviderId(trimmedModelId);
      const availableProviderIds = this.getOpenCodeCatalogProviderIds(availableModels);
      if (
        requestedProviderId === 'openrouter' &&
        !availableProviderIds.includes(requestedProviderId)
      ) {
        const availableProviderList =
          availableProviderIds.length > 0 ? availableProviderIds.join(', ') : 'none';
        return {
          ok: false,
          reason:
            `OpenCode provider "openrouter" for selected model "${trimmedModelId}" ` +
            'is not available in the current runtime catalog for this project/profile. ' +
            `Live catalog providers: ${availableProviderList}. ` +
            'Connect OpenRouter in OpenCode provider management or choose one of the listed OpenCode models.',
        };
      }

      return {
        ok: false,
        reason: `Selected model ${trimmedModelId} was not found in the live provider catalog.`,
      };
    }

    const matchingProviderScopedModels = availableModels.filter(
      (candidate) => candidate.split('/').at(-1) === trimmedModelId
    );
    if (matchingProviderScopedModels.length === 1) {
      return {
        ok: true,
        resolvedModelId: matchingProviderScopedModels[0],
      };
    }
    if (matchingProviderScopedModels.length > 1) {
      return {
        ok: false,
        reason:
          `Selected model ${trimmedModelId} matched multiple live provider models: ` +
          matchingProviderScopedModels.join(', '),
      };
    }

    return {
      ok: false,
      reason: `Selected model ${trimmedModelId} was not found in the live provider catalog.`,
    };
  }

  private extractOpenCodeCatalogProviderId(modelId: string): string | null {
    const separatorIndex = modelId.indexOf('/');
    if (separatorIndex <= 0) {
      return null;
    }
    return modelId.slice(0, separatorIndex).trim().toLowerCase() || null;
  }

  private getOpenCodeCatalogProviderIds(availableModels: readonly string[]): string[] {
    return Array.from(
      new Set(
        availableModels
          .map((modelId) => this.extractOpenCodeCatalogProviderId(modelId.trim()))
          .filter((providerId): providerId is string => Boolean(providerId))
      )
    ).sort((left, right) => left.localeCompare(right));
  }

  private findEquivalentOpenRouterModelIds(
    requestedModelId: string,
    availableModels: readonly string[]
  ): string[] {
    const equivalentIds = new Set<string>();

    if (requestedModelId.startsWith('openrouter/')) {
      equivalentIds.add(requestedModelId.slice('openrouter/'.length));
    } else if (requestedModelId.includes('/')) {
      equivalentIds.add(`openrouter/${requestedModelId}`);
    }

    if (equivalentIds.size === 0) {
      return [];
    }

    return Array.from(
      new Set(availableModels.filter((candidate) => equivalentIds.has(candidate.trim())))
    );
  }

  private resolveProviderCompatibilityModel(params: {
    providerId: TeamProviderId;
    requestedModelId: string;
    runtimeFacts: RuntimeProviderLaunchFacts;
    limitContext: boolean;
  }):
    | { kind: 'available'; resolvedModelId: string | null }
    | { kind: 'compatible'; reason: string }
    | { kind: 'unavailable'; reason: string } {
    const trimmedModelId = params.requestedModelId.trim();
    if (!trimmedModelId) {
      return {
        kind: 'unavailable',
        reason: 'Selected model id is empty.',
      };
    }

    if (isDefaultProviderModelSelection(trimmedModelId)) {
      return {
        kind: 'available',
        resolvedModelId: params.runtimeFacts.defaultModel,
      };
    }

    const availableModels = params.runtimeFacts.modelIds;
    let resolvedModelId: string | null = availableModels.has(trimmedModelId)
      ? trimmedModelId
      : null;

    if (!resolvedModelId && params.providerId === 'anthropic') {
      resolvedModelId =
        resolveAnthropicLaunchModel({
          selectedModel: trimmedModelId,
          limitContext: params.limitContext,
          availableLaunchModels: availableModels,
          defaultLaunchModel: params.runtimeFacts.defaultModel,
        }) ?? null;
    }

    if (!resolvedModelId && !trimmedModelId.includes('/')) {
      const scopedMatches = Array.from(availableModels).filter(
        (candidate) => candidate.split('/').at(-1) === trimmedModelId
      );
      if (scopedMatches.length === 1) {
        resolvedModelId = scopedMatches[0];
      } else if (scopedMatches.length > 1) {
        return {
          kind: 'unavailable',
          reason:
            `Selected model ${trimmedModelId} matched multiple live provider models: ` +
            scopedMatches.join(', '),
        };
      }
    }

    if (resolvedModelId && (availableModels.size === 0 || availableModels.has(resolvedModelId))) {
      return {
        kind: 'available',
        resolvedModelId,
      };
    }

    const dynamicCatalog = params.runtimeFacts.runtimeCapabilities?.modelCatalog?.dynamic === true;
    const hasAuthoritativeCatalog =
      availableModels.size > 0 ||
      params.runtimeFacts.modelCatalog != null ||
      params.runtimeFacts.runtimeCapabilities?.modelCatalog?.dynamic === false;

    if (dynamicCatalog || !hasAuthoritativeCatalog) {
      return {
        kind: 'compatible',
        reason: dynamicCatalog
          ? 'Runtime catalog allows dynamic model launch.'
          : 'Runtime model catalog was unavailable.',
      };
    }

    return {
      kind: 'unavailable',
      reason: `Selected model ${trimmedModelId} was not found in the live provider catalog.`,
    };
  }

  private async verifySelectedProviderModels({
    claudePath,
    cwd,
    providerId,
    modelIds,
    limitContext,
  }: {
    claudePath: string;
    cwd: string;
    providerId: TeamProviderId;
    modelIds: string[];
    limitContext: boolean;
  }): Promise<{
    details: string[];
    warnings: string[];
    blockingMessages: string[];
  }> {
    const details: string[] = [];
    const warnings: string[] = [];
    const blockingMessages: string[] = [];
    const startedAt = Date.now();

    if (modelIds.length === 0) {
      return { details, warnings, blockingMessages };
    }

    const { env, providerArgs = [] } = await this.buildProvisioningEnv(providerId);
    const runtimeFacts = await this.readRuntimeProviderLaunchFacts({
      claudePath,
      cwd,
      providerId,
      env,
      providerArgs,
      limitContext,
    });

    const recordOutcome = (
      requestedModelId: string,
      outcome:
        | { kind: 'available'; resolvedModelId: string | null }
        | { kind: 'compatible'; reason: string }
        | { kind: 'unavailable'; reason: string }
    ): void => {
      if (outcome.kind === 'available') {
        details.push(`Selected model ${requestedModelId} is available for launch.`);
        return;
      }
      if (outcome.kind === 'compatible') {
        details.push(
          `Selected model ${requestedModelId} is compatible. Deep verification pending.`
        );
        return;
      }
      blockingMessages.push(`Selected model ${requestedModelId} is unavailable. ${outcome.reason}`);
    };

    appendPreflightDebugLog('provider_model_catalog_check_start', {
      providerId,
      cwd,
      modelIds,
    });

    for (const modelId of modelIds) {
      const label = modelId.trim();
      if (!label) {
        continue;
      }

      recordOutcome(
        label,
        this.resolveProviderCompatibilityModel({
          providerId,
          requestedModelId: label,
          runtimeFacts,
          limitContext,
        })
      );
    }

    appendPreflightDebugLog('provider_model_catalog_check_complete', {
      providerId,
      cwd,
      modelIds,
      durationMs: Date.now() - startedAt,
      modelCount: runtimeFacts.modelIds.size,
      details,
      warnings,
      blockingMessages,
    });

    return { details, warnings, blockingMessages };
  }

  private async materializeEffectiveTeamMemberSpecs(params: {
    claudePath: string;
    cwd: string;
    members: TeamCreateRequest['members'];
    defaults: {
      providerId?: TeamProviderId;
      model?: string;
      effort?: TeamCreateRequest['effort'];
    };
    primaryProviderId?: TeamProviderId;
    primaryEnv?: ProvisioningEnvResolution;
    limitContext?: boolean;
  }): Promise<TeamCreateRequest['members']> {
    const envByProvider = new Map<TeamProviderId, Promise<ProvisioningEnvResolution>>();
    const defaultModelByProvider = new Map<TeamProviderId, Promise<string>>();
    const normalizedPrimaryProviderId = resolveTeamProviderId(params.primaryProviderId);

    const getProvisioningEnv = (providerId: TeamProviderId): Promise<ProvisioningEnvResolution> => {
      if (normalizedPrimaryProviderId === providerId && params.primaryEnv != null) {
        return Promise.resolve(params.primaryEnv);
      }

      const cached = envByProvider.get(providerId);
      if (cached) {
        return cached;
      }

      const created = this.buildProvisioningEnv(providerId);
      envByProvider.set(providerId, created);
      return created;
    };

    const getResolvedDefaultModel = (providerId: TeamProviderId): Promise<string> => {
      const cached = defaultModelByProvider.get(providerId);
      if (cached) {
        return cached;
      }

      const providerLabel = getTeamProviderLabel(providerId);
      const created = (async () => {
        const envResolution = await getProvisioningEnv(providerId);
        if (envResolution.warning) {
          throw new Error(envResolution.warning);
        }

        const facts = await this.readRuntimeProviderLaunchFacts({
          claudePath: params.claudePath,
          cwd: params.cwd,
          providerId,
          env: envResolution.env,
          providerArgs: envResolution.providerArgs,
          limitContext: params.limitContext === true,
        });
        const resolvedDefaultModel = facts.defaultModel?.trim();
        if (!resolvedDefaultModel) {
          throw new Error(
            `Could not resolve the runtime default model for ${providerLabel} teammates. Select an explicit model and retry.`
          );
        }
        return resolvedDefaultModel;
      })();

      defaultModelByProvider.set(providerId, created);
      return created;
    };

    const effectiveMembers: TeamCreateRequest['members'] = [];
    for (const member of params.members) {
      const effectiveMember = buildEffectiveTeamMemberSpec(member, params.defaults);
      const providerId = normalizeTeamMemberProviderId(effectiveMember.providerId) ?? 'anthropic';
      if (providerId === 'anthropic' || effectiveMember.model?.trim()) {
        effectiveMembers.push(effectiveMember);
        continue;
      }

      effectiveMembers.push({
        ...effectiveMember,
        model: await getResolvedDefaultModel(providerId),
      });
    }

    return effectiveMembers;
  }

  private getOpenCodeRuntimeLaunchCwd(
    fallbackCwd: string,
    members: TeamCreateRequest['members']
  ): string {
    if (members.length > 1 && members.some((member) => member.isolation === 'worktree')) {
      throw new Error(
        'OpenCode worktree isolation currently supports one isolated OpenCode member per runtime lane.'
      );
    }
    const memberCwds = [
      ...new Set(
        members.map((member) => member.cwd?.trim()).filter((cwd): cwd is string => Boolean(cwd))
      ),
    ];
    if (memberCwds.length === 0) {
      return fallbackCwd;
    }
    if (memberCwds.length === 1) {
      return memberCwds[0];
    }
    throw new Error(
      'OpenCode runtime lanes support exactly one project path in this release. Use mixed-team OpenCode side lanes for per-teammate worktree isolation.'
    );
  }

  private async resolveOpenCodeMemberWorkspacesForRuntime(params: {
    teamName: string;
    baseCwd: string;
    leadProviderId?: TeamProviderId;
    members: TeamCreateRequest['members'];
  }): Promise<TeamCreateRequest['members']> {
    const isolatedOpenCodeMembers = params.members.filter((member) => {
      const providerId = normalizeTeamMemberProviderId(member.providerId);
      return providerId === 'opencode' && member.isolation === 'worktree';
    });
    if (isolatedOpenCodeMembers.length === 0) {
      return params.members;
    }

    if (
      isPureOpenCodeProvisioningRequest({
        providerId: params.leadProviderId,
        members: params.members,
      }) &&
      params.members.length > 1
    ) {
      throw new Error(
        'OpenCode worktree isolation currently supports mixed-team OpenCode side lanes or one-member OpenCode runtime lanes. Multiple OpenCode members in one lane cannot use separate worktrees yet.'
      );
    }

    const nextMembers: TeamCreateRequest['members'] = [];
    for (const member of params.members) {
      const providerId = normalizeTeamMemberProviderId(member.providerId);
      if (providerId !== 'opencode' || member.isolation !== 'worktree') {
        nextMembers.push(member);
        continue;
      }

      const existingCwd = member.cwd?.trim();
      if (existingCwd) {
        if (!path.isAbsolute(existingCwd)) {
          throw new Error(
            `OpenCode worktree path for "${member.name}" must be absolute: ${existingCwd}`
          );
        }
        const existingCwdStat = await fs.promises.stat(existingCwd).catch(() => null);
        if (existingCwdStat) {
          if (!existingCwdStat.isDirectory()) {
            throw new Error(
              `OpenCode worktree path for "${member.name}" is not a directory: ${existingCwd}`
            );
          }
          nextMembers.push({ ...member, cwd: existingCwd });
          continue;
        }
      }

      const resolution = await this.memberWorktreeManager.ensureMemberWorktree({
        teamName: params.teamName,
        memberName: member.name,
        baseCwd: params.baseCwd,
      });
      nextMembers.push({ ...member, cwd: resolution.worktreePath });
    }

    return nextMembers;
  }

  private getFreshCachedProbeResult(
    cwd: string,
    providerId: TeamProviderId | undefined
  ): CachedProbeResult | null {
    const cacheKey = createProbeCacheKey(cwd, providerId);
    const cached = cachedProbeResults.get(cacheKey);
    if (!cached) return null;
    const ageMs = Date.now() - cached.cachedAtMs;
    if (ageMs >= PROBE_CACHE_TTL_MS) {
      cachedProbeResults.delete(cacheKey);
      return null;
    }
    return cached;
  }

  private clearProbeCache(cwd: string, providerId: TeamProviderId | undefined): void {
    cachedProbeResults.delete(createProbeCacheKey(cwd, providerId));
  }

  private async validatePrepareCwd(cwd: string): Promise<void> {
    if (!path.isAbsolute(cwd)) {
      throw new Error('cwd must be an absolute path');
    }

    try {
      const stat = await fs.promises.stat(cwd);
      if (!stat.isDirectory()) {
        throw new Error('cwd must be a directory');
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        // Allow the runtime probe to degrade a missing cwd into a warning.
        // This keeps prepareForProvisioning side-effect free for future/missing paths.
        return;
      }
      throw error;
    }
  }

  private async getCachedOrProbeResult(
    cwd: string,
    providerId: TeamProviderId | undefined
  ): Promise<ProbeResult | null> {
    const cacheKey = createProbeCacheKey(cwd, providerId);
    const cached = this.getFreshCachedProbeResult(cwd, providerId);
    if (cached) {
      return {
        claudePath: cached.claudePath,
        authSource: cached.authSource,
        warning: cached.warning,
      };
    }

    const existingProbe = probeInFlightByKey.get(cacheKey);
    if (existingProbe) {
      return await existingProbe;
    }

    const probePromise = (async () => {
      const claudePath = await ClaudeBinaryResolver.resolve();
      if (!claudePath) return null;

      const {
        env,
        authSource,
        providerArgs = [],
        warning,
      } = await this.buildProvisioningEnv(providerId);
      if (warning) {
        return {
          claudePath,
          authSource,
          warning,
        };
      }

      const probe = await this.probeClaudeRuntime(claudePath, cwd, env, providerId, providerArgs);
      const result = {
        claudePath,
        authSource,
        ...(probe.warning ? { warning: probe.warning } : {}),
      };

      const shouldCache =
        !probe.warning ||
        (!this.isAuthFailureWarning(probe.warning, 'probe') &&
          !isTransientProbeWarning(probe.warning) &&
          !isBinaryProbeWarning(probe.warning));

      if (shouldCache) {
        cachedProbeResults.set(cacheKey, { cacheKey, ...result, cachedAtMs: Date.now() });
      } else {
        // Don't pin auth failures / transient failures in cache — user may fix and retry.
        cachedProbeResults.delete(cacheKey);
      }

      return result;
    })();
    probeInFlightByKey.set(cacheKey, probePromise);

    try {
      return await probePromise;
    } finally {
      probeInFlightByKey.delete(cacheKey);
    }
  }

  private isAuthFailureWarning(text: string, source: AuthWarningSource): boolean {
    const lower = text.toLowerCase();
    const hasExplicitCliAuthSignal =
      lower.includes('not authenticated') ||
      lower.includes('not logged in') ||
      lower.includes('please run /login') ||
      lower.includes('missing api key') ||
      lower.includes('invalid api key') ||
      lower.includes('authentication failed') ||
      lower.includes('not configured for runtime use') ||
      lower.includes('set gemini_api_key') ||
      lower.includes('google adc credentials') ||
      lower.includes('google_cloud_project') ||
      lower.includes('codex provider is not authenticated') ||
      lower.includes('run `claude auth login`') ||
      lower.includes('claude auth login') ||
      lower.includes('claude-multimodel auth login');

    if (hasExplicitCliAuthSignal) {
      return true;
    }

    if (source === 'assistant' || source === 'stdout') {
      return false;
    }

    const hasAuthStatus401 =
      /api error:\s*401\b/i.test(text) ||
      /\b401 unauthorized\b/i.test(lower) ||
      (/(^|\D)401(\D|$)/.test(lower) &&
        (lower.includes('auth') || lower.includes('api') || lower.includes('login')));

    return (
      hasAuthStatus401 ||
      (lower.includes('unauthorized') &&
        (lower.includes('api') || lower.includes('auth') || lower.includes('login')))
    );
  }

  private hasApiError(text: string): boolean {
    return /api error:\s*\d{3}\b/i.test(text) || /invalid_request_error/i.test(text);
  }

  private sanitizeCliSnippet(text: string): string {
    // Remove control characters that often show up as binary noise in CLI error payloads.
    // Preserve newlines/tabs for readability.
    // eslint-disable-next-line no-control-regex, sonarjs/no-control-regex -- intentionally stripping control chars
    return text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
  }

  private normalizeApiRetryErrorMessage(text: string): string {
    const sanitized = this.sanitizeCliSnippet(text).trim();
    if (!sanitized) {
      return sanitized;
    }

    const jsonMatch = /^\d{3}\s+(\{[\s\S]*\})$/.exec(sanitized);
    const jsonCandidate = jsonMatch?.[1] ?? (sanitized.startsWith('{') ? sanitized : null);
    if (jsonCandidate) {
      try {
        const parsed = JSON.parse(jsonCandidate) as {
          error?: { message?: unknown };
          message?: unknown;
        };
        const nestedMessage =
          typeof parsed.error?.message === 'string'
            ? parsed.error.message
            : typeof parsed.message === 'string'
              ? parsed.message
              : null;
        if (nestedMessage) {
          return this.normalizeApiRetryErrorMessage(nestedMessage);
        }
      } catch {
        // Fall through to raw sanitized text.
      }
    }

    return sanitized
      .replace(/^gemini cli backend error:\s*/i, '')
      .replace(/^gemini api backend error:\s*/i, '')
      .replace(/^api error:\s*\d+\s*/i, '')
      .trim();
  }

  private extractApiErrorStatus(text: string | undefined): number | null {
    const raw = text?.trim();
    if (!raw) return null;
    const match = /api error:\s*(\d{3})\b/i.exec(raw) ?? /^(\d{3})\b/.exec(raw);
    if (!match) return null;
    const status = Number.parseInt(match[1], 10);
    return Number.isFinite(status) ? status : null;
  }

  private extractStructuredApiErrorCode(text: string | undefined): string | null {
    const raw = text?.trim();
    if (!raw) return null;
    const prefixedMatch = /^(?:API Error:\s*\d+\s+|\d+\s+)?(\{[\s\S]*\})$/i.exec(raw);
    const jsonCandidate = prefixedMatch?.[1] ?? (raw.startsWith('{') ? raw : null);
    if (!jsonCandidate) return null;

    try {
      const parsed = JSON.parse(jsonCandidate) as {
        error?: { code?: unknown };
        code?: unknown;
      };
      const code = parsed.error?.code ?? parsed.code;
      return typeof code === 'string' || typeof code === 'number' ? String(code) : null;
    } catch {
      return null;
    }
  }

  private extractApiErrorStatusFromPayload(payload: unknown): number | null {
    if (!payload || typeof payload !== 'object') return null;
    const record = payload as Record<string, unknown>;
    const status = record.status;
    return typeof status === 'number' && Number.isFinite(status) ? status : null;
  }

  private extractApiErrorCodeFromPayload(payload: unknown): string | null {
    if (!payload || typeof payload !== 'object') return null;
    const record = payload as Record<string, unknown>;
    const directCode = record.code;
    if (typeof directCode === 'string' || typeof directCode === 'number') {
      return String(directCode);
    }

    const error = record.error;
    if (!error || typeof error !== 'object') return null;
    const errorRecord = error as Record<string, unknown>;
    const nestedCode = errorRecord.code;
    if (typeof nestedCode === 'string' || typeof nestedCode === 'number') {
      return String(nestedCode);
    }

    const nestedError = errorRecord.error;
    if (!nestedError || typeof nestedError !== 'object') return null;
    const nestedErrorRecord = nestedError as Record<string, unknown>;
    const deeplyNestedCode = nestedErrorRecord.code;
    return typeof deeplyNestedCode === 'string' || typeof deeplyNestedCode === 'number'
      ? String(deeplyNestedCode)
      : null;
  }

  private isRateLimitApiRetryPayload(
    msg: Record<string, unknown>,
    rawErrorMessage?: string
  ): boolean {
    if (msg.error_status === 429) return true;
    if (msg.error === 'rate_limit' || msg.error === 'model_cooldown') return true;

    const structuredCode = this.extractStructuredApiErrorCode(rawErrorMessage);
    return structuredCode === '1302' || structuredCode === 'model_cooldown';
  }

  private isRateLimitSystemApiErrorPayload(msg: Record<string, unknown>): boolean {
    const payload = msg.error;
    const status = this.extractApiErrorStatusFromPayload(payload);
    if (status === 429) return true;

    const code = this.extractApiErrorCodeFromPayload(payload);
    return code === '1302' || code === 'model_cooldown';
  }

  private isRateLimitApiError(text: string | undefined, status?: string | number | null): boolean {
    const numericStatus =
      typeof status === 'number'
        ? status
        : typeof status === 'string' && status.trim()
          ? Number.parseInt(status, 10)
          : this.extractApiErrorStatus(text);
    if (numericStatus === 429) return true;
    return this.extractStructuredApiErrorCode(text) === '1302';
  }

  private toMarkdownCodeSafe(text: string): string {
    return this.sanitizeCliSnippet(text).replace(/```/g, '``\\`');
  }

  private extractApiErrorSnippet(text: string): string | null {
    const match = /api error:\s*\d{3}\b/i.exec(text) ?? /invalid_request_error/i.exec(text);
    if (match?.index === undefined) return null;
    const start = Math.max(0, match.index - 200);
    const end = Math.min(text.length, match.index + 4000);
    const raw = text.slice(start, end).trim();
    if (!raw) return null;
    // Avoid breaking markdown fences if the payload contains ``` accidentally.
    return this.sanitizeCliSnippet(raw).replace(/```/g, '``\\`');
  }

  private failProvisioningWithApiError(run: ProvisioningRun, source: string): void {
    if (run.provisioningComplete || run.processKilled || run.authRetryInProgress) return;
    if (run.progress.state === 'failed' || run.cancelRequested) return;

    const combined = [
      buildCombinedLogs(run.stdoutBuffer, run.stderrBuffer),
      run.provisioningOutputParts.length > 0 ? run.provisioningOutputParts.join('\n') : '',
    ]
      .filter(Boolean)
      .join('\n')
      .trim();

    const snippet =
      this.extractApiErrorSnippet(combined) ?? this.extractApiErrorSnippet(source) ?? null;
    const status = this.extractApiErrorStatus(combined) ?? this.extractApiErrorStatus(source);
    const isRateLimited =
      this.isRateLimitApiError(combined, status) || this.isRateLimitApiError(source, status);

    const hint = run.isLaunch ? 'Launch' : 'Provisioning';
    const statusLabel = isRateLimited ? '请求限流' : status ? `API Error ${status}` : 'API Error';
    if (snippet) {
      run.provisioningOutputParts.push(
        `**${hint} failed: ${statusLabel} detected**\n\n\`\`\`\n${snippet}\n\`\`\``
      );
    } else {
      run.provisioningOutputParts.push(`**${hint} failed: ${statusLabel} detected**`);
    }

    const progress = updateProgress(run, 'failed', `${hint} failed — ${statusLabel}`, {
      error: isRateLimited
        ? 'Anthropic 返回 429/1302，请求已被限流。团队未完成启动，请稍后重试或减少同时启动的成员。'
        : `Claude CLI reported ${statusLabel} during startup. The team was not started.`,
      cliLogsTail: extractCliLogsFromRun(run),
    });
    if (isRateLimited) {
      this.teamSendBlockReasonByTeam.set(
        run.teamName,
        '负责人当前处于请求限流状态，团队未完成启动。请稍后重试，或先停止部分团队/成员。'
      );
    }
    run.onProgress(progress);

    run.processKilled = true;
    run.cancelRequested = true;
    // SIGKILL: newer Claude CLI versions handle SIGTERM gracefully and delete
    // team files during cleanup. SIGKILL is uncatchable — files are preserved.
    killTeamProcess(run.child);
    this.cleanupRun(run);
  }

  /**
   * Shows a non-fatal API error warning in the Live output section.
   * Unlike failProvisioningWithApiError, does NOT kill the process — lets the SDK retry.
   * Deduplicates: only the first warning per run is shown.
   */
  private emitApiErrorWarning(run: ProvisioningRun, text: string): void {
    if (run.provisioningComplete || run.processKilled || run.authRetryInProgress) return;
    if (run.progress.state === 'failed' || run.cancelRequested) return;
    if (run.apiErrorWarningEmitted) return;

    run.apiErrorWarningEmitted = true;

    const snippet = this.extractApiErrorSnippet(text);
    const status = this.extractApiErrorStatus(text);
    const label = this.isRateLimitApiError(text, status)
      ? '请求限流'
      : status
        ? `API Error ${status}`
        : 'API Error';

    const warningText = snippet
      ? `**${label} — SDK is retrying**\n\n\`\`\`\n${snippet}\n\`\`\`\n\nWaiting for retry...`
      : `**${label} — SDK is retrying**\n\nWaiting for retry...`;

    run.provisioningOutputParts.push(warningText);
    run.progress.message = `${label} — SDK retrying...`;
    emitLogsProgress(run);
    // Prevent double-emit: the calling stderr/stdout handler will also try throttled emitLogsProgress
    // after this returns. Updating lastLogProgressAt ensures the throttle check rejects it.
    run.lastLogProgressAt = Date.now();
  }

  /**
   * Starts a periodic watchdog that detects when the CLI process has produced
   * no stdout/stderr data for an extended period. Pushes progressive warnings
   * into provisioningOutputParts so they appear in the Live output section.
   */
  private startStallWatchdog(run: ProvisioningRun): void {
    if (run.stallCheckHandle) return;

    run.stallCheckHandle = setInterval(() => {
      // try/catch: Node.js does NOT catch errors in setInterval callbacks —
      // without this, an exception would silently kill the watchdog.
      try {
        if (
          run.provisioningComplete ||
          run.processKilled ||
          run.cancelRequested ||
          run.authRetryInProgress
        ) {
          this.stopStallWatchdog(run);
          return;
        }

        const now = Date.now();
        const silenceMs = now - run.lastStdoutReceivedAt;

        if (silenceMs < STALL_WARNING_THRESHOLD_MS) return;

        // Instead of pushing new warnings (which bloats Live output),
        // replace the existing stall warning in-place so the displayed
        // silence duration stays current (20s → 30s → 1m → ...).
        const silenceSec = Math.round(silenceMs / 1000);
        const warningText = this.buildStallWarningText(silenceSec, run);

        if (run.stallWarningIndex != null) {
          run.provisioningOutputParts[run.stallWarningIndex] = warningText;
        } else {
          // Save current message ONLY if it's a normal provisioning message,
          // not a retry message (which has higher priority and its own lifecycle).
          if (run.progress.messageSeverity !== 'error') {
            run.preStallMessage = run.progress.message;
          }
          run.stallWarningIndex = run.provisioningOutputParts.length;
          run.provisioningOutputParts.push(warningText);
        }

        const mins = Math.floor(silenceSec / 60);
        const secs = silenceSec % 60;
        const elapsed = mins > 0 ? (secs > 0 ? `${mins}m ${secs}s` : `${mins}m`) : `${secs}s`;

        // If retry messages are flowing, they are more informative than our
        // generic stall text — don't overwrite progress.message / severity.
        // Only update the Live output (assistantOutput) with the stall warning.
        const retryActive = run.lastRetryAt > 0 && now - run.lastRetryAt < 90_000;

        run.progress = {
          ...run.progress,
          updatedAt: nowIso(),
          ...(!retryActive && {
            message: this.buildStallProgressMessage(silenceSec, elapsed),
            messageSeverity: 'warning' as const,
          }),
          assistantOutput:
            buildProgressAssistantOutput(run.provisioningOutputParts) ??
            run.progress.assistantOutput,
        };
        run.onProgress(run.progress);
      } catch (err) {
        logger.error(
          `[${run.teamName}] Stall watchdog error: ${
            err instanceof Error ? err.message : String(err)
          }`
        );
      }
    }, STALL_CHECK_INTERVAL_MS);
  }

  private stopStallWatchdog(run: ProvisioningRun): void {
    if (run.stallCheckHandle) {
      clearInterval(run.stallCheckHandle);
      run.stallCheckHandle = null;
    }
  }

  private buildStallWarningText(silenceSec: number, run: ProvisioningRun): string {
    const mins = Math.floor(silenceSec / 60);
    const secs = silenceSec % 60;
    const elapsed = mins > 0 ? (secs > 0 ? `${mins}m ${secs}s` : `${mins}m`) : `${secs}s`;

    if (silenceSec < 60) {
      return (
        `---\n\n` +
        `**Waiting for CLI response** (silent for ${elapsed})\n\n` +
        `The process is running but not producing output yet. Cloud sometimes delays logs, ` +
        `and short waits like this are normal. The SDK also retries automatically if the ` +
        `request briefly hits rate limiting.\n\n` +
        `Waiting...`
      );
    }

    if (silenceSec < 120) {
      return (
        `---\n\n` +
        `**Waiting for CLI response** (silent for ${elapsed})\n\n` +
        `The process is still waiting on Cloud. Logs can sometimes show up after ` +
        `1-1.5 minutes, and that is still okay. The SDK retries automatically if the ` +
        `request hits rate limiting (error 429 / model cooldown).\n\n` +
        `If there is still no output after 2 minutes, that starts to look unusual.\n\n` +
        `You can cancel and try again later if the wait continues.`
      );
    }

    const modelName = run.request.model ?? 'default';
    const effortLabel = run.request.effort ? ` (effort: ${run.request.effort})` : '';

    return (
      `---\n\n` +
      `**Extended CLI wait** (silent for ${elapsed})\n\n` +
      `Model **${modelName}**${effortLabel} is still waiting on Cloud. Some delay is normal, ` +
      `but no logs for ${elapsed} is already unusual.\n\n` +
      `Possible causes:\n` +
      `- Rate limiting / model cooldown (429) — SDK retries automatically\n` +
      `- API server overload for this model\n` +
      `- A stalled or delayed Cloud response\n\n` +
      `Consider canceling and trying with a different model.`
    );
  }

  private buildStallProgressMessage(silenceSec: number, elapsed: string): string {
    if (silenceSec < 120) {
      return `等待 Cloud 响应已 ${elapsed}，日志可能延迟，这仍属正常`;
    }
    return `仍在等待 Cloud 响应，已 ${elapsed}，这不太正常`;
  }

  /**
   * Detects auth failure keywords in stderr/stdout during provisioning.
   * On first detection: kills process, waits, and respawns automatically.
   * On second detection (after retry): fails fast with a clear error.
   */
  private handleAuthFailureInOutput(
    run: ProvisioningRun,
    text: string,
    source: AuthWarningSource
  ): void {
    if (run.provisioningComplete || run.processKilled || run.authRetryInProgress) return;
    if (!this.isAuthFailureWarning(text, source)) return;

    if (!run.authFailureRetried) {
      logger.warn(
        `[${run.teamName}] Auth failure detected in ${source} during provisioning — ` +
          `will kill process and retry after ${PREFLIGHT_AUTH_RETRY_DELAY_MS}ms`
      );
      run.authRetryInProgress = true;
      void this.respawnAfterAuthFailure(run);
    } else {
      logger.error(`[${run.teamName}] Auth failure detected in ${source} after retry — giving up`);
      run.processKilled = true;
      killTeamProcess(run.child);
      const progress = updateProgress(run, 'failed', 'Authentication failed — CLI requires login', {
        error:
          'Claude CLI is not authenticated. Run `claude auth login` (or start `claude` and run `/login`) ' +
          'to authenticate, or set ANTHROPIC_API_KEY and try again.',
        cliLogsTail: extractCliLogsFromRun(run),
      });
      run.onProgress(progress);
      this.cleanupRun(run);
    }
  }

  /**
   * Kills the current process, waits for lock release, and respawns with saved context.
   * Reattaches all stream listeners and resends the prompt.
   */
  private async respawnAfterAuthFailure(run: ProvisioningRun): Promise<void> {
    const ctx = run.spawnContext;
    const stopAllGenerationAtStart = this.stopAllTeamsGeneration;
    if (!ctx) {
      logger.error(`[${run.teamName}] Cannot respawn — no spawn context saved`);
      run.authRetryInProgress = false;
      return;
    }

    // Tear down current process without full cleanupRun (keep run alive)
    if (run.timeoutHandle) {
      clearTimeout(run.timeoutHandle);
      run.timeoutHandle = null;
    }
    this.stopFilesystemMonitor(run);
    this.stopStallWatchdog(run);
    if (run.child) {
      run.child.stdout?.removeAllListeners('data');
      run.child.stderr?.removeAllListeners('data');
      run.child.removeAllListeners('error');
      run.child.removeAllListeners('exit');
      killTeamProcess(run.child);
      run.child = null;
    }

    // Reset buffers for fresh attempt
    run.stdoutBuffer = '';
    run.stderrBuffer = '';
    run.claudeLogLines = [];
    run.lastClaudeLogStream = null;
    run.stdoutLogLineBuf = '';
    run.stderrLogLineBuf = '';
    run.claudeLogsUpdatedAt = undefined;
    run.authFailureRetried = true;
    run.apiErrorWarningEmitted = false;

    updateProgress(run, 'spawning', 'Auth failed — retrying after short delay');
    run.onProgress(run.progress);

    await sleep(PREFLIGHT_AUTH_RETRY_DELAY_MS);

    if (run.cancelRequested) {
      run.authRetryInProgress = false;
      return;
    }

    // Verify --mcp-config still exists; regenerate if deleted (e.g. by stale GC)
    const mcpFlagIdx = ctx.args.indexOf('--mcp-config');
    if (mcpFlagIdx !== -1 && mcpFlagIdx + 1 < ctx.args.length) {
      const existingConfigPath = ctx.args[mcpFlagIdx + 1];
      try {
        await fs.promises.access(existingConfigPath, fs.constants.F_OK);
      } catch {
        logger.warn(`[${run.teamName}] MCP config ${existingConfigPath} missing, regenerating`);
        try {
          const newConfigPath = await this.mcpConfigBuilder.writeConfigFile(ctx.cwd);
          ctx.args[mcpFlagIdx + 1] = newConfigPath;
          run.mcpConfigPath = newConfigPath;
          logger.info(`[${run.teamName}] Regenerated MCP config at ${newConfigPath}`);
        } catch (regenErr) {
          run.authRetryInProgress = false;
          const progress = updateProgress(run, 'failed', 'Failed to regenerate MCP config', {
            error: regenErr instanceof Error ? regenErr.message : String(regenErr),
            cliLogsTail: extractCliLogsFromRun(run),
          });
          run.onProgress(progress);
          this.cleanupRun(run);
          return;
        }
      }
    }

    // Respawn with saved context — CLI handles its own auth refresh.
    let child: ReturnType<typeof spawn>;
    try {
      if (mcpFlagIdx !== -1 && mcpFlagIdx + 1 < ctx.args.length) {
        await this.validateAgentTeamsMcpRuntime(
          ctx.claudePath,
          ctx.cwd,
          ctx.env,
          ctx.args[mcpFlagIdx + 1],
          {
            isCancelled: () =>
              run.cancelRequested ||
              run.processKilled ||
              this.stopAllTeamsGeneration !== stopAllGenerationAtStart,
          }
        );
      }
      if (
        run.cancelRequested ||
        run.processKilled ||
        this.stopAllTeamsGeneration !== stopAllGenerationAtStart
      ) {
        throw new Error('Team launch cancelled by app shutdown');
      }
      child = spawnCli(ctx.claudePath, ctx.args, {
        cwd: ctx.cwd,
        env: { ...ctx.env },
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (error) {
      run.authRetryInProgress = false;
      const progress = updateProgress(run, 'failed', 'Failed to respawn Claude CLI', {
        error: error instanceof Error ? error.message : String(error),
      });
      run.onProgress(progress);
      this.cleanupRun(run);
      return;
    }

    logger.info(
      `[${run.teamName}] Respawned CLI process after auth failure (pid=${child.pid ?? '?'})`
    );
    run.child = child;
    run.authRetryInProgress = false;

    updateProgress(run, 'spawning', 'CLI respawned — sending prompt', {
      pid: child.pid ?? undefined,
    });
    run.onProgress(run.progress);

    void this.sendStreamJsonUserPrompt(child, ctx.prompt, run.teamName, 'retry').catch((error) => {
      logger.warn(
        `[${run.teamName}] Failed to resend bootstrap prompt after auth retry: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    });

    // Reattach stdout handler
    this.attachStdoutHandler(run);

    // Reattach stderr handler
    this.attachStderrHandler(run);

    run.lastDataReceivedAt = Date.now();
    run.lastStdoutReceivedAt = Date.now();
    this.startStallWatchdog(run);

    // Restart filesystem monitor for createTeam (launch skips it)
    if (!run.isLaunch) {
      updateProgress(run, 'configuring', 'Waiting for team configuration...');
      run.onProgress(run.progress);
      this.startFilesystemMonitor(run, run.request);
    } else {
      updateProgress(
        run,
        'configuring',
        run.deterministicBootstrap
          ? 'CLI running — deterministic reconnect in progress'
          : 'CLI running — reconnecting with teammates'
      );
      run.onProgress(run.progress);
    }

    // Restart timeout
    run.timeoutHandle = setTimeout(() => {
      if (!run.processKilled && !run.provisioningComplete) {
        run.processKilled = true;
        run.finalizingByTimeout = true;
        void (async () => {
          const readyOnTimeout = await this.tryCompleteAfterTimeout(run);
          killTeamProcess(run.child);
          if (readyOnTimeout) return;

          const hint = run.isLaunch ? ' (launch)' : '';
          const progress = updateProgress(run, 'failed', `Timed out waiting for CLI${hint}`, {
            error: `Timed out waiting for CLI${hint}.`,
            cliLogsTail: extractCliLogsFromRun(run),
          });
          run.onProgress(progress);
          this.cleanupRun(run);
        })();
      }
    }, RUN_TIMEOUT_MS);

    child.once('error', (error) => {
      const hint = run.isLaunch ? ' (launch)' : '';
      const progress = updateProgress(run, 'failed', `Failed to start Claude CLI${hint}`, {
        error: error.message,
        cliLogsTail: extractCliLogsFromRun(run),
      });
      run.onProgress(progress);
      this.cleanupRun(run);
    });

    child.once('exit', (code) => {
      void this.handleProcessExit(run, code);
    });
  }

  /** Attaches the stdout stream-json parser to the current child process. */
  private attachStdoutHandler(run: ProvisioningRun): void {
    const child = run.child;
    if (!child?.stdout) return;

    let stdoutLineBuf = '';
    child.stdout.on('data', (chunk: Buffer) => {
      // Reset generic data timestamp (used for other purposes, not stall detection).
      run.lastDataReceivedAt = Date.now();

      const text = chunk.toString('utf8');
      this.appendCliLogs(run, 'stdout', text);
      run.stdoutBuffer += text;
      if (run.stdoutBuffer.length > STDOUT_RING_LIMIT) {
        run.stdoutBuffer = run.stdoutBuffer.slice(run.stdoutBuffer.length - STDOUT_RING_LIMIT);
      }

      // Parse stream-json lines (newline-delimited JSON)
      stdoutLineBuf += text;
      const lines = stdoutLineBuf.split('\n');
      stdoutLineBuf = lines.pop() ?? '';
      run.stdoutParserCarry = stdoutLineBuf;
      const trimmedCarry = stdoutLineBuf.trim();
      if (!trimmedCarry) {
        run.stdoutParserCarryIsCompleteJson = false;
        run.stdoutParserCarryLooksLikeClaudeJson = false;
      } else {
        try {
          JSON.parse(trimmedCarry);
          run.stdoutParserCarryIsCompleteJson = true;
        } catch {
          run.stdoutParserCarryIsCompleteJson = false;
        }
        run.stdoutParserCarryLooksLikeClaudeJson = looksLikeClaudeStdoutJsonFragment(trimmedCarry);
      }
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const msg = JSON.parse(trimmed) as Record<string, unknown>;
          // Only reset stall timer on messages that represent actual API progress
          // (assistant response or result). System messages like retry attempts
          // (type=system, subtype=attempt) are informational — the CLI is still
          // waiting for the API and the user should see the stall warning.
          const msgType = msg.type;
          if (msgType === 'assistant' || msgType === 'result') {
            run.lastStdoutReceivedAt = Date.now();
            if (run.stallWarningIndex != null) {
              const removedIndex = run.stallWarningIndex;
              run.provisioningOutputParts.splice(removedIndex, 1);
              this.shiftProvisioningOutputIndexesAfterRemoval(run, removedIndex);
              run.stallWarningIndex = null;
              if (run.preStallMessage != null) {
                run.progress.message = run.preStallMessage;
                run.preStallMessage = null;
                delete run.progress.messageSeverity;
              }
            }
          }
          this.handleStreamJsonMessage(run, msg);
        } catch {
          // Not valid JSON — check for auth failure in raw text output
          this.handleAuthFailureInOutput(run, trimmed, 'stdout');
          if (this.hasApiError(trimmed) && !this.isAuthFailureWarning(trimmed, 'stdout')) {
            // Show warning but do NOT kill — the SDK may be retrying internally (e.g. 429 model_cooldown).
            // If all retries fail, result.subtype="error" will catch it and kill then.
            this.emitApiErrorWarning(run, trimmed);
          }
        }
      }

      const currentTs = Date.now();
      if (currentTs - run.lastLogProgressAt >= LOG_PROGRESS_THROTTLE_MS) {
        run.lastLogProgressAt = currentTs;
        emitLogsProgress(run);
      }
    });
  }

  /** Attaches the stderr handler with auth failure detection. */
  private attachStderrHandler(run: ProvisioningRun): void {
    const child = run.child;
    if (!child?.stderr) return;

    child.stderr.on('data', (chunk: Buffer) => {
      // Reset stall watchdog FIRST — any data (even partial JSON) means the CLI is alive.
      run.lastDataReceivedAt = Date.now();
      const text = chunk.toString('utf8');
      this.appendCliLogs(run, 'stderr', text);
      run.stderrBuffer += text;
      if (run.stderrBuffer.length > STDERR_RING_LIMIT) {
        run.stderrBuffer = run.stderrBuffer.slice(run.stderrBuffer.length - STDERR_RING_LIMIT);
      }

      // Detect auth failure early instead of waiting for 5-minute timeout
      this.handleAuthFailureInOutput(run, text, 'stderr');
      if (this.hasApiError(text) && !this.isAuthFailureWarning(text, 'stderr')) {
        // Show warning but do NOT kill — the SDK may be retrying internally (e.g. 429 model_cooldown).
        // If all retries fail, result.subtype="error" will catch it and kill then.
        this.emitApiErrorWarning(run, text);
      }

      const currentTs = Date.now();
      if (currentTs - run.lastLogProgressAt >= LOG_PROGRESS_THROTTLE_MS) {
        run.lastLogProgressAt = currentTs;
        emitLogsProgress(run);
      }
    });
  }

  async createTeam(
    request: TeamCreateRequest,
    onProgress: (progress: TeamProvisioningProgress) => void
  ): Promise<TeamCreateResponse> {
    if (normalizeOptionalTeamProviderId(request.providerId) !== 'opencode') {
      request = this.normalizeClaudeCodeOnlyRequest(request);
    }
    return this.withTeamLock(request.teamName, async () => {
      if (this.isRemoteExecutionTarget(request.executionTarget)) {
        return this.runRemoteTeam(request, onProgress, 'create') as Promise<TeamCreateResponse>;
      }
      return this._createTeamInner(request, onProgress);
    });
  }

  private normalizeClaudeCodeOnlyRequest<T extends TeamCreateRequest | TeamLaunchRequest>(
    request: T
  ): T {
    const rootProviderId = normalizeOptionalTeamProviderId(request.providerId);
    const keepRootModel = !rootProviderId || rootProviderId === 'anthropic';
    const members = 'members' in request ? request.members : undefined;
    return {
      ...request,
      providerId: 'anthropic',
      providerBackendId: undefined,
      model: keepRootModel ? request.model : undefined,
      ...(members
        ? {
            members: members.map((member) => {
              const memberProviderId =
                normalizeOptionalTeamProviderId(member.providerId) ??
                normalizeOptionalTeamProviderId((member as { provider?: unknown }).provider);
              const keepMemberModel = !memberProviderId || memberProviderId === 'anthropic';
              return {
                ...member,
                provider: undefined,
                providerId: 'anthropic',
                providerBackendId: undefined,
                model: keepMemberModel ? member.model : undefined,
                effort: keepMemberModel ? member.effort : undefined,
              };
            }),
          }
        : {}),
    } as T;
  }

  private async writeNativeClaudeLeadConfig(request: TeamCreateRequest): Promise<void> {
    const configPath = path.join(getTeamsBasePath(), request.teamName, 'config.json');
    const config: TeamConfig = {
      name: request.displayName?.trim() || request.teamName,
      description: request.description,
      color: request.color,
      projectPath: request.cwd,
      members: [
        {
          name: CANONICAL_LEAD_MEMBER_NAME,
          role: 'Team Lead',
          agentType: CANONICAL_LEAD_MEMBER_NAME,
          providerId: normalizeOptionalTeamProviderId(request.providerId),
          model: request.model,
          effort: request.effort,
          cwd: request.cwd,
        },
      ],
    };
    await atomicWriteAsync(configPath, `${JSON.stringify(config, null, 2)}\n`);
  }

  private async sendStreamJsonUserPrompt(
    child: ReturnType<typeof spawn>,
    prompt: string,
    teamName: string,
    phase: 'create' | 'launch' | 'retry'
  ): Promise<void> {
    const stdin = child.stdin;
    if (!prompt.trim() || !stdin?.writable) return;
    const payload = JSON.stringify({
      type: 'user',
      message: {
        role: 'user',
        content: [{ type: 'text', text: prompt }],
      },
    });
    await new Promise<void>((resolve, reject) => {
      stdin.write(payload + '\n', (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
    logger.info(`[${teamName}] Sent native Claude bootstrap prompt via stdin (${phase})`);
  }

  private async _createTeamInner(
    request: TeamCreateRequest,
    onProgress: (progress: TeamProvisioningProgress) => void
  ): Promise<TeamCreateResponse> {
    const _t0 = Date.now();
    const _t = (label: string): void => {
      const ms = Date.now() - _t0;
      logger.info(`[${request.teamName}] create-timing: ${ms}ms — ${label}`);
    };

    const existingProvisioningRunId = this.getProvisioningRunId(request.teamName);
    if (existingProvisioningRunId) {
      return { runId: existingProvisioningRunId };
    }
    this.teamSendBlockReasonByTeam.delete(request.teamName);
    const stopAllGenerationAtStart = this.stopAllTeamsGeneration;
    assertAppDeterministicBootstrapEnabled();
    if (this.shouldRouteOpenCodeToRuntimeAdapter(request)) {
      return this.createOpenCodeTeamThroughRuntimeAdapter(request, onProgress);
    }
    assertOpenCodeNotLaunchedThroughLegacyProvisioning(request);

    // Set immediately to prevent TOCTOU (defense in depth alongside withTeamLock)
    const pendingKey = `pending-${randomUUID()}`;
    this.provisioningRunByTeam.set(request.teamName, pendingKey);

    try {
      const teamsBasePathsToProbe = getTeamsBasePathsToProbe();
      for (const probe of teamsBasePathsToProbe) {
        const configPath = path.join(probe.basePath, request.teamName, 'config.json');
        if (await this.pathExists(configPath)) {
          const suffix = probe.location === 'configured' ? '' : ` (found under ${probe.basePath})`;
          throw new Error(`Team already exists${suffix}`);
        }
      }

      await ensureCwdExists(request.cwd);
      await this.skillProjectionService.syncGlobalSkills();

      const claudePath = await ClaudeBinaryResolver.resolve();
      if (!claudePath) {
        throw new Error(CLI_NOT_FOUND_MESSAGE);
      }

      const provisioningEnv = await this.buildProvisioningEnv(
        request.providerId,
        request.providerBackendId
      );
      _t('create:buildProvisioningEnv');
      const {
        env: shellEnv,
        geminiRuntimeAuth,
        providerArgs = [],
        warning: envWarning,
      } = provisioningEnv;
      if (envWarning) {
        throw new Error(envWarning);
      }
      const materializedMemberSpecs = await this.materializeEffectiveTeamMemberSpecs({
        claudePath,
        cwd: request.cwd,
        members: request.members,
        defaults: {
          providerId: request.providerId,
          model: request.model,
          effort: request.effort,
        },
        primaryProviderId: request.providerId,
        primaryEnv: provisioningEnv,
        limitContext: request.limitContext,
      });
      const allEffectiveMemberSpecs = await this.resolveOpenCodeMemberWorkspacesForRuntime({
        teamName: request.teamName,
        baseCwd: request.cwd,
        leadProviderId: request.providerId,
        members: materializedMemberSpecs,
      });
      const lanePlan = this.planRuntimeLanesOrThrow(request.providerId, allEffectiveMemberSpecs);
      const primaryMemberNames = new Set(lanePlan.primaryMembers.map((member) => member.name));
      const effectiveMemberSpecs = allEffectiveMemberSpecs.filter((member) =>
        primaryMemberNames.has(member.name)
      );
      const launchIdentity = await this.resolveAndValidateLaunchIdentity({
        claudePath,
        cwd: request.cwd,
        env: shellEnv,
        request,
        effectiveMembers: effectiveMemberSpecs,
      });
      _t('create:validateLaunchIdentity');
      const runId = randomUUID();
      const startedAt = nowIso();
      const run: ProvisioningRun = {
        runId,
        teamName: request.teamName,
        startedAt,
        stdoutBuffer: '',
        stderrBuffer: '',
        claudeLogLines: [],
        lastClaudeLogStream: null,
        stdoutLogLineBuf: '',
        stderrLogLineBuf: '',
        stdoutParserCarry: '',
        stdoutParserCarryIsCompleteJson: false,
        stdoutParserCarryLooksLikeClaudeJson: false,
        claudeLogsUpdatedAt: undefined,
        processKilled: false,
        finalizingByTimeout: false,
        cancelRequested: false,
        teamsBasePathsToProbe,
        child: null,
        timeoutHandle: null,
        fsMonitorHandle: null,
        onProgress,
        expectedMembers: effectiveMemberSpecs.map((member) => member.name),
        request,
        allEffectiveMembers: allEffectiveMemberSpecs,
        effectiveMembers: effectiveMemberSpecs,
        launchIdentity,
        mixedSecondaryLanes: this.createMixedSecondaryLaneStates(lanePlan),
        lastLogProgressAt: 0,
        lastDataReceivedAt: 0, // intentionally 0 — real reset happens after spawn (see startStallWatchdog call sites)
        lastStdoutReceivedAt: 0,
        stallCheckHandle: null,
        stallWarningIndex: null,
        preStallMessage: null,
        lastRetryAt: 0,
        apiRetryWarningIndex: null,
        apiErrorWarningEmitted: false,
        waitingTasksSince: null,
        provisioningComplete: false,
        mcpConfigPath: null,
        bootstrapSpecPath: null,
        bootstrapUserPromptPath: null,
        isLaunch: false,
        deterministicBootstrap: true,
        fsPhase: 'waiting_config',
        leadRelayCapture: null,
        activeCrossTeamReplyHints: [],
        leadMsgSeq: 0,
        pendingToolCalls: [],
        activeToolCalls: new Map(),
        pendingDirectCrossTeamSendRefresh: false,
        lastLeadTextEmitMs: 0,
        silentUserDmForward: null,
        silentUserDmForwardClearHandle: null,
        pendingInboxRelayCandidates: [],
        provisioningOutputParts: [],
        provisioningOutputIndexByMessageId: new Map(),
        detectedSessionId: null,
        leadActivityState: 'active',
        leadContextUsage: null,
        authFailureRetried: false,
        authRetryInProgress: false,
        spawnContext: null,
        pendingApprovals: new Map(),
        processedPermissionRequestIds: new Set(),
        pendingPostCompactReminder: false,
        postCompactReminderInFlight: false,
        suppressPostCompactReminderOutput: false,
        pendingGeminiPostLaunchHydration: false,
        geminiPostLaunchHydrationInFlight: false,
        geminiPostLaunchHydrationSent: false,
        suppressGeminiPostLaunchHydrationOutput: false,
        memberSpawnStatuses: new Map(
          effectiveMemberSpecs.map((member) => [member.name, createInitialMemberSpawnStatusEntry()])
        ),
        memberSpawnToolUseIds: new Map(),
        pendingMemberRestarts: new Map(),
        memberSpawnLeadInboxCursorByMember: new Map(),
        lastDeterministicBootstrapSeq: 0,
        lastMemberSpawnAuditAt: 0,
        lastMemberSpawnAuditConfigReadWarningAt: 0,
        lastMemberSpawnAuditMissingWarningAt: new Map(),
        progress: {
          runId,
          teamName: request.teamName,
          state: 'validating',
          message: 'Validating team provisioning request',
          startedAt,
          updatedAt: startedAt,
          cliLogsTail: undefined,
        },
      };

      this.resetTeamScopedTransientStateForNewRun(request.teamName);
      this.runs.set(runId, run);
      this.provisioningRunByTeam.set(request.teamName, runId);
      run.onProgress(run.progress);
      await this.clearPersistedLaunchState(request.teamName);

      const initialUserPrompt = request.prompt?.trim() ?? '';
      const [feishuChannels, mcpConfigPathResult, teammateModeDecision] = await Promise.all([
        readBoundFeishuChannels(request.teamName),
        this.mcpConfigBuilder.writeConfigFile(request.cwd),
        resolveDesktopTeammateModeDecision(request.extraCliArgs),
      ]);
      _t('create:parallelPreSpawn');
      const nativeBootstrapPrompt = buildNativeCreateBootstrapPrompt(
        request,
        effectiveMemberSpecs,
        initialUserPrompt,
        feishuChannels
      );
      const promptSize = getPromptSizeSummary(nativeBootstrapPrompt);
      let child: ReturnType<typeof spawn>;
      // Force members to run as independent processes (not in-process sub-agents).
      // Combined with strong sequential prompt instructions, this prevents API rate limiting.
      shellEnv.CLAUDE_TEAM_FORCE_PROCESS_TEAMMATES = '1';
      const mcpConfigPath = mcpConfigPathResult;
      run.mcpConfigPath = mcpConfigPath;
      // Start MCP validation concurrently — we'll await it after spawning the CLI
      // so the CLI can initialize while the MCP server is being validated.
      const mcpValidationPromise = this.validateAgentTeamsMcpRuntime(
        claudePath,
        request.cwd,
        shellEnv,
        mcpConfigPath,
        {
          isCancelled: () =>
            run.cancelRequested ||
            run.processKilled ||
            this.stopAllTeamsGeneration !== stopAllGenerationAtStart,
        }
      ).catch((error: unknown) => (error instanceof Error ? error : new Error(String(error))));
      const launchModelArg = getLaunchModelArg(
        resolveTeamProviderId(request.providerId),
        request.model,
        launchIdentity
      );
      const resolvedProviderId = resolveTeamProviderId(request.providerId);
      const providerFastModeArgs = buildProviderFastModeArgs(
        resolvedProviderId,
        launchIdentity,
        request.skipPermissions
      );
      const spawnArgs = [
        '--print',
        '--input-format',
        'stream-json',
        '--output-format',
        'stream-json',
        '--verbose',
        '--setting-sources',
        'user,project,local',
        '--mcp-config',
        mcpConfigPath,
        '--agents',
        buildAgentTeamsMemberAgentsJson(mcpConfigPath),
        '--disallowedTools',
        APP_TEAM_RUNTIME_DISALLOWED_TOOLS,
        // Explicit --permission-mode overrides user's defaultMode in ~/.claude/settings.json
        // (e.g. "acceptEdits") which otherwise takes precedence over CLI flags
        ...(request.skipPermissions !== false
          ? ['--dangerously-skip-permissions', '--permission-mode', 'bypassPermissions']
          : ['--permission-prompt-tool', 'stdio', '--permission-mode', 'default']),
        ...(launchModelArg ? ['--model', launchModelArg] : []),
        ...(launchIdentity.resolvedEffort ? ['--effort', launchIdentity.resolvedEffort] : []),
        ...providerFastModeArgs,
        ...(request.worktree ? ['--worktree', request.worktree] : []),
        ...parseCliArgs(request.extraCliArgs),
        ...providerArgs,
      ];

      // Create deterministic bootstrap spec file for CLI-level sequential member spawning
      const specDir = path.join(getTeamsBasePath(), request.teamName, '.bootstrap');
      const specPath = path.join(specDir, 'spec.json');
      await fs.promises.mkdir(specDir, { recursive: true });
      const bootstrapSpec = {
        mode: 'create' as const,
        team: { name: request.teamName, cwd: request.cwd },
        members: effectiveMemberSpecs.map((member) => ({
          name: member.name,
          agentType: 'agent-teams-member',
          description: member.role || member.name,
          cwd: member.cwd || request.cwd,
          provider: member.providerId || undefined,
          model: member.model || undefined,
          effort: member.effort || undefined,
          role: member.role || undefined,
          isolation: member.isolation || undefined,
        })),
      };
      await fs.promises.writeFile(specPath, JSON.stringify(bootstrapSpec, null, 2));
      run.bootstrapSpecPath = specPath;
      spawnArgs.push('--team-bootstrap-spec', specPath);

      // Enable deterministic bootstrap for CLI-controlled sequential member spawning
      shellEnv.CLAUDE_ENABLE_DETERMINISTIC_TEAM_BOOTSTRAP = '1';
      shellEnv.CLAUDE_TEAM_FORCE_PROCESS_TEAMMATES = '1';
      const runtimeWarning = buildRuntimeLaunchWarning(request, shellEnv, {
        geminiRuntimeAuth,
        promptSize,
        expectedMembersCount: effectiveMemberSpecs.length,
      });
      logRuntimeLaunchSnapshot(request.teamName, claudePath, spawnArgs, request, shellEnv, {
        geminiRuntimeAuth,
        promptSize,
        expectedMembersCount: effectiveMemberSpecs.length,
        launchIdentity,
      });
      try {
        // Pre-save our meta files before spawn — CLI doesn't touch these.
        // If provisioning fails before TeamCreate, user can retry without re-entering config.
        const teamDir = path.join(getTeamsBasePath(), request.teamName);
        const tasksDir = path.join(getTasksBasePath(), request.teamName);
        await fs.promises.mkdir(teamDir, { recursive: true });
        await fs.promises.mkdir(tasksDir, { recursive: true });
        const membersToWrite = this.buildMembersMetaWritePayload(allEffectiveMemberSpecs);
        await Promise.all([
          this.writeNativeClaudeLeadConfig(request),
          this.teamMetaStore.writeMeta(request.teamName, {
            displayName: request.displayName,
            description: request.description,
            color: request.color,
            cwd: request.cwd,
            executionTarget: request.executionTarget,
            prompt: request.prompt,
            providerId: request.providerId,
            providerBackendId: request.providerBackendId,
            model: request.model,
            effort: request.effort,
            fastMode: request.fastMode,
            skipPermissions: request.skipPermissions,
            worktree: request.worktree,
            extraCliArgs: request.extraCliArgs,
            limitContext: request.limitContext,
            launchIdentity,
            createdAt: Date.now(),
          }),
          this.membersMetaStore.writeMembers(request.teamName, membersToWrite, {
            providerBackendId: request.providerBackendId,
          }),
          ...(request.skipPermissions === false
            ? [this.seedLeadBootstrapPermissionRules(request.teamName, request.cwd)]
            : []),
        ]);
        _t('create:metaWritten');
        if (
          run.cancelRequested ||
          run.processKilled ||
          this.stopAllTeamsGeneration !== stopAllGenerationAtStart
        ) {
          throw new Error('Team launch cancelled by app shutdown');
        }

        child = spawnCli(claudePath, spawnArgs, {
          cwd: request.cwd,
          env: { ...shellEnv },
          stdio: ['pipe', 'pipe', 'pipe'],
        });
        _t('create:cliSpawned');
      } catch (error) {
        // Clean up pre-saved meta files if spawn failed (instant failure, not transient)
        await this.teamMetaStore.deleteMeta(request.teamName).catch(() => {});
        const teamDir = path.join(getTeamsBasePath(), request.teamName);
        const tasksDir = path.join(getTasksBasePath(), request.teamName);
        await fs.promises.rm(teamDir, { recursive: true, force: true }).catch(() => {});
        await fs.promises.rm(tasksDir, { recursive: true, force: true }).catch(() => {});
        await removeDeterministicBootstrapSpecFile(run.bootstrapSpecPath).catch(() => {});
        run.bootstrapSpecPath = null;
        await removeDeterministicBootstrapUserPromptFile(run.bootstrapUserPromptPath).catch(
          () => {}
        );
        run.bootstrapUserPromptPath = null;
        if (run.mcpConfigPath) {
          await this.mcpConfigBuilder.removeConfigFile(run.mcpConfigPath).catch(() => {});
          run.mcpConfigPath = null;
        }
        this.runs.delete(runId);
        this.provisioningRunByTeam.delete(request.teamName);
        throw error;
      }

      updateProgress(run, 'spawning', '正在启动 Claude CLI 进程', {
        pid: child.pid ?? undefined,
        warnings: mergeProvisioningWarnings(run.progress.warnings, runtimeWarning),
      });
      run.onProgress(run.progress);
      run.child = child;
      run.spawnContext = {
        claudePath,
        args: spawnArgs,
        cwd: request.cwd,
        env: { ...shellEnv },
        prompt: nativeBootstrapPrompt,
      };

      this.attachStdoutHandler(run);
      this.attachStderrHandler(run);
      void this.sendStreamJsonUserPrompt(
        child,
        nativeBootstrapPrompt,
        request.teamName,
        'create'
      ).catch((error) => {
        logger.warn(
          `[${request.teamName}] Failed to send native create bootstrap prompt: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      });

      // Reset AFTER spawn — not at run init — because async operations (buildProvisioningEnv,
      // writeConfigFile) between init and spawn can take seconds, causing false stall warnings.
      run.lastDataReceivedAt = Date.now();
      run.lastStdoutReceivedAt = Date.now();
      this.startStallWatchdog(run);

      // Await the MCP validation that was started concurrently before spawn.
      // If validation fails, kill the CLI process and clean up.
      const mcpValidationResult = await mcpValidationPromise;
      _t('mcpValidationDone');
      if (mcpValidationResult instanceof Error) {
        killTeamProcess(child);
        this.runs.delete(runId);
        this.provisioningRunByTeam.delete(request.teamName);
        await removeDeterministicBootstrapSpecFile(run.bootstrapSpecPath).catch(() => {});
        run.bootstrapSpecPath = null;
        await removeDeterministicBootstrapUserPromptFile(run.bootstrapUserPromptPath).catch(
          () => {}
        );
        run.bootstrapUserPromptPath = null;
        throw mcpValidationResult;
      }

      // Filesystem-based progress monitor: actively polls team files instead
      // of relying on stdout (which only arrives at the end in text mode).
      // When config + members + tasks are all present, kill the process early
      // rather than waiting for it to deadlock on system-reminder shutdown.
      updateProgress(run, 'configuring', 'Waiting for team configuration...');
      run.onProgress(run.progress);
      this.startFilesystemMonitor(run, request);

      run.timeoutHandle = setTimeout(() => {
        if (!run.processKilled && !run.provisioningComplete) {
          run.processKilled = true;
          run.finalizingByTimeout = true;
          void (async () => {
            const readyOnTimeout = await this.tryCompleteAfterTimeout(run);
            killTeamProcess(run.child);
            if (readyOnTimeout) {
              return; // cleanupRun already called inside tryCompleteAfterTimeout
            }

            const progress = updateProgress(run, 'failed', 'Timed out waiting for CLI', {
              error:
                'Timed out waiting for CLI. Run `claude` once in terminal to complete onboarding and try again.',
              cliLogsTail: extractCliLogsFromRun(run),
            });
            run.onProgress(progress);
            this.cleanupRun(run);
          })();
        }
      }, RUN_TIMEOUT_MS);

      child.once('error', (error) => {
        const progress = updateProgress(run, 'failed', 'Failed to start Claude CLI', {
          error: error.message,
          cliLogsTail: extractCliLogsFromRun(run),
        });
        run.onProgress(progress);
        this.cleanupRun(run);
      });

      child.once('exit', (code) => {
        void this.handleProcessExit(run, code);
      });

      return { runId };
    } catch (error) {
      // Ensure the per-team lock doesn't get stuck on failures.
      if (this.provisioningRunByTeam.get(request.teamName) === pendingKey) {
        this.provisioningRunByTeam.delete(request.teamName);
      }
      throw error;
    }
  }

  private async createOpenCodeTeamThroughRuntimeAdapter(
    request: TeamCreateRequest,
    onProgress: (progress: TeamProvisioningProgress) => void
  ): Promise<TeamCreateResponse> {
    const teamsBasePathsToProbe = getTeamsBasePathsToProbe();
    for (const probe of teamsBasePathsToProbe) {
      const configPath = path.join(probe.basePath, request.teamName, 'config.json');
      if (await this.pathExists(configPath)) {
        const suffix = probe.location === 'configured' ? '' : ` (found under ${probe.basePath})`;
        throw new Error(`Team already exists${suffix}`);
      }
    }

    await ensureCwdExists(request.cwd);
    await this.skillProjectionService.syncGlobalSkills();
    const effectiveMembers = await this.resolveOpenCodeMemberWorkspacesForRuntime({
      teamName: request.teamName,
      baseCwd: request.cwd,
      leadProviderId: request.providerId,
      members: buildEffectiveTeamMemberSpecs(request.members, {
        providerId: request.providerId,
        model: request.model,
        effort: request.effort,
      }),
    });
    const teamDir = path.join(getTeamsBasePath(), request.teamName);
    const tasksDir = path.join(getTasksBasePath(), request.teamName);
    await fs.promises.mkdir(teamDir, { recursive: true });
    await fs.promises.mkdir(tasksDir, { recursive: true });
    await this.teamMetaStore.writeMeta(request.teamName, {
      displayName: request.displayName,
      description: request.description,
      color: request.color,
      cwd: request.cwd,
      prompt: request.prompt,
      providerId: request.providerId,
      providerBackendId: request.providerBackendId,
      model: request.model,
      effort: request.effort,
      skipPermissions: request.skipPermissions,
      worktree: request.worktree,
      extraCliArgs: request.extraCliArgs,
      limitContext: request.limitContext,
      createdAt: Date.now(),
    });
    const membersToWrite = this.buildMembersMetaWritePayload(effectiveMembers);
    await this.membersMetaStore.writeMembers(request.teamName, membersToWrite, {
      providerBackendId: request.providerBackendId,
    });
    await this.writeOpenCodeTeamConfig(request, effectiveMembers);

    return this.runOpenCodeTeamRuntimeAdapterLaunch({
      request,
      members: effectiveMembers,
      prompt: request.prompt?.trim() ?? '',
      sourceWarning: undefined,
      onProgress,
    });
  }

  private async launchOpenCodeTeamThroughRuntimeAdapter(
    request: TeamLaunchRequest,
    onProgress: (progress: TeamProvisioningProgress) => void
  ): Promise<TeamLaunchResponse> {
    const configPath = path.join(getTeamsBasePath(), request.teamName, 'config.json');
    const configRaw = await tryReadRegularFileUtf8(configPath, {
      timeoutMs: TEAM_JSON_READ_TIMEOUT_MS,
      maxBytes: TEAM_CONFIG_MAX_BYTES,
    });
    if (!configRaw) {
      throw new Error(`Team "${request.teamName}" not found — config.json does not exist`);
    }
    await ensureCwdExists(request.cwd);
    await this.skillProjectionService.syncGlobalSkills();
    const { members, warning } = await this.resolveLaunchExpectedMembers(
      request.teamName,
      configRaw,
      request.providerId
    );
    const effectiveMembers = await this.resolveOpenCodeMemberWorkspacesForRuntime({
      teamName: request.teamName,
      baseCwd: request.cwd,
      leadProviderId: request.providerId,
      members: buildEffectiveTeamMemberSpecs(members, {
        providerId: request.providerId,
        model: request.model,
        effort: request.effort,
      }),
    });
    await this.updateConfigProjectPath(request.teamName, request.cwd);

    let existingTasks: TeamTask[] = [];
    try {
      existingTasks = await new TeamTaskReader().getTasks(request.teamName);
    } catch (error) {
      logger.warn(
        `[${request.teamName}] Failed to read tasks for OpenCode launch prompt: ${String(error)}`
      );
    }
    const feishuChannels1 = await readBoundFeishuChannels(request.teamName);
    const prompt = buildDeterministicLaunchHydrationPrompt(
      request,
      effectiveMembers,
      existingTasks,
      false,
      feishuChannels1
    );

    return this.runOpenCodeTeamRuntimeAdapterLaunch({
      request,
      members: effectiveMembers,
      prompt,
      sourceWarning: warning,
      onProgress,
    });
  }

  private async runOpenCodeTeamRuntimeAdapterLaunch(input: {
    request: TeamCreateRequest | TeamLaunchRequest;
    members: TeamCreateRequest['members'];
    prompt: string;
    sourceWarning?: string;
    onProgress: (progress: TeamProvisioningProgress) => void;
  }): Promise<TeamLaunchResponse> {
    const adapter = this.getOpenCodeRuntimeAdapter();
    if (!adapter) {
      throw new Error('OpenCode runtime adapter is not registered');
    }

    const stopAllGenerationAtStart = this.stopAllTeamsGeneration;
    const previousRuntimeRun = this.runtimeAdapterRunByTeam.get(input.request.teamName);
    if (previousRuntimeRun?.providerId === 'opencode') {
      await this.stopOpenCodeRuntimeAdapterTeam(input.request.teamName, previousRuntimeRun.runId);
    }
    const previousPendingRunId = this.provisioningRunByTeam.get(input.request.teamName);
    const previousRuntimeProgress = previousPendingRunId
      ? this.runtimeAdapterProgressByRunId.get(previousPendingRunId)
      : null;
    if (
      previousPendingRunId &&
      previousRuntimeProgress &&
      this.isCancellableRuntimeAdapterProgress(previousRuntimeProgress)
    ) {
      await this.cancelRuntimeAdapterProvisioning(previousPendingRunId, previousRuntimeProgress);
    }
    if (this.stopAllTeamsGeneration !== stopAllGenerationAtStart) {
      return this.recordCancelledOpenCodeRuntimeAdapterLaunch(
        input.request.teamName,
        input.sourceWarning,
        input.onProgress
      );
    }

    const runId = randomUUID();
    const startedAt = nowIso();
    const initialProgress: TeamProvisioningProgress = {
      runId,
      teamName: input.request.teamName,
      state: 'validating',
      message: 'Validating OpenCode team launch gate',
      startedAt,
      updatedAt: startedAt,
      warnings: input.sourceWarning ? [input.sourceWarning] : undefined,
    };
    this.provisioningRunByTeam.set(input.request.teamName, runId);
    this.setRuntimeAdapterProgress(initialProgress, input.onProgress);
    this.resetTeamScopedTransientStateForNewRun(input.request.teamName);
    const previousLaunchState = await this.launchStateStore.read(input.request.teamName);
    await this.clearPersistedLaunchState(input.request.teamName);
    await migrateLegacyOpenCodeRuntimeState({
      teamsBasePath: getTeamsBasePath(),
      teamName: input.request.teamName,
      laneId: 'primary',
    });
    await upsertOpenCodeRuntimeLaneIndexEntry({
      teamsBasePath: getTeamsBasePath(),
      teamName: input.request.teamName,
      laneId: 'primary',
      state: 'active',
    });
    const launchCwd = this.getOpenCodeRuntimeLaunchCwd(input.request.cwd, input.members);
    const launchInput: TeamRuntimeLaunchInput = {
      runId,
      laneId: 'primary',
      teamName: input.request.teamName,
      cwd: launchCwd,
      prompt: input.prompt,
      providerId: 'opencode',
      model: input.request.model,
      effort: input.request.effort,
      skipPermissions: input.request.skipPermissions !== false,
      expectedMembers: input.members.map((member) => ({
        name: member.name,
        role: member.role,
        workflow: member.workflow,
        isolation: member.isolation === 'worktree' ? ('worktree' as const) : undefined,
        providerId: 'opencode',
        model: member.model ?? input.request.model,
        effort: member.effort ?? input.request.effort,
        cwd: member.cwd?.trim() || launchCwd,
      })),
      previousLaunchState,
    };

    const launching = this.setRuntimeAdapterProgress(
      {
        ...initialProgress,
        state: 'spawning',
        message: 'Starting OpenCode sessions through runtime adapter',
        updatedAt: nowIso(),
      },
      input.onProgress
    );

    try {
      const result = await adapter.launch(launchInput);
      if (
        this.cancelledRuntimeAdapterRunIds.delete(runId) ||
        this.provisioningRunByTeam.get(input.request.teamName) !== runId
      ) {
        await this.clearOpenCodeRuntimeAdapterPrimaryLaneIfOwned(input.request.teamName, runId);
        return { runId };
      }
      await this.persistOpenCodeRuntimeAdapterLaunchResult(result, launchInput);
      const success = result.teamLaunchState === 'clean_success';
      const pending = result.teamLaunchState === 'partial_pending';
      const failed = result.teamLaunchState === 'partial_failure';
      const finalProgress = this.setRuntimeAdapterProgress(
        {
          ...launching,
          state: success || pending ? 'ready' : 'failed',
          message: success
            ? 'OpenCode team launch is ready'
            : pending
              ? 'OpenCode team launch is waiting for runtime evidence or permissions'
              : 'OpenCode team launch failed readiness gate',
          messageSeverity: pending
            ? 'warning'
            : result.teamLaunchState === 'partial_failure'
              ? 'error'
              : undefined,
          updatedAt: nowIso(),
          warnings: result.warnings.length > 0 ? result.warnings : launching.warnings,
          error:
            result.teamLaunchState === 'partial_failure'
              ? result.diagnostics.join('\n') || 'OpenCode launch failed'
              : undefined,
          cliLogsTail: result.diagnostics.join('\n') || undefined,
          configReady: true,
        },
        input.onProgress
      );
      if (failed) {
        await clearOpenCodeRuntimeLaneStorage({
          teamsBasePath: getTeamsBasePath(),
          teamName: input.request.teamName,
          laneId: 'primary',
        }).catch(() => undefined);
        this.runtimeAdapterRunByTeam.delete(input.request.teamName);
        this.aliveRunByTeam.delete(input.request.teamName);
      } else {
        this.runtimeAdapterRunByTeam.set(input.request.teamName, {
          runId,
          providerId: 'opencode',
          cwd: launchCwd,
          members: result.members,
        });
        this.aliveRunByTeam.set(input.request.teamName, runId);
      }
      if (this.provisioningRunByTeam.get(input.request.teamName) === runId) {
        this.provisioningRunByTeam.delete(input.request.teamName);
      }
      this.teamChangeEmitter?.({
        type: 'process',
        teamName: input.request.teamName,
        runId,
        detail: finalProgress.state,
      });
      return { runId };
    } catch (error) {
      if (
        this.cancelledRuntimeAdapterRunIds.delete(runId) ||
        this.provisioningRunByTeam.get(input.request.teamName) !== runId
      ) {
        await this.clearOpenCodeRuntimeAdapterPrimaryLaneIfOwned(input.request.teamName, runId);
        return { runId };
      }
      await clearOpenCodeRuntimeLaneStorage({
        teamsBasePath: getTeamsBasePath(),
        teamName: input.request.teamName,
        laneId: 'primary',
      }).catch(() => undefined);
      const message = error instanceof Error ? error.message : String(error);
      this.setRuntimeAdapterProgress(
        {
          ...launching,
          state: 'failed',
          message: 'OpenCode runtime adapter launch failed',
          messageSeverity: 'error',
          updatedAt: nowIso(),
          error: message,
          cliLogsTail: message,
        },
        input.onProgress
      );
      if (this.provisioningRunByTeam.get(input.request.teamName) === runId) {
        this.provisioningRunByTeam.delete(input.request.teamName);
      }
      throw error;
    }
  }

  private async writeOpenCodeTeamConfig(
    request: TeamCreateRequest,
    members: TeamCreateRequest['members']
  ): Promise<void> {
    const configPath = path.join(getTeamsBasePath(), request.teamName, 'config.json');
    const config: TeamConfig = {
      name: request.displayName?.trim() || request.teamName,
      description: request.description,
      color: request.color,
      projectPath: request.cwd,
      members: [
        {
          name: CANONICAL_LEAD_MEMBER_NAME,
          role: 'Team Lead',
          agentType: CANONICAL_LEAD_MEMBER_NAME,
          providerId: normalizeOptionalTeamProviderId(request.providerId),
          model: request.model,
          effort: request.effort,
          cwd: request.cwd,
        },
        ...members.map((member) => ({
          name: member.name,
          role: member.role,
          workflow: member.workflow,
          isolation: member.isolation === 'worktree' ? ('worktree' as const) : undefined,
          providerId: normalizeOptionalTeamProviderId(member.providerId),
          model: member.model,
          effort: member.effort,
          cwd: member.cwd?.trim() || undefined,
        })),
      ],
    };
    await atomicWriteAsync(configPath, `${JSON.stringify(config, null, 2)}\n`);
  }

  private async persistOpenCodeRuntimeAdapterLaunchResult(
    result: TeamRuntimeLaunchResult,
    input: TeamRuntimeLaunchInput
  ): Promise<PersistedTeamLaunchSnapshot> {
    const members: Record<string, PersistedTeamLaunchMemberState> = {};
    for (const member of input.expectedMembers) {
      const evidence = result.members[member.name];
      members[member.name] = this.toOpenCodePersistedLaunchMember(member, evidence);
    }
    const snapshot = createPersistedLaunchSnapshot({
      teamName: input.teamName,
      expectedMembers: input.expectedMembers.map((member) => member.name),
      bootstrapExpectedMembers: input.expectedMembers.map((member) => member.name),
      leadSessionId: result.leadSessionId,
      launchPhase: result.launchPhase,
      members,
    });
    await this.launchStateStore.write(input.teamName, snapshot);
    return snapshot;
  }

  private toOpenCodePersistedLaunchMember(
    member: TeamRuntimeLaunchInput['expectedMembers'][number],
    evidence: TeamRuntimeMemberLaunchEvidence | undefined
  ): PersistedTeamLaunchMemberState {
    const now = nowIso();
    const launchState = evidence?.launchState ?? 'failed_to_start';
    return {
      name: member.name,
      providerId: 'opencode',
      providerBackendId: undefined,
      model: member.model?.trim() || undefined,
      effort: member.effort,
      cwd: member.cwd?.trim() || undefined,
      laneId: 'primary',
      laneKind: 'primary',
      laneOwnerProviderId: 'opencode',
      launchState,
      agentToolAccepted: evidence?.agentToolAccepted === true,
      runtimeAlive: evidence?.runtimeAlive === true,
      bootstrapConfirmed: evidence?.bootstrapConfirmed === true,
      hardFailure: evidence?.hardFailure === true || launchState === 'failed_to_start',
      hardFailureReason: evidence?.hardFailureReason,
      pendingPermissionRequestIds: evidence?.pendingPermissionRequestIds?.length
        ? [...new Set(evidence.pendingPermissionRequestIds)]
        : undefined,
      ...(evidence?.runtimePid ? { runtimePid: evidence.runtimePid } : {}),
      ...(evidence?.sessionId ? { runtimeSessionId: evidence.sessionId } : {}),
      ...(evidence?.livenessKind ? { livenessKind: evidence.livenessKind } : {}),
      ...(evidence?.pidSource ? { pidSource: evidence.pidSource } : {}),
      ...(evidence?.runtimeDiagnostic ? { runtimeDiagnostic: evidence.runtimeDiagnostic } : {}),
      ...(evidence?.runtimeDiagnostic ? { runtimeDiagnosticSeverity: 'info' as const } : {}),
      ...(evidence?.runtimeAlive ? { runtimeLastSeenAt: now } : {}),
      firstSpawnAcceptedAt: evidence?.agentToolAccepted ? now : undefined,
      lastHeartbeatAt: evidence?.bootstrapConfirmed ? now : undefined,
      lastRuntimeAliveAt: evidence?.runtimeAlive ? now : undefined,
      lastEvaluatedAt: now,
      sources: {
        processAlive: evidence?.runtimeAlive === true,
        nativeHeartbeat: evidence?.bootstrapConfirmed === true,
      },
      diagnostics: evidence?.diagnostics,
    };
  }

  async launchTeam(
    request: TeamLaunchRequest,
    onProgress: (progress: TeamProvisioningProgress) => void
  ): Promise<TeamLaunchResponse> {
    request = this.normalizeClaudeCodeOnlyRequest(request);
    return this.withTeamLock(request.teamName, async () => {
      if (this.isRemoteExecutionTarget(request.executionTarget)) {
        return this.runRemoteTeam(request, onProgress, 'launch') as Promise<TeamLaunchResponse>;
      }
      return this._launchTeamInner(request, onProgress);
    });
  }

  private async _launchTeamInner(
    request: TeamLaunchRequest,
    onProgress: (progress: TeamProvisioningProgress) => void
  ): Promise<TeamLaunchResponse> {
    const existingProvisioningRunId = this.getProvisioningRunId(request.teamName);
    if (existingProvisioningRunId) {
      return { runId: existingProvisioningRunId };
    }
    this.teamSendBlockReasonByTeam.delete(request.teamName);
    const stopAllGenerationAtStart = this.stopAllTeamsGeneration;
    assertAppDeterministicBootstrapEnabled();
    if (this.shouldRouteOpenCodeToRuntimeAdapter(request)) {
      return this.launchOpenCodeTeamThroughRuntimeAdapter(request, onProgress);
    }
    assertOpenCodeNotLaunchedThroughLegacyProvisioning(request);

    // Set immediately to prevent TOCTOU (defense in depth alongside withTeamLock)
    const pendingKey = `pending-${randomUUID()}`;
    this.provisioningRunByTeam.set(request.teamName, pendingKey);

    try {
      const _t0 = Date.now();
      const _t = (label: string): void => {
        const ms = Date.now() - _t0;
        logger.info(`[${request.teamName}] launch-timing: ${ms}ms — ${label}`);
      };

      // Phase 1: Read config and resolve members in parallel with binary + env resolution
      const configPath = path.join(getTeamsBasePath(), request.teamName, 'config.json');
      const [configRawResult, binaryResult, envResult] = await Promise.all([
        tryReadRegularFileUtf8(configPath, {
          timeoutMs: TEAM_JSON_READ_TIMEOUT_MS,
          maxBytes: TEAM_CONFIG_MAX_BYTES,
        }),
        ClaudeBinaryResolver.resolve().then((p) => {
          _t('binaryResolved');
          return p;
        }),
        this.buildProvisioningEnv(request.providerId, request.providerBackendId).then((e) => {
          _t('buildProvisioningEnv');
          return e;
        }),
      ]);
      const configRaw = configRawResult;
      if (!configRaw) {
        throw new Error(`Team "${request.teamName}" not found — config.json does not exist`);
      }
      const claudePath = binaryResult;
      if (!claudePath) {
        throw new Error(CLI_NOT_FOUND_MESSAGE);
      }
      const provisioningEnv = envResult;
      let configProjectPath: string | null = null;
      try {
        const parsedConfig = JSON.parse(configRaw) as { projectPath?: unknown };
        configProjectPath =
          typeof parsedConfig.projectPath === 'string' && parsedConfig.projectPath.trim().length > 0
            ? path.resolve(parsedConfig.projectPath.trim())
            : null;
      } catch {
        configProjectPath = null;
      }

      const existingAliveRunId = this.getAliveRunId(request.teamName);
      if (existingAliveRunId) {
        const existingRun = this.runs.get(existingAliveRunId);
        const requestedCwd = path.resolve(request.cwd);
        const existingRunCwd = this.getRunTrackedCwd(existingRun) ?? configProjectPath;
        if (existingRun?.child && !existingRun.processKilled && !existingRun.cancelRequested) {
          if (!existingRunCwd) {
            this.provisioningRunByTeam.delete(request.teamName);
            throw new Error(
              `Team "${request.teamName}" is already running, but its cwd could not be determined. ` +
                'Stop it before launching again.'
            );
          }
          if (existingRunCwd && existingRunCwd !== requestedCwd) {
            this.provisioningRunByTeam.delete(request.teamName);
            throw new Error(
              `Team "${request.teamName}" is already running in "${existingRunCwd}". ` +
                `Stop it before launching with cwd "${request.cwd}".`
            );
          }
          this.provisioningRunByTeam.delete(request.teamName);
          return { runId: existingAliveRunId };
        }
      }

      const [membersResult, persistedLaunchState] = await Promise.all([
        this.resolveLaunchExpectedMembers(request.teamName, configRaw, request.providerId),
        request.clearContext
          ? Promise.resolve(null)
          : this.launchStateStore.read(request.teamName).catch(() => null),
      ]);
      const { members: expectedMemberSpecs, source, warning } = membersResult;
      _t('resolveLaunchExpectedMembers+launchState');
      assertOpenCodeNotLaunchedThroughLegacyProvisioning({
        providerId: request.providerId,
        members: expectedMemberSpecs,
      });
      // Extract leadSessionId for session resume on reconnect.
      // If a valid JSONL file exists for the previous session, we can resume it
      // so the lead retains full context of prior work.
      // When clearContext is true, skip resume entirely to start a fresh session.
      let previousSessionId: string | undefined;
      let skipResume = false;
      if (request.clearContext) {
        skipResume = true;
        logger.info(
          `[${request.teamName}] clearContext requested — skipping session resume, starting fresh`
        );
      } else {
        // Check persisted launch state: if the previous launch ended with no teammates
        // ever spawned (all in 'starting' state), resuming would reconnect the lead but
        // the CLI's deterministic bootstrap won't re-spawn dead teammates in reconnect
        // mode. Skip resume so the CLI creates a fresh session that fully bootstraps.
        if (persistedLaunchState) {
          const {
            expectedMembers: prevExpected,
            members: prevMembers,
            launchPhase,
          } = persistedLaunchState;
          const teammateWasNeverSpawned = (
            member:
              | {
                  agentToolAccepted?: boolean;
                  firstSpawnAcceptedAt?: string;
                  runtimeAlive?: boolean;
                  bootstrapConfirmed?: boolean;
                }
              | undefined
          ): boolean => {
            if (!member) return true;
            const hasAcceptedSpawn =
              member.agentToolAccepted === true ||
              (typeof member.firstSpawnAcceptedAt === 'string' &&
                member.firstSpawnAcceptedAt.trim().length > 0);
            return (
              !hasAcceptedSpawn &&
              member.runtimeAlive !== true &&
              member.bootstrapConfirmed !== true
            );
          };
          const allTeammatesNeverSpawned =
            launchPhase !== 'active' &&
            prevExpected.length > 0 &&
            prevExpected.every((name) => teammateWasNeverSpawned(prevMembers[name]));
          if (allTeammatesNeverSpawned) {
            skipResume = true;
            logger.info(
              `[${request.teamName}] Previous launch had no teammates successfully spawned — ` +
                `skipping session resume to allow full bootstrap`
            );
          }
        }
      }
      if (!skipResume) {
        try {
          const configParsed = JSON.parse(configRaw) as Record<string, unknown>;
          const persistedTeamMeta = await this.teamMetaStore
            .getMeta(request.teamName)
            .catch(() => null);
          const resumeGuard = shouldSkipResumeForProviderRuntimeChange(
            request,
            configParsed,
            persistedTeamMeta?.providerBackendId ?? null
          );
          if (resumeGuard.skip) {
            logger.info(
              `[${request.teamName}] Skipping session resume — ${resumeGuard.reason ?? 'runtime changed'}`
            );
          } else if (
            typeof configParsed.leadSessionId === 'string' &&
            configParsed.leadSessionId.trim().length > 0
          ) {
            const candidateId = configParsed.leadSessionId.trim();
            const storedProjectPath =
              typeof configParsed.projectPath === 'string' &&
              configParsed.projectPath.trim().length > 0
                ? configParsed.projectPath.trim()
                : null;

            // Sessions are stored per-project (~/.claude/projects/{encodePath(cwd)}/).
            // If the project path changed, the old session JSONL won't be found by the CLI
            // at the new project directory. Skip resume to avoid passing an invalid --resume arg.
            if (
              storedProjectPath &&
              path.resolve(storedProjectPath) !== path.resolve(request.cwd)
            ) {
              logger.info(
                `[${request.teamName}] Project path changed: ${storedProjectPath} → ${request.cwd}. ` +
                  `Skipping session resume — sessions are per-project.`
              );
            } else {
              const resumeProjectPath = storedProjectPath ?? request.cwd;
              const projectId = encodePath(resumeProjectPath);
              const baseDir = extractBaseDir(projectId);
              const jsonlPath = path.join(getProjectsBasePath(), baseDir, `${candidateId}.jsonl`);
              if (await this.pathExists(jsonlPath)) {
                previousSessionId = candidateId;
                logger.info(
                  `[${request.teamName}] Found previous session JSONL for resume: ${candidateId}`
                );
              } else {
                logger.info(
                  `[${request.teamName}] Previous session JSONL not found at ${jsonlPath}, starting fresh`
                );
              }
            }
          }
        } catch {
          logger.debug(
            `[${request.teamName}] Failed to extract leadSessionId from config for resume`
          );
        }
      }

      // IMPORTANT: The CLI auto-suffixes teammate names when they already exist in config.json.
      // Normalize config.json to keep only the lead before spawning the CLI, so we get stable names.
      try {
        await this.normalizeTeamConfigForLaunch(request.teamName, configRaw);
        await this.assertConfigLeadOnlyForLaunch(request.teamName);

        // Update projectPath in config IMMEDIATELY so TeamDetailView shows the correct path
        // even if provisioning is interrupted or the user stops the team early.
        // If launch fails, restorePrelaunchConfig() will revert to the backup (old projectPath).
        await this.updateConfigProjectPath(request.teamName, request.cwd);
        _t('configNormalized');
      } catch (error) {
        // Restore pre-launch backup so config.json is not left in normalized (lead-only) state.
        await this.restorePrelaunchConfig(request.teamName);
        throw error;
      }

      await ensureCwdExists(request.cwd);
      await this.skillProjectionService.syncGlobalSkills();

      const teamsBasePathsToProbe = getTeamsBasePathsToProbe();
      const runId = randomUUID();
      const startedAt = nowIso();

      const {
        env: shellEnv,
        geminiRuntimeAuth,
        providerArgs = [],
        warning: envWarning,
      } = provisioningEnv;
      if (envWarning) {
        throw new Error(envWarning);
      }

      const materializedMemberSpecs = await this.materializeEffectiveTeamMemberSpecs({
        claudePath,
        cwd: request.cwd,
        members: expectedMemberSpecs,
        defaults: {
          providerId: request.providerId,
          model: request.model,
          effort: request.effort,
        },
        primaryProviderId: request.providerId,
        primaryEnv: provisioningEnv,
        limitContext: request.limitContext,
      });
      _t('materializeMembers');
      const allEffectiveMemberSpecs = await this.resolveOpenCodeMemberWorkspacesForRuntime({
        teamName: request.teamName,
        baseCwd: request.cwd,
        leadProviderId: request.providerId,
        members: materializedMemberSpecs,
      });
      const lanePlan = this.planRuntimeLanesOrThrow(request.providerId, allEffectiveMemberSpecs);
      const primaryMemberNames = new Set(lanePlan.primaryMembers.map((member) => member.name));
      const effectiveMemberSpecs = allEffectiveMemberSpecs.filter((member) =>
        primaryMemberNames.has(member.name)
      );
      const expectedMembers = effectiveMemberSpecs.map((member) => member.name);
      const launchIdentity = await this.resolveAndValidateLaunchIdentity({
        claudePath,
        cwd: request.cwd,
        env: shellEnv,
        request,
        effectiveMembers: effectiveMemberSpecs,
      });
      _t('validateLaunchIdentity');

      // Build a synthetic TeamCreateRequest for reuse by shared infrastructure
      const syntheticRequest: TeamCreateRequest = {
        teamName: request.teamName,
        members: allEffectiveMemberSpecs,
        cwd: request.cwd,
        executionTarget: request.executionTarget,
        providerId: request.providerId,
        providerBackendId: request.providerBackendId,
        model: request.model,
        effort: request.effort,
        fastMode: request.fastMode,
        skipPermissions: request.skipPermissions,
      };

      // Enrich with color/displayName from config.json (always available for launched teams)
      try {
        const cfg = JSON.parse(configRaw) as Record<string, unknown>;
        if (typeof cfg.color === 'string' && cfg.color.trim().length > 0) {
          syntheticRequest.color = cfg.color.trim();
        }
        if (typeof cfg.name === 'string' && cfg.name.trim().length > 0) {
          syntheticRequest.displayName = cfg.name.trim();
        }
      } catch {
        // config already validated above — ignore parse errors here
      }

      const run: ProvisioningRun = {
        runId,
        teamName: request.teamName,
        startedAt,
        stdoutBuffer: '',
        stderrBuffer: '',
        claudeLogLines: [],
        lastClaudeLogStream: null,
        stdoutLogLineBuf: '',
        stderrLogLineBuf: '',
        stdoutParserCarry: '',
        stdoutParserCarryIsCompleteJson: false,
        stdoutParserCarryLooksLikeClaudeJson: false,
        claudeLogsUpdatedAt: undefined,
        processKilled: false,
        finalizingByTimeout: false,
        cancelRequested: false,
        teamsBasePathsToProbe,
        child: null,
        timeoutHandle: null,
        fsMonitorHandle: null,
        onProgress,
        expectedMembers,
        request: syntheticRequest,
        allEffectiveMembers: allEffectiveMemberSpecs,
        effectiveMembers: effectiveMemberSpecs,
        launchIdentity,
        mixedSecondaryLanes: this.createMixedSecondaryLaneStates(lanePlan),
        lastLogProgressAt: 0,
        lastDataReceivedAt: 0, // intentionally 0 — real reset happens after spawn (see startStallWatchdog call sites)
        lastStdoutReceivedAt: 0,
        stallCheckHandle: null,
        stallWarningIndex: null,
        preStallMessage: null,
        lastRetryAt: 0,
        apiRetryWarningIndex: null,
        apiErrorWarningEmitted: false,
        waitingTasksSince: null,
        provisioningComplete: false,
        mcpConfigPath: null,
        bootstrapSpecPath: null,
        bootstrapUserPromptPath: null,
        isLaunch: true,
        deterministicBootstrap: true,
        fsPhase: 'waiting_members',
        leadRelayCapture: null,
        activeCrossTeamReplyHints: [],
        leadMsgSeq: 0,
        pendingToolCalls: [],
        activeToolCalls: new Map(),
        pendingDirectCrossTeamSendRefresh: false,
        lastLeadTextEmitMs: 0,
        silentUserDmForward: null,
        silentUserDmForwardClearHandle: null,
        pendingInboxRelayCandidates: [],
        provisioningOutputParts: [],
        provisioningOutputIndexByMessageId: new Map(),
        detectedSessionId: previousSessionId ?? null,
        leadActivityState: 'active',
        leadContextUsage: null,
        authFailureRetried: false,
        authRetryInProgress: false,
        spawnContext: null,
        pendingApprovals: new Map(),
        processedPermissionRequestIds: new Set(),
        pendingPostCompactReminder: false,
        postCompactReminderInFlight: false,
        suppressPostCompactReminderOutput: false,
        pendingGeminiPostLaunchHydration: false,
        geminiPostLaunchHydrationInFlight: false,
        geminiPostLaunchHydrationSent: false,
        suppressGeminiPostLaunchHydrationOutput: false,
        memberSpawnStatuses: new Map(
          expectedMembers.map((name) => [name, createInitialMemberSpawnStatusEntry()])
        ),
        memberSpawnToolUseIds: new Map(),
        pendingMemberRestarts: new Map(),
        memberSpawnLeadInboxCursorByMember: new Map(),
        lastDeterministicBootstrapSeq: 0,
        lastMemberSpawnAuditAt: 0,
        lastMemberSpawnAuditConfigReadWarningAt: 0,
        lastMemberSpawnAuditMissingWarningAt: new Map(),
        progress: {
          runId,
          teamName: request.teamName,
          state: 'validating',
          message:
            source === 'members-meta'
              ? 'Validating team launch request (members from members.meta.json)'
              : source === 'inboxes'
                ? 'Validating team launch request (members from inboxes)'
                : 'Validating team launch request (fallback members from config.json)',
          startedAt,
          updatedAt: startedAt,
          warnings: warning ? [warning] : undefined,
          cliLogsTail: undefined,
        },
      };

      this.resetTeamScopedTransientStateForNewRun(request.teamName);
      this.runs.set(runId, run);
      this.provisioningRunByTeam.set(request.teamName, runId);
      run.onProgress(run.progress);
      await this.clearPersistedLaunchState(request.teamName);
      for (const lane of run.mixedSecondaryLanes ?? []) {
        await this.publishMixedSecondaryLaneStatusChange(run, lane);
      }

      // Parallelize independent pre-spawn operations to reduce launch latency
      const [existingTasksResult, feishuChannels2, mcpConfigPathResult, teammateModeDecision] =
        await Promise.all([
          // Read existing tasks for teammate work resumption prompts
          new Promise<TeamTask[]>((resolve) => {
            const taskReader = new TeamTaskReader();
            taskReader
              .getTasks(request.teamName)
              .then(resolve)
              .catch((error: unknown) => {
                logger.warn(
                  `[${request.teamName}] Failed to read tasks for launch prompt: ${String(error)}`
                );
                resolve([]);
              });
          }),
          // Read bound Feishu channel credentials
          readBoundFeishuChannels(request.teamName),
          // Write MCP config file
          this.mcpConfigBuilder.writeConfigFile(request.cwd),
          // Resolve teammate mode (tmux check)
          resolveDesktopTeammateModeDecision(request.extraCliArgs),
        ]);
      _t('parallelPreSpawn (tasks+feishu+mcp+tmux)');
      const existingTasks = existingTasksResult;
      const prompt = buildDeterministicLaunchHydrationPrompt(
        request,
        effectiveMemberSpecs,
        existingTasks,
        Boolean(previousSessionId),
        feishuChannels2
      );
      const promptSize = getPromptSizeSummary(prompt);
      let child: ReturnType<typeof spawn>;
      // Force members to run as independent processes (not in-process sub-agents).
      shellEnv.CLAUDE_TEAM_FORCE_PROCESS_TEAMMATES = '1';
      const mcpConfigPath = mcpConfigPathResult;
      run.mcpConfigPath = mcpConfigPath;
      // Start MCP validation concurrently — we'll await it after spawning the CLI
      const mcpValidationPromise = this.validateAgentTeamsMcpRuntime(
        claudePath,
        request.cwd,
        shellEnv,
        mcpConfigPath,
        {
          isCancelled: () =>
            run.cancelRequested ||
            run.processKilled ||
            this.stopAllTeamsGeneration !== stopAllGenerationAtStart,
        }
      ).catch((error: unknown) => (error instanceof Error ? error : new Error(String(error))));
      const launchArgs = [
        '--print',
        '--input-format',
        'stream-json',
        '--output-format',
        'stream-json',
        '--verbose',
        '--setting-sources',
        'user,project,local',
        '--mcp-config',
        mcpConfigPath,
        '--agents',
        buildAgentTeamsMemberAgentsJson(mcpConfigPath),
        '--disallowedTools',
        APP_TEAM_RUNTIME_DISALLOWED_TOOLS,
        // Explicit --permission-mode overrides user's defaultMode in ~/.claude/settings.json
        // (e.g. "acceptEdits") which otherwise takes precedence over CLI flags
        ...(request.skipPermissions !== false
          ? ['--dangerously-skip-permissions', '--permission-mode', 'bypassPermissions']
          : ['--permission-prompt-tool', 'stdio', '--permission-mode', 'default']),
      ];
      if (previousSessionId) {
        launchArgs.push('--resume', previousSessionId);
        logger.info(
          `[${request.teamName}] Launching with --resume ${previousSessionId} for session continuity`
        );
      }
      const launchModelArg = getLaunchModelArg(
        resolveTeamProviderId(request.providerId),
        request.model,
        launchIdentity
      );
      const resolvedProviderId = resolveTeamProviderId(request.providerId);
      const providerFastModeArgs = buildProviderFastModeArgs(
        resolvedProviderId,
        launchIdentity,
        request.skipPermissions
      );
      if (launchModelArg) {
        launchArgs.push('--model', launchModelArg);
      }
      if (launchIdentity.resolvedEffort) {
        launchArgs.push('--effort', launchIdentity.resolvedEffort);
      }
      launchArgs.push(...providerFastModeArgs);
      if (request.worktree) {
        launchArgs.push('--worktree', request.worktree);
      }
      launchArgs.push(...parseCliArgs(request.extraCliArgs));
      launchArgs.push(...providerArgs);
      const runtimeWarning = buildRuntimeLaunchWarning(request, shellEnv, {
        geminiRuntimeAuth,
        promptSize,
        expectedMembersCount: effectiveMemberSpecs.length,
      });
      logRuntimeLaunchSnapshot(request.teamName, claudePath, launchArgs, request, shellEnv, {
        geminiRuntimeAuth,
        promptSize,
        expectedMembersCount: effectiveMemberSpecs.length,
        launchIdentity,
      });
      // --resume is added above when a valid previous session JSONL exists.
      // Without it, CLI creates a fresh session ID automatically.
      await Promise.all([
        this.teamMetaStore.writeMeta(request.teamName, {
          displayName: syntheticRequest.displayName,
          description: syntheticRequest.description,
          color: syntheticRequest.color,
          cwd: request.cwd,
          executionTarget: request.executionTarget,
          prompt: request.prompt,
          providerId: request.providerId,
          providerBackendId: request.providerBackendId,
          model: request.model,
          effort: syntheticRequest.effort,
          fastMode: syntheticRequest.fastMode,
          skipPermissions: syntheticRequest.skipPermissions,
          worktree: syntheticRequest.worktree,
          extraCliArgs: syntheticRequest.extraCliArgs,
          limitContext: syntheticRequest.limitContext,
          launchIdentity,
          createdAt: Date.now(),
        }),
        this.membersMetaStore.writeMembers(
          request.teamName,
          this.buildMembersMetaWritePayload(allEffectiveMemberSpecs),
          {
            providerBackendId: request.providerBackendId,
          }
        ),
        ...(request.skipPermissions === false
          ? [this.seedLeadBootstrapPermissionRules(request.teamName, request.cwd)]
          : []),
      ]);
      _t('metaWritten');

      try {
        if (
          run.cancelRequested ||
          run.processKilled ||
          this.stopAllTeamsGeneration !== stopAllGenerationAtStart
        ) {
          throw new Error('Team launch cancelled by app shutdown');
        }
        child = spawnCli(claudePath, launchArgs, {
          cwd: request.cwd,
          env: { ...shellEnv },
          stdio: ['pipe', 'pipe', 'pipe'],
        });
        _t('cliSpawned');
      } catch (error) {
        if (run.mcpConfigPath) {
          await this.mcpConfigBuilder.removeConfigFile(run.mcpConfigPath).catch(() => {});
          run.mcpConfigPath = null;
        }
        await removeDeterministicBootstrapSpecFile(run.bootstrapSpecPath).catch(() => {});
        run.bootstrapSpecPath = null;
        await removeDeterministicBootstrapUserPromptFile(run.bootstrapUserPromptPath).catch(
          () => {}
        );
        run.bootstrapUserPromptPath = null;
        this.runs.delete(runId);
        this.provisioningRunByTeam.delete(request.teamName);
        await this.restorePrelaunchConfig(request.teamName);
        throw error;
      }

      const resumeHint = previousSessionId ? '（正在恢复上次会话）' : '';
      updateProgress(run, 'spawning', `正在为团队启动 Claude CLI 进程${resumeHint}`, {
        pid: child.pid ?? undefined,
        warnings: mergeProvisioningWarnings(run.progress.warnings, runtimeWarning),
      });
      run.onProgress(run.progress);
      run.child = child;
      run.spawnContext = {
        claudePath,
        args: launchArgs,
        cwd: request.cwd,
        env: { ...shellEnv },
        prompt,
      };

      this.attachStdoutHandler(run);
      this.attachStderrHandler(run);
      void this.sendStreamJsonUserPrompt(child, prompt, request.teamName, 'launch').catch(
        (error) => {
          logger.warn(
            `[${request.teamName}] Failed to send native launch bootstrap prompt: ${
              error instanceof Error ? error.message : String(error)
            }`
          );
        }
      );

      // Reset AFTER spawn — not at run init — because async operations between init
      // and spawn can take seconds, causing false stall warnings.
      run.lastDataReceivedAt = Date.now();
      run.lastStdoutReceivedAt = Date.now();
      this.startStallWatchdog(run);

      // Await the MCP validation that was started concurrently before spawn.
      // If validation fails, kill the CLI process and clean up.
      const mcpValidationResult = await mcpValidationPromise;
      _t('mcpValidationDone');
      if (mcpValidationResult instanceof Error) {
        killTeamProcess(child);
        this.runs.delete(runId);
        this.provisioningRunByTeam.delete(request.teamName);
        await removeDeterministicBootstrapSpecFile(run.bootstrapSpecPath).catch(() => {});
        run.bootstrapSpecPath = null;
        await removeDeterministicBootstrapUserPromptFile(run.bootstrapUserPromptPath).catch(
          () => {}
        );
        run.bootstrapUserPromptPath = null;
        await this.restorePrelaunchConfig(request.teamName);
        throw mcpValidationResult;
      }

      // For launch, skip the filesystem monitor — files (config, inboxes, tasks)
      // already exist from the previous run and would trigger immediate false
      // completion on the first poll. Rely on stream-json result.success instead.
      updateProgress(run, 'configuring', 'CLI running — deterministic reconnect in progress');
      run.onProgress(run.progress);

      run.timeoutHandle = setTimeout(() => {
        if (!run.processKilled && !run.provisioningComplete) {
          run.processKilled = true;
          run.finalizingByTimeout = true;
          void (async () => {
            const readyOnTimeout = await this.tryCompleteAfterTimeout(run);
            killTeamProcess(run.child);
            if (readyOnTimeout) {
              return;
            }

            const progress = updateProgress(run, 'failed', 'Timed out waiting for CLI (launch)', {
              error: 'Timed out waiting for CLI during team launch.',
              cliLogsTail: extractCliLogsFromRun(run),
            });
            run.onProgress(progress);
            this.cleanupRun(run);
          })();
        }
      }, RUN_TIMEOUT_MS);

      child.once('error', (error) => {
        const progress = updateProgress(run, 'failed', 'Failed to start Claude CLI (launch)', {
          error: error.message,
          cliLogsTail: extractCliLogsFromRun(run),
        });
        run.onProgress(progress);
        this.cleanupRun(run);
      });

      child.once('exit', (code) => {
        void this.handleProcessExit(run, code);
      });

      return { runId };
    } catch (error) {
      // Clean up pending key if failure occurred before runId was set
      if (this.provisioningRunByTeam.get(request.teamName) === pendingKey) {
        this.provisioningRunByTeam.delete(request.teamName);
      }
      throw error;
    }
  }

  async getProvisioningStatus(runId: string): Promise<TeamProvisioningProgress> {
    const run = this.runs.get(runId);
    if (run) {
      return run.progress;
    }
    const runtimeProgress = this.runtimeAdapterProgressByRunId.get(runId);
    if (runtimeProgress) {
      return runtimeProgress;
    }
    throw new Error('Unknown runId');
  }

  async cancelProvisioning(runId: string): Promise<void> {
    const run = this.runs.get(runId);
    if (!run) {
      const runtimeProgress = this.runtimeAdapterProgressByRunId.get(runId);
      if (runtimeProgress) {
        await this.cancelRuntimeAdapterProvisioning(runId, runtimeProgress);
        return;
      }
      throw new Error('Unknown runId');
    }
    if (
      !['spawning', 'configuring', 'assembling', 'finalizing', 'verifying'].includes(
        run.progress.state
      )
    ) {
      throw new Error('Provisioning cannot be cancelled in current state');
    }

    run.cancelRequested = true;
    run.processKilled = true;
    // SIGKILL: newer Claude CLI versions handle SIGTERM gracefully and delete
    // team files during cleanup. SIGKILL is uncatchable — files are preserved.
    killTeamProcess(run.child);
    if (
      this.getTrackedRunId(run.teamName) === run.runId &&
      this.hasSecondaryRuntimeRuns(run.teamName)
    ) {
      void this.stopMixedSecondaryRuntimeLanes(run.teamName);
    }
    const progress = updateProgress(run, 'cancelled', 'Provisioning cancelled by user');
    run.onProgress(progress);
    this.cleanupRun(run);
  }

  private isCancellableRuntimeAdapterProgress(progress: TeamProvisioningProgress): boolean {
    return [
      'validating',
      'spawning',
      'configuring',
      'assembling',
      'finalizing',
      'verifying',
    ].includes(progress.state);
  }

  private async cancelRuntimeAdapterProvisioning(
    runId: string,
    runtimeProgress: TeamProvisioningProgress
  ): Promise<void> {
    if (!this.isCancellableRuntimeAdapterProgress(runtimeProgress)) {
      throw new Error('Provisioning cannot be cancelled in current state');
    }

    const teamName = runtimeProgress.teamName;
    const runtimeRun = this.runtimeAdapterRunByTeam.get(teamName);
    this.cancelledRuntimeAdapterRunIds.add(runId);
    this.runtimeAdapterRunByTeam.delete(teamName);
    this.aliveRunByTeam.delete(teamName);
    if (this.provisioningRunByTeam.get(teamName) === runId) {
      this.provisioningRunByTeam.delete(teamName);
    }
    this.setRuntimeAdapterProgress({
      ...runtimeProgress,
      state: 'cancelled',
      message: 'Provisioning cancelled by user',
      updatedAt: nowIso(),
    });
    this.teamChangeEmitter?.({
      type: 'process',
      teamName,
      runId,
      detail: 'cancelled',
    });

    const previousLaunchState = await this.launchStateStore.read(teamName);
    const adapter = this.getOpenCodeRuntimeAdapter();
    if (adapter) {
      try {
        await adapter.stop({
          runId,
          laneId: 'primary',
          teamName,
          cwd: runtimeRun?.cwd ?? this.readPersistedTeamProjectPath(teamName) ?? undefined,
          providerId: 'opencode',
          reason: 'user_requested',
          previousLaunchState,
          force: true,
        });
      } catch (error) {
        logger.warn(
          `[${teamName}] Failed to stop OpenCode runtime adapter launch during cancel: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }
    }

    await clearOpenCodeRuntimeLaneStorage({
      teamsBasePath: getTeamsBasePath(),
      teamName,
      laneId: 'primary',
    }).catch(() => undefined);
  }

  private getPendingRuntimeAdapterLaunchesForShutdown(): TeamProvisioningProgress[] {
    return Array.from(this.runtimeAdapterProgressByRunId.values()).filter((progress) =>
      this.isCancellableRuntimeAdapterProgress(progress)
    );
  }

  private async clearOpenCodeRuntimeAdapterPrimaryLaneIfOwned(
    teamName: string,
    runId: string
  ): Promise<void> {
    const currentProvisioningRunId = this.provisioningRunByTeam.get(teamName);
    const currentAliveRunId = this.aliveRunByTeam.get(teamName);
    const currentRuntimeRun = this.runtimeAdapterRunByTeam.get(teamName);
    const ownsPrimaryLane =
      currentProvisioningRunId === runId ||
      currentAliveRunId === runId ||
      currentRuntimeRun?.runId === runId ||
      (!currentProvisioningRunId && !currentAliveRunId && !currentRuntimeRun);
    if (!ownsPrimaryLane) {
      return;
    }

    await clearOpenCodeRuntimeLaneStorage({
      teamsBasePath: getTeamsBasePath(),
      teamName,
      laneId: 'primary',
    }).catch(() => undefined);
    if (this.runtimeAdapterRunByTeam.get(teamName)?.runId === runId) {
      this.runtimeAdapterRunByTeam.delete(teamName);
    }
    if (this.aliveRunByTeam.get(teamName) === runId) {
      this.aliveRunByTeam.delete(teamName);
    }
    if (this.provisioningRunByTeam.get(teamName) === runId) {
      this.provisioningRunByTeam.delete(teamName);
    }
  }

  private recordCancelledOpenCodeRuntimeAdapterLaunch(
    teamName: string,
    sourceWarning: string | undefined,
    onProgress: (progress: TeamProvisioningProgress) => void
  ): TeamLaunchResponse {
    const runId = randomUUID();
    const timestamp = nowIso();
    this.provisioningRunByTeam.delete(teamName);
    this.runtimeAdapterRunByTeam.delete(teamName);
    this.aliveRunByTeam.delete(teamName);
    const progress: TeamProvisioningProgress = {
      runId,
      teamName,
      state: 'cancelled',
      message: 'Provisioning cancelled by user',
      startedAt: timestamp,
      updatedAt: timestamp,
      warnings: sourceWarning ? [sourceWarning] : undefined,
    };
    this.setRuntimeAdapterProgress(progress, onProgress);
    this.teamChangeEmitter?.({
      type: 'process',
      teamName,
      runId,
      detail: 'cancelled',
    });
    return { runId };
  }

  /**
   * Send a message to the team's lead process via stream-json stdin.
   * The lead will receive it as a new user turn and can delegate to teammates.
   */
  async sendMessageToTeam(
    teamName: string,
    message: string,
    attachments?: { data: string; mimeType: string; filename?: string }[]
  ): Promise<void> {
    const runId = this.getAliveRunId(teamName);
    if (!runId) {
      throw new Error(`No active process for team "${teamName}"`);
    }
    const remoteRun = this.remoteRuntimeByTeam.get(teamName);
    if (remoteRun?.runId === runId) {
      const messageId = randomUUID();
      await this.writeRemoteJson(
        remoteRun.machineId,
        path.posix.join(
          remoteRun.cwd,
          '.claude',
          'agent-teams-control',
          'teams',
          teamName,
          'inbox',
          `${messageId}.json`
        ),
        {
          version: 1,
          messageId,
          teamName,
          from: 'user',
          to: CANONICAL_LEAD_MEMBER_NAME,
          text: message,
          attachments,
          createdAt: nowIso(),
        }
      );
      return;
    }
    const run = this.runs.get(runId);
    if (!run?.child?.stdin?.writable) {
      throw new Error(`Team "${teamName}" process stdin is not writable`);
    }

    await this.sendMessageToRun(run, message, attachments);
  }

  private async sendMessageToRun(
    run: ProvisioningRun,
    message: string,
    attachments?: { data: string; mimeType: string; filename?: string }[]
  ): Promise<void> {
    if (!this.isCurrentTrackedRun(run)) {
      throw new Error(`Team "${run.teamName}" run "${run.runId}" is no longer current`);
    }
    if (run.processKilled || run.cancelRequested || !run.child?.stdin?.writable) {
      throw new Error(`Team "${run.teamName}" process stdin is not writable`);
    }

    const contentBlocks: Record<string, unknown>[] = [{ type: 'text', text: message }];
    if (attachments?.length) {
      for (const att of attachments) {
        if (att.mimeType === 'application/pdf') {
          // PDF → document block with base64 source
          contentBlocks.push({
            type: 'document',
            source: {
              type: 'base64',
              media_type: 'application/pdf',
              data: att.data,
            },
            title: att.filename,
          });
        } else if (att.mimeType === 'text/plain') {
          // Text file → document block with text source (decode base64 → UTF-8)
          const decoded = Buffer.from(att.data, 'base64').toString('utf-8');
          if (decoded.includes('\uFFFD')) {
            // Non-UTF-8 file: fallback to base64 document to avoid garbled content
            contentBlocks.push({
              type: 'document',
              source: {
                type: 'base64',
                media_type: 'text/plain',
                data: att.data,
              },
              title: att.filename,
            });
          } else {
            contentBlocks.push({
              type: 'document',
              source: {
                type: 'text',
                media_type: 'text/plain',
                data: decoded,
              },
              title: att.filename,
            });
          }
        } else {
          // Image (default) → image block
          contentBlocks.push({
            type: 'image',
            source: {
              type: 'base64',
              media_type: att.mimeType,
              data: att.data,
            },
          });
        }
      }
    }

    const payload = JSON.stringify({
      type: 'user',
      message: {
        role: 'user',
        content: contentBlocks,
      },
    });
    const stdin = run.child.stdin;
    await new Promise<void>((resolve, reject) => {
      stdin.write(payload + '\n', (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
    this.setLeadActivity(run, 'active');
  }

  async deliverExternalChannelMessageToLead(
    teamName: string,
    input: {
      channelName: string;
      provider: 'feishu';
      channelId: string;
      text: string;
      from: string;
      chatId: string;
      senderId?: string;
      messageId?: string;
    }
  ): Promise<string | null> {
    const runId = this.getAliveRunId(teamName) ?? this.getProvisioningRunId(teamName);
    if (!runId) return null;
    const run = this.runs.get(runId);
    if (!run?.child || run.processKilled || run.cancelRequested || !run.child.stdin?.writable) {
      return null;
    }
    if (run.leadRelayCapture) {
      logger.warn(`[${teamName}] external channel delivery skipped — lead turn already in-flight`);
      return null;
    }

    const config = await this.configReader.getConfig(teamName).catch(() => null);
    const leadName =
      config?.members?.find((member) => isLeadMember(member))?.name?.trim() ||
      CANONICAL_LEAD_MEMBER_NAME;
    this.persistExternalChannelUserMessage(teamName, {
      leadName,
      provider: input.provider,
      channelId: input.channelId,
      channelName: input.channelName,
      chatId: input.chatId,
      senderId: input.senderId,
      text: input.text,
      messageId: input.messageId,
    });
    const message = [
      `你收到了一条来自外部渠道的直接消息。`,
      `重要：你在这里的文本响应会发回该渠道，并显示在 Messages 面板。当发送者期待回复时，始终包含简短的人类可读回复。不要只用 agent-only 块响应。`,
      ``,
      `External channel: ${input.provider} / ${input.channelName} / chat ${input.chatId}`,
      `From: ${input.from}`,
      ...(input.messageId ? [`MessageId: ${input.messageId}`] : []),
      `To: ${leadName}`,
      ``,
      `Message:`,
      input.text,
    ].join('\n');

    const captureTimeoutMs = 15_000;
    const captureIdleMs = 800;
    let resolveCapture: (text: string) => void = () => {};
    let rejectCapture: (error: Error) => void = () => {};
    const capturePromise = new Promise<string>((resolve, reject) => {
      resolveCapture = resolve;
      rejectCapture = reject;
    });
    const activeCapture: NonNullable<ProvisioningRun['leadRelayCapture']> = {
      leadName,
      startedAt: nowIso(),
      textParts: [],
      settled: false,
      idleHandle: null,
      idleMs: captureIdleMs,
      timeoutHandle: setTimeout(() => {
        rejectCapture(new Error('Timed out waiting for lead external-channel reply'));
      }, captureTimeoutMs),
      externalChannel: {
        provider: input.provider,
        channelId: input.channelId,
        channelName: input.channelName,
        chatId: input.chatId,
        senderId: input.senderId,
      },
      visibleUserMessageCaptured: false,
      resolveOnce: (text: string) => {
        if (activeCapture.settled) return;
        activeCapture.settled = true;
        if (activeCapture.idleHandle) {
          clearTimeout(activeCapture.idleHandle);
          activeCapture.idleHandle = null;
        }
        clearTimeout(activeCapture.timeoutHandle);
        resolveCapture(text);
      },
      rejectOnce: (error: string) => {
        if (activeCapture.settled) return;
        activeCapture.settled = true;
        if (activeCapture.idleHandle) {
          clearTimeout(activeCapture.idleHandle);
          activeCapture.idleHandle = null;
        }
        clearTimeout(activeCapture.timeoutHandle);
        rejectCapture(new Error(error));
      },
    };
    run.leadRelayCapture = activeCapture;

    try {
      await this.sendMessageToRun(run, message);
    } catch (error) {
      if (activeCapture) {
        clearTimeout(activeCapture.timeoutHandle);
        if (activeCapture.idleHandle) {
          clearTimeout(activeCapture.idleHandle);
        }
      }
      if (run.leadRelayCapture === activeCapture) {
        run.leadRelayCapture = null;
      }
      logger.warn(`[${teamName}] external channel stdin delivery failed: ${String(error)}`);
      return null;
    }

    let replyText: string | null = null;
    try {
      replyText = (await capturePromise).trim() || null;
    } catch {
      const partial = activeCapture?.textParts?.join('')?.trim();
      replyText = partial && partial.length > 0 ? partial : null;
    } finally {
      if (activeCapture) {
        if (activeCapture.idleHandle) {
          clearTimeout(activeCapture.idleHandle);
          activeCapture.idleHandle = null;
        }
        clearTimeout(activeCapture.timeoutHandle);
      }
      if (run.leadRelayCapture === activeCapture) {
        run.leadRelayCapture = null;
      }
    }

    const cleanReply = replyText ? stripAgentBlocks(replyText).trim() : '';
    if (cleanReply && !activeCapture.visibleUserMessageCaptured) {
      const replyMessage: InboxMessage = {
        from: leadName,
        to: 'user',
        text: cleanReply,
        timestamp: nowIso(),
        read: true,
        summary: cleanReply.length > 60 ? cleanReply.slice(0, 57) + '...' : cleanReply,
        messageId: `external-lead-reply-${input.channelId}-${Date.now()}`,
        source: 'lead_process',
        externalChannel: activeCapture.externalChannel,
      };
      this.persistSentMessage(teamName, replyMessage);
      this.pushLiveLeadProcessMessage(teamName, replyMessage);
      this.teamChangeEmitter?.({
        type: 'inbox',
        teamName,
        detail: 'external-channel-lead-reply',
      });
    }
    return cleanReply || null;
  }

  /**
   * UNUSED (2026-03-23): teammates read their own inbox files directly via fs.watch,
   * so forwarding through the lead is unnecessary. Kept for reference — the prompt
   * pattern here ("MUST: ask teammate to reply back to user") was a useful finding
   * that informed the direct inbox approach.
   *
   * Original purpose: forward a user DM to a teammate by injecting a relay turn
   * into the lead's stdin and suppressing the lead's textual output.
   */
  async forwardUserDmToTeammate(
    teamName: string,
    teammateName: string,
    userText: string,
    userSummary?: string
  ): Promise<void> {
    const runId = this.getAliveRunId(teamName);
    if (!runId) {
      throw new Error(`No active process for team "${teamName}"`);
    }
    const run = this.runs.get(runId);
    if (!run?.child?.stdin?.writable) {
      throw new Error(`Team "${teamName}" process stdin is not writable`);
    }
    if (!run.provisioningComplete) {
      // Don't inject extra turns during provisioning/bootstrap.
      return;
    }

    this.armSilentTeammateForward(run, teammateName, 'user_dm');

    const summaryLine = userSummary?.trim() ? `Summary: ${userSummary.trim()}` : null;
    const internal = wrapInAgentBlock(
      [
        `UI relay request — forward a direct message to teammate "${teammateName}".`,
        `MUST: ${getCanonicalSendMessageToolRule(teammateName)}`,
        `必须：如果他们回复人类，目标必须是 to="user"（短答复）。`,
        `重要：本轮不要发送任何 to="user" 的消息。`,
        getCanonicalSendMessageFieldRule(),
      ].join('\n')
    );
    const message = [
      `User DM relay (internal).`,
      internal,
      ``,
      `Message to forward:`,
      ...(summaryLine ? [summaryLine] : []),
      userText,
    ].join('\n');

    await this.sendMessageToRun(run, message);
  }

  async relayMemberInboxMessages(teamName: string, memberName: string): Promise<number> {
    if (
      this.isCrossTeamPseudoRecipientName(memberName) ||
      this.isCrossTeamToolRecipientName(memberName)
    ) {
      return 0;
    }
    const relayKey = this.getMemberRelayKey(teamName, memberName);
    const existing = this.memberInboxRelayInFlight.get(relayKey);
    if (existing) {
      return existing;
    }

    const work = (async (): Promise<number> => {
      const runId = this.getAliveRunId(teamName);
      if (!runId) return 0;
      const run = this.runs.get(runId);
      if (!run?.child || run.processKilled || run.cancelRequested) return 0;
      if (!run.provisioningComplete) return 0;
      const isStaleRelayRun = (): boolean =>
        !this.isCurrentTrackedRun(run) || !run.child || run.processKilled || run.cancelRequested;

      const relayedIds = this.relayedMemberInboxMessageIds.get(relayKey) ?? new Set<string>();

      let memberInboxMessages: Awaited<ReturnType<TeamInboxReader['getMessagesFor']>> = [];
      try {
        memberInboxMessages = await this.inboxReader.getMessagesFor(teamName, memberName);
      } catch {
        return 0;
      }
      if (isStaleRelayRun()) return 0;

      const unread = memberInboxMessages
        .filter((m): m is InboxMessage & { messageId: string } => {
          if (m.read) return false;
          if (typeof m.text !== 'string' || m.text.trim().length === 0) return false;
          if (!this.hasStableMessageId(m)) return false;
          return !relayedIds.has(m.messageId);
        })
        .sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));

      if (unread.length === 0) return 0;

      const relayView = buildRelayInboxView(unread);
      const silentNoiseUnread = relayView
        .filter(({ idle, isCoarseNoise }) => {
          if (idle) return idle.handling === 'silent_noise';
          return isCoarseNoise;
        })
        .map(({ message }) => message);
      const passiveIdleUnread = relayView
        .filter(({ idle }) => idle?.handling === 'passive_activity')
        .map(({ message }) => message);
      const actionableUnread = relayView
        .filter(({ idle, isCoarseNoise }) => {
          if (idle) return idle.handling === 'visible_actionable';
          return !isCoarseNoise;
        })
        .map(({ message }) => message);

      const readOnlyIgnoredUnread = [...silentNoiseUnread, ...passiveIdleUnread];
      if (isStaleRelayRun()) return 0;

      if (readOnlyIgnoredUnread.length > 0) {
        try {
          await this.markInboxMessagesRead(teamName, memberName, readOnlyIgnoredUnread);
          if (passiveIdleUnread.length > 0) {
            logger.debug(
              `[${teamName}] member relay marked ${passiveIdleUnread.length} passive idle message(s) read without relay for ${memberName}`
            );
          }
        } catch (error) {
          logger.debug(
            `[${teamName}] member relay failed to mark ${readOnlyIgnoredUnread.length} ignored inbox message(s) read for ${memberName}: ${
              error instanceof Error ? error.message : String(error)
            }`
          );
        }
      }

      if (actionableUnread.length === 0) return 0;

      const MAX_RELAY = 10;
      const batch = actionableUnread.slice(0, MAX_RELAY);

      this.armSilentTeammateForward(run, memberName, 'member_inbox_relay');
      const rememberedRelayIds = this.rememberPendingInboxRelayCandidates(run, memberName, batch);

      const message = [
        `Inbox relay (internal) — forward to "${memberName}".`,
        wrapInAgentBlock(
          [
            `重要：本次 relay 回合不要发送任何 to="user" 的消息。唯一有效目标是 to="${memberName}"。`,
            getCanonicalSendMessageToolRule(memberName),
            getCanonicalSendMessageFieldRule(),
            `保留任务 ID 和关键指令。不要在 SendMessage 调用之外添加额外叙述。`,
            `如果 inbox 项标记为 Source: system_notification，请准确转发该通知一次，不要改写。`,
          ].join('\n')
        ),
        ``,
        `Messages to relay (DO NOT respond to user directly):`,
        ...batch.flatMap((m, idx) => {
          const summaryLine = m.summary?.trim() ? `Summary: ${m.summary.trim()}` : null;
          const crossTeamMeta =
            m.source === 'cross_team'
              ? {
                  origin: parseCrossTeamPrefix(m.text),
                  sourceTeam: m.from.includes('.') ? m.from.split('.', 1)[0] : null,
                }
              : null;
          const conversationId = m.conversationId ?? crossTeamMeta?.origin?.conversationId;
          const replyInstructions =
            crossTeamMeta?.sourceTeam && conversationId
              ? [
                  `   Cross-team conversationId: ${conversationId}`,
                  `   调用名为 cross_team_send 的 MCP 工具，并设置 toTeam="${crossTeamMeta.sourceTeam}", conversationId="${conversationId}", replyToConversationId="${conversationId}"。不要把 "cross_team_send" 放进 SendMessage recipient 或 message_send 的 "to" 字段。`,
                ]
              : [];
          return [
            `${idx + 1}) From: ${m.from || 'unknown'}`,
            `   Timestamp: ${m.timestamp}`,
            `   MessageId: ${m.messageId}`,
            ...(summaryLine ? [`   ${summaryLine}`] : []),
            ...(typeof m.source === 'string' && m.source.trim()
              ? [`   Source: ${m.source.trim()}`]
              : []),
            ...replyInstructions,
            `   Text:`,
            ...m.text.split('\n').map((line) => `   ${line}`),
            ``,
          ];
        }),
      ].join('\n');

      try {
        await this.sendMessageToRun(run, message);
      } catch {
        this.forgetPendingInboxRelayCandidates(run, memberName, rememberedRelayIds);
        return 0;
      }

      for (const m of batch) {
        relayedIds.add(m.messageId);
      }
      this.relayedMemberInboxMessageIds.set(relayKey, this.trimRelayedSet(relayedIds));

      try {
        await this.markInboxMessagesRead(teamName, memberName, batch);
      } catch {
        // Best-effort: relay succeeded; marking read failed.
      }

      return batch.length;
    })();

    this.memberInboxRelayInFlight.set(relayKey, work);
    try {
      return await work;
    } finally {
      if (this.memberInboxRelayInFlight.get(relayKey) === work) {
        this.memberInboxRelayInFlight.delete(relayKey);
      }
    }
  }

  async relayInboxFileToLiveRecipient(
    teamName: string,
    inboxName: string,
    options: OpenCodeMemberInboxRelayOptions = {}
  ): Promise<LiveInboxRelayResult> {
    if (
      this.isCrossTeamPseudoRecipientName(inboxName) ||
      this.isCrossTeamToolRecipientName(inboxName)
    ) {
      return { kind: 'ignored', relayed: 0 };
    }

    const leadName = await this.configReader
      .getConfig(teamName)
      .then(
        (config) => config?.members?.find((member) => isLeadMember(member))?.name?.trim() || null
      )
      .catch(() => null);
    if (inboxName.trim().toLowerCase() === leadName?.toLowerCase()) {
      if (await this.isOpenCodeRuntimeRecipient(teamName, inboxName)) {
        const diagnostic =
          'opencode_lead_runtime_session_missing: OpenCode lead inbox relay is unsupported in v1; leaving inbox unread for durable retry/diagnostics.';
        logger.warn(`[${teamName}] ${diagnostic} inbox=${inboxName}`);
        return {
          kind: 'opencode_lead_unsupported',
          relayed: 0,
          diagnostics: [diagnostic],
        };
      }
      return {
        kind: 'native_lead',
        relayed: this.isTeamAlive(teamName) ? await this.relayLeadInboxMessages(teamName) : 0,
      };
    }

    if (await this.isOpenCodeRuntimeRecipient(teamName, inboxName)) {
      const relayOptions: OpenCodeMemberInboxRelayOptions = {
        source: options.source ?? 'watcher',
        ...(options.onlyMessageId ? { onlyMessageId: options.onlyMessageId } : {}),
        ...(options.deliveryMetadata ? { deliveryMetadata: options.deliveryMetadata } : {}),
      };
      const relay = await this.relayOpenCodeMemberInboxMessages(teamName, inboxName, relayOptions);
      return {
        kind: 'opencode_member',
        relayed: relay.relayed,
        diagnostics: relay.diagnostics,
        lastDelivery: relay.lastDelivery,
      };
    }

    return { kind: 'native_member_noop', relayed: 0 };
  }

  async relayOpenCodeMemberInboxMessages(
    teamName: string,
    memberName: string,
    options: OpenCodeMemberInboxRelayOptions = {}
  ): Promise<OpenCodeMemberInboxRelayResult> {
    const relayKey = this.getOpenCodeMemberRelayKey(teamName, memberName);
    const existing = this.openCodeMemberInboxRelayInFlight.get(relayKey);
    if (existing) {
      const existingResult = await existing;
      const onlyMessageId = options.onlyMessageId?.trim();
      if (!onlyMessageId) {
        return existingResult;
      }
      const inboxMessages = await this.inboxReader
        .getMessagesFor(teamName, memberName)
        .catch(() => []);
      const targetMessage = inboxMessages.find((message) => message.messageId === onlyMessageId);
      if (targetMessage?.read) {
        return {
          relayed: 0,
          attempted: 1,
          delivered: 1,
          failed: 0,
          lastDelivery: { delivered: true },
          diagnostics: existingResult.diagnostics,
        };
      }
      if (!targetMessage) {
        const diagnostic = `opencode_inbox_message_missing_after_inflight_relay: ${onlyMessageId}`;
        return {
          relayed: 0,
          attempted: 1,
          delivered: 0,
          failed: 1,
          lastDelivery: {
            delivered: false,
            reason: 'opencode_inbox_message_missing_after_inflight_relay',
            diagnostics: [diagnostic],
          },
          diagnostics: [diagnostic],
        };
      }
    }

    const work = (async (): Promise<OpenCodeMemberInboxRelayResult> => {
      const result: OpenCodeMemberInboxRelayResult = {
        relayed: 0,
        attempted: 0,
        delivered: 0,
        failed: 0,
      };
      if (!(await this.isOpenCodeRuntimeRecipient(teamName, memberName))) {
        result.lastDelivery = { delivered: false, reason: 'recipient_is_not_opencode' };
        return result;
      }
      const memberIdentity = await this.resolveOpenCodeMemberDeliveryIdentity(teamName, memberName);
      if (!memberIdentity.ok) {
        result.lastDelivery = { delivered: false, reason: memberIdentity.reason };
        return result;
      }
      const promptLedger = this.createOpenCodePromptDeliveryLedger(teamName, memberIdentity.laneId);

      let inboxMessages: Awaited<ReturnType<TeamInboxReader['getMessagesFor']>> = [];
      try {
        inboxMessages = await this.inboxReader.getMessagesFor(teamName, memberName);
      } catch (error) {
        const diagnostic = `opencode_inbox_read_failed: ${getErrorMessage(error)}`;
        result.lastDelivery = {
          delivered: false,
          reason: 'opencode_inbox_read_failed',
          diagnostics: [diagnostic],
        };
        result.diagnostics = [diagnostic];
        return result;
      }

      const onlyMessageId = options.onlyMessageId?.trim();
      if (onlyMessageId) {
        const targetMessage = inboxMessages.find((message) => message.messageId === onlyMessageId);
        if (targetMessage?.read) {
          return {
            relayed: 0,
            attempted: 1,
            delivered: 1,
            failed: 0,
            lastDelivery: { delivered: true },
          };
        }
        if (!targetMessage) {
          const diagnostic = `opencode_inbox_message_missing: ${onlyMessageId}`;
          return {
            relayed: 0,
            attempted: 1,
            delivered: 0,
            failed: 1,
            lastDelivery: {
              delivered: false,
              reason: 'opencode_inbox_message_missing',
              diagnostics: [diagnostic],
            },
            diagnostics: [diagnostic],
          };
        }
      }
      const unread = inboxMessages
        .filter((message): message is InboxMessage & { messageId: string } => {
          if (message.read) return false;
          if (onlyMessageId && message.messageId !== onlyMessageId) return false;
          if (typeof message.text !== 'string' || message.text.trim().length === 0) return false;
          return this.hasStableMessageId(message);
        })
        .sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp))
        .slice(0, 10);

      for (const message of unread) {
        const existingRecord = await promptLedger
          .getByInboxMessage({
            teamName,
            memberName: memberIdentity.canonicalMemberName,
            laneId: memberIdentity.laneId,
            inboxMessageId: message.messageId,
          })
          .catch(() => null);
        if (existingRecord?.status === 'failed_terminal') {
          let recoveredRecord: OpenCodePromptDeliveryLedgerRecord | null = null;
          let recoveredVisibleReply: OpenCodeVisibleReplyProof | null = null;
          if (typeof promptLedger.applyDestinationProof === 'function') {
            try {
              const proof = await this.applyOpenCodeVisibleDestinationProof({
                ledger: promptLedger,
                ledgerRecord: existingRecord,
                teamName,
                replyRecipient: existingRecord.replyRecipient,
                memberName: memberIdentity.canonicalMemberName,
              });
              recoveredRecord = proof.ledgerRecord;
              recoveredVisibleReply = proof.visibleReply;
            } catch {
              recoveredRecord = null;
              recoveredVisibleReply = null;
            }
          }
          const recoveredReadAllowed =
            recoveredRecord &&
            this.isOpenCodeDeliveryResponseReadCommitAllowed({
              responseState: recoveredRecord.responseState,
              actionMode: recoveredRecord.actionMode ?? undefined,
              taskRefs: recoveredRecord.taskRefs,
              visibleReply: recoveredVisibleReply,
              ledgerRecord: recoveredRecord,
            });
          if (recoveredRecord && recoveredReadAllowed) {
            try {
              await this.markInboxMessagesRead(teamName, memberName, [message]);
              const committed = await promptLedger.markInboxReadCommitted({
                id: recoveredRecord.id,
                committedAt: nowIso(),
              });
              this.logOpenCodePromptDeliveryEvent(
                'opencode_prompt_delivery_inbox_committed_read',
                committed,
                { recoveredTerminal: true }
              );
              result.delivered += 1;
              result.relayed += 1;
              result.lastDelivery = {
                delivered: true,
                accepted: true,
                responsePending: false,
                responseState: committed.responseState,
                ledgerStatus: committed.status,
                ledgerRecordId: committed.id,
                laneId: memberIdentity.laneId,
                visibleReplyMessageId: committed.visibleReplyMessageId ?? undefined,
                visibleReplyCorrelation: committed.visibleReplyCorrelation ?? undefined,
                diagnostics: committed.diagnostics,
              };
              break;
            } catch (error) {
              const diagnostic = `opencode_inbox_mark_read_failed_after_terminal_recovery: ${getErrorMessage(
                error
              )}`;
              result.failed += 1;
              result.lastDelivery = {
                delivered: false,
                reason: 'opencode_inbox_mark_read_failed_after_terminal_recovery',
                diagnostics: [diagnostic],
              };
              result.diagnostics = [...(result.diagnostics ?? []), diagnostic];
              break;
            }
          }
          const diagnostic =
            existingRecord.lastReason ??
            `opencode_prompt_delivery_failed_terminal: ${message.messageId}`;
          result.diagnostics = [...(result.diagnostics ?? []), diagnostic];
          if (onlyMessageId) {
            result.failed += 1;
            result.lastDelivery = {
              delivered: false,
              accepted: false,
              ledgerStatus: existingRecord.status,
              ledgerRecordId: existingRecord.id,
              laneId: memberIdentity.laneId,
              reason: existingRecord.lastReason ?? 'opencode_prompt_delivery_failed_terminal',
              diagnostics: existingRecord.diagnostics.length
                ? existingRecord.diagnostics
                : [diagnostic],
            };
          }
          continue;
        }
        const fallbackReplyRecipient =
          typeof message.from === 'string' &&
          message.from.trim() &&
          message.from.trim().toLowerCase() !== memberName.trim().toLowerCase()
            ? message.from.trim()
            : 'user';
        const effectiveReplyRecipient =
          existingRecord?.replyRecipient ??
          options.deliveryMetadata?.replyRecipient ??
          fallbackReplyRecipient;
        const effectiveActionMode =
          existingRecord?.actionMode ??
          options.deliveryMetadata?.actionMode ??
          message.actionMode ??
          null;
        const effectiveTaskRefs =
          existingRecord?.taskRefs ?? options.deliveryMetadata?.taskRefs ?? message.taskRefs ?? [];
        const effectiveSource = existingRecord?.source ?? options.source ?? 'watcher';
        result.attempted += 1;
        if (message.attachments?.length) {
          const reason = 'opencode_attachments_not_supported_for_secondary_runtime';
          const now = nowIso();
          const record = await promptLedger.ensurePending({
            teamName,
            memberName: memberIdentity.canonicalMemberName,
            laneId: memberIdentity.laneId,
            runId: await this.resolveCurrentOpenCodeRuntimeRunId(teamName, memberIdentity.laneId),
            inboxMessageId: message.messageId,
            inboxTimestamp: message.timestamp,
            source: effectiveSource,
            replyRecipient: effectiveReplyRecipient,
            actionMode: effectiveActionMode,
            taskRefs: effectiveTaskRefs,
            payloadHash: hashOpenCodePromptDeliveryPayload({
              text: message.text,
              replyRecipient: effectiveReplyRecipient,
              actionMode: effectiveActionMode,
              taskRefs: effectiveTaskRefs,
              attachments: message.attachments,
              source: effectiveSource,
            }),
            now,
          });
          const failed = await promptLedger.markFailedTerminal({
            id: record.id,
            reason,
            failedAt: now,
          });
          this.logOpenCodePromptDeliveryEvent('opencode_prompt_delivery_terminal_failure', failed);
          const diagnostics = failed.diagnostics.length ? failed.diagnostics : [reason];
          result.failed += 1;
          result.lastDelivery = {
            delivered: false,
            accepted: false,
            ledgerStatus: failed.status,
            ledgerRecordId: failed.id,
            laneId: memberIdentity.laneId,
            reason,
            diagnostics,
          };
          result.diagnostics = [...(result.diagnostics ?? []), ...diagnostics];
          logger.warn(
            `[${teamName}] OpenCode inbox relay refused attachment-only unsupported delivery for ${memberName}/${message.messageId}: ${reason}`
          );
          continue;
        }
        const delivery = await this.deliverOpenCodeMemberMessage(teamName, {
          memberName,
          text: message.text,
          messageId: message.messageId,
          replyRecipient: effectiveReplyRecipient,
          actionMode: effectiveActionMode ?? undefined,
          taskRefs: effectiveTaskRefs,
          source: effectiveSource,
          inboxTimestamp: message.timestamp,
        });
        result.lastDelivery = delivery;
        if (!delivery.delivered) {
          result.failed += 1;
          result.diagnostics = [
            ...(result.diagnostics ?? []),
            ...(delivery.diagnostics ?? [delivery.reason ?? 'opencode_message_delivery_failed']),
          ];
          logger.warn(
            `[${teamName}] OpenCode inbox relay failed for ${memberName}/${message.messageId}: ${
              delivery.reason ?? 'unknown error'
            }`
          );
          break;
        }
        if (delivery.responsePending) {
          result.diagnostics = [
            ...(result.diagnostics ?? []),
            ...(delivery.diagnostics ?? [delivery.reason ?? 'opencode_delivery_response_pending']),
          ];
          break;
        }
        try {
          await this.markInboxMessagesRead(teamName, memberName, [message]);
          if (delivery.ledgerRecordId && delivery.laneId) {
            const committed = await this.createOpenCodePromptDeliveryLedger(
              teamName,
              delivery.laneId
            ).markInboxReadCommitted({
              id: delivery.ledgerRecordId,
              committedAt: nowIso(),
            });
            this.logOpenCodePromptDeliveryEvent(
              'opencode_prompt_delivery_inbox_committed_read',
              committed
            );
          }
        } catch (error) {
          const diagnostic = `opencode_inbox_mark_read_failed_after_delivery: ${getErrorMessage(
            error
          )}`;
          if (delivery.ledgerRecordId && delivery.laneId) {
            const failedCommit = await this.createOpenCodePromptDeliveryLedger(
              teamName,
              delivery.laneId
            ).markInboxReadCommitFailed({
              id: delivery.ledgerRecordId,
              error: diagnostic,
              failedAt: nowIso(),
            });
            this.logOpenCodePromptDeliveryEvent(
              'opencode_prompt_delivery_response_observed',
              failedCommit,
              { inboxReadCommitError: diagnostic }
            );
          }
          result.failed += 1;
          result.lastDelivery = {
            delivered: false,
            reason: 'opencode_inbox_mark_read_failed_after_delivery',
            diagnostics: [diagnostic],
          };
          result.diagnostics = [...(result.diagnostics ?? []), diagnostic];
          logger.warn(`[${teamName}] ${diagnostic}`);
          break;
        }
        result.delivered += 1;
        result.relayed += 1;
        break;
      }

      if (result.diagnostics?.length) {
        result.diagnostics = [...new Set(result.diagnostics)];
      }
      return result;
    })();

    this.openCodeMemberInboxRelayInFlight.set(relayKey, work);
    try {
      return await work;
    } finally {
      if (this.openCodeMemberInboxRelayInFlight.get(relayKey) === work) {
        this.openCodeMemberInboxRelayInFlight.delete(relayKey);
      }
    }
  }

  /**
   * Relay unread inbox messages addressed to the team lead into the live lead process.
   *
   * Why: teammates (and the UI) write to `inboxes/<lead>.json`, but the live lead CLI
   * process consumes new turns via stream-json stdin. Without relaying, the lead
   * appears unresponsive to direct messages.
   *
   * Returns the number of messages relayed.
   */
  private hasStableMessageId(
    message: InboxMessage
  ): message is InboxMessage & { messageId: string } {
    return typeof message.messageId === 'string' && message.messageId.trim().length > 0;
  }

  async relayLeadInboxMessages(teamName: string): Promise<number> {
    const existing = this.leadInboxRelayInFlight.get(teamName);
    if (existing) {
      return existing;
    }

    const work = (async (): Promise<number> => {
      const runId = this.getAliveRunId(teamName) ?? this.getProvisioningRunId(teamName);
      if (!runId) return 0;
      const run = this.runs.get(runId);
      if (!run?.child || run.processKilled || run.cancelRequested) return 0;
      const isStaleRelayRun = (): boolean =>
        !this.isCurrentTrackedRun(run) || !run.child || run.processKilled || run.cancelRequested;

      // Permission request scan runs even during provisioning — teammates may need
      // tool approval before the lead's first turn completes. CLI marks inbox messages
      // as read after native delivery, so we must scan ALL messages (including read).
      let config: Awaited<ReturnType<TeamConfigReader['getConfig']>> | null = null;
      try {
        config = await this.configReader.getConfig(teamName);
      } catch {
        // config not ready yet during early provisioning — skip scan
      }
      if (isStaleRelayRun()) return 0;
      if (config) {
        const leadName =
          config.members?.find((m) => isLeadMember(m))?.name?.trim() || CANONICAL_LEAD_MEMBER_NAME;
        try {
          const leadInboxMessages = await this.inboxReader.getMessagesFor(teamName, leadName);
          if (isStaleRelayRun()) return 0;
          const permMsgsToMarkRead: { messageId: string }[] = [];
          const runStartedAtMs = Date.parse(run.startedAt);
          for (const msg of leadInboxMessages) {
            if (typeof msg.text !== 'string') continue;
            const perm = parsePermissionRequest(msg.text);
            if (!perm) continue;
            // Skip permission_requests from previous runs — they're stale
            const msgTs = Date.parse(msg.timestamp);
            if (
              Number.isFinite(msgTs) &&
              Number.isFinite(runStartedAtMs) &&
              msgTs < runStartedAtMs
            ) {
              continue;
            }
            // Dedup is handled inside handleTeammatePermissionRequest via processedPermissionRequestIds
            this.handleTeammatePermissionRequest(run, perm, msg.timestamp);
            // Mark unread permission_request messages as read to prevent stale unread indicators
            if (!msg.read && this.hasStableMessageId(msg)) {
              permMsgsToMarkRead.push({ messageId: msg.messageId });
            }
          }
          if (permMsgsToMarkRead.length > 0) {
            await this.markInboxMessagesRead(teamName, leadName, permMsgsToMarkRead).catch(
              () => {}
            );
          }
        } catch {
          // best-effort — inbox may not exist yet
        }
      }

      if (!run.provisioningComplete) return 0;

      const relayedIds = this.relayedLeadInboxMessageIds.get(teamName) ?? new Set<string>();
      const inFlightIds = this.inFlightLeadInboxMessageIds.get(teamName) ?? new Set<string>();

      // Re-read config if needed (already fetched above but guard provisioningComplete path)
      if (!config) {
        try {
          config = await this.configReader.getConfig(teamName);
        } catch {
          return 0;
        }
      }
      if (isStaleRelayRun()) return 0;
      if (!config) return 0;

      const leadName =
        config.members?.find((m) => isLeadMember(m))?.name?.trim() || CANONICAL_LEAD_MEMBER_NAME;
      let leadInboxMessages: Awaited<ReturnType<TeamInboxReader['getMessagesFor']>> = [];
      try {
        leadInboxMessages = await this.inboxReader.getMessagesFor(teamName, leadName);
      } catch {
        return 0;
      }
      if (isStaleRelayRun()) return 0;

      await this.refreshMemberSpawnStatusesFromLeadInbox(run);
      if (isStaleRelayRun()) return 0;

      const unread = leadInboxMessages
        .filter((m): m is InboxMessage & { messageId: string } => {
          if (m.read) return false;
          if (typeof m.text !== 'string' || m.text.trim().length === 0) return false;
          if (!this.hasStableMessageId(m)) return false;
          return !relayedIds.has(m.messageId) && !inFlightIds.has(m.messageId);
        })
        .sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));

      if (unread.length === 0) return 0;

      const relayView = buildRelayInboxView(unread);
      const silentIdleIds = new Set(
        relayView
          .filter(({ idle }) => idle?.handling === 'silent_noise')
          .map(({ message }) => message.messageId)
      );
      const passiveIdleIds = new Set(
        relayView
          .filter(({ idle }) => idle?.handling === 'passive_activity')
          .map(({ message }) => message.messageId)
      );
      const coarseNonIdleNoiseIds = new Set(
        relayView
          .filter(({ idle, isCoarseNoise }) => idle === null && isCoarseNoise)
          .map(({ message }) => message.messageId)
      );

      const latestOutboundByConversation = new Map<string, number>();
      const latestReadInboundByConversation = new Map<string, number>();
      for (const message of leadInboxMessages) {
        const timestampMs = Date.parse(message.timestamp);
        if (!Number.isFinite(timestampMs)) continue;
        if (message.source === CROSS_TEAM_SENT_SOURCE) {
          const conversationId = message.conversationId?.trim();
          const targetTeam = this.parseCrossTeamTargetTeam(message.to);
          if (!conversationId || !targetTeam) continue;
          const key = this.buildCrossTeamConversationKey(targetTeam, conversationId);
          latestOutboundByConversation.set(
            key,
            Math.max(latestOutboundByConversation.get(key) ?? 0, timestampMs)
          );
          continue;
        }
        if (message.source === CROSS_TEAM_SOURCE && message.read) {
          const conversationId =
            message.replyToConversationId?.trim() ??
            message.conversationId?.trim() ??
            parseCrossTeamPrefix(message.text)?.conversationId;
          const sourceTeam = this.getCrossTeamSourceTeam(message.from);
          if (!conversationId || !sourceTeam) continue;
          const key = this.buildCrossTeamConversationKey(sourceTeam, conversationId);
          latestReadInboundByConversation.set(
            key,
            Math.max(latestReadInboundByConversation.get(key) ?? 0, timestampMs)
          );
        }
      }
      const pendingHistoricalReplies = new Set(
        Array.from(latestOutboundByConversation.entries())
          .filter(([key, sentAtMs]) => sentAtMs > (latestReadInboundByConversation.get(key) ?? 0))
          .map(([key]) => key)
      );
      const pendingTransientReplies = this.getPendingCrossTeamReplyExpectationKeys(teamName);
      const matchedTransientReplyKeys = new Set<string>();

      const wasRecentlyDeliveredCrossTeam = (message: InboxMessage): boolean => {
        if (message.source !== CROSS_TEAM_SOURCE) return false;
        if (!this.hasStableMessageId(message)) return false;
        return this.wasRecentlyDeliveredToLead(teamName, message.messageId);
      };
      const isCrossTeamReplyToOwnOutbound = (message: InboxMessage): boolean => {
        if (message.source !== CROSS_TEAM_SOURCE) return false;
        const conversationId =
          message.replyToConversationId?.trim() ??
          message.conversationId?.trim() ??
          parseCrossTeamPrefix(message.text)?.conversationId;
        if (!conversationId) return false;
        const sourceTeam = this.getCrossTeamSourceTeam(message.from);
        if (!sourceTeam) return false;
        const key = this.buildCrossTeamConversationKey(sourceTeam, conversationId);
        if (pendingHistoricalReplies.has(key)) {
          return true;
        }
        if (pendingTransientReplies.has(key)) {
          matchedTransientReplyKeys.add(key);
          return true;
        }
        return false;
      };

      // Category 1: permanently ignored → mark as read.
      // Includes noise (idle/shutdown), cross-team sender copies, cross-team reply dedup.
      const permanentlyIgnored = unread.filter(
        (m) =>
          silentIdleIds.has(m.messageId) ||
          coarseNonIdleNoiseIds.has(m.messageId) ||
          m.source === CROSS_TEAM_SENT_SOURCE ||
          isCrossTeamReplyToOwnOutbound(m) ||
          wasRecentlyDeliveredCrossTeam(m)
      );
      if (permanentlyIgnored.length > 0) {
        try {
          await this.markInboxMessagesRead(teamName, leadName, permanentlyIgnored);
        } catch {
          // best-effort
        }
        for (const key of matchedTransientReplyKeys) {
          const [otherTeam, conversationId] = key.split('\0');
          if (otherTeam && conversationId) {
            this.clearPendingCrossTeamReplyExpectation(teamName, otherTeam, conversationId);
          }
        }
      }

      const passiveIdleUnread = unread.filter((m) => passiveIdleIds.has(m.messageId));
      if (passiveIdleUnread.length > 0) {
        try {
          await this.markInboxMessagesRead(teamName, leadName, passiveIdleUnread);
          logger.debug(
            `[${teamName}] lead relay marked ${passiveIdleUnread.length} passive idle message(s) read without relay`
          );
        } catch (error) {
          logger.debug(
            `[${teamName}] lead relay failed to mark ${passiveIdleUnread.length} passive idle message(s) read: ${
              error instanceof Error ? error.message : String(error)
            }`
          );
        }
      }

      const readOnlyIgnoredIds = new Set([
        ...permanentlyIgnored.map((m) => m.messageId),
        ...passiveIdleUnread.map((m) => m.messageId),
      ]);
      const remainingUnread = unread.filter((m) => !readOnlyIgnoredIds.has(m.messageId));
      if (isStaleRelayRun()) return 0;

      // Category 2: same-team native delivery confirmation (one-to-one pairing).
      const { nativeMatchedMessageIds, persisted: sameTeamPersisted } =
        await this.confirmSameTeamNativeMatches(teamName, leadName, remainingUnread);

      // Category 3: deferred by age — source-less messages within grace window of CURRENT run.
      // NOT marked read (crash safety: if native delivery fails, retry will relay).
      const runStartedAtMs = Date.parse(run.startedAt);
      const deferredByAge = remainingUnread.filter(
        (m) =>
          !nativeMatchedMessageIds.has(m.messageId) &&
          this.shouldDeferSameTeamMessage(m, leadName, runStartedAtMs)
      );
      const deferredIds = new Set(deferredByAge.map((m) => m.messageId));

      // Category 4: teammate permission requests — filter from actionable so they're
      // NOT relayed to the lead. The actual interception + ToolApprovalRequest emission
      // is handled by the early scan above (which checks processedPermissionRequestIds).
      const permissionRequestIds = new Set(
        remainingUnread
          .filter((m) => !deferredIds.has(m.messageId) && parsePermissionRequest(m.text) !== null)
          .map((m) => m.messageId)
      );

      // Actionable: everything not in any category.
      const actionableUnread = remainingUnread.filter(
        (m) =>
          !nativeMatchedMessageIds.has(m.messageId) &&
          !deferredIds.has(m.messageId) &&
          !permissionRequestIds.has(m.messageId)
      );

      // Layer 3: schedule retry timers.
      if (nativeMatchedMessageIds.size > 0 && !sameTeamPersisted) {
        this.scheduleSameTeamPersistRetry(teamName);
      }
      if (deferredByAge.length > 0) {
        this.scheduleSameTeamDeferredRetry(teamName);
      }

      if (actionableUnread.length === 0) return 0;

      const MAX_RELAY = 10;
      const batch = actionableUnread.slice(0, MAX_RELAY);
      const batchIds = batch.map((message) => message.messageId);
      if (batchIds.length > 0) {
        const nextInFlightIds = this.inFlightLeadInboxMessageIds.get(teamName) ?? new Set<string>();
        for (const messageId of batchIds) {
          nextInFlightIds.add(messageId);
        }
        this.inFlightLeadInboxMessageIds.set(teamName, nextInFlightIds);
      }
      const teammateRoster = (config.members ?? [])
        .filter((member) => {
          const name = member.name?.trim();
          return name && name !== leadName;
        })
        .map((member) => ({
          name: member.name.trim(),
          ...(member.role?.trim() ? { role: member.role.trim() } : {}),
        }));
      const rosterContextBlock = buildLeadRosterContextBlock(teamName, leadName, teammateRoster);
      run.activeCrossTeamReplyHints = batch.flatMap((m) => {
        if (m.source !== 'cross_team') return [];
        const sourceTeam = m.from.includes('.') ? m.from.split('.', 1)[0] : '';
        const conversationId = m.conversationId ?? parseCrossTeamPrefix(m.text)?.conversationId;
        if (!sourceTeam || !conversationId) return [];
        return [{ toTeam: sourceTeam, conversationId }];
      });

      const message = [
        `You have new inbox messages addressed to you (team lead "${leadName}").`,
        `Process them in order (oldest first).`,
        `If action is required, delegate via task creation or SendMessage, and keep responses minimal.`,
        `IMPORTANT: Your text response here is shown to the user.`,
        `如果下面任一消息来自 "user" 或外部渠道（例如飞书），本轮必须给出一个发给 user 的简短回复。首选 SendMessage to="user"；不要让页面或渠道回复为空。`,
        `普通对话、追问、确认、状态询问或解释请求不需要创建任务；请直接回复 user。只有明确需要执行/跟进/交付的工作才进入任务看板；即使进入任务看板，也要 SendMessage "user" 说明状态。`,
        `对于外部渠道消息（例如飞书），你的文本响应也会发回该渠道。当外部发送者看起来期待回复时，请自然、简洁地回复。`,
        `如果你确实采取行动，请包含简短的人类可读摘要（例如 "已委派给 carol。"）。`,
        `如果没有需要采取的行动，请输出零文本。不要写“无需操作”、状态回声或任何其他无操作摘要。`,
        `对于不需要回复/评论/行动的纯系统通知、评论通知或常规成员可用性更新，请保持安静。`,
        `不要只用 agent-only 块响应。`,
        ...(rosterContextBlock ? [rosterContextBlock] : []),
        wrapAgentBlock(
          [
            `Internal note: for task assignments, prefer task_create and rely on the board/runtime notification path instead of sending a separate SendMessage for the same assignment.`,
            `For any MCP board tool call in this turn, teamName MUST be "${teamName}". Never use the lead/member name "${leadName}" as teamName.`,
            `Use task_create_from_message only for messages below that explicitly say "Eligible for task_create_from_message: yes" and provide a User MessageId. Never use task_create_from_message for teammate messages, system notifications, cross-team messages, or any inbox row that is not explicitly marked eligible.`,
            `如果下面消息标记为 Source: system_notification 且摘要类似 "Comment on #..."，只有在你有实质性看板更新时才通过 task_add_comment 回复（决策、阻塞、澄清答案、审查结果或具体下一步变化）。`,
            `不要发布纯确认型任务评论，例如 "收到"、"OK"、"在线"、"等待中" 或类似低信号回声。如果任务评论通知只是 FYI 且不需要持久更新，请保持安静。`,
            `如果下面消息包含隐藏的结构化 task-context 块，请把该块视为 teamName/taskId/commentId 的权威来源。不要从可见文本推断其他 id 或 namespace。`,
            `如果下面消息标记为 Source: cross_team，请调用名为 cross_team_send 的 MCP 工具。跨团队回复不要使用 SendMessage 或 message_send。`,
            `绝不要设置 recipient="cross_team_send" 或 to="cross_team_send"。"cross_team_send" 是工具名，不是成员。`,
          ].join('\n')
        ),
        ``,
        `Messages:`,
        ...batch.flatMap((m, idx) => {
          const summaryLine = m.summary?.trim() ? `Summary: ${m.summary.trim()}` : null;
          const isTaskCreateFromMessageEligible = m.source === 'user_sent';
          const externalChannelLine = m.externalChannel
            ? `   External channel: ${m.externalChannel.provider} / ${m.externalChannel.channelName ?? m.externalChannel.channelId} / chat ${m.externalChannel.chatId}`
            : null;
          const provenanceLines = isTaskCreateFromMessageEligible
            ? [`   Eligible for task_create_from_message: yes`, `   User MessageId: ${m.messageId}`]
            : [`   Eligible for task_create_from_message: no`];
          const crossTeamMeta =
            m.source === 'cross_team'
              ? {
                  origin: parseCrossTeamPrefix(m.text),
                  sourceTeam: m.from.includes('.') ? m.from.split('.', 1)[0] : null,
                }
              : null;
          const conversationId =
            m.replyToConversationId?.trim() ??
            m.conversationId ??
            crossTeamMeta?.origin?.conversationId;
          const replyInstructions =
            crossTeamMeta?.sourceTeam && conversationId
              ? [
                  `   Cross-team conversationId: ${conversationId}`,
                  `   调用名为 cross_team_send 的 MCP 工具，并设置 toTeam="${crossTeamMeta.sourceTeam}", conversationId="${conversationId}", replyToConversationId="${conversationId}"。不要使用 SendMessage 或 message_send。绝不要把 recipient/to 设为 "cross_team_send"。`,
                ]
              : [];
          const structuredTaskContextBlock = buildLeadInboxTaskContextBlock(m);
          return [
            `${idx + 1}) From: ${m.from || 'unknown'}`,
            `   Timestamp: ${m.timestamp}`,
            ...(summaryLine ? [`   ${summaryLine}`] : []),
            ...(typeof m.source === 'string' && m.source.trim()
              ? [`   Source: ${m.source.trim()}`]
              : []),
            ...(externalChannelLine ? [externalChannelLine] : []),
            ...provenanceLines,
            ...replyInstructions,
            ...(structuredTaskContextBlock ? [structuredTaskContextBlock] : []),
            `   Text:`,
            ...m.text.split('\n').map((line) => `   ${line}`),
            ``,
          ];
        }),
      ].join('\n');

      const captureTimeoutMs = 15_000;
      const captureIdleMs = 800;
      const capturePromise = new Promise<string>((resolve, reject) => {
        const timeoutHandle = setTimeout(() => {
          reject(new Error('Timed out waiting for lead reply'));
        }, captureTimeoutMs);
        const capture = {
          leadName,
          startedAt: nowIso(),
          textParts: [] as string[],
          settled: false,
          idleHandle: null as NodeJS.Timeout | null,
          idleMs: captureIdleMs,
          timeoutHandle,
          resolveOnce: (text: string) => {
            if (capture.settled) return;
            capture.settled = true;
            if (capture.idleHandle) {
              clearTimeout(capture.idleHandle);
              capture.idleHandle = null;
            }
            clearTimeout(capture.timeoutHandle);
            resolve(text);
          },
          rejectOnce: (error: string) => {
            if (capture.settled) return;
            capture.settled = true;
            if (capture.idleHandle) {
              clearTimeout(capture.idleHandle);
              capture.idleHandle = null;
            }
            clearTimeout(capture.timeoutHandle);
            reject(new Error(error));
          },
        };
        run.leadRelayCapture = capture;
      });

      try {
        await this.sendMessageToRun(run, message);
      } catch {
        if (run.leadRelayCapture) {
          clearTimeout(run.leadRelayCapture.timeoutHandle);
          run.leadRelayCapture = null;
        }
        return 0;
      }

      let replyText: string | null = null;
      let relayTurnCompleted = false;
      try {
        replyText = (await capturePromise).trim() || null;
        relayTurnCompleted = true;
      } catch {
        // Best-effort: if we captured some text but never got result.success, keep it.
        const partial = run.leadRelayCapture?.textParts?.join('')?.trim();
        replyText = partial && partial.length > 0 ? partial : null;
      } finally {
        if (run.leadRelayCapture) {
          if (run.leadRelayCapture.idleHandle) {
            clearTimeout(run.leadRelayCapture.idleHandle);
            run.leadRelayCapture.idleHandle = null;
          }
          clearTimeout(run.leadRelayCapture.timeoutHandle);
          run.leadRelayCapture = null;
        }
      }

      if (!relayTurnCompleted) {
        const currentInFlightIds = this.inFlightLeadInboxMessageIds.get(teamName);
        if (currentInFlightIds) {
          for (const messageId of batchIds) {
            currentInFlightIds.delete(messageId);
          }
          if (currentInFlightIds.size === 0) {
            this.inFlightLeadInboxMessageIds.delete(teamName);
          }
        }
        logger.warn(
          `[${teamName}] lead inbox relay did not complete; leaving ${batch.length} message(s) unread for retry`
        );
        return 0;
      }

      for (const m of batch) {
        relayedIds.add(m.messageId);
      }
      this.relayedLeadInboxMessageIds.set(teamName, this.trimRelayedSet(relayedIds));
      const currentInFlightIds = this.inFlightLeadInboxMessageIds.get(teamName);
      if (currentInFlightIds) {
        for (const messageId of batchIds) {
          currentInFlightIds.delete(messageId);
        }
        if (currentInFlightIds.size === 0) {
          this.inFlightLeadInboxMessageIds.delete(teamName);
        }
      }
      this.rememberRecentCrossTeamLeadDeliveryMessageIds(
        teamName,
        batch
          .filter((message) => message.source === CROSS_TEAM_SOURCE)
          .map((message) => message.messageId)
      );

      try {
        await this.markInboxMessagesRead(teamName, leadName, batch);
      } catch {
        // Best-effort: relay turn completed; marking read failed.
      }

      // Strip agent-only blocks — lead may respond with pure coordination content
      // that is not meant for the human user.
      const cleanReply = replyText ? stripAgentBlocks(replyText) : null;
      if (cleanReply) {
        const externalTargets = new Map<string, NonNullable<InboxMessage['externalChannel']>>();
        for (const message of batch) {
          const channel = message.externalChannel;
          if (channel?.provider !== 'feishu') continue;
          externalTargets.set(`${channel.channelId}:${channel.chatId}`, channel);
        }
        for (const channel of externalTargets.values()) {
          try {
            await getLeadChannelListenerService().sendFeishuReply(
              channel.channelId,
              channel.chatId,
              cleanReply
            );
          } catch (error: unknown) {
            logger.warn(
              `[${teamName}] Failed to send lead reply to Feishu channel ${channel.channelId}: ${String(error)}`
            );
          }
        }

        const relayMsg: InboxMessage = {
          from: leadName,
          to: 'user',
          text: cleanReply,
          timestamp: nowIso(),
          read: true,
          summary: cleanReply.length > 60 ? cleanReply.slice(0, 57) + '...' : cleanReply,
          messageId: `lead-process-${runId}-${Date.now()}`,
          source: 'lead_process',
        };
        this.pushLiveLeadProcessMessage(teamName, relayMsg);
        if (externalTargets.size === 0) {
          this.pushLeadUserMessageToRecentFeishu(teamName, cleanReply);
        }
        // Persist to disk so relayed replies survive app restart and trigger FileWatcher
        this.persistSentMessage(teamName, relayMsg);
        this.teamChangeEmitter?.({
          type: 'inbox',
          teamName,
          detail: 'lead-process-reply',
        });
      }

      return batch.length;
    })();

    this.leadInboxRelayInFlight.set(teamName, work);
    try {
      return await work;
    } finally {
      if (this.leadInboxRelayInFlight.get(teamName) === work) {
        this.leadInboxRelayInFlight.delete(teamName);
      }
    }
  }

  /**
   * Check if a team has an active provisioning run (started but not yet finished).
   */
  hasProvisioningRun(teamName: string): boolean {
    return this.provisioningRunByTeam.has(teamName);
  }

  /**
   * Check if a team has a live process.
   */
  isTeamAlive(teamName: string): boolean {
    const runId = this.getAliveRunId(teamName);
    if (!runId) return false;
    if (this.remoteRuntimeByTeam.get(teamName)?.runId === runId) {
      return true;
    }
    const run = this.runs.get(runId);
    if (!run && this.runtimeAdapterRunByTeam.get(teamName)?.runId === runId) {
      return true;
    }
    return run?.child != null && !run.processKilled && !run.cancelRequested;
  }

  /**
   * Get list of teams with active processes.
   */
  getAliveTeams(): string[] {
    return Array.from(this.aliveRunByTeam.keys()).filter((name) => this.isTeamAlive(name));
  }

  getTeamSendBlockReason(teamName: string): string | null {
    return this.teamSendBlockReasonByTeam.get(teamName) ?? null;
  }

  getLeadUserSendBlockReason(teamName: string): string | null {
    const explicitReason = this.getTeamSendBlockReason(teamName);
    if (explicitReason) return explicitReason;

    const runId = this.getTrackedRunId(teamName);
    if (!runId) return null;
    const run = this.runs.get(runId);
    if (!run || run.processKilled || run.cancelRequested) return null;
    if (!run.provisioningComplete) {
      return '负责人正在启动或重试中，暂时不能发送新消息。请稍后再试。';
    }
    if (run.leadActivityState !== 'idle') {
      return '负责人正在处理上一条消息，暂时不能发送新消息。请等当前回复结束后再试。';
    }
    return null;
  }

  async getRuntimeState(teamName: string): Promise<TeamRuntimeState> {
    const runId = this.getTrackedRunId(teamName);
    const remoteRun = this.remoteRuntimeByTeam.get(teamName);
    if (remoteRun?.runId === runId) {
      return {
        teamName,
        isAlive: true,
        runId,
        progress: {
          runId,
          teamName,
          state: 'ready',
          message: `远程运行中：${remoteRun.machineId}`,
          startedAt: remoteRun.startedAt,
          updatedAt: nowIso(),
          pid: remoteRun.pid,
          configReady: true,
        },
      };
    }
    const run = runId ? (this.runs.get(runId) ?? null) : null;

    if (!run) {
      const recovered = await readBootstrapRuntimeState(teamName);
      if (recovered) {
        return recovered;
      }
    }

    return {
      teamName,
      isAlive: this.isTeamAlive(teamName),
      runId: run?.runId ?? runId ?? null,
      progress:
        run?.progress ?? (runId ? (this.runtimeAdapterProgressByRunId.get(runId) ?? null) : null),
    };
  }

  private languageChangeInFlight: Promise<void> = Promise.resolve();

  /**
   * Notify alive teams when the agent language setting changes.
   * Compares each team's stored `config.language` with the new code and sends
   * a message to the team lead if they differ.
   *
   * Serialised: rapid language switches (e.g. ru → en → ru) are queued so that
   * only the latest value is applied to each team.
   */
  async notifyLanguageChange(newLangCode: string): Promise<void> {
    this.languageChangeInFlight = this.languageChangeInFlight.then(() =>
      this.doNotifyLanguageChange(newLangCode)
    );
    return this.languageChangeInFlight;
  }

  private async doNotifyLanguageChange(newLangCode: string): Promise<void> {
    const aliveTeams = this.getAliveTeams();
    if (aliveTeams.length === 0) return;

    const systemLocale = getSystemLocale();
    const newResolved = resolveLanguageName(newLangCode, systemLocale);

    for (const teamName of aliveTeams) {
      try {
        const config = await this.configReader.getConfig(teamName);
        if (!config) continue;

        const oldCode = config.language || 'system';
        if (oldCode === newLangCode) continue;

        // Compare resolved names to avoid spurious notifications
        // e.g. switching from 'ru' to 'system' when system locale is Russian
        const oldResolved = resolveLanguageName(oldCode, systemLocale);
        if (oldResolved === newResolved) {
          // Effective language unchanged — just update stored code silently
          await this.configReader.updateConfig(teamName, { language: newLangCode });
          continue;
        }

        const message =
          `用户已将首选沟通语言从 "${oldResolved}" 改为 "${newResolved}"。` +
          `后续所有回复请切换为 ${newResolved}，并将此变更广播给所有成员，` +
          `让他们也切换为 ${newResolved}。`;

        await this.sendMessageToTeam(teamName, message);
        await this.configReader.updateConfig(teamName, { language: newLangCode });
        logger.info(`[${teamName}] Notified about language change: ${oldCode} → ${newLangCode}`);
      } catch (error) {
        logger.warn(
          `[${teamName}] Failed to notify language change: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }
    }
  }

  private async markInboxMessagesRead(
    teamName: string,
    member: string,
    messages: { messageId: string }[]
  ): Promise<void> {
    const inboxPath = path.join(getTeamsBasePath(), teamName, 'inboxes', `${member}.json`);

    await withFileLock(inboxPath, async () => {
      await withInboxLock(inboxPath, async () => {
        const raw = await tryReadRegularFileUtf8(inboxPath, {
          timeoutMs: TEAM_JSON_READ_TIMEOUT_MS,
          maxBytes: TEAM_INBOX_MAX_BYTES,
        });
        if (!raw) {
          return;
        }

        let parsed: unknown;
        try {
          parsed = JSON.parse(raw) as unknown;
        } catch {
          return;
        }
        if (!Array.isArray(parsed)) return;

        const ids = new Set(messages.map((m) => m.messageId).filter((id) => id.trim().length > 0));

        let changed = false;
        for (const item of parsed) {
          if (!item || typeof item !== 'object') continue;
          const row = item as Record<string, unknown>;
          const msgId = getEffectiveInboxMessageId(row);
          if (!msgId || !ids.has(msgId)) continue;

          if (row.read !== true) {
            row.read = true;
            changed = true;
          }
        }

        if (!changed) return;
        await atomicWriteAsync(inboxPath, JSON.stringify(parsed, null, 2));
      });
    });
  }

  private trimRelayedSet(set: Set<string>): Set<string> {
    const MAX_IDS = 2000;
    if (set.size <= MAX_IDS) return set;
    const next = new Set<string>();
    const tail = Array.from(set).slice(-MAX_IDS);
    for (const id of tail) next.add(id);
    return next;
  }

  /**
   * Intercept SendMessage tool_use blocks from the lead's stream-json output.
   *
   * Claude Code's internal teamContext may be lost after session resume (--resume), causing
   * SendMessage routing to drift away from our canonical team artifacts. By capturing tool_use
   * calls directly from stdout, we persist a durable message row under the correct team name so
   * Messages stays accurate even if Claude's own routing is flaky.
   */
  /**
   * Intercept Task tool_use blocks that spawn team members.
   * Sets member spawn status to 'spawning' when the lead issues a Task call with team_name + name.
   */
  private captureTeamSpawnEvents(run: ProvisioningRun, content: Record<string, unknown>[]): void {
    for (const part of content) {
      if (part.type !== 'tool_use' || part.name !== 'Agent') continue;
      const input = part.input;
      if (!input || typeof input !== 'object') continue;
      const inp = input as Record<string, unknown>;
      const teamName = typeof inp.team_name === 'string' ? inp.team_name.trim() : '';
      const memberName = typeof inp.name === 'string' ? inp.name.trim() : '';
      if (teamName && !memberName) {
        logger.warn(
          `[captureTeamSpawnEvents] Agent call for team "${run.teamName}" is missing name - ` +
            `runtime will spawn an ephemeral subagent instead of a persistent teammate`
        );
        continue;
      }
      if (!memberName) continue;
      if (!teamName) {
        logger.warn(
          `[captureTeamSpawnEvents] Agent call for "${memberName}" is missing team_name - ` +
            `teammate will be an ephemeral subagent, not a persistent member of "${run.teamName}"`
        );
        this.setMemberSpawnStatus(
          run,
          memberName,
          'error',
          `Agent spawn for "${memberName}" is missing team_name - spawned as ephemeral subagent instead of persistent teammate`
        );
        continue;
      }
      // Only track spawns for this team
      if (teamName !== run.teamName) continue;

      // Lead can only spawn pre-configured members, not create new ones
      const resolvedName = this.resolveExpectedLaunchMemberName(run.expectedMembers, memberName);
      if (!resolvedName) {
        this.setMemberSpawnStatus(
          run,
          memberName,
          'error',
          `Member "${memberName}" is not in the configured roster — lead cannot create new teammates, only assign existing ones`
        );
        continue;
      }

      const existing = run.memberSpawnStatuses.get(resolvedName);
      if (
        existing &&
        !existing.hardFailure &&
        (existing.bootstrapConfirmed || existing.runtimeAlive || existing.agentToolAccepted)
      ) {
        this.appendMemberBootstrapDiagnostic(
          run,
          resolvedName,
          'respawn blocked as duplicate - teammate already online'
        );
        continue;
      }
      this.setMemberSpawnStatus(run, resolvedName, 'spawning');
      const toolUseId = typeof part.id === 'string' ? part.id.trim() : '';
      if (toolUseId) {
        run.memberSpawnToolUseIds.set(toolUseId, resolvedName);
      }

      // Advance stepper to "Members joining" when first member spawn is detected
      if (
        !run.provisioningComplete &&
        (run.progress.state === 'configuring' || run.progress.state === 'spawning')
      ) {
        const progress = updateProgress(run, 'assembling', `Spawning member ${resolvedName}...`);
        run.onProgress(progress);
      }
    }
  }

  /**
   * Post-provisioning audit: read config.json members and flag any expectedMember
   * that was NOT registered by Claude Code as a team member.
   *
   * This is the ground-truth check — when Agent(team_name=X, name=Y) succeeds,
   * the CLI adds Y to config.json members[]. If a member is missing, the spawn
   * was incorrect (e.g., missing team_name/name params) and the agent ran as a
   * one-shot subagent instead of a persistent teammate.
   */
  private async getRegisteredTeamMemberNames(teamName: string): Promise<Set<string> | null> {
    const configPath = path.join(getTeamsBasePath(), teamName, 'config.json');
    try {
      const raw = await tryReadRegularFileUtf8(configPath, {
        timeoutMs: TEAM_JSON_READ_TIMEOUT_MS,
        maxBytes: TEAM_CONFIG_MAX_BYTES,
      });
      if (!raw) {
        return null;
      }
      const config = JSON.parse(raw) as {
        members?: { name?: string; agentType?: string }[];
      };
      return new Set(
        (config.members ?? [])
          .map((m) => (typeof m.name === 'string' ? m.name.trim() : ''))
          .filter(Boolean)
      );
    } catch {
      return null;
    }
  }

  private async auditMemberSpawnStatuses(run: ProvisioningRun): Promise<void> {
    if (!run.expectedMembers || run.expectedMembers.length === 0) return;

    // Read config.json to get the actual registered members
    const registeredNames = await this.getRegisteredTeamMemberNames(run.teamName);
    if (!registeredNames) {
      try {
        await fs.promises.access(path.join(getTeamsBasePath(), run.teamName));
      } catch {
        return;
      }
      const now = Date.now();
      if (
        shouldWarnOnUnreadableMemberAuditConfig({
          nowMs: now,
          lastWarnAt: run.lastMemberSpawnAuditConfigReadWarningAt,
          expectedMembers: run.expectedMembers,
          memberSpawnStatuses: run.memberSpawnStatuses,
        })
      ) {
        run.lastMemberSpawnAuditConfigReadWarningAt = now;
        logger.warn(`[${run.teamName}] auditMemberSpawnStatuses: config.json not readable`);
      }
      return;
    }

    const liveAgentNames = await this.getLiveTeamAgentNames(run.teamName);

    // Flag any expected member not found in config.json (excluding the lead)
    for (const expected of run.expectedMembers) {
      const current = run.memberSpawnStatuses.get(expected);
      if (
        current?.launchState === 'failed_to_start' ||
        current?.launchState === 'confirmed_alive' ||
        current?.launchState === 'skipped_for_launch' ||
        current?.skippedForLaunch === true
      ) {
        continue;
      }

      const matchedRuntimeNames = [...registeredNames].filter((name) => {
        if (name === expected) return true;
        const parsed = parseNumericSuffixName(name);
        return parsed !== null && parsed.suffix >= 2 && parsed.base === expected;
      });

      const runtimeAlive =
        liveAgentNames.has(expected) ||
        matchedRuntimeNames.some((runtimeName) => liveAgentNames.has(runtimeName));

      // A teammate may intentionally stay silent after bootstrap. If Claude Code
      // registered the runtime and the OS process is still alive, treat it as
      // process-confirmed running. Keep this distinct from heartbeat-confirmed online.
      if (runtimeAlive) {
        this.setMemberSpawnStatus(run, expected, 'online', undefined, 'process');
        continue;
      }

      if (matchedRuntimeNames.length > 0) {
        if (current?.agentToolAccepted) {
          this.setMemberSpawnStatus(run, expected, 'waiting');
        }
        continue;
      }

      const acceptedAtMs =
        current?.firstSpawnAcceptedAt != null ? Date.parse(current.firstSpawnAcceptedAt) : NaN;
      const graceExpired =
        current?.agentToolAccepted === true &&
        Number.isFinite(acceptedAtMs) &&
        Date.now() - acceptedAtMs >= MEMBER_LAUNCH_GRACE_MS;

      if (current?.agentToolAccepted && !graceExpired) {
        this.setMemberSpawnStatus(run, expected, 'waiting');
        continue;
      }

      const now = Date.now();
      const lastWarnAt = run.lastMemberSpawnAuditMissingWarningAt.get(expected) ?? 0;
      if (
        shouldWarnOnMissingRegisteredMember({
          nowMs: now,
          lastWarnAt,
          graceExpired,
        })
      ) {
        run.lastMemberSpawnAuditMissingWarningAt.set(expected, now);
        logger.warn(
          `[${run.teamName}] Member "${expected}" not found in config.json members after provisioning`
        );
      }
      if (graceExpired) {
        this.setMemberSpawnStatus(
          run,
          expected,
          'error',
          'Teammate not registered after provisioning within the launch grace window.'
        );
      }
    }
  }

  private async finalizeMissingRegisteredMembersAsFailed(run: ProvisioningRun): Promise<void> {
    if (!run.expectedMembers || run.expectedMembers.length === 0) return;
    const registeredNames = await this.getRegisteredTeamMemberNames(run.teamName);
    if (!registeredNames) {
      return;
    }

    for (const expected of run.expectedMembers) {
      const matchedRuntimeNames = [...registeredNames].filter((name) => {
        if (name === expected) return true;
        const parsed = parseNumericSuffixName(name);
        return parsed !== null && parsed.suffix >= 2 && parsed.base === expected;
      });

      if (matchedRuntimeNames.length > 0) {
        continue;
      }

      const current = run.memberSpawnStatuses.get(expected);
      if (
        current?.launchState === 'failed_to_start' ||
        current?.launchState === 'skipped_for_launch' ||
        current?.skippedForLaunch === true ||
        current?.bootstrapConfirmed ||
        current?.runtimeAlive
      ) {
        continue;
      }

      this.appendMemberBootstrapDiagnostic(
        run,
        expected,
        'not registered in config.json yet; keeping launch pending'
      );
      this.emitMemberSpawnChange(run, expected);
    }
  }

  private async attachLiveRuntimeMetadataToStatuses(
    teamName: string,
    statuses: Record<string, MemberSpawnStatusEntry>
  ): Promise<Record<string, MemberSpawnStatusEntry>> {
    const runtimeByMember = await this.getLiveTeamAgentRuntimeMetadata(teamName);
    const nextStatuses = { ...statuses };
    for (const [memberName, metadata] of runtimeByMember.entries()) {
      const resolvedStatusKey =
        nextStatuses[memberName] != null
          ? memberName
          : (() => {
              const matches = Object.keys(nextStatuses).filter((candidateName) =>
                matchesObservedMemberNameForExpected(memberName, candidateName)
              );
              return matches.length === 1 ? matches[0] : null;
            })();
      if (!resolvedStatusKey) {
        continue;
      }
      const current = nextStatuses[resolvedStatusKey];
      if (!current) {
        continue;
      }
      if (current.launchState === 'skipped_for_launch' || current.skippedForLaunch === true) {
        nextStatuses[resolvedStatusKey] = {
          ...current,
          status: 'skipped',
          launchState: 'skipped_for_launch',
          skippedForLaunch: true,
          runtimeAlive: false,
          bootstrapConfirmed: false,
          hardFailure: false,
          hardFailureReason: undefined,
          error: undefined,
          livenessSource: undefined,
          livenessLastCheckedAt: nowIso(),
        };
        continue;
      }
      const runtimeDiagnostic = buildRuntimeDiagnosticForSpawn(metadata);
      const nextEntry: MemberSpawnStatusEntry = {
        ...current,
        ...(metadata.model ? { runtimeModel: metadata.model } : {}),
        ...(metadata.livenessKind ? { livenessKind: metadata.livenessKind } : {}),
        ...(runtimeDiagnostic ? { runtimeDiagnostic } : {}),
        ...(metadata.runtimeDiagnosticSeverity
          ? { runtimeDiagnosticSeverity: metadata.runtimeDiagnosticSeverity }
          : {}),
        livenessLastCheckedAt: nowIso(),
      };
      const failureReason = current.hardFailureReason ?? current.error;
      const hasStrongEvidence = isStrongRuntimeEvidence(metadata);
      const hasWeakEvidence =
        metadata.livenessKind != null &&
        !isStrongRuntimeEvidence(metadata) &&
        current.bootstrapConfirmed !== true;
      if (
        hasStrongEvidence &&
        current.hardFailure !== true &&
        current.launchState !== 'failed_to_start'
      ) {
        nextEntry.status = 'online';
        nextEntry.agentToolAccepted = true;
        nextEntry.runtimeAlive = true;
        nextEntry.hardFailure = false;
        nextEntry.hardFailureReason = undefined;
        nextEntry.error = undefined;
        nextEntry.livenessSource = current.bootstrapConfirmed ? current.livenessSource : 'process';
        nextEntry.launchState = deriveMemberLaunchState(nextEntry);
      }
      if (
        hasStrongEvidence &&
        current.launchState === 'failed_to_start' &&
        isAutoClearableLaunchFailureReason(failureReason)
      ) {
        nextEntry.status = 'online';
        nextEntry.agentToolAccepted = true;
        nextEntry.runtimeAlive = true;
        nextEntry.hardFailure = false;
        nextEntry.hardFailureReason = undefined;
        nextEntry.error = undefined;
        nextEntry.livenessSource = current.bootstrapConfirmed ? current.livenessSource : 'process';
        nextEntry.launchState = deriveMemberLaunchState(nextEntry);
      }
      if (hasWeakEvidence) {
        nextEntry.runtimeAlive = false;
        if (nextEntry.livenessSource === 'process') {
          nextEntry.livenessSource = undefined;
        }
        if (
          current.launchState === 'runtime_pending_bootstrap' ||
          current.launchState === 'runtime_pending_permission'
        ) {
          nextEntry.agentToolAccepted = true;
        }
        if (
          current.status === 'online' &&
          current.hardFailure !== true &&
          current.launchState !== 'failed_to_start'
        ) {
          nextEntry.status = nextEntry.agentToolAccepted ? 'waiting' : 'spawning';
        }
        nextEntry.launchState = deriveMemberLaunchState(nextEntry);
      }
      nextStatuses[resolvedStatusKey] = nextEntry;
    }
    return nextStatuses;
  }

  private async getLiveTeamAgentNames(teamName: string): Promise<Set<string>> {
    const runtimeByMember = await this.getLiveTeamAgentRuntimeMetadata(teamName);
    return new Set(
      [...runtimeByMember.entries()]
        .filter(([, metadata]) => metadata.alive)
        .map(([memberName]) => memberName)
    );
  }

  private findConfiguredMemberModel(
    configuredMembers: TeamConfig['members'] | undefined,
    memberName: string
  ): string | undefined {
    for (const member of configuredMembers ?? []) {
      const candidateName = typeof member?.name === 'string' ? member.name.trim() : '';
      if (!candidateName || !matchesExactTeamMemberName(candidateName, memberName)) {
        continue;
      }
      const model = member.model?.trim();
      if (model) {
        return model;
      }
    }
    return undefined;
  }

  private findMetaMemberModel(
    metaMembers: Awaited<ReturnType<TeamMembersMetaStore['getMembers']>>,
    memberName: string
  ): string | undefined {
    for (const member of metaMembers) {
      const candidateName = member.name?.trim() ?? '';
      if (!candidateName || !matchesExactTeamMemberName(candidateName, memberName)) {
        continue;
      }
      const model = member.model?.trim();
      if (model) {
        return model;
      }
    }
    return undefined;
  }

  private resolveEffectiveConfiguredMember(
    configuredMembers: TeamConfig['members'] | undefined,
    metaMembers: Awaited<ReturnType<TeamMembersMetaStore['getMembers']>>,
    memberName: string
  ): {
    name: string;
    role?: string;
    workflow?: string;
    isolation?: 'worktree';
    providerId?: TeamProviderId;
    providerBackendId?: TeamProviderBackendId;
    model?: string;
    effort?: EffortLevel;
    fastMode?: TeamFastMode;
    cwd?: string;
    agentType?: string;
    removedAt?: number | string;
  } | null {
    const configuredMember = (configuredMembers ?? []).find((member) => {
      const candidateName = typeof member?.name === 'string' ? member.name.trim() : '';
      return candidateName.length > 0 && matchesExactTeamMemberName(candidateName, memberName);
    });
    const metaMember = metaMembers.find((member) => {
      const candidateName = member.name?.trim() ?? '';
      return candidateName.length > 0 && matchesExactTeamMemberName(candidateName, memberName);
    });

    if (!configuredMember && !metaMember) {
      return null;
    }

    const name =
      metaMember?.name?.trim() || configuredMember?.name?.trim() || memberName.trim() || memberName;
    const role = metaMember?.role?.trim() || configuredMember?.role?.trim() || undefined;
    const workflow =
      metaMember?.workflow?.trim() || configuredMember?.workflow?.trim() || undefined;
    const isolation =
      metaMember?.isolation === 'worktree' || configuredMember?.isolation === 'worktree'
        ? 'worktree'
        : undefined;
    const providerId =
      normalizeTeamMemberProviderId(metaMember?.providerId) ??
      normalizeTeamMemberProviderId(configuredMember?.providerId);
    const providerBackendId =
      migrateProviderBackendId(metaMember?.providerId, metaMember?.providerBackendId) ??
      migrateProviderBackendId(configuredMember?.providerId, configuredMember?.providerBackendId);
    const model = metaMember?.model?.trim() || configuredMember?.model?.trim() || undefined;
    const effort = isTeamEffortLevel(metaMember?.effort)
      ? metaMember.effort
      : isTeamEffortLevel(configuredMember?.effort)
        ? configuredMember.effort
        : undefined;
    const fastMode =
      metaMember?.fastMode === 'inherit' ||
      metaMember?.fastMode === 'on' ||
      metaMember?.fastMode === 'off'
        ? metaMember.fastMode
        : configuredMember?.fastMode === 'inherit' ||
            configuredMember?.fastMode === 'on' ||
            configuredMember?.fastMode === 'off'
          ? configuredMember.fastMode
          : undefined;
    const agentType =
      metaMember?.agentType?.trim() || configuredMember?.agentType?.trim() || undefined;
    const cwd = metaMember?.cwd?.trim() || configuredMember?.cwd?.trim() || undefined;
    const removedAt = metaMember?.removedAt ?? configuredMember?.removedAt;

    return {
      name,
      ...(role ? { role } : {}),
      ...(workflow ? { workflow } : {}),
      ...(isolation ? { isolation } : {}),
      ...(providerId ? { providerId } : {}),
      ...(providerBackendId ? { providerBackendId } : {}),
      ...(model ? { model } : {}),
      ...(effort ? { effort } : {}),
      ...(fastMode ? { fastMode } : {}),
      ...(cwd ? { cwd } : {}),
      ...(agentType ? { agentType } : {}),
      ...(removedAt != null ? { removedAt } : {}),
    };
  }

  private resolveLeadMemberName(
    configuredMembers: TeamConfig['members'] | undefined,
    metaMembers: Awaited<ReturnType<TeamMembersMetaStore['getMembers']>>
  ): string {
    const configuredLead = (configuredMembers ?? []).find((member) => isLeadMember(member));
    const configuredLeadName = configuredLead?.name?.trim();
    if (configuredLeadName) {
      return configuredLeadName;
    }

    const metaLead = metaMembers.find((member) => isLeadMember(member));
    const metaLeadName = metaLead?.name?.trim();
    if (metaLeadName) {
      return metaLeadName;
    }

    return CANONICAL_LEAD_MEMBER_NAME;
  }

  private isMemberRemovedInMeta(
    metaMembers: Awaited<ReturnType<TeamMembersMetaStore['getMembers']>>,
    memberName: string
  ): boolean {
    const normalizedMemberName = memberName.trim().toLowerCase();
    if (!normalizedMemberName) {
      return false;
    }
    return metaMembers.some((member) => {
      const candidateName = member.name?.trim().toLowerCase() ?? '';
      return (
        candidateName.length > 0 &&
        candidateName === normalizedMemberName &&
        Boolean(member.removedAt)
      );
    });
  }

  private filterRemovedMembersFromLaunchSnapshot(
    snapshot: PersistedTeamLaunchSnapshot,
    metaMembers: Awaited<ReturnType<TeamMembersMetaStore['getMembers']>>
  ): PersistedTeamLaunchSnapshot {
    const removedNames = new Set(
      metaMembers
        .filter((member) => Boolean(member.removedAt))
        .map((member) => member.name?.trim().toLowerCase() ?? '')
        .filter((name) => name.length > 0)
    );
    if (removedNames.size === 0) {
      return snapshot;
    }

    const isRemoved = (name: string | undefined): boolean => {
      const normalized = name?.trim().toLowerCase() ?? '';
      return normalized.length > 0 && removedNames.has(normalized);
    };
    const expectedMembers = this.getPersistedLaunchMemberNames(snapshot).filter(
      (name) => !isRemoved(name)
    );
    const members: Record<string, PersistedTeamLaunchMemberState> = {};
    for (const [memberName, member] of Object.entries(snapshot.members)) {
      if (isRemoved(memberName) || isRemoved(member.name)) {
        continue;
      }
      members[memberName] = { ...member };
    }

    return createPersistedLaunchSnapshot({
      teamName: snapshot.teamName,
      expectedMembers,
      bootstrapExpectedMembers: snapshot.bootstrapExpectedMembers?.filter(
        (name) => !isRemoved(name)
      ),
      leadSessionId: snapshot.leadSessionId,
      launchPhase: snapshot.launchPhase,
      members,
      updatedAt: snapshot.updatedAt,
    });
  }

  private findEffectiveRunMemberModel(
    run: ProvisioningRun | null,
    memberName: string
  ): string | undefined {
    if (!run) {
      return undefined;
    }
    for (const member of run.effectiveMembers ?? []) {
      const candidateName = member.name?.trim() ?? '';
      if (!candidateName || !matchesTeamMemberIdentity(candidateName, memberName)) {
        continue;
      }
      const model = member.model?.trim();
      if (model) {
        return model;
      }
    }
    return undefined;
  }

  private findTrackedMemberSpawnStatus(
    run: ProvisioningRun | null,
    memberName: string
  ): MemberSpawnStatusEntry | undefined {
    if (!run) {
      return undefined;
    }
    const statusMap = run.memberSpawnStatuses instanceof Map ? run.memberSpawnStatuses : undefined;
    if (!statusMap) {
      return undefined;
    }
    const direct = statusMap.get(memberName);
    if (direct) {
      return direct;
    }
    for (const [candidateName, entry] of statusMap.entries()) {
      if (matchesTeamMemberIdentity(candidateName, memberName)) {
        return entry;
      }
    }
    return undefined;
  }

  private async getLiveTeamAgentRuntimeMetadata(
    teamName: string
  ): Promise<Map<string, LiveTeamAgentRuntimeMetadata>> {
    const cached = this.liveTeamAgentRuntimeMetadataCache.get(teamName);
    if (cached && cached.expiresAtMs > Date.now()) {
      return cached.metadata;
    }

    const runId = this.getTrackedRunId(teamName);
    const run = runId ? (this.runs.get(runId) ?? null) : null;

    let configuredMembers: TeamConfig['members'] = [];
    try {
      configuredMembers = (await this.configReader.getConfig(teamName))?.members ?? [];
    } catch {
      configuredMembers = [];
    }

    let metaMembers: Awaited<ReturnType<TeamMembersMetaStore['getMembers']>> = [];
    try {
      metaMembers = await this.membersMetaStore.getMembers(teamName);
    } catch {
      metaMembers = [];
    }

    const persistedRuntimeMembers = this.readPersistedRuntimeMembers(teamName);
    const metadataByMember = new Map<string, LiveTeamAgentRuntimeMetadata>();
    const upsertMetadata = (
      memberName: string,
      patch: Partial<LiveTeamAgentRuntimeMetadata>
    ): void => {
      const current = metadataByMember.get(memberName) ?? { alive: false };
      metadataByMember.set(memberName, {
        ...current,
        ...patch,
        alive: patch.alive ?? current.alive,
      });
    };

    for (const member of persistedRuntimeMembers) {
      const memberName = typeof member.name === 'string' ? member.name.trim() : '';
      if (
        !memberName ||
        this.isMemberRemovedInMeta(metaMembers, memberName) ||
        isLeadMember({ name: memberName })
      ) {
        continue;
      }
      const runtimeModel =
        this.findConfiguredMemberModel(configuredMembers, memberName) ??
        this.findEffectiveRunMemberModel(run, memberName) ??
        this.findMetaMemberModel(metaMembers, memberName);
      upsertMetadata(memberName, {
        backendType: normalizeTeamAgentRuntimeBackendType(member.backendType, false),
        providerId: normalizeOptionalTeamProviderId(member.providerId),
        agentId:
          typeof member.agentId === 'string' ? member.agentId.trim() || undefined : undefined,
        tmuxPaneId:
          typeof member.tmuxPaneId === 'string' ? member.tmuxPaneId.trim() || undefined : undefined,
        ...(normalizeRuntimePositiveInteger(member.runtimePid)
          ? { metricsPid: normalizeRuntimePositiveInteger(member.runtimePid) }
          : {}),
        ...(typeof member.runtimeSessionId === 'string' && member.runtimeSessionId.trim()
          ? { runtimeSessionId: member.runtimeSessionId.trim() }
          : {}),
        ...(typeof member.cwd === 'string' && member.cwd.trim() ? { cwd: member.cwd.trim() } : {}),
        ...(runtimeModel ? { model: runtimeModel } : {}),
      });
    }

    for (const member of configuredMembers) {
      const memberName = typeof member?.name === 'string' ? member.name.trim() : '';
      if (
        !memberName ||
        this.isMemberRemovedInMeta(metaMembers, memberName) ||
        isLeadMember({ name: memberName, agentType: member.agentType })
      ) {
        continue;
      }
      const configuredRuntimeMember = member as unknown as Record<string, unknown>;
      const configuredAgentId =
        typeof configuredRuntimeMember.agentId === 'string'
          ? configuredRuntimeMember.agentId.trim()
          : '';
      const configuredTmuxPaneId =
        typeof configuredRuntimeMember.tmuxPaneId === 'string'
          ? configuredRuntimeMember.tmuxPaneId.trim()
          : '';
      const configuredBackendType =
        typeof configuredRuntimeMember.backendType === 'string'
          ? configuredRuntimeMember.backendType
          : undefined;
      const runtimeModel =
        member.model?.trim() ||
        this.findEffectiveRunMemberModel(run, memberName) ||
        this.findMetaMemberModel(metaMembers, memberName);
      upsertMetadata(memberName, {
        ...(runtimeModel ? { model: runtimeModel } : {}),
        ...(configuredAgentId ? { agentId: configuredAgentId } : {}),
        ...(configuredTmuxPaneId ? { tmuxPaneId: configuredTmuxPaneId } : {}),
        ...(normalizeOptionalTeamProviderId(member.providerId)
          ? { providerId: normalizeOptionalTeamProviderId(member.providerId) }
          : {}),
        ...(typeof member.cwd === 'string' && member.cwd.trim() ? { cwd: member.cwd.trim() } : {}),
        ...(normalizeTeamAgentRuntimeBackendType(configuredBackendType, false)
          ? {
              backendType: normalizeTeamAgentRuntimeBackendType(configuredBackendType, false),
            }
          : {}),
      });
    }

    for (const member of metaMembers) {
      const memberName = typeof member?.name === 'string' ? member.name.trim() : '';
      if (
        !memberName ||
        member.removedAt ||
        isLeadMember({ name: memberName, agentType: member.agentType })
      ) {
        continue;
      }
      const runtimeModel =
        member.model?.trim() ||
        this.findConfiguredMemberModel(configuredMembers, memberName) ||
        this.findEffectiveRunMemberModel(run, memberName);
      upsertMetadata(memberName, {
        ...(runtimeModel ? { model: runtimeModel } : {}),
        ...(normalizeOptionalTeamProviderId(member.providerId)
          ? { providerId: normalizeOptionalTeamProviderId(member.providerId) }
          : {}),
        ...(typeof member.agentId === 'string' && member.agentId.trim()
          ? { agentId: member.agentId.trim() }
          : {}),
        ...(typeof member.cwd === 'string' && member.cwd.trim() ? { cwd: member.cwd.trim() } : {}),
      });
    }

    for (const member of run?.effectiveMembers ?? []) {
      const memberName = member.name?.trim() ?? '';
      if (!memberName || isLeadMember(member) || memberName.toLowerCase() === 'user') {
        continue;
      }
      upsertMetadata(memberName, {
        ...(member.model?.trim() ? { model: member.model.trim() } : {}),
      });
    }

    for (const lane of run?.mixedSecondaryLanes ?? []) {
      const memberName = lane.member.name?.trim() ?? '';
      if (!memberName || this.isMemberRemovedInMeta(metaMembers, memberName)) {
        continue;
      }
      const evidence = lane.result?.members[memberName];
      const runtimeModel = lane.member.model?.trim() || undefined;
      const laneMemberCwd =
        typeof (lane.member as { cwd?: unknown }).cwd === 'string'
          ? (lane.member as { cwd?: string }).cwd?.trim()
          : '';
      const laneCwd = laneMemberCwd || run?.request.cwd;
      upsertMetadata(memberName, {
        backendType: 'process',
        providerId: 'opencode',
        alive: false,
        livenessKind: evidence?.livenessKind,
        pidSource: evidence?.pidSource,
        runtimeDiagnostic: evidence?.runtimeDiagnostic,
        ...(laneCwd ? { cwd: laneCwd } : {}),
        ...(runtimeModel ? { model: runtimeModel } : {}),
        ...(typeof evidence?.runtimePid === 'number' && evidence.runtimePid > 0
          ? { metricsPid: evidence.runtimePid }
          : {}),
        ...(evidence?.sessionId ? { runtimeSessionId: evidence.sessionId } : {}),
      });
    }

    const currentRuntimeAdapterRun = this.runtimeAdapterRunByTeam.get(teamName);
    const persistedLaunchSnapshot = await this.launchStateStore.read(teamName).catch(() => null);
    for (const persistedMember of Object.values(persistedLaunchSnapshot?.members ?? {})) {
      const memberName = persistedMember.name?.trim() ?? '';
      if (!memberName || this.isMemberRemovedInMeta(metaMembers, memberName)) {
        continue;
      }
      const currentRuntimeAdapterEvidence = currentRuntimeAdapterRun?.members?.[memberName];
      upsertMetadata(memberName, {
        backendType:
          persistedMember.providerId === 'opencode'
            ? 'process'
            : metadataByMember.get(memberName)?.backendType,
        providerId: persistedMember.providerId,
        alive: false,
        livenessKind: currentRuntimeAdapterEvidence?.livenessKind ?? persistedMember.livenessKind,
        pidSource: currentRuntimeAdapterEvidence?.pidSource ?? persistedMember.pidSource,
        runtimeDiagnostic:
          currentRuntimeAdapterEvidence?.runtimeDiagnostic ?? persistedMember.runtimeDiagnostic,
        runtimeDiagnosticSeverity: persistedMember.runtimeDiagnosticSeverity,
        runtimeLastSeenAt:
          persistedMember.runtimeLastSeenAt ??
          persistedMember.lastHeartbeatAt ??
          persistedMember.lastRuntimeAliveAt,
        ...(persistedMember.model?.trim() ? { model: persistedMember.model.trim() } : {}),
        ...(typeof currentRuntimeAdapterEvidence?.runtimePid === 'number' &&
        currentRuntimeAdapterEvidence.runtimePid > 0
          ? { metricsPid: currentRuntimeAdapterEvidence.runtimePid }
          : typeof persistedMember.runtimePid === 'number' && persistedMember.runtimePid > 0
            ? { metricsPid: persistedMember.runtimePid }
            : {}),
        ...(currentRuntimeAdapterEvidence?.sessionId
          ? { runtimeSessionId: currentRuntimeAdapterEvidence.sessionId }
          : persistedMember.runtimeSessionId
            ? { runtimeSessionId: persistedMember.runtimeSessionId }
            : {}),
      });
    }

    const paneIds = [...metadataByMember.values()]
      .map((metadata) => metadata.tmuxPaneId?.trim() ?? '')
      .filter((paneId) => paneId.length > 0);
    let paneInfoById = new Map<string, TmuxPaneRuntimeInfo>();
    if (paneIds.length > 0) {
      try {
        paneInfoById = await listTmuxPaneRuntimeInfoForCurrentPlatform(paneIds);
      } catch (error) {
        logger.debug(
          `[${teamName}] Failed to read tmux pane info for runtime snapshot: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }
    }

    let processRows: Awaited<ReturnType<typeof listRuntimeProcessesForCurrentTmuxPlatform>> = [];
    let processTableAvailable = true;
    try {
      processRows = await listRuntimeProcessesForCurrentTmuxPlatform();
    } catch (error) {
      processTableAvailable = false;
      logger.debug(
        `[${teamName}] Failed to read process table for runtime snapshot: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
    let windowsHostProcessRows: typeof processRows | null = null;
    let windowsHostProcessTableAvailable = false;
    const getWindowsHostProcessRows = async (): Promise<typeof processRows> => {
      if (windowsHostProcessRows) {
        return windowsHostProcessRows;
      }
      try {
        windowsHostProcessRows = await listWindowsProcessTable();
        windowsHostProcessTableAvailable = true;
      } catch (error) {
        windowsHostProcessRows = [];
        logger.debug(
          `[${teamName}] Failed to read Windows host process table for runtime snapshot: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }
      return windowsHostProcessRows;
    };

    for (const [memberName, metadata] of metadataByMember.entries()) {
      const paneId = metadata.tmuxPaneId?.trim() ?? '';
      const launchMember = persistedLaunchSnapshot?.members[memberName];
      const adapterEvidence = currentRuntimeAdapterRun?.members?.[memberName];
      const adapterStatus: MemberSpawnStatusEntry | undefined = adapterEvidence
        ? {
            status: adapterEvidence.hardFailure
              ? 'error'
              : adapterEvidence.bootstrapConfirmed
                ? 'online'
                : adapterEvidence.agentToolAccepted
                  ? 'waiting'
                  : 'spawning',
            launchState: adapterEvidence.launchState,
            ...(adapterEvidence.hardFailureReason
              ? { hardFailureReason: adapterEvidence.hardFailureReason }
              : {}),
            ...(adapterEvidence.pendingPermissionRequestIds?.length
              ? { pendingPermissionRequestIds: adapterEvidence.pendingPermissionRequestIds }
              : {}),
            agentToolAccepted: adapterEvidence.agentToolAccepted,
            runtimeAlive: adapterEvidence.runtimeAlive,
            bootstrapConfirmed: adapterEvidence.bootstrapConfirmed,
            hardFailure: adapterEvidence.hardFailure,
            ...(metadata.model ? { runtimeModel: metadata.model } : {}),
            ...(adapterEvidence.livenessKind ? { livenessKind: adapterEvidence.livenessKind } : {}),
            ...(adapterEvidence.runtimeDiagnostic
              ? { runtimeDiagnostic: adapterEvidence.runtimeDiagnostic }
              : {}),
            updatedAt: persistedLaunchSnapshot?.updatedAt ?? nowIso(),
          }
        : undefined;
      const status = this.findTrackedMemberSpawnStatus(run, memberName) ?? adapterStatus;
      const shouldUseWindowsHostRows =
        process.platform === 'win32' &&
        (metadata.providerId === 'opencode' ||
          launchMember?.providerId === 'opencode' ||
          metadata.backendType !== 'tmux') &&
        currentRuntimeAdapterRun?.members?.[memberName]?.runtimeAlive !== true &&
        currentRuntimeAdapterRun?.members?.[memberName]?.bootstrapConfirmed !== true;
      const hostProcessRows = shouldUseWindowsHostRows ? await getWindowsHostProcessRows() : [];
      const memberProcessRows = shouldUseWindowsHostRows
        ? [...hostProcessRows, ...processRows]
        : processRows;
      const memberProcessTableAvailable = shouldUseWindowsHostRows
        ? windowsHostProcessTableAvailable || processTableAvailable
        : processTableAvailable;
      const resolved = resolveTeamMemberRuntimeLiveness({
        teamName,
        memberName,
        agentId: metadata.agentId,
        backendType: metadata.backendType,
        providerId: metadata.providerId ?? launchMember?.providerId,
        tmuxPaneId: metadata.tmuxPaneId,
        persistedRuntimePid: launchMember?.runtimePid ?? metadata.metricsPid,
        persistedRuntimeSessionId: launchMember?.runtimeSessionId ?? metadata.runtimeSessionId,
        trackedSpawnStatus: status,
        runtimePid: metadata.metricsPid,
        runtimeSessionId: metadata.runtimeSessionId,
        pane: paneId ? paneInfoById.get(paneId) : undefined,
        processRows: memberProcessRows,
        processTableAvailable: memberProcessTableAvailable,
        nowIso: nowIso(),
      });
      metadataByMember.set(memberName, {
        ...metadata,
        alive: resolved.alive,
        ...(typeof resolved.pid === 'number' && resolved.pid > 0 ? { pid: resolved.pid } : {}),
        ...(typeof (resolved.metricsPid ?? metadata.metricsPid) === 'number' &&
        Number.isFinite(resolved.metricsPid ?? metadata.metricsPid) &&
        (resolved.metricsPid ?? metadata.metricsPid)! > 0
          ? { metricsPid: resolved.metricsPid ?? metadata.metricsPid }
          : {}),
        livenessKind: resolved.livenessKind,
        ...(resolved.pidSource ? { pidSource: resolved.pidSource } : {}),
        ...(resolved.processCommand ? { processCommand: resolved.processCommand } : {}),
        ...(resolved.panePid ? { panePid: resolved.panePid } : {}),
        ...(resolved.paneCurrentCommand ? { paneCurrentCommand: resolved.paneCurrentCommand } : {}),
        ...(resolved.runtimeSessionId ? { runtimeSessionId: resolved.runtimeSessionId } : {}),
        ...(resolved.runtimeLastSeenAt ? { runtimeLastSeenAt: resolved.runtimeLastSeenAt } : {}),
        runtimeDiagnostic: resolved.runtimeDiagnostic,
        runtimeDiagnosticSeverity: resolved.runtimeDiagnosticSeverity,
        diagnostics: resolved.diagnostics,
      });
    }

    this.liveTeamAgentRuntimeMetadataCache.set(teamName, {
      expiresAtMs: Date.now() + TeamProvisioningService.AGENT_RUNTIME_SNAPSHOT_CACHE_TTL_MS,
      metadata: metadataByMember,
    });
    return metadataByMember;
  }

  private async readProcessRssBytesByPid(pids: readonly number[]): Promise<Map<number, number>> {
    const uniquePids = [...new Set(pids.filter((pid) => Number.isFinite(pid) && pid > 0))];
    if (uniquePids.length === 0) {
      return new Map();
    }

    const rssBytesByPid = new Map<number, number>();
    const options = { maxage: 0 };
    try {
      const statsByPid = await pidusage(uniquePids, options);
      for (const [rawPid, stat] of Object.entries(statsByPid)) {
        const pid = Number.parseInt(rawPid, 10);
        const rssBytes = stat?.memory;
        if (Number.isFinite(pid) && pid > 0 && Number.isFinite(rssBytes) && rssBytes >= 0) {
          rssBytesByPid.set(pid, rssBytes);
        }
      }
      return rssBytesByPid;
    } catch (error) {
      logger.debug(
        `pidusage batch runtime snapshot failed; falling back to per-pid reads: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }

    await Promise.all(
      uniquePids.map(async (pid) => {
        try {
          const stat = await pidusage(pid, options);
          if (Number.isFinite(stat.memory) && stat.memory >= 0) {
            rssBytesByPid.set(pid, stat.memory);
          }
        } catch {
          // Process likely exited between discovery and sampling.
        }
      })
    );
    return rssBytesByPid;
  }

  private async clearPersistedLaunchState(teamName: string): Promise<void> {
    await this.launchStateStore.clear(teamName);
    await clearBootstrapState(teamName);
  }

  private getFailedSpawnMembers(
    run: ProvisioningRun
  ): { name: string; error?: string; updatedAt: string }[] {
    const memberSpawnStatuses = run.memberSpawnStatuses ?? new Map();
    return [...memberSpawnStatuses.entries()]
      .filter(([, entry]) => entry.launchState === 'failed_to_start')
      .map(([name, entry]) => ({
        name,
        error: entry.hardFailureReason ?? entry.error,
        updatedAt: entry.updatedAt,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  private getMemberLaunchSummary(run: ProvisioningRun): {
    confirmedCount: number;
    pendingCount: number;
    failedCount: number;
    skippedCount?: number;
    runtimeAlivePendingCount: number;
    shellOnlyPendingCount?: number;
    runtimeProcessPendingCount?: number;
    runtimeCandidatePendingCount?: number;
    noRuntimePendingCount?: number;
    permissionPendingCount?: number;
  } {
    const expectedMembers = run.expectedMembers ?? [];
    const memberSpawnStatuses = run.memberSpawnStatuses ?? new Map();
    let confirmedCount = 0;
    let pendingCount = 0;
    let failedCount = 0;
    let skippedCount = 0;
    let runtimeAlivePendingCount = 0;
    let shellOnlyPendingCount = 0;
    let runtimeProcessPendingCount = 0;
    let runtimeCandidatePendingCount = 0;
    let noRuntimePendingCount = 0;
    let permissionPendingCount = 0;
    for (const expected of expectedMembers) {
      const entry = memberSpawnStatuses.get(expected) ?? createInitialMemberSpawnStatusEntry();
      if (entry.launchState === 'confirmed_alive') {
        confirmedCount += 1;
        continue;
      }
      if (entry.launchState === 'skipped_for_launch' || entry.skippedForLaunch === true) {
        skippedCount += 1;
        continue;
      }
      if (entry.launchState === 'failed_to_start') {
        failedCount += 1;
        continue;
      }
      pendingCount += 1;
      if (entry.runtimeAlive) {
        runtimeAlivePendingCount += 1;
      }
      if (entry.launchState === 'runtime_pending_permission') {
        permissionPendingCount += 1;
      }
      if (entry.livenessKind === 'shell_only') {
        shellOnlyPendingCount += 1;
      } else if (entry.livenessKind === 'runtime_process') {
        runtimeProcessPendingCount += 1;
      } else if (entry.livenessKind === 'runtime_process_candidate') {
        runtimeCandidatePendingCount += 1;
      } else if (
        entry.livenessKind === 'not_found' ||
        entry.livenessKind === 'stale_metadata' ||
        entry.livenessKind === 'registered_only'
      ) {
        noRuntimePendingCount += 1;
      }
    }
    return {
      confirmedCount,
      pendingCount,
      failedCount,
      skippedCount,
      runtimeAlivePendingCount,
      shellOnlyPendingCount,
      runtimeProcessPendingCount,
      runtimeCandidatePendingCount,
      noRuntimePendingCount,
      permissionPendingCount,
    };
  }

  private buildPendingBootstrapStatusMessage(
    prefix: string,
    run: ProvisioningRun,
    launchSummary: {
      confirmedCount: number;
      pendingCount: number;
      runtimeAlivePendingCount: number;
      shellOnlyPendingCount?: number;
      runtimeProcessPendingCount?: number;
      runtimeCandidatePendingCount?: number;
      noRuntimePendingCount?: number;
      permissionPendingCount?: number;
    },
    snapshot?: PersistedTeamLaunchSnapshot | null
  ): string {
    const expectedTeammateCount = snapshot
      ? this.getPersistedLaunchMemberNames(snapshot).length
      : run.expectedMembers.length;
    const permissionPendingCount = snapshot
      ? this.countSnapshotPermissionPendingMembers(snapshot)
      : this.countRunPermissionPendingMembers(run);
    if (
      launchSummary.pendingCount > 0 &&
      permissionPendingCount > 0 &&
      permissionPendingCount === launchSummary.pendingCount
    ) {
      return `${prefix} — ${
        permissionPendingCount === 1
          ? '1 teammate awaiting permission approval'
          : `${permissionPendingCount} teammates awaiting permission approval`
      }`;
    }

    const runtimeProcessPendingCount = launchSummary.runtimeProcessPendingCount ?? 0;
    const stillStartingCount = Math.max(0, launchSummary.pendingCount - runtimeProcessPendingCount);
    const diagnosticParts = [
      launchSummary.shellOnlyPendingCount
        ? `${launchSummary.shellOnlyPendingCount} shell-only`
        : '',
      launchSummary.runtimeProcessPendingCount
        ? `${launchSummary.runtimeProcessPendingCount} waiting for bootstrap`
        : '',
      launchSummary.runtimeCandidatePendingCount
        ? `${launchSummary.runtimeCandidatePendingCount} process candidates`
        : '',
      launchSummary.noRuntimePendingCount
        ? `${launchSummary.noRuntimePendingCount} no runtime found`
        : '',
    ].filter(Boolean);
    const diagnosticSuffix = diagnosticParts.length > 0 ? ` - ${diagnosticParts.join(', ')}` : '';
    if (launchSummary.confirmedCount === 0) {
      const allRuntimeAlive =
        runtimeProcessPendingCount > 0 && runtimeProcessPendingCount === expectedTeammateCount;
      return allRuntimeAlive
        ? `${prefix} — teammates online`
        : runtimeProcessPendingCount > 0
          ? `${prefix} — ${runtimeProcessPendingCount}/${expectedTeammateCount} teammate${runtimeProcessPendingCount === 1 ? '' : 's'} online${stillStartingCount > 0 ? `, ${stillStartingCount} still starting` : ''}`
          : `${prefix} — teammates are still starting${diagnosticSuffix}`;
    }

    return `${prefix} — ${launchSummary.confirmedCount}/${expectedTeammateCount} teammates made contact${runtimeProcessPendingCount > 0 ? `, ${runtimeProcessPendingCount} teammate${runtimeProcessPendingCount === 1 ? '' : 's'} online` : ''}${stillStartingCount > 0 ? `${runtimeProcessPendingCount > 0 ? ', ' : ', '}${stillStartingCount} still joining${diagnosticSuffix}` : ''}`;
  }

  private buildAggregatePendingLaunchMessage(
    prefix: string,
    run: ProvisioningRun,
    launchSummary: {
      confirmedCount: number;
      pendingCount: number;
      failedCount: number;
      runtimeAlivePendingCount: number;
      runtimeProcessPendingCount?: number;
    },
    snapshot?: PersistedTeamLaunchSnapshot | null
  ): string {
    const mixedSecondaryLanes = run.mixedSecondaryLanes ?? [];
    if (!snapshot || mixedSecondaryLanes.length === 0) {
      return this.buildPendingBootstrapStatusMessage(prefix, run, launchSummary, snapshot);
    }

    const persistedMemberNames = this.getPersistedLaunchMemberNames(snapshot);
    const allPendingMembers = persistedMemberNames
      .filter((memberName) => {
        const member = snapshot.members[memberName];
        if (!member) {
          return false;
        }
        return member.launchState !== 'confirmed_alive' && member.launchState !== 'failed_to_start';
      })
      .filter((memberName) => {
        const member = snapshot.members[memberName];
        return member?.launchState !== 'skipped_for_launch';
      });
    if (
      allPendingMembers.length > 0 &&
      allPendingMembers.every((memberName) => {
        const member = snapshot.members[memberName];
        return (
          member?.launchState === 'runtime_pending_permission' ||
          (member?.pendingPermissionRequestIds?.length ?? 0) > 0
        );
      })
    ) {
      return `${prefix} — ${
        allPendingMembers.length === 1
          ? '1 teammate awaiting permission approval'
          : `${allPendingMembers.length} teammates awaiting permission approval`
      }`;
    }

    const primaryExpectedMembers = new Set(
      snapshot.bootstrapExpectedMembers ?? run.expectedMembers
    );
    const secondaryPendingMembers = persistedMemberNames.filter((memberName) => {
      if (primaryExpectedMembers.has(memberName)) {
        return false;
      }
      const member = snapshot.members[memberName];
      if (!member) {
        return true;
      }
      return (
        member.launchState !== 'confirmed_alive' &&
        member.launchState !== 'failed_to_start' &&
        member.launchState !== 'skipped_for_launch'
      );
    });
    if (secondaryPendingMembers.length === 0) {
      return this.buildPendingBootstrapStatusMessage(prefix, run, launchSummary);
    }

    return `${prefix} - waiting for secondary runtime lane: ${secondaryPendingMembers.join(', ')}`;
  }

  private buildRuntimeSpawnStatusRecord(
    run: ProvisioningRun
  ): Record<string, MemberSpawnStatusEntry> {
    const statuses: Record<string, MemberSpawnStatusEntry> = {};
    for (const expected of run.expectedMembers) {
      statuses[expected] =
        run.memberSpawnStatuses.get(expected) ?? createInitialMemberSpawnStatusEntry();
    }
    return statuses;
  }

  private syncRunMemberSpawnStatusesFromSnapshot(
    run: ProvisioningRun,
    snapshot: PersistedTeamLaunchSnapshot
  ): void {
    const memberNames = this.getPersistedLaunchMemberNames(snapshot);
    const snapshotStatuses = snapshotToMemberSpawnStatuses(snapshot);
    run.expectedMembers = memberNames;
    for (const memberName of memberNames) {
      const entry = snapshotStatuses[memberName];
      if (entry) {
        run.memberSpawnStatuses.set(memberName, entry);
      }
    }
  }

  private countRunPermissionPendingMembers(run: ProvisioningRun): number {
    let count = 0;
    for (const expected of run.expectedMembers ?? []) {
      const entry = run.memberSpawnStatuses.get(expected) ?? createInitialMemberSpawnStatusEntry();
      if (entry.launchState === 'runtime_pending_permission') {
        count += 1;
      }
    }
    return count;
  }

  private countSnapshotPermissionPendingMembers(snapshot: PersistedTeamLaunchSnapshot): number {
    let count = 0;
    for (const memberName of this.getPersistedLaunchMemberNames(snapshot)) {
      const member = snapshot.members[memberName];
      if (!member) {
        continue;
      }
      if (
        member.launchState === 'runtime_pending_permission' ||
        (member.pendingPermissionRequestIds?.length ?? 0) > 0
      ) {
        count += 1;
      }
    }
    return count;
  }

  private hasPendingLaunchMembers(
    run: ProvisioningRun,
    launchSummary: {
      pendingCount: number;
    },
    snapshot?: PersistedTeamLaunchSnapshot | null
  ): boolean {
    const expectedCount = snapshot
      ? this.getPersistedLaunchMemberNames(snapshot).length
      : (run.expectedMembers?.length ?? 0);
    return launchSummary.pendingCount > 0 && expectedCount > 0;
  }

  private getPersistedLaunchMemberNames(snapshot: PersistedTeamLaunchSnapshot): string[] {
    return Array.from(new Set([...snapshot.expectedMembers, ...Object.keys(snapshot.members)]));
  }

  private buildLiveLaunchSnapshotForRun(
    run: ProvisioningRun,
    launchPhase: PersistedTeamLaunchPhase = run.provisioningComplete ? 'finished' : 'active'
  ): PersistedTeamLaunchSnapshot | null {
    const mixedSnapshot = this.buildMixedPersistedLaunchSnapshotForRun(run, launchPhase);
    if (mixedSnapshot) {
      return mixedSnapshot;
    }

    if (!run.isLaunch || !run.expectedMembers || run.expectedMembers.length === 0) {
      return null;
    }

    return snapshotFromRuntimeMemberStatuses({
      teamName: run.teamName,
      expectedMembers: run.expectedMembers,
      leadSessionId: run.detectedSessionId ?? undefined,
      launchPhase,
      statuses: this.buildRuntimeSpawnStatusRecord(run),
    });
  }

  private emitMemberSpawnChange(
    run: Pick<ProvisioningRun, 'teamName' | 'runId'>,
    memberName: string
  ) {
    this.teamChangeEmitter?.({
      type: 'member-spawn',
      teamName: run.teamName,
      runId: run.runId,
      detail: memberName,
    });
  }

  private async publishMixedSecondaryLaneStatusChange(
    run: ProvisioningRun,
    lane: MixedSecondaryRuntimeLaneState
  ): Promise<void> {
    let snapshot: PersistedTeamLaunchSnapshot | null = null;
    if (run.isLaunch) {
      snapshot = await this.persistLaunchStateSnapshot(run, this.getMixedSecondaryLaunchPhase(run));
    }
    if (snapshot) {
      this.syncRunMemberSpawnStatusesFromSnapshot(run, snapshot);
    }
    if (!this.isCurrentTrackedRun(run)) {
      return;
    }
    this.emitMemberSpawnChange(run, lane.member.name);
  }

  private buildMixedPersistedLaunchSnapshotForRun(
    run: ProvisioningRun,
    launchPhase: PersistedTeamLaunchPhase
  ): PersistedTeamLaunchSnapshot | null {
    const mixedSecondaryLanes = run.mixedSecondaryLanes ?? [];
    if (mixedSecondaryLanes.length === 0) {
      return null;
    }

    return this.runtimeLaneCoordinator.buildAggregateLaunchSnapshot({
      teamName: run.teamName,
      leadSessionId: run.detectedSessionId ?? undefined,
      launchPhase,
      leadDefaults: {
        providerId: resolveTeamProviderId(run.request.providerId),
        providerBackendId:
          migrateProviderBackendId(run.request.providerId, run.request.providerBackendId) ?? null,
        selectedFastMode: run.request.fastMode,
        resolvedFastMode:
          typeof run.launchIdentity?.resolvedFastMode === 'boolean'
            ? run.launchIdentity.resolvedFastMode
            : null,
        launchIdentity: run.launchIdentity ?? null,
      },
      primaryMembers: run.effectiveMembers,
      primaryStatuses: this.buildRuntimeSpawnStatusRecord(run),
      secondaryMembers: mixedSecondaryLanes.map((secondaryLane) => {
        const evidenceEntry = secondaryLane.result?.members[secondaryLane.member.name];
        const finishedWithoutRuntimeEvidence =
          secondaryLane.state === 'finished' && !secondaryLane.result;
        return {
          laneId: secondaryLane.laneId,
          member: secondaryLane.member,
          leadDefaults: {
            providerId: resolveTeamProviderId(run.request.providerId),
            providerBackendId:
              migrateProviderBackendId(run.request.providerId, run.request.providerBackendId) ??
              null,
            selectedFastMode: run.request.fastMode,
            resolvedFastMode:
              typeof run.launchIdentity?.resolvedFastMode === 'boolean'
                ? run.launchIdentity.resolvedFastMode
                : null,
            launchIdentity: run.launchIdentity ?? null,
          },
          evidence: evidenceEntry
            ? {
                launchState: evidenceEntry.launchState,
                agentToolAccepted: evidenceEntry.agentToolAccepted,
                runtimeAlive: evidenceEntry.runtimeAlive,
                bootstrapConfirmed: evidenceEntry.bootstrapConfirmed,
                hardFailure: evidenceEntry.hardFailure,
                hardFailureReason: evidenceEntry.hardFailureReason,
                pendingPermissionRequestIds: evidenceEntry.pendingPermissionRequestIds,
                runtimePid: evidenceEntry.runtimePid,
                diagnostics: evidenceEntry.diagnostics,
              }
            : finishedWithoutRuntimeEvidence
              ? {
                  launchState: 'runtime_pending_bootstrap',
                  agentToolAccepted: false,
                  runtimeAlive: false,
                  bootstrapConfirmed: false,
                  hardFailure: false,
                  diagnostics:
                    secondaryLane.diagnostics.length > 0
                      ? [...secondaryLane.diagnostics]
                      : [
                          'OpenCode secondary lane finished without runtime evidence. Waiting for runtime reconciliation.',
                        ],
                }
              : null,
          pendingReason:
            secondaryLane.result || secondaryLane.state === 'finished'
              ? undefined
              : secondaryLane.state === 'launching'
                ? 'Launching through OpenCode secondary lane.'
                : 'Queued for OpenCode secondary lane launch.',
        };
      }),
    });
  }

  private hasMixedLaunchMetadata(snapshot: PersistedTeamLaunchSnapshot | null): boolean {
    return hasMixedPersistedLaunchMetadata(snapshot);
  }

  private hasMixedSecondaryLaunchMetadata(snapshot: PersistedTeamLaunchSnapshot | null): boolean {
    if (!snapshot) {
      return false;
    }
    return Object.values(snapshot.members).some(
      (member) =>
        member?.laneKind === 'secondary' ||
        (typeof member?.laneId === 'string' && member.laneId.startsWith('secondary:'))
    );
  }

  private hasPrimaryOnlyLaneAwareLaunchMetadata(
    snapshot: PersistedTeamLaunchSnapshot | null
  ): boolean {
    if (!snapshot || this.hasMixedSecondaryLaunchMetadata(snapshot)) {
      return false;
    }

    return Object.values(snapshot.members).some(
      (member) =>
        Boolean(member?.laneId) ||
        Boolean(member?.laneKind) ||
        Boolean(member?.laneOwnerProviderId) ||
        Boolean(member?.launchIdentity)
    );
  }

  private hasLeadInboxLaunchReconcileHeartbeat(
    snapshot: PersistedTeamLaunchSnapshot,
    messages: readonly LeadInboxLaunchReconcileMessage[]
  ): boolean {
    const expectedMembers = this.getPersistedLaunchMemberNames(snapshot);
    if (expectedMembers.length === 0 || messages.length === 0) {
      return false;
    }

    return messages.some((message) => {
      if (
        typeof message.from !== 'string' ||
        typeof message.text !== 'string' ||
        typeof message.timestamp !== 'string' ||
        !isMeaningfulBootstrapCheckInMessage(message.text)
      ) {
        return false;
      }

      const expected = this.resolveExpectedLaunchMemberName(expectedMembers, message.from);
      if (!expected) {
        return false;
      }

      const current = snapshot.members[expected];
      const firstAcceptedAt = current?.firstSpawnAcceptedAt
        ? Date.parse(current.firstSpawnAcceptedAt)
        : NaN;
      const messageTs = Date.parse(message.timestamp);
      return (
        !Number.isFinite(firstAcceptedAt) ||
        !Number.isFinite(messageTs) ||
        messageTs >= firstAcceptedAt
      );
    });
  }

  private selectLatestLeadInboxLaunchReconcileMessage(
    messages: readonly LeadInboxLaunchReconcileMessage[],
    expectedMembers: readonly string[],
    expected: string,
    firstSpawnAcceptedAt?: string
  ): LeadInboxLaunchReconcileMessage | null {
    const firstAcceptedAt = firstSpawnAcceptedAt ? Date.parse(firstSpawnAcceptedAt) : NaN;
    const candidates = messages.filter((message) => {
      if (
        typeof message.from !== 'string' ||
        this.resolveExpectedLaunchMemberName(expectedMembers, message.from) !== expected
      ) {
        return false;
      }
      if (typeof message.text !== 'string' || !isMeaningfulBootstrapCheckInMessage(message.text)) {
        return false;
      }
      const messageTs = Date.parse(message.timestamp);
      if (
        Number.isFinite(firstAcceptedAt) &&
        Number.isFinite(messageTs) &&
        messageTs < firstAcceptedAt
      ) {
        return false;
      }
      return true;
    });

    return (
      candidates.sort((left, right) => {
        const leftMs = Date.parse(left.timestamp);
        const rightMs = Date.parse(right.timestamp);
        const leftValid = Number.isFinite(leftMs);
        const rightValid = Number.isFinite(rightMs);
        if (leftValid && rightValid && leftMs !== rightMs) {
          return rightMs - leftMs;
        }
        if (leftValid !== rightValid) {
          return leftValid ? -1 : 1;
        }
        return (right.messageId ?? '').localeCompare(left.messageId ?? '');
      })[0] ?? null
    );
  }

  private shouldRecoverStalePersistedMixedLaunchSnapshot(
    snapshot: PersistedTeamLaunchSnapshot
  ): boolean {
    if (snapshot.teamLaunchState !== 'partial_pending') {
      return false;
    }
    const updatedAtMs = Date.parse(snapshot.updatedAt);
    if (Number.isFinite(updatedAtMs) && Date.now() - updatedAtMs < MEMBER_LAUNCH_GRACE_MS) {
      return false;
    }

    return Object.values(snapshot.members).some((member) => {
      if (member.launchState === 'confirmed_alive' || member.launchState === 'failed_to_start') {
        return false;
      }
      return (
        member.laneKind === 'secondary' &&
        member.laneOwnerProviderId === 'opencode' &&
        typeof member.laneId === 'string'
      );
    });
  }

  private async persistLaunchStateSnapshot(
    run: ProvisioningRun,
    launchPhase: 'active' | 'finished' | 'reconciled' = run.provisioningComplete
      ? 'finished'
      : 'active'
  ): Promise<PersistedTeamLaunchSnapshot | null> {
    const snapshot = this.buildLiveLaunchSnapshotForRun(run, launchPhase);
    if (!snapshot) {
      if (run.isLaunch) {
        await this.clearPersistedLaunchState(run.teamName);
      }
      return null;
    }

    const metaMembers = await this.membersMetaStore.getMembers(run.teamName).catch(() => []);
    const filteredSnapshot = this.filterRemovedMembersFromLaunchSnapshot(snapshot, metaMembers);

    if (filteredSnapshot.teamLaunchState === 'clean_success' && launchPhase !== 'active') {
      await this.clearPersistedLaunchState(run.teamName);
      this.agentRuntimeSnapshotCache.delete(run.teamName);
      this.liveTeamAgentRuntimeMetadataCache.delete(run.teamName);
      return null;
    }

    await this.launchStateStore.write(run.teamName, filteredSnapshot);
    this.agentRuntimeSnapshotCache.delete(run.teamName);
    this.liveTeamAgentRuntimeMetadataCache.delete(run.teamName);
    return filteredSnapshot;
  }

  private async launchSingleMixedSecondaryLane(
    run: ProvisioningRun,
    lane: MixedSecondaryRuntimeLaneState
  ): Promise<void> {
    const adapter = this.getOpenCodeRuntimeAdapter();
    if (!adapter) {
      const message = 'OpenCode runtime adapter is not registered for mixed team launch.';
      lane.state = 'finished';
      lane.result = {
        runId: lane.runId ?? randomUUID(),
        teamName: run.teamName,
        launchPhase: 'finished',
        teamLaunchState: 'partial_failure',
        members: {
          [lane.member.name]: {
            memberName: lane.member.name,
            providerId: 'opencode',
            launchState: 'failed_to_start',
            agentToolAccepted: false,
            runtimeAlive: false,
            bootstrapConfirmed: false,
            hardFailure: true,
            hardFailureReason: 'opencode_runtime_adapter_missing',
            diagnostics: [message],
          },
        },
        warnings: [],
        diagnostics: [message],
      };
      lane.warnings = [];
      lane.diagnostics = [message];
      await this.publishMixedSecondaryLaneStatusChange(run, lane);
      lane.state = 'finished';
      return;
    }

    const migration = await migrateLegacyOpenCodeRuntimeState({
      teamsBasePath: getTeamsBasePath(),
      teamName: run.teamName,
      laneId: lane.laneId,
    });
    await upsertOpenCodeRuntimeLaneIndexEntry({
      teamsBasePath: getTeamsBasePath(),
      teamName: run.teamName,
      laneId: lane.laneId,
      state: migration.degraded ? 'degraded' : 'active',
      diagnostics: migration.diagnostics,
    });

    lane.state = 'launching';
    lane.runId = lane.runId ?? randomUUID();
    lane.warnings = [];
    lane.diagnostics = [...migration.diagnostics];
    const laneCwd = lane.member.cwd?.trim() || run.request.cwd;
    this.setSecondaryRuntimeRun({
      teamName: run.teamName,
      runId: lane.runId,
      providerId: 'opencode',
      laneId: lane.laneId,
      memberName: lane.member.name,
      cwd: laneCwd,
    });
    await this.publishMixedSecondaryLaneStatusChange(run, lane);
    const previousLaunchState = await this.launchStateStore.read(run.teamName);

    try {
      const result = await adapter.launch({
        runId: lane.runId,
        laneId: lane.laneId,
        teamName: run.teamName,
        cwd: laneCwd,
        prompt: run.request.prompt?.trim() ?? undefined,
        providerId: 'opencode',
        model: lane.member.model,
        effort: lane.member.effort,
        skipPermissions: run.request.skipPermissions !== false,
        expectedMembers: [
          {
            name: lane.member.name,
            role: lane.member.role,
            workflow: lane.member.workflow,
            isolation: lane.member.isolation === 'worktree' ? ('worktree' as const) : undefined,
            providerId: 'opencode',
            model: lane.member.model,
            effort: lane.member.effort,
            cwd: laneCwd,
          },
        ],
        previousLaunchState,
      });
      if (run.cancelRequested || run.processKilled) {
        this.deleteSecondaryRuntimeRun(run.teamName, lane.laneId);
        return;
      }
      lane.result = result;
      lane.warnings = [...result.warnings];
      lane.diagnostics = [...migration.diagnostics, ...result.diagnostics];

      if (isDefinitiveOpenCodePreLaunchFailure(result, lane.member.name)) {
        const diagnostics = [
          ...migration.diagnostics,
          ...collectRuntimeLaunchFailureDiagnostics(result, lane.member.name),
        ];
        await upsertOpenCodeRuntimeLaneIndexEntry({
          teamsBasePath: getTeamsBasePath(),
          teamName: run.teamName,
          laneId: lane.laneId,
          state: 'degraded',
          diagnostics,
        }).catch(() => undefined);
        this.deleteSecondaryRuntimeRun(run.teamName, lane.laneId);
      } else if (result.teamLaunchState === 'partial_failure') {
        this.deleteSecondaryRuntimeRun(run.teamName, lane.laneId);
      }
    } catch (error) {
      if (run.cancelRequested || run.processKilled) {
        this.deleteSecondaryRuntimeRun(run.teamName, lane.laneId);
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      lane.result = {
        runId: lane.runId,
        teamName: run.teamName,
        launchPhase: 'finished',
        teamLaunchState: 'partial_failure',
        members: {
          [lane.member.name]: {
            memberName: lane.member.name,
            providerId: 'opencode',
            launchState: 'failed_to_start',
            agentToolAccepted: false,
            runtimeAlive: false,
            bootstrapConfirmed: false,
            hardFailure: true,
            hardFailureReason: message,
            diagnostics: [message],
          },
        },
        warnings: [],
        diagnostics: [message],
      };
      lane.warnings = [];
      lane.diagnostics = [...migration.diagnostics, message];
      await upsertOpenCodeRuntimeLaneIndexEntry({
        teamsBasePath: getTeamsBasePath(),
        teamName: run.teamName,
        laneId: lane.laneId,
        state: 'degraded',
        diagnostics: [message],
      }).catch(() => undefined);
      this.deleteSecondaryRuntimeRun(run.teamName, lane.laneId);
    }

    await this.publishMixedSecondaryLaneStatusChange(run, lane);
    lane.state = 'finished';
  }

  private async stopSingleMixedSecondaryRuntimeLane(
    run: ProvisioningRun,
    lane: MixedSecondaryRuntimeLaneState,
    reason: TeamRuntimeStopInput['reason']
  ): Promise<void> {
    const adapter = this.getOpenCodeRuntimeAdapter();
    const previousLaunchState = await this.launchStateStore.read(run.teamName);

    try {
      if (adapter && lane.runId) {
        await adapter.stop({
          runId: lane.runId,
          laneId: lane.laneId,
          teamName: run.teamName,
          cwd: lane.member.cwd?.trim() || run.request.cwd,
          providerId: 'opencode',
          reason,
          previousLaunchState,
          force: true,
        });
      }
    } catch (error) {
      logger.warn(
        `[${run.teamName}] Failed to stop mixed OpenCode lane ${lane.laneId}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    } finally {
      await clearOpenCodeRuntimeLaneStorage({
        teamsBasePath: getTeamsBasePath(),
        teamName: run.teamName,
        laneId: lane.laneId,
      }).catch(() => undefined);
      this.deleteSecondaryRuntimeRun(run.teamName, lane.laneId);
      lane.runId = null;
      lane.state = 'finished';
      lane.result = null;
      lane.warnings = [];
      lane.diagnostics = [];
    }
  }

  private launchQueuedMixedSecondaryLaneInBackground(
    run: ProvisioningRun,
    lane: MixedSecondaryRuntimeLaneState
  ): void {
    if (lane.state !== 'queued') {
      return;
    }

    lane.state = 'launching';
    lane.runId = lane.runId ?? randomUUID();

    void (async () => {
      try {
        await this.launchSingleMixedSecondaryLane(run, lane);
      } catch (error) {
        if (run.cancelRequested || run.processKilled) {
          this.deleteSecondaryRuntimeRun(run.teamName, lane.laneId);
          return;
        }
        const message = error instanceof Error ? error.message : String(error);
        logger.warn(
          `[${run.teamName}] OpenCode secondary lane ${lane.laneId} crashed during launch orchestration: ${message}`
        );
        lane.result = createUnexpectedMixedSecondaryLaneFailureResult({
          runId: lane.runId ?? randomUUID(),
          teamName: run.teamName,
          memberName: lane.member.name,
          message,
        });
        lane.warnings = [];
        lane.diagnostics = [...lane.diagnostics, message];
        await upsertOpenCodeRuntimeLaneIndexEntry({
          teamsBasePath: getTeamsBasePath(),
          teamName: run.teamName,
          laneId: lane.laneId,
          state: 'degraded',
          diagnostics: [message],
        }).catch(() => undefined);
        this.deleteSecondaryRuntimeRun(run.teamName, lane.laneId);
        await this.publishMixedSecondaryLaneStatusChange(run, lane).catch(() => undefined);
        lane.state = 'finished';
      }
    })();
  }

  private async launchMixedSecondaryLaneIfNeeded(
    run: ProvisioningRun
  ): Promise<PersistedTeamLaunchSnapshot | null> {
    if (run.cancelRequested || run.processKilled) {
      return this.launchStateStore.read(run.teamName).catch(() => null);
    }

    const mixedSecondaryLanes = run.mixedSecondaryLanes ?? [];
    if (mixedSecondaryLanes.length === 0) {
      return this.persistLaunchStateSnapshot(run, 'finished');
    }

    const adapter = this.getOpenCodeRuntimeAdapter();
    if (!adapter) {
      for (const lane of mixedSecondaryLanes) {
        lane.state = 'finished';
        lane.result = {
          runId: lane.runId ?? randomUUID(),
          teamName: run.teamName,
          launchPhase: 'finished',
          teamLaunchState: 'partial_failure',
          members: {
            [lane.member.name]: {
              memberName: lane.member.name,
              providerId: 'opencode',
              launchState: 'failed_to_start',
              agentToolAccepted: false,
              runtimeAlive: false,
              bootstrapConfirmed: false,
              hardFailure: true,
              hardFailureReason: 'opencode_runtime_adapter_missing',
              diagnostics: ['OpenCode runtime adapter is not registered for mixed team launch.'],
            },
          },
          warnings: [],
          diagnostics: ['OpenCode runtime adapter is not registered for mixed team launch.'],
        };
        lane.diagnostics = lane.result.diagnostics;
        await this.publishMixedSecondaryLaneStatusChange(run, lane);
      }
      return this.persistLaunchStateSnapshot(run, 'finished');
    }

    for (const lane of mixedSecondaryLanes) {
      this.launchQueuedMixedSecondaryLaneInBackground(run, lane);
    }

    return this.persistLaunchStateSnapshot(run, this.getMixedSecondaryLaunchPhase(run));
  }

  private async recoverStaleMixedSecondaryLaunchSnapshot(
    teamName: string,
    bootstrapSnapshot: PersistedTeamLaunchSnapshot | null,
    persistedSnapshot: PersistedTeamLaunchSnapshot | null
  ): Promise<PersistedTeamLaunchSnapshot | null> {
    if (
      persistedSnapshot &&
      this.hasMixedSecondaryLaunchMetadata(persistedSnapshot) &&
      !this.shouldRecoverStalePersistedMixedLaunchSnapshot(persistedSnapshot)
    ) {
      return persistedSnapshot;
    }

    const teamMeta = await this.teamMetaStore.getMeta(teamName).catch(() => null);
    const leadProviderId = normalizeOptionalTeamProviderId(teamMeta?.providerId);
    if (!leadProviderId || leadProviderId === 'opencode') {
      return null;
    }

    const membersMeta = await this.membersMetaStore.getMeta(teamName).catch(() => null);
    const activeMembers = (membersMeta?.members ?? []).filter(
      (member) => !member.removedAt && !isLeadMember({ name: member.name })
    );
    if (activeMembers.length === 0) {
      return null;
    }
    const projectPath = this.readPersistedTeamProjectPath(teamName);

    const laneIndex = await readOpenCodeRuntimeLaneIndex(getTeamsBasePath(), teamName).catch(
      () => ({
        version: 1 as const,
        updatedAt: nowIso(),
        lanes: {} as Record<
          string,
          {
            laneId: string;
            state: 'active' | 'stopped' | 'degraded';
            updatedAt: string;
            diagnostics?: string[];
          }
        >,
      })
    );
    const bootstrapStatuses = snapshotToMemberSpawnStatuses(bootstrapSnapshot);
    const leadDefaults = {
      providerId: leadProviderId,
      providerBackendId:
        migrateProviderBackendId(
          leadProviderId,
          teamMeta?.providerBackendId ?? membersMeta?.providerBackendId
        ) ?? null,
      selectedFastMode: teamMeta?.fastMode,
      resolvedFastMode:
        typeof teamMeta?.launchIdentity?.resolvedFastMode === 'boolean'
          ? teamMeta.launchIdentity.resolvedFastMode
          : null,
      launchIdentity: teamMeta?.launchIdentity ?? null,
    };
    const primaryMembers: TeamMember[] = [];
    const secondaryMembers: {
      laneId: string;
      member: TeamMember;
      leadDefaults: typeof leadDefaults;
      evidence?: {
        launchState?: MemberLaunchState;
        agentToolAccepted?: boolean;
        runtimeAlive?: boolean;
        bootstrapConfirmed?: boolean;
        hardFailure?: boolean;
        hardFailureReason?: string;
        pendingPermissionRequestIds?: string[];
        runtimePid?: number;
        diagnostics?: string[];
      };
      pendingReason?: string;
    }[] = [];
    let recoveredAny = false;

    for (const member of activeMembers) {
      const laneIdentity = buildPlannedMemberLaneIdentity({
        leadProviderId,
        member: {
          name: member.name,
          providerId: normalizeOptionalTeamProviderId(member.providerId),
        },
      });

      if (
        laneIdentity.laneKind !== 'secondary' ||
        laneIdentity.laneOwnerProviderId !== 'opencode'
      ) {
        primaryMembers.push(member);
        continue;
      }

      let laneEntry = laneIndex.lanes[laneIdentity.laneId];
      if (laneEntry?.state === 'active') {
        const runtimeEvidence = await this.tryRecoverActiveOpenCodeSecondaryLaneFromRuntime({
          teamName,
          laneId: laneIdentity.laneId,
          member,
          projectPath,
          previousLaunchState: persistedSnapshot ?? bootstrapSnapshot,
        });
        if (runtimeEvidence) {
          recoveredAny = true;
          secondaryMembers.push({
            laneId: laneIdentity.laneId,
            member,
            leadDefaults,
            evidence: {
              launchState: runtimeEvidence.launchState,
              agentToolAccepted: runtimeEvidence.agentToolAccepted,
              runtimeAlive: runtimeEvidence.runtimeAlive,
              bootstrapConfirmed: runtimeEvidence.bootstrapConfirmed,
              hardFailure: runtimeEvidence.hardFailure,
              hardFailureReason: runtimeEvidence.hardFailureReason,
              pendingPermissionRequestIds: runtimeEvidence.pendingPermissionRequestIds,
              runtimePid: runtimeEvidence.runtimePid,
              diagnostics: runtimeEvidence.diagnostics,
            },
          });
          continue;
        }
        const recovery = await recoverStaleOpenCodeRuntimeLaneIndexEntry({
          teamsBasePath: getTeamsBasePath(),
          teamName,
          laneId: laneIdentity.laneId,
        });
        if (recovery.stale) {
          recoveredAny = true;
          laneEntry = {
            laneId: laneIdentity.laneId,
            state: 'degraded',
            updatedAt: nowIso(),
            diagnostics: recovery.diagnostics,
          };
        }
      }

      if (laneEntry?.state === 'degraded') {
        recoveredAny = true;
        const diagnostics = laneEntry.diagnostics?.length
          ? [...laneEntry.diagnostics]
          : [`OpenCode lane ${laneIdentity.laneId} is degraded and requires stop + relaunch.`];
        secondaryMembers.push({
          laneId: laneIdentity.laneId,
          member,
          leadDefaults,
          evidence: {
            launchState: 'failed_to_start',
            agentToolAccepted: false,
            runtimeAlive: false,
            bootstrapConfirmed: false,
            hardFailure: true,
            hardFailureReason: diagnostics[0],
            diagnostics,
          },
        });
        continue;
      }

      secondaryMembers.push({
        laneId: laneIdentity.laneId,
        member,
        leadDefaults,
        pendingReason: 'Waiting for OpenCode secondary lane recovery.',
      });
    }

    if (!recoveredAny) {
      return null;
    }

    const primaryStatuses = Object.fromEntries(
      primaryMembers.map((member) => [
        member.name,
        bootstrapStatuses[member.name] ?? createInitialMemberSpawnStatusEntry(),
      ])
    );
    const recoveredSnapshot = this.runtimeLaneCoordinator.buildAggregateLaunchSnapshot({
      teamName,
      leadSessionId: persistedSnapshot?.leadSessionId ?? bootstrapSnapshot?.leadSessionId,
      launchPhase:
        persistedSnapshot?.launchPhase === 'active'
          ? 'active'
          : bootstrapSnapshot?.launchPhase === 'active'
            ? 'active'
            : 'reconciled',
      leadDefaults,
      primaryMembers,
      primaryStatuses,
      secondaryMembers,
    });
    await this.launchStateStore.write(teamName, recoveredSnapshot);
    return recoveredSnapshot;
  }

  private async tryRecoverActiveOpenCodeSecondaryLaneFromRuntime(params: {
    teamName: string;
    laneId: string;
    member: TeamMember;
    projectPath: string | null;
    previousLaunchState: PersistedTeamLaunchSnapshot | null;
  }): Promise<TeamRuntimeMemberLaunchEvidence | null> {
    const adapter = this.getOpenCodeRuntimeAdapter();
    const runtimeProjectPath = params.member.cwd?.trim() || params.projectPath;
    if (!adapter || !runtimeProjectPath) {
      return null;
    }

    try {
      const reconcileResult = await adapter.reconcile({
        runId: randomUUID(),
        laneId: params.laneId,
        teamName: params.teamName,
        providerId: 'opencode',
        expectedMembers: [
          {
            name: params.member.name,
            role: params.member.role,
            workflow: params.member.workflow,
            isolation: params.member.isolation === 'worktree' ? ('worktree' as const) : undefined,
            providerId: 'opencode',
            model: params.member.model,
            effort: params.member.effort,
            cwd: runtimeProjectPath,
          },
        ],
        previousLaunchState: params.previousLaunchState,
        reason: 'startup_recovery',
      });
      return reconcileResult.members[params.member.name] ?? null;
    } catch (error) {
      logger.warn(
        `[${params.teamName}] Failed to recover stale OpenCode lane ${params.laneId} from runtime bridge: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      return null;
    }
  }

  private async readLeadInboxMessagesForLaunchReconcile(
    teamName: string,
    leadName: string
  ): Promise<LeadInboxLaunchReconcileMessage[]> {
    const inboxPath = path.join(getTeamsBasePath(), teamName, 'inboxes', `${leadName}.json`);
    try {
      const raw = await tryReadRegularFileUtf8(inboxPath, {
        timeoutMs: TEAM_JSON_READ_TIMEOUT_MS,
        maxBytes: TEAM_INBOX_MAX_BYTES,
      });
      if (!raw) {
        return [];
      }
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) {
        return [];
      }
      return parsed.flatMap((item): LeadInboxLaunchReconcileMessage[] => {
        if (!item || typeof item !== 'object') {
          return [];
        }
        const row = item as Partial<InboxMessage>;
        return typeof row.from === 'string' &&
          typeof row.text === 'string' &&
          typeof row.timestamp === 'string'
          ? [
              {
                from: row.from,
                text: row.text,
                timestamp: row.timestamp,
                messageId: row.messageId,
              },
            ]
          : [];
      });
    } catch {
      return [];
    }
  }

  private async hasBootstrapTranscriptLaunchReconcileOutcome(
    snapshot: PersistedTeamLaunchSnapshot
  ): Promise<boolean> {
    const expectedMembers = this.getPersistedLaunchMemberNames(snapshot);
    for (const expected of expectedMembers) {
      const current = snapshot.members[expected];
      if (!current || current.bootstrapConfirmed) {
        continue;
      }
      const acceptedAtMs =
        current.firstSpawnAcceptedAt != null ? Date.parse(current.firstSpawnAcceptedAt) : NaN;
      const transcriptOutcome = await this.findBootstrapTranscriptOutcome(
        snapshot.teamName,
        expected,
        Number.isFinite(acceptedAtMs) ? acceptedAtMs : null
      );
      if (transcriptOutcome) {
        return true;
      }
    }
    return false;
  }

  private async reconcilePersistedLaunchState(teamName: string): Promise<{
    snapshot: ReturnType<typeof createPersistedLaunchSnapshot> | null;
    statuses: Record<string, MemberSpawnStatusEntry>;
  }> {
    const bootstrapSnapshot = await readBootstrapLaunchSnapshot(teamName);
    const persisted = await this.launchStateStore.read(teamName);
    const metaMembers = await this.membersMetaStore.getMembers(teamName).catch(() => []);
    const recoveredMixedSnapshot = await this.recoverStaleMixedSecondaryLaunchSnapshot(
      teamName,
      bootstrapSnapshot,
      persisted
    );
    const filteredRecoveredMixedSnapshot = recoveredMixedSnapshot
      ? this.filterRemovedMembersFromLaunchSnapshot(recoveredMixedSnapshot, metaMembers)
      : null;
    if (
      filteredRecoveredMixedSnapshot &&
      !(await this.hasBootstrapTranscriptLaunchReconcileOutcome(filteredRecoveredMixedSnapshot))
    ) {
      return {
        snapshot: filteredRecoveredMixedSnapshot,
        statuses: snapshotToMemberSpawnStatuses(filteredRecoveredMixedSnapshot),
      };
    }
    const filteredBootstrapSnapshot = bootstrapSnapshot
      ? this.filterRemovedMembersFromLaunchSnapshot(bootstrapSnapshot, metaMembers)
      : null;
    const filteredPersisted =
      filteredRecoveredMixedSnapshot ??
      (persisted ? this.filterRemovedMembersFromLaunchSnapshot(persisted, metaMembers) : null);
    const preferredSnapshot = choosePreferredLaunchSnapshot(
      filteredBootstrapSnapshot,
      filteredPersisted
    );
    if (preferredSnapshot && preferredSnapshot === filteredBootstrapSnapshot) {
      return {
        snapshot: preferredSnapshot,
        statuses: snapshotToMemberSpawnStatuses(preferredSnapshot),
      };
    }
    if (!filteredPersisted) {
      return { snapshot: null, statuses: {} };
    }

    const configPath = path.join(getTeamsBasePath(), teamName, 'config.json');
    let configMembers = new Set<string>();
    let leadName = CANONICAL_LEAD_MEMBER_NAME;
    try {
      const raw = await tryReadRegularFileUtf8(configPath, {
        timeoutMs: TEAM_JSON_READ_TIMEOUT_MS,
        maxBytes: TEAM_CONFIG_MAX_BYTES,
      });
      if (raw) {
        const config = JSON.parse(raw) as {
          members?: { name?: string; agentType?: string }[];
        };
        leadName = config.members?.find((member) => isLeadMember(member))?.name?.trim() || leadName;
        configMembers = new Set(
          (config.members ?? [])
            .map((member) => (typeof member?.name === 'string' ? member.name.trim() : ''))
            .filter((name) => name.length > 0 && !isLeadMember({ name }))
        );
      }
    } catch {
      // best-effort
    }

    const leadInboxMessages = await this.readLeadInboxMessagesForLaunchReconcile(
      teamName,
      leadName
    );

    if (
      this.hasPrimaryOnlyLaneAwareLaunchMetadata(filteredPersisted) &&
      !this.hasLeadInboxLaunchReconcileHeartbeat(filteredPersisted, leadInboxMessages) &&
      !(await this.hasBootstrapTranscriptLaunchReconcileOutcome(filteredPersisted))
    ) {
      return {
        snapshot: filteredPersisted,
        statuses: snapshotToMemberSpawnStatuses(filteredPersisted),
      };
    }

    const liveRuntimeByMember = await this.getLiveTeamAgentRuntimeMetadata(teamName);
    const nextMembers = { ...filteredPersisted.members };
    const persistedMemberNames = this.getPersistedLaunchMemberNames(filteredPersisted);
    const now = nowIso();
    for (const expected of persistedMemberNames) {
      const bootstrapMember = bootstrapSnapshot?.members[expected];
      const current = nextMembers[expected] ?? {
        name: expected,
        launchState: 'starting',
        agentToolAccepted: false,
        runtimeAlive: false,
        bootstrapConfirmed: false,
        hardFailure: false,
        lastEvaluatedAt: now,
      };
      if (bootstrapMember?.agentToolAccepted && !current.agentToolAccepted) {
        current.agentToolAccepted = true;
        current.firstSpawnAcceptedAt =
          current.firstSpawnAcceptedAt ?? bootstrapMember.firstSpawnAcceptedAt;
      }
      if (bootstrapMember?.bootstrapConfirmed && !current.bootstrapConfirmed) {
        current.bootstrapConfirmed = true;
        current.lastHeartbeatAt = current.lastHeartbeatAt ?? bootstrapMember.lastHeartbeatAt;
      }
      const matchedConfigNames = [...configMembers].filter((name) =>
        matchesObservedMemberNameForExpected(name, expected)
      );
      const runtimeMetadataCandidates = [...liveRuntimeByMember.entries()].filter(([name]) =>
        matchesObservedMemberNameForExpected(name, expected)
      );
      const runtimeMetadata =
        runtimeMetadataCandidates.find(([, metadata]) => metadata.alive) ??
        runtimeMetadataCandidates[0];
      const observedRuntimeAlive = runtimeMetadata?.[1].alive === true;
      const heartbeatMessage = this.selectLatestLeadInboxLaunchReconcileMessage(
        leadInboxMessages,
        persistedMemberNames,
        expected,
        current.firstSpawnAcceptedAt
      );
      const heartbeatReason = heartbeatMessage
        ? extractBootstrapFailureReason(heartbeatMessage.text)
        : null;
      const acceptedAtMs =
        current.firstSpawnAcceptedAt != null ? Date.parse(current.firstSpawnAcceptedAt) : NaN;
      current.runtimeAlive = observedRuntimeAlive;
      current.lastRuntimeAliveAt = observedRuntimeAlive ? now : current.lastRuntimeAliveAt;
      current.livenessKind = runtimeMetadata?.[1].livenessKind;
      current.pidSource = runtimeMetadata?.[1].pidSource;
      current.runtimeDiagnostic = runtimeMetadata?.[1].runtimeDiagnostic;
      current.runtimeDiagnosticSeverity = runtimeMetadata?.[1].runtimeDiagnosticSeverity;
      current.sources = {
        ...(current.sources ?? {}),
        processAlive: observedRuntimeAlive || undefined,
        configRegistered: matchedConfigNames.length > 0 || undefined,
        configDrift:
          heartbeatMessage != null && matchedConfigNames.length === 0
            ? true
            : current.sources?.configDrift,
        inboxHeartbeat: heartbeatMessage != null ? true : current.sources?.inboxHeartbeat,
      };
      const bootstrapProvesSpawnAcceptance =
        bootstrapMember?.agentToolAccepted === true ||
        typeof bootstrapMember?.firstSpawnAcceptedAt === 'string';
      const currentProvesSpawnAcceptance =
        current.agentToolAccepted === true || typeof current.firstSpawnAcceptedAt === 'string';
      if (
        isNeverSpawnedDuringLaunchReason(current.hardFailureReason) &&
        (bootstrapProvesSpawnAcceptance || currentProvesSpawnAcceptance)
      ) {
        current.hardFailure = false;
        current.hardFailureReason = undefined;
        if (current.sources) {
          current.sources.hardFailureSignal = undefined;
        }
      }
      if (heartbeatReason) {
        current.hardFailure = true;
        current.hardFailureReason = heartbeatReason;
        current.sources.hardFailureSignal = true;
      } else if (heartbeatMessage) {
        current.bootstrapConfirmed = true;
        current.lastHeartbeatAt = heartbeatMessage.timestamp;
        current.hardFailure = false;
        current.hardFailureReason = undefined;
      }
      if (!current.bootstrapConfirmed) {
        const transcriptOutcome = await this.findBootstrapTranscriptOutcome(
          teamName,
          expected,
          Number.isFinite(acceptedAtMs) ? acceptedAtMs : null
        );
        if (transcriptOutcome?.kind === 'success') {
          current.bootstrapConfirmed = true;
          current.lastHeartbeatAt = current.lastHeartbeatAt ?? transcriptOutcome.observedAt;
          current.hardFailure = false;
          current.hardFailureReason = undefined;
          if (current.sources) {
            current.sources.hardFailureSignal = undefined;
          }
        } else if (transcriptOutcome?.kind === 'failure' && !current.hardFailure) {
          current.hardFailure = true;
          current.hardFailureReason = transcriptOutcome.reason;
          current.sources.hardFailureSignal = true;
        }
      }
      const graceExpired =
        current.agentToolAccepted === true &&
        Number.isFinite(acceptedAtMs) &&
        Date.now() - acceptedAtMs >= MEMBER_LAUNCH_GRACE_MS;
      if (
        !current.bootstrapConfirmed &&
        !current.runtimeAlive &&
        !current.hardFailure &&
        graceExpired
      ) {
        current.hardFailure = true;
        current.hardFailureReason =
          current.hardFailureReason ?? 'Teammate did not join within the launch grace window.';
      }
      current.launchState = deriveMemberLaunchState(current);
      current.lastEvaluatedAt = now;
      nextMembers[expected] = {
        ...current,
        diagnostics: undefined,
      };
    }

    const reconciled = createPersistedLaunchSnapshot({
      teamName,
      expectedMembers: persistedMemberNames,
      leadSessionId: filteredPersisted.leadSessionId,
      launchPhase: filteredPersisted.launchPhase,
      members: nextMembers,
      updatedAt: now,
    });

    if (
      reconciled.teamLaunchState === 'clean_success' &&
      !this.hasMixedLaunchMetadata(reconciled)
    ) {
      await this.clearPersistedLaunchState(teamName);
      return { snapshot: null, statuses: {} };
    }

    await this.launchStateStore.write(teamName, reconciled);
    return {
      snapshot: reconciled,
      statuses: snapshotToMemberSpawnStatuses(reconciled),
    };
  }

  private async findBootstrapTranscriptFailureReason(
    teamName: string,
    memberName: string,
    sinceMs: number | null
  ): Promise<string | null> {
    const outcome = await this.findBootstrapTranscriptOutcome(teamName, memberName, sinceMs);
    return outcome?.kind === 'failure' ? outcome.reason : null;
  }

  private async findBootstrapTranscriptOutcome(
    teamName: string,
    memberName: string,
    sinceMs: number | null
  ): Promise<BootstrapTranscriptOutcome | null> {
    let summaries: Awaited<ReturnType<TeamMemberLogsFinder['findMemberLogs']>>;
    try {
      summaries = await this.memberLogsFinder.findMemberLogs(teamName, memberName, sinceMs);
    } catch {
      summaries = [];
    }

    const outcomes: BootstrapTranscriptOutcome[] = [];
    for (const summary of summaries) {
      if (!summary.filePath) continue;
      const outcome = await this.readRecentBootstrapTranscriptOutcome(
        summary.filePath,
        sinceMs,
        memberName,
        teamName,
        { allowAnonymousFailure: true }
      );
      if (outcome) {
        outcomes.push(outcome);
      }
    }

    outcomes.push(
      ...(await this.readBootstrapTranscriptOutcomesInProjectRoot(teamName, memberName, sinceMs))
    );

    return this.selectLatestBootstrapTranscriptOutcome(outcomes);
  }

  private async readRecentBootstrapTranscriptOutcome(
    filePath: string,
    sinceMs: number | null,
    memberName: string,
    teamName: string,
    options: {
      allowAnonymousFailure?: boolean;
      contextMemberNames?: readonly string[];
    } = {}
  ): Promise<BootstrapTranscriptOutcome | null> {
    let handle: fs.promises.FileHandle | null = null;
    const normalizedMemberName = memberName.trim().toLowerCase();
    const contextMemberNames = Array.from(
      new Set(
        [memberName, ...(options.contextMemberNames ?? [])]
          .map((name) => name.trim())
          .filter(Boolean)
      )
    );
    try {
      handle = await fs.promises.open(filePath, 'r');
      const stat = await handle.stat();
      if (!stat.isFile() || stat.size <= 0) {
        return null;
      }
      const start = Math.max(0, stat.size - TeamProvisioningService.BOOTSTRAP_FAILURE_TAIL_BYTES);
      const buffer = Buffer.alloc(stat.size - start);
      if (buffer.length === 0) {
        return null;
      }
      await handle.read(buffer, 0, buffer.length, start);
      const lines = buffer.toString('utf8').split('\n');
      if (start > 0) {
        lines.shift();
      }
      const bootstrapContextMembers = new Set<string>();
      for (const rawLine of lines) {
        const line = rawLine?.trim();
        if (!line) continue;
        let parsed: { timestamp?: unknown } | null = null;
        try {
          parsed = JSON.parse(line) as { timestamp?: unknown };
        } catch {
          continue;
        }
        const timestampMs =
          typeof parsed.timestamp === 'string' ? Date.parse(parsed.timestamp) : Number.NaN;
        if (sinceMs != null && (!Number.isFinite(timestampMs) || timestampMs < sinceMs)) {
          continue;
        }
        const parsedAgentName =
          typeof (parsed as { agentName?: unknown }).agentName === 'string'
            ? (parsed as { agentName?: string }).agentName?.trim().toLowerCase() || null
            : null;
        if (
          parsedAgentName &&
          !matchesObservedMemberNameForExpected(parsedAgentName, normalizedMemberName)
        ) {
          continue;
        }
        const text = extractTranscriptMessageText(parsed);
        if (!text) {
          continue;
        }
        for (const contextMemberName of contextMemberNames) {
          if (isBootstrapTranscriptContextText(text, teamName, contextMemberName)) {
            bootstrapContextMembers.add(contextMemberName.trim().toLowerCase());
          }
        }
      }
      const hasUnambiguousMatchingBootstrapContext =
        bootstrapContextMembers.size === 1 && bootstrapContextMembers.has(normalizedMemberName);
      for (let index = lines.length - 1; index >= 0; index -= 1) {
        const line = lines[index]?.trim();
        if (!line) continue;
        let parsed: { timestamp?: unknown } | null = null;
        try {
          parsed = JSON.parse(line) as { timestamp?: unknown };
        } catch {
          continue;
        }
        const timestampMs =
          typeof parsed.timestamp === 'string' ? Date.parse(parsed.timestamp) : Number.NaN;
        if (sinceMs != null) {
          if (!Number.isFinite(timestampMs) || timestampMs < sinceMs) {
            continue;
          }
        }
        const parsedAgentName =
          typeof (parsed as { agentName?: unknown }).agentName === 'string'
            ? (parsed as { agentName?: string }).agentName?.trim().toLowerCase() || null
            : null;
        if (
          parsedAgentName &&
          !matchesObservedMemberNameForExpected(parsedAgentName, normalizedMemberName)
        ) {
          continue;
        }
        const text = extractTranscriptMessageText(parsed);
        if (!text) continue;
        const observedAt =
          typeof parsed.timestamp === 'string' && parsed.timestamp.trim().length > 0
            ? parsed.timestamp.trim()
            : new Date().toISOString();
        const reason = extractBootstrapFailureReason(text);
        if (reason) {
          if (
            !parsedAgentName &&
            options.allowAnonymousFailure !== true &&
            !hasUnambiguousMatchingBootstrapContext
          ) {
            continue;
          }
          return { kind: 'failure', observedAt, reason };
        }
        if (isBootstrapTranscriptSuccessText(text, teamName, memberName)) {
          return { kind: 'success', observedAt };
        }
      }
    } catch {
      return null;
    } finally {
      await handle?.close().catch(() => undefined);
    }

    return null;
  }

  private async readBootstrapTranscriptOutcomesInProjectRoot(
    teamName: string,
    memberName: string,
    sinceMs: number | null
  ): Promise<BootstrapTranscriptOutcome[]> {
    let config: Awaited<ReturnType<TeamConfigReader['getConfig']>>;
    try {
      config = await this.configReader.getConfig(teamName);
    } catch {
      return [];
    }
    const projectPath = config?.projectPath?.trim();
    if (!projectPath) {
      return [];
    }

    const projectDir = path.join(getProjectsBasePath(), extractBaseDir(encodePath(projectPath)));
    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(projectDir, { withFileTypes: true });
    } catch {
      return [];
    }

    const outcomes: BootstrapTranscriptOutcome[] = [];
    const jsonlFiles = entries
      .filter((entry) => entry.isFile() && entry.name.endsWith('.jsonl'))
      .sort((left, right) => right.name.localeCompare(left.name));
    const contextMemberNames = [
      memberName,
      ...((config?.members ?? [])
        .map((member) => member.name?.trim())
        .filter((name): name is string => Boolean(name)) ?? []),
    ];
    for (const entry of jsonlFiles) {
      if (config?.leadSessionId && entry.name === `${config.leadSessionId}.jsonl`) {
        continue;
      }
      const outcome = await this.readRecentBootstrapTranscriptOutcome(
        path.join(projectDir, entry.name),
        sinceMs,
        memberName,
        teamName,
        { contextMemberNames }
      );
      if (outcome) {
        outcomes.push(outcome);
      }
    }

    return outcomes;
  }

  private selectLatestBootstrapTranscriptOutcome(
    outcomes: readonly BootstrapTranscriptOutcome[]
  ): BootstrapTranscriptOutcome | null {
    return (
      [...outcomes].sort((left, right) => {
        const leftMs = Date.parse(left.observedAt);
        const rightMs = Date.parse(right.observedAt);
        const leftValid = Number.isFinite(leftMs);
        const rightValid = Number.isFinite(rightMs);
        if (leftValid && rightValid && leftMs !== rightMs) {
          return rightMs - leftMs;
        }
        if (leftValid !== rightValid) {
          return leftValid ? -1 : 1;
        }
        return 0;
      })[0] ?? null
    );
  }

  private captureSendMessages(run: ProvisioningRun, content: Record<string, unknown>[]): void {
    for (const part of content) {
      if (part.type !== 'tool_use' || typeof part.name !== 'string') continue;
      const isNativeSendMessage = part.name === 'SendMessage';
      const input = part.input;
      if (!input || typeof input !== 'object') continue;
      const inp = input as Record<string, unknown>;
      const isTeamMessageSendTool = isAgentTeamsToolUse({
        rawName: part.name,
        canonicalName: 'message_send',
        toolInput: inp,
        currentTeamName: run.teamName,
      });
      const isDirectCrossTeamSendTool = isAgentTeamsToolUse({
        rawName: part.name,
        canonicalName: 'cross_team_send',
        toolInput: inp,
        currentTeamName: run.teamName,
      });
      if (!isNativeSendMessage && !isTeamMessageSendTool && !isDirectCrossTeamSendTool) continue;

      if (isDirectCrossTeamSendTool) {
        const toTeam = typeof inp.toTeam === 'string' ? inp.toTeam.trim() : '';
        const text = typeof inp.text === 'string' ? stripAgentBlocks(inp.text).trim() : '';
        if (toTeam && text) {
          run.pendingDirectCrossTeamSendRefresh = true;
        }
        continue;
      }

      const recipient = isNativeSendMessage
        ? this.extractMessageToolTarget(inp, ['recipient', 'to'])
        : this.extractMessageToolTarget(inp, ['to']);
      if (!recipient.trim()) continue;

      const msgContent = this.extractMessageToolText(inp);
      if (msgContent.trim().length === 0) continue;

      const summary = typeof inp.summary === 'string' ? inp.summary : '';
      const leadName =
        run.request.members.find((m) => m.role?.toLowerCase().includes('lead'))?.name ||
        CANONICAL_LEAD_MEMBER_NAME;

      const cleanContent = stripAgentBlocks(msgContent);
      if (cleanContent.trim().length === 0) continue;
      const strippedCrossTeamContent = stripCrossTeamPrefix(cleanContent).trim();
      if (strippedCrossTeamContent.length === 0) continue;
      const localRecipientNames = new Set(
        (run.request.members ?? [])
          .map((member) => (typeof member.name === 'string' ? member.name.trim() : ''))
          .filter((name) => name.length > 0)
      );
      localRecipientNames.add('user');
      localRecipientNames.add(CANONICAL_LEAD_MEMBER_NAME);
      localRecipientNames.add(LEGACY_LEAD_MEMBER_NAME);

      const mistakenToolHint = this.isCrossTeamToolRecipientName(recipient)
        ? this.resolveSingleActiveCrossTeamReplyHint(run)
        : null;
      const crossTeamRecipient =
        this.parseCrossTeamRecipient(run.teamName, recipient, localRecipientNames) ??
        (mistakenToolHint
          ? { teamName: mistakenToolHint.toTeam, memberName: CANONICAL_LEAD_MEMBER_NAME }
          : null);
      if (crossTeamRecipient && this.crossTeamSender) {
        const inferredReplyMeta =
          mistakenToolHint?.toTeam === crossTeamRecipient.teamName
            ? {
                conversationId: mistakenToolHint.conversationId,
                replyToConversationId: mistakenToolHint.conversationId,
              }
            : this.resolveCrossTeamReplyMetadata(run.teamName, crossTeamRecipient.teamName);
        const crossTeamMeta = parseCrossTeamPrefix(cleanContent);
        const replyMeta = inferredReplyMeta;
        const timestamp = nowIso();
        const messageId = `lead-sendmsg-${run.runId}-${Date.now()}`;
        const taskRefs = teamToolTaskRefs(run.teamName, inp.taskRefs);

        void this.crossTeamSender({
          fromTeam: run.teamName,
          fromMember: leadName,
          toTeam: crossTeamRecipient.teamName,
          text: strippedCrossTeamContent,
          summary,
          ...(taskRefs ? { taskRefs } : {}),
          messageId,
          timestamp,
          conversationId: crossTeamMeta?.conversationId ?? replyMeta?.conversationId,
          replyToConversationId:
            replyMeta?.replyToConversationId ??
            crossTeamMeta?.conversationId ??
            replyMeta?.conversationId,
        })
          .then((result) => {
            if (result.deduplicated) {
              return;
            }
            if (this.getTrackedRunId(run.teamName) !== run.runId) {
              logger.debug(
                `[${run.teamName}] Skipping stale cross-team send result for old run ${run.runId}`
              );
              return;
            }
            const msg: InboxMessage = {
              from: leadName,
              to: recipient.startsWith('cross-team:')
                ? recipient
                : this.isCrossTeamToolRecipientName(recipient)
                  ? `${crossTeamRecipient.teamName}.${crossTeamRecipient.memberName}`
                  : `${crossTeamRecipient.teamName}.${crossTeamRecipient.memberName}`,
              text: strippedCrossTeamContent,
              timestamp,
              read: true,
              summary:
                (summary || strippedCrossTeamContent).length > 60
                  ? (summary || strippedCrossTeamContent).slice(0, 57) + '...'
                  : summary || strippedCrossTeamContent,
              messageId: result.messageId,
              source: 'cross_team_sent',
              conversationId: crossTeamMeta?.conversationId ?? replyMeta?.conversationId,
              replyToConversationId:
                replyMeta?.replyToConversationId ??
                crossTeamMeta?.conversationId ??
                replyMeta?.conversationId,
              ...(taskRefs ? { taskRefs } : {}),
            };
            this.pushLiveLeadProcessMessage(run.teamName, msg);
            this.teamChangeEmitter?.({
              type: 'lead-message',
              teamName: run.teamName,
              runId: run.runId,
              detail: 'cross-team-send',
            });
          })
          .catch((error: unknown) => {
            logger.warn(
              `[${run.teamName}] qualified SendMessage→${recipient} cross-team fallback failed: ${
                error instanceof Error ? error.message : String(error)
              }`
            );
          });
        continue;
      }

      if (this.isCrossTeamToolRecipientName(recipient)) {
        continue;
      }

      // Suppress user replies during member_inbox_relay.
      // Context: when relaying inbox messages, the lead sometimes ignores the relay
      // instruction and responds to the user directly instead of forwarding to the
      // target teammate. This filter prevents that wrong response from appearing
      // in the UI and being persisted to sentMessages.json.
      // Note: teammate DM relay is currently disabled (see teams.ts handleSendMessage
      // and index.ts FileWatcher). This guard is kept as safety net in case relay
      // is re-enabled in the future.
      if (recipient === 'user' && run.silentUserDmForward?.mode === 'member_inbox_relay') {
        logger.debug(
          `[${run.teamName}] Suppressed SendMessage→user during member_inbox_relay to "${run.silentUserDmForward.target}"`
        );
        continue;
      }

      const relayOfMessageId =
        recipient !== 'user'
          ? this.consumePendingInboxRelayCandidate(
              run,
              recipient,
              strippedCrossTeamContent,
              summary
            )
          : undefined;

      const msg: InboxMessage = {
        from: leadName,
        to: recipient,
        text: strippedCrossTeamContent,
        timestamp: nowIso(),
        read: recipient !== 'user',
        summary:
          (summary || strippedCrossTeamContent).length > 60
            ? (summary || strippedCrossTeamContent).slice(0, 57) + '...'
            : summary || strippedCrossTeamContent,
        messageId: `lead-sendmsg-${run.runId}-${Date.now()}`,
        ...(relayOfMessageId ? { relayOfMessageId } : {}),
        source: 'lead_process',
        ...(recipient === 'user' && run.leadRelayCapture?.externalChannel
          ? { externalChannel: run.leadRelayCapture.externalChannel }
          : {}),
      };

      this.pushLiveLeadProcessMessage(run.teamName, msg);

      if (recipient === 'user') {
        // User-directed messages go to sentMessages.json (canonical outbound store)
        this.persistSentMessage(run.teamName, msg);
        if (run.leadRelayCapture && !run.leadRelayCapture.settled) {
          run.leadRelayCapture.visibleUserMessageCaptured = true;
          run.leadRelayCapture.textParts.push(strippedCrossTeamContent);
          run.leadRelayCapture.resolveOnce(strippedCrossTeamContent);
        } else {
          this.pushLeadUserMessageToRecentFeishu(run.teamName, strippedCrossTeamContent);
        }
        this.teamChangeEmitter?.({
          type: 'inbox',
          teamName: run.teamName,
          detail: 'sentMessages.json',
        });
      } else {
        // Non-user messages go to canonical recipient inbox for relay delivery
        this.persistInboxMessage(run.teamName, recipient, msg);
        this.teamChangeEmitter?.({
          type: 'inbox',
          teamName: run.teamName,
          detail: `inboxes/${recipient}.json`,
        });
      }

      logger.debug(
        `[${run.teamName}] Captured SendMessage→${recipient} from stdout: ${cleanContent.slice(0, 100)}`
      );
    }
  }

  pushLiveLeadProcessMessage(teamName: string, message: InboxMessage): void {
    // Enrich with leadSessionId if missing — needed for session boundary separators
    if (!message.leadSessionId) {
      const runId = this.getTrackedRunId(teamName);
      if (runId) {
        const run = this.runs.get(runId);
        if (run?.detectedSessionId) {
          message.leadSessionId = run.detectedSessionId;
        }
      }
    }
    const MAX = 100;
    const list = this.liveLeadProcessMessages.get(teamName) ?? [];
    const id = typeof message.messageId === 'string' ? message.messageId.trim() : '';
    if (id) {
      const existingIdx = list.findIndex((m) => (m.messageId ?? '').trim() === id);
      if (existingIdx >= 0) {
        list[existingIdx] = message;
      } else {
        list.push(message);
      }
    } else {
      list.push(message);
    }
    if (list.length > MAX) {
      list.splice(0, list.length - MAX);
    }
    this.liveLeadProcessMessages.set(teamName, list);
  }

  private pushLeadUserMessageToRecentFeishu(teamName: string, text: string): void {
    const cleanText = stripAgentBlocks(text).trim();
    if (!cleanText) {
      return;
    }
    void getLeadChannelListenerService()
      .sendToRecentFeishuTarget(teamName, cleanText)
      .then((sent) => {
        if (!sent) {
          logger.warn(`[${teamName}] No recent Feishu chat target available for lead user message`);
        }
      })
      .catch((error: unknown) => {
        logger.warn(`[${teamName}] Failed to push lead user message to Feishu: ${String(error)}`);
      });
  }

  private persistExternalChannelUserMessage(
    teamName: string,
    input: {
      leadName: string;
      provider: 'feishu';
      channelId: string;
      channelName: string;
      chatId: string;
      senderId?: string;
      text: string;
      messageId?: string;
    }
  ): void {
    const text = input.text.trim();
    if (!text) {
      return;
    }
    const message: InboxMessage = {
      from: 'user',
      to: input.leadName,
      text,
      timestamp: nowIso(),
      read: true,
      summary: text.length > 60 ? text.slice(0, 57) + '...' : text,
      messageId: input.messageId?.trim() || `external-user-${input.channelId}-${Date.now()}`,
      source: 'user_sent',
      externalChannel: {
        provider: input.provider,
        channelId: input.channelId,
        channelName: input.channelName,
        chatId: input.chatId,
        senderId: input.senderId,
      },
    };
    this.persistSentMessage(teamName, message);
    this.pushLiveLeadProcessMessage(teamName, message);
    this.teamChangeEmitter?.({
      type: 'inbox',
      teamName,
      detail: 'external-channel-user-message',
    });
  }

  resolveCrossTeamReplyMetadata(
    teamName: string,
    toTeam: string
  ): { conversationId: string; replyToConversationId: string } | null {
    const runId = this.getAliveRunId(teamName);
    if (!runId) return null;
    const run = this.runs.get(runId);
    const hints = run?.activeCrossTeamReplyHints ?? [];
    if (hints.length === 0) return null;

    const matches = hints.filter((hint) => hint.toTeam === toTeam);
    if (matches.length !== 1) return null;

    return {
      conversationId: matches[0].conversationId,
      replyToConversationId: matches[0].conversationId,
    };
  }

  /**
   * Create an InboxMessage from assistant text and push it into the live cache.
   * Used for both pre-ready (provisioning) and post-ready assistant text.
   * Emits a coalesced `lead-message` event for renderer refresh.
   */
  private getStableLeadThoughtMessageId(msg: Record<string, unknown>): string | null {
    const entryUuid = typeof msg.uuid === 'string' ? msg.uuid.trim() : '';
    if (entryUuid) {
      return `lead-thought-${entryUuid}`;
    }

    const message = (msg.message ?? msg) as Record<string, unknown>;
    const assistantMessageId = typeof message.id === 'string' ? message.id.trim() : '';
    if (assistantMessageId) {
      return `lead-thought-msg-${assistantMessageId}`;
    }

    return null;
  }

  private appendProvisioningAssistantText(
    run: ProvisioningRun,
    msg: Record<string, unknown>,
    text: string
  ): void {
    const normalized = text.trim();
    if (normalized.length === 0) {
      return;
    }

    const stableMessageId = this.getStableLeadThoughtMessageId(msg);
    if (stableMessageId) {
      const existingIndex = run.provisioningOutputIndexByMessageId.get(stableMessageId);
      if (existingIndex != null) {
        run.provisioningOutputParts[existingIndex] = text;
        return;
      }
    }

    const lastIndex = run.provisioningOutputParts.length - 1;
    if (lastIndex >= 0 && run.provisioningOutputParts[lastIndex]?.trim() === normalized) {
      return;
    }

    const newIndex = run.provisioningOutputParts.push(text) - 1;
    if (stableMessageId) {
      run.provisioningOutputIndexByMessageId.set(stableMessageId, newIndex);
    }
  }

  private shiftProvisioningOutputIndexesAfterRemoval(
    run: ProvisioningRun,
    removedIndex: number
  ): void {
    for (const [messageId, index] of run.provisioningOutputIndexByMessageId.entries()) {
      if (index > removedIndex) {
        run.provisioningOutputIndexByMessageId.set(messageId, index - 1);
      }
    }
  }

  private pushLiveLeadTextMessage(
    run: ProvisioningRun,
    cleanText: string,
    stableMessageId?: string,
    messageTimestamp?: string
  ): void {
    run.leadMsgSeq += 1;
    const leadName = this.getRunLeadName(run);
    const messageId = stableMessageId || `lead-turn-${run.runId}-${run.leadMsgSeq}`;
    const timestamp =
      typeof messageTimestamp === 'string' &&
      messageTimestamp.trim().length > 0 &&
      Number.isFinite(Date.parse(messageTimestamp))
        ? messageTimestamp
        : nowIso();
    // Attach accumulated tool call details from preceding tool_use messages, then reset.
    const toolCalls = run.pendingToolCalls.length > 0 ? [...run.pendingToolCalls] : undefined;
    const toolSummary = toolCalls ? formatToolSummaryFromCalls(toolCalls) : undefined;
    run.pendingToolCalls = [];
    const leadMsg: InboxMessage = {
      from: leadName,
      text: cleanText,
      timestamp,
      read: true,
      summary: cleanText.length > 60 ? cleanText.slice(0, 57) + '...' : cleanText,
      messageId,
      source: 'lead_process',
      toolSummary,
      toolCalls,
    };
    this.pushLiveLeadProcessMessage(run.teamName, leadMsg);

    // Coalesced refresh: at most one event per LEAD_TEXT_EMIT_THROTTLE_MS per team.
    const now = Date.now();
    if (now - run.lastLeadTextEmitMs >= TeamProvisioningService.LEAD_TEXT_EMIT_THROTTLE_MS) {
      run.lastLeadTextEmitMs = now;
      this.teamChangeEmitter?.({
        type: 'lead-message',
        teamName: run.teamName,
        runId: run.runId,
        detail: 'lead-text',
      });
    }
  }

  /**
   * Stop the running process for a team. No-op if team is not running.
   * Always uses SIGKILL via killTeamProcess() to prevent CLI cleanup.
   */
  async stopTeam(teamName: string): Promise<void> {
    this.agentRuntimeSnapshotCache.delete(teamName);
    this.liveTeamAgentRuntimeMetadataCache.delete(teamName);
    this.stopPersistentTeamMembers(teamName);

    const runId = this.getTrackedRunId(teamName);
    const remoteRun = this.remoteRuntimeByTeam.get(teamName);
    if (remoteRun && (!runId || runId === remoteRun.runId)) {
      await this.ensureRemoteMachineConnected(remoteRun.machineId);
      if (this.sshConnectionManager && remoteRun.pid) {
        await this.sshConnectionManager
          .execOnMachine(remoteRun.machineId, buildRemoteKillProcessTreeCommand(remoteRun.pid))
          .catch(() => undefined);
      }
      await this.writeRemoteJson(
        remoteRun.machineId,
        path.posix.join(
          remoteRun.cwd,
          '.claude',
          'agent-teams-control',
          'teams',
          teamName,
          'runtime',
          'status.json'
        ),
        {
          version: 1,
          runId: remoteRun.runId,
          teamName,
          state: 'stopped',
          machineId: remoteRun.machineId,
          pid: remoteRun.pid,
          cwd: remoteRun.cwd,
          updatedAt: nowIso(),
        }
      ).catch(() => undefined);
      this.remoteRuntimeByTeam.delete(teamName);
      this.provisioningRunByTeam.delete(teamName);
      this.aliveRunByTeam.delete(teamName);
      return;
    }
    if (!runId) {
      if (this.hasSecondaryRuntimeRuns(teamName)) {
        await this.stopMixedSecondaryRuntimeLanes(teamName);
      }
      return;
    }
    const run = this.runs.get(runId);
    if (!run) {
      const runtimeProgress = this.runtimeAdapterProgressByRunId.get(runId);
      if (runtimeProgress && this.isCancellableRuntimeAdapterProgress(runtimeProgress)) {
        await this.cancelRuntimeAdapterProvisioning(runId, runtimeProgress);
        return;
      }
      const runtimeRun = this.runtimeAdapterRunByTeam.get(teamName);
      if (runtimeRun?.runId === runId && runtimeRun.providerId === 'opencode') {
        await this.withTeamLock(teamName, async () => {
          const currentRuntimeRun = this.runtimeAdapterRunByTeam.get(teamName);
          if (currentRuntimeRun?.runId === runId && currentRuntimeRun.providerId === 'opencode') {
            await this.stopOpenCodeRuntimeAdapterTeam(teamName, runId);
          }
        });
        return;
      }
      if (this.hasSecondaryRuntimeRuns(teamName)) {
        await this.stopMixedSecondaryRuntimeLanes(teamName);
      }
      this.provisioningRunByTeam.delete(teamName);
      this.aliveRunByTeam.delete(teamName);
      return;
    }
    if (run.processKilled || run.cancelRequested) {
      if (this.hasSecondaryRuntimeRuns(teamName)) {
        await this.stopMixedSecondaryRuntimeLanes(teamName);
      }
      return;
    }
    run.processKilled = true;
    run.cancelRequested = true;
    killTeamProcess(run.child);
    const stopSecondaryRuntimeLanes = this.hasSecondaryRuntimeRuns(teamName)
      ? this.stopMixedSecondaryRuntimeLanes(teamName)
      : null;
    const progress = updateProgress(run, 'disconnected', 'Team stopped by user');
    run.onProgress(progress);
    this.cleanupRun(run);
    logger.info(`[${teamName}] Process stopped (SIGKILL)`);
    await stopSecondaryRuntimeLanes;
  }

  private getShutdownTrackedTeamNames(): string[] {
    const teamNames = new Set<string>();
    for (const teamName of this.provisioningRunByTeam.keys()) teamNames.add(teamName);
    for (const teamName of this.aliveRunByTeam.keys()) teamNames.add(teamName);
    for (const teamName of this.runtimeAdapterRunByTeam.keys()) teamNames.add(teamName);
    for (const teamName of this.secondaryRuntimeRunByTeam.keys()) teamNames.add(teamName);
    for (const teamName of this.teamOpLocks.keys()) teamNames.add(teamName);
    for (const progress of this.getPendingRuntimeAdapterLaunchesForShutdown()) {
      teamNames.add(progress.teamName);
    }
    return Array.from(teamNames);
  }

  private async stopTrackedTeamsForShutdown(label: string): Promise<string[]> {
    const teamNames = this.getShutdownTrackedTeamNames();
    if (teamNames.length === 0) {
      return teamNames;
    }

    logger.info(`${label}: stopping tracked team processes: ${teamNames.join(', ')}`);
    await Promise.all(
      teamNames.map((teamName) =>
        this.stopTeam(teamName).catch((error) => {
          logger.warn(
            `[${teamName}] Failed to stop team during shutdown: ${
              error instanceof Error ? error.message : String(error)
            }`
          );
        })
      )
    );
    return teamNames;
  }

  private async cancelPendingRuntimeAdapterLaunchesForShutdown(): Promise<void> {
    const pendingRuntimeLaunches = this.getPendingRuntimeAdapterLaunchesForShutdown();
    if (pendingRuntimeLaunches.length === 0) {
      return;
    }

    logger.info(
      `Cancelling pending OpenCode runtime adapter launches on shutdown: ${pendingRuntimeLaunches
        .map((progress) => progress.teamName)
        .join(', ')}`
    );
    await Promise.all(
      pendingRuntimeLaunches.map((progress) =>
        this.cancelRuntimeAdapterProvisioning(progress.runId, progress).catch((error) => {
          logger.warn(
            `[${progress.teamName}] Failed to cancel pending OpenCode runtime adapter launch on shutdown: ${
              error instanceof Error ? error.message : String(error)
            }`
          );
        })
      )
    );
  }

  private async waitForInFlightTeamOperationsForShutdown(timeoutMs = 2_000): Promise<void> {
    const locks = Array.from(this.teamOpLocks.values());
    if (locks.length === 0) {
      return;
    }

    let timedOut = false;
    let timeout: ReturnType<typeof setTimeout> | null = null;
    await Promise.race([
      Promise.allSettled(locks).then(() => undefined),
      new Promise<void>((resolve) => {
        timeout = setTimeout(() => {
          timedOut = true;
          resolve();
        }, timeoutMs);
        timeout.unref?.();
      }),
    ]);
    if (timeout) {
      clearTimeout(timeout);
    }
    if (timedOut) {
      logger.warn(
        `Timed out after ${timeoutMs}ms waiting for in-flight team operations during shutdown`
      );
    }
  }

  private killTransientProbeProcessesForShutdown(): void {
    for (const child of Array.from(this.transientProbeProcesses)) {
      try {
        killProcessTree(child);
      } catch (error) {
        logger.debug(
          `Failed to kill transient probe process during shutdown: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }
    }
  }

  private async stopMixedSecondaryRuntimeLanes(teamName: string): Promise<void> {
    const secondaryRuns = this.getSecondaryRuntimeRuns(teamName);
    if (secondaryRuns.length === 0) {
      return;
    }
    this.stoppingSecondaryRuntimeTeams.add(teamName);
    try {
      const adapter = this.getOpenCodeRuntimeAdapter();
      const previousLaunchState = await this.launchStateStore.read(teamName);
      if (!adapter) {
        await Promise.all(
          secondaryRuns.map((secondaryRun) =>
            clearOpenCodeRuntimeLaneStorage({
              teamsBasePath: getTeamsBasePath(),
              teamName,
              laneId: secondaryRun.laneId,
            }).catch(() => undefined)
          )
        );
        this.clearSecondaryRuntimeRuns(teamName);
        return;
      }
      try {
        for (const secondaryRun of secondaryRuns) {
          await clearOpenCodeRuntimeLaneStorage({
            teamsBasePath: getTeamsBasePath(),
            teamName,
            laneId: secondaryRun.laneId,
          }).catch(() => undefined);
          try {
            await adapter.stop({
              runId: secondaryRun.runId,
              laneId: secondaryRun.laneId,
              teamName,
              cwd: secondaryRun.cwd ?? this.readPersistedTeamProjectPath(teamName) ?? undefined,
              providerId: 'opencode',
              reason: 'user_requested',
              previousLaunchState,
              force: true,
            });
          } catch (error) {
            logger.warn(
              `[${teamName}] Failed to stop mixed OpenCode secondary lane ${secondaryRun.laneId}: ${
                error instanceof Error ? error.message : String(error)
              }`
            );
          } finally {
            await clearOpenCodeRuntimeLaneStorage({
              teamsBasePath: getTeamsBasePath(),
              teamName,
              laneId: secondaryRun.laneId,
            }).catch(() => undefined);
            this.deleteSecondaryRuntimeRun(teamName, secondaryRun.laneId);
          }
        }
      } finally {
        this.clearSecondaryRuntimeRuns(teamName);
      }
    } finally {
      this.stoppingSecondaryRuntimeTeams.delete(teamName);
    }
  }

  private async stopOpenCodeRuntimeAdapterTeam(teamName: string, runId: string): Promise<void> {
    const adapter = this.getOpenCodeRuntimeAdapter();
    const previousLaunchState = await this.launchStateStore.read(teamName);
    if (!adapter) {
      await clearOpenCodeRuntimeLaneStorage({
        teamsBasePath: getTeamsBasePath(),
        teamName,
        laneId: 'primary',
      }).catch(() => undefined);
      this.runtimeAdapterRunByTeam.delete(teamName);
      this.aliveRunByTeam.delete(teamName);
      this.provisioningRunByTeam.delete(teamName);
      return;
    }
    const startedAt = nowIso();
    const previousProgress = this.runtimeAdapterProgressByRunId.get(runId);
    const runtimeRun = this.runtimeAdapterRunByTeam.get(teamName);
    this.setRuntimeAdapterProgress({
      runId,
      teamName,
      state: 'disconnected',
      message: 'Stopping OpenCode team through runtime adapter',
      startedAt: previousProgress?.startedAt ?? startedAt,
      updatedAt: startedAt,
    });
    this.runtimeAdapterRunByTeam.delete(teamName);
    this.aliveRunByTeam.delete(teamName);
    if (this.provisioningRunByTeam.get(teamName) === runId) {
      this.provisioningRunByTeam.delete(teamName);
    }
    try {
      await clearOpenCodeRuntimeLaneStorage({
        teamsBasePath: getTeamsBasePath(),
        teamName,
        laneId: 'primary',
      }).catch(() => undefined);
      const result = await adapter.stop({
        runId,
        laneId: 'primary',
        teamName,
        cwd: runtimeRun?.cwd ?? this.readPersistedTeamProjectPath(teamName) ?? undefined,
        providerId: 'opencode',
        reason: 'user_requested',
        previousLaunchState,
        force: true,
      });
      await this.launchStateStore.write(
        teamName,
        createPersistedLaunchSnapshot({
          teamName,
          expectedMembers: previousLaunchState?.expectedMembers ?? [],
          leadSessionId: previousLaunchState?.leadSessionId,
          launchPhase: 'reconciled',
          members: previousLaunchState?.members ?? {},
        })
      );
      this.setRuntimeAdapterProgress({
        runId,
        teamName,
        state: result.stopped ? 'disconnected' : 'failed',
        message: result.stopped ? 'OpenCode team stopped' : 'OpenCode team stop failed',
        messageSeverity: result.stopped ? undefined : 'error',
        startedAt: previousProgress?.startedAt ?? startedAt,
        updatedAt: nowIso(),
        cliLogsTail: result.diagnostics.join('\n') || undefined,
        warnings: result.warnings.length > 0 ? result.warnings : undefined,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.setRuntimeAdapterProgress({
        runId,
        teamName,
        state: 'failed',
        message: 'OpenCode team stop failed',
        messageSeverity: 'error',
        startedAt: previousProgress?.startedAt ?? startedAt,
        updatedAt: nowIso(),
        error: message,
        cliLogsTail: message,
      });
    } finally {
      await clearOpenCodeRuntimeLaneStorage({
        teamsBasePath: getTeamsBasePath(),
        teamName,
        laneId: 'primary',
      }).catch(() => undefined);
      this.runtimeAdapterRunByTeam.delete(teamName);
      this.aliveRunByTeam.delete(teamName);
      this.provisioningRunByTeam.delete(teamName);
      this.teamChangeEmitter?.({
        type: 'process',
        teamName,
        runId,
        detail: 'stopped',
      });
    }
  }

  private stopPersistentTeamMembers(teamName: string): void {
    const members = this.readPersistedRuntimeMembers(teamName);
    if (members.length > 0) {
      this.killPersistedPaneMembers(teamName, members);
    }
    this.killOrphanedTeamAgentProcesses(teamName);
  }

  private killEmptyOrphanedClaudeSwarmTmuxServers(reason: string): void {
    if (process.platform === 'win32') {
      return;
    }

    let output = '';
    try {
      output = execFileSync('ps', ['-ax', '-o', 'pid=,ppid=,command='], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      });
    } catch {
      return;
    }

    const servers: { pid: number; socketName: string }[] = [];
    for (const line of output.split('\n')) {
      const match = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line);
      if (!match) continue;
      const pid = Number.parseInt(match[1] ?? '', 10);
      const ppid = Number.parseInt(match[2] ?? '', 10);
      const command = match[3] ?? '';
      if (!Number.isFinite(pid) || !Number.isFinite(ppid) || ppid !== 1) {
        continue;
      }
      const socketMatch = /\btmux\s+-L\s+(claude-swarm-[^\s]+)\s+new-session\b/.exec(command);
      if (socketMatch?.[1]) {
        servers.push({ pid, socketName: socketMatch[1] });
      }
    }

    for (const server of servers) {
      if (this.tmuxServerHasSessions(server.socketName)) {
        continue;
      }
      try {
        execFileSync('tmux', ['-L', server.socketName, 'kill-server'], {
          stdio: 'ignore',
        });
        logger.info(
          `Killed empty orphaned Claude swarm tmux server ${server.socketName} (${server.pid}) during ${reason}`
        );
      } catch {
        try {
          killProcessByPid(server.pid);
          logger.info(
            `Killed empty orphaned Claude swarm tmux process ${server.socketName} (${server.pid}) during ${reason}`
          );
        } catch (error) {
          logger.debug(
            `Failed to kill empty orphaned Claude swarm tmux server ${server.socketName} (${server.pid}): ${
              error instanceof Error ? error.message : String(error)
            }`
          );
        }
      }
    }
  }

  private tmuxServerHasSessions(socketName: string): boolean {
    try {
      const sessions = execFileSync('tmux', ['-L', socketName, 'list-sessions'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      return sessions.trim().length > 0;
    } catch {
      return false;
    }
  }

  private readPersistedTeamProjectPath(teamName: string): string | null {
    const configPath = path.join(getTeamsBasePath(), teamName, 'config.json');
    try {
      const raw = fs.readFileSync(configPath, 'utf8');
      const parsed = JSON.parse(raw) as { projectPath?: unknown };
      const projectPath = typeof parsed.projectPath === 'string' ? parsed.projectPath.trim() : '';
      return projectPath || null;
    } catch {
      return null;
    }
  }

  private readPersistedRuntimeMembers(teamName: string): PersistedRuntimeMemberLike[] {
    const configPath = path.join(getTeamsBasePath(), teamName, 'config.json');
    try {
      const raw = fs.readFileSync(configPath, 'utf8');
      const parsed = JSON.parse(raw) as { members?: unknown };
      if (!Array.isArray(parsed.members)) {
        return [];
      }
      return parsed.members.filter((member): member is PersistedRuntimeMemberLike => {
        return !!member && typeof member === 'object';
      });
    } catch {
      return [];
    }
  }

  private listPersistedTeamNames(): string[] {
    try {
      return fs
        .readdirSync(getTeamsBasePath(), { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name.trim())
        .filter((name) => name.length > 0);
    } catch {
      return [];
    }
  }

  private killPersistedPaneMembers(teamName: string, members: PersistedRuntimeMemberLike[]): void {
    for (const member of members) {
      const name = typeof member.name === 'string' ? member.name.trim() : '';
      const paneId = typeof member.tmuxPaneId === 'string' ? member.tmuxPaneId.trim() : '';
      const backendType =
        typeof member.backendType === 'string' ? member.backendType.trim().toLowerCase() : '';
      if (!name || isLeadMemberName(name) || !paneId || backendType !== 'tmux') {
        continue;
      }
      try {
        killTmuxPaneForCurrentPlatformSync(paneId);
        logger.info(`[${teamName}] Killed teammate pane ${name} (${paneId}) during stop`);
      } catch (error) {
        logger.debug(
          `[${teamName}] Failed to kill teammate pane ${name} (${paneId}) during stop: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }
    }
  }

  private killOrphanedTeamAgentProcesses(teamName: string): void {
    const currentRunPid = this.getTrackedRunId(teamName)
      ? this.runs.get(this.getTrackedRunId(teamName)!)?.child?.pid
      : undefined;
    const pids = new Set<number>();
    const rows: { pid: number; command: string }[] = [];

    if (process.platform === 'win32') {
      try {
        rows.push(
          ...listWindowsProcessTableSync().map((row) => ({ pid: row.pid, command: row.command }))
        );
      } catch {
        return;
      }
    } else {
      let output = '';
      try {
        output = execFileSync('ps', ['-ax', '-o', 'pid=,command='], {
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'ignore'],
        });
      } catch {
        return;
      }

      for (const line of output.split('\n')) {
        const trimmed = line.trim();
        const match = /^(\d+)\s+(.*)$/.exec(trimmed);
        if (!match) continue;
        const pid = Number.parseInt(match[1], 10);
        if (!Number.isFinite(pid) || pid <= 0) continue;
        rows.push({ pid, command: match[2] ?? '' });
      }
    }

    for (const row of rows) {
      if (
        !commandArgEquals(row.command, '--team-name', teamName) ||
        !row.command.includes('--agent-id')
      ) {
        continue;
      }
      if (currentRunPid && row.pid === currentRunPid) continue;
      pids.add(row.pid);
    }

    for (const pid of pids) {
      try {
        killProcessByPid(pid);
        logger.info(`[${teamName}] Killed orphaned teammate process pid=${pid} during stop`);
      } catch (error) {
        logger.debug(
          `[${teamName}] Failed to kill orphaned teammate process pid=${pid}: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }
    }
  }

  /**
   * Stop all running team processes. Called during app shutdown.
   * Uses killTeamProcess() (SIGKILL) to guarantee instant death
   * without CLI cleanup that would delete team files.
   */
  async stopAllTeams(): Promise<void> {
    this.stopAllTeamsGeneration += 1;
    killTrackedCliProcesses('SIGKILL');
    this.killTransientProbeProcessesForShutdown();

    const initialTracked = await this.stopTrackedTeamsForShutdown('Shutdown');
    await this.cancelPendingRuntimeAdapterLaunchesForShutdown();

    // A create/launch may have been inside a per-team lock before it exposed a
    // run in provisioningRunByTeam. Wait briefly, then rescan to catch anything
    // that became visible while shutdown was already in progress.
    await this.waitForInFlightTeamOperationsForShutdown();
    await this.cancelPendingRuntimeAdapterLaunchesForShutdown();
    await this.stopTrackedTeamsForShutdown('Shutdown follow-up');

    const persistedTeamNames = this.listPersistedTeamNames();
    const tracked = new Set([...initialTracked, ...this.getShutdownTrackedTeamNames()]);
    const orphanOnly = persistedTeamNames.filter((teamName) => !tracked.has(teamName));
    if (orphanOnly.length > 0) {
      logger.info(`Cleaning up persisted teammate runtimes on shutdown: ${orphanOnly.join(', ')}`);
      for (const teamName of orphanOnly) {
        this.stopPersistentTeamMembers(teamName);
      }
    }
    this.killEmptyOrphanedClaudeSwarmTmuxServers('shutdown');
  }

  /**
   * Process a parsed stream-json message from stdout.
   * Extracts assistant text for progress reporting and detects turn completion.
   */
  private handleDeterministicBootstrapEvent(
    run: ProvisioningRun,
    msg: Record<string, unknown>
  ): boolean {
    if (msg.type !== 'system' || msg.subtype !== 'team_bootstrap') {
      return false;
    }

    const acceptance = shouldAcceptDeterministicBootstrapEvent({
      runId: run.runId,
      teamName: run.teamName,
      lastSeq: run.lastDeterministicBootstrapSeq,
      msg,
    });
    if (!acceptance.accept) {
      return true;
    }
    run.lastDeterministicBootstrapSeq = acceptance.nextSeq;

    const event = typeof msg.event === 'string' ? msg.event : undefined;
    if (!event) {
      return true;
    }

    if (event === 'started') {
      const progress = updateProgress(run, 'configuring', 'Starting deterministic team bootstrap');
      run.onProgress(progress);
      return true;
    }

    if (event === 'phase_changed') {
      const phase = typeof msg.phase === 'string' ? msg.phase : '';
      if (phase === 'loading_existing_state') {
        const progress = updateProgress(run, 'configuring', 'Loading existing team state');
        run.onProgress(progress);
      } else if (phase === 'acquiring_bootstrap_lock') {
        const progress = updateProgress(
          run,
          'configuring',
          'Acquiring deterministic bootstrap lock'
        );
        run.onProgress(progress);
      } else if (phase === 'creating_team') {
        const progress = updateProgress(run, 'assembling', 'Creating team config');
        run.onProgress(progress);
      } else if (phase === 'spawning_members') {
        const progress = updateProgress(run, 'assembling', 'Spawning teammate runtimes');
        run.onProgress(progress);
      } else if (phase === 'auditing_truth') {
        const progress = updateProgress(
          run,
          'finalizing',
          'Auditing registered teammates and bootstrap truth',
          { configReady: true }
        );
        run.onProgress(progress);
      }
      return true;
    }

    if (event === 'team_created') {
      const reused = msg.reused_existing_team === true;
      const progress = updateProgress(
        run,
        'assembling',
        reused
          ? 'Attached to existing team, starting teammates'
          : 'Team config created, starting teammates',
        { configReady: true }
      );
      run.onProgress(progress);
      return true;
    }

    if (event === 'member_spawn_started') {
      const memberName = typeof msg.member_name === 'string' ? msg.member_name.trim() : '';
      if (memberName) {
        this.setMemberSpawnStatus(run, memberName, 'spawning');
      }
      return true;
    }

    if (event === 'member_spawn_result') {
      const memberName = typeof msg.member_name === 'string' ? msg.member_name.trim() : '';
      const outcome = typeof msg.outcome === 'string' ? msg.outcome : '';
      const reason = typeof msg.reason === 'string' ? msg.reason.trim() : undefined;
      if (!memberName) {
        return true;
      }

      if (outcome === 'failed') {
        this.setMemberSpawnStatus(
          run,
          memberName,
          'error',
          reason || 'Deterministic bootstrap failed to spawn teammate.'
        );
        return true;
      }

      if (outcome === 'already_running') {
        if (run.pendingMemberRestarts.has(memberName)) {
          run.pendingMemberRestarts.delete(memberName);
          this.setMemberSpawnStatus(
            run,
            memberName,
            'error',
            buildRestartStillRunningReason(memberName)
          );
          return true;
        }
        this.agentRuntimeSnapshotCache.delete(run.teamName);
        this.liveTeamAgentRuntimeMetadataCache.delete(run.teamName);
        this.setMemberSpawnStatus(run, memberName, 'waiting');
        this.appendMemberBootstrapDiagnostic(
          run,
          memberName,
          'already_running requires strong runtime verification'
        );
        void this.reevaluateMemberLaunchStatus(run, memberName);
        return true;
      }

      this.setMemberSpawnStatus(run, memberName, 'waiting');
      return true;
    }

    if (event === 'completed') {
      const failedMembers = Array.isArray(msg.failed_members) ? msg.failed_members : [];
      for (const failed of failedMembers) {
        const memberName = typeof failed?.name === 'string' ? failed.name.trim() : '';
        const reason = typeof failed?.reason === 'string' ? failed.reason.trim() : undefined;
        if (memberName) {
          this.setMemberSpawnStatus(
            run,
            memberName,
            'error',
            reason || 'Deterministic bootstrap failed to spawn teammate.'
          );
        }
      }
      if (!run.provisioningComplete && !run.cancelRequested) {
        void this.handleProvisioningTurnComplete(run).catch((error: unknown) => {
          logger.error(
            `[${run.teamName}] deterministic bootstrap completion handler failed: ${
              error instanceof Error ? error.message : String(error)
            }`
          );
        });
      }
      return true;
    }

    if (event === 'failed') {
      if (run.progress.state === 'failed' || run.cancelRequested) {
        return true;
      }
      const reason =
        typeof msg.reason === 'string' && msg.reason.trim().length > 0
          ? msg.reason.trim()
          : 'Deterministic bootstrap failed.';
      if (isMemberBriefingUnavailableFallbackSignal(reason.toLowerCase())) {
        const progress = updateProgress(run, 'finalizing', '成员简报不可用，已改用内置上下文继续', {
          warnings: mergeProvisioningWarnings(
            run.progress.warnings,
            '成员无法调用 member_briefing，已使用启动上下文继续；负责人会在需要时接管通知。'
          ),
          cliLogsTail: extractCliLogsFromRun(run),
        });
        run.onProgress(progress);
        return true;
      }
      const classification = classifyDeterministicBootstrapFailure(reason);
      const progress = updateProgress(run, 'failed', classification.title, {
        error: classification.normalizedReason,
        cliLogsTail: extractCliLogsFromRun(run),
      });
      run.onProgress(progress);
      run.processKilled = true;
      killTeamProcess(run.child);
      this.cleanupRun(run);
      return true;
    }

    return true;
  }

  private handleStreamJsonMessage(run: ProvisioningRun, msg: Record<string, unknown>): void {
    // stream-json output has various message types:
    // {"type":"assistant","content":[{"type":"text","text":"..."},...]}
    // {"type":"result","subtype":"success",...}
    // Capture session_id as early as possible so live messages emitted during this
    // handler already carry the session identity used by merge/dedup paths.
    if (!run.detectedSessionId) {
      const sid = typeof msg.session_id === 'string' ? msg.session_id : undefined;
      if (sid && sid.trim().length > 0) {
        run.detectedSessionId = sid.trim();
        logger.info(
          `[${run.teamName}] Detected session ID from stream-json: ${run.detectedSessionId}`
        );
      }
    }

    if (msg.type === 'user') {
      // Check for permission_request in raw user message text BEFORE teammate-message parsing.
      // The permission_request may arrive as plain JSON without <teammate-message> wrapper,
      // and handleNativeTeammateUserMessage only processes <teammate-message> blocks.
      const rawUserText = this.extractStreamUserText(msg);
      const content = this.extractStreamContentBlocks(msg);
      if (rawUserText) {
        const perm = parsePermissionRequest(rawUserText);
        if (perm) {
          logger.warn(
            `[${run.teamName}] [PERM-TRACE] Intercepted permission_request from stdout user message: agent=${perm.agentId} tool=${perm.toolName} requestId=${perm.requestId}`
          );
          this.handleTeammatePermissionRequest(run, perm, new Date().toISOString());
        } else if (rawUserText.includes('permission_request')) {
          // Log near-miss: text contains "permission_request" but wasn't parsed
          logger.warn(
            `[${run.teamName}] [PERM-TRACE] stdout user message contains "permission_request" but parsePermissionRequest returned null. Text preview: ${rawUserText.slice(0, 300)}`
          );
        }
      }
      for (const block of content) {
        if (block?.type !== 'tool_result' || typeof block.tool_use_id !== 'string') continue;
        this.finishRuntimeToolActivity(
          run,
          block.tool_use_id,
          block.content,
          block.is_error === true
        );
      }
      this.handleNativeTeammateUserMessage(run, msg);
      return;
    }
    if (msg.type === 'assistant') {
      const content = this.extractStreamContentBlocks(msg);

      const hasCapturedVisibleSendMessage = this.hasCapturedVisibleSendMessage(
        content,
        run.teamName
      );

      const textParts = content
        .filter((part) => part.type === 'text' && typeof part.text === 'string')
        .map((part) => part.text as string);
      let assistantIsRateLimitApiError = false;
      if (textParts.length > 0) {
        const text = textParts.join('\n');
        const messageTimestamp =
          typeof msg.timestamp === 'string' &&
          msg.timestamp.trim().length > 0 &&
          Number.isFinite(Date.parse(msg.timestamp))
            ? msg.timestamp
            : undefined;
        // Auth failures sometimes show up as assistant text (e.g. "401", "Please run /login")
        // rather than stderr or a result.subtype=error. Detect early to avoid false "ready".
        this.handleAuthFailureInOutput(run, text, 'assistant');
        assistantIsRateLimitApiError = this.isRateLimitApiError(text);
        if (this.hasApiError(text) && !this.isAuthFailureWarning(text, 'assistant')) {
          if (assistantIsRateLimitApiError && !run.provisioningComplete) {
            this.teamSendBlockReasonByTeam.set(
              run.teamName,
              '负责人当前处于请求限流状态。请稍后重试，或先停止部分团队/成员。'
            );
          }
          if (!run.provisioningComplete) {
            this.failProvisioningWithApiError(run, text);
          } else {
            if (run.leadRelayCapture) {
              run.leadRelayCapture.rejectOnce(text);
            }
            this.resetRuntimeToolActivity(run, this.getRunLeadName(run));
            this.setLeadActivity(run, 'idle');
            this.teamSendBlockReasonByTeam.delete(run.teamName);
          }
          return;
        }
        logger.debug(`[${run.teamName}] assistant: ${text.slice(0, 200)}`);
        // During provisioning (before provisioningComplete), accumulate for live UI preview.
        // Emission is handled by the throttled emitLogsProgress() in the stdout data handler.
        if (!run.provisioningComplete) {
          this.appendProvisioningAssistantText(run, msg, text);
        }

        // Once relay capture is settled, later assistant chunks belong to the normal live
        // message flow. Keeping them in the capture branch would drop them on the floor
        // until relayLeadInboxMessages() finally clears run.leadRelayCapture.
        if (run.leadRelayCapture && !run.leadRelayCapture.settled) {
          const capture = run.leadRelayCapture;
          capture.textParts.push(text);
          if (capture.idleHandle) {
            clearTimeout(capture.idleHandle);
          }
          capture.idleHandle = setTimeout(() => {
            const combined = capture.textParts.join('\n').trim();
            capture.resolveOnce(combined);
          }, capture.idleMs);
        } else if (run.provisioningComplete) {
          // Push each assistant text block as a separate live message (per-message pattern).
          // When the same assistant message includes SendMessage, skip narration because
          // captureSendMessages() handles the visible outbound message separately.
          if (
            !run.silentUserDmForward &&
            !run.suppressPostCompactReminderOutput &&
            !run.suppressGeminiPostLaunchHydrationOutput &&
            !hasCapturedVisibleSendMessage
          ) {
            const cleanText = stripAgentBlocks(text).trim();
            if (cleanText.length > 0) {
              this.pushLiveLeadTextMessage(
                run,
                cleanText,
                this.getStableLeadThoughtMessageId(msg) ?? undefined,
                messageTimestamp
              );
            }
          }
        } else {
          // Pre-ready: keep showing provisioning narration in the banner, but also mirror it
          // into the live cache so Messages/Activity can show the earliest assistant output.
          if (!run.silentUserDmForward && !hasCapturedVisibleSendMessage) {
            const cleanText = stripAgentBlocks(text).trim();
            if (cleanText.length > 0) {
              this.pushLiveLeadTextMessage(
                run,
                cleanText,
                this.getStableLeadThoughtMessageId(msg) ?? undefined,
                messageTimestamp
              );
            }
          }
        }
      }

      // Accumulate tool_use details from tool-only messages (text + tool_use are separate in stream-json).
      // These details will be attached to the next text message as toolCalls/toolSummary.
      // Works in both pre-ready and post-ready phases so early live messages get tool metadata.
      for (const block of content) {
        if (
          block?.type === 'tool_use' &&
          typeof block.name === 'string' &&
          block.name !== 'SendMessage'
        ) {
          const input = (block.input ?? {}) as Record<string, unknown>;
          run.pendingToolCalls.push({
            name: block.name,
            preview: extractToolPreview(block.name, input),
            toolUseId: typeof block.id === 'string' ? block.id : undefined,
          });
          this.startRuntimeToolActivity(run, this.getRunLeadName(run), block);
        }
      }

      // Track member spawn events from Task tool_use blocks with team_name.
      // When the lead calls Task(team_name=X, name=Y), it means member Y is being spawned.
      this.captureTeamSpawnEvents(run, content);

      // Capture SendMessage tool_use blocks from assistant output.
      // Works in both pre-ready and post-ready phases so outbound runtime messages
      // are visible in our team message artifacts even if Claude's own routing drifts.
      if (!run.silentUserDmForward || run.silentUserDmForward.mode === 'member_inbox_relay') {
        this.captureSendMessages(run, content);
      }

      // Extract context window usage from message.usage for real-time tracking.
      // SDKAssistantMessage wraps BetaMessage which contains usage stats.
      const messageObj = (msg.message ?? msg) as Record<string, unknown>;
      if (messageObj && typeof messageObj === 'object') {
        const msgId = typeof messageObj.id === 'string' ? messageObj.id : null;
        const usage = messageObj.usage as Record<string, unknown> | undefined;
        if (usage && typeof usage === 'object') {
          // Dedup: skip if same message.id (SDK bug: multi-block = same usage repeated)
          if (!msgId || run.leadContextUsage?.lastUsageMessageId !== msgId) {
            this.updateLeadContextUsageFromUsage(
              run,
              usage,
              typeof messageObj.model === 'string' ? messageObj.model : undefined
            );
            if (run.leadContextUsage) {
              run.leadContextUsage.lastUsageMessageId = msgId;
            }
            this.emitLeadContextUsage(run);
          }
        }
      }
    }

    if (this.handleDeterministicBootstrapEvent(run, msg)) {
      return;
    }

    // Handle control_request — tool approval protocol (only when --dangerously-skip-permissions is NOT set)
    if (msg.type === 'control_request') {
      this.handleControlRequest(run, msg);
      return;
    }

    if (msg.type === 'result') {
      const subtype =
        typeof msg.subtype === 'string'
          ? msg.subtype
          : (() => {
              const result = msg.result;
              if (!result || typeof result !== 'object') return undefined;
              const inner = (result as Record<string, unknown>).subtype;
              return typeof inner === 'string' ? inner : undefined;
            })();
      if (subtype === 'success') {
        logger.info(`[${run.teamName}] stream-json result: success — turn complete, process alive`);

        // Extract contextWindow from modelUsage if available (SDKResultSuccess.modelUsage)
        const modelUsageObj = (msg.modelUsage ??
          (msg.result as Record<string, unknown> | undefined)?.modelUsage) as
          | Record<string, Record<string, unknown>>
          | undefined;
        if (modelUsageObj && typeof modelUsageObj === 'object') {
          for (const modelData of Object.values(modelUsageObj)) {
            if (
              modelData &&
              typeof modelData === 'object' &&
              typeof modelData.contextWindow === 'number' &&
              modelData.contextWindow > 0
            ) {
              if (!run.leadContextUsage) {
                run.leadContextUsage = {
                  promptInputTokens: null,
                  outputTokens: null,
                  contextUsedTokens: null,
                  contextWindowTokens: modelData.contextWindow,
                  promptInputSource: 'unavailable',
                  lastUsageMessageId: null,
                  lastEmittedAt: 0,
                };
              } else {
                run.leadContextUsage.contextWindowTokens = modelData.contextWindow;
                run.leadContextUsage.lastEmittedAt = 0; // force re-emit
              }
              this.emitLeadContextUsage(run);
              break;
            }
          }
        }

        // Extract usage from result message itself (final turn usage)
        const resultUsage = (msg.usage ??
          (msg.result as Record<string, unknown> | undefined)?.usage) as
          | Record<string, unknown>
          | undefined;
        if (resultUsage && typeof resultUsage === 'object') {
          this.updateLeadContextUsageFromUsage(
            run,
            resultUsage,
            typeof (msg.result as Record<string, unknown> | undefined)?.model === 'string'
              ? ((msg.result as Record<string, unknown>).model as string)
              : undefined
          );
          if (run.leadContextUsage) {
            run.leadContextUsage.lastEmittedAt = 0;
          }
          this.emitLeadContextUsage(run);
        }

        if (run.provisioningComplete) {
          // If this was a post-compact reminder turn completing, clear in-flight and suppress flags.
          // Preserve pendingPostCompactReminder if re-armed by a compact_boundary during this turn.
          if (run.postCompactReminderInFlight) {
            const hadPendingRearm = run.pendingPostCompactReminder;
            run.postCompactReminderInFlight = false;
            run.suppressPostCompactReminderOutput = false;
            logger.info(
              `[${run.teamName}] post-compact reminder turn completed${
                hadPendingRearm ? ' (follow-up reminder pending from re-compact)' : ''
              }`
            );
          }
          if (run.geminiPostLaunchHydrationInFlight) {
            run.geminiPostLaunchHydrationInFlight = false;
            run.suppressGeminiPostLaunchHydrationOutput = false;
            logger.info(`[${run.teamName}] Gemini post-launch hydration turn completed`);
          }

          this.resetRuntimeToolActivity(run, this.getRunLeadName(run));
          this.setLeadActivity(run, 'idle');
          this.teamSendBlockReasonByTeam.delete(run.teamName);
        }
        if (run.pendingDirectCrossTeamSendRefresh) {
          run.pendingDirectCrossTeamSendRefresh = false;
          this.teamChangeEmitter?.({
            type: 'inbox',
            teamName: run.teamName,
            detail: 'sentMessages.json',
          });
        }
        if (run.leadRelayCapture) {
          const capture = run.leadRelayCapture;
          const combined = capture.textParts.join('\n').trim();
          capture.resolveOnce(combined);
        }
        // Clear silent relay flag after any successful turn.
        run.activeCrossTeamReplyHints = [];
        run.pendingInboxRelayCandidates = [];
        run.silentUserDmForward = null;
        if (run.silentUserDmForwardClearHandle) {
          clearTimeout(run.silentUserDmForwardClearHandle);
          run.silentUserDmForwardClearHandle = null;
        }

        // Deferred post-compact context reinjection: inject durable rules on first idle after compact.
        // Placed AFTER leadRelayCapture/silentUserDmForward cleanup so a previously-deferred
        // reminder can proceed now that the blocking conditions are cleared.
        if (
          run.provisioningComplete &&
          run.pendingPostCompactReminder &&
          !run.postCompactReminderInFlight
        ) {
          void this.injectPostCompactReminder(run);
        }
        if (
          run.provisioningComplete &&
          run.pendingGeminiPostLaunchHydration &&
          !run.geminiPostLaunchHydrationInFlight
        ) {
          void this.injectGeminiPostLaunchHydration(run);
        }

        if (!run.provisioningComplete && !run.cancelRequested) {
          void this.handleProvisioningTurnComplete(run).catch((err: unknown) => {
            logger.error(
              `[${run.teamName}] handleProvisioningTurnComplete threw unexpectedly: ${
                err instanceof Error ? err.message : String(err)
              }`
            );
          });
        }
      } else if (subtype === 'error') {
        const errorMsg =
          typeof msg.error === 'string' ? msg.error : JSON.stringify(msg.error ?? 'unknown');
        logger.warn(`[${run.teamName}] stream-json result: error — ${errorMsg}`);
        if (run.leadRelayCapture) {
          run.leadRelayCapture.rejectOnce(errorMsg);
        }
        // Clear silent relay flag after any errored turn.
        run.pendingDirectCrossTeamSendRefresh = false;
        run.activeCrossTeamReplyHints = [];
        run.pendingInboxRelayCandidates = [];
        run.silentUserDmForward = null;
        if (run.silentUserDmForwardClearHandle) {
          clearTimeout(run.silentUserDmForwardClearHandle);
          run.silentUserDmForwardClearHandle = null;
        }
        if (!run.provisioningComplete && !run.cancelRequested) {
          const progress = updateProgress(
            run,
            'failed',
            'CLI reported an error during provisioning',
            {
              error: errorMsg,
              cliLogsTail: extractCliLogsFromRun(run),
            }
          );
          run.onProgress(progress);
          // Kill the process on provisioning error
          run.processKilled = true;
          killTeamProcess(run.child);
          this.cleanupRun(run);
        } else if (run.provisioningComplete) {
          // Post-provisioning error: process alive, waiting for input.
          // Always clear all post-compact reminder state on error — prevents a stale pending
          // reminder from firing on the next unrelated successful turn.
          if (run.pendingPostCompactReminder || run.postCompactReminderInFlight) {
            const wasInFlight = run.postCompactReminderInFlight;
            clearPostCompactReminderState(run);
            logger.warn(
              `[${run.teamName}] post-compact reminder ${wasInFlight ? 'turn errored' : 'pending dropped'} — clearing (strict policy)`
            );
          }
          if (run.pendingGeminiPostLaunchHydration || run.geminiPostLaunchHydrationInFlight) {
            const wasInFlight = run.geminiPostLaunchHydrationInFlight;
            clearGeminiPostLaunchHydrationState(run);
            logger.warn(
              `[${run.teamName}] Gemini post-launch hydration ${
                wasInFlight ? 'turn errored' : 'pending dropped'
              } — clearing (strict policy)`
            );
          }
          this.resetRuntimeToolActivity(run, this.getRunLeadName(run));
          this.setLeadActivity(run, 'idle');
          this.teamSendBlockReasonByTeam.delete(run.teamName);
        }
      }
    }

    // Handle compact_boundary — context was compacted, next assistant message will carry fresh usage
    if (msg.type === 'system') {
      const sub = typeof msg.subtype === 'string' ? msg.subtype : undefined;
      if (sub === 'api_error') {
        const isRateLimited = this.isRateLimitSystemApiErrorPayload(msg);
        if (isRateLimited) {
          const retryAttempt = typeof msg.retryAttempt === 'number' ? msg.retryAttempt : undefined;
          const maxRetries = typeof msg.maxRetries === 'number' ? msg.maxRetries : undefined;
          const retryInMs = typeof msg.retryInMs === 'number' ? msg.retryInMs : undefined;
          const retryLabel = retryAttempt && maxRetries ? ` ${retryAttempt}/${maxRetries}` : '';
          const delayLabel = retryInMs ? `，约 ${Math.round(retryInMs / 1000)} 秒后重试` : '';
          const message = `请求限流${retryLabel}${delayLabel}`;

          if (!run.provisioningComplete) {
            this.teamSendBlockReasonByTeam.set(
              run.teamName,
              '负责人当前处于请求限流状态。请稍后重试，或先停止部分团队/成员。'
            );
          }

          if (
            !run.provisioningComplete &&
            !run.cancelRequested &&
            run.progress.state !== 'failed'
          ) {
            const warningText = `**请求限流${retryLabel}**\n\nAnthropic 返回 429/1302，Claude 正在自动重试${delayLabel ? `（${delayLabel.replace(/^，/, '')}）` : '。'}`;
            if (run.apiRetryWarningIndex != null) {
              run.provisioningOutputParts[run.apiRetryWarningIndex] = warningText;
            } else {
              run.apiRetryWarningIndex = run.provisioningOutputParts.length;
              run.provisioningOutputParts.push(warningText);
            }
            run.lastRetryAt = Date.now();
            run.progress = {
              ...run.progress,
              updatedAt: nowIso(),
              message,
              messageSeverity: 'error' as const,
              assistantOutput:
                buildProgressAssistantOutput(run.provisioningOutputParts) ??
                run.progress.assistantOutput,
            };
            run.onProgress(run.progress);
          }
        }
      } else if (sub === 'compact_boundary') {
        if (run.leadContextUsage) {
          run.leadContextUsage.lastUsageMessageId = null;
        }

        // Extract compact metadata for the system message
        const meta = msg.compact_metadata as Record<string, unknown> | undefined;
        const trigger = typeof meta?.trigger === 'string' ? meta.trigger : 'auto';
        const preTokens = typeof meta?.pre_tokens === 'number' ? meta.pre_tokens : null;
        const tokenInfo = preTokens ? ` (was ~${(preTokens / 1000).toFixed(0)}k tokens)` : '';

        const compactMsg: InboxMessage = {
          from: 'system',
          text: `Context compacted${tokenInfo}, trigger: ${trigger}`,
          timestamp: nowIso(),
          read: true,
          summary: `Context compacted (${trigger})`,
          messageId: `compact-${run.runId}-${Date.now()}`,
          source: 'lead_process',
        };
        this.pushLiveLeadProcessMessage(run.teamName, compactMsg);
        this.teamChangeEmitter?.({
          type: 'inbox',
          teamName: run.teamName,
          detail: 'compact_boundary',
        });
        logger.info(
          `[${run.teamName}] compact_boundary — context will refresh on next turn${tokenInfo}`
        );

        // Schedule post-compact context reinjection on next idle.
        // If a reminder is already in-flight, re-arm pending so a follow-up fires after it completes.
        // This handles the case where the reminder prompt itself triggers another compaction.
        if (run.provisioningComplete && !run.pendingPostCompactReminder) {
          run.pendingPostCompactReminder = true;
          logger.info(
            `[${run.teamName}] post-compact reminder scheduled for next idle${
              run.postCompactReminderInFlight ? ' (re-armed during in-flight reminder)' : ''
            }`
          );
        }
      }

      // Show API retry attempts in Live output so the user knows what's happening
      if (sub === 'api_retry') {
        const attempt = typeof msg.attempt === 'number' ? msg.attempt : '?';
        const maxRetries = typeof msg.max_retries === 'number' ? msg.max_retries : '?';
        const errorStatus = typeof msg.error_status === 'number' ? msg.error_status : undefined;
        const errorCode = typeof msg.error === 'string' ? msg.error : undefined;
        const errorLabel = errorCode ? errorCode.replace(/_/g, ' ') : undefined;
        const retryDelay = typeof msg.retry_delay_ms === 'number' ? msg.retry_delay_ms : undefined;
        const rawErrorMessage =
          typeof msg.error_message === 'string' && msg.error_message.trim().length > 0
            ? msg.error_message.trim()
            : undefined;
        const errorMessage = rawErrorMessage
          ? this.normalizeApiRetryErrorMessage(rawErrorMessage)
          : undefined;
        const looksLikeQuotaRetry = this.isRateLimitApiRetryPayload(msg, rawErrorMessage);

        if (looksLikeQuotaRetry && rawErrorMessage) {
          const observedAt = new Date();
          const messageTimestamp =
            typeof msg.timestamp === 'string' && Number.isFinite(Date.parse(msg.timestamp))
              ? new Date(msg.timestamp)
              : observedAt;
          peekAutoResumeService()?.handleRateLimitMessage(
            run.teamName,
            rawErrorMessage,
            observedAt,
            messageTimestamp
          );
        }

        // Use a human label for known quota/rate-limit retries instead of a misleading 500 bucket.
        const statusLabel = looksLikeQuotaRetry
          ? 'rate limited'
          : errorLabel
            ? `${errorLabel}${errorStatus ? ` (${errorStatus})` : ''}`
            : `error ${errorStatus ?? 'unknown'}`;
        const delayLabel = retryDelay ? ` — next retry in ${Math.round(retryDelay / 1000)}s` : '';
        const retryText = `API retry ${attempt}/${maxRetries}: ${statusLabel}${
          errorMessage ? ` — ${errorMessage}` : ''
        }${delayLabel}`;

        if (!run.provisioningComplete) {
          const warningText = errorMessage
            ? `**API retry ${attempt}/${maxRetries}: ${statusLabel}**\n\n\`\`\`\n${this.toMarkdownCodeSafe(
                errorMessage
              )}\n\`\`\`\n\n${retryDelay ? `Next retry in ${Math.round(retryDelay / 1000)}s.` : 'Retrying...'}`
            : `**API retry ${attempt}/${maxRetries}: ${statusLabel}**\n\n${
                retryDelay ? `Next retry in ${Math.round(retryDelay / 1000)}s.` : 'Retrying...'
              }`;
          if (run.apiRetryWarningIndex != null) {
            run.provisioningOutputParts[run.apiRetryWarningIndex] = warningText;
          } else {
            run.apiRetryWarningIndex = run.provisioningOutputParts.length;
            run.provisioningOutputParts.push(warningText);
          }
          run.lastRetryAt = Date.now();
          run.progress = {
            ...run.progress,
            updatedAt: nowIso(),
            message: retryText,
            messageSeverity: 'error' as const,
            assistantOutput:
              buildProgressAssistantOutput(run.provisioningOutputParts) ??
              run.progress.assistantOutput,
          };
          run.onProgress(run.progress);
        }
      }
    }

    // Catch-all: detect API errors in unrecognised message types.
    // Guards against future protocol additions that carry error payloads
    // (e.g. type: "error") which would otherwise be silently dropped.
    if (typeof msg.type === 'string' && !HANDLED_STREAM_JSON_TYPES.has(msg.type)) {
      const raw = JSON.stringify(msg);
      logger.warn(
        `[${run.teamName}] Unhandled stream-json type "${msg.type}": ${raw.slice(0, 300)}`
      );
      if (
        !run.provisioningComplete &&
        this.hasApiError(raw) &&
        !this.isAuthFailureWarning(raw, 'stdout')
      ) {
        this.emitApiErrorWarning(run, raw);
      }
    }
  }

  /**
   * Injects a post-compact context reminder into the lead process via stdin.
   * Reinjects durable lead rules (constraints, communication protocol, board MCP ops)
   * plus a fresh task board snapshot so the lead recovers full operational context
   * after context compaction.
   *
   * Policy: strict drop-after-attempt — one compact cycle gives at most one reminder turn.
   * If the injection fails (stdin not writable, process killed), we do not retry.
   */
  private async injectPostCompactReminder(run: ProvisioningRun): Promise<void> {
    // Consume the pending flag immediately — strict one-shot policy.
    run.pendingPostCompactReminder = false;

    // Guard: process must be alive and writable.
    if (!run.child?.stdin?.writable || run.processKilled || run.cancelRequested) {
      logger.warn(
        `[${run.teamName}] post-compact reminder skipped — process not writable or killed`
      );
      return;
    }

    // Guard: don't inject if another turn is actively processing (race with user send / inbox relay).
    if (run.leadActivityState !== 'idle') {
      logger.info(
        `[${run.teamName}] post-compact reminder deferred — lead is ${run.leadActivityState}, not idle`
      );
      // Re-arm so it triggers on next idle.
      run.pendingPostCompactReminder = true;
      return;
    }

    // Guard: don't inject while a relay capture is in-flight.
    if (run.leadRelayCapture) {
      logger.info(`[${run.teamName}] post-compact reminder deferred — relay capture in-flight`);
      run.pendingPostCompactReminder = true;
      return;
    }

    // Guard: don't inject while a silent DM forward is in progress.
    if (run.silentUserDmForward) {
      logger.info(
        `[${run.teamName}] post-compact reminder deferred — silent DM forward in progress`
      );
      run.pendingPostCompactReminder = true;
      return;
    }

    // Read current team config for up-to-date members (may have changed since launch).
    let currentMembers: TeamCreateRequest['members'] = run.request.members;
    let leadName = CANONICAL_LEAD_MEMBER_NAME;
    try {
      const config = await this.configReader.getConfig(run.teamName);
      if (config?.members) {
        const configLead = config.members.find((m) => isLeadMember(m));
        leadName = configLead?.name?.trim() || CANONICAL_LEAD_MEMBER_NAME;
        // Convert config members (excluding lead) to TeamCreateRequest member format.
        const configTeammates = config.members
          .filter((m) => !isLeadMember(m) && m?.name)
          .map((m) => ({
            name: m.name,
            role: m.role ?? undefined,
          }));
        // When config.members only has the lead (pre-created config without
        // TeamCreate), fall back to run.request.members for the teammate list.
        if (configTeammates.length > 0) {
          currentMembers = configTeammates;
        }
      } else {
        leadName =
          run.request.members.find((m) => m.role?.toLowerCase().includes('lead'))?.name ||
          CANONICAL_LEAD_MEMBER_NAME;
      }
    } catch {
      // Fallback to launch-time members if config is unavailable.
      leadName =
        run.request.members.find((m) => m.role?.toLowerCase().includes('lead'))?.name ||
        CANONICAL_LEAD_MEMBER_NAME;
      logger.warn(
        `[${run.teamName}] post-compact reminder: config unavailable, using launch-time members`
      );
    }
    const isSolo = currentMembers.length === 0;

    // Build persistent lead context.
    const feishuChannels4 = await readBoundFeishuChannels(run.teamName);
    const persistentContext = buildPersistentLeadContext({
      teamName: run.teamName,
      leadName,
      isSolo,
      members: currentMembers,
      compact: true,
      feishuChannels: feishuChannels4,
    });

    // Best-effort: fetch fresh task board snapshot.
    let taskBoardBlock = '';
    try {
      const taskReader = new TeamTaskReader();
      const tasks = await taskReader.getTasks(run.teamName);
      taskBoardBlock = buildTaskBoardSnapshot(tasks);
    } catch {
      // If tasks can't be read, inject without the snapshot.
      logger.warn(`[${run.teamName}] post-compact reminder: task board snapshot unavailable`);
    }

    // Re-check guards after async work.
    if (!run.child?.stdin?.writable || run.processKilled || run.cancelRequested) {
      logger.warn(
        `[${run.teamName}] post-compact reminder aborted — process state changed during preparation`
      );
      return;
    }
    if (run.leadActivityState !== 'idle') {
      logger.info(
        `[${run.teamName}] post-compact reminder deferred — lead activity changed to ${run.leadActivityState as string}`
      );
      // Re-arm so it triggers on next idle.
      run.pendingPostCompactReminder = true;
      return;
    }

    const message = [
      `Context reminder (post-compaction) — your context was compacted. Here are your standing rules and current state:`,
      ``,
      `你是团队 "${run.teamName}" 的负责人 "${leadName}"。`,
      `你正在非交互式 CLI 会话中运行。不要提问。`,
      `重要：所有步骤都必须由你按顺序直接执行。不要通过 Agent 工具把任何步骤委托给子 agent。Agent 工具唯一有效用途是启动单个成员。`,
      ``,
      persistentContext,
      taskBoardBlock.trim() ? `\n${taskBoardBlock}` : '',
      ``,
      `这只是上下文提醒。本轮不要开始新工作或执行任务。只回复一个词："OK"。`,
    ]
      .filter(Boolean)
      .join('\n');

    const payload = JSON.stringify({
      type: 'user',
      message: {
        role: 'user',
        content: [{ type: 'text', text: message }],
      },
    });

    run.postCompactReminderInFlight = true;
    run.suppressPostCompactReminderOutput = true;
    this.setLeadActivity(run, 'active');

    try {
      const stdin = run.child.stdin;
      await new Promise<void>((resolve, reject) => {
        stdin.write(payload + '\n', (err) => {
          if (err) reject(err);
          else resolve();
        });
      });
      logger.info(`[${run.teamName}] post-compact reminder injected`);
    } catch (error) {
      // Strict drop-after-attempt — do not re-arm.
      clearPostCompactReminderState(run);
      this.resetRuntimeToolActivity(run, this.getRunLeadName(run));
      this.setLeadActivity(run, 'idle');
      logger.warn(
        `[${run.teamName}] post-compact reminder injection failed: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  private async injectGeminiPostLaunchHydration(run: ProvisioningRun): Promise<void> {
    run.pendingGeminiPostLaunchHydration = false;

    if (
      run.geminiPostLaunchHydrationSent ||
      !run.child?.stdin?.writable ||
      run.processKilled ||
      run.cancelRequested
    ) {
      logger.warn(
        `[${run.teamName}] Gemini post-launch hydration skipped — process not writable, killed, or already sent`
      );
      return;
    }

    if (run.leadActivityState !== 'idle') {
      logger.info(
        `[${run.teamName}] Gemini post-launch hydration deferred — lead is ${run.leadActivityState}, not idle`
      );
      run.pendingGeminiPostLaunchHydration = true;
      return;
    }

    if (run.leadRelayCapture) {
      logger.info(
        `[${run.teamName}] Gemini post-launch hydration deferred — relay capture in-flight`
      );
      run.pendingGeminiPostLaunchHydration = true;
      return;
    }

    if (run.silentUserDmForward) {
      logger.info(
        `[${run.teamName}] Gemini post-launch hydration deferred — silent DM forward in progress`
      );
      run.pendingGeminiPostLaunchHydration = true;
      return;
    }

    let currentMembers: TeamCreateRequest['members'] = run.effectiveMembers;
    let leadName =
      run.effectiveMembers.find((m) => m.role?.toLowerCase().includes('lead'))?.name ||
      CANONICAL_LEAD_MEMBER_NAME;
    try {
      const config = await this.configReader.getConfig(run.teamName);
      if (config?.members) {
        const configLead = config.members.find((m) => isLeadMember(m));
        leadName = configLead?.name?.trim() || leadName;
        const configTeammates = config.members
          .filter((m) => !isLeadMember(m) && m?.name)
          .map((m) => ({
            name: m.name,
            role: m.role ?? undefined,
          }));
        if (configTeammates.length > 0) {
          const launchMembersByName = new Map(
            run.effectiveMembers.map((member) => [member.name, member] as const)
          );
          currentMembers = configTeammates.map((member) => ({
            ...launchMembersByName.get(member.name),
            ...member,
          }));
        }
      }
    } catch {
      logger.warn(
        `[${run.teamName}] Gemini post-launch hydration: config unavailable, using launch-time members`
      );
    }

    let tasks: TeamTask[] = [];
    try {
      tasks = await new TeamTaskReader().getTasks(run.teamName);
    } catch {
      logger.warn(
        `[${run.teamName}] Gemini post-launch hydration: task board snapshot unavailable`
      );
    }

    if (
      run.geminiPostLaunchHydrationSent ||
      !run.child?.stdin?.writable ||
      run.processKilled ||
      run.cancelRequested
    ) {
      logger.warn(
        `[${run.teamName}] Gemini post-launch hydration aborted — process state changed during preparation`
      );
      return;
    }
    if (run.leadActivityState !== 'idle') {
      logger.info(
        `[${run.teamName}] Gemini post-launch hydration deferred — lead activity changed to ${run.leadActivityState as string}`
      );
      run.pendingGeminiPostLaunchHydration = true;
      return;
    }

    const feishuChannels3 = await readBoundFeishuChannels(run.teamName);
    const message = buildGeminiPostLaunchHydrationPrompt(
      run,
      leadName,
      currentMembers,
      tasks,
      feishuChannels3
    );
    const promptSize = getPromptSizeSummary(message);
    logger.info(
      `[${run.teamName}] Gemini post-launch hydration prepared (${promptSize.chars} chars / ${promptSize.lines} lines)`
    );

    const payload = JSON.stringify({
      type: 'user',
      message: {
        role: 'user',
        content: [{ type: 'text', text: message }],
      },
    });

    run.geminiPostLaunchHydrationInFlight = true;
    run.geminiPostLaunchHydrationSent = true;
    run.suppressGeminiPostLaunchHydrationOutput = true;
    this.setLeadActivity(run, 'active');

    try {
      const stdin = run.child.stdin;
      await new Promise<void>((resolve, reject) => {
        stdin.write(payload + '\n', (err) => {
          if (err) reject(err);
          else resolve();
        });
      });
      logger.info(`[${run.teamName}] Gemini post-launch hydration injected`);
    } catch (error) {
      run.geminiPostLaunchHydrationInFlight = false;
      run.geminiPostLaunchHydrationSent = false;
      run.suppressGeminiPostLaunchHydrationOutput = false;
      this.resetRuntimeToolActivity(run, this.getRunLeadName(run));
      this.setLeadActivity(run, 'idle');
      logger.warn(
        `[${run.teamName}] Gemini post-launch hydration injection failed: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  /**
   * Handles a control_request message from CLI stream-json output.
   * `can_use_tool` → emits to renderer for manual approval.
   * All other subtypes (hook_callback, etc.) → auto-allowed to prevent deadlock.
   */
  private handleControlRequest(run: ProvisioningRun, msg: Record<string, unknown>): void {
    const requestId = typeof msg.request_id === 'string' ? msg.request_id : null;
    if (!requestId) {
      logger.warn(`[${run.teamName}] control_request missing request_id, ignoring`);
      return;
    }

    const request = msg.request as Record<string, unknown> | undefined;
    const subtype = request?.subtype;

    // Non-`can_use_tool` subtypes (hook_callback, etc.) are auto-allowed to prevent
    // CLI deadlock — hooks are user-configured and should not block on manual approval.
    if (subtype !== 'can_use_tool') {
      logger.debug(
        `[${run.teamName}] control_request subtype=${String(subtype)}, auto-allowing to prevent deadlock`
      );
      this.autoAllowControlRequest(run, requestId);
      return;
    }

    const toolName = typeof request?.tool_name === 'string' ? request.tool_name : 'Unknown';
    const toolInput = (request?.input ?? {}) as Record<string, unknown>;

    const approval: ToolApprovalRequest = {
      requestId,
      runId: run.runId,
      teamName: run.teamName,
      source: 'lead',
      toolName,
      toolInput,
      receivedAt: new Date().toISOString(),
      teamColor: run.request.color,
      teamDisplayName: run.request.displayName,
    };

    // Check auto-allow rules before prompting user
    const autoResult = shouldAutoAllow(
      this.getToolApprovalSettings(run.teamName),
      toolName,
      toolInput
    );
    if (autoResult.autoAllow) {
      logger.info(`[${run.teamName}] Auto-allowing ${toolName} (${autoResult.reason})`);
      this.autoAllowControlRequest(run, requestId);
      this.emitToolApprovalEvent({
        autoResolved: true,
        requestId,
        runId: run.runId,
        teamName: run.teamName,
        reason: 'auto_allow_category',
      } as ToolApprovalAutoResolved);
      return;
    }

    run.pendingApprovals.set(requestId, approval);
    this.emitToolApprovalEvent(approval);
    this.startApprovalTimeout(run, requestId);

    // Show OS notification when window is not focused
    this.maybeShowToolApprovalOsNotification(run, approval);
  }

  /**
   * Handles a teammate permission_request received via inbox message.
   * Converts it to a ToolApprovalRequest and feeds it into the existing approval flow.
   */
  private handleTeammatePermissionRequest(
    run: ProvisioningRun,
    perm: ParsedPermissionRequest,
    messageTimestamp: string
  ): void {
    // Skip if already tracked (idempotency — multiple paths can trigger this:
    // early inbox scan, stdout parsing, native message blocks, relay Category 4)
    if (run.processedPermissionRequestIds.has(perm.requestId)) return;
    if (run.pendingApprovals.has(perm.requestId)) return;
    run.processedPermissionRequestIds.add(perm.requestId);

    logger.warn(
      `[${run.teamName}] [PERM-TRACE] handleTeammatePermissionRequest: agent=${perm.agentId} tool=${perm.toolName} requestId=${perm.requestId}`
    );

    const approval: ToolApprovalRequest = {
      requestId: perm.requestId,
      runId: run.runId,
      teamName: run.teamName,
      source: perm.agentId,
      toolName: perm.toolName,
      toolInput: perm.input,
      receivedAt: messageTimestamp || new Date().toISOString(),
      teamColor: run.request.color,
      teamDisplayName: run.request.displayName,
      permissionSuggestions:
        perm.permissionSuggestions.length > 0 ? perm.permissionSuggestions : undefined,
    };

    const autoResult = shouldAutoAllow(
      this.getToolApprovalSettings(run.teamName),
      perm.toolName,
      perm.input
    );
    if (autoResult.autoAllow) {
      logger.info(
        `[${run.teamName}] Auto-allowing teammate ${perm.agentId} ${perm.toolName} (${autoResult.reason})`
      );
      void this.respondToTeammatePermission(
        run,
        perm.agentId,
        perm.requestId,
        true,
        undefined,
        perm.permissionSuggestions
      );
      this.emitToolApprovalEvent({
        autoResolved: true,
        requestId: perm.requestId,
        runId: run.runId,
        teamName: run.teamName,
        reason: 'auto_allow_category',
      } as ToolApprovalAutoResolved);
      return;
    }

    run.pendingApprovals.set(perm.requestId, approval);
    this.emitToolApprovalEvent(approval);
    this.startApprovalTimeout(run, perm.requestId);
    this.maybeShowToolApprovalOsNotification(run, approval);
  }

  /**
   * Shows a native OS notification for a pending tool approval when the app
   * is not in focus. On macOS, adds Allow/Deny action buttons that respond
   * directly from the notification without switching to the app.
   */
  private maybeShowToolApprovalOsNotification(
    run: ProvisioningRun,
    approval: ToolApprovalRequest
  ): void {
    const win = this.mainWindowRef;
    if (win && !win.isDestroyed() && win.isFocused()) return;

    const config = ConfigManager.getInstance().getConfig();
    if (!config.notifications.enabled || !config.notifications.notifyOnToolApproval) return;

    // Respect snooze — consistent with other notification types
    const snoozedUntil = config.notifications.snoozedUntil;
    if (snoozedUntil && Date.now() < snoozedUntil) return;

    const { Notification: ElectronNotification } = require('electron') as typeof import('electron');
    if (!ElectronNotification.isSupported()) return;

    const isMac = process.platform === 'darwin';
    const isLinux = process.platform === 'linux';
    const iconPath = isMac ? undefined : getAppIconPath();
    const teamLabel = run.request.displayName ?? run.teamName;
    const body = this.formatToolApprovalBody(approval.toolName, approval.toolInput);

    // Actions (Allow/Deny buttons) supported on macOS and Windows.
    // Linux libnotify doesn't fire the 'action' event — users get click-to-focus.
    const supportsActions = !isLinux;

    const notification = new ElectronNotification({
      title: `Tool Approval — ${teamLabel}`,
      body,
      sound: config.notifications.soundEnabled ? 'default' : undefined,
      ...(iconPath ? { icon: iconPath } : {}),
      ...(supportsActions
        ? {
            actions: [
              { type: 'button' as const, text: 'Allow' },
              { type: 'button' as const, text: 'Deny' },
            ],
          }
        : {}),
    });

    // Track by requestId so we can close it when approval is resolved via UI
    this.activeApprovalNotifications.set(approval.requestId, notification);
    const cleanup = (): void => {
      this.activeApprovalNotifications.delete(approval.requestId);
    };

    notification.on('click', () => {
      cleanup();
      // Use current mainWindowRef (not captured `win`) in case window was recreated
      const currentWin = this.mainWindowRef;
      if (currentWin && !currentWin.isDestroyed()) {
        currentWin.show();
        currentWin.focus();
      }
    });

    notification.on('close', cleanup);

    // Action buttons: Allow (index 0) / Deny (index 1)
    // 'action' event fires on macOS and Windows (not Linux)
    if (supportsActions) {
      notification.on('action', (_event, index) => {
        cleanup();
        const allow = index === 0;
        logger.info(
          `[${run.teamName}] Tool approval ${allow ? 'allowed' : 'denied'} via OS notification`
        );
        void this.respondToToolApproval(
          run.teamName,
          run.runId,
          approval.requestId,
          allow,
          allow ? undefined : 'Denied via notification'
        ).catch((err) => {
          logger.error(
            `[${run.teamName}] Failed to respond via notification: ${err instanceof Error ? err.message : String(err)}`
          );
        });
      });
    }

    notification.show();
  }

  /** Dismiss the OS notification for a resolved/dismissed approval. */
  dismissApprovalNotification(requestId: string): void {
    const notification = this.activeApprovalNotifications.get(requestId);
    if (notification) {
      notification.close();
      this.activeApprovalNotifications.delete(requestId);
    }
  }

  private formatToolApprovalBody(toolName: string, toolInput: Record<string, unknown>): string {
    switch (toolName) {
      case 'AskUserQuestion':
        return this.formatAskUserQuestionApprovalBody(toolInput);
      case 'Bash':
        return `Bash: ${typeof toolInput.command === 'string' ? toolInput.command.slice(0, 150) : 'command'}`;
      case 'Write':
      case 'Edit':
      case 'Read':
      case 'NotebookEdit':
        return `${toolName}: ${typeof toolInput.file_path === 'string' ? toolInput.file_path : 'file'}`;
      default:
        return `${toolName}: ${JSON.stringify(toolInput).slice(0, 150)}`;
    }
  }

  private formatAskUserQuestionApprovalBody(toolInput: Record<string, unknown>): string {
    const rawQuestions = Array.isArray(toolInput.questions) ? toolInput.questions : [];
    const questions = rawQuestions
      .map((item) => {
        if (!item || typeof item !== 'object') return null;
        const question =
          'question' in item && typeof item.question === 'string' ? item.question.trim() : null;
        return question && question.length > 0 ? question.replace(/\s+/g, ' ') : null;
      })
      .filter((question): question is string => Boolean(question));

    if (questions.length === 0) {
      return 'Question: User input is required';
    }

    const firstQuestion = questions[0];
    const truncatedQuestion =
      firstQuestion.length > 140 ? `${firstQuestion.slice(0, 137)}...` : firstQuestion;

    return questions.length === 1
      ? `Question: ${truncatedQuestion}`
      : `Questions (${questions.length}): ${truncatedQuestion}`;
  }

  /**
   * Immediately sends an "allow" control_response for a non-tool control_request.
   * Prevents CLI deadlock for hook_callback and other non-`can_use_tool` subtypes.
   */
  private autoAllowControlRequest(run: ProvisioningRun, requestId: string): void {
    if (!run.child?.stdin?.writable) {
      logger.warn(`[${run.teamName}] Cannot auto-allow control_request: stdin not writable`);
      return;
    }

    const response = {
      type: 'control_response',
      response: {
        subtype: 'success',
        request_id: requestId,
        response: { behavior: 'allow', updatedInput: {} },
      },
    };

    run.child.stdin.write(JSON.stringify(response) + '\n', (err) => {
      if (err) {
        logger.error(
          `[${run.teamName}] Failed to auto-allow control_request ${requestId}: ${err.message}`
        );
      }
    });
  }

  private tryClaimResponse(requestId: string): boolean {
    if (this.inFlightResponses.has(requestId)) return false;
    this.inFlightResponses.add(requestId);
    return true;
  }

  private startApprovalTimeout(run: ProvisioningRun, requestId: string): void {
    const { timeoutAction, timeoutSeconds } = this.getToolApprovalSettings(run.teamName);
    if (timeoutAction === 'wait') return;

    const timeoutMs = timeoutSeconds * 1000;
    const timer = setTimeout(() => {
      this.pendingTimeouts.delete(requestId);
      if (!run.pendingApprovals.has(requestId)) return;
      if (!this.tryClaimResponse(requestId)) return;

      // Read CURRENT settings (not captured closure) in case user changed action
      const currentAction = this.getToolApprovalSettings(run.teamName).timeoutAction;
      if (currentAction === 'wait') {
        // Settings changed to 'wait' but timer fired before reEvaluatePendingApprovals cleared it
        this.inFlightResponses.delete(requestId);
        return;
      }
      const allow = currentAction === 'allow';
      logger.info(`[${run.teamName}] Timeout ${allow ? 'allowing' : 'denying'} ${requestId}`);

      const approval = run.pendingApprovals.get(requestId);
      if (approval && approval.source !== 'lead') {
        // Teammate request — apply permission_suggestions to project settings.
        this.respondToTeammatePermission(
          run,
          approval.source,
          requestId,
          allow,
          allow ? undefined : 'Timed out — auto-denied by settings',
          approval.permissionSuggestions
        ).finally(() => {
          run.pendingApprovals.delete(requestId);
          this.inFlightResponses.delete(requestId);
          this.dismissApprovalNotification(requestId);
          this.emitToolApprovalEvent({
            autoResolved: true,
            requestId,
            runId: run.runId,
            teamName: run.teamName,
            reason: allow ? 'timeout_allow' : 'timeout_deny',
          } as ToolApprovalAutoResolved);
        });
        return;
      }

      if (allow) {
        this.autoAllowControlRequest(run, requestId);
      } else {
        this.autoDenyControlRequest(run, requestId);
      }
      run.pendingApprovals.delete(requestId);
      this.inFlightResponses.delete(requestId);
      this.dismissApprovalNotification(requestId);

      this.emitToolApprovalEvent({
        autoResolved: true,
        requestId,
        runId: run.runId,
        teamName: run.teamName,
        reason: allow ? 'timeout_allow' : 'timeout_deny',
      } as ToolApprovalAutoResolved);
    }, timeoutMs);

    this.pendingTimeouts.set(requestId, timer);
  }

  private clearApprovalTimeout(requestId: string): void {
    const timer = this.pendingTimeouts.get(requestId);
    if (timer) {
      clearTimeout(timer);
      this.pendingTimeouts.delete(requestId);
    }
  }

  private autoDenyControlRequest(run: ProvisioningRun, requestId: string): void {
    if (!run.child?.stdin?.writable) {
      logger.warn(`[${run.teamName}] Cannot auto-deny control_request: stdin not writable`);
      return;
    }

    const response = {
      type: 'control_response',
      response: {
        subtype: 'success',
        request_id: requestId,
        response: { behavior: 'deny', message: 'Timed out — auto-denied by settings' },
      },
    };

    run.child.stdin.write(JSON.stringify(response) + '\n', (err) => {
      if (err) {
        logger.error(
          `[${run.teamName}] Failed to auto-deny control_request ${requestId}: ${err.message}`
        );
      }
    });
  }

  private reEvaluatePendingApprovals(): void {
    for (const [, run] of this.runs) {
      const settings = this.getToolApprovalSettings(run.teamName);
      const toRemove: string[] = [];
      for (const [requestId, approval] of run.pendingApprovals) {
        const result = shouldAutoAllow(settings, approval.toolName, approval.toolInput);
        if (result.autoAllow) {
          this.clearApprovalTimeout(requestId);
          if (!this.tryClaimResponse(requestId)) continue;
          if (approval.source !== 'lead') {
            void this.respondToTeammatePermission(
              run,
              approval.source,
              requestId,
              true,
              undefined,
              approval.permissionSuggestions
            );
          } else {
            this.autoAllowControlRequest(run, requestId);
          }
          this.dismissApprovalNotification(requestId);
          toRemove.push(requestId);
          this.emitToolApprovalEvent({
            autoResolved: true,
            requestId,
            runId: run.runId,
            teamName: run.teamName,
            reason: 'auto_allow_category',
          } as ToolApprovalAutoResolved);
        } else if (settings.timeoutAction !== 'wait' && !this.pendingTimeouts.has(requestId)) {
          // Settings changed from 'wait' to allow/deny — start timer for already pending items
          this.startApprovalTimeout(run, requestId);
        } else if (settings.timeoutAction === 'wait' && this.pendingTimeouts.has(requestId)) {
          // Settings changed TO 'wait' — clear existing timers
          this.clearApprovalTimeout(requestId);
        }
      }
      for (const requestId of toRemove) {
        run.pendingApprovals.delete(requestId);
        this.inFlightResponses.delete(requestId);
      }
    }
  }

  /**
   * Respond to a pending tool approval — sends control_response to CLI stdin.
   * Validates runId match and requestId existence before writing.
   */
  async respondToToolApproval(
    teamName: string,
    runId: string,
    requestId: string,
    allow: boolean,
    message?: string
  ): Promise<void> {
    // Look in both provisioning and alive runs — control_requests arrive during provisioning too
    const currentRunId = this.getTrackedRunId(teamName);
    if (!currentRunId) throw new Error(`No active process for team "${teamName}"`);
    const run = this.runs.get(currentRunId);
    if (!run) throw new Error(`Run not found for team "${teamName}"`);

    if (run.runId !== runId) {
      throw new Error(`Stale approval: runId mismatch (expected ${run.runId}, got ${runId})`);
    }

    // Clear timeout and claim response FIRST (before pendingApprovals check)
    // to handle the race where timeout already responded and deleted the approval
    this.clearApprovalTimeout(requestId);
    if (!this.tryClaimResponse(requestId)) {
      // Timeout already responded — silently exit, UI cleanup via autoResolved event
      run.pendingApprovals.delete(requestId);
      return;
    }

    if (!run.pendingApprovals.has(requestId)) {
      // Approval was removed (e.g. by reEvaluatePendingApprovals) — clean up claim and exit
      this.inFlightResponses.delete(requestId);
      return;
    }

    const approval = run.pendingApprovals.get(requestId)!;

    // Teammate permission requests: apply permission_suggestions to project settings
    if (approval.source !== 'lead') {
      try {
        await this.respondToTeammatePermission(
          run,
          approval.source,
          requestId,
          allow,
          message,
          approval.permissionSuggestions
        );
      } finally {
        run.pendingApprovals.delete(requestId);
        this.inFlightResponses.delete(requestId);
        this.dismissApprovalNotification(requestId);
      }
      return;
    }

    if (!run.child?.stdin?.writable) {
      throw new Error(`Team "${teamName}" process stdin is not writable`);
    }

    // IMPORTANT: request_id is NESTED inside response, NOT top-level
    // (asymmetry with control_request — confirmed by Python SDK, Elixir SDK and issue #29991)
    const allowResponse: Record<string, unknown> = { behavior: 'allow', updatedInput: {} };
    // For AskUserQuestion: pass user's answers via updatedInput so the CLI
    // can deliver them without re-prompting. Format follows --permission-prompt-tool spec.
    if (allow && message) {
      const pending = run.pendingApprovals.get(requestId);
      if (pending?.toolName === 'AskUserQuestion') {
        try {
          const answers = JSON.parse(message) as Record<string, string>;
          allowResponse.updatedInput = { ...pending.toolInput, answers };
        } catch {
          // If message isn't JSON, use as-is for the first question
          const questions = (pending.toolInput.questions as { question?: string }[]) ?? [];
          const answers: Record<string, string> = {};
          if (questions[0]?.question) answers[questions[0].question] = message;
          allowResponse.updatedInput = { ...pending.toolInput, answers };
        }
      }
    }
    const response = allow
      ? {
          type: 'control_response',
          response: {
            subtype: 'success',
            request_id: requestId,
            response: allowResponse,
          },
        }
      : {
          type: 'control_response',
          response: {
            subtype: 'success',
            request_id: requestId,
            response: { behavior: 'deny', message: message ?? 'User denied' },
          },
        };

    const stdin = run.child.stdin;
    const responseJson = JSON.stringify(response) + '\n';
    logger.info(
      `[${teamName}] Writing control_response for ${requestId}: ${allow ? 'allow' : 'deny'}`
    );
    try {
      await new Promise<void>((resolve, reject) => {
        // Safety timeout — if stdin.write callback is never called (e.g. process died
        // between the writable check and the write), reject instead of hanging forever.
        const writeTimeout = setTimeout(() => {
          reject(new Error(`Timeout writing control_response to stdin (process may have exited)`));
        }, 5000);

        stdin.write(responseJson, (err) => {
          clearTimeout(writeTimeout);
          if (err) {
            logger.error(`[${teamName}] Failed to write control_response: ${err.message}`);
            reject(err);
          } else {
            logger.info(`[${teamName}] control_response written successfully for ${requestId}`);
            resolve();
          }
        });
      });
    } finally {
      run.pendingApprovals.delete(requestId);
      this.inFlightResponses.delete(requestId);
      this.dismissApprovalNotification(requestId);
    }
  }

  /**
   * Respond to a teammate's permission_request by applying permission_suggestions.
   *
   * FACT: Claude Code teammate runtime sends permission_request via SendMessage (inbox protocol).
   * FACT: Writing permission_response to teammate inbox does NOT work - runtime ignores it.
   * FACT: control_response via stdin does NOT work for teammate requests - request_id doesn't match.
   * FACT: permission_suggestions.destination "localSettings" refers to {cwd}/.claude/settings.local.json.
   * FACT: Claude Code CLI reads this file via --setting-sources user,project,local.
   *
   * When allow=true: applies permission_suggestions (adds tool rules to project settings).
   * When allow=false: no action needed - tool stays blocked by default.
   */
  private async respondToTeammatePermission(
    run: ProvisioningRun,
    agentId: string,
    requestId: string,
    allow: boolean,
    _message?: string,
    permissionSuggestions?: import('@shared/utils/inboxNoise').PermissionSuggestion[]
  ): Promise<void> {
    if (!allow) {
      logger.info(`[${run.teamName}] Denied teammate ${agentId} permission ${requestId}`);
      return;
    }

    // Apply permission_suggestions: add tool rules to project settings file
    const suggestions = permissionSuggestions ?? [];
    if (suggestions.length === 0) {
      logger.warn(`[${run.teamName}] No permission_suggestions for ${requestId} — cannot add rule`);
      return;
    }

    // Resolve project cwd from team config
    let projectCwd: string | undefined;
    try {
      const config = await this.configReader.getConfig(run.teamName);
      projectCwd = config?.projectPath ?? config?.members?.[0]?.cwd;
    } catch {
      // best-effort
    }
    if (!projectCwd) {
      logger.warn(`[${run.teamName}] Cannot resolve project cwd for permission rule — skipping`);
      return;
    }

    for (const suggestion of suggestions) {
      // Handle "setMode" suggestions (e.g. Write/Edit tools suggest acceptEdits mode)
      // FACT: Write/Edit permission_requests have permission_suggestions:
      //   { type: "setMode", mode: "acceptEdits", destination: "session" }
      // Since we can't change session mode of a subprocess, we translate to addRules.
      if (suggestion.type === 'setMode') {
        const mode = typeof suggestion.mode === 'string' ? suggestion.mode : '';
        let toolNames: string[] = [];
        if (mode === 'acceptEdits') {
          toolNames = ['Edit', 'Write', 'NotebookEdit'];
        } else if (mode === 'bypassPermissions') {
          // Broad approval — add common tools
          toolNames = ['Edit', 'Write', 'NotebookEdit', 'Bash', 'Read', 'Grep', 'Glob'];
        }
        if (toolNames.length > 0) {
          const settingsPath = path.join(projectCwd, '.claude', 'settings.local.json');
          try {
            await this.addPermissionRulesToSettings(settingsPath, toolNames, 'allow');
            logger.info(
              `[${run.teamName}] Applied setMode "${mode}" for ${agentId}: ${toolNames.join(', ')} in ${settingsPath}`
            );
          } catch (error) {
            logger.error(
              `[${run.teamName}] Failed to apply setMode: ${
                error instanceof Error ? error.message : String(error)
              }`
            );
          }
        }
        continue;
      }

      if (suggestion.type !== 'addRules' || !Array.isArray(suggestion.rules)) continue;

      let toolNames = suggestion.rules
        .map((r) => r.toolName)
        .filter((name): name is string => typeof name === 'string' && name.length > 0);
      if (toolNames.length === 0) continue;

      // Expand teammate-safe operational tools only.
      // This removes the bootstrap/task workflow race without accidentally granting
      // admin/runtime tools like team_stop or kanban_clear.
      if (
        toolNames.some((name) =>
          AGENT_TEAMS_NAMESPACED_TEAMMATE_OPERATIONAL_TOOL_NAMES.includes(name)
        )
      ) {
        const merged = new Set([
          ...toolNames,
          ...AGENT_TEAMS_NAMESPACED_TEAMMATE_OPERATIONAL_TOOL_NAMES,
        ]);
        toolNames = Array.from(merged);
      }

      const behavior = suggestion.behavior ?? 'allow';
      // FACT: observed destinations are "localSettings" (project-level .claude/settings.local.json)
      const settingsPath =
        suggestion.destination === 'localSettings'
          ? path.join(projectCwd, '.claude', 'settings.local.json')
          : path.join(projectCwd, '.claude', 'settings.local.json'); // default to local

      try {
        await this.addPermissionRulesToSettings(settingsPath, toolNames, behavior);
        logger.info(
          `[${run.teamName}] Added permission rules for ${agentId}: ${toolNames.join(', ')} → ${behavior} in ${settingsPath}`
        );
      } catch (error) {
        logger.error(
          `[${run.teamName}] Failed to add permission rules: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }
    }

    // Also attempt control_response via stdin — the lead runtime MAY forward it
    // to the teammate subprocess. This was broken before (missing updatedInput: {})
    // but is now fixed. Belt-and-suspenders: settings handle future calls,
    // control_response may unblock the CURRENT waiting prompt.
    if (allow && run.child?.stdin?.writable) {
      const controlResponse = {
        type: 'control_response',
        response: {
          subtype: 'success',
          request_id: requestId,
          response: { behavior: 'allow', updatedInput: {} },
        },
      };
      run.child.stdin.write(JSON.stringify(controlResponse) + '\n', (err) => {
        if (err) {
          logger.warn(
            `[${run.teamName}] control_response via stdin for teammate ${agentId} failed (non-critical): ${err.message}`
          );
        }
      });
    }
  }

  /**
   * Safely add tool names to the permissions.allow (or deny) array in a Claude settings file.
   * Creates the file and parent directories if they don't exist.
   * Merges with existing entries — never overwrites.
   */
  private async addPermissionRulesToSettings(
    settingsPath: string,
    toolNames: string[],
    behavior: string
  ): Promise<number> {
    const dir = path.dirname(settingsPath);
    await fs.promises.mkdir(dir, { recursive: true });

    // Read existing settings (or start with empty object)
    let settings: Record<string, unknown> = {};
    try {
      const raw = await fs.promises.readFile(settingsPath, 'utf-8');
      const parsed = JSON.parse(raw) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        settings = parsed as Record<string, unknown>;
      }
    } catch {
      // File doesn't exist or invalid JSON — start fresh
    }

    // Ensure permissions object exists
    if (!settings.permissions || typeof settings.permissions !== 'object') {
      settings.permissions = {};
    }
    const perms = settings.permissions as Record<string, unknown>;

    // Target array: "allow" or "deny" based on behavior
    const key = behavior === 'deny' ? 'deny' : 'allow';
    if (!Array.isArray(perms[key])) {
      perms[key] = [];
    }
    const list = perms[key] as string[];

    // Add tool names that aren't already in the list
    const existing = new Set(list);
    let added = 0;
    for (const name of toolNames) {
      if (!existing.has(name)) {
        list.push(name);
        added++;
      }
    }

    if (added === 0) return 0; // Nothing new to add

    await atomicWriteAsync(settingsPath, JSON.stringify(settings, null, 2) + '\n');
    return added;
  }

  private async seedLeadBootstrapPermissionRules(
    teamName: string,
    projectCwd: string
  ): Promise<void> {
    const settingsPath = path.join(projectCwd, '.claude', 'settings.local.json');
    try {
      const allTools = [
        ...AGENT_TEAMS_NAMESPACED_LEAD_BOOTSTRAP_TOOL_NAMES,
        'Edit',
        'Write',
        'NotebookEdit',
      ];
      const added = await this.addPermissionRulesToSettings(settingsPath, allTools, 'allow');
      logger.info(
        `[${teamName}] Seeded lead bootstrap MCP rules in ${settingsPath} (${added} added)`
      );
    } catch (error) {
      logger.warn(
        `[${teamName}] Failed to seed lead bootstrap MCP rules: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  /**
   * Called when the first stream-json turn completes successfully.
   * Verifies provisioning files exist and marks as ready.
   * Process stays alive for subsequent tasks.
   */
  private async handleProvisioningTurnComplete(run: ProvisioningRun): Promise<void> {
    // Guard: must be set synchronously BEFORE any await to prevent
    // double-invocation from filesystem monitor + stream-json racing.
    if (
      run.provisioningComplete ||
      run.cancelRequested ||
      run.processKilled ||
      run.progress.state === 'failed'
    )
      return;

    // Prevent false "ready" when auth failure was printed in CLI output but the filesystem monitor
    // already observed files on disk. We only re-check stderr plus a trailing non-JSON stdout
    // fragment here to avoid late false positives from assistant/result stream-json payloads.
    const preCompleteText = this.getPreCompleteCliErrorText(run);
    if (
      preCompleteText &&
      this.hasApiError(preCompleteText) &&
      !this.isAuthFailureWarning(preCompleteText, 'pre-complete') &&
      // Skip if we already showed a warning for this error — the SDK had a chance to retry
      // and the CLI reported success. Killing now would be a false positive.
      !run.apiErrorWarningEmitted
    ) {
      this.failProvisioningWithApiError(run, preCompleteText);
      return;
    }
    if (preCompleteText && this.isAuthFailureWarning(preCompleteText, 'pre-complete')) {
      this.handleAuthFailureInOutput(run, preCompleteText, 'pre-complete');
      return;
    }

    run.provisioningComplete = true;
    this.resetRuntimeToolActivity(run, this.getRunLeadName(run));
    this.setLeadActivity(run, 'idle');

    // Clear provisioning timeout — no longer needed
    if (run.timeoutHandle) {
      clearTimeout(run.timeoutHandle);
      run.timeoutHandle = null;
    }
    this.stopFilesystemMonitor(run);
    this.stopStallWatchdog(run);

    if (run.isLaunch) {
      await this.updateConfigPostLaunch(
        run.teamName,
        run.request.cwd,
        run.detectedSessionId,
        run.request.color,
        {
          providerId: run.request.providerId,
          model: run.request.model,
          effort: run.request.effort,
          members: run.effectiveMembers,
        }
      );
      await this.cleanupPrelaunchBackup(run.teamName);

      // Best-effort: detect CLI-suffixed member names (alice-2, bob-2) that indicate
      // a stale config.json was present during launch (double-launch race).
      try {
        const postLaunchConfigPath = path.join(getTeamsBasePath(), run.teamName, 'config.json');
        const raw = await tryReadRegularFileUtf8(postLaunchConfigPath, {
          timeoutMs: TEAM_JSON_READ_TIMEOUT_MS,
          maxBytes: TEAM_CONFIG_MAX_BYTES,
        });
        if (raw) {
          const config = JSON.parse(raw) as {
            members?: { name?: string; agentType?: string }[];
          };
          const suffixed = (config.members ?? []).filter(
            (m) => typeof m.name === 'string' && /-\d+$/.test(m.name) && !isLeadMember(m)
          );
          if (suffixed.length > 0) {
            logger.warn(
              `[${run.teamName}] Post-launch: detected suffixed members: ` +
                `${suffixed.map((m) => m.name).join(', ')}. ` +
                'This usually means the team was launched with stale config.json.'
            );
          }
        }
      } catch {
        /* best-effort */
      }

      // Audit: flag any expected member not registered in config.json after launch.
      await this.refreshMemberSpawnStatusesFromLeadInbox(run);
      await this.maybeAuditMemberSpawnStatuses(run, { force: true });
      await this.finalizeMissingRegisteredMembersAsFailed(run);
      const persistedLaunchSnapshot = await this.launchMixedSecondaryLaneIfNeeded(run);
      const failedSpawnMembers = persistedLaunchSnapshot
        ? persistedLaunchSnapshot.expectedMembers
            .filter(
              (memberName) =>
                persistedLaunchSnapshot.members[memberName]?.launchState === 'failed_to_start'
            )
            .map((memberName) => ({
              name: memberName,
              error: persistedLaunchSnapshot.members[memberName]?.hardFailureReason,
              updatedAt: persistedLaunchSnapshot.members[memberName]?.lastEvaluatedAt ?? nowIso(),
            }))
        : this.getFailedSpawnMembers(run);
      const launchSummary = persistedLaunchSnapshot?.summary ?? this.getMemberLaunchSummary(run);
      const hasSpawnFailures = failedSpawnMembers.length > 0;
      const hasPendingBootstrap =
        !hasSpawnFailures &&
        this.hasPendingLaunchMembers(run, launchSummary, persistedLaunchSnapshot);
      const readyMessage = hasSpawnFailures
        ? `Launch completed with teammate errors — ${failedSpawnMembers
            .map((member) => member.name)
            .join(', ')} 启动失败`
        : hasPendingBootstrap
          ? this.buildAggregatePendingLaunchMessage(
              'Launch completed',
              run,
              launchSummary,
              persistedLaunchSnapshot
            )
          : 'Team launched — process alive and ready';
      const progress = updateProgress(run, 'ready', readyMessage, {
        cliLogsTail: extractCliLogsFromRun(run),
        messageSeverity: hasSpawnFailures || hasPendingBootstrap ? 'warning' : undefined,
      });
      run.onProgress(progress);
      this.provisioningRunByTeam.delete(run.teamName);
      this.aliveRunByTeam.set(run.teamName, run.runId);
      this.teamSendBlockReasonByTeam.delete(run.teamName);
      logger.info(`[${run.teamName}] Launch complete. Process alive for subsequent tasks.`);

      if (!run.deterministicBootstrap && shouldUseGeminiStagedLaunch(run.request.providerId)) {
        run.pendingGeminiPostLaunchHydration = true;
      }

      // Force a post-ready detail refresh so Messages reload persisted lead_session
      // texts from JSONL even if the last visible assistant output only reached disk.
      this.teamChangeEmitter?.({
        type: 'lead-message',
        teamName: run.teamName,
        runId: run.runId,
        detail: 'lead-session-sync',
      });

      if (!hasSpawnFailures && !hasPendingBootstrap) {
        // Fire "Team Launched" notification only for clean launches.
        void this.fireTeamLaunchedNotification(run);
      }

      if (hasSpawnFailures) {
        const failureNotice = [
          `系统提醒：部分团队成员未启动。`,
          `未启动的成员：${failedSpawnMembers.map((member) => `@${member.name}`).join(', ')}。`,
          `在这些成员被重新成功启动前，不要把他们视为可用成员。`,
        ].join(' ');
        await this.sendMessageToRun(run, failureNotice).catch((error: unknown) =>
          logger.warn(
            `[${run.teamName}] failed to send teammate-start failure notice to lead: ${
              error instanceof Error ? error.message : String(error)
            }`
          )
        );
      }

      // Pick up any direct messages that arrived before/while reconnecting.
      void this.relayLeadInboxMessages(run.teamName).catch((e: unknown) =>
        logger.warn(`[${run.teamName}] post-reconnect relay failed: ${String(e)}`)
      );

      // Solo teams have no teammate processes to resume work; kick off task execution
      // as a separate turn AFTER the launch is marked ready so the UI doesn't mix
      // long-running task output into the "Launching team" live output stream.
      if (
        run.request.members.length === 0 &&
        !shouldUseGeminiStagedLaunch(run.request.providerId)
      ) {
        void (async () => {
          try {
            const taskReader = new TeamTaskReader();
            const tasks = await taskReader.getTasks(run.teamName);
            const active = tasks.filter(
              (t) =>
                (t.status === 'pending' || t.status === 'in_progress') &&
                !t.id.startsWith('_internal')
            );
            if (active.length === 0) return;

            const board = buildTaskBoardSnapshot(tasks);
            const message = [
              `Reconnected and ready. Begin executing tasks now.`,
              `Execute tasks sequentially and keep the board + user updated:`,
              `- Identify the next READY task (pending, not blocked by incomplete dependencies).`,
              `- If the task is unassigned, set yourself as owner.`,
              `- BEFORE doing any work on a task: mark it started (in_progress).`,
              `- Immediately SendMessage "user" that you started task #<id> (what you're doing + next step).`,
              `- While working: after each meaningful milestone/decision/blocker, add a task comment on #<id>. If user-relevant, also SendMessage "user".`,
              `- 完成时：先添加最终任务评论，包含完整结果（发现、报告、分析、代码变更总结或任何交付物），然后标记任务 completed，再 SendMessage "user" 简短总结结果（2-4 句）并写明 "Full details in task comment <first-8-chars-of-commentId>"。任务评论是主要交付渠道，用户会在任务看板阅读结果。`,
              `- 当前任务完成前不要开始下一个任务（默认一次只有一个任务 in_progress）。`,
              board.trim(),
            ]
              .filter(Boolean)
              .join('\n\n');

            await this.sendMessageToRun(run, message);
          } catch (error) {
            logger.warn(
              `[${run.teamName}] Failed to kick off solo task resumption: ${
                error instanceof Error ? error.message : String(error)
              }`
            );
          }
        })();
      }
      if (
        run.pendingGeminiPostLaunchHydration &&
        !run.geminiPostLaunchHydrationInFlight &&
        !run.cancelRequested
      ) {
        void this.injectGeminiPostLaunchHydration(run);
      }
      return;
    }

    // Quick verification: config should exist by now
    const configProbe = await this.waitForValidConfig(run, 5000);
    if (!configProbe.ok) {
      logger.warn(
        `[${run.teamName}] Provisioning turn completed but no config.json found — marking ready anyway`
      );
    }

    if (configProbe.ok && configProbe.location === 'default') {
      const configuredTeamsBasePath = getTeamsBasePath();
      const progress = updateProgress(run, 'failed', 'Provisioning failed validation', {
        error:
          `TeamCreate produced config.json under a different Claude root (${configProbe.configPath}). ` +
          `This app is configured to read teams from ${configuredTeamsBasePath}. ` +
          'Align the app Claude root setting with the CLI, then retry.',
        cliLogsTail: extractCliLogsFromRun(run),
      });
      run.onProgress(progress);
      run.processKilled = true;
      killTeamProcess(run.child);
      this.cleanupRun(run);
      return;
    }

    // Persist teammates metadata separately from config.json.
    await this.persistMembersMeta(run.teamName, run.request);
    await this.updateConfigPostLaunch(
      run.teamName,
      run.request.cwd,
      run.detectedSessionId,
      run.request.color,
      {
        providerId: run.request.providerId,
        model: run.request.model,
        effort: run.request.effort,
        members: run.effectiveMembers,
      }
    );

    // Audit: flag any expected member not registered in config.json after provisioning.
    await this.refreshMemberSpawnStatusesFromLeadInbox(run);
    await this.maybeAuditMemberSpawnStatuses(run, { force: true });
    await this.finalizeMissingRegisteredMembersAsFailed(run);
    const persistedLaunchSnapshot = await this.launchMixedSecondaryLaneIfNeeded(run);
    const failedSpawnMembers = persistedLaunchSnapshot
      ? persistedLaunchSnapshot.expectedMembers
          .filter(
            (memberName) =>
              persistedLaunchSnapshot.members[memberName]?.launchState === 'failed_to_start'
          )
          .map((memberName) => ({
            name: memberName,
            error: persistedLaunchSnapshot.members[memberName]?.hardFailureReason,
            updatedAt: persistedLaunchSnapshot.members[memberName]?.lastEvaluatedAt ?? nowIso(),
          }))
      : this.getFailedSpawnMembers(run);
    const launchSummary = persistedLaunchSnapshot?.summary ?? this.getMemberLaunchSummary(run);
    const hasSpawnFailures = failedSpawnMembers.length > 0;
    const hasPendingBootstrap =
      !hasSpawnFailures &&
      this.hasPendingLaunchMembers(run, launchSummary, persistedLaunchSnapshot);
    const progress = updateProgress(
      run,
      'ready',
      hasSpawnFailures
        ? `Provisioning completed with teammate errors — ${failedSpawnMembers
            .map((member) => member.name)
            .join(', ')} 启动失败`
        : hasPendingBootstrap
          ? this.buildAggregatePendingLaunchMessage(
              'Team provisioned',
              run,
              launchSummary,
              persistedLaunchSnapshot
            )
          : 'Team provisioned — process alive and ready',
      {
        cliLogsTail: extractCliLogsFromRun(run),
        messageSeverity: hasSpawnFailures || hasPendingBootstrap ? 'warning' : undefined,
      }
    );
    run.onProgress(progress);
    this.provisioningRunByTeam.delete(run.teamName);
    this.aliveRunByTeam.set(run.teamName, run.runId);
    logger.info(`[${run.teamName}] Provisioning complete. Process alive for subsequent tasks.`);

    if (!run.deterministicBootstrap && shouldUseGeminiStagedLaunch(run.request.providerId)) {
      run.pendingGeminiPostLaunchHydration = true;
    }

    // Force a post-ready detail refresh so Messages reload persisted lead_session
    // texts from JSONL even if the last visible assistant output only reached disk.
    this.teamChangeEmitter?.({
      type: 'lead-message',
      teamName: run.teamName,
      runId: run.runId,
      detail: 'lead-session-sync',
    });

    if (!hasSpawnFailures && !hasPendingBootstrap) {
      // Fire "Team Launched" notification only for clean launches.
      void this.fireTeamLaunchedNotification(run);
    }

    if (hasSpawnFailures) {
      const failureNotice = [
        `系统提醒：部分团队成员未启动。`,
        `未启动的成员：${failedSpawnMembers.map((member) => `@${member.name}`).join(', ')}。`,
        `在这些成员被重新成功启动前，不要把他们视为可用成员。`,
      ].join(' ');
      await this.sendMessageToRun(run, failureNotice).catch((error: unknown) =>
        logger.warn(
          `[${run.teamName}] failed to send teammate-start failure notice to lead: ${
            error instanceof Error ? error.message : String(error)
          }`
        )
      );
    }

    // Pick up any direct messages that arrived during provisioning.
    void this.relayLeadInboxMessages(run.teamName).catch((e: unknown) =>
      logger.warn(`[${run.teamName}] post-provisioning relay failed: ${String(e)}`)
    );
    if (
      run.pendingGeminiPostLaunchHydration &&
      !run.geminiPostLaunchHydrationInFlight &&
      !run.cancelRequested
    ) {
      void this.injectGeminiPostLaunchHydration(run);
    }
  }

  // ---------------------------------------------------------------------------
  // Team Launched notification
  // ---------------------------------------------------------------------------

  /**
   * Fires a "team_launched" notification when a team transitions to ready state.
   * Uses the existing addTeamNotification() pipeline.
   */
  private async fireTeamLaunchedNotification(run: ProvisioningRun): Promise<void> {
    try {
      const config = ConfigManager.getInstance().getConfig();
      const suppressToast = !config.notifications.notifyOnTeamLaunched;
      const displayName = run.request.displayName || run.teamName;
      const body = run.isLaunch
        ? `Team "${displayName}" has been launched and is ready for tasks.`
        : `Team "${displayName}" has been provisioned and is ready for tasks.`;

      await NotificationManager.getInstance().addTeamNotification({
        teamEventType: 'team_launched',
        teamName: run.teamName,
        teamDisplayName: displayName,
        from: 'system',
        summary: run.isLaunch ? 'Team launched' : 'Team provisioned',
        body,
        dedupeKey: `team_launched:${run.teamName}:${run.runId}`,
        projectPath: run.request.cwd,
        suppressToast,
      });
    } catch (error) {
      logger.warn(
        `[${run.teamName}] Failed to fire team_launched notification: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Same-team native delivery dedup (Layer 2)
  // ---------------------------------------------------------------------------

  private collectConfirmedSameTeamPairs(
    messages: InboxMessage[],
    fingerprints: NativeSameTeamFingerprint[],
    leadName: string
  ): { confirmedMessageIds: Set<string>; matchedFingerprintIds: Set<string> } {
    const confirmedMessageIds = new Set<string>();
    const matchedFingerprintIds = new Set<string>();

    if (fingerprints.length === 0) {
      return { confirmedMessageIds, matchedFingerprintIds };
    }

    // Build group key: from + normalizedText (summary checked during pairing, not grouping)
    const groupKey = (from: string, text: string) => `${from}\0${text}`;

    // Group fingerprints by (from, text), sorted FIFO by seenAt within each group
    const fpByGroup = new Map<string, NativeSameTeamFingerprint[]>();
    for (const fp of fingerprints) {
      const key = groupKey(fp.from, fp.text);
      let group = fpByGroup.get(key);
      if (!group) {
        group = [];
        fpByGroup.set(key, group);
      }
      group.push(fp);
    }
    for (const group of fpByGroup.values()) {
      group.sort((a, b) => a.seenAt - b.seenAt);
    }

    // Collect eligible inbox messages, grouped by (from, text), sorted FIFO by timestamp
    type EligibleMsg = InboxMessage & { messageId: string; parsedTs: number };
    const msgByGroup = new Map<string, EligibleMsg[]>();
    for (const m of messages) {
      if (m.read) continue;
      if (m.source) continue;
      if (!this.hasStableMessageId(m)) continue;
      const fromName = m.from?.trim() ?? '';
      if (!fromName || fromName === leadName || fromName === 'user') continue;
      const parsedTs = Date.parse(m.timestamp);
      if (!Number.isFinite(parsedTs)) continue;

      const key = groupKey(fromName, normalizeSameTeamText(m.text));
      let group = msgByGroup.get(key);
      if (!group) {
        group = [];
        msgByGroup.set(key, group);
      }
      group.push({ ...m, parsedTs } as EligibleMsg);
    }
    for (const group of msgByGroup.values()) {
      group.sort((a, b) => a.parsedTs - b.parsedTs);
    }

    // FIFO pair within each group: first fingerprint → first message, second → second, etc.
    // This prevents delayed native delivery from pairing with the wrong inbox row
    // when identical messages (e.g. "Done") are sent close together.
    for (const [key, fps] of fpByGroup) {
      const msgs = msgByGroup.get(key);
      if (!msgs || msgs.length === 0) continue;

      const limit = Math.min(fps.length, msgs.length);
      for (let i = 0; i < limit; i++) {
        const fp = fps[i];
        const m = msgs[i];
        // Summary validation: if both sides have summary, they must match
        if (fp.summary && m.summary?.trim() && fp.summary !== m.summary.trim()) continue;
        // Time window validation
        if (Math.abs(m.parsedTs - fp.seenAt) > TeamProvisioningService.SAME_TEAM_MATCH_WINDOW_MS) {
          continue;
        }
        confirmedMessageIds.add(m.messageId);
        matchedFingerprintIds.add(fp.id);
      }
    }

    return { confirmedMessageIds, matchedFingerprintIds };
  }

  private rememberSameTeamNativeFingerprints(
    teamName: string,
    blocks: ParsedTeammateContent[]
  ): void {
    const teamKey = teamName.trim();
    const existing = this.recentSameTeamNativeFingerprints.get(teamKey) ?? [];
    const now = Date.now();
    const cutoff = now - TeamProvisioningService.SAME_TEAM_NATIVE_FINGERPRINT_TTL_MS;
    const fresh = existing.filter((fp) => fp.seenAt > cutoff);

    for (const block of blocks) {
      fresh.push({
        id: randomUUID(),
        from: block.teammateId.trim(),
        text: normalizeSameTeamText(block.content),
        summary: (block.summary ?? '').trim(),
        seenAt: now,
      });
    }

    this.recentSameTeamNativeFingerprints.set(teamKey, fresh);
  }

  private consumeMatchedSameTeamFingerprints(teamName: string, matchedIds: Set<string>): void {
    if (matchedIds.size === 0) return;
    const current = this.recentSameTeamNativeFingerprints.get(teamName.trim()) ?? [];
    if (current.length === 0) return;
    const remaining = current.filter((fp) => !matchedIds.has(fp.id));
    if (remaining.length > 0) {
      this.recentSameTeamNativeFingerprints.set(teamName.trim(), remaining);
    } else {
      this.recentSameTeamNativeFingerprints.delete(teamName.trim());
    }
  }

  private getFreshSameTeamNativeFingerprints(teamName: string): NativeSameTeamFingerprint[] {
    const all = this.recentSameTeamNativeFingerprints.get(teamName) ?? [];
    if (all.length === 0) return [];
    const cutoff = Date.now() - TeamProvisioningService.SAME_TEAM_NATIVE_FINGERPRINT_TTL_MS;
    const fresh = all.filter((fp) => fp.seenAt > cutoff);
    if (fresh.length !== all.length) {
      if (fresh.length > 0) {
        this.recentSameTeamNativeFingerprints.set(teamName, fresh);
      } else {
        this.recentSameTeamNativeFingerprints.delete(teamName);
      }
    }
    return fresh;
  }

  private isPotentialSameTeamCliMessage(m: InboxMessage, leadName: string): boolean {
    if (m.source) return false;
    const fromName = m.from?.trim() ?? '';
    if (!fromName || fromName === leadName || fromName === 'user') return false;
    const toName = m.to?.trim();
    if (toName && toName !== leadName) return false;
    return true;
  }

  private shouldDeferSameTeamMessage(
    m: InboxMessage,
    leadName: string,
    runStartedAtMs: number
  ): boolean {
    if (!this.isPotentialSameTeamCliMessage(m, leadName)) return false;
    const messageTs = Date.parse(m.timestamp);
    if (!Number.isFinite(messageTs) || messageTs < 0) return false;
    if (
      Number.isFinite(runStartedAtMs) &&
      messageTs < runStartedAtMs - TeamProvisioningService.SAME_TEAM_RUN_START_SKEW_MS
    ) {
      return false;
    }
    const ageMs = Date.now() - messageTs;
    if (ageMs < 0) return false;
    return ageMs < TeamProvisioningService.SAME_TEAM_NATIVE_DELIVERY_GRACE_MS;
  }

  private async confirmSameTeamNativeMatches(
    teamName: string,
    leadName: string,
    messages: InboxMessage[]
  ): Promise<{ nativeMatchedMessageIds: Set<string>; persisted: boolean }> {
    const fingerprints = this.getFreshSameTeamNativeFingerprints(teamName);
    const { confirmedMessageIds, matchedFingerprintIds } = this.collectConfirmedSameTeamPairs(
      messages,
      fingerprints,
      leadName
    );

    if (confirmedMessageIds.size === 0) {
      return { nativeMatchedMessageIds: confirmedMessageIds, persisted: true };
    }

    const toMarkRead = Array.from(confirmedMessageIds, (messageId) => ({ messageId }));
    let persisted = false;
    try {
      await this.markInboxMessagesRead(teamName, leadName, toMarkRead);
      persisted = true;
    } catch {
      // keep fingerprints alive for next attempt
    }

    if (persisted) {
      // Durable: inbox says read=true. Safe to add in-memory dedup and consume fingerprints.
      const relayedIds = this.relayedLeadInboxMessageIds.get(teamName) ?? new Set<string>();
      for (const messageId of confirmedMessageIds) {
        relayedIds.add(messageId);
      }
      this.relayedLeadInboxMessageIds.set(teamName, this.trimRelayedSet(relayedIds));
      this.consumeMatchedSameTeamFingerprints(teamName, matchedFingerprintIds);
    }
    // If NOT persisted: don't add to relayedIds, don't consume fingerprints.
    // Next relay cycle will see the message in unread, re-match, and retry persist.

    return { nativeMatchedMessageIds: confirmedMessageIds, persisted };
  }

  private async reconcileSameTeamNativeDeliveries(
    teamName: string,
    leadName: string
  ): Promise<void> {
    let leadInboxMessages: Awaited<ReturnType<TeamInboxReader['getMessagesFor']>> = [];
    try {
      leadInboxMessages = await this.inboxReader.getMessagesFor(teamName, leadName);
    } catch {
      return;
    }

    const { nativeMatchedMessageIds, persisted } = await this.confirmSameTeamNativeMatches(
      teamName,
      leadName,
      leadInboxMessages
    );
    // If native was matched but persist failed, schedule a quick retry
    // so we don't wait for the 16s deferred timer to retry the disk write.
    if (nativeMatchedMessageIds.size > 0 && !persisted) {
      this.scheduleSameTeamPersistRetry(teamName);
    }
  }

  private scheduleSameTeamDeferredRetry(teamName: string): void {
    const key = `same-team-deferred:${teamName}`;
    if (this.pendingTimeouts.has(key)) return;

    const timer = setTimeout(() => {
      this.pendingTimeouts.delete(key);
      void this.relayLeadInboxMessages(teamName).catch((e: unknown) =>
        logger.warn(`[${teamName}] same-team deferred retry failed: ${String(e)}`)
      );
    }, TeamProvisioningService.SAME_TEAM_NATIVE_DELIVERY_GRACE_MS + 1_000);

    this.pendingTimeouts.set(key, timer);
  }

  /**
   * Best-effort durable follow-up after native delivery was matched but inbox read-state
   * could not be persisted. If the run dies before this retry succeeds, a later reconnect
   * may still relay the row once because in-memory dedupe is not durable.
   */
  private scheduleSameTeamPersistRetry(teamName: string): void {
    const key = `same-team-persist:${teamName}`;
    if (this.pendingTimeouts.has(key)) return;

    const timer = setTimeout(() => {
      this.pendingTimeouts.delete(key);
      void this.relayLeadInboxMessages(teamName).catch((e: unknown) =>
        logger.warn(`[${teamName}] same-team persist retry failed: ${String(e)}`)
      );
    }, TeamProvisioningService.SAME_TEAM_PERSIST_RETRY_MS);

    this.pendingTimeouts.set(key, timer);
  }

  /**
   * Remove a run from tracking maps.
   */
  private cleanupRun(run: ProvisioningRun): void {
    const currentTrackedRunId = this.getTrackedRunId(run.teamName);
    const hasNewerTrackedRun = currentTrackedRunId !== null && currentTrackedRunId !== run.runId;
    const retainedClaudeLogs = hasNewerTrackedRun ? null : buildRetainedClaudeLogsSnapshot(run);

    if (!hasNewerTrackedRun) {
      peekAutoResumeService()?.cancelPendingAutoResume(run.teamName);
    }

    if (!hasNewerTrackedRun && run.isLaunch && !run.provisioningComplete && !run.cancelRequested) {
      void this.persistLaunchStateSnapshot(run, 'finished');
    }
    this.resetRuntimeToolActivity(run);
    this.setLeadActivity(run, 'offline');
    run.pendingDirectCrossTeamSendRefresh = false;
    if (run.timeoutHandle) {
      clearTimeout(run.timeoutHandle);
      run.timeoutHandle = null;
    }
    this.stopStallWatchdog(run);
    if (run.silentUserDmForwardClearHandle) {
      clearTimeout(run.silentUserDmForwardClearHandle);
      run.silentUserDmForwardClearHandle = null;
    }
    clearPostCompactReminderState(run);
    clearGeminiPostLaunchHydrationState(run);
    this.stopFilesystemMonitor(run);
    // Remove stream listeners to prevent data handlers firing on a cleaned-up run
    if (run.child) {
      run.child.stdout?.removeAllListeners('data');
      run.child.stderr?.removeAllListeners('data');
    }
    if (this.provisioningRunByTeam.get(run.teamName) === run.runId) {
      this.provisioningRunByTeam.delete(run.teamName);
    }
    if (this.aliveRunByTeam.get(run.teamName) === run.runId) {
      this.aliveRunByTeam.delete(run.teamName);
    }
    if (!hasNewerTrackedRun) {
      this.clearSecondaryRuntimeRuns(run.teamName);
    }
    if (!hasNewerTrackedRun) {
      this.agentRuntimeSnapshotCache.delete(run.teamName);
      this.liveTeamAgentRuntimeMetadataCache.delete(run.teamName);
      this.leadInboxRelayInFlight.delete(run.teamName);
      this.relayedLeadInboxMessageIds.delete(run.teamName);
      this.inFlightLeadInboxMessageIds.delete(run.teamName);
      this.pendingCrossTeamFirstReplies.delete(run.teamName);
      this.recentCrossTeamLeadDeliveryMessageIds.delete(run.teamName);
      this.recentSameTeamNativeFingerprints.delete(run.teamName);
      this.clearSameTeamRetryTimers(run.teamName);
    }
    for (const memberName of run.memberSpawnStatuses.keys()) {
      const key = this.getMemberLaunchGraceKey(run, memberName);
      const timer = this.pendingTimeouts.get(key);
      if (timer) {
        clearTimeout(timer);
        this.pendingTimeouts.delete(key);
      }
    }
    run.activeCrossTeamReplyHints = [];
    run.pendingInboxRelayCandidates = [];
    if (!hasNewerTrackedRun) {
      for (const key of Array.from(this.memberInboxRelayInFlight.keys())) {
        if (key.startsWith(`${run.teamName}:`)) {
          this.memberInboxRelayInFlight.delete(key);
        }
      }
      for (const key of Array.from(this.openCodeMemberInboxRelayInFlight.keys())) {
        if (key.startsWith(`opencode:${run.teamName}:`)) {
          this.openCodeMemberInboxRelayInFlight.delete(key);
        }
      }
      for (const key of Array.from(this.openCodePromptDeliveryWatchdogTimers.keys())) {
        if (key.startsWith(`opencode-delivery:${run.teamName}:`)) {
          const timer = this.openCodePromptDeliveryWatchdogTimers.get(key);
          if (timer) clearTimeout(timer);
          this.openCodePromptDeliveryWatchdogTimers.delete(key);
        }
      }
      for (
        let index = this.openCodePromptDeliveryWatchdogQueue.length - 1;
        index >= 0;
        index -= 1
      ) {
        if (this.openCodePromptDeliveryWatchdogQueue[index]?.teamName === run.teamName) {
          this.openCodePromptDeliveryWatchdogQueue.splice(index, 1);
        }
      }
      for (const key of Array.from(this.relayedMemberInboxMessageIds.keys())) {
        if (key.startsWith(`${run.teamName}:`)) {
          this.relayedMemberInboxMessageIds.delete(key);
        }
      }
      this.liveLeadProcessMessages.delete(run.teamName);
    } else {
      this.pruneLiveLeadMessagesForCleanedRun(run);
    }
    // Dismiss any pending tool approvals for this run
    if (run.pendingApprovals.size > 0) {
      for (const requestId of run.pendingApprovals.keys()) {
        this.clearApprovalTimeout(requestId);
        this.inFlightResponses.delete(requestId);
        this.dismissApprovalNotification(requestId);
      }
      this.emitToolApprovalEvent({ dismissed: true, teamName: run.teamName, runId: run.runId });
      run.pendingApprovals.clear();
    }
    // Clean up the generated MCP config file (best-effort, fire-and-forget)
    if (run.mcpConfigPath) {
      void this.mcpConfigBuilder.removeConfigFile(run.mcpConfigPath);
      run.mcpConfigPath = null;
    }
    if (run.bootstrapSpecPath) {
      void removeDeterministicBootstrapSpecFile(run.bootstrapSpecPath);
      run.bootstrapSpecPath = null;
    }
    if (run.bootstrapUserPromptPath) {
      void removeDeterministicBootstrapUserPromptFile(run.bootstrapUserPromptPath);
      run.bootstrapUserPromptPath = null;
    }
    if (!hasNewerTrackedRun) {
      if (retainedClaudeLogs) {
        this.retainedClaudeLogsByTeam.set(run.teamName, retainedClaudeLogs);
      } else {
        this.retainedClaudeLogsByTeam.delete(run.teamName);
      }
    }
    // Remove from runs Map to free memory (stdoutBuffer, stderrBuffer, claudeLogLines)
    this.runs.delete(run.runId);
  }

  /**
   * Polls the filesystem to track provisioning progress in real time.
   * Emits progress updates as team files appear (config, inboxes, tasks).
   */
  private startFilesystemMonitor(run: ProvisioningRun, request: TeamCreateRequest): void {
    const configuredTeamDir = path.join(getTeamsBasePath(), run.teamName);
    const defaultTeamDir = path.join(getAutoDetectedClaudeBasePath(), 'teams', run.teamName);
    const tasksDir = path.join(getTasksBasePath(), run.teamName);

    const resolveTeamDir = async (): Promise<string | null> => {
      const configPath = path.join(configuredTeamDir, 'config.json');
      try {
        await fs.promises.access(configPath, fs.constants.F_OK);
        return configuredTeamDir;
      } catch {
        // fallback to default location
      }
      if (path.resolve(configuredTeamDir) !== path.resolve(defaultTeamDir)) {
        const defaultConfigPath = path.join(defaultTeamDir, 'config.json');
        try {
          await fs.promises.access(defaultConfigPath, fs.constants.F_OK);
          return defaultTeamDir;
        } catch {
          // not found in either location
        }
      }
      return null;
    };

    const countFiles = async (dir: string, ext: string): Promise<number> => {
      try {
        const entries = await fs.promises.readdir(dir);
        return entries.filter((e) => e.endsWith(ext) && !e.startsWith('.')).length;
      } catch {
        return 0;
      }
    };

    const poll = async (): Promise<void> => {
      if (run.cancelRequested || run.processKilled || run.progress.state === 'ready') {
        return;
      }

      try {
        if (run.fsPhase === 'waiting_config') {
          const teamDir = await resolveTeamDir();
          if (teamDir) {
            run.fsPhase = 'waiting_members';
            const progress = updateProgress(
              run,
              'assembling',
              'Team config created, waiting for members',
              { configReady: true }
            );
            run.onProgress(progress);
          }
        }

        if (run.fsPhase === 'waiting_members') {
          if (run.deterministicBootstrap) {
            const registeredNames = await this.getRegisteredTeamMemberNames(run.teamName);
            const registeredMembers = registeredNames
              ? request.members.filter((member) => registeredNames.has(member.name)).length
              : 0;

            if (registeredMembers >= request.members.length) {
              run.fsPhase = 'all_files_found';
              if (!run.provisioningComplete) {
                void this.handleProvisioningTurnComplete(run);
              }
              return;
            }
          }

          if (request.members.length === 0) {
            if (run.deterministicBootstrap) {
              run.fsPhase = 'all_files_found';
              if (!run.provisioningComplete) {
                void this.handleProvisioningTurnComplete(run);
              }
            } else {
              run.fsPhase = 'waiting_tasks';
              const progress = updateProgress(run, 'finalizing', 'Solo team, preparing workspace');
              run.onProgress(progress);
            }
          } else {
            const teamDir = (await resolveTeamDir()) ?? configuredTeamDir;
            const inboxDir = path.join(teamDir, 'inboxes');
            const inboxCount = await countFiles(inboxDir, '.json');
            if (inboxCount >= request.members.length) {
              run.fsPhase = 'waiting_tasks';
              const progress = updateProgress(
                run,
                'finalizing',
                `Prepared communication channels for all ${inboxCount} members, preparing workspace`
              );
              run.onProgress(progress);
            } else if (inboxCount > 0) {
              const progress = updateProgress(
                run,
                'assembling',
                `Prepared communication channels for ${inboxCount}/${request.members.length} members`
              );
              run.onProgress(progress);
            }
          }
        }

        if (run.fsPhase === 'waiting_tasks') {
          if (run.waitingTasksSince === null) {
            run.waitingTasksSince = Date.now();
          }
          const taskCount = await countFiles(tasksDir, '.json');
          const taskFound = taskCount > 0;
          const taskFallbackExpired =
            !taskFound && Date.now() - run.waitingTasksSince >= TASK_WAIT_FALLBACK_MS;

          if (taskFound || taskFallbackExpired) {
            run.fsPhase = 'all_files_found';
            // Mark provisioning complete early — files are on disk,
            // no need to wait for stream-json result.success.
            // The process stays alive for subsequent tasks.
            if (!run.provisioningComplete) {
              void this.handleProvisioningTurnComplete(run);
            }
          }
        }
      } catch (error) {
        logger.debug(
          `FS monitor poll error: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    };

    run.fsMonitorHandle = setInterval(() => {
      void poll();
    }, FS_MONITOR_POLL_MS);
    // Best-effort monitor; should not keep the process alive.
    run.fsMonitorHandle.unref();

    // Run first poll immediately
    void poll();
  }

  private stopFilesystemMonitor(run: ProvisioningRun): void {
    if (run.fsMonitorHandle) {
      clearInterval(run.fsMonitorHandle);
      run.fsMonitorHandle = null;
    }
  }

  private async handleProcessExit(run: ProvisioningRun, code: number | null): Promise<void> {
    if (run.finalizingByTimeout) {
      return;
    }
    if (run.progress.state === 'failed' || run.cancelRequested) {
      return;
    }
    // Skip if respawn after auth failure is in progress — the old process is being replaced
    if (run.authRetryInProgress) {
      logger.info(
        `[${run.teamName}] Process exited (code ${code ?? '?'}) during auth-failure respawn — ignoring`
      );
      return;
    }

    // IMPORTANT: stopStallWatchdog MUST be AFTER authRetryInProgress guard above!
    // During respawn, the old process exit fires but run.stallCheckHandle already
    // points to the NEW process's watchdog. Stopping it here would kill the wrong timer.
    // The authRetryInProgress guard returns early, keeping the new watchdog alive.
    this.stopStallWatchdog(run);

    // === Process exited AFTER provisioning completed ===
    // This means the team went offline (crash, kill, or natural exit).
    if (run.provisioningComplete) {
      const message =
        code === 0
          ? 'Team process exited normally'
          : `Team process exited unexpectedly (code ${code ?? 'unknown'})`;
      logger.info(`[${run.teamName}] ${message}`);
      const progress = updateProgress(run, 'disconnected', message, {
        cliLogsTail: extractCliLogsFromRun(run),
      });
      run.onProgress(progress);
      this.cleanupRun(run);
      return;
    }

    // === Process exited DURING provisioning ===
    // Try to verify if files were created before the process died.
    updateProgress(run, 'verifying', '进程已退出，正在验证团队启动结果');
    run.onProgress(run.progress);

    if (run.cancelRequested) {
      return;
    }

    const configProbe = await this.waitForValidConfig(run);
    if (run.cancelRequested) {
      return;
    }

    if (configProbe.ok && configProbe.location === 'default') {
      const configuredTeamsBasePath = getTeamsBasePath();
      const progress = updateProgress(run, 'failed', 'Provisioning failed validation', {
        error:
          `TeamCreate produced config.json under a different Claude root (${configProbe.configPath}). ` +
          `This app is configured to read teams from ${configuredTeamsBasePath}. ` +
          'Align the app Claude root setting with the CLI, then retry.',
        cliLogsTail: extractCliLogsFromRun(run),
      });
      run.onProgress(progress);
      this.cleanupRun(run);
      return;
    }

    const visibleInList =
      configProbe.ok && configProbe.location === 'configured'
        ? await this.waitForTeamInList(run.teamName, run)
        : false;
    if (run.cancelRequested) {
      return;
    }

    if (configProbe.ok && visibleInList) {
      // Files exist but process died — provisioned but not alive.
      const warnings: string[] = [
        `CLI process exited (code ${code ?? 'unknown'}) — team provisioned but not alive`,
      ];
      const missingInboxes = await this.waitForMissingInboxes(run);
      if (run.cancelRequested) {
        return;
      }
      if (missingInboxes.length > 0) {
        warnings.push('Some inboxes not created yet');
      }
      if (!run.isLaunch) {
        await this.persistMembersMeta(run.teamName, run.request);
      }
      // Mark as disconnected since the process is dead
      const progress = updateProgress(
        run,
        'disconnected',
        'Team provisioned but process is no longer alive',
        {
          warnings,
          cliLogsTail: extractCliLogsFromRun(run),
        }
      );
      run.onProgress(progress);
      this.cleanupRun(run);
      return;
    }

    if (code === 0) {
      const configuredConfigPath = path.join(getTeamsBasePath(), run.teamName, 'config.json');
      const defaultTeamsBasePath = path.join(getAutoDetectedClaudeBasePath(), 'teams');
      const defaultConfigPath = path.join(defaultTeamsBasePath, run.teamName, 'config.json');
      const combinedLogs = buildCombinedLogs(run.stdoutBuffer, run.stderrBuffer);
      const cleanupHint = logsSuggestShutdownOrCleanup(combinedLogs)
        ? ' CLI output suggests the team was shut down / cleaned up, so no persisted config was left on disk.'
        : '';

      const errorMessage = !configProbe.ok
        ? `No valid config.json found at ${configuredConfigPath}${
            path.resolve(defaultTeamsBasePath) === path.resolve(getTeamsBasePath())
              ? ''
              : ` (also checked ${defaultConfigPath})`
          } within ${Math.round(VERIFY_TIMEOUT_MS / 1000)}s.${cleanupHint}`
        : 'Team did not appear in team:list after provisioning';
      const progress = updateProgress(run, 'failed', 'Provisioning failed validation', {
        error: errorMessage,
        cliLogsTail: extractCliLogsFromRun(run),
      });
      run.onProgress(progress);
      this.cleanupRun(run);
      return;
    }

    const errorText = buildCliExitError(code, run.stdoutBuffer, run.stderrBuffer);
    const progress = updateProgress(run, 'failed', 'Claude CLI exited with an error', {
      error: errorText,
      cliLogsTail: extractCliLogsFromRun(run),
    });
    run.onProgress(progress);
    this.cleanupRun(run);
    logger.warn(`Provisioning failed for ${run.teamName}: ${progress.error ?? errorText}`);
  }

  private async waitForValidConfig(
    run: ProvisioningRun,
    timeoutMs: number = VERIFY_TIMEOUT_MS
  ): Promise<ValidConfigProbeResult> {
    const probes = run.teamsBasePathsToProbe.map((probe) => ({
      ...probe,
      configPath: path.join(probe.basePath, run.teamName, 'config.json'),
    }));
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      if (run.cancelRequested) {
        return { ok: false };
      }
      for (const probe of probes) {
        try {
          const raw = await tryReadRegularFileUtf8(probe.configPath, {
            timeoutMs: TEAM_JSON_READ_TIMEOUT_MS,
            maxBytes: TEAM_CONFIG_MAX_BYTES,
          });
          if (!raw) {
            continue;
          }
          const parsed = JSON.parse(raw) as unknown;
          if (parsed && typeof parsed === 'object') {
            const candidate = parsed as { name?: unknown };
            if (typeof candidate.name === 'string' && candidate.name.trim().length > 0) {
              return { ok: true, location: probe.location, configPath: probe.configPath };
            }
          }
        } catch {
          // Best-effort polling until deadline.
        }
      }
      await sleep(VERIFY_POLL_MS);
    }

    return { ok: false };
  }

  private async waitForTeamInList(teamName: string, run?: ProvisioningRun): Promise<boolean> {
    const deadline = Date.now() + VERIFY_TIMEOUT_MS;
    while (Date.now() < deadline) {
      if (run?.cancelRequested) {
        return false;
      }
      try {
        const teams = await this.configReader.listTeams();
        if (teams.some((team) => team.teamName === teamName)) {
          return true;
        }
      } catch {
        // Keep polling until deadline.
      }
      await sleep(VERIFY_POLL_MS);
    }
    return false;
  }

  private async waitForMissingInboxes(run: ProvisioningRun): Promise<string[]> {
    if (run.expectedMembers.length === 0) {
      return [];
    }
    const inboxDir = path.join(getTeamsBasePath(), run.teamName, 'inboxes');
    const deadline = Date.now() + VERIFY_TIMEOUT_MS;
    let missing = new Set(run.expectedMembers);

    while (Date.now() < deadline && missing.size > 0) {
      if (run.cancelRequested || run.progress.state === 'cancelled') {
        return Array.from(missing);
      }
      const nextMissing = new Set<string>();
      for (const member of missing) {
        const inboxPath = path.join(inboxDir, `${member}.json`);
        if (!(await this.pathExists(inboxPath))) {
          nextMissing.add(member);
        }
      }
      missing = nextMissing;
      if (missing.size === 0) {
        break;
      }
      await sleep(VERIFY_POLL_MS);
    }

    return Array.from(missing);
  }

  private async tryCompleteAfterTimeout(run: ProvisioningRun): Promise<boolean> {
    if (run.cancelRequested) {
      return false;
    }

    const configProbe = await this.waitForValidConfig(run);
    if (!configProbe.ok || configProbe.location !== 'configured') {
      return false;
    }

    const visibleInList = await this.waitForTeamInList(run.teamName);
    if (!visibleInList) {
      return false;
    }

    const warnings: string[] = [
      'CLI timed out after config was created — team provisioned but process killed',
    ];
    const missingInboxes = await this.waitForMissingInboxes(run);
    if (run.cancelRequested) {
      return false;
    }
    if (missingInboxes.length > 0) {
      warnings.push('Some inboxes not created yet');
    }

    if (!run.isLaunch) {
      await this.persistMembersMeta(run.teamName, run.request);
    }
    // Persist team color even on timeout path
    await this.updateConfigPostLaunch(
      run.teamName,
      run.request.cwd,
      run.detectedSessionId,
      run.request.color,
      {
        providerId: run.request.providerId,
        model: run.request.model,
        effort: run.request.effort,
        members: run.effectiveMembers,
      }
    );
    await this.refreshMemberSpawnStatusesFromLeadInbox(run);
    await this.maybeAuditMemberSpawnStatuses(run, { force: true });
    await this.finalizeMissingRegisteredMembersAsFailed(run);
    await this.persistLaunchStateSnapshot(run, 'finished');
    // Process was killed by timeout — mark as disconnected, not ready
    const progress = updateProgress(run, 'disconnected', 'Team provisioned but process timed out', {
      warnings,
    });
    run.onProgress(progress);
    this.cleanupRun(run);
    return true;
  }

  private async pathExists(filePath: string): Promise<boolean> {
    try {
      await fs.promises.access(filePath, fs.constants.F_OK);
      return true;
    } catch {
      return false;
    }
  }

  private async buildProvisioningEnv(
    providerId: TeamProviderId | undefined = 'anthropic',
    providerBackendId?: string | null
  ): Promise<ProvisioningEnvResolution> {
    const shellEnv = await resolveInteractiveShellEnv();
    // getHomeDir() uses Electron's app.getPath('home') which handles Unicode
    // correctly on Windows. Prefer it over process.env which may be garbled.
    const electronHome = getHomeDir();
    const isWindows = process.platform === 'win32';
    const home = shellEnv.HOME?.trim() || electronHome;
    let osUsername = '';
    try {
      osUsername = os.userInfo().username;
    } catch {
      // os.userInfo() can throw SystemError in restricted environments (no passwd entry, Docker, etc.)
    }
    const user =
      shellEnv.USER?.trim() ||
      process.env.USER?.trim() ||
      process.env.USERNAME?.trim() ||
      osUsername ||
      'unknown';

    // Shell: on Windows there is no SHELL env var; use COMSPEC (cmd.exe / powershell).
    // On Unix, prefer the user's login shell from env or fall back to /bin/zsh.
    const shell = isWindows
      ? (process.env.COMSPEC ?? 'powershell.exe')
      : shellEnv.SHELL?.trim() || process.env.SHELL?.trim() || '/bin/zsh';

    const env: NodeJS.ProcessEnv = {
      ...process.env,
      ...shellEnv,
      HOME: home,
      USERPROFILE: home,
      USER: user,
      LOGNAME: shellEnv.LOGNAME?.trim() || process.env.LOGNAME?.trim() || user,
      TERM: shellEnv.TERM?.trim() || process.env.TERM?.trim() || 'xterm-256color',
      // Only set CLAUDE_CONFIG_DIR when the user configured a custom path.
      // Setting it to the default ~/.claude changes the macOS Keychain namespace
      // for OAuth credential lookup, causing auth failures. (See issue #27)
      ...(getClaudeBasePath() !== getAutoDetectedClaudeBasePath()
        ? { CLAUDE_CONFIG_DIR: getClaudeBasePath() }
        : {}),
      CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: '1',
    };
    const resolvedProviderId = resolveTeamProviderId(providerId);
    const providerEnvResult = await buildProviderAwareCliEnv({
      providerId,
      providerBackendId,
      shellEnv,
      env,
    });
    const providerConnectionIssue = providerEnvResult.connectionIssues[resolvedProviderId];
    const providerEnv = providerEnvResult.env;

    const controlApiBaseUrl = await this.resolveControlApiBaseUrl();
    if (controlApiBaseUrl) {
      providerEnv.CLAUDE_TEAM_CONTROL_URL = controlApiBaseUrl;
    }

    // SHELL is a Unix concept — only set it on non-Windows platforms.
    if (!isWindows) {
      providerEnv.SHELL = shell;
    }

    // XDG directories are a freedesktop.org (Linux/macOS) convention.
    // On Windows, these are unused by most tools and can cause confusion.
    if (!isWindows) {
      const xdgConfigHome =
        shellEnv.XDG_CONFIG_HOME?.trim() ||
        process.env.XDG_CONFIG_HOME?.trim() ||
        `${home}/.config`;
      const xdgStateHome =
        shellEnv.XDG_STATE_HOME?.trim() ||
        process.env.XDG_STATE_HOME?.trim() ||
        `${home}/.local/state`;
      providerEnv.XDG_CONFIG_HOME = xdgConfigHome;
      providerEnv.XDG_STATE_HOME = xdgStateHome;
    }

    if (providerConnectionIssue) {
      return {
        env: providerEnv,
        authSource: 'configured_api_key_missing',
        geminiRuntimeAuth: null,
        providerArgs: providerEnvResult.providerArgs,
        warning: providerConnectionIssue,
      };
    }

    if (resolvedProviderId === 'codex') {
      return {
        env: providerEnv,
        authSource: 'codex_runtime',
        geminiRuntimeAuth: null,
        providerArgs: providerEnvResult.providerArgs,
      };
    }

    if (resolvedProviderId === 'gemini') {
      return {
        env: providerEnv,
        authSource: 'gemini_runtime',
        geminiRuntimeAuth: await resolveGeminiRuntimeAuth(providerEnv),
        providerArgs: providerEnvResult.providerArgs,
      };
    }

    // 1. Explicit ANTHROPIC_API_KEY — works with `-p` mode directly
    if (
      typeof providerEnv.ANTHROPIC_API_KEY === 'string' &&
      providerEnv.ANTHROPIC_API_KEY.trim().length > 0
    ) {
      return {
        env: providerEnv,
        authSource: 'anthropic_api_key',
        geminiRuntimeAuth: null,
        providerArgs: providerEnvResult.providerArgs,
      };
    }

    // 2. Proxy token (ANTHROPIC_AUTH_TOKEN) — `-p` mode does NOT read this var,
    //    so we must copy it into ANTHROPIC_API_KEY for it to work.
    if (
      typeof providerEnv.ANTHROPIC_AUTH_TOKEN === 'string' &&
      providerEnv.ANTHROPIC_AUTH_TOKEN.trim().length > 0
    ) {
      providerEnv.ANTHROPIC_API_KEY = providerEnv.ANTHROPIC_AUTH_TOKEN;
      return {
        env: providerEnv,
        authSource: 'anthropic_auth_token',
        geminiRuntimeAuth: null,
        providerArgs: providerEnvResult.providerArgs,
      };
    }

    // 3. No explicit API key — let the CLI handle its own OAuth auth.
    //    Claude CLI reads credentials from its own storage and refreshes
    //    tokens in-memory. Injecting CLAUDE_CODE_OAUTH_TOKEN from the
    //    credentials file causes 401 errors because the stored token is
    //    often stale (CLI refreshes in-memory but rarely writes back).
    return {
      env: providerEnv,
      authSource: 'none',
      geminiRuntimeAuth: null,
      providerArgs: providerEnvResult.providerArgs,
    };
  }

  private async resolveControlApiBaseUrl(): Promise<string | null> {
    if (!this.controlApiBaseUrlResolver) {
      return null;
    }

    try {
      return await this.controlApiBaseUrlResolver();
    } catch (error) {
      logger.warn(
        `Failed to resolve team control API base URL: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      return null;
    }
  }

  /**
   * Immediately update projectPath in config.json at launch start, before CLI spawn.
   * Ensures TeamDetailView shows the correct project path even if provisioning
   * is interrupted. On failure, restorePrelaunchConfig() reverts to the backup.
   */
  private async updateConfigProjectPath(teamName: string, cwd: string): Promise<void> {
    const configPath = path.join(getTeamsBasePath(), teamName, 'config.json');
    try {
      const raw = await tryReadRegularFileUtf8(configPath, {
        timeoutMs: TEAM_JSON_READ_TIMEOUT_MS,
        maxBytes: TEAM_CONFIG_MAX_BYTES,
      });
      if (!raw) {
        throw new Error('config.json unreadable');
      }
      const config = JSON.parse(raw) as Record<string, unknown>;

      config.projectPath = cwd;

      const pathHistory = Array.isArray(config.projectPathHistory)
        ? (config.projectPathHistory as string[]).filter((p) => typeof p === 'string' && p !== cwd)
        : [];
      pathHistory.push(cwd);
      config.projectPathHistory = pathHistory.slice(-500);

      await atomicWriteAsync(configPath, JSON.stringify(config, null, 2));
      logger.info(`[${teamName}] Updated config.projectPath immediately: ${cwd}`);
    } catch (error) {
      // Non-fatal: updateConfigPostLaunch will update it later if provisioning succeeds.
      logger.warn(
        `[${teamName}] Failed to update projectPath early: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  private applyEffectiveLaunchStateToConfig(
    config: Record<string, unknown>,
    launchState?: {
      providerId?: TeamProviderId;
      model?: string;
      effort?: TeamCreateRequest['effort'];
      members?: TeamCreateRequest['members'];
    }
  ): void {
    if (!launchState || !Array.isArray(config.members)) {
      return;
    }

    const effectiveLeadProviderId =
      normalizeTeamMemberProviderId(launchState.providerId) ?? 'anthropic';
    const effectiveLeadModel = launchState.model?.trim() || undefined;
    const effectiveLeadEffort = isTeamEffortLevel(launchState.effort)
      ? launchState.effort
      : undefined;

    const membersByName = new Map(
      (launchState.members ?? []).map((member) => [member.name.toLowerCase(), member] as const)
    );

    config.members = (config.members as Record<string, unknown>[]).map((member) => {
      if (!member || typeof member !== 'object') {
        return member;
      }

      const rawName = typeof member.name === 'string' ? member.name.trim() : '';
      const nextMember = { ...member };

      const assignRuntimeState = (state: {
        providerId?: TeamProviderId;
        model?: string;
        effort?: TeamCreateRequest['effort'];
      }): void => {
        const providerId = normalizeTeamMemberProviderId(state.providerId);
        if (providerId) {
          nextMember.provider = providerId;
          nextMember.providerId = providerId;
        } else {
          delete nextMember.provider;
          delete nextMember.providerId;
        }

        const model = state.model?.trim() || undefined;
        if (model) {
          nextMember.model = model;
        } else {
          delete nextMember.model;
        }

        const effort = isTeamEffortLevel(state.effort) ? state.effort : undefined;
        if (effort) {
          nextMember.effort = effort;
        } else {
          delete nextMember.effort;
        }
      };

      const lowerRawName = rawName.toLowerCase();
      if (isLeadMember(nextMember) || isLeadMemberName(lowerRawName)) {
        assignRuntimeState({
          providerId: effectiveLeadProviderId,
          model: effectiveLeadModel,
          effort: effectiveLeadEffort,
        });
        return nextMember;
      }

      const effectiveMember = membersByName.get(rawName.toLowerCase());
      if (!effectiveMember) {
        return nextMember;
      }

      assignRuntimeState({
        providerId: effectiveMember.providerId,
        model: effectiveMember.model,
        effort: effectiveMember.effort,
      });
      return nextMember;
    });
  }

  /**
   * Single atomic read-mutate-write for post-launch config updates.
   * Combines session history append and projectPath update to avoid
   * race conditions with the CLI writing to the same file.
   */
  private async updateConfigPostLaunch(
    teamName: string,
    projectPath: string,
    detectedSessionId: string | null,
    color?: string,
    launchState?: {
      providerId?: TeamProviderId;
      model?: string;
      effort?: TeamCreateRequest['effort'];
      members?: TeamCreateRequest['members'];
    }
  ): Promise<void> {
    const MAX_SESSION_HISTORY = 5000;
    const MAX_PROJECT_PATH_HISTORY = 500;
    const configPath = path.join(getTeamsBasePath(), teamName, 'config.json');
    try {
      const raw = await tryReadRegularFileUtf8(configPath, {
        timeoutMs: TEAM_JSON_READ_TIMEOUT_MS,
        maxBytes: TEAM_CONFIG_MAX_BYTES,
      });
      if (!raw) {
        throw new Error('config.json unreadable');
      }
      const config = JSON.parse(raw) as Record<string, unknown>;

      const sessionHistory = Array.isArray(config.sessionHistory)
        ? (config.sessionHistory as string[])
        : [];

      // Preserve old leadSessionId in history before overwriting
      const oldLeadSessionId = config.leadSessionId;
      if (typeof oldLeadSessionId === 'string' && oldLeadSessionId.trim().length > 0) {
        if (!sessionHistory.includes(oldLeadSessionId)) {
          sessionHistory.push(oldLeadSessionId);
        }
      }

      // Update leadSessionId to the new session detected from stream-json
      let newSessionId = detectedSessionId;

      // Fallback: if stream-json didn't provide session_id, scan project dir for newest JSONL
      if (!newSessionId && projectPath.trim()) {
        const scannedId = await this.scanForNewestSession(projectPath, sessionHistory);
        if (scannedId) {
          newSessionId = scannedId;
          logger.info(`[${teamName}] Detected new session via project dir scan: ${scannedId}`);
        }
      }

      if (newSessionId) {
        config.leadSessionId = newSessionId;
        if (!sessionHistory.includes(newSessionId)) {
          sessionHistory.push(newSessionId);
        }
        logger.info(`[${teamName}] Updated leadSessionId: ${newSessionId}`);
      }

      if (sessionHistory.length > MAX_SESSION_HISTORY) {
        config.sessionHistory = sessionHistory.slice(-MAX_SESSION_HISTORY);
      } else {
        config.sessionHistory = sessionHistory;
      }

      // Save current language setting
      const langCode = ConfigManager.getInstance().getConfig().general.agentLanguage || 'system';
      config.language = langCode;

      // Persist team color chosen by the user during creation
      if (color && color.trim().length > 0) {
        config.color = color.trim();
      }

      // Ensure projectPath
      if (projectPath.trim()) {
        config.projectPath = projectPath;
        const pathHistory = Array.isArray(config.projectPathHistory)
          ? (config.projectPathHistory as string[]).filter(
              (p) => typeof p === 'string' && p !== projectPath
            )
          : [];
        pathHistory.push(projectPath);
        config.projectPathHistory =
          pathHistory.length > MAX_PROJECT_PATH_HISTORY
            ? pathHistory.slice(-MAX_PROJECT_PATH_HISTORY)
            : pathHistory;
      }

      this.applyEffectiveLaunchStateToConfig(config, launchState);

      await atomicWriteAsync(configPath, JSON.stringify(config, null, 2));
    } catch (error) {
      logger.warn(
        `[${teamName}] Failed to update config post-launch: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  private async cleanupCliAutoSuffixedMembers(teamName: string): Promise<void> {
    const configPath = path.join(getTeamsBasePath(), teamName, 'config.json');

    const removedFromConfig: string[] = [];
    try {
      const raw = await tryReadRegularFileUtf8(configPath, {
        timeoutMs: TEAM_JSON_READ_TIMEOUT_MS,
        maxBytes: TEAM_CONFIG_MAX_BYTES,
      });
      if (raw) {
        const parsed = JSON.parse(raw) as Record<string, unknown>;
        const membersRaw = Array.isArray(parsed.members)
          ? (parsed.members as Record<string, unknown>[])
          : [];
        if (membersRaw.length > 0) {
          const teammateNames = membersRaw
            .map((m) => (typeof m.name === 'string' ? m.name.trim() : ''))
            .filter((n) => {
              const lower = n.toLowerCase();
              return n.length > 0 && !isLeadMemberName(lower) && lower !== 'user';
            });

          const keepName = createCliAutoSuffixNameGuard(teammateNames);
          const nextMembers: Record<string, unknown>[] = [];
          for (const m of membersRaw) {
            const name = typeof m.name === 'string' ? m.name.trim() : '';
            const agentType = typeof m.agentType === 'string' ? m.agentType : '';
            if (!name) continue;
            if (isLeadMember(m) || name === 'user') {
              nextMembers.push(m);
              continue;
            }
            if (!keepName(name)) {
              removedFromConfig.push(name);
              continue;
            }
            nextMembers.push(m);
          }

          if (removedFromConfig.length > 0) {
            parsed.members = nextMembers;
            await atomicWriteAsync(configPath, JSON.stringify(parsed, null, 2));
            logger.warn(
              `[${teamName}] Removed CLI auto-suffixed members from config.json: ${removedFromConfig.join(', ')}`
            );
          }
        }
      }
    } catch {
      // best-effort
    }

    let activeNamesForInboxCleanup = new Set<string>();
    try {
      const metaMembers = await this.membersMetaStore.getMembers(teamName);
      if (metaMembers.length > 0) {
        const activeNames = metaMembers
          .filter((m) => !m.removedAt)
          .map((m) => m.name.trim())
          .filter((n) => {
            const lower = n.toLowerCase();
            return n.length > 0 && !isLeadMemberName(lower) && lower !== 'user';
          });

        const keepName = createCliAutoSuffixNameGuard(activeNames);
        const removedFromMeta: string[] = [];
        const nextMeta = metaMembers.filter((m) => {
          const name = m.name?.trim() ?? '';
          if (!name) return false;
          const lower = name.toLowerCase();
          if (lower === 'user' || isLeadMember(m)) return true;
          if (!m.removedAt && !keepName(name)) {
            removedFromMeta.push(name);
            return false;
          }
          return true;
        });

        if (removedFromMeta.length > 0) {
          await this.membersMetaStore.writeMembers(teamName, nextMeta);
          logger.warn(
            `[${teamName}] Removed CLI auto-suffixed members from members.meta.json: ${removedFromMeta.join(', ')}`
          );
        }

        activeNamesForInboxCleanup = new Set(
          nextMeta
            .filter((m) => !m.removedAt)
            .map((m) => m.name.trim())
            .filter((n) => {
              const lower = n.toLowerCase();
              return n.length > 0 && !isLeadMemberName(lower) && lower !== 'user';
            })
        );
      }
    } catch {
      // best-effort
    }

    // Also attempt inbox cleanup (merge alice-2.json into alice.json).
    if (activeNamesForInboxCleanup.size > 0) {
      try {
        await this.mergeAndRemoveDuplicateInboxes(teamName, activeNamesForInboxCleanup);
      } catch {
        // best-effort
      }
    }
  }

  /**
   * Fallback: scan the project directory for the newest JSONL file
   * that isn't already in sessionHistory. Returns the session ID or null.
   */
  private async scanForNewestSession(
    projectPath: string,
    knownSessions: string[]
  ): Promise<string | null> {
    try {
      const projectId = encodePath(projectPath);
      const baseDir = extractBaseDir(projectId);
      const projectDir = path.join(getProjectsBasePath(), baseDir);
      const entries = await fs.promises.readdir(projectDir);

      const knownSet = new Set(knownSessions);
      let newest: { id: string; mtime: number } | null = null;

      for (const entry of entries) {
        if (!entry.endsWith('.jsonl')) continue;
        const sessionId = entry.replace('.jsonl', '');
        if (knownSet.has(sessionId)) continue;

        const filePath = path.join(projectDir, entry);
        const stat = await fs.promises.stat(filePath);
        if (!newest || stat.mtimeMs > newest.mtime) {
          newest = { id: sessionId, mtime: stat.mtimeMs };
        }
      }

      return newest?.id ?? null;
    } catch {
      return null;
    }
  }

  private async assertConfigLeadOnlyForLaunch(teamName: string): Promise<void> {
    const configPath = path.join(getTeamsBasePath(), teamName, 'config.json');
    const raw = await tryReadRegularFileUtf8(configPath, {
      timeoutMs: TEAM_JSON_READ_TIMEOUT_MS,
      maxBytes: TEAM_CONFIG_MAX_BYTES,
    });
    if (!raw) {
      throw new Error('config.json unreadable');
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw) as unknown;
    } catch {
      throw new Error('config.json could not be parsed');
    }
    if (!parsed || typeof parsed !== 'object') {
      throw new Error('config.json has invalid shape');
    }

    const config = parsed as Record<string, unknown>;
    const members = Array.isArray(config.members)
      ? (config.members as Record<string, unknown>[])
      : [];
    if (members.length === 0) return;

    for (const member of members) {
      const name = typeof member.name === 'string' ? member.name.trim() : '';
      if (!name) continue;
      const lower = name.toLowerCase();

      if (isLeadMember(member) || lower === 'user') continue;

      const leadAgentId = config.leadAgentId;
      if (
        typeof leadAgentId === 'string' &&
        typeof member.agentId === 'string' &&
        member.agentId === leadAgentId
      ) {
        continue;
      }

      throw new Error(
        `Refusing to launch: config.json still contains teammates (e.g. "${name}"), which can trigger CLI auto-suffixes like "${name}-2".`
      );
    }
  }

  private async normalizeTeamConfigForLaunch(teamName: string, configRaw: string): Promise<void> {
    const configPath = path.join(getTeamsBasePath(), teamName, 'config.json');
    const backupPath = `${configPath}.prelaunch.bak`;

    let parsed: unknown;
    try {
      parsed = JSON.parse(configRaw) as unknown;
    } catch {
      return;
    }
    if (!parsed || typeof parsed !== 'object') {
      return;
    }

    const config = parsed as Record<string, unknown>;
    const members = Array.isArray(config.members)
      ? (config.members as Record<string, unknown>[])
      : [];
    if (members.length === 0) {
      return;
    }

    // Keep only the lead entry.
    const leadMembers = members.filter((member) => {
      const agentType = member.agentType;
      if (typeof agentType === 'string' && isLeadAgentType(agentType)) {
        return true;
      }
      // Also check by name (CLI may set agentType to "general-purpose" for leads)
      const name = typeof member.name === 'string' ? member.name.trim().toLowerCase() : '';
      if (isLeadMemberName(name)) return true;
      const leadAgentId = config.leadAgentId;
      return (
        typeof leadAgentId === 'string' &&
        typeof member.agentId === 'string' &&
        member.agentId === leadAgentId
      );
    });

    // If already lead-only, no-op.
    if (leadMembers.length === members.length) {
      return;
    }

    // Try to determine base teammate names for inbox cleanup (prefer meta).
    const baseNames = new Set<string>();
    try {
      const metaMembers = await this.membersMetaStore.getMembers(teamName);
      for (const member of metaMembers) {
        const name = member.name.trim();
        const lower = name.toLowerCase();
        if (name.length > 0 && !member.removedAt && !isLeadMemberName(lower) && lower !== 'user') {
          baseNames.add(name);
        }
      }
    } catch {
      // ignore
    }
    if (baseNames.size === 0) {
      const allConfigNames = new Set<string>();
      for (const member of members) {
        const name = typeof member.name === 'string' ? member.name.trim() : '';
        const agentType = typeof member.agentType === 'string' ? member.agentType : '';
        if (
          name &&
          agentType &&
          !isLeadAgentType(agentType) &&
          !isLeadMemberName(name) &&
          name !== 'user'
        ) {
          allConfigNames.add(name);
        }
      }
      const allConfigNamesLower = new Set(Array.from(allConfigNames).map((n) => n.toLowerCase()));
      for (const name of allConfigNames) {
        const match = /^(.+)-(\d+)$/.exec(name);
        if (!match?.[1] || !match[2]) {
          baseNames.add(name);
          continue;
        }
        const suffix = Number(match[2]);
        // Only exclude CLI-suffixed names (alice-2) when the base name (alice) also exists
        // (and only for -2+ to avoid excluding legitimate "dev-1"-style names).
        if (!Number.isFinite(suffix) || suffix < 2) {
          baseNames.add(name);
          continue;
        }
        if (!allConfigNamesLower.has(match[1].toLowerCase())) {
          baseNames.add(name);
        }
      }
    }

    // Backup current config on disk for crash recovery / debugging.
    try {
      await atomicWriteAsync(backupPath, configRaw);
    } catch (error) {
      logger.warn(
        `[${teamName}] Failed to write config prelaunch backup: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }

    // Write normalized config atomically.
    config.members = leadMembers;
    try {
      await atomicWriteAsync(configPath, JSON.stringify(config, null, 2));
      logger.info(
        `[${teamName}] Normalized config.json for launch: kept ${leadMembers.length} lead member(s)`
      );
    } catch (error) {
      logger.warn(
        `[${teamName}] Failed to normalize config.json for launch: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      return;
    }

    // Best-effort: merge and remove suffixed inboxes like alice-2.json to avoid UI duplicates.
    await this.mergeAndRemoveDuplicateInboxes(teamName, baseNames);
  }

  /**
   * Restore config.json from prelaunch backup if launch fails after normalization.
   */
  private async restorePrelaunchConfig(teamName: string): Promise<void> {
    const configPath = path.join(getTeamsBasePath(), teamName, 'config.json');
    const backupPath = `${configPath}.prelaunch.bak`;
    try {
      const backupRaw = await tryReadRegularFileUtf8(backupPath, {
        timeoutMs: TEAM_JSON_READ_TIMEOUT_MS,
        maxBytes: TEAM_CONFIG_MAX_BYTES,
      });
      if (!backupRaw) {
        return;
      }
      await atomicWriteAsync(configPath, backupRaw);
      logger.info(`[${teamName}] Restored config.json from prelaunch backup after launch failure`);
    } catch {
      logger.debug(`[${teamName}] No prelaunch backup to restore (or read failed)`);
    }
  }

  /**
   * Remove the prelaunch backup file after a successful launch.
   */
  async cleanupPrelaunchBackup(teamName: string): Promise<void> {
    const configPath = path.join(getTeamsBasePath(), teamName, 'config.json');
    const backupPath = `${configPath}.prelaunch.bak`;
    try {
      await fs.promises.unlink(backupPath);
    } catch {
      // Backup may not exist — that's fine
    }
  }

  private async mergeAndRemoveDuplicateInboxes(
    teamName: string,
    baseNames: Set<string>
  ): Promise<void> {
    if (baseNames.size === 0) return;

    const inboxDir = path.join(getTeamsBasePath(), teamName, 'inboxes');
    let entries: string[];
    try {
      entries = await fs.promises.readdir(inboxDir);
    } catch {
      return;
    }

    const existing = new Set(entries.filter((e) => e.endsWith('.json') && !e.startsWith('.')));

    for (const baseName of baseNames) {
      const canonicalFile = `${baseName}.json`;
      if (!existing.has(canonicalFile)) {
        continue;
      }

      const duplicates = Array.from(existing)
        .filter((file) => file.startsWith(`${baseName}-`) && file.endsWith('.json'))
        .filter((file) => /-\d+\.json$/.test(file));

      if (duplicates.length === 0) {
        continue;
      }

      const canonicalPath = path.join(inboxDir, canonicalFile);
      let canonicalRaw: string;
      try {
        const raw = await tryReadRegularFileUtf8(canonicalPath, {
          timeoutMs: TEAM_JSON_READ_TIMEOUT_MS,
          maxBytes: TEAM_INBOX_MAX_BYTES,
        });
        if (!raw) {
          continue;
        }
        canonicalRaw = raw;
      } catch {
        // If cannot read, skip cleanup for this base.
        continue;
      }

      let canonicalParsed: unknown;
      try {
        canonicalParsed = JSON.parse(canonicalRaw) as unknown;
      } catch {
        canonicalParsed = [];
      }
      const canonicalList = Array.isArray(canonicalParsed) ? (canonicalParsed as unknown[]) : [];

      const merged = [...canonicalList];
      for (const dupFile of duplicates) {
        const dupPath = path.join(inboxDir, dupFile);
        let dupRaw: string;
        try {
          const raw = await tryReadRegularFileUtf8(dupPath, {
            timeoutMs: TEAM_JSON_READ_TIMEOUT_MS,
            maxBytes: TEAM_INBOX_MAX_BYTES,
          });
          if (!raw) {
            continue;
          }
          dupRaw = raw;
        } catch {
          continue;
        }

        let dupParsed: unknown;
        try {
          dupParsed = JSON.parse(dupRaw) as unknown;
        } catch {
          dupParsed = [];
        }
        if (Array.isArray(dupParsed)) {
          const dupList = dupParsed as unknown[];
          merged.push(...dupList);
        }
      }

      // Dedup by messageId when available, then sort by timestamp desc.
      const dedupById = new Map<string, unknown>();
      const noId: unknown[] = [];
      for (const item of merged) {
        if (!item || typeof item !== 'object') {
          continue;
        }
        const msg = item as { messageId?: unknown };
        if (typeof msg.messageId === 'string' && msg.messageId.trim().length > 0) {
          dedupById.set(msg.messageId, item);
        } else {
          noId.push(item);
        }
      }
      const mergedDeduped = [...Array.from(dedupById.values()), ...noId];
      mergedDeduped.sort((a, b) => {
        const at =
          a && typeof a === 'object'
            ? Date.parse((a as { timestamp?: string }).timestamp ?? '')
            : NaN;
        const bt =
          b && typeof b === 'object'
            ? Date.parse((b as { timestamp?: string }).timestamp ?? '')
            : NaN;
        const atNaN = Number.isNaN(at);
        const btNaN = Number.isNaN(bt);
        if (atNaN && btNaN) return 0;
        if (atNaN) return 1;
        if (btNaN) return -1;
        return bt - at;
      });

      try {
        await atomicWriteAsync(canonicalPath, JSON.stringify(mergedDeduped, null, 2));
      } catch {
        continue;
      }

      for (const dupFile of duplicates) {
        try {
          await fs.promises.unlink(path.join(inboxDir, dupFile));
          existing.delete(dupFile);
        } catch {
          // Best-effort cleanup.
        }
      }
    }
  }

  private async persistMembersMeta(teamName: string, request: TeamCreateRequest): Promise<void> {
    const teammateMembers = request.members.filter((member) => {
      const trimmed = member.name.trim();
      const lower = trimmed.toLowerCase();
      return trimmed.length > 0 && !isLeadMemberName(lower) && lower !== 'user';
    });
    if (teammateMembers.length === 0) {
      return;
    }

    const joinedAt = Date.now();

    try {
      const membersToWrite = this.buildMembersMetaWritePayload(
        teammateMembers.map((member) => ({
          ...member,
          joinedAt,
        }))
      );
      await this.membersMetaStore.writeMembers(teamName, membersToWrite, {
        providerBackendId: request.providerBackendId,
      });
    } catch (error) {
      logger.warn(
        `[${teamName}] Failed to persist members.meta.json: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  private async resolveLaunchExpectedMembers(
    teamName: string,
    configRaw: string,
    leadProviderId?: TeamProviderId
  ): Promise<{
    members: TeamCreateRequest['members'];
    source: 'members-meta' | 'inboxes' | 'config-fallback';
    warning?: string;
  }> {
    try {
      const metaMembers = await this.membersMetaStore.getMembers(teamName);
      const byName = new Map<string, TeamCreateRequest['members'][number]>();
      for (const member of metaMembers) {
        const rawName = member.name?.trim() ?? '';
        const lower = rawName.toLowerCase();
        if (isLeadMember(member) || lower === 'user') {
          continue;
        }
        const name = rawName;
        if (!name) continue;
        if (member.removedAt) continue;
        const role = typeof member.role === 'string' ? member.role.trim() || undefined : undefined;
        const workflow =
          typeof member.workflow === 'string' ? member.workflow.trim() || undefined : undefined;
        const isolation = member.isolation === 'worktree' ? 'worktree' : undefined;
        const providerId = normalizeOptionalTeamProviderId(member.providerId);
        const model =
          typeof member.model === 'string' ? member.model.trim() || undefined : undefined;
        const effort = isTeamEffortLevel(member.effort) ? member.effort : undefined;
        const cwd = typeof member.cwd === 'string' ? member.cwd.trim() || undefined : undefined;
        const prev = byName.get(name);
        if (!prev) {
          byName.set(name, { name, role, workflow, isolation, cwd, providerId, model, effort });
        } else {
          byName.set(name, {
            ...prev,
            role: prev.role || role,
            workflow: prev.workflow || workflow,
            isolation: prev.isolation || isolation,
            cwd: prev.cwd || cwd,
            providerId: prev.providerId || providerId,
            model: prev.model || model,
            effort: prev.effort || effort,
          });
        }
      }
      // Defense: ignore CLI auto-suffixed duplicates (alice-2) when base name exists.
      const allNames = Array.from(byName.keys());
      const keepName = createCliAutoSuffixNameGuard(allNames);
      for (const name of allNames) {
        if (!keepName(name)) {
          byName.delete(name);
        }
      }
      const members = Array.from(byName.values()).sort((a, b) => a.name.localeCompare(b.name));
      if (members.length > 0) {
        return { members, source: 'members-meta' };
      }
    } catch (error) {
      logger.warn(
        `[${teamName}] Failed to read members.meta.json: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }

    try {
      const allInboxNames = Array.from(
        new Set(
          (await this.inboxReader.listInboxNames(teamName))
            .map((name) => name.trim())
            .filter((name) => name.length > 0)
        )
      );
      const inboxNameSetLower = new Set(allInboxNames.map((n) => n.toLowerCase()));
      const inboxNames = allInboxNames
        .filter((name) => !isLeadMemberName(name) && name !== 'user')
        .filter((name) => !this.isCrossTeamPseudoRecipientName(name))
        .filter((name) => !this.isCrossTeamToolRecipientName(name))
        .filter((name) => !this.looksLikeQualifiedExternalRecipientName(name))
        .filter((name) => {
          const match = /^(.+)-(\d+)$/.exec(name);
          if (!match?.[1] || !match[2]) return true;
          const suffix = Number(match[2]);
          // Only filter CLI-suffixed names (alice-2) when the base name (alice) also exists.
          // Important: do NOT filter names like dev-1 (common intentional naming). Only consider -2+ as auto-suffix.
          if (!Number.isFinite(suffix) || suffix < 2) return true;
          return !inboxNameSetLower.has(match[1].toLowerCase());
        });
      if (inboxNames.length > 0) {
        const configMembers = this.extractTeammateSpecsFromConfig(teamName, configRaw);
        const configMembersByName = new Map(
          configMembers.map((member) => [member.name.toLowerCase(), member] as const)
        );
        const members = inboxNames.map((name) => {
          const configMember = configMembersByName.get(name.toLowerCase());
          return {
            name,
            role: configMember?.role,
            workflow: configMember?.workflow,
            isolation: configMember?.isolation,
            cwd: configMember?.cwd,
            providerId: configMember?.providerId,
            model: configMember?.model,
            effort: configMember?.effort,
          };
        });
        const memberOverridesUsed = members.some(
          (member) => member.providerId || member.model || member.effort || member.isolation
        );
        this.assertMixedLaunchFallbackSafe({
          teamName,
          leadProviderId,
          source: 'inboxes',
          members,
        });
        return {
          members,
          source: 'inboxes',
          ...(memberOverridesUsed
            ? {
                warning:
                  'Launch roster was recovered from inboxes and merged with config.json provider/model/effort overrides. ' +
                  'Multimodel reconnect is best-effort in this fallback path.',
              }
            : {}),
        };
      }
    } catch (error) {
      if (error instanceof Error && error.message.includes(getMixedLaunchFallbackRecoveryError())) {
        throw error;
      }
      logger.warn(
        `[${teamName}] Failed to read inbox member names: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }

    const configMembers = this.extractTeammateSpecsFromConfig(teamName, configRaw);
    if (configMembers.length > 0) {
      this.assertMixedLaunchFallbackSafe({
        teamName,
        leadProviderId,
        source: 'config-fallback',
        members: configMembers,
      });
      return {
        members: configMembers,
        source: 'config-fallback',
        warning:
          'members.meta.json and inboxes are empty; launch fell back to config.json members. ' +
          'Run a fresh team bootstrap to persist stable member metadata.',
      };
    }

    let configParseFailed = false;
    try {
      JSON.parse(configRaw);
    } catch {
      configParseFailed = true;
    }

    return {
      members: [],
      source: 'config-fallback',
      ...(configParseFailed
        ? {
            warning:
              'Config could not be parsed during launch roster discovery. ' +
              'Launch will continue without explicit teammate names.',
          }
        : {}),
    };
  }

  private assertMixedLaunchFallbackSafe(params: {
    teamName: string;
    leadProviderId?: TeamProviderId;
    source: 'inboxes' | 'config-fallback';
    members: TeamCreateRequest['members'];
  }): void {
    const lanePlan = this.runtimeLaneCoordinator.planProvisioningMembers({
      leadProviderId: params.leadProviderId,
      members: params.members,
      hasOpenCodeRuntimeAdapter: true,
    });
    if (this.runtimeLaneCoordinator.isMixedSideLanePlan(lanePlan)) {
      throw new Error(
        `[${params.teamName}] ${getMixedLaunchFallbackRecoveryError()} Fallback source: ${params.source}.`
      );
    }
  }

  private extractTeammateSpecsFromConfig(
    teamName: string,
    configRaw: string
  ): TeamCreateRequest['members'] {
    try {
      const parsed = JSON.parse(configRaw) as {
        members?: {
          name?: string;
          role?: string;
          workflow?: string;
          isolation?: string;
          agentType?: string;
          providerId?: string;
          provider?: string;
          model?: string;
          effort?: string;
          cwd?: string;
        }[];
      };
      if (!Array.isArray(parsed.members)) {
        return [];
      }
      const byName = new Map<string, TeamCreateRequest['members'][number]>();
      for (const member of parsed.members) {
        const rawName = typeof member?.name === 'string' ? member.name.trim() : '';
        const lower = rawName.toLowerCase();
        if (!member || isLeadMember(member) || lower === 'user') continue;
        const name = rawName;
        if (!name) continue;
        byName.set(name, {
          name,
          role: typeof member.role === 'string' ? member.role.trim() || undefined : undefined,
          workflow:
            typeof member.workflow === 'string' ? member.workflow.trim() || undefined : undefined,
          isolation: member.isolation === 'worktree' ? ('worktree' as const) : undefined,
          cwd: typeof member.cwd === 'string' ? member.cwd.trim() || undefined : undefined,
          providerId: normalizeTeamMemberProviderId(member.providerId ?? member.provider),
          model: typeof member.model === 'string' ? member.model.trim() || undefined : undefined,
          effort: isTeamEffortLevel(member.effort) ? member.effort : undefined,
        });
      }
      // Defense: ignore CLI auto-suffixed duplicates (alice-2) when base name exists.
      const allNames = Array.from(byName.keys());
      const keepName = createCliAutoSuffixNameGuard(allNames);
      for (const name of allNames) {
        if (!keepName(name)) {
          byName.delete(name);
        }
      }
      return Array.from(byName.values()).sort((a, b) => a.name.localeCompare(b.name));
    } catch {
      logger.warn(`[${teamName}] Failed to parse config.json for launch fallback members`);
      return [];
    }
  }

  /**
   * Two-stage preflight check:
   * 1. `claude --version` verifies the binary is executable.
   * 2. Runtime control-plane commands verify provider auth/team-launch readiness.
   *
   * Do not use `-p` here: full print mode can initialize MCP/plugin/LSP startup context
   * before the first response, which makes Create Team preflight slow and flaky.
   */
  private async probeClaudeRuntime(
    claudePath: string,
    cwd: string,
    env: NodeJS.ProcessEnv,
    providerId: TeamProviderId | undefined = 'anthropic',
    providerArgs: string[] = []
  ): Promise<{ warning?: string }> {
    const resolvedProviderId = resolveTeamProviderId(providerId);
    const cliCommandLabel = getConfiguredCliCommandLabel();
    if (!(await pathExistsAsDirectory(cwd))) {
      return {
        warning: `Working directory does not exist: ${cwd}`,
      };
    }

    try {
      const versionProbe = await this.spawnProbe(
        claudePath,
        ['--version'],
        cwd,
        env,
        PREFLIGHT_BINARY_TIMEOUT_MS
      );
      if (versionProbe.exitCode !== 0) {
        const errorText =
          buildCombinedLogs(versionProbe.stdout, versionProbe.stderr) ||
          `${cliCommandLabel} exited with code ${versionProbe.exitCode ?? 'unknown'} during warm-up`;
        return {
          warning: `${cliCommandLabel} binary 未能正常启动。详情：${errorText}`,
        };
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (isMissingCwdSpawnError(message) && !(await pathExistsAsDirectory(cwd))) {
        return {
          warning: `Working directory does not exist: ${cwd}`,
        };
      }
      return {
        warning: `${cliCommandLabel} binary 启动失败。详情：${message}`,
      };
    }

    if (resolvedProviderId === 'gemini') {
      const authState = await resolveGeminiRuntimeAuth(env);
      if (authState.authenticated) {
        return {};
      }
      return {
        warning:
          authState.statusMessage ??
          'Gemini provider is not configured for runtime use. Set GEMINI_API_KEY or Google ADC credentials (plus GOOGLE_CLOUD_PROJECT when needed) and retry.',
      };
    }

    if (resolvedProviderId === 'anthropic' || resolvedProviderId === 'codex') {
      return await this.probeProviderRuntimeControlPlane({
        claudePath,
        cwd,
        env,
        providerId: resolvedProviderId,
        providerArgs,
      });
    }

    return {};
  }

  private buildRuntimeProviderReadinessWarning(
    providerId: TeamProviderId,
    providerStatus: Partial<CliProviderStatus> | null | undefined
  ): string | null {
    const providerLabel = getTeamProviderLabel(providerId);
    const detail = [providerStatus?.statusMessage?.trim(), providerStatus?.detailMessage?.trim()]
      .filter((entry): entry is string => Boolean(entry))
      .join(' ');

    if (!providerStatus) {
      return `${providerLabel} provider is not configured for runtime use. Runtime status did not include this provider.`;
    }
    if (providerStatus.supported === false) {
      return `${providerLabel} provider is not configured for runtime use.${
        detail ? ` ${detail}` : ''
      }`;
    }
    if (providerStatus.authenticated === false) {
      return `${providerLabel} provider is not authenticated.${detail ? ` ${detail}` : ''}`;
    }
    if (providerStatus.capabilities?.teamLaunch === false) {
      return `${providerLabel} provider is not configured for runtime use. Team launch is unavailable.${
        detail ? ` ${detail}` : ''
      }`;
    }

    return null;
  }

  private extractAuthStatusReadiness(
    providerId: TeamProviderId,
    parsed: AuthStatusCommandResponse
  ): {
    authenticated: boolean | null;
    providerStatus: Partial<CliProviderStatus> | null;
  } {
    const providerStatus = parsed.providers?.[providerId] ?? null;
    if (typeof providerStatus?.authenticated === 'boolean') {
      return {
        authenticated: providerStatus.authenticated,
        providerStatus,
      };
    }
    if (typeof parsed.loggedIn === 'boolean') {
      return {
        authenticated: parsed.loggedIn,
        providerStatus,
      };
    }
    return {
      authenticated: null,
      providerStatus,
    };
  }

  private async probeProviderRuntimeControlPlane({
    claudePath,
    cwd,
    env,
    providerId,
    providerArgs,
  }: {
    claudePath: string;
    cwd: string;
    env: NodeJS.ProcessEnv;
    providerId: TeamProviderId;
    providerArgs: string[];
  }): Promise<{ warning?: string }> {
    const cliCommandLabel = getConfiguredCliCommandLabel();
    const providerLabel = getTeamProviderLabel(providerId);

    try {
      const runtimeStatus = await execCli(
        claudePath,
        buildProviderCliCommandArgs(providerArgs, [
          'runtime',
          'status',
          '--json',
          '--provider',
          providerId,
        ]),
        {
          cwd,
          env,
          timeout: 8_000,
        }
      );
      const parsed = extractJsonObjectFromCli<RuntimeStatusCommandResponse>(runtimeStatus.stdout);
      const providerStatus = parsed.providers?.[providerId] ?? null;
      const warning = this.buildRuntimeProviderReadinessWarning(providerId, providerStatus);
      appendPreflightDebugLog('provider_runtime_control_plane_status', {
        providerId,
        cwd,
        ready: !warning,
        authenticated: providerStatus?.authenticated,
        teamLaunch: providerStatus?.capabilities?.teamLaunch,
        oneShot: providerStatus?.capabilities?.oneShot,
        warning,
      });
      return warning ? { warning } : {};
    } catch (runtimeStatusError) {
      const runtimeStatusMessage =
        runtimeStatusError instanceof Error
          ? runtimeStatusError.message
          : String(runtimeStatusError);
      try {
        const authStatus = await execCli(
          claudePath,
          buildProviderCliCommandArgs(providerArgs, [
            'auth',
            'status',
            '--json',
            '--provider',
            providerId,
          ]),
          {
            cwd,
            env,
            timeout: 8_000,
          }
        );
        const parsed = extractJsonObjectFromCli<AuthStatusCommandResponse>(authStatus.stdout);
        const authReadiness = this.extractAuthStatusReadiness(providerId, parsed);
        const readinessWarning = authReadiness.providerStatus
          ? this.buildRuntimeProviderReadinessWarning(providerId, authReadiness.providerStatus)
          : null;
        if (authReadiness.authenticated === false || readinessWarning) {
          const authWarning =
            readinessWarning ??
            `${providerLabel} provider is not authenticated. Runtime auth status reported logged out.`;
          appendPreflightDebugLog('provider_runtime_control_plane_auth_fallback', {
            providerId,
            cwd,
            ready: false,
            runtimeStatusError: runtimeStatusMessage,
            warning: authWarning,
          });
          return { warning: authWarning };
        }
        if (authReadiness.authenticated === true) {
          const warning =
            `${cliCommandLabel} runtime status was unavailable, but auth status passed. ` +
            `Proceeding with catalog checks. Details: ${runtimeStatusMessage}`;
          appendPreflightDebugLog('provider_runtime_control_plane_auth_fallback', {
            providerId,
            cwd,
            ready: true,
            runtimeStatusError: runtimeStatusMessage,
            warning,
          });
          return { warning };
        }
      } catch (authStatusError) {
        const authStatusMessage =
          authStatusError instanceof Error ? authStatusError.message : String(authStatusError);
        appendPreflightDebugLog('provider_runtime_control_plane_auth_fallback', {
          providerId,
          cwd,
          ready: false,
          runtimeStatusError: runtimeStatusMessage,
          authStatusError: authStatusMessage,
        });
        return {
          warning:
            `${cliCommandLabel} runtime status check did not complete. ` +
            `Proceeding with catalog checks. Details: ${runtimeStatusMessage}; auth status failed: ${authStatusMessage}`,
        };
      }

      return {
        warning:
          `${cliCommandLabel} runtime status was unavailable and auth status did not report ${providerLabel} authentication. ` +
          `Proceeding with catalog checks. Details: ${runtimeStatusMessage}`,
      };
    }
  }

  private async runProviderOneShotDiagnostic(
    claudePath: string,
    cwd: string,
    env: NodeJS.ProcessEnv,
    providerId: TeamProviderId | undefined = 'anthropic',
    providerArgs: string[] = []
  ): Promise<{ warning?: string }> {
    const cliCommandLabel = getConfiguredCliCommandLabel();
    const resolvedProviderId = resolveTeamProviderId(providerId);

    if (!(await pathExistsAsDirectory(cwd))) {
      appendPreflightDebugLog('provider_one_shot_diagnostic_skipped', {
        providerId: resolvedProviderId,
        cwd,
        reason: 'missing_cwd',
      });
      return {};
    }

    for (let attempt = 1; attempt <= PREFLIGHT_AUTH_MAX_RETRIES; attempt++) {
      let pingProbe: { exitCode: number | null; stdout: string; stderr: string } | null = null;
      try {
        pingProbe = await this.spawnProbe(
          claudePath,
          buildProviderCliCommandArgs(providerArgs, getPreflightPingArgs(providerId)),
          cwd,
          env,
          getPreflightTimeoutMs(providerId),
          {
            resolveOnOutputMatch: ({ stdout, stderr }) => {
              const combined = `${stdout}\n${stderr}`.trim();
              return /\bPONG\b/i.test(combined);
            },
          }
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!isProbeTimeoutMessage(message) && attempt < PREFLIGHT_AUTH_MAX_RETRIES) {
          logger.warn(
            `One-shot diagnostic failed (attempt ${attempt}/${PREFLIGHT_AUTH_MAX_RETRIES}), ` +
              `retrying in ${PREFLIGHT_AUTH_RETRY_DELAY_MS}ms: ${message}`
          );
          await new Promise((resolve) => setTimeout(resolve, PREFLIGHT_AUTH_RETRY_DELAY_MS));
          continue;
        }
        const normalizedMessage = normalizeProviderModelProbeFailureReason(message);
        return {
          warning:
            (isProbeTimeoutMessage(message)
              ? 'One-shot diagnostic timed out after runtime readiness passed. '
              : 'One-shot diagnostic did not complete after runtime readiness passed. ') +
            `This does not mark selected models unavailable. Details: ${normalizedMessage}`,
        };
      }

      const combinedOutput = buildCombinedLogs(pingProbe.stdout, pingProbe.stderr);
      const isAuthFailure = this.isAuthFailureWarning(combinedOutput, 'probe');

      if (isAuthFailure && attempt < PREFLIGHT_AUTH_MAX_RETRIES) {
        logger.warn(
          `One-shot diagnostic auth failure detected (attempt ${attempt}/${PREFLIGHT_AUTH_MAX_RETRIES}), ` +
            `retrying in ${PREFLIGHT_AUTH_RETRY_DELAY_MS}ms - likely stale locks from interrupted process`
        );
        await new Promise((resolve) => setTimeout(resolve, PREFLIGHT_AUTH_RETRY_DELAY_MS));
        continue;
      }

      if (isAuthFailure || pingProbe.exitCode !== 0) {
        const normalizedOutput =
          this.normalizeApiRetryErrorMessage(combinedOutput) || combinedOutput.trim();
        const hint = isAuthFailure
          ? resolvedProviderId === 'codex'
            ? 'Codex provider is not authenticated for `-p` mode. ' +
              `Authenticate Codex in ${cliCommandLabel} and retry.` +
              (attempt > 1 ? ` (failed after ${attempt} attempts)` : '')
            : `${cliCommandLabel} \`-p\` mode is not authenticated. ` +
              (cliCommandLabel === 'claude'
                ? 'Run `claude auth login` (or start `claude` and run `/login`) to authenticate. '
                : `Authenticate Anthropic in ${cliCommandLabel} and retry. `) +
              'For automation/headless use, set ANTHROPIC_API_KEY.' +
              (attempt > 1 ? ` (failed after ${attempt} attempts)` : '')
          : normalizedOutput
            ? `${cliCommandLabel} preflight check failed (exit code ${pingProbe.exitCode ?? 'unknown'}). Details: ${normalizedOutput}`
            : `${cliCommandLabel} preflight check failed (exit code ${pingProbe.exitCode ?? 'unknown'}).`;
        return {
          warning:
            'One-shot diagnostic failed after runtime readiness passed. ' +
            `This does not mark selected models unavailable. Details: ${hint}`,
        };
      }

      const pongCandidate = pingProbe.stdout.trim() || pingProbe.stderr.trim();
      const isPong = new RegExp(`\\b${getProviderModelProbeExpectedOutput()}\\b`, 'i').test(
        pongCandidate
      );
      if (!isPong) {
        return {
          warning:
            'One-shot diagnostic completed but did not return the expected PONG. ' +
            'This does not mark selected models unavailable. ' +
            `Output: ${combinedOutput || '(empty)'}`,
        };
      }

      if (attempt > 1) {
        logger.info(
          `One-shot diagnostic succeeded on attempt ${attempt} (previous attempt had auth failure)`
        );
      }
      return {};
    }

    return {};
  }

  /**
   * Run `claude --help` and return the output. Cached for 5 minutes.
   * Used by the validateCliArgs IPC handler to check user-entered flags.
   */
  async getCliHelpOutput(cwd?: string): Promise<string> {
    if (
      this.helpOutputCache &&
      Date.now() - this.helpOutputCacheTime < TeamProvisioningService.HELP_CACHE_TTL_MS
    ) {
      return this.helpOutputCache;
    }
    const targetCwd = cwd ?? process.cwd();
    const probeResult = await this.getCachedOrProbeResult(targetCwd, 'anthropic');
    if (!probeResult?.claudePath) {
      throw new Error(`${getConfiguredCliCommandLabel()} not found`);
    }
    const { env } = await this.buildProvisioningEnv();
    const result = await this.spawnProbe(
      probeResult.claudePath,
      ['--help'],
      targetCwd,
      env,
      10_000
    );
    const output = (result.stdout + '\n' + result.stderr).trim();
    if (!output) {
      throw new Error(
        `${getConfiguredCliCommandLabel()} --help returned empty output (exit code: ${String(result.exitCode)})`
      );
    }
    this.helpOutputCache = output;
    this.helpOutputCacheTime = Date.now();
    return output;
  }

  private buildAgentTeamsMcpValidationError(output: string): string {
    const detail = this.normalizeApiRetryErrorMessage(output) || output.trim();
    if (!detail) {
      return 'agent-teams MCP preflight failed before team launch.';
    }
    return `agent-teams MCP preflight failed before team launch. Details: ${detail}`;
  }

  private async readAgentTeamsMcpLaunchSpec(
    mcpConfigPath: string
  ): Promise<AgentTeamsMcpLaunchSpec> {
    let parsed: AgentTeamsMcpConfigFile;
    try {
      const raw = await fs.promises.readFile(mcpConfigPath, 'utf8');
      parsed = JSON.parse(raw) as AgentTeamsMcpConfigFile;
    } catch (error) {
      throw new Error(
        this.buildAgentTeamsMcpValidationError(
          `Failed to read generated MCP config ${mcpConfigPath}: ${
            error instanceof Error ? error.message : String(error)
          }`
        )
      );
    }

    const server = parsed.mcpServers?.['agent-teams'];
    if (!server) {
      throw new Error(
        this.buildAgentTeamsMcpValidationError(
          `Generated MCP config ${mcpConfigPath} does not contain an "agent-teams" server entry.`
        )
      );
    }

    if (typeof server.command !== 'string' || server.command.trim().length === 0) {
      throw new Error(
        this.buildAgentTeamsMcpValidationError(
          'Generated agent-teams MCP config is missing a valid launch command.'
        )
      );
    }

    if (server.args !== undefined && !isStringArray(server.args)) {
      throw new Error(
        this.buildAgentTeamsMcpValidationError(
          'Generated agent-teams MCP config has invalid args; expected a string array.'
        )
      );
    }

    if (server.cwd !== undefined && typeof server.cwd !== 'string') {
      throw new Error(
        this.buildAgentTeamsMcpValidationError(
          'Generated agent-teams MCP config has invalid cwd; expected a string path.'
        )
      );
    }

    return {
      command: server.command,
      args: server.args ?? [],
      cwd: typeof server.cwd === 'string' ? server.cwd : undefined,
      env: normalizeRecordStringValues(server.env),
    };
  }

  private async createAgentTeamsMcpValidationFixture(
    projectPath: string
  ): Promise<AgentTeamsMcpValidationFixture> {
    const claudeDir = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), 'agent-teams-mcp-validate-')
    );
    const teamName = 'mcp-validation-team';
    const memberName = 'mcp-validation-member';
    const teamDir = path.join(claudeDir, 'teams', teamName);

    await fs.promises.mkdir(teamDir, { recursive: true });
    await fs.promises.writeFile(
      path.join(teamDir, 'config.json'),
      JSON.stringify(
        {
          name: teamName,
          projectPath,
          members: [
            {
              name: CANONICAL_LEAD_MEMBER_NAME,
              agentType: CANONICAL_LEAD_MEMBER_NAME,
              role: 'lead',
            },
            { name: memberName, agentType: 'teammate', role: 'developer' },
          ],
        },
        null,
        2
      ),
      'utf8'
    );

    return {
      claudeDir,
      teamName,
      memberName,
    };
  }

  private async validateAgentTeamsMcpRuntime(
    _claudePath: string,
    cwd: string,
    env: NodeJS.ProcessEnv,
    mcpConfigPath: string,
    options: {
      isCancelled?: () => boolean;
    } = {}
  ): Promise<void> {
    const launchSpec = await this.readAgentTeamsMcpLaunchSpec(mcpConfigPath);
    const preflightCacheKey = JSON.stringify(launchSpec);
    if (mcpPreflightPassedKeys.has(preflightCacheKey)) {
      return;
    }
    const inFlightPreflight = mcpPreflightPromisesByKey.get(preflightCacheKey);
    if (inFlightPreflight) {
      return inFlightPreflight;
    }
    const preflightPromise = this._runMcpPreflight(cwd, env, launchSpec, options)
      .then(() => {
        mcpPreflightPassedKeys.add(preflightCacheKey);
        mcpPreflightPromisesByKey.delete(preflightCacheKey);
      })
      .catch((error: unknown) => {
        // Reset so next attempt retries
        mcpPreflightPromisesByKey.delete(preflightCacheKey);
        throw error;
      });
    mcpPreflightPromisesByKey.set(preflightCacheKey, preflightPromise);
    return preflightPromise;
  }

  private async _runMcpPreflight(
    cwd: string,
    env: NodeJS.ProcessEnv,
    launchSpec: AgentTeamsMcpLaunchSpec,
    options: { isCancelled?: () => boolean }
  ): Promise<void> {
    const fixture = await this.createAgentTeamsMcpValidationFixture(cwd);
    let child: ReturnType<typeof spawn> | null = null;
    let stdoutBuffer = '';
    let stderrBuffer = '';
    let nextRequestId = 1;
    let cancellationTriggered = false;
    let cancellationTimer: ReturnType<typeof setInterval> | null = null;
    const cancellationMessage = 'agent-teams MCP preflight cancelled by app shutdown';
    const pending = new Map<
      number,
      {
        resolve: (value: unknown) => void;
        reject: (error: Error) => void;
        timeoutHandle: ReturnType<typeof setTimeout>;
      }
    >();

    const rejectAll = (error: Error): void => {
      for (const [id, entry] of pending) {
        clearTimeout(entry.timeoutHandle);
        entry.reject(error);
        pending.delete(id);
      }
    };

    const getCancellationError = (): Error => new Error(cancellationMessage);
    const cancelPreflightIfNeeded = (): boolean => {
      if (cancellationTriggered) {
        return true;
      }
      if (!options.isCancelled?.()) {
        return false;
      }
      cancellationTriggered = true;
      const error = getCancellationError();
      rejectAll(error);
      if (child?.pid) {
        killProcessTree(child);
      }
      return true;
    };
    const throwIfCancelled = (): void => {
      if (cancelPreflightIfNeeded()) {
        throw getCancellationError();
      }
    };

    try {
      throwIfCancelled();
      child = spawnCli(launchSpec.command, launchSpec.args, {
        cwd: launchSpec.cwd ?? cwd,
        env: { ...env, ...launchSpec.env },
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      });
      this.transientProbeProcesses.add(child);
      if (options.isCancelled) {
        cancellationTimer = setInterval(() => {
          if (cancelPreflightIfNeeded() && cancellationTimer) {
            clearInterval(cancellationTimer);
            cancellationTimer = null;
          }
        }, 100);
        cancellationTimer.unref?.();
      }

      const parseStdoutLine = (line: string): void => {
        let message: McpJsonRpcResponse<unknown>;
        try {
          message = JSON.parse(line) as McpJsonRpcResponse<unknown>;
        } catch (error) {
          logger.warn(
            `agent-teams MCP preflight emitted non-JSON stdout line: ${
              error instanceof Error ? error.message : String(error)
            }`
          );
          return;
        }

        if (typeof message.id !== 'number') {
          return;
        }

        const entry = pending.get(message.id);
        if (!entry) {
          return;
        }

        clearTimeout(entry.timeoutHandle);
        pending.delete(message.id);

        if (message.error) {
          entry.reject(new Error(message.error.message ?? 'Unknown MCP JSON-RPC error'));
          return;
        }

        entry.resolve(message.result);
      };

      child.stdout?.setEncoding('utf8');
      child.stdout?.on('data', (chunk: string | Buffer) => {
        stdoutBuffer += chunk.toString();

        while (true) {
          const newlineIndex = stdoutBuffer.indexOf('\n');
          if (newlineIndex === -1) {
            break;
          }

          const line = stdoutBuffer.slice(0, newlineIndex).trim();
          stdoutBuffer = stdoutBuffer.slice(newlineIndex + 1);
          if (!line) {
            continue;
          }
          parseStdoutLine(line);
        }
      });

      child.stderr?.setEncoding('utf8');
      child.stderr?.on('data', (chunk: string | Buffer) => {
        stderrBuffer += chunk.toString();
      });

      child.once('error', (error) => {
        rejectAll(error instanceof Error ? error : new Error(String(error)));
      });

      child.once('close', (code, signal) => {
        if (pending.size === 0) {
          return;
        }
        rejectAll(
          new Error(
            `agent-teams MCP process exited unexpectedly during preflight (code=${
              code ?? 'null'
            } signal=${signal ?? 'null'})`
          )
        );
      });

      const request = <TResult>(
        method: string,
        params: Record<string, unknown>,
        timeoutMs: number = VERIFY_TIMEOUT_MS
      ): Promise<TResult> =>
        new Promise<TResult>((resolve, reject) => {
          if (cancelPreflightIfNeeded()) {
            reject(getCancellationError());
            return;
          }
          if (!child?.stdin) {
            reject(new Error('agent-teams MCP stdin is not available'));
            return;
          }

          const id = nextRequestId++;
          const timeoutHandle = setTimeout(() => {
            pending.delete(id);
            reject(new Error(`agent-teams MCP request timed out: ${method}`));
          }, timeoutMs);

          pending.set(id, {
            resolve: resolve as (value: unknown) => void,
            reject,
            timeoutHandle,
          });

          if (cancelPreflightIfNeeded()) {
            clearTimeout(timeoutHandle);
            pending.delete(id);
            reject(getCancellationError());
            return;
          }

          child.stdin.write(
            `${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`,
            (error) => {
              if (!error) {
                return;
              }
              clearTimeout(timeoutHandle);
              pending.delete(id);
              reject(error instanceof Error ? error : new Error(String(error)));
            }
          );
        });

      const notify = async (method: string, params?: Record<string, unknown>): Promise<void> => {
        if (!child?.stdin) {
          throw new Error('agent-teams MCP stdin is not available');
        }
        const stdin = child.stdin;

        await new Promise<void>((resolve, reject) => {
          stdin.write(
            `${JSON.stringify({ jsonrpc: '2.0', method, ...(params ? { params } : {}) })}\n`,
            (error) => {
              if (error) {
                reject(error instanceof Error ? error : new Error(String(error)));
                return;
              }
              resolve();
            }
          );
        });
      };

      await request(
        'initialize',
        {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'hermit', version: '1.0.0' },
        },
        MCP_PREFLIGHT_INITIALIZE_TIMEOUT_MS
      );
      throwIfCancelled();
      await notify('notifications/initialized');

      const toolsList = await request<McpToolsListResult>('tools/list', {});
      throwIfCancelled();
      const availableTools = new Set((toolsList.tools ?? []).map((tool) => tool.name));
      const requiredTools = Array.from(
        new Set([
          ...AGENT_TEAMS_TEAMMATE_OPERATIONAL_TOOL_NAMES,
          'lead_briefing',
          'runtime_bootstrap_checkin',
          'runtime_deliver_message',
          'runtime_task_event',
          'runtime_heartbeat',
        ])
      );
      const missingTools = requiredTools.filter((toolName) => !availableTools.has(toolName));
      if (missingTools.length > 0) {
        throw new Error(
          `agent-teams MCP started but tools/list did not include required tool(s): ${missingTools.join(
            ', '
          )}`
        );
      }

      const memberBriefing = await request<McpToolCallResult>('tools/call', {
        name: 'member_briefing',
        arguments: {
          claudeDir: fixture.claudeDir,
          teamName: fixture.teamName,
          memberName: fixture.memberName,
          runtimeProvider: 'opencode',
        },
      });
      throwIfCancelled();

      if (memberBriefing.isError) {
        throw new Error(
          memberBriefing.content?.[0]?.text ??
            'agent-teams MCP returned an unspecified error for member_briefing'
        );
      }

      const briefingText = memberBriefing.content?.find((item) => item.type === 'text')?.text ?? '';
      if (briefingText.trim().length === 0) {
        throw new Error('agent-teams MCP returned empty content for member_briefing');
      }

      const leadBriefing = await request<McpToolCallResult>('tools/call', {
        name: 'lead_briefing',
        arguments: {
          claudeDir: fixture.claudeDir,
          teamName: fixture.teamName,
        },
      });
      throwIfCancelled();

      if (leadBriefing.isError) {
        throw new Error(
          leadBriefing.content?.[0]?.text ??
            'agent-teams MCP returned an unspecified error for lead_briefing'
        );
      }

      const leadBriefingText =
        leadBriefing.content?.find((item) => item.type === 'text')?.text ?? '';
      if (leadBriefingText.trim().length === 0) {
        throw new Error('agent-teams MCP returned empty content for lead_briefing');
      }
    } catch (error) {
      if (error instanceof Error && error.message === cancellationMessage) {
        throw error;
      }
      const detail = buildCombinedLogs('', stderrBuffer).trim();
      const errorText =
        error instanceof Error && detail.length > 0
          ? `${error.message}\n${detail}`
          : detail || String(error);
      throw new Error(this.buildAgentTeamsMcpValidationError(errorText));
    } finally {
      if (cancellationTimer) {
        clearInterval(cancellationTimer);
        cancellationTimer = null;
      }
      rejectAll(new Error('agent-teams MCP preflight session closed'));
      if (child) {
        this.transientProbeProcesses.delete(child);
      }
      if (child?.stdin && !child.stdin.destroyed && !child.stdin.writableEnded) {
        const stdin = child.stdin;
        await new Promise<void>((resolve) => {
          try {
            stdin.end(() => resolve());
          } catch {
            resolve();
          }
        });
      }
      if (child?.pid) {
        await waitForChildProcessToExit(child, MCP_PREFLIGHT_SHUTDOWN_GRACE_MS);
        if (isProcessAlive(child.pid)) {
          killProcessTree(child);
          await waitForPidsToExit([child.pid], {
            timeoutMs: MCP_PREFLIGHT_SHUTDOWN_TIMEOUT_MS,
            pollMs: MCP_PREFLIGHT_SHUTDOWN_POLL_MS,
          });
          await waitForChildProcessToExit(child, MCP_PREFLIGHT_SHUTDOWN_GRACE_MS);
        }
      }
      await fs.promises.rm(fixture.claudeDir, { recursive: true, force: true }).catch(() => {});
    }
  }

  private async spawnProbe(
    claudePath: string,
    args: string[],
    cwd: string,
    env: NodeJS.ProcessEnv,
    timeoutMs: number,
    options?: {
      /**
       * Optional early success predicate. If this returns true based on
       * buffered stdout/stderr, the probe resolves immediately (and the process
       * is best-effort terminated) instead of waiting for `close`.
       */
      resolveOnOutputMatch?: (ctx: { stdout: string; stderr: string }) => boolean;
    }
  ): Promise<{ exitCode: number | null; stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
      const child = spawnCli(claudePath, args, {
        cwd,
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      this.transientProbeProcesses.add(child);
      const cleanupProbe = (): void => {
        this.transientProbeProcesses.delete(child);
      };
      let stdoutText = '';
      let stderrText = '';
      let settled = false;

      const timeoutHandle = setTimeout(() => {
        settled = true;
        cleanupProbe();
        killProcessTree(child);
        reject(new Error(`Timeout running: ${getConfiguredCliCommandLabel()} ${args.join(' ')}`));
      }, timeoutMs);
      timeoutHandle.unref?.();

      const maybeResolveEarly = (): void => {
        if (settled) return;
        if (!options?.resolveOnOutputMatch) return;
        const ctx = { stdout: stdoutText.trim(), stderr: stderrText.trim() };
        if (!options.resolveOnOutputMatch(ctx)) return;

        settled = true;
        clearTimeout(timeoutHandle);
        cleanupProbe();
        // If the process printed the match but hangs during teardown, don't
        // block the UI; terminate best-effort and resolve.
        killProcessTree(child);
        resolve({ exitCode: 0, stdout: ctx.stdout, stderr: ctx.stderr });
      };

      child.stdout?.on('data', (chunk: Buffer) => {
        stdoutText += chunk.toString('utf8');
        maybeResolveEarly();
      });
      child.stderr?.on('data', (chunk: Buffer) => {
        stderrText += chunk.toString('utf8');
        maybeResolveEarly();
      });
      child.once('error', (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeoutHandle);
        cleanupProbe();
        reject(error);
      });
      child.once('close', (exitCode) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeoutHandle);
        cleanupProbe();
        resolve({
          exitCode,
          stdout: stdoutText.trim(),
          stderr: stderrText.trim(),
        });
      });
    });
  }
}
