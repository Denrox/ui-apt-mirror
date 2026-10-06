import { chownSync, statSync } from 'fs';
import { mkdir } from 'fs/promises';
import path from 'path';

export function giveToDirOwner(file: string): void {
  try {
    const owner = statSync(path.dirname(file));
    const current = statSync(file);
    if (current.uid !== owner.uid || current.gid !== owner.gid) {
      chownSync(file, owner.uid, owner.gid);
    }
  } catch {}
}

/** The directories from `firstCreated` down to `dir`, as `mkdir -p` made them. */
export function createdLevels(firstCreated: string, dir: string): string[] {
  const levels = [firstCreated];
  for (const name of path.relative(firstCreated, dir).split(path.sep).filter(Boolean)) {
    levels.push(path.join(levels[levels.length - 1], name));
  }
  return levels;
}

/** mkdir -p whose new directories belong to their parent's owner, not to root. */
export async function mkdirOwned(dir: string): Promise<void> {
  const first = await mkdir(dir, { recursive: true });
  if (first) createdLevels(first, dir).forEach(giveToDirOwner);
}
