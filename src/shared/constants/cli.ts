/**
 * CLI error message marker.
 *
 * All "CLI not found" error messages across main process services MUST
 * include this substring so the renderer can detect CLI-missing state
 * without relying on brittle string matching against the full message.
 */
export const CLI_NOT_FOUND_MARKER = 'CLI not found';

/**
 * User-facing message when CLI binary cannot be resolved.
 * Contains CLI_NOT_FOUND_MARKER so the renderer can detect it.
 */
export const CLI_NOT_FOUND_MESSAGE =
  'CLI not found：未找到 Claude CLI。请确认已安装 Claude Code，或在设置中配置有效的 claude 可执行文件路径。';
