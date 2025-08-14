import fs from "fs/promises";

/**
 * Checks if apt-mirror sync is currently running by looking for the lock file
 * @returns Promise<boolean> - true if sync is running (lock file exists), false otherwise
 */
export async function checkLockFile(): Promise<boolean> {
  try {
    await fs.access("/var/run/apt-mirror.lock");
    return true; // Lock file exists - sync is running
  } catch (error) {
    return false; // Lock file doesn't exist - sync is not running
  }
} 