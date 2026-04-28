/**
 * IgnorePatternsSection - Collapsible section for ignore patterns - Linear style.
 */

import { X } from 'lucide-react';

interface IgnorePatternsSectionProps {
  patterns: string[];
  onAdd: (pattern: string) => void;
  onRemove: (index: number) => void;
  disabled: boolean;
}

export const IgnorePatternsSection = ({
  patterns,
  onAdd,
  onRemove,
  disabled,
}: Readonly<IgnorePatternsSectionProps>): React.JSX.Element => {
  return (
    <details className="mt-4">
      <summary className="cursor-pointer text-xs uppercase tracking-widest text-text-muted hover:text-text-secondary">
        Advanced: Exclusion Rules
      </summary>
      <div className="mt-3 border-l border-border pl-4">
        <span className="mb-2 block text-xs text-text-muted">
          Ignore Patterns (skip if matches)
        </span>
        {patterns.map((pattern, idx) => (
          <div key={idx} className="flex items-center gap-2 border-b border-border-subtle py-1.5">
            <code className="flex-1 truncate rounded bg-surface-raised px-2 py-1 font-mono text-xs text-text-secondary">
              {pattern}
            </code>
            <button
              type="button"
              onClick={() => onRemove(idx)}
              disabled={disabled}
              className={`rounded p-1 text-text-muted transition-colors hover:bg-red-500/10 hover:text-red-400 ${disabled ? 'cursor-not-allowed opacity-50' : ''} `}
              aria-label="Remove ignore pattern"
            >
              <X className="size-3" />
            </button>
          </div>
        ))}
        <div className="mt-2 flex gap-2">
          <input
            type="text"
            placeholder="Add ignore regex..."
            disabled={disabled}
            className={`flex-1 rounded border border-border bg-transparent px-2 py-1 font-mono text-xs text-text placeholder:text-text-muted focus:border-transparent focus:outline-none focus:ring-1 focus:ring-indigo-500 ${disabled ? 'cursor-not-allowed opacity-50' : ''} `}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && e.currentTarget.value.trim()) {
                e.preventDefault();
                try {
                  const input = e.currentTarget;
                  const value = input.value.trim();
                  new RegExp(value);
                  onAdd(value);
                  input.value = '';
                } catch {
                  // Invalid regex
                }
              }
            }}
          />
        </div>
        <p className="mt-1 text-xs text-text-muted">
          Press Enter to add. Notification is skipped if any pattern matches.
        </p>
      </div>
    </details>
  );
};
