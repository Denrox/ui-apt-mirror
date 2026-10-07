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

/**
 * Location of the directory entry `p` names, for operations on the entry itself (delete,
 * rename, move): the parent directory is resolved and must be inside one of `roots`, the
 * last segment is kept as is. A symlink therefore stays the link, never its target.
 * Returns null for a root itself or anything outside the roots.
 */
export function resolveEntry(p: unknown, roots: string[]): string | null {
  if (typeof p !== 'string' || !p || p.includes('\0')) return null;
  const absolute = path.resolve(p);
  const name = path.basename(absolute);
  if (!name || name === '.' || name === '..') return null;
  const parent = resolveInside(path.dirname(absolute), roots);
  if (!parent) return null;
  const entry = path.join(parent, name);
  return roots.some((root) => realPathOf(root) === entry) ? null : entry;
}

/** Real location of the entry `p` names without following a symlink in its last segment. */
function entryPathOf(p: string): string {
  const absolute = path.resolve(p);
  return path.join(realPathOf(path.dirname(absolute)), path.basename(absolute));
}

/** True when the entry `p` or, for a symlink, its target is `root` or inside it. */
function touches(p: string, root: string): boolean {
  const realRoot = realPathOf(root);
  return isWithin(entryPathOf(p), realRoot) || isWithin(realPathOf(p), realRoot);
}

export const MANAGED_DIR_ERROR = 'This folder is managed by the mirror; only deletion is allowed here';
export const SYNC_RUNNING_ERROR = 'A mirror sync is running; try again after it finishes';

/** Why a write to the entry `target` is refused: mirror and npm dirs only allow removal, the mirror none during a sync. */
export function writeBlockedReason(
  target: string,
  op: 'add' | 'remove',
  syncRunning: boolean,
  dirs = { mirror: appConfig.mirroredPackagesDir, npm: appConfig.npmPackagesDir },
): string | null {
  if (syncRunning && touches(target, dirs.mirror)) return SYNC_RUNNING_ERROR;
  if (op === 'add' && (touches(target, dirs.mirror) || touches(target, dirs.npm))) {
    return MANAGED_DIR_ERROR;
  }
  return null;
}
