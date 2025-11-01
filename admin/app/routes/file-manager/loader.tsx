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

function isPathAllowed(requestedPath: string, isPublicRoute: boolean): boolean {
  const userUploadsDir = appConfig.filesDir;
  const privateFilesDir = appConfig.privateFilesDir;
  const mirroredPackagesDir = appConfig.mirroredPackagesDir;
  const npmPackagesDir = appConfig.npmPackagesDir;

  const normalizedRequestedPath = path.resolve(requestedPath);
  const normalizedUserUploadsDir = path.resolve(userUploadsDir);
  const normalizedMirroredPackagesDir = path.resolve(mirroredPackagesDir);
  const normalizedNpmPackagesDir = path.resolve(npmPackagesDir);

  if (isPublicRoute && privateFilesDir) {
    const normalizedPrivateFilesDir = path.resolve(privateFilesDir);
    if (normalizedRequestedPath.startsWith(normalizedPrivateFilesDir)) {
      return false;
    }
  }

  return (
    normalizedRequestedPath.startsWith(normalizedUserUploadsDir) ||
    (!isPublicRoute && privateFilesDir && normalizedRequestedPath.startsWith(path.resolve(privateFilesDir))) ||
    normalizedRequestedPath.startsWith(normalizedMirroredPackagesDir) ||
    normalizedRequestedPath.startsWith(normalizedNpmPackagesDir)
  );
}

export async function loader({ request }: { request: Request }) {
  const url = new URL(request.url);
  const isPublicRoute = url.hostname.startsWith('files');
  
  if (!isPublicRoute) {
    await requireAuthMiddleware(request);
  }

  const searchParams = url.searchParams;
  const requestedPath = searchParams.get('path');
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
    __domain: isPublicRoute ? 'files' : 'admin',
  };
}
