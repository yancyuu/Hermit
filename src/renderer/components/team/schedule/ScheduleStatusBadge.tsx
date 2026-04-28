import React from 'react';

import type { ScheduleRunStatus, ScheduleStatus } from '@shared/types';

// =============================================================================
// Schedule Status Badge
// =============================================================================

const SCHEDULE_STATUS_CONFIG: Record<ScheduleStatus, { label: string; className: string }> = {
  active: {
    label: '启用',
    className: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/20',
  },
  paused: { label: '已暂停', className: 'bg-amber-500/15 text-amber-400 border-amber-500/20' },
  disabled: { label: '已禁用', className: 'bg-zinc-500/15 text-zinc-400 border-zinc-500/20' },
};

interface ScheduleStatusBadgeProps {
  status: ScheduleStatus;
}

export const ScheduleStatusBadge = ({ status }: ScheduleStatusBadgeProps): React.JSX.Element => {
  const config = SCHEDULE_STATUS_CONFIG[status];
  return (
    <span
      className={`inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px] font-medium ${config.className}`}
    >
      {config.label}
    </span>
  );
};

// =============================================================================
// Run Status Badge
// =============================================================================

const RUN_STATUS_CONFIG: Record<ScheduleRunStatus, { label: string; className: string }> = {
  pending: { label: '等待中', className: 'text-zinc-400' },
  warming_up: { label: '预热中', className: 'text-blue-400' },
  warm: { label: '已预热', className: 'text-cyan-400' },
  running: { label: '运行中', className: 'text-emerald-400' },
  completed: { label: '已完成', className: 'text-emerald-400' },
  failed: { label: '失败', className: 'text-red-400' },
  failed_interrupted: { label: '已中断', className: 'text-amber-400' },
  cancelled: { label: '已取消', className: 'text-zinc-400' },
};

interface RunStatusBadgeProps {
  status: ScheduleRunStatus;
}

export const RunStatusBadge = ({ status }: RunStatusBadgeProps): React.JSX.Element => {
  const config = RUN_STATUS_CONFIG[status];
  return <span className={`text-[10px] font-medium ${config.className}`}>{config.label}</span>;
};
