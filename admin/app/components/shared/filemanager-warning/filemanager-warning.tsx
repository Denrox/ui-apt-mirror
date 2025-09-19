import FormButton from '~/components/shared/form/form-button';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { 
  faExclamationTriangle, 
  faTimesCircle, 
  faInfoCircle,
  faTrash
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
        return 'bg-gray-100 border-gray-300 text-gray-700';
      case 'error':
        return 'bg-gray-200 border-gray-400 text-gray-800';
      case 'info':
        return 'bg-gray-50 border-gray-200 text-gray-600';
      default:
        return 'bg-gray-100 border-gray-300 text-gray-700';
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
                  className="font-mono bg-white/50 px-2 py-1 rounded"
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
