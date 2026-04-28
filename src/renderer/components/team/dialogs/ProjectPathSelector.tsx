import React from 'react';

import { api } from '@renderer/api';
import { Button } from '@renderer/components/ui/button';
import { Combobox } from '@renderer/components/ui/combobox';
import { Input } from '@renderer/components/ui/input';
import { Label } from '@renderer/components/ui/label';
import { cn } from '@renderer/lib/utils';
import { Check, FolderOpen } from 'lucide-react';

import { buildProjectPathOptions } from './projectPathOptions';

import type { Project } from '@shared/types';

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function renderHighlightedText(text: string, query: string): React.JSX.Element {
  if (!query.trim()) {
    return <span>{text}</span>;
  }

  const pattern = new RegExp(`(${escapeRegExp(query)})`, 'ig');
  const parts = text.split(pattern);

  return (
    <span>
      {parts.map((part, index) => {
        const isMatch = part.toLowerCase() === query.toLowerCase();
        if (!isMatch) {
          return <span key={`${part}-${index}`}>{part}</span>;
        }
        return (
          <mark
            key={`${part}-${index}`}
            // eslint-disable-next-line tailwindcss/no-custom-classname -- Tailwind arbitrary value with CSS variable
            className="bg-[var(--color-accent)]/25 rounded px-0.5 text-[var(--color-text)]"
          >
            {part}
          </mark>
        );
      })}
    </span>
  );
}

export type CwdMode = 'project' | 'custom';

interface ProjectPathSelectorProps {
  cwdMode: CwdMode;
  onCwdModeChange: (mode: CwdMode) => void;
  selectedProjectPath: string;
  onSelectedProjectPathChange: (path: string) => void;
  customCwd: string;
  onCustomCwdChange: (cwd: string) => void;
  projects: Project[];
  projectsLoading: boolean;
  projectsError: string | null;
  fieldError?: string | null;
}

export const ProjectPathSelector = ({
  cwdMode,
  onCwdModeChange,
  selectedProjectPath,
  onSelectedProjectPathChange,
  customCwd,
  onCustomCwdChange,
  projects,
  projectsLoading,
  projectsError,
  fieldError,
}: ProjectPathSelectorProps): React.JSX.Element => {
  const projectOptions = React.useMemo(
    () => buildProjectPathOptions(projects, selectedProjectPath),
    [projects, selectedProjectPath]
  );

  return (
    <div className="space-y-1.5">
      <Label>项目</Label>
      <div className="space-y-2">
        <div className="flex flex-col gap-2 md:flex-row md:items-start">
          <div className="inline-flex shrink-0 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] p-0.5">
            <button
              type="button"
              className={cn(
                'rounded-[3px] px-3 py-1 text-xs font-medium transition-colors',
                cwdMode === 'project'
                  ? 'bg-[var(--color-surface-raised)] text-[var(--color-text)] shadow-sm'
                  : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]'
              )}
              onClick={() => onCwdModeChange('project')}
            >
              从项目列表选择
            </button>
            <button
              type="button"
              className={cn(
                'rounded-[3px] px-3 py-1 text-xs font-medium transition-colors',
                cwdMode === 'custom'
                  ? 'bg-[var(--color-surface-raised)] text-[var(--color-text)] shadow-sm'
                  : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]'
              )}
              onClick={() => onCwdModeChange('custom')}
            >
              自定义路径
            </button>
          </div>

          <div className="min-w-0 flex-1">
            {cwdMode === 'project' ? (
              <div className="space-y-1.5">
                <div className="flex items-center gap-2">
                  <FolderOpen size={16} className="shrink-0 text-[var(--color-text-muted)]" />
                  <div className="min-w-0 flex-1">
                    <Combobox
                      options={projectOptions}
                      value={selectedProjectPath}
                      onValueChange={onSelectedProjectPathChange}
                      placeholder={projectsLoading ? '正在加载项目...' : '选择项目...'}
                      searchPlaceholder="按名称或路径搜索项目"
                      emptyMessage="未找到匹配项"
                      disabled={projectsLoading || projectOptions.length === 0}
                      renderOption={(option, isSelected, query) => (
                        <>
                          <Check
                            className={cn(
                              'mr-2 size-3.5 shrink-0',
                              isSelected ? 'opacity-100' : 'opacity-0'
                            )}
                          />
                          <div className="min-w-0 flex-1">
                            <p className="truncate font-medium text-[var(--color-text)]">
                              {renderHighlightedText(option.label, query)}
                            </p>
                            <p className="truncate text-[var(--color-text-muted)]">
                              {renderHighlightedText(option.description ?? '', query)}
                            </p>
                          </div>
                        </>
                      )}
                    />
                  </div>
                </div>
                {!selectedProjectPath ? (
                  <p className="text-[11px] text-[var(--color-text-muted)]">请从列表中选择项目</p>
                ) : null}
                {projectsError ? <p className="text-[11px] text-red-300">{projectsError}</p> : null}
                {!projectsLoading && projectOptions.length === 0 ? (
                  <p className="text-[11px]" style={{ color: 'var(--warning-text)' }}>
                    未找到项目，请切换到自定义路径。
                  </p>
                ) : null}
              </div>
            ) : (
              <div className="space-y-1.5">
                <div className="flex items-center gap-2">
                  <FolderOpen size={16} className="shrink-0 text-[var(--color-text-muted)]" />
                  <Input
                    className="h-8 flex-1 text-xs"
                    value={customCwd}
                    aria-label="自定义工作目录"
                    onChange={(event) => onCustomCwdChange(event.target.value)}
                    placeholder="/absolute/path/to/project"
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      void (async () => {
                        try {
                          const paths = await api.config.selectFolders();
                          if (paths.length > 0) {
                            onCustomCwdChange(paths[0]);
                          }
                        } catch {
                          // IPC error - dialog may have been cancelled or failed
                        }
                      })();
                    }}
                  >
                    浏览
                  </Button>
                </div>
                <p className="text-[11px] text-[var(--color-text-muted)]">
                  如果目录不存在，将自动创建。
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
      {fieldError ? (
        <p className="text-[11px]" style={{ color: 'var(--field-error-text)' }}>
          {fieldError}
        </p>
      ) : null}
    </div>
  );
};
