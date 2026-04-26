import cronstrue from 'cronstrue/i18n';

/**
 * Format an ISO date string as a human-readable "next run" label.
 * Shows relative time for runs within 24h, absolute date otherwise.
 */
export function formatNextRun(isoString?: string): string {
  if (!isoString) return '暂无';
  try {
    const date = new Date(isoString);
    const now = Date.now();
    const diffMs = date.getTime() - now;

    if (diffMs < 0) return '已逾期';

    const hours = Math.floor(diffMs / 3600_000);
    const minutes = Math.floor((diffMs % 3600_000) / 60_000);

    if (hours > 24) {
      return date.toLocaleDateString('zh-CN', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      });
    }
    if (hours > 0) return `${hours} 小时 ${minutes} 分钟后`;
    if (minutes > 0) return `${minutes} 分钟后`;
    return '即将运行';
  } catch {
    return isoString;
  }
}

/**
 * Convert a cron expression to a human-readable description.
 */
export function getCronDescription(expression: string): string {
  try {
    return cronstrue.toString(expression, { locale: 'zh_CN', use24HourTimeFormat: true });
  } catch {
    return expression;
  }
}
