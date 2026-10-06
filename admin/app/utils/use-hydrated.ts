import { useSyncExternalStore } from 'react';

const subscribe = () => () => {};

/**
 * False on the server and during hydration, true afterwards. Values that differ
 * between server and browser (time zone, locale, window size) go behind it, or
 * React discards the server HTML (error #418) and input typed so far.
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
}

/** A fixed UTC format until hydrated, then the browser's local time. */
export function formatDateTime(value: Date | string, local: boolean): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  if (!local) return `${date.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
  return `${date.toLocaleDateString()} ${date.toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })}`;
}
