import { Link } from 'react-router';
import classNames from 'classnames';
import { type ReactNode } from 'react';

interface NavLinkProps {
  readonly to: string;
  readonly isActive: boolean;
  readonly children: ReactNode;
  readonly onClick?: () => void;
}

export default function NavLink({
  to,
  isActive,
  children,
  onClick,
}: NavLinkProps) {
  return (
    <Link
      to={to}
      className={classNames(
        'text-[15px] block leading-[48px] min-h-[48px] flex-0 border-l-4 border-transparent px-[16px] w-[200px] text-center font-semibold cursor-pointer transition-colors duration-200',
        {
          'border-primary text-primary bg-primary/10': isActive,
          'text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface':
            !isActive,
        },
      )}
      onClick={onClick}
    >
      {children}
    </Link>
  );
}
