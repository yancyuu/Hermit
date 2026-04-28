/**
 * Empty state shown when no file is open in the editor.
 * Shows keyboard shortcuts cheatsheet.
 */

import { shortcutLabel } from '@renderer/utils/platformKeys';
import { FileCode } from 'lucide-react';

const SHORTCUTS = [
  { keys: shortcutLabel('⌘ P', 'Ctrl+P'), label: '快速打开' },
  { keys: shortcutLabel('⌘ ⇧ F', 'Ctrl+Shift+F'), label: '在文件中搜索' },
  { keys: shortcutLabel('⌘ S', 'Ctrl+S'), label: '保存' },
  { keys: shortcutLabel('⌘ B', 'Ctrl+B'), label: '切换侧边栏' },
  { keys: shortcutLabel('⌘ G', 'Ctrl+G'), label: '跳转到行' },
  { keys: 'Esc', label: '关闭编辑器' },
];

export const EditorEmptyState = (): React.ReactElement => {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 text-text-muted">
      <FileCode className="size-12 opacity-30" />
      <p className="text-sm">从文件树中选择文件开始编辑</p>
      <div className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1.5">
        {SHORTCUTS.map((s) => (
          <div key={s.keys} className="flex items-center justify-between gap-4 text-xs">
            <span className="text-text-muted">{s.label}</span>
            <kbd className="rounded border border-border bg-surface-raised px-1.5 py-0.5 font-mono text-[10px] text-text-secondary">
              {s.keys}
            </kbd>
          </div>
        ))}
      </div>
    </div>
  );
};
