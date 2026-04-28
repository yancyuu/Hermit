/**
 * UserMessagesSection - Section for displaying user message injections.
 */

import React from 'react';

import { UserMessageItem } from '../items/UserMessageItem';

import { CollapsibleSection } from './CollapsibleSection';

import type { UserMessageInjection } from '@renderer/types/contextInjection';

interface UserMessagesSectionProps {
  injections: UserMessageInjection[];
  tokenCount: number;
  isExpanded: boolean;
  onToggle: () => void;
  onNavigateToTurn?: (turnIndex: number) => void;
}

export const UserMessagesSection = ({
  injections,
  tokenCount,
  isExpanded,
  onToggle,
  onNavigateToTurn,
}: Readonly<UserMessagesSectionProps>): React.ReactElement | null => {
  if (injections.length === 0) return null;

  return (
    <CollapsibleSection
      title="User Messages"
      count={injections.length}
      tokenCount={tokenCount}
      isExpanded={isExpanded}
      onToggle={onToggle}
    >
      {injections.map((injection) => (
        <UserMessageItem
          key={injection.id}
          injection={injection}
          onNavigateToTurn={onNavigateToTurn}
        />
      ))}
    </CollapsibleSection>
  );
};
