import fs from 'fs/promises';
import path from 'path';

export const UPLOAD_TEMP_PREFIX = '.tmp-';
export const STALE_UPLOAD_MS = 60 * 60 * 1000;

interface Upload {
  tempDir: string;
  tempFile: string;
  destPath: string;
  totalChunks: number;
  nextIndex: number;
  touchedAt: number;
}

const uploads = new Map<string, Upload>();

export class UploadError extends Error {}

export function uploadTempDir(dir: string, fileId: string): string {
  return path.join(dir, `${UPLOAD_TEMP_PREFIX}${fileId}`);
}

/**
 * Stores one chunk. Chunk 0 (re)starts the upload, a repeated chunk is acknowledged
 * without writing it again, and a gap or unknown upload is refused.
 */
export async function writeChunk(opts: {
  fileId: string;
  dir: string;
  fileName: string;
  chunkIndex: number;
  totalChunks: number;
  data: Buffer;
  now?: number;
}): Promise<'chunk' | 'done'> {
  const { fileId, dir, fileName, chunkIndex, totalChunks, data, now = Date.now() } = opts;
  if (
    !Number.isInteger(totalChunks) ||
    totalChunks < 1 ||
    !Number.isInteger(chunkIndex) ||
    chunkIndex < 0 ||
    chunkIndex >= totalChunks
  ) {
    throw new UploadError('Invalid chunk index');
  }
  const destPath = path.join(dir, fileName);
  let upload = uploads.get(fileId);

  if (chunkIndex === 0) {
    if (upload) await fs.rm(upload.tempDir, { recursive: true, force: true });
    const tempDir = uploadTempDir(dir, fileId);
    await fs.rm(tempDir, { recursive: true, force: true });
    await fs.mkdir(tempDir, { recursive: true });
    upload = {
      tempDir,
      tempFile: path.join(tempDir, `${fileName}.temp`),
      destPath,
      totalChunks,
      nextIndex: 0,
      touchedAt: now,
    };
    uploads.set(fileId, upload);
  } else if (!upload || upload.destPath !== destPath || upload.totalChunks !== totalChunks) {
    await abortUpload(fileId, dir);
    throw new UploadError('Upload was interrupted; start it again');
  } else if (chunkIndex < upload.nextIndex) {
    upload.touchedAt = now;
    return 'chunk';
  } else if (chunkIndex > upload.nextIndex) {
    await abortUpload(fileId, dir);
    throw new UploadError(`Missing chunk ${upload.nextIndex + 1}; start the upload again`);
  }

  if (chunkIndex === 0) {
    await fs.writeFile(upload.tempFile, data);
  } else {
    await fs.appendFile(upload.tempFile, data);
  }
  upload.nextIndex = chunkIndex + 1;
  upload.touchedAt = now;

  if (upload.nextIndex < totalChunks) return 'chunk';
  uploads.delete(fileId);
  await fs.rename(upload.tempFile, destPath);
  await fs.rm(upload.tempDir, { recursive: true, force: true });
  return 'done';
}

export async function abortUpload(fileId: string, dir: string): Promise<void> {
  const upload = uploads.get(fileId);
  uploads.delete(fileId);
  if (upload) await fs.rm(upload.tempDir, { recursive: true, force: true });
  await fs.rm(uploadTempDir(dir, fileId), { recursive: true, force: true });
}

/** Newest mtime of a temp dir and its entries: appending to the part file doesn't touch the dir. */
async function lastTouched(dir: string): Promise<number> {
  let latest = (await fs.stat(dir)).mtimeMs;
  for (const name of await fs.readdir(dir)) {
    const st = await fs.lstat(path.join(dir, name)).catch(() => null);
    if (st && st.mtimeMs > latest) latest = st.mtimeMs;
  }
  return latest;
}

export async function isStaleTempDir(dir: string, maxAgeMs = STALE_UPLOAD_MS, now = Date.now()) {
  try {
    return now - (await lastTouched(dir)) > maxAgeMs;
  } catch {
    return false;
  }
}

function isActiveTempDir(dir: string): boolean {
  for (const upload of uploads.values()) if (upload.tempDir === dir) return true;
  return false;
}

/** Drops in-progress uploads that stopped receiving chunks. */
export async function sweepStaleUploads(maxAgeMs = STALE_UPLOAD_MS, now = Date.now()) {
  for (const [fileId, upload] of uploads) {
    if (now - upload.touchedAt > maxAgeMs) {
      uploads.delete(fileId);
      await fs.rm(upload.tempDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}

/** Removes stale upload temp dirs anywhere below `root` (left behind by a restart); returns their paths. */
export async function removeStaleTempDirs(
  root: string,
  maxAgeMs = STALE_UPLOAD_MS,
  now = Date.now(),
): Promise<string[]> {
  const removed: string[] = [];
  const walk = async (dir: string) => {
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const e of entries) {
      // Dirent types come from lstat, so symlinked dirs are not followed.
      if (!e.isDirectory()) continue;
      const full = path.join(dir, e.name);
      if (e.name.startsWith(UPLOAD_TEMP_PREFIX)) {
        if (!isActiveTempDir(full) && (await isStaleTempDir(full, maxAgeMs, now))) {
          await fs.rm(full, { recursive: true, force: true });
          removed.push(full);
        }
      } else if (!e.name.startsWith('.')) {
        await walk(full);
      }
    }
  };
  await walk(root);
  return removed;
}
