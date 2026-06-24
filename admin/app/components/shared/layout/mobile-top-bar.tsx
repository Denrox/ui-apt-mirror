import { Link, useSubmit } from 'react-router';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faTerminal,
  faBell,
  faRightFromBracket,
} from '@fortawesome/free-solid-svg-icons';

/** Mobile top app bar: brand + actions (visible below lg). */
export default function MobileTopBar() {
  const submit = useSubmit();
  const handleLogout = () =>
    submit(null, { action: '/logout', method: 'post' });

  return (
    <header className="lg:hidden flex h-16 shrink-0 items-center justify-between border-b border-outline-variant bg-background px-4">
      <Link to="/home" className="flex items-center gap-2">
        <span className="grid h-8 w-8 place-items-center rounded-lg bg-surface-container-high text-primary">
          <FontAwesomeIcon icon={faTerminal} className="text-[16px]" />
        </span>
        <span className="font-heading text-base font-bold text-primary">
          Apt Mirror
        </span>
      </Link>
      <div className="flex items-center gap-1">
        <button
          type="button"
          title="Notifications"
          className="relative grid h-9 w-9 place-items-center rounded-lg text-on-surface-variant transition-colors hover:bg-surface-container-high"
        >
          <FontAwesomeIcon icon={faBell} className="text-[16px]" />
          <span className="absolute right-2 top-2 h-1.5 w-1.5 rounded-full bg-error" />
        </button>
        <button
          type="button"
          onClick={handleLogout}
          title="Logout"
          className="grid h-9 w-9 place-items-center rounded-lg text-error transition-colors hover:bg-error/10 active:scale-95"
        >
          <FontAwesomeIcon icon={faRightFromBracket} className="text-[16px]" />
        </button>
      </div>
    </header>
  );
}
