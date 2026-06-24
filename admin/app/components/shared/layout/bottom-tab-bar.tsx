import { Link, useLocation } from 'react-router';
import classNames from 'classnames';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { navItems } from '../nav/nav-config';

/** Mobile bottom tab bar (visible below lg). */
export default function BottomTabBar() {
  const { pathname } = useLocation();

  return (
    <nav className="lg:hidden flex h-16 shrink-0 items-stretch justify-around border-t border-outline-variant bg-surface">
      {navItems
        .filter((item) => item.inBottomBar !== false)
        .map((item) => {
          const active = item.isActive(pathname);
          return (
            <Link
              key={item.href}
              to={item.href}
              title={item.label}
              className={classNames(
                'flex flex-1 flex-col items-center justify-center gap-0.5 transition-colors active:scale-95',
                active
                  ? 'text-primary font-semibold'
                  : 'text-on-surface-variant hover:text-on-surface',
              )}
            >
              <FontAwesomeIcon icon={item.icon} className="text-[17px]" />
              <span className="text-[10px] leading-none">{item.short}</span>
              <span
                className={classNames(
                  'mt-0.5 h-1 w-1 rounded-full',
                  active ? 'bg-primary' : 'bg-transparent',
                )}
              />
            </Link>
          );
        })}
    </nav>
  );
}
