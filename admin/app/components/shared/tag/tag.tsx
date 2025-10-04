import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faTimes } from '@fortawesome/free-solid-svg-icons';

interface TagProps {
  label: string;
  isSelected?: boolean;
  onClick?: () => void;
  onRemove?: () => void;
  variant?: 'default' | 'selected';
  size?: 'small' | 'medium';
  removable?: boolean;
}

export default function Tag({ 
  label, 
  isSelected = false, 
  onClick, 
  onRemove,
  variant = 'default',
  size = 'small',
  removable = false
}: TagProps) {
  const baseClasses = 'px-3 py-1 text-sm rounded-full border transition-colors flex items-center gap-1';
  const sizeClasses = {
    small: 'text-xs px-2 py-0.5',
    medium: 'text-sm px-3 py-1'
  };
  
  const variantClasses = {
    default: isSelected 
      ? 'bg-blue-100 text-blue-800 border-blue-300' 
      : 'bg-gray-100 text-gray-700 border-gray-300 hover:bg-gray-200',
    selected: 'bg-blue-100 text-blue-800 border-blue-300'
  };

  const cursorClass = onClick ? 'cursor-pointer' : 'cursor-default';
  const classes = `${baseClasses} ${sizeClasses[size]} ${variantClasses[variant]} ${cursorClass}`;

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

  return (
    <span 
      className={classes}
      onClick={handleClick}
      title={onClick ? `Filter by ${label}` : undefined}
    >
      {label}
      {removable && (
        <button
          onClick={handleRemove}
          className="ml-1 hover:text-red-600 transition-colors cursor-pointer"
          title="Remove tag"
        >
          <FontAwesomeIcon icon={faTimes} className="text-xs" />
        </button>
      )}
    </span>
  );
}
