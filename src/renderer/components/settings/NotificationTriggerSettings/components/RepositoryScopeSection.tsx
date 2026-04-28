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
        Advanced: Repository Scope
      </summary>
      <div className="mt-3 border-l border-border pl-4">
        <span className="mb-2 block text-xs text-text-muted">
          Limit to Repositories (applies only to selected repositories)
        </span>
        {selectedItems.length === 0 ? (
          <p className="mb-2 text-xs italic text-text-muted">
            No repositories selected - trigger applies to all repositories
          </p>
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
          placeholder="Select repository to add..."
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
