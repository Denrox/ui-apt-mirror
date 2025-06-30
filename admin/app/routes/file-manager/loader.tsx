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
      
      fileList.push({
        name: item.name,
        path: fullPath,
        isDirectory: item.isDirectory(),
        size: stats.size,
        modified: stats.mtime
      });
    }
    return fileList.sort((a, b) => {
      // Directories first, then files
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
  const fileTree = await getFileList();
  return { fileTree };
}