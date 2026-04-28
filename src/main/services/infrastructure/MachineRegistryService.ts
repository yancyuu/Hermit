import { createLogger } from '@shared/utils/logger';

import { configManager } from './ConfigManager';

import type { SshConnectionConfig, SshConnectionManager } from './SshConnectionManager';
import type {
  MachineProfile,
  MachineRuntimeProcess,
  MachineRuntimeKind,
  MachineRuntimeStatus,
} from '@shared/types/api';

const logger = createLogger('Infrastructure:MachineRegistryService');

const RUNTIME_COMMANDS: Record<MachineRuntimeKind, string> = {
  claude: 'claude',
  opencode: 'opencode',
  codex: 'codex',
};

export class MachineRegistryService {
  constructor(private readonly sshConnectionManager: SshConnectionManager) {}

  listMachines(): MachineProfile[] {
    return configManager.getMachineProfiles();
  }

  saveMachine(profile: MachineProfile): MachineProfile[] {
    const normalized: MachineProfile = {
      ...profile,
      name: profile.name || profile.displayName,
      displayName: profile.displayName || profile.name,
      runtimeStatus: profile.runtimeStatus ?? {
        claude: { state: 'unknown' },
      },
    };
    return configManager.saveMachineProfile(normalized);
  }

  removeMachine(machineId: string): MachineProfile[] {
    this.sshConnectionManager.disconnectMachine(machineId);
    return configManager.removeMachineProfile(machineId);
  }

  async checkMachine(machineId: string): Promise<MachineProfile> {
    const profile = this.listMachines().find((candidate) => candidate.id === machineId);
    if (!profile) {
      throw new Error(`Machine profile not found: ${machineId}`);
    }

    const config: SshConnectionConfig = {
      host: profile.host,
      port: profile.port,
      username: profile.username,
      authMethod: profile.authMethod,
      privateKeyPath: profile.privateKeyPath,
    };

    const connected = await this.sshConnectionManager.connectMachine(machineId, config);
    logger.info(`Machine ${machineId} connected for health check: ${connected.host}`);

    const runtimeStatus: MachineProfile['runtimeStatus'] = {};
    for (const kind of Object.keys(RUNTIME_COMMANDS) as MachineRuntimeKind[]) {
      runtimeStatus[kind] = await this.checkRuntime(machineId, kind);
    }

    const updated: MachineProfile = {
      ...profile,
      runtimeStatus,
      updatedAt: new Date().toISOString(),
    };
    configManager.saveMachineProfile(updated);
    return updated;
  }

  async listProcesses(machineId: string): Promise<MachineRuntimeProcess[]> {
    await this.ensureMachineConnected(machineId);
    const result = await this.sshConnectionManager.execOnMachine(
      machineId,
      "ps -eo pid=,lstart=,command= | grep -E '[c]laude|[o]pencode|[c]odex' | head -200"
    );
    const now = new Date().toISOString();
    const processes: MachineRuntimeProcess[] = [];
    for (const line of result.stdout
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)) {
      const match = line.match(/^(\d+)\s+(.+?)\s{1,}(.+)$/);
      if (!match) continue;
      const pid = Number(match[1]);
      if (!Number.isFinite(pid)) continue;
      processes.push({
        machineId,
        pid,
        startedAt: match[2],
        command: match[3],
        lastSeenAt: now,
      });
    }
    return processes;
  }

  async stopProcess(machineId: string, pid: number): Promise<void> {
    await this.ensureMachineConnected(machineId);
    if (!Number.isInteger(pid) || pid <= 0) {
      throw new Error('Invalid remote pid');
    }
    const result = await this.sshConnectionManager.execOnMachine(machineId, `kill ${pid}`);
    if (result.exitCode !== 0) {
      throw new Error(result.stderr.trim() || `Failed to stop remote process ${pid}`);
    }
  }

  private async ensureMachineConnected(machineId: string): Promise<MachineProfile> {
    const profile = this.listMachines().find((candidate) => candidate.id === machineId);
    if (!profile) {
      throw new Error(`Machine profile not found: ${machineId}`);
    }
    if (!this.sshConnectionManager.getMachineStatus(machineId)) {
      await this.sshConnectionManager.connectMachine(machineId, {
        host: profile.host,
        port: profile.port,
        username: profile.username,
        authMethod: profile.authMethod,
        privateKeyPath: profile.privateKeyPath,
      });
    }
    return profile;
  }

  private async checkRuntime(
    machineId: string,
    kind: MachineRuntimeKind
  ): Promise<MachineRuntimeStatus> {
    const binary = RUNTIME_COMMANDS[kind];
    const checkedAt = new Date().toISOString();
    try {
      const result = await this.sshConnectionManager.execOnMachine(
        machineId,
        `command -v ${binary} && ${binary} --version`
      );
      if (result.exitCode !== 0) {
        return {
          state: 'missing',
          checkedAt,
          loginState: 'unknown',
          error: result.stderr.trim() || `${binary} 未安装或不可执行`,
        };
      }

      const lines = result.stdout
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean);
      return {
        state: 'ready',
        checkedAt,
        binaryPath: lines[0],
        version: lines.slice(1).join(' ') || undefined,
        loginState: 'unknown',
      };
    } catch (error) {
      return {
        state: 'error',
        checkedAt,
        loginState: 'unknown',
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}
