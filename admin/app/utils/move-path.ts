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

// Hard links aren't possible here: fall back to claiming the name, then renaming over the claim.
const NO_HARD_LINK = new Set(['EPERM', 'ENOTSUP', 'EOPNOTSUPP', 'ENOSYS', 'EMLINK']);

/**
 * Renames the entry `oldPath` (a symlink stays a link) to `newName` in the same directory;
 * false if the name is taken or the rename fails. Never replaces an entry, even one created
 * while this runs: a file or symlink gets a hard link at the new name (which fails if the name
 * exists) before the old name is removed; a directory claims the new name with an empty
 * directory first, and rename() refuses to replace one that is no longer empty.
 */
export async function renameEntry(oldPath: string, newName: string): Promise<boolean> {
  const newPath = path.join(path.dirname(oldPath), newName);
  if (newPath === oldPath) return false;

  let stats;
  try {
    stats = await fs.lstat(oldPath);
  } catch {
    return false;
  }

  if (!stats.isDirectory()) {
    try {
      await fs.link(oldPath, newPath); // link(2) doesn't follow a symlink
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code ?? '';
      if (!NO_HARD_LINK.has(code)) return false;
      return renameOverClaim(oldPath, newPath, false);
    }
    try {
      // Only drop the old name while it is still the entry we linked.
      if ((await fs.lstat(oldPath)).ino !== stats.ino) throw new Error('Replaced meanwhile');
      await fs.unlink(oldPath);
      return true;
    } catch {
      await fs.unlink(newPath).catch(() => {});
      return false;
    }
  }
  return renameOverClaim(oldPath, newPath, true);
}

async function renameOverClaim(oldPath: string, newPath: string, isDirectory: boolean): Promise<boolean> {
  let claim: Claim;
  try {
    claim = await claimName(newPath, isDirectory);
  } catch {
    return false;
  }
  try {
    await fs.rename(oldPath, newPath); // replaces only our empty placeholder
    return true;
  } catch {
    await releaseClaim(claim);
    return false;
  }
}
