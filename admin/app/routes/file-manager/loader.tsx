import path from "path";
import fs from "fs/promises";
import appConfig from "~/config/config.json";

interface FileItem {
  name: string;
  path: string;
  isDirectory: boolean;
  size?: number;
  modified?: Date;
}

async function getFileList(dirPath: string = appConfig.filesDir): Promise<FileItem[]> {
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

      if (isDirectory) {
        const subFiles = await getFileList(fullPath);
        fileList.push(...subFiles);
      }
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

export async function loader() {
  const files = await getFileList();
  return { files };
}