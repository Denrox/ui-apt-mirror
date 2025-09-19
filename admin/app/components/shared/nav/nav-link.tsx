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
        'text-[16px] block leading-[48px] min-h-[48px] flex-0 border-l-4 border-transparent hover:border-gray-600 px-[16px] w-[200px] hover:text-gray-800 hover:bg-gray-300 text-center font-semibold cursor-pointer lg:mb-0 transition-all duration-200 rounded-t',
        {
          'border-gray-700 text-gray-900 bg-gray-300 shadow-md': isActive,
          'bg-gray-200 text-gray-700': !isActive,
        },
      )}
      onClick={onClick}
    >
      {children}
    </Link>
  );
}
