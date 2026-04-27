import type { TmuxInstallerPhase } from '@features/tmux-installer/contracts';
import type { TmuxPlatform } from '@features/tmux-installer/contracts';

export function formatTmuxInstallerTitle(phase: TmuxInstallerPhase): string {
  if (phase === 'preparing' || phase === 'checking') return '正在准备安装 tmux';
  if (phase === 'pending_external_elevation') return '等待管理员操作';
  if (phase === 'waiting_for_external_step') return '请完成外部安装步骤';
  if (phase === 'installing') return '正在安装 tmux';
  if (phase === 'verifying') return '正在验证 tmux 安装';
  if (phase === 'needs_restart') return '需要重启后继续 tmux 设置';
  if (phase === 'error') return 'tmux 安装失败';
  if (phase === 'needs_manual_step') return 'tmux 需要手动处理';
  if (phase === 'completed') return 'tmux 已安装';
  if (phase === 'cancelled') return 'tmux 安装已取消';
  return 'tmux 未安装';
}

export function formatInstallButtonLabel(phase: TmuxInstallerPhase): string {
  if (phase === 'error') return '重试安装';
  if (phase === 'needs_manual_step') return '重新检查';
  if (phase === 'needs_restart') return '重启后重新检查';
  if (
    phase === 'preparing' ||
    phase === 'checking' ||
    phase === 'pending_external_elevation' ||
    phase === 'waiting_for_external_step' ||
    phase === 'installing' ||
    phase === 'verifying'
  ) {
    return '正在安装...';
  }
  return '安装 tmux';
}

export function formatTmuxInstallerProgress(phase: TmuxInstallerPhase): number | null {
  if (phase === 'checking') return 8;
  if (phase === 'preparing') return 18;
  if (phase === 'requesting_privileges') return 32;
  if (phase === 'pending_external_elevation') return 32;
  if (phase === 'waiting_for_external_step') return 48;
  if (phase === 'installing') return 68;
  if (phase === 'verifying') return 90;
  if (phase === 'needs_restart') return 96;
  if (phase === 'completed') return 100;
  if (phase === 'needs_manual_step') return 82;
  if (phase === 'error') return 100;
  if (phase === 'cancelled') return 0;
  return null;
}

export function formatTmuxPlatformLabel(platform: TmuxPlatform | null): string | null {
  if (platform === 'darwin') return 'macOS';
  if (platform === 'linux') return 'Linux';
  if (platform === 'win32') return 'Windows';
  if (platform === 'unknown') return '未知系统';
  return null;
}

export function formatTmuxLocationLabel(location: 'host' | 'wsl' | null): string | null {
  if (location === 'host') return '主机运行时';
  if (location === 'wsl') return 'WSL 运行时';
  return null;
}

export function formatTmuxOptionalBenefits(platform: TmuxPlatform | null): string | null {
  if (!platform) {
    return null;
  }

  const mixedProviderLimit = '没有 tmux 时，混合不同提供商的多智能体团队可能会被阻止启动。';

  if (platform === 'win32') {
    return `可选，但建议安装。应用不依赖 tmux 也能运行；在 WSL 中使用 tmux 后，成员长时间运行更稳定，重启更干净，断线重连后的恢复也更可靠。${mixedProviderLimit}`;
  }

  return `可选，但建议安装。应用不依赖 tmux 也能运行；使用 tmux 后，成员长时间运行更稳定，重启更干净，断线重连后的恢复也更可靠。${mixedProviderLimit}`;
}
