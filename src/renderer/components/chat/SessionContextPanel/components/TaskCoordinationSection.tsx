/**
 * TaskCoordinationSection - Section for displaying task coordination injections.
 */

import React from 'react';

import { TaskCoordinationItem } from '../items/TaskCoordinationItem';

import { CollapsibleSection } from './CollapsibleSection';

import type { TaskCoordinationInjection } from '@renderer/types/contextInjection';

interface TaskCoordinationSectionProps {
  injections: TaskCoordinationInjection[];
  tokenCount: number;
  isExpanded: boolean;
  onToggle: () => void;
  onNavigateToTurn?: (turnIndex: number) => void;
}

export const TaskCoordinationSection = ({
  injections,
  tokenCount,
  isExpanded,
  onToggle,
  onNavigateToTurn,
}: Readonly<TaskCoordinationSectionProps>): React.ReactElement | null => {
  if (injections.length === 0) return null;

  return (
    <CollapsibleSection
      title="Task Coordination"
      count={injections.length}
      tokenCount={tokenCount}
      isExpanded={isExpanded}
      onToggle={onToggle}
    >
      {injections.map((injection) => (
        <TaskCoordinationItem
          key={injection.id}
          injection={injection}
          onNavigateToTurn={onNavigateToTurn}
        />
      ))}
    </CollapsibleSection>
  );
};
