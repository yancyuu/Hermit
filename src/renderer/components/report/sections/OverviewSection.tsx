import { assessmentColor } from '@renderer/utils/reportAssessments';
import { Activity } from 'lucide-react';

import { ReportSection } from '../ReportSection';

import type { ReportOverview } from '@renderer/types/sessionReport';

interface OverviewSectionProps {
  data: ReportOverview;
}

export const OverviewSection = ({ data }: OverviewSectionProps) => {
  return (
    <ReportSection title="概览" icon={Activity}>
      <div className="mb-3 truncate text-xs text-text-muted">{data.firstMessage}</div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div>
          <div className="text-xs text-text-muted">时长</div>
          <div className="text-sm font-medium text-text">{data.durationHuman}</div>
        </div>
        <div>
          <div className="text-xs text-text-muted">消息数</div>
          <div className="text-sm font-medium text-text">{data.totalMessages.toLocaleString()}</div>
        </div>
        <div>
          <div className="text-xs text-text-muted">上下文用量</div>
          <div
            className="text-sm font-medium"
            style={{ color: assessmentColor(data.contextAssessment) }}
          >
            {data.contextConsumptionPct != null ? `${data.contextConsumptionPct}%` : 'N/A'}
            {data.contextAssessment && (
              <span className="ml-1 text-xs">({data.contextAssessment})</span>
            )}
          </div>
        </div>
        <div>
          <div className="text-xs text-text-muted">压缩次数</div>
          <div className="text-sm font-medium text-text">{data.compactionCount}</div>
        </div>
        <div>
          <div className="text-xs text-text-muted">分支</div>
          <div className="truncate text-sm font-medium text-text">{data.gitBranch}</div>
        </div>
        <div>
          <div className="text-xs text-text-muted">子 Agent</div>
          <div className="text-sm font-medium text-text">{data.hasSubagents ? '是' : '否'}</div>
        </div>
        <div>
          <div className="text-xs text-text-muted">项目</div>
          <div className="truncate text-sm font-medium text-text" title={data.projectPath}>
            {data.projectPath}
          </div>
        </div>
        <div>
          <div className="text-xs text-text-muted">会话 ID</div>
          <div className="truncate text-sm font-medium text-text" title={data.sessionId}>
            {data.sessionId.slice(0, 12)}...
          </div>
        </div>
      </div>
    </ReportSection>
  );
};
