const AGENT_BLOCK_TAG = 'info_for_agent';
const AGENT_BLOCK_OPEN = `<${AGENT_BLOCK_TAG}>`;
const AGENT_BLOCK_CLOSE = `</${AGENT_BLOCK_TAG}>`;
const AGENT_BLOCK_RE = new RegExp(`<${AGENT_BLOCK_TAG}>[\\s\\S]*?</${AGENT_BLOCK_TAG}>`, 'g');

function wrapAgentBlock(text) {
  const trimmed = typeof text === 'string' ? text.trim() : '';
  if (!trimmed) {
    return '';
  }
  return `${AGENT_BLOCK_OPEN}\n${trimmed}\n${AGENT_BLOCK_CLOSE}`;
}

/**
 * Strip all agent-only blocks from text.
 * Returns text with `<info_for_agent>...</info_for_agent>` blocks removed and trimmed.
 */
function stripAgentBlocks(text) {
  if (typeof text !== 'string') return '';
  return text.replace(AGENT_BLOCK_RE, '').trim();
}

module.exports = {
  AGENT_BLOCK_TAG,
  AGENT_BLOCK_OPEN,
  AGENT_BLOCK_CLOSE,
  AGENT_BLOCK_RE,
  stripAgentBlocks,
  wrapAgentBlock,
};
