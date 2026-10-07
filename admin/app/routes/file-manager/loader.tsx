import path from 'path';
import { resolveInside, storageRoots } from '~/utils/safe-path';
import fs from 'fs/promises';
import appConfig from '~/config/config.json';
import { checkLockFile } from '~/utils/sync';
import { requireAuthMiddleware } from '~/utils/auth-middleware';

/** Entries per page: a whole large folder (npm cache, mirror pool) made the page unusable. */
export const PAGE_SIZE = 200;

/** One page of `items`; a page past the end shows the last one. */
export function pageOf<T>(items: T[], requested: number, pageSize = PAGE_SIZE) {
  const pageCount = Math.max(1, Math.ceil(items.length / pageSize));
  const page = Number.isInteger(requested) ? Math.min(Math.max(requested, 1), pageCount) : 1;
  return { items: items.slice((page - 1) * pageSize, page * pageSize), page, pageCount, total: items.length };
}

interface FileItem {
  name: string;
  path: string;
  isDirectory: boolean;
  isSymlink?: boolean;
  isBrokenSymlink?: boolean;
  size?: number;
  modified?: Date;
}

async function getFileList(dirPath: string): Promise<FileItem[]> {
  try {
    const items = await fs.readdir(dirPath, { withFileTypes: true });
    const fileList: FileItem[] = [];

    for (const item of items) {
      const fullPath = path.join(dirPath, item.name);
      const isSymlink = item.isSymbolicLink();
      // Follow symlinks so linked dirs/files behave like their targets;
      // a dangling link falls back to the link's own lstat.
      let stats;
      let isBrokenSymlink = false;
      try {
        stats = await fs.stat(fullPath);
      } catch (error) {
        if (!isSymlink) throw error;
        stats = await fs.lstat(fullPath);
        isBrokenSymlink = true;
      }

      fileList.push({
        name: item.name,
        path: fullPath,
        isDirectory: stats.isDirectory(),
        isSymlink,
        isBrokenSymlink,
        size: stats.size,
        modified: stats.mtime,
      });
    }
    return fileList
      .filter(
        (file) =>
          file.name !== '.' && file.name !== '..' && !file.name.startsWith('.'),
      )
      .sort((a, b) => {
        if (a.isDirectory && !b.isDirectory) return -1;
        if (!a.isDirectory && b.isDirectory) return 1;
        return a.name.localeCompare(b.name);
      });
  } catch (error) {
    console.error('Error reading directory:', error);
    return [];
  }
}

/** One spelling per folder: no `.`/`..` segments, doubled or trailing slashes. */
export function canonicalPath(p: string): string {
  const normalized = path.posix.normalize(p);
  return normalized.length > 1 ? normalized.replace(/\/+$/, '') : normalized;
}

/** What the anonymous files host may browse: public files and the published mirror tree. */
export function publicRoots(): string[] {
  return [appConfig.filesDir, appConfig.mirrorRoot];
}

function isPathAllowed(requestedPath: string, isPublicRoute: boolean): boolean {
  // The public host never sees private files, the mirror's keys and state, or the npm cache;
  // symlinks may not lead outside the roots.
  const roots = isPublicRoute ? publicRoots() : storageRoots();
  return resolveInside(requestedPath, roots) !== null;
}

export async function loader({ request }: { request: Request }) {
  const url = new URL(request.url);
  const isPublicRoute = url.hostname.startsWith('files');
  // The files host lists files at / only, never inside the admin shell (/File-manager).
  if (isPublicRoute && url.pathname !== '/') {
    throw new Response(null, { status: 302, headers: { Location: '/' } });
  }

  if (!isPublicRoute) {
    await requireAuthMiddleware(request);
  }

  const searchParams = url.searchParams;
  const requestedPath = searchParams.get('path');
  // The page lists a folder's entries by their path below currentPath; another spelling of
  // the same folder (a trailing slash, `//`, `/./`) showed it as empty.
  if (requestedPath && canonicalPath(requestedPath) !== requestedPath) {
    searchParams.set('path', canonicalPath(requestedPath));
    throw new Response(null, { status: 302, headers: { Location: `${url.pathname}?${searchParams}` } });
  }
  let rootPath = appConfig.filesDir;
  
  if (requestedPath) {
    const normalizedRequestedPath = path.resolve(requestedPath);
    const normalizedPrivateFilesDir = path.resolve(appConfig.privateFilesDir);
    
    if (isPublicRoute && normalizedRequestedPath.startsWith(normalizedPrivateFilesDir)) {
      return {
        files: [],
        currentPath: appConfig.filesDir,
        isLockFilePresent: false,
        error: 'Access denied: Private files are not accessible from public route',
        __domain: 'files',
      };
    }
    
    if (normalizedRequestedPath.startsWith(normalizedPrivateFilesDir)) {
      rootPath = appConfig.privateFilesDir;
    } else if (normalizedRequestedPath.startsWith(path.resolve(appConfig.mirroredPackagesDir))) {
      rootPath = appConfig.mirroredPackagesDir;
    } else if (normalizedRequestedPath.startsWith(path.resolve(appConfig.npmPackagesDir))) {
      rootPath = appConfig.npmPackagesDir;
    } else {
      rootPath = appConfig.filesDir;
    }
  }
  
  const currentPath = requestedPath ?? rootPath;
  
  if (isPublicRoute && appConfig.privateFilesDir) {
    const normalizedCurrentPath = path.resolve(currentPath);
    const normalizedPrivateFilesDir = path.resolve(appConfig.privateFilesDir);
    
    if (normalizedCurrentPath.startsWith(normalizedPrivateFilesDir)) {
      return {
        files: [],
        currentPath: appConfig.filesDir,
        isLockFilePresent: false,
        error: 'Access denied: Private files are not accessible from public route',
        __domain: 'files',
      };
    }
  }

  if (!isPathAllowed(currentPath, isPublicRoute)) {
    console.error(
      'Security violation: Attempted to access unauthorized directory:',
      currentPath,
    );
    return {
      files: [],
      currentPath: appConfig.filesDir,
      isLockFilePresent: false,
      error: 'Access denied: Directory not allowed',
      __domain: isPublicRoute ? 'files' : 'admin',
    };
  }

  const [allFiles, isLockFilePresent, healthReport] = await Promise.all([
    getFileList(currentPath).catch((error) => {
      console.error('Failed to get file list:', error);
      return [];
    }),
    checkLockFile(),
    fs
      .readFile(appConfig.healthReportFile, 'utf-8')
      .then((content) => JSON.parse(content))
      .catch((error) => {
        console.error('Failed to read health report:', error);
        return null;
      }),
  ]);

  const { items: files, page, pageCount, total } = pageOf(
    allFiles,
    Number(searchParams.get('page') ?? '1'),
  );

  return {
    files,
    page,
    pageCount,
    totalFiles: total,
    currentPath: currentPath,
    isLockFilePresent,
    healthReport,
    __domain: isPublicRoute ? 'files' : 'admin',
  };
}
