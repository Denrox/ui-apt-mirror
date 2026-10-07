import fs from 'fs/promises';
import path from 'path';
import { randomBytes } from 'crypto';
import { UPLOAD_TEMP_PREFIX, withBusyTempDir } from './chunk-upload';
import { MAX_NAME_BYTES } from './file-name';

/** Prefix of the scratch dir a cross-mount copy is made in; stale ones are swept like upload temp dirs. */
const MOVE_TEMP_PREFIX = `${UPLOAD_TEMP_PREFIX}move-`;

const errorCode = (error: unknown) => (error as NodeJS.ErrnoException)?.code ?? '';

// Hard links aren't possible here: fall back to claiming the name, then renaming over the claim.
const NO_HARD_LINK = new Set(['EPERM', 'ENOTSUP', 'EOPNOTSUPP', 'ENOSYS', 'EMLINK']);

/**
 * Moves the entry `sourcePath` (a symlink stays a link) into the directory `destinationPath`;
 * false if the target name is taken or the move is invalid.
 *
 * Nothing this call did not create is ever replaced or removed. On one filesystem a file gets a
 * hard link at the new name, which fails if the name is taken. Otherwise the target name is
 * claimed first with an exclusive create, so of two concurrent moves of the same item only one
 * proceeds, and the item only ever takes the place of that placeholder.
 */
export async function moveFile(sourcePath: string, destinationPath: string): Promise<boolean> {
  const newPath = path.join(destinationPath, path.basename(sourcePath));
  if (sourcePath === newPath || newPath.startsWith(sourcePath + path.sep)) {
    return false;
  }

  let stats;
  try {
    stats = await fs.lstat(sourcePath);
  } catch {
    return false;
  }

  // Public and private storage are separate mounts.
  let sameMount = true;
  if (!stats.isDirectory()) {
    try {
      await fs.link(sourcePath, newPath); // link(2) doesn't follow a symlink
      return await dropOldName(sourcePath, newPath, stats.ino);
    } catch (error) {
      const code = errorCode(error);
      if (code === 'EXDEV') sameMount = false;
      else if (!NO_HARD_LINK.has(code)) return false;
    }
  }

  let claim: Claim;
  try {
    claim = await claimName(newPath, stats.isDirectory());
  } catch {
    return false;
  }

  try {
    if (sameMount) {
      try {
        if ((await placeOverClaim(sourcePath, claim)) === 'linked') {
          return await dropOldName(sourcePath, newPath, stats.ino);
        }
        return true;
      } catch (error) {
        if (errorCode(error) !== 'EXDEV') throw error;
      }
    }
    await copyThenRemove(sourcePath, claim, destinationPath);
    return true;
  } catch {
    await releaseClaim(claim);
    return false;
  }
}

/**
 * Removes `oldPath` once `newPath` is a hard link to it, but only while `oldPath` is still the
 * entry with inode `ino`; otherwise removes the new link again. True when the entry moved.
 */
async function dropOldName(oldPath: string, newPath: string, ino: number): Promise<boolean> {
  try {
    if ((await fs.lstat(oldPath)).ino !== ino) throw new Error('Replaced meanwhile');
    await fs.unlink(oldPath);
    return true;
  } catch {
    try {
      if ((await fs.lstat(newPath)).ino === ino) await fs.unlink(newPath);
    } catch {
      // Already gone.
    }
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

const nameTaken = (p: string) =>
  Object.assign(new Error(`${p} was taken meanwhile`), { code: 'EEXIST' });

/**
 * Puts `from` (on the same filesystem) under the name `claim` holds, but only while the name
 * still holds our empty placeholder; never replaces anything else, even an entry stored there
 * after the placeholder was deleted. A directory is renamed over its placeholder (rename(2)
 * replaces only an empty directory). A file is hard-linked in once the placeholder is gone,
 * since link(2) fails if the name was taken meanwhile; `from` then stays, for the caller to
 * remove ('linked').
 */
async function placeOverClaim(from: string, claim: Claim): Promise<'linked' | 'renamed'> {
  const current = await fs.lstat(claim.path).catch(() => null);
  if (current && (current.ino !== claim.ino || (!claim.isDirectory && current.size !== 0))) {
    throw nameTaken(claim.path);
  }
  if (claim.isDirectory) {
    await fs.rename(from, claim.path);
    return 'renamed';
  }
  if (current) await fs.unlink(claim.path);
  try {
    await fs.link(from, claim.path);
    return 'linked';
  } catch (error) {
    if (!NO_HARD_LINK.has(errorCode(error))) throw error;
  }
  // Hard links aren't possible here: claim the name again and rename over that placeholder.
  const again = await claimName(claim.path, false);
  claim.ino = again.ino;
  await fs.rename(from, claim.path);
  return 'renamed';
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

// Paths running cross-mount moves hold: the parked source, the claimed target name and the temp
// dir the copy is made in. Renaming, moving or deleting one of them, or a folder above one, would
// pull it from under the move: a parked source would be left hidden, a placeholder replaced.
const heldByMoves = new Set<string>();

/** True when `p` is, contains or is inside something a running move holds. */
export function moveHolds(p: string): boolean {
  for (const held of heldByMoves) {
    if (held === p || held.startsWith(p + path.sep) || p.startsWith(held + path.sep)) return true;
  }
  return false;
}

async function holding<T>(paths: string[], work: () => Promise<T>): Promise<T> {
  const added = paths.filter((p) => !heldByMoves.has(p));
  added.forEach((p) => heldByMoves.add(p));
  try {
    return await work();
  } finally {
    added.forEach((p) => heldByMoves.delete(p));
  }
}

async function copyThenRemove(sourcePath: string, claim: Claim, destinationPath: string) {
  // Park the source under a hidden name on its own mount first. Anything written to its old
  // path during the copy (an upload, a new folder) then lands outside it, never in the tree
  // that is removed afterwards.
  const parked = path.join(
    path.dirname(sourcePath),
    `${MOVE_SOURCE_PREFIX}${randomBytes(8).toString('hex')}`,
  );
  await holding([parked, claim.path], () => parkAndCopy(sourcePath, parked, claim, destinationPath));
}

async function parkAndCopy(sourcePath: string, parked: string, claim: Claim, destinationPath: string) {
  // Its name, for restoreParkedMoves after a restart.
  await fs.writeFile(parked + PARKED_NAME_SUFFIX, path.basename(sourcePath), { flag: 'wx' });
  try {
    await fs.rename(sourcePath, parked);
  } catch (error) {
    await fs.rm(parked + PARKED_NAME_SUFFIX, { force: true });
    throw error;
  }

  try {
    await copyParked(parked, sourcePath, claim, destinationPath);
  } finally {
    // While the source is still parked, its name stays for restoreParkedMoves.
    const stillParked = await fs.lstat(parked).then(() => true, () => false);
    if (!stillParked) await fs.rm(parked + PARKED_NAME_SUFFIX, { force: true });
  }
}

async function copyParked(
  parked: string,
  sourcePath: string,
  claim: Claim,
  destinationPath: string,
) {
  const newPath = claim.path;
  let copied = false;
  try {
    // Copy next to the target first, so a failed copy never leaves a partial item under its name.
    const tempDir = await fs.mkdtemp(path.join(destinationPath, MOVE_TEMP_PREFIX));
    try {
      const tempPath = path.join(tempDir, 'item');
      await holding([tempDir], async () => {
        await withBusyTempDir(tempDir, () =>
          fs.cp(parked, tempPath, {
            recursive: true,
            errorOnExist: true,
            force: false,
            preserveTimestamps: true,
            verbatimSymlinks: true,
          }),
        );
        await placeOverClaim(tempPath, claim);
      });
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
async function removeCopied(source: string, copy: string): Promise<boolean> {
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

/**
 * Puts back sources (below `root`) that a move left parked: when the process stopped, or when
 * putting one back failed. Sources a running move holds are left alone.
 */
export async function restoreParkedMoves(root: string): Promise<void> {
  const walk = async (dir: string) => {
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.name.startsWith(MOVE_SOURCE_PREFIX)) {
        if (e.name.endsWith(PARKED_NAME_SUFFIX) || heldByMoves.has(full)) continue;
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
    return dropOldName(oldPath, newPath, stats.ino);
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
