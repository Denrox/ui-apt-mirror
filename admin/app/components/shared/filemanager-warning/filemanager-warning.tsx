import React from 'react';
import FormButton from '~/components/shared/form/form-button';

interface WarningProps {
  type: 'warning' | 'error' | 'info';
  message: string;
  details?: string[];
  actionLabel?: string;
  onAction?: () => void;
  actionIcon?: string;
}

export default function Warning({
  type,
  message,
  details,
  actionLabel,
  onAction,
  actionIcon = '🗑️',
}: WarningProps) {
  const getStyles = () => {
    switch (type) {
      case 'warning':
        return 'bg-yellow-50 border-yellow-200 text-yellow-700';
      case 'error':
        return 'bg-red-50 border-red-200 text-red-700';
      case 'info':
        return 'bg-blue-50 border-blue-200 text-blue-700';
      default:
        return 'bg-yellow-50 border-yellow-200 text-yellow-700';
    }
  };

  const getIcon = () => {
    switch (type) {
      case 'warning':
        return '⚠️';
      case 'error':
        return '❌';
      case 'info':
        return 'ℹ️';
      default:
        return '⚠️';
    }
  };

  return (
    <div className={`p-3 border rounded-md ${getStyles()}`}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">
              {getIcon()} {message}
            </span>
          </div>
          {details && details.length > 0 && (
            <div className="text-xs space-y-[4px] mt-[4px] max-h-[64px] overflow-y-auto">
              {details.map((detail, index) => (
                <div
                  key={index}
                  className="font-mono bg-white/50 px-2 py-1 rounded"
                >
                  {detail}
                </div>
              ))}
            </div>
          )}
        </div>
        {actionLabel && onAction && (
          <FormButton type="secondary" size="small" onClick={onAction}>
            {actionIcon} {actionLabel}
          </FormButton>
        )}
      </div>
    </div>
  );
}
