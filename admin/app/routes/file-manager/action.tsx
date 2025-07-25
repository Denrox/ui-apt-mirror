import type { Route } from "./+types/file-manager";
import path from "path";
import fs from "fs/promises";
import fsSync from "fs";
import https from "https";
import http from "http";
import { URL } from "url";
import { exec } from "child_process";
import { promisify } from "util";
import zlib from "zlib";

const execAsync = promisify(exec);

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
    
    // Check if the new name already exists
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

async function moveFile(sourcePath: string, destinationPath: string): Promise<boolean> {
  try {
    const fileName = path.basename(sourcePath);
    const newPath = path.join(destinationPath, fileName);
    
    // Check if trying to move into itself
    if (sourcePath === newPath) {
      return false;
    }
    
    // Check if destination is a subdirectory of source
    if (newPath.startsWith(sourcePath + path.sep)) {
      return false;
    }
    
    // Check if the new name already exists in destination
    try {
      await fs.access(newPath);
      return false; // File/directory already exists
    } catch (error) {
      // File doesn't exist, we can proceed
    }
    
    await fs.rename(sourcePath, newPath);
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

async function downloadImage(imageUrl: string, imageTag: string, destPath: string, architecture: string = 'amd64'): Promise<boolean> {
  try {
    // Ensure destination directory exists
    await fs.mkdir(destPath, { recursive: true });
    
    // Create filename from image URL and tag
    const imageName = imageUrl.replace(/[^a-zA-Z0-9.-]/g, '_');
    const fileName = `${imageName}_${imageTag}_${architecture}.tar`;
    const fullPath = path.join(destPath, fileName);
    
    // Remove existing file if it exists to prevent modification errors
    try {
      await fs.unlink(fullPath);
    } catch (unlinkError) {
      // File doesn't exist, which is fine
    }
    
    // Parse registry and image details
    const registryInfo = parseImageUrl(imageUrl);
    if (!registryInfo) {
      throw new Error('Invalid image URL format. Please use format: project/image or gcr.io/project/image');
    }
    
    // Use skopeo to copy image to tar format
    const sourceImage = `${registryInfo.registry}/${registryInfo.repository}:${imageTag}`;
    const archFlag = `--override-arch ${architecture}`;
    const skopeoCommand = `skopeo copy ${archFlag} docker://${sourceImage} docker-archive:${fullPath}`;
    
    try {
      await execAsync(skopeoCommand);
      return true;
    } catch (dockerError) {
      // If Docker Hub fails, try GCR as fallback (only for single-word images)
      if (registryInfo.registry === 'docker.io' && !imageUrl.includes('/') && !imageUrl.startsWith('gcr.io/')) {
        console.log('Docker Hub failed, trying GCR fallback...');
        
        // Try GCR with the same image name
        const gcrImage = `gcr.io/google-containers/${imageUrl}:${imageTag}`;
        const gcrCommand = `skopeo copy ${archFlag} docker://${gcrImage} docker-archive:${fullPath}`;
        
        try {
          await execAsync(gcrCommand);
          console.log('Successfully downloaded from GCR fallback');
          return true;
        } catch (gcrError) {
          console.error('GCR fallback also failed:', gcrError);
          // Re-throw the original Docker error for proper error handling
          throw dockerError;
        }
      } else {
        // Re-throw the original error for other cases
        throw dockerError;
      }
    }
  } catch (error) {
    console.error('Failed to download image:', error);
    
    // Clean up any empty or partial file that might have been created
    try {
      const imageName = imageUrl.replace(/[^a-zA-Z0-9.-]/g, '_');
      const fileName = `${imageName}_${imageTag}_${architecture}.tar`;
      const fullPath = path.join(destPath, fileName);
      
      const stats = await fs.stat(fullPath);
      if (stats.size === 0) {
        await fs.unlink(fullPath);
      }
    } catch (cleanupError) {
      // Ignore cleanup errors
    }
    
    // Check for specific error messages and provide user-friendly responses
    const errorMessage = error instanceof Error ? error.message : String(error);
    
    if (errorMessage.includes('unauthorized') || errorMessage.includes('invalid username/password')) {
      throw new Error('Authentication failed. This image may require Docker Hub login or is from a private repository.');
    } else if (errorMessage.includes('not found')) {
      throw new Error('Image not found. Please check the image URL and tag.');
    } else if (errorMessage.includes('manifest')) {
      throw new Error('Failed to retrieve image manifest. The image may not exist or be accessible.');
    } else if (errorMessage.includes('timeout')) {
      throw new Error('Download timed out. Please try again or check your network connection.');
    }
    
    return false;
  }
}

interface RegistryInfo {
  registry: string;
  repository: string;
}

function parseImageUrl(imageUrl: string): RegistryInfo | null {
  // Handle Google Container Registry
  if (imageUrl.startsWith('gcr.io/')) {
    return {
      registry: 'gcr.io',
      repository: imageUrl.substring(8) // Remove 'gcr.io/'
    };
  }
  
  // Handle regional GCR formats (us.gcr.io, eu.gcr.io, etc.)
  if (imageUrl.includes('.gcr.io/')) {
    const parts = imageUrl.split('/');
    if (parts.length >= 2) {
      return {
        registry: parts[0],
        repository: parts.slice(1).join('/')
      };
    }
  }
  
  // Handle Docker Hub registry
  if (imageUrl.startsWith('docker.io/')) {
    return {
      registry: 'docker.io',
      repository: imageUrl.substring(11) // Remove 'docker.io/'
    };
  }
  
  // Handle single-word image names (e.g., "nginx" -> "library/nginx")
  if (!imageUrl.includes('/')) {
    return {
      registry: 'docker.io',
      repository: `library/${imageUrl}`
    };
  }
  
  // Auto-prepend docker.io for images without explicit registry
  return {
    registry: 'docker.io',
    repository: imageUrl
  };
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
    } else if (intent === 'moveFile') {
      const sourcePath = formData.get('sourcePath') as string;
      const destinationPath = formData.get('destinationPath') as string;
      
      if (!sourcePath || !destinationPath) {
        return { success: false, error: "Source path and destination path are required" };
      }
      
      const success = await moveFile(sourcePath, destinationPath);
      
      if (success) {
        return { success: true };
      } else {
        return { success: false, error: "Failed to move file or file with that name already exists in destination" };
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
    } else if (intent === 'downloadImage') {
      const imageUrl = formData.get('imageUrl') as string;
      const imageTag = formData.get('imageTag') as string;
      const currentPath = formData.get('currentPath') as string;
      const architecture = formData.get('architecture') as string || 'amd64';
      
      if (!imageUrl || !imageUrl.trim()) {
        return { success: false, error: "Image URL is required" };
      }
      
      if (!imageTag || !imageTag.trim()) {
        return { success: false, error: "Image tag is required" };
      }
      
      try {
        const success = await downloadImage(imageUrl.trim(), imageTag.trim(), currentPath, architecture);
        
        if (success) {
          return { success: true };
        } else {
          return { success: false, error: "Failed to download container image" };
        }
      } catch (error) {
        // Handle specific error messages from downloadImage function
        const errorMessage = error instanceof Error ? error.message : String(error);
        return { success: false, error: errorMessage };
      }
    }

    return { success: false, error: "Invalid action" };
  } catch (error) {
    return { success: false, error: "An unexpected error occurred" };
  }
}