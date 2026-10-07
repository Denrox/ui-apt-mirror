import { type JSX, type KeyboardEvent } from 'react';

interface TableRowProps {
  readonly icon?: JSX.Element;
  readonly title: string | JSX.Element;
  readonly metadata?: JSX.Element;
  readonly actions?: JSX.Element;
  readonly onClick?: () => void;
  /**
   * Makes the row's title a keyboard-operable button with this name (e.g.
   * "Open folder docs"). Rows whose click only repeats an action button
   * leave it out, so the keyboard doesn't stop twice.
   */
  readonly openLabel?: string;
  readonly className?: string;
  readonly cursorClass?: string;
}

export default function TableRow({
  icon,
  title,
  metadata,
  actions,
  onClick,
  openLabel,
  className = '',
  cursorClass,
}: TableRowProps) {
  const button = Boolean(openLabel && onClick);
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onClick?.();
    }
  };
  return (
    <div
      className={`flex w-auto items-center justify-between p-3 hover:bg-surface-container transition-colors ${className}`}
    >
      <div
        onClick={onClick}
        className={`flex items-center gap-2 ${cursorClass || ''} ${
          button ? 'rounded outline-none focus-visible:ring-2 focus-visible:ring-primary' : ''
        }`}
        {...(button
          ? { role: 'button', tabIndex: 0, 'aria-label': openLabel, onKeyDown }
          : {})}
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
