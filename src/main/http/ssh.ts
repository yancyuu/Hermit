/**
 * HTTP route handlers for SSH Connection Management.
 *
 * Routes:
 * - POST /api/ssh/connect - Connect to SSH host
 * - POST /api/ssh/disconnect - Disconnect SSH
 * - GET /api/ssh/state - Get connection state
 * - POST /api/ssh/test - Test connection
 * - GET /api/ssh/config-hosts - Get SSH config hosts
 * - POST /api/ssh/resolve-host - Resolve host config
 * - POST /api/ssh/save-last-connection - Save last connection
 * - GET /api/ssh/last-connection - Get last connection
 */

import { createLogger } from '@shared/utils/logger';

import { ConfigManager } from '../services/infrastructure/ConfigManager';
import { MachineRegistryService } from '../services/infrastructure/MachineRegistryService';

import type {
  SshConnectionConfig,
  SshConnectionManager,
} from '../services/infrastructure/SshConnectionManager';
import type { SshLastConnection } from '@shared/types';
import type { MachineProfile } from '@shared/types/api';
import type { FastifyInstance } from 'fastify';

const logger = createLogger('HTTP:ssh');

export function registerSshRoutes(
  app: FastifyInstance,
  connectionManager: SshConnectionManager,
  modeSwitchCallback: (mode: 'local' | 'ssh') => Promise<void>
): void {
  const configManager = ConfigManager.getInstance();
  const machineRegistry = new MachineRegistryService(connectionManager);

  // Connect
  app.post<{ Body: SshConnectionConfig }>('/api/ssh/connect', async (request) => {
    try {
      await connectionManager.connect(request.body);
      await modeSwitchCallback('ssh');
      return { success: true, data: connectionManager.getStatus() };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error('SSH connect failed:', message);
      return { success: false, error: message };
    }
  });

  // Disconnect
  app.post('/api/ssh/disconnect', async () => {
    try {
      connectionManager.disconnect();
      await modeSwitchCallback('local');
      return { success: true, data: connectionManager.getStatus() };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error('SSH disconnect failed:', message);
      return { success: false, error: message };
    }
  });

  // Get state
  app.get('/api/ssh/state', async () => {
    return connectionManager.getStatus();
  });

  // Test connection
  app.post<{ Body: SshConnectionConfig }>('/api/ssh/test', async (request) => {
    try {
      const result = await connectionManager.testConnection(request.body);
      return { success: true, data: result };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, error: message };
    }
  });

  app.get('/api/ssh/machines', async () => {
    try {
      return { success: true, data: machineRegistry.listMachines() };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, error: message };
    }
  });

  app.post<{ Body: MachineProfile }>('/api/ssh/machines', async (request) => {
    try {
      return { success: true, data: machineRegistry.saveMachine(request.body) };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, error: message };
    }
  });

  app.delete<{ Params: { machineId: string } }>('/api/ssh/machines/:machineId', async (request) => {
    try {
      return { success: true, data: machineRegistry.removeMachine(request.params.machineId) };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, error: message };
    }
  });

  app.post<{ Params: { machineId: string } }>(
    '/api/ssh/machines/:machineId/check',
    async (request) => {
      try {
        return {
          success: true,
          data: await machineRegistry.checkMachine(request.params.machineId),
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { success: false, error: message };
      }
    }
  );

  app.get<{ Params: { machineId: string } }>(
    '/api/ssh/machines/:machineId/processes',
    async (request) => {
      try {
        return {
          success: true,
          data: await machineRegistry.listProcesses(request.params.machineId),
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { success: false, error: message };
      }
    }
  );

  app.post<{ Params: { machineId: string }; Body: { pid: number } }>(
    '/api/ssh/machines/:machineId/processes/stop',
    async (request) => {
      try {
        await machineRegistry.stopProcess(request.params.machineId, request.body.pid);
        return { success: true };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { success: false, error: message };
      }
    }
  );

  // Get config hosts
  app.get('/api/ssh/config-hosts', async () => {
    try {
      const hosts = await connectionManager.getConfigHosts();
      return { success: true, data: hosts };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error('Failed to get SSH config hosts:', message);
      return { success: true, data: [] };
    }
  });

  // Resolve host
  app.post<{ Body: { alias: string } }>('/api/ssh/resolve-host', async (request) => {
    try {
      const entry = await connectionManager.resolveHostConfig(request.body.alias);
      return { success: true, data: entry };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error(`Failed to resolve SSH host "${request.body.alias}":`, message);
      return { success: true, data: null };
    }
  });

  // Save last connection
  app.post<{ Body: SshLastConnection }>('/api/ssh/save-last-connection', async (request) => {
    try {
      const config = request.body;
      configManager.updateConfig('ssh', {
        lastConnection: {
          host: config.host,
          port: config.port,
          username: config.username,
          authMethod: config.authMethod,
          privateKeyPath: config.privateKeyPath,
        },
      });
      return { success: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error('Failed to save SSH connection:', message);
      return { success: false, error: message };
    }
  });

  // Get last connection
  app.get('/api/ssh/last-connection', async () => {
    try {
      const config = configManager.getConfig();
      return { success: true, data: config.ssh.lastConnection };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error('Failed to get last SSH connection:', message);
      return { success: true, data: null };
    }
  });
}
