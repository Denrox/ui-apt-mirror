import fs from 'fs/promises';
import path from 'path';
import { realRootsOf, statInsideRoots } from './health-scan';
import { UPLOAD_TEMP_PREFIX } from './chunk-upload';

export interface SearchResult {
  name: string;
  path: string;
  size: number;
  modified: Date;
  isDirectory: boolean;
}

/** Most matches a search returns; a broad term in a large tree can match tens of thousands. */
const MAX_SEARCH_RESULTS = 500;

/**
 * Finds entries below `rootPath` whose name contains `query` (case-insensitive). Symlinks are
 * followed only while they stay inside `roots`; links leading out of them are not listed.
 */
export async function searchFiles(
  rootPath: string,
  query: string,
  roots: string[],
  limit = MAX_SEARCH_RESULTS,
): Promise<{ results: SearchResult[]; truncated: boolean }> {
  const results: SearchResult[] = [];
  let truncated = false;
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
      if (truncated) return;
      // Skip hidden files except .tmp- directories
      const isTemp = itemName.startsWith(UPLOAD_TEMP_PREFIX);
      if (itemName.startsWith('.') && !isTemp) continue;
      const itemPath = path.join(dirPath, itemName);
      try {
        const found = await statInsideRoots(itemPath, realRoots);
        if (!found) continue;
        const { stats } = found;
        if (itemName.toLowerCase().includes(lowerQuery)) {
          if (results.length >= limit) {
            truncated = true;
            return;
          }
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
  return { results, truncated };
}
