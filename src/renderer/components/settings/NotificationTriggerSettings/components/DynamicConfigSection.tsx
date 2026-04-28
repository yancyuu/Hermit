/**
 * DynamicConfigSection - Mode-specific configuration for AddTriggerForm.
 * Renders different UI based on the selected trigger mode.
 */

import {
  getCursorClass,
  SELECT_INPUT_BASE,
  SELECT_OPTION_BG,
} from '@renderer/constants/cssVariables';
import { AlertCircle } from 'lucide-react';

import { CONTENT_TYPE_OPTIONS } from '../utils/constants';
import { getAvailableMatchFields } from '../utils/trigger';

import { SectionHeader } from './SectionHeader';

import type { TriggerContentType, TriggerMode, TriggerTokenType } from '@renderer/types/data';

interface DynamicConfigSectionProps {
  mode: TriggerMode;
  contentType: TriggerContentType;
  toolName: string;
  matchField: string;
  matchPattern: string;
  patternError: string | null;
  tokenThreshold: number;
  tokenType: TriggerTokenType;
  saving: boolean;
  onContentTypeChange: (contentType: TriggerContentType) => void;
  onMatchFieldChange: (matchField: string) => void;
  onMatchPatternChange: (value: string) => void;
  onTokenThresholdChange: (value: string) => void;
  onTokenTypeChange: (tokenType: TriggerTokenType) => void;
}

export const DynamicConfigSection = ({
  mode,
  contentType,
  toolName,
  matchField,
  matchPattern,
  patternError,
  tokenThreshold,
  tokenType,
  saving,
  onContentTypeChange,
  onMatchFieldChange,
  onMatchPatternChange,
  onTokenThresholdChange,
  onTokenTypeChange,
}: Readonly<DynamicConfigSectionProps>): React.JSX.Element => {
  // Get available match fields based on content type and tool name
  const availableMatchFields = getAvailableMatchFields(contentType, toolName || undefined);

  return (
    <div className="space-y-3">
      <SectionHeader title="配置" />

      {/* Error Status Mode */}
      {mode === 'error_status' && (
        <div className="py-2">
          <p className="text-sm text-text-muted">当工具执行报告错误（is_error: true）时触发。</p>
        </div>
      )}

      {/* Content Match Mode */}
      {mode === 'content_match' && (
        <div className="space-y-3">
          {/* Content Type */}
          <div className="flex items-center justify-between border-b border-border-subtle py-2">
            <label htmlFor="new-trigger-content-type" className="text-sm text-text-secondary">
              内容类型
            </label>
            <select
              id="new-trigger-content-type"
              value={contentType}
              onChange={(e) => onContentTypeChange(e.target.value as TriggerContentType)}
              disabled={saving}
              className={`${SELECT_INPUT_BASE} ${getCursorClass(saving)}`}
            >
              {CONTENT_TYPE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value} className={SELECT_OPTION_BG}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          {/* Match Field */}
          {availableMatchFields.length > 0 && (
            <div className="flex items-center justify-between border-b border-border-subtle py-2">
              <label htmlFor="new-trigger-match-field" className="text-sm text-text-secondary">
                匹配字段
              </label>
              <select
                id="new-trigger-match-field"
                value={matchField || availableMatchFields[0]?.value || ''}
                onChange={(e) => onMatchFieldChange(e.target.value)}
                disabled={saving}
                className={`${SELECT_INPUT_BASE} ${getCursorClass(saving)}`}
              >
                {availableMatchFields.map((option) => (
                  <option key={option.value} value={option.value} className={SELECT_OPTION_BG}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Match Pattern */}
          <div className="border-b border-border-subtle py-2">
            <div className="mb-2 flex items-center justify-between">
              <label htmlFor="new-trigger-match-pattern" className="text-sm text-text-secondary">
                匹配模式（正则）
              </label>
            </div>
            <input
              id="new-trigger-match-pattern"
              type="text"
              value={matchPattern}
              onChange={(e) => onMatchPatternChange(e.target.value)}
              placeholder="e.g., error|failed|exception"
              disabled={saving}
              className={`w-full rounded border bg-transparent px-2 py-1.5 font-mono text-sm text-text placeholder:text-text-muted focus:border-transparent focus:outline-none focus:ring-1 focus:ring-indigo-500 ${patternError ? 'border-red-500' : 'border-border'} ${saving ? 'cursor-not-allowed opacity-50' : ''} `}
            />
            {patternError && (
              <p className="mt-1 flex items-center gap-1 text-xs text-red-400">
                <AlertCircle className="size-3" />
                {patternError}
              </p>
            )}
            <p className="mt-1 text-xs text-text-muted">
              留空表示匹配所有内容。使用 JavaScript 正则语法。
            </p>
          </div>
        </div>
      )}

      {/* Token Threshold Mode */}
      {mode === 'token_threshold' && (
        <div className="space-y-3">
          <div className="flex items-center justify-between border-b border-border-subtle py-2">
            <label htmlFor="new-trigger-token-type" className="text-sm text-text-secondary">
              Token Type
            </label>
            <select
              id="new-trigger-token-type"
              value={tokenType}
              onChange={(e) => onTokenTypeChange(e.target.value as TriggerTokenType)}
              disabled={saving}
              className={`${SELECT_INPUT_BASE} ${getCursorClass(saving)}`}
            >
              <option value="total" className={SELECT_OPTION_BG}>
                总 Token
              </option>
              <option value="input" className={SELECT_OPTION_BG}>
                输入 Token
              </option>
              <option value="output" className={SELECT_OPTION_BG}>
                输出 Token
              </option>
            </select>
          </div>
          <div className="flex items-center justify-between border-b border-border-subtle py-2">
            <label htmlFor="new-trigger-threshold" className="text-sm text-text-secondary">
              阈值
            </label>
            <div className="flex items-center gap-2">
              <span className="text-xs text-text-muted">超过时提醒 &gt;</span>
              <input
                id="new-trigger-threshold"
                type="text"
                inputMode="numeric"
                value={tokenThreshold || ''}
                onChange={(e) => onTokenThresholdChange(e.target.value)}
                placeholder="0"
                disabled={saving}
                className={`w-20 rounded border border-border bg-transparent px-2 py-1 text-right text-sm text-text focus:border-transparent focus:outline-none focus:ring-1 focus:ring-indigo-500 ${saving ? 'cursor-not-allowed opacity-50' : ''} `}
              />
              <span className="text-xs text-text-muted">tokens</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
