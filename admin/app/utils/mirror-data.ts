import fs from 'fs/promises';
import path from 'path';
import type { MirrorConfig } from '~/utils/mirror-config';

/**
 * Where apt-mirror2 stores a repository, relative to its mirror (and skel) folder: the URL's
 * host[:port] as written, then its path (`url.as_filesystem_path`). Null for a URI that is not
 * http(s) or has no safe path.
 */
export function mirrorDirOf(uri: string): string | null {
  const match = /^https?:\/\/([^/]+)(\/[^?#]*)?$/i.exec(uri.trim());
  if (!match) return null;
  const host = match[1].slice(match[1].lastIndexOf('@') + 1);
  const parts = [host, ...(match[2] ?? '').split('/')].filter(Boolean);
  if (!host || parts.some((p) => p === '.' || p === '..')) return null;
  return parts.join('/');
}

/** Mirror folders of URIs that no enabled deb line in the config still uses (or shares a folder with). */
export function unusedMirrorDirs(config: MirrorConfig, uris: string[]): string[] {
  const inUse: string[] = [];
  const collect = (nodes: MirrorConfig['nodes']) => {
    for (const node of nodes) {
      if (node.kind === 'section') collect(node.children);
      else if (node.kind === 'deb' && node.enabled) {
        const dir = mirrorDirOf(node.uri);
        if (dir) inUse.push(dir);
      }
    }
  };
  collect(config.nodes);

  const overlaps = (a: string, b: string) => a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`);
  const dirs = new Set<string>();
  for (const uri of uris) {
    const dir = mirrorDirOf(uri);
    if (dir && !inUse.some((used) => overlaps(used, dir))) dirs.add(dir);
  }
  return [...dirs];
}

/**
 * Delete a repository's mirrored files under each root (mirror and skel), then any parent
 * folders left empty. A folder that resolves outside its root, or is a symlink, is skipped.
 */
export async function deleteMirrorDirs(dirs: string[], roots: string[]): Promise<string[]> {
  const deleted: string[] = [];
  for (const root of roots) {
    const realRoot = await fs.realpath(root).catch(() => null);
    if (!realRoot) continue;
    for (const dir of dirs) {
      const target = path.join(realRoot, dir);
      if (!target.startsWith(`${realRoot}${path.sep}`)) continue;
      const stat = await fs.lstat(target).catch(() => null);
      if (!stat || !stat.isDirectory()) continue;
      const real = await fs.realpath(target).catch(() => null);
      if (real !== target) continue;

      await fs.rm(target, { recursive: true, force: true });
      deleted.push(target);
      for (let parent = path.dirname(target); parent.startsWith(`${realRoot}${path.sep}`); parent = path.dirname(parent)) {
        if (!(await fs.rmdir(parent).then(() => true, () => false))) break;
      }
    }
  }
  return deleted;
}
