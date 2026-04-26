import { Button } from '@renderer/components/ui/button';

interface TeamEmptyStateProps {
  canCreate: boolean;
  onCreateTeam: () => void;
}

export const TeamEmptyState = ({
  canCreate,
  onCreateTeam,
}: TeamEmptyStateProps): React.JSX.Element => {
  return (
    <div className="flex size-full items-center justify-center">
      <div className="text-center">
        <p className="text-lg font-medium text-[var(--color-text)]">没有找到团队</p>
        <p className="mt-2 text-sm text-[var(--color-text-muted)]">
          在这里创建团队即可开始，创建后会自动显示在列表中。
        </p>
        <div className="mt-4">
          <Button size="sm" disabled={!canCreate} onClick={onCreateTeam}>
            创建团队
          </Button>
        </div>
        {!canCreate ? (
          <p className="mt-2 text-xs text-[var(--color-text-muted)]">
            只有本地桌面模式支持创建团队。
          </p>
        ) : null}
      </div>
    </div>
  );
};
