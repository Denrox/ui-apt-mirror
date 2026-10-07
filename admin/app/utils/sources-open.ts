// Whether the admin Cheatsheets page shows its Sources panel, remembered per browser.

const KEY = 'cheatsheets.sourcesOpen';

/** Above this many sources the panel starts collapsed on desktop too. */
export const DESKTOP_OPEN_MAX_SOURCES = 5;

export function initialSourcesOpen(remembered: boolean | null, sourceCount: number, desktop: boolean): boolean {
  if (sourceCount === 0) return true; // nothing to search yet: show the Add form
  if (remembered !== null) return remembered;
  return desktop && sourceCount <= DESKTOP_OPEN_MAX_SOURCES;
}

export function readSourcesOpen(): boolean | null {
  try {
    const value = window.localStorage.getItem(KEY);
    return value === '1' ? true : value === '0' ? false : null;
  } catch {
    return null;
  }
}

export function rememberSourcesOpen(open: boolean) {
  try {
    window.localStorage.setItem(KEY, open ? '1' : '0');
  } catch {
    // Storage blocked: the choice lasts until the page is left.
  }
}
