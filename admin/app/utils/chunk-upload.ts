import fs from 'fs/promises';
import path from 'path';
import { giveToDirOwner } from './file-owner';

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

/** How long a finished upload still acknowledges a resent chunk (the client retries for seconds). */
export const FINISHED_UPLOAD_MS = 10 * 60 * 1000;

// Finished uploads by id: a resent last chunk, whose first answer was lost, is acknowledged
// instead of reported as a failure while the file is stored.
const finished = new Map<string, { destPath: string; totalChunks: number; finishedAt: number }>();

export class UploadError extends Error {}

export const nameTakenError = (name: string) =>
  `"${name}" already exists here; rename or delete it first`;

/** The target name is taken; callers tell it from other failures by type, not by message. */
export class NameTakenError extends UploadError {
  constructor(name: string) {
    super(nameTakenError(name));
  }
}

export const pathExists = (p: string) => fs.lstat(p).then(() => true, () => false);

export function uploadTempDir(dir: string, fileId: string): string {
  return path.join(dir, `${UPLOAD_TEMP_PREFIX}${fileId}`);
}

// Per-upload queue: a chunk resent while the first copy is still being written must wait
// for it, then see it as already stored, instead of being appended a second time.
const queues = new Map<string, Promise<unknown>>();

function serialized<T>(fileId: string, work: () => Promise<T>): Promise<T> {
  const previous = queues.get(fileId) ?? Promise.resolve();
  const result = previous.then(work, work);
  const tail = result.catch(() => undefined);
  queues.set(fileId, tail);
  tail.then(() => {
    if (queues.get(fileId) === tail) queues.delete(fileId);
  });
  return result;
}

interface ChunkOptions {
  fileId: string;
  dir: string;
  fileName: string;
  chunkIndex: number;
  totalChunks: number;
  data: Buffer;
  now?: number;
}

/**
 * Stores one chunk. Chunk 0 (re)starts the upload, a repeated chunk is acknowledged
 * without writing it again, and a gap or unknown upload is refused. Chunks of one upload
 * are handled one at a time, in the order they arrive.
 */
export function writeChunk(opts: ChunkOptions): Promise<'chunk' | 'done'> {
  return serialized(opts.fileId, () => storeChunk(opts));
}

async function storeChunk(opts: ChunkOptions): Promise<'chunk' | 'done'> {
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

  const done = finished.get(fileId);
  if (done) {
    finished.delete(fileId);
    if (
      now - done.finishedAt <= FINISHED_UPLOAD_MS &&
      done.destPath === destPath &&
      done.totalChunks === totalChunks &&
      (await pathExists(destPath))
    ) {
      finished.set(fileId, done);
      return chunkIndex === totalChunks - 1 ? 'done' : 'chunk';
    }
  }

  let upload = uploads.get(fileId);

  if (chunkIndex === 0) {
    if (upload) await fs.rm(upload.tempDir, { recursive: true, force: true });
    if (await pathExists(destPath)) throw new NameTakenError(fileName);
    const tempDir = uploadTempDir(dir, fileId);
    await fs.rm(tempDir, { recursive: true, force: true });
    await fs.mkdir(tempDir, { recursive: true });
    upload = {
      tempDir,
      // Fixed short name: `<fileName>.temp` exceeded NAME_MAX for valid 251-255 byte names.
      tempFile: path.join(tempDir, 'part'),
      destPath,
      totalChunks,
      nextIndex: 0,
      touchedAt: now,
    };
    uploads.set(fileId, upload);
  } else if (!upload || upload.destPath !== destPath || upload.totalChunks !== totalChunks) {
    await dropUpload(fileId, dir);
    throw new UploadError('Upload was interrupted; start it again');
  } else if (chunkIndex < upload.nextIndex) {
    upload.touchedAt = now;
    return 'chunk';
  } else if (chunkIndex > upload.nextIndex) {
    await dropUpload(fileId, dir);
    throw new UploadError(`Missing chunk ${upload.nextIndex + 1}; start the upload again`);
  }

  try {
    if (chunkIndex === 0) {
      await fs.writeFile(upload.tempFile, data);
    } else {
      await fs.appendFile(upload.tempFile, data);
    }
  } catch (error) {
    await dropUpload(fileId, dir);
    throw error;
  }
  upload.nextIndex = chunkIndex + 1;
  upload.touchedAt = now;

  if (upload.nextIndex < totalChunks) return 'chunk';
  uploads.delete(fileId);
  if (await pathExists(destPath)) {
    await fs.rm(upload.tempDir, { recursive: true, force: true });
    throw new NameTakenError(fileName);
  }
  try {
    await fs.rename(upload.tempFile, destPath);
  } finally {
    await fs.rm(upload.tempDir, { recursive: true, force: true });
  }
  giveToDirOwner(destPath);
  finished.set(fileId, { destPath, totalChunks, finishedAt: now });
  return 'done';
}

/** Cancels an upload, after any chunk of it that is still being written. */
export function abortUpload(fileId: string, dir: string): Promise<void> {
  return serialized(fileId, () => dropUpload(fileId, dir));
}

async function dropUpload(fileId: string, dir: string): Promise<void> {
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

// Temp dirs other work (a cross-mount move) is writing to right now; never stale.
const busyTempDirs = new Set<string>();

export async function withBusyTempDir<T>(dir: string, work: () => Promise<T>): Promise<T> {
  busyTempDirs.add(dir);
  try {
    return await work();
  } finally {
    busyTempDirs.delete(dir);
  }
}

export async function isStaleTempDir(dir: string, maxAgeMs = STALE_UPLOAD_MS, now = Date.now()) {
  if (busyTempDirs.has(dir)) return false;
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
  for (const [fileId, done] of finished) {
    if (now - done.finishedAt > FINISHED_UPLOAD_MS) finished.delete(fileId);
  }
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
