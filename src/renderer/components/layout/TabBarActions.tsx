/**
 * TabBarActions - Right-side action buttons for the tab bar row.
 * Extracted from TabBar to render once (not per-pane).
 * Reads focused pane data from root store selectors (auto-synced via syncRootState).
 */

import { useMemo, useState } from 'react';

import { isElectronMode } from '@renderer/api';
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/components/ui/tooltip';
import { useStore } from '@renderer/store';
import { Bell, PanelRight } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';

import { MoreMenu } from './MoreMenu';

export const TabBarActions = (): React.JSX.Element => {
  const {
    unreadCount,
    openNotificationsTab,
    activeTabId,
    openTabs,
    tabSessionData,
    sidebarCollapsed,
    toggleSidebar,
    updateStatus,
    openUpdateDialog,
  } = useStore(
    useShallow((s) => ({
      unreadCount: s.unreadCount,
      openNotificationsTab: s.openNotificationsTab,
      activeTabId: s.activeTabId,
      openTabs: s.openTabs,
      tabSessionData: s.tabSessionData,
      sidebarCollapsed: s.sidebarCollapsed,
      toggleSidebar: s.toggleSidebar,
      updateStatus: s.updateStatus,
      openUpdateDialog: s.openUpdateDialog,
    }))
  );

  // Hover states for buttons
  const [notificationsHover, setNotificationsHover] = useState(false);
  const [githubHover, setGithubHover] = useState(false);
  const [expandHover, setExpandHover] = useState(false);
  const [updateHover, setUpdateHover] = useState(false);

  // Derive active tab and session detail for MoreMenu
  const activeTab = useMemo(
    () => openTabs.find((t) => t.id === activeTabId),
    [openTabs, activeTabId]
  );
  const activeTabSessionDetail = activeTabId
    ? (tabSessionData[activeTabId]?.sessionDetail ?? null)
    : null;

  return (
    <div
      className="ml-2 flex shrink-0 items-center gap-1"
      style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
    >
      {/* Update app button — only visible when update available or downloaded */}
      {(updateStatus === 'available' || updateStatus === 'downloaded') && (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={openUpdateDialog}
              onMouseEnter={() => setUpdateHover(true)}
              onMouseLeave={() => setUpdateHover(false)}
              className="rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors"
              style={{
                color: updateHover ? '#4ade80' : '#22c55e',
                backgroundColor: updateHover ? 'rgba(34, 197, 94, 0.1)' : 'transparent',
              }}
            >
              {updateStatus === 'downloaded' ? '重启更新' : '更新应用'}
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            {updateStatus === 'downloaded' ? '更新已下载，重启后生效' : '发现新版本'}
          </TooltipContent>
        </Tooltip>
      )}

      {/* Notifications bell icon */}
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            onClick={openNotificationsTab}
            onMouseEnter={() => setNotificationsHover(true)}
            onMouseLeave={() => setNotificationsHover(false)}
            className="relative rounded-md p-2 transition-colors"
            style={{
              color: notificationsHover ? 'var(--color-text)' : 'var(--color-text-muted)',
              backgroundColor: notificationsHover ? 'var(--color-surface-raised)' : 'transparent',
            }}
            aria-label="通知"
          >
            <Bell className="size-4" />
            {unreadCount > 0 && (
              <span className="absolute -right-0.5 -top-0.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-red-500 px-1 text-xs font-medium text-white">
                {unreadCount > 99 ? '99+' : unreadCount}
              </span>
            )}
          </button>
        </TooltipTrigger>
        <TooltipContent side="bottom">通知</TooltipContent>
      </Tooltip>

      {/* GitHub link */}
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            onClick={async () => {
              if (isElectronMode()) {
                await window.electronAPI.openExternal(
                  'https://github.com/lazy-agent/multi-agent-workbench'
                );
                return;
              }

              window.open(
                'https://github.com/lazy-agent/multi-agent-workbench',
                '_blank',
                'noopener,noreferrer'
              );
            }}
            onMouseEnter={() => setGithubHover(true)}
            onMouseLeave={() => setGithubHover(false)}
            className="rounded-md p-2 transition-colors"
            style={{
              color: githubHover ? 'var(--color-text)' : 'var(--color-text-muted)',
              backgroundColor: githubHover ? 'var(--color-surface-raised)' : 'transparent',
            }}
            aria-label="GitHub"
          >
            <svg className="size-4" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12Z" />
            </svg>
          </button>
        </TooltipTrigger>
        <TooltipContent side="bottom">GitHub</TooltipContent>
      </Tooltip>

      {/* More menu (Teams, Settings, Extensions, Search, Export, Analyze, Schedules) */}
      <MoreMenu
        activeTab={activeTab}
        activeTabSessionDetail={activeTabSessionDetail}
        activeTabId={activeTabId}
      />

      {/* Expand sidebar — rightmost, only when collapsed */}
      {sidebarCollapsed && (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={toggleSidebar}
              onMouseEnter={() => setExpandHover(true)}
              onMouseLeave={() => setExpandHover(false)}
              className="mr-1 rounded-md p-2 transition-colors"
              style={{
                color: expandHover ? 'var(--color-text)' : 'var(--color-text-muted)',
                backgroundColor: expandHover ? 'var(--color-surface-raised)' : 'transparent',
              }}
              aria-label="展开侧边栏"
            >
              <PanelRight className="size-4" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom">展开侧边栏</TooltipContent>
        </Tooltip>
      )}
    </div>
  );
};
