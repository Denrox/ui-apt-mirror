import type { PropsWithChildren } from 'react';

interface FormButtonProps {
  readonly onClick?: () => void;
  readonly type?: 'primary' | 'secondary' | 'danger';
  readonly buttonType?: 'button' | 'submit' | 'reset';
  readonly disabled?: boolean;
  readonly size?: 'small' | 'medium' | 'large';
}

export default function FormButton({
  children,
  onClick,
  type = 'primary',
  buttonType = 'button',
  disabled = false,
  size = 'medium',
}: PropsWithChildren<FormButtonProps>) {
  const baseClasses =
    'font-semibold rounded-lg outline-none focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer whitespace-nowrap transition-colors';

  const typeClasses = {
    primary: 'bg-primary text-on-primary hover:brightness-110',
    secondary:
      'bg-secondary-container text-on-secondary-container hover:brightness-110',
    danger: 'bg-error-container text-on-error-container hover:brightness-110',
  };

  const sizeClasses = {
    small: 'h-[32px] px-[12px] text-[12px]',
    medium: 'h-[40px] px-[16px] text-[14px]',
    large: 'h-[48px] px-[20px] text-[16px]',
  };

  return (
    <button
      type={buttonType}
      onClick={onClick}
      disabled={disabled}
      className={`${baseClasses} ${typeClasses[type]} ${sizeClasses[size]}`}
    >
      {children}
    </button>
  );
}
