import type { Route } from "./+types/file-manager";
import path from "path";
import fs from "fs/promises";
import fsSync from "fs";
import https from "https";
import http from "http";
import { URL } from "url";
import { exec } from "child_process";
import { promisify } from "util";
import appConfig from "~/config/config.json";
import buildConfig from "~/config/config.build.json";

const execAsync = promisify(exec);

const chunkStorage = new Map<string, { tempDir: string; totalChunks: number; fileName: string }>();

const activeDownloads = new Map<string, { request: any; fileStream: any }>();

setInterval(() => {
  for (const [destPath, download] of activeDownloads.entries()) {
    if (download.request.destroyed || download.fileStream?.destroyed) {
      activeDownloads.delete(destPath);
    }
  }
}, 30000);

async function cancelAndCleanupDownload(destPath: string): Promise<void> {
  try {
    const activeDownload = activeDownloads.get(destPath);
    
    if (activeDownload) {
      activeDownload.request.destroy();
      
      if (activeDownload.fileStream) {
        activeDownload.fileStream.destroy();
      }
      
      activeDownloads.delete(destPath);
    }
    
    try {
      await fs.unlink(destPath);
    } catch (unlinkError) {
      // File might not exist, which is fine
    }
  } catch (error) {
    console.error('Failed to cancel and cleanup download:', error);
  }
}

function isValidFileName(name: string): boolean {
  const forbiddenPatterns = [
    /^\./,
    /\//,
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
    let fileStream: fsSync.WriteStream | undefined;
    
    try {
      const urlObj = new URL(url);
      const protocol = urlObj.protocol === 'https:' ? https : http;
      
      const request = protocol.get(url, (response) => {
        if (response.statusCode !== 200) {
          resolve(false);
          return;
        }

        fileStream = fsSync.createWriteStream(destPath);
        response.pipe(fileStream);

        fileStream.on('finish', () => {
          fileStream?.close();
          activeDownloads.delete(destPath);
          resolve(true);
        });

        fileStream.on('error', () => {
          activeDownloads.delete(destPath);
          resolve(false);
        });
      });

      request.on('error', () => {
        activeDownloads.delete(destPath);
        resolve(false);
      });

      request.setTimeout(30000, () => {
        request.destroy();
        activeDownloads.delete(destPath);
        resolve(false);
      });

      activeDownloads.set(destPath, { request, fileStream });
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

async function handleChunkUpload(formData: FormData): Promise<{ success: boolean; error?: string; message?: string }> {
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

      return { success: true, message: "File uploaded successfully" };
    }

    return { success: true, message: "Chunk processed successfully" };
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
        return { success: true, message: "Folder created successfully" };
      } else {
        return { success: false, error: "Failed to create folder" };
      }
    } else if (intent === 'deleteFile') {
      const filePath = formData.get('filePath') as string;
      const success = await deleteFile(filePath);
      if (success) {
        return { success: true, message: "File deleted successfully" };
      } else {
        return { success: false, error: "Failed to delete file" };
      }
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
        return { success: true, message: "File renamed successfully" };
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
        return { success: true, message: "File moved successfully" };
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
      if (success) {
        return { success: true, message: "File uploaded successfully" };
      } else {
        return { success: false, error: "Failed to upload file" };
      }
    } else if (intent === 'cleanupDownload') {
      const filePath = formData.get('filePath') as string;
      const fileName = formData.get('fileName') as string;
      
      if (!filePath || !fileName) {
        return { success: false, error: "Missing required cleanup data" };
      }
      
      try {
        const fullPath = path.join(filePath, fileName);
        
        await cancelAndCleanupDownload(fullPath);
        
        return { success: true, message: "Download cleanup completed" };
      } catch (error) {
        console.error('Failed to cleanup download:', error);
        return { success: false, error: "Failed to cleanup download" };
      }
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
        return { success: true, message: "File downloaded successfully" };
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
          return { success: true, message: "Container image downloaded successfully" };
        } else {
          return { success: false, error: "Failed to download container image" };
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return { success: false, error: errorMessage };
      }
    } else if (intent === 'runHealthCheck') {
      try {
        const dataDirs = [appConfig.filesDir, appConfig.mirroredPackagesDir];
        const healthFile = appConfig.healthReportFile;
        
        const invalidFiles: Array<{ path: string; reason: string; size: number }> = [];
        const cleanedTmpDirs: string[] = [];
        const scanErrors: string[] = [];
        let totalFiles = 0;
        let totalDirectories = 0;
        
        const isOlderThanDays = (dirPath: string, maxDays: number): boolean => {
          try {
            const stats = fsSync.statSync(dirPath);
            const currentTime = Date.now();
            const daysOld = (currentTime - stats.mtime.getTime()) / (1000 * 60 * 60 * 24);
            return daysOld > maxDays;
          } catch {
            return false;
          }
        };
        
        const scanDirectory = async (currentPath: string, currentDepth: number, maxDepth: number): Promise<void> => {
          if (currentDepth > maxDepth) return;
          
          try {
            const items = await fs.readdir(currentPath);
            
            for (const itemName of items) {
              if (itemName.startsWith('.') && !itemName.startsWith('.tmp-')) {
                continue;
              }
              
              const itemPath = path.join(currentPath, itemName);
              
              try {
                const stats = await fs.stat(itemPath);
                
                if (stats.isDirectory()) {
                  if (itemName.startsWith('.tmp-')) {
                    console.log(`Found .tmp- directory: ${itemPath}`);
                    
                    if (isOlderThanDays(itemPath, 1)) { // 1 day max age
                      try {
                        await fs.rm(itemPath, { recursive: true, force: true });
                        const relativePath = itemPath.replace(currentPath + '/', '');
                        cleanedTmpDirs.push(relativePath);
                        console.log(`Successfully removed old .tmp- directory: ${itemPath}`);
                      } catch (removeError) {
                        const errorMsg = `Failed to remove old .tmp- directory: ${itemPath}`;
                        scanErrors.push(errorMsg);
                        console.error(errorMsg, removeError);
                      }
                    } else {
                      console.log(`Keeping .tmp- directory (not old enough): ${itemPath}`);
                    }
                  } else {
                    await scanDirectory(itemPath, currentDepth + 1, maxDepth);
                  }
                } else if (stats.isFile()) {
                  if (stats.size < 1024) {
                    const relativePath = itemPath.replace(currentPath + '/', '');
                    invalidFiles.push({
                      path: relativePath,
                      reason: 'suspiciously_small',
                      size: stats.size
                    });
                    console.log(`Found suspiciously small file: ${relativePath} (${stats.size} bytes)`);
                  }
                  
                  try {
                    await fs.access(itemPath, fsSync.constants.R_OK);
                  } catch {
                    const relativePath = itemPath.replace(currentPath + '/', '');
                    invalidFiles.push({
                      path: relativePath,
                      reason: 'unreadable',
                      size: stats.size
                    });
                    console.log(`Found unreadable file: ${relativePath}`);
                  }
                }
              } catch (itemError) {
                const errorMsg = `Error processing item: ${itemPath}`;
                scanErrors.push(errorMsg);
                console.error(errorMsg, itemError);
              }
            }
          } catch (readError) {
            const errorMsg = `Error reading directory: ${currentPath}`;
            scanErrors.push(errorMsg);
            console.error(errorMsg, readError);
          }
        };
        
        const countItems = async (targetDir: string): Promise<{ files: number; dirs: number }> => {
          try {
            const files = await fs.readdir(targetDir);
            let fileCount = 0;
            let dirCount = 0;
            
            for (const item of files) {
              try {
                const itemPath = path.join(targetDir, item);
                const stats = await fs.stat(itemPath);
                if (stats.isDirectory()) {
                  dirCount++;
                } else {
                  fileCount++;
                }
              } catch {
                // Skip items we can't stat
              }
            }
            
            return { files: fileCount, dirs: dirCount };
          } catch {
            return { files: 0, dirs: 0 };
          }
        };
        
        console.log('Step 1: Scanning directories and performing cleanup...');
        for (const dir of dataDirs) {
          try {
            console.log(`Scanning directory: ${dir}`);
            await scanDirectory(dir, 0, 10);
          } catch (error) {
            const errorMsg = `Error scanning directory: ${dir}`;
            scanErrors.push(errorMsg);
            console.error(errorMsg, error);
          }
        }
        
        console.log('Step 2: Counting total files and directories...');
        for (const dir of dataDirs) {
          try {
            const counts = await countItems(dir);
            totalFiles += counts.files;
            totalDirectories += counts.dirs;
          } catch (error) {
            const errorMsg = `Error counting items in directory: ${dir}`;
            scanErrors.push(errorMsg);
            console.error(errorMsg, error);
          }
        }
        
        // Generate health report
        console.log('Step 3: Writing results to health file...');
        const healthReport = {
          timestamp: new Date().toISOString(),
          scan_paths: dataDirs,
          total_files: totalFiles,
          total_directories: totalDirectories,
          invalid_files: invalidFiles,
          cleaned_tmp_dirs: cleanedTmpDirs,
          scan_errors: scanErrors
        };
        
        const healthDir = path.dirname(healthFile);
        await fs.mkdir(healthDir, { recursive: true });
        await fs.writeFile(healthFile, JSON.stringify(healthReport, null, 2));
        
        return { 
          success: true, 
          message: "File system health check completed successfully. Temp files were cleaned.", 
          output: `Scanned ${totalFiles} files and ${totalDirectories} directories. Found ${invalidFiles.length} invalid files, cleaned ${cleanedTmpDirs.length} tmp directories, ${scanErrors.length} errors.`
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return { success: false, error: `Health check failed: ${errorMessage}` };
      }
    } else if (intent === 'clearHealthCheck') {
      try {
        const healthFile = appConfig.healthReportFile;
        await fs.unlink(healthFile);
        
        return { success: true, message: "Health report cleared successfully" };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return { success: false, error: `Failed to clear health report: ${errorMessage}` };
      }
    }

    return { success: false, error: "Invalid action" };
  } catch (error) {
    return { success: false, error: "An unexpected error occurred" };
  }
}