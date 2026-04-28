/**
 * TabContextMenu - Right-click context menu for tab actions.
 * Supports close, close others, close all, bulk close for multi-select,
 * and split left/right for pane management.
 * Shows keyboard shortcut hints for actions that have them.
 */

import { useEffect, useRef } from 'react';

import { formatShortcut } from '@renderer/utils/stringUtils';

interface TabContextMenuProps {
  x: number;
  y: number;
  tabId: string;
  paneId: string;
  selectedCount: number;
  onClose: () => void;
  onCloseTab: () => void;
  onCloseOtherTabs: () => void;
  onCloseAllTabs: () => void;
  onCloseSelectedTabs?: () => void;
  onSplitRight: () => void;
  onSplitLeft: () => void;
  disableSplit: boolean;
  /** Whether this tab is a session tab (pin only applies to sessions) */
  isSessionTab?: boolean;
  /** Whether this session is currently pinned in the sidebar */
  isPinned?: boolean;
  /** Callback to toggle pin state */
  onTogglePin?: () => void;
  /** Whether this session is currently hidden from the sidebar */
  isHidden?: boolean;
  /** Callback to toggle hide state */
  onToggleHide?: () => void;
}

export const TabContextMenu = ({
  x,
  y,
  selectedCount,
  onClose,
  onCloseTab,
  onCloseOtherTabs,
  onCloseAllTabs,
  onCloseSelectedTabs,
  onSplitRight,
  onSplitLeft,
  disableSplit,
  isSessionTab,
  isPinned,
  onTogglePin,
  isHidden,
  onToggleHide,
}: TabContextMenuProps): React.JSX.Element => {
  const menuRef = useRef<HTMLDivElement>(null);

  // Close on click-outside and Escape
  useEffect(() => {
    const handleMouseDown = (e: MouseEvent): void => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', handleMouseDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleMouseDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose]);

  // Viewport clamping
  const menuWidth = 240;
  const menuHeight = selectedCount > 1 ? 220 : 196;
  const clampedX = Math.min(x, window.innerWidth - menuWidth - 8);
  const clampedY = Math.min(y, window.innerHeight - menuHeight - 8);

  const handleClick = (action: () => void) => () => {
    action();
    onClose();
  };

  return (
    <div
      ref={menuRef}
      className="fixed z-50 min-w-[220px] overflow-hidden rounded-md border py-1 shadow-lg"
      style={{
        left: clampedX,
        top: clampedY,
        backgroundColor: 'var(--color-surface-overlay)',
        borderColor: 'var(--color-border-emphasis)',
        color: 'var(--color-text)',
      }}
    >
      {selectedCount > 1 && onCloseSelectedTabs ? (
        <MenuItem
          label={`关闭 ${selectedCount} 个标签页`}
          onClick={handleClick(onCloseSelectedTabs)}
        />
      ) : (
        <MenuItem
          label="关闭标签页"
          shortcut={formatShortcut('W')}
          onClick={handleClick(onCloseTab)}
        />
      )}
      <MenuItem label="关闭其他标签页" onClick={handleClick(onCloseOtherTabs)} />
      <div className="mx-2 my-1 border-t" style={{ borderColor: 'var(--color-border)' }} />
      <MenuItem
        label="向右拆分"
        shortcut={formatShortcut('\\')}
        onClick={handleClick(onSplitRight)}
        disabled={disableSplit}
      />
      <MenuItem label="向左拆分" onClick={handleClick(onSplitLeft)} disabled={disableSplit} />
      {isSessionTab && onTogglePin && (
        <>
          <div className="mx-2 my-1 border-t" style={{ borderColor: 'var(--color-border)' }} />
          <MenuItem
            label={isPinned ? '从侧边栏取消固定' : '固定到侧边栏'}
            onClick={handleClick(onTogglePin)}
          />
        </>
      )}
      {isSessionTab && onToggleHide && (
        <MenuItem
          label={isHidden ? '在侧边栏显示' : '从侧边栏隐藏'}
          onClick={handleClick(onToggleHide)}
        />
      )}
      <div className="mx-2 my-1 border-t" style={{ borderColor: 'var(--color-border)' }} />
      <MenuItem
        label="关闭全部标签页"
        shortcut={formatShortcut('W', { shift: true })}
        onClick={handleClick(onCloseAllTabs)}
      />
    </div>
  );
};

const MenuItem = ({
  label,
  shortcut,
  onClick,
  disabled,
}: {
  label: string;
  shortcut?: string;
  onClick: () => void;
  disabled?: boolean;
}): React.JSX.Element => {
  return (
    <button
      className="flex w-full items-center justify-between px-3 py-1.5 text-left text-sm transition-colors hover:bg-[var(--color-surface-raised)]"
      onClick={onClick}
      disabled={disabled}
      style={{ opacity: disabled ? 0.4 : 1 }}
    >
      <span>{label}</span>
      {shortcut && (
        <span className="ml-4 text-xs" style={{ color: 'var(--color-text-muted)' }}>
          {shortcut}
        </span>
      )}
    </button>
  );
};
