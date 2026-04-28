import { linkifyAllMentionsInMarkdown } from '@renderer/utils/mentionLinkify';
import { linkifyTaskIdsInMarkdown } from '@renderer/utils/taskReferenceUtils';
import { stripAgentBlocks } from '@shared/constants/agentBlocks';
import { stripTeammateMessageBlocks } from '@shared/utils/inboxNoise';

import type { InboxMessage } from '@shared/types';

interface ThoughtDisplayContentOptions {
  preserveLineBreaks?: boolean;
  stripAgentOnlyBlocks?: boolean;
}

export function buildThoughtDisplayContent(
  thought: Pick<InboxMessage, 'text' | 'taskRefs'>,
  memberColorMap?: ReadonlyMap<string, string>,
  teamNames: string[] = [],
  options: ThoughtDisplayContentOptions = {}
): string {
  const { preserveLineBreaks = true, stripAgentOnlyBlocks = false } = options;
  let text = stripTeammateMessageBlocks(thought.text);
  if (stripAgentOnlyBlocks) {
    text = stripAgentBlocks(text);
  }
  if (preserveLineBreaks) {
    text = text.replace(/\n/g, '  \n');
  }
  text = linkifyTaskIdsInMarkdown(text, thought.taskRefs);
  if ((memberColorMap && memberColorMap.size > 0) || teamNames.length > 0) {
    text = linkifyAllMentionsInMarkdown(
      text,
      (memberColorMap ?? new Map()) as Map<string, string>,
      teamNames
    );
  }
  return text;
}
