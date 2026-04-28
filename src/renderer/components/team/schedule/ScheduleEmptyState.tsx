import React from 'react';

import { Calendar } from 'lucide-react';

export const ScheduleEmptyState = (): React.JSX.Element => (
  <div className="flex flex-col items-center justify-center gap-2 py-8 text-center">
    <Calendar className="size-8 text-[var(--color-text-muted)]" />
    <div className="space-y-1">
      <p className="text-xs font-medium text-[var(--color-text-secondary)]">暂无定时计划</p>
      <p className="text-[11px] text-[var(--color-text-muted)]">
        创建计划后，可按 cron 时间自动运行 Claude 任务。
      </p>
    </div>
  </div>
);
