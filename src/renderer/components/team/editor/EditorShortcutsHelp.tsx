/**
 * Keyboard shortcuts help modal for the project editor.
 *
 * Cross-platform: detects Mac vs Windows/Linux and shows
 * the appropriate modifier symbols.
 */

import { useMemo } from 'react';

import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@renderer/components/ui/dialog';
import { IS_MAC } from '@renderer/utils/platformKeys';

// =============================================================================
// Types
// =============================================================================

interface EditorShortcutsHelpProps {
  onClose: () => void;
}

interface ShortcutDef {
  mac: string;
  other: string;
  description: string;
}

// =============================================================================
// Shortcuts data
// =============================================================================

const SHORTCUT_GROUPS: { title: string; shortcuts: ShortcutDef[] }[] = [
  {
    title: '文件操作',
    shortcuts: [
      { mac: '⌘ P', other: 'Ctrl+P', description: '快速打开' },
      { mac: '⌘ S', other: 'Ctrl+S', description: '保存' },
      { mac: '⌘ ⇧ S', other: 'Ctrl+Shift+S', description: '全部保存' },
      { mac: '⌘ W', other: 'Ctrl+W', description: '关闭标签页' },
    ],
  },
  {
    title: '搜索',
    shortcuts: [
      { mac: '⌘ F', other: 'Ctrl+F', description: '在文件中查找' },
      { mac: '⌘ ⇧ F', other: 'Ctrl+Shift+F', description: '在文件中搜索' },
      { mac: '⌘ G', other: 'Ctrl+G', description: '跳转到行' },
    ],
  },
  {
    title: '导航',
    shortcuts: [
      { mac: '⌘ ⇧ ]', other: 'Ctrl+Shift+]', description: '下一个标签页' },
      { mac: '⌘ ⇧ [', other: 'Ctrl+Shift+[', description: '上一个标签页' },
      { mac: '⌃ Tab', other: 'Ctrl+Tab', description: '循环切换标签页' },
      { mac: '⌘ B', other: 'Ctrl+B', description: '切换侧边栏' },
    ],
  },
  {
    title: '编辑',
    shortcuts: [
      { mac: '⌘ Z', other: 'Ctrl+Z', description: '撤销' },
      { mac: '⌘ ⇧ Z', other: 'Ctrl+Y', description: '重做' },
      { mac: '⌘ D', other: 'Ctrl+D', description: '选择下一个匹配项' },
      { mac: '⌘ /', other: 'Ctrl+/', description: '切换注释' },
    ],
  },
  {
    title: 'Markdown',
    shortcuts: [
      { mac: '⌘ ⇧ M', other: 'Ctrl+Shift+M', description: '拆分预览' },
      { mac: '⌘ ⇧ V', other: 'Ctrl+Shift+V', description: '完整预览' },
    ],
  },
  {
    title: '通用',
    shortcuts: [{ mac: 'Esc', other: 'Esc', description: '关闭编辑器' }],
  },
];

// =============================================================================
// Component
// =============================================================================

export const EditorShortcutsHelp = ({ onClose }: EditorShortcutsHelpProps): React.ReactElement => {
  // Resolve platform-specific keys once
  const resolvedGroups = useMemo(
    () =>
      SHORTCUT_GROUPS.map((group) => ({
        ...group,
        shortcuts: group.shortcuts.map((s) => ({
          keys: IS_MAC ? s.mac : s.other,
          description: s.description,
        })),
      })),
    []
  );

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="w-[480px] max-w-[480px]">
        <DialogHeader>
          <DialogTitle className="text-sm">快捷键</DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-x-6 gap-y-4">
          {resolvedGroups.map((group) => (
            <div key={group.title}>
              <h3 className="mb-1.5 text-xs font-medium text-text-secondary">{group.title}</h3>
              <div className="space-y-1">
                {group.shortcuts.map((shortcut) => (
                  <div key={shortcut.keys} className="flex items-center justify-between text-xs">
                    <span className="text-text-muted">{shortcut.description}</span>
                    <kbd className="rounded border border-border bg-surface-raised px-1.5 py-0.5 font-mono text-[10px] text-text-secondary">
                      {shortcut.keys}
                    </kbd>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
};
