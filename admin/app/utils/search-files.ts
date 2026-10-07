import fs from 'fs/promises';
import path from 'path';
import { realRootsOf, statInsideRoots } from './health-scan';

export interface SearchResult {
  name: string;
  path: string;
  size: number;
  modified: Date;
  isDirectory: boolean;
}

/**
 * Finds entries below `rootPath` whose name contains `query` (case-insensitive). Symlinks are
 * followed only while they stay inside `roots`; links leading out of them are not listed.
 */
export async function searchFiles(rootPath: string, query: string, roots: string[]): Promise<SearchResult[]> {
  const results: SearchResult[] = [];
  const lowerQuery = query.toLowerCase();
  const realRoots = await realRootsOf(roots);
  // Real paths already walked, so symlink cycles can't recurse forever
  const visited = new Set<string>();

  async function searchDirectory(dirPath: string): Promise<void> {
    let items: string[];
    try {
      const realDirPath = await fs.realpath(dirPath);
      if (visited.has(realDirPath)) return;
      visited.add(realDirPath);
      items = await fs.readdir(dirPath);
    } catch {
      return;
    }

    for (const itemName of items) {
      // Skip hidden files except .tmp- directories
      const isTemp = itemName.startsWith('.tmp-');
      if (itemName.startsWith('.') && !isTemp) continue;
      const itemPath = path.join(dirPath, itemName);
      try {
        const found = await statInsideRoots(itemPath, realRoots);
        if (!found) continue;
        const { stats } = found;
        if (itemName.toLowerCase().includes(lowerQuery)) {
          results.push({
            name: itemName,
            path: itemPath,
            size: stats.isFile() ? stats.size : 0,
            modified: stats.mtime,
            isDirectory: stats.isDirectory(),
          });
        }
        if (stats.isDirectory() && !isTemp) await searchDirectory(itemPath);
      } catch {
        // Skip items we can't access
      }
    }
  }

  await searchDirectory(rootPath);
  return results;
}
