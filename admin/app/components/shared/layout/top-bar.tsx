import { useSubmit } from 'react-router';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faRightFromBracket } from '@fortawesome/free-solid-svg-icons';

/** Desktop top bar: logout (hidden below lg). */
export default function TopBar() {
  const submit = useSubmit();
  const handleLogout = () =>
    submit(null, { action: '/logout', method: 'post' });

  return (
    <header className="hidden lg:flex h-16 shrink-0 items-center justify-end border-b border-outline-variant bg-background px-gutter">
      <button
        type="button"
        onClick={handleLogout}
        title="Logout"
        className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold text-error transition-colors hover:bg-error/10"
      >
        <FontAwesomeIcon icon={faRightFromBracket} className="text-[14px]" />
        <span>Logout</span>
      </button>
    </header>
  );
}
