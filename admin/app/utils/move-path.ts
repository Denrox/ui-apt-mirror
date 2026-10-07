import fs from 'fs/promises';
import path from 'path';
import { UPLOAD_TEMP_PREFIX, withBusyTempDir } from './chunk-upload';

/** Prefix of the scratch dir a cross-mount copy is made in; stale ones are swept like upload temp dirs. */
export const MOVE_TEMP_PREFIX = `${UPLOAD_TEMP_PREFIX}move-`;

/**
 * Moves the entry `sourcePath` (a symlink stays a link) into the directory `destinationPath`;
 * false if the target name is taken or the move is invalid.
 *
 * The target name is claimed first with an exclusive create, so of two concurrent moves of the
 * same item only one proceeds, and nothing this call did not create is ever replaced or removed.
 */
export async function moveFile(sourcePath: string, destinationPath: string): Promise<boolean> {
  const newPath = path.join(destinationPath, path.basename(sourcePath));
  if (sourcePath === newPath || newPath.startsWith(sourcePath + path.sep)) {
    return false;
  }

  let claim: Claim;
  try {
    const stats = await fs.lstat(sourcePath);
    claim = await claimName(newPath, stats.isDirectory());
  } catch {
    return false;
  }

  try {
    try {
      // Replaces only our own placeholder: an empty dir or an empty file.
      await fs.rename(sourcePath, newPath);
    } catch (error) {
      // Public and private storage are separate mounts.
      if ((error as NodeJS.ErrnoException).code !== 'EXDEV') throw error;
      await copyThenRemove(sourcePath, newPath, destinationPath);
    }
    return true;
  } catch {
    await releaseClaim(claim);
    return false;
  }
}

interface Claim {
  path: string;
  isDirectory: boolean;
  ino: number;
}

/** Creates an empty placeholder at `p`; throws EEXIST when the name is taken. */
async function claimName(p: string, isDirectory: boolean): Promise<Claim> {
  if (isDirectory) {
    await fs.mkdir(p);
  } else {
    await (await fs.open(p, 'wx')).close();
  }
  return { path: p, isDirectory, ino: (await fs.lstat(p)).ino };
}

/** Removes the placeholder, but only while it is still the empty one we created. */
async function releaseClaim(claim: Claim) {
  try {
    const stats = await fs.lstat(claim.path);
    if (stats.ino !== claim.ino) return;
    if (claim.isDirectory) {
      await fs.rmdir(claim.path); // fails, and keeps it, if anything was put inside
    } else if (stats.isFile() && stats.size === 0) {
      await fs.unlink(claim.path);
    }
  } catch {
    // Already gone or no longer ours.
  }
}

async function copyThenRemove(sourcePath: string, newPath: string, destinationPath: string) {
  // Copy next to the target first, so a failed copy never leaves a partial item under its name.
  const tempDir = await fs.mkdtemp(path.join(destinationPath, MOVE_TEMP_PREFIX));
  try {
    const tempPath = path.join(tempDir, 'item');
    await withBusyTempDir(tempDir, () =>
      fs.cp(sourcePath, tempPath, {
        recursive: true,
        errorOnExist: true,
        force: false,
        preserveTimestamps: true,
        verbatimSymlinks: true,
      }),
    );
    await fs.rename(tempPath, newPath);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
  await fs.rm(sourcePath, { recursive: true, force: true });
}
