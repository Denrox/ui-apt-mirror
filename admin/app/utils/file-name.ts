/** Longest file name most filesystems accept (NAME_MAX), in bytes. */
export const MAX_NAME_BYTES = 255;

// Characters that make a name display as something else: format characters (bidi controls,
// e.g. "x\u202Etxt.exe" shows as "xexe.txt", zero-width characters, the soft hyphen, tags),
// line and paragraph separators, default-ignorable characters (the combining grapheme joiner,
// variation selectors, the Hangul fillers), and characters that render blank (the Braille
// blank, the musical null notehead, the Mongolian vowel separator).
const SPOOFING_CHARS =
  /[\p{Cf}\p{Zl}\p{Zp}\p{Default_Ignorable_Code_Point}\u115F\u1160\u180E\u2800\u3164\uFFA0\u{1D159}]/u;

// The text/emoji variation selectors are fine right after an emoji, as in "❤️".
const EMOJI_PRESENTATION = /(\p{Extended_Pictographic})[\uFE0E\uFE0F]/gu;

// A combining mark with nothing to combine with, at the start of a name, renders on its own or not at all.
const LEADING_MARK = /^\p{M}/u;

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

  const charactersError = getCharactersError(name);
  if (charactersError) {
    return charactersError;
  }

  if (Buffer.byteLength(name, 'utf8') > MAX_NAME_BYTES) {
    return `Name is too long (at most ${MAX_NAME_BYTES} bytes)`;
  }

  return null;
}

/**
 * Why the characters of `name` are not acceptable, or null: spaces at either end, characters
 * that are invalid in names, and characters that make it display as something else.
 */
export function getCharactersError(name: string): string | null {
  if (name !== name.trim()) {
    return 'Name cannot start or end with a space';
  }

  // \p{Cc}: C0 and C1 control characters and DEL; U+009B starts a terminal escape.
  if (/[<>:"|?*]/.test(name) || /\p{Cc}/u.test(name) || SLASH_LOOKALIKES.test(name)) {
    return 'Name contains invalid characters';
  }

  if (SPOOFING_CHARS.test(name.replace(EMOJI_PRESENTATION, '$1')) || LEADING_MARK.test(name)) {
    return 'Name contains invisible or text-direction characters';
  }

  return null;
}
