import fs from 'fs/promises';

export async function checkLockFile(): Promise<boolean> {
  try {
    await fs.access('/var/run/apt-mirror.lock');
    return true;
  } catch (error) {
    return false;
  }
}
