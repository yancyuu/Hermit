import type { CliProviderAuthMode, CliProviderStatus } from '@shared/types';

const CODEX_NATIVE_LABEL = 'Codex native';
const ANTHROPIC_SUBSCRIPTION_LABEL = 'Anthropic 订阅';

const AUTH_MODE_LABELS: Record<CliProviderAuthMode, string> = {
  auto: '自动',
  oauth: '订阅 / OAuth',
  chatgpt: 'ChatGPT 账号',
  api_key: 'API 密钥',
};

export function formatProviderAuthModeLabel(authMode: CliProviderAuthMode | null): string | null {
  return authMode ? AUTH_MODE_LABELS[authMode] : null;
}

export function formatProviderAuthModeLabelForProvider(
  providerId: CliProviderStatus['providerId'],
  authMode: CliProviderAuthMode | null
): string | null {
  if (!authMode) {
    return null;
  }

  if (providerId === 'anthropic' && authMode === 'oauth') {
    return ANTHROPIC_SUBSCRIPTION_LABEL;
  }

  return formatProviderAuthModeLabel(authMode);
}

export function formatProviderAuthMethodLabel(authMethod: string | null): string {
  switch (authMethod) {
    case 'api_key':
      return 'API 密钥';
    case 'api_key_helper':
      return 'API 密钥助手';
    case 'oauth_token':
      return 'OAuth';
    case 'claude.ai':
      return 'Claude 订阅';
    case 'cli_oauth_personal':
      return 'Gemini CLI';
    case 'gemini_adc_authorized_user':
      return 'Google 账号';
    case 'gemini_adc_service_account':
      return '服务账号';
    default:
      return authMethod ? authMethod.replaceAll('_', ' ') : '未连接';
  }
}

export function formatProviderAuthMethodLabelForProvider(
  providerId: CliProviderStatus['providerId'],
  authMethod: string | null
): string {
  if (providerId === 'anthropic' && (authMethod === 'oauth_token' || authMethod === 'claude.ai')) {
    return ANTHROPIC_SUBSCRIPTION_LABEL;
  }

  return formatProviderAuthMethodLabel(authMethod);
}

function isCodexNativeLane(provider: CliProviderStatus): boolean {
  return (
    provider.providerId === 'codex' &&
    (provider.resolvedBackendId === 'codex-native' || provider.selectedBackendId === 'codex-native')
  );
}

function getSelectedRuntimeBackendOption(
  provider: CliProviderStatus
): NonNullable<CliProviderStatus['availableBackends']>[number] | null {
  const options = provider.availableBackends ?? [];
  if (options.length === 0) {
    return null;
  }

  const selectedBackendId = provider.selectedBackendId ?? null;
  const resolvedBackendId = provider.resolvedBackendId ?? null;

  return (
    options.find((option) => option.id === selectedBackendId) ??
    options.find((option) => option.id === resolvedBackendId) ??
    null
  );
}

export function isProviderInventoryOnlyFallback(provider: CliProviderStatus): boolean {
  return (
    provider.supported === false &&
    provider.authenticated === false &&
    provider.authMethod === null &&
    provider.verificationState === 'unknown' &&
    provider.models.length > 0 &&
    provider.backend == null &&
    (provider.availableBackends?.length ?? 0) === 0 &&
    provider.capabilities.teamLaunch === false
  );
}

export function isConnectionManagedRuntimeProvider(provider: CliProviderStatus): boolean {
  return provider.providerId === 'codex';
}

function getCodexCurrentRuntimeLabel(provider: CliProviderStatus): string {
  return CODEX_NATIVE_LABEL;
}

function getCodexApiKeyAvailabilitySummary(provider: CliProviderStatus): string | null {
  if (provider.providerId !== 'codex' || !provider.connection?.apiKeyConfigured) {
    return null;
  }

  if (provider.connection.apiKeySource === 'stored') {
    return '管理页中已有保存的 API 密钥';
  }

  return provider.connection.apiKeySourceLabel ?? '已配置 API 密钥';
}

function getCodexMissingManagedAccountStatus(provider: CliProviderStatus): string | null {
  if (provider.providerId !== 'codex') {
    return null;
  }

  const codexConnection = provider.connection?.codex;
  if (!codexConnection || codexConnection.managedAccount?.type === 'chatgpt') {
    return null;
  }

  if (provider.connection?.configuredAuthMode !== 'chatgpt') {
    return null;
  }

  if (codexConnection.requiresOpenaiAuth) {
    if (codexConnection.localActiveChatgptAccountPresent) {
      return 'Codex 本地已有选中的 ChatGPT 账号，但当前会话需要重新连接。';
    }

    return codexConnection.localAccountArtifactsPresent
      ? 'Codex CLI 报告没有活跃的 ChatGPT 登录。本地存在 Codex 账号数据，但未选中活跃托管会话。'
      : 'Codex CLI 报告没有活跃的 ChatGPT 登录';
  }

  return codexConnection.launchIssueMessage ?? '连接 ChatGPT 账号以使用你的 Codex 订阅。';
}

export function getProviderCurrentRuntimeSummary(provider: CliProviderStatus): string | null {
  if (provider.providerId !== 'codex' || !isConnectionManagedRuntimeProvider(provider)) {
    return null;
  }

  const prefix = provider.authenticated ? '当前运行时' : '所选运行时';
  return `${prefix}: ${getCodexCurrentRuntimeLabel(provider)}`;
}

export function formatProviderStatusText(provider: CliProviderStatus): string {
  if (isProviderInventoryOnlyFallback(provider)) {
    return '检查中...';
  }

  const selectedBackendOption = getSelectedRuntimeBackendOption(provider);

  if (provider.providerId === 'codex') {
    if (provider.connection?.codex?.login.status === 'starting') {
      return '正在启动 ChatGPT 登录...';
    }

    if (provider.connection?.codex?.login.status === 'pending') {
      return '等待 ChatGPT 账号登录...';
    }

    if (
      provider.connection?.codex?.login.status === 'failed' &&
      provider.connection.codex.login.error
    ) {
      return provider.connection.codex.login.error;
    }

    if (
      provider.connection?.codex?.appServerState === 'degraded' &&
      provider.connection.codex.effectiveAuthMode === 'chatgpt' &&
      provider.connection.codex.launchAllowed
    ) {
      return (
        provider.connection.codex.launchIssueMessage ??
        '已检测到 ChatGPT 账号，但账号验证当前处于降级状态。'
      );
    }

    if (provider.connection?.codex?.launchAllowed) {
      if (provider.connection.codex.effectiveAuthMode === 'chatgpt') {
        return 'ChatGPT 账号已就绪';
      }

      if (provider.connection.codex.effectiveAuthMode === 'api_key') {
        return 'API 密钥已就绪';
      }
    }

    const missingManagedAccountStatus = getCodexMissingManagedAccountStatus(provider);
    if (missingManagedAccountStatus) {
      return missingManagedAccountStatus;
    }

    if (provider.connection?.codex?.launchIssueMessage) {
      return provider.connection.codex.launchIssueMessage;
    }

    if (selectedBackendOption?.statusMessage) {
      return selectedBackendOption.statusMessage;
    }
    return provider.statusMessage ?? (provider.authenticated ? 'Codex 原生运行时已就绪' : '未连接');
  }

  if (
    isCodexNativeLane(provider) &&
    selectedBackendOption?.state &&
    selectedBackendOption.state !== 'ready'
  ) {
    return (
      selectedBackendOption.statusMessage ?? provider.statusMessage ?? 'Codex 原生运行时不可用'
    );
  }

  if (
    isCodexNativeLane(provider) &&
    selectedBackendOption?.audience === 'internal' &&
    selectedBackendOption.statusMessage
  ) {
    return selectedBackendOption.statusMessage;
  }

  if (!provider.supported) {
    return provider.statusMessage ?? '当前运行时不可用';
  }

  if (provider.authenticated) {
    return `已通过 ${formatProviderAuthMethodLabelForProvider(
      provider.providerId,
      provider.authMethod
    )}`;
  }

  if (provider.verificationState === 'offline') {
    return provider.statusMessage ?? '无法验证';
  }

  return provider.statusMessage ?? '未连接';
}

export function getProviderConnectionModeSummary(provider: CliProviderStatus): string | null {
  if (provider.providerId !== 'anthropic' && provider.providerId !== 'codex') {
    return null;
  }

  if (provider.providerId === 'anthropic') {
    if (provider.authenticated) {
      return null;
    }

    if (provider.connection?.configuredAuthMode === 'auto') {
      return null;
    }
  }

  if (provider.providerId === 'codex' && provider.connection?.configuredAuthMode === 'auto') {
    return null;
  }

  const authModeLabel = formatProviderAuthModeLabelForProvider(
    provider.providerId,
    provider.connection?.configuredAuthMode ?? null
  );
  if (!authModeLabel) {
    return null;
  }

  return provider.providerId === 'codex'
    ? `Selected auth: ${authModeLabel}`
    : `Preferred auth: ${authModeLabel}`;
}

export function getProviderCredentialSummary(provider: CliProviderStatus): string | null {
  if (!provider.connection?.apiKeyConfigured) {
    return null;
  }

  if (
    provider.providerId === 'anthropic' &&
    provider.connection.apiKeySource === 'stored' &&
    provider.connection.configuredAuthMode === 'auto'
  ) {
    return '管理中已有保存的 API 密钥';
  }

  if (provider.authMethod !== 'api_key' && provider.providerId === 'anthropic') {
    return provider.connection.apiKeySource === 'stored'
      ? '管理中也已配置 API 密钥'
      : (provider.connection.apiKeySourceLabel ?? 'API 密钥已配置');
  }

  if (provider.authMethod !== 'api_key' && provider.providerId === 'gemini') {
    return provider.connection.apiKeySource === 'stored'
      ? '管理中已配置 API 密钥'
      : (provider.connection.apiKeySourceLabel ?? 'API 密钥已配置');
  }

  if (provider.providerId === 'codex') {
    const apiKeyAvailabilitySummary = getCodexApiKeyAvailabilitySummary(provider);
    if (!apiKeyAvailabilitySummary) {
      return null;
    }

    if (
      provider.connection.codex?.managedAccount?.type === 'chatgpt' ||
      provider.connection.codex?.effectiveAuthMode === 'chatgpt'
    ) {
      return provider.connection.apiKeySource === 'stored'
        ? '管理中的 API 密钥也可作为备用'
        : `${apiKeyAvailabilitySummary} - 可作为备用`;
    }

    if (provider.connection.configuredAuthMode === 'chatgpt') {
      return provider.connection.apiKeySource === 'stored'
        ? '切换到 API 密钥模式后可使用管理中保存的 API 密钥'
        : `${apiKeyAvailabilitySummary} - 切换到 API 密钥模式后可用`;
    }

    if (provider.connection.configuredAuthMode === 'auto') {
      return `${apiKeyAvailabilitySummary} - 自动模式会在 ChatGPT 连接前使用它`;
    }

    return apiKeyAvailabilitySummary;
  }

  return provider.connection.apiKeySourceLabel ?? null;
}

export function getProviderDisconnectAction(provider: CliProviderStatus): {
  label: string;
  confirmLabel: string;
  title: string;
  message: string;
} | null {
  if (!provider.authenticated) {
    return null;
  }

  if (provider.providerId === 'anthropic') {
    if (provider.authMethod !== 'oauth_token' && provider.authMethod !== 'claude.ai') {
      return null;
    }

    return {
      label: '断开连接',
      confirmLabel: '断开连接',
      title: '断开 Anthropic 订阅？',
      message: provider.connection?.apiKeyConfigured
        ? '这会从 Claude CLI 运行时移除本地 Anthropic 订阅会话。管理中保存的 API 密钥仍会保留。'
        : '这会从 Claude CLI 运行时移除本地 Anthropic 订阅会话。',
    };
  }

  if (provider.providerId === 'gemini' && provider.authMethod === 'cli_oauth_personal') {
    return {
      label: '断开连接',
      confirmLabel: '断开连接',
      title: '断开 Gemini CLI？',
      message: '这会清除本地 Gemini CLI 会话元数据。外部 ADC 凭据和已保存 API 密钥不会被移除。',
    };
  }

  return null;
}

export function getProviderConnectLabel(provider: CliProviderStatus): string {
  if (provider.providerId === 'anthropic') {
    return '连接 Anthropic';
  }

  if (provider.providerId === 'codex') {
    return '连接 ChatGPT';
  }

  if (provider.providerId === 'gemini') {
    return '打开登录';
  }

  return '连接';
}

export function shouldShowProviderConnectAction(provider: CliProviderStatus): boolean {
  if (provider.providerId === 'codex') {
    return false;
  }

  if (!provider.canLoginFromUi || provider.authenticated) {
    return false;
  }

  if (provider.connection?.configuredAuthMode === 'api_key') {
    return false;
  }

  return true;
}
