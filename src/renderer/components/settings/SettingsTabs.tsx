import { useMemo } from 'react';

import { isElectronMode } from '@renderer/api';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@renderer/components/ui/tooltip';
import { Bell, Info, Server, Settings, Wrench } from 'lucide-react';

import type { LucideIcon } from 'lucide-react';

export type SettingsSection = 'general' | 'connection' | 'notifications' | 'advanced';

interface SettingsTabsProps {
  activeSection: SettingsSection;
  onSectionChange: (section: SettingsSection) => void;
}

interface TabConfig {
  id: SettingsSection;
  label: string;
  icon: LucideIcon;
  description: string;
  electronOnly?: boolean;
}

const tabs: TabConfig[] = [
  {
    id: 'general',
    label: '通用',
    icon: Settings,
    description: '主题、语言、显示密度和启动行为等核心应用偏好。',
  },
  {
    id: 'connection',
    label: '连接',
    icon: Server,
    description: '管理 SSH 主机、远程机器和连接状态。',
    electronOnly: true,
  },
  {
    id: 'notifications',
    label: '通知',
    icon: Bell,
    description: '控制何时以及如何接收智能体活动、任务完成和错误通知。',
  },
  {
    id: 'advanced',
    label: '高级',
    icon: Wrench,
    description: '高级选项：导出/导入配置、重置默认值和编辑原始配置。',
  },
];

export const SettingsTabs = ({
  activeSection,
  onSectionChange,
}: Readonly<SettingsTabsProps>): React.JSX.Element => {
  const isElectron = useMemo(() => isElectronMode(), []);
  const visibleTabs = useMemo(
    () => tabs.filter((tab) => !tab.electronOnly || isElectron),
    [isElectron]
  );

  return (
    <TooltipProvider>
      <div className="border-b border-border pb-0">
        <div className="inline-flex h-9 items-center gap-1 rounded-t-lg bg-[var(--color-surface-raised)] p-1 text-[var(--color-text-muted)]">
          {visibleTabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeSection === tab.id;

            return (
              <button
                key={tab.id}
                onClick={() => onSectionChange(tab.id)}
                className={`relative inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md px-3 py-1 pr-7 text-sm font-medium transition-all ${
                  isActive
                    ? 'bg-[var(--color-surface)] text-[var(--color-text)] shadow-sm'
                    : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]'
                }`}
              >
                <Icon className="size-3.5" />
                {tab.label}

                <Tooltip>
                  <TooltipTrigger asChild>
                    <span
                      role="button"
                      tabIndex={0}
                      aria-label={`What is ${tab.label}?`}
                      onClick={(event) => event.stopPropagation()}
                      onMouseDown={(event) => event.stopPropagation()}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.stopPropagation();
                        }
                      }}
                      className="size-4.5 absolute right-1.5 top-0.5 z-10 inline-flex items-center justify-center rounded-full text-text-muted transition-colors hover:bg-[var(--color-surface-raised)] hover:text-text"
                    >
                      <Info className="size-3" />
                    </span>
                  </TooltipTrigger>
                  <TooltipContent className="max-w-64 text-pretty text-xs leading-relaxed">
                    {tab.description}
                  </TooltipContent>
                </Tooltip>
              </button>
            );
          })}
        </div>
      </div>
    </TooltipProvider>
  );
};
