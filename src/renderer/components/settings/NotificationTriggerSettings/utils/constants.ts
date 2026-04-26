/**
 * Constants for NotificationTriggerSettings.
 */

import { Activity, AlertCircle, Search } from 'lucide-react';

import type { ModeConfig } from '../types';
import type { TriggerContentType, TriggerToolName } from '@renderer/types/data';

/**
 * Content type options for dropdown.
 */
export const CONTENT_TYPE_OPTIONS: { value: TriggerContentType; label: string }[] = [
  { value: 'tool_result', label: '工具结果' },
  { value: 'tool_use', label: '工具调用' },
  { value: 'thinking', label: '思考内容' },
  { value: 'text', label: '文本输出' },
];

/**
 * Tool name options for dropdown.
 */
export const TOOL_NAME_OPTIONS: { value: TriggerToolName; label: string }[] = [
  { value: '', label: '任意工具' },
  { value: 'Bash', label: 'Bash' },
  { value: 'Task', label: 'Task' },
  { value: 'Read', label: 'Read' },
  { value: 'Write', label: 'Write' },
  { value: 'Edit', label: 'Edit' },
  { value: 'Grep', label: 'Grep' },
  { value: 'Glob', label: 'Glob' },
  { value: 'WebFetch', label: 'WebFetch' },
  { value: 'WebSearch', label: 'WebSearch' },
  { value: 'LSP', label: 'LSP' },
  { value: 'TodoWrite', label: 'TodoWrite' },
  { value: 'Skill', label: 'Skill' },
  { value: 'NotebookEdit', label: 'NotebookEdit' },
  { value: 'AskUserQuestion', label: 'AskUserQuestion' },
  { value: 'KillShell', label: 'KillShell' },
  { value: 'TaskOutput', label: 'TaskOutput' },
];

/**
 * Mode options for the trigger mode selector.
 */
export const MODE_OPTIONS: ModeConfig[] = [
  { value: 'error_status', label: '执行错误', icon: AlertCircle },
  { value: 'content_match', label: '内容匹配', icon: Search },
  { value: 'token_threshold', label: '高 Token 使用量', icon: Activity },
];
