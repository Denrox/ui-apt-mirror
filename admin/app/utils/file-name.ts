/** Longest file name most filesystems accept (NAME_MAX), in bytes. */
export const MAX_NAME_BYTES = 255;

// Bidi overrides/isolates and zero-width characters make a name display as something else,
// e.g. "x‮txt.exe" shows as "xexe.txt".
const SPOOFING_CHARS = /[؜​-‏‪-‮⁠-⁤⁦-⁩﻿]/;

/** Why `name` is not acceptable as a new file or folder name, or null. */
export function getValidationError(name: string): string | null {
  if (!name.trim()) {
    return 'Name cannot be empty';
  }

  if (name.startsWith('.') || name.includes('/')) {
    return "Name cannot contain './', '../', or other path traversal characters";
  }

  if (/[<>:"|?*\x00-\x1f\x7f]/.test(name)) {
    return 'Name contains invalid characters';
  }

  if (SPOOFING_CHARS.test(name)) {
    return 'Name contains invisible or text-direction characters';
  }

  if (Buffer.byteLength(name, 'utf8') > MAX_NAME_BYTES) {
    return `Name is too long (at most ${MAX_NAME_BYTES} bytes)`;
  }

  return null;
}
