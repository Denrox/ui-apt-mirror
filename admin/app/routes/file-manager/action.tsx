import type { Route } from './+types/file-manager';
import path from 'path';
import fs from 'fs/promises';
import { execFile } from 'child_process';
import { promisify } from 'util';
import appConfig from '~/config/config.json';
import { requireAuthMiddleware } from '~/utils/auth-middleware';
import { resolveEntry, resolveInside, storageRoots, writeBlockedReason } from '~/utils/safe-path';
import { checkLockFile } from '~/utils/sync';
import { moveFile } from '~/utils/move-path';
import {
  abortUpload,
  nameTakenError,
  pathExists,
  removeStaleTempDirs,
  sweepStaleUploads,
  UPLOAD_TEMP_PREFIX,
  UploadError,
  writeChunk,
} from '~/utils/chunk-upload';
import { scanTrees } from '~/utils/health-scan';
import { searchFiles } from '~/utils/search-files';
import { giveToDirOwner, mkdirOwned } from '~/utils/file-owner';
import { getValidationError } from '~/utils/file-name';
import { startDownload, type Download, type DownloadResult } from '~/utils/url-download';

const execFileAsync = promisify(execFile);

const IMAGE_NAME_RE = /^[a-z0-9]+(?:[._/:-][a-z0-9]+)*$/i;
const IMAGE_TAG_RE = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;
const ARCHITECTURES = new Set(['amd64', 'arm64', 'arm', '386', 'ppc64le', 's390x', 'riscv64']);

const OUTSIDE = 'Path is outside the file storage';

const UPLOAD_ID_RE = /^[A-Za-z0-9_-]{1,100}$/;

// Uploads cut off by a restart leave temp dirs behind; uploads stuck in this process are swept.
for (const dir of [appConfig.filesDir, appConfig.privateFilesDir].filter(Boolean)) {
  removeStaleTempDirs(dir).catch((error) => console.error('Failed to clean upload temp dirs:', error));
}
setInterval(() => {
  sweepStaleUploads().catch((error) => console.error('Failed to sweep stale uploads:', error));
}, 10 * 60 * 1000);

// Running URL downloads by destination path, so the dialog's Cancel can stop one.
const activeDownloads = new Map<string, Download>();

async function writeBlocked(op: 'add' | 'remove', ...targets: string[]): Promise<string | null> {
  const syncRunning = await checkLockFile();
  for (const target of targets) {
    const reason = writeBlockedReason(target, op, syncRunning);
    if (reason) return reason;
  }
  return null;
}

async function createDirectory(dirPath: string): Promise<boolean> {
  try {
    await mkdirOwned(dirPath);
    return true;
  } catch (error) {
    return false;
  }
}

async function deleteFile(filePath: string): Promise<boolean> {
  try {
    // lstat: deleting a symlink removes the link, never the target's contents
    const stats = await fs.lstat(filePath);
    if (stats.isDirectory()) {
      await fs.rm(filePath, { recursive: true });
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

    // lstat: a dangling symlink still takes the name
    if (await pathExists(newPath)) return false;

    await fs.rename(oldPath, newPath);
    return true;
  } catch (error) {
    return false;
  }
}

async function downloadFile(url: string, destPath: string): Promise<DownloadResult> {
  const download = startDownload(url, destPath);
  activeDownloads.set(destPath, download);
  try {
    return await download.done;
  } finally {
    if (activeDownloads.get(destPath) === download) activeDownloads.delete(destPath);
  }
}

async function uploadFile(filePath: string, file: any): Promise<boolean> {
  try {
    const destPath = path.join(filePath, file.name);

    await mkdirOwned(path.dirname(destPath));

    if (file && typeof file?.arrayBuffer === 'function') {
      const arrayBuffer = await file.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      await fs.writeFile(destPath, buffer, { flag: 'wx' });
    } else if (file?.stream) {
      const stream = file.stream();
      const chunks: Buffer[] = [];
      for await (const chunk of stream) {
        chunks.push(Buffer.from(chunk));
      }
      const buffer = Buffer.concat(chunks);
      await fs.writeFile(destPath, buffer, { flag: 'wx' });
    } else if (file && file.buffer) {
      await fs.writeFile(destPath, file.buffer, { flag: 'wx' });
    } else {
      throw new Error('Unsupported file type');
    }

    giveToDirOwner(destPath);
    return true;
  } catch (error) {
    return false;
  }
}

async function handleChunkUpload(
  formData: FormData,
): Promise<{ success: boolean; error?: string; message?: string }> {
  try {
    const chunk = formData.get('chunk') as any;
    const chunkIndex = parseInt(formData.get('chunkIndex') as string);
    const totalChunks = parseInt(formData.get('totalChunks') as string);
    const fileName = formData.get('fileName') as string;
    const fileId = formData.get('fileId') as string;

    if (!chunk || !fileName || !fileId) {
      return { success: false, error: 'Missing required chunk data' };
    }
    if (!UPLOAD_ID_RE.test(fileId)) {
      return { success: false, error: 'Invalid upload id' };
    }
    const filePath = resolveInside(formData.get('filePath'), storageRoots());
    if (!filePath) {
      return { success: false, error: OUTSIDE };
    }

    const validationError = getValidationError(fileName);
    if (validationError) {
      return { success: false, error: validationError };
    }
    const blocked = await writeBlocked('add', path.join(filePath, fileName));
    if (blocked) {
      return { success: false, error: blocked };
    }

    let chunkBuffer: Buffer;
    try {
      if (chunk && typeof chunk?.arrayBuffer === 'function') {
        const arrayBuffer = await chunk.arrayBuffer();
        chunkBuffer = Buffer.from(arrayBuffer);
      } else if (chunk?.buffer) {
        chunkBuffer = chunk.buffer;
      } else {
        return { success: false, error: 'Invalid chunk format' };
      }
    } catch (bufferError) {
      return { success: false, error: 'Failed to process chunk data' };
    }

    const result = await writeChunk({
      fileId,
      dir: filePath,
      fileName,
      chunkIndex,
      totalChunks,
      data: chunkBuffer,
    });
    if (result === 'done') {
      return { success: true, message: 'File uploaded successfully' };
    }

    return { success: true, message: 'Chunk processed successfully' };
  } catch (error) {
    if (error instanceof UploadError) {
      return { success: false, error: error.message };
    }
    return { success: false, error: 'Failed to process chunk' };
  }
}

async function downloadImage(
  imageUrl: string,
  imageTag: string,
  destPath: string,
  architecture: string = 'amd64',
): Promise<boolean> {
  // Values end up in skopeo arguments and the file name; accept only what image references allow.
  if (!IMAGE_NAME_RE.test(imageUrl) || imageUrl.length > 255) {
    throw new Error('Invalid image name');
  }
  if (!IMAGE_TAG_RE.test(imageTag)) {
    throw new Error('Invalid image tag');
  }
  if (!ARCHITECTURES.has(architecture)) {
    throw new Error('Invalid architecture');
  }
  const imageName = imageUrl.replace(/[^a-zA-Z0-9.-]/g, '_');
  const fileName = `${imageName}_${imageTag}_${architecture}.tar`;
  const fullPath = path.join(destPath, fileName);
  // Never replace or delete a file that already has this name.
  if (await pathExists(fullPath)) {
    throw new Error(nameTakenError(fileName));
  }
  let tempDir: string | null = null;
  try {
    await mkdirOwned(destPath);
    // Pull to a hidden temp dir and link into place when complete.
    tempDir = await fs.mkdtemp(path.join(destPath, `${UPLOAD_TEMP_PREFIX}img-`));
    const tempPath = path.join(tempDir, fileName);

    const registryInfo = parseImageUrl(imageUrl);
    if (!registryInfo) {
      throw new Error(
        'Invalid image URL format. Please use format: project/image or gcr.io/project/image',
      );
    }

    const sourceImage = `${registryInfo.registry}/${registryInfo.repository}:${imageTag}`;
    const skopeoCopy = async (image: string) => {
      await fs.rm(tempPath, { force: true });
      await execFileAsync('skopeo', ['copy', '--override-arch', architecture, `docker://${image}`, `docker-archive:${tempPath}`]);
    };
    const store = async () => {
      try {
        await fs.link(tempPath, fullPath);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new Error(nameTakenError(fileName));
        throw error;
      }
      giveToDirOwner(fullPath);
      return true;
    };

    try {
      await skopeoCopy(sourceImage);
    } catch (dockerError) {
      if (
        registryInfo.registry === 'docker.io' &&
        !imageUrl.includes('/') &&
        !imageUrl.startsWith('gcr.io/')
      ) {
        const gcrImage = `gcr.io/google-containers/${imageUrl}:${imageTag}`;

        try {
          await skopeoCopy(gcrImage);
        } catch (gcrError) {
          throw dockerError;
        }
      } else {
        throw dockerError;
      }
    }
    return await store();
  } catch (error) {
    console.error('Failed to download image:', error);

    const errorMessage = error instanceof Error ? error.message : String(error);

    if (
      errorMessage.includes('unauthorized') ||
      errorMessage.includes('invalid username/password')
    ) {
      throw new Error(
        'Authentication failed. This image may require Docker Hub login or is from a private repository.',
      );
    } else if (errorMessage.includes('not found')) {
      throw new Error('Image not found. Please check the image URL and tag.');
    } else if (errorMessage.includes('manifest')) {
      throw new Error(
        'Failed to retrieve image manifest. The image may not exist or be accessible.',
      );
    } else if (errorMessage.includes('timeout')) {
      throw new Error(
        'Download timed out. Please try again or check your network connection.',
      );
    } else if (errorMessage.includes('already exists here')) {
      throw error;
    }

    return false;
  } finally {
    if (tempDir) await fs.rm(tempDir, { recursive: true, force: true });
  }
}

interface RegistryInfo {
  registry: string;
  repository: string;
}

function parseImageUrl(imageUrl: string): RegistryInfo | null {
  if (imageUrl.startsWith('gcr.io/')) {
    return {
      registry: 'gcr.io',
      repository: imageUrl.substring('gcr.io/'.length),
    };
  }

  if (imageUrl.includes('.gcr.io/')) {
    const parts = imageUrl.split('/');
    if (parts.length >= 2) {
      return {
        registry: parts[0],
        repository: parts.slice(1).join('/'),
      };
    }
  }

  if (imageUrl.startsWith('docker.io/')) {
    return {
      registry: 'docker.io',
      repository: imageUrl.substring('docker.io/'.length),
    };
  }

  if (!imageUrl.includes('/')) {
    return {
      registry: 'docker.io',
      repository: `library/${imageUrl}`,
    };
  }

  return {
    registry: 'docker.io',
    repository: imageUrl,
  };
}

export async function action({ request }: Route.ActionArgs): Promise<{
  success: boolean;
  message?: string;
  error?: string;
  output?: string;
  results?: any[];
}> {
  await requireAuthMiddleware(request);
  const roots = storageRoots();
  try {
    const formData = await request.formData();
    const intent = formData.get('intent') as string;

    if (intent === 'test') {
      return { success: true, message: 'Server is working' };
    } else if (intent === 'createFolder') {
      const folderName = formData.get('folderName') as string;
      const currentPath = resolveInside(formData.get('currentPath'), roots);
      if (!currentPath) {
        return { success: false, error: OUTSIDE };
      }

      const validationError = getValidationError(folderName);
      if (validationError) {
        return { success: false, error: validationError };
      }

      const newPath = path.join(currentPath, folderName);
      const blocked = await writeBlocked('add', newPath);
      if (blocked) {
        return { success: false, error: blocked };
      }
      if (await pathExists(newPath)) {
        return { success: false, error: nameTakenError(folderName) };
      }
      const success = await createDirectory(newPath);

      if (success) {
        return { success: true, message: 'Folder created successfully' };
      } else {
        return { success: false, error: 'Failed to create folder' };
      }
    } else if (intent === 'deleteFile') {
      // The entry itself: deleting a symlink removes the link, never its target.
      const filePath = resolveEntry(formData.get('filePath'), roots);
      if (!filePath) {
        return { success: false, error: OUTSIDE };
      }
      const blocked = await writeBlocked('remove', filePath);
      if (blocked) {
        return { success: false, error: blocked };
      }
      const success = await deleteFile(filePath);
      if (success) {
        return { success: true, message: 'File deleted successfully' };
      } else {
        return { success: false, error: 'Failed to delete file' };
      }
    } else if (intent === 'renameFile') {
      const filePath = resolveEntry(formData.get('filePath'), roots);
      const newName = formData.get('newName') as string;
      if (!filePath) {
        return { success: false, error: OUTSIDE };
      }

      if (!filePath || !newName) {
        return { success: false, error: 'File path and new name are required' };
      }

      const validationError = getValidationError(newName);
      if (validationError) {
        return { success: false, error: validationError };
      }

      const blocked =
        (await writeBlocked('remove', filePath)) ||
        (await writeBlocked('add', path.join(path.dirname(filePath), newName)));
      if (blocked) {
        return { success: false, error: blocked };
      }

      const success = await renameFile(filePath, newName);

      if (success) {
        return { success: true, message: 'File renamed successfully' };
      } else {
        return {
          success: false,
          error: 'Failed to rename file or file with that name already exists',
        };
      }
    } else if (intent === 'moveFile') {
      const sourcePath = resolveEntry(formData.get('sourcePath'), roots);
      const destinationPath = resolveInside(formData.get('destinationPath'), roots);

      if (!sourcePath || !destinationPath) {
        return { success: false, error: OUTSIDE };
      }

      const blocked =
        (await writeBlocked('remove', sourcePath)) ||
        (await writeBlocked('add', path.join(destinationPath, path.basename(sourcePath))));
      if (blocked) {
        return { success: false, error: blocked };
      }

      const success = await moveFile(sourcePath, destinationPath);

      if (success) {
        return { success: true, message: 'File moved successfully' };
      } else {
        return {
          success: false,
          error:
            'Failed to move file or file with that name already exists in destination',
        };
      }
    } else if (intent === 'uploadFile') {
      const filePath = resolveInside(formData.get('filePath'), roots);
      const file = formData.get('file');
      if (!filePath) {
        return { success: false, error: OUTSIDE };
      }
      if (!file) {
        return { success: false, error: 'No file provided' };
      }
      const blocked = await writeBlocked('add', filePath);
      if (blocked) {
        return { success: false, error: blocked };
      }
      const name = (file as File).name;
      const nameError = getValidationError(name ?? '');
      if (nameError) {
        return { success: false, error: nameError };
      }
      if (await pathExists(path.join(filePath, name))) {
        return { success: false, error: nameTakenError(name) };
      }
      const success = await uploadFile(filePath, file);
      if (success) {
        return { success: true, message: 'File uploaded successfully' };
      } else {
        return { success: false, error: 'Failed to upload file' };
      }
    } else if (intent === 'cleanupDownload') {
      const filePath = resolveInside(formData.get('filePath'), roots);
      const fileName = formData.get('fileName') as string;

      if (!filePath || !fileName || getValidationError(fileName)) {
        return { success: false, error: 'Missing required cleanup data' };
      }

      try {
        const fullPath = path.join(filePath, fileName);
        const blocked = await writeBlocked('remove', fullPath);
        if (blocked) {
          return { success: false, error: blocked };
        }

        // Only a running download is cancelled; its partial data is never under the final
        // name, so an existing file there is not touched.
        activeDownloads.get(fullPath)?.cancel();

        return { success: true, message: 'Download cleanup completed' };
      } catch (error) {
        console.error('Failed to cleanup download:', error);
        return { success: false, error: 'Failed to cleanup download' };
      }
    } else if (intent === 'abortUpload') {
      const filePath = resolveInside(formData.get('filePath'), roots);
      const fileId = formData.get('fileId');
      if (!filePath || typeof fileId !== 'string' || !UPLOAD_ID_RE.test(fileId)) {
        return { success: false, error: 'Missing required upload data' };
      }
      await abortUpload(fileId, filePath);
      return { success: true };
    } else if (intent === 'uploadChunk') {
      const res = await handleChunkUpload(formData);
      return res;
    } else if (intent === 'downloadFile') {
      const url = formData.get('url') as string;
      const fileName = formData.get('fileName') as string;
      const currentPath = resolveInside(formData.get('currentPath'), roots);
      if (!currentPath) {
        return { success: false, error: OUTSIDE };
      }

      if (!url || !fileName) {
        return { success: false, error: 'URL and filename are required' };
      }

      const validationError = getValidationError(fileName);
      if (validationError) {
        return { success: false, error: validationError };
      }

      const destPath = path.join(currentPath, fileName);
      const blocked = await writeBlocked('add', destPath);
      if (blocked) {
        return { success: false, error: blocked };
      }
      if (await pathExists(destPath)) {
        return { success: false, error: nameTakenError(fileName) };
      }
      const result = await downloadFile(url, destPath);

      if (result.ok) {
        return { success: true, message: 'File downloaded successfully' };
      } else {
        return { success: false, error: `Failed to download file: ${result.error}` };
      }
    } else if (intent === 'downloadImage') {
      const imageUrl = formData.get('imageUrl') as string;
      const imageTag = formData.get('imageTag') as string;
      const currentPath = resolveInside(formData.get('currentPath'), roots);
      if (!currentPath) {
        return { success: false, error: OUTSIDE };
      }
      const architecture = (formData.get('architecture') as string) || 'amd64';
      const blocked = await writeBlocked('add', currentPath);
      if (blocked) {
        return { success: false, error: blocked };
      }

      if (!imageUrl || !imageUrl.trim()) {
        return { success: false, error: 'Image URL is required' };
      }

      if (!imageTag || !imageTag.trim()) {
        return { success: false, error: 'Image tag is required' };
      }

      try {
        const success = await downloadImage(
          imageUrl.trim(),
          imageTag.trim(),
          currentPath,
          architecture,
        );

        if (success) {
          return {
            success: true,
            message: 'Container image downloaded successfully',
          };
        } else {
          return {
            success: false,
            error: 'Failed to download container image',
          };
        }
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        return { success: false, error: errorMessage };
      }
    } else if (intent === 'runHealthCheck') {
      try {
        const dataDirs = [
          appConfig.filesDir,
          appConfig.privateFilesDir,
          appConfig.mirroredPackagesDir,
          appConfig.npmPackagesDir,
        ].filter(Boolean);
        const healthFile = appConfig.healthReportFile;

        const initialHealthReport = {
          timestamp: new Date().toISOString(),
          status: 'inProgress',
          scan_paths: dataDirs,
          total_files: 0,
          total_directories: 0,
          invalid_files: [],
          cleaned_tmp_dirs: [],
          scan_errors: [],
        };

        const healthDir = path.dirname(healthFile);
        await fs.mkdir(healthDir, { recursive: true });
        await fs.writeFile(
          healthFile,
          JSON.stringify(initialHealthReport, null, 2),
        );

        (async () => {
          try {
            const {
              totalFiles,
              totalDirectories,
              invalidFiles,
              cleanedTmpDirs,
              scanErrors,
            } = await scanTrees(dataDirs);

            const healthReport = {
              timestamp: new Date().toISOString(),
              scan_paths: dataDirs,
              total_files: totalFiles,
              total_directories: totalDirectories,
              invalid_files: invalidFiles,
              cleaned_tmp_dirs: cleanedTmpDirs,
              scan_errors: scanErrors,
            };

            const healthDir = path.dirname(healthFile);
            await fs.mkdir(healthDir, { recursive: true });
            await fs.writeFile(
              healthFile,
              JSON.stringify(healthReport, null, 2),
            );

            const finalHealthReport = {
              timestamp: new Date().toISOString(),
              status: 'done',
              scan_paths: dataDirs,
              total_files: totalFiles,
              total_directories: totalDirectories,
              invalid_files: invalidFiles,
              cleaned_tmp_dirs: cleanedTmpDirs,
              scan_errors: scanErrors,
            };

            await fs.writeFile(
              healthFile,
              JSON.stringify(finalHealthReport, null, 2),
            );
          } catch (error) {
            const errorHealthReport = {
              timestamp: new Date().toISOString(),
              status: 'error',
              scan_paths: dataDirs,
              total_files: 0,
              total_directories: 0,
              invalid_files: [],
              cleaned_tmp_dirs: [],
              scan_errors: [`Health check failed: ${error}`],
            };
            await fs.writeFile(
              healthFile,
              JSON.stringify(errorHealthReport, null, 2),
            );
          }
        })();

        return {
          success: true,
          message: 'File system health check started in background',
          output:
            'Scanning directories and performing cleanup. Check back later for results.',
        };
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        return {
          success: false,
          error: `Health check failed to start: ${errorMessage}`,
        };
      }
    } else if (intent === 'clearHealthCheck') {
      try {
        const healthFile = appConfig.healthReportFile;
        await fs.unlink(healthFile);

        return { success: true, message: 'Health report cleared successfully' };
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        return {
          success: false,
          error: `Failed to clear health report: ${errorMessage}`,
        };
      }
    } else if (intent === 'searchFiles') {
      const searchQuery = formData.get('searchQuery') as string;
      const rootPath = resolveInside(formData.get('rootPath'), roots);

      if (!searchQuery || searchQuery.trim().length < 3) {
        return { success: false, error: 'Search query must be at least 3 characters' };
      }

      if (!rootPath) {
        return { success: false, error: OUTSIDE };
      }

      try {
        const results = await searchFiles(rootPath, searchQuery.trim(), roots);
        return { success: true, results };
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        return {
          success: false,
          error: `Search failed: ${errorMessage}`,
        };
      }
    }

    return { success: false, error: 'Invalid action' };
  } catch (error) {
    return { success: false, error: 'An unexpected error occurred' };
  }
}
