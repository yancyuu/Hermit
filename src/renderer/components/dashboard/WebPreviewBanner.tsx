import { isElectronMode } from '@renderer/api';
import { FlaskConical } from 'lucide-react';

export const WebPreviewBanner = (): React.JSX.Element | null => {
  if (isElectronMode()) {
    return null;
  }

  return (
    <div
      className="mb-6 flex items-start gap-3 rounded-lg border px-4 py-3"
      style={{
        borderColor: 'rgba(217, 119, 6, 0.28)',
        backgroundColor: 'rgba(245, 158, 11, 0.14)',
      }}
    >
      <FlaskConical className="mt-0.5 size-4 shrink-0 text-amber-600" />
      <div className="min-w-0">
        <p className="text-sm font-medium text-amber-900">Web 版本仍在开发中</p>
        <p className="mt-1 text-xs leading-relaxed text-amber-800">
          部分桌面端功能暂未在浏览器中开放。项目操作、集成能力和实时状态数据可能受限或暂不可用。
        </p>
      </div>
    </div>
  );
};
