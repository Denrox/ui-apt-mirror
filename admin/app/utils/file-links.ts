/** Storage dirs the file manager shows, as configured. */
export interface StorageDirs {
  filesDir: string;
  privateFilesDir: string;
  mirroredPackagesDir: string;
  mirrorRoot: string;
  npmPackagesDir: string;
}

export type FileManagerView = 'public-files' | 'private-files' | 'mirrored-packages' | 'npm-packages';

const trimSlash = (p: string) => p.replace(/\/+$/, '');

/** `p` relative to `dir` ('' for dir itself), or null when it is not inside it. */
export function relativeTo(p: string, dir: string): string | null {
  const root = trimSlash(dir);
  if (!root) return null;
  if (p === root) return '';
  return p.startsWith(`${root}/`) ? p.slice(root.length + 1) : null;
}

/** The view a path belongs to; a path in no known dir shows as public files. */
export function viewOfPath(p: string | null | undefined, dirs: StorageDirs): FileManagerView {
  if (!p) return 'public-files';
  if (relativeTo(p, dirs.mirroredPackagesDir) !== null) return 'mirrored-packages';
  if (relativeTo(p, dirs.npmPackagesDir) !== null) return 'npm-packages';
  if (relativeTo(p, dirs.privateFilesDir) !== null) return 'private-files';
  return 'public-files';
}

/**
 * Whether the file manager offers to delete `p`. In the mirror dir only entries inside the
 * published tree can be deleted, never the signing keys or the mirror folders themselves
 * (the server enforces this too).
 */
export function canDelete(p: string, dirs: StorageDirs): boolean {
  if (relativeTo(p, dirs.mirroredPackagesDir) === null) return true;
  return Boolean(relativeTo(p, dirs.mirrorRoot));
}

/** URL path for a relative file path: every segment percent-encoded, so `#`, `%` and `?` survive. */
export function encodePathSegments(relative: string): string {
  return relative.split('/').map(encodeURIComponent).join('/');
}

/**
 * Where the browser can fetch the file at `p`: private files through the admin route, public
 * files from the files host, mirror files from the mirror host. Null when no host serves it
 * (npm cache, mirror keys and state).
 */
export function fileUrl(
  p: string,
  dirs: StorageDirs,
  hosts: { files: string; mirror: string },
): string | null {
  if (relativeTo(p, dirs.privateFilesDir) !== null) {
    return `/api/download-private?path=${encodeURIComponent(p)}`;
  }
  const inFiles = relativeTo(p, dirs.filesDir);
  if (inFiles) return `${hosts.files}/downloads/${encodePathSegments(inFiles)}`;
  const inMirror = relativeTo(p, dirs.mirrorRoot);
  if (inMirror) return `${hosts.mirror}/${encodePathSegments(inMirror)}`;
  return null;
}
