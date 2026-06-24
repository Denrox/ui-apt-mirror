import { type ReactNode } from 'react';

interface DropdownItemProps {
  readonly children: ReactNode;
  readonly onClick?: () => void;
  readonly disabled?: boolean;
}

export default function DropdownItem({
  children,
  onClick,
  disabled = false,
}: DropdownItemProps) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`w-full text-left px-4 py-2 text-sm hover:bg-surface-container-high disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer transition-colors ${
        disabled ? 'text-on-surface-variant/50' : 'text-on-surface'
      }`}
    >
      {children}
    </button>
  );
}
