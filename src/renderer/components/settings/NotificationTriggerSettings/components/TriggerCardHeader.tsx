/**
 * TriggerCardHeader - Header row for TriggerCard with name, badges, toggle, and actions.
 */

import { SettingsToggle } from '@renderer/components/settings/components';
import { getTriggerColorDef } from '@shared/constants/triggerColors';
import { ChevronDown, ChevronUp, Pencil, Shield, X } from 'lucide-react';

import { CONTENT_TYPE_OPTIONS, MODE_OPTIONS } from '../utils/constants';

import type { NotificationTrigger, TriggerMode } from '@renderer/types/data';

interface TriggerCardHeaderProps {
  trigger: NotificationTrigger;
  saving: boolean;
  localMode: TriggerMode;
  editingName: boolean;
  localName: string;
  isExpanded: boolean;
  onSetEditingName: (value: boolean) => void;
  onSetLocalName: (value: string) => void;
  onNameSave: () => void;
  onToggleEnabled: () => void;
  onToggleExpanded: () => void;
  onRemove: () => Promise<void>;
}

export const TriggerCardHeader = ({
  trigger,
  saving,
  localMode,
  editingName,
  localName,
  isExpanded,
  onSetEditingName,
  onSetLocalName,
  onNameSave,
  onToggleEnabled,
  onToggleExpanded,
  onRemove,
}: Readonly<TriggerCardHeaderProps>): React.JSX.Element => {
  return (
    <div className="flex items-center justify-between py-3">
      {/* Left side: Name and badges */}
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <div className="min-w-0 flex-1">
          {editingName && !trigger.isBuiltin ? (
            <input
              type="text"
              value={localName}
              onChange={(e) => onSetLocalName(e.target.value)}
              onBlur={onNameSave}
              onKeyDown={(e) => {
                if (e.key === 'Enter') onNameSave();
                if (e.key === 'Escape') {
                  onSetLocalName(trigger.name);
                  onSetEditingName(false);
                }
              }}
              autoFocus
              className="w-full rounded border border-border bg-transparent px-2 py-1 text-sm text-text focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
          ) : (
            <div className="flex items-center gap-2">
              <span
                className="size-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: getTriggerColorDef(trigger.color).hex }}
              />
              <span className="truncate text-sm font-medium text-text">{trigger.name}</span>
              {trigger.isBuiltin && (
                <span className="flex items-center gap-1 rounded bg-indigo-500/10 px-1.5 py-0.5 text-[10px] text-indigo-400">
                  <Shield className="size-2.5" />
                  Builtin
                </span>
              )}
              {!trigger.isBuiltin && (
                <button
                  onClick={() => onSetEditingName(true)}
                  disabled={saving}
                  className="rounded p-0.5 text-text-muted transition-colors hover:bg-surface-raised hover:text-text-secondary"
                  aria-label="Edit name"
                >
                  <Pencil className="size-3" />
                </button>
              )}
            </div>
          )}
          {/* Description line showing mode and content type */}
          <div className="mt-0.5 flex items-center gap-2 text-xs text-text-muted">
            <span>{MODE_OPTIONS.find((m) => m.value === localMode)?.label ?? localMode}</span>
            <span className="text-text-muted">-</span>
            <span>
              {CONTENT_TYPE_OPTIONS.find((o) => o.value === trigger.contentType)?.label ??
                trigger.contentType}
            </span>
          </div>
        </div>
      </div>

      {/* Right side: Toggle and actions */}
      <div className="flex items-center gap-2">
        <SettingsToggle enabled={trigger.enabled} onChange={onToggleEnabled} disabled={saving} />

        <button
          onClick={onToggleExpanded}
          className="rounded p-1 text-text-muted transition-colors hover:bg-surface-raised hover:text-text-secondary"
          aria-label={isExpanded ? 'Collapse' : 'Expand'}
        >
          {isExpanded ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
        </button>

        {!trigger.isBuiltin && (
          <button
            onClick={onRemove}
            disabled={saving}
            className={`rounded p-1 text-text-muted transition-colors hover:bg-red-500/10 hover:text-red-400 ${saving ? 'cursor-not-allowed opacity-50' : ''} `}
            aria-label="Delete trigger"
          >
            <X className="size-4" />
          </button>
        )}
      </div>
    </div>
  );
};
