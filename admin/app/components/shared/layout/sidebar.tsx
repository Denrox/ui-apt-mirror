import { Link, useLocation } from 'react-router';
import classNames from 'classnames';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faTerminal } from '@fortawesome/free-solid-svg-icons';
import { navItems } from '../nav/nav-config';

/** Fixed 260px desktop sidebar (hidden below lg). */
export default function Sidebar() {
  const { pathname } = useLocation();

  return (
    <aside className="hidden lg:flex w-sidebar shrink-0 flex-col border-r border-outline-variant bg-surface">
      {/* Brand */}
      <Link
        to="/home"
        className="flex items-center gap-3 px-gutter py-stack-md"
      >
        <span className="grid h-9 w-9 place-items-center rounded-lg bg-surface-container-high text-primary">
          <FontAwesomeIcon icon={faTerminal} className="text-[18px]" />
        </span>
        <div className="leading-tight">
          <div className="font-heading text-lg font-bold text-primary">
            Apt Mirror
          </div>
          <div className="text-[11px] text-on-surface-variant">
            Admin Console
          </div>
        </div>
      </Link>

      {/* Nav */}
      <nav className="flex flex-col gap-1 px-3 pb-stack-md">
        {navItems.map((item) => {
          const active = item.isActive(pathname);
          return (
            <Link
              key={item.href}
              to={item.href}
              title={item.label}
              className={classNames(
                'flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors',
                active
                  ? 'bg-primary/10 text-primary font-semibold'
                  : 'text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface',
              )}
            >
              <FontAwesomeIcon
                icon={item.icon}
                className="w-5 text-center text-[16px]"
              />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
