import fs from 'fs/promises';
import path from 'path';
import { randomBytes } from 'crypto';
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

/**
 * Hidden name a cross-mount move parks its source under while it is copied. Not `.tmp-`, so
 * no temp sweep ever removes it: after a restart it is put back by `restoreParkedMoves`.
 */
export const MOVE_SOURCE_PREFIX = '.moving-';
const PARKED_NAME_SUFFIX = '.name';

async function copyThenRemove(sourcePath: string, newPath: string, destinationPath: string) {
  // Park the source under a hidden name on its own mount first. Anything written to its old
  // path during the copy (an upload, a new folder) then lands outside it, never in the tree
  // that is removed afterwards.
  const parked = path.join(
    path.dirname(sourcePath),
    `${MOVE_SOURCE_PREFIX}${randomBytes(8).toString('hex')}`,
  );
  // Its name, for restoreParkedMoves after a restart.
  await fs.writeFile(parked + PARKED_NAME_SUFFIX, path.basename(sourcePath), { flag: 'wx' });
  try {
    await fs.rename(sourcePath, parked);
  } catch (error) {
    await fs.rm(parked + PARKED_NAME_SUFFIX, { force: true });
    throw error;
  }

  try {
    await copyParked(parked, sourcePath, newPath, destinationPath);
  } finally {
    await fs.rm(parked + PARKED_NAME_SUFFIX, { force: true });
  }
}

async function copyParked(
  parked: string,
  sourcePath: string,
  newPath: string,
  destinationPath: string,
) {
  let copied = false;
  try {
    // Copy next to the target first, so a failed copy never leaves a partial item under its name.
    const tempDir = await fs.mkdtemp(path.join(destinationPath, MOVE_TEMP_PREFIX));
    try {
      const tempPath = path.join(tempDir, 'item');
      await withBusyTempDir(tempDir, () =>
        fs.cp(parked, tempPath, {
          recursive: true,
          errorOnExist: true,
          force: false,
          preserveTimestamps: true,
          verbatimSymlinks: true,
        }),
      );
      await fs.rename(tempPath, newPath);
      copied = true;
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  } finally {
    if (!copied) await putBack(parked, sourcePath);
  }

  // Remove only what the copy holds unchanged; whatever is left goes back under the old name.
  let removed = false;
  try {
    removed = await removeCopied(parked, newPath);
  } catch {
    // Keep what could not be removed.
  }
  if (!removed) await putBack(parked, sourcePath);
}

/**
 * Removes `source` entry by entry where `copy` holds the same thing (a file of the same size
 * and mtime, a link with the same target); true when nothing of `source` is left.
 */
export async function removeCopied(source: string, copy: string): Promise<boolean> {
  let s, c;
  try {
    s = await fs.lstat(source);
  } catch {
    return true;
  }
  try {
    c = await fs.lstat(copy);
  } catch {
    return false;
  }
  if (s.isDirectory()) {
    if (!c.isDirectory()) return false;
    let all = true;
    for (const name of await fs.readdir(source)) {
      if (!(await removeCopied(path.join(source, name), path.join(copy, name)))) all = false;
    }
    if (!all) return false;
    try {
      await fs.rmdir(source); // fails, and keeps it, if anything was added meanwhile
      return true;
    } catch {
      return false;
    }
  }
  if (s.isSymbolicLink()) {
    if (!c.isSymbolicLink() || (await fs.readlink(source)) !== (await fs.readlink(copy))) {
      return false;
    }
  } else if (
    c.isDirectory() ||
    c.isSymbolicLink() ||
    c.size !== s.size ||
    // cp copies mtimes at millisecond precision
    Math.abs(c.mtimeMs - s.mtimeMs) >= 1
  ) {
    return false;
  }
  await fs.unlink(source);
  return true;
}

const MAX_NAME_BYTES = 255;

function withSuffix(name: string, suffix: string): string {
  let base = name;
  while (base && Buffer.byteLength(base + suffix) > MAX_NAME_BYTES) base = base.slice(0, -1);
  return base + suffix;
}

/**
 * Gives a parked source back its name, or, if that was taken meanwhile, a free name next to
 * it ("<name> (not moved)"); never replaces anything. Leaves it parked if all of that fails.
 */
async function putBack(parked: string, sourcePath: string): Promise<void> {
  let isDirectory: boolean;
  try {
    isDirectory = (await fs.lstat(parked)).isDirectory();
  } catch {
    return; // Nothing left to put back.
  }
  const dir = path.dirname(sourcePath);
  const name = path.basename(sourcePath);
  for (let i = 0; i < 20; i++) {
    const candidate = path.join(
      dir,
      i === 0 ? name : withSuffix(name, i === 1 ? ' (not moved)' : ` (not moved ${i})`),
    );
    let claim: Claim;
    try {
      claim = await claimName(candidate, isDirectory);
    } catch {
      continue;
    }
    try {
      await fs.rename(parked, candidate);
      return;
    } catch {
      await releaseClaim(claim);
    }
  }
  console.error(`Could not put back ${sourcePath}; it is kept as ${parked}`);
}

/** Puts back sources that a move had parked when the process stopped (below `root`). */
export async function restoreParkedMoves(root: string): Promise<void> {
  const walk = async (dir: string) => {
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.name.startsWith(MOVE_SOURCE_PREFIX)) {
        if (e.name.endsWith(PARKED_NAME_SUFFIX)) continue;
        const note = full + PARKED_NAME_SUFFIX;
        const name = await fs.readFile(note, 'utf-8').catch(() => '');
        const valid = name && !name.includes('/') && name !== '.' && name !== '..';
        await putBack(full, path.join(dir, valid ? name : `moved-item-${e.name.slice(MOVE_SOURCE_PREFIX.length)}`));
        await fs.rm(note, { force: true });
      } else if (e.isDirectory() && !e.name.startsWith('.')) {
        await walk(full);
      }
    }
  };
  await walk(root);
}
