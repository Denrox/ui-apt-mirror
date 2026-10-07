import fs from 'fs/promises';
import path from 'path';
import type { Stats } from 'fs';
import { isStaleTempDir, UPLOAD_TEMP_PREFIX } from './chunk-upload';
import { isWithin } from './safe-path';

// Smallest valid file of each format; anything shorter is truncated. Other files
// (Packages, keys.json, notes) may legitimately be tiny or empty.
const MIN_VALID_SIZE: Record<string, number> = {
  '.deb': 8,
  '.udeb': 8,
  '.ddeb': 8,
  '.gz': 18,
  '.tgz': 18,
  '.bz2': 14,
  '.xz': 32,
  '.zip': 22,
  '.jar': 22,
  '.whl': 22,
  '.tar': 512,
  '.zst': 1,
  '.lz4': 1,
  '.rpm': 1,
  '.iso': 1,
  '.img': 1,
};

export function isTruncated(name: string, size: number): boolean {
  const min = MIN_VALID_SIZE[path.extname(name).toLowerCase()];
  return min !== undefined && size < min;
}

export interface HealthScan {
  totalFiles: number;
  totalDirectories: number;
  invalidFiles: Array<{ path: string; reason: string; size: number }>;
  cleanedTmpDirs: string[];
  scanErrors: string[];
}

/**
 * Stats `itemPath`, following a symlink only while its target stays inside `realRoots`.
 * Null for a dangling link or one that leads out of the roots: those are skipped.
 */
export async function statInsideRoots(
  itemPath: string,
  realRoots: string[],
): Promise<{ stats: Stats; isSymlink: boolean } | null> {
  const own = await fs.lstat(itemPath);
  if (!own.isSymbolicLink()) return { stats: own, isSymlink: false };
  let real: string;
  try {
    real = await fs.realpath(itemPath);
  } catch {
    return null;
  }
  if (!realRoots.some((root) => isWithin(real, root))) return null;
  return { stats: await fs.stat(itemPath), isSymlink: true };
}

/** Real paths of the roots that exist. */
export async function realRootsOf(roots: string[]): Promise<string[]> {
  const real = await Promise.all(roots.map((root) => fs.realpath(root).catch(() => null)));
  return real.filter((root): root is string => root !== null);
}

/**
 * Walks `dirs` (up to `maxDepth` levels), counting everything and removing stale upload temp
 * dirs. Symlinks are followed only while they stay inside `roots`, and a temp dir is removed
 * only when it is a real directory, never through a link.
 */
export async function scanTrees(dirs: string[], maxDepth = 20, roots: string[] = dirs): Promise<HealthScan> {
  const realRoots = await realRootsOf(roots);
  const scan: HealthScan = {
    totalFiles: 0,
    totalDirectories: 0,
    invalidFiles: [],
    cleanedTmpDirs: [],
    scanErrors: [],
  };
  const visited = new Set<string>();

  const walk = async (dir: string, depth: number): Promise<void> => {
    let items: string[];
    try {
      const real = await fs.realpath(dir);
      if (visited.has(real)) return;
      visited.add(real);
      items = await fs.readdir(dir);
    } catch (error) {
      scan.scanErrors.push(`Error reading directory: ${dir}`);
      return;
    }

    for (const name of items) {
      const isTemp = name.startsWith(UPLOAD_TEMP_PREFIX);
      if (name.startsWith('.') && !isTemp) continue;
      const itemPath = path.join(dir, name);
      try {
        const found = await statInsideRoots(itemPath, realRoots);
        if (!found) continue;
        const { stats, isSymlink } = found;
        if (isTemp && isSymlink) continue;
        if (stats.isDirectory() && isTemp) {
          if (await isStaleTempDir(itemPath)) {
            try {
              await fs.rm(itemPath, { recursive: true, force: true });
              scan.cleanedTmpDirs.push(itemPath);
            } catch {
              scan.scanErrors.push(`Failed to remove old .tmp- directory: ${itemPath}`);
            }
          }
        } else if (stats.isDirectory()) {
          scan.totalDirectories++;
          if (depth < maxDepth) await walk(itemPath, depth + 1);
        } else if (stats.isFile()) {
          scan.totalFiles++;
          if (isTruncated(name, stats.size)) {
            scan.invalidFiles.push({ path: itemPath, reason: 'truncated', size: stats.size });
          }
        }
      } catch {
        scan.scanErrors.push(`Error processing item: ${itemPath}`);
      }
    }
  };

  for (const dir of dirs) await walk(dir, 0);
  return scan;
}
