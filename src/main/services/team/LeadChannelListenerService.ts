import { getAppDataPath, getTeamsBasePath } from '@main/utils/pathDecoder';
import { createLogger } from '@shared/utils/logger';
import * as Lark from '@larksuiteoapi/node-sdk';
import * as fs from 'fs';
import * as path from 'path';

import { atomicWriteAsync } from './atomicWrite';
import { TeamInboxWriter } from './TeamInboxWriter';
import { TeamConfigReader } from './TeamConfigReader';
import { withFileLock } from './fileLock';

import type {
  LeadChannelConfig,
  LeadChannelDefinition,
  GlobalLeadChannelSnapshot,
  LeadChannelSnapshot,
  LeadChannelStatus,
  SaveLeadChannelConfigRequest,
} from '@shared/types';
import { CANONICAL_LEAD_MEMBER_NAME, isLeadMember } from '@shared/utils/leadDetection';

const logger = createLogger('Service:LeadChannelListener');

const DEFAULT_CONFIG: LeadChannelConfig = {
  channels: [],
  feishu: {
    enabled: false,
    appId: '',
    appSecret: '',
  },
};

const CHANNEL_EVENT_LEDGER_MAX_ENTRIES = 2000;
const CHANNEL_EVENT_PROCESSING_STALE_MS = 10 * 60 * 1000;

interface LeadChannelEventLedgerEntry {
  eventKey: string;
  status: 'processing' | 'handled';
  firstSeenAt: string;
  lastSeenAt: string;
  updatedAt: string;
  channelId: string;
  messageId: string;
}

export interface LeadChannelInboundMessage {
  channelId: string;
  channelName: string;
  provider: 'feishu';
  chatId: string;
  senderId: string;
  messageId?: string;
  text: string;
  from: string;
}

function cloneDefaultConfig(): LeadChannelConfig {
  return JSON.parse(JSON.stringify(DEFAULT_CONFIG)) as LeadChannelConfig;
}

function createStoppedStatus(
  message: string | null = null,
  channel?: Pick<LeadChannelDefinition, 'id' | 'name'>
): LeadChannelStatus {
  return {
    running: false,
    state: 'stopped',
    message,
    startedAt: null,
    lastEventAt: null,
    channelId: channel?.id,
    channelName: channel?.name,
  };
}

function getLeadChannelConfigPath(teamName: string): string {
  return path.join(getTeamsBasePath(), teamName, 'lead-channel.json');
}

function getLeadChannelEventLedgerPath(teamName: string): string {
  return path.join(getTeamsBasePath(), teamName, 'lead-channel-events.json');
}

function getGlobalLeadChannelConfigPath(): string {
  return path.join(getAppDataPath(), 'lead-channels.json');
}

function normalizeConfig(input: unknown): LeadChannelConfig {
  const parsed = input && typeof input === 'object' ? (input as Partial<LeadChannelConfig>) : {};
  const feishu =
    parsed.feishu && typeof parsed.feishu === 'object'
      ? (parsed.feishu as Partial<LeadChannelConfig['feishu']>)
      : {};
  const legacyFeishu = {
    enabled: feishu.enabled === true,
    appId: typeof feishu.appId === 'string' ? feishu.appId.trim() : '',
    appSecret: typeof feishu.appSecret === 'string' ? feishu.appSecret.trim() : '',
  };
  const channels: LeadChannelDefinition[] = Array.isArray(parsed.channels)
    ? parsed.channels
        .map((channel): LeadChannelDefinition | null => {
          if (!channel || typeof channel !== 'object') return null;
          const row = channel as Partial<LeadChannelConfig['channels'][number]>;
          const provider = row.provider === 'webhook' ? 'webhook' : 'feishu';
          const id = typeof row.id === 'string' && row.id.trim() ? row.id.trim() : provider;
          const name =
            typeof row.name === 'string' && row.name.trim()
              ? row.name.trim()
              : provider === 'feishu'
                ? '飞书长连接'
                : '通用 Webhook';
          return {
            id,
            name,
            provider,
            enabled: row.enabled !== false,
            feishu: row.feishu ? normalizeConfig({ feishu: row.feishu }).feishu : undefined,
          };
        })
        .filter((channel): channel is LeadChannelDefinition => channel !== null)
    : [];
  if (channels.length === 0 && (legacyFeishu.appId || legacyFeishu.appSecret)) {
    channels.push({
      id: 'feishu-default',
      name: '飞书长连接',
      provider: 'feishu',
      enabled: legacyFeishu.enabled !== false,
      feishu: legacyFeishu,
    });
  }
  return { channels, feishu: legacyFeishu };
}

function extractFeishuText(event: unknown): string {
  const row = event as {
    message?: { content?: string; message_type?: string; chat_id?: string };
    sender?: { sender_id?: Record<string, string> };
  };
  const rawContent = row.message?.content;
  if (typeof rawContent !== 'string' || rawContent.trim().length === 0) {
    return `[飞书事件] 收到 ${row.message?.message_type ?? '未知'} 类型消息。`;
  }
  try {
    const parsed = JSON.parse(rawContent) as { text?: unknown };
    if (typeof parsed.text === 'string' && parsed.text.trim()) {
      return parsed.text.trim();
    }
  } catch {
    // Fall through to raw payload.
  }
  return rawContent;
}

export class LeadChannelListenerService {
  private readonly inboxWriter = new TeamInboxWriter();
  private readonly configReader = new TeamConfigReader();
  private readonly wsClientByTeamChannel = new Map<string, InstanceType<typeof Lark.WSClient>>();
  private readonly apiClientByTeamChannel = new Map<string, InstanceType<typeof Lark.Client>>();
  private readonly statusByTeamChannel = new Map<string, Map<string, LeadChannelStatus>>();
  private readonly connectingHintTimerByTeamChannel = new Map<string, NodeJS.Timeout>();
  private inboundMessageHandler:
    | ((teamName: string, message: LeadChannelInboundMessage) => boolean | Promise<boolean>)
    | null = null;

  setInboundMessageHandler(
    handler:
      | ((teamName: string, message: LeadChannelInboundMessage) => boolean | Promise<boolean>)
      | null
  ): void {
    this.inboundMessageHandler = handler;
  }

  async getSnapshot(teamName: string): Promise<LeadChannelSnapshot> {
    return {
      config: await this.readConfig(teamName),
      status: this.getStatus(teamName),
      statusesByChannel: this.getStatusesByChannel(teamName),
    };
  }

  async getGlobalSnapshot(): Promise<GlobalLeadChannelSnapshot> {
    return { config: await this.readGlobalConfig() };
  }

  async saveGlobalConfig(
    request: SaveLeadChannelConfigRequest
  ): Promise<GlobalLeadChannelSnapshot> {
    const config = normalizeConfig(request);
    const configPath = getGlobalLeadChannelConfigPath();
    await fs.promises.mkdir(path.dirname(configPath), { recursive: true });
    await atomicWriteAsync(configPath, `${JSON.stringify(config, null, 2)}\n`);
    return this.getGlobalSnapshot();
  }

  async saveConfig(
    teamName: string,
    request: SaveLeadChannelConfigRequest
  ): Promise<LeadChannelSnapshot> {
    const config = normalizeConfig(request);
    const configPath = getLeadChannelConfigPath(teamName);
    await fs.promises.mkdir(path.dirname(configPath), { recursive: true });
    await atomicWriteAsync(configPath, `${JSON.stringify(config, null, 2)}\n`);
    return this.getSnapshot(teamName);
  }

  async startFeishu(teamName: string, channelId?: string): Promise<LeadChannelSnapshot> {
    const teamConfig = await this.readConfig(teamName);
    const globalConfig = await this.readGlobalConfig();
    const config =
      teamConfig.feishu.appId.trim() || teamConfig.feishu.appSecret.trim()
        ? teamConfig
        : globalConfig;
    const feishuChannels = config.channels.filter(
      (channel) => channel.provider === 'feishu' && channel.enabled !== false
    );
    const feishuChannel = channelId
      ? (feishuChannels.find((channel) => channel.id === channelId) ?? null)
      : (feishuChannels[0] ?? null);
    const feishuConfig = feishuChannel?.feishu ?? config.feishu;
    const appId = feishuConfig.appId.trim();
    const appSecret = feishuConfig.appSecret.trim();
    if (!appId || !appSecret) {
      throw new Error('请先填写飞书 App ID 和 App Secret。');
    }
    const channel: LeadChannelDefinition = feishuChannel ?? {
      id: channelId?.trim() || 'feishu-default',
      name: '飞书长连接',
      provider: 'feishu',
      enabled: true,
      feishu: feishuConfig,
    };

    await this.stopFeishu(teamName, channel.id);
    this.clearConnectingHint(teamName, channel.id);
    this.setStatus(teamName, channel.id, {
      running: true,
      state: 'connecting',
      message: `正在连接 ${channel.name}...`,
      startedAt: new Date().toISOString(),
      lastEventAt: null,
      channelId: channel.id,
      channelName: channel.name,
    });
    this.scheduleConnectingHint(teamName, channel);

    const wsClient = new Lark.WSClient({
      appId,
      appSecret,
      loggerLevel: Lark.LoggerLevel.info,
      autoReconnect: true,
      source: 'multi-agent-teams',
      onReady: () => {
        this.clearConnectingHint(teamName, channel.id);
        this.patchStatus(teamName, channel.id, {
          running: true,
          state: 'connected',
          message: `${channel.name} 已连接。`,
        });
      },
      onReconnecting: () => {
        this.patchStatus(teamName, channel.id, {
          running: true,
          state: 'reconnecting',
          message: `${channel.name} 重连中...`,
        });
      },
      onReconnected: () => {
        this.clearConnectingHint(teamName, channel.id);
        this.patchStatus(teamName, channel.id, {
          running: true,
          state: 'connected',
          message: `${channel.name} 已重新连接。`,
        });
      },
      onError: (error) => {
        this.clearConnectingHint(teamName, channel.id);
        this.patchStatus(teamName, channel.id, {
          running: false,
          state: 'error',
          message: error.message,
        });
        logger.error(`[${teamName}/${channel.id}] Feishu WS error:`, error);
      },
    });
    const apiClient = new Lark.Client({ appId, appSecret });

    const eventDispatcher = new Lark.EventDispatcher({}).register({
      'im.message.receive_v1': async (data: unknown) => {
        const text = extractFeishuText(data);
        const event = data as {
          message?: { chat_id?: string; message_id?: string };
          sender?: { sender_id?: Record<string, string> };
        };
        const chatId = event.message?.chat_id ?? 'unknown-chat';
        const senderId =
          event.sender?.sender_id?.open_id ?? event.sender?.sender_id?.user_id ?? 'unknown-sender';
        const inboundMessage: LeadChannelInboundMessage = {
          channelId: channel.id,
          channelName: channel.name,
          provider: 'feishu',
          chatId,
          senderId,
          messageId: event.message?.message_id
            ? `${channel.id}:${event.message.message_id}`
            : undefined,
          text,
          from: `${channel.name}:${senderId}`,
        };
        const eventClaim = await this.claimInboundEvent(teamName, channel.id, inboundMessage);
        if (!eventClaim.shouldProcess) {
          this.patchStatus(teamName, channel.id, {
            running: true,
            state: 'connected',
            message: `${channel.name} 已忽略飞书重复消息。`,
            lastEventAt: new Date().toISOString(),
          });
          return;
        }
        const deliveredDirect =
          (await Promise.resolve(this.inboundMessageHandler?.(teamName, inboundMessage)).catch(
            (error: unknown) => {
              logger.warn(
                `[${teamName}/${channel.id}] Direct channel delivery failed: ${String(error)}`
              );
              return false;
            }
          )) === true;
        const leadName = await this.resolveLeadName(teamName);
        if (!deliveredDirect) {
          await this.inboxWriter.sendMessage(teamName, {
            member: leadName,
            to: leadName,
            from: inboundMessage.from,
            text: `[${channel.name}]\n聊天：${chatId}\n\n${text}`,
            messageId: inboundMessage.messageId,
            source: 'inbox',
            actionMode: 'ask',
            externalChannel: {
              provider: 'feishu',
              channelId: channel.id,
              channelName: channel.name,
              chatId,
              senderId,
            },
          });
        }
        if (eventClaim.eventKey) {
          await this.markInboundEventHandled(teamName, eventClaim.eventKey);
        }
        this.patchStatus(teamName, channel.id, {
          running: true,
          state: 'connected',
          message: deliveredDirect
            ? `${channel.name} 已接收消息并直达负责人。`
            : `${channel.name} 已接收消息并转入负责人。`,
          lastEventAt: new Date().toISOString(),
        });
      },
    });

    this.wsClientByTeamChannel.set(this.getTeamChannelKey(teamName, channel.id), wsClient);
    this.apiClientByTeamChannel.set(this.getTeamChannelKey(teamName, channel.id), apiClient);
    await wsClient.start({ eventDispatcher });
    return this.getSnapshot(teamName);
  }

  async sendFeishuReply(
    teamName: string,
    channelId: string,
    chatId: string,
    text: string
  ): Promise<void> {
    const client = await this.getFeishuApiClient(teamName, channelId);
    await client.im.message.create({
      params: {
        receive_id_type: 'chat_id',
      },
      data: {
        receive_id: chatId,
        content: JSON.stringify({ text }),
        msg_type: 'text',
      },
    });
    this.patchStatus(teamName, channelId, {
      running: true,
      state: 'connected',
      message: '负责人回复已发送到飞书。',
      lastEventAt: new Date().toISOString(),
    });
  }

  async stopFeishu(teamName: string, channelId?: string): Promise<LeadChannelSnapshot> {
    if (!channelId) {
      const prefix = `${teamName}:`;
      for (const [key, wsClient] of this.wsClientByTeamChannel.entries()) {
        if (!key.startsWith(prefix)) continue;
        wsClient.close({ force: true });
        this.wsClientByTeamChannel.delete(key);
        this.apiClientByTeamChannel.delete(key);
        const id = key.slice(prefix.length);
        this.clearConnectingHint(teamName, id);
        this.setStatus(teamName, id, createStoppedStatus('飞书长连接已停止。', { id, name: id }));
      }
      return this.getSnapshot(teamName);
    }

    const key = this.getTeamChannelKey(teamName, channelId);
    const wsClient = this.wsClientByTeamChannel.get(key);
    if (wsClient) {
      wsClient.close({ force: true });
      this.wsClientByTeamChannel.delete(key);
    }
    this.apiClientByTeamChannel.delete(key);
    this.clearConnectingHint(teamName, channelId);
    this.setStatus(
      teamName,
      channelId,
      createStoppedStatus('飞书长连接已停止。', { id: channelId, name: channelId })
    );
    return this.getSnapshot(teamName);
  }

  private async readConfig(teamName: string): Promise<LeadChannelConfig> {
    try {
      const raw = await fs.promises.readFile(getLeadChannelConfigPath(teamName), 'utf8');
      return normalizeConfig(JSON.parse(raw) as unknown);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return cloneDefaultConfig();
      }
      throw error;
    }
  }

  private async readGlobalConfig(): Promise<LeadChannelConfig> {
    try {
      const raw = await fs.promises.readFile(getGlobalLeadChannelConfigPath(), 'utf8');
      return normalizeConfig(JSON.parse(raw) as unknown);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return cloneDefaultConfig();
      }
      throw error;
    }
  }

  private getStatus(teamName: string): LeadChannelStatus {
    const statuses = Object.values(this.getStatusesByChannel(teamName));
    return (
      statuses.find((status) => status.running) ??
      statuses.find((status) => status.state === 'error') ??
      createStoppedStatus()
    );
  }

  private getStatusesByChannel(teamName: string): Record<string, LeadChannelStatus> {
    return Object.fromEntries(this.statusByTeamChannel.get(teamName)?.entries() ?? []);
  }

  private setStatus(teamName: string, channelId: string, status: LeadChannelStatus): void {
    const statuses = this.statusByTeamChannel.get(teamName) ?? new Map<string, LeadChannelStatus>();
    statuses.set(channelId, status);
    this.statusByTeamChannel.set(teamName, statuses);
  }

  private patchStatus(
    teamName: string,
    channelId: string,
    patch: Partial<LeadChannelStatus>
  ): void {
    const current =
      this.statusByTeamChannel.get(teamName)?.get(channelId) ??
      createStoppedStatus(null, { id: channelId, name: channelId });
    this.setStatus(teamName, channelId, { ...current, ...patch });
  }

  private getTeamChannelKey(teamName: string, channelId: string): string {
    return `${teamName}:${channelId}`;
  }

  private async resolveLeadName(teamName: string): Promise<string> {
    const config = await this.configReader.getConfig(teamName).catch(() => null);
    return (
      config?.members?.find((member) => isLeadMember(member))?.name?.trim() ||
      CANONICAL_LEAD_MEMBER_NAME
    );
  }

  private async getFeishuApiClient(
    teamName: string,
    channelId: string
  ): Promise<InstanceType<typeof Lark.Client>> {
    const key = this.getTeamChannelKey(teamName, channelId);
    const existing = this.apiClientByTeamChannel.get(key);
    if (existing) return existing;

    const globalConfig = await this.readGlobalConfig();
    const teamConfig = await this.readConfig(teamName);
    const config =
      teamConfig.feishu.appId.trim() || teamConfig.feishu.appSecret.trim()
        ? teamConfig
        : globalConfig;
    const channel = config.channels.find(
      (item) => item.id === channelId && item.provider === 'feishu'
    );
    const feishuConfig = channel?.feishu ?? config.feishu;
    const appId = feishuConfig.appId.trim();
    const appSecret = feishuConfig.appSecret.trim();
    if (!appId || !appSecret) {
      throw new Error('无法发送飞书回复：渠道配置缺少 App ID 或 App Secret。');
    }
    const client = new Lark.Client({ appId, appSecret });
    this.apiClientByTeamChannel.set(key, client);
    return client;
  }

  private async claimInboundEvent(
    teamName: string,
    channelId: string,
    message: LeadChannelInboundMessage
  ): Promise<{ eventKey: string | null; shouldProcess: boolean }> {
    const messageId = message.messageId?.trim();
    if (!messageId) {
      return { eventKey: null, shouldProcess: true };
    }

    const eventKey = `${channelId}:${messageId}`;
    const ledgerPath = getLeadChannelEventLedgerPath(teamName);
    const now = new Date();
    const nowIso = now.toISOString();
    let shouldProcess = true;

    await withFileLock(ledgerPath, async () => {
      const ledger = await this.readInboundEventLedger(ledgerPath);
      const existing = ledger.find((entry) => entry.eventKey === eventKey);
      if (existing) {
        existing.lastSeenAt = nowIso;
        const updatedAtMs = Date.parse(existing.updatedAt);
        const isStaleProcessing =
          existing.status === 'processing' &&
          Number.isFinite(updatedAtMs) &&
          now.getTime() - updatedAtMs > CHANNEL_EVENT_PROCESSING_STALE_MS;
        if (existing.status === 'handled' || !isStaleProcessing) {
          shouldProcess = false;
        } else {
          existing.status = 'processing';
          existing.updatedAt = nowIso;
        }
      } else {
        ledger.push({
          eventKey,
          status: 'processing',
          firstSeenAt: nowIso,
          lastSeenAt: nowIso,
          updatedAt: nowIso,
          channelId,
          messageId,
        });
      }
      await this.writeInboundEventLedger(ledgerPath, ledger);
    });

    return { eventKey, shouldProcess };
  }

  private async markInboundEventHandled(teamName: string, eventKey: string): Promise<void> {
    const ledgerPath = getLeadChannelEventLedgerPath(teamName);
    const nowIso = new Date().toISOString();
    await withFileLock(ledgerPath, async () => {
      const ledger = await this.readInboundEventLedger(ledgerPath);
      const existing = ledger.find((entry) => entry.eventKey === eventKey);
      if (existing) {
        existing.status = 'handled';
        existing.updatedAt = nowIso;
        existing.lastSeenAt = nowIso;
      }
      await this.writeInboundEventLedger(ledgerPath, ledger);
    });
  }

  private async readInboundEventLedger(ledgerPath: string): Promise<LeadChannelEventLedgerEntry[]> {
    try {
      const raw = await fs.promises.readFile(ledgerPath, 'utf8');
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) return [];
      return parsed.filter((entry): entry is LeadChannelEventLedgerEntry => {
        if (!entry || typeof entry !== 'object') return false;
        const row = entry as Partial<LeadChannelEventLedgerEntry>;
        return (
          typeof row.eventKey === 'string' &&
          (row.status === 'processing' || row.status === 'handled') &&
          typeof row.firstSeenAt === 'string' &&
          typeof row.lastSeenAt === 'string' &&
          typeof row.updatedAt === 'string' &&
          typeof row.channelId === 'string' &&
          typeof row.messageId === 'string'
        );
      });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return [];
      }
      throw error;
    }
  }

  private async writeInboundEventLedger(
    ledgerPath: string,
    ledger: LeadChannelEventLedgerEntry[]
  ): Promise<void> {
    const trimmed = ledger
      .slice()
      .sort((a, b) => Date.parse(a.updatedAt) - Date.parse(b.updatedAt))
      .slice(-CHANNEL_EVENT_LEDGER_MAX_ENTRIES);
    await fs.promises.mkdir(path.dirname(ledgerPath), { recursive: true });
    await atomicWriteAsync(ledgerPath, `${JSON.stringify(trimmed, null, 2)}\n`);
  }

  private scheduleConnectingHint(
    teamName: string,
    channel: Pick<LeadChannelDefinition, 'id' | 'name'>
  ): void {
    const key = this.getTeamChannelKey(teamName, channel.id);
    const timer = setTimeout(() => {
      const status = this.statusByTeamChannel.get(teamName)?.get(channel.id);
      if (!status || (status.state !== 'connecting' && status.state !== 'reconnecting')) return;
      this.patchStatus(teamName, channel.id, {
        message: `${channel.name} 仍在等待飞书 ready 回调。若持续超过 30 秒，请检查飞书后台长连接开关、App ID/Secret 和事件订阅。`,
      });
    }, 12_000);
    this.connectingHintTimerByTeamChannel.set(key, timer);
  }

  private clearConnectingHint(teamName: string, channelId: string): void {
    const key = this.getTeamChannelKey(teamName, channelId);
    const timer = this.connectingHintTimerByTeamChannel.get(key);
    if (timer) {
      clearTimeout(timer);
      this.connectingHintTimerByTeamChannel.delete(key);
    }
  }
}

let singleton: LeadChannelListenerService | null = null;

export function getLeadChannelListenerService(): LeadChannelListenerService {
  singleton ??= new LeadChannelListenerService();
  return singleton;
}
