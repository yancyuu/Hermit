import { severityColor } from '@renderer/utils/reportAssessments';
import { BarChart3 } from 'lucide-react';

import { AssessmentBadge } from '../AssessmentBadge';
import { ReportSection } from '../ReportSection';

import type {
  ReportFileReadRedundancy,
  ReportPromptQuality,
  ReportStartupOverhead,
  ReportTestProgression,
} from '@renderer/types/sessionReport';

interface QualitySectionProps {
  prompt: ReportPromptQuality;
  startup: ReportStartupOverhead;
  testProgression: ReportTestProgression;
  fileReadRedundancy: ReportFileReadRedundancy;
  defaultCollapsed?: boolean;
}

export const QualitySection = ({
  prompt,
  startup,
  testProgression,
  fileReadRedundancy,
  defaultCollapsed,
}: QualitySectionProps) => {
  return (
    <ReportSection title="质量信号" icon={BarChart3} defaultCollapsed={defaultCollapsed}>
      {/* Prompt quality */}
      <div className="mb-4">
        <div className="mb-2 text-xs font-medium text-text-muted">提示词质量</div>
        <div className="mb-2 flex items-center gap-2">
          <AssessmentBadge assessment={prompt.assessment} metricKey="promptQuality" />
        </div>
        <div className="text-xs text-text-secondary">{prompt.note}</div>
        <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div>
            <div className="text-xs text-text-muted">首条消息</div>
            <div className="text-sm font-medium text-text">
              {prompt.firstMessageLengthChars.toLocaleString()} 字符
            </div>
          </div>
          <div>
            <div className="text-xs text-text-muted">用户消息</div>
            <div className="text-sm font-medium text-text">{prompt.userMessageCount}</div>
          </div>
          <div>
            <div className="text-xs text-text-muted">纠正次数</div>
            <div className="text-sm font-medium text-text">{prompt.correctionCount}</div>
          </div>
          <div>
            <div className="text-xs text-text-muted">摩擦率</div>
            <div className="text-sm font-medium text-text">
              {(prompt.frictionRate * 100).toFixed(1)}%
            </div>
          </div>
        </div>
      </div>

      {/* Startup overhead */}
      <div className="mb-4">
        <div className="mb-2 flex items-center gap-2">
          <span className="text-xs font-medium text-text-muted">启动开销</span>
          <AssessmentBadge assessment={startup.overheadAssessment} metricKey="startup" />
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <div>
            <div className="text-xs text-text-muted">开始前消息数</div>
            <div className="text-sm font-medium text-text">{startup.messagesBeforeFirstWork}</div>
          </div>
          <div>
            <div className="text-xs text-text-muted">开始前 Token</div>
            <div className="text-sm font-medium text-text">
              {startup.tokensBeforeFirstWork.toLocaleString()}
            </div>
          </div>
          <div>
            <div className="text-xs text-text-muted">总量占比</div>
            <div className="text-sm font-medium text-text">{startup.pctOfTotal}%</div>
          </div>
        </div>
      </div>

      {/* File read redundancy */}
      <div className="mb-4">
        <div className="mb-2 flex items-center gap-2">
          <span className="text-xs font-medium text-text-muted">文件读取冗余</span>
          <AssessmentBadge
            assessment={fileReadRedundancy.redundancyAssessment}
            metricKey="fileReads"
          />
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <div>
            <div className="text-xs text-text-muted">总读取数</div>
            <div className="text-sm font-medium text-text">{fileReadRedundancy.totalReads}</div>
          </div>
          <div>
            <div className="text-xs text-text-muted">唯一文件数</div>
            <div className="text-sm font-medium text-text">{fileReadRedundancy.uniqueFiles}</div>
          </div>
          <div>
            <div className="text-xs text-text-muted">每文件读取数</div>
            <div className="text-sm font-medium text-text">
              {fileReadRedundancy.readsPerUniqueFile}x
            </div>
          </div>
        </div>
      </div>

      {/* Test progression */}
      <div>
        <div className="mb-2 text-xs font-medium text-text-muted">测试进展</div>
        <div className="mb-2 flex items-center gap-2">
          <AssessmentBadge assessment={testProgression.trajectory} metricKey="testTrajectory" />
          <span className="text-xs text-text-muted">{testProgression.snapshotCount} 个快照</span>
        </div>
        {testProgression.firstSnapshot && testProgression.lastSnapshot && (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="text-xs text-text-muted">首次运行</div>
              <div className="text-sm text-text">
                <span style={{ color: severityColor('good') }}>
                  {testProgression.firstSnapshot.passed} 通过
                </span>
                {' / '}
                <span style={{ color: severityColor('danger') }}>
                  {testProgression.firstSnapshot.failed} 失败
                </span>
              </div>
            </div>
            <div>
              <div className="text-xs text-text-muted">最近运行</div>
              <div className="text-sm text-text">
                <span style={{ color: severityColor('good') }}>
                  {testProgression.lastSnapshot.passed} 通过
                </span>
                {' / '}
                <span style={{ color: severityColor('danger') }}>
                  {testProgression.lastSnapshot.failed} 失败
                </span>
              </div>
            </div>
          </div>
        )}
      </div>
    </ReportSection>
  );
};
