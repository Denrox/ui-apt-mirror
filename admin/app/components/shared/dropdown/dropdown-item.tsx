import React from 'react';

interface DropdownItemProps {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
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
      className={`w-full text-left px-4 py-2 text-sm hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer ${
        disabled ? 'text-gray-400' : 'text-gray-700'
      }`}
    >
      {children}
    </button>
  );
}
