import { type ReactNode } from 'react';

interface DropdownItemProps {
  readonly children: ReactNode;
  readonly onClick?: () => void;
  readonly disabled?: boolean;
  /** Tooltip, e.g. the full text of a long label. */
  readonly title?: string;
}

export default function DropdownItem({
  children,
  onClick,
  disabled = false,
  title,
}: DropdownItemProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`w-full text-left px-4 py-2 [overflow-wrap:anywhere] text-sm hover:bg-surface-container-high disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer transition-colors ${
        disabled ? 'text-on-surface-variant/50' : 'text-on-surface'
      }`}
    >
      {children}
    </button>
  );
}
