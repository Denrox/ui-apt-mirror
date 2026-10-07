/** Longest file name most filesystems accept (NAME_MAX), in bytes. */
export const MAX_NAME_BYTES = 255;

// Characters that make a name display as something else: format characters (bidi controls,
// e.g. "x\u202Etxt.exe" shows as "xexe.txt", zero-width characters, the soft hyphen, tags),
// line and paragraph separators, and the Hangul fillers and Mongolian vowel separator, which
// render blank.
const SPOOFING_CHARS = /[\p{Cf}\p{Zl}\p{Zp}\u115F\u1160\u180E\u3164\uFFA0]/u;

// Look like "/", so the name reads as a path.
const SLASH_LOOKALIKES = /[\u2044\u2215\u29F8\uFF0F]/;

/** Why `name` is not acceptable as a new file or folder name, or null. */
export function getValidationError(name: string): string | null {
  if (!name.trim()) {
    return 'Name cannot be empty';
  }

  if (name.startsWith('.') || name.includes('/')) {
    return "Name cannot contain './', '../', or other path traversal characters";
  }

  if (name !== name.trim()) {
    return 'Name cannot start or end with a space';
  }

  // \p{Cc}: C0 and C1 control characters and DEL; U+009B starts a terminal escape.
  if (/[<>:"|?*]/.test(name) || /\p{Cc}/u.test(name) || SLASH_LOOKALIKES.test(name)) {
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
