import React from 'react';

import { Checkbox } from '@renderer/components/ui/checkbox';
import { Label } from '@renderer/components/ui/label';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@renderer/components/ui/tooltip';
import { Info } from 'lucide-react';

interface LimitContextCheckboxProps {
  id: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
}

export const LimitContextCheckbox: React.FC<LimitContextCheckboxProps> = ({
  id,
  checked,
  onCheckedChange,
  disabled = false,
}) => (
  <div className="mt-4 flex items-center gap-2">
    <Checkbox
      id={id}
      checked={checked && !disabled}
      disabled={disabled}
      onCheckedChange={(value) => onCheckedChange(value === true)}
    />
    <Label
      htmlFor={id}
      className={`flex cursor-pointer items-center gap-1.5 text-xs font-normal ${
        disabled ? 'cursor-not-allowed text-text-muted opacity-50' : 'text-text-secondary'
      }`}
    >
      将上下文限制为 200K tokens
      {disabled && <span className="text-[10px] italic">（该模型固定为 200K）</span>}
    </Label>
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Info
            className={`size-3.5 shrink-0 ${disabled ? 'text-text-muted opacity-50' : 'text-text-muted hover:text-text-secondary'} cursor-help`}
          />
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-[260px]">
          <p>
            智能体会使用 200K 上下文窗口，而不是默认 1M。适合在希望节省 tokens、降低成本时开启。
          </p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  </div>
);
