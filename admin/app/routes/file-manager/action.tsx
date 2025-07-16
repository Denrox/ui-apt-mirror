import type { Route } from "./+types/file-manager";
import path from "path";
import fs from "fs/promises";
import fsSync from "fs";
import https from "https";
import http from "http";
import { URL } from "url";

// Disk-based chunk storage using destination directory
const chunkStorage = new Map<string, { tempDir: string; totalChunks: number; fileName: string }>();

function isValidFileName(name: string): boolean {
  const forbiddenPatterns = [
    /^\./,        // Files starting with a dot
    /\//,         // Files containing "/"
  ];
  
  return !forbiddenPatterns.some(pattern => pattern.test(name));
}

export function getValidationError(name: string): string | null {
  if (!name.trim()) {
    return "Name cannot be empty";
  }
  
  if (!isValidFileName(name)) {
    return "Name cannot contain './', '../', or other path traversal characters";
  }
  
  const invalidChars = /[<>:"|?*\x00-\x1f]/;
  if (invalidChars.test(name)) {
    return "Name contains invalid characters";
  }
  
  return null;
}

async function createDirectory(dirPath: string): Promise<boolean> {
  try {
    await fs.mkdir(dirPath, { recursive: true });
    return true;
  } catch (error) {
    return false;
  }
}

async function deleteFile(filePath: string): Promise<boolean> {
  try {
    const stats = await fs.stat(filePath);
    if (stats.isDirectory()) {
      await fs.rmdir(filePath, { recursive: true });
    } else {
      await fs.unlink(filePath);
    }
    return true;
  } catch (error) {
    return false;
  }
}

async function renameFile(oldPath: string, newName: string): Promise<boolean> {
  try {
    const dirPath = path.dirname(oldPath);
    const newPath = path.join(dirPath, newName);

    try {
      await fs.access(newPath);
      return false; // File/directory already exists
    } catch (error) {
      // File doesn't exist, we can proceed
    }
    
    await fs.rename(oldPath, newPath);
    return true;
  } catch (error) {
    return false;
  }
}

async function downloadFile(url: string, destPath: string): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      const urlObj = new URL(url);
      const protocol = urlObj.protocol === 'https:' ? https : http;
      
      const request = protocol.get(url, (response) => {
        if (response.statusCode !== 200) {
          resolve(false);
          return;
        }

        const fileStream = fsSync.createWriteStream(destPath);
        response.pipe(fileStream);

        fileStream.on('finish', () => {
          fileStream.close();
          resolve(true);
        });

        fileStream.on('error', () => {
          resolve(false);
        });
      });

      request.on('error', () => {
        resolve(false);
      });

      request.setTimeout(30000, () => {
        request.destroy();
        resolve(false);
      });
    } catch (error) {
      resolve(false);
    }
  });
}

async function uploadFile(filePath: string, file: any): Promise<boolean> {
  try {
    const destPath = path.join(filePath, file.name);

    const destDir = path.dirname(destPath);
    await fs.mkdir(destDir, { recursive: true });

    if (file && typeof file.arrayBuffer === 'function') {
      const arrayBuffer = await file.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      await fs.writeFile(destPath, buffer);
    } else if (file && file.stream) {
      const stream = file.stream();
      const chunks: Buffer[] = [];
      for await (const chunk of stream) {
        chunks.push(Buffer.from(chunk));
      }
      const buffer = Buffer.concat(chunks);
      await fs.writeFile(destPath, buffer);
    } else if (file && file.buffer) {
      await fs.writeFile(destPath, file.buffer);
    } else {
      throw new Error('Unsupported file type');
    }
    
    return true;
  } catch (error) {
    return false;
  }
}

async function handleChunkUpload(formData: FormData): Promise<{ success: boolean; error?: string }> {
  try {
    const filePath = formData.get('filePath') as string;
    const chunk = formData.get('chunk') as any;
    const chunkIndex = parseInt(formData.get('chunkIndex') as string);
    const totalChunks = parseInt(formData.get('totalChunks') as string);
    const fileName = formData.get('fileName') as string;
    const fileId = formData.get('fileId') as string;

    if (!chunk || !fileName || !fileId) {
      return { success: false, error: "Missing required chunk data" };
    }

    const validationError = getValidationError(fileName);
    if (validationError) {
      return { success: false, error: validationError };
    }

    let chunkBuffer: Buffer;
    try {
      if (chunk && typeof chunk.arrayBuffer === 'function') {
        const arrayBuffer = await chunk.arrayBuffer();
        chunkBuffer = Buffer.from(arrayBuffer);
      } else if (chunk && chunk.buffer) {
        chunkBuffer = chunk.buffer;
      } else {
        return { success: false, error: "Invalid chunk format" };
      }
    } catch (bufferError) {
      return { success: false, error: "Failed to process chunk data" };
    }

    if (!chunkStorage.has(fileId)) {
      const tempDirName = `.tmp-${fileId}`;
      const tempDir = path.join(filePath, tempDirName);
      await fs.mkdir(tempDir, { recursive: true });
      chunkStorage.set(fileId, { tempDir, totalChunks, fileName });
    }

    const fileInfo = chunkStorage.get(fileId)!;
    const tempFilePath = path.join(fileInfo.tempDir, `${fileName}.temp`);

    if (chunkIndex === 0) {
      await fs.writeFile(tempFilePath, chunkBuffer);
    } else {
      await fs.appendFile(tempFilePath, chunkBuffer);
    }

    if (chunkIndex === totalChunks - 1) {
      const destPath = path.join(filePath, fileName);
      await fs.rename(tempFilePath, destPath);

      try {
        await fs.rm(fileInfo.tempDir, { recursive: true, force: true });
      } catch (cleanupError) {
        // Ignore cleanup errors
      }

      chunkStorage.delete(fileId);

      return { success: true };
    }

    return { success: true };
  } catch (error) {
    return { success: false, error: "Failed to process chunk" };
  }
}

export async function action({ request }: Route.ActionArgs) {
  try {
    const formData = await request.formData();
    const intent = formData.get('intent') as string;
    
    if (intent === 'test') {
      return { success: true, message: 'Server is working' };
    } else if (intent === 'createFolder') {
      const folderName = formData.get('folderName') as string;
      const currentPath = formData.get('currentPath') as string;
      
      const validationError = getValidationError(folderName);
      if (validationError) {
        return { success: false, error: validationError };
      }
      
      const newPath = path.join(currentPath, folderName);
      const success = await createDirectory(newPath);
      
      if (success) {
        return { success: true };
      } else {
        return { success: false, error: "Failed to create folder" };
      }
    } else if (intent === 'deleteFile') {
      const filePath = formData.get('filePath') as string;
      const success = await deleteFile(filePath);
      return { success };
    } else if (intent === 'renameFile') {
      const filePath = formData.get('filePath') as string;
      const newName = formData.get('newName') as string;
      
      if (!filePath || !newName) {
        return { success: false, error: "File path and new name are required" };
      }
      
      const validationError = getValidationError(newName);
      if (validationError) {
        return { success: false, error: validationError };
      }
      
      const success = await renameFile(filePath, newName);
      
      if (success) {
        return { success: true };
      } else {
        return { success: false, error: "Failed to rename file or file with that name already exists" };
      }
    } else if (intent === 'uploadFile') {
      const filePath = formData.get('filePath') as string;
      const file = formData.get('file');
      if (!file) {
        return { success: false, error: "No file provided" };
      }
      const success = await uploadFile(filePath, file);
      return { success };
    } else if (intent === 'uploadChunk') {
      const res = await handleChunkUpload(formData);
      return res;
    } else if (intent === 'downloadFile') {
      const url = formData.get('url') as string;
      const fileName = formData.get('fileName') as string;
      const currentPath = formData.get('currentPath') as string;
      
      if (!url || !fileName) {
        return { success: false, error: "URL and filename are required" };
      }
      
      const validationError = getValidationError(fileName);
      if (validationError) {
        return { success: false, error: validationError };
      }
      
      const destPath = path.join(currentPath, fileName);
      const success = await downloadFile(url, destPath);
      
      if (success) {
        return { success: true };
      } else {
        return { success: false, error: "Failed to download file" };
      }
    }

    return { success: false, error: "Invalid action" };
  } catch (error) {
    return { success: false, error: "An unexpected error occurred" };
  }
}