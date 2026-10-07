import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faTimes } from '@fortawesome/free-solid-svg-icons';

interface TagProps {
  label: string;
  /** Shown after the label, which is cut short first so the count stays visible. */
  count?: number;
  isSelected?: boolean;
  onClick?: () => void;
  onRemove?: () => void;
  variant?: 'default' | 'selected';
  size?: 'small' | 'medium';
  removable?: boolean;
}

export default function Tag({
  label,
  count,
  isSelected = false,
  onClick,
  onRemove,
  variant = 'default',
  size = 'small',
  removable = false,
}: TagProps) {
  const baseClasses =
    'px-3 py-1 text-sm rounded-full border transition-colors inline-flex items-center gap-1 max-w-full min-w-0';
  const sizeClasses = {
    small: 'text-xs px-2 py-0.5',
    medium: 'text-sm px-3 py-1',
  };

  const selected = variant === 'selected' || isSelected;
  const variantClasses = {
    default: isSelected
      ? 'bg-primary/10 text-primary border-primary/30'
      : 'bg-surface-container-high text-on-surface-variant border-outline-variant hover:bg-surface-container-highest hover:text-on-surface',
    selected: 'bg-primary/10 text-primary border-primary/30',
  };

  const cursorClass = onClick ? 'cursor-pointer' : 'cursor-default';
  const focusClass = onClick ? 'outline-none focus-visible:ring-2 focus-visible:ring-primary' : '';
  const classes = `${baseClasses} ${sizeClasses[size]} ${variantClasses[variant]} ${cursorClass} ${focusClass}`;

  const handleClick = (e: React.MouseEvent) => {
    if (onClick) {
      e.stopPropagation();
      onClick();
    }
  };

  const handleRemove = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (onRemove) {
      onRemove();
    }
  };

  const content = (
    <>
      <span className="truncate" title={label}>
        {label}
      </span>
      {count !== undefined && <span className="shrink-0">({count})</span>}
    </>
  );

  // A filter chip is a toggle button, so it can be reached and used from the keyboard.
  if (onClick && !removable) {
    return (
      <button
        type="button"
        className={classes}
        onClick={handleClick}
        aria-pressed={selected}
        aria-label={count !== undefined ? `${label} (${count})` : undefined}
        title={`Filter by ${label}`}
      >
        {content}
      </button>
    );
  }

  return (
    <span className={classes} onClick={handleClick}>
      {content}
      {removable && (
        <button
          type="button"
          onClick={handleRemove}
          className="ml-1 hover:text-error transition-colors cursor-pointer"
          title="Remove tag"
          aria-label={`Remove ${label}`}
        >
          <FontAwesomeIcon icon={faTimes} className="text-xs" />
        </button>
      )}
    </span>
  );
}
