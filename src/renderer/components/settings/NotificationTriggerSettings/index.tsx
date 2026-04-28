/**
 * NotificationTriggerSettings - Component for managing notification triggers.
 * Allows users to configure when notifications should be generated.
 *
 * Uses intent-first design pattern with 4 sections:
 * 1. General Info (always visible)
 * 2. Trigger Condition (mode selector)
 * 3. Dynamic Configuration (based on mode)
 * 4. Advanced (collapsible)
 */

import { AddTriggerForm } from './components/AddTriggerForm';
import { SectionHeader } from './components/SectionHeader';
import { TriggerCard } from './components/TriggerCard';

import type { NotificationTriggerSettingsProps } from './types';

// Stable no-op function for builtin triggers that can't be removed
const noopRemove = (_triggerId: string): Promise<void> => Promise.resolve();

/**
 * Main component for managing notification triggers.
 */
export const NotificationTriggerSettings = ({
  triggers,
  saving,
  onUpdateTrigger,
  onAddTrigger,
  onRemoveTrigger,
}: Readonly<NotificationTriggerSettingsProps>): React.JSX.Element => {
  // Separate builtin and custom triggers
  const builtinTriggers = triggers.filter((t) => t.isBuiltin);
  const customTriggers = triggers.filter((t) => !t.isBuiltin);

  return (
    <div className="mt-6 space-y-8">
      {/* Builtin Triggers */}
      {builtinTriggers.length > 0 && (
        <div>
          <SectionHeader title="内置触发器" />
          <p className="mb-4 text-xs text-text-muted">
            应用自带的默认触发器。你可以启用/禁用它们，并自定义匹配模式。
          </p>
          <div>
            {builtinTriggers.map((trigger) => (
              <TriggerCard
                key={trigger.id}
                trigger={trigger}
                saving={saving}
                onUpdate={onUpdateTrigger}
                onRemove={noopRemove}
              />
            ))}
          </div>
        </div>
      )}

      {/* Custom Triggers */}
      <div>
        <SectionHeader title="自定义触发器" />
        <p className="mb-4 text-xs text-text-muted">
          创建自己的触发器，在特定模式或工具输出出现时接收通知。
        </p>

        {customTriggers.length > 0 && (
          <div className="mb-4">
            {customTriggers.map((trigger) => (
              <TriggerCard
                key={trigger.id}
                trigger={trigger}
                saving={saving}
                onUpdate={onUpdateTrigger}
                onRemove={onRemoveTrigger}
              />
            ))}
          </div>
        )}

        {customTriggers.length === 0 && (
          <p className="mb-4 text-sm italic text-text-muted">尚未配置自定义触发器。</p>
        )}

        <AddTriggerForm saving={saving} onAdd={onAddTrigger} />
      </div>
    </div>
  );
};
