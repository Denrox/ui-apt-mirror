import fs from 'fs/promises';
import path from 'path';

/** Moves `sourcePath` into the directory `destinationPath`; false if the target exists or the move is invalid. */
export async function moveFile(sourcePath: string, destinationPath: string): Promise<boolean> {
  try {
    const newPath = path.join(destinationPath, path.basename(sourcePath));

    if (sourcePath === newPath || newPath.startsWith(sourcePath + path.sep)) {
      return false;
    }
    if (await fs.lstat(newPath).then(() => true, () => false)) {
      return false;
    }

    try {
      await fs.rename(sourcePath, newPath);
    } catch (error) {
      // Public and private storage are separate mounts.
      if ((error as NodeJS.ErrnoException).code !== 'EXDEV') throw error;
      await copyThenRemove(sourcePath, newPath);
    }
    return true;
  } catch (error) {
    return false;
  }
}

async function copyThenRemove(sourcePath: string, newPath: string) {
  try {
    await fs.cp(sourcePath, newPath, {
      recursive: true,
      errorOnExist: true,
      force: false,
      preserveTimestamps: true,
      verbatimSymlinks: true,
    });
  } catch (error) {
    await fs.rm(newPath, { recursive: true, force: true });
    throw error;
  }
  await fs.rm(sourcePath, { recursive: true, force: true });
}
