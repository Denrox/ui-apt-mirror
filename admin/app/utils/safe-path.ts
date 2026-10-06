import fs from 'fs';
import path from 'path';
import appConfig from '~/config/config.json';

/** Directories the file manager may work in. */
export function storageRoots(options: { includePrivate?: boolean } = {}): string[] {
  const roots = [appConfig.filesDir, appConfig.mirroredPackagesDir, appConfig.npmPackagesDir];
  if (options.includePrivate !== false && appConfig.privateFilesDir) {
    roots.push(appConfig.privateFilesDir);
  }
  return roots;
}

/**
 * Real path of `p`, following symlinks; for a path that does not exist yet,
 * the real path of its nearest existing ancestor plus the remaining segments.
 */
function realPathOf(p: string): string {
  let current = path.resolve(p);
  const rest: string[] = [];
  for (;;) {
    try {
      return path.join(fs.realpathSync(current), ...rest);
    } catch {
      const parent = path.dirname(current);
      if (parent === current) return path.join(current, ...rest);
      rest.unshift(path.basename(current));
      current = parent;
    }
  }
}

/** True when `candidate` is `root` itself or inside it. */
export function isWithin(candidate: string, root: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

/**
 * Resolve a client-supplied path and return its real location if it stays inside one
 * of `roots` (symlinks included), otherwise null.
 */
export function resolveInside(p: unknown, roots: string[]): string | null {
  if (typeof p !== 'string' || !p || p.includes('\0')) return null;
  const real = realPathOf(p);
  return roots.some((root) => isWithin(real, realPathOf(root))) ? real : null;
}

/** Like resolveInside, but the path must also not be one of the roots themselves. */
export function resolveBelow(p: unknown, roots: string[]): string | null {
  const real = resolveInside(p, roots);
  if (!real) return null;
  return roots.some((root) => realPathOf(root) === real) ? null : real;
}

export const MANAGED_DIR_ERROR = 'This folder is managed by the mirror; only deletion is allowed here';
export const SYNC_RUNNING_ERROR = 'A mirror sync is running; try again after it finishes';

/** Why a write to real path `target` is refused: mirror and npm dirs only allow removal, the mirror none during a sync. */
export function writeBlockedReason(
  target: string,
  op: 'add' | 'remove',
  syncRunning: boolean,
  dirs = { mirror: appConfig.mirroredPackagesDir, npm: appConfig.npmPackagesDir },
): string | null {
  if (syncRunning && resolveInside(target, [dirs.mirror])) return SYNC_RUNNING_ERROR;
  if (op === 'add' && resolveInside(target, [dirs.mirror, dirs.npm])) return MANAGED_DIR_ERROR;
  return null;
}
