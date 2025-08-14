import path from "path";
import fs from "fs/promises";
import appConfig from "~/config/config.json";
import { checkLockFile } from "~/utils/sync";

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
        modified: stats.mtime
      });
    }
    return fileList.filter((file) => file.name !== '.' && file.name !== '..' && !file.name.startsWith('.')).sort((a, b) => {
      if (a.isDirectory && !b.isDirectory) return -1;
      if (!a.isDirectory && b.isDirectory) return 1;
      return a.name.localeCompare(b.name);
    });
  } catch (error) {
    console.error("Error reading directory:", error);
    return [];
  }
}

function isPathAllowed(requestedPath: string): boolean {
  // Define root directories
  const userUploadsDir = appConfig.filesDir;
  const mirroredPackagesDir = appConfig.mirroredPackagesDir;
  
  // Normalize paths for comparison
  const normalizedRequestedPath = path.resolve(requestedPath);
  const normalizedUserUploadsDir = path.resolve(userUploadsDir);
  const normalizedMirroredPackagesDir = path.resolve(mirroredPackagesDir);
  
  // Check if the requested path is within one of the allowed root directories
  return normalizedRequestedPath.startsWith(normalizedUserUploadsDir) || 
         normalizedRequestedPath.startsWith(normalizedMirroredPackagesDir);
}

export async function loader({ request }: { request: Request }) {
  const url = new URL(request.url);
  const requestedPath = url.searchParams.get('path') || appConfig.filesDir;
  
  // Security check: ensure the requested path is within allowed directories
  if (!isPathAllowed(requestedPath)) {
    console.error("Security violation: Attempted to access unauthorized directory:", requestedPath);
    return { 
      files: [],
      currentPath: appConfig.filesDir,
      isLockFilePresent: false,
      error: "Access denied: Directory not allowed"
    };
  }
  
  // Load files from the current directory only
  const [files, isLockFilePresent] = await Promise.all([
    getFileList(requestedPath).catch(() => []),
    checkLockFile()
  ]);
  
  return { 
    files,
    currentPath: requestedPath,
    isLockFilePresent
  };
}