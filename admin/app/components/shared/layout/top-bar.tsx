import { useSubmit } from 'react-router';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faBell,
  faHeartPulse,
  faRightFromBracket,
} from '@fortawesome/free-solid-svg-icons';

/** Desktop top bar: status icons, logout (hidden below lg). */
export default function TopBar() {
  const submit = useSubmit();
  const handleLogout = () =>
    submit(null, { action: '/logout', method: 'post' });

  return (
    <header className="hidden lg:flex h-16 shrink-0 items-center justify-end gap-4 border-b border-outline-variant bg-background px-gutter">
      <div className="flex items-center gap-1">
        <button
          type="button"
          title="System health"
          className="grid h-9 w-9 place-items-center rounded-lg text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-primary"
        >
          <FontAwesomeIcon icon={faHeartPulse} className="text-[16px]" />
        </button>
        <button
          type="button"
          title="Notifications"
          className="relative grid h-9 w-9 place-items-center rounded-lg text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-primary"
        >
          <FontAwesomeIcon icon={faBell} className="text-[16px]" />
          <span className="absolute right-2 top-2 h-1.5 w-1.5 rounded-full bg-error" />
        </button>
        <div className="mx-2 h-6 w-px bg-outline-variant" />
        <button
          type="button"
          onClick={handleLogout}
          title="Logout"
          className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold text-error transition-colors hover:bg-error/10"
        >
          <FontAwesomeIcon icon={faRightFromBracket} className="text-[14px]" />
          <span>Logout</span>
        </button>
      </div>
    </header>
  );
}
