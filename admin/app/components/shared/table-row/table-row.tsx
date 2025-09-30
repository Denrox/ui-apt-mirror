interface TableRowProps {
  readonly icon?: JSX.Element;
  readonly title: string | JSX.Element;
  readonly metadata?: JSX.Element;
  readonly actions?: JSX.Element;
  readonly onClick?: () => void;
  readonly className?: string;
  readonly cursorClass?: string;
}

export default function TableRow({
  icon,
  title,
  metadata,
  actions,
  onClick,
  className = '',
  cursorClass,
}: TableRowProps) {
  return (
    <div className={`flex w-auto items-center justify-between p-3 hover:bg-gray-50 ${className}`}>
      <div
        onClick={onClick}
        className={`flex items-center gap-2 ${cursorClass || ''}`}
      >
        {icon && <span className="text-lg">{icon}</span>}
        <div className="flex align-center font-medium">{title}</div>
      </div>
      <div className="flex items-center gap-4">
        {metadata && <div className="flex items-center gap-4">{metadata}</div>}
        {actions && <div className="flex items-center gap-2">{actions}</div>}
      </div>
    </div>
  );
}
