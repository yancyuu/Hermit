/**
 * CliInstallWarningBanner — Global warning strip shown below the tab bar
 * when the configured runtime is unavailable.
 *
 * Hidden on Dashboard pages (which have their own detailed CliStatusBanner).
 * Only rendered in Electron mode.
 */

import { isElectronMode } from '@renderer/api';
import { useStore } from '@renderer/store';
import { AlertTriangle } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';

export const CliInstallWarningBanner = (): React.JSX.Element | null => {
  const cliStatus = useStore(useShallow((s) => s.cliStatus));
  const cliStatusLoading = useStore((s) => s.cliStatusLoading);
  const openDashboard = useStore((s) => s.openDashboard);

  // Returns a primitive boolean — minimizes re-renders
  const isDashboardFocused = useStore((s) => {
    const fp = s.paneLayout.panes.find((p) => p.id === s.paneLayout.focusedPaneId);
    if (!fp) return false;
    if (fp.tabs.length === 0) return false; // empty pane defaults to the Teams view
    return fp.tabs.find((t) => t.id === fp.activeTabId)?.type === 'dashboard';
  });

  // Hide when: not Electron, status not loaded yet, CLI installed, or dashboard is focused
  if (
    !isElectronMode() ||
    cliStatusLoading ||
    !cliStatus ||
    cliStatus.installed ||
    isDashboardFocused
  ) {
    return null;
  }

  return (
    <div
      className="flex items-center gap-2 border-b px-4 py-2"
      style={{
        backgroundColor: 'var(--warning-bg)',
        borderColor: 'var(--warning-border)',
        color: 'var(--warning-text)',
      }}
    >
      <AlertTriangle className="size-3.5 shrink-0" />
      <span className="text-xs">
        {cliStatus.binaryPath && cliStatus.launchError
          ? `已找到配置的 ${cliStatus.displayName}，但启动失败。请前往首页修复或重新安装。`
          : `尚未安装配置的 ${cliStatus.displayName}。请前往首页安装，以启用全部功能。`}
      </span>
      <button
        onClick={openDashboard}
        className="ml-auto shrink-0 rounded-md border px-2.5 py-1 text-xs font-medium transition-colors hover:bg-white/5"
        style={{
          borderColor: 'var(--warning-border)',
          color: 'var(--warning-text)',
        }}
      >
        前往首页
      </button>
    </div>
  );
};
