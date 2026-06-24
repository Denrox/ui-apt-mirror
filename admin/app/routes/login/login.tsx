import { useEffect } from 'react';
import { useActionData, useNavigation } from 'react-router';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faTerminal,
  faUser,
  faLock,
  faRightToBracket,
  faShieldHalved,
} from '@fortawesome/free-solid-svg-icons';
import { toast } from 'react-toastify';
import { loader } from './loader';
import { action } from './actions';

export function meta() {
  return [{ title: 'Login' }, { name: 'description', content: 'Admin Login' }];
}

export { loader, action };

export default function Login() {
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === 'submitting';

  useEffect(() => {
    if (actionData?.error) {
      toast.error(actionData.error);
    } else if (actionData?.success) {
      toast.success(actionData.message);
    }
  }, [actionData]);

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background px-4 py-12">
      {/* Atmospheric background glow */}
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -left-24 top-1/4 h-72 w-72 rounded-full bg-primary/10 blur-3xl" />
        <div className="absolute -right-24 bottom-1/4 h-72 w-72 rounded-full bg-primary-container/10 blur-3xl" />
      </div>

      <div className="relative w-full max-w-md">
        {/* Brand */}
        <div className="mb-8 flex flex-col items-center gap-2 text-center">
          <span className="grid h-12 w-12 place-items-center rounded-lg bg-surface-container-high text-primary shadow-inner">
            <FontAwesomeIcon icon={faTerminal} className="text-[22px]" />
          </span>
          <div className="font-heading text-lg font-bold text-primary">
            Apt Mirror
          </div>
          <div className="text-sm text-on-surface-variant">
            Administration Console
          </div>
        </div>

        {/* Card */}
        <div className="rounded-xl border border-outline-variant bg-surface-container-low p-6 shadow-2xl">
          <div className="mb-6 text-center">
            <div className="font-heading text-base font-bold text-on-surface">
              Secure Access
            </div>
            <div className="mt-1 text-[11px] font-medium uppercase tracking-[0.2em] text-on-surface-variant">
              Authorized Personnel Only
            </div>
          </div>

          <form className="space-y-5" action="/login" method="post">
            <div>
              <label
                htmlFor="username"
                className="mb-1.5 block text-sm font-semibold text-on-surface-variant"
              >
                Username
              </label>
              <div className="relative">
                <FontAwesomeIcon
                  icon={faUser}
                  className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant/60 text-[14px]"
                />
                <input
                  id="username"
                  name="username"
                  type="text"
                  autoComplete="username"
                  placeholder="operator_id"
                  disabled={isSubmitting}
                  className="w-full rounded-lg border border-outline-variant bg-surface-container-lowest py-2.5 pl-10 pr-4 text-sm text-on-surface placeholder:text-on-surface-variant/40 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-50"
                />
              </div>
            </div>

            <div>
              <label
                htmlFor="password"
                className="mb-1.5 block text-sm font-semibold text-on-surface-variant"
              >
                Password
              </label>
              <div className="relative">
                <FontAwesomeIcon
                  icon={faLock}
                  className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant/60 text-[14px]"
                />
                <input
                  id="password"
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  placeholder="••••••••••••"
                  disabled={isSubmitting}
                  className="w-full rounded-lg border border-outline-variant bg-surface-container-lowest py-2.5 pl-10 pr-4 text-sm text-on-surface placeholder:text-on-surface-variant/40 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-50"
                />
              </div>
            </div>

            <label className="flex items-center gap-2 text-sm text-on-surface-variant">
              <input
                type="checkbox"
                name="remember"
                className="h-4 w-4 rounded border-outline-variant bg-surface-container-lowest accent-primary focus:ring-primary"
              />
              Remember this terminal session
            </label>

            <button
              type="submit"
              disabled={isSubmitting}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary-container py-2.5 text-sm font-bold text-on-primary-container shadow-lg shadow-primary/10 transition hover:brightness-110 disabled:opacity-50"
            >
              <FontAwesomeIcon
                icon={faRightToBracket}
                className="text-[14px]"
              />
              {isSubmitting ? 'Authenticating…' : 'Authenticate Session'}
            </button>

            <div className="flex items-center justify-center gap-2 text-[11px] text-on-surface-variant">
              <span className="h-2 w-2 rounded-full bg-success" />
              Server: Online
              <span className="text-outline-variant">·</span>
              <FontAwesomeIcon icon={faShieldHalved} className="text-[11px]" />
              Encrypted (AES-256)
            </div>
          </form>
        </div>

        <p className="mt-6 text-center text-[11px] text-on-surface-variant/70">
          © {new Date().getFullYear()} Apt Mirror Utility Systems. All nodes
          logged.
        </p>
      </div>
    </div>
  );
}
