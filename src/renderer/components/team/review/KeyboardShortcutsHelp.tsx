import React from 'react';

import { IS_MAC } from '@renderer/utils/platformKeys';
import { X } from 'lucide-react';

interface KeyboardShortcutsHelpProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const mod = IS_MAC ? '\u2318' : 'Ctrl';
const alt = IS_MAC ? '\u2325' : 'Alt';
const shift = IS_MAC ? '\u21E7' : 'Shift';

const shortcuts = [
  { keys: [`${alt}+J`], action: '下一个变更' },
  { keys: [`${alt}+K`], action: '上一个变更' },
  { keys: [`${alt}+\u2193`], action: '下一个文件' },
  { keys: [`${alt}+\u2191`], action: '上一个文件' },
  { keys: [`${mod}+Y`], action: '接受变更' },
  { keys: [`${mod}+N`], action: '拒绝变更' },
  { keys: [`${mod}+S`], action: '保存文件' },
  { keys: [`${mod}+Z`], action: '撤销' },
  { keys: [`${mod}+${shift}+Z`], action: '重做' },
  { keys: ['?'], action: '切换快捷键帮助' },
  { keys: ['Esc'], action: '关闭对话框' },
];

export const KeyboardShortcutsHelp = ({
  open,
  onOpenChange,
}: KeyboardShortcutsHelpProps): React.ReactElement | null => {
  if (!open) return null;

  return (
    <div className="absolute right-4 top-14 z-50 w-64 rounded-lg border border-border bg-surface-overlay p-3 shadow-lg">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-medium text-text">快捷键</span>
        <button
          onClick={() => onOpenChange(false)}
          className="rounded p-0.5 text-text-muted hover:bg-surface-raised hover:text-text"
        >
          <X className="size-3" />
        </button>
      </div>
      <div className="space-y-1">
        {shortcuts.map(({ keys, action }) => (
          <div key={action} className="flex items-center justify-between text-xs">
            <span className="text-text-secondary">{action}</span>
            <div className="flex gap-1">
              {keys.map((key) => (
                <kbd
                  key={key}
                  className="rounded border border-border bg-surface-raised px-1.5 py-0.5 font-mono text-[10px] text-text-muted"
                >
                  {key}
                </kbd>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
