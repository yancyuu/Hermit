import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AGENT_BLOCK_CLOSE, AGENT_BLOCK_OPEN } from '@shared/constants/agentBlocks';

const hoisted = vi.hoisted(() => ({
  paths: {
    claudeRoot: '',
    teamsBase: '',
    tasksBase: '',
  },
}));

let tempClaudeRoot = '';
let tempTeamsBase = '';
let tempTasksBase = '';

vi.mock('@main/services/team/ClaudeBinaryResolver', () => ({
  ClaudeBinaryResolver: { resolve: vi.fn() },
}));

vi.mock('@main/utils/childProcess', () => ({
  execCli: vi.fn(async (_binaryPath: string | null, args: string[]) => {
    if (args[0] === 'model') {
      return {
        stdout: JSON.stringify({
          schemaVersion: 1,
          providers: {
            anthropic: {
              defaultModel: 'opus[1m]',
              models: [
                { id: 'opus', label: 'Opus 4.7', description: 'Anthropic default family alias' },
                {
                  id: 'opus[1m]',
                  label: 'Opus 4.7 (1M)',
                  description: 'Anthropic long-context default',
                },
              ],
            },
            codex: {
              defaultModel: 'gpt-5.4',
              models: [{ id: 'gpt-5.4', label: 'GPT-5.4', description: 'Codex default' }],
            },
            gemini: {
              defaultModel: 'gemini-2.5-pro',
              models: [{ id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro', description: 'Default' }],
            },
          },
        }),
        stderr: '',
      };
    }
    if (args[0] === 'runtime') {
      return {
        stdout: JSON.stringify({
          providers: {
            codex: {
              runtimeCapabilities: {
                modelCatalog: { dynamic: false, source: 'runtime' },
                reasoningEffort: {
                  supported: true,
                  values: ['low', 'medium', 'high'],
                  configPassthrough: false,
                },
              },
            },
          },
        }),
        stderr: '',
      };
    }
    return { stdout: '', stderr: '' };
  }),
  spawnCli: vi.fn(),
  killProcessTree: vi.fn(),
}));

vi.mock('@main/utils/pathDecoder', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@main/utils/pathDecoder')>();
  return {
    ...actual,
    getAutoDetectedClaudeBasePath: () => hoisted.paths.claudeRoot,
    getClaudeBasePath: () => hoisted.paths.claudeRoot,
    getTeamsBasePath: () => hoisted.paths.teamsBase,
    getTasksBasePath: () => hoisted.paths.tasksBase,
  };
});

import {
  buildAddMemberSpawnMessage,
  buildRestartMemberSpawnMessage,
  TeamProvisioningService,
} from '@main/services/team/TeamProvisioningService';
import { ClaudeBinaryResolver } from '@main/services/team/ClaudeBinaryResolver';
import { execCli, spawnCli } from '@main/utils/childProcess';
import { setAppDataBasePath } from '@main/utils/pathDecoder';

function createFakeChild() {
  const writeSpy = vi.fn((_data: unknown, cb?: (err?: Error | null) => void) => {
    if (typeof cb === 'function') cb(null);
    return true;
  });
  const endSpy = vi.fn();
  const child = Object.assign(new EventEmitter(), {
    pid: 12345,
    stdin: { writable: true, write: writeSpy, end: endSpy },
    stdout: new EventEmitter(),
    stderr: new EventEmitter(),
    kill: vi.fn(),
  });
  return { child, writeSpy };
}

function preserveProviderRequest(svc: TeamProvisioningService): void {
  (svc as any).normalizeClaudeCodeOnlyRequest = vi.fn((request: unknown) => request);
}

function extractPromptFromStreamJsonWrite(
  writeSpy: ReturnType<typeof createFakeChild>['writeSpy'],
  callIndex = 0
): string {
  const raw = writeSpy.mock.calls[callIndex]?.[0];
  if (typeof raw !== 'string') {
    throw new Error('Failed to extract stream-json prompt payload from stdin write');
  }
  const parsed = JSON.parse(raw.trim()) as {
    message?: { content?: Array<{ type?: string; text?: string }> };
  };
  const text = parsed.message?.content?.find((item) => item.type === 'text')?.text;
  if (!text) {
    throw new Error('stream-json stdin write did not include text content');
  }
  return text;
}

function extractBootstrapSpec(callIndex = 0): {
  mode?: string;
  team?: { name?: string; cwd?: string };
  lead?: { permissionSeedTools?: string[] };
  members?: Array<Record<string, unknown>>;
} {
  const args = vi.mocked(spawnCli).mock.calls[callIndex]?.[1] as string[] | undefined;
  const specFlagIndex = args?.indexOf('--team-bootstrap-spec') ?? -1;
  const specPath = specFlagIndex >= 0 ? args?.[specFlagIndex + 1] : null;
  if (!specPath) {
    throw new Error('Failed to extract bootstrap spec path from spawn args');
  }
  return JSON.parse(fs.readFileSync(specPath, 'utf8')) as {
    mode?: string;
    team?: { name?: string; cwd?: string };
    lead?: { permissionSeedTools?: string[] };
    members?: Array<Record<string, unknown>>;
  };
}

describe('TeamProvisioningService prompt content (solo mode discipline)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    tempClaudeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-team-prompts-'));
    tempTeamsBase = path.join(tempClaudeRoot, 'teams');
    tempTasksBase = path.join(tempClaudeRoot, 'tasks');
    hoisted.paths.claudeRoot = tempClaudeRoot;
    hoisted.paths.teamsBase = tempTeamsBase;
    hoisted.paths.tasksBase = tempTasksBase;
    setAppDataBasePath(tempClaudeRoot);
    fs.mkdirSync(tempTeamsBase, { recursive: true });
    fs.mkdirSync(tempTasksBase, { recursive: true });
  });

  afterEach(() => {
    setAppDataBasePath(null);
    // Best-effort cleanup of temp dir (per-test)
    try {
      fs.rmSync(tempClaudeRoot, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it('createTeam uses deterministic bootstrap spec and safe flags in solo mode', async () => {
    vi.mocked(ClaudeBinaryResolver.resolve).mockResolvedValue('/fake/claude');
    const { child, writeSpy } = createFakeChild();
    vi.mocked(spawnCli).mockReturnValue(child as any);

    const svc = new TeamProvisioningService();
    (svc as any).buildProvisioningEnv = vi.fn(async () => ({
      env: { ANTHROPIC_API_KEY: 'test' },
      authSource: 'anthropic_api_key',
    }));
    (svc as any).validateAgentTeamsMcpRuntime = vi.fn(async () => {});
    (svc as any).startFilesystemMonitor = vi.fn();
    (svc as any).pathExists = vi.fn(async () => false);

    const { runId } = await svc.createTeam(
      {
        teamName: 'solo-team',
        cwd: process.cwd(),
        members: [],
        description: 'Solo team for prompt test',
      },
      () => {}
    );

    expect(writeSpy).toHaveBeenCalledTimes(1);
    const bootstrapSpec = extractBootstrapSpec();
    expect(bootstrapSpec.mode).toBe('create');
    expect(bootstrapSpec.team).toMatchObject({
      name: 'solo-team',
      cwd: process.cwd(),
    });
    expect(bootstrapSpec.members).toEqual([]);

    const launchArgs = vi.mocked(spawnCli).mock.calls[0]?.[1] as string[];
    expect(launchArgs).toContain('--mcp-config');
    expect(launchArgs).toContain('--team-bootstrap-spec');
    expect(launchArgs).not.toContain('--team-bootstrap-user-prompt-file');
    expect(launchArgs).not.toContain('--strict-mcp-config');
    expect(launchArgs).toContain('--disallowedTools');
    const disallowed = launchArgs[launchArgs.indexOf('--disallowedTools') + 1] ?? '';
    expect(disallowed).not.toContain('Agent');
    expect(disallowed).toContain('mcp__agent-teams__team_launch');

    await svc.cancelProvisioning(runId);
  });

  it('launchTeam prompt (solo) uses deterministic refresh-only reconnect instructions', async () => {
    // Seed config.json so launchTeam can validate team existence.
    const teamName = 'solo-team-launch';
    const teamDir = path.join(tempTeamsBase, teamName);
    fs.mkdirSync(teamDir, { recursive: true });
    fs.writeFileSync(
      path.join(teamDir, 'config.json'),
      JSON.stringify({
        name: teamName,
        description: 'Solo team for prompt test',
        members: [{ name: 'lead', agentType: 'lead' }],
      }),
      'utf8'
    );

    vi.mocked(ClaudeBinaryResolver.resolve).mockResolvedValue('/fake/claude');
    const { child, writeSpy } = createFakeChild();
    vi.mocked(spawnCli).mockReturnValue(child as any);

    const svc = new TeamProvisioningService();
    (svc as any).buildProvisioningEnv = vi.fn(async () => ({
      env: { ANTHROPIC_API_KEY: 'test' },
      authSource: 'anthropic_api_key',
    }));
    (svc as any).normalizeTeamConfigForLaunch = vi.fn(async () => {});
    (svc as any).updateConfigProjectPath = vi.fn(async () => {});
    (svc as any).restorePrelaunchConfig = vi.fn(async () => {});
    (svc as any).persistLaunchStateSnapshot = vi.fn(async () => {});
    (svc as any).resolveLaunchExpectedMembers = vi.fn(async () => ({
      members: [],
      source: 'config-fallback',
      warning: undefined,
    }));
    (svc as any).validateAgentTeamsMcpRuntime = vi.fn(async () => {});
    (svc as any).pathExists = vi.fn(async () => false);
    (svc as any).startFilesystemMonitor = vi.fn();

    const { runId } = await svc.launchTeam(
      {
        teamName,
        cwd: process.cwd(),
        clearContext: true,
      } as any,
      () => {}
    );

    expect(writeSpy).toHaveBeenCalledTimes(1);
    const prompt = extractPromptFromStreamJsonWrite(writeSpy);
    expect(prompt).toContain('SOLO MODE');
    expect(prompt).toContain('本次 reconnect/bootstrap 步骤已经由 runtime 确定性完成。');
    expect(prompt).toContain('本轮不要开始实现工作。');
    expect(prompt).toContain('本轮只用于刷新上下文、查看当前看板快照，并确认你已准备好。');
    expect(prompt).toContain(
      '本轮不要创建、分配或委派任何新任务。如果看板为空，请保持安静并等待新的用户指令。'
    );
    expect(prompt).toContain(
      'review_request'
    );
    expect(prompt).toContain('plain #<short-id>');
    expect(prompt).toContain('Never hand-write [#abcd1234](task://...)');
    expect(prompt).toContain('task_create_from_message');
    expect(prompt).toContain(AGENT_BLOCK_OPEN);
    expect(prompt).toContain(AGENT_BLOCK_CLOSE);
    expect(prompt).not.toContain('teamctl.js');
    expect(prompt).not.toContain('.claude/tools');

    const launchArgs = vi.mocked(spawnCli).mock.calls[0]?.[1] as string[];
    expect(launchArgs).toContain('--mcp-config');
    expect(launchArgs).not.toContain('--strict-mcp-config');

    await svc.cancelProvisioning(runId);
  });

  it('createTeam bootstrap spec carries teammate descriptors for deterministic startup', async () => {
    vi.mocked(ClaudeBinaryResolver.resolve).mockResolvedValue('/fake/claude');
    const { child, writeSpy } = createFakeChild();
    vi.mocked(spawnCli).mockReturnValue(child as any);

    const svc = new TeamProvisioningService();
    (svc as any).buildProvisioningEnv = vi.fn(async () => ({
      env: { ANTHROPIC_API_KEY: 'test' },
      authSource: 'anthropic_api_key',
    }));
    (svc as any).validateAgentTeamsMcpRuntime = vi.fn(async () => {});
    (svc as any).startFilesystemMonitor = vi.fn();
    (svc as any).pathExists = vi.fn(async () => false);

    const { runId } = await svc.createTeam(
      {
        teamName: 'multi-team',
        cwd: process.cwd(),
        members: [{ name: 'alice', role: 'developer' }],
        description: 'Multi team prompt test',
      },
      () => {}
    );

    expect(writeSpy).toHaveBeenCalledTimes(1);
    const bootstrapSpec = extractBootstrapSpec();
    expect(bootstrapSpec.mode).toBe('create');
    expect(bootstrapSpec.members).toEqual([
      expect.objectContaining({
        name: 'alice',
        agentType: 'agent-teams-member',
        role: 'developer',
        description: 'developer',
        cwd: process.cwd(),
      }),
    ]);
    const launchArgs = vi.mocked(spawnCli).mock.calls[0]?.[1] as string[];
    const agentsArg = launchArgs[launchArgs.indexOf('--agents') + 1] ?? '{}';
    expect(JSON.parse(agentsArg)).toMatchObject({
      'agent-teams-member': {
        mcpServers: [
          {
            'agent-teams': expect.objectContaining({
              args: expect.any(Array),
            }),
          },
        ],
      },
    });

    await svc.cancelProvisioning(runId);
  });

  it('createTeam bootstrap spec includes worktree isolation only for selected teammates', async () => {
    vi.mocked(ClaudeBinaryResolver.resolve).mockResolvedValue('/fake/claude');
    const { child } = createFakeChild();
    vi.mocked(spawnCli).mockReturnValue(child as any);

    const svc = new TeamProvisioningService();
    (svc as any).buildProvisioningEnv = vi.fn(async () => ({
      env: { ANTHROPIC_API_KEY: 'test' },
      authSource: 'anthropic_api_key',
    }));
    (svc as any).validateAgentTeamsMcpRuntime = vi.fn(async () => {});
    (svc as any).startFilesystemMonitor = vi.fn();
    (svc as any).pathExists = vi.fn(async () => false);

    const { runId } = await svc.createTeam(
      {
        teamName: 'worktree-mixed-team',
        cwd: process.cwd(),
        members: [
          { name: 'alice', role: 'developer', isolation: 'worktree' },
          { name: 'bob', role: 'reviewer' },
        ],
      },
      () => {}
    );

    const bootstrapSpec = extractBootstrapSpec();
    expect(bootstrapSpec.members?.[0]).toEqual(
      expect.objectContaining({ name: 'alice', isolation: 'worktree' })
    );
    expect(bootstrapSpec.members?.[1]).toEqual(expect.objectContaining({ name: 'bob' }));
    expect(bootstrapSpec.members?.[1]).not.toHaveProperty('isolation');

    await svc.cancelProvisioning(runId);
  });

  it('forwards codex provider launch overrides into createTeam runtime args', async () => {
    vi.mocked(ClaudeBinaryResolver.resolve).mockResolvedValue('/fake/codex');
    const { child } = createFakeChild();
    vi.mocked(spawnCli).mockReturnValue(child as any);

    const svc = new TeamProvisioningService();
    preserveProviderRequest(svc);
    (svc as any).buildProvisioningEnv = vi.fn(async () => ({
      env: {},
      authSource: 'codex_runtime',
      providerArgs: ['--settings', '{"codex":{"forced_login_method":"chatgpt"}}'],
    }));
    (svc as any).validateAgentTeamsMcpRuntime = vi.fn(async () => {});
    (svc as any).startFilesystemMonitor = vi.fn();
    (svc as any).pathExists = vi.fn(async () => false);

    const { runId } = await svc.createTeam(
      {
        teamName: 'codex-team',
        cwd: process.cwd(),
        members: [],
        providerId: 'codex',
      },
      () => {}
    );

    const launchArgs = vi.mocked(spawnCli).mock.calls[0]?.[1] as string[];
    expect(launchArgs).toEqual(
      expect.arrayContaining(['--settings', '{"codex":{"forced_login_method":"chatgpt"}}'])
    );

    await svc.cancelProvisioning(runId);
  });

  it('blocks Codex xhigh launch effort until runtime exposes reasoning config passthrough', async () => {
    vi.mocked(ClaudeBinaryResolver.resolve).mockResolvedValue('/fake/codex');
    vi.mocked(spawnCli).mockReset();

    const svc = new TeamProvisioningService();
    preserveProviderRequest(svc);
    (svc as any).buildProvisioningEnv = vi.fn(async () => ({
      env: {},
      authSource: 'codex_runtime',
      providerArgs: [],
    }));
    (svc as any).validateAgentTeamsMcpRuntime = vi.fn(async () => {});
    (svc as any).startFilesystemMonitor = vi.fn();
    (svc as any).pathExists = vi.fn(async () => false);

    await expect(
      svc.createTeam(
        {
          teamName: 'codex-xhigh-blocked',
          cwd: process.cwd(),
          members: [],
          providerId: 'codex',
          effort: 'xhigh',
        },
        () => {}
      )
    ).rejects.toThrow();

    expect(spawnCli).not.toHaveBeenCalled();
  });

  it('blocks future Codex catalog models until runtime declares dynamic launch support', async () => {
    vi.mocked(ClaudeBinaryResolver.resolve).mockResolvedValue('/fake/codex');
    vi.mocked(spawnCli).mockReset();

    const svc = new TeamProvisioningService();
    preserveProviderRequest(svc);
    (svc as any).buildProvisioningEnv = vi.fn(async () => ({
      env: {},
      authSource: 'codex_runtime',
      providerArgs: [],
    }));
    (svc as any).validateAgentTeamsMcpRuntime = vi.fn(async () => {});
    (svc as any).startFilesystemMonitor = vi.fn();
    (svc as any).pathExists = vi.fn(async () => false);

    await expect(
      svc.createTeam(
        {
          teamName: 'codex-future-model-blocked',
          cwd: process.cwd(),
          members: [],
          providerId: 'codex',
          model: 'gpt-5.5',
          effort: 'medium',
        },
        () => {}
      )
    ).rejects.toThrow();

    expect(execCli).toHaveBeenCalledWith(
      '/fake/codex',
      ['runtime', 'status', '--json', '--provider', 'codex'],
      expect.objectContaining({ cwd: process.cwd() })
    );
    expect(spawnCli).not.toHaveBeenCalled();
  });

  it('restart teammate message keeps the exact teammate identity and avoids duplicate semantics', () => {
    const message = buildRestartMemberSpawnMessage('forge-labs', 'Forge Labs', 'lead', {
      name: 'alice',
      role: 'Reviewer',
      providerId: 'codex',
      model: 'gpt-5.4-mini',
      effort: 'medium',
    });

    expect(message).toBeTruthy();
    expect(message).toContain('team_name="forge-labs", name="alice"');
    expect(message).toContain('provider="codex", model="gpt-5.4-mini", effort="medium"');
    expect(message).toContain('alice');
    expect(message).toContain('duplicate_skipped');
    expect(message).toContain('bootstrap_pending');
    expect(message).toContain('already_running');
  });

  it('add and restart teammate prompts include worktree isolation only when selected', () => {
    const addMessage = buildAddMemberSpawnMessage('forge-labs', 'Forge Labs', 'lead', {
      name: 'alice',
      isolation: 'worktree',
    });
    const normalAddMessage = buildAddMemberSpawnMessage('forge-labs', 'Forge Labs', 'lead', {
      name: 'bob',
    });
    const restartMessage = buildRestartMemberSpawnMessage('forge-labs', 'Forge Labs', 'lead', {
      name: 'alice',
      isolation: 'worktree',
    });

    expect(addMessage).toContain('isolation="worktree"');
    expect(restartMessage).toContain('isolation="worktree"');
    expect(normalAddMessage).not.toContain('isolation="worktree"');
  });

  it('createTeam materializes an explicit Codex default model for teammates before bootstrap spawn', async () => {
    vi.mocked(ClaudeBinaryResolver.resolve).mockResolvedValue('/fake/claude');
    const { child } = createFakeChild();
    vi.mocked(spawnCli).mockReturnValue(child as any);

    const svc = new TeamProvisioningService();
    preserveProviderRequest(svc);
    (svc as any).buildProvisioningEnv = vi.fn(async () => ({
      env: { PATH: '/usr/bin' },
      authSource: 'codex_runtime',
      geminiRuntimeAuth: null,
    }));
    (svc as any).readRuntimeProviderLaunchFacts = vi.fn(async () => ({
      defaultModel: 'gpt-5.4',
      modelIds: new Set(['gpt-5.4']),
      modelCatalog: null,
      runtimeCapabilities: null,
      providerStatus: null,
    }));
    (svc as any).validateAgentTeamsMcpRuntime = vi.fn(async () => {});
    (svc as any).startFilesystemMonitor = vi.fn();
    (svc as any).pathExists = vi.fn(async () => false);

    const { runId } = await svc.createTeam(
      {
        teamName: 'codex-default-team',
        cwd: process.cwd(),
        providerId: 'codex',
        members: [{ name: 'alice', role: 'developer', providerId: 'codex' }],
      },
      () => {}
    );

    const bootstrapSpec = extractBootstrapSpec();
    expect(bootstrapSpec.members).toEqual([
      expect.objectContaining({
        name: 'alice',
        provider: 'codex',
        model: 'gpt-5.4',
      }),
    ]);

    await svc.cancelProvisioning(runId);
  });

  it('createTeam fails fast when a Codex teammate default model cannot be resolved', async () => {
    vi.mocked(ClaudeBinaryResolver.resolve).mockResolvedValue('/fake/claude');
    vi.mocked(spawnCli).mockReset();

    const svc = new TeamProvisioningService();
    preserveProviderRequest(svc);
    (svc as any).buildProvisioningEnv = vi.fn(async () => ({
      env: { PATH: '/usr/bin' },
      authSource: 'codex_runtime',
      geminiRuntimeAuth: null,
    }));
    (svc as any).readRuntimeProviderLaunchFacts = vi.fn(async () => ({
      defaultModel: null,
      modelIds: new Set(),
      modelCatalog: null,
      runtimeCapabilities: null,
      providerStatus: null,
    }));
    (svc as any).validateAgentTeamsMcpRuntime = vi.fn(async () => {});
    (svc as any).startFilesystemMonitor = vi.fn();
    (svc as any).pathExists = vi.fn(async () => false);

    await expect(
      svc.createTeam(
        {
          teamName: 'codex-default-missing',
          cwd: process.cwd(),
          providerId: 'codex',
          members: [{ name: 'alice', providerId: 'codex' }],
        },
        () => {}
      )
    ).rejects.toThrow();

    expect(spawnCli).not.toHaveBeenCalled();
  });

  it('add-member spawn prompt tells teammates to keep review on the same task', () => {
    const prompt = buildAddMemberSpawnMessage('my-team', 'My Team', 'lead', {
      name: 'alice',
      role: 'developer',
    });

    expect(prompt).toContain('review');
    expect(prompt).toContain('review_start');
    expect(prompt).toContain('review_approve');
    expect(prompt).toContain('review_request_changes');
  });

  it('teammate spawn prompts forbid manual task markdown links in visible messages', () => {
    const addPrompt = buildAddMemberSpawnMessage('my-team', 'My Team', 'lead', {
      name: 'alice',
      role: 'developer',
    });
    const restartPrompt = buildRestartMemberSpawnMessage('my-team', 'My Team', 'lead', {
      name: 'alice',
      role: 'developer',
    });

    for (const prompt of [addPrompt, restartPrompt]) {
      expect(prompt).toBeTruthy();
      expect(prompt).toContain('#<short-id>');
      expect(prompt).toContain('taskRefs');
      // Source mentions task:// only inside a warning not to use it
      expect(prompt).toContain('task://...');
    }
  });

  it('add-member spawn prompt explicitly forbids no-task bootstrap chatter', () => {
    const prompt = buildAddMemberSpawnMessage('my-team', 'My Team', 'lead', {
      name: 'alice',
      role: 'developer',
    });

    expect(prompt).toContain('task_briefing');
    expect(prompt).toContain('task_list');
    expect(prompt).toContain('member_briefing');
    expect(prompt.length).toBeGreaterThan(100);
  });

  it('launchTeam hydration prompt includes task-comment handling guidance by default', async () => {
    const teamName = 'forward-live-team';
    const teamDir = path.join(tempTeamsBase, teamName);
    fs.mkdirSync(teamDir, { recursive: true });
    fs.writeFileSync(
      path.join(teamDir, 'config.json'),
      JSON.stringify({
        name: teamName,
        description: 'Task comment forwarding live prompt test',
        members: [
          { name: 'lead', agentType: 'lead' },
          { name: 'alice', agentType: 'teammate', role: 'developer' },
        ],
      }),
      'utf8'
    );

    vi.mocked(ClaudeBinaryResolver.resolve).mockResolvedValue('/fake/claude');
    const { child, writeSpy } = createFakeChild();
    vi.mocked(spawnCli).mockReturnValue(child as any);

    const svc = new TeamProvisioningService();
    (svc as any).buildProvisioningEnv = vi.fn(async () => ({
      env: { ANTHROPIC_API_KEY: 'test' },
      authSource: 'anthropic_api_key',
    }));
    (svc as any).normalizeTeamConfigForLaunch = vi.fn(async () => {});
    (svc as any).updateConfigProjectPath = vi.fn(async () => {});
    (svc as any).restorePrelaunchConfig = vi.fn(async () => {});
    (svc as any).assertConfigLeadOnlyForLaunch = vi.fn(async () => {});
    (svc as any).persistLaunchStateSnapshot = vi.fn(async () => {});
    (svc as any).resolveLaunchExpectedMembers = vi.fn(async () => ({
      members: [{ name: 'alice', role: 'developer' }],
      source: 'config-fallback',
      warning: undefined,
    }));
    (svc as any).validateAgentTeamsMcpRuntime = vi.fn(async () => {});
    (svc as any).startFilesystemMonitor = vi.fn();
    (svc as any).pathExists = vi.fn(async () => false);

    const { runId } = await svc.launchTeam(
      {
        teamName,
        cwd: process.cwd(),
        clearContext: true,
      },
      () => {}
    );

    expect(writeSpy).toHaveBeenCalledTimes(1);
    const prompt = extractPromptFromStreamJsonWrite(writeSpy);
    expect(prompt).toBeTruthy();
    expect(prompt.length).toBeGreaterThan(100);

    await svc.cancelProvisioning(runId);
  });

  it('launchTeam reconnect prompt for teammates includes explicit hidden-instruction block rules', async () => {
    const teamName = 'multi-team-launch';
    const teamDir = path.join(tempTeamsBase, teamName);
    fs.mkdirSync(teamDir, { recursive: true });
    fs.writeFileSync(
      path.join(teamDir, 'config.json'),
      JSON.stringify({
        name: teamName,
        description: 'Multi team prompt test',
        members: [
          { name: 'lead', agentType: 'lead' },
          { name: 'alice', agentType: 'teammate', role: 'developer' },
        ],
      }),
      'utf8'
    );

    vi.mocked(ClaudeBinaryResolver.resolve).mockResolvedValue('/fake/claude');
    const { child, writeSpy } = createFakeChild();
    vi.mocked(spawnCli).mockReturnValue(child as any);

    const svc = new TeamProvisioningService();
    (svc as any).buildProvisioningEnv = vi.fn(async () => ({
      env: { ANTHROPIC_API_KEY: 'test' },
      authSource: 'anthropic_api_key',
    }));
    (svc as any).normalizeTeamConfigForLaunch = vi.fn(async () => {});
    (svc as any).updateConfigProjectPath = vi.fn(async () => {});
    (svc as any).restorePrelaunchConfig = vi.fn(async () => {});
    (svc as any).assertConfigLeadOnlyForLaunch = vi.fn(async () => {});
    (svc as any).persistLaunchStateSnapshot = vi.fn(async () => {});
    (svc as any).resolveLaunchExpectedMembers = vi.fn(async () => ({
      members: [{ name: 'alice', role: 'developer' }],
      source: 'config-fallback',
      warning: undefined,
    }));
    (svc as any).validateAgentTeamsMcpRuntime = vi.fn(async () => {});
    (svc as any).pathExists = vi.fn(async () => false);
    (svc as any).startFilesystemMonitor = vi.fn();

    const { runId } = await svc.launchTeam(
      {
        teamName,
        cwd: process.cwd(),
        clearContext: true,
      } as any,
      () => {}
    );

    expect(writeSpy).toHaveBeenCalledTimes(1);
    const prompt = extractPromptFromStreamJsonWrite(writeSpy);
    expect(prompt).toBeTruthy();
    expect(prompt).toContain(teamName);
    expect(prompt).toContain(AGENT_BLOCK_OPEN);
    expect(prompt).toContain(AGENT_BLOCK_CLOSE);
    expect(prompt).toContain('task_create_from_message');
    expect(prompt).toContain('task_set_owner');
    expect(prompt).toContain('cross_team_send');
    expect(prompt).toContain('lead_briefing');
    expect(prompt).toContain('task_list');
    expect(prompt).toContain('review_start');
    expect(prompt).toContain('review_approve');
    expect(prompt).toContain('review_request_changes');
    expect(prompt).toContain(teamName);
    await svc.cancelProvisioning(runId);
  });

  it('launchTeam materializes an explicit Codex default model for launch teammates before bootstrap spawn', async () => {
    const teamName = 'codex-default-launch';
    const teamDir = path.join(tempTeamsBase, teamName);
    fs.mkdirSync(teamDir, { recursive: true });
    fs.writeFileSync(
      path.join(teamDir, 'config.json'),
      JSON.stringify({
        name: teamName,
        members: [
          { name: 'lead', agentType: 'lead', providerId: 'codex' },
          { name: 'alice', agentType: 'teammate', role: 'developer', providerId: 'codex' },
        ],
      }),
      'utf8'
    );

    vi.mocked(ClaudeBinaryResolver.resolve).mockResolvedValue('/fake/claude');
    const { child, writeSpy } = createFakeChild();
    vi.mocked(spawnCli).mockReturnValue(child as any);

    const svc = new TeamProvisioningService();
    preserveProviderRequest(svc);
    (svc as any).buildProvisioningEnv = vi.fn(async () => ({
      env: { PATH: '/usr/bin' },
      authSource: 'codex_runtime',
      geminiRuntimeAuth: null,
    }));
    (svc as any).normalizeTeamConfigForLaunch = vi.fn(async () => {});
    (svc as any).updateConfigProjectPath = vi.fn(async () => {});
    (svc as any).restorePrelaunchConfig = vi.fn(async () => {});
    (svc as any).assertConfigLeadOnlyForLaunch = vi.fn(async () => {});
    (svc as any).persistLaunchStateSnapshot = vi.fn(async () => {});
    (svc as any).resolveLaunchExpectedMembers = vi.fn(async () => ({
      members: [{ name: 'alice', role: 'developer', providerId: 'codex', isolation: 'worktree' }],
      source: 'config-fallback',
      warning: undefined,
    }));
    (svc as any).validateAgentTeamsMcpRuntime = vi.fn(async () => {});
    (svc as any).pathExists = vi.fn(async () => false);
    (svc as any).startFilesystemMonitor = vi.fn();

    const { runId } = await svc.launchTeam(
      {
        teamName,
        cwd: process.cwd(),
        providerId: 'codex',
        clearContext: true,
      } as any,
      () => {}
    );

    const prompt = extractPromptFromStreamJsonWrite(writeSpy);
    expect(prompt).toContain('team_name="codex-default-launch", name="alice"');
    expect(prompt).toContain('provider="codex", model="gpt-5.4"');

    await svc.cancelProvisioning(runId);
  });

  it('forwards codex provider launch overrides into launchTeam runtime args', async () => {
    const teamName = 'codex-launch-forced-login';
    const teamDir = path.join(tempTeamsBase, teamName);
    fs.mkdirSync(teamDir, { recursive: true });
    fs.writeFileSync(
      path.join(teamDir, 'config.json'),
      JSON.stringify({
        name: teamName,
        members: [
          { name: 'lead', agentType: 'lead', providerId: 'codex' },
          { name: 'alice', agentType: 'teammate', role: 'developer', providerId: 'codex' },
        ],
      }),
      'utf8'
    );

    vi.mocked(ClaudeBinaryResolver.resolve).mockResolvedValue('/fake/codex');
    const { child, writeSpy } = createFakeChild();
    vi.mocked(spawnCli).mockReturnValue(child as any);

    const svc = new TeamProvisioningService();
    preserveProviderRequest(svc);
    (svc as any).buildProvisioningEnv = vi.fn(async () => ({
      env: {},
      authSource: 'codex_runtime',
      geminiRuntimeAuth: null,
      providerArgs: ['--settings', '{"codex":{"forced_login_method":"chatgpt"}}'],
    }));
    (svc as any).readRuntimeProviderLaunchFacts = vi.fn(async () => ({
      defaultModel: 'gpt-5.4',
      modelIds: new Set(['gpt-5.4']),
      modelCatalog: null,
      runtimeCapabilities: null,
      providerStatus: null,
    }));
    (svc as any).normalizeTeamConfigForLaunch = vi.fn(async () => {});
    (svc as any).updateConfigProjectPath = vi.fn(async () => {});
    (svc as any).restorePrelaunchConfig = vi.fn(async () => {});
    (svc as any).assertConfigLeadOnlyForLaunch = vi.fn(async () => {});
    (svc as any).persistLaunchStateSnapshot = vi.fn(async () => {});
    (svc as any).resolveLaunchExpectedMembers = vi.fn(async () => ({
      members: [{ name: 'alice', role: 'developer', providerId: 'codex', isolation: 'worktree' }],
      source: 'config-fallback',
      warning: undefined,
    }));
    (svc as any).validateAgentTeamsMcpRuntime = vi.fn(async () => {});
    (svc as any).pathExists = vi.fn(async () => false);
    (svc as any).startFilesystemMonitor = vi.fn();

    const { runId } = await svc.launchTeam(
      {
        teamName,
        cwd: process.cwd(),
        providerId: 'codex',
        clearContext: true,
      } as any,
      () => {}
    );

    const launchArgs = vi.mocked(spawnCli).mock.calls[0]?.[1] as string[];
    expect(launchArgs).toEqual(
      expect.arrayContaining(['--settings', '{"codex":{"forced_login_method":"chatgpt"}}'])
    );
    const prompt = extractPromptFromStreamJsonWrite(writeSpy);
    expect(prompt).toContain('team_name="codex-launch-forced-login", name="alice"');
    expect(prompt).toContain('provider="codex", model="gpt-5.4", isolation="worktree"');

    await svc.cancelProvisioning(runId);
  });
});
