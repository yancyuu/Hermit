/**
 * RepositoryScopeSection - Section for limiting trigger to specific repositories.
 * Uses the shared RepositoryDropdown component.
 */

import {
  RepositoryDropdown,
  SelectedRepositoryItem,
} from '@renderer/components/common/RepositoryDropdown';

import type { RepositoryDropdownItem } from '@renderer/components/settings/hooks/useSettingsConfig';

interface RepositoryScopeSectionProps {
  repositoryIds: string[];
  selectedItems: RepositoryDropdownItem[];
  onAdd: (item: RepositoryDropdownItem) => void;
  onRemove: (index: number) => void;
  disabled: boolean;
}

export const RepositoryScopeSection = ({
  repositoryIds,
  selectedItems,
  onAdd,
  onRemove,
  disabled,
}: Readonly<RepositoryScopeSectionProps>): React.JSX.Element => {
  return (
    <details className="mt-4">
      <summary className="cursor-pointer text-xs uppercase tracking-widest text-text-muted hover:text-text-secondary">
        高级：仓库范围
      </summary>
      <div className="mt-3 border-l border-border pl-4">
        <span className="mb-2 block text-xs text-text-muted">限定仓库（仅对选中的仓库生效）</span>
        {selectedItems.length === 0 ? (
          <p className="mb-2 text-xs italic text-text-muted">未选择仓库，触发器将应用到所有仓库</p>
        ) : (
          selectedItems.map((item, idx) => (
            <SelectedRepositoryItem
              key={item.id}
              item={item}
              onRemove={() => onRemove(idx)}
              disabled={disabled}
            />
          ))
        )}

        {/* Repository selector dropdown */}
        <RepositoryDropdown
          onSelect={onAdd}
          excludeIds={repositoryIds}
          placeholder="选择要添加的仓库..."
          disabled={disabled}
          className="mt-2"
        />

        <p className="mt-2 text-xs text-text-muted">
          When repositories are selected, this trigger only fires for errors in those repositories.
        </p>
      </div>
    </details>
  );
};
