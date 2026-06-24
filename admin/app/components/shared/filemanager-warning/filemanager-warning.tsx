import FormButton from '~/components/shared/form/form-button';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faExclamationTriangle,
  faTimesCircle,
  faInfoCircle,
  faTrash,
} from '@fortawesome/free-solid-svg-icons';

interface WarningProps {
  readonly type: 'warning' | 'error' | 'info';
  readonly message: string;
  readonly details?: string[];
  readonly actionLabel?: string;
  readonly onAction?: () => void;
  readonly actionIcon?: React.ReactNode;
}

export default function Warning({
  type,
  message,
  details,
  actionLabel,
  onAction,
  actionIcon = <FontAwesomeIcon icon={faTrash} />,
}: WarningProps) {
  const getStyles = () => {
    switch (type) {
      case 'warning':
        return 'bg-tertiary/10 border-tertiary/20 text-tertiary';
      case 'error':
        return 'bg-error/10 border-error/20 text-error';
      case 'info':
        return 'bg-primary/10 border-primary/20 text-primary';
      default:
        return 'bg-tertiary/10 border-tertiary/20 text-tertiary';
    }
  };

  const getIcon = () => {
    switch (type) {
      case 'warning':
        return <FontAwesomeIcon icon={faExclamationTriangle} />;
      case 'error':
        return <FontAwesomeIcon icon={faTimesCircle} />;
      case 'info':
        return <FontAwesomeIcon icon={faInfoCircle} />;
      default:
        return <FontAwesomeIcon icon={faExclamationTriangle} />;
    }
  };

  return (
    <div className={`p-3 border rounded-md ${getStyles()}`}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex-1">
          <div className="flex items-center gap-2 justify-between">
            <span className="text-sm font-medium">
              {getIcon()} {message}
            </span>
            {actionLabel && onAction && (
              <FormButton type="secondary" size="small" onClick={onAction}>
                {actionIcon} {actionLabel}
              </FormButton>
            )}
          </div>
          {details && details.length > 0 && (
            <div className="text-xs space-y-[4px] mt-[4px] max-h-[64px] overflow-auto w-full">
              {details.map((detail) => (
                <div
                  key={detail}
                  className="font-mono bg-surface-container-lowest px-2 py-1 rounded"
                >
                  {detail}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
