import path from 'path';
import fs from 'fs/promises';
import appConfig from '~/config/config.json';
import { checkLockFile } from '~/utils/sync';
import { requireAuthMiddleware } from '~/utils/auth-middleware';

interface FileItem {
  name: string;
  path: string;
  isDirectory: boolean;
  size?: number;
  modified?: Date;
}

async function getFileList(dirPath: string): Promise<FileItem[]> {
  try {
    const items = await fs.readdir(dirPath, { withFileTypes: true });
    const fileList: FileItem[] = [];

    for (const item of items) {
      const fullPath = path.join(dirPath, item.name);
      const stats = await fs.stat(fullPath);
      const isDirectory = item.isDirectory();

      fileList.push({
        name: item.name,
        path: fullPath,
        isDirectory: isDirectory,
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

function isPathAllowed(requestedPath: string): boolean {
  const userUploadsDir = appConfig.filesDir;
  const mirroredPackagesDir = appConfig.mirroredPackagesDir;
  const npmPackagesDir = appConfig.npmPackagesDir;

  const normalizedRequestedPath = path.resolve(requestedPath);
  const normalizedUserUploadsDir = path.resolve(userUploadsDir);
  const normalizedMirroredPackagesDir = path.resolve(mirroredPackagesDir);
  const normalizedNpmPackagesDir = path.resolve(npmPackagesDir);

  return (
    normalizedRequestedPath.startsWith(normalizedUserUploadsDir) ||
    normalizedRequestedPath.startsWith(normalizedMirroredPackagesDir) ||
    normalizedRequestedPath.startsWith(normalizedNpmPackagesDir)
  );
}

export async function loader({ request }: { request: Request }) {
  await requireAuthMiddleware(request);

  const url = new URL(request.url);
  const searchParams = url.searchParams;
  const rootPath = appConfig.filesDir;
  const currentPath = searchParams.get('path') ?? rootPath;

  if (!isPathAllowed(currentPath)) {
    console.error(
      'Security violation: Attempted to access unauthorized directory:',
      currentPath,
    );
    return {
      files: [],
      currentPath: appConfig.filesDir,
      isLockFilePresent: false,
      error: 'Access denied: Directory not allowed',
    };
  }

  const [files, isLockFilePresent, healthReport] = await Promise.all([
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

  return {
    files,
    currentPath: currentPath,
    isLockFilePresent,
    healthReport,
  };
}
