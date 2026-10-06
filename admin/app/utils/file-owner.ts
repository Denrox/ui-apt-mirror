import { chownSync, statSync } from 'fs';
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
