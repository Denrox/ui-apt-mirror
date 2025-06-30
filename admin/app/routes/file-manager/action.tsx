import type { Route } from "./+types/file-manager";
import path from "path";
import fs from "fs/promises";

// Disk-based chunk storage using destination directory
const chunkStorage = new Map<string, { tempDir: string; totalChunks: number; fileName: string }>();

function isValidFileName(name: string): boolean {
  const forbiddenPatterns = [
    /^\.\/$/,      // "./"
    /^\.\.\/$/,    // "../"
    /^\.\.$/,      // ".."
    /^\.$/,        // "."
    /\/\.\.\//,    // "/../"
    /\/\.\//,      // "/./"
    /\.\./,        // ".." anywhere in the name
    /\/\//,        // "//" (double slash)
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
  
  // Check for other invalid characters
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

async function uploadFile(filePath: string, file: any): Promise<boolean> {
  try {
    const destPath = path.join(filePath, file.name);

    // Ensure the destination directory exists
    const destDir = path.dirname(destPath);
    await fs.mkdir(destDir, { recursive: true });

    // In Node.js/Remix, the file from formData is a different type
    // We need to handle it as a stream or buffer
    if (file && typeof file.arrayBuffer === 'function') {
      // Browser File object (shouldn't happen in Node.js)
      const arrayBuffer = await file.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      await fs.writeFile(destPath, buffer);
    } else if (file && file.stream) {
      // Node.js file object with stream
      const stream = file.stream();
      const chunks: Buffer[] = [];
      for await (const chunk of stream) {
        chunks.push(Buffer.from(chunk));
      }
      const buffer = Buffer.concat(chunks);
      await fs.writeFile(destPath, buffer);
    } else if (file && file.buffer) {
      // Node.js file object with buffer
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

    // Validate file name
    const validationError = getValidationError(fileName);
    if (validationError) {
      return { success: false, error: validationError };
    }

    // Convert chunk to buffer
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

    // Initialize or get chunk storage info
    if (!chunkStorage.has(fileId)) {
      // Create temporary directory in the destination directory
      const tempDirName = `.tmp-${fileId}`;
      const tempDir = path.join(filePath, tempDirName);
      await fs.mkdir(tempDir, { recursive: true });
      chunkStorage.set(fileId, { tempDir, totalChunks, fileName });
    }

    const fileInfo = chunkStorage.get(fileId)!;
    const tempFilePath = path.join(fileInfo.tempDir, `${fileName}.temp`);

    // Append chunk to the assembling file
    if (chunkIndex === 0) {
      // First chunk - create the file
      await fs.writeFile(tempFilePath, chunkBuffer);
    } else {
      // Subsequent chunks - append to the file
      await fs.appendFile(tempFilePath, chunkBuffer);
    }

    // Check if this is the final chunk
    if (chunkIndex === totalChunks - 1) {
      // Move the assembled file to its final location
      const destPath = path.join(filePath, fileName);
      await fs.rename(tempFilePath, destPath);

      // Clean up temporary directory and chunk files
      try {
        await fs.rm(fileInfo.tempDir, { recursive: true, force: true });
      } catch (cleanupError) {
        // Ignore cleanup errors
      }

      // Remove from chunk storage
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
      
      // Validate folder name
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
    }

    return { success: false, error: "Invalid action" };
  } catch (error) {
    return { success: false, error: "An unexpected error occurred" };
  }
}