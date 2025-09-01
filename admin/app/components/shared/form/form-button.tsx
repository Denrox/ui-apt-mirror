import type { PropsWithChildren } from 'react';

interface FormButtonProps {
  readonly onClick: () => void;
  readonly type?: 'primary' | 'secondary' | 'danger';
  readonly disabled?: boolean;
  readonly size?: 'small' | 'medium' | 'large';
}

export default function FormButton({
  children,
  onClick,
  type = 'primary',
  disabled = false,
  size = 'medium',
}: PropsWithChildren<FormButtonProps>) {
  const baseClasses =
    'font-semibold rounded-md outline-none focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer whitespace-nowrap';

  const typeClasses = {
    primary: 'bg-blue-600 text-white hover:bg-blue-700 focus:ring-blue-500',
    secondary:
      'bg-gray-200 text-gray-700 hover:bg-gray-300 focus:ring-gray-500',
    danger: 'bg-red-600 text-white hover:bg-red-700 focus:ring-red-500',
  };

  const sizeClasses = {
    small: 'h-[32px] px-[12px] text-[12px]',
    medium: 'h-[40px] px-[16px] text-[14px]',
    large: 'h-[48px] px-[20px] text-[16px]',
  };

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`${baseClasses} ${typeClasses[type]} ${sizeClasses[size]}`}
    >
      {children}
    </button>
  );
}
